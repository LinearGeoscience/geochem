/**
 * Tooltip Utilities for Plot Hover Information
 * Builds rich, informative hover content showing axis values and styling attributes
 */

import { useAttributeStore, AttributeEntry } from '../store/attributeStore';

// Axis configuration for different plot types
export interface AxisConfig {
    x?: string;
    y?: string;
    z?: string;
    a?: string;  // Ternary
    b?: string;  // Ternary
    c?: string;  // Ternary
}

// Customdata structure for Plotly traces
export interface PointCustomData {
    idx: number;
    colorField: string | null;
    colorValue: any;
    colorCategory: string | null;
    shapeField: string | null;
    shapeValue: any;
    shapeCategory: string | null;
    sizeField: string | null;
    sizeValue: any;
    sizeCategory: string | null;
}

/**
 * Find which entry matches a value for a given config
 */
function findMatchingEntryName(
    value: any,
    entries: AttributeEntry[],
    customEntries: AttributeEntry[],
    dataIndex: number
): string | null {
    // First check custom entries that have this index assigned
    for (const entry of customEntries) {
        if (entry.assignedIndices.includes(dataIndex) && entry.visible) {
            return entry.name;
        }
    }

    // Then check field-based entries
    for (const entry of entries) {
        if (entry.isDefault) continue;

        if (entry.type === 'range' && entry.min !== undefined && entry.max !== undefined) {
            const numValue = typeof value === 'number' ? value : parseFloat(value);
            if (!isNaN(numValue) && numValue >= entry.min && numValue <= entry.max) {
                return entry.name;
            }
        } else if (entry.type === 'category' && entry.categoryValue !== undefined) {
            if (String(value) === entry.categoryValue) {
                return entry.name;
            }
        }
    }

    // Return default entry name if exists
    const defaultEntry = entries.find(e => e.isDefault);
    return defaultEntry?.name || null;
}

/**
 * Get the entry/category name for a data point in a specific attribute tab
 */
export function getEntryNameForPoint(
    dataPoint: Record<string, any>,
    dataIndex: number,
    tab: 'color' | 'shape' | 'size'
): string | null {
    const state = useAttributeStore.getState();
    const config = state[tab];
    const { customEntries } = state;

    if (!config.field) {
        // Check if any custom entry claims this point
        const customMatch = customEntries.find(e => e.assignedIndices.includes(dataIndex));
        return customMatch?.name || null;
    }

    const value = dataPoint[config.field];
    return findMatchingEntryName(value, config.entries, customEntries, dataIndex);
}

/**
 * Build customdata array for all points in sorted order
 * This data is passed to Plotly and accessed in hovertemplate
 */
export function buildCustomData(
    data: Record<string, any>[],
    sortedIndices: number[]
): PointCustomData[] {
    const state = useAttributeStore.getState();
    const { color, shape, size } = state;

    return sortedIndices.map(idx => {
        const dataPoint = data[idx];

        return {
            idx,
            colorField: color.field,
            colorValue: color.field ? dataPoint[color.field] : null,
            colorCategory: getEntryNameForPoint(dataPoint, idx, 'color'),
            shapeField: shape.field,
            shapeValue: shape.field ? dataPoint[shape.field] : null,
            shapeCategory: getEntryNameForPoint(dataPoint, idx, 'shape'),
            sizeField: size.field,
            sizeValue: size.field ? dataPoint[size.field] : null,
            sizeCategory: getEntryNameForPoint(dataPoint, idx, 'size'),
        };
    });
}

/**
 * Build a Plotly hovertemplate for scatter-type plots (X/Y)
 */
export function buildScatterHoverTemplate(xAxis: string, yAxis: string): string {
    const state = useAttributeStore.getState();
    const { color, shape, size } = state;

    let template = `<b>Sample %{customdata.idx}</b><br>`;
    template += `<br>`;
    template += `<b>${xAxis}:</b> %{x:.4g}<br>`;
    template += `<b>${yAxis}:</b> %{y:.4g}`;

    // Add styling info if fields are set
    const hasStyle = color.field || shape.field || size.field;
    if (hasStyle) {
        template += `<br><br>`;
        if (color.field) {
            template += `<b>Color (${color.field}):</b> %{customdata.colorCategory}<br>`;
        }
        if (shape.field) {
            template += `<b>Shape (${shape.field}):</b> %{customdata.shapeCategory}<br>`;
        }
        if (size.field) {
            template += `<b>Size (${size.field}):</b> %{customdata.sizeCategory}<br>`;
        }
    }

    template += `<extra></extra>`;
    return template;
}

