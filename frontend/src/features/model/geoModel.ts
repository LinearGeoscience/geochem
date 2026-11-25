/**
 * The geological model (pure): a boundary, a base unit and contacts in age
 * order, each a surface with a type and a young side. From these one rule
 * says which unit is at any place; cut surfaces, unit solids, flagged
 * samples and section fills are all read from it, so they cannot disagree.
 *
 * The rule walks the contacts from the oldest to the youngest, keeping the
 * unit so far and whether the place is in the top of the layered pile so far
 * (so that a later deposit can reach it):
 *
 *              on its young side                 on its old side
 *   deposit    in the top: its unit              no longer in the top
 *   erosion    its unit; in the top              no longer in the top
 *   intrusion  its unit; no longer in the top    nothing
 *
 * It starts in the base unit, in the top. A deposit is laid on what was
 * there and cuts nothing older; an erosion surface cuts everything older; an
 * intrusion cuts everything older and is not buried by later deposits (only
 * a later erosion or intrusion cuts it).
 *
 * A surface's field is positive on its first side (a closed body: inside).
 */
import { sideNames as planeSides } from './plane';
import { UNIT_COLORS } from './units';
import { faultNet, type FaultEnd } from './faults';
import type { ContactKind, FaultSide, GeoModel, ModelContact, ModelFault, ModelScene, ModelUnitLook, SurfaceObject } from './types';

export const MAX_MODELS = 12;
export const MAX_CONTACTS = 60;
/** (Fault blocks are told apart by which side of each fault they are on: every fault can double them) */
export const MAX_FAULTS = 8;
export const CONTACT_KINDS: readonly ContactKind[] = ['deposit', 'erosion', 'intrusion'];

export const KIND_NAME: Record<ContactKind, string> = { deposit: 'Deposit', erosion: 'Erosion', intrusion: 'Intrusion' };
export const KIND_TIP: Record<ContactKind, string> = {
    deposit: 'Laid on what was there: it cuts nothing older, and stops against older contacts',
    erosion: 'Cuts away everything older on its younger side',
    intrusion: 'Cuts through everything older; later deposits do not bury it',
};

/** One step of the rule: the type, and the sign of the field on the young side */
export interface RuleStep { kind: ContactKind; young: 1 | -1 }

/**
 * Which unit is at each of `n` places. `steps`: the contacts, oldest first.
 * `values[k]`: the field of contact k at the places. Gives, per place, the
 * number of the contact whose unit is there (-1: the base unit).
 */
export function unitsAt(steps: readonly RuleStep[], values: readonly ArrayLike<number>[], n: number, out: Int16Array = new Int16Array(n)): Int16Array {
    out.fill(-1);
    const top = new Uint8Array(n).fill(1);
    for (let k = 0; k < steps.length; k++) {
        const { kind, young } = steps[k];
        const f = values[k];
        if (kind === 'deposit') {
            for (let i = 0; i < n; i++) {
                if (young * f[i] > 0) { if (top[i]) out[i] = k; } else top[i] = 0;
            }
        } else if (kind === 'erosion') {
            for (let i = 0; i < n; i++) {
                if (young * f[i] > 0) { out[i] = k; top[i] = 1; } else top[i] = 0;
            }
        } else {
            for (let i = 0; i < n; i++) if (young * f[i] > 0) { out[i] = k; top[i] = 0; }
        }
    }
    return out;
}

/** The rule at one place (the same as `unitsAt`, for one) */
export function unitAt(steps: readonly RuleStep[], values: ArrayLike<number>): number {
    let u = -1, top = true;
    for (let k = 0; k < steps.length; k++) {
        const on = steps[k].young * values[k] > 0;
        if (steps[k].kind === 'deposit') { if (on) { if (top) u = k; } else top = false; }
        else if (steps[k].kind === 'erosion') { if (on) u = k; top = on; }
        else if (on) { u = k; top = false; }
    }
    return u;
}

/**
 * What a unit is built as in a model made from a list of units: a layer laid
 * down or cut in; an intrusion (one closed body); thin sheets side by side as
 * an intrusion of thin sheets (`sheets`: its logging held as it is, drawn near
 * its holes), as one vein from its two walls (`vein`) or as a vein system
 * (`veinSystem`: a vein of each sheet that can be told apart); or not in the
 * model.
 */
