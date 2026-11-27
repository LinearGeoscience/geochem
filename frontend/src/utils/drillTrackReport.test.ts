import { describe, expect, it } from 'vitest';
import { forwardTrace, type Vec3 } from './drillholePlan';
import { parseCsv } from './drillholePlanIO';
import type { LiveCollar } from './drillTrackImport';
import type { PlannedTrack } from './drillTrackProjection';
import { buildHoleReport, forecastText, meetingTable, missText, reportCsv, requiredText, targetForecast } from './drillTrackReport';
import { holeStations, TRACK_DEFAULTS } from './drillTrackSurveys';

// Made-up hole and coordinates: planned due grid north at -60, target 200 m, end 300 m
const COLLAR: Vec3 = [5000, 7000, 400];
const plan: PlannedTrack = {
    name: 'P01', trace: forwardTrace(COLLAR, -60, 0, { lift: 1, drift: 0 }, 300, 200),
    target: null, targetDepth: 200, eoh: 300, lift: 1, drift: 0,
};
const collar = (patch: Partial<LiveCollar> = {}): LiveCollar => ({
    hole: 'XX010', e: COLLAR[0], n: COLLAR[1], rl: COLLAR[2], planId: 'P01', status: 'InProgress', holeType: 'DD',
    dateStart: '2026-05-01', dateFini: null, maxDepth: 180, liveDepth: null, liveDepthDate: null, ...patch,
});
// Surveys every 10 m to 120 m, lifting 1 °/100 m as planned
const surveys = Array.from({ length: 13 }, (_, k) => ({ hole: 'XX010', depth: k * 10, dip: -60 + 0.01 * k * 10, azi: 0, method: 'GYRO_CONT', grid: 'GRID_50' }));

describe('buildHoleReport', () => {
    it('reports depths, angles, rates and the three projections', () => {
        const r = buildHoleReport({
            collar: collar(), activeWhy: 'status InProgress', link: { hole: 'XX010', planned: 'p/1', how: 'name' },
            program: { name: 'Stage 1', changed: '2026-05-02T10:00:00Z' }, plan, stations: holeStations(surveys), custom: null,
        });
        expect(r.depth).toMatchObject({ current: 180, currentFrom: 'max', max: 180, live: null });
        expect(r.notes[0]).toContain('Max_Depth');
        expect(r.last).toMatchObject({ depth: 120, method: 'GYRO_CONT' });
        expect(r.last!.dip).toBeCloseTo(-58.8, 9);
        expect(r.rates!.lift).toBeCloseTo(1, 9);
        expect(r.projections.map(p => p.kind)).toEqual(['hold', 'recent', 'custom', 'required']);
        // Drilled as planned: the planned rates land on the plan, holding the angles does not
        const custom = r.projections.find(p => p.kind === 'custom')!;
        expect(custom.rates).toEqual({ lift: 1, drift: 0 });
        expect(custom.target!.miss!.distance).toBeLessThan(0.05);
        expect(r.projections.find(p => p.kind === 'recent')!.target!.miss!.distance).toBeLessThan(0.05);
        expect(r.projections.find(p => p.kind === 'hold')!.target!.miss!.high).toBeLessThan(-0.1);
    });

    it('prefers the live depth, and says why nothing is projected', () => {
        const r = buildHoleReport({
            collar: collar({ liveDepth: 190, liveDepthDate: '2026-05-03' }), activeWhy: 'set by hand', link: { hole: 'XX010', planned: null, how: 'unmatched' },
            program: null, plan: null, stations: holeStations([]), custom: null,
        });
        expect(r.depth).toMatchObject({ current: 190, currentFrom: 'live', liveDate: '2026-05-03' });
        expect(r.projections).toEqual([]);
        expect(r.notes).toEqual(['No surveys yet.', 'Not linked to a planned hole (planned hole ID not in the program).']);
    });
});

describe('missText and meetingTable', () => {
    it('says a miss in words', () => {
        expect(missText({ high: 2.34, right: -1.06 })).toBe('2.3 m high, 1.1 m left');
        expect(missText({ high: -0.5, right: 0.01 })).toBe('0.5 m low, 0 right/left');
        expect(missText(null)).toBe('does not reach');
    });

    it('makes a row a hole for the meeting', () => {
        const r = buildHoleReport({
            collar: collar(), activeWhy: 'status InProgress', link: { hole: 'XX010', planned: 'p/1', how: 'name' },
            program: null, plan, stations: holeStations(surveys), custom: null,
        });
        const t = meetingTable([r]);
        expect(t.rows).toHaveLength(1);
        expect(t.rows[0]).toHaveLength(t.columns.length);
        expect(t.rows[0].slice(0, 5)).toEqual(['XX010', 'P01', '0.0', '180.0 (Max_Depth)', '120.0']);
        expect(t.rows[0][t.columns.indexOf('Lift and drift given: at target')]).toBe('0 high/low, 0 right/left; closest 0.0 m');
    });
});

