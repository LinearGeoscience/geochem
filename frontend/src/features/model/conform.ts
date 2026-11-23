/**
 * A surface that runs alongside another and never crosses it (pure).
 *
 * Layers of one sequence are not independent surfaces: fitted one by one,
 * two that are close can cross between the holes. So a surface can be told
 * it runs alongside another. It is then not fitted through its places
 * itself. How far each of its places is from the other surface is read in
 * the other's field (which is about metres); that offset is carried from
 * place to place by a smooth fit of its own; and the surface is where the
 * other's field equals the offset.
 *
 * The offset is kept on one side of nothing (the side most of its places
 * are on), so the two cannot cross: where it comes to nothing they meet,
 * which is the ground between them pinching out. A place on the other side
 * says the two cross there. It cannot be honoured, and is counted.
 *
 * A chain of these (each layer alongside the next towards one of them) is a
 * sequence in which no two layers cross. Whatever shapes the one at the end
 * of the chain (readings, lines, the model's direction, an overturned limb)
 * shapes them all.
 *
 * Where the other surface is met once only along the normal of the
 * sequence's overall plane (it is nowhere overturned), the offset is
 * measured along that normal and carried over the plane: the surface is
 * then the other's, moved along the normal by an amount that changes from
 * place to place. It has the other's shape exactly, however far off it is,
 * so a crest drawn on one layer is in every layer.
 *
 * Where the other is overturned, the offset is read in the other's field
 * instead and carried along
 * the other surface (each place is taken to the nearest place on the other
 * before the offsets are fitted). That follows the other round an
 * overturned limb, but takes its shape less well far from it.
 *
 * A surface with no places of its own can be put a set distance from the
 * other instead, a parallel surface: places on the other are moved that many
 * metres off it, square to it (`movedPlaces`), and it is fitted through
 * them as through places of its own.
 */
import { fitBlended } from './pou';
import { nearestDistance } from './thickness';
import { evaluateField, heightAlong, ontoPlane, type FitFailure, type FitStats, type FittedField } from './rbf';
import { coverOf } from './sheet';
import type { Box3, Plane, Vec3 } from './types';

export interface ConformInput {
    /** Every place the surface passes through, xyz triples */
    points: ArrayLike<number>;
    /** The field of the surface it runs alongside */
    ref: FittedField;
    /** From its second side towards its first (null: its sides are the other's) */
    facing: Vec3 | null;
    /** With no places of its own: how far from the other it is, m, in the other's field (positive: on its first side) */
    by: number | null;
    box: Box3;
    /** 0 = the offset is exact at every place; larger = looser */
    smoothing?: number;
    /** The overall plane of the surface at the head of the sequence: the surface is carried along its normal where it can be (null: in the other's field) */
    along?: Plane | null;
    /** Places on the other surface, to see that it is met once only along that normal (absent: taken to be) */
    refOn?: ArrayLike<number> | null;
    /** The step that is looked along the normal with, m */
    step?: number;
}

export interface ConformSummary {
    /** Places that say how far it is from the other */
    places: number;
    /** Of those, the ones on the other side of the other surface from the rest: the two would cross there */
    crossed: number;
    /** The side of the other surface it is on: 1 its first, -1 its second, 0 it lies on it */
    side: 1 | -1 | 0;
    /** How far from the other it is at its places: the least, the usual and the most, m */
    least: number;
    usual: number;
    most: number;
    /** It has no places of its own: it is a fixed distance from the other */
    fixed: boolean;
    /** Its first side is the other's second */
    flipped: boolean;
    /** It is the other surface moved along the normal of the sequence's overall plane: it has the other's shape */
    along?: boolean;
    /**
     * It is fitted on its own after all (surfaceJobs `CONFORM_WRONG`):
     * carried alongside the other, this many of the places checked down the
     * holes were on the wrong side of it. The rest says how it lay alongside.
     */
    alone?: { checked: number; wrong: number };
}

