/**
 * One mesher over the labels of a grid (pure): the faces between every pair
 * of labels, from which a geological model's cut surfaces, unit solids and
 * boundary are all taken, so they share the same triangles.
 *
 * Each node of the grid has a label (a unit, or OUTSIDE) worked out from the
 * surfaces' fields there. A grid edge whose two ends differ is crossed by a
 * face; the surface it lies on is the one whose field changes sign along the
 * edge where the label changes. Each cell with a crossed edge gets one
 * vertex, put where every surface crossing the cell is zero (least squares
 * on the planes through the crossings, each square to its field's slope
 * there, kept inside the cell): so where two surfaces meet the edge is sharp,
 * and a box's own edges and corners come out square. Each crossed edge gives
 * a quad joining the vertices of the four cells round it.
 *
 * The outermost layer of nodes must be OUTSIDE, so that every solid closes.
 */
import type { TriMesh, Vec3 } from './types';

export const OUTSIDE = -1;

export interface CutGrid {
    /** The first node, world */
    origin: Vec3;
    /** The spacing of the nodes, m */
    cell: number;
    /** How many nodes along x, y and z */
    n: [number, number, number];
}

export interface CutInput extends CutGrid {
    /** Each surface's field at the nodes (x fastest, then y, then z) */
    fields: readonly ArrayLike<number>[];
    /** The label of a place from the surfaces' fields there (only their signs may count) */
    labelOf: (values: ArrayLike<number>) => number;
}

/** The faces between labels. A triangle's normal points from `a` to `b`. */
export interface CutMesh {
    vertices: Float64Array;
    triangles: Uint32Array;
    /** Per triangle: the label behind it and the label in front of it */
    a: Int16Array;
    b: Int16Array;
    /** Per triangle: the surface it lies on (its number among `fields`) */
    on: Int16Array;
    /** The labels at the nodes */
    labels: Int16Array;
}

/** Solve a symmetric 3x3 system (Gaussian elimination with pivoting). False: it could not be. */
function solve3(m: number[], r: number[], out: number[]): boolean {
    const a = [[m[0], m[1], m[2], r[0]], [m[1], m[3], m[4], r[1]], [m[2], m[4], m[5], r[2]]];
    for (let c = 0; c < 3; c++) {
        let p = c;
        for (let k = c + 1; k < 3; k++) if (Math.abs(a[k][c]) > Math.abs(a[p][c])) p = k;
        if (Math.abs(a[p][c]) < 1e-14) return false;
        [a[c], a[p]] = [a[p], a[c]];
        for (let k = c + 1; k < 3; k++) {
            const f = a[k][c] / a[c][c];
            for (let j = c; j < 4; j++) a[k][j] -= f * a[c][j];
        }
    }
    for (let c = 2; c >= 0; c--) {
        let s = a[c][3];
        for (let j = c + 1; j < 3; j++) s -= a[c][j] * out[j];
        out[c] = s / a[c][c];
    }
    return true;
}

