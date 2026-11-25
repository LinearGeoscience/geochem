/**
 * The small cross-section the "how surfaces are fitted" guide draws on
 * (pure, unit-tested). The pictures are worked out with the solver the
 * surfaces themselves are fitted with (features/model/rbf), on a section
 * 500 m wide and 300 m high.
 */
import { fitBody } from '../../model/body';
import { buildPotential, potentialAt } from '../../model/frame';
import { loggedRuns, proposeChronology, takesPlace } from '../../model/contactMatrix';
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

// --- Veins -------------------------------------------------------------------

/** The holes of the vein picture, and the middle of the vein each goes through */
export const VEIN_HOLES = [50, 150, 250, 350, 450];
export const veinMiddle = (x: number) => 110 + 0.2 * x + 15 * Math.sin(x / 80);
/** The hole that can be made to miss it */
export const VEIN_MISS = 250;

export interface VeinDemo {
    /** Where each hole goes into the vein and comes out of it */
    hits: { x: number; top: number; bottom: number }[];
    /** Where the hole that missed it goes through where it would be (null: none missed) */
    miss: Pt | null;
    /** The vein built from its two walls (features/model/vein), and fitted as a volume (features/model/body) */
    walls: FittedField | null;
    volume: FittedField | null;
}

/**
 * A vein of one thickness through five holes, the two ways it can be made.
 * From its walls: a surface through the middle of it at each hole, and the
 * height of each wall off that surface carried from hole to hole. As a
 * volume: a number down every hole, above zero in the vein and below it
 * outside, carried through the space between the holes.
 */
export function veinDemo(thick: number, missed = false): VeinDemo {
    const hits = VEIN_HOLES.filter(x => !(missed && x === VEIN_MISS)).map(x => ({ x, top: veinMiddle(x) + thick / 2, bottom: veinMiddle(x) - thick / 2 }));
    const mid = sheetDemo(hits.map((h): Pt => [h.x, (h.top + h.bottom) / 2])).field;
    let walls: FittedField | null = null, miss: Pt | null = null;
    if (mid) {
        const upAt: Pt[] = hits.map(h => [h.x, h.top]), downAt: Pt[] = hits.map(h => [h.x, h.bottom]);
        const up = Array.from(valuesAt(mid, upAt)), down = Array.from(valuesAt(mid, downAt), v => -v);
        if (missed) {
            // Where that hole goes through the surface in the middle of the vein: the vein is not there
            let z = veinMiddle(VEIN_MISS);
            for (let k = 0; k < 4; k++) {
                const [a, b] = valuesAt(mid, [[VEIN_MISS, z], [VEIN_MISS, z + 1]]);
                if (b !== a) z -= a / (b - a);
            }
            miss = [VEIN_MISS, z];
            upAt.push(miss); up.push(-thick / 2);
            downAt.push(miss); down.push(-thick / 2);
        }
        const fu = fitField(flat(upAt), up, { drift: LEVEL }), fd = fitField(flat(downAt), down, { drift: LEVEL });
        if (fu.ok && fd.ok) walls = { ...mid, walls: { up: fu.field, down: fd.field, least: 0 } };
    }
    // As a volume: zero at each wall, half its thickness in the middle, and as far below zero as each sample outside is from it
    const at: Pt[] = [], v: number[] = [];
    for (const x of VEIN_HOLES) {
        const hit = hits.find(h => h.x === x);
        if (hit) { at.push([x, hit.top], [x, hit.bottom], [x, (hit.top + hit.bottom) / 2]); v.push(0, 0, thick / 2); }
        for (let z = 20; z <= 280; z += 20) {
            if (hit && z < hit.top + 5 && z > hit.bottom - 5) continue;
            at.push([x, z]);
            v.push(hit ? -Math.min(Math.abs(z - hit.top), Math.abs(z - hit.bottom)) : -(Math.abs(z - veinMiddle(x)) + 10));
        }
    }
    const fit = fitField(flat(at), v, { drift: LEVEL });
    return { hits, miss, walls, volume: fit.ok ? fit.field : null };
}

