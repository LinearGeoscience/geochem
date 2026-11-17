/**
 * One element's card in the pathfinder grid: the anomaly map, an optional
 * probability plot and a summary row. Memoised — it only re-renders when its
 * own (memoised) trace data or the shared view settings change.
 */
import React, { useRef } from 'react';
import { Box, Paper, Typography, IconButton, Tooltip } from '@mui/material';
import { Download } from '@mui/icons-material';
import Plot from '../../../components/ThemedPlot';
import { STABLE_MAP_AXIS } from '../../../utils/plotDensity';
import { ExpandablePlotWrapper } from '../../../components/ExpandablePlotWrapper';
import { getPlotConfig } from '../../../utils/plotConfig';
import { createMapboxLayout, type MapViewStyle } from '../../../utils/basemapUtils';
import type { ElementMapData, ProbabilityPlotData } from './pathfinderTraces';
import type { AxisRanges3D, DragMode, TransformedCoords } from './types';

export interface PathfinderElementCardProps {
    element: string;
    title: string;
    mapData: ElementMapData;
    probData: ProbabilityPlotData | null;
    showProbabilityPlot: boolean;
    /** Background / 10x summary, e.g. { background: 12, x5: 120, unit: 'ppm' } */
    thresholdSummary: { background: number; x5: number; unit: string } | null;
    is3D: boolean;
    equalAxes: boolean;
    dragMode: DragMode;
    plotRevision: number;
    xTitle: string;
    yTitle: string;
    zTitle: string;
    axisRanges3D: AxisRanges3D | null;
    /** Set when the map draws on a basemap */
    mapbox: { style: MapViewStyle; coords: TransformedCoords; opacity: number } | null;
    onSelected: (eventData: any) => void;
    onDeselect: () => void;
    on3DClick?: (event: any) => void;
    onExportResult: (message: string, severity: 'success' | 'error') => void;
}

async function exportCard(element: string, node: HTMLDivElement): Promise<void> {
    const { toPng } = await import('html-to-image');
    const dataUrl = await toPng(node, {
        backgroundColor: '#ffffff',
        pixelRatio: 2,
        style: { transform: 'scale(1)', transformOrigin: 'top left' },
    });
    const link = document.createElement('a');
    link.download = `pathfinder_${element}_${new Date().toISOString().slice(0, 10)}.png`;
    link.href = dataUrl;
    link.click();
}

