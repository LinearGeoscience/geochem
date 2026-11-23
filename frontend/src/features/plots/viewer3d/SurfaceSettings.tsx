/**
 * How a surface is fitted and kept, in its properties: what it passes
 * through exactly (everything, only what is on drillholes, nothing), the
 * surface it runs alongside and never crosses, how much each set it uses
 * counts for, the size of its mesh's cells, locking it
 * as it is, and copying it as a version to keep.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Box, Button, MenuItem, TextField, Tooltip, Typography } from '@mui/material';
import { useModelStore } from '../../../store/modelStore';
import { formatMetres } from '../../model/describe';
import { modelUnits } from '../../model/geoModel';
import { solidStates, useModelCache } from '../../model/modelCache';
import { pickSpread } from '../../model/readings';
import { thicknessBetween } from '../../model/thickness';
import type { SurfaceObject, SurfaceSnap } from '../../model/types';
import { domainText, isSolids, solidChoices, solidStateNote, solidsText, takesDomain, unitDomain } from '../../model/shellDomains';
import { t, termProps } from '../../model/terms';
import { Term } from '../../modelling/Term';

const smallButton = { minWidth: 0, px: 0.75, py: 0, height: 24, fontSize: 12, textTransform: 'none' } as const;
const label = { display: 'block', mt: 1, color: 'text.secondary' } as const;

const SNAP: { value: SurfaceSnap; text: string; tip: string }[] = [
    { value: 'all', text: 'Everything', tip: 'Every contact, point and line, as closely as “Smoothing” says' },
    { value: 'holes', text: 'Only what is on drillholes', tip: 'Its contacts and the points placed on drillholes are passed through as before; points and lines placed off the holes are a guide, followed loosely' },
    { value: 'none', text: 'Nothing: all of it loosely', tip: 'Everything is a guide: the surface is smooth and passes near its contacts, points and lines' },
];

/** The thickness between two surfaces is measured at this many places at most */
const THICKNESS_PLACES = 300;

const NO_DOMAIN = '\u0000none';
/** A list value that is a solid of the scene, not a unit of a model */
const SOLID = '\u0000solid';

const WEIGHTS: { value: number; text: string }[] = [
    { value: 1, text: 'In full' }, { value: 0.75, text: 'Three quarters' }, { value: 0.5, text: 'Half' }, { value: 0.25, text: 'A quarter' },
];

interface Props {
    surface: SurfaceObject;
    /** The cell size it was last meshed at, m (null: not known) */
    cell?: number | null;
    /** A copy was made: pick it out */
    onCopied?: (id: string) => void;
}

