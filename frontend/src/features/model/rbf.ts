/**
 * Radial basis function fit of a 3D scalar field (pure, unit-tested).
 *
 * Every modelled surface is the place where a fitted field crosses a level:
 *
 *     f(p) = drift(p) + c0 + sum_j w_j * (-|p - x_j|)
 *
 * The kernel is the linear (biharmonic) one: it does not overshoot between
 * nearby points and stays well conditioned at drillhole spacing (the cubic
 * kernel does not). The drift is either
 *   - a FIXED plane (signed distance to a trend plane): for sheets, where the
 *     data are points ON the surface (value 0) and the trend supplies the
 *     which-side-is-which that zeros alone cannot; or
 *   - a FREE linear function, solved with the weights: for fields with real
 *     values (distance to a contact, a grade).
 *
 * Coordinates are centred and scaled by ONE factor before solving (raw UTM
 * coordinates make the system singular; per-axis scaling would add a hidden
 * anisotropy). Values stay in their own units.
 */
import { solveDense } from './linalg';
import { ReachGrid } from './near';
import type { Plane, Vec3 } from './types';

/**
 * Space stretched along one direction before a fit: a place `d` from the
 * plane through `point` square to `normal` is treated as `factor * d` from
 * it. With `second`, it is stretched along a second direction too, square
 * to the first: what is left unstretched is then one direction, the one
 * things carry furthest in.
 */
export interface Stretch {
    normal: Vec3;
    point: Vec3;
    factor: number;
    second?: { normal: Vec3; factor: number } | null;
}

/** World points (xyz triples) as a stretched fit sees them. */
export function stretchPoints(points: ArrayLike<number>, stretch: Stretch): Float64Array {
    const out = Float64Array.from(points);
    const { normal: n, point: c } = stretch;
    const m = stretch.second?.normal ?? null, g = stretch.second ? stretch.second.factor - 1 : 0;
    for (let i = 0; i + 2 < out.length; i += 3) {
        const dx = out[i] - c[0], dy = out[i + 1] - c[1], dz = out[i + 2] - c[2];
        const t = (stretch.factor - 1) * (dx * n[0] + dy * n[1] + dz * n[2]);
        out[i] += t * n[0];
        out[i + 1] += t * n[1];
        out[i + 2] += t * n[2];
        if (m) {
            const u = g * (dx * m[0] + dy * m[1] + dz * m[2]);
            out[i] += u * m[0];
            out[i + 1] += u * m[1];
            out[i + 2] += u * m[2];
        }
    }
    return out;
}

/** The stretch that undoes a stretch: stretched points back to where they are in the world. */
export function inverseStretch(stretch: Stretch): Stretch {
    return {
        normal: stretch.normal, point: stretch.point, factor: 1 / stretch.factor,
        ...(stretch.second ? { second: { normal: stretch.second.normal, factor: 1 / stretch.second.factor } } : {}),
    };
}

/** The box that holds a box once it is stretched. */
export function stretchedBox(box: { min: Vec3; max: Vec3 }, stretch: Stretch): { min: Vec3; max: Vec3 } {
    const corners: number[] = [];
    for (const x of [box.min[0], box.max[0]]) for (const y of [box.min[1], box.max[1]]) for (const z of [box.min[2], box.max[2]]) corners.push(x, y, z);
    const s = stretchPoints(corners, stretch);
    const out = { min: [Infinity, Infinity, Infinity] as Vec3, max: [-Infinity, -Infinity, -Infinity] as Vec3 };
    for (let i = 0; i < s.length; i++) {
        out.min[i % 3] = Math.min(out.min[i % 3], s[i]);
        out.max[i % 3] = Math.max(out.max[i % 3], s[i]);
    }
    return out;
}

/** How long a line of world length 1 along `direction` is to a stretched fit. */
export function stretchedLength(direction: ArrayLike<number>, stretch: Stretch): number {
    const p = stretchPoints([stretch.point[0] + direction[0], stretch.point[1] + direction[1], stretch.point[2] + direction[2]], stretch);
    return Math.hypot(p[0] - stretch.point[0], p[1] - stretch.point[1], p[2] - stretch.point[2]);
}

/** A height through the layers of the ground (frame.ts) at the places of a lattice: x fastest, then y, then z */
export interface HeightLattice {
    min: Vec3;
    cell: number;
    size: [number, number, number];
    heights: Float32Array;
}

/**
 * A fit that follows the ground as it lies from place to place. Every place
 * has one more coordinate than its three in the ground: `weight` times its
 * height through the layers. Two places on one layer are then as far apart
 * as they are in the ground; two places one above the other, a metre apart
 * across the layers, are sqrt(1 + weight^2) m apart. Where the ground lies
 * one way everywhere this is a `Stretch` across it by that factor.
 */
