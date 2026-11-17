/**
 * The small cross-section the "how surfaces are fitted" guide draws on
 * (pure, unit-tested). The pictures are worked out with the solver the
 * surfaces themselves are fitted with (features/model/rbf), on a section
 * 500 m wide and 300 m high.
 */
import { buildPotential, potentialAt } from '../../model/frame';
import { findIntercepts } from '../../model/intercepts';
import { normalFromDip } from '../../model/plane';
import { evaluateField, fitField, readField, stretchPoints, type FittedField, type Stretch } from '../../model/rbf';
import { aboveCutoff, DEFAULT_LOCAL, DEFAULT_SHARE, indicatorValues } from '../../model/shell';
import { readingsFromHighs } from '../../model/suggest';
import { smoothingFromFollow } from '../../model/surfaceJobs';
import type { Plane } from '../../model/types';

/** A place on the section: metres along it, and elevation */
export type Pt = [number, number];

export const WIDTH = 500;
export const HEIGHT = 300;
/** The number is worked out at the corners of squares this size */
export const STEP = 6.25;
export const NX = WIDTH / STEP;
export const NZ = HEIGHT / STEP;

/** The corners of the squares, as places in space (the section is the plane y = 0) */
const NODES = (() => {
    const out = new Float64Array((NX + 1) * (NZ + 1) * 3);
    for (let j = 0, q = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++, q += 3) {
        out[q] = i * STEP;
        out[q + 2] = j * STEP;
    }
    return out;
})();

const flat = (points: readonly Pt[]) => Float64Array.from(points.flatMap(p => [p[0], 0, p[1]]));

/** The number at every corner of the grid (row by row from the bottom) */
export const gridValues = (field: FittedField): Float64Array => evaluateField(field, NODES);

/** The number at some places */
export const valuesAt = (field: FittedField, points: readonly Pt[]): Float64Array => evaluateField(field, flat(points));

/**
 * The straight line that best fits the points (as a plane seen edge-on):
 * through their middle, along the direction they spread furthest. Its upper
 * side is the positive one.
 */
export function trendOf(points: readonly Pt[]): Plane {
    const n = points.length;
    let mx = 0, mz = 0;
    for (const p of points) { mx += p[0] / n; mz += p[1] / n; }
    let sxx = 0, szz = 0, sxz = 0;
    for (const p of points) {
        sxx += (p[0] - mx) ** 2;
        szz += (p[1] - mz) ** 2;
        sxz += (p[0] - mx) * (p[1] - mz);
    }
    // The direction of least spread is square to the line
    const along = 0.5 * Math.atan2(2 * sxz, sxx - szz);
    let nx = -Math.sin(along), nz = Math.cos(along);
    if (nz < 0) { nx = -nx; nz = -nz; }
    return { normal: [nx, 0, nz], point: [mx, 0, mz] };
}

/** How far a place is above the trend line (negative: below) */
export const aboveTrend = (trend: Plane, p: Pt) => (p[0] - trend.point[0]) * trend.normal[0] + (p[1] - trend.point[2]) * trend.normal[2];

/** A place the surface passes through where the way it faces is known: it dips this many degrees to the right there (past 90: overturned) */
export interface Facing {
    at: number;
    dip: number;
}

/**
 * A reading holds the surface to the measured plane for this share of the
 * way to the nearest other point (as the app does: features/model/readings)
 */
const HOLD_SHARE = 0.25;

export interface SheetDemo {
    trend: Plane;
    /** Null when the points cannot be fitted (fewer than two places) */
    field: FittedField | null;
    /** The furthest the surface is from any of its points, m */
    worst: number;
}

/**
 * A surface through points on the section, as the app fits a sheet: the
 * trend first, then bent to the points. `follow`: 0 = through every point,
 * 1 = loosest (the panel's slider).
 */