// --- Several veins side by side ---------------------------------------------

/** The middle of the upper and of the lower vein of the picture, and of the branch that leaves the upper one past `BRANCH_FROM` */
export const upperMiddle = (x: number) => 215 - 0.08 * x;
export const lowerMiddle = (x: number) => upperMiddle(x) - 85;
export const BRANCH_FROM = 200;
export const branchMiddle = (x: number) => upperMiddle(x) - 0.22 * (x - BRANCH_FROM);
/** How thick the two veins are up a hole, and the branch, m */
export const LODE_THICK = 12;
export const BRANCH_THICK = 10;

export interface LodesDemo {
    /** Where each hole goes through a vein, and which vein: 0 the upper, 1 the lower, 2 the branch */
    hits: { x: number; top: number; bottom: number; vein: number }[];
    /** The number the picture is drawn from: above nothing in what is built (null: it could not be fitted) */
    values: Float64Array | null;
    /** Down the holes: the metres inside what is built, and the metres of vein there are */
    enclosed: number;
    vein: number;
    /** How much of the branch lies past the middle of the vein it leaves, m2 of the section */
    beyond: number;
}

/** A vein from its two walls, as `veinDemo` makes one: a surface through the middle of its stretches, and each wall's height off it */
function wallsOf(hits: readonly { x: number; top: number; bottom: number }[]): FittedField | null {
    const mid = sheetDemo(hits.map((h): Pt => [h.x, (h.top + h.bottom) / 2])).field;
    if (!mid) return null;
    const upAt: Pt[] = hits.map(h => [h.x, h.top]), downAt: Pt[] = hits.map(h => [h.x, h.bottom]);
    const fu = fitField(flat(upAt), Array.from(valuesAt(mid, upAt)), { drift: LEVEL });
    const fd = fitField(flat(downAt), Array.from(valuesAt(mid, downAt), v => -v), { drift: LEVEL });
    return fu.ok && fd.ok ? { ...mid, walls: { up: fu.field, down: fd.field, least: 0 } } : null;
}

/**
 * Two veins one above the other through five holes, and a branch that leaves
 * the upper one, built the two ways there are. As one zone: every stretch of
 * a hole is joined into one, and one vein is built round the lot. A vein of
 * each: every vein from its own stretches. `stops`: the branch is only on
 * its own side of the middle of the vein it leaves.
 */
export function lodesDemo(how: 'zone' | 'each', stops = false): LodesDemo {
    const hits: LodesDemo['hits'] = [];
    for (const x of VEIN_HOLES) {
        hits.push({ x, top: upperMiddle(x) + LODE_THICK / 2, bottom: upperMiddle(x) - LODE_THICK / 2, vein: 0 });
        hits.push({ x, top: lowerMiddle(x) + LODE_THICK / 2, bottom: lowerMiddle(x) - LODE_THICK / 2, vein: 1 });
        if (x > BRANCH_FROM) hits.push({ x, top: branchMiddle(x) + BRANCH_THICK / 2, bottom: branchMiddle(x) - BRANCH_THICK / 2, vein: 2 });
    }
    const vein = hits.reduce((sum, h) => sum + h.top - h.bottom, 0);
    if (how === 'zone') {
        const zones = VEIN_HOLES.map(x => { const own = hits.filter(h => h.x === x); return { x, top: Math.max(...own.map(h => h.top)), bottom: Math.min(...own.map(h => h.bottom)) }; });
        const field = wallsOf(zones);
        return { hits, values: field ? gridValues(field) : null, enclosed: zones.reduce((sum, z) => sum + z.top - z.bottom, 0), vein, beyond: 0 };
    }
    const fields = [0, 1, 2].map(v => wallsOf(hits.filter(h => h.vein === v)));
    if (fields.some(f => !f)) return { hits, values: null, enclosed: vein, vein, beyond: 0 };
    const [upper, lower, branch] = fields.map(f => gridValues(f!));
    // The middle of the upper vein, positive on the side the branch's stretches are
    const middle = { ...fields[0]!, walls: null };
    const at = valuesAt(middle, hits.filter(h => h.vein === 2).map((h): Pt => [h.x, (h.top + h.bottom) / 2]));
    const side = Array.from(at).reduce((a, v) => a + v, 0) < 0 ? -1 : 1;
    const own = gridValues(middle);
    const values = new Float64Array(upper.length);
    let beyond = 0;
    for (let i = 0; i < values.length; i++) {
        let b = branch[i];
        if (b > 0 && !(side * own[i] > 0)) { if (stops) b = Math.min(b, side * own[i]); else beyond++; }
        values[i] = Math.max(upper[i], lower[i], b);
    }
    return { hits, values, enclosed: vein, vein, beyond: beyond * STEP * STEP };
}

