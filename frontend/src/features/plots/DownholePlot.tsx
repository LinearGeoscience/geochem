import React, { useMemo, useCallback } from 'react';
import Plot from '../../components/ThemedPlot';
import { useAppStore, useDatasetRows, useDisplayRows } from '../../store/appStore';
import { usePlotSetting } from '../../hooks/usePlotSetting';
import { useShallow } from 'zustand/react/shallow';
import {
    Box,
    Paper,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Typography,
    Chip,
    Tooltip,
    Divider,
} from '@mui/material';
import { MultiColumnSelector } from '../../components/MultiColumnSelector';
import { PlotControlBar, ControlSection, SettingChip } from '../../components/plot_controls/PlotControlBar';
import { getStyleArraysColumnar, sortColumnsByPriority, getColumnDisplayName } from '../../utils/attributeUtils';
import { getDownholePlotConfig, EXPORT_FONT_SIZES } from '../../utils/plotConfig';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';
import { ColumnPicker } from '../../components/ColumnPicker';
import { useStyleInputs } from '../../hooks/useStyleInputs';
import { useAttributeStore } from '../../store/attributeStore';

// Default color palette for traces
const DEFAULT_TRACE_COLORS = [
    '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
    '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
    '#aec7e8', '#ffbb78', '#98df8a', '#ff9896', '#c5b0d5',
];

// Lithology colours when the Attribute Manager is not colouring by the same field
const LITHOLOGY_COLORS = [
    '#4CAF50', '#FF9800', '#F44336', '#2196F3', '#9C27B0',
    '#795548', '#607D8B', '#FFEB3B', '#00BCD4', '#E91E63',
    '#8BC34A', '#FF5722', '#3F51B5', '#009688', '#FFC107',
];

