/**
 * Drillhole planner: wedges with their own lift and drift (pure,
 * unit-tested).
 *
 * The same lift and drift won't reach every daughter's target with a small
 * wedge kick. Here each daughter keeps the parent's lift and drift where that
 * works, and otherwise takes the nearest rates within limits (beyond the
 * parent's the driller steers: navi drilling, slower penetration). At every
 * 5 m down the parent the kick (size and toolface), the daughter's length and
 * its lift and drift are found together: the target hit, the kick at most the
 * maximum and the rates within their limits are musts; rates near the
 * parent's are the preference. The target is then hit exactly with those
 * rates. A balance picks the kick-off: rates nearest the parent's, or the
 * deepest, or between.
 */
import { HoleInput, PlanIssue, PlanResult, RateLimits, Rates, Trace, Vec3, WedgeAdvice, WedgeOption, WedgeProfilePoint, aziDelta, anglesOf, direction, fmt, stationAt, walk } from './drillholePlan';
import { WEDGE_DEFAULTS, WedgeSolution, rangesText, scanWedge, sides, solveWedgeAt, wedgeTrace } from './drillholePlanWedge';

const RAD = Math.PI / 180;
/** Step of the trial holes while searching (m): the answer is then hit exactly in 1 m steps */
const SEARCH_STEP = 10;
const sub = (a: ArrayLike<number>, b: ArrayLike<number>): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export type { RateLimits };
/** Default lift / drift a daughter may take (°/100 m): what the ground usually allows; set per project and per hole */
export const WEDGE_RATE_LIMITS: RateLimits = { liftMin: -2, liftMax: 2, driftMin: -5, driftMax: 5 };

/** What is wrong with a set of limits (null: fine) */
export function limitsProblem(l: RateLimits): string | null {
    const v = [l.liftMin, l.liftMax, l.driftMin, l.driftMax];
    if (!v.every(Number.isFinite)) return 'The lift and drift limits need all four numbers.';
    if (l.liftMin > l.liftMax) return `The lift limits run the wrong way (min ${l.liftMin} above max ${l.liftMax}).`;
    if (l.driftMin > l.driftMax) return `The drift limits run the wrong way (min ${l.driftMin} above max ${l.driftMax}).`;
    return null;
}

const signed = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0');
/** "±2" when symmetric, else "−2 to +5" */
export function rangeText(min: number, max: number): string {
    return min === -max && max > 0 ? `±${max}` : `${signed(min)} to ${signed(max)}`;
}
export const limitsText = (l: RateLimits) => `lift within ${rangeText(l.liftMin, l.liftMax)}, drift within ${rangeText(l.driftMin, l.driftMax)}`;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** How far a rate may move, to scale lift and drift alike (half the allowed range) */
const scales = (l: RateLimits) => ({ lift: Math.max((l.liftMax - l.liftMin) / 2, 0.05), drift: Math.max((l.driftMax - l.driftMin) / 2, 0.05) });

/** A hole's average lift and drift (°/100 m) over its length */
export function averageRates(trace: Trace): Rates {
    const n = trace.depth.length;
    const len = n > 1 ? trace.depth[n - 1] - trace.depth[0] : 0;
    if (!(len > 0)) return { lift: 0, drift: 0 };
    return { lift: ((trace.dip[n - 1] - trace.dip[0]) * 100) / len, drift: (aziDelta(trace.azi[0], trace.azi[n - 1]) * 100) / len };
}

