/**
 * PathfinderMap Component
 *
 * Generates 2D or 3D maps for pathfinder element anomaly classification.
 * Based on Dr. Scott Halley's pathfinder chemistry methodology.
 *
 * Points are colored by anomaly class (multiple of crustal abundance):
 * - Background (≤1x) - Blue
 * - 2x - Cyan
 * - 3x - Green
 * - 5x - Yellow
 * - 10x (≥10x) - Red
 *
 * Structure (features/plots/pathfinder/):
 * - usePathfinderSettings: persisted per-plot settings
 * - usePathfinderColumns: element / normalisation column detection
 * - pathfinderTraces: pure trace builders (memoised here per element)
 * - PathfinderControlBar, PathfinderElementPanel, PathfinderElementCard, PathfinderDialogs
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
    Box, Paper, Typography, IconButton, Collapse, Grid, Button, Tooltip, Stack,
} from '@mui/material';
import { ExpandMore, ExpandLess, Info, Settings, Map as MapIcon, TableChart, MenuBook, Refresh } from '@mui/icons-material';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import { useShallow } from 'zustand/react/shallow';
import { transformCoordinates } from '../../utils/basemapUtils';
import { useAppStore, useDatasetRows, useDisplayRows } from '../../store/appStore';
import { useAttributeStore } from '../../store/attributeStore';
import { sortColumnsByPriority, getColumnDisplayName, getStyleArraysColumnar } from '../../utils/attributeUtils';
import { useStyleInputs } from '../../hooks/useStyleInputs';
import { useSelectionHandler } from '../../hooks/useSelectionHandler';
import {
    ANOMALY_CLASSES, ANOMALY_COLORS, ANOMALY_LABELS, ANOMALY_THRESHOLDS, type PathfinderElement,
} from '../../utils/calculations/pathfinderConstants';
import { qgisApi } from '../../services/api';
import { AxisRangeControl, type PickState } from '../../components/AxisRangeControl';
import {
    BACKGROUND_STANDARDS, getBackgroundValue, generateAnomalyThresholds,
} from '../../utils/calculations/elementBackgroundConstants';
import { PathfinderPublicationDialog } from './pathfinder';
import { usePathfinderSettings } from './pathfinder/usePathfinderSettings';
import { usePathfinderColumns } from './pathfinder/usePathfinderColumns';
import {
    buildElementMapData, buildProbabilityData, type ElementMapData, type ProbabilityPlotData,
} from './pathfinder/pathfinderTraces';
import { PathfinderControlBar } from './pathfinder/PathfinderControlBar';
import { PathfinderElementPanel } from './pathfinder/PathfinderElementPanel';
import { PathfinderElementCard } from './pathfinder/PathfinderElementCard';
import { PathfinderThresholdDialog, PathfinderColumnMappingDialog } from './pathfinder/PathfinderDialogs';
import type { AxisRanges3D, TransformedCoords } from './pathfinder/types';

interface PathfinderMapProps {
    plotId: string;
}

// PathfinderMap uses customdata.index instead of customdata.idx
const pathfinderIndexExtractor = (point: any): number | null => {
    if (point.customdata && typeof point.customdata.index === 'number') return point.customdata.index;
    return null;
};

const NO_PICK: PickState = { axis: null, clickCount: 0, firstValue: null };

const isNumericType = (t: string) => t === 'numeric' || t === 'float' || t === 'integer';

/** Grid columns per element card, by number of active elements */
function gridColumnsFor(count: number): number {
    if (count <= 1) return 12;
    if (count <= 4) return 6;
    if (count <= 6) return 4;
    return 3;
}

