/**
 * An outline drawn in a view, as the limit of a surface (pure, unit-tested).
 *
 * The outline is a closed loop of corners on a plane square to the direction
 * it was drawn looking along. A point is inside it when, seen along that
 * direction, it falls within the loop: the outline cuts a column through the
 * model, as a pastry cutter would.
 */
import { cross, dot, unit } from './plane';
import type { SurfaceOutline, Vec3 } from './types';

export interface OutlineFrame {
    /** A point on the outline's plane */
    origin: Vec3;
    /** Two unit directions in the plane, square to each other */
    u: Vec3;
    v: Vec3;
    /** The corners in the plane: (along u, along v) pairs */
    xy: Float64Array;
}

/** The outline ready for testing points against. Null when it has fewer than three corners or no direction. */
export function outlineFrame(outline: SurfaceOutline | null | undefined): OutlineFrame | null {
    const normal = outline && unit(outline.normal);
    if (!outline || !normal || outline.points.length < 3) return null;
    const u = unit(cross(normal, Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
    if (!u) return null;
    const v = cross(normal, u);
    const origin = outline.points[0];
    const xy = new Float64Array(outline.points.length * 2);
    outline.points.forEach((p, i) => {
        const d = [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
        xy[i * 2] = dot(d, u);
        xy[i * 2 + 1] = dot(d, v);
    });
    return { origin: [origin[0], origin[1], origin[2]], u, v, xy };
}

/**
 * How far a point is from the outline, seen along the direction it was drawn
 * in: negative inside (by that much from the nearest edge), positive outside.
 */
export function outlineDistance(frame: OutlineFrame, x: number, y: number, z: number): number {
    const { origin: o, u, v, xy } = frame;
    const dx = x - o[0], dy = y - o[1], dz = z - o[2];
    const px = dx * u[0] + dy * u[1] + dz * u[2], py = dx * v[0] + dy * v[1] + dz * v[2];
    const n = xy.length / 2;
    let best = Infinity, inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const ax = xy[j * 2], ay = xy[j * 2 + 1], bx = xy[i * 2], by = xy[i * 2 + 1];
        const ex = bx - ax, ey = by - ay;
        const len2 = ex * ex + ey * ey;
        const t = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * ex + (py - ay) * ey) / len2)) : 0;
        const d = (px - ax - ex * t) ** 2 + (py - ay - ey * t) ** 2;
        if (d < best) best = d;
        // A ray towards +u crosses this edge
        if ((ay > py) !== (by > py) && px < ax + (py - ay) / (by - ay) * ex) inside = !inside;
    }
    return inside ? -Math.sqrt(best) : Math.sqrt(best);
}

/** The outline's largest extent across (m). */
export function outlineSize(frame: OutlineFrame): number {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < frame.xy.length; i += 2) {
        minX = Math.min(minX, frame.xy[i]);
        maxX = Math.max(maxX, frame.xy[i]);
        minY = Math.min(minY, frame.xy[i + 1]);
        maxY = Math.max(maxY, frame.xy[i + 1]);
    }
    return Math.hypot(maxX - minX, maxY - minY);
}
