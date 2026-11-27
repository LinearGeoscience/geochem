import { describe, expect, it } from 'vitest';
import { forwardTrace, stationAt, type PlanResult, type Vec3 } from './drillholePlan';
import { parseCsv } from './drillholePlanIO';
import {
    guessPlannedCollarColumns, plannedKey, plannedRefs, plannedTrackOf, programHolesFromFiles, readPlannedCollars, solvedFromResult, solvedTrace, thinTrace, type PlannedProgram,
} from './plannedPrograms';

// Made-up holes and coordinates
const COLLAR: Vec3 = [3000, 6000, 250];

describe('thinTrace', () => {
    it('keeps a station every 5 m, the ends and the depths asked for', () => {
        const t = forwardTrace(COLLAR, -60, 90, { lift: 2, drift: 1 }, 52.5, 31.25);
        const s = thinTrace(t, [31.25]);
        expect(s.depth).toEqual([0, 5, 10, 15, 20, 25, 30, 31.25, 35, 40, 45, 50, 52.5]);
        expect(s.xyz).toHaveLength(s.depth.length * 3);
        // Straight between 5 m stations is a few millimetres off the 1 m path (the chord's sag: 5² × curvature / 8, ~1.2 mm here)
        const back = solvedTrace({ ...s, target: null, targetDepth: null, eoh: 52.5, lift: 2, drift: 1 });
        const a = stationAt(t, 42)!.p, b = stationAt(back, 42)!.p;
        expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(5e-3);
    });

    it('keeps both stations of a kick', () => {
        const t = forwardTrace(COLLAR, -60, 90, { lift: 0, drift: 0 }, 12);
        const kicked = {
            depth: Float64Array.from([...t.depth.slice(0, 8), 7, 8, 9, 10, 11, 12]),
            dip: Float64Array.from([...t.dip.slice(0, 8), -58, -58, -58, -58, -58, -58]),
            azi: Float64Array.from([...t.azi.slice(0, 8), 92, 92, 92, 92, 92, 92]),
            xyz: Float64Array.from([...t.xyz.slice(0, 24), ...t.xyz.slice(21, 39)]),
        };
        const s = thinTrace(kicked);
        expect(s.depth).toEqual([0, 5, 7, 7, 10, 12]);
        expect(s.dip[2]).toBeCloseTo(-60, 9);
        expect(s.dip[3]).toBe(-58);
    });
});

describe('solvedFromResult and plannedTrackOf', () => {
    const trace = forwardTrace(COLLAR, -70, 180, { lift: 1.5, drift: -1 }, 320, 250);
    const result: PlanResult = {
        ok: true, collar: COLLAR, collarDip: -70, collarAzi: 180, lift: 1.5, drift: -1, solvedRates: false,
        target: stationAt(trace, 250)!.p, targetDip: null, targetAzi: null, targetDepth: 250, eoh: 320, trace, issues: [], miss: null,
    };

    it('keeps the path, target and end of a hole the planner worked out', () => {
        const s = solvedFromResult(result)!;
        expect(s.depth[0]).toBe(0);
        expect(s.depth).toContain(250);
        expect(s.depth[s.depth.length - 1]).toBe(320);
        expect(s).toMatchObject({ targetDepth: 250, eoh: 320, lift: 1.5, drift: -1 });
        expect(s.parentName).toBeUndefined();
        expect(solvedFromResult({ ...result, ok: false })).toBeNull();
    });

    it('gives tracking the planned hole', () => {
        const solved = solvedFromResult(result)!;
        const input = { name: 'P07', fromTarget: 'T3' } as PlannedProgram['holes'][number]['input'];
        const track = plannedTrackOf({ id: 'a', input, topo: null, style: { color: '#000', width: 3 }, visible: true, solved })!;
        expect(track.name).toBe('P07');
        expect(stationAt(track.trace, 250)!.p[2]).toBeCloseTo(stationAt(trace, 250)!.p[2], 3);
        expect(plannedTrackOf({ id: 'b', input, topo: null, style: { color: '#000', width: 3 }, visible: true, solved: null })).toBeNull();
    });
});

