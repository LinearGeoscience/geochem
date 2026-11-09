import React, { useCallback, useMemo, useRef } from 'react';
import Plot from '../../components/ThemedPlot';
import { useAppStore, useDisplayRows } from '../../store/appStore';
import { usePlotSetting } from '../../hooks/usePlotSetting';
import { useShallow } from 'zustand/react/shallow';
import {
    Box,
    Paper,
    Typography,
    Slider,
    FormControlLabel,
    Checkbox,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip,
} from '@mui/material';
import { MultiColumnSelector } from '../../components/MultiColumnSelector';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';
import { getPlotConfig, EXPORT_FONT_SIZES } from '../../utils/plotConfig';
import { getStyleArraysColumnar, sortColumnsByPriority, getColumnDisplayName } from '../../utils/attributeUtils';
import { PlotControlBar, ControlSection, SettingChip } from '../../components/plot_controls/PlotControlBar';
import { useSelectionHandler } from '../../hooks/useSelectionHandler';
import { explicitBins, histogramPointRows, HistogramBins, SELECTION_COLOR } from '../../utils/selectionHelpers';
import { ColumnPicker } from '../../components/ColumnPicker';
import { useStyleInputs } from '../../hooks/useStyleInputs';

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
    const { columns, lockAxes } = useAppStore(useShallow(s => ({ columns: s.columns, lockAxes: s.lockAxes })));
    const getDisplayColumn = useAppStore(s => s.getDisplayColumn);
    const filteredColumns = useAppStore(useShallow(s => s.getFilteredColumns()));
    const d = useCallback((name: string) => getColumnDisplayName(columns, name), [columns]);
    // Visibility comes from the attribute store (read inside getStyleArraysColumnar);
    // this object is the dependency that tracks it
    const attributeStyleState = useStyleInputs();

    const displayData = useDisplayRows();
    const displayIndices = useAppStore(s => s._sampleIndicesArray);

    const [selectedColumns, setSelectedColumns] = usePlotSetting<string[]>(plotId, 'selectedColumns', []);
    const [binCount, setBinCount] = usePlotSetting<number>(plotId, 'binCount', 30);
    const [overlayMode, setOverlayMode] = usePlotSetting<boolean>(plotId, 'overlayMode', false);
    const [showDensity, setShowDensity] = usePlotSetting<boolean>(plotId, 'showDensity', false);
    const [categoryColumn, setCategoryColumn] = usePlotSetting<string>(plotId, 'categoryColumn', '');
    const [barMode, setBarMode] = usePlotSetting<BarMode>(plotId, 'barMode', 'stack');
    const [normMode, setNormMode] = usePlotSetting<NormMode>(plotId, 'normMode', 'count');

    const numericColumns = sortColumnsByPriority(
        filteredColumns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))
    );

    const allNumericColumns = useMemo(() => sortColumnsByPriority(
        columns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))
    ), [columns]);

    // Visible rows (attribute filters) and their ORIGINAL row indices
    const { visibleData, visibleOrig } = useMemo(() => {
        if (!displayData.length) return { visibleData: [] as any[], visibleOrig: [] as number[] };
        void attributeStyleState; // visibility is read from the attribute store
        const styleArrays = getStyleArraysColumnar(displayData.length, (name) => getDisplayColumn(name), displayIndices ?? undefined);
        const rows: any[] = [];
        const orig: number[] = [];
        for (let i = 0; i < displayData.length; i++) {
            if (!styleArrays.visible[i]) continue;
            rows.push(displayData[i]);
            orig.push(displayIndices ? displayIndices[i] : i);
        }
        return { visibleData: rows, visibleOrig: orig };
    }, [displayData, displayIndices, getDisplayColumn, attributeStyleState]);

    // Shared explicit bins per column, so base bars, category bars and the
    // selection overlay use identical edges and bars map back to rows
    const binsByColumn = useMemo(() => {
        const m = new Map<string, HistogramBins | null>();
        for (const col of selectedColumns) {
            m.set(col, explicitBins(visibleData.map(r => r[col] as number), binCount));
        }
        return m;
    }, [visibleData, selectedColumns, binCount]);

    /** Finite values of `col` among `idx` (positions in visibleData) + their original rows. */
    const valuesWithRows = useCallback((col: string, idx?: number[]) => {
        const values: number[] = [];
        const rows: number[] = [];
        const positions = idx ?? visibleData.map((_, i) => i);
        for (const i of positions) {
            const v = visibleData[i][col];
            if (v == null || isNaN(v)) continue;
            values.push(v);
            rows.push(visibleOrig[i]);
        }
        return { values, rows };
    }, [visibleData, visibleOrig]);

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
    const histNorm = normMode === 'percent' ? 'percent' : normMode === 'density' ? 'probability density' : '';

    // Generate histogram traces
    const { traces, layout, traceRows } = useMemo(() => {
        if (!visibleData.length || !selectedColumns.length) {
            return { traces: [] as any[], layout: {} as any, traceRows: [] as (number[] | undefined)[] };
        }

        const traces: any[] = [];
        // traceRows[curveNumber] = original row index for each input value
        const traceRows: (number[] | undefined)[] = [];
        const push = (trace: any, rows?: number[]) => { traces.push(trace); traceRows.push(rows); };
        const xbins = (col: string) => {
            const b = binsByColumn.get(col);
            return b ? { start: b.start, end: b.end, size: b.size } : undefined;
        };
        const histnorm = histNorm;
        const yAxisTitle = normMode === 'count' ? 'Count' : normMode === 'percent' ? 'Percent' : 'Density';

        // Determine if we have category grouping
        const hasCategories = categoryColumn && categories.length > 0;

        if (overlayMode || hasCategories) {
            // Overlay mode or category grouping - all on same plot
            if (hasCategories) {
                // Category-grouped histograms
                selectedColumns.forEach((col, colIdx) => {
                    categories.forEach((category, catIdx) => {
                        const inCategory: number[] = [];
                        visibleData.forEach((row, i) => { if (String(row[categoryColumn]) === category) inCategory.push(i); });
                        const { values, rows } = valuesWithRows(col, inCategory);

                        if (values.length === 0) return;

                        const colorIndex = selectedColumns.length > 1 ? colIdx : catIdx;
                        const color = HISTOGRAM_COLORS[colorIndex % HISTOGRAM_COLORS.length];

                        push({
                            x: values,
                            type: 'histogram',
                            name: selectedColumns.length > 1 ? `${d(col)} - ${category}` : category,
                            legendgroup: selectedColumns.length > 1 ? col : category,
                            xbins: xbins(col),
                            autobinx: false,
                            opacity: barMode === 'overlay' ? 0.6 : 0.85,
                            marker: { color },
                            histnorm: histnorm || undefined,
                        }, rows);
                    });
                });
            } else {
                // Original overlay mode (no categories)
                selectedColumns.forEach((col, i) => {
                    const { values, rows } = valuesWithRows(col);

                    push({
                        x: values,
                        type: 'histogram',
                        name: d(col),
                        xbins: xbins(col),
                        autobinx: false,
                        opacity: 0.6,
                        marker: { color: HISTOGRAM_COLORS[i % HISTOGRAM_COLORS.length] },
                        histnorm: histnorm || undefined,
                    }, rows);

                    if (showDensity && normMode === 'count') {
                        push({
                            x: values,
                            type: 'histogram',
                            name: `${d(col)} (density)`,
                            xbins: xbins(col),
                            autobinx: false,
                            histnorm: 'probability density',
                            opacity: 0,
                            yaxis: 'y2',
                            showlegend: false,
                        });
                    }
                });
            }

            const title = hasCategories
                ? `${selectedColumns.map(c => d(c)).join(', ')} by ${categoryColumn}`
                : 'Histogram (Overlay)';

            const layout: any = {
                title: { text: title, font: { size: EXPORT_FONT_SIZES.title }, x: 0, xanchor: 'left' },
                barmode: hasCategories ? barMode : 'overlay',
                autosize: true,
                height: 350,
                showlegend: true,
                legend: { x: 1, y: 1, xanchor: 'right', font: { size: EXPORT_FONT_SIZES.legend } },
                font: { size: EXPORT_FONT_SIZES.tickLabels },
                xaxis: { title: { text: selectedColumns.length === 1 ? d(selectedColumns[0]) : 'Value', font: { size: EXPORT_FONT_SIZES.axisTitle } }, tickfont: { size: EXPORT_FONT_SIZES.tickLabels } },
                yaxis: { title: { text: yAxisTitle, font: { size: EXPORT_FONT_SIZES.axisTitle } }, tickfont: { size: EXPORT_FONT_SIZES.tickLabels } },
                margin: { l: 70, r: 40, t: 60, b: 70 },
                // Stable token: preserve zoom across re-renders; reset when columns/mode change
                uirevision: lockAxes ? 'locked' : `${selectedColumns.join(',')}|${categoryColumn}|${normMode}`,
            };

            if (showDensity && normMode === 'count' && !hasCategories) {
                layout.yaxis2 = {
                    title: 'Density',
                    overlaying: 'y',
                    side: 'right',
                };
            }

            return { traces, layout, traceRows };
        } else {
            // Grid layout - separate histogram per column
            selectedColumns.forEach((col, i) => {
                const { values, rows } = valuesWithRows(col);

                push({
                    x: values,
                    type: 'histogram',
                    name: d(col),
                    xbins: xbins(col),
                    autobinx: false,
                    marker: { color: HISTOGRAM_COLORS[i % HISTOGRAM_COLORS.length] },
                    xaxis: i === 0 ? 'x' : `x${i + 1}`,
                    yaxis: i === 0 ? 'y' : `y${i + 1}`,
                    histnorm: histnorm || undefined,
                }, rows);
            });

            // Calculate grid dimensions
            const cols = Math.min(selectedColumns.length, 3);
            const rows = Math.ceil(selectedColumns.length / cols);

            const layout: any = {
                title: { text: 'Histograms', font: { size: EXPORT_FONT_SIZES.title }, x: 0, xanchor: 'left' },
                autosize: true,
                height: Math.max(300, rows * 200),
                showlegend: false,
                font: { size: EXPORT_FONT_SIZES.tickLabels },
                margin: { l: 70, r: 40, t: 60, b: 70 },
                grid: {
                    rows,
                    columns: cols,
                    pattern: 'independent',
                },
                // One data trace per subplot; overlay lets the selection bars sit on top
                barmode: 'overlay',
                // Stable token: preserve zoom across re-renders; reset when columns/mode change
                uirevision: lockAxes ? 'locked' : `${selectedColumns.join(',')}|${categoryColumn}|${normMode}`,
            };

            // Configure each subplot axis
            selectedColumns.forEach((col, i) => {
                const xKey = i === 0 ? 'xaxis' : `xaxis${i + 1}`;
                const yKey = i === 0 ? 'yaxis' : `yaxis${i + 1}`;
                layout[xKey] = { title: { text: d(col), font: { size: EXPORT_FONT_SIZES.axisTitle } }, tickfont: { size: EXPORT_FONT_SIZES.tickLabels } };
                layout[yKey] = { title: { text: yAxisTitle, font: { size: EXPORT_FONT_SIZES.axisTitle } }, tickfont: { size: EXPORT_FONT_SIZES.tickLabels } };
            });

            return { traces, layout, traceRows };
        }
    }, [visibleData, selectedColumns, overlayMode, showDensity, lockAxes, categoryColumn, categories, barMode, normMode, histNorm, d, binsByColumn, valuesWithRows]);

    // --- linked selection -------------------------------------------------
    const traceRowsRef = useRef<(number[] | undefined)[]>([]);
    traceRowsRef.current = traceRows ?? [];
    const extractRows = useCallback((pt: any) => histogramPointRows(pt, traceRowsRef.current), []);
    const { handleSelected, handleClick, handleDeselect, selectedIndices } = useSelectionHandler(extractRows);

    // Selected samples drawn on top: an overlaid histogram (same bins) where
    // bars overlay, a rug of ticks where bars are stacked/grouped by category
    const selectionTraces = useMemo(() => {
        if (selectedIndices.length === 0 || !visibleData.length || !selectedColumns.length) return [];
        const sel = new Set(selectedIndices);
        const positions: number[] = [];
        visibleOrig.forEach((orig, i) => { if (sel.has(orig)) positions.push(i); });
        if (positions.length === 0) return [];
        const grouped = !!categoryColumn && categories.length > 0;
        const gridMode = !overlayMode && !grouped;
        return selectedColumns.map((col, i) => {
            const { values } = valuesWithRows(col, positions);
            const axes = gridMode ? { xaxis: i === 0 ? 'x' : `x${i + 1}`, yaxis: i === 0 ? 'y' : `y${i + 1}` } : {};
            if (grouped) {
                return {
                    x: values, y: values.map(() => 0), type: 'scatter', mode: 'markers', ...axes,
                    marker: { symbol: 'line-ns-open', size: 14, color: SELECTION_COLOR, line: { width: 2, color: SELECTION_COLOR } },
                    name: 'Selected', showlegend: false, hoverinfo: 'skip', cliponaxis: false,
                };
            }
            const b = binsByColumn.get(col);
            return {
                x: values, type: 'histogram', ...axes,
                xbins: b ? { start: b.start, end: b.end, size: b.size } : undefined, autobinx: false,
                histnorm: histNorm || undefined,
                marker: { color: SELECTION_COLOR, line: { width: 1, color: '#ffffff' } },
                opacity: 0.85, name: `Selected (${values.length})`, showlegend: false, hoverinfo: 'skip',
            };
        });
    }, [selectedIndices, visibleData, visibleOrig, selectedColumns, categoryColumn, categories, overlayMode, valuesWithRows, binsByColumn, histNorm]);

    const hasCategories = categoryColumn && categories.length > 0;

    return (
        <Box sx={{ p: 1 }}>
            <PlotControlBar
                primary={<>
                    <MultiColumnSelector
                        columns={numericColumns}
                        selectedColumns={selectedColumns}
                        onChange={setSelectedColumns}
                        label="Numeric Variables"
                        allColumns={allNumericColumns}
                    />

                    <ColumnPicker label="Group By (Category)" value={categoryColumn} onChange={setCategoryColumn} filter="categorical" allowNone minWidth={180} />
                </>}
                settingsActive={
                    binCount !== 30 ||
                    normMode !== 'count' ||
                    (hasCategories ? barMode !== 'stack' : overlayMode)
                }
                summary={<>
                    {binCount !== 30 && <SettingChip label={`Bins: ${binCount}`} onDelete={() => setBinCount(30)} />}
                    {normMode !== 'count' && (
                        <SettingChip
                            label={normMode === 'percent' ? 'Percent' : 'Density'}
                            onDelete={() => setNormMode('count')}
                        />
                    )}
                    {hasCategories && barMode !== 'stack' && (
                        <SettingChip
                            label={barMode === 'group' ? 'Grouped' : 'Overlaid'}
                            onDelete={() => setBarMode('stack')}
                        />
                    )}
                    {!hasCategories && overlayMode && (
                        <SettingChip label="Overlay" onDelete={() => setOverlayMode(false)} />
                    )}
                    {overlayMode && !hasCategories && normMode === 'count' && showDensity && (
                        <SettingChip label="Density curve" onDelete={() => setShowDensity(false)} />
                    )}
                </>}
                settings={<>
                    <ControlSection label="Bins">
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
                    </ControlSection>

                    <ControlSection label="Display">
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
                                sx={{ ml: 3.5 }}
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
                    </ControlSection>
                </>}
            />

            {selectedColumns.length === 0 ? (
                <Typography color="text.secondary">
                    Select columns to display histograms
                </Typography>
            ) : (
                <Paper sx={{ p: 2 }}>
                    <ExpandablePlotWrapper>
                        <Plot
                            data={[...traces, ...selectionTraces]}
                            layout={{ ...layout, dragmode: 'select', selectdirection: 'h' }}
                            config={getPlotConfig({ filename: `histogram_${selectedColumns.join('_')}` })}
                            style={{ width: '100%' }}
                            useResizeHandler={true}
                            onClick={handleClick}
                            onSelected={handleSelected}
                            onDeselect={handleDeselect}
                        />
                    </ExpandablePlotWrapper>
                    <Typography variant="caption" color="text.secondary">
                        Click a bar or drag across bins to select those samples (Ctrl/Shift adds, Alt removes).
                        {selectedIndices.length > 0 && ` ${selectedIndices.length.toLocaleString()} selected.`}
                    </Typography>

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
                                        {d(col)}
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
