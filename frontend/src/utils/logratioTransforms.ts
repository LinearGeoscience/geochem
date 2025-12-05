/**
 * Comprehensive Logratio Transformation Library for Compositional Data Analysis
 *
 * Based on GeoCoDA workflow (Grunsky, Greenacre & Kjarsgaard, 2024)
 *
 * This library implements the complete suite of logratio transformations:
 * - PLR (Pairwise Log-Ratio): log(xj/xk)
 * - ALR (Additive Log-Ratio): log(xj/xD) with fixed denominator
 * - CLR (Centered Log-Ratio): log(xj/g(x)) where g(x) is geometric mean
 * - ILR (Isometric Log-Ratio): Orthonormal basis transformation
 * - SLR (Summed Log-Ratio / Amalgamation): log(Σgroup1/Σgroup2)
 *
 * Plus:
 * - chiPower transformation for data with zeros
 * - Variance decomposition methods
 * - Procrustes correlation for optimal ALR reference selection
 *
 * References:
 * - Aitchison (1986) - The Statistical Analysis of Compositional Data
 * - Greenacre et al. (2023) - Aitchison's compositional data analysis 40 years on
 * - Grunsky et al. (2024) - GeoCoDA workflow
 */

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

export type ZeroHandlingStrategy =
  | 'half-min'
  | 'half-dl'
  | 'small-constant'
  | 'multiplicative'
  | 'custom';

export type ZeroType = 'structural' | 'missing' | 'below-dl' | 'unknown';

export interface ZeroClassification {
  index: number;
  column: string;
  type: ZeroType;
  detectionLimit?: number;
}

export interface TransformOptions {
  zeroStrategy: ZeroHandlingStrategy;
  customZeroValue?: number;
  smallConstant?: number;
  detectionLimits?: Record<string, number>;
}

export interface PLRResult {
  /** All pairwise logratios as matrix [samples x PLRs] */
  values: number[][];
  /** Names of PLRs in format "A/B" */
  names: string[];
  /** Number of unique PLRs */
  count: number;
  /** Original column indices for numerator */
  numeratorIndices: number[];
  /** Original column indices for denominator */
  denominatorIndices: number[];
}

export interface ALRResult {
  /** ALR-transformed values [samples x (J-1)] */
  values: number[][];
  /** Names of ALRs in format "A/ref" */
  names: string[];
  /** Reference element name */
  reference: string;
  /** Reference element index */
  referenceIndex: number;
  /** Procrustes correlation with exact logratio geometry */
  procrustesCorrelation?: number;
}

export interface CLRResult {
  /** CLR-transformed values [samples x J] */
  values: number[][];
  /** Column names */
  columns: string[];
  /** Geometric means per sample */
  geometricMeans: number[];
  /** Number of zeros replaced */
  zerosReplaced: number;
}

export interface ILRResult {
  /** ILR-transformed values [samples x (J-1)] */
  values: number[][];
  /** Names/descriptions of ILR balances */
  names: string[];
  /** Contrast matrix used */
  contrastMatrix: number[][];
}

export interface SLRResult {
  /** SLR value per sample */
  values: number[];
  /** Name of the SLR */
  name: string;
  /** Elements in numerator group */
  numeratorGroup: string[];
  /** Elements in denominator group */
  denominatorGroup: string[];
}

export interface AmalgamationDefinition {
  id: string;
  name: string;
  description: string;
  elements: string[];
  category: 'mantle' | 'crustal' | 'magmatic' | 'felsic' | 'mafic' | 'ree' | 'custom';
}

export interface VarianceDecomposition {
  /** PLR name */
  plr: string;
  /** Contributed variance (% of total) */
  contributedVariance: number;
  /** Explained variance (R²) */
  explainedVariance: number;
  /** Between-group variance (if groups provided) */
  betweenGroupVariance?: number;
}

export interface ChiPowerResult {
  /** Transformed values */
  values: number[][];
  /** Lambda parameter used */
  lambda: number;
  /** Column names */
  columns: string[];
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Calculate geometric mean of positive values
 */
export function geometricMean(values: number[]): number {
  const positiveValues = values.filter(v => v > 0);
  if (positiveValues.length === 0) return 0;

  const logSum = positiveValues.reduce((sum, v) => sum + Math.log(v), 0);
  return Math.exp(logSum / positiveValues.length);
}

/**
 * Calculate arithmetic mean
 */
export function arithmeticMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Calculate variance
 */
export function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = arithmeticMean(values);
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return squaredDiffs.reduce((a, b) => a + b, 0) / (values.length - 1);
}

/**
 * Calculate standard deviation
 */
export function standardDeviation(values: number[]): number {
  return Math.sqrt(variance(values));
}

/**
 * Classify zeros into types based on context
 */