export function cutCells(input: CutInput): CutMesh {
    const { origin, cell, n, fields, labelOf } = input;
    const [nx, ny, nz] = n;
    const nodes = nx * ny * nz, nf = fields.length;
    const stride = [1, nx, nx * ny];
    const scratch = new Float64Array(nf);

    const labels = new Int16Array(nodes);
    for (let i = 0; i < nodes; i++) {
        for (let f = 0; f < nf; f++) scratch[f] = fields[f][i];
        labels[i] = labelOf(scratch);
    }

    // Each crossed edge: the surface it is crossed by and how far along (edge d of node i is at 3 * i + d)
    const edgeOn = new Int16Array(nodes * 3).fill(-1);
    const edgeT = new Float32Array(nodes * 3);
    const order: number[] = [], ts: number[] = [];
    const cross = (i: number, j: number, at: number) => {
        order.length = 0;
        for (let f = 0; f < nf; f++) if ((fields[f][i] > 0) !== (fields[f][j] > 0)) order.push(f);
        if (order.length === 0) return;
        if (order.length === 1) {
            const f = order[0], fa = fields[f][i], fb = fields[f][j];
            edgeOn[at] = f;
            edgeT[at] = Math.min(1, Math.max(0, fa / (fa - fb)));
            return;
        }
        // Several surfaces cross the edge: the one at which the label first changes, going along it
        ts.length = 0;
        for (const f of order) ts[f] = Math.min(1, Math.max(0, fields[f][i] / (fields[f][i] - fields[f][j])));
        order.sort((p, q) => ts[p] - ts[q]);
        for (let f = 0; f < nf; f++) scratch[f] = fields[f][i];
        const from = labels[i];
        for (const f of order) {
            // Just past this crossing: this field has the sign it has at the far end
            scratch[f] = fields[f][j];
            if (labelOf(scratch) !== from) {
                edgeOn[at] = f;
                edgeT[at] = ts[f];
                return;
            }
        }
        // (Signs alone did not say: the last one)
        const f = order[order.length - 1];
        edgeOn[at] = f;
        edgeT[at] = ts[f];
    };
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const at = i + nx * (j + ny * k);
        if (i + 1 < nx && labels[at] !== labels[at + 1]) cross(at, at + 1, at * 3);
        if (j + 1 < ny && labels[at] !== labels[at + nx]) cross(at, at + nx, at * 3 + 1);
        if (k + 1 < nz && labels[at] !== labels[at + nx * ny]) cross(at, at + nx * ny, at * 3 + 2);
    }

    // One vertex per cell with a crossed edge
    const cx = nx - 1, cy = ny - 1, cz = nz - 1;
    const cellVertex = new Int32Array(Math.max(0, cx * cy * cz)).fill(-1);
    const verts: number[] = [];
    // The 12 edges of a cell: the node each starts at (as an offset in i, j, k) and its axis
    const CELL_EDGES: [number, number, number, number][] = [
        [0, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 1, 1, 0],
        [0, 0, 0, 1], [1, 0, 0, 1], [0, 0, 1, 1], [1, 0, 1, 1],
        [0, 0, 0, 2], [1, 0, 0, 2], [0, 1, 0, 2], [1, 1, 0, 2],
    ];
    const m = [0, 0, 0, 0, 0, 0], r = [0, 0, 0], v = [0, 0, 0];
    for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
        const base = i + nx * (j + ny * k);
        let count = 0, mx = 0, my = 0, mz = 0;
        m.fill(0); r.fill(0);
        const px: number[] = [], on: number[] = [];
        for (const [di, dj, dk, d] of CELL_EDGES) {
            const node = base + di + nx * (dj + ny * dk);
            const f = edgeOn[node * 3 + d];
            if (f < 0) continue;
            const t = edgeT[node * 3 + d];
            const p = [di + (d === 0 ? t : 0), dj + (d === 1 ? t : 0), dk + (d === 2 ? t : 0)];
            px.push(p[0], p[1], p[2]);
            on.push(f);
            mx += p[0]; my += p[1]; mz += p[2];
            count++;
        }
        if (count === 0) continue;
        mx /= count; my /= count; mz /= count;
        const normals: [number, number, number][] = [];
        for (let e = 0; e < count; e++) {
            // The field's slope at the crossing, from the cell's corners
            const F = fields[on[e]];
            const c = (p: number, q: number, w: number) => F[base + p + nx * (q + ny * w)];
            const u = px[e * 3], t = px[e * 3 + 1], w = px[e * 3 + 2];
            let gx = ((c(1, 0, 0) - c(0, 0, 0)) * (1 - t) + (c(1, 1, 0) - c(0, 1, 0)) * t) * (1 - w) + ((c(1, 0, 1) - c(0, 0, 1)) * (1 - t) + (c(1, 1, 1) - c(0, 1, 1)) * t) * w;
            let gy = ((c(0, 1, 0) - c(0, 0, 0)) * (1 - u) + (c(1, 1, 0) - c(1, 0, 0)) * u) * (1 - w) + ((c(0, 1, 1) - c(0, 0, 1)) * (1 - u) + (c(1, 1, 1) - c(1, 0, 1)) * u) * w;
            let gz = ((c(0, 0, 1) - c(0, 0, 0)) * (1 - u) + (c(1, 0, 1) - c(1, 0, 0)) * u) * (1 - t) + ((c(0, 1, 1) - c(0, 1, 0)) * (1 - u) + (c(1, 1, 1) - c(1, 1, 0)) * u) * t;
            const len = Math.hypot(gx, gy, gz);
            if (len > 1e-12) { gx /= len; gy /= len; gz /= len; } else { gx = 0; gy = 0; gz = 0; }
            const g: [number, number, number] = [gx, gy, gz];
            // The plane through the crossing, square to the slope: (v - p) . g = 0
            normals.push(g);
            m[0] += g[0] * g[0]; m[1] += g[0] * g[1]; m[2] += g[0] * g[2]; m[3] += g[1] * g[1]; m[4] += g[1] * g[2]; m[5] += g[2] * g[2];
        }
        // A little pull to where it is settles the directions no plane fixes; taken again from where it lands,
        // the pull no longer holds it off the planes
        const pull = 1e-3 * count;
        m[0] += pull; m[3] += pull; m[5] += pull;
        let vx = mx, vy = my, vz = mz;
        for (let round = 0; round < 4; round++) {
            r.fill(0);
            for (let e = 0; e < count; e++) {
                const g = normals[e];
                const d = (px[e * 3] - vx) * g[0] + (px[e * 3 + 1] - vy) * g[1] + (px[e * 3 + 2] - vz) * g[2];
                r[0] += g[0] * d; r[1] += g[1] * d; r[2] += g[2] * d;
            }
            if (!solve3(m, r, v)) break;
            vx += v[0]; vy += v[1]; vz += v[2];
        }
        const lim = (x: number) => Math.min(1, Math.max(0, x));
        cellVertex[i + cx * (j + cy * k)] = verts.length / 3;
        verts.push(origin[0] + (i + lim(vx)) * cell, origin[1] + (j + lim(vy)) * cell, origin[2] + (k + lim(vz)) * cell);
    }

    // A quad for each crossed edge with four cells round it
    const tris: number[] = [], la: number[] = [], lb: number[] = [], lon: number[] = [];
    const vertices = new Float64Array(verts);
    const far = (p: number, q: number) => (vertices[p * 3] - vertices[q * 3]) ** 2 + (vertices[p * 3 + 1] - vertices[q * 3 + 1]) ** 2 + (vertices[p * 3 + 2] - vertices[q * 3 + 2]) ** 2;
    const at = (i: number, j: number, k: number) => cellVertex[i + cx * (j + cy * k)];
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const node = i + nx * (j + ny * k);
        for (let d = 0; d < 3; d++) {
            const f = edgeOn[node * 3 + d];
            if (f < 0) continue;
            let q: [number, number, number, number];
            if (d === 0) {
                if (j < 1 || k < 1 || j > cy - 1 || k > cz - 1) continue;
                q = [at(i, j - 1, k - 1), at(i, j, k - 1), at(i, j, k), at(i, j - 1, k)];
            } else if (d === 1) {
                if (i < 1 || k < 1 || i > cx - 1 || k > cz - 1) continue;
                q = [at(i - 1, j, k - 1), at(i - 1, j, k), at(i, j, k), at(i, j, k - 1)];
            } else {
                if (i < 1 || j < 1 || i > cx - 1 || j > cy - 1) continue;
                q = [at(i - 1, j - 1, k), at(i, j - 1, k), at(i, j, k), at(i - 1, j, k)];
            }
            const a = labels[node], b = labels[node + stride[d]];
            // Cut along the shorter diagonal
            if (far(q[0], q[2]) <= far(q[1], q[3])) tris.push(q[0], q[1], q[2], q[0], q[2], q[3]);
            else tris.push(q[0], q[1], q[3], q[1], q[2], q[3]);
            la.push(a, a); lb.push(b, b); lon.push(f, f);
        }
    }
    return { vertices, triangles: new Uint32Array(tris), a: new Int16Array(la), b: new Int16Array(lb), on: new Int16Array(lon), labels };
}

