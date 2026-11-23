/**
 * A unit that comes back down the holes: occurrences (pure, unit-tested).
 *
 * Read as a pile (pile.ts) a layer is met once along a hole. A unit that is
 * truly in the pile several times (basalt, sediment, basalt) cannot be
 * matched by that: all but the heaviest of its stretches in a hole are out
 * of order, and are read as the layer round them or left out.
 *
 * Here a pile may hold a unit at several places ("slots"): each is an
 * occurrence of it, and a layer of its own. `proposeOccurrences` looks for
 * the places that let a pile match clearly more of the logging;
 * `tagOccurrences` says which occurrence each stretch of the unit is, hole
 * by hole and then against where the holes round it have the contacts, so
 * that a hole which meets the unit once is given the occurrence its
 * neighbours have there.
 */

import { passOver, proposeOrder, type LoggedRuns } from './contactMatrix';
import { NEIGHBOURS, NEIGHBOUR_WEIGHT, UP_MARGIN } from './pile';
import { bestFitPlane } from './plane';
import type { ModelUnit } from './types';
import type { Regrouped } from './units';

type Text = string | null | undefined;
type Place = [number, number, number];

/** Between two readings of a hole that match as many metres, the one that passes over fewer places of the pile is taken */
const SKIP_COST = 1e-6;

/** Per unit: its places in the pile (the youngest first), none when it is not in it */
function slotsOf(units: readonly string[], pile: readonly string[]): number[][] {
    return units.map(u => pile.flatMap((p, s) => (p === u ? [s] : [])));
}

interface SlotRead {
    /** Per run: the place in the pile it is read at, -1 when it is out of order or not in the pile */
    as: Int32Array;
    metres: number;
    /** The runs were given from the top down, and the layers get younger going down: read from the bottom up */
    up: boolean;
}

/**
 * The heaviest set of a hole's runs that are in order, in a pile whose
 * units may be at several places: as `pileOfHole` (pile.ts), with each run
 * free to be at any of its unit's places.
 */
function readSlots(unit: ArrayLike<number>, length: ArrayLike<number>, slots: readonly number[][], n: number): SlotRead {
    const m = unit.length;
    const read = (up: boolean) => {
        const f = new Float64Array(n), got = new Float64Array(n), end = new Int32Array(n).fill(-1);
        const prevRun = new Int32Array(m * n).fill(-1), prevSlot = new Int32Array(m * n).fill(-1);
        const cand: { r: number; score: number; metres: number; run: number; slot: number }[] = [];
        for (let s = 0; s < m; s++) {
            const i = up ? m - 1 - s : s, options = slots[unit[i]];
            if (!options || !options.length) continue;
            cand.length = 0;
            for (const r of options) {
                let best = 0, metres = 0, run = -1, slot = -1;
                for (let q = 0; q <= r; q++) {
                    if (end[q] < 0) continue;
                    const score = f[q] - SKIP_COST * Math.max(0, r - q - 1);
                    if (run < 0 || score >= best) { best = score; metres = got[q]; run = end[q]; slot = q; }
                }
                cand.push({ r, score: best + length[i], metres: metres + length[i], run, slot });
            }
            for (const c of cand) {
                if (end[c.r] >= 0 && c.score <= f[c.r]) continue;
                f[c.r] = c.score; got[c.r] = c.metres; end[c.r] = i;
                prevRun[i * n + c.r] = c.run; prevSlot[i * n + c.r] = c.slot;
            }
        }
        let last = -1;
        for (let q = 0; q < n; q++) if (end[q] >= 0 && (last < 0 || f[q] > f[last])) last = q;
        const as = new Int32Array(m).fill(-1);
        for (let i = last < 0 ? -1 : end[last], r = last; i >= 0;) {
            as[i] = r;
            const pi = prevRun[i * n + r], pr = prevSlot[i * n + r];
            i = pi; r = pr;
        }
        return { as, metres: last < 0 ? 0 : got[last] };
    };
    const down = read(false), upward = read(true);
    let total = 0;
    for (let i = 0; i < m; i++) if (slots[unit[i]]?.length) total += length[i];
    const up = upward.metres > down.metres + UP_MARGIN * total + 1e-9;
    return { ...(up ? upward : down), up };
}

