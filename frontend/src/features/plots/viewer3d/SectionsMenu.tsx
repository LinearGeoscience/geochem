/**
 * The Sections button and its list: the scene's section sets (each can be
 * looked at, renamed, re-spaced, widened or removed) and the ways to make a
 * new one (from the active slice, or W-E / S-N / level through the middle of
 * the data). Sets belong to the scene: every 3D view lists the same ones.
 */
import React, { useState } from 'react';
import { Box, Button, Divider, IconButton, Popover, Stack, TextField, ToggleButton, Tooltip, Typography } from '@mui/material';
import { DeleteOutline, Visibility, ViewDay } from '@mui/icons-material';
import { useModelStore } from '../../../store/modelStore';
import { requestDelete } from '../../model/deleteObjects';
import { keys } from '../../model/objectKeys';
import { describeSectionSet } from '../../model/sectionSets';
import type { PresetKind } from './slices';

/** A number box that commits on Enter or when left; Esc puts the old value back */
export const Num: React.FC<{ label: string; value: number; onCommit: (v: number) => void }> = ({ label, value, onCommit }) => {
    const [text, setText] = useState<string | null>(null);
    const commit = () => {
        if (text !== null) {
            const v = Number(text.replace(/[,\s]/g, ''));
            if (Number.isFinite(v) && v > 0) onCommit(v);
        }
        setText(null);
    };
    return (
        <TextField
            size="small" label={label} value={text ?? String(value)} sx={{ width: 84 }}
            inputProps={{ 'aria-label': label, inputMode: 'decimal' }}
            onChange={e => setText(e.target.value)} onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); } else if (e.key === 'Escape') { setText(null); e.stopPropagation(); } }}
        />
    );
};

export interface SectionsMenuProps {
    disabled: boolean;
    /** The set this view is looking at */
    viewing: string | null;
    canFromSlice: boolean;
    onView: (setId: string) => void;
    onCreate: (from: 'slice' | PresetKind) => void;
}

export const SectionsMenu: React.FC<SectionsMenuProps> = ({ disabled, viewing, canFromSlice, onView, onCreate }) => {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const sets = useModelStore(s => s.scene.sectionSets) ?? [];
    const update = useModelStore(s => s.updateSectionSet);
    const remove = (id: string) => requestDelete([keys.sectionSet(id)]);
    const make = (from: 'slice' | PresetKind) => { onCreate(from); setAnchor(null); };
    return (
        <>
            <ToggleButton size="small" value="sections" selected={!!viewing || !!anchor} disabled={disabled} onChange={e => setAnchor(e.currentTarget as HTMLElement)} sx={{ textTransform: 'none', gap: 0.5 }}>
                <Tooltip title="Sections: sets of evenly spaced sections or plans, to look at square-on and draw on">
                    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}><ViewDay fontSize="small" />Sections{sets.length > 0 ? ` (${sets.length})` : ''}</Box>
                </Tooltip>
            </ToggleButton>
            <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
                <Box sx={{ p: 1.5, width: 420 }}>
                    <Typography variant="subtitle2" gutterBottom>Section sets</Typography>
                    {sets.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>None yet. A set is a series of parallel sections or plans: step through them square-on, and draw lines on each.</Typography>}
                    <Stack spacing={1.25} sx={{ mb: 1 }}>
                        {sets.map(s => (
                            <Box key={s.id} sx={{ border: 1, borderColor: s.id === viewing ? 'primary.main' : 'divider', borderRadius: 1, p: 1 }}>
                                <Stack direction="row" alignItems="center" spacing={1}>
                                    <TextField
                                        size="small" variant="standard" defaultValue={s.name} key={s.name} sx={{ flex: 1 }}
                                        inputProps={{ 'aria-label': 'Set name' }}
                                        onBlur={e => update(s.id, { name: e.target.value })}
                                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                    />
                                    <Button size="small" variant={s.id === viewing ? 'contained' : 'outlined'} startIcon={<Visibility fontSize="small" />} onClick={() => { onView(s.id); setAnchor(null); }} sx={{ textTransform: 'none' }}>
                                        Look along
                                    </Button>
                                    <Tooltip title="Remove the set (lines drawn on it are kept)"><IconButton size="small" aria-label={`Remove ${s.name}`} onClick={() => remove(s.id)}><DeleteOutline fontSize="small" /></IconButton></Tooltip>
                                </Stack>
                                <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1 }}>
                                    <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>{describeSectionSet(s)}</Typography>
                                    <Num label="Spacing (m)" value={s.spacing} onCommit={v => update(s.id, { spacing: v })} />
                                    <Num label="Width (m)" value={s.width} onCommit={v => update(s.id, { width: v })} />
                                </Stack>
                            </Box>
                        ))}
                    </Stack>
                    <Divider sx={{ my: 1 }} />
                    <Typography variant="caption" color="text.secondary">New set</Typography>
                    <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: 'wrap' }} useFlexGap>
                        <Tooltip title={canFromSlice ? 'Planes parallel to the active slice, spaced at its step' : 'Turn on a slice first'}>
                            <span><Button size="small" variant="outlined" disabled={!canFromSlice} onClick={() => make('slice')} sx={{ textTransform: 'none' }}>From the slice</Button></span>
                        </Tooltip>
                        <Button size="small" variant="outlined" onClick={() => make('we')} sx={{ textTransform: 'none' }}>W-E sections</Button>
                        <Button size="small" variant="outlined" onClick={() => make('sn')} sx={{ textTransform: 'none' }}>S-N sections</Button>
                        <Button size="small" variant="outlined" onClick={() => make('level')} sx={{ textTransform: 'none' }}>Level plans</Button>
                    </Stack>
                </Box>
            </Popover>
        </>
    );
};
