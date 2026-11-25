/**
 * The direction of the ground at every place, from the readings the model
 * follows (pure, unit-tested).
 *
 * A reading says how a plane (or a line) lies where it was measured. A
 * place between readings takes the orientation the readings round about
 * lie closest to, each counting for less the further off it is (as the
 * square of the distance, past the ones right beside it) and for nothing
 * beyond `range`. A plane and the same plane turned over are one
 * reading, so nothing depends on which way up a reading was written down:
 * what is blended is each reading's axis, sign-free (the sum of n nT over
 * the readings; the place's direction is the axis that sum is longest
 * along).
 *
 * Away from every reading the direction is the one set for the whole model
 * (structure.ts), coming in smoothly as the readings fade; with none set
 * there is no direction there.
 *
 * Where readings round about disagree (the hinge of a fold seen from both
 * limbs) the blend is some direction between them and `agreement` is low:
 * what follows the field leans on it less there.
 */
import { jacobiEigendecomposition } from '../../utils/calculations/eigen';
import { cross, dipFromNormal, dot, unit } from './plane';
import { pickSpread } from './readings';
import { structureAxes } from './structure';
import { readingAxis } from './structureReadings';
import type { OverallStructure, ReadingSet, Vec3 } from './types';

/** A reading counts in cells this share of the range across: readings closer together than that are taken together */
const CELL_SHARE = 0.2;
/**
 * Readings within this share of the range of a place count about alike (so
 * scatter among them averages out); beyond it a reading counts less as the
 * square of how far off it is, so that between two holes the nearer says
 * more, and a place takes after the readings beside it rather than after
 * everything in reach.
 */
const NEAR = 0.15;
/** What the model's one direction counts for, against a reading right at the place counting 1 */
const FALLBACK_WEIGHT = 0.25;
/** Readings round about that add up to less than this say nothing */
const SILENT = 1e-4;
/** The range is this many times the usual distance from a reading to the nearest on each side */
const RANGE_SPACINGS = 1.5;
/** "Usual": this share of those distances are no longer */
const RANGE_QUANTILE = 0.75;
/** Readings the spacing is measured from (spread through them all) */
const RANGE_PROBES = 300;
/** A turn of the axes by no round angle (rows: the new axes) */
const TURN = (() => {
    const a = 0.47, b = 0.33;
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    return [ca, -sa, 0, sa * cb, ca * cb, -sb, sa * sb, ca * sb, cb];
})();
/** The range with a single reading, or none to measure by, m */
const RANGE_ALONE = 100;

interface Cell {
    /** Where its readings are, taken together */
    p: Vec3;
    /** The sum of n nT over them: xx, xy, xz, yy, yz, zz */
    t: Float64Array;
    count: number;
}

interface Layer {
    cells: Cell[];
    /** Cells by the box of side `range` they are in */
    boxes: Map<string, number[]>;
}

export interface TrendField {
    /** How far a reading carries, m */
    range: number;
    /** `range` was worked out from the spacing of the readings (false: it was given) */
    autoRange: boolean;
    /** Readings of planes and of lines it is made from */
    planes: number;
    lines: number;
    overall: OverallStructure | null;
    /** (internal) */
    planeLayer: Layer | null;
    lineLayer: Layer | null;
}

export interface LocalTrend {
    /** The plane things run along here: its upward unit normal (null: no direction here) */
    normal: Vec3 | null;
    /** Within it, the direction things run furthest in, pointing down its plunge (null: none) */
    line: Vec3 | null;
    /** How much of the plane here is from readings (1) rather than the model's one direction (0) */
    fromReadings: number;
    /** How well the readings blended here agree: 1 all alike, towards 0 as they differ */
    agreement: number;
    /** How much of the long direction here is from readings of lines (1) rather than the model's own (0) */
    lineFromReadings: number;
}

const NOTHING: LocalTrend = { normal: null, line: null, fromReadings: 0, agreement: 0, lineFromReadings: 0 };

/** The sets the model follows: ticked, and not empty */
export const followedSets = (sets: readonly ReadingSet[] | null | undefined): ReadingSet[] => (sets ?? []).filter(s => s.follow !== false && s.readings.length > 0);

/**
 * The sets a surface follows: the ones it chose itself (`SurfaceParams.trendSets`, whether or not the model
 * follows them), else the ones the model follows
 */
export function chosenSets(sets: readonly ReadingSet[] | null | undefined, chosen: readonly string[] | null | undefined): ReadingSet[] {
    return chosen ? (sets ?? []).filter(s => chosen.includes(s.id) && s.readings.length > 0) : followedSets(sets);
}

