import { describe, it, expect } from 'vitest';
import { HoleInput, Vec3, direction, forwardTrace, stationAt, walk, anglesOf } from './drillholePlan';
import { scanWedge, solveWedgeAt, traceFromPoints, traceFromStations, rangesText } from './drillholePlanWedge';
import { planWedge } from './drillholePlanWedgeRates';

// Made-up coordinates only (grid-sized numbers)
const E0 = 500000, N0 = 6500000;
const collar: Vec3 = [E0, N0, 400];
const dist = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// A parent: -60 to grid north, a little lift, 700 m
const parent = forwardTrace(collar, -60, 0, { lift: 0.5, drift: 0 }, 700);

/** A daughter made by hand: off the parent at `kop`, kicked `kick` degrees towards `toolface`, then lift / drift for `length` */
function daughterEnd(kop: number, kick: number, toolface: number, lift: number, drift: number, length: number): Vec3 {
    const at = stationAt(parent, kop)!;
    const t = direction(at.dip, at.azi);
    const up: Vec3 = [-t[2] * t[0], -t[2] * t[1], 1 - t[2] * t[2]];
    const ul = Math.hypot(...up), h: Vec3 = [up[0] / ul, up[1] / ul, up[2] / ul];
    const r: Vec3 = [t[1] * h[2] - t[2] * h[1], t[2] * h[0] - t[0] * h[2], t[0] * h[1] - t[1] * h[0]];
    const k = Math.tan((kick * Math.PI) / 180), a = k * Math.cos((toolface * Math.PI) / 180), b = k * Math.sin((toolface * Math.PI) / 180);
    const s = anglesOf([t[0] + a * h[0] + b * r[0], t[1] + a * h[1] + b * r[1], t[2] + a * h[2] + b * r[2]]);
    return walk({ p: at.p, dip: s.dip, azi: s.azi }, { lift, drift }, length, 1).end.p;
}

const wedgeInput = (over: Partial<HoleInput>): HoleInput => ({
    name: 'P1_W1', mode: 'wedge', collar: { e: null, n: null, rl: null }, rlFromTopo: false, dip: null, azi: null,
    lift: 1, drift: 0, eoh: null, target: { e: null, n: null, rl: null }, method: 'lift-drift', targetDip: null, targetAzi: null,
    extension: 0, kickMax: 3, ratesMode: 'fixed', ...over,
});

describe('parent traces', () => {
    it('a trace from survey stations matches the hole they were taken from', () => {
        const stations = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300].map(d => ({ depth: d, dip: stationAt(parent, d)!.dip, azi: stationAt(parent, d)!.azi }));
        const t = traceFromStations(collar, stations, 300);
        expect(dist(stationAt(t, 300)!.p, stationAt(parent, 300)!.p)).toBeLessThan(0.01);
    });

    it('a trace through sample places runs from the collar along them', () => {
        const depths = [5, 15, 25, 35];
        const t = traceFromPoints(collar, depths, depths.map(d => stationAt(parent, d)!.p))!;
        expect(t.depth[0]).toBe(0);
        expect(t.dip[0]).toBeCloseTo(-60, 1); // the chord to the first sample
        expect(dist(stationAt(t, 25)!.p, stationAt(parent, 25)!.p)).toBeLessThan(1e-6);
    });
});

describe('wedges', () => {
    // A daughter off the parent at 300 m with a 2° kick to the right, lift 1°/100 m, 200 m long
    const target = daughterEnd(300, 2, 90, 1, 0, 200);

    it('finds the kick (size and direction) at a given kick-off depth', () => {
        const s = solveWedgeAt(parent, 300, target, { lift: 1, drift: 0 })!;
        expect(s.converged).toBe(true);
        expect(s.kick).toBeCloseTo(2, 3);
        expect(s.toolface).toBeCloseTo(90, 2);
        expect(s.length).toBeCloseTo(200, 2);
    });

    it('scans every 5 m: 300 m works, and the viable depths make one range', () => {
        const scan = scanWedge(parent, target, { lift: 1, drift: 0 }, { kickMax: 3 });
        expect(scan.viable).toContain(300);
        expect(scan.viable.every(d => d % 5 === 0)).toBe(true);
        expect(scan.ranges).toHaveLength(1);
        expect(rangesText(scan.ranges)).toMatch(/^\d+–\d+ m$/);
    });

    it('plans the daughter from the deepest viable kick-off by default; it reaches its target', () => {
        const r = planWedge(wedgeInput({ target: { e: target[0], n: target[1], rl: target[2] }, extension: 20 }), { parent: { trace: parent, name: 'P1' } });
        expect(r.ok).toBe(true);
        const w = r.wedge!;
        expect(w.kop).toBe(w.deepest);
        expect(w.kick).toBeLessThanOrEqual(3);
        expect(dist(stationAt(r.trace!, r.targetDepth!)!.p, target)).toBeLessThan(0.01);
        expect(r.eoh! - r.targetDepth!).toBeCloseTo(20, 6);
        // The trace is the parent's down to the kick-off
        expect(dist(stationAt(r.trace!, 100)!.p, stationAt(parent, 100)!.p)).toBeLessThan(1e-6);
        expect(r.collar).toEqual([collar[0], collar[1], collar[2]]);
    });

    it('uses a chosen kick-off depth; one that no longer works falls back with a warning', () => {
        const chosen = planWedge(wedgeInput({ target: { e: target[0], n: target[1], rl: target[2] }, kopDepth: 300 }), { parent: { trace: parent, name: 'P1' } });
        expect(chosen.wedge!.kop).toBe(300);
        expect(chosen.wedge!.kick).toBeCloseTo(2, 2);
        const gone = planWedge(wedgeInput({ target: { e: target[0], n: target[1], rl: target[2] }, kopDepth: 5 }), { parent: { trace: parent, name: 'P1' } });
        expect(gone.issues.map(i => i.code)).toContain('kop-moved');
        expect(gone.wedge!.kop).toBe(gone.wedge!.deepest);
    });

    it('says how much kick it would need when no kick-off works', () => {
        const r = planWedge(wedgeInput({ target: { e: target[0], n: target[1], rl: target[2] }, kickMax: 0.5 }), { parent: { trace: parent, name: 'P1' } });
        expect(r.ok).toBe(false);
        expect(r.issues.find(i => i.code === 'no-wedge')!.text).toMatch(/the least needed is \d+\.\d°/);
        expect(planWedge(wedgeInput({ target: { e: target[0], n: target[1], rl: target[2] } }), { parent: null }).issues[0].code).toBe('no-parent');
    });
});