export interface ConformFit {
    status: 'sheet' | 'empty' | 'failed';
    field: FittedField | null;
    stats: FitStats | null;
    conform: ConformSummary | null;
    /** When it failed: why the fit could not be solved */
    why?: FitFailure;
}

const NONE: ConformFit = { status: 'empty', field: null, stats: null, conform: null };

/** A field that is one value everywhere */
const level = (value: number): FittedField => ({ centres: new Float64Array(0), weights: new Float64Array(0), lin: [0, 0, 0], c0: value, origin: [0, 0, 0], scale: 1 });

function median(values: number[]): number {
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length === 0 ? 0 : sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** A place this near the other surface, on the wrong side of it, is on it: metres */
const ON_IT = 0.01;
/** The offsets are fitted, then put right by what is left over, this many times */
const ROUNDS = 10;

/** The field rises along the normal at every one of these places on its surface: the surface is met once only along it */
function metOnce(ref: FittedField, normal: ArrayLike<number>, on: ArrayLike<number> | null, step: number): boolean {
    const n = on ? Math.floor(on.length / 3) : 0;
    if (n === 0) return true;
    const probe = new Float64Array(n * 6);
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
        probe[i * 6 + k] = on![i * 3 + k] + step * normal[k];
        probe[i * 6 + 3 + k] = on![i * 3 + k] - step * normal[k];
    }
    const f = evaluateField(ref, probe);
    for (let i = 0; i < n; i++) if (!(f[i * 2] - f[i * 2 + 1] > 0.2 * step)) return false;
    return true;
}

