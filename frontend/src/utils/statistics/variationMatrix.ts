/**
 * Compositional variation matrix (Aitchison): var(ln(xi / xj)) for every pair
 * of parts. A small value means the two elements rise and fall together,
 * whatever dilution, leaching or closure does to their concentrations: the
 * compositional-data way of finding immobile elements (e.g. Ti-Zr in
 * weathered rock) and of seeing which elements travel as a group.
 *
 * Population variance (divide by n) over the rows where both parts have a
 * value (pairwise: a blank in a third element never drops a row). Zeros and
 * negatives have no logarithm: they are left out, or replaced per column
 * (half / 0.65 x the column's smallest positive value, or a fixed value)
 * before the logs; values below `clipMin` are then raised to it (e.g. 1 ppm,
 * so a near-zero reading does not dominate a log-ratio). Blank (NaN) cells
 * stay blank.
 */
import { normalCDF } from '../probability';
import { averageRanks } from './correlation';

/** What to do with zeros / negatives before taking logs */
export type VariationZeroRule = 'omit' | 'half-min' | 'small-constant' | 'custom';

export interface VariationMatrixOptions {
    clipMin?: number | null;
    /** Rows to use (1 = use); default all */
    rowMask?: ArrayLike<number> | null;
    /** Zeros and negatives: left out (default) or replaced */
    zeros?: VariationZeroRule;
    /** Replacement for zeros when zeros = 'custom' */
    customZeroValue?: number;
}

export interface VariationMatrixResult {
    /** matrix[i][j] = var(ln(xi/xj)); 0 on the diagonal; NaN when fewer than 3 rows */
    matrix: number[][];
    /** Rows used for each pair */
    n: number[][];
    /** Total variation: sum over pairs / (2 D), the CoDa measure of how variable the composition is */
    totalVariation: number;
    /** Zero / negative cells replaced, per part */
    replaced: number[];
}

/** ln of each part over the masked rows (NaN where no usable value), with the zero rule applied */
function logParts(parts: ArrayLike<number>[], opts: VariationMatrixOptions, mask: ArrayLike<number> | null | undefined) {
    const rows = parts.length ? parts[0].length : 0;
    const clip = opts.clipMin ?? null;
    const rule = opts.zeros ?? 'omit';
    const replaced: number[] = [];
    const logs = parts.map(col => {
        let minPos = Infinity;
        if (rule === 'half-min' || rule === 'small-constant') {
            for (let r = 0; r < rows; r++) {
                if (mask && !mask[r]) continue;
                const v = col[r];
                if (v > 0 && v < minPos) minPos = v;
            }
        }
        const sub = rule === 'half-min' ? minPos / 2
            : rule === 'small-constant' ? 0.65 * minPos
            : rule === 'custom' ? (opts.customZeroValue ?? NaN) : NaN;
        let count = 0;
        const out = new Float64Array(rows).fill(NaN);
        for (let r = 0; r < rows; r++) {
            if (mask && !mask[r]) continue;
            let v = col[r];
            if (!Number.isFinite(v)) continue;
            if (v <= 0) {
                if (!(sub > 0) || !Number.isFinite(sub)) continue;
                v = sub;
                count++;
            }
            if (clip !== null && v < clip) v = clip;
            if (v > 0) out[r] = Math.log(v);
        }
        replaced.push(count);
        return out;
    });
    return { logs, replaced, rows };
}

/** ln(xi/xj) over the rows where both have a value */
function pairDiffs(a: Float64Array, b: Float64Array): number[] {
    const out: number[] = [];
    for (let r = 0; r < a.length; r++) {
        const d = a[r] - b[r];
        if (!Number.isNaN(d)) out.push(d);
    }
    return out;
}

function popVariance(x: ArrayLike<number>): number {
    const n = x.length;
    if (n < 3) return NaN;
    let s = 0, ss = 0;
    for (let i = 0; i < n; i++) { s += x[i]; ss += x[i] * x[i]; }
    return Math.max(0, ss / n - (s / n) ** 2);
}

export function variationMatrix(parts: ArrayLike<number>[], opts: VariationMatrixOptions = {}): VariationMatrixResult {
    const D = parts.length;
    const { logs, replaced } = logParts(parts, opts, opts.rowMask);
    const matrix = Array.from({ length: D }, () => new Array<number>(D).fill(0));
    const n = Array.from({ length: D }, () => new Array<number>(D).fill(0));
    let total = 0;
    for (let i = 0; i < D; i++) {
        for (let j = i + 1; j < D; j++) {
            const d = pairDiffs(logs[i], logs[j]);
            const v = popVariance(d);
            matrix[i][j] = matrix[j][i] = v;
            n[i][j] = n[j][i] = d.length;
            if (Number.isFinite(v)) total += 2 * v;
        }
        n[i][i] = logs[i].filter(Number.isFinite).length;
    }
    return { matrix, n, totalVariation: D ? total / (2 * D) : NaN, replaced };
}

export interface RankedPair { i: number; j: number; variance: number; n: number }

