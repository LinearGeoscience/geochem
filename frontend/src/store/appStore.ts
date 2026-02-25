import { create } from 'zustand';
import { dataApi, qgisApi } from '../services/api';
import { AttributeState, createAttributeSlice } from './attributeSlice';
import { useAttributeStore } from './attributeStore';
import { ColumnGeochemMapping } from '../types/associations';
import {
    createGeochemMappings,
    findColumnForOxide,
    findColumnForElement,
    getColumnsByCategory,
} from '../utils/calculations/elementNameNormalizer';

interface ColumnInfo {
    name: string;
    type: string;
    role: string | null;
    alias: string | null;
    priority?: number; // Lower = higher priority in dropdowns (1-10)
    transformationType?: 'raw' | 'clr' | 'alr' | 'ilr' | 'plr' | 'slr' | 'chipower' | 'log-additive' | 'anhydrous' | 'recalculated' | null; // Which transformation created this column
    transformationGroupId?: string; // Group ID for named transformation batches
}

// Column filter options
export type ColumnFilterType = 'all' | 'raw' | 'raw-elements' | 'clr' | 'alr' | 'ilr' | 'plr' | 'slr' | 'chipower' | 'log-additive' | 'anhydrous' | 'recalculated' | `group:${string}`;

export const COLUMN_FILTER_LABELS: Record<string, string> = {
    all: 'All Columns',
    raw: 'Raw Data',
    'raw-elements': 'Raw Elements',
    clr: 'CLR Transformed',
    alr: 'ALR Transformed',
    ilr: 'ILR Transformed',
    plr: 'PLR Transformed',
    slr: 'SLR Transformed',
    chipower: 'Chi-Power Transformed',
    'log-additive': 'Log Additive Index',
    anhydrous: 'Anhydrous (Volatile-Free)',
    recalculated: 'Recalculated (Sulfide-Free)',
};

export interface TransformationGroup {
    id: string;
    name: string;
    transformationType: string;
    columnNames: string[];
}

type PlotType = 'scatter' | 'ternary' | 'spider' | 'map' | 'map3d' | 'downhole' | 'histogram' | 'clr' | 'classification' | 'pathfinder';

// Sampling types
export interface SamplingConfig {
    enabled: boolean;
    sampleSize: number;
    method: 'random' | 'stratified' | 'drillhole';
    outlierColumns: string[];
    classificationColumn: string | null;
    drillholeColumn: string | null;
    iqrMultiplier: number;
    seed: number | null;
}

export interface SamplingResult {
    totalRows: number;
    sampleSize: number;
    outlierCount: number;
    method: string;
}

// Per-plot settings storage
interface PlotSettings {
    [key: string]: any;
}

interface PlotInstance {
    id: string;
    type: PlotType;
    title: string;
    settings: PlotSettings;
}

interface AppState {
    columns: ColumnInfo[];
    data: any[];
    isLoading: boolean;
    uploadProgress: number; // 0-100
    streamingStatus: string | null; // e.g. "Loading data... 50,000 / 200,000 rows"
    error: string | null;
    currentView: 'import' | 'data' | 'columns' | 'plots' | 'analysis' | 'qaqc' | 'statistics' | 'settings' | 'diagram-editor';

    // Column filtering by transformation type
    columnFilter: ColumnFilterType;
    availableFilters: ColumnFilterType[]; // Which filters have data
    setColumnFilter: (filter: ColumnFilterType) => void;
    getFilteredColumns: () => ColumnInfo[];

    // Named transformation groups
    transformationGroups: TransformationGroup[];
    addTransformationGroup: (group: Omit<TransformationGroup, 'id'>) => string;

    // Multi-plot state
    plots: PlotInstance[];
    activePlotId: string | null;

    // Selection & Classification
    selectedIndices: number[];
    setSelection: (indices: number[]) => void;
    assignClassToSelection: (column: string, className: string) => void;

    // Plot settings
    lockAxes: boolean;
    setLockAxes: (locked: boolean) => void;