export function classifyZeros(
  data: Record<string, any>[],
  columns: string[],
  detectionLimits?: Record<string, number>
): ZeroClassification[] {
  const classifications: ZeroClassification[] = [];

  for (let i = 0; i < data.length; i++) {
    for (const col of columns) {
      const val = data[i][col];

      if (val === 0 || val === null || val === undefined ||
          (typeof val === 'number' && isNaN(val))) {
        let type: ZeroType = 'unknown';
        let dl: number | undefined;

        // Check if we have detection limit info
        if (detectionLimits && detectionLimits[col]) {
          type = 'below-dl';
          dl = detectionLimits[col];
        } else if (val === null || val === undefined) {
          type = 'missing';
        } else {
          // Could be structural or below-dl - need context
          type = 'unknown';
        }

        classifications.push({
          index: i,
          column: col,
          type,
          detectionLimit: dl
        });
      }
    }
  }

  return classifications;
}

/**
 * Replace zeros using specified strategy
 */
export function replaceZeros(
  matrix: number[][],
  strategy: ZeroHandlingStrategy,
  options?: {
    customValue?: number;
    smallConstant?: number;
    detectionLimits?: number[];
  }
): { replaced: number[][]; count: number } {
  const replaced: number[][] = [];
  let count = 0;

  // Calculate global minimum non-zero value
  let globalMinNonZero = Infinity;
  for (const row of matrix) {
    for (const val of row) {
      if (val > 0 && val < globalMinNonZero) {
        globalMinNonZero = val;
      }
    }
  }
  if (globalMinNonZero === Infinity) globalMinNonZero = 0.001;

  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i];
    const newRow: number[] = [];

    if (strategy === 'multiplicative') {
      const result = multiplicativeReplacement(row);
      replaced.push(result.replaced);
      count += result.zerosFound;
      continue;
    }

    for (let j = 0; j < row.length; j++) {
      const val = row[j];

      if (val <= 0 || isNaN(val)) {
        count++;
        let replacement: number;

        switch (strategy) {
          case 'half-min':
            replacement = globalMinNonZero / 2;
            break;
          case 'half-dl':
            replacement = (options?.detectionLimits?.[j] ?? globalMinNonZero) / 2;
            break;
          case 'small-constant':
            replacement = options?.smallConstant ?? 0.65 * globalMinNonZero;
            break;
          case 'custom':
            replacement = options?.customValue ?? 0.001;
            break;
          default:
            replacement = globalMinNonZero / 2;
        }

        newRow.push(replacement);
      } else {
        newRow.push(val);
      }
    }

    replaced.push(newRow);
  }

  return { replaced, count };
}

/**
 * Multiplicative replacement (Martín-Fernández et al., 2003)
 */
function multiplicativeReplacement(row: number[]): { replaced: number[]; zerosFound: number } {
  const n = row.length;
  const zeroIndices: number[] = [];
  const nonZeroIndices: number[] = [];

  for (let i = 0; i < n; i++) {
    if (row[i] <= 0 || isNaN(row[i])) {
      zeroIndices.push(i);
    } else {
      nonZeroIndices.push(i);
    }
  }

  if (zeroIndices.length === 0) {
    return { replaced: [...row], zerosFound: 0 };
  }

  if (nonZeroIndices.length === 0) {
    // All zeros - can't do multiplicative replacement
    return { replaced: row.map(() => 0.001), zerosFound: n };
  }

  const nonZeroSum = nonZeroIndices.reduce((sum, i) => sum + row[i], 0);
  const minNonZero = Math.min(...nonZeroIndices.map(i => row[i]));
  const delta = minNonZero * 0.65;

  const adjustment = (nonZeroSum - zeroIndices.length * delta) / nonZeroSum;

  const replaced: number[] = [];
  for (let i = 0; i < n; i++) {
    if (row[i] <= 0 || isNaN(row[i])) {
      replaced.push(delta);
    } else {
      replaced.push(row[i] * adjustment);
    }
  }

  return { replaced, zerosFound: zeroIndices.length };
}

// ============================================================================
// PLR (PAIRWISE LOG-RATIO) TRANSFORMATION
// ============================================================================

/**
 * Calculate all pairwise logratios PLR(j,k) = log(xj/xk)
 * Returns J(J-1)/2 unique PLRs
 */
export function plrTransform(
  data: Record<string, any>[],
  columns: string[],
  options: TransformOptions = { zeroStrategy: 'half-min' }
): PLRResult {
  const J = columns.length;
  const numPLRs = (J * (J - 1)) / 2;

  // Extract and prepare matrix
  const rawMatrix = data.map(row =>
    columns.map(col => {
      const val = row[col];
      return typeof val === 'number' && !isNaN(val) ? val : 0;
    })
  );

  // Replace zeros
  const { replaced } = replaceZeros(rawMatrix, options.zeroStrategy, {
    customValue: options.customZeroValue,
    smallConstant: options.smallConstant
  });

  // Calculate all unique PLRs
  const plrValues: number[][] = [];
  const plrNames: string[] = [];
  const numeratorIndices: number[] = [];
  const denominatorIndices: number[] = [];

  for (let j = 0; j < J; j++) {
    for (let k = j + 1; k < J; k++) {
      plrNames.push(`${columns[j]}/${columns[k]}`);
      numeratorIndices.push(j);
      denominatorIndices.push(k);
    }
  }

  // Calculate PLR values for each sample
  for (const row of replaced) {
    const plrs: number[] = [];
    for (let j = 0; j < J; j++) {
      for (let k = j + 1; k < J; k++) {
        const plr = Math.log(row[j] / row[k]);
        plrs.push(isFinite(plr) ? plr : 0);
      }
    }
    plrValues.push(plrs);
  }

  return {
    values: plrValues,
    names: plrNames,
    count: numPLRs,
    numeratorIndices,
    denominatorIndices
  };
}

