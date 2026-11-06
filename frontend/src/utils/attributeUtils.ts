/**
 * Attribute styling for plots and tables. The work is done by the shared
 * style engine (utils/styleEngine.ts); these helpers keep the older call
 * signatures and route dataset-wide calls through its cache, so every plot
 * reads the same result and it is computed once per change.
 */
import { useAttributeStore } from '../store/attributeStore';
import type { AttributeType } from '../store/attributeStore';
import { useAppStore } from '../store/appStore';
import { analyticalStore } from './censoring';
import type { ColumnData, ColumnarStore } from '../types/columnarData';
import { isNumericColumn } from '../types/columnarData';
import {
    resolveStyles, datasetStyles, gatherStyles, styleInputsOf,
    type ColumnGetter, type StyleArrays, type StyleResult,
} from './styleEngine';

export type { ColumnGetter, StyleArrays } from './styleEngine';
export { progressiveRamp } from './styleEngine';

/** Safely read a value from a typed column at index i, mapping NaN/'' → null. */
export function getValueAt(col: ColumnData | undefined, i: number): any {
    if (!col) return null;
    if (isNumericColumn(col)) {
        const v = col[i];
        return isNaN(v) ? null : v;
    }
    return col[i] === '' ? null : col[i];
}

/** The analytical store when `getCol` reads the current dataset (raw or analytical columns), else null */
function datasetOf(rowCount: number, getCol: ColumnGetter): ColumnarStore | null {
    const app = useAppStore.getState();
    const raw = app.columnarData;
    if (rowCount !== raw.rowCount || rowCount === 0) return null;
    const an = analyticalStore(raw, app.geochemMappings, app.bdlFactor);
    const s = useAttributeStore.getState();
    const names = new Set<string>();
    for (const t of ['color', 'shape', 'size', 'filter'] as const) {
        if (s[t].field) [s[t].field!, ...(s[t].additionalFields ?? [])].forEach(n => names.add(n));
    }
    if (s.valueFilter.enabled && s.valueFilter.column) names.add(s.valueFilter.column);
    if (s.emphasis.enabled && s.emphasis.column) names.add(s.emphasis.column);
    for (const n of names) {
        const c = getCol(n);
        if (c !== an.columns.get(n) && c !== raw.columns.get(n)) return null;
    }
    return an;
}

function stylesWithGroups(rowCount: number, getCol: ColumnGetter): StyleResult {
    const inputs = styleInputsOf(useAttributeStore.getState());
    const an = datasetOf(rowCount, getCol);
    return an ? datasetStyles(an, inputs) : resolveStyles(rowCount, getCol, inputs, undefined, true);
}

/**
 * Row names of one attribute tab per data row (Data > From Colour /
 * Shape / Size / Filter): painted rows first, then the field classes; rows on
 * the default entry get ''.
 */
export function attributeColumnValues(tab: AttributeType, rowCount: number, getCol: ColumnGetter): string[] {
    const groups = stylesWithGroups(rowCount, getCol).groupOf[tab];
    const out: string[] = new Array(rowCount);
    for (let i = 0; i < rowCount; i++) {
        const e = groups[i];
        out[i] = e && !e.isDefault ? e.name : '';
    }
    return out;
}

/**
 * Styles per row. Dataset-wide calls (and display-sample calls with
 * `originalIndices`) come from the shared cache; other column sets are
 * resolved directly.
 */
