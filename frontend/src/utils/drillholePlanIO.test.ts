import { describe, it, expect } from 'vitest';
import { HoleInput, forwardTrace, planHole, stationAt } from './drillholePlan';
import { planWedge } from './drillholePlanWedgeRates';
import { flatTopography } from './drillholePlanTopo';
import {
    collarCsv, csvKind, inputFromCollarRow, parseCsv, readCollarCsv, readSurveyCsv, surveyCsv, surveyDepths, surveyMismatch,
    traceDxf, traceFromCollarRow, ExportHole, guessTargetColumns, readTargets,
} from './drillholePlanIO';

// Made-up coordinates only (grid-sized numbers)
const E0 = 500000, N0 = 6500000;

const input = (over: Partial<HoleInput>): HoleInput => ({
    name: 'P001', mode: 'collar', collar: { e: null, n: null, rl: null }, rlFromTopo: false,
    dip: null, azi: null, lift: null, drift: null, eoh: null,
    target: { e: null, n: null, rl: null }, method: 'surface-straight', targetDip: null, targetAzi: null, extension: 0,
    ...over,
});

describe('CSV', () => {
    it('parses quoted cells and line endings', () => {
        expect(parseCsv('a,"b,1","c ""q"""\r\n1,2,3\n\n')).toEqual([['a', 'b,1', 'c "q"'], ['1', '2', '3']]);
    });

    it('survey depths: the interval, the target and the end of hole', () => {
        expect(surveyDepths(100, 45.5, 30)).toEqual([0, 30, 45.5, 60, 90, 100]);
        expect(surveyDepths(90, 90, 30)).toEqual([0, 30, 60, 90]);
    });
});

describe('wedges in the collar CSV', () => {
    it('keep solved / fixed rates and a hole’s own lift and drift limits', () => {
        const parent = forwardTrace([E0, N0, 400], -60, 90, { lift: 0, drift: 0 }, 700);
        const at = stationAt(parent, 550)!.p;
        const own = { liftMin: -1, liftMax: 4, driftMin: -3, driftMax: 2 };
        const mk = (name: string, over: Partial<HoleInput>): ExportHole => {
            const i = input({ name, mode: 'wedge', target: { e: at[0], n: at[1] + 10, rl: at[2] }, lift: 0, drift: 0, kickMax: 3, ...over });
            return { name, input: i, result: planWedge(i, { parent: { trace: parent, name: 'P1' } }), topography: '', parentName: 'P1' };
        };
        const holes = [mk('P1_W1', { rateLimits: own }), mk('P1_W2', { ratesMode: 'fixed' }), mk('P1_W3', {})];
        expect(holes.every(h => h.result.ok)).toBe(true);
        const { rows, problems } = readCollarCsv(collarCsv(holes));
        expect(problems).toEqual([]);
        const back = rows.map(r => inputFromCollarRow(r, false).input);
        expect(back[0]).toMatchObject({ mode: 'wedge', ratesMode: 'solve', rateLimits: own, parent: { kind: 'name', name: 'P1' } });
        expect(back[1]).toMatchObject({ ratesMode: 'fixed', rateLimits: null });
        expect(back[2]).toMatchObject({ ratesMode: 'solve', rateLimits: null });
    });
});

