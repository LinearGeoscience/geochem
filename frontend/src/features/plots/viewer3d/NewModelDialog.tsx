/**
 * A new geological model, started in one place (Phase 208): its name, the
 * units it is made of (a grouping there is already, or a logging column to
 * make one from), the ground it covers, the size of its cells and its top.
 * Everything can be left as it is offered and changed after, in the model's
 * own properties; what is made here is one step to undo.
 */
import React, { useMemo, useState } from 'react';
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, TextField, Typography } from '@mui/material';
import { useAppStore } from '../../../store/appStore';
import { useDrillholeStore } from '../../../store/drillholeStore';
import { useModelStore } from '../../../store/modelStore';
import { BoxField } from '../../modelling/properties/BoxField';
import { Term } from '../../modelling/Term';
import { modelBox, modelCell } from '../../model/boundary';
import { loggingColumns, loggingProblem, loggingTables } from '../../model/logging';
import { dataBoxIn, sceneDataBox } from '../../model/modelCache';
import { columnDrilling, mapDrilling } from '../../model/modelDrilling';
import { keys } from '../../model/objectKeys';
import { groundSurface } from '../../model/sceneActions';
import { t } from '../../model/terms';
import { addTopographyFile, topoNote, type TopoNote } from '../../model/topoImport';
import { pickFromView } from '../../model/treePicks';
import type { Box3, SceneCoords, Vec3 } from '../../model/types';
import { mapCodeStats, newUnitMap } from '../../model/unitActions';
import { pickTopographyFile } from './wireframeLoad';

interface Props {
    open: boolean;
    /** The coordinate, hole and depth columns it is made in */
    coords: SceneCoords | null;
    onClose: () => void;
}

const AXES = ['East', 'North', 'Elevation'] as const;
/** Its units: none yet, a grouping of the project (`map:<id>`), or a logging column to make one from */
const NO_UNITS = 'none', FROM_COLUMN = 'column';
/** Its top: the top of its box, a surface through the hole collars made with it, or a surface or mesh of the project (its id) */
const BOX_TOP = 'box', COLLARS = 'collars', FROM_FILE = 'file';
/** The samples' own columns, as against a table logged down the holes */
const SAMPLES = 'samples';
/** More codes than this are not listed: they are counted */
const LISTED = 6;
/** More codes than this is more than a model has units for: they want grouping first */
const MANY_CODES = 12;

/** A size of a cell, to three figures (cells of 2.5 m are not cells of 3 m) */
const metres = (v: number) => `${Number(v.toPrecision(3)).toLocaleString()} m`;

const caption = (text: React.ReactNode) => <Typography variant="subtitle2" sx={{ mt: 1 }}>{text}</Typography>;
const plain = (text: React.ReactNode) => <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.35 }}>{text}</Typography>;

export const NewModelDialog: React.FC<Props> = ({ open, onClose, ...rest }) => {
    // Each time it opens it starts afresh
    const [opened, setOpened] = useState(0);
    const [wasOpen, setWasOpen] = useState(false);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) setOpened(n => n + 1);
    }
    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="new-model-title">
            <DialogTitle id="new-model-title">New geological model</DialogTitle>
            {open && <Form key={opened} onClose={onClose} {...rest} />}
        </Dialog>
    );
};

