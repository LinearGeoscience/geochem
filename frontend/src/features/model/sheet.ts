/**
 * Sheets: open surfaces (a fault, a contact) through points that lie on them
 * (pure, unit-tested).
 *
 * The field is the signed distance to the points' trend plane plus a
 * correction that bends it through every point. Where the lie of the surface
 * is known (a line drawn on a section, a dip reading) two more values are
 * added a short way either side of it; that is what lets a sheet fold back
 * over itself: on an overturned limb the known "up side" points against the
 * trend and the field follows it.
 */
import { clipMeshByScalar, clipMeshToBox, PointGrid } from './meshOps';
import { outlineDistance, type OutlineFrame } from './outline';
import { LOOSE_MEASURED, ROUND_SHARE } from './hermite';
import { bestFitPlane, cross, dot, orientNormal, sheetTrend, unit, type Trend, type TrendStatus, RIM_PLACES, rimDirections } from './plane';
import { fitBlended, type BlockCache } from './pou';
import { nearestOther } from './readings';
import { changedPlaces, evaluateField, type FitFailure, type FitStats, type FittedField } from './rbf';
import { meshSurface, type NodeMemory } from './surfaceNets';
import type { Box3, Plane, TriMesh, Vec3 } from './types';

export interface OrientedPoints {
    positions: ArrayLike<number>;
    normals: ArrayLike<number>;
    offsets: ArrayLike<number>;
    /**
     * Lines drawn on slices (features/model/lines.ts). `groups` gives each
     * point's line (0, 1, ...). Along one line the normals all point to the
     * same side of it, but which of its two sides is the surface's positive
     * side is not known beforehand: it is worked out here (lineSigns), and
     * `flipped` (per line) turns a line over.
     */
    groups?: ArrayLike<number>;
    flipped?: ArrayLike<number>;
    /** Per line: the unit normal of the slice it was drawn on, xyz triples */
    across?: ArrayLike<number>;
    /** Per line: how far the line is carried either side of its slice when the trend cannot be told otherwise */
    extrude?: ArrayLike<number>;
    /**
     * Per point: a direction that lies in the surface there, square to the
     * line (the line's ribbon, ribbons.ts; zeros: none). When given, it takes
     * the place of the line's `across` point by point.
     */
    ribbons?: ArrayLike<number>;
}

/**
 * Places on the surface with a line it runs along there (a point given a
 * direction): the surface passes through each, and does not rise or fall
 * along its direction there (see `fitSheet` for how it is held to that).
 */
export interface DirectedPoints {
    positions: ArrayLike<number>;
    /** Unit, xyz triples */
    directions: ArrayLike<number>;
    /** How far either side along the direction (0: not used) */
    offsets: ArrayLike<number>;
}

/**
 * Places on the surface where its lie was measured (a dip and dip
 * direction). Each is also one of `SheetInput.points`: this adds how the
 * surface lies there.
 */
export interface ReadingPoints {
    positions: ArrayLike<number>;
    /** The unit normal of the measured plane at each, either way up, xyz triples */
    normals: ArrayLike<number>;
    /**
     * Which way up the measured plane is taken is the way that agrees with
     * the surface's overall trend. 1 turns a reading over: there the surface
     * is upside down (the overturned limb of a fold).
     */
    overturned?: ArrayLike<number> | null;
    /** At each, how far from it the surface is held to the measured plane (0: the reading is not used): HOLD_SHARE of the way to the nearest other place, or its own reach */
    offsets: ArrayLike<number>;
    /** 1: it is held by values put round it whatever else (see `asSlopes`): it was given a reach of its own, or it is a tick on a line (absent: none is) */
    byValues?: ArrayLike<number> | null;
    /**
     * How far each reading holds the surface to its plane each way round it
     * (RIM_PLACES for each, in the order of plane.ts `rimDirections`; all 0
     * for a reading: the same all round, `offsets`). A reading with a reach
     * and room to use it (readings.ts `rimOf`). Null or absent: none.
     */
    rims?: ArrayLike<number> | null;
}

/**
 * What the model's direction from place to place says about the surface
 * (guides.ts): at some of its own places, the plane the ground lies in
 * there; and more places it passes through, found by walking out from
 * those along the ground as the readings say it lies.
 */
export interface GuidePoints {
    /** The surface's own places the guides start from, xyz triples */
    positions: ArrayLike<number>;
    /** The unit normal of the plane the ground lies in at each, either way up (all zero: not known) */
    normals: ArrayLike<number>;
    /** At each, how far either side of it the surface is held to its plane (0: it is not): HOLD_SHARE of the way to the nearest other place */
    offsets: ArrayLike<number>;
    /** More places the surface passes through, xyz triples */
    places: ArrayLike<number>;
}

