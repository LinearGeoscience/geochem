/**
 * Population Separation Methods
 * Gaussian Mixture Models and Log-Probability Analysis
 * For identifying background vs anomalous populations in geochemical data
 */

import {
    PopulationSeparationConfig,
    PopulationSeparationResult,
    DetectedPopulation,
} from '../../types/statistics';

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
    return Math.sqrt(values.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / (values.length - ddof));
}


function normalPDF(x: number, mu: number, sigma: number): number {
    if (sigma <= 0) return 0;
    const z = (x - mu) / sigma;
    return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
}


// =============================================================================
// HISTOGRAM MODE DETECTION
// =============================================================================

interface HistogramMode {
    center: number;
    count: number;
    density: number;
}

function detectHistogramModes(
    values: number[],
    nBins: number = 50
): HistogramMode[] {
    if (values.length < 10) return [];

    const sorted = [...values].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const binWidth = (max - min) / nBins;

    if (binWidth <= 0) return [];

    // Create histogram
    const bins: number[] = new Array(nBins).fill(0);
    for (const v of values) {
        const binIdx = Math.min(nBins - 1, Math.floor((v - min) / binWidth));
        bins[binIdx]++;
    }

    // Smooth histogram
    const smoothed: number[] = [];
    for (let i = 0; i < nBins; i++) {
        let sum = 0;
        let count = 0;
        for (let j = Math.max(0, i - 2); j <= Math.min(nBins - 1, i + 2); j++) {
            sum += bins[j];
            count++;
        }
        smoothed.push(sum / count);
    }

    // Find modes (local maxima)
    const modes: HistogramMode[] = [];
    for (let i = 1; i < nBins - 1; i++) {
        if (smoothed[i] > smoothed[i - 1] && smoothed[i] > smoothed[i + 1]) {
            if (smoothed[i] > values.length * 0.02) { // At least 2% of data
                modes.push({
                    center: min + (i + 0.5) * binWidth,
                    count: bins[i],
                    density: smoothed[i] / values.length,
                });
            }
        }
    }

    return modes.sort((a, b) => b.density - a.density);
}

// =============================================================================
// GAUSSIAN MIXTURE MODEL
// =============================================================================

interface GMMComponent {
    mean: number;
    std: number;
    weight: number;
}

interface GMMResult {
    components: GMMComponent[];
    logLikelihood: number;
    bic: number;
    aic: number;
    responsibilities: number[][];
}

function fitGMM(
    values: number[],
    nComponents: number,
    maxIter: number = 100,
    tolerance: number = 1e-6
): GMMResult {
    const n = values.length;

    // Initialize components using k-means++ style
    const components: GMMComponent[] = [];
    const sortedValues = [...values].sort((a, b) => a - b);

    for (let k = 0; k < nComponents; k++) {
        const idx = Math.floor((k + 0.5) * n / nComponents);
        components.push({
            mean: sortedValues[idx],
            std: std(values) / nComponents,
            weight: 1 / nComponents,
        });
    }

    // EM algorithm
    let responsibilities: number[][] = Array.from({ length: n }, () => new Array(nComponents).fill(0));
    let prevLogLikelihood = -Infinity;

    for (let iter = 0; iter < maxIter; iter++) {
        // E-step: Calculate responsibilities
        for (let i = 0; i < n; i++) {
            let total = 0;
            for (let k = 0; k < nComponents; k++) {
                responsibilities[i][k] = components[k].weight *
                    normalPDF(values[i], components[k].mean, components[k].std);
                total += responsibilities[i][k];
            }
            if (total > 0) {
                for (let k = 0; k < nComponents; k++) {
                    responsibilities[i][k] /= total;
                }
            }
        }

        // M-step: Update parameters
        for (let k = 0; k < nComponents; k++) {
            const Nk = responsibilities.reduce((sum, r) => sum + r[k], 0);

            if (Nk > 1) {
                // Update mean
                components[k].mean = responsibilities.reduce(
                    (sum, r, i) => sum + r[k] * values[i], 0
                ) / Nk;

                // Update variance
                const variance = responsibilities.reduce(
                    (sum, r, i) => sum + r[k] * Math.pow(values[i] - components[k].mean, 2), 0
                ) / Nk;
                components[k].std = Math.sqrt(Math.max(variance, 1e-6));

                // Update weight
                components[k].weight = Nk / n;
            }
        }

        // Calculate log-likelihood
        let logLikelihood = 0;
        for (let i = 0; i < n; i++) {
            let likelihood = 0;
            for (let k = 0; k < nComponents; k++) {
                likelihood += components[k].weight *
                    normalPDF(values[i], components[k].mean, components[k].std);
            }
            logLikelihood += Math.log(Math.max(likelihood, 1e-300));
        }

        // Check convergence
        if (Math.abs(logLikelihood - prevLogLikelihood) < tolerance) {
            break;
        }
        prevLogLikelihood = logLikelihood;
    }

    // Calculate final log-likelihood, AIC, BIC
    let logLikelihood = 0;
    for (let i = 0; i < n; i++) {
        let likelihood = 0;
        for (let k = 0; k < nComponents; k++) {
            likelihood += components[k].weight *
                normalPDF(values[i], components[k].mean, components[k].std);
        }
        logLikelihood += Math.log(Math.max(likelihood, 1e-300));
    }

    const nParams = nComponents * 3 - 1; // mean, std, weight for each (weights sum to 1)
    const aic = 2 * nParams - 2 * logLikelihood;
    const bic = Math.log(n) * nParams - 2 * logLikelihood;

    return { components, logLikelihood, bic, aic, responsibilities };
}

