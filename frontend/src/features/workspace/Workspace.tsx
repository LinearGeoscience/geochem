/**
 * Dockable plot workspace (dockview). One panel per plot instance (panel id
 * === plot id). The plot store stays the source of truth for which plots
 * exist, their titles and the active plot; the dock owns the arrangement,
 * which is mirrored into the workspace store (saved with the project).
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { Add } from '@mui/icons-material';
import { DockviewReact, DockviewApi, DockviewReadyEvent, IWatermarkPanelProps } from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';
import { useAppStore } from '../../store/appStore';
import { useUIStore } from '../../store/uiStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { reconcileLayout, missingPanelIds, FIXED_PANEL_IDS, PANEL_IDS } from '../../utils/workspaceLayout';
import { registerShortcut } from '../../utils/shortcuts';
import { PlotPane } from './PlotPane';
import { PlotTab } from './PlotTab';
import { DockThemeStyles } from './dockTheme';
import { dockTheme } from './dockThemeConfig';
import { addPlotToReport } from '../../utils/reportCapture';
import { setWorkspaceApi, addPlotPanel, addFixedPane, snapshotLayout, toggleFixedPane } from './workspaceApi';
import { GridPane, AttributesPane, WorkflowsPane } from './FixedPanes';

const components = { plot: PlotPane, grid: GridPane, attributes: AttributesPane, workflows: WorkflowsPane };
const tabComponents = { plot: PlotTab };

const Watermark: React.FC<IWatermarkPanelProps> = () => (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5 }}>
        <Typography variant="h6" color="text.secondary">No plots open</Typography>
        <Button variant="contained" startIcon={<Add />} onClick={() => useUIStore.getState().setNewPlotDialogOpen(true)}>
            New plot (Alt+N)
        </Button>
    </Box>
);

export const Workspace: React.FC = () => {
    const apiRef = useRef<DockviewApi | null>(null);
    // True while the dock is being changed from the store side (load / sync)
    const syncing = useRef(false);
    const saveTimer = useRef<number | undefined>(undefined);
    const plots = useAppStore(s => s.plots);
    const activePlotId = useAppStore(s => s.activePlotId);
    const revision = useWorkspaceStore(s => s.revision);
    const themeMode = useUIStore(s => s.themeMode);

    /**
     * Build the dock from the stored layout, then add any plots it lacks.
     * No stored layout = the default: plots as tabs, grid below, attributes
     * on the right (and a first scatter when data is loaded but no plots).
     */
    const load = useCallback((api: DockviewApi) => {
        const { plots: current, activePlotId: active } = useAppStore.getState();
        const isDefault = !useWorkspaceStore.getState().layout;
        const valid = [...current.map(p => p.id), ...FIXED_PANEL_IDS];
        const stored = reconcileLayout(useWorkspaceStore.getState().layout, valid);
        syncing.current = true;
        try {
            api.clear();
            if (stored) {
                try { api.fromJSON(stored as never); } catch (e) { console.warn('Workspace layout could not be restored', e); api.clear(); }
            }
            const missing = new Set(missingPanelIds(snapshotLayout(api), current.map(p => p.id)));
            let prev: string | undefined;
            for (const p of current) {
                if (missing.has(p.id)) addPlotPanel(api, p, true, prev);
                prev = p.id;
            }
            for (const p of current) {
                const panel = api.getPanel(p.id);
                if (panel && panel.title !== p.title) panel.api.setTitle(p.title);
            }
            if (isDefault) {
                addFixedPane(api, PANEL_IDS.grid);
                addFixedPane(api, PANEL_IDS.attributes);
            }
            const target = (active && api.getPanel(active)) || api.panels.find(p => !FIXED_PANEL_IDS.includes(p.id)) || api.panels[0];
            target?.api.setActive();
        } finally {
            syncing.current = false;
        }
        useWorkspaceStore.getState().setLayout(snapshotLayout(api));
        // Fresh dataset, nothing open yet: start with a suggested scatter
        const s = useAppStore.getState();
        if (isDefault && s.plots.length === 0 && s.columnarData.rowCount > 0) s.addPlot('scatter');
    }, []);

    const onReady = useCallback((event: DockviewReadyEvent) => {
        const api = event.api;
        apiRef.current = api;
        setWorkspaceApi(api);
        load(api);

        api.onDidActivePanelChange(e => {
            if (syncing.current) return;
            const id = e.panel?.id;
            const s = useAppStore.getState();
            if (id && id !== s.activePlotId && s.plots.some(p => p.id === id)) s.setActivePlotId(id);
        });
        // A panel closed through the dock itself (not via the store)
        api.onDidRemovePanel(panel => {
            if (syncing.current) return;
            const id = panel.id;
            // Moves remove then re-add: check after the move settles
            queueMicrotask(() => {
                if (apiRef.current?.getPanel(id)) return;
                const s = useAppStore.getState();
                if (s.plots.some(p => p.id === id)) s.removePlot(id);
            });
        });
        api.onDidLayoutChange(() => {
            if (syncing.current) return;
            window.clearTimeout(saveTimer.current);
            saveTimer.current = window.setTimeout(() => {
                const a = apiRef.current;
                if (a) useWorkspaceStore.getState().setLayout(snapshotLayout(a));
            }, 250);
        });
    }, [load]);

    useEffect(() => () => { window.clearTimeout(saveTimer.current); setWorkspaceApi(null); }, []);

    // Layout replaced from outside (project load, template, reset)
    const firstRevision = useRef(revision);
    useEffect(() => {
        if (revision === firstRevision.current) return;
        firstRevision.current = revision;
        if (apiRef.current) load(apiRef.current);
    }, [revision, load]);

    // Store → dock: plots added / removed / renamed
    useEffect(() => {
        const api = apiRef.current;
        if (!api) return;
        const ids = new Set(plots.map(p => p.id));
        syncing.current = true;
        try {
            for (const panel of [...api.panels]) {
                if (!ids.has(panel.id) && !FIXED_PANEL_IDS.includes(panel.id)) api.removePanel(panel);
            }
            const active = useAppStore.getState().activePlotId;
            for (const p of plots) {
                const panel = api.getPanel(p.id);
                if (!panel) addPlotPanel(api, p, p.id !== active);
                else if (panel.title !== p.title) panel.api.setTitle(p.title);
            }
        } finally {
            syncing.current = false;
        }
    }, [plots]);

    // Store → dock: active plot
    useEffect(() => {
        const api = apiRef.current;
        if (!api || !activePlotId || api.activePanel?.id === activePlotId) return;
        const panel = api.getPanel(activePlotId);
        if (!panel) return;
        syncing.current = true;
        try { panel.api.setActive(); } finally { syncing.current = false; }
    }, [activePlotId]);

    // F2 renames the active plot's tab; Alt+G / Alt+A / Alt+F toggle the grid / attributes / workflows panes
    useEffect(() => {
        const off = [
            registerShortcut('renamePlot', () => {
                const id = useAppStore.getState().activePlotId;
                if (id) useWorkspaceStore.getState().setRenamingPlotId(id);
            }),
            registerShortcut('toggleGrid', () => toggleFixedPane(PANEL_IDS.grid)),
            registerShortcut('toggleAttributes', () => toggleFixedPane(PANEL_IDS.attributes)),
            registerShortcut('toggleWorkflows', () => toggleFixedPane(PANEL_IDS.workflows)),
            registerShortcut('addToReport', () => {
                const id = useAppStore.getState().activePlotId;
                if (id) void addPlotToReport(id);
            }),
        ];
        return () => off.forEach(f => f());
    }, []);

    return (
        <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
            <DockThemeStyles />
            <DockviewReact
                className="geochem-workspace"
                theme={dockTheme(themeMode)}
                components={components}
                tabComponents={tabComponents}
                watermarkComponent={Watermark}
                defaultRenderer="onlyWhenVisible"
                onReady={onReady}
            />
        </Box>
    );
};

export default Workspace;
