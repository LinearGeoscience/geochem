/**
 * The Modelling page's dock (a second dockview, apart from the Plots page's):
 * the project tree on the left, the views of the model in the middle, the
 * properties (an object's editor) on the right. `appStore.modelViews` says which views exist and what they are
 * called; the dock owns the arrangement, mirrored into the modelling store
 * and saved with the project.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { Box, Button, IconButton, Tooltip, Typography } from '@mui/material';
import { Add, OpenInNew, VerticalAlignBottom } from '@mui/icons-material';
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type IDockviewHeaderActionsProps, type IWatermarkPanelProps } from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';
import { useAppStore } from '../../store/appStore';
import { useUIStore } from '../../store/uiStore';
import { activeModelView, isModelViewId, useModellingStore } from '../../store/modellingStore';
import { missingPanelIds, reconcileLayout } from '../../utils/workspaceLayout';
import { DockThemeStyles } from '../workspace/dockTheme';
import { dockTheme } from '../workspace/dockThemeConfig';
import { snapshotLayout } from '../workspace/workspaceApi';
import { ChronologyPane } from './ChronologyPane';
import { addModelPane, addViewPanel, floatModelPane, MODEL_FIXED_IDS, MODEL_PANEL_IDS, newModelView, setModellingApi } from './modellingApi';
import { AttributesPane } from './AttributesPane';
import { ModelViewPane } from './ModelViewPane';
import { PropertiesPane } from './PropertiesPane';
import { ProjectTreePane } from './tree/ProjectTreePane';

const components = { view: ModelViewPane, tree: ProjectTreePane, properties: PropertiesPane, attributes: AttributesPane, chronology: ChronologyPane };

const Watermark: React.FC<IWatermarkPanelProps> = () => (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5 }}>
        <Typography variant="h6" color="text.secondary">No views of the model open</Typography>
        <Button variant="contained" startIcon={<Add />} onClick={() => newModelView('3d')}>New 3D view</Button>
    </Box>
);

/** At the right of the properties' tabs: float them over the views, or put them back in the dock */
const PaneActions: React.FC<IDockviewHeaderActionsProps> = ({ panels, location }) => {
    if (!panels.some(p => p.id === MODEL_PANEL_IDS.properties)) return null;
    const floating = location?.type === 'floating';
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%', pr: 0.5 }}>
            <Tooltip title={floating ? 'Put the properties back in the dock, at the right' : 'Float the properties over the views: room for an editor, and the views keep their width'}>
                <IconButton size="small" data-action="float-properties" aria-label={floating ? 'Dock the properties' : 'Float the properties'} onClick={() => floatModelPane(MODEL_PANEL_IDS.properties)} sx={{ p: 0.25 }}>
                    {floating ? <VerticalAlignBottom sx={{ fontSize: 16 }} /> : <OpenInNew sx={{ fontSize: 16 }} />}
                </IconButton>
            </Tooltip>
        </Box>
    );
};

