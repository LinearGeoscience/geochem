import React, { useState, useCallback } from 'react';
import { Box, Paper, Typography, FormControl, InputLabel, Select, MenuItem, OutlinedInput, Chip, ToggleButtonGroup, ToggleButton, CircularProgress, Button, Stack, Alert } from '@mui/material';
import { SelectChangeEvent } from '@mui/material';
import Plot from 'react-plotly.js';
import { useAppStore, COLUMN_FILTER_LABELS } from '../../store/appStore';
import { useAttributeStore } from '../../store/attributeStore';
import { getStyleArrays, sortColumnsByPriority } from '../../utils/attributeUtils';
import { getPlotConfig, EXPORT_FONT_SIZES } from '../../utils/plotConfig';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';

// Helper function to calculate Pearson correlation
const pearsonCorrelation = (x: number[], y: number[]): number => {
    const n = x.length;
    if (n === 0) return 0;

    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
    const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);
    const sumY2 = y.reduce((acc, yi) => acc + yi * yi, 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

    if (denominator === 0) return 0;
    return numerator / denominator;
};

// Helper function to calculate Spearman rank correlation
const spearmanCorrelation = (x: number[], y: number[]): number => {
    const n = x.length;
    if (n === 0) return 0;

    // Convert to ranks
    const rank = (arr: number[]): number[] => {
        const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
        const ranks = new Array(n);

        let i = 0;
        while (i < n) {
            let j = i;
            while (j < n - 1 && sorted[j].v === sorted[j + 1].v) j++;
            const avgRank = (i + j + 2) / 2; // Average rank for ties
            for (let k = i; k <= j; k++) {
                ranks[sorted[k].i] = avgRank;
            }
            i = j + 1;
        }
        return ranks;
    };

    const rankX = rank(x);
    const rankY = rank(y);

    return pearsonCorrelation(rankX, rankY);
};