describe('the flag on a hole on track to miss its target', () => {
    // Lifting 3 °/100 m where 1 was planned: the recent rates take it high of the target
    const lifting = Array.from({ length: 13 }, (_, k) => ({ hole: 'XX010', depth: k * 10, dip: -60 + 0.03 * k * 10, azi: 0, method: 'GYRO_CONT', grid: 'GRID_50' }));
    const report = (rows: typeof surveys, missLimit?: number) => buildHoleReport({
        collar: collar(), activeWhy: 'status InProgress', link: { hole: 'XX010', planned: 'p/1', how: 'name' },
        program: null, plan, stations: holeStations(rows), custom: null,
        ...(missLimit !== undefined ? { rules: { ...TRACK_DEFAULTS, missLimit } } : {}),
    });

    it('is not raised for a hole drilled as planned', () => {
        const f = report(surveys).forecast!;
        expect(f).toMatchObject({ kind: 'recent', measure: 'plane', limit: 5, flagged: false });
        expect(f.distance).toBeLessThan(0.05);
    });

    it('is raised beyond the limit, by the recent lift and drift, and the limit can be changed', () => {
        const f = report(lifting).forecast!;
        expect(f.kind).toBe('recent');
        expect(f.distance).toBeGreaterThan(5);
        expect(f.miss!.high).toBeGreaterThan(5);
        expect(f.flagged).toBe(true);
        expect(forecastText(f)).toMatch(/^On track to pass \d+\.\d m from the target \(\d+\.\d m high, 0 right\/left\), more than 5 m \(recent lift and drift\)\.$/);
        const relaxed = report(lifting, Math.ceil(f.distance) + 1).forecast!;
        expect(relaxed.flagged).toBe(false);
        expect(forecastText(relaxed)).toContain('within');
    });

    it('gives the least lift and drift that bring a flagged hole within the limit, as a fourth projection', () => {
        const r = report(lifting);
        const q = r.required!;
        expect(q.holdIsEnough).toBe(false);
        const p = r.projections.find(x => x.kind === 'required')!;
        expect(p.rates).toEqual(q.rates);
        expect(p.target!.miss!.distance).toBeLessThanOrEqual(5);
        expect(Math.hypot(q.rates.lift, q.rates.drift)).toBeLessThan(Math.hypot(q.hit!.lift, q.hit!.drift));
        expect(requiredText(r)).toMatch(/^Least lift \/ drift to come within 5 m: -?\d+\.\d\d \/ -?\d+\.\d\d °\/100 m \(recent .+; to hit the target .+\)\.$/);
        const t = meetingTable([r]);
        expect(t.rows[0][t.columns.indexOf('Least lift / drift to come within tolerance (°/100 m)')]).toMatch(/^-?\d+\.\d\d \/ -?\d+\.\d\d$/);
        const rows = parseCsv(reportCsv([r], { refreshedAt: '', source: '', window: 50 }));
        const head = rows.findIndex(x => x[0] === 'Hole');
        expect(rows[head + 1][rows[head].indexOf('Holding is within limit')]).toBe('no');
    });

    it('goes by holding the last survey when there are too few surveys for rates, and is null without a target', () => {
        const one = report([{ ...lifting[0], depth: 0 }]);
        expect(one.forecast?.kind).toBe('hold');
        expect(targetForecast([], 5)).toBeNull();
        const noTarget = buildHoleReport({
            collar: collar(), activeWhy: '', link: { hole: 'XX010', planned: 'p/1', how: 'name' },
            program: null, plan: { ...plan, targetDepth: null }, stations: holeStations(lifting), custom: null,
        });
        expect(noTarget.forecast).toBeNull();
    });

    it('is in the meeting table and the CSV', () => {
        const r = report(lifting);
        const t = meetingTable([r]);
        expect(t.rows[0][2]).toMatch(/^\d+\.\d — FLAG, more than 5 m$/);
        const rows = parseCsv(reportCsv([r], { refreshedAt: '', source: '', window: 50 }));
        const head = rows.findIndex(x => x[0] === 'Hole');
        expect(rows[head + 1][rows[head].indexOf('Flag')]).toBe('FLAG');
        expect(rows[head + 1][rows[head].indexOf('Flag limit (m)')]).toBe('5.0');
    });
});

describe('reportCsv', () => {
    it('writes a header block, then one row a hole', () => {
        const r = buildHoleReport({
            collar: collar(), activeWhy: 'status InProgress', link: { hole: 'XX010', planned: 'p/1', how: 'name' },
            program: { name: 'Stage 1', changed: null }, plan, stations: holeStations(surveys), custom: { lift: 0, drift: 0 },
        });
        const rows = parseCsv(reportCsv([r], { refreshedAt: '2026-05-03 07:00', source: 'collars.csv + surveys.csv', window: 50 }));
        expect(rows[0]).toEqual(['Drill tracking report']);
        const head = rows.findIndex(x => x[0] === 'Hole');
        expect(rows[head + 1][0]).toBe('XX010');
        expect(rows[head + 1]).toHaveLength(rows[head].length);
        expect(rows[head + 1][rows[head].indexOf('Last survey (m)')]).toBe('120.0');
        expect(rows[head + 1][rows[head].indexOf('Lift and drift given: lift')]).toBe('0.00');
    });
});
