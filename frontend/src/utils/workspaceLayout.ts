/**
 * Pure helpers over the serialized dock layout (dockview SerializedDockview):
 * prune panels that no longer exist, find what is missing, and remap panel
 * ids (layout templates). Kept structural so they need no DOM.
 */

/** Fixed (non-plot) dock panels. */
export const PANEL_IDS = {
    grid: 'panel:grid',
    attributes: 'panel:attributes',
    workflows: 'panel:workflows',
} as const;
export const FIXED_PANEL_IDS: readonly string[] = Object.values(PANEL_IDS);

export interface GroupState {
    views: string[];
    activeView?: string;
    id: string;
    [k: string]: unknown;
}
export interface GridNode {
    type: 'leaf' | 'branch';
    data: GroupState | GridNode[];
    size?: number;
    visible?: boolean;
}
export interface SerializedLayout {
    grid: { root: GridNode; height: number; width: number; orientation: string };
    panels: Record<string, { id: string; [k: string]: unknown }>;
    activeGroup?: string;
    floatingGroups?: { data?: GroupState; [k: string]: unknown }[];
    popoutGroups?: unknown[];
    edgeGroups?: unknown;
    [k: string]: unknown;
}

export function isSerializedLayout(x: unknown): x is SerializedLayout {
    const l = x as SerializedLayout;
    return !!l && typeof l === 'object' && !!l.grid && !!l.grid.root && typeof l.panels === 'object' && l.panels !== null;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

function pruneGroup(g: GroupState, keep: (id: string) => boolean): GroupState | null {
    const views = g.views.filter(keep);
    if (!views.length) return null;
    return { ...g, views, activeView: g.activeView && views.includes(g.activeView) ? g.activeView : views[0] };
}

function pruneNode(node: GridNode, keep: (id: string) => boolean): GridNode | null {
    if (node.type === 'leaf') {
        const g = pruneGroup(node.data as GroupState, keep);
        return g ? { ...node, data: g } : null;
    }
    const children = (node.data as GridNode[]).map(c => pruneNode(c, keep)).filter((c): c is GridNode => !!c);
    if (!children.length) return null;
    return { ...node, data: children };
}

/** All panel ids in a layout (grid and floating groups). */
export function layoutPanelIds(layout: SerializedLayout): string[] {
    const out: string[] = [];
    const walk = (n: GridNode) => {
        if (n.type === 'leaf') out.push(...(n.data as GroupState).views);
        else (n.data as GridNode[]).forEach(walk);
    };
    walk(layout.grid.root);
    for (const f of layout.floatingGroups ?? []) if (f.data) out.push(...f.data.views);
    return out;
}

/**
 * Drop panels that are not in `validIds` (closed plots, unknown panes),
 * empty groups and popout windows. Returns null when nothing remains (the
 * caller then builds a default layout).
 */
export function reconcileLayout(layout: unknown, validIds: Iterable<string>): SerializedLayout | null {
    if (!isSerializedLayout(layout)) return null;
    const valid = new Set(validIds);
    const keep = (id: string) => valid.has(id) && !!layout.panels[id];
    const l = clone(layout);
    let root = pruneNode(l.grid.root, keep);
    if (!root) return null;
    // dockview expects a branch at the root
    if (root.type === 'leaf') root = { type: 'branch', data: [root], size: l.grid.root.size };
    l.grid.root = root;
    l.floatingGroups = (l.floatingGroups ?? [])
        .map(f => (f.data ? { ...f, data: pruneGroup(f.data, keep) } : f))
        .filter(f => !('data' in f) || f.data) as SerializedLayout['floatingGroups'];
    delete l.popoutGroups; // popout windows are not restored
    const present = new Set(layoutPanelIds(l));
    l.panels = Object.fromEntries(Object.entries(l.panels).filter(([id]) => present.has(id)));
    const groups: string[] = [];
    const walk = (n: GridNode) => { if (n.type === 'leaf') groups.push((n.data as GroupState).id); else (n.data as GridNode[]).forEach(walk); };
    walk(l.grid.root);
    if (l.activeGroup && !groups.includes(l.activeGroup)) l.activeGroup = groups[0];
    return l;
}

/** Ids in `wanted` that the layout does not contain. */
export function missingPanelIds(layout: SerializedLayout | null, wanted: Iterable<string>): string[] {
    const have = new Set(layout ? layoutPanelIds(layout) : []);
    return [...wanted].filter(id => !have.has(id));
}

/** Rename panel ids (e.g. template plot ids → new plot ids). Unmapped ids are kept. */
export function remapLayoutIds(layout: SerializedLayout, idMap: Record<string, string>): SerializedLayout {
    const m = (id: string) => idMap[id] ?? id;
    const l = clone(layout);
    const fixGroup = (g: GroupState) => { g.views = g.views.map(m); if (g.activeView) g.activeView = m(g.activeView); };
    const walk = (n: GridNode) => { if (n.type === 'leaf') fixGroup(n.data as GroupState); else (n.data as GridNode[]).forEach(walk); };
    walk(l.grid.root);
    for (const f of l.floatingGroups ?? []) if (f.data) fixGroup(f.data);
    l.panels = Object.fromEntries(Object.entries(l.panels).map(([id, p]) => {
        const nid = m(id);
        const params = (p.params ?? {}) as Record<string, unknown>;
        return [nid, { ...p, id: nid, ...(params.plotId ? { params: { ...params, plotId: nid } } : {}) }];
    }));
    return l;
}

/**
 * Structure of a layout (nesting, groups, panel order) without sizes, so a
 * re-measured or resized-only layout compares equal. Used for dirty tracking.
 */
export function layoutSignature(layout: SerializedLayout | null): string {
    if (!layout) return '';
    const walk = (n: GridNode): unknown => (n.type === 'leaf' ? (n.data as GroupState).views : (n.data as GridNode[]).map(walk));
    return JSON.stringify([layout.grid.orientation, walk(layout.grid.root), (layout.floatingGroups ?? []).map(f => f.data?.views ?? [])]);
}
