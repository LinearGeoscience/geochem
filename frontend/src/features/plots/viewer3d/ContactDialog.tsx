/**
 * A surface from logging: choose the logging column and its units.
 *  - Between logged units: which units lie on either side. The surface is put
 *    where one side gives way to the other down each drillhole
 *    (features/model/contacts).
 *  - A body round logged units: which units it is made of. A closed surface
 *    is put round them (features/model/body).
 * Also used to change the choice for a surface made either way.
 *
 * The logging is a column of the dataset (logging as it was merged onto the
 * samples) or a column of a table logged down the holes (HoleTableDialog):
 * the contacts are then at the logged depths on the holes' own paths.
 */
import React, { useMemo, useState } from 'react';
import {
    Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel, InputLabel, MenuItem, Radio, RadioGroup, Select,
    TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import { useDrillholeStore } from '../../../store/drillholeStore';
import { useModelStore } from '../../../store/modelStore';
import { bodyShape } from '../../model/body';
import { formatMetres, planeNote, sheetsPlaneNote, zoneShareNote } from '../../model/describe';
import { gapClasses, gapsNote, suggestJoin } from '../../model/joinLength';
import { severalLodes, suggestLodes } from '../../model/lodes';
import { dipFromNormal } from '../../model/plane';
import { sideNames } from '../../model/geoModel';
import { holeLog, loggingColumns, loggingProblem, loggingTables, unitCounts, unitLog } from '../../model/logging';
import { followedBy, foundAs } from '../../model/modelCache';
import { bodySurface, contactSurface, makeVeinSystem, unitsLabel } from '../../model/sceneActions';
import { SHEETS_STRENGTH, type BodyRule, type ContactRule, type SceneCoords } from '../../model/types';
import { mapUnitCounts } from '../../model/unitActions';
import { veinPicks } from '../../model/vein';
import { HoleTableDialog } from './HoleTableDialog';
import { UnitsDialog } from './UnitsDialog';
import { plain, t } from '../../model/terms';

/** Before a unit map's id in the "Logging from" choice */
const UNITS = 'units:';

interface Props {
    open: boolean;
    /** The view's coordinate, hole and depth columns (for a new surface) */
    coords: SceneCoords | null;
    /** The surface whose choice is being changed (null: a new surface) */
    surfaceId: string | null;
    /** What a new surface is to be: one between units (the default), or a closed body round units */
    kind?: 'contact' | 'body';
    /** A new body starts as a vein (built from its two walls) */
    vein?: boolean;
    onClose: () => void;
}

/** a = the first side, or part of the body; b = the second side, or (for a body) a unit that says nothing either way */
type Side = 'a' | 'b';

/** At most this many units are listed (the ones with most intervals): a column of free text can hold thousands */
const MAX_LISTED = 200;

/** A length typed by the user: a number that is not negative, or nothing. */
/** A plane typed as a dip (0-90) and the direction it dips towards (0-360); null unless both are there */
const givenPlane = (dip: string, direction: string): { dip: number; dipDirection: number } | null => {
    const d = typed(dip), a = typed(direction);
    return d !== null && a !== null && d <= 90 && a <= 360 ? { dip: d, dipDirection: a % 360 } : null;
};

/** This many of the veins it may be are listed, the biggest */
const LODES_LISTED = 6;
/** With this share of the stretches as near another vein as their own, it is said */
const UNSURE_SAID = 0.1;

const typed = (text: string): number | null => {
    const v = Number(text.trim());
    return text.trim() !== '' && Number.isFinite(v) && v >= 0 ? v : null;
};

export const ContactDialog: React.FC<Props> = ({ open, onClose, ...rest }) => {
    // Each time it opens it starts from the surface's choices (or none): the form is made anew
    const [opened, setOpened] = useState(0);
    const [wasOpen, setWasOpen] = useState(false);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) setOpened(n => n + 1);
    }
    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            {opened > 0 && <ContactForm key={opened} onClose={onClose} {...rest} />}
        </Dialog>
    );
};

