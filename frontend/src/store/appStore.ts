import { create } from 'zustand';
import { dataApi, qgisApi } from '../services/api';
import { AttributeState, createAttributeSlice } from './attributeSlice';

interface ColumnInfo {
    name: string;
    type: string;
    role: string | null;
    alias: string | null;
    priority?: number; // Lower = higher priority in dropdowns (1-10)
    transformationType?: 'raw' | 'clr' | 'alr' | 'ilr' | 'plr' | 'slr' | 'chipower' | null; // Which transformation created this column
}

// Column filter options
export type ColumnFilterType = 'all' | 'raw' | 'clr' | 'alr' | 'ilr' | 'plr' | 'slr' | 'chipower';

export const COLUMN_FILTER_LABELS: Record<ColumnFilterType, string> = {
    all: 'All Columns',
    raw: 'Raw Data',
    clr: 'CLR Transformed',
    alr: 'ALR Transformed',
    ilr: 'ILR Transformed',
    plr: 'PLR Transformed',
    slr: 'SLR Transformed',
    chipower: 'Chi-Power Transformed'
};

type PlotType = 'scatter' | 'ternary' | 'spider' | 'map' | 'map3d' | 'downhole' | 'histogram' | 'clr' | 'classification';

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
    currentView: 'import' | 'data' | 'columns' | 'plots' | 'analysis' | 'qaqc' | 'statistics' | 'settings';

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
    setCurrentView: (view: 'import' | 'data' | 'columns' | 'plots' | 'analysis' | 'qaqc' | 'statistics' | 'settings') => void;

    // Plot actions
    addPlot: (type: PlotType) => void;
    removePlot: (id: string) => void;
    setActivePlotId: (id: string) => void;
    getPlotSettings: (plotId: string) => PlotSettings;
    updatePlotSettings: (plotId: string, settings: Partial<PlotSettings>) => void;

    // Data actions
    addColumn: (name: string, values: any[], colType?: string, role?: string, transformationType?: ColumnInfo['transformationType']) => void;

    // QGIS sync
    syncToQgis: () => Promise<void>;
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
                set({
                    data: result.data,
                    columns: result.column_info || [],
                    isLoading: false,
                    uploadProgress: 0
                });
                // Auto-sync to QGIS
                get().syncToQgis();
            } else {
                // Fallback to fetching data separately
                console.log('[uploadFile] No data in response, fetching separately...');
                await get().fetchColumns();
                await get().fetchData();
                set({ isLoading: false, uploadProgress: 0 });
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
                set({
                    data: result.data,
                    columns: result.column_info || [],
                    isLoading: false,
                    uploadProgress: 0
                });
                // Auto-sync to QGIS
                get().syncToQgis();
            } else {
                // Fallback to fetching data separately
                console.log('[uploadDrillhole] No data in response, fetching separately...');
                await get().fetchColumns();
                await get().fetchData();
                set({ isLoading: false, uploadProgress: 0 });
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
            // Convert data values based on new type
            const newData = state.data.map(row => {
                const value = row[column];
                let convertedValue = value;

                if (newType === 'numeric' || newType === 'float' || newType === 'integer') {
                    // Convert to numeric
                    if (value === null || value === undefined || value === '' || value === 'NA' || value === 'N/A' || value === '-') {
                        convertedValue = 0; // Treat null/empty as 0
                    } else if (typeof value === 'string') {
                        // Remove common non-numeric characters and try to parse
                        const cleaned = value.replace(/[<>,%$]/g, '').trim();
                        const parsed = parseFloat(cleaned);
                        if (isNaN(parsed)) {
                            convertedValue = 0; // Failed to parse, treat as 0
                        } else if (parsed < 0 && treatNegativeAsZero) {
                            convertedValue = 0; // Negative values treated as 0
                        } else {
                            convertedValue = newType === 'integer' ? Math.round(parsed) : parsed;
                        }
                    } else if (typeof value === 'number') {
                        if (value < 0 && treatNegativeAsZero) {
                            convertedValue = 0;
                        } else {
                            convertedValue = newType === 'integer' ? Math.round(value) : value;
                        }
                    }
                } else if (newType === 'text' || newType === 'categorical') {
                    // Convert to string
                    convertedValue = value === null || value === undefined ? '' : String(value);
                }

                return {
                    ...row,
                    [column]: convertedValue
                };
            });

            // Update column type
            const newColumns = state.columns.map(col =>
                col.name === column
                    ? { ...col, type: newType }
                    : col
            );

            console.log(`[updateColumnType] Column "${column}" converted to ${newType}`);
            return { data: newData, columns: newColumns };
        });
    },

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
