/**
 * What the logging says about a model's chronology, before anything is made
 * (Phase 214). Read hole by hole, going down:
 *
 * - how often each unit lies directly on each other one (`contactMatrix`);
 * - how many of the logged metres a pile of layers in a given order could
 *   match at the very best, each layer met once down a hole
 *   (`bestAgreement`): the ceiling a model of plain layers cannot pass;
 * - an order for the layers, and which units do not stack as layers at all
 *   because their stretches lie inside another unit (`proposeChronology`).
 *
 * A proposal only: it is shown with its counts and taken up by hand. It says
 * how the units lie in the holes, never what kind of rock or deposit they
 * are. Pure: nothing here reads a store.
 */
import { cutsAcross, type UnitPlan } from './geoModel';
import { intervalEnds } from './units';
import { sharePercent } from './geoModelFlag';
import { pileOfHole } from './pile';

type Text = string | null | undefined;

/** The runs of one hole, from its top down: the unit of each (an index into the units) and its length */
export interface HoleRuns {
    hole: string;
    unit: Int32Array;
    length: Float64Array;
}

export interface LoggedRuns {
    units: string[];
    holes: HoleRuns[];
}

/**
 * The runs of each hole: intervals of one unit that follow one another are
 * one run, and ground that is not logged (or is in none of `units`) is passed
 * over, so the runs either side of it meet. A hole that climbs (`z` rising
 * with depth) is read from its top, the far end first.
 */
export function loggedRuns(
    log: { hole: ArrayLike<Text>; from: ArrayLike<number>; to: ArrayLike<number> | null; code: ArrayLike<Text>; z?: ArrayLike<number> },
    units: readonly string[],
): LoggedRuns {
    const index = new Map(units.map((u, k) => [u, k]));
    const end = intervalEnds(log.hole, log.from, log.to);
    const byHole = new Map<string, number[]>();
    for (let i = 0; i < log.from.length; i++) {
        const hole = log.hole[i];
        if (!hole || !Number.isFinite(log.from[i]) || !index.has((log.code[i] ?? '').trim())) continue;
        let rows = byHole.get(hole);
        if (!rows) byHole.set(hole, rows = []);
        rows.push(i);
    }
    const holes: HoleRuns[] = [];
    for (const [hole, rows] of byHole) {
        rows.sort((a, b) => log.from[a] - log.from[b]);
        const unit: number[] = [], length: number[] = [];
        for (const i of rows) {
            const u = index.get((log.code[i] ?? '').trim())!;
            const len = end[i] - log.from[i];
            const w = Number.isFinite(len) && len > 0 ? len : 0;
            if (unit.length && unit[unit.length - 1] === u) length[length.length - 1] += w;
            else { unit.push(u); length.push(w); }
        }
        const z0 = log.z ? log.z[rows[0]] : NaN, z1 = log.z ? log.z[rows[rows.length - 1]] : NaN;
        if (Number.isFinite(z0) && Number.isFinite(z1) && z1 > z0) { unit.reverse(); length.reverse(); }
        holes.push({ hole, unit: Int32Array.from(unit), length: Float64Array.from(length) });
    }
    return { units: [...units], holes };
}

/** A unit's usual thickness is told from at least this many of its stretches */
const THICKNESS_RUNS = 5;

/**
 * The unit whose stretches down the holes are usually the shortest: its name
 * and that length (the median, m), among the units of `among` (absent: all).
 * A stretch at the top or the bottom of a hole is cut short by the hole, so
 * those are left out where a unit has enough others. Null: no unit has
 * enough stretches to tell from.
 */
export function thinnestUnit(runs: LoggedRuns, among?: ReadonlySet<string>): { unit: string; usual: number } | null {
    const inner: number[][] = runs.units.map(() => []), all: number[][] = runs.units.map(() => []);
    for (const h of runs.holes) {
        for (let k = 0; k < h.unit.length; k++) {
            if (!(h.length[k] > 0)) continue;
            all[h.unit[k]].push(h.length[k]);
            if (k > 0 && k + 1 < h.unit.length) inner[h.unit[k]].push(h.length[k]);
        }
    }
    let best: { unit: string; usual: number } | null = null;
    runs.units.forEach((unit, u) => {
        if (among && !among.has(unit)) return;
        const lengths = inner[u].length >= THICKNESS_RUNS ? inner[u] : all[u];
        if (lengths.length < THICKNESS_RUNS) return;
        lengths.sort((a, b) => a - b);
        const usual = lengths[lengths.length >> 1];
        if (!best || usual < best.usual) best = { unit, usual };
    });
    return best;
}

/** The runs with some units passed over, as if they were not logged: the runs either side of them meet */
export function passOver(runs: LoggedRuns, over: ReadonlySet<string>): LoggedRuns {
    if (over.size === 0) return runs;
    const skip = runs.units.map(u => over.has(u));
    const holes: HoleRuns[] = [];
    for (const h of runs.holes) {
        const unit: number[] = [], length: number[] = [];
        for (let i = 0; i < h.unit.length; i++) {
            if (skip[h.unit[i]]) continue;
            if (unit.length && unit[unit.length - 1] === h.unit[i]) length[length.length - 1] += h.length[i];
            else { unit.push(h.unit[i]); length.push(h.length[i]); }
        }
        if (unit.length) holes.push({ hole: h.hole, unit: Int32Array.from(unit), length: Float64Array.from(length) });
    }
    return { units: runs.units, holes };
}

export interface ContactMatrix {
    units: string[];
    /** Per unit: metres logged, holes it is in, its separate stretches, and those that lie inside one other unit (the same above and below) */
    metres: number[];
    holes: number[];
    stretches: number[];
    inside: number[];
    /** Per unit: the metres of its stretches that lie inside one other unit */
    insideMetres: number[];
    /** `over[a][b]`: how many times a lies directly on b, going down a hole */
    over: number[][];
    /** `host[a][b]`: how many stretches of a lie inside b */
    host: number[][];
}

/** How the units lie on one another down the holes */
export function contactMatrix(runs: LoggedRuns): ContactMatrix {
    const n = runs.units.length;
    const zeros = () => new Array<number>(n).fill(0);
    const m: ContactMatrix = { units: runs.units, metres: zeros(), holes: zeros(), stretches: zeros(), inside: zeros(), insideMetres: zeros(), over: runs.units.map(zeros), host: runs.units.map(zeros) };
    const seen = new Uint8Array(n);
    for (const h of runs.holes) {
        seen.fill(0);
        for (let i = 0; i < h.unit.length; i++) {
            const u = h.unit[i];
            m.metres[u] += h.length[i];
            m.stretches[u]++;
            if (!seen[u]) { seen[u] = 1; m.holes[u]++; }
            if (i > 0) m.over[h.unit[i - 1]][u]++;
            if (i > 0 && i + 1 < h.unit.length && h.unit[i - 1] === h.unit[i + 1]) { m.inside[u]++; m.insideMetres[u] += h.length[i]; m.host[u][h.unit[i - 1]]++; }
        }
    }
    return m;
}