/** As contactMatrix.ts: between piles that match as much, the one with less hole read from the bottom up */
const UP_COST = 0.001;

/** The most metres a pile can match, its units at one place or several (the layers' metres in order, every hole read whichever way matches more) */
export function slotsAgreement(runs: LoggedRuns, pile: readonly string[], upCost = 0): number {
    const slots = slotsOf(runs.units, pile);
    let sum = 0;
    for (const h of runs.holes) { const read = readSlots(h.unit, h.length, slots, pile.length); sum += read.up ? read.metres * (1 - upCost) : read.metres; }
    return sum;
}

/** An occurrence is met in this many holes at least ... */
export const OCCURRENCE_HOLES = 3;
/** ... and in this share at least of the holes that pass through its place in the pile (they meet a layer above it and one below) */
export const OCCURRENCE_THROUGH = 0.5;
/** A unit is said to come back only where that lets a pile match this share more of the unit's metres */
export const OCCURRENCE_GAIN = 0.2;
/** No more places than this are added to a pile */
const MAX_ADDED = 8;
/** ... in no more steps than this (a place added, or a place moved) */
const MAX_STEPS = 40;
/** The search starts from the order given and from what this many of the longest holes show */
const START_HOLES = 6;

export interface OccurrenceCount {
    /** Holes it is met in; holes that pass through its place; and of those the holes it is met in */
    met: number;
    through: number;
    metThrough: number;
}

/** The metres of a unit down the holes */
function metresIn(runs: LoggedRuns, unit: string): number {
    const k = runs.units.indexOf(unit);
    let sum = 0;
    for (const h of runs.holes) for (let i = 0; i < h.unit.length; i++) if (h.unit[i] === k) sum += h.length[i];
    return sum;
}

/**
 * The metres of a unit that are not in its longest stretch of each hole:
 * about the most that reading it as several layers could add to what a
 * pile matches. (As one layer a hole keeps its stretches of the unit or
 * what lies between them, whichever is more: what several layers add is
 * the less of the two, and the unit's further stretches are no less.)
 */
function metresBack(runs: LoggedRuns, unit: string): number {
    const k = runs.units.indexOf(unit);
    let sum = 0;
    for (const h of runs.holes) {
        let all = 0, longest = 0;
        for (let i = 0; i < h.unit.length; i++) if (h.unit[i] === k) { all += h.length[i]; if (h.length[i] > longest) longest = h.length[i]; }
        sum += all - longest;
    }
    return sum;
}

/** Per place of a pile: the holes that meet it and the holes that pass through its place, as the pile reads them */
export function occurrenceCounts(runs: LoggedRuns, pile: readonly string[]): OccurrenceCount[] {
    const n = pile.length, slots = slotsOf(runs.units, pile);
    const out: OccurrenceCount[] = pile.map(() => ({ met: 0, through: 0, metThrough: 0 }));
    const has = new Uint8Array(n);
    for (const h of runs.holes) {
        const read = readSlots(h.unit, h.length, slots, n);
        has.fill(0);
        let first = n, last = -1;
        for (const s of read.as) if (s >= 0) { has[s] = 1; if (s < first) first = s; if (s > last) last = s; }
        for (let s = 0; s < n; s++) {
            if (has[s]) out[s].met++;
            // (The top of the pile has nothing above it: a hole passes through it when it meets something below. The oldest
            // place has nothing under it: the holes that meet the place above it are those that could have gone on into it)
            const through = s === n - 1 ? s > 0 && has[s - 1] === 1 : last > s && (s === 0 || first < s);
            if (through) { out[s].through++; if (has[s]) out[s].metThrough++; }
        }
    }
    return out;
}

export interface OccurrenceProposal {
    /** The pile, the youngest first, with each unit that comes back at every place it is proposed at */
    pile: string[];
    /** The units proposed as several occurrences, with what says so */
    units: { unit: string; times: number; gain: number; of: number; counts: OccurrenceCount[] }[];
    /** Metres a pile can match: as it was, and with the occurrences */
    before: number;
    after: number;
}

