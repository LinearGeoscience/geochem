import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { qgisApi } from '../services/api';

// ============================================================================
// Types
// ============================================================================

/** progressive: continuous colour ramp by value (Progressive); entries give the legend and visibility */
/** 'manual' only appears in files saved before Phase 61 (now `breaksEdited`) */
export type ClassificationMethod =
    | 'equal' | 'logEqual' | 'quantile' | 'jenks' | 'stdDev' | 'percentile'
    | 'categorical' | 'manual' | 'progressive';
export type AttributeType = 'color' | 'shape' | 'size' | 'filter';
export type EmphasisMode = 'linear' | 'percentile' | 'category';

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
    /** Merged category: every value it covers (categoryValue is the first) */
    categoryValues?: string[];

    /** Class key the classifier matches on rebuild (category value, or 'r<i>' for the i-th range) */
    key?: string;
    /** Properties the user changed; a reclassify keeps them */
    edited?: EditableProp[];

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

export type EditableProp = 'color' | 'shape' | 'size' | 'opacity' | 'visible' | 'name';
export const EDITABLE_PROPS: EditableProp[] = ['color', 'shape', 'size', 'opacity', 'visible', 'name'];

export interface AttributeConfig {
    field: string | null;
    additionalFields: string[];  // Extra columns for cross-product classification
    method: ClassificationMethod;
    numClasses: number;
    palette: string;
    entries: AttributeEntry[];
    /** Palette / shape / size order reversed */
    reversed?: boolean;
    /** Breaks were edited by hand: a rebuild keeps them unless the method or class count changes */
    breaksEdited?: boolean;
    /** Classes built by the classifier: rebuilt live when the data or settings change */
    auto?: boolean;
    /** Size tab: smallest and largest class size */
    sizeRange?: [number, number];
}

export interface AttributeState {
    // Per-tab configuration
    color: AttributeConfig;
    shape: AttributeConfig;
    size: AttributeConfig;
    filter: AttributeConfig;

    // Custom entries (shared across tabs by name)
    customEntries: AttributeEntry[];

    // Multi-selection (entry ids, session only)
    selectedEntryIds: string[];

    // Active tab
    activeTab: AttributeType;

    // Paint mode (session-only, not persisted)
    paintMode: boolean;
    /** Paint only rows on the Default colour row (and the active group): earlier groups stay put */
    paintUnassignedOnly: boolean;
    activeEntryId: string | null;

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

    // Selection (multi-select, by entry id)
    setSelectedEntryIds: (ids: string[]) => void;
    toggleSelectedEntryId: (id: string) => void;
    selectEntryRange: (id: string, allIds: string[]) => void;
    clearSelection: () => void;

    // Paint mode actions
    setPaintMode: (active: boolean) => void;
    setPaintUnassignedOnly: (on: boolean) => void;
    setActiveEntryId: (id: string | null) => void;
    paintIndicesToActiveEntry: (indices: number[]) => void;
    unpaintIndices: (indices: number[]) => void;
    removeIndicesFromEntry: (entryId: string, indices: number[]) => void;
    createEntryAndSetActive: (tab: AttributeType) => void;
    /** Paint into an existing row: a custom entry with that row's name and style becomes the paint target */
    paintIntoEntry: (tab: AttributeType, entryName: string) => void;

    // Batch operations (entry ids: tab classes and painted groups); one store update each
    batchUpdateEntries: (tab: AttributeType, ids: string[], updates: Partial<AttributeEntry>) => void;
    batchDeleteEntries: (tab: AttributeType, ids: string[]) => void;
    batchToggleVisibility: (tab: AttributeType, ids: string[], visible: boolean) => void;
    /** New order of the tab's classes (legend order; later classes draw on top) */
    reorderEntries: (tab: AttributeType, ids: string[]) => void;
    /** Move one break of a range class; the neighbouring class follows so classes stay contiguous */
    setBreak: (tab: AttributeType, entryId: string, side: 'min' | 'max', value: number) => void;
    /** Style of the Default row */
    setDefaultStyle: (tab: AttributeType, updates: Partial<AttributeEntry>) => void;
    /** Merge category classes into the first one */
    mergeEntries: (tab: AttributeType, ids: string[]) => void;
    /** Show only these classes (and painted groups) */
    showOnly: (tab: AttributeType, ids: string[]) => void;

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


    // QGIS sync
    syncStylesToQgis: () => Promise<void>;
}

// ============================================================================
// Default Values
// ============================================================================

export const TAB_NAMES: Record<AttributeType, string> = { color: 'Colour', shape: 'Shape', size: 'Size', filter: 'Filter' };

