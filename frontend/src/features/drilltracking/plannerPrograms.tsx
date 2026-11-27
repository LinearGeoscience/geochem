/**
 * The drillhole planner and planned programs.
 *
 * - "Save as program" keeps the planner's holes as a named program of the
 *   project; the planner then has that program open.
 * - While the planner has a program open, every change to its holes is saved
 *   to the program (with the holes as worked out, which the views draw and
 *   drill tracking measures against).
 * - "Edit" on a program opens the planner on it, in a view of the Modelling
 *   page. Holes in the planner that are not a program's and have not been
 *   exported are only replaced once the user says so.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Tooltip, Typography } from '@mui/material';
import { FolderSpecial, SaveAlt } from '@mui/icons-material';
import { useAppStore } from '../../store/appStore';
import { activeModelView, useModellingStore } from '../../store/modellingStore';
import { useDrillTrackingStore } from '../../store/drillTrackingStore';
import { notify } from '../../store/notificationStore';
import { solvedFromResult, type ProgramHole } from '../../utils/plannedPrograms';
import { usePlanStore, type PlanHole } from '../plots/viewer3d/planner/planStore';
import type { ComputedHole, Planner } from '../plots/viewer3d/planner/usePlans';
import { stopKeys } from '../plots/viewer3d/planner/fields';

/**
 * The planner's holes as a program keeps them. A hole whose inputs have not
 * changed keeps the path the program has for it (so opening a program in the
 * planner never changes it: an imported hole keeps the path its surveys
 * gave, not the planner's constant lift and drift), unless it is a wedge off
 * a planned hole that has changed. A wedge still being worked out keeps what
 * it had.
 */
export function programHolesOf(holes: readonly ComputedHole[], before: readonly ProgramHole[] = []): ProgramHole[] {
    const had = new Map(before.map(h => [h.id, h]));
    const key = (h: { input: unknown; topo: unknown }) => JSON.stringify([h.input, h.topo]);
    const changed = new Set(holes.filter(({ hole }) => { const b = had.get(hole.id); return !b || key(b) !== key(hole); }).map(({ hole }) => hole.id));
    const parentChanged = (h: ComputedHole) => h.hole.input.parent?.kind === 'planned' && changed.has(h.hole.input.parent.id);
    return holes.map(h => {
        const { hole, result, parentName, pending } = h;
        const kept = had.get(hole.id)?.solved ?? null;
        const keep = pending || (!changed.has(hole.id) && !parentChanged(h) && kept !== null);
        return {
            id: hole.id, input: hole.input, topo: hole.topo, style: hole.style, visible: hole.visible,
            ...(hole.beforeWedge ? { beforeWedge: hole.beforeWedge } : {}),
            solved: keep ? kept : solvedFromResult(result, parentName),
        };
    });
}

/** Saves the planner's holes to the program it has open, when they change */
export function useProgramSync(planner: Planner): void {
    const editingId = useDrillTrackingStore(s => s.editingId);
    const last = useRef('');
    useEffect(() => {
        if (!editingId) { last.current = ''; return; }
        const t = window.setTimeout(() => {
            const store = useDrillTrackingStore.getState();
            const program = store.programs.find(p => p.id === editingId);
            if (!program) { store.setEditing(null); return; }
            // A planner that works nothing out (no elevation column in the view) lists no holes: that is not an edit
            if (!planner.enabled || planner.holes.length !== usePlanStore.getState().holes.length) return;
            const holes = programHolesOf(planner.holes, program.holes);
            const text = JSON.stringify(holes);
            if (text === last.current) return;
            last.current = text;
            // Only an edit stamps the program changed (opening it changes nothing)
            if (text === JSON.stringify(program.holes)) return;
            store.setProgramHoles(editingId, holes);
            // Saved with the project: the planner need not warn about an export
            usePlanStore.getState().markExported();
        }, 300);
        return () => window.clearTimeout(t);
    }, [editingId, planner.holes]);
}

const planHoleOf = (h: ProgramHole): PlanHole => ({
    id: h.id, input: h.input, topo: h.topo, style: h.style, visible: h.visible, ...(h.beforeWedge ? { beforeWedge: h.beforeWedge } : {}),
});

/** Whether opening a program would replace planner holes that are not a program's and were not exported */
export function plannerHasLooseHoles(): boolean {
    const plan = usePlanStore.getState();
    return !useDrillTrackingStore.getState().editingId && plan.holes.length > 0 && plan.version !== plan.exportedVersion;
}

