/**
 * Geometry for classification diagrams (schema v3, types/diagram.ts).
 *
 * Everything is computed in PLOT SPACE:
 *  - XY diagrams: [x, y], with log10 applied on log axes. Straight segments
 *    and Bezier curves are straight/curved on screen, as in the reference software.
 *  - Ternary diagrams: the Cartesian triangle B(0,0) - C(100,0) - A(50, 86.6),
 *    the same frame uses. Plotly draws it on ordinary x/y axes with an
 *    equal aspect ratio, which lets labels rotate and arrows point.
 */
import type { Diagram, DiagramField, PathSegment, Pt } from '../../../types/diagram';

export const TRI_H = 50 * Math.sqrt(3);

export type P2 = [number, number];

/** [a, b, c] (any positive scale) → Cartesian triangle of side 100. */
export function ternaryToXY(p: Pt): P2 {
    const s = p[0] + p[1] + p[2];
    const a = (p[0] / s) * 100, c = (p[2] / s) * 100;
    return [c + a / 2, (a / 100) * TRI_H];
}

/** Cartesian triangle → [a, b, c] percent. */
export function xyToTernary(x: number, y: number): [number, number, number] {
    const a = (y / TRI_H) * 100;
    const c = x - a / 2;
    return [a, 100 - a - c, c];
}

export interface DiagramFrame {
    kind: 'xy' | 'ternary';
    logX: boolean;
    logY: boolean;
    /** Diagram coordinates → plot space (null if not drawable, e.g. log of ≤ 0). */
    toPlot(p: Pt): P2 | null;
    /** Plot space → values for a Plotly trace (undo the log). */
    toTrace(u: number, v: number): P2;
}

const log10 = (v: number) => (v > 0 ? Math.log10(v) : NaN);

export function makeFrame(d: Pick<Diagram, 'kind' | 'axes'>): DiagramFrame {
    if (d.kind === 'ternary') {
        return {
            kind: 'ternary', logX: false, logY: false,
            toPlot: p => ternaryToXY(p),
            toTrace: (u, v) => [u, v],
        };
    }
    const logX = !!d.axes.x?.log, logY = !!d.axes.y?.log;
    return {
        kind: 'xy', logX, logY,
        toPlot: p => {
            const u = logX ? log10(p[0]) : p[0];
            const v = logY ? log10(p[1]) : p[1];
            return Number.isFinite(u) && Number.isFinite(v) ? [u, v] : null;
        },
        toTrace: (u, v) => [logX ? 10 ** u : u, logY ? 10 ** v : v],
    };
}

// ---------------------------------------------------------------------------
// Path flattening
// ---------------------------------------------------------------------------

function distToChord(p: P2, a: P2, b: P2): number {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
}

/** Adaptive de Casteljau subdivision; pushes the points after p0 (p3 included). */
function flattenCubic(p0: P2, c1: P2, c2: P2, p3: P2, tol: number, out: P2[], depth = 0): void {
    if (depth >= 12 || Math.max(distToChord(c1, p0, p3), distToChord(c2, p0, p3)) <= tol) {
        out.push(p3);
        return;
    }
    const mid = (a: P2, b: P2): P2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const p01 = mid(p0, c1), p12 = mid(c1, c2), p23 = mid(c2, p3);
    const p012 = mid(p01, p12), p123 = mid(p12, p23);
    const m = mid(p012, p123);
    flattenCubic(p0, p01, p012, m, tol, out, depth + 1);
    flattenCubic(m, p123, p23, p3, tol, out, depth + 1);
}

/**
 * Flatten a field path to a plot-space polyline. Bezier control points are
 * mapped through the frame first (the ternary map is affine, so curves stay
 * exact). `tol` is the maximum deviation in plot units.
 */
export function flattenPath(start: Pt, path: PathSegment[], frame: DiagramFrame, tol: number): P2[] {
    const s = frame.toPlot(start);
    if (!s) return [];
    const out: P2[] = [s];
    let prev = s;
    for (const seg of path) {
        const to = frame.toPlot(seg.to);
        if (!to) return [];
        if (seg.kind === 'line') {
            out.push(to);
        } else {
            const c1 = frame.toPlot(seg.c1), c2 = frame.toPlot(seg.c2);
            if (!c1 || !c2) return [];
            flattenCubic(prev, c1, c2, to, tol, out);
        }
        prev = to;
    }
    return out;
}