/**
 * The occurrences the logging says a pile's units have. `layers`: the pile,
 * the youngest first, each unit once; `runs`: its logging, units that cut
 * across passed over. One step at a time, the step that lets the pile match
 * most is taken: a place added for a unit, or a place moved. A step is
 * taken only when every occurrence of every unit that is then in the pile
 * more than once is met in OCCURRENCE_HOLES holes and in OCCURRENCE_THROUGH
 * of the holes that pass through its place (for the oldest place of the
 * pile: of the holes that meet the place above it). At the end a unit whose places together gain under
 * OCCURRENCE_GAIN of its metres is put back as one layer. Null: no unit
 * comes back.
 */
export function proposeOccurrences(runs: LoggedRuns, layers: readonly string[]): OccurrenceProposal | null {
    const score = (pile: readonly string[]) => slotsAgreement(runs, pile, UP_COST);
    const times = (pile: readonly string[], unit: string) => pile.reduce((a, u) => a + (u === unit ? 1 : 0), 0);
    // (Two places of a unit with nothing between them are one)
    const tidy = (pile: readonly string[]) => pile.filter((u, k) => k === 0 || pile[k - 1] !== u);
    /** The place of a unit that is in the pile more than once and is met least for it to be an occurrence; -1: every one holds */
    const failing = (pile: readonly string[]): number => {
        if (pile.length === new Set(pile).size) return -1;
        const counts = occurrenceCounts(runs, pile);
        let worst = -1;
        for (let s = 0; s < pile.length; s++) {
            if (times(pile, pile[s]) < 2) continue;
            const c = counts[s];
            if ((c.met < OCCURRENCE_HOLES || (c.through > 0 && c.metThrough < OCCURRENCE_THROUGH * c.through)) && (worst < 0 || c.met < counts[worst].met)) worst = s;
        }
        return worst;
    };
    /** A unit put back as one layer: at the place of its own that then matches most */
    const asOne = (pile: readonly string[], unit: string): string[] => {
        let best: string[] = [...pile], most = -1;
        pile.forEach((u, s) => {
            if (u !== unit) return;
            const cand = tidy(pile.filter((x, k) => x !== unit || k === s)), m = score(cand);
            if (m > most) { most = m; best = cand; }
        });
        return best;
    };

    /** From a pile, one step at a time as long as a step matches more: a place added, or a place moved */
    const climb = (from: readonly string[]): { pile: string[]; score: number } => {
        let pile = [...from], now = score(pile);
        for (let step = 0; step < MAX_STEPS; step++) {
            let best: string[] | null = null, gain = 1e-6;
            const weigh = (made: string[]) => {
                const cand = tidy(made);
                if (cand.length === pile.length && cand.every((u, k) => u === pile[k])) return;
                const g = score(cand) - now;
                if (g > gain && failing(cand) < 0) { gain = g; best = cand; }
            };
            if (pile.length - layers.length < MAX_ADDED) {
                for (const unit of could) {
                    for (let p = 0; p <= pile.length; p++) if (pile[p - 1] !== unit && pile[p] !== unit) weigh([...pile.slice(0, p), unit, ...pile.slice(p)]);
                }
            }
            for (let i = 0; i < pile.length; i++) {
                const without = pile.filter((_, k) => k !== i);
                for (let j = 0; j <= without.length; j++) if (j !== i) weigh([...without.slice(0, j), pile[i], ...without.slice(j)]);
            }
            if (!best) break;
            pile = best;
            now += gain;
        }
        return { pile, score: now };
    };
    /**
     * A pile to start from, read off one hole: its units in the order it meets them, less the places that do not hold
     * as occurrences (the least met first), with the layers it does not meet put where they match most.
     */
    const fromHole = (units: ArrayLike<number>): string[] => {
        // (A unit that could not gain enough is in it once: where the hole first meets it)
        const once = new Set<string>();
        let pile = tidy(Array.from(units, u => runs.units[u]).filter(u => layers.includes(u) && (could.has(u) || (!once.has(u) && !!once.add(u)))));
        for (let guard = 0; guard < 200; guard++) {
            const s = failing(pile);
            if (s < 0) break;
            pile = tidy(pile.filter((_, k) => k !== s));
        }
        for (const unit of layers) {
            if (pile.includes(unit)) continue;
            let best = pile, most = -1;
            for (let p = 0; p <= pile.length; p++) { const cand = [...pile.slice(0, p), unit, ...pile.slice(p)], m = score(cand); if (m > most) { most = m; best = cand; } }
            pile = best;
        }
        return pile;
    };

    // Only a unit with enough of its metres in second stretches can gain enough: with none, nothing is looked for
    const could = new Set(layers.filter(u => metresBack(runs, u) >= OCCURRENCE_GAIN * metresIn(runs, u) && metresIn(runs, u) > 0));
    if (could.size === 0) return null;

    // Started from the order given, and from the holes with the most metres in them: a long hole shows the pile as it is, a
    // unit that comes back where it comes back, which single steps from an order of single layers may not reach
    const before = slotsAgreement(runs, layers);
    const metresOf = (h: { length: Float64Array }) => h.length.reduce((a, b) => a + b, 0);
    const starts: string[][] = [[...layers]];
    for (const h of [...runs.holes].sort((a, b) => metresOf(b) - metresOf(a)).slice(0, START_HOLES * 4)) {
        if (starts.length > START_HOLES) break;
        const pile = fromHole(h.unit);
        if (pile.length > layers.length && !starts.some(q => q.join('|') === pile.join('|'))) starts.push(pile);
    }
    let pile = [...layers], now = -1;
    for (const start of starts) { const got = climb(start); if (got.score > now + 1e-6) { now = got.score; pile = got.pile; } }
    // A unit that gains too little for its metres is put back as one layer
    const of = new Map<string, number>();
    for (const h of runs.holes) h.unit.forEach((u, i) => of.set(runs.units[u], (of.get(runs.units[u]) ?? 0) + h.length[i]));
    const gains = new Map<string, number>();
    for (let pass = 0; pass < 4 * MAX_ADDED; pass++) {
        // (With a unit put back, a place of another may no longer hold: that place alone is taken out)
        const s = failing(pile);
        if (s >= 0) { pile = tidy(pile.filter((_, k) => k !== s)); continue; }
        gains.clear();
        let back: string | null = null;
        for (const unit of new Set(pile)) {
            if (times(pile, unit) < 2) continue;
            const gain = score(pile) - score(asOne(pile, unit));
            gains.set(unit, gain);
            if (gain < OCCURRENCE_GAIN * (of.get(unit) ?? 0)) { back = unit; break; }
        }
        if (!back) break;
        pile = asOne(pile, back);
    }
    if (pile.length === new Set(pile).size) return null;
    const counts = occurrenceCounts(runs, pile);
    return {
        pile,
        units: [...gains].map(([unit, gain]) => ({ unit, times: times(pile, unit), gain, of: of.get(unit) ?? 0, counts: counts.filter((_, s) => pile[s] === unit) })),
        before, after: slotsAgreement(runs, pile),
    };
}

