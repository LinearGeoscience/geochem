/**
 * Things done to a geological model that take more than one change to the
 * project: its contacts made from the units it reads, each a surface built
 * from the logging and put in the age order with its type.
 */
import { useModelStore } from '../../store/modelStore';
import { acrossByAge } from './blockParts';
import { downloadText } from '../../utils/gisExport';
import { activeFaults, blockNames, chainOf, contactsFromUnits, cuttersFirst, layerRuns, MAX_CONTACTS, sideNames, sideOf, type UnitPlan } from './geoModel';
import { bodyShape } from './body';
import { planParts, type ChronologyProposal, type UnitShape } from './contactMatrix';
import type { HoleLog } from './contacts';
import { suggestJoin } from './joinLength';
import { severalLodes, suggestLodes } from './lodes';
import { contactInputsFor, followedBy, foundAs } from './modelCache';
import { dipFromNormal } from './plane';
import { SHARE_SHELLS, shareRule } from './proportion';
import type { TrendField } from './trendField';
import { veinPicks } from './vein';
import { useGeoModelCache } from './geoModelCache';
import { MESH_FORMATS, meshFileName, meshesToFile, type MeshFormat, type NamedMesh } from './meshWriters';
import { contactMeshes, unitSolid } from './modelParts';
import { parseKey, parseModelPart } from './objectKeys';
import { sidesByNumber } from './faultDomains';
import { faultNet } from './faults';
import { holeLog, unitLog } from './logging';
import { addSystemToModel, bodySurface, contactSurface, loggedSurface, makeVeinSystem, surfaceMeshes } from './sceneActions';
import type { BodyRule, FaultSide, ModelScene, SceneCoords, ShareOf, UnitMap, Vec3 } from './types';

