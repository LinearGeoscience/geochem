/**
 * Smooth lines (pure, unit-tested): a line marked smooth runs as a curve
 * through every one of its nodes, not straight from node to node. The curve
 * is a centripetal Catmull-Rom: it passes through each node, and does not
 * loop or overshoot between nodes spaced unevenly. Past either end it is
 * carried straight on.
 *
 * The nodes stay the line's shape as stored and edited; everything that
 * needs the line's shape (the fit, drawing, picking, files) asks `shapeOf`,
 * which gives the curve as many short straight pieces, each node at a known
 * place among them. A line that is not smooth is given back as it is.
 *
 * Each stretch between two nodes is the cubic Bezier with the handles of
 * `catmullRomHandles` (exactly the same curve), so a smooth line can be
 * written to and read from Leapfrog's polyline files, which keep those
 * handles.
 */
import type { Vec3 } from './types';

/** Each stretch of a smooth line is drawn and sampled as this many straight pieces */
export const PER_STRETCH = 8;

const distance = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** Centripetal knot spacing (kept above zero: two nodes on top of each other still give a curve) */
const knot = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.max(Math.sqrt(distance(a, b)), 1e-9);

/** The four points that shape stretch `s` (from node s to node s + 1): past either end, a point carried straight on */
function quad(points: readonly Vec3[], s: number): [Vec3, Vec3, Vec3, Vec3] {
    const p1 = points[s], p2 = points[s + 1];
    const p0: Vec3 = s > 0 ? points[s - 1] : [2 * p1[0] - p2[0], 2 * p1[1] - p2[1], 2 * p1[2] - p2[2]];
    const p3: Vec3 = s + 2 < points.length ? points[s + 2] : [2 * p2[0] - p1[0], 2 * p2[1] - p1[1], 2 * p2[2] - p1[2]];
    return [p0, p1, p2, p3];
}

/**
 * The curve's direction at both ends of stretch `s`, scaled for the stretch
 * run from 0 to 1 (the Hermite tangents of the centripetal Catmull-Rom),
 * relative to node s.
 */
function hermite(points: readonly Vec3[], s: number): { m1: Vec3; m2: Vec3; d: Vec3 } {
    const [p0, p1, p2, p3] = quad(points, s);
    const k0 = knot(p0, p1), k1 = knot(p1, p2), k2 = knot(p2, p3);
    const m1: Vec3 = [0, 0, 0], m2: Vec3 = [0, 0, 0], d: Vec3 = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
        const a = p1[c] - p0[c], b = p2[c] - p1[c], e = p3[c] - p2[c];
        d[c] = b;
        m1[c] = (a / k0 - (a + b) / (k0 + k1) + b / k1) * k1;
        m2[c] = (b / k1 - (b + e) / (k1 + k2) + e / k2) * k1;
    }
    return { m1, m2, d };
}

/**
 * Per stretch, the Bezier handles of the curve: [the first, measured from the
 * node the stretch starts at; the second, measured from the node it ends at].
 */
export function catmullRomHandles(points: readonly Vec3[]): [Vec3, Vec3][] {
    const out: [Vec3, Vec3][] = [];
    for (let s = 0; s + 1 < points.length; s++) {
        const { m1, m2 } = hermite(points, s);
        out.push([[m1[0] / 3, m1[1] / 3, m1[2] / 3], [-m2[0] / 3, -m2[1] / 3, -m2[2] / 3]]);
    }
    return out;
}

/** The place `f` (0-1) of the way along stretch `s` of the curve (worked out from node s, so a curve on a plane stays on it) */
export function pointOnStretch(points: readonly Vec3[], s: number, f: number): Vec3 {
    const { m1, m2, d } = hermite(points, s);
    const f2 = f * f, f3 = f2 * f;
    const h10 = f3 - 2 * f2 + f, h01 = -2 * f3 + 3 * f2, h11 = f3 - f2;
    const p = points[s];
    return [p[0] + h10 * m1[0] + h01 * d[0] + h11 * m2[0], p[1] + h10 * m1[1] + h01 * d[1] + h11 * m2[1], p[2] + h10 * m1[2] + h01 * d[2] + h11 * m2[2]];
}

/** The curve's direction `f` of the way along stretch `s` (not unit length) */
export function tangentOnStretch(points: readonly Vec3[], s: number, f: number): Vec3 {
    const { m1, m2, d } = hermite(points, s);
    const f2 = f * f;
    const g10 = 3 * f2 - 4 * f + 1, g01 = -6 * f2 + 6 * f, g11 = 3 * f2 - 2 * f;
    return [g10 * m1[0] + g01 * d[0] + g11 * m2[0], g10 * m1[1] + g01 * d[1] + g11 * m2[1], g10 * m1[2] + g01 * d[2] + g11 * m2[2]];
}

/** The curve through these nodes as straight pieces, `per` to a stretch: node i is at place i * per. Two nodes or fewer: as they are. */
export function smoothPath(points: readonly Vec3[], per = PER_STRETCH): Vec3[] {
    if (points.length < 3) return points as Vec3[];
    const out: Vec3[] = [];
    for (let s = 0; s + 1 < points.length; s++) {
        out.push(points[s]);
        for (let k = 1; k < per; k++) out.push(pointOnStretch(points, s, k / per));
    }
    out.push(points[points.length - 1]);
    return out;
}