export type UnitPlan = ContactKind | 'vein' | 'sheets' | 'veinSystem' | 'none';

/** Whether a unit built that way cuts across the layers (it is not one of them) */
export const cutsAcross = (plan: UnitPlan | undefined): boolean => plan === 'intrusion' || plan === 'vein' || plan === 'sheets' || plan === 'veinSystem';

/** A contact to be made for a unit: between the layers above and below it, or round an intrusion */
export interface ContactProposal {
    unit: string;
    kind: ContactKind;
    /** A contact between layers: the units on its young side (this unit and every younger layer) and on its old side */
    sideA: string[];
    sideB: string[];
    /** A closed body round an intrusion: the units inside it, and those that say nothing either way */
    inside?: string[];
    ignore: string[];
    /** The body is a vein or a dyke: thin, and built from its two walls */
    vein?: boolean;
    /** ... and it is to be told apart into the veins of a vein system, a contact of each */
    system?: boolean;
    /** The body is an intrusion of thin sheets */
    sheets?: boolean;
}

/**
 * A list of units as it stands before anyone has put it in order: the units
 * that cut across the layers first (the youngest: with nothing said of its
 * age an intrusion cuts everything), then the rest as listed.
 */
export function cuttersFirst(units: readonly string[], plan: Readonly<Record<string, UnitPlan | undefined>>): string[] {
    return [...units.filter(u => cutsAcross(plan[u])), ...units.filter(u => !cutsAcross(plan[u]))];
}

/**
 * The contacts a list of units gives. `units`: in order down the holes, the
 * youngest first. `plan`: what each is (absent: a deposit).
 *
 * The layers (deposits and erosion surfaces) keep their order: the oldest is
 * the base, and every other has a contact at its bottom, with itself and
 * every younger layer on the young side and every older layer on the old
 * side. An intrusion is a closed body round its own unit, and its age is its
 * place in the list: it cuts everything listed under it, and is cut by an
 * erosion surface or an intrusion listed over it (a deposit over it does
 * not bury it). Intrusions and units left out say nothing about where a
 * contact between layers lies: they are on neither of its sides.
 *
 * The proposals come oldest first.
 */
export function contactsFromUnits(units: readonly string[], plan: Readonly<Record<string, UnitPlan | undefined>>): { base: string | null; proposals: ContactProposal[] } {
    const kindOf = (u: string): UnitPlan => plan[u] ?? 'deposit';
    const layers = units.filter(u => kindOf(u) === 'deposit' || kindOf(u) === 'erosion');
    const left = units.filter(u => kindOf(u) === 'none');
    const proposals: ContactProposal[] = [];
    for (const u of [...units].reverse()) {
        const as = kindOf(u);
        const i = layers.indexOf(u);
        // (The oldest layer is the base: it has no contact of its own)
        if (i >= 0 && i < layers.length - 1) proposals.push({ unit: u, kind: as as ContactKind, sideA: layers.slice(0, i + 1), sideB: layers.slice(i + 1), ignore: [] });
        if (as === 'intrusion' || as === 'sheets') proposals.push({ unit: u, kind: 'intrusion', sideA: [], sideB: [], inside: [u], ignore: left, ...(as === 'sheets' ? { sheets: true } : {}) });
        // (A vein or a dyke cuts what it is in, as an intrusion does)
        if (as === 'vein' || as === 'veinSystem') proposals.push({ unit: u, kind: 'intrusion', sideA: [], sideB: [], inside: [u], ignore: left, vein: true, ...(as === 'veinSystem' ? { system: true } : {}) });
    }
    return { base: layers.length ? layers[layers.length - 1] : null, proposals };
}

/**
 * The runs of layers laid down one on another, as surface ids, the youngest
 * first: the contacts of deposits that follow one another in the age order.
 * An erosion surface cuts what is under it and ends a run (it is in none);
 * an intrusion between two layers does not. Contacts left out, fixed meshes
 * and surfaces that cannot run alongside another (`usable`) are passed over.
 * Only runs of two or more are given.
 */
export function layerRuns(contacts: readonly ModelContact[], usable: (surface: string) => boolean): string[][] {
    const runs: string[][] = [];
    let run: string[] = [];
    const close = () => { if (run.length > 1) runs.push(run); run = []; };
    for (const c of contacts) {
        if (c.off || c.kind === 'intrusion') continue;
        if (c.kind === 'erosion') { close(); continue; }
        if (c.surface && usable(c.surface) && !run.includes(c.surface)) run.push(c.surface);
    }
    close();
    return runs;
}

