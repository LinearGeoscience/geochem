/**
 * Finding the plunge of grade continuity from drillhole assays.
 *
 * Looking down the plunge of a high-grade shoot, its highs stack on top of
 * each other: the X-ray plunge projection of Cowan (2014), done by eye in the
 * 3D view with the highs drawn in front. This does the same by count. For
 * about 1,500 directions over the lower hemisphere, every pair of high places
 * in DIFFERENT holes counts by how nearly one hides the other looking down
 * that direction. The same count for places taken at random from the
 * drilling is what the drilling alone gives (rows of holes, the direction
 * the holes run in); each direction's count is divided by it, so only what
 * the grades add is left. The result is drawn on a stereonet: a bright spot
 * is a direction the highs line up along; a bright band (a great circle) is
 * a plane they lie in.
 *
 * It is done at several cut-offs (the top 8% of samples down to the top
 * 0.5%), and at each it is asked how clear the peak is (against the best
 * more than 30 degrees away) and whether two halves of the holes, scanned
 * apart, agree (split at random five times). The answer believed is the one
 * whose halves agree best, of those that are clear and agree well enough.
 * (Leaving out a quarter of the holes, tried first, moved the answer little
 * even where it was noise: the rest still shares most of the data. On real
 * drilling it called answers sure that two halves did not repeat.)
 *
 * Tried on made-up deposits with a known plunge (frontend/scripts/qa/local/
 * plungeTrial.ts, 2026-11-18): drilled across the strike, a median of 2 to 3
 * degrees out; the long axis of the highs, 4 to 6 at its best cut-off. It can
 * be sure and wrong where a shoot rakes inside a lode and the drilling is
 * coarse, or runs near the strike: it then finds the strike, or the line the
 * drill sections cut on the lode.
 */
import { jacobiEigendecomposition } from '../../utils/calculations/eigen';

export type Vec3 = [number, number, number];
const RAD = Math.PI / 180;

/** The samples to scan, one per row */
export interface PlungeSamples {
    x: ArrayLike<number>;
    y: ArrayLike<number>;
    z: ArrayLike<number>;
    /** The grade (rows without one are left out) */
    value: ArrayLike<number>;
    /** Which hole each row is in (a number per hole; negative: none, left out) */
    hole: ArrayLike<number>;
    /** Depth down the hole (From), to put each hole's rows in order; null: by height, highest first */
    depth: ArrayLike<number> | null;
}

export interface PlungeOptions {
    /** The usual distance between holes, m (missing or 0: worked out from the samples) */
    spacing?: number | null;
    /** The cut-offs, as shares of the samples (the top so-many) */
    shares?: readonly number[];
    seed?: number;
    /** How many times the holes are split in two (default 5) */
    splits?: number;
    /** How many times a quarter of the holes are left out (default 0: not done) */
    holdOuts?: number;
    /** The halves must agree within this many degrees (default AGREE) */
    agree?: number;
    /** Told how far it has got: steps done of all of them */
    onProgress?: (done: number, total: number) => void;
}

export interface PlungeNet {
    /** The top this share of the samples are the highs (0.02: the top 2%) */
    share: number;
    /** The grade they reach */
    cutoff: number;
    /** How many high places (pieces of hole with a high in them) */
    places: number;
    /** How many pairs of them in different holes were counted */
    pairs: number;
    /** For each direction of `scanDirections()`: how many times what chance gives (smoothed) */
    ratio: Float32Array;
    /** For each direction: 1 when the drilling can see that way at all */
    seen: Uint8Array;
    /** The peak, pointing down; null when there are too few highs */
    axis: Vec3 | null;
    plunge: number | null;
    trend: number | null;
    peak: number;
    /** The usual value over the net (its median) */
    rest: number;
    /** The best more than 30 degrees from the peak */
    second: number;
    /** How far the peak stands above the usual, against the best elsewhere (1: no better) */
    clear: number;
    /**
     * How far apart the answers of two halves of the holes are, degrees: the
     * holes split in two at random, each half scanned alone, five times over
     * (the median). Two halves share no data, so they agree only where the
     * highs really line up.
     */
    halves: number;
    /** How far the peak moves, median degrees, when a quarter of the holes are left out (only when asked for: NaN) */
    wobble: number;
    /** Clear and steady enough to be believed */
    sure: boolean;
    /** How much the bright part of the net is a band (0: one spot, 1: a full great circle) */
    band: number;
    /** The pole of the plane the band follows, pointing up */
    pole: Vec3 | null;
}

