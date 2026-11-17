/**
 * Fitting a field to a great many valued points (pure, unit-tested).
 *
 * One fit through every point at once costs the cube of their number: fine
 * to about a thousand, hopeless at twenty thousand. So space is cut into
 * blocks of about `block` points, each block is fitted on its own together
 * with a margin of its neighbours' points, and the blocks' fields are
 * blended across the margins (a "partition of unity"). Near a point the
 * answer comes almost wholly from the block the point is in, so the blend
 * honours the values as the single fit would; the cost grows only with the
 * number of points.
 */
import { fitField, readField, type FieldPart, type FitResult, type FittedField } from './rbf';
import type { Box3, Vec3 } from './types';

export interface BlendOptions {
    /** 0 = pass exactly through the values; larger = looser */
    smoothing?: number;
    /** The field is wanted everywhere in this box (it holds the points) */
    cover: Box3;
    /** Up to this many points are fitted in one go (default 1200) */
    dense?: number;
    /** Points to a block (default 150) */
    block?: number;
    /**
     * What the field does away from its points. 'tilted' (default): each
     * block carries on with the tilt of its own values. 'level': it settles
     * to a constant, which is what values with no trend to them want (a
     * tilted block runs off without limit where it has no points).
     */
    drift?: 'tilted' | 'level';
    /** One more coordinate for each point, in the points' own units (rbf.ts, `Layering`). The blocks are still cut by where the points are in the ground */
    extra?: ArrayLike<number> | null;
}

/** Each block also takes its neighbours' points for this share of its size on every side */
const MARGIN = 0.25;
/**
 * A block is fitted to at most this many times its own points. A big block
 * of scattered points beside a dense cluster would otherwise take thousands
 * of the cluster's points in its margin: its margin is narrowed instead.
 */
const CROWD = 5;
const LEAST_MARGIN = 0.02;
/** No drift: a block with too few points for a tilted one settles to a constant */
const LEVEL = { normal: [0, 0, 0] as Vec3, point: [0, 0, 0] as Vec3 };

/** Half the longest side of the box round these points (the unit `fitField` scales by; 1 for a single place) */
function scaleOf(points: ArrayLike<number>, rows?: readonly number[]): number {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const n = rows ? rows.length : Math.floor(points.length / 3);
    for (let k = 0; k < n; k++) {
        const i = rows ? rows[k] : k;
        for (let a = 0; a < 3; a++) {
            const v = points[i * 3 + a];
            if (v < min[a]) min[a] = v;
            if (v > max[a]) max[a] = v;
        }
    }
    const extent = n > 0 ? Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) : 0;
    return extent > 0 ? extent / 2 : 1;
}

function fitOne(points: ArrayLike<number>, values: ArrayLike<number>, smoothing: number, level: boolean, extra: ArrayLike<number> | null = null): FitResult {
    const tilted: FitResult = level ? { ok: false, reason: 'too-few' } : fitField(points, values, { drift: 'linear', smoothing, extra });
    return tilted.ok ? tilted : fitField(points, values, { drift: LEVEL, smoothing, extra });
}

/** Fit a field to values at points (xyz triples, world), block by block when there are many. */
export function fitBlended(points: ArrayLike<number>, values: ArrayLike<number>, options: BlendOptions): FitResult {
    const n = Math.min(Math.floor(points.length / 3), values.length);
    const smoothing = Math.max(0, options.smoothing ?? 0);
    const level = options.drift === 'level';
    const extra = options.extra ?? null;
    if (n <= (options.dense ?? 1200)) return fitOne(points, values, smoothing, level, extra);
    const perBlock = Math.max(8, options.block ?? 150);

    // Cut the cover into blocks, each time across the direction its points spread furthest, at their middle point
    const leaves: { box: Box3; rows: number[] }[] = [];
    const split = (rows: number[], box: Box3) => {
        if (rows.length <= perBlock) { leaves.push({ box, rows }); return; }
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (const i of rows) for (let a = 0; a < 3; a++) {
            const v = points[i * 3 + a];
            if (v < min[a]) min[a] = v;
            if (v > max[a]) max[a] = v;
        }
        const axis = [0, 1, 2].reduce((best, a) => (max[a] - min[a] > max[best] - min[best] ? a : best), 0);
        const sorted = rows.slice().sort((p, q) => points[p * 3 + axis] - points[q * 3 + axis]);
        const half = sorted.length >> 1;
        const at = (points[sorted[half - 1] * 3 + axis] + points[sorted[half] * 3 + axis]) / 2;
        // All at one place along every direction: cannot be cut further
        if (!(max[axis] > min[axis])) { leaves.push({ box, rows }); return; }
        const low: Box3 = { min: [...box.min] as Vec3, max: [...box.max] as Vec3 }, high: Box3 = { min: [...box.min] as Vec3, max: [...box.max] as Vec3 };
        low.max[axis] = at;
        high.min[axis] = at;
        split(sorted.slice(0, half), low);
        split(sorted.slice(half), high);
    };
    const all: number[] = [];
    for (let i = 0; i < n; i++) {
        if (Number.isFinite(values[i]) && Number.isFinite(points[i * 3]) && Number.isFinite(points[i * 3 + 1]) && Number.isFinite(points[i * 3 + 2]) && (!extra || Number.isFinite(extra[i]))) all.push(i);
    }
    split(all, options.cover);

    const whole = scaleOf(points, all);
    const parts: FieldPart[] = [];
    let smoothed = false;
    for (const leaf of leaves) {
        let min: Vec3 = leaf.box.min, max: Vec3 = leaf.box.max;
        let local: number[] = [], vals: number[] = [], more: number[] = [];
        for (let margin = MARGIN; ; margin /= 2) {
            min = [0, 1, 2].map(a => leaf.box.min[a] - margin * (leaf.box.max[a] - leaf.box.min[a])) as Vec3;
            max = [0, 1, 2].map(a => leaf.box.max[a] + margin * (leaf.box.max[a] - leaf.box.min[a])) as Vec3;
            local = [];
            vals = [];
            more = [];
            for (const i of all) {
                const x = points[i * 3], y = points[i * 3 + 1], z = points[i * 3 + 2];
                if (x < min[0] || x > max[0] || y < min[1] || y > max[1] || z < min[2] || z > max[2]) continue;
                local.push(x, y, z);
                vals.push(values[i]);
                if (extra) more.push(extra[i]);
            }
            if (vals.length <= CROWD * perBlock || margin / 2 < LEAST_MARGIN) break;
        }
        if (vals.length === 0) continue;
        // The same looseness in every block, whatever its size: smoothing is in units of the fit's own scale
        const fit = fitOne(local, vals, smoothing * whole / scaleOf(local), level, extra ? more : null);
        if (!fit.ok) return fit;
        smoothed ||= fit.stats.smoothed;
        parts.push({ min, max, field: fit.field });
    }
    if (parts.length === 0) return { ok: false, reason: 'too-few' };

    const field: FittedField = { centres: new Float64Array(0), weights: new Float64Array(0), lin: [0, 0, 0], c0: 0, origin: [0, 0, 0], scale: 1, parts };
    let worstMiss = 0;
    if (smoothing > 0 || smoothed) {
        const at = readField(field, Float64Array.from(all.flatMap(i => [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]])), extra ? all.map(i => extra[i]) : null);
        all.forEach((i, k) => { worstMiss = Math.max(worstMiss, Math.abs(at[k] - values[i])); });
    }
    return { ok: true, field, stats: { used: all.length, merged: 0, worstMiss, smoothed } };
}
