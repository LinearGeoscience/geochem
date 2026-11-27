/**
 * Drillhole planner: wedges (pure, unit-tested).
 *
 * A daughter hole leaves its parent at a kick-off depth (KOP), set off by a
 * wedge. It starts in the parent's direction there, turned by a small kick
 * (the wedge's deflection, in a direction the driller sets: the toolface),
 * then runs on with its own constant lift and drift to its target.
 *
 * With the lift and drift given there are three unknowns for the three
 * coordinates of the target at each kick-off depth: the kick (two numbers:
 * up / right of the parent's direction) and the daughter's length. Solved at
 * every 5 m down the parent, a depth is viable when the kick needed is at or
 * under the wedge's maximum and the daughter's dip stays within -90..0.
 * Viable depths usually form one range on a smoothly curving parent; a
 * snaking one can give several. The deepest is the default.
 *
 * A parent is a planned hole's trace, or an existing hole rebuilt from its
 * survey (exact) or from its desurveyed samples (as placed by the import).
 */
import {
    PLAN_TOLERANCE, Rates, SurveyStation, Trace, Vec3, anglesOf, direction, levenbergMarquardt, minCurvatureStep, normAzi, aziDelta,
    stationAt, walk, PLAN_STEP,
} from './drillholePlan';

const RAD = Math.PI / 180;
const sub = (a: ArrayLike<number>, b: ArrayLike<number>): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v: ArrayLike<number>): Vec3 => { const n = Math.hypot(v[0], v[1], v[2]); return [v[0] / n, v[1] / n, v[2] / n]; };
const cross = (a: ArrayLike<number>, b: ArrayLike<number>): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export const WEDGE_DEFAULTS = {
    /** Largest kick a wedge gives (degrees) */
    kickMax: 3,
    /** Kick-off depths are tried every this many metres */
    step: 5,
    /** No kick-off shallower than this (m) */
    minKop: 30,
};

/** A trace from survey stations: the angles change linearly between stations (1 m steps, minimum curvature); straight on past the last one to `eoh`. */
export function traceFromStations(collar: Vec3, stations: readonly SurveyStation[], eoh?: number | null): Trace {
    const s = [...stations].filter(x => Number.isFinite(x.depth) && Number.isFinite(x.dip) && Number.isFinite(x.azi)).sort((a, b) => a.depth - b.depth);
    if (s.length === 0) throw new Error('No survey stations');
    if (s[0].depth > 0) s.unshift({ ...s[0], depth: 0 });
    const end = Math.max(s[s.length - 1].depth, eoh ?? 0);
    if (end > s[s.length - 1].depth) s.push({ ...s[s.length - 1], depth: end });
    const depth: number[] = [0], dips: number[] = [s[0].dip], azis: number[] = [normAzi(s[0].azi)], xyz: number[] = [...collar];
    let p: Vec3 = [...collar];
    for (let k = 1; k < s.length; k++) {
        const a = s[k - 1], b = s[k];
        const len = b.depth - a.depth;
        if (!(len > 0)) continue;
        const turn = aziDelta(a.azi, b.azi);
        const at = (d: number): [number, number] => { const f = (d - a.depth) / len; return [a.dip + (b.dip - a.dip) * f, a.azi + turn * f]; };
        let d = a.depth;
        let t = direction(...at(d));
        while (d < b.depth - 1e-9) {
            const next = Math.min((Math.floor(d / PLAN_STEP + 1e-9) + 1) * PLAN_STEP, b.depth);
            const [dip, azi] = at(next);
            const t2 = direction(dip, azi);
            const m = minCurvatureStep(t, t2, next - d);
            p = [p[0] + m[0], p[1] + m[1], p[2] + m[2]];
            depth.push(next); dips.push(dip); azis.push(normAzi(azi)); xyz.push(...p);
            t = t2; d = next;
        }
    }
    return { depth: Float64Array.from(depth), dip: Float64Array.from(dips), azi: Float64Array.from(azis), xyz: Float64Array.from(xyz) };
}

/**
 * A trace through points down a hole (desurveyed sample places, by depth),
 * from its collar: each station's direction is the way to the next point.
 */
export function traceFromPoints(collar: Vec3, depths: readonly number[], points: readonly Vec3[]): Trace | null {
    const rows = depths.map((d, i) => ({ d, p: points[i] })).filter(r => Number.isFinite(r.d) && r.d > 0.01 && r.p.every(Number.isFinite)).sort((a, b) => a.d - b.d);
    const all = [{ d: 0, p: collar }, ...rows.filter((r, i) => i === 0 || r.d - rows[i - 1].d > 0.01)];
    if (all.length < 2) return null;
    const depth: number[] = [], dips: number[] = [], azis: number[] = [], xyz: number[] = [];
    all.forEach((r, i) => {
        const seg = i + 1 < all.length ? sub(all[i + 1].p, r.p) : sub(r.p, all[i - 1].p);
        const { dip, azi } = anglesOf(seg);
        depth.push(r.d); dips.push(dip); azis.push(azi); xyz.push(...r.p);
    });
    return { depth: Float64Array.from(depth), dip: Float64Array.from(dips), azi: Float64Array.from(azis), xyz: Float64Array.from(xyz) };
}

/** Unit vectors across a hole's direction: high side (up, square to it) and right side */
export function sides(t: Vec3, aziIfVertical: number): { h: Vec3; r: Vec3 } {
    const z: Vec3 = [0, 0, 1];
    const up = sub(z, t.map(v => v * dot(z, t)));
    const h = Math.hypot(...up) > 1e-9 ? unit(up) : direction(0, aziIfVertical);
    return { h, r: unit(cross(t, h)) };
}