/** Every pair with a variance, tightest (smallest var(ln ratio)) first */
export function rankedPairs(vm: VariationMatrixResult): RankedPair[] {
    const out: RankedPair[] = [];
    const D = vm.matrix.length;
    for (let i = 0; i < D; i++) {
        for (let j = i + 1; j < D; j++) {
            if (Number.isFinite(vm.matrix[i][j])) out.push({ i, j, variance: vm.matrix[i][j], n: vm.n[i][j] });
        }
    }
    return out.sort((a, b) => a.variance - b.variance || a.i - b.i || a.j - b.j);
}

/**
 * Two-sided Mann-Whitney (Wilcoxon rank-sum) p-value, normal approximation
 * with tie correction and continuity correction. NaN when either group has
 * fewer than 3 values.
 */
export function mannWhitneyP(a: ArrayLike<number>, b: ArrayLike<number>): number {
    const n1 = a.length, n2 = b.length;
    if (n1 < 3 || n2 < 3) return NaN;
    const all = Float64Array.from([...Array.from(a), ...Array.from(b)]);
    const ranks = averageRanks(all);
    let r1 = 0;
    for (let i = 0; i < n1; i++) r1 += ranks[i];
    const u = r1 - (n1 * (n1 + 1)) / 2;
    const N = n1 + n2;
    // Tie correction: sum of (t^3 - t) over tied groups
    const sorted = Array.from(all).sort((x, y) => x - y);
    let ties = 0;
    for (let i = 0; i < N;) {
        let k = i + 1;
        while (k < N && sorted[k] === sorted[i]) k++;
        const t = k - i;
        if (t > 1) ties += t * t * t - t;
        i = k;
    }
    const variance = (n1 * n2 / 12) * ((N + 1) - ties / (N * (N - 1)));
    if (!(variance > 0)) return 1;
    const mean = (n1 * n2) / 2;
    const z = (Math.abs(u - mean) - 0.5) / Math.sqrt(variance);
    return Math.min(1, 2 * (1 - normalCDF(Math.max(0, z))));
}

function median(x: number[]): number {
    if (!x.length) return NaN;
    const s = [...x].sort((p, q) => p - q);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface PairStability {
    i: number; j: number;
    varA: number; varB: number;
    nA: number; nB: number;
    /** Median ln(xi/xj) in each group */
    medianA: number; medianB: number;
    /** Mann-Whitney p for a difference in ln(xi/xj) between the groups */
    p: number;
}

/**
 * Is a pair equally tight, at the same ratio, in two groups (e.g. weathered
 * and fresh rock)? An immobile pair keeps both its variance and its ratio
 * level across the groups; a low p says the ratio itself shifts.
 */
export function pairStability(parts: ArrayLike<number>[], maskA: ArrayLike<number>, maskB: ArrayLike<number>, opts: VariationMatrixOptions = {}): PairStability[] {
    const A = logParts(parts, opts, maskA).logs;
    const B = logParts(parts, opts, maskB).logs;
    const out: PairStability[] = [];
    for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) {
            const da = pairDiffs(A[i], A[j]);
            const db = pairDiffs(B[i], B[j]);
            out.push({
                i, j, varA: popVariance(da), varB: popVariance(db), nA: da.length, nB: db.length,
                medianA: median(da), medianB: median(db), p: mannWhitneyP(da, db),
            });
        }
    }
    return out;
}

const csvText = (s: string) => `"${s.replace(/"/g, '""')}"`;
const csvNum = (x: number) => (Number.isFinite(x) ? String(+x.toPrecision(6)) : '');

/** The D x D matrix as CSV (diagonal 0, blank where not computable) */
export function variationMatrixCsv(names: string[], vm: VariationMatrixResult): string {
    const lines = [['', ...names].map(csvText).join(',')];
    vm.matrix.forEach((row, i) => lines.push([csvText(names[i]), ...row.map((v, j) => (i === j ? '0' : csvNum(v)))].join(',')));
    return lines.join('\r\n') + '\r\n';
}

/** Ranked pairs as CSV, with the two-group check when given */
export function rankedPairsCsv(names: string[], pairs: RankedPair[], stability?: { labelA: string; labelB: string; rows: PairStability[] } | null): string {
    const head = ['Pair', 'Part A', 'Part B', 'var(ln A/B)', 'n'];
    const byPair = new Map<string, PairStability>();
    if (stability) {
        head.push(`var in ${stability.labelA}`, `var in ${stability.labelB}`, `median ln ratio in ${stability.labelA}`,
            `median ln ratio in ${stability.labelB}`, 'Mann-Whitney p');
        for (const s of stability.rows) byPair.set(`${s.i}|${s.j}`, s);
    }
    const lines = [head.map(csvText).join(',')];
    for (const p of pairs) {
        const row = [csvText(`${names[p.i]}-${names[p.j]}`), csvText(names[p.i]), csvText(names[p.j]), csvNum(p.variance), String(p.n)];
        if (stability) {
            const s = byPair.get(`${p.i}|${p.j}`);
            row.push(...(s ? [s.varA, s.varB, s.medianA, s.medianB, s.p].map(csvNum) : ['', '', '', '', '']));
        }
        lines.push(row.join(','));
    }
    return lines.join('\r\n') + '\r\n';
}
