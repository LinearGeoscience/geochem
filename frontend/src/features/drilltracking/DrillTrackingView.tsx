/**
 * The Drill tracking page (the sidebar's Drill tracking). The holes being
 * drilled against a planned program, for the daily drilling meeting:
 *
 * - left, the layers of the page's 3D view (the project tree's objects that
 *   have an eye, with the planned programs and the drilled holes);
 * - middle, the 3D viewer without the modelling and planning tools;
 * - right, the report on each hole being drilled, the links and settings by
 *   hand, and the planned holes' state; exported as CSV or to the Report page.
 *
 * The data comes from re-reading the latest Acquire export (there is no
 * server yet), so the page says when it was last read.
 */
import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import {
    Alert, Autocomplete, Box, Button, Checkbox, Chip, CircularProgress, Collapse, Divider, IconButton, MenuItem, Paper, Table, TableBody, TableCell, TableHead, ToggleButton, ToggleButtonGroup,
    TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import { Article, ExpandLess, ExpandMore, FileDownload, Refresh, RestartAlt, Tune, UploadFile, WarningAmber } from '@mui/icons-material';
import { useViewVisibility } from '../../hooks/useViewVisibility';
import { plotById, useAppStore } from '../../store/appStore';
import { useDrillTrackingStore } from '../../store/drillTrackingStore';
import { notify } from '../../store/notificationStore';
import { useReportStore } from '../../store/reportStore';
import { downloadText } from '../../utils/gisExport';
import { PROJECTION_LABELS, type PointCheck } from '../../utils/drillTrackProjection';
import { forecastText, meetingTable, missText, REPORT_KINDS, reportCsv, requiredText, type HoleReport } from '../../utils/drillTrackReport';
import type { TreeNode } from '../model/projectTree';
import { keys } from '../model/objectKeys';
import { HIDDEN_SETTING, TRACES_SETTING } from '../model/viewVisibility';
import { useProjectTree } from '../modelling/tree/useProjectTree';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { PlotIdContext } from '../../utils/plotPresentation';
import { PaneContent } from '../workspace/PaneContent';
import type { PaneControls } from '../workspace/PaneContext';
import { LiveImportDialog, ProgramImportDialog } from './ImportDialogs';
import { refreshFromAcquire } from './acquireLive';
import { SurveyRulesDialog } from './SurveyRulesDialog';
import { localTime, sourceText } from '../../utils/drillTrackImport';
import { TRACK_DEFAULTS } from '../../utils/drillTrackSurveys';
import { PROJECTION_COLORS, DRILLED_COLOR, SLICE_SAMPLES_SETTING, UNSURVEYED_COLOR } from './trackingLayer';
import { useTracking } from './useTracking';

const Viewer3D = lazy(() => import('../plots/viewer3d/Viewer3D'));

/** The page's view is not in a dock: nothing to maximise or restore */
const NO_PANE_CONTROLS: PaneControls = { maximize: () => {}, restore: () => {}, isMaximized: () => false };

/** The page's one 3D view */
export const TRACKING_VIEW_ID = 'drill-tracking-3d';

function useTrackingView(): string {
    useEffect(() => {
        const app = useAppStore.getState();
        if (!app.trackingViews.some(v => v.id === TRACKING_VIEW_ID)) {
            useAppStore.setState({ trackingViews: [...app.trackingViews, { id: TRACKING_VIEW_ID, type: 'map3d', title: 'Drill tracking', settings: {
                // Holes only: the samples (and the traces through them, which run to the bottom of every hole) start hidden
                viewKind: '3d', trackingView: true, [TRACES_SETTING]: false, [HIDDEN_SETTING]: [keys.dataset],
            } }] });
        }
    }, []);
    return TRACKING_VIEW_ID;
}

const n1 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(1));
const n2 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(2));
const hoursSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 3.6e6;

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

/** The rows of a tree that have an eye, with their depth (folders kept as headings when they hold any) */
function eyeRows(nodes: readonly TreeNode[], depth = 0): { node: TreeNode; depth: number }[] {
    const out: { node: TreeNode; depth: number }[] = [];
    for (const n of nodes) {
        if (n.kind === 'link' || n.kind === 'note') continue;
        const below = eyeRows(n.children, depth + 1);
        if (n.visKey || below.length) out.push({ node: n, depth }, ...below);
    }
    return out;
}

