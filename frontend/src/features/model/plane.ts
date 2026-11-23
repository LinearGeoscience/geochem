/**
 * Planes through points: the trend of a sheet, dip conversions and the plain
 * names of a surface's two sides (pure, unit-tested).
 */
import { jacobiEigendecomposition } from '../../utils/calculations/eigen';
import type { Plane, Vec3 } from './types';

export const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: ArrayLike<number>, b: ArrayLike<number>): Vec3 =>
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export function unit(v: ArrayLike<number>): Vec3 | null {
    const len = Math.hypot(v[0], v[1], v[2]);
    // "+ 0" turns a negative zero into a plain one
    return len > 1e-12 ? [v[0] / len + 0, v[1] / len + 0, v[2] / len + 0] : null;
}

export interface FitPlane extends Plane {
    /** Unit direction in which the points spread furthest */
    along: Vec3;
    /** RMS spread of the points along `along`, across it within the plane, and off the plane */
    spread: Vec3;
}

/** Least-squares plane through xyz triples (its point is their centre). Null without points. */
export function bestFitPlane(points: ArrayLike<number>): FitPlane | null {
    const n = Math.floor(points.length / 3);
    if (n === 0) return null;
    const c: Vec3 = [0, 0, 0];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) c[k] += points[i * 3 + k] / n;
    const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < n; i++) {
        const d = [points[i * 3] - c[0], points[i * 3 + 1] - c[1], points[i * 3 + 2] - c[2]];
        for (let a = 0; a < 3; a++) for (let b = a; b < 3; b++) cov[a][b] += d[a] * d[b] / n;
    }
    for (let a = 0; a < 3; a++) for (let b = 0; b < a; b++) cov[a][b] = cov[b][a];
    // Eigenvectors come back as rows, largest eigenvalue first
    const { eigenvalues, eigenvectors } = jacobiEigendecomposition(cov);
    const spread = eigenvalues.map(e => Math.sqrt(Math.max(e, 0))) as Vec3;
    const along = unit(eigenvectors[0]) ?? [1, 0, 0];
    // Cross product of the two in-plane axes: exact for coplanar points
    const normal = unit(cross(along, eigenvectors[1])) ?? unit(eigenvectors[2]) ?? [0, 0, 1];
    return { point: c, normal, along, spread };
}

/**
 * The unit normal of the plane many places lie closest to (xyz triples), or
 * null when they give none: fewer than `least` of them, all but on one line,
 * or spread nearly as far off the plane as across it (`flat`: how many times
 * further across than off it they must be spread).
 */
export function planeOfMany(points: ArrayLike<number>, least = 9, flat = 1.5): Vec3 | null {
    const plane = points.length >= least * 3 ? bestFitPlane(points) : null;
    return plane && plane.spread[1] > 0.05 * plane.spread[0] && plane.spread[1] >= flat * plane.spread[2] ? plane.normal : null;
}

/** The same plane with its normal on the side of `ref` (or, without one, its largest component positive). */
export function orientNormal(normal: Vec3, ref?: ArrayLike<number> | null): Vec3 {
    let flip: boolean;
    if (ref && Math.abs(dot(normal, ref)) > 1e-9) {
        flip = dot(normal, ref) < 0;
    } else {
        const a = normal.map(Math.abs);
        const k = a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2;
        flip = normal[k] < 0;
    }
    return flip ? [-normal[0] + 0, -normal[1] + 0, -normal[2] + 0] : normal;
}

export type TrendStatus = 'empty' | 'line' | 'sheet';

export interface Trend {
    /** empty = nothing to fit yet; line = the points only define a line; sheet = a real plane */
    status: TrendStatus;
    plane: Plane | null;
}

/** Points count as a line when they stray from it by less than this fraction of its length */
const LINE_RATIO = 0.01;

/**
 * The trend plane of a sheet's points.
 *
 * One point (or none) gives nothing. Two points, or points in a line, give
 * the plane through that line and `along` (a direction the surface should run
 * in: the normal of the slice a line was drawn on, or the view direction),
 * vertical when there is none. Three or more give their best-fit plane.
 * `ref` keeps the normal on one side so the two sides of a surface never swap.
 */
