/**
 * The throw across a fault, read from a marker (pure): where a contact meets
 * the fault on one side of it, and where the same contact meets it on the
 * other, and how much higher the one line is than the other.
 *
 * Each line is where the contact's field is zero on the fault's own mesh.
 * The two are compared place by place along the fault (along the level
 * direction the lines are longest in), so a marker that slopes along the
 * fault does not count as throw.
 */
import type { TriMesh } from './types';

/** Where a field read at a mesh's vertices is zero on the mesh: a place on each edge it changes sign along (xyz triples) */
export function zeroTrace(mesh: TriMesh, values: ArrayLike<number>): Float64Array {
    const { vertices: v, triangles: t } = mesh;
    const nv = v.length / 3;
    const seen = new Set<number>();
    const out: number[] = [];
    for (let i = 0; i < t.length; i += 3) {
        for (let e = 0; e < 3; e++) {
            const p = t[i + e], q = t[i + (e + 1) % 3];
            const fp = values[p], fq = values[q];
            if (!Number.isFinite(fp) || !Number.isFinite(fq) || (fp > 0) === (fq > 0)) continue;
            const key = p < q ? p * nv + q : q * nv + p;
            if (seen.has(key)) continue;
            seen.add(key);
            const w = fp / (fp - fq);
            out.push(v[p * 3] + w * (v[q * 3] - v[p * 3]), v[p * 3 + 1] + w * (v[q * 3 + 1] - v[p * 3 + 1]), v[p * 3 + 2] + w * (v[q * 3 + 2] - v[p * 3 + 2]));
        }
    }
    return new Float64Array(out);
}

export interface Throw {
    /** How much higher the first line is than the second, m: the middle of the differences along the fault */
    throw: number;
    /** A tenth of the differences are below `low`, a tenth above `high` */
    low: number;
    high: number;
    /** How many places along the fault it was read at */
    places: number;
    /** How far along the fault the two lines run side by side, m */
    length: number;
}

/** The fewest places the two lines must run side by side at */
const LEAST_PLACES = 3;

/**
 * How much higher line `a` is than line `b` (places as xyz triples, in any
 * order), compared at the same distance along the level direction they run
 * in. Null: they do not run side by side.
 */
export function verticalThrow(a: Float64Array, b: Float64Array): Throw | null {
    const na = a.length / 3, nb = b.length / 3;
    if (na < 2 || nb < 2) return null;
    // The level direction both lines are longest in
    let mx = 0, my = 0;
    for (const line of [a, b]) for (let i = 0; i < line.length; i += 3) { mx += line[i]; my += line[i + 1]; }
    mx /= na + nb; my /= na + nb;
    let xx = 0, xy = 0, yy = 0;
    for (const line of [a, b]) for (let i = 0; i < line.length; i += 3) {
        const dx = line[i] - mx, dy = line[i + 1] - my;
        xx += dx * dx; xy += dx * dy; yy += dy * dy;
    }
    const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
    const ux = Math.cos(angle), uy = Math.sin(angle);
    const along = (line: Float64Array) => {
        const out: [number, number][] = [];
        for (let i = 0; i < line.length; i += 3) out.push([(line[i] - mx) * ux + (line[i + 1] - my) * uy, line[i + 2]]);
        return out.sort((p, q) => p[0] - q[0]);
    };
    const sa = along(a), sb = along(b);
    // Each line as one height at each distance along: the places near a distance, taken together
    const from = Math.max(sa[0][0], sb[0][0]), to = Math.min(sa[na - 1][0], sb[nb - 1][0]);
    if (!(to > from)) return null;
    const steps = Math.max(LEAST_PLACES, Math.min(200, Math.floor(Math.min(na, nb) / 2)));
    const width = (to - from) / steps;
    const heights = (s: [number, number][]) => {
        const sum = new Float64Array(steps), count = new Float64Array(steps);
        for (const [d, z] of s) {
            if (d < from || d > to) continue;
            const k = Math.min(steps - 1, Math.floor((d - from) / width));
            sum[k] += z; count[k]++;
        }
        return { sum, count };
    };
    const ha = heights(sa), hb = heights(sb);
    const diffs: number[] = [];
    for (let k = 0; k < steps; k++) if (ha.count[k] > 0 && hb.count[k] > 0) diffs.push(ha.sum[k] / ha.count[k] - hb.sum[k] / hb.count[k]);
    if (diffs.length < LEAST_PLACES) return null;
    diffs.sort((p, q) => p - q);
    const at = (f: number) => diffs[Math.min(diffs.length - 1, Math.max(0, Math.round(f * (diffs.length - 1))))];
    return { throw: at(0.5), low: at(0.1), high: at(0.9), places: diffs.length, length: to - from };
}
