/**
 * A vein system in the properties (Phase 255): its veins in their order,
 * each with how much ground it holds and how many stretches down the holes
 * are its own, where it stops (at a vein above it in the list, on the side
 * most of its stretches are), and a new vein with no stretches yet. Each
 * vein is a surface fitted on its own: which stretches are its own, its
 * dips and its walls are set in its own properties.
 */
import React from 'react';
import { Box, Button, IconButton, Link, MenuItem, Select, Tooltip, Typography } from '@mui/material';
import { ArrowDownward, ArrowUpward, SwapVert, ViewStream } from '@mui/icons-material';
import { formatVolume } from '../../model/describe';
import { useModelCache } from '../../model/modelCache';
import { keys } from '../../model/objectKeys';
import { addSystemToModel, stopVeinAt, systemInModel } from '../../model/sceneActions';
import type { VeinSystem } from '../../model/types';
import { MAX_SYSTEM_VEINS, mayStopAt, stopsAt } from '../../model/veinSystem';
import { useModelStore } from '../../../store/modelStore';
import { DrillCheckNote } from '../../plots/viewer3d/DrillCheckNote';
import { EditorHeader } from './EditorHeader';
import { Fact } from './parts';
import { smallButton } from './styles';

const NOTHING = '';

export const VeinSystemEditor: React.FC<{ system: VeinSystem; onGoTo: (key: string) => void }> = ({ system, onGoTo }) => {
    const surfaces = useModelStore(s => s.scene.surfaces);
    const models = useModelStore(s => s.scene.models);
    const fits = useModelCache(s => s.byId);
    const store = useModelStore.getState();
    const veins = system.veins.map(id => ({ id, object: surfaces.find(s => s.id === id) ?? null, fit: fits[id] ?? null }));
    const units = veins[0]?.object?.rule.kind === 'body' ? veins[0].object.rule.inside.join(' + ') : '';
    const volumes = veins.map(v => (v.fit?.state === 'ready' ? v.fit.stats?.body?.volume ?? null : null));
    const total = volumes.every(v => v !== null) ? volumes.reduce<number>((a, v) => a + (v ?? 0), 0) : null;
    const move = (id: string, by: -1 | 1) => {
        const at = system.veins.indexOf(id), to = at + by;
        if (at < 0 || to < 0 || to >= system.veins.length) return;
        const order = [...system.veins];
        [order[at], order[to]] = [order[to], order[at]];
        store.updateVeinSystem(system.id, { veins: order });
    };
    const add = () => {
        const id = store.addSystemVein(system.id);
        if (id) onGoTo(keys.surface(id));
    };

    return (
        <Box data-testid="vein-system-editor">
            <EditorHeader
                objectKey={keys.veinSystem(system.id)} name={system.name} what="Vein system" icon={<ViewStream sx={{ fontSize: 18, color: 'text.secondary' }} />}
                visKeys={system.veins.map(v => keys.surface(v))}
            />
            <Fact>
                {`${veins.length === 1 ? 'One vein' : `${veins.length} veins`}${units ? ` of ${units}` : ''}, each built from the stretches down the holes that are its own, and each fitted on its own: changing one builds that one again and no other.`}
            </Fact>

            <Typography variant="subtitle2" sx={{ mt: 1.5 }}>Its veins</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                A vein can be made to stop at one above it in this list: it is then only on one side of that vein, and runs into it.
            </Typography>
            <Box data-testid="system-veins" sx={{ mt: 0.5 }}>
                {veins.map((v, i) => {
                    const o = v.object;
                    const picks = o?.rule.kind === 'body' ? o.rule.vein?.picks?.length ?? null : null;
                    const volume = volumes[i];
                    const state = !o ? 'It is no longer in the project.'
                        : v.fit?.state === 'fitting' ? 'Being fitted…'
                            : v.fit?.state === 'failed' ? 'It could not be fitted.'
                                : picks === 0 ? 'No stretches yet: give it some from its properties, or by a click in the view.'
                                    : `${picks === null ? '' : `${picks.toLocaleString()} ${picks === 1 ? 'stretch' : 'stretches'}`}${volume !== null && volume > 0 ? `${picks === null ? '' : ' · '}${formatVolume(volume)}` : v.fit ? '' : ' · not fitted yet'}`;
                    const may = mayStopAt(system, v.id);
                    const stop = o ? stopsAt(o) : null;
                    const side = o?.rule.kind === 'body' ? o.rule.vein?.endsOn?.side ?? 1 : 1;
                    return (
                        <Box key={v.id} data-vein={v.id} sx={{ py: 0.5, borderTop: i > 0 ? 1 : 0, borderColor: 'divider' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                <Box component="span" sx={{ width: 10, height: 10, flexShrink: 0, borderRadius: '50%', bgcolor: o?.color ?? '#9e9e9e' }} />
                                <Link component="button" type="button" variant="body2" data-action="go-vein" onClick={() => onGoTo(keys.surface(v.id))} sx={{ textAlign: 'left', flex: 1, minWidth: 0 }}>
                                    {o?.name ?? 'A vein'}
                                </Link>
                                <Tooltip title="Up the order"><span>
                                    <IconButton size="small" aria-label={`Move ${o?.name ?? 'it'} up`} disabled={i === 0} onClick={() => move(v.id, -1)}><ArrowUpward sx={{ fontSize: 16 }} /></IconButton>
                                </span></Tooltip>
                                <Tooltip title="Down the order"><span>
                                    <IconButton size="small" aria-label={`Move ${o?.name ?? 'it'} down`} disabled={i === veins.length - 1} onClick={() => move(v.id, 1)}><ArrowDownward sx={{ fontSize: 16 }} /></IconButton>
                                </span></Tooltip>
                            </Box>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 2.25 }}>{state}</Typography>
                            {o && may.length > 0 && (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, ml: 2.25, mt: 0.25 }}>
                                    <Typography variant="caption" sx={{ flexShrink: 0 }}>Stops at</Typography>
                                    <Select
                                        size="small" variant="standard" displayEmpty value={stop && may.includes(stop) ? stop : NOTHING} disabled={!!o.locked}
                                        onChange={e => { stopVeinAt(v.id, e.target.value || null); }}
                                        inputProps={{ 'aria-label': `${o.name} stops at` }} sx={{ fontSize: 13, flex: 1, minWidth: 0 }}
                                    >
                                        <MenuItem value={NOTHING}>Nothing</MenuItem>
                                        {may.map(id => <MenuItem key={id} value={id}>{surfaces.find(s => s.id === id)?.name ?? id}</MenuItem>)}
                                    </Select>
                                    {stop && may.includes(stop) && (
                                        <Tooltip title="It is on the side of that vein most of its stretches are on. This puts it on the other side.">
                                            <IconButton size="small" aria-label={`Put ${o.name} on the other side`} disabled={!!o.locked} onClick={() => { store.setVeinStop(v.id, { surface: stop, side: side === 1 ? -1 : 1 }); }}>
                                                <SwapVert sx={{ fontSize: 16 }} />
                                            </IconButton>
                                        </Tooltip>
                                    )}
                                </Box>
                            )}
                        </Box>
                    );
                })}
            </Box>
            {total !== null && veins.length > 1 && (
                <Typography data-testid="system-volume" variant="caption" sx={{ display: 'block', mt: 0.5 }}>All of them together: {formatVolume(total)}.</Typography>
            )}
            <Tooltip title="A new vein made as the first is, with no stretches of its own yet. Give it stretches from its properties (Its stretches), or by a click on them in the view.">
                <span>
                    <Button size="small" variant="outlined" data-action="add-vein" disabled={veins.length >= MAX_SYSTEM_VEINS} sx={{ ...smallButton, mt: 0.75 }} onClick={add}>Add a vein</Button>
                </span>
            </Tooltip>

            {veins.length > 0 && (
                <Box sx={{ mt: 1.5 }}>
                    <Typography variant="subtitle2">Against the drilling</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Its veins taken together: every one is fitted again without the holes left out.</Typography>
                    <DrillCheckNote target={{ kind: 'system', id: system.id }} surfaceId={veins[0].id} onGoTo={onGoTo} />
                </Box>
            )}

            {(models?.length ?? 0) > 0 && (
                <Box data-testid="system-models" sx={{ mt: 1.5 }}>
                    <Typography variant="subtitle2">In a geological model</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        There its veins are one unit that cuts through what is older. Each stops at the model's faults, its boundary and its younger units, and what it holds is taken out of the unit it is in.
                    </Typography>
                    {models!.map(m => {
                        const has = systemInModel({ models }, m.id, system);
                        return (
                            <Box key={m.id} data-model={m.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.5 }}>
                                <Link component="button" type="button" variant="body2" onClick={() => onGoTo(keys.model(m.id))} sx={{ textAlign: 'left', flexShrink: 0 }}>{m.name}</Link>
                                <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>
                                    {has.state === 'all' ? `has it, as ${has.unit}` : has.state === 'some' ? `has some of its veins, as ${has.unit}` : 'does not have it'}
                                </Typography>
                                {has.state !== 'all' && (
                                    <Button size="small" variant="outlined" data-action="add-to-model" sx={smallButton} onClick={() => { addSystemToModel(m.id, system.id); }}>
                                        {has.state === 'some' ? 'Add the rest' : 'Add it'}
                                    </Button>
                                )}
                            </Box>
                        );
                    })}
                </Box>
            )}
        </Box>
    );
};