/**
 * Get a specific PLR value
 */
export function getPLR(
  data: Record<string, any>[],
  numerator: string,
  denominator: string,
  options: TransformOptions = { zeroStrategy: 'half-min' }
): number[] {
  const values: number[] = [];

  for (const row of data) {
    let numVal = row[numerator];
    let denVal = row[denominator];

    // Handle zeros
    if (numVal <= 0) numVal = options.customZeroValue ?? 0.001;
    if (denVal <= 0) denVal = options.customZeroValue ?? 0.001;

    const plr = Math.log(numVal / denVal);
    values.push(isFinite(plr) ? plr : 0);
  }

  return values;
}

// ============================================================================
// ALR (ADDITIVE LOG-RATIO) TRANSFORMATION
// ============================================================================

/**
 * Calculate ALR transformation with specified reference element
 * ALR(xj) = log(xj/xD) for j ≠ D
 */
export function alrTransform(
  data: Record<string, any>[],
  columns: string[],
  referenceColumn: string,
  options: TransformOptions = { zeroStrategy: 'half-min' }
): ALRResult {
  const refIndex = columns.indexOf(referenceColumn);
  if (refIndex === -1) {
    throw new Error(`Reference column "${referenceColumn}" not found in columns`);
  }

  // Extract and prepare matrix
  const rawMatrix = data.map(row =>
    columns.map(col => {
      const val = row[col];
      return typeof val === 'number' && !isNaN(val) ? val : 0;
    })
  );

  // Replace zeros
  const { replaced } = replaceZeros(rawMatrix, options.zeroStrategy, {
    customValue: options.customZeroValue,
    smallConstant: options.smallConstant
  });

  // Calculate ALRs (all columns except reference)
  const alrNames: string[] = [];
  const alrValues: number[][] = [];

  for (let j = 0; j < columns.length; j++) {
    if (j !== refIndex) {
      alrNames.push(`${columns[j]}/${referenceColumn}`);
    }
  }

  for (const row of replaced) {
    const refVal = row[refIndex];
    const alrs: number[] = [];

    for (let j = 0; j < row.length; j++) {
      if (j !== refIndex) {
        const alr = Math.log(row[j] / refVal);
        alrs.push(isFinite(alr) ? alr : 0);
      }
    }

    alrValues.push(alrs);
  }

  return {
    values: alrValues,
    names: alrNames,
    reference: referenceColumn,
    referenceIndex: refIndex
  };
}

/**
 * Procrustes correlation for ALR reference selection
 * Higher correlation = closer to exact logratio geometry
 * Based on GeoCoDA supplementary material Section S6
 */
export function calculateProcrustesCorrelation(
  data: Record<string, any>[],
  columns: string[],
  referenceColumn: string,
  options: TransformOptions = { zeroStrategy: 'half-min' }
): number {
  // Get ALR with this reference
  const alr = alrTransform(data, columns, referenceColumn, options);

  // Get CLR (represents exact logratio geometry)
  const clr = clrTransform(data, columns, options);

  // Calculate Procrustes correlation between ALR and CLR geometries
  // This is a simplified version - full implementation would use SVD

  // For now, use correlation of pairwise distances
  const n = data.length;
  if (n < 3) return 0;

  // Calculate pairwise distances in ALR space
  const alrDists: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let dist = 0;
      for (let k = 0; k < alr.values[0].length; k++) {
        dist += Math.pow(alr.values[i][k] - alr.values[j][k], 2);
      }
      alrDists.push(Math.sqrt(dist));
    }
  }

  // Calculate pairwise distances in CLR space (exact logratio geometry)
  const clrDists: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let dist = 0;
      for (let k = 0; k < clr.values[0].length; k++) {
        dist += Math.pow(clr.values[i][k] - clr.values[j][k], 2);
      }
      clrDists.push(Math.sqrt(dist));
    }
  }

  // Calculate correlation between distance vectors
  return pearsonCorrelation(alrDists, clrDists);
}

/**
 * Find optimal ALR reference element using Procrustes correlation
 */
export function findOptimalALRReference(
  data: Record<string, any>[],
  columns: string[],
  options: TransformOptions = { zeroStrategy: 'half-min' }
): { reference: string; correlation: number; rankings: Array<{ element: string; correlation: number }> } {
  const rankings: Array<{ element: string; correlation: number }> = [];

  for (const col of columns) {
    try {
      const correlation = calculateProcrustesCorrelation(data, columns, col, options);
      rankings.push({ element: col, correlation });
    } catch {
      rankings.push({ element: col, correlation: 0 });
    }
  }

  // Sort by correlation descending
  rankings.sort((a, b) => b.correlation - a.correlation);

  return {
    reference: rankings[0]?.element ?? columns[0],
    correlation: rankings[0]?.correlation ?? 0,
    rankings
  };
}

