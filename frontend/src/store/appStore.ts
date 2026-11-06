import { create } from 'zustand';
import { dataApi, qgisApi } from '../services/api';
import { notify } from './notificationStore';
import { friendlyError } from '../utils/friendlyError';
import { useAttributeStore } from './attributeStore';
import { useAuditStore } from './auditStore';
import { ColumnGeochemMapping } from '../types/associations';
import {
    createGeochemMappings,
    findColumnForOxide,
    findColumnForElement,
    getColumnsByCategory,
} from '../utils/calculations/elementNameNormalizer';
import {
    ColumnarStore,
    ColumnData,
    emptyColumnarStore,
    isNumericColumn,
} from '../types/columnarData';
import {
    rowsToColumnar,
    columnarToRows,
    extractDisplayColumn,
    computeSampleIndicesArray,
    filterEmptyColumns,
} from '../utils/columnarHelpers';
import { analyticalStore, DEFAULT_BDL_FACTOR, parseCensoredValue } from '../utils/censoring';
import { suggestPlotSettings } from '../utils/plotDefaults';

interface ColumnInfo {
    name: string;
    type: string;
    role: string | null;
    alias: string | null;
    priority?: number; // Lower = higher priority in dropdowns (1-10)
    transformationType?: 'raw' | 'clr' | 'alr' | 'ilr' | 'plr' | 'slr' | 'chipower' | 'log-additive' | 'anhydrous' | 'recalculated' | null; // Which transformation created this column
    transformationGroupId?: string; // Group ID for named transformation batches
    /** Counts of "<x" / ">x" values found on import (backend) */
    censored?: { below: number; above: number };
    /** How a derived column was produced (saved with the project for provenance) */
    derivation?: ColumnDerivation;
}

export interface ColumnDerivation {
    kind: 'calculation' | 'transformation' | 'pca' | 'classification' | 'pathfinder' | 'other';
    description: string;
    params?: Record<string, unknown>;
    created: string;
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

export type PlotType = 'scatter' | 'ternary' | 'spider' | 'map' | 'map3d' | 'downhole' | 'histogram' | 'clr' | 'classification' | 'pathfinder' | 'contour' | 'splom' | 'piper' | 'probability' | 'pca' | 'protocols';

/** Display names for plot types (tab titles, New Plot dialog). */
export const PLOT_TYPE_LABEL: Record<PlotType, string> = {
    scatter: 'Scatter', ternary: 'Ternary', spider: 'Spider', map: 'Map', map3d: '3D Map', downhole: 'Downhole',
    histogram: 'Histogram', clr: 'CLR Biplot', classification: 'Classification', pathfinder: 'Pathfinder',
    contour: 'Contour Map', splom: 'Scatter Matrix', piper: 'Piper', probability: 'Probability', pca: 'PCA results', protocols: 'Assay protocols',
};

const newPlotId = () => Math.random().toString(36).slice(2, 11);

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

export interface PlotInstance {
    id: string;
    type: PlotType;
    title: string;
    settings: PlotSettings;
}

export interface SetDatasetOptions {
    /** Saved mappings to use instead of fresh detection (project load). */
    geochemMappings?: ColumnGeochemMapping[];
    /** Open the geochem mapping dialog after loading (uploads). Default false. */
    showGeochemDialog?: boolean;
    /** Drop all-empty columns (and notify). Default true. */
    filterEmpty?: boolean;
    /** Keep current mappings for columns that still exist (merges); detect the rest. */
    preserveMappings?: boolean;
    /** Projection of the East/North columns when the source states it (.gas, project). */
    datasetEpsg?: string | null;
}

interface AppState {
    /**
     * Column metadata. The dataset itself lives ONLY in `columnarData`;
     * row objects are a derived, cached, read-only view (getRows /
     * useDatasetRows) built on demand for legacy consumers.
     */
    columns: ColumnInfo[];
    isLoading: boolean;
    uploadProgress: number; // 0-100
    streamingStatus: string | null; // e.g. "Loading data... 50,000 / 200,000 rows"
    error: string | null;
    currentView: 'welcome' | 'import' | 'data' | 'columns' | 'plots' | 'analysis' | 'qaqc' | 'statistics' | 'settings' | 'diagram-editor' | 'report';

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
    /** Projection of the dataset's East/North columns ('EPSG:28350'); null = unknown / local grid */
    datasetEpsg: string | null;
    setDatasetEpsg: (epsg: string | null) => void;
    setLockAxes: (locked: boolean) => void;
    lockFullExtent: boolean;
    setLockFullExtent: (locked: boolean) => void;