/**
 * A run of layers as a chain: the one with the most places to go by
 * (`counts`, in step with the run) is fitted on its own, and every other
 * runs alongside its neighbour towards that one. So no two can cross.
 */
export function chainOf(run: readonly string[], counts: readonly number[]): { surface: string; alongside: string | null }[] {
    let ref = 0;
    for (let i = 1; i < run.length; i++) if ((counts[i] ?? 0) > (counts[ref] ?? 0)) ref = i;
    return run.map((surface, i) => ({ surface, alongside: i === ref ? null : run[i < ref ? i + 1 : i - 1] }));
}

/** A contact as the model can use it: its surface (or mesh) is in the project and it has a unit */
export function contactProblem(scene: Pick<ModelScene, 'surfaces' | 'wireframes'>, c: ModelContact): string | null {
    if (c.mesh) {
        if (!scene.wireframes.some(w => w.id === c.mesh)) return 'Its mesh is no longer in the project.';
    } else {
        const surface = scene.surfaces.find(s => s.id === c.surface);
        if (!surface) return 'Its surface is no longer in the project.';
        if (surface.rule.kind === 'shell') return 'A shell round values is not a contact between units.';
    }
    if (!c.unit) return 'It has no unit on its younger side yet.';
    return null;
}

/** What is wrong with a fault of a model (null: nothing) */
export function faultProblem(scene: Pick<ModelScene, 'surfaces' | 'wireframes'>, fault: ModelFault): string | null {
    if (fault.mesh) return scene.wireframes.some(w => w.id === fault.mesh) ? null : 'Its mesh is no longer in the project.';
    const surface = scene.surfaces.find(s => s.id === fault.surface);
    if (!surface) return 'Its surface is no longer in the project.';
    if (surface.rule.kind === 'shell' || surface.rule.kind === 'body') return 'A closed surface is not a fault.';
    return null;
}

/** The faults a model is cut by: those switched on and usable, in the model's order */
export function activeFaults(scene: Pick<ModelScene, 'surfaces' | 'wireframes'>, model: GeoModel): ModelFault[] {
    return (model.faults ?? []).filter(x => !x.off && faultProblem(scene, x) === null);
}

/**
 * Whether a fault's extent is used: it is told to stop, in a model that fits
 * its contacts in each fault block apart itself, none of them split by hand
 * on this fault. (A contact the model fits itself can be taken over, towards
 * the fault's end, into the contact with the fault not there. Two surfaces
 * made by hand cannot.) One that another fault ends on runs through as
 * well (the network of faults has the same rule: faults.ts), and so does
 * one after the first three that stop.
 */
export function faultStops(model: GeoModel, fault: ModelFault): boolean {
    return mayStop(model, fault) && (model.faults ?? []).filter(x => mayStop(model, x)).findIndex(x => x.id === fault.id) < MAX_STOPPING;
}

/**
 * At most this many faults of a model stop (the first so many of its list):
 * each one makes three pieces of ground of every piece there was, and a
 * contact is fitted in every one of them.
 */
export const MAX_STOPPING = 3;

const mayStop = (model: GeoModel, fault: ModelFault): boolean => !!fault.extent && !fault.off && !!model.byBlock
    && !model.contacts.some(c => c.within?.some(e => e.fault === fault.id))
    && !(model.faults ?? []).some(x => x.id !== fault.id && !x.off && x.ends?.some(e => e.fault === fault.id))
    && !offsetBy(model, fault) && !offsetting(model, fault);

/** A fault of the model, in use, that this one is set to be offset by (undefined: none) */
const offsetting = (model: GeoModel, fault: ModelFault): ModelFault | undefined => (fault.surface ? (model.faults ?? []).find(x => x.id !== fault.id && !x.off && !!fault.cutBy?.includes(x.id)) : undefined);

/** A fault of the model, in use, that this one is set to offset (undefined: none) */
const offsetBy = (model: GeoModel, fault: ModelFault): ModelFault | undefined => (model.faults ?? []).find(x => x.id !== fault.id && !x.off && !!x.surface && !!x.cutBy?.includes(fault.id));