/**
 * Pearson correlation coefficient
 */
function pearsonCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 2) return 0;

  const n = x.length;
  const meanX = arithmeticMean(x);
  const meanY = arithmeticMean(y);

  let numerator = 0;
  let denomX = 0;
  let denomY = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  const denom = Math.sqrt(denomX * denomY);
  if (denom === 0) return 0;

  return numerator / denom;
}

// ============================================================================
// CLR (CENTERED LOG-RATIO) TRANSFORMATION
// ============================================================================

/**
 * Calculate CLR transformation
 * CLR(xj) = log(xj/g(x)) where g(x) is the geometric mean
 */
export function clrTransform(
  data: Record<string, any>[],
  columns: string[],
  options: TransformOptions = { zeroStrategy: 'half-min' }
): CLRResult {
  if (data.length === 0 || columns.length === 0) {
    return {
      values: [],
      columns,
      geometricMeans: [],
      zerosReplaced: 0
    };
  }

  // Extract numeric matrix
  const rawMatrix = data.map(row =>
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

  // Apply CLR transformation
  const geometricMeans: number[] = [];
  const clrValues: number[][] = [];

  for (const row of replaced) {
    const gm = geometricMean(row);
    geometricMeans.push(gm);

    if (gm === 0) {
      clrValues.push(row.map(() => 0));
    } else {
      clrValues.push(row.map(val => Math.log(val / gm)));
    }
  }

  return {
    values: clrValues,
    columns,
    geometricMeans,
    zerosReplaced: count
  };
}

/**
 * Inverse CLR transformation (back to compositional space)
 */
export function inverseCLR(clrValues: number[]): number[] {
  const expValues = clrValues.map(v => Math.exp(v));
  const sum = expValues.reduce((a, b) => a + b, 0);
  return expValues.map(v => v / sum);
}

// ============================================================================
// ILR (ISOMETRIC LOG-RATIO) TRANSFORMATION
// ============================================================================

/**
 * Calculate ILR transformation using sequential binary partition
 * ILR provides orthonormal coordinates but is harder to interpret
 */
export function ilrTransform(
  data: Record<string, any>[],
  columns: string[],
  options: TransformOptions = { zeroStrategy: 'half-min' }
): ILRResult {
  const J = columns.length;

  // Extract and prepare matrix
  const rawMatrix = data.map(row =>
    columns.map(col => {
      const val = row[col];
      return typeof val === 'number' && !isNaN(val) ? val : 0;
    })
  );

  // Replace zeros
  const { replaced } = replaceZeros(rawMatrix, options.zeroStrategy, {
    customValue: options.customZeroValue,
    smallConstant: options.smallConstant
  });

  // Create default ILR contrast matrix (sequential binary partition)
  const contrastMatrix = createDefaultILRContrastMatrix(J);

  // Apply ILR transformation
  const ilrValues: number[][] = [];

  for (const row of replaced) {
    const logRow = row.map(v => Math.log(v));
    const ilrs: number[] = [];

    for (let i = 0; i < J - 1; i++) {
      let ilr = 0;
      for (let j = 0; j < J; j++) {
        ilr += contrastMatrix[i][j] * logRow[j];
      }
      ilrs.push(ilr);
    }

    ilrValues.push(ilrs);
  }

  // Create names for ILR balances
  const ilrNames: string[] = [];
  for (let i = 0; i < J - 1; i++) {
    ilrNames.push(`ILR_${i + 1}`);
  }

  return {
    values: ilrValues,
    names: ilrNames,
    contrastMatrix
  };
}

/**
 * Create default ILR contrast matrix using sequential binary partition
 */
function createDefaultILRContrastMatrix(J: number): number[][] {
  const V: number[][] = [];

  for (let i = 0; i < J - 1; i++) {
    const row: number[] = new Array(J).fill(0);
    const r = J - i;
    const s = 1;
    const coef = Math.sqrt((r * s) / (r + s));

    // First i elements get 0
    // Element i+1 gets positive coefficient
    // Remaining elements get negative coefficient
    row[i] = coef * Math.sqrt(r - 1);
    for (let j = i + 1; j < J; j++) {
      row[j] = -coef / Math.sqrt(r - 1);
    }

    // Normalize
    const norm = Math.sqrt(row.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let j = 0; j < J; j++) {
        row[j] /= norm;
      }
    }

    V.push(row);
  }

  return V;
}

// ============================================================================
// SLR (SUMMED LOG-RATIO / AMALGAMATION) TRANSFORMATION
// ============================================================================

/**
 * Pre-defined amalgamation groups based on GeoCoDA
 */
