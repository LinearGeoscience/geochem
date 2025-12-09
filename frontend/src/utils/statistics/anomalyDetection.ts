/**
 * Anomaly Detection Methods
 * Multiple statistical approaches for identifying outliers and anomalies
 */

import {
    AnomalyDetectionConfig,
    AnomalyResult,
    MahalanobisConfig,
    MahalanobisResult,
    RobustRegressionConfig,
} from '../../types/statistics';
import { performRobustRegression } from './robustRegression';

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
}

function std(values: number[], ddof: number = 1): number {
    if (values.length <= ddof) return 0;
    const m = mean(values);
    const variance = values.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / (values.length - ddof);
    return Math.sqrt(variance);
}

function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mad(values: number[]): number {
    if (values.length === 0) return 0;
    const med = median(values);
    const deviations = values.map(v => Math.abs(v - med));
    return median(deviations);
}

function percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (idx - lower) * (sorted[upper] - sorted[lower]);
}

function chiSquaredCritical(df: number, alpha: number): number {
    // Approximation for chi-squared critical value
    // Wilson-Hilferty approximation
    const a = 1 - alpha;
    const z = Math.abs(normalInverse(1 - a / 2));
    const x = df * Math.pow(1 - 2 / (9 * df) + z * Math.sqrt(2 / (9 * df)), 3);
    return Math.max(0, x);
}

