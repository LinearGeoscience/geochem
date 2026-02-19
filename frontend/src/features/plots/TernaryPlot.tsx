import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Plot from 'react-plotly.js';
import { useAppStore } from '../../store/appStore';
import { Box, Paper, Typography, FormControl, InputLabel, Select, MenuItem, Checkbox, FormControlLabel, Slider } from '@mui/material';
import { useAttributeStore } from '../../store/attributeStore';
import { getStyleArrays, shapeToPlotlySymbol, applyOpacityToColor, getSortedIndices, sortColumnsByPriority, getColumnDisplayName } from '../../utils/attributeUtils';
import { buildCustomData, buildTernaryHoverTemplate } from '../../utils/tooltipUtils';
import { getPlotConfig, EXPORT_FONT_SIZES } from '../../utils/plotConfig';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';
import { computeTernaryDensities, DENSITY_JET_POINT_COLORSCALE } from '../../utils/densityGrid';

interface TernaryRanges {
    aRange?: [number, number];
    bRange?: [number, number];
    cRange?: [number, number];
}

interface TernaryPlotProps {
    plotId: string;
}

export const TernaryPlot: React.FC<TernaryPlotProps> = ({ plotId }) => {
    const { data, columns, lockAxes, getPlotSettings, updatePlotSettings, getFilteredColumns, getDisplayData, getDisplayIndices, sampleIndices } = useAppStore();
    const filteredColumns = getFilteredColumns();
    const d = (name: string) => getColumnDisplayName(columns, name);
    useAttributeStore(); // Subscribe to changes

    const displayData = useMemo(() => getDisplayData(), [data, sampleIndices]);
    const displayIndices = useMemo(() => getDisplayIndices(), [data, sampleIndices]);

    // Get stored settings or defaults
    const storedSettings = getPlotSettings(plotId);

    const [aAxis, setAAxisLocal] = useState<string>(storedSettings.aAxis || '');
    const [bAxis, setBAxisLocal] = useState<string>(storedSettings.bAxis || '');
    const [cAxis, setCAxisLocal] = useState<string>(storedSettings.cAxis || '');
    const [showDensity, setShowDensityLocal] = useState<boolean>(storedSettings.showDensity || false);
    const [densitySmoothing, setDensitySmoothingLocal] = useState<number>(storedSettings.densitySmoothing ?? 2.0);
    const [densityOpacity, setDensityOpacityLocal] = useState<number>(storedSettings.densityOpacity ?? 0.7);

    // Wrapper functions to persist settings
    const setAAxis = (axis: string) => {
        setAAxisLocal(axis);
        updatePlotSettings(plotId, { aAxis: axis });
    };
    const setBAxis = (axis: string) => {
        setBAxisLocal(axis);
        updatePlotSettings(plotId, { bAxis: axis });
    };
    const setCAxis = (axis: string) => {
        setCAxisLocal(axis);
        updatePlotSettings(plotId, { cAxis: axis });
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

    const rangesRef = useRef<TernaryRanges>({});

    const handleRelayout = useCallback((event: any) => {
        // Capture ternary axis changes
        if (event['ternary.aaxis.min'] !== undefined) {
            rangesRef.current = {
                aRange: [event['ternary.aaxis.min'], event['ternary.aaxis.max'] ?? 1],
                bRange: [event['ternary.baxis.min'] ?? 0, event['ternary.baxis.max'] ?? 1],
                cRange: [event['ternary.caxis.min'] ?? 0, event['ternary.caxis.max'] ?? 1],
            };
        }
    }, []);

    const numericColumns = useMemo(() =>
        sortColumnsByPriority(
            filteredColumns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))
        ),
        [columns]
    );

    useEffect(() => {
        if (columns.length > 0 && !aAxis && !bAxis && !cAxis && !storedSettings.aAxis && !storedSettings.bAxis && !storedSettings.cAxis) {
            if (numericColumns.length >= 3) {
                setAAxis(numericColumns[0].name);
                setBAxis(numericColumns[1].name);
                setCAxis(numericColumns[2].name);
            }
        }
    }, [columns, numericColumns, storedSettings]);

    // Render axis selectors for the early return case
    const axisSelectors = (
        <Box sx={{ mb: 3, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <FormControl sx={{ minWidth: 150 }}>
                <InputLabel>A-Axis (Top)</InputLabel>
                <Select value={aAxis} onChange={(e) => setAAxis(e.target.value)} label="A-Axis (Top)">
                    {numericColumns.map(col => (
                        <MenuItem key={col.name} value={col.name}>{col.alias || col.name}</MenuItem>
                    ))}
                </Select>
            </FormControl>

            <FormControl sx={{ minWidth: 150 }}>
                <InputLabel>B-Axis (Bottom Left)</InputLabel>
                <Select value={bAxis} onChange={(e) => setBAxis(e.target.value)} label="B-Axis (Bottom Left)">
                    {numericColumns.map(col => (
                        <MenuItem key={col.name} value={col.name}>{col.alias || col.name}</MenuItem>
                    ))}
                </Select>
            </FormControl>

            <FormControl sx={{ minWidth: 150 }}>
                <InputLabel>C-Axis (Bottom Right)</InputLabel>
                <Select value={cAxis} onChange={(e) => setCAxis(e.target.value)} label="C-Axis (Bottom Right)">
                    {numericColumns.map(col => (
                        <MenuItem key={col.name} value={col.name}>{col.alias || col.name}</MenuItem>
                    ))}
                </Select>
            </FormControl>

            <FormControlLabel
                control={<Checkbox checked={showDensity} onChange={(e) => setShowDensity(e.target.checked)} size="small" />}
                label="Density Colors"
            />

            {showDensity && (
                <>
                    <Box sx={{ minWidth: 120, px: 1 }}>
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
                    <Box sx={{ minWidth: 120, px: 1 }}>
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
        </Box>
    );

    if (!data.length || !aAxis || !bAxis || !cAxis) {
        return (
            <Box sx={{ p: 2 }}>
                {axisSelectors}
                <Typography color="text.secondary">Select A, B, and C axes to display ternary plot</Typography>
            </Box>
        );
    }

    // Get styles from attribute store (includes emphasis calculations)
    const styleArrays = getStyleArrays(displayData, displayIndices ?? undefined);

    // Get sorted indices for z-ordering (low-grade first, high-grade last/on top)
    const sortedIndices = getSortedIndices(styleArrays);

    // Filter and normalize data in sorted order
    const normalizedData: { a: number; b: number; c: number; idx: number }[] = [];

    for (const i of sortedIndices) {
        const d = displayData[i];
        const a = Number(d[aAxis]) || 0;
        const b = Number(d[bAxis]) || 0;
        const c = Number(d[cAxis]) || 0;
        const sum = a + b + c;

        if (sum > 0) {
            normalizedData.push({
                a: a / sum,
                b: b / sum,
                c: c / sum,
                idx: i
            });
        }
    }

    // Build customdata for hover tooltips
    const ternaryIndices = normalizedData.map(d => d.idx);
    const customData = buildCustomData(displayData, ternaryIndices, displayIndices ?? undefined);

    // Compute density coloring if enabled
    const densityResult = showDensity ? computeTernaryDensities(
        normalizedData.map(d => d.a),
        normalizedData.map(d => d.b),
        normalizedData.map(d => d.c),
        { smoothingSigma: densitySmoothing }
    ) : null;

    const trace: any = {
        type: 'scatterternary',
        mode: 'markers',
        a: normalizedData.map(d => d.a),
        b: normalizedData.map(d => d.b),
        c: normalizedData.map(d => d.c),
        customdata: customData,
        hovertemplate: buildTernaryHoverTemplate(d(aAxis), d(bAxis), d(cAxis)),
        marker: densityResult ? {
            size: normalizedData.map(d => styleArrays.sizes[d.idx]),
            color: densityResult.densities,
            colorscale: DENSITY_JET_POINT_COLORSCALE,
            showscale: false,
            opacity: densityOpacity,
            symbol: normalizedData.map(d => shapeToPlotlySymbol(styleArrays.shapes[d.idx])),
            line: { width: 0 }
        } : {
            size: normalizedData.map(d => styleArrays.sizes[d.idx]),
            color: normalizedData.map(d => applyOpacityToColor(styleArrays.colors[d.idx], styleArrays.opacity[d.idx])),
            symbol: normalizedData.map(d => shapeToPlotlySymbol(styleArrays.shapes[d.idx])),
            line: { width: 0 }
        }
    };

    return (
        <Box sx={{ p: 2 }}>
            {axisSelectors}

            <Paper sx={{ p: 2 }}>
                <ExpandablePlotWrapper>
                    <Plot
                        data={[trace]}
                        layout={{
                            title: { text: `Ternary: ${d(aAxis)} - ${d(bAxis)} - ${d(cAxis)}`, font: { size: EXPORT_FONT_SIZES.title }, x: 0, xanchor: 'left' },
                            autosize: true,
                            height: 600,
                            font: { size: EXPORT_FONT_SIZES.tickLabels },
                            ternary: {
                                sum: 1,
                                aaxis: {
                                    title: { text: d(aAxis), font: { size: EXPORT_FONT_SIZES.axisTitle } },
                                    tickfont: { size: EXPORT_FONT_SIZES.tickLabels },
                                    min: lockAxes && rangesRef.current.aRange ? rangesRef.current.aRange[0] : 0
                                },
                                baxis: {
                                    title: { text: d(bAxis), font: { size: EXPORT_FONT_SIZES.axisTitle } },
                                    tickfont: { size: EXPORT_FONT_SIZES.tickLabels },
                                    min: lockAxes && rangesRef.current.bRange ? rangesRef.current.bRange[0] : 0
                                },
                                caxis: {
                                    title: { text: d(cAxis), font: { size: EXPORT_FONT_SIZES.axisTitle } },
                                    tickfont: { size: EXPORT_FONT_SIZES.tickLabels },
                                    min: lockAxes && rangesRef.current.cRange ? rangesRef.current.cRange[0] : 0
                                }
                            },
                            margin: { l: 80, r: 80, t: 80, b: 80 },
                            uirevision: lockAxes ? 'locked' : Date.now()
                        }}
                        config={getPlotConfig({ filename: `ternary_${aAxis}_${bAxis}_${cAxis}` })}
                        style={{ width: '100%' }}
                        useResizeHandler={true}
                        onRelayout={handleRelayout}
                    />
                </ExpandablePlotWrapper>
            </Paper>
        </Box>
    );
};
