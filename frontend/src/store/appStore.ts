import { create } from 'zustand';
import { dataApi, qgisApi } from '../services/api';
import { AttributeState, createAttributeSlice } from './attributeSlice';
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
}

// Column filter options
export type ColumnFilterType = 'all' | 'raw' | 'clr' | 'alr' | 'ilr' | 'plr' | 'slr' | 'chipower' | 'log-additive' | 'anhydrous' | 'recalculated';

export const COLUMN_FILTER_LABELS: Record<ColumnFilterType, string> = {
    all: 'All Columns',
    raw: 'Raw Data',
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
    error: string | null;
    currentView: 'import' | 'data' | 'columns' | 'plots' | 'analysis' | 'qaqc' | 'statistics' | 'settings' | 'diagram-editor';

    // Column filtering by transformation type
    columnFilter: ColumnFilterType;
    availableFilters: ColumnFilterType[]; // Which filters have data
    setColumnFilter: (filter: ColumnFilterType) => void;
    getFilteredColumns: () => ColumnInfo[];

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
    addColumn: (name: string, values: any[], colType?: string, role?: string, transformationType?: ColumnInfo['transformationType']) => void;

    // Sampling
    samplingConfig: SamplingConfig;
    samplingResult: SamplingResult | null;
    sampleIndices: Set<number> | null;
    isSampling: boolean;
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
    error: null,
    currentView: 'import',

    // Column filtering
    columnFilter: 'all' as ColumnFilterType,
    availableFilters: ['all', 'raw'] as ColumnFilterType[],

    setColumnFilter: (filter) => set({ columnFilter: filter }),

    getFilteredColumns: () => {
        const { columns, columnFilter } = get();
        if (columnFilter === 'all') return columns;
        if (columnFilter === 'raw') {
            return columns.filter(c => !c.transformationType || c.transformationType === 'raw');
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

    // Geochem mappings
    geochemMappings: [],
    showGeochemDialog: false,

    // Logging merge dialog
    showLoggingMergeDialog: false,
    setShowLoggingMergeDialog: (show) => set({ showLoggingMergeDialog: show }),

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

            // Get existing values or initialize with 'Unclassified'
            const currentValues = data.map(row => row[columnName] || 'Unclassified');

            // Update selected indices
            selectedIndices.forEach(index => {
                if (index >= 0 && index < currentValues.length) {
                    currentValues[index] = className;
                }
            });

            const newData = data.map((row, i) => ({
                ...row,
                [columnName]: currentValues[i]
            }));

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

    addColumn: (name, values, colType = 'categorical', role = 'Classification', transformationType = null) => {
        set((state) => {
            const newData = state.data.map((row, i) => ({
                ...row,
                [name]: values[i]
            }));

            const newColumn: ColumnInfo = {
                name: name,
                type: colType,
                role: role,
                alias: null,
                priority: 5,
                transformationType: transformationType
            };

            const columnExists = state.columns.some(c => c.name === name);
            const newColumns = columnExists
                ? state.columns.map(c => c.name === name ? { ...c, ...newColumn } : c)
                : [...state.columns, newColumn];

            // Update available filters if this is a new transformation type
            let newAvailableFilters = [...state.availableFilters];
            if (transformationType && !newAvailableFilters.includes(transformationType)) {
                newAvailableFilters.push(transformationType);
            }

            return {
                data: newData,
                columns: newColumns,
                availableFilters: newAvailableFilters
            };
        });
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
        set({ isLoading: true, uploadProgress: 0, error: null });
        try {
            const result = await dataApi.uploadFile(file, (progress) => {
                set({ uploadProgress: progress });
            });
            set({ uploadProgress: 100 });

            // Use full data from upload response if available
            if (result.data && result.data.length > 0) {
                console.log(`[uploadFile] Using ${result.data.length} rows from upload response`);
                const columnInfo = result.column_info || [];
                set({
                    data: result.data,
                    columns: columnInfo,
                    isLoading: false,
                    uploadProgress: 0
                });
                // Generate geochem mappings
                const columnNames = columnInfo.map((c: ColumnInfo) => c.name);
                const mappings = createGeochemMappings(columnNames, columnInfo);
                set({ geochemMappings: mappings, showGeochemDialog: true });
                // Auto-sync to QGIS
                get().syncToQgis();
                // Auto-enable sampling for large datasets
                if (result.data.length > 20000) {
                    const autoSize = Math.min(10000, Math.round(result.data.length * 0.25));
                    set((state) => ({
                        samplingConfig: { ...state.samplingConfig, enabled: true, sampleSize: autoSize }
                    }));
                    get().computeSample();
                }
            } else {
                // Fallback to fetching data separately
                console.log('[uploadFile] No data in response, fetching separately...');
                await get().fetchColumns();
                await get().fetchData();
                set({ isLoading: false, uploadProgress: 0 });
                // Generate geochem mappings from fetched columns
                const cols = get().columns;
                const columnNames = cols.map(c => c.name);
                const mappings = createGeochemMappings(columnNames, cols);
                set({ geochemMappings: mappings, showGeochemDialog: true });
                // Auto-sync to QGIS
                get().syncToQgis();
            }
        } catch (err: any) {
            const message = err.response?.data?.detail || err.message;
            set({ error: message, isLoading: false, uploadProgress: 0 });
        }
    },

    uploadDrillhole: async (collar: File, survey: File, assay: File) => {
        set({ isLoading: true, uploadProgress: 0, error: null });
        try {
            const result = await dataApi.uploadDrillhole(collar, survey, assay, (progress) => {
                set({ uploadProgress: progress });
            });
            set({ uploadProgress: 100 });

            // Use full data from upload response if available
            if (result.data && result.data.length > 0) {
                console.log(`[uploadDrillhole] Using ${result.data.length} rows from upload response`);
                const columnInfo = result.column_info || [];
                set({
                    data: result.data,
                    columns: columnInfo,
                    isLoading: false,
                    uploadProgress: 0
                });
                // Generate geochem mappings
                const columnNames = columnInfo.map((c: ColumnInfo) => c.name);
                const mappings = createGeochemMappings(columnNames, columnInfo);
                set({ geochemMappings: mappings, showGeochemDialog: true });
                // Auto-sync to QGIS
                get().syncToQgis();
                // Auto-enable sampling for large datasets
                if (result.data.length > 20000) {
                    const autoSize = Math.min(10000, Math.round(result.data.length * 0.25));
                    set((state) => ({
                        samplingConfig: { ...state.samplingConfig, enabled: true, sampleSize: autoSize }
                    }));
                    get().computeSample();
                }
            } else {
                // Fallback to fetching data separately
                console.log('[uploadDrillhole] No data in response, fetching separately...');
                await get().fetchColumns();
                await get().fetchData();
                set({ isLoading: false, uploadProgress: 0 });
                // Generate geochem mappings from fetched columns
                const cols = get().columns;
                const columnNames = cols.map(c => c.name);
                const mappings = createGeochemMappings(columnNames, cols);
                set({ geochemMappings: mappings, showGeochemDialog: true });
                // Auto-sync to QGIS
                get().syncToQgis();
            }
        } catch (err: any) {
            const message = err.response?.data?.detail || err.message;
            set({ error: message, isLoading: false, uploadProgress: 0 });
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
            const newData = state.data.map(row => ({
                ...row,
                [column]: convertValueForType(row[column], newType, treatNegativeAsZero)
            }));

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
            const newData = state.data.map(row => {
                const updatedRow = { ...row };
                columnNames.forEach(colName => {
                    updatedRow[colName] = convertValueForType(row[colName], newType, treatNegativeAsZero);
                });
                return updatedRow;
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
            samplingConfig: { ...state.samplingConfig, enabled }
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

        set({ isSampling: true });
        try {
            const result = await dataApi.computeSample({
                sample_size: samplingConfig.sampleSize,
                method: samplingConfig.method,
                outlier_columns: samplingConfig.outlierColumns,
                classification_column: samplingConfig.classificationColumn,
                drillhole_column: samplingConfig.drillholeColumn,
                iqr_multiplier: samplingConfig.iqrMultiplier,
                seed: samplingConfig.seed,
            });

            set({
                sampleIndices: new Set(result.indices),
                samplingResult: {
                    totalRows: result.total_rows,
                    sampleSize: result.sample_size,
                    outlierCount: result.outlier_count,
                    method: result.method,
                },
                isSampling: false,
            });
            console.log(`[computeSample] Sample: ${result.sample_size}/${result.total_rows} rows (${result.outlier_count} outliers preserved)`);
        } catch (err: any) {
            console.error('[computeSample] Failed:', err);
            set({ isSampling: false });
        }
    },

    clearSample: () => {
        set({
            sampleIndices: null,
            samplingResult: null,
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
    setGeochemMappings: (mappings) => set({ geochemMappings: mappings }),

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
        set((state) => ({
            geochemMappings: state.geochemMappings.map(m => ({ ...m, isConfirmed: true })),
            showGeochemDialog: false,
        }));
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
