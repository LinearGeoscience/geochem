/**
 * Dock pane for one view of the model (panel id === view id). A 3D view is
 * the 3D viewer with the view's own settings; a click anywhere in it makes it
 * the view the project tree and the properties act on.
 *
 * Unmounted while its tab is hidden, as WebGL plots are on the Plots page
 * (browsers allow only so many WebGL contexts); its settings are kept, so it
 * comes back as it was.
 */
import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Box, CircularProgress } from '@mui/material';
import type { IDockviewPanelProps } from 'dockview-react';
import { useAppStore } from '../../store/appStore';
import { useModellingStore } from '../../store/modellingStore';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { PlotIdContext } from '../../utils/plotPresentation';
import type { PaneControls } from '../workspace/PaneContext';
import { PaneContent } from '../workspace/PaneContent';

const Viewer3D = lazy(() => import('../plots/viewer3d/Viewer3D'));

export const ModelViewPane: React.FC<IDockviewPanelProps> = ({ api }) => {
    const viewId = api.id;
    const exists = useAppStore(s => s.modelViews.some(v => v.id === viewId));
    const controls = useMemo<PaneControls>(() => ({
        maximize: () => api.maximize(),
        restore: () => api.exitMaximized(),
        isMaximized: () => api.isMaximized(),
    }), [api]);
    const [visible, setVisible] = useState(api.isVisible);
    useEffect(() => {
        setVisible(api.isVisible);
        const sub = api.onDidVisibilityChange(e => setVisible(e.isVisible));
        return () => sub.dispose();
    }, [api]);
    return (
        <PaneContent controls={controls}>
            <PlotIdContext.Provider value={viewId}>
                <Box
                    data-plot-id={viewId}
                    data-model-view={viewId}
                    sx={{ display: 'contents' }}
                    onPointerDownCapture={() => useModellingStore.getState().setActiveView(viewId)}
                >
                    <ErrorBoundary>
                        {visible && exists ? (
                            <Suspense fallback={<Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress size={24} /></Box>}>
                                <Viewer3D plotId={viewId} />
                            </Suspense>
                        ) : null}
                    </ErrorBoundary>
                </Box>
            </PlotIdContext.Provider>
        </PaneContent>
    );
};
