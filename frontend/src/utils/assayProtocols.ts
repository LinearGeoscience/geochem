/**
 * Assay protocol groups: samples analysed the same way (same element suite,
 * same detection limits) so that probability plots and PCA can treat each
 * protocol separately — mixing a 10-element XRF suite with 48-element ICP,
 * or a DL-10 method with a DL-0.5 one, makes false populations.
 *
 * 1. Suite: the set of element columns a row has values for. Small suites
 *    (sporadic blanks) join the most similar large suite (Jaccard ≥ 0.8).
 * 2. Detection limits are only visible where a value is below detection
 *    (-DL, or a ½-DL value found by halfDetection.ts).
 * 3. With a batch / method column, each batch's DL profile (modal DL per
 *    element, with the number of below-detection rows behind it) decides:
 *    batches agreeing on >= 90 % of the elements both show well (>= 5 rows
 *    below detection), including the three best-shown ones, form one
 *    protocol; batches with no below-detection values join the largest
 *    compatible protocol. Without one, the split is by suite only.
 * Every group reports its DLs; an element with several DLs inside one group
 * is flagged (it needs a batch column, or it is a re-assay).
 * 4. With a stratum column (sample medium: soil / stream / rock chip), the
 *    whole procedure runs inside each stratum, so a group never mixes media
 *    and numbering restarts per stratum ("SOIL · P1 · 26 el").
 */
import { isMissingCode } from './censoring';

export interface ProtocolColumn {
    name: string;
    /** Raw stored values (-DL convention) */
    values: ArrayLike<number>;
    /** ½-DL values not yet converted (value -> dl), optionally per batch group */
    halfDl?: { value: number; dl: number; group: string | null }[];
}

export interface ProtocolInput {
    columns: ProtocolColumn[];
    rowCount: number;
    /** Batch / lab method per row (optional) */
    batch?: ArrayLike<unknown>;
    /** Suites smaller than this join a similar suite (default max(20, 1 % of the rows / stratum's rows)) */
    minGroupSize?: number;
    /** Stratum per row (e.g. sample medium): groups are made within each stratum */
    strata?: ArrayLike<unknown>;
}

export interface DlCount { dl: number; count: number }

export interface ProtocolGroup {
    name: string;
    rows: number[];
    /** Columns with values in at least half the group's rows */
    elements: string[];
    /** Columns of the analysis that the group lacks */
    missing: string[];
    /** Detection limits seen, per column (most frequent first) */
    dls: Record<string, DlCount[]>;
    /** Columns with more than one detection limit inside the group */
    mixedDl: string[];
    /** Typical DL relative to the lowest-DL group of the same suite (1 = lowest) */
    dlFactor: number | null;
    /** Rows show no below-detection value, so their DLs are unknown */
    dlUnknown: boolean;
    /** Batches in the group (with a batch column) */
    batches: string[];
    /** Element-suite cluster the group belongs to (groups of one suite differ only by DL) */
    suite: number;
    /** Columns whose usual DL differs from the suite's largest group */
    dlDiffers: string[];
    /** Stratum the group belongs to (with a stratum column) */
    stratum: string | null;
}

export interface ProtocolResult {
    groups: ProtocolGroup[];
    /** Group index per row; -1 = no assay values */
    assignment: Int32Array;
    /** Rows with no value in any column */
    empty: number;
    /** Columns whose DL or presence differs between groups (most different first) */
    discriminating: string[];
}

const REL = 1e-6;
const sameDl = (a: number, b: number) => Math.abs(a - b) <= REL * Math.max(a, b);
const key12 = (v: number) => Number(v.toPrecision(12));

/**
 * DL revealed by a cell, or null (measured / blank): -DL values, and
 * clear-cut ½-DL values (`halfDl`, matched within their batch group).
 */
export function cellDl(v: number, c: Pick<ProtocolColumn, 'halfDl'>, batch: string | null): number | null {
    if (!Number.isFinite(v)) return null;
    if (v < 0) return isMissingCode(v) ? null : key12(-v);
    if (c.halfDl) {
        for (const s of c.halfDl) {
            if ((s.group === null || s.group === batch) && Math.abs(v - s.value) <= 1e-9 * s.value) return key12(s.dl);
        }
    }
    return null;
}

const present = (v: number) => Number.isFinite(v) && !(v < 0 && isMissingCode(v));

/** DL profile: column index -> modal DL and the below-detection rows behind it */
type Profile = Map<number, { dl: number; n: number }>;

/** Below-detection rows needed before an element's DL counts as evidence */
const MIN_EVIDENCE = 5;

function modal(counts: Map<number, number>): { dl: number; n: number } {
    let best = 0, bestN = -1;
    for (const [dl, n] of counts) if (n > bestN || (n === bestN && dl < best)) { best = dl; bestN = n; }
    return { dl: best, n: bestN };
}

