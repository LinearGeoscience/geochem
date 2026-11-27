/**
 * The drillhole planner's panel, docked beside the 3D view like the
 * model list: the planned holes, the selected hole's form, import /
 * export, and the settings.
 *
 * Holes are planned on the 3D view's active slice: with no slice on, the
 * panel says so and offers to turn one on (the list, export and import still
 * work). Keys typed here never reach the 3D view's shortcuts (T, F, K, C, L,
 * 1, 2, [, ], Ctrl+…): a hole ID typed in never moves the slice.
 */
import React, { useRef, useState } from 'react';
import {
    Alert, Box, Button, Checkbox, CircularProgress, Collapse, Divider, IconButton, LinearProgress, Menu, MenuItem, Paper, Stack, Switch, FormControlLabel,
    Table, TableBody, TableCell, TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import { Add, AccountTree, Close, ContentCopy, DeleteOutline, ErrorOutline, ExpandLess, ExpandMore, FileDownload, FileUpload, Place, VerticalSplit, WarningAmber } from '@mui/icons-material';
import { useShallow } from 'zustand/react/shallow';
import { notify } from '../../../../store/notificationStore';
import { HoleInput, OPTION_LABELS, PlanOption, planHole } from '../../../../utils/drillholePlan';
import { startOnSlice } from '../../../../utils/drillholePlanSlice';
import {
    IMPORT_TOLERANCE, csvKind, inputFromCollarRow, readCollarCsv, readSurveyCsv, surveyMismatch, traceFromCollarRow,
} from '../../../../utils/drillholePlanIO';
import { sliceKind, slicePosition } from '../slices';
import { usePlanStore, TopoRef } from './planStore';
import { HoleEditor, TopoSelect } from './HoleEditor';
import { ExportDialog } from './ExportDialog';
import { ConfirmDialog, NumField, RateLimitsFields, fixed, stopKeys } from './fields';
import { SliceLink, alignToHole, slicePlane, useActiveSlice } from './planSlice';
import { ImportTargetsDialog } from './ImportTargetsDialog';
import { PadsDialog } from './PadsDialog';
import { WedgeDialog } from './WedgeDialog';
import { snapHolesToPads, snapReportText } from './padActions';
import { useModelStore } from '../../../../store/modelStore';
import { roleSetsOf, type Planner } from './usePlans';
import { ProgramBar } from '../../../drilltracking/plannerPrograms';

/** Settings → pads: which set collars snap to, how far and how much change from the guide; and wedges' shallowest kick-off */
/** How the drill pads and target points are drawn: dots or crosses, per set (shown, hidden and coloured in the project tree) */
const PointMarks: React.FC = () => {
    const inputs = useModelStore(s => s.scene.inputs);
    const sets = roleSetsOf(inputs);
    if (sets.length === 0) return null;
    return (
        <Box sx={{ mt: 0.75 }}>
            <Typography variant="caption" color="text.secondary" component="div">
                Pads and target points: show, hide and colour them with their eye and colour in the project tree or the Scene list; drawn as
            </Typography>
            {sets.map(p => (
                <Box key={p.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
                    <Box component="span" sx={{ width: 10, height: 10, bgcolor: p.color, borderRadius: '50%', ml: 0.5, flexShrink: 0 }} />
                    <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }} title={p.name}>{p.name}</Typography>
                    <ToggleButtonGroup size="small" exclusive value={p.mark ?? 'dot'} onChange={(_, v: 'dot' | 'cross' | null) => { if (v) useModelStore.getState().setPointSetMark(p.id, v); }}>
                        <ToggleButton value="dot" sx={{ textTransform: 'none', py: 0, px: 0.75 }}>Dots</ToggleButton>
                        <ToggleButton value="cross" sx={{ textTransform: 'none', py: 0, px: 0.75 }}>Crosses</ToggleButton>
                    </ToggleButtonGroup>
                </Box>
            ))}
        </Box>
    );
};

