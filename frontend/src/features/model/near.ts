/**
 * "How far is the nearest of these points?" for a great many questions
 * (pure, unit-tested). The points are sorted into the boxes of a grid once;
 * each question then looks only in the boxes within its own search distance.
 */

/** No more boxes than this: the grid is made coarser instead */
const MAX_BOXES = 2_000_000;

export class NearGrid {
    private readonly min: [number, number, number] = [0, 0, 0];
    private readonly size: [number, number, number] = [1, 1, 1];
    private readonly cell: number;
    /** The points of box b are `order[start[b]]` to `order[start[b + 1] - 1]`, each the index of a point's x */
    private readonly start: Int32Array;
    private readonly order: Int32Array;

    /** `cell`: about the distance most questions will search (any distance may be asked) */
    constructor(private readonly points: ArrayLike<number>, cell: number) {
        const n = Math.floor(points.length / 3);
        const max = [-Infinity, -Infinity, -Infinity];
        const min = [Infinity, Infinity, Infinity];
        for (let i = 0; i < n * 3; i += 3) {
            for (let k = 0; k < 3; k++) {
                if (points[i + k] < min[k]) min[k] = points[i + k];
                if (points[i + k] > max[k]) max[k] = points[i + k];
            }
        }
        let side = cell > 0 ? cell : 1;
        if (max[0] >= min[0]) {
            this.min = [min[0], min[1], min[2]];
            for (; ; side *= 2) {
                for (let k = 0; k < 3; k++) this.size[k] = Math.floor((max[k] - min[k]) / side) + 1;
                if (this.size[0] * this.size[1] * this.size[2] <= MAX_BOXES) break;
            }
        }
        this.cell = side;
        const boxes = this.size[0] * this.size[1] * this.size[2];
        this.start = new Int32Array(boxes + 1);
        this.order = new Int32Array(n);
        if (!(max[0] >= min[0])) return;
        const box = new Int32Array(n);
        for (let q = 0, i = 0; q < n; q++, i += 3) {
            const x = points[i], y = points[i + 1], z = points[i + 2];
            // A point without a place is in no box
            box[q] = Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
                ? this.at(x, 0) + this.size[0] * (this.at(y, 1) + this.size[1] * this.at(z, 2)) : -1;
            if (box[q] >= 0) this.start[box[q] + 1]++;
        }
        for (let b = 0; b < boxes; b++) this.start[b + 1] += this.start[b];
        const next = this.start.slice(0, boxes);
        for (let q = 0; q < n; q++) if (box[q] >= 0) this.order[next[box[q]]++] = q * 3;
    }

    private at(v: number, axis: number) {
        return Math.floor((v - this.min[axis]) / this.cell);
    }

    /**
     * Distance to the nearest point, or `limit` when none is that close.
     * `enough`: stop looking as soon as a point this close is found (the
     * distance returned is then to that point, not always the nearest).
     */
    nearest(x: number, y: number, z: number, limit: number, enough = 0): number {
        const p = this.points, [sx, sy, sz] = this.size;
        const i0 = Math.max(0, this.at(x - limit, 0)), i1 = Math.min(sx - 1, this.at(x + limit, 0));
        const j0 = Math.max(0, this.at(y - limit, 1)), j1 = Math.min(sy - 1, this.at(y + limit, 1));
        const k0 = Math.max(0, this.at(z - limit, 2)), k1 = Math.min(sz - 1, this.at(z + limit, 2));
        let best = limit * limit;
        const stop = enough * enough;
        for (let k = k0; k <= k1; k++) {
            for (let j = j0; j <= j1; j++) {
                const row = sx * (j + sy * k);
                for (let q = this.start[row + i0], end = this.start[row + i1 + 1]; q < end; q++) {
                    const at = this.order[q];
                    const dx = p[at] - x, dy = p[at + 1] - y, dz = p[at + 2] - z;
                    const d = dx * dx + dy * dy + dz * dz;
                    if (d < best) {
                        best = d;
                        if (d <= stop) return Math.sqrt(d);
                    }
                }
            }
        }
        return Math.sqrt(best);
    }

    /**
     * Each point counting out to its own reach (`reach`: one per point, none
     * more than `limit`): the largest of (reach - distance) / (reach / 2) over
     * the points, at most 1 (it stops at the first that gives 1), at least 0.
     * With `extra` (one more coordinate for each point) the distance is the
     * one with the difference from `e` in that coordinate counted as well;
     * and with `extra2`, the difference from `f` in a second.
     */
    mostWithin(x: number, y: number, z: number, limit: number, reach: ArrayLike<number>, e = 0, extra: ArrayLike<number> | null = null, f = 0, extra2: ArrayLike<number> | null = null): number {
        const p = this.points, [sx, sy, sz] = this.size;
        const i0 = Math.max(0, this.at(x - limit, 0)), i1 = Math.min(sx - 1, this.at(x + limit, 0));
        const j0 = Math.max(0, this.at(y - limit, 1)), j1 = Math.min(sy - 1, this.at(y + limit, 1));
        const k0 = Math.max(0, this.at(z - limit, 2)), k1 = Math.min(sz - 1, this.at(z + limit, 2));
        let best = 0;
        for (let k = k0; k <= k1; k++) {
            for (let j = j0; j <= j1; j++) {
                const row = sx * (j + sy * k);
                for (let q = this.start[row + i0], end = this.start[row + i1 + 1]; q < end; q++) {
                    const at = this.order[q];
                    const r = reach[at / 3];
                    const dx = p[at] - x, dy = p[at + 1] - y, dz = p[at + 2] - z;
                    let d2 = dx * dx + dy * dy + dz * dz;
                    if (extra) d2 += (extra[at / 3] - e) * (extra[at / 3] - e);
                    if (extra2) d2 += (extra2[at / 3] - f) * (extra2[at / 3] - f);
                    if (d2 >= r * r) continue;
                    const t = 2 * (r - Math.sqrt(d2)) / r;
                    if (t >= 1) return 1;
                    if (t > best) best = t;
                }
            }
        }
        return best;
    }

