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
import { cross, dot, planeOfMany, unit } from './plane';
import { HOLD_SHARE, MAX_READINGS, nearestOther, pickSpread } from './readings';
import { trendAt, type LocalTrend, type TrendField } from './trendField';
import type { Vec3 } from './types';

/** A surface takes guides at no more than this many of its places (each costs three rows in the fit), spread through them */
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

/** The middles of this many stretches or more give a vein a plane of its own to be held to */
const VEIN_PLANE_FROM = 4;

/**
 * How a vein's reference surface lies at the middles of its stretches (xyz
 * triples), for a vein that is held to the lie of the ground (vein.ts): at
 * each, the plane the structural data gives there, where readings say most
 * of it and agree; elsewhere the plane the middles themselves lie closest
 * to (or `plane`, its unit normal, when the vein's sheets are known to lie
 * another way: given, or as the logging carries from hole to hole). Each
 * holds the surface a quarter of the way to the nearest other middle, as a
 * dip measured there would. No walks: `places` is empty. Null when neither
 * says anything (no readings near, and too few middles, or middles in no
 * plane).
 */
export function veinGuides(field: TrendField | null, middles: ArrayLike<number>, plane: Vec3 | null = null): GuideSamples | null {
    const n = Math.floor(middles.length / 3);
    if (n === 0) return null;
    const own = plane ?? planeOfMany(middles, VEIN_PLANE_FROM);
    const speaks = field && field.planes > 0 ? field : null;
    if (!own && !speaks) return null;
    const chosen = n <= MAX_READINGS ? Array.from({ length: n }, (_, i) => i) : pickSpread(middles, MAX_READINGS);
    const positions: number[] = [], normals: number[] = [], offsets: number[] = [];
    for (const i of chosen) {
        const p: Vec3 = [middles[i * 3], middles[i * 3 + 1], middles[i * 3 + 2]];
        const local = speaks ? trendAt(speaks, p) : null;
        const normal = local && planeSpeaks(local) ? local.normal! : own;
        if (!normal) continue;
        const next = nearestOther(p, middles);
        positions.push(...p);
        normals.push(normal[0], normal[1], normal[2]);
        offsets.push(HOLD_SHARE * (Number.isFinite(next) ? next : speaks ? speaks.range : 4));
    }
    if (positions.length === 0) return null;
    const out = { positions: Float64Array.from(positions), normals: Float64Array.from(normals), offsets: Float64Array.from(offsets), places: new Float64Array(0) };
    return { ...out, mark: markOf([out.positions, out.normals, out.offsets, out.places]) };
}

/** For the plane a vein's sheets lie in to be taken from the structural data, the data must say how the ground lies at this many of its stretches, and at this share of them */
const DATA_PLANE_FROM = 5;
const DATA_PLANE_SHARE = 0.2;
/** ... and what it says at them must be this much alike (how long their mean pole is, of 1: 0.94 is two halves 40 degrees apart) */
const DATA_PLANE_ALIKE = 0.94;

/**
 * The plane the sheets of a vein lie in, as the structural data it follows
 * says at the middles of its stretches (xyz triples): the mean of the planes
 * the data gives where readings say most of it and agree. Its unit normal,
 * upward. Null when the data says so at too few of the stretches, or says
 * things too unlike for one plane to stand for them.
 */
export function veinDataPlane(field: TrendField | null, middles: ArrayLike<number>): Vec3 | null {
    const n = Math.floor(middles.length / 3);
    if (!field || !(field.planes > 0) || n === 0) return null;
    const chosen = n <= MAX_READINGS ? Array.from({ length: n }, (_, i) => i) : pickSpread(middles, MAX_READINGS);
    const said: Vec3[] = [];
    for (const i of chosen) {
        const local = trendAt(field, [middles[i * 3], middles[i * 3 + 1], middles[i * 3 + 2]]);
        if (planeSpeaks(local)) said.push(local.normal!);
    }
    if (said.length < DATA_PLANE_FROM || said.length < DATA_PLANE_SHARE * chosen.length) return null;
    // Their mean pole, each taken the way up that agrees with the rest (twice: the first is only a start)
    let mean: Vec3 = said[0];
    for (let pass = 0; pass < 2; pass++) {
        const sum: Vec3 = [0, 0, 0];
        for (const m of said) { const sign = dot(m, mean) < 0 ? -1 : 1; sum[0] += sign * m[0]; sum[1] += sign * m[1]; sum[2] += sign * m[2]; }
        const length = Math.hypot(sum[0], sum[1], sum[2]);
        if (!(length >= DATA_PLANE_ALIKE * said.length) && pass === 1) return null;
        if (!(length > 0)) return null;
        mean = [sum[0] / length, sum[1] / length, sum[2] / length];
    }
    return mean[2] < 0 ? [-mean[0], -mean[1], -mean[2]] : mean;
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
