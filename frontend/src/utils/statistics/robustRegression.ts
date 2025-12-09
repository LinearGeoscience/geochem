/**
 * Robust Regression Methods
 * Includes OLS, Least Trimmed Squares (LTS), and M-estimators
 */

import {
    RegressionMethod,
    RobustRegressionConfig,
    RegressionResult,
    GroupedRegressionResult,
} from '../../types/statistics';

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Calculate mean of numeric array (handles nulls)
 */
function mean(values: (number | null)[]): number {
    const valid = values.filter((v): v is number => v !== null);
    if (valid.length === 0) return 0;
    return valid.reduce((a, b) => a + b, 0) / valid.length;
}


/**
 * Calculate median
 */
function median(values: (number | null)[]): number {
    const sorted = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
    if (sorted.length === 0) return 0;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Calculate MAD (Median Absolute Deviation)
 */
function mad(values: (number | null)[]): number {
    const valid = values.filter((v): v is number => v !== null);
    if (valid.length === 0) return 0;
    const med = median(valid);
    const deviations = valid.map(v => Math.abs(v - med));
    return median(deviations);
}

/**
 * T-distribution critical value approximation
 * For confidence intervals
 */
function tCritical(df: number, alpha: number): number {
    // Approximation for common confidence levels
    if (alpha === 0.05) {
        if (df >= 120) return 1.96;
        if (df >= 60) return 2.0;
        if (df >= 30) return 2.04;
        if (df >= 20) return 2.086;
        if (df >= 15) return 2.131;
        if (df >= 10) return 2.228;
        if (df >= 5) return 2.571;
        return 2.776;
    }
    if (alpha === 0.01) {
        if (df >= 120) return 2.576;
        if (df >= 60) return 2.66;
        if (df >= 30) return 2.75;
        if (df >= 20) return 2.845;
        if (df >= 10) return 3.169;
        return 3.707;
    }
    // Fallback
    return 1.96;
}

// =============================================================================
// ORDINARY LEAST SQUARES (OLS)
// =============================================================================

interface OLSResult {
    slope: number;
    intercept: number;
    rSquared: number;
    se: number;
    slopeStdErr: number;
    interceptStdErr: number;
    residuals: number[];
    fitted: number[];
}

/**
 * Ordinary Least Squares regression
 */
function ols(x: number[], y: number[]): OLSResult {
    const n = x.length;
    if (n < 2) {
        return {
            slope: 0,
            intercept: mean(y),
            rSquared: 0,
            se: 0,
            slopeStdErr: 0,
            interceptStdErr: 0,
            residuals: y.map(yi => yi - mean(y)),
            fitted: y.map(() => mean(y)),
        };
    }

    const xMean = mean(x);
    const yMean = mean(y);

    let ssXX = 0;
    let ssXY = 0;
    let ssYY = 0;

    for (let i = 0; i < n; i++) {
        const dx = x[i] - xMean;
        const dy = y[i] - yMean;
        ssXX += dx * dx;
        ssXY += dx * dy;
        ssYY += dy * dy;
    }

    const slope = ssXX > 0 ? ssXY / ssXX : 0;
    const intercept = yMean - slope * xMean;

    // Calculate fitted values and residuals
    const fitted = x.map(xi => slope * xi + intercept);
    const residuals = y.map((yi, i) => yi - fitted[i]);

    // Calculate R-squared
    const ssRes = residuals.reduce((sum, r) => sum + r * r, 0);
    const ssTot = ssYY;
    const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    // Standard error of regression
    const df = n - 2;
    const mse = df > 0 ? ssRes / df : 0;
    const se = Math.sqrt(mse);

    // Standard errors of coefficients
    const slopeStdErr = ssXX > 0 ? se / Math.sqrt(ssXX) : 0;
    const interceptStdErr = se * Math.sqrt(1 / n + (xMean * xMean) / ssXX);

    return {
        slope,
        intercept,
        rSquared,
        se,
        slopeStdErr,
        interceptStdErr,
        residuals,
        fitted,
    };
}

// =============================================================================
// LEAST TRIMMED SQUARES (LTS)
// =============================================================================

/**
 * Least Trimmed Squares regression
 * Robust method that minimizes the sum of the h smallest squared residuals
 * where h = floor(n * trimFraction)
 */
function lts(
    x: number[],
    y: number[],
    trimFraction: number = 0.75,
    nSubsamples: number = 500
): OLSResult {
    const n = x.length;
    const h = Math.max(2, Math.floor(n * trimFraction));

    let bestSlope = 0;
    let bestIntercept = 0;
    let bestSumSquares = Infinity;

    // Elemental sets approach: random subsamples of size 2
    for (let iter = 0; iter < nSubsamples; iter++) {
        // Randomly select 2 points
        const idx1 = Math.floor(Math.random() * n);
        let idx2 = Math.floor(Math.random() * n);
        while (idx2 === idx1) {
            idx2 = Math.floor(Math.random() * n);
        }

        // Compute line through these two points
        const dx = x[idx2] - x[idx1];
        if (Math.abs(dx) < 1e-10) continue;

        const slope = (y[idx2] - y[idx1]) / dx;
        const intercept = y[idx1] - slope * x[idx1];

        // Calculate all residuals
        const residuals = y.map((yi, i) => yi - (slope * x[i] + intercept));
        const squaredResiduals = residuals.map(r => r * r);

        // Sort and take h smallest
        const sortedSquares = [...squaredResiduals].sort((a, b) => a - b);
        const sumSquares = sortedSquares.slice(0, h).reduce((a, b) => a + b, 0);

        if (sumSquares < bestSumSquares) {
            bestSumSquares = sumSquares;
            bestSlope = slope;
            bestIntercept = intercept;
        }
    }

    // C-step refinement: iteratively improve the fit
    for (let refine = 0; refine < 10; refine++) {
        // Calculate residuals with current best fit
        const residuals = y.map((yi, i) => yi - (bestSlope * x[i] + bestIntercept));
        const squaredResiduals = residuals.map(r => r * r);

        // Find indices of h smallest residuals
        const indexedSquares = squaredResiduals.map((sq, idx) => ({ sq, idx }));
        indexedSquares.sort((a, b) => a.sq - b.sq);
        const hIndices = indexedSquares.slice(0, h).map(item => item.idx);

        // Refit OLS on selected subset
        const xSubset = hIndices.map(i => x[i]);
        const ySubset = hIndices.map(i => y[i]);
        const subsetResult = ols(xSubset, ySubset);

        const newSumSquares = hIndices.reduce(
            (sum, i) => sum + Math.pow(y[i] - (subsetResult.slope * x[i] + subsetResult.intercept), 2),
            0
        );

        if (newSumSquares < bestSumSquares - 1e-10) {
            bestSumSquares = newSumSquares;
            bestSlope = subsetResult.slope;
            bestIntercept = subsetResult.intercept;
        } else {
            break; // Converged
        }
    }

    // Calculate final statistics using best fit
    const fitted = x.map(xi => bestSlope * xi + bestIntercept);
    const residuals = y.map((yi, i) => yi - fitted[i]);

    // Calculate R-squared using all data
    const yMean = mean(y);
    const ssTot = y.reduce((sum, yi) => sum + Math.pow(yi - yMean, 2), 0);
    const ssRes = residuals.reduce((sum, r) => sum + r * r, 0);
    const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    // Robust scale estimate
    const scale = 1.4826 * mad(residuals);
    const df = h - 2;
    const mse = df > 0 ? bestSumSquares / df : 0;
    const se = Math.sqrt(mse);

    // Standard errors (approximate)
    const xMean = mean(x);
    const ssXX = x.reduce((sum, xi) => sum + Math.pow(xi - xMean, 2), 0);
    const slopeStdErr = ssXX > 0 ? scale / Math.sqrt(ssXX) : 0;
    const interceptStdErr = scale * Math.sqrt(1 / n + (xMean * xMean) / ssXX);

    return {
        slope: bestSlope,
        intercept: bestIntercept,
        rSquared,
        se,
        slopeStdErr,
        interceptStdErr,
        residuals,
        fitted,
    };
}

// =============================================================================
// M-ESTIMATOR REGRESSION (Bisquare / Huber)
// =============================================================================

/**
 * Bisquare weight function (Tukey's biweight)
 */
function bisquareWeight(r: number, c: number = 4.685): number {
    const u = r / c;
    if (Math.abs(u) > 1) return 0;
    return Math.pow(1 - u * u, 2);
}

/**
 * Huber weight function
 */
function huberWeight(r: number, k: number = 1.345): number {
    if (Math.abs(r) <= k) return 1;
    return k / Math.abs(r);
}

/**
 * Iteratively Reweighted Least Squares (IRLS) for M-estimation
 */
function mEstimator(
    x: number[],
    y: number[],
    weightFn: (r: number, c: number) => number,
    tuningConstant: number,
    maxIter: number = 50,
    tolerance: number = 1e-6
): OLSResult {
    const n = x.length;

    // Initial OLS fit
    let result = ols(x, y);
    let prevSlope = result.slope;
    let prevIntercept = result.intercept;

    for (let iter = 0; iter < maxIter; iter++) {
        // Calculate standardized residuals
        const scale = 1.4826 * mad(result.residuals);
        if (scale < 1e-10) break;

        const standardizedResiduals = result.residuals.map(r => r / scale);

        // Calculate weights
        const weights = standardizedResiduals.map(sr => weightFn(sr, tuningConstant));

        // Weighted least squares
        let sumW = 0;
        let sumWX = 0;
        let sumWY = 0;
        let sumWXX = 0;
        let sumWXY = 0;

        for (let i = 0; i < n; i++) {
            const w = weights[i];
            sumW += w;
            sumWX += w * x[i];
            sumWY += w * y[i];
            sumWXX += w * x[i] * x[i];
            sumWXY += w * x[i] * y[i];
        }

        if (sumW < 1e-10) break;

        const xMean = sumWX / sumW;
        const yMean = sumWY / sumW;
        const ssXX = sumWXX - sumW * xMean * xMean;

        if (Math.abs(ssXX) < 1e-10) break;

        const slope = (sumWXY - sumW * xMean * yMean) / ssXX;
        const intercept = yMean - slope * xMean;

        // Check convergence
        if (Math.abs(slope - prevSlope) < tolerance && Math.abs(intercept - prevIntercept) < tolerance) {
            break;
        }

        prevSlope = slope;
        prevIntercept = intercept;

        // Update result
        const fitted = x.map(xi => slope * xi + intercept);
        const residuals = y.map((yi, i) => yi - fitted[i]);

        result = {
            ...result,
            slope,
            intercept,
            fitted,
            residuals,
        };
    }

    // Final statistics
    const yMeanFinal = mean(y);
    const ssTot = y.reduce((sum, yi) => sum + Math.pow(yi - yMeanFinal, 2), 0);
    const ssRes = result.residuals.reduce((sum, r) => sum + r * r, 0);
    const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    const scale = 1.4826 * mad(result.residuals);
    const xMean = mean(x);
    const ssXX = x.reduce((sum, xi) => sum + Math.pow(xi - xMean, 2), 0);

    return {
        ...result,
        rSquared,
        se: scale,
        slopeStdErr: ssXX > 0 ? scale / Math.sqrt(ssXX) : 0,
        interceptStdErr: scale * Math.sqrt(1 / n + (xMean * xMean) / ssXX),
    };
}

// =============================================================================
// MAIN REGRESSION FUNCTION
// =============================================================================

/**
 * Perform robust regression with specified method
 */
export function performRobustRegression(
    data: Record<string, any>[],
    config: RobustRegressionConfig
): RegressionResult | GroupedRegressionResult {
    const { method, xColumn, yColumn, groupColumn, confidenceLevel, trimFraction } = config;

    // Handle grouped regression
    if (groupColumn) {
        const groups: Record<string, RegressionResult> = {};
        const groupValues = [...new Set(data.map(d => d[groupColumn]).filter(v => v !== null && v !== undefined))];

        for (const group of groupValues) {
            const groupData = data.filter(d => d[groupColumn] === group);
            const result = performSingleRegression(groupData, method, xColumn, yColumn, confidenceLevel, trimFraction);
            groups[String(group)] = result;
        }

        // Also compute global result
        const globalResult = performSingleRegression(data, method, xColumn, yColumn, confidenceLevel, trimFraction);

        return { groups, globalResult };
    }

    return performSingleRegression(data, method, xColumn, yColumn, confidenceLevel, trimFraction);
}

function performSingleRegression(
    data: Record<string, any>[],
    method: RegressionMethod,
    xColumn: string,
    yColumn: string,
    confidenceLevel: number,
    trimFraction?: number
): RegressionResult {
    // Extract valid pairs
    const validPairs: { x: number; y: number; idx: number }[] = [];

    for (let i = 0; i < data.length; i++) {
        const xVal = parseFloat(data[i][xColumn]);
        const yVal = parseFloat(data[i][yColumn]);
        if (!isNaN(xVal) && !isNaN(yVal) && isFinite(xVal) && isFinite(yVal)) {
            validPairs.push({ x: xVal, y: yVal, idx: i });
        }
    }

    const x = validPairs.map(p => p.x);
    const y = validPairs.map(p => p.y);
    const n = x.length;

    if (n < 2) {
        return createEmptyResult(method, data.length);
    }

    // Perform regression based on method
    let regResult: OLSResult;

    switch (method) {
        case 'lts':
            regResult = lts(x, y, trimFraction || 0.75);
            break;
        case 'bisquare':
            regResult = mEstimator(x, y, bisquareWeight, 4.685);
            break;
        case 'huber':
            regResult = mEstimator(x, y, huberWeight, 1.345);
            break;
        case 'ols':
        default:
            regResult = ols(x, y);
            break;
    }

    // Identify outliers (residuals > 3 * MAD or scale)
    const scale = 1.4826 * mad(regResult.residuals);
    const outlierThreshold = 3 * (scale > 0 ? scale : regResult.se);
    const outlierIndices: number[] = [];

    // Map back to original indices
    const residualsFullLength: (number | null)[] = new Array(data.length).fill(null);
    const fittedFullLength: (number | null)[] = new Array(data.length).fill(null);

    for (let i = 0; i < validPairs.length; i++) {
        const origIdx = validPairs[i].idx;
        residualsFullLength[origIdx] = regResult.residuals[i];
        fittedFullLength[origIdx] = regResult.fitted[i];

        if (Math.abs(regResult.residuals[i]) > outlierThreshold) {
            outlierIndices.push(origIdx);
        }
    }

    // Confidence intervals
    const alpha = 1 - confidenceLevel;
    const df = Math.max(1, n - 2);
    const t = tCritical(df, alpha);

    const slopeCI: [number, number] = [
        regResult.slope - t * regResult.slopeStdErr,
        regResult.slope + t * regResult.slopeStdErr,
    ];

    const interceptCI: [number, number] = [
        regResult.intercept - t * regResult.interceptStdErr,
        regResult.intercept + t * regResult.interceptStdErr,
    ];

    // Prediction bands
    const xMean = mean(x);
    const ssXX = x.reduce((sum, xi) => sum + Math.pow(xi - xMean, 2), 0);
    const predLower: (number | null)[] = new Array(data.length).fill(null);
    const predUpper: (number | null)[] = new Array(data.length).fill(null);

    for (let i = 0; i < validPairs.length; i++) {
        const origIdx = validPairs[i].idx;
        const xi = validPairs[i].x;
        const yHat = regResult.fitted[i];

        const predSE = regResult.se * Math.sqrt(1 + 1 / n + Math.pow(xi - xMean, 2) / ssXX);
        predLower[origIdx] = yHat - t * predSE;
        predUpper[origIdx] = yHat + t * predSE;
    }

    return {
        method,
        slope: regResult.slope,
        intercept: regResult.intercept,
        rSquared: regResult.rSquared,
        standardError: regResult.se,
        residuals: residualsFullLength,
        fittedValues: fittedFullLength,
        confidenceInterval: {
            slope: slopeCI,
            intercept: interceptCI,
        },
        predictionBands: {
            lower: predLower,
            upper: predUpper,
        },
        outlierIndices,
        diagnostics: {
            n,
            df,
            mse: regResult.se * regResult.se,
            rmse: regResult.se,
            mae: mean(regResult.residuals.map(Math.abs)),
        },
    };
}

function createEmptyResult(method: RegressionMethod, n: number): RegressionResult {
    return {
        method,
        slope: 0,
        intercept: 0,
        rSquared: 0,
        standardError: 0,
        residuals: new Array(n).fill(null),
        fittedValues: new Array(n).fill(null),
        confidenceInterval: {
            slope: [0, 0],
            intercept: [0, 0],
        },
        predictionBands: {
            lower: new Array(n).fill(null),
            upper: new Array(n).fill(null),
        },
        outlierIndices: [],
        diagnostics: {
            n: 0,
            df: 0,
            mse: 0,
            rmse: 0,
            mae: 0,
        },
    };
}

// =============================================================================
// RESIDUAL ANALYSIS
// =============================================================================

/**
 * Calculate residuals adjusted for Mn-scavenging or other variables
 * Useful for removing lithology effects
 */
export function calculateAdjustedResiduals(
    data: Record<string, any>[],
    targetColumn: string,
    adjustmentColumns: string[],
    method: RegressionMethod = 'lts'
): {
    adjustedValues: (number | null)[];
    residuals: (number | null)[];
    regressionResults: Record<string, RegressionResult>;
} {
    let currentResiduals: (number | null)[] = data.map(d => {
        const v = parseFloat(d[targetColumn]);
        return isNaN(v) ? null : v;
    });

    const regressionResults: Record<string, RegressionResult> = {};

    // Sequentially regress out each adjustment variable
    for (const adjCol of adjustmentColumns) {
        const config: RobustRegressionConfig = {
            method,
            xColumn: adjCol,
            yColumn: targetColumn,
            confidenceLevel: 0.95,
        };

        // Create temporary data with current residuals as target
        const tempData = data.map((d, i) => ({
            ...d,
            __residual__: currentResiduals[i],
        }));

        const result = performRobustRegression(tempData, {
            ...config,
            yColumn: '__residual__',
        }) as RegressionResult;

        regressionResults[adjCol] = result;
        currentResiduals = result.residuals;
    }

    // Adjusted values = original mean + residuals
    const originalValues = data.map(d => {
        const v = parseFloat(d[targetColumn]);
        return isNaN(v) ? null : v;
    });
    const originalMean = mean(originalValues);

    const adjustedValues = currentResiduals.map(r =>
        r !== null ? originalMean + r : null
    );

    return {
        adjustedValues,
        residuals: currentResiduals,
        regressionResults,
    };
}
