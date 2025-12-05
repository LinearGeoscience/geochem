// Geochemical Data Validation

import { ValidationRule, ValidationResult, ValidationSeverity } from '../../types/calculations';
import { MAJOR_OXIDES, OXIDE_WEIGHTS } from './constants';
import { parseNumericValue, wtPercentToMolar } from './formulaEvaluator';

/**
 * Run validation rules on calculated data
 */
export function validateData(
    values: (number | null)[],
    rules: ValidationRule[],
    data?: Record<string, any>[]
): ValidationResult {
    const errors: { rowIndex: number; message: string; severity: ValidationSeverity }[] = [];
    const warnings: { rowIndex: number; message: string }[] = [];

    values.forEach((value, index) => {
        for (const rule of rules) {
            const row = data ? data[index] : {};
            const result = checkRule(value, rule, row);

            if (!result.valid) {
                if (result.severity === 'error') {
                    errors.push({ rowIndex: index, message: result.message, severity: 'error' });
                } else if (result.severity === 'warning') {
                    warnings.push({ rowIndex: index, message: result.message });
                }
            }
        }
    });

    return {
        isValid: errors.length === 0,
        errors,
        warnings,
    };
}

function checkRule(
    value: number | null,
    rule: ValidationRule,
    row: Record<string, any>
): { valid: boolean; message: string; severity: ValidationSeverity } {
    // Skip null values for most rules
    if (value === null && rule.type !== 'custom') {
        return { valid: true, message: '', severity: rule.severity };
    }

    switch (rule.type) {
        case 'range':
            if (rule.min !== undefined && value !== null && value < rule.min) {
                return { valid: false, message: rule.errorMessage, severity: rule.severity };
            }
            if (rule.max !== undefined && value !== null && value > rule.max) {
                return { valid: false, message: rule.errorMessage, severity: rule.severity };
            }
            return { valid: true, message: '', severity: rule.severity };

        case 'positive':
            if (value !== null && value <= 0) {
                return { valid: false, message: rule.errorMessage, severity: rule.severity };
            }
            return { valid: true, message: '', severity: rule.severity };

        case 'non-negative':
            if (value !== null && value < 0) {
                return { valid: false, message: rule.errorMessage, severity: rule.severity };
            }
            return { valid: true, message: '', severity: rule.severity };

        case 'sum-check':
            if (rule.sumColumns) {
                let sum = 0;
                for (const col of rule.sumColumns) {
                    const val = parseNumericValue(row[col]);
                    if (val !== null) {
                        sum += val;
                    }
                }
                if (rule.sumMin !== undefined && sum < rule.sumMin) {
                    return { valid: false, message: rule.errorMessage, severity: rule.severity };
                }
                if (rule.sumMax !== undefined && sum > rule.sumMax) {
                    return { valid: false, message: rule.errorMessage, severity: rule.severity };
                }
            }
            return { valid: true, message: '', severity: rule.severity };

        case 'custom':
            if (rule.customFn && value !== null) {
                const isValid = rule.customFn(value, row);
                return { valid: isValid, message: isValid ? '' : rule.errorMessage, severity: rule.severity };
            }
            return { valid: true, message: '', severity: rule.severity };

        default:
            return { valid: true, message: '', severity: rule.severity };
    }
}

// Pre-defined validation rules

export const VALIDATION_RULES = {
    positiveValue: {
        type: 'positive' as const,
        errorMessage: 'Value must be positive',
        severity: 'error' as const,
    },

    nonNegativeValue: {
        type: 'non-negative' as const,
        errorMessage: 'Value cannot be negative',
        severity: 'error' as const,
    },

    mgNumberRange: {
        type: 'range' as const,
        min: 0,
        max: 100,
        errorMessage: 'Mg# must be between 0 and 100',
        severity: 'error' as const,
    },

    percentRange: {
        type: 'range' as const,
        min: 0,
        max: 100,
        errorMessage: 'Percentage must be between 0 and 100',
        severity: 'error' as const,
    },

    ciaRange: {
        type: 'range' as const,
        min: 0,
        max: 100,
        errorMessage: 'CIA must be between 0 and 100',
        severity: 'error' as const,
    },

    ratioPositive: {
        type: 'positive' as const,
        errorMessage: 'Ratio must be positive',
        severity: 'warning' as const,
    },
};

/**
 * Check if major oxide sum is within acceptable range (95-105%)
 */