    // Analysis state
    statsSelectedColumns: string[];
    correlationSelectedColumns: string[];
    setStatsSelectedColumns: (columns: string[]) => void;
    setCorrelationSelectedColumns: (columns: string[]) => void;

    /**
     * The single entry point for replacing the dataset (uploads, imports,
     * project load, merges). Builds the columnar store, resets sampling and
     * selection, and (re)creates geochem mappings. Returns the kept columns.
     */
    setDataset: (rows: any[], columnInfo: ColumnInfo[], options?: SetDatasetOptions) => ColumnInfo[];
    /** setDataset for an already-built columnar store (project load). filterEmpty is ignored. */
    setColumnarDataset: (store: ColumnarStore, columnInfo: ColumnInfo[], options?: SetDatasetOptions) => ColumnInfo[];
    uploadFile: (file: File, sheet?: string) => Promise<void>;
    /** Last workbook imported when it has several sheets (Data Import offers the others) */
    lastWorkbook: { file: File; sheets: string[]; sheet: string } | null;
    uploadDrillhole: (collar: File, survey: File, assay: File) => Promise<void>;
    updateColumn: (column: string, role?: string, alias?: string) => Promise<void>;
    updateColumnType: (column: string, newType: string, treatNegativeAsZero?: boolean) => void;
    updateColumnTypes: (columns: string[], newType: string, treatNegativeAsZero?: boolean) => void;
    /**
     * Merge text values that differ only in case/whitespace ("Abra", "ABRA",
     * "abra ") into their most frequent spelling. Returns cells changed.
     */
    tidyCategoryValues: (columns: string[]) => number;
    setCurrentView: (view: 'welcome' | 'import' | 'data' | 'columns' | 'plots' | 'analysis' | 'qaqc' | 'statistics' | 'settings' | 'diagram-editor' | 'report') => void;

    // Plot actions
    /** Add a plot (optionally with initial settings/title), make it active, return its id. */
    addPlot: (type: PlotType, init?: { settings?: Record<string, any>; title?: string }) => string;
    /** Change a plot in place (type, title, settings replaced wholesale when given). */
    replacePlot: (id: string, patch: { type?: PlotType; title?: string; settings?: Record<string, any> }) => void;
    removePlot: (id: string) => void;
    renamePlot: (id: string, title: string) => void;
    /** Deep-copies settings; the copy is inserted after the original and activated. */
    duplicatePlot: (id: string) => string | null;
    setActivePlotId: (id: string) => void;
    getPlotSettings: (plotId: string) => PlotSettings;
    updatePlotSettings: (plotId: string, settings: Partial<PlotSettings>) => void;

    // Data actions
    addColumn: (name: string, values: any[], colType?: string, role?: string, transformationType?: ColumnInfo['transformationType'], transformationGroupId?: string, derivation?: ColumnDerivation) => void;
    /** Replace the values of an existing column, keeping its metadata (type, role, alias...). */
    updateColumnValues: (name: string, values: ArrayLike<any>) => void;
    savePaintGroupsToColumn: (columnName: string) => void;
    /**
     * Several column edits as one change (one undo step): replace values
     * (numeric: store as numbers, converting text columns), add numeric
     * columns (element mappings detected for them).
     */
    applyColumnEdits: (edits: {
        replace?: Array<{ name: string; values: ArrayLike<any>; numeric: boolean }>;
        /**
         * New numeric columns (element-mapped, so censorable when the name says an element).
         * `replace: true` overwrites an earlier result of the same name (values + derivation).
         * `mapAs`: copy that column's element mapping (same element / unit, censorable like it)
         * instead of detecting one from the new name.
         */
        add?: Array<{ name: string; values: ArrayLike<any>; derivation?: ColumnDerivation; replace?: boolean; mapAs?: string }>;
    }) => void;

    // Sampling
    samplingConfig: SamplingConfig;
    samplingResult: SamplingResult | null;
    sampleIndices: Set<number> | null;
    isSampling: boolean;
    samplingError: string | null;
    setSamplingEnabled: (enabled: boolean) => void;
    updateSamplingConfig: (partial: Partial<SamplingConfig>) => void;
    computeSample: () => Promise<void>;
    syncBackendData: (force?: boolean) => Promise<void>;
    clearSample: () => void;
    /** Row objects for the displayed (sampled) rows — derived and cached. Prefer column accessors. */
    getDisplayData: () => any[];
    /** Original row indices of the displayed rows, or null when not sampling. */
    getDisplayIndices: () => number[] | null;
    /**
     * All rows as objects (analytical values: below-detection values
     * substituted) — derived and cached. Read-only.
     */
    getRows: () => any[];
    /** All rows with values exactly as stored (-DL for below detection). For grid/export/save. */
    getRawRows: () => any[];

