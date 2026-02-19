import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { qgisApi } from '../services/api';

// ============================================================================
// Types
// ============================================================================

export type ClassificationMethod = 'equal' | 'quantile' | 'jenks' | 'categorical' | 'manual';
export type AttributeType = 'color' | 'shape' | 'size' | 'filter';
export type EmphasisMode = 'linear' | 'percentile' | 'category';

// High Grade Emphasis configuration
export interface EmphasisConfig {
    enabled: boolean;
    column: string | null;        // Column to use for emphasis (null = use color field)
    mode: EmphasisMode;           // How to calculate emphasis
    threshold: number;            // 0-100, values above this percentile are fully emphasized
    minOpacity: number;           // 0.05-0.5, opacity for lowest values
    boostSize: boolean;           // Whether to increase high-grade point sizes
    sizeBoostFactor: number;      // e.g., 1.5 = 50% bigger for high grades
}

export interface AttributeEntry {
    id: string;
    name: string;
    isDefault: boolean;
    isCustom: boolean;
    visible: boolean;

    // Entry type
    type: 'default' | 'range' | 'category' | 'custom';

    // For range entries
    min?: number;
    max?: number;

    // For category entries
    categoryValue?: string;

    // Visual attributes
    color?: string;
    shape?: string;
    size?: number;
    opacity?: number;

    // For custom entries - manually assigned data point indices
    assignedIndices: number[];

    // Computed stats (updated from data)
    rowCount: number;
    visibleRowCount: number;
}

export interface AttributeConfig {
    field: string | null;
    method: ClassificationMethod;
    numClasses: number;
    palette: string;
    entries: AttributeEntry[];
}

export interface AttributeState {
    // Per-tab configuration
    color: AttributeConfig;
    shape: AttributeConfig;
    size: AttributeConfig;
    filter: AttributeConfig;

    // Custom entries (shared across tabs by name)
    customEntries: AttributeEntry[];

    // Multi-selection support
    selectedEntryNames: string[];

    // Active tab
    activeTab: AttributeType;

    // Global settings
    globalOpacity: number;

    // High Grade Emphasis
    emphasis: EmphasisConfig;

    // Recent colors used
    recentColors: string[];

    // Actions
    setActiveTab: (tab: AttributeType) => void;
    setField: (tab: AttributeType, field: string | null) => void;
    setMethod: (tab: AttributeType, method: ClassificationMethod) => void;
    setNumClasses: (tab: AttributeType, num: number) => void;
    setPalette: (tab: AttributeType, palette: string) => void;
    setEntries: (tab: AttributeType, entries: AttributeEntry[]) => void;

    // Entry management
    addEntry: (tab: AttributeType, entry: AttributeEntry) => void;
    updateEntry: (tab: AttributeType, entryId: string, updates: Partial<AttributeEntry>) => void;
    removeEntry: (tab: AttributeType, entryId: string) => void;
    removeAllEntries: (tab: AttributeType) => void;
    removeGlobalEntries: () => void;

    // Custom entries
    addCustomEntry: (entry: AttributeEntry) => void;
    updateCustomEntry: (entryId: string, updates: Partial<AttributeEntry>) => void;
    removeCustomEntry: (entryId: string) => void;

    // Selection (multi-select)
    setSelectedEntryNames: (names: string[]) => void;
    toggleSelectedEntryName: (name: string) => void;
    selectEntryRange: (name: string, allNames: string[]) => void;
    clearSelection: () => void;
    /** @deprecated Use setSelectedEntryNames instead */
    setSelectedEntryName: (name: string | null) => void;
    assignIndicesToEntry: (entryName: string, indices: number[]) => void;
    clearEntryAssignments: (entryName: string) => void;

    // Batch operations
    batchUpdateEntries: (tab: AttributeType, entryNames: string[], updates: Partial<AttributeEntry>) => void;
    batchDeleteEntries: (tab: AttributeType, entryNames: string[]) => void;
    batchToggleVisibility: (tab: AttributeType, entryNames: string[], visible: boolean) => void;

    // Size scaling
    scaleAllSizes: (tab: AttributeType, factor: number) => void;

    // Recent colors
    addRecentColor: (color: string) => void;

    // Visibility
    setEntryVisibility: (tab: AttributeType, entryId: string, visible: boolean) => void;
    setAllVisible: (tab: AttributeType, visible: boolean) => void;
    toggleEntryVisibility: (tab: AttributeType, entryId: string) => void;

    // Global
    setGlobalOpacity: (opacity: number) => void;

