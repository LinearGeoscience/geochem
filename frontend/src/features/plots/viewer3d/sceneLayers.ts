/**
 * The model as a 3D view draws it (pure): meshes, surfaces, reading sets,
 * sets of points and lines, readings on offer and the overall direction,
 * each a layer with its key as id. What the view hides is left out, or (a
 * mesh or a surface, kept built so it comes back at once) drawn unseen.
 */
import { keys } from '../../model/objectKeys';
import { setMarks, setSize } from '../../model/inputs';
import { structureMark } from '../../model/structure';
import { setMark } from '../../model/structureReadings';
import type { Suggestion } from '../../model/suggest';
import { crossLines, IGNORED_COLOR } from '../../model/contactControl';
import type { ContactInputs } from '../../model/contacts';
import type { ModelResult } from '../../model/geoModelCache';
import { readModelField, type ModelOutput, type ReachField } from '../../model/geoModelJobs';
import { clipMeshByScalar } from '../../model/meshOps';
import { boxLines, contactMeshes, unitSolid } from '../../model/modelParts';
import type { FittedField } from '../../model/rbf';
import type { ModelScene, SurfaceObject } from '../../model/types';
import { thicknessShade } from '../../model/veinShade';
import { isSolidKey, layerLook, type ViewDisplay } from '../../model/viewDisplay';
import type { MeshLayer } from './ThreeViewport';
import { makePart, type WireframePart } from './wireframeParsers';

/** The mark of the model's structure is this share of the data's extent across */
const STRUCTURE_MARK = 0.18;
/** ... and the mark of one reading this share */
const READING_MARK = 0.03;
/** The cross at a point of a set of points, as a share of the data's size */
const POINT_MARK = 0.012;
/** A contact left out by hand: a cross this share of the data's size (it was 4.5%, a lattice of lines round a dyke set) */
const HAND_MARK = 0.012;
/** The marks of a set as drawn, kept while its readings (points, lines) and their size stay the same */
const marksKept = new WeakMap<object, { size: number; part: WireframePart }>();

function kept(of: object, size: number, make: () => WireframePart): WireframePart {
    let k = marksKept.get(of);
    if (!k || k.size !== size) {
        k = { size, part: make() };
        marksKept.set(of, k);
    }
    return k.part;
}

/** The meshes of the scene whose files are read (hidden ones drawn unseen) */
export function wireframeLayers(
    wireframes: ModelScene['wireframes'], files: Record<string, { parts: WireframePart[] } | undefined>, hidden: ReadonlySet<string>,
): MeshLayer[] {
    return wireframes.flatMap(w => {
        const part = files[w.file]?.parts[w.part];
        const id = keys.wireframe(w.id);
        return part ? [{ id, part, color: w.color, opacity: w.opacity, visible: !hidden.has(id), showEdges: w.showEdges }] : [];
    });
}

export interface SceneLayerInput {
    scene: ModelScene;
    /** The meshes, as wireframeLayers gives them */
    wireframes: readonly MeshLayer[];
    /** The surfaces' meshes, by surface id */
    fits: Record<string, { part?: WireframePart | null; field?: FittedField | null } | undefined>;
    /** The data's box and origin (local coordinates: world less the origin) */
    geometry: { bounds: { min: ArrayLike<number>; max: ArrayLike<number> }; origin: ArrayLike<number> } | null;
    /** The view shows the scene's coordinate columns */
    here: boolean;
    /** The view is one of the Modelling page's, or a plot's model list is up (the sets of points and lines and the overall direction are drawn then) */
    panelOpen: boolean;
    /** The surface being edited: its own sets are drawn by the editing */
    editingId: string | null;
    suggestion: Suggestion | null;
    /** The direction of the ground on the slice */
    trend: readonly MeshLayer[];
    hidden: ReadonlySet<string>;
    /** What is picked in the project tree (by key): drawn lit */
    picked?: ReadonlySet<string>;
    /** What the logging gives a surface made from it (its contacts left out by hand are drawn) */
    contactsOf?: (surface: SurfaceObject) => ContactInputs | null;
    /** The geological models as built, by model id */
    models?: Record<string, ModelResult | undefined>;
    /** What the view draws its own way, by object key (features/model/viewDisplay) */
    display?: ViewDisplay;
}