export const PathfinderElementCard: React.FC<PathfinderElementCardProps> = React.memo((props) => {
    const {
        element, title, mapData, probData, showProbabilityPlot, thresholdSummary, is3D, equalAxes, dragMode,
        plotRevision, xTitle, yTitle, zTitle, axisRanges3D, mapbox, onSelected, onDeselect, on3DClick, onExportResult,
    } = props;
    const cardRef = useRef<HTMLDivElement | null>(null);

    const handleExport = async () => {
        if (!cardRef.current) return;
        try {
            await exportCard(element, cardRef.current);
            onExportResult(`Exported ${element} plot`, 'success');
        } catch (err) {
            console.error('Export failed:', err);
            onExportResult('Export failed. Try using the Plotly toolbar instead.', 'error');
        }
    };

    const viewLayout = is3D ? {
        scene: {
            aspectmode: equalAxes ? 'data' : 'auto',
            xaxis: { title: { text: xTitle, font: { size: 10 } }, ...(axisRanges3D ? { range: axisRanges3D.x } : {}) },
            yaxis: { title: { text: yTitle, font: { size: 10 } }, ...(axisRanges3D ? { range: axisRanges3D.y } : {}) },
            zaxis: { title: { text: zTitle, font: { size: 10 } }, ...(axisRanges3D ? { range: axisRanges3D.z } : {}) },
            camera: { eye: { x: 1.5, y: 1.5, z: 1.3 } },
        },
        margin: { l: 50, r: 20, t: 40, b: 40 },
    } : mapbox ? {
        ...createMapboxLayout(mapbox.style, mapbox.coords.center, mapbox.coords.zoom, mapbox.opacity),
        margin: { l: 0, r: 0, t: 40, b: 0 },
    } : {
        xaxis: { title: { text: xTitle, font: { size: 10 } }, scaleanchor: 'y', scaleratio: 1, autorange: true, ...STABLE_MAP_AXIS },
        yaxis: { title: { text: yTitle, font: { size: 10 } }, autorange: true, ...STABLE_MAP_AXIS },
        margin: { l: 96, r: 20, t: 40, b: 44 },
    };

    return (
        <Paper sx={{ p: 1 }} ref={cardRef}>
            {/* Header with export button */}
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: -3, mr: 0.5, position: 'relative', zIndex: 1 }}>
                <Tooltip title="Export plot with probability chart">
                    <IconButton size="small" onClick={handleExport}>
                        <Download fontSize="small" />
                    </IconButton>
                </Tooltip>
            </Box>

            {/* Map Plot */}
            <ExpandablePlotWrapper>
                <Plot
                    data={mapData.traces}
                    layout={{
                        title: { text: title, font: { size: 14 }, x: 0, xanchor: 'left' },
                        autosize: true,
                        height: is3D ? 350 : 300,
                        hovermode: 'closest',
                        showlegend: false,
                        dragmode: is3D ? 'orbit' : dragMode,
                        uirevision: plotRevision,
                        ...(viewLayout as any),
                    }}
                    config={{
                        ...getPlotConfig({ filename: `pathfinder_${element}` }),
                        modeBarButtonsToRemove: [], // Keep lasso and select tools
                    }}
                    style={{ width: '100%' }}
                    useResizeHandler={true}
                    onSelected={onSelected}
                    onDeselect={onDeselect}
                    onClick={is3D ? on3DClick : undefined}
                />
            </ExpandablePlotWrapper>

            {/* Probability Plot */}
            {showProbabilityPlot && probData?.trace && (
                <Box sx={{ mt: 1, borderTop: 1, borderColor: 'divider', pt: 1 }}>
                    <Plot
                        data={[probData.trace]}
                        layout={{
                            autosize: true,
                            height: 150,
                            hovermode: 'closest',
                            showlegend: false,
                            xaxis: { type: 'log', title: { text: `${element} (ppm)`, font: { size: 9 } }, tickfont: { size: 8 } },
                            yaxis: { title: { text: 'Percentile', font: { size: 9 } }, tickfont: { size: 8 }, range: [0, 100] },
                            margin: { l: 40, r: 10, t: 10, b: 35 },
                            shapes: probData.thresholdLines.map(line => ({
                                type: 'line',
                                x0: line.value, x1: line.value, y0: 0, y1: 100,
                                line: { color: line.color, width: 1, dash: 'dash' },
                            })),
                            annotations: probData.thresholdLines.map(line => ({
                                x: Math.log10(line.value), y: 95, xref: 'x', yref: 'y',
                                text: line.label, showarrow: false, font: { size: 8, color: line.color },
                            })),
                        }}
                        config={{ displayModeBar: false, staticPlot: false }}
                        style={{ width: '100%' }}
                        useResizeHandler={true}
                    />
                </Box>
            )}

            {/* Info row */}
            <Box sx={{ textAlign: 'center', py: 0.5, borderTop: 1, borderColor: 'divider' }}>
                <Typography variant="caption" color="text.secondary">
                    n = {mapData.validCount.toLocaleString()} / {mapData.totalCount.toLocaleString()}
                    {thresholdSummary && (
                        <>
                            {' | '}
                            Background: &le;{thresholdSummary.background} {thresholdSummary.unit}
                            {' | '}
                            10x: &gt;{thresholdSummary.x5} {thresholdSummary.unit}
                        </>
                    )}
                </Typography>
            </Box>
        </Paper>
    );
});
PathfinderElementCard.displayName = 'PathfinderElementCard';
