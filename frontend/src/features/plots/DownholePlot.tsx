/**
 * Downhole strip log: synchronized tracks of numeric fields and category
 * ribbons in ONE Plotly figure, per hole side by side (vertical) or along
 * one sequence axis (horizontal). The model and the figure are built in
 * downhole/stripLog.ts; this component gathers the data and edits the
 * settings. Values are the analytical ones (below detection substituted)
 * of every visible row (not the display sample). Selection is linked.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
    Box, Button, Checkbox, Chip, FormControlLabel, IconButton, MenuItem, Paper, Select, TextField,
    ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import { Add, ArrowDownward, ArrowUpward, DeleteOutline, ViewColumn, ViewStream } from '@mui/icons-material';
import Plot from '../../components/ThemedPlot';
import { plotById, useAnalyticalStore, useAppStore } from '../../store/appStore';
import { useAttributeStore } from '../../store/attributeStore';
import { PlotControlBar, ControlSection, SettingChip } from '../../components/plot_controls/PlotControlBar';
import { ColumnPicker } from '../../components/ColumnPicker';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';
import { getStyleArraysColumnar, getColumnDisplayName } from '../../utils/attributeUtils';
import { getDownholePlotConfig, EXPORT_FONT_SIZES } from '../../utils/plotConfig';
import { useStyleInputs } from '../../hooks/useStyleInputs';
import { useSelectionHandler } from '../../hooks/useSelectionHandler';
import { useDragMode } from '../../hooks/useDragMode';
import { useFillHeight } from '../../hooks/useFillHeight';
import { usePane } from '../workspace/PaneContext';
import { guessHoleColumn, guessToColumn } from './viewer3d/coordinateColumns';
import { sampleClasses } from './viewer3d/useLoggingLayers';
import {
    buildStripFigure, groupHoles, holeNames, newTrackId, normaliseDownholeSettings, resolvePosition,
    storedDownholeSettings, trackColours, MAX_FIELDS_PER_TRACK, TRACK_STYLES,
    type ColourClass, type DownholeSettings, type RefLine, type Track, type TrackScale, type TrackStyle,
} from './downhole/stripLog';

/** More holes than this side by side are unreadable: the vertical log shows the first ones */
const MAX_VERTICAL_HOLES = 16;
const STYLE_LABEL: Record<TrackStyle, string> = { line: 'Line', area: 'Area', bar: 'Bars', markers: 'Markers' };

interface DownholePlotProps {
    plotId: string;
}