/** The holes of the thin-dykes picture, metres along the section */
export const THIN_HOLES = [60, 155, 250, 345, 440];
/** Four dykes this thick up a hole, m, at these heights off the middle of their zone; they dip this many degrees to the right */
export const THIN_THICK = 3;
export const THIN_OFFSETS = [-27, -9, 9, 27];
export const THIN_DIP = 20;
/** The middle of the zone at a place along the section */
export const thinMiddle = (x: number) => 200 - (x - 60) * Math.tan(THIN_DIP * RAD);
/** Built as thin sheets, a dyke is drawn this far along itself from a hole that meets it, m */
export const THIN_REACH = 30;
/** As a proportion: this much of hole above and below a place is taken together, m */
export const THIN_WINDOW = 12.5;
/** The dyke there truly is on the section, m2 (each runs right across it) */
export const THIN_TRUE = THIN_OFFSETS.length * THIN_THICK * WIDTH;

export type ThinWay = 'intrusion' | 'sheets' | 'share';

export interface ThinDemo {
    /** Where each hole goes through a dyke */
    hits: { x: number; top: number; bottom: number }[];
    /** The number the outline is drawn from (null: it has none: thin sheets are drawn as they are) */
    values: Float64Array | null;
    /** As a proportion: the share of the ground that is dyke at each corner of the grid, 0 to 1 (else null) */
    share: Float64Array | null;
    /** The ground it encloses on the section, m2; and how much dyke it says that is (the same thing for a solid of thin sheets) */
    ground: number;
    dyke: number;
    /** As a proportion: the dyke it says there is on the whole section, in and out of its shell, m2 (else null) */
    all: number | null;
    /** Down the five holes: the metres inside it, and the metres of those that are dyke */
    enclosed: number;
    inDyke: number;
}

/**
 * Four thin dykes side by side through five holes, built the three ways
 * there are for a unit too thin to draw. As an intrusion: one body round all
 * of it, the rock between the dykes with them. As thin sheets: each stretch
 * of dyke carried along the sheets as far as its reach. As a proportion
 * (`at`: the share its shell is drawn at, 0 to 1): how much of the ground is
 * dyke, from the share of each hole about a place that is, carried along
 * the sheets from hole to hole.
 */
