/**
 * The veins of a set told apart (pure, unit-tested): where holes go
 * through a unit several times each, which of the stretches are one vein
 * (a lode) from hole to hole.
 *
 * A stretch is where a hole goes through the unit, or starts or stops in it,
 * after stretches close together are read as one zone (contacts.ts). Two stretches of
 * different holes are of one lode when they are near each other along the
 * plane the sheets lie in and nearly level with each other across it. Pairs
 * are joined nearest-across first, and two stretches of one hole are never
 * one lode: a hole that goes through the unit three times has met three
 * lodes, or the same one folded back, which this does not look for.
 *
 * It is a suggestion. What a geologist sees in a section is better
 * evidence than which stretch is nearest, and where lodes are closer
 * together across the plane than stretches are along it, nearness cannot
 * tell them apart: `unsure` counts the stretches that have a stretch of
 * another lode about as level with them as the nearest of their own.
 */
import type { ContactInputs } from './contacts';
import { planeOfMany } from './plane';
import { autoReach } from './surfaceJobs';
import type { Vec3 } from './types';

/**
 * A stretch of the unit down a hole: the depths of its two walls, and its
 * middle. `open`: the hole starts or stops inside it, so one wall only is
 * known: `from` and `to` are both that wall's depth, and `p` is where it is.
 * `inside`: a depth inside the stretch, what picks it out for a vein
 * (`BodyRule.vein.picks`). `lo` to `hi`: the depths as logged that are this
 * stretch and no other (to the next contact of the hole, or without end,
 * where the hole starts or stops in it): a pick between them is of it.
 */
export interface Zone {
    hole: string;
    from: number;
    to: number;
    p: Vec3;
    open?: true;
    inside: number;
    lo: number;
    hi: number;
}

/** A depth this far past a wall is inside the stretch, m */
const JUST_INSIDE = 0.01;

/**
 * The stretches of the first side down the holes, as the contacts give them
 * (as a vein reads them, vein.ts `veinPicks`): those a hole goes right
 * through, and those a hole starts or stops in.
 */
export function zonesOf(found: Pick<ContactInputs, 'list'>): Zone[] {
    const zones: Zone[] = [];
    type Found = ContactInputs['list'][number];
    const used = found.list.filter(c => c.state !== 'ignored' && c.state !== 'uncrossed');
    // (The stretch is deeper than a wall the hole goes in at, and shallower than one it comes out at: as far as the next contact of the hole)
    const open = (k: number) => {
        const c = used[k], down = c.above === -1;
        const next = down ? used[k + 1] : used[k - 1];
        const far = next && next.hole === c.hole ? next.depth : down ? Infinity : -Infinity;
        zones.push({
            hole: c.hole, from: c.at, to: c.at, p: [c.p[0], c.p[1], c.p[2]], open: true, inside: c.depth + (down ? JUST_INSIDE : -JUST_INSIDE),
            lo: down ? c.depth : far, hi: down ? far : c.depth,
        });
    };
    let entered = -1;
    used.forEach((c: Found, k) => {
        if (entered >= 0 && used[entered].hole !== c.hole) { open(entered); entered = -1; }
        if (c.above === -1) {
            if (entered >= 0) open(entered);
            entered = k;
        } else if (entered >= 0) {
            const e = used[entered];
            zones.push({ hole: c.hole, from: e.at, to: c.at, p: [(e.p[0] + c.p[0]) / 2, (e.p[1] + c.p[1]) / 2, (e.p[2] + c.p[2]) / 2], inside: (e.depth + c.depth) / 2, lo: e.depth, hi: c.depth });
            entered = -1;
        } else open(k);
    });
    if (entered >= 0) open(entered);
    return zones;
}

export interface LodeChoice {
    /** Stretches further apart than this along the plane are not joined directly, m */
    reach: number;
    /** Two stretches of one lode are within this of each other across the plane, m ... */
    across: number;
    /** ... and this much more for every metre between them along it (the tangent of how far a lode may lie off the plane) */
    slope: number;
    /** A lode of fewer stretches than this is not a vein of its own */
    least: number;
}

