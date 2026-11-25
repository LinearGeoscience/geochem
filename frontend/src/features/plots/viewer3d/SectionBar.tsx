/**
 * Section view's bar (which plane, step back and on, back to 3D, copy the
 * open surface's lines from the sections either side) and its scale bar.
 * Presentational for the view: useSectionView owns it.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Box, Button, IconButton, ListItemText, Menu, MenuItem, Paper, TextField, Tooltip, Typography } from '@mui/material';
import { ChevronLeft, ChevronRight, ContentCopy, ThreeDRotation } from '@mui/icons-material';
import { useModelStore } from '../../../store/modelStore';
import { sectionOfLine } from '../../model/lineTools';
import { copyLinesToSection } from '../../model/sceneActions';
import { sectionLabel } from '../../model/sectionSets';
import type { SectionViewState } from './useSectionView';
import type { PresetKind } from './slices';
import type { ThreeViewport } from './ThreeViewport';
import { formatGrid, scaleBarLength } from './sectionGrid';

const linesText = (n: number) => `${n} ${n === 1 ? 'line' : 'lines'}`;

/** The open surface's lines on the sections either side of this one, offered to copy onto it */
const CopyLinesHere: React.FC<{ view: SectionViewState }> = ({ view }) => {
    const surface = useModelStore(s => (s.editingId === null ? null : s.scene.surfaces.find(x => x.id === s.editingId) ?? null));
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const sources = useMemo(() => {
        if (!surface) return [];
        return [-1, 1].flatMap(side => {
            const from = view.index + side;
            const ids = surface.polylines.filter(l => sectionOfLine(l, [view.set])?.index === from).map(l => l.id);
            return ids.length > 0 ? [{ from, ids, label: sectionLabel(view.set, from) }] : [];
        });
    }, [surface, view.set, view.index]);
    if (!surface || sources.length === 0) return null;
    return (
        <>
            <Tooltip title="Copy the lines of the section before or after onto this one, to move into place here">
                <Button size="small" startIcon={<ContentCopy fontSize="small" />} onClick={e => setAnchor(e.currentTarget)} sx={{ textTransform: 'none', flexShrink: 0 }}>
                    Copy lines here
                </Button>
            </Tooltip>
            <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'top', horizontal: 'center' }} transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
                {sources.map(src => (
                    <MenuItem
                        key={src.from} dense
                        onClick={() => {
                            setAnchor(null);
                            copyLinesToSection(surface.id, src.ids, view.index - src.from, view.set.id);
                        }}
                    >
                        <ListItemText primary={`From ${src.label}`} secondary={linesText(src.ids.length)} />
                    </MenuItem>
                ))}
            </Menu>
        </>
    );
};

const barSx = { position: 'absolute', left: '50%', bottom: 30, transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.25, zIndex: 5, whiteSpace: 'nowrap', maxWidth: 'calc(100% - 24px)' } as const;

/** The section sets, to pick the one to look along */
const SetSelect: React.FC<{ value: string; onPick: (id: string) => void; placeholder?: string }> = ({ value, onPick, placeholder }) => {
    const sets = useModelStore(s => s.scene.sectionSets) ?? [];
    return (
        <TextField
            select size="small" variant="standard" value={value} onChange={e => onPick(e.target.value)}
            inputProps={{ 'aria-label': 'Section set' }}
            SelectProps={{ displayEmpty: true, renderValue: v => sets.find(s => s.id === v)?.name ?? placeholder ?? '' }}
            sx={{ minWidth: 110, maxWidth: 200, '& .MuiInputBase-input': { fontSize: 13, py: 0.25 } }}
        >
            {sets.map(s => <MenuItem key={s.id} value={s.id} dense>{s.name}</MenuItem>)}
        </TextField>
    );
};

/**
 * `onExit` left out: no way back to 3D (a section view of the model stays on
 * sections); `onSet`: the set is picked in the bar.
 */
