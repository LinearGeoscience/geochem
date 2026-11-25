/**
 * A fit from rows (pure; nothing uses it yet: Round 27, Phase 241).
 *
 * A row is one thing known about the field at a place:
 *  - a value: what the field is there;
 *  - a slope: how fast the field changes there along a direction.
 *
 * Measurements become rows. A dip is three slope rows at its place: the
 * field rises at a set rate straight across the plane and not at all along
 * two directions in it (two rows, the ones in the plane, when the way up
 * of the plane is not known). A line the surface holds (a lineation, a
 * plunge) is one row: the field does not change along it.
 *
 * The field is the usual one (rbf.ts): a sum over the rows, one weight
 * each, and a drift. A value row adds its weight times the kernel about
 * its place; a slope row adds its weight times the kernel's own slope
 * along the row's direction. The weights are found by solving for all the
 * rows together, so slopes are honoured exactly, as values are, and not by
 * made-up values a short way either side of a place.
 *
 * The kernel is a parameter:
 *  - 'linear', rounded off at the origin over `round` metres:
 *    -sqrt(r² + round²). With `round` = 0 it is the kernel of rbf.ts and
 *    a fit of values alone is `fitField`'s to the last digit; but a slope
 *    cannot be asked for at a sharp point, so slope rows need `round` > 0.
 *    `round` is the distance a slope is imposed over.
 *  - 'cubic': r³. Smooth at the origin without a length of its own, but it
 *    grows fast away from the data.
 *
 * Coordinates are scaled exactly as rbf.ts scales them, so smoothing and
 * looseness mean what they mean there for value rows.
 */
import { solveDense } from './linalg';
import { cross, unit } from './plane';
import type { Plane, Vec3 } from './types';

export type KernelSpec = { kind: 'linear'; round: number } | { kind: 'cubic' };

/** Rows, as flat lists: row i is at `positions[3i..]`; a direction of nothing (0, 0, 0) makes it a value row */
export interface Rows {
    positions: number[];
    /** The direction a slope row's slope is along (used as given: a unit vector for a slope per metre) */
    directions: number[];
    /** The value there, or the slope along the direction (per metre) */
    values: number[];
    /**
     * How loosely each row is held: 0 = exactly; larger = it may be missed
     * by more. For a value row it is added to `smoothing` (the same units).
     * For a slope row it is a share of what the row reads of itself, so
     * that it means the same whatever the size of the data and the
     * rounding of the kernel (`LOOSE_MEASURED` is the usual for a dip
     * measured in a hole).
     */
    loose: number[];
}

export const emptyRows = (): Rows => ({ positions: [], directions: [], values: [], loose: [] });

/**
 * What the kernel trial of Round 27 chose (Phase 242; scripts/qa/local/
 * kernelTrial.ts, pinned by hermiteChoice.test.ts).
 *
 * The kernel is today's, rounded off over half the spacing of the places
 * a surface is fitted to. Between holes a surface held to its dips this
 * way is 25 to 60% nearer the truth than one held by made-up values either
 * side of each dip, where the dips are right; r³ does as well between
 * holes but runs away past the data.
 *
 * A dip honoured exactly over that distance does harm when it is wrong
 * (10 degrees out: a fifth worse than today). So a dip measured in a hole
 * is held a little loosely, which costs 1 to 3 degrees at a dip that is
 * right; a dip placed by hand is held exactly.
 */
export const ROUND_SHARE = 0.5;
export const LOOSE_MEASURED = 0.1;

export function addValue(rows: Rows, at: ArrayLike<number>, value: number, loose = 0): void {
    rows.positions.push(at[0], at[1], at[2]);
    rows.directions.push(0, 0, 0);
    rows.values.push(value);
    rows.loose.push(loose);
}

export function addSlope(rows: Rows, at: ArrayLike<number>, along: ArrayLike<number>, slope: number, loose = 0): void {
    rows.positions.push(at[0], at[1], at[2]);
    rows.directions.push(along[0], along[1], along[2]);
    rows.values.push(slope);
    rows.loose.push(loose);
}

