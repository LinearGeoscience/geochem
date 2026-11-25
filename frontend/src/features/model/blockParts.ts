/**
 * Contacts by fault block, made by the program (Phase 234). In a model that
 * is cut by faults, a layer is offset across each fault: one surface fitted
 * through all of them would be smeared through the fault. So each contact of
 * such a model has a part in every fault block: a surface like the contact's
 * own, fitted to what of its points, lines and logging is in that block
 * alone. The parts are the model's: it makes them when a fault comes into
 * use, keeps them like the surface they are parts of (that surface is the
 * one that is edited), and takes them away when the faults go. Nothing here
 * touches a contact that was split by hand (it is in one block already).
 *
 * Pure: the scene in, the scene with its parts as they should be out (the
 * same scene when they are so already). The store passes every change of
 * the scene through it.
 */
import { faultPieces } from './faultCuts';
import { faultNet, type FaultEnd } from './faults';
import { activeFaults, blockNames, faultStops } from './geoModel';
import type { FaultSide, GeoModel, ModelContact, ModelFault, ModelScene, SurfaceColumns, SurfaceObject } from './types';

type Scene = Pick<ModelScene, 'surfaces' | 'wireframes' | 'models'>;

/** A surface that is a part of another in one fault block, made by a model */
export const isBlockPart = (s: Pick<SurfaceObject, 'blockOf'> | null | undefined): boolean => !!s?.blockOf;

/** The surfaces of a scene that are no model's parts: those that are chosen from, listed and edited */
export const ownSurfaces = <T extends Pick<SurfaceObject, 'blockOf'>>(surfaces: readonly T[]): T[] => surfaces.filter(s => !s.blockOf);

export const sameSides = (a: readonly FaultSide[], b: readonly FaultSide[]) => a.length === b.length && a.every(e => b.some(o => o.fault === e.fault && o.side === e.side));

/** A fault block of a model: the sides of its faults it is on, and what it is called ("east of Main fault") */
export interface ModelBlock { sides: FaultSide[]; name: string }

/**
 * The blocks a model is cut into by the faults it has in use, as the scene
 * says (no fit is looked at). None: it is in one piece. The ground past the
 * end of every fault (they all stop) is no block of its own here: a contact
 * there is its surface through all of its data.
 */
export function modelBlocks(scene: Pick<ModelScene, 'surfaces' | 'wireframes'>, model: GeoModel): ModelBlock[] {
    const faults = activeFaults(scene, model);
    if (faults.length === 0) return [];
    const byNumber = (sides: readonly FaultSide[] | undefined): FaultEnd[] => (sides ?? []).flatMap(e => {
        const at = faults.findIndex(x => x.id === e.fault);
        return at < 0 ? [] : [[at, e.side] as FaultEnd];
    });
    const net = faultNet(faults.map(x => byNumber(x.ends)), faults.map(x => faultStops(model, x)));
    if (net.signs.length < 2) return [];
    const names = blockNames(scene, model, faults.map(x => x.id), net.signs.map(signs => Array.from(signs)));
    return net.signs.map((signs, k) => ({
        sides: faults.flatMap((x, f) => (signs[f] === 0 ? [] : [{ fault: x.id, side: (signs[f] > 0 ? 1 : -1) as 1 | -1 }])),
        name: names[k],
    })).filter(b => b.sides.length > 0);
}

/**
 * Whether a contact of a model is fitted in each fault block apart by the
 * program: the model does so, and the contact is a fitted surface that is
 * in every block (not split by hand), is in use, and is not said to run
 * through the faults.
 */
export function splitsByBlock(model: GeoModel, contact: ModelContact): boolean {
    return !!model.byBlock && !!contact.surface && !contact.within?.length && !contact.across && !contact.off;
}

/**
 * The contacts of a model that the faults offset although an older contact
 * of it runs through them (the contacts are the youngest first). What runs
 * through the faults was put in place after they moved; anything younger
 * came after them too, and cannot be offset by them. Each with the nearest
 * older contact that says so. None in a model that does not fit its
 * contacts by fault block, or has no fault in use. (A contact split by hand
 * into one block, one left out and one that is a fixed mesh say nothing and
 * are asked nothing.)
 */
