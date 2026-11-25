/**
 * Plot geometry for Population Separation: the histogram values, each
 * population's density curve scaled to the histogram, and the threshold
 * lines. A log-scale fit is drawn on a log10 axis (the space it was fitted
 * in) with tick labels in data units, so the curves match the bars.
 */
import type { PopulationSeparationResult } from '../../types/statistics';

export interface PopulationPlot {
    /** Values for the histogram, in plot units (log10 for a log-scale fit) */
    values: number[];
    curves: { x: number[]; y: number[] }[];
    /** Threshold positions, in plot units */
    thresholds: number[];
    log: boolean;
    ticks?: { tickvals: number[]; ticktext: string[] };
}

const normalPDF = (x: number, mean: number, std: number): number => {
    if (!(std > 0)) return 0;
    const z = (x - mean) / std;
    return Math.exp(-0.5 * z * z) / (std * Math.sqrt(2 * Math.PI));
};

function fmtTick(v: number): string {
    if (v >= 1e5 || v < 1e-3) return v.toExponential(0).replace('e+', 'e');
    return String(Number(v.toPrecision(3)));
}

/** Ticks at 1-2-5 steps per decade (decades only over a wide range), labelled in data units. */
export function logAxisTicks(lo: number, hi: number): { tickvals: number[]; ticktext: string[] } {
    const steps = hi - lo > 4 ? [1] : [1, 2, 5];
    const tickvals: number[] = [];
    const ticktext: string[] = [];
    for (let d = Math.floor(lo); d <= Math.ceil(hi); d++) {
        for (const m of steps) {
            const u = d + Math.log10(m);
            if (u < lo - 1e-9 || u > hi + 1e-9) continue;
            tickvals.push(u);
            ticktext.push(fmtTick(m * 10 ** d));
        }
    }
    return { tickvals, ticktext };
}

export function populationPlot(result: PopulationSeparationResult, values: number[], nBins = 40, nPoints = 200): PopulationPlot {
    const log = !!result.logScale;
    const plotValues = log ? values.filter(v => v > 0).map(v => Math.log10(v)) : values.slice();
    const thresholds = log ? result.separationPoints.filter(t => t > 0).map(t => Math.log10(t)) : result.separationPoints.slice();
    if (!plotValues.length || !result.populations.length) return { values: plotValues, curves: [], thresholds, log };

    let min = Infinity, max = -Infinity;
    for (const v of plotValues) { if (v < min) min = v; if (v > max) max = v; }
    const range = max - min || 1;
    const binWidth = range / nBins;
    const x = Array.from({ length: nPoints }, (_, i) => min - range * 0.05 + (range * 1.1) * i / (nPoints - 1));
    const n = plotValues.length;
    const curves = result.populations.map(pop => {
        const m = log ? pop.logMean : pop.mean;
        const s = log ? pop.logStd : pop.stdDev;
        if (m === undefined || s === undefined) return { x: [], y: [] };
        return { x, y: x.map(u => pop.proportion * normalPDF(u, m, s) * binWidth * n) };
    });
    return { values: plotValues, curves, thresholds, log, ...(log ? { ticks: logAxisTicks(min - range * 0.05, max + range * 0.05) } : {}) };
}
