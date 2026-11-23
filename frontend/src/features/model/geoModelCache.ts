/**
 * The built geological models, by model id: kept in step with the scene and
 * with the surfaces' fits. A model is built again when its own recipe (its
 * contacts, base, boundary, cell size) or the fit of a surface it uses
 * changes, and not otherwise: restyling, or a surface that is not in it,
 * leaves it alone. While a surface it uses is being fitted it waits for it.
 * A model set to be rebuilt only when asked goes stale instead, until
 * `rebuildModel`.
 *
 * Built in a worker of its own (the main thread in tests), latest wins: a
 * build the scene has moved on from is stopped, not left to run to its end,
 * and so is one the user stops (`cancelModelBuild`: the model then waits to
 * be asked, as a stale one does). The worker keeps nothing between builds,
 * so stopping one is ending the worker and starting another.
 */
import { create } from 'zustand';
import { useModelStore } from '../../store/modelStore';
import { modelBox, modelCell } from './boundary';
import { faultFields, sidesByNumber } from './faultDomains';
import { faultNet, type BlockSide, type FaultEnd } from './faults';
import { partsOf, splitsByBlock } from './blockParts';
import { activeContacts, insideOf, modelUnits, unitColor } from './geoModel';
import { runModelJob, type ModelField, type ModelJob, type ModelOutput, type ModelTell } from './geoModelJobs';
import { beginJob, endJob, progressJob } from './jobs';
import { keys } from './objectKeys';
import { flatThickness } from './meshClean';
import { sceneMesh as meshOf } from './meshFields';
import { builtModelsChanged, faultReach, setBuiltModels, useModelCache } from './modelCache';
import { modelDataBox, modelNear } from './modelDrilling';
import { nearMark } from './modelGround';
import type { Box3, FaultSide, GeoModel, TriMesh } from './types';
import { modelThinnest } from './unitActions';
import { useWireframeFiles } from './wireframeFiles';

/** How thick an intrusion's own mesh is, across the way it is thinnest (meshClean.flatThickness), worked out once a mesh */
const thicknesses = new WeakMap<object, number>();
function usualThickness(part: TriMesh, volume: number): number {
    let t = thicknesses.get(part);
    if (t === undefined) {
        t = flatThickness(part, volume) || Infinity;
        thicknesses.set(part, t);
    }
    return t;
}

export interface ModelResult {
    /** The recipe and fits this entry is for */
    key: string;
    /**
     * building = being worked out (what is shown is the last build);
     * ready = up to date; waiting = a surface it uses is not fitted yet;
     * empty = it has no box to be built in (no data, and none set);
     * stale = something changed and it is rebuilt only when asked; failed
     */
    state: 'building' | 'ready' | 'waiting' | 'empty' | 'stale' | 'failed';
    out: ModelOutput | null;
    /** What `out` was built from: the model's unit at any place is read from it (geoModelJobs.unitsAtPoints) */
    job: ModelJob | null;
    /** The units of the build, oldest first (unit 0 is the base), and their colours */
    units: string[];
    colors: string[];
    /** The contacts of the build, oldest first: contact k is surface number k of the build */
    contacts: string[];
    /**
     * The fault block each contact of the build is fitted for, as sides of the model's faults (null: every block).
     * A contact fitted in each block apart is in `contacts` once a block.
     */
    sides?: (FaultSide[] | null)[];
    /**
     * The faults of the build: fault f is surface number `out.faultFrom + f` of the build. A fault that younger
     * faults offset is in it once a piece (faultCuts.ts), under the one id.
     */
    faults: string[];
    /** Per fault of the build: the sides of the faults that offset it that this piece of it is on (none: the whole fault) */
    cuts?: FaultSide[][];
    /** The box it was built in */
    box: Box3 | null;
    /** The key `out` is the build of (`key` moves on as soon as another build is begun, or waited for) */
    outKey?: string;
    error?: string;
    /** Stale because its build was stopped by the user (not because it is set to wait to be asked) */
    stopped?: boolean;
}

interface State {
    byId: Record<string, ModelResult>;
}

export const useGeoModelCache = create<State>()(() => ({ byId: {} }));

// A shell kept inside a unit of a model is fitted from the model as it is built here
setBuiltModels(id => {
    const r = useGeoModelCache.getState().byId[id];
    return r && { key: r.key, state: r.state, job: r.job, topSense: r.out?.topSense ?? 0, units: r.units, faults: r.faults, blocks: r.out?.blocks ?? [] };
});
useGeoModelCache.subscribe((state, prev) => { if (state.byId !== prev.byId) builtModelsChanged(); });

