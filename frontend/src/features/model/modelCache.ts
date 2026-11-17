/**
 * The worked-out form of each surface in the scene: its mesh and fitted
 * field. Not saved (rebuilt from the scene on load) and not part of undo.
 *
 * `syncSurfaceFits` keeps it in step with the scene: whenever a surface's
 * inputs change it is refitted in the Web Worker. A surface that fits quickly
 * is redone at once, at full detail. One that takes longer waits for a pause
 * in the editing, then shows a coarse draft before the full mesh.
 */
import { create } from 'zustand';
import { useAppStore } from '../../store/appStore';
import { useModelStore } from '../../store/modelStore';
import { makePart, type WireframePart } from '../plots/viewer3d/wireframeParsers';
import { findContacts, sidesRule, type ContactInputs } from './contacts';
import { holeLog, shellSamples } from './logging';
import { buildPotential, type Potential } from './frame';
import type { Stretch } from './rbf';
import { ruleInputs } from './intercepts';
import type { ShellInputs, ShellLayers } from './shell';
import { DEFAULT_STRENGTH, structureStretch } from './structure';
import { buildTrendField, planeNodes, type TrendField } from './trendField';
import type { GuideSamples } from './guides';
import type { FittedField } from './rbf';
import { requestFit } from './surfaceClient';
import { buildJob, fitKey, surfaceGuides, type FitQuality, type FitSummary } from './surfaceJobs';
import type { Box3, Plane, SceneCoords, SurfaceObject, SurfaceRule } from './types';

export interface SurfaceResult {
    /** The inputs (fitKey) this entry is for; a fit for older inputs is dropped when it arrives */
    key: string;
    /**
     * fitting = being worked out (any mesh shown is the previous one or a draft);
     * ready = up to date; empty = not enough points yet; failed = could not be solved
     */
    state: 'fitting' | 'ready' | 'empty' | 'failed';
    /** The mesh, world coordinates (null until the first fit, and when there is no surface) */
    part: WireframePart | null;
    field: FittedField | null;
    trend: Plane | null;
    /** Per line of the surface: 1 or -1, the side of it that is the surface's positive side */
    lineSigns: Int8Array | null;
    /** line = the points only define a line, so the surface is the plane through it */
    status: 'line' | 'sheet' | 'body' | null;
    stats: FitSummary | null;
    /** How long the last full-detail fit took (ms): decides whether the next one waits for a pause */
    lastMs: number;
}

interface ModelCacheState {
    byId: Record<string, SurfaceResult>;
}

export const useModelCache = create<ModelCacheState>()(() => ({ byId: {} }));

/** Fits quicker than this are redone on every change */
const FAST_MS = 150;
/** Slower ones wait for this long a pause in the editing */
const PAUSE_MS = 600;

const timers = new Map<string, ReturnType<typeof setTimeout>>();

function put(id: string, patch: Partial<SurfaceResult> & { key: string }) {
    useModelCache.setState(s => {
        const prev = s.byId[id];
        const base: SurfaceResult = prev ?? { key: patch.key, state: 'fitting', part: null, field: null, trend: null, lineSigns: null, status: null, stats: null, lastMs: 0 };
        return { byId: { ...s.byId, [id]: { ...base, ...patch } } };
    });
}

// The extent of the dataset in the scene's coordinates, remembered per dataset
let boxFor: { data: unknown; coords: SceneCoords | null; box: Box3 | null } | null = null;

/** World extent of the dataset in the scene's coordinate columns (null without data or columns). */
export function sceneDataBox(): Box3 | null {
    const app = useAppStore.getState();
    const { coords } = useModelStore.getState().scene;
    if (boxFor && boxFor.data === app.columnarData && boxFor.coords === coords) return boxFor.box;
    let box: Box3 | null = null;
    const x = coords && app.getNumericColumn(coords.x), y = coords && app.getNumericColumn(coords.y), z = coords && app.getNumericColumn(coords.z);
    if (x && y && z) {
        const min: Box3['min'] = [Infinity, Infinity, Infinity], max: Box3['max'] = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < x.length; i++) {
            if (!Number.isFinite(x[i]) || !Number.isFinite(y[i]) || !Number.isFinite(z[i])) continue;
            if (x[i] < min[0]) min[0] = x[i];
            if (x[i] > max[0]) max[0] = x[i];
            if (y[i] < min[1]) min[1] = y[i];
            if (y[i] > max[1]) max[1] = y[i];
            if (z[i] < min[2]) min[2] = z[i];
            if (z[i] > max[2]) max[2] = z[i];
        }
        if (max[0] >= min[0]) box = { min, max };
    }
    boxFor = { data: app.columnarData, coords, box };
    return box;
}

// What the logging gives each surface built from it, remembered per dataset and rule
const foundFor = new Map<string, { data: unknown; coords: SceneCoords | null; rule: SurfaceRule; found: ContactInputs | null }>();

