/**
 * The worked-out form of each surface in the scene: its mesh and fitted
 * field. Not saved (rebuilt from the scene on load) and not part of undo.
 *
 * `syncSurfaceFits` keeps it in step with the scene: whenever a surface's
 * inputs change it is refitted in the Web Worker. A surface that fits quickly
 * is redone at once, at full detail. One that takes longer waits for a pause
 * in the editing, then shows a coarse draft before the full mesh.
 */
import { lodeRule, setRule } from './veinSet';
import { create } from 'zustand';
import { useAppStore } from '../../store/appStore';
import { withoutHistory } from '../../store/historyStore';
import { asFollowing, useModelStore } from '../../store/modelStore';
import { makePart, type WireframePart } from '../plots/viewer3d/wireframeParsers';
import { findContacts, sidesRule, type ContactInputs, type HoleLog } from './contacts';
import { failureText } from './describe';
import { surfaceLimit, type SurfaceLimit } from './faultDomains';
import { partsOf, placesTellLie, splitsByBlock } from './blockParts';
import { layerReadings } from './modelLayers';
import { usualGap } from './conform';
import { useWireframeFiles } from './wireframeFiles';
import { holeLog, shellSamples, unitLog } from './logging';
import { SHARE_STRENGTH, shareFrame, shareSamples } from './proportion';
import { useDrillholeStore } from '../../store/drillholeStore';
import { buildPotential, type Potential } from './frame';
import type { Stretch } from './rbf';
import { ruleInputs } from './intercepts';
import type { ShellInputs, ShellLayers, ShellSamples } from './shell';
import type { PlungeSamples } from './plungeScan';
import { inDomain, labelsAtPoints, type ModelJob, type ReachField, type UnitOf } from './geoModelJobs';
import { sceneMesh } from './meshFields';
import { bestFitPlane } from './plane';
import { pickSpread } from './readings';
import { blocksOn, domainUnits, isSolids, solidMeshes, solidSurfaces, takesDomain, unitDomain } from './shellDomains';
import { insideSolids, notClosed, type SolidGround } from './solidGround';
import type { MeshField } from './meshField';
import { DEFAULT_LINE_STRENGTH, DEFAULT_STRENGTH, structureStretch } from './structure';
import { acrossNodes, buildTrendField, chosenSets, planeNodes, type TrendField } from './trendField';
import { veinDataPlane, veinGuides, type GuideSamples } from './guides';
import type { FittedField } from './rbf';
import { beginJob, endJob, holdBusy, progressJob, startJob } from './jobs';
import { keys } from './objectKeys';
import { requestFit, stopFit } from './surfaceClient';
import { buildJob, fitKey, keyMark, surfaceGuides, veinMiddles, type AlongsideOf, type FitQuality, type FitSummary } from './surfaceJobs';
import { ruleLog } from './pile';
import type { BodyRule, Box3, ContactRule, GeoModel, ModelFault, OverallStructure, Plane, SceneCoords, SurfaceObject, SurfaceRule, TriMesh, Vec3 } from './types';
import { clipMeshByScalar } from './meshOps';

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
    /** When it failed: why, in words (describe.ts `failureText`) */
    error?: string | null;
    /** It is locked, and this is not the fit it was locked at: what it is built from has changed since (see `SurfaceObject.lockedKey`) */
    lockMoved?: boolean;
    /**
     * While it is being fitted again: the key of the fit that is still shown
     * (the fit it had, or `…|draft` once a draft of the new one has landed).
     * Absent: nothing of it is shown.
     */
    shown?: string;
    /**
     * Its fit was stopped before it was done (jobs.stopJob). What is shown is
     * as it was (under the key that was fitted), and it is not fitted again
     * until asked (`refitSurface`) or until what it is fitted from changes.
     */
    stopped?: boolean;
}

interface ModelCacheState {
    byId: Record<string, SurfaceResult>;
}

export const useModelCache = create<ModelCacheState>()(() => ({ byId: {} }));

/** Fits quicker than this are redone on every change */
const FAST_MS = 150;
/** Slower ones wait for this long a pause in the editing */
const PAUSE_MS = 600;
// (Tests edit without pausing, and each wait made them slower than their time allows on a busy machine: there the
// slow path is taken as ever, with no wait in it. The tests of the pause itself set it.)
let pauseMs = import.meta.env?.MODE === 'test' ? 0 : PAUSE_MS;

/** For tests: how long a slow surface waits for a pause in the editing (null: as the program has it, 600 ms) */
export function setFitPause(ms: number | null): void {
    pauseMs = ms ?? PAUSE_MS;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** For each fit waiting for a pause: what takes it out of the list of what is to come */
const pauses = new Map<string, () => void>();
/** Surfaces whose fit the user stopped, and the key that was being fitted: not fitted again until asked, or until the key changes */
const stoppedAt = new Map<string, string>();
/** A surface's fit is no longer waiting for a pause: it has begun, or is not wanted */
function endPause(id: string): void {
    clearTimeout(timers.get(id));
    timers.delete(id);
    pauses.get(id)?.();
    pauses.delete(id);
}

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
    const box = dataBoxIn(coords);
    boxFor = { data: app.columnarData, coords, box };
    return box;
}

/** World extent of the dataset in these coordinate columns (null without data or columns): what `sceneDataBox` would be were they the scene's */
export function dataBoxIn(coords: Pick<SceneCoords, 'x' | 'y' | 'z'> | null): Box3 | null {
    const app = useAppStore.getState();
    const x = coords && app.getNumericColumn(coords.x), y = coords && app.getNumericColumn(coords.y), z = coords && app.getNumericColumn(coords.z);
    if (!x || !y || !z) return null;
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
    return max[0] >= min[0] ? { min, max } : null;
}

/**
 * A fitted surface's mesh, as it is drawn. A model's part of a surface in one
 * fault block (blockParts.ts) is cut at the faults its block is on one side
 * of: it is the surface in that block, and is not drawn on into the next.
 * (Its field is not cut: the model reads it in its block alone.)
 */
function partOf(surface: SurfaceObject, name: string, out: TriMesh): WireframePart {
    let mesh: TriMesh = out;
    const limit = surface.blockOf ? limitFor(surface) : null;
    if (limit && limit !== 'wait') {
        for (let s = 0; s < limit.sides && mesh.triangles.length > 0; s++) mesh = clipMeshByScalar(mesh, limit.beyond(s, Float64Array.from(mesh.vertices)));
    }
    return makePart(name, mesh.vertices, mesh.triangles, new Uint32Array(0));
}

/** At most this many of a fault's places are looked at to tell how far along it a place is */
const MAX_REACH_PLACES = 400;

const reaches = new Map<string, { mark: string; field: ReachField | null }>();

/**
 * Where a fault of a model that stops is there, as it is fitted or read
 * now: within its reach of its own places (a fitted surface's points, the
 * nodes of its lines and where holes meet it; a mesh's corners), across
 * its overall plane. Null: it has no extent, or nothing tells where it is.
 */
export function faultReach(fault: ModelFault): ReachField | null {
    const reach = fault.extent?.reach;
    if (!reach || !(reach > 0)) return null;
    const surface = fault.surface ? useModelStore.getState().scene.surfaces.find(s => s.id === fault.surface) : undefined;
    const fit = surface ? useModelCache.getState().byId[surface.id] : undefined;
    const mesh = fault.mesh ? sceneMesh(fault.mesh) : null;
    const mark = `${reach}|${surface ? fit?.key ?? '' : mesh && mesh !== 'wait' ? mesh.mark : ''}`;
    const had = reaches.get(fault.id);
    if (had && had.mark === mark) return had.field;
    const places = faultPlaces(fault);
    const plane = fit?.trend ?? (places.length >= 9 ? bestFitPlane(places) : null);
    let field: ReachField | null = null;
    if (places.length >= 3 && plane) {
        const keep = pickSpread(places, MAX_REACH_PLACES);
        const at = new Float64Array(keep.length * 3);
        keep.forEach((i, q) => { at[q * 3] = places[i * 3]; at[q * 3 + 1] = places[i * 3 + 1]; at[q * 3 + 2] = places[i * 3 + 2]; });
        field = { reach, at, normal: [plane.normal[0], plane.normal[1], plane.normal[2]] };
    }
    reaches.set(fault.id, { mark, field });
    return field;
}

/** The places a fault of a model is known at: a fitted surface's own, or a mesh's corners (xyz triples) */
function faultPlaces(fault: ModelFault): ArrayLike<number> {
    const surface = fault.surface ? useModelStore.getState().scene.surfaces.find(s => s.id === fault.surface) : undefined;
    if (surface) return placesOf(surface);
    const mesh = fault.mesh ? sceneMesh(fault.mesh) : null;
    return mesh && mesh !== 'wait' ? mesh.field.vertices : [];
}

/** If nothing tells how far a fault runs past its places: this far, m */
const REACH_UNKNOWN = 100;

/**
 * How far past its own places a fault is first taken to run when it is told
 * to stop: as far as its places are usually apart (so that it is unbroken
 * between them, and ends that far past the last), to two figures.
 */
