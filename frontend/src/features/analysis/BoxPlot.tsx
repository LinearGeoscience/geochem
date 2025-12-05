import React, { useState, useMemo } from 'react';
import Plot from 'react-plotly.js';
import { useAppStore } from '../../store/appStore';
import { useAttributeStore } from '../../store/attributeStore';
import { getStyleArrays, sortColumnsByPriority } from '../../utils/attributeUtils';
import {
    Box,
    Paper,
    Typography,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    FormControlLabel,
    Checkbox,
    Grid,
    Chip,
    OutlinedInput,
    SelectChangeEvent,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip,
} from '@mui/material';

// Color palette for box plots
const BOX_COLORS = [
    '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
    '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
    '#aec7e8', '#ffbb78', '#98df8a', '#ff9896', '#c5b0d5',
];

export const BoxPlot: React.FC = () => {
    const { columns, data } = useAppStore();
    useAttributeStore(); // Subscribe to visibility changes

    // State
    const [numericColumns, setNumericColumns] = useState<string[]>([]);
    const [categoryColumn, setCategoryColumn] = useState<string>('');
    const [showViolin, setShowViolin] = useState(false);
    const [showPoints, setShowPoints] = useState(false);
    const [logScale, setLogScale] = useState(false);
    const [showNotches, setShowNotches] = useState(false);
    const [orientation, setOrientation] = useState<'v' | 'h'>('v');
    const [showMean, setShowMean] = useState(true);

    // Get column lists (sorted by priority)
    const numericColumnOptions = useMemo(() =>
        sortColumnsByPriority(columns.filter(c => c.type === 'numeric' || c.type === 'float' || c.type === 'integer')),
        [columns]
    );

    // Include all non-numeric columns as potential category options
    const categoricalColumnOptions = useMemo(() =>
        columns.filter(c =>
            c.type === 'string' ||
            c.type === 'category' ||
            c.type === 'text' ||
            // Also include any column that's not purely numeric
            (c.type !== 'numeric' && c.type !== 'float' && c.type !== 'integer')
        ),
        [columns]
    );

    // Get visible data
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

    // Generate traces
    const traces = useMemo(() => {
        if (!numericColumns.length || !visibleData.length) return [];

        const traces: any[] = [];

        if (categoryColumn && categories.length > 0) {
            // Grouped box plots - one trace per category per numeric column
            numericColumns.forEach((numCol, numIdx) => {
                categories.forEach((category, catIdx) => {
                    const values = visibleData
                        .filter(row => String(row[categoryColumn]) === category)
                        .map(row => row[numCol])
                        .filter(v => v != null && !isNaN(v));

                    if (values.length === 0) return;

                    const colorIndex = numericColumns.length > 1 ? numIdx : catIdx;
                    const color = BOX_COLORS[colorIndex % BOX_COLORS.length];

                    const trace: any = {
                        type: showViolin ? 'violin' : 'box',
                        name: numericColumns.length > 1 ? `${numCol} - ${category}` : category,
                        legendgroup: numericColumns.length > 1 ? numCol : category,
                        marker: { color },
                        line: { color },
                        fillcolor: color + '80', // Add transparency
                    };

                    if (orientation === 'v') {
                        trace.y = values;
                        trace.x = Array(values.length).fill(
                            numericColumns.length > 1 ? `${category}\n${numCol}` : category
                        );
                    } else {
                        trace.x = values;
                        trace.y = Array(values.length).fill(
                            numericColumns.length > 1 ? `${category}\n${numCol}` : category
                        );
                    }

                    if (showViolin) {
                        trace.box = { visible: true };
                        trace.meanline = { visible: showMean };
                        trace.points = showPoints ? 'all' : false;
                        trace.jitter = 0.3;
                    } else {
                        trace.boxpoints = showPoints ? 'all' : 'outliers';
                        trace.jitter = 0.3;
                        trace.pointpos = 0;
                        trace.boxmean = showMean ? 'sd' : false;
                        trace.notched = showNotches;
                    }

                    traces.push(trace);
                });
            });
        } else {
            // Simple box plots - one trace per numeric column
            numericColumns.forEach((numCol, idx) => {
                const values = visibleData
                    .map(row => row[numCol])
                    .filter(v => v != null && !isNaN(v));

                if (values.length === 0) return;

                const color = BOX_COLORS[idx % BOX_COLORS.length];

                const trace: any = {
                    type: showViolin ? 'violin' : 'box',
                    name: numCol,
                    marker: { color },
                    line: { color },
                    fillcolor: color + '80',
                };

                if (orientation === 'v') {
                    trace.y = values;
                    trace.x = Array(values.length).fill(numCol);
                } else {
                    trace.x = values;
                    trace.y = Array(values.length).fill(numCol);
                }

                if (showViolin) {
                    trace.box = { visible: true };
                    trace.meanline = { visible: showMean };
                    trace.points = showPoints ? 'all' : false;
                    trace.jitter = 0.3;
                } else {
                    trace.boxpoints = showPoints ? 'all' : 'outliers';
                    trace.jitter = 0.3;
                    trace.pointpos = 0;
                    trace.boxmean = showMean ? 'sd' : false;
                    trace.notched = showNotches;
                }

                traces.push(trace);
            });
        }

        return traces;
    }, [numericColumns, categoryColumn, categories, visibleData, showViolin, showPoints, showMean, showNotches, orientation]);

    // Calculate number of boxes for width calculation
    const numBoxes = useMemo(() => {
        if (categoryColumn && categories.length > 0) {
            return numericColumns.length * categories.length;
        }
        return numericColumns.length;
    }, [numericColumns.length, categoryColumn, categories.length]);

    // Calculate appropriate plot width based on number of boxes
    const plotWidth = useMemo(() => {
        const widthPerBox = 100; // Width allocated per box
        const minTotalWidth = 300; // Minimum total width
        const maxTotalWidth = 800; // Maximum total width

        const calculatedWidth = Math.max(minTotalWidth, Math.min(maxTotalWidth, numBoxes * widthPerBox));
        return calculatedWidth;
    }, [numBoxes]);

    // Layout configuration
    const layout = useMemo(() => {
        const title = categoryColumn
            ? `${numericColumns.join(', ')} by ${categoryColumn}`
            : numericColumns.join(', ');

        const layout: any = {
            title: { text: title, font: { size: 14 } },
            autosize: false,
            width: plotWidth,
            height: 350,
            showlegend: numericColumns.length > 1 || categories.length > 5,
            legend: { x: 1, y: 1, xanchor: 'right' },
            margin: { l: 60, r: 30, t: 40, b: 60 },
            boxgap: 0.3, // Gap between boxes in the same group
            boxgroupgap: 0.4, // Gap between box groups
        };

        if (orientation === 'v') {
            layout.xaxis = {
                title: categoryColumn || 'Variable',
                type: categoryColumn ? 'category' : undefined,
            };
            layout.yaxis = {
                title: numericColumns.length === 1 ? numericColumns[0] : 'Value',
                type: logScale ? 'log' : 'linear',
            };
        } else {
            layout.yaxis = {
                title: categoryColumn || 'Variable',
                type: categoryColumn ? 'category' : undefined,
            };
            layout.xaxis = {
                title: numericColumns.length === 1 ? numericColumns[0] : 'Value',
                type: logScale ? 'log' : 'linear',
            };
        }

        return layout;
    }, [numericColumns, categoryColumn, categories, logScale, orientation, plotWidth]);

    // Handlers
    const handleNumericChange = (event: SelectChangeEvent<string[]>) => {
        const value = event.target.value;
        setNumericColumns(typeof value === 'string' ? value.split(',') : value);
    };

    // Calculate statistics for display
    const stats = useMemo(() => {
        if (!numericColumns.length || !visibleData.length) return null;

        const result: Record<string, { count: number; min: number; max: number; median: number; q1: number; q3: number }> = {};

        const calcStats = (values: number[], label: string) => {
            if (values.length === 0) return;
            const sorted = [...values].sort((a, b) => a - b);
            const q1Idx = Math.floor(sorted.length * 0.25);
            const medIdx = Math.floor(sorted.length * 0.5);
            const q3Idx = Math.floor(sorted.length * 0.75);

            result[label] = {
                count: values.length,
                min: sorted[0],
                max: sorted[sorted.length - 1],
                q1: sorted[q1Idx],
                median: sorted[medIdx],
                q3: sorted[q3Idx],
            };
        };

        if (categoryColumn && categories.length > 0) {
            numericColumns.forEach(numCol => {
                categories.forEach(category => {
                    const values = visibleData
                        .filter(row => String(row[categoryColumn]) === category)
                        .map(row => row[numCol])
                        .filter(v => v != null && !isNaN(v));
                    calcStats(values, `${numCol} - ${category}`);
                });
            });
        } else {
            numericColumns.forEach(numCol => {
                const values = visibleData
                    .map(row => row[numCol])
                    .filter(v => v != null && !isNaN(v));
                calcStats(values, numCol);
            });
        }

        return result;
    }, [numericColumns, categoryColumn, categories, visibleData]);

    return (
        <Box sx={{ p: 3 }}>
            <Typography variant="h5" gutterBottom>Box Plots</Typography>

            {/* Controls */}
            <Grid container spacing={2} sx={{ mb: 3 }}>
                <Grid item xs={12} md={4}>
                    <FormControl fullWidth>
                        <InputLabel>Numeric Variables</InputLabel>
                        <Select
                            multiple
                            value={numericColumns}
                            onChange={handleNumericChange}
                            input={<OutlinedInput label="Numeric Variables" />}
                            renderValue={(selected) => (
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                    {selected.map((value) => (
                                        <Chip key={value} label={value} size="small" />
                                    ))}
                                </Box>
                            )}
                        >
                            {numericColumnOptions.map((col) => (
                                <MenuItem key={col.name} value={col.name}>
                                    {col.alias || col.name}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </Grid>

                <Grid item xs={12} md={3}>
                    <FormControl fullWidth>
                        <InputLabel>Group By (Category)</InputLabel>
                        <Select
                            value={categoryColumn}
                            onChange={(e) => setCategoryColumn(e.target.value)}
                            label="Group By (Category)"
                        >
                            <MenuItem value="">
                                <em>None</em>
                            </MenuItem>
                            {categoricalColumnOptions.map((col) => (
                                <MenuItem key={col.name} value={col.name}>
                                    {col.alias || col.name}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </Grid>

                <Grid item xs={12} md={5}>
                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                        <Tooltip title="Show violin plot instead of box plot">
                            <FormControlLabel
                                control={<Checkbox checked={showViolin} onChange={(e) => setShowViolin(e.target.checked)} size="small" />}
                                label="Violin"
                            />
                        </Tooltip>

                        <Tooltip title="Show individual data points">
                            <FormControlLabel
                                control={<Checkbox checked={showPoints} onChange={(e) => setShowPoints(e.target.checked)} size="small" />}
                                label="Points"
                            />
                        </Tooltip>

                        <Tooltip title="Use logarithmic scale">
                            <FormControlLabel
                                control={<Checkbox checked={logScale} onChange={(e) => setLogScale(e.target.checked)} size="small" />}
                                label="Log Scale"
                            />
                        </Tooltip>

                        <Tooltip title="Show mean and standard deviation">
                            <FormControlLabel
                                control={<Checkbox checked={showMean} onChange={(e) => setShowMean(e.target.checked)} size="small" />}
                                label="Mean"
                            />
                        </Tooltip>

                        {!showViolin && (
                            <Tooltip title="Show notches for confidence intervals">
                                <FormControlLabel
                                    control={<Checkbox checked={showNotches} onChange={(e) => setShowNotches(e.target.checked)} size="small" />}
                                    label="Notches"
                                />
                            </Tooltip>
                        )}

                        <ToggleButtonGroup
                            value={orientation}
                            exclusive
                            onChange={(_, v) => v && setOrientation(v)}
                            size="small"
                        >
                            <ToggleButton value="v">Vertical</ToggleButton>
                            <ToggleButton value="h">Horizontal</ToggleButton>
                        </ToggleButtonGroup>
                    </Box>
                </Grid>
            </Grid>

            {/* Plot */}
            {numericColumns.length === 0 ? (
                <Typography color="text.secondary">
                    Select at least one numeric variable to display box plots
                </Typography>
            ) : (
                <>
                    <Paper sx={{ p: 2, display: 'inline-block' }}>
                        <Plot
                            data={traces}
                            layout={layout}
                            config={{ displayModeBar: true, displaylogo: false, responsive: false }}
                        />
                    </Paper>

                    {/* Statistics summary */}
                    {stats && Object.keys(stats).length > 0 && (
                        <Box sx={{ mt: 3 }}>
                            <Typography variant="h6" gutterBottom>Summary Statistics</Typography>
                            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                                {Object.entries(stats).map(([label, s], idx) => (
                                    <Paper
                                        key={label}
                                        sx={{
                                            p: 1.5,
                                            minWidth: 180,
                                            borderTop: `3px solid ${BOX_COLORS[idx % BOX_COLORS.length]}`,
                                        }}
                                    >
                                        <Typography variant="subtitle2" noWrap title={label}>
                                            {label.length > 25 ? label.slice(0, 22) + '...' : label}
                                        </Typography>
                                        <Typography variant="caption" display="block">
                                            n = {s.count.toLocaleString()}
                                        </Typography>
                                        <Typography variant="caption" display="block">
                                            Min: {s.min.toFixed(2)} | Max: {s.max.toFixed(2)}
                                        </Typography>
                                        <Typography variant="caption" display="block">
                                            Q1: {s.q1.toFixed(2)} | Median: {s.median.toFixed(2)} | Q3: {s.q3.toFixed(2)}
                                        </Typography>
                                    </Paper>
                                ))}
                            </Box>
                        </Box>
                    )}
                </>
            )}
        </Box>
    );
};

export default BoxPlot;