/** Whether a line runs as a curve (three nodes at least, marked smooth) */
export const isCurved = (line: { points: readonly Vec3[]; smooth?: boolean }) => !!line.smooth && line.points.length >= 3;

const shapes = new WeakMap<readonly Vec3[], Vec3[]>();

/**
 * A line's shape as straight pieces: the curve for a smooth line (node i at
 * place i * PER_STRETCH), the nodes themselves (the same array) otherwise.
 */
export function shapeOf(line: { points: readonly Vec3[]; smooth?: boolean }): readonly Vec3[] {
    if (!isCurved(line)) return line.points;
    let out = shapes.get(line.points);
    if (!out) {
        out = smoothPath(line.points);
        shapes.set(line.points, out);
    }
    return out;
}

/** Where node `i` of a line is among the places of `shapeOf(line)` */
export const placeOfNode = (line: { points: readonly Vec3[]; smooth?: boolean }, i: number) => (isCurved(line) ? i * PER_STRETCH : i);

/** Which stretch between nodes the piece starting at place `k` of `shapeOf(line)` is part of */
export const stretchOfPlace = (line: { points: readonly Vec3[]; smooth?: boolean }, k: number) => (isCurved(line) ? Math.floor(k / PER_STRETCH) : k);

/** Distance from p to the segment a-b */
function offSegment(p: ArrayLike<number>, a: ArrayLike<number>, b: ArrayLike<number>): number {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / len2)) : 0;
    return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t, p[2] - a[2] - ab[2] * t);
}

/**
 * As few nodes of a stroke (drawn freehand) as give a smooth curve within
 * `tolerance` of every point of it, `maxNodes` at most: starting from its two
 * ends, the point the curve passes furthest from is made a node, again and
 * again.
 */
export function fitSmoothNodes(stroke: readonly Vec3[], tolerance: number, maxNodes = 24): Vec3[] {
    const pts: Vec3[] = [];
    for (const p of stroke) if (pts.length === 0 || distance(p, pts[pts.length - 1]) > 1e-9) pts.push(p);
    if (pts.length <= 2) return pts;
    const keep = [0, pts.length - 1];
    for (;;) {
        const nodes = keep.map(i => pts[i]);
        let worst = -1, at = -1;
        for (let s = 0; s + 1 < keep.length; s++) {
            const dense = [nodes[s]];
            for (let k = 1; k < PER_STRETCH * 2; k++) dense.push(nodes.length >= 3 ? pointOnStretch(nodes, s, k / (PER_STRETCH * 2)) : [
                nodes[s][0] + (nodes[s + 1][0] - nodes[s][0]) * k / (PER_STRETCH * 2),
                nodes[s][1] + (nodes[s + 1][1] - nodes[s][1]) * k / (PER_STRETCH * 2),
                nodes[s][2] + (nodes[s + 1][2] - nodes[s][2]) * k / (PER_STRETCH * 2),
            ]);
            dense.push(nodes[s + 1]);
            for (let j = keep[s] + 1; j < keep[s + 1]; j++) {
                let d = Infinity;
                for (let q = 0; q + 1 < dense.length; q++) d = Math.min(d, offSegment(pts[j], dense[q], dense[q + 1]));
                if (d > worst) { worst = d; at = j; }
            }
        }
        if (at < 0 || worst <= tolerance || keep.length >= maxNodes) return keep.map(i => pts[i]);
        keep.push(at);
        keep.sort((a, b) => a - b);
    }
}

/** A cubic Bezier stretch from a to b, with handles ha (from a) and hb (from b), at f */
export function bezierAt(a: Vec3, ha: Vec3, hb: Vec3, b: Vec3, f: number): Vec3 {
    const g = 1 - f;
    const w0 = g * g * g, w1 = 3 * g * g * f, w2 = 3 * g * f * f, w3 = f * f * f;
    return [0, 1, 2].map(c => w0 * a[c] + w1 * (a[c] + ha[c]) + w2 * (b[c] + hb[c]) + w3 * b[c]) as Vec3;
}

/**
 * How far, at most, a curve given by its nodes and per-stretch Bezier handles
 * (as Leapfrog keeps it) runs from the smooth curve through the same nodes,
 * as a share of the stretch's length (per stretch).
 */
export function handlesDeviation(points: readonly Vec3[], handles: readonly [Vec3, Vec3][]): number[] {
    const out: number[] = [];
    for (let s = 0; s + 1 < points.length && s < handles.length; s++) {
        const span = distance(points[s], points[s + 1]);
        let worst = 0;
        for (let k = 1; k < 16; k++) {
            const f = k / 16;
            const ours = points.length >= 3 ? pointOnStretch(points, s, f) : bezierAt(points[s], [0, 0, 0], [0, 0, 0], points[s + 1], f);
            worst = Math.max(worst, distance(ours, bezierAt(points[s], handles[s][0], handles[s][1], points[s + 1], f)));
        }
        out.push(span > 0 ? worst / span : 0);
    }
    return out;
}
