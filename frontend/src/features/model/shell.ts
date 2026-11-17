/**
 * Grade shells: a closed surface round everything at or above a cut-off in
 * a column of numbers (pure, unit-tested).
 *
 * The column is carried through space from sample to sample (pou.ts) and
 * the shell is where that field equals the cut-off. Values that spread over
 * orders of magnitude, as most assays do, are better carried as their
 * logarithms: a single very high sample then does not swell the shell far
 * out into low ground.
 *
 * A shell belongs to its samples. From each sample at or above the cut-off
 * it may go as far as the holes are apart there (by default one and a half
 * times the distance to the next holes: a few metres among close-spaced
 * grade-control holes, tens of metres among wide-spaced ones) and no
 * further. Where the samples are too many to fit one by one, the ones that
 * decide where the shell is are kept as they are: those at or above the
 * cut-off and the ones next to them down the hole. Only the long runs below
 * the cut-off are averaged, and samples too far from any high value to
 * matter are left out. Nothing is averaged across the cut-off unless the
 * samples at or above it are themselves too many, or an averaging length is
 * asked for.
 *
 * How the samples are prepared is a choice (ShellChoice, ShellRule):
 * averaged down the hole to one length or as sampled; with or without a top
 * cut (no value counts as more than it); and with the values limited to a
 * band about the cut-off in the fit, so that the edge of the shell sits
 * about halfway between a high place and a low one beside it however
 * extreme either is.
 *
 * A shell that follows the structure of the ground (structure.ts) is worked
 * out in space stretched across that structure: the distance to the next
 * hole, the reach and the fit itself are all measured there, so the shell
 * joins from hole to hole along the structure and stays thin across it.
 */
import { NearGrid, ReachGrid } from './near';
import { fitBlended } from './pou';
import { heightLattice, type Potential } from './frame';
import { evaluateField, layerCoordinate, stretchedBox, stretchPoints, type FieldCap, type FittedField, type Layering, type Stretch } from './rbf';
import type { SheetFit } from './sheet';
import type { Box3, ShellRule, Vec3 } from './types';

/** The samples a shell is built from: a value at a place, down holes when the hole and depth columns are known */
export interface ShellSamples {
    hole: ArrayLike<string> | null;
    from: ArrayLike<number> | null;
    to: ArrayLike<number> | null;
    x: ArrayLike<number>;
    y: ArrayLike<number>;
    z: ArrayLike<number>;
    value: ArrayLike<number>;
}

/** What is asked of a shell's samples */
export interface ShellChoice {
    cutoff: number;
    /** Average the samples down each hole over this length first, m (null: only if those at or above the cut-off are too many to fit) */
    composite?: number | null;
    /** No sample counts as more than this (null: as assayed) */
    topCut?: number | null;
    /** How far the shell may go from a place at or above the cut-off, in hole spacings there (null: one and a half) */
    reach?: number | null;
    /** The space it is worked out in (null: as it is) */
    stretch?: Stretch | null;
    /** It follows the ground as it lies from place to place (`stretch` is then not used) */
    layers?: ShellLayers | null;
    /** Fit to at most this many places */
    max?: number;
}

/**
 * A shell that follows the ground as it lies from place to place: a folded
 * layer has no one direction, so no one stretched space suits it. The fit
 * takes each place's height through the layers (frame.ts) as one more
 * coordinate, counted so that a metre across the layers is as far as
 * `strength` metres along them (rbf.ts, `Layering`). Where the ground lies
 * one way everywhere it is the same fit as in space stretched across it.
 */
export interface ShellLayers {
    potential: Potential;
    /** How many times further things carry along the ground than across it (over 1) */
    strength: number;
    /** Places to a block of the fit (left out: the usual). For checking that where the blocks are cut does not matter */
    block?: number;
}

export interface ShellInputs {
    kind: 'shell';
    /** The places the field is fitted to (samples, or averages of them), xyz triples, and the value at each */
    positions: Float64Array;
    values: Float64Array;
    /** For each place, the next one down the same hole (-1: none) */
    next: Int32Array;
    /** How many samples each place stands for (averages of the length asked for, when one was) */
    count: Int32Array;
    /** The values as they were asked for (the samples, or their averages over the length asked for; top cut), smallest first */
    sorted: Float64Array;
    /** The length down the hole every sample was averaged over, m (null: they were not) */
    composite: number | null;
    /** That length is longer than the one asked for: there were too many places at or above the cut-off to fit */
    forced: boolean;
    /** Samples above the top cut, taken as the top cut */
    capped: number;
    /** How far the shell may go from each place, m along the structure when it follows one (0 for a place below the cut-off) */
    reach: Float64Array;
    /** The space the shell is worked out in (null: as it is). The places above are where they are in the ground */
    stretch: Stretch | null;
    /** It follows the ground as it lies from place to place (null: it does not). The distances above are then as they are in the ground */
    layers: ShellLayers | null;
    /** That reach in hole spacings (the distance from the place to the holes next to it) */
    reachFactor: number;
    /** The reach where the holes are close and where they are far apart: what one high place in ten is under, and over, m */
    reachRange: [number, number];
    /**
     * Built from intercepts (intercepts.ts): how many there are, in how many of the holes, their length in all, m,
     * and their average. Null: the hole and depth columns are not known. Absent: not built from intercepts
     */
    intercepts?: { count: number; holes: number; holesWith: number; length: number; grade: number } | null;
    /** The usual length of a place down its hole, m (null: the hole and depth columns are not known) */
    step: number | null;
    /** Places at or above the cut-off */
    high: number;
    /** Samples below the cut-off, away from the high ones, that were averaged with their neighbours */
    merged: number;
    /** Samples too far from any high value to change the shell, left out */
    dropped: number;
    /** Holes with a sample (0 when the hole column is not known) */
    holes: number;
    /** A short mark of all of the above: the same places and values give the same mark */
    mark: string;
}