/** The gaps between stretches of a vein down the holes, counted by length: the ones a join length closes are picked out */
const GapBars: React.FC<{ gaps: readonly number[]; join: number }> = ({ gaps, join }) => {
    const classes = gapClasses(gaps);
    const most = Math.max(1, ...classes.map(c => c.count));
    const name = (v: number) => String(v);
    return (
        <Box data-testid="vein-gaps" role="img" aria-label="How long the gaps between its stretches are" sx={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: 62, maxWidth: 420 }}>
            {classes.map(c => {
                const closed = join > 0 && c.to <= join, part = join > 0 && !closed && c.from < join;
                const label = c.from === 0 ? `under ${name(c.to)} m` : c.to === Infinity ? `${name(c.from)} m and over` : `${name(c.from)} to ${name(c.to)} m`;
                return (
                    <Tooltip key={c.from} title={`${label}: ${c.count.toLocaleString()} ${c.count === 1 ? 'gap' : 'gaps'}${closed ? ', closed' : part ? ', some closed' : ''}`}>
                        <Box sx={{ flex: '0 1 36px', minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-end', height: '100%' }}>
                            <Box
                                data-closed={closed ? 'all' : part ? 'some' : 'none'}
                                sx={{ height: `${Math.max(c.count > 0 ? 2 : 0, Math.round(44 * c.count / most))}px`, borderRadius: '3px 3px 0 0', bgcolor: closed || part ? 'primary.main' : 'action.disabled', opacity: part ? 0.55 : 1 }}
                            />
                            <Typography sx={{ fontSize: 10, lineHeight: '16px', textAlign: 'center', color: 'text.secondary', whiteSpace: 'nowrap' }}>
                                {c.from === 0 ? `<${name(c.to)}` : c.to === Infinity ? `${name(c.from)}+` : name(c.from)}
                            </Typography>
                        </Box>
                    </Tooltip>
                );
            })}
        </Box>
    );
};

const ContactForm: React.FC<Omit<Props, 'open'>> = ({ coords: viewCoords, surfaceId, kind, vein: asVein = false, onClose }) => {
    const scene = useModelStore(s => s.scene);
    const surface = surfaceId ? scene.surfaces.find(s => s.id === surfaceId) ?? null : null;
    const editing = surface && (surface.rule.kind === 'contact' || surface.rule.kind === 'body') ? surface.rule : null;
    const body = editing ? editing.kind === 'body' : kind === 'body';
    // A surface that exists is in the scene's columns; a new one takes the view's
    const coords = surface ? scene.coords : viewCoords;

    // Where the logging is read from: '' the dataset's own columns, else a table logged down the holes, or the scene's model units
    const db = useDrillholeStore(s => s.db);
    const unitMaps = useModelStore(s => s.scene.unitMaps) ?? [];
    const [mapId, setMapId] = useState(() => editing?.units ?? '');
    const map = mapId ? unitMaps.find(m => m.id === mapId) ?? null : null;
    const [table, setTable] = useState(() => (editing?.units ? '' : editing?.table ?? ''));
    const [tablesOpen, setTablesOpen] = useState(false);
    const [unitsOpen, setUnitsOpen] = useState(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `db`: the tables are read from the store
    const tables = useMemo(() => loggingTables(), [db]);
    // The dataset does not change while this is up (it is modal); the tables may (one can be added from here)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `db`, as above
    const columns = useMemo(() => loggingColumns(coords, table || null), [coords, table, db]);
    const [column, setColumn] = useState(() => editing?.column ?? columns[0] ?? '');
    const readFrom = (id: string) => {
        setSides({});
        if (id.startsWith(UNITS)) {
            setMapId(id.slice(UNITS.length));
            setTable('');
            return;
        }
        setMapId('');
        setTable(id);
        setColumn(loggingColumns(coords, id || null)[0] ?? '');
    };
    const [sides, setSides] = useState<Record<string, Side>>(
        () => (!editing ? {} : Object.fromEntries(editing.kind === 'body'
            ? [...editing.inside.map(u => [u, 'a']), ...editing.ignore.map(u => [u, 'b'])]
            : [...editing.sideA.map(u => [u, 'a']), ...editing.sideB.map(u => [u, 'b'])])),
    );
    const [gap, setGap] = useState(() => (editing && editing.maxGap !== null ? String(editing.maxGap) : ''));
    const [thin, setThin] = useState(() => (editing && editing.minRun !== null ? String(editing.minRun) : ''));
    // A contact of a pile of layers (made with a model's chronology): the pile it reads each hole as, and whether it still does
    const [pile] = useState<string[] | null>(() => (editing && editing.kind === 'contact' && editing.pile?.length ? editing.pile : null));
    const [asPile, setAsPile] = useState(true);
    // A vein, dyke or shear zone: built from its two walls
    const [vein, setVein] = useState(() => (editing ? !!(editing.kind === 'body' && editing.vein) : asVein));
    const [least, setLeast] = useState(() => (editing && editing.kind === 'body' && editing.vein && editing.vein.least > 0 ? String(editing.vein.least) : ''));
    // Between holes it is kept along the lie of the ground (a new one is; one made before is as it was made)
    const [held, setHeld] = useState(() => (editing ? !!(editing.kind === 'body' && editing.vein?.held) : true));
    // Stretches of it close together down a hole are one zone
    const [join, setJoin] = useState(() => (editing && editing.kind === 'body' && editing.vein && (editing.vein.join ?? 0) > 0 ? String(editing.vein.join) : ''));
    // As thick as its zones, or as the units in them (its net thickness)
    const [net, setNet] = useState(() => !!(editing && editing.kind === 'body' && editing.vein?.thickness === 'net'));
    // The plane its sheets lie in, typed (both empty: worked out from the logging)
    const [planeDip, setPlaneDip] = useState(() => { const p = editing && editing.kind === 'body' ? editing.vein?.plane ?? editing.sheets?.plane : null; return p ? String(p.dip) : ''; });
    const [planeDir, setPlaneDir] = useState(() => { const p = editing && editing.kind === 'body' ? editing.vein?.plane ?? editing.sheets?.plane : null; return p ? String(p.dipDirection) : ''; });
    // An intrusion of thin sheets, built as a volume: its logging held strictly, and carried along the plane of its sheets
    const [sheets, setSheets] = useState(() => !!(editing && editing.kind === 'body' && !editing.vein && editing.sheets));
    const [carry, setCarry] = useState(() => (editing && editing.kind === 'body' && editing.sheets?.strength ? String(editing.sheets.strength) : ''));
    // ... other ground between its sheets read as part of it, and its small pieces left out
    const [sheetJoin, setSheetJoin] = useState(() => (editing && editing.kind === 'body' && editing.sheets?.join ? String(editing.sheets.join) : ''));
    const [sheetLeast, setSheetLeast] = useState(() => (editing && editing.kind === 'body' && editing.sheets?.least ? String(editing.sheets.least) : ''));
    // What it ends on (a splay on the vein it leaves), and the side of that it is on
    const [endId, setEndId] = useState(() => (editing && editing.kind === 'body' ? editing.vein?.endsOn?.surface ?? '' : ''));
    const [endSide, setEndSide] = useState<1 | -1>(() => (editing && editing.kind === 'body' ? editing.vein?.endsOn?.side ?? 1 : 1));
    // One vein of several that its units make (a lode): the stretches that are its own stay its own
    const [ownPicks] = useState(() => (editing && editing.kind === 'body' ? editing.vein?.picks ?? null : null));
    const others = scene.surfaces.filter(s => s.id !== surfaceId && !s.blockOf);
    const endOn = others.find(s => s.id === endId) ?? null;
    const closedOne = (s: { rule: { kind: string } }) => s.rule.kind === 'body' || s.rule.kind === 'shell';

    // eslint-disable-next-line react-hooks/exhaustive-deps -- `db`, as above
    const units = useMemo(() => (map ? mapUnitCounts(coords, map) ?? [] : column ? unitCounts(column, table || null) : []), [map, coords, column, table, db]);
    const rule = useMemo((): ContactRule | BodyRule => {
        const a = units.filter(u => sides[u.unit] === 'a').map(u => u.unit), b = units.filter(u => sides[u.unit] === 'b').map(u => u.unit);
        const gaps = { maxGap: typed(gap), minRun: typed(thin) || null };
        const source = map
            ? { column: map.columns[0], ...(map.table ? { table: map.table } : {}), units: map.id }
            : { column, ...(table ? { table } : {}) };
        return body
            ? { kind: 'body', ...source, inside: a, ignore: b, ...gaps, ...(vein ? { vein: { least: typed(least) ?? 0, ...((typed(join) ?? 0) > 0 ? { join: typed(join)!, ...(givenPlane(planeDip, planeDir) ? { plane: givenPlane(planeDip, planeDir)! } : {}), ...(net ? { thickness: 'net' as const } : {}) } : {}), ...(held ? { held: true as const } : {}), ...(endOn ? { endsOn: { surface: endOn.id, side: endSide } } : {}), ...(ownPicks ? { picks: ownPicks } : {}) } } : {}), ...(!vein && sheets ? { sheets: { ...((typed(carry) ?? 0) >= 1 ? { strength: typed(carry)! } : {}), ...(givenPlane(planeDip, planeDir) ? { plane: givenPlane(planeDip, planeDir)! } : {}), ...((typed(sheetJoin) ?? 0) > 0 ? { join: typed(sheetJoin)! } : {}), ...((typed(sheetLeast) ?? 0) > 0 ? { least: typed(sheetLeast)! } : {}) } } : {}) }
            : { kind: 'contact', ...source, sideA: a, sideB: b, ...gaps, ...(pile && asPile && map ? { pile } : {}) };
    }, [body, column, table, map, units, sides, gap, thin, vein, least, join, planeDip, planeDir, net, held, endOn, endSide, pile, asPile, ownPicks, sheets, carry, sheetJoin, sheetLeast]);
    const problem = mapId && !map ? 'These lithologies are no longer in the project.' : loggingProblem(coords, map ? map.table ?? null : table || null);
    const colorOf = new Map((map?.units ?? []).map(u => [u.name, u.color]));
    // A body needs something it is made of and something left outside it; a surface between units, a unit on each side
    const chosen = rule.kind === 'body'
        ? rule.inside.length > 0 && units.some(u => !sides[u.unit])
        : rule.sideA.length > 0 && rule.sideB.length > 0;
    const found = useMemo(() => {
        if (!chosen || problem) return null;
        const log = map ? unitLog(coords, map) : holeLog(coords, column, table || null);
        // (A vein that follows structural data has its plane from it: the surface's own choice of sets, or the model's for a new one)
        // (For a vein or thin sheets, with the gaps between its stretches: what a join length is chosen by)
        return log ? foundAs(log, rule, followedBy({ rule, params: surface?.params ?? {} }), rule.kind === 'body' && (!!rule.vein || !!rule.sheets)) : null;
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `db`, as above
    }, [chosen, problem, coords, column, table, map, rule, db, surface, scene.structure]);
    const suggested = useMemo(() => (found?.gaps ? suggestJoin(found.gaps) : null), [found]);
    const contacts = found ? found.contacts.length / 3 : 0;
    const stretches = useMemo(() => (found && vein ? veinPicks(found.list).stretches.length / 6 : 0), [found, vein]);
    // (How many times a hole that meets it goes through it: well over once, and it is a swarm, not one vein)
    const perHole = found && vein && found.holesWithContact > 0 ? stretches / found.holesWithContact : 0;
    // The veins it may be, told apart (lodes.ts): said when it looks like several. Not for one that is a lode already
    const lodes = useMemo(() => {
        const suggestion = found && vein && !ownPicks && rule.kind === 'body' ? suggestLodes(found, { join: rule.vein?.join ?? 0 }) : null;
        return severalLodes(suggestion) ? suggestion : null;
    }, [found, vein, ownPicks, rule]);
    // An intrusion thin against the gaps between its holes: the thin-sheets choice is pointed out
    const thinBody = useMemo(() => !!found && body && !vein && bodyShape(found.middles).thin, [found, body, vein]);
    // A vein is built from the holes that go right through it
    const noWalls = body && vein && !!found && contacts > 0 && stretches === 0;

    const accept = () => {
        if (!coords || !chosen) return;
        const model = useModelStore.getState();
        if (surface && editing && rule.kind === 'body' && editing.kind === 'body') {
            // A name still the one made from the units follows the new units
            model.updateSurface(surface.id, { rule, ...(surface.name === unitsLabel(editing.inside) ? { name: unitsLabel(rule.inside) } : {}) });
        } else if (surface && editing && rule.kind === 'contact' && editing.kind === 'contact') {
            // Side names still the ones made from the units follow the new units
            const automatic = surface.sides && surface.sides[0] === unitsLabel(editing.sideA) && surface.sides[1] === unitsLabel(editing.sideB);
            model.updateSurface(surface.id, { rule, ...(automatic || !surface.sides ? { sides: [unitsLabel(rule.sideA), unitsLabel(rule.sideB)] } : {}) });
        } else {
            const id = rule.kind === 'body' ? bodySurface(coords, rule) : contactSurface(coords, rule);
            if (id) model.setEditing(id);
        }
        onClose();
    };

    /** A vein for each lode: the one being changed becomes the first, the rest are new */
    const acceptLodes = () => {
        if (!coords || !lodes || rule.kind !== 'body' || !rule.vein) return;
        const model = useModelStore.getState();
        // (All of them across the one plane the lodes were told apart in)
        const plane = dipFromNormal(lodes.normal);
        // A vein of each, held as one vein system
        const made = makeVeinSystem(
            coords, unitsLabel(rule.inside), lodes.lodes.map(lode => ({ ...rule, vein: { ...rule.vein!, plane, picks: lode.picks } })),
            surface && editing?.kind === 'body' ? surface.id : null,
        );
        if (made) model.setEditing(made.first);
        onClose();
    };

    return (
        <>
            <DialogTitle>
                {body ? (editing ? 'Change the units it is made of' : vein ? 'Vein' : 'Intrusion') : editing ? 'Change the units either side' : 'Contact surface'}
            </DialogTitle>
            <DialogContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, mt: 0.5 }}>
                    {(tables.length > 0 || table || unitMaps.length > 0 || mapId) && (
                        <FormControl size="small" sx={{ flex: 1, minWidth: 0 }}>
                            <InputLabel id="contact-table">Logging from</InputLabel>
                            <Select labelId="contact-table" label="Logging from" value={mapId ? UNITS + mapId : table} onChange={e => readFrom(e.target.value)}>
                                <MenuItem value="">The samples (columns of the dataset)</MenuItem>
                                {tables.map(t => <MenuItem key={t.id} value={t.id}>{t.name} (as logged, {t.rows.toLocaleString()} intervals)</MenuItem>)}
                                {table && !tables.some(t => t.id === table) && <MenuItem value={table} disabled>A table that is no longer in the project</MenuItem>}
                                {unitMaps.map(m => <MenuItem key={m.id} value={UNITS + m.id}>{t('lithologies')}: {m.name} ({m.units.length} units)</MenuItem>)}
                                {mapId && !map && <MenuItem value={UNITS + mapId} disabled>{t('lithologies')} no longer in the project</MenuItem>}
                            </Select>
                        </FormControl>
                    )}
                    <Button size="small" sx={{ textTransform: 'none', flexShrink: 0 }} onClick={() => setTablesOpen(true)}>
                        {tables.length > 0 ? 'Logging tables…' : 'Read the logging from its own file…'}
                    </Button>
                    <Tooltip title="Group logged codes into the units the model is built of">
                        <Button size="small" sx={{ textTransform: 'none', flexShrink: 0 }} onClick={() => setUnitsOpen(true)}>{t('lithologies')}…</Button>
                    </Tooltip>
                </Box>
                <HoleTableDialog open={tablesOpen} onClose={() => setTablesOpen(false)} onAdded={id => { if (loggingTables().some(t => t.id === id)) readFrom(id); }} />
                <UnitsDialog open={unitsOpen} coords={coords} mapId={mapId || null} onClose={() => setUnitsOpen(false)} />
                {problem ? <Alert severity="warning">{problem}</Alert> : !map && columns.length === 0 ? (
                    <Alert severity="warning">{table ? 'This table has no column to read logging from.' : 'This dataset has no text column to read logging from.'}</Alert>
                ) : (
                    <>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            {body
                                ? 'Say which logged units it is made of. A closed surface is put round them: it passes through every place a hole goes into or out of them, and every other logged unit is kept outside it. Mark as Unknown any unit that says nothing either way (not logged, core loss).'
                                : 'Say which logged units lie on each side. The surface is put where one side gives way to the other down each drillhole, and runs from hole to hole. Units left out are not used.'}
                        </Typography>
                        {!map && <FormControl size="small" fullWidth>
                            <InputLabel id="contact-column">Logging column</InputLabel>
                            <Select
                                labelId="contact-column" label="Logging column" value={columns.includes(column) ? column : ''}
                                onChange={e => { setColumn(e.target.value); setSides({}); }}
                            >
                                {columns.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                            </Select>
                        </FormControl>}
                        <Box data-testid="contact-units" sx={{ mt: 1.5, maxHeight: 280, overflowY: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
                            {units.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>This column is empty.</Typography>}
                            {units.slice(0, MAX_LISTED).map(({ unit, count }) => (
                                <Box key={unit} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.25, borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}>
                                    {map && <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: colorOf.get(unit), flexShrink: 0 }} />}
                                    <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>{unit}</Typography>
                                    <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>{count.toLocaleString()}</Typography>
                                    <ToggleButtonGroup
                                        size="small" exclusive value={sides[unit] ?? null} aria-label={`Side of ${unit}`}
                                        onChange={(_, v: Side | null) => setSides(s => {
                                            const next = { ...s };
                                            if (v) next[unit] = v;
                                            else delete next[unit];
                                            return next;
                                        })}
                                    >
                                        <ToggleButton value="a" sx={{ textTransform: 'none', py: 0, fontSize: 12 }}>{body ? 'Inside' : 'First side'}</ToggleButton>
                                        <ToggleButton value="b" sx={{ textTransform: 'none', py: 0, fontSize: 12 }}>{body ? 'Unknown' : 'Second side'}</ToggleButton>
                                    </ToggleButtonGroup>
                                </Box>
                            ))}
                            {units.length > MAX_LISTED && (
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', p: 1 }}>
                                    {(units.length - MAX_LISTED).toLocaleString()} more, with fewer intervals each, are not listed.
                                </Typography>
                            )}
                        </Box>
                        <Box sx={{ display: 'flex', gap: 1.5, mt: 2 }}>
                            <TextField
                                size="small" fullWidth label="Longest unlogged gap to bridge (m)" value={gap} onChange={e => setGap(e.target.value)}
                                placeholder={found ? `Automatic: ${formatMetres(found.maxGap)}` : 'Automatic'} InputLabelProps={{ shrink: true }}
                                helperText="With more than this between the two sides, the contact could be anywhere in the gap: no point is made."
                            />
                            <TextField
                                size="small" fullWidth label="Leave out units thinner than (m)" value={thin} onChange={e => setThin(e.target.value)}
                                placeholder="None" InputLabelProps={{ shrink: true }}
                                helperText={body ? 'A thin band of it in other rock, or of other rock in it, is passed over.' : 'A thin band of one side inside the other would put a pocket in the surface.'}
                            />
                        </Box>
                        {!body && pile && map && (
                            <Box sx={{ mt: 1.5 }}>
                                <FormControlLabel
                                    control={<Checkbox size="small" checked={asPile} onChange={e => setAsPile(e.target.checked)} />}
                                    label={<Typography variant="body2">Read each hole as a pile of layers</Typography>}
                                />
                                <Typography data-testid="contact-pile" variant="caption" color="text.secondary" sx={{ display: 'block', ml: 3.75, mt: -0.5 }}>
                                    {pile.join(', ')} (the youngest first). Along a hole a layer is met once: a stretch that is out of order is read as the layer round it,
                                    or left out between two layers, so this contact is met at most once in a hole. Unticked, every change of side down a hole is a contact.
                                    {found?.pile && found.pile.changed > 0 ? ` As it stands ${formatMetres(found.pile.changed)} of ${formatMetres(found.pile.metres)} is out of order.` : ''}
                                </Typography>
                            </Box>
                        )}
                        {body && (
                            <Box sx={{ mt: 1.5 }}>
                                <FormControlLabel
                                    control={<Checkbox size="small" checked={vein} onChange={e => setVein(e.target.checked)} />}
                                    label={<Typography variant="body2">It is a vein, dyke or shear zone</Typography>}
                                />
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 3.5, mt: -0.5 }}>
                                    Something thin against the gaps between the holes. It is built from its two walls: a surface through the middle of it,
                                    and how far each wall is from that, carried from hole to hole. It stays in one piece however thin it is, and it stops
                                    before a hole that goes through where it would be without meeting it.
                                </Typography>
                                {vein && (
                                    <Box sx={{ display: 'flex', gap: 1.5, mt: 1.5, ml: 3.5 }}>
                                        <TextField
                                            size="small" label="Never thinner than (m)" value={least} onChange={e => setLeast(e.target.value)}
                                            placeholder="It may taper to nothing" InputLabelProps={{ shrink: true }} sx={{ flex: 1, minWidth: 0 }}
                                        />
                                        <TextField
                                            size="small" label="One zone when closer than (m)" value={join} onChange={e => setJoin(e.target.value)}
                                            placeholder="Every stretch on its own" InputLabelProps={{ shrink: true }} sx={{ flex: 1, minWidth: 0 }}
                                            inputProps={{ 'data-testid': 'vein-join' }}
                                        />
                                    </Box>
                                )}
                                {vein && (
                                    <Typography data-testid="vein-join-note" variant="caption" color={perHole > 1.5 ? 'warning.main' : 'text.secondary'} sx={{ display: 'block', ml: 3.5, mt: 0.5 }}>
                                        {perHole > 1.5
                                            ? `Holes go through it ${perHole.toFixed(1)} times each, on average: as it stands, one vein is put through all of those. For a swarm of thin dykes or veins, give the distance within which they are one zone; the vein is then the zone, with its two walls.`
                                            : 'A swarm of thin dykes or veins is read as one zone when they are closer together than this. Left empty, every stretch of it is on its own.'}
                                        {found?.joinPlane && found.joinPlaneFrom === 'cloud' ? ' The distance is measured across the plane its stretches lie closest to, so holes at a low angle to it count as holes square to it do.' : ''}
                                        {found?.joinPlane && found.joinPlaneFrom && found.joinPlaneFrom !== 'cloud' ? ` ${planeNote(found.joinPlaneFrom, found.joinPlane, found.cloudPlane ?? null, found.loggingPlane ?? null)} The distance is measured across that plane.` : ''}
                                        {found?.joined ? ` ${found.joined.gaps.toLocaleString()} ${found.joined.gaps === 1 ? 'gap is' : 'gaps are'} closed: the zones take in ${formatMetres(found.joined.metres)} of other ground.` : ''}
                                    </Typography>
                                )}
                                {vein && found?.gaps && found.gaps.length > 0 && (
                                    <Box sx={{ ml: 3.5, mt: 1 }}>
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>
                                            The gaps between its stretches down the holes, by how long they are (m)
                                        </Typography>
                                        <GapBars gaps={found.gaps} join={typed(join) ?? 0} />
                                        <Typography data-testid="vein-gaps-note" variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                                            {gapsNote(found.gaps, typed(join) ?? 0)}
                                            {suggested && suggested.length !== (typed(join) ?? 0) && (
                                                <Button size="small" onClick={() => setJoin(String(suggested.length))} sx={{ ml: 1, py: 0, minWidth: 0, textTransform: 'none', verticalAlign: 'baseline' }}>
                                                    Use {suggested.length} m
                                                </Button>
                                            )}
                                        </Typography>
                                    </Box>
                                )}
                                {vein && (typed(join) ?? 0) > 0 && found?.zones && (
                                    <Box sx={{ ml: 3.5, mt: 1 }}>
                                        <Typography data-testid="vein-zone-share" variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                            {zoneShareNote(found.zones)}
                                        </Typography>
                                        <RadioGroup row value={net ? 'net' : 'zone'} onChange={e => setNet(e.target.value === 'net')}>
                                            <FormControlLabel value="zone" control={<Radio size="small" />} label={<Typography variant="body2">As thick as its zones</Typography>} />
                                            <FormControlLabel value="net" control={<Radio size="small" />} label={<Typography variant="body2">As thick as the units in them (net thickness)</Typography>} />
                                        </RadioGroup>
                                    </Box>
                                )}
                                {vein && (typed(join) ?? 0) > 0 && (
                                    <Box sx={{ display: 'flex', gap: 1.5, mt: 1, ml: 3.5 }}>
                                        <TextField
                                            size="small" label={'Its sheets dip (\u00b0)'} value={planeDip} onChange={e => setPlaneDip(e.target.value)}
                                            placeholder={found?.joinPlane && found.joinPlaneFrom !== 'given' ? `${Math.round(dipFromNormal(found.joinPlane).dip)}, worked out` : 'Worked out'}
                                            InputLabelProps={{ shrink: true }} sx={{ flex: 1, minWidth: 0 }} inputProps={{ 'data-testid': 'vein-plane-dip' }}
                                        />
                                        <TextField
                                            size="small" label={'towards (\u00b0 from north)'} value={planeDir} onChange={e => setPlaneDir(e.target.value)}
                                            placeholder={found?.joinPlane && found.joinPlaneFrom !== 'given' ? `${Math.round(dipFromNormal(found.joinPlane).dipDirection) % 360}, worked out` : 'Worked out'}
                                            InputLabelProps={{ shrink: true }} sx={{ flex: 1, minWidth: 0 }} inputProps={{ 'data-testid': 'vein-plane-direction' }}
                                        />
                                    </Box>
                                )}
                                {vein && (
                                    <Box sx={{ ml: 3.5, mt: 0.5 }}>
                                        <FormControlLabel
                                            control={<Checkbox size="small" checked={held} onChange={e => setHeld(e.target.checked)} />}
                                            label={<Typography variant="body2">Keep it along the lie of the ground between holes</Typography>}
                                        />
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 3.5, mt: -0.5 }}>
                                            At every hole it lies as the structural data it follows says there, and where that says nothing, along the plane
                                            the holes meet it in. Unticked, it only passes through the middle of each stretch: among holes that meet
                                            several veins of a set, it then folds from one to the next.
                                        </Typography>
                                    </Box>
                                )}
                                {vein && lodes && (
                                    <Box data-testid="vein-lodes" sx={{ ml: 3.5, mt: 1.5, p: 1.25, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                                        <Typography variant="body2" sx={{ fontWeight: 600 }}>It looks like {lodes.lodes.length} veins side by side</Typography>
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                                            Stretches that are level with each other across its plane, from one hole to the next, are taken as one vein.
                                            {' '}{lodes.lodes.slice(0, LODES_LISTED).map((l, k) => `${k + 1}: ${l.zones.length.toLocaleString()} holes, ${formatMetres(l.metres)}`).join('; ')}
                                            {lodes.lodes.length > LODES_LISTED ? `; and ${lodes.lodes.length - LODES_LISTED} smaller.` : '.'}
                                            {lodes.loose > 0 ? ` ${lodes.loose.toLocaleString()} ${lodes.loose === 1 ? 'stretch is' : 'stretches are'} in none (fewer than ${lodes.choice.least} together).` : ''}
                                        </Typography>
                                        {lodes.unsure >= UNSURE_SAID * lodes.zones.length && (
                                            <Typography data-testid="vein-lodes-unsure" variant="caption" color="warning.main" sx={{ display: 'block', mt: 0.5 }}>
                                                For {lodes.unsure.toLocaleString()} of the {lodes.zones.length.toLocaleString()} stretches, another vein is about as near as their own:
                                                the veins are as close together as they are uneven, and which stretch is of which wants checking on sections.
                                            </Typography>
                                        )}
                                        <Button data-testid="vein-lodes-make" size="small" variant="outlined" sx={{ mt: 1, textTransform: 'none' }} disabled={!!problem || !chosen} onClick={acceptLodes}>
                                            Make a vein of each
                                        </Button>
                                    </Box>
                                )}
                                {vein && others.length > 0 && (
                                    <Box sx={{ display: 'flex', gap: 1.5, mt: 1.5, ml: 3.5 }}>
                                        <FormControl size="small" sx={{ flex: 1, minWidth: 0 }}>
                                            <InputLabel id="vein-ends" shrink>It ends on</InputLabel>
                                            <Select
                                                labelId="vein-ends" label="It ends on" notched displayEmpty value={endOn ? endOn.id : ''}
                                                onChange={e => {
                                                    const next = others.find(s => s.id === e.target.value);
                                                    setEndId(next?.id ?? '');
                                                    // Outside a closed one; the first side of an open one
                                                    setEndSide(next && closedOne(next) ? -1 : 1);
                                                }}
                                            >
                                                <MenuItem value="">Nothing: it runs as far as its holes take it</MenuItem>
                                                {others.map(s => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
                                            </Select>
                                        </FormControl>
                                        {endOn && (
                                            <FormControl size="small" sx={{ flex: 1, minWidth: 0 }}>
                                                <InputLabel id="vein-ends-side">It is</InputLabel>
                                                <Select labelId="vein-ends-side" label="It is" value={endSide} onChange={e => setEndSide(Number(e.target.value) === -1 ? -1 : 1)}>
                                                    {([1, -1] as const).map(k => {
                                                        const side = sideNames(endOn)[k === 1 ? 0 : 1];
                                                        return <MenuItem key={k} value={k}>{/^(inside|outside|above|below)\b/.test(side) ? `${side} it` : `on its ${side}`}</MenuItem>;
                                                    })}
                                                </Select>
                                            </FormControl>
                                        )}
                                    </Box>
                                )}
                            </Box>
                        )}
                        {body && !vein && (
                            <Box sx={{ mt: 1 }}>
                                <Tooltip title={plain('thinSheets')} placement="top-start">
                                    <FormControlLabel
                                        data-term="thinSheets"
                                        control={<Checkbox size="small" checked={sheets} onChange={e => setSheets(e.target.checked)} />}
                                        label={<Typography variant="body2">It is a set of thin sheets (dykes, sills), built as a volume</Typography>}
                                    />
                                </Tooltip>
                                <Typography data-testid="body-sheets-note" variant="caption" color={!sheets && thinBody ? 'warning.main' : 'text.secondary'} sx={{ display: 'block', ml: 3.5, mt: -0.5 }}>
                                    {!sheets && thinBody ? 'It is thin against the gaps between the holes. ' : ''}
                                    Sheets side by side that split and join, where no two walls can be told apart. Every logged interval is held on its own side of its skin:
                                    left unticked, an interval beside the skin may lie up to half inside it, and a body thinner than its sampling comes out much fatter
                                    than what was logged. It is carried further along the plane of its sheets than across them, so that it holds together from hole to hole.
                                    {sheets && found?.joinPlane && found.joinPlaneFrom ? ` ${sheetsPlaneNote(found.joinPlaneFrom, found.joinPlane, found.cloudPlane ?? null, found.loggingPlane ?? null)}` : ''}
                                    {sheets && found && !found.joinPlane ? ' Too few holes meet it to say how its sheets lie: give their dip, or it is carried the same every way.' : ''}
                                </Typography>
                                {sheets && (
                                    <Box sx={{ display: 'flex', gap: 1.5, mt: 1, ml: 3.5 }}>
                                        <TextField
                                            size="small" label="Carried along its sheets (times)" value={carry} onChange={e => setCarry(e.target.value)}
                                            placeholder={String(SHEETS_STRENGTH)} InputLabelProps={{ shrink: true }} sx={{ flex: 1, minWidth: 0 }} inputProps={{ 'data-testid': 'body-sheets-strength' }}
                                        />
                                        <TextField
                                            size="small" label={'Its sheets dip (\u00b0)'} value={planeDip} onChange={e => setPlaneDip(e.target.value)}
                                            placeholder={found?.joinPlane && found.joinPlaneFrom !== 'given' ? `${Math.round(dipFromNormal(found.joinPlane).dip)}, worked out` : 'Worked out'}
                                            InputLabelProps={{ shrink: true }} sx={{ flex: 1, minWidth: 0 }} inputProps={{ 'data-testid': 'body-sheets-dip' }}
                                        />
                                        <TextField
                                            size="small" label={'towards (\u00b0 from north)'} value={planeDir} onChange={e => setPlaneDir(e.target.value)}
                                            placeholder={found?.joinPlane && found.joinPlaneFrom !== 'given' ? `${Math.round(dipFromNormal(found.joinPlane).dipDirection) % 360}, worked out` : 'Worked out'}
                                            InputLabelProps={{ shrink: true }} sx={{ flex: 1, minWidth: 0 }} inputProps={{ 'data-testid': 'body-sheets-direction' }}
                                        />
                                    </Box>
                                )}
                                {sheets && (
                                    <Box sx={{ mt: 1.5, ml: 3.5 }}>
                                        <Box sx={{ display: 'flex', gap: 1.5 }}>
                                            <TextField
                                                size="small" label="Take in other ground thinner than (m)" value={sheetJoin} onChange={e => setSheetJoin(e.target.value)}
                                                placeholder="None" InputLabelProps={{ shrink: true }} sx={{ flex: 1, minWidth: 0 }} inputProps={{ 'data-testid': 'body-sheets-join' }}
                                            />
                                            <TextField
                                                size="small" label={'Leave out pieces under (m\u00b3)'} value={sheetLeast} onChange={e => setSheetLeast(e.target.value)}
                                                placeholder="None" InputLabelProps={{ shrink: true }} sx={{ flex: 1, minWidth: 0 }} inputProps={{ 'data-testid': 'body-sheets-least' }}
                                            />
                                        </Box>
                                        <Typography data-testid="body-sheets-join-note" variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                                            Other ground between two stretches of it down a hole, thinner than this across its sheets, is read as part of it. It then holds together
                                            further from hole to hole and is found in more of the ground between them, and more of what it holds is not its units: a trade, not a gain.
                                            {found?.joined ? ` ${found.joined.gaps.toLocaleString()} ${found.joined.gaps === 1 ? 'gap is' : 'gaps are'} closed, ${formatMetres(found.joined.metres)} of hole.` : ''}
                                            {(typed(sheetJoin) ?? 0) > 0 && found && !found.joined ? ' No gap is that short.' : ''}
                                            {(typed(sheetJoin) ?? 0) > 0 && found?.zones && found.zones.count > 0 ? ` ${zoneShareNote(found.zones)}` : ''}
                                        </Typography>
                                        {found?.gaps && found.gaps.length > 0 && (
                                            <Box data-testid="body-sheets-gaps" sx={{ mt: 0.5 }}>
                                                <GapBars gaps={found.gaps} join={typed(sheetJoin) ?? 0} />
                                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                                    {gapsNote(found.gaps, typed(sheetJoin) ?? 0)}
                                                </Typography>
                                            </Box>
                                        )}
                                    </Box>
                                )}
                            </Box>
                        )}
                        <Typography data-testid="contact-preview" variant="body2" sx={{ mt: 2 }} color={(chosen && found && contacts === 0) || noWalls ? 'warning.main' : 'text.primary'}>
                            {!chosen ? (!body ? 'Choose at least one unit for each side.' : rule.kind === 'body' && rule.inside.length > 0 ? 'Leave at least one unit outside it.' : 'Choose at least one unit it is made of.')
                                : !found ? 'The columns this needs are not in the dataset.'
                                    : contacts === 0 ? (body ? 'No hole passes into or out of these units.' : 'No contacts: no hole passes from one side to the other.')
                                        : noWalls ? 'No hole goes right through it (in one wall and out of the other), so there is nothing to build a vein from.'
                                            : `${contacts.toLocaleString()} contact${contacts === 1 ? '' : 's'} in ${found.holesWithContact.toLocaleString()} of ${found.holes.toLocaleString()} holes.${body && vein ? ` ${stretches.toLocaleString()} ${stretches === 1 ? 'place' : 'places'} where a hole goes right through it.` : ''}`}
                            {found && found.gapsLeftOut > 0 ? ` ${found.gapsLeftOut.toLocaleString()} left out: the gap between the two sides is too long.` : ''}
                        </Typography>
                    </>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" disabled={!!problem || !chosen || !found || contacts === 0 || noWalls} onClick={accept}>
                    {editing ? 'Change it' : body && vein ? 'Make the vein' : body ? 'Make the body' : 'Make the surface'}
                </Button>
            </DialogActions>
        </>
    );
};
