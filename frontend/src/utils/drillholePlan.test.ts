import { describe, it, expect } from 'vitest';
import {
    HoleInput, PlanContext, Vec3, aziDelta, backToSurface, direction, dipOutOfRange, forwardTrace, minCurvatureStep,
    normAzi, optionOf, planHole, solveToCollar, stationAt, walk, withOption,
} from './drillholePlan';
import { flatTopography, meshTopography } from './drillholePlanTopo';

// Made-up coordinates only (grid-sized numbers), never real project data
const E0 = 500000, N0 = 6500000;
const RAD = Math.PI / 180;
const dist = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const endOf = (t: { xyz: Float64Array }): Vec3 => { const n = t.xyz.length; return [t.xyz[n - 3], t.xyz[n - 2], t.xyz[n - 1]]; };

/** A tilted plane of two triangles over a square, z = z0 + gx·(x − E0) + gy·(y − N0) */
function tiltedTopo(half = 2000, z0 = 400, gx = 0.05, gy = -0.03) {
    const z = (x: number, y: number) => z0 + gx * (x - E0) + gy * (y - N0);
    const xs = [E0 - half, E0 + half, E0 + half, E0 - half], ys = [N0 - half, N0 - half, N0 + half, N0 + half];
    const v = new Float64Array(xs.flatMap((x, i) => [x, ys[i], z(x, ys[i])]));
    return { topo: meshTopography('Tilted', v, Uint32Array.from([0, 1, 2, 0, 2, 3]))!, z };
}

const baseInput = (over: Partial<HoleInput>): HoleInput => ({
    name: 'P001', mode: 'collar', collar: { e: null, n: null, rl: null }, rlFromTopo: false,
    dip: null, azi: null, lift: null, drift: null, eoh: null,
    target: { e: null, n: null, rl: null }, method: 'surface-straight', targetDip: null, targetAzi: null, extension: 0,
    ...over,
});
const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({ topo: null, ...over });
const codes = (r: { issues: { code: string }[] }) => r.issues.map(i => i.code);

describe('angles', () => {
    it('direction: dip negative down, azimuth clockwise from grid north', () => {
        const d = direction(-90, 123);
        expect(d[2]).toBeCloseTo(-1, 12);
        const e = direction(0, 90);
        expect(e[0]).toBeCloseTo(1, 12);
        expect(e[1]).toBeCloseTo(0, 12);
    });
    it('normAzi and aziDelta wrap at 0 / 360', () => {
        expect(normAzi(-2)).toBeCloseTo(358, 12);
        expect(normAzi(362)).toBeCloseTo(2, 12);
        expect(aziDelta(358, 2)).toBeCloseTo(4, 12);
        expect(aziDelta(2, 358)).toBeCloseTo(-4, 12);
    });
    it('minimum curvature of a straight step is the step', () => {
        const t = direction(-60, 30);
        const m = minCurvatureStep(t, t, 1);
        expect(Math.hypot(...m)).toBeCloseTo(1, 12);
    });
});