/**
 * Same protocol? Judged on the elements both show well: >= 90 % must agree,
 * including the three best-shown. A stray element (a re-assay, a few odd
 * values) no longer splits batches of one method.
 */
function compatible(a: Profile, b: Profile): boolean {
    const shared: { agree: boolean; w: number }[] = [];
    for (const [col, pa] of a) {
        const pb = b.get(col);
        if (pb && pa.n >= MIN_EVIDENCE && pb.n >= MIN_EVIDENCE) shared.push({ agree: sameDl(pa.dl, pb.dl), w: Math.min(pa.n, pb.n) });
    }
    if (!shared.length) return true;
    if (shared.filter(x => x.agree).length < 0.9 * shared.length) return false;
    return [...shared].sort((x, y) => y.w - x.w).slice(0, 3).every(x => x.agree);
}

/** Fold a profile into a cluster's: agreeing evidence adds up, the better-shown DL wins */
function absorb(into: Profile, from: Profile): void {
    for (const [col, p] of from) {
        const q = into.get(col);
        if (!q) into.set(col, { ...p });
        else if (sameDl(q.dl, p.dl)) q.n += p.n;
        else if (p.n > q.n) into.set(col, { ...p });
    }
}

interface Unit { rows: number[]; profile: Profile; label: string | null }

/** Greedy merge of units (batches or row profiles) with agreeing DL profiles; biggest first. */
function mergeUnits(units: Unit[]): Unit[][] {
    const sorted = [...units].sort((a, b) => b.rows.length - a.rows.length || (a.label ?? '').localeCompare(b.label ?? ''));
    const clusters: { members: Unit[]; profile: Profile }[] = [];
    const deferred: Unit[] = [];
    for (const u of sorted) {
        if (u.profile.size === 0) { deferred.push(u); continue; }
        const hit = clusters.find(c => compatible(u.profile, c.profile));
        if (hit) {
            hit.members.push(u);
            absorb(hit.profile, u.profile);
        } else {
            const profile: Profile = new Map();
            absorb(profile, u.profile);
            clusters.push({ members: [u], profile });
        }
    }
    // Units that show no DL join the largest cluster (or form one)
    if (deferred.length) {
        if (clusters.length) clusters[0].members.push(...deferred);
        else clusters.push({ members: deferred, profile: new Map() });
    }
    return clusters.map(c => c.members);
}

/** Stratum label of a value (blank -> '(blank)') */
export const stratumLabel = (v: unknown) => (v == null || String(v).trim() === '' ? '(blank)' : String(v).trim());

