import React, { useState } from 'react';
import { Box, Paper, Typography, ToggleButtonGroup, ToggleButton, Grid, Alert } from '@mui/material';
import Plot from 'react-plotly.js';
import { useAppStore } from '../../store/appStore';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';
import { useAttributeStore } from '../../store/attributeStore';
import { getStyleArrays, sortColumnsByPriority } from '../../utils/attributeUtils';
import { getPlotConfig, EXPORT_FONT_SIZES } from '../../utils/plotConfig';
import { MultiColumnSelector } from '../../components/MultiColumnSelector';

// Maximum number of plots to render simultaneously to prevent crashes
const MAX_SIMULTANEOUS_PLOTS = 12;

export const ProbabilityPlot: React.FC = () => {
    const { data, getFilteredColumns } = useAppStore();
    const filteredColumns = getFilteredColumns();
    useAttributeStore(); // Subscribe to changes
    const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
    const [plotType, setPlotType] = useState<'probability' | 'cumulative'>('probability');
    const [xAxisType, setXAxisType] = useState<'nscore' | 'probability'>('nscore');

    const numericColumns = sortColumnsByPriority(
        filteredColumns.filter(c => c.type === 'numeric' || c.type === 'float' || c.type === 'integer')
    );

    // Get style arrays for visibility and colors
    const styleArrays = getStyleArrays(data);

    const handlePlotTypeChange = (_: React.MouseEvent<HTMLElement>, newType: 'probability' | 'cumulative' | null) => {
        if (newType !== null) {
            setPlotType(newType);
        }
    };

    const handleXAxisChange = (_: React.MouseEvent<HTMLElement>, newAxis: 'nscore' | 'probability' | null) => {
        if (newAxis !== null) {
            setXAxisType(newAxis);
        }
    };

    // Calculate normal probability plot data for a single column
    const getColumnPlotData = (columnName: string) => {
        // Get values, colors, and sort - only include visible data points
        const valuesWithColors: { value: number; color: string }[] = [];
        for (let i = 0; i < data.length; i++) {
            if (styleArrays.visible[i]) {
                const v = data[i][columnName];
                if (v != null && !isNaN(v)) {
                    valuesWithColors.push({ value: Number(v), color: styleArrays.colors[i] });
                }
            }
        }

        // Sort by value
        valuesWithColors.sort((a, b) => a.value - b.value);
        const sorted = valuesWithColors.map(v => v.value);
        const colors = valuesWithColors.map(v => v.color);
        const n = sorted.length;

        if (plotType === 'probability') {
            // Q-Q plot: Theoretical quantiles vs observed values
            const theoreticalQuantiles = sorted.map((_, i) => {
                const p = (i + 0.5) / n;
                return inverseNormalCDF(p);
            });

            const probabilities = sorted.map((_, i) => ((i + 0.5) / n) * 100);

            return {
                x: xAxisType === 'nscore' ? theoreticalQuantiles : probabilities,
                y: sorted,
                mode: 'markers',
                type: 'scatter',
                marker: { size: 6, color: colors, line: { width: 0 } },
                name: columnName
            };
        } else {
            // Cumulative frequency distribution
            const cumulative = sorted.map((_, i) => ((i + 1) / n) * 100);

            return {
                x: sorted,
                y: cumulative,
                mode: 'lines+markers',
                type: 'scatter',
                line: { color: colors[0] || '#1976d2', width: 2 },
                marker: { size: 4, color: colors, line: { width: 0 } },
                name: columnName
            };
        }
    };

    // Approximation of inverse normal CDF
    const inverseNormalCDF = (p: number): number => {
        if (p <= 0 || p >= 1) return p < 0.5 ? -6 : 6;

        const c0 = 2.515517;
        const c1 = 0.802853;
        const c2 = 0.010328;
        const d1 = 1.432788;
        const d2 = 0.189269;
        const d3 = 0.001308;

        const t = p < 0.5 ? Math.sqrt(-2 * Math.log(p)) : Math.sqrt(-2 * Math.log(1 - p));
        const numerator = c0 + c1 * t + c2 * t * t;
        const denominator = 1 + d1 * t + d2 * t * t + d3 * t * t * t;
        const z = t - numerator / denominator;

        return p < 0.5 ? -z : z;
    };

    return (
        <Box sx={{ p: 3 }}>
            <Typography variant="h5" gutterBottom>Probability Plot</Typography>

            <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <MultiColumnSelector
                    columns={numericColumns}
                    selectedColumns={selectedColumns}
                    onChange={setSelectedColumns}
                    label="Select Columns"
                />

                <ToggleButtonGroup
                    value={plotType}
                    exclusive
                    onChange={handlePlotTypeChange}
                    size="small"
                >
                    <ToggleButton value="probability">Probability Plot</ToggleButton>
                    <ToggleButton value="cumulative">Cumulative Frequency</ToggleButton>
                </ToggleButtonGroup>

                {plotType === 'probability' && (
                    <ToggleButtonGroup
                        value={xAxisType}
                        exclusive
                        onChange={handleXAxisChange}
                        size="small"
                    >
                        <ToggleButton value="nscore">N-Score (Std Dev)</ToggleButton>
                        <ToggleButton value="probability">Probability (%)</ToggleButton>
                    </ToggleButtonGroup>
                )}
            </Box>

            {selectedColumns.length > 0 && data.length > 0 ? (
                <>
                    {selectedColumns.length > MAX_SIMULTANEOUS_PLOTS && (
                        <Alert severity="warning" sx={{ mb: 2 }}>
                            Showing first {MAX_SIMULTANEOUS_PLOTS} of {selectedColumns.length} selected columns.
                            Deselect some columns to see others.
                        </Alert>
                    )}
                    <Grid container spacing={2}>
                        {selectedColumns.slice(0, MAX_SIMULTANEOUS_PLOTS).map((columnName) => {
                            const plotData = getColumnPlotData(columnName);
                            return (
                                <Grid item xs={12} sm={6} lg={4} key={columnName}>
                                    <Paper sx={{ p: 1 }}>
                                        <ExpandablePlotWrapper>
                                            <Plot
                                                data={[plotData as any]}
                                                layout={{
                                                    title: { text: columnName, font: { size: EXPORT_FONT_SIZES.title }, x: 0, xanchor: 'left' },
                                                    autosize: true,
                                                    height: 400,
                                                    font: { size: EXPORT_FONT_SIZES.tickLabels },
                                                    margin: { l: 70, r: 40, t: 60, b: 70 },
                                                    xaxis: {
                                                        title: {
                                                            text: plotType === 'probability'
                                                                ? (xAxisType === 'nscore' ? 'Theoretical Quantiles' : 'Probability (%)')
                                                                : 'Value',
                                                            font: { size: EXPORT_FONT_SIZES.axisTitle }
                                                        },
                                                        tickfont: { size: EXPORT_FONT_SIZES.tickLabels },
                                                        gridcolor: '#e0e0e0'
                                                    },
                                                    yaxis: {
                                                        title: {
                                                            text: plotType === 'probability' ? 'Value' : 'Cumulative Frequency (%)',
                                                            font: { size: EXPORT_FONT_SIZES.axisTitle }
                                                        },
                                                        tickfont: { size: EXPORT_FONT_SIZES.tickLabels },
                                                        gridcolor: '#e0e0e0'
                                                    },
                                                    plot_bgcolor: '#fafafa',
                                                    hovermode: 'closest',
                                                    showlegend: false
                                                }}
                                                config={getPlotConfig({ filename: `probability_${columnName}` })}
                                                style={{ width: '100%' }}
                                                useResizeHandler={true}
                                            />
                                        </ExpandablePlotWrapper>
                                    </Paper>
                                </Grid>
                            );
                        })}
                    </Grid>
                </>
            ) : (
                <Typography color="text.secondary">
                    Select one or more columns to display probability plots
                </Typography>
            )}
        </Box>
    );
};
