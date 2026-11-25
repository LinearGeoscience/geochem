/**
 * Exploration drillhole planner: trajectory maths (pure: no React, no three.js; unit-tested).
 *
 * Conventions (shown in the planner panel, defined here once):
 * - World float64 East / North / RL in the dataset's grid. Never float32: grid
 *   northings are large.
 * - Dip: negative down, from -90 (vertical down) to 0 (level). Positive dips
 *   are rejected: surface holes only.
 * - Azimuth: grid, 0-360 clockwise from grid north ("Grid azi"). No declination.
 * - Lift: degrees per 100 m down the hole; positive flattens (dip towards 0).
 * - Drift: degrees per 100 m down the hole; positive turns clockwise.
 * - A trace is integrated in 1 m steps with constant lift and drift (the dip
 *   and azimuth change linearly with depth), with a fractional last step so
 *   that the end moves continuously with the length, and its stations are
 *   joined by minimum curvature.
 * - Vertical (dip exactly -90): the azimuth is undefined there. It is HELD while
 *   the hole is exactly vertical (drift does not build up), so lift starting
 *   from vertical flattens the hole towards its entered azimuth, and drift
 *   takes effect from the first step off vertical. A vertical hole with no lift
 *   stays vertical whatever its drift.
 * - Going up the hole (back-projection) the same rates run backwards: the dip
 *   steepens by the lift rate and the azimuth turns back by the drift rate.
 */
import type { Topography } from './drillholePlanTopo';

export type Vec3 = [number, number, number];

/** Integration step (m) */
export const PLAN_STEP = 1;
/** How close a solved hole must come to its target or collar (m) */
export const PLAN_TOLERANCE = 0.01;

export const PLAN_DEFAULTS = {
    /** A solved lift or drift above this (degrees / 100 m) is warned about */
    liftLimit: 5,
    /** Topography vs existing collars (or a typed collar RL) further apart than this (m) is warned about */
    rlTolerance: 20,
    /** Back-projection to the surface stops after this length (m) */
    maxBackLength: 2000,
    /** Existing collars within this distance (m, in plan) are compared with the topography */
    datumRadius: 500,
};

const RAD = Math.PI / 180;
/** Angles within this of a limit count as on it (degrees) */
const ANGLE_EPS = 1e-9;

export const normAzi = (a: number) => {
    const v = ((a % 360) + 360) % 360;
    return v >= 360 - 1e-12 ? 0 : v;
};
/** Signed smallest turn from azimuth a to b (degrees, -180..180) */
export const aziDelta = (a: number, b: number) => ((((b - a) % 360) + 540) % 360) - 180;

/** Unit vector down the hole for a dip / azimuth */
export function direction(dip: number, azi: number): Vec3 {
    const d = dip * RAD, a = azi * RAD;
    return [Math.cos(d) * Math.sin(a), Math.cos(d) * Math.cos(a), Math.sin(d)];
}

/** Dip / azimuth of a direction (azimuth 0 for a vertical one) */
export function anglesOf(v: ArrayLike<number>): { dip: number; azi: number } {
    const h = Math.hypot(v[0], v[1]);
    const len = Math.hypot(h, v[2]);
    if (!(len > 0)) return { dip: -90, azi: 0 };
    return { dip: Math.atan2(v[2], h) / RAD, azi: h > 1e-12 * len ? normAzi(Math.atan2(v[0], v[1]) / RAD) : 0 };
}

/**
 * Minimum-curvature displacement over a step of length `ds` from direction
 * `t1` to `t2` (unit vectors).
 */
export function minCurvatureStep(t1: Vec3, t2: Vec3, ds: number): Vec3 {
    // The dogleg from the chord between the unit vectors (accurate for small angles, unlike acos)
    const chord = Math.hypot(t2[0] - t1[0], t2[1] - t1[1], t2[2] - t1[2]);
    const beta = 2 * Math.asin(Math.min(1, chord / 2));
    const rf = beta < 1e-6 ? 1 + (beta * beta) / 12 : (2 / beta) * Math.tan(beta / 2);
    const h = (ds / 2) * rf;
    return [h * (t1[0] + t2[0]), h * (t1[1] + t2[1]), h * (t1[2] + t2[2])];
}

/** Where a hole is and which way it points (azimuth may be unwrapped) */
export interface Pose {
    p: Vec3;
    dip: number;
    azi: number;
}

export interface Rates {
    /** Degrees / 100 m, positive flattens */
    lift: number;
    /** Degrees / 100 m, positive clockwise */
    drift: number;
}

/** Angles after moving `ds` metres along the hole (`sign` 1 down the hole, -1 up it). */
export function advanceAngles(dip: number, azi: number, rates: Rates, ds: number, sign: 1 | -1): [number, number] {
    const nextDip = dip + (sign * rates.lift * ds) / 100;
    // Exactly vertical: no azimuth to turn, so drift does not build up
    const vertical = Math.abs(dip + 90) < ANGLE_EPS;
    const nextAzi = vertical ? azi : azi + (sign * rates.drift * ds) / 100;
    return [nextDip, nextAzi];
}

/** A trace's stations, measured from where the walk started (depth 0) */
export interface Trace {
    depth: Float64Array;
    dip: Float64Array;
    /** 0-360 */
    azi: Float64Array;
    /** World xyz triples */
    xyz: Float64Array;
}

export interface WalkOptions {
    /** Keep every station (false: only the end, for the solvers) */
    record?: boolean;
    /** Depths that must be stations (e.g. the target) */
    breaks?: number[];
    /** Step length (m; default PLAN_STEP). Longer steps for quick trial holes in searches; constant rates keep them close */
    step?: number;
    /**
     * Called for each step from `a` to `b` (depths `d0` to `d1`): return a
     * fraction 0-1 of the step to stop there (e.g. the topography), or null
     * to carry on.
     */
    onSegment?: (a: Vec3, b: Vec3, d0: number, d1: number) => number | null;
}

