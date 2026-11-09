/**
 * Plots view: workspace toolbar over the dockable workspace (plots, data
 * grid and Attribute Manager are all dock panes). Lazy-loaded so the
 * Plotly-heavy chunk (and dockview) only download when a chart view opens.
 */
import React from 'react';
import { Box } from '@mui/material';
import { WorkspaceToolbar } from '../features/workspace/WorkspaceToolbar';
import { Workspace } from '../features/workspace/Workspace';
import { NewPlotDialog } from '../features/plots/NewPlotDialog';

const PlotsView: React.FC = () => (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        <WorkspaceToolbar />
        <Workspace />
        <NewPlotDialog />
    </Box>
);

export default PlotsView;