/** A shell is fitted to at most this many places */
export const MAX_SHELL_POINTS = 16_000;
/** A shell reaches this many hole spacings from a high value, unless another number is asked for */
export const AUTO_REACH = 1.5;
/** A hole whose nearest neighbour is under this share of the way to the next one has a twin: the spacing is to the next */
const TWIN = 0.25;
/** Runs below the cut-off are averaged over at most this many places down the hole */
const MOST_MERGED = 32;
/** The hole spacing is worked out at no more than this many high places (the rest take their neighbour's down the hole) */
const MAX_ASKED = 6000;
/** Samples further than this many reaches from every high value are left out */
const KEEP_WITHIN = 2;

function median(values: number[]): number {
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length === 0 ? NaN : sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function markOf(...arrays: (Float64Array | Int32Array)[]): string {
    let h = 0x811c9dc5;
    for (const a of arrays) {
        const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
        for (let i = 0; i < bytes.length; i++) {
            h ^= bytes[i];
            h = Math.imul(h, 0x01000193);
        }
    }
    return (h >>> 0).toString(16).padStart(8, '0');
}

/** Places in order down each hole, one hole after another */
interface Places {
    /** xyz triples */
    pos: number[];
    v: number[];
    /** Samples in each */
    n: number[];
    /** Its length down the hole (0: not known) */
    len: number[];
    /** Which hole (each place its own when the holes are not known) */
    hole: number[];
}

/**
 * How far apart the holes are at each high place: the distance from it to
 * the nearest other hole, or to the one after that when the nearest is so
 * much closer that it is a twin or a wedge of this one and not the spacing.
 * Infinity where no other hole is anywhere near; NaN for the places that
 * are not high.
 */
function localSpacing(p: Places, high: Uint8Array, step: number | null): Float64Array {
    const n = p.v.length;
    const out = new Float64Array(n).fill(NaN);
    let highs = 0;
    for (let i = 0; i < n; i++) highs += high[i];
    if (highs === 0) return out;
    // Looked for nearby first, then further and further off
    let finest = step !== null && step > 0 ? 8 * step : 0;
    if (!(finest > 0)) {
        const min = [Infinity, Infinity, Infinity], top = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < p.pos.length; i++) { min[i % 3] = Math.min(min[i % 3], p.pos[i]); top[i % 3] = Math.max(top[i % 3], p.pos[i]); }
        finest = Math.max(top[0] - min[0], top[1] - min[1], top[2] - min[2]) / Math.cbrt(n) / 2 || 1;
    }
    const grids: (NearGrid | null)[] = [null, null, null];
    const cellOf = (level: number) => finest * 8 ** level;
    const other = (x: number, y: number, z: number, a: number, b: number, from: number): { d: number; hole: number; level: number } | null => {
        for (let level = from; level < 3; level++) {
            const grid = grids[level] ?? (grids[level] = new NearGrid(p.pos, cellOf(level)));
            for (const times of [1, 2, 4]) {
                const limit = times * cellOf(level);
                const d = grid.nearestOther(x, y, z, limit, p.hole, a, b);
                if (d < limit) return { d, hole: grid.found, level };
            }
        }
        return null;
    };
    const every = Math.max(1, Math.ceil(highs / MAX_ASKED));
    let last = -1, since = 0;
    for (let i = 0; i < n; i++) {
        if (high[i] === 0) continue;
        if (last >= 0 && p.hole[last] === p.hole[i] && since < every - 1) {
            out[i] = out[last];
            since++;
            continue;
        }
        const x = p.pos[i * 3], y = p.pos[i * 3 + 1], z = p.pos[i * 3 + 2];
        const first = other(x, y, z, p.hole[i], p.hole[i], 0);
        const second = first ? other(x, y, z, p.hole[i], first.hole, first.level) : null;
        out[i] = !first ? Infinity : second && first.d < TWIN * second.d ? second.d : first.d;
        last = i;
        since = 0;
    }
    return out;
}

interface Thinned {
    positions: number[];
    values: number[];
    next: number[];
    count: number[];
    reach: number[];
    merged: number;
    dropped: number;
}

/**
 * The places a shell is fitted to, out of all of them: the high ones and
 * the ones next to them down the hole as they are; the other near ones
 * averaged over `merge` metres down the hole (0: not averaged); the far
 * ones left out.
 */
