/**
 * Normal probability plots (Graph > Probability Plot). Values on Y
 * (log by default), cumulative probability on a normal-score X axis labelled
 * in percent. "Split by colour" ranks each colour group separately (the reference software
 * Split Probability). Works as a workspace plot (settings saved per plot) and
 * in the Analysis view (session-only settings).
 */
import React, { useMemo, useRef, useState } from 'react';
import { Box, Paper, Typography, ToggleButtonGroup, ToggleButton, Grid, Alert, FormControlLabel, Switch, Tooltip } from '@mui/material';
import Plot from '../../components/ThemedPlot';
import { useAppStore } from '../../store/appStore';
import { useShallow } from 'zustand/react/shallow';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';
import { attributeColumnValues, getStyleArraysColumnar, sortColumnsByPriority, shapeToPlotlySymbol, applyOpacityToColor } from '../../utils/attributeUtils';
import { getPlotConfig, EXPORT_FONT_SIZES } from '../../utils/plotConfig';
import { MultiColumnSelector } from '../../components/MultiColumnSelector';
import { useSelectionHandler } from '../../hooks/useSelectionHandler';
import { usePlotSetting } from '../../hooks/usePlotSetting';
import { SELECTION_COLOR } from '../../utils/selectionHelpers';
import { probabilityAxisTicks, probabilityPoints, splitProbability, ProbabilityPoint } from '../../utils/probability';
import { useStyleInputs } from '../../hooks/useStyleInputs';

// Maximum number of plots to render simultaneously to prevent crashes
const MAX_SIMULTANEOUS_PLOTS = 12;

/** fraction: cumulative frequency, 0-1 on X with the value on Y (median read at 0.5) */
type PlotKind = 'probability' | 'cumulative' | 'fraction';
type XAxisKind = 'probability' | 'nscore';
type Scale = 'linear' | 'log';

/** Plot setting when the plot lives in the workspace, local state otherwise */
function useSetting<T>(plotId: string | undefined, key: string, initial: T): [T, (v: T) => void] {
    const [stored, setStored] = usePlotSetting<T>(plotId ?? '', key, initial);
    const [local, setLocal] = useState<T>(initial);
    return plotId ? [stored, setStored] : [local, setLocal];
}

const PROB_TICKS = probabilityAxisTicks();

/** Log value axis labelled at decades only (0.1, 1, 10 ...), minor grid between */
const LOG_VALUE_AXIS = { type: 'log' as const, dtick: 1, exponentformat: 'none' as const, minor: { showgrid: true, gridcolor: 'rgba(0,0,0,0.06)' } };

