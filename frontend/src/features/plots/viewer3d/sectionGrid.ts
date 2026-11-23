/**
 * The grid on a section's plane (pure, unit-tested): lines at round
 * coordinates across the part of the plane inside the data, each labelled at
 * its lower or left end. A W-E section is gridded by easting and elevation, a
 * S-N section by northing and elevation, a level plan by easting and
 * northing; sections on other bearings and tilted planes by distance along
 * and up them from the set's first plane.
 */
import { niceTicks } from './geometry';
import { planeBoxPolygon } from './slices';
import { sectionKind, sectionPlane } from '../../model/sectionSets';
import type { SectionSet, Vec3 } from '../../model/types';

export interface PlaneAxes {
    /** Across the view (left to right) and up it, unit vectors */
    u: Vec3;
    v: Vec3;
    /** The coordinate a point (world) has along each */
    uAt: (p: ArrayLike<number>) => number;
    vAt: (p: ArrayLike<number>) => number;
    uLabel: (value: number) => string;
    vLabel: (value: number) => string;
}

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: ArrayLike<number>, b: ArrayLike<number>): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };

export const formatGrid = (v: number) => {
    const r = Math.abs(v) < 1e-9 ? 0 : v;
    return r.toLocaleString('en-US', { maximumFractionDigits: Math.abs(r) >= 100 ? 0 : 2, useGrouping: Math.abs(r) >= 10000 });
};
const distance = (v: number) => (Math.abs(v) < 1e-9 ? '0 m' : `${v > 0 ? '+' : '−'}${formatGrid(Math.abs(v))} m`);

/** The two directions a set's planes are gridded along, and what they are called. */
export function planeAxes(set: Pick<SectionSet, 'normal' | 'origin'>): PlaneAxes {
    const kind = sectionKind(set.normal);
    const o = set.origin;
    if (kind === 'level') return { u: [1, 0, 0], v: [0, 1, 0], uAt: p => p[0], vAt: p => p[1], uLabel: x => `${formatGrid(x)} E`, vLabel: y => `${formatGrid(y)} N` };
    const rl = (z: number) => `RL ${formatGrid(z)}`;
    if (kind === 'we') return { u: [1, 0, 0], v: [0, 0, 1], uAt: p => p[0], vAt: p => p[2], uLabel: x => `${formatGrid(x)} E`, vLabel: rl };
    if (kind === 'sn') return { u: [0, 1, 0], v: [0, 0, 1], uAt: p => p[1], vAt: p => p[2], uLabel: y => `${formatGrid(y)} N`, vLabel: rl };
    // Along the planes' strike (pointing east-ish, or north when due N-S) and up them
    let u = unit(cross([0, 0, 1], set.normal));
    if (u[0] < -1e-12 || (Math.abs(u[0]) <= 1e-12 && u[1] < 0)) u = [-u[0], -u[1], -u[2]];
    const along = (p: ArrayLike<number>) => dot([p[0] - o[0], p[1] - o[1], p[2] - o[2]], u);
    if (kind === 'section') return { u, v: [0, 0, 1], uAt: along, vAt: p => p[2], uLabel: distance, vLabel: rl };
    let v = cross(set.normal, u);
    if (v[2] < 0) v = [-v[0], -v[1], -v[2]];
    return { u, v, uAt: along, vAt: p => dot([p[0] - o[0], p[1] - o[1], p[2] - o[2]], v), uLabel: distance, vLabel: distance };
}

/**
 * The grid on plane `index` of a set, inside `bounds` (local coordinates,
 * true elevation; `origin` takes them to world). Null where the plane misses
 * the box. `lines` are pairs of xyz ends; each label sits at a line's end.
 */
export function sectionGrid(
    set: Pick<SectionSet, 'normal' | 'origin' | 'spacing'>, index: number,
    bounds: { min: ArrayLike<number>; max: ArrayLike<number> }, origin: ArrayLike<number>, count = 6,
): { lines: number[]; labels: { text: string; p: Vec3 }[] } | null {
    const plane = sectionPlane(set, index);
    const local: Vec3 = [plane.point[0] - origin[0], plane.point[1] - origin[1], plane.point[2] - origin[2]];
    const poly = planeBoxPolygon(plane.normal, local, bounds);
    const n = poly.length / 3;
    if (n < 3) return null;
    const axes = planeAxes(set);
    const corner = (i: number): Vec3 => [poly[i * 3], poly[i * 3 + 1], poly[i * 3 + 2]];
    const world = (p: Vec3): Vec3 => [p[0] + origin[0], p[1] + origin[1], p[2] + origin[2]];
    const us: number[] = [], vs: number[] = [];
    for (let i = 0; i < n; i++) { const w = world(corner(i)); us.push(axes.uAt(w)); vs.push(axes.vAt(w)); }
    const lines: number[] = [];
    const labels: { text: string; p: Vec3 }[] = [];
    /** Where the outline crosses value `t` of `along`: its two ends, the one lowest in `other` first */
    const across = (along: number[], other: number[], t: number): [Vec3, Vec3] | null => {
        const hits: { p: Vec3; o: number }[] = [];
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const a = along[i] - t, b = along[j] - t;
            if (a === b || a * b > 0) continue;
            const f = a / (a - b);
            const pa = corner(i), pb = corner(j);
            hits.push({ p: [pa[0] + f * (pb[0] - pa[0]), pa[1] + f * (pb[1] - pa[1]), pa[2] + f * (pb[2] - pa[2])], o: other[i] + f * (other[j] - other[i]) });
        }
        if (hits.length < 2) return null;
        hits.sort((x, y) => x.o - y.o);
        const lo = hits[0], hi = hits[hits.length - 1];
        return hi.o - lo.o > 1e-9 ? [lo.p, hi.p] : null;
    };
    const range = (vals: number[]) => [Math.min(...vals), Math.max(...vals)];
    const [u0, u1] = range(us), [v0, v1] = range(vs);
    // The same step both ways (the longer side's), so the squares are square
    const step = (ticks: number[]) => (ticks.length > 1 ? ticks[1] - ticks[0] : 0);
    const uTicks = niceTicks(u0, u1, count), vTicks = niceTicks(v0, v1, count);
    const both = Math.max(step(uTicks), step(vTicks)) || Infinity;
    const evenly = (lo: number, hi: number) => {
        if (!Number.isFinite(both)) return niceTicks(lo, hi, count);
        const out: number[] = [];
        for (let k = Math.ceil(lo / both - 1e-9); k * both <= hi + both * 1e-9; k++) out.push(Number((k * both).toPrecision(12)));
        return out;
    };
    for (const t of evenly(u0, u1)) {
        const ends = across(us, vs, t);
        if (!ends) continue;
        lines.push(...ends[0], ...ends[1]);
        labels.push({ text: axes.uLabel(t), p: ends[0] });
    }
    for (const t of evenly(v0, v1)) {
        const ends = across(vs, us, t);
        if (!ends) continue;
        lines.push(...ends[0], ...ends[1]);
        labels.push({ text: axes.vLabel(t), p: ends[0] });
    }
    return { lines, labels };
}

/** A round length for a scale bar about `target` pixels long, at `pixelsPerMetre` (1-2-5 steps). */
export function scaleBarLength(pixelsPerMetre: number, target = 120): number | null {
    if (!(pixelsPerMetre > 0) || !Number.isFinite(pixelsPerMetre)) return null;
    const raw = target / pixelsPerMetre;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    return Number(((norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag).toPrecision(6));
}
