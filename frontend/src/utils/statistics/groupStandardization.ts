/**
 * Standardise any numeric column within groups (rock type, regolith,
 * rock type x regolith), so values from different populations land on one
 * scale and several indicators can be averaged into an index.
 *
 * Methods, each computed within the row's group:
 *  - 'nscore': rank-based normal score Phi^-1((rank - 0.5) / n), ties given
 *    their average rank. Bounded (about +/-2.6 for 200 values) and never
 *    collapses, unlike a median/MAD z of a mostly-constant or mostly
 *    below-detection column (MAD = 0 gives z of 20 or more).
 *  - 'percentile': Hazen percentile 100 (rank - 0.5) / n, ties averaged.
 *  - 'robustz': (x - median) / s, s = 1.4826 MAD; when MAD is 0,
 *    IQR / 1.349; when that is 0 too, the standard deviation.
 *  - 'z': (x - mean) / SD (sample SD).
 *  The z methods can work on log10 values (values <= 0 are then left blank).
 *
 * Below-detection values (`censored`) are all "< limit": for the rank
 * methods they form one tied block at the bottom of their group (never ranked
 * among themselves); the z methods use the substituted value given.
 *
 * Rows outside `rowMask` (e.g. hidden) or outside `scope` take no part in any
 * distribution; out-of-scope rows get NaN or 0 as asked. Groups smaller than
 * `minGroupSize` are scored against all in-scope rows together ('global') or
 * left blank, and are listed.
 *
 * A baseline (per-group reference distribution) can be saved and used to
 * score a later batch on exactly the same scale.
 */
import { inverseNormalCDF } from '../probability';
import { averageRanks } from './correlation';
import { groupText } from '../groupLabels';

export type StandardizeMethod = 'nscore' | 'percentile' | 'robustz' | 'z';

export const STANDARDIZE_METHOD_TEXT: Record<StandardizeMethod, string> = {
    nscore: 'normal score Φ⁻¹((rank − 0.5)/n)',
    percentile: 'Hazen percentile',
    robustz: 'robust z (median, 1.4826 MAD; IQR/1.349 or SD when MAD is 0)',
    z: 'z-score (mean, SD)',
};

export const STANDARDIZE_SUFFIX: Record<StandardizeMethod, string> = { nscore: 'ns', percentile: 'pct', robustz: 'rz', z: 'z' };

export interface StandardizeOptions {
    method: StandardizeMethod;
    /** Group label per row (null = one group) */
    groups?: ArrayLike<unknown> | null;
    /** 1 = row takes part (e.g. visible); default all */
    rowMask?: ArrayLike<number> | null;
    /** 1 = in scope; rows out of scope are not scored */
    scope?: ArrayLike<number> | null;
    /** What out-of-scope rows get (default NaN) */
    outsideScope?: 'blank' | 'zero';
    /** Groups with fewer values than this: 'global' (whole in-scope set) or 'blank'. Default 10 / 'global'. */
    minGroupSize?: number;
    smallGroups?: 'global' | 'blank';
    /** z methods on log10 values */
    log10?: boolean;
    /** 1 = below detection */
    censored?: ArrayLike<number> | null;
}

export type SpreadKind = 'MAD' | 'IQR' | 'SD' | 'none';

export interface StandardizeGroupStat {
    group: string;
    n: number;
    nCensored: number;
    /** Scored against all in-scope rows (too few values) */
    usedGlobal: boolean;
    /** Left blank (too few values, and blanks asked for) */
    blanked: boolean;
    centre: number;
    spread: number;
    spreadKind: SpreadKind;
}

export interface StandardizeResult {
    values: Float64Array;
    groups: StandardizeGroupStat[];
    scored: number;
    /** Values <= 0 left out of a log10 z */
    nonPositive: number;
}

/** A group's reference distribution, enough to score new values on the same scale */
export interface BaselineGroup {
    group: string;
    n: number;
    nCensored: number;
    /** Measured values (ascending) and their cumulative probability within the group; thinned to <= 1001 points */
    values: number[];
    p: number[];
    centre: number;
    spread: number;
}

export interface ColumnBaseline {
    column: string;
    /** Group label '*' = all in-scope rows (used for groups the baseline does not have) */
    groups: BaselineGroup[];
}