/** A unit does not stack as a layer when this many of its stretches, and this share of them, lie inside another unit */
export const INSIDE_STRETCHES = 3;
export const INSIDE_SHARE = 0.5;
/**
 * ... and this share at least of its metres. (A layer logged here and there
 * as a stray interval inside the others has most of its stretches inside
 * another unit, and next to none of its metres.)
 */
export const INSIDE_METRES = 0.25;
/**
 * A unit met more often than this down a hole (on average, over the holes it
 * is in) comes and goes with its neighbours: that is units alternating, not
 * one body cutting across the others
 */
export const STRETCHES_A_HOLE = 3;
/**
 * ... unless it is a small part of the unit its stretches lie in (its metres
 * at most this share of that unit's): thin sheets met again and again inside
 * one host are a set of veins or dykes, not layers that alternate.
 */
export const VEIN_SET_SHARE = 0.2;

/** Whether a unit met again and again down the holes is a set of veins in a host (`k`: its number in the matrix): mostly inside one other unit, and small beside it */
export function veinSet(m: ContactMatrix, k: number): boolean {
    if (!(m.stretches[k] > STRETCHES_A_HOLE * m.holes[k]) || m.inside[k] < INSIDE_STRETCHES || m.inside[k] < INSIDE_SHARE * m.stretches[k]) return false;
    let host = -1;
    for (let b = 0; b < m.units.length; b++) if (m.host[k][b] > 0 && (host < 0 || m.host[k][b] > m.host[k][host])) host = b;
    return host >= 0 && m.metres[k] <= VEIN_SET_SHARE * m.metres[host];
}

/**
 * The layers that come and go down the holes, with how many stretches of each
 * a hole has on average. Layers that alternate cannot all be matched, in any
 * order: what helps is grouping them, or leaving short stretches out.
 */
export function alternating(runs: LoggedRuns, layers: readonly string[]): { unit: string; each: number }[] {
    const m = contactMatrix(passOver(runs, new Set(runs.units.filter(u => !layers.includes(u)))));
    return layers
        .map(unit => { const k = m.units.indexOf(unit); return { unit, each: k >= 0 && m.holes[k] > 0 ? m.stretches[k] / m.holes[k] : 0 }; })
        .filter(u => u.each > STRETCHES_A_HOLE);
}

/** Two layers next to one another in the pile are pointed out when they are in the same hole in under this share of the holes of the one met in fewer ... */
export const TOGETHER_SHARE = 0.25;
/** ... and, where they do meet, the one lies on the other against the order this share of the times or more (or they meet under twice) */
export const AGAINST_SHARE = 0.4;
/** Asked only of layers met in this many holes or more */
export const TOGETHER_HOLES = 5;

/** Two layers next to one another in the pile whose order the holes do not say */
export interface OrderNotSaid {
    upper: string;
    lower: string;
    /** The holes that meet both, of the holes of the one met in fewer (`fewer`) */
    together: number;
    holes: number;
    fewer: string;
    /** How many times the upper lies directly on the lower, and the lower on the upper */
    down: number;
    up: number;
    why: string;
}

/**
 * The layers next to one another in the pile (`layers`, the youngest first)
 * whose order the holes do not say: hardly ever in the same hole, and where
 * they are, as often one way up as the other. Two rocks side by side read
 * so, and so does one rock logged under two codes by two campaigns. Put in
 * a pile all the same, the contact between them rests on the few holes that
 * have both, and one of the two can be given little or no ground. Units
 * that are not layers are passed over.
 */
export function orderNotSaid(runs: LoggedRuns, layers: readonly string[]): OrderNotSaid[] {
    const only = passOver(runs, new Set(runs.units.filter(u => !layers.includes(u))));
    const m = contactMatrix(only);
    const found: OrderNotSaid[] = [];
    for (let k = 0; k + 1 < layers.length; k++) {
        const a = only.units.indexOf(layers[k]), b = only.units.indexOf(layers[k + 1]);
        if (a < 0 || b < 0 || m.holes[a] < TOGETHER_HOLES || m.holes[b] < TOGETHER_HOLES) continue;
        let together = 0;
        for (const h of only.holes) {
            let hasA = false, hasB = false;
            for (let i = 0; i < h.unit.length; i++) { if (h.unit[i] === a) hasA = true; else if (h.unit[i] === b) hasB = true; }
            if (hasA && hasB) together++;
        }
        const fewer = m.holes[a] <= m.holes[b] ? a : b;
        const down = m.over[a][b], up = m.over[b][a];
        if (together >= TOGETHER_SHARE * m.holes[fewer] || (down + up >= 2 && up < AGAINST_SHARE * (down + up))) continue;
        const upper = layers[k], lower = layers[k + 1];
        const meet = down + up === 0 ? 'never one on the other' : `${upper} on ${lower} ${times(down)}, ${lower} on ${upper} ${times(up)}`;
        found.push({
            upper, lower, together, holes: m.holes[fewer], fewer: only.units[fewer], down, up,
            why: `${upper} and ${lower} are in the same hole in ${together.toLocaleString()} of the ${m.holes[fewer].toLocaleString()} holes that meet ${only.units[fewer]} (${meet}): the holes do not say which lies on the other`,
        });
    }
    return found;
}

/** The unit most of a unit's inside stretches lie in (null: none does) */
export function mostInside(m: ContactMatrix, unit: number): string | null {
    let best = -1;
    for (let b = 0; b < m.units.length; b++) if (m.host[unit][b] > 0 && (best < 0 || m.host[unit][b] > m.host[unit][best])) best = b;
    return best < 0 ? null : m.units[best];
}

/** "14 of its 16 stretches lie inside another unit, mostly Basalt" */
export function insideText(m: ContactMatrix, unit: number): string {
    const hosts = m.host[unit].filter(c => c > 0).length;
    const host = mostInside(m, unit);
    return `${m.inside[unit].toLocaleString()} of its ${m.stretches[unit].toLocaleString()} stretches lie inside another unit${host ? `, ${hosts > 1 ? 'mostly ' : ''}${host}` : ''}`;
}