/** Least squares on any number of residuals and unknowns (Levenberg–Marquardt, central differences). */
function leastSquares(f: (u: number[]) => number[], u0: number[], steps: number[], maxIterations: number, fix: (u: number[]) => number[]) {
    const m = u0.length;
    let u = fix(u0), r = f(u);
    let cost = r.reduce((s, v) => s + v * v, 0), lambda = 1e-3;
    const solve = (A: number[][], b: number[]): number[] | null => {
        const M = A.map((row, i) => [...row, b[i]]);
        for (let c = 0; c < m; c++) {
            let p = c;
            for (let i = c + 1; i < m; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
            if (Math.abs(M[p][c]) < 1e-300) return null;
            [M[c], M[p]] = [M[p], M[c]];
            for (let i = 0; i < m; i++) {
                if (i === c) continue;
                const k = M[i][c] / M[c][c];
                for (let j = c; j <= m; j++) M[i][j] -= k * M[c][j];
            }
        }
        return M.map((row, i) => row[m] / row[i]);
    };
    for (let it = 0; it < maxIterations && cost > 1e-10; it++) {
        const J = u.map((_, k) => {
            const up = [...u], dn = [...u];
            up[k] += steps[k]; dn[k] -= steps[k];
            const a = f(up), b = f(dn);
            return a.map((v, i) => (v - b[i]) / (2 * steps[k]));
        }); // J[k][i] = d r_i / d u_k
        const A = J.map(p => J.map(q => p.reduce((s, v, i) => s + v * q[i], 0)));
        const g = J.map(p => p.reduce((s, v, i) => s + v * r[i], 0));
        let moved = false;
        while (lambda < 1e12) {
            const delta = solve(A.map((row, p) => row.map((v, q) => (p === q ? v * (1 + lambda) + 1e-12 : v))), g.map(v => -v));
            if (!delta) { lambda *= 10; continue; }
            const next = fix(u.map((v, k) => v + delta[k]));
            const rn = f(next), cn = rn.reduce((s, v) => s + v * v, 0);
            if (Number.isFinite(cn) && cn < cost) { u = next; r = rn; cost = cn; lambda = Math.max(lambda / 3, 1e-12); moved = true; break; }
            lambda *= 4;
        }
        if (!moved) break;
    }
    return { u, cost };
}

export interface RatedWedge {
    /** Reaches the target with the kick and rates within their limits */
    feasible: boolean;
    sol: WedgeSolution;
    lift: number;
    drift: number;
    /** How far the rates are from the parent's: 0 the same, 1 half the allowed range away (each rate scaled by its range) */
    deviation: number;
}

/**
 * The daughter off `kop` that reaches the target with a kick of at most
 * `kickMax`, with the lift and drift nearest the parent's (`prefer`) within
 * `limits`; then the target hit exactly with those rates.
 */
export function solveRatedWedgeAt(parent: Trace, kop: number, target: Vec3, prefer: Rates, limits: RateLimits, kickMax: number, warm?: number[] | null): RatedWedge | null {
    const at = stationAt(parent, kop);
    if (!at) return null;
    const t = direction(at.dip, at.azi);
    const { h, r } = sides(t, at.azi);
    const toTarget = sub(target, at.p);
    const along = dot(toTarget, t);
    if (along <= 0) return null; // the target is behind the kick-off
    const start = (u: number[]) => anglesOf([t[0] + u[0] * h[0] + u[1] * r[0], t[1] + u[0] * h[1] + u[1] * r[1], t[2] + u[0] * h[2] + u[1] * r[2]]);
    // Musts weigh far more than the preference
    const HIT = 100, OVER = 1000;
    const sc = scales(limits);
    const f = (u: number[]) => {
        const a = start(u);
        const end = walk({ p: at.p, dip: a.dip, azi: a.azi }, { lift: u[3], drift: u[4] }, u[2], 1, { step: SEARCH_STEP }).end.p;
        const kick = Math.atan(Math.hypot(u[0], u[1])) / RAD;
        return [
            (end[0] - target[0]) * HIT, (end[1] - target[1]) * HIT, (end[2] - target[2]) * HIT,
            (u[3] - prefer.lift) / sc.lift, (u[4] - prefer.drift) / sc.drift,
            OVER * Math.max(0, kick - kickMax),
            OVER * Math.max(0, limits.liftMin - u[3], u[3] - limits.liftMax), OVER * Math.max(0, limits.driftMin - u[4], u[4] - limits.driftMax),
        ];
    };
    const reach = Math.hypot(...toTarget);
    const u0 = warm ?? [dot(toTarget, h) / along, dot(toTarget, r) / along, reach, clamp(prefer.lift, limits.liftMin, limits.liftMax), clamp(prefer.drift, limits.driftMin, limits.driftMax)];
    const fit = leastSquares(f, u0, [1e-6, 1e-6, 1e-4, 1e-4, 1e-4], 25, u => [u[0], u[1], Math.min(Math.max(u[2], 1e-3), 5 * reach + 500), u[3], u[4]]);
    const lift = clamp(fit.u[3], limits.liftMin, limits.liftMax);
    const drift = clamp(fit.u[4], limits.driftMin, limits.driftMax);
    // Exactly on the target with those rates
    const sol = solveWedgeAt(parent, kop, target, { lift, drift }, [fit.u[0], fit.u[1], fit.u[2]]);
    if (!sol || !sol.converged) return null;
    const endDip = sol.startDip + (lift * sol.length) / 100;
    const feasible = sol.kick <= kickMax + 0.01 && sol.length >= 1 && sol.startDip <= 0 && sol.startDip >= -90 && endDip <= 0 && endDip >= -90;
    return { feasible, sol, lift, drift, deviation: Math.hypot((lift - prefer.lift) / sc.lift, (drift - prefer.drift) / sc.drift) };
}

export interface RatedScan {
    /** Every kick-off tried that has an answer (feasible or not), shallow to deep */
    profile: (RatedWedge & { kop: number })[];
    viable: number[];
    ranges: [number, number][];
}

/** The rated wedge every `step` m down the parent (each depth starts from the answer above it). */
export function scanRatedWedge(parent: Trace, target: Vec3, prefer: Rates, limits: RateLimits, kickMax: number, opts: { step?: number; minKop?: number } = {}): RatedScan {
    const step = opts.step ?? WEDGE_DEFAULTS.step, minKop = opts.minKop ?? WEDGE_DEFAULTS.minKop;
    const end = parent.depth[parent.depth.length - 1];
    const profile: RatedScan['profile'] = [];
    let warm: number[] | null = null;
    for (let d = Math.ceil(Math.max(minKop, step) / step) * step; d < end - 1e-6; d += step) {
        const w = solveRatedWedgeAt(parent, d, target, prefer, limits, kickMax, warm);
        if (!w) { warm = null; continue; }
        warm = [...w.sol.u, w.lift, w.drift];
        profile.push({ ...w, kop: d });
    }
    const viable = profile.filter(p => p.feasible).map(p => p.kop);
    const ranges: [number, number][] = [];
    for (const d of viable) {
        const last = ranges[ranges.length - 1];
        if (last && d - last[1] <= step + 1e-6) last[1] = d; else ranges.push([d, d]);
    }
    return { profile, viable, ranges };
}

/** How far the advice looks beyond the limits (°/100 m, either way) */
export const ADVICE_REACH = { lift: 10, drift: 15 };

const up1 = (v: number) => Math.ceil(v * 10 - 1e-9) / 10;
const down1 = (v: number) => Math.floor(v * 10 + 1e-9) / 10;
const toRanges = (kops: number[], step: number): [number, number][] => {
    const out: [number, number][] = [];
    for (const d of kops) {
        const last = out[out.length - 1];
        if (last && d - last[1] <= step + 1e-6) last[1] = d; else out.push([d, d]);
    }
    return out;
};
const RATE_NAME = { liftMax: 'Lift max', liftMin: 'Lift min', driftMax: 'Drift max', driftMin: 'Drift min' } as const;

/**
 * A wedge no kick-off works for: what each kick-off would need with much
 * wider lift and drift, and the smallest changes that would let it reach its
 * target. Tried in turn: one rate's limit moved (lift alone, drift alone),
 * both, and a bigger kick with the parent's rates (within the limits).
 */
export function adviseWedge(parent: Trace, target: Vec3, prefer: Rates, limits: RateLimits, kickMax: number, opts: { minKop?: number; step?: number } = {}): WedgeAdvice {
    const step = opts.step ?? WEDGE_DEFAULTS.step;
    const wide = (lift: boolean, drift: boolean): RateLimits => ({
        liftMin: lift ? Math.min(limits.liftMin, -ADVICE_REACH.lift) : limits.liftMin,
        liftMax: lift ? Math.max(limits.liftMax, ADVICE_REACH.lift) : limits.liftMax,
        driftMin: drift ? Math.min(limits.driftMin, -ADVICE_REACH.drift) : limits.driftMin,
        driftMax: drift ? Math.max(limits.driftMax, ADVICE_REACH.drift) : limits.driftMax,
    });
    const scan = (l: RateLimits) => scanRatedWedge(parent, target, prefer, l, kickMax, opts).profile.filter(p => p.feasible);
    const options: WedgeOption[] = [];
    const sc = scales(limits);
    const sizeOf = new Map<WedgeOption, number>();
    // One rate's limit moved: the kick-off needing the least beyond it
    for (const which of ['lift', 'drift'] as const) {
        const ok = scan(wide(which === 'lift', which === 'drift'));
        const lo = which === 'lift' ? limits.liftMin : limits.driftMin;
        const hi = which === 'lift' ? limits.liftMax : limits.driftMax;
        const over = ok.filter(p => p[which] > hi), under = ok.filter(p => p[which] < lo);
        if (over.length) {
            const v = up1(Math.min(...over.map(p => p[which])));
            const key = which === 'lift' ? 'liftMax' : 'driftMax';
            const o: WedgeOption = {
                change: key, limits: { ...limits, [key]: v },
                ranges: toRanges(ok.filter(p => p[which] >= lo - 1e-9 && p[which] <= v + 1e-9).map(p => p.kop), step),
                text: `Raise ${RATE_NAME[key]} from ${signed(hi)} to ${signed(v)}`,
            };
            options.push(o); sizeOf.set(o, (v - hi) / sc[which]);
        }
        if (under.length) {
            const v = down1(Math.max(...under.map(p => p[which])));
            const key = which === 'lift' ? 'liftMin' : 'driftMin';
            const o: WedgeOption = {
                change: key, limits: { ...limits, [key]: v },
                ranges: toRanges(ok.filter(p => p[which] >= v - 1e-9 && p[which] <= hi + 1e-9).map(p => p.kop), step),
                text: `Lower ${RATE_NAME[key]} from ${signed(lo)} to ${signed(v)}`,
            };
            options.push(o); sizeOf.set(o, (lo - v) / sc[which]);
        }
    }
    // Both at once (and the chart: what each kick-off needs, nearest the parent's rates)
    const both = scan(wide(true, true));
    if (options.length === 0 && both.length) {
        const need = (p: { lift: number; drift: number }): RateLimits => ({
            liftMin: Math.min(limits.liftMin, down1(p.lift)), liftMax: Math.max(limits.liftMax, up1(p.lift)),
            driftMin: Math.min(limits.driftMin, down1(p.drift)), driftMax: Math.max(limits.driftMax, up1(p.drift)),
        });
        const cost = (l: RateLimits) => (limits.liftMin - l.liftMin + l.liftMax - limits.liftMax) / sc.lift + (limits.driftMin - l.driftMin + l.driftMax - limits.driftMax) / sc.drift;
        const best = both.reduce((b, p) => (cost(need(p)) < cost(need(b)) ? p : b), both[0]);
        const l = need(best);
        const o: WedgeOption = {
            change: 'rates', limits: l,
            ranges: toRanges(both.filter(p => p.lift >= l.liftMin - 1e-9 && p.lift <= l.liftMax + 1e-9 && p.drift >= l.driftMin - 1e-9 && p.drift <= l.driftMax + 1e-9).map(p => p.kop), step),
            text: `Widen lift to ${rangeText(l.liftMin, l.liftMax)} and drift to ${rangeText(l.driftMin, l.driftMax)}`,
        };
        options.push(o); sizeOf.set(o, cost(l));
    }
    options.sort((a, b) => sizeOf.get(a)! - sizeOf.get(b)!);
    // A bigger kick, keeping the parent's rates (as far as the limits allow)
    const keep = { lift: clamp(prefer.lift, limits.liftMin, limits.liftMax), drift: clamp(prefer.drift, limits.driftMin, limits.driftMax) };
    const least = scanWedge(parent, target, keep, { kickMax: 90, minKop: opts.minKop, step }).leastKick;
    if (least !== null && least > kickMax && least < 30) {
        const k = up1(least);
        options.push({ change: 'kick', kickMax: k, ranges: scanWedge(parent, target, keep, { kickMax: k, minKop: opts.minKop, step }).ranges, text: `Allow a kick of ${k}° (now ${fmt(kickMax, 1)}°)` });
    }
    return {
        profile: both.map(p => ({ kop: p.kop, lift: p.lift, drift: p.drift, kick: p.sol.kick, feasible: false, beyond: !(p.lift >= limits.liftMin && p.lift <= limits.liftMax && p.drift >= limits.driftMin && p.drift <= limits.driftMax) })),
        parentRates: prefer, limits, options,
    };
}

export interface WedgeContext {
    /** The parent's trace from its collar, and its own lift / drift (null: the parent has none) */
    parent: { trace: Trace; name: string; rates?: Rates } | null;
    existingIds?: ReadonlySet<string> | null;
    minKop?: number;
    /** The planner's default limits on a daughter's lift / drift (solved rates); a hole's own `rateLimits` win */
    limits?: RateLimits;
}

/** Default balance: halfway between rates nearest the parent's and the deepest kick-off */
export const DEFAULT_BALANCE = 0.5;

/**
 * A daughter hole worked out on its parent. Solved rates (the default): the
 * lift and drift nearest the parent's that reach the target with a kick of at
 * most the maximum, the kick-off picked by the balance (or the one chosen).
 * Fixed rates: the lift and drift as typed, the deepest kick-off that works.
 */
export function planWedge(input: HoleInput, ctx: WedgeContext): PlanResult {
    const out: PlanResult = {
        ok: false, collar: null, collarDip: null, collarAzi: null, lift: null, drift: null, solvedRates: false,
        target: null, targetDip: null, targetAzi: null, targetDepth: null, eoh: null, trace: null, issues: [], miss: null, wedge: null,
    };
    const issue = (level: PlanIssue['level'], code: PlanIssue['code'], text: string) => { out.issues.push({ level, code, text }); };
    if (ctx.existingIds?.has(input.name.trim())) issue('warning', 'id-exists', `Hole ID ${input.name.trim()} is already a drillhole in the dataset.`);
    const { e, n, rl } = input.target;
    if (e === null || n === null || rl === null) { issue('error', 'missing', 'Missing: target E, N or RL.'); return out; }
    const target: Vec3 = [e, n, rl];
    out.target = target;
    const parent = ctx.parent;
    if (!parent) { issue('error', 'no-parent', 'The parent hole has no trace (it has errors, is not planned yet, or is not in this view).'); return out; }
    const kickMax = input.kickMax ?? WEDGE_DEFAULTS.kickMax;
    const extension = Math.max(0, input.extension ?? 0);
    const solveRates = input.ratesMode !== 'fixed';
    const prefer = parent.rates ?? averageRates(parent.trace);
    const ownLimits = !!input.rateLimits;
    const limits = input.rateLimits ?? ctx.limits ?? WEDGE_RATE_LIMITS;

    let kop: number, s: WedgeSolution, rates: Rates, ranges: [number, number][], deepest: number;
    let profile: WedgeProfilePoint[] | undefined;
    if (solveRates) {
        const bad = limitsProblem(limits);
        if (bad) { issue('error', 'bad-input', `${bad}${ownLimits ? " (this hole's own limits)" : ' (Settings)'}`); return out; }
        const scan = scanRatedWedge(parent.trace, target, prefer, limits, kickMax, { minKop: ctx.minKop });
        profile = scan.profile.map(p => ({ kop: p.kop, lift: p.lift, drift: p.drift, kick: p.sol.kick, feasible: p.feasible }));
        if (scan.viable.length === 0) {
            // What it would take: wider rates, or a bigger kick
            const advice = adviseWedge(parent.trace, target, prefer, limits, kickMax, { minKop: ctx.minKop });
            const fixes = advice.options.length
                ? ` To reach it: ${advice.options.map(o => `${o.text} (kick-offs ${rangesText(o.ranges)})`).join('; or ')}.`
                : ` Even lift ±${ADVICE_REACH.lift} and drift ±${ADVICE_REACH.drift} °/100 m don't reach it: try another parent.`;
            issue('error', 'no-wedge', `No kick-off on ${parent.name} reaches the target with a kick of ${fmt(kickMax, 1)}° or less and ${limitsText(limits)} °/100 m.${fixes}`);
            out.wedge = null;
            out.wedgeAdvice = advice;
            return out;
        }
        deepest = scan.viable[scan.viable.length - 1];
        ranges = scan.ranges;
        kop = pickKop(scan.viable, input.kopDepth, chooseKickOff(scan, input.balance ?? DEFAULT_BALANCE)!, issue);
        const p = scan.profile.find(x => x.kop === kop)!;
        s = p.sol; rates = { lift: p.lift, drift: p.drift };
        out.solvedRates = true;
        if (p.deviation > 0.02) issue('warning', 'lift-limit', `Lift ${fmt(p.lift, 2)} and drift ${fmt(p.drift, 2)} °/100 m, against the parent's ${fmt(prefer.lift, 2)} and ${fmt(prefer.drift, 2)}: holding them may need steering (navi drilling, slower penetration).`);
    } else {
        rates = { lift: input.lift ?? 0, drift: input.drift ?? 0 };
        const scan = scanWedge(parent.trace, target, rates, { kickMax, minKop: ctx.minKop });
        if (scan.viable.length === 0) {
            issue('error', 'no-wedge', `No kick-off depth on ${parent.name} reaches the target with a kick of ${fmt(kickMax, 1)}° or less`
                + `${scan.leastKick !== null ? ` (the least needed is ${fmt(scan.leastKick, 1)}°)` : ''}. Allow a bigger kick, change the lift and drift, or let them be solved.`);
            return out;
        }
        deepest = scan.viable[scan.viable.length - 1];
        ranges = scan.ranges;
        kop = pickKop(scan.viable, input.kopDepth, deepest, issue);
        s = scan.at.get(kop)!;
    }
    if (ranges.length > 1) {
        const others = ranges.filter(([a, b]) => !(kop >= a && kop <= b));
        issue('warning', 'wedge-ranges', `Other kick-off depths also work: ${rangesText(others)}.`);
    }
    const trace = wedgeTrace(parent.trace, s, rates, extension);
    out.trace = trace;
    out.collar = [trace.xyz[0], trace.xyz[1], trace.xyz[2]];
    out.collarDip = trace.dip[0]; out.collarAzi = trace.azi[0];
    out.lift = rates.lift; out.drift = rates.drift;
    out.targetDepth = kop + s.length;
    out.eoh = kop + s.length + extension;
    const at = stationAt(trace, out.targetDepth);
    if (at) { out.targetDip = at.dip; out.targetAzi = at.azi; }
    out.wedge = { parentName: parent.name, kop, kopPoint: s.kopPoint, kick: s.kick, toolface: s.toolface, kickMax, length: s.length, ranges, deepest, profile, parentRates: prefer, ...(solveRates ? { limits, ownLimits } : {}) };
    out.ok = true;
    return out;
}

/** The kick-off: a typed one snaps to the nearest 5 m that works; one that no longer works falls back (with a warning) */
function pickKop(viable: number[], chosen: number | null | undefined, fallback: number, issue: (l: PlanIssue['level'], c: PlanIssue['code'], t: string) => void): number {
    if (chosen === null || chosen === undefined) return fallback;
    const near = viable.reduce((b, d) => (Math.abs(d - chosen) < Math.abs(b - chosen) ? d : b), viable[0]);
    if (Math.abs(near - chosen) <= WEDGE_DEFAULTS.step / 2 + 1e-9) return near;
    issue('warning', 'kop-moved', `The chosen kick-off, ${fmt(chosen, 0)} m, no longer works: ${fallback} m is used.`);
    return fallback;
}

/**
 * The kick-off to use: `balance` 0 takes the rates nearest the parent's (the
 * deepest of those), 1 the deepest that works, and between a mix of the two.
 */
export function chooseKickOff(scan: RatedScan, balance: number): number | null {
    const ok = scan.profile.filter(p => p.feasible);
    if (ok.length === 0) return null;
    const lo = ok[0].kop, hi = ok[ok.length - 1].kop;
    const devMax = Math.max(...ok.map(p => p.deviation), 1e-9);
    let best = ok[0], bestScore = Infinity;
    for (const p of ok) {
        const score = (1 - balance) * (p.deviation / devMax) + balance * (hi > lo ? (hi - p.kop) / (hi - lo) : 0);
        if (score < bestScore - 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && p.kop > best.kop)) { best = p; bestScore = score; }
    }
    return best.kop;
}