export interface SheetInput {
    /** Points on the surface, xyz triples */
    points: ArrayLike<number>;
    /**
     * For each of `points`, the unit normal of the slice it was placed on
     * (xyz triples; all zero: placed freely). The surface crosses that slice.
     */
    pointAcross?: ArrayLike<number> | null;
    /**
     * Points on the surface whose facing is known: position and unit normal
     * (pointing to the surface's positive side) as xyz triples, and how far
     * either side of each the two extra values are placed.
     */
    oriented?: OrientedPoints;
    /** Where the lie of the surface was measured */
    readings?: ReadingPoints | null;
    /** Points with a line the surface runs along there */
    directed?: DirectedPoints | null;
    /** Where the model's direction says how it lies */
    guides?: GuidePoints | null;
    /**
     * Places that are NOT on the surface, with how far from it they are
     * (positive: on its positive side). They hold the surface off without
     * saying where it is.
     */
    valued?: { positions: ArrayLike<number>; values: ArrayLike<number> };
    /** A direction the surface runs in, used while the points only define a line */
    along?: Vec3 | null;
    /** Keeps the positive side on one side as points are added */
    refDirection?: Vec3 | null;
    /**
     * The normal of the overall plane the surface was last fitted about. While
     * the plane these inputs give is within HOLD_DEGREES of it, the fit is made
     * about the held one again: one point moved does not tilt everything.
     */
    holdTo?: Vec3 | null;
    /** 0 = through every point; larger = looser */
    smoothing?: number;
    /** For each of `points`, looseness on top of `smoothing` (null: none): a point of a set that counts for less, or one not on a drillhole when only those are held exactly */
    loose?: ArrayLike<number> | null;
    /** The same for each place of `oriented` (the lines) */
    looseLines?: ArrayLike<number> | null;
    /** Where the field is wanted (the box it is meshed in). Absent: round its points */
    cover?: Box3 | null;
    /** Its blocks as last fitted (pou.ts): with many points it is fitted block by block, and blocks with the same points are not fitted again */
    blocks?: BlockCache | null;
}

/** The overall plane is worked out afresh once the inputs' own would be this far, in degrees, from the one held */
export const HOLD_DEGREES = 5;

export interface SheetFit {
    /** body = closed, with no trend (see body.ts) */
    status: TrendStatus | 'body' | 'failed';
    trend: Plane | null;
    field: FittedField | null;
    /** Every point the surface was asked to pass through (xyz triples): the mesher's starting points */
    onSurface: Float64Array;
    stats: FitStats | null;
    /** Per line: 1 when its normals point to the positive side as given, -1 when the other way */
    lineSigns: Int8Array;
    /** Fitted about a held plane: how far from it, in degrees, the plane the inputs give now is (absent: it was not held) */
    turned?: number;
    /** When it failed: why the fit could not be solved */
    why?: FitFailure;
}

/** A trend within this angle of a slice says the surface lies IN the slice its lines were drawn on: cos(30 degrees) */
const IN_SLICE = 0.866;
/** Every line is carried this share of its length either side of its slice when the trend is worked out */
const CARRY = 0.2;
/** A line follows the earlier lines unless they agree with it at less than this share of its points */
const WEAK = 0.2;
/**
 * A guide says which side of its plane is the surface's positive side only
 * when its plane is within 60 degrees of the surface's trend. Steeper to
 * the trend than that, the plane could be either way up (an upright limb
 * or an overturned one), and only the plane itself is used.
 */
const SURE = 0.5;
/**
 * A dip or a direction is held in one of two ways (the kernel trial of
 * Round 27, hermiteChoice.test.ts, and what followed it).
 *
 * As slopes at its place (rows, hermite.ts), the kernel rounded off over
 * half the usual distance from such a place to the nearest other place the
 * surface passes through. Where the places are spread out (contacts in
 * holes, points placed by hand) this is the better way: on made-up folds
 * drilled at 50 m the surface is a fifth to two thirds nearer the truth
 * between holes.
 *
 * Or by values put round it, a finite distance away, with the kernel as it
 * is: the way it was done before, and still the way wherever places crowd.
 * A rounded kernel cannot turn sharply within its rounding, so places much
 * nearer each other than that which do not agree to the last decimetre (a
 * drawn line's own places and a tick a few degrees out, twinned holes) are
 * fought over: on a made-up fold from lines with ticks 10 degrees out the
 * surface went tens of metres wrong with the rounding 2.8 times the
 * distance between a line's places, was a little worse than by values at
 * 1.4, and no better than by values at any rounding.
 *
 * So slopes are asked only of a surface whose places do not crowd within
 * the rounding: it is no more than CROWDED times the distance within which
 * a tenth of the places have another. And then only at a place with no
 * other nearer than the rounding over CROWDED. Never of a tick on a line,
 * nor of a reading given a reach of its own (which asks for a distance,
 * and only values put that far from it can give one).
 */
const CROWDED = 1.5;
/** At most this many of the surface's places are asked how near their neighbours are */
const CROWD_SAMPLE = 256;

/** The distance at which a surface's places crowd: a tenth of them (of a sample spread through them) have another place nearer than this. Infinity: one place, or none */
function crowding(through: ArrayLike<number>): number {
    const n = Math.floor(through.length / 3);
    const step = Math.max(1, Math.floor(n / CROWD_SAMPLE));
    const near: number[] = [];
    for (let i = 0; i < n; i += step) {
        const d = nearestOther([through[i * 3], through[i * 3 + 1], through[i * 3 + 2]], through);
        if (Number.isFinite(d)) near.push(d);
    }
    near.sort((a, b) => a - b);
    return near.length > 0 ? near[Math.floor(near.length / 10)] : Infinity;
}

/**
 * Which of a surface's dips and directions may be held as slopes, and the
 * rounding of the kernel for them (0: none is). `next`: for each, how far
 * from it the nearest other place of the surface is; `through`: every place
 * the surface passes through.
 */
