import type { ColumnData } from '../types/columnarData';
import { isNumericColumn } from '../types/columnarData';


/**
 * Result of emphasis calculation for a single data point
 */
export interface EmphasisResult {
    opacity: number;        // 0.05 to 1.0
    sizeMultiplier: number; // 1.0 to sizeBoostFactor
    zIndex: number;         // For sorting - higher values = render last (on top)
}

/**
 * Filter bounds for value filter integration
 */
export interface FilterBounds {
    min: number | null;
    max: number | null;
}

/**
 * Calculate percentile ranks for an array of values
 * Returns values from 0 to 1 (0 = lowest, 1 = highest)
 * When filterBounds is provided, only values within the bounds are used for ranking
 */
/**
 * Binary search: find first index in sorted[] where sorted[i] >= target.
 * Returns sorted.length if no element qualifies.
 */
function binarySearchGE(sorted: number[], target: number): number {
    let lo = 0, hi = sorted.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (sorted[mid] < target) lo = mid + 1; else hi = mid;
    }
    return lo;
}

export function calculatePercentileRanks(values: (number | null)[], filterBounds?: FilterBounds): (number | null)[] {
    let validValues = values.filter((v): v is number => v !== null);
    if (validValues.length === 0) return values.map(() => null);

    // When filter bounds are active, exclude out-of-range values from the sorted reference
    if (filterBounds) {
        validValues = validValues.filter(v => {
            if (filterBounds.min !== null && v < filterBounds.min) return false;
            if (filterBounds.max !== null && v > filterBounds.max) return false;
            return true;
        });
        if (validValues.length === 0) return values.map(() => null);
    }

    const sorted = [...validValues].sort((a, b) => a - b);
    const denom = Math.max(1, sorted.length - 1);

    return values.map(v => {
        if (v === null) return null;
        // O(log n) binary search instead of O(n) findIndex
        let idx = binarySearchGE(sorted, v);
        if (idx >= sorted.length) idx = sorted.length - 1;
        return idx / denom;
    });
}

/**
 * Calculate linear ranks for an array of values
 * Returns values from 0 to 1 based on min/max
 * When filterBounds is provided, uses those bounds instead of data min/max
 */
export function calculateLinearRanks(values: (number | null)[], filterBounds?: FilterBounds): (number | null)[] {
    const validValues = values.filter((v): v is number => v !== null);
    if (validValues.length === 0) return values.map(() => null);

    // Use loop instead of Math.min/max(...) to avoid stack overflow on large arrays
    let dataMin = Infinity, dataMax = -Infinity;
    for (const v of validValues) { if (v < dataMin) dataMin = v; if (v > dataMax) dataMax = v; }

    const min = filterBounds?.min ?? dataMin;
    const max = filterBounds?.max ?? dataMax;
    const range = max - min;

    if (range === 0) {
        return values.map(v => v === null ? null : 0.5);
    }

    return values.map(v => {
        if (v === null) return null;
        // Clamp to 0-1 range (values outside filter bounds get clamped)
        return Math.max(0, Math.min(1, (v - min) / range));
    });
}

/**
 * Convert hex color to rgba with opacity
 */
export function applyOpacityToColor(hexColor: string, opacity: number): string {
    // Handle various color formats
    if (hexColor.startsWith('rgba')) {
        // Already rgba - replace opacity
        return hexColor.replace(/[\d.]+\)$/, `${opacity})`);
    }

    if (hexColor.startsWith('rgb(')) {
        // rgb to rgba
        return hexColor.replace('rgb(', 'rgba(').replace(')', `, ${opacity})`);
    }

    if (hexColor.startsWith('#')) {
        // Hex to rgba
        let hex = hexColor.slice(1);
        if (hex.length === 3) {
            hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        }
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return `rgba(${r},${g},${b},${opacity})`;
    }

    // Unknown format - return as-is
    return hexColor;
}

/**
 * Sort indices by z-index (low to high) so high-grade points render on top
 */
export function sortByEmphasis(
    indices: number[],
    emphasisResults: EmphasisResult[]
): number[] {
    return [...indices].sort((a, b) => {
        const zA = emphasisResults[a]?.zIndex ?? 0;
        const zB = emphasisResults[b]?.zIndex ?? 0;
        return zA - zB;
    });
}

/**
 * Get the data range for a numeric field
 */
export function getFieldRange(data: any[], field: string): { min: number; max: number } | null {
    let min = Infinity, max = -Infinity;
    let hasValue = false;

    for (const d of data) {
        const v = d[field];
        if (typeof v === 'number' && !isNaN(v) && isFinite(v)) {
            if (v < min) min = v;
            if (v > max) max = v;
            hasValue = true;
        }
    }

    return hasValue ? { min, max } : null;
}

/**
 * Columnar version of getFieldRange — reads directly from a Float64Array.
 */
export function getFieldRangeColumnar(col: ColumnData | undefined): { min: number; max: number } | null {
    if (!col || !isNumericColumn(col)) return null;
    let min = Infinity, max = -Infinity;
    let hasValue = false;

    for (let i = 0; i < col.length; i++) {
        const v = col[i];
        if (!isNaN(v) && isFinite(v)) {
            if (v < min) min = v;
            if (v > max) max = v;
            hasValue = true;
        }
    }

    return hasValue ? { min, max } : null;
}
