/**
 * The 3D view's active slice drawn in 2D beside it (the drillhole planner's
 * "2D slice view"): true scale, no vertical exaggeration. The same plane the
 * holes are planned on; there is no other section.
 *
 * Shows the samples within the slice (coloured like the Section plot), the
 * existing hole traces, where the project's surfaces and wireframes cut it,
 * wireframe lines within it, and the planned holes projected onto it (parts
 * outside the slice faded). The selected hole's target can be dragged
 * (a Plotly shape: data points can't be dragged); a drag keeps it on the
 * plane. Upright slices only; a plan inset shows where the slice runs.
 */
import React, { useCallback, useMemo, useRef } from 'react';
import { Box, Paper, Typography } from '@mui/material';
import Plot from '../../../../components/ThemedPlot';
import { useAppStore, useAnalyticalStore } from '../../../../store/appStore';
import { useModelStore } from '../../../../store/modelStore';
import { useStyleInputs } from '../../../../hooks/useStyleInputs';
import { getStyleArraysColumnar, shapeToPlotlySymbol, applyOpacityToColor, getSortedIndices } from '../../../../utils/attributeUtils';
import { getPlotConfig } from '../../../../utils/plotConfig';
import { bearing, holeTraces, projectPoint, projectSection, type SectionLine } from '../../../../utils/sectionProjection';
import { planPoint, sectionStrings } from '../../../../utils/sectionWireframes';
import { uprightSection } from '../../../../utils/drillholePlanSlice';
import { sectionPlane } from '../../../model/section';
import { useSceneTraces } from '../../../model/useSceneTraces';
import { useWireframeFiles } from '../../../model/wireframeFiles';
import { usePlanStore } from './planStore';
import { optionOf } from '../../../../utils/drillholePlan';
import { OFF_SLICE, SliceLink, slicePlane, useActiveSlice } from './planSlice';
import type { Planner } from './usePlans';
import { PLAN_ERROR_COLOR } from './plannerLayer';

/** Samples drawn on the section at most (SVG: the browser also draws the 3D view) */
const MAX_SECTION_SAMPLES = 6000;
const SLICE_LINE = '#455a64';