export type PlungeResult =
    | {
        ok: true;
        nets: PlungeNet[];
        /** The net believed (the steadiest sure one; else the steadiest): -1 when none found anything */
        chosen: number;
        sure: boolean;
        /** The hole spacing used, m */
        spacing: number;
        samples: number;
        holes: number;
    }
    /** holes: fewer than three holes with values; spacing: the holes' spacing could not be told */
    | { ok: false; reason: 'holes' | 'spacing' };

/** The cut-offs tried, as shares of the samples */
export const PLUNGE_SHARES: readonly number[] = [0.08, 0.04, 0.02, 0.01, 0.005];
/** Sure when the peak stands this many times clearer than the best elsewhere, and moves no more than this many degrees */
export const CLEAR = 1.5, AGREE = 15;
/** How many directions are tried over the lower hemisphere */
export const DIRECTION_COUNT = 1500;
/** The scan's settings, as shares of the hole spacing: how close to in line a pair must be (fading), the nearest and furthest pair counted, the length of a piece of hole */
const FADE = 0.3, LEAST = 0.6, MOST = 6, PIECE = 0.25;
/** How many places the counts are made from at most (more are thinned at random) */
const MOST_HIGHS = 520, MOST_CHANCE = 380, CHANCE_DRAWS = 5;
/** Ten times a quarter of the holes are left out */
const SPLITS = 5, LEAVE_OUT = 0.25;
/** The net is smoothed over this many degrees */
const SMOOTH = 3.5;
/** The drilling cannot see a direction when it gives less than this share of its usual count there */
const BLIND = 0.12;
/** The best elsewhere is looked for this many degrees from the peak and further */
const ELSEWHERE = 30;

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v: ArrayLike<number>): Vec3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const down = (v: Vec3): Vec3 => (v[2] > 0 ? [-v[0], -v[1], -v[2]] : v);
/** The angle between two lines (no sense of direction), degrees 0 to 90 */
export const lineAngle = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.acos(Math.min(1, Math.abs(dot(a, b)))) / RAD;
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };

/** A repeatable stream of numbers 0..1 */
function stream(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A direction (pointing down) as plunge and the bearing it plunges towards, degrees */
export function plungeOf(v: ArrayLike<number>): { plunge: number; trend: number } {
    const d = down(unit(v));
    return { plunge: Math.asin(Math.min(1, -d[2])) / RAD, trend: ((Math.atan2(d[0], d[1]) / RAD) + 360) % 360 };
}

// ---------------------------------------------------------------------------
// The directions, evenly over the lower hemisphere, and their near neighbours
// ---------------------------------------------------------------------------

let directions: Vec3[] | null = null;
let neighbours: { j: Int32Array; w: Float32Array }[] | null = null;

/** The directions every net is given for: evenly over the lower hemisphere (pointing down), always the same */
export function scanDirections(): Vec3[] {
    if (directions) return directions;
    const out: Vec3[] = [], golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < DIRECTION_COUNT; i++) {
        const z = -(i + 0.5) / DIRECTION_COUNT, r = Math.sqrt(1 - z * z), a = i * golden;
        out.push([r * Math.cos(a), r * Math.sin(a), z]);
    }
    directions = out;
    return out;
}

function near(): { j: Int32Array; w: Float32Array }[] {
    if (neighbours) return neighbours;
    const dirs = scanDirections(), reach = Math.cos(2.2 * SMOOTH * RAD);
    neighbours = dirs.map(a => {
        const j: number[] = [], w: number[] = [];
        dirs.forEach((b, k) => {
            const c = Math.abs(dot(a, b));
            if (c < reach) return;
            const t = Math.acos(Math.min(1, c)) / RAD;
            j.push(k); w.push(Math.exp(-t * t / (2 * SMOOTH * SMOOTH)));
        });
        return { j: Int32Array.from(j), w: Float32Array.from(w) };
    });
    return neighbours;
}

function smoothed(v: Float64Array, seen: Uint8Array): Float64Array {
    const nb = near();
    return Float64Array.from(v, (_, i) => {
        let sum = 0, w = 0;
        const { j, w: wt } = nb[i];
        for (let k = 0; k < j.length; k++) if (seen[j[k]]) { sum += v[j[k]] * wt[k]; w += wt[k]; }
        return w > 0 ? sum / w : 0;
    });
}