export const PREDEFINED_AMALGAMATIONS: AmalgamationDefinition[] = [
  {
    id: 'mantle',
    name: 'Mantle',
    description: 'Mantle-associated elements',
    elements: ['Si', 'SiO2', 'Mg', 'MgO', 'Fe', 'FeO', 'Fe2O3', 'Cr', 'Cr2O3', 'Co', 'Ni', 'Ti', 'TiO2'],
    category: 'mantle'
  },
  {
    id: 'crustal',
    name: 'Crustal',
    description: 'Crustal contamination elements',
    elements: ['Al', 'Al2O3', 'Rb', 'Na', 'Na2O', 'K', 'K2O', 'Ga'],
    category: 'crustal'
  },
  {
    id: 'kimberlite',
    name: 'Kimberlite/Magmatic',
    description: 'Kimberlite magma elements',
    elements: ['Nb', 'La', 'Th', 'Zr', 'P', 'P2O5', 'Er', 'Yb'],
    category: 'magmatic'
  },
  {
    id: 'felsic',
    name: 'Felsic',
    description: 'Felsic rock-forming elements',
    elements: ['Si', 'SiO2', 'Na', 'Na2O', 'K', 'K2O', 'Al', 'Al2O3'],
    category: 'felsic'
  },
  {
    id: 'mafic',
    name: 'Mafic',
    description: 'Mafic rock-forming elements',
    elements: ['Fe', 'FeO', 'Fe2O3', 'Mg', 'MgO', 'Ca', 'CaO', 'Ti', 'TiO2'],
    category: 'mafic'
  },
  {
    id: 'lree',
    name: 'LREE',
    description: 'Light Rare Earth Elements',
    elements: ['La', 'Ce', 'Pr', 'Nd', 'Sm'],
    category: 'ree'
  },
  {
    id: 'hree',
    name: 'HREE',
    description: 'Heavy Rare Earth Elements',
    elements: ['Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu'],
    category: 'ree'
  },
  {
    id: 'pathfinders_au',
    name: 'Gold Pathfinders',
    description: 'Gold pathfinder elements',
    elements: ['Au', 'As', 'Sb', 'W', 'Bi', 'Te', 'Ag'],
    category: 'custom'
  },
  {
    id: 'base_metals',
    name: 'Base Metals',
    description: 'Base metal suite',
    elements: ['Cu', 'Pb', 'Zn'],
    category: 'custom'
  },
  {
    id: 'immobile',
    name: 'Immobile Elements',
    description: 'Typically immobile HFSE',
    elements: ['Ti', 'TiO2', 'Zr', 'Nb', 'Y', 'Al', 'Al2O3'],
    category: 'custom'
  }
];

/**
 * Calculate SLR (Summed Log-Ratio) between two element groups
 * SLR = log(Σ group1 / Σ group2)
 */
export function slrTransform(
  data: Record<string, any>[],
  numeratorElements: string[],
  denominatorElements: string[],
  options: TransformOptions = { zeroStrategy: 'half-min' }
): SLRResult {
  const values: number[] = [];

  for (const row of data) {
    // Sum numerator group
    let numSum = 0;
    let numCount = 0;
    for (const elem of numeratorElements) {
      const val = row[elem];
      if (typeof val === 'number' && !isNaN(val)) {
        numSum += val > 0 ? val : (options.customZeroValue ?? 0.001);
        numCount++;
      }
    }

    // Sum denominator group
    let denSum = 0;
    let denCount = 0;
    for (const elem of denominatorElements) {
      const val = row[elem];
      if (typeof val === 'number' && !isNaN(val)) {
        denSum += val > 0 ? val : (options.customZeroValue ?? 0.001);
        denCount++;
      }
    }

    // Handle cases where groups are missing
    if (numCount === 0) numSum = options.customZeroValue ?? 0.001;
    if (denCount === 0) denSum = options.customZeroValue ?? 0.001;

    const slr = Math.log(numSum / denSum);
    values.push(isFinite(slr) ? slr : 0);
  }

  return {
    values,
    name: `(${numeratorElements.join('+')})/(${ denominatorElements.join('+')})`,
    numeratorGroup: numeratorElements,
    denominatorGroup: denominatorElements
  };
}

/**
 * Find matching columns for an amalgamation definition
 */
export function findAmalgamationColumns(
  availableColumns: string[],
  amalgamation: AmalgamationDefinition
): string[] {
  const matched: string[] = [];
  const lowerColumns = availableColumns.map(c => c.toLowerCase());

  for (const elem of amalgamation.elements) {
    const lowerElem = elem.toLowerCase();

    // Try exact match first
    const exactIndex = lowerColumns.findIndex(c => c === lowerElem);
    if (exactIndex !== -1) {
      matched.push(availableColumns[exactIndex]);
      continue;
    }

    // Try contains match
    const containsIndex = lowerColumns.findIndex(c =>
      c.includes(lowerElem) || lowerElem.includes(c)
    );
    if (containsIndex !== -1 && !matched.includes(availableColumns[containsIndex])) {
      matched.push(availableColumns[containsIndex]);
    }
  }

  return matched;
}

// ============================================================================
// chiPOWER TRANSFORMATION
// ============================================================================

