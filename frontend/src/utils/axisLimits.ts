/**
 * Fixed axis limits saved with a plot ("locked" axes in the reference software): either bound may
 * be open (null), and the other end then autoscales. Values are in data units;
 * log axes get Plotly's log10 range.
 */
export type AxisLimits = [number | null, number | null];

export const hasLimits = (l: AxisLimits | null | undefined): l is AxisLimits =>
    !!l && (Number.isFinite(l[0] as number) || Number.isFinite(l[1] as number));

/**
 * Plotly axis props for the limits ({} when none). An open bound is filled
 * from the visible data's extent (with Plotly-like padding): Plotly's partial
 * autorange is not honoured by every build, so the range is always explicit.
 */
export function plotlyAxisRange(
    l: AxisLimits | null | undefined, log: boolean, extent?: [number, number] | null,
): { range?: number[]; autorange?: boolean } {
    if (!hasLimits(l)) return {};
    const conv = (v: number | null) => (v === null || !Number.isFinite(v) ? null : log ? (v > 0 ? Math.log10(v) : null) : v);
    let lo = conv(l[0]), hi = conv(l[1]);
    if (lo === null && hi === null) return {};
    if (lo === null || hi === null) {
        const e = extent ? [conv(extent[0]), conv(extent[1])] : [null, null];
        if (e[0] === null || e[1] === null) return {};
        const pad = ((e[1] as number) - (e[0] as number)) * 0.05 || 1;
        if (lo === null) lo = Math.min((e[0] as number) - pad, hi as number);
        if (hi === null) hi = Math.max((e[1] as number) + pad, lo as number);
    }
    return { range: [lo as number, hi as number], autorange: false };
}

/** Min / max of the finite (and, for log axes, positive) values. */
export function extentOf(values: ArrayLike<unknown>, log = false): [number, number] | null {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < values.length; i++) {
        const v = Number(values[i]);
        if (!Number.isFinite(v) || (log && v <= 0)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
    }
    return lo <= hi ? [lo, hi] : null;
}

const outside = (v: number, l: AxisLimits | null | undefined) =>
    !!l && ((l[0] !== null && v < l[0]) || (l[1] !== null && v > l[1]));

/** Points with finite x and y that fall outside the limits (drawn off the axes). */
export function countOutside(xs: ArrayLike<unknown>, ys: ArrayLike<unknown>, xl: AxisLimits | null | undefined, yl: AxisLimits | null | undefined): number {
    if (!hasLimits(xl) && !hasLimits(yl)) return 0;
    let n = 0;
    for (let i = 0; i < xs.length; i++) {
        const x = Number(xs[i]), y = Number(ys[i]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (outside(x, xl) || outside(y, yl)) n++;
    }
    return n;
}

/** Parse a text field: '' -> null (open bound). */
export const parseLimit = (s: string): number | null => {
    const t = s.trim();
    if (!t) return null;
    const v = Number(t);
    return Number.isFinite(v) ? v : null;
};
