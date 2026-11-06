/**
 * Multi-element anomaly ranking (pure).
 *
 * Each element is scored against the distribution of its own group (e.g.
 * Sample_Type: soils are compared with soils, rock chips with rock chips),
 * then combined into a weighted score per sample and ranked.
 *
 * Inputs must be ANALYTICAL values (below-detection already substituted —
 * appStore.getColumn / getAnalyticalStore), never the raw -DL values.
 *
 * Scoring methods:
 *  - 'percentile': empirical percentile rank 0-100 within the group, ties
 *    averaged (Hazen: (below + equal/2) / n).
 *  - 'zscore-log': robust z-score of log10(value) within the group:
 *    (log v - median) / (1.4826 * MAD), falling back to the standard
 *    deviation when MAD is 0, and to 0 when the group has no spread.
 *
 * Anomaly flags always use the within-group percentile (>= anomalyPercentile),
 * whichever method produces the score.
 */

export type RankingMethod = 'percentile' | 'zscore-log';

export interface RankingOptions {
    /** One weight per element (any non-negative scale; normalised per row). */
    weights: number[];
    /** Group label per row (null/undefined = whole dataset as one group). */
    groups?: ArrayLike<string> | null;
    method?: RankingMethod;
    /** Rows with fewer valid elements than this get a NaN score. Default 1. */
    minElements?: number;
    /** Groups with fewer valid values than this use the whole-dataset distribution. Default 20. */
    minGroupSize?: number;
    /** Percentile at/above which an element counts as anomalous (e.g. 90). Default 90. */
    anomalyPercentile?: number;
    /** 1 = row takes part (e.g. visible after attribute filtering). Default: all rows. */
    rowMask?: ArrayLike<number> | null;
}

export interface RankingResult {
    /** Weighted score per row (NaN when not scored) */
    score: Float64Array;
    /** Number of elements at/above the anomaly percentile, per row */
    anomalousCount: Int32Array;
    /** Per element: the element's within-group percentile for each row (NaN if missing) */
    percentiles: Float64Array[];
    /** Per element: the element's weighted contribution to the score */
    contributions: Float64Array[];
    /** 1 = highest score; 0 = not ranked */
    rank: Int32Array;
    /** Row indices of scored rows, highest score first */
    order: Int32Array;
}

// ---------------------------------------------------------------------------
// Distribution helpers
// ---------------------------------------------------------------------------

function lowerBound(sorted: Float64Array, v: number): number {
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (sorted[mid] < v) lo = mid + 1; else hi = mid; }
    return lo;
}

function upperBound(sorted: Float64Array, v: number): number {
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (sorted[mid] <= v) lo = mid + 1; else hi = mid; }
    return lo;
}

/** Percentile (0-100) of v within a sorted sample, ties averaged. */
export function percentileOf(sorted: Float64Array, v: number): number {
    const n = sorted.length;
    if (n === 0) return NaN;
    const below = lowerBound(sorted, v);
    const equal = upperBound(sorted, v) - below;
    return (100 * (below + equal / 2)) / n;
}