/**
 * chiPower transformation for data with zeros
 * Combines chi-square standardization with Box-Cox power transformation
 * As λ → 0, chiPower → LRA (logratio analysis)
 *
 * Based on Greenacre (2023)
 */
export function chiPowerTransform(
  data: Record<string, any>[],
  columns: string[],
  lambda: number = 0.25  // Default: fourth-root transform
): ChiPowerResult {
  const n = data.length;
  const J = columns.length;

  if (n === 0 || J === 0) {
    return { values: [], lambda, columns };
  }

  // Extract matrix
  const matrix: number[][] = data.map(row =>
    columns.map(col => {
      const val = row[col];
      return typeof val === 'number' && !isNaN(val) && val >= 0 ? val : 0;
    })
  );

  // Calculate row sums and column sums
  const rowSums: number[] = matrix.map(row => row.reduce((a, b) => a + b, 0));
  const colSums: number[] = new Array(J).fill(0);
  let total = 0;

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < J; j++) {
      colSums[j] += matrix[i][j];
      total += matrix[i][j];
    }
  }

  if (total === 0) {
    return { values: matrix, lambda, columns };
  }

  // Calculate relative frequencies
  const rowFreqs = rowSums.map(s => s / total);
  const colFreqs = colSums.map(s => s / total);

  // Apply chiPower transformation
  const transformed: number[][] = [];

  for (let i = 0; i < n; i++) {
    const row: number[] = [];

    for (let j = 0; j < J; j++) {
      const pij = matrix[i][j] / total;
      const expected = rowFreqs[i] * colFreqs[j];

      if (expected > 0 && pij >= 0) {
        if (lambda === 0) {
          // Log transformation (limit case)
          row.push(pij > 0 ? Math.log(pij / expected) : 0);
        } else {
          // Box-Cox power transformation
          const ratio = pij / expected;
          if (ratio > 0) {
            row.push((Math.pow(ratio, lambda) - 1) / lambda);
          } else {
            row.push(-1 / lambda);  // Limit as ratio → 0
          }
        }
      } else {
        row.push(0);
      }
    }

    transformed.push(row);
  }

  return {
    values: transformed,
    lambda,
    columns
  };
}

/**
 * Find optimal lambda for chiPower transformation
 * Optimizes for group separation if groups are provided
 */
export function optimizeChiPowerLambda(
  data: Record<string, any>[],
  columns: string[],
  groups?: string[],  // Group labels for each sample
  lambdaRange: number[] = [0, 0.1, 0.25, 0.5, 0.75, 1.0]
): { optimalLambda: number; scores: Array<{ lambda: number; score: number }> } {
  const scores: Array<{ lambda: number; score: number }> = [];

  for (const lambda of lambdaRange) {
    const result = chiPowerTransform(data, columns, lambda);

    let score: number;
    if (groups && groups.length === data.length) {
      // Calculate between-group variance ratio
      score = calculateBetweenGroupVarianceRatio(result.values, groups);
    } else {
      // Calculate total variance as fallback
      score = calculateTotalVariance(result.values);
    }

    scores.push({ lambda, score });
  }

  // Find lambda with highest score
  scores.sort((a, b) => b.score - a.score);

  return {
    optimalLambda: scores[0].lambda,
    scores
  };
}

/**
 * Calculate between-group variance ratio (BSS/TSS)
 */
function calculateBetweenGroupVarianceRatio(values: number[][], groups: string[]): number {
  const n = values.length;
  if (n < 2 || values[0].length === 0) return 0;

  const J = values[0].length;

  // Get unique groups
  const uniqueGroups = [...new Set(groups)];
  const k = uniqueGroups.length;
  if (k < 2) return 0;

  // Calculate grand mean
  const grandMean: number[] = new Array(J).fill(0);
  for (const row of values) {
    for (let j = 0; j < J; j++) {
      grandMean[j] += row[j];
    }
  }
  for (let j = 0; j < J; j++) {
    grandMean[j] /= n;
  }

  // Calculate group means
  const groupMeans: Map<string, number[]> = new Map();
  const groupCounts: Map<string, number> = new Map();

  for (const g of uniqueGroups) {
    groupMeans.set(g, new Array(J).fill(0));
    groupCounts.set(g, 0);
  }

  for (let i = 0; i < n; i++) {
    const g = groups[i];
    const gMean = groupMeans.get(g)!;
    for (let j = 0; j < J; j++) {
      gMean[j] += values[i][j];
    }
    groupCounts.set(g, groupCounts.get(g)! + 1);
  }

  for (const g of uniqueGroups) {
    const gMean = groupMeans.get(g)!;
    const count = groupCounts.get(g)!;
    for (let j = 0; j < J; j++) {
      gMean[j] /= count;
    }
  }

  // Calculate BSS (between-group sum of squares)
  let bss = 0;
  for (const g of uniqueGroups) {
    const gMean = groupMeans.get(g)!;
    const count = groupCounts.get(g)!;
    for (let j = 0; j < J; j++) {
      bss += count * Math.pow(gMean[j] - grandMean[j], 2);
    }
  }

  // Calculate TSS (total sum of squares)
  let tss = 0;
  for (const row of values) {
    for (let j = 0; j < J; j++) {
      tss += Math.pow(row[j] - grandMean[j], 2);
    }
  }

  return tss > 0 ? bss / tss : 0;
}