export interface OccurrenceTags {
    /** Per row: its place in the pile; -1 when its unit is not in the pile */
    slot: Int32Array;
    /** Holes with a unit of the pile in them, and of those the holes whose reading the neighbours changed */
    holes: number;
    moved: number;
}

interface Run { unit: number; rows: number[]; length: number }
interface HoleTags {
    runs: Run[];
    as: Int32Array;
    /** Per run, once read against the neighbours: the place it is read as, its own or not (null: not read against them) */
    read: Int32Array | null;
    /** Where the hole starts and ends as it is read, and between run k - 1 and run k */
    top: Place | null;
    bottom: Place | null;
    between: (Place | null)[];
}

/** How many times the holes are read again against their neighbours */
const ROUNDS = 2;
/** A hole that runs nearly along a contact says nothing of which side of it its ends are */
const ALONG = 0.15;

/**
 * Which place of the pile every row of a log is at. `pile`: the layers, the
 * youngest first, a unit that comes back at each of its places. Each hole is
 * first read by itself (the heaviest set of stretches in order; between
 * readings as heavy, the one that passes over fewer places). With the rows'
 * places it is then read again against its neighbours, as `pileRead` does
 * (pile.ts), and with its two ends weighed in as well: a contact said to lie
 * before the hole's first row, or beyond its last, costs its distance from
 * there when the plane through where the nearest holes have it lies the
 * other way. So a hole that meets a unit once is given the occurrence the
 * holes round it have at that place.
 *
 * A stretch out of order is given the place of its unit nearest the layer
 * it is read as (it is still that unit, of one occurrence or another).
 */
