/**
 * XY statistics for scatter panels ("Report Visible Statistics"):
 * n, Pearson r, R², least-squares slope and intercept, computed in the
 * plotted space (log10 of an axis when it is on a log scale).
 * Plus axis ranges for "Zoom to data" / "Zoom to data and origin".
 */

export interface XYStats {
    n: number;
    r: number;
    r2: number;
    slope: number;
    intercept: number;
}

export function xyStats(
    x: ArrayLike<number>,
    y: ArrayLike<number>,
    rows: Iterable<number>,
    opts: { logX?: boolean; logY?: boolean } = {},
): XYStats {
    let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (const i of rows) {
        let a = x[i], b = y[i];
        if (opts.logX) a = a > 0 ? Math.log10(a) : NaN;
        if (opts.logY) b = b > 0 ? Math.log10(b) : NaN;
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        n++; sx += a; sy += b; sxx += a * a; syy += b * b; sxy += a * b;
    }
    if (n < 2) return { n, r: NaN, r2: NaN, slope: NaN, intercept: NaN };
    const cxx = sxx - (sx * sx) / n;
    const cyy = syy - (sy * sy) / n;
    const cxy = sxy - (sx * sy) / n;
    const slope = cxx > 0 ? cxy / cxx : NaN;
    const r = cxx > 0 && cyy > 0 ? cxy / Math.sqrt(cxx * cyy) : NaN;
    return { n, r, r2: r * r, slope, intercept: (sy - slope * sx) / n };
}

/**
 * Axis range covering the values (5 % padding), optionally widened to
 * include 0. Log axes: Plotly ranges are in log10 units, zero is ignored.
 */
export function axisRange(values: ArrayLike<number>, rows: Iterable<number>, includeOrigin: boolean, log = false): [number, number] | null {
    let lo = Infinity, hi = -Infinity;
    for (const i of rows) {
        const v = values[i];
        if (!Number.isFinite(v) || (log && v <= 0)) continue;
        const t = log ? Math.log10(v) : v;
        if (t < lo) lo = t;
        if (t > hi) hi = t;
    }
    if (lo > hi) return null;
    if (includeOrigin && !log) {
        lo = Math.min(lo, 0);
        hi = Math.max(hi, 0);
    }
    const pad = (hi - lo || Math.abs(hi) || 1) * 0.05;
    return [includeOrigin && !log && lo === 0 ? 0 - pad * 0.2 : lo - pad, hi + pad];
}

const fmt = (v: number) => (Number.isFinite(v) ? +v.toPrecision(6) : '');

/** Rows for a statistics table / clipboard */
export function statsTable(rows: Array<{ x: string; y: string; group?: string; stats: XYStats }>): (string | number)[][] {
    return [
        ['X', 'Y', 'Group', 'n', 'r', 'R²', 'Slope', 'Intercept'],
        ...rows.map(r => [r.x, r.y, r.group ?? 'All visible', r.stats.n, fmt(r.stats.r), fmt(r.stats.r2), fmt(r.stats.slope), fmt(r.stats.intercept)]),
    ];
}
