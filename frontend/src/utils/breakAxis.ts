/**
 * Value axis of the class-break histogram (Attribute Manager): linear or
 * log10, its bins and its tick marks. Pure, so the scale choice and the
 * pixel <-> value mapping can be tested without a canvas.
 */
import type { ColumnData } from '../types/columnarData';
import { isNumericColumn } from '../types/columnarData';

export type AxisScale = 'linear' | 'log';

export interface BreakAxis {
    /** Axis ends in axis units (log10 of the value on a log axis) */
    a: number;
    b: number;
    span: number;
    useLog: boolean;
    /** A log axis is possible (some positive spread) */
    canLog: boolean;
    counts: Uint32Array;
    max: number;
    /** Finite values at or below zero: on a log axis they sit at the left edge */
    nonPositive: number;
}

/** Positive data over at least this many decades reads better on a log axis */
export const AUTO_LOG_DECADES = 2;

/** Scale to open with: log for all-positive data spanning two decades or more (assays), else linear */
export function autoScale(lo: number, hi: number): AxisScale {
    return lo > 0 && hi / lo >= 10 ** AUTO_LOG_DECADES ? 'log' : 'linear';
}

/**
 * Bins of a numeric column on the wanted scale (`null` = pick one from the
 * data). Falls back to linear when the data have no positive spread.
 */
export function buildBreakAxis(column: ColumnData | undefined, scale: AxisScale | null, bins: number): BreakAxis | null {
    if (!column || !isNumericColumn(column)) return null;
    let lo = Infinity, hi = -Infinity, minPos = Infinity, nonPositive = 0;
    for (let i = 0; i < column.length; i++) {
        const v = column[i];
        if (!Number.isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
        if (v > 0) { if (v < minPos) minPos = v; } else nonPositive++;
    }
    if (!Number.isFinite(lo)) return null;
    const canLog = Number.isFinite(minPos) && hi > minPos;
    const useLog = canLog && (scale ?? autoScale(lo, hi)) === 'log';
    const a = useLog ? Math.log10(minPos) : lo;
    const b = useLog ? Math.log10(hi) : hi;
    const span = b - a || 1;
    const counts = new Uint32Array(bins);
    for (let i = 0; i < column.length; i++) {
        const v = column[i];
        if (!Number.isFinite(v)) continue;
        const x = useLog ? (v > 0 ? Math.log10(v) : a) : v;
        counts[Math.min(bins - 1, Math.max(0, Math.floor(((x - a) / span) * bins)))]++;
    }
    let max = 0;
    for (const c of counts) if (c > max) max = c;
    return { a, b, span, useLog, canLog, counts, max, nonPositive };
}

/** Value -> 0..1 along the axis (values off a log axis clamp to its left edge) */
export function axisFraction(axis: BreakAxis, v: number): number {
    const x = axis.useLog ? (v > 0 ? Math.log10(v) : axis.a) : v;
    return (x - axis.a) / axis.span;
}

/** 0..1 along the axis -> value */
export function axisValue(axis: BreakAxis, fraction: number): number {
    const x = axis.a + Math.max(0, Math.min(1, fraction)) * axis.span;
    return axis.useLog ? 10 ** x : x;
}

/**
 * Tick values, at most `maxTicks`: decades on a log axis (with 2 and 5 when
 * under two decades show, every other decade when they crowd), round steps
 * on a linear one.
 */
export function axisTicks(axis: BreakAxis, maxTicks: number): number[] {
    const n = Math.max(2, Math.floor(maxTicks));
    const eps = axis.span * 1e-9;
    if (!axis.useLog) {
        const raw = axis.span / n;
        const mag = 10 ** Math.floor(Math.log10(raw));
        const step = ([1, 2, 5, 10].find(m => m * mag >= raw) ?? 10) * mag;
        const out: number[] = [];
        for (let k = Math.ceil((axis.a - eps) / step); k * step <= axis.b + eps; k++) {
            out.push(Number((k * step).toPrecision(12)));
        }
        return out;
    }
    const first = Math.ceil(axis.a - eps), last = Math.floor(axis.b + eps);
    const decades = last - first + 1;
    if (decades >= 2) {
        const every = Math.ceil(decades / n);
        const out: number[] = [];
        for (let d = first; d <= last; d += every) out.push(10 ** d);
        return out;
    }
    // Under two decades: 1-2-5 within each
    const out: number[] = [];
    for (let d = Math.floor(axis.a); d <= Math.ceil(axis.b); d++) {
        for (const m of [1, 2, 5]) {
            const x = Math.log10(m) + d;
            if (x >= axis.a - eps && x <= axis.b + eps) out.push(Number((m * 10 ** d).toPrecision(12)));
        }
    }
    return out.length > n ? out.filter((_, i) => i % Math.ceil(out.length / n) === 0) : out;
}