export function suggestedReach(fault: ModelFault): number {
    const places = faultPlaces(fault);
    const keep = pickSpread(places, MAX_REACH_PLACES);
    const some = new Float64Array(keep.length * 3);
    keep.forEach((i, q) => { some[q * 3] = places[i * 3]; some[q * 3 + 1] = places[i * 3 + 1]; some[q * 3 + 2] = places[i * 3 + 2]; });
    const gap = keep.length >= 2 ? usualGap(some) : 0;
    return gap > 0 && Number.isFinite(gap) ? Number(gap.toPrecision(2)) : REACH_UNKNOWN;
}

/** The fault block a surface is fitted in, as the faults are now (faultDomains.ts), its mark made short */
function limitFor(surface: SurfaceObject): SurfaceLimit | 'wait' | null {
    if (!surface.within) return null;
    const limit = surfaceLimit(surface, useModelStore.getState().scene, useModelCache.getState().byId, faultReach);
    return limit && limit !== 'wait' ? { ...limit, mark: keyMark(limit.mark) } : limit;
}

/** A built geological model, as a shell kept inside one of its units needs it */
export interface BuiltModel { key: string; state: string; job: ModelJob | null; topSense: 1 | -1 | 0; units: string[]; faults?: string[]; blocks?: number[][] }

// (The built models are kept by geoModelCache, which is built on this cache: it says where they are)
let builtModel: ((id: string) => BuiltModel | undefined) | null = null;
export function setBuiltModels(source: (id: string) => BuiltModel | undefined): void { builtModel = source; }

/**
 * The unit of a model a shell is kept inside, as that model is built now.
 * 'wait': the model is being built. Null: it is kept inside nothing (or the
 * model is gone, has nothing built, has not that unit, or has this shell as
 * one of its own surfaces).
 */
export function domainFor(surface: SurfaceObject): (UnitOf & { mark: string }) | 'wait' | null {
    const domain = takesDomain(surface.rule) ? unitDomain(surface.domain) : null;
    if (!domain) return null;
    const model = useModelStore.getState().scene.models?.find(m => m.id === domain.model);
    if (!model || model.contacts.some(c => c.surface === surface.id) || model.faults?.some(x => x.surface === surface.id) || model.boundary.top === surface.id) return null;
    const built = builtModel?.(domain.model);
    if (!built || built.state === 'building' || built.state === 'waiting') return 'wait';
    // Of several units, those the model has now; of a fault block, the blocks on those sides of the faults it is cut by now
    const units = domainUnits(domain).map(u => built.units.indexOf(u)).filter(u => u >= 0);
    const blocks = blocksOn(domain.sides, built.faults ?? [], built.blocks ?? []);
    if (!built.job || units.length === 0 || (blocks && blocks.length === 0)) return null;
    const several = units.length > 1 || !!blocks;
    return {
        job: built.job, topSense: built.topSense, unit: units[0], ...(units.length > 1 ? { units } : {}), ...(blocks ? { blocks } : {}),
        // (One unit in every block: the mark it has always had, so that a fit kept with a project is still this one)
        mark: keyMark(several ? `${built.key}#${units.join(',')}#${blocks ? blocks.join(',') : ''}` : `${built.key}#${units[0]}`),
    };
}

/** The mesh of a fitted surface as ground reads it: the same object for the same fit, so that it is read once */
const solidMeshOf = new WeakMap<object, MeshField>();
function meshOfPart(part: { vertices: Float64Array; triangles: Uint32Array }): MeshField {
    let m = solidMeshOf.get(part);
    if (!m) { m = { vertices: part.vertices, triangles: part.triangles }; solidMeshOf.set(part, m); }
    return m;
}

/** Whether a surface is kept inside solids that are, or are in turn kept inside, `target` */
function keptInsideOf(id: string, target: string, seen = new Set<string>()): boolean {
    if (id === target) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    const scene = useModelStore.getState().scene;
    const s = scene.surfaces.find(x => x.id === id);
    return !!s && isSolids(s.domain) && solidSurfaces(s.domain, scene).some(next => keptInsideOf(next, target, seen));
}

/** One of the solids a surface is kept inside, as it is now */
export interface SolidState {
    kind: 'surface' | 'mesh';
    id: string;
    name: string;
    /** closed: it is ground. open: it has an open edge, so no inside. empty: it has nothing fitted (or no triangles). waiting: it is being fitted or read. loop: it is kept inside this surface */
    state: 'closed' | 'open' | 'empty' | 'waiting' | 'loop';
}

/**
 * The solids a surface is kept inside (solidGround.ts), as they are fitted
 * now: the meshes of those that are closed. 'wait': one of them is still
 * being fitted, or its file read. Null: it is kept inside none (or none of
 * them is closed: it then goes where its samples take it, and `solidStates`
 * says why).
 */
export function solidsFor(surface: SurfaceObject): (SolidGround & { states: SolidState[] }) | 'wait' | null {
    const domain = takesDomain(surface.rule) && isSolids(surface.domain) ? surface.domain : null;
    if (!domain) return null;
    const scene = useModelStore.getState().scene;
    const fits = useModelCache.getState().byId;
    const meshes: MeshField[] = [], marks: string[] = [], states: SolidState[] = [];
    let waiting = false;
    for (const id of solidSurfaces(domain, scene)) {
        const name = scene.surfaces.find(s => s.id === id)?.name ?? id;
        if (keptInsideOf(id, surface.id)) { states.push({ kind: 'surface', id, name, state: 'loop' }); continue; }
        const fit = fits[id];
        if (!fit || fit.state === 'fitting') { waiting = true; states.push({ kind: 'surface', id, name, state: 'waiting' }); continue; }
        if (!fit.part || fit.part.triangles.length === 0) { states.push({ kind: 'surface', id, name, state: 'empty' }); continue; }
        const mesh = meshOfPart(fit.part);
        const closed = notClosed([mesh]).length === 0;
        states.push({ kind: 'surface', id, name, state: closed ? 'closed' : 'open' });
        if (closed) { meshes.push(mesh); marks.push(`${id}:${keyMark(fit.key)}`); }
    }
    for (const id of solidMeshes(domain)) {
        const name = scene.wireframes.find(w => w.id === id)?.name ?? id;
        const read = sceneMesh(id);
        if (read === 'wait') { waiting = true; states.push({ kind: 'mesh', id, name, state: 'waiting' }); continue; }
        if (!read) { states.push({ kind: 'mesh', id, name, state: 'empty' }); continue; }
        const closed = notClosed([read.field]).length === 0;
        states.push({ kind: 'mesh', id, name, state: closed ? 'closed' : 'open' });
        if (closed) { meshes.push(read.field); marks.push(read.mark); }
    }
    if (waiting) return 'wait';
    if (meshes.length === 0) return null;
    return { meshes, mark: keyMark(`solids#${marks.join('|')}`), states };
}

/** The solids a surface is kept inside, one by one, as they are now (empty: it is kept inside none) */
export function solidStates(surface: SurfaceObject): SolidState[] {
    const domain = takesDomain(surface.rule) && isSolids(surface.domain) ? surface.domain : null;
    if (!domain) return [];
    const scene = useModelStore.getState().scene;
    const fits = useModelCache.getState().byId;
    const out: SolidState[] = [];
    for (const id of solidSurfaces(domain, scene)) {
        const name = scene.surfaces.find(s => s.id === id)?.name ?? id;
        const fit = fits[id];
        const state: SolidState['state'] = keptInsideOf(id, surface.id) ? 'loop' : !fit || fit.state === 'fitting' ? 'waiting' : !fit.part || fit.part.triangles.length === 0 ? 'empty' : notClosed([meshOfPart(fit.part)]).length === 0 ? 'closed' : 'open';
        out.push({ kind: 'surface', id, name, state });
    }
    for (const id of solidMeshes(domain)) {
        const name = scene.wireframes.find(w => w.id === id)?.name ?? id;
        const read = sceneMesh(id);
        out.push({ kind: 'mesh', id, name, state: read === 'wait' ? 'waiting' : !read ? 'empty' : notClosed([read.field]).length === 0 ? 'closed' : 'open' });
    }
    return out;
}

/** A shell's samples that are inside the solids it is kept inside */
function samplesInSolids(samples: ShellSamples, ground: SolidGround): ShellSamples {
    const n = samples.x.length;
    const xyz = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) { xyz[i * 3] = samples.x[i]; xyz[i * 3 + 1] = samples.y[i]; xyz[i * 3 + 2] = samples.z[i]; }
    const inside = insideSolids(ground, xyz);
    const rows: number[] = [];
    for (let i = 0; i < n; i++) if (inside[i]) rows.push(i);
    const numbers = (a: ArrayLike<number>) => Float64Array.from(rows, i => a[i]);
    return {
        hole: samples.hole ? rows.map(i => samples.hole![i]) : null,
        from: samples.from ? numbers(samples.from) : null, to: samples.to ? numbers(samples.to) : null,
        x: numbers(samples.x), y: numbers(samples.y), z: numbers(samples.z), value: numbers(samples.value),
    };
}

