/**
 * Operations on triangle meshes (pure, unit-tested): trimming a mesh to an
 * extent, and the helpers that needs.
 */
import type { Box3, TriMesh } from './types';

/**
 * Keep the part of a mesh where `g` (one value per vertex) is <= 0. Triangles
 * that straddle the boundary are cut along it, so the edge is smooth rather
 * than stepped; winding is kept.
 */
export function clipMeshByScalar(mesh: TriMesh, g: ArrayLike<number>): TriMesh {
    const { vertices, triangles } = mesh;
    const n = vertices.length / 3;
    const remap = new Int32Array(n).fill(-1);
    const verts: number[] = [];
    const tris: number[] = [];
    const keepVertex = (i: number) => {
        if (remap[i] < 0) {
            remap[i] = verts.length / 3;
            verts.push(vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2]);
        }
        return remap[i];
    };
    const cuts = new Map<number, number>();
    /** The point on edge a-b where g is 0 (a inside, b outside, or the reverse) */
    const cut = (a: number, b: number) => {
        const lo = Math.min(a, b), hi = Math.max(a, b);
        const k = lo * n + hi;
        const hit = cuts.get(k);
        if (hit !== undefined) return hit;
        const t = g[lo] / (g[lo] - g[hi]);
        const id = verts.length / 3;
        for (let c = 0; c < 3; c++) verts.push(vertices[lo * 3 + c] + (vertices[hi * 3 + c] - vertices[lo * 3 + c]) * t);
        cuts.set(k, id);
        return id;
    };
    const isIn = (i: number) => g[i] <= 0;
    for (let q = 0; q < triangles.length; q += 3) {
        const t = [triangles[q], triangles[q + 1], triangles[q + 2]];
        const count = (isIn(t[0]) ? 1 : 0) + (isIn(t[1]) ? 1 : 0) + (isIn(t[2]) ? 1 : 0);
        if (count === 0) continue;
        if (count === 3) {
            tris.push(keepVertex(t[0]), keepVertex(t[1]), keepVertex(t[2]));
            continue;
        }
        // Rotate so the odd one out comes first
        const odd = count === 1 ? t.findIndex(isIn) : t.findIndex(i => !isIn(i));
        const a = t[odd], b = t[(odd + 1) % 3], c = t[(odd + 2) % 3];
        if (count === 1) {
            tris.push(keepVertex(a), cut(a, b), cut(a, c));
        } else {
            const ab = cut(a, b), ac = cut(a, c), kb = keepVertex(b), kc = keepVertex(c);
            tris.push(ab, kb, kc, ab, kc, ac);
        }
    }
    return { vertices: Float64Array.from(verts), triangles: Uint32Array.from(tris) };
}

/** Trim a mesh to a box (exact: one cut per face of the box). */
export function clipMeshToBox(mesh: TriMesh, box: Box3): TriMesh {
    let out = mesh;
    for (let axis = 0; axis < 3; axis++) {
        for (const side of [-1, 1]) {
            const n = out.vertices.length / 3;
            const limit = side < 0 ? box.min[axis] : box.max[axis];
            const g = new Float64Array(n);
            let any = false;
            for (let i = 0; i < n; i++) {
                g[i] = side * (out.vertices[i * 3 + axis] - limit);
                if (g[i] > 0) any = true;
            }
            if (any) out = clipMeshByScalar(out, g);
        }
    }
    return out;
}

/**
 * Points binned on a grid, for "how far is the nearest point" within a known
 * search distance (the grid's cell size).
 */
export class PointGrid {
    private readonly bins = new Map<number, number[]>();
    private readonly min: [number, number, number] = [0, 0, 0];
    private readonly size: [number, number, number] = [1, 1, 1];

    constructor(private readonly points: ArrayLike<number>, readonly reach: number) {
        const max = [-Infinity, -Infinity, -Infinity];
        this.min = [Infinity, Infinity, Infinity];
        for (let i = 0; i + 2 < points.length; i += 3) {
            for (let k = 0; k < 3; k++) {
                if (points[i + k] < this.min[k]) this.min[k] = points[i + k];
                if (points[i + k] > max[k]) max[k] = points[i + k];
            }
        }
        if (!(max[0] >= this.min[0])) return;
        for (let k = 0; k < 3; k++) this.size[k] = Math.floor((max[k] - this.min[k]) / reach) + 1;
        for (let i = 0; i + 2 < points.length; i += 3) {
            const key = this.key(this.cell(points[i], 0), this.cell(points[i + 1], 1), this.cell(points[i + 2], 2));
            const bin = this.bins.get(key);
            if (bin) bin.push(i);
            else this.bins.set(key, [i]);
        }
    }