const Layers: React.FC<{ viewId: string }> = ({ viewId }) => {
    const tree = useProjectTree();
    const vis = useViewVisibility(viewId);
    const sliceSamples = useAppStore(s => plotById(s, viewId)?.settings?.[SLICE_SAMPLES_SETTING] !== false);
    const groups = useMemo(() => tree.map(root => ({ root, rows: eyeRows(root.children) })).filter(g => g.rows.length), [tree]);
    return (
        <Box sx={{ overflowY: 'auto', p: 1 }}>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Layers</Typography>
            {groups.length === 0 && <Typography variant="caption" color="text.secondary">Nothing to show yet.</Typography>}
            {groups.map(({ root, rows }) => (
                <Box key={root.key} sx={{ mb: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{root.name}</Typography>
                    {rows.map(({ node, depth }) => (
                        <Box key={node.key} sx={{ display: 'flex', alignItems: 'center', pl: depth * 1.5, minHeight: 26 }}>
                            {node.visKey ? (
                                <Checkbox size="small" sx={{ p: 0.25 }} checked={vis.isShown(node.visKey)} inputProps={{ 'aria-label': `Show ${node.name}` }}
                                    onChange={e => vis.setShown([node.visKey!], e.target.checked)} />
                            ) : <Box sx={{ width: 26 }} />}
                            {node.color && <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: node.color, mx: 0.5, flexShrink: 0 }} />}
                            <Typography variant="body2" noWrap title={node.detail ? `${node.name} (${node.detail})` : node.name} sx={{ fontSize: 13 }}>{node.name}</Typography>
                        </Box>
                    ))}
                </Box>
            ))}
            <Divider sx={{ my: 1 }} />
            <Typography variant="caption" color="text.secondary" component="div">The slice cuts</Typography>
            <ToggleButtonGroup size="small" exclusive fullWidth value={sliceSamples ? 'all' : 'drilling'} sx={{ my: 0.5 }}
                onChange={(_, v) => { if (v) useAppStore.getState().updatePlotSettings(viewId, { [SLICE_SAMPLES_SETTING]: v === 'all' }); }}>
                <ToggleButton value="drilling" sx={{ textTransform: 'none', py: 0.25, fontSize: 12 }}>Drilling</ToggleButton>
                <ToggleButton value="all" sx={{ textTransform: 'none', py: 0.25, fontSize: 12 }}>Drilling and samples</ToggleButton>
            </ToggleButtonGroup>
            <Divider sx={{ my: 1 }} />
            <Typography variant="caption" color="text.secondary" component="div">Holes being drilled</Typography>
            {[['Drilled, to the last survey', DRILLED_COLOR], ['Drilled below the last survey', UNSURVEYED_COLOR], ...REPORT_KINDS.map(k => [PROJECTION_LABELS[k], PROJECTION_COLORS[k]])].map(([label, color]) => (
                <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 1, my: 0.25 }}>
                    <Box sx={{ width: 18, height: 3, bgcolor: color }} />
                    <Typography variant="caption">{label}</Typography>
                </Box>
            ))}
        </Box>
    );
};

// ---------------------------------------------------------------------------
// The report on one hole
// ---------------------------------------------------------------------------

const Check: React.FC<{ c: PointCheck | null | undefined }> = ({ c }) => (c ? (
    <>
        <TableCell>{missText(c.miss)}</TableCell>
        <TableCell>{c.closest ? `${n1(c.closest.distance)} m @ ${n1(c.closest.depth)}` : '—'}</TableCell>
    </>
) : <><TableCell>—</TableCell><TableCell>—</TableCell></>);

const RateField: React.FC<{ label: string; value: number; onChange: (v: number) => void; positive?: boolean }> = ({ label, value, onChange, positive }) => {
    const [text, setText] = useState(String(value));
    useEffect(() => setText(String(value)), [value]);
    return (
        <TextField size="small" label={label} value={text} sx={{ width: 110 }} inputProps={{ inputMode: 'decimal' }}
            onChange={e => setText(e.target.value)}
            onBlur={() => { const v = Number(text); if (text.trim() !== '' && Number.isFinite(v) && (!positive || v > 0)) onChange(v); else setText(String(value)); }}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    );
};

