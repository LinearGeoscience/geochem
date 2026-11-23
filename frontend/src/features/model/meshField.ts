/**
 * A fixed mesh as a field (pure): the distance to it in metres, with a sign,
 * so that a mesh from a file can stand where a fitted surface does in a
 * geological model.
 *
 * The sign: a closed mesh is positive inside. Inside is where a line from
 * the place crosses the mesh an odd number of times: a hollow in a solid is
 * outside it, and knife edges and slivers in the mesh do not matter. An open
 * mesh is positive on the side its triangles face once they are made to face
 * one way: upwards, or for an upright mesh towards the positive end of the
 * axis it faces most. Beyond the edge of an open mesh the sign is that of
 * the nearest triangle's plane, so the surface carries on flat from its edge.
 *
 * The triangles of a file face any way and share no vertices in some
 * formats, so the mesh is first welded and its triangles turned to agree
 * with their neighbours. For an open mesh the sign at a place nearest an
 * edge or a corner is taken from the triangles round it together
 * (angle-weighted normals). A place on the mesh itself reads exactly 0.
 */

export interface MeshField {
    /** World xyz, 3 per vertex */
    vertices: Float64Array;
    /** Vertex indices, 3 per triangle */
    triangles: Uint32Array;
}

export interface MeshReader {
    /** No edge of it is open: it has an inside */
    closed: boolean;
    /** How many triangles are used (those with no area are not) */
    triangles: number;
    /**
     * What its closed pieces hold, m3 (whichever way round a file wrote its triangles; an open piece holds nothing).
     * A mesh closed as written holds what is inside it less its hollows.
     */
    volume: number;
    /**
     * The signed distance at places (xyz triples). `within` (a closed mesh
     * only): distances beyond it are not needed. A place further than that
     * from the mesh then reads -within outside it and +within inside it: the
     * side is right, and it is found without looking through the whole mesh,
     * which is what makes many places against many meshes quick.
     */
    read: (points: ArrayLike<number>, out?: Float64Array, within?: number) => Float64Array;
}

const LEAF = 4;
/** A closed mesh's coarse grid of sides has this many boxes along its longest side */
const SIDE_BOXES = 64;

