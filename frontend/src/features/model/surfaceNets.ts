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
 */
import type { Box3, TriMesh } from './types';

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
}

export interface NetMesh extends TriMesh {
    /** Cells the surface passes through */
    cells: number;
    /** Grid nodes at which the field was evaluated */
    evaluations: number;
    /** Stopped at maxCells before the surface was finished */
    truncated: boolean;
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

export function meshSurface(options: NetOptions): NetMesh {
    const { box, cell: h, evaluate, keep } = options;
    const maxCells = options.maxCells ?? 400_000;
    const empty: NetMesh = { vertices: new Float64Array(0), triangles: new Uint32Array(0), cells: 0, evaluations: 0, truncated: false };
    if (!(h > 0)) return empty;
    const size = [0, 1, 2].map(k => Math.max(1, Math.ceil((box.max[k] - box.min[k]) / h - 1e-9)));
    const [nx, ny, nz] = size;
    // Node and cell keys share one numbering (nodes run one further on each axis)
    const sx = nx + 1, sy = ny + 1;
    if (sx * sy * (nz + 1) > Number.MAX_SAFE_INTEGER) return empty;
    const key = (i: number, j: number, k: number) => i + sx * (j + sy * k);
    const inside = (i: number, j: number, k: number) => i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz;

    const nodeValue = new Map<number, number>();
    const cellVertex = new Map<number, number>();
    const visited = new Set<number>();
    const verts: number[] = [];
    const activeCells: number[] = []; // i, j, k triples
    let evaluations = 0;
    let truncated = false;

    const enqueue = (i: number, j: number, k: number, into: number[]) => {
        if (!inside(i, j, k)) return;
        const c = key(i, j, k);
        if (visited.has(c)) return;
        if (keep && !keep(box.min[0] + (i + 0.5) * h, box.min[1] + (j + 0.5) * h, box.min[2] + (k + 0.5) * h)) return;
        visited.add(c);
        into.push(i, j, k);
    };

    /** Evaluate the corners of these cells that are not known yet. */
    const fill = (cells: number[]) => {
        const want: number[] = [];
        const keys: number[] = [];
        for (let q = 0; q < cells.length; q += 3) {
            for (const [a, b, c] of CORNER) {
                const i = cells[q] + a, j = cells[q + 1] + b, k = cells[q + 2] + c;
                const nk = key(i, j, k);
                if (nodeValue.has(nk)) continue;
                nodeValue.set(nk, NaN);
                keys.push(nk);
                want.push(box.min[0] + i * h, box.min[1] + j * h, box.min[2] + k * h);
            }
        }
        if (keys.length === 0) return;
        const vals = evaluate(Float64Array.from(want));
        for (let q = 0; q < keys.length; q++) nodeValue.set(keys[q], vals[q]);
        evaluations += keys.length;
    };

    const corner = new Float64Array(8);
    /** Work through a wave of cells; returns the cells to visit next and how many of this wave were crossed. */
    const sweep = (cells: number[], next: number[]): number => {
        fill(cells);
        let crossed = 0;
        for (let q = 0; q < cells.length; q += 3) {
            const i = cells[q], j = cells[q + 1], k = cells[q + 2];
            let neg = 0, bad = false;
            for (let c = 0; c < 8; c++) {
                const v = nodeValue.get(key(i + CORNER[c][0], j + CORNER[c][1], k + CORNER[c][2]))!;
                if (!Number.isFinite(v)) bad = true;
                corner[c] = v;
                if (v < 0) neg++;
            }
            if (bad || neg === 0 || neg === 8) continue;
            if (activeCells.length / 3 >= maxCells) { truncated = true; break; }
            // Vertex: the average of where the surface cuts the cell's edges
            let px = 0, py = 0, pz = 0, cuts = 0;
            for (const [a, b] of EDGES) {
                const va = corner[a], vb = corner[b];
                if ((va < 0) === (vb < 0)) continue;
                const t = va / (va - vb);
                px += CORNER[a][0] + (CORNER[b][0] - CORNER[a][0]) * t;
                py += CORNER[a][1] + (CORNER[b][1] - CORNER[a][1]) * t;
                pz += CORNER[a][2] + (CORNER[b][2] - CORNER[a][2]) * t;
                cuts++;
            }
            cellVertex.set(key(i, j, k), verts.length / 3);
            verts.push(box.min[0] + (i + px / cuts) * h, box.min[1] + (j + py / cuts) * h, box.min[2] + (k + pz / cuts) * h);
            activeCells.push(i, j, k);
            crossed++;
            // Carry on through every face the surface crosses
            for (const f of FACES) {
                let fneg = 0;
                for (const c of f.corners) if (corner[c] < 0) fneg++;
                if (fneg === 0 || fneg === 4) continue;
                enqueue(i + f.step[0], j + f.step[1], k + f.step[2], next);
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
    const vertex = (i: number, j: number, k: number) => (inside(i, j, k) ? cellVertex.get(key(i, j, k)) : undefined);
    const dist2 = (a: number, b: number) => {
        const dx = verts[a * 3] - verts[b * 3], dy = verts[a * 3 + 1] - verts[b * 3 + 1], dz = verts[a * 3 + 2] - verts[b * 3 + 2];
        return dx * dx + dy * dy + dz * dz;
    };
    for (let q = 0; q < activeCells.length; q += 3) {
        const i = activeCells[q], j = activeCells[q + 1], k = activeCells[q + 2];
        const v0 = nodeValue.get(key(i, j, k))!;
        for (let axis = 0; axis < 3; axis++) {
            const v1 = nodeValue.get(key(i + (axis === 0 ? 1 : 0), j + (axis === 1 ? 1 : 0), k + (axis === 2 ? 1 : 0)))!;
            if ((v0 < 0) === (v1 < 0)) continue;
            const ring = AROUND[axis].map(o => vertex(i + o[0], j + o[1], k + o[2]));
            if (ring.some(r => r === undefined)) continue;
            let [a, b, c, d] = ring as number[];
            // Anticlockwise seen from the far end faces +axis: right when the field rises along the edge
            if (!(v0 < 0)) [a, b, c, d] = [d, c, b, a];
            // Split along the shorter diagonal
            if (dist2(a, c) <= dist2(b, d)) tris.push(a, b, c, a, c, d);
            else tris.push(a, b, d, b, c, d);
        }
    }

    return {
        vertices: Float64Array.from(verts), triangles: Uint32Array.from(tris),
        cells: activeCells.length / 3, evaluations, truncated,
    };
}
