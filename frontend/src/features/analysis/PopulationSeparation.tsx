import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Box, Paper, Typography, Button, Select, MenuItem, FormControl, InputLabel, Slider, Checkbox, FormControlLabel, ToggleButtonGroup, ToggleButton, CircularProgress, TextField } from '@mui/material';
import Plot from '../../components/ThemedPlot';
import { useAppStore, useDatasetRows } from '../../store/appStore';
import { useShallow } from 'zustand/react/shallow';
import { useAttributeStore } from '../../store/attributeStore';
import { getStyleArraysColumnar, sortColumnsByPriority } from '../../utils/attributeUtils';
import { analysisInWorker, pickColumns } from '../../utils/analysisWorker';
import type { PopulationSeparationResult, PopulationSeparationConfig } from '../../types/statistics';
import { getPlotConfig } from '../../utils/plotConfig';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';
import { populationPlot } from './populationPlot';
import { applyColourGroups, labelsToGroups, assignmentLabels } from '../../utils/colourGroups';
import { addTextColumn } from './methods/methodsCommon';
import { notify } from '../../store/notificationStore';

const POPULATION_COLORS = ['#1976d2', '#d32f2f', '#2e7d32', '#f57c00', '#7b1fa2', '#00838f'];

const CLASSIFICATION_LABELS: Record<string, string> = {
    background: 'Background',
    anomalous: 'Anomalous',
    threshold: 'Threshold',
    'high-grade': 'High Grade',
};

