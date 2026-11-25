/**
 * A hole read as a pile of layers (pure, unit-tested).
 *
 * Layers laid down one on another are met once along a hole: going down it
 * they only get older (or, in a hole drilled from underneath or through
 * overturned ground, only younger). Logging is rarely that tidy: a stray
 * interval, a lens, a unit that comes back. Taken as logged, every such
 * change of unit is a contact, and the surface between two layers is pulled
 * through all of them.
 *
 * Read as a pile, the hole keeps the heaviest set of stretches that are in
 * order (`pileOfHole`): going down it, or from the bottom up when that
 * matches clearly more (UP_MARGIN).
 * A stretch that is out of order is then read as the layer round it (the
 * same layer kept above and below it) or left out (between two layers: the
 * contact falls inside it). So each contact of the pile is met at most once
 * in a hole, and all the contacts of a pile agree with one another.
 *
 * The same reading gives the most of the logging a pile of layers can match
 * (contactMatrix.ts `bestAgreement`): what it keeps is what a model of
 * those layers can have right.
 */

import type { HoleLog } from './contacts';
import { bestFitPlane } from './plane';
import type { BodyRule, ContactRule } from './types';

type Text = string | null | undefined;

/**
 * A hole is read from the bottom up only when that keeps more of it than
 * reading it down does by over this share of its layers' metres. Layers
 * that get younger down a hole are overturned or drilled from underneath:
 * a few stray metres are not reason enough to say so, and a contact turned
 * over in one hole folds the whole surface there.
 */
export const UP_MARGIN = 0.2;

export interface PileOfHole {
    /** Per run: 1 when it is kept (in order), 0 when it is out of order */
    kept: Uint8Array;
    /** The metres kept */
    metres: number;
    /** The runs were given from the top down, and the layers get younger going down: the hole is read from its bottom up */
    up: boolean;
}

/**
 * The heaviest set of a hole's runs that are in order. `rank`: per run, from
 * the top of the hole down, its layer's place in the pile (0 the youngest;
 * negative: not a layer, passed over); `length`: its metres. The hole is
 * read downwards unless upwards keeps more.
 */
export function pileOfHole(rank: ArrayLike<number>, length: ArrayLike<number>, layers: number): PileOfHole {
    const m = rank.length, n = Math.max(1, layers);
    const read = (up: boolean) => {
        const f = new Float64Array(n), last = new Int32Array(n).fill(-1), prev = new Int32Array(m).fill(-1);
        for (let s = 0; s < m; s++) {
            const i = up ? m - 1 - s : s, r = rank[i];
            if (r < 0 || r >= n) continue;
            let best = 0, from = -1;
            // (As much either way: the chain that is already in the older layer. Once a hole is in a layer, a little of the one above further on is the stray)
            for (let q = 0; q <= r; q++) if (last[q] >= 0 && (from < 0 || f[q] >= best)) { best = f[q]; from = last[q]; }
            if (last[r] < 0 || best + length[i] > f[r]) { f[r] = best + length[i]; last[r] = i; prev[i] = from; }
        }
        let end = -1, best = -1;
        for (let q = 0; q < n; q++) if (last[q] >= 0 && f[q] > best) { best = f[q]; end = last[q]; }
        return { end, prev, metres: Math.max(0, best) };
    };
    const down = read(false), upward = read(true);
    let total = 0;
    for (let i = 0; i < m; i++) if (rank[i] >= 0 && rank[i] < n) total += length[i];
    const pick = upward.metres > down.metres + UP_MARGIN * total + 1e-9 ? upward : down;
    const kept = new Uint8Array(m);
    for (let i = pick.end; i >= 0; i = pick.prev[i]) kept[i] = 1;
    return { kept, metres: pick.metres, up: pick === upward };
}