const PadSettings: React.FC<{ planner: Planner }> = ({ planner }) => {
    const settings = usePlanStore(s => s.settings);
    const set = usePlanStore(s => s.setSettings);
    const chosen = planner.padSets.find(p => p.id === settings.padSetId) ?? (planner.padSets.length === 1 ? planner.padSets[0] : null);
    return (
        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 0.75 }}>
            <Typography variant="caption" sx={{ fontWeight: 600 }}>Pads and wedges</Typography>
            {planner.padSets.length === 0 ? (
                <Typography variant="caption" color="text.secondary" component="div">No pads yet: Import → Pad locations.</Typography>
            ) : <>
                {planner.padSets.map(p => (
                    <Box key={p.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Box component="span" sx={{ width: 10, height: 10, bgcolor: p.color, borderRadius: '50%', ml: 0.5 }} />
                        <Typography variant="body2" sx={{ flex: 1 }}>{p.name} ({p.points.length}){chosen?.id === p.id ? ' · snapped to' : ''}</Typography>
                        {planner.padSets.length > 1 && chosen?.id !== p.id && <Button size="small" sx={smallButton} onClick={() => set({ padSetId: p.id })}>Use</Button>}
                        <Tooltip title="Remove this pad set from the project"><IconButton size="small" onClick={() => useModelStore.getState().removeInputSet(p.id)}><DeleteOutline fontSize="small" /></IconButton></Tooltip>
                    </Box>
                ))}
                <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 0.5 }}>
                    <NumField label="Pad search radius m" value={settings.padRadius} width={140} onChange={v => v !== null && v > 0 && set({ padRadius: v })} />
                    <NumField label="Max dip change °" value={settings.padMaxDip} width={120} onChange={v => v !== null && v >= 0 && set({ padMaxDip: v })} />
                    <NumField label="Max azi change °" value={settings.padMaxAzi} width={120} onChange={v => v !== null && v >= 0 && set({ padMaxAzi: v })} />
                </Box>
            </>}
            <PointMarks />
            <Box sx={{ mt: 0.75, display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                <NumField label="Shallowest wedge kick-off m" value={settings.minKop} width={180} onChange={v => v !== null && v >= 0 && set({ minKop: v })} />
            </Box>
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.75 }}>
                Wedge lift and drift limits, °/100 m (what the ground allows; a wedge can have its own)
            </Typography>
            <Box sx={{ mt: 0.5 }}>
                <RateLimitsFields value={settings.wedgeLimits} onChange={v => set({ wedgeLimits: v })} />
            </Box>
        </Box>
    );
};

/** Settings → Apply to all: the same values on every hole planned from a target */
const ApplyToAll: React.FC<{ planner: Planner }> = ({ planner }) => {
    const [use, setUse] = useState({ rates: false, angles: false, topo: false });
    const [lift, setLift] = useState<number | null>(0);
    const [drift, setDrift] = useState<number | null>(0);
    const [dip, setDip] = useState<number | null>(-90);
    const [azi, setAzi] = useState<number | null>(0);
    const [topo, setTopo] = useState<TopoRef | null>(null);
    const count = planner.holes.filter(h => h.hole.input.mode === 'target').length;
    const ok = (use.rates || use.angles || use.topo) && (!use.rates || (lift !== null && drift !== null))
        && (!use.angles || (dip !== null && dip >= -90 && dip <= 0 && azi !== null)) && (!use.topo || !!topo);
    const apply = () => {
        const n = usePlanStore.getState().applyToAll({
            lift: use.rates ? lift : null, drift: use.rates ? drift : null,
            targetDip: use.angles ? dip : null, targetAzi: use.angles ? azi : null, topo: use.topo ? topo : null,
        });
        notify(`Changed ${n} hole${n === 1 ? '' : 's'} planned from a target.`, 'success');
    };
    const tick = (k: keyof typeof use, label: string) => (
        <FormControlLabel sx={{ mr: 0, minWidth: 120 }} control={<Checkbox size="small" checked={use[k]} onChange={e => setUse(u => ({ ...u, [k]: e.target.checked }))} />} label={<Typography variant="body2">{label}</Typography>} />
    );
    return (
        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 0.75 }}>
            <Typography variant="caption" sx={{ fontWeight: 600 }}>Apply to all {count} hole{count === 1 ? '' : 's'} planned from a target</Typography>
            <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap', mt: 0.5 }}>
                {tick('rates', 'Lift / drift')}
                <NumField label="Lift" value={lift} width={80} disabled={!use.rates} onChange={setLift} />
                <NumField label="Drift" value={drift} width={80} disabled={!use.rates} onChange={setDrift} />
            </Box>
            <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap', mt: 0.5 }}>
                {tick('angles', 'At target')}
                <NumField label="Dip" value={dip} width={80} disabled={!use.angles} onChange={setDip} />
                <NumField label="Grid azi" value={azi} width={80} disabled={!use.angles} onChange={setAzi} />
            </Box>
            <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', mt: 0.5 }}>
                {tick('topo', 'Topography')}
                <Box sx={{ flex: 1, minWidth: 0 }}><TopoSelect planner={planner} value={topo} disabled={!use.topo} onChange={setTopo} /></Box>
            </Box>
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>Dip and azimuth at the target change only holes projected to the surface. A hole vertical at its target can't take positive lift (going up it would pass vertical): give it a dip too.</Typography>
            <Button size="small" variant="outlined" sx={{ ...smallButton, mt: 0.5 }} disabled={!ok || count === 0} onClick={apply}>Apply to {count}</Button>
        </Box>
    );
};

