import React, { useState, useMemo } from 'react';
import Plot from 'react-plotly.js';
import { useAppStore } from '../../store/appStore';
import { useAttributeStore } from '../../store/attributeStore';
import { getStyleArrays, applyOpacityToColor, getSortedIndices, sortColumnsByPriority, getColumnDisplayName } from '../../utils/attributeUtils';
import {
    clrTransform,
    simplePCA,
    clrCorrelationMatrix,
    ZeroHandlingStrategy,
} from '../../utils/clrTransform';
import { getPlotConfig, EXPORT_FONT_SIZES } from '../../utils/plotConfig';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';
import {
    Box,
    Paper,
    Typography,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip,
    Grid,
    Alert,
    Checkbox,
    FormControlLabel,
    Slider,
} from '@mui/material';
import { MultiColumnSelector } from '../../components/MultiColumnSelector';
import { computePointDensities, DENSITY_JET_POINT_COLORSCALE } from '../../utils/densityGrid';

type PlotType = 'biplot' | 'scatter' | 'correlation';

const ZERO_STRATEGIES: { id: ZeroHandlingStrategy; name: string; description: string }[] = [
    { id: 'half-min', name: 'Half Minimum', description: 'Replace zeros with half the minimum non-zero value' },
    { id: 'small-constant', name: 'Small Constant', description: 'Replace zeros with 0.001' },
    { id: 'multiplicative', name: 'Multiplicative', description: 'Multiplicative replacement (preserves ratios)' },
];

// Colors for correlation matrix
const CORRELATION_COLORSCALE: [number, string][] = [
    [0, '#d73027'],    // Strong negative - red
    [0.25, '#fc8d59'], // Moderate negative - orange
    [0.5, '#ffffff'],  // Zero - white
    [0.75, '#91bfdb'], // Moderate positive - light blue
    [1, '#4575b4'],    // Strong positive - dark blue
];

interface CLRPlotProps {
    plotId: string;
}

