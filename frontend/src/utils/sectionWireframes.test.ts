import { describe, it, expect } from 'vitest';
import { sectionStrings, clipAlong, editedSectionEnds, lineFromEnds, planPoint } from './sectionWireframes';
import { makePart } from '../features/plots/viewer3d/wireframeParsers';
import type { SectionLine } from './sectionProjection';

const E0 = 500000, N0 = 7300000;

describe('sectionStrings', () => {
    const line: SectionLine = { originE: E0, originN: N0, azimuth: 0, halfWidth: 10 };
    // Segment 1: within the slab, parallel to the section. Segment 2: crosses the plane, ends outside the slab.
    const v = Float64Array.from([E0 + 5, N0, 300, E0 + 5, N0 + 50, 310, E0 - 40, N0 + 20, 200, E0 + 40, N0 + 20, 220]);
    const part = makePart('strings', v, new Uint32Array(0), Uint32Array.from([0, 1, 2, 3]));

    it('projects segments within the slab and marks plane crossings', () => {
        const r = sectionStrings(part, line);
        expect(r.lineX).toEqual([0, 50, null]);
        expect(r.lineY).toEqual([300, 310, null]);
        expect(r.crossX).toEqual([20]);
        expect(r.crossY[0]).toBeCloseTo(210, 9);
    });

    it('cuts segments and drops crossings beyond A-B', () => {
        const r = sectionStrings(part, line, [10, 30]);
        expect(r.lineX).toEqual([10, 30, null]);
        expect(r.lineY[0]).toBeCloseTo(302, 9);
        expect(r.lineY[1]).toBeCloseTo(306, 9);
        expect(r.crossX).toEqual([20]);
        expect(sectionStrings(part, line, [25, 40]).crossX).toEqual([]);
    });

    it('ignores triangles (meshes are cut by the scene code)', () => {
        const tri = makePart('tri', Float64Array.from([E0 - 5, N0, 0, E0 + 5, N0, 0, E0, N0 + 5, 10]), Uint32Array.from([0, 1, 2]), new Uint32Array(0));
        const r = sectionStrings(tri, line);
        expect(r.lineX).toEqual([]);
        expect(r.crossX).toEqual([]);
    });
});

describe('clipAlong', () => {
    it('keeps lines inside A-B unchanged', () => {
        expect(clipAlong([0, 10, null, 20, 30], [1, 2, null, 3, 4], -100, 100)).toEqual({ x: [0, 10, null, 20, 30], y: [1, 2, null, 3, 4] });
    });

    it('cuts a line at A and B, interpolating the elevation', () => {
        const r = clipAlong([-50, 0, 50], [100, 110, 120], 25, -25);
        expect(r.x).toEqual([-25, 0, 25]);
        expect(r.y[0]).toBeCloseTo(105, 9);
        expect(r.y[2]).toBeCloseTo(115, 9);
    });

    it('splits a line that leaves the A-B extent and comes back', () => {
        const r = clipAlong([0, 20, 0], [0, 0, 10], -5, 10);
        expect(r.x).toEqual([0, 10, null, 10, 0]);
        expect(r.y).toEqual([0, 0, null, 5, 10]);
    });

    it('drops lines wholly beyond A-B and keeps lone points inside', () => {
        expect(clipAlong([200, 300, null, 5], [0, 0, null, 7], 0, 10)).toEqual({ x: [5], y: [7] });
    });
});

describe('lineFromEnds / planPoint', () => {
    it('puts the origin at the midpoint and the azimuth from A to B', () => {
        const r = lineFromEnds(E0, N0, E0 + 100, N0 + 100)!;
        expect(r.originE).toBe(E0 + 50);
        expect(r.originN).toBe(N0 + 50);
        expect(r.azimuth).toBe(45);
        expect(r.ends[0]).toBeCloseTo(-50 * Math.SQRT2, 6);
        expect(r.ends[1]).toBeCloseTo(50 * Math.SQRT2, 6);
        const a = planPoint(r, r.ends[0]), b = planPoint(r, r.ends[1]);
        expect(a[0]).toBeCloseTo(E0, 6); expect(a[1]).toBeCloseTo(N0, 6);
        expect(b[0]).toBeCloseTo(E0 + 100, 6); expect(b[1]).toBeCloseTo(N0 + 100, 6);
    });

    it('gives azimuths all the way round', () => {
        expect(lineFromEnds(E0, N0, E0 - 10, N0)!.azimuth).toBe(270);
        expect(lineFromEnds(E0, N0, E0, N0 - 10)!.azimuth).toBe(180);
    });

    it('refuses A on top of B', () => {
        expect(lineFromEnds(E0, N0, E0, N0)).toBeNull();
    });

    it('keeps the origin and azimuth exact with round: false', () => {
        const r = lineFromEnds(E0 + 0.3, N0 + 0.7, E0 + 100.3, N0 + 31.7, { round: false })!;
        expect(r.originE).toBeCloseTo(E0 + 50.3, 9);
        expect(r.originN).toBeCloseTo(N0 + 16.2, 9);
        expect(r.azimuth).toBeCloseTo((Math.atan2(100, 31) * 180) / Math.PI, 9);
        const a = planPoint(r, r.ends[0]);
        expect(a[0]).toBeCloseTo(E0 + 0.3, 6); expect(a[1]).toBeCloseTo(N0 + 0.7, 6);
        const rounded = lineFromEnds(E0 + 0.3, N0 + 0.7, E0 + 100.3, N0 + 31.7)!;
        expect(rounded.originE).toBe(E0 + 50);
    });
});

describe('editedSectionEnds', () => {
    const line = { originE: E0, originN: N0, azimuth: 90 };
    const ends: [number, number] = [-100, 100]; // A at E0 − 100, B at E0 + 100

    it('moves the end that was dragged (relayout keys)', () => {
        const r = editedSectionEnds({ 'shapes[0].x1': E0 + 100, 'shapes[0].y1': N0 + 100 }, line, ends, { round: false })!;
        expect(planPoint(r, r.ends[0])[0]).toBeCloseTo(E0 - 100, 6);
        const b = planPoint(r, r.ends[1]);
        expect(b[0]).toBeCloseTo(E0 + 100, 6); expect(b[1]).toBeCloseTo(N0 + 100, 6);
    });

    it('moves both when the line is dragged, from a full shapes array, on another shape index', () => {
        const ev = { shapes: [{}, { x0: E0 - 90, y0: N0 + 10, x1: E0 + 110, y1: N0 + 10 }] };
        const r = editedSectionEnds(ev, line, ends, { shape: 1, round: false })!;
        expect(r.originE).toBeCloseTo(E0 + 10, 9);
        expect(r.originN).toBeCloseTo(N0 + 10, 9);
        expect(r.azimuth).toBeCloseTo(90, 9);
    });

    it('ignores events that did not edit the shape', () => {
        expect(editedSectionEnds({ 'xaxis.range[0]': 3 }, line, ends)).toBeNull();
        expect(editedSectionEnds(null, line, ends)).toBeNull();
    });
});