export function sheetTrend(points: ArrayLike<number>, along?: ArrayLike<number> | null, ref?: ArrayLike<number> | null): Trend {
    const fit = bestFitPlane(points);
    if (!fit || !(fit.spread[0] > 1e-9)) return { status: 'empty', plane: null };
    if (fit.spread[1] >= LINE_RATIO * fit.spread[0]) {
        return { status: 'sheet', plane: { point: fit.point, normal: orientNormal(fit.normal, ref) } };
    }
    const line = fit.along;
    // The part of a candidate direction that is square to the line
    const across = (d: ArrayLike<number>): Vec3 | null => {
        const k = dot(d, line);
        const v: Vec3 = [d[0] - line[0] * k, d[1] - line[1] * k, d[2] - line[2] * k];
        return Math.hypot(v[0], v[1], v[2]) > 0.05 * Math.hypot(d[0], d[1], d[2]) ? unit(v) : null;
    };
    const second = (along && across(along)) ?? across([0, 0, 1]) ?? across([0, 1, 0]) ?? [1, 0, 0];
    const normal = unit(cross(line, second)) ?? [0, 0, 1];
    return { status: 'line', plane: { point: fit.point, normal: orientNormal(normal, ref) } };
}

// ---------------------------------------------------------------------------
// Dip and dip direction
// ---------------------------------------------------------------------------

const RAD = Math.PI / 180;

/** Upward unit normal of a plane dipping `dip` degrees towards `dipDirection` (degrees clockwise from north). */
export function normalFromDip(dip: number, dipDirection: number): Vec3 {
    const d = dip * RAD, a = dipDirection * RAD;
    return [Math.sin(d) * Math.sin(a), Math.sin(d) * Math.cos(a), Math.cos(d)];
}

/** Dip (0 = level, 90 = vertical) and dip direction (0-360, clockwise from north) of a plane. */
export function dipFromNormal(normal: ArrayLike<number>): { dip: number; dipDirection: number } {
    const n = unit(normal) ?? [0, 0, 1];
    const up = n[2] < 0 ? [-n[0], -n[1], -n[2]] : n;
    const dip = Math.acos(Math.min(1, up[2])) / RAD;
    if (Math.hypot(up[0], up[1]) < 1e-9) return { dip: 0, dipDirection: 0 };
    const dir = (Math.atan2(up[0], up[1]) / RAD + 360) % 360;
    return { dip, dipDirection: dir };
}

// ---------------------------------------------------------------------------
// Side names
// ---------------------------------------------------------------------------

const COMPASS = ['North', 'North-east', 'East', 'South-east', 'South', 'South-west', 'West', 'North-west'];

/**
 * Plain names for the two sides of a surface: [the side its normal points to,
 * the other]. Above / Below for a surface flatter than 45 degrees, otherwise
 * the compass direction each side faces.
 */
export function sideNames(normal: ArrayLike<number>): [string, string] {
    const n = unit(normal) ?? [0, 0, 1];
    if (Math.abs(n[2]) >= Math.SQRT1_2) return n[2] > 0 ? ['Above', 'Below'] : ['Below', 'Above'];
    const sector = Math.round(((Math.atan2(n[0], n[1]) / RAD + 360) % 360) / 45) % 8;
    return [`${COMPASS[sector]} side`, `${COMPASS[(sector + 4) % 8]} side`];
}

/** A reading with a reach of its own is held to its plane at this many places round it, evenly spaced */
export const RIM_PLACES = 8;

/**
 * Directions round a plane, evenly spaced (RIM_PLACES of them), from its
 * unit normal: the same ones for the same normal, whichever way up it is
 * given.
 */
export function rimDirections(normal: ArrayLike<number>): Vec3[] {
    const up = normal[2] < 0 || (normal[2] === 0 && (normal[1] < 0 || (normal[1] === 0 && normal[0] < 0))) ? -1 : 1;
    const n: Vec3 = [up * normal[0], up * normal[1], up * normal[2]];
    const other: Vec3 = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const a: Vec3 = [n[1] * other[2] - n[2] * other[1], n[2] * other[0] - n[0] * other[2], n[0] * other[1] - n[1] * other[0]];
    const la = Math.hypot(a[0], a[1], a[2]) || 1;
    const t1: Vec3 = [a[0] / la, a[1] / la, a[2] / la];
    const t2: Vec3 = [n[1] * t1[2] - n[2] * t1[1], n[2] * t1[0] - n[0] * t1[2], n[0] * t1[1] - n[1] * t1[0]];
    return Array.from({ length: RIM_PLACES }, (_, k) => {
        const c = Math.cos((2 * Math.PI * k) / RIM_PLACES), w = Math.sin((2 * Math.PI * k) / RIM_PLACES);
        return [c * t1[0] + w * t2[0], c * t1[1] + w * t2[1], c * t1[2] + w * t2[2]] as Vec3;
    });
}