// ---------------------------------------------------------------------------
// The samples down each hole, and pieces of hole
// ---------------------------------------------------------------------------

interface Holes {
    /** Row numbers, hole after hole, in order down each */
    order: Int32Array;
    /** Where each hole's rows start in `order` (one more than there are holes) */
    start: number[];
    /** Which hole each row in `order` is in (0, 1, 2 ...) */
    holeOf: Int32Array;
    /** Positions of the rows in `order`, xyz */
    pos: Float64Array;
    value: Float64Array;
}

function holesOf(s: PlungeSamples): Holes {
    const n = Math.min(s.x.length, s.y.length, s.z.length, s.value.length, s.hole.length);
    const rows: number[] = [];
    for (let i = 0; i < n; i++) {
        if (s.hole[i] >= 0 && Number.isFinite(s.value[i]) && Number.isFinite(s.x[i]) && Number.isFinite(s.y[i]) && Number.isFinite(s.z[i])) rows.push(i);
    }
    const key = (i: number) => (s.depth && Number.isFinite(s.depth[i]) ? s.depth[i] : -s.z[i]);
    // The holes in an order that is theirs, not the caller's: by where each is (the least east, north and height among
    // its rows, then how many rows it has). The numbers the caller gave them follow the order of the rows, and so
    // would everything counted from every so-many-th row or drawn at random: the same samples in another order
    // gave another spacing and another answer (Phase 276)
    const least = new Map<number, [number, number, number, number]>();
    for (const i of rows) {
        const m = least.get(s.hole[i]);
        if (!m) least.set(s.hole[i], [s.x[i], s.y[i], s.z[i], 1]);
        else { if (s.x[i] < m[0]) m[0] = s.x[i]; if (s.y[i] < m[1]) m[1] = s.y[i]; if (s.z[i] < m[2]) m[2] = s.z[i]; m[3]++; }
    }
    const place = new Map([...least.entries()].sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1] || a[1][2] - b[1][2] || a[1][3] - b[1][3]).map(([hole], k) => [hole, k]));
    // ... and the rows of each down it; rows at one depth by where they are and what they hold
    rows.sort((a, b) => place.get(s.hole[a])! - place.get(s.hole[b])! || key(a) - key(b) || s.x[a] - s.x[b] || s.y[a] - s.y[b] || s.z[a] - s.z[b] || s.value[a] - s.value[b]);
    const order = Int32Array.from(rows), start: number[] = [], holeOf = new Int32Array(rows.length);
    const pos = new Float64Array(rows.length * 3), value = new Float64Array(rows.length);
    let h = -1;
    rows.forEach((r, k) => {
        if (k === 0 || s.hole[r] !== s.hole[rows[k - 1]]) { h++; start.push(k); }
        holeOf[k] = h;
        pos[k * 3] = s.x[r]; pos[k * 3 + 1] = s.y[r]; pos[k * 3 + 2] = s.z[r];
        value[k] = s.value[r];
    });
    start.push(rows.length);
    return { order, start, holeOf, pos, value };
}

/**
 * The usual distance between holes: from samples spread through the data,
 * the distance to the nearest sample in another hole, the median of them.
 * Between vertical holes on a grid it is the grid spacing.
 */
export function estimateSpacing(pos: ArrayLike<number>, holeOf: ArrayLike<number>, most = 600): number {
    const n = holeOf.length;
    if (n < 2) return 0;
    const every = Math.max(1, Math.floor(n / most)), found: number[] = [];
    for (let i = 0; i < n; i += every) {
        let best = Infinity;
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        for (let j = 0; j < n; j++) {
            if (holeOf[j] === holeOf[i]) continue;
            const d = (pos[j * 3] - x) ** 2 + (pos[j * 3 + 1] - y) ** 2 + (pos[j * 3 + 2] - z) ** 2;
            if (d < best) best = d;
        }
        if (best < Infinity) found.push(Math.sqrt(best));
    }
    return found.length ? median(found) : 0;
}

interface Place { p: Vec3; hole: number; w: number }

/**
 * The highs as places: each hole cut into pieces `piece` metres long, each
 * piece with a high in it one place (the middle of its highs), counting for
 * as many highs as it holds.
 */
