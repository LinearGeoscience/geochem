/**
 * Element Anomaly Classification Functions
 *
 * Generic anomaly classification that works with any element and any
 * reference standard. Uses strict multiples of background concentration.
 * Parallels pathfinderClassification.ts but is not restricted to the 16
 * Halley pathfinder elements.
 */

import type { AnomalyClass } from './pathfinderConstants';
import type { ReferenceStandardId } from './elementBackgroundConstants';
import { getBackgroundValue, generateAnomalyThresholds } from './elementBackgroundConstants';
import type { ColumnGeochemMapping } from '../../types/associations';

/**
 * Classify an element value into an anomaly class using a background value.
 * Uses strict multiples: <=1x = background, <=2x = '2x', <=3x = '3x', <=5x = '5x', >5x = '10x'.
 */
export function getElementAnomalyClass(
    value: number | null | undefined,
    backgroundValue: number
): AnomalyClass {
    if (value === null || value === undefined || isNaN(value)) {
        return 'nodata';
    }
    if (backgroundValue <= 0 || isNaN(backgroundValue)) {
        return 'nodata';
    }

    const thresholds = generateAnomalyThresholds(backgroundValue);

    if (value <= thresholds.background) return 'background';
    if (value <= thresholds.x2) return '2x';
    if (value <= thresholds.x3) return '3x';
    if (value <= thresholds.x5) return '5x';
    return '10x';
}

/**
 * Classify using a named reference standard, with optional custom override.
 */
export function classifyElementValue(
    value: number | null | undefined,
    elementOrOxide: string,
    standardId: ReferenceStandardId,
    customBackground?: number
): AnomalyClass {
    if (value === null || value === undefined || isNaN(value)) {
        return 'nodata';
    }

    let bgValue: number;
    if (standardId === 'custom' && customBackground !== undefined) {
        bgValue = customBackground;
    } else {
        const entry = getBackgroundValue(standardId, elementOrOxide);
        if (!entry) return 'nodata';
        bgValue = entry.value;
    }

    return getElementAnomalyClass(value, bgValue);
}

/**
 * Find a column in the dataset that matches the given element or oxide symbol.
 * Uses geochem mappings first, then falls back to pattern matching.
 */
export function findElementColumn(
    elementOrOxide: string,
    columns: string[],
    geochemMappings?: ColumnGeochemMapping[]
): string | null {
    const symbolLower = elementOrOxide.toLowerCase();

    // 1. Try geochem mappings first (most reliable)
    if (geochemMappings && geochemMappings.length > 0) {
        for (const mapping of geochemMappings) {
            const el = (mapping.userOverride || mapping.detectedElement || '').toLowerCase();
            // Match by element symbol
            if (el === symbolLower) {
                return mapping.originalName;
            }
            // Match by oxide formula
            if (mapping.oxideFormula?.toLowerCase() === symbolLower) {
                return mapping.originalName;
            }
        }
    }

    // 2. Direct column name match (exact, case-insensitive)
    for (const col of columns) {
        if (col.toLowerCase() === symbolLower) return col;
    }

    // 3. Pattern matching: element_ppm, element_pct, element_percent, etc.
    const suffixPatterns = [
        '', '_ppm', '_pct', '_percent', '_wt%', '_wt', ' ppm', ' pct', ' %'
    ];

    for (const col of columns) {
        const colLower = col.toLowerCase();
        for (const suffix of suffixPatterns) {
            if (colLower === symbolLower + suffix) return col;
        }
    }

    // 4. For oxides, also try without the 'T' suffix (Fe2O3T -> Fe2O3)
    if (symbolLower.endsWith('t') && symbolLower.length > 1) {
        const withoutT = symbolLower.slice(0, -1);
        for (const col of columns) {
            const colLower = col.toLowerCase();
            for (const suffix of suffixPatterns) {
                if (colLower === withoutT + suffix) return col;
            }
        }
    }

    return null;
}