export const PlannerSectionPane: React.FC<{ planner: Planner; height: number; link: SliceLink }> = ({ planner, height, link }) => {
    const slice = useActiveSlice(link);
    const selectedId = usePlanStore(s => s.selectedId);
    const getDisplayColumn = useAppStore(s => s.getDisplayColumn);
    const displayIndices = useAppStore(s => s._sampleIndicesArray);
    const rowCount = useAppStore(s => s.columnarData.rowCount);
    const styleInputs = useStyleInputs();
    const analytical = useAnalyticalStore();
    const { x: eastCol, y: northCol, z: elevCol, hole: holeCol, from: depthCol } = planner.columns;

    const sec = slice ? uprightSection(slicePlane(slice), slice.width) : null;
    const line: SectionLine | null = sec;

    // The style arrays and draw order: only when the data or its styles change (not on every slice step)
    const styled = useMemo(() => {
        void styleInputs; void analytical;
        if (!eastCol || !northCol || !elevCol || rowCount === 0) return null;
        const e = getDisplayColumn(eastCol), n = getDisplayColumn(northCol), z = getDisplayColumn(elevCol);
        if (!e || !n || !z) return null;
        const styles = getStyleArraysColumnar(e.length, name => getDisplayColumn(name), displayIndices ?? undefined);
        return { e, n, z, styles, order: getSortedIndices(styles) };
    }, [eastCol, northCol, elevCol, rowCount, getDisplayColumn, displayIndices, styleInputs, analytical]);
    const proj = useMemo(
        () => (styled && line ? projectSection(styled.e, styled.n, styled.z, line, styled.order) : null),
        [styled, line?.originE, line?.originN, line?.azimuth, line?.halfWidth], // eslint-disable-line react-hooks/exhaustive-deps
    );

    // Where the project's surfaces and wireframes cut the slice
    const plane = useMemo(() => (line ? sectionPlane(line.originE, line.originN, line.azimuth) : null), [line?.originE, line?.originN, line?.azimuth]); // eslint-disable-line react-hooks/exhaustive-deps
    const scene = useSceneTraces(plane, eastCol, northCol, elevCol || null);
    const sceneWires = useModelStore(s => s.scene.wireframes);
    const wireFiles = useWireframeFiles(s => s.byFile);

    const traces = useMemo(() => {
        const out: any[] = [];
        if (!line) return out;
        if (proj && styled) {
            const holes = holeCol ? getDisplayColumn(holeCol) : undefined;
            const depth = depthCol ? getDisplayColumn(depthCol) : undefined;
            if (holes) {
                const xs: (number | null)[] = [], ys: (number | null)[] = [];
                for (const t of holeTraces(proj, holes, depth)) { xs.push(...t.x, null); ys.push(...t.y, null); }
                if (xs.length) out.push({ type: 'scatter', mode: 'lines', x: xs, y: ys, line: { color: 'rgba(110,110,110,0.55)', width: 1 }, hoverinfo: 'skip', showlegend: false, connectgaps: false });
            }
            for (const t of scene.traces) {
                const xs: (number | null)[] = [], ys: (number | null)[] = [];
                for (const pts of t.lines) {
                    for (let i = 0; i < pts.length; i += 3) { xs.push(projectPoint(pts[i], pts[i + 1], line).along); ys.push(pts[i + 2]); }
                    xs.push(null); ys.push(null);
                }
                out.push({ type: 'scatter', mode: 'lines', x: xs, y: ys, line: { color: t.color, width: 2 }, name: t.name, hovertemplate: `${t.name}<extra></extra>`, showlegend: false, connectgaps: false });
            }
            for (const w of sceneWires) {
                const part = w.visible ? wireFiles[w.file]?.parts[w.part] : undefined;
                if (!part || part.lines.length === 0) continue;
                const cut = sectionStrings(part, line);
                if (cut.lineX.length) out.push({ type: 'scatter', mode: 'lines', x: cut.lineX, y: cut.lineY, line: { color: w.color, width: 1.5, dash: 'dot' }, hovertemplate: `${w.name}<extra></extra>`, showlegend: false, connectgaps: false });
            }
            const step = Math.max(1, Math.ceil(proj.rows.length / MAX_SECTION_SAMPLES));
            const ks = proj.rows.map((_, k) => k).filter(k => k % step === 0);
            const r = ks.map(k => proj.rows[k]);
            out.push({
                type: 'scatter', mode: 'markers', x: ks.map(k => proj.along[k]), y: ks.map(k => proj.elev[k]),
                hovertext: r.map(i => (holes ? `${holes[i]}${depth ? ` @ ${depth[i]}` : ''}` : '')), hoverinfo: 'text', showlegend: false,
                marker: {
                    size: r.map(i => styled.styles.sizes[i]), color: r.map(i => applyOpacityToColor(styled.styles.colors[i], styled.styles.opacity[i])),
                    symbol: r.map(i => shapeToPlotlySymbol(styled.styles.shapes[i])), line: { width: 0 },
                },
            });
        }
        // Planned holes on the slice: inside it solid, outside faded
        for (const { hole, result } of planner.holes) {
            if (!hole.visible) continue;
            const color = result.ok ? hole.style.color : PLAN_ERROR_COLOR;
            const selected = hole.id === selectedId;
            const t = result.trace;
            if (t) {
                const inX: (number | null)[] = [], inY: (number | null)[] = [], outX: (number | null)[] = [], outY: (number | null)[] = [];
                let prev: { s: number; z: number; inside: boolean } | null = null;
                // A wedge from its kick-off (the parent is drawn above it)
                const from = result.wedge ? result.wedge.kop - 1e-6 : -Infinity;
                for (let i = 0; i < t.depth.length; i++) {
                    if (t.depth[i] < from) continue;
                    const p = projectPoint(t.xyz[i * 3], t.xyz[i * 3 + 1], line);
                    const cur = { s: p.along, z: t.xyz[i * 3 + 2], inside: Math.abs(p.offset) <= line.halfWidth };
                    if (prev) {
                        const [xs, ys] = prev.inside && cur.inside ? [inX, inY] : [outX, outY];
                        if (xs.length === 0 || xs[xs.length - 1] !== prev.s || ys[ys.length - 1] !== prev.z) { xs.push(null, prev.s); ys.push(null, prev.z); }
                        xs.push(cur.s); ys.push(cur.z);
                    }
                    prev = cur;
                }
                const hover = `${hole.input.name}<extra></extra>`;
                if (outX.length) out.push({ type: 'scatter', mode: 'lines', x: outX, y: outY, line: { color, width: hole.style.width }, opacity: 0.3, hovertemplate: hover, showlegend: false, connectgaps: false });
                if (inX.length) out.push({ type: 'scatter', mode: 'lines', x: inX, y: inY, line: { color, width: hole.style.width + (selected ? 1.5 : 0) }, hovertemplate: hover, showlegend: false, connectgaps: false });
            }
            // Holes away from the slice are drawn faded and unnamed (the selected one is always named)
            const tp = result.target ? projectPoint(result.target[0], result.target[1], line) : null;
            const near = selected || (tp ? Math.abs(tp.offset) <= line.halfWidth : false);
            const top = result.wedge ? result.wedge.kopPoint : result.collar;
            if (top) {
                const p = projectPoint(top[0], top[1], line);
                const inside = Math.abs(p.offset) <= line.halfWidth;
                out.push({ type: 'scatter', mode: near || inside ? 'markers+text' : 'markers', x: [p.along], y: [top[2]], text: [result.wedge ? `${hole.input.name} @ ${Math.round(result.wedge.kop)} m` : hole.input.name], textposition: 'top center', textfont: { color, size: 11 },
                    marker: { size: 8, color, line: { color: '#fff', width: 1 } }, opacity: inside || selected ? 1 : 0.35, hovertemplate: `${hole.input.name} collar<extra></extra>`, showlegend: false, cliponaxis: false });
            }
            if (result.target && tp) {
                const p = tp;
                const off = Math.abs(p.offset) > OFF_SLICE;
                out.push({ type: 'scatter', mode: off && selected ? 'markers+text' : 'markers', x: [p.along], y: [result.target[2]],
                    text: off ? [`${Math.abs(p.offset).toFixed(1)} m off`] : undefined, textposition: 'bottom center', textfont: { color, size: 10 },
                    marker: { symbol: 'circle-open-dot', size: selected ? 16 : 13, color, line: { color, width: 2.5 } }, opacity: off ? 0.4 : 1,
                    hovertemplate: `${hole.input.name} target${off ? `: ${Math.abs(p.offset).toFixed(2)} m off the slice` : ''}<extra></extra>`, showlegend: false, cliponaxis: false });
            }
        }
        // Pads within the slice, named
        for (const set of planner.padSets) {
            if (!set.visible) continue;
            const xs: number[] = [], ys: number[] = [], names: string[] = [];
            for (const q of set.points) {
                const p = projectPoint(q.p[0], q.p[1], line);
                if (Math.abs(p.offset) > line.halfWidth) continue;
                xs.push(p.along); ys.push(q.p[2]); names.push(q.id);
            }
            if (xs.length) out.push({ type: 'scatter', mode: 'markers+text', x: xs, y: ys, text: names, textposition: 'top center', textfont: { color: set.color, size: 9 },
                marker: { symbol: 'triangle-up', size: 9, color: set.color, line: { color: '#fff', width: 1 } }, hovertemplate: '%{text}<extra>' + set.name + '</extra>', showlegend: false, cliponaxis: false });
        }
        // Plan inset: samples grey, planned holes, and the slice's line across the data
        if (styled) {
            const { e, n, order } = styled;
            const step = Math.max(1, Math.ceil(order.length / 3000));
            const pe: number[] = [], pn: number[] = [];
            for (let k = 0; k < order.length; k += step) { pe.push(Number(e[order[k]])); pn.push(Number(n[order[k]])); }
            out.push({ type: 'scatter', mode: 'markers', x: pe, y: pn, xaxis: 'x2', yaxis: 'y2', marker: { size: 3, color: 'rgba(150,150,150,0.5)' }, hoverinfo: 'skip', showlegend: false });
        }
        for (const { hole, result } of planner.holes) {
            if (!hole.visible || !result.trace) continue;
            const t = result.trace;
            const xs: number[] = [], ys: number[] = [];
            for (let i = 0; i < t.depth.length; i += 5) { xs.push(t.xyz[i * 3]); ys.push(t.xyz[i * 3 + 1]); }
            xs.push(t.xyz[t.xyz.length - 3]); ys.push(t.xyz[t.xyz.length - 2]);
            out.push({ type: 'scatter', mode: 'lines', x: xs, y: ys, xaxis: 'x2', yaxis: 'y2', line: { color: hole.style.color, width: 2 }, hoverinfo: 'skip', showlegend: false });
        }
        const b = planner.dataBounds;
        const half = b ? Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1]) / 2 : 500;
        const a0 = planPoint(line, -half), a1 = planPoint(line, half);
        out.push({ type: 'scatter', mode: 'lines', x: [a0[0], a1[0]], y: [a0[1], a1[1]], xaxis: 'x2', yaxis: 'y2', line: { color: SLICE_LINE, width: 2 }, hoverinfo: 'skip', showlegend: false });
        return out;
    }, [line?.originE, line?.originN, line?.azimuth, line?.halfWidth, proj, styled, scene.traces, sceneWires, wireFiles, planner.holes, planner.dataBounds, selectedId, holeCol, depthCol, getDisplayColumn]); // eslint-disable-line react-hooks/exhaustive-deps

    // The selected hole's target, as a draggable shape
    const selected = planner.holes.find(h => h.hole.id === selectedId) ?? null;
    const dragTarget = selected && optionOf(selected.hole.input) !== 'collar' && selected.result.target && line
        ? { along: projectPoint(selected.result.target[0], selected.result.target[1], line).along, rl: selected.result.target[2] } : null;

    // One store update per animation frame
    const pending = useRef<(() => void) | null>(null);
    const queue = useCallback((f: () => void) => {
        const first = !pending.current;
        pending.current = f;
        if (first) requestAnimationFrame(() => { const run = pending.current; pending.current = null; run?.(); });
    }, []);

    const onRelayout = useCallback((ev: any) => {
        if (!ev || !line || !dragTarget || !selectedId) return;
        const shape = Array.isArray(ev.shapes) ? ev.shapes[0] : null;
        const xa = shape ? shape.xanchor : ev['shapes[0].xanchor'];
        const ya = shape ? shape.yanchor : ev['shapes[0].yanchor'];
        if (xa === undefined && ya === undefined) return;
        const along = xa !== undefined && Number.isFinite(Number(xa)) ? Number(xa) : dragTarget.along;
        const rl = ya !== undefined && Number.isFinite(Number(ya)) ? Number(ya) : dragTarget.rl;
        // On the slice plane: its place along the slice and its RL
        const [e, n] = planPoint(line, along);
        queue(() => usePlanStore.getState().updateHole(selectedId, { target: { e, n, rl } }));
    }, [queue, line?.originE, line?.originN, line?.azimuth, dragTarget?.along, dragTarget?.rl, selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!slice || !sec || !line) {
        return (
            <Paper variant="outlined" sx={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }} data-testid="planner-section">
                <Typography variant="body2" color="text.secondary">
                    {!slice ? 'Turn on a 3D slice: the 2D view shows the slice holes are planned on.' : 'The 2D view shows upright slices (sections). This slice is level or leaning.'}
                </Typography>
            </Paper>
        );
    }

    const shapes: any[] = dragTarget ? [{
        type: 'circle', xref: 'x', yref: 'y', xsizemode: 'pixel', ysizemode: 'pixel', xanchor: dragTarget.along, yanchor: dragTarget.rl,
        x0: -11, x1: 11, y0: -11, y1: 11, line: { color: selected!.hole.style.color, width: 2 }, fillcolor: 'rgba(255,255,255,0.15)',
    }] : [];
    const count = proj?.rows.length ?? 0;
    // Framed on the selected hole (collar to end of hole, with room either side); the elevation follows at true scale
    const frame = (() => {
        const t = selected?.result.trace;
        if (!t) return null;
        let lo = Infinity, hi = -Infinity;
        for (let i = 0; i < t.depth.length; i += 5) {
            const s = projectPoint(t.xyz[i * 3], t.xyz[i * 3 + 1], line).along;
            lo = Math.min(lo, s); hi = Math.max(hi, s);
        }
        const pad = Math.max(150, (hi - lo) * 0.5);
        return Number.isFinite(lo) ? [lo - pad, hi + pad] as [number, number] : null;
    })();
    const layout: any = {
        title: { text: `Slice ${bearing(sec.azimuth)} · ${+slice.width.toFixed(1)} m wide · ${count.toLocaleString()} samples`, font: { size: 13 }, x: 0, xanchor: 'left' },
        autosize: true, height: height - 8, hovermode: 'closest', showlegend: false, dragmode: 'pan',
        margin: { l: 60, r: 16, t: 40, b: 46 },
        xaxis: { title: { text: `Along the slice (m), towards ${bearing(sec.azimuth)}`, font: { size: 11 } }, domain: [0, 0.72], zeroline: false, ...(frame ? { range: frame } : {}) },
        // True scale: no vertical exaggeration in the planner
        yaxis: { title: { text: 'RL (m)', font: { size: 11 } }, scaleanchor: 'x', scaleratio: 1 },
        xaxis2: { domain: [0.76, 1], anchor: 'y2', showticklabels: false, zeroline: false, title: { text: 'Plan', font: { size: 10 } }, uirevision: 'planner-plan' },
        yaxis2: { domain: [0.6, 1], anchor: 'x2', showticklabels: false, scaleanchor: 'x2', scaleratio: 1, zeroline: false, uirevision: 'planner-plan' },
        shapes,
        // Keeps its zoom while the slice steps (along the same line) and while a target is dragged; turning the slice re-fits
        uirevision: `${Math.round(sec.azimuth * 100)}|${selectedId ?? ''}`,
        editrevision: `${sec.originE}|${sec.originN}|${sec.azimuth}|${dragTarget?.along ?? ''}|${dragTarget?.rl ?? ''}`,
    };

    return (
        <Paper variant="outlined" sx={{ height, overflow: 'hidden' }} data-testid="planner-section">
            <Box sx={{ width: '100%', height: '100%' }}>
                <Plot
                    data={traces} layout={layout} style={{ width: '100%', height: '100%' }} useResizeHandler
                    config={{ ...getPlotConfig({ filename: `slice_${bearing(sec.azimuth).replace('°', '')}` }), edits: { shapePosition: true } }}
                    onRelayout={onRelayout}
                />
            </Box>
        </Paper>
    );
};