export const ModellingWorkspace: React.FC = () => {
    const apiRef = useRef<DockviewApi | null>(null);
    // True while the dock is being changed from the store side (load / sync)
    const syncing = useRef(false);
    const saveTimer = useRef<number | undefined>(undefined);
    // Which views there are and their titles (not their settings, which change with every turn of the camera)
    const viewList = useAppStore(s => s.modelViews.map(v => `${v.id}\u0000${v.title}`).join('\u0001'));
    const revision = useModellingStore(s => s.revision);
    const themeMode = useUIStore(s => s.themeMode);

    /**
     * Build the dock from the stored layout, then add the views it lacks. No
     * stored layout: the tree on the left, the properties on the right, the
     * views between them (and a first 3D view when none is open).
     */
    const load = useCallback((api: DockviewApi) => {
        const current = useAppStore.getState().modelViews;
        const saved = useModellingStore.getState().layout;
        const stored = reconcileLayout(saved, [...current.map(v => v.id), ...MODEL_FIXED_IDS]);
        syncing.current = true;
        try {
            api.clear();
            if (stored) {
                try { api.fromJSON(stored as never); } catch (e) { console.warn('Modelling layout could not be restored', e); api.clear(); }
            }
            if (!api.panels.length) {
                addModelPane(api, MODEL_PANEL_IDS.tree);
                addModelPane(api, MODEL_PANEL_IDS.properties);
                addModelPane(api, MODEL_PANEL_IDS.attributes);
            }
            const missing = new Set(missingPanelIds(snapshotLayout(api), current.map(v => v.id)));
            for (const v of current) if (missing.has(v.id)) addViewPanel(api, v, true);
            for (const v of current) {
                const panel = api.getPanel(v.id);
                if (panel && panel.title !== v.title) panel.api.setTitle(v.title);
            }
            const active = activeModelView(current, useModellingStore.getState().activeViewId);
            if (active) api.getPanel(active.id)?.api.setActive();
        } finally {
            syncing.current = false;
        }
        useModellingStore.getState().setLayout(snapshotLayout(api));
        // First time the page opens: one view of the model
        if (!saved && current.length === 0) newModelView('3d');
    }, []);

    const onReady = useCallback((event: DockviewReadyEvent) => {
        const api = event.api;
        apiRef.current = api;
        setModellingApi(api);
        load(api);

        api.onDidActivePanelChange(e => {
            if (syncing.current) return;
            const id = e.panel?.id;
            if (isModelViewId(id)) useModellingStore.getState().setActiveView(id!);
        });
        // A view closed through the dock itself (not via the store)
        api.onDidRemovePanel(panel => {
            if (syncing.current || !isModelViewId(panel.id)) return;
            const id = panel.id;
            // Moves remove then re-add: check after the move settles
            queueMicrotask(() => {
                if (apiRef.current?.getPanel(id)) return;
                useAppStore.getState().removeModelView(id);
            });
        });
        api.onDidLayoutChange(() => {
            if (syncing.current) return;
            window.clearTimeout(saveTimer.current);
            saveTimer.current = window.setTimeout(() => {
                const a = apiRef.current;
                if (a) useModellingStore.getState().setLayout(snapshotLayout(a));
            }, 250);
        });
    }, [load]);

    useEffect(() => () => { window.clearTimeout(saveTimer.current); setModellingApi(null); }, []);

    // Layout replaced from outside (project load, reset)
    const firstRevision = useRef(revision);
    useEffect(() => {
        if (revision === firstRevision.current) return;
        firstRevision.current = revision;
        if (apiRef.current) load(apiRef.current);
    }, [revision, load]);

    // Store -> dock: views opened, closed, renamed
    useEffect(() => {
        const api = apiRef.current;
        if (!api) return;
        const views = useAppStore.getState().modelViews;
        const ids = new Set(views.map(v => v.id));
        let changed = false;
        syncing.current = true;
        try {
            for (const panel of [...api.panels]) {
                if (isModelViewId(panel.id) && !ids.has(panel.id)) {
                    api.removePanel(panel);
                    changed = true;
                }
            }
            const active = useModellingStore.getState().activeViewId;
            for (const v of views) {
                const panel = api.getPanel(v.id);
                if (!panel) {
                    addViewPanel(api, v, v.id !== active);
                    changed = true;
                } else if (panel.title !== v.title) panel.api.setTitle(v.title);
            }
        } finally {
            syncing.current = false;
        }
        if (changed) useModellingStore.getState().setLayout(snapshotLayout(api));
    }, [viewList]);

    return (
        <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
            <DockThemeStyles />
            <DockviewReact
                className="geochem-workspace geochem-modelling"
                theme={dockTheme(themeMode)}
                components={components}
                watermarkComponent={Watermark}
                rightHeaderActionsComponent={PaneActions}
                defaultRenderer="onlyWhenVisible"
                onReady={onReady}
            />
        </Box>
    );
};

export default ModellingWorkspace;