    // Emphasis
    setEmphasisEnabled: (enabled: boolean) => void;
    setEmphasisColumn: (column: string | null) => void;
    setEmphasisMode: (mode: EmphasisMode) => void;
    setEmphasisThreshold: (threshold: number) => void;
    setEmphasisMinOpacity: (opacity: number) => void;
    setEmphasisBoostSize: (boost: boolean) => void;
    setEmphasisSizeBoostFactor: (factor: number) => void;

    // Stats
    updateRowCounts: (tab: AttributeType, counts: Record<string, { total: number; visible: number }>) => void;

    // Persistence
    exportState: () => string;
    importState: (json: string) => boolean;

    // Get combined entries (field-based + custom) for a tab
    getCombinedEntries: (tab: AttributeType) => AttributeEntry[];

    // Get entry by name across all sources
    getEntryByName: (name: string) => AttributeEntry | null;

    // QGIS sync
    syncStylesToQgis: () => Promise<void>;
}

// ============================================================================
// Default Values
// ============================================================================

const createDefaultEntry = (type: AttributeType): AttributeEntry => ({
    id: `default-${type}`,
    name: type === 'color' ? 'Default Colour' :
          type === 'shape' ? 'Default Shape' :
          type === 'size' ? 'Default Size' : 'Default Filter',
    isDefault: true,
    isCustom: false,
    visible: true,
    type: 'default',
    color: type === 'color' ? '#1f77b4' : undefined,
    shape: type === 'shape' ? 'circle' : undefined,
    size: type === 'size' ? 8 : undefined,
    opacity: 1.0,
    assignedIndices: [],
    rowCount: 0,
    visibleRowCount: 0,
});

const createDefaultConfig = (type: AttributeType): AttributeConfig => ({
    field: null,
    method: 'categorical',
    numClasses: 5,
    palette: 'Jet',
    entries: [createDefaultEntry(type)],
});

// ============================================================================
// Store
// ============================================================================

