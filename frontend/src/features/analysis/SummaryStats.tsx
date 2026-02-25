import React, { useState, useCallback, useMemo } from 'react';
import { Box, Paper, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, CircularProgress, Button, ToggleButtonGroup, ToggleButton, Checkbox, FormControlLabel, Tooltip } from '@mui/material';
import Plot from 'react-plotly.js';
import { useAppStore } from '../../store/appStore';
import { useAttributeStore } from '../../store/attributeStore';
import { getStyleArrays, sortColumnsByPriority } from '../../utils/attributeUtils';
import { MultiColumnSelector } from '../../components/MultiColumnSelector';

interface Stats {
    count: number;
    missing: number;
    min: number | null;
    max: number | null;
    mean: number | null;
    geometricMean: number | null;
    median: number | null;
    std: number | null;
    cv: number | null;
    skewness: number | null;
    kurtosis: number | null;
    normalityP: number | null;
    p5: number | null;
    p10: number | null;
    p25: number | null;
    p50: number | null;
    p75: number | null;
    p90: number | null;
    p95: number | null;
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

// Geometric mean: exp(mean(ln(positive values)))
const calcGeometricMean = (arr: number[]): number | null => {
    const positives = arr.filter(v => v > 0);
    if (positives.length === 0) return null;
    const sumLn = positives.reduce((acc, v) => acc + Math.log(v), 0);
    return Math.exp(sumLn / positives.length);
};

// Fisher's adjusted skewness
// G1 = n² / ((n-1)(n-2)) * m3  where m3 = (1/n) * Σ[(xi-x̄)/s]³
const calcSkewness = (arr: number[], mean: number, std: number): number | null => {
    const n = arr.length;
    if (n < 3 || std === 0) return null;
    const m3 = arr.reduce((acc, v) => acc + Math.pow((v - mean) / std, 3), 0) / n;
    return (n * n * m3) / ((n - 1) * (n - 2));
};

// Excess kurtosis
const calcKurtosis = (arr: number[], mean: number, std: number): number | null => {
    const n = arr.length;
    if (n < 4 || std === 0) return null;
    const m4 = arr.reduce((acc, v) => acc + Math.pow((v - mean) / std, 4), 0) / n;
    // Excess kurtosis: G2 = n²(n+1)/((n-1)(n-2)(n-3)) * m4 - 3(n-1)²/((n-2)(n-3))
    const kurt = ((n + 1) * n * n * m4) / ((n - 1) * (n - 2) * (n - 3)) - 3 * (n - 1) * (n - 1) / ((n - 2) * (n - 3));
    return kurt;
};

// Simple KDE (Gaussian kernel)
const computeKDE = (values: number[], nPoints: number = 200): { x: number[], y: number[] } => {
    if (values.length === 0) return { x: [], y: [] };
    const sorted = [...values].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const range = max - min;
    if (range === 0) return { x: [min], y: [1] };

    // Silverman's rule of thumb for bandwidth
    const n = values.length;
    const std = Math.sqrt(values.reduce((s, v) => s + (v - values.reduce((a, b) => a + b, 0) / n) ** 2, 0) / (n - 1));
    const iqr = (percentile(sorted, 75) ?? max) - (percentile(sorted, 25) ?? min);
    const bandwidth = 0.9 * Math.min(std, iqr / 1.34) * Math.pow(n, -0.2);
    if (bandwidth <= 0) return { x: [min], y: [1] };

    const pad = range * 0.1;
    const xMin = min - pad;
    const xMax = max + pad;
    const step = (xMax - xMin) / (nPoints - 1);
    const xOut: number[] = [];
    const yOut: number[] = [];

    for (let i = 0; i < nPoints; i++) {
        const xi = xMin + i * step;
        let density = 0;
        for (const v of values) {
            const u = (xi - v) / bandwidth;
            density += Math.exp(-0.5 * u * u) / (bandwidth * Math.sqrt(2 * Math.PI));
        }
        density /= n;
        xOut.push(xi);
        yOut.push(density);
    }
    return { x: xOut, y: yOut };
};

// Standard normal CDF (Abramowitz & Stegun approximation)
const normalCDF = (x: number): number => {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989422804014327; // 1/sqrt(2*pi)
    const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    const p = d * Math.exp(-x * x / 2) * poly;
    return x >= 0 ? 1 - p : p;
};

// Anderson-Darling normality test — returns p-value
const andersonDarlingTest = (arr: number[]): number | null => {
    const n = arr.length;
    if (n < 8) return null;

    const sorted = [...arr].sort((a, b) => a - b);
    const mean = sorted.reduce((a, b) => a + b, 0) / n;
    const std = Math.sqrt(sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
    if (std === 0) return null;

    const z = sorted.map(x => (x - mean) / std);

    let A2 = 0;
    for (let i = 0; i < n; i++) {
        const p1 = Math.max(1e-15, Math.min(1 - 1e-15, normalCDF(z[i])));
        const p2 = Math.max(1e-15, Math.min(1 - 1e-15, normalCDF(z[n - 1 - i])));
        A2 += (2 * (i + 1) - 1) * (Math.log(p1) + Math.log(1 - p2));
    }
    A2 = -n - A2 / n;

    // Modified statistic for finite sample (Stephens, 1986)
    const Astar = A2 * (1 + 0.75 / n + 2.25 / (n * n));

    // P-value approximation (D'Agostino & Stephens, 1986)
    let p: number;
    if (Astar < 0.2) {
        p = 1 - Math.exp(-13.436 + 101.14 * Astar - 223.73 * Astar * Astar);
    } else if (Astar < 0.34) {
        p = 1 - Math.exp(-8.318 + 42.796 * Astar - 59.938 * Astar * Astar);
    } else if (Astar < 0.6) {
        p = Math.exp(0.9177 - 4.279 * Astar - 1.38 * Astar * Astar);
    } else {
        p = Math.exp(1.2937 - 5.709 * Astar + 0.0186 * Astar * Astar);
    }
    return Math.max(0, Math.min(1, p));
};

const downloadCSV = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
};

export const SummaryStats: React.FC = () => {
    const { data, columns, statsSelectedColumns, setStatsSelectedColumns, getFilteredColumns } = useAppStore();
    const filteredColumns = getFilteredColumns();
    useAttributeStore(); // Subscribe to changes
    const [stats, setStats] = useState<Record<string, Stats>>({});
    const [loading, setLoading] = useState(false);
    const [detailLevel, setDetailLevel] = useState<'basic' | 'full'>('basic');
    const [logScaleX, setLogScaleX] = useState(false);
    const [showKDE, setShowKDE] = useState(false);

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
                    // Count total visible rows for missing calc
                    let totalVisible = 0;
                    const values: number[] = [];
                    for (let i = 0; i < data.length; i++) {
                        if (currentStyleArrays.visible[i]) {
                            totalVisible++;
                            const val = data[i][col];
                            if (val != null && !isNaN(Number(val))) {
                                values.push(Number(val));
                            }
                        }
                    }

                    if (values.length === 0) {
                        result[col] = {
                            count: 0, missing: totalVisible,
                            min: null, max: null, mean: null, geometricMean: null,
                            median: null, std: null, cv: null, skewness: null, kurtosis: null,
                            normalityP: null,
                            p5: null, p10: null, p25: null, p50: null, p75: null, p90: null, p95: null
                        };
                        continue;
                    }

                    const sorted = [...values].sort((a, b) => a - b);
                    const sum = values.reduce((a, b) => a + b, 0);
                    const mean = sum / values.length;
                    const std = standardDeviation(values, mean);

                    result[col] = {
                        count: values.length,
                        missing: totalVisible - values.length,
                        min: sorted[0],
                        max: sorted[sorted.length - 1],
                        mean,
                        geometricMean: calcGeometricMean(values),
                        median: percentile(sorted, 50),
                        std,
                        cv: (std != null && mean !== 0) ? (std / Math.abs(mean)) * 100 : null,
                        skewness: std != null ? calcSkewness(values, mean, std) : null,
                        kurtosis: std != null ? calcKurtosis(values, mean, std) : null,
                        normalityP: andersonDarlingTest(values),
                        p5: percentile(sorted, 5),
                        p10: percentile(sorted, 10),
                        p25: percentile(sorted, 25),
                        p50: percentile(sorted, 50),
                        p75: percentile(sorted, 75),
                        p90: percentile(sorted, 90),
                        p95: percentile(sorted, 95),
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

    const numericColumns = sortColumnsByPriority(
        filteredColumns.filter(c => c.type === 'numeric' || c.type === 'float' || c.type === 'integer')
    );

    const allNumericColumns = useMemo(() => sortColumnsByPriority(
        columns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))
    ), [columns]);

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

