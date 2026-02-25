import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { qgisApi } from '../services/api';

// ============================================================================
// Types
// ============================================================================

export type ClassificationMethod = 'equal' | 'quantile' | 'jenks' | 'categorical' | 'manual';
export type AttributeType = 'color' | 'shape' | 'size' | 'filter';
export type EmphasisMode = 'linear' | 'percentile' | 'category';

// Paint mode types
export interface PaintHistoryEntry {
    entryId: string;
    addedIndices: number[];
    removedFromEntries: { entryId: string; indices: number[] }[];
    timestamp: number;
}

// Value Filter configuration
export interface ValueFilterConfig {
    enabled: boolean;
    column: string | null;      // null = use color field
    min: number | null;         // null = no lower bound
    max: number | null;         // null = no upper bound
    dataMin: number | null;     // Detected data range (for slider bounds)
    dataMax: number | null;     // Detected data range (for slider bounds)
}

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
    additionalFields: string[];  // Extra columns for cross-product classification
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

    // Paint mode (session-only, not persisted)
    paintMode: boolean;
    activeEntryId: string | null;
    paintHistory: PaintHistoryEntry[];

    // Global settings
    globalOpacity: number;

    // Value Filter
    valueFilter: ValueFilterConfig;

    // High Grade Emphasis
    emphasis: EmphasisConfig;

    // Recent colors used
    recentColors: string[];

    // Actions
    setActiveTab: (tab: AttributeType) => void;
    setField: (tab: AttributeType, field: string | null) => void;
    addAdditionalField: (tab: AttributeType, field: string) => void;
    removeAdditionalField: (tab: AttributeType, index: number) => void;
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

    // Paint mode actions
    setPaintMode: (active: boolean) => void;
    setActiveEntryId: (id: string | null) => void;
    paintIndicesToActiveEntry: (indices: number[]) => void;
    unpaintIndices: (indices: number[]) => void;
    removeIndicesFromEntry: (entryId: string, indices: number[]) => void;
    undoLastPaint: () => void;
    createEntryAndSetActive: (tab: AttributeType) => void;

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

    // Value Filter
    setValueFilterEnabled: (enabled: boolean) => void;
    setValueFilterColumn: (column: string | null) => void;
    setValueFilterMin: (min: number | null) => void;
    setValueFilterMax: (max: number | null) => void;
    setValueFilterRange: (min: number | null, max: number | null) => void;
    setValueFilterDataRange: (dataMin: number, dataMax: number) => void;
    resetValueFilter: () => void;

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
    additionalFields: [],
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
            paintMode: false,
            activeEntryId: null,
            paintHistory: [],
            globalOpacity: 1.0,
            recentColors: [],
            valueFilter: {
                enabled: false,
                column: null,
                min: null,
                max: null,
                dataMin: null,
                dataMax: null,
            },
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
                [tab]: { ...state[tab], field, additionalFields: [] }
            })),

            addAdditionalField: (tab, field) => set((state) => {
                const current = state[tab].additionalFields || [];
                if (current.length >= 2) return state; // Max 2 additional (3 total)
                return { [tab]: { ...state[tab], additionalFields: [...current, field] } };
            }),

            removeAdditionalField: (tab, index) => set((state) => {
                const current = state[tab].additionalFields || [];
                return {
                    [tab]: {
                        ...state[tab],
                        additionalFields: current.filter((_, i) => i !== index),
                    }
                };
            }),

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
                    additionalFields: [],
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

            // Paint mode actions
            setPaintMode: (active) => set({ paintMode: active }),

            setActiveEntryId: (id) => set({ activeEntryId: id }),

            paintIndicesToActiveEntry: (indices) => set((state) => {
                const { activeEntryId, customEntries, paintHistory } = state;
                if (!activeEntryId || indices.length === 0) return state;

                const activeEntry = customEntries.find(e => e.id === activeEntryId);
                if (!activeEntry) return state;

                const indexSet = new Set(indices);

                // Track what gets removed from other entries (exclusive assignment)
                const removedFromEntries: { entryId: string; indices: number[] }[] = [];

                const updatedEntries = customEntries.map(entry => {
                    if (entry.id === activeEntryId) {
                        // Add indices to active entry
                        const merged = [...new Set([...entry.assignedIndices, ...indices])];
                        return { ...entry, assignedIndices: merged };
                    } else {
                        // Remove indices from all other entries
                        const removed = entry.assignedIndices.filter(i => indexSet.has(i));
                        if (removed.length > 0) {
                            removedFromEntries.push({ entryId: entry.id, indices: removed });
                            return { ...entry, assignedIndices: entry.assignedIndices.filter(i => !indexSet.has(i)) };
                        }
                        return entry;
                    }
                });

                // Determine truly new indices (not already in active entry)
                const existingSet = new Set(activeEntry.assignedIndices);
                const addedIndices = indices.filter(i => !existingSet.has(i));

                // Push to undo stack (max 20)
                const historyEntry: PaintHistoryEntry = {
                    entryId: activeEntryId,
                    addedIndices,
                    removedFromEntries,
                    timestamp: Date.now(),
                };
                const newHistory = [...paintHistory, historyEntry].slice(-20);

                return { customEntries: updatedEntries, paintHistory: newHistory };
            }),

            unpaintIndices: (indices) => set((state) => {
                const indexSet = new Set(indices);
                return {
                    customEntries: state.customEntries.map(entry => {
                        const filtered = entry.assignedIndices.filter(i => !indexSet.has(i));
                        if (filtered.length !== entry.assignedIndices.length) {
                            return { ...entry, assignedIndices: filtered };
                        }
                        return entry;
                    }),
                };
            }),

            removeIndicesFromEntry: (entryId, indices) => set((state) => {
                const indexSet = new Set(indices);
                return {
                    customEntries: state.customEntries.map(entry =>
                        entry.id === entryId
                            ? { ...entry, assignedIndices: entry.assignedIndices.filter(i => !indexSet.has(i)) }
                            : entry
                    ),
                };
            }),

            undoLastPaint: () => set((state) => {
                const { paintHistory, customEntries } = state;
                if (paintHistory.length === 0) return state;

                const last = paintHistory[paintHistory.length - 1];
                const addedSet = new Set(last.addedIndices);

                let updatedEntries = customEntries.map(entry => {
                    if (entry.id === last.entryId) {
                        // Remove the indices that were added
                        return { ...entry, assignedIndices: entry.assignedIndices.filter(i => !addedSet.has(i)) };
                    }
                    return entry;
                });

                // Restore indices that were removed from other entries
                for (const removed of last.removedFromEntries) {
                    updatedEntries = updatedEntries.map(entry =>
                        entry.id === removed.entryId
                            ? { ...entry, assignedIndices: [...new Set([...entry.assignedIndices, ...removed.indices])] }
                            : entry
                    );
                }

                return {
                    customEntries: updatedEntries,
                    paintHistory: paintHistory.slice(0, -1),
                };
            }),

            createEntryAndSetActive: (tab) => set((state) => {
                const baseName = 'Group';
                let counter = 1;
                while (state.customEntries.some(e => e.name === `${baseName} ${counter}`)) {
                    counter++;
                }
                const name = `${baseName} ${counter}`;

                // Auto-assign colors from a palette
                const palette = ['#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00', '#ffff33', '#a65628', '#f781bf'];
                const colorIndex = state.customEntries.length % palette.length;

                const newEntry = createCustomEntry(
                    name,
                    tab === 'color' || tab === 'filter' ? palette[colorIndex] : undefined,
                    tab === 'shape' ? 'circle' : undefined,
                    tab === 'size' ? 8 : undefined
                );

                return {
                    customEntries: [...state.customEntries, { ...newEntry, isCustom: true }],
                    activeEntryId: newEntry.id,
                };
            }),

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

            // Value Filter actions
            setValueFilterEnabled: (enabled) => set((state) => ({
                valueFilter: { ...state.valueFilter, enabled }
            })),

            setValueFilterColumn: (column) => set((state) => ({
                valueFilter: { ...state.valueFilter, column }
            })),

            setValueFilterMin: (min) => set((state) => ({
                valueFilter: { ...state.valueFilter, min }
            })),

            setValueFilterMax: (max) => set((state) => ({
                valueFilter: { ...state.valueFilter, max }
            })),

            setValueFilterRange: (min, max) => set((state) => ({
                valueFilter: { ...state.valueFilter, min, max }
            })),

            setValueFilterDataRange: (dataMin, dataMax) => set((state) => ({
                valueFilter: { ...state.valueFilter, dataMin, dataMax }
            })),

            resetValueFilter: () => set((state) => ({
                valueFilter: {
                    ...state.valueFilter,
                    min: state.valueFilter.dataMin,
                    max: state.valueFilter.dataMax,
                }
            })),

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
                    valueFilter: state.valueFilter,
                    version: 3,
                };
                return JSON.stringify(exportData, null, 2);
            },

            importState: (json) => {
                try {
                    const data = JSON.parse(json);
                    if (data.version !== 1 && data.version !== 2 && data.version !== 3) {
                        console.error('Unsupported attribute file version');
                        return false;
                    }

                    // Ensure opacity defaults for v1 entries that lack it
                    const ensureOpacity = (entries: AttributeEntry[]) =>
                        entries.map(e => ({ ...e, opacity: e.opacity ?? 1.0 }));

                    const ensureConfig = (config: AttributeConfig | undefined, type: AttributeType) => {
                        if (!config) return createDefaultConfig(type);
                        return {
                            ...config,
                            additionalFields: config.additionalFields || [],
                            entries: ensureOpacity(config.entries),
                        };
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
                        valueFilter: data.valueFilter || {
                            enabled: false,
                            column: null,
                            min: null,
                            max: null,
                            dataMin: null,
                            dataMax: null,
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
            version: 6,
            partialize: (state) => {
                // Exclude session-only paint state from persistence
                const { paintMode, activeEntryId, paintHistory, ...rest } = state;
                return rest as any;
            },
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
                // v3 -> v4: paintMode/activeEntryId/paintHistory are session-only (not persisted)
                if (version < 5) {
                    // v4 -> v5: add additionalFields to each tab config
                    for (const tab of ['color', 'shape', 'size', 'filter']) {
                        if (persistedState[tab]) {
                            persistedState[tab].additionalFields = persistedState[tab].additionalFields || [];
                        }
                    }
                }
                if (version < 6) {
                    // v5 -> v6: add valueFilter
                    if (!persistedState.valueFilter) {
                        persistedState.valueFilter = {
                            enabled: false,
                            column: null,
                            min: null,
                            max: null,
                            dataMin: null,
                            dataMax: null,
                        };
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
