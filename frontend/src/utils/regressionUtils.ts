/**
 * Linear regression utilities for calculating trend lines
 */

export interface RegressionResult {
    slope: number;
    intercept: number;
    rSquared: number;
    xValues: number[];
    yValues: number[];
}

/**
 * Calculate linear regression (least squares method)
 * Returns slope, intercept, and R² value
 */
export function calculateLinearRegression(
    xData: number[],
    yData: number[]
): RegressionResult | null {
    if (xData.length !== yData.length || xData.length < 2) {
        return null;
    }

    // Filter out null/undefined/NaN values
    const validPairs = xData
        .map((x, i) => ({ x, y: yData[i] }))
        .filter(pair =>
            pair.x != null &&
            pair.y != null &&
            !isNaN(pair.x) &&
            !isNaN(pair.y) &&
            isFinite(pair.x) &&
            isFinite(pair.y)
        );

    if (validPairs.length < 2) {
        return null;
    }

    const n = validPairs.length;
    const xs = validPairs.map(p => p.x);
    const ys = validPairs.map(p => p.y);

    // Calculate means
    const xMean = xs.reduce((sum, x) => sum + x, 0) / n;
    const yMean = ys.reduce((sum, y) => sum + y, 0) / n;

    // Calculate slope and intercept using least squares
    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < n; i++) {
        const xDiff = xs[i] - xMean;
        const yDiff = ys[i] - yMean;
        numerator += xDiff * yDiff;
        denominator += xDiff * xDiff;
    }

    if (denominator === 0) {
        return null; // Vertical line, can't calculate slope
    }

    const slope = numerator / denominator;
    const intercept = yMean - slope * xMean;

    // Calculate R² (coefficient of determination)
    let ssRes = 0; // Sum of squares of residuals
    let ssTot = 0; // Total sum of squares

    for (let i = 0; i < n; i++) {
        const predicted = slope * xs[i] + intercept;
        ssRes += Math.pow(ys[i] - predicted, 2);
        ssTot += Math.pow(ys[i] - yMean, 2);
    }

    const rSquared = ssTot === 0 ? 0 : 1 - (ssRes / ssTot);

    // Generate line points from min to max x
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const xValues = [xMin, xMax];
    const yValues = xValues.map(x => slope * x + intercept);

    return {
        slope,
        intercept,
        rSquared,
        xValues,
        yValues
    };
}