function normalInverse(p: number): number {
    // Approximation of inverse normal CDF (probit function)
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;

    const a = [
        -3.969683028665376e+01, 2.209460984245205e+02,
        -2.759285104469687e+02, 1.383577518672690e+02,
        -3.066479806614716e+01, 2.506628277459239e+00,
    ];
    const b = [
        -5.447609879822406e+01, 1.615858368580409e+02,
        -1.556989798598866e+02, 6.680131188771972e+01,
        -1.328068155288572e+01,
    ];
    const c = [
        -7.784894002430293e-03, -3.223964580411365e-01,
        -2.400758277161838e+00, -2.549732539343734e+00,
        4.374664141464968e+00, 2.938163982698783e+00,
    ];
    const d = [
        7.784695709041462e-03, 3.224671290700398e-01,
        2.445134137142996e+00, 3.754408661907416e+00,
    ];

    const pLow = 0.02425;
    const pHigh = 1 - pLow;

    let q: number, r: number;

    if (p < pLow) {
        q = Math.sqrt(-2 * Math.log(p));
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else if (p <= pHigh) {
        q = p - 0.5;
        r = q * q;
        return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
            (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    } else {
        q = Math.sqrt(-2 * Math.log(1 - p));
        return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
}

// =============================================================================
// UNIVARIATE ANOMALY DETECTION
// =============================================================================

/**
 * Sigma-based anomaly detection (mean ± nσ)
 */
function detectSigmaAnomalies(
    values: (number | null)[],
    multiplier: number = 3,
    bidirectional: boolean = true
): { isAnomaly: boolean[]; thresholds: { lower?: number; upper?: number }; scores: (number | null)[] } {
    const valid = values.filter((v): v is number => v !== null);
    if (valid.length === 0) {
        return {
            isAnomaly: values.map(() => false),
            thresholds: {},
            scores: values.map(() => null),
        };
    }

    const m = mean(valid);
    const s = std(valid);

    const upper = m + multiplier * s;
    const lower = bidirectional ? m - multiplier * s : -Infinity;

    const isAnomaly = values.map(v => {
        if (v === null) return false;
        return v > upper || (bidirectional && v < lower);
    });

    // Z-scores as anomaly scores
    const scores = values.map(v => {
        if (v === null || s === 0) return null;
        return Math.abs((v - m) / s);
    });

    return {
        isAnomaly,
        thresholds: { lower: bidirectional ? lower : undefined, upper },
        scores,
    };
}

/**
 * MAD-based anomaly detection (robust alternative to sigma)
 */
function detectMADAnomalies(
    values: (number | null)[],
    threshold: number = 3.5,
    bidirectional: boolean = true
): { isAnomaly: boolean[]; thresholds: { lower?: number; upper?: number }; scores: (number | null)[] } {
    const valid = values.filter((v): v is number => v !== null);
    if (valid.length === 0) {
        return {
            isAnomaly: values.map(() => false),
            thresholds: {},
            scores: values.map(() => null),
        };
    }

    const med = median(valid);
    const madValue = mad(valid);
    // Scale factor for consistency with normal distribution
    const scaledMAD = 1.4826 * madValue;

    if (scaledMAD === 0) {
        return {
            isAnomaly: values.map(() => false),
            thresholds: { lower: med, upper: med },
            scores: values.map(() => null),
        };
    }

    const upper = med + threshold * scaledMAD;
    const lower = bidirectional ? med - threshold * scaledMAD : -Infinity;

    const isAnomaly = values.map(v => {
        if (v === null) return false;
        return v > upper || (bidirectional && v < lower);
    });

    // Modified Z-scores as anomaly scores
    const scores = values.map(v => {
        if (v === null) return null;
        return Math.abs((v - med) / scaledMAD);
    });

    return {
        isAnomaly,
        thresholds: { lower: bidirectional ? lower : undefined, upper },
        scores,
    };
}

/**
 * IQR-based anomaly detection (box plot fences)
 */
function detectIQRAnomalies(
    values: (number | null)[],
    multiplier: number = 1.5,
    bidirectional: boolean = true
): { isAnomaly: boolean[]; thresholds: { lower?: number; upper?: number }; scores: (number | null)[] } {
    const valid = values.filter((v): v is number => v !== null);
    if (valid.length === 0) {
        return {
            isAnomaly: values.map(() => false),
            thresholds: {},
            scores: values.map(() => null),
        };
    }

    const q1 = percentile(valid, 25);
    const q3 = percentile(valid, 75);
    const iqr = q3 - q1;

    const upper = q3 + multiplier * iqr;
    const lower = bidirectional ? q1 - multiplier * iqr : -Infinity;

    const isAnomaly = values.map(v => {
        if (v === null) return false;
        return v > upper || (bidirectional && v < lower);
    });

    // Distance from median normalized by IQR as anomaly score
    const med = median(valid);
    const scores = values.map(v => {
        if (v === null || iqr === 0) return null;
        return Math.abs((v - med) / iqr);
    });

    return {
        isAnomaly,
        thresholds: { lower: bidirectional ? lower : undefined, upper },
        scores,
    };
}

/**
 * Percentile-based anomaly detection
 */
function detectPercentileAnomalies(
    values: (number | null)[],
    lowerPercentile: number = 1,
    upperPercentile: number = 99,
    bidirectional: boolean = true
): { isAnomaly: boolean[]; thresholds: { lower?: number; upper?: number }; scores: (number | null)[] } {
    const valid = values.filter((v): v is number => v !== null);
    if (valid.length === 0) {
        return {
            isAnomaly: values.map(() => false),
            thresholds: {},
            scores: values.map(() => null),
        };
    }

    const upper = percentile(valid, upperPercentile);
    const lower = bidirectional ? percentile(valid, lowerPercentile) : -Infinity;

    const isAnomaly = values.map(v => {
        if (v === null) return false;
        return v > upper || (bidirectional && v < lower);
    });

    // Percentile rank as anomaly score
    const sorted = [...valid].sort((a, b) => a - b);
    const scores = values.map(v => {
        if (v === null) return null;
        // Find percentile of this value
        let rank = sorted.findIndex(sv => sv >= v);
        if (rank === -1) rank = sorted.length;
        const pct = (rank / sorted.length) * 100;
        // Convert to anomaly score (higher for more extreme values)
        return Math.max(100 - pct, pct) / 100;
    });

    return {
        isAnomaly,
        thresholds: { lower: bidirectional ? lower : undefined, upper },
        scores,
    };
}

// =============================================================================
// REGRESSION-BASED ANOMALY DETECTION
// =============================================================================

/**
 * Detect anomalies based on regression residuals
 * Useful for removing effects like Mn-scavenging
 */
function detectRegressionAnomalies(
    data: Record<string, any>[],
    targetColumn: string,
    xColumn: string,
    method: 'ols' | 'lts' | 'bisquare' | 'huber' = 'lts',
    residualThreshold: number = 3
): { isAnomaly: boolean[]; thresholds: { lower?: number; upper?: number }; scores: (number | null)[] } {
    const config: RobustRegressionConfig = {
        method,
        xColumn,
        yColumn: targetColumn,
        confidenceLevel: 0.95,
    };

    const result = performRobustRegression(data, config);
    if ('groups' in result) {
        // Grouped regression - use global
        const residuals = result.globalResult?.residuals || [];
        return detectMADAnomalies(residuals, residualThreshold, true);
    }

    return detectMADAnomalies(result.residuals, residualThreshold, true);
}

// =============================================================================
// MULTIVARIATE ANOMALY DETECTION
// =============================================================================

/**
 * Mahalanobis distance-based outlier detection
 */
export function detectMahalanobisOutliers(
    data: Record<string, any>[],
    config: MahalanobisConfig
): MahalanobisResult {
    const { columns, transformationType = 'none', useRobustEstimate = true, chiSquaredAlpha = 0.05 } = config;

    // Extract data matrix
    const matrix: number[][] = [];
    const validIndices: number[] = [];

    for (let i = 0; i < data.length; i++) {
        const row: number[] = [];
        let valid = true;

        for (const col of columns) {
            const val = parseFloat(data[i][col]);
            if (isNaN(val) || !isFinite(val)) {
                valid = false;
                break;
            }
            row.push(val);
        }

        if (valid) {
            // Apply transformation if needed
            if (transformationType === 'clr') {
                const geoMean = Math.pow(row.reduce((a, b) => a * Math.max(b, 1e-10), 1), 1 / row.length);
                for (let j = 0; j < row.length; j++) {
                    row[j] = Math.log(Math.max(row[j], 1e-10) / geoMean);
                }
            } else if (transformationType === 'zscore') {
                // Will standardize later
            }

            matrix.push(row);
            validIndices.push(i);
        }
    }

    const n = matrix.length;
    const p = columns.length;

    if (n <= p) {
        // Not enough data for covariance estimation
        return {
            distances: data.map(() => null),
            threshold: 0,
            isOutlier: data.map(() => false),
            outlierIndices: [],
            statistics: {
                meanVector: [],
                covarianceMatrix: [],
                nOutliers: 0,
                outlierRate: 0,
            },
        };
    }

    // Calculate mean vector
    const meanVec = new Array(p).fill(0);
    for (let j = 0; j < p; j++) {
        for (let i = 0; i < n; i++) {
            meanVec[j] += matrix[i][j];
        }
        meanVec[j] /= n;
    }

    // Z-score standardization if requested
    if (transformationType === 'zscore') {
        const stdVec = new Array(p).fill(0);
        for (let j = 0; j < p; j++) {
            for (let i = 0; i < n; i++) {
                stdVec[j] += Math.pow(matrix[i][j] - meanVec[j], 2);
            }
            stdVec[j] = Math.sqrt(stdVec[j] / (n - 1));
        }
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < p; j++) {
                matrix[i][j] = stdVec[j] > 0 ? (matrix[i][j] - meanVec[j]) / stdVec[j] : 0;
            }
        }
        // Recalculate mean (should be ~0 now)
        for (let j = 0; j < p; j++) {
            meanVec[j] = 0;
            for (let i = 0; i < n; i++) {
                meanVec[j] += matrix[i][j];
            }
            meanVec[j] /= n;
        }
    }

    // Calculate covariance matrix
    let covMatrix: number[][];
    if (useRobustEstimate) {
        // Use Minimum Covariance Determinant (MCD) approximation
        covMatrix = calculateRobustCovariance(matrix, meanVec);
    } else {
        covMatrix = calculateCovariance(matrix, meanVec);
    }

    // Invert covariance matrix
    const covInv = invertMatrix(covMatrix);

    // Calculate Mahalanobis distances
    const distancesFull: (number | null)[] = new Array(data.length).fill(null);
    const distances: number[] = [];

    for (let i = 0; i < n; i++) {
        const diff = matrix[i].map((x, j) => x - meanVec[j]);
        let d2 = 0;
        for (let j = 0; j < p; j++) {
            for (let k = 0; k < p; k++) {
                d2 += diff[j] * covInv[j][k] * diff[k];
            }
        }
        const d = Math.sqrt(Math.max(0, d2));
        distances.push(d);
        distancesFull[validIndices[i]] = d;
    }

    // Chi-squared threshold
    const threshold = Math.sqrt(chiSquaredCritical(p, chiSquaredAlpha));

    // Identify outliers
    const isOutlier = distancesFull.map(d => d !== null && d > threshold);
    const outlierIndices = validIndices.filter((_, i) => distances[i] > threshold);

    return {
        distances: distancesFull,
        threshold,
        isOutlier,
        outlierIndices,
        statistics: {
            meanVector: meanVec,
            covarianceMatrix: covMatrix,
            nOutliers: outlierIndices.length,
            outlierRate: n > 0 ? outlierIndices.length / n : 0,
        },
    };
}

function calculateCovariance(matrix: number[][], meanVec: number[]): number[][] {
    const n = matrix.length;
    const p = meanVec.length;
    const cov: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));

    for (let j = 0; j < p; j++) {
        for (let k = 0; k <= j; k++) {
            let sum = 0;
            for (let i = 0; i < n; i++) {
                sum += (matrix[i][j] - meanVec[j]) * (matrix[i][k] - meanVec[k]);
            }
            cov[j][k] = sum / (n - 1);
            cov[k][j] = cov[j][k];
        }
    }

    return cov;
}

