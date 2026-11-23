/**
 * The Modelling page: its dock layout (saved with the project, as the Plots
 * page's is), the model view the tree's eyes and the properties act on, and
 * the tree's selection and open nodes (this session only).
 *
 * The views themselves are `appStore.modelViews`: 3D and section views of the
 * model, each with its settings by id as a plot's are, but never in `plots`,
 * so the Plots page, templates, workflows and the report's plot list do not
 * see them.
 */
import { create } from 'zustand';
import type { PlotInstance } from './appStore';
import type { SerializedLayout } from '../utils/workspaceLayout';

export type ModelViewKind = '3d' | 'section';

/** At most this many model views at once (each holds a WebGL context) */
export const MAX_MODEL_VIEWS = 4;

/** Model view ids start with this, so they can never be taken for a plot's */
export const MODEL_VIEW_PREFIX = 'mv-';

export const isModelViewId = (id: string | null | undefined): boolean => !!id && id.startsWith(MODEL_VIEW_PREFIX);

/** The kind of a model view (as saved: anything but a section is a 3D view) */
export const viewKindOf = (view: Pick<PlotInstance, 'settings'> | undefined): ModelViewKind =>
    (view?.settings?.viewKind === 'section' ? 'section' : '3d');

interface ModellingState {
    layout: SerializedLayout | null;
    revision: number;
    /** Written by the Modelling dock itself; does not reload it */
    setLayout: (layout: SerializedLayout | null) => void;
    /** Replace the layout from outside (project load; null: the default) */
    applyLayout: (layout: SerializedLayout | null) => void;
    resetLayout: () => void;
    /** The model view last used (null: none yet; see activeModelView for the one in force) */
    activeViewId: string | null;
    setActiveView: (id: string | null) => void;
    /** Objects picked in the tree (keys), in the order picked */
    selected: string[];
    setSelected: (keys: string[]) => void;
    /** An object picked from outside the tree (a click in a view): the tree brings its row into sight (`n` counts the asks) */
    reveal: { key: string; n: number } | null;
    revealKey: (key: string) => void;
    /** Tree nodes open (keys) */
    expanded: string[];
    setExpanded: (keys: string[]) => void;
    toggleExpanded: (key: string) => void;
    /** An interval of a logging table clicked in a view (its table's id and row): shown in the properties, marked in the views */
    loggedPick: { table: string; row: number } | null;
    setLoggedPick: (pick: { table: string; row: number } | null) => void;
}

const EXPANDED = ['root:drillholes', 'root:structure', 'root:points', 'root:lines', 'root:surfaces', 'root:sections', 'root:meshes'];

export const useModellingStore = create<ModellingState>()((set) => ({
    layout: null,
    revision: 0,
    setLayout: (layout) => set({ layout }),
    applyLayout: (layout) => set(s => ({ layout, revision: s.revision + 1, selected: [], loggedPick: null })),
    resetLayout: () => set(s => ({ layout: null, revision: s.revision + 1, selected: [], activeViewId: null, loggedPick: null })),
    activeViewId: null,
    setActiveView: (activeViewId) => set(s => (s.activeViewId === activeViewId ? s : { activeViewId })),
    selected: [],
    setSelected: (selected) => set({ selected }),
    reveal: null,
    revealKey: (key) => set(s => ({ reveal: { key, n: (s.reveal?.n ?? 0) + 1 } })),
    expanded: EXPANDED,
    setExpanded: (expanded) => set({ expanded }),
    toggleExpanded: (key) => set(s => ({ expanded: s.expanded.includes(key) ? s.expanded.filter(k => k !== key) : [...s.expanded, key] })),
    loggedPick: null,
    setLoggedPick: (loggedPick) => set({ loggedPick }),
}));

/** The model view in force: the one last used while it is open, else the first open (null: none) */
export function activeModelView(views: readonly PlotInstance[], activeId: string | null): PlotInstance | null {
    return views.find(v => v.id === activeId) ?? views[0] ?? null;
}

/** Model views as saved, checked: each a 3D or section view with an id of its own, at most MAX_MODEL_VIEWS */
export function readModelViews(raw: unknown): PlotInstance[] {
    if (!Array.isArray(raw)) return [];
    const out: PlotInstance[] = [];
    for (const v of raw) {
        if (!v || typeof v !== 'object') continue;
        const { id, title, settings } = v as Record<string, unknown>;
        if (typeof id !== 'string' || !isModelViewId(id) || out.some(o => o.id === id)) continue;
        const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? { ...(settings as Record<string, unknown>) } : {};
        s.viewKind = s.viewKind === 'section' ? 'section' : '3d';
        out.push({ id, type: 'map3d', title: typeof title === 'string' && title.trim() ? title.trim() : `View ${out.length + 1}`, settings: s });
        if (out.length === MAX_MODEL_VIEWS) break;
    }
    return out;
}
