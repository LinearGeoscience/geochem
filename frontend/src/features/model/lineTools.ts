/**
 * Tools for drawn lines (pure, unit-tested): where lines cross a plane (the
 * marks the lines of other sections leave on this one, to draw to), which
 * plane of a section set a line was drawn on, and a line copied onto another
 * plane of its set (the next section, to be moved into place there).
 */
import { sectionIndexAt, sectionPlane } from './sectionSets';
import { shapeOf } from './splines';
import type { LineNode, Plane, SectionSet, Vec3 } from './types';

/** A line no further than this from a plane (m) at every place along it lies on it, and does not cross it */
export const ON_PLANE_M = 1e-3;

type Shape = { points: readonly Vec3[]; smooth?: boolean };

const unitOf = (n: ArrayLike<number>): Vec3 | null => {
    const len = Math.hypot(n[0], n[1], n[2]);
    return len > 1e-12 ? [n[0] / len, n[1] / len, n[2] / len] : null;
};

/**
 * Where a line crosses a plane, in the order along it (a smooth line along its
 * curve). A node on the plane is a crossing; a line lying on the plane has none.
 */
export function lineCrossings(line: Shape, plane: Plane, tolerance = ON_PLANE_M): Vec3[] {
    const n = unitOf(plane.normal);
    const path = shapeOf(line);
    if (!n || path.length === 0) return [];
    const q = plane.point;
    const off = path.map(p => (p[0] - q[0]) * n[0] + (p[1] - q[1]) * n[1] + (p[2] - q[2]) * n[2]);
    if (off.every(d => Math.abs(d) <= tolerance)) return [];
    const out: Vec3[] = [];
    for (let i = 0; i < path.length; i++) {
        const a = off[i];
        if (Math.abs(a) <= tolerance) {
            // (A node on the plane: once, however many pieces of the curve touch it)
            const p = path[i];
            const last = out[out.length - 1];
            if (!last || Math.hypot(last[0] - p[0], last[1] - p[1], last[2] - p[2]) > tolerance) out.push([p[0], p[1], p[2]]);
            continue;
        }
        if (i + 1 >= path.length) break;
        const b = off[i + 1];
        if (Math.abs(b) <= tolerance || a * b > 0) continue;
        const t = a / (a - b), p = path[i], r = path[i + 1];
        out.push([p[0] + (r[0] - p[0]) * t, p[1] + (r[1] - p[1]) * t, p[2] + (r[2] - p[2]) * t]);
    }
    return out;
}

/** A crossing and the line it is of */
export interface Crossing {
    line: string;
    p: Vec3;
}

/** Where each of several lines crosses a plane (lines lying on it are left out). */
export function crossingsOn(lines: readonly (Shape & { id: string })[], plane: Plane, tolerance = ON_PLANE_M): Crossing[] {
    const out: Crossing[] = [];
    for (const line of lines) for (const p of lineCrossings(line, plane, tolerance)) out.push({ line: line.id, p });
    return out;
}

/** Two planes are this near the same plane when their normals are within this of each other (1 - |cos|) ... */
const SAME_NORMAL = 1e-9;
/** ... and their points this near (m, or this share of the set's spacing, whichever is more) */
const SAME_PLACE_SHARE = 1e-4;

/**
 * The plane of a section set a line was drawn on: its set and the plane's
 * number (null: it is on no plane of any set, or in space). The first set it
 * is on wins.
 */
export function sectionOfLine(line: { plane: Plane | null }, sets: readonly SectionSet[] | undefined): { set: SectionSet; index: number } | null {
    const plane = line.plane;
    const n = plane && unitOf(plane.normal);
    if (!plane || !n) return null;
    for (const set of sets ?? []) {
        const along = n[0] * set.normal[0] + n[1] * set.normal[1] + n[2] * set.normal[2];
        if (Math.abs(along) < 1 - SAME_NORMAL) continue;
        const index = sectionIndexAt(set, plane.point);
        const { point } = sectionPlane(set, index);
        const off = (plane.point[0] - point[0]) * set.normal[0] + (plane.point[1] - point[1]) * set.normal[1] + (plane.point[2] - point[2]) * set.normal[2];
        if (Math.abs(off) <= Math.max(ON_PLANE_M, SAME_PLACE_SHARE * set.spacing)) return { set, index };
    }
    return null;
}

/** A line as the store takes a new one */
export interface LineCopy {
    points: Vec3[];
    plane: Plane;
    nodes?: (LineNode | null)[];
    smooth?: boolean;
}

/**
 * A line put onto another plane: every node moved straight across to it (along
 * the plane's normal). What its nodes knew goes with them (dip readings and
 * directions), but not the drillholes they were on: the copy is not on them.
 */
export function copyLineToPlane(line: { points: readonly Vec3[]; nodes?: (LineNode | null)[]; smooth?: boolean }, to: Plane): LineCopy | null {
    const n = unitOf(to.normal);
    if (!n || line.points.length < 2) return null;
    const q = to.point;
    const points = line.points.map((p): Vec3 => {
        const d = (p[0] - q[0]) * n[0] + (p[1] - q[1]) * n[1] + (p[2] - q[2]) * n[2];
        return [p[0] - d * n[0], p[1] - d * n[1], p[2] - d * n[2]];
    });
    let nodes: (LineNode | null)[] | undefined;
    if (line.nodes?.some(Boolean)) {
        nodes = line.points.map((_, i) => {
            const was = line.nodes?.[i];
            if (!was || (!was.reading && !was.direction)) return null;
            return { ...(was.reading ? { reading: was.reading } : {}), ...(was.direction ? { direction: was.direction } : {}) };
        });
        if (!nodes.some(Boolean)) nodes = undefined;
    }
    return { points, plane: { normal: n, point: [q[0], q[1], q[2]] }, ...(nodes ? { nodes } : {}), ...(line.smooth ? { smooth: true } : {}) };
}

/** A line on plane `index` of a set, copied onto plane `index + step` (null: it cannot be). */
export function copyToSection(line: { points: readonly Vec3[]; nodes?: (LineNode | null)[]; smooth?: boolean }, set: SectionSet, index: number, step: number): LineCopy | null {
    return copyLineToPlane(line, sectionPlane(set, index + step));
}
