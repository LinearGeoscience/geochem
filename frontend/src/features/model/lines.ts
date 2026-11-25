/**
 * Lines as input to a surface (pure, unit-tested).
 *
 * A line drawn on a slice says more than the points along it: the surface
 * crosses the slice along the line, so at every point of it the surface's
 * facing is known too (square to the line, within the slice). That is what
 * lets a surface fold back over itself: see sheet.ts.
 *
 * A line in space (on no slice) says where the surface is and no more: it is
 * given to the fit as points along it. A dip tick at a node of either kind of
 * line says how the surface lies there, as a reading at a point does. A node
 * with a direction gives its line a ribbon (ribbons.ts): the line is then
 * taken as a line on a slice is, with the ribbon for the slice's normal.
 *
 * A smooth line (splines.ts) is sampled along its curve.
 */
import { cross, dot, unit } from './plane';
import { isOrientedLine, ribbonAt, ribbonKeys, type RibbonKey } from './ribbons';
import { shapeOf } from './splines';
import type { LineNode, Plane, ScenePoint, ScenePolyline, Vec3 } from './types';

/** What the sampling needs of a line: where it runs, the slice it is on, and what is known of its nodes */
export type LineShape = Pick<ScenePolyline, 'points' | 'plane'> & { nodes?: readonly (LineNode | null)[]; smooth?: boolean };

/** Points taken along all the lines of one surface that are on slices, at most (each costs three in the fit) */
export const MAX_LINE_SAMPLES = 6000;
/** Points taken along all its lines that are on no slice, at most (each costs one) */
export const MAX_FREE_SAMPLES = 20_000;
/** How far either side of a line its two extra values sit, as a share of the spacing of its samples */
const OFFSET_SHARE = 0.25;
/**
 * Lines are sampled about this many times across the ground they cover (the
 * spacing is rounded up to a power of two metres, so that it stays put while
 * the lines are edited)
 */
const ACROSS = 64;

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

/** Every vertex is on the plane (within `tolerance` metres): the line can be held to it as a line drawn on that slice. */
export function onPlane(points: readonly Vec3[], plane: Plane, tolerance = 1e-3): boolean {
    return points.every(p => Math.abs(dot(plane.normal, sub(p, plane.point))) <= tolerance);
}

/**
 * The spacing of the samples along lines: about 1/64 of the longest side of
 * the box round their vertices, rounded up to a power of two. Each stretch
 * between two vertices is cut into pieces no longer than it, evenly, so a
 * vertex moved changes the samples of the two stretches it joins and no
 * others. 0 when the lines have no length.
 */
export function lineSpacing(lines: readonly (readonly Vec3[])[]): number {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const v of lines) for (const p of v) for (let a = 0; a < 3; a++) {
        if (!Number.isFinite(p[a])) continue;
        lo[a] = Math.min(lo[a], p[a]);
        hi[a] = Math.max(hi[a], p[a]);
    }
    const longest = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
    return longest > 0 ? 2 ** Math.ceil(Math.log2(longest / ACROSS)) : 0;
}

/**
 * Into how many pieces each stretch of each line is cut at the spacing: the
 * spacing is doubled until all the samples (every vertex, and the points
 * between) are no more than `budget`. Null when even one piece a stretch is
 * too many.
 */
function evenPieces(lines: readonly (readonly Vec3[])[], budget: number): { pieces: Int32Array[]; spacing: number } | null {
    let spacing = lineSpacing(lines);
    if (!(spacing > 0)) return null;
    const used = lines.filter(v => v.length >= 2);
    if (used.reduce((n, v) => n + v.length, 0) > budget) return null;
    for (let tries = 0; tries < 64; tries++, spacing *= 2) {
        let total = 0;
        const pieces = lines.map(v => {
            const out = new Int32Array(Math.max(0, v.length - 1));
            for (let s = 0; s + 1 < v.length; s++) out[s] = Math.max(1, Math.ceil(distance(v[s + 1], v[s]) / spacing - 1e-9));
            if (v.length >= 2) total += out.reduce((n, k) => n + k, 0) + 1;
            return out;
        });
        if (total <= budget) return { pieces, spacing };
    }
    return null;
}

