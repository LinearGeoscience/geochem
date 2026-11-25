/**
 * The veins of a set (pure, unit-tested): several veins made of the same
 * units, each with the stretches down the holes that are its own
 * (`BodyRule.vein.picks`, as lodes.ts suggests them). Which vein a stretch
 * is of is the geologist's to say: a stretch is moved from one vein to
 * another, given to one, or taken out of them all, and each vein that
 * changes is built again from its own.
 *
 * One wall of a stretch alone (hangingwall or footwall only) is not said
 * here: leaving out the contact of the other wall does that, among a
 * vein's contacts one by one (contactControl.ts).
 */
import type { Zone } from './lodes';
import type { BodyRule, SurfaceObject, SurfaceRule } from './types';

type OwnPick = { hole: string; depth: number };

/** A vein that is one of several its units make: its rule (null: any other surface) */
export function lodeRule(rule: SurfaceRule): (BodyRule & { vein: NonNullable<BodyRule['vein']> & { picks: OwnPick[] } }) | null {
    return rule.kind === 'body' && rule.vein?.picks ? rule as BodyRule & { vein: NonNullable<BodyRule['vein']> & { picks: OwnPick[] } } : null;
}

/** Two veins of one set: both read the same units of the same logging, each by its own stretches */
export function sameSet(a: SurfaceRule, b: SurfaceRule): boolean {
    const p = lodeRule(a), q = lodeRule(b);
    if (!p || !q || p.column !== q.column || (p.table ?? null) !== (q.table ?? null) || (p.units ?? null) !== (q.units ?? null)) return false;
    return p.inside.length === q.inside.length && p.inside.every(u => q.inside.includes(u));
}

/** The veins of the set a surface is in, itself among them, in the order of the scene (none: it is not one of a set) */
export function veinsOfSet(surfaces: readonly SurfaceObject[], surface: SurfaceObject): SurfaceObject[] {
    return lodeRule(surface.rule) ? surfaces.filter(s => s.id === surface.id || (!s.blockOf && sameSet(s.rule, surface.rule))) : [];
}

const setRules = new WeakMap<BodyRule, BodyRule>();

/**
 * A vein's rule as its set's: every stretch of the units, none picked out,
 * and nothing done to the contacts by hand. The same rule gives the same
 * object each time, so that what the logging gives for it is worked out
 * once.
 */
export function setRule(rule: BodyRule): BodyRule {
    let plain = setRules.get(rule);
    if (!plain) {
        const { control: _control, ...rest } = rule;
        const { picks: _picks, ...vein } = rule.vein ?? { least: 0 };
        plain = { ...rest, vein };
        setRules.set(rule, plain);
    }
    return plain;
}

const within = (zone: Pick<Zone, 'hole' | 'lo' | 'hi'>, pick: OwnPick) => pick.hole === zone.hole && pick.depth >= zone.lo - 1e-6 && pick.depth <= zone.hi + 1e-6;

/** The vein each stretch is of: its surface's id (null: of none of them). The first vein to pick a stretch has it. */
export function stretchOwners(zones: readonly Zone[], veins: readonly SurfaceObject[]): (string | null)[] {
    const byHole = new Map<string, { id: string; depth: number }[]>();
    for (const v of veins) for (const pick of lodeRule(v.rule)?.vein.picks ?? []) {
        const list = byHole.get(pick.hole);
        if (list) list.push({ id: v.id, depth: pick.depth }); else byHole.set(pick.hole, [{ id: v.id, depth: pick.depth }]);
    }
    return zones.map(z => byHole.get(z.hole)?.find(p => p.depth >= z.lo - 1e-6 && p.depth <= z.hi + 1e-6)?.id ?? null);
}

/**
 * A stretch given to one vein of the set (`to`: its surface's id; null: to
 * none). The rules that change, by surface: the vein that had it loses it,
 * the one it goes to gains it, and no other is touched.
 */
export function giveStretch(veins: readonly SurfaceObject[], zone: Zone, to: string | null): { id: string; rule: BodyRule }[] {
    const out: { id: string; rule: BodyRule }[] = [];
    for (const v of veins) {
        const rule = lodeRule(v.rule);
        if (!rule) continue;
        const had = rule.vein.picks.some(p => within(zone, p));
        if (v.id === to ? had : !had) continue;
        const picks = rule.vein.picks.filter(p => !within(zone, p));
        if (v.id === to) picks.push({ hole: zone.hole, depth: zone.inside });
        out.push({ id: v.id, rule: { ...rule, vein: { ...rule.vein, picks } } });
    }
    return out;
}

/** A stretch's depths down its hole, in words */
export function stretchDepths(zone: Zone): string {
    const m = (v: number) => `${Number(v.toFixed(2))}`;
    if (!zone.open) return `${m(zone.from)} to ${m(zone.to)} m`;
    return zone.hi > zone.from + 1e-6 ? `from ${m(zone.from)} m (the hole stops in it)` : `to ${m(zone.to)} m (the hole starts in it)`;
}

/** The stretch of a hole at a depth down it: the one the depth is in, else the nearest within `near` m (null: none) */
export function stretchAt(zones: readonly Zone[], hole: string, depth: number, near = 2): Zone | null {
    let best: Zone | null = null, away = near;
    for (const z of zones) {
        if (z.hole !== hole) continue;
        const lo = Math.min(z.from, z.to, z.open && Number.isFinite(z.lo) ? z.lo : Infinity), hi = Math.max(z.from, z.to, z.open && Number.isFinite(z.hi) ? z.hi : -Infinity);
        const d = depth < lo ? lo - depth : depth > hi ? depth - hi : 0;
        if (d <= away) { away = d; best = z; if (d === 0) break; }
    }
    return best;
}

/** The stretch nearest a place, by its middle, within `near` m (null: none) */
export function stretchNear(zones: readonly Zone[], p: ArrayLike<number>, near: number): Zone | null {
    let best: Zone | null = null, away = near;
    for (const z of zones) {
        const d = Math.hypot(z.p[0] - p[0], z.p[1] - p[1], z.p[2] - p[2]);
        if (d <= away) { away = d; best = z; }
    }
    return best;
}