function thinned(p: Places, high: Uint8Array, near: Uint8Array, reach: Float64Array, merge: number): Thinned {
    const out: Thinned = { positions: [], values: [], next: [], count: [], reach: [], merged: 0, dropped: 0 };
    const n = p.v.length;
    let last = -1, lastHole = -1;
    const put = (px: number, py: number, pz: number, v: number, c: number, h: number, r = 0) => {
        const at = out.values.length;
        out.positions.push(px, py, pz);
        out.values.push(v);
        out.count.push(c);
        out.reach.push(r);
        out.next.push(-1);
        if (last >= 0 && lastHole === h) out.next[last] = at;
        last = at;
        lastHole = h;
    };
    let w = 0, sx = 0, sy = 0, sz = 0, sv = 0, samples = 0, places = 0;
    const flush = (h: number) => {
        if (places > 0) {
            put(sx / w, sy / w, sz / w, sv / w, samples, h);
            if (places > 1) out.merged += samples;
        }
        w = sx = sy = sz = sv = samples = places = 0;
    };
    for (let i = 0; i < n; i++) {
        const h = p.hole[i];
        if (i > 0 && p.hole[i - 1] !== h) flush(p.hole[i - 1]);
        const x = p.pos[i * 3], y = p.pos[i * 3 + 1], z = p.pos[i * 3 + 2];
        const sharp = high[i] === 1 || (i > 0 && p.hole[i - 1] === h && high[i - 1] === 1) || (i + 1 < n && p.hole[i + 1] === h && high[i + 1] === 1);
        if (sharp || (near[i] === 1 && !(merge > 0))) {
            flush(h);
            put(x, y, z, p.v[i], p.n[i], h, high[i] === 1 ? reach[i] : 0);
            continue;
        }
        if (near[i] === 0) {
            flush(h);
            out.dropped += p.n[i];
            continue;
        }
        const len = p.len[i] > 0 ? p.len[i] : 1;
        w += len;
        sx += len * x;
        sy += len * y;
        sz += len * z;
        sv += len * p.v[i];
        samples += p.n[i];
        places++;
        if (w >= merge) flush(h);
    }
    if (n > 0) flush(p.hole[n - 1]);
    return out;
}

/** Places averaged with their neighbours, in boxes as small as `budget` places allow. */
function boxed(rows: readonly number[], from: Thinned, budget: number, into: Thinned): void {
    if (rows.length <= budget) {
        for (const i of rows) {
            into.positions.push(from.positions[i * 3], from.positions[i * 3 + 1], from.positions[i * 3 + 2]);
            into.values.push(from.values[i]);
            into.count.push(from.count[i]);
            into.reach.push(from.reach[i]);
            into.next.push(-1);
        }
        return;
    }
    const min = [Infinity, Infinity, Infinity], top = [-Infinity, -Infinity, -Infinity];
    for (const i of rows) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], from.positions[i * 3 + k]); top[k] = Math.max(top[k], from.positions[i * 3 + k]); }
    const extent = Math.max(top[0] - min[0], top[1] - min[1], top[2] - min[2], 1e-9);
    for (let size = extent / Math.ceil(Math.cbrt(Math.max(1, budget)) * 2); ; size *= 1.2) {
        const nx = Math.floor((top[0] - min[0]) / size) + 1, ny = Math.floor((top[1] - min[1]) / size) + 1;
        const boxes = new Map<number, number[]>();
        for (const i of rows) {
            const px = from.positions[i * 3], py = from.positions[i * 3 + 1], pz = from.positions[i * 3 + 2];
            const key = Math.floor((px - min[0]) / size) + nx * (Math.floor((py - min[1]) / size) + ny * Math.floor((pz - min[2]) / size));
            const own = boxes.get(key);
            if (own) { own[0]++; own[1] += px; own[2] += py; own[3] += pz; own[4] += from.values[i]; own[5] += from.count[i]; own[6] += from.reach[i]; } else boxes.set(key, [1, px, py, pz, from.values[i], from.count[i], from.reach[i]]);
        }
        if (boxes.size > budget && boxes.size > 1) continue;
        for (const [n, sx, sy, sz, sv, c, sr] of boxes.values()) {
            into.positions.push(sx / n, sy / n, sz / n);
            into.values.push(sv / n);
            into.count.push(c);
            into.reach.push(sr / n);
            into.next.push(-1);
            if (n > 1) into.merged += c;
        }
        return;
    }
}

/** A column's samples in order down their holes, ready to be averaged and cut */
export interface Prepared {
    /** Samples with a value and a place */
    count: number;
    /** Their values as assayed, smallest first */
    sorted: Float64Array;
    /** Holes with a sample (0: the hole and depth columns are not known, so nothing can be averaged down a hole) */
    holes: number;
    /** Their names, in the order the places' hole numbers count them */
    holeNames: string[];
    /** The usual length of a sample down its hole, and what one in ten is under and over, m (null: not known) */
    lengths: { usual: number; short: number; long: number } | null;
    /** The longest hole, m */
    longest: number;
    /**
     * Every sample as a place, or their averages over each `used` metres
     * down the hole (each sample counting by its length), no value counting
     * as more than `topCut`. Each place stands for one of what was asked for
     * (`unit`: the averaging length asked for), or for however many of them
     * went into it.
     */
    places(used: number | null, topCut: number | null, unit?: number | null): Places;
}

