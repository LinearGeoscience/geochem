import React, { useMemo, useRef, useCallback, useEffect } from 'react';
import Plot from '../../components/ThemedPlot';
import { useAppStore, useDatasetRows, useDisplayRows } from '../../store/appStore';
import { usePlotSetting } from '../../hooks/usePlotSetting';
import { useShallow } from 'zustand/react/shallow';
import {
    Box,
    Paper,
    Typography,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Chip,
    Tooltip,
    IconButton,
    ToggleButton,
    ToggleButtonGroup,
    FormControlLabel,
    Checkbox,
    ListSubheader,
} from '@mui/material';
import { AutoFixHigh, FileOpen } from '@mui/icons-material';
import { useNormalizationStore } from '../../store/normalizationStore';
import { groupProfiles, parseInteropNormalization, ProfileStat } from '../../utils/spiderProfiles';
import { notify } from '../../store/notificationStore';
import { MultiColumnSelector } from '../../components/MultiColumnSelector';
import { attributeColumnValues, getStyleArraysColumnar, applyOpacityToColor, getSortedIndices, sortColumnsByPriority, getColumnDisplayName } from '../../utils/attributeUtils';
import { getPlotConfig, EXPORT_FONT_SIZES } from '../../utils/plotConfig';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';
import { buildSpiderHoverText } from '../../utils/tooltipUtils';
import {
    ELEMENT_ORDERS,
    NORMALIZATION_VALUES,
    findMatchingColumns,
} from '../../utils/elementOrdering';
import { PlotControlBar, ControlSection, SettingChip } from '../../components/plot_controls/PlotControlBar';
import { resolveColumnToPpm } from '../../utils/calculations/elementColumnResolver';
import { useSelectionHandler } from '../../hooks/useSelectionHandler';
import { SELECTION_COLOR } from '../../utils/selectionHelpers';
import { useDragMode } from '../../hooks/useDragMode';
import { useFillHeight } from '../../hooks/useFillHeight';
import { useStyleInputs } from '../../hooks/useStyleInputs';

/** One Plotly trace per sample — beyond this the plot becomes unusable. */
const MAX_SPIDER_SAMPLES = 200;

interface AxisRanges {
    yRange?: [number, number];
}

interface SpiderPlotProps {
    plotId: string;
}

