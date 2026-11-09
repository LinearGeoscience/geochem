import React, { useMemo, useCallback } from 'react';
import Plot from '../../components/ThemedPlot';
import { useAppStore, useDatasetRows } from '../../store/appStore';
import { useShallow } from 'zustand/react/shallow';
import { useAttributeStore } from '../../store/attributeStore';
import { useStyleInputs } from '../../hooks/useStyleInputs';
import { useBoxPlotStore, type BoxPlotSettings } from '../../store/boxPlotStore';
import { attributeColumnValues, getStyleArraysColumnar, sortColumnsByPriority } from '../../utils/attributeUtils';
import { crustalAbundance } from '../../utils/crustalAbundance';
import { getPlotConfig, EXPORT_FONT_SIZES } from '../../utils/plotConfig';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';
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
    ToggleButton,
    ToggleButtonGroup,
    Tooltip,
    TextField,
} from '@mui/material';
import { MultiColumnSelector } from '../../components/MultiColumnSelector';
import { useSelectionHandler, modeFromEvent } from '../../hooks/useSelectionHandler';
import { whiskerBounds, SELECTION_COLOR } from '../../utils/selectionHelpers';

/** Group By value for the Attribute Manager colour groups (box plots by colour) */
const COLOUR_GROUPS = '__colour_groups__';

// Color palette for box plots
const BOX_COLORS = [
    '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
    '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
    '#aec7e8', '#ffbb78', '#98df8a', '#ff9896', '#c5b0d5',
];

/** look: solid group fill, black outline, median and whiskers, hollow outliers in the group colour */
function boxStyle(color: string, violin: boolean): any {
    if (violin) return { marker: { color }, line: { color }, fillcolor: color + '80' };
    return {
        fillcolor: color,
        line: { color: '#000000', width: 1 },
        whiskerwidth: 0.6,
        marker: { color, symbol: 'circle-open', size: 7, line: { color, width: 1.2 } },
    };
}

/** Black mean dot over a box */
function meanDot(label: string, values: number[], vertical: boolean, ax: { x: string; y: string } | null): any {
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    return {
        type: 'scatter', mode: 'markers', showlegend: false, hoverinfo: 'text', text: [`mean ${+mean.toPrecision(4)}`],
        x: vertical ? [label] : [mean], y: vertical ? [mean] : [label],
        marker: { color: '#000000', size: 9, symbol: 'circle' },
        ...(ax ? { xaxis: ax.x, yaxis: ax.y } : {}),
    };
}

/** Subplot axis ids for panel k ('x'/'y', then 'x2'/'y2', ...) */
const panelAxes = (k: number) => ({ x: k ? `x${k + 1}` : 'x', y: k ? `y${k + 1}` : 'y' });

const LOG_AXIS = {
    exponentformat: 'none', showgrid: true, gridcolor: 'rgba(0,0,0,0.15)', gridwidth: 1, dtick: 1,
    minor: { showgrid: true, gridcolor: 'rgba(0,0,0,0.08)', gridwidth: 1, nticks: 9 },
};

/**
 * One panel per variable (grid, up to 3 across), each with its own value axis,
 * groups along the category axis; reference lines per panel.
 */