export interface WalkResult {
    end: Pose;
    /** Length walked (shorter than asked when onSegment stopped it) */
    length: number;
    stopped: boolean;
    trace: Trace | null;
}

/**
 * Walk `length` metres from `start` with constant lift / drift, down the hole
 * (`sign` 1) or up it (-1), in PLAN_STEP steps on whole metres from the start,
 * plus `breaks`, with a fractional last step.
 */
export function walk(start: Pose, rates: Rates, length: number, sign: 1 | -1, opts: WalkOptions = {}): WalkResult {
    const record = !!opts.record;
    const depth: number[] = [], dips: number[] = [], azis: number[] = [], xyz: number[] = [];
    let p: Vec3 = [...start.p], dip = start.dip, azi = start.azi, d = 0;
    let t = direction(dip, azi);
    const keep = () => {
        if (!record) return;
        depth.push(d); dips.push(dip); azis.push(normAzi(azi)); xyz.push(p[0], p[1], p[2]);
    };
    keep();
    const breaks = (opts.breaks ?? []).filter(b => b > 1e-9 && b < length - 1e-9).sort((a, b) => a - b);
    let bi = 0;
    let stopped = false;
    while (d < length - 1e-12) {
        const stepLen = opts.step ?? PLAN_STEP;
        let next = Math.min((Math.floor(d / stepLen + 1e-9) + 1) * stepLen, length);
        while (bi < breaks.length && breaks[bi] <= d + 1e-9) bi++;
        if (bi < breaks.length && breaks[bi] < next - 1e-9) next = breaks[bi];
        const ds = next - d;
        const [dip2, azi2] = advanceAngles(dip, azi, rates, ds, sign);
        const t2 = direction(dip2, azi2);
        const m = minCurvatureStep(t, t2, ds);
        const p2: Vec3 = [p[0] + sign * m[0], p[1] + sign * m[1], p[2] + sign * m[2]];
        const cut = opts.onSegment ? opts.onSegment(p, p2, d, next) : null;
        if (cut !== null) {
            const f = Math.min(1, Math.max(0, cut));
            p = [p[0] + (p2[0] - p[0]) * f, p[1] + (p2[1] - p[1]) * f, p[2] + (p2[2] - p[2]) * f];
            dip += (dip2 - dip) * f;
            azi += (azi2 - azi) * f;
            d += ds * f;
            keep();
            stopped = true;
            break;
        }
        p = p2; dip = dip2; azi = azi2; t = t2; d = next;
        keep();
    }
    return {
        end: { p, dip, azi }, length: d, stopped,
        trace: record ? { depth: Float64Array.from(depth), dip: Float64Array.from(dips), azi: Float64Array.from(azis), xyz: Float64Array.from(xyz) } : null,
    };
}

/** A hole down from its collar: stations every metre, plus the target depth when given. */
export function forwardTrace(collar: Vec3, dip: number, azi: number, rates: Rates, eoh: number, targetDepth: number | null = null): Trace {
    return walk({ p: collar, dip, azi }, rates, eoh, 1, { record: true, breaks: targetDepth !== null ? [targetDepth] : [] }).trace!;
}

/** Index of the station at a depth (-1 when none is within a millimetre). */
export function stationIndex(trace: Trace, depth: number): number {
    const d = trace.depth;
    let lo = 0, hi = d.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (d[mid] < depth - 1e-6) lo = mid + 1;
        else hi = mid;
    }
    return Math.abs(d[lo] - depth) <= 1e-3 ? lo : -1;
}

/** Position and angles at a depth along a trace (between stations: interpolated). */
export function stationAt(trace: Trace, depth: number): { p: Vec3; dip: number; azi: number } | null {
    const d = trace.depth, n = d.length;
    if (n === 0 || depth < -1e-9 || depth > d[n - 1] + 1e-9) return null;
    const exact = stationIndex(trace, depth);
    if (exact >= 0) return { p: [trace.xyz[exact * 3], trace.xyz[exact * 3 + 1], trace.xyz[exact * 3 + 2]], dip: trace.dip[exact], azi: trace.azi[exact] };
    let i = 0;
    while (i < n - 2 && d[i + 1] < depth) i++;
    const f = (depth - d[i]) / (d[i + 1] - d[i]);
    const x = trace.xyz;
    return {
        p: [x[i * 3] + (x[i * 3 + 3] - x[i * 3]) * f, x[i * 3 + 1] + (x[i * 3 + 4] - x[i * 3 + 1]) * f, x[i * 3 + 2] + (x[i * 3 + 5] - x[i * 3 + 2]) * f],
        dip: trace.dip[i] + (trace.dip[i + 1] - trace.dip[i]) * f,
        azi: normAzi(trace.azi[i] + aziDelta(trace.azi[i], trace.azi[i + 1]) * f),
    };
}

/** The first depth where the dip leaves -90..0 (null: never). */
export function dipOutOfRange(trace: Trace): { depth: number; dip: number } | null {
    for (let i = 0; i < trace.dip.length; i++) {
        const dip = trace.dip[i];
        if (dip < -90 - ANGLE_EPS || dip > ANGLE_EPS) return { depth: trace.depth[i], dip };
    }
    return null;
}

// ---------------------------------------------------------------------------
// Back-projection to the surface
// ---------------------------------------------------------------------------

