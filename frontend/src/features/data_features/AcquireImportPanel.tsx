import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert, Autocomplete, Box, Button, Chip, CircularProgress, Paper, Stack, TextField, Typography,
} from '@mui/material';
import { CloudDownload, Refresh, Visibility } from '@mui/icons-material';
import { useAppStore } from '../../store/appStore';
import { useAuditStore } from '../../store/auditStore';
import { notify } from '../../store/notificationStore';
import { friendlyError } from '../../utils/friendlyError';
import {
    acquireApi, AcquireOptions, AcquirePreview, CatalogObject, DetectResult, ProfilesIndex, SampleRows,
} from '../../services/acquireApi';
import {
    AcquireFilterState, EMPTY_FILTERS, FILTER_KEYS, FilterKey, buildPreviewRequest, describeFilters, filterProblem,
    holesMatchingLists, holesNotFound, optionLists, parseHoleList, pullRecordAudit, selected, withSelected,
} from '../../utils/acquireFilters';
import {
    AcquireProfile, TableKey, TestResult, connectionKey, databaseProblem, lastProfile, readyToImport,
    rememberProfile, serverProblem,
} from '../../utils/acquireProfiles';
import { processDrillholeImport } from './processDrillholeImport';
import { AcquireConnectionSection } from './AcquireConnectionSection';
import { AcquireFieldMapEditor } from './AcquireFieldMapEditor';

const LABELS: Record<FilterKey, string> = {
    project: 'Project', prospect: 'Prospect', hole_type: 'Hole type', program: 'Program',
};

// A preview is reused by Import while its filters are unchanged and the server
// still holds it (the preview cache keeps it 30 min)
const PREVIEW_REUSE_MS = 25 * 60 * 1000;

interface Props {
    /** The Drillhole tab's "Replace current data?" confirm */
    runOrConfirm: (action: () => void) => void;
}

/**
 * Data Import > Acquire (SQL). Works like the Drillhole tab, except that the
 * collar, survey and assay tables come from a read-only query of an Acquire
 * database (/api/acquire/preview) instead of three files. Which database, and
 * where its collars, surveys and assays are, is a saved connection profile
 * (the Connection section). Loading is the Drillhole tab's own code
 * (processDrillholeImport). Each import writes a pull record to the processing log.
 */
