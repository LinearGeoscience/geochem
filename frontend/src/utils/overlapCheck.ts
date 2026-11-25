/**
 * Overlap check: do two groups (surveys, batches, protocols) read the same
 * ground the same way? Decides whether levelling is needed, and which groups
 * can be pooled.
 *
 * The area is cut into square cells. A cell is SHARED by two groups when it
 * holds at least `minPerCell` samples of each. In a shared cell both groups
 * sampled the same ground, so the ratio of their medians measures the
 * analytical (or sampling) offset, not geology. A cell is usable only when
 * both medians are at or above both groups' detection limits — a median
 * "< DL" says nothing about the offset.
 *
 * Per pair: median of the per-cell log10 ratios (B / A), with a 90 %
 * interval by bootstrap over the usable cells (seeded: same data, same
 * answer). Verdicts:
 *  - 'agree': the whole interval lies within x0.8-x1.25
 *  - 'offset': the interval excludes x1 (B reads `ratio` times A)
 *  - 'unclear': the interval includes x1 but is too wide to call agreement
 *  - 'too-little': fewer than `minCells` (5) usable cells - a bootstrap over
 *    3-4 cells cannot be wider than those few values, so it overstates certainty
 * Pairs are only formed within one stratum (sample medium) when strata are
 * given: soil against rock chips says nothing about the lab.
 */
import { groupText } from './groupLabels';
import { cellLimit, groupDetectionLimits, halfDlGroupOf, hasValue, maxPositive, type FloorReading, type HalfDlRule } from './groupDl';
import { robustExtent } from './coordinateUtils';

export type OverlapVerdict = 'agree' | 'offset' | 'unclear' | 'too-little';

export const VERDICT_TEXT: Record<OverlapVerdict, string> = {
    agree: 'agree',
    offset: 'offset',
    unclear: 'unclear (wide interval)',
    'too-little': 'too little overlap',
};

export interface OverlapCell {
    cell: number;
    x: number;
    y: number;
    nA: number;
    nB: number;
    medA: number;
    medB: number;
    /** log10(medB / medA) */
    logRatio: number;
}

export interface OverlapPair {
    a: string;
    b: string;
    stratum: string | null;
    /** Cells with >= minPerCell samples of both groups */
    sharedCells: number;
    /** Shared cells with both medians above detection */
    usableCells: number;
    /** Shared cells left out because a median was below detection */
    censoredCells: number;
    /** B / A (10^median log ratio); NaN when too little overlap */
    ratio: number;
    lo: number;
    hi: number;
    verdict: OverlapVerdict;
    cells: OverlapCell[];
    /** Row indices of the two groups in usable cells (for a Q-Q plot) */
    rowsA: number[];
    rowsB: number[];
}

export interface OverlapResult {
    pairs: OverlapPair[];
    cellSize: number;
    groups: { group: string; n: number; stratum: string | null; limit: number | null }[];
    /** Rows without usable coordinates */
    noCoords: number;
}

export interface OverlapOptions {
    cellSize: number;
    minPerCell?: number;
    minCells?: number;
    /** Agreement band, as a factor (default 1.25: x0.8 - x1.25) */
    agreeWithin?: number;
    strata?: ArrayLike<unknown> | null;
    halfDl?: HalfDlRule[];
    halfDlGroups?: ArrayLike<unknown>;
    floorAs?: FloorReading;
    bootstrap?: number;
    seed?: number;
}

/** Deterministic PRNG (mulberry32) */
function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const medianOf = (v: number[]) => {
    const s = [...v].sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Cell id per row on a square grid of `size` (map units) anchored at the
 * main body of the points; -1 = no usable coordinates or far outside.
 */
export function cellKeys(east: ArrayLike<unknown>, north: ArrayLike<unknown>, size: number): {
    keys: Int32Array; x0: number; y0: number; nx: number;
} {
    const n = Math.min(east.length, north.length);
    const keys = new Int32Array(n).fill(-1);
    const ext = robustExtent(east, north);
    if (!ext || !(size > 0)) return { keys, x0: 0, y0: 0, nx: 0 };
    const x0 = Math.floor(ext.x[0] / size) * size, y0 = Math.floor(ext.y[0] / size) * size;
    const nx = Math.floor((ext.x[1] - x0) / size) + 1;
    const ny = Math.floor((ext.y[1] - y0) / size) + 1;
    if (nx * ny > 2e9) return { keys, x0, y0, nx: 0 };
    for (let i = 0; i < n; i++) {
        const x = east[i], y = north[i];
        if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) continue;
        const cx = Math.floor((x - x0) / size), cy = Math.floor((y - y0) / size);
        if (cx < 0 || cy < 0 || cx >= nx || cy >= ny) continue;
        keys[i] = cy * nx + cx;
    }
    return { keys, x0, y0, nx };
}

