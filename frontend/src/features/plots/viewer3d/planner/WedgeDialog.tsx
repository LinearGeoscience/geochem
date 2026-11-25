/**
 * The wedge designer: pick a parent (a planned hole, or a drillhole already in
 * the dataset, optionally with its survey), tick the planned holes that become
 * its daughters, and give their lift, drift, distance past the target and the
 * wedge's largest kick. Once all are picked, Work out finds each daughter's
 * kick-off (one at a time, with a progress bar); the daughters are renamed
 * after the parent, W1 the deepest. The renaming is shown before anything
 * changes, and the planner takes these answers rather than working them out again.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert, Autocomplete, Box, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel, InputLabel,
    LinearProgress, MenuItem, Radio, RadioGroup, Select, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { FileUpload } from '@mui/icons-material';
import { notify } from '../../../../store/notificationStore';
import { HoleInput, PlanPoint, PlanResult, RateLimits, SurveyStation, Trace, WedgeParent } from '../../../../utils/drillholePlan';
import { WEDGE_DEFAULTS, traceFromStations } from '../../../../utils/drillholePlanWedge';
import { limitsText, planWedge } from '../../../../utils/drillholePlanWedgeRates';
import { readSurveyCsv } from '../../../../utils/drillholePlanIO';
import { usePlanStore } from './planStore';
import { NumField, RateLimitsFields, fixed, stopKeys } from './fields';
import { primeWedgeResults, type Planner } from './usePlans';

const cell = { px: 0.75, py: 0.25, fontSize: 12, whiteSpace: 'nowrap' } as const;

/** A picked hole worked out as a daughter of the parent */
interface PreviewRow {
    id: string;
    name: string;
    target: PlanPoint;
    result: PlanResult;
    kop: number | null;
    kick: number | null;
    lift: number | null;
    drift: number | null;
    problem: string | null;
}