/**
 * Points along the lines that are on no slice, xyz triples: their nodes and
 * points evenly between them, no further apart than the spacing
 * (lineSpacing, doubled while there would be more than `maxSamples`). They
 * keep the surface on the line between nodes far apart; a node moved changes
 * only the points of the two stretches it joins. With more nodes than
 * `maxSamples`, each line keeps a share by its length (two at least) of the
 * nodes that shape it most, and the rest of the room goes to its longest
 * stretches. Empty when there is no such line.
 */
export function freeLinePoints(lines: readonly LineShape[], maxSamples = MAX_FREE_SAMPLES): Float64Array {
    return freeLineSamples(lines, maxSamples).positions;
}

/** As freeLinePoints, with the line each point is on (`groups`: its place in `lines`). A line with a ribbon (ribbons.ts) is not one of them. */
export function freeLineSamples(lines: readonly LineShape[], maxSamples = MAX_FREE_SAMPLES): { positions: Float64Array; groups: Int32Array } {
    const which: number[] = [];
    lines.forEach((l, g) => { if (l.points.length >= 2 && !isOrientedLine(l)) which.push(g); });
    let free = which.map(g => shapeOf(lines[g]));
    if (free.length === 0) return { positions: new Float64Array(0), groups: new Int32Array(0) };
    // Evenly along every stretch, at a spacing fixed to the ground; with too many nodes for that, as many as there is room for
    const even = evenPieces(free, maxSamples);
    let nodes = free.reduce((sum, v) => sum + v.length, 0);
    if (!even && nodes > maxSamples) {
        const lengths = free.map(lineLength);
        const total = lengths.reduce((s, v) => s + v, 0);
        free = free.map((v, i) => {
            const share = Math.max(2, Math.round(maxSamples * lengths[i] / Math.max(total, 1e-12)));
            return v.length > share ? simplifyLine(v, 0, share) : v;
        });
        nodes = free.reduce((sum, v) => sum + v.length, 0);
    }
    const spans: number[] = [], pieces: number[] = [];
    for (const v of free) {
        for (let s = 0; s + 1 < v.length; s++) { spans.push(distance(v[s + 1], v[s])); pieces.push(1); }
    }
    if (even) {
        let at = 0;
        for (const p of even.pieces) for (const k of p) pieces[at++] = k;
    }
    // Extra points go, one at a time, to the stretch whose points are furthest apart
    for (let extra = even ? 0 : Math.min(maxSamples - nodes, 2 * spans.length); extra > 0; extra--) {
        let at = 0;
        for (let s = 1; s < spans.length; s++) if (spans[s] / pieces[s] > spans[at] / pieces[at]) at = s;
        if (!(spans[at] > 0)) break;
        pieces[at]++;
    }
    const out: number[] = [], groups: number[] = [];
    let stretch = 0;
    free.forEach((v, i) => {
        const put = (x: number, y: number, z: number) => { out.push(x, y, z); groups.push(which[i]); };
        for (let s = 0; s + 1 < v.length; s++, stretch++) {
            put(v[s][0], v[s][1], v[s][2]);
            for (let k = 1; k < pieces[stretch]; k++) {
                const f = k / pieces[stretch];
                put(v[s][0] + (v[s + 1][0] - v[s][0]) * f, v[s][1] + (v[s + 1][1] - v[s][1]) * f, v[s][2] + (v[s + 1][2] - v[s][2]) * f);
            }
        }
        const last = v[v.length - 1];
        put(last[0], last[1], last[2]);
    });
    return { positions: Float64Array.from(out), groups: Int32Array.from(groups) };
}

/**
 * For the places a surface passes through (`count` of them: its own points
 * first, the points along its lines in space last, as freeLineSamples gives
 * them), the slice each was marked on: the unit normal, xyz triples, zeros
 * where none is known. Null when none is known of any.
 */
