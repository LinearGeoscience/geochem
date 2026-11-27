import { describe, expect, it } from 'vitest';
import { forwardTrace, stationAt, type HoleInput, type Vec3 } from './drillholePlan';
import type { LiveCollar, LiveSurvey } from './drillTrackImport';
import { runTracking } from './drillTrackRun';
import { thinTrace, type PlannedProgram, type ProgramHole } from './plannedPrograms';

// Made-up program and holes
const C1: Vec3 = [8000, 9000, 120], C2: Vec3 = [8100, 9000, 121];

const hole = (id: string, name: string, collar: Vec3, extra: Partial<HoleInput> = {}): ProgramHole => {
    const t = forwardTrace(collar, -60, 0, { lift: 0, drift: 0 }, 300, 200);
    return {
        id, input: { name, mode: 'collar', ...extra } as HoleInput, topo: null, style: { color: '#000', width: 3 }, visible: true,
        solved: { ...thinTrace(t, [200]), target: stationAt(t, 200)!.p, targetDepth: 200, eoh: 300, lift: 0, drift: 0 },
    };
};
const program: PlannedProgram = {
    id: 'prog', name: 'Stage 1', color: '#f00', source: 'planner', created: '2026-01-01T00:00:00Z', changed: '2026-01-02T00:00:00Z',
    holes: [
        hole('a', 'P01', C1),
        hole('b', 'P02', C2),
        hole('c', 'P02_W1', C2, { mode: 'wedge', parent: { kind: 'planned', id: 'b' }, fromTarget: 'T5' }),
        hole('d', 'P03', [8200, 9000, 120]),
    ],
};

const collar = (hole: string, at: Vec3, patch: Partial<LiveCollar>): LiveCollar => ({
    hole, e: at[0], n: at[1], rl: at[2], planId: null, status: null, holeType: 'DD', dateStart: '2026-02-01', dateFini: null,
    maxDepth: null, liveDepth: null, liveDepthDate: null, ...patch,
});
const rows = (hole: string, list: [number, number, number][]): LiveSurvey[] =>
    list.map(([depth, dip, azi]) => ({ hole, depth, dip, azi, method: 'GYRO_CONT', grid: 'GRID_50' }));

const parentRows: [number, number, number][] = [[0, -60, 0], [50, -60, 0], [100, -60, 0], [150, -60, 0], [250, -60, 0]];
const live = {
    collars: [
        collar('D01', C1, { planId: 'P01', status: 'InProgress' }),
        collar('D02', C2, { planId: 'p02', status: 'Complete', dateFini: '2026-02-10', dateStart: '2026-02-01' }),
        collar('D02W1', C2, { planId: 'P02', status: 'InProgress', dateStart: '2026-02-12' }),
        collar('D09', [7000, 9000, 120], { planId: 'Q9', status: 'InProgress' }),
        collar('D00', [7000, 9100, 120], { planId: 'P01', status: 'Abandoned', dateStart: '2026-01-20' }),
    ],
    surveys: [
        ...rows('D01', [[0, -60, 0], [30, -60, 0], [60, -60.2, 0.3], [90, -60.4, 0.6]]),
        ...rows('D02', parentRows),
        ...rows('D02W1', [...parentRows.slice(0, 3), [130, -58, 4], [160, -57, 6]]),
        ...rows('D09', [[0, -70, 90], [40, -70, 90]]),
    ],
    source: { collarFile: 'c.csv', surveyFile: 's.csv', readAt: '2026-02-15T07:00:00Z' }, problems: [],
};

describe('runTracking', () => {
    const r = runTracking({ program, live });

    it('links by name without case, and a wedge carrying its parent\'s ID to the one wedge planned off that parent', () => {
        const by = new Map(r.links.map(l => [l.hole, l]));
        expect(by.get('D01')).toMatchObject({ planned: 'prog/a', how: 'name' });
        expect(by.get('D02')).toMatchObject({ planned: 'prog/b', how: 'name' });
        expect(by.get('D02W1')).toMatchObject({ planned: 'prog/c', how: 'wedge' });
        expect(by.get('D09')).toMatchObject({ planned: null, how: 'unmatched' });
        expect(r.wedges).toEqual([{ parent: 'D02', daughter: 'D02W1', kop: 100 }]);
    });

    it('reports on the holes being drilled only', () => {
        expect(r.reports.map(x => x.hole)).toEqual(['D01', 'D02W1', 'D09']);
        const d01 = r.reports[0];
        expect(d01.planned).toBe('P01');
        expect(d01.program).toBe('Stage 1');
        expect(d01.projections).toHaveLength(4);
        expect(r.reports[1].wedgeOf).toEqual({ parent: 'D02', kop: 100 });
        expect(r.reports[1].planned).toBe('P02_W1');
        expect(r.activeUnlinked.map(l => l.hole)).toEqual(['D09']);
    });

    it('says which planned holes are drilled, being drilled or not yet, and which drilled hole is tracked', () => {
        expect(r.planned.map(p => [p.name, p.state, p.tracked, p.drilled])).toEqual([
            ['P01', 'drilling', 'D01', ['D01', 'D00']],
            ['P02', 'drilled', 'D02', ['D02']],
            ['P02_W1', 'drilling', 'D02W1', ['D02W1']],
            ['P03', 'not drilled', null, []],
        ]);
    });

    it('leaves a wedge for assigning by hand when no one wedge is planned off its parent, and a hand choice wins', () => {
        const noWedge = { ...program, holes: program.holes.filter(h => h.id !== 'c') };
        expect(runTracking({ program: noWedge, live }).links.find(l => l.hole === 'D02W1')).toMatchObject({ planned: null, how: 'wedge' });
        const manual = runTracking({ program, live, manualLinks: { D02W1: 'prog/d' }, activeOverride: { D09: 'off' } });
        expect(manual.links.find(l => l.hole === 'D02W1')).toMatchObject({ planned: 'prog/d', how: 'manual' });
        expect(manual.reports.map(x => x.hole)).toEqual(['D01', 'D02W1']);
    });

    it('works with no program and no data', () => {
        expect(runTracking({ program: null, live: null })).toMatchObject({ reports: [], planned: [], links: [] });
        expect(runTracking({ program: null, live }).reports.every(x => x.projections.length === 0)).toBe(true);
    });
});
