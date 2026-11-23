/**
 * A surface fitted in one fault block of a geological model: which of its
 * places are in that block, by the model's faults as they are fitted now.
 * The surface is then fitted to those places alone, so that a layer offset
 * across a fault is two surfaces, each right on its own side, and not one
 * smeared through the fault.
 */
import { partsOf, sameSides } from './blockParts';
import { faultPieces, piecesOn } from './faultCuts';
import { blockCode, blockHolds, faultNet, type FaultEnd } from './faults';
import { activeFaults, faultStops } from './geoModel';
import { readModelField, type ModelField, type ReachField } from './geoModelJobs';
import { sceneMesh } from './meshFields';
import type { FittedField } from './rbf';
import type { FaultSide, GeoModel, ModelFault, ModelScene, SurfaceObject } from './types';

export interface SurfaceLimit {
    /** Tells this limit from another: the sides, the faults and their fits */
    mark: string;
    /** Per place (xyz triples): 1 when it is in the block */
    inside: (xyz: Float64Array) => Uint8Array;
    /** How many faults the block is on one side of */
    sides: number;
    /** Per place, for one of those faults (`s`): how far it is on the wrong side of it (under nothing: on the block's side) */
    beyond: (s: number, xyz: Float64Array) => Float64Array;
}

type Fits = Readonly<Record<string, { key: string; state: string; field: FittedField | null } | undefined>>;

/**
 * A fault of a model that has a field now, or one piece of a fault that
 * younger faults offset (faultCuts.ts): the sides of those it is on, what it
 * ends on (by number in the list), its field, where it is there when it
 * stops (null: it runs through), and what tells it from another.
 */
export interface FaultField { id: string; cut: FaultSide[]; ends: FaultEnd[]; field: ModelField; there: ReachField | null; mark: string }

/** Where a fault that stops is there, as it is fitted or read now (null: there is nothing to tell that from) */
export type ReachOf = (fault: ModelFault) => ReachField | null;

/**
 * The faults of a model that have a field now, a piece at a time. 'wait':
 * one is still being fitted or read. `reachOf`: where one that stops is
 * there (absent: none is taken to stop). `only`: no faults but these (by
 * id), which must name with each fault what it ends on and what offsets it.
 */
export function faultFields(scene: ModelScene, model: GeoModel, fits: Fits, reachOf?: ReachOf, only?: ReadonlySet<string>): FaultField[] | 'wait' {
    // Those with a field of their own: a surface with nothing to fit is left out; one being fitted is waited for
    const whole = new Map<string, { field: ModelField; mark: string }>();
    const faults: ModelFault[] = [];
    for (const x of activeFaults(scene, model)) {
        if (only && !only.has(x.id)) continue;
        if (x.mesh) {
            const mesh = sceneMesh(x.mesh);
            if (mesh === 'wait') return 'wait';
            if (mesh) { whole.set(x.id, { field: mesh.field, mark: mesh.mark }); faults.push(x); }
            continue;
        }
        const fit = fits[x.surface!];
        if (!fit || fit.state === 'fitting') return 'wait';
        if (fit.field) { whole.set(x.id, { field: fit.field, mark: fit.key }); faults.push(x); }
    }
    const out: FaultField[] = [];
    for (const piece of faultPieces(faults)) {
        const x = piece.fault;
        let { field, mark } = whole.get(x.id)!;
        if (piece.cut.length > 0) {
            // A piece of a fault that younger ones offset: its part on those sides. With nothing of the fault there, the fault through all of its places
            const part = partsOf(scene, model.id, x.surface).find(p => sameSides(p.within?.sides ?? [], piece.cut));
            const fit = part ? fits[part.id] : undefined;
            if (part && (!fit || fit.state === 'fitting')) return 'wait';
            if (fit?.field) { field = fit.field; mark = fit.key; }
            mark = `${mark}|on:${piece.cut.map(e => `${e.fault}${e.side > 0 ? '+' : '-'}`).join('')}`;
        }
        const there = reachOf && faultStops(model, x) ? reachOf(x) : null;
        out.push({ id: x.id, cut: piece.cut, ends: piece.ends, field, there, mark: there ? `${mark}|stops:${there.reach}` : mark });
    }
    return out;
}

/** Sides of a model's faults by their numbers among `faults` (its pieces: faultCuts.ts `piecesOn`); a side of a fault that is not among them limits nothing */
export const sidesByNumber = (faults: readonly { id: string; cut?: readonly FaultSide[] }[], sides: readonly FaultSide[] | undefined): FaultEnd[] => piecesOn(faults, sides);

/** The faults a block on these sides is told by: those named, what each ends on, and what offsets each (by id) */
function faultsFor(model: GeoModel, sides: readonly FaultSide[]): Set<string> {
    const out = new Set<string>();
    const add = (id: string) => {
        const x = model.faults?.find(y => y.id === id);
        if (!x || out.has(id)) return;
        out.add(id);
        for (const e of x.ends ?? []) add(e.fault);
        for (const y of x.cutBy ?? []) add(y);
    };
    for (const e of sides) add(e.fault);
    return out;
}

/**
 * The limit of a surface as it stands. Null: it has none (or its model or
 * the faults it names are gone, or it is itself a fault of that model: a
 * fault is not cut by the blocks it makes). 'wait': a fault is being fitted.
 */
export function surfaceLimit(surface: SurfaceObject, scene: ModelScene, fits: Fits, reachOf?: ReachOf): SurfaceLimit | 'wait' | null {
    const within = surface.within;
    if (!within || within.sides.length === 0) return null;
    const model = scene.models?.find(m => m.id === within.model);
    if (!model || model.faults?.some(x => x.surface === surface.id)) return null;
    // (No faults but those its block is told by: a part of a fault is in the blocks of the faults that offset it, and those are not told by the fault itself)
    const only = faultsFor(model, within.sides);
    const self = surface.blockOf ? model.faults?.find(x => x.surface === surface.blockOf) : undefined;
    if (self) only.delete(self.id);
    const faults = faultFields(scene, model, fits, reachOf, only);
    if (faults === 'wait') return 'wait';
    const sides = sidesByNumber(faults, within.sides);
    if (sides.length === 0) return null;
    const net = faultNet(faults.map(x => x.ends), faults.map(x => !!x.there));
    const n = faults.length;
    return {
        mark: JSON.stringify([sides, net.ends, faults.map(x => x.mark)]),
        // (Past the end of a fault that stops, the ground of its two sides is one piece: what is there is in the block on either side)
        inside: xyz => {
            const count = Math.floor(xyz.length / 3);
            const out = new Uint8Array(count);
            const read = faults.map(x => readModelField(x.field, xyz));
            const there = faults.map((x, f) => (net.stops[f] ? readModelField(x.there!, xyz) : null));
            const values = new Float64Array(2 * n), eff = new Int8Array(n);
            for (let i = 0; i < count; i++) {
                for (let f = 0; f < n; f++) { values[f] = read[f][i]; values[n + f] = there[f]?.[i] ?? 1; }
                blockCode(net, values, 0, eff, n);
                out[i] = blockHolds(net, eff, sides) ? 1 : 0;
            }
            return out;
        },
        sides: sides.length,
        beyond: (s, xyz) => {
            const [f, side] = sides[s];
            const v = readModelField(faults[f].field, xyz);
            const out = new Float64Array(v.length);
            for (let i = 0; i < v.length; i++) out[i] = -side * v[i];
            return out;
        },
    };
}