export function placesAcross(points: readonly Pick<ScenePoint, 'across'>[], lines: readonly (LineShape & Pick<ScenePolyline, 'across'>)[], count: number): Float64Array | null {
    const free = lines.some(l => !l.plane && l.across && !isOrientedLine(l)) ? freeLineSamples(lines).groups : null;
    if (!free && !points.some(p => p.across)) return null;
    // (With nothing from the lines: one entry a point of its own, as before lines could be in space)
    const out = new Float64Array((free ? Math.max(count, points.length) : points.length) * 3);
    points.forEach((p, i) => { if (p.across) out.set(p.across, i * 3); });
    if (free) {
        const first = out.length / 3 - free.length;
        for (let j = 0; j < free.length && first >= 0; j++) {
            const across = lines[free[j]].across;
            if (across) out.set(across, (first + j) * 3);
        }
    }
    return out;
}

/** A node of a line that carries a dip tick, as a point with a reading: `line` is its line's place in the list, `vertex` its own along the line */
export type NodeReading = ScenePoint & { line: number; vertex: number };

/** The nodes of these lines that carry a dip tick (the id says which line and node). */
export function nodeReadings(lines: readonly Pick<ScenePolyline, 'id' | 'points' | 'nodes'>[]): NodeReading[] {
    const out: NodeReading[] = [];
    lines.forEach((line, g) => {
        line.nodes?.forEach((node, i) => {
            if (node?.reading && i < line.points.length) out.push({ id: `${line.id}/${i}`, p: line.points[i], reading: node.reading, line: g, vertex: i });
        });
    });
    return out;
}

/** Everywhere the lie of a surface was measured: its points with a reading among them, then the ticked nodes of its lines. */
export function measuredPlaces(points: readonly ScenePoint[], lines: readonly Pick<ScenePolyline, 'id' | 'points' | 'nodes'>[]): readonly ScenePoint[] {
    const ticks = nodeReadings(lines);
    return ticks.length > 0 ? [...points, ...ticks] : points;
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
    /** Per line: the unit normal of the slice it was drawn on (for a line in space with a ribbon: the ribbon at its start), xyz triples */
    across: Float64Array;
    /** Per line: its length */
    extrude: Float64Array;
    /**
     * At each point, the direction that lies in the surface there, square to
     * the line (unit, xyz triples; zeros: none): the ribbon. Only when a line
     * has nodes with directions; otherwise each line's is `across`.
     */
    ribbons?: Float64Array;
}

/** The direction square to a line's direction `t` within the plane whose normal is `n`. */
export function lineNormal(t: ArrayLike<number>, n: ArrayLike<number>): Vec3 | null {
    return unit(cross(t, n));
}

/**
 * Points along each line drawn on a slice, with the facing of the surface
 * there: its vertices and points evenly between them, no further apart than
 * the spacing (lineSpacing, doubled while there would be more than
 * `maxSamples`), so that a vertex moved changes only the samples near it.
 * With more vertices than `maxSamples`, each line gets a share by its length
 * (two at least): the vertices that shape it most and, with what is left,
 * points along its longest stretches. A line on no slice has no facing and gives nothing here
 * (freeLinePoints) unless its nodes give it a ribbon; it keeps its place in the per-line lists.
 * Where a line has a ribbon (ribbons.ts) the facing is square to the line and
 * to the ribbon; on a slice with no ribbon, the slice's normal stands for it.
 * Null when no such line has two distinct vertices.
 */
