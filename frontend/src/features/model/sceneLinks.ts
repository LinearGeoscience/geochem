/**
 * How the objects of a modelling project depend on one another (pure): the
 * links the project tree shows under an object, and what a delete would
 * take with it.
 *
 * A link runs from the object that depends to the one it depends on:
 *  - uses     a surface uses a set of points or lines
 *  - owns     a set was made for a surface (it goes when the surface goes, unless another uses it)
 *  - units    a surface between units or a body reads a unit map
 *  - logging  a surface between units or a body reads a logging table, or a column of the samples
 *  - values   a shell is put round the values of a column
 *  - table    a unit map reads a logging table, or the samples
 *  - follows  a surface follows the overall direction, or the reading sets the model follows
 *  - writes   a column of the samples is written from a surface
 *  - drawnOn  a set of lines has lines drawn on the planes of a section set
 *  - contact  a geological model has a surface (or a mesh) in its age order
 *  - boundary a geological model stops at a surface (the ground)
 *  - endsOn   a vein ends on another surface
 *  - alongside a surface runs alongside another, and never crosses it
 * A geological model's units are a `units` link too.
 * A link is broken when the object it points at is not there.
 */
import type { DrillholeDb } from './drillholes';
import { sectionOfLine } from './lineTools';
import { keys, parseKey } from './objectKeys';
import { isSolids, takesDomain, unitDomain } from './shellDomains';
import type { ModelScene } from './types';

export type LinkKind = 'uses' | 'owns' | 'units' | 'logging' | 'values' | 'table' | 'follows' | 'writes' | 'drawnOn' | 'contact' | 'fault' | 'boundary' | 'endsOn' | 'alongside' | 'inside' | 'domain';

export interface SceneLink {
    from: string;
    to: string;
    kind: LinkKind;
    broken: boolean;
}

/**
 * Every link of a scene. `db`: the project's drillhole tables (null: none).
 * `columns`: the dataset's column names, to tell a missing column (absent:
 * columns are taken to be there).
 */
