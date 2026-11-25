/**
 * The ground a geological model's own drilling covers (pure, unit-tested).
 *
 * A model with no box of its own took the box of every row of data. A
 * project holds holes that were never logged (assay holes, old drilling far
 * from the mine), so that box can be many times the ground the model's
 * logging is in: on a real project 650 x 760 x 590 m round logging that
 * fills about 100 x 400 x 150 m, the rest of it the base unit and layers
 * carried hundreds of metres from any hole that says so.
 *
 * So: the places down the holes the model reads (`drilledPlaces`), the box
 * of those (`placesBox`), and a limit by distance from them (`NearDrilling`):
 * ground further than a reach from every such place is not in the model.
 * The reach, when none is set, is from how far apart the holes are
 * (`drillingReach`).
 */
import { NearGrid } from './near';
import type { HoleLog } from './contacts';
import type { Box3, Vec3 } from './types';

/** Places are no further apart down a hole than this share of the reach they are for */
export const PLACE_STEP = 0.25;
/** ... and no more of them than this are kept (thinned evenly beyond it) */
export const MAX_PLACES = 60_000;

/**
 * Where the holes a model reads are: both ends of every logged interval (one
 * with a unit of the model in it), and places between no further apart than
 * `step` m. `group`: the hole each place is in, as a number. Rows with no
 * hole, no unit or no place give nothing. A place under half a step from the
 * last one kept of its hole is passed over (the end of one interval is the
 * start of the next; short intervals crowd).
 */
export function drilledPlaces(log: HoleLog, step: number): { places: Float64Array; group: Int32Array } {
    const at: number[] = [], group: number[] = [];
    const holes = new Map<string, number>();
    const n = log.code.length;
    const span = step > 0 ? step : Infinity;
    const apart = step > 0 ? (step / 2) * (step / 2) : 0;
    const last = new Map<number, [number, number, number]>();
    const keep = (h: number, x: number, y: number, z: number): boolean => {
        const was = last.get(h);
        if (was && apart > 0 && (was[0] - x) ** 2 + (was[1] - y) ** 2 + (was[2] - z) ** 2 < apart * 0.999) return false;
        last.set(h, [x, y, z]);
        at.push(x, y, z);
        group.push(h);
        return true;
    };
    for (let i = 0; i < n; i++) {
        const hole = log.hole[i], code = log.code[i];
        if (!hole || !code) continue;
        let h = holes.get(hole);
        if (h === undefined) { h = holes.size; holes.set(hole, h); }
        const from = log.from[i], to = log.to ? log.to[i] : NaN;
        const length = Number.isFinite(to) && to > from ? to - from : 0;
        const pieces = length > 0 ? Math.max(1, Math.ceil(length / span)) : 0;
        let placed = 0;
        if (log.placeAt && pieces > 0) {
            for (let k = 0; k <= pieces; k++) {
                const p = log.placeAt(i, from + (k / pieces) * length);
                if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !Number.isFinite(p[2])) continue;
                keep(h, p[0], p[1], p[2]);
                placed++;
            }
        }
        // (No path for the hole: the row's own place)
        if (placed === 0 && Number.isFinite(log.x[i]) && Number.isFinite(log.y[i]) && Number.isFinite(log.z[i])) keep(h, log.x[i], log.y[i], log.z[i]);
    }
    const count = group.length;
    if (count <= MAX_PLACES) return { places: Float64Array.from(at), group: Int32Array.from(group) };
    const every = Math.ceil(count / MAX_PLACES);
    const places: number[] = [], kept: number[] = [];
    for (let i = 0; i < count; i += every) { places.push(at[i * 3], at[i * 3 + 1], at[i * 3 + 2]); kept.push(group[i]); }
    return { places: Float64Array.from(places), group: Int32Array.from(kept) };
}

/** The box that holds places (xyz triples; null: none) */
export function placesBox(places: ArrayLike<number>): Box3 | null {
    const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i + 2 < places.length; i += 3) {
        for (let k = 0; k < 3; k++) {
            const v = places[i + k];
            if (v < min[k]) min[k] = v;
            if (v > max[k]) max[k] = v;
        }
    }
    return Number.isFinite(min[0]) ? { min, max } : null;
}

