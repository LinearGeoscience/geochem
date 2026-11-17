/**
 * Lines drawn on a slice, as input to a surface (pure, unit-tested).
 *
 * A line says more than the points along it: the surface crosses the slice
 * along the line, so at every point of it the surface's facing is known too
 * (square to the line, within the slice). That is what lets a surface fold
 * back over itself: see sheet.ts.
 */
import { cross, dot, unit } from './plane';
import type { Plane, ScenePolyline, Vec3 } from './types';

/** Points taken along all the lines of one surface (each costs three in the fit) */
export const MAX_LINE_SAMPLES = 100;
/** How far either side of a line its two extra values sit, as a share of the spacing of its samples */
const OFFSET_SHARE = 0.25;

const sub = (a: ArrayLike<number>, b: ArrayLike<number>): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const distance = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function lineLength(points: readonly Vec3[]): number {
    let sum = 0;
    for (let i = 1; i < points.length; i++) sum += distance(points[i], points[i - 1]);
    return sum;
}

/** Distance from p to the segment a-b. */
function offSegment(p: Vec3, a: Vec3, b: Vec3): number {
    const ab = sub(b, a), ap = sub(p, a);
    const len2 = dot(ab, ab);
    const t = len2 > 0 ? Math.min(1, Math.max(0, dot(ap, ab) / len2)) : 0;
    return distance(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]);
}

/**
 * A drawn line with the vertices it does not need taken out: none of the
 * removed ones was further than `tolerance` from the line that is left
 * (Douglas-Peucker). Vertices on top of each other are merged. If more than
 * `maxVertices` remain, the tolerance is doubled until they fit.
 */
export function simplifyLine(points: readonly Vec3[], tolerance: number, maxVertices = 60): Vec3[] {
    const distinct: Vec3[] = [];
    for (const p of points) {
        if (!p.every(Number.isFinite)) continue;
        if (distinct.length === 0 || distance(p, distinct[distinct.length - 1]) > 1e-9) distinct.push([p[0], p[1], p[2]]);
    }
    if (distinct.length <= 2) return distinct;
    for (let tol = Math.max(tolerance, 0); ; tol = tol > 0 ? tol * 2 : lineLength(distinct) * 1e-4) {
        const keep = new Uint8Array(distinct.length);
        keep[0] = keep[distinct.length - 1] = 1;
        const stack: [number, number][] = [[0, distinct.length - 1]];
        while (stack.length > 0) {
            const [a, b] = stack.pop()!;
            let worst = -1, at = -1;
            for (let i = a + 1; i < b; i++) {
                const d = offSegment(distinct[i], distinct[a], distinct[b]);
                if (d > worst) { worst = d; at = i; }
            }
            if (at >= 0 && worst > tol) {
                keep[at] = 1;
                stack.push([a, at], [at, b]);
            }
        }
        const out = distinct.filter((_, i) => keep[i]);
        if (out.length <= Math.max(2, maxVertices)) return out;
    }
}

/**
 * A smooth curve through a line's vertices, as `count` vertices evenly
 * spaced along it (the two ends are kept). A hand-drawn line, once its
 * jitter is taken out, is a few corners joined by straight runs; this rounds
 * it off again. (A centripetal Catmull-Rom curve: it passes through every
 * vertex and does not loop or overshoot between unevenly spaced ones.)
 */
