import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { NodeLibraryButton } from '../../components/plot_controls/NodeLibraryButton';
import { nodeAxisValues, nodeLabelsOn, nodesById, nodeXYTieTrace, nodeXYTrace, tiePairs } from '../../utils/nodeLibrary';
import Plot from '../../components/ThemedPlot';
import {
    Box, Paper, Typography, FormControl, InputLabel, Select, MenuItem,
    Switch, FormControlLabel, Slider, Checkbox, ToggleButtonGroup, ToggleButton,
    Chip, Button, Tooltip, Stack, Alert, Menu, ListItemIcon, ListItemText,
} from '@mui/material';
import {
    Palette, TextFields, GridOn, ScatterPlot as ScatterIcon, ChangeHistory,
    CheckCircle, Warning, AutoAwesome, PlaylistAdd, ColorLens, Undo, MoreVert, LibraryBooks,
} from '@mui/icons-material';
import { useAppStore, useDisplayRows, getDatasetRows } from '../../store/appStore';
import { usePlotSetting } from '../../hooks/usePlotSetting';
import { useShallow } from 'zustand/react/shallow';
import { useClassificationStore, diagramMatchesId, getDiagramV3 } from '../../store/classificationStore';
import { resolveDiagram, computeAxisValues, DiagramResolution } from '../../utils/classificationAxisResolver';
import { getPlotConfig } from '../../utils/plotConfig';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';
import { PlotControlBar, ControlSection, SettingChip } from '../../components/plot_controls/PlotControlBar';
import { isCompactPane, usePane } from '../workspace/PaneContext';
import type { AxisKey } from '../../types/diagram';
import { makeFrame } from './classification/diagramGeometry';
import { projectSamples } from './classification/buildDiagramLayer';
import { useDiagramLayer, useDiagramV3 } from './classification/useDiagramLayer';
import { useAttributeStore, createCategoryEntry } from '../../store/attributeStore';
import { DiagramGallery } from './classification/DiagramGallery';
import { classifierFields, classifySamples, fieldPalette } from './classification/classifySamples';
import { getStyleArraysColumnar, shapeToPlotlySymbol, applyOpacityToColor, getSortedIndices, sortColumnsByPriority, getColumnDisplayName } from '../../utils/attributeUtils';
import { buildCustomDataColumnar, buildScatterHoverTemplate, buildCartesianTernaryHoverTemplate, ternaryHoverText } from '../../utils/tooltipUtils';
import { computePointDensities, computeTernaryDensities, DENSITY_JET_POINT_COLORSCALE } from '../../utils/densityGrid';
import { useSelectionHandler } from '../../hooks/useSelectionHandler';
import { useDragMode } from '../../hooks/useDragMode';
import { useFillHeight } from '../../hooks/useFillHeight';
import { useStyleInputs } from '../../hooks/useStyleInputs';

interface ClassificationPlotProps {
    plotId: string;
}

/** Point traces above this size render with WebGL (scattergl). */
const WEBGL_POINT_THRESHOLD = 2000;

/** Computed axis sentinel value */
const COMPUTED_AXIS = '__computed__';