/** What a choice of averaging and top cut gives: the value of each place, which hole it is in, and the values smallest first. */
export function preparedValues(prepared: Prepared, composite: number | null, topCut: number | null): { value: number[]; hole: number[]; sorted: Float64Array } {
    const p = prepared.places(composite !== null && composite > 0 && prepared.holes > 0 ? composite : null, topCut);
    return { value: p.v, hole: p.hole, sorted: Float64Array.from(p.v).sort() };
}

/** The samples of a column that have a value and a place, in order down each hole. */
export function prepareSamples(samples: ShellSamples): Prepared {
    const { x, y, z, value, hole, from, to } = samples;
    const rows: number[] = [];
    for (let i = 0; i < value.length; i++) {
        if (Number.isFinite(value[i]) && Number.isFinite(x[i]) && Number.isFinite(y[i]) && Number.isFinite(z[i])) rows.push(i);
    }
    const sorted = Float64Array.from(rows, i => value[i]).sort();

    // The samples of each hole in order down it, and how long each one is
    let chains: number[][] | null = null;
    const length = new Map<number, number>();
    let usual = 1, longest = 0;
    let lengths: Prepared['lengths'] = null;
    let holeNames: string[] = [];
    if (hole && from) {
        const byHole = new Map<string, number[]>();
        for (const i of rows) {
            if (!hole[i] || !Number.isFinite(from[i])) continue;
            const own = byHole.get(hole[i]);
            if (own) own.push(i);
            else byHole.set(hole[i], [i]);
        }
        chains = [...byHole.values()];
        holeNames = [...byHole.keys()];
        for (const own of chains) {
            own.sort((p, q) => from[p] - from[q]);
            let total = 0;
            own.forEach((i, k) => {
                // To its To, else to the next sample down the hole
                const end = to && Number.isFinite(to[i]) && to[i] > from[i] ? to[i] : k + 1 < own.length ? from[own[k + 1]] : NaN;
                length.set(i, end - from[i]);
                if (end - from[i] > 0) total += end - from[i];
            });
            longest = Math.max(longest, total);
        }
        const known = [...length.values()].filter(v => v > 0).sort((a, b) => a - b);
        usual = known.length > 0 ? median(known) : 1;
        if (known.length > 0) lengths = { usual, short: known[Math.floor(0.1 * known.length)], long: known[Math.min(known.length - 1, Math.floor(0.9 * known.length))] };
    }
    const lengthOf = (i: number) => (length.get(i)! > 0 ? length.get(i)! : usual);

    const places = (used: number | null, topCut: number | null, unit: number | null = used): Places => {
        const p: Places = { pos: [], v: [], n: [], len: [], hole: [] };
        const cut = topCut !== null && Number.isFinite(topCut) ? topCut : Infinity;
        const valueOf = (i: number) => (value[i] > cut ? cut : value[i]);
        if (!chains) {
            rows.forEach((i, k) => { p.pos.push(x[i], y[i], z[i]); p.v.push(valueOf(i)); p.n.push(1); p.len.push(0); p.hole.push(k); });
            return p;
        }
        chains.forEach((own, h) => {
            if (used === null) {
                for (const i of own) { p.pos.push(x[i], y[i], z[i]); p.v.push(valueOf(i)); p.n.push(1); p.len.push(lengthOf(i)); p.hole.push(h); }
                return;
            }
            let bin = NaN, w = 0, sx = 0, sy = 0, sz = 0, sv = 0, n = 0;
            const flush = () => {
                if (w > 0) {
                    p.pos.push(sx / w, sy / w, sz / w);
                    p.v.push(sv / w);
                    p.n.push(used === unit ? 1 : unit === null ? n : Math.max(1, Math.round(w / unit)));
                    p.len.push(w);
                    p.hole.push(h);
                }
                w = sx = sy = sz = sv = n = 0;
            };
            for (const i of own) {
                const len = lengthOf(i);
                const b = Math.floor((from![i] + len / 2) / used);
                if (b !== bin) { flush(); bin = b; }
                w += len;
                sx += len * x[i];
                sy += len * y[i];
                sz += len * z[i];
                sv += len * valueOf(i);
                n++;
            }
            flush();
        });
        return p;
    };
    return { count: rows.length, sorted, holes: chains ? chains.length : 0, holeNames, lengths, longest, places };
}

