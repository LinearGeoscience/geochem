/**
 * Helpers for linked selection in aggregate plots (histogram, box, spider…).
 * Global selection always holds ORIGINAL dataset row indices.
 */

/** Highlight colour for selected samples in aggregate plots. */
export const SELECTION_COLOR = '#ff3d00';

export interface HistogramBins {
    start: number;
    end: number;
    size: number;
}

/**
 * Explicit bins for a set of values so Plotly's binning is deterministic and
 * shared by the base and selection-overlay traces (Plotly auto-binning of a
 * subset would otherwise produce different edges).
 */
export function explicitBins(values: ArrayLike<number>, binCount: number): HistogramBins | null {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (!Number.isFinite(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
    }
    if (!Number.isFinite(min)) return null;
    if (max === min) return { start: min - 0.5, end: max + 0.5, size: 1 };
    const n = Math.max(1, binCount);
    // Widen bins a hair so the maximum falls inside the last bin (not a new one)
    const size = ((max - min) / n) * (1 + 1e-9);
    return { start: min, end: min + size * n, size };
}

/** Bin number of `v` for the given bins (null when outside). */
export function binOf(v: number, bins: HistogramBins): number | null {
    if (!Number.isFinite(v) || v < bins.start || v >= bins.end) return null;
    return Math.floor((v - bins.start) / bins.size);
}

/**
 * Rows behind clicked/selected histogram bars. Plotly reports, per bar, the
 * indices into the trace's input array (`pointNumbers`); `traceRows[curve]`
 * maps those to original row indices (undefined for non-data traces).
 */
export function histogramPointRows(point: any, traceRows: (number[] | undefined)[]): number[] | null {
    const rows = traceRows[point?.curveNumber];
    if (!rows) return null;
    const nums: number[] = Array.isArray(point.pointNumbers)
        ? point.pointNumbers
        : typeof point.pointNumber === 'number' ? [point.pointNumber] : [];
    const out: number[] = [];
    for (const n of nums) {
        const r = rows[n];
        if (r !== undefined) out.push(r);
    }
    return out;
}

/** Original row index for a display (sampled) index. */
export function toOriginal(displayIndex: number, displayIndices: number[] | null | undefined): number {
    return displayIndices ? displayIndices[displayIndex] : displayIndex;
}

/** Tukey whisker bounds (1.5 × IQR, clipped to the data) for box-plot selection. */
export function whiskerBounds(values: number[]): { lo: number; hi: number } | null {
    const v = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (v.length === 0) return null;
    const q = (p: number) => {
        const pos = (v.length - 1) * p;
        const base = Math.floor(pos);
        const rest = pos - base;
        return v[base + 1] !== undefined ? v[base] + rest * (v[base + 1] - v[base]) : v[base];
    };
    const q1 = q(0.25), q3 = q(0.75), iqr = q3 - q1;
    const loFence = q1 - 1.5 * iqr, hiFence = q3 + 1.5 * iqr;
    let lo = Infinity, hi = -Infinity;
    for (const x of v) {
        if (x >= loFence && x < lo) lo = x;
        if (x <= hiFence && x > hi) hi = x;
    }
    return { lo, hi };
}