export function sheetDemo(points: readonly Pt[], follow = 0, facing: Facing | null = null): SheetDemo {
    const trend = trendOf(points);
    const at: Pt[] = [...points];
    const values = points.map(() => 0);
    if (facing && points[facing.at]) {
        const a = (facing.dip * Math.PI) / 180;
        // Square to the surface there, on its upper side; and along it
        const nx = Math.sin(a), nz = Math.cos(a), tx = Math.cos(a), tz = -Math.sin(a);
        const p = points[facing.at];
        let nearest = Infinity;
        points.forEach((q, k) => { if (k !== facing.at) nearest = Math.min(nearest, Math.hypot(q[0] - p[0], q[1] - p[1])); });
        const d = Number.isFinite(nearest) && nearest > 0 ? HOLD_SHARE * nearest : 1;
        // As the app fits a reading (features/model/sheet): the surface is the measured plane for a little
        // way round the point (places on it either side), and the plane's two sides are the surface's two sides
        at.push([p[0] + d * tx, p[1] + d * tz], [p[0] - d * tx, p[1] - d * tz], [p[0] + d * nx, p[1] + d * nz], [p[0] - d * nx, p[1] - d * nz]);
        values.push(0, 0, d, -d);
    }
    const fit = fitField(flat(at), values, { drift: trend, smoothing: smoothingFromFollow(follow) });
    if (!fit.ok) return { trend, field: null, worst: 0 };
    const off = valuesAt(fit.field, points);
    let worst = 0;
    for (const v of off) worst = Math.max(worst, Math.abs(v));
    return { trend, field: fit.field, worst };
}

/** A sample down a hole: where it is, and its value */
export interface DemoSample {
    p: Pt;
    v: number;
}

/** No tilt to start from: the number settles to a level away from the samples */
const LEVEL: Plane = { normal: [0, 0, 0], point: [0, 0, 0] };

/** The number a closed surface is drawn from: each sample's value less the cut-off, carried between the samples. */
export function shellDemo(samples: readonly DemoSample[], cutoff: number): FittedField | null {
    const fit = fitField(flat(samples.map(s => s.p)), samples.map(s => s.v - cutoff), { drift: LEVEL });
    return fit.ok ? fit.field : null;
}

/**
 * Where the number is zero: short straight pieces, x0 z0 x1 z1 each, in
 * metres. `values` holds the number at the grid's corners.
 */
export function zeroPieces(values: ArrayLike<number>): number[] {
    const out: number[] = [];
    const at = (i: number, j: number) => values[j * (NX + 1) + i];
    /** The place on the side of a square between two corners where the number is zero */
    const cross = (i0: number, j0: number, i1: number, j1: number): Pt => {
        const a = at(i0, j0), b = at(i1, j1);
        const t = a / (a - b);
        return [(i0 + (i1 - i0) * t) * STEP, (j0 + (j1 - j0) * t) * STEP];
    };
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
        const a = at(i, j) >= 0, b = at(i + 1, j) >= 0, c = at(i + 1, j + 1) >= 0, d = at(i, j + 1) >= 0;
        if (a === b && b === c && c === d) continue;
        const hits: Pt[] = [];
        if (a !== b) hits.push(cross(i, j, i + 1, j));
        if (b !== c) hits.push(cross(i + 1, j, i + 1, j + 1));
        if (c !== d) hits.push(cross(i + 1, j + 1, i, j + 1));
        if (d !== a) hits.push(cross(i, j + 1, i, j));
        if (hits.length === 2) out.push(...hits[0], ...hits[1]);
        else if (hits.length === 4) {
            // Opposite corners alike: the middle of the square says which pairs belong together
            const mid = (at(i, j) + at(i + 1, j) + at(i + 1, j + 1) + at(i, j + 1)) / 4 >= 0;
            if (mid === a) out.push(...hits[0], ...hits[1], ...hits[2], ...hits[3]);
            else out.push(...hits[3], ...hits[0], ...hits[1], ...hits[2]);
        }
    }
    return out;
}

/** The squares where the number is above zero, as runs along each row: x, z (bottom), width; and how many squares in all. */
export function positiveRuns(values: ArrayLike<number>): { runs: number[]; squares: number } {
    const runs: number[] = [];
    let squares = 0;
    const at = (i: number, j: number) => values[j * (NX + 1) + i];
    for (let j = 0; j < NZ; j++) {
        let start = -1;
        for (let i = 0; i <= NX; i++) {
            const inside = i < NX && (at(i, j) + at(i + 1, j) + at(i + 1, j + 1) + at(i, j + 1)) / 4 > 0;
            if (inside) {
                squares++;
                if (start < 0) start = i;
            } else if (start >= 0) {
                runs.push(start * STEP, j * STEP, (i - start) * STEP);
                start = -1;
            }
        }
    }
    return { runs, squares };
}

