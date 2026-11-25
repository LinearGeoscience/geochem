/**
 * The mounted dock's API plus the dock operations used outside the
 * Workspace component (toolbar, shortcuts). Null API when the Plots view is
 * not mounted; operations are then no-ops.
 */
import type { DockviewApi, AddPanelPositionOptions } from 'dockview-react';
import type { PlotInstance } from '../../store/appStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useAppStore } from '../../store/appStore';
import { PANEL_IDS, FIXED_PANEL_IDS, SerializedLayout } from '../../utils/workspaceLayout';

let current: DockviewApi | null = null;

export function setWorkspaceApi(api: DockviewApi | null): void {
    current = api;
}

export function getWorkspaceApi(): DockviewApi | null {
    return current;
}

export const PANE_TITLES: Record<string, string> = {
    [PANEL_IDS.grid]: 'Data grid',
    [PANEL_IDS.attributes]: 'Attributes',
    [PANEL_IDS.workflows]: 'Workflows',
};
const PANE_COMPONENT: Record<string, string> = {
    [PANEL_IDS.grid]: 'grid',
    [PANEL_IDS.attributes]: 'attributes',
    [PANEL_IDS.workflows]: 'workflows',
};

const isPlotPanel = (id: string) => !FIXED_PANEL_IDS.includes(id);

export function snapshotLayout(api: DockviewApi): SerializedLayout | null {
    return api.panels.length ? (api.toJSON() as unknown as SerializedLayout) : null;
}

/**
 * Where a new plot goes: tabbed next to `refId`, the active plot or any plot;
 * otherwise above the grid / left of the attributes; otherwise anywhere.
 */
function plotPosition(api: DockviewApi, refId?: string): AddPanelPositionOptions | undefined {
    const plotRef = (refId && api.getPanel(refId))
        || (api.activePanel && isPlotPanel(api.activePanel.id) ? api.activePanel : undefined)
        || api.panels.find(p => isPlotPanel(p.id));
    if (plotRef) return { referencePanel: plotRef.id, direction: 'within' };
    if (api.getPanel(PANEL_IDS.grid)) return { referencePanel: PANEL_IDS.grid, direction: 'above' };
    if (api.getPanel(PANEL_IDS.attributes)) return { referencePanel: PANEL_IDS.attributes, direction: 'left' };
    // Only the Workflows pane open: a plot must not become a tab inside it
    if (api.getPanel(PANEL_IDS.workflows)) return { referencePanel: PANEL_IDS.workflows, direction: 'right' };
    return undefined;
}

export function addPlotPanel(api: DockviewApi, plot: PlotInstance, inactive: boolean, refId?: string): void {
    const position = plotPosition(api, refId);
    api.addPanel({
        id: plot.id,
        component: 'plot',
        tabComponent: 'plot',
        title: plot.title,
        params: { plotId: plot.id },
        inactive,
        ...(position ? { position } : {}),
    });
    // First plot above the grid: give the plot the room, not a 50/50 split
    if (position && 'referencePanel' in position && position.referencePanel === PANEL_IDS.grid) {
        api.getPanel(PANEL_IDS.grid)?.group.api.setSize({ height: 240 });
    }
}

/**
 * Rows x columns for n tiles in an area of width/height `aspect`: tiles as
 * close to square as possible, few empty cells; ties go to more columns.
 */
export function tileGrid(n: number, aspect = 1): { rows: number; cols: number } {
    let best = { rows: n, cols: 1 }, bestScore = Infinity;
    for (let cols = n; cols >= 1; cols--) {
        const rows = Math.ceil(n / cols);
        const cell = (aspect / cols) / (1 / rows);
        const score = Math.abs(Math.log(cell)) + 0.3 * (rows * cols - n) / n;
        if (score < bestScore - 1e-9) { best = { rows, cols }; bestScore = score; }
    }
    return best;
}

/**
 * Tile plot panels in an even grid (opens a template's plots side by
 * side) inside the area of the first one: row leaders stack down the first
 * column, the rest of each row goes to its right, then sizes are evened out.
 * Without ids, every plot panel. Returns the number of plots tiled.
 */
