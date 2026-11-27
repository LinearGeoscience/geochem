/**
 * Section helpers (pure functions, no three.js / DOM), used by the drillhole
 * planner's 2D slice view. Meshes (surfaces, wireframe solids) are cut by
 * features/model/section.ts (sectionMesh / useSceneTraces); this file adds:
 *
 * - Lines (strings, pit outlines, faults as polylines) PROJECTED onto the
 *   section where they lie within the slab, and marked where they cross the
 *   plane (sectionStrings).
 * - The A–B extent: lines drawn on the section cut off at A and B (clipAlong).
 * - The A/B handle maths for the plan inset (lineFromEnds, planPoint).
 *
 * Everything stays in world float64 (UTM northings). Distance along and
 * offset follow sectionProjection: along grows in the azimuth direction,
 * offset is positive to the right of it.
 */
import type { SectionLine } from './sectionProjection';
import type { WireframePart } from '../features/plots/viewer3d/wireframeParsers';

export interface SectionStrings {
    /** Line segments within the slab, projected: x = along, y = elevation; null between segments */
    lineX: (number | null)[];
    lineY: (number | null)[];
    /** Where lines cross the plane */
    crossX: number[];
    crossY: number[];
}

/** Clip the segment from along s0 to s1 to [lo, hi]: the kept fraction [t0, t1], or null when none is kept. */
function clipSpan(s0: number, s1: number, lo: number, hi: number): [number, number] | null {
    const ds = s1 - s0;
    if (ds === 0) return s0 < lo || s0 > hi ? null : [0, 1];
    const ta = (lo - s0) / ds, tb = (hi - s0) / ds;
    const t0 = Math.max(0, Math.min(ta, tb)), t1 = Math.min(1, Math.max(ta, tb));
    return t0 > t1 ? null : [t0, t1];
}

/**
 * Project the line segments (strings) of one wireframe part onto the section.
 * Triangles are ignored (GeoChem's sectionMesh cuts those). `alongRange`
 * limits the result to the A–B extent of the section (inclusive).
 */
export function sectionStrings(
    part: WireframePart,
    line: SectionLine,
    alongRange?: [number, number] | null,
): SectionStrings {
    const out: SectionStrings = { lineX: [], lineY: [], crossX: [], crossY: [] };
    const ln = part.lines;
    if (ln.length === 0) return out;
    const v = part.vertices;
    const a = (line.azimuth * Math.PI) / 180;
    const sa = Math.sin(a), ca = Math.cos(a);
    const lo = alongRange ? Math.min(alongRange[0], alongRange[1]) : -Infinity;
    const hi = alongRange ? Math.max(alongRange[0], alongRange[1]) : Infinity;
    const along = (i: number) => (v[i * 3] - line.originE) * sa + (v[i * 3 + 1] - line.originN) * ca;
    const off = (i: number) => (v[i * 3] - line.originE) * ca - (v[i * 3 + 1] - line.originN) * sa;
    const hw = line.halfWidth;
    for (let k = 0; k < ln.length; k += 2) {
        const i = ln[k], j = ln[k + 1];
        const si = along(i), sj = along(j), oi = off(i), oj = off(j);
        const zi = v[i * 3 + 2], zj = v[j * 3 + 2];
        if (Math.abs(oi) <= hw && Math.abs(oj) <= hw) {
            const t = clipSpan(si, sj, lo, hi);
            if (t) {
                out.lineX.push(si + (sj - si) * t[0], si + (sj - si) * t[1], null);
                out.lineY.push(zi + (zj - zi) * t[0], zi + (zj - zi) * t[1], null);
            }
        }
        // A vertex exactly on the plane counts as the positive side (no double points)
        if ((oi >= 0) !== (oj >= 0)) {
            const t = oi / (oi - oj);
            const s = si + (sj - si) * t;
            if (s >= lo && s <= hi) { out.crossX.push(s); out.crossY.push(zi + (zj - zi) * t); }
        }
    }
    return out;
}

/**
 * Cut lines drawn on the section (x = along, y = elevation, lines separated
 * by null) off at the A–B extent: each segment is clipped to [lo, hi] along
 * the section, and a line that leaves and comes back is split in two.
 */