export function overlapCheck(
    raw: ArrayLike<number>,
    groups: ArrayLike<unknown>,
    east: ArrayLike<unknown>,
    north: ArrayLike<unknown>,
    opts: OverlapOptions,
): OverlapResult {
    const { cellSize, minPerCell = 5, minCells = 5, agreeWithin = 1.25, strata = null, bootstrap = 1000, seed = 1 } = opts;
    const n = raw.length;
    const halfDl = opts.halfDl ?? [];
    const halfDlGroups = opts.halfDlGroups ?? groups;
    const labels = Array.from({ length: n }, (_, i) => groupText(groups[i]));
    const limits = new Map(groupDetectionLimits(raw, labels, { halfDl, halfDlGroups, floorAs: opts.floorAs }).map(s => [s.group, s.assumedDl]));
    const maxPos = maxPositive(raw);
    const { keys, x0, y0, nx } = cellKeys(east, north, cellSize);

    // Values per group per cell; a censored value is stored as -Infinity (below any limit)
    const byGroup = new Map<string, Map<number, { rows: number[]; vals: number[] }>>();
    const groupN = new Map<string, number>();
    const stratumCount = new Map<string, Map<string, number>>();
    let noCoords = 0;
    for (let i = 0; i < n; i++) {
        const v = raw[i];
        if (!hasValue(v, maxPos)) continue;
        const g = labels[i];
        groupN.set(g, (groupN.get(g) ?? 0) + 1);
        if (strata) {
            const s = groupText(strata[i]);
            let m = stratumCount.get(g);
            if (!m) stratumCount.set(g, (m = new Map()));
            m.set(s, (m.get(s) ?? 0) + 1);
        }
        const k = keys[i];
        if (k < 0) { noCoords++; continue; }
        let cells = byGroup.get(g);
        if (!cells) byGroup.set(g, (cells = new Map()));
        let c = cells.get(k);
        if (!c) cells.set(k, (c = { rows: [], vals: [] }));
        const lim = limits.get(g) ?? null;
        const censored = cellLimit(v, halfDl, halfDlGroupOf(halfDlGroups, i), maxPos) !== null || (lim !== null && v < lim * (1 - 1e-9));
        c.rows.push(i);
        c.vals.push(censored ? -Infinity : v);
    }
    const stratumOf = (g: string): string | null => {
        const m = stratumCount.get(g);
        if (!m) return null;
        return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
    };
    const groupList = [...groupN.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([group, cnt]) => ({ group, n: cnt, stratum: stratumOf(group), limit: limits.get(group) ?? null }));

    const pairs: OverlapPair[] = [];
    const band = Math.log10(agreeWithin);
    for (let p = 0; p < groupList.length; p++) {
        for (let q = p + 1; q < groupList.length; q++) {
            const A = groupList[p], B = groupList[q];
            if (strata && A.stratum !== B.stratum) continue;
            const ca = byGroup.get(A.group), cb = byGroup.get(B.group);
            if (!ca || !cb) continue;
            const floor = Math.max(A.limit ?? 0, B.limit ?? 0);
            let shared = 0, censoredCells = 0;
            const cells: OverlapCell[] = [];
            const rowsA: number[] = [], rowsB: number[] = [];
            for (const [k, a] of ca) {
                if (a.vals.length < minPerCell) continue;
                const b = cb.get(k);
                if (!b || b.vals.length < minPerCell) continue;
                shared++;
                const medA = medianOf(a.vals), medB = medianOf(b.vals);
                if (!(medA >= floor) || !(medB >= floor) || !(medA > 0) || !(medB > 0)) { censoredCells++; continue; }
                cells.push({
                    cell: k, x: x0 + ((k % nx) + 0.5) * cellSize, y: y0 + (Math.floor(k / nx) + 0.5) * cellSize,
                    nA: a.vals.length, nB: b.vals.length, medA, medB, logRatio: Math.log10(medB / medA),
                });
                rowsA.push(...a.rows); rowsB.push(...b.rows);
            }
            if (!shared) continue;
            let ratio = NaN, lo = NaN, hi = NaN;
            let verdict: OverlapVerdict = 'too-little';
            if (cells.length >= minCells) {
                const lr = cells.map(c => c.logRatio);
                const centre = medianOf(lr);
                const rand = rng(seed + p * 7919 + q);
                const boots = new Float64Array(bootstrap);
                const sample = new Array<number>(lr.length);
                for (let r = 0; r < bootstrap; r++) {
                    for (let j = 0; j < lr.length; j++) sample[j] = lr[Math.floor(rand() * lr.length)];
                    boots[r] = medianOf(sample);
                }
                boots.sort();
                const l = boots[Math.floor(0.05 * (bootstrap - 1))], h = boots[Math.ceil(0.95 * (bootstrap - 1))];
                ratio = 10 ** centre; lo = 10 ** l; hi = 10 ** h;
                verdict = l >= -band && h <= band ? 'agree' : l > 0 || h < 0 ? 'offset' : 'unclear';
            }
            pairs.push({
                a: A.group, b: B.group, stratum: A.stratum, sharedCells: shared, usableCells: cells.length, censoredCells,
                ratio, lo, hi, verdict, cells, rowsA, rowsB,
            });
        }
    }
    const order: Record<OverlapVerdict, number> = { offset: 0, unclear: 1, agree: 2, 'too-little': 3 };
    pairs.sort((x, y) => order[x.verdict] - order[y.verdict] || y.usableCells - x.usableCells || y.sharedCells - x.sharedCells);
    return { pairs, cellSize, groups: groupList, noCoords };
}

