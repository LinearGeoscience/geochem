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
import { bestFitPlane, cross, dot, orientNormal, sheetTrend, unit, type Trend, type TrendStatus } from './plane';
import { evaluateField, fitField, type FitStats, type FittedField } from './rbf';
import { meshSurface } from './surfaceNets';
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
    /** At each, how far from it its extra values sit (0: the reading is not used) */
    offsets: ArrayLike<number>;
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
    /** At each, how far either side of it a value is put for the two sides of its plane (0: none is) */
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
    /** 0 = through every point; larger = looser */
    smoothing?: number;
}

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

interface Gathered {
    nPlain: number;
    nOriented: number;
    onSurface: Float64Array;
}

function gather(input: SheetInput): Gathered {
    const o = input.oriented;
    const nPlain = Math.floor(input.points.length / 3);
    const nOriented = o ? Math.min(Math.floor(o.positions.length / 3), Math.floor(o.normals.length / 3), o.offsets.length) : 0;
    const onSurface = new Float64Array((nPlain + nOriented) * 3);
    for (let i = 0; i < nPlain * 3; i++) onSurface[i] = input.points[i];
    for (let i = 0; i < nOriented * 3; i++) onSurface[nPlain * 3 + i] = o!.positions[i];
    return { nPlain, nOriented, onSurface };
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
            const a = lines.groups![i] * 3;
            const far = share * (lines.extrude?.[lines.groups![i]] ?? 0);
            if (!(far > 0)) continue;
            for (const side of [1, -1]) for (let k = 0; k < 3; k++) out.push(flat[(g.nPlain + i) * 3 + k] + side * far * lines.across![a + k]);
        }
        return out;
    };

    const trend = sheetTrend(lines ? carried(CARRY, 0) : flat, input.along, input.refDirection);
    let inSlice = !!lines && trend.status !== 'sheet';
    if (trend.status === 'sheet') {
        const n = trend.plane!.normal;
        for (let i = 0; i < g.nOriented && lines && !inSlice; i++) {
            const a = lines.groups![i] * 3;
            inSlice = Math.abs(dot(n, [lines.across![a], lines.across![a + 1], lines.across![a + 2]])) > IN_SLICE;
        }
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

/** The trend plane a sheet would be fitted about (null: not enough to tell). */
export function sheetInputTrend(input: SheetInput): Plane | null {
    const g = gather(input);
    return trendWithReadings(input, g, trendOf(input, g)).plane;
}

/** Two unit directions square to `n` and to each other. */
function tangents(n: ArrayLike<number>): [Vec3, Vec3] {
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

    const trend = trendWithReadings(input, gathered, trendOf(input, gathered));
    if (trend.status === 'empty' || !trend.plane) return { status: 'empty', trend: null, field: null, onSurface, stats: null, lineSigns: new Int8Array(0) };
    const lineSigns = o ? signLines(o, nOriented, trend.plane.normal) : new Int8Array(0);

    const r = input.readings;
    const nReadings = readingCount(r);
    const gd = input.guides;
    const nGuides = guideCount(gd);
    const nValued = input.valued ? Math.min(Math.floor(input.valued.positions.length / 3), input.valued.values.length) : 0;
    const nPlaces = gd ? Math.floor(gd.places.length / 3) : 0;
    const total = nPlain + nOriented * 3 + nValued + nReadings * 6 + nGuides * 2 + nPlaces;
    const points = new Float64Array(total * 3);
    const values = new Float64Array(total);
    points.set(onSurface);
    let w = nPlain + nOriented;
    for (let i = 0; i < nOriented; i++) {
        const d = o!.offsets[i];
        if (!(d > 0)) continue;
        const sign = o!.groups ? lineSigns[o!.groups[i]] : 1;
        for (const side of [1, -1]) {
            for (let k = 0; k < 3; k++) points[w * 3 + k] = o!.positions[i * 3 + k] + side * sign * d * o!.normals[i * 3 + k];
            values[w++] = side * d;
        }
    }
    for (let i = 0; i < nValued; i++) {
        for (let k = 0; k < 3; k++) points[w * 3 + k] = input.valued!.positions[i * 3 + k];
        values[w++] = input.valued!.values[i];
    }
    // A reading: the surface is the measured plane for a little way round it (four places on it,
    // on the plane), and the two sides of that plane are the surface's two sides (a value on each)
    for (let i = 0; i < nReadings; i++) {
        const d = r!.offsets[i];
        if (!(d > 0)) continue;
        const m: Vec3 = [r!.normals[i * 3], r!.normals[i * 3 + 1], r!.normals[i * 3 + 2]];
        const sign = (dot(m, trend.plane.normal) < 0 ? -1 : 1) * (r!.overturned?.[i] ? -1 : 1);
        const at = (v: ArrayLike<number>, far: number, value: number) => {
            for (let k = 0; k < 3; k++) points[w * 3 + k] = r!.positions[i * 3 + k] + far * v[k];
            values[w++] = value;
        };
        for (const t of tangents(m)) for (const side of [1, -1]) at(t, side * d, 0);
        for (const side of [1, -1]) at(m, side * sign * d, side * d);
    }
    // The guides: the places their walks ended are on the surface; and at each guide's own place the
    // two sides of the plane the ground lies in are the surface's two sides. Which is which is only
    // taken from the trend where the two are near enough alike to say
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
        for (const side of [1, -1]) {
            for (let k = 0; k < 3; k++) points[w * 3 + k] = gd!.positions[i * 3 + k] + side * (facing < 0 ? -1 : 1) * d * m[k];
            values[w++] = side * d;
        }
    }
    const fit = fitField(points.subarray(0, w * 3), values.subarray(0, w), { drift: trend.plane, smoothing: input.smoothing });
    if (!fit.ok) return { status: 'failed', trend: trend.plane, field: null, onSurface, stats: null, lineSigns };
    return { status: trend.status, trend: trend.plane, field: fit.field, onSurface, stats: fit.stats, lineSigns };
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

/** Mesh a fitted sheet at a grid cell size, trimmed to its extent. */
export function meshSheet(fit: SheetFit, extent: SheetExtent, cell: number): SheetMesh {
    const none: SheetMesh = { vertices: new Float64Array(0), triangles: new Uint32Array(0), cells: 0, truncated: false };
    const field = fit.field;
    if (!field || !(cell > 0)) return none;
    const { box } = extent;
    // The grid runs a cell past the box so the trimmed edge lands exactly on it
    const grown: Box3 = {
        min: [box.min[0] - cell, box.min[1] - cell, box.min[2] - cell],
        max: [box.max[0] + cell, box.max[1] + cell, box.max[2] + cell],
    };
    const reach = extent.reach && extent.reach > 0 ? extent.reach : null;
    // Searched a little past the reach so vertices just outside get a true distance
    const grid = reach ? new PointGrid(fit.onSurface, reach + 2 * cell) : null;
    const outline = extent.outline ?? null;
    const net = meshSurface({
        evaluate: pts => evaluateField(field, pts),
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
    return { vertices: mesh.vertices, triangles: mesh.triangles, cells: net.cells, truncated: net.truncated };
}
