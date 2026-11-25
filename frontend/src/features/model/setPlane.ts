/**
 * The plane a set of thin sheets lies in, from how the unit carries from one
 * hole to the next (pure, unit-tested).
 *
 * The plane that the middles of a set's intercepts lie closest to is the lie
 * of the whole set. For one sheet that is the sheet. For a stack of sheets
 * side by side (dykes in a shear zone, veins en echelon) it is not: the
 * stack can lie at 35 degrees while every sheet in it dips at 60, and a fit
 * that joins intercepts along the stack joins each sheet to its neighbour
 * and not to itself.
 *
 * What the logging does say is which way the unit carries. From a piece of
 * hole logged as the unit, look at every piece of every OTHER hole within a
 * few hole spacings, and sort them by the direction they lie in. In some
 * directions the piece at the other end is the unit far more often than
 * anywhere: those are the directions the sheets run in. The plane that
 * holds most of them is the plane of a sheet.
 *
 * The count is a share (of the pieces that way, how many are the unit), so
 * that drilling denser one way than another does not pull the answer, and
 * the pieces of a hole are never paired with their own hole.
 *
 * And it is a share against what is usual AT THAT DISTANCE. Holes drilled
 * side by side are nearest each other square to themselves: the pairs that
 * way are the short ones, and the unit is at the other end of a short pair
 * more often than of a long one whatever its shape. Counted without that,
 * every body in parallel holes seems to lie square to the holes.
 */
import type { Vec3 } from './types';

/** The logging in short pieces: where each is (xyz triples), which hole it is of (a number a hole), and whether it is the unit (1) or other logged ground (0) */
export interface CarryPieces {
    positions: ArrayLike<number>;
    hole: ArrayLike<number>;
    unit: ArrayLike<number>;
}

export interface CarryPlane {
    /** The unit normal of the plane, upward */
    normal: Vec3;
    /** How many times likelier than at that distance in any direction the unit is, at the other end of a pair that lies in the plane */
    lift: number;
    /** That, over what the usual plane gives: how far the plane stands out from the rest */
    contrast: number;
    /** Pairs with the unit at both ends that the answer rests on */
    pairs: number;
    /** From a piece of the unit, how far the nearest other hole usually is, m */
    spacing: number;
}

/** At most this many pieces of the unit are looked out from (spread evenly through them) */
const MAX_FROM = 600;
/** Fewer pieces of the unit than this, in fewer holes than that, say nothing */
const MIN_UNIT = 30, MIN_HOLES = 6;
/** Pairs are looked at in three rings: this many spacings out, each twice the last */
const RINGS = 3;
/** What each ring counts for. The furthest counts half: several spacings out, the lie of the whole stack begins to show through that of a sheet */
const RING_WEIGHT = [1, 1, 0.5];
/** Directions are counted in cells this many degrees across */
const CELL = 6;
/** A pair lies in a plane when it is within this many degrees of it */
const WITHIN = 12;
/** A cell is trusted as it has pairs: with this many of the unit to be expected in it, half */
const PRIOR = 5;
/** Fewer pairs than this in a cell: the drilling does not see that way */
const SEEN = 20;
/** Distances are counted in steps of this share of the spacing */
const STEPS = 4;
/** The plane has to stand out from the usual one by this much, on this many pairs of the unit, to be an answer */
const MIN_CONTRAST = 1.2, MIN_PAIRS = 150;

const RAD = Math.PI / 180;

/** Cells of direction on the upper half of a sphere, all about the same size */
function directionCells() {
    const rings = Math.round(90 / CELL);
    const start: number[] = [], count: number[] = [], centres: number[] = [];
    for (let r = 0; r < rings; r++) {
        const t = (r + 0.5) * CELL * RAD;
        const k = Math.max(1, Math.round(360 * Math.sin(t) / CELL));
        start.push(centres.length / 3);
        count.push(k);
        for (let j = 0; j < k; j++) { const f = (j + 0.5) * 2 * Math.PI / k; centres.push(Math.sin(t) * Math.cos(f), Math.sin(t) * Math.sin(f), Math.cos(t)); }
    }
    const cellOf = (x: number, y: number, z: number): number => {
        if (z < 0) { x = -x; y = -y; z = -z; }
        const r = Math.min(rings - 1, Math.floor(Math.acos(Math.min(1, z)) / RAD / CELL));
        let f = Math.atan2(y, x);
        if (f < 0) f += 2 * Math.PI;
        return start[r] + Math.min(count[r] - 1, Math.floor(f / (2 * Math.PI) * count[r]));
    };
    return { centres: Float64Array.from(centres), cells: centres.length / 3, cellOf };
}