export function slopeChoice(next: readonly number[], through: ArrayLike<number>): { round: number; held: boolean[] } {
    const held = next.map(() => false);
    if (next.length === 0) return { round: 0, held };
    const known = next.filter(d => Number.isFinite(d)).sort((a, b) => a - b);
    // (Kept to steps of a fifth: a place added does not then change it, and with it every block of a big fit.
    // A place with no other: there is nothing for the rounding to be measured against, nor to fight)
    const round = known.length > 0 ? 2 ** (Math.round(Math.log2(ROUND_SHARE * known[known.length >> 1]) * 4) / 4) : 1;
    if (!(CROWDED * crowding(through) >= round)) return { round: 0, held };
    let any = false;
    next.forEach((d, i) => {
        if (!(d >= round / CROWDED)) return;
        held[i] = true;
        any = true;
    });
    return { round: any ? round : 0, held };
}

/**
 * A reading held as far each way round as it may be (`ReadingPoints.rims`)
 * is held at this many rings of places, evenly spaced out to there.
 * Measured on a level sheet of places 15 m apart, a dip of 25 degrees with
 * a reach of 45 m put 7.5 m past its edge: with one ring the surface bowed
 * up to 0.56 m off the dip's plane between the place and the ring; with
 * two, 0.19 m.
 */
const RIM_RINGS = 2;

/** Which of a sheet's dips and directions are held as slopes, and the rounding of the kernel for them (0: none is) */
interface AsSlopes { round: number; readings: Uint8Array; directed: Uint8Array; guides: Uint8Array }

function asSlopes(input: SheetInput, through: ArrayLike<number>, normal: Vec3): AsSlopes {
    const r = input.readings, dp = input.directed, gd = input.guides;
    const out: AsSlopes = { round: 0, readings: new Uint8Array(readingCount(r)), directed: new Uint8Array(directedCount(dp)), guides: new Uint8Array(guideCount(gd)) };
    const asked: { of: Uint8Array; i: number; next: number }[] = [];
    const consider = (of: Uint8Array, i: number, at: ArrayLike<number>) => asked.push({ of, i, next: nearestOther([at[i * 3], at[i * 3 + 1], at[i * 3 + 2]], through) });
    for (let i = 0; i < out.readings.length; i++) if (r!.offsets[i] > 0 && !r!.byValues?.[i]) consider(out.readings, i, r!.positions);
    for (let i = 0; i < out.directed.length; i++) if (dp!.offsets[i] > 0) consider(out.directed, i, dp!.positions);
    for (let i = 0; i < out.guides.length; i++) {
        if (!(gd!.offsets[i] > 0) || !isSet(gd!.normals, i)) continue;
        if (Math.abs(gd!.normals[i * 3] * normal[0] + gd!.normals[i * 3 + 1] * normal[1] + gd!.normals[i * 3 + 2] * normal[2]) >= SURE) consider(out.guides, i, gd!.positions);
    }
    const choice = slopeChoice(asked.map(o => o.next), through);
    asked.forEach((o, i) => { if (choice.held[i]) o.of[o.i] = 1; });
    out.round = choice.round;
    return out;
}

interface Gathered {
    nPlain: number;
    nOriented: number;
    /** Places either side of the points with a direction (two each, after the rest) */
    nDirected: number;
    onSurface: Float64Array;
}

function directedCount(d: DirectedPoints | null | undefined): number {
    return d ? Math.min(Math.floor(d.positions.length / 3), Math.floor(d.directions.length / 3), d.offsets.length) : 0;
}

function gather(input: SheetInput): Gathered {
    const o = input.oriented;
    const nPlain = Math.floor(input.points.length / 3);
    const nOriented = o ? Math.min(Math.floor(o.positions.length / 3), Math.floor(o.normals.length / 3), o.offsets.length) : 0;
    const dp = input.directed;
    const extra: number[] = [];
    for (let i = 0; i < directedCount(dp); i++) {
        const d = dp!.offsets[i];
        if (!(d > 0)) continue;
        for (const side of [1, -1]) for (let k = 0; k < 3; k++) extra.push(dp!.positions[i * 3 + k] + side * d * dp!.directions[i * 3 + k]);
    }
    const onSurface = new Float64Array((nPlain + nOriented) * 3 + extra.length);
    for (let i = 0; i < nPlain * 3; i++) onSurface[i] = input.points[i];
    for (let i = 0; i < nOriented * 3; i++) onSurface[nPlain * 3 + i] = o!.positions[i];
    onSurface.set(extra, (nPlain + nOriented) * 3);
    return { nPlain, nOriented, nDirected: extra.length / 3, onSurface };
}

/**
 * The trend plane of a sheet's input: the best-fit plane of what it passes
 * through, with two things put right for input made on slices.
 *
 * A folded line spreads further across its fold than a few close sections
 * spread along it, and the best-fit plane of such lines is the section
 * itself. So each line stands in as the straight line between its two ends:
 * the fold is taken out, where the line sits and which way it runs are kept.
 *
 * And lines or points all made on one slice lie in that slice, and so does
 * their best-fit plane; but a surface CROSSES the slice it is marked on. So
 * each line is carried a little way straight through its slice, either side
 * (a ribbon): one line alone then gives a plane, and lines on sections close
 * together do not swing the trend round by where each happens to end, while
 * sections spread well apart still say how the surface runs between them.
 * Whenever the trend still comes out lying in a slice (strokes on one section
 * that are not in line, points picked on one section), what was made on
 * slices is carried right through, and the trend is the plane of that.
 */