/** Why a fault told to stop runs through the model all the same, in words (null: it stops, or was not told to) */
export function stopProblem(scene: Pick<ModelScene, 'surfaces' | 'wireframes'>, model: GeoModel, fault: ModelFault): string | null {
    if (!fault.extent) return null;
    if (!model.byBlock) return 'It runs through for now: a fault stops only in a model that fits each contact in each fault block apart (the tick below).';
    if (model.contacts.some(c => c.within?.some(e => e.fault === fault.id))) return 'It runs through for now: a contact was split by hand on this fault, and a fault stops only where the model fits both sides of it itself.';
    const other = activeFaults(scene, model).find(x => x.id !== fault.id && x.ends?.some(e => e.fault === fault.id));
    if (other) {
        const name = scene.surfaces.find(s => s.id === other.surface)?.name ?? scene.wireframes.find(w => w.id === other.mesh)?.name ?? 'Another fault';
        return `It runs through for now: ${name} ends on it, and a fault that another ends on does not stop.`;
    }
    const older = offsetBy(model, fault);
    if (older && !fault.off) return `It runs through for now: ${scene.surfaces.find(s => s.id === older.surface)?.name ?? 'another fault'} is offset by it, and a fault that offsets another does not stop.`;
    const younger = offsetting(model, fault);
    if (younger && !fault.off) return `It runs through for now: it is offset by ${scene.surfaces.find(s => s.id === younger.surface)?.name ?? scene.wireframes.find(w => w.id === younger.mesh)?.name ?? 'another fault'}, and a fault that another offsets does not stop.`;
    if (!fault.off && !faultStops(model, fault)) return 'It runs through for now: at most three faults of a model stop, and three before it do already.';
    return null;
}

/**
 * The names of a model's fault blocks, by the sides of its faults each is on:
 * "east of Main fault, north of Splay"; past the end of a fault that stops,
 * "past the end of Splay". `faults`: the faults by id, in the order of
 * `blocks`' sides (a build's). A model in one piece: "The whole model".
 */
export function blockNames(scene: Pick<ModelScene, 'surfaces' | 'wireframes'>, model: GeoModel, faults: readonly string[], blocks: readonly (readonly number[])[]): string[] {
    const own = faults.map(id => model.faults?.find(x => x.id === id));
    // (As the network of faults has it: one that another ends on does not stop)
    const stops = own.map((x, f) => !!x && faultStops(model, x) && !own.some((o, g) => g !== f && o?.ends?.some(e => e.fault === x.id)));
    return blocks.map(signs => {
        const parts = faults.flatMap((id, f) => {
            // (A fault that younger ones offset is in the list once a piece, and a block has at most one of its pieces: it is said once)
            if (faults.indexOf(id) !== f) return [];
            const fault = own[f];
            const surface = scene.surfaces.find(s => s.id === fault?.surface);
            const name = surface?.name ?? scene.wireframes.find(w => w.id === fault?.mesh)?.name ?? 'a fault';
            const there = faults.findIndex((x, g) => x === id && signs[g] !== 0);
            if (there < 0) {
                // Not there. Of a fault that ends on another, on the far side of that one, nothing is said; of one that has stopped, that it has
                const farSide = (fault?.ends ?? []).some(e => faults.some((x, g) => x === e.fault && signs[g] !== 0 && signs[g] !== e.side));
                return stops[f] && !farSide ? [`past the end of ${name}`] : [];
            }
            return [sideOf(sideNames(surface, !!fault?.mesh)[signs[there] > 0 ? 0 : 1], name)];
        });
        return parts.length > 0 ? parts.join(', ') : 'The whole model';
    });
}

/** The contacts the rule is run with, oldest first: those switched on and usable */
export function activeContacts(scene: Pick<ModelScene, 'surfaces' | 'wireframes'>, model: GeoModel): ModelContact[] {
    return [...model.contacts].reverse().filter(c => !c.off && contactProblem(scene, c) === null);
}

/** The units a model is made of, oldest first: its base, then each active contact's (each once) */
export function modelUnits(scene: Pick<ModelScene, 'surfaces' | 'wireframes'>, model: GeoModel): string[] {
    const out = [model.base];
    for (const c of activeContacts(scene, model)) if (!out.includes(c.unit)) out.push(c.unit);
    return out;
}