export const PLANNER_PANEL_WIDTH = 384;

const cell = { px: 0.5, py: 0.25, fontSize: 12, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' } as const;
const smallButton = { textTransform: 'none', minWidth: 0, px: 1 } as const;
const KIND_NAMES = { we: 'W-E section', sn: 'S-N section', level: 'level plan', other: 'slice' } as const;

export const PlannerPanel: React.FC<{
    planner: Planner;
    height: number;
    link: SliceLink;
    onClose: () => void;
}> = ({ planner, height, link, onClose }) => {
    const { selectedId, settings, view2d } = usePlanStore(useShallow(s => ({ selectedId: s.selectedId, settings: s.settings, view2d: s.view2d })));
    const store = usePlanStore.getState;
    const slice = useActiveSlice(link);
    const [addMenu, setAddMenu] = useState<HTMLElement | null>(null);
    const [importMenu, setImportMenu] = useState<HTMLElement | null>(null);
    const [targetsOpen, setTargetsOpen] = useState(false);
    const [padsOpen, setPadsOpen] = useState(false);
    const [wedgesOpen, setWedgesOpen] = useState(false);
    const [snapMenu, setSnapMenu] = useState<HTMLElement | null>(null);
    const [deleteMenu, setDeleteMenu] = useState<HTMLElement | null>(null);
    const [confirm, setConfirm] = useState<'selected' | 'family' | 'all' | null>(null);
    /** The holes a delete would take: the selected one, its wedge family, or all */
    const doomed = (which: 'selected' | 'family' | 'all' | null) => {
        if (which === 'all') return planner.holes;
        if (which === 'family' && selected?.result.wedge) return planner.holes.filter(h => h.result.wedge?.parentName === selected.result.wedge!.parentName || (h.hole.input.mode === 'wedge' && h.parentName === selected.result.wedge!.parentName));
        return selected ? [selected] : [];
    };
    /** Snap the selected hole, or every hole planned from a target, to the nearest pad */
    const snap = (which: 'selected' | 'all') => {
        setSnapMenu(null);
        const ids = which === 'selected' ? (selectedId ? [selectedId] : []) : planner.holes.filter(h => h.hole.input.mode === 'target').map(h => h.hole.id);
        const r = snapHolesToPads(planner, ids);
        notify(snapReportText(r) || 'Nothing to snap.', r.failed.length ? 'warning' : 'success');
    };
    const [search, setSearch] = useState('');
    // Holes are projected to the surface: nothing is added without a topography
    const topoReady = !!settings.defaultTopo && !!planner.topoOf(settings.defaultTopo);
    const shown = search.trim() ? planner.holes.filter(h => h.hole.input.name.toLowerCase().includes(search.trim().toLowerCase())) : planner.holes;
    // The header box shows / hides every hole listed
    const allShown = shown.length > 0 && shown.every(h => h.hole.visible);
    const someShown = shown.some(h => h.hole.visible);
    /** Select a hole; the slice turns to it (the upright plane through its collar and target) */
    const pick = (id: string, result: Planner['holes'][number]['result']) => {
        store().select(id);
        if (store().settings.followSelection) alignToHole(link, result);
    };
    const [exportOpen, setExportOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);
    const selected = planner.selected;

    /** A new hole, laid along the slice in the middle of the data, ready to drag into place */
    const add = (option: PlanOption) => {
        setAddMenu(null);
        const b = planner.dataBounds;
        if (!slice || !b) return;
        const start = startOnSlice(slicePlane(slice), (b.min[2] + b.max[2]) / 2, b.max[2]);
        const topo = !!store().settings.defaultTopo;
        const collar = { e: start.collar[0], n: start.collar[1], rl: start.collar[2] };
        const target = { e: start.target[0], n: start.target[1], rl: start.target[2] };
        const length = Math.hypot(start.collar[0] - start.target[0], start.collar[1] - start.target[1], start.collar[2] - start.target[2]);
        const init: Partial<HoleInput> = option === 'collar'
            ? { collar, rlFromTopo: topo, dip: -60, azi: Math.round(start.azimuth * 10) / 10, eoh: Math.round(length * 1.2), lift: 0, drift: 0 }
            : option === 'surface'
                ? { target, method: 'surface-curved', targetDip: -60, targetAzi: Math.round(start.azimuth * 10) / 10, lift: 0, drift: 0 }
                : { collar, rlFromTopo: topo, target, method: 'lift-drift', lift: 0, drift: 0 };
        store().addHole(option === 'collar' ? 'collar' : 'target', init);
    };

    const importFiles = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        let collarText: string | null = null, surveyText: string | null = null;
        for (const f of Array.from(files)) {
            const text = await f.text();
            const kind = csvKind(text);
            if (kind === 'collar') collarText = text;
            else if (kind === 'survey') surveyText = text;
        }
        if (!collarText) { notify('Choose the planner\'s collar CSV (with the survey CSV, to check it).', 'warning'); return; }
        const { rows, problems } = readCollarCsv(collarText);
        const surveys = surveyText ? readSurveyCsv(surveyText) : null;
        const notes = [...problems];
        const incoming: { input: HoleInput; topo: TopoRef | null }[] = [];
        let worst = 0;
        for (const row of rows) {
            const topo = row.topography ? planner.topoByName(row.topography) : null;
            const { input, note } = inputFromCollarRow(row, !!topo && !!planner.topoOf(topo));
            if (note) notes.push(note);
            incoming.push({ input, topo });
            // The collar row rebuilt, against its survey
            const trace = traceFromCollarRow(row);
            const stations = surveys?.get(row.name);
            if (trace && stations) {
                const miss = surveyMismatch(trace, stations);
                worst = Math.max(worst, miss.distance);
                if (miss.distance > IMPORT_TOLERANCE) notes.push(`${row.name}: the survey differs from the collar row by ${fixed(miss.distance, 3)} m at ${fixed(miss.depth, 1)} m.`);
            } else if (surveys && !stations) notes.push(`${row.name}: not in the survey CSV.`);
            // Re-planned in its own mode, it should land where the collar row says
            const again = planHole(input, { topo: planner.topoOf(topo) });
            if (again.collar && row.collar) {
                const moved = Math.hypot(again.collar[0] - row.collar[0], again.collar[1] - row.collar[1], again.collar[2] - row.collar[2]);
                if (moved > IMPORT_TOLERANCE) notes.push(`${row.name}: re-planned, its collar moves ${fixed(moved, 2)} m (the topography has changed?).`);
            }
        }
        if (incoming.length === 0) { notify('No holes in the collar CSV.', 'warning'); return; }
        const replaced = incoming.filter(h => store().holes.some(p => p.input.name === h.input.name)).length;
        store().putHoles(incoming);
        const head = `Imported ${incoming.length} planned hole${incoming.length === 1 ? '' : 's'}${replaced ? ` (${replaced} replaced by ID)` : ''}${surveys ? `; survey check: within ${fixed(Math.max(worst, 0), 3)} m` : '; no survey CSV to check against'}.`;
        notify(notes.length ? `${head} ${notes.join(' ')}` : head, notes.length ? 'warning' : 'success');
    };

    const issuesOf = (r: Planner['holes'][number]['result']) => {
        const e = r.issues.filter(i => i.level === 'error').length, w = r.issues.length - e;
        if (e) return <Tooltip title={r.issues.filter(i => i.level === 'error').map(i => i.text).join(' ')}><ErrorOutline color="error" sx={{ fontSize: 16 }} /></Tooltip>;
        if (w) return <Tooltip title={r.issues.map(i => i.text).join(' ')}><WarningAmber color="warning" sx={{ fontSize: 16 }} /></Tooltip>;
        return null;
    };

    const optionName = (input: HoleInput) => (input.mode === 'collar' ? 'Collar' : input.mode === 'wedge' ? 'Wedge' : input.method.startsWith('surface') ? 'To surface' : input.collarPad ? 'Pad→target' : 'Collar→target');
    const sliceText = slice && planner.dataBounds
        ? (() => {
            const kind = sliceKind(slice.normal);
            const centre = [0, 1, 2].map(k => (planner.dataBounds!.min[k] + planner.dataBounds!.max[k]) / 2) as [number, number, number];
            const at = kind === 'other' ? '' : ` at ${Math.round(slicePosition(slice, centre)).toLocaleString()}`;
            return `Planning on the ${KIND_NAMES[kind]}${at}, ${fixed(slice.width, 0)} m wide.`;
        })() : '';

    return (
        <Paper data-testid="planner-panel" variant="outlined" {...stopKeys}
            // Gives way on a narrow screen (down to 300 px) so the 3D view keeps some room
            sx={{ width: PLANNER_PANEL_WIDTH, flexShrink: 1, minWidth: 300, height, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <Box sx={{ p: 0.75, pl: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography variant="subtitle2" sx={{ flex: 1 }}>Drillhole planner</Typography>
                <Tooltip title="Also draw the slice in 2D (true scale) beside the 3D view; targets can be dragged there too">
                    <span>
                        <Button size="small" variant={view2d.on ? 'contained' : 'outlined'} disabled={!slice && !view2d.on} startIcon={<VerticalSplit fontSize="small" />} sx={smallButton}
                            onClick={() => store().setView2d({ on: !view2d.on })}>2D slice view</Button>
                    </span>
                </Tooltip>
                <Tooltip title="Close this panel"><IconButton size="small" aria-label="Close the drillhole planner" onClick={onClose}><Close fontSize="small" /></IconButton></Tooltip>
            </Box>
            {/* The program the planner has open, or "Save as program" (features/drilltracking) */}
            <ProgramBar planner={planner} />
            <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 1, pb: 1 }}>
                {!planner.enabled ? (
                    <Typography variant="body2" color="text.secondary">The planner needs an elevation (Z) column in this view.</Typography>
                ) : <>
                    {slice ? (
                        <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
                            {sliceText} Drag a target or collar on the slice, or use Place. Moving the slice never moves a target.
                        </Typography>
                    ) : (
                        <Alert severity="warning" sx={{ mb: 1, '& .MuiAlert-message': { fontSize: 12 } }}
                            action={<Button size="small" color="inherit" sx={{ textTransform: 'none' }} onClick={link.turnOn}>Turn on slice</Button>}>
                            Holes are planned on the 3D slice. Turn on a slice to plan.
                        </Alert>
                    )}
                    {/* Holes are projected to the surface: a topography comes before any hole */}
                    <Box sx={{ my: 0.75 }}>
                        <TopoSelect planner={planner} label="Topography for new holes" value={settings.defaultTopo} onChange={v => store().setSettings({ defaultTopo: v })} />
                    </Box>
                    {!topoReady && (
                        <Alert severity="warning" sx={{ mb: 1, '& .MuiAlert-message': { fontSize: 12 } }}>
                            Holes are projected to the surface, so a topography comes first: load a topography wireframe, or make one on the Geological Modelling page (New → Topography from the hole collars, or from a file), then choose it here.
                        </Alert>
                    )}
                    <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.75, lineHeight: 1.35 }}>
                        Dip negative down (−90 to 0). Grid azi: 0–360° clockwise from grid north (not true or magnetic). Lift + flattens, drift + clockwise (°/100 m). Plans are kept until the page is closed: export them.
                    </Typography>
                    <Stack direction="row" spacing={0.5} sx={{ mb: 0.75, flexWrap: 'wrap', rowGap: 0.5 }}>
                        <Tooltip title={!topoReady ? 'Choose a topography first' : slice ? 'A new hole on the slice, in the middle of the data, ready to drag into place' : 'Turn on a 3D slice first'}>
                            <span><Button size="small" variant="contained" disabled={!slice || !topoReady} startIcon={<Add fontSize="small" />} sx={smallButton} onClick={e => setAddMenu(e.currentTarget)}>Add hole</Button></span>
                        </Tooltip>
                        <Menu open={!!addMenu} anchorEl={addMenu} onClose={() => setAddMenu(null)}>
                            <MenuItem onClick={() => add('collar')}>{OPTION_LABELS.collar}: collar, dip, azimuth, depth</MenuItem>
                            <MenuItem onClick={() => add('surface')}>{OPTION_LABELS.surface}: a target, back-projected to the topography</MenuItem>
                            <MenuItem onClick={() => add('collar-target')}>{OPTION_LABELS['collar-target']}: collar and target, lift and drift</MenuItem>
                        </Menu>
                        <Tooltip title={planner.pads.length ? 'Move collars to the nearest pad (each hole’s dip and azimuth at its target, lift and drift are the guide)' : 'Import pad locations first (Import → Pad locations)'}>
                            <span><Button size="small" variant="outlined" disabled={!planner.pads.length || planner.holes.length === 0} startIcon={<Place fontSize="small" />} sx={smallButton} onClick={e => setSnapMenu(e.currentTarget)}>Snap to pad</Button></span>
                        </Tooltip>
                        <Menu open={!!snapMenu} anchorEl={snapMenu} onClose={() => setSnapMenu(null)}>
                            <MenuItem disabled={!selectedId} onClick={() => snap('selected')}>The selected hole</MenuItem>
                            <MenuItem onClick={() => snap('all')}>Every hole planned from a target</MenuItem>
                        </Menu>
                        <Tooltip title="Wedge designer: daughter holes off a parent (planned or existing)">
                            <span><Button size="small" variant="outlined" disabled={!slice || planner.holes.length === 0} startIcon={<AccountTree fontSize="small" />} sx={smallButton} onClick={() => setWedgesOpen(true)}>Wedges</Button></span>
                        </Tooltip>
                        <Tooltip title="Duplicate the selected hole"><span><IconButton size="small" disabled={!selectedId} onClick={() => selectedId && store().duplicateHole(selectedId)}><ContentCopy fontSize="small" /></IconButton></span></Tooltip>
                        <Button size="small" variant="outlined" color="error" disabled={planner.holes.length === 0} startIcon={<DeleteOutline fontSize="small" />} sx={smallButton} onClick={e => setDeleteMenu(e.currentTarget)}>Delete</Button>
                        <Menu open={!!deleteMenu} anchorEl={deleteMenu} onClose={() => setDeleteMenu(null)}>
                            <MenuItem disabled={!selected} onClick={() => { setDeleteMenu(null); setConfirm('selected'); }}>The selected hole{selected ? ` (${selected.hole.input.name})` : ''}</MenuItem>
                            {selected?.result.wedge && <MenuItem onClick={() => { setDeleteMenu(null); setConfirm('family'); }}>All wedges off {selected.result.wedge.parentName}</MenuItem>}
                            <MenuItem onClick={() => { setDeleteMenu(null); setConfirm('all'); }}>Every planned hole ({planner.holes.length})</MenuItem>
                        </Menu>
                        <Box sx={{ flex: 1 }} />
                        <Button size="small" variant="outlined" startIcon={<FileUpload fontSize="small" />} sx={smallButton} onClick={e => setImportMenu(e.currentTarget)}>Import</Button>
                        <Menu open={!!importMenu} anchorEl={importMenu} onClose={() => setImportMenu(null)}>
                            <MenuItem disabled={!topoReady} onClick={() => { setImportMenu(null); setTargetsOpen(true); }}>
                                Target points (ID, Easting, Northing, RL){topoReady ? '' : ': choose a topography first'}
                            </MenuItem>
                            <MenuItem onClick={() => { setImportMenu(null); setPadsOpen(true); }}>Pad locations (ID, X, Y, Z)</MenuItem>
                            <MenuItem onClick={() => { setImportMenu(null); fileInput.current?.click(); }}>Planned holes (this planner's collar + survey CSVs)</MenuItem>
                        </Menu>
                        <Button size="small" variant="outlined" startIcon={<FileDownload fontSize="small" />} sx={smallButton} disabled={planner.holes.length === 0} onClick={() => setExportOpen(true)}>Export</Button>
                        <input ref={fileInput} type="file" accept=".csv,text/csv" multiple hidden onChange={e => { void importFiles(e.target.files); e.target.value = ''; }} />
                    </Stack>

                    {planner.holes.length > 6 && (
                        <TextField size="small" fullWidth placeholder={`Find a hole (${planner.holes.length})`} value={search} sx={{ mb: 0.5 }}
                            onChange={e => setSearch(e.target.value)} inputProps={{ spellCheck: false }} />
                    )}
                    {planner.wedgeProgress && (
                        <Box sx={{ mb: 0.5 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                                <CircularProgress size={12} />
                                <Typography variant="caption">Working out wedges: {planner.wedgeProgress.done + 1} of {planner.wedgeProgress.total}…</Typography>
                            </Box>
                            <LinearProgress variant="determinate" value={(100 * planner.wedgeProgress.done) / planner.wedgeProgress.total} />
                        </Box>
                    )}
                    {planner.holes.length > 0 && (
                        <Box sx={{ overflowX: 'auto', maxHeight: 190, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                            <Table size="small" stickyHeader>
                                <TableHead>
                                    <TableRow>
                                        <TableCell sx={{ ...cell, fontWeight: 600 }}>
                                            <Tooltip title={allShown ? `Hide all${search.trim() ? ' listed' : ''}` : `Show all${search.trim() ? ' listed' : ''}`}>
                                                <Checkbox size="small" sx={{ p: 0 }} checked={allShown} indeterminate={!allShown && someShown}
                                                    inputProps={{ 'aria-label': 'Show or hide all' }}
                                                    onChange={() => store().setVisible(shown.map(h => h.hole.id), !allShown)} />
                                            </Tooltip>
                                        </TableCell>
                                        {['Hole ID', 'How', 'Collar E', 'Collar N', 'RL', 'Dip', 'Grid azi', 'Target depth', 'EOH', 'Lift', 'Drift', ''].map((h, i) => <TableCell key={i} sx={{ ...cell, fontWeight: 600 }}>{h}</TableCell>)}
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {shown.map(({ hole, result, pending }) => (
                                        <TableRow key={hole.id} hover selected={hole.id === selectedId} sx={{ cursor: 'pointer' }} onClick={() => pick(hole.id, result)}>
                                            <TableCell sx={cell} onClick={e => e.stopPropagation()}>
                                                <Checkbox size="small" sx={{ p: 0 }} checked={hole.visible} onChange={e => store().setHoleMeta(hole.id, { visible: e.target.checked })} />
                                            </TableCell>
                                            <TableCell sx={cell}>
                                                <Box component="span" sx={{ display: 'inline-block', width: 10, height: 3, bgcolor: hole.style.color, mr: 0.5, verticalAlign: 'middle' }} />
                                                {hole.input.name}
                                            </TableCell>
                                            <TableCell sx={cell}>{optionName(hole.input)}</TableCell>
                                            <TableCell sx={cell}>{fixed(result.collar?.[0], 1)}</TableCell>
                                            <TableCell sx={cell}>{fixed(result.collar?.[1], 1)}</TableCell>
                                            <TableCell sx={cell}>{fixed(result.collar?.[2], 1)}</TableCell>
                                            <TableCell sx={cell}>{fixed(result.collarDip, 1)}</TableCell>
                                            <TableCell sx={cell}>{fixed(result.collarAzi, 1)}</TableCell>
                                            <TableCell sx={cell}>{fixed(result.targetDepth, 1)}</TableCell>
                                            <TableCell sx={cell}>{fixed(result.eoh, 1)}</TableCell>
                                            <TableCell sx={cell}>{fixed(result.lift, 2)}</TableCell>
                                            <TableCell sx={cell}>{fixed(result.drift, 2)}</TableCell>
                                            <TableCell sx={cell}>{pending ? <Tooltip title="Being worked out"><CircularProgress size={12} /></Tooltip> : issuesOf(result)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </Box>
                    )}

                    {selected ? <HoleEditor key={selected.hole.id} planner={planner} item={selected} slice={slice} link={link} /> : (
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                            {slice ? 'Add a hole: it starts on the slice, ready to drag into place.' : 'Turn on a 3D slice, then add a hole.'}
                        </Typography>
                    )}

                    <Divider sx={{ my: 1 }} />
                    <Button size="small" sx={smallButton} endIcon={settingsOpen ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />} onClick={() => setSettingsOpen(o => !o)}>Settings</Button>
                    <Collapse in={settingsOpen}>
                        <Stack spacing={1} sx={{ pt: 1 }}>
                            <FormControlLabel sx={{ mr: 0 }} control={<Switch size="small" checked={settings.followSelection} onChange={e => store().setSettings({ followSelection: e.target.checked })} />}
                                label={<Typography variant="body2">Selecting a hole turns the slice to its collar and target</Typography>} />
                            <FormControlLabel sx={{ mr: 0 }} control={<Switch size="small" checked={settings.labelAll} onChange={e => store().setSettings({ labelAll: e.target.checked })} />}
                                label={<Typography variant="body2">Name every hole in 3D (else only the selected one)</Typography>} />
                            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                                <NumField label="Lift/drift limit °/100 m" value={settings.liftLimit} width={160} onChange={v => v !== null && v > 0 && store().setSettings({ liftLimit: v })} />
                                <NumField label="RL datum check m" value={settings.rlTolerance} width={140} onChange={v => v !== null && v > 0 && store().setSettings({ rlTolerance: v })} />
                                <NumField label="Max back-projection m" value={settings.maxBackLength} width={160} onChange={v => v !== null && v > 0 && store().setSettings({ maxBackLength: v })} />
                            </Box>
                            <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
                                <FormControlLabel sx={{ mr: 0 }} control={<Switch size="small" checked={settings.depthTicks} onChange={e => store().setSettings({ depthTicks: e.target.checked })} />} label={<Typography variant="body2">Depth ticks in 3D every</Typography>} />
                                <NumField label="m" value={settings.tickInterval} width={70} onChange={v => v !== null && v > 0 && store().setSettings({ tickInterval: v })} />
                            </Box>
                            <PadSettings planner={planner} />
                            <ApplyToAll planner={planner} />
                        </Stack>
                    </Collapse>
                </>}
            </Box>
            <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} planner={planner} />
            <ImportTargetsDialog open={targetsOpen} onClose={() => setTargetsOpen(false)} planner={planner} />
            <PadsDialog open={padsOpen} onClose={() => setPadsOpen(false)} />
            <ConfirmDialog
                open={confirm !== null} onClose={() => setConfirm(null)} confirm="Delete"
                title={confirm === 'all' ? 'Delete every planned hole?' : confirm === 'family' ? 'Delete these wedges?' : 'Delete this hole?'}
                text={(() => {
                    const list = doomed(confirm);
                    const names = list.slice(0, 10).map(h => h.hole.input.name).join(', ') + (list.length > 10 ? `, … (${list.length})` : '');
                    return `${names} will be deleted. This can't be undone (export first to keep a copy).${confirm !== 'family' && list.some(h => planner.holes.some(d => d.hole.input.parent?.kind === 'planned' && d.hole.input.parent.id === h.hole.id)) ? ' Wedges off a deleted hole lose their parent.' : ''}`;
                })()}
                onConfirm={() => {
                    const list = doomed(confirm);
                    store().removeHoles(list.map(h => h.hole.id));
                    notify(`Deleted ${list.length} planned hole${list.length === 1 ? '' : 's'}.`, 'info');
                }}
            />
            <WedgeDialog open={wedgesOpen} onClose={() => setWedgesOpen(false)} planner={planner} />
        </Paper>
    );
};