    // Analysis state
    statsSelectedColumns: string[];
    correlationSelectedColumns: string[];
    setStatsSelectedColumns: (columns: string[]) => void;
    setCorrelationSelectedColumns: (columns: string[]) => void;

    fetchColumns: () => Promise<void>;
    fetchData: () => Promise<void>;
    uploadFile: (file: File) => Promise<void>;
    uploadDrillhole: (collar: File, survey: File, assay: File) => Promise<void>;
    updateColumn: (column: string, role?: string, alias?: string) => Promise<void>;
    updateColumnType: (column: string, newType: string, treatNegativeAsZero?: boolean) => void;
    updateColumnTypes: (columns: string[], newType: string, treatNegativeAsZero?: boolean) => void;
    setCurrentView: (view: 'import' | 'data' | 'columns' | 'plots' | 'analysis' | 'qaqc' | 'statistics' | 'settings') => void;

    // Plot actions
    addPlot: (type: PlotType) => void;
    removePlot: (id: string) => void;
    setActivePlotId: (id: string) => void;
    getPlotSettings: (plotId: string) => PlotSettings;
    updatePlotSettings: (plotId: string, settings: Partial<PlotSettings>) => void;

    // Data actions
    addColumn: (name: string, values: any[], colType?: string, role?: string, transformationType?: ColumnInfo['transformationType'], transformationGroupId?: string) => void;
    savePaintGroupsToColumn: (columnName: string) => void;

    // Sampling
    samplingConfig: SamplingConfig;
    samplingResult: SamplingResult | null;
    sampleIndices: Set<number> | null;
    isSampling: boolean;
    samplingError: string | null;
    setSamplingEnabled: (enabled: boolean) => void;
    updateSamplingConfig: (partial: Partial<SamplingConfig>) => void;
    computeSample: () => Promise<void>;
    clearSample: () => void;
    getDisplayData: () => any[];
    getDisplayIndices: () => number[] | null;

    // Geochem column mappings
    geochemMappings: ColumnGeochemMapping[];
    showGeochemDialog: boolean;
    setGeochemMappings: (mappings: ColumnGeochemMapping[]) => void;
    updateGeochemMapping: (columnName: string, updates: Partial<ColumnGeochemMapping>) => void;
    batchUpdateGeochemMappings: (updates: Array<{ columnName: string; updates: Partial<ColumnGeochemMapping> }>) => void;
    setShowGeochemDialog: (show: boolean) => void;
    confirmAllMappings: () => void;
    getColumnForOxide: (oxideFormula: string) => string | null;
    getColumnForElement: (element: string, unit?: string) => string | null;
    getMajorOxides: () => ColumnGeochemMapping[];
    getTraceElements: () => ColumnGeochemMapping[];
    getREE: () => ColumnGeochemMapping[];

    // Logging merge dialog
    showLoggingMergeDialog: boolean;
    setShowLoggingMergeDialog: (show: boolean) => void;

    // Tooltip mode
    tooltipMode: 'compact' | 'detailed';
    setTooltipMode: (mode: 'compact' | 'detailed') => void;

    // QGIS sync
    syncToQgis: () => Promise<void>;
}

/**
 * Convert a single value to the target column type.
 * Missing/unparseable values become null (not zero) to preserve the distinction
 * between "not measured" and "measured as zero" in geochemical data.
 */
function convertValueForType(value: any, newType: string, treatNegativeAsZero: boolean): any {
    if (newType === 'numeric' || newType === 'float' || newType === 'integer') {
        if (value === null || value === undefined || value === '' || value === 'NA' || value === 'N/A' || value === '-') {
            return null; // Preserve null — missing data is not zero
        } else if (typeof value === 'string') {
            const cleaned = value.replace(/[<>,%$]/g, '').trim();
            const parsed = parseFloat(cleaned);
            if (isNaN(parsed)) {
                return null; // Unparseable strings become null, not zero
            } else if (parsed < 0 && treatNegativeAsZero) {
                return 0;
            } else {
                return newType === 'integer' ? Math.round(parsed) : parsed;
            }
        } else if (typeof value === 'number') {
            if (value < 0 && treatNegativeAsZero) {
                return 0;
            } else {
                return newType === 'integer' ? Math.round(value) : value;
            }
        }
        return value;
    } else if (newType === 'text' || newType === 'categorical') {
        return value === null || value === undefined ? '' : String(value);
    }
    return value;
}

