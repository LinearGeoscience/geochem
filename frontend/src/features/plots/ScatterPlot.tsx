import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Plot from 'react-plotly.js';
import { useAppStore } from '../../store/appStore';
import { Box, Paper, FormControl, InputLabel, Select, MenuItem, Checkbox, FormControlLabel, Grid, Typography, Slider, ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material';
import { MultiColumnSelector } from '../../components/MultiColumnSelector';
import { TAS_DIAGRAM } from './classifications';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';
import { useAttributeStore } from '../../store/attributeStore';
import { getStyleArrays, shapeToPlotlySymbol, applyOpacityToColor, getSortedIndices, sortColumnsByPriority, getColumnDisplayName } from '../../utils/attributeUtils';
import { calculateLinearRegression } from '../../utils/regressionUtils';
import { buildCustomData, buildScatterHoverTemplate } from '../../utils/tooltipUtils';
import { getPlotConfig, EXPORT_FONT_SIZES, PRESENTATION_FONT_SIZES } from '../../utils/plotConfig';
import { computePointDensities, DENSITY_JET_POINT_COLORSCALE } from '../../utils/densityGrid';

// Store axis ranges per plot when locked
interface AxisRangeCache {
    [key: string]: { xRange?: [number, number]; yRange?: [number, number] };
}

// WebGL threshold - use scattergl for large datasets for better performance
const WEBGL_THRESHOLD = 5000;
// Max WebGL contexts before falling back to CPU-rendered scatter (browsers limit to ~8-16)
const MAX_WEBGL_CONTEXTS = 16;

interface ScatterPlotProps {
    plotId: string;
}

export const ScatterPlot: React.FC<ScatterPlotProps> = ({ plotId }) => {
    const { data, columns, setSelection, lockAxes, getPlotSettings, updatePlotSettings, getFilteredColumns, getDisplayData, getDisplayIndices, sampleIndices, geochemMappings } = useAppStore();
    const filteredColumns = getFilteredColumns();
    const d = (name: string) => getColumnDisplayName(columns, name);
    const displayData = useMemo(() => getDisplayData(), [data, sampleIndices]);
    const displayIndices = useMemo(() => getDisplayIndices(), [data, sampleIndices]);
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
    const [showDensity, setShowDensityLocal] = useState<boolean>(storedSettings.showContours || false);
    const [densitySmoothing, setDensitySmoothingLocal] = useState<number>(storedSettings.contourResolution != null ? Math.min(8, Math.max(0.5, storedSettings.contourResolution / 25)) : 2.0);
    const [densityOpacity, setDensityOpacityLocal] = useState<number>(storedSettings.densityOpacity ?? 0.7);
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
    const setShowDensity = (show: boolean) => {
        setShowDensityLocal(show);
        updatePlotSettings(plotId, { showContours: show });
    };
    const setDensitySmoothing = (smoothing: number) => {
        setDensitySmoothingLocal(smoothing);
        updatePlotSettings(plotId, { contourResolution: smoothing * 25 });
    };
    const setDensityOpacity = (opacity: number) => {
        setDensityOpacityLocal(opacity);
        updatePlotSettings(plotId, { densityOpacity: opacity });
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

    // Check if axes match TAS for any Y-axis (use geochem mappings if available, fallback to string match)
    const isTASForAxis = (yAxisName: string) => {
        if (!xAxis || !yAxisName) return false;

        // Try geochem mappings first
        if (geochemMappings.length > 0) {
            const xMapping = geochemMappings.find(m => m.originalName === xAxis);
            const yMapping = geochemMappings.find(m => m.originalName === yAxisName);
            if (xMapping && yMapping) {
                const xElement = xMapping.userOverride ?? xMapping.detectedElement;
                const yElement = yMapping.userOverride ?? yMapping.detectedElement;
                const xIsOxide = xMapping.isOxide;
                const yIsOxide = yMapping.isOxide;
                if (xElement === 'Si' && xIsOxide && yIsOxide && (yElement === 'Na' || yElement === 'K')) {
                    return true;
                }
            }
        }

        // Fallback to string-based detection
        const xName = xAxis.toLowerCase();
        const yName = yAxisName.toLowerCase();
        return xName.includes('sio2') && (yName.includes('na2o') || yName.includes('k2o'));
    };

    const getPlotDataForAxis = (yAxisName: string) => {
        if (!displayData.length || !xAxis) return [];

        // Get styles from attribute store (includes emphasis calculations)
        const styleArrays = getStyleArrays(displayData, displayIndices ?? undefined);

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
            sortedData.push(displayData[i]);
            // Apply emphasis opacity to colors
            const colorWithOpacity = applyOpacityToColor(styleArrays.colors[i], styleArrays.opacity[i]);
            sortedColors.push(colorWithOpacity);
            sortedShapes.push(styleArrays.shapes[i]);
            sortedSizes.push(styleArrays.sizes[i] * sizeMultiplier);
            sortedOriginalIndices.push(i);
        }

        // Use WebGL for large datasets, but fall back to CPU scatter when too many subplots
        const useWebGL = yAxes.length <= MAX_WEBGL_CONTEXTS;
        const plotType = (useWebGL && sortedData.length > WEBGL_THRESHOLD) ? 'scattergl' : 'scatter';

        // Build rich customdata for hover tooltips
        const customData = buildCustomData(displayData, sortedIndices, displayIndices ?? undefined);

        // Compute per-point density coloring if enabled
        let densityColors: number[] | null = null;
        if (showDensity && sortedData.length >= 10) {
            // Build valid x/y arrays for density; skip non-positive on log axes
            const xRaw = sortedData.map(d => Number(d[xAxis]));
            const yRaw = sortedData.map(d => Number(d[yAxisName]));
            const validMask = xRaw.map((xv, i) => {
                const yv = yRaw[i];
                if (isNaN(xv) || !isFinite(xv) || isNaN(yv) || !isFinite(yv)) return false;
                if (logScaleX && xv <= 0) return false;
                if (logScaleY && yv <= 0) return false;
                return true;
            });
            const xVals = xRaw.map((v, i) => validMask[i] ? (logScaleX ? Math.log10(v) : v) : 0);
            const yVals = yRaw.map((v, i) => validMask[i] ? (logScaleY ? Math.log10(v) : v) : 0);

            // Only use valid points for density computation
            const xValid: number[] = [];
            const yValid: number[] = [];
            const validIndices: number[] = [];
            for (let i = 0; i < validMask.length; i++) {
                if (validMask[i]) {
                    xValid.push(xVals[i]);
                    yValid.push(yVals[i]);
                    validIndices.push(i);
                }
            }

            if (xValid.length >= 10) {
                const result = computePointDensities(xValid, yValid, { smoothingSigma: densitySmoothing });
                if (result) {
                    // Map densities back to full array (0 for invalid points)
                    densityColors = new Array(sortedData.length).fill(0);
                    for (let j = 0; j < validIndices.length; j++) {
                        densityColors[validIndices[j]] = result.densities[j];
                    }
                }
            }
        }

        const trace: any = {
            x: sortedData.map(d => d[xAxis]),
            y: sortedData.map(d => d[yAxisName]),
            mode: 'markers',
            type: plotType,
            customdata: customData,
            hovertemplate: buildScatterHoverTemplate(d(xAxis), d(yAxisName)),
            marker: densityColors ? {
                color: densityColors,
                colorscale: DENSITY_JET_POINT_COLORSCALE,
                showscale: false,
                symbol: sortedShapes.map(s => shapeToPlotlySymbol(s)),
                size: sortedSizes,
                opacity: densityOpacity,
                line: { width: 0 }
            } : {
                color: sortedColors,
                symbol: sortedShapes.map(s => shapeToPlotlySymbol(s)),
                size: sortedSizes,
                line: { width: 0 }
            }
        };

        const traces: any[] = [];

        // Always add scatter points
        traces.push(trace);

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
                    control={<Checkbox checked={showDensity} onChange={(e) => setShowDensity(e.target.checked)} />}
                    label="Show Density"
                />

                {showDensity && (
                    <>
                        <Box sx={{ minWidth: 140, px: 1 }}>
                            <Typography variant="caption" gutterBottom>
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
                        </Box>
                        <Box sx={{ minWidth: 140, px: 1 }}>
                            <Typography variant="caption" gutterBottom>
                                Opacity: {Math.round(densityOpacity * 100)}%
                            </Typography>
                            <Slider
                                value={densityOpacity}
                                onChange={(_, value) => setDensityOpacity(value as number)}
                                min={0.1}
                                max={1}
                                step={0.05}
                                valueLabelDisplay="auto"
                                valueLabelFormat={(v) => `${Math.round(v * 100)}%`}
                                size="small"
                            />
                        </Box>
                    </>
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
                                                    text: `${d(xAxis)} vs ${d(yAxisName)}`,
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
                                                        text: d(xAxis),
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
                                                        text: d(yAxisName),
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
