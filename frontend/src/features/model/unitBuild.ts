/**
 * What a unit of a geological model is built as, read from its contact; and
 * a unit built another way after the fact (Phase 268).
 *
 * The form is not kept beside the model: a unit is a layer because its
 * contact is a deposit or an erosion surface, an intrusion of thin sheets
 * because the body round it says so, a vein system because its veins are one.
 *
 * Built another way, a unit keeps its surface: its place in the age order,
 * its fault blocks, its trend, and the points, lines, dips and directions
 * placed on it by hand. What the new form has no use for is said, not
 * dropped in silence (`notes`). Where a unit becomes a layer, or stops being
 * one, the contacts between the model's other layers are given the layers
 * as they then are, as long as they still read their holes as they were made
 * to. Everything is done in one go: one step back undoes it.
 */
import { useModelStore } from '../../store/modelStore';
import { contactsFromUnits, KIND_NAME, type ContactProposal, type UnitPlan } from './geoModel';
import { sequenceState, setModelSequence, unitVeinRules } from './geoModelActions';
import { unitLog } from './logging';
import { followedBy } from './modelCache';
import { makeVeinSystem, unitsLabel } from './sceneActions';
import type { BodyRule, ContactControl, ContactRule, GeoModel, ModelScene, SceneCoords, SurfaceObject } from './types';

const isLayer = (plan: UnitPlan | null | undefined): boolean => plan === 'deposit' || plan === 'erosion';
const list = (items: readonly string[]): string => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((u, k) => u === b[k]);

/** What each form is called in a list of them */
export const FORM_LABEL: Record<Exclude<UnitPlan, 'none'>, string> = {
    deposit: KIND_NAME.deposit, erosion: KIND_NAME.erosion, intrusion: KIND_NAME.intrusion, sheets: 'Intrusion, thin sheets', vein: 'Vein or dyke', veinSystem: 'Vein system',
};

/** What each form is called in a sentence */
export const PLAN_NAME: Record<Exclude<UnitPlan, 'none'>, string> = {
    deposit: 'a deposit', erosion: 'an erosion surface', intrusion: 'an intrusion', sheets: 'an intrusion of thin sheets', vein: 'a vein', veinSystem: 'a vein system',
};

/**
 * What a unit is built as in a model: as its contact is (a deposit, an
 * erosion surface, an intrusion), and for a body from the logging as its
 * rule is (thin sheets; a vein; a vein that is one of a vein system: the
 * unit is the system). Null: it has no contact there (the base, or a unit
 * that is not in the model).
 */
export function unitBuiltAs(scene: Pick<ModelScene, 'surfaces' | 'veinSystems'>, model: Pick<GeoModel, 'contacts'>, unit: string): UnitPlan | null {
    const has = model.contacts.find(c => c.unit === unit);
    if (!has) return null;
    const rule = scene.surfaces.find(s => s.id === has.surface)?.rule;
    if (rule?.kind === 'body' && rule.vein) return (scene.veinSystems ?? []).some(v => !!has.surface && v.veins.includes(has.surface)) ? 'veinSystem' : 'vein';
    if (rule?.kind === 'body' && rule.sheets) return 'sheets';
    return has.kind;
}

/**
 * A model as a plan: its units the youngest first (as its contacts are in
 * the age order, then its base, then `listed` units it has no contact of),
 * and what each is built as (the base a deposit; a unit with no contact not
 * in the model).
 */
export function modelPlan(scene: Pick<ModelScene, 'surfaces' | 'veinSystems'>, model: Pick<GeoModel, 'contacts' | 'base'>, listed: readonly string[] = []): { names: string[]; plan: Record<string, UnitPlan> } {
    const names: string[] = [];
    for (const c of model.contacts) if (c.unit && !names.includes(c.unit)) names.push(c.unit);
    const plan: Record<string, UnitPlan> = Object.fromEntries(names.map(u => [u, unitBuiltAs(scene, model, u) ?? 'deposit']));
    if (model.base && !names.includes(model.base)) { names.push(model.base); plan[model.base] = 'deposit'; }
    for (const u of listed) if (!names.includes(u)) { names.push(u); plan[u] = 'none'; }
    return { names, plan };
}