function panelLayout(o: {
    columns: string[]; categories: string[]; groupLabel: string; logScale: boolean; vertical: boolean;
    crust: ((col: string) => number | null) | null; refValue: number | null;
}): any {
    const n = o.columns.length;
    const cols = Math.min(3, n), rows = Math.ceil(n / cols);
    const layout: any = {
        // the reference software: no overall title, panels named by variable, groups told apart by colour
        // (legend across the bottom; no group labels under every panel)
        autosize: true,
        height: rows * 300 + 90,
        font: { size: EXPORT_FONT_SIZES.tickLabels },
        showlegend: true,
        legend: { orientation: 'h', x: 0, y: -0.02, xanchor: 'left', yanchor: 'top', font: { size: EXPORT_FONT_SIZES.legend }, title: { text: `${o.groupLabel}: ` } },
        margin: { l: 60, r: 40, t: 40, b: 60 },
        grid: { rows, columns: cols, pattern: 'independent', xgap: 0.15, ygap: 0.2 },
        boxgap: 0.3,
        shapes: [] as any[],
        annotations: [] as any[],
    };
    const at = (v: number) => (o.logScale ? Math.log10(v) : v);
    o.columns.forEach((col, k) => {
        const { x, y } = panelAxes(k);
        const suffix = k ? String(k + 1) : '';
        // Bold element name over each panel
        layout.annotations.push({ xref: `${x} domain`, yref: `${y} domain`, x: 0.5, y: 1.02, xanchor: 'center', yanchor: 'bottom',
            text: `<b>${col}</b>`, showarrow: false, font: { size: EXPORT_FONT_SIZES.axisTitle + 1 } });
        // Named by the bold panel title, so no axis title (it would sit in the gap beside the next panel)
        const value = {
            type: o.logScale ? 'log' : 'linear', automargin: true, ...(o.logScale ? LOG_AXIS : {}),
        };
        const category = { type: 'category', automargin: true, showticklabels: false };
        layout[`xaxis${suffix}`] = o.vertical ? category : value;
        layout[`yaxis${suffix}`] = o.vertical ? value : category;
        const lines: { value: number; label: string; color: string }[] = [];
        const c = o.crust?.(col);
        if (c != null && c > 0) lines.push({ value: c, label: `UCC ${+c.toPrecision(3)}`, color: '#c62828' });
        if (o.refValue !== null && (!o.logScale || o.refValue > 0)) lines.push({ value: o.refValue, label: String(o.refValue), color: '#424242' });
        for (const l of lines) {
            layout.shapes.push(o.vertical
                ? { type: 'line', xref: `${x} domain`, yref: y, x0: 0, x1: 1, y0: l.value, y1: l.value, line: { color: l.color, width: 1.5, dash: 'dash' } }
                : { type: 'line', xref: x, yref: `${y} domain`, x0: l.value, x1: l.value, y0: 0, y1: 1, line: { color: l.color, width: 1.5, dash: 'dash' } });
            layout.annotations.push(o.vertical
                // Just outside the panel's right edge, clear of the boxes
                ? { xref: `${x} domain`, yref: y, x: 1.01, y: at(l.value), text: l.label.replace(' ', '<br>'), showarrow: false, xanchor: 'left', yanchor: 'middle', font: { size: 9, color: l.color } }
                : { xref: x, yref: `${y} domain`, x: at(l.value), y: 1, text: l.label, showarrow: false, xanchor: 'left', yanchor: 'top', font: { size: 10, color: l.color } });
        }
    });
    return layout;
}