function build(input: MeshField): MeshReader {
    const nv0 = Math.floor(input.vertices.length / 3);
    // Weld vertices at the same place
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < nv0; i++) for (let k = 0; k < 3; k++) {
        const v = input.vertices[i * 3 + k];
        if (v < lo[k]) lo[k] = v;
        if (v > hi[k]) hi[k] = v;
    }
    if (nv0 === 0) { lo = [0, 0, 0]; hi = [0, 0, 0]; }
    const centre = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    const step = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1e-9) * 1e-7;
    // A place this near the mesh is on it: rounding must not put it on one side here and the other there
    const on = (step * 0.01) ** 2;
    const ids = new Map<string, number>();
    const remap = new Int32Array(nv0);
    const vs: number[] = [];
    for (let i = 0; i < nv0; i++) {
        const x = input.vertices[i * 3], y = input.vertices[i * 3 + 1], z = input.vertices[i * 3 + 2];
        const key = `${Math.round((x - lo[0]) / step)},${Math.round((y - lo[1]) / step)},${Math.round((z - lo[2]) / step)}`;
        let id = ids.get(key);
        if (id === undefined) {
            id = vs.length / 3;
            ids.set(key, id);
            // About the middle of the mesh: world coordinates are large
            vs.push(x - centre[0], y - centre[1], z - centre[2]);
        }
        remap[i] = id;
    }
    const V = Float64Array.from(vs);
    const nv = V.length / 3;

    // Triangles with an area
    const tris: number[] = [];
    for (let t = 0; t + 2 < input.triangles.length; t += 3) {
        const a = remap[input.triangles[t]], b = remap[input.triangles[t + 1]], c = remap[input.triangles[t + 2]];
        if (a === undefined || b === undefined || c === undefined || a === b || b === c || a === c) continue;
        const ux = V[b * 3] - V[a * 3], uy = V[b * 3 + 1] - V[a * 3 + 1], uz = V[b * 3 + 2] - V[a * 3 + 2];
        const wx = V[c * 3] - V[a * 3], wy = V[c * 3 + 1] - V[a * 3 + 1], wz = V[c * 3 + 2] - V[a * 3 + 2];
        if (Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) > 0) tris.push(a, b, c);
    }
    const T = Int32Array.from(tris);
    const nt = T.length / 3;

    // The triangles on each edge: 2 t + (1 when t runs along it from its higher vertex)
    const edges = new Map<number, number[]>();
    const edgeKey = (a: number, b: number) => (a < b ? a * nv + b : b * nv + a);
    for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) {
        const a = T[t * 3 + e], b = T[t * 3 + (e + 1) % 3];
        const key = edgeKey(a, b);
        const list = edges.get(key);
        if (list) list.push(t * 2 + (a < b ? 0 : 1)); else edges.set(key, [t * 2 + (a < b ? 0 : 1)]);
    }

    // As written: is every edge walked as often one way as the other? Then the mesh is closed and its triangles agree
    // already, however many of them meet along an edge (two solids that touch along one, a surface pinched to a line),
    // and a hollow inside a solid is told from the solid by the way its triangles face. Counted with the triangles of
    // no area too: one of those left out would leave a slit that is not there.
    const walks = new Map<number, number>();
    for (let t = 0; t + 2 < input.triangles.length; t += 3) {
        const c = [remap[input.triangles[t]], remap[input.triangles[t + 1]], remap[input.triangles[t + 2]]];
        if (c[0] === undefined || c[1] === undefined || c[2] === undefined || c[0] === c[1] || c[1] === c[2] || c[0] === c[2]) continue;
        for (let e = 0; e < 3; e++) {
            const a = c[e], b = c[(e + 1) % 3], key = edgeKey(a, b);
            walks.set(key, (walks.get(key) ?? 0) + (a < b ? 1 : -1));
        }
    }
    let agreed = nt > 0;
    if (agreed) for (const ways of walks.values()) if (ways !== 0) { agreed = false; break; }

    // Else: turn triangles to agree with their neighbours, one connected piece at a time
    const flip = new Uint8Array(nt), piece = new Int32Array(nt).fill(-1);
    const pieces: { open: boolean; volume: number; normal: number[]; members: number[] }[] = [];
    if (agreed) {
        pieces.push({ open: false, volume: 0, normal: [0, 0, 0], members: Array.from({ length: nt }, (_, t) => t) });
        piece.fill(0);
    }
    for (let seed = 0; seed < nt; seed++) {
        if (piece[seed] >= 0) continue;
        const p = { open: false, volume: 0, normal: [0, 0, 0], members: [] as number[] };
        const id = pieces.length;
        pieces.push(p);
        piece[seed] = id;
        const queue = [seed];
        while (queue.length) {
            const t = queue.pop()!;
            p.members.push(t);
            for (let e = 0; e < 3; e++) {
                const a = T[t * 3 + e], b = T[t * 3 + (e + 1) % 3];
                const list = edges.get(edgeKey(a, b))!;
                // (One triangle, or three: open there. Four or more in pairs: pieces that touch along the edge, each closed by its own)
                if (list.length !== 2) { if (list.length % 2 === 1) p.open = true; continue; }
                const mine = (a < b ? 0 : 1) ^ flip[t];
                const other = list[0] >> 1 === t ? list[1] : list[0];
                const o = other >> 1;
                if (o === t) { p.open = true; continue; }
                if (piece[o] >= 0) continue;
                piece[o] = id;
                // Neighbours run opposite ways along the edge they share
                flip[o] = ((other & 1) ^ 1 ^ mine) as 0 | 1;
                queue.push(o);
            }
        }
    }
    const corner = (t: number, k: number) => T[t * 3 + (flip[t] && k > 0 ? 3 - k : k)];
    for (const p of pieces) {
        for (const t of p.members) {
            const a = corner(t, 0) * 3, b = corner(t, 1) * 3, c = corner(t, 2) * 3;
            const nx = (V[b + 1] - V[a + 1]) * (V[c + 2] - V[a + 2]) - (V[b + 2] - V[a + 2]) * (V[c + 1] - V[a + 1]);
            const ny = (V[b + 2] - V[a + 2]) * (V[c] - V[a]) - (V[b] - V[a]) * (V[c + 2] - V[a + 2]);
            const nz = (V[b] - V[a]) * (V[c + 1] - V[a + 1]) - (V[b + 1] - V[a + 1]) * (V[c] - V[a]);
            p.normal[0] += nx; p.normal[1] += ny; p.normal[2] += nz;
            p.volume += (V[a] * nx + V[a + 1] * ny + V[a + 2] * nz) / 6;
        }
        let turn: boolean;
        if (!p.open) {
            // Closed: its triangles are made to face inwards, so that inside is positive
            turn = p.volume > 0;
        } else {
            const [x, y, z] = p.normal, len = Math.hypot(x, y, z);
            const k = Math.abs(z) >= 0.3 * len ? 2 : Math.abs(x) >= Math.abs(y) ? 0 : 1;
            turn = p.normal[k] < 0;
        }
        if (turn) for (const t of p.members) flip[t] ^= 1;
    }
    const closed = nt > 0 && pieces.every(p => !p.open);
    const F = new Int32Array(nt * 3);
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) F[t * 3 + k] = corner(t, k);

    // Normals of faces, and of vertices and edges from the faces round them
    const faceN = new Float64Array(nt * 3), vertexN = new Float64Array(nv * 3);
    const edgeN = new Map<number, [number, number, number]>();
    for (let t = 0; t < nt; t++) {
        const i = [F[t * 3] * 3, F[t * 3 + 1] * 3, F[t * 3 + 2] * 3];
        const [a, b, c] = i;
        let nx = (V[b + 1] - V[a + 1]) * (V[c + 2] - V[a + 2]) - (V[b + 2] - V[a + 2]) * (V[c + 1] - V[a + 1]);
        let ny = (V[b + 2] - V[a + 2]) * (V[c] - V[a]) - (V[b] - V[a]) * (V[c + 2] - V[a + 2]);
        let nz = (V[b] - V[a]) * (V[c + 1] - V[a + 1]) - (V[b + 1] - V[a + 1]) * (V[c] - V[a]);
        const len = Math.hypot(nx, ny, nz);
        nx /= len; ny /= len; nz /= len;
        faceN[t * 3] = nx; faceN[t * 3 + 1] = ny; faceN[t * 3 + 2] = nz;
        for (let k = 0; k < 3; k++) {
            const p = i[k], q = i[(k + 1) % 3], r = i[(k + 2) % 3];
            const ux = V[q] - V[p], uy = V[q + 1] - V[p + 1], uz = V[q + 2] - V[p + 2];
            const wx = V[r] - V[p], wy = V[r + 1] - V[p + 1], wz = V[r + 2] - V[p + 2];
            const cos = (ux * wx + uy * wy + uz * wz) / (Math.hypot(ux, uy, uz) * Math.hypot(wx, wy, wz));
            const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
            vertexN[p] += angle * nx; vertexN[p + 1] += angle * ny; vertexN[p + 2] += angle * nz;
            const key = edgeKey(p / 3, q / 3);
            const had = edgeN.get(key);
            if (had) { had[0] += nx; had[1] += ny; had[2] += nz; } else edgeN.set(key, [nx, ny, nz]);
        }
    }

    // A tree of boxes over the triangles
    const order = new Int32Array(nt);
    const mid = new Float64Array(nt * 3);
    for (let t = 0; t < nt; t++) {
        order[t] = t;
        for (let k = 0; k < 3; k++) mid[t * 3 + k] = (V[F[t * 3] * 3 + k] + V[F[t * 3 + 1] * 3 + k] + V[F[t * 3 + 2] * 3 + k]) / 3;
    }
    const boxes: number[] = [], kids: number[] = [];
    const node = (from: number, to: number): number => {
        const at = kids.length / 2;
        const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        const m = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        for (let q = from; q < to; q++) {
            const t = order[q];
            for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) {
                const v = V[F[t * 3 + c] * 3 + k];
                if (v < b[k]) b[k] = v;
                if (v > b[k + 3]) b[k + 3] = v;
            }
            for (let k = 0; k < 3; k++) {
                const v = mid[t * 3 + k];
                if (v < m[k]) m[k] = v;
                if (v > m[k + 3]) m[k + 3] = v;
            }
        }
        boxes.push(...b);
        kids.push(0, 0);
        const axis = m[3] - m[0] >= m[4] - m[1] && m[3] - m[0] >= m[5] - m[2] ? 0 : m[4] - m[1] >= m[5] - m[2] ? 1 : 2;
        if (to - from <= LEAF || !(m[axis + 3] > m[axis])) {
            // A leaf: its triangles, as -(from + 1) and how many
            kids[at * 2] = -(from + 1);
            kids[at * 2 + 1] = to - from;
            return at;
        }
        const part = order.subarray(from, to);
        part.sort((p, q) => mid[p * 3 + axis] - mid[q * 3 + axis]);
        const half = from + ((to - from) >> 1);
        kids[at * 2] = node(from, half);
        kids[at * 2 + 1] = node(half, to);
        return at;
    };
    if (nt > 0) node(0, nt);
    const B = Float64Array.from(boxes), K = Int32Array.from(kids);

    const boxDistance = (n: number, x: number, y: number, z: number) => {
        const dx = Math.max(B[n * 6] - x, 0, x - B[n * 6 + 3]);
        const dy = Math.max(B[n * 6 + 1] - y, 0, y - B[n * 6 + 4]);
        const dz = Math.max(B[n * 6 + 2] - z, 0, z - B[n * 6 + 5]);
        return dx * dx + dy * dy + dz * dz;
    };
    // The nearest place on the last triangle tried, and what it is on: 0 the face, 1-3 a corner, 4-6 the edge from that corner
    const near = [0, 0, 0];
    let feature = 0;
    const onTriangle = (t: number, px: number, py: number, pz: number): number => {
        const a = F[t * 3] * 3, b = F[t * 3 + 1] * 3, c = F[t * 3 + 2] * 3;
        const abx = V[b] - V[a], aby = V[b + 1] - V[a + 1], abz = V[b + 2] - V[a + 2];
        const acx = V[c] - V[a], acy = V[c + 1] - V[a + 1], acz = V[c + 2] - V[a + 2];
        const apx = px - V[a], apy = py - V[a + 1], apz = pz - V[a + 2];
        const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
        const put = (x: number, y: number, z: number, f: number) => {
            near[0] = x; near[1] = y; near[2] = z; feature = f;
            return (px - x) * (px - x) + (py - y) * (py - y) + (pz - z) * (pz - z);
        };
        if (d1 <= 0 && d2 <= 0) return put(V[a], V[a + 1], V[a + 2], 1);
        const bpx = px - V[b], bpy = py - V[b + 1], bpz = pz - V[b + 2];
        const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
        if (d3 >= 0 && d4 <= d3) return put(V[b], V[b + 1], V[b + 2], 2);
        const vc = d1 * d4 - d3 * d2;
        if (vc <= 0 && d1 >= 0 && d3 <= 0) {
            const v = d1 / (d1 - d3);
            return put(V[a] + v * abx, V[a + 1] + v * aby, V[a + 2] + v * abz, 4);
        }
        const cpx = px - V[c], cpy = py - V[c + 1], cpz = pz - V[c + 2];
        const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) return put(V[c], V[c + 1], V[c + 2], 3);
        const vb = d5 * d2 - d1 * d6;
        if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const w = d2 / (d2 - d6);
            return put(V[a] + w * acx, V[a + 1] + w * acy, V[a + 2] + w * acz, 6);
        }
        const va = d3 * d6 - d5 * d4;
        if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
            const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
            return put(V[b] + w * (V[c] - V[b]), V[b + 1] + w * (V[c + 1] - V[b + 1]), V[b + 2] + w * (V[c + 2] - V[b + 2]), 5);
        }
        const denom = 1 / (va + vb + vc), v = vb * denom, w = vc * denom;
        return put(V[a] + abx * v + acx * w, V[a + 1] + aby * v + acy * w, V[a + 2] + abz * v + acz * w, 0);
    };

    // A closed mesh, for places far from it: a coarse grid of boxes, each wholly outside (1), wholly inside (2), or with
    // the mesh in or beside it (0). Outside is what can be reached from the grid's edge without passing a box that a
    // triangle's own box touches; each part of what is left is all on one side (inside the solid, or in a hollow of
    // it), which is asked once at one of its boxes. Made when first asked for.
    let sides: { boxes: Uint8Array; n: number[]; from: number[]; size: number } | null = null;
    const sideOf = (px: number, py: number, pz: number): number => {
        if (!sides) {
            const size = Math.max(B[3] - B[0], B[4] - B[1], B[5] - B[2], 1e-9) / SIDE_BOXES;
            // (One box of margin all round, never touched by a triangle: outside is in one piece)
            const n = [0, 1, 2].map(k => Math.floor((B[k + 3] - B[k]) / size) + 3), from = [B[0] - size, B[1] - size, B[2] - size];
            const boxes = new Uint8Array(n[0] * n[1] * n[2]);
            const at = (v: number, k: number) => Math.min(n[k] - 2, Math.max(1, Math.floor((v - B[k]) / size) + 1));
            for (let t = 0; t < nt; t++) {
                const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
                for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) {
                    const v = V[F[t * 3 + c] * 3 + k];
                    if (v < lo[k]) lo[k] = v;
                    if (v > hi[k]) hi[k] = v;
                }
                for (let k = at(lo[2], 2); k <= at(hi[2], 2); k++) for (let j = at(lo[1], 1); j <= at(hi[1], 1); j++) for (let i = at(lo[0], 0); i <= at(hi[0], 0); i++) boxes[(k * n[1] + j) * n[0] + i] = 3;
            }
            const queue = new Int32Array(boxes.length);
            const steps = [1, -1, n[0], -n[0], n[0] * n[1], -n[0] * n[1]];
            // Every box that can be reached from one, through boxes no triangle is near, is given its side
            const spread = (start: number, side: number) => {
                let head = 0, tail = 0;
                boxes[start] = side;
                queue[tail++] = start;
                while (head < tail) {
                    const b = queue[head++], i = b % n[0], j = Math.floor(b / n[0]) % n[1], k = Math.floor(b / (n[0] * n[1]));
                    for (let s = 0; s < 6; s++) {
                        if ((s === 0 && i === n[0] - 1) || (s === 1 && i === 0) || (s === 2 && j === n[1] - 1) || (s === 3 && j === 0) || (s === 4 && k === n[2] - 1) || (s === 5 && k === 0)) continue;
                        const o = b + steps[s];
                        if (boxes[o] === 0) { boxes[o] = side; queue[tail++] = o; }
                    }
                }
            };
            spread(0, 1);
            for (let b = 0; b < boxes.length; b++) {
                if (boxes[b] !== 0) continue;
                const i = b % n[0], j = Math.floor(b / n[0]) % n[1], k = Math.floor(b / (n[0] * n[1]));
                const middle = one(centre[0] + from[0] + (i + 0.5) * size, centre[1] + from[1] + (j + 0.5) * size, centre[2] + from[2] + (k + 0.5) * size);
                spread(b, middle > 0 ? 2 : 1);
            }
            for (let b = 0; b < boxes.length; b++) if (boxes[b] === 3) boxes[b] = 0;
            sides = { boxes, n, from, size };
        }
        const { boxes, n, from, size } = sides;
        const i = Math.floor((px - from[0]) / size), j = Math.floor((py - from[1]) / size), k = Math.floor((pz - from[2]) / size);
        if (i < 0 || j < 0 || k < 0 || i >= n[0] || j >= n[1] || k >= n[2]) return 1;
        return boxes[(k * n[1] + j) * n[0] + i];
    };

    // Which side of a closed mesh a place is on: inside when a line from it crosses the mesh an odd number of times.
    // The faces round the nearest edge or corner do not say it safely: where a thin solid ends in a knife edge, or has a
    // triangle of next to no area in it, their normals add up to nothing in particular, and a place hundreds of metres
    // away was read as inside. (The line runs no way a mesh made on a grid has an edge.)
    //
    // A line that meets the mesh exactly on a side or a corner of a triangle is counted by each triangle that shares
    // it, or by none: its count says nothing. Such a line is given up for another (Phase 276), and the first of them
    // that meets no side says which side the place is on; all three meeting one, the most of them say it.
    const RAYS = [[0.5377190, 0.2183911, 0.8143277], [0.2715003, 0.7989211, 0.5366790], [0.8108417, 0.4871063, 0.3243295]];
    const ON_SIDE = 1e-9;
    let onSide = false;
    const lineStack = new Int32Array(256);
    const crossingsAlong = (RAY: number[], px: number, py: number, pz: number): number => {
        let count = 0, top = 0;
        onSide = false;
        lineStack[top++] = 0;
        while (top > 0) {
            const n = lineStack[--top];
            // (Its three components are above nothing: a box is met between its near faces and its far ones)
            const near0 = Math.max((B[n * 6] - px) / RAY[0], (B[n * 6 + 1] - py) / RAY[1], (B[n * 6 + 2] - pz) / RAY[2], 0);
            const far0 = Math.min((B[n * 6 + 3] - px) / RAY[0], (B[n * 6 + 4] - py) / RAY[1], (B[n * 6 + 5] - pz) / RAY[2]);
            if (near0 > far0) continue;
            const l = K[n * 2], r = K[n * 2 + 1];
            if (l >= 0) { lineStack[top++] = l; lineStack[top++] = r; continue; }
            for (let q = -l - 1; q < -l - 1 + r; q++) {
                const t = order[q], a = F[t * 3] * 3, b = F[t * 3 + 1] * 3, c = F[t * 3 + 2] * 3;
                const e1x = V[b] - V[a], e1y = V[b + 1] - V[a + 1], e1z = V[b + 2] - V[a + 2];
                const e2x = V[c] - V[a], e2y = V[c + 1] - V[a + 1], e2z = V[c + 2] - V[a + 2];
                const hx = RAY[1] * e2z - RAY[2] * e2y, hy = RAY[2] * e2x - RAY[0] * e2z, hz = RAY[0] * e2y - RAY[1] * e2x;
                const det = e1x * hx + e1y * hy + e1z * hz;
                if (det === 0) continue;
                const f = 1 / det, sx = px - V[a], sy = py - V[a + 1], sz = pz - V[a + 2];
                const u = f * (sx * hx + sy * hy + sz * hz);
                if (u < -ON_SIDE || u > 1 + ON_SIDE) continue;
                const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
                const w = f * (RAY[0] * qx + RAY[1] * qy + RAY[2] * qz);
                if (u < -ON_SIDE || w < -ON_SIDE || u + w > 1 + ON_SIDE) continue;
                const along = f * (e2x * qx + e2y * qy + e2z * qz);
                if (!(along > 0)) continue;
                if (u < ON_SIDE || w < ON_SIDE || u + w > 1 - ON_SIDE) { onSide = true; continue; }
                count++;
            }
        }
        return count;
    };
    /** Whether a line from the place crosses the mesh an odd number of times */
    const crossedOdd = (px: number, py: number, pz: number): boolean => {
        let odd = 0;
        for (const ray of RAYS) {
            const count = crossingsAlong(ray, px, py, pz);
            if (!onSide) return count % 2 === 1;
            odd += count % 2;
        }
        return odd * 2 > RAYS.length;
    };

    const stack = new Int32Array(128);
    const one = (x: number, y: number, z: number, within = Infinity): number => {
        if (nt === 0 || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return NaN;
        const px = x - centre[0], py = y - centre[1], pz = z - centre[2];
        let best = within * within, bt = -1, bf = 0, bx = 0, by = 0, bz = 0;
        let top = 0;
        stack[top++] = 0;
        while (top > 0) {
            const n = stack[--top];
            if (boxDistance(n, px, py, pz) >= best) continue;
            const l = K[n * 2], r = K[n * 2 + 1];
            if (l < 0) {
                const from = -l - 1;
                for (let q = from; q < from + r; q++) {
                    const d = onTriangle(order[q], px, py, pz);
                    if (d < best) { best = d; bt = order[q]; bf = feature; bx = near[0]; by = near[1]; bz = near[2]; }
                }
                continue;
            }
            // The nearer box is looked in first
            const dl = boxDistance(l, px, py, pz), dr = boxDistance(r, px, py, pz);
            if (dl < dr) { if (dr < best) stack[top++] = r; if (dl < best) stack[top++] = l; } else { if (dl < best) stack[top++] = l; if (dr < best) stack[top++] = r; }
        }
        if (bt < 0) {
            // Nothing that near: which side it is on is read off the coarse grid (a box the mesh is in or beside: looked for in full)
            const side = sideOf(px, py, pz);
            return side === 1 ? -within : side === 2 ? within : Math.max(-within, Math.min(within, one(x, y, z)));
        }
        if (best <= on) return 0;
        if (closed) return crossedOdd(px, py, pz) ? Math.sqrt(best) : -Math.sqrt(best);
        let nx = faceN[bt * 3], ny = faceN[bt * 3 + 1], nz = faceN[bt * 3 + 2];
        if (bf >= 4) {
            const e = edgeN.get(edgeKey(F[bt * 3 + bf - 4], F[bt * 3 + (bf - 3) % 3]));
            if (e) [nx, ny, nz] = e;
        } else if (bf >= 1) {
            const v = F[bt * 3 + bf - 1] * 3;
            nx = vertexN[v]; ny = vertexN[v + 1]; nz = vertexN[v + 2];
        }
        const side = (px - bx) * nx + (py - by) * ny + (pz - bz) * nz;
        return side < 0 ? -Math.sqrt(best) : Math.sqrt(best);
    };

    return {
        closed, triangles: nt,
        volume: pieces.reduce((sum, p) => sum + (p.open ? 0 : Math.abs(p.volume)), 0),
        read: (points, out, within) => {
            const n = Math.floor(points.length / 3);
            const f = out ?? new Float64Array(n);
            const limit = closed && within !== undefined && within > 0 ? within : Infinity;
            for (let i = 0; i < n; i++) f[i] = one(points[i * 3], points[i * 3 + 1], points[i * 3 + 2], limit);
            return f;
        },
    };
}

const readers = new WeakMap<MeshField, MeshReader>();

/** The reader of a mesh's field: built once for a mesh, and kept while the mesh is */
export function meshReader(mesh: MeshField): MeshReader {
    let r = readers.get(mesh);
    if (!r) {
        r = build(mesh);
        readers.set(mesh, r);
    }
    return r;
}
