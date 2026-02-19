import React, { useState, useMemo, useCallback } from 'react';
import Plot from 'react-plotly.js';
import { useAppStore } from '../../store/appStore';
import {
    Box,
    Paper,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Typography,
    Chip,
    IconButton,
    Tooltip,
    Collapse,
    Divider,
} from '@mui/material';
import { ExpandMore, ExpandLess } from '@mui/icons-material';
import { MultiColumnSelector } from '../../components/MultiColumnSelector';
import { useAttributeStore } from '../../store/attributeStore';
import { getStyleArrays, sortColumnsByPriority, getColumnDisplayName } from '../../utils/attributeUtils';
import { getDownholePlotConfig, EXPORT_FONT_SIZES } from '../../utils/plotConfig';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';

// Default color palette for traces
const DEFAULT_TRACE_COLORS = [
    '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
    '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
    '#aec7e8', '#ffbb78', '#98df8a', '#ff9896', '#c5b0d5',
];

// Lithology color palette
const LITHOLOGY_COLORS = [
    '#4CAF50', '#FF9800', '#F44336', '#2196F3', '#9C27B0',
    '#795548', '#607D8B', '#FFEB3B', '#00BCD4', '#E91E63',
    '#8BC34A', '#FF5722', '#3F51B5', '#009688', '#FFC107',
];

interface TraceConfig {
    field: string;
    color: string;
    visible: boolean;
}

interface DownholeHoleViewProps {
    holeName: string;
    holeData: any[];
    depthCol: string;
    fromCol: string | null;
    traceConfigs: TraceConfig[];
    categoryField: string | null;
    categoryColors: Record<string, string>;
    scalingMode: string;
    plotHeight: number;
    trackWidth: number;
    lockAxes: boolean;
    displayName: (name: string) => string;
}