export type BackResult =
    | { ok: true; collar: Vec3; collarDip: number; collarAzi: number; length: number }
    | { ok: false; code: 'outside-topo' | 'target-above-topo' | 'never-surface' | 'leaves-topo' | 'dip-range'; text: string; depth?: number };

/**
 * Go up the hole from the target (with the hole's direction there) until the
 * topography is first crossed: that point is the collar. Straight holes have
 * no lift or drift.
 */
export function backToSurface(target: Vec3, targetDip: number, targetAzi: number, rates: Rates, topo: Topography, maxLength: number): BackResult {
    const heights = topo.heightsAt(target[0], target[1]);
    if (heights.length === 0) return { ok: false, code: 'outside-topo', text: 'The target is outside the topography\'s extent.' };
    if (heights.every(h => h < target[2])) return { ok: false, code: 'target-above-topo', text: `The target is above the topography (by ${fmt(target[2] - Math.max(...heights), 1)} m).` };
    let problem: Exclude<BackResult, { ok: true }> | null = null;
    const back = walk({ p: target, dip: targetDip, azi: targetAzi }, rates, maxLength, -1, {
        onSegment: (a, b, d0, d1) => {
            const hit = topo.firstHit(a, b);
            if (hit !== null) return hit;
            const dipThere = targetDip - (rates.lift * d1) / 100;
            if (dipThere < -90 - ANGLE_EPS || dipThere > ANGLE_EPS) {
                problem = {
                    ok: false, code: 'dip-range', depth: d1,
                    text: dipThere < -90
                        ? `Going up from the target the dip passes -90 ${fmt(d1, 1)} m above the target: positive lift makes the hole steeper going up${targetDip <= -89.999 ? ', and it is vertical at the target' : ''}. Give a flatter dip at the target, or less lift.`
                        : `Going up from the target the dip passes 0 ${fmt(d1, 1)} m above the target: the hole would turn upwards. Give a steeper dip at the target, or more lift.`,
                };
                return 0;
            }
            if (!topo.inExtent(b[0], b[1])) {
                problem = { ok: false, code: 'leaves-topo', text: `The hole leaves the topography's extent ${fmt(d0, 1)} m above the target, before it reaches the surface.`, depth: d0 };
                return 0;
            }
            return null;
        },
    });
    if (problem) return problem;
    if (!back.stopped) return { ok: false, code: 'never-surface', text: `The hole never reaches the surface within ${fmt(maxLength, 0)} m of the target.` };
    return { ok: true, collar: back.end.p, collarDip: back.end.dip, collarAzi: normAzi(back.end.azi), length: back.length };
}

// ---------------------------------------------------------------------------
// Solving a hole between a collar and a target
// ---------------------------------------------------------------------------

export type GivenPair = 'target-angles' | 'collar-angles' | 'lift-drift';

export interface SolveInput {
    collar: Vec3;
    target: Vec3;
    given: GivenPair;
    /** The two given values: target dip / azi, collar dip / azi, or lift / drift */
    a: number;
    b: number;
}

export interface SolveResult {
    converged: boolean;
    collarDip: number;
    collarAzi: number;
    lift: number;
    drift: number;
    /** Collar to target, along the hole */
    length: number;
    /** How far the best attempt ends from where it should (m) */
    miss: number;
    /** Where the best attempt ends (the target end for forward solves, the collar end for target-angle ones) */
    closest: Vec3;
    iterations: number;
}

const sub = (a: ArrayLike<number>, b: ArrayLike<number>): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (v: ArrayLike<number>) => Math.hypot(v[0], v[1], v[2]);

/** Solve a 3x3 system (Cramer); null when singular. */
function solve3(m: number[][], r: number[]): number[] | null {
    const det = (a: number[][]) => a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
    const d = det(m);
    if (!Number.isFinite(d) || Math.abs(d) < 1e-300) return null;
    return [0, 1, 2].map(k => det(m.map((row, i) => row.map((v, j) => (j === k ? r[i] : v)))) / d);
}

/**
 * Levenberg–Marquardt on three unknowns and three residuals (central
 * differences). `fix` keeps an unknown in its valid range.
 */
export function levenbergMarquardt(f: (u: number[]) => Vec3, u0: number[], steps: number[], tol: number, maxIterations: number, fix: (u: number[]) => number[]) {
    let u = fix(u0), r = f(u), cost = norm(r);
    let lambda = 1e-3, it = 0;
    /** Cost ten iterations ago: stop when it has hardly moved since (stalled far from a solution) */
    let earlier = cost;
    for (; it < maxIterations && cost > tol; it++) {
        if (it > 0 && it % 10 === 0) {
            if (earlier - cost < 1e-3 * earlier) break;
            earlier = cost;
        }
        const J = [0, 1, 2].map(k => {
            const up = [...u], dn = [...u];
            up[k] += steps[k]; dn[k] -= steps[k];
            const a = f(up), b = f(dn);
            return [0, 1, 2].map(i => (a[i] - b[i]) / (2 * steps[k]));
        }); // J[k][i] = d r_i / d u_k
        const A = [0, 1, 2].map(p => [0, 1, 2].map(q => J[p][0] * J[q][0] + J[p][1] * J[q][1] + J[p][2] * J[q][2]));
        const g = [0, 1, 2].map(p => J[p][0] * r[0] + J[p][1] * r[1] + J[p][2] * r[2]);
        let moved = false;
        while (lambda < 1e12) {
            const M = A.map((row, p) => row.map((v, q) => (p === q ? v * (1 + lambda) + 1e-12 : v)));
            const delta = solve3(M, g.map(v => -v));
            if (!delta) { lambda *= 10; continue; }
            const next = fix(u.map((v, k) => v + delta[k]));
            const rn = f(next), cn = norm(rn);
            if (Number.isFinite(cn) && cn < cost) {
                u = next; r = rn; cost = cn;
                lambda = Math.max(lambda / 3, 1e-12);
                moved = true;
                break;
            }
            lambda *= 4;
        }
        if (!moved) break;
    }
    return { u, r, cost, iterations: it };
}