export function detectProtocols(input: ProtocolInput): ProtocolResult {
    const { columns, rowCount } = input;
    const assignment = new Int32Array(rowCount).fill(-1);
    const groups: ProtocolGroup[] = [];
    let empty = 0;
    if (input.strata) {
        const byStratum = new Map<string, number[]>();
        for (let i = 0; i < rowCount; i++) {
            const k = stratumLabel(input.strata[i]);
            let list = byStratum.get(k);
            if (!list) byStratum.set(k, (list = []));
            list.push(i);
        }
        // Largest stratum first; suites numbered across strata
        const strata = [...byStratum.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
        let suiteBase = 0;
        for (const [label, rows] of strata) {
            const r = detectCore(input, rows);
            empty += r.empty;
            let maxSuite = -1;
            for (const g of r.groups) {
                maxSuite = Math.max(maxSuite, g.suite);
                groups.push({ ...g, name: `${label} · ${g.name}`, suite: g.suite + suiteBase, stratum: label });
            }
            suiteBase += maxSuite + 1;
        }
    } else {
        const r = detectCore(input, null);
        empty = r.empty;
        groups.push(...r.groups);
    }
    groups.forEach((g, n) => { for (const i of g.rows) assignment[i] = n; });

    // Columns that tell the groups apart (DL or presence)
    const score = columns.map(c => {
        const sig = new Set(groups.map(g => {
            if (!g.elements.includes(c.name)) return 'absent';
            const d = g.dls[c.name]?.[0]?.dl;
            return d === undefined ? '?' : String(d);
        }));
        sig.delete('?');
        return { name: c.name, distinct: sig.size };
    });
    const discriminating = score.filter(s => s.distinct > 1).sort((a, b) => b.distinct - a.distinct).map(s => s.name);

    return { groups, assignment, empty, discriminating };
}

/** Suites, then DL split, on the given rows (all rows when null). */
function detectCore(input: ProtocolInput, subset: number[] | null): { groups: ProtocolGroup[]; empty: number } {
    const { columns } = input;
    const nCol = columns.length;
    const rowList = subset ?? Array.from({ length: input.rowCount }, (_, i) => i);
    const minSize = input.minGroupSize ?? Math.max(20, Math.ceil(rowList.length * 0.01));
    const batchOf = (i: number) => (input.batch ? (input.batch[i] == null ? '' : String(input.batch[i])) : null);

    // 1. Suites
    const suiteRows = new Map<string, number[]>();
    let empty = 0;
    for (const i of rowList) {
        const idx: number[] = [];
        for (let j = 0; j < nCol; j++) if (present(columns[j].values[i])) idx.push(j);
        if (!idx.length) { empty++; continue; }
        const k = idx.join(',');
        let list = suiteRows.get(k);
        if (!list) suiteRows.set(k, (list = []));
        list.push(i);
    }
    const suites = [...suiteRows.entries()]
        .map(([k, rows]) => ({ set: new Set(k.split(',').map(Number)), rows }))
        .sort((a, b) => b.rows.length - a.rows.length);
    const jaccard = (a: Set<number>, b: Set<number>) => {
        let inter = 0;
        for (const x of a) if (b.has(x)) inter++;
        return inter / (a.size + b.size - inter);
    };
    const clusters: { set: Set<number>; rows: number[] }[] = [];
    for (const s of suites) {
        if (s.rows.length < minSize) {
            let best: typeof clusters[number] | null = null, bestJ = 0.8 - 1e-12;
            for (const c of clusters) { const jv = jaccard(s.set, c.set); if (jv > bestJ) { best = c; bestJ = jv; } }
            if (best) { best.rows.push(...s.rows); continue; }
        }
        clusters.push({ set: s.set, rows: [...s.rows] });
    }

    // 2–3. Detection-limit split inside each suite
    const raw: { rows: number[]; suite: number; dlUnknown: boolean; batches: string[] }[] = [];
    clusters.forEach((cl, ci) => {
        const rowProfile = (i: number, b: string | null): Map<number, number> => {
            const p = new Map<number, number>();
            for (let j = 0; j < nCol; j++) {
                const dl = cellDl(columns[j].values[i], columns[j], b);
                if (dl !== null) p.set(j, dl);
            }
            return p;
        };
        if (input.batch) {
            const byBatch = new Map<string, number[]>();
            for (const i of cl.rows) {
                const b = batchOf(i)!;
                let list = byBatch.get(b);
                if (!list) byBatch.set(b, (list = []));
                list.push(i);
            }
            const units: Unit[] = [...byBatch.entries()].map(([b, rows]) => {
                const counts = new Map<number, Map<number, number>>();
                for (const i of rows) for (const [j, dl] of rowProfile(i, b)) {
                    let m = counts.get(j);
                    if (!m) counts.set(j, (m = new Map()));
                    m.set(dl, (m.get(dl) ?? 0) + 1);
                }
                const profile: Profile = new Map();
                for (const [j, m] of counts) profile.set(j, modal(m));
                return { rows, profile, label: b };
            });
            for (const members of mergeUnits(units)) {
                raw.push({
                    rows: members.flatMap(u => u.rows).sort((a, b) => a - b), suite: ci,
                    dlUnknown: members.every(u => u.profile.size === 0),
                    batches: members.map(u => u.label!).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
                });
            }
        } else {
            raw.push({ rows: [...cl.rows].sort((a, b) => a - b), suite: ci, dlUnknown: false, batches: [] });
        }
    });

    // 4. Group statistics
    const union = new Set<number>();
    for (const c of clusters) for (const j of c.set) union.add(j);
    const stats = raw.map(g => {
        const presentCount = new Array(nCol).fill(0);
        const dlCounts: Map<number, number>[] = Array.from({ length: nCol }, () => new Map());
        for (const i of g.rows) {
            const b = batchOf(i);
            for (let j = 0; j < nCol; j++) {
                const v = columns[j].values[i];
                if (!present(v)) continue;
                presentCount[j]++;
                const dl = cellDl(v, columns[j], b);
                if (dl !== null) dlCounts[j].set(dl, (dlCounts[j].get(dl) ?? 0) + 1);
            }
        }
        const elements: number[] = [];
        for (let j = 0; j < nCol; j++) if (presentCount[j] >= g.rows.length / 2) elements.push(j);
        const dls: Record<string, DlCount[]> = {};
        const mixedDl: string[] = [];
        const modalDl = new Map<number, number>();
        for (let j = 0; j < nCol; j++) {
            if (!dlCounts[j].size) continue;
            const list = [...dlCounts[j].entries()].map(([dl, count]) => ({ dl, count })).sort((a, b) => b.count - a.count || a.dl - b.dl);
            dls[columns[j].name] = list;
            modalDl.set(j, list[0].dl);
            const total = list.reduce((a, d) => a + d.count, 0);
            // A second DL counts when it is more than a stray re-assay
            if (list.filter(d => d.count >= Math.max(3, total * 0.05)).length > 1) mixedDl.push(columns[j].name);
        }
        return { ...g, elements, dls, mixedDl, modalDl };
    });

    // 5. DL factor within a suite, relative to its lowest-DL group
    const factor = new Array<number | null>(stats.length).fill(null);
    const bySuite = new Map<number, number[]>();
    stats.forEach((g, k) => { if (!g.dlUnknown) { const l = bySuite.get(g.suite) ?? []; l.push(k); bySuite.set(g.suite, l); } });
    for (const ks of bySuite.values()) {
        if (ks.length < 2) continue;
        const ref = ks.reduce((a, b) => (stats[b].rows.length > stats[a].rows.length ? b : a));
        const rel = ks.map(k => {
            const logs: number[] = [];
            for (const [j, dl] of stats[k].modalDl) {
                const r = stats[ref].modalDl.get(j);
                if (r) logs.push(Math.log(dl / r));
            }
            return logs.length ? Math.exp(logs.reduce((a, b) => a + b, 0) / logs.length) : null;
        });
        const known = rel.filter((r): r is number => r !== null);
        const lowest = known.length ? Math.min(...known) : 1;
        ks.forEach((k, n) => { factor[k] = rel[n] === null ? null : rel[n]! / lowest; });
    }

    // 6. Order (biggest suite first, lowest DL first) and names
    const suiteSize = clusters.map(c => c.rows.length);
    const order = stats.map((_, k) => k).sort((a, b) =>
        suiteSize[stats[b].suite] - suiteSize[stats[a].suite] || stats[a].suite - stats[b].suite
        || Number(stats[a].dlUnknown) - Number(stats[b].dlUnknown)
        || (factor[a] ?? Infinity) - (factor[b] ?? Infinity) || stats[b].rows.length - stats[a].rows.length);
    // Tags: 'lowest DL' / 'DL x10' within a suite; repeats get set letters
    const baseTag = order.map(k => {
        const g = stats[k];
        const split = raw.some(r => r.suite === g.suite && r !== raw[k]);
        if (!split) return '';
        if (g.dlUnknown) return 'DL not shown';
        const f = factor[k];
        if (f === null) return 'DL set';
        return f < 1.5 ? 'lowest DL' : `DL ×${f >= 10 ? Math.round(f) : +f.toPrecision(2)}`;
    });
    const tags = baseTag.map((t, n) => {
        if (!t) return '';
        const same = order.map((k, m) => ({ k, m })).filter(({ k, m }) => stats[k].suite === stats[order[n]].suite && baseTag[m] === t);
        if (same.length < 2 && t !== 'DL set') return ` · ${t}`;
        const letter = String.fromCharCode(65 + same.findIndex(x => x.m === n));
        return t === 'lowest DL' || t === 'DL set' ? ` · DL set ${letter}` : ` · ${t} ${letter}`;
    });
    // Reference for dlDiffers: the suite's largest group
    const suiteRef = new Map<number, number>();
    stats.forEach((g, k) => { const r = suiteRef.get(g.suite); if (r === undefined || g.rows.length > stats[r].rows.length) suiteRef.set(g.suite, k); });
    const groups: ProtocolGroup[] = order.map((k, n) => {
        const g = stats[k];
        const ref = stats[suiteRef.get(g.suite)!];
        const dlDiffers: string[] = [];
        if (ref !== g) for (const [j, dl] of g.modalDl) { const r = ref.modalDl.get(j); if (r !== undefined && !sameDl(r, dl)) dlDiffers.push(columns[j].name); }
        return {
            name: `P${n + 1} · ${g.elements.length} el${tags[n]}`,
            rows: g.rows,
            elements: g.elements.map(j => columns[j].name),
            missing: [...union].filter(j => !g.elements.includes(j)).map(j => columns[j].name),
            dls: g.dls,
            mixedDl: g.mixedDl,
            dlFactor: factor[k],
            dlUnknown: g.dlUnknown,
            batches: g.batches,
            suite: g.suite,
            dlDiffers,
            stratum: null,
        };
    });
    return { groups, empty };
}

/** Per-row labels for a new column ('' for rows without assay values). */
export function protocolLabels(result: ProtocolResult, rowCount: number): string[] {
    const out = new Array<string>(rowCount);
    for (let i = 0; i < rowCount; i++) {
        const g = result.assignment[i];
        out[i] = g >= 0 ? result.groups[g].name : 'No assay values';
    }
    return out;
}

/** "Cu 0.5 ×120, 5 ×40" */
export function describeDls(column: string, list: DlCount[], max = 3): string {
    return `${column} ${list.slice(0, max).map(d => `${d.dl} ×${d.count.toLocaleString()}`).join(', ')}${list.length > max ? ', …' : ''}`;
}
