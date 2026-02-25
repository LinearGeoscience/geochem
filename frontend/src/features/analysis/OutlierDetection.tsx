import React, { useState, useMemo, useCallback } from 'react';
import { Box, Paper, Typography, Button, Select, MenuItem, FormControl, InputLabel, Slider, Checkbox, FormControlLabel, CircularProgress } from '@mui/material';
import Plot from 'react-plotly.js';
import { useAppStore } from '../../store/appStore';
import { useAttributeStore } from '../../store/attributeStore';
import { getStyleArrays, sortColumnsByPriority } from '../../utils/attributeUtils';
import { MultiColumnSelector } from '../../components/MultiColumnSelector';
import { detectAnomalies } from '../../utils/statistics/anomalyDetection';
import type { AnomalyMethod, AnomalyResult } from '../../types/statistics';
import { getPlotConfig } from '../../utils/plotConfig';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';

const METHOD_OPTIONS: { value: AnomalyMethod; label: string }[] = [
    { value: 'sigma', label: 'Sigma (Mean ± nσ)' },
    { value: 'mad', label: 'MAD (Median Absolute Deviation)' },
    { value: 'iqr', label: 'IQR (Box Plot Fences)' },
    { value: 'percentile', label: 'Percentile' },
    { value: 'zscore', label: 'Z-Score' },
    { value: 'robust-zscore', label: 'Robust Z-Score' },
];

const METHOD_PARAM_LABELS: Record<string, string> = {
    sigma: 'Sigma multiplier',
    mad: 'MAD multiplier',
    iqr: 'IQR multiplier',
    percentile: 'Percentile threshold',
    zscore: 'Z-score threshold',
    'robust-zscore': 'Modified Z threshold',
};

const METHOD_DEFAULTS: Record<string, number> = {
    sigma: 3,
    mad: 3,
    iqr: 1.5,
    percentile: 1,
    zscore: 3,
    'robust-zscore': 3.5,
};

const METHOD_RANGES: Record<string, [number, number, number]> = {
    sigma: [1, 5, 0.5],
    mad: [1, 5, 0.5],
    iqr: [1, 4, 0.25],
    percentile: [0.5, 10, 0.5],
    zscore: [1, 5, 0.5],
    'robust-zscore': [1, 5, 0.5],
};

