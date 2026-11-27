/**
 * Reading drill tracking's data, each table with its columns chosen
 * (guessed from the header, or kept from last time; changed by hand when wrong):
 * - the drilled holes: from Acquire (SQL), through the Acquire import's
 *   connection profiles (collars and surveys only, nothing loaded into the
 *   dataset), or from the collar + survey CSVs exported from Acquire;
 * - a planned program from a collar CSV and (optionally) a survey CSV.
 */
import React, { useEffect, useState } from 'react';
import {
    Alert, Box, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, TextField,
    ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import { CloudDownload, UploadFile } from '@mui/icons-material';
import { useDrillTrackingStore } from '../../store/drillTrackingStore';
import { notify } from '../../store/notificationStore';
import { acquireApi, type ProfilesIndex } from '../../services/acquireApi';
import { lastProfile, rememberProfile, splitList } from '../../utils/acquireProfiles';
import { parseCsv } from '../../utils/drillholePlanIO';
import type { SurveyStation } from '../../utils/drillholePlan';
import {
    ACQUIRE_LIVE_DEFAULTS, COLLAR_FIELD_LABELS, COLLAR_FIELDS, COLLAR_REQUIRED, guessCollarColumns, guessSurveyColumns, numberOf,
    SURVEY_FIELD_LABELS, SURVEY_FIELDS, SURVEY_REQUIRED, textOf, type AcquireLiveSettings, type CollarColumns, type SurveyColumns,
} from '../../utils/drillTrackImport';
import {
    guessPlannedCollarColumns, PLANNED_COLLAR_FIELDS, PLANNED_COLLAR_LABELS, PLANNED_COLLAR_REQUIRED, programHolesFromFiles, readPlannedCollars,
    type PlannedCollarColumns,
} from '../../utils/plannedPrograms';
import { friendlyError } from '../../utils/friendlyError';
import { stopKeys } from '../plots/viewer3d/planner/fields';
import { acquireSource, applyLive, keepAcquireSettings, pullFromAcquire, recordPull, type CsvFile, type PulledFiles } from './acquireLive';

const HOLE_COLORS = ['#d81b60', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00897b', '#6d4c41', '#3949ab'];

async function readCsv(file: File): Promise<CsvFile> {
    return { name: file.name, rows: parseCsv(await file.text()) };
}

const FilePick: React.FC<{ label: string; file: CsvFile | null; onFile: (f: CsvFile) => void; optional?: boolean }> = ({ label, file, onFile, optional }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, my: 0.5 }}>
        <Button component="label" size="small" variant="outlined" startIcon={<UploadFile fontSize="small" />} sx={{ textTransform: 'none', minWidth: 170 }}>
            {label}
            <input hidden type="file" accept=".csv,.txt" onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(await readCsv(f)); }} />
        </Button>
        <Typography variant="caption" color={file ? 'text.primary' : 'text.secondary'} noWrap>
            {file ? `${file.name} (${(file.rows.length - 1).toLocaleString()} rows)` : optional ? 'optional' : 'none chosen'}
        </Typography>
    </Box>
);

/** One select a field, of the file's columns */
function ColumnMap<F extends string>({ header, fields, labels, required, value, onChange }: {
    header: readonly string[]; fields: readonly F[]; labels: Record<F, string>; required: readonly F[];
    value: Record<F, number | null>; onChange: (v: Record<F, number | null>) => void;
}) {
    return (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 1, my: 1 }}>
            {fields.map(f => (
                <TextField key={f} select size="small" label={`${labels[f]}${required.includes(f) ? ' *' : ''}`} value={value[f] === null ? '' : String(value[f])}
                    error={required.includes(f) && value[f] === null}
                    onChange={e => onChange({ ...value, [f]: e.target.value === '' ? null : Number(e.target.value) })}>
                    <MenuItem value=""><em>none</em></MenuItem>
                    {header.map((h, i) => <MenuItem key={i} value={String(i)}>{h || `(column ${i + 1})`}</MenuItem>)}
                </TextField>
            ))}
        </Box>
    );
}

