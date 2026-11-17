/**
 * Dataset columns a surface fills in: which side of it each sample is on, and
 * how far from it.
 *
 * Making the columns is the user's action (one undo step, with the surface's
 * record of them). After that they belong to the surface: whenever its shape
 * changes they are redone, once the editing has stopped rather than on every
 * click. That redo follows from the edit, so it has no undo step of its own.
 */
import { useAppStore } from '../../store/appStore';
import { withoutHistory } from '../../store/historyStore';
import { useModelStore } from '../../store/modelStore';
import { findIntercepts, interceptChoice } from './intercepts';
import { shellSamples } from './logging';
import { useModelCache, type SurfaceResult } from './modelCache';
import { distanceToSurface, sideOfSurface } from './outputs';
import { sideNames } from './plane';
import { keyMark } from './surfaceJobs';
import type { Plane, SurfaceObject } from './types';

export type SurfaceColumnKind = 'side' | 'distance';

/** The names of a surface's positive and negative side: the user's, or from the way it faces. */
export function surfaceSides(surface: SurfaceObject, trend: Plane | null): [string, string] {
    if (!surface.sides && (surface.rule.kind === 'body' || surface.rule.kind === 'shell')) return ['Inside', 'Outside'];
    return surface.sides ?? sideNames(trend?.normal ?? surface.refDirection ?? [0, 0, 1]);
}

export type WriteResult =
    | { ok: true; side: string | null; distance: string | null }
    /** not-ready = the surface has no finished mesh; no-coordinates = the scene's X/Y/Z columns are missing */
    | { ok: false; reason: 'no-surface' | 'not-ready' | 'no-coordinates' };

function sameValues(a: ArrayLike<unknown> | undefined, b: unknown[]): boolean {
    if (!a || a.length !== b.length) return false;
    for (let i = 0; i < b.length; i++) {
        if (a[i] !== b[i] && !(a[i] == null && b[i] == null) && !(Number.isNaN(a[i]) && b[i] == null)) return false;
    }
    return true;
}

/** Work out and write the given columns of a surface (both: its record of them is updated too). */
function write(surface: SurfaceObject, result: SurfaceResult, kinds: SurfaceColumnKind[]): WriteResult {
    const app = useAppStore.getState();
    const { coords } = useModelStore.getState().scene;
    const x = coords && app.getNumericColumn(coords.x), y = coords && app.getNumericColumn(coords.y), z = coords && app.getNumericColumn(coords.z);
    if (!x || !y || !z) return { ok: false, reason: 'no-coordinates' };
    if (result.state !== 'ready' || !result.field || !result.part) return { ok: false, reason: 'not-ready' };

    const names = { side: surface.columns.side, distance: surface.columns.distance };
    const created = new Date().toISOString();
    const put = (kind: SurfaceColumnKind, values: unknown[], colType: string, role: string, description: string) => {
        const own = names[kind];
        const exists = !!own && app.columns.some(c => c.name === own);
        // Unchanged values are left alone (no needless redraw of every plot)
        if (exists && sameValues(useAppStore.getState().getRawColumn(own!), values)) return;
        names[kind] = useAppStore.getState().addColumn(
            exists ? own! : `${surface.name} ${kind}`, values, colType, role, null, undefined,
            { kind: 'other', description, params: { surfaceId: surface.id, output: kind }, created },
            // Its own column is replaced; a first write never takes over someone else's column
            exists ? 'replace' : 'unique',
        ) ?? names[kind];
    };

    if (kinds.includes('side')) {
        const [positive, negative] = surfaceSides(surface, result.trend);
        const side = sideOfSurface(result.field, x, y, z);
        put('side', Array.from(side, s => (s > 0 ? positive : s < 0 ? negative : '')), 'categorical', 'Classification',
            `Side of the surface "${surface.name}"`);
    }
    if (kinds.includes('distance')) {
        const d = distanceToSurface(result.part, result.field, x, y, z);
        put('distance', Array.from(d, v => (Number.isNaN(v) ? null : Math.round(v * 100) / 100)), 'numeric', 'Calculated',
            `Distance (m) to the surface "${surface.name}", negative on its ${surfaceSides(surface, result.trend)[1]}`);
    }
    const columns = { ...names, writtenFor: keyMark(result.key) };
    if (columns.side !== surface.columns.side || columns.distance !== surface.columns.distance || columns.writtenFor !== surface.columns.writtenFor) {
        useModelStore.getState().updateSurface(surface.id, { columns });
    }
    return { ok: true, side: columns.side, distance: columns.distance };
}