function assignPopulations(
    _values: number[],
    responsibilities: number[][],
    _components: GMMComponent[]
): number[] {
    void _values; // Reserved for value-based assignment logic
    void _components; // Reserved for component-based assignment logic
    return responsibilities.map(r => {
        let maxIdx = 0;
        let maxVal = r[0];
        for (let k = 1; k < r.length; k++) {
            if (r[k] > maxVal) {
                maxVal = r[k];
                maxIdx = k;
            }
        }
        return maxIdx;
    });
}

// =============================================================================
// LOG-PROBABILITY PLOT ANALYSIS
// =============================================================================

interface LogProbabilityResult {
    nPopulations: number;
    breakpoints: number[];
    populations: DetectedPopulation[];
}

function analyzeLogProbabilityPlot(
    values: number[],
    useLogScale: boolean = true
): LogProbabilityResult {
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;

    // Transform if using log scale
    const transformed = useLogScale
        ? sorted.filter(v => v > 0).map(v => Math.log10(v))
        : sorted;

    if (transformed.length < 10) {
        return { nPopulations: 1, breakpoints: [], populations: [] };
    }

    // Calculate cumulative probabilities (plotting positions)
    const probabilities = transformed.map((_, i) => (i + 0.5) / transformed.length);

    // Convert to standard normal quantiles (probit)
    const quantiles = probabilities.map(p => {
        // Inverse normal CDF approximation
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

        if (p <= 0.5) {
            const q = Math.sqrt(-2 * Math.log(Math.max(p, 1e-10)));
            return -(((((a[5] * q + a[4]) * q + a[3]) * q + a[2]) * q + a[1]) * q + a[0]) /
                ((((b[4] * q + b[3]) * q + b[2]) * q + b[1]) * q + b[0]) * q + 1;
        } else {
            const q = Math.sqrt(-2 * Math.log(Math.max(1 - p, 1e-10)));
            return (((((a[5] * q + a[4]) * q + a[3]) * q + a[2]) * q + a[1]) * q + a[0]) /
                ((((b[4] * q + b[3]) * q + b[2]) * q + b[1]) * q + b[0]) * q + 1;
        }
    });

    // Find breakpoints using piecewise linear regression
    // Look for significant changes in slope
    const windowSize = Math.max(5, Math.floor(n * 0.1));
    const slopes: number[] = [];

    for (let i = windowSize; i < n - windowSize; i++) {
        // Calculate local slope before and after point i
        const xBefore = quantiles.slice(i - windowSize, i);
        const yBefore = transformed.slice(i - windowSize, i);
        const xAfter = quantiles.slice(i, i + windowSize);
        const yAfter = transformed.slice(i, i + windowSize);

        const slopeBefore = linearSlope(xBefore, yBefore);
        const slopeAfter = linearSlope(xAfter, yAfter);

        slopes.push(Math.abs(slopeAfter - slopeBefore));
    }

    // Find significant slope changes
    const slopeThreshold = mean(slopes) + 2 * std(slopes);
    const breakpointIndices: number[] = [];

    for (let i = 1; i < slopes.length - 1; i++) {
        if (slopes[i] > slopeThreshold && slopes[i] > slopes[i - 1] && slopes[i] > slopes[i + 1]) {
            breakpointIndices.push(i + windowSize);
        }
    }

    // Convert breakpoints to values
    const breakpoints = breakpointIndices.map(i => {
        const val = transformed[i];
        return useLogScale ? Math.pow(10, val) : val;
    });

    // Determine populations from breakpoints
    const nPopulations = breakpoints.length + 1;
    const populations: DetectedPopulation[] = [];

    let prevBreak = useLogScale ? Math.pow(10, transformed[0]) : transformed[0];
    for (let p = 0; p < nPopulations; p++) {
        const lower = prevBreak;
        const upper = p < breakpoints.length ? breakpoints[p] : (useLogScale ? Math.pow(10, transformed[n - 1]) : transformed[n - 1]);

        const popValues = values.filter(v => v >= lower && v < upper * 1.001);

        if (popValues.length > 0) {
            populations.push({
                id: p,
                mean: mean(popValues),
                stdDev: std(popValues),
                proportion: popValues.length / n,
                count: popValues.length,
                lowerBound: lower,
                upperBound: upper,
                classification: classifyPopulation(p, nPopulations),
            });
        }

        prevBreak = upper;
    }

    return { nPopulations, breakpoints, populations };
}