/** The places and values a shell at a cut-off is fitted to (see the top of this file). */
export function shellInputs(samples: ShellSamples, choice: ShellChoice): ShellInputs {
    const { cutoff } = choice;
    const max = Math.max(1, choice.max ?? MAX_SHELL_POINTS);
    const prepared = prepareSamples(samples);
    const chains = prepared.holes > 0;
    const usual = prepared.lengths?.usual ?? 1, longest = prepared.longest;
    const topCut = choice.topCut != null && Number.isFinite(choice.topCut) ? choice.topCut : null;
    const capped = topCut === null ? 0 : countAtOrAbove(prepared.sorted, topCut) - countOf(prepared.sorted, topCut);
    const asked = chains && choice.composite != null && choice.composite > 0 ? choice.composite : null;
    const layers = choice.layers && choice.layers.strength > 1 ? choice.layers : null;
    const stretch = layers ? null : choice.stretch ?? null;
    let sorted: Float64Array | null = null;

    for (let used = asked; ; used = (used ?? usual) * 2) {
        const world = prepared.places(used, topCut, asked);
        sorted ??= Float64Array.from(world.v).sort();
        // Distances are measured where the fit is made; the places themselves stay where they are in the ground
        const p: Places = stretch ? { ...world, pos: Array.from(stretchPoints(world.pos, stretch)) } : world;
        const n = p.v.length;
        const high = new Uint8Array(n);
        const highAt: number[] = [];
        for (let i = 0; i < n; i++) {
            if (p.v[i] >= cutoff) { high[i] = 1; highAt.push(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]); }
        }
        const step = chains ? used ?? usual : null;

        // How far the shell may go from each high place: so many times the distance between the holes there
        const factor = choice.reach != null && choice.reach > 0 ? choice.reach : AUTO_REACH;
        const spacing = localSpacing(p, high, step);
        const known = Array.from(spacing).filter(v => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
        // No further apart than nine places in ten are (a far-off hole on its own is no guide), no closer than a sample is long
        let widest = known.length > 0 ? known[Math.min(known.length - 1, Math.floor(0.9 * known.length))] : NaN;
        if (!(widest > 0)) {
            // One hole, or none with another near it: a share of what the high values span, and no less than ten places down the hole
            const min = [Infinity, Infinity, Infinity], top = [-Infinity, -Infinity, -Infinity];
            const of = highAt.length > 0 ? highAt : p.pos;
            for (let i = 0; i < of.length; i++) { min[i % 3] = Math.min(min[i % 3], of[i]); top[i % 3] = Math.max(top[i % 3], of[i]); }
            const span = of.length > 0 ? Math.max(top[0] - min[0], top[1] - min[1], top[2] - min[2]) : 0;
            widest = (Math.max(span / 4, 10 * (step ?? 0)) || 1) / AUTO_REACH;
        }
        const least = Math.min(widest, step ?? 0);
        const reach = new Float64Array(n);
        const highReach: number[] = [];
        for (let i = 0; i < n; i++) {
            if (high[i] === 0) continue;
            reach[i] = factor * Math.min(widest, Math.max(least, Number.isFinite(spacing[i]) ? spacing[i] : widest));
            highReach.push(reach[i]);
        }

        // Which of the others are near enough to a high one to shape the shell
        const near = new Uint8Array(n);
        const grid = new ReachGrid(highAt, highReach.map(r => KEEP_WITHIN * r));
        for (let i = 0; i < n; i++) near[i] = high[i] === 1 || grid.weight(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]) > 0 ? 1 : 0;

        // As they are if they fit; else the runs below the cut-off are averaged, over longer and longer stretches
        let out = thinned(world, high, near, reach, 0);
        for (let merge = 2; chains && out.values.length > max && merge <= MOST_MERGED; merge *= 2) out = thinned(world, high, near, reach, merge * (step ?? 1));
        if (out.values.length > max) {
            // Still too many. Down holes: everything is averaged over a longer stretch, and it starts again
            if (chains && (used ?? usual) * 2 <= Math.max(longest, usual)) continue;
            // No holes to follow (or nothing longer to average over): neighbours are averaged, the high ones apart from the rest
            const isHigh: number[] = [], isLow: number[] = [];
            out.values.forEach((v, i) => (v >= cutoff ? isHigh : isLow).push(i));
            const forHigh = Math.min(isHigh.length, Math.floor(max * 0.6));
            const loose: Thinned = { positions: [], values: [], next: [], count: [], reach: [], merged: out.merged, dropped: out.dropped };
            boxed(isHigh, out, Math.max(1, forHigh), loose);
            if (isLow.length > 0) boxed(isLow, out, Math.max(1, max - forHigh), loose);
            out = loose;
        }
        const arrays = {
            positions: Float64Array.from(out.positions), values: Float64Array.from(out.values), next: Int32Array.from(out.next),
            count: Int32Array.from(out.count), reach: Float64Array.from(out.reach),
        };
        const kept = Array.from(arrays.reach).filter(r => r > 0).sort((a, b) => a - b);
        const at = (share: number) => (kept.length > 0 ? kept[Math.min(kept.length - 1, Math.floor(share * kept.length))] : 0);
        return {
            kind: 'shell', ...arrays, sorted, composite: used, forced: used !== asked, capped, stretch, layers,
            reachFactor: factor, reachRange: [at(0.1), at(0.9)], step,
            high: kept.length, merged: out.merged, dropped: out.dropped,
            holes: prepared.holes,
            mark: markOf(arrays.positions, arrays.values, arrays.next, arrays.reach) + (stretch ? `:${JSON.stringify([stretch.normal, stretch.point, stretch.factor, stretch.second ?? 0])}` : '')
                + (layers ? `:l${markOf(layers.potential.at, layers.potential.axes, layers.potential.heights)}:${layers.potential.range}:${layers.strength}:${layers.block ?? 0}` : ''),
        };
    }
}

