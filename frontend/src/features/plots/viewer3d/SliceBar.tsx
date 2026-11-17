/**
 * Slice bar: one row of controls per slice, laid over the top edge of the 3D
 * view while slicing is on. Presentational: Viewer3D owns the slices.
 *
 * Each row sets a slice's orientation (W-E / S-N / level, a line drawn on
 * screen, the section through a clicked hole, or square to the view), its
 * position (typed coordinate, scrubber, step buttons), what it keeps (a width
 * about it, or everything behind / in front), its width and step.
 */
import React, { useEffect, useState } from 'react';
import { Box, Button, IconButton, Paper, Slider, SvgIcon, SvgIconProps, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Add, ChevronLeft, ChevronRight, Close, Keyboard, Lock, LockOpen, VerticalAlignCenter, Visibility, VisibilityOff } from '@mui/icons-material';
import {
    Slice, SliceMode, Vec3, PresetKind, PRESET_NORMALS, SLICE_COLORS, withNormal,
    sliceKind, sliceOrientation, slicePosition, withPosition, stepSlice, sliceRange, sliceStep, clipStateOf,
} from './slices';
import { LiveClip, useLiveClip } from './liveClip';
import { PointCloudGeometry, isInsideClip } from './geometry';

export type SlicePlacement = 'line' | 'hole' | 'view';

export interface SliceBarProps {
    slices: Slice[];
    active: number;
    /** Display names of the East, North and elevation columns */
    axisNames: [string, string, string];
    /** World coordinates */
    dataCentre: Vec3;
    bounds: { min: number[]; max: number[] };
    /** A slice waiting for a line to be drawn or a hole to be clicked */
    placing: { kind: 'line' | 'hole'; index: number } | null;
    canPickHole: boolean;
    onActive: (index: number) => void;
    onChange: (index: number, slice: Slice) => void;
    onRemove: (index: number) => void;
    onAdd: () => void;
    onPlace: (index: number, how: SlicePlacement) => void;
    /** `back`: from behind */
    onLookAt: (index: number, back?: boolean) => void;
    /** Move the slice, as it lies, onto the middle of the data */
    onCentre: (index: number) => void;
}

const formatNumber = (v: number, decimals: number) =>
    v.toLocaleString('en-US', { maximumFractionDigits: decimals, useGrouping: Math.abs(v) >= 10000 });

/** Small number box: commits on Enter or when left; Esc puts the old value back. */
const NumField: React.FC<{
    label: string; value: number; onCommit: (v: number) => void; width: number; decimals?: number; min?: number;
}> = ({ label, value, onCommit, width, decimals = 1, min }) => {
    const [text, setText] = useState<string | null>(null);
    const commit = () => {
        if (text !== null) {
            const v = Number(text.replace(/[,\s]/g, ''));
            if (text.trim() !== '' && Number.isFinite(v) && (min === undefined || v >= min)) onCommit(v);
        }
        setText(null);
    };
    return (
        <TextField
            size="small" variant="outlined" value={text ?? formatNumber(value, decimals)}
            onChange={e => setText(e.target.value)}
            onFocus={e => e.target.select()}
            onBlur={commit}
            onKeyDown={e => {
                if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); }
                else if (e.key === 'Escape') { setText(null); (e.target as HTMLInputElement).blur(); }
            }}
            sx={{ width }}
            InputProps={{ sx: { height: 26, fontSize: 12 } }}
            inputProps={{ 'aria-label': label, inputMode: 'decimal', style: { padding: '2px 6px', textAlign: 'right' } }}
        />
    );
};

/** The slice bar following the live slices: only this re-renders while a slice is dragged or stepped. */
export const LiveSliceBar: React.FC<Omit<SliceBarProps, 'slices' | 'active'> & { clip: LiveClip }> = ({ clip, ...rest }) => {
    const now = useLiveClip(clip);
    return now.slicing && now.slices.length > 0 ? <SliceBar slices={now.slices} active={now.active} {...rest} /> : null;
};

/** How often the count below is refreshed while a slice is moving (ms). */
const COUNT_INTERVAL = 150;

/**
 * " · N inside the slice" for the viewer's status line (nothing when no slice
 * or clip box is cutting). Counting visits every row, so while a slice moves
 * it is refreshed a few times a second, not on every frame.
 */
