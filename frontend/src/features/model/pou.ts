/**
 * Fitting a field to a great many valued points (pure, unit-tested).
 *
 * One fit through every point at once costs the cube of their number: fine
 * to about a thousand, hopeless at twenty thousand. So space is cut into
 * blocks of about `block` points, each block is fitted on its own together
 * with a margin of its neighbours' points, and the blocks' fields are
 * blended across the margins (a "partition of unity"). Near a point the
 * answer comes almost wholly from the block the point is in, so the blend
 * honours the values as the single fit would; the cost grows only with the
 * number of points.
 *
 * The blocks are fixed to the ground: cubes a power of two in size, at whole
 * multiples of their size from the origin of the coordinates, cut in half
 * (and in half again) only while they hold more than `block` points. So when
 * one point moves, the only blocks that can be cut or joined are those it
 * left and those it went to, and the only blocks fitted again are those
 * whose margin held it before or holds it now. Given a `BlockCache`, every
 * other block's fit is taken from the last time, and the field away from the
 * change is the same to the last digit: each place is read from the same
 * blocks, added in the same order.
 */
import { extraWidth, fitField, readField, type FieldPart, type FitResult, type FittedField } from './rbf';
import type { Box3, Plane, Vec3 } from './types';

/**
 * The blocks of one field as last fitted, to be used again: kept by the
 * caller from one fit of a surface to the next. Only what the last fit used
 * is kept.
 */
export interface BlockCache {
    fits: Map<string, { field: FittedField; smoothed: boolean }>;
    /**
     * Set while the blocks are fitted elsewhere (other workers): a fit that
     * wants at least `least` blocks it does not have, and has not asked for
     * before (`asked`), fits none of them and throws BlocksWanted. While it is
     * set, nothing is let go from the cache; `used` gathers the keys of the
     * blocks every fit used, so that the rest can be let go after.
     */
    wanted?: { least: number; asked: Set<string>; used: Set<string> } | null;
}

/** A block to fit, as fitBlended would fit it: to be fitted in another worker, and put in the cache under its key */
export interface BlockTask {
    key: string;
    points: number[];
    values: number[];
    extra: number[] | null;
    smoothing: number;
    drift: 'tilted' | 'level' | Plane;
    /** Each point's own looseness, on top of `smoothing` (absent or null: none) */
    loose?: number[] | null;
    /** Rows that are slopes (rbf.ts, `FitOptions.slopes`): each point's direction, xyz triples; with `extra`, how fast that changes along each; and the rounding of the kernel, m */
    slopes?: number[] | null;
    slopeExtra?: number[] | null;
    round?: number;
}

/** What a block's fit came to (null: it could not be fitted; the fit that wanted it finds that out for itself) */
export type BlockAnswer = { key: string; field: FittedField; smoothed: boolean } | null;

/** Thrown by fitBlended, with BlockCache.wanted set, for blocks it does not have */
export class BlocksWanted extends Error {
    constructor(readonly tasks: BlockTask[]) {
        super(`${tasks.length} blocks are wanted`);
    }
}

/** Fit one block, as fitBlended does: the same in any worker, to the last digit */
export function fitBlockTask(task: BlockTask): BlockAnswer {
    const fit = fitOne(task.points, task.values, task.smoothing, task.drift, task.extra, task.loose ?? null, rowsOf(task));
    return fit.ok ? { key: task.key, field: fit.field, smoothed: fit.stats.smoothed } : null;
}

export const blockCache = (): BlockCache => ({ fits: new Map() });

