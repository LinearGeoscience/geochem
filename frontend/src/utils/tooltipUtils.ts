/**
 * Tooltip Utilities for Plot Hover Information
 * Builds rich, informative hover content showing real sample IDs,
 * spatial/drillhole context, axis values, and styling attributes.
 */

import { useAttributeStore, AttributeEntry } from '../store/attributeStore';
import { useAppStore } from '../store/appStore';

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
    // Identity
    sampleId: string;
    // Spatial context
    easting: number | null;
    northing: number | null;
    elevation: number | null;
    // Drillhole context
    holeId: string | null;
    depthFrom: number | null;
    depthTo: number | null;
    // Attribute categories
    colorField: string | null;
    colorValue: any;
    colorCategory: string | null;
    colorRawDisplay: string;
    shapeField: string | null;
    shapeValue: any;
    shapeCategory: string | null;
    shapeRawDisplay: string;
    sizeField: string | null;
    sizeValue: any;
    sizeCategory: string | null;
    sizeRawDisplay: string;
    // Paint group
    paintGroup: string;
}

// Role name mapping for case-insensitive lookups
const ROLE_MAP: Record<string, string[]> = {
    ID: ['ID', 'id', 'Id'],
    East: ['East', 'east', 'easting', 'Easting', 'EASTING'],
    North: ['North', 'north', 'northing', 'Northing', 'NORTHING'],
    Elevation: ['Elevation', 'elevation', 'ELEVATION', 'RL', 'rl'],
    HoleID: ['HoleID', 'holeid', 'HoleId', 'HOLEID', 'hole_id'],
    From: ['From', 'from', 'FROM', 'DepthFrom', 'depth_from'],
    To: ['To', 'to', 'TO', 'DepthTo', 'depth_to'],
    Depth: ['Depth', 'depth', 'DEPTH'],
};

/**
 * Find a column by its role (case-insensitive match)
 */
function findColumnByRole(columns: { name: string; role: string | null }[], targetRole: string): string | null {
    const variants = ROLE_MAP[targetRole];
    if (!variants) return null;
    for (const col of columns) {
        if (col.role && variants.some(v => col.role === v)) {
            return col.name;
        }
    }
    return null;
}

/**
 * Format a raw value for display in tooltip (e.g., "Cu_ppm = 5.3")
 */
function formatRawValueDisplay(field: string | null, value: any): string {
    if (!field || value == null || value === '') return '';
    if (typeof value === 'number') {
        if (Number.isInteger(value)) return `${field} = ${value}`;
        return `${field} = ${value.toPrecision(4)}`;
    }
    return `${field} = ${value}`;
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
    sortedIndices: number[],
    originalIndices?: number[]  // maps display position -> original data index
): PointCustomData[] {
    const attrState = useAttributeStore.getState();
    const { color, shape, size, customEntries } = attrState;
    const { columns } = useAppStore.getState();

    // Find role columns once
    const idCol = findColumnByRole(columns, 'ID');
    const eastCol = findColumnByRole(columns, 'East');
    const northCol = findColumnByRole(columns, 'North');
    const elevCol = findColumnByRole(columns, 'Elevation');
    const holeIdCol = findColumnByRole(columns, 'HoleID');
    const fromCol = findColumnByRole(columns, 'From');
    const toCol = findColumnByRole(columns, 'To');

    // Pre-build paint group lookup Map for O(1) access
    const paintGroupMap = new Map<number, string>();
    for (const entry of customEntries) {
        for (const idx of entry.assignedIndices) {
            paintGroupMap.set(idx, entry.name);
        }
    }

    return sortedIndices.map(sortedIdx => {
        const dataPoint = data[sortedIdx];
        const dataIndex = originalIndices ? originalIndices[sortedIdx] : sortedIdx;

        const colorVal = color.field ? dataPoint[color.field] : null;
        const shapeVal = shape.field ? dataPoint[shape.field] : null;
        const sizeVal = size.field ? dataPoint[size.field] : null;

        return {
            idx: dataIndex,
            // Identity
            sampleId: idCol ? String(dataPoint[idCol] ?? dataIndex) : String(dataIndex),
            // Spatial
            easting: eastCol ? (dataPoint[eastCol] ?? null) : null,
            northing: northCol ? (dataPoint[northCol] ?? null) : null,
            elevation: elevCol ? (dataPoint[elevCol] ?? null) : null,
            // Drillhole
            holeId: holeIdCol ? (dataPoint[holeIdCol] ?? null) : null,
            depthFrom: fromCol ? (dataPoint[fromCol] ?? null) : null,
            depthTo: toCol ? (dataPoint[toCol] ?? null) : null,
            // Attributes
            colorField: color.field,
            colorValue: colorVal,
            colorCategory: getEntryNameForPoint(dataPoint, dataIndex, 'color'),
            colorRawDisplay: formatRawValueDisplay(color.field, colorVal),
            shapeField: shape.field,
            shapeValue: shapeVal,
            shapeCategory: getEntryNameForPoint(dataPoint, dataIndex, 'shape'),
            shapeRawDisplay: formatRawValueDisplay(shape.field, shapeVal),
            sizeField: size.field,
            sizeValue: sizeVal,
            sizeCategory: getEntryNameForPoint(dataPoint, dataIndex, 'size'),
            sizeRawDisplay: formatRawValueDisplay(size.field, sizeVal),
            // Paint group
            paintGroup: paintGroupMap.get(dataIndex) || '',
        };
    });
}

