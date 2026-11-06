/**
 * Scatter-plot matrix (SPLOM, WebGL) over 2–8 numeric columns.
 *
 * Styled by the Attribute Manager (colour, shape, size, visibility) and
 * linked to the global selection: box/lasso in any panel selects those
 * samples everywhere, and the current selection is highlighted in every
 * panel.
 */
import React, { useCallback, useMemo } from 'react';
import Plot from '../../components/ThemedPlot';
import { Box, FormControlLabel, Paper, Switch, Typography } from '@mui/material';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore, useAnalyticalStore } from '../../store/appStore';
import { usePlotSetting } from '../../hooks/usePlotSetting';
import { MultiColumnSelector } from '../../components/MultiColumnSelector';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';
import { PlotControlBar, ControlSection, SettingChip } from '../../components/plot_controls/PlotControlBar';
import {
    getStyleArraysColumnar, shapeToPlotlySymbol, applyOpacityToColor, sortColumnsByPriority, getColumnDisplayName, getSortedIndices } from '../../utils/attributeUtils';
import { isNumericColumn } from '../../types/columnarData';
import { getPlotConfig } from '../../utils/plotConfig';
import { useDragMode } from '../../hooks/useDragMode';
import { useFillHeight } from '../../hooks/useFillHeight';
import { useStyleInputs } from '../../hooks/useStyleInputs';

const NUMERIC = new Set(['numeric', 'float', 'integer']);
const MAX_VARIABLES = 8;

