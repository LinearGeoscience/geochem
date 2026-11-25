/**
 * Surface-following mesher: turns "where a field crosses zero" into triangles
 * (pure, unit-tested).
 *
 * The field is only looked at where the surface is. Starting from cells that
 * hold a known point of the surface (the seeds), the mesher steps from cell
 * to cell across faces the surface passes through, evaluating grid nodes as
 * it reaches them. So the cost follows the area of the surface, not the
 * volume of the box, thin features cannot be missed by a coarse first pass,
 * and nothing is meshed that is not joined to the data.
 *
 * Each crossed cell gets one vertex (the average of where the surface cuts
 * its edges: "surface nets"), which gives evenly shaped triangles. Triangles
 * face the side where the field is positive.
 *
 * On a grid fixed to the ground (`grid`), the values at its nodes can be
 * kept from one mesh to the next (`last`): after an edit only the nodes where
 * the field changed are worked out again, and since every other node has the
 * very value it had, the mesh is the one a fresh start would give.
 */
import type { Box3, TriMesh, Vec3 } from './types';

/** The field's values at the nodes of a grid fixed to the ground, as one mesh left them */
export interface NodeMemory {
    cell: number;
    shift: Vec3;
    /** Nodes are counted from here (whole cells from the origin): a node's key is its place from it */
    base: Vec3;
    values: NodeMap;
    /** A grid that starts at its own box's corner (`own`): that corner. Its values hold only for a box with the same one */
    corner?: Vec3;
}

/** Nodes are kept no further than this many cells from a memory's base along any direction */
const KEPT_SPAN = 65536;

export interface NetOptions {
    /** Field minus the wanted level at world points (xyz triples): the surface is where this is 0 */
    evaluate: (points: Float64Array) => Float64Array;
    /** Nothing is meshed outside this box */
    box: Box3;
    /** Edge length of a grid cell (world units) */
    cell: number;
    /** Points on (or within a cell of) the surface, xyz triples */
    seeds: ArrayLike<number>;
    /** Optional limit: cells whose centre fails this are not entered */
    keep?: (x: number, y: number, z: number) => boolean;
    /** Stop after this many crossed cells (default 400 000) */
    maxCells?: number;
    /**
     * The box's corner is on the grid lines, which are whole cells plus these
     * shares of a cell from the origin (see sheet.ts, `gridBox`). The nodes are
     * then placed the same however big the box is, and their values are kept
     * in the mesh's `memory`
     */
    grid?: { shift: Vec3 } | null;
    /**
     * Without `grid`: the nodes are where they are (whole cells from the box's
     * own corner), and their values are kept in the mesh's `memory` all the
     * same, to be used again by a mesh of a box with the same corner and cell
     */
    own?: boolean;
    /** The last mesh's node values on the same grid, used again at the nodes where `still` says the field is as it was */
    last?: { memory: NodeMemory; still: (x: number, y: number, z: number) => boolean } | null;
}

export interface NetMesh extends TriMesh {
    /** Cells the surface passes through */
    cells: number;
    /** Grid nodes at which the field was evaluated */
    evaluations: number;
    /** Stopped at maxCells before the surface was finished */
    truncated: boolean;
    /** Of the grid nodes it needed, how many had the value they had last time (no evaluation) */
    reused: number;
    /** Its node values, for the next mesh on this grid (only with `grid`) */
    memory: NodeMemory | null;
}

/** Corner offsets of a cell, bit 0 = +x, bit 1 = +y, bit 2 = +z */
const CORNER = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
/** The 12 edges as corner pairs */
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
/** The 6 faces: step to the neighbour, and the 4 corners on that face */
const FACES: { step: [number, number, number]; corners: number[] }[] = [
    { step: [-1, 0, 0], corners: [0, 2, 4, 6] }, { step: [1, 0, 0], corners: [1, 3, 5, 7] },
    { step: [0, -1, 0], corners: [0, 1, 4, 5] }, { step: [0, 1, 0], corners: [2, 3, 6, 7] },
    { step: [0, 0, -1], corners: [0, 1, 2, 3] }, { step: [0, 0, 1], corners: [4, 5, 6, 7] },
];
/**
 * For an edge leaving a cell's low corner along x, y or z: the other three
 * cells around that edge, in an order that (with the cell itself last but
 * one) winds anticlockwise seen from the edge's far end.
 */
const AROUND: [number, number, number][][] = [
    [[0, -1, -1], [0, 0, -1], [0, 0, 0], [0, -1, 0]],
    [[-1, 0, -1], [-1, 0, 0], [0, 0, 0], [0, 0, -1]],
    [[-1, -1, 0], [0, -1, 0], [0, 0, 0], [-1, 0, 0]],
];

