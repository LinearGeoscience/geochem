import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { WEBGL_CHART_BUDGET } from '../../utils/webglContextGuard';
import { requestMount } from '../../utils/idleMountQueue';
import { NodeLibraryButton } from '../../components/plot_controls/NodeLibraryButton';
import { nodeColumnValues, nodeLabelsOn, nodesById, nodeXYTieTrace, nodeXYTrace, tiePairs } from '../../utils/nodeLibrary';
import Plot from '../../components/ThemedPlot';
import { useAppStore, useDatasetRows, useDisplayRows, useAnalyticalStore } from '../../store/appStore';
import { usePlotSetting } from '../../hooks/usePlotSetting';
import { useShallow } from 'zustand/react/shallow';
import { Box, Paper, FormControl, InputLabel, Select, MenuItem, Checkbox, FormControlLabel, Typography, Slider, ToggleButton, ToggleButtonGroup, Tooltip, IconButton, Dialog, DialogTitle, DialogContent, DialogActions, Button, Table, TableHead, TableBody, TableRow, TableCell, TextField } from '@mui/material';
import { ZoomOutMap, CenterFocusStrong, TableChart, Straighten } from '@mui/icons-material';
import { AxisLimitsDialog } from './AxisLimitsDialog';
import { countOutside, extentOf, hasLimits, plotlyAxisRange, type AxisLimits } from '../../utils/axisLimits';
import { axisRange, statsTable, xyStats } from '../../utils/xyStatistics';
import { notify } from '../../store/notificationStore';
import { MultiColumnSelector } from '../../components/MultiColumnSelector';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';
import { useAttributeStore } from '../../store/attributeStore';
import { getStyleArraysColumnar, shapeToPlotlySymbol, applyOpacityToColor, getSortedIndices, sortColumnsByPriority, getColumnDisplayName, buildSelectionOverlayTrace } from '../../utils/attributeUtils';
import { calculateLinearRegression, formatRegressionEquation } from '../../utils/regressionUtils';
import { buildCustomDataColumnar, buildScatterHoverTemplate } from '../../utils/tooltipUtils';
import { isNumericColumn } from '../../types/columnarData';
import { getPlotConfig, EXPORT_FONT_SIZES, PRESENTATION_FONT_SIZES } from '../../utils/plotConfig';
import { DENSITY_JET_POINT_COLORSCALE } from '../../utils/densityGrid';
import { useDensityWorker } from '../../hooks/useDensityWorker';
import { useSelectionHandler } from '../../hooks/useSelectionHandler';
import { PlotControlBar, ControlSection, SettingChip } from '../../components/plot_controls/PlotControlBar';
import { ApplyDiagramButton } from './classification/ApplyDiagram';
import { ColumnPicker } from '../../components/ColumnPicker';
import { suggestPlotSettings } from '../../utils/plotDefaults';
import { useDragMode } from '../../hooks/useDragMode';
import { useFillHeight } from '../../hooks/useFillHeight';
import { RefLinesButton } from '../../components/plot_controls/RefLinesButton';
import { densityOverlayGrid, refLineLevel, refLineSlope, thinPoints, DENSITY_OVERLAY_COLORSCALE, type DensityGrid, type RefLine } from '../../utils/scatterOverlays';
import { useStyleInputs } from '../../hooks/useStyleInputs';
import { useHoveredClassRows, HOVER_RING_COLOR } from '../../hooks/useHoveredClassRows';

/** YX mode: draw a panel with its axes exchanged (hover labels follow) */
function swapXY(t: any): any {
    if (t.type === 'heatmap') {
        const z: (number | null)[][] = t.z;
        return { ...t, x: t.y, y: t.x, z: z[0]?.map((_, i) => z.map(row => row[i])) ?? [] };
    }
    if (!('x' in t) || !('y' in t)) return t;
    const ht = typeof t.hovertemplate === 'string'
        ? t.hovertemplate.replace(/%\{x\}/g, '%{__Y}').replace(/%\{y\}/g, '%{x}').replace(/%\{__Y\}/g, '%{y}')
        : t.hovertemplate;
    return { ...t, x: t.y, y: t.x, ...(ht !== undefined ? { hovertemplate: ht } : {}) };
}

/** Nearest scrolling ancestor (the dock pane), so cells mount a little before they scroll in */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
    for (let p = el?.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p).overflowY;
        if (o === 'auto' || o === 'scroll') return p;
    }
    return null;
}

interface ScatterCellProps {
    data: any[]; layout: any; config: any; height: number; padding: number; lazy: boolean; title: string;
    onSelected: (e: any) => void; onDeselect: () => void; onRelayout: (e: any) => void;
}

/**
 * One chart of the grid. With many Y axes (e.g. SiO2 against every element)
 * a chart is built only once its cell is near the screen, one at a time and
 * only when scrolling pauses (idleMountQueue). A built chart stays built
 * until it is far away, and while off screen it keeps its last traces, so a
 * selection redraws only the charts you can see. Memoised, so a cell redraws
 * only when its own traces or layout change.
 */
const ScatterCell = React.memo<ScatterCellProps>(({ data, layout, config, height, padding, lazy, title, onSelected, onDeselect, onRelayout }) => {
    const ref = useRef<HTMLDivElement>(null);
    const [near, setNear] = useState(!lazy);
    const [built, setBuilt] = useState(!lazy);
    useEffect(() => {
        const el = ref.current;
        if (!lazy || !el || typeof IntersectionObserver === 'undefined') { setNear(true); setBuilt(true); return; }
        const root = scrollParent(el);
        const nearIo = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { root, rootMargin: '200px 0px' });
        // Far away (several screens): free the chart
        const farIo = new IntersectionObserver(([e]) => { if (!e.isIntersecting) setBuilt(false); }, { root, rootMargin: '3000px 0px' });
        nearIo.observe(el);
        farIo.observe(el);
        return () => { nearIo.disconnect(); farIo.disconnect(); };
    }, [lazy]);
    useEffect(() => {
        if (!near || built) return;
        // flushSync: the chart is built inside this queue slot, not batched with the next
        return requestMount(() => flushSync(() => setBuilt(true)));
    }, [near, built]);
    // Off screen: keep showing the last traces instead of redrawing
    const shown = useRef({ data, layout, config });
    if (near || !built) shown.current = { data, layout, config };
    return (
        // contain: a chart measuring itself lays out only its own cell, not the whole grid
        <Box ref={ref} sx={{ minWidth: 0, ...(lazy ? { contain: 'layout paint', contentVisibility: 'auto', containIntrinsicSize: `auto ${height + 16}px` } : {}) }}>
            <Paper sx={{ p: padding }}>
                {built ? (
                    <ExpandablePlotWrapper>
                        <Plot
                            data={shown.current.data} layout={shown.current.layout} config={shown.current.config}
                            style={{ width: '100%' }} useResizeHandler={true}
                            onSelected={onSelected} onDeselect={onDeselect} onRelayout={onRelayout}
                        />
                    </ExpandablePlotWrapper>
                ) : (
                    <Box sx={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Typography variant="caption" color="text.secondary">{title}</Typography>
                    </Box>
                )}
            </Paper>
        </Box>
    );
});

/** Small-multiple cell sizes: min column width, chart height, compact chrome */
type CellSize = 'auto' | 'small' | 'medium' | 'large';
const CELL = {
    small: { min: 280, height: 300, compact: true },
    medium: { min: 360, height: 400, compact: false },
    large: { min: 520, height: 520, compact: false },
} as const;
const COMPACT_FONT = { title: 13, axisTitle: 12, tickLabels: 11 };
// Auto goes small past this many charts so a long Y list stays scannable
const AUTO_SMALL_AFTER = 4;

// Store axis ranges per plot when locked
interface AxisRangeCache {
    [key: string]: { xRange?: [number, number]; yRange?: [number, number] };
}

// Points per chart: Auto draws everything for a few charts and caps each
// chart of a long grid (SVG cost grows with points × charts on screen)
type PointsPerChart = 'auto' | 'all' | number;
const AUTO_POINT_CAP = 3000;

