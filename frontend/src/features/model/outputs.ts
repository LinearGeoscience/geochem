/**
 * What a surface says about each sample: which side of it the sample is on,
 * and how far from it (pure, unit-tested).
 *
 * The side comes from the fitted field (positive or negative), so it is
 * defined everywhere, also beyond the edge of a surface that stops near its
 * points. The distance is to the mesh as drawn, signed by the side.
 */
import { MeshIndex } from './meshOps';
import { evaluateField, type FittedField } from './rbf';
import type { TriMesh } from './types';

/** The field at each row; NaN where the row has no position. */
function fieldAtRows(field: FittedField, x: ArrayLike<number>, y: ArrayLike<number>, z: ArrayLike<number>): Float64Array {
    const n = Math.min(x.length, y.length, z.length);
    const rows: number[] = [];
    for (let i = 0; i < n; i++) if (Number.isFinite(x[i]) && Number.isFinite(y[i]) && Number.isFinite(z[i])) rows.push(i);
    const pts = new Float64Array(rows.length * 3);
    rows.forEach((r, k) => { pts[k * 3] = x[r]; pts[k * 3 + 1] = y[r]; pts[k * 3 + 2] = z[r]; });
    const vals = evaluateField(field, pts);
    const out = new Float64Array(n).fill(NaN);
    rows.forEach((r, k) => { out[r] = vals[k]; });
    return out;
}

/**
 * Side of the surface for each row: 1 = the positive side, -1 = the negative
 * side, 0 = the row has no position. A sample exactly on the surface counts
 * as positive.
 */
export function sideOfSurface(field: FittedField, x: ArrayLike<number>, y: ArrayLike<number>, z: ArrayLike<number>): Int8Array {
    const f = fieldAtRows(field, x, y, z);
    return Int8Array.from(f, v => (Number.isNaN(v) ? 0 : v < 0 ? -1 : 1));
}

/**
 * Distance from each row to the surface's mesh, positive on the positive
 * side and negative on the other. NaN where the row has no position or the
 * surface has no mesh.
 */
export function distanceToSurface(mesh: TriMesh, field: FittedField, x: ArrayLike<number>, y: ArrayLike<number>, z: ArrayLike<number>): Float64Array {
    const f = fieldAtRows(field, x, y, z);
    if (mesh.triangles.length === 0) return f.fill(NaN);
    const index = new MeshIndex(mesh);
    for (let i = 0; i < f.length; i++) {
        if (Number.isNaN(f[i])) continue;
        const d = index.distance(x[i], y[i], z[i]);
        f[i] = f[i] < 0 ? -d : d;
    }
    return f;
}
