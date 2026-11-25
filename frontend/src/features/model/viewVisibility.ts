/**
 * What a view shows of the model (pure). Each view keeps the objects hidden
 * in it (the plot setting `hiddenObjects`, a list of keys); whatever is not
 * on the list is shown, so a new object shows in every view.
 *
 * A view with no list of its own (any view of a project from before views
 * had one) starts from the objects' own `visible` flags, so it looks as it
 * did. The flags are no longer changed by showing and hiding in a view.
 *
 * Shown or hidden is not undone with the model (as with the camera).
 *
 * Besides the model, a view shows the samples (`dataset`, on its list like
 * the rest) and the hole traces (`collars`), which are kept as the view's
 * own `showTraces` setting, as they were before views had lists.
 *
 * The tables logged down the holes (`table:<id>`) are the other way round: a
 * view draws only those it is told to (the setting `shownTables`), as there
 * are often several and each covers the holes. So are a geological model's
 * contacts as it cuts them (`modelContact:`, the setting `shownCuts`): they
 * lie on the faces of the units' solids, which are shown.
 *
 * So, once a geological model is built, are the surfaces and meshes it is
 * made from (its contacts' and faults' own surfaces: the setting
 * `shownMadeFrom`): its solids stand for them, and drawn as well each unit
 * would be there twice. Before the model is built they are drawn as any
 * surface is. Shown again by their eye, they stay shown.
 */
import { modelUnits } from './geoModel';
import { keys, parseKey } from './objectKeys';
import type { ModelScene } from './types';

/** The plot setting a view keeps its hidden objects in */
export const HIDDEN_SETTING = 'hiddenObjects';
/** The plot setting that shows the hole traces (the `collars` key) */
export const TRACES_SETTING = 'showTraces';
/** The plot setting listing the logging tables a view draws (by id) */
export const TABLES_SETTING = 'shownTables';

/** The plot setting listing the cut contacts of geological models a view draws (by key) */
export const CUTS_SETTING = 'shownCuts';
/** The plot setting listing the surfaces and meshes of built geological models a view draws all the same (by key) */
export const MADE_SETTING = 'shownMadeFrom';

const isTableKey = (k: string) => parseKey(k)?.kind === 'table';
const isCutKey = (k: string) => { const kind = parseKey(k)?.kind; return kind === 'modelContact' || kind === 'modelFault'; };

/** The key of every contact of every geological model */
export const cutKeysOf = (scene: ModelScene): string[] => (scene.models ?? []).flatMap(g => [
    ...g.contacts.map(c => keys.modelContact(g.id, c.id)), ...(g.faults ?? []).map(x => keys.modelFault(g.id, x.id)),
]);

/**
 * The surfaces and meshes from files that built geological models are made from (their contacts' and faults' own),
 * by key: what a view does not draw unless it is told to (`built`: is the model with this id built)
 */
export function madeFromKeys(scene: ModelScene, built: (modelId: string) => boolean): string[] {
    const out = new Set<string>();
    for (const g of scene.models ?? []) {
        if (!built(g.id)) continue;
        for (const c of [...g.contacts, ...(g.faults ?? [])]) {
            if (c.surface) out.add(keys.surface(c.surface));
            else if (c.mesh) out.add(keys.wireframe(c.mesh));
        }
    }
    return [...out].sort();
}

/** The surfaces of built models hidden in a view: every one it has not been told to draw all the same */
export function hiddenMadeFrom(saved: unknown, made: readonly string[]): string[] {
    const shown = new Set(shownTablesOf(saved));
    return made.filter(k => !shown.has(k));
}

/** The cut contacts hidden in a view: every one it has not been told to draw */
export function hiddenCuts(saved: unknown, cutKeys: readonly string[]): string[] {
    const shown = new Set(shownTablesOf(saved));
    return cutKeys.filter(k => !shown.has(k));
}

/** The tables a view draws, as saved */
export function shownTablesOf(saved: unknown): string[] {
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string' && id !== '') : [];
}

/** The keys of the tables hidden in a view: every one of these (by id) it has not been told to draw */
export function hiddenTables(saved: unknown, tableIds: readonly string[]): string[] {
    const shown = new Set(shownTablesOf(saved));
    return tableIds.filter(id => !shown.has(id)).map(keys.table);
}

/** Every object a view can show or hide on its list, by key: surfaces, sets of points and lines, reading sets, meshes, the overall direction, the samples */
export function sceneObjectKeys(scene: ModelScene): string[] {
    return [
        ...scene.surfaces.map(s => keys.surface(s.id)),
        ...(scene.inputs ?? []).map(s => keys.inputs(s.id)),
        ...(scene.structure?.sets ?? []).map(s => keys.readings(s.id)),
        ...scene.wireframes.map(w => keys.wireframe(w.id)),
        ...(scene.models ?? []).flatMap(g => [keys.model(g.id), ...modelUnits(scene, g).filter(Boolean).map(u => keys.volume(g.id, u))]),
        keys.structure,
        keys.dataset,
    ];
}