export interface BlendOptions {
    /** 0 = pass exactly through the values; larger = looser */
    smoothing?: number;
    /** For each point, looseness on top of `smoothing` (same units; null: none) */
    loose?: ArrayLike<number> | null;
    /** The field is wanted everywhere in this box (it holds the points) */
    cover: Box3;
    /** Up to this many points are fitted in one go (default 1200) */
    dense?: number;
    /** Points to a block (default 150; with slopes among the rows, up to twice as many rows) */
    block?: number;
    /**
     * What the field does away from its points. 'tilted' (default): each
     * block carries on with the tilt of its own values. 'level': it settles
     * to a constant, which is what values with no trend to them want (a
     * tilted block runs off without limit where it has no points). A plane:
     * the field is the distance from that plane and what is left over, the
     * leftover fitted block by block (a sheet's overall plane).
     */
    drift?: 'tilted' | 'level' | Plane;
    /** One more coordinate for each point, in the points' own units (rbf.ts, `Layering`). The blocks are still cut by where the points are in the ground */
    extra?: ArrayLike<number> | null;
    /**
     * Rows that are slopes (rbf.ts, `FitOptions.slopes`): a direction for
     * each point, with `extra` how fast that changes along each, and the
     * rounding of the kernel, m. Rows are what a block holds and what the
     * limits count: a dip is three of them at one place.
     */
    slopes?: ArrayLike<number> | null;
    slopeExtra?: ArrayLike<number> | null;
    round?: number;
    /** The blocks fitted last time: those whose points are the same are not fitted again. Updated to this fit's blocks */
    reuse?: BlockCache | null;
}

/** Each block also takes its neighbours' points for this share of its size on every side */
const MARGIN = 0.25;
/** The margins a block may have, as shares of its size: narrower where its neighbours are crowded, wider where it has too few points near it */
const MARGINS = [1 / 32, 1 / 16, 1 / 8, MARGIN, 1 / 2, 1, 2];
/**
 * A block is fitted to at most this many times its own points. A big block
 * of scattered points beside a dense cluster would otherwise take thousands
 * of the cluster's points in its margin: its margin is narrowed instead.
 */
const CROWD = 5;
/** A block with fewer points than this share of a block's worth in its margin takes a wider margin (up to the widest of MARGINS) */
const SPARSE = 0.2;
/**
 * Past each of its faces a block reaches on to the nearest points beyond it
 * (or its margin, if that is further), when they are within this many times
 * its longest side. Holes, or section lines, are often further apart than a
 * block is wide: without it a place between two holes may be in no block
 * that has both, and is guessed at from one side only.
 */
const REACH = 2;
/** ... and this share of its size past them */
const PAST = 1 / 16;
/** How much a box with no points of its own counts, against one with points */
const EMPTY = 1e-6;
/** No drift: a block with too few points for a tilted one settles to a constant */
const LEVEL = { normal: [0, 0, 0] as Vec3, point: [0, 0, 0] as Vec3 };
/** A plane's point is rounded to whole multiples of this, m (see `fitBlended`) */
const PLANE_GRID = 1024;
/** Cubes are not cut smaller than this share of the top ones (points all at one place could otherwise be cut for ever) */
const SMALLEST = 2 ** -20;

/** With slopes among its rows a block holds up to this many times the rows it otherwise would */
const SLOPE_ROWS = 2;

/** Half the longest side of the box round these points (the unit `fitField` scales by; 1 for a single place) */
function scaleOf(points: ArrayLike<number>, rows?: readonly number[]): number {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const n = rows ? rows.length : Math.floor(points.length / 3);
    for (let k = 0; k < n; k++) {
        const i = rows ? rows[k] : k;
        for (let a = 0; a < 3; a++) {
            const v = points[i * 3 + a];
            if (v < min[a]) min[a] = v;
            if (v > max[a]) max[a] = v;
        }
    }
    const extent = n > 0 ? Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) : 0;
    return extent > 0 ? extent / 2 : 1;
}

/** Rows that are slopes, and the rounding of the kernel: what a fit is given of them (nothing, when there are none) */
interface RowOptions { slopes?: ArrayLike<number> | null; slopeExtra?: ArrayLike<number> | null; round?: number }
const rowsOf = (from: RowOptions): RowOptions => ({
    ...(from.slopes ? { slopes: from.slopes } : {}), ...(from.slopeExtra ? { slopeExtra: from.slopeExtra } : {}), ...(from.round !== undefined && from.round > 0 ? { round: from.round } : {}),
});