/** How many of these sorted values are exactly a value. */
function countOf(sorted: ArrayLike<number>, value: number): number {
    let lo = 0, hi = sorted.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid] <= value) lo = mid + 1;
        else hi = mid;
    }
    return countAtOrAbove(sorted, value) - (sorted.length - lo);
}

/** How many of these sorted values are at or above a cut-off. */
export function countAtOrAbove(sorted: ArrayLike<number>, cutoff: number): number {
    let lo = 0, hi = sorted.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid] < cutoff) lo = mid + 1;
        else hi = mid;
    }
    return sorted.length - lo;
}

/** In a band, no value counts as further above the cut-off than this many times the usual high one */
const BAND_ABOVE = 3;

/**
 * The values as the fit takes them: how far each is above the cut-off
 * (negative: below), in the value's own units or, with `log`, in powers of
 * ten. Logs need a cut-off above zero; values of zero or less count as the
 * smallest value there is above zero.
 *
 * With `band` they are limited to a band about the cut-off: none counts as
 * further below it than the usual high value is above it, nor as more than
 * three times that above it. Between a usual high place and any much lower
 * one, the field then crosses the cut-off halfway; without it, a very low
 * value beside a high one pulls the crossing right up against the high one
 * (the shell round it shrinks to a speck), and a very high one pushes it
 * far out.
 */
export function aboveCutoff(values: ArrayLike<number>, cutoff: number, log: boolean, band = false): Float64Array {
    const out = new Float64Array(values.length);
    if (!log || !(cutoff > 0)) {
        for (let i = 0; i < out.length; i++) out[i] = values[i] - cutoff;
    } else {
        let least = Infinity;
        for (let i = 0; i < values.length; i++) if (values[i] > 0 && values[i] < least) least = values[i];
        if (!Number.isFinite(least)) least = cutoff;
        const level = Math.log10(cutoff);
        for (let i = 0; i < out.length; i++) out[i] = Math.log10(values[i] > 0 ? values[i] : least) - level;
    }
    if (band) {
        const over: number[] = [];
        for (let i = 0; i < out.length; i++) if (out[i] > 0) over.push(out[i]);
        const usual = median(over);
        if (usual > 0) {
            for (let i = 0; i < out.length; i++) out[i] = Math.max(-usual, Math.min(BAND_ABOVE * usual, out[i]));
        }
    }
    return out;
}

/**
 * Each place as a count rather than a value: 1 when it is at or above the
 * cut-off, 0 when it is not, less the share the shell is drawn at. Fitted
 * loosely, the field is then the share of the samples round about that are
 * at or above the cut-off, and it is zero where that share is `share`. One
 * extreme value counts for no more than any other high one.
 */
export function indicatorValues(values: ArrayLike<number>, cutoff: number, share: number): Float64Array {
    const out = new Float64Array(values.length);
    for (let i = 0; i < out.length; i++) out[i] = values[i] >= cutoff ? 1 - share : -share;
    return out;
}

/**
 * A shell found by counting is drawn where this share of the samples round
 * about are at or above the cut-off, about this many each way counting as
 * round about. Measured on erratic gold in close-spaced holes: a zone a
 * dozen samples thick, two in three of them high, comes out whole and about
 * its true size, and high samples alone in waste are left out. At a half,
 * such a zone loses its edges; with more samples together, thin zones go.
 */
export const DEFAULT_SHARE = 0.4;
export const DEFAULT_LOCAL = 3;

/**
 * What a shell's rule makes of the places' values for the fit: how far
 * each is above the cut-off, or (found by counting) whether it is, less the
 * share the shell is drawn at. `local` and `background` are `ShellInput`'s.
 */
export function shellFitting(rule: Pick<ShellRule, 'cutoff' | 'log' | 'band' | 'method' | 'share' | 'local'>, values: ArrayLike<number>): { values: Float64Array; local: number | null; background: number | null } {
    // Built from intercepts, a place is in one (1) or not (0), and the shell is halfway between
    if (rule.method === 'intercepts') return { values: indicatorValues(values, 0.5, 0.5), local: null, background: -0.5 };
    if (rule.method !== 'indicator') return { values: aboveCutoff(values, rule.cutoff, rule.log, rule.band), local: null, background: null };
    const share = rule.share ?? DEFAULT_SHARE;
    return { values: indicatorValues(values, rule.cutoff, share), local: rule.local ?? DEFAULT_LOCAL, background: -share };
}

/**
 * Where a shell may be: within its reach of a place whose value is at or
 * above the cut-off (`values`: how far above, as `aboveCutoff` gives them;
 * `reach`: one per place). Beyond that the field is `background`: when not
 * given, a value as far below the cut-off as the usual high place is above
 * it.
 */
export function shellCap(positions: ArrayLike<number>, values: ArrayLike<number>, reach: ArrayLike<number>, background: number | null = null): FieldCap {
    const at: number[] = [], far: number[] = [], over: number[] = [];
    for (let i = 0; i < values.length; i++) {
        if (!(values[i] >= 0) || !(reach[i] > 0)) continue;
        at.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
        far.push(reach[i]);
        if (values[i] > 0) over.push(values[i]);
    }
    return { positions: Float64Array.from(at), reach: Float64Array.from(far), background: background !== null && background < 0 ? background : -(median(over) || 1) };
}

