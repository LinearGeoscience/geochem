/**
 * The ground a geological model covers (pure): a box, with or without an
 * outline it is kept inside (a column along the direction the outline was
 * drawn in) and a surface that is its top (the ground). Each part is a field
 * that is positive inside, about the distance to that part's edge in metres,
 * so the model's mesher treats the boundary like any other surface.
 */
import type { CutGrid } from './cutCells';
import { outlineDistance, outlineFrame } from './outline';
import type { Box3, SurfaceOutline, Vec3 } from './types';

/** The names of the box's six faces, in the order of their fields */
export const BOX_FACES = ['west', 'east', 'south', 'north', 'bottom', 'top'] as const;

/** The share of its size a box made from the data is widened by, each way */
export const DATA_MARGIN = 0.05;
/** A model's grid has about this many cells along its longest side, when its cell size is left to be worked out */
export const AUTO_CELLS = 56;
/** ... and never more nodes than this */
export const MAX_NODES = 2_500_000;
/**
 * Where the thinnest unit logged is thinner than two such cells, the cells
 * are made half its usual thickness instead: but no smaller than gives this
 * many nodes, so that a model nobody set a resolution for still builds in
 * seconds.
 */
export const AUTO_NODES = 500_000;

/** The box of a model: its own, or the data's with a margin (null: neither) */
export function modelBox(own: Box3 | null, data: Box3 | null): Box3 | null {
    if (own) return own;
    if (!data) return null;
    const pad = data.max.map((v, k) => Math.max((v - data.min[k]) * DATA_MARGIN, 1)) as Vec3;
    return { min: data.min.map((v, k) => v - pad[k]) as Vec3, max: data.max.map((v, k) => v + pad[k]) as Vec3 };
}

const NICE = [1, 1.25, 2, 2.5, 4, 5, 8, 10];

/** The round size at or above a size (1, 1.25, 2, 2.5, 4, 5 or 8 times a power of ten) */
function roundUp(cell: number): number {
    const power = 10 ** Math.floor(Math.log10(cell));
    return power * (NICE.find(v => v * power >= cell * 0.999) ?? 10);
}

/**
 * A round cell size for a box (m), and the one used when `asked` would need
 * too many nodes. `thinnest`: the usual thickness of the thinnest unit logged
 * (m), when that is known: a cell size that is worked out is no more than
 * half of it, as far as `AUTO_NODES` allows.
 */
export function modelCell(box: Box3, asked: number | null, thinnest: number | null = null): number {
    const size = box.max.map((v, k) => v - box.min[k]);
    const longest = Math.max(...size, 1e-9);
    const count = (c: number) => size.reduce((n, s) => n * (Math.ceil(s / c) + 3), 1);
    let cell = asked && asked > 0 ? asked : roundUp(longest / AUTO_CELLS);
    if (!(asked && asked > 0) && thinnest && thinnest > 0 && thinnest / 2 < cell) {
        const usual = cell;
        cell = roundUp(thinnest / 2);
        // As coarse as it must be for a model that builds in seconds: but never coarser than it would have been
        while (count(cell) > AUTO_NODES && cell < usual) cell = Math.min(usual, roundUp(cell * 1.2));
    }
    // As coarse as it must be to stay within the most nodes there can be
    while (count(cell) > MAX_NODES) cell *= 1.25;
    return cell;
}

/** The grid of nodes over a box: its faces fall mid-cell, with a node layer outside all round */
export function boundaryGrid(box: Box3, cell: number): CutGrid {
    const n = box.max.map((v, k) => Math.ceil((v - box.min[k]) / cell - 1e-9) + 2) as [number, number, number];
    // Centred on the box, so opposite faces are cut alike
    const origin = box.min.map((v, k) => (v + box.max[k]) / 2 - (n[k] - 1) * cell / 2) as Vec3;
    return { origin, cell, n };
}

/** The world coordinates of a grid's nodes, xyz triples (x fastest) */
export function gridPoints(grid: CutGrid): Float64Array {
    const [nx, ny, nz] = grid.n;
    const out = new Float64Array(nx * ny * nz * 3);
    let at = 0;
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        out[at++] = grid.origin[0] + i * grid.cell;
        out[at++] = grid.origin[1] + j * grid.cell;
        out[at++] = grid.origin[2] + k * grid.cell;
    }
    return out;
}

/** The box's six fields at places (xyz triples): positive inside, the distance to that face */
export function boxFields(box: Box3, points: ArrayLike<number>): Float64Array[] {
    const n = points.length / 3;
    const out = Array.from({ length: 6 }, () => new Float64Array(n));
    for (let i = 0; i < n; i++) {
        for (let k = 0; k < 3; k++) {
            out[k * 2][i] = points[i * 3 + k] - box.min[k];
            out[k * 2 + 1][i] = box.max[k] - points[i * 3 + k];
        }
    }
    return out;
}

/** An outline's field at places: positive inside it, seen along the direction it was drawn in (null: no outline to speak of) */
export function outlineField(outline: SurfaceOutline | null | undefined, points: ArrayLike<number>): Float64Array | null {
    const frame = outlineFrame(outline);
    if (!frame) return null;
    const n = points.length / 3;
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = -outlineDistance(frame, points[i * 3], points[i * 3 + 1], points[i * 3 + 2]);
    return out;
}

/**
 * Which way up a top surface's field is: 1 when it is positive below the
 * surface, -1 when positive above. Told from its values at places (xyz
 * triples): the sign that goes with being lower.
 */
export function topSense(values: ArrayLike<number>, points: ArrayLike<number>): 1 | -1 {
    let zPos = 0, nPos = 0, zNeg = 0, nNeg = 0;
    for (let i = 0; i < values.length; i++) {
        if (values[i] > 0) { zPos += points[i * 3 + 2]; nPos++; } else { zNeg += points[i * 3 + 2]; nNeg++; }
    }
    if (nPos === 0 || nNeg === 0) return 1;
    return zPos / nPos < zNeg / nNeg ? 1 : -1;
}

/** Is a place inside a box (its faces count as outside) */
export const inBox = (box: Box3, x: number, y: number, z: number): boolean =>
    x > box.min[0] && x < box.max[0] && y > box.min[1] && y < box.max[1] && z > box.min[2] && z < box.max[2];