export function clipAlong(
    x: readonly (number | null)[],
    y: readonly (number | null)[],
    lo: number,
    hi: number,
): { x: (number | null)[]; y: (number | null)[] } {
    const a = Math.min(lo, hi), b = Math.max(lo, hi);
    const ox: (number | null)[] = [], oy: (number | null)[] = [];
    const gap = () => { if (ox.length && ox[ox.length - 1] !== null) { ox.push(null); oy.push(null); } };
    let open = false; // the last point written is the previous input point
    for (let i = 0; i < x.length; i++) {
        const x1 = x[i], y1 = y[i];
        if (x1 === null || y1 === null) { open = false; continue; }
        const x0 = i > 0 ? x[i - 1] : null, y0 = i > 0 ? y[i - 1] : null;
        if (x0 === null || y0 === null) {
            // A line of one point
            const next = i + 1 < x.length ? x[i + 1] : null;
            if (next === null && x1 >= a && x1 <= b) { gap(); ox.push(x1); oy.push(y1); }
            open = false;
            continue;
        }
        const t = clipSpan(x0, x1, a, b);
        if (!t) { open = false; continue; }
        const dx = x1 - x0, dy = y1 - y0;
        if (!(open && t[0] === 0)) { gap(); ox.push(x0 + dx * t[0]); oy.push(y0 + dy * t[0]); }
        ox.push(x0 + dx * t[1]); oy.push(y0 + dy * t[1]);
        open = t[1] === 1;
    }
    return { x: ox, y: oy };
}

/**
 * A–B ends of a section from two plan points: origin at the midpoint (rounded
 * to the metre), azimuth from A towards B (rounded to 0.1°), and A / B as
 * distances along the section from that origin. `round: false` keeps the
 * origin and azimuth exact (the drillhole planner: a section through a target
 * must pass through it).
 */
export function lineFromEnds(aE: number, aN: number, bE: number, bN: number, opts: { round?: boolean } = {}): { originE: number; originN: number; azimuth: number; ends: [number, number] } | null {
    const round = opts.round ?? true;
    const de = bE - aE, dn = bN - aN;
    const len = Math.hypot(de, dn);
    if (!Number.isFinite(len) || len < 1e-6) return null;
    const originE = round ? Math.round((aE + bE) / 2) : (aE + bE) / 2, originN = round ? Math.round((aN + bN) / 2) : (aN + bN) / 2;
    let azimuth = (Math.atan2(de, dn) * 180) / Math.PI;
    azimuth = (((azimuth % 360) + 360) % 360);
    if (round) azimuth = Math.round(azimuth * 10) / 10;
    const r = (azimuth * Math.PI) / 180;
    const alongOf = (e: number, n: number) => (e - originE) * Math.sin(r) + (n - originN) * Math.cos(r);
    return { originE, originN, azimuth, ends: [alongOf(aE, aN), alongOf(bE, bN)] };
}

/** Plan position of a point `s` metres along the section. */
export function planPoint(line: Pick<SectionLine, 'originE' | 'originN' | 'azimuth'>, s: number): [number, number] {
    const a = (line.azimuth * Math.PI) / 180;
    return [line.originE + s * Math.sin(a), line.originN + s * Math.cos(a)];
}

/**
 * The section after its A–B line was dragged on a plan inset: a Plotly
 * relayout event that edited layout shape `shape` (the line, x0 / y0 = A,
 * x1 / y1 = B), applied to the section as it was. Null when the event did not
 * edit that shape. Dragging an end moves that end; dragging the middle moves
 * both.
 */
export function editedSectionEnds(
    ev: unknown,
    line: Pick<SectionLine, 'originE' | 'originN' | 'azimuth'>,
    ends: [number, number],
    opts: { shape?: number; round?: boolean } = {},
): { originE: number; originN: number; azimuth: number; ends: [number, number] } | null {
    if (!ev || typeof ev !== 'object') return null;
    const e = ev as Record<string, unknown>;
    const i = opts.shape ?? 0;
    const keys = ['x0', 'y0', 'x1', 'y1'] as const;
    const fromShape = Array.isArray(e.shapes) ? (e.shapes[i] as Record<string, unknown> | undefined) ?? null : null;
    const edited = keys.map(k => (fromShape ? fromShape[k] : e[`shapes[${i}].${k}`]));
    if (edited.every(v => v === undefined)) return null;
    const [aE, aN] = planPoint(line, ends[0]);
    const [bE, bN] = planPoint(line, ends[1]);
    const cur = [aE, aN, bE, bN];
    const p = edited.map((v, k) => (v === undefined || !Number.isFinite(Number(v)) ? cur[k] : Number(v)));
    return lineFromEnds(p[0], p[1], p[2], p[3], { round: opts.round });
}