export const InsideCount: React.FC<{ clip: LiveClip; geometry: PointCloudGeometry }> = ({ clip, geometry }) => {
    const [text, setText] = useState('');
    useEffect(() => {
        let timer = 0;
        const count = () => {
            timer = 0;
            const state = clipStateOf(clip.get(), geometry.origin);
            if (!state.boxEnabled && state.slabs.length === 0) { setText(''); return; }
            const p = geometry.positions;
            let n = 0;
            for (let i = 0; i < geometry.valid.length; i++) {
                if (geometry.valid[i] && isInsideClip(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], state)) n++;
            }
            setText(` · ${n.toLocaleString()} inside the ${state.slabs.length === 2 ? 'slices' : state.slabs.length === 1 ? 'slice' : 'clip box'}`);
        };
        count();
        const off = clip.subscribe(() => { if (!timer) timer = window.setTimeout(count, COUNT_INTERVAL); });
        return () => { off(); window.clearTimeout(timer); };
    }, [clip, geometry]);
    return <>{text}</>;
};

const smallButton ={ minWidth: 0, px: 0.6, py: 0, height: 26, fontSize: 12, textTransform: 'none' } as const;
const PRESET_BUTTONS: [PresetKind, string, string][] = [
    ['we', 'W-E', 'West-east vertical section; steps north ( Ctrl+N )'],
    ['sn', 'S-N', 'South-north vertical section; steps east ( Ctrl+E )'],
    ['level', 'Level', 'Horizontal level plan; steps up ( Ctrl+D )'],
];

// What a slice keeps, drawn edge-on: the plane is the bar, the kept part is filled
const ThickIcon = (props: SvgIconProps) => (
    <SvgIcon {...props}><path d="M8 3h8v18H8z" /><path opacity=".25" d="M2 6h4v12H2zM18 6h4v12h-4z" /></SvgIcon>
);
const RemoveFrontIcon = (props: SvgIconProps) => (
    <SvgIcon {...props}><path d="M9 3h2v18H9zM12.5 6H22v12h-9.5z" /><path opacity=".25" d="M2 6h5.5v12H2z" /></SvgIcon>
);
const RemoveBackIcon = (props: SvgIconProps) => (
    <SvgIcon {...props}><path d="M13 3h2v18h-2zM2 6h9.5v12H2z" /><path opacity=".25" d="M16.5 6H22v12h-5.5z" /></SvgIcon>
);
const MODE_BUTTONS: [SliceMode, React.FC<SvgIconProps>, string][] = [
    ['thick', ThickIcon, 'Thick slice: keep the width about the slice ( T )'],
    ['front', RemoveFrontIcon, 'Remove front: keep the slice and everything behind it ( F )'],
    ['back', RemoveBackIcon, 'Remove back: keep the slice and everything in front of it ( K )'],
];

/** Keys and mouse for the slices (the slicer keys of Leapfrog, and a few more). */
const SHORTCUTS: [string, string][] = [
    ['Ctrl+/', 'Slicing on / off'],
    [',  .   or  [  ]', 'Step back / forward'],
    ['Ctrl + wheel', 'Step'],
    ['Ctrl + right drag', 'Move the slice'],
    ['Ctrl + middle drag', 'Slice width (or right then left button)'],
    ['L   Shift+L', 'Look at the slice / at its back'],
    ['T   F   K', 'Thick slice / remove front / remove back'],
    ['Ctrl+E  Ctrl+N  Ctrl+D', 'Slice the East / North / elevation axis'],
    ['Shift+E  Shift+N  Shift+D', 'The same, where the browser keeps Ctrl+N'],
    ['Ctrl+V', 'Slice square to the view'],
    ['Ctrl+L', 'Lock the slice to the camera'],
    ['C', 'Centre the slice on the data'],
    ['1   2', 'Choose which slice the keys move'],
    ['Esc', 'Cancel Draw / Hole'],
];
const ShortcutList = () => (
    <Box data-testid="slice-shortcuts" sx={{ display: 'grid', gridTemplateColumns: 'auto auto', columnGap: 1.5, rowGap: 0.25, py: 0.5 }}>
        <Box sx={{ gridColumn: '1 / -1', mb: 0.25 }}>Click in the view first, then:</Box>
        {SHORTCUTS.map(([keys, what]) => (
            <React.Fragment key={keys}>
                <Box component="span" sx={{ fontFamily: 'monospace', whiteSpace: 'pre' }}>{keys}</Box>
                <Box component="span">{what}</Box>
            </React.Fragment>
        ))}
    </Box>
);

