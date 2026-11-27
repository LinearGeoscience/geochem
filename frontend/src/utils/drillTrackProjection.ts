/**
 * Drill tracking: where a hole being drilled is heading, against the hole
 * planned for it (pure; unit-tested).
 *
 * A projection starts at the last survey of the drilled hole (its place and
 * angles on the drilled path) and runs on with constant lift and drift, as
 * the planner's holes do (`walk`). Three are made: holding the last survey's
 * dip and azimuth, the recent lift and drift, and a lift and drift given
 * (by default the planned hole's).
 *
 * Each is measured against the planned hole at its target and at its end of
 * hole, two ways:
 * - the closest approach of the projected path to the point (distance, and
 *   the depth down the drilled hole where it comes closest);
 * - the miss where the projection crosses the plane through the point square
 *   to the planned hole there: high (+) or low (-) of it, measured towards
 *   the planned hole's high side, and right (+) or left (-) of it looking
 *   down the hole. A planned hole vertical there takes its high side from its
 *   azimuth at the collar.
 */
import { direction, stationAt, walk, type Rates, type Trace, type Vec3 } from './drillholePlan';
import { sides } from './drillholePlanWedge';

/** A planned hole, as tracking measures against it */
export interface PlannedTrack {
    name: string;
    trace: Trace;
    /** Null: a hole planned by collar with no target */
    target: Vec3 | null;
    targetDepth: number | null;
    eoh: number;
    lift: number;
    drift: number;
}

export type ProjectionKind = 'hold' | 'recent' | 'custom' | 'required';

export const PROJECTION_KINDS: readonly ProjectionKind[] = ['hold', 'recent', 'custom', 'required'];

export const PROJECTION_LABELS: Record<ProjectionKind, string> = {
    hold: 'Holding the last survey',
    recent: 'Recent lift and drift',
    custom: 'Lift and drift given',
    /** The least lift and drift that land within the tolerance (drillTrackRequired) */
    required: 'Least to come within tolerance',
};

/** The path a projection takes: depths are down the drilled hole (from its collar) */
export function project(drilled: Trace, fromDepth: number, rates: Rates, toDepth: number): Trace | null {
    const start = stationAt(drilled, fromDepth);
    if (!start || !(toDepth > fromDepth)) return null;
    const t = walk({ p: start.p, dip: start.dip, azi: start.azi }, rates, toDepth - fromDepth, 1, { record: true }).trace!;
    for (let i = 0; i < t.depth.length; i++) t.depth[i] += fromDepth;
    return t;
}

const sub = (a: ArrayLike<number>, b: ArrayLike<number>): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const at = (t: Trace, i: number): Vec3 => [t.xyz[i * 3], t.xyz[i * 3 + 1], t.xyz[i * 3 + 2]];

/** Where a path comes closest to a point: the distance, the depth there and the place */
export function closestApproach(trace: Trace, point: Vec3): { distance: number; depth: number; p: Vec3 } | null {
    const n = trace.depth.length;
    if (n === 0) return null;
    let best = { distance: Math.hypot(...sub(at(trace, 0), point)), depth: trace.depth[0], p: at(trace, 0) };
    for (let i = 0; i + 1 < n; i++) {
        const a = at(trace, i), b = at(trace, i + 1), ab = sub(b, a);
        const len2 = dot(ab, ab);
        const f = len2 > 0 ? Math.min(1, Math.max(0, dot(sub(point, a), ab) / len2)) : 0;
        const p: Vec3 = [a[0] + ab[0] * f, a[1] + ab[1] * f, a[2] + ab[2] * f];
        const distance = Math.hypot(...sub(p, point));
        if (distance < best.distance) best = { distance, depth: trace.depth[i] + (trace.depth[i + 1] - trace.depth[i]) * f, p };
    }
    return best;
}

export interface Miss {
    /** Metres towards the planned hole's high side (negative: low) */
    high: number;
    /** Metres to the right looking down the planned hole (negative: left) */
    right: number;
    /** Straight-line distance in the plane */
    distance: number;
    /** Depth down the drilled hole where it crosses the plane */
    depth: number;
}