const createDefaultEntry = (type: AttributeType): AttributeEntry => ({
    id: `default-${type}`,
    name: type === 'color' ? 'Default Colour' :
          type === 'shape' ? 'Default Shape' :
          type === 'size' ? 'Default Size' : 'Default Filter',
    isDefault: true,
    isCustom: false,
    visible: true,
    type: 'default',
    color: type === 'color' ? '#808080' : undefined,
    shape: type === 'shape' ? 'circle' : undefined,
    size: type === 'size' ? 6 : undefined,
    opacity: 1.0,
    assignedIndices: [],
    rowCount: 0,
    visibleRowCount: 0,
});

export const DEFAULT_VALUE_FILTER: ValueFilterConfig = {
    enabled: false, column: null, min: null, max: null, dataMin: null, dataMax: null,
};

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
            selectedEntryIds: [],
            activeTab: 'color',
            paintMode: false,
            paintUnassignedOnly: false,
            activeEntryId: null,
            globalOpacity: 1.0,
            recentColors: [],
            valueFilter: DEFAULT_VALUE_FILTER,
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
                        e.id === entryId ? markEdited(e, updates) : e
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
                selectedEntryIds: [],
                activeEntryId: null,
                valueFilter: DEFAULT_VALUE_FILTER,
            }),

            // Custom entries
            addCustomEntry: (entry) => set((state) => ({
                customEntries: [...state.customEntries, { ...entry, isCustom: true }]
            })),

            updateCustomEntry: (entryId, updates) => set((state) => ({
                customEntries: state.customEntries.map(e =>
                    e.id === entryId ? markEdited(e, updates) : e
                )
            })),

            removeCustomEntry: (entryId) => set((state) => ({
                customEntries: state.customEntries.filter(e => e.id !== entryId)
            })),

            // Selection (multi-select, by id)
            setSelectedEntryIds: (ids) => set({ selectedEntryIds: ids }),

            toggleSelectedEntryId: (id) => set((state) => ({
                selectedEntryIds: state.selectedEntryIds.includes(id)
                    ? state.selectedEntryIds.filter(x => x !== id)
                    : [...state.selectedEntryIds, id],
            })),

            selectEntryRange: (id, allIds) => set((state) => {
                const current = state.selectedEntryIds;
                const last = current.length > 0 ? current[current.length - 1] : null;
                const from = last ? allIds.indexOf(last) : -1;
                const to = allIds.indexOf(id);
                if (from === -1 || to === -1) return { selectedEntryIds: [id] };
                const range = allIds.slice(Math.min(from, to), Math.max(from, to) + 1);
                return { selectedEntryIds: [...new Set([...current, ...range])] };
            }),

            clearSelection: () => set({ selectedEntryIds: [] }),

            // Paint mode actions
            setPaintMode: (active) => set({ paintMode: active }),
            setPaintUnassignedOnly: (on) => set({ paintUnassignedOnly: on }),

            setActiveEntryId: (id) => set({ activeEntryId: id }),

            paintIndicesToActiveEntry: (indices) => set((state) => {
                const { activeEntryId, customEntries } = state;
                if (!activeEntryId || indices.length === 0) return state;

                const activeEntry = customEntries.find(e => e.id === activeEntryId);
                if (!activeEntry) return state;

                const indexSet = new Set(indices);

                const updatedEntries = customEntries.map(entry => {
                    if (entry.id === activeEntryId) {
                        // Add indices to active entry
                        const merged = [...new Set([...entry.assignedIndices, ...indices])];
                        return { ...entry, assignedIndices: merged };
                    } else {
                        // Exclusive: remove the rows from every other group
                        return entry.assignedIndices.some(i => indexSet.has(i))
                            ? { ...entry, assignedIndices: entry.assignedIndices.filter(i => !indexSet.has(i)) }
                            : entry;
                    }
                });

                return { customEntries: updatedEntries };
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

            createEntryAndSetActive: (tab) => set((state) => {
                // naming: Colour_01, Shape_01, ...
                const baseName = TAB_NAMES[tab];
                let counter = 1;
                const nameFor = (k: number) => `${baseName}_${String(k).padStart(2, '0')}`;
                while (state.customEntries.some(e => e.name === nameFor(counter))) {
                    counter++;
                }
                const name = nameFor(counter);

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

            paintIntoEntry: (tab, entryName) => set((state) => {
                const existing = state.customEntries.find(e => e.name === entryName);
                if (existing) return { activeEntryId: existing.id };
                const row = state[tab].entries.find(e => e.name === entryName && !e.isDefault);
                if (!row) return state;
                const entry = createCustomEntry(entryName, row.color, row.shape, row.size);
                return {
                    customEntries: [...state.customEntries, { ...entry, isCustom: true, opacity: row.opacity ?? 1 }],
                    activeEntryId: entry.id,
                };
            }),

            // Batch operations (by id)
            batchUpdateEntries: (tab, ids, updates) => set((state) => {
                const idSet = new Set(ids);
                return {
                    [tab]: {
                        ...state[tab],
                        entries: state[tab].entries.map(e => (idSet.has(e.id) ? markEdited(e, updates) : e)),
                    },
                    customEntries: state.customEntries.some(e => idSet.has(e.id))
                        ? state.customEntries.map(e => (idSet.has(e.id) ? markEdited(e, updates) : e))
                        : state.customEntries,
                };
            }),

            batchDeleteEntries: (tab, ids) => set((state) => {
                const idSet = new Set(ids);
                return {
                    [tab]: {
                        ...state[tab],
                        entries: state[tab].entries.filter(e => !idSet.has(e.id) || e.isDefault),
                    },
                    customEntries: state.customEntries.filter(e => !idSet.has(e.id)),
                    selectedEntryIds: [],
                    activeEntryId: state.activeEntryId && idSet.has(state.activeEntryId) ? null : state.activeEntryId,
                };
            }),

            batchToggleVisibility: (tab, ids, visible) => get().batchUpdateEntries(tab, ids, { visible }),

            reorderEntries: (tab, ids) => set((state) => {
                const idSet = new Set(ids);
                const byId = new Map(state[tab].entries.map(e => [e.id, e]));
                const ordered = ids.map(id => byId.get(id)).filter((e): e is AttributeEntry => !!e && !e.isDefault);
                const rest = state[tab].entries.filter(e => !e.isDefault && !idSet.has(e.id));
                const def = state[tab].entries.filter(e => e.isDefault);
                const customById = new Map(state.customEntries.map(e => [e.id, e]));
                const customOrdered = ids.map(id => customById.get(id)).filter((e): e is AttributeEntry => !!e);
                const customRest = state.customEntries.filter(e => !idSet.has(e.id));
                return {
                    [tab]: { ...state[tab], entries: [...def, ...ordered, ...rest] },
                    customEntries: customOrdered.length ? [...customOrdered, ...customRest] : state.customEntries,
                };
            }),

            setBreak: (tab, entryId, side, value) => set((state) => {
                if (!Number.isFinite(value)) return state;
                const cfg = state[tab];
                const ranges = cfg.entries.filter(e => e.type === 'range' && !e.isDefault)
                    .sort((a, b) => (a.min ?? 0) - (b.min ?? 0));
                const k = ranges.findIndex(e => e.id === entryId);
                if (k === -1) return state;
                const lo = side === 'min' ? (ranges[k - 1]?.min ?? -Infinity) : ranges[k].min!;
                const hi = side === 'min' ? ranges[k].max! : (ranges[k + 1]?.max ?? Infinity);
                const v = Math.min(Math.max(value, lo), hi);
                const changed = new Map<string, Partial<AttributeEntry>>();
                changed.set(ranges[k].id, side === 'min' ? { min: v } : { max: v });
                const neighbour = side === 'min' ? ranges[k - 1] : ranges[k + 1];
                if (neighbour) changed.set(neighbour.id, side === 'min' ? { max: v } : { min: v });
                return {
                    [tab]: {
                        ...cfg,
                        breaksEdited: true,
                        entries: cfg.entries.map(e => {
                            const u = changed.get(e.id);
                            if (!u) return e;
                            const next = { ...e, ...u };
                            return e.edited?.includes('name') ? next : { ...next, name: rangeLabel(next.min!, next.max!) };
                        }),
                    },
                };
            }),

            setDefaultStyle: (tab, updates) => set((state) => ({
                [tab]: {
                    ...state[tab],
                    entries: state[tab].entries.map(e => (e.isDefault ? { ...e, ...updates } : e)),
                },
            })),

            mergeEntries: (tab, ids) => set((state) => {
                const cfg = state[tab];
                const picked = cfg.entries.filter(e => ids.includes(e.id) && e.type === 'category');
                if (picked.length < 2) return state;
                const [first, ...rest] = picked;
                const values = picked.flatMap(e => e.categoryValues ?? [e.categoryValue!]);
                const merged: AttributeEntry = {
                    ...first,
                    categoryValues: values,
                    name: picked.map(e => e.name).join(', '),
                    edited: [...new Set([...(first.edited ?? []), 'name' as EditableProp])],
                };
                const drop = new Set(rest.map(e => e.id));
                return {
                    [tab]: { ...cfg, entries: cfg.entries.filter(e => !drop.has(e.id)).map(e => (e.id === first.id ? merged : e)) },
                    selectedEntryIds: [first.id],
                };
            }),

            showOnly: (tab, ids) => set((state) => {
                const keep = new Set(ids);
                const cfg = state[tab];
                return {
                    [tab]: {
                        ...cfg,
                        entries: cfg.entries.map(e => {
                            const visible = keep.has(e.id);
                            return e.visible === visible ? e : markEdited(e, { visible });
                        }),
                    },
                    customEntries: state.customEntries.map(e => {
                        const visible = keep.has(e.id);
                        return e.visible === visible ? e : { ...e, visible };
                    }),
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
                        e.id === entryId ? markEdited(e, { visible }) : e
                    )
                }
            })),

            setAllVisible: (tab, visible) => set((state) => ({
                [tab]: {
                    ...state[tab],
                    entries: state[tab].entries.map(e => (e.visible === visible ? e : markEdited(e, { visible })))
                }
            })),

            toggleEntryVisibility: (tab, entryId) => set((state) => ({
                [tab]: {
                    ...state[tab],
                    entries: state[tab].entries.map(e =>
                        e.id === entryId ? markEdited(e, { visible: !e.visible }) : e
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
                        return migrateConfigV9({
                            ...config,
                            additionalFields: config.additionalFields || [],
                            entries: ensureOpacity(config.entries),
                        });
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
                        valueFilter: data.valueFilter || DEFAULT_VALUE_FILTER,
                        selectedEntryIds: [],
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
                    throw err;
                }
            },
        }),
        {
            name: 'attribute-storage',
            version: 7,
            partialize: (state) => {
                // Exclude session-only state (paint, selection) from persistence.
                // Row-index lists (custom paint groups, assignedIndices) belong
                // to one dataset: they travel in the project file / recovery
                // snapshot, not in localStorage where they would outlive their data.
                const { paintMode, activeEntryId, customEntries, selectedEntryIds, paintUnassignedOnly, ...rest } = state;
                const stripIndices = (cfg: any) => cfg && ({
                    ...cfg,
                    entries: cfg.entries?.map((e: any) => ({ ...e, assignedIndices: [] })),
                });
                return {
                    ...rest,
                    color: stripIndices(rest.color),
                    shape: stripIndices(rest.shape),
                    size: stripIndices(rest.size),
                    filter: stripIndices(rest.filter),
                } as any;
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
                if (version < 7) {
                    // v6 -> v7: selection is by id and session-only; class keys
                    delete persistedState.selectedEntryNames;
                    delete persistedState.paintHistory;
                    for (const tab of ['color', 'shape', 'size', 'filter']) {
                        if (persistedState[tab]) persistedState[tab] = migrateConfigV9(persistedState[tab]);
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

/** Apply `updates` to an entry and remember which styling properties the user changed */
export function markEdited(e: AttributeEntry, updates: Partial<AttributeEntry>): AttributeEntry {
    const keys = EDITABLE_PROPS.filter(k => k in updates && updates[k] !== e[k]);
    if (!keys.length) return { ...e, ...updates };
    return { ...e, ...updates, edited: [...new Set([...(e.edited ?? []), ...keys])] };
}

/** Range class label */
export function rangeLabel(min: number, max: number): string {
    return `${formatBreak(min)} - ${formatBreak(max)}`;
}

/**
 * Configs saved before Phase 61 (project v8 / localStorage v6): 'manual'
 * becomes hand-edited breaks, entries get class keys.
 */
export function migrateConfigV9<T extends Partial<AttributeConfig>>(cfg: T): T {
    if (!cfg || !Array.isArray(cfg.entries)) return cfg;
    const out: any = { ...cfg };
    if (out.method === 'manual') { out.method = 'equal'; out.breaksEdited = true; }
    const ranges = out.entries.filter((e: AttributeEntry) => e.type === 'range' && !e.isDefault)
        .sort((a: AttributeEntry, b: AttributeEntry) => (a.min ?? 0) - (b.min ?? 0));
    out.entries = out.entries.map((e: AttributeEntry) => {
        if (e.key || e.isDefault) return e;
        if (e.type === 'category' && e.categoryValue !== undefined) return { ...e, key: e.categoryValue };
        if (e.type === 'range') return { ...e, key: `r${ranges.indexOf(e)}` };
        return e;
    });
    return out;
}

/** Class break for labels: 3 significant figures, so 2e-5 and 0.0417 stay distinct (not "0.00") */
export function formatBreak(v: number): string {
    if (!Number.isFinite(v)) return String(v);
    if (v === 0) return '0';
    return Math.abs(v) >= 1000 ? String(Math.round(v)) : String(Number(v.toPrecision(3)));
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
    const label = rangeLabel(min, max);

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
