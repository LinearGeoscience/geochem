import { describe, expect, it } from 'vitest';
import type { LiveSurvey } from './drillTrackImport';
import { drilledTrace, gridZoneOf, holeStations, presetRules, TRACK_DEFAULTS, windowRates, type TrackRules } from './drillTrackSurveys';

// Made-up holes, coordinates and survey codes
const row = (depth: number, dip: number, azi: number, method: string | null = 'GYRO_CONT', grid: string | null = 'GRID_50'): LiveSurvey =>
    ({ hole: 'XX001', depth, dip, azi, method, grid });

/** A made-up site's rules */
const SITE: TrackRules = presetRules({ ...TRACK_DEFAULTS }, {
    rules: { dropMethods: ['PLANNED', 'COLLAR'], copyMethods: ['SOH', 'EOH'], gridZone: 50, methodRank: ['GYRO_CONT', 'GYRO_MULTI', 'GYRO_SINGLE'] },
});

describe('gridZoneOf', () => {
    it('reads the zone from a grid name', () => {
        expect(gridZoneOf('GRID_50')).toBe(50);
        expect(gridZoneOf('UTM_50_DGPS')).toBe(50);
        expect(gridZoneOf('GRID94_51')).toBe(51);
        expect(gridZoneOf('LOCAL')).toBeNull();
        expect(gridZoneOf(null)).toBeNull();
    });
});

describe('presetRules', () => {
    it('sets the site rules a preset gives and keeps the rest', () => {
        const r = presetRules({ ...TRACK_DEFAULTS, window: 30, missLimit: 12 }, { rules: { copyMethods: ['SOH'], gridZone: 55, window: 999 } as Partial<TrackRules> });
        expect(r).toMatchObject({ copyMethods: ['SOH'], gridZone: 55, window: 30, missLimit: 12, dropMethods: [] });
    });

    it('is neutral by default: no site codes', () => {
        expect(TRACK_DEFAULTS).toMatchObject({ dropMethods: [], copyMethods: [], gridZone: null, methodRank: [] });
    });
});

describe('holeStations', () => {
    it('drops the rules\' dropped methods, start / end copies and rows to another zone', () => {
        const h = holeStations([
            row(0, -60, 90, 'SOH'), row(0, -60, 90, 'PLANNED'), row(0, -60, 90, 'Collar'),
            row(30, -60, 90), row(60, -59.5, 91, 'GYRO_CONT', 'GRID_51'), row(90, -59, 92), row(200, -59, 92, 'EOH'),
        ], SITE);
        expect(h.stations.map(s => s.depth)).toEqual([30, 90]);
        expect(h.dropped).toBe(2);
        expect(h.copies).toBe(2);
        expect(h.otherGrid).toEqual([{ depth: 60, grid: 'GRID_51' }]);
        expect(h.copiesOnly).toBe(false);
    });

    it('keeps every row under the neutral rules', () => {
        const h = holeStations([row(0, -60, 90, 'SOH'), row(30, -60, 90, 'PLANNED'), row(60, -59.5, 91, 'GYRO_CONT', 'GRID_51')]);
        expect(h.stations.map(s => s.depth)).toEqual([0, 30, 60]);
    });

    it('takes a row with no grid as the project grid, and any zone when none is set', () => {
        expect(holeStations([row(10, -60, 90, 'GYRO_CONT', null)], SITE).stations).toHaveLength(1);
        expect(holeStations([row(10, -60, 90, 'GYRO_CONT', 'GRID_51')], { ...SITE, gridZone: null }).stations).toHaveLength(1);
    });

    it('keeps the copies when they are all a hole has', () => {
        const h = holeStations([row(0, -60, 90, 'SOH'), row(150, -60, 90, 'EOH')], SITE);
        expect(h.copiesOnly).toBe(true);
        expect(h.stations.map(s => s.depth)).toEqual([0, 150]);
    });

    it('keeps the better method of two rows at one depth, else the first', () => {
        const h = holeStations([row(30, -61, 90, 'GYRO_SINGLE'), row(30, -60, 91, 'GYRO_CONT'), row(30, -62, 92, 'MYSTERY')], SITE);
        expect(h.stations).toEqual([{ depth: 30, dip: -60, azi: 91, method: 'GYRO_CONT' }]);
        const neutral = holeStations([row(30, -61, 90, 'GYRO_SINGLE'), row(30, -60, 91, 'GYRO_CONT')]);
        expect(neutral.stations[0].method).toBe('GYRO_SINGLE');
    });
});

