/**
 * The drawn lines of a surface in the 3D view: what to draw for them and
 * which one the cursor is on (pure, unit-tested).
 */
import { lineLength, lineNormal } from '../../model/lines';
import { unit } from '../../model/plane';
import { shapeOf } from '../../model/splines';
import type { ScenePoint, ScenePolyline, Vec3 } from '../../model/types';

/** Ticks along each line, on the surface's positive side */
const TICKS = 9;
/** A tick's length as a share of its line's length */
const TICK_SHARE = 0.03;

/** A line's vertices as local xyz triples (world minus the view's origin). */
export function localLine(points: readonly Vec3[], origin: ArrayLike<number>): Float32Array {
    const out = new Float32Array(points.length * 3);
    points.forEach((p, i) => { out[i * 3] = p[0] - origin[0]; out[i * 3 + 1] = p[1] - origin[1]; out[i * 3 + 2] = p[2] - origin[2]; });
    return out;
}

/** Consecutive xyz triples as stretches: pairs of ends, 6 numbers each. */
export function stretches(xyz: ArrayLike<number>): number[] {
    const out: number[] = [];
    for (let i = 3; i + 2 < xyz.length; i += 3) out.push(xyz[i - 3], xyz[i - 2], xyz[i - 1], xyz[i], xyz[i + 1], xyz[i + 2]);
    return out;
}

/**
 * Short ticks along a line, evenly spaced, square to it within its slice and
 * pointing to the side `sign` says is the surface's positive one (pairs of
 * ends, local).
 */