export interface ShellInput {
    positions: ArrayLike<number>;
    /** How far each place's value is above the cut-off (`aboveCutoff`) */
    values: ArrayLike<number>;
    next: ArrayLike<number>;
    /** How far the shell may go from each place, m (0 for a place below the cut-off) */
    reach: ArrayLike<number>;
    /** The field is fitted everywhere in this box (it holds the places) */
    cover: Box3;
    /** Fit it in space stretched across the structure it follows; the reach is measured there (null: as it is) */
    stretch?: Stretch | null;
    /** Fit it along the ground as it lies from place to place (`stretch` is then not used) */
    layers?: ShellLayers | null;
    /** 0 = through every value; larger = looser */
    smoothing?: number;
    /**
     * How loosely it is fitted, in samples: about this many each way down a hole are taken together
     * (takes the place of `smoothing`). The length that comes to is measured in the space the fit is made in
     */
    local?: number | null;
    /** The field's value out of reach of every high place (null: as far below as the usual high place is above) */
    background?: number | null;
    /** false: the places on the shell that a mesh starts from are not looked for (the field alone is wanted) */
    seeds?: boolean;
}

/** Halvings to find where the field crosses the cut-off between two places */
const HALVINGS = 10;
/** Steps along each line looked along from the end of a hole's run of high values */
const RAY_STEPS = 4;
/** Lines are looked along from at most this many places */
const MAX_RAYS = 4000;
const AXES: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/**
 * Places on the shell for the mesher to start from: where the field crosses
 * the cut-off between one place and the next down a hole; and, for a high
 * place with no place beyond it (the end of a hole, a sample on its own),
 * along lines out from it as far as the shell may reach.
 */
function shellSeeds(field: FittedField, input: ShellInput): Float64Array {
    const a: number[] = [], b: number[] = [];
    const n = Math.floor(input.positions.length / 3);
    const led = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        const j = input.next[i];
        if (j < 0) continue;
        led[j] = 1;
        a.push(input.positions[i * 3], input.positions[i * 3 + 1], input.positions[i * 3 + 2]);
        b.push(input.positions[j * 3], input.positions[j * 3 + 1], input.positions[j * 3 + 2]);
    }
    const ends: number[] = [];
    for (let i = 0; i < n; i++) if (input.values[i] >= 0 && (input.next[i] < 0 || led[i] === 0)) ends.push(i);
    const every = Math.max(1, Math.ceil(ends.length / MAX_RAYS));
    for (let e = 0; e < ends.length; e += every) {
        const i = ends[e] * 3;
        const stride = input.reach[ends[e]] / RAY_STEPS;
        const px = input.positions[i], py = input.positions[i + 1], pz = input.positions[i + 2];
        for (const [dx, dy, dz] of AXES) {
            for (let s = 0; s < RAY_STEPS; s++) {
                a.push(px + dx * stride * s, py + dy * stride * s, pz + dz * stride * s);
                b.push(px + dx * stride * (s + 1), py + dy * stride * (s + 1), pz + dz * stride * (s + 1));
            }
        }
    }
    const fa = evaluateField(field, a), fb = evaluateField(field, b);
    // Keep the pairs with the cut-off between them, then close in on it by halving
    const lo: number[] = [], hi: number[] = [], sign: number[] = [];
    for (let s = 0; s < fa.length; s++) {
        if (!(fa[s] * fb[s] < 0)) continue;
        lo.push(a[s * 3], a[s * 3 + 1], a[s * 3 + 2]);
        hi.push(b[s * 3], b[s * 3 + 1], b[s * 3 + 2]);
        sign.push(Math.sign(fa[s]));
    }
    for (let round = 0; round < HALVINGS && sign.length > 0; round++) {
        const mid = lo.map((v, q) => (v + hi[q]) / 2);
        const fm = evaluateField(field, mid);
        for (let s = 0; s < sign.length; s++) {
            const target = fm[s] * sign[s] > 0 ? lo : hi;
            for (let k = 0; k < 3; k++) target[s * 3 + k] = mid[s * 3 + k];
        }
    }
    return Float64Array.from(lo.map((v, q) => (v + hi[q]) / 2));
}

/**
 * The usual distance from a place at or above the cut-off to the next place
 * down its hole (those are as sampled; lower ones further off may have been
 * averaged together). Without holes: a twentieth of the usual reach.
 */
function sampleStep(seen: ArrayLike<number>, input: ShellInput): number {
    const steps: number[] = [], reaches: number[] = [];
    for (let i = 0; i < input.values.length; i++) {
        if (!(input.values[i] >= 0)) continue;
        if (input.reach[i] > 0) reaches.push(input.reach[i]);
        const j = input.next[i];
        if (j >= 0) steps.push(Math.hypot(seen[i * 3] - seen[j * 3], seen[i * 3 + 1] - seen[j * 3 + 1], seen[i * 3 + 2] - seen[j * 3 + 2]));
    }
    return median(steps.filter(v => v > 0)) || median(reaches) / 20 || 1;
}

