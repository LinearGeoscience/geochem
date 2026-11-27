import { describe, expect, it } from 'vitest';
import { forwardTrace, type Trace, type Vec3 } from './drillholePlan';
import { checkAt, closestApproach, joined, missInPlane, project, projectAll, type PlannedTrack } from './drillTrackProjection';

// Made-up holes and coordinates: a planned hole due grid north at -60, target at 200 m, end at 300 m
const COLLAR: Vec3 = [5000, 7000, 400];
const plan: PlannedTrack = {
    name: 'P01', trace: forwardTrace(COLLAR, -60, 0, { lift: 0, drift: 0 }, 300, 200),
    target: [5000, 7000 + 100, 400 - 173.205], targetDepth: 200, eoh: 300, lift: 0, drift: 0,
};
const drilledFrom = (collar: Vec3, length = 120): Trace => forwardTrace(collar, -60, 0, { lift: 0, drift: 0 }, length);

describe('project', () => {
    it('runs on from a depth of the drilled hole, its depths down the drilled hole', () => {
        const t = project(drilledFrom(COLLAR), 120, { lift: 0, drift: 0 }, 300)!;
        expect(t.depth[0]).toBe(120);
        expect(t.depth[t.depth.length - 1]).toBeCloseTo(300, 9);
        const end = t.depth.length - 1;
        expect(t.xyz[end * 3 + 1]).toBeCloseTo(7000 + 150, 6);
        expect(project(drilledFrom(COLLAR), 500, { lift: 0, drift: 0 }, 600)).toBeNull();
    });
});

describe('closestApproach and missInPlane', () => {
    const line = forwardTrace([0, 0, 0], 0, 90, { lift: 0, drift: 0 }, 100);

    it('finds the nearest place along a path', () => {
        const c = closestApproach(line, [40.5, 3, 4])!;
        expect(c.distance).toBeCloseTo(5, 9);
        expect(c.depth).toBeCloseTo(40.5, 9);
    });

    it('is null when the path does not reach the plane, or starts past it', () => {
        expect(missInPlane(line, [150, 0, 0], [1, 0, 0], 90)).toBeNull();
        expect(missInPlane(line, [-10, 0, 0], [1, 0, 0], 90)).toBeNull();
    });
});

describe('the miss against the planned hole', () => {
    it('is nothing for a hole drilled as planned', () => {
        const c = checkAt(joined(drilledFrom(COLLAR), project(drilledFrom(COLLAR), 120, { lift: 0, drift: 0 }, 400)!), plan, 200)!;
        expect(c.miss!.distance).toBeCloseTo(0, 6);
        expect(c.miss!.depth).toBeCloseTo(200, 6);
        expect(c.closest!.distance).toBeCloseTo(0, 6);
    });

    it('is to the right for a hole collared 10 m east of a hole going north', () => {
        const d = drilledFrom([COLLAR[0] + 10, COLLAR[1], COLLAR[2]]);
        const c = checkAt(joined(d, project(d, 120, { lift: 0, drift: 0 }, 400)!), plan, 200)!;
        expect(c.miss!.right).toBeCloseTo(10, 6);
        expect(c.miss!.high).toBeCloseTo(0, 6);
        expect(c.closest!.distance).toBeCloseTo(10, 6);
    });

    it('is high by the part of a 10 m rise square to a -60 hole', () => {
        const d = drilledFrom([COLLAR[0], COLLAR[1], COLLAR[2] + 10]);
        const c = checkAt(joined(d, project(d, 120, { lift: 0, drift: 0 }, 400)!), plan, 200)!;
        expect(c.miss!.high).toBeCloseTo(5, 6);
        expect(c.miss!.right).toBeCloseTo(0, 6);
    });

    it('is left of a hole drifting anticlockwise, and low of one steepening', () => {
        const d = drilledFrom(COLLAR, 100);
        const left = checkAt(joined(d, project(d, 100, { lift: 0, drift: -3 }, 400)!), plan, 200)!;
        expect(left.miss!.right).toBeLessThan(-1);
        const low = checkAt(joined(d, project(d, 100, { lift: -3, drift: 0 }, 400)!), plan, 200)!;
        expect(low.miss!.high).toBeLessThan(-1);
        expect(Math.abs(low.miss!.right)).toBeLessThan(1e-6);
    });

    it('takes the high side of a vertical planned hole from its azimuth', () => {
        const vertical: PlannedTrack = { ...plan, trace: forwardTrace(COLLAR, -90, 0, { lift: 0, drift: 0 }, 300, 200), target: null, targetDepth: 200 };
        const d = forwardTrace([COLLAR[0] + 3, COLLAR[1] + 4, COLLAR[2]], -90, 0, { lift: 0, drift: 0 }, 300);
        const c = checkAt(d, vertical, 200)!;
        expect(c.miss!.high).toBeCloseTo(4, 6);
        expect(c.miss!.right).toBeCloseTo(3, 6);
    });
});

describe('projectAll', () => {
    it('makes the projections asked for, from the last survey, past the planned end', () => {
        const d = drilledFrom(COLLAR, 100);
        const all = projectAll(d, 100, plan, { hold: { lift: 0, drift: 0 }, recent: null, custom: { lift: 1, drift: 2 } });
        expect(all.map(p => p.kind)).toEqual(['hold', 'custom']);
        expect(all[0].path.depth[0]).toBe(100);
        expect(all[0].path.depth[all[0].path.depth.length - 1]).toBeCloseTo(400, 9);
        expect(all[0].target!.miss!.distance).toBeCloseTo(0, 6);
        expect(all[0].eoh!.miss!.distance).toBeCloseTo(0, 6);
        expect(all[1].rates).toEqual({ lift: 1, drift: 2 });
        expect(all[1].eoh!.miss!.distance).toBeGreaterThan(1);
    });
});
