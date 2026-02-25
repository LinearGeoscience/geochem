import React, { useState, useMemo, useCallback } from 'react';
import { Box, Paper, Typography, Button, Select, MenuItem, FormControl, InputLabel, Slider, Checkbox, FormControlLabel, ToggleButtonGroup, ToggleButton, CircularProgress } from '@mui/material';
import Plot from 'react-plotly.js';
import { useAppStore } from '../../store/appStore';
import { useAttributeStore } from '../../store/attributeStore';
import { getStyleArrays, sortColumnsByPriority } from '../../utils/attributeUtils';
import { separatePopulations } from '../../utils/statistics/populationSeparation';
import type { PopulationSeparationResult, PopulationSeparationConfig } from '../../types/statistics';
import { getPlotConfig } from '../../utils/plotConfig';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';

const POPULATION_COLORS = ['#1976d2', '#d32f2f', '#2e7d32', '#f57c00', '#7b1fa2', '#00838f'];

const CLASSIFICATION_LABELS: Record<string, string> = {
    background: 'Background',
    anomalous: 'Anomalous',
    threshold: 'Threshold',
    'high-grade': 'High Grade',
};

// Normal PDF
const normalPDF = (x: number, mean: number, std: number): number => {
    if (std <= 0) return 0;
    const z = (x - mean) / std;
    return Math.exp(-0.5 * z * z) / (std * Math.sqrt(2 * Math.PI));
};