/** What a build needs, and the key that tells it from another (null: it cannot be built yet, and why) */
function recipe(model: GeoModel): { job: ModelJob; key: string; units: string[]; colors: string[]; contacts: string[]; sides: (FaultSide[] | null)[]; faults: string[]; cuts: FaultSide[][] } | { wait: 'waiting' | 'empty' } {
    const scene = useModelStore.getState().scene;
    const fits = useModelCache.getState().byId;
    // Inside a unit of another model: that model as it is built now (its box and cells, unless this one has its own)
    const parent = insideOf(scene.models, model);
    let inside: ModelJob['inside'], insideKey = '';
    if (parent) {
        const built = useGeoModelCache.getState().byId[parent.model.id];
        if (!built?.out || !built.job || built.state === 'building' || built.state === 'waiting') return { wait: built?.state === 'empty' || built?.state === 'failed' ? 'empty' : 'waiting' };
        const unit = built.units.indexOf(parent.unit);
        if (unit < 0) return { wait: 'empty' };
        inside = { job: built.job, topSense: built.out.topSense, unit };
        insideKey = `${built.key}#${unit}`;
    }
    const box = model.boundary.box || !inside ? modelBox(model.boundary.box, modelDataBox(model)) : inside.job.box;
    if (!box) return { wait: 'empty' };
    const contacts = activeContacts(scene, model);
    const units = modelUnits(scene, model);
    /** `within`: the sides of the block it is the contact's field in; `block`: that block for the build, with the faults that are not there in it */
    const fields: { contact: typeof contacts[number]; field: ModelField; thin?: TriMesh; within?: FaultSide[]; block?: BlockSide[] }[] = [], marks: string[] = [];
    const cell = inside && model.cell === null && !model.boundary.box ? inside.job.cell
        // (A model of one unit has nothing thin to show)
        : modelCell(box, model.cell, model.cell === null && contacts.length > 0 ? modelThinnest(model, units)?.usual ?? null : null);
    // Its faults: a fitted surface's field, or a fixed mesh read as it is; of one that stops, where it is there; and one that
    // younger faults offset a piece at a time, each piece a fault that ends on those (faultDomains.ts, faultCuts.ts)
    const cuts = faultFields(scene, model, fits, faultReach);
    if (cuts === 'wait') return { wait: 'waiting' };
    for (const c of cuts) marks.push(`fault:${c.mark}`);
    // Sides of faults by number in the build; a side of a fault that is not in it limits nothing
    const sides = (list: readonly FaultSide[] | undefined): FaultEnd[] => sidesByNumber(cuts, list);
    // The faults as a network: which of them stop there (one that another ends on runs through)
    const net = cuts.length > 0 ? faultNet(cuts.map(c => c.ends), cuts.map(c => !!c.there)) : null;
    const stops = (f: number): boolean => !!net?.stops[f];
    for (const c of contacts) {
        if (c.mesh) {
            // A fixed mesh: read as it is
            const mesh = meshOf(c.mesh);
            if (mesh === 'wait') return { wait: 'waiting' };
            if (!mesh) continue;
            fields.push({ contact: c, field: mesh.field });
            marks.push(mesh.mark);
            continue;
        }
        const fit = fits[c.surface!];
        // A surface with nothing to fit is left out; one being fitted is waited for
        if (!fit || (fit.state === 'fitting' && !fit.field) || fit.state === 'fitting') return { wait: 'waiting' };
        // A vein thinner than two cells would be lost between their corners: it is put in as its own mesh. So is an
        // intrusion that thin (Phase 275), where its own mesh is finer than the cells: cut into them, half of a body
        // of sheets a few metres thick was in neither its solid nor its volume
        const thinOf = (of: typeof fit) => {
            if (c.kind !== 'intrusion' || !of.part || of.part.triangles.length === 0) return {};
            const usual = of.stats?.vein ? of.stats.vein.usual
                : of.stats?.body && of.stats.body.cell < cell ? usualThickness(of.part, of.stats.body.volume ?? 0) : Infinity;
            return usual < 2 * cell ? { thin: { vertices: of.part.vertices, triangles: of.part.triangles } } : {};
        };
        // Fitted in each fault block apart (blockParts.ts): its part in each block, and where a block has nothing of
        // it to fit, the surface through all of its data
        const parts = splitsByBlock(model, c) ? partsOf(scene, model.id, c.surface) : [];
        if (parts.length > 0) {
            const own: { on: FaultEnd[]; fit: typeof fit }[] = [];
            for (const p of parts) {
                const of = fits[p.id];
                if (!of || of.state === 'fitting') return { wait: 'waiting' };
                own.push({ on: sides(p.within?.sides), fit: of });
            }
            /** The contact's fit in the block on these sides: its part there or, where the part has nothing to fit (and past the end of every fault), the surface through all of its data */
            const fitOn = (on: readonly FaultEnd[]) => {
                const part = own.find(x => x.on.length === on.length && x.on.every(e => on.some(o => o[0] === e[0] && o[1] === e[1])));
                return part?.fit.field ? part.fit : fit;
            };
            /**
             * Its field in the block on these sides. Beside a fault that stops (`stopping`: those of the block's
             * faults that do) it is taken over, towards the fault's end, into its field in the block that fault is
             * not there in: so it runs unbroken round the end of the fault.
             */
            const fieldOn = (on: readonly FaultEnd[], stopping: readonly number[], used: string[]): ModelField | null => {
                if (stopping.length === 0) {
                    const of = fitOn(on);
                    if (of.field) used.push(of.key);
                    return of.field;
                }
                const [f, ...rest] = stopping;
                const beside = fieldOn(on, rest, used), past = fieldOn(on.filter(e => e[0] !== f), rest, used);
                return !beside || !past || beside === past ? beside ?? past : { beside, past, there: cuts[f].there! };
            };
            parts.forEach((p, i) => {
                const on = own[i].on;
                const stopping = on.flatMap(e => (stops(e[0]) ? [e[0]] : []));
                const used: string[] = [];
                const field = fieldOn(on, stopping, used);
                if (!field) return;
                const thin = stopping.length === 0 ? thinOf(fitOn(on)) : {};
                // (In that block alone: of a fault that stops and is not one of its sides, where that fault is not there)
                const block: BlockSide[] = [...on, ...cuts.flatMap((_x, f) => (stops(f) && !on.some(e => e[0] === f) ? [[f, 0] as BlockSide] : []))];
                fields.push({ contact: c, field, within: p.within?.sides ?? [], block, ...thin });
                marks.push(`${thin.thin ? 'thin:' : ''}${used.join('+')}`);
            });
            // Past the end of every fault (they all stop): the surface through all of its data
            if (net && fit.field && net.signs.some(signs => signs.every(v => v === 0))) {
                fields.push({ contact: c, field: fit.field, within: [], block: cuts.map((_x, f) => [f, 0] as BlockSide) });
                marks.push(`past:${fit.key}`);
            }
            continue;
        }
        if (!fit.field) continue;
        const thin = thinOf(fit);
        fields.push({ contact: c, field: fit.field, ...thin });
        marks.push(thin.thin ? `thin:${fit.key}` : fit.key);
    }
    let top: ModelField | null = null;
    if (model.boundary.top && scene.wireframes.some(w => w.id === model.boundary.top)) {
        const mesh = meshOf(model.boundary.top);
        if (mesh === 'wait') return { wait: 'waiting' };
        top = mesh?.field ?? null;
        marks.push(`top:${mesh?.mark ?? ''}`);
    } else if (model.boundary.top) {
        const fit = fits[model.boundary.top];
        if (fit?.state === 'fitting') return { wait: 'waiting' };
        top = fit?.field ?? null;
        marks.push(`top:${fit?.key ?? ''}`);
    }
    // Kept near its drilling: the reach from the holes it reads
    const near = modelNear(model);
    if (near) marks.push(nearMark(near));
    const job: ModelJob = {
        box, cell, outline: model.boundary.outline ?? null, ...(near ? { near } : {}), top,
        steps: fields.map(f => ({ kind: f.contact.kind, young: f.contact.young })),
        fields: fields.map(f => f.field),
        unitOf: fields.map(f => units.indexOf(f.contact.unit)),
        units: units.length,
        ...(fields.some(f => f.thin) ? { thin: fields.map(f => f.thin ?? null) } : {}),
        ...(cuts.length > 0 ? {
            faults: { fields: cuts.map(c => c.field), ends: cuts.map(c => c.ends), ...(cuts.some((_c, f) => stops(f)) ? { there: cuts.map((c, f) => (stops(f) ? c.there : null)) } : {}) },
            within: fields.map(f => { const w: BlockSide[] = f.block ?? sides(f.within ?? f.contact.within); return w.length ? w : null; }),
        } : {}),
        ...(inside ? { inside } : {}),
    };
    const key = JSON.stringify([box, cell, job.outline, job.steps, job.unitOf, units, marks, job.faults?.ends ?? null, job.within ?? null, insideKey]);
    return {
        job, key, units, colors: units.map(u => unitColor(scene, model, u)), contacts: fields.map(f => f.contact.id),
        sides: fields.map(f => f.within ?? f.contact.within ?? null), faults: cuts.map(c => c.id), cuts: cuts.map(c => c.cut),
    };
}