export interface Layering extends HeightLattice {
    weight: number;
}

/** The extra coordinate of world points (xyz triples) in a layered fit. Beyond the lattice it is as at the lattice's nearest face. */
export function layerCoordinate(layering: Layering, points: ArrayLike<number>): Float64Array {
    const { min, cell, size, heights, weight } = layering;
    const [nx, ny, nz] = size;
    const count = Math.floor(points.length / 3);
    const out = new Float64Array(count);
    const inv = 1 / cell;
    for (let q = 0, i = 0; q < count; q++, i += 3) {
        const u = Math.min(nx - 1, Math.max(0, (points[i] - min[0]) * inv));
        const v = Math.min(ny - 1, Math.max(0, (points[i + 1] - min[1]) * inv));
        const w = Math.min(nz - 1, Math.max(0, (points[i + 2] - min[2]) * inv));
        const i0 = Math.min(nx - 2, Math.floor(u)), j0 = Math.min(ny - 2, Math.floor(v)), k0 = Math.min(nz - 2, Math.floor(w));
        const a = u - i0, b = v - j0, c = w - k0;
        const at = i0 + nx * (j0 + ny * k0), up = at + nx * ny;
        const low = (heights[at] * (1 - a) + heights[at + 1] * a) * (1 - b) + (heights[at + nx] * (1 - a) + heights[at + nx + 1] * a) * b;
        const high = (heights[up] * (1 - a) + heights[up + 1] * a) * (1 - b) + (heights[up + nx] * (1 - a) + heights[up + nx + 1] * a) * b;
        out[q] = weight * (low * (1 - c) + high * c);
    }
    return out;
}

export interface FittedField {
    /** Centres in scaled coordinates, (world - origin) / scale, 3 per centre */
    centres: Float64Array;
    /** One weight per centre */
    weights: Float64Array;
    /** Linear part in scaled coordinates */
    lin: Vec3;
    c0: number;
    /** World position of scaled (0, 0, 0) */
    origin: Vec3;
    /** World length of one scaled unit */
    scale: number;
    /**
     * The field was fitted in stretched space: world points are stretched
     * the same way before it is read, whatever it is made of (its blocks
     * and its cap are in stretched space too).
     */
    stretch?: Stretch | null;
    /**
     * A field fitted block by block (pou.ts): it is these, blended. The
     * centres and weights above are then empty.
     */
    parts?: FieldPart[] | null;
    /** The field counts only near these places (see `FieldCap`) */
    cap?: FieldCap | null;
    /**
     * The field follows the ground from place to place (see `Layering`):
     * every place it is read at is given its extra coordinate from this
     * first. Its blocks and its cap have the extra coordinate of their own
     * places (`extra`).
     */
    layering?: Layering | null;
    /** The centres' extra coordinate, scaled as they are: (extra - extraOrigin) / scale. One per centre (absent: they have none) */
    extra?: Float64Array | null;
    extraOrigin?: number;
}

/**
 * A field kept to the neighbourhood of some places, each with a reach of
 * its own. Within half the reach of one of them the field is as fitted; from
 * there it fades to `background`, which it is at the reach and everywhere
 * beyond. A fit with no drift carries the last value it was given outwards
 * for ever: this is what stops a shell round high values from running off
 * into ground with no samples.
 */
export interface FieldCap {
    /** The places, xyz triples (world) */
    positions: Float64Array;
    /** How far each place counts, one per place */
    reach: Float64Array;
    background: number;
    /** The places' extra coordinate in a layered fit (see `Layering`): the reach is then measured with it */
    extra?: Float64Array | null;
}

const capGrids = new WeakMap<FieldCap, ReachGrid>();

/** For each point, how much the fitted field counts there: 1 near the cap's places, 0 at their reach and beyond. */
export function capWeights(cap: FieldCap, points: ArrayLike<number>, extra: ArrayLike<number> | null = null): Float64Array {
    let grid = capGrids.get(cap);
    if (!grid) {
        grid = new ReachGrid(cap.positions, cap.reach, cap.extra ?? null);
        capGrids.set(cap, grid);
    }
    const count = Math.floor(points.length / 3);
    const w = new Float64Array(count);
    for (let q = 0, i = 0; q < count; q++, i += 3) w[q] = grid.weight(points[i], points[i + 1], points[i + 2], extra ? extra[q] : 0);
    return w;
}

