/**
 * Drill tracking's rows in the project tree, under Drillholes: the
 * drilled holes from Acquire (when read), and a "Planned holes" group with a
 * row for each planned program. Each has an eye (shown or hidden per view).
 */
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { keys } from '../model/objectKeys';
import type { TreeNode } from '../model/projectTree';
import { useDrillTrackingStore } from '../../store/drillTrackingStore';
import { localTime, type LiveDrillData } from '../../utils/drillTrackImport';
import type { PlannedProgram } from '../../utils/plannedPrograms';

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export interface TrackingTreeState {
    programs: readonly PlannedProgram[];
    live: LiveDrillData | null;
    /** The program the planner has open */
    editingId: string | null;
    /** The program drilled holes are tracked against */
    trackedId: string | null;
}

/** What the tree shows of drill tracking (changes only when that does) */
export function useTrackingTreeState(): TrackingTreeState {
    const { programs, live, editingId, trackedId } = useDrillTrackingStore(useShallow(s => ({ programs: s.programs, live: s.live, editingId: s.editingId, trackedId: s.tracking.programId })));
    return useMemo(() => ({ programs, live, editingId, trackedId }), [programs, live, editingId, trackedId]);
}

/** The Drillholes group's rows with drill tracking's added (the tree is not changed) */
export function withDrillTracking(roots: TreeNode[], t: TrackingTreeState): TreeNode[] {
    const rootKey = keys.root('drillholes');
    if (!roots.some(r => r.key === rootKey)) return roots;
    const added: TreeNode[] = [];
    if (t.live) {
        added.push({
            key: keys.liveDrilling, kind: 'liveDrilling', name: 'Drilled holes (Acquire)', visKey: keys.liveDrilling,
            detail: `${plural(t.live.collars.length, 'hole')}, read ${localTime(t.live.source.readAt)}`, children: [],
        });
    }
    added.push({
        key: keys.plannedHoles, kind: 'plannedHoles', name: 'Planned holes', detail: t.programs.length ? plural(t.programs.length, 'program') : 'none yet',
        visKey: t.programs.length ? keys.plannedHoles : undefined,
        children: t.programs.map(p => ({
            key: keys.program(p.id), kind: 'program' as const, name: p.name, color: p.color, visKey: keys.program(p.id),
            detail: [plural(p.holes.length, 'hole'), p.id === t.editingId ? 'open in the planner' : null, p.id === t.trackedId ? 'tracked' : null].filter(Boolean).join(', '),
            status: p.holes.some(h => !h.solved) ? 'problem' as const : null,
            statusText: p.holes.some(h => !h.solved) ? `${plural(p.holes.filter(h => !h.solved).length, 'hole')} could not be worked out` : undefined,
            children: [],
        })),
    });
    return roots.map(r => (r.key === rootKey ? { ...r, children: [...r.children, ...added] } : r));
}