export function sceneLinks(scene: ModelScene, db: Pick<DrillholeDb, 'tables'> | null, columns?: readonly string[]): SceneLink[] {
    const out: SceneLink[] = [];
    const sets = new Map((scene.inputs ?? []).map(s => [s.id, s]));
    const surfaces = new Set(scene.surfaces.map(s => s.id));
    const tables = new Set((db?.tables ?? []).map(t => t.id));
    const maps = new Set((scene.unitMaps ?? []).map(m => m.id));
    const readingSets = scene.structure?.sets ?? [];
    const named = columns ? new Set(columns) : null;
    const columnThere = (name: string) => !named || named.has(name);
    const link = (from: string, to: string, kind: LinkKind, there: boolean) => out.push({ from, to, kind, broken: !there });

    for (const s of scene.surfaces) {
        // (A model's part of a surface in one fault block has that surface's links: they are listed once, there)
        if (s.blockOf) continue;
        const me = keys.surface(s.id);
        for (const u of s.uses ?? []) link(me, keys.inputs(u.set), 'uses', sets.has(u.set));
        const rule = s.rule;
        if (rule.kind === 'contact' || rule.kind === 'body') {
            if (rule.units) link(me, keys.unitMap(rule.units), 'units', maps.has(rule.units));
            else if (rule.table) link(me, keys.table(rule.table), 'logging', tables.has(rule.table));
            else link(me, keys.column(rule.column), 'logging', columnThere(rule.column));
        } else if (rule.kind === 'shell' && rule.of) {
            // A proportion: the logging it is the share of
            if (rule.of.table) link(me, keys.table(rule.of.table), 'logging', tables.has(rule.of.table));
            else link(me, keys.column(rule.of.column), 'logging', columnThere(rule.of.column));
        } else if (rule.kind === 'shell') link(me, keys.column(rule.column), 'values', columnThere(rule.column));
        if (s.conform && (rule.kind === 'sheet' || rule.kind === 'contact')) link(me, keys.surface(s.conform.surface), 'alongside', surfaces.has(s.conform.surface));
        const home = takesDomain(rule) ? unitDomain(s.domain) : null;
        if (home) link(me, keys.model(home.model), 'domain', (scene.models ?? []).some(m => m.id === home.model));
        // (Kept inside solids of the scene: each of them)
        if (takesDomain(rule) && isSolids(s.domain)) {
            for (const ref of s.domain.solids) {
                if (ref.kind === 'surface') link(me, keys.surface(ref.id), 'domain', surfaces.has(ref.id));
                else if (ref.kind === 'system') link(me, keys.veinSystem(ref.id), 'domain', (scene.veinSystems ?? []).some(v => v.id === ref.id));
                else link(me, keys.wireframe(ref.id), 'domain', scene.wireframes.some(w => w.id === ref.id));
            }
        }
        if (rule.kind === 'body' && rule.vein?.endsOn) link(me, keys.surface(rule.vein.endsOn.surface), 'endsOn', surfaces.has(rule.vein.endsOn.surface));
        const layersOf = s.params.trend !== false && (rule.kind === 'shell' || rule.kind === 'body') ? s.params.trendLayers : undefined;
        // (The layers of a geological model, in place of structural data: the surfaces between that model's layers.
        // Not the model itself, which may have this surface as a contact of its own)
        if (layersOf) {
            for (const c of (scene.models ?? []).find(m => m.id === layersOf)?.contacts ?? []) {
                if (c.kind !== 'intrusion' && c.surface && c.surface !== s.id && surfaces.has(c.surface)) link(me, keys.surface(c.surface), 'follows', true);
            }
        } else if (s.params.trend !== false) {
            // (Structural data of its own choosing: those sets, whatever kind of surface it is, and whether or not the model follows them)
            const own = s.params.trendSets ?? null;
            if (rule.kind === 'shell' || rule.kind === 'body') {
                if (scene.structure?.overall && !s.params.trendOwn) link(me, keys.structure, 'follows', true);
                for (const id of own ?? []) link(me, keys.readings(id), 'follows', readingSets.some(r => r.id === id));
            } else {
                for (const r of readingSets) if (own ? own.includes(r.id) : r.follow !== false) link(me, keys.readings(r.id), 'follows', true);
            }
        }
        for (const c of [s.columns.side, s.columns.distance, s.columns.thickness]) if (c) link(keys.column(c), me, 'writes', columnThere(c));
    }
    // A vein system's veins are its own
    for (const system of scene.veinSystems ?? []) for (const v of system.veins) link(keys.surface(v), keys.veinSystem(system.id), 'owns', true);
    for (const set of scene.inputs ?? []) {
        if (set.owner) link(keys.inputs(set.id), keys.surface(set.owner), 'owns', surfaces.has(set.owner));
        if (set.kind === 'lines' && scene.sectionSets?.length) {
            const on = new Set<string>();
            for (const line of set.lines) {
                const at = sectionOfLine(line, scene.sectionSets);
                if (at) on.add(at.set.id);
            }
            for (const id of on) link(keys.inputs(set.id), keys.sectionSet(id), 'drawnOn', true);
        }
    }
    const meshes = new Set(scene.wireframes.map(w => w.id));
    for (const g of scene.models ?? []) {
        const me = keys.model(g.id);
        if (g.unitMap) link(me, keys.unitMap(g.unitMap), 'units', maps.has(g.unitMap));
        for (const c of g.contacts) {
            if (c.mesh) link(me, keys.wireframe(c.mesh), 'contact', meshes.has(c.mesh));
            else if (c.surface) link(me, keys.surface(c.surface), 'contact', surfaces.has(c.surface));
        }
        for (const x of g.faults ?? []) {
            if (x.mesh) link(me, keys.wireframe(x.mesh), 'fault', meshes.has(x.mesh));
            else if (x.surface) link(me, keys.surface(x.surface), 'fault', surfaces.has(x.surface));
        }
        if (g.boundary.top && meshes.has(g.boundary.top)) link(me, keys.wireframe(g.boundary.top), 'boundary', true);
        else if (g.boundary.top) link(me, keys.surface(g.boundary.top), 'boundary', surfaces.has(g.boundary.top));
        if (g.boundary.inside) link(me, keys.model(g.boundary.inside.model), 'inside', (scene.models ?? []).some(m => m.id === g.boundary.inside!.model && m.id !== g.id));
    }
    for (const m of scene.unitMaps ?? []) {
        if (m.table) link(keys.unitMap(m.id), keys.table(m.table), 'table', tables.has(m.table));
        else link(keys.unitMap(m.id), keys.dataset, 'table', true);
    }
    return out;
}

/** What an object depends on: the links from it */
export const dependenciesOf = (links: readonly SceneLink[], key: string): SceneLink[] => links.filter(l => l.from === key);

/**
 * What depends on an object: the links to it. `transitive`: and what depends
 * on those, and so on (each object once, nearest first).
 */
export function dependentsOf(links: readonly SceneLink[], key: string, transitive = false): SceneLink[] {
    const direct = links.filter(l => l.to === key);
    if (!transitive) return direct;
    const out: SceneLink[] = [];
    const seen = new Set([key]);
    let wave = direct;
    while (wave.length) {
        const next: SceneLink[] = [];
        for (const l of wave) {
            if (seen.has(l.from)) continue;
            seen.add(l.from);
            out.push(l);
            next.push(...links.filter(x => x.to === l.from));
        }
        wave = next;
    }
    return out;
}

/** What deleting objects would touch, and whether it can be undone */
export interface DeleteImpact {
    /** The objects that depend on them (not those being deleted), nearest first, each once, with the link that ties it */
    dependents: SceneLink[];
    /** False when a logging table or the collars are among them: those are kept outside the undo history */
    undoable: boolean;
}

/** What deleting these objects would touch. */
export function deleteImpact(links: readonly SceneLink[], deleting: readonly string[]): DeleteImpact {
    const gone = new Set(deleting);
    const seen = new Set<string>();
    const dependents: SceneLink[] = [];
    for (const key of deleting) {
        for (const l of dependentsOf(links, key, true)) {
            if (gone.has(l.from) || seen.has(l.from)) continue;
            seen.add(l.from);
            dependents.push(l);
        }
    }
    const undoable = deleting.every(k => {
        const kind = parseKey(k)?.kind;
        return kind !== 'table' && kind !== 'collars';
    });
    return { dependents, undoable };
}
