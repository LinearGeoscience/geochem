/**
 * What is put on a vein by hand, carried to its stretches (pure,
 * unit-tested).
 *
 * A vein goes through every stretch of it the holes have: that is seen, and
 * nothing put by hand moves it. What a hole does not say is which way the
 * vein lies where it meets it, and that is what a dip put on the vein says.
 * So a dip is carried to the middle of every stretch within its reach: the
 * vein lies as the dip says there, and is still where the hole has it. Where
 * the stretches of a vein lie in a flatter plane than the dip, it comes out
 * as steeper sheets stepping from hole to hole.
 *
 * (Tried first, Phase 252: the middles held loosely within the reach, so
 * that the reference surface itself went to the plane of the dip. On the
 * real test project, a dip 20 degrees steeper with a reach of 30 m: the
 * reference surface followed it, and left stretches up to 25 m to one side
 * of it; one wall came out 5.9 m off its pick, and the vein between the
 * holes hardly moved, since its walls are measured back to the holes.)
 */
import { HOLD_SHARE, MAX_READINGS, nearestOther } from './readings';
import type { Vec3 } from './types';

/**
 * Past its reach a dip is still carried, less and less, as far as this many
 * times its reach, where the lie of the ground is known at a stretch: the
 * two are blended there. (Where it is not known there is nothing to blend
 * with, and the dip stops at its reach.)
 */
export const CARRY_BLEND = 1.5;

/** A dip put on a vein by hand: where, the unit normal of its plane, and how far it is carried (m) */
export interface HandDip { p: ArrayLike<number>; normal: ArrayLike<number>; overturned?: boolean; reach: number }
/** A direction put on a vein by hand: the vein holds this line (unit, either way along it) */
export interface HandLine { p: ArrayLike<number>; direction: ArrayLike<number>; reach: number }
/** How the vein is taken to lie at middles of its stretches (guides.ts, `veinGuides`): places, unit normals, and how far each holds */
export interface LieAt { positions: Float64Array; normals: Float64Array; offsets: Float64Array }

export interface Carried {
    /** The lie at the middles nothing put by hand reaches (the one given, when it reaches none; null: none is left, or none was given) */
    lie: LieAt | null;
    /** Dips at the middles within reach: as the hand dip says, or the lie turned to hold a direction */
    readings: { positions: Float64Array; normals: Float64Array; overturned: Uint8Array; offsets: Float64Array } | null;
    /** Directions at the middles within reach of one, where nothing says how the vein lies */
    directed: { positions: Float64Array; directions: Float64Array; offsets: Float64Array } | null;
    /** How many stretches lie as something put by hand says */
    count: number;
}

/**
 * The reach of something put on a vein by hand that has none of its own:
 * how far apart the middles of its stretches usually are (each to its
 * nearest; the median), so that it is carried to the stretches next to it.
 * 0: there are fewer than two.
 */
export function usualReach(mids: ArrayLike<number>): number {
    const n = Math.floor(mids.length / 3);
    if (n < 2) return 0;
    const nearest: number[] = [];
    for (let i = 0; i < n; i++) {
        const d = nearestOther([mids[i * 3], mids[i * 3 + 1], mids[i * 3 + 2]], mids);
        if (Number.isFinite(d)) nearest.push(d);
    }
    nearest.sort((a, b) => a - b);
    return nearest.length > 0 ? nearest[nearest.length >> 1] : 0;
}

const SAME_PLACE = 1e-3;

/**
 * Dips and directions put on a vein by hand, carried to the middles of its
 * stretches (`mids`, xyz triples). A middle takes the dip it is deepest
 * within the reach of (nearest, as a share of the reach); within the reach
 * it lies as the dip says; from there to CARRY_BLEND times the reach, and
 * only where the lie is known, between the two. A middle no dip reaches,
 * within the reach of a direction: the lie there is turned the least that
 * makes it hold the line; where no lie is known, it holds the line and is
 * otherwise free. `lie` is given back without the middles so taken.
 */