/**
 * A column that says which samples are in an intercept, for a shell built
 * from intercepts ("Intercept", or nothing). One undo step. Made when asked
 * for, and made again to bring it up to date: it is the drilling's, not the
 * surface's, so it is not redone when the shell's shape changes. Null when
 * the shell is not built from intercepts or its columns have gone.
 */
export function writeInterceptColumn(surfaceId: string): string | null {
    const { scene } = useModelStore.getState();
    const surface = scene.surfaces.find(s => s.id === surfaceId);
    if (!surface || surface.rule.kind !== 'shell' || surface.rule.method !== 'intercepts') return null;
    const samples = shellSamples(scene.coords, surface.rule.column);
    const found = samples ? findIntercepts(samples, interceptChoice(surface.rule)) : null;
    if (!found) return null;
    const app = useAppStore.getState();
    const name = `${surface.name} intercept`;
    return app.addColumn(
        name, Array.from(found.flags, f => (f === 1 ? 'Intercept' : '')), 'categorical', 'Classification', null, undefined,
        { kind: 'other', description: `In an intercept of "${surface.name}"`, params: { surfaceId: surface.id, output: 'intercept' }, created: new Date().toISOString() },
        app.columns.some(c => c.name === name) ? 'replace' : 'unique',
    ) ?? name;
}

/** Make (or remake) columns for a surface. One undo step. */
export function writeSurfaceColumns(surfaceId: string, kinds: SurfaceColumnKind[]): WriteResult {
    const surface = useModelStore.getState().scene.surfaces.find(s => s.id === surfaceId);
    const result = useModelCache.getState().byId[surfaceId];
    if (!surface) return { ok: false, reason: 'no-surface' };
    if (!result) return { ok: false, reason: 'not-ready' };
    return write(surface, result, kinds);
}

/**
 * Redo the columns of every surface whose shape has changed since they were
 * written. Surfaces being edited, or still being worked out, wait.
 */
export function refreshSurfaceColumns(): void {
    const { scene, editingId } = useModelStore.getState();
    const cache = useModelCache.getState().byId;
    const taken = new Set(useAppStore.getState().columns.map(c => c.name));
    for (const surface of scene.surfaces) {
        const c = surface.columns;
        if (!c.side && !c.distance) continue;
        if (surface.id === editingId) continue;
        // A column the user has deleted is no longer the surface's to fill in
        const kinds: SurfaceColumnKind[] = [];
        if (c.side && taken.has(c.side)) kinds.push('side');
        if (c.distance && taken.has(c.distance)) kinds.push('distance');
        const dropped = (c.side && !kinds.includes('side')) || (c.distance && !kinds.includes('distance'));
        if (dropped) {
            withoutHistory(() => useModelStore.getState().updateSurface(surface.id, {
                columns: { ...c, side: kinds.includes('side') ? c.side : null, distance: kinds.includes('distance') ? c.distance : null },
            }));
        }
        const result = cache[surface.id];
        if (kinds.length === 0 || !result || result.state !== 'ready' || keyMark(result.key) === c.writtenFor) continue;
        const now = useModelStore.getState().scene.surfaces.find(s => s.id === surface.id);
        if (now) withoutHistory(() => { write(now, result, kinds); });
    }
}

// A refresh changes the stores it listens to: one at a time
let running = false;
const run = () => {
    if (running) return;
    running = true;
    try {
        refreshSurfaceColumns();
    } finally {
        running = false;
    }
};
useModelCache.subscribe(run);
useModelStore.subscribe((state, prev) => {
    if (state.editingId !== prev.editingId) run();
});