/** The mix of these lists that is nearest the target (null: they cannot be told apart) */
function leastSquares(lists: ArrayLike<number>[], target: ArrayLike<number>): number[] | null {
    const m = lists.length;
    const a = Array.from({ length: m }, () => new Array<number>(m + 1).fill(0));
    for (let r = 0; r < m; r++) {
        for (let c = r; c < m; c++) {
            let sum = 0;
            for (let i = 0; i < target.length; i++) sum += lists[r][i] * lists[c][i];
            a[r][c] = sum; a[c][r] = sum;
        }
        let sum = 0;
        for (let i = 0; i < target.length; i++) sum += lists[r][i] * target[i];
        a[r][m] = sum;
    }
    let size = 0;
    for (let r = 0; r < m; r++) size = Math.max(size, a[r][r]);
    for (let col = 0; col < m; col++) {
        let pivot = col;
        for (let r = col + 1; r < m; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
        if (!(Math.abs(a[pivot][col]) > 1e-12 * size)) return null;
        [a[col], a[pivot]] = [a[pivot], a[col]];
        for (let r = 0; r < m; r++) {
            if (r === col) continue;
            const f = a[r][col] / a[col][col];
            if (f !== 0) for (let c = col; c <= m; c++) a[r][c] -= f * a[col][c];
        }
    }
    return a.map((row, r) => row[m] / row[r]);
}

/** At most this many places are looked at to tell which way it faces */
const FACING_PLACES = 200;

export function fitConform(input: ConformInput): ConformFit {
    const n = Math.floor(input.points.length / 3);
    if (n === 0 && (input.by === null || !Number.isFinite(input.by))) return NONE;
    const fixed = n === 0;
    // Carried along the normal of the sequence's overall plane, where the other surface is met once only along it
    const plane = fixed ? null
        : input.ref.offset ? input.ref.offset.along ?? null
            : input.along && metOnce(input.ref, input.along.normal, input.refOn ?? null, input.step ?? 1) ? input.along : null;
    const read = (places: ArrayLike<number>) => (plane ? heightAlong(input.ref, plane.normal, places) : evaluateField(input.ref, places));
    const at = n > 0 ? Array.from(read(input.points)) : [];
    const usual = fixed ? input.by! : median(at);
    const side: 1 | -1 | 0 = usual > 0 ? 1 : usual < 0 ? -1 : 0;

    // Places on the other side cannot be honoured: there the two meet
    let crossed = 0;
    const values = at.map(v => {
        if (side === 0 || v * side >= 0) return v;
        if (v * side < -ON_IT) crossed++;
        return 0;
    });
    let by: FittedField, stats: FitStats = { used: 0, merged: 0, worstMiss: 0, smoothed: false };
    if (fixed) by = level(input.by!);
    else if (n === 1) by = level(values[0]);
    else if (plane) {
        // The same all the way along the normal: fitted over the plane
        const on = ontoPlane(input.points, plane);
        const fit = fitBlended(on, values, { drift: 'level', smoothing: input.smoothing ?? 0, cover: coverOf(on, input.box) });
        if (!fit.ok) return { ...NONE, status: 'failed', why: fit.reason };
        by = fit.field;
        stats = fit.stats;
    } else {
        // Carried along the other surface: each place at the nearest place on it
        const on = offsetPlaces(input.ref, input.points, 0, 1);
        const cover = coverOf(on, input.box);
        const smoothing = input.smoothing ?? 0;
        const asked = values.slice();
        by = level(0);
        // The offset is read where the place is, a little way off the other surface, so what is asked for on the
        // surface is not quite what is read at the place. What is read follows what is asked in proportion, so the
        // asking that gives the right reading is looked for among mixes of the ones tried so far.
        const tried: number[][] = [], read: Float64Array[] = [];
        let best = Infinity;
        for (let round = 0; round < ROUNDS; round++) {
            const fit = fitBlended(on, asked, { drift: 'level', smoothing, cover });
            if (!fit.ok) { if (round === 0) return { ...NONE, status: 'failed', why: fit.reason }; break; }
            if (smoothing > 0) { by = fit.field; stats = fit.stats; break; }
            const got = evaluateField(fit.field, input.points);
            let worst = 0;
            for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(values[i] - got[i]));
            if (worst < best) { best = worst; by = fit.field; stats = fit.stats; }
            if (best < 1e-3) break;
            tried.push(asked.slice());
            read.push(Float64Array.from(got));
            const mix = leastSquares(read, values);
            if (!mix) break;
            for (let i = 0; i < n; i++) {
                let a = 0, g = 0;
                for (let k = 0; k < mix.length; k++) { a += mix[k] * tried[k][i]; g += mix[k] * read[k][i]; }
                asked[i] = a + (values[i] - g);
            }
        }
    }

    // Which way it faces: as the other does, unless its own sides say the opposite
    let flip: 1 | -1 = 1;
    if (input.facing && n > 0) {
        const step = Math.max(1, Math.ceil(n / FACING_PLACES));
        const probe: number[] = [];
        for (let i = 0; i < n; i += step) for (const s of [1, -1]) for (let k = 0; k < 3; k++) probe.push(input.points[i * 3 + k] + s * input.facing[k]);
        const f = read(probe);
        let d = 0;
        for (let i = 0; i < f.length; i += 2) d += f[i] - f[i + 1];
        if (d < 0) flip = -1;
    }

    const field: FittedField = { ...level(0), offset: { of: input.ref, by, flip, side, ...(plane ? { along: { normal: plane.normal, point: plane.point } } : {}) } };
    let worstMiss = 0;
    if (n > 0) for (const v of evaluateField(field, input.points)) worstMiss = Math.max(worstMiss, Math.abs(v));
    const sizes = (fixed ? [input.by!] : values).map(Math.abs).sort((a, b) => a - b);
    return {
        status: 'sheet', field,
        stats: { ...stats, worstMiss },
        conform: { places: n, crossed, side, least: sizes[0], usual: Math.abs(usual), most: sizes[sizes.length - 1], fixed, flipped: flip < 0, ...(plane ? { along: true } : {}) },
    };
}