/** A unit's colour: as set on the model, else as in the unit map it reads, else from the palette */
export function unitColor(scene: Pick<ModelScene, 'unitMaps'>, model: GeoModel, unit: string): string {
    const own = model.units.find(u => u.name === unit)?.color;
    if (own) return own;
    const mapped = scene.unitMaps?.find(m => m.id === model.unitMap)?.units.find(u => u.name === unit)?.color;
    if (mapped) return mapped;
    let h = 0;
    for (let i = 0; i < unit.length; i++) h = (h * 31 + unit.charCodeAt(i)) >>> 0;
    return UNIT_COLORS[h % UNIT_COLORS.length];
}

/** The names of a surface's two sides as the model's lists show them */
export function sideNames(surface: SurfaceObject | undefined, mesh = false): [string, string] {
    // A fixed mesh (meshField.ts): positive above it, or inside it when it is closed
    if (mesh) return ['above it (inside it, if it is closed)', 'below it (outside it, if it is closed)'];
    if (!surface) return ['first side', 'second side'];
    if (surface.sides) return surface.sides;
    if (surface.rule.kind === 'body' || surface.rule.kind === 'shell') return ['inside', 'outside'];
    if (surface.rule.kind === 'contact') return [`${surface.rule.sideA.join(', ') || 'first'} side`, `${surface.rule.sideB.join(', ') || 'second'} side`];
    // By where they are: the way its overall plane faces, once it has been fitted
    const facing = surface.trendHeld ?? surface.refDirection;
    if (facing) {
        const [a, b] = planeSides(facing);
        return [a.toLowerCase(), b.toLowerCase()];
    }
    return ['first side', 'second side'];
}

/** A side of a surface as a place: "east of Main fault", "above Main fault" */
export function sideOf(side: string, name: string): string {
    return /^(inside|outside|above|below)\b/.test(side) ? `${side} ${name}` : `${side.replace(/ side$/, '')} of ${name}`;
}

const where = (side: string): string => (/^(inside|outside|above|below)\b/.test(side) ? side : `on the ${side.replace(/ side$/, '')} side`);

/** What a contact does, in a sentence */
export function describeContact(c: ModelContact, sides: readonly [string, string]): string {
    const side = sides[c.young > 0 ? 0 : 1];
    const unit = c.unit || 'no unit yet';
    switch (c.kind) {
        case 'deposit': return `${unit} is laid on older ground, ${where(side)}`;
        case 'erosion': return `${unit} cuts everything older, ${where(side)}`;
        default: return `${unit} intrudes everything older, ${where(side)}`;
    }
}

/**
 * The model another is inside one unit of, and that unit. Null: it is
 * inside none (or that model is gone, or is, in turn, inside this one).
 */
export function insideOf(models: readonly GeoModel[] | undefined, model: GeoModel): { model: GeoModel; unit: string } | null {
    const inside = model.boundary.inside;
    if (!inside) return null;
    const seen = new Set([model.id]);
    for (let at = models?.find(m => m.id === inside.model); at;) {
        if (seen.has(at.id)) return null;
        seen.add(at.id);
        const next = at.boundary.inside?.model;
        at = next ? models?.find(m => m.id === next) : undefined;
    }
    const parent = models?.find(m => m.id === inside.model);
    return parent ? { model: parent, unit: inside.unit } : null;
}

/** What is wrong with a model as a whole (empty: nothing). `models`: the scene's, to check the one it is inside */
/** Something the matter with how a model is set up, and the part of the model it is put right in */
export interface ModelProblem { text: string; part: 'lithologies' | 'boundary' | 'chronology' | 'faults' }

