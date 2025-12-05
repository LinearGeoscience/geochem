/**
 * Centered Log-Ratio (CLR) transformation utilities for compositional data analysis
 *
 * The CLR transformation is essential for analyzing compositional data (data that sums to a constant,
 * like percentages that sum to 100%). It transforms closed data into open data suitable for
 * standard statistical analysis.
 *
 * Formula: clr(x_i) = ln(x_i) - (1/D) * Σ ln(x_j) = ln(x_i / g(x))
 * where g(x) is the geometric mean of all components
 *
 * References:
 * - Aitchison (1986) - The Statistical Analysis of Compositional Data
 */

export type ZeroHandlingStrategy = 'half-min' | 'small-constant' | 'multiplicative' | 'custom';

export interface CLROptions {
    /** Strategy for handling zero values */
    zeroStrategy: ZeroHandlingStrategy;
    /** Custom value to replace zeros (only used with 'custom' strategy) */
    customZeroValue?: number;
    /** Small constant to use (only used with 'small-constant' strategy), default 0.001 */
    smallConstant?: number;
}

export interface CLRResult {
    /** CLR-transformed data matrix */
    transformed: number[][];
    /** Column names corresponding to the transformed data */
    columns: string[];
    /** Number of rows with zeros that were replaced */
    zerosReplaced: number;
    /** Geometric means for each row */
    geometricMeans: number[];
}

/**
 * Calculate the geometric mean of an array of positive values
 */
export function geometricMean(values: number[]): number {
    if (values.length === 0) return 0;

    // Use log sum to avoid overflow with large products
    const logSum = values.reduce((sum, v) => {
        if (v <= 0) return sum; // Skip non-positive values
        return sum + Math.log(v);
    }, 0);

    const validCount = values.filter(v => v > 0).length;
    if (validCount === 0) return 0;

    return Math.exp(logSum / validCount);
}

/**
 * Replace zeros in compositional data using the specified strategy
 */
export function replaceZeros(
    data: number[][],
    strategy: ZeroHandlingStrategy,
    options?: { customValue?: number; smallConstant?: number }
): { replaced: number[][]; count: number } {
    const replaced: number[][] = [];
    let count = 0;

    // Calculate the minimum non-zero value for 'half-min' strategy
    let minNonZero = Infinity;
    if (strategy === 'half-min') {
        for (const row of data) {
            for (const val of row) {
                if (val > 0 && val < minNonZero) {
                    minNonZero = val;
                }
            }
        }
        if (minNonZero === Infinity) minNonZero = 0.001;
    }

    const replacementValue = (() => {
        switch (strategy) {
            case 'half-min':
                return minNonZero / 2;
            case 'small-constant':
                return options?.smallConstant ?? 0.001;
            case 'custom':
                return options?.customValue ?? 0.001;
            case 'multiplicative':
                // Multiplicative replacement is handled differently
                return 0;
        }
    })();

    for (const row of data) {
        if (strategy === 'multiplicative') {
            // Multiplicative replacement preserves ratios
            const rowReplaced = multiplicativeReplacement(row);
            replaced.push(rowReplaced.replaced);
            count += rowReplaced.zerosFound;
        } else {
            // Simple replacement strategies
            const newRow: number[] = [];
            for (const val of row) {
                if (val <= 0) {
                    newRow.push(replacementValue);
                    count++;
                } else {
                    newRow.push(val);
                }
            }
            replaced.push(newRow);
        }
    }

    return { replaced, count };
}

/**
 * Multiplicative replacement for zeros (preserves ratios between non-zero values)
 * Based on Martín-Fernández et al. (2003)
 */