/** Per unit: its place among the layers (0 the youngest), CUTS for a unit that cuts across them, OUT for one not in the model */
const CUTS = -1, OUT = -2;

function ranksOf(runs: LoggedRuns, layers: readonly string[], cutting: readonly string[]): Int32Array {
    const rank = new Int32Array(runs.units.length).fill(OUT);
    const at = new Map(runs.units.map((u, k) => [u, k]));
    cutting.forEach(u => { const k = at.get(u); if (k !== undefined) rank[k] = CUTS; });
    layers.forEach((u, r) => { const k = at.get(u); if (k !== undefined) rank[k] = r; });
    return rank;
}

/** The most metres of one hole that layers in this order can match, read whichever way along it matches more (pile.ts) */
function holeBound(h: HoleRuns, rank: Int32Array, layers: number): { metres: number; up: boolean } {
    let cut = 0;
    for (let i = 0; i < h.unit.length; i++) if (rank[h.unit[i]] === CUTS) cut += h.length[i];
    const read = pileOfHole(Array.from(h.unit, u => rank[u]), h.length, layers);
    return { metres: read.metres + cut, up: read.up };
}

/**
 * An order and the same order upside down match the same metres (every hole
 * read the other way). Between orders that match as much, the one with less
 * hole read from the bottom up is taken: a little is taken off what such a
 * hole matches when orders are weighed against one another.
 */
const UP_COST = 0.001;

function boundMetres(runs: LoggedRuns, rank: Int32Array, layers: number): number {
    let sum = 0;
    for (const h of runs.holes) {
        const b = holeBound(h, rank, layers);
        sum += b.up ? b.metres * (1 - UP_COST) : b.metres;
    }
    return sum;
}

export interface Bound {
    /** The most metres that can be in their own unit, and the metres logged in the model's units */
    metres: number;
    of: number;
    byUnit: { unit: string; metres: number; of: number }[];
    /** Holes with two layers or more in them, and of those the holes read from the bottom up (the layers get younger going down them) */
    holes: number;
    up: number;
}

/**
 * The most a pile of layers can match. `layers`: the youngest first; along
 * a hole a layer is met once, so going down it the units met can only get
 * older (or only younger: a hole is read whichever way matches more, and
 * `up` counts those read from the bottom). The metres counted are those of
 * the heaviest such set of stretches of each hole (pile.ts). A unit of
 * `cutting` (an intrusion, a vein) can be anywhere and counts whole, and is
 * passed over by the layers. Units in neither list are not in the model and
 * are not counted at all.
 */
export function bestAgreement(runs: LoggedRuns, layers: readonly string[], cutting: readonly string[]): Bound {
    const rank = ranksOf(runs, layers, cutting);
    const n = runs.units.length;
    const got = new Array<number>(n).fill(0), of = new Array<number>(n).fill(0);
    let holes = 0, up = 0;
    for (const h of runs.holes) {
        const ranks = Array.from(h.unit, u => rank[u]);
        const read = pileOfHole(ranks, h.length, layers.length);
        if (new Set(ranks.filter(r => r >= 0)).size > 1) { holes++; if (read.up) up++; }
        for (let i = 0; i < h.unit.length; i++) {
            const u = h.unit[i];
            if (rank[u] === OUT) continue;
            of[u] += h.length[i];
            if (rank[u] === CUTS || read.kept[i]) got[u] += h.length[i];
        }
    }
    const byUnit = runs.units.map((unit, k) => ({ unit, metres: got[k], of: of[k] })).filter((_, k) => rank[k] !== OUT);
    return { metres: byUnit.reduce((a, b) => a + b.metres, 0), of: byUnit.reduce((a, b) => a + b.of, 0), byUnit, holes, up };
}

/** With more layers than this the order is not searched: it is left as given */
export const SEARCH_LAYERS = 12;

/**
 * An order for the layers (the youngest first) that the logging agrees with
 * best. First the order in which most of the "a lies on b" counts are the
 * right way up (looked for among every order, for up to SEARCH_LAYERS
 * layers); then single moves, as long as one raises `bestAgreement`. The
 * order given is kept when nothing found is better than it.
 */
export function proposeOrder(runs: LoggedRuns, layers: readonly string[]): string[] {
    const n = layers.length;
    if (n < 2 || n > SEARCH_LAYERS) return [...layers];
    const only = passOver(runs, new Set(runs.units.filter(u => !layers.includes(u))));
    const m = contactMatrix(only);
    const at = layers.map(u => m.units.indexOf(u));
    const score = (order: readonly number[]) => boundMetres(only, ranksOf(only, order.map(k => layers[k]), []), n);

    // Every order, by the sets of layers already placed from the top: a layer put under a set gains the times each of the set lies on it
    const size = 1 << n;
    const best = new Float64Array(size).fill(-1), via = new Int8Array(size).fill(-1);
    best[0] = 0;
    for (let set = 0; set < size; set++) {
        if (best[set] < 0) continue;
        for (let u = 0; u < n; u++) {
            if (set & (1 << u)) continue;
            let gain = 0;
            for (let a = 0; a < n; a++) if (set & (1 << a)) gain += at[a] >= 0 && at[u] >= 0 ? m.over[at[a]][at[u]] : 0;
            const next = set | (1 << u);
            if (best[set] + gain > best[next]) { best[next] = best[set] + gain; via[next] = u; }
        }
    }
    let order: number[] = [];
    for (let set = size - 1; set > 0; set &= ~(1 << via[set])) order.unshift(via[set]);

    // Single moves that raise what is matched (`boundMetres`: with a little off for a hole read from the bottom up)
    let now = score(order);
    for (let pass = 0; pass < 40; pass++) {
        let better: number[] | null = null, gain = 1e-9;
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                const moved = order.filter((_, k) => k !== i);
                moved.splice(j, 0, order[i]);
                const s = score(moved);
                if (s - now > gain) { gain = s - now; better = moved; }
            }
        }
        if (!better) break;
        order = better;
        now += gain;
    }
    const given = layers.map((_, k) => k);
    return score(given) >= now - 1e-9 ? [...layers] : order.map(k => layers[k]);
}

/** A unit is said to cut a layer when this many of its stretches lie inside that layer (the same layer above and below) */
export const CUTS_STRETCHES = 2;
/** ... and to be older than a layer it is never in when this many of its holes pass through that layer */
export const PASS_HOLES = 5;
/** A layer's base is said to cut a unit that lies directly under it this many times and is never in it */
export const STOPS_UNDER = 2;