export const PopulationSeparation: React.FC = () => {
    const { columns } = useAppStore(useShallow(s => ({
        columns: s.columns,
    })));
    const data = useDatasetRows();
    const getColumn = useAppStore(s => s.getColumn);
    // Derived list, re-rendering only when its contents change
    const filteredColumns = useAppStore(useShallow(s => s.getFilteredColumns()));
    const attributeFilter = useAttributeStore(s => s.filter);

    const [selectedColumn, setSelectedColumn] = useState<string>('');
    const [method, setMethod] = useState<PopulationSeparationConfig['method']>('gaussian-mixture');
    const [maxPops, setMaxPops] = useState(3);
    const [useLogScale, setUseLogScale] = useState(false);
    const [result, setResult] = useState<PopulationSeparationResult | null>(null);
    const [loading, setLoading] = useState(false);
    // Dataset row of each value sent to the fit (result.assignedPopulation is by this position)
    const [fitRows, setFitRows] = useState<number[]>([]);
    const [popNames, setPopNames] = useState<string[]>([]);
    const [columnName, setColumnName] = useState('');
    useEffect(() => {
        setPopNames(result ? result.populations.map(p => `Pop ${p.id + 1}`) : []);
        setColumnName(result ? `${result.column}_pop` : '');
    }, [result]);

    const numericColumns = useMemo(() => sortColumnsByPriority(
        filteredColumns.filter(c => c.type === 'numeric' || c.type === 'float' || c.type === 'integer')
    ), [filteredColumns]);

    const allNumericColumns = useMemo(() => sortColumnsByPriority(
        columns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))
    ), [columns]);

    const separate = useCallback(() => {
        if (!selectedColumn) return;
        setLoading(true);
        const currentStyleArrays = getStyleArraysColumnar(data.length, (name) => getColumn(name));

        const visibleRows: Record<string, any>[] = [];
        const rowsIdx: number[] = [];
        for (let i = 0; i < data.length; i++) {
            if (currentStyleArrays.visible[i]) { visibleRows.push(data[i]); rowsIdx.push(i); }
        }
        const config: PopulationSeparationConfig = {
            column: selectedColumn,
            maxPopulations: maxPops,
            method,
            useLogScale,
        };

        analysisInWorker<PopulationSeparationResult>('separatePopulations', {
            data: pickColumns(visibleRows, [selectedColumn]),
            config,
        })
            .then(r => { setFitRows(rowsIdx); setResult(r); })
            .catch((error) => console.error('Population separation failed:', error))
            .finally(() => setLoading(false));
    }, [selectedColumn, method, maxPops, useLogScale, data, getColumn]);

    // Get visible values for the selected column
    const visibleValues = useMemo(() => {
        if (!selectedColumn) return [];
        const styleArrays = getStyleArraysColumnar(data.length, (name) => getColumn(name));
        const vals: number[] = [];
        for (let i = 0; i < data.length; i++) {
            if (styleArrays.visible[i]) {
                const v = data[i][selectedColumn];
                if (v != null && !isNaN(Number(v))) vals.push(Number(v));
            }
        }
        return vals;
        // attributeFilter: getStyleArraysColumnar reads the attribute store, so
        // recompute when the visibility filter changes
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedColumn, data, getColumn, attributeFilter]);

    // Histogram, population curves and thresholds (on a log10 axis for a log-scale fit)
    const plot = useMemo(() => (result ? populationPlot(result, visibleValues) : null), [result, visibleValues]);
    const gaussianTraces = useMemo(() => (!plot || !result) ? [] : plot.curves
        .map((c, idx) => ({
            x: c.x,
            y: c.y,
            type: 'scatter' as const,
            mode: 'lines' as const,
            line: { color: POPULATION_COLORS[idx % POPULATION_COLORS.length], width: 2.5 },
            name: `${popNames[idx] ?? `Pop ${idx + 1}`} (${CLASSIFICATION_LABELS[result.populations[idx].classification] ?? result.populations[idx].classification})`,
        }))
        .filter(t => t.x.length > 0), [plot, result, popNames]);

    const separationShapes = useMemo(() => (plot?.thresholds ?? []).map(pt => ({
        type: 'line' as const,
        xref: 'x' as const,
        yref: 'paper' as const,
        x0: pt, x1: pt, y0: 0, y1: 1,
        line: { color: '#555', width: 1.5, dash: 'dash' as const },
    })), [plot]);

    const names = (r: PopulationSeparationResult) => r.populations.map((p, i) => popNames[i]?.trim() || `Pop ${p.id + 1}`);
    const labelsForRows = () => {
        if (!result) return [];
        const n = names(result);
        return assignmentLabels(data.length, fitRows, result.assignedPopulation, k => n[k] ?? `Pop ${k + 1}`);
    };

    const addPopulationColumn = () => {
        if (!result) return;
        const n = addTextColumn(columnName.trim() || `${result.column}_pop`, labelsForRows(),
            `Population of ${result.column} (${method}${result.logScale ? ', log scale' : ''}); thresholds ${result.separationPoints.map(t => t.toPrecision(4)).join(', ')}`,
            { column: result.column, method, logScale: !!result.logScale, thresholds: result.separationPoints, names: names(result) });
        if (n) notify(`Added "${n}": rows not in the fit are blank`, 'success');
    };

    const applyAsColourGroups = () => {
        if (!result) return;
        const r = applyColourGroups(labelsToGroups(labelsForRows(), POPULATION_COLORS, names(result)));
        notify(`Painted ${r.rows} rows into ${r.groups} colour groups`, 'success');
    };

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
                            lines.push(result.logScale
                                ? 'Population,Classification,GeoMean,GeoSD_factor,Log10Mean,Log10SD,Count,Proportion,LowerBound,UpperBound'
                                : 'Population,Classification,Mean,StdDev,Count,Proportion,LowerBound,UpperBound');
                            for (const pop of result.populations) {
                                lines.push([
                                    `"${(popNames[pop.id] ?? `Pop ${pop.id + 1}`).replace(/"/g, '""')}"`,
                                    CLASSIFICATION_LABELS[pop.classification] ?? pop.classification,
                                    pop.mean.toFixed(4), pop.stdDev.toFixed(4),
                                    ...(result.logScale ? [pop.logMean?.toFixed(4) ?? '', pop.logStd?.toFixed(4) ?? ''] : []),
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
                {result && result.populations.length > 1 && (
                    <>
                        <TextField size="small" label="Column name" value={columnName} onChange={e => setColumnName(e.target.value)} sx={{ width: 160 }} />
                        <Button variant="outlined" size="small" onClick={addPopulationColumn}>Add population column</Button>
                        <Button variant="outlined" size="small" onClick={applyAsColourGroups}>Apply as colour groups</Button>
                    </>
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
                                        x: plot?.values ?? visibleValues,
                                        type: 'histogram',
                                        nbinsx: 40,
                                        marker: { color: 'rgba(25,118,210,0.3)', line: { color: '#1976d2', width: 1 } },
                                        name: 'Data',
                                    } as any,
                                    ...gaussianTraces as any[],
                                ]}
                                layout={{
                                    title: { text: `Population Separation: ${result.column} (${result.nPopulations} populations)` },
                                    autosize: true,
                                    height: 400,
                                    margin: { l: 60, r: 30, t: 50, b: 50 },
                                    xaxis: plot?.ticks
                                        ? { title: { text: `${result.column} (log scale)` }, tickvals: plot.ticks.tickvals, ticktext: plot.ticks.ticktext }
                                        : { title: { text: result.column } },
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
                                <TextField
                                    variant="standard" size="small" fullWidth
                                    value={popNames[idx] ?? ''}
                                    onChange={e => setPopNames(prev => prev.map((n, k) => (k === idx ? e.target.value : n)))}
                                    inputProps={{ 'aria-label': `Name of population ${pop.id + 1}`, style: { fontWeight: 700 } }}
                                    sx={{ mb: 0.5 }}
                                />
                                <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                                    {CLASSIFICATION_LABELS[pop.classification] ?? pop.classification}
                                </Typography>
                                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5, '& > *': { fontSize: '0.8rem' } }}>
                                    <Typography variant="body2">{result.logScale ? 'Geo. mean:' : 'Mean:'}</Typography>
                                    <Typography variant="body2" align="right">{pop.mean.toFixed(3)}</Typography>
                                    <Typography variant="body2">{result.logScale ? 'Geo. SD (×/÷):' : 'Std Dev:'}</Typography>
                                    <Typography variant="body2" align="right">{pop.stdDev.toFixed(3)}</Typography>
                                    {result.logScale && pop.logMean !== undefined && (<>
                                        <Typography variant="body2">log10 mean ± SD:</Typography>
                                        <Typography variant="body2" align="right">{pop.logMean.toFixed(3)} ± {pop.logStd?.toFixed(3)}</Typography>
                                    </>)}
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

                    {result.separationPoints.length > 0 && (
                        <Typography variant="body2" sx={{ mt: 2 }}>
                            Thresholds{result.logScale ? ' (where the fitted log-normal populations are equally likely)' : ''}: <strong>{result.separationPoints.map(t => t.toPrecision(4)).join(', ')}</strong>
                        </Typography>
                    )}
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