    /** The group of the point `nearestOther` last found (-1: none) */
    found = -1;

    /**
     * Distance to the nearest point that is not of group `a` or `b` (`group`:
     * one per point), or `limit` when none is that close. `found` is then its
     * group. With `extra` (one more coordinate for each point) the distance
     * is the one with the difference from `e` in that coordinate counted as well.
     */
    nearestOther(x: number, y: number, z: number, limit: number, group: ArrayLike<number>, a: number, b = a, e = 0, extra: ArrayLike<number> | null = null): number {
        const p = this.points, [sx, sy, sz] = this.size;
        const i0 = Math.max(0, this.at(x - limit, 0)), i1 = Math.min(sx - 1, this.at(x + limit, 0));
        const j0 = Math.max(0, this.at(y - limit, 1)), j1 = Math.min(sy - 1, this.at(y + limit, 1));
        const k0 = Math.max(0, this.at(z - limit, 2)), k1 = Math.min(sz - 1, this.at(z + limit, 2));
        let best = limit * limit;
        this.found = -1;
        for (let k = k0; k <= k1; k++) {
            for (let j = j0; j <= j1; j++) {
                const row = sx * (j + sy * k);
                for (let q = this.start[row + i0], end = this.start[row + i1 + 1]; q < end; q++) {
                    const at = this.order[q];
                    const g = group[at / 3];
                    if (g === a || g === b) continue;
                    const dx = p[at] - x, dy = p[at + 1] - y, dz = p[at + 2] - z;
                    let d = dx * dx + dy * dy + dz * dz;
                    if (extra) d += (extra[at / 3] - e) * (extra[at / 3] - e);
                    if (d < best) {
                        best = d;
                        this.found = g;
                    }
                }
            }
        }
        return Math.sqrt(best);
    }
}

/**
 * Points that each count out to their own reach: 1 within half of it, 0 at
 * it and beyond, falling smoothly in between. `weight` is the most any point
 * counts at a place.
 *
 * Reaches that differ many times over (close-spaced holes beside wide-spaced
 * ones) would make one grid either crowded or huge, so the points are sorted
 * by reach into classes a factor of two apart, each with a grid of its own.
 *
 * `extra`: one more coordinate for each point. A place is then asked about
 * with its own (`weight`'s `e`), and the distances are the ones with the
 * difference in it counted as well. Twice as many numbers as points: two
 * coordinates for each, one after the other (`weight`'s `e` and `f`).
 */
export class ReachGrid {
    private readonly classes: { grid: NearGrid; reach: Float64Array; most: number; extra: Float64Array | null; extra2: Float64Array | null }[] = [];

    constructor(points: ArrayLike<number>, reach: ArrayLike<number>, extra: ArrayLike<number> | null = null) {
        const byClass = new Map<number, number[]>();
        const n = Math.min(Math.floor(points.length / 3), reach.length);
        const wide = extra && n > 0 && extra.length >= n * 2 ? 2 : 1;
        for (let i = 0; i < n; i++) {
            if (!(reach[i] > 0)) continue;
            const c = Math.ceil(Math.log2(reach[i]));
            const own = byClass.get(c);
            if (own) own.push(i);
            else byClass.set(c, [i]);
        }
        // The longest reaches first: fewest points, most ground
        for (const c of [...byClass.keys()].sort((p, q) => q - p)) {
            const rows = byClass.get(c)!;
            const pts = new Float64Array(rows.length * 3), r = new Float64Array(rows.length);
            const more = extra ? new Float64Array(rows.length) : null, second = extra && wide === 2 ? new Float64Array(rows.length) : null;
            let most = 0;
            rows.forEach((i, k) => {
                pts[k * 3] = points[i * 3];
                pts[k * 3 + 1] = points[i * 3 + 1];
                pts[k * 3 + 2] = points[i * 3 + 2];
                r[k] = reach[i];
                if (more) more[k] = extra![i * wide];
                if (second) second[k] = extra![i * 2 + 1];
                if (reach[i] > most) most = reach[i];
            });
            this.classes.push({ grid: new NearGrid(pts, most), reach: r, most, extra: more, extra2: second });
        }
    }

    weight(x: number, y: number, z: number, e = 0, f = 0): number {
        let best = 0;
        for (const c of this.classes) {
            const t = c.grid.mostWithin(x, y, z, c.most, c.reach, e, c.extra, f, c.extra2);
            if (t > best) {
                best = t;
                if (best >= 1) return 1;
            }
        }
        return best * best * (3 - 2 * best);
    }
}