function places(h: Holes, isHigh: (k: number) => boolean, piece: number): Place[] {
    const out: Place[] = [];
    for (let hole = 0; hole + 1 < h.start.length; hole++) {
        const end = h.start[hole + 1];
        for (let a = h.start[hole]; a < end;) {
            let b = a;
            const p: Vec3 = [0, 0, 0];
            let w = 0;
            // The piece runs from sample a as far as `piece` metres from it
            while (b < end && Math.hypot(h.pos[b * 3] - h.pos[a * 3], h.pos[b * 3 + 1] - h.pos[a * 3 + 1], h.pos[b * 3 + 2] - h.pos[a * 3 + 2]) < piece) {
                if (isHigh(b)) { w++; for (let c = 0; c < 3; c++) p[c] += h.pos[b * 3 + c]; }
                b++;
            }
            if (b === a) b = a + 1;
            if (w > 0) out.push({ p: [p[0] / w, p[1] / w, p[2] / w], hole, w });
            a = b;
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// The counts
// ---------------------------------------------------------------------------

interface Pairs { d: Float64Array; w: Float64Array; count: number }

/** The steps between places in different holes, from `least` to `most` metres apart */
function pairsOf(points: Place[], least: number, most: number): Pairs {
    const d: number[] = [], w: number[] = [];
    const l2 = least * least, m2 = most * most;
    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        for (let j = i + 1; j < points.length; j++) {
            const b = points[j];
            if (a.hole === b.hole) continue;
            const x = b.p[0] - a.p[0], y = b.p[1] - a.p[1], z = b.p[2] - a.p[2];
            const s = x * x + y * y + z * z;
            if (s < l2 || s > m2) continue;
            d.push(x, y, z); w.push(a.w * b.w);
        }
    }
    return { d: Float64Array.from(d), w: Float64Array.from(w), count: w.length };
}

/** For every direction: each pair counts fully when one place hides the other looking down it, fading over `h` metres */
function stackAll(pairs: Pairs, h: number): Float64Array {
    const dirs = scanDirections();
    const { d, w, count } = pairs, k = -1 / (2 * h * h), limit = 12 * h * h;
    const out = new Float64Array(dirs.length);
    for (let q = 0; q < dirs.length; q++) {
        const dx = dirs[q][0], dy = dirs[q][1], dz = dirs[q][2];
        let sum = 0;
        for (let i = 0; i < count; i++) {
            const x = d[i * 3], y = d[i * 3 + 1], z = d[i * 3 + 2];
            const along = x * dx + y * dy + z * dz;
            const off2 = x * x + y * y + z * z - along * along;
            if (off2 < limit) sum += w[i] * Math.exp(off2 * k);
        }
        out[q] = sum;
    }
    return out;
}

const thin = <T,>(list: T[], most: number, rnd: () => number): T[] => (list.length <= most ? list : list.filter(() => rnd() < most / list.length));

interface Setting { h: number; least: number; most: number; piece: number }

/** What the drilling alone gives looking down each direction (as a share of its own average), and where it is blind */
interface Chance { shape: Float64Array; seen: Uint8Array }

function chanceOf(h: Holes, s: Setting, rnd: () => number, step: () => void): Chance {
    const dirs = scanDirections(), sum = new Float64Array(dirs.length);
    const all = places(h, () => true, s.piece);
    for (let k = 0; k < CHANCE_DRAWS; k++) {
        const set = thin(all, MOST_CHANCE, rnd).map(p => ({ ...p, w: 1 }));
        const v = stackAll(pairsOf(set, s.least, s.most), s.h);
        for (let i = 0; i < v.length; i++) sum[i] += v[i];
        step();
    }
    let mean = 0;
    for (const v of sum) mean += v / sum.length;
    const shape = Float64Array.from(sum, v => (mean > 0 ? v / mean : 0));
    return { shape, seen: Uint8Array.from(shape, v => (v > BLIND ? 1 : 0)) };
}

type Net = Omit<PlungeNet, 'share' | 'cutoff' | 'halves' | 'wobble' | 'sure' | 'clear' | 'plunge' | 'trend'>;

/** The net for one set of high places: how many times more they stack than chance, each way; and its peak */
function netOf(high: Place[], chance: Chance, s: Setting, rnd: () => number): Net {
    const dirs = scanDirections();
    const none: Net = { ratio: new Float32Array(dirs.length), seen: chance.seen, axis: null, peak: 0, rest: 0, second: 0, band: 0, pole: null, places: high.length, pairs: 0 };
    const pairs = pairsOf(thin(high, MOST_HIGHS, rnd), s.least, s.most);
    if (pairs.count < 30) return none;
    const raw = stackAll(pairs, s.h);
    let mean = 0, count = 0;
    for (let i = 0; i < raw.length; i++) if (chance.seen[i]) { mean += raw[i]; count++; }
    mean /= Math.max(count, 1);
    if (!(mean > 0)) return none;
    const EPS = 0.1;
    const ratio = smoothed(Float64Array.from(raw, (v, i) => (v / mean + EPS) / (chance.shape[i] + EPS)), chance.seen);
    let best = -1;
    for (let i = 0; i < ratio.length; i++) if (chance.seen[i] && (best < 0 || ratio[i] > ratio[best])) best = i;
    if (best < 0) return none;
    const seenValues: number[] = [];
    for (let i = 0; i < ratio.length; i++) if (chance.seen[i]) seenValues.push(ratio[i]);
    const rest = median(seenValues);
    // The peak, finer than the spacing of the directions: the middle of what stands near the top round it
    const t = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < ratio.length; i++) {
        if (!chance.seen[i] || lineAngle(dirs[i], dirs[best]) > 9) continue;
        const w = Math.max(0, (ratio[i] - rest) / (ratio[best] - rest + 1e-12)) ** 4;
        const v = dot(dirs[i], dirs[best]) < 0 ? [-dirs[i][0], -dirs[i][1], -dirs[i][2]] : dirs[i];
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) t[a][b] += w * v[a] * v[b];
    }
    const axis = down(unit(jacobiEigendecomposition(t).eigenvectors[0]));
    let second = rest;
    for (let i = 0; i < ratio.length; i++) if (chance.seen[i] && lineAngle(dirs[i], axis) > ELSEWHERE && ratio[i] > second) second = ratio[i];
    // A band of bright directions (a plane with no line in it) against one spot: how the top of the net is spread
    const top = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const upper = rest + 0.5 * (ratio[best] - rest);
    for (let i = 0; i < ratio.length; i++) {
        if (!chance.seen[i] || ratio[i] < upper) continue;
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) top[a][b] += dirs[i][a] * dirs[i][b];
    }
    const e = jacobiEigendecomposition(top);
    const p = unit(e.eigenvectors[2]);
    return {
        ratio: Float32Array.from(ratio), seen: chance.seen, axis, peak: ratio[best], rest, second,
        band: e.eigenvalues[1] / Math.max(e.eigenvalues[0], 1e-12), pole: p[2] < 0 ? [-p[0], -p[1], -p[2]] : p,
        places: high.length, pairs: pairs.count,
    };
}

