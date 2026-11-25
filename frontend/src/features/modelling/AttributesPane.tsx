/**
 * The Attribute Manager as a pane of the Modelling page: the samples'
 * colour, shape, size and what is hidden, the same for every plot and view
 * (as on the Plots page).
 */
import React, { useMemo } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import { AttributeManager } from '../../components/AttributeManager';
import type { PaneControls } from '../workspace/PaneContext';
import { PaneContent } from '../workspace/PaneContent';

export const AttributesPane: React.FC<IDockviewPanelProps> = ({ api }) => {
    const controls = useMemo<PaneControls>(() => ({
        maximize: () => api.maximize(),
        restore: () => api.exitMaximized(),
        isMaximized: () => api.isMaximized(),
    }), [api]);
    return (
        <PaneContent controls={controls}>
            <AttributeManager />
        </PaneContent>
    );
};
