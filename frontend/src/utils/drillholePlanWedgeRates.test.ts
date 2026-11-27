import { describe, it, expect } from 'vitest';
import { HoleInput, Vec3, forwardTrace, stationAt } from './drillholePlan';
import { averageRates, chooseKickOff, limitsText, planWedge, rangeText, scanRatedWedge, WEDGE_RATE_LIMITS } from './drillholePlanWedgeRates';
import { scanWedge } from './drillholePlanWedge';

// Made-up coordinates only (grid-sized numbers)
const E0 = 500000, N0 = 6500000;
const collar: Vec3 = [E0, N0, 400];
const dist = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// A straight parent, -60 to the east, 700 m
const parent = forwardTrace(collar, -60, 90, { lift: 0, drift: 0 }, 700);
const at = (d: number) => stationAt(parent, d)!.p;

const input = (target: Vec3, over: Partial<HoleInput> = {}): HoleInput => ({
    name: 'P1_W1', mode: 'wedge', collar: { e: null, n: null, rl: null }, rlFromTopo: false, dip: null, azi: null,
    lift: 0, drift: 0, eoh: null, target: { e: target[0], n: target[1], rl: target[2] }, method: 'lift-drift', targetDip: null, targetAzi: null,
    extension: 0, kickMax: 3, ...over,
});

describe('average rates', () => {
    it('reads a hole\'s lift and drift back', () => {
        const r = averageRates(forwardTrace(collar, -60, 30, { lift: 1.5, drift: -2 }, 400));
        expect(r.lift).toBeCloseTo(1.5, 6);
        expect(r.drift).toBeCloseTo(-2, 6);
    });
});