function linearSlope(x: number[], y: number[]): number {
    if (x.length < 2) return 0;
    const xMean = mean(x);
    const yMean = mean(y);
    let num = 0;
    let den = 0;
    for (let i = 0; i < x.length; i++) {
        num += (x[i] - xMean) * (y[i] - yMean);
        den += (x[i] - xMean) ** 2;
    }
    return den > 0 ? num / den : 0;
}

function classifyPopulation(
    index: number,
    total: number
): DetectedPopulation['classification'] {
    if (total === 1) return 'background';
    if (index === 0) return 'background';
    if (index === total - 1) return 'high-grade';
    if (index === total - 2) return 'anomalous';
    return 'threshold';
}

// =============================================================================
// MAIN POPULATION SEPARATION FUNCTION
// =============================================================================

export function separatePopulations(
    data: Record<string, any>[],
    config: PopulationSeparationConfig
): PopulationSeparationResult {
    const { column, maxPopulations, method, minSeparation = 0.5, useLogScale = false } = config;

    // Extract values
    const values: number[] = [];
    const validIndices: number[] = [];

    for (let i = 0; i < data.length; i++) {
        const val = parseFloat(data[i][column]);
        if (!isNaN(val) && isFinite(val)) {
            if (!useLogScale || val > 0) {
                values.push(val);
                validIndices.push(i);
            }
        }
    }

    if (values.length < 20) {
        return createEmptyResult(column, data.length);
    }

    let result: PopulationSeparationResult;

    switch (method) {
        case 'gaussian-mixture':
            result = fitGaussianMixture(values, validIndices, data.length, column, maxPopulations, minSeparation, useLogScale);
            break;

        case 'log-probability':
            result = fitLogProbability(values, validIndices, data.length, column, useLogScale);
            break;

        case 'histogram-mode':
            result = fitHistogramModes(values, validIndices, data.length, column, maxPopulations);
            break;

        default:
            result = fitGaussianMixture(values, validIndices, data.length, column, maxPopulations, minSeparation, useLogScale);
    }

    return result;
}

function fitGaussianMixture(
    values: number[],
    validIndices: number[],
    totalLength: number,
    column: string,
    maxPopulations: number,
    minSeparation: number,
    useLogScale: boolean
): PopulationSeparationResult {
    const transformedValues = useLogScale ? values.map(v => Math.log(Math.max(v, 1e-10))) : values;

    // Try different numbers of components and select best by BIC
    let bestResult: GMMResult | null = null;
    let bestNComponents = 1;
    let bestBIC = Infinity;

    for (let k = 1; k <= maxPopulations; k++) {
        const result = fitGMM(transformedValues, k);

        // Check minimum separation constraint
        let wellSeparated = true;
        if (k > 1) {
            const sortedMeans = result.components.map(c => c.mean).sort((a, b) => a - b);
            for (let i = 1; i < sortedMeans.length; i++) {
                const avgStd = (result.components[i].std + result.components[i - 1].std) / 2;
                if ((sortedMeans[i] - sortedMeans[i - 1]) < minSeparation * avgStd) {
                    wellSeparated = false;
                    break;
                }
            }
        }

        if (wellSeparated && result.bic < bestBIC) {
            bestBIC = result.bic;
            bestResult = result;
            bestNComponents = k;
        }
    }

    if (!bestResult) {
        return createEmptyResult(column, totalLength);
    }

    // Sort components by mean
    const sortedIndices = bestResult.components
        .map((c, i) => ({ mean: c.mean, idx: i }))
        .sort((a, b) => a.mean - b.mean)
        .map(x => x.idx);

    const populations: DetectedPopulation[] = sortedIndices.map((idx, i) => {
        const comp = bestResult!.components[idx];
        const meanVal = useLogScale ? Math.exp(comp.mean) : comp.mean;
        const stdVal = useLogScale ? Math.exp(comp.std) : comp.std;

        return {
            id: i,
            mean: meanVal,
            stdDev: stdVal,
            proportion: comp.weight,
            count: Math.round(comp.weight * values.length),
            lowerBound: useLogScale ? Math.exp(comp.mean - 2 * comp.std) : comp.mean - 2 * comp.std,
            upperBound: useLogScale ? Math.exp(comp.mean + 2 * comp.std) : comp.mean + 2 * comp.std,
            classification: classifyPopulation(i, bestNComponents),
        };
    });

    // Calculate separation points
    const separationPoints: number[] = [];
    for (let i = 1; i < populations.length; i++) {
        const p1 = populations[i - 1];
        const p2 = populations[i];
        // Find intersection point
        const sepPoint = (p1.mean * p2.stdDev + p2.mean * p1.stdDev) / (p1.stdDev + p2.stdDev);
        separationPoints.push(sepPoint);
    }

    // Assign populations to data points
    const assignments = assignPopulations(
        transformedValues,
        bestResult.responsibilities,
        bestResult.components
    );

    // Map back to original indices with sorted population IDs
    const assignmentsFull: (number | null)[] = new Array(totalLength).fill(null);
    for (let i = 0; i < validIndices.length; i++) {
        const origPopIdx = assignments[i];
        const newPopIdx = sortedIndices.indexOf(origPopIdx);
        assignmentsFull[validIndices[i]] = newPopIdx;
    }

    return {
        column,
        nPopulations: bestNComponents,
        populations,
        separationPoints,
        assignedPopulation: assignmentsFull,
        bic: bestResult.bic,
        aic: bestResult.aic,
        logLikelihood: bestResult.logLikelihood,
    };
}

