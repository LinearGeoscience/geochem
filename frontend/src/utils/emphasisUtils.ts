import { EmphasisConfig, AttributeEntry } from '../store/attributeStore';

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

function calculatePercentileRanks(values: (number | null)[], filterBounds?: FilterBounds): (number | null)[] {
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
function calculateLinearRanks(values: (number | null)[], filterBounds?: FilterBounds): (number | null)[] {
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
 * Calculate category-based ranks using existing attribute entries
 * Later categories (higher index, typically higher values) get higher ranks
 */
function calculateCategoryRanks(
    data: Record<string, any>[],
    entries: AttributeEntry[],
    field: string | null
): (number | null)[] {
    if (!field || entries.length <= 1) {
        return data.map(() => 0.5);
    }

    // Filter out default entries and get non-default entries in order
    const rangeEntries = entries.filter(e => !e.isDefault && e.type === 'range');
    const categoryEntries = entries.filter(e => !e.isDefault && e.type === 'category');

    const numEntries = rangeEntries.length || categoryEntries.length;
    if (numEntries === 0) {
        return data.map(() => 0.5);
    }

    return data.map(row => {
        const value = row[field];
        if (value == null) return null;

        // For range entries, find which range the value falls into
        if (rangeEntries.length > 0) {
            const numVal = Number(value);
            if (isNaN(numVal)) return null;

            for (let i = 0; i < rangeEntries.length; i++) {
                const entry = rangeEntries[i];
                const min = entry.min ?? -Infinity;
                const max = entry.max ?? Infinity;

                if (numVal >= min && numVal < max) {
                    // Return rank based on entry index (0 = lowest category, 1 = highest)
                    return i / Math.max(1, rangeEntries.length - 1);
                }
            }
            // Check if value is >= last range's max (belongs to highest category)
            const lastEntry = rangeEntries[rangeEntries.length - 1];
            if (numVal >= (lastEntry.max ?? -Infinity)) {
                return 1;
            }
            return 0;
        }

        // For category entries, find matching category
        if (categoryEntries.length > 0) {
            const strVal = String(value);
            const idx = categoryEntries.findIndex(e => e.categoryValue === strVal || e.name === strVal);
            if (idx >= 0) {
                return idx / Math.max(1, categoryEntries.length - 1);
            }
        }

        return 0.5; // Default middle rank
    });
}

/**
 * Calculate emphasis values for each data point
 *
 * @param data - Array of data rows
 * @param config - Emphasis configuration
 * @param colorEntries - Current color attribute entries (for category mode)
 * @param colorField - Current color field name
 * @returns Array of EmphasisResult for each data point
 */
export function calculateEmphasis(
    data: Record<string, any>[],
    config: EmphasisConfig,
    colorEntries: AttributeEntry[],
    colorField: string | null,
    filterBounds?: FilterBounds
): EmphasisResult[] {
    // If emphasis is disabled, return neutral values
    if (!config.enabled) {
        return data.map(() => ({
            opacity: 1,
            sizeMultiplier: 1,
            zIndex: 0
        }));
    }

    // Determine which column to use for emphasis
    const emphasisColumn = config.column || colorField;

    let rankings: (number | null)[];

    if (config.mode === 'category') {
        // Use existing color categories for ranking
        rankings = calculateCategoryRanks(data, colorEntries, colorField);
    } else {
        // Extract numeric values for the emphasis column
        const values = data.map(d => {
            if (!emphasisColumn) return null;
            const v = d[emphasisColumn];
            return v != null && !isNaN(Number(v)) ? Number(v) : null;
        });

        // Calculate rankings based on mode, passing filter bounds for scaling
        rankings = config.mode === 'percentile'
            ? calculatePercentileRanks(values, filterBounds)
            : calculateLinearRanks(values, filterBounds);
    }

    // Convert rankings to emphasis values
    const thresholdNorm = config.threshold / 100;

    return rankings.map((rank) => {
        // Null values get minimum emphasis
        if (rank === null) {
            return {
                opacity: config.minOpacity,
                sizeMultiplier: 1,
                zIndex: 0
            };
        }

        let emphasis: number;

        if (rank >= thresholdNorm) {
            // Above threshold = full emphasis
            emphasis = 1;
        } else {
            // Below threshold = scale from minOpacity up to 1
            // As rank approaches threshold, emphasis approaches 1
            emphasis = config.minOpacity + (1 - config.minOpacity) * (rank / thresholdNorm);
        }

        // Size boost only applies to values above threshold
        const sizeMultiplier = config.boostSize && rank >= thresholdNorm
            ? config.sizeBoostFactor
            : 1;

        return {
            opacity: emphasis,
            sizeMultiplier,
            zIndex: Math.round(rank * 1000) // Higher values render on top
        };
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