function multiplicativeReplacement(row: number[]): { replaced: number[]; zerosFound: number } {
    const n = row.length;
    const zerosIndices: number[] = [];
    const nonZerosIndices: number[] = [];

    for (let i = 0; i < n; i++) {
        if (row[i] <= 0) {
            zerosIndices.push(i);
        } else {
            nonZerosIndices.push(i);
        }
    }

    if (zerosIndices.length === 0) {
        return { replaced: [...row], zerosFound: 0 };
    }

    // Calculate the sum of non-zero values
    const nonZeroSum = nonZerosIndices.reduce((sum, i) => sum + row[i], 0);

    // Use a small delta (typically detection limit or small fraction of minimum)
    const minNonZero = Math.min(...nonZerosIndices.map(i => row[i]));
    const delta = minNonZero * 0.65; // 65% of minimum as suggested by Martín-Fernández

    // Calculate adjustment factor
    const adjustment = (nonZeroSum - zerosIndices.length * delta) / nonZeroSum;

    const replaced: number[] = [];
    for (let i = 0; i < n; i++) {
        if (row[i] <= 0) {
            replaced.push(delta);
        } else {
            replaced.push(row[i] * adjustment);
        }
    }

    return { replaced, zerosFound: zerosIndices.length };
}

/**
 * Apply CLR transformation to a single row
 */
export function clrTransformRow(row: number[]): number[] {
    const gm = geometricMean(row);
    if (gm === 0) return row.map(() => 0);

    return row.map(val => {
        if (val <= 0) return 0;
        return Math.log(val / gm);
    });
}

/**
 * Apply CLR transformation to compositional data
 */
export function clrTransform(
    data: Record<string, any>[],
    columns: string[],
    options: CLROptions = { zeroStrategy: 'half-min' }
): CLRResult {
    if (data.length === 0 || columns.length === 0) {
        return {
            transformed: [],
            columns,
            zerosReplaced: 0,
            geometricMeans: []
        };
    }

    // Extract numeric values from data
    const rawMatrix: number[][] = data.map(row =>
        columns.map(col => {
            const val = row[col];
            return typeof val === 'number' && !isNaN(val) ? val : 0;
        })
    );

    // Replace zeros
    const { replaced, count } = replaceZeros(rawMatrix, options.zeroStrategy, {
        customValue: options.customZeroValue,
        smallConstant: options.smallConstant
    });

    // Calculate geometric means and apply CLR transformation
    const geometricMeans: number[] = [];
    const transformed: number[][] = [];

    for (const row of replaced) {
        const gm = geometricMean(row);
        geometricMeans.push(gm);
        transformed.push(clrTransformRow(row));
    }

    return {
        transformed,
        columns,
        zerosReplaced: count,
        geometricMeans
    };
}

/**
 * Inverse CLR transformation (back to compositional space)
 * Note: This returns values that sum to 1 (proportions), not the original scale
 */
export function inverseCLR(clrValues: number[]): number[] {
    const expValues = clrValues.map(v => Math.exp(v));
    const sum = expValues.reduce((a, b) => a + b, 0);
    return expValues.map(v => v / sum);
}

/**
 * Calculate CLR covariance matrix
 */
export function clrCovarianceMatrix(transformed: number[][]): number[][] {
    if (transformed.length === 0) return [];

    const n = transformed.length;
    const p = transformed[0].length;

    // Calculate means
    const means: number[] = new Array(p).fill(0);
    for (const row of transformed) {
        for (let j = 0; j < p; j++) {
            means[j] += row[j];
        }
    }
    for (let j = 0; j < p; j++) {
        means[j] /= n;
    }

    // Calculate covariance matrix
    const cov: number[][] = [];
    for (let i = 0; i < p; i++) {
        cov[i] = new Array(p).fill(0);
        for (let j = 0; j < p; j++) {
            let sum = 0;
            for (let k = 0; k < n; k++) {
                sum += (transformed[k][i] - means[i]) * (transformed[k][j] - means[j]);
            }
            cov[i][j] = sum / (n - 1);
        }
    }

    return cov;
}

/**
 * Calculate CLR correlation matrix from CLR-transformed data
 */
