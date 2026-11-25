/**
 * Model units: logged codes grouped and split into the units a model is built
 * of (features/model/units.ts), one map per logging column or table, in order
 * down the holes with colours that follow it. Surfaces between units and
 * bodies can then read the map's units instead of the codes (ContactDialog).
 *
 * Intervals are given to a unit by selecting samples in a view (UnitsMenu);
 * here they are listed and can be put back as logged.
 *
 * Short stretches: each unit can be given a length under which a stretch of
 * it between other units is not read as logged (units.ts `unitsOfRows`); what
 * that changes is counted beside the unit and under the list.
 */
import React, { useMemo, useState } from 'react';
import {
    Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, IconButton, InputLabel, ListItemText,
    MenuItem, Select, TextField, Tooltip, Typography,
} from '@mui/material';
import { Close, DeleteOutline } from '@mui/icons-material';
import { useAppStore } from '../../../store/appStore';
import { useDrillholeStore } from '../../../store/drillholeStore';
import { useModelStore } from '../../../store/modelStore';
import { requestDelete } from '../../model/deleteObjects';
import { loggingColumns, loggingProblem, loggingTables } from '../../model/logging';
import { keys } from '../../model/objectKeys';
import type { ModelUnit, SceneCoords, UnitMap } from '../../model/types';
import { addLoggedCodes, mapCleaned, mapCodeStats, mapUnitCounts, mapUsualInterval, newUnitMap, orderUnitsDownHoles } from '../../model/unitActions';
import { CODE_JOIN, codesInNoUnit, groupUnits, MAX_UNITS, renameUnit, splitUnit } from '../../model/units';
import { Term } from '../../modelling/Term';

interface Props {
    open: boolean;
    /** The view's coordinate, hole and depth columns */
    coords: SceneCoords | null;
    /** The map to open on (null: the first, or a new one when there is none) */
    mapId?: string | null;
    onClose: () => void;
}

/** At most this many stretches given by hand are listed */
const MAX_LISTED = 100;

/** Metres, to a tenth under a hundred */
const metres = (v: number) => (v >= 100 ? Math.round(v).toLocaleString('en-US') : String(Number(v.toFixed(1))));
/** A unit with its cleaning length set (not a number above nothing: none) */
const withRun = (u: ModelUnit, length: number): ModelUnit => {
    const { minRun: _was, ...rest } = u;
    return Number.isFinite(length) && length > 0 ? { ...rest, minRun: length } : rest;
};

export const UnitsDialog: React.FC<Props> = ({ open, onClose, ...rest }) => (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        {open && <UnitsForm onClose={onClose} {...rest} />}
    </Dialog>
);

const UnitsForm: React.FC<Omit<Props, 'open'>> = ({ coords, mapId, onClose }) => {
    const maps = useModelStore(s => s.scene.unitMaps) ?? [];
    const [shown, setShown] = useState<string>(() => mapId ?? maps[0]?.id ?? 'new');
    const map = maps.find(m => m.id === shown) ?? null;
    return (
        <>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box component="span" sx={{ flex: 1 }}><Term k="lithologies" /></Box>
                <IconButton size="small" aria-label="Close" onClick={onClose}><Close fontSize="small" /></IconButton>
            </DialogTitle>
            <DialogContent>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    Group logged codes into the units the model is built of, or split them apart. Surfaces between units and bodies can read
                    these units instead of the codes. To give intervals to another unit, select samples in the view (lasso or box), then Units ▸ Give the selected samples to.
                </Typography>
                {maps.length > 0 && (
                    <FormControl size="small" fullWidth sx={{ mb: 2 }}>
                        <InputLabel id="units-map">Units</InputLabel>
                        <Select labelId="units-map" label="Units" value={map ? map.id : 'new'} onChange={e => setShown(e.target.value)}>
                            {maps.map(m => <MenuItem key={m.id} value={m.id}>{m.name} ({m.units.length} units)</MenuItem>)}
                            <MenuItem value="new"><em>New units from logging…</em></MenuItem>
                        </Select>
                    </FormControl>
                )}
                {map ? <MapEditor key={map.id} map={map} coords={coords} onRemoved={() => setShown('new')} />
                    : <NewMap coords={coords} onMade={setShown} />}
            </DialogContent>
            <DialogActions><Button onClick={onClose}>Done</Button></DialogActions>
        </>
    );
};