const HoleCard: React.FC<{ r: HoleReport; plannedOptions: { key: string; name: string }[]; plannedKey: string | null }> = ({ r, plannedOptions, plannedKey }) => {
    const store = useDrillTrackingStore.getState;
    const manual = useDrillTrackingStore(s => s.tracking.manualLinks[r.hole]);
    const override = useDrillTrackingStore(s => s.tracking.activeOverride[r.hole] ?? null);
    const custom = r.projections.find(p => p.kind === 'custom')?.rates ?? null;
    const hasOwn = useDrillTrackingStore(s => !!s.tracking.custom[r.hole]);
    const [open, setOpen] = useState(true);
    const linkValue = manual === undefined ? 'auto' : manual === null ? 'none' : manual;
    return (
        <Paper variant="outlined" sx={{ p: 1, mb: 1, ...(r.forecast?.flagged ? { borderColor: 'error.main', borderWidth: 2 } : {}) }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <IconButton size="small" onClick={() => setOpen(!open)} aria-label={open ? 'Fold' : 'Unfold'}>{open ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}</IconButton>
                <Typography variant="subtitle2">{r.hole}</Typography>
                <Typography variant="body2" color="text.secondary">→ {r.planned ?? 'not linked'}</Typography>
                {r.forecast?.flagged && <Chip size="small" color="error" icon={<WarningAmber />} label={`${n1(r.forecast.distance)} m off target`} />}
                {r.wedgeOf && <Chip size="small" label={`wedge of ${r.wedgeOf.parent} @ ${n1(r.wedgeOf.kop)} m`} />}
                <Box sx={{ flex: 1 }} />
                <Typography variant="caption" color="text.secondary">{r.activeWhy}</Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 0.5, pl: 4 }}>
                <Typography variant="body2">Depth <b>{n1(r.depth.current)} m</b>{r.depth.currentFrom === 'live' && r.depth.liveDate ? ` (${r.depth.liveDate})` : r.depth.currentFrom === 'max' ? ' (Max_Depth)' : ''}</Typography>
                <Typography variant="body2">Last survey <b>{n1(r.last?.depth)} m</b>{r.last?.method ? ` (${r.last.method})` : ''}</Typography>
                <Typography variant="body2">Dip / Azi <b>{n1(r.last?.dip)} / {n1(r.last?.azi)}</b></Typography>
            </Box>
            {r.forecast && (r.forecast.flagged
                ? <Alert severity="error" sx={{ mt: 0.5, ml: 4, py: 0, '& .MuiAlert-message': { fontSize: 13 } }}>{forecastText(r.forecast)}</Alert>
                : <Typography variant="body2" color="success.main" sx={{ mt: 0.5, pl: 4 }}>{forecastText(r.forecast)}</Typography>)}
            <Collapse in={open}>
                <Box sx={{ pl: 4 }}>
                    {r.rates ? (
                        <Typography variant="body2" sx={{ mt: 0.5 }}>
                            Lift <b>{n2(r.rates.lift)}</b> ± {n2(r.rates.liftSe)}, drift <b>{n2(r.rates.drift)}</b> ± {n2(r.rates.driftSe)} °/100 m over {n1(r.rates.from)}–{n1(r.rates.to)} m
                            ({r.rates.n} surveys; scatter dip {n2(r.rates.dipSd)}°, azi {n2(r.rates.aziSd)}°){r.rates.enough ? '' : ' — few surveys'}
                        </Typography>
                    ) : <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>No lift and drift: fewer than two surveys.</Typography>}
                    {r.required && (
                        <Typography variant="body2" sx={{ mt: 0.5, color: PROJECTION_COLORS.required, fontWeight: 600 }}>{requiredText(r)}</Typography>
                    )}
                    {r.projections.length > 0 && (
                        <Box sx={{ overflowX: 'auto' }}>
                            <Table size="small" sx={{ mt: 0.5, '& td, & th': { px: 0.75, py: 0.25, fontSize: 12, whiteSpace: 'nowrap' } }}>
                                <TableHead>
                                    <TableRow>
                                        <TableCell>Projection</TableCell><TableCell>Lift / drift</TableCell>
                                        <TableCell>At target</TableCell><TableCell>Closest to target</TableCell>
                                        <TableCell>At planned EOH</TableCell><TableCell>Closest to EOH</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {r.projections.map(p => (
                                        <TableRow key={p.kind}>
                                            <TableCell><Box component="span" sx={{ display: 'inline-block', width: 10, height: 3, bgcolor: PROJECTION_COLORS[p.kind], mr: 0.5, verticalAlign: 'middle' }} />{PROJECTION_LABELS[p.kind]}</TableCell>
                                            <TableCell>{n2(p.rates.lift)} / {n2(p.rates.drift)}</TableCell>
                                            <Check c={p.target} />
                                            <Check c={p.eoh} />
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </Box>
                    )}
                    {r.notes.length > 0 && <Typography variant="caption" color="warning.main" component="div" sx={{ mt: 0.5 }}>{r.notes.join(' ')}</Typography>}
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mt: 1 }}>
                        {custom && <>
                            <RateField label="Lift given" value={custom.lift} onChange={v => store().setCustomRates(r.hole, { lift: v, drift: custom.drift })} />
                            <RateField label="Drift given" value={custom.drift} onChange={v => store().setCustomRates(r.hole, { lift: custom.lift, drift: v })} />
                            {hasOwn && <Tooltip title="Back to the planned hole's lift and drift"><IconButton size="small" onClick={() => store().setCustomRates(r.hole, null)}><RestartAlt fontSize="small" /></IconButton></Tooltip>}
                        </>}
                        <TextField select size="small" label="Planned hole" value={linkValue} sx={{ minWidth: 170 }}
                            onChange={e => store().setManualLink(r.hole, e.target.value === 'auto' ? undefined : e.target.value === 'none' ? null : e.target.value)}>
                            <MenuItem value="auto"><em>Matched by ID{plannedKey && manual === undefined ? ` (${r.planned})` : ''}</em></MenuItem>
                            <MenuItem value="none">None</MenuItem>
                            {plannedOptions.map(o => <MenuItem key={o.key} value={o.key}>{o.name}</MenuItem>)}
                        </TextField>
                        <TextField select size="small" label="Being drilled" value={override ?? 'auto'} sx={{ minWidth: 130 }}
                            onChange={e => store().setActiveOverride(r.hole, e.target.value === 'auto' ? null : e.target.value as 'on' | 'off')}>
                            <MenuItem value="auto">By status / dates</MenuItem>
                            <MenuItem value="on">Yes (by hand)</MenuItem>
                            <MenuItem value="off">No (by hand)</MenuItem>
                        </TextField>
                    </Box>
                </Box>
            </Collapse>
        </Paper>
    );
};