/**
 * Some of the faces as a mesh of their own. `pick` says of each triangle
 * whether it is wanted as it is (1), turned over (-1) or not (0). Only the
 * vertices used are kept.
 */
export function facesOf(mesh: CutMesh, pick: (a: number, b: number, on: number) => number): TriMesh {
    const map = new Int32Array(mesh.vertices.length / 3).fill(-1);
    const verts: number[] = [], tris: number[] = [];
    const take = (v: number) => {
        if (map[v] < 0) {
            map[v] = verts.length / 3;
            verts.push(mesh.vertices[v * 3], mesh.vertices[v * 3 + 1], mesh.vertices[v * 3 + 2]);
        }
        return map[v];
    };
    for (let t = 0; t < mesh.a.length; t++) {
        const way = pick(mesh.a[t], mesh.b[t], mesh.on[t]);
        if (way === 0) continue;
        const p = take(mesh.triangles[t * 3]), q = take(mesh.triangles[t * 3 + 1]), s = take(mesh.triangles[t * 3 + 2]);
        if (way > 0) tris.push(p, q, s); else tris.push(p, s, q);
    }
    return { vertices: new Float64Array(verts), triangles: new Uint32Array(tris) };
}

/** The closed solid of one label: every face with it on one side, facing outwards */
export const solidOf = (mesh: CutMesh, label: number): TriMesh => facesOf(mesh, (a, b) => (a === label ? 1 : b === label ? -1 : 0));