/** A new map: where the logging is, and which columns make a code */
const NewMap: React.FC<{ coords: SceneCoords | null; onMade: (id: string) => void }> = ({ coords, onMade }) => {
    const db = useDrillholeStore(s => s.db);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `db`: the tables are read from the store
    const tables = useMemo(() => loggingTables(), [db]);
    const [table, setTable] = useState('');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `db`, as above
    const columns = useMemo(() => loggingColumns(coords, table || null), [coords, table, db]);
    const [picked, setPicked] = useState<string[]>([]);
    const [name, setName] = useState('');
    const problem = loggingProblem(coords, table || null);
    const chosen = picked.filter(c => columns.includes(c));
    const stats = useMemo(() => (chosen.length && !problem ? mapCodeStats(coords, { columns: chosen, ...(table ? { table } : {}) }) : null),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `db`, as above; `chosen` by its text
        [coords, table, chosen.join('\n'), problem, db]);
    const make = () => {
        const id = newUnitMap(coords, { columns: chosen, ...(table ? { table } : {}), ...(name.trim() ? { name: name.trim() } : {}) });
        if (id) onMade(id);
    };
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {tables.length > 0 && (
                <FormControl size="small" fullWidth>
                    <InputLabel id="units-table">Logging from</InputLabel>
                    <Select labelId="units-table" label="Logging from" value={table} onChange={e => { setTable(e.target.value); setPicked([]); }}>
                        <MenuItem value="">The samples (columns of the dataset)</MenuItem>
                        {tables.map(t => <MenuItem key={t.id} value={t.id}>{t.name} (as logged, {t.rows.toLocaleString()} intervals)</MenuItem>)}
                    </Select>
                </FormControl>
            )}
            {problem ? <Alert severity="warning">{problem}</Alert> : columns.length === 0 ? (
                <Alert severity="warning">{table ? 'This table has no column to read logging from.' : 'This dataset has no text column to read logging from.'}</Alert>
            ) : (
                <>
                    <FormControl size="small" fullWidth>
                        <InputLabel id="units-columns">Logging columns</InputLabel>
                        <Select
                            labelId="units-columns" label="Logging columns" multiple value={chosen}
                            onChange={e => setPicked(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)}
                            renderValue={v => v.join(CODE_JOIN)}
                        >
                            {columns.map(c => (
                                <MenuItem key={c} value={c} dense>
                                    <Checkbox size="small" checked={chosen.includes(c)} sx={{ py: 0 }} />
                                    <ListItemText primary={c} />
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <Typography variant="caption" color="text.secondary">
                        With two or more columns, each mix of their values is a code of its own (lithology + alteration: "BAS + SER").
                    </Typography>
                    <TextField size="small" label="Name" placeholder={chosen.join(CODE_JOIN) || 'From the columns'} value={name} onChange={e => setName(e.target.value)} InputLabelProps={{ shrink: true }} />
                    <Typography variant="body2" color={stats && stats.length === 0 ? 'warning.main' : 'text.primary'}>
                        {chosen.length === 0 ? 'Choose the column the units are logged in.' : !stats ? 'The columns this needs are not in the dataset.'
                            : stats.length === 0 ? 'Nothing is logged in these columns.'
                                : `${stats.length.toLocaleString()} code${stats.length === 1 ? '' : 's'}: each starts as a unit of its own, in order down the holes.${stats.length > MAX_UNITS ? ` The first ${MAX_UNITS} are kept.` : ''}`}
                    </Typography>
                    <Box><Button variant="contained" size="small" disabled={!stats || stats.length === 0} onClick={make}>Make the units</Button></Box>
                </>
            )}
        </Box>
    );
};

const MapEditor: React.FC<{ map: UnitMap; coords: SceneCoords | null; onRemoved: () => void }> = ({ map, coords, onRemoved }) => {
    const model = useModelStore.getState;
    const data = useAppStore(s => s.columnarData);
    const db = useDrillholeStore(s => s.db);
    const surfaces = useModelStore(s => s.scene.surfaces);
    const readers = surfaces.filter(s => !s.blockOf && (s.rule.kind === 'contact' || s.rule.kind === 'body') && s.rule.units === map.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `data`, `db`: the logging is read from the stores
    const counts = useMemo(() => mapUnitCounts(coords, map), [coords, map, data, db]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- as above
    const stats = useMemo(() => mapCodeStats(coords, map), [coords, map.table, map.columns, data, db]);
    const loose = useMemo(() => (stats ? codesInNoUnit(map.units, stats.map(s => s.code)) : []), [stats, map.units]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- as above
    const cleaned = useMemo(() => mapCleaned(coords, map) ?? [], [coords, map, data, db]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- as above
    const usual = useMemo(() => mapUsualInterval(coords, map), [coords, map.table, map.columns, data, db]);
    const cleanedOf = new Map(cleaned.map(c => [c.unit, c]));
    const [runs, setRuns] = useState<Record<string, string>>({});
    const [runAll, setRunAll] = useState('');
    const [ticked, setTicked] = useState<string[]>([]);
    const [names, setNames] = useState<Record<string, string>>({});
    const [mapName, setMapName] = useState(map.name);
    const [note, setNote] = useState<string | null>(null);
    const tickedNow = ticked.filter(n => map.units.some(u => u.name === n));
    const countOf = new Map((counts ?? []).map(c => [c.unit, c.count]));
    const holes = new Set(map.reassigned.map(r => r.hole)).size;

    // With many codes: the list found by typing, the most logged first, and the little-logged ticked together
    const [find, setFind] = useState('');
    const [byCount, setByCount] = useState(false);
    const [under, setUnder] = useState(20);
    const many = map.units.length > 12;
    const listed = useMemo(() => {
        const text = find.trim().toLowerCase();
        const found = text ? map.units.filter(u => u.name.toLowerCase().includes(text) || u.codes.some(c => c.toLowerCase().includes(text))) : [...map.units];
        return byCount ? found.sort((a, b) => (countOf.get(b.name) ?? 0) - (countOf.get(a.name) ?? 0)) : found;
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `countOf` is made from `counts`
    }, [map.units, find, byCount, counts]);
    const little = map.units.filter(u => (countOf.get(u.name) ?? 0) < under).map(u => u.name);

    const group = () => {
        // Named after the most logged of them
        const names = map.units.filter(u => tickedNow.includes(u.name)).map(u => u.name);
        const most = names.reduce((a, b) => ((countOf.get(b) ?? 0) > (countOf.get(a) ?? 0) ? b : a), names[0]);
        const done = groupUnits(map.units, names, most);
        if (done) { model().regroupUnits(map.id, done); setTicked([]); }
    };
    const rename = (from: string) => {
        const to = names[from];
        setNames(n => { const next = { ...n }; delete next[from]; return next; });
        if (to === undefined) return;
        const done = renameUnit(map.units, from, to);
        if (done) model().regroupUnits(map.id, done);
        else if (to.trim() && to.trim() !== from) setNote(`There is a unit called ${to.trim()} already.`);
    };
    /** The length under which a unit's stretches are cleaned, as typed (blank or nothing: none) */
    const setRun = (name: string) => {
        const text = runs[name];
        setRuns(r => { const next = { ...r }; delete next[name]; return next; });
        if (text === undefined) return;
        model().updateUnitMap(map.id, { units: map.units.map(u => (u.name === name ? withRun(u, Number(text)) : u)) });
    };
    /** The same length for the ticked units, or for every unit when none is ticked */
    const setRunOf = (length: number) => {
        const which = tickedNow.length ? new Set(tickedNow) : null;
        setRuns({});
        model().updateUnitMap(map.id, { units: map.units.map(u => (!which || which.has(u.name) ? withRun(u, length) : u)) });
    };
    const recolour = (name: string, color: string) => model().updateUnitMap(map.id, { units: map.units.map(u => (u.name === name ? { ...u, color } : u)) });
    const remove = () => { const why = requestDelete([keys.unitMap(map.id)], onRemoved); if (why) setNote(why); };
    // A surface reading a map of several columns cannot go back to one column's codes
    const removable = readers.length === 0 || map.columns.length === 1;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <TextField
                    size="small" label="Name" value={mapName} sx={{ flex: 1 }} onChange={e => setMapName(e.target.value)}
                    onBlur={() => model().updateUnitMap(map.id, { name: mapName })} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLElement).blur(); }}
                />
                <Tooltip title={removable ? (readers.length ? `${readers.length} surface${readers.length === 1 ? ' reads' : 's read'} these units: they go back to the logged codes` : 'Remove these units') : 'Surfaces read these units, and they are made from several columns: change the surfaces first'}>
                    <span><Button size="small" color="error" disabled={!removable} onClick={remove}>Remove</Button></span>
                </Tooltip>
            </Box>
            <Typography variant="caption" color="text.secondary">
                From {map.columns.join(CODE_JOIN)}{map.table ? ` of ${db?.tables.find(t => t.id === map.table)?.name ?? 'a table no longer in the project'}, as logged` : ''}
                {readers.length ? ` · read by ${readers.map(s => s.name).join(', ')}` : ''}
            </Typography>
            {!counts && <Alert severity="warning">The logging these units are made from is not in this project now.</Alert>}
            {many && (
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    <TextField size="small" label="Find a unit or code" value={find} onChange={e => setFind(e.target.value)} sx={{ flex: 1, minWidth: 140 }} />
                    <Tooltip describeChild title={byCount ? 'List them in their own order (down the holes, once ordered)' : 'List the units with the most logged intervals first'}>
                        <Button size="small" variant={byCount ? 'contained' : 'outlined'} sx={{ textTransform: 'none' }} onClick={() => setByCount(v => !v)}>Most logged first</Button>
                    </Tooltip>
                </Box>
            )}
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, px: 0.5, mb: -1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ width: 52, textAlign: 'right' }}>intervals</Typography>
                <Tooltip describeChild title="A stretch of the unit shorter than this down a hole, with other units above and below it, is not read as logged (see Short stretches, under the list)">
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ width: 84, textAlign: 'right' }}>clean under, m</Typography>
                </Tooltip>
            </Box>
            <Box data-testid="units-list" sx={{ maxHeight: many ? 420 : 320, overflowY: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
                {listed.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>No unit or code has that in it.</Typography>}
                {listed.map(u => (
                    <Box key={u.name} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 0.5, py: 0.25, borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}>
                        <Checkbox
                            size="small" sx={{ p: 0.5 }} checked={tickedNow.includes(u.name)} inputProps={{ 'aria-label': `Tick ${u.name}` }}
                            onChange={(_, on) => setTicked(t => (on ? [...t, u.name] : t.filter(n => n !== u.name)))}
                        />
                        <Box
                            component="input" type="color" value={u.color} aria-label={`Colour of ${u.name}`}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => recolour(u.name, e.target.value)}
                            sx={{ width: 22, height: 22, p: 0, border: 0, bgcolor: 'transparent', cursor: 'pointer', flexShrink: 0 }}
                        />
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                            <TextField
                                variant="standard" size="small" fullWidth value={names[u.name] ?? u.name} inputProps={{ 'aria-label': `Name of ${u.name}` }}
                                onChange={e => setNames(n => ({ ...n, [u.name]: e.target.value }))} onBlur={() => rename(u.name)}
                                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLElement).blur(); }}
                            />
                            {(u.codes.length > 1 || u.codes[0] !== u.name) && (
                                <Typography variant="caption" color="text.secondary" noWrap component="div" title={u.codes.join(', ')}>
                                    {u.codes.length > 6 ? `${u.codes.length} codes: ` : ''}{u.codes.join(', ') || 'No codes'}
                                </Typography>
                            )}
                            {cleanedOf.has(u.name) && (
                                <Typography data-cleaned-unit={u.name} variant="caption" color="warning.main" noWrap component="div">
                                    {cleanedOf.get(u.name)!.stretches.toLocaleString()} short stretch{cleanedOf.get(u.name)!.stretches === 1 ? '' : 'es'} cleaned, {metres(cleanedOf.get(u.name)!.metres)} m
                                </Typography>
                            )}
                        </Box>
                        {u.codes.length > 1 && (
                            <Button size="small" sx={{ textTransform: 'none', minWidth: 0 }} onClick={() => { const done = splitUnit(map.units, u.name); if (done) model().regroupUnits(map.id, done); }}>
                                Split
                            </Button>
                        )}
                        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, width: 52, textAlign: 'right' }}>{(countOf.get(u.name) ?? 0).toLocaleString()}</Typography>
                        <TextField
                            variant="standard" size="small" type="number" placeholder="none" value={runs[u.name] ?? (u.minRun ?? '')} sx={{ width: 84, flexShrink: 0 }}
                            inputProps={{ min: 0, step: 'any', 'aria-label': `Clean stretches of ${u.name} shorter than, m`, style: { textAlign: 'right' } }}
                            onChange={e => setRuns(r => ({ ...r, [u.name]: e.target.value }))} onBlur={() => setRun(u.name)}
                            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLElement).blur(); }}
                        />
                    </Box>
                ))}
            </Box>
            {many && (
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Tooltip describeChild title="Tick every unit logged fewer times than this, to group the rare codes into one unit (it is named after the most logged of them: rename it after)">
                        <span>
                            <Button size="small" sx={{ textTransform: 'none' }} disabled={little.length === 0} onClick={() => setTicked(little)}>
                                Tick the {little.length.toLocaleString()} logged fewer than
                            </Button>
                        </span>
                    </Tooltip>
                    <TextField
                        size="small" type="number" value={under} sx={{ width: 90 }} inputProps={{ min: 1, 'aria-label': 'Logged fewer times than' }}
                        onChange={e => setUnder(Math.max(1, Math.round(Number(e.target.value) || 1)))}
                    />
                    <Typography variant="caption" color="text.secondary">times</Typography>
                    {tickedNow.length > 0 && <Button size="small" sx={{ textTransform: 'none' }} onClick={() => setTicked([])}>Untick all</Button>}
                </Box>
            )}
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Button size="small" variant="outlined" disabled={tickedNow.length < 2} onClick={group}>
                    Group the ticked units{tickedNow.length >= 2 ? ` (${tickedNow.length})` : ''}
                </Button>
                <Tooltip title="List the units by where they usually are down the holes, and colour them in that order">
                    <span><Button size="small" disabled={!stats} onClick={() => orderUnitsDownHoles(coords, map.id)}>Order down the holes</Button></span>
                </Tooltip>
            </Box>
            {note && <Alert severity="info" onClose={() => setNote(null)}>{note}</Alert>}
            <Box data-testid="units-cleaning">
                <Typography variant="subtitle2">Short stretches</Typography>
                <Typography variant="body2" color="text.secondary">
                    A unit can be given a length (the last column of the list). A stretch of it shorter than that down a hole, with other units above and
                    below it, is then not read as logged: inside one unit it is read as that unit, and between two units it is left out, so the contact
                    falls inside it. The logging is not changed, and a model is still checked against the logging as logged.
                    {usual ? ` Most intervals here are ${metres(usual)} m long.` : ''}
                </Typography>
                {cleaned.length > 0 && (() => {
                    const total = cleaned.reduce((a, c) => a + c.metres, 0), taken = cleaned.reduce((a, c) => a + c.absorbed, 0), count = cleaned.reduce((a, c) => a + c.stretches, 0);
                    return (
                        <Typography data-testid="units-cleaned" variant="body2" sx={{ mt: 0.75 }}>
                            As it stands: {count.toLocaleString()} short stretch{count === 1 ? '' : 'es'} ({metres(total)} m) {count === 1 ? 'is' : 'are'} not read as logged:
                            {' '}{metres(taken)} m read as the unit round them, {metres(total - taken)} m left out.
                        </Typography>
                    );
                })()}
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mt: 0.75 }}>
                    <TextField
                        size="small" type="number" label="Shorter than, m" value={runAll} sx={{ width: 140 }} InputLabelProps={{ shrink: true }}
                        inputProps={{ min: 0, step: 'any' }} onChange={e => setRunAll(e.target.value)}
                    />
                    <Button size="small" variant="outlined" sx={{ textTransform: 'none' }} disabled={!(Number(runAll) > 0)} data-action="clean-set" onClick={() => setRunOf(Number(runAll))}>
                        Set it for {tickedNow.length ? `the ${tickedNow.length} ticked` : 'every unit'}
                    </Button>
                    <Button size="small" sx={{ textTransform: 'none' }} disabled={!map.units.some(u => (tickedNow.length === 0 || tickedNow.includes(u.name)) && u.minRun)} data-action="clean-none" onClick={() => setRunOf(0)}>
                        Clean none of {tickedNow.length ? 'the ticked' : 'them'}
                    </Button>
                </Box>
            </Box>
            {loose.length > 0 && (
                <Alert severity="info" action={<Button size="small" onClick={() => addLoggedCodes(coords, map.id)}>Make them units</Button>}>
                    {loose.length.toLocaleString()} code{loose.length === 1 ? ' is' : 's are'} logged that {loose.length === 1 ? 'is' : 'are'} in no unit (counted as not logged): {loose.slice(0, 6).join(', ')}{loose.length > 6 ? ' …' : ''}
                </Alert>
            )}
            <Box>
                <Typography variant="subtitle2">Given to units by hand</Typography>
                {map.reassigned.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">None. Select samples in the view, then Units ▸ Give the selected samples to.</Typography>
                ) : (
                    <>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="body2" sx={{ flex: 1 }}>
                                {map.reassigned.length.toLocaleString()} stretch{map.reassigned.length === 1 ? '' : 'es'} in {holes.toLocaleString()} hole{holes === 1 ? '' : 's'}
                            </Typography>
                            <Button size="small" onClick={() => model().reassignUnits(map.id, map.reassigned.map(r => ({ hole: r.hole, from: r.from, to: r.to })), null)}>
                                Put them all back as logged
                            </Button>
                        </Box>
                        <Box data-testid="units-reassigned" sx={{ maxHeight: 160, overflowY: 'auto' }}>
                            {map.reassigned.slice(0, MAX_LISTED).map(r => (
                                <Box key={`${r.hole}|${r.from}`} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                                        {r.hole} {r.from}–{r.to} m: {r.unit || 'not logged'}
                                    </Typography>
                                    <Tooltip title="Back as logged">
                                        <IconButton size="small" aria-label={`Put ${r.hole} ${r.from}–${r.to} m back as logged`} onClick={() => model().reassignUnits(map.id, [{ hole: r.hole, from: r.from, to: r.to }], null)}>
                                            <DeleteOutline fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                </Box>
                            ))}
                            {map.reassigned.length > MAX_LISTED && <Typography variant="caption" color="text.secondary">and {(map.reassigned.length - MAX_LISTED).toLocaleString()} more</Typography>}
                        </Box>
                    </>
                )}
            </Box>
        </Box>
    );
};