    // Columnar storage — the single source of truth for the dataset.
    // Stored values follow the standard convention (-DL = below detection);
    // the accessors below return ANALYTICAL values (see utils/censoring).
    columnarData: ColumnarStore;
    _sampleIndicesArray: number[] | null; // sorted array version of sampleIndices
    /** Substitution for below-detection values: |value| × factor, or null = missing. */
    bdlFactor: number | null;
    setBdlFactor: (factor: number | null) => void;
    /** The columnar store with below-detection values substituted (cached). */
    getAnalyticalStore: () => ColumnarStore;
    /** A column exactly as stored. */
    getRawColumn: (name: string) => ColumnData | undefined;
    getColumn: (name: string) => ColumnData | undefined;
    getNumericColumn: (name: string) => Float64Array | undefined;
    getStringColumn: (name: string) => string[] | undefined;
    getDisplayColumn: (name: string) => ColumnData | undefined;
    getRowCount: () => number;

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

// ---------------------------------------------------------------------------
// Derived row views. Rows are built from the columnar store on first request
// and cached per store object (every mutation creates a new store, so stale
// entries simply become unreachable). They are frozen in development so an
// accidental write — which would be silently lost — fails loudly instead.
// ---------------------------------------------------------------------------
const rowsCache = new WeakMap<ColumnarStore, any[]>();
const displayRowsCache = new WeakMap<ColumnarStore, { sample: number[] | null; rows: any[] }>();

function rowsFor(store: ColumnarStore): any[] {
    let rows = rowsCache.get(store);
    if (!rows) {
        rows = columnarToRows(store);
        if (import.meta.env?.DEV) {
            for (const r of rows) Object.freeze(r);
            Object.freeze(rows);
        }
        rowsCache.set(store, rows);
    }
    return rows;
}

function displayRowsFor(store: ColumnarStore, sample: number[] | null): any[] {
    const all = rowsFor(store);
    if (!sample) return all;
    const cached = displayRowsCache.get(store);
    if (cached && cached.sample === sample) return cached.rows;
    const rows = sample.map(i => all[i]);
    displayRowsCache.set(store, { sample, rows });
    return rows;
}

function analyticalOf(state: { columnarData: ColumnarStore; geochemMappings: ColumnGeochemMapping[]; bdlFactor: number | null }) {
    return analyticalStore(state.columnarData, state.geochemMappings, state.bdlFactor);
}

/** Row objects (analytical values) for the current dataset (non-React code). Read-only. */
export function getDatasetRows(): any[] {
    return rowsFor(analyticalOf(useAppStore.getState()));
}

/** React hook: the analytical columnar store (below-detection values substituted). */
export function useAnalyticalStore(): ColumnarStore {
    const raw = useAppStore(s => s.columnarData);
    const mappings = useAppStore(s => s.geochemMappings);
    const factor = useAppStore(s => s.bdlFactor);
    return analyticalStore(raw, mappings, factor);
}

/**
 * React hook: row objects (analytical values) for the current dataset,
 * re-rendering when the dataset, mappings or substitution change. For new
 * code prefer column accessors (getColumn / getDisplayColumn).
 */
export function useDatasetRows(): any[] {
    return rowsFor(useAnalyticalStore());
}

/** React hook: rows exactly as stored (-DL for below detection) — grid, export. */
export function useRawDatasetRows(): any[] {
    return rowsFor(useAppStore(s => s.columnarData));
}

/** React hook: row objects (analytical values) for the displayed (sampled) rows. */
export function useDisplayRows(): any[] {
    const store = useAnalyticalStore();
    const sample = useAppStore(s => s._sampleIndicesArray);
    return displayRowsFor(store, sample);
}

/** Build a column from raw values in the columnar representation for `colType`. */
function toColumnData(values: ArrayLike<any>, colType: string): ColumnData {
    const n = values.length;
    if (colType === 'numeric' || colType === 'float' || colType === 'integer') {
        const arr = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            const v = values[i];
            arr[i] = (v === null || v === undefined || v === '') ? NaN : Number(v);
        }
        return arr;
    }
    const arr: string[] = new Array(n);
    for (let i = 0; i < n; i++) {
        const v = values[i];
        arr[i] = (v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v))) ? '' : String(v);
    }
    return arr;
}

