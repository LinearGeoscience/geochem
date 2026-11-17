/**
 * More to build a surface from, in the Surfaces panel: dip readings (typed
 * and placed in the view, or taken from two columns of the dataset) and
 * points, lines and readings read from a CSV or DXF file.
 */
import React, { useRef, useState } from 'react';
import {
    Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel, IconButton, InputLabel, MenuItem,
    Radio, RadioGroup, Select, TextField, Tooltip, Typography,
} from '@mui/material';
import { DeleteOutline, SwapVert } from '@mui/icons-material';
import { useAppStore } from '../../../store/appStore';
import { useModelStore } from '../../../store/modelStore';
import { guessDipColumns, shapesFromFile } from '../../model/importShapes';
import { cleanReading, formatReading, MAX_READINGS } from '../../model/readings';
import { addShapes, describeAdded, readingsFromRows, type AddedShapes } from '../../model/sceneActions';
import type { SurfaceObject } from '../../model/types';

const NUMERIC = new Set(['numeric', 'float', 'integer']);
/** This many readings are listed; the rest are counted */
const LISTED = 8;
const small = { minWidth: 0, px: 0.75, py: 0, height: 24, fontSize: 12, textTransform: 'none' } as const;

interface Props {
    surface: SurfaceObject;
    /** This view shows the scene's coordinate columns: things can be placed in it */
    here: boolean;
}

type Note = { severity: 'info' | 'warning' | 'error'; text: string };

const noteOf = (added: AddedShapes, lead = ''): Note => ({
    severity: added.notes.length > 0 ? 'warning' : 'info',
    text: [lead, describeAdded(added), ...added.notes].filter(Boolean).join(' '),
});

export const SurfaceInputs: React.FC<Props> = ({ surface, here }) => {
    const { setPendingReading, setPointReading, removePoints } = useModelStore.getState();
    const pending = useModelStore(s => s.pendingReading);
    const [dip, setDip] = useState('');
    const [direction, setDirection] = useState('');
    /** The point whose reading is in the two boxes, to be changed (null: the boxes are for a new one) */
    const [changing, setChanging] = useState<string | null>(null);
    const [note, setNote] = useState<Note | null>(null);
    const [fromColumns, setFromColumns] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);

    const measured = surface.points.filter(p => p.reading);
    const typed = dip.trim() !== '' && direction.trim() !== '' ? cleanReading({ dip: Number(dip), dipDirection: Number(direction) }) : null;
    const target = changing ? surface.points.find(p => p.id === changing && p.reading) ?? null : null;
    const full = measured.length >= MAX_READINGS;

    const place = () => {
        if (pending) { setPendingReading(null); return; }
        if (!typed) return;
        setNote(null);
        if (target) {
            setPointReading(surface.id, target.id, { ...typed, ...(target.reading!.overturned ? { overturned: true } : {}) });
            setChanging(null);
            return;
        }
        setPendingReading(typed);
    };

    const readFile = async (file: File) => {
        try {
            const added = addShapes(surface.id, shapesFromFile(file.name, await file.text()));
            if (added) setNote(noteOf(added, `${file.name}:`));
        } catch (e) {
            setNote({ severity: 'error', text: `${file.name} could not be used. ${e instanceof Error ? e.message : ''}`.trim() });
        }
    };

    return (
        <Box data-testid="surface-inputs" sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                Dip readings{measured.length > 0 ? ` (${measured.length})` : ''}: how the surface lies where it was measured
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.75, mt: 0.25 }}>
                <TextField
                    size="small" variant="standard" label="Dip" value={dip} onChange={e => setDip(e.target.value)} sx={{ width: 52 }}
                    inputProps={{ inputMode: 'decimal', 'aria-label': 'Dip', style: { fontSize: 13 } }} InputLabelProps={{ shrink: true }} placeholder="0-90"
                />
                <TextField
                    size="small" variant="standard" label="Towards" value={direction} onChange={e => setDirection(e.target.value)} sx={{ width: 60 }}
                    inputProps={{ inputMode: 'decimal', 'aria-label': 'Dip direction', style: { fontSize: 13 } }} InputLabelProps={{ shrink: true }} placeholder="0-360"
                />
                <Tooltip title={!here ? 'This view shows other coordinate columns than the surface was built in' : target ? 'Give this reading the values in the boxes' : full ? `A surface takes ${MAX_READINGS} readings` : 'Then click in the view where it was measured: on a drillhole, on the slice, or on a point already placed'}>
                    <span style={{ flex: 1 }}>
                        <Button
                            size="small" fullWidth variant={pending ? 'contained' : 'outlined'} sx={small}
                            disabled={!pending && (!typed || (!target && (!here || full)))} onClick={place}
                        >
                            {pending ? 'Click where it was measured' : target ? 'Change it' : 'Place it'}
                        </Button>
                    </span>
                </Tooltip>
            </Box>
            {pending && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    {formatReading(pending)}. Click a drillhole, the slice, or one of this surface's points. Esc puts it down.
                </Typography>
            )}
            {measured.slice(0, LISTED).map(p => (
                <Box key={p.id} sx={{ display: 'flex', alignItems: 'center', pl: 0.5, borderRadius: 0.5, bgcolor: changing === p.id ? 'action.selected' : undefined }}>
                    <Tooltip title="Put its values in the boxes, to change them">
                        <Typography
                            variant="caption" noWrap sx={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                            onClick={() => {
                                if (changing === p.id) { setChanging(null); return; }
                                setChanging(p.id);
                                setDip(String(p.reading!.dip));
                                setDirection(String(p.reading!.dipDirection));
                            }}
                        >
                            {formatReading(p.reading!)}{p.reading!.overturned ? ' · turned over' : ''}
                        </Typography>
                    </Tooltip>
                    <Tooltip title="Turn it over: the surface is upside down here (the overturned limb of a fold)">
                        <IconButton
                            size="small" aria-label={`Turn the reading ${formatReading(p.reading!)} over`} color={p.reading!.overturned ? 'primary' : 'default'}
                            onClick={() => setPointReading(surface.id, p.id, { ...p.reading!, overturned: !p.reading!.overturned })}
                        >
                            <SwapVert fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Remove this reading and its point">
                        <IconButton size="small" aria-label={`Remove the reading ${formatReading(p.reading!)}`} onClick={() => removePoints(surface.id, [p.id])}>
                            <DeleteOutline fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Box>
            ))}
            {measured.length > LISTED && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pl: 0.5 }}>
                    and {(measured.length - LISTED).toLocaleString()} more
                </Typography>
            )}
            <Box sx={{ display: 'flex', gap: 0.5, mt: 0.75 }}>
                <Tooltip describeChild title="Take dip readings from two columns of the data: every row with a dip and a dip direction">
                    <Button size="small" variant="outlined" sx={{ ...small, flex: '1.6 1 0', whiteSpace: 'nowrap' }} onClick={() => setFromColumns(true)}>Readings from columns</Button>
                </Tooltip>
                <Tooltip describeChild title="Add points, lines and dip readings from a CSV file, or points and lines from a DXF file, in the project's coordinates">
                    <Button size="small" variant="outlined" sx={{ ...small, flex: '1 1 0', whiteSpace: 'nowrap' }} onClick={() => fileInput.current?.click()}>From a file</Button>
                </Tooltip>
                <input
                    ref={fileInput} type="file" hidden accept=".csv,.txt,.dxf" data-testid="surface-file-input"
                    onChange={e => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) void readFile(file);
                    }}
                />
            </Box>
            {note && (
                <Alert severity={note.severity} onClose={() => setNote(null)} sx={{ mt: 0.75, py: 0, '& .MuiAlert-message': { fontSize: 12 } }}>{note.text}</Alert>
            )}
            {fromColumns && <ReadingsDialog surfaceId={surface.id} onClose={() => setFromColumns(false)} onDone={setNote} />}
        </Box>
    );
};