function trendOf(input: SheetInput, g: Gathered): Trend {
    const o = input.oriented;
    const lines = o?.groups && o.across && g.nOriented > 0 ? o : null;
    // What lies in the surface at a point of a line: its own ribbon, or its line's slice normal
    const ribbon = (i: number): ArrayLike<number> => {
        const r = lines!.ribbons;
        if (r) return [r[i * 3], r[i * 3 + 1], r[i * 3 + 2]];
        const a = lines!.groups![i] * 3;
        return [lines!.across![a], lines!.across![a + 1], lines!.across![a + 2]];
    };
    const pa = input.pointAcross;
    const acrossPoint = (i: number): [number, number, number] | null =>
        (pa && i * 3 + 2 < pa.length && (pa[i * 3] !== 0 || pa[i * 3 + 1] !== 0 || pa[i * 3 + 2] !== 0) ? [pa[i * 3], pa[i * 3 + 1], pa[i * 3 + 2]] : null);

    // Each line as the straight line between its ends
    const flat = lines ? g.onSurface.slice() : g.onSurface;
    if (lines) {
        const members = new Map<number, number[]>();
        for (let i = 0; i < g.nOriented; i++) {
            const list = members.get(lines.groups![i]);
            if (list) list.push(i);
            else members.set(lines.groups![i], [i]);
        }
        const p = lines.positions;
        for (const [group, own] of members) {
            const a = own[0] * 3, b = own[own.length - 1] * 3;
            let base = [p[a], p[a + 1], p[a + 2]];
            let dir = unit([p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]]);
            const chord = Math.hypot(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]);
            if (!dir || chord < 0.25 * (lines.extrude?.[group] ?? 0)) {
                // It ends near where it starts: the direction it is longest in
                const fit = bestFitPlane(own.flatMap(i => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]));
                if (!fit) continue;
                base = fit.point;
                dir = fit.along;
            }
            for (const i of own) {
                const t = (p[i * 3] - base[0]) * dir[0] + (p[i * 3 + 1] - base[1]) * dir[1] + (p[i * 3 + 2] - base[2]) * dir[2];
                for (let k = 0; k < 3; k++) flat[(g.nPlain + i) * 3 + k] = base[k] + t * dir[k];
            }
        }
    }

    /** `flat`, with each line carried `share` of its length either side of its slice, and each slice-placed point `reach` */
    const carried = (share: number, reach: number): ArrayLike<number> => {
        const out: number[] = Array.from(flat);
        for (let i = 0; i < g.nPlain && reach > 0; i++) {
            const across = acrossPoint(i);
            if (!across) continue;
            for (const side of [1, -1]) for (let k = 0; k < 3; k++) out.push(flat[i * 3 + k] + side * reach * across[k]);
        }
        for (let i = 0; i < g.nOriented && lines; i++) {
            const far = share * (lines.extrude?.[lines.groups![i]] ?? 0);
            if (!(far > 0)) continue;
            const r = ribbon(i);
            for (const side of [1, -1]) for (let k = 0; k < 3; k++) out.push(flat[(g.nPlain + i) * 3 + k] + side * far * r[k]);
        }
        return out;
    };

    const trend = sheetTrend(lines ? carried(CARRY, 0) : flat, input.along, input.refDirection);
    let inSlice = !!lines && trend.status !== 'sheet';
    if (trend.status === 'sheet') {
        const n = trend.plane!.normal;
        for (let i = 0; i < g.nOriented && lines && !inSlice; i++) inSlice = Math.abs(dot(n, ribbon(i))) > IN_SLICE;
        for (let i = 0; i < g.nPlain && !inSlice; i++) {
            const across = acrossPoint(i);
            inSlice = !!across && Math.abs(dot(n, across)) > IN_SLICE;
        }
    }
    if (!inSlice) return trend;

    // A point is carried as far as the whole input is wide
    let size = 0;
    for (let k = 0; k < 3; k++) {
        let lo = Infinity, hi = -Infinity;
        for (let i = k; i < flat.length; i += 3) {
            if (flat[i] < lo) lo = flat[i];
            if (flat[i] > hi) hi = flat[i];
        }
        size = Math.max(size, hi - lo);
    }
    return sheetTrend(carried(1, size), input.along, input.refDirection);
}

function readingCount(r: ReadingPoints | null | undefined): number {
    return r ? Math.min(Math.floor(r.positions.length / 3), Math.floor(r.normals.length / 3), r.offsets.length) : 0;
}

function guideCount(g: GuidePoints | null | undefined): number {
    return g ? Math.min(Math.floor(g.positions.length / 3), Math.floor(g.normals.length / 3), g.offsets.length) : 0;
}

const isSet = (v: ArrayLike<number>, i: number) => v[i * 3] !== 0 || v[i * 3 + 1] !== 0 || v[i * 3 + 2] !== 0;

/**
 * The trend with the readings taken into account. Where the points alone
 * give a plane the readings do not change it (they bend the surface where
 * they are). Where the points cannot say (one point, or points in a line) a
 * reading can: one measured point is a whole plane, and a line with a
 * reading on it is the plane through the line that lies closest to what was
 * measured. A guide counts as a reading does (a contact met by one fence of
 * holes takes its tilt across the fence from the readings round it).
 */
