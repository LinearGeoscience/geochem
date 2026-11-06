import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Box, Paper, Typography, Button, Select, MenuItem, FormControl, InputLabel, Slider, ToggleButtonGroup, ToggleButton, CircularProgress, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Checkbox, FormControlLabel } from '@mui/material';
import Plot from '../../components/ThemedPlot';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore, useDatasetRows } from '../../store/appStore';
import { useAttributeStore } from '../../store/attributeStore';
import { getStyleArraysColumnar, sortColumnsByPriority } from '../../utils/attributeUtils';
import { MultiColumnSelector } from '../../components/MultiColumnSelector';
import { analysisInWorker } from '../../utils/analysisWorker';
import type { EnhancedClusteringConfig, EnhancedClusteringResult } from '../../types/statistics';
import { getPlotConfig } from '../../utils/plotConfig';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';

const CLUSTER_COLORS = [
    '#1976d2', '#d32f2f', '#2e7d32', '#f57c00', '#7b1fa2',
    '#00838f', '#c62828', '#558b2f', '#e65100', '#4a148c',
];

// PCA projection now uses the shared deterministic pca2d (utils/calculations/
// eigen.ts) computed in the analysis web worker — the old inline power
// iteration with random init made the plot layout vary between runs.

export const ClusteringAnalysis: React.FC = () => {
    const { columns, columnarRowCount } = useAppStore(useShallow(s => ({ columns: s.columns, columnarRowCount: s.columnarData.rowCount })));
    const data = useDatasetRows();
    const getColumn = useAppStore(s => s.getColumn);
    const getFilteredColumns = useAppStore(s => s.getFilteredColumns);
    const columnFilter = useAppStore(s => s.columnFilter);
    const filteredColumns = useMemo(() => getFilteredColumns(), [columns, columnFilter, getFilteredColumns]);
    useAttributeStore(s => s.filter);

    const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
    const [method, setMethod] = useState<'kmeans' | 'hierarchical'>('kmeans');
    const [k, setK] = useState(3);
    const [transformation, setTransformation] = useState<'none' | 'zscore' | 'clr'>('zscore');
    const [autoK, setAutoK] = useState(false);
    const [result, setResult] = useState<EnhancedClusteringResult | null>(null);
    const [loading, setLoading] = useState(false);

    const numericColumns = useMemo(() => sortColumnsByPriority(
        filteredColumns.filter(c => c.type === 'numeric' || c.type === 'float' || c.type === 'integer')
    ), [filteredColumns]);

    const allNumericColumns = useMemo(() => sortColumnsByPriority(
        columns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))
    ), [columns]);

    const runClustering = useCallback(async () => {
        if (selectedColumns.length < 2) return;
        setLoading(true);
        const currentStyleArrays = getStyleArraysColumnar(data.length, (name) => getColumn(name));

        try {
            const visibleData: Record<string, any>[] = [];
            for (let i = 0; i < data.length; i++) {
                if (currentStyleArrays.visible[i]) {
                    visibleData.push(data[i]);
                }
            }

            const config: EnhancedClusteringConfig = {
                method,
                columns: selectedColumns,
                k: autoK ? undefined : k,
                kRange: autoK ? [2, 10] : undefined,
                transformationType: transformation,
                calculateSilhouette: true,
                nInitializations: 10,
                maxIterations: 100,
            };

            // Off the main thread — clustering froze the tab on large data
            const res = await analysisInWorker<EnhancedClusteringResult>(
                'clustering', { data: visibleData, config });
            if (autoK && res.optimalK) {
                setK(res.optimalK);
            }
            setResult(res);
        } catch (error) {
            console.error('Clustering failed:', error);
        } finally {
            setLoading(false);
        }
    }, [selectedColumns, method, k, autoK, transformation, data, columnarRowCount, getColumn]);

    // PCA projection for scatter plot (computed in the analysis worker)
    const [pcaData, setPcaData] = useState<{
        pc1: number[]; pc2: number[]; explained: [number, number]; assignments: (number | null)[];
    } | null>(null);

    useEffect(() => {
        if (!result || !result.assignments) { setPcaData(null); return; }

        const styleArrays = getStyleArraysColumnar(data.length, (name) => getColumn(name));
        const matrix: number[][] = [];
        const validIndices: number[] = [];

        let visIdx = 0;
        for (let i = 0; i < data.length; i++) {
            if (styleArrays.visible[i]) {
                const row: number[] = [];
                let valid = true;
                for (const col of selectedColumns) {
                    const v = parseFloat(data[i][col]);
                    if (isNaN(v)) { valid = false; break; }
                    row.push(v);
                }
                if (valid) {
                    matrix.push(row);
                    validIndices.push(visIdx);
                }
                visIdx++;
            }
        }

        if (matrix.length < 3) { setPcaData(null); return; }

        let cancelled = false;
        analysisInWorker<{ pc1: number[]; pc2: number[]; explained: [number, number] }>(
            'pca2d', { matrix })
            .then(({ pc1, pc2, explained }) => {
                if (cancelled) return;
                // Map cluster assignments to valid indices
                const assignments = validIndices.map(vi => result.assignments[vi]);
                setPcaData({ pc1, pc2, explained, assignments });
            })
            .catch(err => {
                console.error('PCA projection failed:', err);
                if (!cancelled) setPcaData(null);
            });
        return () => { cancelled = true; };
    }, [result, data, selectedColumns, columnarRowCount, getColumn]);

    return (
        <Box sx={{ p: 3 }}>
            <Typography variant="h5" gutterBottom>Clustering Analysis</Typography>

            <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <MultiColumnSelector
                    columns={numericColumns}
                    allColumns={allNumericColumns}
                    selectedColumns={selectedColumns}
                    onChange={setSelectedColumns}
                    label="Feature Columns"
                />

                <FormControl size="small" sx={{ minWidth: 140 }}>
                    <InputLabel>Method</InputLabel>
                    <Select value={method} label="Method" onChange={(e) => setMethod(e.target.value as 'kmeans' | 'hierarchical')}>
                        <MenuItem value="kmeans">K-Means</MenuItem>
                        <MenuItem value="hierarchical">Hierarchical</MenuItem>
                    </Select>
                </FormControl>

                <Box sx={{ minWidth: 150 }}>
                    <Typography variant="caption" color="text.secondary">Clusters: {k}</Typography>
                    <Slider
                        value={k}
                        onChange={(_, v) => setK(v as number)}
                        min={2} max={10} step={1}
                        size="small"
                        marks
                        valueLabelDisplay="auto"
                    />
                </Box>

                <ToggleButtonGroup
                    value={transformation}
                    exclusive
                    onChange={(_, v) => { if (v) setTransformation(v); }}
                    size="small"
                >
                    <ToggleButton value="none">None</ToggleButton>
                    <ToggleButton value="zscore">Z-Score</ToggleButton>
                    <ToggleButton value="clr">CLR</ToggleButton>
                </ToggleButtonGroup>

                <FormControlLabel
                    control={<Checkbox checked={autoK} onChange={(_, v) => setAutoK(v)} size="small" />}
                    label="Auto-detect K"
                />

                <Button
                    variant="contained"
                    onClick={runClustering}
                    disabled={selectedColumns.length < 2 || loading}
                >
                    Run Clustering
                </Button>

                {result && (
                    <Button
                        variant="outlined"
                        size="small"
                        onClick={() => {
                            const lines: string[] = [];
                            if (result.clusterStats) {
                                lines.push(['Cluster', 'Count', 'Proportion', ...selectedColumns.map(c => `Mean_${c}`)].join(','));
                                for (const cs of result.clusterStats) {
                                    lines.push([
                                        cs.clusterId + 1, cs.count, (cs.proportion * 100).toFixed(1) + '%',
                                        ...selectedColumns.map(c => cs.meanByColumn[c]?.toFixed(4) ?? '')
                                    ].join(','));
                                }
                            }
                            if (result.avgSilhouette != null) {
                                lines.push('');
                                lines.push(`AvgSilhouette,${result.avgSilhouette.toFixed(4)}`);
                            }
                            if (result.bssOverTss != null) {
                                lines.push(`BSS/TSS,${(result.bssOverTss * 100).toFixed(1)}%`);
                            }
                            if (result.elbowData) {
                                lines.push('');
                                lines.push('K,Inertia,Silhouette');
                                for (const ed of result.elbowData) {
                                    lines.push([ed.k, ed.inertia.toFixed(2), ed.silhouette?.toFixed(4) ?? ''].join(','));
                                }
                            }
                            const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url; a.download = 'clustering_results.csv'; a.click();
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
                    <Box sx={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 3, mb: 3 }}>
                        {/* PCA scatter plot colored by cluster */}
                        <Paper sx={{ p: 2 }}>
                            {pcaData ? (
                                <ExpandablePlotWrapper>
                                    <Plot
                                        data={Array.from({ length: result.k }, (_, ci) => {
                                            const idx = pcaData.assignments
                                                .map((a, i) => a === ci ? i : -1)
                                                .filter(i => i >= 0);
                                            return {
                                                x: idx.map(i => pcaData.pc1[i]),
                                                y: idx.map(i => pcaData.pc2[i]),
                                                type: 'scatter' as const,
                                                mode: 'markers' as const,
                                                marker: { color: CLUSTER_COLORS[ci % CLUSTER_COLORS.length], size: 5, opacity: 0.7 },
                                                name: `Cluster ${ci + 1} (n=${idx.length})`,
                                            };
                                        })}
                                        layout={{
                                            title: { text: 'PCA Projection by Cluster' },
                                            autosize: true,
                                            height: 450,
                                            margin: { l: 60, r: 30, t: 50, b: 50 },
                                            xaxis: { title: { text: `PC1 (${pcaData.explained[0].toFixed(1)}%)` } },
                                            yaxis: { title: { text: `PC2 (${pcaData.explained[1].toFixed(1)}%)` } },
                                            showlegend: true,
                                            legend: { x: 0.02, y: 0.98, bgcolor: 'rgba(255,255,255,0.8)' },
                                        }}
                                        config={getPlotConfig({ filename: 'clustering_pca' })}
                                        style={{ width: '100%' }}
                                        useResizeHandler={true}
                                    />
                                </ExpandablePlotWrapper>
                            ) : (
                                <Typography color="text.secondary">Insufficient data for PCA projection</Typography>
                            )}
                        </Paper>

                        {/* Silhouette bar chart */}
                        <Paper sx={{ p: 2 }}>
                            {result.clusterStats && (
                                <ExpandablePlotWrapper>
                                    <Plot
                                        data={[{
                                            x: result.clusterStats.map(cs => `Cluster ${cs.clusterId + 1}`),
                                            y: result.clusterStats.map(cs => {
                                                // Average silhouette per cluster
                                                if (!result.silhouetteScores || !result.assignments) return 0;
                                                const clusterIndices = result.assignments
                                                    .map((a, i) => a === cs.clusterId ? i : -1)
                                                    .filter(i => i >= 0);
                                                const scores = clusterIndices
                                                    .filter(i => i < result.silhouetteScores!.length)
                                                    .map(i => result.silhouetteScores![i]);
                                                return scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
                                            }),
                                            type: 'bar',
                                            marker: {
                                                color: result.clusterStats.map((_, i) => CLUSTER_COLORS[i % CLUSTER_COLORS.length]),
                                            },
                                        } as any]}
                                        layout={{
                                            title: { text: `Avg Silhouette: ${(result.avgSilhouette ?? 0).toFixed(3)}` },
                                            autosize: true,
                                            height: 300,
                                            margin: { l: 50, r: 20, t: 50, b: 40 },
                                            yaxis: { title: { text: 'Silhouette Score' }, range: [-0.2, 1] },
                                            showlegend: false,
                                        }}
                                        config={{ displayModeBar: false }}
                                        style={{ width: '100%' }}
                                        useResizeHandler={true}
                                    />
                                </ExpandablePlotWrapper>
                            )}

                            {/* Quality metrics */}
                            <Box sx={{ mt: 2 }}>
                                {result.bssOverTss != null && (
                                    <Typography variant="body2">BSS/TSS: {(result.bssOverTss * 100).toFixed(1)}%</Typography>
                                )}
                                {result.withinClusterSS != null && (
                                    <Typography variant="body2">Within-cluster SS: {result.withinClusterSS.toFixed(2)}</Typography>
                                )}
                            </Box>
                        </Paper>
                    </Box>

                    {/* Elbow / Silhouette curve for auto-K */}
                    {result.elbowData && result.elbowData.length > 0 && (
                        <Paper sx={{ p: 2, mb: 3 }}>
                            <ExpandablePlotWrapper>
                                <Plot
                                    data={[
                                        {
                                            x: result.elbowData.map(d => d.k),
                                            y: result.elbowData.map(d => d.inertia),
                                            type: 'scatter',
                                            mode: 'lines+markers',
                                            marker: { color: '#1976d2', size: 8 },
                                            line: { color: '#1976d2', width: 2 },
                                            name: 'Inertia',
                                            yaxis: 'y',
                                        } as any,
                                        ...(result.elbowData.some(d => d.silhouette != null) ? [{
                                            x: result.elbowData.map(d => d.k),
                                            y: result.elbowData.map(d => d.silhouette ?? 0),
                                            type: 'scatter' as const,
                                            mode: 'lines+markers' as const,
                                            marker: { color: '#2e7d32', size: 8 },
                                            line: { color: '#2e7d32', width: 2 },
                                            name: 'Silhouette',
                                            yaxis: 'y2',
                                        }] : []),
                                        ...(result.optimalK ? [{
                                            x: [result.optimalK],
                                            y: [result.elbowData.find(d => d.k === result!.optimalK)?.inertia ?? 0],
                                            type: 'scatter' as const,
                                            mode: 'markers' as const,
                                            marker: { color: '#d32f2f', size: 14, symbol: 'star' },
                                            name: `Optimal K=${result.optimalK}`,
                                            yaxis: 'y',
                                        }] : []),
                                    ]}
                                    layout={{
                                        title: { text: `Elbow Curve${result.optimalK ? ` — Optimal K = ${result.optimalK}` : ''}` },
                                        autosize: true,
                                        height: 300,
                                        margin: { l: 60, r: 60, t: 50, b: 40 },
                                        xaxis: { title: { text: 'Number of Clusters (K)' }, dtick: 1 },
                                        yaxis: { title: { text: 'Inertia' }, side: 'left' },
                                        yaxis2: {
                                            title: { text: 'Silhouette Score' },
                                            side: 'right',
                                            overlaying: 'y',
                                            range: [-0.1, 1],
                                        },
                                        showlegend: true,
                                        legend: { x: 0.5, y: 1.15, orientation: 'h', xanchor: 'center' },
                                    }}
                                    config={{ displayModeBar: false }}
                                    style={{ width: '100%' }}
                                    useResizeHandler={true}
                                />
                            </ExpandablePlotWrapper>
                        </Paper>
                    )}

                    {/* Cluster statistics table */}
                    {result.clusterStats && (
                        <TableContainer component={Paper}>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell><strong>Cluster</strong></TableCell>
                                        <TableCell align="right"><strong>Count</strong></TableCell>
                                        <TableCell align="right"><strong>Proportion</strong></TableCell>
                                        {selectedColumns.map(col => (
                                            <TableCell key={col} align="right"><strong>{col}</strong></TableCell>
                                        ))}
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {result.clusterStats.map((cs) => (
                                        <TableRow key={cs.clusterId} hover>
                                            <TableCell>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                    <Box sx={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: CLUSTER_COLORS[cs.clusterId % CLUSTER_COLORS.length] }} />
                                                    Cluster {cs.clusterId + 1}
                                                </Box>
                                            </TableCell>
                                            <TableCell align="right">{cs.count}</TableCell>
                                            <TableCell align="right">{(cs.proportion * 100).toFixed(1)}%</TableCell>
                                            {selectedColumns.map(col => (
                                                <TableCell key={col} align="right">
                                                    {cs.meanByColumn[col] != null
                                                        ? cs.meanByColumn[col].toFixed(3)
                                                        : 'N/A'}
                                                </TableCell>
                                            ))}
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    )}
                </>
            )}
        </Box>
    );
};
