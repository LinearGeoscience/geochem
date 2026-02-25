import React, { useState, useCallback, useMemo } from 'react';
import { Box, Paper, Typography, ToggleButtonGroup, ToggleButton, CircularProgress, Button, Alert, Checkbox, FormControlLabel, Select, MenuItem, FormControl, InputLabel } from '@mui/material';
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

// p-value from t-distribution using Abramowitz & Stegun approximation
const tDistPValue = (t: number, df: number): number => {
    if (df <= 0) return 1;
    const x = df / (df + t * t);
    // Regularized incomplete beta function approximation
    // For large df, use normal approximation
    if (df > 100) {
        // Normal approximation
        const z = Math.abs(t);
        const p = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
        const twoTailP = 2 * (0.5 - p * (0.31938153 / (1 + 0.2316419 * z) - 0.356563782 / Math.pow(1 + 0.2316419 * z, 2) + 1.781477937 / Math.pow(1 + 0.2316419 * z, 3) - 1.821255978 / Math.pow(1 + 0.2316419 * z, 4) + 1.330274429 / Math.pow(1 + 0.2316419 * z, 5)));
        return Math.max(0, Math.min(1, twoTailP));
    }
    // Beta function based approximation for smaller df
    return betaRegularized(df / 2, 0.5, x);
};

// Regularized incomplete beta function (simplified for t-distribution p-value)
const betaRegularized = (a: number, b: number, x: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    // Use continued fraction expansion (Lentz's algorithm)
    const maxIter = 200;
    const eps = 1e-10;

    const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
    const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta) / a;

    // Modified Lentz's method for continued fraction
    let f = 1;
    let c = 1;
    let d = 1 - (a + b) * x / (a + 1);
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;
    f = d;

    for (let m = 1; m <= maxIter; m++) {
        // Even step
        let numerator = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m));
        d = 1 + numerator * d;
        if (Math.abs(d) < 1e-30) d = 1e-30;
        c = 1 + numerator / c;
        if (Math.abs(c) < 1e-30) c = 1e-30;
        d = 1 / d;
        f *= c * d;

        // Odd step
        numerator = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1));
        d = 1 + numerator * d;
        if (Math.abs(d) < 1e-30) d = 1e-30;
        c = 1 + numerator / c;
        if (Math.abs(c) < 1e-30) c = 1e-30;
        d = 1 / d;
        const delta = c * d;
        f *= delta;

        if (Math.abs(delta - 1) < eps) break;
    }

    return front * f;
};

// Log gamma using Stirling's approximation
const lnGamma = (z: number): number => {
    if (z <= 0) return 0;
    // Lanczos approximation
    const g = 7;
    const coeff = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < 0.5) {
        return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
    }
    z -= 1;
    let x = coeff[0];
    for (let i = 1; i < g + 2; i++) {
        x += coeff[i] / (z + i);
    }
    const t = z + g + 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
};

// Calculate p-value for a correlation coefficient
const correlationPValue = (r: number, n: number): number => {
    if (n <= 2) return 1;
    if (Math.abs(r) >= 1) return 0;
    const t = r * Math.sqrt((n - 2) / (1 - r * r));
    return tDistPValue(t, n - 2);
};

// Significance marker
const sigMarker = (p: number): string => {
    if (p < 0.001) return '***';
    if (p < 0.01) return '**';
    if (p < 0.05) return '*';
    return '';
};

export const CorrelationMatrix: React.FC = () => {
    const { data, columns, correlationSelectedColumns, setCorrelationSelectedColumns, getFilteredColumns, columnFilter } = useAppStore();
    const filteredColumns = getFilteredColumns();
    useAttributeStore(); // Subscribe to changes
    const [method, setMethod] = useState<'pearson' | 'spearman'>('pearson');
    const [correlationData, setCorrelationData] = useState<{ columns: string[], matrix: number[][], pValues: number[][], nPairs: number[][] } | null>(null);
    const [loading, setLoading] = useState(false);
    const [showSignificance, setShowSignificance] = useState(false);
    const [sigThreshold, setSigThreshold] = useState<number>(0.05);

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
                const pValues: number[][] = [];
                const nPairs: number[][] = [];
                const correlationFn = method === 'pearson' ? pearsonCorrelation : spearmanCorrelation;

                for (let i = 0; i < cols.length; i++) {
                    const row: number[] = [];
                    const pRow: number[] = [];
                    const nRow: number[] = [];
                    const valsI = columnValues.get(cols[i])!;
                    for (let j = 0; j < cols.length; j++) {
                        if (i === j) {
                            row.push(1);
                            pRow.push(0);
                            nRow.push(valsI.size);
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
                            const roundedCorr = Math.round(corr * 1000) / 1000;
                            row.push(roundedCorr);
                            pRow.push(correlationPValue(corr, xArr.length));
                            nRow.push(xArr.length);
                        }
                    }
                    matrix.push(row);
                    pValues.push(pRow);
                    nPairs.push(nRow);
                }

                setCorrelationData({ columns: cols, matrix, pValues, nPairs });
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
