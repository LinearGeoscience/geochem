/**
 * The faults of a geological model, in its properties: the surfaces that
 * cut it into fault blocks, which of them end on which, and a fault made
 * from intervals logged as one.
 */
import React, { useMemo, useState } from 'react';
import { Alert, Box, Button, Checkbox, FormControlLabel, IconButton, ListItemText, MenuItem, TextField, Tooltip, Typography } from '@mui/material';
import { Close } from '@mui/icons-material';
import { useModelStore } from '../../../store/modelStore';
import { modelBlocks, splitsByBlock } from '../../model/blockParts';
import { cutProblem, cuttersOf } from '../../model/faultCuts';
import { activeFaults, faultProblem, MAX_FAULTS, sideNames, stopProblem } from '../../model/geoModel';
import { TAPER } from '../../model/geoModelJobs';
import { suggestedReach } from '../../model/modelCache';
import { faultFromLogging, splitContactsByBlock } from '../../model/geoModelActions';
import { useGeoModelCache } from '../../model/geoModelCache';
import { modelThrows, throwText } from '../../model/geoModelThrow';
import { loggingColumns, loggingTables, unitCounts } from '../../model/logging';
import { keys } from '../../model/objectKeys';
import { listText } from '../../model/shellDomains';
import { Term } from '../Term';
import type { FaultSide, GeoModel, ModelFault, ModelScene } from '../../model/types';
import { coordsFor, useTargetView } from '../targetView';
import { BoxField } from './BoxField';
import { Caption, Fact } from './parts';
import { smallButton } from './styles';
import { plain, t } from '../../model/terms';

const select = { SelectDisplayProps: { style: { fontSize: 13, paddingTop: 2, paddingBottom: 2 } } } as const;
const SAMPLES = '\u0000samples';

/** A fault's name, and the names of its two sides */
export function faultNames(scene: ModelScene, fault: ModelFault | undefined): { name: string; sides: [string, string] } {
    const surface = scene.surfaces.find(s => s.id === fault?.surface);
    const wire = scene.wireframes.find(w => w.id === fault?.mesh);
    return { name: surface?.name ?? wire?.name ?? 'Not in the project', sides: sideNames(surface, !!fault?.mesh) };
}

/** Sides of faults in words: "Main fault: first side; Splay: second side" */
export function sidesText(scene: ModelScene, model: GeoModel, sides: readonly FaultSide[]): string {
    return sides.map(e => {
        const { name, sides: names } = faultNames(scene, model.faults?.find(x => x.id === e.fault));
        return `${name}: ${names[e.side > 0 ? 0 : 1]}`;
    }).join('; ');
}