/** How many separate patches of squares the number is above zero in (squares joined by a side are one patch). */
export function positiveParts(values: ArrayLike<number>): number {
    const at = (i: number, j: number) => values[j * (NX + 1) + i];
    const inside = new Uint8Array(NX * NZ);
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
        if ((at(i, j) + at(i + 1, j) + at(i + 1, j + 1) + at(i, j + 1)) / 4 > 0) inside[j * NX + i] = 1;
    }
    let parts = 0;
    const stack: number[] = [];
    for (let start = 0; start < inside.length; start++) {
        if (inside[start] !== 1) continue;
        parts++;
        inside[start] = 2;
        stack.push(start);
        while (stack.length > 0) {
            const c = stack.pop()!;
            const i = c % NX, j = (c - i) / NX;
            for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const ni = i + di, nj = j + dj;
                if (ni < 0 || nj < 0 || ni >= NX || nj >= NZ || inside[nj * NX + ni] !== 1) continue;
                inside[nj * NX + ni] = 2;
                stack.push(nj * NX + ni);
            }
        }
    }
    return parts;
}

/** The holes of the closed-surface pictures: four, sampled every 20 m, through one rich patch */
export function demoHoles(extra = false): DemoSample[] {
    const rich = (x: number, z: number) => 3 * Math.exp(-(((x - 250) / 120) ** 2) - ((z - 160) / 55) ** 2) + 0.1;
    const out: DemoSample[] = [];
    for (const x of [80, 190, 300, 410]) for (let z = 280; z >= 40; z -= 20) out.push({ p: [x, z], v: Number(rich(x, z).toFixed(2)) });
    // One more hole, between the two in the middle, that finds much less than its neighbours suggest
    if (extra) for (let z = 280; z >= 40; z -= 20) out.push({ p: [245, z], v: Number((0.25 * rich(245, z)).toFixed(2)) });
    return out;
}

/** The three ways a shell is found from its samples */
export type ShellWay = 'values' | 'counted' | 'runs';

/** The samples of the "three ways" picture are this far apart down their holes, m */
export const ERRATIC_STEP = 10;

/**
 * Holes through an erratic zone: five holes sampled every 10 m, a level zone
 * 60 m thick in which two samples in three are high, and a sample just over 1 alone
 * in the waste here and there. Always the same.
 */
export function erraticHoles(): DemoSample[] {
    let seed = 3;
    const next = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };
    const out: DemoSample[] = [];
    for (const x of [60, 155, 250, 345, 440]) for (let z = 275; z >= 35; z -= ERRATIC_STEP) {
        const inZone = z > 130 && z < 190;
        const high = next() < (inZone ? 0.67 : 0.07);
        // The lone ones are only just over 1: too poor, a sample long, to make an intercept
        out.push({ p: [x, z], v: Number((high ? (inZone ? 1.5 + 4 * next() : 1.1 + 0.6 * next()) : 0.05 + 0.4 * next()).toFixed(2)) });
    }
    return out;
}

/**
 * The number a shell is drawn from, each of the three ways (as the shells
 * themselves are fitted: `shellFitting`, `findIntercepts`). `flags`: for
 * 'runs', which samples are in an intercept.
 */
