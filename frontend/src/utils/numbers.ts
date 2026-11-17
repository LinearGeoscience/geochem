/**
 * A cell value as a number, or null when it is missing or not numeric.
 *
 * Row views hold `null` for missing numerics, and `Number(null)` is 0 — so a
 * bare `Number(row[col])` silently turns a missing assay into a real zero
 * (plotted on a ternary edge, classified into a diagram field, ...).
 */
export function finiteOrNull(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
}

/** Min and max of an array without spreading it (Math.min(...a) overflows the stack past ~125k items). */
export function minMax(values: ArrayLike<number>): [number, number] | null {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (!Number.isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
    }
    return lo <= hi ? [lo, hi] : null;
}