export function tagOccurrences(
    log: { hole: ArrayLike<Text>; from: ArrayLike<number>; to: ArrayLike<number> | null; code: ArrayLike<Text>; x?: ArrayLike<number>; y?: ArrayLike<number>; z?: ArrayLike<number> },
    pile: readonly string[],
): OccurrenceTags {
    const rows = log.from.length, n = pile.length;
    const units = [...new Set(pile)], index = new Map(units.map((u, k) => [u, k]));
    const slots = slotsOf(units, pile);
    const slot = new Int32Array(rows).fill(-1);
    const byHole = new Map<string, number[]>();
    for (let i = 0; i < rows; i++) {
        const hole = log.hole[i];
        if (!hole || !Number.isFinite(log.from[i]) || !index.has((log.code[i] ?? '').trim())) continue;
        let list = byHole.get(hole);
        if (!list) byHole.set(hole, list = []);
        list.push(i);
    }
    const placed = !!log.x && !!log.y && !!log.z;
    const place = (i: number): Place | null => {
        if (!placed) return null;
        const q: Place = [log.x![i], log.y![i], log.z![i]];
        return Number.isFinite(q[0]) && Number.isFinite(q[1]) && Number.isFinite(q[2]) ? q : null;
    };
    const mid = (a: Place | null, b: Place | null): Place | null => (a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] : null);

    // --- each hole by itself ---
    const holes: HoleTags[] = [];
    for (const list of byHole.values()) {
        list.sort((a, b) => log.from[a] - log.from[b]);
        const runs: Run[] = [];
        list.forEach((i, k) => {
            const to = log.to ? log.to[i] : NaN;
            const end = Number.isFinite(to) && to > log.from[i] ? to : k + 1 < list.length ? log.from[list[k + 1]] : log.from[i];
            const unit = index.get((log.code[i] ?? '').trim())!, length = Math.max(0, end - log.from[i]);
            const last = runs[runs.length - 1];
            if (last && last.unit === unit) { last.rows.push(i); last.length += length; } else runs.push({ unit, rows: [i], length });
        });
        // (A hole that climbs: its far end is its top)
        const z0 = log.z ? log.z[list[0]] : NaN, z1 = log.z ? log.z[list[list.length - 1]] : NaN;
        if (Number.isFinite(z0) && Number.isFinite(z1) && z1 > z0) { runs.reverse(); for (const r of runs) r.rows.reverse(); }
        const read = readSlots(runs.map(r => r.unit), runs.map(r => r.length), slots, n);
        let as = read.as;
        if (read.up) { runs.reverse(); for (const r of runs) r.rows.reverse(); as = Int32Array.from(as).reverse(); }
        const lastRun = runs[runs.length - 1];
        holes.push({
            runs, as, read: null,
            top: place(runs[0].rows[0]), bottom: place(lastRun.rows[lastRun.rows.length - 1]),
            between: runs.map((r, k) => (k === 0 ? null : mid(place(runs[k - 1].rows[runs[k - 1].rows.length - 1]), place(r.rows[0])))),
        });
    }

    // --- each hole again, against the planes through where its neighbours have the contacts ---
    const changed = new Set<number>();
    for (let round = 0; placed && n > 1 && round < ROUNDS; round++) {
        // Where each hole has each contact: between two stretches in order, at places either side of it
        const seen: { hole: number; p: Place }[][] = pile.slice(1).map(() => []);
        holes.forEach((h, hi) => {
            let before = -1;
            for (let q = 0; q < h.runs.length; q++) {
                if (h.as[q] < 0) continue;
                if (before >= 0 && h.as[before] < h.as[q]) {
                    const where = q === before + 1 ? h.between[q] : mid(h.between[before + 1], h.between[q]);
                    if (where) for (let i = h.as[before]; i < h.as[q]; i++) seen[i].push({ hole: hi, p: where });
                }
                before = q;
            }
        });
        const next = holes.map((h, hi) => {
            const here = mid(h.top, h.bottom);
            if (!here || !h.top || !h.bottom) return null;
            const planes = seen.map(list => {
                const near = list.filter(c => c.hole !== hi)
                    .map(c => ({ c, d: Math.hypot(c.p[0] - here[0], c.p[1] - here[1], c.p[2] - here[2]) }))
                    .sort((a, b) => a.d - b.d).slice(0, NEIGHBOURS);
                if (near.length < 3) return null;
                const plane = bestFitPlane(near.flatMap(x => x.c.p));
                return plane && plane.spread[1] > 0.05 * plane.spread[0] && plane.spread[1] > 1e-6 ? plane : null;
            });
            if (planes.every(pl => !pl)) return null;
            const signed = (p: Place, i: number) => { const pl = planes[i]!; return (p[0] - pl.point[0]) * pl.normal[0] + (p[1] - pl.point[1]) * pl.normal[1] + (p[2] - pl.point[2]) * pl.normal[2]; };
            const off = (k: number, i: number) => (planes[i] && h.between[k] ? Math.abs(signed(h.between[k]!, i)) : 0);
            // The way the hole runs as it is read; how far along it from a place the plane of a contact lies (positive: further on)
            const along: Place = [h.bottom[0] - h.top[0], h.bottom[1] - h.top[1], h.bottom[2] - h.top[2]];
            const len = Math.hypot(along[0], along[1], along[2]);
            const ahead = (p: Place, i: number): number | null => {
                const pl = planes[i];
                if (!pl || len < 1e-9) return null;
                const dn = (along[0] * pl.normal[0] + along[1] * pl.normal[1] + along[2] * pl.normal[2]) / len;
                return Math.abs(dn) < ALONG ? null : -signed(p, i) / dn;
            };
            // A contact said to be before the hole's first row that lies further on; one said to be beyond its last that lies before it
            const topCost = (i: number) => { const t = ahead(h.top!, i); return t !== null && t > 0 ? Math.abs(signed(h.top!, i)) : 0; };
            const bottomCost = (i: number) => { const t = ahead(h.bottom!, i); return t !== null && t < 0 ? Math.abs(signed(h.bottom!, i)) : 0; };

            const m = h.runs.length;
            const own = (k: number, l: number) => (slots[h.runs[k].unit].includes(l) ? h.runs[k].length : 0);
            const from = new Int32Array(m * n).fill(-1);
            let v = new Float64Array(n), w = new Float64Array(n);
            const cost = new Float64Array(n + 1);
            for (let l = 0, c = 0; l < n; l++) { v[l] = own(0, l) - NEIGHBOUR_WEIGHT * c; if (l < n - 1) c += topCost(l); }
            for (let k = 1; k < m; k++) {
                cost[0] = 0;
                for (let i = 0; i < n - 1; i++) cost[i + 1] = cost[i] + NEIGHBOUR_WEIGHT * off(k, i);
                for (let l = 0; l < n; l++) {
                    let best = -Infinity, at = 0;
                    for (let a = 0; a <= l; a++) { const score = v[a] - (cost[l] - cost[a]); if (score >= best) { best = score; at = a; } }
                    w[l] = best + own(k, l);
                    from[k * n + l] = at;
                }
                [v, w] = [w, v];
            }
            let end = 0, most = -Infinity;
            for (let l = n - 1, c = 0; l >= 0; l--) {
                // (c: what the contacts under place l cost, said to be beyond the hole's last row)
                const score = v[l] - NEIGHBOUR_WEIGHT * c;
                if (score > most) { most = score; end = l; }
                if (l > 0) c += bottomCost(l - 1);
            }
            const label = new Int32Array(m);
            for (let k = m - 1, l = end; k >= 0; k--) { label[k] = l; if (k > 0) l = from[k * n + l]; }
            return label;
        });
        next.forEach((label, hi) => {
            if (!label) return;
            const h = holes[hi];
            // In order where it is read at a place of its own unit; those alone say where a contact is
            const as = Int32Array.from(label, (l, k) => (slots[h.runs[k].unit].includes(l) ? l : -1));
            if (as.some((a, k) => a !== h.as[k])) changed.add(hi);
            h.as = as;
            h.read = label;
        });
    }

    // --- every row its place: a stretch out of order is of the occurrence nearest where it lies ---
    for (const h of holes) {
        h.runs.forEach((run, k) => {
            let s = h.as[k];
            if (s < 0) {
                const options = slots[run.unit];
                // Where it lies: the place it was read as, else between the places kept before and after it
                let lies = h.read ? h.read[k] : -1;
                if (lies < 0) {
                    let before = -1, after = -1;
                    for (let q = k - 1; q >= 0 && before < 0; q--) before = h.as[q];
                    for (let q = k + 1; q < h.runs.length && after < 0; q++) after = h.as[q];
                    lies = before >= 0 && after >= 0 ? (before + after) / 2 : before >= 0 ? before : after >= 0 ? after : options[0];
                }
                s = options[0];
                for (const o of options) if (Math.abs(o - lies) < Math.abs(s - lies)) s = o;
            }
            for (const i of run.rows) slot[i] = s;
        });
    }
    return { slot, holes: byHole.size, moved: changed.size };
}