/**
 * The hole between a typed collar and target, with one pair of values given
 * and the other three solved by shooting (start: the straight line).
 */
export function solveToCollar(input: SolveInput, opts: { tolerance?: number; maxIterations?: number } = {}): SolveResult {
    const { collar, target, given, a, b } = input;
    const tol = (opts.tolerance ?? PLAN_TOLERANCE) / 10;
    const maxIt = opts.maxIterations ?? 100;
    const chord = sub(target, collar);
    const L0 = norm(chord);
    const straight = anglesOf(chord);
    // A hole many times longer than the straight line is no answer (and slow to try)
    const maxLength = 5 * L0 + 1000;
    const fixLength = (u: number[]) => [u[0], u[1], Math.min(Math.max(u[2], 1e-3), maxLength)];
    const steps = [1e-4, 1e-4, 1e-4];

    if (given === 'target-angles') {
        // Backwards from the target in its given direction; unknowns lift, drift, length
        const run = (u: number[]) => walk({ p: target, dip: a, azi: b }, { lift: u[0], drift: u[1] }, u[2], -1);
        const u0 = [((a - straight.dip) * 200) / L0, (aziDelta(straight.azi, b) * 200) / L0, L0];
        const best = levenbergMarquardt(u => sub(run(u).end.p, collar), u0, steps, tol, maxIt, fixLength);
        const end = run(best.u).end;
        return {
            converged: best.cost <= (opts.tolerance ?? PLAN_TOLERANCE), collarDip: end.dip, collarAzi: normAzi(end.azi),
            lift: best.u[0], drift: best.u[1], length: best.u[2], miss: best.cost, closest: end.p, iterations: best.iterations,
        };
    }
    if (given === 'collar-angles') {
        // Forwards from the collar; unknowns lift, drift, length
        const run = (u: number[]) => walk({ p: collar, dip: a, azi: b }, { lift: u[0], drift: u[1] }, u[2], 1);
        const u0 = [((straight.dip - a) * 200) / L0, (aziDelta(b, straight.azi) * 200) / L0, L0];
        const best = levenbergMarquardt(u => sub(run(u).end.p, target), u0, steps, tol, maxIt, fixLength);
        return {
            converged: best.cost <= (opts.tolerance ?? PLAN_TOLERANCE), collarDip: a, collarAzi: normAzi(b),
            lift: best.u[0], drift: best.u[1], length: best.u[2], miss: best.cost, closest: run(best.u).end.p, iterations: best.iterations,
        };
    }
    // Lift and drift given: forwards; unknowns collar dip, collar azimuth, length
    const rates = { lift: a, drift: b };
    const run = (u: number[]) => walk({ p: collar, dip: u[0], azi: u[1] }, rates, u[2], 1);
    const u0 = [straight.dip - (a * L0) / 200, straight.azi - (b * L0) / 200, L0];
    const best = levenbergMarquardt(u => sub(run(u).end.p, target), u0, steps, tol, maxIt, fixLength);
    return {
        converged: best.cost <= (opts.tolerance ?? PLAN_TOLERANCE), collarDip: best.u[0], collarAzi: normAzi(best.u[1]),
        lift: a, drift: b, length: best.u[2], miss: best.cost, closest: run(best.u).end.p, iterations: best.iterations,
    };
}

// ---------------------------------------------------------------------------
// One planned hole, from what was typed
// ---------------------------------------------------------------------------

export type CollarMethod = 'surface-straight' | 'surface-curved' | GivenPair;

export interface PlanPoint {
    e: number | null;
    n: number | null;
    rl: number | null;
}

/** What the user entered for one hole */
export interface HoleInput {
    name: string;
    /** By collar, or by target */
    mode: 'collar' | 'target' | 'wedge';
    collar: PlanPoint;
    /** Take the collar RL from the topography */
    rlFromTopo: boolean;
    /** Collar dip / azimuth (by collar; by target when they are the given pair) */
    dip: number | null;
    azi: number | null;
    lift: number | null;
    drift: number | null;
    /** End of hole (by collar) */
    eoh: number | null;
    target: PlanPoint;
    method: CollarMethod;
    /** Dip / azimuth at the target (project to surface, or the given pair) */
    targetDip: number | null;
    targetAzi: number | null;
    /** Metres drilled past the target */
    extension: number | null;
    /** The existing drillhole whose collar the collar was taken from (for display; the collar is in `collar`) */
    collarHole?: string | null;
    /** Wedges: the parent hole (a planned hole by its internal id, an existing drillhole, or a name still to be matched) */
    parent?: WedgeParent | null;
    /** Wedges: the largest kick the wedge may give (degrees) */
    kickMax?: number | null;
    /** Wedges: the kick-off depth chosen (null: picked by the balance) */
    kopDepth?: number | null;
    /** Wedges: lift and drift solved (nearest the parent's; the default) or as typed */
    ratesMode?: 'solve' | 'fixed';
    /** Wedges, solved rates: 0 rates nearest the parent's … 1 the deepest kick-off */
    balance?: number | null;
    /** Wedges, solved rates: this hole's own lift / drift limits (null: the planner's defaults) */
    rateLimits?: RateLimits | null;
    /** The target point's own ID, when the hole was renamed (wedges) */
    fromTarget?: string | null;
    /** The pad the collar was snapped to */
    collarPad?: string | null;
}