describe('export → import round trip', () => {
    // A long curved hole (≥ 500 m), solved from a typed collar with given target angles, with an extension
    const holes: ExportHole[] = [
        {
            name: 'P001', topography: '',
            input: input({ name: 'P001', mode: 'target', collar: { e: E0, n: N0, rl: 420 }, target: { e: E0 + 260, n: N0 + 330, rl: -120 }, method: 'target-angles', targetDip: -50, targetAzi: 45, extension: 30 }),
            result: null as never,
        },
        {
            name: 'P002', topography: '',
            input: input({ name: 'P002', mode: 'collar', collar: { e: E0 - 300, n: N0 + 50, rl: 410 }, dip: -65, azi: 357, lift: 2.5, drift: 3, eoh: 640 }),
            result: null as never,
        },
        {
            name: 'P003', topography: 'Flat RL 400',
            input: input({ name: 'P003', mode: 'target', target: { e: E0 + 50, n: N0 - 400, rl: 0 }, method: 'surface-curved', targetDip: -60, targetAzi: 200, lift: 1.5, drift: -2, extension: 0 }),
            result: null as never,
        },
    ];
    const topo = flatTopography(400, 'Flat RL 400');
    for (const h of holes) h.result = planHole(h.input, { topo: h.name === 'P003' ? topo : null });

    it('plans all three holes', () => {
        for (const h of holes) expect(h.result.ok).toBe(true);
        expect(holes[0].result.eoh!).toBeGreaterThan(500);
    });

    const collarText = collarCsv(holes);
    const surveyText = surveyCsv(holes, 30);

    it('writes 3 decimals on coordinates and 4 on angles, and recognises its files', () => {
        const row = parseCsv(collarText)[1];
        expect(row[1]).toMatch(/^\d+\.\d{3}$/);
        expect(row[4]).toMatch(/^-\d+\.\d{4}$/);
        expect(csvKind(collarText)).toBe('collar');
        expect(csvKind(surveyText)).toBe('survey');
    });

    it('rebuilds every hole from its collar row within 0.01 m of the survey', () => {
        const { rows, problems } = readCollarCsv(collarText);
        expect(problems).toEqual([]);
        expect(rows).toHaveLength(3);
        const surveys = readSurveyCsv(surveyText);
        for (const row of rows) {
            const trace = traceFromCollarRow(row)!;
            const worst = surveyMismatch(trace, surveys.get(row.name)!);
            expect(worst.distance).toBeLessThan(0.01);
        }
    });

    it('re-plans each hole in its own mode: the same trace to 0.01 m / 0.01°', () => {
        const { rows } = readCollarCsv(collarText);
        for (const row of rows) {
            const { input: back, note } = inputFromCollarRow(row, row.topography === 'Flat RL 400');
            expect(note).toBeNull();
            const again = planHole(back, { topo: row.topography ? topo : null });
            const before = holes.find(h => h.name === row.name)!.result;
            expect(again.ok).toBe(true);
            expect(again.eoh!).toBeCloseTo(before.eoh!, 2);
            for (const d of [0, before.targetDepth ?? 0, before.eoh!]) {
                const a = stationAt(again.trace!, Math.min(d, again.eoh!))!, b = stationAt(before.trace!, d)!;
                expect(Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2])).toBeLessThan(0.01);
                expect(Math.abs(a.dip - b.dip)).toBeLessThan(0.01);
            }
        }
    });

    it('a hole projected to a topography that is not here keeps its collar', () => {
        const row = readCollarCsv(collarText).rows.find(r => r.name === 'P003')!;
        const { input: back, note } = inputFromCollarRow(row, false);
        expect(note).toMatch(/not in this project/);
        expect(back.method).toBe('target-angles');
        const again = planHole(back, { topo: null });
        expect(again.ok).toBe(true);
        expect(Math.hypot(again.collar![0] - row.collar![0], again.collar![1] - row.collar![1])).toBeLessThan(0.01);
    });

    it('reports a survey that does not match its collar row', () => {
        const row = readCollarCsv(collarText).rows[1];
        const stations = readSurveyCsv(surveyText).get(row.name)!.map((s, i) => (i === 5 ? { ...s, azi: s.azi + 1 } : s));
        expect(surveyMismatch(traceFromCollarRow(row)!, stations).distance).toBeGreaterThan(0.01);
    });

    it('writes a DXF polyline per hole', () => {
        const dxf = traceDxf(holes);
        expect(dxf.match(/POLYLINE/g)).toHaveLength(3);
        expect(dxf).toContain('PLAN_P001');
        expect(dxf.trim().endsWith('EOF')).toBe(true);
    });
});

describe('target CSV', () => {
    it('guesses the ID, Easting, Northing and RL columns', () => {
        expect(guessTargetColumns(['Target', 'Easting', 'Northing', 'RL', 'Comment'])).toEqual({ id: 0, e: 1, n: 2, rl: 3 });
        expect(guessTargetColumns(['HOLEID', 'X', 'Y', 'Z'])).toEqual({ id: 0, e: 1, n: 2, rl: 3 });
        expect(guessTargetColumns(['Name', 'East_20', 'North_20', 'Elevation'])).toEqual({ id: 0, e: 1, n: 2, rl: 3 });
        expect(guessTargetColumns(['a', 'b']).rl).toBe(-1);
        // Grid columns before local ones, whichever comes first
        expect(guessTargetColumns(['name', 'X_LOC', 'X_MGA', 'Y_MGA', 'Z_MGA', 'Y_LOC', 'Z_LOC'])).toEqual({ id: 0, e: 2, n: 3, rl: 4 });
        expect(guessTargetColumns(['name', 'X_MGA', 'Y_MGA', 'Z_MGA', 'X_LOC', 'Y_LOC', 'Z_LOC'])).toEqual({ id: 0, e: 1, n: 2, rl: 3 });
    });

    it('reads the targets, listing bad rows and repeated IDs', () => {
        const rows = parseCsv(`ID,E,N,RL\nT1,${E0 + 10},${N0 + 20},-150.5\nT2,${E0 + 30},,-100\n,${E0},${N0},0\nT1,${E0},${N0},0\nT3,${E0 + 50.125},${N0 - 5},-200\n`);
        const { targets, bad, repeated } = readTargets(rows, guessTargetColumns(rows[0]));
        expect(targets).toEqual([
            { id: 'T1', e: E0 + 10, n: N0 + 20, rl: -150.5 },
            { id: 'T3', e: E0 + 50.125, n: N0 - 5, rl: -200 },
        ]);
        expect(bad).toEqual([3, 4]); // file lines
        expect(repeated).toEqual(['T1']);
        // Pads: a name used twice is two places; both kept
        const pads = readTargets(rows, guessTargetColumns(rows[0]), { keepRepeats: true });
        expect(pads.targets.map(t => t.id)).toEqual(['T1', 'T1 (2)', 'T3']);
    });
});