/** The name of each place of a pile: a unit that is in it several times is numbered from the youngest ("Basalt 1", "Basalt 2") */
export function occurrenceNames(pile: readonly string[]): string[] {
    return pile.map((u, s) => (pile.filter(x => x === u).length > 1 ? `${u} ${pile.slice(0, s + 1).filter(x => x === u).length}` : u));
}

/** A colour for the nth occurrence of a unit: the unit's own, each one a step darker */
function shade(color: string, n: number): string {
    const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
    if (!hex || n <= 0) return color;
    const keep = Math.max(0.4, 1 - 0.18 * n);
    return `#${[0, 2, 4].map(k => Math.round(parseInt(hex[1].slice(k, k + 2), 16) * keep).toString(16).padStart(2, '0')).join('')}`;
}

export interface OccurrenceUnits {
    /** The map's units with each unit that comes back as its occurrences, in its place, the youngest first */
    regrouped: Regrouped;
    /** The name of each place of the pile */
    names: string[];
}

/**
 * The units of a map with the units that are in `pile` several times made
 * a unit for each occurrence. The logged codes stay with the occurrence
 * that holds the most metres (`metres`: per place of the pile), so the
 * fewest stretches have to be given to a unit by hand; the others have no
 * codes of their own. Null: an occurrence's name is another unit's.
 */