// WebGL threshold - use scattergl for large datasets for better performance
const WEBGL_THRESHOLD = 5000;
// More charts than this in one grid: SVG scatter (points are thinned per chart anyway).
// Each WebGL chart costs 2 contexts; past the browser's ~16 the oldest charts went blank.
const MAX_WEBGL_CHARTS = WEBGL_CHART_BUDGET;

interface ScatterPlotProps {
    plotId: string;
}

export const ScatterPlot: React.FC<ScatterPlotProps> = ({ plotId }) => {
    const dragMode = useDragMode();
    const { columns, lockAxes, lockFullExtent } = useAppStore(useShallow(s => ({ columns: s.columns, lockAxes: s.lockAxes, lockFullExtent: s.lockFullExtent })));
    const data = useDatasetRows();
    const getDisplayColumn = useAppStore(s => s.getDisplayColumn);
    const tooltipMode = useAppStore(s => s.tooltipMode); // Also a dep of the base-trace memo (hover customdata)
    const { handleSelected, handleDeselect, selectedIndices } = useSelectionHandler();
    const hoveredRows = useHoveredClassRows();
    const filteredColumns = useAppStore(useShallow(s => s.getFilteredColumns()));
    const d = useCallback((name: string) => getColumnDisplayName(columns, name), [columns]);
    const displayData = useDisplayRows();
    const displayIndices = useAppStore(s => s._sampleIndicesArray);
    const analytical = useAnalyticalStore();
    // Attribute state that affects styling — style arrays read the attribute
    // store directly, so this object is the memo dependency that tracks it
    const attributeStyleState = useStyleInputs();
    const { color } = attributeStyleState;

    const [xAxis, setXAxis] = usePlotSetting<string>(plotId, 'xAxis', '');
    const [yAxes, setYAxes] = usePlotSetting<string[]>(plotId, 'yAxes', []);
    const [showRegression, setShowRegression] = usePlotSetting<boolean>(plotId, 'showRegression', false);
    const [regressionMode, setRegressionMode] = usePlotSetting<'global' | 'per-category'>(plotId, 'regressionMode', 'global');
    const [showDensity, setShowDensity] = usePlotSetting<boolean>(plotId, 'showContours', false);
    // Smoothing is persisted as contourResolution (= smoothing × 25) for compatibility
    const [contourResolution, setContourResolution] = usePlotSetting<number | null>(plotId, 'contourResolution', null);
    const densitySmoothing = contourResolution != null ? Math.min(8, Math.max(0.5, contourResolution / 25)) : 2.0;
    const setDensitySmoothing = (smoothing: number) => setContourResolution(smoothing * 25);
    const [debouncedSmoothing, setDebouncedSmoothing] = useState(densitySmoothing);
    const [densityOpacity, setDensityOpacity] = usePlotSetting<number>(plotId, 'densityOpacity', 0.7);

    const { computePointDensities: computePointDensitiesWorker } = useDensityWorker();

    // Debounce density smoothing slider (150ms) to avoid recomputing KDE on every pixel
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSmoothing(densitySmoothing), 150);
        return () => clearTimeout(timer);
    }, [densitySmoothing]);
    const [densitySqrtNorm, setDensitySqrtNorm] = usePlotSetting<boolean>(plotId, 'densitySqrtNorm', false);
    const [logScaleX, setLogScaleX] = usePlotSetting<boolean>(plotId, 'logScaleX', false);
    const [logScaleY, setLogScaleY] = usePlotSetting<boolean>(plotId, 'logScaleY', false);
    // Fixed axis limits saved with the plot (locked axes, as in the reference software)
    const [xLimits, setXLimits] = usePlotSetting<AxisLimits | null>(plotId, 'xLimits', null);
    const [yLimits, setYLimits] = usePlotSetting<Record<string, AxisLimits>>(plotId, 'yLimits', {});
    const [limitsOpen, setLimitsOpen] = useState(false);
    const [presentationMode, setPresentationMode] = usePlotSetting<boolean>(plotId, 'presentationMode', false);
    const [equalAxes, setEqualAxes] = usePlotSetting<boolean>(plotId, 'equalAxes', false);
    // YX plot: the X-axis variable is drawn on the Y axis of every panel
    const [yxMode, setYxMode] = usePlotSetting<boolean>(plotId, 'yxMode', false);
    // point density contour overlay (cells across x down) under the coloured points
    const [densityOverlay, setDensityOverlay] = usePlotSetting<boolean>(plotId, 'densityOverlay', false);
    const [densityCells, setDensityCells] = usePlotSetting<[number, number]>(plotId, 'densityCells', [180, 140]);
    const [densityOverlayOpacity, setDensityOverlayOpacity] = usePlotSetting<number>(plotId, 'densityOverlayOpacity', 0.9);
    const [refLines, setRefLines] = usePlotSetting<RefLine[]>(plotId, 'refLines', []);
    const [sortOrder, setSortOrder] = usePlotSetting<string>(plotId, 'sortOrder', 'default');
    const [cellSize, setCellSize] = usePlotSetting<CellSize>(plotId, 'cellSize', 'auto');
    const [pointsPerChart, setPointsPerChart] = usePlotSetting<PointsPerChart>(plotId, 'pointsPerChart', 'auto');
    const pointCap = pointsPerChart === 'all' ? null
        : pointsPerChart === 'auto' ? (yAxes.length > AUTO_SMALL_AFTER ? AUTO_POINT_CAP : null)
        : pointsPerChart;
    // One chart fills the pane; several tile in cells sized by `cellSize`
    const single = yAxes.length === 1;
    const { ref: fillRef, height: fillHeight } = useFillHeight<HTMLDivElement>(500, 320, 24);
    const cell = CELL[cellSize !== 'auto' ? cellSize : presentationMode ? 'large' : yAxes.length > AUTO_SMALL_AFTER ? 'small' : 'medium'];
    const chartHeight = single ? fillHeight : presentationMode ? Math.max(cell.height, 500) : cell.height;
    const fonts = presentationMode ? PRESENTATION_FONT_SIZES : !single && cell.compact ? COMPACT_FONT : EXPORT_FONT_SIZES;

    // Full data ranges for lockFullExtent mode
    const fullXRange = useMemo(() => {
        if (!lockFullExtent || !xAxis) return null;
        const col = analytical.columns.get(xAxis);
        if (!col) return null;
        let min = Infinity, max = -Infinity;
        if (col instanceof Float64Array) {
            for (let i = 0; i < col.length; i++) {
                const v = col[i];
                if (!isNaN(v) && isFinite(v)) { if (v < min) min = v; if (v > max) max = v; }
            }
        } else {
            for (let i = 0; i < col.length; i++) {
                const v = Number(col[i]);
                if (!isNaN(v) && isFinite(v)) { if (v < min) min = v; if (v > max) max = v; }
            }
        }
        return min < max ? [min, max] as [number, number] : null;
    }, [lockFullExtent, xAxis, analytical]);

    const fullYRanges = useMemo(() => {
        if (!lockFullExtent || yAxes.length === 0) return {} as Record<string, [number, number]>;
        const ranges: Record<string, [number, number]> = {};
        for (const yName of yAxes) {
            const col = analytical.columns.get(yName);
            if (!col) continue;
            let min = Infinity, max = -Infinity;
            if (col instanceof Float64Array) {
                for (let i = 0; i < col.length; i++) {
                    const v = col[i];
                    if (!isNaN(v) && isFinite(v)) { if (v < min) min = v; if (v > max) max = v; }
                }
            } else {
                for (let i = 0; i < col.length; i++) {
                    const v = Number(col[i]);
                    if (!isNaN(v) && isFinite(v)) { if (v < min) min = v; if (v > max) max = v; }
                }
            }
            if (min < max) ranges[yName] = [min, max];
        }
        return ranges;
    }, [lockFullExtent, yAxes, analytical]);

    // Pre-computed density results per yAxis (keyed by displayData index)
    const [densityResults, setDensityResults] = useState<Record<string, number[] | null>>({});

    // Compute density via worker when params change
    useEffect(() => {
        if (!showDensity || !xAxis || yAxes.length === 0 || displayData.length < 10) {
            setDensityResults({});
            return;
        }

        let cancelled = false;

        const computeAll = async () => {
            const results: Record<string, number[] | null> = {};

            for (const yAxisName of yAxes) {
                // Use columnar display columns for efficient extraction
                const xColRaw = getDisplayColumn(xAxis);
                const yColRaw = getDisplayColumn(yAxisName);
                const xRaw = xColRaw && isNumericColumn(xColRaw) ? Array.from(xColRaw) : displayData.map(row => Number(row[xAxis]));
                const yRaw = yColRaw && isNumericColumn(yColRaw) ? Array.from(yColRaw) : displayData.map(row => Number(row[yAxisName]));

                const xValid: number[] = [];
                const yValid: number[] = [];
                const validIndices: number[] = [];
                for (let i = 0; i < xRaw.length; i++) {
                    const xv = xRaw[i], yv = yRaw[i];
                    if (isNaN(xv) || !isFinite(xv) || isNaN(yv) || !isFinite(yv)) continue;
                    if (logScaleX && xv <= 0) continue;
                    if (logScaleY && yv <= 0) continue;
                    xValid.push(logScaleX ? Math.log10(xv) : xv);
                    yValid.push(logScaleY ? Math.log10(yv) : yv);
                    validIndices.push(i);
                }

                if (xValid.length < 10) {
                    results[yAxisName] = null;
                    continue;
                }

                const result = await computePointDensitiesWorker(xValid, yValid, {
                    smoothingSigma: debouncedSmoothing,
                    sqrtNorm: densitySqrtNorm
                });
                if (cancelled) return;

                if (result) {
                    const fullDensities = new Array(displayData.length).fill(0);
                    for (let j = 0; j < validIndices.length; j++) {
                        fullDensities[validIndices[j]] = result.densities[j];
                    }
                    results[yAxisName] = fullDensities;
                } else {
                    results[yAxisName] = null;
                }
            }

            if (!cancelled) {
                setDensityResults(results);
            }
        };

        computeAll();
        return () => { cancelled = true; };
    }, [showDensity, debouncedSmoothing, densitySqrtNorm, xAxis, yAxes, displayData, logScaleX, logScaleY, computePointDensitiesWorker, getDisplayColumn]);

    // Cache axis ranges when locked
    const axisRangesRef = useRef<AxisRangeCache>({});
    // Zoom to data / data and origin (session only); nonce resets Plotly's view
    const [zoom, setZoom] = useState<{ mode: 'data' | 'origin'; nonce: number } | null>(null);
    const zoomTo = (mode: 'data' | 'origin') => {
        axisRangesRef.current = {};
        setZoom(z => ({ mode, nonce: (z?.nonce ?? 0) + 1 }));
    };
    const [statsOpen, setStatsOpen] = useState(false);
    const [nodeIds, setNodeIds] = usePlotSetting<string[]>(plotId, 'nodes', []);
    const geochemMappings = useAppStore(s => s.geochemMappings);
    // A text column on X (e.g. lithology vs Al) gives a category axis
    const xIsText = useMemo(() => {
        const type = columns.find(c => c.name === xAxis)?.type;
        return !!type && !['numeric', 'float', 'integer'].includes(type);
    }, [xAxis, columns]);
    const nodeValues = useMemo(() => {
        const nodes = nodesById(nodeIds);
        if (!nodes.length || !xAxis) return null;
        return { nodes, values: nodeColumnValues([xAxis, ...yAxes], geochemMappings, nodes) };
    }, [nodeIds, xAxis, yAxes, geochemMappings]);

    // Handle relayout to capture zoom/pan changes
    const handleRelayout = useCallback((yAxisName: string, event: any) => {
        if (event['xaxis.range[0]'] !== undefined || event['xaxis.range'] !== undefined) {
            const xRange = event['xaxis.range'] || [event['xaxis.range[0]'], event['xaxis.range[1]']];
            const yRange = event['yaxis.range'] || [event['yaxis.range[0]'], event['yaxis.range[1]']];
            axisRangesRef.current[yAxisName] = {
                xRange: xRange as [number, number],
                yRange: yRange as [number, number]
            };
        }
        // Also capture autorange resets
        if (event['xaxis.autorange'] || event['yaxis.autorange']) {
            delete axisRangesRef.current[yAxisName];
        }
    }, []);

    // No stored axes (e.g. data loaded after the plot was created): suggest
    // chemistry axes, never IDs or coordinates
    useEffect(() => {
        if (columns.length > 0 && !xAxis && yAxes.length === 0) {
            const s = suggestPlotSettings('scatter', columns, useAppStore.getState().geochemMappings);
            if (s.xAxis) { setXAxis(s.xAxis); setYAxes(s.yAxes); }
        }
    }, [columns, xAxis, yAxes.length, setXAxis, setYAxes]);

    const numericColumns = sortColumnsByPriority(
        filteredColumns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))
    );

    const allNumericColumns = useMemo(() => sortColumnsByPriority(
        columns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))
    ), [columns]);

    // Memoize style arrays once (shared across all y-axes) — avoids O(n) recompute per y-axis
    const styleArrays = useMemo(() => {
        if (!displayData.length) return null;
        void attributeStyleState; // style arrays read the attribute store; recompute when it changes
        return getStyleArraysColumnar(displayData.length, (name) => getDisplayColumn(name), displayIndices ?? undefined);
    }, [displayData, displayIndices, getDisplayColumn, attributeStyleState]);

    const sortedIndices = useMemo(() =>
        styleArrays ? getSortedIndices(styleArrays) : [],
        [styleArrays]
    );

    // Base traces per y-axis — everything EXCEPT selection highlighting, memoized
    // so a selection change (the hot standard interaction) only rebuilds the
    // small overlay trace in getPlotDataForAxis below, not these O(n) arrays.
    const basePlotDataByAxis = useMemo(() => {
        void tooltipMode; // hover customdata reads the tooltip mode from the store
        const result: Record<string, {
            traces: any[]; traceX: any[]; traceY: any[];
            traceOriginalIndices: number[]; traceSizes: number[]; traceShapes: string[];
            plotType: 'scatter' | 'scattergl'; thinned?: { shown: number; total: number };
        }> = {};
        const thinned: Record<string, { shown: number; total: number }> = {};
        if (!displayData.length || !xAxis || !styleArrays) return result;

        // Marker size multiplier for presentation mode (makes markers much larger)
        const sizeMultiplier = presentationMode ? 1.8 : 1;

        const xDisplayCol = getDisplayColumn(xAxis);
        const colorDisplayCol = color.field ? getDisplayColumn(color.field) : undefined;

        // Build arrays in sorted order for z-ordering (shared across all y-axes)
        const sortedColors: string[] = [];
        const sortedShapes: string[] = [];
        const sortedSizes: number[] = [];
        const sortedOriginalIndices: number[] = [];

        for (const i of sortedIndices) {
            // Apply emphasis opacity to colors
            const colorWithOpacity = applyOpacityToColor(styleArrays.colors[i], styleArrays.opacity[i]);
            sortedColors.push(colorWithOpacity);
            sortedShapes.push(styleArrays.shapes[i]);
            sortedSizes.push(styleArrays.sizes[i] * sizeMultiplier);
            sortedOriginalIndices.push(i);
        }

        // Use WebGL for large datasets, but fall back to CPU scatter when too many subplots
        // The density overlay is drawn over the points; a WebGL layer would sit above it
        const useWebGL = yAxes.length <= MAX_WEBGL_CHARTS && !densityOverlay;
        const plotType: 'scatter' | 'scattergl' = (useWebGL && sortedIndices.length > WEBGL_THRESHOLD) ? 'scattergl' : 'scatter';

        // Build rich customdata for hover tooltips — columnar fast path (shared)
        const customData = buildCustomDataColumnar((name) => getDisplayColumn(name), sortedIndices, displayIndices ?? undefined);

        const baseX = xDisplayCol ? sortedIndices.map(i => xDisplayCol[i]) : sortedIndices.map(i => displayData[i][xAxis]);
        // sortedOriginalIndices are displayData indices; map to true data indices via displayIndices
        const baseOriginalIndices = sortedOriginalIndices.map(i => displayIndices ? displayIndices[i] : i);

        for (const yAxisName of yAxes) {
            const yDisplayCol = getDisplayColumn(yAxisName);

            // Use pre-computed density from worker (mapped through sort indices)
            let densityColors: number[] | null = null;
            if (showDensity && densityResults[yAxisName]) {
                const rawDensities = densityResults[yAxisName]!;
                densityColors = sortedIndices.map(i => rawDensities[i]);
            }

            // Build trace arrays — use columnar data for efficient index gathering
            let traceX = baseX;
            let traceY = yDisplayCol ? sortedIndices.map(i => yDisplayCol[i]) : sortedIndices.map(i => displayData[i][yAxisName]);
            let traceCustomData = customData;
            let traceShapes = sortedShapes;
            let traceSizes = sortedSizes;
            let traceColors = sortedColors;
            // Track original data indices through all reorderings (for selection highlighting)
            let traceOriginalIndices = baseOriginalIndices;

            // Sparse columns (selective assays): keep only rows with both values, so a
            // mostly empty panel costs what it shows, not every row of the file
            if (!xIsText) {
                const keep: number[] = [];
                for (let k = 0; k < traceY.length; k++) {
                    const xv = traceX[k], yv = traceY[k];
                    if (xv != null && yv != null && Number.isFinite(+xv) && Number.isFinite(+yv)) keep.push(k);
                }
                if (keep.length < traceY.length) {
                    traceX = keep.map(k => traceX[k]);
                    traceY = keep.map(k => traceY[k]);
                    traceCustomData = keep.map(k => traceCustomData[k]);
                    traceShapes = keep.map(k => traceShapes[k]);
                    traceSizes = keep.map(k => traceSizes[k]);
                    traceColors = keep.map(k => traceColors[k]);
                    traceOriginalIndices = keep.map(k => traceOriginalIndices[k]);
                    if (densityColors) densityColors = keep.map(k => densityColors![k]);
                }
            }

            // Density z-ordering: sort by ascending density so high-density (red) points draw on top
            if (densityColors) {
                const order = densityColors.map((_, i) => i).sort((a, b) => densityColors![a] - densityColors![b]);
                traceX = order.map(i => traceX[i]);
                traceY = order.map(i => traceY[i]);
                traceCustomData = order.map(i => traceCustomData[i]);
                traceShapes = order.map(i => traceShapes[i]);
                traceSizes = order.map(i => traceSizes[i]);
                traceColors = order.map(i => traceColors[i]);
                traceOriginalIndices = order.map(i => traceOriginalIndices[i]);
                densityColors = order.map(i => densityColors![i]);
            }

            // Long grids: draw a stable subset per chart (extremes kept); the
            // selection and hover rings below still use every point
            const ringArrays = { traceX, traceY, traceOriginalIndices, traceSizes, traceShapes };
            if (pointCap && traceY.length > pointCap) {
                const keep = thinPoints(traceX, traceY, traceOriginalIndices, pointCap);
                traceX = keep.map(k => traceX[k]);
                traceY = keep.map(k => traceY[k]);
                traceCustomData = keep.map(k => traceCustomData[k]);
                traceShapes = keep.map(k => traceShapes[k]);
                traceSizes = keep.map(k => traceSizes[k]);
                traceColors = keep.map(k => traceColors[k]);
                if (densityColors) densityColors = keep.map(k => densityColors![k]);
                thinned[yAxisName] = { shown: keep.length, total: ringArrays.traceY.length };
            }

            const trace: any = {
                x: traceX,
                y: traceY,
                mode: 'markers',
                type: plotType,
                customdata: traceCustomData,
                hovertemplate: buildScatterHoverTemplate(d(xAxis), d(yAxisName)),
                marker: densityColors ? {
                    color: densityColors,
                    colorscale: DENSITY_JET_POINT_COLORSCALE,
                    showscale: false,
                    symbol: traceShapes.map(s => shapeToPlotlySymbol(s)),
                    size: traceSizes,
                    opacity: densityOpacity,
                    line: { width: 0 }
                } : {
                    color: traceColors,
                    symbol: traceShapes.map(s => shapeToPlotlySymbol(s)),
                    size: traceSizes,
                    line: { width: 0 }
                }
            };

            const traces: any[] = [];

            // Always add scatter points
            traces.push(trace);

            // Add regression lines if enabled (not against a text X)
            if (showRegression && !xIsText) {
                if (regressionMode === 'global') {
                    // Global regression - single line for all visible data
                    const xRaw = xDisplayCol ? sortedIndices.map(i => Number(xDisplayCol[i])) : sortedIndices.map(i => Number(displayData[i][xAxis]));
                    const yRaw = yDisplayCol ? sortedIndices.map(i => Number(yDisplayCol[i])) : sortedIndices.map(i => Number(displayData[i][yAxisName]));

                    const regression = calculateLinearRegression(xRaw, yRaw, { logX: logScaleX, logY: logScaleY });
                    if (regression) {
                        traces.push({
                            x: regression.xValues,
                            y: regression.yValues,
                            mode: 'lines',
                            type: 'scatter',
                            name: `Regression (R²=${regression.rSquared.toFixed(3)})`,
                            line: { color: 'red', width: presentationMode ? 4 : 2, dash: 'dash' },
                            hovertemplate: `${formatRegressionEquation(regression)}<br>R² = ${regression.rSquared.toFixed(4)}<extra></extra>`
                        });
                    }
                } else if (regressionMode === 'per-category' && color.field) {
                    // Per-category regression - one line per color category
                    const categoryGroups = new Map<string, { xVals: number[], yVals: number[], color: string }>();

                    sortedIndices.forEach((sortedIdx, posIdx) => {
                        const catVal = colorDisplayCol ? colorDisplayCol[sortedIdx] : displayData[sortedIdx][color.field!];
                        const category = String(catVal);
                        if (!categoryGroups.has(category)) {
                            categoryGroups.set(category, { xVals: [], yVals: [], color: sortedColors[posIdx] });
                        }
                        const xv = xDisplayCol ? Number(xDisplayCol[sortedIdx]) : Number(displayData[sortedIdx][xAxis]);
                        const yv = yDisplayCol ? Number(yDisplayCol[sortedIdx]) : Number(displayData[sortedIdx][yAxisName]);
                        if (!isNaN(xv) && isFinite(xv) && !isNaN(yv) && isFinite(yv)) {
                            categoryGroups.get(category)!.xVals.push(xv);
                            categoryGroups.get(category)!.yVals.push(yv);
                        }
                    });

                    // Calculate regression for each category
                    categoryGroups.forEach(({ xVals: xValues, yVals: yValues, color: lineColor }, category) => {

                        const regression = calculateLinearRegression(xValues, yValues, { logX: logScaleX, logY: logScaleY });
                        if (regression) {
                            traces.push({
                                x: regression.xValues,
                                y: regression.yValues,
                                mode: 'lines',
                                type: 'scatter',
                                name: `${category} (R²=${regression.rSquared.toFixed(3)})`,
                                line: { color: lineColor, width: presentationMode ? 4 : 2, dash: 'dash' },
                                hovertemplate: `${category}<br>${formatRegressionEquation(regression)}<br>R² = ${regression.rSquared.toFixed(4)}<extra></extra>`,
                                showlegend: true
                            });
                        }
                    });
                }
            }

            result[yAxisName] = { traces, ...ringArrays, plotType, thinned: thinned[yAxisName] };
        }

        return result;
    }, [displayData, displayIndices, xAxis, yAxes, styleArrays, sortedIndices, presentationMode, d, getDisplayColumn,
        showDensity, densityResults, densityOpacity, showRegression, regressionMode,
        logScaleX, logScaleY, color.field, tooltipMode, xIsText, densityOverlay, pointCap]);

    // Cheap per-render step: base traces + (optional) selection overlay. Only the
    // overlay depends on selectedIndices, so lasso/deselect never rebuilds the base.
    const getPlotDataForAxis = (yAxisName: string) => {
        const base = basePlotDataByAxis[yAxisName];
        if (!base) return [];
        const traces = [...base.traces];
        if (selectedIndices.length > 0) {
            const overlay = buildSelectionOverlayTrace(
                base.traceX, base.traceY, selectedIndices,
                base.traceOriginalIndices, base.traceSizes, base.traceShapes,
                base.plotType
            );
            // Draw over the points but under regression lines
            if (overlay) traces.splice(1, 0, overlay);
        }
        if (hoveredRows) {
            // Attribute Manager class under the pointer
            const ring = buildSelectionOverlayTrace(
                base.traceX, base.traceY, hoveredRows,
                base.traceOriginalIndices, base.traceSizes, base.traceShapes,
                base.plotType, { color: HOVER_RING_COLOR, width: 2.5 }
            );
            if (ring) traces.splice(1, 0, ring);
        }
        return traces;
    };

    // Zoom to data and origin: per panel ranges over the visible points, widened to 0
    const originRanges = useMemo(() => {
        const out: Record<string, { x: [number, number] | null; y: [number, number] | null }> = {};
        if (zoom?.mode !== 'origin' || !xAxis) return out;
        const xc = getDisplayColumn(xAxis);
        for (const yName of yAxes) {
            const yc = getDisplayColumn(yName);
            if (!xc || !yc || !isNumericColumn(xc) || !isNumericColumn(yc)) continue;
            const both = sortedIndices.filter(i => Number.isFinite(xc[i]) && Number.isFinite(yc[i]));
            out[yName] = { x: axisRange(xc, both, true, logScaleX), y: axisRange(yc, both, true, logScaleY) };
        }
        return out;
    }, [zoom, xAxis, yAxes, getDisplayColumn, sortedIndices, logScaleX, logScaleY]);

    /** Visible points beyond the fixed limits per chart, and the data extents that fill open bounds */
    const { outsideByAxis, limitExtents } = useMemo(() => {
        const out: Record<string, number> = {};
        const ext: { x: [number, number] | null; y: Record<string, [number, number] | null> } = { x: null, y: {} };
        if (!xAxis || (!hasLimits(xLimits) && !Object.values(yLimits ?? {}).some(hasLimits))) return { outsideByAxis: out, limitExtents: ext };
        const xc = getDisplayColumn(xAxis);
        if (!xc) return { outsideByAxis: out, limitExtents: ext };
        const xs = sortedIndices.map(i => xc[i]);
        ext.x = extentOf(xs, logScaleX);
        for (const yName of yAxes) {
            const yc = getDisplayColumn(yName);
            if (!yc) continue;
            const ysv = sortedIndices.map(i => yc[i]);
            ext.y[yName] = extentOf(ysv, logScaleY);
            out[yName] = countOutside(xs, ysv, xLimits, yLimits?.[yName]);
        }
        return { outsideByAxis: out, limitExtents: ext };
    }, [xAxis, yAxes, xLimits, yLimits, getDisplayColumn, sortedIndices, logScaleX, logScaleY]);

    // Point density overlay per panel (visible points, log space for log axes)
    const densityGrids = useMemo(() => {
        const out: Record<string, DensityGrid | null> = {};
        if (!densityOverlay || !xAxis) return out;
        const xc = getDisplayColumn(xAxis);
        if (!xc || !isNumericColumn(xc)) return out;
        for (const yName of yAxes) {
            const yc = getDisplayColumn(yName);
            if (!yc || !isNumericColumn(yc)) continue;
            out[yName] = densityOverlayGrid(xc, yc, sortedIndices, { nx: densityCells[0], ny: densityCells[1], logX: logScaleX, logY: logScaleY });
        }
        return out;
    }, [densityOverlay, densityCells, xAxis, yAxes, getDisplayColumn, sortedIndices, logScaleX, logScaleY]);

    /** Reference lines clipped to the panel's visible data extent */
    const refLineTraces = useCallback((yName: string) => {
        if (!refLines.length || !xAxis) return [];
        const xc = getDisplayColumn(xAxis), yc = getDisplayColumn(yName);
        if (!xc || !yc || !isNumericColumn(xc) || !isNumericColumn(yc)) return [];
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const i of sortedIndices) {
            const a = xc[i], b = yc[i];
            if (!Number.isFinite(a) || !Number.isFinite(b) || (logScaleX && a <= 0) || (logScaleY && b <= 0)) continue;
            if (a < x0) x0 = a; if (a > x1) x1 = a; if (b < y0) y0 = b; if (b > y1) y1 = b;
        }
        if (!(x1 > x0)) return [];
        const traces: any[] = [];
        for (const line of refLines) {
            const level = refLineLevel(line, xAxis, yName);
            if (level) {
                const h = level.axis === 'y';
                traces.push({
                    type: 'scatter', mode: 'lines+text',
                    x: h ? [x0, x1] : [level.value, level.value], y: h ? [level.value, level.value] : [y0, y1],
                    text: ['', line.label], textposition: h ? 'top left' : 'top right', textfont: { size: 10, color: '#424242' },
                    line: { color: '#424242', width: 1.2, dash: 'dash' }, hoverinfo: 'name', name: line.label, showlegend: false,
                });
                continue;
            }
            const k = refLineSlope(line, xAxis, yName, geochemMappings);
            if (!k) continue;
            const a = Math.max(x0, y0 / k), b = Math.min(x1, y1 / k);
            if (!(b > a)) continue;
            const n = logScaleX !== logScaleY ? 40 : 2;
            const xs = Array.from({ length: n }, (_, j) => (logScaleX ? a * (b / a) ** (j / (n - 1)) : a + (b - a) * j / (n - 1)));
            traces.push({
                type: 'scatter', mode: 'lines+text', x: xs, y: xs.map(v => v * k),
                text: xs.map((_, j) => (j === n - 1 ? line.label : '')), textposition: 'top left',
                textfont: { size: 10, color: '#424242' },
                line: { color: '#424242', width: 1.2, dash: 'dash' }, hoverinfo: 'name', name: line.label, showlegend: false,
            });
        }
        return traces;
    }, [refLines, xAxis, getDisplayColumn, sortedIndices, logScaleX, logScaleY, geochemMappings]);

    // Statistics table: all visible points, then each colour group
    const statsRows = useMemo(() => {
        if (!statsOpen || !xAxis || !styleArrays) return [];
        const xc = getDisplayColumn(xAxis);
        if (!xc || !isNumericColumn(xc)) return [];
        const names = new Map<string, string>();
        for (const e of useAttributeStore.getState().color.entries) if (e.color && !names.has(e.color)) names.set(e.color, e.name);
        const groups = new Map<string, number[]>();
        if (color.field) for (const i of sortedIndices) {
            const g = names.get(styleArrays.colors[i]) ?? styleArrays.colors[i];
            const l = groups.get(g);
            if (l) l.push(i); else groups.set(g, [i]);
        }
        const rows: Array<{ x: string; y: string; group?: string; stats: ReturnType<typeof xyStats> }> = [];
        for (const yName of yAxes) {
            const yc = getDisplayColumn(yName);
            if (!yc || !isNumericColumn(yc)) continue;
            const opts = { logX: logScaleX, logY: logScaleY };
            rows.push({ x: d(xAxis), y: d(yName), stats: xyStats(xc, yc, sortedIndices, opts) });
            if (groups.size > 1) for (const [g, idx] of groups) rows.push({ x: d(xAxis), y: d(yName), group: g, stats: xyStats(xc, yc, idx, opts) });
        }
        return statsTable(rows);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [statsOpen, xAxis, yAxes, styleArrays, sortedIndices, logScaleX, logScaleY, color.field, getDisplayColumn]);

    // R² of every panel over all rows, only when sorting by it (not on every render)
    const isR2Sort = sortOrder.startsWith('r2');
    const r2ByAxis = useMemo(() => {
        const out = new Map<string, { r2: number; signed: number }>();
        if (!isR2Sort || !xAxis || yAxes.length < 2) return out;
        const getColumn = useAppStore.getState().getColumn;
        const xFullCol = getColumn(xAxis);
        const xValues = xFullCol && isNumericColumn(xFullCol) ? Array.from(xFullCol) : data.map(r => Number(r[xAxis]));
        for (const yName of yAxes) {
            const yFullCol = getColumn(yName);
            const yValues = yFullCol && isNumericColumn(yFullCol) ? Array.from(yFullCol) : data.map(r => Number(r[yName]));
            const regression = calculateLinearRegression(xValues, yValues, { logX: logScaleX, logY: logScaleY });
            out.set(yName, {
                r2: regression?.rSquared ?? -1,
                signed: (regression?.rSquared ?? 0) * (regression && regression.slope >= 0 ? 1 : -1),
            });
        }
        return out;
    }, [isR2Sort, xAxis, yAxes, data, logScaleX, logScaleY]);

    const sortedYAxes = useMemo((): string[] => {
        if (sortOrder === 'alphabetical') return [...yAxes].sort((a, b) => a.localeCompare(b));
        if (!isR2Sort) return yAxes;
        const r2 = (y: string) => r2ByAxis.get(y)?.r2 ?? -1;
        const signed = (y: string) => r2ByAxis.get(y)?.signed ?? 0;
        return [...yAxes].sort((a, b) => {
            if (sortOrder === 'r2-pos') return signed(b) - signed(a);
            if (sortOrder === 'r2-neg') return signed(a) - signed(b);
            return sortOrder === 'r2-high' ? r2(b) - r2(a) : r2(a) - r2(b);
        });
    }, [sortOrder, isR2Sort, yAxes, r2ByAxis]);

    // Stable per-panel relayout handlers (cells are memoised)
    const relayoutHandlers = useMemo(
        () => Object.fromEntries(yAxes.map(y => [y, (e: any) => handleRelayout(y, e)])) as Record<string, (e: any) => void>,
        [yAxes, handleRelayout],
    );

    // Traces and layout of every panel, rebuilt only when something they show changes
    const cells = useMemo(() => {
        if (!xAxis) return [];
        return sortedYAxes.map((yAxisName) => {
            const plotData = getPlotDataForAxis(yAxisName);
            const grid = densityGrids[yAxisName];
            let traces = [
                ...plotData,
                // Over the points, translucent, so the clusters read as in the reference software: on
                // overlay axes (x2/y2), since Plotly draws a subplot's heatmaps under its points
                ...(grid ? [{
                    type: 'heatmap' as const, x: grid.x, y: grid.y, z: grid.z, colorscale: DENSITY_OVERLAY_COLORSCALE,
                    showscale: false, opacity: densityOverlayOpacity, hoverinfo: 'skip' as const, zsmooth: false as const,
                    xaxis: 'x2', yaxis: 'y2',
                }] : []),
                ...refLineTraces(yAxisName),
            ];
            const nodeTrace = nodeValues && nodeXYTrace(nodeValues.nodes, nodeValues.values[xAxis], nodeValues.values[yAxisName], { logX: logScaleX, logY: logScaleY, labels: nodeLabelsOn(nodeIds) });
            const tieTrace = nodeValues && nodeXYTieTrace(nodeValues.nodes, nodeValues.values[xAxis], nodeValues.values[yAxisName], tiePairs(nodeIds));
            if (tieTrace) traces.push(tieTrace);
            if (nodeTrace) traces.push(nodeTrace);
            if (yxMode) traces = traces.map(swapXY);
            const xaxisLayout = {
                title: { text: d(xAxis), font: { size: fonts.axisTitle } },
                tickfont: { size: fonts.tickLabels },
                type: (xIsText ? 'category' : logScaleX ? 'log' : 'linear') as 'log' | 'linear' | 'category',
                ...(xIsText ? { categoryorder: 'category ascending' as const } : {}),
                ...(hasLimits(xLimits) && !xIsText
                    ? plotlyAxisRange(xLimits, logScaleX, limitExtents.x)
                    : zoom?.mode === 'origin' && originRanges[yAxisName]?.x
                    ? { range: originRanges[yAxisName].x!, autorange: false }
                    : lockFullExtent && fullXRange
                    ? { range: fullXRange, autorange: false }
                    : lockAxes && axisRangesRef.current[yAxisName]?.xRange
                        ? { range: axisRangesRef.current[yAxisName].xRange, autorange: false }
                        : {})
            };
            const yaxisLayout = {
                title: { text: d(yAxisName), font: { size: fonts.axisTitle } },
                tickfont: { size: fonts.tickLabels },
                type: (logScaleY ? 'log' : 'linear') as 'log' | 'linear',
                ...(hasLimits(yLimits?.[yAxisName])
                    ? plotlyAxisRange(yLimits[yAxisName], logScaleY, limitExtents.y[yAxisName])
                    : zoom?.mode === 'origin' && originRanges[yAxisName]?.y
                    ? { range: originRanges[yAxisName].y!, autorange: false }
                    : lockFullExtent && fullYRanges[yAxisName]
                    ? { range: fullYRanges[yAxisName], autorange: false }
                    : lockAxes && axisRangesRef.current[yAxisName]?.yRange
                        ? { range: axisRangesRef.current[yAxisName].yRange, autorange: false }
                        : {})
            };
            const r2 = isR2Sort ? r2ByAxis.get(yAxisName)?.r2 : undefined;
            const thin = basePlotDataByAxis[yAxisName]?.thinned;
            const title = `${yxMode ? `${d(yAxisName)} vs ${d(xAxis)}` : `${d(xAxis)} vs ${d(yAxisName)}`}${r2 !== undefined && r2 >= 0 ? ` · R² ${r2.toFixed(2)}` : ''}`
                + (thin ? `<span style="font-size:0.8em;color:#888"> · ${thin.shown.toLocaleString()} of ${thin.total.toLocaleString()} pts</span>` : '')
                + (outsideByAxis[yAxisName] ? `<span style="font-size:0.8em;color:#b26a00"> · ${outsideByAxis[yAxisName].toLocaleString()} beyond axis limits</span>` : '');
            const layout = {
                title: {
                    text: title,
                    font: { size: fonts.title },
                    // Compact cells: title left, clear of the hover toolbar
                    ...(fonts === COMPACT_FONT ? { x: 0.02, xanchor: 'left' as const } : {})
                },
                autosize: true,
                height: chartHeight,
                hovermode: 'closest' as const,
                dragmode: dragMode,
                selectdirection: 'any' as const,
                font: { size: fonts.tickLabels },
                xaxis: {
                    ...(yxMode ? yaxisLayout : xaxisLayout),
                    ...(equalAxes ? { scaleanchor: 'y' as const, scaleratio: 1 } : {}),
                },
                yaxis: yxMode ? xaxisLayout : yaxisLayout,
                ...(grid ? {
                    xaxis2: { overlaying: 'x' as const, matches: 'x' as const, visible: false, type: (yxMode ? yaxisLayout : xaxisLayout).type },
                    yaxis2: { overlaying: 'y' as const, matches: 'y' as const, visible: false, type: (yxMode ? xaxisLayout : yaxisLayout).type },
                } : {}),
                showlegend: false,
                margin: presentationMode
                    ? { l: 100, r: 50, t: 80, b: 100 }
                    : fonts === COMPACT_FONT
                        ? { l: 52, r: 16, t: 36, b: 46 }
                        : { l: 70, r: 40, t: 60, b: 70 },
                // Stable token: preserve pan/zoom across re-renders (selection,
                // styling); Plotly resets view only when the token changes
                uirevision: `${(lockAxes || lockFullExtent) ? 'locked' : `${xAxis}|${yAxisName}|${logScaleX}|${logScaleY}|${yxMode}`}|z${zoom?.nonce ?? 0}|L${JSON.stringify([xLimits, yLimits?.[yAxisName] ?? null])}`
            };
            // In a grid the mouse wheel scrolls the page; zooming every chart the
            // pointer passed over redrew it on each notch (zoom box / expand still work)
            const config = { ...getPlotConfig({ filename: `scatter_${xAxis}_${yAxisName}` }), ...(single ? {} : { scrollZoom: false }) };
            return { yAxisName, title, traces, layout, config };
        });
        // getPlotDataForAxis only reads basePlotDataByAxis, selectedIndices and hoveredRows (listed)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sortedYAxes, basePlotDataByAxis, selectedIndices, hoveredRows, densityGrids, densityOverlayOpacity, refLineTraces,
        nodeValues, nodeIds, yxMode, d, xAxis, fonts, xIsText, logScaleX, logScaleY, zoom, originRanges, xLimits, yLimits, outsideByAxis, limitExtents, lockFullExtent,
        fullXRange, fullYRanges, lockAxes, chartHeight, dragMode, equalAxes, presentationMode, isR2Sort, r2ByAxis, single]);

    return (
        <Box sx={{ p: 1 }}>
            <PlotControlBar
                primary={<>
                    <ColumnPicker label="X-Axis" value={xAxis} onChange={setXAxis} minWidth={180} filter="all" />
                    <MultiColumnSelector
                        columns={numericColumns}
                        selectedColumns={yAxes}
                        onChange={setYAxes}
                        label="Y-Axes"
                        allColumns={allNumericColumns}
                    />
                    {yAxes.length > 1 && (
                        <FormControl size="small" sx={{ minWidth: 150 }}>
                            <InputLabel>Sort charts</InputLabel>
                            <Select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} label="Sort charts" inputProps={{ 'aria-label': 'Sort charts' }}>
                                <MenuItem value="default">Selection order</MenuItem>
                                <MenuItem value="alphabetical">Alphabetical (A→Z)</MenuItem>
                                <MenuItem value="r2-high">Highest R²</MenuItem>
                                <MenuItem value="r2-low">Lowest R²</MenuItem>
                                <MenuItem value="r2-pos">Strongest positive R²</MenuItem>
                                <MenuItem value="r2-neg">Strongest negative R²</MenuItem>
                            </Select>
                        </FormControl>
                    )}
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <Tooltip title="Zoom to data"><span><IconButton size="small" disabled={!xAxis || !yAxes.length} onClick={() => zoomTo('data')}><ZoomOutMap fontSize="small" /></IconButton></span></Tooltip>
                        <Tooltip title="Zoom to data and origin"><span><IconButton size="small" disabled={!xAxis || !yAxes.length} onClick={() => zoomTo('origin')}><CenterFocusStrong fontSize="small" /></IconButton></span></Tooltip>
                        <Tooltip title={hasLimits(xLimits) || Object.values(yLimits ?? {}).some(hasLimits) ? 'Axis limits (set)' : 'Axis limits: fix min / max, saved with the plot'}>
                            <span><IconButton size="small" disabled={!xAxis || !yAxes.length} onClick={() => setLimitsOpen(true)}
                                color={hasLimits(xLimits) || Object.values(yLimits ?? {}).some(hasLimits) ? 'primary' : 'default'}><Straighten fontSize="small" /></IconButton></span>
                        </Tooltip>
                        <AxisLimitsDialog
                            open={limitsOpen} onClose={() => setLimitsOpen(false)}
                            xLabel={d(xAxis)} yAxes={yAxes.map(y => ({ name: y, label: d(y) }))}
                            xLimits={xLimits} yLimits={yLimits ?? {}}
                            onApply={(xl, yl) => { setXLimits(xl); setYLimits(yl); }}
                            currentView={() => {
                                // Plotly ranges are log10 on log axes; Y-X mode swaps the axes
                                const un = (r: [number, number] | undefined, log: boolean): AxisLimits | null =>
                                    r && Number.isFinite(+r[0]) && Number.isFinite(+r[1]) ? [log ? 10 ** +r[0] : +r[0], log ? 10 ** +r[1] : +r[1]] : null;
                                let x: AxisLimits | null = null;
                                const y: Record<string, AxisLimits> = {};
                                for (const [name, c] of Object.entries(axisRangesRef.current)) {
                                    const xr = un(yxMode ? c.yRange : c.xRange, logScaleX);
                                    const yr = un(yxMode ? c.xRange : c.yRange, logScaleY);
                                    if (xr && !x) x = xr;
                                    if (yr && yAxes.includes(name)) y[name] = yr;
                                }
                                return { x, y };
                            }}
                        />
                        <Tooltip title="Statistics of the visible points (n, r, R², slope, intercept)"><span><IconButton size="small" disabled={!xAxis || !yAxes.length} onClick={() => setStatsOpen(true)}><TableChart fontSize="small" /></IconButton></span></Tooltip>
                        <NodeLibraryButton value={nodeIds} onChange={setNodeIds} />
                        <RefLinesButton value={refLines} onChange={setRefLines} />
                    </Box>
                </>}
                settingsActive={logScaleX || logScaleY || equalAxes || yxMode || densityOverlay || showRegression || showDensity || presentationMode || cellSize !== 'auto' || pointsPerChart !== 'auto'}
                summary={<>
                    {(logScaleX || logScaleY) && (
                        <SettingChip
                            label={logScaleX && logScaleY ? 'Log XY' : logScaleX ? 'Log X' : 'Log Y'}
                            onDelete={() => { setLogScaleX(false); setLogScaleY(false); }}
                        />
                    )}
                    {equalAxes && <SettingChip label="1:1 axes" onDelete={() => setEqualAxes(false)} />}
                    {yxMode && <SettingChip label="YX" onDelete={() => setYxMode(false)} />}
                    {densityOverlay && <SettingChip label="Point density" onDelete={() => setDensityOverlay(false)} />}
                    {showRegression && <SettingChip label="Regression" onDelete={() => setShowRegression(false)} />}
                    {showDensity && <SettingChip label="Density" onDelete={() => setShowDensity(false)} />}
                    {presentationMode && <SettingChip label="Presentation" onDelete={() => setPresentationMode(false)} />}
                    {pointCap !== null && yAxes.length > 1 && <SettingChip label={`≤${pointCap.toLocaleString()} pts/chart`} onDelete={() => setPointsPerChart('all')} />}
                    {cellSize !== 'auto' && yAxes.length > 1 && <SettingChip label={`${cellSize[0].toUpperCase()}${cellSize.slice(1)} cells`} onDelete={() => setCellSize('auto')} />}
                </>}
                settings={<>
                    <ControlSection label="Scale">
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Tooltip title="Apply logarithmic scale to axes">
                                <Typography variant="body2" color="text.secondary">Log scale</Typography>
                            </Tooltip>
                            <ToggleButtonGroup
                                size="small"
                                value={[logScaleX ? 'x' : '', logScaleY ? 'y' : '', (logScaleX && logScaleY) ? 'both' : ''].filter(Boolean)}
                                onChange={(_, newValues: string[]) => {
                                    const hadBoth = logScaleX && logScaleY;
                                    const nowHasBoth = newValues.includes('both');
                                    if (nowHasBoth && !hadBoth) {
                                        setLogScaleX(true);
                                        setLogScaleY(true);
                                    } else if (!nowHasBoth && hadBoth) {
                                        setLogScaleX(false);
                                        setLogScaleY(false);
                                    } else {
                                        setLogScaleX(newValues.includes('x'));
                                        setLogScaleY(newValues.includes('y'));
                                    }
                                }}
                            >
                                <ToggleButton value="x">X</ToggleButton>
                                <ToggleButton value="y">Y</ToggleButton>
                                <ToggleButton value="both">Both</ToggleButton>
                            </ToggleButtonGroup>
                        </Box>
                        <Tooltip title="Lock 1:1 aspect ratio between axes (use for spatial data like East vs North)">
                            <FormControlLabel
                                control={<Checkbox checked={equalAxes} onChange={(e) => setEqualAxes(e.target.checked)} />}
                                label={<Typography variant="body2">Equal axes (1:1)</Typography>}
                            />
                        </Tooltip>
                        <Tooltip title="YX plot: the X-axis variable goes on the Y axis of every chart">
                            <FormControlLabel
                                control={<Checkbox checked={yxMode} onChange={(e) => setYxMode(e.target.checked)} />}
                                label={<Typography variant="body2">YX plot (first variable on Y)</Typography>}
                            />
                        </Tooltip>
                    </ControlSection>

                    <ControlSection label="Overlays">
                        <ApplyDiagramButton plotId={plotId} kind="xy" />
                        <FormControlLabel
                            control={<Checkbox checked={showRegression} onChange={(e) => setShowRegression(e.target.checked)} />}
                            label={<Typography variant="body2">Regression</Typography>}
                        />
                        {showRegression && (
                            <FormControl sx={{ ml: 3.5, minWidth: 170 }}>
                                <InputLabel>Regression Mode</InputLabel>
                                <Select value={regressionMode} onChange={(e) => setRegressionMode(e.target.value as 'global' | 'per-category')} label="Regression Mode">
                                    <MenuItem value="global">Global</MenuItem>
                                    <MenuItem value="per-category">Per-Category</MenuItem>
                                </Select>
                            </FormControl>
                        )}
                        <Tooltip title="point density contour overlay: counts per grid cell drawn under the points, which keep their colours">
                            <FormControlLabel
                                control={<Checkbox checked={densityOverlay} onChange={(e) => setDensityOverlay(e.target.checked)} />}
                                label={<Typography variant="body2">Point density overlay</Typography>}
                            />
                        </Tooltip>
                        {densityOverlay && (
                            <Box sx={{ ml: 3.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                <Box sx={{ display: 'flex', gap: 1 }}>
                                    <TextField size="small" type="number" label="Cells across" sx={{ width: 110 }} value={densityCells[0]}
                                        onChange={(e) => setDensityCells([Math.max(10, Math.min(600, Number(e.target.value) || 180)), densityCells[1]])} />
                                    <TextField size="small" type="number" label="Cells down" sx={{ width: 110 }} value={densityCells[1]}
                                        onChange={(e) => setDensityCells([densityCells[0], Math.max(10, Math.min(600, Number(e.target.value) || 140))])} />
                                </Box>
                                <Typography variant="caption" color="text.secondary">Opacity: {Math.round(densityOverlayOpacity * 100)}%</Typography>
                                <Slider value={densityOverlayOpacity} onChange={(_, v) => setDensityOverlayOpacity(v as number)} min={0.1} max={1} step={0.05} size="small" />
                            </Box>
                        )}
                        <FormControlLabel
                            control={<Checkbox checked={showDensity} onChange={(e) => setShowDensity(e.target.checked)} />}
                            label={<Typography variant="body2">Density colouring</Typography>}
                        />
                        {showDensity && (
                            <Box sx={{ ml: 3.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                <Typography variant="caption" color="text.secondary">
                                    Smoothing: {densitySmoothing.toFixed(1)}
                                </Typography>
                                <Slider
                                    value={densitySmoothing}
                                    onChange={(_, value) => setDensitySmoothing(value as number)}
                                    min={0.5}
                                    max={8}
                                    step={0.5}
                                    valueLabelDisplay="auto"
                                    size="small"
                                />
                                <Typography variant="caption" color="text.secondary">
                                    Opacity: {Math.round(densityOpacity * 100)}%
                                </Typography>
                                <Slider
                                    value={densityOpacity}
                                    onChange={(_, value) => setDensityOpacity(value as number)}
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    valueLabelDisplay="auto"
                                    valueLabelFormat={(v) => `${Math.round(v * 100)}%`}
                                    size="small"
                                />
                                <Tooltip title="Spread color gradient across medium-density regions (reduces all-blue effect)">
                                    <FormControlLabel
                                        control={<Checkbox checked={densitySqrtNorm} onChange={(e) => setDensitySqrtNorm(e.target.checked)} />}
                                        label={<Typography variant="body2">Sqrt scale</Typography>}
                                    />
                                </Tooltip>
                            </Box>
                        )}
                    </ControlSection>

                    <ControlSection label="Display">
                        <Tooltip title="Use much larger text and markers for PowerPoint exports">
                            <FormControlLabel
                                control={<Checkbox checked={presentationMode} onChange={(e) => setPresentationMode(e.target.checked)} />}
                                label={<Typography variant="body2">Presentation mode</Typography>}
                            />
                        </Tooltip>
                        {yAxes.length > 1 && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Tooltip title="Size of each chart when plotting several Y axes. Auto uses small cells for more than four.">
                                    <Typography variant="body2" color="text.secondary">Chart size</Typography>
                                </Tooltip>
                                <ToggleButtonGroup size="small" exclusive value={cellSize} onChange={(_, v: CellSize | null) => v && setCellSize(v)}>
                                    <ToggleButton value="auto">Auto</ToggleButton>
                                    <ToggleButton value="small">S</ToggleButton>
                                    <ToggleButton value="medium">M</ToggleButton>
                                    <ToggleButton value="large">L</ToggleButton>
                                </ToggleButtonGroup>
                            </Box>
                        )}
                        {yAxes.length > 1 && (
                            <FormControl size="small" sx={{ minWidth: 200 }}>
                                <InputLabel>Points per chart</InputLabel>
                                <Select
                                    value={String(pointsPerChart)} label="Points per chart"
                                    onChange={(e) => { const v = e.target.value; setPointsPerChart(v === 'auto' || v === 'all' ? v : Number(v)); }}
                                >
                                    <MenuItem value="auto">Auto ({AUTO_POINT_CAP.toLocaleString()} when more than {AUTO_SMALL_AFTER} charts)</MenuItem>
                                    <MenuItem value="all">All points</MenuItem>
                                    <MenuItem value="1000">1,000</MenuItem>
                                    <MenuItem value="3000">3,000</MenuItem>
                                    <MenuItem value="10000">10,000</MenuItem>
                                </Select>
                            </FormControl>
                        )}
                    </ControlSection>
                </>}
            />

            {!xAxis || yAxes.length === 0 ? (
                <Typography color="text.secondary">Select X-axis and at least one Y-axis to display plots</Typography>
            ) : (
                // Columns follow the pane width, not the viewport (plots live in dock panes)
                <Box ref={fillRef} sx={{ display: 'grid', gridTemplateColumns: single ? '1fr' : `repeat(auto-fill, minmax(${cell.min}px, 1fr))`, gap: cell.compact ? 1 : 1.5 }}>
                    {cells.map(c => (
                        <ScatterCell
                            key={c.yAxisName}
                            data={c.traces} layout={c.layout} config={c.config} title={c.title}
                            height={chartHeight} padding={cell.compact && !single ? 0.5 : 1} lazy={!single}
                            onSelected={handleSelected} onDeselect={handleDeselect} onRelayout={relayoutHandlers[c.yAxisName]}
                        />
                    ))}
                </Box>
            )}
            <Dialog open={statsOpen} onClose={() => setStatsOpen(false)} maxWidth="md" fullWidth>
                <DialogTitle>Visible statistics{(logScaleX || logScaleY) ? ` (log10 ${logScaleX && logScaleY ? 'X and Y' : logScaleX ? 'X' : 'Y'})` : ''}</DialogTitle>
                <DialogContent dividers sx={{ p: 0 }}>
                    <Table size="small" stickyHeader>
                        <TableHead><TableRow>{(statsRows[0] ?? []).map(h => <TableCell key={String(h)}>{h}</TableCell>)}</TableRow></TableHead>
                        <TableBody>
                            {statsRows.slice(1).map((r, i) => (
                                <TableRow key={i} sx={r[2] === 'All visible' ? { '& td': { fontWeight: 600 } } : undefined}>
                                    {r.map((v, k) => <TableCell key={k} align={k >= 3 ? 'right' : 'left'}>{v}</TableCell>)}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </DialogContent>
                <DialogActions>
                    <Button onClick={async () => {
                        try {
                            await navigator.clipboard.writeText(statsRows.map(r => r.join('\t')).join('\r\n'));
                            notify('Statistics copied', 'success');
                        } catch { notify('Clipboard not available', 'warning'); }
                    }}>Copy</Button>
                    <Button onClick={() => setStatsOpen(false)}>Close</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};