export const ClassificationPlot: React.FC<ClassificationPlotProps> = ({ plotId }) => {
    // Fill the dock pane below the controls (fixed height outside the workspace)
    const { ref: fillRef, height: fillHeight } = useFillHeight<HTMLDivElement>(600, 320, 32);
    const compact = isCompactPane(usePane());
    const dragMode = useDragMode();
    const { columns, geochemMappings } = useAppStore(useShallow(s => ({ columns: s.columns, geochemMappings: s.geochemMappings })));
    const getDisplayColumn = useAppStore(s => s.getDisplayColumn);
    const tooltipMode = useAppStore(s => s.tooltipMode); // hover templates read it from the store
    const { handleSelected, handleDeselect, selectedIndices } = useSelectionHandler();
    const filteredColumns = useAppStore(useShallow(s => s.getFilteredColumns()));
    // Style arrays read the attribute store directly; this object is the memo
    // dependency that tracks it
    const attributeStyleState = useStyleInputs();
    const d = useCallback((name: string) => getColumnDisplayName(columns, name), [columns]);
    const displayData = useDisplayRows();
    const displayIndices = useAppStore(s => s._sampleIndicesArray);
    const { diagrams, renderOptions, setRenderOptions } = useClassificationStore(useShallow(s => ({
        diagrams: s.diagrams, renderOptions: s.renderOptions, setRenderOptions: s.setRenderOptions,
    })));
    const plotSettings = useAppStore(s => s.plots.find(p => p.id === plotId)?.settings);
    const previousPlot = plotSettings?.previousPlot as { type: string; settings: Record<string, unknown> } | undefined;

    // The diagram is a per-plot setting (.chem v5)
    const [diagramId, setDiagramId] = usePlotSetting<string | null>(plotId, 'diagramId', null);
    // User mapping for inputs the dataset doesn't name (Free diagrams, odd headers)
    const [columnOverrides, setColumnOverrides] = usePlotSetting<Record<string, string>>(plotId, 'diagramColumnOverrides', {});

    // Axis mappings
    const [axisA, setAxisA] = usePlotSetting<string>(plotId, 'axisA', '');
    const [axisB, setAxisB] = usePlotSetting<string>(plotId, 'axisB', '');
    const [axisC, setAxisC] = usePlotSetting<string>(plotId, 'axisC', '');
    const [axisX, setAxisX] = usePlotSetting<string>(plotId, 'axisX', '');
    const [axisY, setAxisY] = usePlotSetting<string>(plotId, 'axisY', '');

    // Density state
    const [showDensity, setShowDensity] = usePlotSetting<boolean>(plotId, 'showDensity', false);
    const [densitySmoothing, setDensitySmoothing] = usePlotSetting<number>(plotId, 'densitySmoothing', 2.0);
    const [densityOpacity, setDensityOpacity] = usePlotSetting<number>(plotId, 'densityOpacity', 0.7);
    const [densitySqrtNorm, setDensitySqrtNorm] = usePlotSetting<boolean>(plotId, 'densitySqrtNorm', false);
    const [nodeIds, setNodeIds] = usePlotSetting<string[]>(plotId, 'nodes', []);

    const [galleryOpen, setGalleryOpen] = useState(false);
    const [actionsAnchor, setActionsAnchor] = useState<HTMLElement | null>(null);
    const [actionMsg, setActionMsg] = useState<string | null>(null);

    const selectedDiagram = useMemo(
        () => diagrams.find(dg => diagramMatchesId(dg, diagramId)) || null,
        [diagrams, diagramId]
    );

    const handleSelectDiagram = (id: string) => {
        // built-ins (Piper) are native plot types
        const builtin = getDiagramV3(id);
        if (builtin?.kind === 'builtin' && builtin.builtin === 'piper') {
            useAppStore.getState().replacePlot(plotId, { type: 'piper', settings: {} });
            return;
        }
        setDiagramId(id);
    };

    const numericColumns = useMemo(() =>
        sortColumnsByPriority(
            filteredColumns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))
        ),
        [filteredColumns]
    );

    const allNumericColumns = useMemo(() =>
        sortColumnsByPriority(
            columns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))
        ),
        [columns]
    );

    // Numeric column names for resolution
    const numericColumnNames = useMemo(() => numericColumns.map(c => c.name), [numericColumns]);

    // Resolve diagram variables to data columns
    const diagramResolution = useMemo<DiagramResolution | null>(() => {
        if (!selectedDiagram || geochemMappings.length === 0) return null;
        return resolveDiagram(selectedDiagram, geochemMappings, numericColumnNames, columnOverrides);
    }, [selectedDiagram, geochemMappings, numericColumnNames, columnOverrides]);

    // Compute values for compound formula axes
    const computedValues = useMemo<Record<string, (number | null)[]>>(() => {
        if (!diagramResolution || !displayData.length) return {};
        const result: Record<string, (number | null)[]> = {};
        for (const [key, axis] of Object.entries(diagramResolution.axes)) {
            if (axis.isComputed && axis.isFullyResolved) {
                result[key] = computeAxisValues(axis, displayData);
            }
        }
        return result;
    }, [diagramResolution, displayData]);

    // Auto-populate axis selectors when diagram changes
    useEffect(() => {
        if (!selectedDiagram || !diagramResolution) return;

        const setters: Record<string, (v: string) => void> = {
            a: setAxisA, b: setAxisB, c: setAxisC,
            x: setAxisX, y: setAxisY,
        };

        for (const [key, axis] of Object.entries(diagramResolution.axes)) {
            const setter = setters[key];
            if (!setter) continue;

            if (axis.singleColumn) {
                // Single variable axis: auto-set to resolved column
                setter(axis.singleColumn);
            } else if (axis.isComputed && axis.isFullyResolved) {
                // Compound formula axis: set to computed sentinel
                setter(COMPUTED_AXIS);
            }
        }
    }, [selectedDiagram, diagramResolution, setAxisA, setAxisB, setAxisC, setAxisX, setAxisY]);

    // Axis selections (persisted by usePlotSetting)
    const handleAxisChange = useCallback((axis: string, value: string) => {
        switch (axis) {
            case 'a': setAxisA(value); break;
            case 'b': setAxisB(value); break;
            case 'c': setAxisC(value); break;
            case 'x': setAxisX(value); break;
            case 'y': setAxisY(value); break;
        }
    }, [setAxisA, setAxisB, setAxisC, setAxisX, setAxisY]);

    // ---------------------------------------------------------------------
    // Figure: diagram layer (fills below the data, boundaries/labels above)
    // ---------------------------------------------------------------------
    const v3 = useDiagramV3(selectedDiagram);
    const isTernary = selectedDiagram?.type === 'ternary';
    const axisKeys: AxisKey[] = isTernary ? ['a', 'b', 'c'] : ['x', 'y'];
    const axisValue: Record<AxisKey, string> = { a: axisA, b: axisB, c: axisC, x: axisX, y: axisY };

    // Sample values per axis (computed formula or a chosen column)
    const sampleValue = useCallback((axis: AxisKey, i: number): number | null => {
        const sel = axisValue[axis];
        if (!sel) return null;
        if (sel === COMPUTED_AXIS) return computedValues[axis]?.[i] ?? null;
        const v = Number(displayData[i]?.[sel]);
        return Number.isFinite(v) ? v : null;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [axisA, axisB, axisC, axisX, axisY, computedValues, displayData]);

    const samples = useMemo(() => {
        if (!v3 || !renderOptions.showData || !displayData.length) return null;
        if (axisKeys.some(k => !axisValue[k])) return null;
        void attributeStyleState; // style arrays read the attribute store
        const styleArrays = getStyleArraysColumnar(displayData.length, (name) => getDisplayColumn(name), displayIndices ?? undefined);
        const order = getSortedIndices(styleArrays);
        const frame = makeFrame(v3);
        return { styleArrays, frame, ...projectSamples(frame, sampleValue, order) };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [v3, renderOptions.showData, displayData, displayIndices, sampleValue, getDisplayColumn, attributeStyleState, axisA, axisB, axisC, axisX, axisY]);

    // XY diagrams without bounds grow to include the samples. With many samples
    // the extent is the 0.5-99.5 percentile range, so a few wild ratios (e.g.
    // Na/Al of 12 from a bad Al) do not squash the diagram; zoom out to see them.
    const dataExtent = useMemo(() => {
        if (!samples || isTernary || v3?.bounds || !samples.x.length) return undefined;
        const fx = (v: number) => (samples.frame.logX ? Math.log10(v) : v);
        const fy = (v: number) => (samples.frame.logY ? Math.log10(v) : v);
        const xs = Float64Array.from(samples.x, fx).filter(Number.isFinite).sort();
        const ys = Float64Array.from(samples.y, fy).filter(Number.isFinite).sort();
        if (!xs.length || !ys.length) return undefined;
        const trim = xs.length >= 200 ? 0.005 : 0;
        const at = (a: Float64Array, q: number) => a[Math.min(a.length - 1, Math.max(0, Math.round(q * (a.length - 1))))];
        return { x0: at(xs, trim), x1: at(xs, 1 - trim), y0: at(ys, trim), y1: at(ys, 1 - trim) };
    }, [samples, isTernary, v3]);

    // A user-chosen column replaces the diagram's own axis title
    const axisTitles = useMemo(() => {
        const out: Partial<Record<AxisKey, string>> = {};
        if (!diagramResolution) return out;
        for (const k of axisKeys) {
            const sel = axisValue[k];
            const res = diagramResolution.axes[k];
            if (sel && sel !== COMPUTED_AXIS && res && sel !== res.singleColumn) out[k] = d(sel);
        }
        return out;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [diagramResolution, axisA, axisB, axisC, axisX, axisY, d, isTernary]);

    const layer = useDiagramLayer(v3, {
        style: renderOptions.style,
        fillOpacity: renderOptions.fillOpacity,
        showLabels: renderOptions.showLabels,
        showGrid: renderOptions.showGrid,
        showTitle: true,
        axisTitles,
        dataExtent,
    });

    // Field each displayed sample falls in
    const fields = useMemo(() => (v3 ? classifierFields(v3) : []), [v3]);
    const sampleFields = useMemo(() => {
        if (!v3 || !fields.length || !displayData.length) return null;
        if (axisKeys.some(k => !axisValue[k])) return null;
        return classifySamples(v3, sampleValue, displayData.length, fields);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [v3, fields, sampleValue, displayData.length, axisA, axisB, axisC, axisX, axisY]);

    const plotData = useMemo(() => {
        if (!v3 || !layer) return null;
        if (axisKeys.some(k => !axisValue[k])) return null;
        void tooltipMode; // hover templates read it from the store
        const dataTraces: any[] = [];

        if (samples && samples.x.length) {
            const { styleArrays, idx } = samples;
            const customData = buildCustomDataColumnar((name) => getDisplayColumn(name), idx, displayIndices ?? undefined);

            // Optional point density (computed in diagram space)
            let density: number[] | null = null;
            if (showDensity && idx.length >= 10) {
                if (isTernary && samples.abc) {
                    density = computeTernaryDensities(
                        samples.abc.map(p => p[0]), samples.abc.map(p => p[1]), samples.abc.map(p => p[2]),
                        { smoothingSigma: densitySmoothing, sqrtNorm: densitySqrtNorm },
                    )?.densities ?? null;
                } else {
                    const fx = (v: number) => (samples.frame.logX ? Math.log10(v) : v);
                    const fy = (v: number) => (samples.frame.logY ? Math.log10(v) : v);
                    density = computePointDensities(samples.x.map(fx), samples.y.map(fy), { smoothingSigma: densitySmoothing, sqrtNorm: densitySqrtNorm })?.densities ?? null;
                }
            }
            let order = idx.map((_, k) => k);
            if (density) order = order.sort((p, q) => density![p] - density![q]);

            const selSet = selectedIndices.length ? new Set(selectedIndices) : null;
            const orig = (i: number) => (displayIndices ? displayIndices[i] : i);
            const line = selSet
                ? {
                    width: order.map(k => (selSet.has(orig(idx[k])) ? 2.5 : 0.5)),
                    color: order.map(k => (selSet.has(orig(idx[k])) ? '#000000' : 'white')),
                }
                : { width: 0.5, color: 'white' };

            const names = (k: AxisKey) => axisTitles[k] ?? v3.axes[k]?.name ?? d(axisValue[k]);
            const trace: any = {
                type: !isTernary && order.length > WEBGL_POINT_THRESHOLD ? 'scattergl' : 'scatter',
                mode: 'markers',
                x: order.map(k => samples.x[k]),
                y: order.map(k => samples.y[k]),
                customdata: order.map(k => customData[k]),
                name: 'Data',
                showlegend: false,
                cliponaxis: true,
                marker: {
                    size: order.map(k => styleArrays.sizes[idx[k]]),
                    symbol: order.map(k => shapeToPlotlySymbol(styleArrays.shapes[idx[k]])),
                    line,
                    ...(density
                        ? { color: order.map(k => density![k]), colorscale: DENSITY_JET_POINT_COLORSCALE, showscale: false, opacity: densityOpacity }
                        : { color: order.map(k => applyOpacityToColor(styleArrays.colors[idx[k]], styleArrays.opacity[idx[k]])) }),
                },
            };
            const fieldOf = (k: number) => sampleFields?.[idx[k]] ?? 'outside all fields';
            if (isTernary && samples.abc) {
                const n: [string, string, string] = [names('a'), names('b'), names('c')];
                trace.text = order.map(k => `${ternaryHoverText(n, samples.abc![k])}<br><b>Field:</b> ${fieldOf(k)}`);
                trace.hovertemplate = buildCartesianTernaryHoverTemplate();
            } else {
                trace.text = order.map(fieldOf);
                trace.hovertemplate = buildScatterHoverTemplate(names('x'), names('y')).replace('<extra>', '<br><b>Field:</b> %{text}<extra>');
            }
            dataTraces.push(trace);
        }

        // Library nodes, placed through the diagram's own axis formulas
        const nodes = nodesById(nodeIds);
        if (nodes.length && selectedDiagram) {
            const vals = nodeAxisValues(selectedDiagram, nodes);
            const p = projectSamples(makeFrame(v3), (axis, k) => vals[axis]?.[k] ?? null, nodes.map((_, k) => k));
            const picked = p.idx.map(k => nodes[k]);
            const tie = nodeXYTieTrace(picked, p.x, p.y, tiePairs(nodeIds));
            if (tie) dataTraces.push(tie);
            const t = nodeXYTrace(picked, p.x, p.y, { labels: nodeLabelsOn(nodeIds) });
            if (t) {
                if (isTernary && p.abc) t.hovertemplate = '%{hovertext}<extra>node</extra>';
                dataTraces.push(t);
            }
        }

        const layout: any = {
            ...layer.layout,
            annotations: layer.annotations,
            autosize: true,
            height: isTernary ? 640 : 560,
            dragmode: dragMode,
            selectdirection: 'any',
        };
        return { traces: [...layer.background, ...dataTraces, ...layer.foreground], layout };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [v3, layer, samples, axisA, axisB, axisC, axisX, axisY, axisTitles, isTernary, displayIndices, selectedIndices,
        showDensity, densitySmoothing, densityOpacity, densitySqrtNorm, getDisplayColumn, d, tooltipMode, sampleFields, nodeIds, selectedDiagram]);
    // Pane-filling height (the diagram's own height outside the workspace)
    const filledLayout = useMemo(() => (plotData ? { ...plotData.layout, height: fillHeight } : undefined), [plotData, fillHeight]);


    // ---------------------------------------------------------------------
    // Actions: classification column, colour by field, restore previous plot
    // ---------------------------------------------------------------------
    /** Field per row of the FULL dataset (the display may be a sample). */
    const classifyAllRows = useCallback((): (string | null)[] | null => {
        if (!v3 || !diagramResolution) return null;
        const rows = getDatasetRows();
        const values: Partial<Record<AxisKey, (number | null)[]>> = {};
        for (const k of axisKeys) {
            const sel = axisValue[k];
            if (!sel) return null;
            const res = diagramResolution.axes[k];
            if (sel === COMPUTED_AXIS) {
                if (!res?.isComputed || !res.isFullyResolved) return null;
                values[k] = computeAxisValues(res, rows);
            } else {
                values[k] = rows.map(r => { const v = Number(r[sel]); return Number.isFinite(v) ? v : null; });
            }
        }
        return classifySamples(v3, (k, i) => values[k]?.[i] ?? null, rows.length, fields);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [v3, diagramResolution, fields, axisA, axisB, axisC, axisX, axisY]);

    const classificationColumnName = useCallback((): string => {
        const base = `${(v3?.name ?? 'Diagram').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)}_field`;
        const names = new Set(useAppStore.getState().columns.map(c => c.name));
        let name = base;
        for (let k = 2; names.has(name); k++) name = `${base}_${k}`;
        return name;
    }, [v3]);

    const addClassificationColumn = useCallback((): string | null => {
        const fieldsPerRow = classifyAllRows();
        if (!fieldsPerRow) { setActionMsg('Set all axes before classifying.'); return null; }
        const name = classificationColumnName();
        useAppStore.getState().addColumn(name, fieldsPerRow.map(f => f ?? 'Unclassified'), 'categorical', 'Classification');
        const n = fieldsPerRow.filter(Boolean).length;
        setActionMsg(`Added column "${name}": ${n.toLocaleString()} of ${fieldsPerRow.length.toLocaleString()} rows fall in a field.`);
        return name;
    }, [classifyAllRows, classificationColumnName]);

    const colourByField = useCallback(() => {
        if (!v3) return;
        const col = addClassificationColumn();
        if (!col) return;
        const attr = useAttributeStore.getState();
        const values = (useAppStore.getState().getColumn?.(col) ?? []) as unknown[];
        const counts = new Map<string, number>();
        for (const v of values) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
        const palette = fieldPalette(v3).filter(p => counts.has(p.name));
        const defaultEntry = attr.color.entries.find(e => e.isDefault);
        const entries = [
            ...(defaultEntry ? [defaultEntry] : []),
            ...palette.map((p, i) => {
                const e = createCategoryEntry(p.name, i, darken(p.color));
                e.rowCount = e.visibleRowCount = counts.get(p.name) ?? 0;
                return e;
            }),
            ...(counts.has('Unclassified') ? [(() => {
                const e = createCategoryEntry('Unclassified', palette.length, '#9e9e9e');
                e.rowCount = e.visibleRowCount = counts.get('Unclassified') ?? 0;
                return e;
            })()] : []),
        ];
        attr.setField('color', col);
        attr.setMethod('color', 'categorical');
        attr.setEntries('color', entries);
    }, [v3, addClassificationColumn]);

    const restorePreviousPlot = useCallback(() => {
        if (!previousPlot) return;
        useAppStore.getState().replacePlot(plotId, { type: previousPlot.type as any, settings: previousPlot.settings });
    }, [plotId, previousPlot]);

    // Inputs the dataset doesn't provide: variables of computed axes, or the
    // axis name itself for single-column/free axes
    const unresolvedInputs = useMemo(() => {
        if (!diagramResolution) return [] as string[];
        const out = new Set<string>();
        for (const k of axisKeys) {
            const res = diagramResolution.axes[k];
            if (!res) continue;
            if (res.variables.length === 0 && !res.singleColumn) out.add(res.axisName);
            for (const v of res.variables) if (v.status === 'missing') out.add(v.element);
        }
        return [...out];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [diagramResolution, isTernary]);

    // Helper to build resolution status tooltip
    const getResolutionTooltip = (axisKey: string): string => {
        const axis = diagramResolution?.axes[axisKey];
        if (!axis || axis.variables.length === 0) return '';
        const lines: string[] = [];
        if (axis.formula) lines.push(`Formula: ${axis.formula}`);
        for (const v of axis.variables) {
            const col = v.resolvedColumn ?? '(missing)';
            const status = v.status === 'matched' ? 'direct' : v.status === 'converted' ? v.conversionDescription || 'converted' : 'not found';
            lines.push(`${v.element}: ${col} [${status}]`);
        }
        return lines.join('\n');
    };

    // Render axis selector with resolution indicator
    const renderAxisSelector = (axisKey: string, label: string, value: string) => {
        const axis = diagramResolution?.axes[axisKey];
        const hasComputed = axis?.isComputed && axis?.isFullyResolved;

        return (
            <Box sx={{ minWidth: 180 }}>
                {axis && axis.variables.length > 0 && (
                    <Tooltip title={getResolutionTooltip(axisKey)} placement="top" arrow>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                            {value === COMPUTED_AXIS ? (
                                <>
                                    <AutoAwesome sx={{ fontSize: 14, color: 'success.main' }} />
                                    <Typography variant="caption" color="success.main">
                                        Computed: {axis.formula}
                                    </Typography>
                                </>
                            ) : axis.singleColumn ? (
                                <>
                                    <CheckCircle sx={{ fontSize: 14, color: 'success.main' }} />
                                    <Typography variant="caption" color="success.main">
                                        Auto-matched
                                    </Typography>
                                </>
                            ) : axis.variables.some(v => v.status === 'missing') ? (
                                <>
                                    <Warning sx={{ fontSize: 14, color: 'warning.main' }} />
                                    <Typography variant="caption" color="warning.main">
                                        {axis.variables.filter(v => v.status === 'missing').length} variable{axis.variables.filter(v => v.status === 'missing').length > 1 ? 's' : ''} missing
                                    </Typography>
                                </>
                            ) : null}
                            {axis.variables.some(v => v.status === 'converted') && (
                                <Chip
                                    size="small"
                                    label="converted"
                                    sx={{ height: 16, fontSize: '0.6rem', ml: 0.5, bgcolor: 'warning.light', color: 'warning.contrastText' }}
                                />
                            )}
                        </Box>
                    </Tooltip>
                )}
                <FormControl size="small" fullWidth>
                    <InputLabel>{label}</InputLabel>
                    <Select
                        value={value}
                        label={label}
                        onChange={(e) => handleAxisChange(axisKey, e.target.value)}
                    >
                        <MenuItem value="">None</MenuItem>
                        {hasComputed && (
                            <MenuItem value={COMPUTED_AXIS}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <AutoAwesome sx={{ fontSize: 16, color: 'primary.main' }} />
                                    <Typography variant="body2">Computed: {axis?.formula}</Typography>
                                </Box>
                            </MenuItem>
                        )}
                        {(value && value !== COMPUTED_AXIS && !numericColumns.find(c => c.name === value) ? [...numericColumns, ...allNumericColumns.filter(c => c.name === value)] : numericColumns).map(c => (
                            <MenuItem key={c.name} value={c.name}>{c.alias || c.name}</MenuItem>
                        ))}
                    </Select>
                </FormControl>
            </Box>
        );
    };

    return (
        <Box sx={{ p: 1 }}>
            {/* Diagram header */}
            <Paper sx={{ px: 1.5, py: compact ? 0.25 : 1, mb: compact ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: compact ? 'nowrap' : 'wrap' }}>
                {!compact && (selectedDiagram?.type === 'ternary' ? <ChangeHistory color="action" /> : <ScatterIcon color="action" />)}
                <Box sx={{ flex: 1, minWidth: compact ? 0 : 200 }}>
                    <Typography variant={compact ? 'body2' : 'subtitle1'} fontWeight={600} lineHeight={1.3} noWrap={compact}>
                        {selectedDiagram ? selectedDiagram.name : 'No diagram selected'}
                    </Typography>
                    {selectedDiagram && !compact && (
                        <Typography variant="caption" color="text.secondary">
                            {[selectedDiagram.category, selectedDiagram.subCategory].filter(Boolean).join(' › ')}
                        </Typography>
                    )}
                </Box>
                <Button variant={selectedDiagram ? 'outlined' : 'contained'} size="small" startIcon={<LibraryBooks />} onClick={() => setGalleryOpen(true)}>
                    {selectedDiagram ? 'Change diagram' : 'Choose diagram'}
                </Button>
                {selectedDiagram && (
                    <>
                        <Button size="small" endIcon={<MoreVert />} onClick={(e) => setActionsAnchor(e.currentTarget)}>Classify</Button>
                        <Menu anchorEl={actionsAnchor} open={!!actionsAnchor} onClose={() => setActionsAnchor(null)}>
                            <MenuItem onClick={() => { setActionsAnchor(null); addClassificationColumn(); }}>
                                <ListItemIcon><PlaylistAdd fontSize="small" /></ListItemIcon>
                                <ListItemText primary="Add classification column" secondary="Field name per row (undoable)" />
                            </MenuItem>
                            <MenuItem onClick={() => { setActionsAnchor(null); colourByField(); }}>
                                <ListItemIcon><ColorLens fontSize="small" /></ListItemIcon>
                                <ListItemText primary="Colour rows by field" secondary="Adds the column and colours by it" />
                            </MenuItem>
                        </Menu>
                    </>
                )}
                {previousPlot && (
                    <Tooltip title={`Remove the diagram and go back to the ${previousPlot.type} plot`}>
                        <Button size="small" color="inherit" startIcon={<Undo />} onClick={restorePreviousPlot}>Clear diagram</Button>
                    </Tooltip>
                )}
            </Paper>
            <DiagramGallery
                open={galleryOpen}
                onClose={() => setGalleryOpen(false)}
                onSelect={handleSelectDiagram}
                selectedId={selectedDiagram?.id ?? null}
            />
            {actionMsg && <Alert severity="success" onClose={() => setActionMsg(null)} sx={{ mb: 1 }}>{actionMsg}</Alert>}
            {selectedDiagram && unresolvedInputs.length > 0 && numericColumns.length > 0 && (
                <Alert severity="warning" sx={{ mb: 1, '& .MuiAlert-message': { width: '100%' } }}>
                    <Typography variant="body2" sx={{ mb: 1 }}>
                        This dataset has no column for {unresolvedInputs.length === 1 ? 'one input' : `${unresolvedInputs.length} inputs`}. Map {unresolvedInputs.length === 1 ? 'it' : 'them'} to columns:
                    </Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        {unresolvedInputs.map(name => (
                            <FormControl key={name} size="small" sx={{ minWidth: 170 }}>
                                <InputLabel>{name}</InputLabel>
                                <Select
                                    label={name}
                                    value={columnOverrides[name] ?? ''}
                                    onChange={(e) => setColumnOverrides(prev => {
                                        const next = { ...prev };
                                        if (e.target.value) next[name] = e.target.value as string; else delete next[name];
                                        return next;
                                    })}
                                >
                                    <MenuItem value=""><em>Not mapped</em></MenuItem>
                                    {numericColumns.map(c => <MenuItem key={c.name} value={c.name}>{c.alias || c.name}</MenuItem>)}
                                </Select>
                            </FormControl>
                        ))}
                    </Stack>
                </Alert>
            )}

            {/* Axis mapping + render options */}
            {selectedDiagram && (
                <PlotControlBar
                    primary={<>
                        {selectedDiagram.type === 'ternary' ? (
                            <>
                                {renderAxisSelector('a', selectedDiagram.axes.a?.name || 'A (Top)', axisA)}
                                {renderAxisSelector('b', selectedDiagram.axes.b?.name || 'B (Left)', axisB)}
                                {renderAxisSelector('c', selectedDiagram.axes.c?.name || 'C (Right)', axisC)}
                            </>
                        ) : (
                            <>
                                {renderAxisSelector('x', selectedDiagram.axes.x?.name || 'X Axis', axisX)}
                                {renderAxisSelector('y', selectedDiagram.axes.y?.name || 'Y Axis', axisY)}
                            </>
                        )}
                        <NodeLibraryButton value={nodeIds} onChange={setNodeIds} />
                        {diagramResolution && diagramResolution.totalVariables > 0 && (
                            <Chip
                                size="small"
                                label={`${diagramResolution.matchedCount}/${diagramResolution.totalVariables} matched`}
                                color={diagramResolution.matchedCount === diagramResolution.totalVariables ? 'success' : 'warning'}
                                sx={{ height: 20, fontSize: '0.7rem' }}
                            />
                        )}
                    </>}
                    settingsActive={
                        renderOptions.style !== 'color' || !renderOptions.showLabels ||
                        !renderOptions.showGrid || !renderOptions.showData || showDensity
                    }
                    summary={<>
                        {renderOptions.style === 'bw' && <SettingChip label="B&W" onDelete={() => setRenderOptions({ style: 'color' })} />}
                        {!renderOptions.showLabels && <SettingChip label="No labels" onDelete={() => setRenderOptions({ showLabels: true })} />}
                        {!renderOptions.showGrid && <SettingChip label="No grid" onDelete={() => setRenderOptions({ showGrid: true })} />}
                        {!renderOptions.showData && <SettingChip label="Data hidden" onDelete={() => setRenderOptions({ showData: true })} />}
                        {showDensity && <SettingChip label="Density" onDelete={() => setShowDensity(false)} />}
                    </>}
                    settings={<>
                        <ControlSection label="Style">
                            <ToggleButtonGroup
                                value={renderOptions.style}
                                exclusive
                                onChange={(_, v) => v && setRenderOptions({ style: v })}
                                size="small"
                            >
                                <ToggleButton value="color"><Palette fontSize="small" sx={{ mr: 0.5 }} />Color</ToggleButton>
                                <ToggleButton value="bw">B&W</ToggleButton>
                            </ToggleButtonGroup>
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={renderOptions.showLabels}
                                        onChange={(e) => setRenderOptions({ showLabels: e.target.checked })}
                                        size="small"
                                    />
                                }
                                label={<Typography variant="body2"><TextFields fontSize="small" sx={{ verticalAlign: 'middle', mr: 0.5 }} />Labels</Typography>}
                            />
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={renderOptions.showGrid}
                                        onChange={(e) => setRenderOptions({ showGrid: e.target.checked })}
                                        size="small"
                                    />
                                }
                                label={<Typography variant="body2"><GridOn fontSize="small" sx={{ verticalAlign: 'middle', mr: 0.5 }} />Grid</Typography>}
                            />
                        </ControlSection>

                        <ControlSection label="Data">
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={renderOptions.showData}
                                        onChange={(e) => setRenderOptions({ showData: e.target.checked })}
                                        size="small"
                                    />
                                }
                                label={<Typography variant="body2">Show Data</Typography>}
                            />
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={showDensity}
                                        onChange={(e) => setShowDensity(e.target.checked)}
                                        size="small"
                                    />
                                }
                                label={<Typography variant="body2">Density</Typography>}
                            />
                            {showDensity && (
                                <Box sx={{ ml: 3.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                    <Typography variant="caption">Smoothing: {densitySmoothing.toFixed(1)}</Typography>
                                    <Slider
                                        value={densitySmoothing}
                                        onChange={(_, v) => setDensitySmoothing(v as number)}
                                        min={0.5} max={8} step={0.5}
                                        size="small"
                                    />
                                    <Typography variant="caption">Opacity: {Math.round(densityOpacity * 100)}%</Typography>
                                    <Slider
                                        value={densityOpacity}
                                        onChange={(_, v) => setDensityOpacity(v as number)}
                                        min={0} max={1} step={0.05}
                                        size="small"
                                    />
                                    <Tooltip title="Spread color gradient across medium-density regions">
                                        <FormControlLabel
                                            control={<Checkbox checked={densitySqrtNorm} onChange={(e) => setDensitySqrtNorm(e.target.checked)} size="small" />}
                                            label={<Typography variant="body2">Sqrt Scale</Typography>}
                                        />
                                    </Tooltip>
                                </Box>
                            )}
                        </ControlSection>
                    </>}
                />
            )}

            {/* Plot */}
            {plotData ? (
                <Paper ref={fillRef} sx={{ p: 1 }}>
                    <ExpandablePlotWrapper>
                        <Plot
                            data={plotData.traces}
                            layout={filledLayout}
                            config={getPlotConfig({ filename: `classification_${selectedDiagram?.name?.replace(/\s+/g, '_') || 'diagram'}` })}
                            style={{ width: '100%' }}
                            onSelected={handleSelected}
                            onDeselect={handleDeselect}
                        />
                    </ExpandablePlotWrapper>
                </Paper>
            ) : (
                <Paper sx={{ p: 4, textAlign: 'center' }}>
                    <Typography color="text.secondary">
                        {!selectedDiagram
                            ? 'Choose a diagram from the library to start'
                            : selectedDiagram.type === 'ternary'
                                ? 'Select columns for A, B, and C axes'
                                : 'Select columns for X and Y axes'}
                    </Typography>
                </Paper>
            )}
        </Box>
    );
};

/** Fill colours are pastel; points need more contrast. */
function darken(rgb: string): string {
    const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(rgb);
    if (!m) return rgb;
    const f = (v: string) => Math.round(Number(v) * 0.72).toString(16).padStart(2, '0');
    return `#${f(m[1])}${f(m[2])}${f(m[3])}`;
}
