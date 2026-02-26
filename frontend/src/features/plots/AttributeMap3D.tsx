import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Box, Paper, FormControl, InputLabel, Select, MenuItem, Typography, IconButton, Collapse, Button, Stack, Checkbox, FormControlLabel } from '@mui/material';
import { ExpandMore, ExpandLess, Refresh } from '@mui/icons-material';
import { useAppStore } from '../../store/appStore';
import { useShallow } from 'zustand/react/shallow';
import Plot from 'react-plotly.js';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';
import { useAttributeStore } from '../../store/attributeStore';
import { getStyleArrays, getStyleArraysColumnar, shapeToPlotlySymbol, applyOpacityToColor, getSortedIndices, sortColumnsByPriority, getColumnDisplayName } from '../../utils/attributeUtils';
import { buildCustomData, buildCustomDataColumnar, build3DHoverTemplate } from '../../utils/tooltipUtils';
import { AxisRangeControl, AxisModes, SliceConfig, PickState } from '../../components/AxisRangeControl';
import { getPlotConfig } from '../../utils/plotConfig';

interface CameraState {
    eye?: { x: number; y: number; z: number };
    center?: { x: number; y: number; z: number };
    up?: { x: number; y: number; z: number };
}

interface AxisRanges {
    x: [number, number];
    y: [number, number];
    z: [number, number];
}

interface AttributeMap3DProps {
    plotId: string;
}

