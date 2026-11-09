/**
 * Dock pane for one plot instance (panel id === plot id). Renders the plot
 * component for the plot's current type, isolated by an ErrorBoundary.
 *
 * WebGL plots are unmounted while their tab is hidden: each Plotly WebGL plot
 * holds three browser WebGL contexts and the 3D viewer one, and browsers allow
 * about 16 - beyond that they kill the oldest (often the 3D view). Settings
 * live in the store, so the plot comes back as it was when the tab is shown.
 */
import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Box, CircularProgress } from '@mui/material';
import type { IDockviewPanelProps } from 'dockview-react';
import { useAppStore } from '../../store/appStore';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import type { PaneControls } from './PaneContext';
import { PaneContent } from './PaneContent';
import { LegendOverlay } from './LegendOverlay';
import { PlotIdContext } from '../../utils/plotPresentation';
import { ScatterPlot } from '../plots/ScatterPlot';
import { TernaryPlot } from '../plots/TernaryPlot';
import { SpiderPlot } from '../plots/SpiderPlot';
import { AttributeMap } from '../plots/AttributeMap';
import { DownholePlot } from '../plots/DownholePlot';
import { SectionPlot } from '../plots/SectionPlot';
import { HistogramPlot } from '../plots/HistogramPlot';
import { ProbabilityPlot } from '../analysis/ProbabilityPlot';
import { CLRPlot } from '../plots/CLRPlot';
import { ClassificationPlot } from '../plots/ClassificationPlot';
import { PathfinderMap } from '../plots/PathfinderMap';
import { ContourMap } from '../plots/ContourMap';
import { ScatterMatrix } from '../plots/ScatterMatrix';
import { PiperPlot } from '../plots/PiperPlot';
import { ProtocolSummaryPane } from '../plots/ProtocolSummaryPane';

// PCA results window: the analysis chunk, fetched when one is shown
const PCAResultsPanel = lazy(() => import('../analysis/pca/PCAResultsPanel'));

// WebGL 3D viewer (three.js) in its own chunk — only fetched when a 3D plot is shown
const Viewer3D = lazy(() => import('../plots/viewer3d/Viewer3D'));

// Plot types that draw with WebGL (Plotly gl traces, maplibre, three.js)
const WEBGL_TYPES = new Set(['scatter', 'map', 'map3d', 'downhole', 'probability', 'clr', 'classification', 'pathfinder', 'contour', 'splom', 'section']);

function renderPlot(type: string | undefined, plotId: string) {
    switch (type) {
        case 'scatter': return <ScatterPlot key={plotId} plotId={plotId} />;
        case 'ternary': return <TernaryPlot key={plotId} plotId={plotId} />;
        case 'spider': return <SpiderPlot key={plotId} plotId={plotId} />;
        case 'map': return <AttributeMap key={plotId} plotId={plotId} />;
        case 'map3d': return (
            <Suspense key={plotId} fallback={<Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress size={24} /></Box>}>
                <Viewer3D plotId={plotId} />
            </Suspense>
        );
        case 'downhole': return <DownholePlot key={plotId} plotId={plotId} />;
        case 'section': return <SectionPlot key={plotId} plotId={plotId} />;
        case 'histogram': return <HistogramPlot key={plotId} plotId={plotId} />;
        case 'probability': return <ProbabilityPlot key={plotId} plotId={plotId} />;
        case 'clr': return <CLRPlot key={plotId} plotId={plotId} />;
        case 'classification': return <ClassificationPlot key={plotId} plotId={plotId} />;
        case 'pathfinder': return <PathfinderMap key={plotId} plotId={plotId} />;
        case 'contour': return <ContourMap key={plotId} plotId={plotId} />;
        case 'splom': return <ScatterMatrix key={plotId} plotId={plotId} />;
        case 'piper': return <PiperPlot key={plotId} plotId={plotId} />;
        case 'protocols': return <ProtocolSummaryPane key={plotId} plotId={plotId} />;
        case 'pca': return (
            <Suspense key={plotId} fallback={<Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress size={24} /></Box>}>
                <PCAResultsPanel inWindow />
            </Suspense>
        );
        default: return null;
    }
}

export const PlotPane: React.FC<IDockviewPanelProps> = ({ api }) => {
    const plotId = api.id;
    const type = useAppStore(s => s.plots.find(p => p.id === plotId)?.type);
    const legend = useAppStore(s => !!s.plots.find(p => p.id === plotId)?.settings?.legendOverlay);
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
    const mounted = visible || !WEBGL_TYPES.has(type ?? '');
    return (
        <PaneContent controls={controls}>
            <PlotIdContext.Provider value={plotId}>
                {legend && mounted && <LegendOverlay plotId={plotId} />}
                <Box data-plot-id={plotId} sx={{ display: 'contents' }}>
                    <ErrorBoundary key={type}>{mounted ? renderPlot(type, plotId) : null}</ErrorBoundary>
                </Box>
            </PlotIdContext.Provider>
        </PaneContent>
    );
};
