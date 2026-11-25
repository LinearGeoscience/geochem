/**
 * The Views button and its list (Phase 231): the scene's named views. A named
 * view is a way of looking at the scene that is kept with the project: where
 * the camera is, the vertical exaggeration, and the slices that were on. Any
 * 3D view lists the same ones and can go to any of them.
 */
import React, { useState } from 'react';
import { Box, Button, Divider, IconButton, Popover, Stack, TextField, ToggleButton, Tooltip, Typography } from '@mui/material';
import { Bookmarks, DeleteOutline, Update } from '@mui/icons-material';
import { useModelStore } from '../../../store/modelStore';
import { MAX_SAVED_VIEWS } from '../../model/savedViews';

export interface ViewsMenuProps {
    disabled: boolean;
    /** Keep the view as it is now under this name (empty: named for the way it looks) */
    onSave: (name: string) => void;
    /** Go to a kept view */
    onGo: (id: string) => void;
    /** Put the view as it is now in a kept view's place */
    onReplace: (id: string) => void;
}

export const ViewsMenu: React.FC<ViewsMenuProps> = ({ disabled, onSave, onGo, onReplace }) => {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const [name, setName] = useState('');
    const views = useModelStore(s => s.scene.views) ?? [];
    const update = useModelStore(s => s.updateView);
    const remove = useModelStore(s => s.removeView);
    const full = views.length >= MAX_SAVED_VIEWS;
    const save = () => { onSave(name); setName(''); };
    return (
        <>
            <ToggleButton size="small" value="views" data-action="views" selected={!!anchor} disabled={disabled} onChange={e => setAnchor(e.currentTarget as HTMLElement)} sx={{ textTransform: 'none', gap: 0.5 }}>
                <Tooltip title="Named views: keep this way of looking at the scene, and go back to it later">
                    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}><Bookmarks fontSize="small" />Views{views.length > 0 ? ` (${views.length})` : ''}</Box>
                </Tooltip>
            </ToggleButton>
            <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
                <Box sx={{ p: 1.5, width: 400 }} data-testid="views-menu">
                    <Typography variant="subtitle2" gutterBottom>Named views</Typography>
                    {views.length === 0 && (
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                            None yet. A named view keeps where you are looking from, the vertical exaggeration and the slices that are on. It is kept with the project, and any 3D view can go to it.
                        </Typography>
                    )}
                    <Stack spacing={0.75} sx={{ mb: 1 }}>
                        {views.map(v => (
                            <Stack key={v.id} direction="row" alignItems="center" spacing={0.5} data-view={v.id}>
                                <TextField
                                    size="small" variant="standard" defaultValue={v.name} key={v.name} sx={{ flex: 1 }}
                                    inputProps={{ 'aria-label': 'View name' }}
                                    onBlur={e => update(v.id, { name: e.target.value })}
                                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                />
                                <Button size="small" variant="outlined" data-action="go-view" onClick={() => { onGo(v.id); setAnchor(null); }} sx={{ textTransform: 'none' }}>Go to</Button>
                                <Tooltip title="Keep the view as it is now under this name, in place of what was kept">
                                    <IconButton size="small" data-action="replace-view" aria-label={`Keep this view as ${v.name}`} onClick={() => onReplace(v.id)}><Update fontSize="small" /></IconButton>
                                </Tooltip>
                                <Tooltip title="Remove this named view (Undo brings it back)">
                                    <IconButton size="small" data-action="remove-view" aria-label={`Remove ${v.name}`} onClick={() => remove(v.id)}><DeleteOutline fontSize="small" /></IconButton>
                                </Tooltip>
                            </Stack>
                        ))}
                    </Stack>
                    <Divider sx={{ my: 1 }} />
                    <Stack direction="row" alignItems="center" spacing={1}>
                        <TextField
                            size="small" label="Name" placeholder="named for the way it looks" value={name} sx={{ flex: 1 }} disabled={full}
                            inputProps={{ 'aria-label': 'Name of the new view' }}
                            onChange={e => setName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && !full) save(); }}
                        />
                        <Tooltip title={full ? `There are ${MAX_SAVED_VIEWS} named views: remove one first` : ''}>
                            <span><Button size="small" variant="contained" data-action="save-view" disabled={full} onClick={save} sx={{ textTransform: 'none' }}>Keep this view</Button></span>
                        </Tooltip>
                    </Stack>
                </Box>
            </Popover>
        </>
    );
};