export const CLRPlot: React.FC<CLRPlotProps> = ({ plotId }) => {
    const { data, columns, getPlotSettings, updatePlotSettings, getFilteredColumns, getDisplayData, getDisplayIndices, sampleIndices } = useAppStore();
    const filteredColumns = getFilteredColumns();
    const d = (name: string) => getColumnDisplayName(columns, name);
    const displayData = useMemo(() => getDisplayData(), [data, sampleIndices]);
    const displayIndices = useMemo(() => getDisplayIndices(), [data, sampleIndices]);
    useAttributeStore(); // Subscribe to style changes

    // Get stored settings or defaults
    const storedSettings = getPlotSettings(plotId);

    const [selectedColumns, setSelectedColumnsLocal] = useState<string[]>(storedSettings.clrColumns || []);
    const [plotType, setPlotTypeLocal] = useState<PlotType>(storedSettings.clrPlotType || 'biplot');
    const [zeroStrategy, setZeroStrategyLocal] = useState<ZeroHandlingStrategy>(storedSettings.zeroStrategy || 'half-min');
    const [scatterX, setScatterXLocal] = useState<string>(storedSettings.clrScatterX || '');
    const [scatterY, setScatterYLocal] = useState<string>(storedSettings.clrScatterY || '');
    const [showDensity, setShowDensityLocal] = useState<boolean>(storedSettings.showDensity || false);
    const [densitySmoothing, setDensitySmoothingLocal] = useState<number>(storedSettings.densitySmoothing ?? 2.0);
    const [densityOpacity, setDensityOpacityLocal] = useState<number>(storedSettings.densityOpacity ?? 0.7);

    // Wrapper functions to persist settings
    const setSelectedColumns = (cols: string[]) => {
        setSelectedColumnsLocal(cols);
        updatePlotSettings(plotId, { clrColumns: cols });
    };
    const setPlotType = (type: PlotType) => {
        setPlotTypeLocal(type);
        updatePlotSettings(plotId, { clrPlotType: type });
    };
    const setZeroStrategy = (strategy: ZeroHandlingStrategy) => {
        setZeroStrategyLocal(strategy);
        updatePlotSettings(plotId, { zeroStrategy: strategy });
    };
    const setScatterX = (col: string) => {
        setScatterXLocal(col);
        updatePlotSettings(plotId, { clrScatterX: col });
    };
    const setScatterY = (col: string) => {
        setScatterYLocal(col);
        updatePlotSettings(plotId, { clrScatterY: col });
    };
    const setShowDensity = (show: boolean) => {
        setShowDensityLocal(show);
        updatePlotSettings(plotId, { showDensity: show });
    };
    const setDensitySmoothing = (smoothing: number) => {
        setDensitySmoothingLocal(smoothing);
        updatePlotSettings(plotId, { densitySmoothing: smoothing });
    };
    const setDensityOpacity = (opacity: number) => {
        setDensityOpacityLocal(opacity);
        updatePlotSettings(plotId, { densityOpacity: opacity });
    };

    // Get numeric columns (compositional data), sorted by priority
    const numericColumns = useMemo(() =>
        sortColumnsByPriority(filteredColumns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))),
        [columns]
    );

    // Get visible data
    const visibleData = useMemo(() => {
        if (!displayData.length) return [];
        const styleArrays = getStyleArrays(displayData, displayIndices ?? undefined);
        return displayData.filter((_, i) => styleArrays.visible[i]);
    }, [displayData, displayIndices]);

    // Perform CLR transformation
    const clrResult = useMemo(() => {
        if (selectedColumns.length < 2 || !visibleData.length) return null;

        return clrTransform(visibleData, selectedColumns, { zeroStrategy });
    }, [visibleData, selectedColumns, zeroStrategy]);

    // Generate PCA biplot data
    const biplotData = useMemo(() => {
        if (!clrResult || plotType !== 'biplot') return null;

        const pca = simplePCA(clrResult.transformed);
        return pca;
    }, [clrResult, plotType]);

    // Generate correlation matrix
    const corrMatrix = useMemo(() => {
        if (!clrResult || plotType !== 'correlation') return null;

        return clrCorrelationMatrix(clrResult.transformed);
    }, [clrResult, plotType]);

    // Get style arrays for coloring
    const styleArrays = useMemo(() => {
        if (!displayData.length) return null;
        return getStyleArrays(displayData, displayIndices ?? undefined);
    }, [displayData, displayIndices]);

    // Generate plot traces
    const traces = useMemo(() => {
        if (!clrResult || !styleArrays) return [];

        const visibleIndices = displayData.map((_, i) => i).filter(i => styleArrays.visible[i]);

        if (plotType === 'biplot' && biplotData) {
            // Biplot: samples as points + variable loadings as arrows
            const traces: any[] = [];

            // Get sorted indices for proper z-ordering
            const sortedVisibleIndices = getSortedIndices(styleArrays)
                .filter(i => styleArrays.visible[i]);

            // Map original indices to CLR result indices
            const visibleIndexToClrIndex = new Map<number, number>();
            visibleIndices.forEach((origIdx, clrIdx) => {
                visibleIndexToClrIndex.set(origIdx, clrIdx);
            });

            // Sample points
            const x: number[] = [];
            const y: number[] = [];
            const colors: string[] = [];
            const sizes: number[] = [];

            for (const origIdx of sortedVisibleIndices) {
                const clrIdx = visibleIndexToClrIndex.get(origIdx);
                if (clrIdx !== undefined && biplotData.scores[clrIdx]) {
                    x.push(biplotData.scores[clrIdx][0]);
                    y.push(biplotData.scores[clrIdx][1]);
                    colors.push(applyOpacityToColor(styleArrays.colors[origIdx], styleArrays.opacity[origIdx]));
                    sizes.push(styleArrays.sizes[origIdx]);
                }
            }

            traces.push({
                type: 'scatter',
                mode: 'markers',
                name: 'Samples',
                x,
                y,
                marker: {
                    color: colors,
                    size: sizes,
                },
                hovertemplate: 'PC1: %{x:.3f}<br>PC2: %{y:.3f}<extra></extra>',
            });

            // Variable loadings as arrows
            const loadingScale = Math.max(
                Math.max(...x.map(Math.abs)),
                Math.max(...y.map(Math.abs))
            ) * 0.8;

            for (let i = 0; i < selectedColumns.length; i++) {
                const loading = biplotData.loadings[i];
                if (!loading) continue;

                // Arrow from origin to loading position
                traces.push({
                    type: 'scatter',
                    mode: 'lines+text',
                    name: d(selectedColumns[i]),
                    x: [0, loading[0] * loadingScale],
                    y: [0, loading[1] * loadingScale],
                    line: { color: '#e74c3c', width: 2 },
                    text: ['', d(selectedColumns[i])],
                    textposition: 'top center',
                    textfont: { size: 10, color: '#e74c3c' },
                    showlegend: false,
                    hoverinfo: 'name',
                });
            }

            return traces;
        } else if (plotType === 'scatter' && scatterX && scatterY) {
            // CLR scatter plot of two variables
            const xIdx = selectedColumns.indexOf(scatterX);
            const yIdx = selectedColumns.indexOf(scatterY);

            if (xIdx === -1 || yIdx === -1) return [];

            // Get sorted indices
            const sortedVisibleIndices = getSortedIndices(styleArrays)
                .filter(i => styleArrays.visible[i]);

            const visibleIndexToClrIndex = new Map<number, number>();
            visibleIndices.forEach((origIdx, clrIdx) => {
                visibleIndexToClrIndex.set(origIdx, clrIdx);
            });

            const x: number[] = [];
            const y: number[] = [];
            const colors: string[] = [];
            const sizes: number[] = [];

            for (const origIdx of sortedVisibleIndices) {
                const clrIdx = visibleIndexToClrIndex.get(origIdx);
                if (clrIdx !== undefined && clrResult.transformed[clrIdx]) {
                    x.push(clrResult.transformed[clrIdx][xIdx]);
                    y.push(clrResult.transformed[clrIdx][yIdx]);
                    colors.push(applyOpacityToColor(styleArrays.colors[origIdx], styleArrays.opacity[origIdx]));
                    sizes.push(styleArrays.sizes[origIdx]);
                }
            }

            // Compute per-point density if enabled
            let clrDensity: number[] | null = null;
            if (showDensity && x.length >= 10) {
                const result = computePointDensities(x, y, { smoothingSigma: densitySmoothing });
                if (result) clrDensity = result.densities;
            }

            return [{
                type: 'scatter',
                mode: 'markers',
                x,
                y,
                marker: clrDensity ? {
                    color: clrDensity,
                    colorscale: DENSITY_JET_POINT_COLORSCALE,
                    showscale: false,
                    opacity: densityOpacity,
                    size: sizes,
                } : {
                    color: colors,
                    size: sizes,
                },
                hovertemplate: `clr(${d(scatterX)}): %{x:.3f}<br>clr(${d(scatterY)}): %{y:.3f}<extra></extra>`,
            }];
        } else if (plotType === 'correlation' && corrMatrix) {
            // Correlation matrix heatmap
            return [{
                type: 'heatmap',
                z: corrMatrix,
                x: selectedColumns.map(c => d(c)),
                y: selectedColumns.map(c => d(c)),
                colorscale: CORRELATION_COLORSCALE,
                zmin: -1,
                zmax: 1,
                hovertemplate: '%{x} vs %{y}: %{z:.3f}<extra></extra>',
                colorbar: {
                    title: 'Correlation',
                    tickvals: [-1, -0.5, 0, 0.5, 1],
                },
            }];
        }

        return [];
    }, [clrResult, biplotData, corrMatrix, plotType, scatterX, scatterY, styleArrays, selectedColumns, displayData, showDensity, densitySmoothing, densityOpacity]);

    // Layout configuration
    const layout = useMemo(() => {
        const baseLayout: any = {
            autosize: true,
            height: 350,
            margin: { l: 70, r: 40, t: 60, b: 70 },
            hovermode: 'closest',
            font: { size: EXPORT_FONT_SIZES.tickLabels },
        };

        if (plotType === 'biplot' && biplotData) {
            const pc1Var = (biplotData.variance[0] * 100).toFixed(1);
            const pc2Var = (biplotData.variance[1] * 100).toFixed(1);

            return {
                ...baseLayout,
                title: { text: 'CLR Biplot (PCA)', font: { size: EXPORT_FONT_SIZES.title }, x: 0, xanchor: 'left' },
                xaxis: { title: { text: `PC1 (${pc1Var}% var)`, font: { size: EXPORT_FONT_SIZES.axisTitle } }, tickfont: { size: EXPORT_FONT_SIZES.tickLabels }, zeroline: true, zerolinewidth: 1 },
                yaxis: { title: { text: `PC2 (${pc2Var}% var)`, font: { size: EXPORT_FONT_SIZES.axisTitle } }, tickfont: { size: EXPORT_FONT_SIZES.tickLabels }, zeroline: true, zerolinewidth: 1 },
                showlegend: false,
            };
        } else if (plotType === 'scatter') {
            return {
                ...baseLayout,
                title: { text: `CLR Scatter: ${d(scatterX)} vs ${d(scatterY)}`, font: { size: EXPORT_FONT_SIZES.title }, x: 0, xanchor: 'left' },
                xaxis: { title: { text: `clr(${d(scatterX)})`, font: { size: EXPORT_FONT_SIZES.axisTitle } }, tickfont: { size: EXPORT_FONT_SIZES.tickLabels } },
                yaxis: { title: { text: `clr(${d(scatterY)})`, font: { size: EXPORT_FONT_SIZES.axisTitle } }, tickfont: { size: EXPORT_FONT_SIZES.tickLabels } },
            };
        } else if (plotType === 'correlation') {
            return {
                ...baseLayout,
                title: { text: 'CLR Correlation Matrix', font: { size: EXPORT_FONT_SIZES.title }, x: 0, xanchor: 'left' },
                xaxis: { tickangle: 45, tickfont: { size: EXPORT_FONT_SIZES.tickLabels } },
                yaxis: { autorange: 'reversed', tickfont: { size: EXPORT_FONT_SIZES.tickLabels } },
            };
        }

        return baseLayout;
    }, [plotType, biplotData, scatterX, scatterY]);

    return (
        <Box sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>CLR (Centered Log-Ratio) Plot</Typography>

            {/* Controls */}
            <Grid container spacing={2} sx={{ mb: 3 }}>
                <Grid item xs={12} md={4}>
                    <MultiColumnSelector
                        columns={numericColumns}
                        selectedColumns={selectedColumns}
                        onChange={setSelectedColumns}
                        label="Compositional Variables"
                    />
                </Grid>

                <Grid item xs={12} md={3}>
                    <FormControl fullWidth>
                        <InputLabel>Zero Handling</InputLabel>
                        <Select
                            value={zeroStrategy}
                            onChange={(e) => setZeroStrategy(e.target.value as ZeroHandlingStrategy)}
                            label="Zero Handling"
                        >
                            {ZERO_STRATEGIES.map((strategy) => (
                                <MenuItem key={strategy.id} value={strategy.id}>
                                    <Tooltip title={strategy.description} placement="right">
                                        <span>{strategy.name}</span>
                                    </Tooltip>
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </Grid>

                <Grid item xs={12} md={5}>
                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                        <ToggleButtonGroup
                            value={plotType}
                            exclusive
                            onChange={(_, v) => v && setPlotType(v)}
                            size="small"
                        >
                            <ToggleButton value="biplot">Biplot</ToggleButton>
                            <ToggleButton value="scatter">Scatter</ToggleButton>
                            <ToggleButton value="correlation">Correlation</ToggleButton>
                        </ToggleButtonGroup>

                        {plotType === 'scatter' && selectedColumns.length >= 2 && (
                            <>
                                <FormControl size="small" sx={{ minWidth: 100 }}>
                                    <InputLabel>X</InputLabel>
                                    <Select
                                        value={scatterX}
                                        onChange={(e) => setScatterX(e.target.value)}
                                        label="X"
                                    >
                                        {selectedColumns.map((col) => (
                                            <MenuItem key={col} value={col}>{col}</MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                                <FormControl size="small" sx={{ minWidth: 100 }}>
                                    <InputLabel>Y</InputLabel>
                                    <Select
                                        value={scatterY}
                                        onChange={(e) => setScatterY(e.target.value)}
                                        label="Y"
                                    >
                                        {selectedColumns.map((col) => (
                                            <MenuItem key={col} value={col}>{col}</MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                                <FormControlLabel
                                    control={<Checkbox checked={showDensity} onChange={(e) => setShowDensity(e.target.checked)} size="small" />}
                                    label="Density"
                                />
                                {showDensity && (
                                    <>
                                        <Box sx={{ minWidth: 100, px: 1 }}>
                                            <Typography variant="caption">Smoothing: {densitySmoothing.toFixed(1)}</Typography>
                                            <Slider
                                                value={densitySmoothing}
                                                onChange={(_, v) => setDensitySmoothing(v as number)}
                                                min={0.5} max={8} step={0.5}
                                                size="small"
                                            />
                                        </Box>
                                        <Box sx={{ minWidth: 100, px: 1 }}>
                                            <Typography variant="caption">Opacity: {Math.round(densityOpacity * 100)}%</Typography>
                                            <Slider
                                                value={densityOpacity}
                                                onChange={(_, v) => setDensityOpacity(v as number)}
                                                min={0.1} max={1} step={0.05}
                                                size="small"
                                            />
                                        </Box>
                                    </>
                                )}
                            </>
                        )}
                    </Box>
                </Grid>
            </Grid>

            {/* Warnings/Info */}
            {selectedColumns.length < 2 && (
                <Alert severity="info" sx={{ mb: 2 }}>
                    Select at least 2 compositional variables for CLR analysis
                </Alert>
            )}

            {clrResult && clrResult.zerosReplaced > 0 && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    {clrResult.zerosReplaced} zero values were replaced using {zeroStrategy} strategy
                </Alert>
            )}

            {/* Plot */}
            {selectedColumns.length >= 2 && traces.length > 0 ? (
                <Paper sx={{ p: 2 }}>
                    <ExpandablePlotWrapper>
                        <Plot
                            data={traces}
                            layout={layout}
                            config={getPlotConfig({ filename: 'clr_biplot' })}
                            style={{ width: '100%' }}
                            useResizeHandler={true}
                        />
                    </ExpandablePlotWrapper>

                    {/* Summary info */}
                    <Box sx={{ mt: 2, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                        <Typography variant="caption" color="text.secondary">
                            Variables: {selectedColumns.length} | Samples: {visibleData.length}
                        </Typography>
                        {plotType === 'biplot' && biplotData && (
                            <Typography variant="caption" color="text.secondary">
                                | Total variance explained: {((biplotData.variance[0] + biplotData.variance[1]) * 100).toFixed(1)}%
                            </Typography>
                        )}
                    </Box>
                </Paper>
            ) : selectedColumns.length >= 2 ? (
                <Typography color="text.secondary">
                    {plotType === 'scatter' ? 'Select X and Y variables for CLR scatter plot' : 'Loading...'}
                </Typography>
            ) : null}
        </Box>
    );
};

export default CLRPlot;