/** The parts of the models as drawn, kept while what they are made from is the same */
const modelKept = new WeakMap<object, Map<string, WireframePart>>();
function modelPart(of: object, name: string, make: () => WireframePart): WireframePart {
    let parts = modelKept.get(of);
    if (!parts) { parts = new Map(); modelKept.set(of, parts); }
    let part = parts.get(name);
    if (!part) { part = make(); parts.set(name, part); }
    return part;
}

/** How solid a unit's solid is drawn */
export const SOLID_OPACITY = 1;

/**
 * The geological models as built: the box of each, its units' solids, and
 * its contacts as the model cuts them (drawn where a view is told to: they
 * lie on the faces of the solids).
 */
export function modelLayers(scene: ModelScene, models: Record<string, ModelResult | undefined>, hidden: ReadonlySet<string>): MeshLayer[] {
    const out: MeshLayer[] = [];
    for (const g of scene.models ?? []) {
        const built = models[g.id];
        if (!built) continue;
        const id = keys.model(g.id);
        if (built.box && !hidden.has(id)) {
            const box = built.box;
            const part = modelPart(box, 'box', () => { const l = boxLines(box); return makePart(`${g.name}: boundary`, l.vertices, new Uint32Array(0), l.lines); });
            out.push({ id, part, color: '#455a64', opacity: 0, visible: true, showEdges: false });
        }
        const made = built.out;
        if (!made) continue;
        built.units.forEach((unit, u) => {
            const key = keys.volume(g.id, unit);
            const part = modelPart(made, `u${u}`, () => { const m = unitSolid(made, u); return makePart(`${g.name}: ${unit}`, m.vertices, m.triangles, new Uint32Array(0)); });
            if (part.triangles.length > 0) out.push({ id: key, part, color: built.colors[u] ?? '#9e9e9e', opacity: SOLID_OPACITY, visible: !hidden.has(key), showEdges: false });
        });
        built.contacts.forEach((contact, k) => {
            const key = keys.modelContact(g.id, contact);
            // (A contact fitted in each fault block apart is in the build once a block: it is drawn once, all of it)
            if (hidden.has(key) || built.contacts.indexOf(contact) !== k) return;
            const ks = built.contacts.flatMap((x, i) => (x === contact ? [i] : []));
            const c = g.contacts.find(x => x.id === contact);
            const surface = scene.surfaces.find(s => s.id === c?.surface);
            const part = modelPart(made, `c${ks.join('.')}`, () => { const m = contactMeshes(made, ks); return makePart(`${g.name}: ${surface?.name ?? 'contact'}`, m.vertices, m.triangles, new Uint32Array(0)); });
            if (part.triangles.length > 0) out.push({ id: key, part, color: surface?.color ?? '#607d8b', opacity: 1, visible: true, showEdges: false });
        });
        built.faults.forEach((fault, f) => {
            const key = keys.modelFault(g.id, fault);
            // (A fault that younger faults offset is in the build once a piece: it is drawn once, all of it)
            if (hidden.has(key) || built.faults.indexOf(fault) !== f) return;
            const fs = built.faults.flatMap((x, i) => (x === fault ? [made.faultFrom + i] : []));
            const surface = scene.surfaces.find(s => s.id === g.faults?.find(x => x.id === fault)?.surface);
            const part = modelPart(made, `f${fs.join('.')}`, () => { const m = contactMeshes(made, fs); return makePart(`${g.name}: ${surface?.name ?? 'fault'}`, m.vertices, m.triangles, new Uint32Array(0)); });
            if (part.triangles.length > 0) out.push({ id: key, part, color: surface?.color ?? '#b71c1c', opacity: 1, visible: true, showEdges: false });
        });
    }
    return out;
}

