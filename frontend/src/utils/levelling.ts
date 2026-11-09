/**
 * Levelling: put surveys / protocols / media on one scale by scoring every
 * value against its own group, so a whole-area map can combine them.
 *
 * Works on RAW stored values (-DL convention) so that below-detection
 * results are known exactly, with the group's limit from groupDl.ts (shown,
 * or read from a floor). A value is "censored" when it is marked below
 * detection (-DL, a clear-cut ½DL value) or measured below the group's limit.
 *
 *  - 'percentile' (default): rank within the group, 0-100, ties averaged
 *    (Hazen). All censored values form ONE tied block at the bottom —
 *    never ranked among themselves (they are all "< limit").
 *  - 'zlog': (log10 v - median) / s, s = (log P75 - log P50) / 0.6745, the
 *    upper-half spread: unaffected by censoring below the median. Refused
 *    (blank + flag) when half or more of the group is censored. Censored
 *    values get the score of their limit (an upper bound).
 *
 * Groups are never silently pooled with the whole dataset:
 *  - 'too-few': fewer than minGroupSize values -> blank
 *  - 'uninformative': >= informativeAt % censored -> the anomaly range lies
 *    below detection -> blank
 *  - 'censored-heavy' (zlog only), 'mixed-dl' and 'limit-unknown' (warnings)
 *
 * Caveat (shown with the results): levelling also removes REAL differences
 * between groups — a survey sitting over a mineralised area has the same top
 * 5 % as one over barren ground. The overlap check tests this where groups
 * share ground.
 */
import { percentileOf } from './statistics/anomalyRanking';
import { groupText } from './groupLabels';
import { cellLimit, groupDetectionLimits, halfDlGroupOf, hasValue, maxPositive, type FloorReading, type HalfDlRule } from './groupDl';

export type LevelMethod = 'percentile' | 'zlog';
export type LevelFlag = 'too-few' | 'uninformative' | 'censored-heavy' | 'mixed-dl' | 'limit-unknown';

/** Flags that leave the group blank */
export const BLANKING_FLAGS: LevelFlag[] = ['too-few', 'uninformative', 'censored-heavy'];

export const FLAG_TEXT: Record<LevelFlag, string> = {
    'too-few': 'too few values',
    uninformative: 'mostly below detection',
    'censored-heavy': 'half or more below detection (z needs the median)',
    'mixed-dl': 'several limits: all below the coarsest are tied',
    'limit-unknown': 'limit not shown in the data',
};

export interface LevelGroupStat {
    group: string;
    nValues: number;
    nCensored: number;
    /** Limit used for the censored block (null = none shown or assumed) */
    limit: number | null;
    /** Quantiles in original units; null = falls in the censored block (< limit) */
    median: number | null;
    p90: number | null;
    p95: number | null;
    p98: number | null;
    flags: LevelFlag[];
    /** Values were scored (not blanked) */
    levelled: boolean;
}

export interface LevelResult {
    values: Float64Array;
    groups: LevelGroupStat[];
    /** Values scored / left blank */
    scored: number;
    blanked: number;
}

export interface LevelOptions {
    method?: LevelMethod;
    minGroupSize?: number;
    /** % censored at or above which a group is uninformative (default 90) */
    informativeAt?: number;
    /** Group -> pooled label, to treat groups judged equivalent as one */
    pool?: Map<string, string>;
    halfDl?: HalfDlRule[];
    /** Batch groups the ½-DL rules were found in (default: the level groups) */
    halfDlGroups?: ArrayLike<unknown>;
    floorAs?: FloorReading;
}

const lt = (v: number, limit: number) => v < limit * (1 - 1e-9);

/** Hazen quantile of a group in original units; null inside the censored block */
function quantile(sortedMeasured: Float64Array, nCensored: number, q: number): number | null {
    const n = sortedMeasured.length + nCensored;
    const pos = q * n - 0.5;               // Hazen: rank r has p = (r + 0.5) / n
    if (pos < nCensored) return null;
    const k = pos - nCensored;
    const lo = Math.floor(k), hi = Math.min(lo + 1, sortedMeasured.length - 1);
    const t = k - lo;
    return sortedMeasured[Math.min(lo, sortedMeasured.length - 1)] * (1 - t) + sortedMeasured[hi] * t;
}

