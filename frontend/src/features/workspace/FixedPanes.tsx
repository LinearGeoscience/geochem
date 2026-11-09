/**
 * Non-plot dock panes: the data grid, the Attribute Manager and the
 * Workflows step list (a plain scrolling list; PaneContent scrolls it, so
 * no useFillHeight).
 */
import React, { useMemo } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import { DataView } from '../data_features/DataView';
import { AttributeManager } from '../../components/AttributeManager';
import { WorkflowsPanel } from '../workflows/WorkflowsPanel';
import { PaneContent } from './PaneContent';
import type { PaneControls } from './PaneContext';

function usePaneControls(api: IDockviewPanelProps['api']): PaneControls {
    return useMemo(() => ({
        maximize: () => api.maximize(),
        restore: () => api.exitMaximized(),
        isMaximized: () => api.isMaximized(),
    }), [api]);
}

export const GridPane: React.FC<IDockviewPanelProps> = ({ api }) => (
    <PaneContent controls={usePaneControls(api)}>
        <DataView embedded />
    </PaneContent>
);

export const AttributesPane: React.FC<IDockviewPanelProps> = ({ api }) => (
    <PaneContent controls={usePaneControls(api)}>
        <AttributeManager />
    </PaneContent>
);

export const WorkflowsPane: React.FC<IDockviewPanelProps> = ({ api }) => (
    <PaneContent controls={usePaneControls(api)}>
        <WorkflowsPanel />
    </PaneContent>
);
