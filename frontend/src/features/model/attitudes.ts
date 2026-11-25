/**
 * Lines and planes as a geologist gives them (pure, unit-tested): a line by
 * its plunge (degrees below level) and the bearing it plunges towards; a
 * plane from a drag across the screen and the line the view looks along.
 *
 * Directions here are TRUE space (x east, y north, z up, no vertical
 * exaggeration). The 3D view draws z multiplied by its exaggeration `vex`;
 * `trueDirection` takes a direction from the drawing back to true space.
 */
import { cleanReading } from './readings';
import { cross, dipFromNormal, dot, unit } from './plane';
import type { PointReading, Vec3 } from './types';

const RAD = Math.PI / 180;

/** The unit direction of a line that plunges `plunge` degrees towards `trend` (it points down the plunge). */
export function directionFromPlunge(plunge: number, trend: number): Vec3 {
    const p = plunge * RAD, t = trend * RAD;
    return [Math.sin(t) * Math.cos(p), Math.cos(t) * Math.cos(p), -Math.sin(p)];
}

/** The plunge (0-90) and the bearing it plunges towards (0-360) of a direction, taken either way along it. Null for no direction. */
export function plungeOf(v: ArrayLike<number>): { plunge: number; trend: number } | null {
    const u = unit(v);
    if (!u) return null;
    // Pointing down (a level line: towards the east half, or north)
    const flip = u[2] > 1e-12 || (Math.abs(u[2]) <= 1e-12 && (u[0] < -1e-12 || (Math.abs(u[0]) <= 1e-12 && u[1] < 0)));
    const d = flip ? [-u[0], -u[1], -u[2]] : u;
    const level = Math.hypot(d[0], d[1]);
    const plunge = Math.asin(Math.min(1, Math.max(0, -d[2]))) / RAD;
    const trend = level < 1e-9 ? 0 : ((Math.atan2(d[0], d[1]) / RAD) % 360 + 360) % 360;
    return { plunge, trend };
}

/** A direction in the 3D view's drawing space (z exaggerated by `vex`) as a true-space unit direction. Null for none. */
export function trueDirection(drawing: ArrayLike<number>, vex: number): Vec3 | null {
    return unit([drawing[0], drawing[1], drawing[2] / (vex || 1)]);
}

/** A direction as stored: three finite numbers, made unit length (its sign kept). Null when it is not one. */
export function cleanDirection(v: unknown): Vec3 | null {
    if (!Array.isArray(v) && !(v instanceof Float64Array) && !(v instanceof Float32Array)) return null;
    const a = v as ArrayLike<unknown>;
    if (a.length !== 3 || ![0, 1, 2].every(k => typeof a[k] === 'number' && Number.isFinite(a[k] as number))) return null;
    return unit([a[0] as number, a[1] as number, a[2] as number]);
}

const whole = (v: number) => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));

/** "80° → 120°" (plunge, then the bearing it plunges towards) */
export function formatDirection(v: ArrayLike<number>): string {
    const p = plungeOf(v);
    if (!p) return '—';
    return `${whole(p.plunge)}° → ${String(Math.round(p.trend) % 360).padStart(3, '0')}°`;
}

/** A drag within this many degrees of the line of sight gives no plane */
export const DRAG_MIN_DEGREES = 5;

/**
 * The plane a drag across the screen gives: the plane through the line
 * dragged and the line the view looks along. Seen edge-on, a plane is a line
 * on the screen; drawing that line gives the plane. Looking level, the drag
 * is the plane's strike and the view sets its dip.
 *
 * `drag` is the dragged line in true space (its length is the reading's
 * reach, in metres); `view` the direction the view looks along, in true
 * space. Null when the drag is too short, or runs along the line of sight.
 */
export function planeFromDrag(drag: ArrayLike<number>, view: ArrayLike<number>, minDegrees = DRAG_MIN_DEGREES): { reading: PointReading; reach: number } | null {
    const reach = Math.hypot(drag[0], drag[1], drag[2]);
    const d = unit(drag), v = unit(view);
    if (!d || !v || !(reach > 1e-9)) return null;
    if (Math.abs(dot(d, v)) > Math.cos(minDegrees * RAD)) return null;
    const normal = unit(cross(d, v));
    if (!normal) return null;
    const reading = cleanReading({ ...dipFromNormal(normal), reach });
    return reading ? { reading, reach } : null;
}