/** Interval traces above this many samples render with WebGL (scattergl). */
const WEBGL_POINT_THRESHOLD = 2000;
const EMPTY_COLORS: Record<string, string> = {};

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
    lockFullExtent: boolean;
    fullRanges: { depth: [number, number]; value: [number, number] } | null;
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
    lockFullExtent,
    fullRanges,
    displayName: dn,
}) => {
    const visibleTraces = useMemo(() => traceConfigs.filter(t => t.visible), [traceConfigs]);

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
                const val = d[config.field];
                // Log mode: values <= 0 have no logarithm — leave a gap rather
                // than plotting the raw value on the log-transformed axis
                if (scalingMode === 'log') return val > 0 ? Math.log10(val) : null;
                return val;
            });
            const yValues = holeData.map(d => d[depthKey]);

            traces.push({
                x: xValues,
                y: yValues,
                type: holeData.length > WEBGL_POINT_THRESHOLD ? 'scattergl' : 'scatter',
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
                ...(lockFullExtent && fullRanges ? { range: fullRanges.value, autorange: false } : {}),
            },
            yaxis: {
                title: { text: 'Depth', font: { size: EXPORT_FONT_SIZES.axisTitle } },
                tickfont: { size: EXPORT_FONT_SIZES.tickLabels },
                autorange: lockFullExtent && fullRanges ? false : 'reversed',
                ...(lockFullExtent && fullRanges ? { range: [fullRanges.depth[1], fullRanges.depth[0]] } : {}),
                showgrid: true,
                gridcolor: 'rgba(0,0,0,0.1)',
                zeroline: false,
            },
            // Stable token: preserve zoom across re-renders; reset when hole/traces change
            uirevision: (lockAxes || lockFullExtent) ? 'locked' : `${holeName}|${depthCol}|${fromCol}|${visibleTraces.map(t => t.field).join(',')}`,
        };

        return { traces, layout };
    }, [holeData, visibleTraces, depthCol, fromCol, scalingMode, plotHeight, trackWidth, categoryField, holeName, lockAxes, lockFullExtent, fullRanges, dn]);

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
    const { columns, lockAxes, lockFullExtent } = useAppStore(useShallow(s => ({ columns: s.columns, lockAxes: s.lockAxes, lockFullExtent: s.lockFullExtent })));
    const data = useDatasetRows();
    const getDisplayColumn = useAppStore(s => s.getDisplayColumn);
    const filteredColumns = useAppStore(useShallow(s => s.getFilteredColumns()));
    const d = useCallback((name: string) => getColumnDisplayName(columns, name), [columns]);
    // Visibility comes from the attribute store (read inside getStyleArraysColumnar);
    // this object is the dependency that tracks it
    const attributeStyleState = useStyleInputs();

    const displayData = useDisplayRows();
    const displayIndices = useAppStore(s => s._sampleIndicesArray);

    // Selections
    const [selectedHoles, setSelectedHoles] = usePlotSetting<string[]>(plotId, 'selectedHoles', []);
    const [selectedFields, setSelectedFields] = usePlotSetting<string[]>(plotId, 'selectedFields', []);
    const [categoryField, setCategoryField] = usePlotSetting<string>(plotId, 'categoryField', '');

    // Trace color configurations
    const [traceColors, setTraceColors] = usePlotSetting<Record<string, string>>(plotId, 'traceColors', EMPTY_COLORS);

    // Display options
    const [scalingMode, setScalingMode] = usePlotSetting<string>(plotId, 'scalingMode', 'auto');
    const plotHeight = 500;
    const trackWidth = 250;
    const showLegend = true;

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
        [filteredColumns]
    );
    const allNumericColumns = useMemo(() => sortColumnsByPriority(
        columns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))
    ), [columns]);

    // Generate trace configs with colors
    const traceConfigs = useMemo((): TraceConfig[] => {
        return selectedFields.map((field, i) => ({
            field,
            color: traceColors[field] || DEFAULT_TRACE_COLORS[i % DEFAULT_TRACE_COLORS.length],
            visible: true,
        }));
    }, [selectedFields, traceColors]);

    // Category colours: the Attribute Manager's colours when it colours by this
    // field (so the log matches every other plot), else a fixed palette
    const colourTab = useAttributeStore(s => s.color);
    const categoryColors = useMemo(() => {
        if (!categoryField) return {};
        const colors: Record<string, string> = {};
        if (colourTab.field === categoryField && !colourTab.additionalFields?.length) {
            for (const e of colourTab.entries) {
                if (e.type !== 'category' || !e.color) continue;
                for (const v of e.categoryValues ?? [e.categoryValue ?? e.name]) colors[v] = e.color;
            }
        }
        const fallback = colourTab.entries.find(e => e.isDefault)?.color;
        const uniqueCategories = Array.from(new Set(displayData.map(d => d[categoryField]))).filter(Boolean);
        let k = 0;
        uniqueCategories.forEach((cat) => {
            const key = String(cat);
            if (colors[key]) return;
            colors[key] = colourTab.field === categoryField && fallback ? fallback : LITHOLOGY_COLORS[k++ % LITHOLOGY_COLORS.length];
        });
        return colors;
    }, [displayData, categoryField, colourTab]);

    // Full data ranges for lockFullExtent mode
    const fullDownholeRanges = useMemo(() => {
        if (!lockFullExtent || !depthCol || selectedFields.length === 0) return null;
        const depthKey = fromCol || depthCol;
        let depthMin = Infinity, depthMax = -Infinity;
        let valMin = Infinity, valMax = -Infinity;
        for (const row of data) {
            const d = row[depthKey];
            if (d != null && !isNaN(d)) { if (d < depthMin) depthMin = d; if (d > depthMax) depthMax = d; }
            for (const field of selectedFields) {
                let v = row[field];
                if (scalingMode === 'log') v = v > 0 ? Math.log10(v) : null;
                if (v != null && !isNaN(v)) { if (v < valMin) valMin = v; if (v > valMax) valMax = v; }
            }
        }
        return depthMin < depthMax && valMin < valMax
            ? { depth: [depthMin, depthMax] as [number, number], value: [valMin, valMax] as [number, number] }
            : null;
    }, [lockFullExtent, data, depthCol, fromCol, selectedFields, scalingMode]);

    // Visible rows of every hole, sorted by depth: one pass per data/attribute change,
    // and stable objects per hole so the per-hole memos keep their results
    const holeRows = useMemo(() => {
        const map = new Map<string, { data: any[]; indices: number[] }>();
        if (!holeCol) return map;
        void attributeStyleState; // visibility is read from the attribute store
        const styleArrays = getStyleArraysColumnar(displayData.length, (name) => getDisplayColumn(name), displayIndices ?? undefined);
        for (let i = 0; i < displayData.length; i++) {
            if (!styleArrays.visible[i]) continue;
            const hole = String(displayData[i][holeCol]);
            let h = map.get(hole);
            if (!h) map.set(hole, (h = { data: [], indices: [] }));
            h.data.push(displayData[i]);
            h.indices.push(i);
        }
        const depthKey = fromCol || depthCol;
        for (const [hole, h] of map) {
            const order = h.data.map((_, k) => k).sort((a, b) => (h.data[a][depthKey] || 0) - (h.data[b][depthKey] || 0));
            map.set(hole, { data: order.map(k => h.data[k]), indices: order.map(k => h.indices[k]) });
        }
        return map;
    }, [displayData, displayIndices, holeCol, fromCol, depthCol, getDisplayColumn, attributeStyleState]);

    const EMPTY_HOLE = useMemo(() => ({ data: [] as any[], indices: [] as number[] }), []);
    const getHoleData = useCallback((holeName: string) => holeRows.get(String(holeName)) ?? EMPTY_HOLE, [holeRows, EMPTY_HOLE]);

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
    }, [selectedFields, traceColors, setTraceColors]);

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
        <Box sx={{ p: 1 }}>
            <PlotControlBar
                primary={<>
                    {/* Drillhole Selection */}
                    <Box sx={{ minWidth: 200, maxWidth: 420 }}>
                        <Typography variant="caption" color="text.secondary" display="block">
                            Drillholes{selectedHoles.length > 0 ? ` (${selectedHoles.length} selected)` : ''}
                        </Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, maxHeight: 96, overflowY: 'auto' }}>
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
                    </Box>

                    <Box sx={{ flex: 1, minWidth: 200 }}>
                        <MultiColumnSelector
                            columns={numericColumns}
                            selectedColumns={selectedFields}
                            onChange={setSelectedFields}
                            label="Numeric Fields (Traces)"
                            allColumns={allNumericColumns}
                        />
                    </Box>

                    <ColumnPicker label="Category Track" value={categoryField} onChange={setCategoryField} filter="categorical" allowNone minWidth={160} />
                </>}
                settingsActive={scalingMode !== 'auto'}
                summary={<>
                    {scalingMode !== 'auto' && (
                        <SettingChip label="Log scale" onDelete={() => setScalingMode('auto')} />
                    )}
                </>}
                settings={<>
                    <ControlSection label="Scale">
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
                    </ControlSection>

                    {/* Trace Color Selectors */}
                    {selectedFields.length > 0 && (
                        <ControlSection label="Trace Colors (click to change)">
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
                        </ControlSection>
                    )}
                </>}
            />

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
                                    lockFullExtent={lockFullExtent}
                                    fullRanges={fullDownholeRanges}
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