/** The age of a unit that cuts across the layers, as the logging has it */
export interface CutAge {
    /** The layer it is just older than: it goes under that layer in the list (null: it is the youngest) */
    under: string | null;
    /** Whether the logging says where it goes (false: nothing does, and it is left the youngest) */
    placed: boolean;
    /** How many times it lies directly under `under` down a hole */
    stops: number;
    /** The counts that say so, in words */
    why: string;
}

const times = (n: number) => `${n.toLocaleString()} time${n === 1 ? '' : 's'}`;
const listOf = (names: readonly string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/**
 * The age of a unit that cuts across the layers, from the logging (`layers`:
 * the youngest first). It is younger than every layer it lies inside: a
 * stretch of it with the same layer above and below cuts that layer. It is
 * older than a younger layer it is never in although its holes pass through
 * that layer: a cover laid down after it. (Never in a layer its holes do
 * not pass through says nothing. Lying against a layer, one unit above it
 * and another below, says nothing either: it may run along their contact
 * or stop at it.) It is put under the oldest layer it is older than, so it
 * still cuts whatever nothing says it does not. Where the logging does not
 * say, it stays the youngest, and `placed` says that it was not placed.
 * The other units that cut across, and those not in the model, are passed
 * over, so what lies either side of them counts as meeting.
 *
 * `replaces`: the layers it takes the place of (`takesPlace`). A stock
 * lies inside no layer, and cuts the layers that are missing where it is:
 * it is younger than those. A unit met in few holes is still older than a
 * layer it is never in when every one of its holes passes through that
 * layer and it lies directly under it STOPS_UNDER times: it stops there.
 */
export function cutsOf(runs: LoggedRuns, layers: readonly string[], unit: string, replaces: readonly string[] = []): CutAge {
    const read = passOver(runs, new Set(runs.units.filter(u => u !== unit && !layers.includes(u))));
    const c = read.units.indexOf(unit), n = layers.length;
    const layerOf = new Int32Array(read.units.length).fill(-1);
    layers.forEach((l, j) => { const k = read.units.indexOf(l); if (k >= 0) layerOf[k] = j; });
    const inside = new Array<number>(n).fill(0), under = new Array<number>(n).fill(0), passes = new Array<number>(n).fill(0);
    const seen = new Uint8Array(n);
    let holes = 0;
    for (const h of read.holes) {
        let has = false;
        seen.fill(0);
        for (let i = 0; i < h.unit.length; i++) {
            const j = layerOf[h.unit[i]];
            if (j >= 0) seen[j] = 1;
            if (h.unit[i] !== c) continue;
            has = true;
            const above = i > 0 ? layerOf[h.unit[i - 1]] : -1, below = i + 1 < h.unit.length ? layerOf[h.unit[i + 1]] : -1;
            if (above >= 0 && above === below) inside[above]++;
            else if (above >= 0) under[above]++;
        }
        if (!has) continue;
        holes++;
        for (let j = 0; j < n; j++) passes[j] += seen[j];
    }
    let host = -1;
    for (let j = 0; j < n && host < 0; j++) if (inside[j] >= CUTS_STRETCHES) host = j;
    // (What it takes the place of it cuts, as surely as what it lies inside)
    const gone = replaces.map(l => layers.indexOf(l)).filter(j => j >= 0).sort((a, b) => a - b);
    const byPlace = gone.length > 0 && (host < 0 || gone[0] < host);
    if (byPlace) host = gone[0];
    if (host < 0) return { under: null, placed: false, stops: 0, why: 'it lies inside no layer more than once, so nothing says its age: it is left the youngest' };
    const hosts = layers.map((l, j) => ({ l, count: inside[j] })).filter(x => x.count > 0).sort((a, b) => b.count - a.count);
    const cuts = byPlace
        ? `in the place of ${listOf(gone.map(j => layers[j]))}`
        : `in ${hosts.map((x, k) => (k === 0 ? `${x.l} ${times(x.count)}` : `${x.l} ${x.count.toLocaleString()}`)).join(hosts.length === 2 ? ' and ' : ', ')}`;
    for (let j = host - 1; j >= 0; j--) {
        if (inside[j] > 0 || (passes[j] < PASS_HOLES && !(under[j] >= STOPS_UNDER && passes[j] === holes))) continue;
        const lies = under[j] > 0 ? `, and directly under it ${times(under[j])}` : '';
        return { under: layers[j], placed: true, stops: under[j], why: `${cuts}; never in ${layers[j]}, which ${passes[j].toLocaleString()} of its ${holes.toLocaleString()} holes pass through${lies}: older than ${layers[j]}` };
    }
    if (host === 0) return { under: null, placed: true, stops: 0, why: `${cuts}: ${layers[0]} is the youngest layer, so it cuts them all` };
    return { under: null, placed: false, stops: 0, why: `${cuts}; nothing says whether it is older than ${listOf(layers.slice(0, host))} (too few of its holes pass through): it is left the youngest` };
}

/** A unit that cuts across is said to keep its place in the pile when it is met in this many holes at least ... */
export const FOLLOWS_HOLES = 5;
/** ... lies in the one place of the pile (inside one layer, or between the same two) in this share of them ... */
export const FOLLOWS_SHARE = 0.75;
/** ... and, inside a layer, half of those holes have it within this share of the layer's thickness of one another */
export const FOLLOWS_SPREAD = 0.15;
/** Met more often than this a hole, it is several sheets: no one place in the pile is looked for */
export const FOLLOWS_A_HOLE = 1.5;

/** Whether a unit that cuts across keeps one place in the pile from hole to hole, as the logging has it */
export interface KeepsHeight {
    /** It does: it follows the layers (a sill, a stratabound lode) */
    follows: boolean;
    /** The layer it lies inside, or the two it lies between (the upper first); none: it has no usual place */
    host: string[];
    /** The holes it lies there in, and the holes it is met in */
    holes: number;
    of: number;
    /** Inside a layer: how far down the layer it usually is (0 its top, 1 its base), and the middle half of the holes (null: between two layers, or too few holes show both the top and the base of the layer) */
    at: { usual: number; from: number; to: number } | null;
    /** The counts that say so, in words ('' when it is met in too few holes to say anything) */
    why: string;
}

/**
 * Whether a unit that cuts across the layers keeps one place in the pile
 * from hole to hole (`layers`: the youngest first; the other units that
 * are not layers are passed over). A sill, or a lode that keeps to one
 * bed, lies inside the same layer in hole after hole, the same share of the
 * way down it, or between the same two layers; a dyke or a stock that cuts
 * the layers is in whichever layer each hole happens to meet it in, at any
 * height. Each hole counts once, by its longest stretch of the unit. How
 * far down a layer it is can be told only where the hole shows both the top
 * and the base of that layer.
 */
export function keepsHeight(runs: LoggedRuns, layers: readonly string[], unit: string): KeepsHeight {
    const none: KeepsHeight = { follows: false, host: [], holes: 0, of: 0, at: null, why: '' };
    const read = passOver(runs, new Set(runs.units.filter(u => u !== unit && !layers.includes(u))));
    const c = read.units.indexOf(unit);
    if (c < 0) return none;
    const layerOf = new Int32Array(read.units.length).fill(-1);
    layers.forEach((l, j) => { const k = read.units.indexOf(l); if (k >= 0) layerOf[k] = j; });
    const places = new Map<string, { host: number[]; holes: number; down: number[] }>();
    let of = 0, stretches = 0;
    for (const h of read.holes) {
        let best = -1;
        for (let i = 0; i < h.unit.length; i++) {
            if (h.unit[i] !== c) continue;
            stretches++;
            if (best < 0 || h.length[i] > h.length[best]) best = i;
        }
        if (best < 0) continue;
        of++;
        let above = best > 0 ? layerOf[h.unit[best - 1]] : -1, below = best + 1 < h.unit.length ? layerOf[h.unit[best + 1]] : -1;
        if (above < 0 || below < 0) continue;
        // (A stray interval right beside it, with as much again of the layer on its other side beyond: it lies inside that layer)
        // (The shorter of the two beside it is the one that may be the stray)
        if (above !== below) {
            const up = h.length[best - 1], down = h.length[best + 1];
            if (up <= down) { if (best >= 2 && layerOf[h.unit[best - 2]] === below && h.length[best - 2] >= up) above = below; }
            else if (best + 2 < h.unit.length && layerOf[h.unit[best + 2]] === above && h.length[best + 2] >= down) below = above;
        }
        const host = above === below ? [above] : [above, below];
        const key = host.join('|');
        let place = places.get(key);
        if (!place) places.set(key, place = { host, holes: 0, down: [] });
        place.holes++;
        // (How far down the layer: only where the hole shows the layer's top and its base. The layer either side of it is
        //  read through its stray intervals: a stretch of something else with as much of the layer again beyond it)
        if (above === below) {
            const reach = (step: 1 | -1): { metres: number; end: number } => {
                let metres = 0, end = best;
                for (let i = best + step; i >= 0 && i < h.unit.length; i += step) {
                    if (layerOf[h.unit[i]] === above) { metres += h.length[i]; end = i; continue; }
                    const beyond = i + step;
                    if (beyond < 0 || beyond >= h.unit.length || layerOf[h.unit[beyond]] !== above || h.length[beyond] < h.length[i]) break;
                    metres += h.length[i];
                }
                return { metres, end };
            };
            const over = reach(-1), under = reach(1);
            if (over.end > 0 && under.end < h.unit.length - 1 && over.metres + under.metres > 0) place.down.push(over.metres / (over.metres + under.metres));
        }
    }
    if (of < FOLLOWS_HOLES) return { ...none, of };
    const place = [...places.values()].sort((a, b) => b.holes - a.holes)[0];
    const holesText = (n: number) => `${n.toLocaleString()} of its ${of.toLocaleString()} holes`;
    if (stretches > FOLLOWS_A_HOLE * of) return { ...none, of, why: `it is met ${(stretches / of).toFixed(1)} times a hole: several sheets, with no one place in the pile` };
    if (!place || place.holes < FOLLOWS_SHARE * of) {
        const most = place ? `; the most in one place is ${holesText(place.holes)}, ${place.host.length === 1 ? `inside ${layers[place.host[0]]}` : `between ${layers[place.host[0]]} and ${layers[place.host[1]]}`}` : '';
        return { ...none, of, host: place ? place.host.map(j => layers[j]) : [], holes: place?.holes ?? 0, why: `it has no one place in the pile${most}` };
    }
    const host = place.host.map(j => layers[j]);
    if (host.length === 2) {
        return { follows: true, host, holes: place.holes, of, at: null, why: `it lies between ${host[0]} and ${host[1]} in ${holesText(place.holes)}: it keeps to their contact, and follows the layers` };
    }
    if (place.down.length < FOLLOWS_HOLES) {
        return { ...none, of, host, holes: place.holes, why: `it lies inside ${host[0]} in ${holesText(place.holes)}, but too few of them show both the top and the base of ${host[0]} to say whether it keeps one height in it` };
    }
    const down = [...place.down].sort((a, b) => a - b);
    const q = (p: number) => down[Math.min(down.length - 1, Math.max(0, Math.round(p * (down.length - 1))))];
    const at = { usual: q(0.5), from: q(0.25), to: q(0.75) };
    const percent = (v: number) => `${Math.round(100 * v)}%`;
    const where = `it lies inside ${host[0]} in ${holesText(place.holes)}, in half of them between ${percent(at.from)} and ${percent(at.to)} of the way down it`;
    if (at.to - at.from > FOLLOWS_SPREAD) return { ...none, of, host, holes: place.holes, at, why: `${where}: at no one height in it, so it cuts across the layers` };
    return { follows: true, host, holes: place.holes, of, at, why: `${where}: it keeps its place in the pile, and follows the layers` };
}

/** A unit is said to take the place of layers when, in this many holes at least that show what lies above and below it ... */
export const REPLACES_HOLES = 3;
/** ... and in this share of them ... */
export const REPLACES_SHARE = 0.75;
/** ... this many layers at least that the other holes have between the two are missing */
export const REPLACES_LAYERS = 2;
/** A layer counts as missing only where it is usually there: met in this share of the other holes that pass through its place */
export const USUALLY_THERE = 0.5;
/** A hole's stretches of the unit are read as one body where the unit is this share of the hole from its first to its last */
export const ONE_BODY = 2 / 3;
/** A stretch of a layer under this share of what that layer usually is in the other holes is not taken for the layer above or below the unit: a stray interval */
export const STRAY_SHARE = 0.25;

/** Whether a unit takes the place of layers where it is met, as the logging has it */
export interface TakesPlace {
    /** It does: a body that cuts across the layers (a stock, a plug), not one of them */
    cuts: boolean;
    /** The holes in which layers are missing across it, and the holes that show what lies above and below it */
    holes: number;
    of: number;
    /** The layers missing across it, those missing most often first */
    missing: string[];
    /** The counts that say so, in words ('' when no hole shows both what is above and what is below it) */
    why: string;
}

/**
 * Whether a unit takes the place of layers (`layers`: the others, the
 * youngest first; units that are not among them are passed over). A layer
 * lies between the layer above it and the layer below it wherever it is
 * met. A stock that cuts the pile is met with one layer above it and a much
 * older one below, and the layers the other holes have between those two
 * are not there: it lies where they should be. It does not lie "inside"
 * any one unit, so nothing else says it cuts across. Each hole is read as a
 * pile either side of the unit (pile.ts), and a stretch much shorter than
 * its layer usually is counts for nothing, so a stray interval is not taken
 * for what lies above or below it; its stretches in a hole are one body
 * where they make up most of the hole between the first and the last, and
 * else the longest is taken. A layer that comes and goes anyway (met in
 * under half of the other holes that pass through its place) is not counted
 * as missing.
 */
export function takesPlace(runs: LoggedRuns, layers: readonly string[], unit: string): TakesPlace {
    const none: TakesPlace = { cuts: false, holes: 0, of: 0, missing: [], why: '' };
    const read = passOver(runs, new Set(runs.units.filter(u => u !== unit && !layers.includes(u))));
    const c = read.units.indexOf(unit), n = layers.length;
    if (c < 0 || n < REPLACES_LAYERS + 2) return none;
    const rank = ranksOf(read, layers, []);
    const passes = new Int32Array(n), met = new Int32Array(n);
    // What each layer usually is down a hole that does not meet the unit (the middle of its stretches kept by the pile)
    const lengths: number[][] = layers.map(() => []);
    for (const h of read.holes) {
        if (h.unit.includes(c)) continue;
        const pile = pileOfHole(Array.from(h.unit, u => rank[u]), h.length, n);
        h.unit.forEach((u, i) => { if (pile.kept[i] && rank[u] >= 0) lengths[rank[u]].push(h.length[i]); });
    }
    const usually = lengths.map(l => (l.length ? l.sort((a, b) => a - b)[l.length >> 1] : 0));
    const across: [number, number][] = [];
    for (const h of read.holes) {
        let first = -1, last = -1, longest = -1, of = 0;
        for (let i = 0; i < h.unit.length; i++) {
            if (h.unit[i] !== c) continue;
            if (first < 0) first = i;
            last = i;
            of += h.length[i];
            if (longest < 0 || h.length[i] > h.length[longest]) longest = i;
        }
        if (first < 0) {
            // A hole without it: which layers it meets, of those it passes through the place of
            const pile = pileOfHole(Array.from(h.unit, u => rank[u]), h.length, n);
            const kept = Array.from(h.unit, (u, i) => (pile.kept[i] ? rank[u] : -1)).filter(r => r >= 0);
            if (kept.length < 2) continue;
            const lo = Math.min(...kept), hi = Math.max(...kept);
            for (let r = lo + 1; r < hi; r++) { passes[r]++; if (kept.includes(r)) met[r]++; }
            continue;
        }
        let zone = 0;
        for (let i = first; i <= last; i++) zone += h.length[i];
        if (of < ONE_BODY * zone) first = last = longest;
        // What is above and below it, the rest of the hole read as a pile
        const rest = [...Array.from({ length: first }, (_, i) => i), ...Array.from({ length: h.unit.length - 1 - last }, (_, i) => last + 1 + i)];
        const pile = pileOfHole(rest.map(i => rank[h.unit[i]]), rest.map(i => h.length[i]), n);
        let above = -1, below = -1;
        rest.forEach((i, k) => {
            if (!pile.kept[k] || rank[h.unit[i]] < 0 || h.length[i] < STRAY_SHARE * usually[rank[h.unit[i]]]) return;
            if (i < first) above = rank[h.unit[i]];
            else if (below < 0) below = rank[h.unit[i]];
        });
        if (above < 0 || below < 0) continue;
        across.push([Math.min(above, below), Math.max(above, below)]);
    }
    if (across.length === 0) return none;
    const usual = (r: number) => passes[r] > 0 && met[r] >= USUALLY_THERE * passes[r];
    const times = new Int32Array(n);
    let holes = 0;
    for (const [lo, hi] of across) {
        const gone: number[] = [];
        for (let r = lo + 1; r < hi; r++) if (usual(r)) gone.push(r);
        if (gone.length < REPLACES_LAYERS) continue;
        holes++;
        for (const r of gone) times[r]++;
    }
    const of = across.length;
    const missing = layers.map((_, r) => r).filter(r => times[r] > 0).sort((a, b) => times[b] - times[a] || a - b).map(r => layers[r]);
    const shows = `${of.toLocaleString()} hole${of === 1 ? '' : 's'} that show${of === 1 ? 's' : ''} what lies above and below it`;
    if (holes === 0) return { ...none, of, why: `in the ${shows}, no layers are missing across it` };
    const where = `in ${holes.toLocaleString()} of its ${shows}, layers the other holes have between the two are missing (${listOf(missing)})`;
    if (of < REPLACES_HOLES || holes < REPLACES_SHARE * of) return { cuts: false, holes, of, missing, why: where };
    return { cuts: true, holes, of, missing, why: `${where}: it takes their place, and cuts across them` };
}

/** A layer's base cuts down through older layers when it lies straight on this many of them ... */
export const EROSION_LAYERS = 3;
/** ... each in this many holes at least, and in this share of the holes that show what it lies on */
export const EROSION_TIMES = 2;
export const EROSION_SHARE = 0.15;

/**
 * What the base of a layer lies on, hole by hole (`layers`: the youngest
 * first; units that are not layers are passed over): the older layers it
 * lies straight on, with how many holes show each, the most first. A hole
 * shows one base: what is under the deepest stretch of the layer in it. (A
 * stretch with the same layer above and below is a stray interval or a lens
 * inside that layer, and is not the layer's base: the one above it is
 * looked at instead.) Tried on a made-up pile of five layers with intervals
 * logged as the wrong unit: no layer of it is taken for an erosion surface
 * with 6% or 15% of the logging wrong; with 30% wrong two of them come
 * within a hole of it. A layer laid down in its turn lies on the one layer
 * under it, and now and then on the next where that one is missing. One
 * whose base lies on several older layers, each in a real share of the
 * holes, was laid on ground worn down across them: `cuts` is then true, and
 * its base is an erosion surface.
 */
export function liesOn(runs: LoggedRuns, layers: readonly string[], layer: string): { on: { unit: string; times: number }[]; cuts: boolean } {
    const read = passOver(runs, new Set(runs.units.filter(u => !layers.includes(u))));
    const k = read.units.indexOf(layer), j = layers.indexOf(layer);
    if (k < 0 || j < 0) return { on: [], cuts: false };
    const count = new Map<number, number>();
    for (const h of read.holes) {
        for (let i = h.unit.length - 1; i >= 0; i--) {
            if (h.unit[i] !== k || (i > 0 && i + 1 < h.unit.length && h.unit[i - 1] === h.unit[i + 1])) continue;
            // (The hole stops in it: its base is not seen)
            if (i + 1 < h.unit.length) count.set(h.unit[i + 1], (count.get(h.unit[i + 1]) ?? 0) + 1);
            break;
        }
    }
    const on = layers.slice(j + 1)
        .map(unit => ({ unit, times: count.get(read.units.indexOf(unit)) ?? 0 }))
        .filter(x => x.times > 0)
        .sort((a, b) => b.times - a.times);
    const total = on.reduce((a, x) => a + x.times, 0);
    const real = on.filter(x => x.times >= EROSION_TIMES && x.times >= EROSION_SHARE * total);
    return { on, cuts: real.length >= EROSION_LAYERS };
}

export interface ChronologyProposal {
    /**
     * Every unit, in the order proposed, the youngest first: the layers; a unit that cuts across them under the
     * layer it is older than, or at the top where it is the youngest; a unit not in the model where it was in the list
     */
    order: string[];
    /** What each unit is proposed to be */
    kinds: Record<string, UnitPlan>;
    /** For a unit proposed as cutting across the layers, and for a layer proposed as an erosion surface: the count that says so */
    why: Record<string, string>;
    /** For every unit that cuts across the layers: its age, and the counts that say so */
    age: Record<string, CutAge>;
    /** The units that cut across and keep one place in the pile from hole to hole (`keepsHeight`): they follow the layers. The counts that say so */
    follows: Record<string, string>;
    bound: Bound;
}

const isLayer = (k: UnitPlan | undefined) => k === undefined || k === 'deposit' || k === 'erosion';

/**
 * What the places of a unit that cuts across say of its form, which its
 * stretches down the holes alone do not (`unitShapes`, geoModelActions.ts)
 */
export interface UnitShape {
    /** As a body it is thin against the gaps between its holes */
    thin?: boolean;
    /** Told apart into the veins of a system: its stretches, and those of them that cannot be given to one sheet or another (null: not told apart) */
    apart?: { zones: number; out: number } | null;
}
/**
 * A set of thin sheets is a vein system only where no more than this share
 * of its stretches cannot be given to one sheet or another. (Six made-up
 * dykes 13 m apart, drilled six ways: 5 to 22% of their stretches. A real
 * set of dykes that split and rejoin within metres: 67%.)
 */
export const APART_SHARE = 1 / 3;

/**
 * A proposal with the forms its units' places ask for. A set of thin sheets
 * proposed as a vein system, of whose stretches more than `APART_SHARE`
 * cannot be given to one sheet or another, is proposed as an intrusion of
 * thin sheets: what is logged, carried along the plane of the sheets and
 * drawn only near its holes. (A vein of each sheet says which sheet every
 * stretch is of; where the logging cannot say, the veins were wedges between
 * drives two to three times as wide as the holes log.) An intrusion that is
 * thin against the gaps between its holes is thin sheets too: as a plain
 * intrusion it comes out as beads round its holes. `plan`: a unit the plan
 * has as a vein system stays one.
 */
export function shapeProposal(p: ChronologyProposal, shapes: Readonly<Record<string, UnitShape | undefined>>, plan: Readonly<Record<string, UnitPlan | undefined>> = {}): ChronologyProposal {
    const kinds = { ...p.kinds }, why = { ...p.why };
    for (const u of Object.keys(shapes)) {
        const s = shapes[u];
        if (!s) continue;
        const said = why[u] ? `${why[u].replace(/, a vein system$/, '')}; ` : '';
        if (kinds[u] === 'veinSystem' && plan[u] !== 'veinSystem' && s.apart && s.apart.out > APART_SHARE * s.apart.zones) {
            kinds[u] = 'sheets';
            why[u] = `${said}${s.apart.out} of its ${s.apart.zones} stretches cannot be given to one sheet or another, so not a vein system: an intrusion of thin sheets, what is logged carried along the plane of the sheets`;
        } else if (kinds[u] === 'intrusion' && s.thin) {
            kinds[u] = 'sheets';
            why[u] = `${said}thin against the gaps between its holes: an intrusion of thin sheets`;
        }
    }
    return { ...p, kinds, why };
}

/** The layers (in the order listed) and the units that cut across them, of a plan */
export function planParts(units: readonly string[], plan: Readonly<Record<string, UnitPlan | undefined>>): { layers: string[]; cutting: string[] } {
    return { layers: units.filter(u => isLayer(plan[u])), cutting: units.filter(u => cutsAcross(plan[u])) };
}

/**
 * What the logging proposes for a list of units (`units`: as listed, the
 * youngest first). Units the plan leaves out of the model stay out, a vein
 * stays a vein, and an erosion surface stays one where it stays a layer.
 * The rest: a unit most of whose stretches (and a quarter of whose metres) lie inside one other unit, and
 * that is not met again and again down a hole, does not stack as a layer and
 * is proposed as cutting across them (taken one at a time, the clearest
 * first, since taking one out joins the stretches either side of it); the
 * layers left are put in the order the holes agree with best. One unit at
 * least stays a layer. Units that alternate are left as layers (`alternating`
 * says which they are): calling them bodies would match the logging on paper
 * and say nothing true. But a unit met again and again that is a small part
 * of the one unit its stretches lie in is thin sheets in a host (`veinSet`):
 * it is proposed as a vein system: a vein of each sheet that can be told
 * apart (the form that carries furthest from the holes, and the one edited a
 * vein at a time). What the plan has as a vein, as thin sheets or as a vein
 * system stays that.
 *
 * A unit left a layer that takes the place of layers where it is met
 * (`takesPlace`: a stock, which lies inside no one unit) is proposed as
 * cutting across them too.
 *
 * A layer whose base lies straight on three or more older layers (`liesOn`)
 * is proposed as an erosion surface, where it is a deposit.
 *
 * A unit that cuts across and keeps one place in the pile from hole to hole
 * (`keepsHeight`) is said to follow the layers: a sill, a stratabound lode.
 *
 * A unit that cuts across is given its age (`cutsOf`): under the layer it is
 * older than, or the youngest. A layer it lies directly under, and is never
 * in, was laid on ground it had been worn off with: where that layer is a
 * deposit it is proposed as an erosion surface (a deposit does not bury an
 * intrusion, an erosion surface cuts it).
 */
export function proposeChronology(runs: LoggedRuns, units: readonly string[], plan: Readonly<Record<string, UnitPlan | undefined>> = {}): ChronologyProposal {
    const kinds: Record<string, UnitPlan> = {};
    for (const u of units) kinds[u] = plan[u] === 'none' || plan[u] === 'vein' || plan[u] === 'sheets' || plan[u] === 'veinSystem' || plan[u] === 'erosion' ? plan[u]! : 'deposit';
    const why: Record<string, string> = {};
    // Thin sheets met again and again inside one host: veins (seen with every unit in place: taking one out joins its neighbours)
    {
        const layers = units.filter(u => isLayer(kinds[u]));
        const m = contactMatrix(passOver(runs, new Set(runs.units.filter(u => !layers.includes(u)))));
        for (let k = 0; k < m.units.length && layers.length > 1; k++) {
            if (!layers.includes(m.units[k]) || !veinSet(m, k)) continue;
            // (One unit at least stays a layer)
            if (units.filter(u => isLayer(kinds[u])).length < 2) break;
            kinds[m.units[k]] = 'veinSystem';
            why[m.units[k]] = `met ${(m.stretches[k] / m.holes[k]).toFixed(1)} times a hole, and ${insideText(m, k)}: thin sheets side by side, a vein system`;
        }
    }
    for (;;) {
        const layers = units.filter(u => isLayer(kinds[u]));
        if (layers.length < 2) break;
        const m = contactMatrix(passOver(runs, new Set(runs.units.filter(u => !layers.includes(u)))));
        let pick = -1;
        for (let k = 0; k < m.units.length; k++) {
            if (!layers.includes(m.units[k]) || m.inside[k] < INSIDE_STRETCHES || m.inside[k] < INSIDE_SHARE * m.stretches[k] || m.insideMetres[k] < INSIDE_METRES * m.metres[k]) continue;
            // (Met again and again down a hole: it alternates with its neighbours, it does not cut across them)
            if (m.stretches[k] > STRETCHES_A_HOLE * m.holes[k]) continue;
            const share = m.inside[k] / m.stretches[k];
            if (pick < 0 || share > m.inside[pick] / m.stretches[pick] + 1e-12 || (Math.abs(share - m.inside[pick] / m.stretches[pick]) <= 1e-12 && m.metres[k] < m.metres[pick])) pick = k;
        }
        if (pick < 0) break;
        kinds[m.units[pick]] = 'intrusion';
        why[m.units[pick]] = insideText(m, pick);
    }
    // A body that lies inside no one unit but takes the place of several layers (a stock): the clearest first
    const replaced: Record<string, string[]> = {};
    for (;;) {
        const layers = units.filter(u => isLayer(kinds[u]));
        if (layers.length < REPLACES_LAYERS + 3) break;
        const order = proposeOrder(runs, layers);
        let pick: { unit: string; found: TakesPlace } | null = null;
        // (Kept: what it takes the place of says what it cuts)
        for (const u of order) {
            if (kinds[u] !== 'deposit') continue;
            const found = takesPlace(runs, order.filter(x => x !== u), u);
            if (found.cuts && (!pick || found.holes * pick.found.of > pick.found.holes * found.of)) pick = { unit: u, found };
        }
        if (!pick) break;
        kinds[pick.unit] = 'intrusion';
        why[pick.unit] = pick.found.why;
        replaced[pick.unit] = pick.found.missing;
    }
    const { layers, cutting } = planParts(units, kinds);
    const sorted = proposeOrder(runs, layers);
    for (const l of sorted) {
        if (kinds[l] !== 'deposit') continue;
        const lies = liesOn(runs, sorted, l);
        if (!lies.cuts) continue;
        kinds[l] = 'erosion';
        const real = lies.on.filter(x => x.times >= EROSION_TIMES && x.times >= EROSION_SHARE * lies.on.reduce((a, y) => a + y.times, 0));
        why[l] = `its base lies on ${listOf(real.map((x, i) => (i === 0 ? `${x.unit} in ${x.times.toLocaleString()} holes` : `${x.unit} in ${x.times.toLocaleString()}`)))}: it cuts down through them, an erosion surface`;
    }
    const age: Record<string, CutAge> = {};
    const follows: Record<string, string> = {};
    for (const c of cutting) {
        const keeps = keepsHeight(runs, sorted, c);
        // (A stock is met between the same two layers in every hole too, the one above it and the one below: that is not keeping a place in the pile)
        if (keeps.follows && !replaced[c]) follows[c] = keeps.why;
        const a = age[c] = cutsOf(runs, sorted, c, replaced[c]);
        if (a.under !== null && a.stops >= STOPS_UNDER && kinds[a.under] === 'deposit') {
            kinds[a.under] = 'erosion';
            why[a.under] = `${c} lies directly under it ${times(a.stops)} and is never in it: its base cuts ${c}, an erosion surface`;
        }
    }
    // Of two that cut across and go in the same place, one that lies inside the other is the younger
    const all = contactMatrix(runs);
    const inside = (a: string, b: string) => all.host[all.units.indexOf(a)]?.[all.units.indexOf(b)] ?? 0;
    const placedAt = (under: string | null) => {
        const group = cutting.filter(c => age[c].under === under);
        for (let pass = 0; pass < group.length; pass++) {
            for (let i = 0; i + 1 < group.length; i++) {
                const a = group[i], b = group[i + 1];
                if (inside(b, a) >= CUTS_STRETCHES && inside(b, a) > inside(a, b)) [group[i], group[i + 1]] = [b, a];
            }
        }
        return group;
    };
    const arranged = [...placedAt(null), ...sorted.flatMap(l => [l, ...placedAt(l)])];
    let next = 0;
    const order = units.map(u => (kinds[u] === 'none' ? u : arranged[next++]));
    return { order, kinds, why, age, follows, bound: bestAgreement(runs, sorted, cutting) };
}

/** True when `a` is the better of two readings of the same logging: it matches more, or as much with fewer holes read from the bottom up */
export function betterBound(a: Bound, b: Bound): boolean {
    return a.metres > b.metres + 1e-6 || (a.metres > b.metres - 1e-6 && a.up < b.up);
}

/** "at most 83% of the 1,350 m logged" (0 m logged: an empty string). `cleaned`: said of the logging with its short stretches cleaned */
export function boundText(b: Bound, cleaned = false): string {
    if (!(b.of > 0)) return '';
    // (Rounded as the check against drilling rounds what a built model matches: the two are read side by side)
    return `at most ${sharePercent(b.metres, b.of)}% of the ${Math.round(b.of).toLocaleString()} m ${cleaned ? 'of logging as cleaned' : 'logged'}`;
}