function evaluateCapped(field: FittedField, cap: FieldCap, points: ArrayLike<number>, extra: ArrayLike<number> | null, out?: Float64Array): Float64Array {
    const count = Math.floor(points.length / 3);
    const res = out ?? new Float64Array(count);
    const w = capWeights(cap, points, extra);
    const rows: number[] = [], local: number[] = [];
    for (let q = 0; q < count; q++) {
        if (w[q] > 0) {
            rows.push(q);
            local.push(points[q * 3], points[q * 3 + 1], points[q * 3 + 2]);
        } else res[q] = cap.background;
    }
    if (rows.length === 0) return res;
    const f = evaluateBare(field, local, extra ? rows.map(q => extra[q]) : null);
    for (let k = 0; k < rows.length; k++) {
        const q = rows[k];
        // Where no block of the fit reaches there is only the background
        res[q] = Number.isFinite(f[k]) ? w[q] * f[k] + (1 - w[q]) * cap.background : cap.background;
    }
    return res;
}

/** One block of a field fitted block by block: its own field, counted inside this box and fading to nothing at its faces */
export interface FieldPart {
    min: Vec3;
    max: Vec3;
    field: FittedField;
}

/** 1 in the middle of a block, falling smoothly to 0 at its faces (u: 0 to 1 across it) */
const fade = (u: number) => {
    const t = 4 * u * (1 - u);
    return t * t;
};

/** A blended field at world points: each block's field by its weight there. NaN where no block reaches. */
function evaluateParts(parts: readonly FieldPart[], points: ArrayLike<number>, extra: ArrayLike<number> | null, out?: Float64Array): Float64Array {
    const count = Math.floor(points.length / 3);
    const res = out ?? new Float64Array(count);
    const total = new Float64Array(count), weight = new Float64Array(count);
    for (const { min, max, field } of parts) {
        const rows: number[] = [], w: number[] = [], local: number[] = [];
        const more: number[] | null = extra ? [] : null;
        const sx = 1 / (max[0] - min[0]), sy = 1 / (max[1] - min[1]), sz = 1 / (max[2] - min[2]);
        for (let q = 0, i = 0; q < count; q++, i += 3) {
            const x = points[i], y = points[i + 1], z = points[i + 2];
            if (!(x > min[0] && x < max[0] && y > min[1] && y < max[1] && z > min[2] && z < max[2])) continue;
            rows.push(q);
            w.push(fade((x - min[0]) * sx) * fade((y - min[1]) * sy) * fade((z - min[2]) * sz));
            local.push(x, y, z);
            if (more) more.push(extra![q]);
        }
        if (rows.length === 0) continue;
        const f = readField(field, local, more);
        for (let k = 0; k < rows.length; k++) {
            total[rows[k]] += w[k] * f[k];
            weight[rows[k]] += w[k];
        }
    }
    for (let q = 0; q < count; q++) res[q] = weight[q] > 0 ? total[q] / weight[q] : NaN;
    return res;
}

export interface FitStats {
    /** Centres solved for (after merging) */
    used: number;
    /** Input points merged into another at the same place */
    merged: number;
    /** Largest difference between the field and a value it was given (0 unless smoothed) */
    worstMiss: number;
    /** A little smoothing had to be added to get a stable solve */
    smoothed: boolean;
}

export interface FitOptions {
    /** 'linear' = solve a linear drift; a plane = fixed drift, the signed distance to it */
    drift: 'linear' | Plane;
    /** 0 = pass exactly through the values; larger = looser (in scaled kernel units) */
    smoothing?: number;
    /** One more coordinate for each point, in the points' own units (see `Layering`) */
    extra?: ArrayLike<number> | null;
}

export type FitResult =
    | { ok: true; field: FittedField; stats: FitStats }
    | { ok: false; reason: 'too-few' | 'singular' };

/** Points closer than this (scaled units) are one point */
const MERGE = 1e-8;
/** Smoothing tried, in turn, when an exact solve is unstable */
const RESCUE = [1e-9, 1e-6];

interface Prepared {
    centres: Float64Array;
    /** The centres' extra coordinate, scaled as they are (null: they have none) */
    extra: Float64Array | null;
    extraOrigin: number;
    values: Float64Array;
    origin: Vec3;
    scale: number;
    merged: number;
}

