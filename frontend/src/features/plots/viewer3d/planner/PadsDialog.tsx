/**
 * Import drill pad locations (ID, X, Y, Z) as a named point set of the 3D
 * scene: saved with the project, drawn in the 3D view (cut by the slices)
 * and on the planner's 2D slice view, and used to snap collars to.
 */
import React, { useMemo, useState } from 'react';
import {
    Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography,
} from '@mui/material';
import { FileUpload } from '@mui/icons-material';
import { notify } from '../../../../store/notificationStore';
import { useModelStore } from '../../../../store/modelStore';
import { TargetColumns, guessTargetColumns, parseCsv, readTargets } from '../../../../utils/drillholePlanIO';
import { usePlanStore } from './planStore';
import { stopKeys } from './fields';

const FIELDS: { key: keyof TargetColumns; label: string }[] = [
    { key: 'id', label: 'Pad ID' }, { key: 'e', label: 'X (Easting)' }, { key: 'n', label: 'Y (Northing)' }, { key: 'rl', label: 'Z (RL)' },
];

export const PadsDialog: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
    const [file, setFile] = useState<{ name: string; rows: string[][] } | null>(null);
    const [cols, setCols] = useState<TargetColumns>({ id: -1, e: -1, n: -1, rl: -1 });
    const [name, setName] = useState('');
    const read = useMemo(() => (file ? readTargets(file.rows, cols, { keepRepeats: true }) : null), [file, cols]);
    const header = file?.rows[0] ?? [];

    const choose = async (f: File | undefined) => {
        if (!f) return;
        const rows = parseCsv(await f.text());
        setFile({ name: f.name, rows });
        setCols(guessTargetColumns(rows[0] ?? []));
        setName(f.name.replace(/\.[^.]+$/, ''));
    };
    const close = () => { setFile(null); onClose(); };
    const run = () => {
        if (!read || read.targets.length === 0) return;
        // One set of named points with the pads role: a single object of the project tree (colour and showing from there)
        const id = useModelStore.getState().addNamedPoints(
            { name: name.trim() || 'Pads', role: 'pads', color: '#6d4c41' },
            read.targets.map(t => ({ p: [t.e, t.n, t.rl], name: t.id })),
        );
        usePlanStore.getState().setSettings({ padSetId: id });
        notify(`${read.targets.length} pads imported as "${name.trim() || 'Pads'}" (saved with the project).`
            + (read.bad.length ? ` ${read.bad.length} row(s) left out (no ID or coordinates).` : '')
            + (read.repeated.length ? ` ${read.repeated.length} pad name(s) are used for more than one place; all kept, the later ones as "name (2)": ${read.repeated.join(', ')}.` : ''), read.bad.length || read.repeated.length ? 'warning' : 'success');
        close();
    };

    return (
        <Dialog open={open} onClose={close} maxWidth="sm" fullWidth {...stopKeys}>
            <DialogTitle>Import pad locations</DialogTitle>
            <DialogContent>
                <Stack spacing={1.5}>
                    <Typography variant="body2">
                        A CSV of pads (existing, or ground that can be cleared): an ID and X, Y, Z in the data's grid. They are kept with the project, drawn in the 3D view, and planned collars can be snapped to them. The pad's own Z is the collar RL.
                    </Typography>
                    <Box>
                        <Button variant="outlined" component="label" startIcon={<FileUpload fontSize="small" />} sx={{ textTransform: 'none' }}>
                            {file ? file.name : 'Choose a CSV'}
                            <input type="file" accept=".csv,text/csv" hidden onChange={e => { void choose(e.target.files?.[0]); e.target.value = ''; }} />
                        </Button>
                    </Box>
                    {file && <>
                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                            {FIELDS.map(f => (
                                <FormControl key={f.key} size="small" sx={{ minWidth: 120 }} error={cols[f.key] < 0}>
                                    <InputLabel>{f.label}</InputLabel>
                                    <Select label={f.label} value={cols[f.key]} onChange={e => setCols(c => ({ ...c, [f.key]: Number(e.target.value) }))}>
                                        <MenuItem value={-1}><em>Choose…</em></MenuItem>
                                        {header.map((h, i) => <MenuItem key={i} value={i}>{h || `Column ${i + 1}`}</MenuItem>)}
                                    </Select>
                                </FormControl>
                            ))}
                        </Box>
                        <Typography variant="caption" color="text.secondary">
                            {read ? `${read.targets.length} pads read` : ''}{read?.bad.length ? `; ${read.bad.length} row(s) left out` : ''}
                            {read?.targets[0] ? `. First: ${read.targets[0].id} at ${read.targets[0].e}, ${read.targets[0].n}, ${read.targets[0].rl}` : ''}
                        </Typography>
                        <TextField size="small" label="Name" value={name} onChange={e => setName(e.target.value)} sx={{ width: 260 }} />
                    </>}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={close}>Cancel</Button>
                <Button variant="contained" disabled={!read || read.targets.length === 0} onClick={run}>Import {read?.targets.length ?? 0} pads</Button>
            </DialogActions>
        </Dialog>
    );
};
