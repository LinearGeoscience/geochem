import React, { useCallback, useMemo, useRef } from 'react';
import Plot from '../../components/ThemedPlot';
import { useAppStore, useDisplayRows } from '../../store/appStore';
import { usePlotSetting } from '../../hooks/usePlotSetting';
import { useShallow } from 'zustand/react/shallow';
import { getStyleArraysColumnar, applyOpacityToColor, getSortedIndices, sortColumnsByPriority } from '../../utils/attributeUtils';
import {
    clrTransformCompleteCase,
    clrCorrelationMatrix,
    ZeroHandlingStrategy,
} from '../../utils/logratioTransforms';
import { fullPCAFromCLR } from '../../utils/calculations/pcaAnalysis';
import { detectElementFromColumnName } from '../../utils/calculations/elementNameNormalizer';
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
    Alert,
    Checkbox,
    FormControlLabel,
    Slider,
} from '@mui/material';
import { MultiColumnSelector } from '../../components/MultiColumnSelector';
import { PlotControlBar, ControlSection, SettingChip } from '../../components/plot_controls/PlotControlBar';
import { computePointDensities, DENSITY_JET_POINT_COLORSCALE } from '../../utils/densityGrid';
import { ColumnPicker } from '../../components/ColumnPicker';
import { useStyleInputs } from '../../hooks/useStyleInputs';

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

/** Point traces above this size render with WebGL (scattergl). */
const WEBGL_POINT_THRESHOLD = 2000;

interface CLRPlotProps {
    plotId: string;
}

