/**
 * Drill tracking's rows of the project tree: their icons, and what
 * the properties show for each (the Planned holes group, a planned program,
 * the drilled holes read from Acquire).
 */
import React, { useEffect, useState } from 'react';
import { Box, Button, Divider, FormControlLabel, Switch, TextField, Typography, type SxProps, type Theme } from '@mui/material';
import { Construction, DeleteOutline, Edit, FolderSpecial, Timeline, TrackChanges, UploadFile } from '@mui/icons-material';
import { useAppStore } from '../../store/appStore';
import { useDrillTrackingStore } from '../../store/drillTrackingStore';
import { localTime, sourceText } from '../../utils/drillTrackImport';
import type { TreeNode } from '../model/projectTree';
import { parseKey } from '../model/objectKeys';
import { ConfirmDialog } from '../plots/viewer3d/planner/fields';
import { LiveImportDialog, ProgramImportDialog } from './ImportDialogs';
import { useOpenProgram } from './plannerPrograms';
import { useTracking } from './useTracking';

export const TrackingIcon: React.FC<{ node: TreeNode; sx: SxProps<Theme> }> = ({ node, sx }) => {
    if (node.kind === 'plannedHoles') return <FolderSpecial sx={sx} />;
    if (node.kind === 'liveDrilling') return <Construction sx={sx} />;
    return <Timeline sx={{ ...(sx as object), color: node.color }} />;
};

const button = { textTransform: 'none', justifyContent: 'flex-start' } as const;
const Line: React.FC<{ children: React.ReactNode }> = ({ children }) => <Typography variant="body2" sx={{ my: 0.25 }}>{children}</Typography>;
const Small: React.FC<{ children: React.ReactNode }> = ({ children }) => <Typography variant="caption" color="text.secondary" component="div" sx={{ my: 0.5 }}>{children}</Typography>;

const openTrackingPage = () => useAppStore.getState().setCurrentView('drill-tracking');

const GroupEditor: React.FC = () => {
    const count = useDrillTrackingStore(s => s.programs.length);
    const [importing, setImporting] = useState(false);
    return (
        <Box>
            <Typography variant="subtitle2">Planned holes</Typography>
            <Small>
                Planned drilling programs of the project. Make one in the drillhole planner ("Save as program"), or import one from a collar file and a
                survey file. Programs are drawn in every view (each view's eye shows or hides them) and drilled holes are tracked against one.
            </Small>
            <Line>{count ? `${count} program${count === 1 ? '' : 's'}` : 'No programs yet.'}</Line>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 1 }}>
                <Button size="small" variant="outlined" startIcon={<UploadFile fontSize="small" />} sx={button} onClick={() => setImporting(true)}>Import a program from files…</Button>
                <Button size="small" variant="outlined" startIcon={<TrackChanges fontSize="small" />} sx={button} onClick={openTrackingPage}>Open Drill tracking</Button>
            </Box>
            <ProgramImportDialog open={importing} onClose={() => setImporting(false)} />
        </Box>
    );
};

