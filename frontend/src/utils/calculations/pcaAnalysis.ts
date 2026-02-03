/**
 * Principal Component Analysis (PCA) utilities for geochemical data analysis
 *
 * Implements full eigendecomposition using Jacobi method to support 8+ components,
 * following the workflow from the Exploration Geochemistry Workshop Manual.
 *
 * The scaled eigenvectors (loadings) are key for identifying element associations.
 */

import { clrTransform, ZeroHandlingStrategy } from '../clrTransform';

// ============================================================================
// TYPES
// ============================================================================

export interface FullPCAResult {
  /** Sample scores projected onto principal components [n_samples x n_components] */
  scores: number[][];
  /** Scaled eigenvectors (loadings) [n_variables x n_components] - key output for element associations */
  loadings: number[][];
  /** Raw eigenvectors (unscaled) [n_components x n_variables] */
  eigenvectors: number[][];
  /** Eigenvalues for each component */
  eigenvalues: number[];
  /** Percentage of variance explained by each component */
  varianceExplained: number[];
  /** Cumulative variance explained */
  cumulativeVariance: number[];
  /** Correlation matrix of CLR-transformed data */
  correlationMatrix: number[][];
  /** Column/variable names */
  columns: string[];
  /** Column means (for centering) */
  means: number[];
  /** Number of samples used in analysis */
  nSamples: number;
  /** Number of zeros replaced during CLR transformation */
  zerosReplaced: number;
}

export interface SortedLoading {
  element: string;
  loading: number;
}

export interface ElementQualityInfo {
  element: string;
  /** N-score position of Below Detection Limit values (-1 threshold) */
  bldNScore: number;
  /** Percentage of values below detection limit */
  percentBLD: number;
  /** Count of BLD values */
  countBLD: number;
  /** Total count of values */
  totalCount: number;
  /** Whether element passes quality check (BLD N-score < -1) */
  isAcceptable: boolean;
}

// ============================================================================
// JACOBI EIGENDECOMPOSITION
// ============================================================================

/**
 * Jacobi eigendecomposition for symmetric matrices
 *
 * Uses Givens rotations to iteratively eliminate off-diagonal elements.
 * Returns ALL eigenvalues and eigenvectors sorted by magnitude (descending).
 *
 * This is more accurate than power iteration for extracting all components.
 */
export function jacobiEigendecomposition(matrix: number[][]): {
  eigenvalues: number[];
  eigenvectors: number[][];
} {
  const n = matrix.length;
  if (n === 0) return { eigenvalues: [], eigenvectors: [] };

  // Deep copy the matrix
  const A: number[][] = matrix.map(row => [...row]);

  // Initialize eigenvector matrix as identity
  const V: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
  );

  const maxIterations = 50 * n * n; // Increased for larger matrices
  const tolerance = 1e-12;

  for (let iter = 0; iter < maxIterations; iter++) {
    // Find largest off-diagonal element
    let maxVal = 0;
    let p = 0;
    let q = 1;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const absVal = Math.abs(A[i][j]);
        if (absVal > maxVal) {
          maxVal = absVal;
          p = i;
          q = j;
        }
      }
    }

    // Check for convergence
    if (maxVal < tolerance) break;

    // Calculate rotation angle using stable formula
    const diff = A[q][q] - A[p][p];
    let t: number;

    if (Math.abs(A[p][q]) < Math.abs(diff) * 1e-36) {
      t = A[p][q] / diff;
    } else {
      const phi = diff / (2 * A[p][q]);
      t = 1 / (Math.abs(phi) + Math.sqrt(phi * phi + 1));
      if (phi < 0) t = -t;
    }

    const c = 1 / Math.sqrt(t * t + 1);
    const s = t * c;
    const tau = s / (1 + c);

    // Apply rotation to A
    const App = A[p][p];
    const Aqq = A[q][q];

    A[p][p] = App - t * A[p][q];
    A[q][q] = Aqq + t * A[p][q];
    A[p][q] = 0;
    A[q][p] = 0;

    for (let i = 0; i < n; i++) {
      if (i !== p && i !== q) {
        const Aip = A[i][p];
        const Aiq = A[i][q];
        A[i][p] = Aip - s * (Aiq + tau * Aip);
        A[p][i] = A[i][p];
        A[i][q] = Aiq + s * (Aip - tau * Aiq);
        A[q][i] = A[i][q];
      }

      // Update eigenvector matrix
      const Vip = V[i][p];
      const Viq = V[i][q];
      V[i][p] = Vip - s * (Viq + tau * Vip);
      V[i][q] = Viq + s * (Vip - tau * Viq);
    }
  }

  // Extract eigenvalues from diagonal
  const eigenvalues = A.map((row, i) => row[i]);

  // Create array of indices sorted by eigenvalue (descending)
  const indices = eigenvalues.map((_, i) => i)
    .sort((a, b) => eigenvalues[b] - eigenvalues[a]);

  // Sort eigenvalues
  const sortedEigenvalues = indices.map(i => eigenvalues[i]);

  // Extract and sort eigenvectors (each column of V is an eigenvector)
  // Transpose so each row is an eigenvector
  const sortedEigenvectors: number[][] = indices.map(i =>
    V.map(row => row[i])
  );

  return {
    eigenvalues: sortedEigenvalues,
    eigenvectors: sortedEigenvectors
  };
}