export function modelProblemList(scene: Pick<ModelScene, 'surfaces' | 'wireframes'> & { models?: GeoModel[] }, model: GeoModel): ModelProblem[] {
    const found: ModelProblem[] = [];
    let part: ModelProblem['part'] = 'lithologies';
    const out = { push: (text: string) => { found.push({ text, part }); } };
    if (!model.base) out.push('It has no background lithology: the ground everything else is in.');
    part = 'boundary';
    if (model.boundary.inside && scene.models) {
        const parent = insideOf(scene.models, model);
        if (!parent) out.push(scene.models.some(m => m.id === model.boundary.inside!.model)
            ? 'The model it is inside is, in turn, inside this one: it is built as if inside nothing.'
            : 'The model it is inside is gone: it is built as if inside nothing.');
        else if (!modelUnits(scene, parent.model).includes(parent.unit)) out.push(`${parent.model.name} has no unit ${parent.unit} any more: it has no ground to be in.`);
    }
    part = 'chronology';
    const seen = new Set<string>();
    for (const c of model.contacts) {
        const source = c.mesh ? `mesh:${c.mesh}` : `surface:${c.surface}`;
        if (seen.has(source)) out.push('A surface is in the chronology twice.');
        seen.add(source);
    }
    const bad = model.contacts.filter(c => !c.off && contactProblem(scene, c) !== null).length;
    if (bad > 0) out.push(`${bad} of its contacts cannot be used and ${bad === 1 ? 'is' : 'are'} left out.`);
    part = 'faults';
    const faults = model.faults ?? [];
    const badFaults = faults.filter(x => !x.off && faultProblem(scene, x) !== null).length;
    if (badFaults > 0) out.push(`${badFaults} of its faults cannot be used and ${badFaults === 1 ? 'is' : 'are'} left out.`);
    const looped = faultNet(faults.map(x => (x.ends ?? []).map(e => [faults.findIndex(y => y.id === e.fault), e.side] as FaultEnd))).looped;
    if (looped.length > 0) out.push('Some of its faults end on each other in a loop: those ends are not used. One of them has to run through.');
    return found;
}

/** What is the matter with how a model is set up, in words */
export function modelProblems(scene: Pick<ModelScene, 'surfaces' | 'wireframes'> & { models?: GeoModel[] }, model: GeoModel): string[] {
    return modelProblemList(scene, model).map(p => p.text);
}

const text = (v: unknown, max = 120): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function readUnits(raw: unknown): ModelUnitLook[] {
    const out: ModelUnitLook[] = [];
    for (const u of Array.isArray(raw) ? raw : []) {
        const name = text((u as ModelUnitLook | null)?.name), color = text((u as ModelUnitLook | null)?.color, 32);
        if (name && color && !out.some(x => x.name === name)) out.push({ name, color });
    }
    return out;
}

const finite3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n));

