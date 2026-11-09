import React, { useState, useCallback, useMemo } from 'react';
import { Box, Paper, Typography, ToggleButtonGroup, ToggleButton, CircularProgress, Button, Alert, Checkbox, FormControlLabel, Select, MenuItem, FormControl, InputLabel, LinearProgress } from '@mui/material';
import Plot from '../../components/ThemedPlot';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore, useDatasetRows, COLUMN_FILTER_LABELS } from '../../store/appStore';
import { notify } from '../../store/notificationStore';
import { useAttributeStore } from '../../store/attributeStore';
import { getStyleArraysColumnar, sortColumnsByPriority } from '../../utils/attributeUtils';
import { getPlotConfig, SCREEN_FONT_SIZES } from '../../utils/plotConfig';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';
import { MultiColumnSelector } from '../../components/MultiColumnSelector';
import { useCorrelationWorker } from '../../hooks/useCorrelationWorker';
import { computeCorrelationMatrix } from '../../utils/statistics/correlation';

// Significance marker
const sigMarker = (p: number): string => {
    if (p < 0.001) return '***';
    if (p < 0.01) return '**';
    if (p < 0.05) return '*';
    return '';
};

export const CorrelationMatrix: React.FC = () => {
    const { columns, correlationSelectedColumns, columnFilter } = useAppStore(useShallow(s => ({ columns: s.columns, correlationSelectedColumns: s.correlationSelectedColumns, columnFilter: s.columnFilter })));
    const data = useDatasetRows();
    const getColumn = useAppStore(s => s.getColumn);
    const setCorrelationSelectedColumns = useAppStore(s => s.setCorrelationSelectedColumns);
    // Derived list, re-rendering only when its contents change
    const filteredColumns = useAppStore(useShallow(s => s.getFilteredColumns()));
    useAttributeStore(s => s.filter); // Subscribe to changes
    const [method, setMethod] = useState<'pearson' | 'spearman'>('pearson');
    const [correlationData, setCorrelationData] = useState<{ columns: string[], matrix: number[][], pValues: number[][], nPairs: number[][] } | null>(null);
    const [loading, setLoading] = useState(false);
    const [computeProgress, setComputeProgress] = useState(0);
    const [showSignificance, setShowSignificance] = useState(false);
    const [sigThreshold, setSigThreshold] = useState<number>(0.05);
    const { computeCorrelation } = useCorrelationWorker();

    // Dynamic layout config based on column count
    const layoutConfig = useMemo(() => {
        if (!correlationData) return null;
        const n = correlationData.columns.length;
        const maxLabelLen = Math.max(...correlationData.columns.map(c => c.length));

        const size = Math.max(500, Math.min(1200, n * 50 + 150));
        const tickangle = n >= 8 ? -45 : 0;
        const bottomMargin = tickangle !== 0
            ? Math.min(180, 40 + maxLabelLen * 5)
            : 70;
        const leftMargin = Math.min(160, 40 + maxLabelLen * 6);

        // Annotation sizing: hide at 30+, scale font/decimals with count
        let showAnnotations = true;
        let annotationFontSize = 10;
        let annotationDecimals = 2;
        if (n >= 30) {
            showAnnotations = false;
        } else if (n >= 20) {
            annotationFontSize = 7;
            annotationDecimals = 1;
        } else if (n >= 15) {
            annotationFontSize = 8;
        } else if (n >= 10) {
            annotationFontSize = 9;
        }

        return {
            size,
            tickangle,
            bottomMargin,
            leftMargin,
            showAnnotations,
            annotationFontSize,
            annotationDecimals,
        };
    }, [correlationData]);

    // Calculate correlation matrix via Web Worker (falls back to sync)
    const calculateCorrelation = useCallback(async () => {
        if (correlationSelectedColumns.length < 2) return;
        setLoading(true);
        setComputeProgress(0);

        // Get current visibility
        const currentStyleArrays = getStyleArraysColumnar(data.length, (name) => getColumn(name));
        const cols = correlationSelectedColumns;

        // Pre-compute valid numeric arrays per column (only visible rows, aligned by row index)
        const columnData: Record<string, number[]> = {};
        const visibleIndices: number[] = [];
        for (let i = 0; i < data.length; i++) {
            if (currentStyleArrays.visible[i]) visibleIndices.push(i);
        }
        for (const col of cols) {
            columnData[col] = visibleIndices.map(i => {
                const val = data[i][col];
                return (val != null && !isNaN(Number(val))) ? Number(val) : NaN;
            });
        }

        try {
            // Try Web Worker first
            const workerResult = await computeCorrelation(
                cols, columnData, method,
                (progress) => setComputeProgress(Math.round(progress * 100))
            );

            if (workerResult) {
                setCorrelationData({
                    columns: cols,
                    matrix: workerResult.matrix,
                    pValues: workerResult.pValues,
                    nPairs: workerResult.sampleCounts
                });
            } else {
                // Fallback: synchronous computation (worker unavailable or cancelled)
                const res = computeCorrelationMatrix(cols, columnData, method);
                setCorrelationData({ columns: cols, matrix: res.matrix, pValues: res.pValues, nPairs: res.sampleCounts });
            }
        } catch (error) {
            console.error('Failed to calculate correlation matrix:', error);
        } finally {
            setLoading(false);
        }
    }, [correlationSelectedColumns, data, method, computeCorrelation, getColumn]);

    const handleMethodChange = (_: React.MouseEvent<HTMLElement>, newMethod: 'pearson' | 'spearman' | null) => {
        if (newMethod !== null) {
            setMethod(newMethod);
        }
    };

    const numericColumns = sortColumnsByPriority(
        filteredColumns.filter(c => c.type === 'numeric' || c.type === 'float' || c.type === 'integer')
    );

    const allNumericColumns = useMemo(() => sortColumnsByPriority(
        columns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))
    ), [columns]);

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
                <MultiColumnSelector
                    columns={numericColumns}
                    allColumns={allNumericColumns}
                    selectedColumns={correlationSelectedColumns}
                    onChange={setCorrelationSelectedColumns}
                    label="Select Columns"
                />

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

                {correlationData && (
                    <Button
                        variant="outlined"
                        size="small"
                        onClick={() => {
                            const cols = correlationData.columns;
                            const lines: string[] = [];
                            // Correlation matrix
                            lines.push(['', ...cols].join(','));
                            for (let i = 0; i < cols.length; i++) {
                                lines.push([cols[i], ...correlationData.matrix[i].map(v => v.toFixed(4))].join(','));
                            }
                            if (showSignificance) {
                                lines.push('');
                                lines.push('P-values');
                                lines.push(['', ...cols].join(','));
                                for (let i = 0; i < cols.length; i++) {
                                    lines.push([cols[i], ...correlationData.pValues[i].map(v => v.toFixed(6))].join(','));
                                }
                            }
                            const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url; a.download = 'correlation_matrix.csv'; a.click();
                            URL.revokeObjectURL(url);
                        }}
                    >
                        Export CSV
                    </Button>
                )}

                {correlationData && (
                    <Button
                        variant="outlined"
                        size="small"
                        onClick={async () => {
                            const cols = correlationData.columns;
                            const lines: string[] = [['', ...cols].join('\t')];
                            for (let i = 0; i < cols.length; i++) {
                                lines.push([cols[i], ...correlationData.matrix[i].map(v => v.toFixed(4))].join('\t'));
                            }
                            try {
                                await navigator.clipboard.writeText(lines.join('\n'));
                                notify('Correlation matrix copied — paste straight into Excel', 'success');
                            } catch {
                                notify('Copy failed — your browser blocked clipboard access', 'warning');
                            }
                        }}
                    >
                        Copy
                    </Button>
                )}

                {correlationData && (
                    <>
                        <FormControlLabel
                            control={<Checkbox checked={showSignificance} onChange={(_, v) => setShowSignificance(v)} size="small" />}
                            label="Show significance"
                        />
                        {showSignificance && (
                            <FormControl size="small" sx={{ minWidth: 100 }}>
                                <InputLabel>Threshold</InputLabel>
                                <Select value={sigThreshold} label="Threshold" onChange={(e) => setSigThreshold(Number(e.target.value))}>
                                    <MenuItem value={0.05}>p &lt; 0.05</MenuItem>
                                    <MenuItem value={0.01}>p &lt; 0.01</MenuItem>
                                    <MenuItem value={0.001}>p &lt; 0.001</MenuItem>
                                </Select>
                            </FormControl>
                        )}
                    </>
                )}
            </Box>

            {loading ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, p: 4 }}>
                    {computeProgress > 0 ? (
                        <>
                            <LinearProgress variant="determinate" value={computeProgress} sx={{ width: '50%' }} />
                            <Typography variant="body2" color="text.secondary">
                                Computing correlations... {computeProgress}%
                            </Typography>
                        </>
                    ) : (
                        <CircularProgress />
                    )}
                </Box>
            ) : correlationData ? (
                <Paper sx={{ p: 2, maxWidth: '100%', overflowX: 'auto' }}>
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
                                hovertemplate: '%{y} vs %{x}<br>Correlation: %{z:.3f}<extra></extra>',
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
                                    font: { size: SCREEN_FONT_SIZES.title }
                                },
                                autosize: false,
                                width: layoutConfig?.size,
                                height: layoutConfig?.size,
                                font: { size: SCREEN_FONT_SIZES.tickLabels },
                                margin: {
                                    l: layoutConfig?.leftMargin ?? 70,
                                    r: 80,
                                    t: 70,
                                    b: layoutConfig?.bottomMargin ?? 70,
                                },
                                xaxis: {
                                    tickangle: layoutConfig?.tickangle ?? 0,
                                    side: 'bottom',
                                    tickfont: { size: SCREEN_FONT_SIZES.tickLabels },
                                    automargin: true,
                                },
                                yaxis: {
                                    autorange: 'reversed',
                                    tickfont: { size: SCREEN_FONT_SIZES.tickLabels },
                                    automargin: true,
                                },
                                ...(layoutConfig?.showAnnotations ? {
                                    annotations: correlationData.matrix.flatMap((row, i) =>
                                        row.map((value, j) => {
                                            const pVal = correlationData.pValues[i][j];
                                            const sig = showSignificance ? sigMarker(pVal) : '';
                                            const valText = value.toFixed(layoutConfig.annotationDecimals);
                                            return {
                                                x: correlationData.columns[j],
                                                y: correlationData.columns[i],
                                                text: sig ? `${valText}${sig}` : valText,
                                                font: {
                                                    size: layoutConfig.annotationFontSize,
                                                    color: Math.abs(value) > 0.5 ? 'white' : 'black'
                                                },
                                                showarrow: false,
                                            };
                                        })
                                    ),
                                } : {}),
                            }}
                            config={getPlotConfig({ filename: 'correlation_matrix' })}
                        />
                    </ExpandablePlotWrapper>
                    {showSignificance && (
                        <Typography variant="caption" sx={{ mt: 1, display: 'block', color: 'text.secondary' }}>
                            * p &lt; 0.05 &nbsp;&nbsp; ** p &lt; 0.01 &nbsp;&nbsp; *** p &lt; 0.001
                        </Typography>
                    )}
                </Paper>
            ) : (
                <Typography color="text.secondary">
                    Select at least 2 columns to view correlation matrix
                </Typography>
            )}
        </Box>
    );
};