/** The reach is the gap at which this share of the drilling is linked, hole to hole, into one piece */
export const REACH_SHARE = 0.95;
/** At most this many places are linked to find it (taken evenly) */
const REACH_ASKED = 4000;

const ROUND = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
/** The round number at or above a length (1, 1.5, 2, 2.5, 3, 4, 5, 6 or 8 times a power of ten) */
export function roundReach(length: number): number {
    if (!(length > 0)) return 0;
    const power = 10 ** Math.floor(Math.log10(length));
    return power * (ROUND.find(v => v * power >= length * 0.999) ?? 10);
}

/**
 * How far from its drilling a model is carried when no reach is set: how far
 * apart its holes are, as a round number. Holes are linked to their nearest
 * neighbours, the closest first; the reach is the gap at which nearly all of
 * the drilling (`REACH_SHARE` of its places) is one piece. So lines of holes
 * 3 m apart on levels 30 m apart give 30, not 3 (ground between the levels
 * is in the model); a hole or two far off do not set it; and ground within
 * it of a hole covers the middle of a square, or a cube, of holes that far
 * apart. One hole, or none: null (nothing says how far).
 */
export function drillingReach(places: ArrayLike<number>, group: ArrayLike<number>): number | null {
    const n = Math.floor(places.length / 3);
    if (n < 2) return null;
    const every = Math.max(1, Math.ceil(n / REACH_ASKED));
    const at: number[] = [];
    for (let i = 0; i < n; i += every) at.push(i);
    const m = at.length;
    let several = false;
    for (let i = 1; i < m && !several; i++) several = group[at[i]] !== group[at[0]];
    if (!several) return null;
    // The tree that links them all by the shortest gaps (places of one hole are no distance apart)
    const best = new Float64Array(m).fill(Infinity), from = new Int32Array(m).fill(-1), done = new Uint8Array(m);
    const links: { d: number; a: number; b: number }[] = [];
    best[0] = 0;
    for (let round = 0; round < m; round++) {
        let u = -1;
        for (let i = 0; i < m; i++) if (!done[i] && (u < 0 || best[i] < best[u])) u = i;
        if (u < 0 || !Number.isFinite(best[u])) break;
        done[u] = 1;
        if (from[u] >= 0) links.push({ d: best[u], a: from[u], b: u });
        const x = places[at[u] * 3], y = places[at[u] * 3 + 1], z = places[at[u] * 3 + 2], g = group[at[u]];
        for (let v = 0; v < m; v++) {
            if (done[v]) continue;
            const d = group[at[v]] === g ? 0 : Math.hypot(places[at[v] * 3] - x, places[at[v] * 3 + 1] - y, places[at[v] * 3 + 2] - z);
            if (d < best[v]) { best[v] = d; from[v] = u; }
        }
    }
    links.sort((p, q) => p.d - q.d);
    // Joined shortest first, until one piece holds nearly all of them
    const parent = Int32Array.from({ length: m }, (_v, i) => i), size = new Int32Array(m).fill(1);
    const root = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const wanted = REACH_SHARE * m;
    for (const link of links) {
        const a = root(link.a), b = root(link.b);
        if (a === b) continue;
        parent[a] = b;
        size[b] += size[a];
        if (size[b] >= wanted && link.d > 0) return roundReach(link.d);
    }
    const last = links.at(-1);
    return last && last.d > 0 ? roundReach(last.d) : null;
}

/** A limit by distance from a model's drilling */
export interface NearGround {
    /** The places down the holes it reads, xyz triples */
    places: Float64Array;
    /** Ground further than this from every one of them is not in the model, m */
    reach: number;
}

const grids = new WeakMap<NearGround, NearGrid>();

/**
 * The limit as a field, like the other parts of a model's boundary: positive
 * inside, about the distance to its edge in metres (the reach less the
 * distance to the nearest place); never less than minus the reach.
 */
export function nearDrilling(near: NearGround, x: number, y: number, z: number): number {
    let grid = grids.get(near);
    if (!grid) {
        grid = new NearGrid(near.places, near.reach / 2);
        grids.set(near, grid);
    }
    // (Looked for close by first: most ground that is in is well inside, and the drilling is dense there)
    const close = near.reach / 2;
    const d = grid.nearest(x, y, z, close);
    return near.reach - (d < close ? d : grid.nearest(x, y, z, 2 * near.reach));
}