    private cell(v: number, axis: number) {
        return Math.floor((v - this.min[axis]) / this.reach);
    }

    private key(i: number, j: number, k: number) {
        return i + this.size[0] * (j + this.size[1] * k);
    }

    /** Distance to the nearest point, or `reach` when none is that close. */
    distance(x: number, y: number, z: number): number {
        const r = this.reach, p = this.points;
        const [sx, sy, sz] = this.size;
        const ci = this.cell(x, 0), cj = this.cell(y, 1), ck = this.cell(z, 2);
        let best = r * r;
        for (let k = Math.max(0, ck - 1); k <= ck + 1 && k < sz; k++) {
            for (let j = Math.max(0, cj - 1); j <= cj + 1 && j < sy; j++) {
                for (let i = Math.max(0, ci - 1); i <= ci + 1 && i < sx; i++) {
                    const bin = this.bins.get(this.key(i, j, k));
                    if (!bin) continue;
                    for (const q of bin) {
                        const dx = p[q] - x, dy = p[q + 1] - y, dz = p[q + 2] - z;
                        const d = dx * dx + dy * dy + dz * dz;
                        if (d < best) best = d;
                    }
                }
            }
        }
        return Math.sqrt(best);
    }
}

/** Number of separate pieces in a mesh (triangles joined through shared vertices). */
export function meshPieces(mesh: TriMesh): number {
    const n = mesh.vertices.length / 3;
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (i: number) => {
        while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
        return i;
    };
    const used = new Uint8Array(n);
    const t = mesh.triangles;
    for (let q = 0; q < t.length; q += 3) {
        used[t[q]] = used[t[q + 1]] = used[t[q + 2]] = 1;
        const a = find(t[q]);
        parent[find(t[q + 1])] = a;
        parent[find(t[q + 2])] = a;
    }
    let pieces = 0;
    for (let i = 0; i < n; i++) if (used[i] && find(i) === i) pieces++;
    return pieces;
}

// ---------------------------------------------------------------------------
// Distance from a point to a mesh
// ---------------------------------------------------------------------------

/** Squared distance from p to triangle abc (closest point on the triangle, Ericson's method). */
function pointTriangle2(
    px: number, py: number, pz: number,
    ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number,
): number {
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    let qx: number, qy: number, qz: number;
    if (d1 <= 0 && d2 <= 0) {
        qx = ax; qy = ay; qz = az;
    } else {
        const bpx = px - bx, bpy = py - by, bpz = pz - bz;
        const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
        const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
        const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
        if (d3 >= 0 && d4 <= d3) {
            qx = bx; qy = by; qz = bz;
        } else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
            const t = d1 / (d1 - d3);
            qx = ax + abx * t; qy = ay + aby * t; qz = az + abz * t;
        } else if (d6 >= 0 && d5 <= d6) {
            qx = cx; qy = cy; qz = cz;
        } else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const t = d2 / (d2 - d6);
            qx = ax + acx * t; qy = ay + acy * t; qz = az + acz * t;
        } else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
            const t = (d4 - d3) / ((d4 - d3) + (d5 - d6));
            qx = bx + (cx - bx) * t; qy = by + (cy - by) * t; qz = bz + (cz - bz) * t;
        } else {
            const sum = va + vb + vc;
            // A triangle with no area: fall back to its first corner
            const v = sum !== 0 ? vb / sum : 0, w = sum !== 0 ? vc / sum : 0;
            qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w;
        }
    }
    const dx = px - qx, dy = py - qy, dz = pz - qz;
    return dx * dx + dy * dy + dz * dz;
}

/** Triangles kept per leaf of the tree */
const LEAF = 8;

/**
 * A mesh arranged for "how far is this point from it" (a tree of boxes over
 * the triangles, so each question looks at a handful of them).
 */