/** A shell's samples that are in the unit it is kept inside */
function samplesIn(samples: ShellSamples, domain: UnitOf): ShellSamples {
    const n = samples.x.length;
    const xyz = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) { xyz[i * 3] = samples.x[i]; xyz[i * 3 + 1] = samples.y[i]; xyz[i * 3 + 2] = samples.z[i]; }
    const { unit, block } = labelsAtPoints(domain.job, domain.topSense, xyz);
    const inside = inDomain(domain), units = domain.job.units;
    const rows: number[] = [];
    for (let i = 0; i < n; i++) if (unit[i] >= 0 && inside(block[i] * units + unit[i])) rows.push(i);
    const numbers = (a: ArrayLike<number>) => Float64Array.from(rows, i => a[i]);
    return {
        hole: samples.hole ? rows.map(i => samples.hole![i]) : null,
        from: samples.from ? numbers(samples.from) : null, to: samples.to ? numbers(samples.to) : null,
        x: numbers(samples.x), y: numbers(samples.y), z: numbers(samples.z), value: numbers(samples.value),
    };
}

/**
 * What a vein ends on, as that is fitted now, and the side of it the vein is
 * on. 'wait': it is still being fitted. Null: it ends on nothing (or on a
 * surface that is gone, has nothing to fit, or ends, in turn, on this one).
 */
function endFor(surface: SurfaceObject): { field: FittedField; side: 1 | -1; mark: string } | 'wait' | null {
    const end = surface.rule.kind === 'body' ? surface.rule.vein?.endsOn : undefined;
    if (!end) return null;
    const { surfaces } = useModelStore.getState().scene;
    const seen = new Set([surface.id]);
    for (let at = surfaces.find(s => s.id === end.surface); at;) {
        if (seen.has(at.id)) return null;
        seen.add(at.id);
        const next = at.rule.kind === 'body' ? at.rule.vein?.endsOn?.surface : undefined;
        at = next ? surfaces.find(s => s.id === next) : undefined;
    }
    if (!surfaces.some(s => s.id === end.surface)) return null;
    const fit = useModelCache.getState().byId[end.surface];
    if (!fit || fit.state === 'fitting') return 'wait';
    if (!fit.field) return null;
    // (A vein that stops at another vein of its system: on one side of that vein's reference surface, the middle of it)
    const field = end.middle && fit.field.walls ? middleOf(fit.field) : fit.field;
    return { field, side: end.side, mark: `${keyMark(fit.key)}${end.middle ? 'm' : ''}` };
}

const middles = new WeakMap<FittedField, FittedField>();
/** A vein's reference surface: its field without its walls (the same object for the same vein, so that what ends on it is not fitted again for nothing) */
function middleOf(vein: FittedField): FittedField {
    let m = middles.get(vein);
    if (!m) { m = { ...vein, walls: null }; middles.set(vein, m); }
    return m;
}

/** The places a surface is fitted through, as it is fitted (xyz triples): its points, the nodes of its lines, its contacts down the holes */
function placesOf(view: SurfaceObject): Float64Array {
    const found = contactInputsFor(view)?.contacts ?? [];
    const own = [...view.points.map(p => p.p), ...view.polylines.flatMap(l => l.points)];
    const out = new Float64Array(own.length * 3 + found.length);
    own.forEach((p, i) => out.set(p, i * 3));
    out.set(found, own.length * 3);
    return out;
}

/**
 * A model's part of a contact in one fault block (blockParts.ts) that has
 * too little of its own there to say how the surface lies (`surface`: as it
 * is fitted, with the places of its block alone; too little: a few places,
 * or one line of holes, see `placesTellLie`): the surface whose shape
 * it takes. That is the part of the same contact, in another block, with
 * the most to go by; with none that has enough, the surface through all
 * the data. It is carried alongside that one at the distance its own few
 * places are from it: the shape known next door, at the height this block
 * has it. Null: it is no such part, or it has enough to be fitted on its
 * own (or nothing at all: the model then takes the whole surface there).
 */
function sparseWhole(surface: SurfaceObject): string | null {
    if (!surface.blockOf || surface.conform || (surface.rule.kind !== 'sheet' && surface.rule.kind !== 'contact')) return null;
    const places = placesOf(surface);
    if (places.length === 0 || placesTellLie(places)) return null;
    let best: string | null = null, most = 0;
    for (const s of useModelStore.getState().scene.surfaces) {
        if (s.id === surface.id || s.blockOf !== surface.blockOf || s.within?.model !== surface.within?.model) continue;
        const limited = limitedSurface(s);
        const theirs = limited === 'wait' ? null : placesOf(limited.view);
        if (theirs && theirs.length > most && placesTellLie(theirs)) { most = theirs.length; best = s.id; }
    }
    return best ?? surface.blockOf;
}

/** Whether a fit (by its key) is of a surface carried alongside another */
export const fitIsAlongside = (key: string | undefined): boolean => !!key && key.includes('|alongside:');

/**
 * The surface another runs alongside, as it is fitted now. 'wait': it is
 * still being fitted. Null: it runs alongside nothing (or alongside one
 * that is gone, has nothing to fit, or runs, in turn, alongside this one).
 */
function alongsideFor(surface: SurfaceObject): (AlongsideOf & { mark: string }) | 'wait' | null {
    const other = surface.conform?.surface;
    if (!other || (surface.rule.kind !== 'sheet' && surface.rule.kind !== 'contact')) return null;
    const { surfaces } = useModelStore.getState().scene;
    const seen = new Set([surface.id]);
    for (let at = surfaces.find(s => s.id === other); at;) {
        if (seen.has(at.id)) return null;
        seen.add(at.id);
        const next = at.conform?.surface;
        at = next ? surfaces.find(s => s.id === next) : undefined;
    }
    if (!surfaces.some(s => s.id === other)) return null;
    const fit = useModelCache.getState().byId[other];
    if (!fit || fit.state === 'fitting') return 'wait';
    if (!fit.field) return null;
    return { field: fit.field, trend: fit.trend, vertices: fit.part?.vertices ?? null, cell: fit.stats?.cell ?? fit.stats?.body?.cell ?? null, mark: keyMark(fit.key) };
}


// (By the lists, not the surface: the same lists the same way give the same lists, whatever else of the surface changed)
const fittedFor = new Map<string, {
    from: Pick<SurfaceObject, 'points' | 'polylines' | 'weights'>; mark: string;
    kept: Pick<SurfaceObject, 'points' | 'polylines' | 'weights'> | null; lines: number[] | null;
}>();

/**
 * A surface as it is fitted: one limited to a fault block has only those of
 * its points that are in the block, and those of its lines that are mostly in
 * it. `lines`: which of its lines those are (null: all of them). 'wait': a
 * fault that limits it is still being fitted.
 */
function fittedSurface(surface: SurfaceObject): { view: SurfaceObject; lines: number[] | null } | 'wait' {
    const limited = limitedSurface(surface);
    if (limited === 'wait') return limited;
    // A model's part in a fault block with too little of its own there: it is carried alongside the surface it is a part of
    const whole = sparseWhole(limited.view);
    return whole ? { view: { ...limited.view, conform: { surface: whole } }, lines: limited.lines } : limited;
}

function limitedSurface(surface: SurfaceObject): { view: SurfaceObject; lines: number[] | null } | 'wait' {
    const limit = limitFor(surface);
    if (limit === 'wait') return 'wait';
    if (!limit) { fittedFor.delete(surface.id); return { view: surface, lines: null }; }
    const memo = fittedFor.get(surface.id);
    const view = (kept: Pick<SurfaceObject, 'points' | 'polylines' | 'weights'> | null): SurfaceObject => {
        if (!kept) return surface;
        const { weights: _weights, ...rest } = surface;
        return { ...rest, points: kept.points, polylines: kept.polylines, ...(kept.weights ? { weights: kept.weights } : {}) };
    };
    if (memo && memo.from.points === surface.points && memo.from.polylines === surface.polylines && memo.from.weights === surface.weights && memo.mark === limit.mark) {
        return { view: view(memo.kept), lines: memo.lines };
    }
    const flat = (pts: readonly (readonly number[])[]) => { const a = new Float64Array(pts.length * 3); pts.forEach((p, i) => a.set(p, i * 3)); return a; };
    const pointIn = limit.inside(flat(surface.points.map(p => p.p)));
    const lineIn = surface.polylines.map(l => {
        const flags = limit.inside(flat(l.points));
        let inside = 0;
        for (let i = 0; i < flags.length; i++) inside += flags[i];
        return inside * 2 >= flags.length;
    });
    const all = pointIn.every(f => f === 1) && lineIn.every(Boolean);
    const w = surface.weights;
    const kept = all ? null : {
        points: surface.points.filter((_, i) => pointIn[i]),
        polylines: surface.polylines.filter((_, i) => lineIn[i]),
        ...(w ? { weights: { points: w.points.filter((_, i) => pointIn[i]), lines: w.lines.filter((_, i) => lineIn[i]) } } : {}),
    };
    const lines = all ? null : lineIn.flatMap((keep, i) => (keep ? [i] : []));
    fittedFor.set(surface.id, { from: { points: surface.points, polylines: surface.polylines, weights: surface.weights }, mark: limit.mark, kept, lines });
    return { view: view(kept), lines };
}

// What the logging gives each surface built from it, remembered per dataset and rule
const foundFor = new Map<string, { data: unknown; tables: unknown; coords: SceneCoords | null; rule: SurfaceRule; map: unknown; limit: string | null; follows: TrendField | null; found: ContactInputs | null }>();