export const ScatterMatrix: React.FC<{ plotId: string }> = ({ plotId }) => {
    // Fill the dock pane below the controls (fixed height outside the workspace)
    const { ref: fillRef, height: fillHeight } = useFillHeight<HTMLDivElement>(500, 360, 48);
    const dragMode = useDragMode();
    const { columns, setSelection, selectedIndices } = useAppStore(useShallow(s => ({
        columns: s.columns, setSelection: s.setSelection, selectedIndices: s.selectedIndices,
    })));
    const filteredColumns = useAppStore(useShallow(s => s.getFilteredColumns()));
    const displayIndices = useAppStore(s => s._sampleIndicesArray);
    const getDisplayColumn = useAppStore(s => s.getDisplayColumn);
    const analytical = useAnalyticalStore();
    const attributeStyleState = useStyleInputs();

    const [variables, setVariables] = usePlotSetting<string[]>(plotId, 'splomColumns', []);
    const [logColumns, setLogColumns] = usePlotSetting<string[]>(plotId, 'splomLogColumns', []);
    const [showDiagonal, setShowDiagonal] = usePlotSetting<boolean>(plotId, 'splomShowDiagonal', false);
    const [showUpperHalf, setShowUpperHalf] = usePlotSetting<boolean>(plotId, 'splomShowUpperHalf', true);

    const d = useCallback((name: string) => getColumnDisplayName(columns, name), [columns]);
    const numericColumns = useMemo(
        () => sortColumnsByPriority(filteredColumns.filter(c => c && NUMERIC.has(c.type))),
        [filteredColumns],
    );
    const allNumericColumns = useMemo(
        () => sortColumnsByPriority(columns.filter(c => c && NUMERIC.has(c.type))),
        [columns],
    );
    const vars = useMemo(() => variables.filter(v => columns.some(c => c.name === v)).slice(0, MAX_VARIABLES), [variables, columns]);

    // Trace data: visible points only; `traceToOriginal[k]` maps trace point k to its dataset row
    const { trace, traceToOriginal } = useMemo(() => {
        if (vars.length < 2) return { trace: null, traceToOriginal: [] as number[] };
        const cols = vars.map(v => getDisplayColumn(v));
        const n = cols[0]?.length ?? 0;
        const styles = getStyleArraysColumnar(n, (name) => getDisplayColumn(name), displayIndices ?? undefined);
        // Visible points, emphasised ones drawn last (on top)
        const keep = getSortedIndices(styles);
        const dimensions = vars.map((v, j) => {
            const col = cols[j];
            const isLog = logColumns.includes(v);
            const values = keep.map(i => {
                const raw = col && isNumericColumn(col) ? col[i] : NaN;
                return Number.isFinite(raw) && (!isLog || raw > 0) ? raw : null;
            });
            return { label: d(v), values };
        });
        return {
            traceToOriginal: keep.map(i => (displayIndices ? displayIndices[i] : i)),
            trace: {
                type: 'splom',
                dimensions,
                showupperhalf: showUpperHalf,
                diagonal: { visible: showDiagonal },
                marker: {
                    color: keep.map(i => applyOpacityToColor(styles.colors[i], styles.opacity[i])),
                    size: keep.map(i => Math.max(2, styles.sizes[i] * 0.6)),
                    symbol: keep.map(i => shapeToPlotlySymbol(styles.shapes[i])),
                    line: { width: 0 },
                },
                selected: { marker: { opacity: 1 } },
                unselected: { marker: { opacity: 0.15 } },
                hoverinfo: 'none',
            } as any,
        };
        // attributeStyleState and analytical are read through getStyleArraysColumnar / getDisplayColumn
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [vars, logColumns, showDiagonal, showUpperHalf, displayIndices, getDisplayColumn, d, attributeStyleState, analytical]);

    // Highlight the global selection (trace-relative indices)
    const selectedPoints = useMemo(() => {
        if (!trace || selectedIndices.length === 0) return undefined;
        const sel = new Set(selectedIndices);
        const out: number[] = [];
        traceToOriginal.forEach((orig, k) => { if (sel.has(orig)) out.push(k); });
        return out;
    }, [trace, traceToOriginal, selectedIndices]);

    const handleSelected = useCallback((event: any) => {
        if (!event?.points) return;
        const picked = new Set<number>();
        for (const p of event.points) {
            const orig = traceToOriginal[p.pointIndex ?? p.pointNumber];
            if (orig !== undefined) picked.add(orig);
        }
        setSelection(Array.from(picked).sort((a, b) => a - b));
    }, [traceToOriginal, setSelection]);

    const handleDeselect = useCallback(() => setSelection([]), [setSelection]);

    const layout = useMemo(() => {
        const l: Record<string, any> = {
            autosize: true,
            // At least the pane height; grows (pane scrolls) for many variables
            height: Math.max(fillHeight, 160 * vars.length),
            margin: { l: 70, r: 20, t: 30, b: 60 },
            dragmode: dragMode,
            hovermode: false,
            showlegend: false,
            uirevision: vars.join('|'),
        };
        vars.forEach((v, j) => {
            const suffix = j === 0 ? '' : String(j + 1);
            const axis = { type: logColumns.includes(v) ? 'log' : 'linear', automargin: true };
            l[`xaxis${suffix}`] = axis;
            l[`yaxis${suffix}`] = axis;
        });
        return l;
    }, [vars, logColumns, dragMode, fillHeight]);

    const toggleLog = (v: string) =>
        setLogColumns(prev => (prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]));

    return (
        <Box sx={{ p: 1 }}>
            <PlotControlBar
                primary={
                    <MultiColumnSelector
                        columns={numericColumns}
                        selectedColumns={vars}
                        onChange={(cols: string[]) => setVariables(cols.slice(0, MAX_VARIABLES))}
                        label={`Variables (2–${MAX_VARIABLES})`}
                        allColumns={allNumericColumns}
                    />
                }
                settingsActive={logColumns.length > 0 || showDiagonal || !showUpperHalf}
                summary={<>
                    {logColumns.filter(v => vars.includes(v)).length > 0 && (
                        <SettingChip label={`Log: ${logColumns.filter(v => vars.includes(v)).map(d).join(', ')}`} onDelete={() => setLogColumns([])} />
                    )}
                </>}
                settings={<>
                    <ControlSection label="Log scale">
                        {vars.length === 0 && <Typography variant="caption" color="text.secondary">Choose variables first</Typography>}
                        {vars.map(v => (
                            <FormControlLabel key={v} control={<Switch size="small" checked={logColumns.includes(v)} onChange={() => toggleLog(v)} />} label={d(v)} />
                        ))}
                    </ControlSection>
                    <ControlSection label="Layout">
                        <FormControlLabel control={<Switch size="small" checked={showDiagonal} onChange={e => setShowDiagonal(e.target.checked)} />} label="Show diagonal panels" />
                        <FormControlLabel control={<Switch size="small" checked={showUpperHalf} onChange={e => setShowUpperHalf(e.target.checked)} />} label="Show upper half" />
                    </ControlSection>
                </>}
            />

            {!trace ? (
                <Typography color="text.secondary">Choose 2 to {MAX_VARIABLES} numeric variables to draw a scatter matrix.</Typography>
            ) : (
                <Paper ref={fillRef} sx={{ p: 2 }}>
                    <ExpandablePlotWrapper>
                        <Plot
                            data={[{ ...trace, selectedpoints: selectedPoints }]}
                            layout={layout}
                            config={getPlotConfig({ filename: `splom_${vars.join('_')}` })}
                            useResizeHandler
                            style={{ width: '100%' }}
                            onSelected={handleSelected}
                            onDeselect={handleDeselect}
                        />
                    </ExpandablePlotWrapper>
                    <Typography variant="caption" color="text.secondary">
                        {traceToOriginal.length.toLocaleString()} samples · drag a box or lasso in any panel to select (linked to all plots)
                    </Typography>
                </Paper>
            )}
        </Box>
    );
};

export default ScatterMatrix;
