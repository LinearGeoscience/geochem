/**
 * Import target points (ID, Easting, Northing, RL) from a CSV: each ID
 * becomes a planned hole, projected from its target up to the topography
 * (vertical, or a standard dip and azimuth at the target, with lift and
 * drift). A topography is required. An ID that is already a planned hole
 * gets the new target (and keeps its collar, way of planning and style): the
 * dialog says so before anything is imported, and the message after it again.
 */
import React, { useMemo, useState } from 'react';
import {
    Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel, InputLabel, MenuItem, Select, Stack,
    Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import { FileUpload } from '@mui/icons-material';
import { notify } from '../../../../store/notificationStore';
import { TargetColumns, guessTargetColumns, parseCsv, readTargets } from '../../../../utils/drillholePlanIO';
import { usePlanStore, TopoRef } from './planStore';
import { useModelStore } from '../../../../store/modelStore';
import { TopoSelect } from './HoleEditor';
import { NumField, stopKeys } from './fields';
import { snapHolesToPads, snapReportText } from './padActions';
import type { Planner } from './usePlans';

const FIELDS: { key: keyof TargetColumns; label: string }[] = [
    { key: 'id', label: 'Hole ID' }, { key: 'e', label: 'Easting' }, { key: 'n', label: 'Northing' }, { key: 'rl', label: 'RL' },
];
const cell = { px: 0.75, py: 0.25, fontSize: 12, whiteSpace: 'nowrap' } as const;
const listed = (ids: string[], n = 8) => ids.slice(0, n).join(', ') + (ids.length > n ? `, … (${ids.length} in all)` : '');

export const ImportTargetsDialog: React.FC<{ open: boolean; onClose: () => void; planner: Planner }> = ({ open, onClose, planner }) => {
    const defaultTopo = usePlanStore(s => s.settings.defaultTopo);
    const holes = usePlanStore(s => s.holes);
    const [file, setFile] = useState<{ name: string; rows: string[][] } | null>(null);
    const [cols, setCols] = useState<TargetColumns>({ id: -1, e: -1, n: -1, rl: -1 });
    const [dip, setDip] = useState<number | null>(-90);
    const [azi, setAzi] = useState<number | null>(0);
    const [lift, setLift] = useState<number | null>(0);
    const [drift, setDrift] = useState<number | null>(0);
    const [extension, setExtension] = useState<number | null>(0);
    const [topo, setTopo] = useState<TopoRef | null>(null);
    /** Then move each collar to the nearest pad (the dip / azimuth above is the guide) */
    const [snapPads, setSnapPads] = useState(true);
    const chosenTopo = topo ?? defaultTopo;

    const read = useMemo(() => (file ? readTargets(file.rows, cols) : null), [file, cols]);
    const planned = new Set(holes.map(h => h.input.name));
    const updates = read ? read.targets.filter(t => planned.has(t.id)).map(t => t.id) : [];
    const existing = read ? read.targets.filter(t => planner.existingIds.has(t.id)).map(t => t.id) : [];
    const badAngles = dip === null || dip < -90 || dip > 0 || azi === null;
    const ready = !!read && read.targets.length > 0 && !!chosenTopo && !!planner.topoOf(chosenTopo) && !badAngles;

    const choose = async (f: File | undefined) => {
        if (!f) return;
        const rows = parseCsv(await f.text());
        setFile({ name: f.name, rows });
        setCols(guessTargetColumns(rows[0] ?? []));
    };
    const close = () => { setFile(null); onClose(); };
    const run = () => {
        if (!read || !chosenTopo) return;
        const vertical = dip === -90;
        const { added, updated } = usePlanStore.getState().importTargets(read.targets, {
            targetDip: dip, targetAzi: azi, lift: lift ?? 0, drift: drift ?? 0, extension: extension ?? 0, method: 'surface-curved',
        }, chosenTopo);
        // The targets as one set of named points of the project tree (a file imported again replaces its set)
        useModelStore.getState().addNamedPoints(
            { name: `Targets: ${file!.name.replace(/\.[^.]+$/, '')}`, role: 'targets', color: '#7b1fa2' },
            read.targets.map(t => ({ p: [t.e, t.n, t.rl], name: t.id })), { replace: true },
        );
        // The guide set, now find the nearest pad for each
        const snapped = snapPads && planner.pads.length > 0
            ? snapHolesToPads(planner, usePlanStore.getState().holes.filter(h => added.includes(h.input.name) || updated.includes(h.input.name)).map(h => h.id))
            : null;
        const parts = [
            `Imported ${read.targets.length} target${read.targets.length === 1 ? '' : 's'} from ${file!.name}: ${added.length} new hole${added.length === 1 ? '' : 's'}${vertical && !snapped ? ' (vertical)' : ''}, projected to the surface.`,
            snapped ? snapReportText(snapped) : '',
            updated.length ? `${updated.length} already planned and their targets were UPDATED: ${listed(updated)}.` : '',
            read.bad.length ? `${read.bad.length} row(s) left out (no ID or coordinates; lines ${read.bad.slice(0, 8).join(', ')}${read.bad.length > 8 ? ', …' : ''}).` : '',
            read.repeated.length ? `Repeated IDs, first kept: ${listed(read.repeated)}.` : '',
        ].filter(Boolean);
        notify(parts.join(' '), updated.length || read.bad.length || read.repeated.length || snapped?.failed.length ? 'warning' : 'success');
        close();
    };

    const header = file?.rows[0] ?? [];
    return (
        <Dialog open={open} onClose={close} maxWidth="sm" fullWidth {...stopKeys}>
            <DialogTitle>Import target points</DialogTitle>
            <DialogContent>
                <Stack spacing={1.5}>
                    <Typography variant="body2">
                        A CSV with a Hole ID, Easting, Northing and RL for each target. Each becomes a planned hole, projected from its target up to the topography. Then select a hole to give it a collar on the slice, or another lift and drift.
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
                        <Box sx={{ overflowX: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
                            <Table size="small">
                                <TableHead><TableRow>{FIELDS.map(f => <TableCell key={f.key} sx={{ ...cell, fontWeight: 600 }}>{f.label}</TableCell>)}</TableRow></TableHead>
                                <TableBody>
                                    {(read?.targets ?? []).slice(0, 4).map(t => (
                                        <TableRow key={t.id}>{[t.id, t.e, t.n, t.rl].map((v, i) => <TableCell key={i} sx={cell}>{String(v)}</TableCell>)}</TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </Box>
                        <Typography variant="caption" color="text.secondary">
                            {read ? `${read.targets.length} target${read.targets.length === 1 ? '' : 's'} read` : ''}
                            {read?.bad.length ? `; ${read.bad.length} row(s) without an ID or coordinates will be left out` : ''}
                            {read?.repeated.length ? `; repeated IDs (first kept): ${listed(read.repeated, 5)}` : ''}
                        </Typography>
                        {updates.length > 0 && (
                            <Alert severity="warning" sx={{ '& .MuiAlert-message': { fontSize: 12 } }}>
                                {updates.length} of these IDs are already planned holes. Their targets will be <b>updated</b> to the file's (each keeps its collar, way of planning and style; one planned by its collar becomes collar to target): {listed(updates)}.
                            </Alert>
                        )}
                        {existing.length > 0 && (
                            <Alert severity="info" sx={{ '& .MuiAlert-message': { fontSize: 12 } }}>
                                {existing.length} ID{existing.length === 1 ? ' is' : 's are'} already a drillhole in the dataset: {listed(existing, 5)}.
                            </Alert>
                        )}
                    </>}

                    <Typography variant="subtitle2">The new holes</Typography>
                    <TopoSelect planner={planner} label="Topography (required)" value={chosenTopo} onChange={setTopo} />
                    {!chosenTopo && (
                        <Alert severity="warning" sx={{ '& .MuiAlert-message': { fontSize: 12 } }}>
                            Holes are projected from their targets up to the topography. Choose one, or first load a topography wireframe, or make one on the Geological Modelling page: New → Topography from the hole collars (or Topography from a file).
                        </Alert>
                    )}
                    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                        <NumField label="Dip at target" value={dip} width={110} error={dip === null || dip < -90 || dip > 0} onChange={setDip} title="−90 = vertical" />
                        <NumField label="Grid azi at target" value={azi} width={130} error={azi === null} onChange={setAzi} />
                        <NumField label="Lift °/100 m" value={lift} width={100} onChange={setLift} />
                        <NumField label="Drift °/100 m" value={drift} width={100} onChange={setDrift} />
                        <NumField label="Past the target m" value={extension} width={120} onChange={setExtension} />
                    </Box>
                    {planner.pads.length > 0 && (
                        <FormControlLabel control={<Checkbox size="small" checked={snapPads} onChange={e => setSnapPads(e.target.checked)} />}
                            label={<Typography variant="body2">Then snap each collar to the nearest pad: the dip and azimuth above are the guide; the collar dip and azimuth are solved from the pad ({planner.pads.length} pads)</Typography>} />
                    )}
                    <Typography variant="caption" color="text.secondary">Dip −90 is vertical (the azimuth then only sets the way lift turns the hole). Change any of these for one hole later, or for all with Settings → Apply to all.</Typography>
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={close}>Cancel</Button>
                <Button variant="contained" disabled={!ready} onClick={run}>
                    Import {read?.targets.length ?? 0} target{read?.targets.length === 1 ? '' : 's'}{updates.length ? ` (${updates.length} updated)` : ''}
                </Button>
            </DialogActions>
        </Dialog>
    );
};