export const BoxPlot: React.FC = () => {
    const columns = useAppStore(s => s.columns);
    const data = useDatasetRows();
    const getColumn = useAppStore(s => s.getColumn);
    const filteredColumns = useAppStore(useShallow(s => s.getFilteredColumns()));
    const styleInputs = useStyleInputs();
    const attributeColour = useAttributeStore(s => s.color);
    const customEntries = useAttributeStore(s => s.customEntries);
    const getRawColumn = useAppStore(s => s.getRawColumn);
    const geochemMappings = useAppStore(s => s.geochemMappings);

    // State
    const numericColumns = useBoxPlotStore(s => s.numericColumns);
    const setNumericColumns = useCallback((v: BoxPlotSettings['numericColumns']) => useBoxPlotStore.getState().set({ numericColumns: v }), []);
    const categoryColumn = useBoxPlotStore(s => s.categoryColumn);
    const setCategoryColumn = useCallback((v: BoxPlotSettings['categoryColumn']) => useBoxPlotStore.getState().set({ categoryColumn: v }), []);
    const showViolin = useBoxPlotStore(s => s.showViolin);
    const setShowViolin = useCallback((v: BoxPlotSettings['showViolin']) => useBoxPlotStore.getState().set({ showViolin: v }), []);
    const showPoints = useBoxPlotStore(s => s.showPoints);
    const setShowPoints = useCallback((v: BoxPlotSettings['showPoints']) => useBoxPlotStore.getState().set({ showPoints: v }), []);
    const logScale = useBoxPlotStore(s => s.logScale);
    const setLogScale = useCallback((v: BoxPlotSettings['logScale']) => useBoxPlotStore.getState().set({ logScale: v }), []);
    const showNotches = useBoxPlotStore(s => s.showNotches);
    const setShowNotches = useCallback((v: BoxPlotSettings['showNotches']) => useBoxPlotStore.getState().set({ showNotches: v }), []);
    const orientation = useBoxPlotStore(s => s.orientation);
    const setOrientation = useCallback((v: BoxPlotSettings['orientation']) => useBoxPlotStore.getState().set({ orientation: v }), []);
    const showMean = useBoxPlotStore(s => s.showMean);
    const setShowMean = useCallback((v: BoxPlotSettings['showMean']) => useBoxPlotStore.getState().set({ showMean: v }), []);
    const categorySort = useBoxPlotStore(s => s.categorySort);
    const setCategorySort = useCallback((v: BoxPlotSettings['categorySort']) => useBoxPlotStore.getState().set({ categorySort: v }), []);
    // Reference lines: upper crust abundance of each variable, and a typed value
    const showCrust = useBoxPlotStore(s => s.showCrust);
    const setShowCrust = useCallback((v: BoxPlotSettings['showCrust']) => useBoxPlotStore.getState().set({ showCrust: v }), []);
    const panelSetting = useBoxPlotStore(s => s.panels);
    const setPanels = useCallback((v: boolean) => useBoxPlotStore.getState().set({ panels: v }), []);
    const refValue = useBoxPlotStore(s => s.refValue);
    const setRefValue = useCallback((v: BoxPlotSettings['refValue']) => useBoxPlotStore.getState().set({ refValue: v }), []);

    // Get column lists (sorted by priority) - respects RAW/CLR filter
    const numericColumnOptions = useMemo(() =>
        sortColumnsByPriority(filteredColumns.filter(c => c.type === 'numeric' || c.type === 'float' || c.type === 'integer')),
        [filteredColumns]
    );

    const allNumericColumns = useMemo(() => sortColumnsByPriority(
        columns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))
    ), [columns]);

    // Include all non-numeric columns as potential category options
    const categoricalColumnOptions = useMemo(() =>
        filteredColumns.filter(c =>
            c.type === 'string' ||
            c.type === 'category' ||
            c.type === 'text' ||
            // Also include any column that's not purely numeric
            (c.type !== 'numeric' && c.type !== 'float' && c.type !== 'integer')
        ),
        [filteredColumns]
    );

    // Visible rows and their original indices (full dataset: position = row)
    const { visibleData, visibleOrig } = useMemo(() => {
        if (!data.length) return { visibleData: [] as any[], visibleOrig: [] as number[] };
        void styleInputs; // visibility is read from the attribute store
        const styleArrays = getStyleArraysColumnar(data.length, (name) => getColumn(name));
        const rows: any[] = [];
        const orig: number[] = [];
        for (let i = 0; i < data.length; i++) {
            if (!styleArrays.visible[i]) continue;
            rows.push(data[i]);
            orig.push(i);
        }
        return { visibleData: rows, visibleOrig: orig };
    }, [data, getColumn, styleInputs]);

    // Colour group name per row and the group colours, when grouping by colour
    const colourGroups = useMemo(() => {
        if (categoryColumn !== COLOUR_GROUPS || !data.length) return null;
        void styleInputs;
        const names = attributeColumnValues('color', data.length, n => getRawColumn(n));
        const colours = new Map<string, string>();
        for (const e of [...attributeColour.entries, ...customEntries]) if (e.color && !colours.has(e.name)) colours.set(e.name, e.color);
        return { names, colours };
    }, [categoryColumn, data.length, getRawColumn, attributeColour, customEntries, styleInputs]);

    /** Category of each visible row ('' = none) */
    const visibleCats = useMemo(() => {
        if (!categoryColumn) return [] as string[];
        if (colourGroups) return visibleOrig.map(i => colourGroups.names[i] || '');
        return visibleData.map(row => (row[categoryColumn] == null ? '' : String(row[categoryColumn])));
    }, [categoryColumn, colourGroups, visibleData, visibleOrig]);

    /** Finite (and, on log scale, positive) values of `col` with their original rows. */
    const valuesWithRows = useCallback((col: string, keep?: (i: number) => boolean) => {
        const values: number[] = [];
        const rows: number[] = [];
        visibleData.forEach((row, i) => {
            if (keep && !keep(i)) return;
            const v = Number(row[col]);
            if (row[col] == null || !isFinite(v) || (logScale && v <= 0)) return;
            values.push(v);
            rows.push(visibleOrig[i]);
        });
        return { values, rows };
    }, [visibleData, visibleOrig, logScale]);

    // Get unique categories (with optional sorting by median value)
    const categories = useMemo(() => {
        if (!categoryColumn || !visibleData.length) return [];
        const categoryList = Array.from(new Set(visibleCats.filter(Boolean)));

        // If sorting by value and we have numeric columns, calculate median for each category
        if (categorySort !== 'alpha' && numericColumns.length > 0) {
            const numCol = numericColumns[0]; // Sort by first selected numeric column
            const categoryMedians: Record<string, number> = {};

            categoryList.forEach(category => {
                const values = visibleData
                    .filter((_, i) => visibleCats[i] === category)
                    .map(row => Number(row[numCol]))
                    .filter(v => !isNaN(v) && isFinite(v))
                    .sort((a, b) => a - b);

                if (values.length > 0) {
                    const midIdx = Math.floor(values.length / 2);
                    categoryMedians[category] = values.length % 2 === 0
                        ? (values[midIdx - 1] + values[midIdx]) / 2
                        : values[midIdx];
                } else {
                    categoryMedians[category] = 0;
                }
            });

            categoryList.sort((a, b) => {
                const diff = categoryMedians[a] - categoryMedians[b];
                return categorySort === 'asc' ? diff : -diff;
            });
        } else {
            // Alphabetical sort
            categoryList.sort();
        }

        return categoryList;
    }, [categoryColumn, visibleData, visibleCats, categorySort, numericColumns]);

    const panels = panelSetting && !!categoryColumn && categories.length > 0 && numericColumns.length > 1;

    // Generate traces
    const { traces, traceMeta } = useMemo(() => {
        const traces: any[] = [];
        // Per trace: values, original rows and category label (for selection)
        const traceMeta: { values: number[]; rows: number[]; label: string; xaxis?: string; yaxis?: string }[] = [];
        if (!numericColumns.length || !visibleData.length) return { traces, traceMeta };

        if (categoryColumn && categories.length > 0) {
            // Grouped box plots - one trace per category per numeric column
            // (in panel mode each variable gets its own subplot and value axis)
            const single = numericColumns.length === 1 || panels;
            numericColumns.forEach((numCol, numIdx) => {
                const ax = panels ? panelAxes(numIdx) : null;
                categories.forEach((category, catIdx) => {
                    const { values, rows } = valuesWithRows(numCol, i => visibleCats[i] === category);

                    if (values.length === 0) return;
                    const label = single ? category : `${category}\n${numCol}`;

                    const colorIndex = single ? catIdx : numIdx;
                    const groupColour = colourGroups?.colours.get(category);
                    const color = groupColour && /^#[0-9a-f]{6}$/i.test(groupColour) && single
                        ? groupColour : BOX_COLORS[colorIndex % BOX_COLORS.length];

                    const trace: any = {
                        type: showViolin ? 'violin' : 'box',
                        name: single ? category : `${numCol} - ${category}`,
                        legendgroup: single ? category : numCol,
                        ...boxStyle(color, showViolin),
                    };
                    if (ax) {
                        trace.xaxis = ax.x;
                        trace.yaxis = ax.y;
                        trace.showlegend = numIdx === 0;
                    }

                    if (orientation === 'v') {
                        trace.y = values;
                        trace.x = Array(values.length).fill(label);
                    } else {
                        trace.x = values;
                        trace.y = Array(values.length).fill(label);
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
                        trace.boxmean = false; // mean drawn as a black dot (meanDot)
                        trace.notched = showNotches;
                    }

                    traces.push(trace);
                    if (showMean && !showViolin) traces.push(meanDot(label, values, orientation === 'v', ax));
                    traceMeta.push({ values, rows, label, xaxis: ax?.x, yaxis: ax?.y });
                });
            });
        } else {
            // Simple box plots - one trace per numeric column
            numericColumns.forEach((numCol, idx) => {
                const { values, rows } = valuesWithRows(numCol);

                if (values.length === 0) return;

                const color = BOX_COLORS[idx % BOX_COLORS.length];

                const trace: any = {
                    type: showViolin ? 'violin' : 'box',
                    name: numCol,
                    ...boxStyle(color, showViolin),
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
                traceMeta.push({ values, rows, label: numCol });
            });
        }

        return { traces, traceMeta };
    }, [numericColumns, categoryColumn, categories, visibleData, visibleCats, colourGroups, showViolin, showPoints, showMean, showNotches, orientation, valuesWithRows, panels]);

    // --- linked selection -------------------------------------------------
    const { selectIndices, handleDeselect, selectedIndices } = useSelectionHandler();

    /**
     * Click a sample point (outlier, or any point when points are shown) to
     * select that row; click the box itself to select the group's rows
     * within the whiskers.
     */
    const handleBoxClick = useCallback((event: any) => {
        const pt = event?.points?.[0];
        if (!pt) return;
        const meta = traceMeta[pt.curveNumber];
        if (!meta) return;
        const mode = modeFromEvent(event.event);
        if (typeof pt.pointNumber === 'number' && meta.rows[pt.pointNumber] !== undefined && pt.hoverOnBox !== true) {
            selectIndices([meta.rows[pt.pointNumber]], mode);
            return;
        }
        const w = whiskerBounds(meta.values);
        if (!w) return;
        const rows = meta.rows.filter((_, k) => meta.values[k] >= w.lo && meta.values[k] <= w.hi);
        selectIndices(rows, mode);
    }, [traceMeta, selectIndices]);

    // Selected samples overlaid on each box's category position
    const selectionTraces = useMemo(() => {
        if (selectedIndices.length === 0) return [];
        const sel = new Set(selectedIndices);
        const out: any[] = [];
        for (const meta of traceMeta) {
            const vals: number[] = [];
            meta.rows.forEach((r, k) => { if (sel.has(r)) vals.push(meta.values[k]); });
            if (vals.length === 0) continue;
            const labels = vals.map(() => meta.label);
            out.push({
                type: 'scatter', mode: 'markers', hoverinfo: 'skip', showlegend: false,
                x: orientation === 'v' ? labels : vals,
                y: orientation === 'v' ? vals : labels,
                marker: { color: SELECTION_COLOR, size: 7, line: { width: 1, color: '#ffffff' } },
                ...(meta.xaxis ? { xaxis: meta.xaxis, yaxis: meta.yaxis } : {}),
            });
        }
        return out;
    }, [selectedIndices, traceMeta, orientation]);

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
        const groupLabel = categoryColumn === COLOUR_GROUPS ? 'colour group' : categoryColumn;
        if (panels) return panelLayout({
            columns: numericColumns, categories, groupLabel, logScale, vertical: orientation === 'v',
            crust: showCrust ? (col: string) => crustalAbundance(col, geochemMappings) : null,
            refValue: refValue.trim() && Number.isFinite(Number(refValue)) ? Number(refValue) : null,
        });
        const title = categoryColumn
            ? `${numericColumns.join(', ')} by ${groupLabel}`
            : numericColumns.join(', ');

        const layout: any = {
            title: { text: title, font: { size: EXPORT_FONT_SIZES.title }, x: 0, xanchor: 'left' },
            autosize: false,
            width: plotWidth,
            height: 350,
            font: { size: EXPORT_FONT_SIZES.tickLabels },
            showlegend: numericColumns.length > 1 || categories.length > 5,
            legend: {
                x: 1.02,
                y: 1,
                xanchor: 'left',
                yanchor: 'top',
                font: { size: EXPORT_FONT_SIZES.legend },
                bgcolor: 'rgba(255,255,255,0.8)',
            },
            margin: { l: 70, r: 120, t: 60, b: 70 },
            boxgap: 0.3, // Gap between boxes in the same group
            boxgroupgap: 0.4, // Gap between box groups
        };

        if (orientation === 'v') {
            // Calculate if we need angled labels based on number of categories
            const needsAngledLabels = categoryColumn && categories.length > 3;
            layout.xaxis = {
                title: { text: groupLabel || 'Variable', font: { size: EXPORT_FONT_SIZES.axisTitle } },
                tickfont: { size: EXPORT_FONT_SIZES.tickLabels },
                type: categoryColumn ? 'category' : undefined,
                tickangle: needsAngledLabels ? -45 : 0,
                automargin: true, // Auto-expand margin to fit labels
            };
            layout.yaxis = {
                title: { text: numericColumns.length === 1 ? numericColumns[0] : 'Value', font: { size: EXPORT_FONT_SIZES.axisTitle } },
                tickfont: { size: EXPORT_FONT_SIZES.tickLabels },
                type: logScale ? 'log' : 'linear',
                ...(logScale && {
                    // Show actual values (0.5, 0.005) instead of powers of 10
                    exponentformat: 'none',
                    // Classic log paper gridlines
                    showgrid: true,
                    gridcolor: 'rgba(0,0,0,0.15)',
                    gridwidth: 1,
                    minor: {
                        showgrid: true,
                        gridcolor: 'rgba(0,0,0,0.08)',
                        gridwidth: 1,
                        nticks: 9, // 9 minor ticks between major ticks for log scale
                    },
                    dtick: 1, // Major gridlines at each power of 10
                }),
            };
            // Increase bottom margin for angled labels
            if (needsAngledLabels) {
                layout.margin.b = 120;
            }
        } else {
            // For horizontal, angle y-axis labels if needed
            const needsAngledLabels = categoryColumn && categories.length > 5;
            layout.yaxis = {
                title: { text: groupLabel || 'Variable', font: { size: EXPORT_FONT_SIZES.axisTitle } },
                tickfont: { size: EXPORT_FONT_SIZES.tickLabels },
                type: categoryColumn ? 'category' : undefined,
                automargin: true, // Auto-expand margin to fit labels
            };
            layout.xaxis = {
                title: { text: numericColumns.length === 1 ? numericColumns[0] : 'Value', font: { size: EXPORT_FONT_SIZES.axisTitle } },
                tickfont: { size: EXPORT_FONT_SIZES.tickLabels },
                type: logScale ? 'log' : 'linear',
                ...(logScale && {
                    // Show actual values (0.5, 0.005) instead of powers of 10
                    exponentformat: 'none',
                    // Classic log paper gridlines
                    showgrid: true,
                    gridcolor: 'rgba(0,0,0,0.15)',
                    gridwidth: 1,
                    minor: {
                        showgrid: true,
                        gridcolor: 'rgba(0,0,0,0.08)',
                        gridwidth: 1,
                        nticks: 9, // 9 minor ticks between major ticks for log scale
                    },
                    dtick: 1, // Major gridlines at each power of 10
                }),
            };
            // Increase left margin for longer labels
            if (needsAngledLabels) {
                layout.margin.l = 120;
            }
        }

        // Reference lines across the plot at a value (crustal abundance, typed value)
        const lines: { value: number; label: string; color: string }[] = [];
        if (showCrust) {
            for (const col of numericColumns) {
                const v = crustalAbundance(col, geochemMappings);
                if (v != null && v > 0) lines.push({ value: v, label: `UCC ${numericColumns.length > 1 ? col + ' ' : ''}${+v.toPrecision(3)}`, color: '#c62828' });
            }
        }
        const typed = Number(refValue);
        if (refValue.trim() && Number.isFinite(typed) && (!logScale || typed > 0)) lines.push({ value: typed, label: String(typed), color: '#424242' });
        const vertical = orientation === 'v';
        // On a log axis shapes take data values but annotations take log10 positions
        const at = (v: number) => (logScale ? Math.log10(v) : v);
        layout.shapes = lines.map(l => ({
            type: 'line', xref: vertical ? 'paper' : 'x', yref: vertical ? 'y' : 'paper',
            x0: vertical ? 0 : l.value, x1: vertical ? 1 : l.value, y0: vertical ? l.value : 0, y1: vertical ? l.value : 1,
            line: { color: l.color, width: 1.5, dash: 'dash' },
        }));
        layout.annotations = lines.map(l => ({
            xref: vertical ? 'paper' : 'x', yref: vertical ? 'y' : 'paper',
            x: vertical ? 1 : at(l.value), y: vertical ? at(l.value) : 1,
            text: l.label, showarrow: false, font: { size: 10, color: l.color },
            xanchor: vertical ? 'left' : 'center', yanchor: vertical ? 'middle' : 'bottom',
        }));

        return layout;
    }, [numericColumns, categoryColumn, categories, logScale, orientation, plotWidth, showCrust, refValue, geochemMappings, panels]);

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
                        .map(row => Number(row[numCol]))
                        .filter(v => v != null && !isNaN(v) && isFinite(v));
                    calcStats(values, `${numCol} - ${category}`);
                });
            });
        } else {
            numericColumns.forEach(numCol => {
                const values = visibleData
                    .map(row => Number(row[numCol]))
                    .filter(v => v != null && !isNaN(v) && isFinite(v));
                calcStats(values, numCol);
            });
        }

        return result;
    }, [numericColumns, categoryColumn, categories, visibleData]);

    return (
        <Box sx={{ p: 3 }}>
            <Typography variant="h5" gutterBottom>Box Plots</Typography>

            {/* Controls: one wrapping row sized to the pane (not viewport breakpoints) */}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 2, alignItems: 'flex-start' }}>
                <Box sx={{ flex: '1 1 360px', minWidth: 280, maxWidth: 640 }}>
                    <MultiColumnSelector
                        columns={numericColumnOptions}
                        allColumns={allNumericColumns}
                        selectedColumns={numericColumns}
                        onChange={setNumericColumns}
                        label="Numeric Variables"
                    />
                </Box>

                <Box sx={{ width: 220 }}>
                    <FormControl fullWidth size="small">
                        <InputLabel>Group By (Category)</InputLabel>
                        <Select
                            value={categoryColumn}
                            onChange={(e) => setCategoryColumn(e.target.value)}
                            label="Group By (Category)"
                        >
                            <MenuItem value="">
                                <em>None</em>
                            </MenuItem>
                            <MenuItem value={COLOUR_GROUPS}>
                                <em>Colour groups (Attribute Manager)</em>
                            </MenuItem>
                            {categoricalColumnOptions.map((col) => (
                                <MenuItem key={col.name} value={col.name}>
                                    {col.alias || col.name}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </Box>

                <Box sx={{ width: 200 }}>
                    <FormControl fullWidth size="small" disabled={!categoryColumn}>
                        <InputLabel>Sort Categories</InputLabel>
                        <Select
                            value={categorySort}
                            onChange={(e) => setCategorySort(e.target.value as 'alpha' | 'asc' | 'desc')}
                            label="Sort Categories"
                        >
                            <MenuItem value="alpha">Alphabetical</MenuItem>
                            <MenuItem value="asc">By Median (Low → High)</MenuItem>
                            <MenuItem value="desc">By Median (High → Low)</MenuItem>
                        </Select>
                    </FormControl>
                </Box>

                <Box sx={{ flex: '1 1 100%' }}>
                    <Box sx={{ display: 'flex', columnGap: 1, rowGap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
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

                        <Tooltip title="Grouped by a category with several variables: one panel per variable, each with its own scale">
                            <FormControlLabel
                                control={<Checkbox checked={panelSetting} onChange={(e) => setPanels(e.target.checked)} size="small" disabled={!categoryColumn || numericColumns.length < 2} />}
                                label="Panel per variable"
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

                        <Tooltip title="Upper continental crust abundance of each variable (Rudnick & Gao 2003), in the column's units">
                            <FormControlLabel
                                control={<Checkbox checked={showCrust} onChange={(e) => setShowCrust(e.target.checked)} size="small" />}
                                label="Crustal abundance"
                            />
                        </Tooltip>
                        <Tooltip title="Draw a reference line at this value">
                            <TextField size="small" label="Line at" type="number" sx={{ width: 100 }} value={refValue} onChange={(e) => setRefValue(e.target.value)} />
                        </Tooltip>

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
                </Box>
            </Box>

            {/* Plot */}
            {numericColumns.length === 0 ? (
                <Typography color="text.secondary">
                    Select at least one numeric variable to display box plots
                </Typography>
            ) : (
                <>
                    <Paper sx={{ p: 2, display: panels ? 'block' : 'inline-block' }}>
                        <ExpandablePlotWrapper>
                            <Plot
                                data={[...traces, ...selectionTraces]}
                                layout={layout}
                                {...(panels ? { style: { width: '100%' }, useResizeHandler: true } : {})}
                                config={getPlotConfig({ filename: 'boxplot', responsive: panels })}
                                onClick={handleBoxClick}
                                onDoubleClick={handleDeselect}
                            />
                        </ExpandablePlotWrapper>
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
