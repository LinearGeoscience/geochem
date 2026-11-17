/**
 * Guides: what the model's direction from place to place (trendField.ts)
 * says at places a sheet passes through (pure, unit-tested).
 *
 * A sheet through the places holes meet it is, between the holes, whatever
 * is smoothest: two holes that meet a contact at the same height give a
 * level surface between them, though the beds in both dip away from each
 * other and the contact must arch between. A guide starts at one of the
 * surface's own places and walks out from it four ways (along the strike
 * and up and down the dip), each step along the ground as the readings say
 * it lies where the step is taken, part of the way to the surface's next
 * place. Where each walk ends is a place the surface is asked to pass
 * through too (sheet.ts). So the surface leaves each hole the way the beds
 * lie, and goes on bending with them.
 *
 * Only where readings say most of how the ground lies, and agree: the
 * model's one direction alone does not bend a sheet, and a place where the
 * readings pull two ways (a hinge seen from both limbs) is left to the
 * surface's own points.
 */
import { cross, dot, unit } from './plane';
import { HOLD_SHARE, nearestOther, pickSpread } from './readings';
import { trendAt, type LocalTrend, type TrendField } from './trendField';
import type { Vec3 } from './types';

/** A surface takes guides at no more than this many of its places (each costs up to six places in the fit), spread through them */
export const MAX_GUIDES = 80;
/** A place takes a guide only where this share of how the ground lies is from readings */
const SPEAKS = 0.5;
/**
 * ... which agree this well (trendField's `agreement`): about within 18
 * degrees of what they blend to. Between two limbs further apart than that
 * the blend is neither limb, and for steep limbs it is the plane that
 * halves the fold, which a folded surface does not lie in anywhere.
 */
const AGREES = 0.9;
/**
 * How far a guide walks: this share of the way to the nearest other place
 * the surface passes through. Short of half, so that the walks from two
 * neighbouring places stop short of each other: they need not agree on
 * where the surface is half-way.
 */
export const WALK_SHARE = 0.4;
/** ... in this many steps */
const STEPS = 4;

/** The guides of a surface as its fit takes them (sheet.ts, GuidePoints), in typed arrays */
export interface GuideSamples {
    /** The surface's own places the guides start from, xyz triples */
    positions: Float64Array;
    /** The unit normal of the plane the ground lies in at each (all zero: not known there; only a direction it runs in is) */
    normals: Float64Array;
    /** How far either side of each a value is put for the two sides of its plane */
    offsets: Float64Array;
    /** Where the walks end: more places the surface passes through, xyz triples */
    places: Float64Array;
    /** A short mark of all of the above: two sets of guides with the same mark are the same */
    mark: string;
}

function markOf(parts: readonly Float64Array[]): string {
    let h = 0x811c9dc5;
    for (const part of parts) {
        const bytes = new Uint8Array(part.buffer, part.byteOffset, part.byteLength);
        for (let i = 0; i < bytes.length; i++) {
            h ^= bytes[i];
            h = Math.imul(h, 0x01000193);
        }
    }
    return (h >>> 0).toString(16).padStart(8, '0');
}

const planeSpeaks = (local: LocalTrend) => !!local.normal && local.fromReadings >= SPEAKS && local.agreement >= AGREES;
const lineSpeaks = (local: LocalTrend) => !local.normal && !!local.line && local.lineFromReadings >= SPEAKS;

/** Two unit directions in the plane square to `n`: along its strike, and down its dip. */
function inPlane(n: ArrayLike<number>): [Vec3, Vec3] {
    const strike = unit(cross(n, [0, 0, 1])) ?? [1, 0, 0];
    return [strike, unit(cross(n, strike)) ?? [0, 1, 0]];
}

/**
 * Walk `far` from a place, setting out in `dir`: each step is taken along
 * the ground as it lies where the step starts (in its plane; or, where only
 * the direction it runs in is known, along that). Past where the readings
 * say, it keeps straight on.
 */
function walk(field: TrendField, from: Vec3, dir: Vec3, far: number, byLine: boolean): Vec3 {
    const step = far / STEPS;
    let at = from, heading = dir;
    for (let s = 0; s < STEPS; s++) {
        const local = trendAt(field, at);
        if (!byLine && planeSpeaks(local)) {
            const off = dot(heading, local.normal!);
            heading = unit([heading[0] - off * local.normal![0], heading[1] - off * local.normal![1], heading[2] - off * local.normal![2]]) ?? heading;
        } else if (byLine && lineSpeaks(local)) {
            const l = local.line!;
            heading = dot(l, heading) < 0 ? [-l[0], -l[1], -l[2]] : [l[0], l[1], l[2]];
        }
        at = [at[0] + step * heading[0], at[1] + step * heading[1], at[2] + step * heading[2]];
    }
    return at;
}

/**
 * The guides for a surface. `points`: the places it could take one at (xyz
 * triples); `taken(i)`: point i has a dip reading of its own, which stands;
 * `through`: every place the surface passes through, these among them (how
 * far a guide walks depends on how near the next place is). Null when the
 * field has no readings, or says nothing at any of the places.
 */
export function sheetGuides(
    field: TrendField | null, points: ArrayLike<number>, through: ArrayLike<number> = points, taken: (i: number) => boolean = () => false,
): GuideSamples | null {
    if (!field || field.planes + field.lines === 0) return null;
    const open: number[] = [];
    for (let i = 0; i * 3 + 2 < points.length; i++) if (!taken(i)) open.push(i);
    // More are looked at than are kept: some say nothing
    const spread = pickSpread(open.flatMap(i => [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]]), 2 * MAX_GUIDES);
    const found: { p: Vec3; local: LocalTrend }[] = [];
    for (const k of spread) {
        const i = open[k];
        const p: Vec3 = [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]];
        const local = trendAt(field, p);
        if (planeSpeaks(local) || lineSpeaks(local)) found.push({ p, local });
    }
    if (found.length === 0) return null;
    const kept = found.length <= MAX_GUIDES ? found : pickSpread(found.flatMap(f => f.p), MAX_GUIDES).map(k => found[k]);
    const positions: number[] = [], normals: number[] = [], offsets: number[] = [], places: number[] = [];
    for (const { p, local } of kept) {
        // A surface with one place only: as far as a reading carries
        const next = nearestOther(p, through);
        const gap = Number.isFinite(next) ? next : field.range;
        positions.push(...p);
        offsets.push(HOLD_SHARE * gap);
        if (local.normal) {
            normals.push(local.normal[0], local.normal[1], local.normal[2]);
            for (const t of inPlane(local.normal)) for (const side of [1, -1]) places.push(...walk(field, p, [side * t[0], side * t[1], side * t[2]], WALK_SHARE * gap, false));
        } else {
            normals.push(0, 0, 0);
            const l = local.line!;
            for (const side of [1, -1]) places.push(...walk(field, p, [side * l[0], side * l[1], side * l[2]], WALK_SHARE * gap, true));
        }
    }
    const out = { positions: Float64Array.from(positions), normals: Float64Array.from(normals), offsets: Float64Array.from(offsets), places: Float64Array.from(places) };
    return { ...out, mark: markOf([out.positions, out.normals, out.offsets, out.places]) };
}
