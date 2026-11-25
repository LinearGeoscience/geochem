/**
 * The Units button of a 3D view: give the samples selected in the view (lasso
 * or box, in 3D or in a section) to a model unit, and open the model units
 * (UnitsDialog). What is given is kept by hole and depth, so it moves the
 * contacts of every surface that reads the units.
 */
import React, { useState } from 'react';
import { Box, Button, Divider, ListItemText, ListSubheader, Menu, MenuItem, Snackbar, Tooltip } from '@mui/material';
import { ArrowDropDown, ViewStream } from '@mui/icons-material';
import { useModelStore } from '../../../store/modelStore';
import type { SceneCoords } from '../../model/types';
import { reassignRows } from '../../model/unitActions';
import { UnitsDialog } from './UnitsDialog';

interface Props {
    disabled?: boolean;
    /** The view's coordinate, hole and depth columns */
    coords: SceneCoords | null;
    /** The samples selected in the view (rows of the dataset) */
    selected: readonly number[];
}

export const UnitsMenu: React.FC<Props> = ({ disabled, coords, selected }) => {
    const maps = useModelStore(s => s.scene.unitMaps) ?? [];
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const [giveFrom, setGiveFrom] = useState<{ el: HTMLElement; map: string } | null>(null);
    const [dialog, setDialog] = useState<string | null | false>(false);
    const [note, setNote] = useState<string | null>(null);
    const n = selected.length;
    const giving = giveFrom ? maps.find(m => m.id === giveFrom.map) ?? null : null;

    const give = (unit: string | null) => {
        if (!giving) return;
        const stretches = reassignRows(coords, giving.id, selected, unit);
        setGiveFrom(null);
        setAnchor(null);
        const what = `${n.toLocaleString()} sample${n === 1 ? '' : 's'}`;
        setNote(stretches === 0 ? 'The selected samples are in no hole: nothing was given.'
            : unit === null ? `${what} put back as logged (Ctrl+Z undoes it).`
                : `${what} given to ${unit || 'not logged'} in ${stretches.toLocaleString()} stretch${stretches === 1 ? '' : 'es'} of hole (Ctrl+Z undoes it).`);
    };

    return (
        <>
            <Tooltip title="Lithologies: group logged codes into units, and give selected samples to a unit">
                <span>
                    <Button size="small" disabled={disabled} onClick={e => setAnchor(e.currentTarget)} sx={{ textTransform: 'none', gap: 0.5 }} aria-label="Units">
                        <ViewStream fontSize="small" />Units<ArrowDropDown fontSize="small" />
                    </Button>
                </span>
            </Tooltip>
            <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
                {maps.flatMap(m => [
                    <ListSubheader key={`h-${m.id}`} sx={{ lineHeight: '32px' }}>{m.name}</ListSubheader>,
                    <MenuItem key={`g-${m.id}`} dense disabled={n === 0} onClick={e => setGiveFrom({ el: e.currentTarget, map: m.id })}>
                        <ListItemText primary="Give the selected samples to…" secondary={n === 0 ? 'Select samples first (lasso or box)' : `${n.toLocaleString()} selected`} />
                    </MenuItem>,
                    <MenuItem key={`e-${m.id}`} dense onClick={() => { setAnchor(null); setDialog(m.id); }}>Group, split and colour the units…</MenuItem>,
                ])}
                {maps.length > 0 && <Divider />}
                <MenuItem dense onClick={() => { setAnchor(null); setDialog(maps.length ? 'new' : null); }}>New units from logging…</MenuItem>
            </Menu>
            <Menu anchorEl={giveFrom?.el} open={!!giving} onClose={() => setGiveFrom(null)} anchorOrigin={{ vertical: 'top', horizontal: 'right' }}>
                {giving?.units.map(u => (
                    <MenuItem key={u.name} dense onClick={() => give(u.name)}>
                        <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: u.color, mr: 1, flexShrink: 0 }} />
                        {u.name}
                    </MenuItem>
                ))}
                {giving && <Divider />}
                {giving && <MenuItem dense onClick={() => give('')}>Not logged (left out)</MenuItem>}
                {giving && <MenuItem dense onClick={() => give(null)}>Back as logged</MenuItem>}
            </Menu>
            <UnitsDialog open={dialog !== false} coords={coords} mapId={dialog || null} onClose={() => setDialog(false)} />
            <Snackbar open={!!note} autoHideDuration={5000} onClose={() => setNote(null)} message={note} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} />
        </>
    );
};
