/**
 * The pictures of the geological model guide (pure, unit-tested): surfaces
 * on a small cross-section, fitted with the solver the app's surfaces are
 * fitted with (surfaceHelpMaths), and the units between them worked out
 * with the rule the models are built with (geoModel.unitsAt).
 */
import { unitsAt, type RuleStep } from '../model/geoModel';
import { gridValues, HEIGHT, NX, NZ, sheetDemo, STEP, valuesAt, WIDTH, type Pt } from '../plots/viewer3d/surfaceHelpMaths';

export { HEIGHT, STEP, WIDTH };
export type { Pt };

/** A surface of a picture: the number at every corner of the grid (null: it could not be fitted) */
export type GridField = Float64Array | null;

/** A surface through points, as the app fits a sheet: its number at the grid's corners */
export function lineThrough(points: readonly Pt[]): GridField {
    const demo = sheetDemo(points);
    return demo.field ? gridValues(demo.field) : null;
}

/** A closed body: the number is how far inside a circle a place is */
export function bodyRound(centre: Pt, radius: number): Float64Array {
    const out = new Float64Array((NX + 1) * (NZ + 1));
    for (let j = 0, q = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++, q++) out[q] = radius - Math.hypot(i * STEP - centre[0], j * STEP - centre[1]);
    return out;
}

/** The units are worked out on squares this many times finer than the grid, so that their edges sit under the lines */
export const FINE = 4;
/** The side of one of those squares, and how many there are each way */
export const CELL = STEP / FINE;
const FX = NX * FINE, FZ = NZ * FINE;

/** A surface's number at the middle of every fine square (row by row from the bottom), between the grid's corners */
export function fine(values: Float64Array): Float64Array {
    const out = new Float64Array(FX * FZ);
    for (let j = 0, q = 0; j < FZ; j++) {
        const gj = Math.floor(j / FINE), t = (j % FINE + 0.5) / FINE;
        for (let i = 0; i < FX; i++, q++) {
            const gi = Math.floor(i / FINE), s = (i % FINE + 0.5) / FINE;
            const a = gj * (NX + 1) + gi;
            out[q] = (values[a] * (1 - s) + values[a + 1] * s) * (1 - t) + (values[a + NX + 1] * (1 - s) + values[a + NX + 2] * s) * t;
        }
    }
    return out;
}

/** A surface's number at a place, between the grid's corners */
export function gridAt(values: Float64Array, x: number, z: number): number {
    const fx = Math.min(NX - 1e-9, Math.max(0, x / STEP)), fz = Math.min(NZ - 1e-9, Math.max(0, z / STEP));
    const gi = Math.floor(fx), gj = Math.floor(fz), s = fx - gi, t = fz - gj;
    const a = gj * (NX + 1) + gi;
    return (values[a] * (1 - s) + values[a + 1] * s) * (1 - t) + (values[a + NX + 1] * (1 - s) + values[a + NX + 2] * s) * t;
}

/**
 * One surface in one fault block and another in the other, at the middle
 * of every fine square: the block is the side of the fault a place is on.
 */
export function byBlock(fault: Float64Array, first: Float64Array, second: Float64Array): Float64Array {
    const f = fine(fault), a = fine(first), b = fine(second);
    return Float64Array.from(f, (v, q) => (v > 0 ? a[q] : b[q]));
}

/** The unit in every fine square, from the surfaces' numbers at their middles (see unitSquares) */
export function unitsOfSquares(steps: readonly RuleStep[], middles: readonly Float64Array[]): Int16Array {
    return unitsAt(steps, middles as Float64Array[], FX * FZ);
}

/**
 * The unit in every fine square (row by row from the bottom): the number
 * of the contact whose unit is there, -1 the oldest ground. `steps` and
 * `fields`: the contacts, the oldest first, each as its number at the
 * grid's corners. A square is where its middle is.
 */
export function unitSquares(steps: readonly RuleStep[], fields: readonly Float64Array[]): Int16Array {
    return unitsOfSquares(steps, fields.map(fine));
}

/**
 * Line pieces (x, z, x, z each) joined end to end into runs of points
 * (x, z, x, z, ...), so that a dashed line is dashed along its length and
 * not piece by piece.
 */