/**
 * Fit a shell's field: positive inside (at or above the cut-off), negative
 * outside. `status` is 'body' when there is a shell, 'empty' when no value
 * reaches the cut-off or every value does.
 */
export function fitShell(input: ShellInput): SheetFit {
    const none: SheetFit = { status: 'empty', trend: null, field: null, onSurface: new Float64Array(0), stats: null, lineSigns: new Int8Array(0) };
    let above = 0, below = 0;
    for (let i = 0; i < input.values.length; i++) {
        if (input.values[i] >= 0) above++;
        else below++;
    }
    if (above === 0 || below === 0) return none;
    // Everything the field is made of is in the space the fit is made in
    const layers = input.layers && input.layers.strength > 1 ? input.layers : null;
    const stretch = layers ? null : input.stretch ?? null;
    const seen = stretch ? stretchPoints(input.positions, stretch) : input.positions;
    // Along the ground from place to place: every place has its height through the layers as one more coordinate
    let layering: Layering | null = null, extra: Float64Array | null = null;
    if (layers) {
        // (Read from a lattice over every place the fit is made of, and as far as the shell may go from the high ones)
        const box: Box3 = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
        for (let i = 0; i * 3 + 2 < input.positions.length; i++) {
            const r = input.reach[i] > 0 ? input.reach[i] : 0;
            for (let k = 0; k < 3; k++) {
                box.min[k] = Math.min(box.min[k], input.positions[i * 3 + k] - r);
                box.max[k] = Math.max(box.max[k], input.positions[i * 3 + k] + r);
            }
        }
        layering = { ...heightLattice(layers.potential, box), weight: Math.sqrt(layers.strength * layers.strength - 1) };
        extra = layerCoordinate(layering, input.positions);
    }
    // A looseness given in samples: the fit's own is a length, in units of half the places' extent. Down a hole
    // a looseness of length L spreads each sample's say over about sqrt(L x step / 2) either way (it is a
    // smoothing spline there), so n samples each way take a length of 2 n x n steps
    let smoothing = input.smoothing;
    if (input.local != null && input.local > 0) {
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < seen.length; i++) {
            if (seen[i] < min[i % 3]) min[i % 3] = seen[i];
            if (seen[i] > max[i % 3]) max[i % 3] = seen[i];
        }
        const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
        smoothing = extent > 0 ? 2 * input.local * input.local * sampleStep(seen, input) / (extent / 2) : 0;
    }
    const fit = fitBlended(seen, input.values, {
        smoothing, cover: stretch ? stretchedBox(input.cover, stretch) : input.cover, drift: 'level',
        ...(extra ? { extra, block: layers!.block } : {}),
    });
    if (!fit.ok) return { ...none, status: 'failed' };
    const cap = shellCap(seen, input.values, input.reach, input.background ?? null);
    // (The cap's places are the high ones alone: each has its own extra coordinate)
    const field: FittedField = { ...fit.field, cap: layering ? { ...cap, extra: layerCoordinate(layering, cap.positions) } : cap, ...(stretch ? { stretch } : {}), ...(layering ? { layering } : {}) };
    return { status: 'body', trend: null, field, onSurface: input.seeds === false ? new Float64Array(0) : shellSeeds(field, input), stats: fit.stats, lineSigns: new Int8Array(0) };
}

/** How a shell sits against the samples it was fitted to (counted in samples, not places) */
export interface ShellCounts {
    /** Samples at or above the cut-off, and how many of them are inside the shell */
    high: number;
    inside: number;
    /** Samples below the cut-off that are inside it all the same */
    lowInside: number;
    /** Samples inside it that stand so much alone that their part of the shell is smaller than a mesh cell: not drawn */
    small: number;
}

/**
 * Count the fitted places against the shell. `origin` and `cell`: the grid
 * the shell is drawn on (a high place none of whose cell's corners is inside
 * has nothing drawn round it).
 */
export function shellCounts(field: FittedField, positions: ArrayLike<number>, values: ArrayLike<number>, count: ArrayLike<number>, origin: Vec3, cell: number): ShellCounts {
    const out: ShellCounts = { high: 0, inside: 0, lowInside: 0, small: 0 };
    const f = evaluateField(field, positions);
    const corners: number[] = [], owner: number[] = [];
    for (let i = 0; i < f.length; i++) {
        const c = count[i] ?? 1;
        if (!(values[i] >= 0)) {
            if (f[i] >= 0) out.lowInside += c;
            continue;
        }
        out.high += c;
        if (!(f[i] >= 0)) continue;
        out.inside += c;
        if (!(cell > 0)) continue;
        const base = [0, 1, 2].map(k => origin[k] + Math.floor((positions[i * 3 + k] - origin[k]) / cell) * cell);
        for (let q = 0; q < 8; q++) corners.push(base[0] + (q & 1) * cell, base[1] + ((q >> 1) & 1) * cell, base[2] + ((q >> 2) & 1) * cell);
        owner.push(i);
    }
    const g = evaluateField(field, corners);
    owner.forEach((i, k) => {
        let any = false;
        for (let q = 0; q < 8 && !any; q++) any = g[k * 8 + q] >= 0;
        if (!any) out.small += count[i] ?? 1;
    });
    return out;
}