export function thinDemo(way: ThinWay, at = 0.1): ThinDemo {
    const hits: ThinDemo['hits'] = [];
    for (const x of THIN_HOLES) for (const off of THIN_OFFSETS) hits.push({ x, top: thinMiddle(x) + off + THIN_THICK / 2, bottom: thinMiddle(x) + off - THIN_THICK / 2 });
    const metres = hits.reduce((sum, h) => sum + h.top - h.bottom, 0);
    if (way === 'intrusion') {
        const zones = THIN_HOLES.map(x => { const own = hits.filter(h => h.x === x); return { x, top: Math.max(...own.map(h => h.top)), bottom: Math.min(...own.map(h => h.bottom)) }; });
        const field = wallsOf(zones);
        const values = field ? gridValues(field) : null;
        const ground = values ? positiveRuns(values).squares * STEP * STEP : 0;
        return { hits, values, share: null, ground, dyke: ground, all: null, enclosed: zones.reduce((sum, z) => sum + z.top - z.bottom, 0), inDyke: metres };
    }
    if (way === 'sheets') {
        // (A lens round each stretch: as thick as the dyke at the hole, thinning to nothing at its reach)
        const ground = hits.length * Math.PI * THIN_REACH * (THIN_THICK / 2) * Math.cos(THIN_DIP * RAD);
        return { hits, values: null, share: null, ground, dyke: ground, all: null, enclosed: metres, inDyke: metres };
    }
    // How much of a hole is dyke within the window of a height
    const shareOn = (x: number, z: number) => {
        let dyke = 0;
        for (const h of hits) if (h.x === x) dyke += Math.max(0, Math.min(h.top, z + THIN_WINDOW) - Math.max(h.bottom, z - THIN_WINDOW));
        return dyke / (2 * THIN_WINDOW);
    };
    const reach = 1.5 * (THIN_HOLES[1] - THIN_HOLES[0]);
    const shareAt = (x: number, z: number) => {
        let sum = 0, weight = 0;
        for (const hx of THIN_HOLES) {
            const w = Math.max(0, 1 - Math.abs(x - hx) / reach);
            // (Along the sheets to the hole: the same height off the middle of the zone)
            if (w > 0) { sum += w * shareOn(hx, z + thinMiddle(hx) - thinMiddle(x)); weight += w; }
        }
        return weight > 0 ? sum / weight : 0;
    };
    const share = new Float64Array((NX + 1) * (NZ + 1)), values = new Float64Array(share.length);
    for (let j = 0, q = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++, q++) { share[q] = shareAt(i * STEP, j * STEP); values[q] = share[q] - at; }
    // Square by square: the ground at or above the share, the dyke that is, and the dyke in all
    let ground = 0, dyke = 0, all = 0;
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
        const s = (share[j * (NX + 1) + i] + share[j * (NX + 1) + i + 1] + share[(j + 1) * (NX + 1) + i + 1] + share[(j + 1) * (NX + 1) + i]) / 4;
        all += s * STEP * STEP;
        if (s > at) { ground += STEP * STEP; dyke += s * STEP * STEP; }
    }
    let enclosed = 0, inDyke = 0;
    for (const x of THIN_HOLES) for (let z = 0.25; z < HEIGHT; z += 0.5) {
        if (shareOn(x, z) <= at) continue;
        enclosed += 0.5;
        if (hits.some(h => h.x === x && z > h.bottom && z < h.top)) inDyke += 0.5;
    }
    return { hits, values, share, ground, dyke, all, enclosed, inDyke };
}

/** The holes of the slab picture, metres along the section */
export const SLAB_HOLES = [60, 155, 250, 345, 440];
/** The slab dips this many degrees to the right, and is this thick up a hole, m */
export const SLAB_DIP = 25;
export const SLAB_THICK = 30;
/** With a trend of its own, the slab's body carries this many times further along it than across it */
export const SLAB_TREND = 4;
/** The top of the slab at a place along the section */
export const slabTop = (x: number) => 250 - (x - 60) * Math.tan(SLAB_DIP * RAD);

export interface BodyDemo {
    /** Where each hole meets the slab */
    hits: { x: number; top: number; bottom: number }[];
    /** The body fitted round it (null: it could not be) */
    field: FittedField | null;
    /** How far its skin lies from the dip measured, at the worst of the contacts, degrees */
    off: number;
    /** The line drawn along its top between two holes (none: not drawn) */
    line: Pt[];
}