export const PathfinderMap: React.FC<PathfinderMapProps> = ({ plotId }) => {
    const columns = useAppStore(s => s.columns);
    const geochemMappings = useAppStore(s => s.geochemMappings);
    // useShallow keeps the array identity while its contents are unchanged
    const filteredColumns = useAppStore(useShallow(s => s.getFilteredColumns()));
    const addColumn = useAppStore(s => s.addColumn);
    const displayIndices = useAppStore(s => s._sampleIndicesArray);
    const getDisplayColumn = useAppStore(s => s.getDisplayColumn);
    const styleInputs = useStyleInputs();
    const emphasis = useAttributeStore(s => s.emphasis);
    const data = useDatasetRows();
    const displayData = useDisplayRows();
    const { handleSelected, handleDeselect, selectedIndices } = useSelectionHandler(pathfinderIndexExtractor);
    const d = useCallback((name: string) => getColumnDisplayName(columns, name), [columns]);

    const settings = usePathfinderSettings(plotId);
    const {
        xAxis, setXAxis, yAxis, setYAxis, zAxis, setZAxis, is3D, equalAxes,
        selectedElements, setSelectedElements, normalization, visibleClasses,
        controlsExpanded, setControlsExpanded, showProbabilityPlots,
        elementColumnMapping, setElementColumnMapping, scColumn, setScColumn, kColumn, setKColumn,
        mapViewStyle, epsgCode, basemapOpacity, dragMode, basePointSize,
        axisRanges3D, setAxisRanges3D, axisModes3D, setAxisModes3D, sliceWidths3D, setSliceWidths3D,
        slicePositions3D, setSlicePositions3D, rangeControlsExpanded, setRangeControlsExpanded,
        mapMode, referenceStandard, selectedExtendedElements,
    } = settings;

    const cols = usePathfinderColumns(filteredColumns, geochemMappings, settings);
    const {
        autoDetectedColumns, autoDetectedNormColumns, effectiveScColumn, effectiveKColumn,
        availableElements, getActiveElementColumn, getExtendedBackground, toPpmFactor,
    } = cols;

    // Dialogs
    const [infoDialogOpen, setInfoDialogOpen] = useState(false);
    const [mappingDialogOpen, setMappingDialogOpen] = useState(false);
    const [publicationDialogOpen, setPublicationDialogOpen] = useState(false);

    // Basemap (2D only)
    const [projectionError, setProjectionError] = useState<string | null>(null);
    const [isTransforming, setIsTransforming] = useState(false);
    const [transformedCoords, setTransformedCoords] = useState<TransformedCoords | null>(null);
    const [plotRevision, setPlotRevision] = useState(0);
    const basemapEnabled = mapViewStyle !== 'normal' && !is3D;

    // 3D pick mode
    const [pickState3D, setPickState3D] = useState<PickState>(NO_PICK);
    const mouseDownPos3D = useRef<{ x: number; y: number } | null>(null);

    // QGIS sync / feedback
    const [qgisLoading, setQgisLoading] = useState(false);
    const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({
        open: false, message: '', severity: 'success',
    });
    const notifyResult = useCallback((message: string, severity: 'success' | 'error' | 'info') => {
        setSnackbar({ open: true, message, severity });
    }, []);

    // The active element list depends on mode
    const activeElements: string[] = mapMode === 'pathfinder' ? selectedElements : selectedExtendedElements;

    const handleZoomToData = useCallback(() => setPlotRevision(prev => prev + 1), []);

    // Zoom to data once the map first has something to show
    const readyToShow = data.length > 0 && !!xAxis && !!yAxis && activeElements.length > 0;
    useEffect(() => {
        if (!readyToShow) return;
        // Small delay so the plots are rendered first
        const timer = setTimeout(handleZoomToData, 100);
        return () => clearTimeout(timer);
    }, [readyToShow, handleZoomToData]);

    // Auto-select coordinate columns when none are set
    useEffect(() => {
        if (columns.length === 0 || xAxis || yAxis) return;
        const east = columns.find(c => c.name === 'X') || columns.find(c => c.role === 'East');
        const north = columns.find(c => c.name === 'Y') || columns.find(c => c.role === 'North');
        const elevation = columns.find(c => c.name === 'Z') || columns.find(c => c.role === 'Elevation');
        if (east) setXAxis(east.name);
        if (north) setYAxis(north.name);
        if (elevation) setZAxis(elevation.name);
    }, [columns, xAxis, yAxis, setXAxis, setYAxis, setZAxis]);

    // Auto-select available elements if the selection has never been set
    // (an explicitly cleared selection is stored as [] and left alone)
    useEffect(() => {
        const stored = useAppStore.getState().plots.find(p => p.id === plotId)?.settings?.selectedElements;
        if (availableElements.length > 0 && stored === undefined) {
            setSelectedElements(availableElements.slice(0, 8));
        }
    }, [availableElements, plotId, setSelectedElements]);

    // Transform coordinates when the basemap is enabled (2D mode only)
    useEffect(() => {
        if (!basemapEnabled || !epsgCode || !data.length || !xAxis || !yAxis) {
            setTransformedCoords(null);
            setProjectionError(null);
            return;
        }
        let cancelled = false;
        setIsTransforming(true);
        setProjectionError(null);
        transformCoordinates(data.map(row => row[xAxis]), data.map(row => row[yAxis]), epsgCode)
            .then(result => { if (!cancelled) setTransformedCoords(result); })
            .catch((err: any) => {
                if (cancelled) return;
                console.error('[PathfinderMap] Coordinate transformation failed:', err);
                setProjectionError(err.message || 'Failed to transform coordinates');
                setTransformedCoords(null);
            })
            .finally(() => { if (!cancelled) setIsTransforming(false); });
        return () => { cancelled = true; };
    }, [basemapEnabled, epsgCode, data, xAxis, yAxis]);

    const numericColumns = useMemo(
        () => sortColumnsByPriority(filteredColumns.filter(c => c && c.name && isNumericType(c.type))),
        [filteredColumns]
    );

    // 3D data ranges for axis controls
    const dataRanges3D = useMemo<AxisRanges3D | null>(() => {
        if (!is3D || !data.length || !xAxis || !yAxis || !zAxis) return null;
        let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity, zMin = Infinity, zMax = -Infinity;
        let count = 0;
        for (const row of data) {
            const x = row[xAxis], y = row[yAxis], z = row[zAxis];
            if (x != null && !isNaN(x)) { if (x < xMin) xMin = x; if (x > xMax) xMax = x; }
            if (y != null && !isNaN(y)) { if (y < yMin) yMin = y; if (y > yMax) yMax = y; }
            if (z != null && !isNaN(z)) { if (z < zMin) zMin = z; if (z > zMax) zMax = z; count++; }
        }
        if (count === 0) return null;
        return { x: [xMin, xMax], y: [yMin, yMax], z: [zMin, zMax] };
    }, [is3D, data, xAxis, yAxis, zAxis]);

    const resetAxisRanges3D = useCallback(() => {
        if (!dataRanges3D) return;
        setAxisRanges3D({ x: [...dataRanges3D.x], y: [...dataRanges3D.y], z: [...dataRanges3D.z] });
    }, [dataRanges3D, setAxisRanges3D]);

    // Initialise 3D axis ranges from the data
    useEffect(() => {
        if (dataRanges3D && !axisRanges3D) resetAxisRanges3D();
    }, [dataRanges3D, axisRanges3D, resetAxisRanges3D]);

    // 3D pick mode click handler
    const handlePathfinder3DClick = useCallback((event: any) => {
        if (!pickState3D.axis) return;
        if (mouseDownPos3D.current) {
            const dx = (event.event?.clientX ?? 0) - mouseDownPos3D.current.x;
            const dy = (event.event?.clientY ?? 0) - mouseDownPos3D.current.y;
            if (Math.sqrt(dx * dx + dy * dy) > 5) { mouseDownPos3D.current = null; return; }
        }
        const point = event.points?.[0];
        if (!point) return;
        const axisKey = pickState3D.axis;
        const coordValue = axisKey === 'x' ? point.x : axisKey === 'y' ? point.y : point.z;
        if (coordValue == null || isNaN(coordValue)) return;
        if (pickState3D.clickCount === 0) {
            setPickState3D({ axis: axisKey, clickCount: 1, firstValue: coordValue });
        } else {
            const v1 = pickState3D.firstValue!;
            setAxisRanges3D(prev => prev ? { ...prev, [axisKey]: [Math.min(v1, coordValue), Math.max(v1, coordValue)] } : null);
            setPickState3D(NO_PICK);
        }
    }, [pickState3D, setAxisRanges3D]);

    const handleResetAll3D = () => {
        if (!dataRanges3D) return;
        resetAxisRanges3D();
        setAxisModes3D({ x: 'range', y: 'range', z: 'range' });
        setPickState3D(NO_PICK);
    };

    // WebGL scatter unless that would exceed the browser's ~16 WebGL contexts
    // (each element uses 2 contexts in 2D mode with probability plots)
    const contextsPerElement = showProbabilityPlots ? 2 : 1;
    const scatterType: 'scatter' | 'scattergl' = activeElements.length * contextsPerElement <= 16 ? 'scattergl' : 'scatter';

    const mapboxCoords = basemapEnabled && transformedCoords && !projectionError && !isTransforming ? transformedCoords : null;
    const selectedSet = useMemo(() => new Set(selectedIndices), [selectedIndices]);

    // Per-element map traces — rebuilt only when their inputs change (not on
    // every render, e.g. when a dialog opens)
    const mapDataByElement = useMemo(() => {
        const out = new Map<string, ElementMapData>();
        // Rows hidden in the Attribute Manager are hidden on the pathfinder maps too
        void styleInputs;
        const rowVisible = getStyleArraysColumnar(displayData.length, (name) => getDisplayColumn(name), displayIndices ?? undefined).visible;
        for (const element of activeElements) {
            const elementColumn = getActiveElementColumn(element);
            out.set(element, buildElementMapData({
                element, elementColumn, rows: displayData, displayIndices,
                xAxis, yAxis, zAxis, is3D, axisRanges3D, mapMode, normalization,
                scColumn: effectiveScColumn, kColumn: effectiveKColumn, visibleClasses,
                extendedBackground: mapMode === 'extended' ? getExtendedBackground(element) : null,
                toPpm: elementColumn ? toPpmFactor(elementColumn) : 1,
                emphasis, basePointSize, selectedSet, mapboxCoords, scatterType, rowVisible,
            }));
        }
        return out;
    }, [activeElements, getActiveElementColumn, displayData, displayIndices, xAxis, yAxis, zAxis, is3D,
        axisRanges3D, mapMode, normalization, effectiveScColumn, effectiveKColumn, visibleClasses,
        getExtendedBackground, toPpmFactor, emphasis, basePointSize, selectedSet, mapboxCoords, scatterType,
        styleInputs, getDisplayColumn]);

    // Per-element probability plots (independent of axes, selection and styling)
    const probDataByElement = useMemo(() => {
        const out = new Map<string, ProbabilityPlotData | null>();
        if (!showProbabilityPlots) return out;
        for (const element of activeElements) {
            const elementColumn = getActiveElementColumn(element);
            out.set(element, buildProbabilityData({
                element, elementColumn, rows: displayData,
                toPpm: elementColumn ? toPpmFactor(elementColumn) : 1,
                mapMode,
                extendedBackground: mapMode === 'extended' ? getExtendedBackground(element) : null,
            }));
        }
        return out;
    }, [showProbabilityPlots, activeElements, getActiveElementColumn, displayData, toPpmFactor, mapMode, getExtendedBackground]);

    // Background / 10x summary per element for the card footer
    const thresholdSummaries = useMemo(() => {
        const out = new Map<string, { background: number; x5: number; unit: string } | null>();
        for (const element of activeElements) {
            if (mapMode === 'extended') {
                const bg = getExtendedBackground(element);
                const t = bg ? generateAnomalyThresholds(bg) : null;
                const unit = getBackgroundValue(referenceStandard === 'custom' ? 'ucc-rudnick-gao-2003' : referenceStandard, element)?.unit || 'ppm';
                out.set(element, t ? { background: t.background, x5: t.x5, unit } : null);
            } else {
                const t = ANOMALY_THRESHOLDS[element as PathfinderElement];
                out.set(element, t ? { background: t.background, x5: t.x5, unit: 'ppm' } : null);
            }
        }
        return out;
    }, [activeElements, mapMode, getExtendedBackground, referenceStandard]);

    const mapboxProp = useMemo(
        () => (mapboxCoords ? { style: mapViewStyle, coords: mapboxCoords, opacity: basemapOpacity } : null),
        [mapboxCoords, mapViewStyle, basemapOpacity]
    );

    // Write pathfinder values (multiples of background) to the data table
    const handleWritePathfinderValues = () => {
        if (activeElements.length === 0) {
            notifyResult('No elements selected', 'error');
            return;
        }
        let columnsAdded = 0;
        for (const element of activeElements) {
            const elementColumn = getActiveElementColumn(element);
            if (!elementColumn) continue;

            let backgroundValue: number;
            let suffix: string;
            if (mapMode === 'extended') {
                const bg = getExtendedBackground(element);
                if (bg === null) continue;
                backgroundValue = bg;
                const stdLabel = referenceStandard === 'custom' ? 'custom' : referenceStandard.split('-')[0].toUpperCase();
                suffix = `${stdLabel}(${backgroundValue})`;
            } else {
                backgroundValue = ANOMALY_THRESHOLDS[element as PathfinderElement].background;
                suffix = `PF(${backgroundValue})`;
            }

            const newColumnName = `${element}_${suffix}`;
            if (columns.some(c => c.name === newColumnName)) continue;

            const elementToPpm = toPpmFactor(elementColumn);
            const values = data.map(row => {
                const val = row[elementColumn];
                if (val == null || isNaN(val) || val <= 0) return null;
                return (val * elementToPpm) / backgroundValue;
            });
            addColumn(newColumnName, values, 'numeric', 'Pathfinder', 'pathfinder' as any);
            columnsAdded++;
        }
        notifyResult(
            columnsAdded > 0
                ? `Added ${columnsAdded} anomaly columns (value ÷ background)`
                : 'No new columns added (columns may already exist)',
            columnsAdded > 0 ? 'success' : 'info'
        );
    };

    // Load pathfinders to QGIS
    const handleLoadToQgis = async () => {
        if (activeElements.length === 0) {
            notifyResult('No elements selected', 'error');
            return;
        }
        if (!data || data.length === 0) {
            notifyResult('No data loaded', 'error');
            return;
        }
        setQgisLoading(true);
        try {
            // First sync the data to the backend so QGIS can fetch it
            await qgisApi.syncData(data, columns);
            const result = await qgisApi.syncPathfinders({
                elements: activeElements,
                xField: xAxis,
                yField: yAxis,
                zField: is3D ? zAxis : undefined,
                normalization,
                scColumn: scColumn || undefined,
                kColumn: kColumn || undefined,
                elementColumnMapping: elementColumnMapping as Record<string, string>,
            });
            notifyResult(`Sent ${result.elements} pathfinder elements to QGIS`, 'success');
        } catch {
            notifyResult('Failed to sync pathfinders to QGIS. Is the backend running?', 'error');
        } finally {
            setQgisLoading(false);
        }
    };

    const gridCols = gridColumnsFor(activeElements.length);

    return (
        <Box sx={{ p: 1 }}>
            {/* Header */}
            <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                    <Typography variant="h6">
                        {mapMode === 'pathfinder' ? 'Pathfinder Map' : 'Element Anomaly Map'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        {mapMode === 'pathfinder'
                            ? "Based on Dr. Scott Halley's pathfinder chemistry methodology"
                            : `Background: ${BACKGROUND_STANDARDS.find(s => s.id === referenceStandard)?.name || 'Custom'}`
                        }
                    </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 1 }}>
                    <Tooltip title="Add anomaly multiples to data table (value ÷ background)">
                        <span>
                            <IconButton onClick={handleWritePathfinderValues} size="small" color="primary" disabled={activeElements.length === 0}>
                                <TableChart />
                            </IconButton>
                        </span>
                    </Tooltip>
                    <Tooltip title="Load active elements to QGIS">
                        <span>
                            <IconButton onClick={handleLoadToQgis} size="small" color="success" disabled={qgisLoading || activeElements.length === 0}>
                                <MapIcon />
                            </IconButton>
                        </span>
                    </Tooltip>
                    <Tooltip title="Export Publication Figure">
                        <span>
                            <IconButton
                                onClick={() => setPublicationDialogOpen(true)}
                                size="small"
                                color="secondary"
                                disabled={activeElements.length === 0 || !xAxis || !yAxis}
                            >
                                <MenuBook />
                            </IconButton>
                        </span>
                    </Tooltip>
                    <Tooltip title="View Thresholds">
                        <IconButton onClick={() => setInfoDialogOpen(true)} size="small" color="info">
                            <Info />
                        </IconButton>
                    </Tooltip>
                    {mapMode === 'pathfinder' && (
                        <Tooltip title="Configure Column Mappings">
                            <IconButton onClick={() => setMappingDialogOpen(true)} size="small" color="primary">
                                <Settings />
                            </IconButton>
                        </Tooltip>
                    )}
                    <IconButton onClick={() => setControlsExpanded(!controlsExpanded)} size="small">
                        {controlsExpanded ? <ExpandLess /> : <ExpandMore />}
                    </IconButton>
                </Box>
            </Box>

            {/* Controls */}
            <PathfinderControlBar
                settings={settings}
                basemapEnabled={basemapEnabled}
                projectionError={projectionError}
                isTransforming={isTransforming}
                selectedCount={selectedIndices.length}
                onDeselect={handleDeselect}
                onZoomToData={handleZoomToData}
            />
            {basemapEnabled && projectionError && (
                <Alert severity="error" sx={{ mb: 2 }}>{projectionError}</Alert>
            )}
            {basemapEnabled && !epsgCode && !projectionError && (
                <Alert severity="info" sx={{ mb: 2 }}>
                    Search for an EPSG code or type any code (e.g., 3719 or EPSG:3719)
                </Alert>
            )}

            {/* Element selection panel */}
            <Collapse in={controlsExpanded}>
                <PathfinderElementPanel
                    settings={settings}
                    availableElements={availableElements}
                    availableExtendedElements={cols.availableExtendedElements}
                    getElementColumn={cols.getElementColumn}
                    getExtendedElementColumn={cols.getExtendedElementColumn}
                    effectiveScColumn={effectiveScColumn}
                    effectiveKColumn={effectiveKColumn}
                    autoDetectedNormColumns={autoDetectedNormColumns}
                />
            </Collapse>

            {/* Legend */}
            <Paper sx={{ p: 1, mb: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2, flexWrap: 'wrap' }}>
                    {ANOMALY_CLASSES.map(cls => (
                        <Box key={cls} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: ANOMALY_COLORS[cls] }} />
                            <Typography variant="caption">{ANOMALY_LABELS[cls]}</Typography>
                        </Box>
                    ))}
                </Box>
            </Paper>

            {/* 3D Axis Range Controls */}
            {is3D && dataRanges3D && axisRanges3D && (
                <Paper sx={{ p: 2, mb: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="subtitle2">Axis Ranges</Typography>
                            <IconButton size="small" onClick={() => setRangeControlsExpanded(!rangeControlsExpanded)}>
                                {rangeControlsExpanded ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                            </IconButton>
                        </Box>
                        <Button
                            size="small"
                            startIcon={<Refresh />}
                            onClick={handleResetAll3D}
                            disabled={
                                axisRanges3D.x[0] === dataRanges3D.x[0] && axisRanges3D.x[1] === dataRanges3D.x[1] &&
                                axisRanges3D.y[0] === dataRanges3D.y[0] && axisRanges3D.y[1] === dataRanges3D.y[1] &&
                                axisRanges3D.z[0] === dataRanges3D.z[0] && axisRanges3D.z[1] === dataRanges3D.z[1]
                            }
                        >
                            Reset All
                        </Button>
                    </Box>
                    <Collapse in={rangeControlsExpanded}>
                        <Stack spacing={1.5}>
                            {(['x', 'y', 'z'] as const).map((ax) => {
                                const colorMap = { x: 'primary', y: 'secondary', z: 'error' } as const;
                                const defaultWidth = (dataRanges3D[ax][1] - dataRanges3D[ax][0]) / 10;
                                return (
                                    <AxisRangeControl
                                        key={ax}
                                        label={ax.toUpperCase()}
                                        axis={ax}
                                        value={axisRanges3D[ax]}
                                        dataRange={dataRanges3D[ax]}
                                        onChange={(val) => setAxisRanges3D(prev => prev ? { ...prev, [ax]: val } : null)}
                                        onReset={() => setAxisRanges3D(prev => prev ? { ...prev, [ax]: [...dataRanges3D[ax]] as [number, number] } : null)}
                                        color={colorMap[ax]}
                                        mode={axisModes3D[ax]}
                                        onModeChange={(m) => setAxisModes3D({ ...axisModes3D, [ax]: m })}
                                        sliceWidth={sliceWidths3D[ax] || defaultWidth}
                                        onSliceWidthChange={(w) => setSliceWidths3D({ ...sliceWidths3D, [ax]: w })}
                                        slicePosition={slicePositions3D[ax] || dataRanges3D[ax][0]}
                                        onSlicePositionChange={(p) => setSlicePositions3D({ ...slicePositions3D, [ax]: p })}
                                        pickState={pickState3D}
                                        onPickStart={() => setPickState3D({ axis: ax, clickCount: 0, firstValue: null })}
                                        onPickCancel={() => setPickState3D(NO_PICK)}
                                    />
                                );
                            })}
                        </Stack>
                    </Collapse>
                </Paper>
            )}

            {/* Plot Grid */}
            {!xAxis || !yAxis || activeElements.length === 0 ? (
                <Typography color="text.secondary">
                    Select X-axis, Y-axis, and at least one element to display maps
                </Typography>
            ) : (
                <Grid container spacing={2}>
                    {activeElements.map(element => {
                        const elementColumn = getActiveElementColumn(element);
                        return (
                            <Grid item xs={12} sm={gridCols} key={element}>
                                <PathfinderElementCard
                                    element={element}
                                    title={`${element} (${elementColumn ? d(elementColumn) : element})`}
                                    mapData={mapDataByElement.get(element)!}
                                    probData={probDataByElement.get(element) ?? null}
                                    showProbabilityPlot={showProbabilityPlots}
                                    thresholdSummary={thresholdSummaries.get(element) ?? null}
                                    is3D={is3D}
                                    equalAxes={equalAxes}
                                    dragMode={dragMode}
                                    plotRevision={plotRevision}
                                    xTitle={d(xAxis)}
                                    yTitle={d(yAxis)}
                                    zTitle={d(zAxis)}
                                    axisRanges3D={axisRanges3D}
                                    mapbox={mapboxProp}
                                    onSelected={handleSelected}
                                    onDeselect={handleDeselect}
                                    on3DClick={handlePathfinder3DClick}
                                    onExportResult={notifyResult}
                                />
                            </Grid>
                        );
                    })}
                </Grid>
            )}

            <PathfinderThresholdDialog
                open={infoDialogOpen}
                onClose={() => setInfoDialogOpen(false)}
                mapMode={mapMode}
                referenceStandard={referenceStandard}
                selectedExtendedElements={selectedExtendedElements}
                getExtendedBackground={getExtendedBackground}
            />

            <PathfinderColumnMappingDialog
                open={mappingDialogOpen}
                onClose={() => setMappingDialogOpen(false)}
                numericColumns={numericColumns}
                autoDetectedColumns={autoDetectedColumns}
                autoDetectedNormColumns={autoDetectedNormColumns}
                elementColumnMapping={elementColumnMapping}
                setElementColumnMapping={setElementColumnMapping}
                scColumn={scColumn}
                setScColumn={setScColumn}
                kColumn={kColumn}
                setKColumn={setKColumn}
            />

            <PathfinderPublicationDialog
                open={publicationDialogOpen}
                onClose={() => setPublicationDialogOpen(false)}
                elements={activeElements as PathfinderElement[]}
                data={data}
                xAxis={xAxis}
                yAxis={yAxis}
                getElementColumn={getActiveElementColumn as (element: PathfinderElement) => string | null}
                mapViewStyle={mapViewStyle}
                basemapOpacity={basemapOpacity}
                transformedCoords={transformedCoords}
            />

            {/* Snackbar for QGIS sync / export feedback */}
            <Snackbar
                open={snackbar.open}
                autoHideDuration={4000}
                onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert onClose={() => setSnackbar(prev => ({ ...prev, open: false }))} severity={snackbar.severity} sx={{ width: '100%' }}>
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};