const clearOf = (n: { peak: number; rest: number; second: number }) => (n.peak - n.rest) / Math.max(n.second - n.rest, 1e-9);

/** The grade the top `share` of the values reach */
function cutoffFor(sorted: Float64Array, share: number): number {
    return sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * (1 - share))))];
}

/** Scan the samples for the plunge of their highs */
export function scanPlunge(samples: PlungeSamples, options: PlungeOptions = {}): PlungeResult {
    const shares = options.shares ?? PLUNGE_SHARES;
    const h = holesOf(samples);
    const holeCount = h.start.length - 1;
    if (holeCount < 3) return { ok: false, reason: 'holes' };
    const spacing = options.spacing && options.spacing > 0 ? options.spacing : estimateSpacing(h.pos, h.holeOf);
    if (!(spacing > 0)) return { ok: false, reason: 'spacing' };
    const s: Setting = { h: FADE * spacing, least: LEAST * spacing, most: MOST * spacing, piece: PIECE * spacing };
    const rnd = stream(options.seed ?? 1);
    const splits = options.splits ?? SPLITS, holdOuts = options.holdOuts ?? 0, agree = options.agree ?? AGREE;
    const total = CHANCE_DRAWS + shares.length * (1 + 2 * splits + holdOuts);
    let done = 0;
    const step = () => { done++; options.onProgress?.(done, total); };
    const chance = chanceOf(h, s, rnd, step);
    const sorted = Float64Array.from(h.value).sort();
    const nets: PlungeNet[] = shares.map(share => {
        const cutoff = cutoffFor(sorted, share);
        const high = places(h, k => h.value[k] >= cutoff, s.piece);
        const full = netOf(high, chance, s, rnd);
        step();
        // Two halves of the holes, each alone: how far apart their answers are
        const apart: number[] = [];
        for (let k = 0; k < splits; k++) {
            if (full.axis) {
                const side = new Uint8Array(holeCount);
                for (let hole = 0; hole < holeCount; hole++) side[hole] = rnd() < 0.5 ? 1 : 0;
                const a = netOf(high.filter(p => side[p.hole] === 1), chance, s, rnd);
                step();
                const b = netOf(high.filter(p => side[p.hole] === 0), chance, s, rnd);
                step();
                apart.push(a.axis && b.axis ? lineAngle(a.axis, b.axis) : 90);
            } else { step(); step(); }
        }
        const moved: number[] = [];
        for (let k = 0; k < holdOuts; k++) {
            if (full.axis) {
                const out = new Set<number>();
                for (let hole = 0; hole < holeCount; hole++) if (rnd() < LEAVE_OUT) out.add(hole);
                const part = netOf(high.filter(p => !out.has(p.hole)), chance, s, rnd);
                moved.push(part.axis ? lineAngle(part.axis, full.axis) : 90);
            }
            step();
        }
        const halves = apart.length ? median(apart) : 90;
        const wobble = moved.length ? median(moved) : NaN;
        const clear = full.axis ? clearOf(full) : 0;
        const at = full.axis ? plungeOf(full.axis) : null;
        return { ...full, share, cutoff, halves, wobble, clear, sure: !!full.axis && clear >= CLEAR && halves <= agree, plunge: at?.plunge ?? null, trend: at?.trend ?? null };
    });
    const rank = (a: number, b: number) => nets[a].halves - nets[b].halves || nets[b].clear - nets[a].clear;
    const sure = nets.map((_, i) => i).filter(i => nets[i].sure).sort(rank);
    const found = nets.map((_, i) => i).filter(i => nets[i].axis).sort(rank);
    return { ok: true, nets, chosen: sure[0] ?? found[0] ?? -1, sure: sure.length > 0, spacing, samples: h.order.length, holes: holeCount };
}