/** The drilled holes tracking reads: from Acquire (SQL) or from the CSVs exported from Acquire */
export const LiveImportDialog: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
    const kept = useDrillTrackingStore(s => s.tracking.acquire);
    const gridZone = useDrillTrackingStore(s => s.tracking.rules.gridZone ?? null);
    const [source, setSource] = useState<'acquire' | 'csv'>('acquire');
    const [collar, setCollar] = useState<CsvFile | null>(null);
    const [survey, setSurvey] = useState<CsvFile | null>(null);
    const [cc, setCc] = useState<CollarColumns | null>(null);
    const [sc, setSc] = useState<SurveyColumns | null>(null);
    // Acquire (SQL)
    const [index, setIndex] = useState<ProfilesIndex | null>(null);
    const [profile, setProfile] = useState('');
    const [days, setDays] = useState('');
    const [holeText, setHoleText] = useState('');
    const [pulled, setPulled] = useState<PulledFiles | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const clear = () => { setCollar(null); setSurvey(null); setCc(null); setSc(null); setPulled(null); setError(null); };
    useEffect(() => {
        if (!open) return;
        clear();
        const k = kept ?? ACQUIRE_LIVE_DEFAULTS;
        setProfile(k.profile ?? lastProfile() ?? '');
        setDays(k.days === null ? '' : String(k.days));
        setHoleText(k.holeIds.join('\n'));
        setIndex(null);
        acquireApi.profiles().then(setIndex).catch(e => setError(friendlyError(e, 'Acquire connection profiles')));
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    const serverMode = !!index?.server_mode;
    const usable = (index?.profiles ?? []).filter(p => p.complete);
    const settings = (): AcquireLiveSettings => ({
        profile: serverMode ? null : (profile || null),
        days: days.trim() && Number(days) > 0 ? Number(days) : null,
        holeIds: splitList(holeText),
        collarColumns: kept?.collarColumns ?? null, surveyColumns: kept?.surveyColumns ?? null,
    });
    const pull = async () => {
        setBusy(true); setError(null); setPulled(null);
        try {
            const f = await pullFromAcquire(settings());
            setPulled(f); setCollar(f.collar); setSurvey(f.survey); setCc(f.collarCols); setSc(f.surveyCols);
        } catch (e) {
            setError(friendlyError(e, 'Reading from Acquire failed'));
        } finally {
            setBusy(false);
        }
    };
    const ready = collar && survey && cc && sc && COLLAR_REQUIRED.every(f => cc[f] !== null) && SURVEY_REQUIRED.every(f => sc[f] !== null);
    const read = () => {
        if (!ready) return;
        if (source === 'acquire' && pulled) {
            const s = settings();
            const out = applyLive(collar, survey, cc, sc, acquireSource(pulled.pull));
            recordPull(pulled.pull, s);
            keepAcquireSettings(s, pulled, cc, sc);
            if (s.profile) rememberProfile(s.profile);
            notify(`From Acquire (${pulled.pull.profile}): ${out.text}`, out.severity);
        } else {
            const out = applyLive(collar, survey, cc, sc, { collarFile: collar.name, surveyFile: survey.name });
            notify(out.text, out.severity);
        }
        onClose();
    };
    const r = pulled?.pull.pull_record;
    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth {...stopKeys}>
            <DialogTitle>Read the holes being drilled</DialogTitle>
            <DialogContent>
                <ToggleButtonGroup size="small" exclusive value={source} sx={{ mb: 1 }} onChange={(_, v) => { if (v) { setSource(v); clear(); } }}>
                    <ToggleButton value="acquire" sx={{ textTransform: 'none' }}>From Acquire (SQL)</ToggleButton>
                    <ToggleButton value="csv" sx={{ textTransform: 'none' }}>From CSV export</ToggleButton>
                </ToggleButtonGroup>
                <Typography variant="body2" color="text.secondary">
                    {source === 'acquire'
                        ? 'The collars and surveys (no assays) of the holes started in the last few days and / or listed below, read through an Acquire connection profile (set up in Data Import › Acquire (SQL)). The project\'s data isn\'t changed.'
                        : 'The collar and survey CSVs exported from Acquire.'}
                    {' '}They replace the drilled holes read before; links and settings made by hand are kept. Coordinates and azimuths must be to the project grid
                    {gridZone !== null ? ` (zone ${gridZone}): survey rows to another zone are left out` : ''}. Survey codes and hole statuses are read by the Survey rules.
                </Typography>
                {source === 'acquire' ? <>
                    {!index && !error && <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, my: 1 }}><CircularProgress size={16} /><Typography variant="body2">Finding the connection profiles…</Typography></Box>}
                    {index && serverMode && (
                        <Typography variant="body2" sx={{ my: 1 }}>
                            Connection: {index.admin ? `${index.admin.name} (${index.admin.database} on ${index.admin.server}), set by the server` : (index.admin_error ?? 'none set up on the server')}
                        </Typography>
                    )}
                    {index && !serverMode && (usable.length ? (
                        <TextField select size="small" label="Connection profile" value={usable.some(p => p.name === profile) ? profile : ''} sx={{ my: 1, minWidth: 320 }}
                            onChange={e => { setProfile(e.target.value); setPulled(null); }}>
                            {usable.map(p => <MenuItem key={p.name} value={p.name}>{p.name} ({p.database} on {p.server})</MenuItem>)}
                        </TextField>
                    ) : (
                        <Alert severity="info" sx={{ my: 1 }}>No complete Acquire connection profile yet: set one up in Data Import › Acquire (SQL), then come back.</Alert>
                    ))}
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap', my: 1 }}>
                        <TextField size="small" label="Started in the last (days)" value={days} sx={{ width: 190 }} inputProps={{ inputMode: 'numeric' }}
                            helperText="blank: no date filter" onChange={e => setDays(e.target.value.replace(/[^\d]/g, ''))} />
                        <TextField size="small" label="And / or these hole IDs" value={holeText} multiline minRows={1} maxRows={4} sx={{ flex: 1, minWidth: 220 }}
                            helperText="one per line, or separated by commas" onChange={e => setHoleText(e.target.value)} />
                        <Button variant="outlined" startIcon={busy ? <CircularProgress size={14} /> : <CloudDownload fontSize="small" />} sx={{ textTransform: 'none', mt: 0.25 }}
                            disabled={busy || !index || (!serverMode && !usable.some(p => p.name === profile))} onClick={pull}>
                            Read from Acquire
                        </Button>
                    </Box>
                    {error && <Alert severity="error" sx={{ my: 1 }}>{error}</Alert>}
                    {r && (
                        <Typography variant="body2" sx={{ my: 1 }}>
                            {r.holes} hole{r.holes === 1 ? '' : 's'}: {r.rows.collar} collars and {r.rows.survey} survey rows from {r.database} on {r.server}. Check the columns, then Read.
                        </Typography>
                    )}
                    {collar && cc && <><Typography variant="caption" color="text.secondary">Collars</Typography>
                        <ColumnMap header={collar.rows[0] ?? []} fields={COLLAR_FIELDS} labels={COLLAR_FIELD_LABELS} required={COLLAR_REQUIRED} value={cc} onChange={setCc} /></>}
                    {survey && sc && <><Typography variant="caption" color="text.secondary">Surveys</Typography>
                        <ColumnMap header={survey.rows[0] ?? []} fields={SURVEY_FIELDS} labels={SURVEY_FIELD_LABELS} required={SURVEY_REQUIRED} value={sc} onChange={setSc} /></>}
                </> : <>
                    <FilePick label="Collar CSV…" file={collar} onFile={f => { setCollar(f); setCc(guessCollarColumns(f.rows[0] ?? [])); }} />
                    {collar && cc && <ColumnMap header={collar.rows[0] ?? []} fields={COLLAR_FIELDS} labels={COLLAR_FIELD_LABELS} required={COLLAR_REQUIRED} value={cc} onChange={setCc} />}
                    <FilePick label="Survey CSV…" file={survey} onFile={f => { setSurvey(f); setSc(guessSurveyColumns(f.rows[0] ?? [])); }} />
                    {survey && sc && <ColumnMap header={survey.rows[0] ?? []} fields={SURVEY_FIELDS} labels={SURVEY_FIELD_LABELS} required={SURVEY_REQUIRED} value={sc} onChange={setSc} />}
                </>}
                {collar && cc && (cc.planId === null || cc.status === null) && (
                    <Alert severity="warning" sx={{ mt: 1, '& .MuiAlert-message': { fontSize: 12 } }}>
                        {cc.planId === null ? 'No planned hole ID column chosen: holes can only be linked to planned holes by hand. ' : ''}
                        {cc.status === null ? 'No hole status column chosen: holes being drilled are found by their start and finish dates only.' : ''}
                    </Alert>
                )}
                {collar && cc && cc.liveDepth === null && (
                    <Alert severity="info" sx={{ mt: 1, '& .MuiAlert-message': { fontSize: 12 } }}>
                        No live depth column chosen: a hole's current depth will be its Max depth, which may not be today's.
                    </Alert>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" disabled={!ready} onClick={read}>Read</Button>
            </DialogActions>
        </Dialog>
    );
};