export type IssueCode =
    | 'missing' | 'bad-input' | 'no-topo' | 'dip-range' | 'never-surface' | 'leaves-topo' | 'outside-topo' | 'target-above-topo'
    | 'no-converge' | 'target-above-collar' | 'same-point'
    | 'lift-limit' | 'drift-limit' | 'turn' | 'flat-topo' | 'id-exists' | 'outside-extent' | 'rl-datum' | 'collar-rl' | 'closed-topo' | 'off-section'
    | 'no-parent' | 'no-wedge' | 'kop-moved' | 'wedge-ranges';

/** The lift and drift (°/100 m) a wedge daughter may take when its rates are solved: each from its min to its max */
export interface RateLimits { liftMin: number; liftMax: number; driftMin: number; driftMax: number }

/** A wedge's parent: a planned hole (by its internal id), an existing drillhole, or a Hole ID still to be matched (an import) */
export type WedgeParent = { kind: 'planned'; id: string } | { kind: 'existing'; name: string } | { kind: 'name'; name: string };

/** What was worked out for a wedge */
export interface WedgeInfo {
    parentName: string;
    /** Kick-off depth on the parent (m) */
    kop: number;
    kopPoint: Vec3;
    /** Wedge deflection (degrees) and its direction from the high side, clockwise (degrees) */
    kick: number;
    toolface: number;
    kickMax: number;
    /** Kick-off to target, along the daughter (m) */
    length: number;
    /** Every viable kick-off depth, as ranges (every 5 m) */
    ranges: [number, number][];
    deepest: number;
    /** Solved rates: at each kick-off tried, the lift / drift / kick that reach the target (for the chart) */
    profile?: WedgeProfilePoint[];
    /** The parent's own lift / drift (what solved rates keep near) */
    parentRates?: { lift: number; drift: number };
    /** Solved rates: the lift / drift limits used, and whether they are the hole's own */
    limits?: RateLimits;
    ownLimits?: boolean;
}

export interface WedgeProfilePoint {
    kop: number;
    lift: number;
    drift: number;
    kick: number;
    /** Within the kick and rate limits */
    feasible: boolean;
    /** Reaches the target only with lift / drift beyond the limits (what a failing wedge would need) */
    beyond?: boolean;
}

/** One change that would let a failing wedge reach its target */
export interface WedgeOption {
    change: 'liftMax' | 'liftMin' | 'driftMax' | 'driftMin' | 'rates' | 'kick';
    /** The hole's limits with the change (rate changes) */
    limits?: RateLimits;
    /** The largest kick (a kick change) */
    kickMax?: number;
    /** The kick-offs that would then work */
    ranges: [number, number][];
    text: string;
}

/** A wedge no kick-off works for: what each kick-off would need, and the smallest changes that would do */
export interface WedgeAdvice {
    /** Every kick-off that reaches the target with wider rates (each `beyond` the limits) */
    profile: WedgeProfilePoint[];
    parentRates: { lift: number; drift: number };
    limits: RateLimits;
    /** Smallest change first; empty when even much wider rates and the kick can't reach */
    options: WedgeOption[];
}

/** A hole whose direction turns by more than this from collar to end of hole (degrees) is warned about */
export const MAX_TURN = 90;

/** The angle (degrees) between a trace's direction at its collar and at its end */
export function totalTurn(trace: Trace): number {
    const n = trace.dip.length;
    if (n < 2) return 0;
    const a = direction(trace.dip[0], trace.azi[0]), b = direction(trace.dip[n - 1], trace.azi[n - 1]);
    return (Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180) / Math.PI;
}

export interface PlanIssue {
    level: 'error' | 'warning';
    code: IssueCode;
    text: string;
    /** Down-hole depth it refers to, when there is one */
    depth?: number;
}

export interface PlanContext {
    /** The hole's topography (null: none chosen) */
    topo: Topography | null;
    /** Hole IDs already in the dataset */
    existingIds?: ReadonlySet<string> | null;
    /** Existing collars, xyz triples */
    existingCollars?: ArrayLike<number> | null;
    /** The data's extent (world) */
    dataBounds?: { min: ArrayLike<number>; max: ArrayLike<number> } | null;
    liftLimit?: number;
    rlTolerance?: number;
    maxBackLength?: number;
    datumRadius?: number;
}

export interface PlanResult {
    /** No errors: the trace is drawn */
    ok: boolean;
    collar: Vec3 | null;
    collarDip: number | null;
    collarAzi: number | null;
    lift: number | null;
    drift: number | null;
    /** Lift / drift were solved (not typed) */
    solvedRates: boolean;
    target: Vec3 | null;
    targetDip: number | null;
    targetAzi: number | null;
    targetDepth: number | null;
    eoh: number | null;
    trace: Trace | null;
    issues: PlanIssue[];
    /** A solve that did not converge: its closest approach */
    miss: { distance: number; closest: Vec3 } | null;
    /** A wedge: its kick-off on the parent */
    wedge?: WedgeInfo | null;
    /** A wedge that can't be made (solved rates): what would let it reach its target */
    wedgeAdvice?: WedgeAdvice | null;
}

export const fmt = (v: number, dp: number) => (Object.is(Math.round(v * 10 ** dp) / 10 ** dp, -0) ? 0 : v).toFixed(dp);
const has = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v);

export const METHOD_LABELS: Record<CollarMethod, string> = {
    'surface-straight': 'Target to surface, straight',
    'surface-curved': 'Target to surface',
    'target-angles': 'Collar to target, given target dip/azi',
    'collar-angles': 'Collar to target, given collar dip/azi',
    'lift-drift': 'Collar to target',
};

/** The three ways of planning a hole, as the panel offers them (and wedges, made in the wedge designer) */
export type PlanOption = 'collar' | 'surface' | 'collar-target' | 'wedge';