/** The plane from the structural data and the plane from the logging are said to differ when they are more than 15 degrees apart (its cosine) */
const PLANES_AGREE = Math.cos(15 * Math.PI / 180);

/**
 * The contacts a rule finds in a log: read as a pile of layers first when
 * the rule is a contact of one (pile.ts). `follows`: the structural data a
 * vein follows (`followedBy`), which says which plane its sheets lie in.
 * `gaps`: also the gaps between stretches of the first side
 * (`ContactInputs.gaps`).
 */
/** The middles of the stretches of a body's own units down the holes, xyz triples */
function insideMiddles(found: ContactInputs): number[] {
    const out: number[] = [];
    const { positions, side } = found.middles;
    for (let i = 0; i < side.length; i++) if (side[i] > 0) out.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    return out;
}

export function foundAs(log: HoleLog, rule: ContactRule | BodyRule, follows: TrendField | null = null, gaps = false): ContactInputs {
    const { log: as, read } = ruleLog(log, rule);
    // (`gaps`: the gaps between its stretches down the holes as well, for the dialog that sets the join length)
    const sides = gaps ? { ...sidesRule(rule), gaps: true } : sidesRule(rule);
    let found = findContacts(as, sides);
    // A vein held to the lie of the ground, read as zones, its plane not given: the plane the structural data it follows
    // (`follows`) gives at its stretches comes before the one worked out from the logging
    if (follows && rule.kind === 'body' && (rule.vein ? rule.vein.held && (rule.vein.join ?? 0) > 0 : !!rule.sheets) && !sides.across) {
        const plane = veinDataPlane(follows, rule.vein ? veinMiddles(found) : insideMiddles(found));
        if (plane) {
            // (Said, when the logging on its own gives a plane well away from it)
            const logging = found.joinPlane ?? null;
            found = findContacts(as, { ...sides, across: plane, acrossFrom: 'data' });
            if (logging && Math.abs(logging[0] * plane[0] + logging[1] * plane[1] + logging[2] * plane[2]) < PLANES_AGREE) found = { ...found, loggingPlane: logging };
        }
    }
    return read ? { ...found, pile: { metres: read.metres, changed: read.changed, holes: read.holes, up: read.up } } : found;
}

/**
 * For a surface built from a logging column: its contacts and the side of
 * every logged interval, from the dataset and the drillhole tables as they
 * are now. Null for any other surface, and when the columns it needs are not
 * there. For a surface fitted in one fault block, logging outside the block
 * counts as not logged.
 */
/**
 * The structural data a surface's contacts are read by: for a vein held to
 * the lie of the ground and following it, read as zones, its plane not
 * given, the direction of the ground from place to place (null: none).
 * `params`: of the surface, or none for one not made yet.
 */
export function followedBy(surface: { rule: SurfaceRule; params: Pick<SurfaceObject['params'], 'trend' | 'trendSets' | 'trendOwn' | 'trendLayers'> }): TrendField | null {
    const rule = surface.rule;
    if (rule.kind !== 'body' || surface.params.trend === false) return null;
    // (... and for an intrusion of thin sheets whose plane is not given)
    const reads = rule.vein ? !!rule.vein.held && (rule.vein.join ?? 0) > 0 && !rule.vein.plane : !!rule.sheets && !rule.sheets.plane;
    return reads ? surfaceTrendField(surface) : null;
}

export function contactInputsFor(surface: SurfaceObject): ContactInputs | null {
    const rule = surface.rule;
    if (rule.kind === 'sheet' || rule.kind === 'shell') return null;
    const data = useAppStore.getState().columnarData;
    const { coords, unitMaps } = useModelStore.getState().scene;
    // A surface that reads model units: the map's units, as grouped and given by hand (none: the map is gone)
    const map = rule.units ? unitMaps?.find(m => m.id === rule.units) ?? null : undefined;
    // The tables matter only to a surface that reads one
    const tables = (map ? map.table : rule.table) ? useDrillholeStore.getState().db : null;
    const memo = foundFor.get(surface.id);
    const limit = limitFor(surface);
    // (While a fault that limits it is being fitted: what it had)
    if (limit === 'wait' && memo) return memo.found;
    const mark = limit && limit !== 'wait' ? limit.mark : null;
    // (The structural data a vein follows says which plane its sheets lie in)
    const follows = followedBy(surface);
    if (memo && memo.data === data && memo.tables === tables && memo.coords === coords && memo.rule === surface.rule && memo.map === map && memo.limit === mark && memo.follows === follows) return memo.found;
    let log = map === null ? null : map ? unitLog(coords, map) : holeLog(coords, rule.column, rule.table ?? null);
    if (log && limit && limit !== 'wait') {
        const n = log.from.length;
        const xyz = new Float64Array(n * 3);
        for (let i = 0; i < n; i++) { xyz[i * 3] = log.x[i]; xyz[i * 3 + 1] = log.y[i]; xyz[i * 3 + 2] = log.z[i]; }
        const inside = limit.inside(xyz), code = log.code;
        log = { ...log, code: Array.from({ length: n }, (_, i) => (inside[i] ? code[i] : '')) };
    }
    const found = log ? foundAs(log, rule, follows) : null;
    if (limit !== 'wait') foundFor.set(surface.id, { data, tables, coords, rule: surface.rule, map, limit: mark, follows, found });
    return found;
}

/**
 * For a vein that is one of several its units make: what the logging gives
 * for the units with nothing picked out and nothing done by hand, every
 * stretch of them (veinSet.ts). Null for any other surface.
 */
export function setInputsFor(surface: SurfaceObject): ContactInputs | null {
    const rule = lodeRule(surface.rule);
    return rule ? contactInputsFor({ ...surface, id: `${surface.id}|set`, rule: setRule(rule) }) : null;
}

/** A proportion's shell fitted again without some holes: its pieces, and the plane of its sheets, from the logging of the rest */
async function shareWithout(surface: SurfaceObject, leftOut: ReadonlySet<string>): Promise<FittedField | 'as-is' | null> {
    const rule = surface.rule;
    if (rule.kind !== 'shell' || !rule.of) return 'as-is';
    const of = rule.of;
    const log = holeLog(useModelStore.getState().scene.coords, of.column, of.table ?? null);
    const domain = domainFor(surface), solids = solidsFor(surface);
    if (!log || domain === 'wait' || solids === 'wait') return 'as-is';
    const code = log.code;
    const kept = { ...log, code: Array.from({ length: log.from.length }, (_, i) => (leftOut.has(String(log.hole[i] ?? '')) ? '' : code[i])) };
    const all = shareSamples(kept, of);
    const ownFrame = !surface.params.trendOwn && (of.strength ?? SHARE_STRENGTH) > 1;
    const frame = ownFrame ? shareFrame(of, kept, sceneDataBox()) : null;
    const inputs = ruleInputs(domain ? samplesIn(all, domain) : solids ? samplesInSolids(all, solids) : all, rule, frame ? frame.stretch : stretchFor(surface), ownFrame ? null : layersFor(surface));
    const job = buildJob(surface, sceneDataBox(), 'final', inputs);
    if (!job) return null;
    if (job.type === 'shell' && solids) job.solids = { meshes: solids.meshes };
    if (job.type === 'shell' && domain) job.domain = { job: domain.job, topSense: domain.topSense, unit: domain.unit, ...(domain.units ? { units: domain.units } : {}), ...(domain.blocks ? { blocks: domain.blocks } : {}) };
    const out = await requestFit(`without:${surface.id}`, job);
    return out && out.ok ? out.field : null;
}

/**
 * A surface built from logging, fitted again as if some holes had not been
 * drilled: its field. (A proportion's shell is one such: its pieces are made
 * from the logging.) Everything else it is fitted from stays (points and
 * lines placed by hand, readings, what it ends on or runs alongside).
 * 'as-is': it is not built from logging, so leaving holes out changes
 * nothing. Null: without those holes there is nothing to fit it from.
 */
export async function fieldWithout(surfaceId: string, leftOut: ReadonlySet<string>): Promise<FittedField | 'as-is' | null> {
    const scene = useModelStore.getState().scene;
    const whole = scene.surfaces.find(s => s.id === surfaceId);
    if (whole && whole.rule.kind === 'shell' && whole.rule.of) return shareWithout(whole, leftOut);
    if (!whole || whole.rule.kind === 'sheet' || whole.rule.kind === 'shell') return 'as-is';
    const fitted = fittedSurface(whole);
    if (fitted === 'wait') return 'as-is';
    const surface = fitted.view, rule = whole.rule;
    const map = rule.units ? scene.unitMaps?.find(m => m.id === rule.units) ?? null : undefined;
    const log = map === null ? null : map ? unitLog(scene.coords, map) : holeLog(scene.coords, rule.column, rule.table ?? null);
    if (!log) return 'as-is';
    const limit = limitFor(surface);
    const n = log.from.length;
    let inside: ArrayLike<number> | null = null;
    if (limit && limit !== 'wait') {
        const xyz = new Float64Array(n * 3);
        for (let i = 0; i < n; i++) { xyz[i * 3] = log.x[i]; xyz[i * 3 + 1] = log.y[i]; xyz[i * 3 + 2] = log.z[i]; }
        inside = limit.inside(xyz);
    }
    const code = log.code;
    const kept = { ...log, code: Array.from({ length: n }, (_, i) => (leftOut.has(String(log.hole[i] ?? '')) || (inside && !inside[i]) ? '' : code[i])) };
    const found = foundAs(kept, rule, followedBy(surface));
    const end = endFor(surface), along = alongsideFor(surface);
    if (end === 'wait' || along === 'wait') return 'as-is';
    const job = buildJob(surface, sceneDataBox(), 'final', found, stretchFor(surface), guidesForSurface(surface), end, along);
    if (!job) return null;
    const layers = job.type === 'body' ? layersFor(surface) : null;
    if (job.type === 'body' && layers) { job.layers = layers; job.stretch = null; }
    // (Its own slot: the surface's real fit is not disturbed)
    const out = await requestFit(`without:${surfaceId}`, job);
    return out && out.ok ? out.field : null;
}