/**
 * A slab dipping across five holes, fitted as a body (the solver bodies
 * are fitted with: features/model/body). Between two holes it steps down
 * more than it is thick, so the logging alone does not say how it lies.
 * `dips`: a dip of `measured` degrees is set on its skin at every contact.
 * `line`: its top is drawn between the second hole and the third.
 * `trend`: it has a trend of its own, along that dip: things carry
 * SLAB_TREND times further along it than across it.
 */
export function bodyDemo(dips: boolean, measured = SLAB_DIP, line = false, trend = false): BodyDemo {
    const hits = SLAB_HOLES.map(x => ({ x, top: slabTop(x), bottom: slabTop(x) - SLAB_THICK }));
    const contacts: Pt[] = hits.flatMap((h): Pt[] => [[h.x, h.top], [h.x, h.bottom]]);
    const middles: Pt[] = [], side: number[] = [];
    for (const h of hits) {
        middles.push([h.x, (h.top + 295) / 2], [h.x, (h.top + h.bottom) / 2], [h.x, (h.bottom + 5) / 2]);
        side.push(-1, 1, -1);
    }
    const normal = [Math.sin(measured * RAD), 0, Math.cos(measured * RAD)];
    const drawn: Pt[] = line ? Array.from({ length: 9 }, (_, k): Pt => { const x = SLAB_HOLES[1] + (k * (SLAB_HOLES[2] - SLAB_HOLES[1])) / 8; return [x, slabTop(x)]; }) : [];
    const up = [Math.sin(SLAB_DIP * RAD), 0, Math.cos(SLAB_DIP * RAD)];
    const fit = fitBody({
        points: flat(contacts), middles: { positions: flat(middles), side }, box: { min: [0, -60, 0], max: [WIDTH, 60, HEIGHT] },
        ...(trend ? { stretch: { normal: [normal[0], normal[1], normal[2]], point: [WIDTH / 2, 0, HEIGHT / 2], factor: SLAB_TREND } } : {}),
        ...(dips ? { readings: { positions: flat(contacts), normals: contacts.flatMap(() => normal), offsets: contacts.map(() => SLAB_THICK / 4) } } : {}),
        ...(line ? { lines: { positions: flat(drawn), normals: drawn.flatMap(() => up), offsets: drawn.map(() => 4), groups: drawn.map(() => 0), flipped: [0] } } : {}),
    });
    const field = fit.status === 'body' ? fit.field : null;
    let off = 0;
    if (field) {
        for (const [x, z] of contacts) {
            const f = valuesAt(field, [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]]);
            const gx = f[0] - f[1], gz = f[2] - f[3], len = Math.hypot(gx, gz) || 1;
            off = Math.max(off, Math.acos(Math.min(1, Math.abs((gx * normal[0] + gz * normal[2]) / len))) / RAD);
        }
    }
    return { hits, field, off, line: drawn };
}

// --- What the holes say a unit is (what the chronology step proposes) ----------

export type ChronoCase = 'stock' | 'sill' | 'lens';
/** The pile of the picture, the youngest first: the cover lies flat on the rest, which is gently folded */
export const CHRONO_PILE = ['Cover', 'Sandstone', 'Shale', 'Basalt', 'Chert', 'Ultramafic'];
/** The bases of the four layers under the cover (before the fold); the last layer runs to the foot of the picture */
export const CHRONO_BASES = [205, 160, 115, 70];
export const CHRONO_COVER = 255;
export const CHRONO_NAME: Record<ChronoCase, string> = { stock: 'Granite', sill: 'Dolerite', lens: 'Tuff' };
/** Room at the left of the picture for the layers' names */
export const CHRONO_LEFT = 75;
export const chronoFold = (x: number) => 8 * Math.sin(x / 70);
const CHRONO_MID = 280;
const CHRONO_HALF: Record<ChronoCase, number> = { stock: 70, sill: 160, lens: 110 };