const ProgramEditor: React.FC<{ id: string }> = ({ id }) => {
    const program = useDrillTrackingStore(s => s.programs.find(p => p.id === id) ?? null);
    const editing = useDrillTrackingStore(s => s.editingId === id);
    const tracked = useDrillTrackingStore(s => s.tracking.programId === id);
    const tracking = useTracking();
    const [open, openDialog] = useOpenProgram();
    const [name, setName] = useState(program?.name ?? '');
    const [deleting, setDeleting] = useState(false);
    useEffect(() => setName(program?.name ?? ''), [program?.name]);
    if (!program) return <Small>This program is no longer in the project.</Small>;
    const store = useDrillTrackingStore.getState;
    const states = tracked ? tracking.planned : [];
    const count = (s: string) => states.filter(p => p.state === s).length;
    const broken = program.holes.filter(h => !h.solved).map(h => h.input.name);
    return (
        <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <input type="color" aria-label="Program colour" value={program.color} onChange={e => store().setProgramColor(id, e.target.value)}
                    style={{ width: 26, height: 22, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }} />
                <TextField size="small" variant="standard" value={name} fullWidth inputProps={{ 'aria-label': 'Program name' }}
                    onChange={e => setName(e.target.value)} onBlur={() => { if (name.trim() && name !== program.name) store().renameProgram(id, name); else setName(program.name); }}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
            </Box>
            <Small>Planned program, {program.source === 'planner' ? 'made in the drillhole planner' : 'imported from files'}; last changed {localTime(program.changed)}.</Small>
            <Line>{program.holes.length} planned hole{program.holes.length === 1 ? '' : 's'}{editing ? ' (open in the planner)' : ''}</Line>
            {broken.length > 0 && <Small>Could not be worked out when last saved: {broken.join(', ')}.</Small>}
            {tracked && states.length > 0 && <Line>{count('drilling')} being drilled, {count('drilled')} drilled, {count('not drilled')} not drilled yet</Line>}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 1 }}>
                <Button size="small" variant="outlined" startIcon={<Edit fontSize="small" />} sx={button} disabled={editing} onClick={() => open(id)}>
                    {editing ? 'Open in the drillhole planner' : 'Edit in the drillhole planner'}
                </Button>
                <FormControlLabel sx={{ ml: 0 }} control={<Switch size="small" checked={tracked} onChange={e => store().setTracking({ programId: e.target.checked ? id : null })} />}
                    label={<Typography variant="body2">Track drilled holes against this program</Typography>} />
                <Button size="small" variant="outlined" startIcon={<TrackChanges fontSize="small" />} sx={button} onClick={openTrackingPage}>Open Drill tracking</Button>
                <Divider sx={{ my: 0.5 }} />
                <Button size="small" color="error" startIcon={<DeleteOutline fontSize="small" />} sx={button} onClick={() => setDeleting(true)}>Delete the program</Button>
            </Box>
            {openDialog}
            <ConfirmDialog open={deleting} title="Delete the program?" confirm="Delete"
                text={`"${program.name}" and its ${program.holes.length} planned holes go from the project${editing ? ' (the planner keeps them, not saved)' : ''}. Links made by hand to its holes are dropped.`}
                onConfirm={() => {
                    if (editing) store().setEditing(null);
                    const prefix = `${id}/`;
                    const manual = Object.entries(store().tracking.manualLinks).filter(([, k]) => !(k ?? '').startsWith(prefix));
                    store().setTracking({ manualLinks: Object.fromEntries(manual) });
                    store().removeProgram(id);
                }}
                onClose={() => setDeleting(false)} />
        </Box>
    );
};

const LiveEditor: React.FC = () => {
    const live = useDrillTrackingStore(s => s.live);
    const tracking = useTracking();
    const [reading, setReading] = useState(false);
    return (
        <Box>
            <Typography variant="subtitle2">Drilled holes (Acquire)</Typography>
            {live ? <>
                <Small>Read {localTime(live.source.readAt)} from {sourceText(live.source)}.</Small>
                <Line>{live.collars.length.toLocaleString()} holes, {live.surveys.length.toLocaleString()} survey stations</Line>
                <Line>{tracking.reports.length} being drilled{tracking.program ? `, tracked against "${tracking.program.name}"` : ' (no program chosen to track against)'}</Line>
                {tracking.reports.some(r => r.forecast?.flagged) && (
                    <Typography variant="body2" color="error" sx={{ my: 0.25 }}>
                        On track to miss the target by more than {tracking.reports.find(r => r.forecast)?.forecast?.limit} m: {tracking.reports.filter(r => r.forecast?.flagged).map(r => r.hole).join(', ')}
                    </Typography>
                )}
                {tracking.activeUnlinked.length > 0 && <Line>Not linked to a planned hole: {tracking.activeUnlinked.map(l => l.hole).join(', ')}</Line>}
                {live.problems.length > 0 && <Small>{live.problems.slice(0, 8).join(' ')}{live.problems.length > 8 ? ` (and ${live.problems.length - 8} more)` : ''}</Small>}
            </> : <Small>Nothing read yet.</Small>}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 1 }}>
                <Button size="small" variant="outlined" startIcon={<UploadFile fontSize="small" />} sx={button} onClick={() => setReading(true)}>Read drilled holes…</Button>
                <Button size="small" variant="outlined" startIcon={<TrackChanges fontSize="small" />} sx={button} onClick={openTrackingPage}>Open Drill tracking</Button>
            </Box>
            <LiveImportDialog open={reading} onClose={() => setReading(false)} />
        </Box>
    );
};

export const TrackingEditor: React.FC<{ node: TreeNode }> = ({ node }) => {
    if (node.kind === 'plannedHoles') return <GroupEditor />;
    if (node.kind === 'liveDrilling') return <LiveEditor />;
    const id = parseKey(node.key)?.id;
    return id ? <ProgramEditor id={id} /> : null;
};