export const CLRPlot: React.FC<CLRPlotProps> = ({ plotId }) => {
    const { columns, geochemMappings } = useAppStore(useShallow(s => ({ columns: s.columns, geochemMappings: s.geochemMappings })));
    const getDisplayColumn = useAppStore(s => s.getDisplayColumn);
    const filteredColumns = useAppStore(useShallow(s => s.getFilteredColumns()));
    // Unit-stripped element symbol (CLR is dimensionless, so axis labels and arrow tags shouldn't carry units)
    const d = useCallback((name: string): string => {
        const mapping = geochemMappings.find(m => m.originalName === name);
        const fromMapping = mapping?.userOverride ?? mapping?.detectedElement ?? null;
        if (fromMapping) return fromMapping;
        return detectElementFromColumnName(name) ?? name;
    }, [geochemMappings]);
    const displayData = useDisplayRows();
    const displayIndices = useAppStore(s => s._sampleIndicesArray);
    // Style arrays read the attribute store directly; this object is the
    // memo dependency that tracks it
    const attributeStyleState = useStyleInputs();

    // Persisted keys keep their historical names (clrColumns, clrPlotType, ...)
    const [selectedColumns, setSelectedColumns] = usePlotSetting<string[]>(plotId, 'clrColumns', []);
    const [plotType, setPlotType] = usePlotSetting<PlotType>(plotId, 'clrPlotType', 'biplot');
    const [zeroStrategy, setZeroStrategy] = usePlotSetting<ZeroHandlingStrategy>(plotId, 'zeroStrategy', 'half-min');
    const [scatterX, setScatterX] = usePlotSetting<string>(plotId, 'clrScatterX', '');
    const [scatterY, setScatterY] = usePlotSetting<string>(plotId, 'clrScatterY', '');
    const [showDensity, setShowDensity] = usePlotSetting<boolean>(plotId, 'showDensity', false);
    const [densitySmoothing, setDensitySmoothing] = usePlotSetting<number>(plotId, 'densitySmoothing', 2.0);
    const [densityOpacity, setDensityOpacity] = usePlotSetting<number>(plotId, 'densityOpacity', 0.7);
    const [densitySqrtNorm, setDensitySqrtNorm] = usePlotSetting<boolean>(plotId, 'densitySqrtNorm', false);

    // Get numeric columns (compositional data), sorted by priority
    const numericColumns = useMemo(() =>
        sortColumnsByPriority(filteredColumns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))),
        [filteredColumns]
    );

    const allNumericColumns = useMemo(() => sortColumnsByPriority(
        columns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))
    ), [columns]);

    // Get style arrays for coloring (shared, cached per attribute change)
    const styleArrays = useMemo(() => {
        if (!displayData.length) return null;
        void attributeStyleState; // style arrays read the attribute store
        return getStyleArraysColumnar(displayData.length, (name) => getDisplayColumn(name), displayIndices ?? undefined);
    }, [displayData, displayIndices, getDisplayColumn, attributeStyleState]);

    // Visible rows; the same array while the visible set is unchanged, so a colour
    // change does not rerun the CLR transform and PCA
    const visibleRef = useRef<{ src: any[]; idx: number[]; data: any[] } | null>(null);
    const visibleData = useMemo(() => {
        if (!styleArrays) return [];
        const idx: number[] = [];
        for (let i = 0; i < displayData.length; i++) if (styleArrays.visible[i]) idx.push(i);
        const prev = visibleRef.current;
        if (prev && prev.src === displayData && prev.idx.length === idx.length && prev.idx.every((v, k) => v === idx[k])) return prev.data;
        const data = idx.map(i => displayData[i]);
        visibleRef.current = { src: displayData, idx, data };
        return data;
    }, [displayData, styleArrays]);

    // Perform CLR transformation (complete-case: rows with missing values dropped)
    const clrResult = useMemo(() => {
        if (selectedColumns.length < 2 || !visibleData.length) return null;

        return clrTransformCompleteCase(visibleData, selectedColumns, { zeroStrategy });
    }, [visibleData, selectedColumns, zeroStrategy]);

    // Generate PCA biplot data via the app's canonical PCA (Jacobi on the
    // correlation matrix — replaces the old module's power-iteration simplePCA)
    const biplotData = useMemo(() => {
        if (!clrResult || plotType !== 'biplot') return null;

        const pca = fullPCAFromCLR(clrResult.transformed, selectedColumns, 2);
        return {
            scores: pca.scores,
            loadings: pca.loadings,
            // downstream display multiplies by 100; fullPCA reports percent already
            variance: pca.varianceExplained.map(v => v / 100),
        };
    }, [clrResult, plotType, selectedColumns]);

    // Generate correlation matrix
    const corrMatrix = useMemo(() => {
        if (!clrResult || plotType !== 'correlation') return null;

        return clrCorrelationMatrix(clrResult.transformed);
    }, [clrResult, plotType]);

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

            // Map original (displayData) indices to CLR row indices.
            // After the complete-case filter, only rows where every selected element is non-null
            // make it into the CLR matrix — clrResult.keptIndices[j] is the position WITHIN
            // visibleData that produced CLR row j.
            const visibleIndexToClrIndex = new Map<number, number>();
            clrResult.keptIndices.forEach((visiblePos, clrIdx) => {
                const origIdx = visibleIndices[visiblePos];
                if (origIdx !== undefined) visibleIndexToClrIndex.set(origIdx, clrIdx);
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
                type: x.length > WEBGL_POINT_THRESHOLD ? 'scattergl' : 'scatter',
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

            // Same mapping logic as the biplot — account for complete-case filtering
            const visibleIndexToClrIndex = new Map<number, number>();
            clrResult.keptIndices.forEach((visiblePos, clrIdx) => {
                const origIdx = visibleIndices[visiblePos];
                if (origIdx !== undefined) visibleIndexToClrIndex.set(origIdx, clrIdx);
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
                const result = computePointDensities(x, y, { smoothingSigma: densitySmoothing, sqrtNorm: densitySqrtNorm });
                if (result) clrDensity = result.densities;
            }

            // Apply density z-ordering if active
            let traceX = x;
            let traceY = y;
            let traceSizes = sizes;

            if (clrDensity) {
                const order = clrDensity.map((_, i) => i).sort((a, b) => clrDensity![a] - clrDensity![b]);
                traceX = order.map(i => x[i]);
                traceY = order.map(i => y[i]);
                traceSizes = order.map(i => sizes[i]);
                clrDensity = order.map(i => clrDensity![i]);
            }

            return [{
                type: traceX.length > WEBGL_POINT_THRESHOLD ? 'scattergl' : 'scatter',
                mode: 'markers',
                x: traceX,
                y: traceY,
                marker: clrDensity ? {
                    color: clrDensity,
                    colorscale: DENSITY_JET_POINT_COLORSCALE,
                    showscale: false,
                    opacity: densityOpacity,
                    size: traceSizes,
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
    }, [clrResult, biplotData, corrMatrix, plotType, scatterX, scatterY, styleArrays, selectedColumns, displayData, showDensity, densitySmoothing, densityOpacity, densitySqrtNorm, d]);

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
    }, [plotType, biplotData, scatterX, scatterY, d]);

    return (
        <Box sx={{ p: 1 }}>
            <Typography variant="h6" gutterBottom>CLR (Centered Log-Ratio) Plot</Typography>

            {/* Controls */}
            <PlotControlBar
                primary={<>
                    <MultiColumnSelector
                        columns={numericColumns}
                        selectedColumns={selectedColumns}
                        onChange={setSelectedColumns}
                        label="Compositional Variables"
                        allColumns={allNumericColumns}
                    />
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
                            <ColumnPicker label="X" value={scatterX} onChange={setScatterX} include={selectedColumns} useColumnFilter={false} minWidth={120} />
                            <ColumnPicker label="Y" value={scatterY} onChange={setScatterY} include={selectedColumns} useColumnFilter={false} minWidth={120} />
                        </>
                    )}
                </>}
                settingsActive={zeroStrategy !== 'half-min' || showDensity}
                summary={<>
                    {zeroStrategy !== 'half-min' && (
                        <SettingChip
                            label={`Zeros: ${ZERO_STRATEGIES.find(s => s.id === zeroStrategy)?.name ?? zeroStrategy}`}
                            onDelete={() => setZeroStrategy('half-min')}
                        />
                    )}
                    {plotType === 'scatter' && showDensity && <SettingChip label="Density" onDelete={() => setShowDensity(false)} />}
                </>}
                settings={<>
                    <ControlSection label="Transformation">
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
                    </ControlSection>
                    {plotType === 'scatter' && selectedColumns.length >= 2 && (
                        <ControlSection label="Overlays">
                            <FormControlLabel
                                control={<Checkbox checked={showDensity} onChange={(e) => setShowDensity(e.target.checked)} size="small" />}
                                label="Density"
                            />
                            {showDensity && (
                                <Box sx={{ ml: 3.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                    <Typography variant="caption">Smoothing: {densitySmoothing.toFixed(1)}</Typography>
                                    <Slider
                                        value={densitySmoothing}
                                        onChange={(_, v) => setDensitySmoothing(v as number)}
                                        min={0.5} max={8} step={0.5}
                                        size="small"
                                    />
                                    <Typography variant="caption">Opacity: {Math.round(densityOpacity * 100)}%</Typography>
                                    <Slider
                                        value={densityOpacity}
                                        onChange={(_, v) => setDensityOpacity(v as number)}
                                        min={0} max={1} step={0.05}
                                        size="small"
                                    />
                                    <Tooltip title="Spread color gradient across medium-density regions">
                                        <FormControlLabel
                                            control={<Checkbox checked={densitySqrtNorm} onChange={(e) => setDensitySqrtNorm(e.target.checked)} size="small" />}
                                            label={<Typography variant="body2">Sqrt Scale</Typography>}
                                        />
                                    </Tooltip>
                                </Box>
                            )}
                        </ControlSection>
                    )}
                </>}
            />

            {/* Warnings/Info */}
            {selectedColumns.length < 2 && (
                <Alert severity="info" sx={{ mb: 2 }}>
                    Select at least 2 compositional variables for CLR analysis
                </Alert>
            )}

            {clrResult && clrResult.nDropped > 0 && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    {clrResult.nDropped} sample{clrResult.nDropped === 1 ? '' : 's'} dropped from the plot — at least one selected element was missing/null.
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
                            Variables: {selectedColumns.length} | Samples used: {clrResult?.transformed.length ?? 0} of {visibleData.length}
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
