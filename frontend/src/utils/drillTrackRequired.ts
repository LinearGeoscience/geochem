/**
 * Drill tracking: the least lift and drift that bring a hole being drilled
 * within the tolerance of its planned target (pure; unit-tested).
 *
 * The hole is projected from its last survey with constant lift and drift
 * (as every projection is), and measured where it crosses the plane square to
 * the planned hole at the target: high / right of it (drillTrackProjection).
 *
 * - "Least" is the smallest rates: the shortest distance from holding the
 *   last survey's angles (lift 0, drift 0), both being °/100 m. When holding
 *   them already lands within the tolerance, that is the answer (0 / 0).
 * - Otherwise: the rates that hit the target exactly are solved first
 *   (Newton on high / right); then, about them, the rates that put the hole
 *   on the edge of the tolerance circle are found for every direction round
 *   it, and the smallest kept; that point is then solved for exactly (the
 *   projection is not quite linear in the rates), twice. The edge aimed at is
 *   2 % inside the tolerance, so the answer is not flagged by rounding.
 */
import { stationAt, type Rates, type Trace } from './drillholePlan';
import { checkAt, joined, project, type Miss, type PlannedTrack } from './drillTrackProjection';

export interface RequiredRates {
    /** The least lift and drift that land within the tolerance */
    rates: Rates;
    /** The lift and drift that hit the target (null: not found) */
    hit: Rates | null;
    /** How far from the target the least rates land (m) */
    distance: number;
    limit: number;
    /** Holding the last survey already lands within the tolerance */
    holdIsEnough: boolean;
}

/** Aim this far inside the tolerance (a fraction of it) */
const MARGIN = 0.98;

/** Where a projection with these rates crosses the target's plane (null: it does not) */
export function missWith(drilled: Trace, fromDepth: number, plan: PlannedTrack, rates: Rates, beyond = 100): Miss | null {
    if (plan.targetDepth === null) return null;
    const path = project(drilled, fromDepth, rates, Math.max(plan.eoh, fromDepth) + beyond);
    if (!path) return null;
    return checkAt(joined(drilled, path), plan, plan.targetDepth)?.miss ?? null;
}

type V2 = [number, number];
const len2 = (v: V2) => Math.hypot(v[0], v[1]);

/** The rates whose miss is `goal` (high, right), from `start`; null when not reached */
function solveTo(f: (r: V2) => V2 | null, goal: V2, start: V2, tol = 0.01): V2 | null {
    let r: V2 = [...start];
    let m = f(r);
    if (!m) return null;
    let res: V2 = [m[0] - goal[0], m[1] - goal[1]];
    for (let it = 0; it < 40 && len2(res) > tol; it++) {
        const J = jacobian(f, r);
        if (!J) return null;
        const step = solve2(J, [-res[0], -res[1]]);
        if (!step) return null;
        let k = 1, moved = false;
        for (let tries = 0; tries < 12; tries++, k /= 2) {
            const next: V2 = [r[0] + k * step[0], r[1] + k * step[1]];
            const mn = f(next);
            if (!mn) continue;
            const rn: V2 = [mn[0] - goal[0], mn[1] - goal[1]];
            if (len2(rn) < len2(res)) { r = next; res = rn; moved = true; break; }
        }
        if (!moved) break;
    }
    return len2(res) <= Math.max(tol, 0.05) ? r : null;
}

/** d(miss)/d(rates) by central differences: [[dh/dlift, dh/ddrift], [dr/dlift, dr/ddrift]] */
function jacobian(f: (r: V2) => V2 | null, r: V2, h = 0.02): [V2, V2] | null {
    const a = f([r[0] + h, r[1]]), b = f([r[0] - h, r[1]]), c = f([r[0], r[1] + h]), d = f([r[0], r[1] - h]);
    if (!a || !b || !c || !d) return null;
    return [[(a[0] - b[0]) / (2 * h), (c[0] - d[0]) / (2 * h)], [(a[1] - b[1]) / (2 * h), (c[1] - d[1]) / (2 * h)]];
}

function solve2(J: [V2, V2], b: V2): V2 | null {
    const det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
    if (!(Math.abs(det) > 1e-12)) return null;
    return [(b[0] * J[1][1] - J[0][1] * b[1]) / det, (J[0][0] * b[1] - b[0] * J[1][0]) / det];
}

/**
 * The least lift and drift (from the last survey, at `fromDepth`) that bring
 * the hole within `limit` metres of its planned target. Null when the plan
 * has no target or no rates reach it.
 */
export function requiredRates(drilled: Trace, fromDepth: number, plan: PlannedTrack, limit: number): RequiredRates | null {
    if (plan.targetDepth === null || !stationAt(plan.trace, Math.min(plan.targetDepth, plan.eoh))) return null;
    const f = (r: V2): V2 | null => { const m = missWith(drilled, fromDepth, plan, { lift: r[0], drift: r[1] }); return m ? [m.high, m.right] : null; };
    const m0 = f([0, 0]);
    const hit = solveTo(f, [0, 0], [0, 0]);
    const asRates = (r: V2): Rates => ({ lift: r[0], drift: r[1] });
    if (m0 && len2(m0) <= limit) {
        return { rates: { lift: 0, drift: 0 }, hit: hit ? asRates(hit) : null, distance: len2(m0), limit, holdIsEnough: true };
    }
    if (!hit) return null;
    const aim = MARGIN * limit;
    let r: V2 = hit;
    for (let pass = 0; pass < 2; pass++) {
        const J = jacobian(f, r), m = f(r);
        if (!J || !m) break;
        // Round the tolerance circle: the rates (linearised about r) that land on it, the smallest of them
        let best: { r: V2; u: V2 } | null = null;
        for (let deg = 0; deg < 360; deg += 1) {
            const u: V2 = [aim * Math.cos(deg * Math.PI / 180), aim * Math.sin(deg * Math.PI / 180)];
            const d = solve2(J, [u[0] - m[0], u[1] - m[1]]);
            if (!d) continue;
            const cand: V2 = [r[0] + d[0], r[1] + d[1]];
            if (!best || len2(cand) < len2(best.r)) best = { r: cand, u };
        }
        if (!best) break;
        const exact = solveTo(f, best.u, best.r);
        if (!exact) break;
        r = exact;
    }
    const m = f(r);
    if (!m || len2(m) > limit) return null;
    return { rates: asRates(r), hit: asRates(hit), distance: len2(m), limit, holdIsEnough: false };
}