/**
 * Calculate total variance of transformed data
 */
function calculateTotalVariance(values: number[][]): number {
  if (values.length === 0 || values[0].length === 0) return 0;

  const J = values[0].length;
  let totalVar = 0;

  for (let j = 0; j < J; j++) {
    const colValues = values.map(row => row[j]);
    totalVar += variance(colValues);
  }

  return totalVar;
}

// ============================================================================
// VARIANCE DECOMPOSITION
// ============================================================================

/**
 * Calculate variance decomposition for all PLRs
 * Returns contributed variance, explained variance, and between-group variance
 */
export function varianceDecomposition(
  data: Record<string, any>[],
  columns: string[],
  groups?: string[],
  options: TransformOptions = { zeroStrategy: 'half-min' }
): VarianceDecomposition[] {
  const plr = plrTransform(data, columns, options);
  const results: VarianceDecomposition[] = [];

  // Calculate total logratio variance
  let totalLogratioVariance = 0;
  for (let i = 0; i < plr.names.length; i++) {
    const plrValues = plr.values.map(row => row[i]);
    totalLogratioVariance += variance(plrValues);
  }

  for (let i = 0; i < plr.names.length; i++) {
    const plrValues = plr.values.map(row => row[i]);
    const plrVar = variance(plrValues);

    // Contributed variance (% of total)
    const contributedVariance = totalLogratioVariance > 0
      ? (plrVar / totalLogratioVariance) * 100
      : 0;

    // Explained variance (R² with all other PLRs)
    const explainedVariance = calculateExplainedVariance(plr.values, i);

    // Between-group variance (if groups provided)
    let betweenGroupVariance: number | undefined;
    if (groups && groups.length === data.length) {
      betweenGroupVariance = calculateBetweenGroupVarianceForPLR(plrValues, groups);
    }

    results.push({
      plr: plr.names[i],
      contributedVariance,
      explainedVariance,
      betweenGroupVariance
    });
  }

  return results;
}

/**
 * Calculate explained variance (R²) for a PLR
 */
function calculateExplainedVariance(plrMatrix: number[][], targetIndex: number): number {
  const n = plrMatrix.length;
  if (n < 3) return 0;

  const y = plrMatrix.map(row => row[targetIndex]);
  const yMean = arithmeticMean(y);

  // Simple approach: R² with sum of all other PLRs (proxy for explained variance)
  const X = plrMatrix.map(row => {
    let sum = 0;
    for (let j = 0; j < row.length; j++) {
      if (j !== targetIndex) {
        sum += row[j];
      }
    }
    return sum;
  });

  // Linear regression y ~ X
  const xMean = arithmeticMean(X);

  let numerator = 0;
  let denomX = 0;
  let denomY = 0;

  for (let i = 0; i < n; i++) {
    numerator += (X[i] - xMean) * (y[i] - yMean);
    denomX += Math.pow(X[i] - xMean, 2);
    denomY += Math.pow(y[i] - yMean, 2);
  }

  if (denomX === 0 || denomY === 0) return 0;

  const r = numerator / Math.sqrt(denomX * denomY);
  return r * r * 100;  // R² as percentage
}

/**
 * Calculate between-group variance for a single PLR
 */
function calculateBetweenGroupVarianceForPLR(values: number[], groups: string[]): number {
  const uniqueGroups = [...new Set(groups)];
  if (uniqueGroups.length < 2) return 0;

  const grandMean = arithmeticMean(values);

  // Calculate group means
  const groupMeans: Map<string, number> = new Map();
  const groupCounts: Map<string, number> = new Map();

  for (const g of uniqueGroups) {
    groupMeans.set(g, 0);
    groupCounts.set(g, 0);
  }

  for (let i = 0; i < values.length; i++) {
    const g = groups[i];
    groupMeans.set(g, groupMeans.get(g)! + values[i]);
    groupCounts.set(g, groupCounts.get(g)! + 1);
  }

  for (const g of uniqueGroups) {
    groupMeans.set(g, groupMeans.get(g)! / groupCounts.get(g)!);
  }

  // BSS
  let bss = 0;
  for (const g of uniqueGroups) {
    const gMean = groupMeans.get(g)!;
    const count = groupCounts.get(g)!;
    bss += count * Math.pow(gMean - grandMean, 2);
  }

  // TSS
  let tss = 0;
  for (const v of values) {
    tss += Math.pow(v - grandMean, 2);
  }

  return tss > 0 ? (bss / tss) * 100 : 0;
}

/**
 * Get top N PLRs by specified criterion
 */