function median(sorted: Float64Array): number {
    const n = sorted.length;
    if (n === 0) return NaN;
    return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

interface Distribution {
    sorted: Float64Array;       // raw values, for percentiles
    logCentre: number;          // median of log10 values
    logScale: number;           // robust spread of log10 values (0 = none)
}

function buildDistribution(values: Float64Array, withLogStats: boolean): Distribution {
    const sorted = values.slice().sort();
    if (!withLogStats) return { sorted, logCentre: NaN, logScale: 0 };
    let m = 0;
    const logs = new Float64Array(sorted.length);
    for (let i = 0; i < sorted.length; i++) if (sorted[i] > 0) logs[m++] = Math.log10(sorted[i]);
    const logSorted = logs.subarray(0, m); // already ascending: log10 is monotonic
    const centre = median(logSorted);
    const dev = new Float64Array(m);
    for (let i = 0; i < m; i++) dev[i] = Math.abs(logSorted[i] - centre);
    dev.sort();
    let scale = 1.4826 * median(dev);
    if (!(scale > 0) && m > 1) {
        let mean = 0;
        for (let i = 0; i < m; i++) mean += logSorted[i];
        mean /= m;
        let ss = 0;
        for (let i = 0; i < m; i++) ss += (logSorted[i] - mean) ** 2;
        scale = Math.sqrt(ss / (m - 1));
    }
    return { sorted, logCentre: centre, logScale: scale > 0 ? scale : 0 };
}

function valuesOf(col: ArrayLike<number>, rows: number[]): Float64Array {
    const out = new Float64Array(rows.length);
    let k = 0;
    for (const i of rows) { const v = col[i]; if (Number.isFinite(v)) out[k++] = v; }
    return out.subarray(0, k);
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

export function rankAnomalies(elements: ArrayLike<number>[], options: RankingOptions): RankingResult {
    const nEl = elements.length;
    const n = nEl > 0 ? elements[0].length : 0;
    const {
        weights, groups = null, method = 'percentile', minElements = 1,
        minGroupSize = 20, anomalyPercentile = 90, rowMask = null,
    } = options;
    if (weights.length !== nEl) throw new Error('rankAnomalies: one weight per element is required');

    const included = (i: number) => !rowMask || rowMask[i] === 1;

    // Group membership (only included rows)
    const groupRows = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
        if (!included(i)) continue;
        const g = groups ? String(groups[i] ?? '') : '';
        let list = groupRows.get(g);
        if (!list) { list = []; groupRows.set(g, list); }
        list.push(i);
    }

    const percentiles: Float64Array[] = [];
    const scores: Float64Array[] = [];   // per element: method score (percentile or z)
    for (let e = 0; e < nEl; e++) {
        const col = elements[e];
        const pct = new Float64Array(n).fill(NaN);
        const sc = new Float64Array(n).fill(NaN);
        const withLog = method === 'zscore-log';

        // Whole-dataset distribution: only built if some group is too small
        let global: Distribution | null | undefined;
        const getGlobal = () => {
            if (global === undefined) {
                const all: number[] = [];
                for (const rows of groupRows.values()) for (const i of rows) all.push(i);
                const values = valuesOf(col, all);
                global = values.length > 0 ? buildDistribution(values, withLog) : null;
            }
            return global;
        };

        for (const rows of groupRows.values()) {
            const values = valuesOf(col, rows);
            const dist = values.length >= minGroupSize ? buildDistribution(values, withLog) : getGlobal();
            if (!dist) continue;
            for (const i of rows) {
                const v = col[i];
                if (!Number.isFinite(v)) continue;
                pct[i] = percentileOf(dist.sorted, v);
                if (method === 'percentile') sc[i] = pct[i];
                else sc[i] = v > 0 && dist.logScale > 0 ? (Math.log10(v) - dist.logCentre) / dist.logScale : v > 0 ? 0 : NaN;
            }
        }
        percentiles.push(pct);
        scores.push(sc);
    }

    const score = new Float64Array(n).fill(NaN);
    const anomalousCount = new Int32Array(n);
    const contributions = Array.from({ length: nEl }, () => new Float64Array(n).fill(NaN));
    for (let i = 0; i < n; i++) {
        if (!included(i)) continue;
        let wSum = 0, sSum = 0, count = 0;
        for (let e = 0; e < nEl; e++) {
            const s = scores[e][i];
            if (!Number.isFinite(s) || !(weights[e] > 0)) continue;
            wSum += weights[e];
            sSum += weights[e] * s;
            count++;
            if (percentiles[e][i] >= anomalyPercentile) anomalousCount[i]++;
        }
        if (count < Math.max(1, minElements) || wSum === 0) continue;
        score[i] = sSum / wSum;
        for (let e = 0; e < nEl; e++) {
            const s = scores[e][i];
            if (Number.isFinite(s) && weights[e] > 0) contributions[e][i] = (weights[e] * s) / wSum;
        }
    }

    const scored: number[] = [];
    for (let i = 0; i < n; i++) if (Number.isFinite(score[i])) scored.push(i);
    scored.sort((a, b) => score[b] - score[a] || anomalousCount[b] - anomalousCount[a] || a - b);
    const rank = new Int32Array(n);
    scored.forEach((row, k) => { rank[row] = k + 1; });

    return { score, anomalousCount, percentiles, contributions, rank, order: Int32Array.from(scored) };
}