export const CorrelationMatrix: React.FC = () => {
    const { data, correlationSelectedColumns, setCorrelationSelectedColumns, getFilteredColumns, columnFilter } = useAppStore();
    const filteredColumns = getFilteredColumns();
    useAttributeStore(); // Subscribe to changes
    const [method, setMethod] = useState<'pearson' | 'spearman'>('pearson');
    const [correlationData, setCorrelationData] = useState<{ columns: string[], matrix: number[][] } | null>(null);
    const [loading, setLoading] = useState(false);

    // Calculate correlation matrix client-side
    const calculateCorrelation = useCallback(() => {
        if (correlationSelectedColumns.length < 2) return;
        setLoading(true);

        // Get current visibility
        const currentStyleArrays = getStyleArrays(data);

        // Use setTimeout to allow UI to update before heavy computation
        setTimeout(() => {
            try {
                const cols = correlationSelectedColumns;

                // Extract column data as arrays of numbers
                const columnData: Record<string, number[]> = {};

                // First pass: collect all valid numeric values for each column
                for (const col of cols) {
                    columnData[col] = [];
                }

                // Get indices where ALL selected columns have valid values AND data is visible
                const validIndices: number[] = [];
                for (let i = 0; i < data.length; i++) {
                    // Skip invisible points
                    if (!currentStyleArrays.visible[i]) continue;

                    let allValid = true;
                    for (const col of cols) {
                        const val = data[i][col];
                        if (val == null || isNaN(Number(val))) {
                            allValid = false;
                            break;
                        }
                    }
                    if (allValid) validIndices.push(i);
                }

                // Extract values only for valid indices (pairwise complete)
                for (const col of cols) {
                    columnData[col] = validIndices.map(i => Number(data[i][col]));
                }

                // Calculate correlation matrix
                const matrix: number[][] = [];
                const correlationFn = method === 'pearson' ? pearsonCorrelation : spearmanCorrelation;

                for (let i = 0; i < cols.length; i++) {
                    const row: number[] = [];
                    for (let j = 0; j < cols.length; j++) {
                        if (i === j) {
                            row.push(1); // Diagonal is always 1
                        } else {
                            const corr = correlationFn(columnData[cols[i]], columnData[cols[j]]);
                            row.push(Math.round(corr * 1000) / 1000); // Round to 3 decimal places
                        }
                    }
                    matrix.push(row);
                }

                setCorrelationData({ columns: cols, matrix });
            } catch (error) {
                console.error('Failed to calculate correlation matrix:', error);
            } finally {
                setLoading(false);
            }
        }, 10);
    }, [correlationSelectedColumns, data, method]);

    const handleColumnChange = (event: SelectChangeEvent<typeof correlationSelectedColumns>) => {
        const value = event.target.value;
        setCorrelationSelectedColumns(typeof value === 'string' ? value.split(',') : value);
    };

    const handleMethodChange = (_: React.MouseEvent<HTMLElement>, newMethod: 'pearson' | 'spearman' | null) => {
        if (newMethod !== null) {
            setMethod(newMethod);
        }
    };

    const numericColumns = sortColumnsByPriority(
        filteredColumns.filter(c => c.type === 'numeric' || c.type === 'float' || c.type === 'integer')
    );

    const handleSelectAll = () => {
        setCorrelationSelectedColumns(numericColumns.map(c => c.name));
    };

    const handleClearAll = () => {
        setCorrelationSelectedColumns([]);
    };

    return (
        <Box sx={{ p: 3 }}>
            <Typography variant="h5" gutterBottom>Correlation Matrix</Typography>

            {columnFilter !== 'all' && (
                <Alert severity="info" sx={{ mb: 2 }}>
                    Showing <strong>{COLUMN_FILTER_LABELS[columnFilter]}</strong> columns only.
                    Change the filter in the top toolbar to see other columns.
                </Alert>
            )}

            <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <Stack spacing={1} sx={{ minWidth: 300, maxWidth: 600, flexGrow: 1 }}>
                    <FormControl>
                        <InputLabel>Select Columns</InputLabel>
                        <Select
                            multiple
                            value={correlationSelectedColumns}
                            onChange={handleColumnChange}
                            input={<OutlinedInput label="Select Columns" />}
                            renderValue={(selected) => (
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                    {selected.map((value) => (
                                        <Chip key={value} label={value} size="small" />
                                    ))}
                                </Box>
                            )}
                        >
                            {numericColumns.map((col) => (
                                <MenuItem key={col.name} value={col.name}>
                                    {col.alias || col.name}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <Button size="small" variant="outlined" onClick={handleSelectAll}>
                            Select All
                        </Button>
                        <Button size="small" variant="outlined" onClick={handleClearAll}>
                            Clear All
                        </Button>
                    </Box>
                </Stack>

                <ToggleButtonGroup
                    value={method}
                    exclusive
                    onChange={handleMethodChange}
                    size="small"
                >
                    <ToggleButton value="pearson">Pearson</ToggleButton>
                    <ToggleButton value="spearman">Spearman</ToggleButton>
                </ToggleButtonGroup>

                <Button
                    variant="contained"
                    onClick={calculateCorrelation}
                    disabled={correlationSelectedColumns.length < 2 || loading}
                >
                    Calculate
                </Button>
            </Box>

            {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                    <CircularProgress />
                </Box>
            ) : correlationData ? (
                <Paper sx={{ p: 2, display: 'inline-block' }}>
                    <ExpandablePlotWrapper>
                        <Plot
                            data={[{
                                z: correlationData.matrix,
                                x: correlationData.columns,
                                y: correlationData.columns,
                                type: 'heatmap',
                                colorscale: [
                                    [0, 'rgb(33,102,172)'],      // Strong negative - dark blue
                                    [0.25, 'rgb(103,169,207)'],  // Moderate negative - light blue
                                    [0.5, 'rgb(247,247,247)'],   // Zero - off-white
                                    [0.75, 'rgb(239,138,98)'],   // Moderate positive - light red
                                    [1, 'rgb(178,24,43)']        // Strong positive - dark red
                                ],
                                zmin: -1,
                                zmax: 1,
                                hoverongaps: false,
                                hovertemplate: '%{y} vs %{x}<br>Correlation: %{z:.2f}<extra></extra>',
                                showscale: true,
                                colorbar: {
                                    title: { text: '', font: { size: 12 } },
                                    tickvals: [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1],
                                    ticktext: ['-1.00', '-0.75', '-0.50', '-0.25', '0.00', '0.25', '0.50', '0.75', '1.00'],
                                    len: 0.9,
                                    thickness: 15,
                                }
                            }]}
                            layout={{
                                title: {
                                    text: 'Geochemical Correlation Matrix',
                                    font: { size: EXPORT_FONT_SIZES.title }
                                },
                                autosize: false,
                                width: Math.max(500, correlationData.columns.length * 50 + 150),
                                height: Math.max(500, correlationData.columns.length * 50 + 100),
                                font: { size: EXPORT_FONT_SIZES.tickLabels },
                                margin: { l: 70, r: 80, t: 70, b: 70 },
                                xaxis: {
                                    tickangle: 0,
                                    side: 'bottom',
                                    tickfont: { size: EXPORT_FONT_SIZES.tickLabels },
                                },
                                yaxis: {
                                    autorange: 'reversed',
                                    tickfont: { size: EXPORT_FONT_SIZES.tickLabels },
                                },
                                annotations: correlationData.matrix.flatMap((row, i) =>
                                    row.map((value, j) => ({
                                        x: correlationData.columns[j],
                                        y: correlationData.columns[i],
                                        text: value.toFixed(2),
                                        font: {
                                            size: correlationData.columns.length > 15 ? 8 : 10,
                                            color: Math.abs(value) > 0.5 ? 'white' : 'black'
                                        },
                                        showarrow: false,
                                    }))
                                ),
                            }}
                            config={getPlotConfig({ filename: 'correlation_matrix' })}
                        />
                    </ExpandablePlotWrapper>
                </Paper>
            ) : (
                <Typography color="text.secondary">
                    Select at least 2 columns to view correlation matrix
                </Typography>
            )}
        </Box>
    );
};
