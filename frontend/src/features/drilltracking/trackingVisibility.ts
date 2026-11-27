/**
 * Showing and hiding drill tracking's objects in a view (the planned
 * programs, the Planned holes group, the drilled holes from Acquire). A view
 * keeps those it hides in a setting of its own (`hiddenTracking`), apart
 * from the model's hidden list, which keeps only the scene's objects.
 * Outside any view nothing is hidden.
 */
import { keys } from '../model/objectKeys';
import { useDrillTrackingStore } from '../../store/drillTrackingStore';

export const TRACKING_SETTING = 'hiddenTracking';

export const isTrackingKey = (k: string) => k === keys.plannedHoles || k === keys.liveDrilling || k.startsWith('program:');

/** The tracking keys a view hides, as saved */
export const trackingHiddenOf = (saved: unknown): string[] => (Array.isArray(saved) ? saved.filter((k): k is string => typeof k === 'string' && isTrackingKey(k)) : []);

/** A view's list with these tracking keys shown or hidden (programs that are gone are dropped) */
export function trackingShownChange(saved: unknown, objectKeys: readonly string[], shown: boolean): string[] {
    const next = new Set(trackingHiddenOf(saved));
    for (const k of objectKeys.filter(isTrackingKey)) {
        if (shown) next.delete(k); else next.add(k);
    }
    const programs = new Set(useDrillTrackingStore.getState().programs.map(p => keys.program(p.id)));
    return [...next].filter(k => !k.startsWith('program:') || programs.has(k)).sort();
}

/** "Show only these": every tracking key not among them is hidden */
export function trackingShowOnly(objectKeys: readonly string[]): string[] {
    const keep = new Set(objectKeys);
    const all = [keys.plannedHoles, keys.liveDrilling, ...useDrillTrackingStore.getState().programs.map(p => keys.program(p.id))];
    return all.filter(k => !keep.has(k)).sort();
}

/** Is a program hidden in a view (its own eye, or the Planned holes group's) */
export const programHidden = (hidden: ReadonlySet<string>, programId: string) => hidden.has(keys.plannedHoles) || hidden.has(keys.program(programId));
