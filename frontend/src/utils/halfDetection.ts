/**
 * Below-detection values supplied as HALF the detection limit ("<10" -> 5,
 * "<0.5" -> 0.25), a common database export. Left as they are, 5 reads as a
 * real 5 ppm: the BDL factor never applies, probability plots show a false
 * step, and CLR / PCA see a false population.
 *
 * Detection (per column, optionally per assay-protocol group) — evidence is
 * reported, never applied silently:
 *  - candidate h: 2h is a laboratory detection limit (mantissa 1, 2 or 5)
 *  - spike: h is far more frequent than the values just above it
 *  - gap: measured values start AT the limit 2h, so (h, 2h) is near-empty.
 *    Only meaningful when the interval holds several steps of the column's
 *    reporting resolution; otherwise the spike must sit off that grid
 *    (0.025 among values reported to 0.01) to count.
 *  - real values exist just above the limit (not a constant column)
 *  - chain: when 0.5 -> <1 is found, 1 is that limit (results AT the limit),
 *    not 1/2 of 2, so a spike equal to another spike's limit is only 'medium'
 * The reporting step is the coarsest lab step that >= 90 % of the values near
 * the limit sit on: a few finer values from another lab do not make the gap
 * look testable.
 * A column that already holds negatives uses the -DL convention and is skipped.
 */
import { isMissingCode } from './censoring';

export type HalfDlConfidence = 'high' | 'medium';

export interface HalfDlSpike {
    /** The value found (½ DL) */
    value: number;
    /** Implied detection limit (2 × value) */
    dl: number;
    count: number;
    /** Values strictly between value and dl, as a share of count */
    gapShare: number;
    /** The interval (value, dl) could be tested at the column's resolution */
    gapTestable: boolean;
    /** The value is finer than the column's reporting resolution */
    offGrid: boolean;
    confidence: HalfDlConfidence;
    /** Group (assay protocol) the spike was found in; null = whole column */
    group: string | null;
    /** The value is itself the limit of this smaller half-DL value (0.5 -> <1 makes 1 suspect) */
    chainOf?: number;
}

export interface HalfDlOptions {
    /** Minimum rows at the spike value (default max(10, 0.5 % of values)) */
    minCount?: number;
    /** Spike must be this many times the typical count just above it */
    spikeRatio?: number;
    /** gapShare at or below = high confidence */
    highGap?: number;
    /** gapShare at or below = medium confidence (above: not reported) */
    mediumGap?: number;
}

const DEFAULTS = { spikeRatio: 5, highGap: 0.05, mediumGap: 0.3 };
const key = (v: number) => Number(v.toPrecision(12));

/** Is d a laboratory detection limit value: 1, 2 or 5 × 10^k? */
export function isLabLimit(d: number): boolean {
    if (!(d > 0) || !Number.isFinite(d)) return false;
    const m = d / 10 ** Math.floor(Math.log10(d) + 1e-12);
    return [1, 2, 5, 10].some(x => Math.abs(m - x) < 1e-9 * x);
}

/** Is v a whole multiple of q (within float noise)? */
function onGrid(v: number, q: number): boolean {
    const r = v / q;
    return Math.abs(r - Math.round(r)) < 1e-6;
}

/**
 * Reporting step of a set of values: the coarsest 1/2/5 x 10^k step that at
 * least `share` of the (count-weighted) values are whole multiples of.
 * Null when there are too few distinct values to tell.
 */
export function reportingStep(values: number[], counts: Map<number, number>, share = 0.9): number | null {
    if (values.length < 5) return null;
    let total = 0;
    for (const v of values) total += counts.get(v)!;
    const top = Math.floor(Math.log10(Math.max(...values)));
    for (let k = top; k >= top - 12; k--) {
        for (const m of [5, 2, 1]) {
            const q = key(m * 10 ** k);
            let on = 0;
            for (const v of values) if (onGrid(v, q)) on += counts.get(v)!;
            if (on >= share * total) return q;
        }
    }
    return null;
}

/**
 * Chain rule: a spike whose value is the limit of another (smaller, clear-cut)
 * spike in the same scope is as likely results AT that limit as 1/2 of the
 * next one: it is kept as 'medium' (reviewed, not converted by default).
 */
export function markChains(spikes: HalfDlSpike[]): HalfDlSpike[] {
    return spikes.map(s => {
        const base = spikes.find(t => t !== s && t.confidence === 'high' && key(t.dl) === key(s.value) && t.group === s.group);
        return base ? { ...s, confidence: 'medium' as const, chainOf: base.value } : s;
    });
}

