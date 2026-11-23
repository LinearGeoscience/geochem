/**
 * Dataset columns a surface fills in: which side of it each sample is on, how
 * far from it, and (a vein) how thick it is there.
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
import { shareAt } from './proportion';
import { sideNames } from './plane';
import { keyMark } from './surfaceJobs';
import type { Plane, SurfaceObject } from './types';
import { veinThickness } from './vein';

export type SurfaceColumnKind = 'side' | 'distance' | 'thickness';

const KINDS: SurfaceColumnKind[] = ['side', 'distance', 'thickness'];

/** The names of a surface's positive and negative side: the user's, or from the way it faces. */
export function surfaceSides(surface: SurfaceObject, trend: Plane | null): [string, string] {
    if (!surface.sides && (surface.rule.kind === 'body' || surface.rule.kind === 'shell')) return ['Inside', 'Outside'];
    return surface.sides ?? sideNames(trend?.normal ?? surface.refDirection ?? [0, 0, 1]);
}

export type WriteResult =
    | { ok: true; side: string | null; distance: string | null; thickness?: string }
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

    const names = { side: surface.columns.side, distance: surface.columns.distance, thickness: surface.columns.thickness ?? null };
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
    if (kinds.includes('thickness') && result.field.walls) {
        const flat = new Float64Array(x.length * 3);
        for (let i = 0; i < x.length; i++) { flat[i * 3] = x[i]; flat[i * 3 + 1] = y[i]; flat[i * 3 + 2] = z[i]; }
        // (A sample with no place has no thickness either)
        const t = veinThickness(result.field, flat);
        put('thickness', Array.from(t, v => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null)), 'numeric', 'Calculated',
            `Thickness (m) of "${surface.name}" where each sample is: how far apart its walls are there, square to it. Blank where it is not there`);
    }
    const { thickness, ...rest } = names;
    const columns = { ...rest, ...(thickness ? { thickness } : {}), writtenFor: keyMark(result.key) };
    if (KINDS.some(k => (columns[k] ?? null) !== (surface.columns[k] ?? null)) || columns.writtenFor !== surface.columns.writtenFor) {
        useModelStore.getState().updateSurface(surface.id, { columns });
    }
    return { ok: true, side: columns.side, distance: columns.distance, ...(thickness ? { thickness } : {}) };
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

/**
 * A column of the share of its units at every sample, for a proportion's
 * shell: a number from 0 to 1, read from its fit (its field plus the share
 * it is drawn at). Samples with no place are blank. One undo step. Made
 * when asked for, and made again to bring it up to date. Null when it is
 * not a proportion, is not fitted, or the coordinate columns have gone.
 */
export function writeShareColumn(surfaceId: string): string | null {
    const { scene } = useModelStore.getState();
    const surface = scene.surfaces.find(s => s.id === surfaceId);
    const result = useModelCache.getState().byId[surfaceId];
    if (!surface || surface.rule.kind !== 'shell' || !surface.rule.of || result?.state !== 'ready' || !result.field) return null;
    const app = useAppStore.getState();
    const coords = scene.coords;
    const x = coords && app.getNumericColumn(coords.x), y = coords && app.getNumericColumn(coords.y), z = coords && app.getNumericColumn(coords.z);
    if (!x || !y || !z) return null;
    const flat = new Float64Array(x.length * 3), placed: number[] = [];
    for (let i = 0; i < x.length; i++) {
        if (!Number.isFinite(x[i]) || !Number.isFinite(y[i]) || !Number.isFinite(z[i])) continue;
        flat[placed.length * 3] = x[i]; flat[placed.length * 3 + 1] = y[i]; flat[placed.length * 3 + 2] = z[i];
        placed.push(i);
    }
    const said = shareAt(result.field, flat.subarray(0, placed.length * 3), surface.rule.cutoff);
    const values: (number | null)[] = new Array(x.length).fill(null);
    placed.forEach((i, k) => { values[i] = Math.round(said[k] * 1000) / 1000; });
    const name = surface.rule.column;
    return app.addColumn(
        name, values, 'numeric', 'Calculated', null, undefined,
        { kind: 'other', description: `The share of the ground that is ${surface.rule.of.inside.join(', ')} where each sample is (0 to 1), from "${surface.name}"`, params: { surfaceId: surface.id, output: 'share' }, created: new Date().toISOString() },
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
        if (!KINDS.some(k => c[k])) continue;
        if (surface.id === editingId) continue;
        // A column the user has deleted is no longer the surface's to fill in
        const kinds = KINDS.filter(k => c[k] && taken.has(c[k]!));
        if (KINDS.some(k => c[k] && !kinds.includes(k))) {
            const { thickness, ...rest } = c;
            withoutHistory(() => useModelStore.getState().updateSurface(surface.id, {
                columns: { ...rest, side: kinds.includes('side') ? c.side : null, distance: kinds.includes('distance') ? c.distance : null, ...(thickness && kinds.includes('thickness') ? { thickness } : {}) },
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