/**
 * The space a surface is fitted in when it follows the model's structure:
 * stretched across it, about the middle of the data. Null when no structure
 * is set, the surface does not follow it, or it is of a kind that takes its
 * shape from its own points (a sheet, a contact). The direction is the
 * surface's own when it has one (`params.trendOwn`), else the model's.
 */
export function stretchFor(surface: SurfaceObject): Stretch | null {
    const overall = overallFor(surface);
    if (!overall || surface.params.trend === false || (surface.rule.kind !== 'shell' && surface.rule.kind !== 'body')) return null;
    const box = sceneDataBox();
    return structureStretch(overall, box ? [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2] : [0, 0, 0]);
}

/** The one direction a surface follows: its own when it has one, else the model's (null: neither) */
export function overallFor(surface: SurfaceObject): OverallStructure | null {
    return surface.params.trendOwn ?? useModelStore.getState().scene.structure?.overall ?? null;
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

const setMarks = new WeakMap<object, number>();
let setsMarked = 0;
const ownFields = new Map<string, TrendField | null>();

/** The model whose layers a surface follows (`params.trendLayers`): null when it follows none, is of a kind that cannot, or the model is gone */
function layersModel(surface: { rule?: SurfaceRule; params: Pick<SurfaceObject['params'], 'trendLayers'> }): GeoModel | null {
    const id = surface.params.trendLayers;
    if (!id || (surface.rule && surface.rule.kind !== 'body' && surface.rule.kind !== 'shell')) return null;
    return useModelStore.getState().scene.models?.find(m => m.id === id) ?? null;
}

/**
 * The surfaces whose fitted meshes say how a model's layers lie: its
 * contacts between layers that are in use and are fitted surfaces, each as
 * its parts where it is fitted in each fault block apart. A surface that
 * itself follows the layers of a model is no layer to follow (nothing then
 * waits on itself).
 */
function layerSurfaces(model: GeoModel): SurfaceObject[] {
    const scene = useModelStore.getState().scene;
    const out: SurfaceObject[] = [];
    for (const c of model.contacts) {
        if (c.kind === 'intrusion' || c.off || !c.surface) continue;
        const whole = scene.surfaces.find(s => s.id === c.surface);
        if (!whole || whole.params.trendLayers) continue;
        const parts = splitsByBlock(model, c) ? partsOf(scene, model.id, c.surface) : [];
        out.push(...(parts.length > 0 ? parts : [whole]));
    }
    return out;
}

const layerFields = new Map<string, { mark: string; field: TrendField | null }>();

/**
 * How the layers of a model lie from place to place, as its contacts are
 * fitted now (modelLayers.ts): plane readings taken off their meshes, as a
 * direction field. `own`: the one direction away from them and the
 * strengths, where the surface has its own. 'wait': a contact is still being
 * fitted. Null: the model has no layer contact with a mesh. Kept while the
 * contacts' fits are what they were.
 */
function modelLayersField(model: GeoModel, own: OverallStructure | null): TrendField | 'wait' | null {
    const fits = useModelCache.getState().byId;
    const meshes: { vertices: Float64Array; triangles: Uint32Array }[] = [];
    let mark = JSON.stringify(own);
    for (const s of layerSurfaces(model)) {
        const fit = fits[s.id];
        if (!fit || fit.state === 'fitting') return 'wait';
        if (!fit.part || fit.part.triangles.length === 0) continue;
        meshes.push(fit.part);
        mark += `|${fit.key}`;
    }
    const memo = layerFields.get(model.id);
    if (memo && memo.mark === mark) return memo.field;
    const { readings } = layerReadings(meshes);
    const field = readings.length > 0
        ? buildTrendField([{ id: 'layers', name: model.name, kind: 'plane', source: 'suggested', color: '', visible: false, readings: readings.map((r, i) => ({ id: `l${i}`, ...r })) }], own, null)
        : null;
    if (layerFields.size >= 24) layerFields.clear();
    layerFields.set(model.id, { mark, field });
    return field;
}

/** Whether a surface that follows the layers of a model must wait for one of that model's contacts to be fitted */
function layersPending(surface: SurfaceObject): boolean {
    if (surface.params.trend === false) return false;
    const model = layersModel(surface);
    return !!model && modelLayersField(model, surface.params.trendOwn ?? null) === 'wait';
}

/**
 * The direction of the ground from place to place as a surface follows it
 * (Phase 247). The scene's, unless the surface has structural data of its
 * own choosing (`params.trendSets`: those sets and no others, whether or
 * not the model follows them) or a direction of its own
 * (`params.trendOwn`, in place of the model's away from the readings).
 * Surfaces with the same choice share one; kept while the sets, the
 * direction and the range are what they were.
 */
export function surfaceTrendField(surface: { rule?: SurfaceRule; params: Pick<SurfaceObject['params'], 'trendSets' | 'trendOwn' | 'trendLayers'> }): TrendField | null {
    const chosen = surface.params.trendSets ?? null, own = surface.params.trendOwn ?? null;
    // The layers of a model, in place of structural data (Phase 267). (While one of its contacts is being fitted: as it was)
    const model = layersModel(surface);
    if (model) {
        const field = modelLayersField(model, own);
        return field === 'wait' ? layerFields.get(model.id)?.field ?? null : field;
    }
    if (!chosen && !own) return sceneTrendField();
    const structure = useModelStore.getState().scene.structure;
    const overall = own ?? structure?.overall ?? null, range = structure?.range ?? null;
    const sets = chosenSets(structure?.sets, chosen);
    const mark = `${sets.map(s => { let m = setMarks.get(s); if (!m) { m = ++setsMarked; setMarks.set(s, m); } return m; }).join(',')}|${JSON.stringify(overall)}|${range}`;
    if (ownFields.has(mark)) return ownFields.get(mark)!;
    // (Its own choice of sets is followed whether or not the model follows them)
    const field = buildTrendField(sets.map(s => (s.follow === false ? { ...s, follow: true } : s)), overall, range);
    if (ownFields.size >= 24) ownFields.clear();
    ownFields.set(mark, field);
    return field;
}

const potentials = new WeakMap<TrendField, Potential | null>(), plunges = new WeakMap<TrendField, Potential | null>();

/** The height through the layers that a direction field's plane readings give (frame.ts). Null without any. Kept with the field */
export function potentialOf(field: TrendField | null): Potential | null {
    if (!field) return null;
    if (!potentials.has(field)) potentials.set(field, field.planes > 0 ? buildPotential(planeNodes(field), field.range) : null);
    return potentials.get(field)!;
}

/** How far across the plunge each place is, within the layers, as a direction field has them (frame.ts). Null without plane readings, or with nothing that says the ground has a long direction */
export function plungeOf(field: TrendField | null): Potential | null {
    if (!field) return null;
    if (!plunges.has(field)) plunges.set(field, field.planes > 0 ? buildPotential(acrossNodes(field), field.range) : null);
    return plunges.get(field)!;
}

/**
 * The height through the layers of the ground that the plane readings the
 * model follows give (frame.ts), as the scene is now. Null without any.
 * Kept until the readings change.
 */
export function scenePotential(): Potential | null {
    return potentialOf(sceneTrendField());
}

/**
 * How far across the plunge each place of the ground is, within its layers
 * (frame.ts): from the line readings the model follows and, away from
 * them, its own long direction, laid into the layers as the plane readings
 * give them. Null when the model follows no plane readings, or nothing
 * says the ground has a long direction. Kept until the readings change.
 */
export function scenePlunge(): Potential | null {
    return plungeOf(sceneTrendField());
}

/** (The same layers for the same heights and strengths: a fit's inputs are known again by what they are) */
const layersKept = new WeakMap<Potential, ShellLayers[]>();

const layerMarks = new WeakMap<object, string>();
/**
 * A mark for the layers a fit is made along: the same for the same readings
 * and strength, in this session and the next (a fit saved with the project
 * is known again by its key when the project is opened: fitFiles.ts)
 */
function layersMark(layers: ShellLayers): string {
    // (A fit that follows no plunge has the mark it had before there were any)
    return `${potentialMark(layers.potential)}:${layers.strength}${layers.second ? `+${potentialMark(layers.second.potential)}:${layers.second.strength}` : ''}`;
}

function potentialMark(potential: Potential): string {
    let mark = layerMarks.get(potential);
    if (!mark) {
        let h = 0x811c9dc5;
        for (const value of Object.values(potential) as unknown[]) {
            const bytes = ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : new TextEncoder().encode(JSON.stringify(value) ?? '');
            for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
            h = Math.imul(h ^ bytes.length, 0x01000193);
        }
        mark = (h >>> 0).toString(16);
        layerMarks.set(potential, mark);
    }
    return mark;
}

/**
 * For a shell or a closed body that follows the ground as the model's
 * readings say it lies from place to place: the height through the layers,
 * and how many times further things carry along the ground than across it
 * (as set with the model's one direction, else the usual). Null for any
 * other surface (a vein is built from its walls, and has no need), for one
 * that does not follow, and when the model follows no plane readings (it
 * then follows the model's one direction: `stretchFor`).
 *
 * With a long direction in the ground (line readings the model follows, or
 * the model's own plunge) the fit follows that from place to place as well
 * (`second`), as many times over as is set with the model's one direction,
 * else the usual. As with the one direction (structure.ts,
 * `structureStretch`), across the layers is never the easier way of the two.
 */
export function layersFor(surface: SurfaceObject): ShellLayers | null {
    if ((surface.rule.kind !== 'shell' && !(surface.rule.kind === 'body' && !surface.rule.vein)) || surface.params.trend === false) return null;
    // (As the surface follows it: its own structural data and direction when it has them, Phase 247)
    const field = surfaceTrendField(surface);
    const potential = potentialOf(field);
    if (!potential) return null;
    const overall = overallFor(surface);
    const plunge = plungeOf(field);
    const along = overall ? overall.lineStrength : DEFAULT_LINE_STRENGTH;
    const second = plunge && along > 1 ? { potential: plunge, strength: along } : null;
    const strength = Math.max(overall ? overall.strength : DEFAULT_STRENGTH, second ? second.strength : 1);
    if (!(strength > 1)) return null;
    const had = layersKept.get(potential) ?? [];
    let layers = had.find(l => l.strength === strength && (l.second?.potential ?? null) === (second?.potential ?? null) && (l.second?.strength ?? 0) === (second?.strength ?? 0));
    if (!layers) {
        layers = { potential, strength, ...(second ? { second } : {}) };
        layersKept.set(potential, [...had.slice(-7), layers]);
    }
    return layers;
}

const guidesFor = new Map<string, { points: unknown; polylines: unknown; follows: boolean; found: unknown; field: unknown; guides: GuideSamples | null }>();

/**
 * For a sheet or a contact: what the model's direction from place to place
 * says at its own places (guides.ts), as the scene is now. Null for a body
 * or a shell, for a surface that does not follow it, and when the readings
 * say nothing near it.
 */
export function guidesForSurface(surface: SurfaceObject): GuideSamples | null {
    if (surface.rule.kind === 'body' && surface.rule.vein?.held) {
        // A vein held to the lie of the ground: at the middles of its stretches, from the readings it follows and the plane of the middles
        const found = contactInputsFor(surface);
        const field = surface.params.trend !== false ? surfaceTrendField(surface) : null;
        const memo = guidesFor.get(surface.id);
        if (memo && memo.points === null && memo.found === found && memo.field === field) return memo.guides;
        // (Its sheets may lie another way than its stretches all together do: contacts.ts, `joinPlaneFrom`)
        const guides = found ? veinGuides(field, veinMiddles(found), found.joinPlane && found.joinPlaneFrom !== 'cloud' ? found.joinPlane : null) : null;
        guidesFor.set(surface.id, { points: null, polylines: null, follows: true, found, field, guides });
        return guides;
    }
    if (surface.rule.kind === 'body' || surface.rule.kind === 'shell') return null;
    const field = surfaceTrendField(surface);
    const follows = surface.params.trend !== false;
    if (!follows || !field || field.planes + field.lines === 0) return null;
    const found = contactInputsFor(surface);
    const memo = guidesFor.get(surface.id);
    if (memo && memo.points === surface.points && memo.polylines === surface.polylines && memo.follows === follows && memo.found === found && memo.field === field) return memo.guides;
    const guides = surfaceGuides(surface, found, field);
    guidesFor.set(surface.id, { points: surface.points, polylines: surface.polylines, follows, found, field, guides });
    return guides;
}

const shellFor = new Map<string, { data: unknown; tables: unknown; coords: SceneCoords | null; rule: SurfaceRule; stretch: string; layers: ShellLayers | null; domain: string | null; inputs: ShellInputs | null }>();

/**
 * For a shell: the places and values it is fitted to, from the dataset as
 * it is now. Null for any other surface, and when its column or the
 * coordinate columns are not there. One kept inside a unit of a model has
 * only the samples in that unit.
 */
export function shellInputsFor(surface: SurfaceObject): ShellInputs | null {
    const rule = surface.rule;
    if (rule.kind !== 'shell') return null;
    const data = useAppStore.getState().columnarData;
    const { coords } = useModelStore.getState().scene;
    const memo = shellFor.get(surface.id);
    // A proportion is carried along the plane of its units' sheets, worked out from their logging, unless a global trend of
    // its own is set for it, or it is to be carried evenly (it then follows the model's structure as any shell does)
    const of = rule.of ?? null;
    const ownFrame = !!of && !surface.params.trendOwn && (of.strength ?? SHARE_STRENGTH) > 1;
    const stretch = ownFrame ? null : stretchFor(surface), stretched = ownFrame ? 'own' : JSON.stringify(stretch), layers = ownFrame ? null : layersFor(surface);
    // (The tables matter only to a proportion read from one)
    const tables = of?.table ? useDrillholeStore.getState().db : null;
    const domain = domainFor(surface), solids = solidsFor(surface);
    // (While the model it is kept inside is being built, or a solid it is kept inside fitted: what it had)
    if (domain === 'wait' || solids === 'wait') return memo?.inputs ?? null;
    const within = domain?.mark ?? solids?.mark ?? null;
    if (memo && memo.data === data && memo.tables === tables && memo.coords === coords && memo.rule === rule && memo.stretch === stretched && memo.layers === layers && memo.domain === within) return memo.inputs;
    const log = of ? holeLog(coords, of.column, of.table ?? null) : null;
    const all = of ? log && shareSamples(log, of) : shellSamples(coords, rule.column);
    const samples = all && domain ? samplesIn(all, domain) : all && solids ? samplesInSolids(all, solids) : all;
    const frame = of && log && ownFrame ? shareFrame(of, log, sceneDataBox()) : null;
    let inputs = samples ? ruleInputs(samples, rule, frame ? frame.stretch : stretch, layers) : null;
    if (inputs && of && samples) {
        let sum = 0;
        for (let i = 0; i < samples.value.length; i++) sum += samples.value[i];
        inputs = { ...inputs, share: { pieces: samples.value.length, mean: samples.value.length > 0 ? sum / samples.value.length : 0, plane: frame?.plane ?? null, planeFrom: frame?.planeFrom ?? null, strength: frame?.strength ?? 1 } };
    }
    shellFor.set(surface.id, { data, tables, coords, rule, stretch: stretched, layers, domain: within, inputs });
    return inputs;
}

/**
 * The samples of a shell round values, as the data has them (every row of
 * its column, not composited or cut): only those in the ground it is kept
 * inside. 'wait': that ground is still being made. Null: not such a shell,
 * or its column is not there.
 */
export function shellSamplesFor(surface: SurfaceObject): ShellSamples | 'wait' | null {
    const rule = surface.rule;
    if (rule.kind !== 'shell' || rule.of) return null;
    const domain = domainFor(surface), solids = solidsFor(surface);
    if (domain === 'wait' || solids === 'wait') return 'wait';
    const all = shellSamples(useModelStore.getState().scene.coords, rule.column);
    return all && domain ? samplesIn(all, domain) : all && solids ? samplesInSolids(all, solids) : all;
}

/**
 * A shell's samples as the plunge finder takes them (plungeScan.ts): the
 * rows its column has, only those in the ground it is kept inside (a unit of
 * a model, or solids). 'wait': that ground is still being made. Null: not a
 * shell round values, or no hole and depth columns, or no samples there.
 */
export function shellPlungeSamples(surface: SurfaceObject): PlungeSamples | 'wait' | null {
    const samples = shellSamplesFor(surface);
    if (samples === 'wait') return 'wait';
    if (!samples || !samples.hole || samples.x.length === 0) return null;
    const ids = new Map<string, number>();
    const hole = new Int32Array(samples.x.length);
    for (let i = 0; i < hole.length; i++) {
        const name = String(samples.hole[i] ?? '').trim();
        let k = name ? ids.get(name) : -1;
        if (k === undefined) { k = ids.size; ids.set(name, k); }
        hole[i] = k ?? -1;
    }
    return { x: samples.x, y: samples.y, z: samples.z, value: samples.value, hole, depth: samples.from };
}

/** What the dataset gives a surface built from it: a shell's samples, or the contacts of one from logging. */
const inputsFor = (surface: SurfaceObject) => (surface.rule.kind === 'shell' ? shellInputsFor(surface) : contactInputsFor(surface));

/**
 * The key of a surface's fit as the scene is now (surfaceJobs.fitKey, of the
 * surface as it is fitted). 'wait': a fault that limits it is being fitted.
 */
function keyOf(surface: SurfaceObject, box: Box3 | null = sceneDataBox()): string | 'wait' {
    const fitted = fittedSurface(surface);
    if (fitted === 'wait') return 'wait';
    // (One that follows the layers of a model waits for that model's contacts)
    if (layersPending(surface)) return 'wait';
    const limit = surface.within ? limitFor(surface) : null;
    const domain = domainFor(fitted.view);
    if (domain === 'wait') return 'wait';
    const solids = solidsFor(fitted.view);
    if (solids === 'wait') return 'wait';
    const key = fitKey(fitted.view, box, inputsFor(fitted.view), stretchFor(fitted.view), guidesForSurface(fitted.view));
    const end = endFor(fitted.view);
    if (end === 'wait') return 'wait';
    // (A limit that leaves every place in is still a limit: the key says which)
    const along = alongsideFor(fitted.view);
    if (along === 'wait') return 'wait';
    // (A shell's layers are in the mark of its inputs; a body's are said here)
    const layers = fitted.view.rule.kind === 'body' ? layersFor(fitted.view) : null;
    return `${limit && limit !== 'wait' ? `${key}|within:${limit.mark}` : key}${end ? `|ends:${end.mark}` : ''}${along ? `|alongside:${along.mark}:${surface.conform?.by ?? ''}` : ''}${layers ? `|layers:${layersMark(layers)}` : ''}${domain ? `|domain:${domain.mark}` : ''}${solids ? `|solids:${solids.mark}` : ''}`;
}

/**
 * A surface has been fitted about an overall plane other than the one it
 * holds (its first fit, or its inputs now give one too far from the old):
 * the fit key the surface has once it holds the new plane. Null when it
 * already holds this one.
 */
function keyHolding(id: string, normal: Vec3): string | null {
    const now = useModelStore.getState().scene.surfaces.find(s => s.id === id);
    const was = now?.trendHeld;
    if (!now || (was && was[0] === normal[0] && was[1] === normal[1] && was[2] === normal[2])) return null;
    const key = keyOf({ ...now, trendHeld: normal });
    return key === 'wait' ? null : key;
}

/** A fit whose result is about to be put in the cache under this key: the scene with that key is not to be fitted again */
let landing: { id: string; key: string } | null = null;

/** The sides of a surface's lines, for all of them: 0 for one left out of the fit (`kept`: those fitted; null: all) */
function wholeSigns(signs: Int8Array, kept: number[] | null, lines: number): Int8Array {
    if (!kept) return signs;
    const out = new Int8Array(lines);
    kept.forEach((line, i) => { out[line] = signs[i] ?? 0; });
    return out;
}

async function fit(id: string, key: string, quality: FitQuality): Promise<void> {
    const whole = useModelStore.getState().scene.surfaces.find(s => s.id === id);
    const box = sceneDataBox();
    const fitted = whole ? fittedSurface(whole) : null;
    if (!whole || !fitted || fitted === 'wait') return;
    // The scene moved on while this was waiting
    // (A locked surface is fitted as it was when the fit was asked for: its key is not looked at again)
    if (!whole.locked && keyOf(whole, box) !== key) return;
    const surface = fitted.view;
    const found = inputsFor(surface), stretch = stretchFor(surface), guides = guidesForSurface(surface);
    const end = endFor(surface);
    if (end === 'wait') return;
    const along = alongsideFor(surface);
    if (along === 'wait') return;
    const job = buildJob(surface, box, quality, found, stretch, guides, end, along);
    // A body that follows the readings from place to place does so in place of the model's one direction
    const layers = job?.type === 'body' ? layersFor(surface) : null;
    if (job?.type === 'body' && layers) { job.layers = layers; job.stretch = null; }
    // A shell kept inside a unit of a model is cut off at that unit's faces; so is an intrusion of thin sheets
    if (job?.type === 'shell' || (job?.type === 'body' && takesDomain(surface.rule))) {
        const domain = domainFor(surface);
        if (domain === 'wait') return;
        if (domain) job.domain = { job: domain.job, topSense: domain.topSense, unit: domain.unit, ...(domain.units ? { units: domain.units } : {}), ...(domain.blocks ? { blocks: domain.blocks } : {}) };
        const solids = solidsFor(surface);
        if (solids === 'wait') return;
        if (solids) job.solids = { meshes: solids.meshes };
    }
    if (!job) {
        put(id, { key, state: 'empty', part: null, field: null, trend: null, lineSigns: null, status: null, stats: null, error: null });
        return;
    }
    // (It is in the list of what is being worked out from here until its answer is in the cache)
    let stopped = false;
    const listed = beginJob({
        kind: 'surface', object: keys.surface(id), name: whole.name, what: quality === 'draft' ? 'draft' : 'fit', waiting: true,
        // Stopped: it is as it was, and the worker it was in (if it had begun) is ended
        stop: () => { stopped = true; markStopped(id, key); stopFit(id); },
    });
    let out;
    try {
        out = await requestFit(id, job, {
            // One that has a fit and has been changed is being worked on: it goes before those never yet fitted
            urgent: quality === 'draft' || !!useModelCache.getState().byId[id]?.part,
            onStart: () => startJob(listed),
            onProgress: (done, of, step) => progressJob(listed, done, of, step),
        });
    } catch (e) {
        if (stopped) { endJob(listed, 'stopped'); return; }
        // What stopped it is kept, to be said where the surface is described and in the project tree
        const why = failureText(undefined, e);
        const wanted = useModelCache.getState().byId[id]?.key === key;
        if (wanted) put(id, { key, state: 'failed', part: null, field: null, trend: null, lineSigns: null, status: null, stats: null, error: why, shown: undefined });
        endJob(listed, wanted ? 'failed' : 'replaced', why);
        return;
    }
    if (stopped) { endJob(listed, 'stopped'); return; }
    // Replaced by a newer request, or the inputs changed while it ran
    if (!out || useModelCache.getState().byId[id]?.key !== key) { endJob(listed, 'replaced'); return; }
    // The surface changed while it ran in a way the cache could not be told of then (made conformable to one that was
    // itself being fitted: its key had to wait): this is the fit of a surface that is no more. What it is now is fitted
    // as soon as the other is.
    if (!whole.locked) {
        const now = useModelStore.getState().scene.surfaces.find(s => s.id === id);
        if (!now || keyOf(now) !== key) { queueMicrotask(syncSurfaceFits); endJob(listed, 'replaced'); return; }
    }
    if (!out.ok) {
        const failed = out.reason !== 'empty';
        put(id, { key, state: failed ? 'failed' : 'empty', part: null, field: null, trend: null, lineSigns: null, status: null, stats: null, error: failed ? failureText(out.why) : null, shown: undefined });
        // (Nothing to fit yet is not a fit that failed: it is not listed)
        endJob(listed, failed ? 'failed' : 'replaced', failed ? failureText(out.why) : null);
        return;
    }
    const final = quality === 'final';
    // The plane it was fitted about is the one its next fit is held to. The scene then says so, and what was
    // just fitted is the fit of that scene: nothing is fitted again
    // (One that runs alongside another has that one's plane, and holds none of its own)
    const held = final && out.status === 'sheet' && !along ? keyHolding(id, out.trend.normal) : null;
    if (held && out.status === 'sheet') {
        const normal = out.trend.normal;
        const now = useModelStore.getState().scene.surfaces.find(s => s.id === id);
        // Holding a plane for the first time changes nothing of the surface: columns written from it are still its columns
        const columns = now && !now.trendHeld && now.columns.writtenFor === keyMark(key) ? { columns: { ...now.columns, writtenFor: keyMark(held) } } : {};
        // (The scene is told first, so that whatever follows the fits sees the result with the scene it is the fit of)
        landing = { id, key: held };
        try {
            withoutHistory(() => asFollowing(() => useModelStore.getState().updateSurface(id, { trendHeld: [normal[0], normal[1], normal[2]], ...columns })));
        } finally {
            landing = null;
        }
    }
    put(id, {
        key: held ?? key, state: final ? 'ready' : 'fitting',
        part: partOf(whole, surface.name, out),
        field: out.field, trend: out.trend, lineSigns: wholeSigns(out.lineSigns, fitted.lines, whole.polylines.length), status: out.status, stats: out.stats,
        ...(final ? { lastMs: out.stats.ms } : {}), error: null,
        // (A draft is what is shown until the fit it is a draft of lands: stopped then, the draft is what it has)
        shown: final ? undefined : `${key}|draft`,
        // Locked, and fitted all the same (a project just opened): it says so when this is not the fit it was locked at
        lockMoved: !!whole.locked && !!whole.lockedKey && whole.lockedKey !== keyMark(held ?? key),
    });
    if (final) markLocked(id);
    // (Fitted to what it is now: a fit kept with the project for what it was is of no more use)
    if (final) saved.delete(id);
    // (The draft is not kept in the list: the fit that follows it is)
    endJob(listed, final ? 'done' : 'replaced');
    if (!final) await fit(id, key, 'final');
}

/**
 * A locked surface that has its fit is marked with it (`lockedKey`), so that
 * fitted again when the project is next opened it can tell whether it is
 * still the surface that was locked. Not a step to undo, and no fit follows.
 */
function markLocked(id: string): void {
    const surface = useModelStore.getState().scene.surfaces.find(s => s.id === id);
    const result = useModelCache.getState().byId[id];
    if (!surface?.locked || surface.lockedKey || result?.state !== 'ready') return;
    withoutHistory(() => asFollowing(() => useModelStore.getState().updateSurface(id, { lockedKey: keyMark(result.key) })));
    // (Locked as it is now: it is the fit it is locked at)
    if (result.lockMoved) put(id, { key: result.key, lockMoved: false });
}
const toMark = new Set<string>();
/** (From inside a change to the scene, the mark is written once the change is done) */
function markLockedSoon(id: string): void {
    if (toMark.size === 0) queueMicrotask(() => { const ids = [...toMark]; toMark.clear(); for (const one of ids) markLocked(one); });
    toMark.add(id);
}

/** What the cache holds of a fit that is ready: what is kept with the project, and read back from it (fitFiles.ts) */
export type SavedFit = Pick<SurfaceResult, 'key' | 'part' | 'field' | 'trend' | 'lineSigns' | 'status' | 'stats' | 'lastMs'>;

/** A surface's fit as it is to be kept with the project. Null: it has none that is finished (being fitted, a draft, nothing to fit, failed). */
export function fitToSave(id: string): SavedFit | null {
    const r = useModelCache.getState().byId[id];
    if (!r || r.state !== 'ready' || !r.part || !r.field || r.key.endsWith('|draft')) return null;
    return { key: r.key, part: r.part, field: r.field, trend: r.trend, lineSigns: r.lineSigns, status: r.status, stats: r.stats, lastMs: r.lastMs };
}

/**
 * Fits read from the project's folder and not yet taken: each is taken, in place of fitting, when its surface comes
 * to be fitted with that key (at once, or later: one that waits for a mesh to be read has no key until then), and
 * forgotten when the surface is fitted to another key, or is gone
 */
const saved = new Map<string, SavedFit>();
/** While a project is being opened nothing is fitted (this says there is more to come: jobs.holdBusy) */
let fitsHeld: (() => void) | null = null;

/**
 * A project is about to be opened: nothing is fitted until `releaseFits`,
 * so that the fits kept with it can be read first. Whoever holds must
 * release, whatever happens.
 */
export function holdFits(): void {
    if (!fitsHeld) fitsHeld = holdBusy();
}

/**
 * The project is open. `fits`: those kept with it, by surface. A surface
 * whose key is the key of its kept fit has that fit and is not fitted; a
 * locked one has the fit it was locked at, whatever has changed since. The
 * rest are fitted as ever.
 */
export function releaseFits(fits: ReadonlyMap<string, SavedFit> | null = null): void {
    saved.clear();
    if (fits) for (const [id, fit] of fits) saved.set(id, fit);
    const release = fitsHeld;
    fitsHeld = null;
    syncSurfaceFits();
    // (Whatever was begun is in the list before this says there is nothing more to come)
    release?.();
}

/** The fits kept with the project that have been taken: how many surfaces were not fitted on opening (for the tests and the probes) */
let taken = 0;
export const savedFitsTaken = (): number => taken;

/** Take the kept fit of a surface as its fit */
function takeSaved(id: string, fit: SavedFit): void {
    saved.delete(id);
    taken++;
    endPause(id);
    put(id, { ...fit, state: 'ready', error: null, stopped: undefined, shown: undefined, lockMoved: false });
}

/**
 * A fit was stopped by the user before it was done. The surface is what it
 * showed: the fit it had before, or the draft of this one, under the key
 * that is the fit of (so whatever is built on it is built on what is shown).
 * With nothing shown it has no fit. It is not fitted again until asked
 * (`refitSurface`) or until what it is fitted from changes.
 */
function markStopped(id: string, key: string): void {
    const now = useModelCache.getState().byId[id];
    if (!now || now.key !== key || now.state !== 'fitting') return;
    stoppedAt.set(id, key);
    if (now.shown) put(id, { key: now.shown, state: 'ready', stopped: true, shown: undefined });
    else put(id, { key: `${key}|stopped`, state: 'empty', stopped: true, shown: undefined, part: null, field: null, trend: null, lineSigns: null, status: null, stats: null, error: null });
}

/** Fit a surface whose fit was stopped: it is brought up to date now. */
export function refitSurface(id: string): void {
    stoppedAt.delete(id);
    syncSurfaceFits();
}

/** Bring the cache in step with the scene: refit what changed, forget what was removed. */
export function syncSurfaceFits(): void {
    // (A project is being opened: its kept fits are read first)
    if (fitsHeld) return;
    const { surfaces } = useModelStore.getState().scene;
    const box = sceneDataBox();
    const cache = useModelCache.getState().byId;

    const live = new Set(surfaces.map(s => s.id));
    const gone = Object.keys(cache).filter(id => !live.has(id));
    if (gone.length > 0) {
        for (const id of gone) {
            endPause(id);
            stoppedAt.delete(id);
            saved.delete(id);
            foundFor.delete(id);
            foundFor.delete(`${id}|set`);
            fittedFor.delete(id);
            shellFor.delete(id);
            guidesFor.delete(id);
        }
        useModelCache.setState(s => ({ byId: Object.fromEntries(Object.entries(s.byId).filter(([id]) => live.has(id))) }));
    }

    for (const surface of surfaces) {
        const prev = cache[surface.id];
        // Locked, and the fit it was locked at was kept with the project: it has that fit, whatever has changed since
        const kept = saved.get(surface.id);
        if (kept && surface.locked && !prev?.part && surface.lockedKey && keyMark(kept.key) === surface.lockedKey) {
            takeSaved(surface.id, kept);
            continue;
        }
        // Locked: it stays as it was last fitted, whatever has changed since (one never fitted, a project just opened, is fitted the once)
        if (surface.locked && prev && (prev.part || prev.state === 'fitting')) {
            if (!surface.lockedKey && prev.state === 'ready') markLockedSoon(surface.id);
            continue;
        }
        // (Unlocked, it is held to no fit)
        if (!surface.locked && prev?.lockMoved) put(surface.id, { key: prev.key, lockMoved: false });
        const key = keyOf(surface, box);
        // (One limited by a fault still being fitted stays as it is until the fault is)
        if (key === 'wait') continue;
        // Its fit was stopped: it waits to be asked, until what it is fitted from changes
        if (stoppedAt.has(surface.id)) {
            if (stoppedAt.get(surface.id) === key) continue;
            stoppedAt.delete(surface.id);
        }
        if (prev?.key === key || (landing?.id === surface.id && landing.key === key)) {
            // (Changed back to what the fit it shows is the fit of: it is up to date after all)
            if (prev?.stopped) put(surface.id, { key, stopped: undefined });
            continue;
        }
        // Its fit as it is now was kept with the project: it has that fit, and is not fitted
        if (kept && kept.key === key) {
            takeSaved(surface.id, kept);
            continue;
        }
        endPause(surface.id);
        // The previous mesh stays up until the new one arrives
        put(surface.id, { key, state: 'fitting', stopped: undefined, shown: prev?.state === 'ready' ? prev.key : prev?.state === 'fitting' ? prev.shown : undefined });
        const slow = (prev?.lastMs ?? 0) > FAST_MS;
        if (slow) {
            // (In the list as waiting, where it can be stopped: it is then as it was)
            const waits = beginJob({
                kind: 'surface', object: keys.surface(surface.id), name: surface.name, what: 'fit', waiting: true, step: 'for a pause in the editing',
                stop: () => { markStopped(surface.id, key); endJob(waits, 'stopped'); endPause(surface.id); },
            });
            pauses.set(surface.id, () => endJob(waits, 'replaced'));
            timers.set(surface.id, setTimeout(() => {
                // (Begun before the pause is over: there is no moment with nothing to come)
                const begun = fit(surface.id, key, 'draft');
                endPause(surface.id);
                void begun;
            }, pauseMs));
        } else {
            void fit(surface.id, key, 'final');
        }
    }
}

useModelStore.subscribe((state, prev) => {
    if (state.scene !== prev.scene) syncSurfaceFits();
});
// A surface fitted in a fault block follows the faults' fits (and the meshes of faults from files)
let again = false;
function limitedAgain() {
    if (again || !useModelStore.getState().scene.surfaces.some(s => s.within || s.conform || s.domain || s.params.trendLayers || (s.rule.kind === 'body' && s.rule.vein?.endsOn))) return;
    again = true;
    queueMicrotask(() => { again = false; syncSurfaceFits(); });
}
useModelCache.subscribe((state, prev) => { if (state.byId !== prev.byId) limitedAgain(); });
/** A model has been built, or is being: the shells kept inside its units follow */
export const builtModelsChanged = (): void => limitedAgain();
useWireframeFiles.subscribe((state, prev) => { if (state.byFile !== prev.byFile) limitedAgain(); });
useAppStore.subscribe((state, prev) => {
    // New data can move the box the surfaces are fitted in
    if (state.columnarData !== prev.columnarData && useModelStore.getState().scene.surfaces.length > 0) syncSurfaceFits();
});