const listed_ = (names: readonly string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

export type MadeContacts =
    | { ok: true; made: number; skipped: number; notes: string[] }
    | { ok: false; reason: string };

/**
 * Where the gaps between a unit's stretches do not say what a zone is (they
 * make no two heaps, joinLength.ts): stretches nearer each other down a hole
 * than this many times their usual length are read as one; and where sheets
 * joined that far cannot be told apart, half that, and half again. (One real
 * dyke set is all this rests on: its stretches are usually 0.46 m long, and
 * against groups of holes left out, joined at 2, 3 and 4 m it found 19, 24
 * and 27% of the unit at the same share of what it took in, about a fifth;
 * at 8 m it found 35% at a lower share, 17%.)
 */
export const SYSTEM_JOIN = 8;
/**
 * A join length joins the strands of one sheet when, of the gaps it closes,
 * this share at least are under half of it. Where they are not, the gaps it
 * closes are the shortest of those from one sheet to the next: it would
 * read two sheets as one, and a shorter one is taken. (Found on made-up
 * dykes of one strand each, 13 m apart: joined at 8 times their usual
 * length they came out in pairs, the unit four times what it truly was.)
 */
export const JOINS_STRANDS = 1 / 3;

/** Whether a join length joins strands, and not the nearest of the sheets (`gaps`: between a unit's stretches down the holes) */
export function joinsStrands(gaps: ArrayLike<number>, join: number): boolean {
    let closed = 0, short = 0;
    for (let i = 0; i < gaps.length; i++) {
        if (!(gaps[i] > 0) || gaps[i] >= join) continue;
        closed++;
        if (gaps[i] < join / 2) short++;
    }
    return closed === 0 || short >= JOINS_STRANDS * closed;
}

/**
 * The thin sheets of a unit told apart into veins, as "a vein of each" in the
 * vein dialog does it (lodes.ts): its stretches read as zones, grouped by how
 * they lie from hole to hole across the plane of the sheets. A rule for each
 * vein, with the stretches that are its own, all across that one plane.
 * `join`: the length stretches were read as one zone within (from the gaps
 * between them when those say; else from their usual length, `SYSTEM_JOIN`,
 * the longest of that, a half and a quarter of it at which they can be told
 * apart and which joins strands, not sheets (`joinsStrands`); none of them
 * does: the longest at which they can be told apart). Null: they cannot be told apart into more than one (too few
 * stretches, no plane, or all of them in one).
 */
export function unitVeinRules(log: HoleLog, rule: BodyRule, follows: TrendField | null = null): { rules: BodyRule[]; join: number; zones: number; out: number } | null {
    const loose = foundAs(log, { ...rule, vein: { least: 0, held: true } }, follows, true);
    const ends = veinPicks(loose.list).stretches;
    const lengths: number[] = [];
    for (let i = 0; i + 5 < ends.length; i += 6) lengths.push(Math.hypot(ends[i + 3] - ends[i], ends[i + 4] - ends[i + 1], ends[i + 5] - ends[i + 2]));
    lengths.sort((a, b) => a - b);
    const usual = lengths.length > 0 ? lengths[lengths.length >> 1] : 0;
    const said = loose.gaps ? suggestJoin(loose.gaps)?.length : undefined;
    // (To the half metre, and never less than that)
    const tries = said !== undefined ? [said] : [...new Set([1, 2, 4].map(by => Math.max(0.5, Math.round(2 * SYSTEM_JOIN * usual / by) / 2)))];
    let other: { rules: BodyRule[]; join: number; zones: number; out: number } | null = null;
    for (const join of tries) {
        const joined: BodyRule = { ...rule, vein: { least: 0, held: true, join } };
        const told = suggestLodes(foundAs(log, joined, follows), { join });
        if (!told || !severalLodes(told)) continue;
        const plane = dipFromNormal(told.normal);
        // (`out`: the stretches in no vein: in a group too small to be one, or as near a stretch of another group as one of their own)
        const found = { join, rules: told.lodes.map(lode => ({ ...joined, vein: { ...joined.vein!, plane, picks: lode.picks } })), zones: told.zones.length, out: Math.min(told.zones.length, told.loose + told.unsure) };
        // (What the gaps themselves said is taken as said)
        if (said !== undefined || !loose.gaps || joinsStrands(loose.gaps, join)) return found;
        other ??= found;
    }
    return other;
}

/** How a surface made of a unit map's units reads the logging */
const mapSource = (map: UnitMap) => ({ column: map.columns[0], ...(map.table ? { table: map.table } : {}), units: map.id, maxGap: null, minRun: null });

/**
 * What the places of the units a proposal has cutting across say of their
 * form (`shapeProposal`): a set of thin sheets told apart as the vein dialog
 * does it, with how many of its stretches are in no vein; an intrusion,
 * whether it is thin against the gaps between its holes. `plan`: a unit it
 * has as a vein system is not looked at. `kept`: shapes found before, by
 * unit and what it was looked at as (they are the same while the data is).
 */
export function unitShapes(
    coords: SceneCoords | null, map: UnitMap, proposal: Pick<ChronologyProposal, 'order' | 'kinds'>,
    plan: Readonly<Record<string, UnitPlan | undefined>> = {}, kept: Map<string, UnitShape> = new Map(),
): Record<string, UnitShape> {
    const out: Record<string, UnitShape> = {};
    if (!coords) return out;
    let log: HoleLog | null | undefined;
    for (const p of contactsFromUnits(proposal.order, proposal.kinds).proposals) {
        const kind = proposal.kinds[p.unit];
        if (!p.inside || (kind !== 'veinSystem' && kind !== 'intrusion') || (kind === 'veinSystem' && plan[p.unit] === 'veinSystem')) continue;
        const key = `${kind}|${p.unit}|${p.ignore.join('|')}`;
        let shape = kept.get(key);
        if (!shape) {
            log ??= unitLog(coords, map);
            if (!log) break;
            const rule: BodyRule = { kind: 'body', ...mapSource(map), inside: p.inside, ignore: p.ignore };
            if (kind === 'veinSystem') {
                const told = unitVeinRules(log, rule, followedBy({ rule: { ...rule, vein: { least: 0, held: true, join: 1 } }, params: {} }));
                shape = { apart: told ? { zones: told.zones, out: told.out } : null };
            } else {
                // (Thin, and carried from hole to hole in a plane that stands out: a stock in a few holes is short against
                // their spacing too, and carries every way alike)
                const found = foundAs(log, { ...rule, sheets: {} });
                shape = { thin: !!found.carries && bodyShape(found.middles).thin };
            }
            kept.set(key, shape);
        }
        out[p.unit] = shape;
    }
    return out;
}

/** The share of a unit of a unit map, as a proportion reads it: the logged codes the unit is made of (null: it has none) */
export function unitShareOf(map: UnitMap, unit: string): ShareOf | null {
    const codes = map.units.find(u => u.name === unit)?.codes ?? [];
    return codes.length > 0 ? { ...(map.table ? { table: map.table } : {}), column: map.columns[0], inside: codes, length: 1 } : null;
}

/** Whether the project has a proportion of a unit already: a numeric model of the share of the same codes of the same column */
export function unitHasShare(scene: Pick<ModelScene, 'numericModels'>, map: UnitMap, unit: string): boolean {
    const of = unitShareOf(map, unit);
    if (!of) return false;
    const codes = new Set(of.inside);
    return (scene.numericModels ?? []).some(m => {
        const has = m.rule.of;
        return !!has && has.column === of.column && (has.table ?? null) === (of.table ?? null) && has.inside.length === codes.size && has.inside.every(c => codes.has(c));
    });
}

/**
 * Make the contacts of a model from its units: for every unit but the base,
 * a surface from the logging (a contact under a layer, a closed body round
 * an intrusion) put in the age order with its type. A unit that already has
 * a contact in the model is left as it is. `sequence`: the layers laid down
 * one on another are then made one sequence, which cannot cross. `order`:
 * the units the youngest first, where that is not the order they are listed
 * in. `asPile`: each hole is read as the pile of the plan's layers (pile.ts),
 * so every contact between layers is met at most once in a hole.
 *
 * A unit built as thin sheets is an intrusion of thin sheets. One built as
 * a vein system is told apart into veins (`unitVeinRules`), a vein made of
 * each and held as one vein system, every vein a contact of the unit; where
 * its stretches cannot be told apart it is one vein, and that is said
 * (`notes`). `shares`: the units that are also given a proportion (a numeric
 * model of how much of the ground they are, read from the codes they are
 * made of); one that has it already is passed over. `follow`: the units
 * that cut across and follow the layers of the model (a sill, a
 * stratabound lode): what is made of each follows how the model's layer
 * contacts lie (`SurfaceParams.trendLayers`); a vein is then held to the lie
 * of the ground, which is how a vein follows anything.
 *
 * A contact made younger than one that runs through the model's faults runs
 * through them too (`acrossByAge`), and that is said.
 */
export function makeModelContacts(
    modelId: string, coords: SceneCoords | null, plan: Readonly<Record<string, UnitPlan | undefined>>, sequence = false, order?: readonly string[], asPile = true,
    shares: readonly string[] = [], follow: readonly string[] = [],
): MadeContacts {
    const store = useModelStore.getState();
    const model = store.scene.models?.find(m => m.id === modelId);
    const map = store.scene.unitMaps?.find(m => m.id === model?.unitMap);
    if (!model || !map) return { ok: false, reason: 'The model reads no lithologies to make contacts from.' };
    if (!coords) return { ok: false, reason: 'The data has no East, North and Elevation columns to place the surfaces by.' };
    // (An order given holds only if it is of the map's units as they are)
    const listed = map.units.map(u => u.name);
    // (... and with none given, a unit that cuts across is the youngest)
    const names = order && order.length === listed.length && listed.every(u => order.includes(u)) ? order : cuttersFirst(listed, plan);
    const { base, proposals } = contactsFromUnits(names, plan);
    if (!base) return { ok: false, reason: 'No unit is left to be the base: at least one must be a layer.' };
    const source = mapSource(map);
    const layers = planParts(names, plan).layers;
    const pile = asPile && layers.length > 1 ? { pile: layers } : {};
    let made = 0, skipped = 0;
    const notes: string[] = [];
    const followers: string[] = [], through: string[] = [];
    /** What was made of a unit that follows the layers follows this model's */
    const follows = (unit: string, surfaces: readonly string[]) => {
        if (!follow.includes(unit) || surfaces.length === 0) return;
        for (const s of surfaces) useModelStore.getState().updateSurface(s, { params: { trendLayers: modelId } });
        followers.push(unit);
    };
    /** Its contacts run through the faults where an older contact of the model does */
    const throughFaults = (unit: string) => {
        const now = useModelStore.getState().scene.models?.find(m => m.id === modelId);
        const late = now ? acrossByAge(now).filter(x => x.contact.unit === unit) : [];
        for (const x of late) useModelStore.getState().updateModelContact(modelId, x.contact.id, { across: true });
        if (late.length > 0) through.push(`${unit} (younger than ${late[0].older.unit})`);
    };
    if (model.base !== base) store.updateModel(modelId, { base });
    for (const p of proposals) {
        const now = useModelStore.getState();
        const have = now.scene.models?.find(m => m.id === modelId)?.contacts ?? [];
        if (have.some(c => c.unit === p.unit)) { skipped++; continue; }
        // Its place in the age order: under every contact the model has of a unit listed over it. (Made oldest first
        // in a model with no contacts, each goes to the top.)
        const place = names.indexOf(p.unit);
        let at = 0;
        have.forEach((c, i) => { const k = names.indexOf(c.unit); if (k >= 0 && k < place) at = i + 1; });
        if (p.inside && p.system) {
            // A vein of each sheet that can be told apart, held as one vein system
            const rule: BodyRule = { kind: 'body', ...source, inside: p.inside, ignore: p.ignore };
            const log = unitLog(coords, map);
            const told = log ? unitVeinRules(log, rule, followedBy({ rule: { ...rule, vein: { least: 0, held: true, join: 1 } }, params: {} })) : null;
            const system = told ? makeVeinSystem(coords, p.unit, told.rules) : null;
            if (told && system?.system) {
                const put = addSystemToModel(modelId, system.system, at);
                made += put?.made ?? 0;
                if (!put || put.made < told.rules.length) return { ok: false, reason: 'The model can take no more contacts.' };
                notes.push(`${p.unit}: a vein system of ${told.rules.length} veins, a vein of each sheet that could be told apart (stretches under ${told.join} m apart down a hole read as one).`);
                follows(p.unit, useModelStore.getState().scene.veinSystems?.find(v => v.id === system.system)?.veins ?? []);
                throughFaults(p.unit);
                continue;
            }
            notes.push(`${p.unit}: its stretches could not be told apart into several veins, so it is one vein.`);
        }
        const surface = p.inside
            ? bodySurface(coords, { kind: 'body', ...source, inside: p.inside, ignore: p.ignore, ...(p.vein ? { vein: { least: 0, ...(follow.includes(p.unit) ? { held: true } : {}) } } : p.sheets ? { sheets: {} } : {}) })
            : contactSurface(coords, { kind: 'contact', ...source, sideA: p.sideA, sideB: p.sideB, ...pile }, `Base of ${p.unit}`);
        if (!surface) return { ok: false, reason: 'The project\'s surfaces are in other coordinate columns than the view shows.' };
        if (now.addModelContact(modelId, { surface, kind: p.kind, young: 1, unit: p.unit }, at) === null) return { ok: false, reason: 'The model can take no more contacts.' };
        made++;
        if (p.inside) follows(p.unit, [surface]);
        throughFaults(p.unit);
    }
    if (followers.length > 0) notes.push(`${listed_(followers)} ${followers.length === 1 ? 'follows' : 'follow'} the layers of the model: fitted along the contacts between its layers as they lie from place to place, and again when one of them changes (the Trend tab of ${followers.length === 1 ? 'its surface' : 'each surface'}).`);
    if (through.length > 0) notes.push(`${listed_(through)} ${through.length === 1 ? 'runs' : 'run'} through the model's faults: an older contact does, and what came after the faults moved is not offset by them.`);
    if (sequence) setModelSequence(modelId, true);
    // How much of the ground a unit is, beside what it is built as
    let proportions = 0;
    for (const unit of shares) {
        const of = unitShareOf(map, unit);
        if (!of || unitHasShare(useModelStore.getState().scene, map, unit)) continue;
        if (useModelStore.getState().addNumericModel({ name: `${unit} share`, rule: { ...shareRule(of), column: `${unit} share` }, cutoffs: SHARE_SHELLS }) !== null) proportions++;
    }
    if (proportions > 0) notes.push(`${proportions} proportion${proportions === 1 ? '' : 's'} made: how much of the ground ${proportions === 1 ? 'the unit is' : 'each unit is'}, under Numeric models.`);
    return { ok: true, made, skipped, notes };
}

/**
 * The contacts between a model's layers that were made from its lithologies
 * read their holes by the order the layers were in then: which units are on
 * the younger side of each, and the pile every hole is read as. With the
 * order changed, they are given the order as it is now. Only a surface whose
 * units are all layers of the model is touched, and only its order: what it
 * reads stays the same set of units. Returns how many surfaces were changed.
 */
export function realignContacts(modelId: string): number {
    const { scene, updateSurface } = useModelStore.getState();
    const model = scene.models?.find(m => m.id === modelId);
    if (!model?.unitMap) return 0;
    // The layers as the model has them now, the youngest first, the base last
    const layers = [...model.contacts.filter(c => c.kind !== 'intrusion').map(c => c.unit), model.base].filter((u, k, all) => all.indexOf(u) === k);
    const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((u, k) => u === b[k]);
    let changed = 0;
    for (const c of model.contacts) {
        const surface = c.kind !== 'intrusion' && c.surface ? scene.surfaces.find(s => s.id === c.surface) : undefined;
        const rule = surface?.rule;
        if (!surface || !rule || rule.kind !== 'contact' || rule.units !== model.unitMap) continue;
        const read = rule.pile ?? [...rule.sideA, ...rule.sideB];
        // (A unit it reads that is not a layer of the model: it was set by hand, and is left as it is)
        if (read.length < 2 || !read.includes(c.unit) || read.some(u => !layers.includes(u))) continue;
        const order = layers.filter(u => read.includes(u));
        const at = order.indexOf(c.unit);
        // The base's own contact there is none of: the oldest layer read cannot be the unit above a contact
        if (at === order.length - 1) continue;
        const sideA = order.slice(0, at + 1), sideB = order.slice(at + 1);
        if (same(sideA, rule.sideA) && same(sideB, rule.sideB) && (!rule.pile || same(order, rule.pile))) continue;
        updateSurface(surface.id, { rule: { ...rule, sideA, sideB, ...(rule.pile ? { pile: order } : {}) } });
        changed++;
    }
    return changed;
}

/**
 * A contact moved in a model's chronology (to place `to`, 0 the youngest),
 * and the contacts made from its lithologies given the new order to read
 * their holes by: one step to undo.
 */
export function moveContact(modelId: string, contactId: string, to: number): void {
    useModelStore.getState().moveModelContact(modelId, contactId, to);
    realignContacts(modelId);
}

/** The runs of layers laid down one on another in a model (geoModel.layerRuns), as surface ids */
export function modelRuns(modelId: string): string[][] {
    const { scene } = useModelStore.getState();
    const model = scene.models?.find(m => m.id === modelId);
    if (!model) return [];
    return layerRuns(model.contacts, id => {
        const rule = scene.surfaces.find(s => s.id === id)?.rule;
        return rule?.kind === 'sheet' || rule?.kind === 'contact';
    });
}

/**
 * Whether a model's layers are a sequence: 'none' when it has no two layers
 * laid down one on another, 'on' when in every run each layer but one runs
 * alongside another of its run, 'off' otherwise.
 */
export function sequenceState(modelId: string): 'none' | 'on' | 'off' {
    const runs = modelRuns(modelId);
    if (runs.length === 0) return 'none';
    const { surfaces } = useModelStore.getState().scene;
    const on = runs.every(run => run.filter(id => {
        const other = surfaces.find(s => s.id === id)?.conform?.surface;
        return !!other && run.includes(other);
    }).length === run.length - 1);
    return on ? 'on' : 'off';
}

/**
 * Make a model's layers a sequence, or stop them being one. On: in each run
 * of layers laid down one on another, the contact with the most places to go
 * by is fitted on its own and every other runs alongside its neighbour
 * towards it (surfaceJobs' conform job), so no two cross and a layer missing
 * in some holes pinches out. Off: each is fitted on its own again. Returns
 * how many surfaces were changed.
 */
export function setModelSequence(modelId: string, on: boolean): number {
    let changed = 0;
    for (const run of modelRuns(modelId)) {
        const { scene, updateSurface } = useModelStore.getState();
        const surfaces = run.map(id => scene.surfaces.find(s => s.id === id)!);
        if (!on) {
            for (const s of surfaces) if (s.conform && run.includes(s.conform.surface)) { updateSurface(s.id, { conform: null }); changed++; }
            continue;
        }
        const counts = surfaces.map(s => (contactInputsFor(s)?.contacts.length ?? 0) / 3 + s.points.length + s.polylines.length);
        for (const link of chainOf(run, counts)) {
            const now = scene.surfaces.find(s => s.id === link.surface)!.conform?.surface ?? null;
            if (now === link.alongside) continue;
            updateSurface(link.surface, { conform: link.alongside ? { surface: link.alongside } : null });
            changed++;
        }
    }
    return changed;
}

/**
 * The meshes of objects, by key, as they are now: a surface's fitted mesh, a
 * model's contact as the model cuts it, a unit's closed solid, and for a
 * model every one of its units' solids. Those not fitted or built are left
 * out.
 */
export function objectMeshes(objectKeys: readonly string[]): NamedMesh[] {
    const scene = useModelStore.getState().scene;
    const built = useGeoModelCache.getState().byId;
    const out: NamedMesh[] = [];
    const push = (name: string, mesh: { vertices: Float64Array; triangles: Uint32Array }) => {
        if (mesh.triangles.length > 0) out.push({ name, vertices: mesh.vertices, triangles: mesh.triangles });
    };
    for (const key of objectKeys) {
        const parsed = parseKey(key);
        if (parsed?.kind === 'surface') { out.push(...surfaceMeshes([parsed.id])); continue; }
        const part = parseModelPart(key);
        const model = scene.models?.find(g => g.id === (part ? part.model : parsed?.kind === 'model' ? parsed.id : ''));
        const result = model ? built[model.id] : undefined;
        if (!model || !result?.out) continue;
        if (!part) {
            result.units.forEach((unit, u) => push(`${model.name} - ${unit}`, unitSolid(result.out!, u)));
        } else if (part.kind === 'volume') {
            const u = result.units.indexOf(part.part);
            if (u >= 0) push(`${model.name} - ${part.part}`, unitSolid(result.out, u));
        } else if (part.kind === 'modelFault') {
            const at = result.faults.flatMap((x, f) => (x === part.part ? [result.out!.faultFrom + f] : []));
            const fault = model.faults?.find(x => x.id === part.part);
            const name = scene.surfaces.find(x => x.id === fault?.surface)?.name ?? scene.wireframes.find(w => w.id === fault?.mesh)?.name ?? 'fault';
            // (All of its pieces, where younger faults offset it)
            if (at.length > 0) push(`${model.name} - ${name}`, contactMeshes(result.out, at));
        } else {
            const ks = result.contacts.flatMap((x, i) => (x === part.part ? [i] : []));
            const surface = scene.surfaces.find(x => x.id === model.contacts.find(c => c.id === part.part)?.surface);
            if (ks.length > 0) push(`${model.name} - ${surface?.name ?? 'contact'}`, contactMeshes(result.out, ks));
        }
    }
    return out;
}

/** Save objects' meshes as one file (see `objectMeshes`). False when none of them has a mesh yet. */
export function exportObjects(objectKeys: readonly string[], format: MeshFormat, projectName = 'surfaces'): boolean {
    const meshes = objectMeshes(objectKeys);
    if (meshes.length === 0) return false;
    const mime = MESH_FORMATS.find(x => x.format === format)?.mime ?? 'text/plain';
    downloadText(meshesToFile(format, meshes), meshFileName(format, meshes, projectName), mime);
    return true;
}

/** A built model's volumes as a table: unit, volume, share, the oldest first; for a model cut by faults, each unit in each fault block after that (null: not built) */
export function volumesCsv(modelId: string): string | null {
    const result = useGeoModelCache.getState().byId[modelId];
    if (!result?.out) return null;
    const total = result.out.volumes.reduce((a, b) => a + b, 0);
    const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = ['Unit,Volume (m3),Share (%)'];
    result.units.forEach((unit, u) => lines.push(`${cell(unit)},${result.out!.volumes[u].toFixed(1)},${total > 0 ? (100 * result.out!.volumes[u] / total).toFixed(2) : '0.00'}`));
    lines.push(`Total,${total.toFixed(1)},100.00`);
    const scene = useModelStore.getState().scene;
    const model = scene.models?.find(g => g.id === modelId);
    if (model && result.out.blocks.length > 1) {
        const names = blockNames(scene, model, result.faults, result.out.blocks);
        lines.push('', 'Fault block,Unit,Volume (m3),Share of the block (%)');
        result.out.blockVolumes.forEach((volumes, slot) => {
            const whole = volumes.reduce((a, b) => a + b, 0);
            if (!(whole > 0)) return;
            result.units.forEach((unit, u) => { if (volumes[u] > 0) lines.push(`${cell(names[slot])},${cell(unit)},${volumes[u].toFixed(1)},${(100 * volumes[u] / whole).toFixed(2)}`); });
            lines.push(`${cell(names[slot])},Total,${whole.toFixed(1)},100.00`);
        });
    }
    return `${lines.join('\n')}\n`;
}

export type MadeFault =
    | { ok: true; surface: string; points: number }
    | { ok: false; reason: string };

/** The fewest logged intervals a fault surface is made through */
const LEAST_INTERCEPTS = 3;

/**
 * A fault from intervals logged as one: a surface through the middle of
 * every interval logged with one of `codes` (a fault zone, a shear), made a
 * fault of the model. The middles become points of the surface's own set,
 * to be moved or added to like any others; they are not redone when the
 * logging changes.
 */
export function faultFromLogging(modelId: string, coords: SceneCoords | null, source: { column: string; table?: string }, codes: readonly string[], name?: string): MadeFault {
    const store = useModelStore.getState();
    if (!store.scene.models?.some(m => m.id === modelId)) return { ok: false, reason: 'The model is no longer in the project.' };
    if (!coords) return { ok: false, reason: 'The data has no East, North and Elevation columns to place the surfaces by.' };
    const log = holeLog(coords, source.column, source.table ?? null);
    if (!log) return { ok: false, reason: 'The logging could not be read: it needs the holes, their depths and the column.' };
    const wanted = new Set(codes.map(c => c.trim()).filter(Boolean));
    const points: { p: Vec3 }[] = [];
    for (let i = 0; i < log.from.length; i++) {
        if (!wanted.has(String(log.code[i] ?? '').trim())) continue;
        const from = Number(log.from[i]), to = log.to ? Number(log.to[i]) : NaN;
        const at = Number.isFinite(to) && log.placeAt ? log.placeAt(i, (from + to) / 2) : null;
        const p: Vec3 = at ?? [Number(log.x[i]), Number(log.y[i]), Number(log.z[i])];
        if (p.every(Number.isFinite)) points.push({ p });
    }
    if (points.length < LEAST_INTERCEPTS) {
        return { ok: false, reason: points.length === 0 ? 'No interval is logged with those codes.' : `Only ${points.length} interval${points.length === 1 ? ' is' : 's are'} logged with those codes: a surface needs ${LEAST_INTERCEPTS} at least.` };
    }
    const surface = loggedSurface(coords, { name: name?.trim() || `${[...wanted].join(' + ')} fault`, points });
    if (!surface) return { ok: false, reason: 'The project\'s surfaces are in other coordinate columns than the view shows.' };
    if (useModelStore.getState().addModelFault(modelId, { surface }) === null) return { ok: false, reason: 'The surface was made, but the model can take no more faults.' };
    return { ok: true, surface, points: points.length };
}

export type SplitContacts =
    | { ok: true; contacts: number; surfaces: number }
    | { ok: false; reason: string };

/**
 * Split a model's contacts by fault block: each contact that is a fitted
 * surface and runs through every block is replaced, in the age order, by one
 * per block, each a surface like it fitted to what of its points, lines and
 * logging is in that block. The surface it was stays in the project, out of
 * the model. A layer offset across a fault is then right on each side of it.
 */
export function splitContactsByBlock(modelId: string): SplitContacts {
    const scene = useModelStore.getState().scene;
    const model = scene.models?.find(g => g.id === modelId);
    if (!model) return { ok: false, reason: 'The model is no longer in the project.' };
    const faults = activeFaults(scene, model);
    if (faults.length === 0) return { ok: false, reason: 'The model has no fault in use: there is one block.' };
    const net = faultNet(faults.map(x => sidesByNumber(faults, x.ends)));
    const whole = model.contacts.filter(c => c.surface && !c.within?.length && scene.surfaces.some(x => x.id === c.surface));
    if (whole.length === 0) return { ok: false, reason: 'Every contact of the model is in one block already (a mesh from a file is used as it is).' };
    if (model.contacts.length + whole.length * (net.signs.length - 1) > MAX_CONTACTS) {
        return { ok: false, reason: `That would be more contacts than a model takes (${MAX_CONTACTS}): leave a fault out, or take contacts out.` };
    }
    const sideName = (e: FaultSide): string => {
        const fault = scene.surfaces.find(x => x.id === faults.find(y => y.id === e.fault)?.surface);
        const wire = scene.wireframes.find(w => w.id === faults.find(y => y.id === e.fault)?.mesh);
        return sideOf(sideNames(fault, !fault)[e.side > 0 ? 0 : 1], fault?.name ?? wire?.name ?? 'a fault');
    };
    let surfaces = 0;
    for (const c of whole) {
        const from = scene.surfaces.find(x => x.id === c.surface)!;
        const at = useModelStore.getState().scene.models!.find(g => g.id === modelId)!.contacts.findIndex(x => x.id === c.id);
        useModelStore.getState().removeModelContact(modelId, c.id);
        net.signs.forEach((signs, slot) => {
            const sides: FaultSide[] = faults.flatMap((x, f) => (signs[f] === 0 ? [] : [{ fault: x.id, side: signs[f] as 1 | -1 }]));
            const made = useModelStore.getState().addSurfaceWithin(from.id, { model: modelId, sides }, `${from.name} (${sides.map(sideName).join(', ')})`);
            if (!made) return;
            useModelStore.getState().addModelContact(modelId, { surface: made, kind: c.kind, young: c.young, unit: c.unit, ...(c.off ? { off: true } : {}), within: sides }, at + slot);
            surfaces++;
        });
    }
    return { ok: true, contacts: whole.length, surfaces };
}