export const DownholePlot: React.FC<DownholePlotProps> = ({ plotId }) => {
    const columns = useAppStore(s => s.columns);
    const lockAxes = useAppStore(s => s.lockAxes);
    const store = useAnalyticalStore();
    const stored = useAppStore(s => plotById(s, plotId)?.settings);
    const d = useCallback((name: string) => getColumnDisplayName(columns, name), [columns]);
    const attributeStyleState = useStyleInputs();
    const colourTab = useAttributeStore(s => s.color);
    const dragMode = useDragMode();
    const { handleSelected, handleClick, handleDeselect, selectedIndices } = useSelectionHandler();
    const { ref: fillRef, height: fillHeight } = useFillHeight<HTMLDivElement>(600, 320, 24);
    const [editorOpen, setEditorOpen] = useState<boolean | null>(null);
    const paneWidth = usePane()?.width ?? 0;

    const holeCol = useMemo(() => guessHoleColumn(columns), [columns]);
    const settings = useMemo(
        () => normaliseDownholeSettings(stored as Record<string, unknown> | undefined, { hasHoles: !!holeCol }),
        [stored, holeCol],
    );
    const { tracks, ribbons, orientation, depthColumn, holeDividers, selectedHoles } = settings;
    const vertical = orientation === 'vertical';

    /** Writes the whole strip-log settings (the legacy keys are cleared on the first write) */
    const update = useCallback((patch: Partial<DownholeSettings>) => {
        const app = useAppStore.getState();
        const cur = normaliseDownholeSettings(plotById(app, plotId)?.settings as Record<string, unknown> | undefined, { hasHoles: !!holeCol });
        app.updatePlotSettings(plotId, storedDownholeSettings({ ...cur, ...patch }));
    }, [plotId, holeCol]);
    const setTracks = (fn: (t: Track[]) => Track[]) => update({ tracks: fn(tracks) });
    const setTrack = (i: number, patch: Partial<Track>) => setTracks(ts => ts.map((t, k) => (k === i ? { ...t, ...patch } : t)));

    // Positions along the holes, interval ends when the position is a From column
    const getColumn = useCallback((name: string) => store.columns.get(name), [store]);
    const position = useMemo(
        () => resolvePosition(columns, depthColumn, getColumn, store.rowCount),
        [columns, depthColumn, getColumn, store.rowCount],
    );
    const to = useMemo(() => {
        if (!position.isFrom) return null;
        const name = guessToColumn(columns);
        const col = name ? store.columns.get(name) : undefined;
        return col instanceof Float64Array ? col : null;
    }, [position.isFrom, columns, store]);

    // Hidden rows (Attribute Manager) are left out, like every plot
    const visible = useMemo(() => {
        void attributeStyleState;
        if (store.rowCount === 0) return [] as boolean[];
        return getStyleArraysColumnar(store.rowCount, getColumn).visible;
    }, [store, getColumn, attributeStyleState]);

    const holeData = holeCol ? store.columns.get(holeCol) : undefined;
    const allHoles = useMemo(() => holeNames(holeData, store.rowCount), [holeData, store.rowCount]);
    const shownHoles = useMemo(() => selectedHoles.filter(h => allHoles.includes(h)), [selectedHoles, allHoles]);
    const grouped = useMemo(
        () => groupHoles(store.rowCount, holeData ?? null, position.values, visible, shownHoles),
        [store.rowCount, holeData, position.values, visible, shownHoles],
    );
    const holes = vertical && grouped.length > MAX_VERTICAL_HOLES ? grouped.slice(0, MAX_VERTICAL_HOLES) : grouped;

    // A ribbon of the Attribute Manager's colour field takes its classes
    const ribbonClasses = useMemo(() => {
        const out: Record<string, ColourClass[]> = {};
        const c = colourTab.additionalFields?.length ? null : sampleClasses(colourTab);
        if (c && ribbons.includes(c.field)) out[c.field] = c.classes;
        return out;
    }, [colourTab, ribbons]);

    // Sizes: tracks keep a readable width (vertical) / height (horizontal)
    const minWidth = vertical ? 90 + holes.length * (tracks.length * 120 + ribbons.length * 34 + 60) : 0;
    // Expected plot width (the pane less its padding), rounded so resizing redraws only in steps
    const widthPx = Math.max(minWidth, Math.round(Math.max(0, paneWidth - 48) / 50) * 50 || 1000);

    const positionLabel = position.column ? `${d(position.column)}${position.fromText ? ' (number)' : ''}` : position.label;
    const selected = useMemo(() => new Set(selectedIndices), [selectedIndices]);
    const figure = useMemo(() => buildStripFigure({
        holes, position: position.values, to, positionLabel,
        getColumn, tracks, ribbons, ribbonClasses, orientation, holeDividers, displayName: d, selected,
        widthPx: vertical ? widthPx : undefined,
    }), [holes, position, positionLabel, to, getColumn, tracks, ribbons, ribbonClasses, orientation, holeDividers, d, selected, vertical, widthPx]);

    const height = vertical ? Math.max(fillHeight, 420) : Math.max(fillHeight, 110 + tracks.length * 150 + (ribbons.length ? 30 + ribbons.length * 22 : 0));
    const layout = useMemo(() => ({
        ...figure.layout,
        autosize: true, height, dragmode: dragMode,
        font: { size: EXPORT_FONT_SIZES.tickLabels },
        uirevision: lockAxes ? 'locked' : `${plotId}|${orientation}|${position.column}|${holes.map(h => h.name).join(',')}|${tracks.map(t => `${t.id}:${t.scale}`).join(',')}`,
    }), [figure.layout, height, dragMode, lockAxes, plotId, orientation, position.column, holes, tracks]);

    const config = useMemo(() => getDownholePlotConfig(
        `downhole_${orientation}`,
        vertical ? { width: Math.max(800, minWidth), height: 1200 } : { width: 1800, height: Math.max(900, height * 1.4) },
    ), [orientation, vertical, minWidth, height]);

    const toggleHole = (hole: string) => update({
        selectedHoles: selectedHoles.includes(hole) ? selectedHoles.filter(h => h !== hole) : [...selectedHoles, hole],
    });

    const showEditor = editorOpen ?? tracks.length === 0;
    const colours = trackColours(tracks);
    const settingsActive = !!depthColumn || ribbons.length > 0 || !holeDividers;

    return (
        <Box sx={{ p: 1 }}>
            <PlotControlBar
                primary={<>
                    {holeCol && (
                        <Box sx={{ minWidth: 200, maxWidth: 460 }}>
                            <Typography variant="caption" color="text.secondary" display="block">
                                Holes {shownHoles.length ? `(${shownHoles.length} of ${allHoles.length})` : `(all ${allHoles.length})`}
                                {shownHoles.length > 0 && (
                                    <Button size="small" sx={{ minWidth: 0, py: 0, ml: 1, fontSize: 11 }} onClick={() => update({ selectedHoles: [] })}>Show all</Button>
                                )}
                            </Typography>
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, maxHeight: 72, overflowY: 'auto' }}>
                                {allHoles.map(hole => (
                                    <Chip
                                        key={hole} label={hole} size="small"
                                        variant={shownHoles.includes(hole) ? 'filled' : 'outlined'}
                                        color={shownHoles.includes(hole) ? 'primary' : 'default'}
                                        onClick={() => toggleHole(hole)}
                                    />
                                ))}
                            </Box>
                        </Box>
                    )}
                    <ToggleButtonGroup
                        size="small" exclusive value={orientation}
                        onChange={(_, v) => { if (v) update({ orientation: v }); }}
                    >
                        <ToggleButton value="vertical" aria-label="Vertical">
                            <Tooltip title="Vertical: holes side by side, depth down"><ViewColumn fontSize="small" /></Tooltip>
                        </ToggleButton>
                        <ToggleButton value="horizontal" aria-label="Horizontal">
                            <Tooltip title="Horizontal: tracks stacked along one sequence axis"><ViewStream fontSize="small" /></Tooltip>
                        </ToggleButton>
                    </ToggleButtonGroup>
                    <Button size="small" variant={showEditor ? 'contained' : 'outlined'} onClick={() => setEditorOpen(!showEditor)}>
                        Tracks ({tracks.length})
                    </Button>
                </>}
                settingsActive={settingsActive}
                summary={<>
                    {depthColumn && <SettingChip label={`Order: ${d(depthColumn)}`} onDelete={() => update({ depthColumn: '' })} />}
                    {ribbons.map(r => <SettingChip key={r} label={`Ribbon: ${d(r)}`} onDelete={() => update({ ribbons: ribbons.filter(x => x !== r) })} />)}
                </>}
                settings={<>
                    <ControlSection label="Position">
                        <ColumnPicker
                            label="Depth / order" value={depthColumn} filter="all" allowNone
                            noneLabel={`Automatic (${positionLabel})`}
                            onChange={v => update({ depthColumn: v })} useColumnFilter={false}
                        />
                        <Typography variant="caption" color="text.secondary">
                            Automatic: From, else depth, else a sample number (a text ID's trailing number), else the row order.
                            {to ? ' Intervals end at the To column.' : ''}
                        </Typography>
                    </ControlSection>
                    <ControlSection label="Ribbons (category columns)">
                        {ribbons.map((r, i) => (
                            <Box key={r} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <Typography variant="body2" sx={{ flex: 1 }} noWrap>{d(r)}</Typography>
                                <IconButton size="small" disabled={i === 0} onClick={() => update({ ribbons: move(ribbons, i, -1) })}><ArrowUpward fontSize="inherit" /></IconButton>
                                <IconButton size="small" disabled={i === ribbons.length - 1} onClick={() => update({ ribbons: move(ribbons, i, 1) })}><ArrowDownward fontSize="inherit" /></IconButton>
                                <IconButton size="small" onClick={() => update({ ribbons: ribbons.filter(x => x !== r) })}><DeleteOutline fontSize="inherit" /></IconButton>
                            </Box>
                        ))}
                        <ColumnPicker
                            label="Add ribbon" value="" filter="all" allowNone noneLabel="—"
                            onChange={v => { if (v && !ribbons.includes(v)) update({ ribbons: [...ribbons, v] }); }}
                        />
                    </ControlSection>
                    <ControlSection label="Display">
                        <FormControlLabel
                            control={<Checkbox size="small" checked={holeDividers} onChange={e => update({ holeDividers: e.target.checked })} />}
                            label={<Typography variant="body2">Hole dividers</Typography>}
                        />
                    </ControlSection>
                </>}
            />

            {showEditor && (
                <TrackEditor
                    tracks={tracks} colours={colours} d={d}
                    setTrack={setTrack} setTracks={setTracks}
                />
            )}

            {tracks.length === 0 && ribbons.length === 0 ? (
                <Paper sx={{ p: 4, textAlign: 'center' }}>
                    <Typography color="text.secondary">Add a track (a numeric column) to draw the log.</Typography>
                </Paper>
            ) : holes.length === 0 ? (
                <Paper sx={{ p: 4, textAlign: 'center' }}>
                    <Typography color="text.secondary">
                        No visible samples with a position{holeCol ? ' in the chosen holes' : ''}.
                    </Typography>
                </Paper>
            ) : (
                <Paper ref={fillRef} sx={{ p: 1, overflowX: 'auto' }}>
                    {grouped.length > holes.length && (
                        <Typography variant="caption" color="text.secondary" display="block">
                            Showing the first {holes.length} of {grouped.length} holes side by side: pick holes above, or switch to horizontal.
                        </Typography>
                    )}
                    <ExpandablePlotWrapper>
                        <Plot
                            data={figure.data as any}
                            layout={layout}
                            config={config}
                            style={{ width: '100%', minWidth }}
                            useResizeHandler
                            onSelected={handleSelected}
                            onClick={handleClick}
                            onDeselect={handleDeselect}
                        />
                    </ExpandablePlotWrapper>
                </Paper>
            )}
        </Box>
    );
};

