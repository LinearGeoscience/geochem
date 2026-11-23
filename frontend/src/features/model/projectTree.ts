/**
 * The project tree of the modelling page (pure): every object of the project
 * in its group and folder, and under each surface the objects it is made
 * from, as links.
 *
 *   Drillholes   collars and surveys; the samples and the logging tables, each with the unit maps that read it
 *   Structure    the overall direction; reading sets, in folders
 *   Points       sets of points, in folders
 *   Lines        sets of lines, in folders
 *   Surfaces     in folders; under each, the sets it uses and what it is built from
 *   Sections     section sets
 *   Meshes       wireframes, in folders
 *
 * The groups are a list (ROOTS), so the geological models, faults and veins
 * of later rounds are each a row more.
 */
import type { DrillholeDb } from './drillholes';
import { faultCuts, modelBlocks, partsOf, sameSides, sidesText, splitsByBlock } from './blockParts';
import { folderName, foldersOf, parentFolder } from './folders';
import { contactProblem, describeContact, faultProblem, KIND_NAME, modelUnits, sideNames, sideOf, unitColor } from './geoModel';
import { surfaceHomes, type SurfaceUse } from './modelHome';
import { domainUnits, isSolids, listText, solidsText, unitDomain } from './shellDomains';
import { keys, parseModelGroup, parseModelPart, type FolderRoot, type ModelGroupPart, type ObjectKind } from './objectKeys';
import { typeAt, type ObjectType } from './objectTypes';
import { dependenciesOf, sceneLinks, type LinkKind, type SceneLink } from './sceneLinks';
import type { ModelScene, SurfaceObject } from './types';
import { t, type TermKey } from './terms';

/**
 * fitting = being worked out; failed = it could not be; empty = it has nothing
 * to be made from yet; missing = something it is built from is gone; stale =
 * what it is built from has changed and it waits to be asked to rebuild;
 * problem = it is there, but cannot be used as it is (`statusText` says why)
 */
export type NodeStatus = 'fitting' | 'failed' | 'empty' | 'missing' | 'stale' | 'problem';

export interface TreeNode {
    /** Unique in the tree: the object's key; a link's is `link:<from>><to>` */
    key: string;
    kind: ObjectKind | 'link';
    name: string;
    /** A short note shown after the name ("120 points") */
    detail?: string;
    /** What sort of object of its kind: a surface's rule, a set's kind, a reading set's kind, a table of intervals or of depths, a model's part */
    sub?: string;
    /** What a surface, a contact or a fault is to a geologist (objectTypes): its icon */
    type?: ObjectType;
    color?: string;
    /** The key whose visibility its eye shows (absent: it has no eye) */
    visKey?: string;
    /** Made and kept by the program (a model's part of a contact in one fault block): not edited, named, moved or deleted by hand */
    made?: boolean;
    /** It can be locked, and is */
    lockable?: boolean;
    locked?: boolean;
    status?: NodeStatus | null;
    /** What is wrong, in words, when more is known than the status says (why a fit failed, what a contact lacks) */
    statusText?: string;
    /** For a link: the object it points at, how, and whether that is there */
    link?: { target: string; via: LinkKind; broken: boolean };
    children: TreeNode[];
}