export const AcquireImportPanel: React.FC<Props> = ({ runOrConfirm }) => {
    const isLoading = useAppStore(s => s.isLoading);
    const [index, setIndex] = useState<ProfilesIndex | null>(null);
    const [indexError, setIndexError] = useState<string | null>(null);
    const [selectedName, setSelectedName] = useState<string | null>(null);
    const [isNew, setIsNew] = useState(false);
    const [draft, setDraft] = useState<AcquireProfile | null>(null);
    const [savedJson, setSavedJson] = useState('');
    const [test, setTest] = useState<TestResult | null>(null);
    const [testKey, setTestKey] = useState('');
    const [testing, setTesting] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editorOpen, setEditorOpen] = useState(false);
    const [objects, setObjects] = useState<{ key: string; list: CatalogObject[] } | null>(null);
    const [loadingObjects, setLoadingObjects] = useState(false);
    const [detect, setDetect] = useState<DetectResult | null>(null);
    const [detecting, setDetecting] = useState(false);
    const [samples, setSamples] = useState<Partial<Record<TableKey, SampleRows>>>({});
    const [sampling, setSampling] = useState<TableKey | null>(null);
    const [options, setOptions] = useState<AcquireOptions | null>(null);
    const [filters, setFilters] = useState<AcquireFilterState>(EMPTY_FILTERS);
    const [preview, setPreview] = useState<{ key: string; at: number; data: AcquirePreview } | null>(null);
    const [busy, setBusy] = useState<'preview' | 'import' | null>(null);
    const mounted = useRef(true);
    // (set again on every mount: React's StrictMode mounts, unmounts and remounts in development)
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    const serverMode = !!index?.server_mode;
    const key = connectionKey(draft);
    const dirty = !!draft && !isNew && JSON.stringify(draft) !== savedJson;
    const ready = serverMode
        ? !!test && test.ok && test.map_problems.length === 0 && test.incomplete.length === 0
        : readyToImport({ saved: !!selectedName && !isNew, dirty, test, testKey, key });
    const connOnly = draft ? `${draft.server}|${draft.database}` : '';
    const canConnect = !!draft && !serverProblem(draft.server) && !databaseProblem(draft.database);

    // ------------------------------------------------------------ loading

    const loadOptions = useCallback(async (profile?: string) => {
        try {
            const o = await acquireApi.options(profile);
            if (mounted.current) setOptions(o);
        } catch (err) {
            if (mounted.current) notify(friendlyError(err, "Couldn't read the filter lists from Acquire"), 'error');
        }
    }, []);

    const runTest = useCallback(async (p: AcquireProfile | undefined, saved: boolean) => {
        setTesting(true);
        const k = connectionKey(p ?? null);
        try {
            const t = await acquireApi.test(p);
            if (!mounted.current) return;
            setTest(t);
            setTestKey(k);
            if (t.ok && !t.map_problems.length && !t.incomplete.length && saved) await loadOptions(p?.name);
        } catch (err) {
            if (mounted.current) setTest({ ok: false, message: friendlyError(err, 'Connection test failed'), map_problems: [], incomplete: [] });
        } finally {
            if (mounted.current) setTesting(false);
        }
    }, [loadOptions]);

    const resetSession = () => {
        setTest(null); setTestKey(''); setOptions(null); setPreview(null); setDetect(null); setSamples({});
    };

    const loadProfile = useCallback(async (name: string) => {
        try {
            const p = await acquireApi.profile(name);
            if (!mounted.current) return;
            resetSession();
            setDraft(p); setSavedJson(JSON.stringify(p)); setSelectedName(p.name); setIsNew(false);
            rememberProfile(p.name);
            if (!serverProblem(p.server) && !databaseProblem(p.database)) void runTest(p, true);
        } catch (err) {
            notify(friendlyError(err, "Couldn't open the connection profile"), 'error');
        }
    }, [runTest]);

    const loadIndex = useCallback(async (choose?: string | null) => {
        try {
            const ix = await acquireApi.profiles();
            if (!mounted.current) return ix;
            setIndex(ix);
            setIndexError(null);
            if (ix.server_mode) {
                if (ix.admin) void runTest(undefined, false).then(() => loadOptions());
                return ix;
            }
            const names = ix.profiles.map(p => p.name);
            const want = choose !== undefined ? choose : lastProfile();
            const pick = names.find(n => n.toLowerCase() === (want ?? '').toLowerCase()) ?? names[0];
            if (pick) await loadProfile(pick);
            else { setDraft(null); setSelectedName(null); setIsNew(false); resetSession(); }
            return ix;
        } catch (err) {
            if (mounted.current) setIndexError(friendlyError(err, "Couldn't read the Acquire connection profiles"));
            return null;
        }
    }, [loadProfile, loadOptions, runTest]);

    useEffect(() => { void loadIndex(); }, [loadIndex]);

    // The table list for the field map editor (per server + database). Only once a
    // connection test has passed for that server and database, and never retried
    // for one that failed (a new test or a changed server / database tries again).
    const testedConn = test?.ok && draft && testKey === key ? connOnly : '';
    const [objectsFailed, setObjectsFailed] = useState('');
    useEffect(() => {
        if (!editorOpen || serverMode || !draft || !testedConn || objects?.key === connOnly
            || objectsFailed === connOnly || loadingObjects) return;
        setLoadingObjects(true);
        acquireApi.objects(draft)
            .then(list => { if (mounted.current) setObjects({ key: connOnly, list }); })
            .catch(err => {
                if (mounted.current) setObjectsFailed(connOnly);
                notify(friendlyError(err, "Couldn't list the database's tables"), 'error');
            })
            .finally(() => { if (mounted.current) setLoadingObjects(false); });
    }, [editorOpen, serverMode, draft, testedConn, objects, connOnly, objectsFailed, loadingObjects]);
    useEffect(() => { setObjectsFailed(''); }, [test]);

    // ------------------------------------------------------------ profile actions

    const onSave = async () => {
        if (!draft) return;
        setSaving(true);
        try {
            const saved = isNew
                ? await acquireApi.saveProfile(draft.name, draft, { create: true })
                : await acquireApi.saveProfile(selectedName ?? draft.name, draft);
            notify(`Saved the connection profile ${saved.name}`, 'success');
            await loadIndex(saved.name);
        } catch (err) {
            notify(friendlyError(err, "Couldn't save the profile"), 'error');
        } finally {
            if (mounted.current) setSaving(false);
        }
    };

    const onNew = (name: string) => {
        const t = index?.template;
        if (!t) return;
        resetSession();
        setDraft({ ...JSON.parse(JSON.stringify(t)), name, server: '', database: '' });
        setSelectedName(null); setIsNew(true); setSavedJson(''); setEditorOpen(true);
    };

    const onDuplicate = async (name: string) => {
        if (!draft || !savedJson) return;
        try {
            await acquireApi.saveProfile(name, { ...JSON.parse(savedJson), name }, { create: true });
            await loadIndex(name);
        } catch (err) {
            notify(friendlyError(err, "Couldn't duplicate the profile"), 'error');
        }
    };

    const onRename = async (name: string) => {
        if (!selectedName || !savedJson) return;
        try {
            await acquireApi.saveProfile(name, { ...JSON.parse(savedJson), name }, { renameFrom: selectedName });
            await loadIndex(name);
        } catch (err) {
            notify(friendlyError(err, "Couldn't rename the profile"), 'error');
        }
    };

    const onDelete = async () => {
        if (!selectedName) return;
        try {
            await acquireApi.deleteProfile(selectedName);
            notify(`Deleted the connection profile ${selectedName}`, 'success');
            rememberProfile(null);
            await loadIndex(null);
        } catch (err) {
            notify(friendlyError(err, "Couldn't delete the profile"), 'error');
        }
    };

    const onDetect = async () => {
        if (!draft) return;
        setDetecting(true);
        try {
            const r = await acquireApi.detect(draft);
            if (!mounted.current) return;
            setDetect(r);
            setObjects({ key: connOnly, list: r.objects });
            setSamples(r.samples as Partial<Record<TableKey, SampleRows>>);
            setDraft({ ...draft, field_map: r.field_map });
            setEditorOpen(true);
            notify(r.incomplete.length ? 'Fields suggested: some still need choosing' : 'Fields suggested: check them, then test and save', 'info');
        } catch (err) {
            notify(friendlyError(err, 'Detect fields failed'), 'error');
        } finally {
            if (mounted.current) setDetecting(false);
        }
    };

    const onSample = async (table: TableKey) => {
        if (!draft) return;
        const spec = table === 'samples' ? draft.field_map.assay.samples : draft.field_map[table];
        if (!spec?.object) return;
        setSampling(table);
        try {
            const s = await acquireApi.sample(draft, spec.schema || draft.field_map.schema || 'dbo', spec.object);
            if (mounted.current) setSamples(prev => ({ ...prev, [table]: s }));
        } catch (err) {
            notify(friendlyError(err, "Couldn't read the first rows"), 'error');
        } finally {
            if (mounted.current) setSampling(null);
        }
    };

    // ------------------------------------------------------------ filters, preview, import

    const combos = options?.combos ?? [];
    const mapped = options?.mapped ?? {};
    const lists = useMemo(() => optionLists(combos, filters), [combos, filters]);
    const listHoles = useMemo(() => holesMatchingLists(combos, filters), [combos, filters]);
    const pasted = useMemo(() => parseHoleList(filters.holeListText), [filters.holeListText]);
    const problem = filterProblem(filters);
    const profileName = serverMode ? undefined : selectedName ?? undefined;
    const request = useMemo(() => buildPreviewRequest(filters, profileName), [filters, profileName]);
    const requestKey = JSON.stringify(request);
    const current = preview && preview.key === requestKey ? preview.data : null;
    const usable = ready && !!options && !busy && !isLoading;

    const runPreview = useCallback(async () => {
        const data = await acquireApi.preview(request);
        const p = { key: requestKey, at: Date.now(), data };
        if (mounted.current) setPreview(p);
        return p;
    }, [request, requestKey]);

    const handlePreview = async () => {
        if (problem) { notify(problem, 'warning'); return; }
        setBusy('preview');
        try {
            const p = await runPreview();
            const missing = holesNotFound(request, p.data.holes);
            if (missing) notify(`${missing} of the pasted holes aren't in Acquire`, 'warning');
        } catch (err) {
            notify(friendlyError(err, 'Acquire preview failed'), 'error');
        } finally {
            if (mounted.current) setBusy(null);
        }
    };

    const doImport = async () => {
        setBusy('import');
        useAppStore.setState({ error: null, isLoading: true, uploadProgress: 0, streamingStatus: 'Reading holes from Acquire...' });
        try {
            const reusable = preview && preview.key === requestKey && Date.now() - preview.at < PREVIEW_REUSE_MS;
            const p = reusable ? preview : await runPreview();
            useAppStore.setState({ streamingStatus: null });
            const { field_map: fm, preview_token: token, pull_record: record } = p.data;
            const result = await processDrillholeImport(
                { collar: fm.collar, survey: fm.survey, assay: fm.assay, negateDip: p.data.negate_dip, previewToken: token },
                'AcquireImport');
            if (result) {
                useAuditStore.getState().recordAudit(pullRecordAudit(record, request, result.rows));
                notify(`Imported ${record.holes} holes from Acquire (${result.rows.toLocaleString()} samples)`, 'success');
                if (mounted.current) setPreview(null); // its frames are loaded; the next import pulls fresh
            }
        } catch (err) {
            const message = friendlyError(err, 'Acquire import failed');
            notify(message, 'error');
            useAppStore.setState({ error: message, isLoading: false, uploadProgress: 0, streamingStatus: null });
        } finally {
            if (mounted.current) setBusy(null);
        }
    };

    const handleImport = () => {
        if (problem) { notify(problem, 'warning'); return; }
        runOrConfirm(() => { void doImport(); });
    };

    const setList = (k: FilterKey, values: string[]) => setFilters(f => withSelected(f, k, values));

    // ---------------------------------------------------------------- render

    if (!index) {
        return indexError ? (
            <Alert severity="error" sx={{ my: 3 }}
                action={<Button color="inherit" size="small" startIcon={<Refresh />} onClick={() => void loadIndex()}>Retry</Button>}>
                {indexError}
            </Alert>
        ) : (
            <Box sx={{ my: 3, display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={18} />
                <Typography variant="body2" color="text.secondary">Reading the Acquire connection profiles...</Typography>
            </Box>
        );
    }

    const editor = draft ? (
        <AcquireFieldMapEditor
            profile={draft} onChange={setDraft}
            objects={objects?.key === connOnly ? objects.list : null} loadingObjects={loadingObjects}
            detect={detect} detecting={detecting} onDetect={() => void onDetect()} canConnect={canConnect}
            samples={samples} sampling={sampling} onSample={t => void onSample(t)}
        />
    ) : null;

    const dateField = (label: string, field: 'drilledFrom' | 'drilledTo' | 'modifiedFrom' | 'modifiedTo', hint: string | null) => (
        <TextField
            label={label} type="date" size="small" disabled={!usable}
            value={filters[field]}
            onChange={e => setFilters(f => ({ ...f, [field]: e.target.value }))}
            InputLabelProps={{ shrink: true }}
            helperText={hint ?? ' '}
        />
    );

    return (
        <Box sx={{ my: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="body2" color="text.secondary">
                Read collar, survey and assay tables straight from an Acquire database (read-only, with your Windows
                sign-in), then import them like the Drillhole tab. Loading replaces the current data.
            </Typography>

            <AcquireConnectionSection
                index={index} selected={selectedName} isNew={isNew} draft={draft} dirty={dirty}
                onDraft={setDraft} onSelect={name => void loadProfile(name)}
                onNew={onNew} onDuplicate={onDuplicate} onRename={onRename} onDelete={onDelete}
                test={test} testCurrent={serverMode || testKey === key} testing={testing}
                onTest={() => void runTest(draft ?? undefined, !!selectedName && !isNew && !dirty)}
                saving={saving} onSave={() => void onSave()}
                editorOpen={editorOpen} setEditorOpen={setEditorOpen} editor={editor}
            />

            {!ready && (serverMode ? !!index.admin : !!draft) && (
                <Alert severity="info">
                    {isNew || dirty
                        ? 'Save the profile, then test the connection, to choose holes.'
                        : 'Test the connection (with a complete field map) to choose holes.'}
                </Alert>
            )}

            {ready && (
                <>
                    {!options && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <CircularProgress size={18} />
                            <Typography variant="body2" color="text.secondary">Reading the filter lists...</Typography>
                        </Box>
                    )}
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
                        {FILTER_KEYS.filter(k => mapped[k]).map(k => (
                            <Autocomplete
                                key={k}
                                multiple
                                size="small"
                                disabled={!usable}
                                options={lists[k].map(o => o.value)}
                                value={selected(filters, k)}
                                onChange={(_, v) => setList(k, v)}
                                getOptionLabel={v => {
                                    const o = lists[k].find(x => x.value === v);
                                    return o ? `${v} (${o.holes})` : v;
                                }}
                                renderTags={(value, getTagProps) => value.map((v, i) => (
                                    <Chip {...getTagProps({ index: i })} key={v} label={v} size="small" />
                                ))}
                                renderInput={params => <TextField {...params} label={LABELS[k]} />}
                            />
                        ))}
                        {mapped.drilled && dateField('Drilled from', 'drilledFrom', options?.drilled.min ? `Earliest ${options.drilled.min}` : null)}
                        {mapped.drilled && dateField('Drilled to', 'drilledTo', options?.drilled.max ? `Latest ${options.drilled.max}` : null)}
                        {mapped.modified && dateField('Modified from', 'modifiedFrom', options?.modified.min ? `Earliest ${options.modified.min}` : null)}
                        {mapped.modified && dateField('Modified to', 'modifiedTo', options?.modified.max ? `Latest ${options.modified.max}` : null)}
                    </Box>

                    <TextField
                        label="Hole list (paste hole IDs: one per line, or separated by commas or spaces)"
                        multiline minRows={3} maxRows={8} size="small" disabled={!usable}
                        value={filters.holeListText}
                        onChange={e => setFilters(f => ({ ...f, holeListText: e.target.value }))}
                        helperText={pasted.ids.length
                            ? `${pasted.ids.length.toLocaleString()} hole ID${pasted.ids.length === 1 ? '' : 's'}`
                              + (pasted.duplicates ? ` (${pasted.duplicates} repeated, ignored)` : '')
                            : 'Optional. Combined with the filters above.'}
                    />

                    {options && (
                        <Typography variant="body2" color="text.secondary">
                            {listHoles.toLocaleString()} holes match the list choices
                            {(filters.drilledFrom || filters.drilledTo || filters.modifiedFrom || filters.modifiedTo || pasted.ids.length)
                                ? ', before the dates and hole list.' : '.'}
                        </Typography>
                    )}

                    {current && (
                        <Paper variant="outlined" sx={{ p: 2 }}>
                            <Typography variant="subtitle2" gutterBottom>Preview: {describeFilters(request)}</Typography>
                            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                                <Chip color="primary" label={`${current.holes.toLocaleString()} holes`} />
                                <Chip variant="outlined" label={`${current.collar.total_rows.toLocaleString()} collar rows`} />
                                <Chip variant="outlined" label={`${current.survey.total_rows.toLocaleString()} survey rows`} />
                                <Chip variant="outlined" label={`${current.assay.total_rows.toLocaleString()} assay rows`} />
                            </Stack>
                            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                                A hole appears after import only if it has a collar, at least one survey and at least one assay row.
                            </Typography>
                        </Paper>
                    )}

                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <Button
                            variant="outlined" fullWidth startIcon={busy === 'preview' ? <CircularProgress size={16} /> : <Visibility />}
                            onClick={() => void handlePreview()} disabled={!usable || !!problem}
                        >
                            Preview
                        </Button>
                        <Button
                            variant="contained" fullWidth startIcon={<CloudDownload />}
                            onClick={handleImport} disabled={!usable || !!problem}
                        >
                            {busy === 'import' || isLoading ? 'Importing...' : 'Import from Acquire'}
                        </Button>
                    </Box>
                    {problem && hasStarted(filters) && <Alert severity="warning">{problem}</Alert>}
                </>
            )}
        </Box>
    );
};

/** Show a filter problem only once the user has typed something (not the empty start). */
function hasStarted(f: AcquireFilterState): boolean {
    return !!(f.drilledFrom || f.drilledTo || f.modifiedFrom || f.modifiedTo || f.holeListText.trim()
        || f.projects.length || f.prospects.length || f.holeTypes.length || f.programs.length);
}