// ============================================================================
// CORRELATION MATRIX
// ============================================================================

/**
 * Calculate correlation matrix from data matrix
 */
export function calculateCorrelationMatrix(data: number[][]): number[][] {
  if (data.length === 0) return [];

  const n = data.length;
  const p = data[0].length;

  // Calculate means
  const means: number[] = new Array(p).fill(0);
  for (const row of data) {
    for (let j = 0; j < p; j++) {
      means[j] += row[j];
    }
  }
  for (let j = 0; j < p; j++) {
    means[j] /= n;
  }

  // Calculate standard deviations
  const stds: number[] = new Array(p).fill(0);
  for (const row of data) {
    for (let j = 0; j < p; j++) {
      stds[j] += Math.pow(row[j] - means[j], 2);
    }
  }
  for (let j = 0; j < p; j++) {
    stds[j] = Math.sqrt(stds[j] / (n - 1));
  }

  // Calculate correlation matrix
  const corr: number[][] = [];
  for (let i = 0; i < p; i++) {
    corr[i] = new Array(p).fill(0);
    for (let j = 0; j < p; j++) {
      if (i === j) {
        corr[i][j] = 1;
      } else if (stds[i] > 0 && stds[j] > 0) {
        let sum = 0;
        for (let k = 0; k < n; k++) {
          sum += (data[k][i] - means[i]) * (data[k][j] - means[j]);
        }
        corr[i][j] = sum / ((n - 1) * stds[i] * stds[j]);
      }
    }
  }

  return corr;
}

// ============================================================================
// FULL PCA
// ============================================================================

/**
 * Perform full PCA on CLR-transformed data
 *
 * This follows the manual's workflow:
 * 1. Data should already be CLR-transformed OR raw data provided with zeroStrategy
 * 2. Calculate correlation matrix
 * 3. Perform eigendecomposition
 * 4. Calculate scaled eigenvectors (loadings) = eigenvectors × sqrt(eigenvalues)
 * 5. Calculate scores = centered data × eigenvectors
 *
 * @param data - Raw data records
 * @param columns - Column names to include in PCA
 * @param nComponents - Number of components to return (default: 8)
 * @param zeroStrategy - Strategy for handling zeros in CLR transformation
 */
export function fullPCA(
  data: Record<string, any>[],
  columns: string[],
  nComponents: number = 8,
  zeroStrategy: ZeroHandlingStrategy = 'half-min'
): FullPCAResult {
  if (data.length === 0 || columns.length === 0) {
    return {
      scores: [],
      loadings: [],
      eigenvectors: [],
      eigenvalues: [],
      varianceExplained: [],
      cumulativeVariance: [],
      correlationMatrix: [],
      columns: [],
      means: [],
      nSamples: 0,
      zerosReplaced: 0
    };
  }

  // Step 1: Apply CLR transformation
  const clrResult = clrTransform(data, columns, { zeroStrategy });
  const clrData = clrResult.transformed;

  if (clrData.length === 0) {
    return {
      scores: [],
      loadings: [],
      eigenvectors: [],
      eigenvalues: [],
      varianceExplained: [],
      cumulativeVariance: [],
      correlationMatrix: [],
      columns,
      means: [],
      nSamples: 0,
      zerosReplaced: clrResult.zerosReplaced
    };
  }

  const n = clrData.length;
  const p = columns.length;

  // Step 2: Center the data and calculate means
  const means: number[] = new Array(p).fill(0);
  for (const row of clrData) {
    for (let j = 0; j < p; j++) {
      means[j] += row[j];
    }
  }
  for (let j = 0; j < p; j++) {
    means[j] /= n;
  }

  const centered: number[][] = clrData.map(row =>
    row.map((val, j) => val - means[j])
  );

  // Step 3: Calculate correlation matrix (using CLR-transformed data)
  const correlationMatrix = calculateCorrelationMatrix(clrData);

  // Step 4: Eigendecomposition on correlation matrix
  const { eigenvalues, eigenvectors } = jacobiEigendecomposition(correlationMatrix);

  // Limit to requested number of components
  const actualComponents = Math.min(nComponents, eigenvalues.length, p);
  const selectedEigenvalues = eigenvalues.slice(0, actualComponents);
  const selectedEigenvectors = eigenvectors.slice(0, actualComponents);

  // Step 5: Calculate variance explained
  const totalVariance = eigenvalues.reduce((sum, ev) => sum + Math.max(0, ev), 0);
  const varianceExplained = selectedEigenvalues.map(ev =>
    totalVariance > 0 ? (Math.max(0, ev) / totalVariance) * 100 : 0
  );

  // Calculate cumulative variance
  const cumulativeVariance: number[] = [];
  let cumSum = 0;
  for (const v of varianceExplained) {
    cumSum += v;
    cumulativeVariance.push(cumSum);
  }

  // Step 6: Calculate scores (project centered data onto eigenvectors)
  // scores[i][k] = sum over j of centered[i][j] * eigenvector[k][j]
  const scores: number[][] = centered.map(row => {
    return selectedEigenvectors.map(ev =>
      row.reduce((sum, val, j) => sum + val * ev[j], 0)
    );
  });

  // Step 7: Calculate loadings (scaled eigenvectors)
  // loadings[j][k] = eigenvector[k][j] * sqrt(eigenvalue[k])
  // This gives the "scaled coordinates" from the manual
  const loadings: number[][] = [];
  for (let j = 0; j < p; j++) {
    loadings[j] = selectedEigenvectors.map((ev, k) => {
      const sqrtEigenvalue = Math.sqrt(Math.max(0, selectedEigenvalues[k]));
      return ev[j] * sqrtEigenvalue;
    });
  }

  return {
    scores,
    loadings,
    eigenvectors: selectedEigenvectors,
    eigenvalues: selectedEigenvalues,
    varianceExplained,
    cumulativeVariance,
    correlationMatrix,
    columns,
    means,
    nSamples: n,
    zerosReplaced: clrResult.zerosReplaced
  };
}