export const OPTION_LABELS: Record<Exclude<PlanOption, 'wedge'>, string> = {
    collar: 'By collar',
    surface: 'Target to surface',
    'collar-target': 'Collar to target',
};

export function optionOf(input: Pick<HoleInput, 'mode' | 'method'>): PlanOption {
    if (input.mode === 'collar') return 'collar';
    if (input.mode === 'wedge') return 'wedge';
    return input.method === 'surface-straight' || input.method === 'surface-curved' ? 'surface' : 'collar-target';
}

/**
 * The inputs for another way of planning the same hole. A hole that was
 * worked out carries over as it is (its collar, angles, rates, target and
 * depths fill the new option's fields), so switching does not lose it.
 */
export function withOption(input: HoleInput, option: PlanOption, result?: PlanResult | null): Partial<HoleInput> {
    if (option === 'wedge') return { mode: 'wedge' };
    // Leaving a wedge: it stops being one (its parent link goes)
    const leave: Partial<HoleInput> = input.mode === 'wedge' ? { parent: null, kopDepth: null } : {};
    const base: Partial<HoleInput> = option === 'collar' ? { ...leave, mode: 'collar' }
        : option === 'surface' ? { ...leave, mode: 'target', method: 'surface-curved' }
            : { ...leave, mode: 'target', method: input.mode === 'target' && (input.method === 'target-angles' || input.method === 'collar-angles') ? input.method : 'lift-drift' };
    const r = result;
    if (!r || !r.ok || !r.trace || !r.collar || r.eoh === null || input.mode === 'wedge') return base;
    const at = (p: Vec3) => ({ e: p[0], n: p[1], rl: p[2] });
    const round = (v: number | null, dp: number) => (v === null ? null : Math.round(v * 10 ** dp) / 10 ** dp);
    // A hole planned by collar has no target: its end of hole is taken
    const end = stationAt(r.trace, r.targetDepth ?? r.eoh)!;
    const target = r.target ?? end.p;
    const rates = { lift: round(r.lift, 4), drift: round(r.drift, 4) };
    if (option === 'collar') {
        return { ...base, collar: input.rlFromTopo ? { ...at(r.collar), rl: input.collar.rl } : at(r.collar), dip: round(r.collarDip, 4), azi: round(r.collarAzi, 4), eoh: round(r.eoh, 3), ...rates };
    }
    if (option === 'surface') {
        return { ...base, target: at(target), targetDip: round(r.targetDip ?? end.dip, 4), targetAzi: round(r.targetAzi ?? end.azi, 4), ...rates, extension: round(r.eoh - (r.targetDepth ?? r.eoh), 3) };
    }
    return {
        ...base, collar: input.rlFromTopo ? { ...at(r.collar), rl: input.collar.rl } : at(r.collar), target: at(target), ...rates,
        targetDip: round(r.targetDip ?? end.dip, 4), targetAzi: round(r.targetAzi ?? end.azi, 4), dip: round(r.collarDip, 4), azi: round(r.collarAzi, 4),
        extension: round(r.eoh - (r.targetDepth ?? r.eoh), 3),
    };
}