/** Two unit directions in the plane a normal stands on, square to each other */
export function inPlane(normal: ArrayLike<number>): [Vec3, Vec3] | null {
    const n = unit(normal);
    if (!n) return null;
    const least = Math.abs(n[0]) <= Math.abs(n[1]) && Math.abs(n[0]) <= Math.abs(n[2]) ? 0 : Math.abs(n[1]) <= Math.abs(n[2]) ? 1 : 2;
    const axis: Vec3 = [0, 0, 0];
    axis[least] = 1;
    const a = unit(cross(n, axis))!;
    return [a, cross(n, a)];
}

/**
 * A plane measured at a place (a dip): the field does not change along the
 * plane there. With `rise` it also rises that much a metre along the normal
 * (1: the field is distance from the surface there), which fixes which
 * way up the plane is; without, the plane holds either way up.
 */
export function addPlane(rows: Rows, at: ArrayLike<number>, normal: ArrayLike<number>, rise: number | null = 1, loose = 0): void {
    const within = inPlane(normal);
    if (!within) return;
    if (rise !== null) addSlope(rows, at, unit(normal)!, rise, loose);
    addSlope(rows, at, within[0], 0, loose);
    addSlope(rows, at, within[1], 0, loose);
}

/** A line the surface holds at a place (a lineation, a plunge): the field does not change along it there */
export function addLine(rows: Rows, at: ArrayLike<number>, line: ArrayLike<number>, loose = 0): void {
    const l = unit(line);
    if (l) addSlope(rows, at, l, 0, loose);
}

export interface RowField {
    kernel: KernelSpec;
    /** Where the rows are, in scaled coordinates, (world - origin) / scale, 3 per row */
    centres: Float64Array;
    /** Each row's direction (0, 0, 0: a value row), as given */
    directions: Float64Array;
    weights: Float64Array;
    /** Linear part in scaled coordinates */
    lin: Vec3;
    c0: number;
    origin: Vec3;
    scale: number;
}

export interface RowFitOptions {
    kernel: KernelSpec;
    /** 'linear' = solve a linear drift; a plane = fixed drift, the signed distance to it */
    drift: 'linear' | Plane;
    /** 0 = every row exactly; larger = looser (in scaled kernel units, as in rbf.ts) */
    smoothing?: number;
}

export interface RowFitStats {
    /** Rows solved for (after merging), and how many of them are slopes */
    used: number;
    slopes: number;
    merged: number;
    /** Largest difference between the field and a value it was given, and between its slope and a slope it was given (per metre) */
    worstMiss: number;
    worstSlopeMiss: number;
    smoothed: boolean;
}

/** Why not: too few rows, rows that do not fix one answer, or slopes asked of a kernel with a sharp point at the origin */
export type RowFitFailure = 'too-few' | 'singular' | 'sharp';

export type RowFitResult =
    | { ok: true; field: RowField; stats: RowFitStats }
    | { ok: false; reason: RowFitFailure };

const MERGE = 1e-8;
const RESCUE = [1e-9, 1e-6];

/**
 * A kernel as a function of the square of the distance, q, with its first
 * two slopes in q. From them, at an offset u (q = |u|²): the kernel's
 * slope is 2 f1 u, and its curvature 2 f1 I + 4 f2 u uᵀ.
 */
interface Radial { f: (q: number) => number; f1: (q: number) => number; f2: (q: number) => number }

function radial(kernel: KernelSpec, scale: number): Radial {
    if (kernel.kind === 'cubic') {
        return { f: q => q * Math.sqrt(q), f1: q => 1.5 * Math.sqrt(q), f2: q => (q > 0 ? 0.75 / Math.sqrt(q) : 0) };
    }
    const c = Math.max(0, kernel.round) / scale, c2 = c * c;
    return {
        f: q => -Math.sqrt(q + c2),
        f1: q => (q + c2 > 0 ? -0.5 / Math.sqrt(q + c2) : 0),
        f2: q => (q + c2 > 0 ? 0.25 / ((q + c2) * Math.sqrt(q + c2)) : 0),
    };
}

interface Prepared {
    centres: Float64Array;
    directions: Float64Array;
    isSlope: Uint8Array;
    values: Float64Array;
    loose: Float64Array;
    origin: Vec3;
    scale: number;
    merged: number;
}