/** Opens the planner on a program, in the Modelling page's active 3D view (one is made when there is none) */
export function openProgramInPlanner(id: string): void {
    const program = useDrillTrackingStore.getState().programs.find(p => p.id === id);
    if (!program) return;
    const plan = usePlanStore.getState();
    const version = plan.version + 1;
    usePlanStore.setState({ holes: program.holes.map(planHoleOf), selectedId: program.holes[0]?.id ?? null, tool: null, version, exportedVersion: version });
    useDrillTrackingStore.getState().setEditing(id);
    const app = useAppStore.getState();
    const views = app.modelViews.filter(v => v.settings?.viewKind !== 'section');
    const view = activeModelView(views, useModellingStore.getState().activeViewId) ?? views[0] ?? null;
    const viewId = view?.id ?? app.addModelView('3d');
    if (viewId) {
        app.updatePlotSettings(viewId, { plannerPanel3d: true });
        useModellingStore.getState().setActiveView(viewId);
    }
    app.setCurrentView('modelling');
    notify(`The drillhole planner has "${program.name}" open: changes are saved to it.`, 'info');
}

/** "Edit in planner", asking first when the planner holds holes of its own */
export function useOpenProgram(): [(id: string) => void, React.ReactNode] {
    const [asking, setAsking] = useState<string | null>(null);
    const open = (id: string) => (plannerHasLooseHoles() ? setAsking(id) : openProgramInPlanner(id));
    const dialog = (
        <Dialog open={!!asking} onClose={() => setAsking(null)} maxWidth="xs" fullWidth {...stopKeys}>
            <DialogTitle>Replace the planner's holes?</DialogTitle>
            <DialogContent>
                <Typography variant="body2">
                    The drillhole planner has holes that are not in a program and have not been exported. Opening the program replaces them.
                    To keep them, close this and use "Save as program" or Export in the planner first.
                </Typography>
            </DialogContent>
            <DialogActions>
                <Button onClick={() => setAsking(null)}>Cancel</Button>
                <Button variant="contained" color="error" onClick={() => { const id = asking; setAsking(null); if (id) openProgramInPlanner(id); }}>Replace them</Button>
            </DialogActions>
        </Dialog>
    );
    return [open, dialog];
}

/** At the top of the planner panel: the program it has open, or "Save as program" */
export const ProgramBar: React.FC<{ planner: Planner }> = ({ planner }) => {
    useProgramSync(planner);
    const editingId = useDrillTrackingStore(s => s.editingId);
    const program = useDrillTrackingStore(s => s.programs.find(p => p.id === s.editingId) ?? null);
    const [naming, setNaming] = useState(false);
    const [name, setName] = useState('');
    const save = () => {
        const store = useDrillTrackingStore.getState();
        const id = store.addProgram(name || 'Program', 'planner', programHolesOf(planner.holes));
        store.setEditing(id);
        usePlanStore.getState().markExported();
        setNaming(false);
        notify(`Saved ${planner.holes.length} hole${planner.holes.length === 1 ? '' : 's'} as program "${useDrillTrackingStore.getState().programs.find(p => p.id === id)?.name}" (saved with the project). Changes in the planner are saved to it.`, 'success');
    };
    const close = () => {
        const v = usePlanStore.getState().version + 1;
        usePlanStore.setState({ holes: [], selectedId: null, tool: null, version: v, exportedVersion: v });
        useDrillTrackingStore.getState().setEditing(null);
    };
    return (
        <Box sx={{ px: 1, pb: 0.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {editingId && program ? <>
                <FolderSpecial sx={{ fontSize: 16, color: program.color }} />
                <Typography variant="caption" sx={{ flex: 1 }} noWrap>Program <b>{program.name}</b>: changes are saved to it</Typography>
                <Tooltip title="Close the program (it stays in the project, under Drillholes › Planned holes); the planner is emptied">
                    <Button size="small" sx={{ textTransform: 'none', py: 0 }} onClick={close}>Close program</Button>
                </Tooltip>
            </> : <>
                <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>Holes here are not saved with the project</Typography>
                <Tooltip title="Keep these holes as a named program of the project (Drillholes › Planned holes): shown in every view, and tracked against while drilled">
                    <span>
                        <Button size="small" startIcon={<SaveAlt sx={{ fontSize: 16 }} />} disabled={planner.holes.length === 0} sx={{ textTransform: 'none', py: 0 }}
                            onClick={() => { setName(''); setNaming(true); }}>Save as program</Button>
                    </span>
                </Tooltip>
            </>}
            <Dialog open={naming} onClose={() => setNaming(false)} maxWidth="xs" fullWidth {...stopKeys}>
                <DialogTitle>Save as program</DialogTitle>
                <DialogContent>
                    <TextField autoFocus fullWidth size="small" margin="dense" label="Program name" value={name} placeholder="e.g. Stage 3 resource infill"
                        onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); }} />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setNaming(false)}>Cancel</Button>
                    <Button variant="contained" onClick={save}>Save</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};
