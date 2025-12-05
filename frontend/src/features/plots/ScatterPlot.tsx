import React, { useState, useEffect, useRef, useCallback } from 'react';
import Plot from 'react-plotly.js';
import { useAppStore } from '../../store/appStore';
import { Box, Paper, FormControl, InputLabel, Select, MenuItem, Checkbox, FormControlLabel, Grid, Typography, Slider, ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material';
import { MultiColumnSelector } from '../../components/MultiColumnSelector';
import { TAS_DIAGRAM } from './classifications';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';
import { useAttributeStore } from '../../store/attributeStore';
import { getStyleArrays, shapeToPlotlySymbol, applyOpacityToColor, getSortedIndices, sortColumnsByPriority } from '../../utils/attributeUtils';
import { calculateLinearRegression } from '../../utils/regressionUtils';
import { buildCustomData, buildScatterHoverTemplate } from '../../utils/tooltipUtils';

// Store axis ranges per plot when locked
interface AxisRangeCache {
    [key: string]: { xRange?: [number, number]; yRange?: [number, number] };
}

// WebGL threshold - use scattergl for large datasets for better performance
const WEBGL_THRESHOLD = 5000;

interface ScatterPlotProps {
    plotId: string;
}

export const ScatterPlot: React.FC<ScatterPlotProps> = ({ plotId }) => {
    const { data, columns, setSelection, lockAxes, getPlotSettings, updatePlotSettings } = useAppStore();
    const { color } = useAttributeStore();

    // Get stored settings or defaults
    const storedSettings = getPlotSettings(plotId);

    const [xAxis, setXAxisLocal] = useState<string>(storedSettings.xAxis || '');
    const [yAxes, setYAxesLocal] = useState<string[]>(storedSettings.yAxes || []);
    const [showClassification, setShowClassificationLocal] = useState<boolean>(storedSettings.showClassification || false);
    const [showRegression, setShowRegressionLocal] = useState<boolean>(storedSettings.showRegression || false);
    const [regressionMode, setRegressionModeLocal] = useState<'global' | 'per-category'>(storedSettings.regressionMode || 'global');
    const [showContours, setShowContoursLocal] = useState<boolean>(storedSettings.showContours || false);
    const [contourResolution, setContourResolutionLocal] = useState<number>(storedSettings.contourResolution || 50);
    const [logScaleX, setLogScaleXLocal] = useState<boolean>(storedSettings.logScaleX || false);
    const [logScaleY, setLogScaleYLocal] = useState<boolean>(storedSettings.logScaleY || false);

    // Wrapper functions to persist settings
    const setXAxis = (axis: string) => {
        setXAxisLocal(axis);
        updatePlotSettings(plotId, { xAxis: axis });
    };
    const setYAxes = (axes: string[]) => {
        setYAxesLocal(axes);
        updatePlotSettings(plotId, { yAxes: axes });
    };
    const setShowClassification = (show: boolean) => {
        setShowClassificationLocal(show);
        updatePlotSettings(plotId, { showClassification: show });
    };
    const setShowRegression = (show: boolean) => {
        setShowRegressionLocal(show);
        updatePlotSettings(plotId, { showRegression: show });
    };
    const setRegressionMode = (mode: 'global' | 'per-category') => {
        setRegressionModeLocal(mode);
        updatePlotSettings(plotId, { regressionMode: mode });
    };
    const setShowContours = (show: boolean) => {
        setShowContoursLocal(show);
        updatePlotSettings(plotId, { showContours: show });
    };
    const setContourResolution = (resolution: number) => {
        setContourResolutionLocal(resolution);
        updatePlotSettings(plotId, { contourResolution: resolution });
    };
    const setLogScaleX = (log: boolean) => {
        setLogScaleXLocal(log);
        updatePlotSettings(plotId, { logScaleX: log });
    };
    const setLogScaleY = (log: boolean) => {
        setLogScaleYLocal(log);
        updatePlotSettings(plotId, { logScaleY: log });
    };

    // Cache axis ranges when locked
    const axisRangesRef = useRef<AxisRangeCache>({});

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

    // Auto-select first two numeric columns only if no stored settings
    useEffect(() => {
        if (columns.length > 0 && !xAxis && yAxes.length === 0 && !storedSettings.xAxis && !storedSettings.yAxes?.length) {
            const numericCols = columns.filter(c => c && c.name && c.type === 'numeric');
            if (numericCols.length >= 2) {
                setXAxis(numericCols[0].name);
                setYAxes([numericCols[1].name]);
            }
        }
    }, [columns, storedSettings]);

    const numericColumns = sortColumnsByPriority(
        columns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))
    );

    // Check if axes match TAS for any Y-axis
    const isTASForAxis = (yAxisName: string) => {
        if (!xAxis || !yAxisName) return false;
        const xName = xAxis.toLowerCase();
        const yName = yAxisName.toLowerCase();
        return xName.includes('sio2') && (yName.includes('na2o') || yName.includes('k2o'));
    };

    const getPlotDataForAxis = (yAxisName: string) => {
        if (!data.length || !xAxis) return [];

        // Get styles from attribute store (includes emphasis calculations)
        const styleArrays = getStyleArrays(data);

        // Get sorted indices (z-ordering: low-grade first, high-grade last/on top)
        const sortedIndices = getSortedIndices(styleArrays);

        // Build arrays in sorted order for z-ordering
        const sortedData: Record<string, any>[] = [];
        const sortedColors: string[] = [];
        const sortedShapes: string[] = [];
        const sortedSizes: number[] = [];
        const sortedOriginalIndices: number[] = [];

        for (const i of sortedIndices) {
            sortedData.push(data[i]);
            // Apply emphasis opacity to colors
            const colorWithOpacity = applyOpacityToColor(styleArrays.colors[i], styleArrays.opacity[i]);
            sortedColors.push(colorWithOpacity);
            sortedShapes.push(styleArrays.shapes[i]);
            sortedSizes.push(styleArrays.sizes[i]);
            sortedOriginalIndices.push(i);
        }

        // Use WebGL for large datasets
        const plotType = sortedData.length > WEBGL_THRESHOLD ? 'scattergl' : 'scatter';

        // Build rich customdata for hover tooltips
        const customData = buildCustomData(data, sortedIndices);

        const trace: any = {
            x: sortedData.map(d => d[xAxis]),
            y: sortedData.map(d => d[yAxisName]),
            mode: 'markers',
            type: plotType,
            customdata: customData,
            hovertemplate: buildScatterHoverTemplate(xAxis, yAxisName),
            marker: {
                color: sortedColors,
                symbol: sortedShapes.map(s => shapeToPlotlySymbol(s)),
                size: sortedSizes,
                line: { width: 0 }
            }
        };

        const traces: any[] = [];

        // Add density heatmap if enabled
        if (showContours) {
            const xValues = sortedData.map(d => Number(d[xAxis])).filter(v => !isNaN(v) && isFinite(v));
            const yValues = sortedData.map(d => Number(d[yAxisName])).filter(v => !isNaN(v) && isFinite(v));

            if (xValues.length > 3 && yValues.length > 3) {
                // Custom Jet colorscale with transparent background for low density
                const jetTransparent = [
                    [0, 'rgba(255,255,255,0)'],
                    [0.05, 'rgb(0,0,131)'],
                    [0.125, 'rgb(0,60,170)'],
                    [0.375, 'rgb(5,255,255)'],
                    [0.625, 'rgb(255,255,0)'],
                    [0.875, 'rgb(250,0,0)'],
                    [1, 'rgb(128,0,0)']
                ];

                traces.push({
                    x: xValues,
                    y: yValues,
                    type: 'histogram2dcontour',
                    nbinsx: contourResolution,
                    nbinsy: contourResolution,
                    colorscale: jetTransparent,
                    showscale: false,
                    contours: {
                        coloring: 'fill',
                        showlabels: false,
                        smoothing: 1.3
                    },
                    hoverinfo: 'skip',
                    line: {
                        width: 0
                    }
                });
            }
        } else {
            // Only show scatter points when contours are disabled
            traces.push(trace);
        }

        // Add regression lines if enabled
        if (showRegression) {
            if (regressionMode === 'global') {
                // Global regression - single line for all visible data
                const xValues = sortedData.map(d => Number(d[xAxis])).filter(v => !isNaN(v) && isFinite(v));
                const yValues = sortedData.map(d => Number(d[yAxisName])).filter(v => !isNaN(v) && isFinite(v));

                const regression = calculateLinearRegression(xValues, yValues);
                if (regression) {
                    traces.push({
                        x: regression.xValues,
                        y: regression.yValues,
                        mode: 'lines',
                        type: 'scatter',
                        name: `Regression (R²=${regression.rSquared.toFixed(3)})`,
                        line: { color: 'red', width: 2, dash: 'dash' },
                        hovertemplate: `y = ${regression.slope.toFixed(4)}x + ${regression.intercept.toFixed(4)}<br>R² = ${regression.rSquared.toFixed(4)}<extra></extra>`
                    });
                }
            } else if (regressionMode === 'per-category' && color.field) {
                // Per-category regression - one line per color category
                const categoryGroups = new Map<string, { data: any[], color: string }>();

                sortedData.forEach((d, idx) => {
                    const category = String(d[color.field!]);
                    if (!categoryGroups.has(category)) {
                        categoryGroups.set(category, { data: [], color: sortedColors[idx] });
                    }
                    categoryGroups.get(category)!.data.push(d);
                });

                // Calculate regression for each category
                categoryGroups.forEach(({ data: categoryData, color: lineColor }, category) => {
                    const xValues = categoryData.map(d => Number(d[xAxis])).filter(v => !isNaN(v) && isFinite(v));
                    const yValues = categoryData.map(d => Number(d[yAxisName])).filter(v => !isNaN(v) && isFinite(v));

                    const regression = calculateLinearRegression(xValues, yValues);
                    if (regression) {
                        traces.push({
                            x: regression.xValues,
                            y: regression.yValues,
                            mode: 'lines',
                            type: 'scatter',
                            name: `${category} (R²=${regression.rSquared.toFixed(3)})`,
                            line: { color: lineColor, width: 2, dash: 'dash' },
                            hovertemplate: `${category}<br>y = ${regression.slope.toFixed(4)}x + ${regression.intercept.toFixed(4)}<br>R² = ${regression.rSquared.toFixed(4)}<extra></extra>`,
                            showlegend: true
                        });
                    }
                });
            }
        }

        return traces;
    };

    const handleSelected = (event: any) => {
        if (event && event.points && event.points.length > 0) {
            const indices = event.points.map((pt: any) => pt.customdata?.idx ?? pt.customdata);
            setSelection(indices);
        }
    };

    const handleDeselect = () => {
        setSelection([]);
    };

    return (
        <Box sx={{ p: 2 }}>
            <Box sx={{ mb: 3, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <FormControl sx={{ minWidth: 200 }}>
                    <InputLabel>X-Axis</InputLabel>
                    <Select value={xAxis} onChange={(e) => setXAxis(e.target.value)} label="X-Axis">
                        {numericColumns.map(col => (
                            <MenuItem key={col.name} value={col.name}>{col.alias || col.name}</MenuItem>
                        ))}
                    </Select>
                </FormControl>

                <MultiColumnSelector
                    columns={numericColumns}
                    selectedColumns={yAxes}
                    onChange={setYAxes}
                    label="Y-Axes"
                />

                {yAxes.some(y => isTASForAxis(y)) && (
                    <FormControlLabel
                        control={<Checkbox checked={showClassification} onChange={(e) => setShowClassification(e.target.checked)} />}
                        label="Show TAS Classification"
                    />
                )}

                <FormControlLabel
                    control={<Checkbox checked={showRegression} onChange={(e) => setShowRegression(e.target.checked)} />}
                    label="Show Regression"
                />

                {showRegression && (
                    <FormControl sx={{ minWidth: 150 }} size="small">
                        <InputLabel>Regression Mode</InputLabel>
                        <Select value={regressionMode} onChange={(e) => setRegressionMode(e.target.value as 'global' | 'per-category')} label="Regression Mode">
                            <MenuItem value="global">Global</MenuItem>
                            <MenuItem value="per-category">Per-Category</MenuItem>
                        </Select>
                    </FormControl>
                )}

                <FormControlLabel
                    control={<Checkbox checked={showContours} onChange={(e) => setShowContours(e.target.checked)} />}
                    label="Show Density Contours"
                />

                {showContours && (
                    <Box sx={{ minWidth: 200, px: 2 }}>
                        <Typography variant="caption" gutterBottom>
                            Contour Resolution: {contourResolution}
                        </Typography>
                        <Slider
                            value={contourResolution}
                            onChange={(_, value) => setContourResolution(value as number)}
                            min={20}
                            max={200}
                            step={10}
                            valueLabelDisplay="auto"
                            size="small"
                        />
                    </Box>
                )}

                {/* Log Scale Controls */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Tooltip title="Apply logarithmic scale to axes">
                        <Typography variant="body2" color="text.secondary">Log Scale:</Typography>
                    </Tooltip>
                    <ToggleButtonGroup
                        size="small"
                        value={[logScaleX ? 'x' : '', logScaleY ? 'y' : ''].filter(Boolean)}
                        onChange={(_, newValues: string[]) => {
                            setLogScaleX(newValues.includes('x'));
                            setLogScaleY(newValues.includes('y'));
                        }}
                    >
                        <ToggleButton value="x" size="small">X</ToggleButton>
                        <ToggleButton value="y" size="small">Y</ToggleButton>
                    </ToggleButtonGroup>
                </Box>
            </Box>

            {!xAxis || yAxes.length === 0 ? (
                <Typography color="text.secondary">Select X-axis and at least one Y-axis to display plots</Typography>
            ) : (
                <Grid container spacing={2}>
                    {yAxes.map((yAxisName) => {
                        const plotData = getPlotDataForAxis(yAxisName);
                        const traces = [...plotData];

                        // Add TAS classification overlay if applicable
                        if (showClassification && isTASForAxis(yAxisName)) {
                            TAS_DIAGRAM.polygons.forEach(polygon => {
                                traces.push({
                                    x: polygon.x,
                                    y: polygon.y,
                                    mode: 'lines',
                                    type: 'scatter',
                                    line: { color: 'black', width: 1 },
                                    fill: 'toself',
                                    fillcolor: polygon.color || 'rgba(200,200,200,0.1)',
                                    name: polygon.name,
                                    showlegend: false,
                                    hoverinfo: 'name'
                                });
                            });
                        }

                        return (
                            <Grid item xs={12} sm={6} lg={4} key={yAxisName}>
                                <Paper sx={{ p: 1 }}>
                                    <ExpandablePlotWrapper>
                                        <Plot
                                            data={traces}
                                            layout={{
                                                title: { text: `${xAxis} vs ${yAxisName}`, font: { size: 14 } },
                                                autosize: true,
                                                height: 400,
                                                hovermode: 'closest',
                                                dragmode: 'lasso',
                                                selectdirection: 'any',
                                                xaxis: {
                                                    title: { text: xAxis, font: { size: 11 } },
                                                    type: logScaleX ? 'log' : 'linear',
                                                    ...(lockAxes && axisRangesRef.current[yAxisName]?.xRange
                                                        ? { range: axisRangesRef.current[yAxisName].xRange, autorange: false }
                                                        : {})
                                                },
                                                yaxis: {
                                                    title: { text: yAxisName, font: { size: 11 } },
                                                    type: logScaleY ? 'log' : 'linear',
                                                    ...(lockAxes && axisRangesRef.current[yAxisName]?.yRange
                                                        ? { range: axisRangesRef.current[yAxisName].yRange, autorange: false }
                                                        : {})
                                                },
                                                showlegend: false,
                                                margin: { l: 50, r: 30, t: 40, b: 50 },
                                                uirevision: lockAxes ? 'locked' : Date.now()
                                            }}
                                            config={{ displayModeBar: true, displaylogo: false, responsive: true }}
                                            style={{ width: '100%' }}
                                            useResizeHandler={true}
                                            onSelected={handleSelected}
                                            onDeselect={handleDeselect}
                                            onRelayout={(e) => handleRelayout(yAxisName, e)}
                                        />
                                    </ExpandablePlotWrapper>
                                </Paper>
                            </Grid>
                        );
                    })}
                </Grid>
            )}
        </Box>
    );
};