export function levelColumn(raw: ArrayLike<number>, groups: ArrayLike<unknown>, opts: LevelOptions = {}): LevelResult {
    const method = opts.method ?? 'percentile';
    const minGroupSize = opts.minGroupSize ?? 30;
    const informativeAt = opts.informativeAt ?? 90;
    const n = raw.length;
    const label = (i: number) => { const g = groupText(groups[i]); return opts.pool?.get(g) ?? g; };
    const labels = Array.from({ length: n }, (_, i) => label(i));
    const halfDl = opts.halfDl ?? [];
    const halfDlGroups = opts.halfDlGroups ?? groups;
    const limits = new Map(groupDetectionLimits(raw, labels, { halfDl, halfDlGroups, floorAs: opts.floorAs }).map(s => [s.group, s]));
    const maxPos = maxPositive(raw);

    // Split each group into censored rows and measured values
    const rowsOf = new Map<string, { censored: number[]; measured: number[] }>();
    for (let i = 0; i < n; i++) {
        const v = raw[i];
        if (!hasValue(v, maxPos)) continue;
        const g = labels[i];
        let r = rowsOf.get(g);
        if (!r) rowsOf.set(g, (r = { censored: [], measured: [] }));
        const lim = limits.get(g)?.assumedDl ?? null;
        const dl = cellLimit(v, halfDl, halfDlGroupOf(halfDlGroups, i), maxPos);
        if (dl !== null || (lim !== null && lt(v, lim))) r.censored.push(i);
        else r.measured.push(i);
    }

    const out = new Float64Array(n).fill(NaN);
    const stats: LevelGroupStat[] = [];
    let scored = 0, blanked = 0;
    for (const [group, r] of rowsOf) {
        const lim = limits.get(group)!;
        const nC = r.censored.length;
        const nV = nC + r.measured.length;
        const sorted = Float64Array.from(r.measured, i => raw[i]).sort();
        const flags: LevelFlag[] = [];
        if (nV < minGroupSize) flags.push('too-few');
        if (nC > 0 && (100 * nC) / nV >= informativeAt) flags.push('uninformative');
        if (method === 'zlog' && nC >= nV / 2) flags.push('censored-heavy');
        if (lim.mixed) flags.push('mixed-dl');
        if (lim.assumedDl === null && nC === 0) flags.push('limit-unknown');
        const blank = flags.some(f => BLANKING_FLAGS.includes(f));
        const stat: LevelGroupStat = {
            group, nValues: nV, nCensored: nC, limit: lim.assumedDl,
            median: quantile(sorted, nC, 0.5), p90: quantile(sorted, nC, 0.9), p95: quantile(sorted, nC, 0.95), p98: quantile(sorted, nC, 0.98),
            flags, levelled: !blank,
        };
        stats.push(stat);
        if (blank) { blanked += nV; continue; }
        scored += nV;
        if (method === 'percentile') {
            const block = (100 * (nC / 2)) / nV;
            for (const i of r.censored) out[i] = block;
            // Measured values rank above the whole censored block
            for (const i of r.measured) out[i] = (100 * nC + percentileOf(sorted, raw[i]) * sorted.length) / nV;
        } else {
            const p50 = quantile(sorted, nC, 0.5)!;
            const p75 = quantile(sorted, nC, 0.75)!;
            const s = (Math.log10(p75) - Math.log10(p50)) / 0.6745;
            if (!(s > 0) || !(p50 > 0)) {
                stat.flags.push('censored-heavy'); stat.levelled = false; scored -= nV; blanked += nV;
                continue;
            }
            const z = (v: number) => (Math.log10(v) - Math.log10(p50)) / s;
            for (const i of r.measured) out[i] = z(raw[i]);
            // Censored: the score of the limit (or of the value's own limit), an upper bound
            for (const i of r.censored) {
                const own = cellLimit(raw[i], halfDl, halfDlGroupOf(halfDlGroups, i), maxPos);
                out[i] = z(own ?? stat.limit ?? Math.abs(raw[i]));
            }
        }
    }
    stats.sort((a, b) => b.nValues - a.nValues || a.group.localeCompare(b.group));
    return { values: out, groups: stats, scored, blanked };
}

/** Column name for a levelled result: Cu_ppm -> Cu_ppm_lvl (percentile) / Cu_ppm_lvlz (z) */
export function levelledColumnName(source: string, method: LevelMethod): string {
    return `${source}_${method === 'percentile' ? 'lvl' : 'lvlz'}`;
}

/** Percentile classes for maps of levelled values */
export const LEVEL_BREAKS = [50, 75, 90, 95, 98];
