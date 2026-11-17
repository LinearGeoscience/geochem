/**
 * App-wide undo / redo (Phase 22).
 *
 * Every dataset mutation produces a new immutable columnarData / columns
 * object (Phase 15) and attribute changes replace their config objects, so a
 * history entry is just a set of references to the previous state — cheap,
 * no deep copies. The history listens to the stores rather than wrapping each
 * action, so every mutation path is covered.
 *
 * - Bursts of changes (slider drags, multi-step actions) within
 *   COALESCE_MS are recorded as one step.
 * - Loading a different dataset (row count change or a new set of columns)
 *   resets the history: undoing across files would be surprising and would
 *   keep old datasets alive in memory.
 * - Selection, view and plot-camera changes are not recorded.
 * - The 3D scene (store/modelStore) is part of each step: its surfaces can
 *   own dataset columns, so the two have to go back together.
 */
import { create } from 'zustand';
import { useAppStore } from './appStore';
import { useAttributeStore } from './attributeStore';
import { useModelStore } from './modelStore';
import type { ModelScene } from '../features/model/types';

const MAX_DEPTH = 50;
const COALESCE_MS = 400;

type AppSlice = Pick<ReturnType<typeof useAppStore.getState>,
    'columnarData' | 'columns' | 'geochemMappings' | 'availableFilters' | 'bdlFactor'>;
type AttrSlice = Pick<ReturnType<typeof useAttributeStore.getState>,
    'color' | 'shape' | 'size' | 'filter' | 'customEntries' | 'emphasis' | 'globalOpacity' | 'valueFilter'>;

export interface HistorySnapshot {
    app: AppSlice;
    attr: AttrSlice;
    model: ModelScene;
    label: string;
}

type Slices = Pick<HistorySnapshot, 'app' | 'attr' | 'model'>;

function capture(): Slices {
    return { app: captureApp(), attr: captureAttr(), model: useModelStore.getState().scene };
}

interface HistoryState {
    past: HistorySnapshot[];
    future: HistorySnapshot[];
    canUndo: boolean;
    canRedo: boolean;
    undo: () => void;
    redo: () => void;
    clear: () => void;
}

function captureApp(): AppSlice {
    const s = useAppStore.getState();
    return {
        columnarData: s.columnarData, columns: s.columns, geochemMappings: s.geochemMappings,
        availableFilters: s.availableFilters, bdlFactor: s.bdlFactor,
    };
}

function captureAttr(): AttrSlice {
    const s = useAttributeStore.getState();
    return {
        color: s.color, shape: s.shape, size: s.size, filter: s.filter,
        customEntries: s.customEntries, emphasis: s.emphasis, globalOpacity: s.globalOpacity,
        valueFilter: s.valueFilter,
    };
}

/** Describe what changed between two snapshots, for the undo tooltip. */
function describe(prev: HistorySnapshot, next: Slices): string {
    if (prev.app.columns !== next.app.columns) {
        const before = new Set(prev.app.columns.map(c => c.name));
        const added = next.app.columns.filter(c => !before.has(c.name)).map(c => c.name);
        if (added.length) return `add column ${added.slice(0, 2).join(', ')}${added.length > 2 ? '…' : ''}`;
        const after = new Set(next.app.columns.map(c => c.name));
        const removed = prev.app.columns.filter(c => !after.has(c.name)).map(c => c.name);
        if (removed.length) return `remove column ${removed[0]}`;
        return 'column change';
    }
    if (prev.app.columnarData !== next.app.columnarData) return 'data edit';
    if (prev.app.geochemMappings !== next.app.geochemMappings) return 'chemistry mapping';
    if (prev.app.bdlFactor !== next.app.bdlFactor) return 'below-detection setting';
    if (prev.model !== next.model) {
        const before = prev.model.surfaces.length, after = next.model.surfaces.length;
        if (prev.model.surfaces === next.model.surfaces && prev.model.structure !== next.model.structure) {
            const had = prev.model.structure?.sets?.length ?? 0, has = next.model.structure?.sets?.length ?? 0;
            return has > had ? 'add readings' : has < had ? 'remove readings' : 'structure change';
        }
        return after > before ? 'add surface' : after < before ? 'remove surface' : 'surface edit';
    }
    return 'styling';
}