function fitOne(
    points: ArrayLike<number>, values: ArrayLike<number>, smoothing: number, drift: BlendOptions['drift'], extra: ArrayLike<number> | null = null, loose: ArrayLike<number> | null = null,
    rows: RowOptions = {},
): FitResult {
    if (drift && typeof drift === 'object') return fitField(points, values, { drift, smoothing, extra, loose, ...rows });
    const tilted: FitResult = drift === 'level' ? { ok: false, reason: 'too-few' } : fitField(points, values, { drift: 'linear', smoothing, extra, loose, ...rows });
    return tilted.ok ? tilted : fitField(points, values, { drift: LEVEL, smoothing, extra, loose, ...rows });
}

/**
 * The rows of the `count` points nearest a place (ties by row, so the same
 * points always give the same answer), in the order of their rows.
 */
function nearest(points: ArrayLike<number>, rows: readonly number[], at: Vec3, count: number): number[] {
    const d = rows.map(i => {
        const dx = points[i * 3] - at[0], dy = points[i * 3 + 1] - at[1], dz = points[i * 3 + 2] - at[2];
        return { i, d: dx * dx + dy * dy + dz * dz };
    });
    d.sort((a, b) => a.d - b.d || a.i - b.i);
    return d.slice(0, count).map(x => x.i).sort((a, b) => a - b);
}

/** A leaf of the tree of blocks: a box, and its place in the tree */
interface Leaf {
    /** Its place in the tree, the same in every fit while the box is a leaf */
    key: string;
    min: Vec3;
    size: Vec3;
    /** How many of the points are in it */
    count: number;
    /** How far they spread along each direction (0 without points) */
    spread: Vec3;
}

/**
 * The leaves of the tree of blocks over `cover`. The top boxes are cubes of
 * a power-of-two size at whole multiples of their size; a box holding more
 * than `perBlock` of the points is cut in half, across the direction its
 * points spread furthest (x before y before z where they spread as far). So
 * the boxes are halves of halves, fixed to the ground: a point that moves
 * changes only the boxes it was in and is now in, and a box is cut another
 * way only when the spread of its points along two directions changes order.
 * Only boxes that reach into `cover` are kept, empty ones too. Sorted by key,
 * so that the blocks are always added up in the same order.
 *
 * (Across the spread of the points, not the box's longest side: drillholes
 * are sampled every metre down and tens of metres apart, so their blocks come
 * out as flat slabs through several holes, not short lengths of one hole, and
 * a layer is fitted from hole to hole within one block.)
 */