// ============================================================================
// Helpers for dataset-level feature detection (static per render)
// ============================================================================

interface DatasetFeatures {
    hasId: boolean;
    hasDrillhole: boolean;
    hasCoords: boolean;
    hasElevation: boolean;
    hasColor: boolean;
    hasShape: boolean;
    hasSize: boolean;
    hasPaintGroups: boolean;
}

function getDatasetFeatures(): DatasetFeatures {
    const { columns } = useAppStore.getState();
    const { color, shape, size, customEntries } = useAttributeStore.getState();
    return {
        hasId: !!findColumnByRole(columns, 'ID'),
        hasDrillhole: !!findColumnByRole(columns, 'HoleID'),
        hasCoords: !!findColumnByRole(columns, 'East') && !!findColumnByRole(columns, 'North'),
        hasElevation: !!findColumnByRole(columns, 'Elevation'),
        hasColor: !!color.field,
        hasShape: !!shape.field,
        hasSize: !!size.field,
        hasPaintGroups: customEntries.length > 0,
    };
}

// ============================================================================
// Context block builder (drillhole interval, coordinates, attributes)
// ============================================================================

/**
 * Build the context lines that appear after the sample ID header.
 * @param mode  'compact' | 'detailed'
 * @param suppressCoords  true for map plots where coords are already axis values
 * @param features  dataset feature flags
 */
function buildContextBlock(
    mode: 'compact' | 'detailed',
    suppressCoords: boolean,
    features: DatasetFeatures,
): string {
    let block = '';

    if (mode === 'detailed') {
        // Drillhole interval
        if (features.hasDrillhole) {
            block += `%{customdata.holeId}: %{customdata.depthFrom} - %{customdata.depthTo}m<br>`;
        }
        // Coordinates (unless suppressed for map plots)
        if (features.hasCoords && !suppressCoords) {
            let coordLine = `%{customdata.easting:.0f}E, %{customdata.northing:.0f}N`;
            if (features.hasElevation) {
                coordLine += `, %{customdata.elevation:.0f}m RL`;
            }
            block += coordLine + `<br>`;
        }
    }

    return block;
}

/**
 * Build the attribute styling section of the tooltip.
 * @param mode  'compact' | 'detailed'
 * @param features  dataset feature flags
 */