/** How far off the plane a lode may lie: about six degrees (a plane worked out from the logging is good to about that) */
export const LODE_SLOPE = 0.1;
/** Stretches are joined directly over this many times the widest gap that has to be crossed to join them all */
export const LODE_REACH = 1.5;
export const LODE_LEAST = 4;
/** A stretch could as well be of another lode when one of its stretches is this near being as level with it as its own are (a share of what is allowed across) */
const UNSURE_WITHIN = 0.25;

const cost = (zones: readonly Zone[], w: ArrayLike<number>, i: number, j: number, o: Pick<LodeChoice, 'reach' | 'across' | 'slope'>): number => {
    const d = Math.hypot(zones[i].p[0] - zones[j].p[0], zones[i].p[1] - zones[j].p[1], zones[i].p[2] - zones[j].p[2]);
    const dw = Math.abs(w[i] - w[j]);
    const along = Math.sqrt(Math.max(0, d * d - dw * dw));
    if (along > o.reach) return Infinity;
    // (Of two pairs as level as each other, the nearer first)
    return dw / (o.across + o.slope * along) + 1e-3 * along / o.reach;
};

/**
 * The lode each stretch is in (numbers from 0, the biggest lode first).
 * `normal`: the unit normal of the plane the sheets lie in.
 */