function blockLeaves(points: ArrayLike<number>, rows: readonly number[], cover: Box3, perBlock: number): { leaves: Leaf[]; top: number } {
    const longest = Math.max(cover.max[0] - cover.min[0], cover.max[1] - cover.min[1], cover.max[2] - cover.min[2]);
    // The top cubes: the smallest power of two at least half the cover's longest side (so at most three of them a side)
    const top = 2 ** Math.ceil(Math.log2(longest > 0 ? longest / 2 : 1));
    const leaves: Leaf[] = [];
    const inCover = (min: Vec3, size: Vec3) => [0, 1, 2].every(a => min[a] < cover.max[a] && min[a] + size[a] > cover.min[a]);
    const cut = (min: Vec3, size: Vec3, inside: number[], key: string) => {
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (const i of inside) for (let k = 0; k < 3; k++) {
            const v = points[i * 3 + k];
            if (v < lo[k]) lo[k] = v;
            if (v > hi[k]) hi[k] = v;
        }
        const spread = [0, 1, 2].map(k => hi[k] - lo[k]);
        const a = spread[0] >= spread[1] && spread[0] >= spread[2] ? 0 : spread[1] >= spread[2] ? 1 : 2;
        // (All at one place: cannot be cut)
        if (inside.length <= perBlock || !(spread[a] > 0) || size[a] <= top * SMALLEST) {
            leaves.push({ key, min, size, count: inside.length, spread: inside.length > 0 ? spread as Vec3 : [0, 0, 0] });
            return;
        }
        const half: Vec3 = [size[0], size[1], size[2]];
        half[a] /= 2;
        const mid = min[a] + half[a];
        const low: number[] = [], high: number[] = [];
        for (const i of inside) (points[i * 3 + a] >= mid ? high : low).push(i);
        const upper: Vec3 = [min[0], min[1], min[2]];
        upper[a] = mid;
        if (low.length > 0 || inCover(min, half)) cut(min, half, low, `${key}0`);
        if (high.length > 0 || inCover(upper, half)) cut(upper, half, high, `${key}1`);
    };
    const first = [0, 1, 2].map(a => Math.floor(cover.min[a] / top)), last = [0, 1, 2].map(a => Math.floor(cover.max[a] / top));
    const tops = new Map<string, { min: Vec3; rows: number[] }>();
    for (let i = first[0]; i <= last[0]; i++) for (let j = first[1]; j <= last[1]; j++) for (let k = first[2]; k <= last[2]; k++) {
        tops.set(`${i},${j},${k}`, { min: [i * top, j * top, k * top], rows: [] });
    }
    for (const i of rows) {
        const cell = `${Math.floor(points[i * 3] / top)},${Math.floor(points[i * 3 + 1] / top)},${Math.floor(points[i * 3 + 2] / top)}`;
        let t = tops.get(cell);
        if (!t) {
            // (A point outside the cover: its cube is made too)
            const [a, b, c] = cell.split(',').map(Number);
            t = { min: [a * top, b * top, c * top], rows: [] };
            tops.set(cell, t);
        }
        t.rows.push(i);
    }
    for (const [cell, t] of tops) cut(t.min, [top, top, top], t.rows, `${top}:${cell}/`);
    return { leaves: leaves.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)), top };
}

/** Two 32-bit FNV-1a hashes of numbers' bytes, as one string: what a block was fitted to, in short */
function hashNumbers(numbers: ArrayLike<number>): string {
    const bytes = new Uint8Array(Float64Array.from(numbers).buffer);
    let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
    for (let i = 0; i < bytes.length; i++) {
        a = Math.imul(a ^ bytes[i], 0x01000193);
        b = Math.imul(b ^ bytes[i], 0x5bd1e995) ^ (b >>> 15);
    }
    return `${(a >>> 0).toString(36)}.${(b >>> 0).toString(36)}`;
}