export function smoothLine(points: readonly Vec3[], count: number): Vec3[] {
    const v = simplifyLine(points, 0, Infinity);
    if (v.length <= 2 || count <= 2) return v.length <= 2 ? v : [v[0], v[v.length - 1]];
    const PER_SPAN = 12;
    const dense: Vec3[] = [v[0]];
    const knot = (a: Vec3, b: Vec3) => Math.sqrt(distance(a, b));
    for (let i = 0; i + 1 < v.length; i++) {
        const p1 = v[i], p2 = v[i + 1];
        // Past either end the curve is carried straight on
        const p0: Vec3 = i > 0 ? v[i - 1] : [2 * p1[0] - p2[0], 2 * p1[1] - p2[1], 2 * p1[2] - p2[2]];
        const p3: Vec3 = i + 2 < v.length ? v[i + 2] : [2 * p2[0] - p1[0], 2 * p2[1] - p1[1], 2 * p2[2] - p1[2]];
        const t1 = knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
        for (let k = 1; k <= PER_SPAN; k++) {
            const t = t1 + (t2 - t1) * k / PER_SPAN;
            const out: Vec3 = [0, 0, 0];
            for (let c = 0; c < 3; c++) {
                const a1 = (t1 - t) / t1 * p0[c] + t / t1 * p1[c];
                const a2 = (t2 - t) / (t2 - t1) * p1[c] + (t - t1) / (t2 - t1) * p2[c];
                const a3 = (t3 - t) / (t3 - t2) * p2[c] + (t - t2) / (t3 - t2) * p3[c];
                const b1 = (t2 - t) / t2 * a1 + t / t2 * a2;
                const b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3;
                out[c] = (t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2;
            }
            dense.push(out);
        }
    }
    // Evenly along the curve
    const total = lineLength(dense);
    const out: Vec3[] = [dense[0]];
    let walked = 0, s = 1;
    for (let k = 1; k < count - 1; k++) {
        const at = total * k / (count - 1);
        while (s < dense.length - 1 && walked + distance(dense[s], dense[s - 1]) < at) {
            walked += distance(dense[s], dense[s - 1]);
            s++;
        }
        const span = distance(dense[s], dense[s - 1]);
        const f = span > 0 ? (at - walked) / span : 0;
        out.push([dense[s - 1][0] + (dense[s][0] - dense[s - 1][0]) * f, dense[s - 1][1] + (dense[s][1] - dense[s - 1][1]) * f, dense[s - 1][2] + (dense[s][2] - dense[s - 1][2]) * f]);
    }
    out.push(dense[dense.length - 1]);
    return out;
}

/** The two planes are one (within `tolerance` metres over the scene). */
export function samePlane(a: Plane, b: Plane, tolerance = 0.01): boolean {
    return Math.abs(dot(a.normal, b.normal)) > 1 - 1e-6 && Math.abs(dot(a.normal, sub(b.point, a.point))) <= tolerance;
}

/** The lines of a surface as the fit takes them (see SheetInput.oriented). */
export interface LineSamples {
    /** Points along the lines, xyz triples */
    positions: Float64Array;
    /** At each, the unit direction square to the line within its slice (one side of the line, the same side all along it) */
    normals: Float64Array;
    /** At each, how far either side of the line the two extra values sit (0: none) */
    offsets: Float64Array;
    /** At each, the index of its line (as in the surface's list) */
    groups: Int32Array;
    /** Per line: the user turned it over */
    flipped: Uint8Array;
    /** Per line: the unit normal of the slice it was drawn on, xyz triples */
    across: Float64Array;
    /** Per line: its length */
    extrude: Float64Array;
}

/** The direction square to a line's direction `t` within the plane whose normal is `n`. */
export function lineNormal(t: ArrayLike<number>, n: ArrayLike<number>): Vec3 | null {
    return unit(cross(t, n));
}

/**
 * Points along each line with the facing of the surface there. Each line
 * gets a share of `maxSamples` by its length (two at least): its vertices
 * (the least needed ones are left out if there are more than its share) and,
 * with what is left, points spaced evenly along its longest stretches. Null
 * when no line has two distinct vertices.
 */
export function sampleLines(lines: readonly ScenePolyline[], maxSamples = MAX_LINE_SAMPLES): LineSamples | null {
    const whole = lines.map(l => simplifyLine(l.points, 0, Infinity));
    const lengths = whole.map(lineLength);
    const total = lengths.reduce((s, v) => s + v, 0);
    if (!(total > 0)) return null;
    const share = lengths.map(len => Math.max(2, Math.round(maxSamples * len / total)));
    const clean = whole.map((v, g) => (v.length > share[g] ? simplifyLine(v, 0, share[g]) : v));

    const positions: number[] = [], normals: number[] = [], offsets: number[] = [], groups: number[] = [];
    lines.forEach((line, g) => {
        const v = clean[g];
        const n = unit(line.plane.normal);
        if (v.length < 2 || !(lengths[g] > 0) || !n) return;
        const dirs = v.slice(1).map((p, i) => unit(sub(p, v[i]))!);
        const first = positions.length / 3;
        const push = (p: ArrayLike<number>, t: ArrayLike<number>) => {
            const m = lineNormal(t, n);
            positions.push(p[0], p[1], p[2]);
            normals.push(m ? m[0] : 0, m ? m[1] : 0, m ? m[2] : 0);
            groups.push(g);
        };
        // Extra points go, one at a time, to the stretch whose points are furthest apart
        const spans = dirs.map((_, s) => distance(v[s + 1], v[s]));
        const pieces = new Int32Array(dirs.length).fill(1);
        for (let extra = share[g] - v.length; extra > 0; extra--) {
            let at = 0;
            for (let s = 1; s < spans.length; s++) if (spans[s] / pieces[s] > spans[at] / pieces[at]) at = s;
            pieces[at]++;
        }
        for (let s = 0; s < dirs.length; s++) {
            // At a vertex the line's direction is the mean of the two it joins (the later one where it doubles back)
            const at = s === 0 ? dirs[0] : unit([dirs[s - 1][0] + dirs[s][0], dirs[s - 1][1] + dirs[s][1], dirs[s - 1][2] + dirs[s][2]]) ?? dirs[s];
            push(v[s], at);
            for (let k = 1; k < pieces[s]; k++) {
                const f = k / pieces[s];
                push([v[s][0] + (v[s + 1][0] - v[s][0]) * f, v[s][1] + (v[s + 1][1] - v[s][1]) * f, v[s][2] + (v[s + 1][2] - v[s][2]) * f], dirs[s]);
            }
        }
        push(v[v.length - 1], dirs[dirs.length - 1]);
        const count = positions.length / 3 - first;
        const d = OFFSET_SHARE * lengths[g] / (count - 1);
        for (let i = first; i < first + count; i++) offsets.push(normals[i * 3] === 0 && normals[i * 3 + 1] === 0 && normals[i * 3 + 2] === 0 ? 0 : d);
    });
    if (positions.length === 0) return null;

    const across = new Float64Array(lines.length * 3);
    lines.forEach((l, g) => across.set(unit(l.plane.normal) ?? [0, 0, 1], g * 3));
    return {
        positions: Float64Array.from(positions), normals: Float64Array.from(normals), offsets: Float64Array.from(offsets),
        groups: Int32Array.from(groups),
        flipped: Uint8Array.from(lines, l => (l.flipped ? 1 : 0)),
        across, extrude: Float64Array.from(lengths),
    };
}