describe('wedges with solved lift and drift', () => {
    // 10 m off the parent near its end: the parent's rates (0, 0) reach it with a small kick
    const easy: Vec3 = [at(550)[0], at(550)[1] + 10, at(550)[2]];
    // 60 m off the parent: a 3° kick alone can't, curving can
    const hard: Vec3 = [at(500)[0], at(500)[1] + 60, at(500)[2]];

    it('keeps the parent\'s lift and drift when they reach the target', () => {
        const scan = scanRatedWedge(parent, easy, { lift: 0, drift: 0 }, WEDGE_RATE_LIMITS, 3);
        const nearest = scan.profile.find(p => p.kop === chooseKickOff(scan, 0))!;
        expect(nearest.feasible).toBe(true);
        expect(Math.abs(nearest.lift)).toBeLessThan(1e-3);
        expect(Math.abs(nearest.drift)).toBeLessThan(1e-3);
    });

    it('steers (other rates, within the limits) only when the parent\'s don\'t reach', () => {
        expect(scanWedge(parent, hard, { lift: 0, drift: 0 }, { kickMax: 3 }).viable).toHaveLength(0);
        const r = planWedge(input(hard), { parent: { trace: parent, name: 'P1', rates: { lift: 0, drift: 0 } } });
        expect(r.ok).toBe(true);
        expect(r.solvedRates).toBe(true);
        expect(r.lift!).toBeGreaterThanOrEqual(WEDGE_RATE_LIMITS.liftMin - 1e-9);
        expect(r.lift!).toBeLessThanOrEqual(WEDGE_RATE_LIMITS.liftMax + 1e-9);
        expect(r.drift!).toBeGreaterThanOrEqual(WEDGE_RATE_LIMITS.driftMin - 1e-9);
        expect(r.drift!).toBeLessThanOrEqual(WEDGE_RATE_LIMITS.driftMax + 1e-9);
        expect(Math.abs(r.drift!)).toBeGreaterThan(0.1); // it had to curve
        expect(r.wedge!.kick).toBeLessThanOrEqual(3.01);
        expect(dist(stationAt(r.trace!, r.targetDepth!)!.p, hard)).toBeLessThan(0.01);
        expect(r.issues.some(i => /steering/.test(i.text))).toBe(true);
        expect(r.wedge!.profile!.length).toBeGreaterThan(10);
    });

    it('the balance runs from rates nearest the parent\'s to the deepest kick-off', () => {
        const scan = scanRatedWedge(parent, hard, { lift: 0, drift: 0 }, WEDGE_RATE_LIMITS, 3);
        const ok = scan.profile.filter(p => p.feasible);
        const near = scan.profile.find(p => p.kop === chooseKickOff(scan, 0))!;
        const deep = chooseKickOff(scan, 1);
        expect(deep).toBe(ok[ok.length - 1].kop);
        expect(near.deviation).toBeCloseTo(Math.min(...ok.map(p => p.deviation)), 9);
        // Every feasible answer hits its target exactly and keeps to the limits
        for (const p of ok) {
            expect(p.sol.miss).toBeLessThan(0.01);
            expect(p.sol.kick).toBeLessThanOrEqual(3.01);
        }
    });

    it('says so when even curving within the limits can\'t reach', () => {
        const far: Vec3 = [at(300)[0], at(300)[1] + 400, at(300)[2]];
        const r = planWedge(input(far), { parent: { trace: parent, name: 'P1' } });
        expect(r.ok).toBe(false);
        expect(r.issues.find(i => i.code === 'no-wedge')!.text).toMatch(/lift within ±2, drift within ±5/);
    });

    // 130 m above the parent near its end: flattening this much needs more than +2 lift
    const high: Vec3 = [at(600)[0], at(600)[1], at(600)[2] + 130];
    const ctx = { parent: { trace: parent, name: 'P1', rates: { lift: 0, drift: 0 } } };

    it("a hole's own limits (lift up to +5) reach a target the defaults can't", () => {
        expect(planWedge(input(high), ctx).ok).toBe(false);
        const own = { liftMin: -2, liftMax: 5, driftMin: -5, driftMax: 5 };
        const r = planWedge(input(high, { rateLimits: own }), ctx);
        expect(r.ok).toBe(true);
        expect(r.lift!).toBeGreaterThan(2);
        expect(r.lift!).toBeLessThanOrEqual(5 + 1e-9);
        expect(r.wedge!.kick).toBeLessThanOrEqual(3.01);
        expect(dist(stationAt(r.trace!, r.targetDepth!)!.p, high)).toBeLessThan(0.01);
        expect(r.wedge!.limits).toEqual(own);
        expect(r.wedge!.ownLimits).toBe(true);
        // The planner's limits (Settings) do the same for holes without their own
        expect(planWedge(input(high), { ...ctx, limits: own }).ok).toBe(true);
    });

    it('a wedge that fails says which way lift or drift must go, and each change offered works', () => {
        const side: Vec3 = [at(500)[0], at(500)[1] + 120, at(500)[2]];
        const cases: [Vec3, string][] = [[high, 'liftMax'], [side, 'driftMin']];
        for (const [target, first] of cases) {
            const r = planWedge(input(target), ctx);
            expect(r.ok).toBe(false);
            const a = r.wedgeAdvice!;
            expect(a.options[0].change).toBe(first);
            expect(r.issues.find(i => i.code === 'no-wedge')!.text).toMatch(/To reach it: (Raise Lift max from \+2|Lower Drift min from −5) to/);
            // The chart: what each kick-off would need, past the limits
            expect(a.profile.length).toBeGreaterThan(0);
            expect(a.profile.every(p => p.beyond)).toBe(true);
            for (const o of a.options) {
                expect(o.ranges.length).toBeGreaterThan(0);
                const again = planWedge(input(target, o.limits ? { rateLimits: o.limits } : { kickMax: o.kickMax }), ctx);
                expect(again.ok).toBe(true);
                expect(dist(stationAt(again.trace!, again.targetDepth!)!.p, target)).toBeLessThan(0.01);
            }
        }
        // Raising lift max is the change for a target above the parent; lift is not lowered
        const up = planWedge(input(high), ctx).wedgeAdvice!.options.find(o => o.change === 'liftMax')!;
        expect(up.limits!.liftMax).toBeGreaterThan(2);
        expect(up.limits!.liftMin).toBe(-2);
    });

    it('limits need not be symmetric: a lift range of 0 to +5 never steepens', () => {
        const r = planWedge(input(high, { rateLimits: { liftMin: 0, liftMax: 5, driftMin: -1, driftMax: 1 } }), ctx);
        expect(r.ok).toBe(true);
        for (const p of r.wedge!.profile!.filter(q => q.feasible)) {
            expect(p.lift).toBeGreaterThanOrEqual(-1e-9);
            expect(Math.abs(p.drift)).toBeLessThanOrEqual(1 + 1e-9);
        }
    });

    it('limits that run the wrong way are an error, and the messages give the ranges', () => {
        const r = planWedge(input(easy, { rateLimits: { liftMin: 3, liftMax: 1, driftMin: -5, driftMax: 5 } }), ctx);
        expect(r.ok).toBe(false);
        expect(r.issues.find(i => i.code === 'bad-input')!.text).toMatch(/lift limits run the wrong way.*own limits/);
        expect(rangeText(-2, 2)).toBe('±2');
        expect(rangeText(-2, 5)).toBe('−2 to +5');
        expect(limitsText({ liftMin: 0, liftMax: 5, driftMin: -3, driftMax: 3 })).toBe('lift within 0 to +5, drift within ±3');
    });

    it('fixed rates still work as typed', () => {
        const r = planWedge(input(easy, { ratesMode: 'fixed' }), { parent: { trace: parent, name: 'P1' } });
        expect(r.ok).toBe(true);
        expect(r.solvedRates).toBe(false);
        expect(r.lift).toBe(0);
    });
});