describe('forward trace', () => {
    it('a straight hole ends at collar + length × direction', () => {
        const c: Vec3 = [E0, N0, 400];
        const t = forwardTrace(c, -60, 45, { lift: 0, drift: 0 }, 250);
        const d = direction(-60, 45);
        const end = endOf(t);
        for (let k = 0; k < 3; k++) expect(end[k]).toBeCloseTo(c[k] + 250 * d[k], 6);
        expect(t.depth.length).toBe(251);
    });

    it('a lift-only hole matches the circular arc by hand (minimum curvature is exact on an arc)', () => {
        // Dip −60 → −54 over 200 m at +3°/100 m, heading east: radius R = 100 / (3° in radians)
        const c: Vec3 = [E0, N0, 400];
        const t = forwardTrace(c, -60, 90, { lift: 3, drift: 0 }, 200);
        const R = 100 / (3 * RAD);
        const th0 = -60 * RAD, th1 = -54 * RAD;
        const end = endOf(t);
        expect(end[0] - E0).toBeCloseTo(R * (Math.sin(th1) - Math.sin(th0)), 6); // 108.88 m east
        expect(end[1] - N0).toBeCloseTo(0, 9);
        expect(end[2] - 400).toBeCloseTo(-R * (Math.cos(th1) - Math.cos(th0)), 6); // 167.66 m down
        expect(t.dip[t.dip.length - 1]).toBeCloseTo(-54, 9);
    });

    it('the end moves continuously with the length (fractional last step)', () => {
        const c: Vec3 = [E0, N0, 400];
        const at = (L: number) => endOf(forwardTrace(c, -55, 20, { lift: 2, drift: 3 }, L));
        expect(dist(at(100), at(100 - 1e-6))).toBeLessThan(1e-5);
        expect(dist(at(100.5), at(100.4))).toBeCloseTo(0.1, 4);
        expect(dist(at(100.6), at(100.5))).toBeCloseTo(0.1, 4);
        const t = forwardTrace(c, -55, 20, { lift: 2, drift: 3 }, 100.4);
        expect(t.depth[t.depth.length - 1]).toBeCloseTo(100.4, 12);
        expect(t.depth[t.depth.length - 2]).toBe(100);
    });

    it('puts a station on the target depth', () => {
        const t = forwardTrace([E0, N0, 400], -60, 0, { lift: 1, drift: 1 }, 300, 123.456);
        expect(Array.from(t.depth)).toContain(123.456);
    });

    it('wraps the azimuth through north (358° with +4°/100 m drift)', () => {
        const c: Vec3 = [E0, N0, 400];
        const t = forwardTrace(c, -60, 358, { lift: 0, drift: 4 }, 100);
        expect(t.azi[t.azi.length - 1]).toBeCloseTo(2, 9);
        for (const a of t.azi) expect(a >= 0 && a < 360).toBe(true);
        // The same hole turned through 180° about the collar
        const u = forwardTrace(c, -60, 178, { lift: 0, drift: 4 }, 100);
        const a = endOf(t), b = endOf(u);
        expect(a[0] - E0).toBeCloseTo(-(b[0] - E0), 6);
        expect(a[1] - N0).toBeCloseTo(-(b[1] - N0), 6);
        expect(a[2]).toBeCloseTo(b[2], 6);
    });
});

describe('vertical holes', () => {
    it('a vertical hole with no lift stays vertical whatever its drift', () => {
        const t = forwardTrace([E0, N0, 400], -90, 45, { lift: 0, drift: 5 }, 300);
        const end = endOf(t);
        expect(end[0]).toBeCloseTo(E0, 9);
        expect(end[1]).toBeCloseTo(N0, 9);
        expect(end[2]).toBeCloseTo(100, 9);
        expect(t.azi[t.azi.length - 1]).toBeCloseTo(45, 9); // held while vertical
    });

    it('lift from vertical flattens towards the entered azimuth (an arc in that plane)', () => {
        const t = forwardTrace([E0, N0, 400], -90, 45, { lift: 3, drift: 0 }, 200);
        const end = endOf(t);
        const R = 100 / (3 * RAD);
        const along = R * (Math.sin(-84 * RAD) - Math.sin(-90 * RAD));
        expect(end[0] - E0).toBeCloseTo(along * Math.sin(45 * RAD), 6);
        expect(end[1] - N0).toBeCloseTo(along * Math.cos(45 * RAD), 6);
    });

    it('drift starts on the first step off vertical', () => {
        const t = forwardTrace([E0, N0, 400], -90, 45, { lift: 3, drift: 4 }, 10);
        expect(t.azi[1]).toBeCloseTo(45, 12);    // the step that starts vertical holds the azimuth
        expect(t.azi[2]).toBeCloseTo(45.04, 12); // then drift builds up
    });

    it('negative lift from vertical passes −90: an error at 1 m', () => {
        const t = forwardTrace([E0, N0, 400], -90, 0, { lift: -2, drift: 0 }, 50);
        expect(dipOutOfRange(t)).toEqual({ depth: 1, dip: expect.closeTo(-90.02, 9) });
    });
});