export const SectionBar: React.FC<{ view: SectionViewState; onStep: (n: number) => void; onExit?: () => void; onSet?: (id: string) => void }> = ({ view, onStep, onExit, onSet }) => {
    const [lo, hi] = view.range;
    const count = hi - lo + 1;
    const where = count > 0 && view.index >= lo && view.index <= hi ? `${view.index - lo + 1} of ${count}` : 'outside the data';
    return (
        <Paper elevation={3} sx={barSx}>
            <Tooltip title="Previous section ( [ )"><span><IconButton size="small" aria-label="Previous section" onClick={() => onStep(-1)} disabled={view.index < lo}><ChevronLeft fontSize="small" /></IconButton></span></Tooltip>
            <Box sx={{ textAlign: 'center', minWidth: 120 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.2 }} data-testid="section-label">{view.label}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2 }}>
                    {onSet ? where : `${view.set.name} · ${where}`}
                </Typography>
            </Box>
            <Tooltip title="Next section ( ] )"><span><IconButton size="small" aria-label="Next section" onClick={() => onStep(1)} disabled={view.index > hi}><ChevronRight fontSize="small" /></IconButton></span></Tooltip>
            {onSet && <SetSelect value={view.set.id} onPick={onSet} />}
            <CopyLinesHere view={view} />
            {onExit && <Button size="small" startIcon={<ThreeDRotation fontSize="small" />} onClick={onExit} sx={{ textTransform: 'none', ml: 0.5, flexShrink: 0 }}>Back to 3D</Button>}
        </Paper>
    );
};

/**
 * A section view not on a section (just opened with no set yet, or its slice
 * turned off): pick a set to look along, or make one.
 */
export const SectionPicker: React.FC<{ onLook: (id: string) => void; onNew: (from: 'slice' | PresetKind) => boolean; canSlice: boolean }> = ({ onLook, onNew, canSlice }) => {
    const sets = useModelStore(s => s.scene.sectionSets) ?? [];
    return (
        <Paper elevation={3} sx={barSx} data-testid="section-picker">
            <Typography variant="body2" sx={{ mr: 0.5 }}>{sets.length ? 'Look along' : 'No section sets yet. New set:'}</Typography>
            {sets.length > 0 && <SetSelect value="" onPick={onLook} placeholder="a section set" />}
            {sets.length > 0 && <Typography variant="body2" color="text.secondary" sx={{ mx: 0.5 }}>or a new set:</Typography>}
            {(['we', 'sn', 'level'] as const).map(k => (
                <Button key={k} size="small" onClick={() => onNew(k)} sx={{ textTransform: 'none', minWidth: 0 }}>{NEW_SET_LABEL[k]}</Button>
            ))}
            {canSlice && <Button size="small" onClick={() => onNew('slice')} sx={{ textTransform: 'none', minWidth: 0 }}>From the slice</Button>}
        </Paper>
    );
};

const NEW_SET_LABEL: Record<'we' | 'sn' | 'level', string> = { we: 'W-E', sn: 'S-N', level: 'Level' };

/** A bar of a round length, kept up to date as the view zooms */
export const ScaleBar: React.FC<{ viewport: ThreeViewport | null; vex: number }> = ({ viewport, vex }) => {
    const [ppm, setPpm] = useState(0);
    useEffect(() => {
        if (!viewport) return;
        const read = () => setPpm(viewport.pixelsPerMetre(viewport.viewFocus()));
        read();
        return viewport.addCameraListener(read);
    }, [viewport]);
    const length = scaleBarLength(ppm);
    if (!length) return null;
    const px = length * ppm;
    return (
        <Box sx={{ position: 'absolute', right: 16, bottom: 30, pointerEvents: 'none', textAlign: 'center' }} data-testid="scale-bar">
            <Typography variant="caption" sx={{ display: 'block', lineHeight: 1.2 }}>{formatGrid(length)} m{vex !== 1 ? ` · heights ×${vex}` : ''}</Typography>
            <Box sx={{ width: px, height: 6, border: 1, borderTop: 0, borderColor: 'text.primary' }} />
        </Box>
    );
};