/** Fit a field to values at points (xyz triples, world), block by block when there are many. */
export function fitBlended(points: ArrayLike<number>, values: ArrayLike<number>, options: BlendOptions): FitResult {
    const n = Math.min(Math.floor(points.length / 3), values.length);
    const smoothing = Math.max(0, options.smoothing ?? 0);
    const drift = options.drift ?? 'tilted';
    const given = typeof drift === 'object' ? drift : null;
    const extra = options.extra ?? null;
    // (Two numbers a point: a second extra coordinate, rbf.ts `Layering.second`)
    const wide = extraWidth(extra, n);
    // (Nothing loose is the same as no looseness given: the blocks keep the keys they had)
    let looser: ArrayLike<number> | null = null;
    if (options.loose) for (let i = 0; i < n && !looser; i++) if (options.loose[i] > 0) looser = options.loose;
    // (No slope among the rows is the same as no slopes given, and likewise the rounding: the blocks keep the keys they had)
    let slopes: ArrayLike<number> | null = null;
    if (options.slopes) for (let i = 0; i < n * 3 && !slopes; i++) if (options.slopes[i] !== 0) slopes = options.slopes;
    const slopeExtra = slopes && extra ? options.slopeExtra ?? null : null;
    const round = options.round !== undefined && options.round > 0 ? options.round : 0;
    const sloped = (i: number) => slopes !== null && (slopes[i * 3] !== 0 || slopes[i * 3 + 1] !== 0 || slopes[i * 3 + 2] !== 0);
    if (n <= (options.dense ?? 1200)) {
        if (options.reuse) options.reuse.fits = new Map();
        return fitOne(points, values, smoothing, drift, extra, looser, rowsOf({ slopes, slopeExtra, round }));
    }
    // A plane's point is often the middle of the points, and shifts a little whenever one of them moves. The blocks are
    // fitted about the same plane through a point fixed to the ground instead (each block's constant takes up the
    // difference), so that the blocks a move does not reach are fitted to the same values as before and are kept
    const plane: Plane | null = given ? { normal: given.normal, point: given.point.map(v => Math.round(v / PLANE_GRID) * PLANE_GRID) as Vec3 } : null;

    const all: number[] = [];
    for (let i = 0; i < n; i++) {
        if (Number.isFinite(values[i]) && Number.isFinite(points[i * 3]) && Number.isFinite(points[i * 3 + 1]) && Number.isFinite(points[i * 3 + 2]) && (!extra || (Number.isFinite(extra[i * wide]) && (wide === 1 || Number.isFinite(extra[i * 2 + 1]))))) all.push(i);
    }
    // Rows to a block. A dip is three slope rows at the place of a value, so a block of as many rows holds a quarter of
    // the holes and the surface between holes suffers where blocks meet (a folded contact drilled at 50 m: 1.05 m out
    // at worst, against 0.16 m fitted in one go). With slopes among the rows a block takes up to twice as many (0.22 m)
    const valued = slopes ? all.reduce((t, i) => t + (sloped(i) ? 0 : 1), 0) : all.length;
    const perBlock = Math.round(Math.max(8, options.block ?? 150) * Math.min(SLOPE_ROWS, all.length / Math.max(1, valued)));
    const { leaves, top } = blockLeaves(points, all, options.cover, perBlock);
    // (The same in every fit: what the blocks were fitted with, as well as to)
    const how = hashNumbers([smoothing, plane ? 1 : drift === 'level' ? 2 : 3, ...(plane ? [...plane.normal, ...plane.point] : []), extra ? wide : 0]);

    const whole = scaleOf(points, all);
    const parts: FieldPart[] = [];
    const kept: BlockCache['fits'] = new Map();
    let smoothed = false, fitted = 0;
    // Each block, with what it is fitted to, in the order they are added up
    const blocks: { task: BlockTask; part: Omit<FieldPart, 'field'> }[] = [];
    // For each margin a block might take, the points inside: a block's margin is the usual one, narrower when that would
    // take too many of its neighbours' points, wider when it has too few near it
    // (Strictly inside: a block counts for nothing on its faces, so a point there need not be fitted by it)
    const inside = (min: Vec3, max: Vec3) => all.filter(i => {
        const x = points[i * 3], y = points[i * 3 + 1], z = points[i * 3 + 2];
        return x > min[0] && x < max[0] && y > min[1] && y < max[1] && z > min[2] && z < max[2];
    });
    const usual = MARGINS.indexOf(MARGIN);
    for (const leaf of leaves) {
        const s = leaf.size, longest = Math.max(s[0], s[1], s[2]);
        // The margins are shares of how far its points spread, not of the box (a box over the tops of holes may be ten times
        // as tall as the stretch of hole in it), but at least a share of the box, so that points along one line are fitted
        // with some width
        const w = [0, 1, 2].map(a => Math.min(s[a], Math.max(leaf.spread[a], s[a] / 8)));
        // How far past each face the nearest points beyond it are: [axis][0 below, 1 above] (0: none within reach)
        const gap = [[0, 0], [0, 0], [0, 0]], far = [[Infinity, Infinity], [Infinity, Infinity], [Infinity, Infinity]];
        // (Not for a box with no points of its own: it is at the edge, or between, and counts for little)
        for (let a = 0; a < 3 && leaf.count > 0; a++) {
            const lowFace = leaf.min[a], highFace = leaf.min[a] + s[a];
            let below = Infinity, above = Infinity;
            for (const i of all) {
                let across = true;
                for (let b = 0; b < 3 && across; b++) {
                    if (b === a) continue;
                    const v = points[i * 3 + b];
                    across = v > leaf.min[b] - MARGIN * w[b] && v < leaf.min[b] + s[b] + MARGIN * w[b];
                }
                if (!across) continue;
                const v = points[i * 3 + a];
                if (v < lowFace && lowFace - v < below) below = lowFace - v;
                if (v > highFace && v - highFace < above) above = v - highFace;
            }
            gap[a][0] = below <= REACH * longest ? below : 0;
            gap[a][1] = above <= REACH * longest ? above : 0;
            far[a][0] = below;
            far[a][1] = above;
        }
        // How far a box reaches past a face: on to the points beyond; or where there are none near (the edge of the data),
        // out to the edge of the cover, short of any points further off. That takes in no more points, and carries the
        // blocks along the edge of the data on out to where the field is wanted
        const side = (a: number, end: 0 | 1, m: number) => {
            if (gap[a][end] > 0) return Math.max(m * w[a], gap[a][end] + PAST * w[a]);
            const toCover = end === 0 ? leaf.min[a] - options.cover.min[a] : options.cover.max[a] - (leaf.min[a] + s[a]);
            return Math.max(m * s[a], Math.min(Math.max(0, toCover) + m * s[a], far[a][end]));
        };
        const boxAt = (k: number): Box3 => {
            const m = MARGINS[k];
            return {
                min: [0, 1, 2].map(a => leaf.min[a] - side(a, 0, m)) as Vec3,
                max: [0, 1, 2].map(a => leaf.min[a] + s[a] + side(a, 1, m)) as Vec3,
            };
        };
        let k = usual;
        let box = boxAt(k);
        let rows = inside(box.min, box.max);
        if (leaf.count === 0) {
            // A box with no points of its own is the box alone, fitted to the block's worth of points nearest it (all
            // outside it). It counts for next to nothing where a block with points reaches: it is there for where none does
            box = { min: leaf.min, max: [leaf.min[0] + s[0], leaf.min[1] + s[1], leaf.min[2] + s[2]] };
            rows = nearest(points, all, [leaf.min[0] + s[0] / 2, leaf.min[1] + s[1] / 2, leaf.min[2] + s[2] / 2], perBlock);
            k = -1;
        } else if (rows.length > CROWD * perBlock) {
            while (k > 0 && rows.length > CROWD * perBlock) {
                box = boxAt(--k);
                rows = inside(box.min, box.max);
            }
        } else {
            while (k + 1 < MARGINS.length && rows.length < SPARSE * perBlock) {
                const wider = boxAt(k + 1), more = inside(wider.min, wider.max);
                if (more.length > CROWD * perBlock) break;
                k++;
                box = wider;
                rows = more;
            }
        }
        if (rows.length > CROWD * perBlock && leaf.count > 0) {
            // Still too many: a face reaching out across sparse ground to the edge of the cover, or on to points far off.
            // The box with plain margins, then (if even that is crowded) the points nearest it
            const plain: Box3 = {
                min: [0, 1, 2].map(a => leaf.min[a] - MARGINS[0] * w[a]) as Vec3,
                max: [0, 1, 2].map(a => leaf.min[a] + s[a] + MARGINS[0] * w[a]) as Vec3,
            };
            const few = inside(plain.min, plain.max);
            box = plain;
            rows = few.length > CROWD * perBlock
                ? nearest(points, few, [leaf.min[0] + s[0] / 2, leaf.min[1] + s[1] / 2, leaf.min[2] + s[2] / 2], CROWD * perBlock)
                : few;
            k = -2;
        }
        const local: number[] = [], vals: number[] = [], more: number[] = [];
        for (const i of rows) {
            local.push(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]);
            vals.push(values[i]);
            if (extra) { more.push(extra[i * wide]); if (wide === 2) more.push(extra[i * 2 + 1]); }
        }
        // The same looseness in every block, whatever its size: smoothing is in units of the fit's own scale
        const inBlock = whole / scaleOf(local);
        const loose = smoothing * inBlock;
        // (A slope row's own looseness is a share of what it reads of itself: the same at any size)
        const own = looser ? rows.map(i => (looser![i] > 0 ? (sloped(i) ? looser![i] : looser![i] * inBlock) : 0)) : null;
        const ownLoose = own && own.some(l => l > 0) ? own : null;
        // Rows that are slopes: their directions go with them (a block with none among its rows is as it was before there were any)
        const dirs = slopes && rows.some(sloped) ? rows.flatMap(i => [slopes![i * 3], slopes![i * 3 + 1], slopes![i * 3 + 2]]) : null;
        const dirExtra = dirs && slopeExtra ? rows.map(i => slopeExtra[i]) : null;
        const rowKey = `${dirs ? `|s${hashNumbers(dirExtra ? [...dirs, ...dirExtra] : dirs)}` : ''}${round > 0 ? `|r${round}` : ''}`;
        const key = `${leaf.key}|${k}|${how}|${loose}|${rows.length}|${hashNumbers(extra ? [...local, ...vals, ...more] : [...local, ...vals])}${ownLoose ? `|${hashNumbers(ownLoose)}` : ''}${rowKey}`;
        blocks.push({
            task: {
                key, points: local, values: vals, extra: extra ? more : null, smoothing: loose, drift: plane ?? drift, ...(ownLoose ? { loose: ownLoose } : {}),
                ...(dirs ? { slopes: dirs } : {}), ...(dirExtra ? { slopeExtra: dirExtra } : {}), ...(round > 0 ? { round } : {}),
            },
            part: { min: box.min, max: box.max, weight: (top / longest) ** 3 * (leaf.count > 0 ? 1 : EMPTY) },
        });
    }
    // Fitted elsewhere, when there are enough to make that worth it
    const wanted = options.reuse?.wanted ?? null;
    if (wanted) {
        const missing = blocks.filter(b => !options.reuse!.fits.has(b.task.key) && !wanted.asked.has(b.task.key)).map(b => b.task);
        if (missing.length > 0 && missing.length >= wanted.least) {
            for (const m of missing) wanted.asked.add(m.key);
            throw new BlocksWanted(missing);
        }
    }
    for (const { task, part } of blocks) {
        let block = options.reuse?.fits.get(task.key);
        if (!block) {
            const fit = fitOne(task.points, task.values, task.smoothing, task.drift, task.extra, task.loose ?? null, rowsOf(task));
            if (!fit.ok) return fit;
            block = { field: fit.field, smoothed: fit.stats.smoothed };
            fitted++;
        }
        smoothed ||= block.smoothed;
        kept.set(task.key, block);
        wanted?.used.add(task.key);
        parts.push({ ...part, field: block.field });
    }
    if (parts.length === 0) return { ok: false, reason: 'too-few' };
    if (options.reuse) {
        // (While blocks are fitted elsewhere, a fit is run again once they are in: nothing goes till the last run is done)
        if (wanted) for (const [key, block] of kept) options.reuse.fits.set(key, block);
        else options.reuse.fits = kept;
    }

    const field: FittedField = { centres: new Float64Array(0), weights: new Float64Array(0), lin: [0, 0, 0], c0: 0, origin: [0, 0, 0], scale: 1, parts };
    let worstMiss = 0;
    if (smoothing > 0 || smoothed || looser) {
        const at = readField(field, Float64Array.from(all.flatMap(i => [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]])), extra ? (wide === 2 ? all.flatMap(i => [extra[i * 2], extra[i * 2 + 1]]) : all.map(i => extra[i])) : null);
        // (Of the values: a slope row's value is not what the field is there)
        all.forEach((i, q) => { if (!sloped(i)) worstMiss = Math.max(worstMiss, Math.abs(at[q] - values[i])); });
    }
    return { ok: true, field, stats: { used: all.length, merged: 0, worstMiss, smoothed, blocks: parts.length, refitted: fitted } };
}