export class MeshIndex {
    private readonly order: Uint32Array;
    /** Per node: xmin, ymin, zmin, xmax, ymax, zmax */
    private readonly boxes: number[] = [];
    /** Per node: first child (the second follows it), or -1 for a leaf */
    private readonly child: number[] = [];
    /** Per node: its range of `order` */
    private readonly start: number[] = [];
    private readonly count: number[] = [];

    constructor(private readonly mesh: TriMesh) {
        const { vertices: v, triangles: t } = mesh;
        const n = t.length / 3;
        this.order = new Uint32Array(n);
        const centre = new Float64Array(n * 3);
        for (let i = 0; i < n; i++) {
            this.order[i] = i;
            for (let k = 0; k < 3; k++) centre[i * 3 + k] = (v[t[i * 3] * 3 + k] + v[t[i * 3 + 1] * 3 + k] + v[t[i * 3 + 2] * 3 + k]) / 3;
        }
        if (n === 0) return;
        const todo: [number, number, number][] = [[this.node(0, n), 0, n]];
        while (todo.length > 0) {
            const [id, from, len] = todo.pop()!;
            if (len <= LEAF) continue;
            // Split at the middle triangle along the node's longest side
            const b = id * 6;
            const size = [this.boxes[b + 3] - this.boxes[b], this.boxes[b + 4] - this.boxes[b + 1], this.boxes[b + 5] - this.boxes[b + 2]];
            const axis = size[0] >= size[1] && size[0] >= size[2] ? 0 : size[1] >= size[2] ? 1 : 2;
            this.order.subarray(from, from + len).sort((p, q) => centre[p * 3 + axis] - centre[q * 3 + axis]);
            const half = len >> 1;
            const left = this.node(from, half);
            this.node(from + half, len - half);
            this.child[id] = left;
            todo.push([left, from, half], [left + 1, from + half, len - half]);
        }
    }

    private node(from: number, len: number): number {
        const { vertices: v, triangles: t } = this.mesh;
        const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        for (let q = from; q < from + len; q++) {
            const tri = this.order[q] * 3;
            for (let c = 0; c < 3; c++) {
                const p = t[tri + c] * 3;
                for (let k = 0; k < 3; k++) {
                    if (v[p + k] < box[k]) box[k] = v[p + k];
                    if (v[p + k] > box[k + 3]) box[k + 3] = v[p + k];
                }
            }
        }
        this.boxes.push(...box);
        this.child.push(-1);
        this.start.push(from);
        this.count.push(len);
        return this.child.length - 1;
    }

    private box2(id: number, x: number, y: number, z: number): number {
        const b = id * 6, bx = this.boxes;
        const dx = Math.max(bx[b] - x, 0, x - bx[b + 3]);
        const dy = Math.max(bx[b + 1] - y, 0, y - bx[b + 4]);
        const dz = Math.max(bx[b + 2] - z, 0, z - bx[b + 5]);
        return dx * dx + dy * dy + dz * dz;
    }

    /** Distance from a point to the nearest part of the mesh (Infinity when the mesh is empty). */
    distance(x: number, y: number, z: number): number {
        if (this.child.length === 0) return Infinity;
        const { vertices: v, triangles: t } = this.mesh;
        let best = Infinity;
        const stack = [0];
        while (stack.length > 0) {
            const id = stack.pop()!;
            if (this.box2(id, x, y, z) >= best) continue;
            const kid = this.child[id];
            if (kid < 0) {
                for (let q = this.start[id], end = q + this.count[id]; q < end; q++) {
                    const tri = this.order[q] * 3;
                    const a = t[tri] * 3, b = t[tri + 1] * 3, c = t[tri + 2] * 3;
                    const d = pointTriangle2(x, y, z, v[a], v[a + 1], v[a + 2], v[b], v[b + 1], v[b + 2], v[c], v[c + 1], v[c + 2]);
                    if (d < best) best = d;
                }
                continue;
            }
            // Nearer child last, so it is looked at first
            if (this.box2(kid, x, y, z) < this.box2(kid + 1, x, y, z)) stack.push(kid + 1, kid);
            else stack.push(kid, kid + 1);
        }
        return Math.sqrt(best);
    }
}