export const PopulationSeparation: React.FC = () => {
    const { data, columns, getFilteredColumns } = useAppStore();
    const filteredColumns = getFilteredColumns();
    useAttributeStore();

    const [selectedColumn, setSelectedColumn] = useState<string>('');
    const [method, setMethod] = useState<PopulationSeparationConfig['method']>('gaussian-mixture');
    const [maxPops, setMaxPops] = useState(3);
    const [useLogScale, setUseLogScale] = useState(false);
    const [result, setResult] = useState<PopulationSeparationResult | null>(null);
    const [loading, setLoading] = useState(false);

    const numericColumns = useMemo(() => sortColumnsByPriority(
        filteredColumns.filter(c => c.type === 'numeric' || c.type === 'float' || c.type === 'integer')
    ), [filteredColumns]);

    const allNumericColumns = useMemo(() => sortColumnsByPriority(
        columns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))
    ), [columns]);

    const separate = useCallback(() => {
        if (!selectedColumn) return;
        setLoading(true);
        const currentStyleArrays = getStyleArrays(data);

        setTimeout(() => {
            try {
                const visibleData: Record<string, any>[] = [];
                for (let i = 0; i < data.length; i++) {
                    if (currentStyleArrays.visible[i]) {
                        visibleData.push(data[i]);
                    }
                }

                const config: PopulationSeparationConfig = {
                    column: selectedColumn,
                    maxPopulations: maxPops,
                    method,
                    useLogScale,
                };

                const res = separatePopulations(visibleData, config);
                setResult(res);
            } catch (error) {
                console.error('Population separation failed:', error);
            } finally {
                setLoading(false);
            }
        }, 10);
    }, [selectedColumn, method, maxPops, useLogScale, data]);

    // Get visible values for the selected column
    const visibleValues = useMemo(() => {
        if (!selectedColumn) return [];
        const styleArrays = getStyleArrays(data);
        const vals: number[] = [];
        for (let i = 0; i < data.length; i++) {
            if (styleArrays.visible[i]) {
                const v = data[i][selectedColumn];
                if (v != null && !isNaN(Number(v))) vals.push(Number(v));
            }
        }
        return vals;
    }, [selectedColumn, data]);

    // Generate Gaussian overlay traces
    const gaussianTraces = useMemo(() => {
        if (!result || result.populations.length === 0 || visibleValues.length === 0) return [];

        const min = Math.min(...visibleValues);
        const max = Math.max(...visibleValues);
        const range = max - min;
        const nBins = 40;
        const binWidth = range / nBins;
        const nPoints = 200;
        const xLine = Array.from({ length: nPoints }, (_, i) => min - range * 0.05 + (range * 1.1) * i / (nPoints - 1));

        return result.populations.map((pop, idx) => {
            const yLine = xLine.map(x =>
                pop.proportion * normalPDF(x, pop.mean, pop.stdDev) * binWidth * visibleValues.length
            );
            return {
                x: xLine,
                y: yLine,
                type: 'scatter' as const,
                mode: 'lines' as const,
                line: { color: POPULATION_COLORS[idx % POPULATION_COLORS.length], width: 2.5 },
                name: `Pop ${idx + 1} (${CLASSIFICATION_LABELS[pop.classification] ?? pop.classification})`,
            };
        });
    }, [result, visibleValues]);

    // Separation boundary shapes
    const separationShapes = useMemo(() => {
        if (!result) return [];
        return result.separationPoints.map(pt => ({
            type: 'line' as const,
            xref: 'x' as const,
            yref: 'paper' as const,
            x0: pt, x1: pt, y0: 0, y1: 1,
            line: { color: '#555', width: 1.5, dash: 'dash' as const },
        }));
    }, [result]);

    return (
        <Box sx={{ p: 3 }}>
            <Typography variant="h5" gutterBottom>Population Separation</Typography>

            <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <FormControl size="small" sx={{ minWidth: 200 }}>
                    <InputLabel>Column</InputLabel>
                    <Select value={selectedColumn} label="Column" onChange={(e) => setSelectedColumn(e.target.value)}>
                        {(numericColumns.length > 0 ? numericColumns : allNumericColumns).map(c => (
                            <MenuItem key={c.name} value={c.name}>{c.name}</MenuItem>
                        ))}
                    </Select>
                </FormControl>

                <ToggleButtonGroup
                    value={method}
                    exclusive
                    onChange={(_, v) => { if (v) setMethod(v); }}
                    size="small"
                >
                    <ToggleButton value="gaussian-mixture">Gaussian Mixture</ToggleButton>
                    <ToggleButton value="log-probability">Log-Probability</ToggleButton>
                    <ToggleButton value="histogram-mode">Histogram Mode</ToggleButton>
                </ToggleButtonGroup>

                <Box sx={{ minWidth: 160 }}>
                    <Typography variant="caption" color="text.secondary">Max populations: {maxPops}</Typography>
                    <Slider
                        value={maxPops}
                        onChange={(_, v) => setMaxPops(v as number)}
                        min={2} max={6} step={1}
                        size="small"
                        marks
                        valueLabelDisplay="auto"
                    />
                </Box>

                <FormControlLabel
                    control={<Checkbox checked={useLogScale} onChange={(_, v) => setUseLogScale(v)} size="small" />}
                    label="Use Log Scale"
                />

                <Button
                    variant="contained"
                    onClick={separate}
                    disabled={!selectedColumn || loading}
                >
                    Separate Populations
                </Button>

                {result && (
                    <Button
                        variant="outlined"
                        size="small"
                        onClick={() => {
                            const lines: string[] = [];
                            lines.push('Population,Classification,Mean,StdDev,Count,Proportion,LowerBound,UpperBound');
                            for (const pop of result.populations) {
                                lines.push([
                                    pop.id + 1,
                                    CLASSIFICATION_LABELS[pop.classification] ?? pop.classification,
                                    pop.mean.toFixed(4), pop.stdDev.toFixed(4),
                                    pop.count, (pop.proportion * 100).toFixed(1) + '%',
                                    pop.lowerBound.toFixed(4), pop.upperBound.toFixed(4)
                                ].join(','));
                            }
                            if (result.separationPoints.length > 0) {
                                lines.push('');
                                lines.push('Separation Thresholds');
                                lines.push(result.separationPoints.map(p => p.toFixed(4)).join(','));
                            }
                            if (result.bic != null) {
                                lines.push('');
                                lines.push(`BIC,${result.bic.toFixed(1)}`);
                                lines.push(`AIC,${result.aic?.toFixed(1) ?? ''}`);
                                lines.push(`LogLikelihood,${result.logLikelihood?.toFixed(1) ?? ''}`);
                            }
                            const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url; a.download = `population_${selectedColumn}.csv`; a.click();
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
            ) : result && (
                <>
                    {/* Main plot: histogram + Gaussian overlays */}
                    <Paper sx={{ p: 2, mb: 3 }}>
                        <ExpandablePlotWrapper>
                            <Plot
                                data={[
                                    {
                                        x: visibleValues,
                                        type: 'histogram',
                                        nbinsx: 40,
                                        marker: { color: 'rgba(25,118,210,0.3)', line: { color: '#1976d2', width: 1 } },
                                        name: 'Data',
                                    } as any,
                                    ...gaussianTraces as any[],
                                ]}
                                layout={{
                                    title: { text: `Population Separation: ${selectedColumn} (${result.nPopulations} populations)` },
                                    autosize: true,
                                    height: 400,
                                    margin: { l: 60, r: 30, t: 50, b: 50 },
                                    xaxis: { title: { text: selectedColumn } },
                                    yaxis: { title: { text: 'Frequency' } },
                                    shapes: separationShapes as any,
                                    showlegend: true,
                                    legend: { x: 0.7, y: 1, bgcolor: 'rgba(255,255,255,0.8)' },
                                    bargap: 0.02,
                                }}
                                config={getPlotConfig({ filename: `population_${selectedColumn}` })}
                                style={{ width: '100%' }}
                                useResizeHandler={true}
                            />
                        </ExpandablePlotWrapper>
                    </Paper>

                    {/* Population cards */}
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 2 }}>
                        {result.populations.map((pop, idx) => (
                            <Paper
                                key={pop.id}
                                variant="outlined"
                                sx={{
                                    p: 2,
                                    borderLeft: 4,
                                    borderColor: POPULATION_COLORS[idx % POPULATION_COLORS.length],
                                }}
                            >
                                <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                                    Population {pop.id + 1}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                                    {CLASSIFICATION_LABELS[pop.classification] ?? pop.classification}
                                </Typography>
                                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5, '& > *': { fontSize: '0.8rem' } }}>
                                    <Typography variant="body2">Mean:</Typography>
                                    <Typography variant="body2" align="right">{pop.mean.toFixed(3)}</Typography>
                                    <Typography variant="body2">Std Dev:</Typography>
                                    <Typography variant="body2" align="right">{pop.stdDev.toFixed(3)}</Typography>
                                    <Typography variant="body2">Count:</Typography>
                                    <Typography variant="body2" align="right">{pop.count}</Typography>
                                    <Typography variant="body2">Proportion:</Typography>
                                    <Typography variant="body2" align="right">{(pop.proportion * 100).toFixed(1)}%</Typography>
                                    <Typography variant="body2">Range:</Typography>
                                    <Typography variant="body2" align="right">{pop.lowerBound.toFixed(2)} – {pop.upperBound.toFixed(2)}</Typography>
                                </Box>
                            </Paper>
                        ))}
                    </Box>

                    {result.bic != null && (
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
                            BIC: {result.bic.toFixed(1)} | AIC: {result.aic?.toFixed(1) ?? '—'} | Log-likelihood: {result.logLikelihood?.toFixed(1) ?? '—'}
                        </Typography>
                    )}
                </>
            )}
        </Box>
    );
};