/**
 * Gaps in the ground near the drilling are filled where they are narrower
 * than the reach: a slit between two holes a little over twice the reach
 * apart, a pocket with holes all round it. (The ground is closed by this
 * share of the reach: a place is in when everything within that far of it is
 * within the reach and that far of a hole. So nothing is in that is further
 * than one and a half times the reach from every hole, and nothing is added
 * on the outside of the drilling, where the ground is not hemmed in.)
 */
export const CLOSE_SHARE = 0.5;
/** The filling is worked out on a grid of its own: this many cells to the reach, and no more nodes than this */
const CLOSE_CELLS = 12, CLOSE_NODES = 4_000_000;
const FAR = 1e20;

/**
 * Squared distances along one line of a grid (Felzenszwalb and
 * Huttenlocher): `f` holds, at each node, the squared distance found so far
 * (`FAR`: none); afterwards the least of that at any node of the line and
 * the squared distance along the line to it. `w2`: the cell's side, squared.
 */
function alongLine(f: Float64Array, n: number, w2: number, v: Int32Array, z: Float64Array, out: Float64Array): void {
    let k = 0;
    v[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    for (let q = 1; q < n; q++) {
        let s = ((f[q] + w2 * q * q) - (f[v[k]] + w2 * v[k] * v[k])) / (2 * w2 * (q - v[k]));
        while (k > 0 && s <= z[k]) {
            k--;
            s = ((f[q] + w2 * q * q) - (f[v[k]] + w2 * v[k] * v[k])) / (2 * w2 * (q - v[k]));
        }
        k++;
        v[k] = q;
        z[k] = s;
        z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
        while (z[k + 1] < q) k++;
        const p = v[k];
        out[q] = w2 * (q - p) * (q - p) + f[p];
    }
}

/** Squared distance, at every node of a grid, to the nearest node that holds one (in place: `field` holds the squared distance known at each node, `FAR` where none) */
export function squaredDistances(field: Float32Array, n: readonly [number, number, number], cell: number): void {
    const w2 = cell * cell, most = Math.max(n[0], n[1], n[2]);
    const f = new Float64Array(most), out = new Float64Array(most), v = new Int32Array(most), z = new Float64Array(most + 1);
    const strides = [1, n[0], n[0] * n[1]];
    for (let axis = 0; axis < 3; axis++) {
        const a = n[axis], b = n[(axis + 1) % 3], c = n[(axis + 2) % 3];
        const sa = strides[axis], sb = strides[(axis + 1) % 3], sc = strides[(axis + 2) % 3];
        if (a < 2) continue;
        for (let j = 0; j < b; j++) for (let k = 0; k < c; k++) {
            const from = j * sb + k * sc;
            for (let i = 0; i < a; i++) f[i] = field[from + i * sa];
            alongLine(f, a, w2, v, z, out);
            for (let i = 0; i < a; i++) field[from + i * sa] = Math.min(out[i], FAR);
        }
    }
}

interface ClosedGround { origin: Vec3; n: [number, number, number]; cell: number; value: Float32Array }
const closedOf = new WeakMap<NearGround, ClosedGround | null>();

/** The ground near the drilling with its gaps filled, as a field on a grid of its own (null: the drilling is too wide for a grid fine enough) */
function closedGround(near: NearGround): ClosedGround | null {
    if (closedOf.has(near)) return closedOf.get(near)!;
    let made: ClosedGround | null = null;
    const box = placesBox(near.places), by = CLOSE_SHARE * near.reach;
    if (box && near.reach > 0) {
        let cell = near.reach / CLOSE_CELLS;
        const pad = near.reach + by + 2 * cell;
        const size = [0, 1, 2].map(k => box.max[k] - box.min[k] + 2 * pad);
        cell = Math.max(cell, Math.cbrt(size[0] * size[1] * size[2] / CLOSE_NODES));
        // (A grid too coarse for the gaps it is to fill fills nothing)
        if (cell <= by / 3) {
            const origin: Vec3 = [box.min[0] - pad, box.min[1] - pad, box.min[2] - pad];
            const n: [number, number, number] = [Math.ceil(size[0] / cell) + 1, Math.ceil(size[1] / cell) + 1, Math.ceil(size[2] / cell) + 1];
            const field = new Float32Array(n[0] * n[1] * n[2]).fill(FAR);
            // How far each node is from the drilling: every place is put on the node nearest it, with how far off it it is
            const p = near.places;
            for (let i = 0; i + 2 < p.length; i += 3) {
                const u = (p[i] - origin[0]) / cell, v = (p[i + 1] - origin[1]) / cell, w = (p[i + 2] - origin[2]) / cell;
                const a = Math.round(u), b = Math.round(v), c = Math.round(w);
                const at = a + n[0] * (b + n[1] * c), off = ((u - a) ** 2 + (v - b) ** 2 + (w - c) ** 2) * cell * cell;
                if (off < field[at]) field[at] = off;
            }
            squaredDistances(field, n, cell);
            // Outside the ground widened by the filling distance; then how far each node is from that outside
            const wide = (near.reach + by) ** 2;
            for (let i = 0; i < field.length; i++) field[i] = field[i] > wide ? 0 : FAR;
            squaredDistances(field, n, cell);
            // In by more than the filling distance: in the closed ground. (A cell and a half kept back: the grid is not
            // exact, and where nothing is filled the edge is the exact one, never this one)
            // Outside the widened ground nothing is filled: far below any distance, so that the exact edge is the one read there
            for (let i = 0; i < field.length; i++) field[i] = field[i] > 0 ? Math.min(Math.sqrt(field[i]), 4 * near.reach) - by - 1.5 * cell : -4 * near.reach;
            made = { origin, n, cell, value: field };
        }
    }
    closedOf.set(near, made);
    return made;
}

/**
 * The limit a model is cut at, as a field: the reach less the distance to
 * the nearest place (`nearDrilling`), and, where a gap narrower than the
 * reach is filled, how far inside the filled ground. Positive inside.
 */
export function nearReader(near: NearGround): (x: number, y: number, z: number) => number {
    const closed = closedGround(near);
    if (!closed) return (x, y, z) => nearDrilling(near, x, y, z);
    const { origin, n, cell, value } = closed;
    const sx = n[0], sxy = n[0] * n[1];
    return (x, y, z) => {
        const raw = nearDrilling(near, x, y, z);
        const u = (x - origin[0]) / cell, v = (y - origin[1]) / cell, w = (z - origin[2]) / cell;
        const i = Math.floor(u), j = Math.floor(v), k = Math.floor(w);
        if (!(i >= 0 && j >= 0 && k >= 0 && i < n[0] - 1 && j < n[1] - 1 && k < n[2] - 1)) return raw;
        const a = u - i, b = v - j, c = w - k, at = i + sx * j + sxy * k;
        const low = (value[at] * (1 - a) + value[at + 1] * a) * (1 - b) + (value[at + sx] * (1 - a) + value[at + sx + 1] * a) * b;
        const high = (value[at + sxy] * (1 - a) + value[at + sxy + 1] * a) * (1 - b) + (value[at + sxy + sx] * (1 - a) + value[at + sxy + sx + 1] * a) * b;
        const filled = low * (1 - c) + high * c;
        return filled > raw ? filled : raw;
    };
}

/** A mark that tells one limit from another: its reach, how many places, and where they are */
export function nearMark(near: NearGround | null | undefined): string {
    if (!near) return '';
    let h = 2166136261;
    const p = near.places;
    for (let i = 0; i < p.length; i++) {
        h ^= Math.round(p[i] * 100) | 0;
        h = Math.imul(h, 16777619);
    }
    return `near:${near.reach}:${p.length / 3}:${(h >>> 0).toString(16)}`;
}

/** Of a box, the share that is within the reach of the places (counted on a grid of about `cells` a side) */
export function shareNear(near: NearGround, box: Box3, cells = 24): number {
    let inside = 0, all = 0;
    for (let i = 0; i < cells; i++) {
        const x = box.min[0] + (i + 0.5) * (box.max[0] - box.min[0]) / cells;
        for (let j = 0; j < cells; j++) {
            const y = box.min[1] + (j + 0.5) * (box.max[1] - box.min[1]) / cells;
            for (let k = 0; k < cells; k++) {
                const z = box.min[2] + (k + 0.5) * (box.max[2] - box.min[2]) / cells;
                all++;
                if (nearDrilling(near, x, y, z) > 0) inside++;
            }
        }
    }
    return all > 0 ? inside / all : 0;
}