export const useAttributeStore = create<AttributeState>()(
    persist(
        (set, get) => ({
            // Initial state
            color: createDefaultConfig('color'),
            shape: createDefaultConfig('shape'),
            size: createDefaultConfig('size'),
            filter: createDefaultConfig('filter'),
            customEntries: [],
            selectedEntryNames: [],
            activeTab: 'color',
            globalOpacity: 1.0,
            recentColors: [],
            emphasis: {
                enabled: false,
                column: null,
                mode: 'category',
                threshold: 75,
                minOpacity: 0.15,
                boostSize: true,
                sizeBoostFactor: 1.5,
            },

            // Tab management
            setActiveTab: (tab) => set({ activeTab: tab }),

            // Config setters
            setField: (tab, field) => set((state) => ({
                [tab]: { ...state[tab], field }
            })),

            setMethod: (tab, method) => set((state) => ({
                [tab]: { ...state[tab], method }
            })),

            setNumClasses: (tab, numClasses) => set((state) => ({
                [tab]: { ...state[tab], numClasses: Math.max(2, Math.min(20, numClasses)) }
            })),

            setPalette: (tab, palette) => set((state) => ({
                [tab]: { ...state[tab], palette }
            })),

            setEntries: (tab, entries) => set((state) => ({
                [tab]: { ...state[tab], entries }
            })),

            // Entry management
            addEntry: (tab, entry) => set((state) => ({
                [tab]: {
                    ...state[tab],
                    entries: [...state[tab].entries, entry]
                }
            })),

            updateEntry: (tab, entryId, updates) => set((state) => ({
                [tab]: {
                    ...state[tab],
                    entries: state[tab].entries.map(e =>
                        e.id === entryId ? { ...e, ...updates } : e
                    )
                }
            })),

            removeEntry: (tab, entryId) => set((state) => ({
                [tab]: {
                    ...state[tab],
                    entries: state[tab].entries.filter(e => e.id !== entryId || e.isDefault)
                }
            })),

            removeAllEntries: (tab) => set((state) => ({
                [tab]: {
                    ...state[tab],
                    field: null,
                    entries: [createDefaultEntry(tab)]
                }
            })),

            removeGlobalEntries: () => set({
                color: createDefaultConfig('color'),
                shape: createDefaultConfig('shape'),
                size: createDefaultConfig('size'),
                filter: createDefaultConfig('filter'),
                customEntries: [],
                selectedEntryNames: [],
            }),

            // Custom entries
            addCustomEntry: (entry) => set((state) => ({
                customEntries: [...state.customEntries, { ...entry, isCustom: true }]
            })),

            updateCustomEntry: (entryId, updates) => set((state) => ({
                customEntries: state.customEntries.map(e =>
                    e.id === entryId ? { ...e, ...updates } : e
                )
            })),

            removeCustomEntry: (entryId) => set((state) => ({
                customEntries: state.customEntries.filter(e => e.id !== entryId)
            })),

            // Selection (multi-select)
            setSelectedEntryNames: (names) => set({ selectedEntryNames: names }),

            toggleSelectedEntryName: (name) => set((state) => {
                const current = state.selectedEntryNames;
                if (current.includes(name)) {
                    return { selectedEntryNames: current.filter(n => n !== name) };
                }
                return { selectedEntryNames: [...current, name] };
            }),

            selectEntryRange: (name, allNames) => set((state) => {
                const current = state.selectedEntryNames;
                const lastSelected = current.length > 0 ? current[current.length - 1] : null;
                if (!lastSelected) {
                    return { selectedEntryNames: [name] };
                }
                const startIdx = allNames.indexOf(lastSelected);
                const endIdx = allNames.indexOf(name);
                if (startIdx === -1 || endIdx === -1) {
                    return { selectedEntryNames: [name] };
                }
                const min = Math.min(startIdx, endIdx);
                const max = Math.max(startIdx, endIdx);
                const rangeNames = allNames.slice(min, max + 1);
                const merged = [...new Set([...current, ...rangeNames])];
                return { selectedEntryNames: merged };
            }),

            clearSelection: () => set({ selectedEntryNames: [] }),

            // Backward compat
            setSelectedEntryName: (name) => set({ selectedEntryNames: name ? [name] : [] }),

            assignIndicesToEntry: (entryName, indices) => set((state) => {
                // Find and update the custom entry with this name
                const customEntry = state.customEntries.find(e => e.name === entryName);
                if (customEntry) {
                    return {
                        customEntries: state.customEntries.map(e =>
                            e.name === entryName
                                ? { ...e, assignedIndices: [...new Set([...e.assignedIndices, ...indices])] }
                                : e
                        )
                    };
                }
                return state;
            }),

            clearEntryAssignments: (entryName) => set((state) => ({
                customEntries: state.customEntries.map(e =>
                    e.name === entryName ? { ...e, assignedIndices: [] } : e
                )
            })),

            // Batch operations
            batchUpdateEntries: (tab, entryNames, updates) => set((state) => {
                const nameSet = new Set(entryNames);
                return {
                    [tab]: {
                        ...state[tab],
                        entries: state[tab].entries.map(e =>
                            nameSet.has(e.name) && !e.isDefault ? { ...e, ...updates } : e
                        ),
                    },
                    customEntries: state.customEntries.map(e =>
                        nameSet.has(e.name) ? { ...e, ...updates } : e
                    ),
                };
            }),

            batchDeleteEntries: (tab, entryNames) => set((state) => {
                const nameSet = new Set(entryNames);
                return {
                    [tab]: {
                        ...state[tab],
                        entries: state[tab].entries.filter(e => !nameSet.has(e.name) || e.isDefault),
                    },
                    customEntries: state.customEntries.filter(e => !nameSet.has(e.name)),
                    selectedEntryNames: [],
                };
            }),

            batchToggleVisibility: (tab, entryNames, visible) => set((state) => {
                const nameSet = new Set(entryNames);
                return {
                    [tab]: {
                        ...state[tab],
                        entries: state[tab].entries.map(e =>
                            nameSet.has(e.name) ? { ...e, visible } : e
                        ),
                    },
                    customEntries: state.customEntries.map(e =>
                        nameSet.has(e.name) ? { ...e, visible } : e
                    ),
                };
            }),

            // Size scaling
            scaleAllSizes: (tab, factor) => set((state) => ({
                [tab]: {
                    ...state[tab],
                    entries: state[tab].entries.map(e => ({
                        ...e,
                        size: e.size ? Math.max(2, Math.min(30, Math.round(e.size * factor))) : e.size,
                    })),
                },
            })),

            // Recent colors
            addRecentColor: (color) => set((state) => {
                const filtered = state.recentColors.filter(c => c !== color);
                return { recentColors: [color, ...filtered].slice(0, 8) };
            }),

            // Visibility
            setEntryVisibility: (tab, entryId, visible) => set((state) => ({
                [tab]: {
                    ...state[tab],
                    entries: state[tab].entries.map(e =>
                        e.id === entryId ? { ...e, visible } : e
                    )
                }
            })),

            setAllVisible: (tab, visible) => set((state) => ({
                [tab]: {
                    ...state[tab],
                    entries: state[tab].entries.map(e => ({ ...e, visible }))
                }
            })),

            toggleEntryVisibility: (tab, entryId) => set((state) => ({
                [tab]: {
                    ...state[tab],
                    entries: state[tab].entries.map(e =>
                        e.id === entryId ? { ...e, visible: !e.visible } : e
                    )
                }
            })),

            // Global opacity
            setGlobalOpacity: (opacity) => set({
                globalOpacity: Math.max(0.1, Math.min(1.0, opacity))
            }),

            // Emphasis actions
            setEmphasisEnabled: (enabled) => set((state) => ({
                emphasis: { ...state.emphasis, enabled }
            })),

            setEmphasisColumn: (column) => set((state) => ({
                emphasis: { ...state.emphasis, column }
            })),

            setEmphasisMode: (mode) => set((state) => ({
                emphasis: { ...state.emphasis, mode }
            })),

            setEmphasisThreshold: (threshold) => set((state) => ({
                emphasis: { ...state.emphasis, threshold: Math.max(0, Math.min(100, threshold)) }
            })),

            setEmphasisMinOpacity: (minOpacity) => set((state) => ({
                emphasis: { ...state.emphasis, minOpacity: Math.max(0.05, Math.min(0.5, minOpacity)) }
            })),

            setEmphasisBoostSize: (boostSize) => set((state) => ({
                emphasis: { ...state.emphasis, boostSize }
            })),

            setEmphasisSizeBoostFactor: (sizeBoostFactor) => set((state) => ({
                emphasis: { ...state.emphasis, sizeBoostFactor: Math.max(1.0, Math.min(3.0, sizeBoostFactor)) }
            })),

            // Stats
            updateRowCounts: (tab, counts) => set((state) => ({
                [tab]: {
                    ...state[tab],
                    entries: state[tab].entries.map(e => {
                        const count = counts[e.id] || counts[e.name] || { total: 0, visible: 0 };
                        return { ...e, rowCount: count.total, visibleRowCount: count.visible };
                    })
                }
            })),

            // Export/Import
            exportState: () => {
                const state = get();
                const exportData = {
                    color: state.color,
                    shape: state.shape,
                    size: state.size,
                    filter: state.filter,
                    customEntries: state.customEntries,
                    globalOpacity: state.globalOpacity,
                    emphasis: state.emphasis,
                    version: 2,
                };
                return JSON.stringify(exportData, null, 2);
            },

            importState: (json) => {
                try {
                    const data = JSON.parse(json);
                    if (data.version !== 1 && data.version !== 2) {
                        console.error('Unsupported attribute file version');
                        return false;
                    }

                    // Ensure opacity defaults for v1 entries that lack it
                    const ensureOpacity = (entries: AttributeEntry[]) =>
                        entries.map(e => ({ ...e, opacity: e.opacity ?? 1.0 }));

                    const ensureConfig = (config: AttributeConfig | undefined, type: AttributeType) => {
                        if (!config) return createDefaultConfig(type);
                        return { ...config, entries: ensureOpacity(config.entries) };
                    };

                    set({
                        color: ensureConfig(data.color, 'color'),
                        shape: ensureConfig(data.shape, 'shape'),
                        size: ensureConfig(data.size, 'size'),
                        filter: ensureConfig(data.filter, 'filter'),
                        customEntries: ensureOpacity(data.customEntries || []),
                        globalOpacity: data.globalOpacity ?? 1.0,
                        emphasis: data.emphasis || {
                            enabled: false,
                            column: null,
                            mode: 'category',
                            threshold: 75,
                            minOpacity: 0.15,
                            boostSize: true,
                            sizeBoostFactor: 1.5,
                        },
                    });
                    return true;
                } catch (e) {
                    console.error('Failed to import attribute state:', e);
                    return false;
                }
            },

            // Combined entries getter
            getCombinedEntries: (tab) => {
                const state = get();
                const tabEntries = state[tab].entries;
                // Custom entries appear at top, after default
                const defaultEntry = tabEntries.find(e => e.isDefault);
                const fieldEntries = tabEntries.filter(e => !e.isDefault);

                return [
                    ...(defaultEntry ? [defaultEntry] : []),
                    ...state.customEntries,
                    ...fieldEntries,
                ];
            },

            // Get entry by name
            getEntryByName: (name) => {
                const state = get();
                // Check custom entries first
                const custom = state.customEntries.find(e => e.name === name);
                if (custom) return custom;

                // Check all tab entries
                for (const tab of ['color', 'shape', 'size', 'filter'] as AttributeType[]) {
                    const entry = state[tab].entries.find(e => e.name === name);
                    if (entry) return entry;
                }
                return null;
            },

            // QGIS sync - push styles to backend for QGIS plugin
            syncStylesToQgis: async () => {
                const state = get();
                try {
                    const result = await qgisApi.syncStyles({
                        color: state.color,
                        shape: state.shape,
                        size: state.size,
                        globalOpacity: state.globalOpacity,
                        emphasis: state.emphasis,
                    });
                    console.log('[syncStylesToQgis] Synced styles:', result);
                } catch (err) {
                    console.warn('[syncStylesToQgis] Failed to sync styles:', err);
                }
            },
        }),
        {
            name: 'attribute-storage',
            version: 3,
            migrate: (persistedState: any, version: number) => {
                if (version < 2) {
                    // v1 -> v2: add opacity to all entries
                    const addOpacity = (entries: any[]) =>
                        entries?.map((e: any) => ({ ...e, opacity: e.opacity ?? 1.0 })) ?? [];

                    for (const tab of ['color', 'shape', 'size', 'filter']) {
                        if (persistedState[tab]?.entries) {
                            persistedState[tab].entries = addOpacity(persistedState[tab].entries);
                        }
                    }
                    if (persistedState.customEntries) {
                        persistedState.customEntries = addOpacity(persistedState.customEntries);
                    }
                }
                if (version < 3) {
                    // v2 -> v3: migrate selectedEntryName to selectedEntryNames array
                    if ('selectedEntryName' in persistedState) {
                        const old = persistedState.selectedEntryName;
                        persistedState.selectedEntryNames = old ? [old] : [];
                        delete persistedState.selectedEntryName;
                    }
                    if (!persistedState.selectedEntryNames) {
                        persistedState.selectedEntryNames = [];
                    }
                    if (!persistedState.recentColors) {
                        persistedState.recentColors = [];
                    }
                }
                return persistedState;
            },
        }
    )
);

