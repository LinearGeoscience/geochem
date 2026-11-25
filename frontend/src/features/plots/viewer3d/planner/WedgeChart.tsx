/**
 * A wedge daughter's choices, drawn: at each kick-off depth down the parent
 * (every 5 m), the lift and drift that reach the target with a kick within
 * the maximum, nearest the parent's own rates. Depths that work are shaded;
 * the parent's rates are dashed lines and the limits dotted; the kick-off in
 * use is marked. Click a depth to use it.
 *
 * For a wedge no kick-off works for, it shows what each kick-off would need
 * (searched beyond the limits): red crosses where that is past the limits, so
 * it is plain which way, and how far, lift or drift would have to go.
 */
import React from 'react';
import Plot from '../../../../components/ThemedPlot';
import type { RateLimits, WedgeProfilePoint } from '../../../../utils/drillholePlan';

const LIFT = '#1e88e5', DRIFT = '#e65100', BEYOND = '#d32f2f';

export const WedgeChart: React.FC<{
    profile: WedgeProfilePoint[];
    parentRates: { lift: number; drift: number };
    limits: RateLimits;
    /** The kick-off in use, and the depths that work (none for a failing wedge) */
    kop?: number | null;
    ranges?: [number, number][];
    onPick?: (kop: number) => void;
}> = ({ profile, parentRates: parent, limits, kop = null, ranges = [], onPick }) => {
    // Points pinned at a limit (no answer within it) say nothing: only answers are drawn
    const p = profile.filter(x => x.feasible || x.beyond);
    if (p.length === 0) return null;
    const ok = p.filter(x => x.feasible);
    const outside = (key: 'lift' | 'drift', v: number) => (key === 'lift' ? v < limits.liftMin - 1e-9 || v > limits.liftMax + 1e-9 : v < limits.driftMin - 1e-9 || v > limits.driftMax + 1e-9);
    const series = (key: 'lift' | 'drift', color: string, name: string) => {
        const out: any[] = [];
        if (ok.length) out.push({
            type: 'scatter', mode: 'lines+markers', x: ok.map(x => x.kop), y: ok.map(x => x[key]), line: { color, width: 2 }, marker: { size: 4, color },
            name, hovertemplate: `${name} %{y:.2f} °/100 m at %{x} m<extra></extra>`,
        });
        const over = p.filter(x => x.beyond);
        if (over.length) out.push({
            type: 'scatter', mode: 'lines+markers', x: over.map(x => x.kop), y: over.map(x => x[key]),
            line: { color, width: 1.5, dash: 'dot' },
            marker: { size: 6, symbol: 'x-thin-open', color: over.map(x => (outside(key, x[key]) ? BEYOND : color)), line: { width: 1.5 } },
            name: `${name} needed`, hovertemplate: `${name} needed %{y:.2f} °/100 m at %{x} m<extra></extra>`,
        });
        return out;
    };
    const x0 = Math.min(...profile.map(x => x.kop)), x1 = Math.max(...profile.map(x => x.kop));
    // The y range holds the limits, the parent's rates and every answer
    const ys = [limits.liftMin, limits.liftMax, limits.driftMin, limits.driftMax, parent.lift, parent.drift, ...p.flatMap(x => [x.lift, x.drift])].filter(Number.isFinite);
    const yLo = Math.min(...ys) - 0.6, yHi = Math.max(...ys) + 0.6;
    const hline = (y: number, color: string, dash: string) => ({ type: 'line', xref: 'x', yref: 'y', x0, x1, y0: y, y1: y, line: { color, width: 1, dash } });
    const shapes: any[] = [
        ...ranges.map(([a, b]) => ({ type: 'rect', xref: 'x', yref: 'paper', x0: a - 2.5, x1: b + 2.5, y0: 0, y1: 1, fillcolor: 'rgba(76,175,80,0.12)', line: { width: 0 }, layer: 'below' })),
        hline(parent.lift, LIFT, 'dash'), hline(parent.drift, DRIFT, 'dash'),
        hline(limits.liftMax, LIFT, 'dot'), hline(limits.liftMin, LIFT, 'dot'), hline(limits.driftMax, DRIFT, 'dot'), hline(limits.driftMin, DRIFT, 'dot'),
        ...(kop !== null ? [{ type: 'line', xref: 'x', yref: 'paper', x0: kop, x1: kop, y0: 0, y1: 1, line: { color: '#424242', width: 2 } }] : []),
    ];
    return (
        <Plot
            data={[...series('lift', LIFT, 'Lift'), ...series('drift', DRIFT, 'Drift')] as any}
            layout={{
                height: 200, margin: { l: 38, r: 8, t: 26, b: 34 }, showlegend: true, legend: { orientation: 'h', x: 0, y: 1.2, font: { size: 10 } },
                xaxis: { title: { text: 'Kick-off depth on the parent (m)', font: { size: 10 } }, tickfont: { size: 9 } },
                yaxis: { title: { text: '°/100 m', font: { size: 10 } }, tickfont: { size: 9 }, range: [yLo, yHi], zeroline: false },
                shapes, hovermode: 'closest',
                // The kick-off's depth inside the plot, clear of the legend
                annotations: kop !== null ? [{ x: kop, y: 1, xref: 'x', yref: 'paper', xanchor: 'left', yanchor: 'top', xshift: 3, text: `${kop} m`, showarrow: false, font: { size: 10 } }] : [],
            } as any}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
            useResizeHandler
            onClick={(e: any) => {
                const x = Number(e?.points?.[0]?.x);
                if (!onPick || !Number.isFinite(x) || ok.length === 0) return;
                // The nearest depth that works
                onPick(ok.reduce((b, q) => (Math.abs(q.kop - x) < Math.abs(b.kop - x) ? q : b), ok[0]).kop);
            }}
        />
    );
};
