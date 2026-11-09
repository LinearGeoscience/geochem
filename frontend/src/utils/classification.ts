/**
 * Subsample a sorted array to at most maxN values, preserving distribution
 * via stratified (evenly-spaced) index selection.
 */
function stratifiedSubsample(sorted: number[], maxN: number): number[] {
    if (sorted.length <= maxN) return sorted;
    const result = new Array(maxN);
    for (let i = 0; i < maxN; i++) {
        result[i] = sorted[Math.round(i * (sorted.length - 1) / (maxN - 1))];
    }
    return result;
}

// 4k evenly spaced values of the sorted data keep breaks within a fraction of a percentile
// and the O(n²) matrix fast enough to reclassify live (~0.15 s)
const JENKS_MAX_SAMPLE = 4000;

/**
 * Jenks Natural Breaks (Fisher-Jenks) algorithm
 * Finds optimal class breaks that minimize within-class variance.
 * For large datasets (>4k values), uses stratified subsampling to keep
 * the O(n²) matrix computation tractable, then maps breaks back to the
 * full sorted array for accurate min/max.
 */
export function jenksBreaks(data: number[], numClasses: number): number[] {
    if (data.length === 0) return [];
    if (numClasses >= data.length) return [...data].sort((a, b) => a - b);

    // Sort data
    const sortedData = Array.from(Float64Array.from(data).sort());

    // Subsample for the matrix computation if too large
    const sample = stratifiedSubsample(sortedData, JENKS_MAX_SAMPLE);
    const n = sample.length;

    // Initialize matrices
    const lowerClassLimits: number[][] = Array(n + 1).fill(0).map(() => Array(numClasses + 1).fill(0));
    const varianceCombinations: number[][] = Array(n + 1).fill(0).map(() => Array(numClasses + 1).fill(0));

    // Initialize
    for (let i = 1; i <= numClasses; i++) {
        lowerClassLimits[1][i] = 1;
        varianceCombinations[1][i] = 0;
        for (let j = 2; j <= n; j++) {
            varianceCombinations[j][i] = Infinity;
        }
    }

    // Calculate variance
    for (let l = 2; l <= n; l++) {
        let sum = 0;
        let sumSquares = 0;
        let w = 0;

        for (let m = 1; m <= l; m++) {
            const lm = l - m + 1;
            const val = sample[lm - 1];

            w++;
            sum += val;
            sumSquares += val * val;

            const variance = sumSquares - (sum * sum) / w;
            const i4 = lm - 1;

            if (i4 !== 0) {
                for (let j = 2; j <= numClasses; j++) {
                    if (varianceCombinations[l][j] >= variance + varianceCombinations[i4][j - 1]) {
                        lowerClassLimits[l][j] = lm;
                        varianceCombinations[l][j] = variance + varianceCombinations[i4][j - 1];
                    }
                }
            }
        }

        lowerClassLimits[l][1] = 1;
        varianceCombinations[l][1] = sumSquares - (sum * sum) / w;
    }

    // Extract breaks
    const breaks: number[] = [];
    let k = n;

    for (let j = numClasses; j >= 2; j--) {
        const id = lowerClassLimits[k][j] - 1;
        breaks.push(sample[id]);
        k = lowerClassLimits[k][j] - 1;
    }

    breaks.push(sample[0]); // Add minimum
    const result = breaks.reverse();
    result.push(sample[n - 1]); // Add maximum

    // Use the full sorted array's actual min/max for accurate endpoints
    result[0] = sortedData[0];
    result[result.length - 1] = sortedData[sortedData.length - 1];

    return result;
}

/**
 * Equal interval classification
 */
export function equalIntervals(data: number[], numClasses: number): number[] {
    let min = Infinity;
    let max = -Infinity;
    for (const v of data) {
        if (v < min) min = v;
        if (v > max) max = v;
    }
    const interval = (max - min) / numClasses;

    const breaks: number[] = [min];
    for (let i = 1; i < numClasses; i++) {
        breaks.push(min + interval * i);
    }
    breaks.push(max);

    return breaks;
}

/**
 * Quantile classification (equal count)
 */
export function quantileBreaks(data: number[], numClasses: number): number[] {
    const sorted = Float64Array.from(data).sort();
    const breaks: number[] = [sorted[0]];

    for (let i = 1; i < numClasses; i++) {
        const index = Math.floor((sorted.length * i) / numClasses);
        breaks.push(sorted[index]);
    }

    breaks.push(sorted[sorted.length - 1]);
    return breaks;
}

/**
 * Equal intervals on log10 (positive values set the breaks; a zero or
 * negative minimum stays the bottom of the first class)
 */
export function logEqualIntervals(data: number[], numClasses: number): number[] {
    let min = Infinity, max = -Infinity, minPos = Infinity;
    for (const v of data) {
        if (v < min) min = v;
        if (v > max) max = v;
        if (v > 0 && v < minPos) minPos = v;
    }
    if (!Number.isFinite(minPos) || max <= 0 || minPos === max) return equalIntervals(data, numClasses);
    const lo = Math.log10(minPos), hi = Math.log10(max);
    const breaks: number[] = [Math.min(min, minPos)];
    for (let i = 1; i < numClasses; i++) breaks.push(10 ** (lo + ((hi - lo) * i) / numClasses));
    breaks.push(max);
    return breaks;
}

/** Classes one standard deviation wide, centred on the mean, clipped to the data range */
export function stdDevBreaks(data: number[], numClasses: number): number[] {
    let min = Infinity, max = -Infinity, sum = 0;
    for (const v of data) { if (v < min) min = v; if (v > max) max = v; sum += v; }
    const mean = sum / data.length;
    let ss = 0;
    for (const v of data) ss += (v - mean) ** 2;
    const sd = Math.sqrt(ss / Math.max(1, data.length - 1));
    if (!(sd > 0)) return [min, max];
    const breaks = [min];
    for (let j = 0; j < numClasses - 1; j++) {
        const b = mean + sd * (j - (numClasses - 2) / 2);
        if (b > min && b < max) breaks.push(b);
    }
    breaks.push(max);
    return breaks;
}

/** standard percentile classes: 50th, 75th, 90th, 95th, 98th, 99th */
export const PERCENTILE_PRESET = [50, 75, 90, 95, 98, 99];

export function percentileBreaks(data: number[], percentiles: number[] = PERCENTILE_PRESET): number[] {
    const sorted = Float64Array.from(data).sort();
    const at = (p: number) => {
        const pos = (p / 100) * (sorted.length - 1);
        const lo = Math.floor(pos), hi = Math.ceil(pos);
        return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
    };
    return [sorted[0], ...percentiles.map(at), sorted[sorted.length - 1]];
}

/** Sorted breaks with repeats removed (duplicate quantiles would make empty, same-named classes) */
export function dedupeBreaks(breaks: number[]): number[] {
    const out: number[] = [];
    for (const b of [...breaks].sort((a, c) => a - c)) {
        if (!Number.isFinite(b)) continue;
        if (!out.length || b > out[out.length - 1]) out.push(b);
    }
    // a single-valued field still gets one class
    if (out.length === 1) out.push(out[0]);
    return out;
}