export function occurrenceUnits(units: readonly ModelUnit[], pile: readonly string[], metres: ArrayLike<number>): OccurrenceUnits | null {
    const names = occurrenceNames(pile);
    const out: ModelUnit[] = [], carry: Record<string, string[]> = {};
    for (const u of units) {
        const at = pile.flatMap((x, s) => (x === u.name ? [s] : []));
        if (at.length < 2) { out.push(u); continue; }
        if (at.some(s => units.some(x => x.name === names[s]))) return null;
        const holder = at.reduce((a, s) => (metres[s] > metres[a] ? s : a), at[0]);
        at.forEach((s, n) => out.push({ ...u, name: names[s], color: shade(u.color, n), codes: s === holder ? u.codes : [] }));
        carry[u.name] = at.map(s => names[s]);
    }
    return Object.keys(carry).length ? { regrouped: { units: out, carry }, names } : null;
}

const count = (n: number) => ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][n] ?? String(n);

/** What says a unit is in the pile several times, in words */
export function occurrenceText(p: OccurrenceProposal, unit: string): string {
    const u = p.units.find(x => x.unit === unit);
    if (!u) return '';
    const between = p.pile.slice(p.pile.indexOf(unit) + 1, p.pile.lastIndexOf(unit)).filter(x => x !== unit);
    const through = u.counts.filter(c => c.through > 0).map(c => `${c.metThrough.toLocaleString()} of ${c.through.toLocaleString()}`);
    return `${unit} is met ${u.times === 2 ? 'twice' : `${count(u.times)} times`} down the holes, with ${between.length ? [...new Set(between)].join(', ') : 'other units'} between: `
        + `as ${count(u.times)} layers the holes match ${Math.round(u.gain).toLocaleString()} m more of its ${Math.round(u.of).toLocaleString()} m`
        + (through.length ? `, and each is met in most of the holes that pass through its place (${through.join(', ')})` : '');
}

/** A second place that would match under this share more of a unit's metres is not worth a line: stray intervals */
export const OCCURRENCE_SAID = 0.05;

/**
 * Why a unit that comes back down the holes is not said to be several
 * layers: what a second place for it at its best would gain, and how many
 * of the holes that pass through that place meet it. '' when a second place
 * gains next to nothing (under OCCURRENCE_SAID of its metres): a stray
 * interval here and there, which the step already says what to do about.
 */