export function tilePlots(ids?: string[]): number {
    const api = getWorkspaceApi();
    if (!api) return 0;
    const panels = (ids ?? api.panels.map(p => p.id).filter(isPlotPanel))
        .map(id => api.getPanel(id)).filter((p): p is NonNullable<typeof p> => !!p);
    if (panels.length < 2) return panels.length;
    const first = panels[0];
    // Own group for the first plot when it shares one with plots left out of the tiling
    const tiled = new Set(panels.map(p => p.id));
    if (first.group.panels.some(p => !tiled.has(p.id))) first.api.moveTo({ group: first.group, position: 'right' });
    const W = first.group.api.width, H = first.group.api.height;
    const { rows, cols } = tileGrid(panels.length, W > 0 && H > 0 ? W / H : 1);
    const leaders = [first];
    for (let r = 1; r < rows; r++) {
        const p = panels[r * cols];
        p.api.moveTo({ group: leaders[r - 1].group, position: 'bottom' });
        leaders.push(p);
    }
    for (let r = 0; r < rows; r++) {
        let prev = leaders[r];
        for (let c = 1; c < cols; c++) {
            const p = panels[r * cols + c];
            if (!p) break;
            p.api.moveTo({ group: prev.group, position: 'right' });
            prev = p;
        }
    }
    // Even out: equal widths within each row, equal row heights
    for (let r = 0; r < rows; r++) {
        const row = panels.slice(r * cols, r * cols + cols);
        for (const p of row) p.group.api.setSize({ width: W / row.length });
        leaders[r].group.api.setSize({ height: H / rows });
    }
    first.api.setActive();
    return panels.length;
}

/** Tile once the panels for these plots exist (they are added by the workspace's plot sync) */
export function tilePlotsWhenReady(ids: string[], tries = 20): void {
    const api = getWorkspaceApi();
    if (api && ids.every(id => api.getPanel(id))) {
        tilePlots(ids);
        return;
    }
    if (tries > 0) setTimeout(() => tilePlotsWhenReady(ids, tries - 1), 100);
}

/** Add a fixed pane at its home position: attributes right (full height), grid below the plots. */
export function addFixedPane(api: DockviewApi, id: string): void {
    if (api.getPanel(id)) return;
    const base = { id, component: PANE_COMPONENT[id], title: PANE_TITLES[id], inactive: true };
    if (id === PANEL_IDS.attributes) {
        const panel = api.addPanel({ ...base, position: { direction: 'right' } });
        // initialWidth/Height are only hints when splitting; size the new group explicitly
        panel.group.api.setSize({ width: 360 });
        return;
    }
    if (id === PANEL_IDS.workflows) {
        // Workflow steps on the left, full height, narrow
        const panel = api.addPanel({ ...base, position: { direction: 'left' } });
        panel.group.api.setSize({ width: 300 });
        return;
    }
    const plot = api.panels.find(p => isPlotPanel(p.id));
    const panel = api.addPanel({
        ...base,
        position: plot ? { referenceGroup: plot.group, direction: 'below' } : { direction: 'left' },
    });
    if (plot) panel.group.api.setSize({ height: 240 });
}

/** Make sure a fixed pane is open and active (no-op when the dock is not mounted). */
export function showFixedPane(id: string): boolean {
    const api = current;
    if (!api) return false;
    if (!api.getPanel(id)) addFixedPane(api, id);
    api.getPanel(id)?.api.setActive();
    useWorkspaceStore.getState().setLayout(snapshotLayout(api));
    return true;
}

/**
 * Open the Workflows pane from anywhere (command finder, other views): switch
 * to the Plots view and show the pane once the dock has mounted.
 */
export function openWorkflowsPane(tries = 20): void {
    useAppStore.getState().setCurrentView('plots');
    if (showFixedPane(PANEL_IDS.workflows)) return;
    if (tries > 0) setTimeout(() => openWorkflowsPane(tries - 1), 100);
}

/** Show or hide a fixed pane (toolbar, Alt+G / Alt+A / Alt+F). */
export function toggleFixedPane(id: string): void {
    const api = current;
    if (!api) return;
    const panel = api.getPanel(id);
    if (panel) api.removePanel(panel);
    else {
        addFixedPane(api, id);
        api.getPanel(id)?.api.setActive();
    }
    useWorkspaceStore.getState().setLayout(snapshotLayout(api));
}
