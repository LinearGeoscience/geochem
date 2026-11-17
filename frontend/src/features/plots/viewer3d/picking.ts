/**
 * Where a click lands in 3D (pure, no three.js, unit-tested): on a drillhole
 * (with snapping to the ends and middle of a sample interval), on a plane, on
 * a mesh, or on a control-point handle.
 *
 * Holes and handles are picked on screen, in pixels, the way the eye judges
 * "near". Planes and meshes are picked with the view ray.
 */
import type { IntervalGeometry } from './intervals';

type Vec3 = [number, number, number];

export interface Ray {
    origin: ArrayLike<number>;
    dir: ArrayLike<number>;
}

// ---------------------------------------------------------------------------
// On a drillhole
// ---------------------------------------------------------------------------

export interface HolePick {
    /** Dataset row of the sample interval */
    row: number;
    /** Where along the interval: 0 = its From end, 1 = its To end */
    along: number;
    /** What the position was snapped to (null = exactly where the cursor is) */
    snap: 'from' | 'to' | 'mid' | null;
    /** Local xyz (the intervals' own space: vertical exaggeration not applied) */
    position: Vec3;
}

export interface HolePickOptions {
    /** How close (px) the cursor must be to a hole */
    reachPx?: number;
    /** How close (px) the cursor must be to an interval's end or middle to snap to it */
    snapPx?: number;
}

/**
 * The point on the front-most drillhole under the cursor, or null. `mvp` is
 * the column-major model-view-projection matrix with the vertical
 * exaggeration included (as for projectToScreen and pickInterval).
 *
 * Ends win over the middle: an interval boundary is where a logged contact
 * is, which is what surfaces are usually picked on.
 */
export function pickOnHole(
    intervals: IntervalGeometry,
    mvp: ArrayLike<number>,
    width: number,
    height: number,
    cursor: [number, number],
    eligible: (i: number) => boolean,
    options: HolePickOptions = {},
): HolePick | null {
    const reach = options.reachPx ?? 8, snapPx = options.snapPx ?? 8;
    const { start, end, has } = intervals;
    const m = mvp;
    const clip = (p: ArrayLike<number>, i: number, out: number[]) => {
        const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
        out[3] = m[3] * x + m[7] * y + m[11] * z + m[15];
        out[0] = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / out[3] * 0.5 + 0.5) * width;
        out[1] = (1 - ((m[1] * x + m[5] * y + m[9] * z + m[13]) / out[3] * 0.5 + 0.5)) * height;
        out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / out[3];
    };
    const a = [0, 0, 0, 0], b = [0, 0, 0, 0];
    interface Candidate { row: number; t: number; a: number[]; b: number[]; off: number; depth: number }
    const near: Candidate[] = [];
    for (let i = 0; i < has.length; i++) {
        if (!has[i]) continue;
        clip(start, i, a);
        clip(end, i, b);
        if (a[3] <= 0 || b[3] <= 0) continue; // behind the camera
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const l2 = dx * dx + dy * dy;
        const t = l2 > 0 ? Math.min(1, Math.max(0, ((cursor[0] - a[0]) * dx + (cursor[1] - a[1]) * dy) / l2)) : 0;
        const ndcZ = a[2] + (b[2] - a[2]) * t;
        if (ndcZ < -1 || ndcZ > 1) continue;
        const off = Math.hypot(a[0] + dx * t - cursor[0], a[1] + dy * t - cursor[1]);
        if (off > reach || !eligible(i)) continue;
        // Clip w grows with distance in a perspective view; ndc z orders an orthographic one
        near.push({ row: i, t, a: [...a], b: [...b], off, depth: (a[3] + (b[3] - a[3]) * t) * 4 + ndcZ });
    }
    if (near.length === 0) return null;
    // The interval the cursor is on (the next one along the hole is "near" too, at its end);
    // of several equally under the cursor, the one in front
    const closest = Math.min(...near.map(c => c.off));
    const best = near.filter(c => c.off <= closest + 1).reduce((p, c) => (c.depth < p.depth ? c : p));

    const { row, a: pa, b: pb } = best;
    const off = (t: number) => Math.hypot(pa[0] + (pb[0] - pa[0]) * t - cursor[0], pa[1] + (pb[1] - pa[1]) * t - cursor[1]);
    // Halfway along the interval in space is not halfway on screen in a perspective view
    const toScreen = (s: number) => (s * pb[3]) / ((1 - s) * pa[3] + s * pb[3]);
    const toSpace = (t: number) => (t * pa[3]) / ((1 - t) * pb[3] + t * pa[3]);

    let along = toSpace(best.t);
    let snap: HolePick['snap'] = null;
    const dFrom = off(0), dTo = off(1);
    if (Math.min(dFrom, dTo) <= snapPx) {
        snap = dFrom <= dTo ? 'from' : 'to';
        along = snap === 'from' ? 0 : 1;
    } else if (off(toScreen(0.5)) <= snapPx) {
        snap = 'mid';
        along = 0.5;
    }
    const at = (k: number) => start[row * 3 + k] + (end[row * 3 + k] - start[row * 3 + k]) * along;
    return { row, along, snap, position: [at(0), at(1), at(2)] };
}