let worker: Worker | null = null;
let workerFailed = false;
let nextRequest = 1;
const waiting = new Map<number, { resolve: (out: ModelOutput) => void; reject: (e: Error) => void; tell?: ModelTell }>();

/** A build ended with its worker, before it was done */
class Stopped extends Error {}

/**
 * End the worker and every build in it (each is told it was `Stopped`): the
 * next build starts a new one. False when the builds are not in a worker (the
 * main thread: a build there is over before anything can stop it).
 */
function stopWorker(): boolean {
    if (!worker) return false;
    worker.terminate();
    worker = null;
    const ended = [...waiting.values()];
    waiting.clear();
    for (const p of ended) p.reject(new Stopped('The build was stopped'));
    return true;
}

function run(job: ModelJob, tell?: ModelTell): Promise<ModelOutput> {
    if (!workerFailed && !worker && typeof Worker !== 'undefined') {
        try {
            worker = new Worker(new URL('../../workers/surface.worker.ts', import.meta.url), { type: 'module' });
            worker.onmessage = (e: MessageEvent) => {
                const { id, result, error, progress, step } = e.data;
                const p = waiting.get(id);
                // Part-way through: more is to come
                if (progress) { p?.tell?.(progress[0], progress[1], step ?? ''); return; }
                waiting.delete(id);
                if (error) p?.reject(new Error(error)); else p?.resolve(result);
            };
            worker.onerror = () => {
                workerFailed = true;
                worker?.terminate();
                worker = null;
                for (const p of waiting.values()) p.reject(new Error('The model worker stopped unexpectedly'));
                waiting.clear();
            };
        } catch {
            workerFailed = true;
            worker = null;
        }
    }
    if (!worker) return new Promise((resolve, reject) => { try { resolve(runModelJob(job)); } catch (e) { reject(e as Error); } });
    const w = worker;
    return new Promise((resolve, reject) => {
        const id = nextRequest++;
        waiting.set(id, { resolve, reject, tell });
        w.postMessage({ id, model: job });
    });
}