function buildAttributeBlock(
    mode: 'compact' | 'detailed',
    features: DatasetFeatures,
): string {
    const { color, shape } = useAttributeStore.getState();
    let block = '';
    const hasStyle = features.hasColor || features.hasShape || features.hasSize;

    if (!hasStyle && !features.hasPaintGroups) return '';

    block += `<br>`;

    if (mode === 'compact') {
        // Compact: category with inline raw value
        if (features.hasColor) {
            block += `<b>Color:</b> %{customdata.colorCategory} (%{customdata.colorRawDisplay})<br>`;
        }
        if (features.hasShape) {
            block += `<b>Shape:</b> %{customdata.shapeCategory} (%{customdata.shapeRawDisplay})<br>`;
        }
        if (features.hasSize) {
            block += `<b>Size:</b> %{customdata.sizeCategory} (%{customdata.sizeRawDisplay})<br>`;
        }
    } else {
        // Detailed: category on one line, raw value on next
        if (features.hasColor) {
            block += `<b>Color (${color.field}):</b> %{customdata.colorCategory}<br>`;
            block += `  Raw: %{customdata.colorRawDisplay}<br>`;
        }
        if (features.hasShape) {
            block += `<b>Shape (${shape.field}):</b> %{customdata.shapeCategory}<br>`;
            block += `  Raw: %{customdata.shapeRawDisplay}<br>`;
        }
        if (features.hasSize) {
            const sizeField = useAttributeStore.getState().size.field;
            block += `<b>Size (${sizeField}):</b> %{customdata.sizeCategory}<br>`;
            block += `  Raw: %{customdata.sizeRawDisplay}<br>`;
        }
        // Paint group (detailed only)
        if (features.hasPaintGroups) {
            block += `<b>Group:</b> %{customdata.paintGroup}<br>`;
        }
    }

    return block;
}

// ============================================================================
// Template Builders
// ============================================================================

/**
 * Build a Plotly hovertemplate for scatter-type plots (X/Y)
 */
export function buildScatterHoverTemplate(xAxis: string, yAxis: string): string {
    const mode = useAppStore.getState().tooltipMode;
    const features = getDatasetFeatures();

    let template = `<b>%{customdata.sampleId}</b><br>`;
    template += buildContextBlock(mode, false, features);
    template += `<br>`;
    template += `<b>${xAxis}:</b> %{x:.4g}<br>`;
    template += `<b>${yAxis}:</b> %{y:.4g}`;
    template += buildAttributeBlock(mode, features);
    template += `<extra></extra>`;
    return template;
}

/**
 * Build a Plotly hovertemplate for ternary plots (A/B/C)
 */
export function buildTernaryHoverTemplate(aAxis: string, bAxis: string, cAxis: string): string {
    const mode = useAppStore.getState().tooltipMode;
    const features = getDatasetFeatures();

    let template = `<b>%{customdata.sampleId}</b><br>`;
    template += buildContextBlock(mode, false, features);
    template += `<br>`;
    template += `<b>${aAxis}:</b> %{a:.2%}<br>`;
    template += `<b>${bAxis}:</b> %{b:.2%}<br>`;
    template += `<b>${cAxis}:</b> %{c:.2%}`;
    template += buildAttributeBlock(mode, features);
    template += `<extra></extra>`;
    return template;
}

/**
 * Build a Plotly hovertemplate for 3D scatter plots (X/Y/Z)
 */
export function build3DHoverTemplate(xAxis: string, yAxis: string, zAxis: string): string {
    const mode = useAppStore.getState().tooltipMode;
    const features = getDatasetFeatures();

    let template = `<b>%{customdata.sampleId}</b><br>`;
    template += buildContextBlock(mode, false, features);
    template += `<br>`;
    template += `<b>${xAxis}:</b> %{x:.4g}<br>`;
    template += `<b>${yAxis}:</b> %{y:.4g}<br>`;
    template += `<b>${zAxis}:</b> %{z:.4g}`;
    template += buildAttributeBlock(mode, features);
    template += `<extra></extra>`;
    return template;
}

/**
 * Build a Plotly hovertemplate for map plots (coordinates)
 * Suppresses coords in context block since they're already shown as axis values
 */
