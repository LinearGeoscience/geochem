import { describe, it, expect } from 'vitest';
import { snapToPad, PAD_DEFAULTS, Pad } from './drillholePlanPads';
import { forwardTrace, stationAt } from './drillholePlan';
import { flatTopography } from './drillholePlanTopo';

// Made-up coordinates only (grid-sized numbers)
const E0 = 500000, N0 = 6500000;
const opts = { topo: flatTopography(400), ...PAD_DEFAULTS, maxBackLength: 2000 };
const target: [number, number, number] = [E0, N0, 0];
const guide = { dip: -60, azi: 90, lift: 0, drift: 0 }; // the guide hole comes up towards the west

describe('snapping a collar to the nearest pad', () => {
    // The guide reaches the surface 400 / tan 60 ≈ 231 m west of the target
    const guideE = E0 - 400 / Math.tan((60 * Math.PI) / 180);

    it('takes the pad whose hole is closest in direction to the guide, with the pad RL', () => {
        const pads: Pad[] = [
            { id: 'NEAR-BUT-STEEP', p: [E0 - 60, N0, 395] },        // close in plan, but a much steeper hole
            { id: 'GOOD', p: [guideE + 25, N0 + 10, 392.5] },       // near the guide's collar
            { id: 'FAR', p: [guideE - 900, N0, 400] },              // outside the radius
        ];
        const r = snapToPad(target, guide, pads, opts);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.pad.id).toBe('GOOD');
        expect(r.aziChange).toBeLessThan(5);
        // The hole from the pad (its own RL, not the topography's) reaches the target
        const t = forwardTrace(r.pad.p, r.collarDip, r.collarAzi, guide, r.length);
        const end = stationAt(t, r.length)!.p;
        expect(Math.hypot(end[0] - target[0], end[1] - target[1], end[2] - target[2])).toBeLessThan(0.01);
        expect(t.xyz[2]).toBe(392.5);
    });

    it('keeps to the guide: a pad needing a big change is not taken', () => {
        const r = snapToPad(target, guide, [{ id: 'STEEP', p: [E0 - 60, N0, 395] }], opts);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/within ±15° dip/);
    });

    it('says when there is no pad near the guide', () => {
        const r = snapToPad(target, guide, [{ id: 'FAR', p: [guideE - 900, N0, 400] }], opts);
        expect(r.ok ? '' : r.reason).toMatch(/No pad within 300 m/);
        expect(snapToPad(target, guide, [], opts).ok).toBe(false);
    });

    it('works with lift and drift (the collar dip and azimuth are solved)', () => {
        const curved = { ...guide, lift: 2, drift: 1 };
        const r = snapToPad(target, curved, [{ id: 'P', p: [guideE + 30, N0 - 20, 401] }], opts);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const t = forwardTrace(r.pad.p, r.collarDip, r.collarAzi, curved, r.length);
        const end = stationAt(t, r.length)!.p;
        expect(Math.hypot(end[0] - target[0], end[1] - target[1], end[2] - target[2])).toBeLessThan(0.01);
    });
});
