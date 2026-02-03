import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Plot from 'react-plotly.js';
import { useAppStore } from '../../store/appStore';
import { Box, Paper, Typography, FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import { useAttributeStore } from '../../store/attributeStore';
import { getStyleArrays, shapeToPlotlySymbol, applyOpacityToColor, getSortedIndices, sortColumnsByPriority } from '../../utils/attributeUtils';
import { buildCustomData, buildTernaryHoverTemplate } from '../../utils/tooltipUtils';
import { getPlotConfig, EXPORT_FONT_SIZES } from '../../utils/plotConfig';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';

interface TernaryRanges {
    aRange?: [number, number];
    bRange?: [number, number];
    cRange?: [number, number];
}

interface TernaryPlotProps {
    plotId: string;
}

export const TernaryPlot: React.FC<TernaryPlotProps> = ({ plotId }) => {
    const { data, columns, lockAxes, getPlotSettings, updatePlotSettings, getFilteredColumns } = useAppStore();
    const filteredColumns = getFilteredColumns();
    useAttributeStore(); // Subscribe to changes

    // Get stored settings or defaults
    const storedSettings = getPlotSettings(plotId);

    const [aAxis, setAAxisLocal] = useState<string>(storedSettings.aAxis || '');
    const [bAxis, setBAxisLocal] = useState<string>(storedSettings.bAxis || '');
    const [cAxis, setCAxisLocal] = useState<string>(storedSettings.cAxis || '');

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
    const styleArrays = getStyleArrays(data);

    // Get sorted indices for z-ordering (low-grade first, high-grade last/on top)
    const sortedIndices = getSortedIndices(styleArrays);

    // Filter and normalize data in sorted order
    const normalizedData: { a: number; b: number; c: number; idx: number }[] = [];

    for (const i of sortedIndices) {
        const d = data[i];
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
    const customData = buildCustomData(data, ternaryIndices);

    const trace: any = {
        type: 'scatterternary',
        mode: 'markers',
        a: normalizedData.map(d => d.a),
        b: normalizedData.map(d => d.b),
        c: normalizedData.map(d => d.c),
        customdata: customData,
        hovertemplate: buildTernaryHoverTemplate(aAxis, bAxis, cAxis),
        marker: {
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
                            title: { text: `Ternary: ${aAxis} - ${bAxis} - ${cAxis}`, font: { size: EXPORT_FONT_SIZES.title }, x: 0, xanchor: 'left' },
                            autosize: true,
                            height: 600,
                            font: { size: EXPORT_FONT_SIZES.tickLabels },
                            ternary: {
                                sum: 1,
                                aaxis: {
                                    title: { text: aAxis, font: { size: EXPORT_FONT_SIZES.axisTitle } },
                                    tickfont: { size: EXPORT_FONT_SIZES.tickLabels },
                                    min: lockAxes && rangesRef.current.aRange ? rangesRef.current.aRange[0] : 0
                                },
                                baxis: {
                                    title: { text: bAxis, font: { size: EXPORT_FONT_SIZES.axisTitle } },
                                    tickfont: { size: EXPORT_FONT_SIZES.tickLabels },
                                    min: lockAxes && rangesRef.current.bRange ? rangesRef.current.bRange[0] : 0
                                },
                                caxis: {
                                    title: { text: cAxis, font: { size: EXPORT_FONT_SIZES.axisTitle } },
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