export function acrossByAge(model: GeoModel): { contact: ModelContact; older: ModelContact }[] {
    if (!model.byBlock || !(model.faults ?? []).some(x => !x.off)) return [];
    const out: { contact: ModelContact; older: ModelContact }[] = [];
    model.contacts.forEach((c, i) => {
        if (!splitsByBlock(model, c)) return;
        const older = model.contacts.slice(i + 1).find(o => o.across && !o.off && !o.within?.length);
        if (older) out.push({ contact: c, older });
    });
    return out;
}

/** The parts a model has of a contact's surface, as the scene has them */
export function partsOf(scene: Pick<ModelScene, 'surfaces'>, modelId: string, surfaceId: string | undefined): SurfaceObject[] {
    return surfaceId ? scene.surfaces.filter(s => s.blockOf === surfaceId && s.within?.model === modelId) : [];
}

/** The model a part is of, and the contact or the fault of it there (null: it is no part, or what it was a part of is gone) */
export function partHome(scene: Pick<ModelScene, 'models'>, part: Pick<SurfaceObject, 'blockOf' | 'within'>): { model: GeoModel; contact: ModelContact | null; fault: ModelFault | null } | null {
    if (!part.blockOf || !part.within) return null;
    const model = scene.models?.find(m => m.id === part.within!.model);
    const contact = model?.contacts.find(c => c.surface === part.blockOf) ?? null;
    const fault = model?.faults?.find(x => x.surface === part.blockOf) ?? null;
    return model && (contact || fault) ? { model, contact, fault } : null;
}

/** The sides of faults a part is on, in words ("north of Young fault") */
export function sidesText(scene: Pick<ModelScene, 'surfaces' | 'wireframes'>, model: GeoModel, sides: readonly FaultSide[]): string {
    return blockNames(scene, model, sides.map(e => e.fault), [sides.map(e => e.side)])[0];
}

/**
 * The pieces a model's faults are in where younger faults offset them
 * (faultCuts.ts), as the scene says: per fault that is offset, the sides of
 * the younger faults each of its pieces is on.
 */
export function faultCuts(scene: Pick<ModelScene, 'surfaces' | 'wireframes'>, model: GeoModel): { fault: ModelFault; cutters: ModelFault[]; pieces: FaultSide[][] }[] {
    const faults = activeFaults(scene, model);
    const pieces = faultPieces(faults);
    return faults.flatMap(fault => {
        const own = pieces.filter(p => p.fault === fault && p.cut.length > 0);
        return own.length > 0 ? [{ fault, cutters: faults.filter(y => own[0].cut.some(e => e.fault === y.id)), pieces: own.map(p => p.cut) }] : [];
    });
}

const NO_COLUMNS: SurfaceColumns = { side: null, distance: null, writtenFor: null };

function samePart(was: SurfaceObject, now: SurfaceObject): boolean {
    const a = was as unknown as Record<string, unknown>, b = now as unknown as Record<string, unknown>;
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (a[k] === b[k]) continue;
        if (k === 'conform' && JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null)) continue;
        if (k === 'trendHeld' && (a[k] ?? null) === (b[k] ?? null)) continue;
        return false;
    }
    return true;
}

interface Want { model: GeoModel; from: SurfaceObject; block: ModelBlock; id: string; was: SurfaceObject | null }

/** Fewer places than this in a fault block do not say how a surface lies there */
export const SPARSE_PART = 4;

/** Places no further off one line than this share of its length are one line (a fence of holes) */
const LINE_SHARE = 0.1;

/**
 * Whether the places of a surface in one fault block (xyz triples) say how it
 * lies there. A few places do not, and nor does one line of them, however
 * many: a single fence of holes across a block fixes the surface along the
 * fence and leaves it free to tilt any way about it.
 */
export function placesTellLie(xyz: ArrayLike<number>): boolean {
    const n = Math.floor(xyz.length / 3);
    if (n < SPARSE_PART) return false;
    const far = (from: readonly number[]): number => {
        let best = 0, most = -1;
        for (let i = 0; i < n; i++) {
            const d = (xyz[i * 3] - from[0]) ** 2 + (xyz[i * 3 + 1] - from[1]) ** 2 + (xyz[i * 3 + 2] - from[2]) ** 2;
            if (d > most) { most = d; best = i; }
        }
        return best;
    };
    const at = (i: number) => [xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2]];
    // The two places furthest apart (near enough), and how far the rest are from the line through them
    const a = at(far(at(0))), b = at(far(a));
    const along = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], length = Math.hypot(along[0], along[1], along[2]);
    if (!(length > 0)) return false;
    let off = 0;
    for (let i = 0; i < n; i++) {
        const p = at(i), d = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
        const t = (d[0] * along[0] + d[1] * along[1] + d[2] * along[2]) / length;
        off = Math.max(off, Math.sqrt(Math.max(0, d[0] * d[0] + d[1] * d[1] + d[2] * d[2] - t * t)));
    }
    return off > LINE_SHARE * length;
}

