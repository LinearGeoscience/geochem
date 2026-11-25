/**
 * A box changed by its faces (pure, unit-tested): where the handles stand,
 * the box's edges as lines, and a face moved to where a line of sight passes
 * nearest its axis.
 */
import type { Box3, Vec3 } from './types';

/** A box is never thinner than this, m */
export const LEAST_SIDE = 1;

/** The middle of each face: west, east, south, north, bottom, top (2 x axis, + 1 for the far side) */
export function boxFaces(box: Box3): Vec3[] {
    const mid: Vec3 = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
    const out: Vec3[] = [];
    for (let axis = 0; axis < 3; axis++) {
        for (const side of [box.min, box.max]) {
            const p: Vec3 = [mid[0], mid[1], mid[2]];
            p[axis] = side[axis];
            out.push(p);
        }
    }
    return out;
}

/** The twelve edges, each a pair of ends (xyz, six numbers an edge) */
export function boxLines(box: Box3): number[] {
    const c = (q: number): Vec3 => [q & 1 ? box.max[0] : box.min[0], q & 2 ? box.max[1] : box.min[1], q & 4 ? box.max[2] : box.min[2]];
    const out: number[] = [];
    for (let q = 0; q < 8; q++) for (const bit of [1, 2, 4]) if (!(q & bit)) out.push(...c(q), ...c(q | bit));
    return out;
}

/**
 * The box with one face moved to where a line of sight passes nearest the
 * line through the middle of that face along its axis. The face does not
 * pass the one opposite (they stay `LEAST_SIDE` apart). Null: the line of
 * sight runs along the axis and says nothing.
 */
export function moveFace(box: Box3, face: number, ray: { origin: ArrayLike<number>; dir: ArrayLike<number> }): Box3 | null {
    const axis = face >> 1, far = (face & 1) === 1;
    if (!(axis >= 0 && axis < 3)) return null;
    const p = boxFaces(box)[face];
    const a: Vec3 = [0, 0, 0];
    a[axis] = 1;
    const d = ray.dir, dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    if (!(dd > 0)) return null;
    // Nearest places of two lines: p + s a, and origin + t d
    const w: Vec3 = [p[0] - ray.origin[0], p[1] - ray.origin[1], p[2] - ray.origin[2]];
    const ad = d[axis], aw = w[axis], dw = d[0] * w[0] + d[1] * w[1] + d[2] * w[2];
    const det = dd - ad * ad;
    if (!(det > 1e-9 * dd)) return null;
    const s = (ad * dw - dd * aw) / det;
    if (!Number.isFinite(s)) return null;
    const min: Vec3 = [...box.min], max: Vec3 = [...box.max];
    if (far) max[axis] = Math.max(p[axis] + s, min[axis] + LEAST_SIDE);
    else min[axis] = Math.min(p[axis] + s, max[axis] - LEAST_SIDE);
    return { min, max };
}

/** A box with its sides at whole metres (never thinner than `LEAST_SIDE`) */
export function roundedBox(box: Box3): Box3 {
    const min = box.min.map(v => Math.round(v)) as Vec3, max = box.max.map(v => Math.round(v)) as Vec3;
    for (let k = 0; k < 3; k++) if (max[k] - min[k] < LEAST_SIDE) max[k] = min[k] + LEAST_SIDE;
    return { min, max };
}