const ReadingsDialog: React.FC<{ surfaceId: string; onClose: () => void; onDone: (note: Note) => void }> = ({ surfaceId, onClose, onDone }) => {
    const [columns] = useState(() => useAppStore.getState().columns.filter(c => NUMERIC.has(c.type)).map(c => c.name));
    const [selected] = useState(() => useAppStore.getState().selectedIndices);
    const [guess] = useState(() => guessDipColumns(columns));
    const [dip, setDip] = useState(guess.dip);
    const [direction, setDirection] = useState(guess.direction);
    const [rows, setRows] = useState<'selected' | 'all'>(selected.length > 0 ? 'selected' : 'all');
    const [problem, setProblem] = useState<string | null>(null);

    const accept = () => {
        const out = readingsFromRows(surfaceId, rows === 'selected' ? selected : null, dip, direction);
        if (!out.ok) {
            setProblem(out.reason === 'none'
                ? `No ${rows === 'selected' ? 'selected ' : ''}row has a position, a dip and a dip direction.`
                : 'The columns this needs are not in the data.');
            return;
        }
        onDone(noteOf(out.added));
        onClose();
    };
    const pick = (id: string, text: string, value: string, set: (v: string) => void) => (
        <FormControl size="small" fullWidth>
            <InputLabel id={id}>{text}</InputLabel>
            <Select labelId={id} label={text} value={columns.includes(value) ? value : ''} onChange={e => { set(e.target.value); setProblem(null); }}>
                {columns.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
            </Select>
        </FormControl>
    );

    return (
        <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle>Dip readings from columns</DialogTitle>
            <DialogContent>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Every row with a dip and a dip direction becomes a point of the surface, lying as measured. The dip is in degrees
                    from level (0-90); the dip direction is the bearing it slopes down towards (0-360).
                </Typography>
                <Box sx={{ display: 'flex', gap: 1.5 }}>
                    {pick('readings-dip', 'Dip column', dip, setDip)}
                    {pick('readings-direction', 'Dip direction column', direction, setDirection)}
                </Box>
                <RadioGroup value={rows} onChange={e => { setRows(e.target.value as 'selected' | 'all'); setProblem(null); }} sx={{ mt: 1 }}>
                    <FormControlLabel
                        value="selected" disabled={selected.length === 0} control={<Radio size="small" />}
                        label={<Typography variant="body2">The selected rows{selected.length > 0 ? ` (${selected.length.toLocaleString()})` : ': none are selected'}</Typography>}
                    />
                    <FormControlLabel value="all" control={<Radio size="small" />} label={<Typography variant="body2">Every row</Typography>} />
                </RadioGroup>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    A surface takes {MAX_READINGS} readings: from more, ones spread evenly through them are chosen. Select the readings
                    of one structure first if the columns hold several.
                </Typography>
                {problem && <Alert severity="warning" sx={{ mt: 1.5 }}>{problem}</Alert>}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" disabled={!dip || !direction || dip === direction} onClick={accept}>Add the readings</Button>
            </DialogActions>
        </Dialog>
    );
};
