/**
 * Normal probability plot helpers (Probability plot / Split Probability).
 * Points are plotted at normal scores of their plotting position, so a
 * log-normal population is a straight line on a log value axis; breaks in
 * slope separate populations (background, anomalous, below detection).
 */

/** Inverse standard normal CDF (Acklam's rational approximation, |error| < 1.2e-9). */
export function inverseNormalCDF(p: number): number {
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    const lo = 0.02425;
    if (p < lo) {
        const q = Math.sqrt(-2 * Math.log(p));
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > 1 - lo) {
        const q = Math.sqrt(-2 * Math.log(1 - p));
        return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    const q = p - 0.5;
    const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Cumulative probability (0-1) of the i-th of n sorted values (Hazen: (i + 0.5) / n). */
export const plottingPosition = (i: number, n: number) => (i + 0.5) / n;

/** Probability-axis ticks (%) placed at their normal scores */
export const PROBABILITY_TICKS = [0.1, 1, 2, 5, 10, 20, 30, 50, 70, 80, 90, 95, 98, 99, 99.9];

export function probabilityAxisTicks(): { tickvals: number[]; ticktext: string[] } {
    return {
        tickvals: PROBABILITY_TICKS.map(p => inverseNormalCDF(p / 100)),
        ticktext: PROBABILITY_TICKS.map(p => String(p)),
    };
}

export interface ProbabilityPoint { row: number; value: number; nscore: number; percent: number }

/**
 * Sort (row, value) pairs and attach normal scores. Non-finite values are
 * dropped; with `log`, so are values <= 0.
 */
export function probabilityPoints(rows: number[], values: ArrayLike<number>, log = false): ProbabilityPoint[] {
    const pts: { row: number; value: number }[] = [];
    for (const r of rows) {
        const v = values[r];
        if (!Number.isFinite(v) || (log && v <= 0)) continue;
        pts.push({ row: r, value: v });
    }
    pts.sort((a, b) => a.value - b.value);
    const n = pts.length;
    return pts.map((p, i) => {
        const pp = plottingPosition(i, n);
        return { ...p, nscore: inverseNormalCDF(pp), percent: pp * 100 };
    });
}

/**
 * Split Probability: rows grouped by a key (the colour group), each group
 * ranked on its own. Groups keep first-seen order.
 */
export function splitProbability(
    rows: number[],
    values: ArrayLike<number>,
    groupOf: (row: number) => string,
    log = false,
): Array<{ group: string; points: ProbabilityPoint[] }> {
    const groups = new Map<string, number[]>();
    for (const r of rows) {
        const g = groupOf(r);
        const list = groups.get(g);
        if (list) list.push(r); else groups.set(g, [r]);
    }
    return [...groups].map(([group, rs]) => ({ group, points: probabilityPoints(rs, values, log) }))
        .filter(g => g.points.length > 0);
}
