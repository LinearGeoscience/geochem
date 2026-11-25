/**
 * The Modelling page: a toolbar over its own dock (the project tree, the
 * properties and the views of the model). Lazy-loaded, as the Plots page is.
 * Leaving the page closes the surface being edited, so no hidden view keeps
 * taking clicks.
 */
import React, { useEffect } from 'react';
import { Box, Button, Divider, Tooltip } from '@mui/material';
import { AccountTree, Layers, Palette, RestartAlt, Tune, ViewDay, ViewInAr } from '@mui/icons-material';
import { useAppStore } from '../store/appStore';
import { useModelStore } from '../store/modelStore';
import { MAX_MODEL_VIEWS, useModellingStore } from '../store/modellingStore';
import { ModellingWorkspace } from '../features/modelling/ModellingWorkspace';
import { MODEL_PANEL_IDS, newModelView, toggleModelPane } from '../features/modelling/modellingApi';
import { keys, parseModelPart } from '../features/model/objectKeys';
import { MadeNote, NewMenu } from '../features/modelling/NewMenu';
import { VersionsMenu } from '../features/modelling/VersionsMenu';
import { JobsMenu } from '../features/modelling/JobsMenu';
import { pickFromView } from '../features/model/treePicks';

const ModellingToolbar: React.FC = () => {
    const full = useAppStore(s => s.modelViews.length >= MAX_MODEL_VIEWS);
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.5, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
            <NewMenu />
            <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
            <Tooltip title={full ? `At most ${MAX_MODEL_VIEWS} views can be open` : ''}>
                <span>
                    <Button size="small" startIcon={<ViewInAr />} disabled={full} onClick={() => newModelView('3d')}>New 3D view</Button>
                </span>
            </Tooltip>
            <Tooltip title={full ? `At most ${MAX_MODEL_VIEWS} views can be open` : 'A view square-on to a section set, stepping through it; what is drawn there shows in the other views at once'}>
                <span>
                    <Button size="small" startIcon={<ViewDay />} disabled={full} onClick={() => newModelView('section')}>New section view</Button>
                </span>
            </Tooltip>
            <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
            <Button size="small" startIcon={<AccountTree />} onClick={() => toggleModelPane(MODEL_PANEL_IDS.tree)}>Project tree</Button>
            <Tooltip describeChild title="What the view draws, and how: shown or hidden, solid, edges or outline, how see-through, cut by a slice or whole">
                <Button size="small" startIcon={<Layers />} data-action="scene-pane" onClick={() => toggleModelPane(MODEL_PANEL_IDS.scene)}>Scene</Button>
            </Tooltip>
            <Button size="small" startIcon={<Tune />} onClick={() => toggleModelPane(MODEL_PANEL_IDS.properties)}>Properties</Button>
            <Tooltip describeChild title="The samples' colour, shape, size and filters (the same in every plot and view)">
                <Button size="small" startIcon={<Palette />} onClick={() => toggleModelPane(MODEL_PANEL_IDS.attributes)}>Attributes</Button>
            </Tooltip>
            <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
            <VersionsMenu />
            <Box sx={{ flex: 1 }} />
            <JobsMenu />
            <Button size="small" startIcon={<RestartAlt />} onClick={() => useModellingStore.getState().resetLayout()}>Reset layout</Button>
        </Box>
    );
};

const ModellingView: React.FC = () => {
    useEffect(() => () => {
        const model = useModelStore.getState();
        if (model.editingId) model.setEditing(null);
    }, []);
    // A surface opened for editing (one just made, or opened from a dialog) is picked in the tree, so its settings
    // are in the properties. (Not when they are there already: the contact of a model it is, picked, has its unit open
    // in the model, with those settings in it)
    const editing = useModelStore(s => s.editingId);
    useEffect(() => {
        if (!editing) return;
        const { selected } = useModellingStore.getState();
        const models = useModelStore.getState().scene.models ?? [];
        const inModel = selected.some(k => {
            const part = parseModelPart(k);
            return part?.kind === 'modelContact' && !!models.find(m => m.id === part.model)?.contacts.some(c => c.id === part.part && c.surface === editing);
        });
        if (!inModel && !selected.includes(keys.surface(editing))) pickFromView(keys.surface(editing));
    }, [editing]);
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
            <ModellingToolbar />
            <ModellingWorkspace />
            <MadeNote />
        </Box>
    );
};

export default ModellingView;