export const WedgeDialog: React.FC<{ open: boolean; onClose: () => void; planner: Planner }> = ({ open, onClose, planner }) => {
    const minKop = usePlanStore(s => s.settings.minKop);
    const limits = usePlanStore(s => s.settings.wedgeLimits);
    /** These daughters' own lift / drift limits (null: the ones in Settings) */
    const [ownLimits, setOwnLimits] = useState<RateLimits | null>(null);
    /** Daughters solve their own lift and drift (nearest the parent's), or all take the ones typed */
    const [solve, setSolve] = useState(true);
    const [kind, setKind] = useState<'planned' | 'existing'>('planned');
    const [plannedId, setPlannedId] = useState<string>('');
    const [existingName, setExistingName] = useState<string | null>(null);
    const [survey, setSurvey] = useState<{ file: string; stations: SurveyStation[] } | null>(null);
    const [picked, setPicked] = useState<string[]>([]);
    const [lift, setLift] = useState<number | null>(0);
    const [drift, setDrift] = useState<number | null>(0);
    const [extension, setExtension] = useState<number | null>(0);
    const [kickMax, setKickMax] = useState<number | null>(WEDGE_DEFAULTS.kickMax);

    const parents = planner.holes.filter(h => h.hole.input.mode !== 'wedge' && h.result.trace);
    const existing = useMemo(() => [...planner.existingCollars.keys()].sort(), [planner.existingCollars]);
    const ref: WedgeParent | null = kind === 'planned' ? (plannedId ? { kind: 'planned', id: plannedId } : null) : existingName ? { kind: 'existing', name: existingName } : null;
    const parentName = kind === 'planned' ? parents.find(h => h.hole.id === plannedId)?.hole.input.name ?? '' : existingName ?? '';
    // The parent's path: an existing hole from the survey given here, else as the planner has it
    const parent = useMemo((): { trace: Trace; name: string } | null => {
        if (!ref) return null;
        if (ref.kind === 'existing' && survey?.stations.length) {
            const collar = planner.existingCollars.get(ref.name);
            return collar ? { trace: traceFromStations(collar, survey.stations), name: ref.name } : null;
        }
        return planner.parentTraceOf(ref);
    }, [ref?.kind, plannedId, existingName, survey, planner]); // eslint-disable-line react-hooks/exhaustive-deps

    const candidates = planner.holes.filter(h => h.hole.input.mode !== 'wedge' && h.hole.id !== plannedId && h.result.target);

    // The daughters are worked out only when asked (after all are picked), one at a time with a progress bar;
    // the kick-off sets each one's number. Changing anything clears the answer.
    const [preview, setPreview] = useState<PreviewRow[] | null>(null);
    const [work, setWork] = useState<{ done: number; total: number; current: string } | null>(null);
    const runId = useRef(0);
    useEffect(() => { runId.current++; setPreview(null); setWork(null); },
        [picked, parent?.trace, lift, drift, extension, kickMax, minKop, solve, limits, ownLimits]); // eslint-disable-line react-hooks/exhaustive-deps
    const base: Partial<HoleInput> = {
        lift: lift ?? 0, drift: drift ?? 0, extension: extension ?? 0, kickMax: kickMax ?? WEDGE_DEFAULTS.kickMax,
        kopDepth: null, ratesMode: solve ? 'solve' : 'fixed', balance: null, rateLimits: solve ? ownLimits : null,
    };
    const workOut = () => {
        if (!parent) return;
        const id0 = ++runId.current;
        const jobs = picked.map(id => planner.holes.find(h => h.hole.id === id)).filter((c): c is NonNullable<typeof c> => !!c?.result.target);
        const rows: PreviewRow[] = [];
        setPreview(null);
        const step = (k: number) => {
            if (runId.current !== id0) return;
            if (k === jobs.length) {
                setPreview(rows.sort((a, b) => (b.kop ?? -Infinity) - (a.kop ?? -Infinity)));
                setWork(null);
                return;
            }
            const c = jobs[k];
            setWork({ done: k, total: jobs.length, current: c.hole.input.name });
            // A frame first, so the progress shows before each daughter is worked out
            window.setTimeout(() => {
                if (runId.current !== id0) return;
                const t = c.result.target!;
                const target = { e: t[0], n: t[1], rl: t[2] };
                const r = planWedge({ ...c.hole.input, ...base, mode: 'wedge', target }, { parent, minKop, limits });
                rows.push({
                    id: c.hole.id, name: c.hole.input.name, target, result: r,
                    kop: r.wedge?.kop ?? null, kick: r.wedge?.kick ?? null, lift: r.ok ? r.lift : null, drift: r.ok ? r.drift : null,
                    problem: r.ok ? null : r.issues.find(i => i.level === 'error')?.text ?? 'No kick-off works.',
                });
                step(k + 1);
            }, 16);
        };
        step(0);
    };
    const names = (preview ?? []).map((p, i) => ({ ...p, to: `${parentName}_W${i + 1}` }));

    const readSurvey = async (f: File | undefined) => {
        if (!f || !existingName) return;
        const stations = readSurveyCsv(await f.text()).get(existingName) ?? [];
        setSurvey({ file: f.name, stations });
        if (!stations.length) notify(`${f.name} has no survey stations for ${existingName}.`, 'warning');
    };
    const close = () => { runId.current++; setWork(null); setPreview(null); setPicked([]); setSurvey(null); onClose(); };
    const run = () => {
        if (!ref || !parentName || !preview || preview.length === 0) return;
        const surveyHere = ref.kind === 'existing' && !!survey?.stations.length;
        if (surveyHere) usePlanStore.getState().setParentSurvey(ref.name, survey!.stations);
        // The planner takes the answers worked out here (the same parent path) instead of working them out again
        else primeWedgeResults(new Map(preview.map(p => [p.id, p.result])));
        const renamed = usePlanStore.getState().makeWedges(ref, parentName, preview.map(p => ({ id: p.id, kop: p.kop, target: p.target })), base);
        const failed = preview.filter(p => p.kop === null).length;
        notify(`${preview.length} wedge${preview.length === 1 ? '' : 's'} off ${parentName}. Renamed: ${renamed.map(r => `${r.from} → ${r.to}`).join(', ')}.${failed ? ` ${failed} with no kick-off that works yet: change their lift, drift or largest kick.` : ''}`, failed ? 'warning' : 'success');
        close();
    };

    return (
        <Dialog open={open} onClose={close} maxWidth="sm" fullWidth {...stopKeys}>
            <DialogTitle>Wedge designer</DialogTitle>
            <DialogContent>
                <Stack spacing={1.25}>
                    <Typography variant="body2">
                        Daughter holes leave a parent at a kick-off depth, set off by a wedge (a small kick), then run on with their own lift and drift to their targets. Pick the parent and every daughter, then Work out; W1 is the deepest kick-off.
                    </Typography>
                    <Typography variant="subtitle2">Parent</Typography>
                    <RadioGroup row value={kind} onChange={e => { setKind(e.target.value as 'planned' | 'existing'); setSurvey(null); }}>
                        <FormControlLabel value="planned" control={<Radio size="small" />} label="A planned hole" />
                        <FormControlLabel value="existing" control={<Radio size="small" />} label="A drillhole in the dataset" disabled={existing.length === 0} />
                    </RadioGroup>
                    {kind === 'planned' ? (
                        <FormControl size="small" sx={{ maxWidth: 260 }}>
                            <InputLabel>Parent hole</InputLabel>
                            <Select label="Parent hole" value={plannedId} onChange={e => { setPlannedId(String(e.target.value)); setPicked(p => p.filter(x => x !== e.target.value)); }}>
                                {parents.map(h => <MenuItem key={h.hole.id} value={h.hole.id}>{h.hole.input.name}</MenuItem>)}
                            </Select>
                        </FormControl>
                    ) : (
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                            <Autocomplete size="small" options={existing} value={existingName} sx={{ width: 220 }} onChange={(_, v) => { setExistingName(v); setSurvey(null); }}
                                renderInput={p => <TextField {...p} label="Drillhole" />} />
                            <Button size="small" variant="outlined" component="label" disabled={!existingName} startIcon={<FileUpload fontSize="small" />} sx={{ textTransform: 'none' }}>
                                {survey ? `${survey.file}: ${survey.stations.length} stations` : 'Its survey CSV (optional)'}
                                <input type="file" accept=".csv,text/csv" hidden onChange={e => { void readSurvey(e.target.files?.[0]); e.target.value = ''; }} />
                            </Button>
                            <Typography variant="caption" color="text.secondary" sx={{ flexBasis: '100%' }}>
                                Without its survey, the parent's path is rebuilt from its samples (as the import placed them), to its deepest sample.
                            </Typography>
                        </Box>
                    )}
                    {ref && !parent && <Alert severity="warning" sx={{ '& .MuiAlert-message': { fontSize: 12 } }}>That hole has no path to branch from (it has errors, or no samples / collar in this view).</Alert>}

                    <Typography variant="subtitle2">Daughters</Typography>
                    <Autocomplete multiple size="small" options={candidates.map(h => h.hole.id)} value={picked}
                        getOptionLabel={id => candidates.find(h => h.hole.id === id)?.hole.input.name ?? id}
                        onChange={(_, v) => setPicked(v)} disableCloseOnSelect
                        renderOption={(props, id, { selected }) => <li {...props}><Checkbox size="small" checked={selected} sx={{ p: 0, mr: 1 }} />{candidates.find(h => h.hole.id === id)?.hole.input.name}</li>}
                        renderInput={p => <TextField {...p} label="Planned holes (their targets)" />} />
                    <RadioGroup value={solve ? 'solve' : 'fixed'} onChange={e => setSolve(e.target.value === 'solve')}>
                        <FormControlLabel value="solve" control={<Radio size="small" />}
                            label={<Typography variant="body2">Each daughter solves its lift and drift: the parent's where they work, else the nearest with {limitsText(ownLimits ?? limits)} °/100 m (steering)</Typography>} />
                        <FormControlLabel value="fixed" control={<Radio size="small" />} label={<Typography variant="body2">All take the same lift and drift</Typography>} />
                    </RadioGroup>
                    {solve && <>
                        <FormControlLabel sx={{ mr: 0 }}
                            control={<Checkbox size="small" checked={!!ownLimits} onChange={e => setOwnLimits(e.target.checked ? { ...limits } : null)} />}
                            label={<Typography variant="body2">Own lift and drift limits for these daughters (else those in Settings)</Typography>} />
                        {ownLimits && <RateLimitsFields value={ownLimits} onChange={setOwnLimits} />}
                    </>}
                    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                        {!solve && <>
                            <NumField label="Lift °/100 m" value={lift} width={100} onChange={setLift} />
                            <NumField label="Drift °/100 m" value={drift} width={100} onChange={setDrift} />
                        </>}
                        <NumField label="Past the target m" value={extension} width={120} onChange={setExtension} />
                        <NumField label="Largest kick °" value={kickMax} width={110} onChange={setKickMax} />
                    </Box>
                    {work && (
                        <Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                <CircularProgress size={14} />
                                <Typography variant="caption">Working out {work.current} ({work.done + 1} of {work.total})…</Typography>
                            </Box>
                            <LinearProgress variant="determinate" value={(100 * work.done) / work.total} />
                        </Box>
                    )}
                    {!work && !preview && picked.length > 0 && parent && (
                        <Typography variant="caption" color="text.secondary">
                            Pick every daughter, then Work out: each takes a moment (it tries a kick-off every 5 m down the parent).
                        </Typography>
                    )}
                    {names.length > 0 && parent && <>
                        <Box sx={{ overflowX: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
                            <Table size="small">
                                <TableHead><TableRow>{['Hole', 'Becomes', 'Kick-off', 'Kick', 'Lift / drift'].map(h => <TableCell key={h} sx={{ ...cell, fontWeight: 600 }}>{h}</TableCell>)}</TableRow></TableHead>
                                <TableBody>
                                    {names.map(p => (
                                        <TableRow key={p.id}>
                                            <TableCell sx={cell}>{p.name}</TableCell>
                                            <TableCell sx={cell}>{p.to}</TableCell>
                                            <TableCell sx={cell}>{p.kop !== null ? `${p.kop} m` : '–'}</TableCell>
                                            <TableCell sx={{ ...cell, whiteSpace: 'normal' }}>{p.kick !== null ? `${fixed(p.kick, 2)}°` : <Typography variant="caption" color="error">{p.problem}</Typography>}</TableCell>
                                            <TableCell sx={cell}>{p.lift !== null && p.drift !== null ? `${fixed(p.lift, 2)} / ${fixed(p.drift, 2)}` : '–'}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </Box>
                        <Alert severity="warning" sx={{ '& .MuiAlert-message': { fontSize: 12 } }}>
                            These holes will be renamed after {parentName} (W1 the deepest kick-off): {names.map(p => `${p.name} → ${p.to}`).join(', ')}. Each keeps its target and remembers its old ID.
                        </Alert>
                    </>}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={close}>Cancel</Button>
                {preview ? (
                    <Button variant="contained" disabled={!ref || !parent || preview.length === 0} onClick={run}>Make {preview.length} wedge{preview.length === 1 ? '' : 's'}</Button>
                ) : (
                    <Button variant="contained" disabled={!ref || !parent || picked.length === 0 || !!work} onClick={workOut}>
                        Work out {picked.length || ''} wedge{picked.length === 1 ? '' : 's'}
                    </Button>
                )}
            </DialogActions>
        </Dialog>
    );
};