/**
 * Perform PCA directly on pre-transformed CLR data
 */
export function fullPCAFromCLR(
  clrData: number[][],
  columns: string[],
  nComponents: number = 8
): FullPCAResult {
  if (clrData.length === 0 || columns.length === 0) {
    return {
      scores: [],
      loadings: [],
      eigenvectors: [],
      eigenvalues: [],
      varianceExplained: [],
      cumulativeVariance: [],
      correlationMatrix: [],
      columns: [],
      means: [],
      nSamples: 0,
      zerosReplaced: 0
    };
  }

  const n = clrData.length;
  const p = columns.length;

  // Center the data
  const means: number[] = new Array(p).fill(0);
  for (const row of clrData) {
    for (let j = 0; j < p; j++) {
      means[j] += row[j];
    }
  }
  for (let j = 0; j < p; j++) {
    means[j] /= n;
  }

  const centered: number[][] = clrData.map(row =>
    row.map((val, j) => val - means[j])
  );

  // Calculate correlation matrix
  const correlationMatrix = calculateCorrelationMatrix(clrData);

  // Eigendecomposition
  const { eigenvalues, eigenvectors } = jacobiEigendecomposition(correlationMatrix);

  // Limit components
  const actualComponents = Math.min(nComponents, eigenvalues.length, p);
  const selectedEigenvalues = eigenvalues.slice(0, actualComponents);
  const selectedEigenvectors = eigenvectors.slice(0, actualComponents);

  // Variance explained
  const totalVariance = eigenvalues.reduce((sum, ev) => sum + Math.max(0, ev), 0);
  const varianceExplained = selectedEigenvalues.map(ev =>
    totalVariance > 0 ? (Math.max(0, ev) / totalVariance) * 100 : 0
  );

  const cumulativeVariance: number[] = [];
  let cumSum = 0;
  for (const v of varianceExplained) {
    cumSum += v;
    cumulativeVariance.push(cumSum);
  }

  // Scores
  const scores: number[][] = centered.map(row => {
    return selectedEigenvectors.map(ev =>
      row.reduce((sum, val, j) => sum + val * ev[j], 0)
    );
  });

  // Loadings (scaled eigenvectors)
  const loadings: number[][] = [];
  for (let j = 0; j < p; j++) {
    loadings[j] = selectedEigenvectors.map((ev, k) => {
      const sqrtEigenvalue = Math.sqrt(Math.max(0, selectedEigenvalues[k]));
      return ev[j] * sqrtEigenvalue;
    });
  }

  return {
    scores,
    loadings,
    eigenvectors: selectedEigenvectors,
    eigenvalues: selectedEigenvalues,
    varianceExplained,
    cumulativeVariance,
    correlationMatrix,
    columns,
    means,
    nSamples: n,
    zerosReplaced: 0
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get loadings for a specific component, sorted by magnitude (highest to lowest)
 * This creates the data for the sorted loading matrix visualization
 */
export function getSortedLoadings(
  pcaResult: FullPCAResult,
  componentIndex: number
): SortedLoading[] {
  if (componentIndex < 0 || componentIndex >= pcaResult.eigenvalues.length) {
    return [];
  }

  const loadingsWithNames: SortedLoading[] = pcaResult.columns.map((element, i) => ({
    element,
    loading: pcaResult.loadings[i]?.[componentIndex] ?? 0
  }));

  // Sort by loading value (highest to lowest)
  loadingsWithNames.sort((a, b) => b.loading - a.loading);

  return loadingsWithNames;
}

/**
 * Get all sorted loadings for multiple components
 */
export function getAllSortedLoadings(
  pcaResult: FullPCAResult,
  nComponents?: number
): SortedLoading[][] {
  const numComponents = nComponents ?? pcaResult.eigenvalues.length;
  const result: SortedLoading[][] = [];

  for (let i = 0; i < numComponents; i++) {
    result.push(getSortedLoadings(pcaResult, i));
  }

  return result;
}

/**
 * Calculate element quality based on Below Detection Limit (BLD) values
 * Elements with BLD N-score > -1 should be excluded from PCA
 *
 * @param data - Raw data records
 * @param column - Column to assess
 * @param detectionLimit - Optional detection limit value (if known)
 */
export function assessElementQuality(
  data: Record<string, any>[],
  column: string,
  detectionLimit?: number
): ElementQualityInfo {
  // Collect all numeric values
  const values: number[] = [];
  let countBLD = 0;

  for (const row of data) {
    const val = row[column];
    if (val == null || (typeof val === 'number' && isNaN(val))) {
      continue; // Skip null/NaN
    }

    const numVal = Number(val);
    if (!isNaN(numVal)) {
      values.push(numVal);

      // Count BLD values (values at or below detection limit, or zero)
      if (detectionLimit !== undefined) {
        if (numVal <= detectionLimit) countBLD++;
      } else {
        // If no detection limit provided, consider values at the minimum as BLD
        // This will be refined after we know the minimum
      }
    }
  }

  if (values.length === 0) {
    return {
      element: column,
      bldNScore: 0,
      percentBLD: 100,
      countBLD: 0,
      totalCount: 0,
      isAcceptable: false
    };
  }

  // Sort values
  values.sort((a, b) => a - b);
  const n = values.length;

  // If no detection limit, estimate from minimum value
  // Count values equal to minimum as potential BLD
  if (detectionLimit === undefined) {
    const minVal = values[0];
    countBLD = values.filter(v => v === minVal).length;
  }

  // Calculate N-score of BLD threshold
  // Using plotting position formula: p = (i + 0.5) / n
  // BLD values are at the lowest end, so their position is countBLD / n
  const bldProportion = countBLD / n;

  // Convert proportion to N-score using inverse normal CDF approximation
  let bldNScore: number;
  if (bldProportion <= 0) {
    bldNScore = -4; // Very negative (no BLD)
  } else if (bldProportion >= 1) {
    bldNScore = 4; // All values are BLD
  } else {
    bldNScore = inverseNormalCDF(bldProportion);
  }

  const percentBLD = (countBLD / n) * 100;
  const isAcceptable = bldNScore < -1;

  return {
    element: column,
    bldNScore,
    percentBLD,
    countBLD,
    totalCount: n,
    isAcceptable
  };
}

/**
 * Inverse normal CDF using Acklam's approximation
 * Same algorithm used in ProbabilityPlot.tsx
 */
function inverseNormalCDF(p: number): number {
  const c0 = 2.515517;
  const c1 = 0.802853;
  const c2 = 0.010328;
  const d1 = 1.432788;
  const d2 = 0.189269;
  const d3 = 0.001308;

  if (p <= 0) return -4;
  if (p >= 1) return 4;

  let t: number;
  let z: number;

  if (p < 0.5) {
    t = Math.sqrt(-2 * Math.log(p));
    z = -(t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t));
  } else {
    t = Math.sqrt(-2 * Math.log(1 - p));
    z = t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t);
  }

  return z;
}

/**
 * Batch assess quality for multiple elements
 */
export function assessAllElementQuality(
  data: Record<string, any>[],
  columns: string[],
  detectionLimits?: Record<string, number>
): ElementQualityInfo[] {
  return columns.map(col =>
    assessElementQuality(data, col, detectionLimits?.[col])
  );
}

/**
 * Filter elements to only those passing quality check
 */
export function filterQualityElements(
  columns: string[],
  qualityInfo: ElementQualityInfo[]
): string[] {
  const qualityMap = new Map(qualityInfo.map(q => [q.element, q.isAcceptable]));
  return columns.filter(col => qualityMap.get(col) !== false);
}

export default {
  jacobiEigendecomposition,
  fullPCA,
  fullPCAFromCLR,
  getSortedLoadings,
  getAllSortedLoadings,
  assessElementQuality,
  assessAllElementQuality,
  filterQualityElements,
  calculateCorrelationMatrix
};
