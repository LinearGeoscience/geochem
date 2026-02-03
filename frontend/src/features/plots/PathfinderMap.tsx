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
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
    Box, Paper, FormControl, InputLabel, Select, MenuItem, Typography,
    IconButton, Collapse, Checkbox, FormControlLabel, Grid, Chip, Button,
    RadioGroup, Radio, FormLabel, Dialog, DialogTitle, DialogContent,
    DialogActions, Table, TableBody, TableCell, TableHead, TableRow,
    Tooltip, Divider, TextField, Autocomplete, CircularProgress, Slider,
    ToggleButton, ToggleButtonGroup
} from '@mui/material';
import { ExpandMore, ExpandLess, SelectAll, Clear, Info, Settings, Map as MapIcon, ZoomOutMap, PanTool, HighlightAlt, CropFree, Download, TableChart, MenuBook } from '@mui/icons-material';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import { ALL_EPSG_CODES, MapViewStyle, transformCoordinates, createMapboxLayout } from '../../utils/basemapUtils';
import { useAppStore } from '../../store/appStore';
import { useAttributeStore, EmphasisConfig } from '../../store/attributeStore';
import { applyOpacityToColor } from '../../utils/emphasisUtils';
import Plot from 'react-plotly.js';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';
import { sortColumnsByPriority } from '../../utils/attributeUtils';
import { getPlotConfig } from '../../utils/plotConfig';
import {
    PATHFINDER_ELEMENTS,
    ANOMALY_CLASSES,
    ANOMALY_COLORS,
    ANOMALY_LABELS,
    ANOMALY_THRESHOLDS,
    CRUSTAL_ABUNDANCE,
    NORMALIZATION_COLUMN_PATTERNS,
    SC_NORMALIZABLE_ELEMENTS,
    K_NORMALIZABLE_ELEMENTS,
    HOST_ROCK_DEPENDENT_ELEMENTS,
    type PathfinderElement,
    type AnomalyClass
} from '../../utils/calculations/pathfinderConstants';
import {
    getPathfinderClass,
    getPathfinderClassNormalized,
    findAllPathfinderColumns
} from '../../utils/calculations/pathfinderClassification';
import { qgisApi } from '../../services/api';
import { PathfinderPublicationDialog } from './pathfinder';

interface PathfinderMapProps {
    plotId: string;
}

type NormalizationType = 'none' | 'sc' | 'k';

// Element column mapping type
type ElementColumnMapping = Partial<Record<PathfinderElement, string>>;

// Anomaly class ranking for emphasis (0 = lowest, 1 = highest)
const ANOMALY_RANK: Record<AnomalyClass, number> = {
    'nodata': 0,
    'background': 0,
    '2x': 0.25,
    '3x': 0.5,
    '5x': 0.75,
    '10x': 1.0
};

/**
 * Calculate emphasis styling for a pathfinder anomaly class
 */
function getPathfinderEmphasis(
    anomalyClass: AnomalyClass,
    emphasisConfig: EmphasisConfig
): { opacity: number; sizeMultiplier: number } {
    if (!emphasisConfig.enabled) {
        return { opacity: 1, sizeMultiplier: 1 };
    }

    const rank = ANOMALY_RANK[anomalyClass];
    const thresholdNorm = emphasisConfig.threshold / 100;

    let opacity: number;
    if (rank >= thresholdNorm) {
        opacity = 1;
    } else {
        opacity = emphasisConfig.minOpacity +
            (1 - emphasisConfig.minOpacity) * (rank / thresholdNorm);
    }

    const sizeMultiplier = emphasisConfig.boostSize && rank >= thresholdNorm
        ? emphasisConfig.sizeBoostFactor
        : 1;

    return { opacity, sizeMultiplier };
}

type DragMode = 'zoom' | 'pan' | 'lasso' | 'select';