function fitLogProbability(
    values: number[],
    validIndices: number[],
    totalLength: number,
    column: string,
    useLogScale: boolean
): PopulationSeparationResult {
    const result = analyzeLogProbabilityPlot(values, useLogScale);

    // Assign populations based on breakpoints
    const assignmentsFull: (number | null)[] = new Array(totalLength).fill(null);
    const breakpoints = [0, ...result.breakpoints, Infinity];

    for (let i = 0; i < validIndices.length; i++) {
        const val = values[i];
        for (let p = 0; p < result.nPopulations; p++) {
            if (val >= breakpoints[p] && val < breakpoints[p + 1]) {
                assignmentsFull[validIndices[i]] = p;
                break;
            }
        }
    }

    return {
        column,
        nPopulations: result.nPopulations,
        populations: result.populations,
        separationPoints: result.breakpoints,
        assignedPopulation: assignmentsFull,
    };
}

function fitHistogramModes(
    values: number[],
    validIndices: number[],
    totalLength: number,
    column: string,
    maxPopulations: number
): PopulationSeparationResult {
    const modes = detectHistogramModes(values).slice(0, maxPopulations);

    if (modes.length === 0) {
        return createEmptyResult(column, totalLength);
    }

    // Sort modes by center
    modes.sort((a, b) => a.center - b.center);

    // Create populations around each mode
    const populations: DetectedPopulation[] = modes.map((mode, i) => {
        // Estimate std from histogram width
        const valuesNearMode = values.filter(v => Math.abs(v - mode.center) < std(values) * 2);
        const popStd = valuesNearMode.length > 2 ? std(valuesNearMode) : std(values) / modes.length;

        return {
            id: i,
            mean: mode.center,
            stdDev: popStd,
            proportion: mode.density,
            count: mode.count,
            lowerBound: mode.center - 2 * popStd,
            upperBound: mode.center + 2 * popStd,
            classification: classifyPopulation(i, modes.length),
        };
    });

    // Calculate separation points (midpoints between modes)
    const separationPoints: number[] = [];
    for (let i = 1; i < populations.length; i++) {
        separationPoints.push((populations[i - 1].mean + populations[i].mean) / 2);
    }

    // Assign populations
    const assignmentsFull: (number | null)[] = new Array(totalLength).fill(null);
    const breakpoints = [-Infinity, ...separationPoints, Infinity];

    for (let i = 0; i < validIndices.length; i++) {
        const val = values[i];
        for (let p = 0; p < populations.length; p++) {
            if (val >= breakpoints[p] && val < breakpoints[p + 1]) {
                assignmentsFull[validIndices[i]] = p;
                break;
            }
        }
    }

    return {
        column,
        nPopulations: modes.length,
        populations,
        separationPoints,
        assignedPopulation: assignmentsFull,
    };
}

function createEmptyResult(column: string, n: number): PopulationSeparationResult {
    return {
        column,
        nPopulations: 0,
        populations: [],
        separationPoints: [],
        assignedPopulation: new Array(n).fill(null),
    };
}