/**
 * Whole numbers (0 to 2^53) to numbers, kept in typed arrays (open
 * addressing). The mesher looks nodes and cells up several times a cell: a
 * Map is several times slower, the more so for keys past 2^30.
 */
export class NodeMap {
    private keys: Float64Array;
    private vals: Float64Array;
    private mask: number;
    size = 0;

    constructor(capacity = 256) {
        let n = 16;
        while (n < 2 * capacity) n *= 2;
        this.keys = new Float64Array(n).fill(-1);
        this.vals = new Float64Array(n);
        this.mask = n - 1;
    }

    private slot(k: number): number {
        const lo = k >>> 0, hi = (k / 4294967296) >>> 0;
        // (MurmurHash3's finish: keys a grid row apart must not land side by side)
        let h = lo ^ Math.imul(hi, 0x27d4eb2d);
        h ^= h >>> 16;
        h = Math.imul(h, 0x85ebca6b);
        h ^= h >>> 13;
        h = Math.imul(h, 0xc2b2ae35);
        h ^= h >>> 16;
        const keys = this.keys, mask = this.mask;
        let s = h & mask;
        while (keys[s] !== -1 && keys[s] !== k) s = (s + 1) & mask;
        return s;
    }

    /** Where the value of key k is kept (-1: k is not there) */
    find(k: number): number {
        const s = this.slot(k);
        return this.keys[s] === k ? s : -1;
    }

    at(slot: number): number {
        return this.vals[slot];
    }

    has(k: number): boolean {
        return this.find(k) >= 0;
    }

    get(k: number): number | undefined {
        const s = this.find(k);
        return s >= 0 ? this.vals[s] : undefined;
    }

    set(k: number, v: number): void {
        let s = this.slot(k);
        if (this.keys[s] !== k) {
            if (2 * (this.size + 1) > this.keys.length) {
                this.grow();
                s = this.slot(k);
            }
            this.keys[s] = k;
            this.size++;
        }
        this.vals[s] = v;
    }

    private grow(): void {
        const keys = this.keys, vals = this.vals;
        this.keys = new Float64Array(keys.length * 2).fill(-1);
        this.vals = new Float64Array(keys.length * 2);
        this.mask = keys.length * 2 - 1;
        for (let s = 0; s < keys.length; s++) {
            if (keys[s] === -1) continue;
            const to = this.slot(keys[s]);
            this.keys[to] = keys[s];
            this.vals[to] = vals[s];
        }
    }
}

/** The same tables flat, for the inner loops: corner offsets by axis, edge ends, face corners */
const CX = CORNER.map(c => c[0]), CY = CORNER.map(c => c[1]), CZ = CORNER.map(c => c[2]);
const EA = EDGES.map(e => e[0]), EB = EDGES.map(e => e[1]);
const FC = FACES.flatMap(f => f.corners);