export interface PileRead {
    /** Every row's unit as the pile reads it: a row of a layer out of order is of the layer round it, or '' (left out); other rows are as they were */
    code: string[];
    /** Metres of the layers, and of those the metres not read as logged */
    metres: number;
    changed: number;
    /** Holes with a layer in them, and of those the holes read from the bottom up */
    holes: number;
    up: number;
    /** Holes whose reading was changed by where the holes round them have the contacts */
    moved: number;
}

/** The holes nearest a hole that say where a contact is expected in it */
export const NEIGHBOURS = 6;
/**
 * What a metre off where the neighbouring holes have a contact weighs
 * against a metre of logging. At a half, a hole's own logging moves a
 * contact away from where its neighbours have it only with more metres
 * behind it than half the distance moved.
 */
export const NEIGHBOUR_WEIGHT = 0.5;

type Place = [number, number, number];
interface Run { rank: number; rows: number[]; length: number }
interface HoleRead {
    /** The runs in the order the hole is read (getting older) */
    runs: Run[];
    kept: Uint8Array;
    up: boolean;
    /** Where the hole is (the middle of its rows), and between run k - 1 and run k (`between[k]`, k >= 1); null without places */
    at: Place | null;
    between: (Place | null)[];
    /** The layer each run is read as (-1: left out) */
    as: Int32Array;
}

/** The first reading of a hole's runs: kept as logged, of the layer kept round it, or left out */
function firstReading(runs: readonly Run[], kept: Uint8Array): Int32Array {
    const as = new Int32Array(runs.length).fill(-1);
    const before = new Int32Array(runs.length).fill(-1), after = new Int32Array(runs.length).fill(-1);
    for (let k = 0, was = -1; k < runs.length; k++) { before[k] = was; if (kept[k]) was = runs[k].rank; }
    for (let k = runs.length - 1, was = -1; k >= 0; k--) { after[k] = was; if (kept[k]) was = runs[k].rank; }
    runs.forEach((run, k) => { as[k] = kept[k] ? run.rank : before[k] >= 0 && before[k] === after[k] ? before[k] : -1; });
    return as;
}

/**
 * A hole read again, with where its neighbours have each contact weighed in.
 * Every run is given a layer, the layers only getting older; a run counts
 * its metres when it is given its own layer, and each contact crossed
 * between two runs costs its distance from where it is expected there
 * (`off(k, i)`: contact i between run k - 1 and run k; 0 when nothing is
 * expected), times NEIGHBOUR_WEIGHT. The best such reading.
 */
function readWithNeighbours(runs: readonly Run[], layers: number, off: (k: number, i: number) => number): Int32Array {
    const m = runs.length, n = layers;
    const from = new Int32Array(m * n).fill(-1);
    let v = new Float64Array(n), next = new Float64Array(n);
    for (let l = 0; l < n; l++) v[l] = runs[0].rank === l ? runs[0].length : 0;
    const cost = new Float64Array(n + 1);
    for (let k = 1; k < m; k++) {
        // (cost[i]: what crossing the contacts 0 .. i - 1 here costs)
        cost[0] = 0;
        for (let i = 0; i < n - 1; i++) cost[i + 1] = cost[i] + NEIGHBOUR_WEIGHT * off(k, i);
        for (let l = 0; l < n; l++) {
            let best = -Infinity, at = 0;
            // (As much either way: from the older layer, as in the first reading)
            for (let a = 0; a <= l; a++) { const score = v[a] - (cost[l] - cost[a]); if (score >= best) { best = score; at = a; } }
            next[l] = best + (runs[k].rank === l ? runs[k].length : 0);
            from[k * n + l] = at;
        }
        [v, next] = [next, v];
    }
    let end = 0;
    for (let l = 1; l < n; l++) if (v[l] >= v[end]) end = l;
    const as = new Int32Array(m);
    for (let k = m - 1, l = end; k >= 0; k--) { as[k] = l; if (k > 0) l = from[k * n + l]; }
    return as;
}