/** Models as saved, made safe to use (anything unreadable is left out) */
export function readModels(raw: unknown): GeoModel[] {
    const out: GeoModel[] = [];
    for (const item of Array.isArray(raw) ? raw : []) {
        const m = item as Partial<GeoModel> | null;
        if (!m || typeof m.id !== 'string' || !m.id || out.some(x => x.id === m.id) || out.length >= MAX_MODELS) continue;
        const contacts: ModelContact[] = [];
        for (const c of Array.isArray(m.contacts) ? m.contacts : []) {
            if (!c || typeof c.id !== 'string' || !c.id || contacts.some(x => x.id === c.id) || contacts.length >= MAX_CONTACTS) continue;
            const surface = text(c.surface), mesh = text(c.mesh);
            if (!surface && !mesh) continue;
            contacts.push({
                id: c.id, ...(mesh ? { mesh } : { surface }),
                kind: CONTACT_KINDS.includes(c.kind) ? c.kind : 'deposit', young: c.young === -1 ? -1 : 1, unit: text(c.unit),
                ...(c.off ? { off: true } : {}),
                ...(Array.isArray(c.within) ? { within: c.within } : {}),
                ...(c.across ? { across: true } : {}),
            });
        }
        const faults: ModelFault[] = [];
        for (const x of Array.isArray(m.faults) ? m.faults : []) {
            if (!x || typeof x.id !== 'string' || !x.id || faults.some(y => y.id === x.id) || faults.length >= MAX_FAULTS) continue;
            const surface = text(x.surface), mesh = text(x.mesh);
            if (!surface && !mesh) continue;
            const reach = Number((x.extent as { reach?: unknown } | undefined)?.reach);
            faults.push({
                id: x.id, ...(mesh ? { mesh } : { surface }), ...(Array.isArray(x.ends) ? { ends: x.ends } : {}),
                ...(Array.isArray(x.cutBy) ? { cutBy: x.cutBy } : {}),
                ...(Number.isFinite(reach) && reach > 0 ? { extent: { reach } } : {}), ...(x.off ? { off: true } : {}),
            });
        }
        // Sides of faults name faults of this model, each once, and never the fault itself
        const sidesOf = (raw: unknown, self?: string): FaultSide[] => {
            const sides: FaultSide[] = [];
            for (const e of Array.isArray(raw) ? raw as Partial<FaultSide>[] : []) {
                if (!e || typeof e.fault !== 'string' || e.fault === self || !faults.some(y => y.id === e.fault) || sides.some(y => y.fault === e.fault)) continue;
                sides.push({ fault: e.fault, side: e.side === -1 ? -1 : 1 });
            }
            return sides;
        };
        for (const x of faults) { const ends = sidesOf(x.ends, x.id); if (ends.length) x.ends = ends; else delete x.ends; }
        // What offsets a fault: other faults of this model, each once, and none it ends on (it is on one side of that one alone)
        for (const x of faults) {
            const cut = [...new Set((x.cutBy ?? []).filter(id => typeof id === 'string' && id !== x.id && faults.some(y => y.id === id) && !x.ends?.some(e => e.fault === id)))];
            if (cut.length && x.surface) x.cutBy = cut; else delete x.cutBy;
        }
        for (const c of contacts) { const within = sidesOf(c.within); if (within.length) c.within = within; else delete c.within; }
        const b = (m.boundary ?? {}) as Partial<GeoModel['boundary']>;
        const box = b.box && finite3(b.box.min) && finite3(b.box.max) && b.box.min.every((v, k) => v < b.box!.max[k])
            ? { min: [...b.box.min] as [number, number, number], max: [...b.box.max] as [number, number, number] } : null;
        const outline = b.outline && finite3(b.outline.normal) && Array.isArray(b.outline.points) && b.outline.points.length >= 3 && b.outline.points.every(finite3)
            ? { normal: [...b.outline.normal] as [number, number, number], points: b.outline.points.map(p => [...p] as [number, number, number]) } : null;
        out.push({
            id: m.id, name: text(m.name) || 'Geological model',
            ...(text(m.unitMap) ? { unitMap: text(m.unitMap) } : {}),
            base: text(m.base), units: readUnits(m.units), contacts, ...(faults.length ? { faults } : {}),
            boundary: {
                box, ...(outline ? { outline } : {}), ...(text(b.top) ? { top: text(b.top) } : {}),
                ...(b.near && typeof b.near === 'object' ? { near: { reach: typeof b.near.reach === 'number' && Number.isFinite(b.near.reach) && b.near.reach > 0 ? b.near.reach : null } } : {}),
                ...(b.inside && text(b.inside.model) && text(b.inside.model) !== m.id && text(b.inside.unit) ? { inside: { model: text(b.inside.model), unit: text(b.inside.unit) } } : {}),
            },
            cell: typeof m.cell === 'number' && Number.isFinite(m.cell) && m.cell > 0 ? m.cell : null,
            ...(m.auto === false ? { auto: false } : {}),
            ...(m.byBlock ? { byBlock: true } : {}),
            ...(text(m.column) ? { column: text(m.column), ...(text(m.columnFor) ? { columnFor: text(m.columnFor) } : {}), ...(text(m.blockColumn) ? { blockColumn: text(m.blockColumn) } : {}) } : {}),
        });
    }
    return out;
}

/** The side a surface's younger ground is most likely on, and the unit there, as a first guess */
export function guessContact(model: GeoModel, surface: SurfaceObject, unitOrder: readonly string[]): Pick<ModelContact, 'kind' | 'young' | 'unit'> {
    const rule = surface.rule;
    if (rule.kind === 'body') return { kind: 'intrusion', young: 1, unit: rule.inside[0] ?? '' };
    if (rule.kind === 'contact') {
        // Units are listed in order down the holes: the one listed first is the younger
        const at = (names: readonly string[]) => Math.min(...names.map(n => unitOrder.indexOf(n)).map(i => (i < 0 ? Infinity : i)));
        const a = at(rule.sideA), b = at(rule.sideB);
        const young = b < a ? -1 : 1;
        const names = young > 0 ? rule.sideA : rule.sideB;
        // The unit laid on the contact is the oldest of its young side: the one listed last that the model has not used yet
        const taken = new Set(model.contacts.map(c => c.unit));
        const down = [...names].sort((p, q) => unitOrder.indexOf(q) - unitOrder.indexOf(p));
        const from = unitOrder.length ? down : [...names].reverse();
        return { kind: 'deposit', young, unit: from.find(n => n !== model.base && !taken.has(n)) ?? from.find(n => n !== model.base) ?? names[0] ?? '' };
    }
    return { kind: 'deposit', young: 1, unit: '' };
}