function sameDataset(a: AppSlice, b: AppSlice): boolean {
    if (a.columnarData.rowCount !== b.columnarData.rowCount) return false;
    // A fresh load replaces most columns; edits keep almost all of them
    const names = new Set(a.columns.map(c => c.name));
    const shared = b.columns.filter(c => names.has(c.name)).length;
    return shared >= Math.min(a.columns.length, b.columns.length) * 0.5;
}

let applying = false;          // true while undo/redo writes the stores
let burstStart: HistorySnapshot | null = null;
let burstTimer: ReturnType<typeof setTimeout> | null = null;
let current: HistorySnapshot = { ...capture(), label: '' };
// A re-imported file with the same shape is still a different dataset
let currentGeneration = useAppStore.getState().datasetGeneration;

export const useHistoryStore = create<HistoryState>((set, get) => ({
    past: [],
    future: [],
    canUndo: false,
    canRedo: false,

    undo: () => {
        flushBurst();
        const { past, future } = get();
        const prev = past[past.length - 1];
        if (!prev) return;
        const now: HistorySnapshot = { ...capture(), label: prev.label };
        restore(prev);
        set({ past: past.slice(0, -1), future: [...future, now], canUndo: past.length > 1, canRedo: true });
    },

    redo: () => {
        flushBurst();
        const { past, future } = get();
        const next = future[future.length - 1];
        if (!next) return;
        const now: HistorySnapshot = { ...capture(), label: next.label };
        restore(next);
        set({ past: [...past, now], future: future.slice(0, -1), canUndo: true, canRedo: future.length > 1 });
    },

    clear: () => {
        burstStart = null;
        if (burstTimer) clearTimeout(burstTimer);
        burstTimer = null;
        current = { ...capture(), label: '' };
        set({ past: [], future: [], canUndo: false, canRedo: false });
    },
}));

function restore(snap: HistorySnapshot) {
    applying = true;
    try {
        useAppStore.setState({ ...snap.app });
        useAttributeStore.setState({ ...snap.attr });
        useModelStore.setState({ scene: snap.model });
    } finally {
        applying = false;
    }
    current = { ...capture(), label: '' };
}

function flushBurst() {
    if (burstTimer) clearTimeout(burstTimer);
    burstTimer = null;
    if (!burstStart) return;
    const start = burstStart;
    burstStart = null;
    start.label = describe(start, capture());
    const { past } = useHistoryStore.getState();
    const trimmed = [...past, start].slice(-MAX_DEPTH);
    useHistoryStore.setState({ past: trimmed, future: [], canUndo: true, canRedo: false });
}

function onChange() {
    if (applying) return;
    const { app, attr, model } = capture();
    const changed =
        model !== current.model ||
        app.columnarData !== current.app.columnarData || app.columns !== current.app.columns ||
        app.geochemMappings !== current.app.geochemMappings || app.bdlFactor !== current.app.bdlFactor ||
        attr.color !== current.attr.color || attr.shape !== current.attr.shape || attr.size !== current.attr.size ||
        attr.filter !== current.attr.filter || attr.customEntries !== current.attr.customEntries ||
        attr.emphasis !== current.attr.emphasis || attr.globalOpacity !== current.attr.globalOpacity ||
        attr.valueFilter !== current.attr.valueFilter;
    if (!changed) return;

    const generation = useAppStore.getState().datasetGeneration;
    if (generation !== currentGeneration || !sameDataset(current.app, app)) {
        currentGeneration = generation;
        // New dataset: start a fresh history
        useHistoryStore.getState().clear();
        return;
    }
    if (!burstStart) burstStart = current;
    current = { app, attr, model, label: '' };
    if (burstTimer) clearTimeout(burstTimer);
    burstTimer = setTimeout(flushBurst, COALESCE_MS);
}

useAppStore.subscribe(onChange);
useAttributeStore.subscribe(onChange);
useModelStore.subscribe(onChange);

/**
 * Make a change that only follows from what is already recorded (data worked
 * out from the scene, such as a surface's columns): it gets no undo step of
 * its own, and does not clear what can be redone.
 */
export function withoutHistory(change: () => void): void {
    const was = applying;
    applying = true;
    try {
        change();
    } finally {
        applying = was;
    }
    if (!applying) current = { ...capture(), label: '' };
}

/** For tests: close the current burst immediately. */
export function _flushHistoryBurst() { flushBurst(); }
