/**
 * Orientation readings for the whole model from the columns of a table: the
 * data that is open, a CSV file (features/model/structureReadings), or a
 * table logged down the holes (features/model/holeReadings). Each row with a
 * place and both angles is a reading; a column that names what was measured
 * can split them into sets.
 *
 * A row of a table logged down the holes is placed at its depth on the path
 * of its hole, and its plane may be given as the alpha and beta measured on
 * oriented core.
 */
import React, { useMemo, useRef, useState } from 'react';
import {
    Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel, InputLabel, MenuItem, Radio, RadioGroup, Select, TextField,
    Typography,
} from '@mui/material';
import { useAppStore } from '../../../store/appStore';
import { useDrillholeStore } from '../../../store/drillholeStore';
import { guessCoreColumns, setsFromHoleTable, type CoreReference } from '../../model/holeReadings';
import { tableText } from '../../model/drillholes';
import { pathsFor } from '../../model/logging';
import { addReadingSets } from '../../model/sceneActions';
import { columnValues, guessStructureColumns, MAX_SETS, MAX_SET_READINGS, setsFromTable, tableFromCsv, type CsvTable, type ReadingTable, type RowsWhere } from '../../model/structureReadings';
import type { SceneCoords } from '../../model/types';
import { guessAxisColumn } from './coordinateColumns';
import { HoleTableDialog } from './HoleTableDialog';

interface Props {
    open: boolean;
    /** The view's coordinate columns: readings are placed in them */
    coords: SceneCoords | null;
    onClose: () => void;
}

const NUMERIC = new Set(['numeric', 'float', 'integer']);
const SHOWN = 6;