/** Work out one hole from its inputs: its trace, solved values, errors and warnings. */
export function planHole(input: HoleInput, ctx: PlanContext): PlanResult {
    const out: PlanResult = {
        ok: false, collar: null, collarDip: null, collarAzi: null, lift: null, drift: null, solvedRates: false,
        target: null, targetDip: null, targetAzi: null, targetDepth: null, eoh: null, trace: null, issues: [], miss: null,
    };
    const err = (code: IssueCode, text: string, depth?: number) => { out.issues.push({ level: 'error', code, text, ...(depth !== undefined ? { depth } : {}) }); };
    const warn = (code: IssueCode, text: string, depth?: number) => { out.issues.push({ level: 'warning', code, text, ...(depth !== undefined ? { depth } : {}) }); };
    const topo = ctx.topo;
    let topoUsed = false;
    let rlTyped = false;

    if (ctx.existingIds?.has(input.name.trim())) warn('id-exists', `Hole ID ${input.name.trim()} is already a drillhole in the dataset.`);
    // Wedges are worked out from their parent (drillholePlanWedge.planWedge)
    if (input.mode === 'wedge') { err('no-parent', 'A wedge is worked out from its parent hole.'); return finish(); }

    const missing: string[] = [];
    const need = (v: number | null, label: string) => { if (!has(v)) missing.push(label); return v as number; };
    const checkDip = (v: number | null, label: string) => {
        if (has(v) && (v < -90 || v > 0)) { err('bad-input', `${label} must be between -90 and 0 (negative down; surface holes only).`); return false; }
        return true;
    };
    /** The collar from the inputs; its RL from the topography when asked */
    const typedCollar = (): Vec3 | null => {
        const e = need(input.collar.e, 'collar E'), n = need(input.collar.n, 'collar N');
        if (input.rlFromTopo) {
            if (!topo) { err('no-topo', 'Choose a topography to take the collar RL from.'); return null; }
            if (!has(e) || !has(n)) return null;
            topoUsed = true;
            const h = topo.topAt(e, n);
            if (h === null) { err('outside-topo', 'The collar is outside the topography\'s extent: no RL there.'); return null; }
            return [e, n, h];
        }
        const rl = need(input.collar.rl, 'collar RL');
        rlTyped = true;
        return has(e) && has(n) && has(rl) ? [e, n, rl] : null;
    };
    const lift = has(input.lift) ? input.lift : 0;
    const drift = has(input.drift) ? input.drift : 0;
    const extension = has(input.extension) ? input.extension : 0;
    if (extension < 0) err('bad-input', 'The extension past the target cannot be negative.');

    let collar: Vec3 | null = null, collarDip = 0, collarAzi = 0, targetDepth: number | null = null, eoh = 0;
    let rates: Rates = { lift, drift };

    if (input.mode === 'collar') {
        collar = typedCollar();
        need(input.dip, 'dip'); need(input.azi, 'azimuth'); need(input.eoh, 'hole depth (EOH)');
        if (missing.length) { err('missing', `Missing: ${missing.join(', ')}.`); return finish(); }
        if (!checkDip(input.dip, 'Dip')) return finish();
        if (input.eoh! <= 0) { err('bad-input', 'The hole depth (EOH) must be more than 0.'); return finish(); }
        if (!collar) return finish();
        collarDip = input.dip!; collarAzi = normAzi(input.azi!); eoh = input.eoh!;
    } else {
        const te = need(input.target.e, 'target E'), tn = need(input.target.n, 'target N'), trl = need(input.target.rl, 'target RL');
        const target: Vec3 | null = has(te) && has(tn) && has(trl) ? [te, tn, trl] : null;
        out.target = target;
        if (input.method === 'surface-straight' || input.method === 'surface-curved') {
            need(input.targetDip, 'target dip'); need(input.targetAzi, 'target azimuth');
            if (input.method === 'surface-straight') rates = { lift: 0, drift: 0 };
            if (missing.length) { err('missing', `Missing: ${missing.join(', ')}.`); return finish(); }
            if (!checkDip(input.targetDip, 'Target dip')) return finish();
            if (!topo) { err('no-topo', 'Choose a topography to project the hole to the surface.'); return finish(); }
            topoUsed = true;
            const back = backToSurface(target!, input.targetDip!, input.targetAzi!, rates, topo, ctx.maxBackLength ?? PLAN_DEFAULTS.maxBackLength);
            if (!back.ok) { err(back.code, back.text); return finish(); }
            collar = back.collar; collarDip = back.collarDip; collarAzi = back.collarAzi; targetDepth = back.length;
        } else {
            collar = typedCollar();
            const pair = input.method === 'target-angles' ? [input.targetDip, input.targetAzi, 'target dip', 'target azimuth']
                : input.method === 'collar-angles' ? [input.dip, input.azi, 'collar dip', 'collar azimuth']
                    : [input.lift, input.drift, 'lift', 'drift'];
            need(pair[0] as number | null, pair[2] as string); need(pair[1] as number | null, pair[3] as string);
            if (missing.length) { err('missing', `Missing: ${missing.join(', ')}.`); return finish(); }
            if (input.method === 'target-angles' && !checkDip(input.targetDip, 'Target dip')) return finish();
            if (input.method === 'collar-angles' && !checkDip(input.dip, 'Collar dip')) return finish();
            if (!collar || !target) return finish();
            out.collar = collar;
            if (norm(sub(target, collar)) < PLAN_TOLERANCE) { err('same-point', 'The collar and the target are the same point.'); return finish(); }
            if (target[2] >= collar[2]) { err('target-above-collar', `The target is above the collar (by ${fmt(target[2] - collar[2], 1)} m).`); return finish(); }
            const solved = solveToCollar({ collar, target, given: input.method, a: pair[0] as number, b: pair[1] as number });
            if (!solved.converged) {
                out.miss = { distance: solved.miss, closest: solved.closest };
                err('no-converge', `The solver did not converge: its closest attempt misses the ${input.method === 'target-angles' ? 'collar' : 'target'} by ${fmt(solved.miss, 2)} m. Try other values, or another pair.`);
                return finish();
            }
            collarDip = solved.collarDip; collarAzi = solved.collarAzi; targetDepth = solved.length;
            rates = { lift: solved.lift, drift: solved.drift };
            out.solvedRates = input.method !== 'lift-drift';
        }
        eoh = targetDepth! + extension;
    }

    out.collar = collar; out.collarDip = collarDip; out.collarAzi = collarAzi;
    out.lift = rates.lift; out.drift = rates.drift; out.targetDepth = targetDepth; out.eoh = eoh;
    const trace = forwardTrace(collar!, collarDip, collarAzi, rates, eoh, targetDepth);
    const bad = dipOutOfRange(trace);
    if (bad) {
        err('dip-range', `The dip passes ${bad.dip < -90 ? '-90' : '0'} at ${fmt(bad.depth, 1)} m down the hole.`, bad.depth);
        return finish();
    }
    if (targetDepth !== null) {
        const at = stationAt(trace, targetDepth);
        if (at) {
            out.targetDip = at.dip; out.targetAzi = at.azi;
            // A hole projected to the surface or solved ends on its target; check it does
            if (out.target && norm(sub(at.p, out.target)) > PLAN_TOLERANCE) {
                out.miss = { distance: norm(sub(at.p, out.target)), closest: at.p };
                err('no-converge', `The hole misses its target by ${fmt(out.miss.distance, 3)} m.`);
                return finish();
            }
        }
    }
    out.trace = trace;
    return finish();

    function finish(): PlanResult {
        // Warnings that need a hole
        const limit = ctx.liftLimit ?? PLAN_DEFAULTS.liftLimit;
        if (out.solvedRates && has(out.lift) && Math.abs(out.lift) > limit) warn('lift-limit', `The solved lift, ${fmt(out.lift, 2)}°/100 m, is over the limit of ${limit}°/100 m.`);
        if (out.solvedRates && has(out.drift) && Math.abs(out.drift) > limit) warn('drift-limit', `The solved drift, ${fmt(out.drift, 2)}°/100 m, is over the limit of ${limit}°/100 m.`);
        if (topoUsed && topo) {
            if (topo.kind === 'flat') warn('flat-topo', `The topography is a flat RL (${fmt(topo.flatRl ?? 0, 1)}): the collar is rough.`);
            if (topo.closed) warn('closed-topo', `The topography ${topo.name} looks like a closed solid, not a surface.`);
        }
        const tol = ctx.rlTolerance ?? PLAN_DEFAULTS.rlTolerance;
        const c = out.collar;
        if (topo && c && topo.kind === 'mesh') {
            // A typed collar RL far from the topography there
            const h = rlTyped ? topo.topAt(c[0], c[1]) : null;
            if (h !== null && Math.abs(c[2] - h) > tol) {
                warn('collar-rl', `The collar RL is ${fmt(Math.abs(c[2] - h), 1)} m ${c[2] > h ? 'above' : 'below'} the topography there: check the RL datum.`);
            }
            // The topography against the existing collars nearby (a different RL datum would put every collar in the wrong place)
            const datum = datumCheck(topo, c, ctx.existingCollars ?? null, ctx.datumRadius ?? PLAN_DEFAULTS.datumRadius);
            if (datum && Math.abs(datum.median) > tol) {
                warn('rl-datum', `The topography is ${fmt(Math.abs(datum.median), 1)} m ${datum.median > 0 ? 'above' : 'below'} the collars of ${datum.count} existing hole${datum.count === 1 ? '' : 's'} within ${ctx.datumRadius ?? PLAN_DEFAULTS.datumRadius} m: check it is in the same RL datum.`);
            }
        }
        if (out.trace) {
            // Other solutions exist only for holes that curl round: not one to drill
            const turn = totalTurn(out.trace);
            if (turn > MAX_TURN) warn('turn', `The hole turns by ${fmt(turn, 0)}° from collar to end of hole: check the lift and drift.`);
            const outside = outsideExtents(out.trace, topoUsed ? topo : null, ctx.dataBounds ?? null);
            if (outside !== null) warn('outside-extent', `Part of the hole runs outside the topography and the data (from ${fmt(outside, 1)} m down the hole).`, outside);
        }
        out.ok = !out.issues.some(i => i.level === 'error');
        if (!out.ok) out.trace = null;
        return out;
    }
}