export const SurfaceSettings: React.FC<Props> = ({ surface, cell = null, onCopied }) => {
    const { updateSurface, setUseWeight, copySurface } = useModelStore.getState();
    const sets = useModelStore(s => s.scene.inputs);
    const sheet = surface.rule.kind === 'sheet' || surface.rule.kind === 'contact';
    const [size, setSize] = useState(surface.params.resolution === null ? '' : String(surface.params.resolution));
    useEffect(() => setSize(surface.params.resolution === null ? '' : String(surface.params.resolution)), [surface.params.resolution]);
    const commitSize = () => {
        const v = Number(size);
        const next = size.trim() !== '' && Number.isFinite(v) && v > 0 ? v : null;
        if (next !== surface.params.resolution) updateSurface(surface.id, { params: { resolution: next } });
        else setSize(surface.params.resolution === null ? '' : String(surface.params.resolution));
    };
    const used = (surface.uses ?? []).map(u => ({ use: u, set: sets?.find(s => s.id === u.set) })).filter(u => u.set && (u.set.kind === 'points' ? u.set.points.length : u.set.lines.length) > 0);
    const snap = surface.params.snap ?? 'all';
    // What it can run alongside: the other surfaces of its kind that do not, in turn, run alongside it
    const all = useModelStore(s => s.scene.surfaces);
    const others = sheet ? all.filter(o => {
        // (A model's part of a surface in one fault block is not chosen: the surface it is a part of is)
        if (o.blockOf) return false;
        if (o.id === surface.id || (o.rule.kind !== 'sheet' && o.rule.kind !== 'contact')) return false;
        const seen = new Set<string>();
        for (let at: SurfaceObject | undefined = o; at && !seen.has(at.id); at = at.conform ? all.find(x => x.id === at!.conform!.surface) : undefined) {
            if (at.id === surface.id) return false;
            seen.add(at.id);
        }
        return true;
    }) : [];
    const alongside = surface.conform && others.some(o => o.id === surface.conform!.surface) ? surface.conform.surface : '';
    const bare = surface.rule.kind === 'sheet' && surface.points.length === 0 && surface.polylines.length === 0;
    // How thick the ground between it and the one it runs alongside is, once both are fitted
    const mine = useModelCache(s => s.byId[surface.id]);
    const theirs = useModelCache(s => (alongside ? s.byId[alongside] : undefined));
    const between = useMemo(() => {
        if (!mine?.field || !theirs?.field || mine.state !== 'ready' || !mine.part || mine.part.vertices.length === 0) return null;
        const v = mine.part.vertices;
        const places: number[] = [];
        for (const i of pickSpread(v, THICKNESS_PLACES)) places.push(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);
        return thicknessBetween(theirs.field, places, (mine.stats?.cell ?? 2) / 2);
    }, [mine?.field, mine?.state, mine?.part, mine?.stats?.cell, theirs?.field]);
    const range = (r: { least: number; usual: number; most: number }) => (formatMetres(r.least) === formatMetres(r.most)
        ? formatMetres(r.usual) : `from ${formatMetres(r.least)} to ${formatMetres(r.most)}, usually ${formatMetres(r.usual)}`);
    // A shell can be kept inside one unit of a geological model
    const models = useModelStore(s => s.scene.models);
    const wireframes = useModelStore(s => s.scene.wireframes);
    const surfaces = useModelStore(s => s.scene.surfaces);
    // (... and so can an intrusion built as thin sheets: it stops at the unit's faces)
    const shell = surface.rule.kind === 'shell';
    const homes = !takesDomain(surface.rule) ? [] : (models ?? [])
        .filter(m => !m.contacts.some(c => c.surface === surface.id) && !m.faults?.some(x => x.surface === surface.id))
        .flatMap(m => modelUnits({ surfaces, wireframes }, m).map(unit => ({ value: `${m.id}\u0000${unit}`, text: `${unit}, in ${m.name}` })));
    // (... or inside a solid of the scene: a vein system, a vein, an intrusion, another shell, a closed mesh from a file)
    const veinSystems = useModelStore(s => s.scene.veinSystems);
    const numericModels = useModelStore(s => s.scene.numericModels);
    const siblings = numericModels?.find(n => n.shells.some(x => x.surface === surface.id))?.shells.map(x => x.surface) ?? [surface.id];
    const solidHomes = !takesDomain(surface.rule) ? [] : solidChoices({ surfaces, veinSystems, wireframes }, siblings)
        .map(c => ({ value: `${SOLID}\u0000${c.ref.kind}\u0000${c.ref.id}`, text: `Inside ${c.name} (${c.what})` }));
    const inUnit = unitDomain(surface.domain), inSolids = isSolids(surface.domain) ? surface.domain : null;
    const home = inUnit ? `${inUnit.model}\u0000${inUnit.unit}` : inSolids && inSolids.solids.length === 1 ? `${SOLID}\u0000${inSolids.solids[0].kind}\u0000${inSolids.solids[0].id}` : NO_DOMAIN;
    // (Set in its numeric model, where there is more to it than this list holds: several lithologies, a fault block, several solids)
    const saidOnly = shell && (inUnit ? !!(inUnit.units || inUnit.sides) : !!inSolids && inSolids.solids.length > 1);
    const solidNotes = inSolids ? solidStates(surface).flatMap(s => { const said = solidStateNote(s.name, s.state); return said ? [said] : []; }) : [];
    // A surface a set distance from this one
    const [apart, setApart] = useState('');
    const makeApart = () => {
        const v = Number(apart);
        if (apart.trim() === '' || !Number.isFinite(v) || v === 0) return;
        const store = useModelStore.getState();
        const id = store.addSurface({ name: `${surface.name}, ${Math.abs(v)} m ${v > 0 ? 'on its first side' : 'on its second side'}`, points: [] });
        if (!id) return;
        store.updateSurface(id, { conform: { surface: surface.id, by: v } });
        setApart('');
        onCopied?.(id);
    };
    const [far, setFar] = useState(surface.conform?.by === undefined ? '' : String(surface.conform.by));
    useEffect(() => setFar(surface.conform?.by === undefined ? '' : String(surface.conform.by)), [surface.conform?.by]);
    const commitFar = () => {
        if (!surface.conform) return;
        const v = Number(far);
        const next = far.trim() !== '' && Number.isFinite(v) && v !== 0 ? v : undefined;
        if (next !== surface.conform.by) updateSurface(surface.id, { conform: { surface: surface.conform.surface, ...(next === undefined ? {} : { by: next }) } });
        else setFar(surface.conform.by === undefined ? '' : String(surface.conform.by));
    };

    return (
        <Box data-testid="surface-settings">
            {sheet && (
                <>
                    <Typography variant="caption" sx={label}><Term k="snapToData" /></Typography>
                    <TextField
                        select size="small" variant="standard" fullWidth value={snap}
                        onChange={e => updateSurface(surface.id, { params: { snap: e.target.value === 'all' ? undefined : e.target.value as SurfaceSnap } })}
                        SelectProps={{ SelectDisplayProps: { ...termProps('snapToData'), style: { fontSize: 13 } } as React.HTMLAttributes<HTMLDivElement> }}
                        helperText={SNAP.find(s => s.value === snap)!.tip} FormHelperTextProps={{ sx: { fontSize: 11, lineHeight: 1.3 } }}
                    >
                        {SNAP.map(s => <MenuItem key={s.value} dense value={s.value}>{s.text}</MenuItem>)}
                    </TextField>
                    {(others.length > 0 || surface.conform) && (
                        <>
                            <Typography variant="caption" sx={label}><Term k="conformableTo" /></Typography>
                            <TextField
                                select size="small" variant="standard" fullWidth value={alongside}
                                onChange={e => updateSurface(surface.id, { conform: e.target.value ? { surface: e.target.value } : null })}
                                SelectProps={{ displayEmpty: true, SelectDisplayProps: { ...termProps('conformableTo'), style: { fontSize: 13 } } as React.HTMLAttributes<HTMLDivElement> }}
                                helperText={alongside
                                    ? 'How far it is from that surface is read at its own contacts, points and lines and carried between them. It takes that surface’s shape, and the two cannot cross: where they come together, the ground between them pinches out.'
                                    : 'For layers of one sequence: a surface that is conformable to another takes its shape between the holes, and the two cannot cross.'}
                                FormHelperTextProps={{ sx: { fontSize: 11, lineHeight: 1.3 } }}
                            >
                                <MenuItem dense value="">Nothing: it is fitted on its own</MenuItem>
                                {others.map(o => <MenuItem key={o.id} dense value={o.id}>{o.name}</MenuItem>)}
                            </TextField>
                            {alongside && between?.square && (
                                <Typography data-testid="between-thickness" variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                                    {`The ground between the two is ${range(between.square)} thick, the shortest way across${between.vertical ? `; straight up and down, ${range(between.vertical)}` : ''}.`}
                                </Typography>
                            )}
                            {alongside && bare && (
                                <Tooltip title="With no points of its own, the surface is this far from the one it is conformable to, everywhere. A minus puts it on that surface’s second side.">
                                    <TextField
                                        size="small" variant="standard" label="How far from it (m)" value={far} placeholder="e.g. 25 or -25" fullWidth
                                        onChange={e => setFar(e.target.value)} onBlur={commitFar} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLElement).blur(); }}
                                        sx={{ mt: 0.75 }} InputLabelProps={{ shrink: true }} inputProps={{ inputMode: 'decimal', 'aria-label': 'How far from it (m)', style: { fontSize: 13 } }}
                                    />
                                </Tooltip>
                            )}
                        </>
                    )}
                    {used.length > 0 && (
                        <>
                            <Typography variant="caption" sx={label}>How much each of its sets counts for</Typography>
                            {used.map(({ use, set }) => (
                                <Box key={use.set} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: set!.color, flexShrink: 0 }} />
                                    <Typography variant="caption" noWrap sx={{ flex: 1, minWidth: 0 }} title={set!.name}>{set!.name}</Typography>
                                    <Tooltip placement="left" title="A set that counts for less is followed more loosely: where it and the rest of the inputs disagree, the surface goes with the rest">
                                        <TextField
                                            select size="small" variant="standard" value={WEIGHTS.find(w => w.value === (use.weight ?? 1))?.value ?? use.weight}
                                            onChange={e => setUseWeight(surface.id, use.set, Number(e.target.value))} sx={{ width: 112, flexShrink: 0 }}
                                            SelectProps={{ SelectDisplayProps: { 'aria-label': `How much ${set!.name} counts for`, style: { fontSize: 12 } } as React.HTMLAttributes<HTMLDivElement> }}
                                        >
                                            {WEIGHTS.map(w => <MenuItem key={w.value} dense value={w.value}>{w.text}</MenuItem>)}
                                            {use.weight !== undefined && !WEIGHTS.some(w => w.value === use.weight) && <MenuItem dense value={use.weight}>{Math.round(use.weight * 100)}%</MenuItem>}
                                        </TextField>
                                    </Tooltip>
                                </Box>
                            ))}
                        </>
                    )}
                </>
            )}

            <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1, mt: 1 }}>
                <Tooltip title="The size of the triangles it is drawn with, in metres. Smaller: finer detail, a bigger mesh, slower to fit. Empty: worked out from its size.">
                    <TextField
                        size="small" variant="standard" label={`${t('surfaceResolution')} (m)`} value={size} placeholder={cell ? `Automatic: ${formatMetres(cell)}` : 'Automatic'}
                        onChange={e => setSize(e.target.value)} onBlur={commitSize} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLElement).blur(); }}
                        sx={{ flex: 1 }} InputLabelProps={{ shrink: true }} inputProps={{ inputMode: 'decimal', ...termProps('surfaceResolution', ' (m)'), style: { fontSize: 13 } }}
                    />
                </Tooltip>
                {surface.params.resolution !== null && (
                    <Button size="small" sx={smallButton} onClick={() => updateSurface(surface.id, { params: { resolution: null } })}>Auto</Button>
                )}
            </Box>

            {saidOnly && surface.domain && (
                <Typography variant="caption" data-testid="shell-domain-said" sx={{ display: 'block', mt: 1 }}>
                    {`${t('domain')}: ${inUnit ? domainText(inUnit, models?.find(m => m.id === inUnit.model)?.name ?? 'a model no longer in the project') : `inside ${inSolids ? solidsText(inSolids, { surfaces, veinSystems, wireframes }) || 'solids that are no longer in the project' : ''}`}. Only the samples there are used, and the shell stops at the faces of that ground. It is set in its numeric model.`}
                </Typography>
            )}
            {takesDomain(surface.rule) && (homes.length > 0 || solidHomes.length > 0 || surface.domain) && !saidOnly && (
                <TextField
                    select size="small" variant="standard" fullWidth value={[...homes, ...solidHomes].some(h => h.value === home) ? home : NO_DOMAIN} sx={{ mt: 1 }}
                    onChange={e => {
                        const [model, unit, id] = e.target.value.split('\u0000');
                        updateSurface(surface.id, { domain: e.target.value === NO_DOMAIN ? null : model === SOLID ? { solids: [{ kind: unit as 'surface' | 'system' | 'mesh', id }] } : { model, unit } });
                    }}
                    SelectProps={{ SelectDisplayProps: { ...termProps('domain'), style: { fontSize: 13 } } as React.HTMLAttributes<HTMLDivElement> }}
                    helperText={!shell
                        ? (inSolids && solidHomes.some(h => h.value === home)
                            ? 'It stays inside that solid: all its logging is used, and it stops at the solid\u2019s faces. It is made again when the solid changes.'
                            : surface.domain && homes.some(h => h.value === home)
                            ? 'It stays inside that unit: all its logging is used, and it stops at the unit\u2019s faces. It is made again when the model is built again.'
                            : `${t('domain')}: a unit of a geological model that it must not run out of`)
                        : inSolids && solidHomes.some(h => h.value === home)
                        ? 'The shell stays inside that solid: only the samples in it are used, and the shell stops at its faces. It is made again when the solid changes.'
                        : surface.domain && homes.some(h => h.value === home)
                        ? 'The shell stays inside that unit: only the samples in it are used, and the shell stops at the unit\u2019s faces: values across a contact or a fault do not carry over it. It is made again when the model is built again.'
                        : `${t('domain')}: a unit of a geological model, for a shell that must not carry across a contact`}
                    FormHelperTextProps={{ sx: { fontSize: 11, lineHeight: 1.3 } }}
                >
                    <MenuItem dense value={NO_DOMAIN}><em>{shell ? 'Nothing: it goes where its samples take it' : 'Nothing: it goes where its logging takes it'}</em></MenuItem>
                    {homes.map(h => <MenuItem key={h.value} dense value={h.value}>{h.text}</MenuItem>)}
                    {solidHomes.map(h => <MenuItem key={h.value} dense value={h.value}>{h.text}</MenuItem>)}
                </TextField>
            )}
            {solidNotes.map(said => <Typography key={said} variant="caption" color="warning.main" data-testid="domain-solid-note" sx={{ display: 'block', mt: 0.25 }}>{said}</Typography>)}

            {sheet && (
                <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1, mt: 1 }}>
                    <Tooltip title="A new surface parallel to this one, that many metres from it everywhere, measured square to it: the other wall of a bed of known thickness, a hanging-wall or foot-wall limit, the base of a weathered layer. A minus puts it on this surface's second side. It follows this one when this one changes.">
                        <TextField
                            size="small" variant="standard" label={`${t('offsetSurface')} (m)`} value={apart} placeholder="e.g. 25 or -25"
                            onChange={e => setApart(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') makeApart(); }}
                            sx={{ flex: 1 }} InputLabelProps={{ shrink: true }} inputProps={{ inputMode: 'decimal', ...termProps('offsetSurface', ' (m)'), style: { fontSize: 13 } }}
                        />
                    </Tooltip>
                    <Button size="small" variant="outlined" sx={smallButton} disabled={apart.trim() === '' || !Number.isFinite(Number(apart)) || Number(apart) === 0} onClick={makeApart}>Make it</Button>
                </Box>
            )}

            <Tooltip title="A copy of it as it is now, locked, with copies of its points and lines: change this surface further and compare the two, or go back to the copy.">
                <span>
                    <Button
                        size="small" variant="outlined" sx={smallButton}
                        onClick={() => { const id = copySurface(surface.id); if (id) onCopied?.(id); }}
                    >
                        Copy as a version
                    </Button>
                </span>
            </Tooltip>
        </Box>
    );
};