export const OutlierDetection: React.FC = () => {
    const { data, columns, getFilteredColumns } = useAppStore();
    const filteredColumns = getFilteredColumns();
    useAttributeStore();

    const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
    const [method, setMethod] = useState<AnomalyMethod>('sigma');
    const [multiplier, setMultiplier] = useState(3);
    const [bidirectional, setBidirectional] = useState(true);
    const [results, setResults] = useState<AnomalyResult[]>([]);
    const [loading, setLoading] = useState(false);

    const numericColumns = sortColumnsByPriority(
        filteredColumns.filter(c => c.type === 'numeric' || c.type === 'float' || c.type === 'integer')
    );
    const allNumericColumns = useMemo(() => sortColumnsByPriority(
        columns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))
    ), [columns]);

    const handleMethodChange = (newMethod: AnomalyMethod) => {
        setMethod(newMethod);
        setMultiplier(METHOD_DEFAULTS[newMethod] ?? 3);
    };

    const detect = useCallback(() => {
        if (selectedColumns.length === 0) return;
        setLoading(true);
        const currentStyleArrays = getStyleArrays(data);

        setTimeout(() => {
            try {
                const allResults: AnomalyResult[] = [];
                for (const col of selectedColumns) {
                    // Extract visible data with original indices preserved
                    const visibleData: Record<string, any>[] = [];
                    for (let i = 0; i < data.length; i++) {
                        if (currentStyleArrays.visible[i]) {
                            visibleData.push(data[i]);
                        }
                    }

                    const config = {
                        method,
                        column: col,
                        bidirectional,
                        sigmaMultiplier: method === 'sigma' ? multiplier : undefined,
                        iqrMultiplier: method === 'iqr' ? multiplier : undefined,
                        zscoreThreshold: (method === 'zscore' || method === 'robust-zscore' || method === 'mad') ? multiplier : undefined,
                        percentileLower: method === 'percentile' ? multiplier : undefined,
                        percentileUpper: method === 'percentile' ? 100 - multiplier : undefined,
                        includeScores: true,
                    };

                    const result = detectAnomalies(visibleData, config);
                    allResults.push(result);
                }
                setResults(allResults);
            } catch (error) {
                console.error('Outlier detection failed:', error);
            } finally {
                setLoading(false);
            }
        }, 10);
    }, [selectedColumns, method, multiplier, bidirectional, data]);

    const range = METHOD_RANGES[method] ?? [1, 5, 0.5];

    return (
        <Box sx={{ p: 3 }}>
            <Typography variant="h5" gutterBottom>Outlier Detection</Typography>

            <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <MultiColumnSelector
                    columns={numericColumns}
                    allColumns={allNumericColumns}
                    selectedColumns={selectedColumns}
                    onChange={setSelectedColumns}
                    label="Select Columns"
                />

                <FormControl size="small" sx={{ minWidth: 200 }}>
                    <InputLabel>Method</InputLabel>
                    <Select value={method} label="Method" onChange={(e) => handleMethodChange(e.target.value as AnomalyMethod)}>
                        {METHOD_OPTIONS.map(o => (
                            <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                        ))}
                    </Select>
                </FormControl>

                <Box sx={{ minWidth: 180 }}>
                    <Typography variant="caption" color="text.secondary">{METHOD_PARAM_LABELS[method] ?? 'Threshold'}: {multiplier}</Typography>
                    <Slider
                        value={multiplier}
                        onChange={(_, v) => setMultiplier(v as number)}
                        min={range[0]}
                        max={range[1]}
                        step={range[2]}
                        size="small"
                        valueLabelDisplay="auto"
                    />
                </Box>

                <FormControlLabel
                    control={<Checkbox checked={bidirectional} onChange={(_, v) => setBidirectional(v)} size="small" />}
                    label="Bidirectional"
                />

                <Button
                    variant="contained"
                    onClick={detect}
                    disabled={selectedColumns.length === 0 || loading}
                >
                    Detect Outliers
                </Button>

                {results.length > 0 && (
                    <Button
                        variant="outlined"
                        size="small"
                        onClick={() => {
                            const lines = ['Column,N,Outliers,Rate%,LowerThreshold,UpperThreshold,Method'];
                            for (const r of results) {
                                lines.push([
                                    r.column, r.statistics.n, r.statistics.nAnomalies,
                                    (r.statistics.anomalyRate * 100).toFixed(1),
                                    r.thresholds.lower ?? '', r.thresholds.upper ?? '', r.method
                                ].join(','));
                            }
                            const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url; a.download = 'outlier_detection.csv'; a.click();
                            URL.revokeObjectURL(url);
                        }}
                    >
                        Export CSV
                    </Button>
                )}
            </Box>

            {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                    <CircularProgress />
                </Box>
            ) : results.length > 0 && (
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', gap: 3 }}>
                    {results.map((result) => {
                        const styleArrays = getStyleArrays(data);
                        // Track visible index to correctly map isAnomaly (which is indexed per visible row)
                        const visibleNumericValues: { value: number; visibleIdx: number }[] = [];
                        let visIdx = 0;
                        for (let i = 0; i < data.length; i++) {
                            if (styleArrays.visible[i]) {
                                const v = data[i][result.column];
                                if (v != null && !isNaN(Number(v))) {
                                    visibleNumericValues.push({ value: Number(v), visibleIdx: visIdx });
                                }
                                visIdx++;
                            }
                        }
                        const values = visibleNumericValues.map(v => v.value);
                        const outlierValues = visibleNumericValues.filter(v => result.isAnomaly[v.visibleIdx]).map(v => v.value);
                        const normalValues = visibleNumericValues.filter(v => !result.isAnomaly[v.visibleIdx]).map(v => v.value);

                        // Build threshold shapes for histogram
                        const shapes: Partial<Plotly.Shape>[] = [];
                        if (result.thresholds.upper != null) {
                            shapes.push({
                                type: 'line', xref: 'x', yref: 'paper',
                                x0: result.thresholds.upper, x1: result.thresholds.upper,
                                y0: 0, y1: 1,
                                line: { color: '#d32f2f', width: 2, dash: 'dash' },
                            });
                        }
                        if (result.thresholds.lower != null) {
                            shapes.push({
                                type: 'line', xref: 'x', yref: 'paper',
                                x0: result.thresholds.lower, x1: result.thresholds.lower,
                                y0: 0, y1: 1,
                                line: { color: '#d32f2f', width: 2, dash: 'dash' },
                            });
                        }

                        return (
                            <Paper key={result.column} sx={{ p: 2 }}>
                                <Typography variant="subtitle1" fontWeight="bold" gutterBottom>{result.column}</Typography>

                                {/* Summary card */}
                                <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                                    <Paper variant="outlined" sx={{ p: 1.5, flex: 1, textAlign: 'center' }}>
                                        <Typography variant="caption" color="text.secondary">N</Typography>
                                        <Typography variant="h6">{result.statistics.n}</Typography>
                                    </Paper>
                                    <Paper variant="outlined" sx={{ p: 1.5, flex: 1, textAlign: 'center' }}>
                                        <Typography variant="caption" color="text.secondary">Outliers</Typography>
                                        <Typography variant="h6" color="error">{result.statistics.nAnomalies}</Typography>
                                    </Paper>
                                    <Paper variant="outlined" sx={{ p: 1.5, flex: 1, textAlign: 'center' }}>
                                        <Typography variant="caption" color="text.secondary">Rate</Typography>
                                        <Typography variant="h6">{(result.statistics.anomalyRate * 100).toFixed(1)}%</Typography>
                                    </Paper>
                                    <Paper variant="outlined" sx={{ p: 1.5, flex: 1, textAlign: 'center' }}>
                                        <Typography variant="caption" color="text.secondary">Thresholds</Typography>
                                        <Typography variant="body2">
                                            {result.thresholds.lower != null ? result.thresholds.lower.toFixed(2) : '—'} / {result.thresholds.upper != null ? result.thresholds.upper.toFixed(2) : '—'}
                                        </Typography>
                                    </Paper>
                                </Box>

                                {/* Histogram with thresholds */}
                                <ExpandablePlotWrapper>
                                    <Plot
                                        data={[{
                                            x: values,
                                            type: 'histogram',
                                            nbinsx: 40,
                                            marker: { color: '#1976d2', line: { width: 0 } },
                                            name: 'Data',
                                        } as any]}
                                        layout={{
                                            title: { text: 'Distribution with Thresholds', font: { size: 13 } },
                                            autosize: true,
                                            height: 250,
                                            margin: { l: 50, r: 20, t: 35, b: 40 },
                                            xaxis: { title: { text: result.column } },
                                            yaxis: { title: { text: 'Frequency' } },
                                            shapes: shapes as any,
                                            showlegend: false,
                                            bargap: 0.02,
                                        }}
                                        config={getPlotConfig({ filename: `outlier_hist_${result.column}` })}
                                        style={{ width: '100%' }}
                                        useResizeHandler={true}
                                    />
                                </ExpandablePlotWrapper>

                                {/* Strip chart */}
                                <ExpandablePlotWrapper>
                                    <Plot
                                        data={[
                                            {
                                                x: normalValues,
                                                y: normalValues.map(() => 0),
                                                type: 'scatter',
                                                mode: 'markers',
                                                marker: { color: '#1976d2', size: 5, opacity: 0.5 },
                                                name: 'Normal',
                                                hovertemplate: '%{x:.3f}<extra>Normal</extra>',
                                            } as any,
                                            {
                                                x: outlierValues,
                                                y: outlierValues.map(() => 0),
                                                type: 'scatter',
                                                mode: 'markers',
                                                marker: { color: '#d32f2f', size: 7, symbol: 'x' },
                                                name: 'Outlier',
                                                hovertemplate: '%{x:.3f}<extra>Outlier</extra>',
                                            } as any,
                                        ]}
                                        layout={{
                                            title: { text: 'Strip Chart', font: { size: 13 } },
                                            autosize: true,
                                            height: 120,
                                            margin: { l: 50, r: 20, t: 35, b: 30 },
                                            xaxis: { title: { text: '' } },
                                            yaxis: { visible: false, range: [-0.5, 0.5] },
                                            shapes: shapes as any,
                                            showlegend: true,
                                            legend: { orientation: 'h', y: 1.2 },
                                        }}
                                        config={{ displayModeBar: false }}
                                        style={{ width: '100%' }}
                                        useResizeHandler={true}
                                    />
                                </ExpandablePlotWrapper>
                            </Paper>
                        );
                    })}
                </Box>
            )}
        </Box>
    );
};