export const ProbabilityPlot: React.FC<{ plotId?: string }> = ({ plotId }) => {
    const columns = useAppStore(s => s.columns);
    const rowCount = useAppStore(s => s.columnarData.rowCount);
    const columnarData = useAppStore(s => s.columnarData);
    const getColumn = useAppStore(s => s.getColumn);
    const getNumericColumn = useAppStore(s => s.getNumericColumn);
    const bdlFactor = useAppStore(s => s.bdlFactor);
    const filteredColumns = useAppStore(useShallow(s => s.getFilteredColumns()));
    // Styling/visibility is read inside getStyleArraysColumnar; this object tracks it
    const attributeStyleState = useStyleInputs();
    const { handleSelected, handleClick, handleDeselect, selectedIndices } = useSelectionHandler();
    const selectedSet = useMemo(() => new Set(selectedIndices), [selectedIndices]);

    const [selectedColumns, setSelectedColumns] = useSetting<string[]>(plotId, 'selectedColumns', []);
    const [plotType, setPlotType] = useSetting<PlotKind>(plotId, 'probabilityKind', 'probability');
    const [xAxisType, setXAxisType] = useSetting<XAxisKind>(plotId, 'probabilityAxis', 'probability');
    const [valueScale, setValueScale] = useSetting<Scale>(plotId, 'valueScale', 'log');
    const [split, setSplit] = useSetting<boolean>(plotId, 'splitByColour', false);

    const numericColumns = useMemo(() => sortColumnsByPriority(
        filteredColumns.filter(c => c.type === 'numeric' || c.type === 'float' || c.type === 'integer')
    ), [filteredColumns]);

    const allNumericColumns = useMemo(() => sortColumnsByPriority(
        columns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))
    ), [columns]);

    const styleArrays = useMemo(() => {
        if (!rowCount) return { visible: [], colors: [], sizes: [], shapes: [], opacity: [] };
        void attributeStyleState;
        void columnarData;
        return getStyleArraysColumnar(rowCount, (name) => getColumn(name));
    }, [rowCount, getColumn, attributeStyleState, columnarData]);

    // Kept by content: a colour change leaves the rows (and the ranking below) alone
    const visibleRef = useRef<number[]>([]);
    const visibleRows = useMemo(() => {
        const rows: number[] = [];
        for (let i = 0; i < rowCount; i++) if (styleArrays.visible[i]) rows.push(i);
        const prev = visibleRef.current;
        if (prev.length === rows.length && rows.every((r, k) => r === prev[k])) return prev;
        return (visibleRef.current = rows);
    }, [rowCount, styleArrays]);

    // Colour group of each row for Split Probability (painted groups first; '' = default)
    const groupsRef = useRef<string[]>([]);
    const groupNames = useMemo(() => {
        if (!split || !rowCount) return [];
        void attributeStyleState;
        void columnarData;
        const next = attributeColumnValues('color', rowCount, n => useAppStore.getState().getRawColumn(n));
        const prev = groupsRef.current;
        if (prev.length === next.length && next.every((g, k) => g === prev[k])) return prev;
        return (groupsRef.current = next);
    }, [split, rowCount, attributeStyleState, columnarData]);

    // Split mode: one legend for every panel (group -> colour, in first-seen order)
    const splitLegend = useMemo(() => {
        if (!split) return [];
        const seen = new Map<string, string>();
        for (const r of visibleRows) {
            const g = groupNames[r] || 'Default';
            if (!seen.has(g)) seen.set(g, styleArrays.colors[r]);
        }
        return [...seen].map(([name, colour]) => ({ name, colour }));
    }, [split, visibleRows, groupNames, styleArrays]);

    const log = valueScale === 'log';
    // SVG unless the panels hold many points: each WebGL panel takes one of the
    // browser's ~16 contexts per page, and the oldest panel goes blank when they run out
    const traceType = visibleRows.length * Math.max(1, selectedColumns.length) > 30000 ? 'scattergl' : 'scatter';
    // Probability (%) and N-score share positions; only the tick labels differ
    const xOf = (p: ProbabilityPoint) => (plotType === 'cumulative' ? p.value : plotType === 'fraction' ? p.percent / 100 : p.nscore);
    const yOf = (p: ProbabilityPoint) => (plotType === 'cumulative' ? p.percent : p.value);

    const markerTrace = (pts: ProbabilityPoint[], name: string, colourOverride?: string): any => ({
        x: pts.map(xOf),
        y: pts.map(yOf),
        customdata: pts.map(p => p.row),
        type: traceType,
        // draws probability and 0-1 cumulative plots as points
        mode: plotType === 'cumulative' ? 'lines+markers' : 'markers',
        name,
        hovertemplate: `%{y:.4g}<br>%{text}<extra>${name}</extra>`,
        text: pts.map(p => `${p.percent.toFixed(1)} %`),
        marker: {
            size: plotType === 'probability' ? pts.map(p => styleArrays.sizes[p.row]) : 3,
            color: colourOverride ?? pts.map(p => applyOpacityToColor(styleArrays.colors[p.row], styleArrays.opacity[p.row])),
            symbol: pts.map(p => shapeToPlotlySymbol(styleArrays.shapes[p.row])),
            line: { width: 0 },
        },
        ...(plotType === 'cumulative' ? { line: { color: colourOverride ?? '#1976d2', width: 1.5 } } : {}),
    });

    // Ranking (the sort) per column: only when the rows, groups or values change, not on restyle
    const ranked = useMemo(() => {
        void bdlFactor; void columnarData;
        const out = new Map<string, { all: ProbabilityPoint[]; groups: Array<{ group: string; points: ProbabilityPoint[] }> | null }>();
        for (const c of selectedColumns) {
            const values = getNumericColumn(c);
            if (!values) continue;
            if (split) {
                const groups = splitProbability(visibleRows, values, r => groupNames[r] || 'Default', log);
                out.set(c, { all: groups.flatMap(g => g.points), groups });
            } else {
                out.set(c, { all: probabilityPoints(visibleRows, values, log), groups: null });
            }
        }
        return out;
    }, [selectedColumns, getNumericColumn, split, visibleRows, groupNames, log, bdlFactor, columnarData]);

    const tracesFor = (columnName: string): any[] => {
        const r = ranked.get(columnName);
        if (!r) return [];
        const traces: any[] = [];
        const all = r.all;
        if (r.groups) {
            for (const g of r.groups) traces.push(markerTrace(g.points, g.group, styleArrays.colors[g.points[0].row]));
        } else {
            traces.push(markerTrace(all, columnName));
        }
        // Ring over selected samples (linked with every plot)
        if (selectedSet.size) {
            const sel = all.filter(p => selectedSet.has(p.row));
            if (sel.length) traces.push({
                x: sel.map(xOf), y: sel.map(yOf), type: traceType, mode: 'markers', hoverinfo: 'skip', showlegend: false,
                marker: { color: 'rgba(0,0,0,0)', size: sel.map(p => styleArrays.sizes[p.row] + 4), line: { width: 2, color: SELECTION_COLOR } },
            });
        }
        return traces;
    };

    const xaxis = plotType === 'cumulative'
        ? { title: { text: 'Value', font: { size: EXPORT_FONT_SIZES.axisTitle } }, ...(log ? LOG_VALUE_AXIS : {}) }
        : plotType === 'fraction'
        ? { title: { text: 'Cumulative frequency', font: { size: EXPORT_FONT_SIZES.axisTitle } }, range: [-0.02, 1.02], dtick: 0.2, zeroline: false }
        : xAxisType === 'probability'
            ? { title: { text: 'Cumulative probability (%)', font: { size: EXPORT_FONT_SIZES.axisTitle } }, tickmode: 'array' as const, ...PROB_TICKS, zeroline: false }
            : { title: { text: 'Normal score (σ)', font: { size: EXPORT_FONT_SIZES.axisTitle } }, dtick: 1, zeroline: true };
    // Guide at -1σ (15.9%): rule of thumb - drop elements whose below-detection
    // step sits above this score
    const guide = plotType === 'cumulative' ? null : plotType === 'fraction' ? {
        // Median of each group where its curve crosses 0.5
        shapes: [{ type: 'line' as const, xref: 'x' as const, yref: 'paper' as const, x0: 0.5, x1: 0.5, y0: 0, y1: 1, line: { color: '#9e9e9e', width: 1, dash: 'dash' as const } }],
        annotations: [{ xref: 'x' as const, yref: 'paper' as const, x: 0.5, y: 1, text: 'median', showarrow: false, xanchor: 'left' as const, yanchor: 'top' as const, font: { size: 10, color: '#757575' } }],
    } : {
        shapes: [{ type: 'line' as const, xref: 'x' as const, yref: 'paper' as const, x0: -1, x1: -1, y0: 0, y1: 1, line: { color: '#9e9e9e', width: 1, dash: 'dash' as const } }],
        annotations: [{ xref: 'x' as const, yref: 'paper' as const, x: -1, y: 1, text: '−1σ', showarrow: false, xanchor: 'left' as const, yanchor: 'top' as const, font: { size: 10, color: '#757575' } }],
    };
    const yaxis = plotType === 'cumulative'
        ? { title: { text: 'Cumulative frequency (%)', font: { size: EXPORT_FONT_SIZES.axisTitle } } }
        : { title: { text: 'Value', font: { size: EXPORT_FONT_SIZES.axisTitle } }, ...(log ? LOG_VALUE_AXIS : {}) };

    return (
        <Box sx={{ p: plotId ? 1.5 : 3 }}>
            {!plotId && <Typography variant="h5" gutterBottom>Probability Plot</Typography>}

            <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <MultiColumnSelector
                    columns={numericColumns}
                    allColumns={allNumericColumns}
                    selectedColumns={selectedColumns}
                    onChange={setSelectedColumns}
                    label="Select Columns"
                />

                <ToggleButtonGroup value={plotType} exclusive size="small" onChange={(_, v) => { if (v) setPlotType(v); }}>
                    <ToggleButton value="probability">Probability</ToggleButton>
                    <ToggleButton value="cumulative">Cumulative frequency</ToggleButton>
                    <Tooltip title="cumulative frequency: 0-1 on X, value on Y; read each group's median at 0.5">
                        <ToggleButton value="fraction">Cumulative (0-1)</ToggleButton>
                    </Tooltip>
                </ToggleButtonGroup>

                {plotType === 'probability' && (
                    <ToggleButtonGroup value={xAxisType} exclusive size="small" onChange={(_, v) => { if (v) setXAxisType(v); }}>
                        <ToggleButton value="probability">Probability (%)</ToggleButton>
                        <ToggleButton value="nscore">N-score (σ)</ToggleButton>
                    </ToggleButtonGroup>
                )}

                <ToggleButtonGroup value={valueScale} exclusive size="small" onChange={(_, v) => { if (v) setValueScale(v); }}>
                    <ToggleButton value="linear">Linear</ToggleButton>
                    <ToggleButton value="log">Log</ToggleButton>
                </ToggleButtonGroup>

                <Tooltip title="Split Probability: rank each colour group (Attribute Manager) on its own, one curve per group">
                    <FormControlLabel control={<Switch size="small" checked={split} onChange={e => setSplit(e.target.checked)} />} label="Split by colour" />
                </Tooltip>
            </Box>

            {selectedColumns.length > 0 && rowCount > 0 ? (
                <>
                    {selectedColumns.length > MAX_SIMULTANEOUS_PLOTS && (
                        <Alert severity="warning" sx={{ mb: 2 }}>
                            Showing first {MAX_SIMULTANEOUS_PLOTS} of {selectedColumns.length} selected columns.
                            Deselect some columns to see others.
                        </Alert>
                    )}
                    {splitLegend.length > 0 && (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mb: 1.5 }} data-testid="probability-legend">
                            {splitLegend.map(g => (
                                <Box key={g.name} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <Box sx={{ width: 18, height: 3, bgcolor: g.colour, borderRadius: 1 }} />
                                    <Typography variant="caption">{g.name}</Typography>
                                </Box>
                            ))}
                        </Box>
                    )}
                    <Grid container spacing={2}>
                        {selectedColumns.slice(0, MAX_SIMULTANEOUS_PLOTS).map((columnName) => (
                            <Grid item xs={12} sm={6} lg={selectedColumns.length === 1 ? 12 : 4} key={columnName}>
                                <Paper sx={{ p: 1 }}>
                                    <ExpandablePlotWrapper>
                                        <Plot
                                            data={tracesFor(columnName)}
                                            layout={{
                                                title: { text: columnName, font: { size: EXPORT_FONT_SIZES.title }, x: 0, xanchor: 'left' },
                                                autosize: true,
                                                height: 400,
                                                font: { size: EXPORT_FONT_SIZES.tickLabels },
                                                margin: { l: 70, r: 20, t: 50, b: 60 },
                                                xaxis: { ...xaxis, ...(plotType === 'cumulative' ? { title: { ...xaxis.title, text: columnName } } : {}), tickfont: { size: EXPORT_FONT_SIZES.tickLabels }, gridcolor: '#e0e0e0', tickangle: 0 },
                                                yaxis: { ...yaxis, ...(plotType !== 'cumulative' ? { title: { ...yaxis.title, text: columnName } } : {}), tickfont: { size: EXPORT_FONT_SIZES.tickLabels }, gridcolor: '#e0e0e0' },
                                                hovermode: 'closest',
                                                showlegend: false,
                                                dragmode: 'lasso',
                                                ...guide,
                                            }}
                                            onSelected={handleSelected}
                                            onClick={handleClick}
                                            onDeselect={handleDeselect}
                                            config={getPlotConfig({ filename: `probability_${columnName}` })}
                                            style={{ width: '100%' }}
                                            useResizeHandler={true}
                                        />
                                    </ExpandablePlotWrapper>
                                </Paper>
                            </Grid>
                        ))}
                    </Grid>
                </>
            ) : (
                <Typography color="text.secondary">
                    Select one or more columns to display probability plots
                </Typography>
            )}
        </Box>
    );
};