/**
 * A log read as a pile. `pile`: the layers, the youngest first. `log.code`:
 * each row's unit; rows of units that are not layers of the pile are passed
 * over and left as they are. `log.z`: where the rows are, so that a hole
 * that climbs is taken from its top.
 *
 * Each hole is first read by itself (`pileOfHole`). With the rows' places
 * (`log.x`, `log.y`, `log.z`) it is then read again against its neighbours:
 * for each contact a plane is put through where the NEIGHBOURS nearest
 * other holes have it, and the hole is given the reading that keeps the
 * most of its logging less how far it puts its contacts from those planes
 * (`readWithNeighbours`). So one hole with a stretch logged as the layer
 * below does not pull the contact up to it when the holes round it have it
 * lower, unless that stretch is long.
 */
export function pileRead(
    log: { hole: ArrayLike<Text>; from: ArrayLike<number>; to: ArrayLike<number> | null; code: ArrayLike<Text>; x?: ArrayLike<number>; y?: ArrayLike<number>; z?: ArrayLike<number> },
    pile: readonly string[],
): PileRead {
    const n = log.from.length;
    const code = new Array<string>(n);
    for (let i = 0; i < n; i++) code[i] = (log.code[i] ?? '').trim();
    const rankOf = new Map(pile.map((u, k) => [u, k]));
    const byHole = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
        const hole = log.hole[i];
        if (!hole || !Number.isFinite(log.from[i]) || !rankOf.has(code[i])) continue;
        let rows = byHole.get(hole);
        if (!rows) byHole.set(hole, rows = []);
        rows.push(i);
    }
    const placed = !!log.x && !!log.y && !!log.z;
    const place = (i: number): Place | null => {
        const q: Place = [log.x![i], log.y![i], log.z![i]];
        return Number.isFinite(q[0]) && Number.isFinite(q[1]) && Number.isFinite(q[2]) ? q : null;
    };
    const mid = (a: Place | null, b: Place | null): Place | null => (a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] : null);

    // --- each hole by itself ---
    const holes: HoleRead[] = [];
    for (const rows of byHole.values()) {
        rows.sort((a, b) => log.from[a] - log.from[b]);
        const runs: Run[] = [];
        rows.forEach((i, k) => {
            const to = log.to ? log.to[i] : NaN;
            const end = Number.isFinite(to) && to > log.from[i] ? to : k + 1 < rows.length ? log.from[rows[k + 1]] : log.from[i];
            const length = Math.max(0, end - log.from[i]);
            const rank = rankOf.get(code[i])!;
            const last = runs[runs.length - 1];
            if (last && last.rank === rank) { last.rows.push(i); last.length += length; } else runs.push({ rank, rows: [i], length });
        });
        // (A hole that climbs: its far end is its top)
        const z0 = log.z ? log.z[rows[0]] : NaN, z1 = log.z ? log.z[rows[rows.length - 1]] : NaN;
        if (Number.isFinite(z0) && Number.isFinite(z1) && z1 > z0) { runs.reverse(); for (const r of runs) r.rows.reverse(); }
        const read = pileOfHole(runs.map(r => r.rank), runs.map(r => r.length), pile.length);
        // In the order it is read: the layers getting older
        let kept = read.kept;
        if (read.up) { runs.reverse(); for (const r of runs) r.rows.reverse(); kept = Uint8Array.from(kept).reverse(); }
        let at: Place | null = null;
        const between: (Place | null)[] = runs.map(() => null);
        if (placed) {
            const sum = [0, 0, 0];
            let count = 0;
            for (const i of rows) { const q = place(i); if (q) { sum[0] += q[0]; sum[1] += q[1]; sum[2] += q[2]; count++; } }
            at = count ? [sum[0] / count, sum[1] / count, sum[2] / count] : null;
            for (let k = 1; k < runs.length; k++) between[k] = mid(place(runs[k - 1].rows[runs[k - 1].rows.length - 1]), place(runs[k].rows[0]));
        }
        holes.push({ runs, kept, up: read.up, at, between, as: firstReading(runs, kept) });
    }

    // --- where each hole has each contact, by itself: between two stretches kept, of layers either side of it ---
    let moved = 0;
    if (placed && pile.length > 1) {
        const seen: { hole: number; p: Place }[][] = pile.slice(1).map(() => []);
        holes.forEach((h, index) => {
            let before = -1;
            for (let q = 0; q < h.runs.length; q++) {
                if (!h.kept[q]) continue;
                if (before >= 0 && h.runs[before].rank < h.runs[q].rank) {
                    const where = q === before + 1 ? h.between[q] : mid(h.between[before + 1], h.between[q]);
                    if (where) for (let i = h.runs[before].rank; i < h.runs[q].rank; i++) seen[i].push({ hole: index, p: where });
                }
                before = q;
            }
        });
        // --- each hole again, against the planes through its neighbours' contacts ---
        holes.forEach((h, index) => {
            if (h.runs.length < 2 || !h.at) return;
            const here = h.at;
            const planes = seen.map(list => {
                const near = list.filter(c => c.hole !== index)
                    .map(c => ({ c, d: Math.hypot(c.p[0] - here[0], c.p[1] - here[1], c.p[2] - here[2]) }))
                    .sort((a, b) => a.d - b.d).slice(0, NEIGHBOURS);
                if (near.length < 3) return null;
                const plane = bestFitPlane(near.flatMap(x => x.c.p));
                // (Contacts in a line say nothing of where the plane lies to either side of it)
                return plane && plane.spread[1] > 0.05 * plane.spread[0] && plane.spread[1] > 1e-6 ? plane : null;
            });
            if (planes.every(pl => !pl)) return;
            const off = (k: number, i: number) => {
                const pl = planes[i], b = h.between[k];
                return pl && b ? Math.abs((b[0] - pl.point[0]) * pl.normal[0] + (b[1] - pl.point[1]) * pl.normal[1] + (b[2] - pl.point[2]) * pl.normal[2]) : 0;
            };
            const label = readWithNeighbours(h.runs, pile.length, off);
            const as = new Int32Array(h.runs.length).fill(-1);
            // The contacts crossed between run k - 1 and run k all have a plane to go by
            const told = (k: number) => {
                for (let i = label[k - 1]; i < label[k]; i++) if (!planes[i]) return false;
                return true;
            };
            h.runs.forEach((run, k) => {
                if (run.rank === label[k]) { as[k] = run.rank; return; }
                // Out of order. Inside one layer: of that layer. At a contact: on the side the neighbours put it, where they say; else left out
                if (k === 0 || k === h.runs.length - 1) return;
                if ((label[k - 1] === label[k] || told(k)) && (label[k + 1] === label[k] || told(k + 1))) as[k] = label[k];
            });
            if (as.some((a, k) => a !== h.as[k])) { moved++; h.as = as; }
        });
    }

    let metres = 0, changed = 0, up = 0;
    for (const h of holes) {
        if (h.up) up++;
        h.runs.forEach((run, k) => {
            metres += run.length;
            if (h.as[k] === run.rank) return;
            changed += run.length;
            for (const i of run.rows) code[i] = h.as[k] >= 0 ? pile[h.as[k]] : '';
        });
    }
    return { code, metres, changed, holes: byHole.size, up, moved };
}

/** A log as a surface's rule reads it: as a pile when the rule is a contact of one, else as it is. `read`: what the pile changed (null: not a pile) */
export function ruleLog(log: HoleLog, rule: ContactRule | BodyRule): { log: HoleLog; read: PileRead | null } {
    if (rule.kind !== 'contact' || !rule.pile || rule.pile.length < 2) return { log, read: null };
    const read = pileRead(log, rule.pile);
    return { log: { ...log, code: read.code }, read };
}