/**
 * ½-DL spikes in one column. `rows` limits the scan to those row indices
 * (one assay-protocol group); `group` labels the result.
 */
export function findHalfDlSpikes(
    values: ArrayLike<number>,
    rows: ArrayLike<number> | null = null,
    opts: HalfDlOptions = {},
    group: string | null = null,
): HalfDlSpike[] {
    const o = { ...DEFAULTS, ...opts };
    const counts = new Map<number, number>();
    let n = 0;
    const len = rows ? rows.length : values.length;
    for (let k = 0; k < len; k++) {
        const v = values[rows ? rows[k] : k];
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        if (v < 0) {
            if (isMissingCode(v)) continue;
            return []; // -DL convention already in use
        }
        if (v === 0) continue;
        n++;
        const kv = key(v);
        counts.set(kv, (counts.get(kv) ?? 0) + 1);
    }
    if (n < 20) return [];
    const minCount = o.minCount ?? Math.max(10, Math.ceil(n * 0.005));
    const distinct = [...counts.keys()].sort((a, b) => a - b);
    const out: HalfDlSpike[] = [];

    for (let i = 0; i < distinct.length; i++) {
        const h = distinct[i];
        const c = counts.get(h)!;
        if (c < minCount || !isLabLimit(2 * h)) continue;
        const dl = key(2 * h);

        // Real values just above the implied limit, and the gap below it
        let above = 0, gap = 0;
        const aboveValues: number[] = [];
        for (let j = i + 1; j < distinct.length; j++) {
            const v = distinct[j];
            if (v < dl) gap += counts.get(v)!;
            else if (v < 20 * h) { above += counts.get(v)!; aboveValues.push(v); }
            else break;
        }
        if (above === 0) continue;

        // Reporting step near the limit (whole scope when too few values there)
        const q = reportingStep(aboveValues, counts) ?? reportingStep(distinct.slice(i + 1), counts);
        if (q === null) continue;
        // The gap can only be judged with several reporting steps inside (h, 2h);
        // otherwise the value must sit off the reporting grid to count
        const gapTestable = (dl - h) / q >= 3;
        const offGrid = !onGrid(h, q);
        if (!gapTestable && !offGrid) continue;

        // Spike: more frequent than the next 10 distinct values typically are.
        // Off the reporting grid a value is already exceptional, so it need only
        // stand out from its neighbours (coarse grids crowd every value).
        const next = distinct.slice(i + 1, i + 11).map(v => counts.get(v)!).sort((a, b) => a - b);
        if (next.length < 3) continue;
        const typical = next[Math.floor(next.length / 2)];
        if (c < (offGrid ? 1 : o.spikeRatio) * typical) continue;

        const gapShare = gap / c;
        let confidence: HalfDlConfidence | null = gapShare <= o.highGap ? 'high' : gapShare <= o.mediumGap ? 'medium' : null;
        // A partly filled gap means another, more sensitive protocol — whose
        // values also fall below h. Without any, the lab reported BDL AT the
        // limit and the "gap" is ordinary data.
        if (confidence === 'medium') {
            let below = 0;
            for (let j = 0; j < i; j++) below += counts.get(distinct[j])!;
            if (below < Math.max(5, gap * 0.05)) confidence = null;
        }
        if (!confidence) continue;
        out.push({ value: h, dl, count: c, gapShare, gapTestable, offGrid, confidence, group });
    }
    return markChains(out);
}

/**
 * Spikes per group of a grouping column (lab method, batch). Blank group
 * values form their own group. Groups too small to judge are skipped.
 */
export function findHalfDlSpikesByGroup(
    values: ArrayLike<number>,
    groups: ArrayLike<unknown>,
    opts: HalfDlOptions = {},
): HalfDlSpike[] {
    const byGroup = new Map<string, number[]>();
    for (let i = 0; i < values.length; i++) {
        const g = groups[i] == null ? '' : String(groups[i]);
        let list = byGroup.get(g);
        if (!list) byGroup.set(g, (list = []));
        list.push(i);
    }
    const out: HalfDlSpike[] = [];
    for (const [g, rows] of byGroup) out.push(...findHalfDlSpikes(values, rows, opts, g));
    return out;
}

/**
 * Whole column and per group together. Per value: a high-confidence finding
 * over the whole column applies to every row; otherwise the per-group
 * findings (a protocol whose real values fill another's gap hides it from
 * the whole-column view); otherwise a medium whole-column finding.
 */