export function wayDemo(samples: readonly DemoSample[], cutoff: number, way: ShellWay): { field: FittedField | null; flags: Uint8Array | null } {
    const points = flat(samples.map(s => s.p)), values = samples.map(s => s.v);
    if (way === 'values') {
        const fit = fitField(points, aboveCutoff(values, cutoff, true, true), { drift: LEVEL });
        return { field: fit.ok ? fit.field : null, flags: null };
    }
    if (way === 'counted') {
        // About three samples each way taken together: a looseness of 2 n x n sample steps, in units of half the section
        const fit = fitField(points, indicatorValues(values, cutoff, DEFAULT_SHARE), { drift: LEVEL, smoothing: 2 * DEFAULT_LOCAL * DEFAULT_LOCAL * ERRATIC_STEP / (WIDTH / 2) });
        return { field: fit.ok ? fit.field : null, flags: null };
    }
    // Runs of at least two samples, with up to two lower ones inside
    const found = findIntercepts({
        hole: samples.map(s => String(s.p[0])), from: samples.map(s => HEIGHT - s.p[1]), to: samples.map(s => HEIGHT - s.p[1] + ERRATIC_STEP),
        x: samples.map(s => s.p[0]), y: samples.map(() => 0), z: samples.map(s => s.p[1]), value: values,
    }, { cutoff, minLength: 2 * ERRATIC_STEP, maxWaste: 2 * ERRATIC_STEP })!;
    if (!found.flags.some(f => f === 1)) return { field: null, flags: found.flags };
    const fit = fitField(points, Array.from(found.flags, f => (f === 1 ? 0.5 : -0.5)), { drift: LEVEL });
    return { field: fit.ok ? fit.field : null, flags: found.flags };
}

// --- which way the ground runs ------------------------------------------------

const RAD = Math.PI / 180;

/** The zone of the "one direction" picture dips this many degrees, down to the right */
export const ZONE_DIP = 20;
/** The middle of that zone */
export const dippingMiddle = (x: number) => 150 + (250 - x) * Math.tan(ZONE_DIP * RAD);

/** Five holes sampled every 10 m through a zone 16 m thick that dips 20 degrees to the right */
export function dippingHoles(): DemoSample[] {
    const out: DemoSample[] = [];
    for (const x of [60, 155, 250, 345, 440]) for (let z = 285; z >= 25; z -= 10) {
        out.push({ p: [x, z], v: Math.abs(z - dippingMiddle(x)) * Math.cos(ZONE_DIP * RAD) < 8 ? 3 : 0.1 });
    }
    return out;
}

/**
 * A shell fitted along one direction (as the shells themselves are when the
 * model has a structure set): the ground runs down to the right at `dip`
 * degrees (negative: down to the left), and things carry `strength` times
 * further along it than across it. A strength of 1: the same every way.
 */
export function directionDemo(samples: readonly DemoSample[], cutoff: number, dip: number, strength: number): FittedField | null {
    const points = flat(samples.map(s => s.p)), values = aboveCutoff(samples.map(s => s.v), cutoff, true, true);
    if (!(strength > 1)) {
        const fit = fitField(points, values, { drift: LEVEL });
        return fit.ok ? fit.field : null;
    }
    const stretch: Stretch = { normal: [Math.sin(dip * RAD), 0, Math.cos(dip * RAD)], point: [WIDTH / 2, 0, HEIGHT / 2], factor: strength };
    const fit = fitField(stretchPoints(points, stretch), values, { drift: LEVEL });
    return fit.ok ? { ...fit.field, stretch } : null;
}

// --- where the ground changes direction ---------------------------------------

/** The holes of the folded pictures */
export const FOLD_HOLES = [40, 110, 180, 250, 320, 390, 460];
/** The middle of the folded zone, and how steeply it runs (rise over run) */
const FOLD_RISE = 40, FOLD_HALF = 10;
export const foldMiddle = (x: number) => 160 + FOLD_RISE * Math.sin(2 * Math.PI * (x - 30) / 440);
export const foldSlope = (x: number) => FOLD_RISE * (2 * Math.PI / 440) * Math.cos(2 * Math.PI * (x - 30) / 440);

/** Seven holes sampled every 8 m through a folded zone 20 m thick */
export function foldedHoles(): DemoSample[] {
    const out: DemoSample[] = [];
    for (const x of FOLD_HOLES) for (let z = 284; z >= 28; z -= 8) {
        out.push({ p: [x, z], v: Math.abs(z - foldMiddle(x)) * Math.cos(Math.atan(foldSlope(x))) < FOLD_HALF ? 3 : 0.1 });
    }
    return out;
}

/** How the ground lies at a place: its slope on the section (rise over run) */
export interface DemoReading {
    p: Pt;
    slope: number;
}

/** The layering as measured down the holes: a reading every 40 m, each lying as the fold does there */
export function foldReadings(): DemoReading[] {
    const out: DemoReading[] = [];
    for (const x of FOLD_HOLES) for (let z = 260; z >= 60; z -= 40) out.push({ p: [x, z], slope: foldSlope(x) });
    return out;
}