export function joinPieces(pieces: ArrayLike<number>): number[][] {
    const key = (x: number, z: number) => `${Math.round(x * 50)},${Math.round(z * 50)}`;
    const n = pieces.length / 4;
    const at = new Map<string, number[]>();
    for (let k = 0; k < n; k++) for (const e of [0, 2]) {
        const id = key(pieces[k * 4 + e], pieces[k * 4 + e + 1]);
        let list = at.get(id);
        if (!list) at.set(id, list = []);
        list.push(k);
    }
    const used = new Uint8Array(n);
    const grow = (run: number[], x: number, z: number): void => {
        for (;;) {
            const next = (at.get(key(x, z)) ?? []).find(k => !used[k]);
            if (next === undefined) return;
            used[next] = 1;
            const here = key(pieces[next * 4], pieces[next * 4 + 1]) === key(x, z) ? 2 : 0;
            x = pieces[next * 4 + here]; z = pieces[next * 4 + here + 1];
            run.push(x, z);
        }
    };
    const runs: number[][] = [];
    for (let k = 0; k < n; k++) {
        if (used[k]) continue;
        used[k] = 1;
        const forward = [pieces[k * 4 + 2], pieces[k * 4 + 3]];
        grow(forward, forward[0], forward[1]);
        const back = [pieces[k * 4], pieces[k * 4 + 1]];
        grow(back, back[0], back[1]);
        // back runs away from the piece's start: turned round, it leads into forward
        const run: number[] = [];
        for (let q = back.length - 2; q >= 0; q -= 2) run.push(back[q], back[q + 1]);
        runs.push(run.concat(forward));
    }
    return runs;
}

/** Squares kept only where `inside` says (a model inside a unit of another): the others become `else_` */
export function onlyWhere(squares: Int16Array, inside: (q: number) => boolean, else_: number): Int16Array {
    return Int16Array.from(squares, (u, q) => (inside(q) ? u : else_));
}

/** The squares of each unit as runs along the rows: per unit, x, z (bottom) and width triples */
export function unitRuns(squares: Int16Array): Map<number, number[]> {
    const out = new Map<number, number[]>();
    for (let j = 0; j < FZ; j++) {
        let start = 0;
        for (let i = 1; i <= FX; i++) {
            if (i < FX && squares[j * FX + i] === squares[j * FX + start]) continue;
            const u = squares[j * FX + start];
            let runs = out.get(u);
            if (!runs) out.set(u, runs = []);
            runs.push(start * CELL, j * CELL, (i - start) * CELL);
            start = i;
        }
    }
    return out;
}

/** The share of the section each unit covers (0 to 1), by its number */
export function unitShares(squares: Int16Array): Map<number, number> {
    const out = new Map<number, number>();
    for (const u of squares) out.set(u, (out.get(u) ?? 0) + 1 / squares.length);
    return out;
}

/** The true contact of the "holes left out" picture: it rolls, so that a hole says little about the ground far from it */
export const rollingContact = (x: number) => 150 + 38 * Math.sin((x - 40) / 62) + 14 * Math.sin(x / 23);
export const CHECK_HOLES = [40, 110, 180, 250, 320, 390, 460];

export interface LeftOut {
    /** The contact fitted through every hole but the one left out (null: it could not be fitted) */
    field: GridField;
    /** Where the hole left out logged the contact, and how far from it the fitted one passes there (m, up the hole) */
    logged: Pt;
    miss: number;
}

/** The contact fitted without one of its holes, and how far it then is from where that hole logged it */
export function leftOut(hole: number): LeftOut {
    const all: Pt[] = CHECK_HOLES.map(x => [x, rollingContact(x)]);
    const logged = all[hole];
    const demo = sheetDemo(all.filter((_, k) => k !== hole));
    if (!demo.field) return { field: null, logged, miss: 0 };
    // Up the hole from where it logged the contact to where the fitted one is: found by stepping along the hole
    let miss = 0, best = Infinity;
    for (let z = 10; z <= HEIGHT - 10; z += 0.5) {
        const v = Math.abs(valuesAt(demo.field, [[logged[0], z]])[0]);
        if (v < best) { best = v; miss = z - logged[1]; }
    }
    return { field: gridValues(demo.field), logged, miss };
}