/** The faces lying on one surface, between labels inside the boundary (facing its `a` side to its `b` side) */
export const surfaceOf = (mesh: CutMesh, on: number): TriMesh => facesOf(mesh, (a, b, o) => (o === on && a !== OUTSIDE && b !== OUTSIDE ? 1 : 0));

/** The volume a closed mesh facing outwards holds, m3 */
export function meshVolume(mesh: TriMesh): number {
    const { vertices: v, triangles: t } = mesh;
    // About its first vertex: the sums stay small beside the coordinates
    const ox = v[0] ?? 0, oy = v[1] ?? 0, oz = v[2] ?? 0;
    let six = 0;
    for (let i = 0; i < t.length; i += 3) {
        const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
        const ax = v[a] - ox, ay = v[a + 1] - oy, az = v[a + 2] - oz;
        const bx = v[b] - ox, by = v[b + 1] - oy, bz = v[b + 2] - oz;
        const cx = v[c] - ox, cy = v[c + 1] - oy, cz = v[c + 2] - oz;
        six += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    }
    return six / 6;
}

/** How a mesh's edges are shared: by one triangle (open), by two, or by more */
export function edgeSharing(mesh: TriMesh): { open: number; two: number; more: number } {
    const count = new Map<number, number>();
    const nv = mesh.vertices.length / 3;
    const t = mesh.triangles;
    for (let i = 0; i < t.length; i += 3) {
        for (let e = 0; e < 3; e++) {
            const p = t[i + e], q = t[i + (e + 1) % 3];
            if (p === q) continue;
            const key = p < q ? p * nv + q : q * nv + p;
            count.set(key, (count.get(key) ?? 0) + 1);
        }
    }
    const out = { open: 0, two: 0, more: 0 };
    for (const c of count.values()) { if (c === 1) out.open++; else if (c === 2) out.two++; else out.more++; }
    return out;
}