export interface StandardizeBaseline {
    kind: 'geochem-standardization-baseline';
    version: 1;
    method: StandardizeMethod;
    log10: boolean;
    groupColumns: string[];
    created: string;
    columns: ColumnBaseline[];
}

export const ALL_GROUP = '*';

const sortedNumbers = (x: number[]) => Float64Array.from(x).sort();

/** Linear quantile of sorted values */
function quantile(sorted: Float64Array, p: number): number {
    const n = sorted.length;
    if (!n) return NaN;
    const h = (n - 1) * p;
    const lo = Math.floor(h);
    const hi = Math.min(n - 1, lo + 1);
    return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

/** Centre and spread for the z methods */
export function centreAndSpread(values: number[], method: 'robustz' | 'z'): { centre: number; spread: number; kind: SpreadKind } {
    const n = values.length;
    if (!n) return { centre: NaN, spread: NaN, kind: 'none' };
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const sd = n > 1 ? Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
    if (method === 'z') return { centre: mean, spread: sd, kind: sd > 0 ? 'SD' : 'none' };
    const s = sortedNumbers(values);
    const med = quantile(s, 0.5);
    const mad = quantile(sortedNumbers(values.map(v => Math.abs(v - med))), 0.5) * 1.4826;
    if (mad > 0) return { centre: med, spread: mad, kind: 'MAD' };
    const iqr = (quantile(s, 0.75) - quantile(s, 0.25)) / 1.349;
    if (iqr > 0) return { centre: med, spread: iqr, kind: 'IQR' };
    return { centre: med, spread: sd, kind: sd > 0 ? 'SD' : 'none' };
}

interface Members { rows: number[]; censored: number[]; measured: number[] }

/** Score the members of one distribution (rows) against itself */
function scoreAgainst(m: Members, x: Float64Array, method: StandardizeMethod, out: Float64Array, target?: Members) {
    const into = target ?? m;
    const nC = m.censored.length;
    const n = nC + m.measured.length;
    if (!n) return { centre: NaN, spread: NaN, kind: 'none' as SpreadKind };
    if (method === 'nscore' || method === 'percentile') {
        const f = method === 'nscore' ? (p: number) => inverseNormalCDF(p) : (p: number) => 100 * p;
        const blockP = (nC / 2) / n;                         // centre of the censored block: rank (nC + 1)/2
        if (!target) {
            for (const i of m.censored) out[i] = f(blockP);
            const ranks = averageRanks(m.measured.map(i => x[i]));
            m.measured.forEach((i, k) => { out[i] = f((nC + ranks[k] - 0.5) / n); });
        } else {
            // Score other rows against this distribution (Hazen position of each value)
            const sorted = Float64Array.from(m.measured, i => x[i]).sort();
            for (const i of into.censored) out[i] = f(blockP);
            for (const i of into.measured) out[i] = f(hazenWithin(sorted, nC, x[i]));
        }
        return { centre: NaN, spread: NaN, kind: 'none' as SpreadKind };
    }
    const vals = [...m.censored, ...m.measured].map(i => x[i]).filter(Number.isFinite);
    const cs = centreAndSpread(vals, method);
    for (const i of [...into.censored, ...into.measured]) {
        out[i] = !Number.isFinite(x[i]) ? NaN : cs.spread > 0 ? (x[i] - cs.centre) / cs.spread : 0;
    }
    return cs;
}

/** Hazen cumulative probability of v in a group of nC censored + sorted measured values (ties averaged) */
function hazenWithin(sorted: Float64Array, nC: number, v: number): number {
    const n = nC + sorted.length;
    let below = 0, equal = 0;
    for (let k = 0; k < sorted.length; k++) {
        if (sorted[k] < v) below++;
        else if (sorted[k] === v) equal++;
    }
    // Clamped to the outermost plotting positions: a value beyond the group's range is not certain
    return Math.min(1 - 0.5 / n, Math.max(0.5 / n, (nC + below + equal / 2) / n));
}

export function standardizeColumn(values: ArrayLike<number>, opts: StandardizeOptions): StandardizeResult {
    const n = values.length;
    const method = opts.method;
    const minSize = opts.minGroupSize ?? 10;
    const useLog = !!opts.log10 && (method === 'robustz' || method === 'z');
    const out = new Float64Array(n).fill(NaN);
    const x = new Float64Array(n).fill(NaN);
    let nonPositive = 0;
    const byGroup = new Map<string, Members>();
    const all: Members = { rows: [], censored: [], measured: [] };
    for (let i = 0; i < n; i++) {
        if (opts.rowMask && !opts.rowMask[i]) continue;
        if (opts.scope && !opts.scope[i]) {
            if (opts.outsideScope === 'zero') out[i] = 0;
            continue;
        }
        let v = values[i];
        if (!Number.isFinite(v)) continue;
        if (useLog) {
            if (!(v > 0)) { nonPositive++; continue; }
            v = Math.log10(v);
        }
        x[i] = v;
        const g = opts.groups ? groupText(opts.groups[i]) : ALL_GROUP;
        let m = byGroup.get(g);
        if (!m) byGroup.set(g, (m = { rows: [], censored: [], measured: [] }));
        const cens = !!opts.censored?.[i];
        for (const t of [m, all]) { t.rows.push(i); (cens ? t.censored : t.measured).push(i); }
    }
    const stats: StandardizeGroupStat[] = [];
    let scored = 0;
    for (const [group, m] of byGroup) {
        const small = m.rows.length < minSize;
        const stat: StandardizeGroupStat = {
            group, n: m.rows.length, nCensored: m.censored.length, usedGlobal: false, blanked: false,
            centre: NaN, spread: NaN, spreadKind: 'none',
        };
        if (small && (opts.smallGroups ?? 'global') === 'blank') {
            stat.blanked = true;
        } else if (small && byGroup.size > 1) {
            stat.usedGlobal = true;
            const cs = scoreAgainst(all, x, method, out, m);
            Object.assign(stat, { centre: cs.centre, spread: cs.spread, spreadKind: cs.kind });
            scored += m.rows.length;
        } else {
            const cs = scoreAgainst(m, x, method, out);
            Object.assign(stat, { centre: cs.centre, spread: cs.spread, spreadKind: cs.kind });
            scored += m.rows.length;
        }
        stats.push(stat);
    }
    stats.sort((a, b) => b.n - a.n || a.group.localeCompare(b.group));
    return { values: out, groups: stats, scored, nonPositive };
}

/** Equal-weight average of score columns: 'all' needs every component, 'available' averages those present */
export function compositeIndex(columns: ArrayLike<number>[], mode: 'all' | 'available' = 'available'): Float64Array {
    const n = columns.length ? columns[0].length : 0;
    const out = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i++) {
        let s = 0, c = 0, missing = false;
        for (const col of columns) {
            const v = col[i];
            if (Number.isFinite(v)) { s += v; c++; } else missing = true;
        }
        if (c && !(mode === 'all' && missing)) out[i] = s / c;
    }
    return out;
}