export const CELL_SIZES = [250, 500, 1000, 2000, 5000];

/**
 * The smallest cell size that already gives most of the comparable pairs:
 * small cells compare like with like; big cells give more cells to compare.
 */
export function suggestCellSize(run: (size: number) => OverlapResult, sizes = CELL_SIZES): number {
    const usable = sizes.map(s => run(s).pairs.filter(p => p.verdict !== 'too-little').length);
    const best = Math.max(...usable);
    if (best === 0) return sizes[sizes.length - 1];
    return sizes[usable.findIndex(u => u >= 0.8 * best)];
}

/**
 * Pool map from the pairs that agree (transitively): each group -> the
 * largest group of its agreeing set. Groups that agree with nothing are
 * left out.
 */
export function poolFromAgreement(result: OverlapResult): Record<string, string> {
    const parent = new Map<string, string>();
    const find = (g: string): string => { const p = parent.get(g) ?? g; if (p === g) return g; const r = find(p); parent.set(g, r); return r; };
    const size = new Map(result.groups.map(g => [g.group, g.n]));
    for (const p of result.pairs) {
        if (p.verdict !== 'agree') continue;
        const ra = find(p.a), rb = find(p.b);
        if (ra === rb) continue;
        const [big, small] = (size.get(ra) ?? 0) >= (size.get(rb) ?? 0) ? [ra, rb] : [rb, ra];
        parent.set(small, big);
    }
    const out: Record<string, string> = {};
    for (const g of parent.keys()) { const r = find(g); if (r !== g) out[g] = r; }
    return out;
}

/** Paired quantiles of two value sets (for a Q-Q plot), positives only */
export function qqPairs(a: number[], b: number[], points = 50): { x: number[]; y: number[] } {
    const sa = a.filter(v => v > 0).sort((x, y) => x - y), sb = b.filter(v => v > 0).sort((x, y) => x - y);
    if (!sa.length || !sb.length) return { x: [], y: [] };
    const q = (s: number[], p: number) => { const k = p * (s.length - 1); const lo = Math.floor(k); const t = k - lo; return s[lo] * (1 - t) + s[Math.min(lo + 1, s.length - 1)] * t; };
    const m = Math.min(points, Math.max(sa.length, sb.length));
    const x: number[] = [], y: number[] = [];
    for (let i = 0; i < m; i++) { const p = m === 1 ? 0.5 : i / (m - 1); x.push(q(sa, p)); y.push(q(sb, p)); }
    return { x, y };
}