function move<T>(list: readonly T[], i: number, by: number): T[] {
    const j = i + by;
    if (j < 0 || j >= list.length) return [...list];
    const out = [...list];
    [out[i], out[j]] = [out[j], out[i]];
    return out;
}

interface TrackEditorProps {
    tracks: Track[];
    colours: string[][];
    d: (name: string) => string;
    setTrack: (i: number, patch: Partial<Track>) => void;
    setTracks: (fn: (t: Track[]) => Track[]) => void;
}

/** Add, remove and order tracks; per track its fields, scale, style, reference lines, blank shading and flag overlay */
const TrackEditor: React.FC<TrackEditorProps> = ({ tracks, colours, d, setTrack, setTracks }) => (
    <Paper variant="outlined" sx={{ p: 1, mb: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
        {tracks.map((t, i) => (
            <TrackRow
                key={t.id} track={t} index={i} count={tracks.length} colours={colours[i]} d={d}
                onChange={patch => setTrack(i, patch)}
                onMove={by => setTracks(ts => move(ts, i, by))}
                onRemove={() => setTracks(ts => ts.filter((_, k) => k !== i))}
            />
        ))}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Add fontSize="small" color="action" />
            <ColumnPicker
                label="New track with column" value="" allowNone noneLabel="—" minWidth={220}
                onChange={v => { if (v) setTracks(ts => [...ts, { id: newTrackId(ts), fields: [{ field: v }], scale: 'linear', style: 'line' }]); }}
            />
        </Box>
    </Paper>
);

interface TrackRowProps {
    track: Track;
    index: number;
    count: number;
    colours: string[];
    d: (name: string) => string;
    onChange: (patch: Partial<Track>) => void;
    onMove: (by: number) => void;
    onRemove: () => void;
}

const TrackRow: React.FC<TrackRowProps> = ({ track: t, index, count, colours, d, onChange, onMove, onRemove }) => {
    const [refValue, setRefValue] = useState('');
    const [refLabel, setRefLabel] = useState('');
    const addRef = () => {
        const value = Number(refValue);
        if (refValue.trim() === '' || !Number.isFinite(value)) return;
        const ref: RefLine = refLabel.trim() ? { value, label: refLabel.trim() } : { value };
        onChange({ refLines: [...(t.refLines ?? []), ref] });
        setRefValue(''); setRefLabel('');
    };
    const flag = t.overlayFlag;
    return (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, p: 1, border: 1, borderColor: 'divider', borderRadius: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ width: 18 }}>{index + 1}</Typography>
            {t.fields.map((f, fi) => (
                <Box key={f.field} sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                    <input
                        type="color" value={colours[fi]} title="Colour"
                        onChange={e => onChange({ fields: t.fields.map((x, k) => (k === fi ? { ...x, colour: e.target.value } : x)) })}
                        style={{ width: 22, height: 22, border: 'none', padding: 0, cursor: 'pointer', background: 'none' }}
                    />
                    <Chip
                        size="small" label={d(f.field)}
                        onDelete={t.fields.length > 1 ? () => onChange({ fields: t.fields.filter((_, k) => k !== fi) }) : undefined}
                    />
                </Box>
            ))}
            {t.fields.length < MAX_FIELDS_PER_TRACK && (
                <ColumnPicker
                    label="Overlay column" value="" allowNone noneLabel="—" minWidth={150}
                    onChange={v => { if (v && !t.fields.some(f => f.field === v)) onChange({ fields: [...t.fields, { field: v }] }); }}
                />
            )}
            <Select size="small" value={t.scale} onChange={e => onChange({ scale: e.target.value as TrackScale })} sx={{ minWidth: 90 }}>
                <MenuItem value="linear">Linear</MenuItem>
                <MenuItem value="log">Log</MenuItem>
            </Select>
            <Select size="small" value={t.style} onChange={e => onChange({ style: e.target.value as TrackStyle })} sx={{ minWidth: 100 }}>
                {TRACK_STYLES.map(s => <MenuItem key={s} value={s}>{STYLE_LABEL[s]}</MenuItem>)}
            </Select>
            <Tooltip title="Grey bands where the first column is blank">
                <FormControlLabel
                    sx={{ mr: 0 }}
                    control={<Checkbox size="small" checked={!!t.shadeBlanks} onChange={e => onChange({ shadeBlanks: e.target.checked || undefined })} />}
                    label={<Typography variant="body2">Shade blanks</Typography>}
                />
            </Tooltip>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                {(t.refLines ?? []).map((r, ri) => (
                    <Chip
                        key={ri} size="small" variant="outlined" label={`— ${r.value}${r.label ? ` ${r.label}` : ''}`}
                        onDelete={() => onChange({ refLines: (t.refLines ?? []).filter((_, k) => k !== ri) })}
                    />
                ))}
                <TextField
                    size="small" label="Ref. line" value={refValue} sx={{ width: 90 }} inputProps={{ inputMode: 'decimal' }}
                    onChange={e => setRefValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addRef(); }}
                />
                <TextField
                    size="small" label="Label" value={refLabel} sx={{ width: 100 }}
                    onChange={e => setRefLabel(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addRef(); }}
                />
                <IconButton size="small" onClick={addRef} disabled={refValue.trim() === ''} title="Add reference line"><Add fontSize="inherit" /></IconButton>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <ColumnPicker
                    label="Flag column" value={flag?.column ?? ''} filter="all" allowNone minWidth={140}
                    onChange={v => onChange({ overlayFlag: v ? { ...(flag ?? { value: 1 }), column: v } : undefined })}
                />
                {flag && (
                    <TextField
                        size="small" label="= value" value={String(flag.value)} sx={{ width: 80 }}
                        onChange={e => {
                            const raw = e.target.value;
                            const n = Number(raw);
                            onChange({ overlayFlag: { ...flag, value: raw.trim() !== '' && Number.isFinite(n) ? n : raw } });
                        }}
                    />
                )}
            </Box>
            <Box sx={{ ml: 'auto', display: 'flex' }}>
                <IconButton size="small" disabled={index === 0} onClick={() => onMove(-1)} title="Move up"><ArrowUpward fontSize="small" /></IconButton>
                <IconButton size="small" disabled={index === count - 1} onClick={() => onMove(1)} title="Move down"><ArrowDownward fontSize="small" /></IconButton>
                <IconButton size="small" onClick={onRemove} title="Remove track"><DeleteOutline fontSize="small" /></IconButton>
            </Box>
        </Box>
    );
};

export default DownholePlot;