/**
 * How far a reading should carry, from how the readings are spaced. It has
 * to reach the readings on every side, not only the nearest: down a hole
 * the next reading is a few metres off, and the next hole fifty. So from a
 * spread of the readings the nearest other is found on each of eight sides,
 * and the range is one and a half times what most of those distances come
 * to (three in four are no longer).
 */
export function autoRange(sets: readonly ReadingSet[]): number {
    // Turned, so that readings in rows and columns do not sit on the lines between one side and the next
    const at: number[] = [];
    for (const s of sets) {
        for (const r of s.readings) {
            at.push(
                TURN[0] * r.p[0] + TURN[1] * r.p[1] + TURN[2] * r.p[2],
                TURN[3] * r.p[0] + TURN[4] * r.p[1] + TURN[5] * r.p[2],
                TURN[6] * r.p[0] + TURN[7] * r.p[1] + TURN[8] * r.p[2],
            );
        }
    }
    const n = at.length / 3;
    const sides: number[] = [];
    const best = new Float64Array(8);
    for (const i of pickSpread(at, RANGE_PROBES)) {
        best.fill(Infinity);
        const x = at[i * 3], y = at[i * 3 + 1], z = at[i * 3 + 2];
        for (let j = 0; j < n; j++) {
            const dx = at[j * 3] - x, dy = at[j * 3 + 1] - y, dz = at[j * 3 + 2] - z;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (!(d2 > 0)) continue;
            const side = (dx > 0 ? 1 : 0) | (dy > 0 ? 2 : 0) | (dz > 0 ? 4 : 0);
            if (d2 < best[side]) best[side] = d2;
        }
        for (let k = 0; k < 8; k++) if (Number.isFinite(best[k])) sides.push(Math.sqrt(best[k]));
    }
    if (sides.length === 0) return RANGE_ALONE;
    sides.sort((a, b) => a - b);
    return Number((RANGE_SPACINGS * sides[Math.min(sides.length - 1, Math.floor(RANGE_QUANTILE * sides.length))]).toPrecision(2));
}

const key = (i: number, j: number, k: number) => `${i},${j},${k}`;

function layerOf(sets: readonly ReadingSet[], kind: ReadingSet['kind'], range: number): Layer | null {
    const size = CELL_SHARE * range;
    const byCell = new Map<string, { sum: [number, number, number]; t: Float64Array; count: number }>();
    for (const s of sets) {
        if (s.kind !== kind) continue;
        for (const r of s.readings) {
            const a = readingAxis(kind, r);
            const k = key(Math.floor(r.p[0] / size), Math.floor(r.p[1] / size), Math.floor(r.p[2] / size));
            let c = byCell.get(k);
            if (!c) {
                c = { sum: [0, 0, 0], t: new Float64Array(6), count: 0 };
                byCell.set(k, c);
            }
            c.sum[0] += r.p[0]; c.sum[1] += r.p[1]; c.sum[2] += r.p[2];
            c.t[0] += a[0] * a[0]; c.t[1] += a[0] * a[1]; c.t[2] += a[0] * a[2];
            c.t[3] += a[1] * a[1]; c.t[4] += a[1] * a[2]; c.t[5] += a[2] * a[2];
            c.count++;
        }
    }
    if (byCell.size === 0) return null;
    const cells: Cell[] = [];
    const boxes = new Map<string, number[]>();
    for (const c of byCell.values()) {
        const p: Vec3 = [c.sum[0] / c.count, c.sum[1] / c.count, c.sum[2] / c.count];
        const k = key(Math.floor(p[0] / range), Math.floor(p[1] / range), Math.floor(p[2] / range));
        const own = boxes.get(k);
        if (own) own.push(cells.length);
        else boxes.set(k, [cells.length]);
        cells.push({ p, t: c.t, count: c.count });
    }
    return { cells, boxes };
}

/**
 * The field of the sets the model follows. `range`: how far a reading
 * carries (null: from their spacing). Null when there is nothing to go on:
 * no reading followed and no direction set for the model.
 */
export function buildTrendField(sets: readonly ReadingSet[] | null | undefined, overall: OverallStructure | null, range: number | null = null): TrendField | null {
    const used = followedSets(sets);
    const planes = used.filter(s => s.kind === 'plane').reduce((n, s) => n + s.readings.length, 0);
    const lines = used.filter(s => s.kind === 'line').reduce((n, s) => n + s.readings.length, 0);
    if (planes + lines === 0 && !overall) return null;
    const given = range !== null && Number.isFinite(range) && range > 0;
    const reach = given ? range! : autoRange(used);
    return {
        range: reach, autoRange: !given, planes, lines, overall,
        planeLayer: planes > 0 ? layerOf(used, 'plane', reach) : null,
        lineLayer: lines > 0 ? layerOf(used, 'line', reach) : null,
    };
}