export interface TreeOptions {
    /** The samples, when a dataset is loaded */
    samples?: { rows: number } | null;
    /** The samples have hole IDs, so the views draw hole traces through them (with no collars loaded) */
    traces?: boolean;
    /** The dataset's column names (to tell a link to a missing column) */
    columns?: readonly string[];
    /** A surface's state from the fits (fitting, failed, empty), by key */
    status?: (key: string) => NodeStatus | null;
    /** Why a surface's fit or a model's build failed, in words, by key (null: not known) */
    statusText?: (key: string) => string | null;
    /** A unit's volume in a built model, in words (null: not built) */
    volume?: (model: string, unit: string) => string | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** The groups of the tree, in order */
export const ROOTS: readonly { name: string; title: string; folders?: FolderRoot }[] = [
    { name: 'drillholes', title: t('drillholes') },
    { name: 'models', title: t('models') },
    { name: 'numeric', title: t('numericModels') },
    { name: 'structure', title: t('structuralData'), folders: 'readings' },
    { name: 'points', title: t('points'), folders: 'points' },
    { name: 'lines', title: t('polylines'), folders: 'lines' },
    { name: 'surfaces', title: t('surfaces'), folders: 'surfaces' },
    { name: 'sections', title: t('sections') },
    { name: 'meshes', title: t('meshes'), folders: 'meshes' },
];

/** The name an object goes by in the tree */
export function nameOfKey(scene: ModelScene, db: Pick<DrillholeDb, 'tables'> | null, key: string): string {
    const [kind, ...rest] = key.split(':');
    const id = rest.join(':');
    switch (kind) {
        case 'surface': return scene.surfaces.find(s => s.id === id)?.name ?? 'A surface no longer in the project';
        case 'inputs': return scene.inputs?.find(s => s.id === id)?.name ?? 'A set no longer in the project';
        case 'readings': return scene.structure?.sets?.find(s => s.id === id)?.name ?? 'Measurements no longer in the project';
        case 'wireframe': return scene.wireframes.find(w => w.id === id)?.name ?? 'A mesh no longer in the project';
        case 'unitMap': return scene.unitMaps?.find(m => m.id === id)?.name ?? 'Units no longer in the project';
        case 'sectionSet': return scene.sectionSets?.find(s => s.id === id)?.name ?? 'Sections no longer in the project';
        case 'numericModel': return scene.numericModels?.find(m => m.id === id)?.name ?? 'A numeric model no longer in the project';
        case 'veinSystem': return scene.veinSystems?.find(v => v.id === id)?.name ?? 'A vein system no longer in the project';
        case 'table': return db?.tables.find(t => t.id === id)?.name ?? 'A logging table no longer in the project';
        case 'column': return id;
        case 'model': return scene.models?.find(g => g.id === id)?.name ?? 'A model no longer in the project';
        case 'modelGroup': { const part = parseModelGroup(key); return part ? t(MODEL_GROUP_TERM[part.part]) : key; }
        case 'volume': return parseModelPart(key)?.part ?? key;
        case 'modelFault': {
            const part = parseModelPart(key);
            const fault = scene.models?.find(g => g.id === part?.model)?.faults?.find(x => x.id === part?.part);
            return fault ? nameOfKey(scene, db, fault.mesh ? keys.wireframe(fault.mesh) : keys.surface(fault.surface ?? '')) : 'A fault no longer in the model';
        }
        case 'modelContact': {
            const part = parseModelPart(key);
            const contact = scene.models?.find(g => g.id === part?.model)?.contacts.find(c => c.id === part?.part);
            return contact ? nameOfKey(scene, db, contact.mesh ? keys.wireframe(contact.mesh) : keys.surface(contact.surface ?? '')) : 'A contact no longer in the model';
        }
        case 'structure': return t('globalTrend');
        case 'collars': return 'Collars and surveys';
        case 'dataset': return 'Samples';
        default: return key;
    }
}

/** Objects put in their folders: folders first (by name), then the objects in the order given */
function filed(scene: ModelScene, root: FolderRoot, objects: { node: TreeNode; folder: string | null }[]): TreeNode[] {
    const top: TreeNode[] = [];
    const byPath = new Map<string, TreeNode>();
    for (const path of foldersOf(scene, root)) {
        const node: TreeNode = { key: keys.folder(root, path), kind: 'folder', name: folderName(path), children: [] };
        byPath.set(path, node);
        const parent = parentFolder(path);
        (parent ? byPath.get(parent)!.children : top).push(node);
    }
    for (const { node, folder } of objects) (folder ? byPath.get(folder)?.children ?? top : top).push(node);
    // Folders before objects in every folder
    const order = (list: TreeNode[]) => {
        list.sort((a, b) => (a.kind === 'folder' ? 0 : 1) - (b.kind === 'folder' ? 0 : 1));
        for (const n of list) if (n.kind === 'folder') order(n.children);
    };
    order(top);
    for (const n of top) if (n.kind === 'folder') countIn(n);
    return top;
}

/** A folder's note: how many objects are in it, folders within included */
function countIn(folder: TreeNode): number {
    let n = 0;
    for (const c of folder.children) n += c.kind === 'folder' ? countIn(c) : 1;
    folder.detail = n === 0 ? 'empty' : plural(n, 'object');
    return n;
}

/** The title of each part a model is laid out in */
export const MODEL_GROUP_TERM: Record<ModelGroupPart, TermKey> = {
    boundary: 'boundary', lithologies: 'lithologies', faults: 'faultSystem', chronology: 'chronology', volumes: 'outputVolumes',
};

/** What a surface is made from, as links under it, and whether something it cannot do without is gone */
function surfaceNode(
    s: SurfaceObject, home: SurfaceUse | null, scene: ModelScene, db: DrillholeDb | null, links: readonly SceneLink[], options: TreeOptions, status: (key: string) => NodeStatus | null,
): TreeNode {
    const me = keys.surface(s.id);
    const made = dependenciesOf(links, me).filter(l => l.kind === 'uses' || l.kind === 'units' || l.kind === 'logging' || l.kind === 'values' || l.kind === 'endsOn' || l.kind === 'alongside' || l.kind === 'domain');
    const children: TreeNode[] = made.map(l => {
        const own = l.kind === 'uses' && scene.inputs?.find(x => x.id === l.to.slice('inputs:'.length))?.owner === s.id;
        return {
            key: `link:${me}>${l.to}`, kind: 'link' as const, name: l.kind === 'domain' && unitDomain(s.domain) ? `${listText(domainUnits(unitDomain(s.domain)!))}, in ${nameOfKey(scene, db, l.to)}` : nameOfKey(scene, db, l.to),
            detail: l.kind === 'uses' ? (own ? 'its own' : 'used') : l.kind === 'units' ? 'its units' : l.kind === 'values' ? 'its values' : l.kind === 'endsOn' ? 'what it ends on' : l.kind === 'alongside' ? 'what it is conformable to' : l.kind === 'domain' ? 'its domain' : 'its logging',
            status: l.broken ? 'missing' as const : null, link: { target: l.to, via: l.kind, broken: l.broken }, children: [],
        };
    });
    const broken = made.some(l => l.broken && l.kind !== 'uses');
    const text = broken ? null : options.statusText?.(me);
    return {
        key: me, kind: 'surface', name: s.name, sub: s.rule.kind, type: typeAt(s, home), color: s.color, visKey: me,
        lockable: true, locked: !!s.locked,
        status: broken ? 'missing' : status(me), ...(text ? { statusText: text } : {}), children,
    };
}

/** The project tree of a scene and its drillhole tables. */
export function buildProjectTree(scene: ModelScene, db: DrillholeDb | null, options: TreeOptions = {}): TreeNode[] {
    const links = sceneLinks(scene, db, options.columns);
    const status = options.status ?? (() => null);
    const roots: TreeNode[] = [];
    for (const root of ROOTS) {
        const node: TreeNode = { key: keys.root(root.name), kind: 'root', name: root.title, children: [] };
        node.children = childrenOf(root.name, scene, db, links, options, status);
        roots.push(node);
    }
    return roots;
}

function childrenOf(
    root: string, scene: ModelScene, db: DrillholeDb | null, links: readonly SceneLink[], options: TreeOptions, status: (key: string) => NodeStatus | null,
): TreeNode[] {
    const maps = scene.unitMaps ?? [];
    /** A surface whose fit was stopped is marked where a model uses it too: its own row may be folded away under that one */
    const stoppedMark = (surfaceId: string | null | undefined): NodeStatus | null => (surfaceId && status(keys.surface(surfaceId)) === 'stale' ? 'stale' : null);
    /** Why an object failed, when the fits have said */
    const said = (key: string): { statusText?: string } => { const text = options.statusText?.(key); return text ? { statusText: text } : {}; };
    const mapNode = (m: (typeof maps)[number]): TreeNode => ({
        key: keys.unitMap(m.id), kind: 'unitMap', name: m.name, detail: plural(m.units.length, 'unit'),
        status: m.table && !db?.tables.some(t => t.id === m.table) ? 'missing' : null, children: [],
    });
    switch (root) {
        case 'drillholes': {
            const out: TreeNode[] = [];
            const holes = db ? new Set(db.collar.hole).size : 0;
            // The eye of the collars shows and hides the hole traces in the view
            if (holes > 0) out.push({ key: keys.collars, kind: 'collars', name: 'Collars and surveys', detail: plural(holes, 'hole'), visKey: keys.collars, children: [] });
            else if (options.traces && options.samples) out.push({ key: keys.collars, kind: 'collars', name: 'Hole traces', detail: 'through the samples', visKey: keys.collars, children: [] });
            const loose = maps.filter(m => !m.table);
            if (options.samples || loose.length) {
                out.push({
                    key: keys.dataset, kind: 'dataset', name: 'Samples', detail: options.samples ? plural(options.samples.rows, 'row') : undefined,
                    status: options.samples ? null : 'missing', visKey: options.samples ? keys.dataset : undefined, children: loose.map(mapNode),
                });
            }
            for (const t of db?.tables ?? []) {
                // A table of intervals is drawn down the holes, where a view is told to
                out.push({
                    key: keys.table(t.id), kind: 'table', name: t.name, sub: t.to ? 'intervals' : 'depths',
                    detail: t.to ? plural(t.hole.length, 'interval') : plural(t.hole.length, 'depth'),
                    visKey: t.to ? keys.table(t.id) : undefined,
                    children: maps.filter(m => m.table === t.id).map(mapNode),
                });
            }
            // Unit maps of a table that has gone
            const gone = [...new Set(maps.filter(m => m.table && !db?.tables.some(t => t.id === m.table)).map(m => m.table!))];
            for (const id of gone) {
                out.push({ key: keys.table(id), kind: 'table', name: nameOfKey(scene, db, keys.table(id)), status: 'missing', children: maps.filter(m => m.table === id).map(mapNode) });
            }
            return out;
        }
        case 'structure': {
            const overall = scene.structure?.overall ?? null;
            const direction: TreeNode = {
                key: keys.structure, kind: 'structure', name: t('globalTrend'), visKey: keys.structure,
                detail: overall ? `dips ${Math.round(overall.dip)}° to ${String(Math.round(overall.dipDirection)).padStart(3, '0')}` : 'not set', children: [],
            };
            const sets = (scene.structure?.sets ?? []).map(s => ({
                folder: s.folder ?? null,
                node: {
                    key: keys.readings(s.id), kind: 'readings' as const, name: s.name, sub: s.kind, color: s.color, visKey: keys.readings(s.id),
                    detail: `${plural(s.readings.length, 'measurement')}${s.follow === false ? ', not followed' : ''}`, children: [],
                },
            }));
            return [direction, ...filed(scene, 'readings', sets)];
        }
        case 'points':
        case 'lines': {
            const kind = root === 'points' ? 'points' : 'lines';
            const sets = (scene.inputs ?? []).filter(s => s.kind === kind).map(s => ({
                folder: s.folder,
                node: {
                    key: keys.inputs(s.id), kind: 'inputs' as const, name: s.name, sub: s.kind, color: s.color, visKey: keys.inputs(s.id),
                    lockable: true, locked: s.locked,
                    detail: s.kind === 'points' ? plural(s.points.length, 'point') : plural(s.lines.length, 'line'),
                    status: s.owner && !scene.surfaces.some(x => x.id === s.owner) ? 'missing' as const : null, children: [],
                },
            }));
            return filed(scene, root, sets);
        }
        case 'surfaces': {
            // A surface a model uses is listed in that model (the first that uses it): what is here is what no model has yet
            const homes = surfaceHomes(scene);
            const surfaces = scene.surfaces.filter(s => !homes.has(s.id)).map(s => ({ folder: s.folder ?? null, node: surfaceNode(s, null, scene, db, links, options, status) }));
            // A vein system holds its veins, in its order
            const systems = (scene.veinSystems ?? []).map(v => {
                const veins = v.veins.map(id => scene.surfaces.find(s => s.id === id)).filter((s): s is SurfaceObject => !!s)
                    .map(s => surfaceNode(s, homes.get(s.id) ?? null, scene, db, links, options, status));
                const worst = (['failed', 'missing', 'fitting', 'stale'] as const).find(w => veins.some(s => s.status === w)) ?? null;
                return { folder: null, node: { key: keys.veinSystem(v.id), kind: 'veinSystem' as const, name: v.name, detail: plural(veins.length, 'vein'), status: worst, children: veins } };
            });
            return filed(scene, 'surfaces', [...systems, ...surfaces]);
        }
        case 'numeric': {
            // A numeric model holds its shells, the lowest cut-off first: they are not in the Surfaces group
            const homes = surfaceHomes(scene);
            return (scene.numericModels ?? []).map(m => {
                const shells = m.shells.map(x => scene.surfaces.find(s => s.id === x.surface)).filter((s): s is SurfaceObject => !!s)
                    .map(s => surfaceNode(s, homes.get(s.id) ?? null, scene, db, links, options, status));
                const worst = (['failed', 'missing', 'fitting', 'stale'] as const).find(w => shells.some(s => s.status === w)) ?? null;
                return {
                    key: keys.numericModel(m.id), kind: 'numericModel' as const, name: m.name,
                    detail: `${m.rule.column}, ${plural(m.shells.length, 'cut-off')}${m.domain ? `, in ${isSolids(m.domain) ? solidsText(m.domain, scene) || 'solids no longer in the project' : listText(domainUnits(m.domain))}` : ''}`, status: shells.length === 0 ? 'empty' as const : worst, children: shells,
                };
            });
        }
        case 'models': {
            const homes = surfaceHomes(scene);
            return (scene.models ?? []).map(g => {
                const me = keys.model(g.id);
                const part = (name: ModelGroupPart, children: TreeNode[], detail?: string): TreeNode => ({
                    key: keys.modelGroup(g.id, name), kind: 'modelGroup', name: t(MODEL_GROUP_TERM[name]), sub: name, ...(detail ? { detail } : {}), children,
                });
                /** The surface itself where this is its home (its place in this model is where it is kept), else a link to it */
                const held = (surfaceId: string | undefined, role: SurfaceUse['role'], at: string | null, link: TreeNode): TreeNode => {
                    const s = scene.surfaces.find(x => x.id === surfaceId);
                    const home = s ? homes.get(s.id) : undefined;
                    // (Said to be what the link would have said it is: the row over it has the same name)
                    return s && home && home.model === g.id && home.role === role && home.part === at ? { ...surfaceNode(s, home, scene, db, links, options, status), detail: link.detail } : link;
                };

                // --- The ground it covers: its top, and the unit of another model it is inside ---
                const boundary: TreeNode[] = [];
                if (g.boundary.top) {
                    const mesh = scene.wireframes.some(w => w.id === g.boundary.top);
                    const to = mesh ? keys.wireframe(g.boundary.top) : keys.surface(g.boundary.top);
                    const gone = !mesh && !scene.surfaces.some(s => s.id === g.boundary.top);
                    boundary.push(held(mesh ? undefined : g.boundary.top, 'top', null, {
                        key: `link:${me}>${to}`, kind: 'link', name: nameOfKey(scene, db, to), detail: 'its topography', status: gone ? 'missing' : null, link: { target: to, via: 'boundary', broken: gone }, children: [],
                    }));
                }
                if (g.boundary.inside) {
                    const to = keys.model(g.boundary.inside.model), broken = !(scene.models ?? []).some(m => m.id === g.boundary.inside!.model && m.id !== g.id);
                    boundary.push({ key: `link:${me}>${to}`, kind: 'link', name: broken ? 'A model that is gone' : `${g.boundary.inside.unit}, in ${nameOfKey(scene, db, to)}`, detail: 'what it is inside', status: broken ? 'missing' : null, link: { target: to, via: 'inside', broken }, children: [] });
                }

                // --- Its units ---
                const lithologies: TreeNode[] = [];
                if (g.unitMap) {
                    const to = keys.unitMap(g.unitMap), broken = !maps.some(m => m.id === g.unitMap);
                    lithologies.push({ key: `link:${me}>${to}`, kind: 'link', name: nameOfKey(scene, db, to), detail: 'its units', status: broken ? 'missing' : null, link: { target: to, via: 'units', broken }, children: [] });
                }

                // --- Its faults ---
                const faults: TreeNode[] = [];
                const cuts = faultCuts(scene, g);
                for (const x of g.faults ?? []) {
                    const to = x.mesh ? keys.wireframe(x.mesh) : keys.surface(x.surface ?? '');
                    const key = keys.modelFault(g.id, x.id);
                    const why = faultProblem(scene, x), bad = why !== null;
                    // (Gone: what it is made of is no longer there. Otherwise it is there, and cannot be a fault as it is)
                    const gone = x.mesh ? !scene.wireframes.some(w => w.id === x.mesh) : !scene.surfaces.some(s => s.id === x.surface);
                    const ends = (x.ends ?? []).map(e => nameOfKey(scene, db, keys.modelFault(g.id, e.fault)));
                    // A fault that younger faults offset: its part on each side of those, under it
                    const cut = cuts.find(c => c.fault.id === x.id);
                    const pieces: TreeNode[] = cut ? partsOf(scene, g.id, x.surface).map(p => ({
                        ...surfaceNode(p, homes.get(p.id) ?? null, scene, db, links, options, status),
                        name: sidesText(scene, g, p.within?.sides ?? []), detail: 'its part on this side', made: true, lockable: false, locked: false, children: [],
                    })) : [];
                    faults.push({
                        key, kind: 'modelFault', name: nameOfKey(scene, db, to), sub: 'fault', type: 'fault',
                        detail: `fault${x.off ? ', left out' : ''}${ends.length ? `, ends on ${ends.join(' and ')}` : ''}${cut ? `, offset by ${cut.cutters.map(y => nameOfKey(scene, db, keys.modelFault(g.id, y.id))).join(' and ')}` : ''}`,
                        color: scene.surfaces.find(s => s.id === x.surface)?.color, status: gone ? 'missing' : bad ? 'problem' : stoppedMark(x.surface), ...(why && !gone ? { statusText: why } : {}),
                        visKey: bad || x.off ? undefined : key,
                        children: [held(x.surface, 'fault', x.id, { key: `link:${key}>${to}`, kind: 'link', name: nameOfKey(scene, db, to), detail: x.mesh ? 'its mesh' : 'its surface', status: gone ? 'missing' : null, link: { target: to, via: 'fault', broken: gone }, children: [] }), ...pieces],
                    });
                }

                // --- The age order, the youngest first ---
                const chronology: TreeNode[] = [];
                // The fault blocks it is cut into: a contact fitted in each apart has a part in each, under it
                const blocks = modelBlocks(scene, g);
                for (const c of g.contacts) {
                    const split = blocks.length > 1 && splitsByBlock(g, c);
                    const parts: TreeNode[] = split ? partsOf(scene, g.id, c.surface).map(p => ({
                        ...surfaceNode(p, homes.get(p.id) ?? null, scene, db, links, options, status),
                        name: blocks.find(b => sameSides(b.sides, p.within?.sides ?? []))?.name ?? p.name, detail: 'its part in this fault block', made: true, lockable: false, locked: false, children: [],
                    })) : [];
                    const to = c.mesh ? keys.wireframe(c.mesh) : keys.surface(c.surface ?? '');
                    const surface = scene.surfaces.find(s => s.id === c.surface);
                    const bad = contactProblem(scene, c);
                    const gone = c.mesh ? !scene.wireframes.some(w => w.id === c.mesh) : !surface;
                    // The fault block it is in, when it is not in all of them
                    const block = (c.within ?? []).map(e => {
                        const fault = g.faults?.find(x => x.id === e.fault);
                        return sideOf(sideNames(scene.surfaces.find(s => s.id === fault?.surface), !!fault?.mesh)[e.side > 0 ? 0 : 1], nameOfKey(scene, db, keys.modelFault(g.id, e.fault)));
                    }).join(', ');
                    chronology.push({
                        key: keys.modelContact(g.id, c.id), kind: 'modelContact', name: nameOfKey(scene, db, to), sub: c.kind,
                        // (A vein is a vein whatever kind of contact it is given)
                        type: surface ? typeAt(surface, { role: 'contact', kind: c.kind }) : c.kind,
                        detail: `${KIND_NAME[c.kind].toLowerCase()}${c.off ? ', left out' : ''}: ${describeContact(c, sideNames(surface, !!c.mesh))}${block ? `; only ${block}` : split ? '; by fault block' : ''}`,
                        color: surface?.color, status: gone ? 'missing' : bad ? 'problem' : stoppedMark(c.surface), ...(bad && !gone ? { statusText: bad } : {}), visKey: gone || bad || c.off ? undefined : keys.modelContact(g.id, c.id),
                        children: [held(c.surface, 'contact', c.id, { key: `link:${keys.modelContact(g.id, c.id)}>${to}`, kind: 'link', name: nameOfKey(scene, db, to), detail: c.mesh ? 'its mesh' : 'its surface', status: gone ? 'missing' : null, link: { target: to, via: 'contact', broken: gone }, children: [] }), ...parts],
                    });
                }

                // --- Its units' solids, the youngest first as the contacts are ---
                const units = modelUnits(scene, g).filter(Boolean);
                const volumes: TreeNode[] = [...units].reverse().map(u => ({
                    key: keys.volume(g.id, u), kind: 'volume', name: u, detail: options.volume?.(g.id, u) ?? undefined, color: unitColor(scene, g, u), visKey: keys.volume(g.id, u), children: [],
                }));

                return {
                    key: me, kind: 'model' as const, name: g.name, visKey: me,
                    detail: `${plural(g.contacts.length, 'contact')}, ${plural(units.length, 'unit')}${g.faults?.length ? `, ${plural(g.faults.length, 'fault')}` : ''}`, status: status(me), ...said(me),
                    children: [
                        part('boundary', boundary),
                        part('lithologies', lithologies, g.unitMap ? undefined : 'not set'),
                        part('faults', faults, faults.length ? undefined : 'none'),
                        part('chronology', chronology, chronology.length ? 'youngest first' : 'no surfaces yet'),
                        part('volumes', volumes),
                    ],
                };
            });
        }
        case 'sections':
            return (scene.sectionSets ?? []).map(s => ({
                key: keys.sectionSet(s.id), kind: 'sectionSet' as const, name: s.name, detail: `every ${s.spacing.toLocaleString()} m`, children: [],
            }));
        case 'meshes': {
            const meshes = scene.wireframes.map(w => ({
                folder: w.folder ?? null,
                node: { key: keys.wireframe(w.id), kind: 'wireframe' as const, name: w.name, color: w.color, visKey: keys.wireframe(w.id), detail: w.file, children: [] },
            }));
            return filed(scene, 'meshes', meshes);
        }
        default:
            return [];
    }
}

/** One row of the tree as it is shown */
export interface TreeRow {
    node: TreeNode;
    depth: number;
    /** It has children, and they are shown */
    hasChildren: boolean;
    open: boolean;
    /** The keys of the nodes it is in, outermost first */
    path: string[];
}

/**
 * The rows shown: each node, and the children of the open ones. With a
 * filter, the nodes whose name holds it (any case) and the nodes they are in,
 * all open.
 */
export function flattenTree(nodes: readonly TreeNode[], expanded: ReadonlySet<string>, filter = ''): TreeRow[] {
    const want = filter.trim().toLowerCase();
    const matches = new Map<string, boolean>();
    const hit = (n: TreeNode): boolean => {
        const known = matches.get(n.key);
        if (known !== undefined) return known;
        let any = n.name.toLowerCase().includes(want);
        for (const c of n.children) if (hit(c)) any = true;
        matches.set(n.key, any);
        return any;
    };
    const out: TreeRow[] = [];
    const walk = (list: readonly TreeNode[], depth: number, path: string[]) => {
        for (const n of list) {
            if (want && !hit(n)) continue;
            const open = want ? n.children.some(hit) : expanded.has(n.key);
            out.push({ node: n, depth, hasChildren: n.children.length > 0, open: open && n.children.length > 0, path });
            if (open) walk(n.children, depth + 1, [...path, n.key]);
        }
    };
    walk(nodes, 0, []);
    return out;
}

/** Find a node by key */
export function findNode(nodes: readonly TreeNode[], key: string): TreeNode | null {
    for (const n of nodes) {
        if (n.key === key) return n;
        const inner = findNode(n.children, key);
        if (inner) return inner;
    }
    return null;
}

/** The tree as indented text: a name, its note in brackets, its state in square brackets, an arrow for a link */
export function printTree(nodes: readonly TreeNode[], depth = 0): string {
    return nodes.map(n => {
        const line = `${'  '.repeat(depth)}${n.link ? '-> ' : ''}${n.name}${n.detail ? ` (${n.detail})` : ''}${n.status ? ` [${n.status}]` : ''}${n.locked ? ' [locked]' : ''}`;
        return n.children.length ? `${line}\n${printTree(n.children, depth + 1)}` : line;
    }).join('\n');
}