export function getStyleArraysColumnar(
    rowCount: number,
    getCol: ColumnGetter,
    originalIndices?: number[]
): StyleArrays {
    const inputs = styleInputsOf(useAttributeStore.getState());
    const app = useAppStore.getState();
    if (originalIndices && originalIndices.length === rowCount && app.columnarData.rowCount > 0) {
        const an = analyticalStore(app.columnarData, app.geochemMappings, app.bdlFactor);
        return gatherStyles(an, inputs, originalIndices);
    }
    const an = datasetOf(rowCount, getCol);
    return an ? datasetStyles(an, inputs) : resolveStyles(rowCount, getCol, inputs, originalIndices);
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

// Re-export emphasis utilities for convenience
export { applyOpacityToColor, sortByEmphasis } from './emphasisUtils';
export type { EmphasisResult } from './emphasisUtils';

/**
 * Build an overlay trace for selection highlighting: a separate trace
 * containing only the selected points, drawn with a white outline. Keeping
 * selection out of the base trace lets the (expensive) base trace stay
 * memoized across selection changes. Returns null if no points are selected.
 * Pass plotType 'scatter' on SVG plots to avoid creating a WebGL context.
 */
export function buildSelectionOverlayTrace(
    xValues: any[],
    yValues: any[],
    selectedIndices: number[] | Set<number>,
    sortedOriginalIndices: number[],
    sizes: number[],
    shapes: string[],
    plotType: 'scatter' | 'scattergl' = 'scattergl',
    ring: { color: string; width: number } = { color: '#ffffff', width: 2 },
): any | null {
    const selectedSet = selectedIndices instanceof Set ? selectedIndices : new Set(selectedIndices);
    if (selectedSet.size === 0) return null;
    const overlayX: any[] = [];
    const overlayY: any[] = [];
    const overlaySizes: number[] = [];
    const overlayShapes: string[] = [];

    for (let i = 0; i < sortedOriginalIndices.length; i++) {
        if (selectedSet.has(sortedOriginalIndices[i])) {
            overlayX.push(xValues[i]);
            overlayY.push(yValues[i]);
            overlaySizes.push(sizes[i]);
            overlayShapes.push(shapes[i]);
        }
    }

    if (overlayX.length === 0) return null;

    return {
        x: overlayX,
        y: overlayY,
        mode: 'markers',
        type: plotType,
        hoverinfo: 'skip',
        showlegend: false,
        marker: {
            color: 'rgba(0,0,0,0)',
            symbol: overlayShapes.map(s => shapeToPlotlySymbol(s)),
            size: overlaySizes,
            line: { width: ring.width, color: ring.color },
        },
    };
}

/**
 * Get sorted indices for rendering data points with emphasis z-ordering
 * Points with higher zIndex values should be rendered last (on top)
 */
export function getSortedIndices(styleArrays: StyleArrays): number[] {
    const z = styleArrays.zIndices;
    const indices: number[] = [];
    for (let i = 0; i < styleArrays.visible.length; i++) if (styleArrays.visible[i]) indices.push(i);
    // stable: equal z keeps data order
    return indices.sort((a, b) => (z[a] ?? 0) - (z[b] ?? 0) || a - b);
}

/**
 * Sort columns by priority (lower number = higher priority)
 * Columns without priority get a default priority of 10
 */
/** Resolve a column name to its display alias (falls back to raw name) */
export function getColumnDisplayName(
    columns: { name: string; alias: string | null }[],
    columnName: string
): string {
    const col = columns.find(c => c.name === columnName);
    return col?.alias || columnName;
}

export function sortColumnsByPriority<T extends { name: string; priority?: number }>(columns: T[]): T[] {
    return [...columns].sort((a, b) => {
        const prioA = a.priority ?? 10;
        const prioB = b.priority ?? 10;
        if (prioA !== prioB) return prioA - prioB;
        // Secondary sort by name
        return a.name.localeCompare(b.name);
    });
}

/**
 * Live Rows / Rows visible per entry of one tab, keyed by entry id ('' =
 * the default entry): each row counts once, for the entry that names it.
 */
export function entryRowCounts(
    tab: AttributeType,
    rowCount: number,
    getCol: ColumnGetter,
): Map<string, { total: number; visible: number }> {
    const r = stylesWithGroups(rowCount, getCol);
    const groups = r.groupOf[tab];
    const out = new Map<string, { total: number; visible: number }>();
    for (let i = 0; i < rowCount; i++) {
        const e = groups[i];
        const k = e && !e.isDefault ? e.id : '';
        let c = out.get(k);
        if (!c) out.set(k, (c = { total: 0, visible: 0 }));
        c.total++;
        if (r.visible[i]) c.visible++;
    }
    return out;
}

/** Dataset rows drawn with one entry of a tab (painted group or field class; '' = Default) */
export function entryRows(tab: AttributeType, entryId: string): number[] {
    const app = useAppStore.getState();
    const n = app.columnarData.rowCount;
    const groups = stylesWithGroups(n, c => app.getColumn(c)).groupOf[tab];
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
        const e = groups[i];
        const id = e && !e.isDefault ? e.id : '';
        if (id === entryId) out.push(i);
    }
    return out;
}

/**
 * Rows a paint stroke may take: all of them, or with "Unassigned only" just
 * the rows on the Default row of the active tab and those already in the
 * active group (habit: hide finished groups, then lasso the next).
 */
export function paintableIndices(indices: number[], rowCount: number, getCol: ColumnGetter): number[] {
    const state = useAttributeStore.getState();
    if (!state.paintUnassignedOnly) return indices;
    const groups = stylesWithGroups(rowCount, getCol).groupOf[state.activeTab];
    return indices.filter(i => {
        const e = groups[i];
        return !e || e.isDefault || e.id === state.activeEntryId;
    });
}