/**
 * The places the plane readings are taken together at, with the axis across
 * the ground at each (either way round) and how many readings it stands for.
 */
export function planeNodes(field: TrendField): { p: Vec3; axis: Vec3; count: number }[] {
    const out: { p: Vec3; axis: Vec3; count: number }[] = [];
    for (const cell of field.planeLayer?.cells ?? []) {
        const found = longest(cell.t);
        if (found) out.push({ p: cell.p, axis: found.axis, count: cell.count });
    }
    return out;
}

/**
 * The same places, with the axis that lies in the ground square to its long
 * direction at each (either way round): across the plunge. From the line
 * readings round about and, away from them, the model's own long direction,
 * laid into the plane at the place (`trendAt`). None where the ground has
 * no long direction, and none at all when nothing says it has one.
 */
export function acrossNodes(field: TrendField): { p: Vec3; axis: Vec3; count: number }[] {
    const out: { p: Vec3; axis: Vec3; count: number }[] = [];
    for (const node of planeNodes(field)) {
        const line = trendAt(field, node.p).line;
        const axis = line ? unit([node.axis[1] * line[2] - node.axis[2] * line[1], node.axis[2] * line[0] - node.axis[0] * line[2], node.axis[0] * line[1] - node.axis[1] * line[0]]) : null;
        if (axis) out.push({ p: node.p, axis, count: node.count });
    }
    return out;
}

/** What the readings of a layer add up to at a place: the weighted sum of n nT (as six numbers) and the weight */
function gather(layer: Layer | null, range: number, p: ArrayLike<number>, t: Float64Array): number {
    t.fill(0);
    if (!layer) return 0;
    const i0 = Math.floor(p[0] / range), j0 = Math.floor(p[1] / range), k0 = Math.floor(p[2] / range);
    let weight = 0;
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) for (let k = k0 - 1; k <= k0 + 1; k++) {
        const own = layer.boxes.get(key(i, j, k));
        if (!own) continue;
        for (const c of own) {
            const cell = layer.cells[c];
            const r2 = ((cell.p[0] - p[0]) ** 2 + (cell.p[1] - p[1]) ** 2 + (cell.p[2] - p[2]) ** 2) / (range * range);
            if (r2 >= 1) continue;
            // Full weight at the reading, none at the range, smoothly between, and falling off fast past the near ones
            const w = (1 - r2) * (1 - r2) * (NEAR * NEAR) / (r2 + NEAR * NEAR);
            for (let q = 0; q < 6; q++) t[q] += w * cell.t[q];
            weight += w * cell.count;
        }
    }
    return weight;
}

/** The axis a sum of n nT is longest along, and how much longer than along the next */
function longest(t: Float64Array): { axis: Vec3; agreement: number } | null {
    const { eigenvalues, eigenvectors } = jacobiEigendecomposition([[t[0], t[1], t[2]], [t[1], t[3], t[4]], [t[2], t[4], t[5]]]);
    const axis = unit(eigenvectors[0]);
    if (!axis || !(eigenvalues[0] > 0)) return null;
    return { axis, agreement: Math.min(1, Math.max(0, (eigenvalues[0] - Math.max(eigenvalues[1], 0)) / eigenvalues[0])) };
}

const add = (t: Float64Array, a: ArrayLike<number>, w: number) => {
    t[0] += w * a[0] * a[0]; t[1] += w * a[0] * a[1]; t[2] += w * a[0] * a[2];
    t[3] += w * a[1] * a[1]; t[4] += w * a[1] * a[2]; t[5] += w * a[2] * a[2];
};

