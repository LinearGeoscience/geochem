import { describe, it, expect } from 'vitest';
import { offSlice, sliceThrough, snapToSlice, startOnSlice, uprightSection } from './drillholePlanSlice';
import { projectPoint } from './sectionProjection';

// Made-up coordinates only (grid-sized numbers)
const E0 = 500000, N0 = 6500000;

describe('planning on a slice', () => {
    // An upright slice through (E0, N0) facing east-north-east
    const a = (20 * Math.PI) / 180;
    const plane = { normal: [Math.cos(a), Math.sin(a), 0], point: [E0, N0, 0] };

    it('measures and removes the distance from the slice', () => {
        const p = [E0 + 30, N0 - 10, 150];
        const d = offSlice(p, plane);
        expect(d).toBeCloseTo(30 * Math.cos(a) - 10 * Math.sin(a), 9);
        const s = snapToSlice(p, plane);
        expect(offSlice(s, plane)).toBeCloseTo(0, 9);
        expect(s[2]).toBe(150); // an upright slice keeps the RL
    });

    it('moves the slice through a point, keeping its orientation', () => {
        const p = [E0 + 30, N0 - 10, 150];
        const moved = { normal: plane.normal, point: sliceThrough(plane, p) };
        expect(offSlice(p, moved)).toBeCloseTo(0, 9);
        expect(offSlice(plane.point, moved)).toBeCloseTo(-offSlice(p, plane), 9);
    });

    it('describes an upright slice as a cross-section (same along / offset convention)', () => {
        const sec = uprightSection(plane, 50)!;
        expect(sec.halfWidth).toBe(25);
        // A point on the slice is on the section line; one off it is off by the same distance
        const on = snapToSlice([E0 + 100, N0 + 40, 0], plane);
        expect(Math.abs(projectPoint(on[0], on[1], sec).offset)).toBeLessThan(1e-9);
        const off = [E0 + 100, N0 + 40, 0];
        expect(Math.abs(projectPoint(off[0], off[1], sec).offset)).toBeCloseTo(Math.abs(offSlice(off, plane)), 9);
    });

    it('starts a new hole along an upright slice', () => {
        const s = startOnSlice(plane, 100, 400, -60);
        expect(offSlice(s.target, plane)).toBeCloseTo(0, 9);
        expect(offSlice(s.collar, plane)).toBeCloseTo(0, 9);
        expect(s.collar[2]).toBeCloseTo(400, 9);
        // From collar to target: down at 60° along the azimuth given
        const d = [s.target[0] - s.collar[0], s.target[1] - s.collar[1], s.target[2] - s.collar[2]];
        expect((Math.atan2(-d[2], Math.hypot(d[0], d[1])) * 180) / Math.PI).toBeCloseTo(60, 9);
        expect(((Math.atan2(d[0], d[1]) * 180) / Math.PI + 360) % 360).toBeCloseTo(s.azimuth, 9);
    });

    it('has no cross-section for a level or leaning slice', () => {
        expect(uprightSection({ normal: [0, 0, 1], point: [E0, N0, 0] }, 10)).toBeNull();
        expect(uprightSection({ normal: [0.6, 0, 0.8], point: [E0, N0, 0] }, 10)).toBeNull();
    });
});