/** A columnar cell as the row view would show it (NaN / '' -> null). */
function cellValue(col: ColumnData | undefined, i: number): any {
    if (!col) return null;
    const v = col[i];
    if (typeof v === 'number') return Number.isNaN(v) ? null : v;
    return v === '' ? null : v;
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
            // "<0.01" -> -0.01 (below detection, standard convention), ">x" -> x
            const parsed = parseCensoredValue(value);
            if (parsed === null) {
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

// The backend keeps its own copy of the dataset (used for sampling). Track
// which columnar snapshot it last received so we can push the frontend's
// copy whenever it has diverged (project load, calculated columns, etc.).
// Column mutations always produce a new columnarData object, so identity
// comparison is sufficient.
let backendSyncedStore: ColumnarStore | null = null;

/**
 * Stream the rows of a just-uploaded file from the backend and install them
 * as the dataset. `result` is the upload endpoint's metadata response.
 */
async function streamIntoDataset(result: any): Promise<ColumnInfo[]> {
    const set = useAppStore.setState;
    const columnInfo: ColumnInfo[] = result.column_info || [];
    const totalRows = result.rows || 0;
    set({ uploadProgress: 50, streamingStatus: `Loading data... 0 / ${totalRows.toLocaleString()} rows` });
    const rows = await dataApi.streamData((loaded, total) => {
        set({
            uploadProgress: 50 + Math.round((loaded / total) * 50), // 50-100% = streaming
            streamingStatus: `Loading data... ${loaded.toLocaleString()} / ${total.toLocaleString()} rows`,
        });
    });
    const kept = useAppStore.getState().setDataset(rows, columnInfo, { showGeochemDialog: true });
    set({ isLoading: false, uploadProgress: 0, streamingStatus: null });
    return kept;
}

/** Post-import housekeeping shared by all upload flows. */
function afterImport() {
    const state = useAppStore.getState();
    state.syncToQgis();
    // Auto-enable sampling for large datasets
    const n = state.columnarData.rowCount;
    if (n > 20000) {
        const autoSize = Math.min(10000, Math.round(n * 0.25));
        // First 5 major oxide / trace element columns are preserved as outliers
        const outlierCols = state.geochemMappings
            .filter(m => m.category === 'majorOxide' || m.category === 'traceElement')
            .slice(0, 5)
            .map(m => m.originalName);
        useAppStore.setState((s) => ({
            samplingConfig: { ...s.samplingConfig, enabled: true, sampleSize: autoSize, outlierColumns: outlierCols },
        }));
        useAppStore.getState().computeSample();
    }
}

export const useAppStore = create<AppState>()((set, get) => ({
    columns: [],
    isLoading: false,
    uploadProgress: 0,
    streamingStatus: null,
    error: null,
    currentView: 'welcome',

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
    lastWorkbook: null,
    datasetEpsg: null,
    setDatasetEpsg: (datasetEpsg) => set({ datasetEpsg }),
    lockFullExtent: false,

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

    // Columnar storage
    columnarData: emptyColumnarStore(),
    _sampleIndicesArray: null,
    bdlFactor: DEFAULT_BDL_FACTOR,
    setBdlFactor: (factor) => set({ bdlFactor: factor }),

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
    setLockFullExtent: (locked) => set({ lockFullExtent: locked }),

    addPlot: (type, init) => {
        const id = newPlotId();
        const title = init?.title ?? `${PLOT_TYPE_LABEL[type] ?? type} ${get().plots.length + 1}`;
        // No explicit settings: seed sensible columns (never IDs/coordinates)
        const settings = init?.settings
            ? { ...init.settings }
            : suggestPlotSettings(type, get().columns, get().geochemMappings);
        set((state) => ({
            plots: [...state.plots, { id, type, title, settings }],
            activePlotId: id
        }));
        return id;
    },

    replacePlot: (id, patch) => {
        set((state) => ({
            plots: state.plots.map(p => (p.id === id ? { ...p, ...patch, settings: patch.settings ?? p.settings } : p)),
        }));
    },

    removePlot: (id) => {
        set((state) => {
            const k = state.plots.findIndex(p => p.id === id);
            if (k < 0) return {};
            const plots = state.plots.filter(p => p.id !== id);
            // Closing the active plot activates its neighbour (next, else previous)
            const activePlotId = state.activePlotId === id
                ? (plots[k] ?? plots[k - 1])?.id ?? null
                : state.activePlotId;
            return { plots, activePlotId };
        });
    },

    renamePlot: (id, title) => {
        const t = title.trim();
        if (!t) return;
        set((state) => ({ plots: state.plots.map(p => (p.id === id ? { ...p, title: t } : p)) }));
    },

    duplicatePlot: (id) => {
        const src = get().plots.find(p => p.id === id);
        if (!src) return null;
        const copy: PlotInstance = { id: newPlotId(), type: src.type, title: `${src.title} (copy)`, settings: structuredClone(src.settings) };
        set((state) => {
            const k = state.plots.findIndex(p => p.id === id);
            const plots = [...state.plots];
            plots.splice(k + 1, 0, copy);
            return { plots, activePlotId: copy.id };
        });
        return copy.id;
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
        const { selectedIndices } = get();
        if (selectedIndices.length === 0) return;
        const affectedCount = selectedIndices.length;

        set((state) => {
            const { columns, columnarData } = state;
            const n = columnarData.rowCount;
            const existing = columnarData.columns.get(columnName);

            const columnExists = columns.some(c => c.name === columnName);
            const newColumns = columnExists
                ? columns
                : [...columns, { name: columnName, type: 'categorical', role: 'Classification', alias: null }];

            // New string column: selected rows get the class, others keep
            // their previous class (or 'Unclassified')
            const strCol: string[] = new Array(n);
            for (let i = 0; i < n; i++) {
                const prev = cellValue(existing, i);
                strCol[i] = prev === null ? 'Unclassified' : String(prev);
            }
            for (const i of selectedIndices) {
                if (i >= 0 && i < n) strCol[i] = className;
            }
            const newColumnarColumns = new Map(columnarData.columns);
            newColumnarColumns.set(columnName, strCol);

            return {
                columns: newColumns,
                columnarData: { ...columnarData, columns: newColumnarColumns },
            };
        });

        useAuditStore.getState().recordAudit({
            category: 'classification',
            operation: 'Assign Class to Selection',
            description: `Assigned class "${className}" to ${affectedCount} selected rows in column "${columnName}"`,
            parameters: { className, columnName },
            outputColumns: [columnName],
            rowsAffected: affectedCount,
        });
    },

    setStatsSelectedColumns: (columns) => set({ statsSelectedColumns: columns }),
    setCorrelationSelectedColumns: (columns) => set({ correlationSelectedColumns: columns }),

    addColumn: (name, values, colType = 'categorical', role = 'Classification', transformationType = null, transformationGroupId, derivation) => {
        set((state) => {
            if (values.length !== state.columnarData.rowCount) {
                console.error(`[addColumn] "${name}" has ${values.length} values for ${state.columnarData.rowCount} rows — ignored`);
                return {};
            }
            const newColumn: ColumnInfo = {
                name: name,
                type: colType,
                role: role,
                alias: null,
                priority: 5,
                transformationType: transformationType,
                ...(transformationGroupId ? { transformationGroupId } : {}),
                ...(derivation ? { derivation } : {}),
            };

            const columnExists = state.columns.some(c => c.name === name);
            const newColumns = columnExists
                ? state.columns.map(c => c.name === name ? { ...c, ...newColumn } : c)
                : [...state.columns, newColumn];

            // Update available filters if this is a new transformation type (skip if in a named group)
            const newAvailableFilters = [...state.availableFilters];
            if (transformationType && !transformationGroupId && !newAvailableFilters.includes(transformationType)) {
                newAvailableFilters.push(transformationType);
            }

            const newColumnarColumns = new Map(state.columnarData.columns);
            newColumnarColumns.set(name, toColumnData(values, colType));

            return {
                columns: newColumns,
                availableFilters: newAvailableFilters,
                columnarData: { ...state.columnarData, columns: newColumnarColumns },
            };
        });
    },

    updateColumnValues: (name, values) => {
        set((state) => {
            const info = state.columns.find(c => c.name === name);
            if (!info || values.length !== state.columnarData.rowCount) {
                console.error(`[updateColumnValues] unknown column or wrong length: ${name}`);
                return {};
            }
            const newColumnarColumns = new Map(state.columnarData.columns);
            newColumnarColumns.set(name, toColumnData(values, info.type));
            return { columnarData: { ...state.columnarData, columns: newColumnarColumns } };
        });
    },

    applyColumnEdits: ({ replace = [], add = [] }) => {
        set((state) => {
            const n = state.columnarData.rowCount;
            const data = new Map(state.columnarData.columns);
            const numericTypes = new Set(['numeric', 'float', 'integer']);
            const retyped = new Map<string, string>();
            for (const r of replace) {
                const info = state.columns.find(c => c.name === r.name);
                if (!info || r.values.length !== n) continue;
                const type = r.numeric && !numericTypes.has(info.type) ? 'float' : info.type;
                if (type !== info.type) retyped.set(r.name, type);
                data.set(r.name, toColumnData(r.values, type));
            }
            const added: ColumnInfo[] = [];
            const rederived = new Map<string, ColumnDerivation | undefined>();
            const mapAs = new Map<string, string>();
            for (const a of add) if (a.mapAs) mapAs.set(a.name, a.mapAs);
            for (const a of add) {
                if (a.values.length !== n) continue;
                if (data.has(a.name)) {
                    if (!a.replace) continue;
                    data.set(a.name, toColumnData(a.values, 'float'));
                    rederived.set(a.name, a.derivation);
                    continue;
                }
                data.set(a.name, toColumnData(a.values, 'float'));
                added.push({
                    name: a.name, type: 'float', role: null, alias: null, priority: 5, transformationType: null,
                    ...(a.derivation ? { derivation: a.derivation } : {}),
                });
            }
            const columns = [
                ...state.columns.map(c => {
                    let out = retyped.has(c.name) ? { ...c, type: retyped.get(c.name)! } : c;
                    if (rederived.has(c.name)) {
                        const d = rederived.get(c.name);
                        out = { ...out, type: 'float' };
                        if (d) out = { ...out, derivation: d };
                    }
                    return out;
                }),
                ...added,
            ];
            // Mappings: copied from the named source, else detected from the name
            let geochemMappings = state.geochemMappings;
            const copied = (name: string) => {
                const src = mapAs.has(name) ? state.geochemMappings.find(m => m.originalName === mapAs.get(name)) : undefined;
                return src ? { ...src, originalName: name } : null;
            };
            const touched = [...added.map(c => c.name), ...[...rederived.keys()].filter(k => mapAs.has(k))];
            if (touched.length) {
                const fresh = added.filter(c => !copied(c.name));
                const detected = fresh.length ? createGeochemMappings(fresh.map(c => c.name), fresh) : [];
                const copies = touched.map(copied).filter((m): m is NonNullable<typeof m> => !!m);
                const names = new Set(copies.map(m => m.originalName));
                geochemMappings = [...state.geochemMappings.filter(m => !names.has(m.originalName)), ...detected, ...copies];
            }
            return {
                columns,
                columnarData: { ...state.columnarData, columns: data },
                ...(geochemMappings !== state.geochemMappings ? { geochemMappings } : {}),
            };
        });
    },

    savePaintGroupsToColumn: (columnName) => {
        const { columnarData, addColumn } = get();
        const n = columnarData.rowCount;
        const { customEntries } = useAttributeStore.getState();
        const values: string[] = new Array(n).fill('Unclassified');
        for (const entry of customEntries) {
            for (const idx of entry.assignedIndices) {
                if (idx >= 0 && idx < n) {
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

    setDataset: (rows, columnInfo, options = {}) => {
        const kept = options.filterEmpty ?? true ? filterEmptyColumns(rows, columnInfo) : columnInfo;
        return get().setColumnarDataset(rowsToColumnar(rows, kept), kept, options);
    },

    setColumnarDataset: (columnarData, columnInfo, options = {}) => {
        const { showGeochemDialog = false } = options;
        // Keep only columns that exist in the store (in columnInfo order)
        const kept = columnInfo.filter(c => columnarData.columns.has(c.name));
        let geochemMappings = options.geochemMappings
            ?? createGeochemMappings(kept.map(c => c.name), kept);
        if (options.preserveMappings) {
            const previous = new Map(get().geochemMappings.map(m => [m.originalName, m] as const));
            geochemMappings = geochemMappings.map(m => previous.get(m.originalName) ?? m);
        }
        set({
            columns: kept,
            columnarData,
            geochemMappings,
            showGeochemDialog,
            selectedIndices: [],
            sampleIndices: null,
            _sampleIndicesArray: null,
            samplingResult: null,
            // A new dataset starts unprojected unless the caller knows (merges keep it)
            datasetEpsg: options.preserveMappings ? get().datasetEpsg : options.datasetEpsg ?? null,
        });
        return kept;
    },

    uploadFile: async (file: File, sheet?: string) => {
        set({ isLoading: true, uploadProgress: 0, error: null, streamingStatus: null });
        try {
            // Phase 1: Upload file → get metadata (no data in response)
            const result = await dataApi.uploadFile(file, (progress) => {
                set({ uploadProgress: Math.round(progress * 0.5) }); // 0-50% = upload
            }, sheet);
            const sheets: string[] = result.sheets ?? [];
            set({ lastWorkbook: sheets.length > 1 ? { file, sheets, sheet: result.sheet } : null });
            if (sheets.length > 1 && !sheet) {
                notify(`Loaded sheet "${result.sheet}" (1 of ${sheets.length}). Pick another sheet in Data Import.`, 'info');
            }
            if (result.skipped_lines > 0) {
                notify(`${result.skipped_lines.toLocaleString()} malformed line(s) in "${file.name}" were skipped`, 'warning');
            }
            const kept = await streamIntoDataset(result);
            useAuditStore.getState().recordAudit({
                category: 'import',
                operation: 'File Import',
                description: `Imported file "${file.name}" with ${get().columnarData.rowCount.toLocaleString()} rows and ${kept.length} columns`,
                parameters: { fileName: file.name },
                outputColumns: kept.map(c => c.name),
                rowsAffected: get().columnarData.rowCount,
            });
            afterImport();
        } catch (err: any) {
            const message = friendlyError(err, 'Upload failed');
            notify(message, 'error');
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
            const kept = await streamIntoDataset(result);
            const n = get().columnarData.rowCount;
            useAuditStore.getState().recordAudit({
                category: 'import',
                operation: 'Drillhole Import',
                description: `Imported drillhole data from collar "${collar.name}", survey "${survey.name}", assay "${assay.name}" with ${n.toLocaleString()} intervals and ${kept.length} columns`,
                parameters: { collarFile: collar.name, surveyFile: survey.name, assayFile: assay.name },
                outputColumns: kept.map(c => c.name),
                rowsAffected: n,
            });
            afterImport();
        } catch (err: any) {
            const message = friendlyError(err, 'Drillhole import failed');
            notify(message, 'error');
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

    // treatNegativeAsZero defaults to false: negative values in assay columns
    // are below-detection markers (-DL) and must survive a type change.
    updateColumnType: (column: string, newType: string, treatNegativeAsZero: boolean = false) => {
        get().updateColumnTypes([column], newType, treatNegativeAsZero);
    },

    tidyCategoryValues: (columnNames: string[]) => {
        const { columnarData } = get();
        const newColumns = new Map(columnarData.columns);
        let changed = 0;
        const merges: string[] = [];
        for (const name of columnNames) {
            const col = columnarData.columns.get(name);
            if (!col || isNumericColumn(col)) continue;
            // Count spellings per normalised key, pick the most frequent
            const counts = new Map<string, Map<string, number>>();
            for (const v of col) {
                if (v === '') continue;
                const key = v.trim().replace(/\s+/g, ' ').toLowerCase();
                const spellings = counts.get(key) ?? new Map<string, number>();
                spellings.set(v, (spellings.get(v) ?? 0) + 1);
                counts.set(key, spellings);
            }
            const canonical = new Map<string, string>();
            for (const spellings of counts.values()) {
                if (spellings.size < 2) continue;
                const best = [...spellings.entries()].sort((a, b) => b[1] - a[1])[0][0].trim();
                for (const s of spellings.keys()) if (s !== best) canonical.set(s, best);
                merges.push(`${[...spellings.keys()].join(' / ')} → ${best}`);
            }
            if (canonical.size === 0) continue;
            const out = col.map(v => {
                const c = canonical.get(v);
                if (c !== undefined) { changed++; return c; }
                return v;
            });
            newColumns.set(name, out);
        }
        if (changed > 0) {
            set({ columnarData: { ...columnarData, columns: newColumns } });
            useAuditStore.getState().recordAudit({
                category: 'column-operation',
                operation: 'Tidy Category Values',
                description: `Merged case/whitespace variants in ${columnNames.join(', ')}: ${merges.join('; ')}`,
                parameters: { merges },
                inputColumns: columnNames,
                outputColumns: columnNames,
                rowsAffected: changed,
            });
        }
        return changed;
    },

    updateColumnTypes: (columnNames: string[], newType: string, treatNegativeAsZero: boolean = false) => {
        const { columnarData } = get();
        const n = columnarData.rowCount;
        const nameSet = new Set(columnNames);
        const newColumnarColumns = new Map(columnarData.columns);
        for (const colName of columnNames) {
            const existing = columnarData.columns.get(colName);
            const converted = new Array(n);
            for (let i = 0; i < n; i++) {
                converted[i] = convertValueForType(cellValue(existing, i), newType, treatNegativeAsZero);
            }
            newColumnarColumns.set(colName, toColumnData(converted, newType));
        }
        set((state) => ({
            columns: state.columns.map(col => nameSet.has(col.name) ? { ...col, type: newType } : col),
            columnarData: { ...state.columnarData, columns: newColumnarColumns },
        }));

        const single = columnNames.length === 1;
        useAuditStore.getState().recordAudit({
            category: 'column-operation',
            operation: single ? 'Column Type Change' : 'Batch Column Type Change',
            description: single
                ? `Changed column "${columnNames[0]}" type to ${newType}`
                : `Changed ${columnNames.length} columns to ${newType}`,
            parameters: { newType, treatNegativeAsZero },
            inputColumns: columnNames,
            outputColumns: columnNames,
            rowsAffected: n,
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
        const { columnarData, samplingConfig } = get();
        const rowCount = columnarData.rowCount;
        if (!samplingConfig.enabled || rowCount === 0) {
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
            // Make sure the backend holds the same dataset as the frontend.
            // Backend-restart recovery (sync-and-retry) is additionally
            // handled globally by the api.ts response interceptor.
            await get().syncBackendData();
            let result = await dataApi.computeSample(sampleParams);
            if (result.total_rows !== rowCount) {
                // Backend copy is stale (e.g. edited elsewhere) — force a resync once
                await get().syncBackendData(true);
                result = await dataApi.computeSample(sampleParams);
                if (result.total_rows !== rowCount) {
                    throw new Error(`Backend row count (${result.total_rows}) does not match loaded data (${rowCount})`);
                }
            }

            const newSampleIndices = new Set(result.indices);
            set({
                sampleIndices: newSampleIndices,
                _sampleIndicesArray: computeSampleIndicesArray(newSampleIndices),
                samplingResult: {
                    totalRows: result.total_rows,
                    sampleSize: result.sample_size,
                    outlierCount: result.outlier_count,
                    method: result.method,
                },
                isSampling: false,
                samplingError: null,
            });

            useAuditStore.getState().recordAudit({
                category: 'sampling',
                operation: 'Data Sampling',
                description: `Computed ${samplingConfig.method} sample: ${result.sample_size.toLocaleString()} of ${result.total_rows.toLocaleString()} rows (${((result.sample_size / result.total_rows) * 100).toFixed(1)}%). ${result.outlier_count} outliers preserved.`,
                parameters: { method: samplingConfig.method, sampleSize: samplingConfig.sampleSize, iqrMultiplier: samplingConfig.iqrMultiplier },
                rowsAffected: result.sample_size,
            });
        } catch (err: any) {
            console.error('[computeSample] Failed:', err);
            const detail = err?.response?.data?.detail || err?.message || 'Sampling failed';
            set({ isSampling: false, samplingError: detail });
        }
    },

    syncBackendData: async (force = false) => {
        const { columnarData, columns } = get();
        if (!force && backendSyncedStore === columnarData) return;
        if (columnarData.rowCount === 0) return;
        // Column-wise payload (stored values, NaN/'' -> null), in column order
        const payload: Record<string, (number | string | null)[]> = {};
        for (const c of columns) {
            const col = columnarData.columns.get(c.name);
            if (!col) continue;
            payload[c.name] = isNumericColumn(col)
                ? Array.from(col, v => (Number.isNaN(v) ? null : v))
                : col.map(v => (v === '' ? null : v));
        }
        await dataApi.syncColumns(payload);
        backendSyncedStore = columnarData;
    },

    clearSample: () => {
        set({
            sampleIndices: null,
            _sampleIndicesArray: null,
            samplingResult: null,
            samplingError: null,
            samplingConfig: { ...get().samplingConfig, enabled: false },
        });
    },

    getDisplayData: () => {
        return displayRowsFor(analyticalOf(get()), get()._sampleIndicesArray);
    },

    getDisplayIndices: () => get()._sampleIndicesArray,

    getRows: () => rowsFor(analyticalOf(get())),
    getRawRows: () => rowsFor(get().columnarData),
    getAnalyticalStore: () => analyticalOf(get()),
    getRawColumn: (name) => get().columnarData.columns.get(name),

    // Columnar storage accessors
    getColumn: (name) => analyticalOf(get()).columns.get(name),

    getNumericColumn: (name) => {
        const col = analyticalOf(get()).columns.get(name);
        return col && isNumericColumn(col) ? col : undefined;
    },

    getStringColumn: (name) => {
        const col = analyticalOf(get()).columns.get(name);
        return col && Array.isArray(col) ? col : undefined;
    },

    getDisplayColumn: (name) => {
        return extractDisplayColumn(analyticalOf(get()), name, get()._sampleIndicesArray);
    },

    getRowCount: () => get().columnarData.rowCount,

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
        const { columnarData, columns } = get();
        if (columnarData.rowCount === 0) return;
        try {
            // QGIS reads rows from the backend dataset; only push column metadata
            await get().syncBackendData();
            await qgisApi.syncData(undefined, columns);
        } catch (err) {
            console.warn('[syncToQgis] Failed to sync (QGIS integration may not be running):', err);
        }
    }
}));
