/**
 * Jenks Natural Breaks (Fisher-Jenks) algorithm
 * Finds optimal class breaks that minimize within-class variance
 */
export function jenksBreaks(data: number[], numClasses: number): number[] {
    if (data.length === 0) return [];
    if (numClasses >= data.length) return [...data].sort((a, b) => a - b);

    // Sort data
    const sortedData = [...data].sort((a, b) => a - b);
    const n = sortedData.length;

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
            const val = sortedData[lm - 1];

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
        breaks.push(sortedData[id]);
        k = lowerClassLimits[k][j] - 1;
    }

    breaks.push(sortedData[0]); // Add minimum
    return breaks.reverse();
}

/**
 * Equal interval classification
 */
export function equalIntervals(data: number[], numClasses: number): number[] {
    const min = Math.min(...data);
    const max = Math.max(...data);
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
    const sorted = [...data].sort((a, b) => a - b);
    const breaks: number[] = [sorted[0]];

    for (let i = 1; i < numClasses; i++) {
        const index = Math.floor((sorted.length * i) / numClasses);
        breaks.push(sorted[index]);
    }

    breaks.push(sorted[sorted.length - 1]);
    return breaks;
}

/**
 * Get value's class index based on breaks
 */
export function getClassIndex(value: number, breaks: number[]): number {
    for (let i = 0; i < breaks.length - 1; i++) {
        if (value >= breaks[i] && value < breaks[i + 1]) {
            return i;
        }
    }
    // Handle edge case: value equals max break
    return breaks.length - 2;
}

/**
 * Format break label
 */
export function formatBreakLabel(lower: number, upper: number, isLast: boolean = false): string {
    const lowerStr = lower.toFixed(2);
    const upperStr = upper.toFixed(2);

    if (isLast) {
        return `${lowerStr} - ${upperStr}`;
    }
    return `${lowerStr} - <${upperStr}`;
}