/** Centre and scale as rbf.ts does (by where the rows are), and merge rows that say the same kind of thing at one place */
function prepare(rows: Rows): Prepared {
    const n = Math.min(Math.floor(rows.positions.length / 3), rows.values.length);
    const p = rows.positions, d = rows.directions;
    const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
        const v = p[i * 3 + k];
        if (v < min[k]) min[k] = v;
        if (v > max[k]) max[k] = v;
    }
    const origin: Vec3 = n > 0 ? [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] : [0, 0, 0];
    const extent = n > 0 ? Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) : 0;
    const scale = extent > 0 ? extent / 2 : 1;

    const centres: number[] = [], directions: number[] = [], sums: number[] = [], counts: number[] = [], looseness: number[] = [];
    const seen = new Map<string, number>();
    for (let i = 0; i < n; i++) {
        const v = rows.values[i];
        const x = (p[i * 3] - origin[0]) / scale, y = (p[i * 3 + 1] - origin[1]) / scale, z = (p[i * 3 + 2] - origin[2]) / scale;
        const dx = d[i * 3] ?? 0, dy = d[i * 3 + 1] ?? 0, dz = d[i * 3 + 2] ?? 0;
        if (![v, x, y, z, dx, dy, dz].every(Number.isFinite)) continue;
        const slope = dx !== 0 || dy !== 0 || dz !== 0;
        const key = `${Math.round(x / MERGE)},${Math.round(y / MERGE)},${Math.round(z / MERGE)}${slope ? `|${Math.round(dx / MERGE)},${Math.round(dy / MERGE)},${Math.round(dz / MERGE)}` : ''}`;
        const hit = seen.get(key);
        const l = rows.loose[i] > 0 ? rows.loose[i] : 0;
        if (hit !== undefined) {
            sums[hit] += v;
            counts[hit]++;
            looseness[hit] = Math.min(looseness[hit], l);
            continue;
        }
        seen.set(key, sums.length);
        centres.push(x, y, z);
        directions.push(dx, dy, dz);
        sums.push(v);
        counts.push(1);
        looseness.push(l);
    }
    const m = sums.length;
    return {
        centres: Float64Array.from(centres), directions: Float64Array.from(directions),
        isSlope: Uint8Array.from({ length: m }, (_, i) => (directions[i * 3] !== 0 || directions[i * 3 + 1] !== 0 || directions[i * 3 + 2] !== 0 ? 1 : 0)),
        values: Float64Array.from(sums, (s, i) => s / counts[i]),
        loose: Float64Array.from(looseness),
        origin, scale, merged: counts.reduce((s, c) => s + c - 1, 0),
    };
}

/**
 * What row i reads of the basis of row j (both in scaled coordinates): the
 * kernel between two values, its slope along a direction between a value
 * and a slope, its curvature along both between two slopes.
 */
function entry(k: Radial, p: Prepared, i: number, j: number): number {
    const c = p.centres, d = p.directions;
    const ux = c[i * 3] - c[j * 3], uy = c[i * 3 + 1] - c[j * 3 + 1], uz = c[i * 3 + 2] - c[j * 3 + 2];
    const q = ux * ux + uy * uy + uz * uz;
    const si = p.isSlope[i], sj = p.isSlope[j];
    if (!si && !sj) return k.f(q);
    const f1 = k.f1(q);
    if (!si) return -2 * f1 * (d[j * 3] * ux + d[j * 3 + 1] * uy + d[j * 3 + 2] * uz);
    if (!sj) return 2 * f1 * (d[i * 3] * ux + d[i * 3 + 1] * uy + d[i * 3 + 2] * uz);
    const di = d[i * 3] * ux + d[i * 3 + 1] * uy + d[i * 3 + 2] * uz, dj = d[j * 3] * ux + d[j * 3 + 1] * uy + d[j * 3 + 2] * uz;
    const dd = d[i * 3] * d[j * 3] + d[i * 3 + 1] * d[j * 3 + 1] + d[i * 3 + 2] * d[j * 3 + 2];
    return -(2 * f1 * dd + 4 * k.f2(q) * di * dj);
}

