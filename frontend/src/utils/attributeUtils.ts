/**
 * Utility functions for plots to get styling from the attributeStore
 */
import { useAttributeStore, AttributeEntry } from '../store/attributeStore';
import { calculateEmphasis, sortByEmphasis } from './emphasisUtils';
import type { EmphasisResult } from './emphasisUtils';

export interface PointStyle {
    color: string;
    shape: string;
    size: number;
    visible: boolean;
}

export interface StyleArrays {
    colors: string[];
    shapes: string[];
    sizes: number[];
    visible: boolean[];
    // Emphasis data
    opacity: number[];
    zIndices: number[];
    emphasisResults: EmphasisResult[];
}

// Default style values
const DEFAULT_COLOR = '#808080';
const DEFAULT_SHAPE = 'circle';
const DEFAULT_SIZE = 10; // Increased from 8 for better visibility in exports

/**
 * Find which entry matches a data point based on its value and the config
 */
function findMatchingEntry(
    value: any,
    entries: AttributeEntry[],
    customEntries: AttributeEntry[],
    dataIndex: number
): AttributeEntry | null {
    // First check custom entries that have this index assigned
    for (const entry of customEntries) {
        if (entry.assignedIndices.includes(dataIndex) && entry.visible) {
            return entry;
        }
    }

    // Then check field-based entries
    for (const entry of entries) {
        if (entry.isDefault) continue;

        if (entry.type === 'range' && entry.min !== undefined && entry.max !== undefined) {
            const numValue = typeof value === 'number' ? value : parseFloat(value);
            if (!isNaN(numValue) && numValue >= entry.min && numValue <= entry.max) {
                return entry;
            }
        } else if (entry.type === 'category' && entry.categoryValue !== undefined) {
            if (String(value) === entry.categoryValue) {
                return entry;
            }
        }
    }

    // Return default entry
    return entries.find(e => e.isDefault) || null;
}

/**
 * Get the style for a single data point
 */
export function getPointStyle(
    dataPoint: Record<string, any>,
    dataIndex: number,
    colorField: string | null,
    shapeField: string | null,
    sizeField: string | null
): PointStyle {
    const state = useAttributeStore.getState();
    const { color, shape, size, customEntries } = state;

    let pointColor = DEFAULT_COLOR;
    let pointShape = DEFAULT_SHAPE;
    let pointSize = DEFAULT_SIZE;
    let pointVisible = true;

    // Get color
    if (colorField) {
        const value = dataPoint[colorField];
        const entry = findMatchingEntry(value, color.entries, customEntries, dataIndex);
        if (entry) {
            pointColor = entry.color || DEFAULT_COLOR;
            if (!entry.visible) pointVisible = false;
        }
    } else {
        // Check if any custom entry claims this point
        const customMatch = customEntries.find(e => e.assignedIndices.includes(dataIndex));
        if (customMatch) {
            pointColor = customMatch.color || DEFAULT_COLOR;
            if (!customMatch.visible) pointVisible = false;
        }
    }

    // Get shape
    if (shapeField) {
        const value = dataPoint[shapeField];
        const entry = findMatchingEntry(value, shape.entries, customEntries, dataIndex);
        if (entry) {
            pointShape = entry.shape || DEFAULT_SHAPE;
            if (!entry.visible) pointVisible = false;
        }
    } else {
        const customMatch = customEntries.find(e => e.assignedIndices.includes(dataIndex));
        if (customMatch) {
            pointShape = customMatch.shape || DEFAULT_SHAPE;
        }
    }

    // Get size
    if (sizeField) {
        const value = dataPoint[sizeField];
        const entry = findMatchingEntry(value, size.entries, customEntries, dataIndex);
        if (entry) {
            pointSize = entry.size || DEFAULT_SIZE;
            if (!entry.visible) pointVisible = false;
        }
    } else {
        const customMatch = customEntries.find(e => e.assignedIndices.includes(dataIndex));
        if (customMatch) {
            pointSize = customMatch.size || DEFAULT_SIZE;
        }
    }

    return {
        color: pointColor,
        shape: pointShape,
        size: pointSize,
        visible: pointVisible,
    };
}

/**
 * Get styles for all data points (optimized for batch operations)
 * Returns arrays of colors, shapes, sizes, and visibility flags
 */
