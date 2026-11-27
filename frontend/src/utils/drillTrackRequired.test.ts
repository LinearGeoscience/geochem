import { describe, expect, it } from 'vitest';
import { forwardTrace, stationAt, type Vec3 } from './drillholePlan';
import type { PlannedTrack } from './drillTrackProjection';
import { missWith, requiredRates } from './drillTrackRequired';

// Made-up holes: planned due grid north at -60 with lift 1 °/100 m, target at 250 m, end at 300 m
const COLLAR: Vec3 = [4000, 9000, 300];
const planTrace = forwardTrace(COLLAR, -60, 0, { lift: 1, drift: 0 }, 300, 250);
const plan: PlannedTrack = { name: 'P1', trace: planTrace, target: stationAt(planTrace, 250)!.p, targetDepth: 250, eoh: 300, lift: 1, drift: 0 };
const dist = (m: { high: number; right: number } | null) => (m ? Math.hypot(m.high, m.right) : Infinity);

describe('requiredRates', () => {
    // Drilled lifting 3 and drifting 2 °/100 m to 120 m: well off the plan by the target
    const drilled = forwardTrace(COLLAR, -60, 0, { lift: 3, drift: 2 }, 120);

    it('finds the least lift and drift that land within the tolerance, and no smaller rates do', () => {
        expect(dist(missWith(drilled, 120, plan, { lift: 0, drift: 0 }))).toBeGreaterThan(5);
        const r = requiredRates(drilled, 120, plan, 5)!;
        expect(r.holdIsEnough).toBe(false);
        expect(r.distance).toBeLessThanOrEqual(5);
        expect(r.distance).toBeCloseTo(4.9, 1);
        expect(dist(missWith(drilled, 120, plan, r.rates))).toBeCloseTo(r.distance, 6);
        // Anything a little smaller, in any direction round 0 / 0, lands outside the edge aimed at (2 % inside the tolerance)
        const size = Math.hypot(r.rates.lift, r.rates.drift);
        for (let deg = 0; deg < 360; deg += 5) {
            const a = deg * Math.PI / 180;
            const smaller = { lift: 0.97 * size * Math.cos(a), drift: 0.97 * size * Math.sin(a) };
            expect(dist(missWith(drilled, 120, plan, smaller))).toBeGreaterThan(0.98 * 5);
        }
    });

    it('also gives the rates that hit the target, which are larger', () => {
        const r = requiredRates(drilled, 120, plan, 5)!;
        expect(dist(missWith(drilled, 120, plan, r.hit!))).toBeLessThan(0.05);
        expect(Math.hypot(r.hit!.lift, r.hit!.drift)).toBeGreaterThan(Math.hypot(r.rates.lift, r.rates.drift));
    });

    it('needs smaller rates for a wider tolerance', () => {
        const tight = requiredRates(drilled, 120, plan, 5)!, wide = requiredRates(drilled, 120, plan, 15)!;
        expect(Math.hypot(wide.rates.lift, wide.rates.drift)).toBeLessThan(Math.hypot(tight.rates.lift, tight.rates.drift));
    });

    it('is 0 / 0 when holding the last survey already lands within the tolerance', () => {
        const onPlan = forwardTrace(COLLAR, -60, 0, { lift: 1, drift: 0 }, 120);
        const r = requiredRates(onPlan, 120, plan, 5)!;
        expect(r.holdIsEnough).toBe(true);
        expect(r.rates).toEqual({ lift: 0, drift: 0 });
        expect(r.distance).toBeLessThanOrEqual(5);
        expect(r.hit!.lift).toBeCloseTo(1, 1);
    });

    it('is null without a target', () => {
        expect(requiredRates(drilled, 120, { ...plan, targetDepth: null }, 5)).toBeNull();
    });
});