describe('plannedRefs', () => {
    it('names each hole by its key, name and target ID', () => {
        const program = {
            id: 'prog1', holes: [
                { id: 'h1', input: { name: 'P01_W1', fromTarget: 'T05' } }, { id: 'h2', input: { name: 'P02', fromTarget: 'P02' } }, { id: 'h3', input: { name: 'P03' } },
            ],
        } as unknown as PlannedProgram;
        expect(plannedRefs(program)).toEqual([
            { key: plannedKey('prog1', 'h1'), name: 'P01_W1', targetId: 'T05' },
            { key: 'prog1/h2', name: 'P02', targetId: null },
            { key: 'prog1/h3', name: 'P03', targetId: null },
        ]);
    });
});

describe('readPlannedCollars', () => {
    it('reads the planner\'s own collar export and reports rows it cannot use', () => {
        const rows = parseCsv([
            'HoleID,Easting,Northing,RL,Dip,Azi_grid,EOH,TargetDepth,TargetE,TargetN,TargetRL,TargetID',
            'P01,100,200,50,-60,90,300,250,310,200,-150,T1',
            'P02,,200,50,-60,90,300,,,,,',
            'P01,1,2,3,,,,,,,,',
            ',1,2,3,,,,,,,,',
        ].join('\n'));
        const cols = guessPlannedCollarColumns(rows[0]);
        expect(cols).toMatchObject({ hole: 0, e: 1, n: 2, rl: 3, dip: 4, azi: 5, eoh: 6, targetDepth: 7, targetE: 8, targetN: 9, targetRL: 10, targetId: 11 });
        const { collars, problems } = readPlannedCollars(rows, cols);
        expect(collars).toEqual([{ hole: 'P01', collar: [100, 200, 50], eoh: 300, target: [310, 200, -150], targetDepth: 250, targetId: 'T1', dip: -60, azi: 90 }]);
        expect(problems).toEqual(['P02: no collar coordinates; left out.', 'P01 is in the collar file twice; the first is kept.', 'Collar row 5: no hole ID.']);
    });

    it('takes an Acquire collar export\'s columns', () => {
        const cols = guessPlannedCollarColumns(['HOLEID', 'EAST', 'NORTH', 'RL', 'Max_Depth', 'East_20', 'North_20', 'RL_20']);
        expect(cols).toMatchObject({ hole: 0, e: 5, n: 6, rl: 7, eoh: 4 });
    });
});

describe('programHolesFromFiles', () => {
    const colors = ['#111', '#222'];
    const base = { eoh: null, target: null, targetDepth: null, targetId: null, dip: null, azi: null };

    it('makes holes planned by collar from surveys, with their overall lift and drift', () => {
        const stations = Array.from({ length: 11 }, (_, k) => ({ depth: k * 30, dip: -65 + 0.02 * k * 30, azi: 45 + 0.01 * k * 30 }));
        const { holes, problems } = programHolesFromFiles(
            [{ ...base, hole: 'Q1', collar: COLLAR, targetDepth: 200, targetId: 'T1' }], new Map([['Q1', stations]]), colors);
        expect(problems).toEqual([]);
        const h = holes[0];
        expect(h.input).toMatchObject({ name: 'Q1', mode: 'collar', dip: -65, azi: 45, eoh: 300, fromTarget: 'T1' });
        expect(h.input.lift).toBeCloseTo(2, 6);
        expect(h.input.drift).toBeCloseTo(1, 6);
        expect(h.solved!.targetDepth).toBe(200);
        expect(h.solved!.target).not.toBeNull();
        expect(h.style.color).toBe('#111');
    });

    it('works out a target point\'s depth, uses collar angles without surveys, and reports what it cannot use', () => {
        const straight = forwardTrace(COLLAR, -50, 270, { lift: 0, drift: 0 }, 200);
        const target = stationAt(straight, 120)!.p;
        const { holes, problems } = programHolesFromFiles([
            { ...base, hole: 'Q2', collar: COLLAR, dip: -50, azi: 270, eoh: 200, target },
            { ...base, hole: 'Q3', collar: COLLAR },
        ], new Map(), colors);
        expect(holes).toHaveLength(1);
        expect(holes[0].solved!.targetDepth).toBeCloseTo(120, 6);
        expect(problems).toEqual(['Q3: no surveys, and no dip, azimuth and end of hole on its collar row; left out.']);
    });
});
