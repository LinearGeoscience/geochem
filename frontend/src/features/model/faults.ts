/**
 * The faults of a geological model as a network (pure): which fault ends on
 * which, and the fault blocks they cut the ground into.
 *
 * A fault is a surface with two sides. One that ends on another is there
 * only on one side of it; where the fault it ends on is not there itself, it
 * runs on. A place's fault block is told by the side of each fault it is on,
 * or 0 for a fault that is not there: its code is those, as digits to base
 * three.
 *
 * A fault can also stop: it is there only as far as its extent (which the
 * build reads as one more field, above nothing where the fault is). Past its
 * end it is not there, and the ground on its two sides is one piece. A fault
 * that another ends on runs through, whatever it is told.
 */

/** A side of a fault, by the fault's number: 1 = where its field is positive */
export type FaultEnd = [fault: number, side: 1 | -1];

/** A side of a fault a block is on, or 0: the fault is not there in it */
export type BlockSide = [fault: number, side: 1 | -1 | 0];

export interface FaultNet {
    /** How many faults */
    n: number;
    /** The faults, each after every fault it ends on */
    order: number[];
    /** What each ends on, as used (the ends of faults in a loop are dropped) */
    ends: FaultEnd[][];
    /** The faults that end on each other in a loop */
    looped: number[];
    /** Per fault: it stops (it is there only as far as its extent) */
    stops: boolean[];
    /** The blocks: per block, the side of each fault it is on (0: that fault is not there) */
    signs: Int8Array[];
    /** The number of the block of each code (-1: no place has that code) */
    slotOf: Int16Array;
}

export function faultNet(raw: readonly (readonly FaultEnd[])[], stops: readonly boolean[] = []): FaultNet {
    const n = raw.length;
    const ends: FaultEnd[][] = raw.map((list, f) => {
        const out: FaultEnd[] = [];
        for (const [g, side] of list) if (g !== f && g >= 0 && g < n && !out.some(e => e[0] === g)) out.push([g, side < 0 ? -1 : 1]);
        return out;
    });
    const order: number[] = [];
    const placed = new Uint8Array(n);
    const place = () => {
        for (let moved = true; moved;) {
            moved = false;
            for (let f = 0; f < n; f++) {
                if (placed[f] || !ends[f].every(e => placed[e[0]])) continue;
                placed[f] = 1; order.push(f); moved = true;
            }
        }
    };
    place();
    // What is left ends, in the end, on a loop. The loop itself: those of them that another of them ends on
    // (taking away, over and over, any that none does). Their ends on each other are not used
    const left = new Set<number>();
    for (let f = 0; f < n; f++) if (!placed[f]) left.add(f);
    for (let moved = true; moved;) {
        moved = false;
        for (const f of left) {
            if ([...left].some(g => ends[g].some(e => e[0] === f))) continue;
            left.delete(f); moved = true;
        }
    }
    const looped = [...left].sort((p, q) => p - q);
    for (const f of looped) ends[f] = ends[f].filter(e => !left.has(e[0]));
    place();

    const net: FaultNet = {
        n, order, ends, looped,
        // (One that another ends on runs through: where it stopped, the other would have nothing to end on)
        stops: Array.from({ length: n }, (_, f) => !!stops[f] && !ends.some(list => list.some(e => e[0] === f))),
        signs: [], slotOf: new Int16Array(3 ** n).fill(-1),
    };
    // Every way the faults can be at a place: each on one side or the other and, one that stops, there or not
    const values = new Float64Array(2 * n), eff = new Int8Array(n);
    const codes = new Set<number>();
    for (let combo = 0; combo < 3 ** n; combo++) {
        let can = true;
        for (let f = 0, c = combo; f < n && can; f++, c = Math.floor(c / 3)) {
            const d = c % 3;
            if (d === 2 && !net.stops[f]) can = false;
            values[f] = d === 0 ? -1 : 1;
            values[n + f] = d === 2 ? -1 : 1;
        }
        if (can) codes.add(blockCode(net, values, 0, eff, n));
    }
    [...codes].sort((a, b) => a - b).forEach((code, slot) => {
        net.slotOf[code] = slot;
        net.signs.push(Int8Array.from({ length: n }, (_, f) => (Math.floor(code / 3 ** f) % 3) - 1));
    });
    return net;
}

/**
 * The code of the block at a place. `values[from + f]`: the field of fault f
 * there. `values[thereFrom + f]`: for a fault that stops, above nothing
 * where it is there (`thereFrom` under nothing: no fault stops). `eff` is
 * filled with the side of each fault the place is on (0: the fault is not
 * there).
 */
export function blockCode(net: FaultNet, values: ArrayLike<number>, from: number, eff: Int8Array, thereFrom = -1): number {
    let code = 0;
    for (const f of net.order) {
        let there = !(thereFrom >= 0 && net.stops[f] && !(values[thereFrom + f] > 0));
        for (const [g, side] of net.ends[f]) if (eff[g] !== 0 && eff[g] !== side) { there = false; break; }
        eff[f] = !there ? 0 : values[from + f] > 0 ? 1 : -1;
        code += (eff[f] + 1) * 3 ** f;
    }
    return code;
}

/**
 * The contacts of each block, by number and in the order given: a contact
 * limited to sides of faults (`within`) is in the blocks on those sides (a
 * side of 0: the blocks that fault is not there in); one with no limit is in
 * every block.
 */
export function blockContacts(net: FaultNet, within: readonly (readonly BlockSide[] | null | undefined)[], contacts: number): number[][] {
    return net.signs.map(signs => {
        const out: number[] = [];
        for (let k = 0; k < contacts; k++) if ((within[k] ?? []).every(([g, side]) => signs[g] === side)) out.push(k);
        return out;
    });
}

/** Whether a block (the side of each fault it is on) is on the sides given */
export const blockWithin = (signs: ArrayLike<number>, sides: readonly FaultEnd[]): boolean => sides.every(([g, side]) => signs[g] === side);

/**
 * Whether a place (the side of each fault it is on) is ground of the block
 * on the sides given: it is on those sides, or past the end of a fault that
 * stops, where the ground of the fault's two sides is one piece. A surface
 * in that block is fitted to what is there.
 */
export const blockHolds = (net: FaultNet, signs: ArrayLike<number>, sides: readonly FaultEnd[]): boolean => sides.every(([g, side]) => signs[g] === side || (signs[g] === 0 && net.stops[g]));
