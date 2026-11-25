/**
 * Holes that lie together (pure, unit-tested).
 *
 * A model is checked by keeping holes out, building it from the rest and
 * reading the kept-out holes against it. That is only a fair test when a
 * kept-out hole has no twin left in: face lines a few metres apart along a
 * drive, or holes fanned from one collar, say nearly the same thing, and one
 * of them kept out alone is read straight from its neighbours. So holes that
 * lie together are found as groups, and a group is kept out whole.
 *
 *  - a line: flat holes (within `flat` degrees of level at their middle) on
 *    one level (their middles within `level` m in height) and within `link`
 *    m of each other in plan: the face lines of one drive;
 *  - a fan: holes whose collars are within `fan` m of each other.
 * Groups that share a hole are one group. A hole in neither is on its own.
 */
import type { Vec3 } from './types';

export interface GroupHole {
    collar: Vec3;
    /** Where the hole is half way down it */
    middle: Vec3;
    /** Unit, down the hole there */
    direction: Vec3;
}

export interface HoleGroupOptions {
    /** A hole this near level, degrees, is a flat one */
    flat?: number;
    /** Flat holes whose middles are this near in height, m, are on one level */
    level?: number;
    /** ... and this near in plan, m, are of one line */
    link?: number;
    /** Collars this near each other, m, are one fan */
    fan?: number;
}

export const GROUP_DEFAULTS: Required<HoleGroupOptions> = { flat: 20, level: 2.5, link: 10, fan: 2 };

export type HoleGroupKind = 'line' | 'fan' | 'mixed' | 'single';

export interface HoleGroups {
    /** Per hole, the group it is in */
    of: Int32Array;
    /** Each group's holes, the largest group first; and what joined it */
    groups: number[][];
    kinds: HoleGroupKind[];
    /** Per hole: flat or not */
    flat: Uint8Array;
}

export function holeGroups(holes: readonly GroupHole[], options: HoleGroupOptions = {}): HoleGroups {
    const o = { ...GROUP_DEFAULTS, ...options };
    const n = holes.length;
    const parent = Int32Array.from({ length: n }, (_, i) => i);
    const root = (i: number): number => {
        let r = i;
        while (parent[r] !== r) r = parent[r];
        while (parent[i] !== r) { const next = parent[i]; parent[i] = r; i = next; }
        return r;
    };
    const flat = new Uint8Array(n);
    const sinFlat = Math.sin((o.flat * Math.PI) / 180);
    for (let i = 0; i < n; i++) {
        const d = holes[i].direction, len = Math.hypot(d[0], d[1], d[2]);
        flat[i] = len > 0 && Math.abs(d[2]) / len < sinFlat ? 1 : 0;
    }
    // What joined each pair: 1 a line, 2 a fan
    const how = new Uint8Array(n);
    const join = (i: number, j: number, as: number) => {
        const a = root(i), b = root(j);
        const both = how[a] | how[b] | as;
        if (a !== b) parent[a] = b;
        how[b] = both;
    };
    // In order of easting (the lesser of a hole's collar and middle), so only holes near in x are compared: once one
    // starts further east than this hole reaches, so do all after it
    const reach = Math.max(o.link, o.fan);
    const least = (i: number) => Math.min(holes[i].middle[0], holes[i].collar[0]), most = (i: number) => Math.max(holes[i].middle[0], holes[i].collar[0]);
    const order = Array.from({ length: n }, (_, i) => i).sort((p, q) => least(p) - least(q));
    for (let p = 0; p < n; p++) {
        const i = order[p];
        for (let q = p + 1; q < n; q++) {
            const j = order[q];
            if (least(j) - most(i) > reach) break;
            const a = holes[i], b = holes[j];
            if (flat[i] && flat[j] && Math.abs(a.middle[2] - b.middle[2]) <= o.level && Math.hypot(a.middle[0] - b.middle[0], a.middle[1] - b.middle[1]) <= o.link) join(i, j, 1);
            else if (Math.hypot(a.collar[0] - b.collar[0], a.collar[1] - b.collar[1], a.collar[2] - b.collar[2]) <= o.fan) join(i, j, 2);
        }
    }
    const lists = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
        const r = root(i), list = lists.get(r);
        if (list) list.push(i); else lists.set(r, [i]);
    }
    const sorted = [...lists.entries()].sort((p, q) => q[1].length - p[1].length || p[1][0] - q[1][0]);
    const of = new Int32Array(n);
    const kinds: HoleGroupKind[] = [];
    sorted.forEach(([r, list], g) => {
        for (const i of list) of[i] = g;
        kinds.push(list.length === 1 ? 'single' : how[r] === 1 ? 'line' : how[r] === 2 ? 'fan' : 'mixed');
    });
    return { of, groups: sorted.map(e => e[1]), kinds, flat };
}

/**
 * The groups dealt into `lots`, as even in holes as they can be with no
 * group split: the largest first, each to the lot with the fewest holes so
 * far. Per hole, its lot. Fewer groups than lots leaves lots empty.
 */
export function groupLots(groups: readonly (readonly number[])[], lots: number): { of: Int32Array; sizes: number[] } {
    const count = Math.max(1, Math.floor(lots));
    const n = groups.reduce((t, g) => t + g.length, 0);
    const of = new Int32Array(n);
    const sizes = new Array<number>(count).fill(0);
    for (const list of [...groups].sort((a, b) => b.length - a.length)) {
        let lot = 0;
        for (let k = 1; k < count; k++) if (sizes[k] < sizes[lot]) lot = k;
        for (const h of list) if (h >= 0 && h < n) of[h] = lot;
        sizes[lot] += list.length;
    }
    return { of, sizes };
}
