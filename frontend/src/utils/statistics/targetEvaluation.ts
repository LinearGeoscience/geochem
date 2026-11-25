/**
 * How well does a score (an index, a vector, a model output) pick out a
 * target (gold above a cut-off, say)? Methods that respect the order of the
 * samples, because neighbouring samples down a hole are not independent:
 *
 *  - ROC curve and AUC (Mann-Whitney: the chance a random target sample
 *    outscores a random background sample; 0.5 = guessing)
 *  - precision-recall curve and average precision (compare with the base
 *    rate: the share of target samples)
 *  - capture curve: share of the target total (e.g. metal) in the top x % of
 *    samples by score, the practical "what do I catch if I assay the top 20 %"
 *  - moving-block bootstrap confidence intervals: resample runs of
 *    consecutive samples, so the interval is not falsely narrow
 *  - circular-shift p-values: slide the target past the score (keeping each
 *    sequence's own auto-correlation) to build the "no relationship" case
 *  - Benjamini-Hochberg q-values when many variables are tested at once
 */
import { averageRanks, spearmanCorrelation } from './correlation';
import { seededRandom, randomInt } from './random';

const isPos = (v: number | boolean) => v === true || v === 1;

/** Area under the ROC curve (ties count half). NaN when one class is empty. */
export function aucScore(scores: ArrayLike<number>, labels: ArrayLike<number | boolean>): number {
    const n = scores.length;
    const ranks = averageRanks(scores);
    let nPos = 0, sumPos = 0;
    for (let i = 0; i < n; i++) if (isPos(labels[i])) { nPos++; sumPos += ranks[i]; }
    const nNeg = n - nPos;
    if (nPos === 0 || nNeg === 0) return NaN;
    return (sumPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

export interface Curve { x: number[]; y: number[] }

/** ROC curve points (false-positive rate, true-positive rate), one per distinct score */
export function rocCurve(scores: ArrayLike<number>, labels: ArrayLike<number | boolean>): Curve {
    const o = Array.from({ length: scores.length }, (_, i) => i).sort((a, b) => scores[b] - scores[a]);
    const P = o.filter(i => isPos(labels[i])).length, N = o.length - P;
    const x = [0], y = [0];
    let tp = 0, fp = 0;
    for (let k = 0; k < o.length; k++) {
        if (isPos(labels[o[k]])) tp++; else fp++;
        if (k === o.length - 1 || scores[o[k + 1]] !== scores[o[k]]) { x.push(N ? fp / N : 0); y.push(P ? tp / P : 0); }
    }
    return { x, y };
}

/** Precision-recall curve (x = recall, y = precision) and average precision (scikit-learn definition) */
export function prCurve(scores: ArrayLike<number>, labels: ArrayLike<number | boolean>): Curve & { averagePrecision: number; baseRate: number } {
    const o = Array.from({ length: scores.length }, (_, i) => i).sort((a, b) => scores[b] - scores[a]);
    const P = o.filter(i => isPos(labels[i])).length;
    const x: number[] = [], y: number[] = [];
    let tp = 0, ap = 0, prevR = 0;
    for (let k = 0; k < o.length; k++) {
        if (isPos(labels[o[k]])) tp++;
        if (k === o.length - 1 || scores[o[k + 1]] !== scores[o[k]]) {
            const r = P ? tp / P : 0, p = tp / (k + 1);
            ap += (r - prevR) * p;
            prevR = r;
            x.push(r); y.push(p);
        }
    }
    return { x, y, averagePrecision: P ? ap : NaN, baseRate: o.length ? P / o.length : NaN };
}

/** Share of the target total (negatives count 0) caught in the top fraction of samples by score */
export function captureCurve(scores: ArrayLike<number>, weights: ArrayLike<number>): Curve {
    const o = Array.from({ length: scores.length }, (_, i) => i).sort((a, b) => scores[b] - scores[a]);
    const w = o.map(i => Math.max(0, weights[i]));
    const total = w.reduce((s, v) => s + v, 0);
    const x = [0], y = [0];
    let c = 0;
    for (let k = 0; k < w.length; k++) { c += w[k]; x.push((k + 1) / w.length); y.push(total ? c / total : 0); }
    return { x, y };
}

/** Share of the target total in the top `fraction` of samples (read off the capture curve, interpolated) */
export function captureAt(scores: ArrayLike<number>, weights: ArrayLike<number>, fraction: number): number {
    const c = captureCurve(scores, weights);
    const n = c.x.length - 1;
    if (n <= 0) return NaN;
    const pos = Math.min(n, Math.max(0, fraction * n));
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return c.y[lo] + (c.y[hi] - c.y[lo]) * (pos - lo);
}

export interface BootstrapOptions {
    blockLength?: number;
    resamples?: number;
    seed?: number;
    /** Confidence level (default 0.95) */
    level?: number;
}

/**
 * Moving-block bootstrap: draw ceil(n / L) blocks of L consecutive samples
 * (with replacement), join and cut to n; recompute the statistic on each
 * resample; return the percentile interval. Resamples where the statistic
 * is not defined (one class missing) are dropped.
 */
export function blockBootstrapCI(n: number, stat: (idx: Int32Array) => number, opts: BootstrapOptions = {}): [number, number] {
    const L = Math.max(1, Math.min(n, opts.blockLength ?? 10));
    const B = opts.resamples ?? 500;
    const rand = seededRandom(opts.seed ?? 42);
    const nb = Math.ceil(n / L);
    const vals: number[] = [];
    const idx = new Int32Array(n);
    for (let b = 0; b < B; b++) {
        let k = 0;
        for (let j = 0; j < nb && k < n; j++) {
            const s = randomInt(rand, n - L + 1);
            for (let t = 0; t < L && k < n; t++) idx[k++] = s + t;
        }
        const v = stat(idx);
        if (Number.isFinite(v)) vals.push(v);
    }
    if (!vals.length) return [NaN, NaN];
    vals.sort((a, b) => a - b);
    const a = (1 - (opts.level ?? 0.95)) / 2;
    const q = (p: number) => {
        const pos = (vals.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos);
        return vals[lo] + (vals[hi] - vals[lo]) * (pos - lo);
    };
    return [q(a), q(1 - a)];
}

/**
 * Circular-shift p-value: the share of shifts (of the second series against
 * the first, by minShift .. n - minShift places) whose statistic is at least
 * as far from `centre` as the observed one.
 */
export function circularShiftP(
    x: ArrayLike<number>, y: ArrayLike<number>, stat: (x: ArrayLike<number>, y: ArrayLike<number>) => number,
    centre = 0, minShift = 15,
): number {
    const n = x.length;
    const obs = Math.abs(stat(x, y) - centre);
    let ge = 0, total = 0;
    const shifted = new Float64Array(n);
    for (let s = minShift; s < n - minShift; s++) {
        // numpy.roll(y, s): element i moves to i + s
        for (let i = 0; i < n; i++) shifted[(i + s) % n] = y[i];
        const v = stat(x, shifted);
        if (!Number.isFinite(v)) continue;
        total++;
        if (Math.abs(v - centre) >= obs) ge++;
    }
    return total ? ge / total : NaN;
}

/** Benjamini-Hochberg q-values (false discovery rate) */
export function benjaminiHochberg(p: ArrayLike<number>): number[] {
    const m = p.length;
    const o = Array.from({ length: m }, (_, i) => i).sort((a, b) => p[a] - p[b]);
    const q = new Array<number>(m);
    let min = Infinity;
    for (let k = m - 1; k >= 0; k--) {
        min = Math.min(min, (p[o[k]] * m) / (k + 1));
        q[o[k]] = Math.min(1, min);
    }
    return q;
}

/** Rows where every series is finite, in the given order */
export function completeRows(order: ArrayLike<number>, ...series: ArrayLike<number>[]): number[] {
    const out: number[] = [];
    for (let k = 0; k < order.length; k++) {
        const i = order[k];
        if (series.every(s => Number.isFinite(s[i]))) out.push(i);
    }
    return out;
}

export interface ScoreEvaluation {
    n: number;
    nTarget: number;
    auc: number;
    aucCI: [number, number];
    averagePrecision: number;
    baseRate: number;
    /** Share of the target total in the top 10 / 20 / 30 % */
    capture10: number;
    capture20: number;
    capture30: number;
    roc: Curve;
    pr: Curve;
    capture: Curve;
}

export interface EvaluateOptions extends BootstrapOptions {
    /** Target at or above this is a "hit" */
    threshold: number;
    /** Row order for the bootstrap (sequence order); default the dataset order */
    order?: ArrayLike<number>;
}

export function evaluateScore(score: ArrayLike<number>, target: ArrayLike<number>, opts: EvaluateOptions): ScoreEvaluation {
    const order = opts.order ?? Array.from({ length: score.length }, (_, i) => i);
    const rows = completeRows(order, score, target);
    const s = rows.map(i => score[i]);
    const t = rows.map(i => target[i]);
    const y: number[] = t.map(v => (v >= opts.threshold ? 1 : 0));
    const auc = aucScore(s, y);
    const ci = blockBootstrapCI(rows.length, idx => {
        const ss = new Array(idx.length), yy = new Array(idx.length);
        for (let k = 0; k < idx.length; k++) { ss[k] = s[idx[k]]; yy[k] = y[idx[k]]; }
        return aucScore(ss, yy);
    }, opts);
    const pr = prCurve(s, y);
    return {
        n: rows.length, nTarget: y.reduce((a, b) => a + b, 0), auc, aucCI: ci,
        averagePrecision: pr.averagePrecision, baseRate: pr.baseRate,
        capture10: captureAt(s, t, 0.1), capture20: captureAt(s, t, 0.2), capture30: captureAt(s, t, 0.3),
        roc: rocCurve(s, y), pr: { x: pr.x, y: pr.y }, capture: captureCurve(s, t),
    };
}

export interface ScreeningRow {
    name: string;
    n: number;
    auc: number;
    aucCI: [number, number];
    pShiftAuc: number;
    rho: number;
    pShiftRho: number;
    averagePrecision: number;
    /** Benjamini-Hochberg q of the AUC shift p-values */
    q: number;
}

export interface ScreeningOptions extends EvaluateOptions {
    minShift?: number;
}

/**
 * Rank every candidate variable against a target: AUC (target >= threshold)
 * and Spearman rho (target values), with circular-shift p-values and FDR
 * q-values. All candidates are judged on the rows where the target is known,
 * in sequence order; a candidate's missing rows are left out of its own stats.
 */
export function screenVariables(
    features: Array<{ name: string; values: ArrayLike<number> }>, target: ArrayLike<number>, opts: ScreeningOptions,
): ScreeningRow[] {
    const order = opts.order ?? Array.from({ length: target.length }, (_, i) => i);
    const rows: ScreeningRow[] = [];
    for (const f of features) {
        const idx = completeRows(order, f.values, target);
        if (idx.length < 10) continue;
        const x = idx.map(i => f.values[i]);
        const t = idx.map(i => target[i]);
        const y: number[] = t.map(v => (v >= opts.threshold ? 1 : 0));
        const aucStat = (a: ArrayLike<number>, b: ArrayLike<number>) => aucScore(a, b as ArrayLike<number>);
        const auc = aucScore(x, y);
        if (!Number.isFinite(auc)) continue;
        rows.push({
            name: f.name, n: idx.length, auc,
            aucCI: blockBootstrapCI(idx.length, ii => {
                const xs = new Array(ii.length), ys = new Array(ii.length);
                for (let k = 0; k < ii.length; k++) { xs[k] = x[ii[k]]; ys[k] = y[ii[k]]; }
                return aucScore(xs, ys);
            }, opts),
            pShiftAuc: circularShiftP(x, y, aucStat, 0.5, opts.minShift ?? 15),
            rho: spearmanCorrelation(x, t),
            pShiftRho: circularShiftP(x, t, spearmanCorrelation, 0, opts.minShift ?? 15),
            averagePrecision: prCurve(x, y).averagePrecision,
            q: NaN,
        });
    }
    const q = benjaminiHochberg(rows.map(r => r.pShiftAuc));
    rows.forEach((r, i) => { r.q = q[i]; });
    return rows.sort((a, b) => b.auc - a.auc);
}

// ---------------------------------------------------------------------------
// Comparing scores and calibrating bands
// ---------------------------------------------------------------------------

/** Scores for a forest (dot-and-whisker) chart: highest AUC first, undefined AUCs last */
export function forestOrder<T extends { auc: number }>(rows: T[]): T[] {
    const key = (v: number) => (Number.isFinite(v) ? v : -Infinity);
    return rows.map((r, i) => ({ r, i })).sort((a, b) => key(b.r.auc) - key(a.r.auc) || a.i - b.i).map(e => e.r);
}

/** Linear-interpolation quantile of sorted values */
function quantileSorted(v: ArrayLike<number>, p: number): number {
    if (!v.length) return NaN;
    const pos = (v.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos);
    return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

const shortNum = (v: number) => String(+v.toPrecision(3));

export interface Banding {
    /** Band of each row (null = no band: value missing) */
    bands: (string | null)[];
    /** Bands from lowest to highest */
    order: string[];
}

/**
 * Bands of a numeric column at cut points (sorted, repeats dropped): below
 * the first cut, [cut i, cut i+1), and at or above the last cut. A value equal
 * to a cut belongs to the band above it. Missing values get no band.
 */
export function binAtThresholds(values: ArrayLike<number>, cuts: number[], names?: string[]): Banding {
    const c = [...new Set(cuts.filter(Number.isFinite))].sort((a, b) => a - b);
    const order = names && names.length === c.length + 1 ? names
        : c.length === 0 ? ['All']
            : [`< ${shortNum(c[0])}`, ...c.slice(1).map((v, i) => `${shortNum(c[i])}–${shortNum(v)}`), `≥ ${shortNum(c[c.length - 1])}`];
    const bands = Array.from(values, v => {
        if (!Number.isFinite(v)) return null;
        let b = 0;
        while (b < c.length && v >= c[b]) b++;
        return order[b];
    });
    return { bands, order };
}

/**
 * Cut points that split the finite values into k groups of (about) equal
 * size. Tied values can merge groups: repeated cuts, and cuts at the
 * minimum (which would leave an empty lowest group), are dropped.
 */
export function quantileCuts(values: ArrayLike<number>, k: number): number[] {
    const v = Float64Array.from(Array.from(values).filter(Number.isFinite)).sort();
    const n = Math.max(1, Math.floor(k));
    if (!v.length || n < 2) return [];
    return [...new Set(Array.from({ length: n - 1 }, (_, j) => quantileSorted(v, (j + 1) / n)))].filter(c => c > v[0]);
}

/**
 * Quantile bands (Q1 lowest), named with their ranges. The cut points come
 * from `basis` when given (e.g. only the rows with a target value, so the
 * bands hold similar numbers of evaluated samples), else from `values`.
 */
export function binAtQuantiles(values: ArrayLike<number>, k: number, basis?: ArrayLike<number>): Banding {
    const cuts = quantileCuts(basis ?? values, k);
    const plain = binAtThresholds([], cuts).order;
    return binAtThresholds(values, cuts, plain.map((r, i) => `Q${i + 1} (${r})`));
}

/** Band names in natural order: numbers by value, text with numbers inside numeric-aware */
export function naturalBandOrder(names: Iterable<string>): string[] {
    return [...new Set(names)].sort((a, b) => {
        const x = Number(a), y = Number(b);
        if (a.trim() !== '' && b.trim() !== '' && Number.isFinite(x) && Number.isFinite(y)) return x - y;
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });
}

export interface BandCalibrationRow {
    band: string;
    /** Rows in the band with a target value (blank targets are not counted) */
    n: number;
    /** Rows at or above each cut-off, and their share of n */
    hits: number[];
    rates: number[];
    median: number;
    p25: number;
    p75: number;
    max: number;
}

/**
 * Target per band: how many samples, the share at or above each cut-off
 * (inclusive), and the median, quartiles and maximum. Only rows with a
 * finite target count; zero and negative targets are values like any other.
 * Rows without a band (null / blank) are left out. Bands come in `order`
 * when given (every listed band, even an empty one; bands not listed
 * follow, in natural order), else in natural order.
 */
export function bandCalibration(
    target: ArrayLike<number>, bands: ArrayLike<string | null | undefined>, thresholds: number[], order?: string[],
): BandCalibrationRow[] {
    const groups = new Map<string, number[]>();
    for (let i = 0; i < target.length; i++) {
        const b = bands[i];
        if (b === null || b === undefined || String(b).trim() === '') continue;
        const key = String(b);
        let g = groups.get(key);
        if (!g) { g = []; groups.set(key, g); }
        if (Number.isFinite(target[i])) g.push(target[i]);
    }
    // Listed bands are all shown (an empty bin is information too)
    const listed = [...new Set(order ?? [])];
    const rest = naturalBandOrder([...groups.keys()].filter(b => !listed.includes(b)));
    return [...listed, ...rest].map(band => {
        const v = Float64Array.from(groups.get(band) ?? []).sort();
        const hits = thresholds.map(t => v.reduce((s, x) => s + (x >= t ? 1 : 0), 0));
        return {
            band, n: v.length, hits, rates: hits.map(h => (v.length ? h / v.length : NaN)),
            median: quantileSorted(v, 0.5), p25: quantileSorted(v, 0.25), p75: quantileSorted(v, 0.75),
            max: v.length ? v[v.length - 1] : NaN,
        };
    });
}