export function checkMajorOxideSum(row: Record<string, any>): { valid: boolean; sum: number; message?: string } {
    let sum = 0;

    for (const oxide of MAJOR_OXIDES) {
        // Try to find the column with various naming conventions
        const value = findOxideValue(row, oxide);
        if (value !== null) {
            sum += value;
        }
    }

    if (sum < 95) {
        return {
            valid: false,
            sum,
            message: `Major oxide sum (${sum.toFixed(2)}%) is below 95%. Data may be incomplete or in wrong units.`,
        };
    }

    if (sum > 105) {
        return {
            valid: false,
            sum,
            message: `Major oxide sum (${sum.toFixed(2)}%) exceeds 105%. Check for duplicate iron species or volatile loss.`,
        };
    }

    return { valid: true, sum };
}

/**
 * Find oxide value from row using various naming conventions
 */
function findOxideValue(row: Record<string, any>, oxide: string): number | null {
    // Try exact match first
    if (oxide in row) {
        return parseNumericValue(row[oxide]);
    }

    // Try common variations
    const variations = [
        oxide,
        oxide.toLowerCase(),
        oxide.toUpperCase(),
        `${oxide}_pct`,
        `${oxide}_wt`,
        `${oxide}_%`,
        `${oxide.toLowerCase()}_pct`,
    ];

    for (const variant of variations) {
        if (variant in row) {
            return parseNumericValue(row[variant]);
        }
    }

    // Try case-insensitive search
    const lowerOxide = oxide.toLowerCase();
    for (const key of Object.keys(row)) {
        if (key.toLowerCase() === lowerOxide || key.toLowerCase().startsWith(lowerOxide)) {
            return parseNumericValue(row[key]);
        }
    }

    return null;
}

/**
 * Validate that all required columns exist
 */
export function validateColumnPresence(
    columns: string[],
    requiredColumns: string[]
): { valid: boolean; missing: string[] } {
    const columnSet = new Set(columns.map(c => c.toLowerCase()));
    const missing: string[] = [];

    for (const required of requiredColumns) {
        if (!columnSet.has(required.toLowerCase())) {
            missing.push(required);
        }
    }

    return {
        valid: missing.length === 0,
        missing,
    };
}

/**
 * Check data quality metrics
 */
export function analyzeDataQuality(
    values: (number | null)[],
    columnName: string
): {
    total: number;
    valid: number;
    null_: number;
    negative: number;
    outliers: number;
    min: number | null;
    max: number | null;
    mean: number | null;
    stdDev: number | null;
} {
    const total = values.length;
    let valid = 0;
    let null_ = 0;
    let negative = 0;
    let sum = 0;
    let min: number | null = null;
    let max: number | null = null;
    const validValues: number[] = [];

    for (const val of values) {
        if (val === null) {
            null_++;
        } else {
            valid++;
            validValues.push(val);
            sum += val;
            if (val < 0) negative++;
            if (min === null || val < min) min = val;
            if (max === null || val > max) max = val;
        }
    }

    let mean: number | null = null;
    let stdDev: number | null = null;
    let outliers = 0;

    if (valid > 0) {
        mean = sum / valid;

        // Calculate standard deviation
        const squaredDiffs = validValues.map(v => Math.pow(v - mean!, 2));
        const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / valid;
        stdDev = Math.sqrt(avgSquaredDiff);

        // Count outliers (values > 3 standard deviations from mean)
        if (stdDev > 0) {
            const threshold = 3 * stdDev;
            outliers = validValues.filter(v => Math.abs(v - mean!) > threshold).length;
        }
    }

    return {
        total,
        valid,
        null_,
        negative,
        outliers,
        min,
        max,
        mean,
        stdDev,
    };
}

/**
 * Detect likely unit based on value ranges
 */
export function detectLikelyUnit(values: (number | null)[]): 'wt%' | 'ppm' | 'ppb' | 'unknown' {
    const validValues = values.filter((v): v is number => v !== null);
    if (validValues.length === 0) return 'unknown';

    const max = Math.max(...validValues);
    const mean = validValues.reduce((a, b) => a + b, 0) / validValues.length;

    // Heuristics based on typical ranges
    if (max <= 100 && mean <= 50) {
        return 'wt%';
    } else if (max <= 100000 && mean <= 10000) {
        return 'ppm';
    } else if (max > 100000) {
        return 'ppb';
    }

    return 'unknown';
}