/** A fault surface through the intervals logged as a fault */
const FromLogging: React.FC<{ model: GeoModel }> = ({ model }) => {
    const target = useTargetView();
    // (Drawn again when the columns the model is in change)
    useModelStore(s => s.scene.coords);
    const [open, setOpen] = useState(false);
    const [source, setSource] = useState(SAMPLES);
    const [column, setColumn] = useState('');
    const [codes, setCodes] = useState<string[]>([]);
    const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
    const coords = coordsFor(target);
    const table = source === SAMPLES ? null : source;
    const tables = useMemo(() => (open ? loggingTables() : []), [open]);
    const columns = useMemo(() => (open ? loggingColumns(coords, table) : []), [open, coords, table]);
    const counts = useMemo(() => (open && column ? unitCounts(column, table) : []), [open, column, table]);
    const make = () => {
        const done = faultFromLogging(model.id, coords, { column, ...(table ? { table } : {}) }, codes);
        setNote(done.ok ? { text: `A fault through ${done.points} logged intervals, added to the model's faults.`, bad: false } : { text: done.reason, bad: true });
        if (done.ok) { setOpen(false); setCodes([]); }
    };
    return (
        <Box sx={{ mt: 0.5 }}>
            <Button size="small" sx={smallButton} aria-expanded={open} onClick={() => { setOpen(o => !o); setNote(null); }}>A fault from logged intervals…</Button>
            {open && (
                <Box sx={{ mt: 0.5, p: 0.75, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                        A surface through the middles of the intervals logged with the codes chosen (a fault zone, a shear), as points that can then be moved or added to.
                    </Typography>
                    <TextField
                        select size="small" variant="standard" fullWidth value={source} onChange={e => { setSource(e.target.value); setColumn(''); setCodes([]); }}
                        SelectProps={{ SelectDisplayProps: { ...select.SelectDisplayProps, 'aria-label': 'Logging from' } as React.HTMLAttributes<HTMLDivElement> }}
                    >
                        <MenuItem dense value={SAMPLES}>The samples</MenuItem>
                        {tables.map(t => <MenuItem key={t.id} dense value={t.id}>{t.name}</MenuItem>)}
                    </TextField>
                    <TextField
                        select size="small" variant="standard" fullWidth value={column} onChange={e => { setColumn(e.target.value); setCodes([]); }} sx={{ mt: 0.5 }}
                        SelectProps={{ displayEmpty: true, renderValue: v => (v ? String(v) : <em>The column the fault is logged in…</em>), SelectDisplayProps: { ...select.SelectDisplayProps, 'aria-label': 'Column the fault is logged in' } as React.HTMLAttributes<HTMLDivElement> }}
                    >
                        {columns.map(c => <MenuItem key={c} dense value={c}>{c}</MenuItem>)}
                    </TextField>
                    <TextField
                        select size="small" variant="standard" fullWidth value={codes} disabled={!column} sx={{ mt: 0.5 }}
                        onChange={e => setCodes(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value as unknown as string[])}
                        SelectProps={{
                            multiple: true, displayEmpty: true, renderValue: v => ((v as string[]).length ? (v as string[]).join(', ') : <em>The codes that mean the fault…</em>),
                            SelectDisplayProps: { ...select.SelectDisplayProps, 'aria-label': 'Codes that mean the fault' } as React.HTMLAttributes<HTMLDivElement>,
                        }}
                    >
                        {counts.map(c => (
                            <MenuItem key={c.unit} dense value={c.unit}>
                                <Checkbox size="small" sx={{ p: 0.25, mr: 0.5 }} checked={codes.includes(c.unit)} />
                                <ListItemText primary={c.unit} secondary={`${c.count} intervals`} primaryTypographyProps={{ fontSize: 12 }} secondaryTypographyProps={{ fontSize: 11 }} />
                            </MenuItem>
                        ))}
                    </TextField>
                    <Button size="small" variant="contained" fullWidth sx={{ textTransform: 'none', mt: 0.75 }} disabled={codes.length === 0} onClick={make}>Make the fault</Button>
                </Box>
            )}
            {note && <Alert severity={note.bad ? 'warning' : 'success'} onClose={() => setNote(null)} sx={{ py: 0, mt: 0.5, fontSize: 12, '& .MuiAlert-action': { pt: 0 } }}>{note.text}</Alert>}
        </Box>
    );
};

/** The contacts split by fault block, and the surfaces fitted in one block */
const Blocks: React.FC<{ model: GeoModel; onGoTo: (key: string) => void }> = ({ model, onGoTo }) => {
    const scene = useModelStore(s => s.scene);
    const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
    const inUse = (model.faults ?? []).filter(x => !x.off && faultProblem(scene, x) === null).length;
    // (Fitted in one block by hand: the model's own parts are listed under their contacts)
    const limited = scene.surfaces.filter(s => s.within?.model === model.id && !s.blockOf);
    const blocks = modelBlocks(scene, model);
    const byBlock = model.contacts.filter(c => splitsByBlock(model, c) && scene.surfaces.some(s => s.id === c.surface)).length;
    const across = model.contacts.filter(c => c.across && !c.within?.length).length;
    const byHand = model.contacts.filter(c => c.within?.length).length;
    const split = () => {
        const done = splitContactsByBlock(model.id);
        setNote(done.ok
            ? { text: `${done.contacts} contact${done.contacts === 1 ? '' : 's'} split into ${done.surfaces} surfaces, one for each fault block. The surfaces they were are still in the project, out of the model.`, bad: false }
            : { text: done.reason, bad: true });
    };
    if ((model.faults ?? []).length === 0 && limited.length === 0) return null;
    return (
        <Box sx={{ mt: 0.75 }}>
            <FormControlLabel
                sx={{ ml: -0.5, mr: 0 }} label={<Typography variant="body2">Fit each contact in each fault block apart</Typography>}
                control={<Checkbox size="small" sx={{ p: 0.5 }} checked={!!model.byBlock} inputProps={{ 'data-action': 'by-block' } as React.InputHTMLAttributes<HTMLInputElement>} onChange={e => { setNote(null); useModelStore.getState().updateModel(model.id, { byBlock: e.target.checked }); }} />}
            />
            <Typography data-testid="by-block-said" variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {model.byBlock
                    ? blocks.length > 1
                        ? `${byBlock === 0 ? 'No contact is' : byBlock === 1 ? 'Its contact is' : `Its ${byBlock} contacts are each`} fitted in ${blocks.length} fault blocks apart, to what is in each block alone: a layer the faults offset is right on each side of them. The model makes and keeps those parts; change a contact's own surface and they follow.${across ? ` ${across === 1 ? 'One contact runs' : `${across} contacts run`} through the faults as one surface.` : ''} A contact the faults do not offset (ground laid down after them) is set to run through them in the ${t('chronology').toLowerCase()}.`
                        : 'While a fault is in use, each contact is fitted in each fault block apart, with nothing to press: a layer the fault offsets is then right on each side of it.'
                    : 'Each contact is one surface through every fault block: a layer the faults offset is smeared through them. Tick this to have each fitted in each block apart.'}
                {byHand > 0 ? ` ${byHand === 1 ? 'One contact was' : `${byHand} contacts were`} split by hand: each is in its own block, and is left as it is.` : ''}
            </Typography>
            {!model.byBlock && (
                <Tooltip title="Each contact becomes one surface per fault block, fitted to the points, lines and logging in that block alone, and each is then yours to change on its own">
                    <span>
                        <Button size="small" sx={smallButton} disabled={inUse === 0} onClick={split}>Split its contacts by hand</Button>
                    </span>
                </Tooltip>
            )}
            {note && <Alert severity={note.bad ? 'warning' : 'success'} onClose={() => setNote(null)} sx={{ py: 0, mt: 0.5, fontSize: 12, '& .MuiAlert-action': { pt: 0 } }}>{note.text}</Alert>}
            {limited.length > 0 && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>Fitted in one fault block:</Typography>}
            {limited.map(s => (
                <Box key={s.id} data-testid="block-surface" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Tooltip title={sidesText(scene, model, s.within?.sides ?? [])}>
                        <Typography variant="caption" noWrap onClick={() => onGoTo(keys.surface(s.id))} sx={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>{s.name}</Typography>
                    </Tooltip>
                    <Tooltip title="Fit it to everything again, whatever block it is in">
                        <IconButton size="small" sx={{ p: 0.25 }} aria-label={`Fit ${s.name} in every block again`} onClick={() => useModelStore.getState().updateSurface(s.id, { within: null })}><Close sx={{ fontSize: 12 }} /></IconButton>
                    </Tooltip>
                </Box>
            ))}
        </Box>
    );
};

interface Props {
    model: GeoModel;
    /** The fault picked in the tree (null: none) */
    picked: string | null;
    onGoTo: (key: string) => void;
}

/**
 * A fault that stops (Phase 235): it is there only so far past the places it
 * is known at, and a layer runs unbroken round its end.
 */
const FaultStops: React.FC<{ model: GeoModel; fault: ModelFault; name: string }> = ({ model, fault, name }) => {
    const scene = useModelStore(s => s.scene);
    const { updateModelFault } = useModelStore.getState();
    const reach = fault.extent?.reach ?? null;
    const why = stopProblem(scene, model, fault);
    return (
        <Box data-testid="fault-stops">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Tooltip title="It does not cut the whole model: it dies out. A layer is offset beside it, less and less towards its end, and runs unbroken round the end">
                    <FormControlLabel
                        sx={{ m: 0, flexShrink: 0 }} label={<Typography variant="caption">It stops</Typography>}
                        control={(
                            <Checkbox
                                size="small" sx={{ p: 0.25 }} checked={reach !== null} inputProps={{ 'aria-label': `${name} stops`, 'data-action': 'fault-stops' } as React.InputHTMLAttributes<HTMLInputElement>}
                                onChange={e => updateModelFault(model.id, fault.id, { extent: e.target.checked ? { reach: suggestedReach(fault) } : undefined })}
                            />
                        )}
                    />
                </Tooltip>
                {reach !== null && (
                    <>
                        <Box data-field="fault-reach" sx={{ width: 56, display: 'flex' }}>
                            <BoxField label={`How far past its places ${name} runs (m)`} value={reach} hint={null} exact onCommit={v => updateModelFault(model.id, fault.id, { extent: v && v > 0 ? { reach: v } : undefined })} />
                        </Box>
                        <Typography variant="caption" color="text.secondary" noWrap>m past where it is known</Typography>
                    </>
                )}
            </Box>
            {reach !== null && (
                <Typography data-testid="fault-stops-said" variant="caption" color={why ? 'warning.main' : 'text.secondary'} sx={{ display: 'block' }}>
                    {why ?? `It is there within ${reach} m of the places it is known at (its points, its lines, where holes meet it), measured along it. Past that there is no fault: a layer is offset beside it, less and less over the last ${Number((reach * TAPER).toPrecision(2))} m, and runs unbroken round its end.`}
                </Typography>
            )}
        </Box>
    );
};

export const ModelFaults: React.FC<Props> = ({ model, picked, onGoTo }) => {
    const scene = useModelStore(s => s.scene);
    const { addModelFault, updateModelFault, removeModelFault } = useModelStore.getState();
    const [adding, setAdding] = useState('');
    const built = useGeoModelCache(s => s.byId[model.id]);
    // The throw across each fault, from the contacts that are on both sides of it
    const throws = useMemo(() => modelThrows(model, built), [model, built]);
    const faults = model.faults ?? [];
    const inUse = activeFaults(scene, model);
    const taken = (x: { surface?: string; mesh?: string }) => faults.some(f => (x.mesh ? f.mesh === x.mesh : f.surface === x.surface)) || model.contacts.some(c => (x.mesh ? c.mesh === x.mesh : c.surface === x.surface));
    const surfaces = scene.surfaces.filter(s => (s.rule.kind === 'sheet' || s.rule.kind === 'contact') && !s.blockOf && !taken({ surface: s.id }));
    const meshes = scene.wireframes.filter(w => !taken({ mesh: w.id }));
    const add = (id: string) => {
        if (scene.surfaces.some(s => s.id === id)) addModelFault(model.id, { surface: id });
        else if (scene.wireframes.some(w => w.id === id)) addModelFault(model.id, { mesh: id });
        setAdding('');
    };

    return (
        <Box data-testid="model-faults">
            <Caption><Term k="faultSystem" /></Caption>
            {faults.length === 0 && <Fact>None: the model is in one piece. A fault cuts it into blocks, each with its own chronology.</Fact>}
            {faults.map(f => {
                const { name, sides } = faultNames(scene, f);
                const bad = faultProblem(scene, f);
                const surface = scene.surfaces.find(s => s.id === f.surface);
                const wire = scene.wireframes.find(w => w.id === f.mesh);
                const goTo = surface ? keys.surface(surface.id) : wire ? keys.wireframe(wire.id) : null;
                const ends = f.ends ?? [];
                // What it can still end on: a side of any other fault it does not end on yet
                const others = faults.filter(g => g.id !== f.id && !ends.some(e => e.fault === g.id));
                // What it is offset by, and what can still be said to offset it: a fault it does not end on (a fixed mesh is where it is: nothing offsets it here)
                const cut = f.cutBy ?? [];
                const cutters = f.surface ? faults.filter(g => g.id !== f.id && !cut.includes(g.id) && !ends.some(e => e.fault === g.id)) : [];
                // (What offsets a fault that offsets it, offsets it too)
                const through = f.off ? [] : cuttersOf(inUse, f).filter(g => !cut.includes(g.id));
                const cutBad = f.off ? null : cutProblem(inUse, f, g => faultNames(scene, g).name);
                return (
                    <Box
                        key={f.id} data-testid="model-fault" aria-current={picked === f.id || undefined}
                        sx={{ mt: 0.5, p: 0.5, borderRadius: 1, border: 1, borderColor: picked === f.id ? 'primary.main' : 'divider', opacity: f.off ? 0.6 : 1 }}
                    >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: surface?.color ?? wire?.color ?? 'text.disabled', flexShrink: 0 }} />
                            <Tooltip title={bad ?? `Its sides: ${sides[0]}, and ${sides[1]}`}>
                                <Typography
                                    variant="caption" noWrap onClick={() => goTo && onGoTo(goTo)}
                                    sx={{ flex: 1, minWidth: 0, fontWeight: 600, cursor: goTo ? 'pointer' : 'default', color: bad ? 'warning.main' : 'text.primary' }}
                                >
                                    {name}
                                </Typography>
                            </Tooltip>
                            <Tooltip title={plain('active')}>
                                <FormControlLabel
                                    sx={{ m: 0, flexShrink: 0 }} label={<Typography variant="caption">{t('active')}</Typography>}
                                    control={<Checkbox size="small" sx={{ p: 0.25 }} checked={!f.off} onChange={() => updateModelFault(model.id, f.id, { off: !f.off })} inputProps={{ 'aria-label': `${t('active')}: ${name}`, 'data-action': 'toggle-active' } as React.InputHTMLAttributes<HTMLInputElement>} />}
                                />
                            </Tooltip>
                            <Tooltip title="Take it out of the model's faults (the surface stays)">
                                <IconButton size="small" sx={{ p: 0.25 }} aria-label={`Take ${name} out of the faults`} onClick={() => removeModelFault(model.id, f.id)}><Close sx={{ fontSize: 14 }} /></IconButton>
                            </Tooltip>
                        </Box>
                        {ends.map(e => {
                            const other = faultNames(scene, faults.find(g => g.id === e.fault));
                            return (
                                <Box key={e.fault} data-testid="fault-end" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1, minWidth: 0 }}>ends on {other.name}: it is on the {other.sides[e.side > 0 ? 0 : 1].replace(/ side$/, '')} side</Typography>
                                    <IconButton size="small" sx={{ p: 0.25 }} aria-label={`${name} no longer ends on ${other.name}`} onClick={() => updateModelFault(model.id, f.id, { ends: ends.filter(x => x.fault !== e.fault) })}><Close sx={{ fontSize: 12 }} /></IconButton>
                                </Box>
                            );
                        })}
                        {others.length > 0 && (
                            <TextField
                                select size="small" variant="standard" fullWidth value=""
                                onChange={e => { const [fault, side] = e.target.value.split('\u0000'); updateModelFault(model.id, f.id, { ends: [...ends, { fault, side: side === '-1' ? -1 : 1 }] }); }}
                                SelectProps={{
                                    displayEmpty: true, renderValue: () => <em>It ends on…</em>,
                                    SelectDisplayProps: { ...select.SelectDisplayProps, 'aria-label': `What ${name} ends on` } as React.HTMLAttributes<HTMLDivElement>,
                                }}
                            >
                                {others.flatMap(g => {
                                    const o = faultNames(scene, g);
                                    return ([1, -1] as const).map(side => (
                                        <MenuItem key={`${g.id}${side}`} dense value={`${g.id}\u0000${side}`}>{o.name}, staying on the {o.sides[side > 0 ? 0 : 1].replace(/ side$/, '')} side</MenuItem>
                                    ));
                                })}
                            </TextField>
                        )}
                        {cut.map(id => {
                            const other = faultNames(scene, faults.find(g => g.id === id));
                            return (
                                <Box key={id} data-testid="fault-cut" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1, minWidth: 0 }}>offset by {other.name}: it is fitted on each side of it apart</Typography>
                                    <IconButton size="small" sx={{ p: 0.25 }} aria-label={`${name} is no longer offset by ${other.name}`} onClick={() => updateModelFault(model.id, f.id, { cutBy: cut.filter(x => x !== id) })}><Close sx={{ fontSize: 12 }} /></IconButton>
                                </Box>
                            );
                        })}
                        {through.length > 0 && (
                            <Typography data-testid="fault-cut-through" variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                and by {listText(through.map(g => faultNames(scene, g).name))}, which {through.length === 1 ? 'offsets' : 'offset'} a fault that offsets it
                            </Typography>
                        )}
                        {cutBad && <Typography data-testid="fault-cut-said" variant="caption" color="warning.main" sx={{ display: 'block' }}>{cutBad}</Typography>}
                        {cutters.length > 0 && (
                            <TextField
                                select size="small" variant="standard" fullWidth value=""
                                onChange={e => updateModelFault(model.id, f.id, { cutBy: [...cut, e.target.value] })}
                                SelectProps={{
                                    displayEmpty: true, renderValue: () => <em>It is offset by…</em>,
                                    SelectDisplayProps: { ...select.SelectDisplayProps, 'aria-label': `What offsets ${name}` } as React.HTMLAttributes<HTMLDivElement>,
                                }}
                            >
                                {cutters.map(g => <MenuItem key={g.id} dense value={g.id}>{faultNames(scene, g).name}, a younger fault that has moved it</MenuItem>)}
                            </TextField>
                        )}
                        {!bad && <FaultStops model={model} fault={f} name={name} />}
                        {throws.filter(t => t.fault === f.id).map(t => (
                            <Typography key={t.first} data-testid="fault-throw" variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                Throw, by {t.unit}: {throwText(t, sides)}
                            </Typography>
                        ))}
                        {bad && <Typography variant="caption" color="warning.main" sx={{ display: 'block' }}>{bad}</Typography>}
                    </Box>
                );
            })}
            <TextField
                select size="small" variant="standard" fullWidth value={adding} sx={{ mt: 0.75 }} disabled={surfaces.length + meshes.length === 0 || faults.length >= MAX_FAULTS}
                onChange={e => add(e.target.value)}
                SelectProps={{
                    displayEmpty: true,
                    renderValue: () => <em>{faults.length >= MAX_FAULTS ? `A model takes ${MAX_FAULTS} faults` : surfaces.length + meshes.length ? 'Add a fault…' : 'No surface left to be a fault'}</em>,
                    SelectDisplayProps: { ...select.SelectDisplayProps, 'aria-label': 'Add a fault' } as React.HTMLAttributes<HTMLDivElement>,
                }}
            >
                {surfaces.map(s => <MenuItem key={s.id} dense value={s.id}>{s.name}</MenuItem>)}
                {meshes.map(w => <MenuItem key={w.id} dense value={w.id}>{w.name} (a mesh, used as it is)</MenuItem>)}
            </TextField>
            <FromLogging model={model} />
            <Blocks model={model} onGoTo={onGoTo} />
        </Box>
    );
};