/** Centre, scale and merge coincident points (averaging their values). */
function prepare(points: ArrayLike<number>, values: ArrayLike<number>, extra: ArrayLike<number> | null = null): Prepared {
    const n = Math.min(Math.floor(points.length / 3), values.length);
    const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
    let eMin = Infinity, eMax = -Infinity;
    for (let i = 0; i < n; i++) {
        for (let k = 0; k < 3; k++) {
            const v = points[i * 3 + k];
            if (v < min[k]) min[k] = v;
            if (v > max[k]) max[k] = v;
        }
        if (extra) {
            if (extra[i] < eMin) eMin = extra[i];
            if (extra[i] > eMax) eMax = extra[i];
        }
    }
    const origin: Vec3 = n > 0 ? [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] : [0, 0, 0];
    const extraOrigin = extra && eMax >= eMin ? (eMin + eMax) / 2 : 0;
    // (The scale is from where the points are in the ground alone: the looseness of a fit is in units of it)
    const extent = n > 0 ? Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) : 0;
    const scale = extent > 0 ? extent / 2 : 1;

    const centres: number[] = [];
    const extras: number[] = [];
    const sums: number[] = [];
    const counts: number[] = [];
    const seen = new Map<string, number>();
    for (let i = 0; i < n; i++) {
        const v = values[i];
        const x = (points[i * 3] - origin[0]) / scale;
        const y = (points[i * 3 + 1] - origin[1]) / scale;
        const z = (points[i * 3 + 2] - origin[2]) / scale;
        const e = extra ? (extra[i] - extraOrigin) / scale : 0;
        if (!Number.isFinite(v) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(e)) continue;
        const key = `${Math.round(x / MERGE)},${Math.round(y / MERGE)},${Math.round(z / MERGE)}${extra ? `,${Math.round(e / MERGE)}` : ''}`;
        const hit = seen.get(key);
        if (hit !== undefined) {
            sums[hit] += v;
            counts[hit]++;
            continue;
        }
        seen.set(key, sums.length);
        centres.push(x, y, z);
        extras.push(e);
        sums.push(v);
        counts.push(1);
    }
    const m = sums.length;
    const merged = counts.reduce((s, c) => s + c - 1, 0);
    return {
        centres: Float64Array.from(centres),
        extra: extra ? Float64Array.from(extras) : null, extraOrigin,
        values: Float64Array.from(sums, (s, i) => s / counts[i]),
        origin, scale, merged: m > 0 ? merged : 0,
    };
}

/** One attempt at a given smoothing. Null when the solve is singular or inaccurate. */
function solve(p: Prepared, rhs: Float64Array, freeDrift: boolean, rho: number): { weights: Float64Array; tail: Float64Array; worstMiss: number } | null {
    const c = p.centres, e = p.extra;
    const m = rhs.length;
    const tailSize = freeDrift ? 4 : 1;
    const n = m + tailSize;
    const a = new Float64Array(n * n);
    for (let i = 0; i < m; i++) {
        const xi = c[i * 3], yi = c[i * 3 + 1], zi = c[i * 3 + 2];
        const row = i * n;
        a[row + i] = rho;
        for (let j = i + 1; j < m; j++) {
            const dx = xi - c[j * 3], dy = yi - c[j * 3 + 1], dz = zi - c[j * 3 + 2];
            const de = e ? e[i] - e[j] : 0;
            const k = -Math.sqrt(dx * dx + dy * dy + dz * dz + de * de);
            a[row + j] = k;
            a[j * n + i] = k;
        }
        a[row + m] = 1;
        a[m * n + i] = 1;
        if (freeDrift) {
            for (let k = 0; k < 3; k++) {
                a[row + m + 1 + k] = c[i * 3 + k];
                a[(m + 1 + k) * n + i] = c[i * 3 + k];
            }
        }
    }
    const b = new Float64Array(n);
    b.set(rhs);
    const x = solveDense(a, n, b);
    if (!x) return null;

    // Check the answer against the equations (the factorisation overwrote the matrix)
    let worstMiss = 0, worstResidual = 0, size = 0;
    for (let i = 0; i < m; i++) {
        const xi = c[i * 3], yi = c[i * 3 + 1], zi = c[i * 3 + 2];
        let g = x[m];
        if (freeDrift) g += x[m + 1] * xi + x[m + 2] * yi + x[m + 3] * zi;
        for (let j = 0; j < m; j++) {
            const dx = xi - c[j * 3], dy = yi - c[j * 3 + 1], dz = zi - c[j * 3 + 2];
            const de = e ? e[i] - e[j] : 0;
            g -= x[j] * Math.sqrt(dx * dx + dy * dy + dz * dz + de * de);
        }
        const miss = Math.abs(g - rhs[i]);
        const residual = Math.abs(g + rho * x[i] - rhs[i]);
        if (miss > worstMiss) worstMiss = miss;
        if (residual > worstResidual) worstResidual = residual;
        if (Math.abs(rhs[i]) > size) size = Math.abs(rhs[i]);
    }
    if (!(worstResidual <= 1e-7 * Math.max(size, p.scale * 1e-3))) return null;
    return { weights: x.slice(0, m), tail: x.slice(m), worstMiss };
}