function trendWithReadings(input: SheetInput, g: Gathered, trend: Trend): Trend {
    const r = input.readings, gd = input.guides;
    const n = readingCount(r), nGuides = guideCount(gd);
    if (n + nGuides === 0 || trend.status === 'sheet' || g.onSurface.length < 3) return trend;
    // The measured planes' normals (then the guides'), all the same way up as the first
    const mean: Vec3 = [0, 0, 0];
    const count_ = (normals: ArrayLike<number>, i: number) => {
        const v: Vec3 = [normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]];
        const sign = dot(v, mean) < 0 ? -1 : 1;
        for (let k = 0; k < 3; k++) mean[k] += sign * v[k];
    };
    for (let i = 0; i < n; i++) if (r!.offsets[i] > 0) count_(r!.normals, i);
    for (let i = 0; i < nGuides; i++) if (gd!.offsets[i] > 0 && isSet(gd!.normals, i)) count_(gd!.normals, i);
    let normal = unit(mean);
    if (!normal) return trend;
    const centre: Vec3 = [0, 0, 0];
    const count = g.onSurface.length / 3;
    for (let i = 0; i < g.onSurface.length; i++) centre[i % 3] += g.onSurface[i] / count;
    if (trend.status === 'line') {
        const line = bestFitPlane(g.onSurface)?.along;
        if (!line) return trend;
        // The part of what was measured that is square to the line
        const k = dot(normal, line);
        const across: Vec3 = [normal[0] - line[0] * k, normal[1] - line[1] * k, normal[2] - line[2] * k];
        // Measured square to the line it sits on: it says nothing about the tilt round the line
        if (Math.hypot(across[0], across[1], across[2]) < 0.05) return trend;
        normal = unit(across)!;
    }
    return { status: 'sheet', plane: { point: centre, normal: orientNormal(normal, input.refDirection) } };
}

/** `box` grown to hold these points too (the box round them alone without one) */
export function coverOf(points: ArrayLike<number>, box: Box3 | null): Box3 {
    const min: Vec3 = box ? [box.min[0], box.min[1], box.min[2]] : [Infinity, Infinity, Infinity];
    const max: Vec3 = box ? [box.max[0], box.max[1], box.max[2]] : [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i + 2 < points.length; i += 3) for (let k = 0; k < 3; k++) {
        const v = points[i + k];
        if (v < min[k]) min[k] = v;
        if (v > max[k]) max[k] = v;
    }
    return min[0] <= max[0] ? { min, max } : { min: [0, 0, 0], max: [1, 1, 1] };
}

/** The trend plane a sheet would be fitted about were none held (null: not enough to tell). */
export function sheetInputTrend(input: SheetInput): Plane | null {
    const g = gather(input);
    return trendWithReadings(input, g, trendOf(input, g)).plane;
}

/**
 * The plane a fit is made about: the one the inputs give, or the held one
 * (the same way up) while the two are within HOLD_DEGREES. A plane the points
 * cannot give by themselves (they are in a line) is never held.
 */
function heldTrend(trend: Trend, holdTo: Vec3 | null | undefined): { trend: Trend; turned?: number } {
    const held = holdTo ? unit(holdTo) : null;
    if (!held || trend.status !== 'sheet' || !trend.plane) return { trend };
    const c = dot(held, trend.plane.normal);
    const turned = Math.acos(Math.min(1, Math.abs(c))) * 180 / Math.PI;
    if (turned > HOLD_DEGREES) return { trend };
    // (Given back exactly as it was held, when it is the same way up: nothing then differs from the last fit)
    const normal: Vec3 = c < 0 ? [-held[0], -held[1], -held[2]] : [holdTo![0], holdTo![1], holdTo![2]];
    return { trend: { status: 'sheet', plane: { point: trend.plane.point, normal } }, turned };
}

/** Two unit directions square to `n` and to each other. */
export function tangents(n: ArrayLike<number>): [Vec3, Vec3] {
    const other: Vec3 = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const t1 = unit(cross(n, other)) ?? [1, 0, 0];
    return [t1, unit(cross(n, t1)) ?? [0, 1, 0]];
}

/**
 * Which side of each line is the surface's positive side.
 *
 * The first line agrees with the trend over most of its length (so an
 * overturned stretch of it faces against the trend, which is the point).
 * Each later line agrees with the lines before it, compared where they are
 * closest: sections through one fold look alike, so they come out the same
 * way up even where the trend alone could not say. A flipped line is turned
 * over, and later lines follow it.
 */
function signLines(o: OrientedPoints, count: number, normal: ArrayLike<number>): Int8Array {
    const groups = o.groups;
    let lines = o.flipped?.length ?? 0;
    if (groups) for (let i = 0; i < count; i++) lines = Math.max(lines, groups[i] + 1);
    const signs = new Int8Array(lines).fill(1);
    if (!groups) return signs;
    const p = o.positions, n = o.normals;
    const usable = (i: number) => o.offsets[i] > 0;
    for (let g = 0; g < lines; g++) {
        let withEarlier = 0, withTrend = 0, own = 0;
        for (let i = 0; i < count; i++) {
            if (groups[i] !== g || !usable(i)) continue;
            own++;
            withTrend += n[i * 3] * normal[0] + n[i * 3 + 1] * normal[1] + n[i * 3 + 2] * normal[2];
            let best = Infinity, at = -1;
            for (let j = 0; j < count; j++) {
                if (groups[j] >= g || !usable(j)) continue;
                const d = (p[i * 3] - p[j * 3]) ** 2 + (p[i * 3 + 1] - p[j * 3 + 1]) ** 2 + (p[i * 3 + 2] - p[j * 3 + 2]) ** 2;
                if (d < best) { best = d; at = j; }
            }
            if (at >= 0) withEarlier += signs[groups[at]] * (n[i * 3] * n[at * 3] + n[i * 3 + 1] * n[at * 3 + 1] + n[i * 3 + 2] * n[at * 3 + 2]);
        }
        const score = Math.abs(withEarlier) >= WEAK * own ? withEarlier : withTrend;
        signs[g] = ((score < 0 ? -1 : 1) * (o.flipped?.[g] ? -1 : 1)) as 1 | -1;
    }
    return signs;
}

