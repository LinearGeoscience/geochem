import { describe, it, expect } from 'vitest';
import { flatTopography, isClosedMesh, meshTopography } from './drillholePlanTopo';

// Made-up coordinates only (grid-sized numbers)
const E0 = 500000, N0 = 6500000;

describe('flat topography', () => {
    it('is everywhere at its RL', () => {
        const t = flatTopography(350);
        expect(t.topAt(E0, N0)).toBe(350);
        expect(t.inExtent(0, 0)).toBe(true);
        expect(t.firstHit([E0, N0, 300], [E0, N0, 400])).toBeCloseTo(0.5, 12);
        expect(t.firstHit([E0, N0, 300], [E0, N0, 340])).toBeNull();
    });
});

describe('mesh topography', () => {
    // A tilted square of two triangles: z = 400 + 0.1 (x − E0)
    const v = new Float64Array([E0 - 100, N0 - 100, 390, E0 + 100, N0 - 100, 410, E0 + 100, N0 + 100, 410, E0 - 100, N0 + 100, 390]);
    const topo = meshTopography('Tilted', v, Uint32Array.from([0, 1, 2, 0, 2, 3]))!;

    it('gives the height at a point in plan (tilted triangles)', () => {
        expect(topo.topAt(E0, N0)).toBeCloseTo(400, 9);
        expect(topo.topAt(E0 + 50, N0 + 20)).toBeCloseTo(405, 9);
        expect(topo.heightsAt(E0 + 99.5, N0 - 99.5)).toHaveLength(1);
    });

    it('misses outside its extent', () => {
        expect(topo.topAt(E0 + 150, N0)).toBeNull();
        expect(topo.inExtent(E0 + 150, N0)).toBe(false);
        expect(topo.firstHit([E0 + 150, N0, 0], [E0 + 150, N0, 1000])).toBeNull();
    });

    it('finds the first crossing of a segment', () => {
        const t = topo.firstHit([E0, N0, 300], [E0, N0, 500]);
        expect(t).toBeCloseTo(0.5, 9);
        const slanted = topo.firstHit([E0 - 10, N0, 380], [E0 + 30, N0, 430]);
        // z on the segment 380 + 50 f, surface 400 + 0.1 (−10 + 40 f) = 399 + 4 f: f = 19 / 46
        expect(slanted).toBeCloseTo(19 / 46, 9);
    });

    it('takes the first hit going up where the surface folds over', () => {
        // Two layers over the same ground: 200 and 300
        const layer = (z: number) => [E0 - 50, N0 - 50, z, E0 + 50, N0 - 50, z, E0 + 50, N0 + 50, z, E0 - 50, N0 + 50, z];
        const two = meshTopography('Two', new Float64Array([...layer(200), ...layer(300)]), Uint32Array.from([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]))!;
        expect(two.firstHit([E0, N0, 100], [E0, N0, 400])).toBeCloseTo(1 / 3, 9);
        expect(two.heightsAt(E0, N0).sort()).toEqual([200, 300]);
        expect(two.topAt(E0, N0)).toBe(300);
    });

    it('tells a closed solid from a surface', () => {
        expect(topo.closed).toBe(false);
        const tet = Uint32Array.from([0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3]);
        expect(isClosedMesh(tet, 4)).toBe(true);
        expect(isClosedMesh(tet.slice(0, 9), 4)).toBe(false);
    });

    it('returns null for a mesh with no triangles', () => {
        expect(meshTopography('Lines', v, new Uint32Array(0))).toBeNull();
    });
});