describe('back-projection to the surface', () => {
    it('straight: target → collar on a flat RL → forward reaches the target', () => {
        const target: Vec3 = [E0 + 100, N0 + 200, 150];
        const b = backToSurface(target, -60, 30, { lift: 0, drift: 0 }, flatTopography(400), 2000);
        expect(b.ok).toBe(true);
        if (!b.ok) return;
        expect(b.collar[2]).toBeCloseTo(400, 6);
        expect(b.length).toBeCloseTo(250 / Math.sin(60 * RAD), 6);
        const t = forwardTrace(b.collar, b.collarDip, b.collarAzi, { lift: 0, drift: 0 }, b.length, b.length);
        expect(dist(stationAt(t, b.length)!.p, target)).toBeLessThan(0.01);
    });

    it('curved, on tilted triangles: forward from the collar reaches the target', () => {
        const { topo, z } = tiltedTopo();
        const target: Vec3 = [E0 + 150, N0 - 80, 60];
        const rates = { lift: 2, drift: 1.5 };
        const b = backToSurface(target, -58, 70, rates, topo, 2000);
        expect(b.ok).toBe(true);
        if (!b.ok) return;
        expect(b.collar[2]).toBeCloseTo(z(b.collar[0], b.collar[1]), 6); // on the topography
        expect(b.collarDip).toBeLessThan(-58); // steeper at the collar: going up, positive lift steepens
        const t = forwardTrace(b.collar, b.collarDip, b.collarAzi, rates, b.length, b.length);
        expect(dist(endOf(t), target)).toBeLessThan(0.01);
    });

    it('never reaching the surface within the maximum length is an error', () => {
        // Negative lift flattens the hole going up, so it never climbs 1000 m
        const b = backToSurface([E0, N0, -600], -20, 0, { lift: -8, drift: 0 }, flatTopography(400), 2000);
        expect(b.ok).toBe(false);
        if (!b.ok) expect(['never-surface', 'dip-range']).toContain(b.code);
        const c = backToSurface([E0, N0, -600], -60, 0, { lift: 0, drift: 0 }, flatTopography(400), 500);
        expect(c.ok ? null : c.code).toBe('never-surface');
    });

    it('leaving the topography\'s extent before the surface is an error', () => {
        const { topo } = tiltedTopo(300);
        const b = backToSurface([E0 + 250, N0, 0], -20, 270, { lift: 0, drift: 0 }, topo, 3000);
        expect(b.ok ? null : b.code).toBe('leaves-topo');
    });

    it('a target outside or above the topography is an error', () => {
        const { topo } = tiltedTopo(300);
        const outside = backToSurface([E0 + 5000, N0, 0], -60, 0, { lift: 0, drift: 0 }, topo, 2000);
        expect(outside.ok ? null : outside.code).toBe('outside-topo');
        const above = backToSurface([E0, N0, 900], -60, 0, { lift: 0, drift: 0 }, topo, 2000);
        expect(above.ok ? null : above.code).toBe('target-above-topo');
    });
});

describe('solving between a collar and a target', () => {
    const collar: Vec3 = [E0, N0, 420];
    const target: Vec3 = [E0 + 150, N0 + 250, 50];
    const reaches = (r: ReturnType<typeof solveToCollar>) => {
        const t = forwardTrace(collar, r.collarDip, r.collarAzi, { lift: r.lift, drift: r.drift }, r.length, r.length);
        return dist(endOf(t), target);
    };

    it('given target dip / azimuth: solves lift, drift, collar angles and length', () => {
        const r = solveToCollar({ collar, target, given: 'target-angles', a: -55, b: 35 });
        expect(r.converged).toBe(true);
        expect(reaches(r)).toBeLessThan(0.01);
        const t = forwardTrace(collar, r.collarDip, r.collarAzi, { lift: r.lift, drift: r.drift }, r.length);
        expect(t.dip[t.dip.length - 1]).toBeCloseTo(-55, 3);
        expect(t.azi[t.azi.length - 1]).toBeCloseTo(35, 3);
    });

    it('given collar dip / azimuth: solves lift, drift and length', () => {
        const r = solveToCollar({ collar, target, given: 'collar-angles', a: -48, b: 27 });
        expect(r.converged).toBe(true);
        expect(r.collarDip).toBe(-48);
        expect(reaches(r)).toBeLessThan(0.01);
    });

    it('given lift / drift: solves the collar angles and length', () => {
        const r = solveToCollar({ collar, target, given: 'lift-drift', a: 1.5, b: 1 });
        expect(r.converged).toBe(true);
        expect(r.lift).toBe(1.5);
        expect(reaches(r)).toBeLessThan(0.01);
    });

    it('reports the closest approach when it cannot converge', () => {
        const r = solveToCollar({ collar, target, given: 'collar-angles', a: -5, b: 210 }, { maxIterations: 2 });
        expect(r.converged).toBe(false);
        expect(r.miss).toBeGreaterThan(0.01);
    });
});