// Single hole view component
const DownholeHoleView: React.FC<DownholeHoleViewProps> = ({
    holeName,
    holeData,
    depthCol,
    fromCol,
    traceConfigs,
    categoryField,
    categoryColors,
    scalingMode,
    plotHeight,
    trackWidth,
    lockAxes,
    displayName: dn,
}) => {
    const visibleTraces = traceConfigs.filter(t => t.visible);

    // Generate traces for numeric fields
    const { traces, layout } = useMemo(() => {
        if (!holeData.length || visibleTraces.length === 0) {
            return { traces: [], layout: {} };
        }

        const traces: any[] = [];
        const depthKey = fromCol || depthCol;

        // Add numeric field traces
        visibleTraces.forEach((config) => {
            const xValues = holeData.map(d => {
                let val = d[config.field];
                if (scalingMode === 'log' && val > 0) {
                    val = Math.log10(val);
                }
                return val;
            });
            const yValues = holeData.map(d => d[depthKey]);

            traces.push({
                x: xValues,
                y: yValues,
                type: 'scatter',
                mode: 'lines+markers',
                name: dn(config.field),
                line: { color: config.color, width: 1.5 },
                marker: { color: config.color, size: 4 },
                hovertemplate: `${dn(config.field)}: %{x}<br>Depth: %{y}<extra></extra>`,
            });
        });

        // Calculate track width
        const totalWidth = trackWidth * (categoryField ? 1.3 : 1);

        const layout: any = {
            title: { text: holeName, font: { size: EXPORT_FONT_SIZES.title }, x: 0, xanchor: 'left' },
            height: plotHeight,
            width: totalWidth,
            showlegend: false,
            font: { size: EXPORT_FONT_SIZES.tickLabels },
            margin: { l: 60, r: 30, t: 50, b: 50 },
            xaxis: {
                title: { text: visibleTraces.length === 1 ? dn(visibleTraces[0].field) : 'Value', font: { size: EXPORT_FONT_SIZES.axisTitle } },
                tickfont: { size: EXPORT_FONT_SIZES.tickLabels },
                side: 'top',
                showgrid: true,
                gridcolor: 'rgba(0,0,0,0.1)',
            },
            yaxis: {
                title: { text: 'Depth', font: { size: EXPORT_FONT_SIZES.axisTitle } },
                tickfont: { size: EXPORT_FONT_SIZES.tickLabels },
                autorange: 'reversed',
                showgrid: true,
                gridcolor: 'rgba(0,0,0,0.1)',
                zeroline: false,
            },
            uirevision: lockAxes ? 'locked' : Date.now(),
        };

        return { traces, layout };
    }, [holeData, visibleTraces, depthCol, fromCol, scalingMode, plotHeight, trackWidth, categoryField, holeName, lockAxes]);

    // Generate lithology/category track
    const categoryTrack = useMemo(() => {
        if (!categoryField || !holeData.length) return null;

        const depthKey = fromCol || depthCol;
        const segments: { start: number; end: number; category: string; color: string }[] = [];

        let currentCategory = holeData[0][categoryField];
        let startDepth = holeData[0][depthKey];

        for (let i = 1; i < holeData.length; i++) {
            const cat = holeData[i][categoryField];
            const depth = holeData[i][depthKey];

            if (cat !== currentCategory) {
                segments.push({
                    start: startDepth,
                    end: depth,
                    category: currentCategory || 'Unknown',
                    color: categoryColors[currentCategory] || '#808080',
                });
                currentCategory = cat;
                startDepth = depth;
            }
        }

        // Add final segment
        const lastDepth = holeData[holeData.length - 1][depthKey];
        segments.push({
            start: startDepth,
            end: lastDepth + 1,
            category: currentCategory || 'Unknown',
            color: categoryColors[currentCategory] || '#808080',
        });

        return segments;
    }, [holeData, categoryField, categoryColors, depthCol, fromCol]);

    if (traces.length === 0) {
        return (
            <Typography color="text.secondary" sx={{ p: 2 }}>
                No data for {holeName}
            </Typography>
        );
    }

    return (
        <Box sx={{ display: 'flex', alignItems: 'flex-start' }}>
            {/* Lithology track */}
            {categoryTrack && (
                <Box
                    sx={{
                        width: 30,
                        mr: 0.5,
                        mt: '40px', // Align with plot area below title
                        height: plotHeight - 80, // Account for margins
                        position: 'relative',
                        border: '1px solid',
                        borderColor: 'divider',
                    }}
                >
                    {categoryTrack.map((seg, i) => {
                        const minDepth = holeData[0][fromCol || depthCol];
                        const maxDepth = holeData[holeData.length - 1][fromCol || depthCol];
                        const range = maxDepth - minDepth;
                        const top = ((seg.start - minDepth) / range) * 100;
                        const height = ((seg.end - seg.start) / range) * 100;

                        return (
                            <Tooltip key={i} title={`${seg.category}: ${seg.start.toFixed(1)} - ${seg.end.toFixed(1)}`}>
                                <Box
                                    sx={{
                                        position: 'absolute',
                                        top: `${top}%`,
                                        height: `${Math.max(height, 1)}%`,
                                        width: '100%',
                                        backgroundColor: seg.color,
                                        borderBottom: '1px solid rgba(0,0,0,0.1)',
                                    }}
                                />
                            </Tooltip>
                        );
                    })}
                </Box>
            )}

            {/* Main plot */}
            <ExpandablePlotWrapper>
                <Plot
                    data={traces}
                    layout={layout}
                    config={getDownholePlotConfig(`downhole_${holeName || 'all'}`)}
                    style={{ display: 'inline-block' }}
                />
            </ExpandablePlotWrapper>
        </Box>
    );
};

interface DownholePlotProps {
    plotId: string;
}