/** The build under way for each model, and the one asked for meanwhile */
const running = new Map<string, string>();
/** Models whose build the user stopped, and the recipe that was being built: not built again until asked, or until the recipe changes */
const held = new Map<string, string>();
/** Models whose build under way is being stopped by the user */
const stopping = new Set<string>();

function put(id: string, patch: Partial<ModelResult> & { key: string }) {
    useGeoModelCache.setState(s => {
        const prev = s.byId[id];
        const base: ModelResult = prev ?? { key: patch.key, state: 'building', out: null, job: null, units: [], colors: [], contacts: [], faults: [], box: null };
        return { byId: { ...s.byId, [id]: { ...base, ...patch } } };
    });
}

async function build(id: string, made: Exclude<ReturnType<typeof recipe>, { wait: string }>): Promise<void> {
    if (running.has(id)) {
        // The scene has moved on from the build under way: it is stopped, and what the scene is now is built when it
        // has ended (on the main thread it cannot be stopped, and has ended already by the time anything else runs)
        const moved = running.get(id) !== made.key;
        running.set(id, made.key);
        if (moved) stopWorker();
        return;
    }
    running.set(id, made.key);
    held.delete(id);
    put(id, { key: made.key, state: 'building', stopped: undefined });
    const listed = beginJob({
        kind: 'model', object: keys.model(id), name: useModelStore.getState().scene.models?.find(m => m.id === id)?.name ?? 'Geological model', what: 'build',
        // (Built on this thread, as in tests, it is over before it can be stopped)
        ...(typeof Worker !== 'undefined' ? { stop: () => { cancelModelBuild(id); } } : {}),
    });
    try {
        const out = await run(made.job, (done, of, step) => progressJob(listed, done, of, step));
        const wanted = running.get(id);
        running.delete(id);
        // The scene moved on while it was built: build what it is now
        if (wanted !== made.key || !useModelStore.getState().scene.models?.some(m => m.id === id)) { syncModels(); endJob(listed, 'replaced'); return; }
        put(id, { key: made.key, outKey: made.key, state: 'ready', out, job: made.job, units: made.units, colors: made.colors, contacts: made.contacts, sides: made.sides, faults: made.faults, cuts: made.cuts, box: made.job.box, error: undefined });
        // (A model inside a unit of this one is built on it)
        if (useModelStore.getState().scene.models?.some(m => m.boundary.inside?.model === id)) later();
        endJob(listed, 'done');
    } catch (e) {
        running.delete(id);
        if (e instanceof Stopped) {
            // Stopped by the user: it waits to be asked. Otherwise the scene moved on (for this model or for another
            // in the same worker): what the scene is now is built
            if (stopping.delete(id)) {
                held.set(id, made.key);
                put(id, { key: made.key, state: 'stale', stopped: true });
                endJob(listed, 'stopped');
            } else {
                if (useModelStore.getState().scene.models?.some(m => m.id === id)) syncModels();
                endJob(listed, 'replaced');
            }
            return;
        }
        const why = e instanceof Error ? e.message : 'The model could not be built';
        put(id, { key: made.key, state: 'failed', error: why });
        if (useModelStore.getState().scene.models?.some(m => m.boundary.inside?.model === id)) later();
        endJob(listed, 'failed', why);
    }
}