export function meshSurface(options: NetOptions): NetMesh {
    const { box, cell: h, evaluate, keep } = options;
    const maxCells = options.maxCells ?? 400_000;
    const empty: NetMesh = { vertices: new Float64Array(0), triangles: new Uint32Array(0), cells: 0, evaluations: 0, truncated: false, reused: 0, memory: null };
    if (!(h > 0)) return empty;
    const size = [0, 1, 2].map(k => Math.max(1, Math.ceil((box.max[k] - box.min[k]) / h - 1e-9)));
    const [nx, ny, nz] = size;
    // Node and cell keys share one numbering (nodes run one further on each axis)
    const sx = nx + 1, sy = ny + 1, sxy = sx * sy;
    if (sx * sy * (nz + 1) > Number.MAX_SAFE_INTEGER) return empty;
    const key = (i: number, j: number, k: number) => i + sx * (j + sy * k);
    const inside = (i: number, j: number, k: number) => i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz;
    /** A cell's corners, as steps from its own key */
    const step = CORNER.map(([a, b, c]) => a + sx * b + sxy * c);

    // Where the nodes are. On a fixed grid: whole cells (plus the grid's shift) from the origin, counted the same in any box
    const shift = options.grid?.shift ?? null;
    const own = !shift && !!options.own;
    const first = shift ? [0, 1, 2].map(a => Math.round(box.min[a] / h - shift[a])) : own ? [0, 0, 0] : null;
    const at = shift
        ? (a: number, i: number) => (first![a] + i + shift[a]) * h
        : (a: number, i: number) => box.min[a] + i * h;
    // What is kept: on the same grid, the last mesh's values (and its base, so its keys still hold)
    const last = options.last && options.last.memory.cell === h && (
        shift ? !options.last.memory.corner && options.last.memory.shift.every((s, a) => s === shift[a])
            : own && !!options.last.memory.corner && options.last.memory.corner.every((c, a) => c === box.min[a])
    ) ? options.last : null;
    const memory: NodeMemory | null = shift || own ? { cell: h, shift: shift ? [shift[0], shift[1], shift[2]] : [0, 0, 0], ...(own ? { corner: [box.min[0], box.min[1], box.min[2]] as Vec3 } : {}), base: last ? last.memory.base : [first![0], first![1], first![2]], values: new NodeMap(last ? last.memory.values.size : 1024) } : null;
    const span = 2 * KEPT_SPAN;
    const off = memory ? [0, 1, 2].map(a => first![a] - memory.base[a] + KEPT_SPAN) : [0, 0, 0];
    /** A node's key in the memory (-1: too far from its base to keep) */
    const kept = (i: number, j: number, k: number) => {
        const a = off[0] + i, b = off[1] + j, c = off[2] + k;
        return a >= 0 && b >= 0 && c >= 0 && a < span && b < span && c < span ? a + span * (b + span * c) : -1;
    };
    let reused = 0;

    // (Sized from the last mesh, when there is one: growing a table as it fills is a good part of the work)
    const expect = last ? last.memory.values.size : 4096;
    const nodeValue = new NodeMap(expect);
    const cellVertex = new NodeMap(expect >> 1);
    const visited = new NodeMap(expect);
    const verts: number[] = [];
    const activeCells: number[] = []; // i, j, k triples
    /** The values at the corners of each crossed cell, 8 to a cell (read once: the quads need them again) */
    const activeCorners: number[] = [];
    let evaluations = 0;
    let truncated = false;

    const enqueue = (i: number, j: number, k: number, into: number[]) => {
        if (!inside(i, j, k)) return;
        const c = key(i, j, k);
        if (visited.has(c)) return;
        if (keep && !keep(at(0, i + 0.5), at(1, j + 0.5), at(2, k + 0.5))) return;
        visited.set(c, 1);
        into.push(i, j, k);
    };

    /**
     * The values at the corners of these cells, 8 to a cell: those not known
     * yet are taken from the last mesh where the field is as it was, or
     * worked out (in one go).
     */
    const fill = (cells: number[]): Float64Array => {
        const out = new Float64Array((cells.length / 3) * 8);
        const want: number[] = [];
        const keys: number[] = [], keep: number[] = [];
        // Corners whose value is being worked out in this wave: where in `out`, and the node
        const waiting: number[] = [];
        for (let q = 0, o = 0; q < cells.length; q += 3, o += 8) {
            const own = key(cells[q], cells[q + 1], cells[q + 2]);
            for (let c = 0; c < 8; c++) {
                const nk = own + step[c];
                const s = nodeValue.find(nk);
                if (s >= 0) {
                    out[o + c] = nodeValue.at(s);
                    // (NaN: asked for earlier in this wave, and not worked out yet)
                    if (Number.isNaN(out[o + c])) waiting.push(o + c, nk);
                    continue;
                }
                const i = cells[q] + CX[c], j = cells[q + 1] + CY[c], k = cells[q + 2] + CZ[c];
                const x = at(0, i), y = at(1, j), z = at(2, k);
                const mk = memory ? kept(i, j, k) : -1;
                if (mk >= 0 && last) {
                    const m = last.memory.values.find(mk);
                    if (m >= 0 && last.still(x, y, z)) {
                        const v = last.memory.values.at(m);
                        nodeValue.set(nk, v);
                        memory!.values.set(mk, v);
                        out[o + c] = v;
                        reused++;
                        continue;
                    }
                }
                nodeValue.set(nk, NaN);
                waiting.push(o + c, nk);
                keys.push(nk);
                keep.push(mk);
                want.push(x, y, z);
            }
        }
        if (keys.length > 0) {
            const vals = evaluate(Float64Array.from(want));
            for (let q = 0; q < keys.length; q++) {
                nodeValue.set(keys[q], vals[q]);
                if (keep[q] >= 0) memory!.values.set(keep[q], vals[q]);
            }
            evaluations += keys.length;
        }
        for (let w = 0; w < waiting.length; w += 2) out[waiting[w]] = nodeValue.get(waiting[w + 1])!;
        return out;
    };

    const corner = new Float64Array(8);
    /** Work through a wave of cells; returns the cells to visit next and how many of this wave were crossed. */
    const sweep = (cells: number[], next: number[]): number => {
        const values = fill(cells);
        let crossed = 0;
        for (let q = 0, o = 0; q < cells.length; q += 3, o += 8) {
            const i = cells[q], j = cells[q + 1], k = cells[q + 2];
            const own = key(i, j, k);
            let neg = 0, bad = false;
            for (let c = 0; c < 8; c++) {
                const v = values[o + c];
                if (!Number.isFinite(v)) bad = true;
                corner[c] = v;
                if (v < 0) neg++;
            }
            if (bad || neg === 0 || neg === 8) continue;
            if (activeCells.length / 3 >= maxCells) { truncated = true; break; }
            // Vertex: the average of where the surface cuts the cell's edges
            let px = 0, py = 0, pz = 0, cuts = 0;
            for (let e = 0; e < 12; e++) {
                const a = EA[e], b = EB[e];
                const va = corner[a], vb = corner[b];
                if ((va < 0) === (vb < 0)) continue;
                const t = va / (va - vb);
                px += CX[a] + (CX[b] - CX[a]) * t;
                py += CY[a] + (CY[b] - CY[a]) * t;
                pz += CZ[a] + (CZ[b] - CZ[a]) * t;
                cuts++;
            }
            cellVertex.set(own, verts.length / 3);
            verts.push(at(0, i + px / cuts), at(1, j + py / cuts), at(2, k + pz / cuts));
            activeCells.push(i, j, k);
            for (let c = 0; c < 8; c++) activeCorners.push(corner[c]);
            crossed++;
            // Carry on through every face the surface crosses
            for (let f = 0; f < 6; f++) {
                let fneg = 0;
                for (let c = f * 4; c < f * 4 + 4; c++) if (corner[FC[c]] < 0) fneg++;
                if (fneg === 0 || fneg === 4) continue;
                const s = FACES[f].step;
                enqueue(i + s[0], j + s[1], k + s[2], next);
            }
        }
        return crossed;
    };

    // Seeds: the cell holding each one, then (for any that the surface missed) the cells around it
    const seeds = options.seeds;
    const seedCells: number[] = [];
    const cellOf = (q: number): [number, number, number] => [
        Math.min(nx - 1, Math.max(0, Math.floor((seeds[q] - box.min[0]) / h))),
        Math.min(ny - 1, Math.max(0, Math.floor((seeds[q + 1] - box.min[1]) / h))),
        Math.min(nz - 1, Math.max(0, Math.floor((seeds[q + 2] - box.min[2]) / h))),
    ];
    for (let q = 0; q + 2 < seeds.length; q += 3) {
        if (!Number.isFinite(seeds[q]) || !Number.isFinite(seeds[q + 1]) || !Number.isFinite(seeds[q + 2])) continue;
        const [i, j, k] = cellOf(q);
        enqueue(i, j, k, seedCells);
    }
    let frontier: number[] = [];
    sweep(seedCells, frontier);
    const around: number[] = [];
    for (let q = 0; q < seedCells.length; q += 3) {
        const [i, j, k] = [seedCells[q], seedCells[q + 1], seedCells[q + 2]];
        if (cellVertex.has(key(i, j, k))) continue;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) enqueue(i + a, j + b, k + c, around);
    }
    if (around.length > 0) sweep(around, frontier);

    while (frontier.length > 0 && !truncated) {
        const next: number[] = [];
        sweep(frontier, next);
        frontier = next;
    }

    // Quads: one per grid edge the surface cuts, joining the four cells around it
    const tris: number[] = [];
    const ring = [0, 0, 0, 0];
    const dist2 = (a: number, b: number) => {
        const dx = verts[a * 3] - verts[b * 3], dy = verts[a * 3 + 1] - verts[b * 3 + 1], dz = verts[a * 3 + 2] - verts[b * 3 + 2];
        return dx * dx + dy * dy + dz * dz;
    };
    for (let q = 0, o = 0; q < activeCells.length; q += 3, o += 8) {
        const i = activeCells[q], j = activeCells[q + 1], k = activeCells[q + 2];
        const own = key(i, j, k);
        const v0 = activeCorners[o];
        for (let axis = 0; axis < 3; axis++) {
            // (The corner one step along the axis: corners 1, 2 and 4)
            const v1 = activeCorners[o + (1 << axis)];
            if ((v0 < 0) === (v1 < 0)) continue;
            let whole = true;
            for (let r = 0; r < 4 && whole; r++) {
                const o = AROUND[axis][r];
                const s = inside(i + o[0], j + o[1], k + o[2]) ? cellVertex.find(own + o[0] + sx * o[1] + sxy * o[2]) : -1;
                if (s < 0) whole = false;
                else ring[r] = cellVertex.at(s);
            }
            if (!whole) continue;
            // Anticlockwise seen from the far end faces +axis: right when the field rises along the edge
            const up = v0 < 0;
            const a = up ? ring[0] : ring[3], b = up ? ring[1] : ring[2], c = up ? ring[2] : ring[1], d = up ? ring[3] : ring[0];
            // Split along the shorter diagonal
            if (dist2(a, c) <= dist2(b, d)) tris.push(a, b, c, a, c, d);
            else tris.push(a, b, d, b, c, d);
        }
    }

    return {
        vertices: Float64Array.from(verts), triangles: Uint32Array.from(tris),
        cells: activeCells.length / 3, evaluations, truncated, reused, memory,
    };
}