const Form: React.FC<Omit<Props, 'open'>> = ({ coords, onClose }) => {
    const maps = useModelStore(s => s.scene.unitMaps);
    const surfaces = useModelStore(s => s.scene.surfaces);
    const wireframes = useModelStore(s => s.scene.wireframes);
    const taken = useModelStore(s => s.scene.models);
    const db = useDrillholeStore(s => s.db);
    const data = useAppStore(s => s.columnarData);

    const [name, setName] = useState('');

    // ---- the units it is made of ----
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `db`: the tables are read from the store
    const tables = useMemo(() => loggingTables(), [db]);
    const [table, setTable] = useState(SAMPLES);
    const tableId = table === SAMPLES ? null : table;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `db`, `data`: the columns are read from the stores
    const columns = useMemo(() => loggingColumns(coords, tableId), [coords, tableId, db, data]);
    const noLogging = loggingProblem(coords, tableId);
    const [units, setUnits] = useState(() => (maps?.length ? `map:${maps[0].id}` : !noLogging && columns.length > 0 ? FROM_COLUMN : NO_UNITS));
    const [column, setColumn] = useState('');
    const picked = columns.includes(column) ? column : '';
    const source = useMemo(() => ({ columns: [picked], ...(tableId ? { table: tableId } : {}) }), [picked, tableId]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `db`, `data`, as above
    const stats = useMemo(() => (units === FROM_COLUMN && picked && !noLogging ? mapCodeStats(coords, source) : null), [units, picked, noLogging, coords, source, db, data]);
    const map = units.startsWith('map:') ? maps?.find(m => m.id === units.slice(4)) : undefined;

    // ---- the ground it covers ----
    // The columns the project's surfaces are in; with nothing made yet, the ones it is started in here
    const inScene = useModelStore(s => s.scene.coords);
    const placed = inScene ?? coords;
    // The holes its lithologies are logged in: left empty, its box is theirs (of all the data when it reads none)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `db`, `data`: the logging is read from the stores
    const drilling = useMemo(() => (map ? mapDrilling(placed, map) : units === FROM_COLUMN && picked && !noLogging ? columnDrilling(placed, picked, tableId) : null), [map, units, picked, noLogging, placed, tableId, db, data]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `data`: the box of the data is read from the store
    const auto = useMemo(() => modelBox(null, drilling?.box ?? dataBoxIn(placed)), [data, placed, drilling]);
    const [near, setNear] = useState(false);
    const [own, setOwn] = useState<{ min: (number | null)[]; max: (number | null)[] }>({ min: [null, null, null], max: [null, null, null] });
    const typed = [...own.min, ...own.max].some(v => v !== null);
    // What is left empty is as the data has it
    const box: Box3 | null = typed && auto
        ? { min: own.min.map((v, k) => v ?? Math.round(auto.min[k])) as Vec3, max: own.max.map((v, k) => v ?? Math.round(auto.max[k])) as Vec3 }
        : typed && [...own.min, ...own.max].every(v => v !== null) ? { min: own.min as Vec3, max: own.max as Vec3 } : null;
    const boxProblem = typed && !box ? 'With no data to take the rest from, every side of the box is needed.'
        : box && box.min.some((v, k) => v >= box.max[k]) ? `${AXES[box.min.findIndex((v, k) => v >= box.max[k])]}: "from" must be less than "to".` : null;
    const setSide = (side: 'min' | 'max', k: number, v: number | null) => setOwn(was => ({ ...was, [side]: was[side].map((x, i) => (i === k ? v : x)) }));

    // ---- the size of its cells ----
    const [cell, setCell] = useState<number | null>(null);
    const built = boxProblem ? null : box ?? auto;
    const usual = built ? modelCell(built, null) : null;
    const used = built ? modelCell(built, cell) : null;
    const counts = built && used ? built.max.map((v, k) => Math.max(1, Math.ceil((v - built.min[k]) / used))) : null;
    const cellProblem = cell !== null && cell <= 0 ? 'The size of a cell is more than nothing.' : null;

    // ---- its top ----
    const tops = [...surfaces.filter(s => !s.blockOf && (s.rule.kind === 'sheet' || s.rule.kind === 'contact')).map(s => ({ id: s.id, name: s.name })), ...wireframes.map(w => ({ id: w.id, name: `${w.name} (a mesh)` }))];
    const [top, setTop] = useState(BOX_TOP);
    const [failed, setFailed] = useState<string | null>(null);
    // A file of heights read for it: what was read, and anything to look at
    const [topoSaid, setTopoSaid] = useState<TopoNote | null>(null);
    const topFromFile = () => {
        void pickTopographyFile().then(async file => {
            if (!file) return;
            const made = await addTopographyFile(file, dataBoxIn(placed) ?? sceneDataBox());
            setTopoSaid(topoNote(made.notes));
            if (made.id) setTop(made.id);
        });
    };

    const full = (taken?.length ?? 0) >= 12;
    const unitsProblem = units === FROM_COLUMN && (noLogging ?? (!picked ? 'Choose the column the rock types were logged in.' : stats && stats.length === 0 ? 'Nothing is logged in this column.' : null));
    const problem = boxProblem ?? cellProblem ?? (unitsProblem || null);

    const make = () => {
        const store = useModelStore.getState();
        // Its top first: when the collars give none, nothing has been made
        let topId: string | undefined;
        if (top === COLLARS) {
            const ground = coords ? groundSurface(coords) : null;
            if (!ground?.ok) {
                setFailed(!ground || ground.reason === 'no-holes' ? 'The ground from the hole collars needs the hole ID, From and coordinate columns.'
                    : ground.reason === 'too-few' ? 'The ground from the hole collars needs two holes or more.'
                        : 'The surfaces of this project were built in other coordinate columns.');
                return;
            }
            topId = ground.id;
        } else if (top !== BOX_TOP) topId = top;
        const unitMap = units === FROM_COLUMN ? newUnitMap(coords, source) ?? undefined : map?.id;
        // A model made before anything else: the project is in the columns it was started in (its box is that of the data in them)
        if (!store.scene.coords && coords) store.setCoords(coords);
        const id = store.addModel({ name, ...(unitMap ? { unitMap } : {}), boundary: { box, ...(topId ? { top: topId } : {}), ...(near && drilling?.reach ? { near: { reach: null } } : {}) }, cell });
        if (!id) { setFailed('There are as many geological models as a project can have.'); return; }
        pickFromView(keys.model(id));
        onClose();
    };

    return (
        <>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1, pt: '8px !important' }}>
                <TextField
                    size="small" label="Name" value={name} placeholder="Geological model" autoFocus InputLabelProps={{ shrink: true }}
                    onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !problem && !full) make(); }}
                />

                {caption(<Term k="lithologies" />)}
                <TextField
                    select size="small" value={units} onChange={e => setUnits(e.target.value)}
                    SelectProps={{ SelectDisplayProps: { 'aria-label': 'Its units', 'data-term': 'lithologies' } as React.HTMLAttributes<HTMLDivElement> }}
                >
                    {(maps ?? []).map(m => <MenuItem key={m.id} value={`map:${m.id}`}>{m.name} ({m.units.length} unit{m.units.length === 1 ? '' : 's'})</MenuItem>)}
                    <MenuItem value={FROM_COLUMN}>From a logging column…</MenuItem>
                    <MenuItem value={NO_UNITS}><em>Not yet: chosen after</em></MenuItem>
                </TextField>
                {map && plain(`Oldest at the bottom: ${map.units.slice(0, LISTED).map(u => u.name).join(', ')}${map.units.length > LISTED ? ` and ${map.units.length - LISTED} more` : ''}.`)}
                {units === NO_UNITS && plain('The model is made empty. Its units are chosen in its properties, before its surfaces are made.')}
                {units === FROM_COLUMN && (
                    <>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                            {tables.length > 0 && (
                                <TextField
                                    select size="small" label="Logging from" value={table} sx={{ flex: 1, minWidth: 0 }} onChange={e => { setTable(e.target.value); setColumn(''); }}
                                >
                                    <MenuItem value={SAMPLES}>The samples</MenuItem>
                                    {tables.map(x => <MenuItem key={x.id} value={x.id}>{x.name}</MenuItem>)}
                                </TextField>
                            )}
                            <TextField
                                select size="small" label="Logging column" value={picked} sx={{ flex: 1, minWidth: 0 }} disabled={!!noLogging || columns.length === 0} onChange={e => setColumn(e.target.value)}
                            >
                                {columns.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                            </TextField>
                        </Box>
                        {noLogging ? <Alert severity="warning" sx={{ py: 0 }}>{noLogging}</Alert>
                            : columns.length === 0 ? <Alert severity="warning" sx={{ py: 0 }}>{tableId ? 'This table has no column to read logging from.' : 'The samples have no text column to read logging from.'}</Alert>
                                : stats && stats.length > 0 ? (
                                    <Box data-testid="new-model-codes">
                                        {plain(`${stats.length} code${stats.length === 1 ? '' : 's'}, each a unit of its own to start with: ${stats.slice(0, LISTED).map(s => `${s.code} (${s.count.toLocaleString()})`).join(', ')}${stats.length > LISTED ? ` and ${stats.length - LISTED} more` : ''}.`)}
                                        {stats.length > MANY_CODES && plain(`That is a lot of units for one model. Group the codes into fewer units after: pick ${t('lithologies')} under the model in the tree.`)}
                                    </Box>
                                ) : plain('Each code logged in the column becomes a unit; codes are grouped into fewer units after.')}
                    </>
                )}

                {caption(<Term k="boundary" />)}
                {AXES.map((axis, k) => (
                    <Box key={axis} sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                        <Typography variant="body2" color="text.secondary" sx={{ width: 112, flexShrink: 0 }}>{axis}</Typography>
                        <BoxField label={`${axis} from`} value={own.min[k]} hint={auto?.min[k] ?? null} onCommit={v => setSide('min', k, v)} fontSize={13} />
                        <Typography variant="body2" color="text.secondary">to</Typography>
                        <BoxField label={`${axis} to`} value={own.max[k]} hint={auto?.max[k] ?? null} onCommit={v => setSide('max', k, v)} fontSize={13} />
                    </Box>
                ))}
                {plain(typed ? `A box set here; what is left empty is as ${drilling?.box ? 'its drilling' : 'the data'} has it.`
                    : drilling?.box ? `Left empty, it is the box of its drilling (the ${drilling.holes.toLocaleString()} hole${drilling.holes === 1 ? '' : 's'} its lithologies are logged in), with a margin, and follows it.`
                        : auto ? 'Left empty, it is the box of the data, with a margin, and follows the data.' : 'There is no data to take a box from: type one in.')}
                {drilling?.reach != null && (
                    <FormControlLabel
                        sx={{ ml: -0.5, '& .MuiFormControlLabel-label': { fontSize: 13 } }}
                        control={<Checkbox size="small" sx={{ py: 0.25 }} checked={near} onChange={e => setNear(e.target.checked)} inputProps={{ 'aria-label': 'Only near its drilling' }} />}
                        label={`Only near its drilling: ground further than ${drilling.reach} m from every hole it reads is left out`}
                    />
                )}

                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mt: 0.5 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ width: 112, flexShrink: 0 }}><Term k="modelResolution" /></Typography>
                    <Box sx={{ width: 90, display: 'flex' }}>
                        <BoxField label={`${t('modelResolution')} (m)`} term="modelResolution" value={cell} hint={usual} onCommit={setCell} fontSize={13} exact />
                    </Box>
                    <Typography variant="caption" color="text.secondary" data-testid="new-model-cells" sx={{ flex: 1, lineHeight: 1.35 }}>
                        {used && counts
                            ? `m. ${counts.map(n => n.toLocaleString()).join(' × ')} cells of ${metres(used)}${cell !== null && cell > 0 && used > cell * 1.01 ? `: cells of ${metres(cell)} would be too many` : ''}. Smaller is finer and slower to build.`
                            : 'm. Left empty, it is worked out from the size of the box, and made finer where the lithologies logged are thin.'}
                    </Typography>
                </Box>

                {caption(<Term k="topography" />)}
                <TextField
                    select size="small" value={top}
                    onChange={e => { setFailed(null); if (e.target.value === FROM_FILE) topFromFile(); else setTop(e.target.value); }}
                    SelectProps={{ SelectDisplayProps: { 'aria-label': t('topography'), 'data-term': 'topography' } as React.HTMLAttributes<HTMLDivElement> }}
                >
                    <MenuItem value={BOX_TOP}><em>None: the top of its box</em></MenuItem>
                    <MenuItem value={COLLARS} disabled={!coords}>A surface through the hole collars, made now</MenuItem>
                    <MenuItem value={FROM_FILE} data-action="topography-file">From a file: a grid of heights or points…</MenuItem>
                    {tops.map(s => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
                </TextField>
                {plain('The ground surface: above it the model has nothing.')}
                {topoSaid && <Alert severity={topoSaid.severity} data-testid="topography-said" sx={{ py: 0 }}>{topoSaid.text}</Alert>}

                {(failed ?? problem) && <Alert severity="warning" sx={{ py: 0 }}>{failed ?? problem}</Alert>}
                {full && <Alert severity="warning" sx={{ py: 0 }}>There are as many geological models as a project can have.</Alert>}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" data-action="create-model" disabled={!!problem || full} onClick={make}>Create</Button>
            </DialogActions>
        </>
    );
};
