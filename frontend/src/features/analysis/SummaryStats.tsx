import React, { useState, useCallback } from 'react';
import { Box, Paper, Typography, FormControl, InputLabel, Select, MenuItem, OutlinedInput, Chip, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, CircularProgress, Button, Stack } from '@mui/material';
import { SelectChangeEvent } from '@mui/material';
import Plot from 'react-plotly.js';
import { useAppStore } from '../../store/appStore';
import { useAttributeStore } from '../../store/attributeStore';
import { getStyleArrays, sortColumnsByPriority } from '../../utils/attributeUtils';

interface Stats {
    count: number;
    min: number | null;
    max: number | null;
    mean: number | null;
    median: number | null;
    std: number | null;
    p10: number | null;
    p25: number | null;
    p75: number | null;
    p90: number | null;
}

// Helper function to calculate percentile
const percentile = (arr: number[], p: number): number | null => {
    if (arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
};

// Helper function to calculate standard deviation
const standardDeviation = (arr: number[], mean: number): number | null => {
    if (arr.length < 2) return null;
    const squaredDiffs = arr.map(x => Math.pow(x - mean, 2));
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / (arr.length - 1);
    return Math.sqrt(avgSquaredDiff);
};

export const SummaryStats: React.FC = () => {
    const { columns, data, statsSelectedColumns, setStatsSelectedColumns } = useAppStore();
    useAttributeStore(); // Subscribe to changes
    const [stats, setStats] = useState<Record<string, Stats>>({});
    const [loading, setLoading] = useState(false);

    // Get style arrays for visibility filtering
    const styleArrays = getStyleArrays(data);

    // Calculate statistics client-side
    const calculateStats = useCallback(() => {
        if (statsSelectedColumns.length === 0) return;
        setLoading(true);

        // Get current visibility
        const currentStyleArrays = getStyleArrays(data);

        // Use setTimeout to allow UI to update before heavy computation
        setTimeout(() => {
            try {
                const result: Record<string, Stats> = {};

                for (const col of statsSelectedColumns) {
                    // Extract numeric values for this column - only visible points
                    const values: number[] = [];
                    for (let i = 0; i < data.length; i++) {
                        if (currentStyleArrays.visible[i]) {
                            const val = data[i][col];
                            if (val != null && !isNaN(Number(val))) {
                                values.push(Number(val));
                            }
                        }
                    }

                    if (values.length === 0) {
                        result[col] = {
                            count: 0,
                            min: null,
                            max: null,
                            mean: null,
                            median: null,
                            std: null,
                            p10: null,
                            p25: null,
                            p75: null,
                            p90: null
                        };
                        continue;
                    }

                    const sorted = [...values].sort((a, b) => a - b);
                    const sum = values.reduce((a, b) => a + b, 0);
                    const mean = sum / values.length;

                    result[col] = {
                        count: values.length,
                        min: sorted[0],
                        max: sorted[sorted.length - 1],
                        mean: mean,
                        median: percentile(sorted, 50),
                        std: standardDeviation(values, mean),
                        p10: percentile(sorted, 10),
                        p25: percentile(sorted, 25),
                        p75: percentile(sorted, 75),
                        p90: percentile(sorted, 90)
                    };
                }

                setStats(result);
            } catch (error) {
                console.error('Failed to calculate statistics:', error);
            } finally {
                setLoading(false);
            }
        }, 10);
    }, [statsSelectedColumns, data]);

    const handleColumnChange = (event: SelectChangeEvent<typeof statsSelectedColumns>) => {
        const value = event.target.value;
        setStatsSelectedColumns(typeof value === 'string' ? value.split(',') : value);
    };

    const numericColumns = sortColumnsByPriority(
        columns.filter(c => c.type === 'numeric' || c.type === 'float' || c.type === 'integer')
    );

    const handleSelectAll = () => {
        setStatsSelectedColumns(numericColumns.map(c => c.name));
    };

    const handleClearAll = () => {
        setStatsSelectedColumns([]);
    };

    const formatNumber = (num: number | null) => {
        if (num === null) return 'N/A';
        if (Math.abs(num) < 0.01 || Math.abs(num) > 10000) {
            return num.toExponential(3);
        }
        return num.toFixed(3);
    };

    return (
        <Box sx={{ p: 3 }}>
            <Typography variant="h5" gutterBottom>Summary Statistics</Typography>

            <Box sx={{ display: 'flex', gap: 2, mb: 3, alignItems: 'flex-start' }}>
                <Stack spacing={1} sx={{ minWidth: 300, maxWidth: 600, flexGrow: 1 }}>
                    <FormControl>
                        <InputLabel>Select Columns</InputLabel>
                        <Select
                            multiple
                            value={statsSelectedColumns}
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
                <Button
                    variant="contained"
                    onClick={calculateStats}
                    disabled={statsSelectedColumns.length === 0 || loading}
                    sx={{ mt: 0.5 }}
                >
                    Calculate
                </Button>
            </Box>

            {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                    <CircularProgress />
                </Box>
            ) : (
                <>
                    <TableContainer component={Paper} sx={{ mb: 4 }}>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell><strong>Variable</strong></TableCell>
                                    <TableCell align="right"><strong>Count</strong></TableCell>
                                    <TableCell align="right"><strong>Min</strong></TableCell>
                                    <TableCell align="right"><strong>Max</strong></TableCell>
                                    <TableCell align="right"><strong>Mean</strong></TableCell>
                                    <TableCell align="right"><strong>Median</strong></TableCell>
                                    <TableCell align="right"><strong>Std Dev</strong></TableCell>
                                    <TableCell align="right"><strong>P10</strong></TableCell>
                                    <TableCell align="right"><strong>P90</strong></TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {Object.entries(stats).map(([colName, colStats]) => (
                                    <TableRow key={colName} hover>
                                        <TableCell>{colName}</TableCell>
                                        <TableCell align="right">{colStats.count}</TableCell>
                                        <TableCell align="right">{formatNumber(colStats.min)}</TableCell>
                                        <TableCell align="right">{formatNumber(colStats.max)}</TableCell>
                                        <TableCell align="right">{formatNumber(colStats.mean)}</TableCell>
                                        <TableCell align="right">{formatNumber(colStats.median)}</TableCell>
                                        <TableCell align="right">{formatNumber(colStats.std)}</TableCell>
                                        <TableCell align="right">{formatNumber(colStats.p10)}</TableCell>
                                        <TableCell align="right">{formatNumber(colStats.p90)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>

                    {/* Histograms */}
                    {statsSelectedColumns.length > 0 && Object.keys(stats).length > 0 && (
                        <>
                            <Typography variant="h6" gutterBottom sx={{ mt: 4 }}>Distributions</Typography>
                            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 2 }}>
                                {statsSelectedColumns.map(col => {
                                    // Only include visible data points
                                    const values: number[] = [];
                                    for (let i = 0; i < data.length; i++) {
                                        if (styleArrays.visible[i]) {
                                            const v = data[i][col];
                                            if (v != null && !isNaN(v)) {
                                                values.push(Number(v));
                                            }
                                        }
                                    }
                                    return (
                                        <Paper key={col} sx={{ p: 2 }}>
                                            <Plot
                                                data={[{
                                                    x: values,
                                                    type: 'histogram',
                                                    marker: { color: '#1976d2', line: { width: 0 } },
                                                    nbinsx: 30
                                                } as any]}
                                                layout={{
                                                    title: { text: col },
                                                    autosize: true,
                                                    height: 300,
                                                    margin: { l: 50, r: 20, t: 40, b: 40 },
                                                    xaxis: { title: { text: col } },
                                                    yaxis: { title: { text: 'Frequency' } }
                                                }}
                                                config={{ displayModeBar: false }}
                                                style={{ width: '100%' }}
                                                useResizeHandler={true}
                                            />
                                        </Paper>
                                    );
                                })}
                            </Box>
                        </>
                    )}
                </>
            )}
        </Box>
    );
};