/** Bring the cache in step with the scene and the fits. `force`: a model's id to build although it is set to wait to be asked */
export function syncModels(force: string | null = null): void {
    const models = useModelStore.getState().scene.models ?? [];
    const cache = useGeoModelCache.getState().byId;
    const live = new Set(models.map(m => m.id));
    if (Object.keys(cache).some(id => !live.has(id))) {
        useGeoModelCache.setState(s => ({ byId: Object.fromEntries(Object.entries(s.byId).filter(([id]) => live.has(id))) }));
    }
    for (const id of [...held.keys()]) if (!live.has(id)) held.delete(id);
    // (A model that is gone is not built to its end: the others in the worker with it are built again)
    if ([...running.keys()].some(id => !live.has(id))) stopWorker();
    for (const model of models) {
        const prev = cache[model.id];
        const made = recipe(model);
        if ('wait' in made) {
            if (prev?.state !== made.wait) put(model.id, { key: prev?.key ?? '', state: made.wait });
            continue;
        }
        // (Being built counts only while its build is under way: one that ended with its worker is built again)
        if (prev?.key === made.key && (prev.state === 'ready' || prev.state === 'failed' || (prev.state === 'building' && running.has(model.id)))) {
            // Only its colours changed: no build
            if (prev.state === 'ready' && prev.colors.join() !== made.colors.join()) put(model.id, { key: prev.key, colors: made.colors });
            continue;
        }
        if (running.get(model.id) === made.key) continue;
        // What it waited for came back as it was (a fit that was stopped, a change undone): the build it has is the build of it
        if (prev?.state === 'waiting' && prev.out && prev.outKey === made.key && !running.has(model.id)) {
            put(model.id, { key: made.key, state: 'ready', colors: made.colors });
            continue;
        }
        // Its build was stopped by the user: it waits to be asked, until something it is built from changes
        if (held.get(model.id) === made.key && force !== model.id) continue;
        if (model.auto === false && force !== model.id && prev?.out) {
            if (prev.state !== 'stale' || prev.stopped) put(model.id, { key: prev.key, state: 'stale', stopped: undefined });
            continue;
        }
        void build(model.id, made);
    }
}

/** Build a model now, whatever its rebuild setting */
export const rebuildModel = (id: string): void => syncModels(id);

/**
 * Stop the build of a model that is under way. What was built before stays
 * up, and the model waits to be asked (`rebuildModel`) or for something it
 * is built from to change. False: nothing of it was being built, or it is
 * built on the main thread, where a build cannot be stopped.
 */
export function cancelModelBuild(id: string): boolean {
    if (!running.has(id) || !worker) return false;
    stopping.add(id);
    return stopWorker();
}

let queued = false;
function later() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; syncModels(); });
}

useModelStore.subscribe((state, prev) => {
    if (state.scene !== prev.scene && ((state.scene.models?.length ?? 0) > 0 || Object.keys(useGeoModelCache.getState().byId).length > 0)) later();
});
useModelCache.subscribe((state, prev) => {
    if (state.byId !== prev.byId && (useModelStore.getState().scene.models?.length ?? 0) > 0) later();
});
useWireframeFiles.subscribe((state, prev) => {
    if (state.byFile !== prev.byFile && (useModelStore.getState().scene.models?.length ?? 0) > 0) later();
});