export const SpiderPlot: React.FC<SpiderPlotProps> = ({ plotId }) => {
    // Fill the dock pane below the controls (fixed height outside the workspace)
    const { ref: fillRef, height: fillHeight } = useFillHeight<HTMLDivElement>(500, 300, 48);
    const dragMode = useDragMode();
    const { columns, lockAxes, geochemMappings } = useAppStore(useShallow(s => ({ columns: s.columns, lockAxes: s.lockAxes, geochemMappings: s.geochemMappings })));
    const data = useDatasetRows();
    const getDisplayColumn = useAppStore(s => s.getDisplayColumn);
    const tooltipMode = useAppStore(s => s.tooltipMode); // hover templates read it from the store
    const filteredColumns = useAppStore(useShallow(s => s.getFilteredColumns()));
    const d = useCallback((name: string) => getColumnDisplayName(columns, name), [columns]);
    // Style arrays read the attribute store directly; this object is the
    // memo dependency that tracks it
    const attributeStyleState = useStyleInputs();

    const { handleSelected, handleClick, handleDeselect, selectedIndices } = useSelectionHandler();
    const selectedSet = useMemo(() => new Set(selectedIndices), [selectedIndices]);

    const displayData = useDisplayRows();
    const displayIndices = useAppStore(s => s._sampleIndicesArray);

    const [selectedElements, setSelectedElements] = usePlotSetting<string[]>(plotId, 'selectedElements', []);
    const [elementOrderId, setElementOrderId] = usePlotSetting<string>(plotId, 'elementOrderId', 'custom');
    const [normalizationId, setNormalizationId] = usePlotSetting<string>(plotId, 'normalizationId', 'none');
    // standard summary profiles per colour group
    const [profileMode, setProfileMode] = usePlotSetting<'samples' | 'groups' | 'both'>(plotId, 'profileMode', 'samples');
    const [profileStat, setProfileStat] = usePlotSetting<ProfileStat>(plotId, 'profileStat', 'mean');
    const [profileBand, setProfileBand] = usePlotSetting<boolean>(plotId, 'profileBand', true);
    const userNormalizations = useNormalizationStore(s => s.userNormalizations);
    const allNormalizations = useMemo(() => [...NORMALIZATION_VALUES, ...userNormalizations], [userNormalizations]);
    const normFileRef = useRef<HTMLInputElement>(null);

    const rangesRef = useRef<AxisRanges>({});

    const handleRelayout = useCallback((event: any) => {
        if (event['yaxis.range[0]'] !== undefined || event['yaxis.range'] !== undefined) {
            const yRange = event['yaxis.range'] || [event['yaxis.range[0]'], event['yaxis.range[1]']];
            rangesRef.current = { yRange: yRange as [number, number] };
        }
        if (event['yaxis.autorange']) {
            rangesRef.current = {};
        }
    }, []);

    const numericColumns = useMemo(() =>
        sortColumnsByPriority(
            filteredColumns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))
        ),
        [filteredColumns]
    );
    const allNumericColumns = useMemo(() => sortColumnsByPriority(
        columns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))
    ), [columns]);
    const columnNames = useMemo(() => numericColumns.map(c => c.name), [numericColumns]);

    // Get current element order
    const currentOrder = useMemo(() => {
        if (elementOrderId === 'custom') return null;
        return ELEMENT_ORDERS.find(o => o.id === elementOrderId) || null;
    }, [elementOrderId]);

    // Get matched columns for current order (prefer geochem mappings)
    const matchedColumns = useMemo(() => {
        if (!currentOrder) return {};
        return findMatchingColumns(columnNames, currentOrder, geochemMappings.length > 0 ? geochemMappings : undefined);
    }, [currentOrder, columnNames, geochemMappings]);

    // Get normalization values
    const normalization = useMemo(() => {
        return allNormalizations.find(n => n.id === normalizationId);
    }, [normalizationId, allNormalizations]);

    // Open a normalisation XML: add it, select it, and lay out the
    // elements in the file's order
    const handleNormFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        try {
            const list = parseInteropNormalization(await f.text(), f.name.replace(/\.xml$/i, ''));
            useNormalizationStore.getState().addNormalizations(list);
            const norm = list[0];
            setNormalizationId(norm.id);
            const matched = findMatchingColumns(columnNames, { id: norm.id, name: norm.name, elements: norm.order, description: '' }, geochemMappings.length > 0 ? geochemMappings : undefined);
            const ordered = norm.order.filter(el => matched[el]).map(el => matched[el]);
            if (ordered.length) {
                setElementOrderId('custom');
                setSelectedElements(ordered);
            }
            notify(`Loaded "${norm.name}": ${norm.order.length} elements, ${ordered.length} in this dataset`, 'success');
        } catch (err) {
            notify(`Could not read ${f.name}: ${(err as Error).message}`, 'error');
        }
    };

    // Auto-apply element ordering when changed
    useEffect(() => {
        if (elementOrderId !== 'custom' && currentOrder) {
            const orderedColumns = currentOrder.elements
                .filter(el => matchedColumns[el])
                .map(el => matchedColumns[el]);
            if (orderedColumns.length > 0) {
                setSelectedElements(orderedColumns);
            }
        }
    }, [elementOrderId, currentOrder, matchedColumns, setSelectedElements]);

    // Get the display labels (element symbols when using standard order, aliases in custom mode)
    const getDisplayLabels = useCallback((colNames: string[]): string[] => {
        if (elementOrderId === 'custom' || !currentOrder) {
            return colNames.map(col => d(col));
        }
        // Map column names back to element symbols
        const columnToElement: Record<string, string> = {};
        for (const [element, column] of Object.entries(matchedColumns)) {
            columnToElement[column] = element;
        }
        return colNames.map(col => columnToElement[col] || col);
    }, [elementOrderId, currentOrder, matchedColumns, d]);

    // Apply normalization to values. Reference values are in ppm, so each
    // column's values are converted to ppm (pct ×1e4, ppb ×1e-3) first. The
    // element symbol comes from the geochem mappings, so custom element
    // selections are normalised too (previously they silently plotted raw).
    // An element the standard has no value for is left as a gap (null): plotting
    // its raw ppm on a normalised axis put it orders of magnitude off the profile.
    const normalizeValue = useCallback((column: string, value: number): number | null => {
        if (!normalization || normalizationId === 'none') return value;

        const resolved = resolveColumnToPpm(geochemMappings, column);
        let elementSymbol = resolved?.element ?? column;
        if (!resolved && currentOrder) {
            for (const [el, col] of Object.entries(matchedColumns)) {
                if (col === column) {
                    elementSymbol = el;
                    break;
                }
            }
        }

        const normValue = normalization.values[elementSymbol];
        if (normValue && normValue > 0) {
            const offset = (normalization as { offsets?: Record<string, number> }).offsets?.[elementSymbol] ?? 0;
            return (value * (resolved?.toPpm ?? 1) - offset) / normValue;
        }
        return null;
    }, [normalization, normalizationId, geochemMappings, currentOrder, matchedColumns]);

    /** Selected elements the chosen standard has no reference value for */
    const unnormalised = useMemo(
        () => (normalizationId === 'none' ? [] : selectedElements.filter(c => normalizeValue(c, 1) === null)),
        [normalizationId, selectedElements, normalizeValue],
    );

    // Handle auto-match button
    const handleAutoMatch = () => {
        if (currentOrder) {
            const orderedColumns = currentOrder.elements
                .filter(el => matchedColumns[el])
                .map(el => matchedColumns[el]);
            if (orderedColumns.length > 0) {
                setSelectedElements(orderedColumns);
            }
        }
    };

    const displayLabels = useMemo(() => getDisplayLabels(selectedElements), [selectedElements, getDisplayLabels]);

    const plotData = useMemo(() => {
        if (!displayData.length || selectedElements.length === 0) return [];
        void attributeStyleState; void tooltipMode; // read from the stores by the style/hover builders

        // Get styles from attribute store — columnar fast path
        const styleArrays = getStyleArraysColumnar(displayData.length, (name) => getDisplayColumn(name), displayIndices ?? undefined);

        // Get sorted indices for z-ordering (low-grade first, high-grade last/on top)
        const sortedIndices = getSortedIndices(styleArrays);

        // One trace per sample, so cap the count. Prefer the current selection;
        // otherwise keep the END of the z-sorted list (emphasised / high-grade
        // samples are sorted last) — previously the first 100 were kept,
        // which dropped exactly the samples of interest.
        // With a selection: the selected samples on top, and any remaining
        // capacity filled with unselected samples drawn faintly for context.
        const isSel = (idx: number) => selectedSet.has(displayIndices ? displayIndices[idx] : idx);
        let limitedIndices: number[];
        if (selectedSet.size > 0) {
            const selectedVisible = sortedIndices.filter(isSel).slice(-MAX_SPIDER_SAMPLES);
            const room = MAX_SPIDER_SAMPLES - selectedVisible.length;
            const context = room > 0 ? sortedIndices.filter(idx => !isSel(idx)).slice(-room) : [];
            limitedIndices = [...context, ...selectedVisible];
        } else {
            limitedIndices = sortedIndices.slice(-MAX_SPIDER_SAMPLES);
        }
        const dimOthers = selectedSet.size > 0;

        // Create traces in sorted order (low grade first, high grade last/on top)
        const traces: any[] = limitedIndices.map((idx) => {
            const sampleColor = styleArrays.colors[idx];
            const sampleSize = styleArrays.sizes[idx];
            const sampleOpacity = styleArrays.opacity[idx];
            const colorWithOpacity = applyOpacityToColor(sampleColor, sampleOpacity * 0.8);
            const originalIdx = displayIndices ? displayIndices[idx] : idx;
            const hoverText = buildSpiderHoverText(data, originalIdx);

            // Apply normalization to values
            const yValues = selectedElements.map(el => {
                const rawValue = displayData[idx][el];
                if (rawValue == null || isNaN(rawValue)) return null;
                return normalizeValue(el, rawValue);
            });

            return {
                type: 'scatter',
                mode: 'lines+markers',
                x: displayLabels,
                y: yValues,
                name: hoverText,
                hoverinfo: 'name+x+y',
                // Original row index on every point -> click / box-select map back
                customdata: yValues.map(() => originalIdx),
                line: {
                    color: colorWithOpacity,
                    width: Math.max(1, sampleSize / 6) + (dimOthers && isSel(idx) ? 1.5 : 0)
                },
                marker: {
                    color: colorWithOpacity,
                    size: sampleSize,
                    line: dimOthers && isSel(idx) ? { width: 1.5, color: SELECTION_COLOR } : { width: 0 },
                },
                // Point opacity is already in the colour alpha; the trace only dims non-selected lines
                opacity: dimOthers ? (isSel(idx) ? 1 : 0.15) : 1,
                showlegend: false
            };
        });

        if (profileMode === 'samples') return traces;

        // Summary profile per visible colour group (all visible rows, not the capped lines),
        // keyed by group name (painted groups included), in legend order
        const app = useAppStore.getState();
        const rowNames = attributeColumnValues('color', app.columnarData.rowCount, n => app.getRawColumn(n));
        const order = [...attributeStyleState.customEntries, ...attributeStyleState.color.entries.filter(e => !e.isDefault)].map(e => e.name);
        const groupOf = (idx: number) => rowNames[displayIndices ? displayIndices[idx] : idx] || 'Default';
        const unsorted = new Map<string, number[]>();
        const colourOf = new Map<string, string>();
        for (const idx of sortedIndices) {
            const g = groupOf(idx);
            const l = unsorted.get(g);
            if (l) l.push(idx); else { unsorted.set(g, [idx]); colourOf.set(g, styleArrays.colors[idx]); }
        }
        const rank = (g: string) => { const k = order.indexOf(g); return k < 0 ? order.length : k; };
        const groups = new Map([...unsorted].sort((a, b) => rank(a[0]) - rank(b[0])));
        const profiles = groupProfiles(groups, selectedElements.length, (idx, k) => {
            const raw = displayData[idx][selectedElements[k]];
            return raw == null || isNaN(raw) ? null : normalizeValue(selectedElements[k], raw);
        }, profileStat);
        const statLabel = profileStat === 'median' ? 'median' : profileStat === 'geomean' ? 'geometric mean' : 'mean';
        const groupTraces: any[] = [];
        for (const p of profiles) {
            const name = `${p.group} (${statLabel}, n=${p.n})`;
            const colour = colourOf.get(p.group) ?? '#1f77b4';
            if (profileBand) {
                // Closed band: hi left->right, lo right->left (log axis: drop non-positive)
                const ok = (v: number | null) => v !== null && v > 0;
                const xs: string[] = [], ys: number[] = [];
                displayLabels.forEach((x, k) => { if (ok(p.hi[k])) { xs.push(x); ys.push(p.hi[k]!); } });
                for (let k = displayLabels.length - 1; k >= 0; k--) if (ok(p.lo[k])) { xs.push(displayLabels[k]); ys.push(p.lo[k]!); }
                groupTraces.push({
                    type: 'scatter', mode: 'lines', x: xs, y: ys, fill: 'toself', fillcolor: applyOpacityToColor(colour, 0.15),
                    line: { width: 0 }, hoverinfo: 'skip', showlegend: false,
                });
            }
            groupTraces.push({
                type: 'scatter', mode: 'lines+markers', x: displayLabels, y: p.centre, name,
                line: { color: colour, width: 3 }, marker: { color: colour, size: 7 },
                hovertemplate: `%{x}: %{y:.3g}<extra>${name}</extra>`, showlegend: true,
            });
        }
        return profileMode === 'groups' ? groupTraces : [...traces, ...groupTraces];
    }, [data, displayData, displayIndices, selectedElements, displayLabels, normalizeValue, getDisplayColumn, selectedSet, attributeStyleState, tooltipMode, profileMode, profileStat, profileBand]);

    // Calculate matched element count for display
    const matchedCount = currentOrder ? Object.keys(matchedColumns).length : 0;
    const totalElements = currentOrder ? currentOrder.elements.length : 0;

    // Get Y-axis title based on normalization
    // An id that no longer resolves (normalisation removed) plots raw values: title them so
    const yAxisTitle = normalizationId === 'none' || !normalization
        ? 'Concentration'
        : `Sample / ${normalization.name}`;

    return (
        <Box sx={{ p: 1 }}>
            <PlotControlBar
                primary={<>
                    <MultiColumnSelector
                        columns={numericColumns}
                        selectedColumns={selectedElements}
                        onChange={setSelectedElements}
                        label={elementOrderId === 'custom' ? 'Select Elements' : 'Selected Elements (auto-matched)'}
                        allColumns={allNumericColumns}
                    />
                    <FormControl sx={{ minWidth: 250 }}>
                        <InputLabel size="small">Normalization</InputLabel>
                        <Select
                            value={normalizationId}
                            onChange={(e) => setNormalizationId(e.target.value)}
                            label="Normalization"
                            size="small"
                        >
                            {NORMALIZATION_VALUES.map((norm) => (
                                <MenuItem key={norm.id} value={norm.id}>
                                    <Tooltip title={norm.reference || 'Raw values'} placement="right">
                                        <span>{norm.name}</span>
                                    </Tooltip>
                                </MenuItem>
                            ))}
                            {userNormalizations.length > 0 && <ListSubheader>From files</ListSubheader>}
                            {userNormalizations.map((norm) => (
                                <MenuItem key={norm.id} value={norm.id}>
                                    <Tooltip title={`${norm.reference} — ${norm.order.join(', ')}`} placement="right">
                                        <span>{norm.name}</span>
                                    </Tooltip>
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <Tooltip title="Open normalisation… (.xml)">
                        <IconButton size="small" onClick={() => normFileRef.current?.click()}><FileOpen fontSize="small" /></IconButton>
                    </Tooltip>
                    <input ref={normFileRef} type="file" accept=".xml" hidden onChange={handleNormFile} />
                    <ToggleButtonGroup size="small" exclusive value={profileMode} onChange={(_, v) => v && setProfileMode(v)}>
                        <Tooltip title="One line per sample"><ToggleButton value="samples">Samples</ToggleButton></Tooltip>
                        <Tooltip title="Summary profile per colour group"><ToggleButton value="groups">Groups</ToggleButton></Tooltip>
                        <Tooltip title="Group profiles over the sample lines"><ToggleButton value="both">Both</ToggleButton></Tooltip>
                    </ToggleButtonGroup>
                </>}
                settingsActive={elementOrderId !== 'custom' || (profileMode !== 'samples' && (profileStat !== 'mean' || !profileBand))}
                summary={<>
                    {elementOrderId !== 'custom' && currentOrder && (
                        <SettingChip label={currentOrder.name} onDelete={() => setElementOrderId('custom')} />
                    )}
                </>}
                settings={<>
                    {profileMode !== 'samples' && (
                        <ControlSection label="Group profiles">
                            <FormControl sx={{ minWidth: 180 }}>
                                <InputLabel size="small">Statistic</InputLabel>
                                <Select size="small" label="Statistic" value={profileStat} onChange={(e) => setProfileStat(e.target.value as ProfileStat)}>
                                    <MenuItem value="mean">Mean (± 1 SD)</MenuItem>
                                    <MenuItem value="geomean">Geometric mean (× / ÷ 1 SD)</MenuItem>
                                    <MenuItem value="median">Median (25th–75th percentile)</MenuItem>
                                </Select>
                            </FormControl>
                            <FormControlLabel control={<Checkbox checked={profileBand} onChange={(e) => setProfileBand(e.target.checked)} />} label={<Typography variant="body2">Show spread band</Typography>} />
                        </ControlSection>
                    )}
                    <ControlSection label="Element Order">
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                            <FormControl sx={{ minWidth: 200 }}>
                                <InputLabel size="small">Element Order</InputLabel>
                                <Select
                                    value={elementOrderId}
                                    onChange={(e) => setElementOrderId(e.target.value)}
                                    label="Element Order"
                                    size="small"
                                >
                                    <MenuItem value="custom">Custom (Manual)</MenuItem>
                                    {ELEMENT_ORDERS.map((order) => (
                                        <MenuItem key={order.id} value={order.id}>
                                            <Tooltip title={order.description} placement="right">
                                                <span>{order.name}</span>
                                            </Tooltip>
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>

                            {elementOrderId !== 'custom' && currentOrder && (
                                <Tooltip title="Auto-match columns to element order">
                                    <IconButton onClick={handleAutoMatch} color="primary" size="small">
                                        <AutoFixHigh />
                                    </IconButton>
                                </Tooltip>
                            )}
                        </Box>

                        {/* Matched elements indicator */}
                        {elementOrderId !== 'custom' && currentOrder && (
                            <Box>
                                <Typography variant="caption" color="text.secondary">
                                    Matched: {matchedCount} / {totalElements} elements
                                </Typography>
                                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
                                    {currentOrder.elements.slice(0, 20).map((el) => (
                                        <Chip
                                            key={el}
                                            label={el}
                                            size="small"
                                            variant={matchedColumns[el] ? 'filled' : 'outlined'}
                                            color={matchedColumns[el] ? 'primary' : 'default'}
                                            sx={{ opacity: matchedColumns[el] ? 1 : 0.5 }}
                                        />
                                    ))}
                                    {currentOrder.elements.length > 20 && (
                                        <Chip label={`+${currentOrder.elements.length - 20} more`} size="small" variant="outlined" />
                                    )}
                                </Box>
                            </Box>
                        )}
                    </ControlSection>
                </>}
            />

            {selectedElements.length === 0 ? (
                <Typography color="text.secondary">Select elements to display spider plot</Typography>
            ) : (
                <Paper ref={fillRef} sx={{ p: 2 }}>
                    <ExpandablePlotWrapper>
                        <Plot
                            data={plotData}
                            layout={{
                                title: { text: normalizationId !== 'none' && normalization ? `Spider Plot - ${normalization.name}` : 'Spider Plot', font: { size: EXPORT_FONT_SIZES.title }, x: 0, xanchor: 'left' },
                                autosize: true,
                                height: fillHeight,
                                font: { size: EXPORT_FONT_SIZES.tickLabels },
                                margin: { l: 70, r: 40, t: 60, b: 70 },
                                // Element order fixed: elements without data stay in place
                                xaxis: { title: { text: 'Elements', font: { size: EXPORT_FONT_SIZES.axisTitle } }, tickfont: { size: EXPORT_FONT_SIZES.tickLabels }, categoryorder: 'array' as const, categoryarray: displayLabels, automargin: true },
                                yaxis: {
                                    title: { text: yAxisTitle, font: { size: EXPORT_FONT_SIZES.axisTitle } },
                                    tickfont: { size: EXPORT_FONT_SIZES.tickLabels },
                                    type: 'log',
                                    ...(lockAxes && rangesRef.current.yRange
                                        ? { range: rangesRef.current.yRange, autorange: false }
                                        : { autorange: true })
                                },
                                hovermode: 'closest',
                                // Drag box-selects samples (scroll zooms); click a line to pick one sample
                                dragmode: dragMode,
                                showlegend: profileMode !== 'samples',
                                legend: { font: { size: 10 } },
                                // Stable token: preserve zoom across re-renders; reset when
                                // normalization or the element list changes
                                uirevision: lockAxes ? 'locked' : `${normalizationId}|${selectedElements.join(',')}`
                            }}
                            config={getPlotConfig({ filename: `spider_${normalization}` })}
                            useResizeHandler={true}
                            style={{ width: '100%' }}
                            onRelayout={handleRelayout}
                            onClick={handleClick}
                            onSelected={handleSelected}
                            onDeselect={handleDeselect}
                        />
                    </ExpandablePlotWrapper>
                    {unnormalised.length > 0 && (
                        <Typography variant="caption" color="text.secondary" component="p">
                            Not in {normalization?.name}: {unnormalised.map(c => d(c)).join(', ')} (left as gaps).
                        </Typography>
                    )}
                    {plotData.length >= MAX_SPIDER_SAMPLES && (
                        <Typography variant="caption" color="text.secondary">
                            Showing {MAX_SPIDER_SAMPLES} samples ({selectedSet.size > 0 ? 'selection first, then faint context' : 'highest-priority visible samples'}). Select samples here or in another plot to choose which are drawn.
                        </Typography>
                    )}
                </Paper>
            )}
        </Box>
    );
};