/** The top and the base of the unit at x, where it is: a stock up to the cover, a sill half way down the basalt, a lens at the top of it */
function chronoBody(kind: ChronoCase, x: number): [number, number] | null {
    if (Math.abs(x - CHRONO_MID) >= CHRONO_HALF[kind]) return null;
    const f = chronoFold(x);
    return kind === 'stock' ? [CHRONO_COVER, 50] : kind === 'sill' ? [140.5 + f, 134.5 + f] : [160 + f, 146 + f];
}

/** The unit at a place of the picture */
export function chronoUnitAt(kind: ChronoCase, x: number, z: number): string {
    if (z > CHRONO_COVER) return CHRONO_PILE[0];
    const body = chronoBody(kind, x);
    if (body && z <= body[0] && z > body[1]) return CHRONO_NAME[kind];
    const f = chronoFold(x);
    for (let k = 0; k < CHRONO_BASES.length; k++) if (z > CHRONO_BASES[k] + f) return CHRONO_PILE[k + 1];
    return CHRONO_PILE[CHRONO_PILE.length - 1];
}

/** The unit's outline, to draw */
export function chronoOutline(kind: ChronoCase): Pt[] {
    const top: Pt[] = [], base: Pt[] = [];
    const from = CHRONO_MID - CHRONO_HALF[kind], to = CHRONO_MID + CHRONO_HALF[kind];
    for (let k = 0; k <= 40; k++) {
        const x = from + (to - from) * k / 40;
        const body = chronoBody(kind, Math.min(to - 1e-6, Math.max(from + 1e-6, x)))!;
        top.push([x, body[0]]);
        base.push([x, body[1]]);
    }
    return [...top, ...base.reverse()];
}

export interface ChronoDemo {
    name: string;
    /** The holes, with the stretches of the unit in each */
    holes: { x: number; hits: { top: number; bottom: number }[] }[];
    /** Proposed as a body that cuts across (else it is left a layer) */
    cuts: boolean;
    /** The counts that say so, its age and whether it follows the layers, in the step's own words ('' where it says nothing) */
    why: string;
    age: string;
    follows: string;
    /** Left a layer: what the holes show across it */
    across: string;
}

/**
 * Upright holes logged 2 m at a time through the picture, and what the
 * chronology step proposes for the unit from that logging alone: the same
 * rules, with the same counts and words, as on a real project.
 */
export function chronologyDemo(kind: ChronoCase, holes: number): ChronoDemo {
    const name = CHRONO_NAME[kind];
    const hole: string[] = [], from: number[] = [], to: number[] = [], code: string[] = [], z: number[] = [];
    const drawn: ChronoDemo['holes'] = [];
    for (let k = 0; k < holes; k++) {
        const x = CHRONO_LEFT + (WIDTH - CHRONO_LEFT - 15) * (k + 0.5) / holes;
        const hits: { top: number; bottom: number }[] = [];
        for (let d = 0; d < 290; d += 2) {
            const unit = chronoUnitAt(kind, x, 294 - d);
            hole.push(`H${k}`); from.push(d); to.push(d + 2); code.push(unit); z.push(294 - d);
            if (unit !== name) continue;
            const last = hits[hits.length - 1];
            if (last && last.bottom === 295 - d) last.bottom = 293 - d;
            else hits.push({ top: 295 - d, bottom: 293 - d });
        }
        drawn.push({ x, hits });
    }
    const units = [name, ...CHRONO_PILE];
    const runs = loggedRuns({ hole, from, to, code, z }, units);
    const p = proposeChronology(runs, units);
    const cuts = p.kinds[name] !== 'deposit' && p.kinds[name] !== 'erosion';
    const across = cuts ? '' : takesPlace(runs, p.order.filter(u => u !== name), name).why;
    return { name, holes: drawn, cuts, why: p.why[name] ?? '', age: p.age[name]?.why ?? '', follows: p.follows[name] ?? '', across };
}