describe('drilledTrace', () => {
    it('follows a straight hole and runs straight on past its last survey', () => {
        const t = drilledTrace([1000, 2000, 300], [{ depth: 0, dip: -60, azi: 90 }, { depth: 100, dip: -60, azi: 90 }], 150)!;
        const i100 = t.depth.indexOf(100), end = t.depth.length - 1;
        expect(t.depth[0]).toBe(0);
        expect(t.depth[end]).toBe(150);
        expect(t.xyz[i100 * 3]).toBeCloseTo(1050, 6);
        expect(t.xyz[i100 * 3 + 1]).toBeCloseTo(2000, 6);
        expect(t.xyz[i100 * 3 + 2]).toBeCloseTo(300 - 86.6025, 3);
        expect(t.xyz[end * 3]).toBeCloseTo(1075, 6);
        expect(t.dip[end]).toBeCloseTo(-60, 9);
        expect(t.azi[end]).toBeCloseTo(90, 9);
    });

    it('starts at the collar along the first survey when that is below it', () => {
        const t = drilledTrace([0, 0, 0], [{ depth: 20, dip: -90, azi: 0 }, { depth: 40, dip: -90, azi: 0 }])!;
        expect(t.depth[0]).toBe(0);
        expect(t.xyz[(t.depth.length - 1) * 3 + 2]).toBeCloseTo(-40, 9);
    });

    it('is null without stations', () => {
        expect(drilledTrace([0, 0, 0], [])).toBeNull();
    });
});

describe('windowRates', () => {
    // Lift 3 and drift 5 °/100 m, the azimuth passing through north
    const steady = Array.from({ length: 21 }, (_, k) => ({ depth: k * 10, dip: -60 + 0.03 * k * 10, azi: (350 + 0.05 * k * 10) % 360 }));

    it('fits lift and drift over the last stretch, drift through north as one line', () => {
        const r = windowRates(steady)!;
        expect(r.lift).toBeCloseTo(3, 9);
        expect(r.drift).toBeCloseTo(5, 9);
        expect(r.n).toBe(6);
        expect(r.from).toBe(150);
        expect(r.to).toBe(200);
        expect(r.dipSd).toBeCloseTo(0, 9);
        expect(r.enough).toBe(true);
        expect(r.nearVertical).toBe(false);
    });

    it('shows the scatter of noisy surveys', () => {
        const noisy = steady.map((s, k) => ({ ...s, dip: s.dip + (k % 2 ? 0.5 : -0.5) }));
        const r = windowRates(noisy, { window: 200, minStations: 3 })!;
        expect(r.n).toBe(21);
        expect(r.lift).toBeCloseTo(3, 0);
        expect(r.dipSd).toBeGreaterThan(0.4);
        expect(r.liftSe).toBeGreaterThan(0);
    });

    it('marks too few stations, and is null with fewer than two', () => {
        const r = windowRates([{ depth: 0, dip: -60, azi: 90 }, { depth: 40, dip: -59, azi: 90 }])!;
        expect(r.lift).toBeCloseTo(2.5, 9);
        expect(r.enough).toBe(false);
        expect(Number.isNaN(r.dipSd)).toBe(true);
        expect(windowRates([{ depth: 0, dip: -60, azi: 90 }])).toBeNull();
        expect(windowRates([])).toBeNull();
    });

    it('says when the hole is near vertical', () => {
        expect(windowRates([{ depth: 0, dip: -88, azi: 90 }, { depth: 30, dip: -87, azi: 120 }])!.nearVertical).toBe(true);
    });
});