type CombinedState = AppState & AttributeState;

export const useAppStore = create<CombinedState>()((set, get, api) => ({
    ...createAttributeSlice(set, get, api),
    columns: [],
    data: [],
    isLoading: false,
    uploadProgress: 0,
    streamingStatus: null,
    error: null,
    currentView: 'import',

    // Column filtering
    columnFilter: 'all' as ColumnFilterType,
    availableFilters: ['all', 'raw'] as ColumnFilterType[],
    transformationGroups: [],

    setColumnFilter: (filter) => set((state) => ({
        columnFilter: state.availableFilters.includes(filter) ? filter : 'all'
    })),

    getFilteredColumns: () => {
        const { columns, columnFilter, geochemMappings } = get();
        if (columnFilter === 'all') return columns;
        if (columnFilter === 'raw') {
            return columns.filter(c => !c.transformationType || c.transformationType === 'raw');
        }
        if (columnFilter === 'raw-elements') {
            const geochemNames = new Set(
                geochemMappings
                    .filter(m => m.category === 'majorOxide' || m.category === 'traceElement' || m.category === 'ree')
                    .map(m => m.originalName)
            );
            return columns.filter(c =>
                (!c.transformationType || c.transformationType === 'raw') &&
                geochemNames.has(c.name)
            );
        }
        if (columnFilter.startsWith('group:')) {
            const groupId = columnFilter.slice(6);
            const group = get().transformationGroups.find(g => g.id === groupId);
            if (group) {
                const nameSet = new Set(group.columnNames);
                return columns.filter(c => nameSet.has(c.name));
            }
            return [];
        }
        return columns.filter(c => c.transformationType === columnFilter);
    },

    plots: [],
    activePlotId: null,
    selectedIndices: [],
    lockAxes: false,

    // Sampling defaults
    samplingConfig: {
        enabled: false,
        sampleSize: 10000,
        method: 'random',
        outlierColumns: [],
        classificationColumn: null,
        drillholeColumn: null,
        iqrMultiplier: 1.5,
        seed: null,
    },
    samplingResult: null,
    sampleIndices: null,
    isSampling: false,
    samplingError: null,

    // Geochem mappings
    geochemMappings: [],
    showGeochemDialog: false,

    // Logging merge dialog
    showLoggingMergeDialog: false,
    setShowLoggingMergeDialog: (show) => set({ showLoggingMergeDialog: show }),

    // Tooltip mode
    tooltipMode: 'compact',
    setTooltipMode: (mode) => set({ tooltipMode: mode }),

    statsSelectedColumns: [],
    correlationSelectedColumns: [],

    setCurrentView: (view) => set({ currentView: view }),
    setLockAxes: (locked) => set({ lockAxes: locked }),

    addPlot: (type) => {
        const id = Math.random().toString(36).substr(2, 9);
        const title = `${type.charAt(0).toUpperCase() + type.slice(1)} Plot ${get().plots.length + 1}`;
        set((state) => ({
            plots: [...state.plots, { id, type, title, settings: {} }],
            activePlotId: id
        }));
    },

    removePlot: (id) => {
        set((state) => ({
            plots: state.plots.filter(p => p.id !== id),
            activePlotId: state.activePlotId === id ? null : state.activePlotId
        }));
    },

    setActivePlotId: (id) => set({ activePlotId: id }),

    getPlotSettings: (plotId) => {
        const plot = get().plots.find(p => p.id === plotId);
        return plot?.settings || {};
    },

    updatePlotSettings: (plotId, settings) => {
        set((state) => ({
            plots: state.plots.map(p =>
                p.id === plotId
                    ? { ...p, settings: { ...p.settings, ...settings } }
                    : p
            )
        }));
    },

    setSelection: (indices) => {
        set({ selectedIndices: indices });
    },

    assignClassToSelection: (columnName, className) => {
        set((state) => {
            const { data, selectedIndices, columns } = state;
            if (selectedIndices.length === 0) return {};

            // Direct property set — avoids spreading all props per row
            const selectedSet = new Set(selectedIndices);
            const newData = data.map((row, i) => {
                row[columnName] = selectedSet.has(i) ? className : (row[columnName] ?? 'Unclassified');
                return row;
            });

            const columnExists = columns.some(c => c.name === columnName);
            const newColumns = columnExists
                ? columns
                : [...columns, { name: columnName, type: 'categorical', role: 'Classification', alias: null }];

            return {
                data: newData,
                columns: newColumns
            };
        });
    },

    setStatsSelectedColumns: (columns) => set({ statsSelectedColumns: columns }),
    setCorrelationSelectedColumns: (columns) => set({ correlationSelectedColumns: columns }),

    addColumn: (name, values, colType = 'categorical', role = 'Classification', transformationType = null, transformationGroupId) => {
        set((state) => {
            // Direct property set — avoids spreading 200k objects × 50 props each
            const newData = state.data.map((row, i) => {
                row[name] = values[i];
                return row;
            });

            const newColumn: ColumnInfo = {
                name: name,
                type: colType,
                role: role,
                alias: null,
                priority: 5,
                transformationType: transformationType,
                ...(transformationGroupId ? { transformationGroupId } : {})
            };

            const columnExists = state.columns.some(c => c.name === name);
            const newColumns = columnExists
                ? state.columns.map(c => c.name === name ? { ...c, ...newColumn } : c)
                : [...state.columns, newColumn];

            // Update available filters if this is a new transformation type (skip if in a named group)
            let newAvailableFilters = [...state.availableFilters];
            if (transformationType && !transformationGroupId && !newAvailableFilters.includes(transformationType)) {
                newAvailableFilters.push(transformationType);
            }

            return {
                data: newData,
                columns: newColumns,
                availableFilters: newAvailableFilters
            };
        });
    },

    savePaintGroupsToColumn: (columnName) => {
        const { data, addColumn } = get();
        const { customEntries } = useAttributeStore.getState();
        const values: string[] = new Array(data.length).fill('Unclassified');
        for (const entry of customEntries) {
            for (const idx of entry.assignedIndices) {
                if (idx >= 0 && idx < data.length) {
                    values[idx] = entry.name;
                }
            }
        }
        addColumn(columnName, values, 'categorical', 'Classification');
    },

    addTransformationGroup: (group) => {
        const id = Math.random().toString(36).substr(2, 9);
        set((state) => ({
            transformationGroups: [...state.transformationGroups, { ...group, id }],
            availableFilters: [...state.availableFilters, `group:${id}` as ColumnFilterType],
        }));
        return id;
    },

    fetchColumns: async () => {
        set({ isLoading: true });
        try {
            const columns = await dataApi.getColumns();
            // Only update columns if API returned data - don't wipe existing columns
            if (columns && columns.length > 0) {
                set({ columns, isLoading: false });
            } else {
                console.warn('[fetchColumns] API returned empty columns, keeping existing');
                set({ isLoading: false });
            }
        } catch (err: any) {
            console.error('[fetchColumns] Error:', err);
            set({ error: err.message, isLoading: false });
        }
    },

    fetchData: async () => {
        set({ isLoading: true });
        try {
            const data = await dataApi.getData();
            set({ data, isLoading: false });
        } catch (err: any) {
            set({ error: err.message, isLoading: false });
        }
    },

    uploadFile: async (file: File) => {
        set({ isLoading: true, uploadProgress: 0, error: null, streamingStatus: null });
        try {
            // Phase 1: Upload file → get metadata (no data in response)
            const result = await dataApi.uploadFile(file, (progress) => {
                set({ uploadProgress: Math.round(progress * 0.5) }); // 0-50% = upload
            });
            set({ uploadProgress: 50 });

            const columnInfo = result.column_info || [];
            const totalRows = result.rows || 0;

            // Set columns immediately so UI can show structure
            set({ columns: columnInfo });

            // Generate geochem mappings early
            const columnNames = columnInfo.map((c: ColumnInfo) => c.name);
            const mappings = createGeochemMappings(columnNames, columnInfo);
            set({ geochemMappings: mappings, showGeochemDialog: true });

            // Phase 2: Stream data in progressively
            set({ streamingStatus: `Loading data... 0 / ${totalRows.toLocaleString()} rows` });
            const data = await dataApi.streamData((loaded, total) => {
                const streamProgress = Math.round((loaded / total) * 50);
                set({
                    uploadProgress: 50 + streamProgress, // 50-100% = streaming
                    streamingStatus: `Loading data... ${loaded.toLocaleString()} / ${total.toLocaleString()} rows`
                });
            });

            console.log(`[uploadFile] Streamed ${data.length} rows`);
            set({
                data,
                isLoading: false,
                uploadProgress: 0,
                streamingStatus: null
            });

            // Auto-sync to QGIS
            get().syncToQgis();

            // Auto-enable sampling for large datasets
            if (data.length > 20000) {
                const autoSize = Math.min(10000, Math.round(data.length * 0.25));
                // Auto-select first 5 major oxide / trace element columns for outlier preservation
                const currentMappings = get().geochemMappings;
                const outlierCols = currentMappings
                    .filter(m => m.category === 'majorOxide' || m.category === 'traceElement')
                    .slice(0, 5)
                    .map(m => m.originalName);
                set((state) => ({
                    samplingConfig: { ...state.samplingConfig, enabled: true, sampleSize: autoSize, outlierColumns: outlierCols }
                }));
                get().computeSample();
            }
        } catch (err: any) {
            const message = err.response?.data?.detail || err.message;
            set({ error: message, isLoading: false, uploadProgress: 0, streamingStatus: null });
        }
    },

    uploadDrillhole: async (collar: File, survey: File, assay: File) => {
        set({ isLoading: true, uploadProgress: 0, error: null, streamingStatus: null });
        try {
            // Phase 1: Upload + desurvey → get metadata (no data in response)
            const result = await dataApi.uploadDrillhole(collar, survey, assay, (progress) => {
                set({ uploadProgress: Math.round(progress * 0.5) }); // 0-50% = upload+desurvey
            });
            set({ uploadProgress: 50 });

            const columnInfo = result.column_info || [];
            const totalRows = result.rows || 0;

            // Set columns immediately so UI can show structure
            set({ columns: columnInfo });

            // Generate geochem mappings early
            const columnNames = columnInfo.map((c: ColumnInfo) => c.name);
            const mappings = createGeochemMappings(columnNames, columnInfo);
            set({ geochemMappings: mappings, showGeochemDialog: true });

            // Phase 2: Stream data in progressively
            set({ streamingStatus: `Loading data... 0 / ${totalRows.toLocaleString()} rows` });
            const data = await dataApi.streamData((loaded, total) => {
                const streamProgress = Math.round((loaded / total) * 50);
                set({
                    uploadProgress: 50 + streamProgress,
                    streamingStatus: `Loading data... ${loaded.toLocaleString()} / ${total.toLocaleString()} rows`
                });
            });

            console.log(`[uploadDrillhole] Streamed ${data.length} rows`);
            set({
                data,
                isLoading: false,
                uploadProgress: 0,
                streamingStatus: null
            });

            // Auto-sync to QGIS
            get().syncToQgis();

            // Auto-enable sampling for large datasets
            if (data.length > 20000) {
                const autoSize = Math.min(10000, Math.round(data.length * 0.25));
                const currentMappings = get().geochemMappings;
                const outlierCols = currentMappings
                    .filter(m => m.category === 'majorOxide' || m.category === 'traceElement')
                    .slice(0, 5)
                    .map(m => m.originalName);
                set((state) => ({
                    samplingConfig: { ...state.samplingConfig, enabled: true, sampleSize: autoSize, outlierColumns: outlierCols }
                }));
                get().computeSample();
            }
        } catch (err: any) {
            const message = err.response?.data?.detail || err.message;
            set({ error: message, isLoading: false, uploadProgress: 0, streamingStatus: null });
        }
    },

    updateColumn: async (column: string, role?: string, alias?: string) => {
        try {
            // Update local state immediately for responsiveness
            set((state) => ({
                columns: state.columns.map(col =>
                    col.name === column
                        ? {
                            ...col,
                            role: role !== undefined ? (role || null) : col.role,
                            alias: alias !== undefined ? (alias || null) : col.alias
                        }
                        : col
                )
            }));

            // Then sync with backend (fire and forget - don't wipe local state)
            try {
                await dataApi.updateColumn(column, role, alias);
            } catch (apiErr) {
                console.warn('[updateColumn] Backend sync failed, keeping local state:', apiErr);
            }
        } catch (err: any) {
            set({ error: err.message });
        }
    },

    updateColumnType: (column: string, newType: string, treatNegativeAsZero: boolean = true) => {
        set((state) => {
            // Direct property set — avoids spreading all props per row
            const newData = state.data.map(row => {
                row[column] = convertValueForType(row[column], newType, treatNegativeAsZero);
                return row;
            });

            const newColumns = state.columns.map(col =>
                col.name === column
                    ? { ...col, type: newType }
                    : col
            );

            console.log(`[updateColumnType] Column "${column}" converted to ${newType}`);
            return { data: newData, columns: newColumns };
        });
    },

    updateColumnTypes: (columnNames: string[], newType: string, treatNegativeAsZero: boolean = true) => {
        set((state) => {
            // Direct property set — avoids spreading all props per row
            const newData = state.data.map(row => {
                for (const colName of columnNames) {
                    row[colName] = convertValueForType(row[colName], newType, treatNegativeAsZero);
                }
                return row;
            });

            const newColumns = state.columns.map(col =>
                columnNames.includes(col.name)
                    ? { ...col, type: newType }
                    : col
            );

            console.log(`[updateColumnTypes] ${columnNames.length} columns converted to ${newType}`);
            return { data: newData, columns: newColumns };
        });
    },

    setSamplingEnabled: (enabled) => {
        set((state) => ({
            samplingConfig: { ...state.samplingConfig, enabled },
            samplingError: null,
        }));
        if (enabled) {
            get().computeSample();
        } else {
            get().clearSample();
        }
    },

    updateSamplingConfig: (partial) => {
        set((state) => ({
            samplingConfig: { ...state.samplingConfig, ...partial }
        }));
        // Re-compute if sampling is enabled
        if (get().samplingConfig.enabled) {
            get().computeSample();
        }
    },

    computeSample: async () => {
        const { data, samplingConfig } = get();
        if (!samplingConfig.enabled || data.length === 0) {
            return;
        }

        const sampleParams = {
            sample_size: samplingConfig.sampleSize,
            method: samplingConfig.method,
            outlier_columns: samplingConfig.outlierColumns,
            classification_column: samplingConfig.classificationColumn,
            drillhole_column: samplingConfig.drillholeColumn,
            iqr_multiplier: samplingConfig.iqrMultiplier,
            seed: samplingConfig.seed,
        };

        set({ isSampling: true, samplingError: null });
        try {
            let result;
            try {
                result = await dataApi.computeSample(sampleParams);
            } catch (err: any) {
                // If backend lost data (e.g. restart), re-sync and retry once
                if (err?.response?.status === 400 && err?.response?.data?.detail === 'No data loaded') {
                    console.log('[computeSample] Backend has no data, syncing...');
                    await dataApi.syncData(data);
                    result = await dataApi.computeSample(sampleParams);
                } else {
                    throw err;
                }
            }

            set({
                sampleIndices: new Set(result.indices),
                samplingResult: {
                    totalRows: result.total_rows,
                    sampleSize: result.sample_size,
                    outlierCount: result.outlier_count,
                    method: result.method,
                },
                isSampling: false,
                samplingError: null,
            });
            console.log(`[computeSample] Sample: ${result.sample_size}/${result.total_rows} rows (${result.outlier_count} outliers preserved)`);
        } catch (err: any) {
            console.error('[computeSample] Failed:', err);
            const detail = err?.response?.data?.detail || err?.message || 'Sampling failed';
            set({ isSampling: false, samplingError: detail });
        }
    },

    clearSample: () => {
        set({
            sampleIndices: null,
            samplingResult: null,
            samplingError: null,
            samplingConfig: { ...get().samplingConfig, enabled: false },
        });
    },

    getDisplayData: () => {
        const { data, sampleIndices } = get();
        if (!sampleIndices) return data;
        return data.filter((_, i) => sampleIndices.has(i));
    },

    getDisplayIndices: () => {
        const { data, sampleIndices } = get();
        if (!sampleIndices) return null;
        const indices: number[] = [];
        for (let i = 0; i < data.length; i++) {
            if (sampleIndices.has(i)) indices.push(i);
        }
        return indices;
    },

    // Geochem mapping actions
    setGeochemMappings: (mappings) => {
        const hasGeochem = mappings.some(
            m => m.category === 'majorOxide' || m.category === 'traceElement' || m.category === 'ree'
        );
        set((state) => {
            const newFilters = [...state.availableFilters];
            if (hasGeochem && !newFilters.includes('raw-elements')) {
                newFilters.splice(2, 0, 'raw-elements');
            }
            return { geochemMappings: mappings, availableFilters: newFilters };
        });
    },

    updateGeochemMapping: (columnName, updates) => {
        set((state) => ({
            geochemMappings: state.geochemMappings.map(m =>
                m.originalName === columnName ? { ...m, ...updates } : m
            )
        }));
    },

    batchUpdateGeochemMappings: (updates) => {
        set((state) => {
            const updateMap = new Map(updates.map(u => [u.columnName, u.updates]));
            return {
                geochemMappings: state.geochemMappings.map(m => {
                    const upd = updateMap.get(m.originalName);
                    return upd ? { ...m, ...upd } : m;
                })
            };
        });
    },

    setShowGeochemDialog: (show) => set({ showGeochemDialog: show }),

    confirmAllMappings: () => {
        set((state) => {
            const hasGeochem = state.geochemMappings.some(
                m => m.category === 'majorOxide' || m.category === 'traceElement' || m.category === 'ree'
            );
            const newFilters = [...state.availableFilters];
            if (hasGeochem && !newFilters.includes('raw-elements')) {
                newFilters.splice(2, 0, 'raw-elements'); // Insert after 'all' and 'raw'
            }
            return {
                geochemMappings: state.geochemMappings.map(m => ({ ...m, isConfirmed: true })),
                showGeochemDialog: false,
                availableFilters: newFilters,
            };
        });
    },

    getColumnForOxide: (oxideFormula) => {
        return findColumnForOxide(get().geochemMappings, oxideFormula);
    },

    getColumnForElement: (element, unit) => {
        return findColumnForElement(get().geochemMappings, element, unit);
    },

    getMajorOxides: () => getColumnsByCategory(get().geochemMappings, 'majorOxide'),
    getTraceElements: () => getColumnsByCategory(get().geochemMappings, 'traceElement'),
    getREE: () => getColumnsByCategory(get().geochemMappings, 'ree'),

    syncToQgis: async () => {
        const { data, columns } = get();
        if (data.length === 0) {
            console.warn('[syncToQgis] No data to sync');
            return;
        }
        try {
            const result = await qgisApi.syncData(data, columns);
            console.log(`[syncToQgis] Synced ${result.rows} rows, ${result.columns} columns to QGIS`);
        } catch (err) {
            console.warn('[syncToQgis] Failed to sync (QGIS integration may not be running):', err);
        }
    }
}));