/**
 * For a surface built from a logging column: its contacts and the side of
 * every logged interval, from the dataset as it is now. Null for any other
 * surface, and when the columns it needs are not there.
 */
export function contactInputsFor(surface: SurfaceObject): ContactInputs | null {
    const rule = surface.rule;
    if (rule.kind === 'sheet' || rule.kind === 'shell') return null;
    const data = useAppStore.getState().columnarData;
    const { coords } = useModelStore.getState().scene;
    const memo = foundFor.get(surface.id);
    if (memo && memo.data === data && memo.coords === coords && memo.rule === surface.rule) return memo.found;
    const log = holeLog(coords, rule.column);
    const found = log ? findContacts(log, sidesRule(rule)) : null;
    foundFor.set(surface.id, { data, coords, rule: surface.rule, found });
    return found;
}

/**
 * The space a surface is fitted in when it follows the model's structure:
 * stretched across it, about the middle of the data. Null when no structure
 * is set, the surface does not follow it, or it is of a kind that takes its
 * shape from its own points (a sheet, a contact).
 */
export function stretchFor(surface: SurfaceObject): Stretch | null {
    const overall = useModelStore.getState().scene.structure?.overall ?? null;
    if (!overall || surface.params.trend === false || (surface.rule.kind !== 'shell' && surface.rule.kind !== 'body')) return null;
    const box = sceneDataBox();
    return structureStretch(overall, box ? [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2] : [0, 0, 0]);
}

let trendFor: { sets: unknown; overall: unknown; range: number | null; field: TrendField | null } | null = null;

/**
 * The direction of the ground from place to place, as the scene has it now
 * (trendField.ts): from the readings the model follows and, away from them,
 * its one direction. Null with neither. Kept until one of them changes.
 */
export function sceneTrendField(): TrendField | null {
    const structure = useModelStore.getState().scene.structure;
    const sets = structure?.sets, overall = structure?.overall ?? null, range = structure?.range ?? null;
    if (trendFor && trendFor.sets === sets && trendFor.overall === overall && trendFor.range === range) return trendFor.field;
    const field = buildTrendField(sets, overall, range);
    trendFor = { sets, overall, range, field };
    return field;
}

let potentialFor: { field: TrendField | null; potential: Potential | null } | null = null;

/**
 * The height through the layers of the ground that the plane readings the
 * model follows give (frame.ts), as the scene is now. Null without any.
 * Kept until the readings change.
 */
export function scenePotential(): Potential | null {
    const field = sceneTrendField();
    if (potentialFor && potentialFor.field === field) return potentialFor.potential;
    const potential = field && field.planes > 0 ? buildPotential(planeNodes(field), field.range) : null;
    potentialFor = { field, potential };
    return potential;
}

let layersKept: ShellLayers | null = null;

/**
 * For a shell that follows the ground as the model's readings say it lies
 * from place to place: the height through the layers, and how many times
 * further things carry along the ground than across it (as set with the
 * model's one direction, else the usual). Null for any other surface, for a
 * shell that does not follow, and when the model follows no plane readings
 * (a shell then follows the model's one direction: `stretchFor`).
 */
export function layersFor(surface: SurfaceObject): ShellLayers | null {
    if (surface.rule.kind !== 'shell' || surface.params.trend === false) return null;
    const potential = scenePotential();
    if (!potential) return null;
    const overall = useModelStore.getState().scene.structure?.overall ?? null;
    const strength = overall ? overall.strength : DEFAULT_STRENGTH;
    if (!(strength > 1)) return null;
    if (!layersKept || layersKept.potential !== potential || layersKept.strength !== strength) layersKept = { potential, strength };
    return layersKept;
}

const guidesFor = new Map<string, { points: unknown; polylines: unknown; follows: boolean; found: unknown; field: unknown; guides: GuideSamples | null }>();

/**
 * For a sheet or a contact: what the model's direction from place to place
 * says at its own places (guides.ts), as the scene is now. Null for a body
 * or a shell, for a surface that does not follow it, and when the readings
 * say nothing near it.
 */
export function guidesForSurface(surface: SurfaceObject): GuideSamples | null {
    if (surface.rule.kind === 'body' || surface.rule.kind === 'shell') return null;
    const field = sceneTrendField();
    const follows = surface.params.trend !== false;
    if (!follows || !field || field.planes + field.lines === 0) return null;
    const found = contactInputsFor(surface);
    const memo = guidesFor.get(surface.id);
    if (memo && memo.points === surface.points && memo.polylines === surface.polylines && memo.follows === follows && memo.found === found && memo.field === field) return memo.guides;
    const guides = surfaceGuides(surface, found, field);
    guidesFor.set(surface.id, { points: surface.points, polylines: surface.polylines, follows, found, field, guides });
    return guides;
}

