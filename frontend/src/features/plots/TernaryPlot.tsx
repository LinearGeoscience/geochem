import React, { useEffect, useRef, useCallback, useMemo } from 'react';
import { NodeLibraryButton } from '../../components/plot_controls/NodeLibraryButton';
import { nodeColumnValues, nodeLabelsOn, nodesById, nodeTernaryTieTrace, nodeTernaryTrace, tiePairs } from '../../utils/nodeLibrary';
import Plot from '../../components/ThemedPlot';
import { useAppStore, useDatasetRows, useDisplayRows } from '../../store/appStore';
import { usePlotSetting } from '../../hooks/usePlotSetting';
import { useShallow } from 'zustand/react/shallow';
import { Box, Paper, Typography, Checkbox, FormControlLabel, Slider, Tooltip } from '@mui/material';
import { getStyleArraysColumnar, shapeToPlotlySymbol, applyOpacityToColor, getSortedIndices, getColumnDisplayName } from '../../utils/attributeUtils';
import { buildCustomDataColumnar, buildTernaryHoverTemplate } from '../../utils/tooltipUtils';
import { getPlotConfig, EXPORT_FONT_SIZES } from '../../utils/plotConfig';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';
import { computeTernaryDensities, DENSITY_JET_POINT_COLORSCALE } from '../../utils/densityGrid';
import { PlotControlBar, ControlSection, SettingChip } from '../../components/plot_controls/PlotControlBar';
import { ApplyDiagramButton } from './classification/ApplyDiagram';
import { useSelectionHandler } from '../../hooks/useSelectionHandler';
import { useHoveredClassRows, HOVER_RING_COLOR } from '../../hooks/useHoveredClassRows';
import { SELECTION_COLOR } from '../../utils/selectionHelpers';
import { ColumnPicker } from '../../components/ColumnPicker';
import { suggestPlotSettings } from '../../utils/plotDefaults';
import { useDragMode } from '../../hooks/useDragMode';
import { useFillHeight } from '../../hooks/useFillHeight';
import { useStyleInputs } from '../../hooks/useStyleInputs';

interface TernaryRanges {
    aRange?: [number, number];
    bRange?: [number, number];
    cRange?: [number, number];
}

interface TernaryPlotProps {
    plotId: string;
}

/** ternary axes: ticks every 10 % labelled 10..90, light grid */
const PERCENT_TICKS = {
    tickmode: 'array' as const,
    tickvals: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
    ticktext: ['10', '20', '30', '40', '50', '60', '70', '80', '90'],
    showgrid: true,
    gridcolor: 'rgba(0,0,0,0.18)',
};