const Pick: React.FC<{ id: string; label: string; value: string; options: readonly string[]; onChange: (v: string) => void; none?: string }> = ({ id, label, value, options, onChange, none }) => (
    <FormControl size="small" fullWidth>
        <InputLabel id={id} shrink>{label}</InputLabel>
        <Select labelId={id} label={label} notched displayEmpty value={options.includes(value) ? value : ''} onChange={e => onChange(e.target.value)}>
            {none !== undefined && <MenuItem value=""><em>{none}</em></MenuItem>}
            {options.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
        </Select>
    </FormControl>
);

/** Several of a column's values, each with how many rows have it */
const PickMany: React.FC<{ id: string; label: string; value: readonly string[]; options: readonly { value: string; rows: number }[]; onChange: (v: string[]) => void; disabled?: boolean }> = ({ id, label, value, options, onChange, disabled }) => (
    <FormControl size="small" fullWidth disabled={disabled}>
        <InputLabel id={id} shrink>{label}</InputLabel>
        <Select
            labelId={id} label={label} notched displayEmpty multiple value={value.filter(v => options.some(o => o.value === v))}
            onChange={e => onChange(typeof e.target.value === 'string' ? e.target.value.split(',') : [...e.target.value])}
            renderValue={picked => (picked.length === 0 ? <em>Any value</em> : picked.join(', '))} MenuProps={{ PaperProps: { sx: { maxHeight: 320 } } }}
        >
            {options.map(o => <MenuItem key={o.value} value={o.value} dense>{o.value} ({o.rows.toLocaleString()})</MenuItem>)}
        </Select>
    </FormControl>
);

const NO_ROWS_WHERE: RowsWhere[] = [{ column: '', values: [] }, { column: '', values: [] }];

const Body: React.FC<Omit<Props, 'open'>> = ({ coords, onClose }) => {
    const [dataColumns] = useState(() => {
        const { columns } = useAppStore.getState();
        return { numeric: columns.filter(c => NUMERIC.has(c.type)).map(c => c.name), text: columns.filter(c => !NUMERIC.has(c.type)).map(c => c.name) };
    });
    const [selected] = useState(() => useAppStore.getState().selectedIndices);
    const [source, setSource] = useState<'data' | 'file' | 'table'>('data');
    const [file, setFile] = useState<{ name: string; csv: CsvTable } | null>(null);
    const [fileProblem, setFileProblem] = useState<string | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    // A table logged down the holes: its rows are placed by hole and depth
    const db = useDrillholeStore(s => s.db);
    const [tableId, setTableId] = useState('');
    const [tablesOpen, setTablesOpen] = useState(false);
    const logged = source === 'table' ? db?.tables.find(t => t.id === tableId) ?? null : null;
    const loggedColumns = useMemo(() => ({
        numeric: (logged?.columns ?? []).filter(c => c.values instanceof Float64Array).map(c => c.name),
        all: (logged?.columns ?? []).map(c => c.name),
    }), [logged]);
    // The holes' paths, where they are in the coordinates of this view
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `db`: the paths are read from the store
    const paths = useMemo(() => (source === 'table' ? pathsFor(coords) : null), [source, coords, db]);

    const numeric = source === 'file' ? file?.csv.numericNames ?? [] : source === 'table' ? loggedColumns.numeric : dataColumns.numeric;
    // Any column can name what was measured: codes are often numbers
    const naming = source === 'file' ? file?.csv.names ?? [] : source === 'table' ? loggedColumns.all : [...dataColumns.text, ...dataColumns.numeric];
    const [first] = useState(() => guessStructureColumns(dataColumns.numeric, dataColumns.text));

    const [kind, setKind] = useState<'plane' | 'line'>(!first.dip && first.plunge ? 'line' : 'plane');
    const [byStrike, setByStrike] = useState(!first.direction && !!first.strike);
    const [dip, setDip] = useState(first.dip);
    const [direction, setDirection] = useState(first.direction);
    const [strike, setStrike] = useState(first.strike);
    const [plunge, setPlunge] = useState(first.plunge);
    const [trend, setTrend] = useState(first.trend);
    const [place, setPlace] = useState({ x: '', y: '', z: '' });
    // Planes measured on oriented core (a table logged down the holes only)
    const [byCore, setByCore] = useState(false);
    const [alpha, setAlpha] = useState('');
    const [beta, setBeta] = useState('');
    const [reference, setReference] = useState<CoreReference>('bottom');
    const [splitBy, setSplitBy] = useState('');
    // Only the rows that hold given values in up to two columns (a kind of structure, of a quality)
    const [only, setOnly] = useState<RowsWhere[]>(NO_ROWS_WHERE);
    const [name, setName] = useState('');
    const [rows, setRows] = useState<'selected' | 'all'>(selected.length > 0 ? 'selected' : 'all');
    const [problem, setProblem] = useState<string | null>(null);

    const readFile = async (picked: File) => {
        try {
            const csv = tableFromCsv(await picked.text());
            const guess = guessStructureColumns(csv.numericNames, csv.names);
            const axes = csv.numericNames.map(n => ({ name: n, type: 'numeric', role: null }));
            setFile({ name: picked.name, csv });
            setFileProblem(null);
            setDip(guess.dip);
            setDirection(guess.direction);
            setStrike(guess.strike);
            setPlunge(guess.plunge);
            setTrend(guess.trend);
            setByStrike(!guess.direction && !!guess.strike);
            setKind(!guess.dip && guess.plunge ? 'line' : 'plane');
            setPlace({ x: guessAxisColumn(axes, 'x'), y: guessAxisColumn(axes, 'y'), z: guessAxisColumn(axes, 'z') });
            setSplitBy(guess.type);
            setOnly(NO_ROWS_WHERE);
        } catch (e) {
            setFile(null);
            setFileProblem(`${picked.name} could not be read. ${e instanceof Error ? e.message : ''}`.trim());
        }
    };

    /** Takes up a table logged down the holes: its columns are guessed by their names */
    const readTable = (id: string) => {
        const picked = useDrillholeStore.getState().db?.tables.find(t => t.id === id);
        setTableId(picked ? id : '');
        setProblem(null);
        if (!picked) return;
        const numbers = picked.columns.filter(c => c.values instanceof Float64Array).map(c => c.name);
        const guess = guessStructureColumns(numbers, picked.columns.map(c => c.name));
        const core = guessCoreColumns(numbers);
        setDip(guess.dip);
        setDirection(guess.direction);
        setStrike(guess.strike);
        setPlunge(guess.plunge);
        setTrend(guess.trend);
        setAlpha(core.alpha);
        setBeta(core.beta);
        setByCore(!guess.dip && !!core.alpha && !!core.beta);
        setByStrike(!guess.direction && !!guess.strike);
        setKind(!guess.dip && !core.alpha && guess.plunge ? 'line' : 'plane');
        setSplitBy(guess.type);
        setOnly(NO_ROWS_WHERE);
    };
    const changeSource = (next: 'data' | 'file' | 'table') => {
        setSource(next);
        setProblem(null);
        setOnly(NO_ROWS_WHERE);
        // The first table is taken up, unless one already is
        if (next === 'table' && !db?.tables.some(t => t.id === tableId) && db?.tables.length) readTable(db.tables[0].id);
    };
    const onCore = source === 'table' && kind === 'plane' && byCore;

    const table = useMemo((): ReadingTable | null => {
        if (source === 'table') return null;
        if (source === 'file') return file ? file.csv.table : null;
        const app = useAppStore.getState();
        return { numeric: n => app.getNumericColumn(n), text: n => app.getRawColumn(n) };
    }, [source, file]);
    const xyz = source === 'file' ? place : { x: coords?.x ?? '', y: coords?.y ?? '', z: coords?.z ?? '' };
    const angle = kind === 'line' ? plunge : dip;
    const bearing = kind === 'line' ? trend : byStrike ? strike : direction;
    // The columns as rows are chosen by them, whichever table is read
    const reader = useMemo((): ReadingTable | null => (source === 'table'
        ? (logged ? { numeric: n => { const v = logged.columns.find(c => c.name === n)?.values; return v instanceof Float64Array ? v : null; }, text: n => tableText(logged, n) } : null)
        : table), [source, logged, table]);
    const where = useMemo(() => only.filter(o => o.column && o.values.length > 0), [only]);
    const offered = useMemo(
        () => only.map((o, k) => (o.column && reader ? columnValues(reader, o.column, only.filter((other, j) => j < k && other.column && other.values.length > 0)) : [])),
        [only, reader],
    );
    const setWhere = (k: number, next: Partial<RowsWhere>) => {
        setProblem(null);
        setOnly(was => was.map((o, j) => (j === k ? { ...o, ...next, ...(next.column !== undefined && next.column !== o.column ? { values: [] } : {}) } : o)));
    };
    // (One set of the rows of one or two values: named by them)
    const usualName = !splitBy && where.length > 0 && where[0].values.length <= 2 ? where[0].values.join(' + ') : kind === 'line' ? 'Lines' : 'Planes';
    const chosen = !!table && !!angle && !!bearing && !!xyz.x && !!xyz.y && !!xyz.z;
    const found = useMemo(() => {
        if (source === 'table') {
            if (!logged || !paths || paths.size === 0 || (onCore ? !alpha || !beta : !angle || !bearing)) return null;
            return setsFromHoleTable(logged, paths, {
                kind, dip: angle, direction: bearing, strike: kind === 'plane' && byStrike, splitBy: splitBy || null, name: name.trim() || usualName, only: where,
                ...(onCore ? { core: { alpha, beta, reference } } : {}),
            });
        }
        return chosen && table ? setsFromTable(table, {
            kind, x: xyz.x, y: xyz.y, z: xyz.z, dip: angle, direction: bearing, strike: kind === 'plane' && byStrike, splitBy: splitBy || null, name: name.trim() || usualName,
            rows: source === 'data' && rows === 'selected' ? selected : null, only: where,
        }) : null;
    }, [chosen, table, kind, xyz.x, xyz.y, xyz.z, angle, bearing, byStrike, splitBy, name, usualName, source, rows, selected, logged, paths, onCore, alpha, beta, reference, where]);

    const angles = kind === 'line' ? 'a plunge and a trend' : onCore ? 'an alpha and a beta' : byStrike ? 'a dip and a strike' : 'a dip and a dip direction';
    const preview = !found ? null
        : found.ok ? [
            `${found.found.toLocaleString()} of ${where.length > 0 ? 'those ' : ''}${found.of.toLocaleString()} rows have a place, ${angles}.`,
            ...(found.sets.length > 1 ? [`They make ${found.sets.length} sets: ${found.sets.slice(0, SHOWN).map(s => `${s.name} (${s.readings.length.toLocaleString()})`).join(', ')}${found.sets.length > SHOWN ? ` and ${found.sets.length - SHOWN} more` : ''}.`] : []),
            ...found.notes,
        ]
            : found.reason === 'too-many' ? [`${splitBy} has ${found.sets.toLocaleString()} values with measurements, and a model keeps ${MAX_SETS} sets. Choose another column, or select the rows of the ones wanted first.`]
                : found.reason === 'none' ? [`No ${source === 'data' && rows === 'selected' ? 'selected ' : ''}row has a place, ${angles}.`]
                    : ['The columns this needs are not in the table.'];

    const accept = () => {
        if (!found?.ok || !coords) return;
        const out = addReadingSets(coords, found.sets);
        if (!out.ok) {
            setProblem(out.reason === 'full' ? `A model keeps ${MAX_SETS} sets of measurements: remove some first.` : 'The model is in other coordinate columns than this view shows.');
            return;
        }
        onClose();
    };
    const change = <T,>(set: (v: T) => void) => (v: T) => { set(v); setProblem(null); };

    return (
        <>
            <DialogTitle>Measurements from columns</DialogTitle>
            <DialogContent>
                <Typography variant="body2" color="text.secondary">
                    Where the lie of the ground was measured: each row with a place and both angles becomes a measurement for the whole model. Angles are
                    in degrees: a dip or plunge is down from level (0-90), a bearing is clockwise from north (0-360).
                </Typography>
                <RadioGroup row value={source} onChange={e => changeSource(e.target.value as 'data' | 'file' | 'table')} sx={{ mt: 1 }}>
                    <FormControlLabel value="data" control={<Radio size="small" />} label={<Typography variant="body2">The data that is open</Typography>} />
                    <FormControlLabel value="file" control={<Radio size="small" />} label={<Typography variant="body2">A file (CSV)</Typography>} />
                    <FormControlLabel value="table" control={<Radio size="small" />} label={<Typography variant="body2">A table logged down the holes</Typography>} />
                </RadioGroup>
                {source === 'table' && (
                    <>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, mt: 0.5 }}>
                            {(db?.tables.length ?? 0) > 0 && (
                                <FormControl size="small" sx={{ flex: 1, minWidth: 0 }}>
                                    <InputLabel id="readings-table">Table</InputLabel>
                                    <Select labelId="readings-table" label="Table" value={logged ? tableId : ''} onChange={e => readTable(e.target.value)}>
                                        {db!.tables.map(t => <MenuItem key={t.id} value={t.id}>{t.name} ({t.hole.length.toLocaleString()} {t.to ? 'intervals' : 'depth points'})</MenuItem>)}
                                    </Select>
                                </FormControl>
                            )}
                            <Button size="small" sx={{ textTransform: 'none', flexShrink: 0 }} onClick={() => setTablesOpen(true)}>
                                {(db?.tables.length ?? 0) > 0 ? 'Tables…' : 'Add the file the measurements were logged in…'}
                            </Button>
                        </Box>
                        <HoleTableDialog open={tablesOpen} onClose={() => setTablesOpen(false)} onAdded={readTable} />
                        {logged && paths && paths.size === 0 && (
                            <Alert severity="warning" sx={{ mb: 1 }}>
                                A measurement logged down a hole is placed by the hole's path, and the paths are not in the coordinates of this view. Use the
                                coordinate columns the drillhole import made.
                            </Alert>
                        )}
                    </>
                )}
                {source === 'file' && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <Button size="small" variant="outlined" sx={{ textTransform: 'none', flexShrink: 0 }} onClick={() => fileInput.current?.click()}>{file ? 'Another file' : 'Choose the file'}</Button>
                        <Typography variant="caption" color="text.secondary" noWrap>
                            {file ? `${file.name}: ${file.csv.rows.toLocaleString()} rows` : 'With a row of column names, and the place of each measurement in the grid this view is in.'}
                        </Typography>
                        <input
                            ref={fileInput} type="file" hidden accept=".csv,.txt" data-testid="readings-file-input"
                            onChange={e => {
                                const picked = e.target.files?.[0];
                                e.target.value = '';
                                if (picked) void readFile(picked);
                            }}
                        />
                    </Box>
                )}
                {fileProblem && source === 'file' && <Alert severity="error" sx={{ mb: 1 }}>{fileProblem}</Alert>}

                {(source === 'data' || (source === 'file' && file) || logged) && (
                    <>
                        <RadioGroup row value={kind} onChange={e => change(setKind)(e.target.value as 'plane' | 'line')}>
                            <FormControlLabel value="plane" control={<Radio size="small" />} label={<Typography variant="body2">Planes: bedding, veins, a foliation</Typography>} />
                            <FormControlLabel value="line" control={<Radio size="small" />} label={<Typography variant="body2">Lines: a lineation, fold axes</Typography>} />
                        </RadioGroup>
                        {kind === 'plane' ? (
                            <>
                                {onCore ? (
                                    <Box sx={{ display: 'flex', gap: 1.5, mt: 1 }}>
                                        <Pick id="readings-alpha" label="Alpha column" value={alpha} options={numeric} onChange={change(setAlpha)} />
                                        <Pick id="readings-beta" label="Beta column" value={beta} options={numeric} onChange={change(setBeta)} />
                                        <FormControl size="small" fullWidth>
                                            <InputLabel id="readings-reference">Beta is measured from</InputLabel>
                                            <Select labelId="readings-reference" label="Beta is measured from" value={reference} onChange={e => change(setReference)(e.target.value as CoreReference)}>
                                                <MenuItem value="bottom">Bottom-of-hole line</MenuItem>
                                                <MenuItem value="top">Top-of-hole line</MenuItem>
                                            </Select>
                                        </FormControl>
                                    </Box>
                                ) : (
                                    <Box sx={{ display: 'flex', gap: 1.5, mt: 1 }}>
                                        <Pick id="readings-dip" label="Dip column" value={dip} options={numeric} onChange={change(setDip)} />
                                        {byStrike
                                            ? <Pick id="readings-strike" label="Strike column" value={strike} options={numeric} onChange={change(setStrike)} />
                                            : <Pick id="readings-direction" label="Dip direction column" value={direction} options={numeric} onChange={change(setDirection)} />}
                                    </Box>
                                )}
                                <RadioGroup
                                    row value={onCore ? 'core' : byStrike ? 'strike' : 'direction'}
                                    onChange={e => { change(setByStrike)(e.target.value === 'strike'); setByCore(e.target.value === 'core'); }}
                                >
                                    <FormControlLabel value="direction" control={<Radio size="small" />} label={<Typography variant="caption">Measured as dip direction</Typography>} />
                                    <FormControlLabel value="strike" control={<Radio size="small" />} label={<Typography variant="caption">As strike, dipping to its right (the right-hand rule)</Typography>} />
                                    {source === 'table' && (
                                        <FormControlLabel value="core" control={<Radio size="small" />} label={<Typography variant="caption">As alpha and beta on oriented core</Typography>} />
                                    )}
                                </RadioGroup>
                                {onCore && (
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                        Alpha is the angle between the core and the plane (0-90). Beta is where round the core the plane's down-hole end
                                        is, clockwise from that line looking down the hole (0-360). The hole's own direction at each depth turns the two
                                        into a dip and a dip direction.
                                    </Typography>
                                )}
                            </>
                        ) : (
                            <Box sx={{ display: 'flex', gap: 1.5, mt: 1 }}>
                                <Pick id="readings-plunge" label="Plunge column" value={plunge} options={numeric} onChange={change(setPlunge)} />
                                <Pick id="readings-trend" label="Trend column (plunges towards)" value={trend} options={numeric} onChange={change(setTrend)} />
                            </Box>
                        )}
                        {source === 'file' ? (
                            <Box sx={{ display: 'flex', gap: 1.5, mt: 1.5 }}>
                                <Pick id="readings-x" label="East column" value={place.x} options={numeric} onChange={change(v => setPlace(p => ({ ...p, x: v })))} />
                                <Pick id="readings-y" label="North column" value={place.y} options={numeric} onChange={change(v => setPlace(p => ({ ...p, y: v })))} />
                                <Pick id="readings-z" label="Elevation column" value={place.z} options={numeric} onChange={change(v => setPlace(p => ({ ...p, z: v })))} />
                            </Box>
                        ) : source === 'table' ? (
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                                Each is placed at its depth on the path of its hole{logged?.to ? ' (the middle of its interval)' : ''}.
                            </Typography>
                        ) : (
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                                Each is placed by its row's {xyz.x}, {xyz.y} and {xyz.z}.
                            </Typography>
                        )}
                        <Box sx={{ display: 'flex', gap: 1.5, mt: 1.5 }}>
                            <Pick id="readings-split" label="A set for each value of" value={splitBy} options={naming} onChange={change(setSplitBy)} none="No column: one set" />
                            <TextField
                                size="small" fullWidth label={splitBy ? 'Rows without a value go under' : 'Name of the set'} value={name} onChange={e => setName(e.target.value)}
                                placeholder={usualName} InputLabelProps={{ shrink: true }}
                            />
                        </Box>
                        {[0, 1].filter(k => k === 0 || where.length > 0 || !!only[1].column).map(k => (
                            <Box key={k} sx={{ display: 'flex', gap: 1.5, mt: 1.5 }} data-testid={`readings-only-${k}`}>
                                <Pick id={`readings-only-column-${k}`} label={k === 0 ? 'Only the rows where' : 'and where'} value={only[k].column} options={naming} onChange={v => setWhere(k, { column: v })} none={k === 0 ? 'Every row' : 'No other column'} />
                                <PickMany id={`readings-only-values-${k}`} label={only[k].column ? `${only[k].column} is` : 'is'} value={only[k].values} options={offered[k]} onChange={v => setWhere(k, { values: v })} disabled={!only[k].column} />
                            </Box>
                        ))}
                        {source === 'data' && (
                            <RadioGroup row value={rows} onChange={e => change(setRows)(e.target.value as 'selected' | 'all')} sx={{ mt: 0.5 }}>
                                <FormControlLabel
                                    value="selected" disabled={selected.length === 0} control={<Radio size="small" />}
                                    label={<Typography variant="body2">The selected rows{selected.length > 0 ? ` (${selected.length.toLocaleString()})` : ': none are selected'}</Typography>}
                                />
                                <FormControlLabel value="all" control={<Radio size="small" />} label={<Typography variant="body2">Every row</Typography>} />
                            </RadioGroup>
                        )}
                        {preview && (
                            <Box data-testid="readings-preview" sx={{ mt: 1 }}>
                                {preview.map(line => <Typography key={line} variant="body2" color={found?.ok ? 'text.primary' : 'warning.main'}>{line}</Typography>)}
                            </Box>
                        )}
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                            A set keeps {MAX_SET_READINGS.toLocaleString()} measurements: from more, ones spread evenly through them are chosen.
                            {found?.ok && found.sets.length > 1 ? ' Of several sets the model follows none to begin with: tick the ones it should under Structural data.' : ''}
                        </Typography>
                    </>
                )}
                {!coords && <Alert severity="warning" sx={{ mt: 1.5 }}>This view has no coordinate columns to place them in.</Alert>}
                {problem && <Alert severity="warning" sx={{ mt: 1.5 }}>{problem}</Alert>}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" disabled={!found?.ok || !coords} onClick={accept}>Add the measurements</Button>
            </DialogActions>
        </>
    );
};

export const StructureColumnsDialog: React.FC<Props> = ({ open, coords, onClose }) => (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        {open && <Body coords={coords} onClose={onClose} />}
    </Dialog>
);