/**
 * Build a Plotly hovertemplate for ternary plots (A/B/C)
 */
export function buildTernaryHoverTemplate(aAxis: string, bAxis: string, cAxis: string): string {
    const state = useAttributeStore.getState();
    const { color, shape, size } = state;

    let template = `<b>Sample %{customdata.idx}</b><br>`;
    template += `<br>`;
    template += `<b>${aAxis}:</b> %{a:.2%}<br>`;
    template += `<b>${bAxis}:</b> %{b:.2%}<br>`;
    template += `<b>${cAxis}:</b> %{c:.2%}`;

    const hasStyle = color.field || shape.field || size.field;
    if (hasStyle) {
        template += `<br><br>`;
        if (color.field) {
            template += `<b>Color (${color.field}):</b> %{customdata.colorCategory}<br>`;
        }
        if (shape.field) {
            template += `<b>Shape (${shape.field}):</b> %{customdata.shapeCategory}<br>`;
        }
        if (size.field) {
            template += `<b>Size (${size.field}):</b> %{customdata.sizeCategory}<br>`;
        }
    }

    template += `<extra></extra>`;
    return template;
}

/**
 * Build a Plotly hovertemplate for 3D scatter plots (X/Y/Z)
 */
export function build3DHoverTemplate(xAxis: string, yAxis: string, zAxis: string): string {
    const state = useAttributeStore.getState();
    const { color, shape, size } = state;

    let template = `<b>Sample %{customdata.idx}</b><br>`;
    template += `<br>`;
    template += `<b>${xAxis}:</b> %{x:.4g}<br>`;
    template += `<b>${yAxis}:</b> %{y:.4g}<br>`;
    template += `<b>${zAxis}:</b> %{z:.4g}`;

    const hasStyle = color.field || shape.field || size.field;
    if (hasStyle) {
        template += `<br><br>`;
        if (color.field) {
            template += `<b>Color (${color.field}):</b> %{customdata.colorCategory}<br>`;
        }
        if (shape.field) {
            template += `<b>Shape (${shape.field}):</b> %{customdata.shapeCategory}<br>`;
        }
        if (size.field) {
            template += `<b>Size (${size.field}):</b> %{customdata.sizeCategory}<br>`;
        }
    }

    template += `<extra></extra>`;
    return template;
}

/**
 * Build a Plotly hovertemplate for map plots (coordinates)
 */
export function buildMapHoverTemplate(xAxis: string, yAxis: string): string {
    const state = useAttributeStore.getState();
    const { color, shape, size } = state;

    let template = `<b>Sample %{customdata.idx}</b><br>`;
    template += `<br>`;
    template += `<b>${xAxis}:</b> %{x:.2f}<br>`;
    template += `<b>${yAxis}:</b> %{y:.2f}`;

    const hasStyle = color.field || shape.field || size.field;
    if (hasStyle) {
        template += `<br><br>`;
        if (color.field) {
            template += `<b>Color (${color.field}):</b> %{customdata.colorCategory}<br>`;
        }
        if (shape.field) {
            template += `<b>Shape (${shape.field}):</b> %{customdata.shapeCategory}<br>`;
        }
        if (size.field) {
            template += `<b>Size (${size.field}):</b> %{customdata.sizeCategory}<br>`;
        }
    }

    template += `<extra></extra>`;
    return template;
}

/**
 * Build hover text array for spider plots (simpler format)
 */
export function buildSpiderHoverText(
    data: Record<string, any>[],
    dataIndex: number
): string {
    const state = useAttributeStore.getState();
    const { color, shape, size } = state;
    const dataPoint = data[dataIndex];

    let text = `Sample ${dataIndex}`;

    if (color.field) {
        const category = getEntryNameForPoint(dataPoint, dataIndex, 'color');
        text += `\nColor (${color.field}): ${category || 'N/A'}`;
    }
    if (shape.field) {
        const category = getEntryNameForPoint(dataPoint, dataIndex, 'shape');
        text += `\nShape (${shape.field}): ${category || 'N/A'}`;
    }
    if (size.field) {
        const category = getEntryNameForPoint(dataPoint, dataIndex, 'size');
        text += `\nSize (${size.field}): ${category || 'N/A'}`;
    }

    return text;
}