/** Field outline in plot space; closed fields end at their first vertex. */
export function fieldPolyline(f: DiagramField, frame: DiagramFrame, tol: number): P2[] {
    const pts = flattenPath(f.start, f.path, frame, tol);
    if (f.closed && pts.length > 2) {
        const [a, b] = [pts[0], pts[pts.length - 1]];
        if (a[0] !== b[0] || a[1] !== b[1]) pts.push(a);
    }
    return pts;
}

// ---------------------------------------------------------------------------
// Polygons
// ---------------------------------------------------------------------------

export interface Box { x0: number; x1: number; y0: number; y1: number }

export const emptyBox = (): Box => ({ x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity });

export function bboxOf(pts: P2[], into: Box = emptyBox()): Box {
    for (const [x, y] of pts) {
        if (x < into.x0) into.x0 = x;
        if (x > into.x1) into.x1 = x;
        if (y < into.y0) into.y0 = y;
        if (y > into.y1) into.y1 = y;
    }
    return into;
}

/** Even-odd ray casting. */
export function pointInPolygon(x: number, y: number, poly: P2[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

export function polygonArea(poly: P2[]): number {
    let s = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    return Math.abs(s) / 2;
}

function distToSegment(x: number, y: number, a: P2, b: P2): number {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((x - a[0]) * dx + (y - a[1]) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}

/**
 * Pole of inaccessibility (the interior point farthest from the edges) by a
 * refining grid search: a better label anchor than the centroid for concave
 * fields. `sx`/`sy` normalise the axes so distances are visual.
 */
export function labelAnchor(poly: P2[], sx = 1, sy = 1): P2 {
    const n = poly.map(([x, y]): P2 => [x / sx, y / sy]);
    const b = bboxOf(n);
    const edgeDist = (x: number, y: number) => {
        let m = Infinity;
        for (let i = 0, j = n.length - 1; i < n.length; j = i++) m = Math.min(m, distToSegment(x, y, n[j], n[i]));
        return pointInPolygon(x, y, n) ? m : -m;
    };
    let best: P2 = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
    let bestD = edgeDist(best[0], best[1]);
    let w = b.x1 - b.x0, h = b.y1 - b.y0;
    let cx = best[0], cy = best[1];
    for (let round = 0; round < 4; round++) {
        const N = 12;
        for (let i = 0; i <= N; i++) {
            for (let j = 0; j <= N; j++) {
                const x = cx - w / 2 + (w * i) / N, y = cy - h / 2 + (h * j) / N;
                const dd = edgeDist(x, y);
                if (dd > bestD) { bestD = dd; best = [x, y]; }
            }
        }
        [cx, cy] = best;
        w /= 3; h /= 3;
    }
    return [best[0] * sx, best[1] * sy];
}

// ---------------------------------------------------------------------------
// Straight lines
// ---------------------------------------------------------------------------

/** Clip the infinite line through p with direction d to a convex polygon. */
export function clipLineToConvex(p: P2, d: P2, poly: P2[]): [P2, P2] | null {
    let area = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) area += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    const sign = area > 0 ? 1 : -1;
    let t0 = -Infinity, t1 = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[j], b = poly[i];
        // inward normal of edge a→b
        const nx = -(b[1] - a[1]) * sign, ny = (b[0] - a[0]) * sign;
        const num = nx * (p[0] - a[0]) + ny * (p[1] - a[1]);
        const den = nx * d[0] + ny * d[1];
        if (Math.abs(den) < 1e-15) {
            if (num < 0) return null;
            continue;
        }
        const t = -num / den;
        if (den > 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    }
    if (!(t0 < t1) || !Number.isFinite(t0) || !Number.isFinite(t1)) return null;
    return [[p[0] + t0 * d[0], p[1] + t0 * d[1]], [p[0] + t1 * d[0], p[1] + t1 * d[1]]];
}

export function rectPolygon(b: Box): P2[] {
    return [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]];
}

export const TRIANGLE: P2[] = [[0, 0], [100, 0], [50, TRI_H]];