/**
 * Fit a field to values at points (xyz triples, world coordinates).
 * A fixed-drift fit needs 1 point; a free linear drift needs 4 that are not
 * all in one plane.
 */
export function fitField(points: ArrayLike<number>, values: ArrayLike<number>, options: FitOptions): FitResult {
    const p = prepare(points, values, options.extra ?? null);
    const m = p.values.length;
    const freeDrift = options.drift === 'linear';
    if (m < (freeDrift ? 4 : 1)) return { ok: false, reason: 'too-few' };

    // A fixed plane drift is taken off the values; in scaled coordinates it is lin . s + shift
    let lin: Vec3 = [0, 0, 0];
    let shift = 0;
    const rhs = p.values.slice();
    if (options.drift !== 'linear') {
        const { normal, point } = options.drift;
        lin = [normal[0] * p.scale, normal[1] * p.scale, normal[2] * p.scale];
        shift = normal[0] * (p.origin[0] - point[0]) + normal[1] * (p.origin[1] - point[1]) + normal[2] * (p.origin[2] - point[2]);
        for (let i = 0; i < m; i++) {
            rhs[i] -= lin[0] * p.centres[i * 3] + lin[1] * p.centres[i * 3 + 1] + lin[2] * p.centres[i * 3 + 2] + shift;
        }
    }

    const asked = Math.max(0, options.smoothing ?? 0);
    const attempts = [asked, ...RESCUE.filter(r => r > asked)];
    for (const rho of attempts) {
        const s = solve(p, rhs, freeDrift, rho);
        if (!s) continue;
        if (freeDrift) lin = [s.tail[1], s.tail[2], s.tail[3]];
        return {
            ok: true,
            field: { centres: p.centres, weights: s.weights, lin, c0: s.tail[0] + shift, origin: p.origin, scale: p.scale, ...(p.extra ? { extra: p.extra, extraOrigin: p.extraOrigin } : {}) },
            stats: { used: m, merged: p.merged, worstMiss: s.worstMiss, smoothed: rho !== asked },
        };
    }
    return { ok: false, reason: 'singular' };
}

/** The field at world points (xyz triples). `out` may be supplied to avoid an allocation. */
export function evaluateField(field: FittedField, points: ArrayLike<number>, out?: Float64Array): Float64Array {
    return readField(field, points, field.layering ? layerCoordinate(field.layering, points) : null, out);
}

/**
 * The field at world points whose extra coordinate is known already (one
 * for each point; null: the field has none). For a layered fit in the
 * making, and its blocks: `evaluateField` is the one to use on a finished field.
 */
export function readField(field: FittedField, points: ArrayLike<number>, extra: ArrayLike<number> | null, out?: Float64Array): Float64Array {
    const seen = field.stretch ? stretchPoints(points, field.stretch) : points;
    return field.cap ? evaluateCapped(field, field.cap, seen, extra, out) : evaluateBare(field, seen, extra, out);
}

/** The field as fitted, before any cap, at points in the space it was fitted in. */
function evaluateBare(field: FittedField, points: ArrayLike<number>, extra: ArrayLike<number> | null, out?: Float64Array): Float64Array {
    if (field.parts) return evaluateParts(field.parts, points, extra, out);
    const count = Math.floor(points.length / 3);
    const res = out ?? new Float64Array(count);
    const { centres: c, weights: w, lin, c0, origin: o } = field;
    const inv = 1 / field.scale;
    const m = w.length;
    const ce = extra && field.extra ? field.extra : null, eo = field.extraOrigin ?? 0;
    for (let q = 0, i = 0; q < count; q++, i += 3) {
        const x = (points[i] - o[0]) * inv, y = (points[i + 1] - o[1]) * inv, z = (points[i + 2] - o[2]) * inv;
        let s = c0 + lin[0] * x + lin[1] * y + lin[2] * z;
        if (ce) {
            const e = (extra![q] - eo) * inv;
            for (let j = 0, k = 0; j < m; j++, k += 3) {
                const dx = x - c[k], dy = y - c[k + 1], dz = z - c[k + 2], de = e - ce[j];
                s -= w[j] * Math.sqrt(dx * dx + dy * dy + dz * dz + de * de);
            }
        } else {
            for (let j = 0, k = 0; j < m; j++, k += 3) {
                const dx = x - c[k], dy = y - c[k + 1], dz = z - c[k + 2];
                s -= w[j] * Math.sqrt(dx * dx + dy * dy + dz * dz);
            }
        }
        res[q] = s;
    }
    return res;
}