// ---------------------------------------------------------------------------
// The report panel
// ---------------------------------------------------------------------------

const ReportPanel: React.FC = () => {
    const programs = useDrillTrackingStore(s => s.programs);
    const live = useDrillTrackingStore(s => s.live);
    const rules = useDrillTrackingStore(s => s.tracking.rules);
    const programId = useDrillTrackingStore(s => s.tracking.programId);
    const tracking = useTracking();
    const [reading, setReading] = useState(false);
    const [importing, setImporting] = useState(false);
    const [rulesOpen, setRulesOpen] = useState(false);
    const [plannedOpen, setPlannedOpen] = useState(false);
    const acquireKept = useDrillTrackingStore(s => s.tracking.acquire);
    const [refreshing, setRefreshing] = useState(false);
    const store = useDrillTrackingStore.getState;
    const plannedOptions = useMemo(() => tracking.planned.map(p => ({ key: p.key, name: p.name })), [tracking.planned]);
    const linkOf = useMemo(() => new Map(tracking.links.map(l => [l.hole, l.planned])), [tracking.links]);
    const age = live ? hoursSince(live.source.readAt) : null;
    const meta = () => ({ refreshedAt: live ? localTime(live.source.readAt) : '', source: live ? sourceText(live.source) : '', window: rules.window });
    const exportCsv = () => {
        const day = localTime(new Date().toISOString()).slice(0, 10);
        downloadText(reportCsv(tracking.reports, meta()), `drill-tracking-${day}.csv`, 'text/csv');
    };
    const toReport = () => {
        const t = meetingTable(tracking.reports);
        const m = meta();
        useReportStore.getState().addTable({
            title: `Drill tracking ${localTime(new Date().toISOString()).slice(0, 10)}`,
            caption: `Holes being drilled against "${tracking.program?.name ?? 'no program'}"${tracking.program ? ` (changed ${localTime(tracking.program.changed)})` : ''}. Acquire data read ${m.refreshedAt} from ${m.source}. Lift / drift over the last ${m.window} m of surveys. High / low towards the planned hole's high side, right / left looking down it.`,
            columns: t.columns, rows: t.rows,
        });
        notify('Added the drill tracking table to the Report page.', 'success');
    };
    const flagged = tracking.reports.filter(r => r.forecast?.flagged);
    const inactive = useMemo(() => (live?.collars ?? []).filter(c => !tracking.active.get(c.hole)?.active).map(c => c.hole), [live, tracking.active]);
    return (
        <Box sx={{ overflowY: 'auto', p: 1 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 1 }}>
                <TextField select size="small" label="Track against" value={programId ?? ''} sx={{ minWidth: 200 }}
                    onChange={e => store().setTracking({ programId: e.target.value || null })}>
                    <MenuItem value=""><em>no program</em></MenuItem>
                    {programs.map(p => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
                </TextField>
                <TextField size="small" label="Lift / drift over (m)" type="number" value={rules.window} sx={{ width: 140 }}
                    onChange={e => { const v = Number(e.target.value); if (v > 0) store().setTracking({ rules: { ...rules, window: v } }); }} />
                <Tooltip title="A hole on track (by its recent lift and drift) to pass further than this from its planned target is flagged">
                    <span><RateField label="Flag beyond (m)" positive value={rules.missLimit ?? TRACK_DEFAULTS.missLimit} onChange={v => store().setTracking({ rules: { ...rules, missLimit: v } })} /></span>
                </Tooltip>
                {acquireKept && (
                    <Tooltip title={`Read the latest from Acquire again: profile ${acquireKept.profile ?? 'set by the server'}${acquireKept.days ? `, holes started in the last ${acquireKept.days} days` : ''}${acquireKept.holeIds.length ? `, ${acquireKept.holeIds.length} listed holes` : ''}`}>
                        <span>
                            <Button size="small" variant="contained" disabled={refreshing} startIcon={refreshing ? <CircularProgress size={14} color="inherit" /> : <Refresh fontSize="small" />}
                                onClick={async () => { setRefreshing(true); await refreshFromAcquire(); setRefreshing(false); }} sx={{ textTransform: 'none' }}>Refresh from Acquire</Button>
                        </span>
                    </Tooltip>
                )}
                <Button size="small" variant="outlined" startIcon={<UploadFile fontSize="small" />} onClick={() => setReading(true)} sx={{ textTransform: 'none' }}>Read drilled holes…</Button>
                <Button size="small" startIcon={<UploadFile fontSize="small" />} onClick={() => setImporting(true)} sx={{ textTransform: 'none' }}>Import a program…</Button>
                <Button size="small" startIcon={<Tune fontSize="small" />} onClick={() => setRulesOpen(true)} sx={{ textTransform: 'none' }}>Survey rules…</Button>
                <Button size="small" startIcon={<FileDownload fontSize="small" />} disabled={!tracking.reports.length} onClick={exportCsv} sx={{ textTransform: 'none' }}>CSV</Button>
                <Button size="small" startIcon={<Article fontSize="small" />} disabled={!tracking.reports.length} onClick={toReport} sx={{ textTransform: 'none' }}>To Report</Button>
            </Box>
            {live ? (
                <Alert severity={age !== null && age > 24 ? 'warning' : 'info'} sx={{ mb: 1, py: 0, '& .MuiAlert-message': { fontSize: 12 } }}>
                    Acquire data read {localTime(live.source.readAt)}{age !== null ? ` (${age < 1 ? 'under an hour' : `${Math.round(age)} h`} ago)` : ''}
                    {' '}from {sourceText(live.source)}: {live.collars.length.toLocaleString()} holes.
                </Alert>
            ) : <Alert severity="info" sx={{ mb: 1 }}>Read the holes being drilled, from Acquire or from its collar and survey export, to track them.</Alert>}
            {flagged.length > 0 && (
                <Alert severity="error" sx={{ mb: 1 }} data-testid="off-track">
                    {flagged.length === 1 ? '1 hole is' : `${flagged.length} holes are`} on track to pass more than {flagged[0].forecast!.limit} m from {flagged.length === 1 ? 'its' : 'their'} planned target:
                    {' '}{flagged.map(r => `${r.hole} (${n1(r.forecast!.distance)} m)`).join(', ')}.
                </Alert>
            )}
            {!tracking.program && programs.length > 0 && <Alert severity="info" sx={{ mb: 1 }}>Choose the program to track against.</Alert>}
            {programs.length === 0 && (
                <Alert severity="info" sx={{ mb: 1 }}>
                    No planned programs yet: save one from the drillhole planner ("Save as program"), or import one under Drillholes › Planned holes in the modelling project tree.
                </Alert>
            )}
            <Typography variant="subtitle2" sx={{ mt: 1, mb: 0.5 }}>Being drilled ({tracking.reports.length})</Typography>
            {live && tracking.reports.length === 0 && <Typography variant="body2" color="text.secondary">No hole is being drilled by its status or dates. Set one by hand below.</Typography>}
            {tracking.reports.map(r => <HoleCard key={r.hole} r={r} plannedOptions={plannedOptions} plannedKey={linkOf.get(r.hole) ?? null} />)}
            {live && (
                <Autocomplete size="small" options={inactive} value={null} sx={{ maxWidth: 320, mt: 1 }} blurOnSelect
                    onChange={(_, v) => { if (v) store().setActiveOverride(v, 'on'); }}
                    renderInput={params => <TextField {...params} label="Set a hole as being drilled (by hand)" />} />
            )}
            {tracking.program && (
                <Box sx={{ mt: 2 }}>
                    <Button size="small" onClick={() => setPlannedOpen(!plannedOpen)} startIcon={plannedOpen ? <ExpandLess /> : <ExpandMore />} sx={{ textTransform: 'none' }}>
                        Planned holes of {tracking.program.name}: {tracking.planned.filter(p => p.state === 'drilling').length} being drilled,
                        {' '}{tracking.planned.filter(p => p.state === 'drilled').length} drilled, {tracking.planned.filter(p => p.state === 'not drilled').length} not drilled yet
                    </Button>
                    <Collapse in={plannedOpen}>
                        <Table size="small" sx={{ '& td, & th': { px: 0.75, py: 0.25, fontSize: 12 } }}>
                            <TableHead><TableRow><TableCell>Planned</TableCell><TableCell>State</TableCell><TableCell>Drilled holes (tracked first)</TableCell></TableRow></TableHead>
                            <TableBody>
                                {tracking.planned.map(p => (
                                    <TableRow key={p.key}>
                                        <TableCell>{p.name}</TableCell>
                                        <TableCell>{p.state}</TableCell>
                                        <TableCell>{[p.tracked, ...p.drilled.filter(d => d !== p.tracked)].filter(Boolean).join(', ')}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </Collapse>
                </Box>
            )}
            <LiveImportDialog open={reading} onClose={() => setReading(false)} />
            <ProgramImportDialog open={importing} onClose={() => setImporting(false)} />
            <SurveyRulesDialog open={rulesOpen} onClose={() => setRulesOpen(false)} />
        </Box>
    );
};

export const DrillTrackingView: React.FC = () => {
    const viewId = useTrackingView();
    const ready = useAppStore(s => s.trackingViews.some(v => v.id === viewId));
    const hasData = useAppStore(s => s.columns.length > 0);
    return (
        <Box sx={{ display: 'flex', flex: 1, minHeight: 0, height: '100%' }}>
            <Paper square variant="outlined" sx={{ width: 230, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                {ready && <Layers viewId={viewId} />}
            </Paper>
            <Box sx={{ flex: 1, minWidth: 360, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
                {!hasData && (
                    <Alert severity="info" sx={{ m: 1 }}>The 3D view takes its coordinates from the project's samples: import the project's drillhole data to see the holes in 3D. The report works without it.</Alert>
                )}
                {/* A pane of its own, so the viewer fills the page's height (useFillHeight measures the pane) */}
                <Box sx={{ flex: 1, minHeight: 0 }}>
                    <PaneContent controls={NO_PANE_CONTROLS}>
                        <PlotIdContext.Provider value={viewId}>
                            <ErrorBoundary>
                                {ready && hasData && (
                                    <Suspense fallback={<Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress size={24} /></Box>}>
                                        <Viewer3D plotId={viewId} />
                                    </Suspense>
                                )}
                            </ErrorBoundary>
                        </PlotIdContext.Provider>
                    </PaneContent>
                </Box>
            </Box>
            <Paper square variant="outlined" sx={{ width: 560, flexShrink: 1, minWidth: 380, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <ReportPanel />
            </Paper>
        </Box>
    );
};

export default DrillTrackingView;