const PLANNED_SURVEY_FIELDS = ['hole', 'depth', 'dip', 'azi', 'method'] as const;
type PlannedSurveyField = (typeof PLANNED_SURVEY_FIELDS)[number];

/** A planned program from a collar CSV and a survey CSV */
export const ProgramImportDialog: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
    const [collar, setCollar] = useState<CsvFile | null>(null);
    const [survey, setSurvey] = useState<CsvFile | null>(null);
    const [cc, setCc] = useState<PlannedCollarColumns | null>(null);
    const [sc, setSc] = useState<Record<PlannedSurveyField, number | null> | null>(null);
    const [name, setName] = useState('');
    const [onlyMethod, setOnlyMethod] = useState('');
    const [useMethod, setUseMethod] = useState(false);
    const surveyReady = !survey || (sc && SURVEY_REQUIRED.every(f => sc[f as PlannedSurveyField] !== null));
    const ready = collar && cc && PLANNED_COLLAR_REQUIRED.every(f => cc[f] !== null) && surveyReady;
    const pickSurvey = (f: CsvFile) => {
        setSurvey(f);
        const g = guessSurveyColumns(f.rows[0] ?? []);
        setSc({ hole: g.hole, depth: g.depth, dip: g.dip, azi: g.azi, method: g.method });
        // An Acquire survey export carries its planned holes as rows of the "Planned" method
        const hasPlanned = g.method !== null && f.rows.slice(1).some(r => (r[g.method!] ?? '').trim().toLowerCase() === 'planned');
        setUseMethod(hasPlanned); setOnlyMethod(hasPlanned ? 'Planned' : '');
    };
    const read = () => {
        if (!ready) return;
        const { collars, problems } = readPlannedCollars(collar.rows, cc);
        const stations = new Map<string, SurveyStation[]>();
        if (survey && sc) {
            const want = useMethod && sc.method !== null ? onlyMethod.trim().toLowerCase() : null;
            for (const r of survey.rows.slice(1)) {
                const hole = textOf(r[sc.hole!]), depth = numberOf(r[sc.depth!]), dip = numberOf(r[sc.dip!]), azi = numberOf(r[sc.azi!]);
                if (!hole || depth === null || dip === null || azi === null) continue;
                if (want !== null && (r[sc.method!] ?? '').trim().toLowerCase() !== want) continue;
                stations.set(hole, [...(stations.get(hole) ?? []), { depth, dip, azi }]);
            }
        }
        const made = programHolesFromFiles(collars, stations, HOLE_COLORS);
        const all = [...problems, ...made.problems];
        if (!made.holes.length) { notify(`No planned holes could be read. ${all.slice(0, 5).join(' ')}`, 'warning'); return; }
        const store = useDrillTrackingStore.getState();
        const id = store.addProgram(name || collar.name.replace(/\.[^.]+$/, ''), 'files', made.holes);
        notify(`Program "${useDrillTrackingStore.getState().programs.find(p => p.id === id)?.name}": ${made.holes.length} planned hole${made.holes.length === 1 ? '' : 's'}${all.length ? `. ${all.slice(0, 5).join(' ')}${all.length > 5 ? ` (and ${all.length - 5} more)` : ''}` : '.'}`, all.length ? 'warning' : 'success');
        onClose();
    };
    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth {...stopKeys}>
            <DialogTitle>Import a planned program</DialogTitle>
            <DialogContent>
                <Typography variant="body2" color="text.secondary">
                    A collar CSV (a row a planned hole) and, if there is one, a survey CSV of the planned paths. Each hole becomes a hole planned by collar
                    (its first survey's dip and azimuth, its overall lift and drift); its path is the one the surveys give. Azimuths are grid.
                </Typography>
                <TextField size="small" label="Program name" value={name} onChange={e => setName(e.target.value)} sx={{ my: 1, width: 320 }} placeholder={collar?.name.replace(/\.[^.]+$/, '') ?? ''} />
                <FilePick label="Collar CSV…" file={collar} onFile={f => { setCollar(f); setCc(guessPlannedCollarColumns(f.rows[0] ?? [])); }} />
                {collar && cc && <ColumnMap header={collar.rows[0] ?? []} fields={PLANNED_COLLAR_FIELDS} labels={PLANNED_COLLAR_LABELS} required={PLANNED_COLLAR_REQUIRED} value={cc} onChange={setCc} />}
                <FilePick label="Survey CSV…" file={survey} onFile={pickSurvey} optional />
                {survey && sc && <>
                    <ColumnMap header={survey.rows[0] ?? []} fields={PLANNED_SURVEY_FIELDS} labels={{ ...SURVEY_FIELD_LABELS }} required={SURVEY_REQUIRED as PlannedSurveyField[]} value={sc} onChange={setSc} />
                    {sc.method !== null && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <FormControlLabel control={<Checkbox size="small" checked={useMethod} onChange={e => setUseMethod(e.target.checked)} />}
                                label={<Typography variant="body2">Only survey rows of the method</Typography>} />
                            <TextField size="small" value={onlyMethod} disabled={!useMethod} onChange={e => setOnlyMethod(e.target.value)} sx={{ width: 160 }} />
                        </Box>
                    )}
                </>}
                {!survey && collar && cc && (cc.dip === null || cc.azi === null || cc.eoh === null) && (
                    <Alert severity="info" sx={{ mt: 1, '& .MuiAlert-message': { fontSize: 12 } }}>Without a survey CSV, each hole needs a dip, an azimuth and an end of hole on its collar row.</Alert>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" disabled={!ready} onClick={read}>Import</Button>
            </DialogActions>
        </Dialog>
    );
};