const shellFor = new Map<string, { data: unknown; coords: SceneCoords | null; rule: SurfaceRule; stretch: string; layers: ShellLayers | null; inputs: ShellInputs | null }>();

/**
 * For a shell: the places and values it is fitted to, from the dataset as
 * it is now. Null for any other surface, and when its column or the
 * coordinate columns are not there.
 */
export function shellInputsFor(surface: SurfaceObject): ShellInputs | null {
    const rule = surface.rule;
    if (rule.kind !== 'shell') return null;
    const data = useAppStore.getState().columnarData;
    const { coords } = useModelStore.getState().scene;
    const memo = shellFor.get(surface.id);
    const stretch = stretchFor(surface), stretched = JSON.stringify(stretch), layers = layersFor(surface);
    if (memo && memo.data === data && memo.coords === coords && memo.rule === rule && memo.stretch === stretched && memo.layers === layers) return memo.inputs;
    const samples = shellSamples(coords, rule.column);
    const inputs = samples ? ruleInputs(samples, rule, stretch, layers) : null;
    shellFor.set(surface.id, { data, coords, rule, stretch: stretched, layers, inputs });
    return inputs;
}

/** What the dataset gives a surface built from it: a shell's samples, or the contacts of one from logging. */
const inputsFor = (surface: SurfaceObject) => (surface.rule.kind === 'shell' ? shellInputsFor(surface) : contactInputsFor(surface));

async function fit(id: string, key: string, quality: FitQuality): Promise<void> {
    const surface = useModelStore.getState().scene.surfaces.find(s => s.id === id);
    const box = sceneDataBox();
    const found = surface ? inputsFor(surface) : null;
    // The scene moved on while this was waiting
    const stretch = surface ? stretchFor(surface) : null;
    const guides = surface ? guidesForSurface(surface) : null;
    if (!surface || fitKey(surface, box, found, stretch, guides) !== key) return;
    const job = buildJob(surface, box, quality, found, stretch, guides);
    if (!job) {
        put(id, { key, state: 'empty', part: null, field: null, trend: null, lineSigns: null, status: null, stats: null });
        return;
    }
    let out;
    try {
        out = await requestFit(id, job);
    } catch {
        if (useModelCache.getState().byId[id]?.key === key) put(id, { key, state: 'failed', part: null, field: null, trend: null, lineSigns: null, status: null, stats: null });
        return;
    }
    // Replaced by a newer request, or the inputs changed while it ran
    if (!out || useModelCache.getState().byId[id]?.key !== key) return;
    if (!out.ok) {
        put(id, { key, state: out.reason === 'empty' ? 'empty' : 'failed', part: null, field: null, trend: null, lineSigns: null, status: null, stats: null });
        return;
    }
    const final = quality === 'final';
    put(id, {
        key, state: final ? 'ready' : 'fitting',
        part: makePart(surface.name, out.vertices, out.triangles, new Uint32Array(0)),
        field: out.field, trend: out.trend, lineSigns: out.lineSigns, status: out.status, stats: out.stats,
        ...(final ? { lastMs: out.stats.ms } : {}),
    });
    if (!final) await fit(id, key, 'final');
}

/** Bring the cache in step with the scene: refit what changed, forget what was removed. */
export function syncSurfaceFits(): void {
    const { surfaces } = useModelStore.getState().scene;
    const box = sceneDataBox();
    const cache = useModelCache.getState().byId;

    const live = new Set(surfaces.map(s => s.id));
    const gone = Object.keys(cache).filter(id => !live.has(id));
    if (gone.length > 0) {
        for (const id of gone) {
            clearTimeout(timers.get(id));
            timers.delete(id);
            foundFor.delete(id);
            shellFor.delete(id);
            guidesFor.delete(id);
        }
        useModelCache.setState(s => ({ byId: Object.fromEntries(Object.entries(s.byId).filter(([id]) => live.has(id))) }));
    }

    for (const surface of surfaces) {
        const key = fitKey(surface, box, inputsFor(surface), stretchFor(surface), guidesForSurface(surface));
        const prev = cache[surface.id];
        if (prev?.key === key) continue;
        clearTimeout(timers.get(surface.id));
        timers.delete(surface.id);
        // The previous mesh stays up until the new one arrives
        put(surface.id, { key, state: 'fitting' });
        const slow = (prev?.lastMs ?? 0) > FAST_MS;
        if (slow) {
            timers.set(surface.id, setTimeout(() => {
                timers.delete(surface.id);
                void fit(surface.id, key, 'draft');
            }, PAUSE_MS));
        } else {
            void fit(surface.id, key, 'final');
        }
    }
}

useModelStore.subscribe((state, prev) => {
    if (state.scene !== prev.scene) syncSurfaceFits();
});
useAppStore.subscribe((state, prev) => {
    // New data can move the box the surfaces are fitted in
    if (state.columnarData !== prev.columnarData && useModelStore.getState().scene.surfaces.length > 0) syncSurfaceFits();
});