export function fitSheet(input: SheetInput): SheetFit {
    const o = input.oriented;
    const gathered = gather(input);
    const { nPlain, nOriented, onSurface } = gathered;

    const { trend, turned } = heldTrend(trendWithReadings(input, gathered, trendOf(input, gathered)), input.holdTo);
    const held = turned === undefined ? {} : { turned };
    if (trend.status === 'empty' || !trend.plane) return { status: 'empty', trend: null, field: null, onSurface, stats: null, lineSigns: new Int8Array(0) };
    const lineSigns = o ? signLines(o, nOriented, trend.plane.normal) : new Int8Array(0);

    const r = input.readings;
    const nReadings = readingCount(r);
    const gd = input.guides;
    const nGuides = guideCount(gd);
    const nValued = input.valued ? Math.min(Math.floor(input.valued.positions.length / 3), input.valued.values.length) : 0;
    const nPlaces = gd ? Math.floor(gd.places.length / 3) : 0;
    const dp = input.directed;
    const total = nPlain + nOriented * 3 + gathered.nDirected + nValued + nReadings * (r?.rims ? RIM_PLACES * RIM_RINGS + 2 : 6) + nGuides * 3 + nPlaces;
    const points = new Float64Array(total * 3);
    const values = new Float64Array(total);
    // (Every place on the surface has the value 0)
    const through = onSurface.subarray(0, (nPlain + nOriented) * 3);
    points.set(through);
    // A dip or a direction is held in one of two ways (asSlopes). As slopes at its place (rows, rbf.ts): how fast the
    // field changes along a direction there; a dip is three (none along two directions in its plane, a metre a metre
    // across it), a line the surface holds is one. Or, where places crowd, by values put round it, a finite distance away
    const rows = asSlopes(input, through, trend.plane.normal);
    const slopes = rows.round > 0 ? new Float64Array(total * 3) : null;
    // Places that count for less than the rest: the field may miss them by more
    const loose = input.loose || input.looseLines || rows.guides.some(g => g === 1) ? new Float64Array(total) : null;
    if (loose && input.loose) for (let i = 0; i < nPlain; i++) loose[i] = input.loose[i] > 0 ? input.loose[i] : 0;
    const lineLoose = (i: number) => (input.looseLines && input.looseLines[i] > 0 ? input.looseLines[i] : 0);
    if (loose && input.looseLines) for (let i = 0; i < nOriented; i++) loose[nPlain + i] = lineLoose(i);
    let w = nPlain + nOriented;
    const slope = (at: ArrayLike<number>, q: number, along: ArrayLike<number>, sign: number, value: number, looseness: number) => {
        for (let k = 0; k < 3; k++) {
            points[w * 3 + k] = at[q * 3 + k];
            slopes![w * 3 + k] = sign * along[k];
        }
        if (loose) loose[w] = looseness;
        values[w++] = value;
    };
    const plane = (at: ArrayLike<number>, q: number, m: Vec3, sign: number, looseness = 0) => {
        for (const t of tangents(m)) slope(at, q, t, 1, 0, looseness);
        slope(at, q, m, sign, 1, looseness);
    };
    // A point with a direction: the surface does not rise or fall along it there; or it passes through a place either side of it along it
    for (let i = 0, k = 0; i < rows.directed.length; i++) {
        if (!(dp!.offsets[i] > 0)) continue;
        if (rows.directed[i]) slope(dp!.positions, i, [dp!.directions[i * 3], dp!.directions[i * 3 + 1], dp!.directions[i * 3 + 2]], 1, 0, 0);
        else {
            points.set(onSurface.subarray((nPlain + nOriented + 2 * k) * 3, (nPlain + nOriented + 2 * k + 2) * 3), w * 3);
            w += 2;
        }
        k++;
    }
    for (let i = 0; i < nOriented; i++) {
        const d = o!.offsets[i];
        if (!(d > 0)) continue;
        const sign = o!.groups ? lineSigns[o!.groups[i]] : 1;
        for (const side of [1, -1]) {
            for (let k = 0; k < 3; k++) points[w * 3 + k] = o!.positions[i * 3 + k] + side * sign * d * o!.normals[i * 3 + k];
            if (loose) loose[w] = lineLoose(i);
            values[w++] = side * d;
        }
    }
    for (let i = 0; i < nValued; i++) {
        for (let k = 0; k < 3; k++) points[w * 3 + k] = input.valued!.positions[i * 3 + k];
        values[w++] = input.valued!.values[i];
    }
    // A reading: the surface lies in the measured plane there, the two sides of that plane its two sides. By values:
    // it is the measured plane for a little way round it (four places on it), with a value either side of that plane
    for (let i = 0; i < nReadings; i++) {
        const d = r!.offsets[i];
        if (!(d > 0)) continue;
        const m: Vec3 = [r!.normals[i * 3], r!.normals[i * 3 + 1], r!.normals[i * 3 + 2]];
        const sign = (dot(m, trend.plane.normal) < 0 ? -1 : 1) * (r!.overturned?.[i] ? -1 : 1);
        if (rows.readings[i]) {
            plane(r!.positions, i, m, sign);
            continue;
        }
        const at = (v: ArrayLike<number>, far: number, value: number) => {
            for (let k = 0; k < 3; k++) points[w * 3 + k] = r!.positions[i * 3 + k] + far * v[k];
            values[w++] = value;
        };
        // (With a reach of its own and room to use it: as far each way round as it may be held)
        const rim = r!.rims && r!.rims[i * RIM_PLACES] > 0 ? r!.rims : null;
        if (rim) for (let ring = 1; ring <= RIM_RINGS; ring++) rimDirections(m).forEach((u, k) => at(u, (ring / RIM_RINGS) * rim[i * RIM_PLACES + k], 0));
        else for (const t of tangents(m)) for (const side of [1, -1]) at(t, side * d, 0);
        for (const side of [1, -1]) at(m, side * sign * d, side * d);
    }
    // The guides: the places their walks ended are on the surface; and at each guide's own place the
    // two sides of the plane the ground lies in are the surface's two sides. Which is which is only
    // taken from the trend where the two are near enough alike to say. As slopes they are held a little
    // loosely: what the ground says comes from measurements, which are a few degrees out
    for (let i = 0; i < nPlaces; i++) {
        for (let k = 0; k < 3; k++) points[w * 3 + k] = gd!.places[i * 3 + k];
        values[w++] = 0;
    }
    for (let i = 0; i < nGuides; i++) {
        const d = gd!.offsets[i];
        if (!(d > 0) || !isSet(gd!.normals, i)) continue;
        const m: Vec3 = [gd!.normals[i * 3], gd!.normals[i * 3 + 1], gd!.normals[i * 3 + 2]];
        const facing = dot(m, trend.plane.normal);
        if (Math.abs(facing) < SURE) continue;
        if (rows.guides[i]) {
            plane(gd!.positions, i, m, facing < 0 ? -1 : 1, LOOSE_MEASURED);
            continue;
        }
        for (const side of [1, -1]) {
            for (let k = 0; k < 3; k++) points[w * 3 + k] = gd!.positions[i * 3 + k] + side * (facing < 0 ? -1 : 1) * d * m[k];
            values[w++] = side * d;
        }
    }
    // Fitted to what is left after its overall plane: in one go, or block by block when there are a great many places
    const fitted = points.subarray(0, w * 3);
    const fit = fitBlended(fitted, values.subarray(0, w), {
        drift: trend.plane, smoothing: input.smoothing, loose: loose ? loose.subarray(0, w) : null,
        cover: coverOf(fitted, input.cover ?? null), reuse: input.blocks ?? null,
        // (With no slope among them the fit is the one it was before there were any)
        ...(slopes ? { slopes: slopes.subarray(0, w * 3), round: rows.round } : {}),
    });
    if (!fit.ok) return { status: 'failed', trend: trend.plane, field: null, onSurface, stats: null, lineSigns, why: fit.reason };
    return { status: trend.status, trend: trend.plane, field: fit.field, onSurface, stats: fit.stats, lineSigns, ...held };
}

