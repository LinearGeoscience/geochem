/**
 * The places and links put on a surface by hand that are picked (in the 3D view or in their list), and the one
 * under the cursor. Only for this session: not saved, not undone, let go of when another surface is opened or a
 * project is loaded.
 */
import { create } from 'zustand';
import { useModelStore } from '../../store/modelStore';
import type { SelectMode } from './editSession';

interface ControlPicksState {
    /** The surface the picks are on (null: none) */
    surface: string | null;
    ids: readonly string[];
    /** The mark under the cursor in the view or the list (null: none) */
    hot: string | null;
    /** The mark picked last, from which Shift picks a run in the list */
    anchor: string | null;
    pick: (surface: string, ids: readonly string[], mode?: SelectMode) => void;
    setHot: (id: string | null) => void;
    clear: () => void;
}

export const useControlPicks = create<ControlPicksState>()((set, get) => ({
    surface: null,
    ids: [],
    hot: null,
    anchor: null,
    pick: (surface, ids, mode = 'replace') => {
        const now = get();
        const base = mode === 'replace' || now.surface !== surface ? [] : now.ids;
        const has = new Set(base);
        let next: string[];
        if (mode === 'toggle' && ids.length > 0 && ids.every(id => has.has(id))) {
            const drop = new Set(ids);
            next = base.filter(id => !drop.has(id));
        } else {
            next = [...base, ...ids.filter((id, i) => !has.has(id) && ids.indexOf(id) === i)];
        }
        set({ surface: next.length > 0 ? surface : null, ids: next, anchor: ids.length > 0 ? ids[ids.length - 1] : now.anchor });
    },
    setHot: id => { if (get().hot !== id) set({ hot: id }); },
    clear: () => { if (get().ids.length > 0 || get().surface !== null) set({ surface: null, ids: [], anchor: null }); },
}));

/** The ids picked on this surface that it still has */
export function pickedOn(surface: string, marks: readonly { id: string }[] | undefined, picks: { surface: string | null; ids: readonly string[] }): Set<string> {
    if (picks.surface !== surface || picks.ids.length === 0) return new Set();
    const have = new Set((marks ?? []).map(m => m.id));
    return new Set(picks.ids.filter(id => have.has(id)));
}

// Another surface opened, or another project: what was picked is let go
useModelStore.subscribe((s, prev) => {
    if (s.editingId !== prev.editingId || s.sceneLoads !== prev.sceneLoads) {
        useControlPicks.getState().clear();
        useControlPicks.getState().setHot(null);
    }
});