function solve(k: Radial, p: Prepared, rhs: Float64Array, freeDrift: boolean, rho: number): { weights: Float64Array; tail: Float64Array; worstMiss: number; worstSlopeMiss: number } | null {
    const m = rhs.length;
    const tailSize = freeDrift ? 4 : 1;
    const n = m + tailSize;
    const a = new Float64Array(n * n);
    const c = p.centres, d = p.directions;
    // (A slope row's looseness is a share of what it reads of itself; where that is nothing, as with r³, it is as it is given)
    const slack = new Float64Array(m);
    for (let i = 0; i < m; i++) {
        const self = entry(k, p, i, i);
        slack[i] = rho + (p.isSlope[i] && self !== 0 ? p.loose[i] * Math.abs(self) : p.loose[i]);
    }
    for (let i = 0; i < m; i++) {
        const row = i * n;
        a[row + i] = entry(k, p, i, i) + slack[i];
        for (let j = i + 1; j < m; j++) {
            const v = entry(k, p, i, j);
            a[row + j] = v;
            a[j * n + i] = v;
        }
        // The drift as the row reads it: a value reads 1 and its place, a slope reads its direction
        const one = p.isSlope[i] ? 0 : 1;
        a[row + m] = one;
        a[m * n + i] = one;
        if (freeDrift) {
            for (let t = 0; t < 3; t++) {
                const v = p.isSlope[i] ? d[i * 3 + t] : c[i * 3 + t];
                a[row + m + 1 + t] = v;
                a[(m + 1 + t) * n + i] = v;
            }
        }
    }
    const b = new Float64Array(n);
    b.set(rhs);
    const x = solveDense(a, n, b);
    if (!x) return null;

    // Check the answer against the rows (the factorisation overwrote the matrix)
    let worstMiss = 0, worstSlopeMiss = 0, worstResidual = 0, size = 0;
    for (let i = 0; i < m; i++) {
        let g = p.isSlope[i] ? 0 : x[m];
        if (freeDrift) for (let t = 0; t < 3; t++) g += x[m + 1 + t] * (p.isSlope[i] ? d[i * 3 + t] : c[i * 3 + t]);
        for (let j = 0; j < m; j++) g += x[j] * entry(k, p, i, j);
        const miss = Math.abs(g - rhs[i]);
        const residual = Math.abs(g + slack[i] * x[i] - rhs[i]);
        // (A slope's miss is told per metre, as it was asked for)
        if (p.isSlope[i]) { if (miss / p.scale > worstSlopeMiss) worstSlopeMiss = miss / p.scale; } else if (miss > worstMiss) worstMiss = miss;
        if (residual > worstResidual) worstResidual = residual;
        if (Math.abs(rhs[i]) > size) size = Math.abs(rhs[i]);
    }
    if (!(worstResidual <= 1e-7 * Math.max(size, p.scale * 1e-3))) return null;
    return { weights: x.slice(0, m), tail: x.slice(m), worstMiss, worstSlopeMiss };
}

/**
 * Fit a field to rows (world coordinates). A free linear drift needs rows
 * that fix a plane between them: four values not in one plane, or as
 * little as one value and one dip.
 */
export function fitRows(rows: Rows, options: RowFitOptions): RowFitResult {
    const p = prepare(rows);
    const m = p.values.length;
    const freeDrift = options.drift === 'linear';
    const slopes = p.isSlope.reduce((s, v) => s + v, 0);
    if (m < (freeDrift ? 4 : 1)) return { ok: false, reason: 'too-few' };
    if (slopes > 0 && options.kernel.kind === 'linear' && !(options.kernel.round > 0)) return { ok: false, reason: 'sharp' };
    const k = radial(options.kernel, p.scale);

    // In scaled coordinates a slope per metre is `scale` times as much per unit
    const rhs = p.values.slice();
    for (let i = 0; i < m; i++) if (p.isSlope[i]) rhs[i] *= p.scale;
    // A fixed plane drift is taken off the rows; in scaled coordinates it is lin . s + shift
    let lin: Vec3 = [0, 0, 0];
    let shift = 0;
    if (options.drift !== 'linear') {
        const { normal, point } = options.drift;
        lin = [normal[0] * p.scale, normal[1] * p.scale, normal[2] * p.scale];
        shift = normal[0] * (p.origin[0] - point[0]) + normal[1] * (p.origin[1] - point[1]) + normal[2] * (p.origin[2] - point[2]);
        for (let i = 0; i < m; i++) {
            const of = p.isSlope[i] ? p.directions : p.centres;
            rhs[i] -= lin[0] * of[i * 3] + lin[1] * of[i * 3 + 1] + lin[2] * of[i * 3 + 2] + (p.isSlope[i] ? 0 : shift);
        }
    }

    const asked = Math.max(0, options.smoothing ?? 0);
    const attempts = [asked, ...RESCUE.filter(r => r > asked)];
    for (const rho of attempts) {
        const s = solve(k, p, rhs, freeDrift, rho);
        if (!s) continue;
        if (freeDrift) lin = [s.tail[1], s.tail[2], s.tail[3]];
        return {
            ok: true,
            field: { kernel: options.kernel, centres: p.centres, directions: p.directions, weights: s.weights, lin, c0: s.tail[0] + shift, origin: p.origin, scale: p.scale },
            stats: { used: m, slopes, merged: p.merged, worstMiss: s.worstMiss, worstSlopeMiss: s.worstSlopeMiss, smoothed: rho !== asked },
        };
    }
    return { ok: false, reason: 'singular' };
}

