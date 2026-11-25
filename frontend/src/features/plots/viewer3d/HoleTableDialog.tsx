/**
 * The project's tables logged down the holes: add one from a file, see what
 * is there, remove one.
 *
 * A table is kept row for row as it was logged (lithology, alteration,
 * structure readings) and placed by its own depths on the holes' paths, so it
 * needs the project's collars and surveys (kept by a drillhole import). The
 * file is read by the backend (`/api/logging/preview`, `/api/logging/table`);
 * the dataset is not touched.
 */
import React, { useMemo, useRef, useState } from 'react';
import {
    Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, IconButton, InputLabel,
    MenuItem, Select, TextField, Tooltip, Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { loggingApi } from '../../../services/loggingApi';
import { tracesOf, useDrillholeStore } from '../../../store/drillholeStore';
import { useModelStore } from '../../../store/modelStore';
import { requestDelete } from '../../model/deleteObjects';
import { readHoleTable, tableCoverage } from '../../model/drillholes';
import { keys } from '../../model/objectKeys';
import type { LoggingColumnInfo } from '../../../types/loggingInterval';

interface Props {
    open: boolean;
    onClose: () => void;
    /** A table has been added (its id) */
    onAdded?: (id: string) => void;
}

interface Preview {
    token: string;
    file: string;
    columns: LoggingColumnInfo[];
    rows: number;
}

/** No end-depth column: every row is a point at one depth */
const POINTS = '';
/** What the one depth column of a table of depth points is usually called (lower case, no spaces or marks) */
const DEPTH_NAMES = new Set(['depth', 'depthm', 'depthat', 'at', 'md', 'holedepth', 'measureddepth', 'downholedepth']);

const stem = (file: string) => file.replace(/\.[^.]+$/, '');
const count = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export const HoleTableDialog: React.FC<Props> = ({ open, onClose, onAdded }) => {
    const db = useDrillholeStore(s => s.db);
    const surfaces = useModelStore(s => s.scene.surfaces);
    const input = useRef<HTMLInputElement>(null);
    const [preview, setPreview] = useState<Preview | null>(null);
    const [name, setName] = useState('');
    const [hole, setHole] = useState('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState(POINTS);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [note, setNote] = useState<string | null>(null);

    const traces = tracesOf(db);
    const listed = useMemo(() => (db?.tables ?? []).map(t => ({ table: t, ...tableCoverage(t, traces) })), [db, traces]);
    const inUse = (id: string) => surfaces.filter(s => !s.blockOf && (s.rule.kind === 'contact' || s.rule.kind === 'body') && s.rule.table === id).length;

    const choose = async (file: File | undefined) => {
        if (!file) return;
        setBusy(true);
        setError(null);
        setNote(null);
        try {
            const out = await loggingApi.previewLoggingFile(file);
            if (!out.preview_token) throw new Error('The file could not be kept for reading.');
            const suggested = (role: string) => out.columns.find(c => c.suggested_role === role && c.confidence >= 50)?.name ?? '';
            setPreview({ token: out.preview_token, file: file.name, columns: out.columns, rows: out.total_rows });
            setName(stem(file.name));
            setHole(suggested('hole_id'));
            // A table of depth points has one depth column, under one of its usual names
            setFrom(suggested('from') || (out.columns.find(c => DEPTH_NAMES.has(c.name.toLowerCase().replace(/[\s_.-]+/g, '')))?.name ?? ''));
            setTo(suggested('to') || POINTS);
        } catch (err: any) {
            setPreview(null);
            setError(err?.response?.data?.detail ?? err?.message ?? 'The file could not be read.');
        } finally {
            setBusy(false);
            if (input.current) input.current.value = '';
        }
    };

    const ready = !!preview && !!hole && !!from && new Set([hole, from, to].filter(Boolean)).size === [hole, from, to].filter(Boolean).length;

    const add = async () => {
        if (!preview || !ready) return;
        setBusy(true);
        setError(null);
        try {
            const out = await loggingApi.table(preview.token, { hole_id: hole, from, ...(to ? { to } : {}) });
            const table = readHoleTable(out, '', name.trim() || stem(preview.file));
            if (!table) throw new Error('No row of the file has both a hole and a depth.');
            const id = useDrillholeStore.getState().addTable(table);
            if (!id) throw new Error('This project has no collars and surveys to place the table by.');
            const dropped = Number(out?.dropped) || 0;
            setNote(`${table.name}: ${count(table.hole.length, 'row', 'rows')} kept.${dropped > 0 ? ` ${count(dropped, 'row', 'rows')} with no hole or no depth left out.` : ''}`);
            setPreview(null);
            onAdded?.(id);
        } catch (err: any) {
            setError(err?.response?.data?.detail ?? err?.message ?? 'The table could not be read.');
        } finally {
            setBusy(false);
        }
    };

    const column = (label: string, value: string, set: (v: string) => void, none?: string) => (
        <FormControl size="small" fullWidth>
            <InputLabel id={`hole-table-${label}`} shrink>{label}</InputLabel>
            <Select labelId={`hole-table-${label}`} label={label} notched displayEmpty value={value} onChange={e => set(e.target.value)}>
                <MenuItem value="">{none ?? <em>Choose a column</em>}</MenuItem>
                {preview?.columns.map(c => <MenuItem key={c.name} value={c.name}>{c.name}</MenuItem>)}
            </Select>
        </FormControl>
    );

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Tables logged down the holes</DialogTitle>
            <DialogContent>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    A logging file (lithology, alteration, weathering, structural measurements) kept as it was logged: every
                    row at its own depths on the path of its hole, whether or not the hole was sampled there. Surfaces
                    built from it sit at the logged depths.
                </Typography>
                {!db ? (
                    <Alert severity="warning">
                        This project has no collar and survey tables, so a logged table cannot be placed. Import the
                        drillholes again (collar, survey and assay files together): the collars and surveys are then
                        kept with the project.
                    </Alert>
                ) : (
                    <>
                        <Box data-testid="hole-tables" sx={{ border: 1, borderColor: 'divider', borderRadius: 1, mb: 2 }}>
                            {listed.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>No tables yet.</Typography>}
                            {listed.map(({ table, holes, placed }) => {
                                const used = inUse(table.id);
                                return (
                                    <Box key={table.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.5, borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}>
                                        <Box sx={{ flex: 1, minWidth: 0 }}>
                                            <Typography variant="body2" noWrap>{table.name}</Typography>
                                            <Typography variant="caption" color={placed < holes ? 'warning.main' : 'text.secondary'}>
                                                {count(table.hole.length, table.to ? 'interval' : 'depth point', table.to ? 'intervals' : 'depth points')} in {count(holes, 'hole', 'holes')}
                                                {placed < holes ? `. ${count(holes - placed, 'hole has', 'holes have')} no collar or survey, and cannot be placed` : ''}
                                            </Typography>
                                        </Box>
                                        <Tooltip title={used > 0 ? `${count(used, 'surface is', 'surfaces are')} built from it` : 'Remove it from the project'}>
                                            <span>
                                                <IconButton size="small" aria-label={`Remove ${table.name}`} disabled={used > 0} onClick={() => { const why = requestDelete([keys.table(table.id)]); if (why) setNote(why); }}>
                                                    <DeleteOutlineIcon fontSize="small" />
                                                </IconButton>
                                            </span>
                                        </Tooltip>
                                    </Box>
                                );
                            })}
                        </Box>
                        <input ref={input} type="file" hidden accept=".csv,.txt,.xlsx,.xls" data-testid="hole-table-file" onChange={e => void choose(e.target.files?.[0])} />
                        <Button variant="outlined" size="small" disabled={busy} sx={{ textTransform: 'none' }} onClick={() => input.current?.click()}>
                            {preview ? 'Choose another file…' : 'Add a table from a file…'}
                        </Button>
                        {busy && <CircularProgress size={16} sx={{ ml: 1.5, verticalAlign: 'middle' }} />}
                        {preview && (
                            <Box sx={{ mt: 2 }}>
                                <Typography variant="body2" sx={{ mb: 1.5 }}>{preview.file}: {count(preview.rows, 'row', 'rows')}. Say which columns place a row.</Typography>
                                <TextField size="small" fullWidth label="Name" value={name} onChange={e => setName(e.target.value)} InputLabelProps={{ shrink: true }} sx={{ mb: 1.5 }} />
                                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1.5 }}>
                                    {column('Hole', hole, setHole)}
                                    {column(to ? 'From' : 'Depth', from, setFrom)}
                                    {column('To', to, setTo, 'None: a point at one depth')}
                                </Box>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                                    {to ? 'Every other column is kept as logging.' : 'With no To column each row is one depth down a hole, as structural measurements are.'}
                                </Typography>
                            </Box>
                        )}
                    </>
                )}
                {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
                {note && <Alert severity="success" sx={{ mt: 2 }}>{note}</Alert>}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Close</Button>
                {preview && <Button variant="contained" disabled={!ready || busy} onClick={() => void add()}>Add the table</Button>}
            </DialogActions>
        </Dialog>
    );
};