export function buildMapHoverTemplate(xAxis: string, yAxis: string): string {
    const mode = useAppStore.getState().tooltipMode;
    const features = getDatasetFeatures();

    let template = `<b>%{customdata.sampleId}</b><br>`;
    template += buildContextBlock(mode, true, features);  // suppress coords
    template += `<br>`;
    template += `<b>${xAxis}:</b> %{x:.2f}<br>`;
    template += `<b>${yAxis}:</b> %{y:.2f}`;
    template += buildAttributeBlock(mode, features);
    template += `<extra></extra>`;
    return template;
}

/**
 * Build hover text for spider plots (simpler format, uses text not hovertemplate)
 */
export function buildSpiderHoverText(
    data: Record<string, any>[],
    dataIndex: number
): string {
    const mode = useAppStore.getState().tooltipMode;
    const { columns } = useAppStore.getState();
    const attrState = useAttributeStore.getState();
    const { color, shape, size, customEntries } = attrState;
    const dataPoint = data[dataIndex];

    // Sample ID
    const idCol = findColumnByRole(columns, 'ID');
    const sampleId = idCol ? String(dataPoint[idCol] ?? dataIndex) : String(dataIndex);
    let text = sampleId;

    // Detailed: drillhole + coords
    if (mode === 'detailed') {
        const holeIdCol = findColumnByRole(columns, 'HoleID');
        const fromCol = findColumnByRole(columns, 'From');
        const toCol = findColumnByRole(columns, 'To');
        if (holeIdCol && dataPoint[holeIdCol]) {
            const from = fromCol ? (dataPoint[fromCol] ?? '?') : '?';
            const to = toCol ? (dataPoint[toCol] ?? '?') : '?';
            text += `\n${dataPoint[holeIdCol]}: ${from} - ${to}m`;
        }
        const eastCol = findColumnByRole(columns, 'East');
        const northCol = findColumnByRole(columns, 'North');
        if (eastCol && northCol && dataPoint[eastCol] != null) {
            const elevCol = findColumnByRole(columns, 'Elevation');
            let coordLine = `${Number(dataPoint[eastCol]).toFixed(0)}E, ${Number(dataPoint[northCol]).toFixed(0)}N`;
            if (elevCol && dataPoint[elevCol] != null) {
                coordLine += `, ${Number(dataPoint[elevCol]).toFixed(0)}m RL`;
            }
            text += `\n${coordLine}`;
        }
    }

    // Attribute info
    if (color.field) {
        const category = getEntryNameForPoint(dataPoint, dataIndex, 'color');
        const raw = formatRawValueDisplay(color.field, dataPoint[color.field]);
        if (mode === 'compact') {
            text += `\nColor: ${category || 'N/A'}${raw ? ` (${raw})` : ''}`;
        } else {
            text += `\nColor (${color.field}): ${category || 'N/A'}`;
            if (raw) text += `\n  Raw: ${raw}`;
        }
    }
    if (shape.field) {
        const category = getEntryNameForPoint(dataPoint, dataIndex, 'shape');
        const raw = formatRawValueDisplay(shape.field, dataPoint[shape.field]);
        if (mode === 'compact') {
            text += `\nShape: ${category || 'N/A'}${raw ? ` (${raw})` : ''}`;
        } else {
            text += `\nShape (${shape.field}): ${category || 'N/A'}`;
            if (raw) text += `\n  Raw: ${raw}`;
        }
    }
    if (size.field) {
        const category = getEntryNameForPoint(dataPoint, dataIndex, 'size');
        const raw = formatRawValueDisplay(size.field, dataPoint[size.field]);
        if (mode === 'compact') {
            text += `\nSize: ${category || 'N/A'}${raw ? ` (${raw})` : ''}`;
        } else {
            text += `\nSize (${size.field}): ${category || 'N/A'}`;
            if (raw) text += `\n  Raw: ${raw}`;
        }
    }

    // Paint group (detailed only)
    if (mode === 'detailed' && customEntries.length > 0) {
        const group = customEntries.find(e => e.assignedIndices.includes(dataIndex));
        if (group) {
            text += `\nGroup: ${group.name}`;
        }
    }

    return text;
}