/** Every layer of the model in a view, the meshes first; those picked marked so */
export function sceneLayers(o: SceneLayerInput): readonly MeshLayer[] {
    const drawn = allLayers(o), display = o.display;
    // What the view draws its own way (solid, its edges, its outline; on a slice): over each object's own look; on a slice
    // a mesh has no thickness unless the view says (its line, a model's solid filled)
    const layers = drawn.map(l => layerLook(l, display, isSolidKey(o.scene, l.id)));
    const picked = o.picked;
    if (!picked || picked.size === 0 || !layers.some(l => picked.has(l.id))) return layers;
    return layers.map(l => (picked.has(l.id) ? { ...l, selected: true } : l));
}

function allLayers(o: SceneLayerInput): readonly MeshLayer[] {
    const { scene, geometry, hidden } = o;
    // Before the first surface the scene has no columns of its own yet: this view's will be its
    if (!o.here && scene.coords) return o.wireframes;
    const built: MeshLayer[] = [...o.trend];
    const extent = geometry
        ? Math.max(geometry.bounds.max[0] - geometry.bounds.min[0], geometry.bounds.max[1] - geometry.bounds.min[1], geometry.bounds.max[2] - geometry.bounds.min[2], 1)
        : 1;
    // The surfaces that have a part with a mesh in some fault block
    const split = new Set(scene.surfaces.flatMap(s => (s.blockOf && (o.fits[s.id]?.part?.triangles.length ?? 0) > 0 ? [s.blockOf] : [])));
    // In a model with a fault that stops: the fault's surface is drawn as far as it goes; and a contact fitted by block is
    // drawn as the model has it (towards the fault's end its parts are taken over into the contact with no fault
    // there, which no one of its fitted parts is)
    const stopsAt = new Map<string, ReachField>(), asBuilt = new Map<string, { out: ModelOutput; ks: number[] }>();
    for (const g of o.here ? scene.models ?? [] : []) {
        const built = o.models?.[g.id];
        const there = built?.job?.faults?.there;
        if (!built?.out || !there?.some(t => !!t)) continue;
        built.faults.forEach((fault, f) => {
            const surface = g.faults?.find(x => x.id === fault)?.surface;
            if (surface && there[f] && !stopsAt.has(surface)) stopsAt.set(surface, there[f]!);
        });
        for (const c of g.contacts) {
            const ks = built.contacts.flatMap((x, i) => (x === c.id ? [i] : []));
            if (c.surface && ks.length > 1 && !asBuilt.has(c.surface)) asBuilt.set(c.surface, { out: built.out, ks });
        }
    }
    for (const s of o.here ? scene.surfaces : []) {
        const id = keys.surface(s.id);
        const cut = asBuilt.get(s.blockOf ?? s.id);
        if (cut) {
            // (Under the surface's own key and eye: its parts are not drawn apart)
            if (s.blockOf) continue;
            const drawn = modelPart(cut.out, `s${cut.ks.join('.')}`, () => { const m = contactMeshes(cut.out, cut.ks); return makePart(s.name, m.vertices, m.triangles, new Uint32Array(0)); });
            if (drawn.triangles.length > 0) built.push({ id, part: drawn, color: s.color, opacity: s.opacity, visible: !hidden.has(id), showEdges: s.showEdges });
            continue;
        }
        // (A fault that stops, or a part of one on one side of a younger fault)
        const stop = stopsAt.get(s.blockOf ?? s.id), whole = o.fits[s.id]?.part;
        const part = stop && whole ? modelPart(whole, `stops:${stop.reach}`, () => {
            const there = readModelField(stop, whole.vertices);
            const m = clipMeshByScalar(whole, Float64Array.from(there, v => -v));
            return makePart(whole.name, m.vertices, m.triangles, new Uint32Array(0));
        }) : whole;
        // A surface a model fits in each fault block apart is drawn as its parts there (shown and hidden with it): the
        // surface through every block, smeared through the faults, is not what the model has
        if (split.has(s.id)) continue;
        const of = s.blockOf && split.has(s.blockOf) ? keys.surface(s.blockOf) : null;
        // (A vein coloured by how thick it is: only its mesh as fitted, which its field is the field of)
        const shade = s.shade === 'thickness' && part && part === whole ? thicknessShade(part, o.fits[s.id]?.field) : null;
        if (part && part.triangles.length > 0) built.push({ id, part, color: s.color, opacity: s.opacity, visible: !hidden.has(id) && !(of && hidden.has(of)), showEdges: s.showEdges, ...(shade ? { vertexColors: shade.colors } : {}) });
    }
    if (o.here && o.models) built.push(...modelLayers(scene, o.models, hidden));
    // What was measured of the lie of the ground, place by place
    if (o.here && geometry) {
        const size = READING_MARK * extent;
        for (const set of scene.structure?.sets ?? []) {
            const id = keys.readings(set.id);
            if (hidden.has(id)) continue;
            const part = kept(set.readings, size, () => {
                const mark = setMark(set, size);
                return makePart(set.name, mark.vertices, mark.triangles, mark.lines);
            });
            built.push({ id, part, color: set.color, opacity: 0.5, visible: true, showEdges: false });
        }
    }
    // The sets of points and lines, each in its colour, while the model is worked on or listed (those of the surface being edited are drawn by the editing)
    if (o.here && geometry && o.panelOpen) {
        const size = POINT_MARK * extent;
        const opened = new Set((scene.surfaces.find(s => s.id === o.editingId)?.uses ?? []).map(u => u.set));
        for (const set of scene.inputs ?? []) {
            const id = keys.inputs(set.id);
            if (hidden.has(id) || opened.has(set.id) || setSize(set) === 0) continue;
            const part = kept(set.kind === 'points' ? set.points : set.lines, size, () => {
                const mark = setMarks(set, size);
                return makePart(set.name, mark.vertices, new Uint32Array(0), mark.lines);
            });
            built.push({ id, part, color: set.color, opacity: 0, visible: true, showEdges: false });
        }
    }
    // Contacts left out by hand on the surfaces made from logging (the places and links put on them by hand are drawn
    // by the view itself, a size on the screen, while their surface is picked or edited: useHandControls)
    if (o.here && geometry && o.panelOpen) {
        const size = HAND_MARK * extent;
        for (const s of scene.surfaces) {
            if (s.rule.kind !== 'contact' && s.rule.kind !== 'body') continue;
            const control = s.rule.control;
            if (!control || hidden.has(keys.surface(s.id))) continue;
            const out = control.edits?.some(e => e.ignore) ? o.contactsOf?.(s)?.list.filter(c => c.state === 'ignored') ?? [] : [];
            if (out.length > 0) {
                const mark = crossLines(out.flatMap(c => c.p), size);
                built.push({
                    id: `ignored:${s.id}`, part: makePart(`${s.name}: contacts left out`, mark.vertices, new Uint32Array(0), mark.lines),
                    color: IGNORED_COLOR, opacity: 0, visible: true, showEdges: false,
                });
            }
        }
    }
    // Readings on offer, as ghosts: grey until they are kept
    if (o.here && geometry && o.suggestion) {
        const size = READING_MARK * extent;
        o.suggestion.sets.forEach((set, i) => {
            const part = kept(set.readings, size, () => {
                const mark = setMark(set, size);
                return makePart(set.name, mark.vertices, mark.triangles, mark.lines);
            });
            built.push({ id: `suggested:${i}`, part, color: '#616161', opacity: 0.25, visible: true, showEdges: true });
        });
    }
    // The structure the surfaces follow, drawn in the middle of the data while the model is worked on or listed
    const overall = scene.structure?.overall ?? null;
    if (overall && o.panelOpen && geometry && !hidden.has(keys.structure)) {
        const { bounds: b, origin: g } = geometry;
        const centre: [number, number, number] = [(b.min[0] + b.max[0]) / 2 + g[0], (b.min[1] + b.max[1]) / 2 + g[1], (b.min[2] + b.max[2]) / 2 + g[2]];
        const mark = structureMark(overall, centre, STRUCTURE_MARK * extent);
        built.push({ id: keys.structure, part: makePart('Structure', mark.vertices, mark.triangles, mark.lines), color: '#37474f', opacity: 0.35, visible: true, showEdges: true });
    }
    return built.length > 0 ? [...o.wireframes, ...built] : o.wireframes;
}