export const AttributeMap3D: React.FC<AttributeMap3DProps> = ({ plotId }) => {
    const { data, columns, lockAxes, sampleIndices, columnarRowCount } = useAppStore(useShallow(s => ({ data: s.data, columns: s.columns, lockAxes: s.lockAxes, sampleIndices: s.sampleIndices, columnarRowCount: s.columnarData.rowCount })));
    const getPlotSettings = useAppStore(s => s.getPlotSettings);
    const updatePlotSettings = useAppStore(s => s.updatePlotSettings);
    const getFilteredColumns = useAppStore(s => s.getFilteredColumns);
    const columnFilter = useAppStore(s => s.columnFilter);
    const getDisplayData = useAppStore(s => s.getDisplayData);
    const getDisplayIndices = useAppStore(s => s.getDisplayIndices);
    const getDisplayColumn = useAppStore(s => s.getDisplayColumn);
    useAppStore(s => s.tooltipMode); // Subscribe to trigger re-render on toggle
    const filteredColumns = useMemo(() => getFilteredColumns(), [columns, columnFilter, getFilteredColumns]);
    const d = (name: string) => getColumnDisplayName(columns, name);
    const displayData = useMemo(() => getDisplayData(), [data, sampleIndices]);
    const displayIndices = useMemo(() => getDisplayIndices(), [data, sampleIndices]);
    useAttributeStore(useShallow(s => ({
        color: s.color, shape: s.shape, size: s.size, filter: s.filter,
        customEntries: s.customEntries, emphasis: s.emphasis, globalOpacity: s.globalOpacity,
    })));

    // Get stored settings or defaults
    const storedSettings = getPlotSettings(plotId);

    const [xAxis, setXAxisLocal] = useState<string>(storedSettings.xAxis || '');
    const [yAxis, setYAxisLocal] = useState<string>(storedSettings.yAxis || '');
    const [zAxis, setZAxisLocal] = useState<string>(storedSettings.zAxis || '');
    const [colorAttribute, setColorAttributeLocal] = useState<string>(storedSettings.colorAttribute || '');
    const [controlsExpanded, setControlsExpandedLocal] = useState(storedSettings.controlsExpanded ?? true);
    const [rangeControlsExpanded, setRangeControlsExpandedLocal] = useState(storedSettings.rangeControlsExpanded ?? true);
    const [axisRanges, setAxisRangesLocal] = useState<AxisRanges | null>(storedSettings.axisRanges || null);
    const [equalAxes, setEqualAxesLocal] = useState<boolean>(storedSettings.equalAxes ?? true);
    const [axisModes, setAxisModesLocal] = useState<AxisModes>(storedSettings.axisModes || { x: 'range', y: 'range', z: 'range' });
    const [sliceWidths, setSliceWidthsLocal] = useState<SliceConfig>(storedSettings.sliceWidths || { x: 0, y: 0, z: 0 });
    const [slicePositions, setSlicePositionsLocal] = useState<SliceConfig>(storedSettings.slicePositions || { x: 0, y: 0, z: 0 });
    const [pickState, setPickState] = useState<PickState>({ axis: null, clickCount: 0, firstValue: null });
    const mouseDownPos = useRef<{ x: number; y: number } | null>(null);

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
    const setColorAttribute = (attr: string) => {
        setColorAttributeLocal(attr);
        updatePlotSettings(plotId, { colorAttribute: attr });
    };
    const setControlsExpanded = (expanded: boolean) => {
        setControlsExpandedLocal(expanded);
        updatePlotSettings(plotId, { controlsExpanded: expanded });
    };
    const setRangeControlsExpanded = (expanded: boolean) => {
        setRangeControlsExpandedLocal(expanded);
        updatePlotSettings(plotId, { rangeControlsExpanded: expanded });
    };
    const setEqualAxes = (value: boolean) => {
        setEqualAxesLocal(value);
        updatePlotSettings(plotId, { equalAxes: value });
    };
    const setAxisRanges = (ranges: AxisRanges | null | ((prev: AxisRanges | null) => AxisRanges | null)) => {
        if (typeof ranges === 'function') {
            setAxisRangesLocal(prev => {
                const newRanges = ranges(prev);
                updatePlotSettings(plotId, { axisRanges: newRanges });
                return newRanges;
            });
        } else {
            setAxisRangesLocal(ranges);
            updatePlotSettings(plotId, { axisRanges: ranges });
        }
    };

    const setAxisModes = (modes: AxisModes) => {
        setAxisModesLocal(modes);
        updatePlotSettings(plotId, { axisModes: modes });
    };
    const setSliceWidths = (widths: SliceConfig) => {
        setSliceWidthsLocal(widths);
        updatePlotSettings(plotId, { sliceWidths: widths });
    };
    const setSlicePositions = (positions: SliceConfig) => {
        setSlicePositionsLocal(positions);
        updatePlotSettings(plotId, { slicePositions: positions });
    };

    // Cache camera state when locked
    const cameraRef = useRef<CameraState | null>(null);

    const handleRelayout = useCallback((event: any) => {
        // Capture 3D camera changes
        if (event['scene.camera']) {
            cameraRef.current = event['scene.camera'];
        }
    }, []);

    // Pick mode: handle plot clicks to define ranges from two data points
    const handlePlotClick = useCallback((event: any) => {
        if (!pickState.axis) return;

        // Drag disambiguation: ignore if mouse moved >5px
        if (mouseDownPos.current) {
            const dx = (event.event?.clientX ?? 0) - mouseDownPos.current.x;
            const dy = (event.event?.clientY ?? 0) - mouseDownPos.current.y;
            if (Math.sqrt(dx * dx + dy * dy) > 5) {
                mouseDownPos.current = null;
                return;
            }
        }

        const points = event.points;
        if (!points || points.length === 0) return;
        const point = points[0];
        const axisKey = pickState.axis;
        const coordValue = axisKey === 'x' ? point.x : axisKey === 'y' ? point.y : point.z;
        if (coordValue == null || isNaN(coordValue)) return;

        if (pickState.clickCount === 0) {
            // First click: store value
            setPickState({ axis: axisKey, clickCount: 1, firstValue: coordValue });
        } else {
            // Second click: set range and exit pick mode
            const v1 = pickState.firstValue!;
            const v2 = coordValue;
            const newMin = Math.min(v1, v2);
            const newMax = Math.max(v1, v2);
            setAxisRanges(prev => prev ? { ...prev, [axisKey]: [newMin, newMax] as [number, number] } : null);
            setPickState({ axis: null, clickCount: 0, firstValue: null });
        }
    }, [pickState, setAxisRanges]);

    useEffect(() => {
        if (columns.length > 0 && !xAxis && !yAxis && !zAxis && !storedSettings.xAxis && !storedSettings.yAxis && !storedSettings.zAxis) {
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

    const numericColumns = sortColumnsByPriority(
        filteredColumns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))
    );

    const allNumericColumns = useMemo(() =>
        sortColumnsByPriority(
            columns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))
        ),
        [columns]
    );

    // Calculate data ranges for each axis
    const dataRanges = useMemo(() => {
        if (!data.length || !xAxis || !yAxis || !zAxis) return null;

        let xMin = Infinity, xMax = -Infinity;
        let yMin = Infinity, yMax = -Infinity;
        let zMin = Infinity, zMax = -Infinity;
        let xCount = 0, yCount = 0, zCount = 0;

        for (const row of data) {
            const x = row[xAxis];
            const y = row[yAxis];
            const z = row[zAxis];
            if (x != null && !isNaN(x)) { if (x < xMin) xMin = x; if (x > xMax) xMax = x; xCount++; }
            if (y != null && !isNaN(y)) { if (y < yMin) yMin = y; if (y > yMax) yMax = y; yCount++; }
            if (z != null && !isNaN(z)) { if (z < zMin) zMin = z; if (z > zMax) zMax = z; zCount++; }
        }

        if (xCount === 0 || yCount === 0 || zCount === 0) return null;

        return {
            x: [xMin, xMax] as [number, number],
            y: [yMin, yMax] as [number, number],
            z: [zMin, zMax] as [number, number],
        };
    }, [data, xAxis, yAxis, zAxis]);

    // Initialize axis ranges when data ranges change
    useEffect(() => {
        if (dataRanges) {
            setAxisRanges({
                x: [...dataRanges.x] as [number, number],
                y: [...dataRanges.y] as [number, number],
                z: [...dataRanges.z] as [number, number],
            });
        }
    }, [dataRanges]);

    const getPlotData = () => {
        if (!displayData.length || !xAxis || !yAxis || !zAxis) return { traces: [], filteredCount: 0, totalCount: 0 };

        // Get styles from attribute store — columnar fast path
        const styleArrays = columnarRowCount > 0
            ? getStyleArraysColumnar(displayData.length, (name) => getDisplayColumn(name), displayIndices ?? undefined)
            : getStyleArrays(displayData, displayIndices ?? undefined);

        // Get sorted indices for z-ordering (low-grade first, high-grade last/on top)
        const sortedIndices = getSortedIndices(styleArrays);

        // Pre-extract display columns for axis data
        const xCol = getDisplayColumn(xAxis);
        const yCol = getDisplayColumn(yAxis);
        const zCol = getDisplayColumn(zAxis);

        // Build arrays in sorted order, filtering by axis ranges
        const sortedX: number[] = [];
        const sortedY: number[] = [];
        const sortedZ: number[] = [];
        const sortedColors: string[] = [];
        const sortedShapes: string[] = [];
        const sortedSizes: number[] = [];
        const filteredIndices: number[] = [];

        let filteredCount = 0;
        const totalCount = sortedIndices.length;

        for (const i of sortedIndices) {
            const x = xCol ? xCol[i] : displayData[i][xAxis];
            const y = yCol ? yCol[i] : displayData[i][yAxis];
            const z = zCol ? zCol[i] : displayData[i][zAxis];

            // Skip invalid values
            if (x == null || y == null || z == null || isNaN(x) || isNaN(y) || isNaN(z)) {
                continue;
            }

            // Filter by axis ranges
            if (axisRanges) {
                if (x < axisRanges.x[0] || x > axisRanges.x[1]) continue;
                if (y < axisRanges.y[0] || y > axisRanges.y[1]) continue;
                if (z < axisRanges.z[0] || z > axisRanges.z[1]) continue;
            }

            sortedX.push(x);
            sortedY.push(y);
            sortedZ.push(z);
            sortedColors.push(applyOpacityToColor(styleArrays.colors[i], styleArrays.opacity[i]));
            sortedShapes.push(styleArrays.shapes[i]);
            sortedSizes.push(styleArrays.sizes[i]);
            filteredIndices.push(i);
            filteredCount++;
        }

        // Build customdata for hover tooltips — columnar fast path
        const customData = columnarRowCount > 0
            ? buildCustomDataColumnar((name) => getDisplayColumn(name), filteredIndices, displayIndices ?? undefined)
            : buildCustomData(displayData, filteredIndices, displayIndices ?? undefined);

        const trace: any = {
            type: 'scatter3d',
            mode: 'markers',
            x: sortedX,
            y: sortedY,
            z: sortedZ,
            customdata: customData,
            hovertemplate: build3DHoverTemplate(d(xAxis), d(yAxis), d(zAxis)),
            marker: {
                size: sortedSizes,
                color: sortedColors,
                symbol: sortedShapes.map(s => shapeToPlotlySymbol(s)),
                line: { width: 0 }
            }
        };

        return { traces: [trace], filteredCount, totalCount };
    };

    const handleResetAll = () => {
        if (dataRanges) {
            setAxisRanges({
                x: [...dataRanges.x] as [number, number],
                y: [...dataRanges.y] as [number, number],
                z: [...dataRanges.z] as [number, number],
            });
            setAxisModes({ x: 'range', y: 'range', z: 'range' });
            setPickState({ axis: null, clickCount: 0, firstValue: null });
        }
    };

    const { traces, filteredCount, totalCount } = getPlotData();

    // Check if any range is modified
    const isRangeModified = axisRanges && dataRanges && (
        axisRanges.x[0] !== dataRanges.x[0] || axisRanges.x[1] !== dataRanges.x[1] ||
        axisRanges.y[0] !== dataRanges.y[0] || axisRanges.y[1] !== dataRanges.y[1] ||
        axisRanges.z[0] !== dataRanges.z[0] || axisRanges.z[1] !== dataRanges.z[1]
    );

    return (
        <Box sx={{ p: 2 }}>
            <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="h6">3D Attribute Map</Typography>
                <IconButton onClick={() => setControlsExpanded(!controlsExpanded)} size="small">
                    {controlsExpanded ? <ExpandLess /> : <ExpandMore />}
                </IconButton>
            </Box>

            <Collapse in={controlsExpanded}>
                <Box sx={{ mb: 3, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    <FormControl sx={{ minWidth: 150 }}>
                        <InputLabel>X-Axis</InputLabel>
                        <Select value={xAxis} onChange={(e) => setXAxis(e.target.value)} label="X-Axis" size="small">
                            {(xAxis && !numericColumns.find(c => c.name === xAxis) ? [...numericColumns, ...allNumericColumns.filter(c => c.name === xAxis)] : numericColumns).map(col => (
                                <MenuItem key={col.name} value={col.name}>{col.alias || col.name}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <FormControl sx={{ minWidth: 150 }}>
                        <InputLabel>Y-Axis</InputLabel>
                        <Select value={yAxis} onChange={(e) => setYAxis(e.target.value)} label="Y-Axis" size="small">
                            {(yAxis && !numericColumns.find(c => c.name === yAxis) ? [...numericColumns, ...allNumericColumns.filter(c => c.name === yAxis)] : numericColumns).map(col => (
                                <MenuItem key={col.name} value={col.name}>{col.alias || col.name}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <FormControl sx={{ minWidth: 150 }}>
                        <InputLabel>Z-Axis</InputLabel>
                        <Select value={zAxis} onChange={(e) => setZAxis(e.target.value)} label="Z-Axis" size="small">
                            {(zAxis && !numericColumns.find(c => c.name === zAxis) ? [...numericColumns, ...allNumericColumns.filter(c => c.name === zAxis)] : numericColumns).map(col => (
                                <MenuItem key={col.name} value={col.name}>{col.alias || col.name}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <FormControl sx={{ minWidth: 200 }}>
                        <InputLabel>Color Attribute</InputLabel>
                        <Select value={colorAttribute} onChange={(e) => setColorAttribute(e.target.value)} label="Color Attribute" size="small">
                            <MenuItem value="">None</MenuItem>
                            {(colorAttribute && !numericColumns.find(c => c.name === colorAttribute) ? [...numericColumns, ...allNumericColumns.filter(c => c.name === colorAttribute)] : numericColumns).map(col => (
                                <MenuItem key={col.name} value={col.name}>{col.alias || col.name}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <FormControlLabel
                        control={<Checkbox checked={equalAxes} onChange={(e) => setEqualAxes(e.target.checked)} />}
                        label="Equal Axes"
                    />
                </Box>
            </Collapse>

            {!xAxis || !yAxis || !zAxis ? (
                <Typography color="text.secondary">Select X, Y, and Z axes to display 3D map</Typography>
            ) : (
                <>
                    <Paper sx={{ p: 1 }}>
                        <ExpandablePlotWrapper>
                            <Plot
                                data={traces}
                                layout={{
                                    title: { text: '3D Spatial Map', font: { size: 14 }, x: 0, xanchor: 'left' },
                                    autosize: true,
                                    height: 600,
                                    scene: {
                                        aspectmode: equalAxes ? 'data' : 'auto',
                                        xaxis: {
                                            title: { text: d(xAxis), font: { size: 11 } },
                                            range: axisRanges ? axisRanges.x : undefined,
                                        },
                                        yaxis: {
                                            title: { text: d(yAxis), font: { size: 11 } },
                                            range: axisRanges ? axisRanges.y : undefined,
                                        },
                                        zaxis: {
                                            title: { text: d(zAxis), font: { size: 11 } },
                                            range: axisRanges ? axisRanges.z : undefined,
                                        },
                                        camera: lockAxes && cameraRef.current
                                            ? cameraRef.current
                                            : { eye: { x: 1.5, y: 1.5, z: 1.3 } }
                                    },
                                    margin: { l: 0, r: 0, t: 40, b: 0 },
                                    uirevision: lockAxes ? 'locked' : Date.now()
                                }}
                                config={getPlotConfig({ filename: `map3d_${colorAttribute || 'default'}` })}
                                style={{ width: '100%' }}
                                useResizeHandler={true}
                                onRelayout={handleRelayout}
                                onClick={handlePlotClick}
                            />
                        </ExpandablePlotWrapper>

                        {/* Point count indicator */}
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
                            <Typography variant="caption" color="text.secondary">
                                Points: {filteredCount.toLocaleString()} / {totalCount.toLocaleString()}
                                {isRangeModified && ` (${((filteredCount / totalCount) * 100).toFixed(1)}%)`}
                            </Typography>
                        </Box>
                    </Paper>

                    {/* Axis Range Sliders */}
                    {dataRanges && axisRanges && (
                        <Paper sx={{ p: 2, mt: 2 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Typography variant="subtitle2">Axis Ranges</Typography>
                                    <IconButton
                                        size="small"
                                        onClick={() => setRangeControlsExpanded(!rangeControlsExpanded)}
                                    >
                                        {rangeControlsExpanded ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                                    </IconButton>
                                </Box>
                                <Button
                                    size="small"
                                    startIcon={<Refresh />}
                                    onClick={handleResetAll}
                                    disabled={!isRangeModified}
                                >
                                    Reset All
                                </Button>
                            </Box>

                            <Collapse in={rangeControlsExpanded}>
                                <Stack spacing={1.5}>
                                    {(['x', 'y', 'z'] as const).map((ax) => {
                                        const colorMap = { x: 'primary', y: 'secondary', z: 'error' } as const;
                                        const defaultWidth = (dataRanges[ax][1] - dataRanges[ax][0]) / 10;
                                        return (
                                            <AxisRangeControl
                                                key={ax}
                                                label={ax.toUpperCase()}
                                                axis={ax}
                                                value={axisRanges[ax]}
                                                dataRange={dataRanges[ax]}
                                                onChange={(val) => setAxisRanges(prev => prev ? { ...prev, [ax]: val } : null)}
                                                onReset={() => setAxisRanges(prev => prev ? { ...prev, [ax]: [...dataRanges[ax]] as [number, number] } : null)}
                                                color={colorMap[ax]}
                                                mode={axisModes[ax]}
                                                onModeChange={(m) => setAxisModes({ ...axisModes, [ax]: m })}
                                                sliceWidth={sliceWidths[ax] || defaultWidth}
                                                onSliceWidthChange={(w) => setSliceWidths({ ...sliceWidths, [ax]: w })}
                                                slicePosition={slicePositions[ax] || dataRanges[ax][0]}
                                                onSlicePositionChange={(p) => setSlicePositions({ ...slicePositions, [ax]: p })}
                                                pickState={pickState}
                                                onPickStart={() => setPickState({ axis: ax, clickCount: 0, firstValue: null })}
                                                onPickCancel={() => setPickState({ axis: null, clickCount: 0, firstValue: null })}
                                            />
                                        );
                                    })}
                                </Stack>
                            </Collapse>
                        </Paper>
                    )}
                </>
            )}
        </Box>
    );
};
