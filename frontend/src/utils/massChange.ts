/**
 * Mass change by the single-precursor method (MacLean 1990; Grant's isocon
 * with one immobile monitor). An immobile element (Ti, Zr) cannot be added
 * or removed, so if it is more concentrated in an altered sample than in its
 * least-altered precursor, the rock lost mass (leaching); if less, it gained
 * mass (silica, carbonate, sulphide added).
 *
 *   enrichment factor f = monitor(precursor) / monitor(sample)
 *   mass change %       = 100 (f - 1)
 *   element change      = X(sample) f - X(precursor)     (ppm of the precursor mass)
 *
 * Each group (rock type) has its own precursor: the median of its chosen
 * least-altered samples. A precursor can be picked by a mask (a selection or
 * a flag column) or by a percentile rule: samples at or below the Pth
 * percentile of an alteration measure within their group, optionally also
 * below detection for another element (no sulphur, say). When the rule
 * leaves fewer than `minPrecursors`, the extra condition is dropped.
 */
import { medianOf, quantileLinear } from './statistics/random';

const key = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export interface PercentileRule {
    /** Alteration measure (e.g. log K/Ti): low = least altered */
    measure: ArrayLike<number>;
    percentile: number;
    /** Rows that must also be true (e.g. S below detection); dropped if too few remain */
    alsoRequire?: ArrayLike<number> | null;
    minPrecursors?: number;
}

/** Precursor rows (1) per group by the percentile rule */
export function precursorByPercentile(groups: ArrayLike<unknown> | null, rule: PercentileRule): Uint8Array {
    const n = rule.measure.length;
    const out = new Uint8Array(n);
    const byGroup = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
        if (!Number.isFinite(rule.measure[i])) continue;
        const g = groups ? key(groups[i]) : '';
        const l = byGroup.get(g);
        if (l) l.push(i); else byGroup.set(g, [i]);
    }
    const minN = rule.minPrecursors ?? 5;
    for (const rows of byGroup.values()) {
        const cut = quantileLinear(rows.map(i => rule.measure[i]), rule.percentile / 100);
        const low = rows.filter(i => rule.measure[i] <= cut);
        const strict = rule.alsoRequire ? low.filter(i => rule.alsoRequire![i]) : low;
        for (const i of strict.length >= minN ? strict : low) out[i] = 1;
    }
    return out;
}

export interface MassChangeInput {
    monitor: ArrayLike<number>;
    elements: Array<{ name: string; values: ArrayLike<number> }>;
    groups?: ArrayLike<unknown> | null;
    /** 1 = precursor (least altered) row */
    precursor: ArrayLike<number>;
}

export interface PrecursorSummary {
    group: string;
    n: number;
    monitor: number;
    medians: Record<string, number>;
}

export interface MassChangeResult {
    massChangePct: Float64Array;
    factor: Float64Array;
    /** Per element: change in ppm (of the precursor mass) */
    delta: Record<string, Float64Array>;
    precursors: PrecursorSummary[];
    /** Groups with no precursor rows (their samples are left blank) */
    groupsWithoutPrecursor: string[];
}

export function massChange(input: MassChangeInput): MassChangeResult {
    const n = input.monitor.length;
    const g = (i: number) => (input.groups ? key(input.groups[i]) : '');
    const byGroup = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
        const l = byGroup.get(g(i));
        if (l) l.push(i); else byGroup.set(g(i), [i]);
    }
    const massChangePct = new Float64Array(n).fill(NaN);
    const factor = new Float64Array(n).fill(NaN);
    const delta: Record<string, Float64Array> = {};
    for (const e of input.elements) delta[e.name] = new Float64Array(n).fill(NaN);
    const precursors: PrecursorSummary[] = [];
    const groupsWithoutPrecursor: string[] = [];

    for (const [group, rows] of byGroup) {
        const prec = rows.filter(i => input.precursor[i]);
        if (!prec.length) { groupsWithoutPrecursor.push(group); continue; }
        const mon = medianOf(prec.map(i => input.monitor[i]));
        const medians: Record<string, number> = {};
        for (const e of input.elements) medians[e.name] = medianOf(prec.map(i => e.values[i]));
        precursors.push({ group, n: prec.length, monitor: mon, medians });
        for (const i of rows) {
            const m = input.monitor[i];
            if (!(m > 0) || !(mon > 0)) continue;
            const f = mon / m;
            factor[i] = f;
            massChangePct[i] = 100 * (f - 1);
            for (const e of input.elements) {
                const x = e.values[i];
                if (Number.isFinite(x) && Number.isFinite(medians[e.name])) delta[e.name][i] = x * f - medians[e.name];
            }
        }
    }
    precursors.sort((a, b) => b.n - a.n);
    return { massChangePct, factor, delta, precursors, groupsWithoutPrecursor };
}