function calculateRobustCovariance(matrix: number[][], meanVec: number[]): number[][] {
    // Simple robust covariance: trim extreme values
    const n = matrix.length;
    const p = meanVec.length;

    // Calculate initial distances
    const cov = calculateCovariance(matrix, meanVec);
    const covInv = invertMatrix(cov);

    const distances: { dist: number; idx: number }[] = [];
    for (let i = 0; i < n; i++) {
        const diff = matrix[i].map((x, j) => x - meanVec[j]);
        let d2 = 0;
        for (let j = 0; j < p; j++) {
            for (let k = 0; k < p; k++) {
                d2 += diff[j] * covInv[j][k] * diff[k];
            }
        }
        distances.push({ dist: Math.sqrt(Math.max(0, d2)), idx: i });
    }

    // Use 75% of data with smallest distances
    distances.sort((a, b) => a.dist - b.dist);
    const h = Math.floor(0.75 * n);
    const selectedIndices = distances.slice(0, h).map(d => d.idx);

    // Recalculate mean and covariance on selected subset
    const newMean = new Array(p).fill(0);
    for (const idx of selectedIndices) {
        for (let j = 0; j < p; j++) {
            newMean[j] += matrix[idx][j];
        }
    }
    for (let j = 0; j < p; j++) {
        newMean[j] /= h;
    }

    const robustCov: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
    for (let j = 0; j < p; j++) {
        for (let k = 0; k <= j; k++) {
            let sum = 0;
            for (const idx of selectedIndices) {
                sum += (matrix[idx][j] - newMean[j]) * (matrix[idx][k] - newMean[k]);
            }
            robustCov[j][k] = sum / (h - 1);
            robustCov[k][j] = robustCov[j][k];
        }
    }

    // Copy new mean to meanVec
    for (let j = 0; j < p; j++) {
        meanVec[j] = newMean[j];
    }

    return robustCov;
}

