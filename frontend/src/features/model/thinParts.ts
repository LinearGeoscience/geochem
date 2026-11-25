/**
 * Measuring a thin closed mesh (a vein in a geological model) part by part
 * (pure, unit-tested).
 *
 * A vein thinner than the model's cells is not cut into them: it is its own
 * mesh. What of it the model keeps (the rest is beyond a fault, above the
 * top, or in a younger unit), and whose ground that takes, is measured here
 * along parallel lines through the mesh: each line enters and leaves it, and
 * the stretch between is the vein's thickness there. A stretch is kept by a
 * value at each of its ends (`g`, one a corner of the mesh, above nothing:
 * kept), in proportion where the two ends differ; and what is kept is put
 * down to the label at the kept end (the ground the vein is in there).
 */
import type { TriMesh } from './types';

export interface ThinCount {
    /** What the whole mesh holds, measured the same way, m3 */
    whole: number;
    /** What is kept of it, by label, m3 */
    kept: Map<number, number>;
}

/** At most this many lines through a mesh, and at least this many where the spacing asked for would give fewer */
const MAX_LINES = 60_000, MIN_LINES = 2_000;

/** One crossing of a line with the mesh: which line, where along it, the value and the label there, and which way the face looks */
interface Hits { line: number[]; at: number[]; g: number[]; label: number[]; facing: number[] }

/**
 * `g`, `label`: one a corner of the mesh (a label below nought: none).
 * `spacing`: how far apart the lines are, m (made wider for a very large
 * mesh, and closer for a small one).
 */
export function countThin(mesh: TriMesh, g: ArrayLike<number>, label: ArrayLike<number>, spacing: number): ThinCount {
    const { vertices: v, triangles: t } = mesh;
    const none: ThinCount = { whole: 0, kept: new Map() };
    if (t.length === 0 || !(spacing > 0)) return none;
    // The lines run along the axis the mesh faces most (across a sheet, not along it)
    const faced = [0, 0, 0];
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let q = 0; q < t.length; q += 3) {
        const a = t[q] * 3, b = t[q + 1] * 3, c = t[q + 2] * 3;
        for (let k = 0; k < 3; k++) {
            const k1 = (k + 1) % 3, k2 = (k + 2) % 3;
            faced[k] += Math.abs((v[b + k1] - v[a + k1]) * (v[c + k2] - v[a + k2]) - (v[b + k2] - v[a + k2]) * (v[c + k1] - v[a + k1]));
            for (const p of [a, b, c]) { if (v[p + k] < min[k]) min[k] = v[p + k]; if (v[p + k] > max[k]) max[k] = v[p + k]; }
        }
    }
    const axis = faced[0] >= faced[1] && faced[0] >= faced[2] ? 0 : faced[1] >= faced[2] ? 1 : 2;
    const a1 = (axis + 1) % 3, a2 = (axis + 2) % 3;
    const area = (max[a1] - min[a1]) * (max[a2] - min[a2]);
    if (!(area > 0)) return none;
    const h = Math.max(Math.sqrt(area / MAX_LINES), Math.min(spacing, Math.sqrt(area / MIN_LINES)));
    // (Set off from the mesh's own corners, so that a line does not run along an edge of it)
    const o1 = min[a1] + 0.4871 * h, o2 = min[a2] + 0.5129 * h;
    const n1 = Math.floor((max[a1] - o1) / h) + 1;
    const hits: Hits = { line: [], at: [], g: [], label: [], facing: [] };
    for (let q = 0; q < t.length; q += 3) {
        const ia = t[q], ib = t[q + 1], ic = t[q + 2];
        const ax = v[ia * 3 + a1], ay = v[ia * 3 + a2], bx = v[ib * 3 + a1], by = v[ib * 3 + a2], cx = v[ic * 3 + a1], cy = v[ic * 3 + a2];
        const twice = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        if (!(Math.abs(twice) > 1e-12)) continue;
        const i0 = Math.ceil((Math.min(ax, bx, cx) - o1) / h), i1 = Math.floor((Math.max(ax, bx, cx) - o1) / h);
        const j0 = Math.ceil((Math.min(ay, by, cy) - o2) / h), j1 = Math.floor((Math.max(ay, by, cy) - o2) / h);
        for (let j = j0; j <= j1; j++) {
            const py = o2 + j * h;
            for (let i = i0; i <= i1; i++) {
                const px = o1 + i * h;
                const wa = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / twice;
                const wb = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / twice;
                const wc = 1 - wa - wb;
                if (wa < 0 || wb < 0 || wc < 0) continue;
                hits.line.push(i + n1 * j);
                hits.at.push(wa * v[ia * 3 + axis] + wb * v[ib * 3 + axis] + wc * v[ic * 3 + axis]);
                hits.g.push(wa * g[ia] + wb * g[ib] + wc * g[ic]);
                hits.label.push(label[wa >= wb && wa >= wc ? ia : wb >= wc ? ib : ic]);
                hits.facing.push(twice > 0 ? 1 : -1);
            }
        }
    }
    const order = Uint32Array.from(hits.line, (_, i) => i).sort((p, q) => hits.line[p] - hits.line[q] || hits.at[p] - hits.at[q]);
    const same = 1e-9 * Math.max(1, max[axis] - min[axis]);
    const kept = new Map<number, number>();
    let whole = 0;
    for (let from = 0; from < order.length;) {
        let to = from;
        while (to < order.length && hits.line[order[to]] === hits.line[order[from]]) to++;
        // The crossings of one line, in order along it (two faces met at their shared edge are one crossing)
        const own: number[] = [];
        for (let k = from; k < to; k++) {
            const p = order[k], last = own[own.length - 1];
            if (last !== undefined && hits.facing[last] === hits.facing[p] && hits.at[p] - hits.at[last] < same) continue;
            own.push(p);
        }
        // In at one, out at the next: a pair that both face the same way is no stretch (the first of them is passed over)
        for (let k = 0; k + 1 < own.length;) {
            const a = own[k], b = own[k + 1];
            if (hits.facing[a] === hits.facing[b]) { k++; continue; }
            k += 2;
            const length = hits.at[b] - hits.at[a];
            whole += length;
            const ga = hits.g[a], gb = hits.g[b];
            if (!(ga > 0) && !(gb > 0)) continue;
            const share = ga > 0 && gb > 0 ? 1 : ga > 0 ? ga / (ga - gb) : gb / (gb - ga);
            let l = ga > 0 ? hits.label[a] : hits.label[b];
            if (l < 0) l = ga > 0 ? hits.label[b] : hits.label[a];
            if (l < 0) continue;
            kept.set(l, (kept.get(l) ?? 0) + length * share);
        }
        from = to;
    }
    const each = h * h;
    for (const [l, sum] of kept) kept.set(l, sum * each);
    return { whole: whole * each, kept };
}