export function lineTicks(line: ScenePolyline, sign: number, origin: ArrayLike<number>): number[] {
    // (Along a smooth line's curve)
    const v = shapeOf(line);
    const total = lineLength(v);
    // (A line in space has no side of its own to tick)
    if (!(total > 0) || !sign || !line.plane) return [];
    const size = TICK_SHARE * total;
    const out: number[] = [];
    let k = 0, walked = 0;
    for (let s = 1; s < v.length && k < TICKS; s++) {
        const a = v[s - 1], b = v[s];
        const span = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        const dir = unit([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
        const side = dir && lineNormal(dir, line.plane.normal);
        for (let at = (k + 0.5) * total / TICKS; k < TICKS && at <= walked + span + 1e-9; at = (++k + 0.5) * total / TICKS) {
            if (!side || !(span > 0)) continue;
            const f = (at - walked) / span;
            const p = [a[0] + (b[0] - a[0]) * f - origin[0], a[1] + (b[1] - a[1]) * f - origin[1], a[2] + (b[2] - a[2]) * f - origin[2]];
            out.push(p[0], p[1], p[2], p[0] + sign * size * side[0], p[1] + sign * size * side[1], p[2] + sign * size * side[2]);
        }
        walked += span;
    }
    return out;
}

/**
 * The strike-and-dip mark of every point with a dip reading: a bar along the
 * strike, `size` either way, and a shorter tick from its middle down the dip
 * (pairs of ends, local).
 */
export function readingMarks(points: readonly ScenePoint[], origin: ArrayLike<number>, size: number): number[] {
    const out: number[] = [];
    for (const { p, reading } of points) {
        if (!reading) continue;
        const a = reading.dipDirection * Math.PI / 180, d = reading.dip * Math.PI / 180;
        const strike = [Math.cos(a), -Math.sin(a), 0];
        const down = [Math.sin(a) * Math.cos(d), Math.cos(a) * Math.cos(d), -Math.sin(d)];
        const at = [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
        out.push(
            at[0] - size * strike[0], at[1] - size * strike[1], at[2], at[0] + size * strike[0], at[1] + size * strike[1], at[2],
            at[0], at[1], at[2], at[0] + 0.6 * size * down[0], at[1] + 0.6 * size * down[1], at[2] + 0.6 * size * down[2],
        );
    }
    return out;
}

/**
 * Everything to draw for a surface's lines (a smooth one along its curve): `all` the lines with their
 * ticks, and `active` the one pointed out (by id) plus a line being drawn
 * (`draft`, local xyz triples). Ticks need the fit's answer (`signs`, one per
 * line): until it arrives a line has none.
 */
export function editLineSegments(
    lines: readonly ScenePolyline[], origin: ArrayLike<number>, signs: ArrayLike<number> | null, hot: string | null, draft: ArrayLike<number> | null = null,
): { all: Float32Array; active: Float32Array } {
    const all: number[] = [], active: number[] = [];
    lines.forEach((line, i) => {
        const into = line.id === hot ? active : all;
        for (const v of stretches(localLine(shapeOf(line), origin))) into.push(v);
        if (signs && i < signs.length) for (const v of lineTicks(line, signs[i], origin)) into.push(v);
    });
    if (draft) for (const v of stretches(draft)) active.push(v);
    return { all: Float32Array.from(all), active: Float32Array.from(active) };
}

/** Every node (vertex) of every line, for drawing and for finding the one under the cursor. */
export interface LineNodes {
    /** Local xyz, 3 per node */
    positions: Float32Array;
    /** Each node's line (index) and its place along it */
    line: Int32Array;
    vertex: Int32Array;
}

export function lineNodes(lines: readonly ScenePolyline[], origin: ArrayLike<number>): LineNodes {
    const count = lines.reduce((s, l) => s + l.points.length, 0);
    const positions = new Float32Array(count * 3), line = new Int32Array(count), vertex = new Int32Array(count);
    let k = 0;
    lines.forEach((l, i) => l.points.forEach((p, v) => {
        positions[k * 3] = p[0] - origin[0];
        positions[k * 3 + 1] = p[1] - origin[1];
        positions[k * 3 + 2] = p[2] - origin[2];
        line[k] = i;
        vertex[k++] = v;
    }));
    return { positions, line, vertex };
}

/** The place on the stretch a-b nearest to p. */
export function nearestOnStretch(a: ArrayLike<number>, b: ArrayLike<number>, p: ArrayLike<number>): Vec3 {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / len2)) : 0;
    return [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t];
}

/** A line's vertices with one more, put into the stretch that starts at vertex `segment`. */
export function withNode(points: readonly Vec3[], segment: number, p: Vec3): Vec3[] {
    const at = Math.min(Math.max(segment, 0), points.length - 1) + 1;
    return [...points.slice(0, at), p, ...points.slice(at)];
}

/** A line's vertices with one moved (the others are the same arrays). */
export function withNodeAt(points: readonly Vec3[], vertex: number, p: Vec3): Vec3[] {
    return points.map((q, i) => (i === vertex ? p : q));
}

export interface LinePick {
    /** Index of the line */
    line: number;
    /** The cursor is on its first or its last vertex (null: somewhere along it) */
    end: 'start' | 'end' | null;
    /** The stretch the cursor is on: it starts at this vertex (at an end: the stretch that end belongs to) */
    segment: number;
}

/**
 * The line under the cursor. `screen` holds each line's vertices as CSS-pixel
 * x, y pairs (NaN when off screen). An end of a line within `endPx` wins over
 * the body of any line within `linePx`.
 */
export function pickLine(screen: readonly ArrayLike<number>[], cursor: [number, number], linePx = 6, endPx = 10): LinePick | null {
    let best: LinePick | null = null, bestD = Infinity;
    screen.forEach((xy, line) => {
        const n = Math.floor(xy.length / 2);
        if (n < 2) return;
        for (const [end, i] of [['start', 0], ['end', n - 1]] as const) {
            const d = Math.hypot(xy[i * 2] - cursor[0], xy[i * 2 + 1] - cursor[1]);
            if (d <= endPx && (best?.end == null || d < bestD)) { best = { line, end, segment: end === 'start' ? 0 : n - 2 }; bestD = d; }
        }
    });
    if (best) return best;
    screen.forEach((xy, line) => {
        for (let i = 1; i * 2 + 1 < xy.length; i++) {
            const ax = xy[i * 2 - 2], ay = xy[i * 2 - 1], bx = xy[i * 2], by = xy[i * 2 + 1];
            if (!Number.isFinite(ax + ay + bx + by)) continue;
            const dx = bx - ax, dy = by - ay;
            const len2 = dx * dx + dy * dy;
            const t = len2 > 0 ? Math.min(1, Math.max(0, ((cursor[0] - ax) * dx + (cursor[1] - ay) * dy) / len2)) : 0;
            const d = Math.hypot(ax + dx * t - cursor[0], ay + dy * t - cursor[1]);
            if (d <= linePx && d < bestD) { best = { line, end: null, segment: i - 1 }; bestD = d; }
        }
    });
    return best;
}
