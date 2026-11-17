/**
 * Orientation readings for the whole model from the columns of a table: the
 * data that is open, or a CSV file (features/model/structureReadings). Each
 * row with a place and both angles is a reading; a column that names what
 * was measured can split them into sets.
 */
import React, { useMemo, useRef, useState } from 'react';
import {
    Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel, InputLabel, MenuItem, Radio, RadioGroup, Select, TextField,
    Typography,
} from '@mui/material';
import { useAppStore } from '../../../store/appStore';
import { addReadingSets } from '../../model/sceneActions';
import { guessStructureColumns, MAX_SETS, MAX_SET_READINGS, setsFromTable, tableFromCsv, type CsvTable, type ReadingTable } from '../../model/structureReadings';
import type { SceneCoords } from '../../model/types';
import { guessAxisColumn } from './coordinateColumns';

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

const Body: React.FC<Omit<Props, 'open'>> = ({ coords, onClose }) => {
    const [dataColumns] = useState(() => {
        const { columns } = useAppStore.getState();
        return { numeric: columns.filter(c => NUMERIC.has(c.type)).map(c => c.name), text: columns.filter(c => !NUMERIC.has(c.type)).map(c => c.name) };
    });
    const [selected] = useState(() => useAppStore.getState().selectedIndices);
    const [source, setSource] = useState<'data' | 'file'>('data');
    const [file, setFile] = useState<{ name: string; csv: CsvTable } | null>(null);
    const [fileProblem, setFileProblem] = useState<string | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);

    const numeric = source === 'file' ? file?.csv.numericNames ?? [] : dataColumns.numeric;
    // Any column can name what was measured: codes are often numbers
    const naming = source === 'file' ? file?.csv.names ?? [] : [...dataColumns.text, ...dataColumns.numeric];
    const [first] = useState(() => guessStructureColumns(dataColumns.numeric, dataColumns.text));

    const [kind, setKind] = useState<'plane' | 'line'>(!first.dip && first.plunge ? 'line' : 'plane');
    const [byStrike, setByStrike] = useState(!first.direction && !!first.strike);
    const [dip, setDip] = useState(first.dip);
    const [direction, setDirection] = useState(first.direction);
    const [strike, setStrike] = useState(first.strike);
    const [plunge, setPlunge] = useState(first.plunge);
    const [trend, setTrend] = useState(first.trend);
    const [place, setPlace] = useState({ x: '', y: '', z: '' });
    const [splitBy, setSplitBy] = useState('');
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
        } catch (e) {
            setFile(null);
            setFileProblem(`${picked.name} could not be read. ${e instanceof Error ? e.message : ''}`.trim());
        }
    };

    const table = useMemo((): ReadingTable | null => {
        if (source === 'file') return file ? file.csv.table : null;
        const app = useAppStore.getState();
        return { numeric: n => app.getNumericColumn(n), text: n => app.getRawColumn(n) };
    }, [source, file]);
    const xyz = source === 'file' ? place : { x: coords?.x ?? '', y: coords?.y ?? '', z: coords?.z ?? '' };
    const angle = kind === 'line' ? plunge : dip;
    const bearing = kind === 'line' ? trend : byStrike ? strike : direction;
    const usualName = kind === 'line' ? 'Lines' : 'Planes';
    const chosen = !!table && !!angle && !!bearing && !!xyz.x && !!xyz.y && !!xyz.z;
    const found = useMemo(() => (chosen && table ? setsFromTable(table, {
        kind, x: xyz.x, y: xyz.y, z: xyz.z, dip: angle, direction: bearing, strike: kind === 'plane' && byStrike, splitBy: splitBy || null, name: name.trim() || usualName,
        rows: source === 'data' && rows === 'selected' ? selected : null,
    }) : null), [chosen, table, kind, xyz.x, xyz.y, xyz.z, angle, bearing, byStrike, splitBy, name, usualName, source, rows, selected]);

    const angles = kind === 'line' ? 'a plunge and a trend' : byStrike ? 'a dip and a strike' : 'a dip and a dip direction';
    const preview = !found ? null
        : found.ok ? [
            `${found.found.toLocaleString()} of ${found.of.toLocaleString()} rows have a place, ${angles}.`,
            ...(found.sets.length > 1 ? [`They make ${found.sets.length} sets: ${found.sets.slice(0, SHOWN).map(s => `${s.name} (${s.readings.length.toLocaleString()})`).join(', ')}${found.sets.length > SHOWN ? ` and ${found.sets.length - SHOWN} more` : ''}.`] : []),
            ...found.notes,
        ]
            : found.reason === 'too-many' ? [`${splitBy} has ${found.sets.toLocaleString()} values with readings, and a model keeps ${MAX_SETS} sets. Choose another column, or select the rows of the ones wanted first.`]
                : found.reason === 'none' ? [`No ${source === 'data' && rows === 'selected' ? 'selected ' : ''}row has a place, ${angles}.`]
                    : ['The columns this needs are not in the table.'];

    const accept = () => {
        if (!found?.ok || !coords) return;
        const out = addReadingSets(coords, found.sets);
        if (!out.ok) {
            setProblem(out.reason === 'full' ? `A model keeps ${MAX_SETS} sets of readings: remove some first.` : 'The model is in other coordinate columns than this view shows.');
            return;
        }
        onClose();
    };
    const change = <T,>(set: (v: T) => void) => (v: T) => { set(v); setProblem(null); };

    return (
        <>
            <DialogTitle>Readings from columns</DialogTitle>
            <DialogContent>
                <Typography variant="body2" color="text.secondary">
                    Where the lie of the ground was measured: each row with a place and both angles becomes a reading for the whole model. Angles are
                    in degrees: a dip or plunge is down from level (0-90), a bearing is clockwise from north (0-360).
                </Typography>
                <RadioGroup row value={source} onChange={e => change(setSource)(e.target.value as 'data' | 'file')} sx={{ mt: 1 }}>
                    <FormControlLabel value="data" control={<Radio size="small" />} label={<Typography variant="body2">The data that is open</Typography>} />
                    <FormControlLabel value="file" control={<Radio size="small" />} label={<Typography variant="body2">A file (CSV)</Typography>} />
                </RadioGroup>
                {source === 'file' && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <Button size="small" variant="outlined" sx={{ textTransform: 'none', flexShrink: 0 }} onClick={() => fileInput.current?.click()}>{file ? 'Another file' : 'Choose the file'}</Button>
                        <Typography variant="caption" color="text.secondary" noWrap>
                            {file ? `${file.name}: ${file.csv.rows.toLocaleString()} rows` : 'With a row of column names, and the place of each reading in the grid this view is in.'}
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

                {(source === 'data' || file) && (
                    <>
                        <RadioGroup row value={kind} onChange={e => change(setKind)(e.target.value as 'plane' | 'line')}>
                            <FormControlLabel value="plane" control={<Radio size="small" />} label={<Typography variant="body2">Planes: bedding, veins, a foliation</Typography>} />
                            <FormControlLabel value="line" control={<Radio size="small" />} label={<Typography variant="body2">Lines: a lineation, fold axes</Typography>} />
                        </RadioGroup>
                        {kind === 'plane' ? (
                            <>
                                <Box sx={{ display: 'flex', gap: 1.5, mt: 1 }}>
                                    <Pick id="readings-dip" label="Dip column" value={dip} options={numeric} onChange={change(setDip)} />
                                    {byStrike
                                        ? <Pick id="readings-strike" label="Strike column" value={strike} options={numeric} onChange={change(setStrike)} />
                                        : <Pick id="readings-direction" label="Dip direction column" value={direction} options={numeric} onChange={change(setDirection)} />}
                                </Box>
                                <RadioGroup row value={byStrike ? 'strike' : 'direction'} onChange={e => change(setByStrike)(e.target.value === 'strike')}>
                                    <FormControlLabel value="direction" control={<Radio size="small" />} label={<Typography variant="caption">Measured as dip direction</Typography>} />
                                    <FormControlLabel value="strike" control={<Radio size="small" />} label={<Typography variant="caption">As strike, dipping to its right (the right-hand rule)</Typography>} />
                                </RadioGroup>
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
                            A set keeps {MAX_SET_READINGS.toLocaleString()} readings: from more, ones spread evenly through them are chosen.
                            {found?.ok && found.sets.length > 1 ? ' Of several sets the model follows none to begin with: tick the ones it should in the Structure panel.' : ''}
                        </Typography>
                    </>
                )}
                {!coords && <Alert severity="warning" sx={{ mt: 1.5 }}>This view has no coordinate columns to place them in.</Alert>}
                {problem && <Alert severity="warning" sx={{ mt: 1.5 }}>{problem}</Alert>}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" disabled={!found?.ok || !coords} onClick={accept}>Add the readings</Button>
            </DialogActions>
        </>
    );
};

export const StructureColumnsDialog: React.FC<Props> = ({ open, coords, onClose }) => (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        {open && <Body coords={coords} onClose={onClose} />}
    </Dialog>
);