function invertMatrix(matrix: number[][]): number[][] {
    const n = matrix.length;

    // Create augmented matrix [A|I]
    const aug: number[][] = matrix.map((row, i) => [
        ...row,
        ...new Array(n).fill(0).map((_, j) => (i === j ? 1 : 0)),
    ]);

    // Gaussian elimination with partial pivoting
    for (let col = 0; col < n; col++) {
        // Find pivot
        let maxRow = col;
        for (let row = col + 1; row < n; row++) {
            if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) {
                maxRow = row;
            }
        }
        [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

        if (Math.abs(aug[col][col]) < 1e-10) {
            // Singular matrix - add small regularization
            aug[col][col] = 1e-10;
        }

        // Eliminate column
        for (let row = 0; row < n; row++) {
            if (row !== col) {
                const factor = aug[row][col] / aug[col][col];
                for (let j = col; j < 2 * n; j++) {
                    aug[row][j] -= factor * aug[col][j];
                }
            }
        }

        // Scale pivot row
        const scale = aug[col][col];
        for (let j = col; j < 2 * n; j++) {
            aug[col][j] /= scale;
        }
    }

    // Extract inverse
    return aug.map(row => row.slice(n));
}

// =============================================================================
// MAIN ANOMALY DETECTION FUNCTION
// =============================================================================

/**
 * Perform anomaly detection with specified method
 */