export type Rebuilt =
    | { ok: true; changed: boolean; notes: string[] }
    | { ok: false; reason: string };

const fail = (reason: string): Rebuilt => ({ ok: false, reason });

/** How many changes were made by hand to what the logging gives a surface */
const controlCount = (c: ContactControl | undefined): number => (c?.edits?.length ?? 0) + (c?.marks?.length ?? 0) + (c?.uncrossed?.length ?? 0);

/** What a body's rule holds that only the form it is now has a use for, in words (for what is not carried to another form) */
function formSettings(rule: BodyRule, to: UnitPlan): string[] {
    const out: string[] = [];
    const keepsPlane = to === 'vein' || to === 'veinSystem' || to === 'sheets';
    if (rule.sheets) {
        if (rule.sheets.strength != null) out.push(`how far it is carried along its sheets (${rule.sheets.strength} times)`);
        if (rule.sheets.join) out.push(`its join length (${rule.sheets.join} m)`);
        if (rule.sheets.least) out.push(`the size under which its pieces are left out (${rule.sheets.least} m³)`);
        if (rule.sheets.plane && !keepsPlane) out.push('the plane given for its sheets');
    }
    if (rule.vein && to !== 'vein' && to !== 'veinSystem') {
        if (rule.vein.least > 0) out.push(`its least thickness (${rule.vein.least} m)`);
        if (rule.vein.join) out.push(`its join length (${rule.vein.join} m)`);
        if (rule.vein.thickness === 'net') out.push('its net thickness');
        if (rule.vein.picks?.length) out.push(`the ${rule.vein.picks.length.toLocaleString()} stretch${rule.vein.picks.length === 1 ? '' : 'es'} picked as its own`);
        if (rule.vein.endsOn) out.push('the surface it ends on');
        if (rule.vein.plane && !keepsPlane) out.push('the plane given for its sheets');
    }
    return out;
}

/** A body's rule as another single form (an intrusion, thin sheets, a vein): what it reads stays, with the plane given for its sheets where both forms have one */
function bodyAs(rule: BodyRule, to: 'intrusion' | 'sheets' | 'vein', held: boolean): BodyRule {
    const { vein, sheets, ...rest } = rule;
    const plane = vein?.plane ?? sheets?.plane;
    if (to === 'sheets') return { ...rest, sheets: plane ? { plane } : {} };
    if (to === 'vein') return { ...rest, vein: { least: 0, ...(plane ? { plane } : {}), ...(held || vein?.held ? { held: true } : {}) } };
    return rest;
}

/**
 * A unit of a model built another way: `as` a deposit, an erosion surface,
 * an intrusion, an intrusion of thin sheets, a vein or a vein system.
 *
 * Its surface stays the surface it was (a vein system: its first vein), with
 * its place in the age order and everything placed on it by hand; the veins
 * of a system made one surface give that surface the points and lines they
 * used. `notes`: what was not carried, and what else was changed.
 *
 * Not done, and said why (`reason`): the base (it has no contact); a contact
 * that is a mesh from a file or a surface placed by hand (only its type, in
 * the age order); a locked surface; a unit whose stretches cannot be told
 * apart into the veins of a system; a unit that would be the oldest layer
 * of a model with no base.
 */
