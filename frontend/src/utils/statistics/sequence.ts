/**
 * Methods along a sequence of samples: down a drillhole, or along any run
 * of samples whose order means something (consecutive sample numbers).
 *
 *  - sequenceRuns: order the rows by hole and position, and split them into
 *    runs wherever the hole changes or the position jumps by more than a gap.
 *    Neighbours are only ever taken inside a run.
 *  - movingWindow: centred moving median / mean of a column inside each run.
 *    Smooths single-sample noise when the feature is wider than one sample
 *    (an alteration halo), at the cost of sharpness at contacts.
 *  - lagOneTest: is the order meaningful? Spearman correlation between each
 *    sample and the next one in the run, against a permutation null (the same
 *    values in random order). Rocks are continuous, so immobile elements in
 *    true down-hole order are strongly auto-correlated. If they are, samples
 *    are not independent: validate with blocks, not random splits.
 */
import { spearmanCorrelation } from './correlation';
import { seededRandom, shuffled } from './random';

export interface SequenceOptions {
    /** Hole (or other group) of each row: rows of different groups are never neighbours */
    groups?: ArrayLike<unknown> | null;
    /** Position along the hole (depth, or a sample number). Null = the dataset's row order */
    position?: ArrayLike<number> | null;
    /** A new run starts where the position steps by more than this (null = never) */
    maxGap?: number | null;
}

export interface SequenceRuns {
    /** Runs of row indices, each in position order */
    runs: number[][];
    /** Rows left out (no position) */
    skipped: number;
}

const groupKey = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** The trailing number of an ID ("S-014188" -> 14188), for ordering samples by their numbers */
export function trailingNumber(id: unknown): number {
    const m = /(\d+(?:\.\d+)?)\D*$/.exec(groupKey(id));
    return m ? Number(m[1]) : NaN;
}

export function sequenceRuns(n: number, opts: SequenceOptions = {}): SequenceRuns {
    const pos = opts.position;
    const grp = opts.groups;
    const idx: number[] = [];
    let skipped = 0;
    for (let i = 0; i < n; i++) {
        if (pos && !Number.isFinite(pos[i])) { skipped++; continue; }
        idx.push(i);
    }
    idx.sort((a, b) => {
        if (grp) {
            const ga = groupKey(grp[a]), gb = groupKey(grp[b]);
            if (ga !== gb) return ga < gb ? -1 : 1;
        }
        return pos ? pos[a] - pos[b] || a - b : a - b;
    });
    const runs: number[][] = [];
    let cur: number[] = [];
    for (let k = 0; k < idx.length; k++) {
        const i = idx[k];
        if (cur.length) {
            const prev = cur[cur.length - 1];
            const newGroup = grp ? groupKey(grp[prev]) !== groupKey(grp[i]) : false;
            const gap = pos && opts.maxGap !== null && opts.maxGap !== undefined ? pos[i] - pos[prev] > opts.maxGap : false;
            if (newGroup || gap) { runs.push(cur); cur = []; }
        }
        cur.push(i);
    }
    if (cur.length) runs.push(cur);
    return { runs, skipped };
}

export type WindowStat = 'median' | 'mean';

export interface MovingWindowOptions extends SequenceOptions {
    /** Samples in the window (centred; an even window takes one more before than after) */
    window: number;
    stat?: WindowStat;
    /** Fewest values the window needs, else blank (default 1) */
    minCount?: number;
}

function medianInPlace(a: number[]): number {
    a.sort((x, y) => x - y);
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Centred moving median / mean inside each run (NaN values are skipped) */
export function movingWindow(values: ArrayLike<number>, opts: MovingWindowOptions): Float64Array {
    const n = values.length;
    const out = new Float64Array(n).fill(NaN);
    const w = Math.max(1, Math.round(opts.window));
    const before = Math.floor(w / 2);
    const minCount = Math.max(1, opts.minCount ?? 1);
    const stat = opts.stat ?? 'median';
    for (const run of sequenceRuns(n, opts).runs) {
        for (let k = 0; k < run.length; k++) {
            const lo = Math.max(0, k - before), hi = Math.min(run.length - 1, k - before + w - 1);
            const win: number[] = [];
            for (let j = lo; j <= hi; j++) {
                const v = values[run[j]];
                if (Number.isFinite(v)) win.push(v);
            }
            if (win.length < minCount) continue;
            out[run[k]] = stat === 'median' ? medianInPlace(win) : win.reduce((s, v) => s + v, 0) / win.length;
        }
    }
    return out;
}

export interface LagOneOptions extends SequenceOptions {
    /** Values below this are set to it first (e.g. 0 for signed readings); null = none */
    clipBelow?: number | null;
    permutations?: number;
    seed?: number;
}

export interface LagOneResult {
    /** Spearman rho between each sample and the next in its run */
    rho: number;
    pairs: number;
    /** 95th percentile of rho with the values in random order */
    nullP95: number;
    /** Share of random orders with rho >= the observed */
    pValue: number;
}

/** Consecutive pairs inside runs: [row, next row] */
export function neighbourPairs(n: number, opts: SequenceOptions): Array<[number, number]> {
    const pairs: Array<[number, number]> = [];
    for (const run of sequenceRuns(n, opts).runs) for (let k = 0; k + 1 < run.length; k++) pairs.push([run[k], run[k + 1]]);
    return pairs;
}

export function lagOneTest(values: ArrayLike<number>, opts: LagOneOptions = {}): LagOneResult {
    const n = values.length;
    const clip = opts.clipBelow;
    const x = Float64Array.from({ length: n }, (_, i) => {
        const v = values[i];
        return Number.isFinite(v) && clip !== null && clip !== undefined ? Math.max(v, clip) : v;
    });
    const pairs = neighbourPairs(n, opts);
    const rhoOf = (arr: ArrayLike<number>) => {
        const a: number[] = [], b: number[] = [];
        for (const [i, j] of pairs) {
            if (Number.isFinite(arr[i]) && Number.isFinite(arr[j])) { a.push(arr[i]); b.push(arr[j]); }
        }
        return { rho: a.length >= 3 ? spearmanCorrelation(a, b) : NaN, n: a.length };
    };
    const obs = rhoOf(x);
    const P = opts.permutations ?? 2000;
    const rand = seededRandom(opts.seed ?? 42);
    const nul: number[] = [];
    for (let p = 0; p < P; p++) {
        const r = rhoOf(shuffled(x, rand)).rho;
        if (Number.isFinite(r)) nul.push(r);
    }
    nul.sort((a, b) => a - b);
    const p95 = nul.length ? nul[Math.min(nul.length - 1, Math.floor(0.95 * (nul.length - 1)))] : NaN;
    const ge = nul.filter(r => r >= obs.rho).length;
    return { rho: obs.rho, pairs: obs.n, nullP95: p95, pValue: nul.length ? ge / nul.length : NaN };
}
