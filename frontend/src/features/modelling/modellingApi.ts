/**
 * The Modelling page's dock: its API while mounted, and the dock operations
 * used from outside it (the page's toolbar, the report). Null API when the
 * page is not shown; the operations are then no-ops.
 *
 * Panels: the project tree at the left, one panel per model view (panel id
 * === view id) in the middle, and the properties at the right with the
 * attributes a tab beside them. The properties can be floated over the
 * views and put back. A model's age order as a table opens in a window of
 * its own over the views.
 */
import type { DockviewApi } from 'dockview-react';
import { useAppStore, type PlotInstance } from '../../store/appStore';
import { useModelStore } from '../../store/modelStore';
import { activeModelView, isModelViewId, useModellingStore, type ModelViewKind } from '../../store/modellingStore';
import { parseKey } from '../model/objectKeys';
import { t } from '../model/terms';
import { useViewRegistry } from '../model/viewRegistry';
import { snapshotLayout } from '../workspace/workspaceApi';

export const MODEL_PANEL_IDS = {
    tree: 'model:tree',
    properties: 'model:properties',
    attributes: 'model:attributes',
    chronology: 'model:chronology',
} as const;
export const MODEL_FIXED_IDS: readonly string[] = Object.values(MODEL_PANEL_IDS);

export const MODEL_PANE_TITLES: Record<string, string> = {
    [MODEL_PANEL_IDS.tree]: 'Project',
    [MODEL_PANEL_IDS.properties]: 'Properties',
    [MODEL_PANEL_IDS.attributes]: 'Attributes',
    [MODEL_PANEL_IDS.chronology]: t('chronology'),
};
const PANE_COMPONENT: Record<string, string> = {
    [MODEL_PANEL_IDS.tree]: 'tree',
    [MODEL_PANEL_IDS.properties]: 'properties',
    [MODEL_PANEL_IDS.attributes]: 'attributes',
    [MODEL_PANEL_IDS.chronology]: 'chronology',
};

/** Width of the tree's column when first laid out */
export const LEFT_WIDTH = 300;
/** Width of the properties' column when first laid out: room for an editor's tabs */
export const RIGHT_WIDTH = 400;

/** A pane as a place to put others beside: only when it is in the dock itself (not floated over it) */
function docked(api: DockviewApi, id: string) {
    const panel = api.getPanel(id);
    return panel && panel.group.api.location.type === 'grid' ? panel : undefined;
}

let current: DockviewApi | null = null;

export function setModellingApi(api: DockviewApi | null): void {
    current = api;
}

export function getModellingApi(): DockviewApi | null {
    return current;
}

/**
 * A view's panel: beside the views already open (the active one, else any),
 * else between the tree and the properties, which keep their sides.
 */
export function addViewPanel(api: DockviewApi, view: PlotInstance, inactive: boolean): void {
    const ref = (api.activePanel && isModelViewId(api.activePanel.id) ? api.activePanel : undefined)
        ?? api.panels.find(p => isModelViewId(p.id));
    const left = docked(api, MODEL_PANEL_IDS.tree);
    const right = docked(api, MODEL_PANEL_IDS.properties) ?? docked(api, MODEL_PANEL_IDS.attributes);
    // The views share the room: the columns either side keep their widths (the first view: back to the columns' own)
    const widths = { left: ref ? left?.group.api.width ?? 0 : LEFT_WIDTH, right: ref ? right?.group.api.width ?? 0 : RIGHT_WIDTH };
    api.addPanel({
        id: view.id,
        component: 'view',
        title: view.title,
        params: { plotId: view.id },
        inactive,
        position: ref ? { referencePanel: ref.id, direction: 'right' }
            : left ? { referencePanel: left.id, direction: 'right' }
                : right ? { referencePanel: right.id, direction: 'left' } : { direction: 'right' },
    });
    if (left && widths.left > 0) left.group.api.setSize({ width: widths.left });
    if (right && right.group !== left?.group && widths.right > 0) right.group.api.setSize({ width: widths.right });
}

/**
 * The tree at the left, full height; the properties at the right, full height; the attributes (the samples' colours)
 * a tab beside the properties; the age order as a table in a window of its own along the foot of the views.
 */
