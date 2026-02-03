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
import { getPlotConfig, EXPORT_FONT_SIZES, PRESENTATION_FONT_SIZES } from '../../utils/plotConfig';

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
    const { data, columns, setSelection, lockAxes, getPlotSettings, updatePlotSettings, getFilteredColumns } = useAppStore();
    const filteredColumns = getFilteredColumns();
    // Subscribe to all attribute state that affects styling to trigger re-renders
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { color, shape: _shape, size: _size, filter: _filter, customEntries: _customEntries, emphasis: _emphasis, globalOpacity: _globalOpacity } = useAttributeStore();

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
    const [presentationMode, setPresentationModeLocal] = useState<boolean>(storedSettings.presentationMode || false);
    const [sortOrder, setSortOrderLocal] = useState<string>(storedSettings.sortOrder || 'default');

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
    const setPresentationMode = (mode: boolean) => {
        setPresentationModeLocal(mode);
        updatePlotSettings(plotId, { presentationMode: mode });
    };
    const setSortOrder = (order: string) => {
        setSortOrderLocal(order);
        updatePlotSettings(plotId, { sortOrder: order });
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
        filteredColumns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))
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

        // Marker size multiplier for presentation mode (makes markers much larger)
        const sizeMultiplier = presentationMode ? 1.8 : 1;

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
            sortedSizes.push(styleArrays.sizes[i] * sizeMultiplier);
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
                        line: { color: 'red', width: presentationMode ? 4 : 2, dash: 'dash' },
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
                            line: { color: lineColor, width: presentationMode ? 4 : 2, dash: 'dash' },
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

    const getSortedYAxes = (): string[] => {
        if (sortOrder === 'default') return yAxes;
        if (sortOrder === 'alphabetical') return [...yAxes].sort((a, b) => a.localeCompare(b));

        if (sortOrder === 'r2-high' || sortOrder === 'r2-low' || sortOrder === 'r2-pos' || sortOrder === 'r2-neg') {
            const r2Map = new Map<string, number>();
            const signedR2Map = new Map<string, number>();
            for (const yName of yAxes) {
                const xValues = data.map(d => Number(d[xAxis])).filter(v => !isNaN(v) && isFinite(v));
                const yValues = data.map(d => Number(d[yName])).filter(v => !isNaN(v) && isFinite(v));
                const regression = calculateLinearRegression(xValues, yValues);
                r2Map.set(yName, regression?.rSquared ?? -1);
                const sign = regression && regression.slope >= 0 ? 1 : -1;
                signedR2Map.set(yName, (regression?.rSquared ?? 0) * sign);
            }
            return [...yAxes].sort((a, b) => {
                if (sortOrder === 'r2-pos' || sortOrder === 'r2-neg') {
                    const sA = signedR2Map.get(a) ?? 0;
                    const sB = signedR2Map.get(b) ?? 0;
                    return sortOrder === 'r2-pos' ? sB - sA : sA - sB;
                }
                const rA = r2Map.get(a) ?? -1;
                const rB = r2Map.get(b) ?? -1;
                return sortOrder === 'r2-high' ? rB - rA : rA - rB;
            });
        }
        return yAxes;
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

                {/* Presentation Mode Toggle */}
                <Tooltip title="Use much larger text and markers for PowerPoint exports (when placing multiple small plots on a slide)">
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={presentationMode}
                                onChange={(e) => setPresentationMode(e.target.checked)}
                                size="small"
                            />
                        }
                        label={<Typography variant="body2">Presentation Mode</Typography>}
                    />
                </Tooltip>

                {yAxes.length > 1 && (
                    <FormControl sx={{ minWidth: 170 }} size="small">
                        <InputLabel>Sort Plots</InputLabel>
                        <Select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} label="Sort Plots">
                            <MenuItem value="default">Default (Selection Order)</MenuItem>
                            <MenuItem value="alphabetical">Alphabetical (A→Z)</MenuItem>
                            <MenuItem value="r2-high">Highest R²</MenuItem>
                            <MenuItem value="r2-low">Lowest R²</MenuItem>
                            <MenuItem value="r2-pos">Strongest Positive R²</MenuItem>
                            <MenuItem value="r2-neg">Strongest Negative R²</MenuItem>
                        </Select>
                    </FormControl>
                )}
            </Box>

            {!xAxis || yAxes.length === 0 ? (
                <Typography color="text.secondary">Select X-axis and at least one Y-axis to display plots</Typography>
            ) : (
                <Grid container spacing={2}>
                    {getSortedYAxes().map((yAxisName) => {
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
                                                title: {
                                                    text: `${xAxis} vs ${yAxisName}`,
                                                    font: { size: presentationMode ? PRESENTATION_FONT_SIZES.title : EXPORT_FONT_SIZES.title }
                                                },
                                                autosize: true,
                                                height: presentationMode ? 500 : 400,
                                                hovermode: 'closest',
                                                dragmode: 'lasso',
                                                selectdirection: 'any',
                                                font: { size: presentationMode ? PRESENTATION_FONT_SIZES.tickLabels : EXPORT_FONT_SIZES.tickLabels },
                                                xaxis: {
                                                    title: {
                                                        text: xAxis,
                                                        font: { size: presentationMode ? PRESENTATION_FONT_SIZES.axisTitle : EXPORT_FONT_SIZES.axisTitle }
                                                    },
                                                    tickfont: { size: presentationMode ? PRESENTATION_FONT_SIZES.tickLabels : EXPORT_FONT_SIZES.tickLabels },
                                                    type: logScaleX ? 'log' : 'linear',
                                                    ...(lockAxes && axisRangesRef.current[yAxisName]?.xRange
                                                        ? { range: axisRangesRef.current[yAxisName].xRange, autorange: false }
                                                        : {})
                                                },
                                                yaxis: {
                                                    title: {
                                                        text: yAxisName,
                                                        font: { size: presentationMode ? PRESENTATION_FONT_SIZES.axisTitle : EXPORT_FONT_SIZES.axisTitle }
                                                    },
                                                    tickfont: { size: presentationMode ? PRESENTATION_FONT_SIZES.tickLabels : EXPORT_FONT_SIZES.tickLabels },
                                                    type: logScaleY ? 'log' : 'linear',
                                                    ...(lockAxes && axisRangesRef.current[yAxisName]?.yRange
                                                        ? { range: axisRangesRef.current[yAxisName].yRange, autorange: false }
                                                        : {})
                                                },
                                                showlegend: false,
                                                margin: presentationMode
                                                    ? { l: 100, r: 50, t: 80, b: 100 }
                                                    : { l: 70, r: 40, t: 60, b: 70 },
                                                uirevision: lockAxes ? 'locked' : Date.now()
                                            }}
                                            config={getPlotConfig({ filename: `scatter_${xAxis}_${yAxisName}` })}
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
