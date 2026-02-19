import React, { useState, useCallback, useMemo } from 'react';
import { Box, Paper, Typography, ToggleButtonGroup, ToggleButton, CircularProgress, Button, Alert } from '@mui/material';
import Plot from 'react-plotly.js';
import { useAppStore, COLUMN_FILTER_LABELS } from '../../store/appStore';
import { useAttributeStore } from '../../store/attributeStore';
import { getStyleArrays, sortColumnsByPriority } from '../../utils/attributeUtils';
import { getPlotConfig, SCREEN_FONT_SIZES } from '../../utils/plotConfig';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';
import { MultiColumnSelector } from '../../components/MultiColumnSelector';

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

                // Pre-compute valid numeric values per column (only visible rows)
                const columnValues: Map<string, Map<number, number>> = new Map();
                for (const col of cols) {
                    const valMap = new Map<number, number>();
                    for (let i = 0; i < data.length; i++) {
                        if (!currentStyleArrays.visible[i]) continue;
                        const val = data[i][col];
                        if (val != null && !isNaN(Number(val))) {
                            valMap.set(i, Number(val));
                        }
                    }
                    columnValues.set(col, valMap);
                }

                // Calculate correlation matrix using pairwise complete observations
                const matrix: number[][] = [];
                const correlationFn = method === 'pearson' ? pearsonCorrelation : spearmanCorrelation;

                for (let i = 0; i < cols.length; i++) {
                    const row: number[] = [];
                    const valsI = columnValues.get(cols[i])!;
                    for (let j = 0; j < cols.length; j++) {
                        if (i === j) {
                            row.push(1);
                        } else {
                            const valsJ = columnValues.get(cols[j])!;
                            // Find rows where both columns have valid values
                            const xArr: number[] = [];
                            const yArr: number[] = [];
                            for (const [idx, xVal] of valsI) {
                                const yVal = valsJ.get(idx);
                                if (yVal !== undefined) {
                                    xArr.push(xVal);
                                    yArr.push(yVal);
                                }
                            }
                            const corr = correlationFn(xArr, yArr);
                            row.push(Math.round(corr * 1000) / 1000);
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

    const handleMethodChange = (_: React.MouseEvent<HTMLElement>, newMethod: 'pearson' | 'spearman' | null) => {
        if (newMethod !== null) {
            setMethod(newMethod);
        }
    };

    const numericColumns = sortColumnsByPriority(
        filteredColumns.filter(c => c.type === 'numeric' || c.type === 'float' || c.type === 'integer')
    );

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
            </Box>

            {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                    <CircularProgress />
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
                                        row.map((value, j) => ({
                                            x: correlationData.columns[j],
                                            y: correlationData.columns[i],
                                            text: value.toFixed(layoutConfig.annotationDecimals),
                                            font: {
                                                size: layoutConfig.annotationFontSize,
                                                color: Math.abs(value) > 0.5 ? 'white' : 'black'
                                            },
                                            showarrow: false,
                                        }))
                                    ),
                                } : {}),
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