export const DownholePlot: React.FC<DownholePlotProps> = ({ plotId }) => {
    const { data, columns, lockAxes, getPlotSettings, updatePlotSettings, getFilteredColumns, getDisplayData, getDisplayIndices, sampleIndices } = useAppStore();
    const filteredColumns = getFilteredColumns();
    const d = (name: string) => getColumnDisplayName(columns, name);
    useAttributeStore(); // Subscribe to style changes

    const displayData = useMemo(() => getDisplayData(), [data, sampleIndices]);
    const displayIndices = useMemo(() => getDisplayIndices(), [data, sampleIndices]);

    // Get stored settings or defaults
    const storedSettings = getPlotSettings(plotId);

    // Selections - initialize from stored settings
    const [selectedHoles, setSelectedHolesLocal] = useState<string[]>(storedSettings.selectedHoles || []);
    const [selectedFields, setSelectedFieldsLocal] = useState<string[]>(storedSettings.selectedFields || []);
    const [categoryField, setCategoryFieldLocal] = useState<string>(storedSettings.categoryField || '');

    // Trace color configurations
    const [traceColors, setTraceColorsLocal] = useState<Record<string, string>>(storedSettings.traceColors || {});

    // Display options
    const [scalingMode, setScalingModeLocal] = useState<string>(storedSettings.scalingMode || 'auto');
    const [plotHeight] = useState<number>(500);
    const [trackWidth] = useState<number>(250);
    const [showLegend] = useState<boolean>(true);
    const [controlsExpanded, setControlsExpandedLocal] = useState<boolean>(storedSettings.controlsExpanded ?? true);

    // Wrapper functions to persist settings to store
    const setSelectedHoles = (holes: string[]) => {
        setSelectedHolesLocal(holes);
        updatePlotSettings(plotId, { selectedHoles: holes });
    };
    const setSelectedFields = (fields: string[]) => {
        setSelectedFieldsLocal(fields);
        updatePlotSettings(plotId, { selectedFields: fields });
    };
    const setCategoryField = (field: string) => {
        setCategoryFieldLocal(field);
        updatePlotSettings(plotId, { categoryField: field });
    };
    const setTraceColors = (colors: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => {
        if (typeof colors === 'function') {
            setTraceColorsLocal(prev => {
                const newColors = colors(prev);
                updatePlotSettings(plotId, { traceColors: newColors });
                return newColors;
            });
        } else {
            setTraceColorsLocal(colors);
            updatePlotSettings(plotId, { traceColors: colors });
        }
    };
    const setScalingMode = (mode: string) => {
        setScalingModeLocal(mode);
        updatePlotSettings(plotId, { scalingMode: mode });
    };
    const setControlsExpanded = (expanded: boolean) => {
        setControlsExpandedLocal(expanded);
        updatePlotSettings(plotId, { controlsExpanded: expanded });
    };

    // Identify columns
    const holeCol = useMemo(
        () => columns.find(c => c.role === 'HoleID' || c.name?.toLowerCase().includes('hole') || c.name?.toLowerCase() === 'holeid')?.name,
        [columns]
    );
    const depthCol = useMemo(
        () => columns.find(c => c.role === 'Depth' || c.name?.toLowerCase().includes('depth') || c.name?.toLowerCase().includes('to'))?.name || '',
        [columns]
    );
    const fromCol = useMemo(
        () => columns.find(c => c.name?.toLowerCase().includes('from'))?.name || null,
        [columns]
    );

    // Get unique holes
    const holes = useMemo(() => {
        if (!holeCol) return [];
        return Array.from(new Set(data.map(d => d[holeCol]))).filter(Boolean).sort() as string[];
    }, [data, holeCol]);

    // Get column lists (sorted by priority)
    const numericColumns = useMemo(
        () => sortColumnsByPriority(filteredColumns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))),
        [columns]
    );

    const categoricalColumns = useMemo(
        () => filteredColumns.filter(c => c && c.name && (c.type === 'categorical' || c.type === 'text')),
        [columns]
    );

    // Generate trace configs with colors
    const traceConfigs = useMemo((): TraceConfig[] => {
        return selectedFields.map((field, i) => ({
            field,
            color: traceColors[field] || DEFAULT_TRACE_COLORS[i % DEFAULT_TRACE_COLORS.length],
            visible: true,
        }));
    }, [selectedFields, traceColors]);

    // Generate category colors
    const categoryColors = useMemo(() => {
        if (!categoryField) return {};
        const uniqueCategories = Array.from(new Set(displayData.map(d => d[categoryField]))).filter(Boolean);
        const colors: Record<string, string> = {};
        uniqueCategories.forEach((cat, i) => {
            colors[cat as string] = LITHOLOGY_COLORS[i % LITHOLOGY_COLORS.length];
        });
        return colors;
    }, [displayData, categoryField]);

    // Get hole data with visibility filtering
    const getHoleData = useCallback((holeName: string) => {
        if (!holeCol) return { data: [], indices: [] };

        const styleArrays = getStyleArrays(displayData, displayIndices ?? undefined);
        const visibleData: any[] = [];
        const visibleIndices: number[] = [];

        for (let i = 0; i < displayData.length; i++) {
            if (displayData[i][holeCol] === holeName && styleArrays.visible[i]) {
                visibleData.push(displayData[i]);
                visibleIndices.push(i);
            }
        }

        // Sort by depth
        const depthKey = fromCol || depthCol;
        const sortedPairs = visibleData
            .map((d, i) => ({ data: d, idx: visibleIndices[i] }))
            .sort((a, b) => (a.data[depthKey] || 0) - (b.data[depthKey] || 0));

        return {
            data: sortedPairs.map(p => p.data),
            indices: sortedPairs.map(p => p.idx),
        };
    }, [displayData, displayIndices, holeCol, fromCol, depthCol]);

    // Handle hole selection toggle
    const toggleHole = (hole: string) => {
        const newHoles = selectedHoles.includes(hole)
            ? selectedHoles.filter(h => h !== hole)
            : [...selectedHoles, hole];
        setSelectedHoles(newHoles);
    };

    // Handle trace color change
    const setTraceColor = (field: string, color: string) => {
        setTraceColors(prev => ({ ...prev, [field]: color }));
    };

    // Initialize colors for new fields
    React.useEffect(() => {
        const newColors: Record<string, string> = { ...traceColors };
        selectedFields.forEach((field, i) => {
            if (!newColors[field]) {
                newColors[field] = DEFAULT_TRACE_COLORS[i % DEFAULT_TRACE_COLORS.length];
            }
        });
        if (Object.keys(newColors).length !== Object.keys(traceColors).length) {
            setTraceColors(newColors);
        }
    }, [selectedFields]);

    if (!holeCol) {
        return (
            <Box sx={{ p: 2 }}>
                <Typography color="error">
                    No HoleID column found. Please set a column role to "HoleID" in the Column Manager.
                </Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ p: 2 }}>
            {/* Controls Header */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="h6">Downhole Plot</Typography>
                <IconButton size="small" onClick={() => setControlsExpanded(!controlsExpanded)}>
                    {controlsExpanded ? <ExpandLess /> : <ExpandMore />}
                </IconButton>
            </Box>

            <Collapse in={controlsExpanded}>
                {/* Drillhole Selection */}
                <Paper sx={{ p: 2, mb: 2 }}>
                    <Typography variant="subtitle2" gutterBottom>
                        Select Drillholes
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, maxHeight: 120, overflowY: 'auto' }}>
                        {holes.map(hole => (
                            <Chip
                                key={hole}
                                label={hole}
                                size="small"
                                variant={selectedHoles.includes(hole) ? 'filled' : 'outlined'}
                                color={selectedHoles.includes(hole) ? 'primary' : 'default'}
                                onClick={() => toggleHole(hole)}
                                sx={{ cursor: 'pointer' }}
                            />
                        ))}
                    </Box>
                    {selectedHoles.length > 0 && (
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                            {selectedHoles.length} hole(s) selected
                        </Typography>
                    )}
                </Paper>

                {/* Field Selection */}
                <Paper sx={{ p: 2, mb: 2 }}>
                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                        <Box sx={{ flex: 1, minWidth: 200 }}>
                            <MultiColumnSelector
                                columns={numericColumns}
                                selectedColumns={selectedFields}
                                onChange={setSelectedFields}
                                label="Numeric Fields (Traces)"
                            />
                        </Box>

                        <FormControl sx={{ minWidth: 150 }} size="small">
                            <InputLabel>Category Track</InputLabel>
                            <Select
                                value={categoryField}
                                onChange={(e) => setCategoryField(e.target.value)}
                                label="Category Track"
                            >
                                <MenuItem value="">None</MenuItem>
                                {categoricalColumns.map(col => (
                                    <MenuItem key={col.name} value={col.name}>
                                        {col.alias || col.name}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        <FormControl sx={{ minWidth: 100 }} size="small">
                            <InputLabel>Scaling</InputLabel>
                            <Select
                                value={scalingMode}
                                onChange={(e) => setScalingMode(e.target.value)}
                                label="Scaling"
                            >
                                <MenuItem value="auto">Auto</MenuItem>
                                <MenuItem value="log">Log</MenuItem>
                            </Select>
                        </FormControl>
                    </Box>

                    {/* Trace Color Selectors */}
                    {selectedFields.length > 0 && (
                        <Box sx={{ mt: 2 }}>
                            <Typography variant="caption" color="text.secondary" gutterBottom display="block">
                                Trace Colors (click to change)
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                {selectedFields.map((field, i) => (
                                    <Box key={field} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <input
                                            type="color"
                                            value={traceColors[field] || DEFAULT_TRACE_COLORS[i % DEFAULT_TRACE_COLORS.length]}
                                            onChange={(e) => setTraceColor(field, e.target.value)}
                                            style={{ width: 24, height: 24, border: 'none', cursor: 'pointer', padding: 0 }}
                                        />
                                        <Typography variant="caption">{d(field)}</Typography>
                                    </Box>
                                ))}
                            </Box>
                        </Box>
                    )}
                </Paper>
            </Collapse>

            {/* Legend */}
            {showLegend && (selectedFields.length > 0 || categoryField) && (
                <Paper sx={{ p: 1, mb: 2, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    {/* Trace legend */}
                    {selectedFields.map((field, i) => (
                        <Box key={field} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Box
                                sx={{
                                    width: 20,
                                    height: 3,
                                    backgroundColor: traceColors[field] || DEFAULT_TRACE_COLORS[i % DEFAULT_TRACE_COLORS.length],
                                }}
                            />
                            <Typography variant="caption">{d(field)}</Typography>
                        </Box>
                    ))}

                    {/* Category legend */}
                    {categoryField && Object.entries(categoryColors).length > 0 && (
                        <>
                            <Divider orientation="vertical" flexItem />
                            {Object.entries(categoryColors).map(([cat, col]) => (
                                <Box key={cat} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <Box
                                        sx={{
                                            width: 12,
                                            height: 12,
                                            backgroundColor: col,
                                            border: '1px solid rgba(0,0,0,0.2)',
                                        }}
                                    />
                                    <Typography variant="caption">{cat}</Typography>
                                </Box>
                            ))}
                        </>
                    )}
                </Paper>
            )}

            {/* Plots */}
            {selectedHoles.length === 0 ? (
                <Paper sx={{ p: 4, textAlign: 'center' }}>
                    <Typography color="text.secondary">
                        Select one or more drillholes to view downhole plots
                    </Typography>
                </Paper>
            ) : selectedFields.length === 0 ? (
                <Paper sx={{ p: 4, textAlign: 'center' }}>
                    <Typography color="text.secondary">
                        Select numeric fields to plot as traces
                    </Typography>
                </Paper>
            ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {selectedHoles.map(hole => {
                        const { data: holeData } = getHoleData(hole);

                        return (
                            <Paper key={hole} sx={{ p: 1, overflow: 'auto' }}>
                                <DownholeHoleView
                                    holeName={hole}
                                    holeData={holeData}
                                    depthCol={depthCol}
                                    fromCol={fromCol}
                                    traceConfigs={traceConfigs}
                                    categoryField={categoryField || null}
                                    categoryColors={categoryColors}
                                    scalingMode={scalingMode}
                                    plotHeight={plotHeight}
                                    trackWidth={trackWidth}
                                    lockAxes={lockAxes}
                                    displayName={d}
                                />
                            </Paper>
                        );
                    })}
                </Box>
            )}
        </Box>
    );
};

export default DownholePlot;