            <Box sx={{ display: 'flex', gap: 2, mb: 3, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <MultiColumnSelector
                    columns={numericColumns}
                    allColumns={allNumericColumns}
                    selectedColumns={statsSelectedColumns}
                    onChange={setStatsSelectedColumns}
                    label="Select Columns"
                />
                <Button
                    variant="contained"
                    onClick={calculateStats}
                    disabled={statsSelectedColumns.length === 0 || loading}
                    sx={{ mt: 0.5 }}
                >
                    Calculate
                </Button>
                {Object.keys(stats).length > 0 && (
                    <Button
                        variant="outlined"
                        size="small"
                        sx={{ mt: 0.5 }}
                        onClick={() => {
                            const headers = ['Variable', 'N', 'Missing', 'Min', 'Max', 'Mean', 'GeoMean', 'Median', 'StdDev', 'CV%'];
                            if (detailLevel === 'full') headers.push('Skewness', 'Kurtosis', 'NormalityP', 'Normal', 'P5', 'P10', 'P25', 'P50', 'P75', 'P90', 'P95');
                            const rows = Object.entries(stats).map(([col, s]) => {
                                const row = [col, s.count, s.missing, s.min ?? '', s.max ?? '', s.mean ?? '', s.geometricMean ?? '', s.median ?? '', s.std ?? '', s.cv ?? ''];
                                if (detailLevel === 'full') row.push(
                                    s.skewness ?? '', s.kurtosis ?? '',
                                    s.normalityP != null ? s.normalityP.toFixed(4) : '',
                                    s.normalityP != null ? (s.normalityP >= 0.05 ? 'Yes' : 'No') : '',
                                    s.p5 ?? '', s.p10 ?? '', s.p25 ?? '', s.p50 ?? '', s.p75 ?? '', s.p90 ?? '', s.p95 ?? ''
                                );
                                return row.join(',');
                            });
                            downloadCSV('summary_statistics.csv', [headers.join(','), ...rows].join('\n'));
                        }}
                    >
                        Export CSV
                    </Button>
                )}
                <ToggleButtonGroup
                    value={detailLevel}
                    exclusive
                    onChange={(_, v) => { if (v) setDetailLevel(v); }}
                    size="small"
                    sx={{ mt: 0.5 }}
                >
                    <ToggleButton value="basic">Basic</ToggleButton>
                    <ToggleButton value="full">Full</ToggleButton>
                </ToggleButtonGroup>
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
                                    <TableCell align="right"><strong>N</strong></TableCell>
                                    <TableCell align="right"><strong>Missing</strong></TableCell>
                                    <TableCell align="right"><strong>Min</strong></TableCell>
                                    <TableCell align="right"><strong>Max</strong></TableCell>
                                    <TableCell align="right"><strong>Mean</strong></TableCell>
                                    <TableCell align="right"><strong>GeoMean</strong></TableCell>
                                    <TableCell align="right"><strong>Median</strong></TableCell>
                                    <TableCell align="right"><strong>Std Dev</strong></TableCell>
                                    <TableCell align="right"><strong>CV%</strong></TableCell>
                                    {detailLevel === 'full' && (
                                        <>
                                            <TableCell align="right"><strong>Skewness</strong></TableCell>
                                            <TableCell align="right"><strong>Kurtosis</strong></TableCell>
                                            <Tooltip title="Anderson-Darling normality test p-value. p < 0.05 suggests non-normal distribution." arrow>
                                                <TableCell align="right"><strong>Normal?</strong></TableCell>
                                            </Tooltip>
                                            <TableCell align="right"><strong>P5</strong></TableCell>
                                            <TableCell align="right"><strong>P10</strong></TableCell>
                                            <TableCell align="right"><strong>P25</strong></TableCell>
                                            <TableCell align="right"><strong>P50</strong></TableCell>
                                            <TableCell align="right"><strong>P75</strong></TableCell>
                                            <TableCell align="right"><strong>P90</strong></TableCell>
                                            <TableCell align="right"><strong>P95</strong></TableCell>
                                        </>
                                    )}
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {Object.entries(stats).map(([colName, colStats]) => (
                                    <TableRow key={colName} hover>
                                        <TableCell>{colName}</TableCell>
                                        <TableCell align="right">{colStats.count}</TableCell>
                                        <TableCell align="right">{colStats.missing}</TableCell>
                                        <TableCell align="right">{formatNumber(colStats.min)}</TableCell>
                                        <TableCell align="right">{formatNumber(colStats.max)}</TableCell>
                                        <TableCell align="right">{formatNumber(colStats.mean)}</TableCell>
                                        <TableCell align="right">{formatNumber(colStats.geometricMean)}</TableCell>
                                        <TableCell align="right">{formatNumber(colStats.median)}</TableCell>
                                        <TableCell align="right">{formatNumber(colStats.std)}</TableCell>
                                        <TableCell align="right">{formatNumber(colStats.cv)}</TableCell>
                                        {detailLevel === 'full' && (
                                            <>
                                                <TableCell align="right">{formatNumber(colStats.skewness)}</TableCell>
                                                <TableCell align="right">{formatNumber(colStats.kurtosis)}</TableCell>
                                                <Tooltip title={colStats.normalityP != null ? `A-D p = ${colStats.normalityP.toFixed(4)}${(colStats.skewness != null && Math.abs(colStats.skewness) > 1) ? '. High skewness — consider log-transform.' : ''}` : ''} arrow>
                                                    <TableCell align="right">
                                                        {colStats.normalityP != null ? (
                                                            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                                                                <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: colStats.normalityP >= 0.05 ? '#2e7d32' : '#d32f2f' }} />
                                                                {colStats.normalityP < 0.001 ? '<0.001' : colStats.normalityP.toFixed(3)}
                                                            </Box>
                                                        ) : 'N/A'}
                                                    </TableCell>
                                                </Tooltip>
                                                <TableCell align="right">{formatNumber(colStats.p5)}</TableCell>
                                                <TableCell align="right">{formatNumber(colStats.p10)}</TableCell>
                                                <TableCell align="right">{formatNumber(colStats.p25)}</TableCell>
                                                <TableCell align="right">{formatNumber(colStats.p50)}</TableCell>
                                                <TableCell align="right">{formatNumber(colStats.p75)}</TableCell>
                                                <TableCell align="right">{formatNumber(colStats.p90)}</TableCell>
                                                <TableCell align="right">{formatNumber(colStats.p95)}</TableCell>
                                            </>
                                        )}
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>

                    {/* Histograms */}
                    {statsSelectedColumns.length > 0 && Object.keys(stats).length > 0 && (
                        <>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 4, mb: 1 }}>
                                <Typography variant="h6">Distributions</Typography>
                                <FormControlLabel
                                    control={<Checkbox checked={logScaleX} onChange={(_, v) => setLogScaleX(v)} size="small" />}
                                    label="Log X-axis"
                                />
                                <FormControlLabel
                                    control={<Checkbox checked={showKDE} onChange={(_, v) => setShowKDE(v)} size="small" />}
                                    label="KDE overlay"
                                />
                            </Box>
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

                                    const plotValues = logScaleX ? values.filter(v => v > 0).map(v => Math.log10(v)) : values;

                                    const traces: Plotly.Data[] = [{
                                        x: plotValues,
                                        type: 'histogram',
                                        marker: { color: '#1976d2', line: { width: 0 } },
                                        nbinsx: 30,
                                        name: 'Histogram',
                                    } as any];

                                    if (showKDE && plotValues.length > 1) {
                                        const kde = computeKDE(plotValues);
                                        // Scale KDE to match histogram counts
                                        const binWidth = (Math.max(...plotValues) - Math.min(...plotValues)) / 30;
                                        const scaledY = kde.y.map(d => d * plotValues.length * binWidth);
                                        traces.push({
                                            x: kde.x,
                                            y: scaledY,
                                            type: 'scatter',
                                            mode: 'lines',
                                            line: { color: '#d32f2f', width: 2 },
                                            name: 'KDE',
                                        } as any);
                                    }

                                    return (
                                        <Paper key={col} sx={{ p: 2 }}>
                                            <Plot
                                                data={traces}
                                                layout={{
                                                    title: { text: col },
                                                    autosize: true,
                                                    height: 300,
                                                    margin: { l: 50, r: 20, t: 40, b: 40 },
                                                    xaxis: { title: { text: logScaleX ? `log10(${col})` : col } },
                                                    yaxis: { title: { text: 'Frequency' } },
                                                    showlegend: showKDE,
                                                    legend: { x: 0.7, y: 1, bgcolor: 'rgba(255,255,255,0.7)' },
                                                    bargap: 0.02,
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