export function addModelPane(api: DockviewApi, id: string): void {
    if (api.getPanel(id)) return;
    const base = { id, component: PANE_COMPONENT[id], title: MODEL_PANE_TITLES[id], inactive: true };
    if (id === MODEL_PANEL_IDS.chronology) {
        // (A table wants width, not a column: it floats along the foot of the views, clear of the tree and of the properties)
        const tree = docked(api, MODEL_PANEL_IDS.tree)?.group.api.width ?? 0;
        const side = (docked(api, MODEL_PANEL_IDS.properties) ?? docked(api, MODEL_PANEL_IDS.attributes))?.group.api.width ?? 0;
        const width = Math.max(480, Math.min(880, api.width - tree - side - 32));
        api.addPanel({ ...base, inactive: false, floating: { width, height: 260, position: { bottom: 24, left: Math.max(16, Math.min(tree + 16, api.width - width - 16)) } } });
        return;
    }
    if (id === MODEL_PANEL_IDS.tree) {
        const panel = api.addPanel({ ...base, position: { direction: 'left' } });
        if (api.groups.length > 1) panel.group.api.setSize({ width: LEFT_WIDTH });
        return;
    }
    const other = docked(api, id === MODEL_PANEL_IDS.properties ? MODEL_PANEL_IDS.attributes : MODEL_PANEL_IDS.properties);
    if (other) {
        api.addPanel({ ...base, position: { referencePanel: other.id, direction: 'within' } });
        return;
    }
    const panel = api.addPanel({ ...base, position: { direction: 'right' } });
    if (api.groups.length > 1) panel.group.api.setSize({ width: RIGHT_WIDTH });
}

/**
 * Open a view of the model and make it the one in force (null: as many are
 * open as can be). It looks along the scene's coordinate columns when the
 * scene has them. (What is made and changed is in the tree and the
 * properties.)
 * A section view opens on the section set picked in the tree, else the one
 * the view in force looks along, else the first.
 */
export function newModelView(kind: ModelViewKind = '3d'): string | null {
    const scene = useModelStore.getState().scene;
    const coords = scene.coords;
    const settings: Record<string, unknown> = {};
    if (coords) Object.assign(settings, { xAxis: coords.x, yAxis: coords.y, zAxis: coords.z });
    if (kind === 'section') {
        const tree = useModellingStore.getState();
        const picked = tree.selected.map(k => parseKey(k)).find(p => p?.kind === 'sectionSet')?.id;
        const inForce = activeModelView(useAppStore.getState().modelViews, tree.activeViewId);
        const along = inForce ? useViewRegistry.getState().status[inForce.id]?.viewingSet : null;
        const set = [picked, along].find(id => id && scene.sectionSets?.some(s => s.id === id));
        if (set) settings.sectionLast = set;
    }
    const id = useAppStore.getState().addModelView(kind, { settings });
    if (id) useModellingStore.getState().setActiveView(id);
    return id;
}

/** Bring a pane up (opening it where it goes when it is closed) */
export function showModelPane(id: string): void {
    const api = current;
    if (!api) return;
    const had = !!api.getPanel(id);
    addModelPane(api, id);
    api.getPanel(id)?.api.setActive();
    if (!had) useModellingStore.getState().setLayout(snapshotLayout(api));
}

/** Show or hide the tree, the properties or the attributes (the page's toolbar) */
export function toggleModelPane(id: string): void {
    const api = current;
    if (!api) return;
    const panel = api.getPanel(id);
    if (panel) api.removePanel(panel);
    else {
        addModelPane(api, id);
        api.getPanel(id)?.api.setActive();
    }
    useModellingStore.getState().setLayout(snapshotLayout(api));
}

/** A pane is in a window of its own over the views */
export function isModelPaneFloating(id: string): boolean {
    return current?.getPanel(id)?.group.api.location.type === 'floating';
}

/**
 * Lift a pane out of the dock into a window of its own over the views (room
 * to work in an editor without narrowing the views), or put it back where
 * it goes. The panes that are tabs beside it (the attributes, beside the
 * properties) go with it, so that the column is given up to the views.
 */
export function floatModelPane(id: string): void {
    const api = current;
    if (!api) return;
    const panel = api.getPanel(id);
    // The room given up or taken goes to the views: the tree keeps its width
    const tree = docked(api, MODEL_PANEL_IDS.tree);
    const treeWidth = tree && id !== MODEL_PANEL_IDS.tree ? tree.group.api.width : 0;
    const back = !!panel && panel.group.api.location.type === 'floating';
    if (panel && back) {
        const with_ = panel.group.panels.map(p => p.id).filter(x => x !== id && PANE_COMPONENT[x]);
        for (const x of [id, ...with_]) { const p = api.getPanel(x); if (p) api.removePanel(p); }
        for (const x of [id, ...with_]) addModelPane(api, x);
    } else {
        if (!panel) addModelPane(api, id);
        const made = api.getPanel(id);
        // (A view sharing its tabs stays where it is)
        const whole = made?.group.panels.every(p => PANE_COMPONENT[p.id]);
        if (made) api.addFloatingGroup(whole ? made.group : made, { width: 460, height: Math.max(360, Math.min(720, api.height - 96)), position: { top: 48, right: 24 } });
    }
    if (tree && treeWidth > 0 && api.groups.some(g => g !== tree.group && g.api.location.type === 'grid')) tree.group.api.setSize({ width: treeWidth });
    const side = back ? docked(api, id) : undefined;
    if (side && side.group !== tree?.group && api.groups.length > 1 && id !== MODEL_PANEL_IDS.tree) side.group.api.setSize({ width: RIGHT_WIDTH });
    api.getPanel(id)?.api.setActive();
    useModellingStore.getState().setLayout(snapshotLayout(api));
}