/** The field at world points (xyz triples) */
export function evaluateRows(field: RowField, points: ArrayLike<number>, out?: Float64Array): Float64Array {
    const count = Math.floor(points.length / 3);
    const res = out ?? new Float64Array(count);
    const { centres: c, directions: d, weights: w, lin, c0, origin: o } = field;
    const k = radial(field.kernel, field.scale);
    const inv = 1 / field.scale;
    const m = w.length;
    for (let q = 0, i = 0; q < count; q++, i += 3) {
        const x = (points[i] - o[0]) * inv, y = (points[i + 1] - o[1]) * inv, z = (points[i + 2] - o[2]) * inv;
        let s = c0 + lin[0] * x + lin[1] * y + lin[2] * z;
        for (let j = 0, t = 0; j < m; j++, t += 3) {
            const ux = x - c[t], uy = y - c[t + 1], uz = z - c[t + 2];
            const qq = ux * ux + uy * uy + uz * uz;
            if (d[t] === 0 && d[t + 1] === 0 && d[t + 2] === 0) s += w[j] * k.f(qq);
            else s += w[j] * -2 * k.f1(qq) * (d[t] * ux + d[t + 1] * uy + d[t + 2] * uz);
        }
        res[q] = s;
    }
    return res;
}

/**
 * How the field rises at world points: its slope along x, y and z there,
 * per metre (xyz triples), worked out from the field itself and not from
 * readings a step apart.
 */
export function slopeOfRows(field: RowField, points: ArrayLike<number>): Float64Array {
    const count = Math.floor(points.length / 3);
    const res = new Float64Array(count * 3);
    const { centres: c, directions: d, weights: w, lin, origin: o } = field;
    const k = radial(field.kernel, field.scale);
    const inv = 1 / field.scale;
    const m = w.length;
    for (let q = 0, i = 0; q < count; q++, i += 3) {
        const x = (points[i] - o[0]) * inv, y = (points[i + 1] - o[1]) * inv, z = (points[i + 2] - o[2]) * inv;
        let gx = lin[0], gy = lin[1], gz = lin[2];
        for (let j = 0, t = 0; j < m; j++, t += 3) {
            const ux = x - c[t], uy = y - c[t + 1], uz = z - c[t + 2];
            const qq = ux * ux + uy * uy + uz * uz;
            const f1 = k.f1(qq);
            if (d[t] === 0 && d[t + 1] === 0 && d[t + 2] === 0) {
                const a = 2 * w[j] * f1;
                gx += a * ux; gy += a * uy; gz += a * uz;
            } else {
                const du = d[t] * ux + d[t + 1] * uy + d[t + 2] * uz;
                const a = -2 * w[j] * f1, b = -4 * w[j] * k.f2(qq) * du;
                gx += a * d[t] + b * ux; gy += a * d[t + 1] + b * uy; gz += a * d[t + 2] + b * uz;
            }
        }
        res[i] = gx * inv; res[i + 1] = gy * inv; res[i + 2] = gz * inv;
    }
    return res;
}
