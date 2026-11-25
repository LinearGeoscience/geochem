/**
 * A vein system (pure, unit-tested): several veins made of the same units,
 * each by its own stretches down the holes (veinSet.ts), held as one
 * object. The veins are surfaces of the scene, each fitted on its own, so
 * that changing one fits that one again and no other.
 *
 * The system keeps them in an order, and a vein may stop at a vein before
 * it in that order (never one after, so no two can stop at each other):
 * it is then only on one side of that vein's reference surface, the side
 * most of its own stretches are on (`BodyRule.vein.endsOn`, with `middle`).
 */
import { lodeRule, sameSet } from './veinSet';
import type { BodyRule, ModelScene, SurfaceObject, VeinSystem } from './types';

/** At most this many vein systems in a scene, and veins in one of them */
export const MAX_VEIN_SYSTEMS = 20;
export const MAX_SYSTEM_VEINS = 40;

type Scene = Pick<ModelScene, 'surfaces' | 'veinSystems'>;

/** A surface that can be one of a system's veins: a vein, and not a part of another surface in a fault block */
export const isVein = (s: SurfaceObject): boolean => s.rule.kind === 'body' && !!s.rule.vein && !s.blockOf;

/** The system a vein is in (null: none) */
export function systemOf(scene: Scene, surfaceId: string): VeinSystem | null {
    return scene.veinSystems?.find(v => v.veins.includes(surfaceId)) ?? null;
}

/** The veins of a system that are there, in its order */
export function systemVeins(scene: Scene, system: VeinSystem): SurfaceObject[] {
    return system.veins.map(id => scene.surfaces.find(s => s.id === id)).filter((s): s is SurfaceObject => !!s);
}

/** A name no other system has */
export function freeSystemName(name: string, had: readonly VeinSystem[], own: string | null = null): string {
    const base = name.trim() || 'Vein system';
    const taken = new Set(had.filter(v => v.id !== own).map(v => v.name));
    if (!taken.has(base)) return base;
    for (let k = 2; ; k++) if (!taken.has(`${base} ${k}`)) return `${base} ${k}`;
}

/** The vein a vein stops at (its surface's id; null: none) */
export function stopsAt(surface: SurfaceObject): string | null {
    return surface.rule.kind === 'body' ? surface.rule.vein?.endsOn?.surface ?? null : null;
}

/** A vein's rule with where it stops set (null: it stops at nothing) */
export function stopRule(rule: BodyRule, at: { surface: string; side: 1 | -1 } | null): BodyRule {
    const { endsOn: _endsOn, ...vein } = rule.vein ?? { least: 0 };
    return { ...rule, vein: { ...vein, ...(at ? { endsOn: { surface: at.surface, side: at.side, middle: true as const } } : {}) } };
}

/**
 * Systems as a scene keeps them: each with the veins of it that are there
 * (a surface is in one system only, the first that names it), and none
 * without a vein.
 */
export function readVeinSystems(raw: unknown, surfaces: readonly SurfaceObject[]): VeinSystem[] {
    if (!Array.isArray(raw)) return [];
    const out: VeinSystem[] = [];
    const taken = new Set<string>();
    for (const r of raw as Partial<VeinSystem>[]) {
        if (out.length >= MAX_VEIN_SYSTEMS) break;
        if (!r || typeof r.id !== 'string' || !r.id || out.some(v => v.id === r.id)) continue;
        const veins: string[] = [];
        for (const id of Array.isArray(r.veins) ? r.veins : []) {
            const surface = surfaces.find(s => s.id === id);
            if (!surface || !isVein(surface) || taken.has(surface.id) || veins.length >= MAX_SYSTEM_VEINS) continue;
            taken.add(surface.id);
            veins.push(surface.id);
        }
        if (veins.length === 0) continue;
        out.push({ id: r.id, name: freeSystemName(typeof r.name === 'string' ? r.name : '', out), veins });
    }
    return out;
}

/**
 * The systems of a scene from before there were any: the veins its units
 * were told apart into (two or more veins of one set, veinSet.ts) are one
 * system each, in the order of the scene.
 */
export function systemsFromSets(surfaces: readonly SurfaceObject[], nameOf: (rule: BodyRule) => string): VeinSystem[] {
    const out: VeinSystem[] = [];
    const taken = new Set<string>();
    for (const s of surfaces) {
        const rule = lodeRule(s.rule);
        if (!rule || s.blockOf || taken.has(s.id) || out.length >= MAX_VEIN_SYSTEMS) continue;
        const veins = surfaces.filter(x => !x.blockOf && !taken.has(x.id) && (x.id === s.id || sameSet(x.rule, s.rule))).slice(0, MAX_SYSTEM_VEINS);
        if (veins.length < 2) continue;
        for (const v of veins) taken.add(v.id);
        out.push({ id: `vs${out.length + 1}`, name: freeSystemName(nameOf(rule), out), veins: veins.map(v => v.id) });
    }
    return out;
}

/**
 * A system's veins put in a new order (`order`: surface ids; ones it does
 * not name keep their place after those it does, ones that are not its are
 * left out). The rules that change with it: a vein that would now stop at
 * one after it, or at one no longer in the system, stops at nothing.
 */
export function reorder(system: VeinSystem, surfaces: readonly SurfaceObject[], order: readonly string[]): { system: VeinSystem; rules: { id: string; rule: BodyRule }[] } {
    const own = new Set(system.veins);
    const first = order.filter((id, i) => own.has(id) && order.indexOf(id) === i);
    const veins = [...first, ...system.veins.filter(id => !first.includes(id))];
    return { system: { ...system, veins }, rules: looseStops(veins, surfaces) };
}

/** The veins of a list (in order) whose stop is no longer one before them: their rules with no stop */
export function looseStops(veins: readonly string[], surfaces: readonly SurfaceObject[]): { id: string; rule: BodyRule }[] {
    const out: { id: string; rule: BodyRule }[] = [];
    veins.forEach((id, i) => {
        const s = surfaces.find(x => x.id === id);
        const at = s ? stopsAt(s) : null;
        if (!s || s.rule.kind !== 'body' || !at) return;
        const before = veins.indexOf(at);
        // (A stop put on it by hand at a surface that is no vein of the system is its own business)
        if (!s.rule.vein?.endsOn?.middle) return;
        if (before < 0 || before >= i) out.push({ id, rule: stopRule(s.rule, null) });
    });
    return out;
}

/** The veins a vein of a system may stop at: the ones before it in the order */
export function mayStopAt(system: VeinSystem, surfaceId: string): string[] {
    const at = system.veins.indexOf(surfaceId);
    return at > 0 ? system.veins.slice(0, at) : [];
}

/**
 * The side of another vein's reference surface a vein is on: where most of
 * its own stretches are (`heights`: that surface's field at the middles of
 * this vein's stretches). 1 when none says.
 */
export function stopSide(heights: ArrayLike<number>): 1 | -1 {
    let above = 0, below = 0;
    for (let i = 0; i < heights.length; i++) { if (heights[i] > 0) above++; else if (heights[i] < 0) below++; }
    return below > above ? -1 : 1;
}
