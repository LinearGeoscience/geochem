import React, { useState, useMemo } from 'react';
import Plot from 'react-plotly.js';
import { useAppStore } from '../../store/appStore';
import {
    Box,
    Paper,
    Typography,
    Slider,
    FormControlLabel,
    Checkbox,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip,
} from '@mui/material';
import { MultiColumnSelector } from '../../components/MultiColumnSelector';
import { useAttributeStore } from '../../store/attributeStore';
import { getStyleArrays, sortColumnsByPriority } from '../../utils/attributeUtils';

const HISTOGRAM_COLORS = [
    '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
    '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
    '#aec7e8', '#ffbb78', '#98df8a', '#ff9896', '#c5b0d5',
];

type BarMode = 'stack' | 'group' | 'overlay';
type NormMode = 'count' | 'percent' | 'density';

interface HistogramPlotProps {
    plotId: string;
}

export const HistogramPlot: React.FC<HistogramPlotProps> = ({ plotId }) => {
    const { data, lockAxes, getPlotSettings, updatePlotSettings, getFilteredColumns } = useAppStore();
    const filteredColumns = getFilteredColumns();
    useAttributeStore(); // Subscribe to style changes

    // Get stored settings or defaults
    const storedSettings = getPlotSettings(plotId);

    const [selectedColumns, setSelectedColumnsLocal] = useState<string[]>(storedSettings.selectedColumns || []);
    const [binCount, setBinCountLocal] = useState<number>(storedSettings.binCount || 30);
    const [overlayMode, setOverlayModeLocal] = useState<boolean>(storedSettings.overlayMode || false);
    const [showDensity, setShowDensityLocal] = useState<boolean>(storedSettings.showDensity || false);
    const [categoryColumn, setCategoryColumnLocal] = useState<string>(storedSettings.categoryColumn || '');
    const [barMode, setBarModeLocal] = useState<BarMode>(storedSettings.barMode || 'stack');
    const [normMode, setNormModeLocal] = useState<NormMode>(storedSettings.normMode || 'count');

    // Wrapper functions to persist settings
    const setSelectedColumns = (columns: string[]) => {
        setSelectedColumnsLocal(columns);
        updatePlotSettings(plotId, { selectedColumns: columns });
    };
    const setBinCount = (count: number) => {
        setBinCountLocal(count);
        updatePlotSettings(plotId, { binCount: count });
    };
    const setOverlayMode = (mode: boolean) => {
        setOverlayModeLocal(mode);
        updatePlotSettings(plotId, { overlayMode: mode });
    };
    const setShowDensity = (show: boolean) => {
        setShowDensityLocal(show);
        updatePlotSettings(plotId, { showDensity: show });
    };
    const setCategoryColumn = (col: string) => {
        setCategoryColumnLocal(col);
        updatePlotSettings(plotId, { categoryColumn: col });
    };
    const setBarMode = (mode: BarMode) => {
        setBarModeLocal(mode);
        updatePlotSettings(plotId, { barMode: mode });
    };
    const setNormMode = (mode: NormMode) => {
        setNormModeLocal(mode);
        updatePlotSettings(plotId, { normMode: mode });
    };

    const numericColumns = sortColumnsByPriority(
        filteredColumns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))
    );

    // Include all non-numeric columns as potential category options
    const categoricalColumns = useMemo(() =>
        filteredColumns.filter(c =>
            c.type === 'string' ||
            c.type === 'category' ||
            c.type === 'text' ||
            (c.type !== 'numeric' && c.type !== 'float' && c.type !== 'integer')
        ),
        [filteredColumns]
    );

    // Get visible data based on attribute filters
    const visibleData = useMemo(() => {
        if (!data.length) return [];
        const styleArrays = getStyleArrays(data);
        return data.filter((_, i) => styleArrays.visible[i]);
    }, [data]);

    // Get unique categories
    const categories = useMemo(() => {
        if (!categoryColumn || !visibleData.length) return [];
        const uniqueValues = new Set<string>();
        visibleData.forEach(row => {
            const val = row[categoryColumn];
            if (val != null && val !== '') {
                uniqueValues.add(String(val));
            }
        });
        return Array.from(uniqueValues).sort();
    }, [categoryColumn, visibleData]);

    // Get histnorm value based on normMode
    const getHistNorm = () => {
        switch (normMode) {
            case 'percent': return 'percent';
            case 'density': return 'probability density';
            default: return '';
        }
    };

    // Generate histogram traces
    const { traces, layout } = useMemo(() => {
        if (!visibleData.length || !selectedColumns.length) {
            return { traces: [], layout: {} };
        }

        const traces: any[] = [];
        const histnorm = getHistNorm();
        const yAxisTitle = normMode === 'count' ? 'Count' : normMode === 'percent' ? 'Percent' : 'Density';

        // Determine if we have category grouping
        const hasCategories = categoryColumn && categories.length > 0;

        if (overlayMode || hasCategories) {
            // Overlay mode or category grouping - all on same plot
            if (hasCategories) {
                // Category-grouped histograms
                selectedColumns.forEach((col, colIdx) => {
                    categories.forEach((category, catIdx) => {
                        const values = visibleData
                            .filter(row => String(row[categoryColumn]) === category)
                            .map(d => d[col])
                            .filter(v => v != null && !isNaN(v));

                        if (values.length === 0) return;

                        const colorIndex = selectedColumns.length > 1 ? colIdx : catIdx;
                        const color = HISTOGRAM_COLORS[colorIndex % HISTOGRAM_COLORS.length];

                        traces.push({
                            x: values,
                            type: 'histogram',
                            name: selectedColumns.length > 1 ? `${col} - ${category}` : category,
                            legendgroup: selectedColumns.length > 1 ? col : category,
                            nbinsx: binCount,
                            opacity: barMode === 'overlay' ? 0.6 : 0.85,
                            marker: { color },
                            histnorm: histnorm || undefined,
                        });
                    });
                });
            } else {
                // Original overlay mode (no categories)
                selectedColumns.forEach((col, i) => {
                    const values = visibleData
                        .map(d => d[col])
                        .filter(v => v != null && !isNaN(v));

                    traces.push({
                        x: values,
                        type: 'histogram',
                        name: col,
                        nbinsx: binCount,
                        opacity: 0.6,
                        marker: { color: HISTOGRAM_COLORS[i % HISTOGRAM_COLORS.length] },
                        histnorm: histnorm || undefined,
                    });

                    if (showDensity && normMode === 'count') {
                        traces.push({
                            x: values,
                            type: 'histogram',
                            name: `${col} (density)`,
                            nbinsx: binCount,
                            histnorm: 'probability density',
                            opacity: 0,
                            yaxis: 'y2',
                            showlegend: false,
                        });
                    }
                });
            }

            const title = hasCategories
                ? `${selectedColumns.join(', ')} by ${categoryColumn}`
                : 'Histogram (Overlay)';

            const layout: any = {
                title: { text: title, font: { size: 14 } },
                barmode: hasCategories ? barMode : 'overlay',
                autosize: true,
                height: 350,
                showlegend: true,
                legend: { x: 1, y: 1, xanchor: 'right' },
                xaxis: { title: selectedColumns.length === 1 ? selectedColumns[0] : 'Value' },
                yaxis: { title: yAxisTitle },
                margin: { l: 50, r: 30, t: 40, b: 50 },
                uirevision: lockAxes ? 'locked' : Date.now(),
            };

            if (showDensity && normMode === 'count' && !hasCategories) {
                layout.yaxis2 = {
                    title: 'Density',
                    overlaying: 'y',
                    side: 'right',
                };
            }

            return { traces, layout };
        } else {
            // Grid layout - separate histogram per column
            selectedColumns.forEach((col, i) => {
                const values = visibleData
                    .map(d => d[col])
                    .filter(v => v != null && !isNaN(v));

                traces.push({
                    x: values,
                    type: 'histogram',
                    name: col,
                    nbinsx: binCount,
                    marker: { color: HISTOGRAM_COLORS[i % HISTOGRAM_COLORS.length] },
                    xaxis: i === 0 ? 'x' : `x${i + 1}`,
                    yaxis: i === 0 ? 'y' : `y${i + 1}`,
                    histnorm: histnorm || undefined,
                });
            });

            // Calculate grid dimensions
            const cols = Math.min(selectedColumns.length, 3);
            const rows = Math.ceil(selectedColumns.length / cols);

            const layout: any = {
                title: { text: 'Histograms', font: { size: 14 } },
                autosize: true,
                height: Math.max(300, rows * 200),
                showlegend: false,
                margin: { l: 50, r: 30, t: 40, b: 40 },
                grid: {
                    rows,
                    columns: cols,
                    pattern: 'independent',
                },
                uirevision: lockAxes ? 'locked' : Date.now(),
            };

            // Configure each subplot axis
            selectedColumns.forEach((col, i) => {
                const xKey = i === 0 ? 'xaxis' : `xaxis${i + 1}`;
                const yKey = i === 0 ? 'yaxis' : `yaxis${i + 1}`;
                layout[xKey] = { title: col };
                layout[yKey] = { title: yAxisTitle };
            });

            return { traces, layout };
        }
    }, [visibleData, selectedColumns, binCount, overlayMode, showDensity, lockAxes, categoryColumn, categories, barMode, normMode]);

    const hasCategories = categoryColumn && categories.length > 0;

    return (
        <Box sx={{ p: 2 }}>
            {/* First row: Column selectors */}
            <Box sx={{ mb: 2, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <MultiColumnSelector
                    columns={numericColumns}
                    selectedColumns={selectedColumns}
                    onChange={setSelectedColumns}
                    label="Numeric Variables"
                />

                <FormControl sx={{ minWidth: 180 }}>
                    <InputLabel size="small">Group By (Category)</InputLabel>
                    <Select
                        value={categoryColumn}
                        onChange={(e) => setCategoryColumn(e.target.value)}
                        label="Group By (Category)"
                        size="small"
                    >
                        <MenuItem value="">
                            <em>None</em>
                        </MenuItem>
                        {categoricalColumns.map((col) => (
                            <MenuItem key={col.name} value={col.name}>
                                {col.alias || col.name}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
            </Box>

            {/* Second row: Options */}
            <Box sx={{ mb: 3, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                <Box sx={{ minWidth: 180 }}>
                    <Typography variant="caption" gutterBottom>
                        Bins: {binCount}
                    </Typography>
                    <Slider
                        value={binCount}
                        onChange={(_, v) => setBinCount(v as number)}
                        min={10}
                        max={100}
                        step={5}
                        size="small"
                    />
                </Box>

                {hasCategories && (
                    <Tooltip title="How to display grouped histograms">
                        <ToggleButtonGroup
                            value={barMode}
                            exclusive
                            onChange={(_, v) => v && setBarMode(v)}
                            size="small"
                        >
                            <ToggleButton value="stack">Stacked</ToggleButton>
                            <ToggleButton value="group">Grouped</ToggleButton>
                            <ToggleButton value="overlay">Overlay</ToggleButton>
                        </ToggleButtonGroup>
                    </Tooltip>
                )}

                <Tooltip title="Y-axis normalization">
                    <ToggleButtonGroup
                        value={normMode}
                        exclusive
                        onChange={(_, v) => v && setNormMode(v)}
                        size="small"
                    >
                        <ToggleButton value="count">Count</ToggleButton>
                        <ToggleButton value="percent">Percent</ToggleButton>
                        <ToggleButton value="density">Density</ToggleButton>
                    </ToggleButtonGroup>
                </Tooltip>

                {!hasCategories && (
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={overlayMode}
                                onChange={(e) => setOverlayMode(e.target.checked)}
                                size="small"
                            />
                        }
                        label="Overlay"
                    />
                )}

                {overlayMode && !hasCategories && normMode === 'count' && (
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={showDensity}
                                onChange={(e) => setShowDensity(e.target.checked)}
                                size="small"
                            />
                        }
                        label="Show Density Curve"
                    />
                )}
            </Box>

            {selectedColumns.length === 0 ? (
                <Typography color="text.secondary">
                    Select columns to display histograms
                </Typography>
            ) : (
                <Paper sx={{ p: 2 }}>
                    <Plot
                        data={traces}
                        layout={layout}
                        config={{ displayModeBar: true, displaylogo: false, responsive: true }}
                        style={{ width: '100%' }}
                        useResizeHandler={true}
                    />

                    {/* Statistics summary */}
                    <Box sx={{ mt: 2, display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                        {selectedColumns.map((col, i) => {
                            const values = visibleData
                                .map(d => d[col])
                                .filter(v => v != null && !isNaN(v));
                            const min = Math.min(...values);
                            const max = Math.max(...values);
                            const mean = values.reduce((a, b) => a + b, 0) / values.length;
                            const sorted = [...values].sort((a, b) => a - b);
                            const median = sorted[Math.floor(sorted.length / 2)];

                            return (
                                <Box
                                    key={col}
                                    sx={{
                                        p: 1,
                                        border: '1px solid',
                                        borderColor: 'divider',
                                        borderRadius: 1,
                                        minWidth: 150,
                                    }}
                                >
                                    <Typography
                                        variant="subtitle2"
                                        sx={{ color: HISTOGRAM_COLORS[i % HISTOGRAM_COLORS.length] }}
                                    >
                                        {col}
                                    </Typography>
                                    <Typography variant="caption" display="block">
                                        n = {values.length.toLocaleString()}
                                    </Typography>
                                    <Typography variant="caption" display="block">
                                        Min: {min.toFixed(2)} | Max: {max.toFixed(2)}
                                    </Typography>
                                    <Typography variant="caption" display="block">
                                        Mean: {mean.toFixed(2)} | Median: {median.toFixed(2)}
                                    </Typography>
                                </Box>
                            );
                        })}
                    </Box>
                </Paper>
            )}
        </Box>
    );
};

export default HistogramPlot;