export function notOccurrencesText(runs: LoggedRuns, layers: readonly string[], unit: string): string {
    if (!layers.includes(unit)) return '';
    const base = slotsAgreement(runs, layers);
    let best: string[] | null = null, most = base + 1e-6, at = -1;
    for (let p = 0; p <= layers.length; p++) {
        if (layers[p - 1] === unit || layers[p] === unit) continue;
        const cand = [...layers.slice(0, p), unit, ...layers.slice(p)], m = slotsAgreement(runs, cand);
        if (m > most) { most = m; best = cand; at = p; }
    }
    if (!best) return '';
    const of = metresIn(runs, unit), c = occurrenceCounts(runs, best)[at];
    if (most - base < OCCURRENCE_SAID * of) return '';
    const share = Math.round(100 * (most - base) / Math.max(of, 1e-9));
    const where = at === 0 ? `over ${best[1]}` : at === best.length - 1 ? `under ${best[at - 1]}` : `between ${best[at - 1]} and ${best[at + 1]}`;
    const few = c.through > 0 && c.metThrough < OCCURRENCE_THROUGH * c.through;
    return `a second ${unit} ${where} would match ${share}% more of its metres`
        + (c.through > 0 ? `, and ${c.metThrough.toLocaleString()} of the ${c.through.toLocaleString()} holes that pass through there meet it` : `, met in ${c.met.toLocaleString()} hole${c.met === 1 ? '' : 's'}`)
        + `: ${share < 100 * OCCURRENCE_GAIN && few ? 'too little, in too few holes,' : share < 100 * OCCURRENCE_GAIN ? 'too little' : few || c.met < OCCURRENCE_HOLES ? 'too few holes' : 'not enough'} to call it two layers`;
}

export interface ComeBack {
    /** The units that are in the pile several times, with the pile; null: none is */
    proposal: OccurrenceProposal | null;
    /** Units left out of the pile: each lay between two occurrences of one unit and is met in too few of the holes that pass there to be a layer between them (a body in that unit) */
    passed: string[];
    /** For each unit asked about that is not: why not ('' where a second place for it gains nothing) */
    not: Record<string, string>;
}

/**
 * Which of `units` come back down the holes as layers do. Every other unit
 * of the logging is passed over; the units are first put in the order the
 * logging agrees with best, each once (`proposeOrder`). `ask`: units to say
 * why not of, where they are not proposed.
 *
 * What lies between two occurrences of a unit has to be a layer itself:
 * met, as an occurrence must be, in OCCURRENCE_HOLES holes and in
 * OCCURRENCE_THROUGH of the holes that pass through its place. A stock or
 * a plug inside a layer has that layer above and below it in the few holes
 * that meet it, and read as a layer it would make two layers of the one.
 * Such a unit is passed over (`passed`) and the search made again.
 */
export function unitsThatComeBack(runs: LoggedRuns, units: readonly string[], ask: readonly string[] = []): ComeBack {
    let among = [...units];
    const passed: string[] = [];
    for (;;) {
        const only = passOver(runs, new Set(runs.units.filter(u => !among.includes(u))));
        const order = proposeOrder(only, among);
        const proposal = proposeOccurrences(only, order);
        if (proposal && among.length > 3) {
            const pile = proposal.pile, counts = occurrenceCounts(only, pile);
            // (Not a layer: in the pile once, and met in too few holes. Several such side by side between the two occurrences: each of them)
            const weak = pile.map((u, s) => pile.indexOf(u) === pile.lastIndexOf(u) && (counts[s].met < OCCURRENCE_HOLES || counts[s].metThrough < OCCURRENCE_THROUGH * counts[s].through));
            const body = pile.find((_, s) => {
                if (!weak[s]) return false;
                let lo = s - 1, hi = s + 1;
                while (lo >= 0 && weak[lo]) lo--;
                while (hi < pile.length && weak[hi]) hi++;
                return lo >= 0 && hi < pile.length && pile[lo] === pile[hi];
            });
            if (body !== undefined) { passed.push(body); among = among.filter(u => u !== body); continue; }
        }
        const not: Record<string, string> = {};
        for (const u of ask) if (among.includes(u) && !proposal?.units.some(x => x.unit === u)) not[u] = notOccurrencesText(only, order, u);
        return { proposal, not, passed };
    }
}