// ---------------------------------------------------------------------------
// With the view ray
// ---------------------------------------------------------------------------

/**
 * A view ray from the viewer's drawing space (z multiplied by the vertical
 * exaggeration `vex`, relative to the scene origin) in data space: z as
 * stored, and world coordinates when `origin` (the world position of local
 * zero) is given. The direction is not re-normalised: a distance along the
 * ray means the same point in both spaces.
 */
export function dataRay(ray: Ray, vex: number, origin: ArrayLike<number> = [0, 0, 0]): { origin: Vec3; dir: Vec3 } {
    return {
        origin: [ray.origin[0] + origin[0], ray.origin[1] + origin[1], ray.origin[2] / vex + origin[2]],
        dir: [ray.dir[0], ray.dir[1], ray.dir[2] / vex],
    };
}

/** Where a ray meets a plane (same space for both). Null when it runs along the plane or the plane is behind it. */
export function rayPlane(ray: Ray, plane: { normal: ArrayLike<number>; point: ArrayLike<number> }): Vec3 | null {
    const { origin: o, dir: d } = ray, { normal: n, point: p } = plane;
    const along = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
    const size = Math.hypot(d[0], d[1], d[2]) * Math.hypot(n[0], n[1], n[2]);
    if (!(Math.abs(along) > size * 1e-9)) return null;
    const t = ((p[0] - o[0]) * n[0] + (p[1] - o[1]) * n[1] + (p[2] - o[2]) * n[2]) / along;
    if (!(t >= 0)) return null;
    return [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
}

/** The first place a ray meets a mesh (same space for both), or null. */
export function rayMesh(ray: Ray, mesh: { vertices: ArrayLike<number>; triangles: ArrayLike<number> }): { point: Vec3; triangle: number } | null {
    const { origin: o, dir: d } = ray, v = mesh.vertices, t = mesh.triangles;
    let best = Infinity, hit = -1;
    for (let q = 0; q + 2 < t.length; q += 3) {
        const a = t[q] * 3, b = t[q + 1] * 3, c = t[q + 2] * 3;
        // Moller-Trumbore
        const e1x = v[b] - v[a], e1y = v[b + 1] - v[a + 1], e1z = v[b + 2] - v[a + 2];
        const e2x = v[c] - v[a], e2y = v[c + 1] - v[a + 1], e2z = v[c + 2] - v[a + 2];
        const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-18) continue;
        const inv = 1 / det;
        const sx = o[0] - v[a], sy = o[1] - v[a + 1], sz = o[2] - v[a + 2];
        const u = (sx * px + sy * py + sz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const w = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
        if (w < 0 || u + w > 1) continue;
        const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (dist >= 0 && dist < best) { best = dist; hit = q / 3; }
    }
    if (hit < 0) return null;
    return { point: [o[0] + d[0] * best, o[1] + d[1] * best, o[2] + d[2] * best], triangle: hit };
}

// ---------------------------------------------------------------------------
// Samples and handles
// ---------------------------------------------------------------------------

/**
 * The sample nearest the cursor within `radiusPx` among those `eligible`, or
 * -1. `screen` holds every row's CSS-pixel x, y (NaN when off screen).
 */
export function pickSample(screen: ArrayLike<number>, cursor: [number, number], eligible: (i: number) => boolean, radiusPx = 10): number {
    let best = -1, bestD = radiusPx * radiusPx;
    for (let i = 0; i * 2 + 1 < screen.length; i++) {
        const dx = screen[i * 2] - cursor[0], dy = screen[i * 2 + 1] - cursor[1];
        const d = dx * dx + dy * dy;
        if (d < bestD && eligible(i)) { bestD = d; best = i; }
    }
    return best;
}

/**
 * The handle nearest the cursor within `radiusPx`, or -1. `screen` holds
 * each handle's CSS-pixel x, y (NaN when it is off screen), as projectToScreen
 * returns them.
 */
export function pickHandle(screen: ArrayLike<number>, cursor: [number, number], radiusPx = 9): number {
    let best = -1, bestD = radiusPx * radiusPx;
    for (let i = 0; i * 2 + 1 < screen.length; i++) {
        const dx = screen[i * 2] - cursor[0], dy = screen[i * 2 + 1] - cursor[1];
        const d = dx * dx + dy * dy;
        if (d <= bestD) { bestD = d; best = i; }
    }
    return best;
}