export function findHalfDlSpikesWithGroups(
    values: ArrayLike<number>,
    groups: ArrayLike<unknown> | undefined,
    opts: HalfDlOptions = {},
): HalfDlSpike[] {
    const whole = findHalfDlSpikes(values, null, opts);
    if (!groups) return whole;
    const byGroup = findHalfDlSpikesByGroup(values, groups, opts);
    const out: HalfDlSpike[] = [];
    const keys = new Set([...whole, ...byGroup].map(s => s.value));
    for (const v of [...keys].sort((a, b) => a - b)) {
        const w = whole.find(s => s.value === v);
        const g = byGroup.filter(s => s.value === v);
        if (w?.confidence === 'high' || !g.length) { if (w) out.push(w); }
        else out.push(...g);
    }
    // Chains were judged within each scope (findHalfDlSpikes): a whole-column
    // 0.25 -> <0.5 from one lab says nothing about another lab's 0.5
    return out;
}

/** Name score of a batch / method column: methods split protocols best. */
function batchNameScore(name: string): number {
    if (/method|scheme|protocol|assay.?type|digest|analy/i.test(name)) return 3;
    if (/lab/i.test(name)) return 2;
    return BATCH_COLUMN_PATTERN.test(name) ? 1 : 0;
}

export interface BatchColumnOption { name: string; groups: number; score: number }

/**
 * Text columns that can hold the lab method / batch (2 to maxGroups distinct
 * values, fewer than half the rows), best first: method names before lab
 * before job / batch numbers, then fewer distinct values. Score 0 = the name
 * gives no hint.
 */
export function rankBatchColumns(
    columns: { name: string }[],
    getCol: (name: string) => ArrayLike<unknown> | undefined,
    maxGroups = 200,
): BatchColumnOption[] {
    const out: BatchColumnOption[] = [];
    for (const c of columns) {
        const col = getCol(c.name);
        if (!col || col instanceof Float64Array) continue;
        const seen = new Set<string>();
        for (let i = 0; i < col.length && seen.size <= maxGroups; i++) seen.add(col[i] == null ? '' : String(col[i]));
        if (seen.size >= 2 && seen.size <= maxGroups && seen.size < col.length / 2) {
            out.push({ name: c.name, groups: seen.size, score: batchNameScore(c.name) });
        }
    }
    return out.sort((a, b) => b.score - a.score || a.groups - b.groups);
}

/** The most likely lab method / batch column, or null. */
export function suggestBatchColumn(
    columns: { name: string }[],
    getCol: (name: string) => ArrayLike<unknown> | undefined,
): string | null {
    const best = rankBatchColumns(columns, getCol)[0];
    return best && best.score > 0 ? best.name : null;
}

/**
 * Turn ½-DL values into the -DL convention (value h -> -2h). A spike found
 * in a group only changes rows of that group. Returns a new array and the
 * number of values changed.
 */
export function applyHalfDl(
    values: ArrayLike<number>,
    spikes: Pick<HalfDlSpike, 'value' | 'dl' | 'group'>[],
    groups?: ArrayLike<unknown>,
): { values: Float64Array; changed: number } {
    const out = Float64Array.from(values as ArrayLike<number>);
    let changed = 0;
    for (let i = 0; i < out.length; i++) {
        const v = out[i];
        if (!(v > 0)) continue;
        for (const s of spikes) {
            if (s.group !== null && (groups ? (groups[i] == null ? '' : String(groups[i])) : null) !== s.group) continue;
            if (Math.abs(v - s.value) <= 1e-9 * s.value) { out[i] = -s.dl; changed++; break; }
        }
    }
    return { values: out, changed };
}

/** "5 ×412 → <10" */
export function describeSpike(s: HalfDlSpike): string {
    const g = s.group !== null ? `[${s.group || 'blank'}] ` : '';
    const chain = s.chainOf !== undefined ? `; ${s.value} is the DL of ${s.chainOf}: may be results at the limit` : '';
    return `${g}${s.value} ×${s.count.toLocaleString()} → <${s.dl} (gap ${Math.round(s.gapShare * 100)} %${chain})`;
}

/** Column names that look like an assay method / batch field. */
export const BATCH_COLUMN_PATTERN = /job|batch|lab|method|cert|dispatch|despatch|digest|assay.?type|analy|scheme|protocol|order/i;