/** The direction of the ground at a place. */
export function trendAt(field: TrendField, p: ArrayLike<number>): LocalTrend {
    const axes = field.overall ? structureAxes(field.overall) : null;
    const t = new Float64Array(6);
    const weight = gather(field.planeLayer, field.range, p, t);
    let normal: Vec3 | null = null, fromReadings = 0, agreement = 0;
    if (weight > SILENT || axes) {
        if (axes) add(t, axes.normal, FALLBACK_WEIGHT);
        const found = longest(t);
        if (found) {
            normal = found.axis[2] < 0 ? [-found.axis[0], -found.axis[1], -found.axis[2]] : found.axis;
            agreement = found.agreement;
            // (With no direction set for the model the plane is all from readings, but it fades the same way as they do)
            fromReadings = weight / (weight + FALLBACK_WEIGHT);
        }
    }
    // The long direction: from the line readings round about, else the model's own; laid into the plane here
    const lineWeight = gather(field.lineLayer, field.range, p, t);
    if (axes?.line) add(t, axes.line, FALLBACK_WEIGHT);
    let line: Vec3 | null = null;
    if (lineWeight > SILENT || axes?.line) {
        const found = longest(t);
        let along: Vec3 | null = found ? found.axis : null;
        if (along && normal) {
            const off = dot(along, normal);
            along = unit([along[0] - off * normal[0], along[1] - off * normal[1], along[2] - off * normal[2]]);
        }
        if (along) line = along[2] > 0 ? [-along[0], -along[1], -along[2]] : along;
    }
    if (!normal && !line) return NOTHING;
    return { normal, line, fromReadings, agreement, lineFromReadings: line ? lineWeight / (lineWeight + FALLBACK_WEIGHT) : 0 };
}

/** A place's direction as a dip and the bearing it dips towards (null: none there) */
export function trendDip(local: LocalTrend): { dip: number; direction: number } | null {
    if (!local.normal) return null;
    const { dip, dipDirection } = dipFromNormal(local.normal);
    return { dip, direction: dipDirection };
}

/**
 * Where the plane at a place meets a slice: the unit direction of its
 * trace on the slice (null: no direction there, or the plane lies in the
 * slice).
 */
export function traceOnSlice(local: LocalTrend, sliceNormal: ArrayLike<number>): Vec3 | null {
    return local.normal ? unit(cross(local.normal, sliceNormal)) : null;
}

export interface FormLines {
    /** Pairs of ends (xyz triples, world): where readings say most of how it lies */
    fromReadings: Float64Array;
    /** ... and where it is mostly the model's one direction */
    fromOverall: Float64Array;
}

/**
 * Short lines on a slice showing how the ground lies across it: at each
 * place of a grid over `box` (the data) on the slice's plane, the trace of
 * the local plane. `count`: about how many places along the longer side.
 */
export function formLines(field: TrendField, slice: { normal: ArrayLike<number>; point: ArrayLike<number> }, box: { min: ArrayLike<number>; max: ArrayLike<number> }, count = 28): FormLines {
    const n = unit(slice.normal);
    const strong: number[] = [], faint: number[] = [];
    if (!n) return { fromReadings: new Float64Array(0), fromOverall: new Float64Array(0) };
    // Two ways across the slice: one level where it can be
    const u = unit(cross([0, 0, 1], n)) ?? [1, 0, 0];
    const v = cross(n, u);
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (let c = 0; c < 8; c++) {
        const corner = [c & 1 ? box.max[0] : box.min[0], c & 2 ? box.max[1] : box.min[1], c & 4 ? box.max[2] : box.min[2]];
        const d = [corner[0] - slice.point[0], corner[1] - slice.point[1], corner[2] - slice.point[2]];
        const a = dot(d, u), b = dot(d, v);
        if (a < uMin) uMin = a;
        if (a > uMax) uMax = a;
        if (b < vMin) vMin = b;
        if (b > vMax) vMax = b;
    }
    const step = Math.max(uMax - uMin, vMax - vMin) / Math.max(4, count);
    if (!(step > 0)) return { fromReadings: new Float64Array(0), fromOverall: new Float64Array(0) };
    const pad = 0.02 * step, half = 0.36 * step;
    for (let a = uMin + step / 2; a < uMax; a += step) for (let b = vMin + step / 2; b < vMax; b += step) {
        const p: Vec3 = [slice.point[0] + a * u[0] + b * v[0], slice.point[1] + a * u[1] + b * v[1], slice.point[2] + a * u[2] + b * v[2]];
        // The slice runs beyond the data where it cuts the box at a slant
        if (p[0] < box.min[0] - pad || p[0] > box.max[0] + pad || p[1] < box.min[1] - pad || p[1] > box.max[1] + pad || p[2] < box.min[2] - pad || p[2] > box.max[2] + pad) continue;
        const local = trendAt(field, p);
        const along = traceOnSlice(local, n);
        if (!along) continue;
        (local.fromReadings >= 0.5 ? strong : faint).push(
            p[0] - half * along[0], p[1] - half * along[1], p[2] - half * along[2], p[0] + half * along[0], p[1] + half * along[1], p[2] + half * along[2],
        );
    }
    return { fromReadings: Float64Array.from(strong), fromOverall: Float64Array.from(faint) };
}