export function sampleLines(lines: readonly (LineShape & { flipped: boolean; id?: string })[], maxSamples = MAX_LINE_SAMPLES): LineSamples | null {
    const keys: (readonly RibbonKey[] | null)[] = lines.map(l => {
        const k = ribbonKeys(l).keys;
        return k.length > 0 ? k : null;
    });
    const whole = lines.map((l, g) => (l.plane || keys[g] ? simplifyLine(shapeOf(l), 0, Infinity) : []));
    const lengths = whole.map(lineLength);
    const total = lengths.reduce((s, v) => s + v, 0);
    if (!(total > 0)) return null;
    // Evenly along every stretch, at a spacing fixed to the ground (so an edit changes the samples near it only); with
    // too many vertices for that, each line gets a share by its length and keeps the vertices that shape it most
    const even = evenPieces(whole, maxSamples);
    const share = lengths.map(len => Math.max(2, Math.round(maxSamples * len / total)));
    const clean = even ? whole : whole.map((v, g) => (v.length > share[g] ? simplifyLine(v, 0, share[g]) : v));

    const positions: number[] = [], normals: number[] = [], offsets: number[] = [], groups: number[] = [], ribbons: number[] = [];
    lines.forEach((line, g) => {
        const v = clean[g];
        const own = keys[g];
        const n = own ? null : line.plane ? unit(line.plane.normal) : null;
        if (v.length < 2 || !(lengths[g] > 0) || (!n && !own)) return;
        const dirs = v.slice(1).map((p, i) => unit(sub(p, v[i]))!);
        const first = positions.length / 3;
        // How far along the line each vertex is (the ribbon is blended by it)
        const walked = new Float64Array(v.length);
        for (let s = 1; s < v.length; s++) walked[s] = walked[s - 1] + distance(v[s], v[s - 1]);
        const length = walked[v.length - 1];
        const push = (p: ArrayLike<number>, t: ArrayLike<number>, along: number) => {
            const r = own ? ribbonAt(own, length > 0 ? along / length : 0, t) : n!;
            const m = r ? lineNormal(t, r) : null;
            positions.push(p[0], p[1], p[2]);
            normals.push(m ? m[0] : 0, m ? m[1] : 0, m ? m[2] : 0);
            ribbons.push(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0);
            groups.push(g);
        };
        // Extra points go, one at a time, to the stretch whose points are furthest apart
        const spans = dirs.map((_, s) => distance(v[s + 1], v[s]));
        const pieces = even ? even.pieces[g] : new Int32Array(dirs.length).fill(1);
        for (let extra = even ? 0 : share[g] - v.length; extra > 0; extra--) {
            let at = 0;
            for (let s = 1; s < spans.length; s++) if (spans[s] / pieces[s] > spans[at] / pieces[at]) at = s;
            pieces[at]++;
        }
        for (let s = 0; s < dirs.length; s++) {
            // At a vertex the line's direction is the mean of the two it joins (the later one where it doubles back)
            const at = s === 0 ? dirs[0] : unit([dirs[s - 1][0] + dirs[s][0], dirs[s - 1][1] + dirs[s][1], dirs[s - 1][2] + dirs[s][2]]) ?? dirs[s];
            push(v[s], at, walked[s]);
            for (let k = 1; k < pieces[s]; k++) {
                const f = k / pieces[s];
                push([v[s][0] + (v[s + 1][0] - v[s][0]) * f, v[s][1] + (v[s + 1][1] - v[s][1]) * f, v[s][2] + (v[s + 1][2] - v[s][2]) * f], dirs[s], walked[s] + f * spans[s]);
            }
        }
        push(v[v.length - 1], dirs[dirs.length - 1], length);
        const count = positions.length / 3 - first;
        // (At even spacing, the same along every line whatever its length, so that an edit does not move the rest)
        const d = OFFSET_SHARE * (even ? Math.min(even.spacing, lengths[g]) : lengths[g] / (count - 1));
        for (let i = first; i < first + count; i++) offsets.push(normals[i * 3] === 0 && normals[i * 3 + 1] === 0 && normals[i * 3 + 2] === 0 ? 0 : d);
    });
    if (positions.length === 0) return null;

    const across = new Float64Array(lines.length * 3);
    lines.forEach((l, g) => {
        const own = keys[g];
        if (own) across.set(own[0].dir, g * 3);
        else if (l.plane) across.set(unit(l.plane.normal) ?? [0, 0, 1], g * 3);
    });
    return {
        positions: Float64Array.from(positions), normals: Float64Array.from(normals), offsets: Float64Array.from(offsets),
        groups: Int32Array.from(groups),
        flipped: Uint8Array.from(lines, l => (l.flipped ? 1 : 0)),
        across, extrude: Float64Array.from(lengths),
        // (Only where a line has a ribbon of its own: everything else is as it was before there were any)
        ...(keys.some(k => k) ? { ribbons: Float64Array.from(ribbons) } : {}),
    };
}