export function detectAnomalies(
    data: Record<string, any>[],
    config: AnomalyDetectionConfig
): AnomalyResult {
    const {
        method,
        column,
        sigmaMultiplier = 3,
        percentileLower = 1,
        percentileUpper = 99,
        iqrMultiplier = 1.5,
        zscoreThreshold = 3,
        regressionXColumn,
        regressionMethod = 'lts',
        residualThreshold = 3,
        groupColumn,
        includeScores = true,
        bidirectional = true,
    } = config;

    // Handle grouped detection
    if (groupColumn) {
        const groups = [...new Set(data.map(d => d[groupColumn]).filter(v => v !== null && v !== undefined))];
        const groupResults: Record<string, AnomalyResult> = {};

        // Initialize full arrays
        const isAnomalyFull: boolean[] = new Array(data.length).fill(false);
        const scoresFull: (number | null)[] = new Array(data.length).fill(null);
        const anomalyIndicesFull: number[] = [];

        for (const group of groups) {
            const groupIndices = data.map((d, i) => d[groupColumn] === group ? i : -1).filter(i => i >= 0);
            const groupData = groupIndices.map(i => data[i]);

            const configWithoutGroup = { ...config, groupColumn: undefined };
            const groupResult = detectAnomalies(groupData, configWithoutGroup);

            groupResults[String(group)] = groupResult;

            // Map back to full arrays
            for (let j = 0; j < groupIndices.length; j++) {
                const origIdx = groupIndices[j];
                isAnomalyFull[origIdx] = groupResult.isAnomaly[j];
                if (groupResult.anomalyScores) {
                    scoresFull[origIdx] = groupResult.anomalyScores[j];
                }
                if (groupResult.isAnomaly[j]) {
                    anomalyIndicesFull.push(origIdx);
                }
            }
        }

        return {
            method,
            column,
            isAnomaly: isAnomalyFull,
            anomalyScores: includeScores ? scoresFull : undefined,
            thresholds: {},
            statistics: {
                n: data.length,
                nAnomalies: anomalyIndicesFull.length,
                anomalyRate: data.length > 0 ? anomalyIndicesFull.length / data.length : 0,
            },
            anomalyIndices: anomalyIndicesFull,
            groupResults,
        };
    }

    // Extract values
    const values: (number | null)[] = data.map(d => {
        const v = parseFloat(d[column]);
        return isNaN(v) || !isFinite(v) ? null : v;
    });

    const validValues = values.filter((v): v is number => v !== null);

    let result: { isAnomaly: boolean[]; thresholds: { lower?: number; upper?: number }; scores: (number | null)[] };

    switch (method) {
        case 'sigma':
            result = detectSigmaAnomalies(values, sigmaMultiplier, bidirectional);
            break;
        case 'mad':
        case 'robust-zscore':
            result = detectMADAnomalies(values, zscoreThreshold, bidirectional);
            break;
        case 'iqr':
            result = detectIQRAnomalies(values, iqrMultiplier, bidirectional);
            break;
        case 'percentile':
            result = detectPercentileAnomalies(values, percentileLower, percentileUpper, bidirectional);
            break;
        case 'zscore':
            result = detectSigmaAnomalies(values, zscoreThreshold, bidirectional);
            break;
        case 'regression':
            if (!regressionXColumn) {
                throw new Error('regressionXColumn is required for regression-based anomaly detection');
            }
            result = detectRegressionAnomalies(data, column, regressionXColumn, regressionMethod, residualThreshold);
            break;
        default:
            result = detectMADAnomalies(values, zscoreThreshold, bidirectional);
    }

    const anomalyIndices = result.isAnomaly.map((a, i) => a ? i : -1).filter(i => i >= 0);

    // Calculate statistics
    const statistics: AnomalyResult['statistics'] = {
        n: validValues.length,
        nAnomalies: anomalyIndices.length,
        anomalyRate: validValues.length > 0 ? anomalyIndices.length / validValues.length : 0,
        mean: mean(validValues),
        median: median(validValues),
        std: std(validValues),
        mad: mad(validValues),
        q1: percentile(validValues, 25),
        q3: percentile(validValues, 75),
    };

    return {
        method,
        column,
        isAnomaly: result.isAnomaly,
        anomalyScores: includeScores ? result.scores : undefined,
        thresholds: result.thresholds,
        statistics,
        anomalyIndices,
    };
}

// =============================================================================
// BATCH ANOMALY DETECTION
// =============================================================================

/**
 * Detect anomalies across multiple columns
 */
export function detectMultiColumnAnomalies(
    data: Record<string, any>[],
    columns: string[],
    baseConfig: Omit<AnomalyDetectionConfig, 'column'>
): Record<string, AnomalyResult> {
    const results: Record<string, AnomalyResult> = {};

    for (const column of columns) {
        results[column] = detectAnomalies(data, { ...baseConfig, column });
    }

    return results;
}

/**
 * Combine multiple anomaly detection results
 * A point is anomalous if flagged by any/all methods
 */
export function combineAnomalyResults(
    results: AnomalyResult[],
    mode: 'any' | 'all' | 'majority' = 'any'
): boolean[] {
    if (results.length === 0) return [];

    const n = results[0].isAnomaly.length;
    const combined: boolean[] = [];

    for (let i = 0; i < n; i++) {
        const flags = results.map(r => r.isAnomaly[i]);
        const trueCount = flags.filter(Boolean).length;

        switch (mode) {
            case 'any':
                combined.push(trueCount > 0);
                break;
            case 'all':
                combined.push(trueCount === results.length);
                break;
            case 'majority':
                combined.push(trueCount > results.length / 2);
                break;
        }
    }

    return combined;
}