// ---------------------------------------------------------------------------
// The stereonet (equal area, lower hemisphere, north up)
// ---------------------------------------------------------------------------

/** Where a direction falls on a net of radius 1 (x right = east, y down = south) */
export function netPoint(v: ArrayLike<number>): [number, number] {
    const { plunge, trend } = plungeOf(v);
    const r = Math.SQRT2 * Math.sin(((90 - plunge) * RAD) / 2);
    return [r * Math.sin(trend * RAD), -r * Math.cos(trend * RAD)];
}

/** The direction at a place on a net of radius 1 (null outside it); pointing down */
export function netDirection(x: number, y: number): Vec3 | null {
    const r = Math.hypot(x, y);
    if (r > 1.0001) return null;
    const plunge = 90 - (2 * Math.asin(Math.min(1, r / Math.SQRT2))) / RAD;
    const trend = r < 1e-9 ? 0 : Math.atan2(x, -y);
    const p = plunge * RAD;
    return [Math.sin(trend) * Math.cos(p), Math.cos(trend) * Math.cos(p), -Math.sin(p)];
}

/** The great circle of a plane (its pole), as points on a net of radius 1 */
export function greatCircle(pole: ArrayLike<number>, steps = 90): [number, number][] {
    const n = unit(pole);
    // Start on the rim (along the strike, which is level), or the half turn crosses
    // the rim part way and the path jumps across the net (gently dipping planes)
    const helper: Vec3 = Math.abs(n[2]) < 1 - 1e-9 ? [0, 0, 1] : [1, 0, 0];
    const u = unit([n[1] * helper[2] - n[2] * helper[1], n[2] * helper[0] - n[0] * helper[2], n[0] * helper[1] - n[1] * helper[0]]);
    const w: Vec3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
    const out: [number, number][] = [];
    // Half a turn covers the lower half once (each line both ways is one point)
    for (let i = 0; i <= steps; i++) {
        const a = (Math.PI * i) / steps;
        const v: Vec3 = [u[0] * Math.cos(a) + w[0] * Math.sin(a), u[1] * Math.cos(a) + w[1] * Math.sin(a), u[2] * Math.cos(a) + w[2] * Math.sin(a)];
        out.push(netPoint(v));
    }
    return out;
}

/** A plane from its pole: how steeply it dips and the bearing it dips towards, degrees */
export function planeOf(pole: ArrayLike<number>): { dip: number; direction: number } {
    let n = unit(pole);
    if (n[2] < 0) n = [-n[0], -n[1], -n[2]];
    return { dip: Math.acos(Math.min(1, n[2])) / RAD, direction: ((Math.atan2(n[0], n[1]) / RAD) + 360) % 360 };
}
