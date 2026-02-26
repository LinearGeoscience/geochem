import React, { useState, useMemo, useCallback } from 'react';
import { Box, Paper, Typography, Button, Select, MenuItem, FormControl, InputLabel, ToggleButtonGroup, ToggleButton, CircularProgress, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@mui/material';
import Plot from 'react-plotly.js';
import { useAppStore } from '../../store/appStore';
import { useShallow } from 'zustand/react/shallow';
import { useAttributeStore } from '../../store/attributeStore';
import { getStyleArrays, getStyleArraysColumnar, sortColumnsByPriority } from '../../utils/attributeUtils';
import { performRobustRegression } from '../../utils/statistics/robustRegression';
import type { RegressionMethod, RegressionResult, RobustRegressionConfig, GroupedRegressionResult } from '../../types/statistics';
import { getPlotConfig } from '../../utils/plotConfig';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';

function isGroupedResult(r: RegressionResult | GroupedRegressionResult): r is GroupedRegressionResult {
    return 'groups' in r;
}

const CONFIDENCE_LEVELS = [
    { value: 0.90, label: '90%' },
    { value: 0.95, label: '95%' },
    { value: 0.99, label: '99%' },
];

export const RobustRegressionView: React.FC = () => {
    const { data, columns, columnarRowCount } = useAppStore(useShallow(s => ({
        data: s.data,
        columns: s.columns,
        columnarRowCount: s.columnarData.rowCount,
    })));
    const getFilteredColumns = useAppStore(s => s.getFilteredColumns);
    const getColumn = useAppStore(s => s.getColumn);
    const columnFilter = useAppStore(s => s.columnFilter);
    const filteredColumns = useMemo(() => getFilteredColumns(), [columns, columnFilter, getFilteredColumns]);
    useAttributeStore(s => s.filter);

    const [xColumn, setXColumn] = useState('');
    const [yColumn, setYColumn] = useState('');
    const [method, setMethod] = useState<RegressionMethod>('ols');
    const [confidenceLevel, setConfidenceLevel] = useState(0.95);
    const [groupColumn, setGroupColumn] = useState('');
    const [result, setResult] = useState<RegressionResult | GroupedRegressionResult | null>(null);
    const [loading, setLoading] = useState(false);

    const numericColumns = useMemo(() => sortColumnsByPriority(
        filteredColumns.filter(c => c.type === 'numeric' || c.type === 'float' || c.type === 'integer')
    ), [filteredColumns]);

    const allNumericColumns = useMemo(() => sortColumnsByPriority(
        columns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))
    ), [columns]);

    const categoricalColumns = useMemo(() =>
        columns.filter(c => c && c.name && c.type === 'string'),
    [columns]);

    const runRegression = useCallback(() => {
        if (!xColumn || !yColumn) return;
        setLoading(true);
        const currentStyleArrays = columnarRowCount > 0
            ? getStyleArraysColumnar(data.length, (name) => getColumn(name))
            : getStyleArrays(data);

        setTimeout(() => {
            try {
                const visibleData: Record<string, any>[] = [];
                for (let i = 0; i < data.length; i++) {
                    if (currentStyleArrays.visible[i]) {
                        visibleData.push(data[i]);
                    }
                }

                const config: RobustRegressionConfig = {
                    method,
                    xColumn,
                    yColumn,
                    confidenceLevel,
                    groupColumn: groupColumn || undefined,
                };

                const res = performRobustRegression(visibleData, config);
                setResult(res);
            } catch (error) {
                console.error('Regression failed:', error);
            } finally {
                setLoading(false);
            }
        }, 10);
    }, [xColumn, yColumn, method, confidenceLevel, groupColumn, data]);

    // Get the primary result (global or ungrouped)
    const primaryResult: RegressionResult | null = useMemo(() => {
        if (!result) return null;
        if (isGroupedResult(result)) return result.globalResult ?? null;
        return result;
    }, [result]);

    // Extract visible data for plotting
    const plotData = useMemo(() => {
        if (!xColumn || !yColumn || !primaryResult) return null;
        const styleArrays = columnarRowCount > 0
            ? getStyleArraysColumnar(data.length, (name) => getColumn(name))
            : getStyleArrays(data);
        const xVals: number[] = [];
        const yVals: number[] = [];
        const indices: number[] = [];
        let visIdx = 0;
        for (let i = 0; i < data.length; i++) {
            if (styleArrays.visible[i]) {
                const xv = parseFloat(data[i][xColumn]);
                const yv = parseFloat(data[i][yColumn]);
                if (!isNaN(xv) && !isNaN(yv)) {
                    xVals.push(xv);
                    yVals.push(yv);
                    indices.push(visIdx);
                }
                visIdx++;
            }
        }
        return { xVals, yVals, indices };
    }, [xColumn, yColumn, primaryResult, data]);

    const colOptions = numericColumns.length > 0 ? numericColumns : allNumericColumns;

    return (
        <Box sx={{ p: 3 }}>
            <Typography variant="h5" gutterBottom>Robust Regression</Typography>

            <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <FormControl size="small" sx={{ minWidth: 160 }}>
                    <InputLabel>X Column</InputLabel>
                    <Select value={xColumn} label="X Column" onChange={(e) => setXColumn(e.target.value)}>
                        {colOptions.map(c => <MenuItem key={c.name} value={c.name}>{c.name}</MenuItem>)}
                    </Select>
                </FormControl>

                <FormControl size="small" sx={{ minWidth: 160 }}>
                    <InputLabel>Y Column</InputLabel>
                    <Select value={yColumn} label="Y Column" onChange={(e) => setYColumn(e.target.value)}>
                        {colOptions.map(c => <MenuItem key={c.name} value={c.name}>{c.name}</MenuItem>)}
                    </Select>
                </FormControl>

                <ToggleButtonGroup
                    value={method}
                    exclusive
                    onChange={(_, v) => { if (v) setMethod(v); }}
                    size="small"
                >
                    <ToggleButton value="ols">OLS</ToggleButton>
                    <ToggleButton value="lts">LTS</ToggleButton>
                    <ToggleButton value="bisquare">Bisquare</ToggleButton>
                    <ToggleButton value="huber">Huber</ToggleButton>
                </ToggleButtonGroup>

                <FormControl size="small" sx={{ minWidth: 100 }}>
                    <InputLabel>Confidence</InputLabel>
                    <Select value={confidenceLevel} label="Confidence" onChange={(e) => setConfidenceLevel(Number(e.target.value))}>
                        {CONFIDENCE_LEVELS.map(cl => <MenuItem key={cl.value} value={cl.value}>{cl.label}</MenuItem>)}
                    </Select>
                </FormControl>

                <FormControl size="small" sx={{ minWidth: 140 }}>
                    <InputLabel>Group (optional)</InputLabel>
                    <Select value={groupColumn} label="Group (optional)" onChange={(e) => setGroupColumn(e.target.value)}>
                        <MenuItem value="">None</MenuItem>
                        {categoricalColumns.map(c => <MenuItem key={c.name} value={c.name}>{c.name}</MenuItem>)}
                    </Select>
                </FormControl>

                <Button
                    variant="contained"
                    onClick={runRegression}
                    disabled={!xColumn || !yColumn || loading}
                >
                    Run Regression
                </Button>

                {primaryResult && plotData && (
                    <Button
                        variant="outlined"
                        size="small"
                        onClick={() => {
                            const lines: string[] = [];
                            lines.push('Diagnostics');
                            lines.push(`Method,${method.toUpperCase()}`);
                            lines.push(`R2,${primaryResult.rSquared.toFixed(6)}`);
                            lines.push(`Slope,${primaryResult.slope.toFixed(6)}`);
                            lines.push(`SlopeCI,"[${primaryResult.confidenceInterval.slope[0].toFixed(6)}, ${primaryResult.confidenceInterval.slope[1].toFixed(6)}]"`);
                            lines.push(`Intercept,${primaryResult.intercept.toFixed(6)}`);
                            lines.push(`InterceptCI,"[${primaryResult.confidenceInterval.intercept[0].toFixed(6)}, ${primaryResult.confidenceInterval.intercept[1].toFixed(6)}]"`);
                            lines.push(`RMSE,${primaryResult.diagnostics.rmse.toFixed(6)}`);
                            lines.push(`MAE,${primaryResult.diagnostics.mae.toFixed(6)}`);
                            lines.push(`N,${primaryResult.diagnostics.n}`);
                            lines.push(`Outliers,${primaryResult.outlierIndices.length}`);
                            lines.push('');
                            lines.push(`${xColumn},${yColumn},Fitted,Residual,Outlier`);
                            const outlierSet = new Set(primaryResult.outlierIndices);
                            for (let i = 0; i < plotData.xVals.length; i++) {
                                const origIdx = plotData.indices[i];
                                lines.push([
                                    plotData.xVals[i], plotData.yVals[i],
                                    primaryResult.fittedValues[origIdx]?.toFixed(6) ?? '',
                                    primaryResult.residuals[origIdx]?.toFixed(6) ?? '',
                                    outlierSet.has(origIdx) ? 'Yes' : 'No'
                                ].join(','));
                            }
                            const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url; a.download = `regression_${xColumn}_${yColumn}.csv`; a.click();
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
            ) : primaryResult && plotData && (
                <>
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3, mb: 3 }}>
                        {/* Scatter plot with regression line + prediction bands */}
                        <Paper sx={{ p: 2 }}>
                            <ExpandablePlotWrapper>
                                <Plot
                                    data={(() => {
                                        const traces: Plotly.Data[] = [];
                                        const outlierSet = new Set(primaryResult.outlierIndices);

                                        // Normal points
                                        const normalX: number[] = [];
                                        const normalY: number[] = [];
                                        const outlierX: number[] = [];
                                        const outlierY: number[] = [];

                                        for (let i = 0; i < plotData.xVals.length; i++) {
                                            const origIdx = plotData.indices[i];
                                            if (outlierSet.has(origIdx)) {
                                                outlierX.push(plotData.xVals[i]);
                                                outlierY.push(plotData.yVals[i]);
                                            } else {
                                                normalX.push(plotData.xVals[i]);
                                                normalY.push(plotData.yVals[i]);
                                            }
                                        }

                                        traces.push({
                                            x: normalX, y: normalY,
                                            type: 'scatter', mode: 'markers',
                                            marker: { color: '#1976d2', size: 5, opacity: 0.6 },
                                            name: 'Data',
                                        } as any);

                                        if (outlierX.length > 0) {
                                            traces.push({
                                                x: outlierX, y: outlierY,
                                                type: 'scatter', mode: 'markers',
                                                marker: { color: '#d32f2f', size: 8, symbol: 'x' },
                                                name: 'Outliers',
                                            } as any);
                                        }

                                        // Regression line
                                        const sortedX = [...plotData.xVals].sort((a, b) => a - b);
                                        const lineX = [sortedX[0], sortedX[sortedX.length - 1]];
                                        const lineY = lineX.map(x => primaryResult.slope * x + primaryResult.intercept);
                                        traces.push({
                                            x: lineX, y: lineY,
                                            type: 'scatter', mode: 'lines',
                                            line: { color: '#d32f2f', width: 2 },
                                            name: 'Regression',
                                        } as any);

                                        // Prediction bands
                                        const bandX: number[] = [];
                                        const bandLower: number[] = [];
                                        const bandUpper: number[] = [];
                                        for (let i = 0; i < primaryResult.predictionBands.lower.length; i++) {
                                            const lo = primaryResult.predictionBands.lower[i];
                                            const hi = primaryResult.predictionBands.upper[i];
                                            const fit = primaryResult.fittedValues[i];
                                            if (lo != null && hi != null && fit != null) {
                                                // Get the x value for this index from visible data
                                                bandX.push(plotData.xVals[bandLower.length] ?? 0);
                                                bandLower.push(lo);
                                                bandUpper.push(hi);
                                            }
                                        }

                                        // Sort by x for proper band display
                                        if (bandX.length > 0) {
                                            const sortedBand = bandX.map((x, i) => ({ x, lo: bandLower[i], hi: bandUpper[i] }))
                                                .sort((a, b) => a.x - b.x);

                                            traces.push({
                                                x: sortedBand.map(b => b.x),
                                                y: sortedBand.map(b => b.hi),
                                                type: 'scatter', mode: 'lines',
                                                line: { color: 'rgba(25,118,210,0.3)', dash: 'dash', width: 1 },
                                                name: `${(confidenceLevel * 100).toFixed(0)}% PI`,
                                                showlegend: true,
                                            } as any);
                                            traces.push({
                                                x: sortedBand.map(b => b.x),
                                                y: sortedBand.map(b => b.lo),
                                                type: 'scatter', mode: 'lines',
                                                line: { color: 'rgba(25,118,210,0.3)', dash: 'dash', width: 1 },
                                                fill: 'tonexty',
                                                fillcolor: 'rgba(25,118,210,0.08)',
                                                name: 'PI lower',
                                                showlegend: false,
                                            } as any);
                                        }

                                        return traces;
                                    })()}
                                    layout={{
                                        title: { text: `${yColumn} vs ${xColumn} (${method.toUpperCase()})` },
                                        autosize: true,
                                        height: 400,
                                        margin: { l: 60, r: 30, t: 50, b: 50 },
                                        xaxis: { title: { text: xColumn } },
                                        yaxis: { title: { text: yColumn } },
                                        showlegend: true,
                                        legend: { x: 0.02, y: 0.98, bgcolor: 'rgba(255,255,255,0.8)' },
                                    }}
                                    config={getPlotConfig({ filename: `regression_${xColumn}_${yColumn}` })}
                                    style={{ width: '100%' }}
                                    useResizeHandler={true}
                                />
                            </ExpandablePlotWrapper>
                        </Paper>

                        {/* Residual plot */}
                        <Paper sx={{ p: 2 }}>
                            <ExpandablePlotWrapper>
                                <Plot
                                    data={(() => {
                                        const fitted: number[] = [];
                                        const resids: number[] = [];
                                        for (let i = 0; i < primaryResult.fittedValues.length; i++) {
                                            const f = primaryResult.fittedValues[i];
                                            const r = primaryResult.residuals[i];
                                            if (f != null && r != null) {
                                                fitted.push(f);
                                                resids.push(r);
                                            }
                                        }
                                        return [{
                                            x: fitted,
                                            y: resids,
                                            type: 'scatter',
                                            mode: 'markers',
                                            marker: { color: '#1976d2', size: 5, opacity: 0.6 },
                                            name: 'Residuals',
                                        } as any];
                                    })()}
                                    layout={{
                                        title: { text: 'Residuals vs Fitted' },
                                        autosize: true,
                                        height: 400,
                                        margin: { l: 60, r: 30, t: 50, b: 50 },
                                        xaxis: { title: { text: 'Fitted Values' } },
                                        yaxis: { title: { text: 'Residuals' } },
                                        shapes: [{
                                            type: 'line', xref: 'paper', yref: 'y',
                                            x0: 0, x1: 1, y0: 0, y1: 0,
                                            line: { color: '#999', width: 1, dash: 'dash' },
                                        }] as any,
                                        showlegend: false,
                                    }}
                                    config={getPlotConfig({ filename: `residuals_${xColumn}_${yColumn}` })}
                                    style={{ width: '100%' }}
                                    useResizeHandler={true}
                                />
                            </ExpandablePlotWrapper>
                        </Paper>
                    </Box>

                    {/* Diagnostics table */}
                    <TableContainer component={Paper}>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell><strong>Metric</strong></TableCell>
                                    <TableCell align="right"><strong>Value</strong></TableCell>
                                    <TableCell><strong>Metric</strong></TableCell>
                                    <TableCell align="right"><strong>Value</strong></TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                <TableRow>
                                    <TableCell>R²</TableCell>
                                    <TableCell align="right">{primaryResult.rSquared.toFixed(4)}</TableCell>
                                    <TableCell>RMSE</TableCell>
                                    <TableCell align="right">{primaryResult.diagnostics.rmse.toFixed(4)}</TableCell>
                                </TableRow>
                                <TableRow>
                                    <TableCell>Slope</TableCell>
                                    <TableCell align="right">
                                        {primaryResult.slope.toFixed(4)} [{primaryResult.confidenceInterval.slope[0].toFixed(4)}, {primaryResult.confidenceInterval.slope[1].toFixed(4)}]
                                    </TableCell>
                                    <TableCell>MAE</TableCell>
                                    <TableCell align="right">{primaryResult.diagnostics.mae.toFixed(4)}</TableCell>
                                </TableRow>
                                <TableRow>
                                    <TableCell>Intercept</TableCell>
                                    <TableCell align="right">
                                        {primaryResult.intercept.toFixed(4)} [{primaryResult.confidenceInterval.intercept[0].toFixed(4)}, {primaryResult.confidenceInterval.intercept[1].toFixed(4)}]
                                    </TableCell>
                                    <TableCell>N / Outliers</TableCell>
                                    <TableCell align="right">{primaryResult.diagnostics.n} / {primaryResult.outlierIndices.length}</TableCell>
                                </TableRow>
                            </TableBody>
                        </Table>
                    </TableContainer>
                </>
            )}
        </Box>
    );
};