/**
 * Places a set distance from a surface, in metres, square to it: places on
 * it (`on`, xyz triples) moved along the way its field rises (`by` under
 * nothing: the other way). A surface through them is parallel to it.
 * `trim`: a place that ends up nearer some other part of the surface than
 * that (inside a tight bend the moved places cross over each other) is left
 * out.
 */
export function movedPlaces(ref: FittedField, on: ArrayLike<number>, by: number, step: number, trim = false): Float64Array {
    const n = Math.floor(on.length / 3);
    const out = Float64Array.from(on);
    const probe = new Float64Array(n * 18);
    for (let i = 0; i < n; i++) for (let j = 0; j < 6; j++) {
        for (let k = 0; k < 3; k++) probe[i * 18 + j * 3 + k] = on[i * 3 + k];
        probe[i * 18 + j * 3 + (j >> 1)] += j % 2 ? -step : step;
    }
    const f = evaluateField(ref, probe);
    for (let i = 0; i < n; i++) {
        const g = [0, 1, 2].map(k => f[i * 6 + k * 2] - f[i * 6 + k * 2 + 1]);
        const len = Math.hypot(g[0], g[1], g[2]);
        if (!(len > 0)) continue;
        for (let k = 0; k < 3; k++) out[i * 3 + k] += by * g[k] / len;
    }
    if (!trim || n < 2) return out;
    const near = nearestDistance(ref, out, step);
    const kept: number[] = [];
    for (let i = 0; i < n; i++) if (!(near[i] < TRIM * Math.abs(by))) kept.push(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]);
    return kept.length >= 9 ? Float64Array.from(kept) : out;
}

/** A moved place is kept when it is at least this share of the set distance from every part of the surface */
const TRIM = 0.9;

/**
 * How far apart places usually are (xyz triples): the distance from a place
 * to its nearest neighbour that nine in ten are within.
 */
export function usualGap(places: ArrayLike<number>): number {
    const n = Math.floor(places.length / 3);
    if (n < 2) return 0;
    const near = new Float64Array(n).fill(Infinity);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const d = (places[i * 3] - places[j * 3]) ** 2 + (places[i * 3 + 1] - places[j * 3 + 1]) ** 2 + (places[i * 3 + 2] - places[j * 3 + 2]) ** 2;
        if (d < near[i]) near[i] = d;
        if (d < near[j]) near[j] = d;
    }
    near.sort();
    return Math.sqrt(near[Math.min(n - 1, Math.floor(0.9 * n))]);
}

/**
 * Places where another surface's field reads `by`: places on the other
 * (`on`, xyz triples) moved off it, square to it, until it does. (The field
 * is only about metres, so this is not a set distance: see `movedPlaces`.)
 */
export function offsetPlaces(ref: FittedField, on: ArrayLike<number>, by: number, step: number): Float64Array {
    const n = Math.floor(on.length / 3);
    const out = Float64Array.from(on);
    // Two rounds: off along the slope, then put right by what the field reads there
    for (let round = 0; round < 2; round++) {
        const probe = new Float64Array(n * 21);
        for (let i = 0; i < n; i++) for (let j = 0; j < 7; j++) {
            for (let k = 0; k < 3; k++) probe[i * 21 + j * 3 + k] = out[i * 3 + k];
            if (j > 0) probe[i * 21 + j * 3 + ((j - 1) >> 1)] += (j % 2 ? step : -step);
        }
        const f = evaluateField(ref, probe);
        for (let i = 0; i < n; i++) {
            const g = [0, 1, 2].map(k => (f[i * 7 + 1 + k * 2] - f[i * 7 + 2 + k * 2]) / (2 * step));
            const g2 = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
            if (!(g2 > 0)) continue;
            const move = (by - f[i * 7]) / g2;
            for (let k = 0; k < 3; k++) out[i * 3 + k] += move * g[k];
        }
    }
    return out;
}