export interface WedgeSolution {
    converged: boolean;
    kop: number;
    /** Where the daughter leaves the parent (world) */
    kopPoint: Vec3;
    /** Wedge deflection needed (degrees) */
    kick: number;
    /** Direction of the kick, degrees from the high side, clockwise looking down the hole (90 = right) */
    toolface: number;
    startDip: number;
    startAzi: number;
    /** KOP to target, along the daughter */
    length: number;
    miss: number;
    /** The solver's unknowns, for a warm start at the next depth */
    u: number[];
}

/** The daughter that leaves the parent at `kop` and reaches the target (kick and length solved). */
export function solveWedgeAt(parent: Trace, kop: number, target: Vec3, rates: Rates, warm?: number[] | null): WedgeSolution | null {
    const at = stationAt(parent, kop);
    if (!at) return null;
    const t = direction(at.dip, at.azi);
    const { h, r } = sides(t, at.azi);
    const toTarget = sub(target, at.p);
    const along = dot(toTarget, t);
    if (along <= 0) return null; // the target is behind the kick-off point
    const start = (u: number[]) => anglesOf([t[0] + u[0] * h[0] + u[1] * r[0], t[1] + u[0] * h[1] + u[1] * r[1], t[2] + u[0] * h[2] + u[1] * r[2]]);
    const run = (u: number[]) => { const a = start(u); return walk({ p: at.p, dip: a.dip, azi: a.azi }, rates, u[2], 1); };
    // Start: straight at the target from the kick-off point
    const u0 = warm ?? [dot(toTarget, h) / along, dot(toTarget, r) / along, Math.hypot(...toTarget)];
    const best = levenbergMarquardt(u => sub(run(u).end.p, target), u0, [1e-6, 1e-6, 1e-4], PLAN_TOLERANCE / 10, 60,
        u => [u[0], u[1], Math.min(Math.max(u[2], 1e-3), 5 * Math.hypot(...toTarget) + 500)]);
    const a = start(best.u);
    return {
        converged: best.cost <= PLAN_TOLERANCE, kop, kopPoint: at.p,
        kick: Math.atan(Math.hypot(best.u[0], best.u[1])) / RAD,
        toolface: normAzi(Math.atan2(best.u[1], best.u[0]) / RAD),
        startDip: a.dip, startAzi: a.azi, length: best.u[2], miss: best.cost, u: best.u,
    };
}

export interface WedgeScan {
    /** Kick-off depths (every `step` m) where the wedge works */
    viable: number[];
    /** The same as ranges [from, to] */
    ranges: [number, number][];
    /** The solution at each viable depth */
    at: Map<number, WedgeSolution>;
    /** The smallest kick needed anywhere (degrees), for saying why none works */
    leastKick: number | null;
}

/** Solve the wedge at every `step` m down the parent and keep the depths where it works. */
export function scanWedge(parent: Trace, target: Vec3, rates: Rates, opts: { kickMax: number; step?: number; minKop?: number }): WedgeScan {
    const step = opts.step ?? WEDGE_DEFAULTS.step, minKop = opts.minKop ?? WEDGE_DEFAULTS.minKop;
    const end = parent.depth[parent.depth.length - 1];
    const viable: number[] = [], at = new Map<number, WedgeSolution>();
    let warm: number[] | null = null, leastKick: number | null = null;
    for (let d = Math.ceil(Math.max(minKop, step) / step) * step; d < end - 1e-6; d += step) {
        const s = solveWedgeAt(parent, d, target, rates, warm);
        if (!s || !s.converged) { warm = null; continue; }
        warm = s.u;
        leastKick = leastKick === null ? s.kick : Math.min(leastKick, s.kick);
        const endDip = s.startDip + (rates.lift * s.length) / 100;
        if (s.kick > opts.kickMax + 1e-9 || s.length < 1 || endDip > 0 || endDip < -90 || s.startDip > 0 || s.startDip < -90) continue;
        viable.push(d);
        at.set(d, s);
    }
    const ranges: [number, number][] = [];
    for (const d of viable) {
        const last = ranges[ranges.length - 1];
        if (last && d - last[1] <= step + 1e-6) last[1] = d;
        else ranges.push([d, d]);
    }
    return { viable, ranges, at, leastKick };
}

/** The whole hole: the parent down to the kick-off, then the daughter to its end (stations on the target and EOH). */
export function wedgeTrace(parent: Trace, s: WedgeSolution, rates: Rates, extension: number): Trace {
    const depth: number[] = [], dips: number[] = [], azis: number[] = [], xyz: number[] = [];
    for (let i = 0; i < parent.depth.length && parent.depth[i] < s.kop - 1e-9; i++) {
        depth.push(parent.depth[i]); dips.push(parent.dip[i]); azis.push(parent.azi[i]); xyz.push(parent.xyz[i * 3], parent.xyz[i * 3 + 1], parent.xyz[i * 3 + 2]);
    }
    const d = walk({ p: s.kopPoint, dip: s.startDip, azi: s.startAzi }, rates, s.length + extension, 1, { record: true, breaks: [s.length] }).trace!;
    for (let i = 0; i < d.depth.length; i++) {
        depth.push(s.kop + d.depth[i]); dips.push(d.dip[i]); azis.push(d.azi[i]); xyz.push(d.xyz[i * 3], d.xyz[i * 3 + 1], d.xyz[i * 3 + 2]);
    }
    return { depth: Float64Array.from(depth), dip: Float64Array.from(dips), azi: Float64Array.from(azis), xyz: Float64Array.from(xyz) };
}

/** "120–135, 250–265 m" */
export const rangesText = (ranges: readonly [number, number][]) => ranges.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ') + ' m';

