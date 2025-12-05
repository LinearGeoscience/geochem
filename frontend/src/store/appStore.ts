import { create } from 'zustand';
import { dataApi } from '../services/api';
import { AttributeState, createAttributeSlice } from './attributeSlice';

interface ColumnInfo {
    name: string;
    type: string;
    role: string | null;
    alias: string | null;
    priority?: number; // Lower = higher priority in dropdowns (1-10)
}

type PlotType = 'scatter' | 'ternary' | 'spider' | 'map' | 'map3d' | 'downhole' | 'histogram' | 'clr';

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
    currentView: 'import' | 'data' | 'columns' | 'plots' | 'analysis' | 'settings';

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
    setCurrentView: (view: 'import' | 'data' | 'columns' | 'plots' | 'analysis' | 'settings') => void;

    // Plot actions
    addPlot: (type: PlotType) => void;
    removePlot: (id: string) => void;
    setActivePlotId: (id: string) => void;
    getPlotSettings: (plotId: string) => PlotSettings;
    updatePlotSettings: (plotId: string, settings: Partial<PlotSettings>) => void;

    // Data actions
    addColumn: (name: string, values: any[]) => void;
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

    addColumn: (name, values) => {
        set((state) => {
            const newData = state.data.map((row, i) => ({
                ...row,
                [name]: values[i]
            }));

            const newColumn = {
                name: name,
                type: 'categorical',
                role: 'Classification',
                alias: null
            };

            const columnExists = state.columns.some(c => c.name === name);
            const newColumns = columnExists
                ? state.columns
                : [...state.columns, newColumn];

            return {
                data: newData,
                columns: newColumns
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
            } else {
                // Fallback to fetching data separately
                console.log('[uploadFile] No data in response, fetching separately...');
                await get().fetchColumns();
                await get().fetchData();
                set({ isLoading: false, uploadProgress: 0 });
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
            } else {
                // Fallback to fetching data separately
                console.log('[uploadDrillhole] No data in response, fetching separately...');
                await get().fetchColumns();
                await get().fetchData();
                set({ isLoading: false, uploadProgress: 0 });
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
    }
}));