/** Thin ascending values + probabilities to at most `max` points (keeping both ends) */
function thin(values: number[], p: number[], max = 1001): { values: number[]; p: number[] } {
    if (values.length <= max) return { values, p };
    const idx = Array.from({ length: max }, (_, k) => Math.round((k * (values.length - 1)) / (max - 1)));
    return { values: idx.map(i => values[i]), p: idx.map(i => p[i]) };
}

function baselineGroupOf(group: string, members: Members, x: Float64Array, method: StandardizeMethod): BaselineGroup {
    const nC = members.censored.length;
    const n = nC + members.measured.length;
    const vals = members.measured.map(i => x[i]).sort((a, b) => a - b);
    const ranks = averageRanks(vals);
    const p = ranks.map(r => (nC + r - 0.5) / n);
    const cs = method === 'robustz' || method === 'z'
        ? centreAndSpread([...members.censored, ...members.measured].map(i => x[i]), method)
        : { centre: NaN, spread: NaN };
    const t = thin(vals, p);
    return { group, n, nCensored: nC, values: t.values, p: t.p, centre: cs.centre, spread: cs.spread };
}

/** The reference distribution of each group (and of all in-scope rows, as '*') for one column */
export function buildColumnBaseline(column: string, values: ArrayLike<number>, opts: StandardizeOptions): ColumnBaseline {
    const n = values.length;
    const useLog = !!opts.log10 && (opts.method === 'robustz' || opts.method === 'z');
    const x = new Float64Array(n).fill(NaN);
    const byGroup = new Map<string, Members>();
    const all: Members = { rows: [], censored: [], measured: [] };
    for (let i = 0; i < n; i++) {
        if ((opts.rowMask && !opts.rowMask[i]) || (opts.scope && !opts.scope[i])) continue;
        let v = values[i];
        if (!Number.isFinite(v) || (useLog && !(v > 0))) continue;
        if (useLog) v = Math.log10(v);
        x[i] = v;
        const g = opts.groups ? groupText(opts.groups[i]) : ALL_GROUP;
        let m = byGroup.get(g);
        if (!m) byGroup.set(g, (m = { rows: [], censored: [], measured: [] }));
        const cens = !!opts.censored?.[i];
        for (const t of [m, all]) { t.rows.push(i); (cens ? t.censored : t.measured).push(i); }
    }
    const groups = [...byGroup.entries()]
        .filter(([g, m]) => g !== ALL_GROUP && m.rows.length >= (opts.minGroupSize ?? 10))
        .map(([g, m]) => baselineGroupOf(g, m, x, opts.method));
    groups.push(baselineGroupOf(ALL_GROUP, all, x, opts.method));
    return { column, groups };
}