// ============================================================================
// Utility Functions
// ============================================================================

export function generateEntryId(): string {
    return `entry-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function createRangeEntry(
    min: number,
    max: number,
    _index: number,
    color?: string,
    shape?: string,
    size?: number,
    opacity: number = 1.0
): AttributeEntry {
    const label = `${min.toFixed(2)} - ${max.toFixed(2)}`;

    return {
        id: generateEntryId(),
        name: label,
        isDefault: false,
        isCustom: false,
        visible: true,
        type: 'range',
        min,
        max,
        color,
        shape,
        size,
        opacity,
        assignedIndices: [],
        rowCount: 0,
        visibleRowCount: 0,
    };
}

export function createCategoryEntry(
    value: string,
    _index: number,
    color?: string,
    shape?: string,
    size?: number,
    opacity: number = 1.0
): AttributeEntry {
    return {
        id: generateEntryId(),
        name: value,
        isDefault: false,
        isCustom: false,
        visible: true,
        type: 'category',
        categoryValue: value,
        color,
        shape,
        size,
        opacity,
        assignedIndices: [],
        rowCount: 0,
        visibleRowCount: 0,
    };
}

export function createCustomEntry(
    name: string,
    color?: string,
    shape?: string,
    size?: number,
    opacity: number = 1.0
): AttributeEntry {
    return {
        id: generateEntryId(),
        name,
        isDefault: false,
        isCustom: true,
        visible: true,
        type: 'custom',
        color,
        shape,
        size,
        opacity,
        assignedIndices: [],
        rowCount: 0,
        visibleRowCount: 0,
    };
}

// ============================================================================
// Marker Shapes (for reference)
// ============================================================================

export const MARKER_SHAPES = [
    { value: 'circle', label: 'Circle', symbol: 0 },
    { value: 'square', label: 'Square', symbol: 1 },
    { value: 'diamond', label: 'Diamond', symbol: 2 },
    { value: 'cross', label: 'Cross', symbol: 3 },
    { value: 'x', label: 'X', symbol: 4 },
    { value: 'triangle-up', label: 'Triangle Up', symbol: 5 },
    { value: 'triangle-down', label: 'Triangle Down', symbol: 6 },
    { value: 'triangle-left', label: 'Triangle Left', symbol: 7 },
    { value: 'triangle-right', label: 'Triangle Right', symbol: 8 },
    { value: 'pentagon', label: 'Pentagon', symbol: 15 },
    { value: 'hexagon', label: 'Hexagon', symbol: 18 },
    { value: 'star', label: 'Star', symbol: 17 },
    { value: 'hourglass', label: 'Hourglass', symbol: 21 },
];

export function getShapeSymbol(shapeName: string): number {
    return MARKER_SHAPES.find(s => s.value === shapeName)?.symbol ?? 0;
}