const median = (values: number[]): number => {
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted.length ? sorted[sorted.length >> 1] : NaN;
};

/**
 * The plane the unit carries in from hole to hole. Null when the logging
 * cannot say: too little of the unit, in too few holes, or no plane that
 * stands out from the rest (a thick body carries every way alike).
 */
export function carryPlane(pieces: CarryPieces): CarryPlane | null {
    const { positions: at, hole, unit } = pieces;
    const n = Math.min(hole.length, unit.length, Math.floor(at.length / 3));
    const units: number[] = [];
    const holesWith = new Set<number>();
    for (let i = 0; i < n; i++) if (unit[i] && Number.isFinite(at[i * 3]) && Number.isFinite(at[i * 3 + 1]) && Number.isFinite(at[i * 3 + 2])) { units.push(i); holesWith.add(hole[i]); }
    if (units.length < MIN_UNIT || holesWith.size < MIN_HOLES) return null;
    const from = units.length <= MAX_FROM ? units : Array.from({ length: MAX_FROM }, (_, k) => units[Math.floor(k * units.length / MAX_FROM)]);

    // The pieces in boxes, to find the ones near a place
    const boxes = (size: number) => {
        const map = new Map<string, number[]>();
        for (let i = 0; i < n; i++) {
            if (!Number.isFinite(at[i * 3])) continue;
            const key = `${Math.floor(at[i * 3] / size)},${Math.floor(at[i * 3 + 1] / size)},${Math.floor(at[i * 3 + 2] / size)}`;
            const list = map.get(key);
            if (list) list.push(i); else map.set(key, [i]);
        }
        return map;
    };
    const near = (map: Map<string, number[]>, size: number, i: number, reach: number, each: (j: number, d2: number, dx: number, dy: number, dz: number) => void) => {
        const x = at[i * 3], y = at[i * 3 + 1], z = at[i * 3 + 2];
        const span = Math.ceil(reach / size);
        const ci = Math.floor(x / size), cj = Math.floor(y / size), ck = Math.floor(z / size);
        for (let a = -span; a <= span; a++) for (let b = -span; b <= span; b++) for (let c = -span; c <= span; c++) {
            const list = map.get(`${ci + a},${cj + b},${ck + c}`);
            if (!list) continue;
            for (const j of list) {
                if (hole[j] === hole[i]) continue;
                const dx = at[j * 3] - x, dy = at[j * 3 + 1] - y, dz = at[j * 3 + 2] - z;
                const d2 = dx * dx + dy * dy + dz * dz;
                if (d2 <= reach * reach) each(j, d2, dx, dy, dz);
            }
        }
    };

    // How far the nearest other hole usually is from a piece of the unit
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const v = at[i * 3 + k]; if (Number.isFinite(v)) { lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v); } }
    const extent = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1);
    lo = hi = [];
    const coarse = Math.max(1, extent / 64);
    const first = boxes(coarse);
    const nearest: number[] = [];
    const sample = from.length <= 200 ? from : Array.from({ length: 200 }, (_, k) => from[Math.floor(k * from.length / 200)]);
    for (const i of sample) {
        let best = Infinity;
        for (let reach = coarse; reach <= 8 * coarse && best === Infinity; reach *= 2) near(first, coarse, i, reach, (_, d2) => { if (d2 < best) best = d2; });
        if (best < Infinity) nearest.push(Math.sqrt(best));
    }
    if (nearest.length < MIN_UNIT / 2) return null;
    const spacing = Math.max(2, median(nearest));
    const far = spacing * 2 ** RINGS;

    // Pairs, by the direction they lie in and how far apart they are: all of them, and those with the unit at both ends
    const dirs = directionCells();
    const steps = STEPS * (2 ** RINGS - 1);
    const all = new Float64Array(dirs.cells * steps), unitAt = new Float64Array(dirs.cells * steps);
    const size = Math.max(coarse, far / 2);
    const map = size === coarse ? first : boxes(size);
    let pairs = 0;
    for (const i of from) {
        near(map, size, i, far, (j, d2, dx, dy, dz) => {
            const d = Math.sqrt(d2);
            if (d < spacing) return;
            const k = dirs.cellOf(dx / d, dy / d, dz / d) * steps + Math.min(steps - 1, Math.floor((d / spacing - 1) * STEPS));
            all[k]++;
            if (unit[j]) { unitAt[k]++; pairs++; }
        });
    }
    if (pairs < MIN_PAIRS) return null;

    // What is usual at each distance, whatever the direction
    const usualAt = new Float64Array(steps);
    for (let s = 0; s < steps; s++) {
        let a = 0, u = 0;
        for (let c = 0; c < dirs.cells; c++) { a += all[c * steps + s]; u += unitAt[c * steps + s]; }
        usualAt[s] = a > 0 ? u / a : 0;
    }
    // By ring and cell: the pairs, those of the unit, and how many of the unit were to be expected at those distances
    const ringOf = (s: number) => Math.min(RINGS - 1, Math.floor(Math.log2(1 + s / STEPS)));
    const any = Array.from({ length: RINGS }, () => new Float64Array(dirs.cells)), both = Array.from({ length: RINGS }, () => new Float64Array(dirs.cells)), expected = Array.from({ length: RINGS }, () => new Float64Array(dirs.cells));
    for (let c = 0; c < dirs.cells; c++) for (let s = 0; s < steps; s++) {
        const r = ringOf(s), k = c * steps + s;
        any[r][c] += all[k];
        both[r][c] += unitAt[k];
        expected[r][c] += all[k] * usualAt[s];
    }

    // Each cell: how many times the expected it has (drawn towards once where little is expected), and how much it is to be trusted
    const share = expected.map((e, r) => Float64Array.from(e, (v, k) => (both[r][k] + PRIOR) / (v + PRIOR)));
    const trust = expected.map(e => Float64Array.from(e, v => v / (v + PRIOR)));

    // Every plane, a few degrees apart: what the cells that lie in it say
    const sin = Math.sin(WITHIN * RAD);
    const STEP = 4;
    const normals: Vec3[] = [], lifts: number[] = [];
    for (let t = 0; t <= 90; t += STEP) {
        const k = t === 0 ? 1 : Math.max(1, Math.round(360 * Math.sin(t * RAD) / STEP));
        for (let j = 0; j < k; j++) {
            const f = (j + 0.5) * 2 * Math.PI / k;
            const nrm: Vec3 = [Math.sin(t * RAD) * Math.cos(f), Math.sin(t * RAD) * Math.sin(f), Math.cos(t * RAD)];
            let total = 0, rings = 0;
            for (let r = 0; r < RINGS; r++) {
                let w = 0, s = 0, inPlane = 0, seen = 0;
                for (let c = 0; c < dirs.cells; c++) {
                    if (Math.abs(dirs.centres[c * 3] * nrm[0] + dirs.centres[c * 3 + 1] * nrm[1] + dirs.centres[c * 3 + 2] * nrm[2]) > sin) continue;
                    inPlane++;
                    if (any[r][c] >= SEEN) seen++;
                    w += trust[r][c];
                    s += trust[r][c] * share[r][c];
                }
                // (A plane the drilling sees little of says nothing in this ring)
                if (w <= 0 || seen < 0.4 * inPlane) continue;
                total += RING_WEIGHT[r] * s / w;
                rings += RING_WEIGHT[r];
            }
            if (rings === 0) continue;
            normals.push(nrm);
            lifts.push(total / rings);
        }
    }
    if (lifts.length < 20) return null;
    let top = 0;
    for (let k = 1; k < lifts.length; k++) if (lifts[k] > lifts[top]) top = k;
    const usual = median(lifts);
    const contrast = usual > 0 ? lifts[top] / usual : 0;
    if (!(contrast >= MIN_CONTRAST)) return null;

    // The planes about as good as the best one, together: steadier than any one of them
    const floor = lifts[top] - 0.2 * (lifts[top] - usual);
    const sum = [0, 0, 0];
    const best = normals[top];
    for (let k = 0; k < lifts.length; k++) {
        const v = normals[k];
        const d = v[0] * best[0] + v[1] * best[1] + v[2] * best[2];
        if (lifts[k] < floor || Math.abs(d) < Math.cos(20 * RAD)) continue;
        const sign = d < 0 ? -1 : 1, w = lifts[k] - floor + 1e-9;
        for (let c = 0; c < 3; c++) sum[c] += sign * w * v[c];
    }
    const len = Math.hypot(sum[0], sum[1], sum[2]);
    let normal: Vec3 = len > 0 ? [sum[0] / len, sum[1] / len, sum[2] / len] : best;
    if (normal[2] < 0) normal = [-normal[0], -normal[1], -normal[2]];
    return { normal, lift: lifts[top], contrast, pairs, spacing };
}