/** How far a reading carries on the section, m */
export const READING_RANGE = 130;

export interface LayeredDemo {
    /** The number at the grid's corners */
    values: Float64Array;
    /** The height through the layers at the grid's corners: its level lines are the way the ground runs */
    heights: Float64Array;
    /** The number at places */
    at: (points: readonly Pt[]) => Float64Array;
}

/**
 * A shell that follows readings from place to place (as the shells
 * themselves do: frame.ts): the readings give every place a height through
 * the layers, and that height counts as one more direction to be apart in,
 * so that places on one layer are close and places on different layers are
 * not. `strength`: how many times further things carry along the ground
 * than across it.
 */
export function layeredDemo(samples: readonly DemoSample[], cutoff: number, readings: readonly DemoReading[], strength: number): LayeredDemo | null {
    const potential = buildPotential(readings.map(r => ({ p: [r.p[0], 0, r.p[1]], axis: [-r.slope, 0, 1] })), READING_RANGE);
    if (!potential || !(strength > 1)) return null;
    const weight = Math.sqrt(strength * strength - 1);
    const extraAt = (points: ArrayLike<number>) => potentialAt(potential, points).map(h => weight * h);
    const points = flat(samples.map(s => s.p));
    const fit = fitField(points, aboveCutoff(samples.map(s => s.v), cutoff, true, true), { drift: LEVEL, extra: extraAt(points) });
    if (!fit.ok) return null;
    const field = fit.field;
    return {
        values: readField(field, NODES, extraAt(NODES)),
        heights: potentialAt(potential, NODES),
        at: (places) => { const p = flat(places); return readField(field, p, extraAt(p)); },
    };
}

/** Level lines of numbers at the grid's corners, every `every`: short straight pieces, x0 z0 x1 z1 each */
export function levelLines(values: ArrayLike<number>, every: number): number[] {
    let low = Infinity, high = -Infinity;
    for (let i = 0; i < values.length; i++) { if (values[i] < low) low = values[i]; if (values[i] > high) high = values[i]; }
    const out: number[] = [];
    if (!(every > 0) || !(high > low)) return out;
    const shifted = new Float64Array(values.length);
    for (let level = (Math.floor(low / every) + 1) * every; level < high; level += every) {
        // (A hair off the level, so a corner that sits exactly on it is on one side)
        for (let i = 0; i < values.length; i++) shifted[i] = values[i] - level - 1e-7;
        for (const v of zeroPieces(shifted)) out.push(v);
    }
    return out;
}

/** The sections the same holes are drilled on, for suggesting readings: this far apart, m */
const SECTIONS = [-140, -70, 0, 70, 140];

/**
 * Readings suggested from where the samples are high (suggest.ts, as the
 * panel's "Suggest" does it). The section's holes are taken to be drilled
 * on five sections 70 m apart, the same on each, because a plane cannot be
 * told from the holes of one section alone. What is suggested on the
 * middle section is given, as it lies on the section.
 */
export function suggestedReadings(samples: readonly DemoSample[], cutoff: number): DemoReading[] {
    const xs = Array.from(new Set(samples.map(s => s.p[0])));
    const positions: number[] = [], hole: number[] = [], high: boolean[] = [];
    let h = 0;
    for (const y of SECTIONS) for (const x of xs) {
        for (const s of samples) {
            if (s.p[0] !== x) continue;
            positions.push(x, y, s.p[1]);
            hole.push(h);
            high.push(s.v >= cutoff);
        }
        h++;
    }
    const spacing = xs.length > 1 ? (Math.max(...xs) - Math.min(...xs)) / (xs.length - 1) : 0;
    const out: DemoReading[] = [];
    const seen = new Set<string>();
    for (const r of readingsFromHighs({ positions, hole, high, spacing }).planes) {
        if (Math.abs(r.p[1]) > 1) continue;
        const n = normalFromDip(r.dip, r.direction);
        const key = `${Math.round(r.p[0])},${Math.round(r.p[2])}`;
        if (Math.abs(n[2]) < 1e-6 || seen.has(key)) continue;
        seen.add(key);
        out.push({ p: [r.p[0], r.p[2]], slope: -n[0] / n[2] });
    }
    return out;
}