export function getStyleArrays(data: Record<string, any>[]): StyleArrays {
    const state = useAttributeStore.getState();
    const { color, shape, size, filter, customEntries } = state;

    const colors: string[] = [];
    const shapes: string[] = [];
    const sizes: number[] = [];
    const visible: boolean[] = [];

    for (let i = 0; i < data.length; i++) {
        const dataPoint = data[i];
        let pointColor = DEFAULT_COLOR;
        let pointShape = DEFAULT_SHAPE;
        let pointSize = DEFAULT_SIZE;
        let pointVisible = true;

        // Check custom entries first
        const customMatch = customEntries.find(e => e.assignedIndices.includes(i));

        // Get color
        if (color.field) {
            const value = dataPoint[color.field];
            const entry = findMatchingEntry(value, color.entries, customEntries, i);
            if (entry) {
                pointColor = entry.color || DEFAULT_COLOR;
                // Hide if entry is not visible (including default entry)
                if (!entry.visible) {
                    pointVisible = false;
                }
            }
        } else if (customMatch) {
            pointColor = customMatch.color || DEFAULT_COLOR;
            if (!customMatch.visible) {
                pointVisible = false;
            }
        }

        // Get shape
        if (shape.field) {
            const value = dataPoint[shape.field];
            const entry = findMatchingEntry(value, shape.entries, customEntries, i);
            if (entry) {
                pointShape = entry.shape || DEFAULT_SHAPE;
                // Hide if entry is not visible (including default entry)
                if (!entry.visible) {
                    pointVisible = false;
                }
            }
        } else if (customMatch) {
            pointShape = customMatch.shape || DEFAULT_SHAPE;
        }

        // Get size
        if (size.field) {
            const value = dataPoint[size.field];
            const entry = findMatchingEntry(value, size.entries, customEntries, i);
            if (entry) {
                pointSize = entry.size || DEFAULT_SIZE;
                // Hide if entry is not visible (including default entry)
                if (!entry.visible) {
                    pointVisible = false;
                }
            }
        } else if (customMatch) {
            pointSize = customMatch.size || DEFAULT_SIZE;
        }

        // Check filter
        if (filter.field && pointVisible) {
            const value = dataPoint[filter.field];
            const entry = findMatchingEntry(value, filter.entries, customEntries, i);
            // Hide if entry is not visible (including default entry)
            if (entry && !entry.visible) {
                pointVisible = false;
            }
        }

        colors.push(pointColor);
        shapes.push(pointShape);
        sizes.push(pointSize);
        visible.push(pointVisible);
    }

    // Calculate emphasis
    const emphasisResults = calculateEmphasis(
        data,
        state.emphasis,
        color.entries,
        color.field
    );

    // Apply emphasis to sizes and extract opacity/zIndex arrays
    const opacity: number[] = [];
    const zIndices: number[] = [];
    const finalSizes: number[] = [];

    for (let i = 0; i < data.length; i++) {
        const emphResult = emphasisResults[i];
        opacity.push(emphResult.opacity);
        zIndices.push(emphResult.zIndex);
        finalSizes.push(sizes[i] * emphResult.sizeMultiplier);
    }

    return { colors, shapes, sizes: finalSizes, visible, opacity, zIndices, emphasisResults };
}

/**
 * Convert our shape names to Plotly symbol names
 */
export function shapeToPlotlySymbol(shape: string): string {
    const mapping: Record<string, string> = {
        'circle': 'circle',
        'square': 'square',
        'diamond': 'diamond',
        'cross': 'cross',
        'x': 'x',
        'triangle-up': 'triangle-up',
        'triangle-down': 'triangle-down',
        'triangle-left': 'triangle-left',
        'triangle-right': 'triangle-right',
        'pentagon': 'pentagon',
        'hexagon': 'hexagon',
        'star': 'star',
        'hourglass': 'hourglass',
    };
    return mapping[shape] || 'circle';
}

/**
 * Get unique visible entries with their colors for creating a legend
 */
export function getLegendEntries(tab: 'color' | 'shape' | 'size' | 'filter'): AttributeEntry[] {
    const state = useAttributeStore.getState();
    const config = state[tab];
    const { customEntries } = state;

    // Combine custom entries with field-based entries
    const allEntries = [
        ...customEntries.filter(e => e.visible),
        ...config.entries.filter(e => !e.isDefault && e.visible),
    ];

    return allEntries;
}

/**
 * Hook to subscribe to attribute store changes
 * Returns current config and entries for the active tab
 */
export function useAttributeStyles() {
    const {
        color,
        shape,
        size,
        filter,
        customEntries,
        emphasis,
    } = useAttributeStore();

    return {
        colorField: color.field,
        shapeField: shape.field,
        sizeField: size.field,
        filterField: filter.field,
        colorEntries: color.entries,
        shapeEntries: shape.entries,
        sizeEntries: size.entries,
        filterEntries: filter.entries,
        customEntries,
        emphasisEnabled: emphasis.enabled,
    };
}

// Re-export emphasis utilities for convenience
export { applyOpacityToColor, sortByEmphasis } from './emphasisUtils';
export type { EmphasisResult } from './emphasisUtils';

/**
 * Get sorted indices for rendering data points with emphasis z-ordering
 * Points with higher zIndex values should be rendered last (on top)
 */
export function getSortedIndices(styleArrays: StyleArrays): number[] {
    const indices = Array.from({ length: styleArrays.visible.length }, (_, i) => i)
        .filter(i => styleArrays.visible[i]);

    return sortByEmphasis(indices, styleArrays.emphasisResults);
}

/**
 * Sort columns by priority (lower number = higher priority)
 * Columns without priority get a default priority of 10
 */
export function sortColumnsByPriority<T extends { name: string; priority?: number }>(columns: T[]): T[] {
    return [...columns].sort((a, b) => {
        const prioA = a.priority ?? 10;
        const prioB = b.priority ?? 10;
        if (prioA !== prioB) return prioA - prioB;
        // Secondary sort by name
        return a.name.localeCompare(b.name);
    });
}
