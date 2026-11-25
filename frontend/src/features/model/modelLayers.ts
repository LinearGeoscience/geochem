/**
 * How the layers of a geological model lie, as plane readings taken off the
 * fitted meshes of its layer contacts (Phase 267, pure). A body or a vein
 * that follows the layers of its model (a sill, a stratabound lode) follows
 * these as it would follow structural data from the core: a direction field
 * built of them (trendField.ts) says how the ground lies at any place, and
 * the fit carries further along that than across it.
 *
 * A mesh is read in cells: the triangles whose middles are in one cell give
 * one reading there, where their middles are (weighted by area), lying as
 * they lie on the whole (the area-weighted normal; a triangle facing the
 * other way from the first of its cell is turned over, so a surface whose
 * triangles are listed either way round reads the same).
 */
import type { Vec3 } from './types';

/** A plane as it lies at a place */
export interface LayerReading { p: Vec3; dip: number; direction: number }

/** A mesh this many cells along its longest side is read finely enough: folds shorter than a few cells are not carried anyway */
export const LAYER_CELLS = 14;
/** The most readings taken off the contacts of one model */
export const MAX_LAYER_READINGS = 1500;

/** The dip (degrees below level) and the bearing it dips towards of a plane with this normal (either way round) */
export function dipOfNormal(n: ArrayLike<number>): { dip: number; direction: number } | null {
    const length = Math.hypot(n[0], n[1], n[2]);
    if (!(length > 0)) return null;
    // (As seen from above: the normal turned to point up leans the way the plane dips)
    const s = n[2] < 0 ? -1 / length : 1 / length;
    const x = n[0] * s, y = n[1] * s, z = Math.min(1, Math.max(0, n[2] * s));
    const dip = Math.acos(z) * 180 / Math.PI;
    const direction = Math.hypot(x, y) > 1e-12 ? (Math.atan2(x, y) * 180 / Math.PI + 360) % 360 : 0;
    return { dip, direction };
}

/**
 * The readings a mesh gives, one for each cell of `cell` metres its
 * triangles are in. None for a mesh with no area or a cell that is not a
 * length.
 */
export function meshReadings(mesh: { vertices: ArrayLike<number>; triangles: ArrayLike<number> }, cell: number): LayerReading[] {
    if (!(cell > 0)) return [];
    const v = mesh.vertices, t = mesh.triangles;
    const cells = new Map<string, { n: [number, number, number]; c: [number, number, number]; area: number }>();
    for (let i = 0; i + 2 < t.length; i += 3) {
        const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
        const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
        const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
        // (Twice the triangle's area, along its normal)
        let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
        const area = Math.hypot(nx, ny, nz) / 2;
        if (!(area > 0) || !Number.isFinite(area)) continue;
        const mx = (v[a] + v[b] + v[c]) / 3, my = (v[a + 1] + v[b + 1] + v[c + 1]) / 3, mz = (v[a + 2] + v[b + 2] + v[c + 2]) / 3;
        const key = `${Math.floor(mx / cell)},${Math.floor(my / cell)},${Math.floor(mz / cell)}`;
        let at = cells.get(key);
        if (!at) cells.set(key, at = { n: [0, 0, 0], c: [0, 0, 0], area: 0 });
        if (at.n[0] * nx + at.n[1] * ny + at.n[2] * nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
        at.n[0] += nx / 2; at.n[1] += ny / 2; at.n[2] += nz / 2;
        at.c[0] += mx * area; at.c[1] += my * area; at.c[2] += mz * area;
        at.area += area;
    }
    const out: LayerReading[] = [];
    for (const at of cells.values()) {
        const lies = dipOfNormal(at.n);
        if (!lies) continue;
        out.push({ p: [at.c[0] / at.area, at.c[1] / at.area, at.c[2] / at.area], ...lies });
    }
    return out;
}

/**
 * The readings the layer contacts of a model give together: each mesh read
 * in cells a fourteenth of the longest side of them all (so every contact
 * is read alike), and thinned evenly where there are more than the most
 * that are taken. `cell`: that length, for saying how finely it was read.
 */
export function layerReadings(meshes: readonly { vertices: ArrayLike<number>; triangles: ArrayLike<number> }[]): { readings: LayerReading[]; cell: number } {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const m of meshes) {
        for (let i = 0; i + 2 < m.vertices.length; i += 3) {
            for (let k = 0; k < 3; k++) { const x = m.vertices[i + k]; if (x < lo[k]) lo[k] = x; if (x > hi[k]) hi[k] = x; }
        }
    }
    const side = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
    if (!(side > 0) || !Number.isFinite(side)) return { readings: [], cell: 0 };
    const cell = side / LAYER_CELLS;
    let readings = meshes.flatMap(m => meshReadings(m, cell));
    if (readings.length > MAX_LAYER_READINGS) {
        const step = readings.length / MAX_LAYER_READINGS;
        readings = Array.from({ length: MAX_LAYER_READINGS }, (_, k) => readings[Math.floor(k * step)]);
    }
    return { readings, cell };
}