export function getTopPLRs(
  decomposition: VarianceDecomposition[],
  criterion: 'contributed' | 'explained' | 'between-group',
  n: number = 10
): VarianceDecomposition[] {
  const sorted = [...decomposition].sort((a, b) => {
    switch (criterion) {
      case 'contributed':
        return b.contributedVariance - a.contributedVariance;
      case 'explained':
        return b.explainedVariance - a.explainedVariance;
      case 'between-group':
        return (b.betweenGroupVariance ?? 0) - (a.betweenGroupVariance ?? 0);
    }
  });

  return sorted.slice(0, n);
}

// ============================================================================
// CORRELATION AND COVARIANCE
// ============================================================================

/**
 * Calculate CLR covariance matrix
 */
export function clrCovarianceMatrix(clrValues: number[][]): number[][] {
  if (clrValues.length === 0) return [];

  const n = clrValues.length;
  const p = clrValues[0].length;

  // Calculate means
  const means: number[] = new Array(p).fill(0);
  for (const row of clrValues) {
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
        sum += (clrValues[k][i] - means[i]) * (clrValues[k][j] - means[j]);
      }
      cov[i][j] = sum / (n - 1);
    }
  }

  return cov;
}

/**
 * Calculate CLR correlation matrix
 */
export function clrCorrelationMatrix(clrValues: number[][]): number[][] {
  const cov = clrCovarianceMatrix(clrValues);
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

// ============================================================================
// PCA ON LOGRATIOS (LRA - LOGRATIO ANALYSIS)
// ============================================================================

/**
 * Perform PCA on CLR-transformed data (Logratio Analysis)
 */
export function logratioAnalysis(
  data: Record<string, any>[],
  columns: string[],
  options: TransformOptions = { zeroStrategy: 'half-min' },
  nComponents: number = 2
): {
  scores: number[][];
  loadings: number[][];
  variance: number[];
  totalVariance: number;
  columns: string[];
} {
  const clr = clrTransform(data, columns, options);

  if (clr.values.length === 0) {
    return { scores: [], loadings: [], variance: [], totalVariance: 0, columns };
  }

  const n = clr.values.length;
  const p = columns.length;

  // Center the data
  const means: number[] = new Array(p).fill(0);
  for (const row of clr.values) {
    for (let j = 0; j < p; j++) {
      means[j] += row[j];
    }
  }
  for (let j = 0; j < p; j++) {
    means[j] /= n;
  }

  const centered = clr.values.map(row => row.map((v, j) => v - means[j]));

  // Calculate covariance matrix
  const cov = clrCovarianceMatrix(clr.values);

  // Power iteration for eigendecomposition
  const eigen = powerIteration(cov, Math.min(nComponents, p));

  // Calculate scores
  const scores = centered.map(row => {
    return eigen.eigenvectors.map(ev =>
      row.reduce((sum, val, j) => sum + val * ev[j], 0)
    );
  });

  // Calculate loadings (eigenvectors scaled by sqrt of eigenvalues)
  const loadings: number[][] = [];
  for (let j = 0; j < p; j++) {
    loadings.push(eigen.eigenvectors.map((ev, k) =>
      ev[j] * Math.sqrt(Math.abs(eigen.eigenvalues[k]))
    ));
  }

  // Calculate variance explained
  const totalVar = eigen.eigenvalues.reduce((a, b) => a + Math.abs(b), 0);
  const varianceExplained = eigen.eigenvalues.map(v => Math.abs(v) / totalVar);

  return {
    scores,
    loadings,
    variance: varianceExplained,
    totalVariance: totalVar,
    columns
  };
}

/**
 * Power iteration for eigendecomposition
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
      const Av = A.map(row => row.reduce((sum, val, j) => sum + val * v[j], 0));
      norm = Math.sqrt(Av.reduce((sum, x) => sum + x * x, 0));
      if (norm < 1e-10) break;
      v = Av.map(x => x / norm);
    }

    // Eigenvalue
    const Av = A.map(row => row.reduce((sum, val, j) => sum + val * v[j], 0));
    const eigenvalue = v.reduce((sum, val, j) => sum + val * Av[j], 0);

    eigenvalues.push(eigenvalue);
    eigenvectors.push(v);

    // Deflation
    for (let j = 0; j < n; j++) {
      for (let l = 0; l < n; l++) {
        A[j][l] -= eigenvalue * v[j] * v[l];
      }
    }
  }

  return { eigenvalues, eigenvectors };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  // PLR
  plrTransform,
  getPLR,

  // ALR
  alrTransform,
  calculateProcrustesCorrelation,
  findOptimalALRReference,

  // CLR
  clrTransform,
  inverseCLR,
  clrCovarianceMatrix,
  clrCorrelationMatrix,

  // ILR
  ilrTransform,

  // SLR
  slrTransform,
  PREDEFINED_AMALGAMATIONS,
  findAmalgamationColumns,

  // chiPower
  chiPowerTransform,
  optimizeChiPowerLambda,

  // Variance decomposition
  varianceDecomposition,
  getTopPLRs,

  // PCA/LRA
  logratioAnalysis,

  // Utilities
  geometricMean,
  arithmeticMean,
  variance,
  standardDeviation,
  replaceZeros,
  classifyZeros
};
