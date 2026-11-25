/**
 * Values and summary statistics for box plots.
 *
 * Row objects carry a blank cell as null / '' / undefined, and Number(null)
 * and Number('') are 0: reading them with Number() turns every unassayed row
 * into a zero, inflating n and dragging Q1 and the median down. finiteNumber
 * keeps blanks blank (NaN); 0 and negative values are real values and stay.
 */

/** A cell as a number: NaN for blank (null, undefined, '', whitespace) or non-numeric. */
export function finiteNumber(v: unknown): number {
    if (v == null) return NaN;
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    if (typeof v === 'string') {
        if (!v.trim()) return NaN;
        const n = Number(v);
        return Number.isFinite(n) ? n : NaN;
    }
    return NaN;
}

/** Quantile of sorted values, linear between order statistics (Plotly's default quartile method). */
export function quantileSorted(sorted: ArrayLike<number>, p: number): number {
    const n = sorted.length;
    if (!n) return NaN;
    const h = (n - 1) * p;
    const lo = Math.floor(h);
    const hi = Math.min(n - 1, lo + 1);
    return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

export interface BoxSummary { count: number; min: number; q1: number; median: number; q3: number; max: number }

/** Summary of the finite values (null when there are none). */
export function boxSummary(values: ArrayLike<number>): BoxSummary | null {
    const sorted = Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    return {
        count: sorted.length,
        min: sorted[0],
        q1: quantileSorted(sorted, 0.25),
        median: quantileSorted(sorted, 0.5),
        q3: quantileSorted(sorted, 0.75),
        max: sorted[sorted.length - 1],
    };
}

/**
 * Finite values of `column` in `rows`, optionally only rows whose category
 * (cats[i], aligned with rows) equals `category`.
 */
export function columnValues(rows: ReadonlyArray<Record<string, unknown>>, column: string, cats?: ReadonlyArray<string>, category?: string): number[] {
    const out: number[] = [];
    for (let i = 0; i < rows.length; i++) {
        if (cats && category !== undefined && cats[i] !== category) continue;
        const v = finiteNumber(rows[i][column]);
        if (Number.isFinite(v)) out.push(v);
    }
    return out;
}