export const SliceBar: React.FC<SliceBarProps> = ({
    slices, active, axisNames, dataCentre, bounds, placing, canPickHole,
    onActive, onChange, onRemove, onAdd, onPlace, onLookAt, onCentre,
}) => (
    <Box
        data-testid="slice-bar"
        sx={{ position: 'absolute', top: 6, left: 6, right: 6, display: 'flex', flexDirection: 'column', gap: 0.5, alignItems: 'flex-start', pointerEvents: 'none' }}
    >
        {slices.map((slice, i) => {
            const color = SLICE_COLORS[i] ?? SLICE_COLORS[0];
            const kind = sliceKind(slice.normal);
            const position = slicePosition(slice, dataCentre);
            const [lo, hi] = sliceRange(slice, bounds, dataCentre);
            const min = Math.min(lo, position), max = Math.max(hi, position);
            const o = sliceOrientation(slice.normal);
            const label = kind === 'we' ? axisNames[1] : kind === 'sn' ? axisNames[0] : kind === 'level' ? (axisNames[2] || 'Elevation') : `${o.strike}°/${o.dip}° offset`;
            const waiting = placing?.index === i ? placing.kind : null;
            const mode: SliceMode = slice.mode ?? 'thick';
            const set = (next: Slice) => onChange(i, next);
            return (
                <Paper
                    key={i} variant="outlined" data-testid={`slice-row-${i + 1}`}
                    onPointerDownCapture={() => { if (i !== active) onActive(i); }}
                    sx={theme => ({
                        pointerEvents: 'auto', px: 0.75, py: 0.25, maxWidth: '100%',
                        display: 'flex', alignItems: 'center', gap: 0.25, flexWrap: 'wrap',
                        userSelect: 'none', // fast clicks on the step arrows would select the labels
                        bgcolor: alpha(theme.palette.background.paper, 0.93),
                        borderColor: i === active ? color : 'divider',
                        opacity: slice.on ? 1 : 0.7,
                    })}
                >
                    <Tooltip title={slices.length > 1 ? `Slice ${i + 1}${i === active ? ' (the keys and Ctrl + wheel move this one)' : ''}` : 'Slice'}>
                        <Box sx={{ width: 18, height: 18, borderRadius: '50%', bgcolor: color, color: '#fff', fontSize: 11, fontWeight: 700, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                            {i + 1}
                        </Box>
                    </Tooltip>

                    <ToggleButtonGroup
                        size="small" exclusive value={kind === 'other' ? null : kind}
                        onChange={(_, v: PresetKind | null) => { if (v) set(withNormal(slice, [...PRESET_NORMALS[v]])); }}
                    >
                        {PRESET_BUTTONS.map(([k, text, tip]) => (
                            <ToggleButton key={k} value={k} sx={smallButton}><Tooltip title={tip}><span>{text}</span></Tooltip></ToggleButton>
                        ))}
                    </ToggleButtonGroup>

                    <Tooltip title="Drag a line across the view: the slice runs along it, edge-on to you (Esc cancels)">
                        <Button size="small" sx={smallButton} variant={waiting === 'line' ? 'contained' : 'text'} onClick={() => onPlace(i, 'line')}>Draw</Button>
                    </Tooltip>
                    <Tooltip title={canPickHole ? 'Click a hole: the slice becomes the vertical section through it (Esc cancels)' : 'Needs a hole ID column'}>
                        <span><Button size="small" sx={smallButton} disabled={!canPickHole} variant={waiting === 'hole' ? 'contained' : 'text'} onClick={() => onPlace(i, 'hole')}>Hole</Button></span>
                    </Tooltip>
                    <Tooltip title="Slice square to where you are looking now, through the middle of the view ( Ctrl+V )">
                        <Button size="small" sx={smallButton} onClick={() => onPlace(i, 'view')}>View</Button>
                    </Tooltip>

                    <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5, whiteSpace: 'nowrap' }}>{label}</Typography>
                    <NumField label={`Slice ${i + 1} position`} value={position} width={84} onCommit={v => set(withPosition(slice, v, dataCentre))} />
                    <Tooltip title="Step back ( , or [ ). Ctrl + right drag in the view moves the slice"><IconButton size="small" sx={{ p: 0.25 }} onClick={() => set(stepSlice(slice, -1))}><ChevronLeft fontSize="small" /></IconButton></Tooltip>
                    <Slider
                        size="small" aria-label={`Slice ${i + 1} scrubber`}
                        min={min} max={max} step={Math.max((max - min) / 2000, 1e-6)} value={position}
                        onChange={(_, v) => set(withPosition(slice, v as number, dataCentre))}
                        sx={{ width: 96, mx: 0.75, color, '& .MuiSlider-thumb': { width: 12, height: 12 } }}
                    />
                    <Tooltip title="Step forward ( . or ] ). Ctrl + wheel steps too"><IconButton size="small" sx={{ p: 0.25 }} onClick={() => set(stepSlice(slice, 1))}><ChevronRight fontSize="small" /></IconButton></Tooltip>

                    <ToggleButtonGroup
                        size="small" exclusive value={mode} aria-label={`Slice ${i + 1} mode`} sx={{ ml: 0.5 }}
                        onChange={(_, v: SliceMode | null) => { if (v) set({ ...slice, on: true, mode: v }); }}
                    >
                        {MODE_BUTTONS.map(([m, Icon, tip]) => (
                            <ToggleButton key={m} value={m} aria-label={tip} sx={{ ...smallButton, px: 0.4 }}>
                                <Tooltip title={tip}><Box component="span" sx={{ display: 'inline-flex' }}><Icon sx={{ fontSize: 18 }} /></Box></Tooltip>
                            </ToggleButton>
                        ))}
                    </ToggleButtonGroup>
                    {mode === 'thick' && (
                        <>
                            <Typography variant="caption" color="text.secondary" sx={{ ml: 0.25 }}>Width</Typography>
                            <NumField label={`Slice ${i + 1} width`} value={slice.width} width={50} decimals={2} min={0.001} onCommit={v => set({ ...slice, width: v })} />
                        </>
                    )}
                    <Typography variant="caption" color="text.secondary">Step</Typography>
                    <NumField label={`Slice ${i + 1} step`} value={sliceStep(slice)} width={50} decimals={2} min={0.001} onCommit={v => set({ ...slice, step: v === slice.width ? null : v })} />
                    <Typography variant="caption" color="text.secondary">m</Typography>

                    <Tooltip title="Turn the view square-on to this slice ( L ); with Shift, to its back ( Shift+L )">
                        <Button size="small" sx={smallButton} onClick={e => onLookAt(i, e.shiftKey)}>Look at</Button>
                    </Tooltip>
                    <Tooltip title="Centre: move the slice, as it lies, onto the middle of the data ( C )">
                        <IconButton size="small" sx={{ p: 0.25 }} aria-label={`Centre slice ${i + 1}`} onClick={() => onCentre(i)}><VerticalAlignCenter fontSize="small" sx={{ transform: 'rotate(90deg)' }} /></IconButton>
                    </Tooltip>
                    <Tooltip title={slice.locked ? 'Locked to the camera: the slice stays put on screen and the data moves through it. Click to unlock ( Ctrl+L )' : 'Lock to the camera: the slice stays put on screen while you turn or move the view ( Ctrl+L )'}>
                        <IconButton size="small" sx={{ p: 0.25 }} aria-label={`Lock slice ${i + 1} to the camera`} aria-pressed={!!slice.locked} color={slice.locked ? 'primary' : 'default'} onClick={() => set({ ...slice, on: true, locked: !slice.locked })}>
                            {slice.locked ? <Lock fontSize="small" /> : <LockOpen fontSize="small" />}
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={slice.on ? 'Stop cutting with this slice (it is kept)' : 'Cut with this slice again'}>
                        <IconButton size="small" sx={{ p: 0.25 }} onClick={() => set({ ...slice, on: !slice.on })}>
                            {slice.on ? <Visibility fontSize="small" /> : <VisibilityOff fontSize="small" />}
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Remove this slice">
                        <IconButton size="small" sx={{ p: 0.25 }} onClick={() => onRemove(i)}><Close fontSize="small" /></IconButton>
                    </Tooltip>

                    {i === 0 && (
                        <Tooltip title={<ShortcutList />} slotProps={{ tooltip: { sx: { maxWidth: 460, fontSize: 12 } } }}>
                            <IconButton size="small" sx={{ p: 0.25 }} aria-label="Slice shortcuts"><Keyboard fontSize="small" /></IconButton>
                        </Tooltip>
                    )}

                    {slices.length < 2 && (
                        <Tooltip title="Add a second slice crossing this one: only what lies inside both is shown">
                            <Button size="small" sx={{ ...smallButton, '& .MuiButton-startIcon': { mr: 0.25 } }} startIcon={<Add fontSize="small" />} onClick={onAdd}>Slice 2</Button>
                        </Tooltip>
                    )}
                </Paper>
            );
        })}
    </Box>
);