/** The objects the old shared flags hide: where a view with no list of its own starts */
export function legacyHidden(scene: ModelScene): string[] {
    return [
        ...scene.surfaces.filter(s => s.visible === false).map(s => keys.surface(s.id)),
        ...(scene.inputs ?? []).filter(s => s.visible === false).map(s => keys.inputs(s.id)),
        ...(scene.structure?.sets ?? []).filter(s => s.visible === false).map(s => keys.readings(s.id)),
        ...scene.wireframes.filter(w => w.visible === false).map(w => keys.wireframe(w.id)),
    ];
}

/** Does the view keep a list of its own? */
export const hasOwnList = (saved: unknown): saved is string[] => Array.isArray(saved);

/** The objects hidden in a view: its own list as saved, or those the old flags hide */
export function hiddenOf(saved: unknown, scene: ModelScene): Set<string> {
    return new Set(hasOwnList(saved) ? saved.filter((k): k is string => typeof k === 'string') : legacyHidden(scene));
}

/** A view's list with these objects shown or hidden. Only objects still in the scene are kept, so an id used again starts shown. */
export function withShown(scene: ModelScene, hidden: ReadonlySet<string>, objectKeys: readonly string[], shown: boolean): string[] {
    const next = new Set(hidden);
    for (const k of objectKeys) {
        if (shown) next.delete(k);
        else next.add(k);
    }
    const there = new Set(sceneObjectKeys(scene));
    return [...next].filter(k => there.has(k)).sort();
}

/** A view's list that shows only these objects */
export function showingOnly(scene: ModelScene, objectKeys: readonly string[]): string[] {
    const keep = new Set(objectKeys);
    return sceneObjectKeys(scene).filter(k => !keep.has(k)).sort();
}

type Settings = Record<string, unknown> | undefined;

/** The settings of a view that show or hide these objects in it (`made`: the surfaces of built models, `madeFromKeys`) */
export function shownChange(settings: Settings, scene: ModelScene, objectKeys: readonly string[], shown: boolean, made: readonly string[] = []): Record<string, unknown> {
    const tables = objectKeys.filter(isTableKey).map(k => parseKey(k)!.id);
    const listed = objectKeys.filter(k => k !== keys.collars && !isTableKey(k) && !isCutKey(k));
    const cuts = objectKeys.filter(isCutKey);
    const change: Record<string, unknown> = {};
    if (cuts.length) {
        const now = new Set(shownTablesOf(settings?.[CUTS_SETTING]));
        for (const k of cuts) {
            if (shown) now.add(k);
            else now.delete(k);
        }
        const there = new Set(cutKeysOf(scene));
        change[CUTS_SETTING] = [...now].filter(k => there.has(k)).sort();
    }
    // A surface a built model is made from: on the view's list of those it draws all the same, and on its hidden list as
    // any surface (so that it is shown or hidden as asked whether the model is built or not)
    const madeSet = new Set(made), madeHere = objectKeys.filter(k => madeSet.has(k));
    if (madeHere.length || (!shown && objectKeys.some(k => shownTablesOf(settings?.[MADE_SETTING]).includes(k)))) {
        const now = new Set(shownTablesOf(settings?.[MADE_SETTING]));
        for (const k of objectKeys) {
            if (shown && madeSet.has(k)) now.add(k);
            else if (!shown) now.delete(k);
        }
        change[MADE_SETTING] = [...now].sort();
    }
    if (objectKeys.includes(keys.collars)) change[TRACES_SETTING] = shown;
    if (listed.length) change[HIDDEN_SETTING] = withShown(scene, hiddenOf(settings?.[HIDDEN_SETTING], scene), listed, shown);
    if (tables.length) {
        const now = new Set(shownTablesOf(settings?.[TABLES_SETTING]));
        for (const id of tables) {
            if (shown) now.add(id);
            else now.delete(id);
        }
        change[TABLES_SETTING] = [...now].sort();
    }
    return change;
}

/** The settings of a view that show only these objects (the traces and tables among them, or not; `made`: the surfaces of built models) */
export function showOnlyChange(scene: ModelScene, objectKeys: readonly string[], made: readonly string[] = []): Record<string, unknown> {
    const madeSet = new Set(made);
    return {
        [MADE_SETTING]: objectKeys.filter(k => madeSet.has(k)).sort(),
        [HIDDEN_SETTING]: showingOnly(scene, objectKeys.filter(k => k !== keys.collars && !isTableKey(k) && !isCutKey(k))),
        [CUTS_SETTING]: objectKeys.filter(isCutKey).sort(),
        [TRACES_SETTING]: objectKeys.includes(keys.collars),
        [TABLES_SETTING]: objectKeys.filter(isTableKey).map(k => parseKey(k)!.id).sort(),
    };
}