/**
 * Where a path crosses the plane through `point` square to the direction
 * `along` (the planned hole there), measured as high / low and left / right of
 * the point. Null when the path does not reach the plane.
 */
export function missInPlane(trace: Trace, point: Vec3, along: Vec3, aziIfVertical: number): Miss | null {
    const n = trace.depth.length;
    const side = (i: number) => dot(sub(at(trace, i), point), along);
    let before = n ? side(0) : NaN;
    if (before >= 0) return null;
    for (let i = 1; i < n; i++) {
        const now = side(i);
        if (now >= 0) {
            const f = before === now ? 0 : before / (before - now);
            const a = at(trace, i - 1), b = at(trace, i);
            const p: Vec3 = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
            const { h, r } = sides(along, aziIfVertical);
            const m = sub(p, point);
            const high = dot(m, h), right = dot(m, r);
            return { high, right, distance: Math.hypot(high, right), depth: trace.depth[i - 1] + (trace.depth[i] - trace.depth[i - 1]) * f };
        }
        before = now;
    }
    return null;
}

/** A projection measured at one point of the planned hole */
export interface PointCheck {
    closest: { distance: number; depth: number } | null;
    miss: Miss | null;
}

/** How a path does against a planned hole at a depth down the planned hole (its target, its end) */
export function checkAt(path: Trace, plan: PlannedTrack, planDepth: number): PointCheck | null {
    const s = stationAt(plan.trace, Math.min(planDepth, plan.trace.depth[plan.trace.depth.length - 1]));
    if (!s) return null;
    const along = direction(s.dip, s.azi);
    const c = closestApproach(path, s.p);
    return { closest: c ? { distance: c.distance, depth: c.depth } : null, miss: missInPlane(path, s.p, along, plan.trace.azi[0]) };
}

/**
 * The drilled path so far joined to a projection (the drilled stations down
 * to where the projection starts, then the projection), so that a closest
 * approach already passed is still found.
 */
export function joined(drilled: Trace, projection: Trace): Trace {
    const start = projection.depth[0];
    let k = 0;
    while (k < drilled.depth.length && drilled.depth[k] < start - 1e-9) k++;
    const n = k + projection.depth.length;
    const out: Trace = { depth: new Float64Array(n), dip: new Float64Array(n), azi: new Float64Array(n), xyz: new Float64Array(n * 3) };
    out.depth.set(drilled.depth.subarray(0, k)); out.dip.set(drilled.dip.subarray(0, k)); out.azi.set(drilled.azi.subarray(0, k));
    out.xyz.set(drilled.xyz.subarray(0, k * 3));
    out.depth.set(projection.depth, k); out.dip.set(projection.dip, k); out.azi.set(projection.azi, k);
    out.xyz.set(projection.xyz, k * 3);
    return out;
}

export interface ProjectionResult {
    kind: ProjectionKind;
    rates: Rates;
    /** The projection alone (from the last survey) */
    path: Trace;
    target: PointCheck | null;
    eoh: PointCheck | null;
}

/**
 * Projects a drilled hole from `fromDepth` (its last survey) with each set of
 * rates, far enough past the planned end of hole (`beyond` metres) for a
 * deviated hole still to cross its plane, and measures each against the plan.
 */
export function projectAll(drilled: Trace, fromDepth: number, plan: PlannedTrack, rates: Partial<Record<ProjectionKind, Rates | null>>, beyond = 100): ProjectionResult[] {
    const toDepth = Math.max(plan.eoh, fromDepth) + beyond;
    const out: ProjectionResult[] = [];
    for (const kind of PROJECTION_KINDS) {
        const r = rates[kind];
        if (!r) continue;
        const path = project(drilled, fromDepth, r, toDepth);
        if (!path) continue;
        const whole = joined(drilled, path);
        out.push({
            kind, rates: r, path,
            target: plan.targetDepth !== null ? checkAt(whole, plan, plan.targetDepth) : null,
            eoh: checkAt(whole, plan, plan.eoh),
        });
    }
    return out;
}