export function rebuildUnitAs(modelId: string, coords: SceneCoords | null, unit: string, as: UnitPlan): Rebuilt {
    const store = () => useModelStore.getState();
    const modelNow = () => store().scene.models?.find(m => m.id === modelId);
    const model = modelNow();
    if (!model) return fail('The model is no longer in the project.');
    const scene = store().scene;
    const was = unitBuiltAs(scene, model, unit);
    if (was === null) {
        return fail(unit === model.base
            ? `${unit} is the base of the model, its oldest unit: it has no contact to build another way. Give the model another base first (Units).`
            : `${unit} has no contact in the model yet.`);
    }
    if (as === 'none') return fail('To leave it out of the model, take its surface out of the chronology (the cross on its row).');
    if (as === was) return { ok: true, changed: false, notes: [] };
    const own = model.contacts.filter(c => c.unit === unit);
    const first = own[0];
    const surface = scene.surfaces.find(s => s.id === first.surface);
    const sequence = sequenceState(modelId) === 'on';
    const notes: string[] = [];

    // Only what the contact is: a deposit and an erosion surface are the same surface; so are a mesh or a surface placed by hand, whatever they are
    const logged = !!surface && (surface.rule.kind === 'contact' || surface.rule.kind === 'body');
    if ((isLayer(was) && isLayer(as)) || !logged) {
        if (!logged && as !== 'deposit' && as !== 'erosion' && as !== 'intrusion') {
            return fail(`${surface?.name ?? 'Its contact'} is ${surface ? 'placed by hand' : 'a mesh from a file'}, not built from the logging: it cannot be made ${PLAN_NAME[as]}.`);
        }
        for (const c of own) store().updateModelContact(modelId, c.id, { kind: as as 'deposit' | 'erosion' | 'intrusion' });
        if (sequence) setModelSequence(modelId, true);
        return { ok: true, changed: true, notes };
    }
    if (!surface) return fail('Its contact is not in the project.');

    const veins = own.map(c => scene.surfaces.find(s => s.id === c.surface)).filter((s): s is SurfaceObject => !!s);
    const locked = veins.find(s => s.locked);
    if (locked) return fail(`${locked.name} is locked: unlock it first.`);
    const map = scene.unitMaps?.find(m => m.id === model.unitMap);
    const rule0 = surface.rule as ContactRule | BodyRule;
    const changesKind = (rule0.kind === 'contact') !== isLayer(as);
    if ((changesKind || as === 'veinSystem' || was === 'veinSystem') && (!map || rule0.units !== map.id)) {
        return fail(`${surface.name} was not made from the model's lithologies: how it is built is changed in its own settings.`);
    }

    // A vein system asked for: told apart before anything is changed, so that a unit that cannot be is left as it is
    const follows = surface.params.trendLayers;
    let told: { rules: BodyRule[]; join: number } | null = null;
    if (as === 'veinSystem') {
        if (!coords) return fail('The data has no East, North and Elevation columns to place the surfaces by.');
        const whole: BodyRule = rule0.kind === 'body'
            ? bodyAs(rule0, 'vein', !!follows)
            : { kind: 'body', column: rule0.column, ...(rule0.table ? { table: rule0.table } : {}), units: rule0.units, inside: [unit], ignore: [], maxGap: rule0.maxGap, minRun: rule0.minRun, vein: { least: 0 } };
        const log = map ? unitLog(coords, map) : null;
        told = log ? unitVeinRules(log, whole, followedBy({ rule: { ...whole, vein: { ...whole.vein!, held: true, join: 1 } }, params: surface.params })) : null;
        if (!told || told.rules.length < 2) return fail(`The stretches of ${unit} cannot be told apart into several veins: it stays ${PLAN_NAME[was as Exclude<UnitPlan, 'none'>]}.`);
    }

    // A vein system made one surface: its first vein is kept, with what the others used; the others and the system go
    if (was === 'veinSystem') {
        const system = (scene.veinSystems ?? []).find(v => v.veins.includes(surface.id));
        const others = veins.filter(s => s.id !== surface.id);
        const sets = new Set((surface.uses ?? []).map(u => u.set));
        let given = 0;
        for (const o of others) for (const u of o.uses ?? []) if (!sets.has(u.set)) { sets.add(u.set); store().setSurfaceUse(surface.id, u.set, true); given++; }
        for (const c of own.slice(1)) store().removeModelContact(modelId, c.id);
        if (system) store().dissolveVeinSystem(system.id);
        for (const o of others) store().removeSurface(o.id);
        notes.push(`Its ${veins.length} veins are one surface again${given > 0 ? `, with the points and lines placed on the others (${given} set${given === 1 ? '' : 's'})` : ''}.`);
    }

    // The plan as the model had it, and as it is to be: what each contact between layers then reads
    const listed = map?.units.map(u => u.name) ?? [];
    const before = modelPlan(scene, model, listed);
    const after = { ...before.plan, [unit]: as };
    const proposals = (plan: Readonly<Record<string, UnitPlan>>) => new Map(contactsFromUnits(before.names, plan).proposals.map(p => [p.unit, p] as [string, ContactProposal]));
    const old = proposals(before.plan), now = proposals(after);
    const layersNow = before.names.filter(u => isLayer(after[u]));

    const current = () => store().scene.surfaces.find(s => s.id === surface.id)!;
    const dropped = (rule: BodyRule) => {
        const lost = formSettings(rule, as);
        if (lost.length > 0) notes.push(`Not carried: ${list(lost)}. They are of ${PLAN_NAME[was as Exclude<UnitPlan, 'none'>]}.`);
    };
    const systemName = (scene.veinSystems ?? []).find(v => v.veins.includes(surface.id))?.name ?? unit;
    const plainName = (name: string) => (name === `Base of ${unit}` || name === `${systemName} 1` || name === `${unit} 1` ? unit : name);

    if (isLayer(as)) {
        // A body made a layer: a contact at its base, between the layers over it and under it
        const p = now.get(unit);
        if (!p) return fail(`${unit} would be the oldest layer of the model: the base, which has no contact. Give the model a base older than it first (Units).`);
        const r = current().rule as ContactRule | BodyRule;
        if (r.kind === 'body') {
            dropped(r);
            if (controlCount(r.control) > 0) notes.push(`Not carried: the ${controlCount(r.control)} change${controlCount(r.control) === 1 ? '' : 's'} made by hand to what the logging gives it (they were of a closed body).`);
            // (Read as a pile where the model's other contacts between layers are, or where it has none)
            const others = [...old.values()].filter(x => !x.inside && x.unit !== unit);
            const piled = others.length === 0 || others.some(x => !!asMade(store().scene, model, x.unit, old)?.pile);
            const rule: ContactRule = {
                kind: 'contact', column: r.column, ...(r.table ? { table: r.table } : {}), ...(r.units ? { units: r.units } : {}),
                sideA: p.sideA, sideB: p.sideB, maxGap: r.maxGap, minRun: r.minRun, ...(piled && layersNow.length > 1 ? { pile: layersNow } : {}),
            };
            if (follows) notes.push('It no longer follows the layers of the model: it is one of them.');
            store().updateSurface(surface.id, {
                rule, name: current().name === unit || current().name === `${systemName} 1` || current().name === `${unit} 1` ? `Base of ${unit}` : current().name,
                sides: [unitsLabel(p.sideA), unitsLabel(p.sideB)], params: { trendLayers: undefined },
            });
        }
        store().updateModelContact(modelId, first.id, { kind: as as 'deposit' | 'erosion', young: 1 });
    } else {
        const r = current().rule as ContactRule | BodyRule;
        const single = as === 'veinSystem' ? 'vein' : as as 'intrusion' | 'sheets' | 'vein';
        if (r.kind === 'contact') {
            // A layer made a body: round its own unit, and no longer one of a sequence
            if (controlCount(r.control) > 0) notes.push(`Not carried: the ${controlCount(r.control)} change${controlCount(r.control) === 1 ? '' : 's'} made by hand to its contacts down the holes (they were of a contact between layers).`);
            const whole: BodyRule = { kind: 'body', column: r.column, ...(r.table ? { table: r.table } : {}), ...(r.units ? { units: r.units } : {}), inside: [unit], ignore: now.get(unit)?.ignore ?? [], maxGap: r.maxGap, minRun: r.minRun };
            store().updateSurface(surface.id, { rule: bodyAs(whole, single, false), name: plainName(current().name), sides: null, conform: null });
        } else {
            if (was !== 'veinSystem') dropped(r);
            const { vein, ...rest } = r;
            // (One of a system's veins is the whole unit again: every stretch is its own)
            const whole: BodyRule = was === 'veinSystem' && vein ? { ...rest, vein: { least: vein.least, ...(vein.plane ? { plane: vein.plane } : {}), ...(vein.held ? { held: true } : {}) } } : r;
            store().updateSurface(surface.id, { rule: bodyAs(whole, single, !!follows), name: plainName(current().name) });
        }
        store().updateModelContact(modelId, first.id, { kind: 'intrusion', young: 1 });
    }

    // The contacts between the model's other layers read the layers as they now are
    if (changesKind) {
        let given = 0;
        const left: string[] = [];
        for (const c of modelNow()?.contacts ?? []) {
            if (c.unit === unit || c.kind === 'intrusion' || !c.surface) continue;
            const s = store().scene.surfaces.find(x => x.id === c.surface);
            if (!s || s.rule.kind !== 'contact' || !map || s.rule.units !== map.id) continue;
            const made = asMade(store().scene, model, c.unit, old), next = now.get(c.unit);
            if (!made || !next) { left.push(s.name); continue; }
            const named = s.sides && s.sides[0] === unitsLabel(made.sideA) && s.sides[1] === unitsLabel(made.sideB);
            const { pile: _pile, ...rest } = made;
            store().updateSurface(s.id, {
                rule: { ...rest, sideA: next.sideA, sideB: next.sideB, ...(made.pile && layersNow.length > 1 ? { pile: layersNow } : {}) },
                ...(named ? { sides: [unitsLabel(next.sideA), unitsLabel(next.sideB)] as [string, string] } : {}),
            });
            given++;
        }
        if (given > 0) notes.push(`${given} contact${given === 1 ? '' : 's'} between the other layers ${given === 1 ? 'reads' : 'read'} the holes with ${unit} ${isLayer(as) ? 'as one of the layers' : 'no longer one of the layers'}.`);
        if (left.length > 0) notes.push(`${list(left)} ${left.length === 1 ? 'reads' : 'read'} the holes by units set by hand: left as ${left.length === 1 ? 'it is' : 'they are'}.`);
    }

    if (as === 'veinSystem' && told && coords) {
        const had = (current().uses ?? []).length;
        const made = makeVeinSystem(coords, unit, told.rules, surface.id);
        const all = made?.system ? store().scene.veinSystems?.find(v => v.id === made.system)?.veins ?? [] : [];
        if (follows) for (const v of all) if (v !== surface.id) store().updateSurface(v, { params: { trendLayers: follows } });
        notes.push(`A vein system of ${told.rules.length} veins, a vein of each sheet that could be told apart (stretches under ${told.join} m apart down a hole read as one).`);
        if (had > 0) notes.push(`What was placed on it by hand stays with ${current().name}: give it to another vein of the system where it belongs to one.`);
    }
    // No layer runs alongside what is no longer one; and the layers that were one sequence are one again, as they now are
    if (changesKind && !isLayer(as)) for (const s of store().scene.surfaces) if (s.conform?.surface === surface.id) store().updateSurface(s.id, { conform: null });
    if (sequence) setModelSequence(modelId, true);
    return { ok: true, changed: true, notes };
}