export const PathfinderMap: React.FC<PathfinderMapProps> = ({ plotId }) => {
    const { data, columns, getPlotSettings, updatePlotSettings, getFilteredColumns, setSelection, selectedIndices, addColumn } = useAppStore();
    const filteredColumns = getFilteredColumns();
    const { emphasis } = useAttributeStore();

    // Get stored settings or defaults
    const storedSettings = getPlotSettings(plotId);

    // State
    const [xAxis, setXAxisLocal] = useState<string>(storedSettings.xAxis || '');
    const [yAxis, setYAxisLocal] = useState<string>(storedSettings.yAxis || '');
    const [zAxis, setZAxisLocal] = useState<string>(storedSettings.zAxis || '');
    const [is3D, setIs3DLocal] = useState<boolean>(storedSettings.is3D ?? false);
    const [selectedElements, setSelectedElementsLocal] = useState<PathfinderElement[]>(
        storedSettings.selectedElements || []
    );
    const [normalization, setNormalizationLocal] = useState<NormalizationType>(
        storedSettings.normalization || 'none'
    );
    const [visibleClasses, setVisibleClassesLocal] = useState<AnomalyClass[]>(
        storedSettings.visibleClasses || ['background', '2x', '3x', '5x', '10x']
    );
    const [controlsExpanded, setControlsExpandedLocal] = useState(storedSettings.controlsExpanded ?? true);
    const [showProbabilityPlots, setShowProbabilityPlotsLocal] = useState(storedSettings.showProbabilityPlots ?? true);

    // Column mapping state
    const [elementColumnMapping, setElementColumnMappingLocal] = useState<ElementColumnMapping>(
        storedSettings.elementColumnMapping || {}
    );
    const [scColumn, setScColumnLocal] = useState<string>(storedSettings.scColumn || '');
    const [kColumn, setKColumnLocal] = useState<string>(storedSettings.kColumn || '');

    // Dialog states
    const [infoDialogOpen, setInfoDialogOpen] = useState(false);
    const [mappingDialogOpen, setMappingDialogOpen] = useState(false);
    const [publicationDialogOpen, setPublicationDialogOpen] = useState(false);

    // Basemap state (2D only)
    const getInitialMapView = (): MapViewStyle => {
        if (storedSettings.mapViewStyle) return storedSettings.mapViewStyle;
        return 'normal';
    };
    const [mapViewStyle, setMapViewStyleLocal] = useState<MapViewStyle>(getInitialMapView());
    const [epsgCode, setEpsgCodeLocal] = useState<string>(storedSettings.epsgCode ?? '');
    const [projectionError, setProjectionError] = useState<string | null>(null);
    const [isTransforming, setIsTransforming] = useState(false);
    const [transformedCoords, setTransformedCoords] = useState<{ lats: number[]; lons: number[]; center: { lat: number; lon: number }; zoom: number } | null>(null);
    const [basemapOpacity, setBasemapOpacityLocal] = useState<number>(storedSettings.basemapOpacity ?? 0.7);
    const [dragMode, setDragModeLocal] = useState<DragMode>(storedSettings.dragMode ?? 'zoom');
    const [plotRevision, setPlotRevision] = useState(0);
    const [basePointSize, setBasePointSizeLocal] = useState<number>(storedSettings.basePointSize ?? 6);

    const basemapEnabled = mapViewStyle !== 'normal' && !is3D;

    // QGIS sync state
    const [qgisLoading, setQgisLoading] = useState(false);
    const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({
        open: false,
        message: '',
        severity: 'success'
    });

    // Wrapper functions to persist settings
    const setXAxis = (axis: string) => {
        setXAxisLocal(axis);
        updatePlotSettings(plotId, { xAxis: axis });
    };
    const setYAxis = (axis: string) => {
        setYAxisLocal(axis);
        updatePlotSettings(plotId, { yAxis: axis });
    };
    const setZAxis = (axis: string) => {
        setZAxisLocal(axis);
        updatePlotSettings(plotId, { zAxis: axis });
    };
    const setIs3D = (mode: boolean) => {
        setIs3DLocal(mode);
        updatePlotSettings(plotId, { is3D: mode });
    };
    const setSelectedElements = (elements: PathfinderElement[]) => {
        setSelectedElementsLocal(elements);
        updatePlotSettings(plotId, { selectedElements: elements });
    };
    const setNormalization = (norm: NormalizationType) => {
        setNormalizationLocal(norm);
        updatePlotSettings(plotId, { normalization: norm });
    };
    const setVisibleClasses = (classes: AnomalyClass[]) => {
        setVisibleClassesLocal(classes);
        updatePlotSettings(plotId, { visibleClasses: classes });
    };
    const setControlsExpanded = (expanded: boolean) => {
        setControlsExpandedLocal(expanded);
        updatePlotSettings(plotId, { controlsExpanded: expanded });
    };
    const setShowProbabilityPlots = (show: boolean) => {
        setShowProbabilityPlotsLocal(show);
        updatePlotSettings(plotId, { showProbabilityPlots: show });
    };
    const setElementColumnMapping = (mapping: ElementColumnMapping) => {
        setElementColumnMappingLocal(mapping);
        updatePlotSettings(plotId, { elementColumnMapping: mapping });
    };
    const setScColumn = (col: string) => {
        setScColumnLocal(col);
        updatePlotSettings(plotId, { scColumn: col });
    };
    const setKColumn = (col: string) => {
        setKColumnLocal(col);
        updatePlotSettings(plotId, { kColumn: col });
    };

    // Basemap setting wrappers
    const setMapViewStyle = (style: MapViewStyle) => {
        setMapViewStyleLocal(style);
        updatePlotSettings(plotId, { mapViewStyle: style });
        if (style === 'normal') {
            setTransformedCoords(null);
        }
    };
    const setEpsgCode = (code: string) => {
        setEpsgCodeLocal(code);
        updatePlotSettings(plotId, { epsgCode: code });
        setProjectionError(null);
        setTransformedCoords(null);
    };
    const setBasemapOpacity = (opacity: number) => {
        setBasemapOpacityLocal(opacity);
        updatePlotSettings(plotId, { basemapOpacity: opacity });
    };
    const setDragMode = (mode: DragMode) => {
        setDragModeLocal(mode);
        updatePlotSettings(plotId, { dragMode: mode });
    };
    const setBasePointSize = (size: number) => {
        setBasePointSizeLocal(size);
        updatePlotSettings(plotId, { basePointSize: size });
    };

    // Zoom to data - reset all plots to autorange
    const handleZoomToData = () => {
        setPlotRevision(prev => prev + 1);
    };

    // Auto-zoom to data on initial load
    useEffect(() => {
        // Trigger initial zoom when data and axes are set
        if (data.length > 0 && xAxis && yAxis && selectedElements.length > 0) {
            // Use a small delay to ensure plots are rendered first
            const timer = setTimeout(() => {
                setPlotRevision(prev => prev + 1);
            }, 100);
            return () => clearTimeout(timer);
        }
    }, []);

    // Handle lasso/box selection from Plotly
    const handlePlotSelected = (eventData: any, _element: PathfinderElement) => {
        if (!eventData || !eventData.points || eventData.points.length === 0) {
            return;
        }

        // Get the original data indices from customdata
        const selectedDataIndices: number[] = [];
        eventData.points.forEach((point: any) => {
            if (point.customdata && typeof point.customdata.index === 'number') {
                selectedDataIndices.push(point.customdata.index);
            }
        });

        if (selectedDataIndices.length > 0) {
            // Merge with existing selection if Shift key is held (append mode)
            setSelection(selectedDataIndices);
        }
    };

    // Auto-detect pathfinder element columns
    const autoDetectedColumns = useMemo(() => {
        const colNames = filteredColumns.map(c => c.name);
        return findAllPathfinderColumns(colNames);
    }, [filteredColumns]);

    // Auto-detect normalization columns
    const autoDetectedNormColumns = useMemo(() => {
        const result: { sc: string | null; k: string | null } = { sc: null, k: null };
        for (const col of filteredColumns) {
            for (const pattern of NORMALIZATION_COLUMN_PATTERNS.Sc) {
                if (pattern.test(col.name)) {
                    result.sc = col.name;
                    break;
                }
            }
            for (const pattern of NORMALIZATION_COLUMN_PATTERNS.K) {
                if (pattern.test(col.name)) {
                    result.k = col.name;
                    break;
                }
            }
        }
        return result;
    }, [filteredColumns]);

    // Effective column mapping (user override or auto-detected)
    const getElementColumn = (element: PathfinderElement): string | null => {
        return elementColumnMapping[element] || autoDetectedColumns.get(element) || null;
    };

    // Effective normalization columns
    const effectiveScColumn = scColumn || autoDetectedNormColumns.sc || '';
    const effectiveKColumn = kColumn || autoDetectedNormColumns.k || '';

    // Available elements (those with mapped columns)
    const availableElements = useMemo(() => {
        return PATHFINDER_ELEMENTS.filter(el => getElementColumn(el) !== null);
    }, [elementColumnMapping, autoDetectedColumns]);

    // Auto-select coordinate columns on load
    useEffect(() => {
        if (columns.length > 0 && !xAxis && !yAxis && !storedSettings.xAxis && !storedSettings.yAxis) {
            const exactX = columns.find(c => c.name === 'X');
            const exactY = columns.find(c => c.name === 'Y');
            const exactZ = columns.find(c => c.name === 'Z');
            const east = exactX || columns.find(c => c.role === 'East');
            const north = exactY || columns.find(c => c.role === 'North');
            const elevation = exactZ || columns.find(c => c.role === 'Elevation');
            if (east) setXAxis(east.name);
            if (north) setYAxis(north.name);
            if (elevation) setZAxis(elevation.name);
        }
    }, [columns, storedSettings]);

    // Auto-select available elements if none selected
    useEffect(() => {
        if (availableElements.length > 0 && selectedElements.length === 0 && !storedSettings.selectedElements) {
            setSelectedElements(availableElements.slice(0, 8));
        }
    }, [availableElements, storedSettings]);

    // Transform coordinates when basemap is enabled (2D mode only)
    useEffect(() => {
        if (!basemapEnabled || !epsgCode || !data.length || !xAxis || !yAxis) {
            setTransformedCoords(null);
            return;
        }

        const transform = async () => {
            setIsTransforming(true);
            setProjectionError(null);

            try {
                const xCoords = data.map(row => row[xAxis]);
                const yCoords = data.map(row => row[yAxis]);
                const result = await transformCoordinates(xCoords, yCoords, epsgCode);
                setTransformedCoords(result);
                console.log(`[PathfinderMap] Transformed ${result.lats.length} coordinates using ${epsgCode}`);
            } catch (err: any) {
                console.error('[PathfinderMap] Coordinate transformation failed:', err);
                setProjectionError(err.message || 'Failed to transform coordinates');
                setTransformedCoords(null);
            } finally {
                setIsTransforming(false);
            }
        };

        transform();
    }, [basemapEnabled, epsgCode, data, xAxis, yAxis]);

    const numericColumns = sortColumnsByPriority(
        filteredColumns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))
    );

    // Toggle element selection
    const toggleElement = (element: PathfinderElement) => {
        if (selectedElements.includes(element)) {
            setSelectedElements(selectedElements.filter(e => e !== element));
        } else {
            setSelectedElements([...selectedElements, element]);
        }
    };

    // Toggle class visibility
    const toggleClass = (cls: AnomalyClass) => {
        if (visibleClasses.includes(cls)) {
            setVisibleClasses(visibleClasses.filter(c => c !== cls));
        } else {
            setVisibleClasses([...visibleClasses, cls]);
        }
    };

    // Update element column mapping
    const updateElementColumn = (element: PathfinderElement, column: string) => {
        const newMapping = { ...elementColumnMapping };
        if (column === '') {
            delete newMapping[element];
        } else {
            newMapping[element] = column;
        }
        setElementColumnMapping(newMapping);
    };

    // Determine if we should use WebGL (scattergl) or regular scatter
    // Browsers typically limit WebGL contexts to ~16
    // With probability plots, each element uses 2 contexts in 2D mode
    const maxWebGLContexts = 16;
    const contextsPerElement = showProbabilityPlots ? 2 : 1;
    const useWebGL = selectedElements.length * contextsPerElement <= maxWebGLContexts;
    const scatterType = useWebGL ? 'scattergl' : 'scatter';

    // Get plot data for a single element
    const getPlotDataForElement = (element: PathfinderElement) => {
        const elementColumn = getElementColumn(element);
        if (!elementColumn || !data.length || !xAxis || !yAxis) {
            return { traces: [], validCount: 0, totalCount: data.length };
        }

        // Group points by anomaly class
        const pointsByClass: Record<AnomalyClass, {
            x: number[]; y: number[]; z: number[]; indices: number[];
        }> = {
            nodata: { x: [], y: [], z: [], indices: [] },
            background: { x: [], y: [], z: [], indices: [] },
            '2x': { x: [], y: [], z: [], indices: [] },
            '3x': { x: [], y: [], z: [], indices: [] },
            '5x': { x: [], y: [], z: [], indices: [] },
            '10x': { x: [], y: [], z: [], indices: [] }
        };

        let validCount = 0;

        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            const x = row[xAxis];
            const y = row[yAxis];
            const z = is3D && zAxis ? row[zAxis] : 0;

            if (x == null || y == null || isNaN(x) || isNaN(y)) continue;
            if (is3D && zAxis && (z == null || isNaN(z))) continue;

            const elementValue = row[elementColumn];

            let anomalyClass: AnomalyClass;
            if (normalization === 'sc' && SC_NORMALIZABLE_ELEMENTS.includes(element) && effectiveScColumn) {
                const scValue = row[effectiveScColumn];
                anomalyClass = getPathfinderClassNormalized(element, elementValue, scValue);
            } else if (normalization === 'k' && K_NORMALIZABLE_ELEMENTS.includes(element) && effectiveKColumn) {
                const kValue = row[effectiveKColumn];
                anomalyClass = getPathfinderClassNormalized(element, elementValue, kValue);
            } else {
                anomalyClass = getPathfinderClass(element, elementValue);
            }

            if (anomalyClass !== 'nodata' && !visibleClasses.includes(anomalyClass)) continue;
            if (anomalyClass === 'nodata') continue;

            pointsByClass[anomalyClass].x.push(x);
            pointsByClass[anomalyClass].y.push(y);
            pointsByClass[anomalyClass].z.push(z);
            pointsByClass[anomalyClass].indices.push(i);
            validCount++;
        }

        const traces: any[] = [];
        const classOrder = ['background', '2x', '3x', '5x', '10x'] as const;

        // Determine trace type based on mode
        const useMapbox = basemapEnabled && transformedCoords && !projectionError && !isTransforming;
        const traceType = is3D ? 'scatter3d' : (useMapbox ? 'scattermapbox' : scatterType);

        for (const cls of classOrder) {
            const points = pointsByClass[cls];
            if (points.x.length === 0) continue;

            // For mapbox mode, convert indices to lat/lon
            let traceCoords: any = {};
            if (useMapbox && transformedCoords) {
                const lats = points.indices.map(i => transformedCoords.lats[i]);
                const lons = points.indices.map(i => transformedCoords.lons[i]);
                traceCoords = { lat: lats, lon: lons };
            } else if (is3D) {
                traceCoords = { x: points.x, y: points.y, z: points.z };
            } else {
                traceCoords = { x: points.x, y: points.y };
            }

            const trace: any = {
                type: traceType,
                mode: 'markers',
                name: ANOMALY_LABELS[cls],
                ...traceCoords,
                hovertemplate: is3D
                    ? `${element}: %{customdata.value}<br>X: %{x}<br>Y: %{y}<br>Z: %{z}<extra>${ANOMALY_LABELS[cls]}</extra>`
                    : useMapbox
                        ? `${element}: %{customdata.value}<br>Lat: %{lat:.6f}<br>Lon: %{lon:.6f}<extra>${ANOMALY_LABELS[cls]}</extra>`
                        : `${element}: %{customdata.value}<br>X: %{x}<br>Y: %{y}<extra>${ANOMALY_LABELS[cls]}</extra>`,
                customdata: points.indices.map(i => {
                    const val = data[i][elementColumn];
                    return { index: i, value: (typeof val === 'number' && !isNaN(val)) ? val.toFixed(3) : 'N/A' };
                }),
                marker: (() => {
                    // Apply emphasis styling based on anomaly class
                    const { opacity, sizeMultiplier } = getPathfinderEmphasis(cls, emphasis);
                    const effectiveBaseSize = is3D ? Math.max(2, basePointSize - 2) : basePointSize;
                    return {
                        size: effectiveBaseSize * sizeMultiplier,
                        color: applyOpacityToColor(ANOMALY_COLORS[cls], opacity),
                        line: { width: 0 }
                    };
                })(),
                showlegend: false
            };
            traces.push(trace);
        }

        return { traces, validCount, totalCount: data.length };
    };

    // Get probability plot data for an element
    const getProbabilityPlotData = (element: PathfinderElement) => {
        const elementColumn = getElementColumn(element);
        if (!elementColumn || !data.length) {
            return { trace: null, thresholdLines: [] };
        }

        // Get all valid values and sort
        const values: number[] = [];
        for (const row of data) {
            const val = row[elementColumn];
            if (val != null && !isNaN(val) && val > 0) {
                values.push(val);
            }
        }

        if (values.length === 0) return { trace: null, thresholdLines: [] };

        values.sort((a, b) => a - b);

        // Calculate plotting positions (Hazen formula)
        const n = values.length;
        const probabilities = values.map((_, i) => ((i + 0.5) / n) * 100);

        // Color each point by anomaly class
        const colors = values.map(val => {
            const cls = getPathfinderClass(element, val);
            return ANOMALY_COLORS[cls];
        });

        // Use regular scatter (not scattergl) to avoid WebGL context limits
        const trace: any = {
            type: 'scatter',
            mode: 'markers',
            x: values,
            y: probabilities,
            marker: {
                size: 3,
                color: colors,
                line: { width: 0 }
            },
            hovertemplate: `${element}: %{x:.3f}<br>Percentile: %{y:.1f}%<extra></extra>`,
            showlegend: false
        };

        // Threshold lines
        const thresholds = ANOMALY_THRESHOLDS[element];
        const thresholdLines = [
            { value: thresholds.background, color: ANOMALY_COLORS['2x'], label: '2x' },
            { value: thresholds.x2, color: ANOMALY_COLORS['3x'], label: '3x' },
            { value: thresholds.x3, color: ANOMALY_COLORS['5x'], label: '5x' },
            { value: thresholds.x5, color: ANOMALY_COLORS['10x'], label: '10x' }
        ];

        return { trace, thresholdLines, minVal: values[0], maxVal: values[values.length - 1] };
    };

    // Calculate grid columns based on number of selected elements
    const getGridCols = () => {
        const count = selectedElements.length;
        if (count <= 1) return 12;
        if (count <= 2) return 6;
        if (count <= 4) return 6;
        if (count <= 6) return 4;
        return 3;
    };

    // Write pathfinder values (multiples of background) to the data table
    const handleWritePathfinderValues = useCallback(() => {
        if (selectedElements.length === 0) {
            setSnackbar({ open: true, message: 'No pathfinder elements selected', severity: 'error' });
            return;
        }

        let columnsAdded = 0;

        for (const element of selectedElements) {
            const elementColumn = getElementColumn(element);
            if (!elementColumn) continue;

            const thresholds = ANOMALY_THRESHOLDS[element];
            const backgroundValue = thresholds.background;

            // Create column name: Element_PF(backgroundValue)
            const newColumnName = `${element}_PF(${backgroundValue})`;

            // Check if column already exists
            if (columns.some(c => c.name === newColumnName)) {
                continue; // Skip if already exists
            }

            // Calculate values: element_value / background_threshold
            const values = data.map(row => {
                const val = row[elementColumn];
                if (val == null || isNaN(val) || val <= 0) {
                    return null;
                }
                // Return the multiple of background (e.g., 8 means 8x background)
                return val / backgroundValue;
            });

            // Add the column
            addColumn(newColumnName, values, 'numeric', 'Pathfinder', 'pathfinder' as any);
            columnsAdded++;
        }

        if (columnsAdded > 0) {
            setSnackbar({
                open: true,
                message: `Added ${columnsAdded} pathfinder columns (value ÷ background threshold)`,
                severity: 'success'
            });
        } else {
            setSnackbar({
                open: true,
                message: 'No new columns added (columns may already exist)',
                severity: 'info'
            });
        }
    }, [selectedElements, data, columns, addColumn, getElementColumn]);

    // Export element card (map + probability plot) as PNG
    const handleExportElementCard = useCallback(async (element: PathfinderElement, cardRef: HTMLDivElement | null) => {
        if (!cardRef) return;

        try {
            // Dynamic import html-to-image
            const { toPng } = await import('html-to-image');

            const dataUrl = await toPng(cardRef, {
                backgroundColor: '#ffffff',
                pixelRatio: 2, // Higher quality
                style: {
                    transform: 'scale(1)',
                    transformOrigin: 'top left',
                }
            });

            // Download the image
            const link = document.createElement('a');
            link.download = `pathfinder_${element}_${new Date().toISOString().slice(0, 10)}.png`;
            link.href = dataUrl;
            link.click();

            setSnackbar({ open: true, message: `Exported ${element} plot`, severity: 'success' });
        } catch (err) {
            console.error('Export failed:', err);
            setSnackbar({ open: true, message: 'Export failed. Try using the Plotly toolbar instead.', severity: 'error' });
        }
    }, []);

    // Refs for element cards
    const elementCardRefs = useRef<Map<PathfinderElement, HTMLDivElement | null>>(new Map());

    // Load pathfinders to QGIS
    const handleLoadToQgis = async () => {
        if (selectedElements.length === 0) {
            setSnackbar({ open: true, message: 'No pathfinder elements selected', severity: 'error' });
            return;
        }

        if (!data || data.length === 0) {
            setSnackbar({ open: true, message: 'No data loaded', severity: 'error' });
            return;
        }

        setQgisLoading(true);
        try {
            // First sync the data to the backend so QGIS can fetch it
            await qgisApi.syncData(data, columns);

            // Then send the pathfinder configuration
            const config = {
                elements: selectedElements,
                xField: xAxis,
                yField: yAxis,
                zField: is3D ? zAxis : undefined,
                normalization,
                scColumn: scColumn || undefined,
                kColumn: kColumn || undefined,
                elementColumnMapping: elementColumnMapping as Record<string, string>
            };
            const result = await qgisApi.syncPathfinders(config);
            setSnackbar({
                open: true,
                message: `Sent ${result.elements} pathfinder elements to QGIS`,
                severity: 'success'
            });
        } catch (error) {
            setSnackbar({
                open: true,
                message: 'Failed to sync pathfinders to QGIS. Is the backend running?',
                severity: 'error'
            });
        } finally {
            setQgisLoading(false);
        }
    };

    return (
        <Box sx={{ p: 2 }}>
            {/* Header */}
            <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                    <Typography variant="h6">Pathfinder Map</Typography>
                    <Typography variant="caption" color="text.secondary">
                        Based on Dr. Scott Halley's pathfinder chemistry methodology
                    </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 1 }}>
                    <Tooltip title="Add pathfinder values to data table (value ÷ background)">
                        <IconButton
                            onClick={handleWritePathfinderValues}
                            size="small"
                            color="primary"
                            disabled={selectedElements.length === 0}
                        >
                            <TableChart />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Load active pathfinders to QGIS">
                        <IconButton
                            onClick={handleLoadToQgis}
                            size="small"
                            color="success"
                            disabled={qgisLoading || selectedElements.length === 0}
                        >
                            <MapIcon />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Export Publication Figure">
                        <IconButton
                            onClick={() => setPublicationDialogOpen(true)}
                            size="small"
                            color="secondary"
                            disabled={selectedElements.length === 0 || !xAxis || !yAxis}
                        >
                            <MenuBook />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="View Crustal Abundance Thresholds">
                        <IconButton onClick={() => setInfoDialogOpen(true)} size="small" color="info">
                            <Info />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Configure Column Mappings">
                        <IconButton onClick={() => setMappingDialogOpen(true)} size="small" color="primary">
                            <Settings />
                        </IconButton>
                    </Tooltip>
                    <IconButton onClick={() => setControlsExpanded(!controlsExpanded)} size="small">
                        {controlsExpanded ? <ExpandLess /> : <ExpandMore />}
                    </IconButton>
                </Box>
            </Box>

            {/* Controls */}
            <Collapse in={controlsExpanded}>
                <Paper sx={{ p: 2, mb: 2 }}>
                    {/* Coordinate Selection */}
                    <Box sx={{ mb: 2, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                        <FormControl sx={{ minWidth: 140 }} size="small">
                            <InputLabel>X-Axis</InputLabel>
                            <Select value={xAxis} onChange={(e) => setXAxis(e.target.value)} label="X-Axis">
                                {numericColumns.map(col => (
                                    <MenuItem key={col.name} value={col.name}>{col.alias || col.name}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <FormControl sx={{ minWidth: 140 }} size="small">
                            <InputLabel>Y-Axis</InputLabel>
                            <Select value={yAxis} onChange={(e) => setYAxis(e.target.value)} label="Y-Axis">
                                {numericColumns.map(col => (
                                    <MenuItem key={col.name} value={col.name}>{col.alias || col.name}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        {is3D && (
                            <FormControl sx={{ minWidth: 140 }} size="small">
                                <InputLabel>Z-Axis</InputLabel>
                                <Select value={zAxis} onChange={(e) => setZAxis(e.target.value)} label="Z-Axis">
                                    {numericColumns.map(col => (
                                        <MenuItem key={col.name} value={col.name}>{col.alias || col.name}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        )}
                        <FormControlLabel
                            control={<Checkbox checked={is3D} onChange={(e) => setIs3D(e.target.checked)} />}
                            label="3D Mode"
                        />
                        <FormControlLabel
                            control={<Checkbox checked={showProbabilityPlots} onChange={(e) => setShowProbabilityPlots(e.target.checked)} />}
                            label="Show Probability Plots"
                        />
                    </Box>

                    {/* Interaction Tools and Display Options */}
                    <Box sx={{ mb: 2, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                        {!is3D && (
                            <>
                                <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>Tools:</Typography>
                                <ToggleButtonGroup
                                    value={dragMode}
                                    exclusive
                                    onChange={(_, newMode) => newMode && setDragMode(newMode)}
                                    size="small"
                                >
                                    <ToggleButton value="zoom">
                                        <Tooltip title="Box Zoom">
                                            <CropFree fontSize="small" />
                                        </Tooltip>
                                    </ToggleButton>
                                    <ToggleButton value="pan">
                                        <Tooltip title="Pan">
                                            <PanTool fontSize="small" />
                                        </Tooltip>
                                    </ToggleButton>
                                    <ToggleButton value="lasso">
                                        <Tooltip title="Lasso Select">
                                            <HighlightAlt fontSize="small" />
                                        </Tooltip>
                                    </ToggleButton>
                                    <ToggleButton value="select">
                                        <Tooltip title="Box Select">
                                            <SelectAll fontSize="small" />
                                        </Tooltip>
                                    </ToggleButton>
                                </ToggleButtonGroup>
                            </>
                        )}
                        <Tooltip title="Zoom to All Data (Reset View)">
                            <Button
                                size="small"
                                variant="outlined"
                                onClick={handleZoomToData}
                                startIcon={<ZoomOutMap fontSize="small" />}
                            >
                                Zoom to Data
                            </Button>
                        </Tooltip>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 180 }}>
                            <Typography variant="caption" sx={{ whiteSpace: 'nowrap' }}>Point Size:</Typography>
                            <Slider
                                value={basePointSize}
                                onChange={(_, v) => setBasePointSize(v as number)}
                                min={2}
                                max={16}
                                step={1}
                                size="small"
                                valueLabelDisplay="auto"
                                sx={{ width: 100 }}
                            />
                        </Box>
                        {!is3D && selectedIndices.length > 0 && (
                            <Chip
                                label={`${selectedIndices.length} selected`}
                                size="small"
                                onDelete={() => setSelection([])}
                                color="primary"
                                variant="outlined"
                            />
                        )}
                    </Box>

                    {/* Map View Controls (2D only) */}
                    {!is3D && (
                        <Box sx={{ mb: 2, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                            <FormControl sx={{ minWidth: 150 }} size="small">
                                <InputLabel>Map View</InputLabel>
                                <Select
                                    value={mapViewStyle}
                                    onChange={(e) => setMapViewStyle(e.target.value as MapViewStyle)}
                                    label="Map View"
                                >
                                    <MenuItem value="normal">Normal (X/Y)</MenuItem>
                                    <MenuItem value="osm">OpenStreetMap</MenuItem>
                                    <MenuItem value="satellite">Satellite</MenuItem>
                                    <MenuItem value="hybrid">Hybrid</MenuItem>
                                </Select>
                            </FormControl>
                            {basemapEnabled && (
                                <>
                                    <Autocomplete
                                        freeSolo
                                        options={ALL_EPSG_CODES}
                                        getOptionLabel={(option) => typeof option === 'string' ? option : option.label}
                                        value={ALL_EPSG_CODES.find(e => e.code === epsgCode) || (epsgCode ? { code: epsgCode, label: epsgCode, numericCode: 0 } : null)}
                                        onChange={(_event, newValue) => {
                                            if (typeof newValue === 'string') {
                                                const normalized = newValue.toUpperCase().startsWith('EPSG:') ? newValue.toUpperCase() : `EPSG:${newValue}`;
                                                setEpsgCode(normalized);
                                            } else if (newValue) {
                                                setEpsgCode(newValue.code);
                                            } else {
                                                setEpsgCode('');
                                            }
                                        }}
                                        onBlur={(event) => {
                                            const inputValue = (event.target as HTMLInputElement).value;
                                            if (inputValue && !ALL_EPSG_CODES.some(e => e.label === inputValue || e.code === inputValue)) {
                                                const normalized = inputValue.toUpperCase().startsWith('EPSG:') ? inputValue.toUpperCase() : `EPSG:${inputValue}`;
                                                setEpsgCode(normalized);
                                            }
                                        }}
                                        renderInput={(params) => (
                                            <TextField
                                                {...params}
                                                label="EPSG Code"
                                                size="small"
                                                error={!!projectionError}
                                                placeholder="Search or enter code..."
                                                sx={{ width: 350 }}
                                            />
                                        )}
                                        ListboxProps={{ style: { maxHeight: 400 } }}
                                        isOptionEqualToValue={(option, value) => option.code === value.code}
                                    />
                                    {isTransforming && <CircularProgress size={20} />}
                                    {(mapViewStyle === 'satellite' || mapViewStyle === 'hybrid') && (
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 160 }}>
                                            <Typography variant="caption" sx={{ whiteSpace: 'nowrap' }}>Opacity</Typography>
                                            <Slider
                                                value={basemapOpacity}
                                                onChange={(_, v) => setBasemapOpacity(v as number)}
                                                min={0.1}
                                                max={1}
                                                step={0.1}
                                                size="small"
                                                valueLabelDisplay="auto"
                                                valueLabelFormat={(v) => `${Math.round(v * 100)}%`}
                                                sx={{ width: 100 }}
                                            />
                                        </Box>
                                    )}
                                </>
                            )}
                        </Box>
                    )}
                    {basemapEnabled && projectionError && (
                        <Alert severity="error" sx={{ mb: 2 }}>{projectionError}</Alert>
                    )}
                    {basemapEnabled && !epsgCode && !projectionError && (
                        <Alert severity="info" sx={{ mb: 2 }}>
                            Search for an EPSG code or type any code (e.g., 3719 or EPSG:3719)
                        </Alert>
                    )}

                    {/* Element Selection */}
                    <Box sx={{ mb: 2 }}>
                        <Typography variant="subtitle2" gutterBottom>
                            Pathfinder Elements ({selectedElements.length}/{availableElements.length} selected)
                            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                                (Click ⚙ to configure column mappings)
                            </Typography>
                        </Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
                            {PATHFINDER_ELEMENTS.map(element => {
                                const isAvailable = availableElements.includes(element);
                                const isSelected = selectedElements.includes(element);
                                const mappedColumn = getElementColumn(element);
                                return (
                                    <Tooltip
                                        key={element}
                                        title={mappedColumn ? `Column: ${mappedColumn}` : 'No column mapped'}
                                    >
                                        <Chip
                                            label={element}
                                            size="small"
                                            color={isSelected ? 'primary' : 'default'}
                                            variant={isSelected ? 'filled' : 'outlined'}
                                            disabled={!isAvailable}
                                            onClick={() => isAvailable && toggleElement(element)}
                                            sx={{ opacity: isAvailable ? 1 : 0.4 }}
                                        />
                                    </Tooltip>
                                );
                            })}
                        </Box>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                            <Button size="small" startIcon={<SelectAll />} onClick={() => setSelectedElements([...availableElements])}>
                                Select All
                            </Button>
                            <Button size="small" startIcon={<Clear />} onClick={() => setSelectedElements([])}>
                                Clear
                            </Button>
                        </Box>
                    </Box>

                    {/* Normalization Options */}
                    <Box sx={{ mb: 2 }}>
                        <FormControl component="fieldset">
                            <FormLabel component="legend" sx={{ fontSize: '0.875rem' }}>
                                Normalization
                            </FormLabel>
                            <RadioGroup row value={normalization} onChange={(e) => setNormalization(e.target.value as NormalizationType)}>
                                <FormControlLabel value="none" control={<Radio size="small" />} label="None" />
                                <FormControlLabel
                                    value="sc"
                                    control={<Radio size="small" />}
                                    label={`Element/Sc (${SC_NORMALIZABLE_ELEMENTS.join(', ')})`}
                                    disabled={!effectiveScColumn}
                                />
                                <FormControlLabel
                                    value="k"
                                    control={<Radio size="small" />}
                                    label={`Element/K (${K_NORMALIZABLE_ELEMENTS.join(', ')})`}
                                    disabled={!effectiveKColumn}
                                />
                            </RadioGroup>
                        </FormControl>
                        {/* Normalization column selectors */}
                        <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
                            <FormControl sx={{ minWidth: 150 }} size="small">
                                <InputLabel>Sc Column</InputLabel>
                                <Select
                                    value={effectiveScColumn}
                                    onChange={(e) => setScColumn(e.target.value)}
                                    label="Sc Column"
                                >
                                    <MenuItem value="">
                                        <em>{autoDetectedNormColumns.sc ? `Auto: ${autoDetectedNormColumns.sc}` : 'None'}</em>
                                    </MenuItem>
                                    {numericColumns.map(col => (
                                        <MenuItem key={col.name} value={col.name}>{col.alias || col.name}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <FormControl sx={{ minWidth: 150 }} size="small">
                                <InputLabel>K Column</InputLabel>
                                <Select
                                    value={effectiveKColumn}
                                    onChange={(e) => setKColumn(e.target.value)}
                                    label="K Column"
                                >
                                    <MenuItem value="">
                                        <em>{autoDetectedNormColumns.k ? `Auto: ${autoDetectedNormColumns.k}` : 'None'}</em>
                                    </MenuItem>
                                    {numericColumns.map(col => (
                                        <MenuItem key={col.name} value={col.name}>{col.alias || col.name}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Box>
                    </Box>

                    {/* Class Visibility */}
                    <Box>
                        <Typography variant="subtitle2" gutterBottom>Show Classes</Typography>
                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                            {ANOMALY_CLASSES.map(cls => (
                                <FormControlLabel
                                    key={cls}
                                    control={
                                        <Checkbox
                                            checked={visibleClasses.includes(cls)}
                                            onChange={() => toggleClass(cls)}
                                            size="small"
                                            sx={{ color: ANOMALY_COLORS[cls], '&.Mui-checked': { color: ANOMALY_COLORS[cls] } }}
                                        />
                                    }
                                    label={
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                            <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: ANOMALY_COLORS[cls] }} />
                                            <Typography variant="body2">{ANOMALY_LABELS[cls]}</Typography>
                                        </Box>
                                    }
                                />
                            ))}
                        </Box>
                    </Box>
                </Paper>
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

            {/* Plot Grid */}
            {!xAxis || !yAxis || selectedElements.length === 0 ? (
                <Typography color="text.secondary">
                    Select X-axis, Y-axis, and at least one pathfinder element to display maps
                </Typography>
            ) : (
                <Grid container spacing={2}>
                    {selectedElements.map(element => {
                        const { traces, validCount, totalCount } = getPlotDataForElement(element);
                        const gridCols = getGridCols();
                        const elementColumn = getElementColumn(element);
                        const probData = showProbabilityPlots ? getProbabilityPlotData(element) : null;
                        const thresholds = ANOMALY_THRESHOLDS[element];

                        return (
                            <Grid item xs={12} sm={gridCols} key={element}>
                                <Paper
                                    sx={{ p: 1 }}
                                    ref={(el) => elementCardRefs.current.set(element, el)}
                                >
                                    {/* Header with export button */}
                                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: -3, mr: 0.5, position: 'relative', zIndex: 1 }}>
                                        <Tooltip title="Export plot with probability chart">
                                            <IconButton
                                                size="small"
                                                onClick={() => handleExportElementCard(element, elementCardRefs.current.get(element) || null)}
                                            >
                                                <Download fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                    </Box>
                                    {/* Map Plot */}
                                    <ExpandablePlotWrapper>
                                        <Plot
                                            data={traces}
                                            layout={{
                                                title: { text: `${element} (${elementColumn})`, font: { size: 14 }, x: 0, xanchor: 'left' },
                                                autosize: true,
                                                height: is3D ? 350 : 300,
                                                hovermode: 'closest',
                                                showlegend: false,
                                                dragmode: is3D ? 'orbit' : dragMode,
                                                uirevision: plotRevision,
                                                ...(is3D ? {
                                                    scene: {
                                                        xaxis: { title: { text: xAxis, font: { size: 10 } } },
                                                        yaxis: { title: { text: yAxis, font: { size: 10 } } },
                                                        zaxis: { title: { text: zAxis, font: { size: 10 } } },
                                                        camera: { eye: { x: 1.5, y: 1.5, z: 1.3 } }
                                                    },
                                                    margin: { l: 50, r: 20, t: 40, b: 40 }
                                                } : basemapEnabled && transformedCoords && !projectionError && !isTransforming ? {
                                                    ...createMapboxLayout(mapViewStyle, transformedCoords.center, transformedCoords.zoom, basemapOpacity),
                                                    margin: { l: 0, r: 0, t: 40, b: 0 }
                                                } : {
                                                    xaxis: { title: { text: xAxis, font: { size: 10 } }, scaleanchor: 'y', scaleratio: 1, autorange: true },
                                                    yaxis: { title: { text: yAxis, font: { size: 10 } }, autorange: true },
                                                    margin: { l: 50, r: 20, t: 40, b: 40 }
                                                })
                                            }}
                                            config={{
                                                ...getPlotConfig({ filename: `pathfinder_${element}` }),
                                                modeBarButtonsToRemove: [] // Keep lasso and select tools
                                            }}
                                            style={{ width: '100%' }}
                                            useResizeHandler={true}
                                            onSelected={(eventData) => handlePlotSelected(eventData, element)}
                                            onDeselect={() => setSelection([])}
                                        />
                                    </ExpandablePlotWrapper>

                                    {/* Probability Plot */}
                                    {showProbabilityPlots && probData?.trace && (
                                        <Box sx={{ mt: 1, borderTop: 1, borderColor: 'divider', pt: 1 }}>
                                            <Plot
                                                data={[probData.trace]}
                                                layout={{
                                                    autosize: true,
                                                    height: 150,
                                                    hovermode: 'closest',
                                                    showlegend: false,
                                                    xaxis: {
                                                        type: 'log',
                                                        title: { text: `${element} (ppm)`, font: { size: 9 } },
                                                        tickfont: { size: 8 }
                                                    },
                                                    yaxis: {
                                                        title: { text: 'Percentile', font: { size: 9 } },
                                                        tickfont: { size: 8 },
                                                        range: [0, 100]
                                                    },
                                                    margin: { l: 40, r: 10, t: 10, b: 35 },
                                                    shapes: probData.thresholdLines.map(line => ({
                                                        type: 'line',
                                                        x0: line.value,
                                                        x1: line.value,
                                                        y0: 0,
                                                        y1: 100,
                                                        line: { color: line.color, width: 1, dash: 'dash' }
                                                    })),
                                                    annotations: probData.thresholdLines.map(line => ({
                                                        x: Math.log10(line.value),
                                                        y: 95,
                                                        xref: 'x',
                                                        yref: 'y',
                                                        text: line.label,
                                                        showarrow: false,
                                                        font: { size: 8, color: line.color }
                                                    }))
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
                                            n = {validCount.toLocaleString()} / {totalCount.toLocaleString()}
                                            {' | '}
                                            Background: ≤{thresholds.background} ppm
                                            {' | '}
                                            10x: &gt;{thresholds.x5} ppm
                                        </Typography>
                                    </Box>
                                </Paper>
                            </Grid>
                        );
                    })}
                </Grid>
            )}

            {/* Info Dialog - Crustal Abundance Thresholds */}
            <Dialog open={infoDialogOpen} onClose={() => setInfoDialogOpen(false)} maxWidth="md" fullWidth>
                <DialogTitle>
                    Pathfinder Element Thresholds
                    <Typography variant="subtitle2" color="text.secondary">
                        Based on Dr. Scott Halley's pathfinder chemistry methodology
                    </Typography>
                </DialogTitle>
                <DialogContent dividers>
                    <Typography variant="body2" paragraph>
                        Points are classified as multiples of average crustal abundance.
                        A coherent footprint (multi-point anomaly) of ≥10x crustal abundance is a significant anomaly.
                    </Typography>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell><strong>Element</strong></TableCell>
                                <TableCell align="right"><strong>Crustal (ppm)</strong></TableCell>
                                <TableCell align="right" sx={{ bgcolor: ANOMALY_COLORS.background, color: 'white' }}>Background</TableCell>
                                <TableCell align="right" sx={{ bgcolor: ANOMALY_COLORS['2x'], color: 'white' }}>2x</TableCell>
                                <TableCell align="right" sx={{ bgcolor: ANOMALY_COLORS['3x'], color: 'black' }}>3x</TableCell>
                                <TableCell align="right" sx={{ bgcolor: ANOMALY_COLORS['5x'], color: 'black' }}>5x</TableCell>
                                <TableCell align="right" sx={{ bgcolor: ANOMALY_COLORS['10x'], color: 'white' }}>10x</TableCell>
                                <TableCell><strong>Notes</strong></TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {PATHFINDER_ELEMENTS.map(element => {
                                const thresh = ANOMALY_THRESHOLDS[element];
                                const isHostRockDependent = HOST_ROCK_DEPENDENT_ELEMENTS.includes(element);
                                const supportsScNorm = SC_NORMALIZABLE_ELEMENTS.includes(element);
                                const supportsKNorm = K_NORMALIZABLE_ELEMENTS.includes(element);
                                return (
                                    <TableRow key={element}>
                                        <TableCell><strong>{element}</strong></TableCell>
                                        <TableCell align="right">{CRUSTAL_ABUNDANCE[element]}</TableCell>
                                        <TableCell align="right">0-{thresh.background}</TableCell>
                                        <TableCell align="right">{thresh.background}-{thresh.x2}</TableCell>
                                        <TableCell align="right">{thresh.x2}-{thresh.x3}</TableCell>
                                        <TableCell align="right">{thresh.x3}-{thresh.x5}</TableCell>
                                        <TableCell align="right">&gt;{thresh.x5}</TableCell>
                                        <TableCell>
                                            {isHostRockDependent && <Chip label="Host-rock dependent" size="small" sx={{ mr: 0.5 }} />}
                                            {supportsScNorm && <Chip label="Sc norm" size="small" color="info" sx={{ mr: 0.5 }} />}
                                            {supportsKNorm && <Chip label="K norm" size="small" color="secondary" />}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                    <Box sx={{ mt: 2 }}>
                        <Typography variant="subtitle2" gutterBottom>Normalization Notes:</Typography>
                        <Typography variant="body2" color="text.secondary">
                            • <strong>Sc normalization:</strong> Zn, Cu, In can be normalized to Sc for variable host-rock compositions (mafic influence)<br/>
                            • <strong>K normalization:</strong> Cs, Tl can be normalized to K for variable host-rock compositions (felsic/alkali influence)<br/>
                            • <strong>Host-rock dependent:</strong> Pb, Zn, Cu, In, Li, Cs, Tl ranges vary strongly with lithology
                        </Typography>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setInfoDialogOpen(false)}>Close</Button>
                </DialogActions>
            </Dialog>

            {/* Column Mapping Dialog */}
            <Dialog open={mappingDialogOpen} onClose={() => setMappingDialogOpen(false)} maxWidth="md" fullWidth>
                <DialogTitle>Configure Element Column Mappings</DialogTitle>
                <DialogContent dividers>
                    <Typography variant="body2" color="text.secondary" paragraph>
                        Select which data column corresponds to each pathfinder element.
                        Auto-detected columns are shown in italics - select a different column to override.
                    </Typography>
                    <Grid container spacing={2}>
                        {PATHFINDER_ELEMENTS.map(element => {
                            const autoDetected = autoDetectedColumns.get(element);
                            const currentValue = elementColumnMapping[element] || '';
                            return (
                                <Grid item xs={6} sm={4} md={3} key={element}>
                                    <FormControl fullWidth size="small">
                                        <InputLabel>{element}</InputLabel>
                                        <Select
                                            value={currentValue}
                                            onChange={(e) => updateElementColumn(element, e.target.value)}
                                            label={element}
                                        >
                                            <MenuItem value="">
                                                <em>{autoDetected ? `Auto: ${autoDetected}` : 'Not mapped'}</em>
                                            </MenuItem>
                                            {numericColumns.map(col => (
                                                <MenuItem key={col.name} value={col.name}>
                                                    {col.alias || col.name}
                                                </MenuItem>
                                            ))}
                                        </Select>
                                    </FormControl>
                                </Grid>
                            );
                        })}
                    </Grid>
                    <Divider sx={{ my: 2 }} />
                    <Typography variant="subtitle2" gutterBottom>Normalization Columns</Typography>
                    <Grid container spacing={2}>
                        <Grid item xs={6}>
                            <FormControl fullWidth size="small">
                                <InputLabel>Scandium (Sc)</InputLabel>
                                <Select
                                    value={scColumn}
                                    onChange={(e) => setScColumn(e.target.value)}
                                    label="Scandium (Sc)"
                                >
                                    <MenuItem value="">
                                        <em>{autoDetectedNormColumns.sc ? `Auto: ${autoDetectedNormColumns.sc}` : 'Not mapped'}</em>
                                    </MenuItem>
                                    {numericColumns.map(col => (
                                        <MenuItem key={col.name} value={col.name}>{col.alias || col.name}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid item xs={6}>
                            <FormControl fullWidth size="small">
                                <InputLabel>Potassium (K)</InputLabel>
                                <Select
                                    value={kColumn}
                                    onChange={(e) => setKColumn(e.target.value)}
                                    label="Potassium (K)"
                                >
                                    <MenuItem value="">
                                        <em>{autoDetectedNormColumns.k ? `Auto: ${autoDetectedNormColumns.k}` : 'Not mapped'}</em>
                                    </MenuItem>
                                    {numericColumns.map(col => (
                                        <MenuItem key={col.name} value={col.name}>{col.alias || col.name}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Grid>
                    </Grid>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => {
                        setElementColumnMapping({});
                        setScColumn('');
                        setKColumn('');
                    }}>
                        Reset to Auto-Detect
                    </Button>
                    <Button onClick={() => setMappingDialogOpen(false)} variant="contained">
                        Done
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Publication Export Dialog */}
            <PathfinderPublicationDialog
                open={publicationDialogOpen}
                onClose={() => setPublicationDialogOpen(false)}
                elements={selectedElements}
                data={data}
                xAxis={xAxis}
                yAxis={yAxis}
                getElementColumn={getElementColumn}
                mapViewStyle={mapViewStyle}
                basemapOpacity={basemapOpacity}
                transformedCoords={transformedCoords}
            />

            {/* Snackbar for QGIS sync feedback */}
            <Snackbar
                open={snackbar.open}
                autoHideDuration={4000}
                onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert
                    onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
                    severity={snackbar.severity}
                    sx={{ width: '100%' }}
                >
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};