/** Cumulative probability of v in a baseline group (linear between stored points) */
export function baselineProbability(b: BaselineGroup, v: number, censored = false): number {
    if (!b.n) return NaN;
    if (censored) return (b.nCensored / 2) / b.n;
    const { values, p } = b;
    if (!values.length) return (b.nCensored / 2) / b.n;
    if (v < values[0]) return Math.max(b.nCensored / b.n, 0.5 / b.n);
    if (v > values[values.length - 1]) return 1 - 0.5 / b.n;
    // Equal to stored values: average probability of the tie
    let lo = 0, hi = values.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (values[mid] < v) lo = mid + 1; else hi = mid; }
    if (values[lo] === v) {
        let k = lo, s = 0, c = 0;
        while (k < values.length && values[k] === v) { s += p[k]; c++; k++; }
        return s / c;
    }
    const a = lo - 1;
    const t = (v - values[a]) / (values[lo] - values[a]);
    return p[a] + t * (p[lo] - p[a]);
}

/** Score new values on a saved baseline: each row against its group, or '*' when the baseline lacks the group */
export function scoreWithBaseline(values: ArrayLike<number>, baseline: ColumnBaseline, method: StandardizeMethod, opts: Pick<StandardizeOptions, 'groups' | 'censored' | 'log10' | 'rowMask' | 'scope' | 'outsideScope'> = {}): Float64Array {
    const byGroup = new Map(baseline.groups.map(g => [g.group, g]));
    const global = byGroup.get(ALL_GROUP) ?? null;
    const useLog = !!opts.log10 && (method === 'robustz' || method === 'z');
    const out = new Float64Array(values.length).fill(NaN);
    for (let i = 0; i < values.length; i++) {
        if (opts.rowMask && !opts.rowMask[i]) continue;
        if (opts.scope && !opts.scope[i]) { if (opts.outsideScope === 'zero') out[i] = 0; continue; }
        let v = values[i];
        if (!Number.isFinite(v)) continue;
        if (useLog) { if (!(v > 0)) continue; v = Math.log10(v); }
        const g = (opts.groups ? byGroup.get(groupText(opts.groups[i])) : undefined) ?? global;
        if (!g) continue;
        const cens = !!opts.censored?.[i];
        if (method === 'nscore') out[i] = inverseNormalCDF(baselineProbability(g, v, cens));
        else if (method === 'percentile') out[i] = 100 * baselineProbability(g, v, cens);
        else out[i] = g.spread > 0 ? (v - g.centre) / g.spread : 0;
    }
    return out;
}

/** Column name for a score: K_R -> K_R_ns */
export function standardizedColumnName(source: string, method: StandardizeMethod): string {
    return `${source}_${STANDARDIZE_SUFFIX[method]}`;
}

/** Read a baseline file (JSON); throws with a plain message when it is not one */
export function parseBaseline(text: string): StandardizeBaseline {
    let data: unknown;
    try { data = JSON.parse(text); } catch { throw new Error('Not a JSON file'); }
    const b = data as StandardizeBaseline;
    if (!b || b.kind !== 'geochem-standardization-baseline' || b.version !== 1 || !Array.isArray(b.columns)) {
        throw new Error('Not a standardisation baseline file');
    }
    if (!(['nscore', 'percentile', 'robustz', 'z'] as const).includes(b.method)) throw new Error(`Unknown method "${String(b.method)}"`);
    return b;
}