describe('planHole', () => {
    const collarHole = baseInput({ mode: 'collar', collar: { e: E0, n: N0, rl: 400 }, dip: -60, azi: 90, eoh: 200, lift: 3, drift: 0 });

    it('by collar: draws the trace', () => {
        const r = planHole(collarHole, ctx());
        expect(r.ok).toBe(true);
        expect(r.trace).not.toBeNull();
        expect(r.eoh).toBe(200);
    });

    it('by collar: RL from the topography', () => {
        const r = planHole({ ...collarHole, rlFromTopo: true, collar: { e: E0, n: N0, rl: null } }, ctx({ topo: flatTopography(380) }));
        expect(r.collar?.[2]).toBe(380);
        expect(codes(r)).toContain('flat-topo');
    });

    it('missing inputs, a positive dip, or no topography are errors (no trace)', () => {
        const missing = planHole(baseInput({ mode: 'collar', collar: { e: E0, n: N0, rl: 400 } }), ctx());
        expect(codes(missing)).toContain('missing');
        expect(missing.trace).toBeNull();
        expect(codes(planHole({ ...collarHole, dip: 10 }, ctx()))).toContain('bad-input');
        expect(codes(planHole({ ...collarHole, rlFromTopo: true }, ctx()))).toContain('no-topo');
        const surf = baseInput({ mode: 'target', target: { e: E0, n: N0, rl: 0 }, method: 'surface-straight', targetDip: -60, targetAzi: 0 });
        expect(codes(planHole(surf, ctx()))).toContain('no-topo');
    });

    it('the dip passing −90 or 0 is an error with its depth', () => {
        const r = planHole({ ...collarHole, dip: -10, lift: 5, eoh: 400 }, ctx());
        const issue = r.issues.find(i => i.code === 'dip-range');
        expect(issue?.depth).toBeCloseTo(201, 6); // −10 + 5 × 2.01 > 0
        expect(r.ok).toBe(false);
        expect(r.trace).toBeNull();
    });

    it('by target, projected to the surface, with an extension past the target', () => {
        const input = baseInput({ mode: 'target', target: { e: E0 + 100, n: N0 + 200, rl: 150 }, method: 'surface-curved', targetDip: -60, targetAzi: 30, lift: 2, drift: 1, extension: 40 });
        const r = planHole(input, ctx({ topo: tiltedTopo().topo }));
        expect(r.ok).toBe(true);
        expect(r.eoh! - r.targetDepth!).toBeCloseTo(40, 9);
        expect(dist(stationAt(r.trace!, r.targetDepth!)!.p, [E0 + 100, N0 + 200, 150])).toBeLessThan(0.01);
        expect(r.targetDip).toBeCloseTo(-60, 6);
    });

    it('by target, projected to the collar: target above collar, same point', () => {
        const above = baseInput({ mode: 'target', collar: { e: E0, n: N0, rl: 100 }, target: { e: E0 + 50, n: N0, rl: 200 }, method: 'lift-drift', lift: 0, drift: 0 });
        expect(codes(planHole(above, ctx()))).toContain('target-above-collar');
        const same = { ...above, target: { e: E0, n: N0, rl: 100 } };
        expect(codes(planHole(same, ctx()))).toContain('same-point');
    });

    it('warns when a solved lift or drift is over the limit', () => {
        const input = baseInput({ mode: 'target', collar: { e: E0, n: N0, rl: 420 }, target: { e: E0 + 150, n: N0 + 250, rl: 50 }, method: 'collar-angles', dip: -80, azi: 0 });
        const r = planHole(input, ctx({ liftLimit: 1 }));
        expect(r.ok).toBe(true);
        expect(codes(r).some(c => c === 'lift-limit' || c === 'drift-limit')).toBe(true);
        expect(codes(planHole(input, ctx({ liftLimit: 100 })))).not.toContain('lift-limit');
    });

    it('a solver that does not converge is an error with the miss distance', () => {
        // Collar almost level and pointing away from a target 300 m behind it: no constant lift / drift gets there
        const input = baseInput({ mode: 'target', collar: { e: E0, n: N0, rl: 420 }, target: { e: E0, n: N0 + 300, rl: 400 }, method: 'collar-angles', dip: -5, azi: 180 });
        const r = planHole(input, ctx());
        expect(r.ok).toBe(false);
        expect(codes(r)).toContain('no-converge');
        expect(r.miss!.distance).toBeGreaterThan(0.01);
        expect(r.issues.find(i => i.code === 'no-converge')!.text).toMatch(/misses the target by \d+\.\d\d m/);
        expect(r.trace).toBeNull();
    });

    it('warns when the hole turns by more than 90° along its length', () => {
        // Drift 30°/100 m over 400 m at −10°: 120° of azimuth, about 117° of turn in 3D
        const r = planHole({ ...collarHole, dip: -10, lift: 0, drift: 30, eoh: 400 }, ctx());
        expect(r.ok).toBe(true);
        expect(codes(r)).toContain('turn');
        expect(codes(planHole(collarHole, ctx()))).not.toContain('turn');
    });

    it('warns when the hole ID is already a drillhole', () => {
        expect(codes(planHole(collarHole, ctx({ existingIds: new Set(['P001']) })))).toContain('id-exists');
    });

    it('warns when part of the trace runs outside every extent', () => {
        const r = planHole(collarHole, ctx({ dataBounds: { min: [E0 - 50, N0 - 50, 0], max: [E0 + 50, N0 + 50, 500] } }));
        expect(codes(r)).toContain('outside-extent');
        const inside = planHole(collarHole, ctx({ dataBounds: { min: [E0 - 500, N0 - 500, 0], max: [E0 + 500, N0 + 500, 500] } }));
        expect(codes(inside)).not.toContain('outside-extent');
    });

    it('RL datum check: topography far from the existing collars, or a typed collar RL far from it', () => {
        const { topo, z } = tiltedTopo();
        // Existing collars 30 m below the topography (as if in another RL datum)
        const collars = [E0 + 20, N0 + 10, E0 - 40, N0 + 60, E0 + 90, N0 - 30].flatMap((v, i, a) => (i % 2 ? [] : [v, a[i + 1], z(v, a[i + 1]) - 30]));
        const hole = { ...collarHole, collar: { e: E0, n: N0, rl: z(E0, N0) } };
        const r = planHole(hole, ctx({ topo, existingCollars: collars }));
        expect(codes(r)).toContain('rl-datum');
        expect(codes(planHole(hole, ctx({ topo, existingCollars: collars, rlTolerance: 50 })))).not.toContain('rl-datum');
        const typed = planHole({ ...collarHole, collar: { e: E0, n: N0, rl: z(E0, N0) + 35 } }, ctx({ topo }));
        expect(codes(typed)).toContain('collar-rl');
    });

    it('warns about a closed-solid topography', () => {
        // A tetrahedron round the target: closed
        const v = new Float64Array([E0 - 500, N0 - 500, -200, E0 + 500, N0 - 500, -200, E0, N0 + 500, -200, E0, N0, 600]);
        const topo = meshTopography('Solid', v, Uint32Array.from([0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3]))!;
        const input = baseInput({ mode: 'target', target: { e: E0, n: N0 - 100, rl: 0 }, method: 'surface-straight', targetDip: -89, targetAzi: 0 });
        expect(codes(planHole(input, ctx({ topo })))).toContain('closed-topo');
    });

    it('carries a hole over when it is switched to another way of planning', () => {
        const first = planHole(collarHole, ctx());
        const flat = flatTopography(400);
        for (const option of ['collar-target', 'surface', 'collar'] as const) {
            const input = { ...collarHole, ...withOption(collarHole, option, first) };
            expect(optionOf(input)).toBe(option);
            const again = planHole(input, ctx({ topo: option === 'surface' ? flat : null }));
            expect(again.ok).toBe(true);
            // The same hole (a by-collar hole's end of hole becomes the target)
            const end = (t: { xyz: Float64Array }) => [t.xyz[t.xyz.length - 3], t.xyz[t.xyz.length - 2], t.xyz[t.xyz.length - 1]];
            expect(dist(end(again.trace!), end(first.trace!))).toBeLessThan(0.01);
            expect(dist(again.collar!, first.collar!)).toBeLessThan(0.01);
        }
    });

    it('walk stops where onSegment says', () => {
        const w = walk({ p: [E0, N0, 0], dip: -90, azi: 0 }, { lift: 0, drift: 0 }, 10, 1, { onSegment: (_a, _b, d0) => (d0 === 4 ? 0.25 : null) });
        expect(w.stopped).toBe(true);
        expect(w.length).toBeCloseTo(4.25, 12);
        expect(w.end.p[2]).toBeCloseTo(-4.25, 12);
    });
});