export interface SheetExtent {
    /** The surface never leaves this box */
    box: Box3;
    /** When set, the surface also stops this far from the nearest point it was fitted through */
    reach?: number | null;
    /** When set, the surface is also kept inside this outline */
    outline?: OutlineFrame | null;
}

export interface SheetMesh extends TriMesh {
    cells: number;
    truncated: boolean;
    /** Grid nodes whose value was worked out, and how many more were as they were last time */
    evaluations?: number;
    reused?: number;
}

/** What a sheet's last mesh left to be used again: its field and the values at its grid nodes */
export interface SheetMemory {
    field: FittedField;
    nodes: NodeMemory;
}

/**
 * Places where the surface passes inside an outline, for the mesher to start
 * from: the outline may be drawn where none of the surface's own points lie.
 * Found by walking through the box along the outline's direction, from a few
 * places inside it, to where the field changes sign.
 */
function seedsInside(field: FittedField, outline: OutlineFrame, box: Box3): number[] {
    const n = cross(outline.u, outline.v);
    const corners = outline.xy.length / 2;
    let cx = 0, cy = 0;
    for (let i = 0; i < corners; i++) { cx += outline.xy[i * 2] / corners; cy += outline.xy[i * 2 + 1] / corners; }
    // The middle, and part-way from it to each corner (an outline can bend round its own middle)
    const starts: [number, number][] = [[cx, cy]];
    for (let i = 0; i < corners; i++) for (const f of [0.5, 0.85]) starts.push([cx + (outline.xy[i * 2] - cx) * f, cy + (outline.xy[i * 2 + 1] - cy) * f]);
    const STEPS = 64;
    const seeds: number[] = [];
    const at = new Float64Array(3);
    const value = (p: number[], t: number) => {
        at[0] = p[0] + n[0] * t; at[1] = p[1] + n[1] * t; at[2] = p[2] + n[2] * t;
        return evaluateField(field, at)[0];
    };
    for (const [x, y] of starts) {
        const p = [0, 1, 2].map(k => outline.origin[k] + outline.u[k] * x + outline.v[k] * y);
        if (outlineDistance(outline, p[0], p[1], p[2]) >= 0) continue;
        // The stretch of the line through p that is inside the box
        let t0 = -Infinity, t1 = Infinity;
        for (let k = 0; k < 3; k++) {
            if (Math.abs(n[k]) < 1e-12) {
                if (p[k] < box.min[k] || p[k] > box.max[k]) t0 = Infinity;
                continue;
            }
            const a = (box.min[k] - p[k]) / n[k], b = (box.max[k] - p[k]) / n[k];
            t0 = Math.max(t0, Math.min(a, b));
            t1 = Math.min(t1, Math.max(a, b));
        }
        if (!(t1 > t0)) continue;
        let prevT = t0, prev = value(p, t0);
        for (let s = 1; s <= STEPS; s++) {
            const t = t0 + (t1 - t0) * s / STEPS;
            const f = value(p, t);
            if ((prev <= 0) !== (f <= 0)) {
                let lo = prevT, hi = t, flo = prev;
                for (let it = 0; it < 30; it++) {
                    const mid = (lo + hi) / 2, fm = value(p, mid);
                    if ((flo <= 0) === (fm <= 0)) { lo = mid; flo = fm; } else hi = mid;
                }
                const hit = (lo + hi) / 2;
                seeds.push(p[0] + n[0] * hit, p[1] + n[1] * hit, p[2] + n[2] * hit);
            }
            prevT = t;
            prev = f;
        }
    }
    return seeds;
}

