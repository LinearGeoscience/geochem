/**
 * Faults offset by younger faults (pure).
 *
 * An older fault that a younger one offsets is not one surface: it is one
 * piece on each side of the younger fault, each fitted to what of the
 * fault's own places is on that side. To the network of faults (faults.ts)
 * each piece is a fault of its own that ends on the younger fault, staying
 * on its side of it: so nothing in the build is new, and every field in it
 * is as smooth as a fitted surface is.
 *
 * A fault that offsets another offsets what that one offsets too: it is
 * younger than both.
 */
import type { FaultEnd } from './faults';
import type { FaultSide, ModelFault } from './types';

/** At most this many pieces of faults in a build (a fault no other offsets is one piece) */
export const MAX_PIECES = 12;

/** A fault that can offset another: it runs through the model (it ends on no fault that is in use) */
const runsThrough = (faults: readonly ModelFault[], y: ModelFault): boolean => !(y.ends ?? []).some(e => faults.some(x => x.id === e.fault));

/** The faults a fault is set to be offset by, of those in use (itself and a fixed mesh apart: a mesh is where it is) */
const asked = (faults: readonly ModelFault[], fault: ModelFault): ModelFault[] => (fault.surface
    ? faults.filter(y => y.id !== fault.id && (fault.cutBy ?? []).includes(y.id))
    : []);

function closure(fault: ModelFault, next: (x: ModelFault) => ModelFault[]): Set<string> {
    const seen = new Set<string>();
    const walk = (x: ModelFault) => { for (const y of next(x)) if (!seen.has(y.id)) { seen.add(y.id); walk(y); } };
    walk(fault);
    return seen;
}

/**
 * The faults that offset each fault, by the fault's id, as used: those it
 * is set to be offset by that can be (they run through the model, and are
 * not set to be offset by it in turn), and those that offset them. `faults`:
 * the model's faults in use, in its order. Where the pieces would be too
 * many, the faults last in the list are left whole.
 */
export function cutPlan(faults: readonly ModelFault[]): Map<string, ModelFault[]> {
    // (In a loop: set to be offset, in the end, by itself. One of them is the younger; until that is said, none is cut)
    const looped = new Set(faults.filter(x => closure(x, y => asked(faults, y)).has(x.id)).map(x => x.id));
    const direct = (x: ModelFault) => (looped.has(x.id) ? [] : asked(faults, x).filter(y => !looped.has(y.id) && runsThrough(faults, y)));
    const plan = new Map<string, ModelFault[]>();
    let pieces = faults.length;
    for (const x of faults) {
        const ids = closure(x, direct);
        const cutters = faults.filter(y => ids.has(y.id));
        const more = 2 ** cutters.length - 1;
        if (cutters.length > 0 && pieces + more <= MAX_PIECES) { plan.set(x.id, cutters); pieces += more; } else plan.set(x.id, []);
    }
    return plan;
}

/** The faults that offset a fault, as used (see `cutPlan`) */
export const cuttersOf = (faults: readonly ModelFault[], fault: ModelFault): ModelFault[] => cutPlan(faults).get(fault.id) ?? [];

/** Why a fault set to be offset by another is not, in words (null: it is, or is not set to be). `nameOf`: a fault's name */
export function cutProblem(faults: readonly ModelFault[], fault: ModelFault, nameOf: (fault: ModelFault) => string): string | null {
    const want = asked(faults, fault);
    if (want.length === 0) return null;
    const used = cuttersOf(faults, fault);
    for (const y of want) {
        if (used.includes(y)) continue;
        if (closure(y, z => asked(faults, z)).has(fault.id)) return `It is not offset by ${nameOf(y)} for now: ${nameOf(y)} is set to be offset by it too, and one of the two is the younger.`;
        if (!runsThrough(faults, y)) return `It is not offset by ${nameOf(y)} for now: ${nameOf(y)} ends on another fault, and a fault that offsets another runs through the model.`;
        return `It is not offset by ${nameOf(y)} for now: the model's faults would be in more than ${MAX_PIECES} pieces.`;
    }
    return null;
}

/** A piece of a fault: the fault, and the sides of the faults that offset it that this piece is on (none: the whole fault) */
export interface FaultPiece {
    fault: ModelFault;
    cut: FaultSide[];
    /** What it ends on, by number among the pieces: the faults that offset it, on its side of each, and what the fault itself ends on */
    ends: FaultEnd[];
}

/** No side of `a` is against a side of `b` */
const agree = (a: readonly FaultSide[], b: readonly FaultSide[]): boolean => a.every(e => b.every(o => o.fault !== e.fault || o.side === e.side));

/** The pieces of a model's faults in use, in the model's order: of a fault that others offset, one on each side of those */
export function faultPieces(faults: readonly ModelFault[]): FaultPiece[] {
    const plan = cutPlan(faults);
    const out: FaultPiece[] = [];
    for (const fault of faults) {
        const cutters = plan.get(fault.id) ?? [];
        for (let combo = 0; combo < 2 ** cutters.length; combo++) {
            out.push({ fault, cut: cutters.map((y, i) => ({ fault: y.id, side: (combo >> i) & 1 ? -1 : 1 })), ends: [] });
        }
    }
    out.forEach(piece => {
        // The faults that offset it: it is there on its own side of each alone (a piece of that one, on the same sides of what offsets both)
        for (const e of piece.cut) {
            const at = out.findIndex(o => o.fault.id === e.fault && agree(o.cut, piece.cut));
            if (at >= 0) piece.ends.push([at, e.side]);
        }
        // What the fault ends on: every piece of that one this piece can meet
        for (const e of piece.fault.ends ?? []) {
            if (piece.cut.some(c => c.fault === e.fault)) continue;
            out.forEach((o, at) => { if (o.fault.id === e.fault && agree(o.cut, piece.cut)) piece.ends.push([at, e.side]); });
        }
    });
    return out;
}

/**
 * Sides of a model's faults, by number among its pieces. Of a fault in
 * pieces, the piece that is on the sides given of the faults that offset
 * it; where those are not all given, that side limits nothing. A side of a
 * fault that is not among the pieces limits nothing either.
 */
export function piecesOn(pieces: readonly { id: string; cut?: readonly FaultSide[] }[], sides: readonly FaultSide[] | undefined): FaultEnd[] {
    return (sides ?? []).flatMap(e => {
        const at = pieces.findIndex(p => p.id === e.fault && (p.cut ?? []).every(c => sides!.some(o => o.fault === c.fault && o.side === c.side)));
        return at < 0 ? [] : [[at, e.side] as FaultEnd];
    });
}