export function carryToMiddles(mids: ArrayLike<number>, dips: readonly HandDip[], lines: readonly HandLine[], lie: LieAt | null): Carried {
    const n = Math.floor(mids.length / 3);
    const none: Carried = { lie, readings: null, directed: null, count: 0 };
    if (n === 0 || (dips.length === 0 && lines.length === 0)) return none;
    const far = (i: number, p: ArrayLike<number>) => Math.hypot(mids[i * 3] - p[0], mids[i * 3 + 1] - p[1], mids[i * 3 + 2] - p[2]);
    const nLie = lie ? lie.offsets.length : 0;
    /** The lie at a middle, by its place in `lie` (-1: none is known there) */
    const lieAt = (i: number): number => {
        for (let j = 0; j < nLie; j++) {
            if (Math.abs(lie!.positions[j * 3] - mids[i * 3]) < SAME_PLACE && Math.abs(lie!.positions[j * 3 + 1] - mids[i * 3 + 1]) < SAME_PLACE && Math.abs(lie!.positions[j * 3 + 2] - mids[i * 3 + 2]) < SAME_PLACE) return j;
        }
        return -1;
    };
    interface Taken { i: number; share: number; normal?: Vec3; overturned?: boolean; direction?: Vec3; offset: number }
    const taken: Taken[] = [];
    const dropped = new Set<number>();
    for (let i = 0; i < n; i++) {
        let dip: HandDip | null = null, share = Infinity;
        for (const d of dips) {
            if (!(d.reach > 0)) continue;
            const s = far(i, d.p) / d.reach;
            if (s < share) { share = s; dip = d; }
        }
        let line: HandLine | null = null, lineShare = Infinity;
        if (!(share <= 1)) {
            for (const l of lines) {
                if (!(l.reach > 0)) continue;
                const s = far(i, l.p) / l.reach;
                if (s <= 1 && s < lineShare) { lineShare = s; line = l; }
            }
        }
        if (!(dip && share < CARRY_BLEND) && !line) continue;
        const j = lieAt(i);
        const own = j >= 0 ? lie!.offsets[j] : 0;
        const next = nearestOther([mids[i * 3], mids[i * 3 + 1], mids[i * 3 + 2]], mids);
        const offset = own > 0 ? own : HOLD_SHARE * (Number.isFinite(next) ? next : 4);
        const known: Vec3 | null = j >= 0 ? [lie!.normals[j * 3], lie!.normals[j * 3 + 1], lie!.normals[j * 3 + 2]] : null;
        if (dip && share <= 1) {
            taken.push({ i, share, normal: [dip.normal[0], dip.normal[1], dip.normal[2]], overturned: !!dip.overturned, offset });
        } else if (dip && share < CARRY_BLEND && known && !line) {
            // Between the two, the same way up as the dip
            const w = (share - 1) / (CARRY_BLEND - 1);
            const sign = known[0] * dip.normal[0] + known[1] * dip.normal[1] + known[2] * dip.normal[2] < 0 ? -1 : 1;
            const m: Vec3 = [(1 - w) * dip.normal[0] + w * sign * known[0], (1 - w) * dip.normal[1] + w * sign * known[1], (1 - w) * dip.normal[2] + w * sign * known[2]];
            const length = Math.hypot(m[0], m[1], m[2]);
            if (!(length > 1e-9)) continue;
            taken.push({ i, share, normal: [m[0] / length, m[1] / length, m[2] / length], overturned: !!dip.overturned, offset });
        } else if (line) {
            const d: Vec3 = [line.direction[0], line.direction[1], line.direction[2]];
            if (known) {
                // The plane nearest the lie that holds the line
                const along = known[0] * d[0] + known[1] * d[1] + known[2] * d[2];
                const m: Vec3 = [known[0] - along * d[0], known[1] - along * d[1], known[2] - along * d[2]];
                const length = Math.hypot(m[0], m[1], m[2]);
                if (!(length > 1e-6)) continue;
                taken.push({ i, share: lineShare, normal: [m[0] / length, m[1] / length, m[2] / length], offset });
            } else taken.push({ i, share: lineShare, direction: d, offset });
        } else continue;
        if (j >= 0) dropped.add(j);
    }
    if (taken.length === 0) return none;
    // (A great many: the nearest to what was put)
    if (taken.length > MAX_READINGS) {
        taken.sort((a, b) => a.share - b.share);
        for (const t of taken.splice(MAX_READINGS)) { const j = lieAt(t.i); if (j >= 0) dropped.delete(j); }
        taken.sort((a, b) => a.i - b.i);
    }
    const dipped = taken.filter(t => t.normal), lined = taken.filter(t => t.direction);
    const readings = dipped.length > 0 ? {
        positions: Float64Array.from(dipped.flatMap(t => [mids[t.i * 3], mids[t.i * 3 + 1], mids[t.i * 3 + 2]])),
        normals: Float64Array.from(dipped.flatMap(t => t.normal!)),
        overturned: Uint8Array.from(dipped.map(t => (t.overturned ? 1 : 0))),
        offsets: Float64Array.from(dipped.map(t => t.offset)),
    } : null;
    const directed = lined.length > 0 ? {
        positions: Float64Array.from(lined.flatMap(t => [mids[t.i * 3], mids[t.i * 3 + 1], mids[t.i * 3 + 2]])),
        directions: Float64Array.from(lined.flatMap(t => t.direction!)),
        offsets: Float64Array.from(lined.map(t => t.offset)),
    } : null;
    let left: LieAt | null = lie;
    if (lie && dropped.size > 0) {
        const keep: number[] = [];
        for (let j = 0; j < nLie; j++) if (!dropped.has(j)) keep.push(j);
        left = keep.length > 0 ? {
            positions: Float64Array.from(keep.flatMap(j => [lie.positions[j * 3], lie.positions[j * 3 + 1], lie.positions[j * 3 + 2]])),
            normals: Float64Array.from(keep.flatMap(j => [lie.normals[j * 3], lie.normals[j * 3 + 1], lie.normals[j * 3 + 2]])),
            offsets: Float64Array.from(keep.map(j => lie.offsets[j])),
        } : null;
    }
    return { lie: left, readings, directed, count: taken.length };
}
