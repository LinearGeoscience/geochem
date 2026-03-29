/**
 * ContourMap Component
 *
 * Visualizes the spatial distribution of geochemical element anomalies as contour lines.
 * For each selected element, computes enrichment factor (value / background) at sample locations,
 * then interpolates onto a regular grid using IDW and renders as Plotly contour traces.
 * Multiple elements overlay on the same map with distinct colors, revealing how element
 * halos relate in space — a core exploration geochemistry workflow.
 */

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
    Box, Paper, FormControl, InputLabel, Select, MenuItem, Typography,
    IconButton, Collapse, Checkbox, FormControlLabel, Slider, Chip,
    Divider, TextField, Tooltip, Button
} from '@mui/material';
import { ExpandMore, ExpandLess, SelectAll, Clear } from '@mui/icons-material';
import { useAppStore } from '../../store/appStore';
import { useShallow } from 'zustand/react/shallow';
import Plot from 'react-plotly.js';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';
import { sortColumnsByPriority, getColumnDisplayName } from '../../utils/attributeUtils';
import { getPlotConfig } from '../../utils/plotConfig';
import {
    EXTENDED_ELEMENT_CATEGORIES,
    BACKGROUND_STANDARDS,
    getBackgroundValue,
    type ReferenceStandardId,
} from '../../utils/calculations/elementBackgroundConstants';
import {
    findElementColumn,
} from '../../utils/calculations/elementAnomalyClassification';
import { useIDWWorker } from '../../hooks/useIDWWorker';
import type { IDWPoint, IDWGridResult } from '../../utils/idwInterpolation';

// ─── Default element colors (distinct, colorblind-friendly) ──────────────────

const DEFAULT_ELEMENT_COLORS: Record<string, string> = {
    Cu: '#e41a1c', Au: '#ff7f00', As: '#4daf4a', Sb: '#377eb8',
    Mo: '#984ea3', W: '#a65628', Ag: '#999999', Pb: '#f781bf',
    Zn: '#66c2a5', Bi: '#fc8d62', Te: '#8da0cb', Sn: '#e78ac3',
    Cd: '#a6d854', Li: '#ffd92f', Cs: '#e5c494', Tl: '#b3b3b3',
    Fe2O3T: '#8b0000', MgO: '#006400', CaO: '#4169e1', Na2O: '#daa520',
    K2O: '#9400d3', SiO2: '#2f4f4f', TiO2: '#dc143c', Al2O3: '#00ced1',
    MnO: '#ff4500', P2O5: '#32cd32', Cr: '#b22222', Ni: '#228b22',
    Co: '#6a5acd', V: '#ff6347', Sc: '#20b2aa', Ba: '#db7093',
    Sr: '#3cb371', Rb: '#cd853f', Y: '#4682b4', Zr: '#9acd32',
    Nb: '#d2691e', Hf: '#00bfff', Ta: '#ff69b4', Th: '#8fbc8f',
    U: '#dda0dd', La: '#bc8f8f', Ce: '#5f9ea0', Nd: '#f4a460',
    Ga: '#7b68ee', Ge: '#48d1cc', Se: '#c71585', Be: '#66cdaa', B: '#bdb76b',
};

const FALLBACK_COLORS = [
    '#1b9e77', '#d95f02', '#7570b3', '#e7298a', '#66a61e', '#e6ab02',
    '#a6761d', '#666666', '#e41a1c', '#377eb8', '#4daf4a', '#984ea3',
];

function getElementColor(element: string, index: number): string {
    return DEFAULT_ELEMENT_COLORS[element] || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const h = hex.replace('#', '');
    return {
        r: parseInt(h.substring(0, 2), 16) || 0,
        g: parseInt(h.substring(2, 4), 16) || 0,
        b: parseInt(h.substring(4, 6), 16) || 0,
    };
}

// ─── Contour levels ──────────────────────────────────────────────────────────

const ALL_CONTOUR_LEVELS = [1, 2, 3, 5, 10] as const;

// ─── Component ───────────────────────────────────────────────────────────────

interface ContourMapProps {
    plotId: string;
}

