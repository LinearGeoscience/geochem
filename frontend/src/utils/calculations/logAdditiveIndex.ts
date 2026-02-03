/**
 * Log Additive Index Calculations
 *
 * Creates indices by summing log10 values of multiple elements.
 * Useful for highlighting mineralisation signatures without being affected by
 * different units and orders of magnitude.
 *
 * Formula: Index = LOG10(E1) + LOG10(E2) + ... + LOG10(En)
 */

import { ZeroHandlingStrategy } from '../../types/compositional';

export interface LogAdditiveIndexConfig {
  name: string;
  columns: string[];
  zeroStrategy: ZeroHandlingStrategy;
  customZeroValue?: number;
}

export interface LogAdditiveIndexResult {
  id: string;
  name: string;
  columns: string[];
  values: (number | null)[];
  statistics: {
    min: number;
    max: number;
    mean: number;
    zerosReplaced: number;
  };
  timestamp: Date;
}

export interface LogAdditiveValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate columns for log additive index calculation
 */
export function validateLogAdditiveColumns(
  data: Record<string, any>[],
  columns: string[]
): LogAdditiveValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check minimum columns
  if (columns.length < 2) {
    errors.push('At least 2 columns are required for a log additive index');
  }

  // Check for data presence
  if (data.length === 0) {
    errors.push('No data available');
    return { valid: false, errors, warnings };
  }

  // Check each column exists and has numeric data
  for (const col of columns) {
    const values = data.map(row => row[col]);
    const numericValues = values.filter(v => typeof v === 'number' && !isNaN(v));

    if (numericValues.length === 0) {
      errors.push(`Column "${col}" has no numeric values`);
      continue;
    }

    // Check for zeros/negatives
    const nonPositiveCount = numericValues.filter(v => v <= 0).length;
    if (nonPositiveCount > 0) {
      warnings.push(`Column "${col}" has ${nonPositiveCount} zero/negative values that will be replaced`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Get minimum non-zero positive value for a column
 */
function getColumnMinPositive(data: Record<string, any>[], column: string): number {
  let minVal = Infinity;
  for (const row of data) {
    const val = row[column];
    if (typeof val === 'number' && !isNaN(val) && val > 0 && val < minVal) {
      minVal = val;
    }
  }
  return minVal === Infinity ? 0.001 : minVal;
}

/**
 * Apply zero replacement strategy for a single value
 */
function applyZeroReplacement(
  value: number,
  column: string,
  data: Record<string, any>[],
  strategy: ZeroHandlingStrategy,
  customValue?: number
): number {
  if (value > 0) return value;

  switch (strategy) {
    case 'half-min': {
      const minPos = getColumnMinPositive(data, column);
      return minPos / 2;
    }
    case 'half-dl': {
      // Use half minimum as proxy for detection limit
      const minPos = getColumnMinPositive(data, column);
      return minPos / 2;
    }
    case 'small-constant': {
      const minPos = getColumnMinPositive(data, column);
      return minPos * 0.65;
    }
    case 'multiplicative': {
      // Simple multiplicative - use 65% of minimum
      const minPos = getColumnMinPositive(data, column);
      return minPos * 0.65;
    }
    case 'custom': {
      return customValue ?? 0.001;
    }
    default: {
      const minPos = getColumnMinPositive(data, column);
      return minPos / 2;
    }
  }
}

/**
 * Calculate log additive index
 * Index = LOG10(E1) + LOG10(E2) + ... + LOG10(En)
 */
export function calculateLogAdditiveIndex(
  data: Record<string, any>[],
  columns: string[],
  zeroStrategy: ZeroHandlingStrategy,
  customZeroValue?: number
): { values: (number | null)[]; zerosReplaced: number } {
  let zerosReplaced = 0;

  const values = data.map(row => {
    let sum = 0;
    let hasNull = false;

    for (const col of columns) {
      let val = row[col];

      // Handle null/undefined/NaN
      if (val == null || (typeof val === 'number' && isNaN(val))) {
        hasNull = true;
        break;
      }

      // Convert to number if string
      if (typeof val === 'string') {
        val = parseFloat(val);
        if (isNaN(val)) {
          hasNull = true;
          break;
        }
      }

      // Handle zeros/negatives (apply replacement strategy)
      if (val <= 0) {
        val = applyZeroReplacement(val, col, data, zeroStrategy, customZeroValue);
        zerosReplaced++;
      }

      sum += Math.log10(val);
    }

    return hasNull ? null : sum;
  });

  return { values, zerosReplaced };
}

/**
 * Calculate statistics for the index values
 */
export function calculateIndexStatistics(values: (number | null)[]): {
  min: number;
  max: number;
  mean: number;
  validCount: number;
  nullCount: number;
} {
  const validValues = values.filter((v): v is number => v !== null && !isNaN(v));

  if (validValues.length === 0) {
    return { min: 0, max: 0, mean: 0, validCount: 0, nullCount: values.length };
  }

  const min = Math.min(...validValues);
  const max = Math.max(...validValues);
  const mean = validValues.reduce((a, b) => a + b, 0) / validValues.length;

  return {
    min,
    max,
    mean,
    validCount: validValues.length,
    nullCount: values.length - validValues.length
  };
}

/**
 * Auto-generate a name for the log additive index based on column names
 * e.g., ["Cu_ppm", "Zn_ppm", "Pb_ppm", "Ag_ppm"] -> "Log_CuZnPbAg"
 */
export function suggestIndexName(columns: string[]): string {
  // Extract element symbols from column names
  const elementPattern = /^([A-Z][a-z]?)(?:_|2O3|2O|O2|O|ppm|ppb|pct|%)?/i;

  const elements = columns.map(col => {
    const match = col.match(elementPattern);
    if (match) {
      // Capitalize first letter only
      const elem = match[1];
      return elem.charAt(0).toUpperCase() + elem.slice(1).toLowerCase();
    }
    // Fallback: use first 2 chars
    return col.slice(0, 2);
  });

  // Limit to reasonable length
  const maxElements = 6;
  const truncated = elements.slice(0, maxElements);
  const suffix = elements.length > maxElements ? '+' : '';

  return `Log_${truncated.join('')}${suffix}`;
}

/**
 * Create a complete log additive index result
 */
export function createLogAdditiveIndex(
  data: Record<string, any>[],
  config: LogAdditiveIndexConfig
): LogAdditiveIndexResult | null {
  // Validate
  const validation = validateLogAdditiveColumns(data, config.columns);
  if (!validation.valid) {
    console.error('[LogAdditiveIndex] Validation failed:', validation.errors);
    return null;
  }

  // Calculate
  const { values, zerosReplaced } = calculateLogAdditiveIndex(
    data,
    config.columns,
    config.zeroStrategy,
    config.customZeroValue
  );

  // Statistics
  const stats = calculateIndexStatistics(values);

  return {
    id: `logadd_${Date.now()}`,
    name: config.name,
    columns: config.columns,
    values,
    statistics: {
      min: stats.min,
      max: stats.max,
      mean: stats.mean,
      zerosReplaced
    },
    timestamp: new Date()
  };
}
