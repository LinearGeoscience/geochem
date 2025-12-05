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
 * Calculate percentile ranks for an array of values
 * Returns values from 0 to 1 (0 = lowest, 1 = highest)
 */
function calculatePercentileRanks(values: (number | null)[]): (number | null)[] {
    const validValues = values.filter((v): v is number => v !== null);
    if (validValues.length === 0) return values.map(() => null);

    const sorted = [...validValues].sort((a, b) => a - b);

    return values.map(v => {
        if (v === null) return null;
        // Find position in sorted array
        let idx = sorted.findIndex(sv => sv >= v);
        if (idx === -1) idx = sorted.length - 1;
        return idx / Math.max(1, sorted.length - 1);
    });
}

/**
 * Calculate linear ranks for an array of values
 * Returns values from 0 to 1 based on min/max
 */
function calculateLinearRanks(values: (number | null)[]): (number | null)[] {
    const validValues = values.filter((v): v is number => v !== null);
    if (validValues.length === 0) return values.map(() => null);

    const min = Math.min(...validValues);
    const max = Math.max(...validValues);
    const range = max - min;

    if (range === 0) {
        // All values are the same
        return values.map(v => v === null ? null : 0.5);
    }

    return values.map(v => {
        if (v === null) return null;
        return (v - min) / range;
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
    colorField: string | null
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

        // Calculate rankings based on mode
        rankings = config.mode === 'percentile'
            ? calculatePercentileRanks(values)
            : calculateLinearRanks(values);
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
    const values = data
        .map(d => d[field])
        .filter((v): v is number => typeof v === 'number' && !isNaN(v) && isFinite(v));

    if (values.length === 0) {
        return null;
    }

    return {
        min: Math.min(...values),
        max: Math.max(...values)
    };
}