/**
 * The scene with the parts its models want, and no others: one for each
 * fault block of each contact that is fitted by block (`splitsByBlock`),
 * and one for each piece of a fault that younger faults offset. A
 * part that is there already keeps its id, and what it has of its own (the
 * plane its fit is held to, the columns it fills in); the rest of it is
 * made the same as the surface it is a part of. A layer that runs alongside
 * another runs alongside that one's part in the same block. The same scene
 * comes back when nothing is to be changed.
 */
export function withBlockParts<T extends Scene>(scene: T): T {
    const had = scene.surfaces.filter(s => s.blockOf);
    const models = (scene.models ?? []).filter(m => (m.faults?.length ?? 0) > 0);
    if (had.length === 0 && models.length === 0) return scene;

    const byId = new Map(scene.surfaces.map(s => [s.id, s]));
    let fresh = 1;
    for (const s of scene.surfaces) { const n = /^s(\d+)$/.exec(s.id); if (n && Number(n[1]) >= fresh) fresh = Number(n[1]) + 1; }
    const taken = new Set<SurfaceObject>();
    const wants: Want[] = [];
    for (const model of models) {
        const seen = new Set<string>();
        // A fault that younger faults offset: a part on each side of those
        for (const { fault, pieces } of faultCuts(scene, model)) {
            const from = byId.get(fault.surface ?? '');
            if (!from || from.blockOf || seen.has(from.id)) continue;
            seen.add(from.id);
            for (const sides of pieces) {
                const was = had.find(s => !taken.has(s) && s.blockOf === from.id && s.within?.model === model.id && sameSides(s.within.sides, sides)) ?? null;
                if (was) taken.add(was);
                wants.push({ model, from, block: { sides, name: sidesText(scene, model, sides) }, id: was?.id ?? `s${fresh++}`, was });
            }
        }
        const blocks = model.byBlock ? modelBlocks(scene, model) : [];
        for (const c of model.contacts) {
            const from = c.surface ? byId.get(c.surface) : undefined;
            // (A fault of the model is not cut by the blocks it makes; a part is not split again)
            if (!from || from.blockOf || seen.has(from.id) || !splitsByBlock(model, c) || model.faults?.some(x => x.surface === from.id)) continue;
            seen.add(from.id);
            for (const block of blocks) {
                const was = had.find(s => !taken.has(s) && s.blockOf === from.id && s.within?.model === model.id && sameSides(s.within.sides, block.sides)) ?? null;
                if (was) taken.add(was);
                wants.push({ model, from, block, id: was?.id ?? `s${fresh++}`, was });
            }
        }
    }

    const made = new Map<string, SurfaceObject>();
    for (const w of wants) {
        const { id: _id, name: _name, within: _within, blockOf: _blockOf, columns: _columns, trendHeld: _held, locked: _locked, lockedKey: _lockedKey, folder: _folder, conform, ...shared } = w.from;
        // Alongside another contact of the model: alongside that one's part in this block
        const beside = conform ? wants.find(o => o.model === w.model && o.from.id === conform.surface && sameSides(o.block.sides, w.block.sides)) : undefined;
        const part: SurfaceObject = {
            ...shared, id: w.id, name: `${w.from.name} (${w.block.name})`,
            within: w.was?.within ?? { model: w.model.id, sides: w.block.sides }, blockOf: w.from.id,
            columns: w.was?.columns ?? NO_COLUMNS,
            ...(w.was?.trendHeld ? { trendHeld: w.was.trendHeld } : {}),
            ...(conform ? { conform: beside ? { ...conform, surface: beside.id } : conform } : {}),
        };
        made.set(w.id, w.was && samePart(w.was, part) ? w.was : part);
    }

    const surfaces: SurfaceObject[] = [];
    for (const s of scene.surfaces) {
        if (!s.blockOf) surfaces.push(s);
        else if (taken.has(s)) surfaces.push(made.get(s.id)!);
    }
    for (const w of wants) if (!w.was) surfaces.push(made.get(w.id)!);
    return surfaces.length === scene.surfaces.length && surfaces.every((s, i) => s === scene.surfaces[i]) ? scene : { ...scene, surfaces };
}