/**
 * Where the grid lines are, as shares of a cell past whole multiples of the
 * cell size. Not zero: points at round coordinates would then sit exactly on
 * the corners of cells, where the fitted value is zero give or take the last
 * digit, and the mesh there would be decided by rounding.
 */
export const GRID_SHIFT: Vec3 = [0.381966, 0.618034, 0.236068];

/**
 * The box a surface is meshed in: `box` and a cell more all round (so the
 * trimmed edge lands exactly on the box), out to the next grid line. The grid
 * lines are fixed to the ground (a whole number of cells, and GRID_SHIFT of
 * one, from the origin of the coordinates), wherever the box is: when the box
 * grows or shrinks, the cells that were there stay where they were.
 */
export function gridBox(box: Box3, cell: number): Box3 {
    const down = (v: number, k: number) => (Math.floor(v / cell - GRID_SHIFT[k] - 1) + GRID_SHIFT[k]) * cell;
    const up = (v: number, k: number) => (Math.ceil(v / cell - GRID_SHIFT[k] + 1) + GRID_SHIFT[k]) * cell;
    return { min: [down(box.min[0], 0), down(box.min[1], 1), down(box.min[2], 2)], max: [up(box.max[0], 0), up(box.max[1], 1), up(box.max[2], 2)] };
}

/**
 * Mesh a fitted sheet at a grid cell size, trimmed to its extent. Given what
 * the last mesh of it left (`last`), the field is worked out again only where
 * it can have changed: the mesh is the same as without, sooner. `kept`, when
 * given, is handed what this mesh leaves for the next.
 */
export function meshSheet(fit: SheetFit, extent: SheetExtent, cell: number, last?: SheetMemory | null, kept?: (memory: SheetMemory) => void): SheetMesh {
    const none: SheetMesh = { vertices: new Float64Array(0), triangles: new Uint32Array(0), cells: 0, truncated: false };
    const field = fit.field;
    if (!field || !(cell > 0)) return none;
    const { box } = extent;
    const grown = gridBox(box, cell);
    const reach = extent.reach && extent.reach > 0 ? extent.reach : null;
    // Searched a little past the reach so vertices just outside get a true distance
    const grid = reach ? new PointGrid(fit.onSurface, reach + 2 * cell) : null;
    const outline = extent.outline ?? null;
    // Where the field may differ from the one the last mesh was drawn from (null: anywhere)
    const changed = last ? changedPlaces(last.field, field) : null;
    const net = meshSurface({
        evaluate: pts => evaluateField(field, pts),
        grid: { shift: GRID_SHIFT },
        last: changed ? { memory: last!.nodes, still: (x, y, z) => !changed.some(b => x >= b.min[0] && x <= b.max[0] && y >= b.min[1] && y <= b.max[1] && z >= b.min[2] && z <= b.max[2]) } : null,
        box: grown, cell, seeds: outline ? [...fit.onSurface, ...seedsInside(field, outline, box)] : fit.onSurface,
        keep: grid || outline
            ? (x, y, z) => (!grid || grid.distance(x, y, z) < reach! + 1.5 * cell) && (!outline || outlineDistance(outline, x, y, z) < 1.5 * cell)
            : undefined,
    });
    let mesh: TriMesh = clipMeshToBox(net, box);
    if (grid) {
        const n = mesh.vertices.length / 3;
        const g = new Float64Array(n);
        for (let i = 0; i < n; i++) g[i] = grid.distance(mesh.vertices[i * 3], mesh.vertices[i * 3 + 1], mesh.vertices[i * 3 + 2]) - reach!;
        mesh = clipMeshByScalar(mesh, g);
    }
    if (outline) {
        const n = mesh.vertices.length / 3;
        const g = new Float64Array(n);
        for (let i = 0; i < n; i++) g[i] = outlineDistance(outline, mesh.vertices[i * 3], mesh.vertices[i * 3 + 1], mesh.vertices[i * 3 + 2]);
        mesh = clipMeshByScalar(mesh, g);
    }
    if (kept && net.memory) kept({ field, nodes: net.memory });
    return { vertices: mesh.vertices, triangles: mesh.triangles, cells: net.cells, truncated: net.truncated, evaluations: net.evaluations, reused: net.reused };
}