/** The rule of a unit's contact between layers, where it still reads its holes as it was made to (null: set by hand since, or no such contact) */
function asMade(scene: Pick<ModelScene, 'surfaces'>, model: Pick<GeoModel, 'contacts'>, unit: string, old: ReadonlyMap<string, ContactProposal>): ContactRule | null {
    const c = model.contacts.find(x => x.unit === unit);
    const rule = c?.surface ? scene.surfaces.find(s => s.id === c.surface)?.rule : undefined;
    const p = old.get(unit);
    if (!rule || rule.kind !== 'contact' || !p || p.inside) return null;
    return same(rule.sideA, p.sideA) && same(rule.sideB, p.sideB) ? rule : null;
}

/** Whether a unit can be built another way from the model at all, and if not why (null: it can) */
export function rebuildProblem(scene: ModelScene, model: GeoModel, unit: string): string | null {
    if (unitBuiltAs(scene, model, unit) === null) return unit === model.base ? 'The base has no contact: it is the ground every other unit is laid on or cut into.' : 'It has no contact in the model yet.';
    const c = model.contacts.find(x => x.unit === unit);
    const s = scene.surfaces.find(x => x.id === c?.surface);
    if (!s) return 'Its contact is a mesh from a file, used as it is.';
    if (s.locked) return 'Its surface is locked.';
    return null;
}

/** The forms a unit can be given from the model: every one for a surface built from the logging, the three types of a contact for any other */
export function formsFor(scene: ModelScene, model: GeoModel, unit: string): Exclude<UnitPlan, 'none'>[] {
    const c = model.contacts.find(x => x.unit === unit);
    const rule = scene.surfaces.find(x => x.id === c?.surface)?.rule;
    const logged = rule?.kind === 'contact' || rule?.kind === 'body';
    return logged ? ['deposit', 'erosion', 'intrusion', 'sheets', 'vein', 'veinSystem'] : ['deposit', 'erosion', 'intrusion'];
}