interface ElementGridData {
    element: string;
    columnName: string;
    backgroundValue: number;
    grid: IDWGridResult;
}

export const ContourMap: React.FC<ContourMapProps> = ({ plotId }) => {
    const { data, columns, sampleIndices, geochemMappings } = useAppStore(useShallow(s => ({
        data: s.data, columns: s.columns, sampleIndices: s.sampleIndices, geochemMappings: s.geochemMappings
    })));
    const getPlotSettings = useAppStore(s => s.getPlotSettings);
    const updatePlotSettings = useAppStore(s => s.updatePlotSettings);
    const getFilteredColumns = useAppStore(s => s.getFilteredColumns);
    const getDisplayData = useAppStore(s => s.getDisplayData);
    const filteredColumns = getFilteredColumns();
    const d = (name: string) => getColumnDisplayName(columns, name);

    const displayData = useMemo(() => getDisplayData(), [data, sampleIndices]);

    const { computeIDW } = useIDWWorker();

    // Stored settings
    const storedSettings = getPlotSettings(plotId);

    // ─── State ───────────────────────────────────────────────────────────────
    const [xAxis, setXAxisLocal] = useState<string>(storedSettings.xAxis || '');
    const [yAxis, setYAxisLocal] = useState<string>(storedSettings.yAxis || '');
    // selectedElements stores element SYMBOLS (e.g. 'Cu', 'As'), not column names
    const [selectedElements, setSelectedElementsLocal] = useState<string[]>(
        storedSettings.selectedElements || []
    );
    const [referenceStandard, setReferenceStandardLocal] = useState<ReferenceStandardId>(
        storedSettings.referenceStandard || 'ucc-rudnick-gao-2003'
    );
    const [customBackgrounds, setCustomBackgroundsLocal] = useState<Record<string, number>>(
        storedSettings.customBackgrounds || {}
    );
    const [contourLevels, setContourLevelsLocal] = useState<number[]>(
        storedSettings.contourLevels || [1, 2, 3, 5, 10]
    );
    const [gridResolution, setGridResolutionLocal] = useState<number>(
        storedSettings.gridResolution ?? 150
    );
    const [idwPower, setIdwPowerLocal] = useState<number>(
        storedSettings.idwPower ?? 1.5
    );
    const [smoothing, setSmoothingLocal] = useState<number>(
        storedSettings.smoothing ?? 4.0
    );
    const [showSamplePoints, setShowSamplePointsLocal] = useState<boolean>(
        storedSettings.showSamplePoints ?? true
    );
    const elementColors: Record<string, string> = storedSettings.elementColors || {};
    const [lineWidth, setLineWidthLocal] = useState<number>(
        storedSettings.lineWidth ?? 2
    );
    const [showLabels, setShowLabelsLocal] = useState<boolean>(
        storedSettings.showLabels ?? true
    );
    const [opacity, setOpacityLocal] = useState<number>(
        storedSettings.opacity ?? 1.0
    );
    const [controlsExpanded, setControlsExpandedLocal] = useState(
        storedSettings.controlsExpanded ?? true
    );
    const [hiddenElements, setHiddenElementsLocal] = useState<string[]>(
        storedSettings.hiddenElements || []
    );
    const [filledContours, setFilledContoursLocal] = useState<boolean>(
        storedSettings.filledContours ?? true
    );

    // Grid computation results
    const [elementGrids, setElementGrids] = useState<ElementGridData[]>([]);
    const [computing, setComputing] = useState(false);
    const computeGeneration = useRef(0);

    // ─── Setters with persistence ────────────────────────────────────────────
    const setXAxis = (v: string) => { setXAxisLocal(v); updatePlotSettings(plotId, { xAxis: v }); };
    const setYAxis = (v: string) => { setYAxisLocal(v); updatePlotSettings(plotId, { yAxis: v }); };
    const setSelectedElements = (v: string[]) => { setSelectedElementsLocal(v); updatePlotSettings(plotId, { selectedElements: v }); };
    const setReferenceStandard = (v: ReferenceStandardId) => { setReferenceStandardLocal(v); updatePlotSettings(plotId, { referenceStandard: v }); };
    const setCustomBackgrounds = (v: Record<string, number>) => { setCustomBackgroundsLocal(v); updatePlotSettings(plotId, { customBackgrounds: v }); };
    const setContourLevels = (v: number[]) => { setContourLevelsLocal(v); updatePlotSettings(plotId, { contourLevels: v }); };
    const setGridResolution = (v: number) => { setGridResolutionLocal(v); updatePlotSettings(plotId, { gridResolution: v }); };
    const setIdwPower = (v: number) => { setIdwPowerLocal(v); updatePlotSettings(plotId, { idwPower: v }); };
    const setSmoothing = (v: number) => { setSmoothingLocal(v); updatePlotSettings(plotId, { smoothing: v }); };
    const setShowSamplePoints = (v: boolean) => { setShowSamplePointsLocal(v); updatePlotSettings(plotId, { showSamplePoints: v }); };
    const setLineWidth = (v: number) => { setLineWidthLocal(v); updatePlotSettings(plotId, { lineWidth: v }); };
    const setShowLabels = (v: boolean) => { setShowLabelsLocal(v); updatePlotSettings(plotId, { showLabels: v }); };
    const setOpacity = (v: number) => { setOpacityLocal(v); updatePlotSettings(plotId, { opacity: v }); };
    const setControlsExpanded = (v: boolean) => { setControlsExpandedLocal(v); updatePlotSettings(plotId, { controlsExpanded: v }); };
    const setHiddenElements = (v: string[]) => { setHiddenElementsLocal(v); updatePlotSettings(plotId, { hiddenElements: v }); };
    const setFilledContours = (v: boolean) => { setFilledContoursLocal(v); updatePlotSettings(plotId, { filledContours: v }); };

    // ─── Derived data ────────────────────────────────────────────────────────

    const numericColumns = sortColumnsByPriority(
        filteredColumns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))
    );

    // Auto-detect X/Y from column roles on first render
    useEffect(() => {
        if (xAxis || yAxis) return;
        const eastCol = columns.find(c => c.role === 'East');
        const northCol = columns.find(c => c.role === 'North');
        if (eastCol) setXAxis(eastCol.name);
        if (northCol) setYAxis(northCol.name);
    }, [columns]);

    // ─── Auto-detect element → column mapping ───────────────────────────────
    // Maps element symbols to their data column names (e.g. 'Cu' → 'Cu_ppm')

    const autoDetectedColumns = useMemo(() => {
        const found: Record<string, string> = {};
        const colNames = filteredColumns.map(c => c.name);
        for (const [, group] of Object.entries(EXTENDED_ELEMENT_CATEGORIES)) {
            for (const element of group.elements) {
                const col = findElementColumn(element, colNames, geochemMappings);
                if (col) {
                    found[element] = col;
                }
            }
        }
        return found;
    }, [filteredColumns, geochemMappings]);

    // Elements that have a column in the dataset
    const availableElements = useMemo(() => {
        const all: string[] = [];
        for (const [, group] of Object.entries(EXTENDED_ELEMENT_CATEGORIES)) {
            for (const element of group.elements) {
                if (autoDetectedColumns[element]) {
                    all.push(element);
                }
            }
        }
        return all;
    }, [autoDetectedColumns]);

    // Get column name for an element symbol
    const getElementColumnName = useCallback((element: string): string | null => {
        return autoDetectedColumns[element] || null;
    }, [autoDetectedColumns]);

    // ─── IDW computation ─────────────────────────────────────────────────────

    useEffect(() => {
        if (!xAxis || !yAxis || selectedElements.length === 0 || displayData.length === 0) {
            setElementGrids([]);
            return;
        }

        const generation = ++computeGeneration.current;
        setComputing(true);

        const computeAll = async () => {
            const grids: ElementGridData[] = [];

            for (const element of selectedElements) {
                if (generation !== computeGeneration.current) return;

                // Resolve column name for this element symbol
                const colName = getElementColumnName(element);
                if (!colName) {
                    console.warn(`[ContourMap] No column found for ${element}`);
                    continue;
                }

                // Get background value using element symbol directly
                let bgValue: number | null = null;
                if (referenceStandard === 'custom') {
                    bgValue = customBackgrounds[element] ?? null;
                } else {
                    const bgEntry = getBackgroundValue(referenceStandard, element);
                    bgValue = bgEntry?.value ?? null;
                }
                if (!bgValue || bgValue <= 0) {
                    console.warn(`[ContourMap] No background value for ${element} in ${referenceStandard}`);
                    continue;
                }

                // Build IDW points: enrichment = value / background
                // CRITICAL: check for null BEFORE Number() conversion
                // Number(null) === 0, which would create false points at origin
                // Allow values ≤ 0 — they represent below-detection-limit or background
                // and should be included as low enrichment (close to 0x)
                const points: IDWPoint[] = [];
                for (let i = 0; i < displayData.length; i++) {
                    const row = displayData[i];
                    const xRaw = row[xAxis];
                    const yRaw = row[yAxis];
                    const valRaw = row[colName];
                    if (xRaw == null || yRaw == null || valRaw == null) continue;
                    const xVal = Number(xRaw);
                    const yVal = Number(yRaw);
                    const rawVal = Number(valRaw);
                    if (isNaN(xVal) || isNaN(yVal) || isNaN(rawVal)) continue;
                    // Clamp negative/zero values to a small positive enrichment (near background)
                    const enrichment = rawVal <= 0 ? 0.01 : rawVal / bgValue;
                    points.push({ x: xVal, y: yVal, value: enrichment });
                }

                if (points.length < 3) {
                    console.warn(`[ContourMap] Only ${points.length} valid points for ${element} (need ≥3)`);
                    continue;
                }

                const grid = await computeIDW(points, {
                    gridSize: gridResolution,
                    power: idwPower,
                    smoothing,
                });

                if (!grid || generation !== computeGeneration.current) return;

                grids.push({
                    element,
                    columnName: colName,
                    backgroundValue: bgValue,
                    grid,
                });
            }

            if (generation === computeGeneration.current) {
                setElementGrids(grids);
                setComputing(false);
            }
        };

        computeAll().catch(err => {
            console.error('[ContourMap] Grid computation failed:', err);
            if (generation === computeGeneration.current) setComputing(false);
        });
    }, [xAxis, yAxis, selectedElements, displayData, referenceStandard, customBackgrounds, gridResolution, idwPower, smoothing, getElementColumnName]);

    // ─── Build Plotly traces ─────────────────────────────────────────────────

    const traces = useMemo(() => {
        const result: Plotly.Data[] = [];

        const sortedLevels = [...contourLevels].sort((a, b) => a - b);
        const minLevel = sortedLevels[0] ?? 1;
        const maxLevel = sortedLevels[sortedLevels.length - 1] ?? 10;

        // Contour traces first (underneath sample points)
        for (let ei = 0; ei < elementGrids.length; ei++) {
            const { element, grid } = elementGrids[ei];
            if (hiddenElements.includes(element)) continue;

            const color = elementColors[element] || getElementColor(element, ei);

            // Replace null with NaN for Plotly gaps
            const zFlat = grid.z.map(row => row.map(v => v === null ? NaN : v));

            if (filledContours) {
                // QGIS-style discrete filled bands.
                // Uses paired colorscale stops to create flat color within each band
                // and sharp transitions at contour boundaries.
                // Opacity emphasises 5-10x anomaly cores.
                const { r, g, b } = hexToRgb(color);

                // Paired stops: each contour boundary has two stops at the same
                // normalised position — the first ends the previous band's color,
                // the second starts the next band's color. This creates discrete steps.
                const norm = (v: number) => Math.min(v / maxLevel, 1);
                const fillColorscale: [number, string][] = [
                    [0,          `rgba(${r}, ${g}, ${b}, 0)`],       // below 1x: transparent
                    [norm(1),    `rgba(${r}, ${g}, ${b}, 0)`],       // up to 1x: transparent
                    [norm(1),    `rgba(${r}, ${g}, ${b}, 0.06)`],    // 1-2x band: very faint
                    [norm(2),    `rgba(${r}, ${g}, ${b}, 0.06)`],
                    [norm(2),    `rgba(${r}, ${g}, ${b}, 0.12)`],    // 2-3x band: light
                    [norm(3),    `rgba(${r}, ${g}, ${b}, 0.12)`],
                    [norm(3),    `rgba(${r}, ${g}, ${b}, 0.22)`],    // 3-5x band: visible
                    [norm(5),    `rgba(${r}, ${g}, ${b}, 0.22)`],
                    [norm(5),    `rgba(${r}, ${g}, ${b}, 0.45)`],    // 5-10x band: strong
                    [norm(10),   `rgba(${r}, ${g}, ${b}, 0.45)`],
                    [1.0,        `rgba(${r}, ${g}, ${b}, 0.75)`],    // >10x: anomaly core
                ];

                // Contour line color — slightly darker, semi-transparent
                const lineColor = `rgba(${Math.max(0, r - 50)}, ${Math.max(0, g - 50)}, ${Math.max(0, b - 50)}, 0.6)`;

                // QGIS-style: discrete filled bands between contour levels
                result.push({
                    type: 'contour',
                    x: grid.x,
                    y: grid.y,
                    z: zFlat,
                    autocontour: false,
                    contours: {
                        coloring: 'fill',
                        showlabels: showLabels,
                        labelfont: { size: 10, color: lineColor },
                        showlines: true,
                        start: minLevel,
                        end: maxLevel,
                        size: 1,
                    },
                    colorscale: fillColorscale,
                    zmin: 0,
                    zmax: maxLevel,
                    showscale: false,
                    name: element,
                    showlegend: true,
                    hovertemplate: `${element}: %{z:.1f}x background<extra></extra>`,
                    connectgaps: true,
                    line: { width: 1, color: lineColor, smoothing: 1.3 },
                } as unknown as Plotly.Data);
            } else {
                // Lines-only mode
                const lineColorscale: [number, string][] = [
                    [0, color],
                    [1, color],
                ];

                result.push({
                    type: 'contour',
                    x: grid.x,
                    y: grid.y,
                    z: zFlat,
                    autocontour: false,
                    contours: {
                        coloring: 'lines',
                        showlabels: showLabels,
                        labelfont: { size: 10, color },
                        start: minLevel,
                        end: maxLevel,
                        size: 1,
                    },
                    colorscale: lineColorscale,
                    line: { width: lineWidth, color, smoothing: 1.3 },
                    showscale: false,
                    name: element,
                    showlegend: true,
                    opacity,
                    hovertemplate: `${element}: %{z:.1f}x background<extra></extra>`,
                    connectgaps: true,
                } as unknown as Plotly.Data);
            }
        }

        // Sample points ON TOP of contours
        if (showSamplePoints && xAxis && yAxis && displayData.length > 0) {
            const xVals: number[] = [];
            const yVals: number[] = [];
            for (let i = 0; i < displayData.length; i++) {
                const xRaw = displayData[i][xAxis];
                const yRaw = displayData[i][yAxis];
                if (xRaw == null || yRaw == null) continue;
                const xVal = Number(xRaw);
                const yVal = Number(yRaw);
                if (!isNaN(xVal) && !isNaN(yVal)) {
                    xVals.push(xVal);
                    yVals.push(yVal);
                }
            }
            result.push({
                type: xVals.length > 5000 ? 'scattergl' : 'scatter',
                x: xVals,
                y: yVals,
                mode: 'markers',
                marker: {
                    size: 2,
                    color: '#333333',
                    opacity: 0.5,
                },
                name: 'Samples',
                showlegend: true,
                hoverinfo: 'skip' as const,
            } as Plotly.Data);
        }

        return result;
    }, [elementGrids, showSamplePoints, xAxis, yAxis, displayData, contourLevels, elementColors, hiddenElements, lineWidth, showLabels, opacity, filledContours]);

    // ─── Layout ──────────────────────────────────────────────────────────────

    const layout = useMemo((): Partial<Plotly.Layout> => ({
        autosize: true,
        xaxis: {
            title: { text: d(xAxis) || 'Easting' },
            scaleanchor: 'y',
            scaleratio: 1,
        },
        yaxis: {
            title: { text: d(yAxis) || 'Northing' },
        },
        hovermode: 'closest',
        showlegend: true,
        legend: {
            x: 1,
            xanchor: 'right',
            y: 1,
        },
        margin: { t: 30, r: 30, b: 60, l: 70 },
        plot_bgcolor: '#fafafa',
    }), [xAxis, yAxis]);

    // ─── Callbacks ───────────────────────────────────────────────────────────

    const toggleContourLevel = useCallback((level: number) => {
        const newLevels = contourLevels.includes(level)
            ? contourLevels.filter(l => l !== level)
            : [...contourLevels, level].sort((a, b) => a - b);
        setContourLevels(newLevels);
    }, [contourLevels]);

    const toggleElementVisibility = useCallback((element: string) => {
        const newHidden = hiddenElements.includes(element)
            ? hiddenElements.filter(e => e !== element)
            : [...hiddenElements, element];
        setHiddenElements(newHidden);
    }, [hiddenElements]);

    const toggleElement = useCallback((element: string) => {
        if (selectedElements.includes(element)) {
            setSelectedElements(selectedElements.filter(e => e !== element));
        } else {
            setSelectedElements([...selectedElements, element]);
        }
    }, [selectedElements]);

    const toggleGroup = useCallback((groupElements: string[]) => {
        const available = groupElements.filter(el => availableElements.includes(el));
        const allSelected = available.every(el => selectedElements.includes(el));
        if (allSelected) {
            setSelectedElements(selectedElements.filter(el => !available.includes(el)));
        } else {
            const newSet = new Set([...selectedElements, ...available]);
            setSelectedElements([...newSet]);
        }
    }, [selectedElements, availableElements]);

    // ─── Render ──────────────────────────────────────────────────────────────

    return (
        <Box sx={{ p: 2 }}>
            {/* Header */}
            <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                    <Typography variant="h6">Contour Element Map</Typography>
                    <Typography variant="caption" color="text.secondary">
                        Enrichment contours (x above background) — {BACKGROUND_STANDARDS.find(s => s.id === referenceStandard)?.name || 'Custom'}
                    </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    {computing && (
                        <Typography variant="caption" color="text.secondary">Computing grids...</Typography>
                    )}
                    <IconButton onClick={() => setControlsExpanded(!controlsExpanded)} size="small">
                        {controlsExpanded ? <ExpandLess /> : <ExpandMore />}
                    </IconButton>
                </Box>
            </Box>

            {/* Controls */}
            <Collapse in={controlsExpanded}>
                <Paper sx={{ p: 2, mb: 2 }}>
                    {/* Row 1: Coordinate and reference standard selection */}
                    <Box sx={{ mb: 2, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                        <FormControl sx={{ minWidth: 140 }} size="small">
                            <InputLabel>X-Axis (Easting)</InputLabel>
                            <Select value={xAxis} onChange={(e) => setXAxis(e.target.value)} label="X-Axis (Easting)">
                                {numericColumns.map(col => (
                                    <MenuItem key={col.name} value={col.name}>{col.alias || col.name}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <FormControl sx={{ minWidth: 140 }} size="small">
                            <InputLabel>Y-Axis (Northing)</InputLabel>
                            <Select value={yAxis} onChange={(e) => setYAxis(e.target.value)} label="Y-Axis (Northing)">
                                {numericColumns.map(col => (
                                    <MenuItem key={col.name} value={col.name}>{col.alias || col.name}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <FormControl sx={{ minWidth: 180 }} size="small">
                            <InputLabel>Reference Standard</InputLabel>
                            <Select
                                value={referenceStandard}
                                onChange={(e) => setReferenceStandard(e.target.value as ReferenceStandardId)}
                                label="Reference Standard"
                            >
                                {BACKGROUND_STANDARDS.map(s => (
                                    <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
                                ))}
                                <MenuItem value="custom">Custom</MenuItem>
                            </Select>
                        </FormControl>
                    </Box>

                    <Divider sx={{ my: 1.5 }} />

                    {/* Element Selector — chip-based, grouped by category */}
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                        Select Elements to Contour ({selectedElements.length} selected)
                    </Typography>

                    {Object.entries(EXTENDED_ELEMENT_CATEGORIES).map(([catKey, group]) => {
                        const groupElements = group.elements as readonly string[];
                        const availableInGroup = groupElements.filter(el => availableElements.includes(el));
                        if (availableInGroup.length === 0) return null;
                        const selectedInGroup = availableInGroup.filter(el => selectedElements.includes(el));
                        const allSelected = selectedInGroup.length === availableInGroup.length;

                        return (
                            <Box key={catKey} sx={{ mb: 1 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <Checkbox
                                        size="small"
                                        checked={allSelected && availableInGroup.length > 0}
                                        indeterminate={selectedInGroup.length > 0 && !allSelected}
                                        onChange={() => toggleGroup(groupElements as unknown as string[])}
                                    />
                                    <Typography variant="caption" fontWeight="bold">
                                        {group.label} ({selectedInGroup.length}/{availableInGroup.length})
                                    </Typography>
                                </Box>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, ml: 3 }}>
                                    {groupElements.map(element => {
                                        const isAvailable = availableElements.includes(element);
                                        const isSelected = selectedElements.includes(element);
                                        const col = getElementColumnName(element);
                                        return (
                                            <Tooltip key={element} title={col ? `Column: ${col}` : 'No column found'}>
                                                <Chip
                                                    label={element}
                                                    size="small"
                                                    color={isSelected ? 'primary' : 'default'}
                                                    variant={isSelected ? 'filled' : 'outlined'}
                                                    disabled={!isAvailable}
                                                    onClick={() => {
                                                        if (isAvailable) toggleElement(element);
                                                    }}
                                                    sx={{ opacity: isAvailable ? 1 : 0.4 }}
                                                />
                                            </Tooltip>
                                        );
                                    })}
                                </Box>

                                {/* Custom background inputs when in custom mode */}
                                {referenceStandard === 'custom' && selectedInGroup.length > 0 && (
                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, ml: 3, mt: 0.5 }}>
                                        {selectedInGroup.map(el => {
                                            const bgEntry = getBackgroundValue('ucc-rudnick-gao-2003', el);
                                            return (
                                                <TextField
                                                    key={el}
                                                    label={`${el} bg (${bgEntry?.unit || 'ppm'})`}
                                                    type="number"
                                                    size="small"
                                                    sx={{ width: 120 }}
                                                    value={customBackgrounds[el] ?? ''}
                                                    onChange={(e) => {
                                                        const val = parseFloat(e.target.value);
                                                        setCustomBackgrounds({
                                                            ...customBackgrounds,
                                                            [el]: isNaN(val) ? 0 : val,
                                                        });
                                                    }}
                                                    inputProps={{ step: 'any', min: 0 }}
                                                />
                                            );
                                        })}
                                    </Box>
                                )}
                            </Box>
                        );
                    })}

                    <Box sx={{ display: 'flex', gap: 1, mt: 1, mb: 1 }}>
                        <Button size="small" startIcon={<SelectAll />} onClick={() => setSelectedElements([...availableElements])}>
                            Select All
                        </Button>
                        <Button size="small" startIcon={<Clear />} onClick={() => setSelectedElements([])}>
                            Clear
                        </Button>
                    </Box>

                    <Divider sx={{ my: 1.5 }} />

                    {/* Contour Levels */}
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>Contour Levels (x background)</Typography>
                    <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                        {ALL_CONTOUR_LEVELS.map(level => (
                            <FormControlLabel
                                key={level}
                                control={
                                    <Checkbox
                                        checked={contourLevels.includes(level)}
                                        onChange={() => toggleContourLevel(level)}
                                        size="small"
                                    />
                                }
                                label={`${level}x`}
                            />
                        ))}
                    </Box>

                    {/* Interpolation & Display Controls */}
                    <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                        <Box sx={{ minWidth: 180 }}>
                            <Typography variant="caption" color="text.secondary">Grid Resolution: {gridResolution}</Typography>
                            <Slider
                                value={gridResolution}
                                onChange={(_, v) => setGridResolution(v as number)}
                                min={30}
                                max={200}
                                step={10}
                                size="small"
                                valueLabelDisplay="auto"
                            />
                        </Box>
                        <Box sx={{ minWidth: 180 }}>
                            <Typography variant="caption" color="text.secondary">Smoothing: {smoothing.toFixed(1)}</Typography>
                            <Slider
                                value={smoothing}
                                onChange={(_, v) => setSmoothing(v as number)}
                                min={0}
                                max={8}
                                step={0.5}
                                size="small"
                                valueLabelDisplay="auto"
                            />
                        </Box>
                        <Box sx={{ minWidth: 180 }}>
                            <Typography variant="caption" color="text.secondary">IDW Power: {idwPower}</Typography>
                            <Slider
                                value={idwPower}
                                onChange={(_, v) => setIdwPower(v as number)}
                                min={1}
                                max={4}
                                step={0.5}
                                size="small"
                                valueLabelDisplay="auto"
                            />
                        </Box>
                        <Box sx={{ minWidth: 160 }}>
                            <Typography variant="caption" color="text.secondary">Line Width: {lineWidth}</Typography>
                            <Slider
                                value={lineWidth}
                                onChange={(_, v) => setLineWidth(v as number)}
                                min={0.5}
                                max={4}
                                step={0.5}
                                size="small"
                                valueLabelDisplay="auto"
                            />
                        </Box>
                        <Box sx={{ minWidth: 160 }}>
                            <Typography variant="caption" color="text.secondary">Opacity: {opacity.toFixed(1)}</Typography>
                            <Slider
                                value={opacity}
                                onChange={(_, v) => setOpacity(v as number)}
                                min={0.1}
                                max={1}
                                step={0.1}
                                size="small"
                                valueLabelDisplay="auto"
                            />
                        </Box>
                    </Box>

                    <Box sx={{ display: 'flex', gap: 2, mt: 1, flexWrap: 'wrap' }}>
                        <FormControlLabel
                            control={<Checkbox checked={filledContours} onChange={(e) => setFilledContours(e.target.checked)} size="small" />}
                            label="Filled contours"
                        />
                        <FormControlLabel
                            control={<Checkbox checked={showSamplePoints} onChange={(e) => setShowSamplePoints(e.target.checked)} size="small" />}
                            label="Show sample points"
                        />
                        <FormControlLabel
                            control={<Checkbox checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} size="small" />}
                            label="Label contour lines"
                        />
                    </Box>

                    {/* Per-element visibility toggles */}
                    {selectedElements.length > 0 && (
                        <>
                            <Divider sx={{ my: 1.5 }} />
                            <Typography variant="subtitle2" sx={{ mb: 1 }}>Element Visibility</Typography>
                            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                {selectedElements.map((element, i) => {
                                    const color = elementColors[element] || getElementColor(element, i);
                                    const isHidden = hiddenElements.includes(element);
                                    return (
                                        <Chip
                                            key={element}
                                            label={element}
                                            onClick={() => toggleElementVisibility(element)}
                                            sx={{
                                                borderLeft: `4px solid ${color}`,
                                                opacity: isHidden ? 0.4 : 1,
                                                textDecoration: isHidden ? 'line-through' : 'none',
                                            }}
                                            size="small"
                                        />
                                    );
                                })}
                            </Box>
                        </>
                    )}
                </Paper>
            </Collapse>

            {/* Plot */}
            {!xAxis || !yAxis ? (
                <Paper sx={{ p: 4, textAlign: 'center' }}>
                    <Typography color="text.secondary">
                        Select X (Easting) and Y (Northing) columns to begin.
                    </Typography>
                </Paper>
            ) : selectedElements.length === 0 ? (
                <Paper sx={{ p: 4, textAlign: 'center' }}>
                    <Typography color="text.secondary">
                        Select one or more elements to generate contour maps.
                    </Typography>
                </Paper>
            ) : (
                <ExpandablePlotWrapper>
                    <Plot
                        data={traces}
                        layout={layout}
                        config={getPlotConfig()}
                        useResizeHandler
                        style={{ width: '100%', height: '100%', minHeight: 500 }}
                    />
                </ExpandablePlotWrapper>
            )}
        </Box>
    );
};