export function groupLodes(zones: readonly Zone[], normal: ArrayLike<number>, o: Pick<LodeChoice, 'reach' | 'across' | 'slope'>): number[] {
    const n = zones.length;
    const w = zones.map(z => z.p[0] * normal[0] + z.p[1] * normal[1] + z.p[2] * normal[2]);
    const pairs: { i: number; j: number; cost: number }[] = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        if (zones[i].hole === zones[j].hole) continue;
        const c = cost(zones, w, i, j, o);
        if (c < 1) pairs.push({ i, j, cost: c });
    }
    pairs.sort((a, b) => a.cost - b.cost);
    const parent = Array.from({ length: n }, (_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const holes = zones.map(z => new Set([z.hole]));
    for (const { i, j } of pairs) {
        const a = find(i), b = find(j);
        if (a === b) continue;
        const [small, big] = holes[a].size < holes[b].size ? [a, b] : [b, a];
        let clash = false;
        for (const h of holes[small]) if (holes[big].has(h)) { clash = true; break; }
        if (clash) continue;
        for (const h of holes[small]) holes[big].add(h);
        parent[small] = big;
    }
    const sizes = new Map<number, number>();
    for (let i = 0; i < n; i++) sizes.set(find(i), (sizes.get(find(i)) ?? 0) + 1);
    const order = [...sizes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(e => e[0]);
    const number = new Map(order.map((root, k) => [root, k]));
    return zones.map((_, i) => number.get(find(i))!);
}

export interface Lode {
    /** Its stretches, as numbers into `zones` */
    zones: number[];
    /** The holes that meet it, and how much of them is inside it, m (of the stretches holes go right through) */
    holes: number;
    metres: number;
    /** Of its stretches, those a hole starts or stops in: one wall of it is known there */
    open: number;
    /** Where it is across the plane, m (the middle of its stretches): lodes in order of this are side by side */
    height: number;
    /** One place in each of its stretches, by hole and depth: what makes a vein of it (`BodyRule.vein.picks`) */
    picks: { hole: string; depth: number }[];
}

export interface LodeSuggestion {
    /** The plane the sheets are taken to lie in */
    normal: Vec3;
    zones: Zone[];
    /** The lode each stretch is in (a number into `lodes`), or -1: in none big enough to be a vein */
    lode: number[];
    /** The lodes big enough to be veins, the biggest first */
    lodes: Lode[];
    /** Stretches in no lode big enough */
    loose: number;
    /** Stretches with a stretch of another lode about as level with them as the nearest of their own: nearness alone does not say which they are of */
    unsure: number;
    choice: LodeChoice;
}

/** More stretches than this are not told apart (every pair of them is looked at) */
export const LODES_MOST = 4000;
/** It is worth saying that a unit is several veins when the lodes beside the biggest hold this share of the stretches in lodes */
const BESIDE_SHARE = 0.15;

/**
 * Whether a suggestion is worth showing: two lodes or more, with a fair
 * share of the stretches outside the biggest. Lodes side by side are often
 * met by different holes (short holes, each through one of them), so how
 * many times a hole goes through the unit does not say.
 */
export function severalLodes(s: LodeSuggestion | null): boolean {
    if (!s || s.lodes.length < 2) return false;
    const all = s.lodes.reduce((t, l) => t + l.zones.length, 0);
    return all - s.lodes[0].zones.length >= BESIDE_SHARE * all;
}

/**
 * The lodes a unit's stretches fall into. Null when there is nothing to
 * tell apart: no plane, or too few stretches. `join`: the distance within
 * which stretches were read as one zone (what is closer together than that
 * is one lode already); `plane`: the plane the sheets lie in, when the
 * contacts do not carry one.
 */
export function suggestLodes(found: Pick<ContactInputs, 'list' | 'joinPlane'>, options: Partial<LodeChoice> & { join?: number; plane?: Vec3 | null } = {}): LodeSuggestion | null {
    const zones = zonesOf(found);
    const mids = zones.flatMap(z => z.p);
    const normal = options.plane ?? found.joinPlane ?? planeOfMany(mids, 4);
    const least = Math.max(2, options.least ?? LODE_LEAST);
    if (!normal || zones.length < 2 * least || zones.length > LODES_MOST) return null;
    // Across: two stretches of one hole are a join length apart or more, so stretches of one lode in two holes are within half of it
    const choice: LodeChoice = {
        reach: options.reach ?? LODE_REACH * autoReach(mids),
        across: options.across ?? Math.max(1, (options.join ?? 0) / 2),
        slope: options.slope ?? LODE_SLOPE,
        least,
    };
    const group = groupLodes(zones, normal, choice);
    const w = zones.map(z => z.p[0] * normal[0] + z.p[1] * normal[1] + z.p[2] * normal[2]);
    const members = new Map<number, number[]>();
    group.forEach((g, i) => { const list = members.get(g); if (list) list.push(i); else members.set(g, [i]); });
    const lodes: Lode[] = [];
    const lode = new Array<number>(zones.length).fill(-1);
    let loose = 0;
    // (Groups are numbered biggest first already)
    for (const g of [...members.keys()].sort((a, b) => a - b)) {
        const list = members.get(g)!;
        if (list.length < least) { loose += list.length; continue; }
        for (const i of list) lode[i] = lodes.length;
        lodes.push({
            zones: list, holes: new Set(list.map(i => zones[i].hole)).size,
            metres: list.reduce((t, i) => t + Math.abs(zones[i].to - zones[i].from), 0),
            open: list.filter(i => zones[i].open).length,
            height: list.reduce((t, i) => t + w[i], 0) / list.length,
            picks: list.map(i => ({ hole: zones[i].hole, depth: zones[i].inside })),
        });
    }
    // A stretch is unsure when a stretch of another lode, within reach, is as level with it as the nearest of its own, or nearly
    let unsure = 0;
    for (let i = 0; i < zones.length; i++) {
        if (lode[i] < 0) continue;
        let own = Infinity, other = Infinity;
        for (let j = 0; j < zones.length; j++) {
            // (A stretch left in no lode is not of this one either)
            if (j === i || zones[i].hole === zones[j].hole) continue;
            const c = cost(zones, w, i, j, choice);
            if (lode[j] === lode[i]) own = Math.min(own, c); else other = Math.min(other, c);
        }
        if (other < 1 && other <= own + UNSURE_WITHIN) unsure++;
    }
    return { normal: [normal[0], normal[1], normal[2]], zones, lode, lodes, loose, unsure, choice };
}