export const TernaryPlot: React.FC<TernaryPlotProps> = ({ plotId }) => {
    // Fill the dock pane below the controls (fixed height outside the workspace)
    const { ref: fillRef, height: fillHeight } = useFillHeight<HTMLDivElement>(600, 320, 48);
    const dragMode = useDragMode();
    const { columns, lockAxes } = useAppStore(useShallow(s => ({ columns: s.columns, lockAxes: s.lockAxes })));
    const data = useDatasetRows();
    const getDisplayColumn = useAppStore(s => s.getDisplayColumn);
    const tooltipMode = useAppStore(s => s.tooltipMode); // hover templates read it from the store
    const d = useCallback((name: string) => getColumnDisplayName(columns, name), [columns]);
    // Style arrays read the attribute store directly; this object is the
    // memo dependency that tracks it
    const attributeStyleState = useStyleInputs();

    const displayData = useDisplayRows();
    const displayIndices = useAppStore(s => s._sampleIndicesArray);
    const { handleSelected, handleClick, handleDeselect, selectedIndices } = useSelectionHandler();
    const hoveredRows = useHoveredClassRows();

    const [aAxis, setAAxis] = usePlotSetting<string>(plotId, 'aAxis', '');
    const [bAxis, setBAxis] = usePlotSetting<string>(plotId, 'bAxis', '');
    const [cAxis, setCAxis] = usePlotSetting<string>(plotId, 'cAxis', '');
    const [showDensity, setShowDensity] = usePlotSetting<boolean>(plotId, 'showDensity', false);
    const [densitySmoothing, setDensitySmoothing] = usePlotSetting<number>(plotId, 'densitySmoothing', 2.0);
    const [densityOpacity, setDensityOpacity] = usePlotSetting<number>(plotId, 'densityOpacity', 0.7);
    const [densitySqrtNorm, setDensitySqrtNorm] = usePlotSetting<boolean>(plotId, 'densitySqrtNorm', false);
    const [nodeIds, setNodeIds] = usePlotSetting<string[]>(plotId, 'nodes', []);
    const geochemMappings = useAppStore(s => s.geochemMappings);
    const nodeTrace = useMemo(() => {
        const nodes = nodesById(nodeIds);
        if (!nodes.length || !aAxis || !bAxis || !cAxis) return null;
        const v = nodeColumnValues([aAxis, bAxis, cAxis], geochemMappings, nodes);
        const tie = nodeTernaryTieTrace(nodes, v[aAxis], v[bAxis], v[cAxis], tiePairs(nodeIds));
        const pts = nodeTernaryTrace(nodes, v[aAxis], v[bAxis], v[cAxis], { labels: nodeLabelsOn(nodeIds) });
        return [tie, pts].filter(Boolean);
    }, [nodeIds, aAxis, bAxis, cAxis, geochemMappings]);

    const rangesRef = useRef<TernaryRanges>({});

    const handleRelayout = useCallback((event: any) => {
        // Capture ternary axis changes
        if (event['ternary.aaxis.min'] !== undefined) {
            rangesRef.current = {
                aRange: [event['ternary.aaxis.min'], event['ternary.aaxis.max'] ?? 1],
                bRange: [event['ternary.baxis.min'] ?? 0, event['ternary.baxis.max'] ?? 1],
                cRange: [event['ternary.caxis.min'] ?? 0, event['ternary.caxis.max'] ?? 1],
            };
        }
    }, []);


    useEffect(() => {
        if (columns.length > 0 && !aAxis && !bAxis && !cAxis) {
            const s = suggestPlotSettings('ternary', columns, useAppStore.getState().geochemMappings);
            if (s.aAxis) { setAAxis(s.aAxis); setBAxis(s.bAxis); setCAxis(s.cAxis); }
        }
    }, [columns, aAxis, bAxis, cAxis, setAAxis, setBAxis, setCAxis]);

    // Render control bar (also used in the early return case)
    const controlBar = (
        <PlotControlBar
            primary={<>
                <ColumnPicker label="A-Axis (Top)" value={aAxis} onChange={setAAxis} minWidth={170} />
                <ColumnPicker label="B-Axis (Bottom Left)" value={bAxis} onChange={setBAxis} minWidth={170} />
                <ColumnPicker label="C-Axis (Bottom Right)" value={cAxis} onChange={setCAxis} minWidth={170} />
                <NodeLibraryButton value={nodeIds} onChange={setNodeIds} />
            </>}
            settingsActive={showDensity}
            summary={<>
                {showDensity && <SettingChip label="Density" onDelete={() => setShowDensity(false)} />}
            </>}
            settings={<>
                <ControlSection label="Overlays">
                    <ApplyDiagramButton plotId={plotId} kind="ternary" />
                    <FormControlLabel
                        control={<Checkbox checked={showDensity} onChange={(e) => setShowDensity(e.target.checked)} size="small" />}
                        label={<Typography variant="body2">Density Colors</Typography>}
                    />
                    {showDensity && (
                        <Box sx={{ ml: 3.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                            <Typography variant="caption" color="text.secondary">
                                Smoothing: {densitySmoothing.toFixed(1)}
                            </Typography>
                            <Slider
                                value={densitySmoothing}
                                onChange={(_, value) => setDensitySmoothing(value as number)}
                                min={0.5}
                                max={8}
                                step={0.5}
                                valueLabelDisplay="auto"
                                size="small"
                            />
                            <Typography variant="caption" color="text.secondary">
                                Opacity: {Math.round(densityOpacity * 100)}%
                            </Typography>
                            <Slider
                                value={densityOpacity}
                                onChange={(_, value) => setDensityOpacity(value as number)}
                                min={0}
                                max={1}
                                step={0.05}
                                valueLabelDisplay="auto"
                                valueLabelFormat={(v) => `${Math.round(v * 100)}%`}
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
    );

    const axesReady = data.length > 0 && !!aAxis && !!bAxis && !!cAxis;

    // Memoize style arrays, sorted indices, and normalized data.
    // Must run before the early return below (hooks may not be conditional).
    const { styleArrays, normalizedData, customData } = useMemo(() => {
        void attributeStyleState; void tooltipMode; // read from the stores inside the style/hover builders
        if (!axesReady) {
            return { styleArrays: null as any, sortedIndices: [], normalizedData: [], customData: [] };
        }
        const styleArrays = getStyleArraysColumnar(displayData.length, (name) => getDisplayColumn(name), displayIndices ?? undefined);

        const sortedIndices = getSortedIndices(styleArrays);

        const aCol = getDisplayColumn(aAxis);
        const bCol = getDisplayColumn(bAxis);
        const cCol = getDisplayColumn(cAxis);

        const normalizedData: { a: number; b: number; c: number; idx: number }[] = [];

        for (const i of sortedIndices) {
            const a = Number(aCol ? aCol[i] : displayData[i][aAxis]) || 0;
            const b = Number(bCol ? bCol[i] : displayData[i][bAxis]) || 0;
            const c = Number(cCol ? cCol[i] : displayData[i][cAxis]) || 0;
            const sum = a + b + c;

            if (sum > 0) {
                normalizedData.push({
                    a: a / sum,
                    b: b / sum,
                    c: c / sum,
                    idx: i
                });
            }
        }

        const ternaryIndices = normalizedData.map(d => d.idx);
        const customData = buildCustomDataColumnar((name) => getDisplayColumn(name), ternaryIndices, displayIndices ?? undefined);

        return { styleArrays, sortedIndices, normalizedData, customData };
    }, [axesReady, displayData, displayIndices, aAxis, bAxis, cAxis, getDisplayColumn, attributeStyleState, tooltipMode]);

    if (!axesReady) {
        return (
            <Box sx={{ p: 2 }}>
                {controlBar}
                <Typography color="text.secondary">Select A, B, and C axes to display ternary plot</Typography>
            </Box>
        );
    }

    // Compute density coloring if enabled
    const densityResult = showDensity ? computeTernaryDensities(
        normalizedData.map(d => d.a),
        normalizedData.map(d => d.b),
        normalizedData.map(d => d.c),
        { smoothingSigma: densitySmoothing, sqrtNorm: densitySqrtNorm }
    ) : null;

    // Prepare trace data, applying density z-ordering if active
    let traceData = normalizedData;
    let traceCustomData = customData;
    let traceDensities = densityResult?.densities ?? null;

    if (traceDensities) {
        const order = traceDensities.map((_, i) => i).sort((a, b) => traceDensities![a] - traceDensities![b]);
        traceData = order.map(i => normalizedData[i]);
        traceCustomData = order.map(i => customData[i]);
        traceDensities = order.map(i => traceDensities![i]);
    }

    const trace: any = {
        type: 'scatterternary',
        mode: 'markers',
        a: traceData.map(d => d.a),
        b: traceData.map(d => d.b),
        c: traceData.map(d => d.c),
        customdata: traceCustomData,
        hovertemplate: buildTernaryHoverTemplate(d(aAxis), d(bAxis), d(cAxis)),
        showlegend: false,
        marker: traceDensities ? {
            size: traceData.map(d => styleArrays.sizes[d.idx]),
            color: traceDensities,
            colorscale: DENSITY_JET_POINT_COLORSCALE,
            showscale: false,
            opacity: densityOpacity,
            symbol: traceData.map(d => shapeToPlotlySymbol(styleArrays.shapes[d.idx])),
            line: { width: 0 }
        } : {
            size: traceData.map(d => styleArrays.sizes[d.idx]),
            color: traceData.map(d => applyOpacityToColor(styleArrays.colors[d.idx], styleArrays.opacity[d.idx])),
            symbol: traceData.map(d => shapeToPlotlySymbol(styleArrays.shapes[d.idx])),
            line: { width: 0 }
        }
    };

    // Selected samples: a ring over each (linked with every other plot)
    const selSet = new Set(selectedIndices);
    const selPoints = selSet.size > 0
        ? normalizedData.filter(p => selSet.has(displayIndices ? displayIndices[p.idx] : p.idx))
        : [];
    const selectionTrace: any = selPoints.length > 0 ? {
        type: 'scatterternary',
        mode: 'markers',
        a: selPoints.map(p => p.a),
        b: selPoints.map(p => p.b),
        c: selPoints.map(p => p.c),
        hoverinfo: 'skip',
        showlegend: false,
        marker: {
            color: 'rgba(0,0,0,0)',
            size: selPoints.map(p => styleArrays.sizes[p.idx] + 4),
            line: { width: 2, color: SELECTION_COLOR },
        },
    } : null;

    // Attribute Manager class under the pointer
    const hoverPoints = hoveredRows ? normalizedData.filter(p => hoveredRows.has(displayIndices ? displayIndices[p.idx] : p.idx)) : [];
    const hoverTrace: any = hoverPoints.length > 0 ? {
        type: 'scatterternary',
        mode: 'markers',
        a: hoverPoints.map(p => p.a),
        b: hoverPoints.map(p => p.b),
        c: hoverPoints.map(p => p.c),
        hoverinfo: 'skip',
        showlegend: false,
        marker: {
            color: 'rgba(0,0,0,0)',
            size: hoverPoints.map(p => styleArrays.sizes[p.idx] + 3),
            line: { width: 2.5, color: HOVER_RING_COLOR },
        },
    } : null;

    return (
        <Box sx={{ p: 1 }}>
            {controlBar}

            <Paper ref={fillRef} sx={{ p: 2 }}>
                <ExpandablePlotWrapper>
                    <Plot
                        data={[trace, ...(nodeTrace ?? []), ...(hoverTrace ? [hoverTrace] : []), ...(selectionTrace ? [selectionTrace] : [])]}
                        layout={{
                            dragmode: dragMode,
                            title: { text: `Ternary: ${d(aAxis)} - ${d(bAxis)} - ${d(cAxis)}`, font: { size: EXPORT_FONT_SIZES.title }, x: 0, xanchor: 'left' },
                            autosize: true,
                            height: fillHeight,
                            font: { size: EXPORT_FONT_SIZES.tickLabels },
                            ternary: {
                                sum: 1,
                                aaxis: {
                                    title: { text: d(aAxis), font: { size: EXPORT_FONT_SIZES.axisTitle } },
                                    tickfont: { size: EXPORT_FONT_SIZES.tickLabels },
                                    min: lockAxes && rangesRef.current.aRange ? rangesRef.current.aRange[0] : 0,
                                    ...PERCENT_TICKS,
                                },
                                baxis: {
                                    title: { text: d(bAxis), font: { size: EXPORT_FONT_SIZES.axisTitle } },
                                    tickfont: { size: EXPORT_FONT_SIZES.tickLabels },
                                    min: lockAxes && rangesRef.current.bRange ? rangesRef.current.bRange[0] : 0,
                                    ...PERCENT_TICKS,
                                },
                                caxis: {
                                    title: { text: d(cAxis), font: { size: EXPORT_FONT_SIZES.axisTitle } },
                                    tickfont: { size: EXPORT_FONT_SIZES.tickLabels },
                                    min: lockAxes && rangesRef.current.cRange ? rangesRef.current.cRange[0] : 0,
                                    ...PERCENT_TICKS,
                                }
                            },
                            margin: { l: 80, r: 80, t: 80, b: 80 },
                            // Stable token: preserve zoom across re-renders; reset only on axis change
                            uirevision: lockAxes ? 'locked' : `${aAxis}|${bAxis}|${cAxis}`
                        }}
                        config={getPlotConfig({ filename: `ternary_${aAxis}_${bAxis}_${cAxis}` })}
                        style={{ width: '100%' }}
                        useResizeHandler={true}
                        onRelayout={handleRelayout}
                        onSelected={handleSelected}
                        onClick={handleClick}
                        onDeselect={handleDeselect}
                    />
                </ExpandablePlotWrapper>
            </Paper>
        </Box>
    );
};
