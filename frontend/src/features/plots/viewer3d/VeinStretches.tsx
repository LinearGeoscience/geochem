/**
 * For a vein that is one of several its units make (features/model/veinSet):
 * the stretches of those units down the holes, and which of the veins each
 * is of. A stretch is given to another vein, to this one, or to none, from
 * the list or by clicking it in the view; the veins that change are built
 * again, each from its own stretches, as one step back.
 *
 * One wall only of a stretch (hangingwall or footwall) is said among the
 * vein's contacts one by one, above: leave the other wall's contact out.
 */
import React, { useMemo, useState } from 'react';
import { Box, Button, Collapse, IconButton, MenuItem, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import { CenterFocusStrong, ExpandLess, ExpandMore } from '@mui/icons-material';
import { useModelStore } from '../../../store/modelStore';
import type { ContactInputs } from '../../model/contacts';
import { zonesOf } from '../../model/lodes';
import { setInputsFor } from '../../model/modelCache';
import { giveStretchTo, unitsLabel } from '../../model/sceneActions';
import { plain } from '../../model/terms';
import type { BodyRule, SurfaceObject, Vec3 } from '../../model/types';
import { lodeRule, stretchDepths, stretchOwners, veinsOfSet } from '../../model/veinSet';

/** At most this many stretches are listed at once: type part of a hole's name for the rest */
const MAX_ROWS = 60;
const NONE = '-';

interface Props {
    surface: SurfaceObject;
    /** What the logging gives this vein, from its own stretches */
    found: ContactInputs;
    /** The view acted in shows the scene's coordinates: stretches can be clicked in it */
    here: boolean;
    /** Bring a place into view (absent: no view to do it in) */
    onZoom?: (p: Vec3) => void;
}

export const VeinStretches: React.FC<Props> = ({ surface, found, here, onZoom }) => {
    const surfaces = useModelStore(s => s.scene.surfaces);
    const taking = useModelStore(s => s.editingId === surface.id && s.marking === 'take');
    const [open, setOpen] = useState(false);
    const [filter, setFilter] = useState('');
    const [show, setShow] = useState<'own' | 'none' | 'all'>('own');
    const rule = lodeRule(surface.rule);
    const veins = useMemo(() => veinsOfSet(surfaces, surface), [surfaces, surface]);
    // (Every stretch of its units: remembered with the logging, so the same until that changes)
    const all = rule ? setInputsFor(surface) : null;
    const zones = useMemo(() => (all ? zonesOf(all) : []), [all]);
    const owners = useMemo(() => stretchOwners(zones, veins), [zones, veins]);
    const rows = useMemo(() => {
        const f = filter.trim().toLowerCase();
        const order = zones.map((_, i) => i).filter(i => (show === 'all' || (show === 'own' ? owners[i] === surface.id : owners[i] === null)) && (!f || zones[i].hole.toLowerCase().includes(f)));
        return order.sort((a, b) => zones[a].hole.localeCompare(zones[b].hole, undefined, { numeric: true }) || zones[a].from - zones[b].from);
    }, [zones, owners, filter, show, surface.id]);
    if (!rule) return null;

    const own = owners.filter(o => o === surface.id).length, loose = owners.filter(o => o === null).length;
    const stale = found.stale.picks ?? [];
    const forget = () => {
        const gone = new Set(stale.map(p => `${p.hole}:${p.depth}`));
        const next: BodyRule = { ...rule, vein: { ...rule.vein, picks: rule.vein.picks.filter(p => !gone.has(`${p.hole}:${p.depth}`)) } };
        useModelStore.getState().updateSurface(surface.id, { rule: next });
    };
    const units = unitsLabel(rule.inside);

    return (
        <Box data-testid="vein-stretches" sx={{ mt: 0.75 }}>
            <Button
                size="small" fullWidth onClick={() => setOpen(o => !o)} aria-expanded={open} title={plain('veinStretch')}
                endIcon={open ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                sx={{ textTransform: 'none', justifyContent: 'space-between', py: 0, fontSize: 12, color: 'text.primary' }}
            >
                Its stretches of {units} ({own.toLocaleString()} of {zones.length.toLocaleString()})
            </Button>
            <Typography data-testid="vein-stretches-summary" variant="caption" color="text.secondary" sx={{ display: 'block', pl: 0.5 }}>
                One of {veins.length} vein{veins.length === 1 ? '' : 's'} made of {units}{loose > 0 ? ` · ${loose.toLocaleString()} stretch${loose === 1 ? ' is' : 'es are'} in none of them` : ''}
            </Typography>
            {stale.length > 0 && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pl: 0.5 }}>
                    <Typography data-testid="vein-stretches-stale" variant="caption" color="warning.main" sx={{ flex: 1, minWidth: 0 }}>
                        {stale.length.toLocaleString()} of its stretches {stale.length === 1 ? 'is' : 'are'} not in the logging now ({stale.slice(0, 3).map(p => p.hole).join(', ')}{stale.length > 3 ? ', ...' : ''}).
                    </Typography>
                    <Button size="small" sx={{ minWidth: 0, px: 0.75, py: 0, fontSize: 12, textTransform: 'none' }} onClick={forget}>Forget {stale.length === 1 ? 'it' : 'them'}</Button>
                </Box>
            )}
            <Collapse in={open} unmountOnExit>
                <Box sx={{ pl: 0.5 }}>
                    <Tooltip title={!here ? 'This view shows other coordinate columns than the vein was built in' : 'Then click stretches of its units down the holes in the view: each becomes this vein\'s, and is taken from the vein that had it. Esc when done.'}>
                        <span>
                            <ToggleButton
                                size="small" fullWidth value="take" selected={taking} disabled={!here}
                                onChange={() => useModelStore.getState().setMarking(taking ? null : 'take')}
                                aria-label="Click stretches in the view to make them this vein's"
                                sx={{ textTransform: 'none', py: 0, px: 0.5, fontSize: 11.5, mt: 0.5 }}
                            >
                                Click stretches in the view to make them this vein&apos;s
                            </ToggleButton>
                        </span>
                    </Tooltip>
                    <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5, mt: 0.5 }}>
                        <ToggleButtonGroup size="small" exclusive value={show} onChange={(_, v) => { if (v) setShow(v); }} aria-label="Which stretches are listed">
                            <ToggleButton value="own" sx={{ textTransform: 'none', py: 0, px: 0.75, fontSize: 11.5 }}>Its own</ToggleButton>
                            <ToggleButton value="none" sx={{ textTransform: 'none', py: 0, px: 0.75, fontSize: 11.5 }}>In none</ToggleButton>
                            <ToggleButton value="all" sx={{ textTransform: 'none', py: 0, px: 0.75, fontSize: 11.5 }}>All</ToggleButton>
                        </ToggleButtonGroup>
                        <TextField
                            size="small" variant="standard" placeholder="Find a hole" value={filter} onChange={e => setFilter(e.target.value)} sx={{ flex: 1, minWidth: 0 }}
                            inputProps={{ 'aria-label': 'Find a hole among the stretches', spellCheck: false, autoComplete: 'off', style: { fontSize: 12 } }}
                        />
                    </Box>
                    {rows.slice(0, MAX_ROWS).map(i => {
                        const z = zones[i];
                        const where = `the stretch in ${z.hole}, ${stretchDepths(z)}`;
                        return (
                            <Box key={`${z.hole}:${z.inside}`} data-testid="stretch-row" sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                                <Typography variant="caption" noWrap sx={{ flex: 1, minWidth: 0 }} title={`${z.hole} · ${stretchDepths(z)}`}>
                                    {z.hole}<Box component="span" sx={{ color: 'text.secondary' }}> · {stretchDepths(z)}</Box>
                                </Typography>
                                <TextField
                                    select size="small" variant="standard" value={owners[i] ?? NONE} sx={{ width: 104, flexShrink: 0 }}
                                    onChange={e => giveStretchTo(surface, z, e.target.value === NONE ? null : e.target.value)}
                                    SelectProps={{
                                        // (Its name alone in the row: "this one" is said in the list)
                                        renderValue: value => (value === NONE ? 'None' : veins.find(v => v.id === value)?.name ?? ''),
                                        SelectDisplayProps: { 'aria-label': `The vein of ${where}`, style: { fontSize: 12, paddingTop: 0, paddingBottom: 0 } } as React.HTMLAttributes<HTMLDivElement>,
                                    }}
                                >
                                    {veins.map(v => <MenuItem key={v.id} dense value={v.id}>{v.name}{v.id === surface.id ? ' (this one)' : ''}</MenuItem>)}
                                    <MenuItem dense value={NONE}>None of them</MenuItem>
                                </TextField>
                                {onZoom && (
                                    <Tooltip title="Bring it into view">
                                        <IconButton size="small" aria-label={`Show ${where}`} onClick={() => onZoom(z.p)}><CenterFocusStrong sx={{ fontSize: 16 }} /></IconButton>
                                    </Tooltip>
                                )}
                            </Box>
                        );
                    })}
                    {rows.length > MAX_ROWS && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            {(rows.length - MAX_ROWS).toLocaleString()} more: type part of a hole&apos;s name above to find them.
                        </Typography>
                    )}
                    {rows.length === 0 && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            {filter.trim() ? 'No stretch in a hole of that name.' : show === 'none' ? 'Every stretch is in one of the veins.' : 'None.'}
                        </Typography>
                    )}
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                        For one wall only of a stretch, leave the contact of its other wall out, among its contacts one by one above.
                    </Typography>
                </Box>
            </Collapse>
        </Box>
    );
};