export function clrCorrelationMatrix(transformed: number[][]): number[][] {
    const cov = clrCovarianceMatrix(transformed);
    if (cov.length === 0) return [];

    const p = cov.length;
    const stds = cov.map((row, i) => Math.sqrt(row[i]));

    const corr: number[][] = [];
    for (let i = 0; i < p; i++) {
        corr[i] = new Array(p).fill(0);
        for (let j = 0; j < p; j++) {
            if (stds[i] > 0 && stds[j] > 0) {
                corr[i][j] = cov[i][j] / (stds[i] * stds[j]);
            } else {
                corr[i][j] = i === j ? 1 : 0;
            }
        }
    }

    return corr;
}

/**
 * Simple PCA on CLR-transformed data
 * Returns the first two principal components for biplot visualization
 */
export function simplePCA(transformed: number[][]): {
    scores: number[][];  // Sample scores (n x 2)
    loadings: number[][]; // Variable loadings (p x 2)
    variance: number[];   // Variance explained by each component
} {
    if (transformed.length === 0 || transformed[0].length === 0) {
        return { scores: [], loadings: [], variance: [] };
    }

    const n = transformed.length;
    const p = transformed[0].length;

    // Center the data
    const means: number[] = new Array(p).fill(0);
    for (const row of transformed) {
        for (let j = 0; j < p; j++) {
            means[j] += row[j];
        }
    }
    for (let j = 0; j < p; j++) {
        means[j] /= n;
    }

    const centered: number[][] = transformed.map(row =>
        row.map((val, j) => val - means[j])
    );

    // Calculate covariance matrix
    const cov = clrCovarianceMatrix(transformed);

    // Simple power iteration for top 2 eigenvalues/eigenvectors
    // (This is a simplified approach - for production, use a proper eigendecomposition library)
    const eigenResult = powerIteration(cov, 2);

    // Calculate scores (project data onto eigenvectors)
    const scores: number[][] = centered.map(row => {
        return eigenResult.eigenvectors.map(ev =>
            row.reduce((sum, val, j) => sum + val * ev[j], 0)
        );
    });

    // Loadings are the eigenvectors scaled by sqrt of eigenvalues
    const loadings: number[][] = [];
    for (let j = 0; j < p; j++) {
        loadings.push(eigenResult.eigenvectors.map((ev, k) =>
            ev[j] * Math.sqrt(eigenResult.eigenvalues[k])
        ));
    }

    // Calculate variance explained
    const totalVar = eigenResult.eigenvalues.reduce((a, b) => a + Math.abs(b), 0);
    const variance = eigenResult.eigenvalues.map(v => Math.abs(v) / totalVar);

    return { scores, loadings, variance };
}

/**
 * Simple power iteration to find top k eigenvectors
 */
function powerIteration(matrix: number[][], k: number): {
    eigenvalues: number[];
    eigenvectors: number[][];
} {
    const n = matrix.length;
    const eigenvalues: number[] = [];
    const eigenvectors: number[][] = [];

    let A = matrix.map(row => [...row]);

    for (let i = 0; i < k; i++) {
        // Initialize random vector
        let v = new Array(n).fill(0).map(() => Math.random() - 0.5);
        let norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
        v = v.map(x => x / norm);

        // Power iteration
        for (let iter = 0; iter < 100; iter++) {
            // Multiply A * v
            const Av = A.map(row => row.reduce((sum, val, j) => sum + val * v[j], 0));

            // Normalize
            norm = Math.sqrt(Av.reduce((sum, x) => sum + x * x, 0));
            if (norm < 1e-10) break;
            v = Av.map(x => x / norm);
        }

        // Eigenvalue = v^T * A * v
        const Av = A.map(row => row.reduce((sum, val, j) => sum + val * v[j], 0));
        const eigenvalue = v.reduce((sum, val, j) => sum + val * Av[j], 0);

        eigenvalues.push(eigenvalue);
        eigenvectors.push(v);

        // Deflation: A = A - eigenvalue * v * v^T
        for (let j = 0; j < n; j++) {
            for (let l = 0; l < n; l++) {
                A[j][l] -= eigenvalue * v[j] * v[l];
            }
        }
    }

    return { eigenvalues, eigenvectors };
}

export default {
    geometricMean,
    clrTransform,
    inverseCLR,
    clrCorrelationMatrix,
    simplePCA
};
