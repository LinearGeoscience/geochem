import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Box, Paper, FormControl, InputLabel, Select, MenuItem, Typography, IconButton, Collapse, Button, Stack } from '@mui/material';
import { ExpandMore, ExpandLess, Refresh } from '@mui/icons-material';
import { useAppStore } from '../../store/appStore';
import Plot from 'react-plotly.js';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';
import { useAttributeStore } from '../../store/attributeStore';
import { getStyleArrays, shapeToPlotlySymbol, applyOpacityToColor, getSortedIndices, sortColumnsByPriority } from '../../utils/attributeUtils';
import { buildCustomData, build3DHoverTemplate } from '../../utils/tooltipUtils';
import { AxisRangeSlider } from '../../components/AxisRangeSlider';
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
    const { data, columns, lockAxes, getPlotSettings, updatePlotSettings, getFilteredColumns } = useAppStore();
    const filteredColumns = getFilteredColumns();
    useAttributeStore(); // Subscribe to changes

    // Get stored settings or defaults
    const storedSettings = getPlotSettings(plotId);

    const [xAxis, setXAxisLocal] = useState<string>(storedSettings.xAxis || '');
    const [yAxis, setYAxisLocal] = useState<string>(storedSettings.yAxis || '');
    const [zAxis, setZAxisLocal] = useState<string>(storedSettings.zAxis || '');
    const [colorAttribute, setColorAttributeLocal] = useState<string>(storedSettings.colorAttribute || '');
    const [controlsExpanded, setControlsExpandedLocal] = useState(storedSettings.controlsExpanded ?? true);
    const [rangeControlsExpanded, setRangeControlsExpandedLocal] = useState(storedSettings.rangeControlsExpanded ?? true);
    const [axisRanges, setAxisRangesLocal] = useState<AxisRanges | null>(storedSettings.axisRanges || null);

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

    // Cache camera state when locked
    const cameraRef = useRef<CameraState | null>(null);

    const handleRelayout = useCallback((event: any) => {
        // Capture 3D camera changes
        if (event['scene.camera']) {
            cameraRef.current = event['scene.camera'];
        }
    }, []);

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

    // Calculate data ranges for each axis
    const dataRanges = useMemo(() => {
        if (!data.length || !xAxis || !yAxis || !zAxis) return null;

        const xValues: number[] = [];
        const yValues: number[] = [];
        const zValues: number[] = [];

        for (const row of data) {
            const x = row[xAxis];
            const y = row[yAxis];
            const z = row[zAxis];
            if (x != null && !isNaN(x)) xValues.push(x);
            if (y != null && !isNaN(y)) yValues.push(y);
            if (z != null && !isNaN(z)) zValues.push(z);
        }

        if (xValues.length === 0 || yValues.length === 0 || zValues.length === 0) {
            return null;
        }

        return {
            x: [Math.min(...xValues), Math.max(...xValues)] as [number, number],
            y: [Math.min(...yValues), Math.max(...yValues)] as [number, number],
            z: [Math.min(...zValues), Math.max(...zValues)] as [number, number],
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
        if (!data.length || !xAxis || !yAxis || !zAxis) return { traces: [], filteredCount: 0, totalCount: 0 };

        // Get styles from attribute store (includes emphasis calculations)
        const styleArrays = getStyleArrays(data);

        // Get sorted indices for z-ordering (low-grade first, high-grade last/on top)
        const sortedIndices = getSortedIndices(styleArrays);

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
            const x = data[i][xAxis];
            const y = data[i][yAxis];
            const z = data[i][zAxis];

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

        // Build customdata for hover tooltips
        const customData = buildCustomData(data, filteredIndices);

        const trace: any = {
            type: 'scatter3d',
            mode: 'markers',
            x: sortedX,
            y: sortedY,
            z: sortedZ,
            customdata: customData,
            hovertemplate: build3DHoverTemplate(xAxis, yAxis, zAxis),
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
                            {numericColumns.map(col => (
                                <MenuItem key={col.name} value={col.name}>{col.alias || col.name}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <FormControl sx={{ minWidth: 150 }}>
                        <InputLabel>Y-Axis</InputLabel>
                        <Select value={yAxis} onChange={(e) => setYAxis(e.target.value)} label="Y-Axis" size="small">
                            {numericColumns.map(col => (
                                <MenuItem key={col.name} value={col.name}>{col.alias || col.name}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <FormControl sx={{ minWidth: 150 }}>
                        <InputLabel>Z-Axis</InputLabel>
                        <Select value={zAxis} onChange={(e) => setZAxis(e.target.value)} label="Z-Axis" size="small">
                            {numericColumns.map(col => (
                                <MenuItem key={col.name} value={col.name}>{col.alias || col.name}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <FormControl sx={{ minWidth: 200 }}>
                        <InputLabel>Color Attribute</InputLabel>
                        <Select value={colorAttribute} onChange={(e) => setColorAttribute(e.target.value)} label="Color Attribute" size="small">
                            <MenuItem value="">None</MenuItem>
                            {numericColumns.map(col => (
                                <MenuItem key={col.name} value={col.name}>{col.alias || col.name}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
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
                                        xaxis: {
                                            title: { text: xAxis, font: { size: 11 } },
                                            range: axisRanges ? axisRanges.x : undefined,
                                        },
                                        yaxis: {
                                            title: { text: yAxis, font: { size: 11 } },
                                            range: axisRanges ? axisRanges.y : undefined,
                                        },
                                        zaxis: {
                                            title: { text: zAxis, font: { size: 11 } },
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
                                <Stack spacing={2}>
                                    <AxisRangeSlider
                                        label="X"
                                        value={axisRanges.x}
                                        dataRange={dataRanges.x}
                                        onChange={(val) => setAxisRanges(prev => prev ? { ...prev, x: val } : null)}
                                        onReset={() => setAxisRanges(prev => prev ? { ...prev, x: [...dataRanges.x] as [number, number] } : null)}
                                        color="primary"
                                    />
                                    <AxisRangeSlider
                                        label="Y"
                                        value={axisRanges.y}
                                        dataRange={dataRanges.y}
                                        onChange={(val) => setAxisRanges(prev => prev ? { ...prev, y: val } : null)}
                                        onReset={() => setAxisRanges(prev => prev ? { ...prev, y: [...dataRanges.y] as [number, number] } : null)}
                                        color="secondary"
                                    />
                                    <AxisRangeSlider
                                        label="Z"
                                        value={axisRanges.z}
                                        dataRange={dataRanges.z}
                                        onChange={(val) => setAxisRanges(prev => prev ? { ...prev, z: val } : null)}
                                        onReset={() => setAxisRanges(prev => prev ? { ...prev, z: [...dataRanges.z] as [number, number] } : null)}
                                        color="error"
                                    />
                                </Stack>
                            </Collapse>
                        </Paper>
                    )}
                </>
            )}
        </Box>
    );
};