/** Median of (topography − collar RL) over the existing collars within `radius` (null: none there, or none on the topography). */
export function datumCheck(topo: Topography, at: ArrayLike<number>, collars: ArrayLike<number> | null, radius: number): { median: number; count: number } | null {
    if (!collars) return null;
    const diffs: number[] = [];
    for (let i = 0; i + 2 < collars.length; i += 3) {
        const x = collars[i], y = collars[i + 1], z = collars[i + 2];
        if (Math.hypot(x - at[0], y - at[1]) > radius) continue;
        const h = topo.topAt(x, y);
        if (h !== null) diffs.push(h - z);
    }
    if (diffs.length === 0) return null;
    diffs.sort((a, b) => a - b);
    const m = diffs.length >> 1;
    return { median: diffs.length % 2 ? diffs[m] : (diffs[m - 1] + diffs[m]) / 2, count: diffs.length };
}

/** The first depth where the trace is outside both the topography's and the data's extent in plan (null: never, or no extents). */
export function outsideExtents(trace: Trace, topo: Topography | null, data: { min: ArrayLike<number>; max: ArrayLike<number> } | null): number | null {
    if (!topo && !data) return null;
    for (let i = 0; i < trace.depth.length; i++) {
        const x = trace.xyz[i * 3], y = trace.xyz[i * 3 + 1];
        const inTopo = topo ? topo.inExtent(x, y) : false;
        const inData = data ? x >= data.min[0] && x <= data.max[0] && y >= data.min[1] && y <= data.max[1] : false;
        if (!inTopo && !inData) return trace.depth[i];
    }
    return null;
}

// ---------------------------------------------------------------------------
// Surveys (import check)
// ---------------------------------------------------------------------------

export interface SurveyStation {
    depth: number;
    dip: number;
    azi: number;
}

/**
 * Positions of survey stations from a collar: the angles are taken as
 * changing linearly between stations (as they do in a planned hole) and
 * integrated in 1 m steps by minimum curvature.
 */
export function desurvey(collar: Vec3, stations: readonly SurveyStation[]): Vec3[] {
    const s = [...stations].sort((a, b) => a.depth - b.depth);
    const out: Vec3[] = [];
    if (s.length === 0) return out;
    let p: Vec3 = [...collar];
    // A first station below the collar: straight up to the collar in its direction
    if (s[0].depth > 0) {
        const t = direction(s[0].dip, s[0].azi);
        p = [p[0] + t[0] * s[0].depth, p[1] + t[1] * s[0].depth, p[2] + t[2] * s[0].depth];
    }
    out.push([...p]);
    for (let k = 1; k < s.length; k++) {
        const a = s[k - 1], b = s[k];
        const len = b.depth - a.depth;
        const turn = aziDelta(a.azi, b.azi);
        const at = (d: number): [number, number] => {
            const f = len > 0 ? (d - a.depth) / len : 1;
            return [a.dip + (b.dip - a.dip) * f, a.azi + turn * f];
        };
        let d = a.depth;
        let [dip, azi] = at(d);
        let t = direction(dip, azi);
        while (d < b.depth - 1e-12) {
            const next = Math.min((Math.floor(d / PLAN_STEP + 1e-9) + 1) * PLAN_STEP, b.depth);
            [dip, azi] = at(next);
            const t2 = direction(dip, azi);
            const m = minCurvatureStep(t, t2, next - d);
            p = [p[0] + m[0], p[1] + m[1], p[2] + m[2]];
            t = t2; d = next;
        }
        out.push([...p]);
    }
    return out;
}
