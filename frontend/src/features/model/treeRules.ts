/**
 * What can be done to the objects of the project tree (pure): the right-click
 * menu of a row, what a drop does, what a delete takes with it and the names
 * of new folders. The tree pane (features/modelling/tree) asks these and the
 * tree commands carry them out, so the rules are tested apart from the pane.
 */
import type { DrillholeDb } from './drillholes';
import { folderName, foldersOf, isWithin, parentFolder, rootOfKey } from './folders';
import { partHome } from './blockParts';
import { surfaceHome } from './modelHome';
import { parseFolderKey, parseKey, parseModelGroup, parseModelPart, type FolderRoot } from './objectKeys';
import { nameOfKey, ROOTS, type TreeNode } from './projectTree';
import { deleteImpact, type LinkKind, type SceneLink } from './sceneLinks';
import type { ModelScene } from './types';
import { newActionOf, newIn, newMenuLabel, type NewId } from './newObjects';
import { t } from './terms';

/** The group of the tree a root key stands for, when it holds folders */
export function folderRootOf(key: string): FolderRoot | null {
    const parsed = parseKey(key);
    if (parsed?.kind === 'root') return ROOTS.find(r => r.name === parsed.id)?.folders ?? null;
    if (parsed?.kind === 'folder') return parseFolderKey(key)?.root ?? null;
    return null;
}

/** The keys of the nodes a node is in, outermost first (null: no such node) */
export function ancestorsOf(nodes: readonly TreeNode[], key: string): string[] | null {
    for (const n of nodes) {
        if (n.key === key) return [];
        const inner = ancestorsOf(n.children, key);
        if (inner) return [n.key, ...inner];
    }
    return null;
}

/** The keys a node's eye shows and hides: its own, and those of every object inside it (not through links) */
export function visKeysUnder(node: TreeNode): string[] {
    // A contact or a fault of a model: its own eye is for the contact as the model cuts it. The surface kept under it has its own
    if (isCut(node.kind)) return node.visKey ? [node.visKey] : [];
    const out: string[] = [];
    const walk = (n: TreeNode) => {
        if (n.kind === 'link' || n.kind === 'note') return;
        if (n.visKey) out.push(n.visKey);
        for (const c of n.children) walk(c);
    };
    walk(node);
    return [...new Set(out)];
}

const isCut = (kind: string | undefined): boolean => kind === 'modelContact' || kind === 'modelFault';

/** The keys of every row that opens, among some nodes and everything under them (a link is not gone through) */
export function openableUnder(nodes: readonly TreeNode[]): string[] {
    const out: string[] = [];
    const walk = (n: TreeNode) => {
        if (n.children.length === 0) return;
        out.push(n.key);
        for (const c of n.children) walk(c);
    };
    for (const n of nodes) walk(n);
    return out;
}

/**
 * Of the keys an eye covers, those it reads from, and shows when it is
 * clicked to show: a model's contacts as it cuts them are drawn only where a
 * view is told to (viewVisibility.ts), so an eye over more than those leaves
 * them be. A model with its surfaces and solids showing reads as shown, not
 * as partly shown, and showing it does not draw every cut contact as well.
 * (Hiding hides everything the eye covers.)
 */
export function eyeKeys(visKeys: readonly string[]): string[] {
    const plain = visKeys.filter(k => !isCut(parseKey(k)?.kind));
    return plain.length > 0 ? plain : [...visKeys];
}

/** Shown, hidden or some of each, for an eye over several objects (null: nothing to show) */
export function eyeState(visKeys: readonly string[], hidden: ReadonlySet<string>): 'shown' | 'hidden' | 'some' | null {
    if (visKeys.length === 0) return null;
    const off = visKeys.filter(k => hidden.has(k)).length;
    return off === 0 ? 'shown' : off === visKeys.length ? 'hidden' : 'some';
}

/**
 * What the eye over some objects reads: that of the keys it shows when clicked (`eyeKeys`); and where those are all
 * hidden while a contact as its model cuts it is drawn under it, some of each, so that no eye reads hidden over
 * something that is drawn.
 */
export function eyeOver(visKeys: readonly string[], hidden: ReadonlySet<string>): 'shown' | 'hidden' | 'some' | null {
    const state = eyeState(eyeKeys(visKeys), hidden);
    return state === 'hidden' && visKeys.some(k => !hidden.has(k)) ? 'some' : state;
}

const RENAMABLE = new Set(['surface', 'inputs', 'readings', 'wireframe', 'unitMap', 'sectionSet', 'folder', 'model', 'numericModel', 'veinSystem']);
/** Kinds the tree can delete (some only at times: cannotDelete) */
const DELETABLE = new Set(['surface', 'inputs', 'readings', 'wireframe', 'unitMap', 'sectionSet', 'folder', 'table', 'model', 'modelContact', 'modelFault', 'numericModel', 'veinSystem']);

/** Can the node be renamed in the tree */
export const renamable = (node: TreeNode): boolean => RENAMABLE.has(node.kind) && !node.made;

/**
 * Why a node cannot be deleted from the tree (null: it can). Groups, the
 * samples, the collars, the overall direction and links are not deleted
 * here; a logging table the model reads, and a unit map of several columns
 * a surface reads (it has no one column to go back to), are kept. A locked
 * object is kept until it is unlocked (that is what the lock is for).
 */
export function cannotDelete(node: TreeNode, scene: ModelScene): string | null {
    if (node.locked) return `${node.name} is locked: unlock it to delete it.`;
    if (node.kind === 'link' || node.kind === 'note') return NOT_DELETED_HERE;
    return cannotDeleteKey(scene, null, node.key);
}

const NOT_DELETED_HERE = 'This is part of the project and is not deleted here.';

/**
 * Why an object cannot be deleted, by its key (null: it can): the rules of
 * `cannotDelete`, for a delete asked for away from the tree (an object's
 * properties, a dialog). `db`: the logging tables, for an object's name.
 */
export function cannotDeleteKey(scene: ModelScene, db: Pick<DrillholeDb, 'tables'> | null, key: string): string | null {
    const parsed = parseKey(key);
    if (!parsed) return NOT_DELETED_HERE;
    const locked = parsed.kind === 'surface' ? !!scene.surfaces.find(s => s.id === parsed.id)?.locked
        : parsed.kind === 'inputs' ? !!scene.inputs?.find(s => s.id === parsed.id)?.locked : false;
    if (locked) return `${nameOfKey(scene, db, key)} is locked: unlock it to delete it.`;
    // A model's part of a contact in one fault block comes and goes with its contact and the faults
    const part = parsed.kind === 'surface' ? scene.surfaces.find(s => s.id === parsed.id) : undefined;
    if (part?.blockOf) {
        const home = partHome(scene, part);
        if (home?.fault) return `It is made by ${home.model.name} for one side of the faults that offset its fault: it goes when the fault is taken out or is no longer offset.`;
        return `It is made by ${home?.model.name ?? 'its model'} for one fault block: it goes when its contact is taken out or is no longer offset by the faults.`;
    }
    switch (parsed.kind) {
        case 'surface': case 'inputs': case 'readings': case 'wireframe': case 'sectionSet': case 'folder': case 'model': case 'modelContact': case 'modelFault': case 'numericModel': case 'veinSystem':
            return null;
        case 'unitMap': {
            const map = scene.unitMaps?.find(m => m.id === parsed?.id);
            const readers = scene.surfaces.filter(s => !s.blockOf && (s.rule.kind === 'contact' || s.rule.kind === 'body') && s.rule.units === parsed?.id);
            return map && map.columns.length > 1 && readers.length > 0
                ? `${readers.length === 1 ? readers[0].name : `${readers.length} surfaces`} read${readers.length === 1 ? 's' : ''} these units, made of ${map.columns.length} columns: there is no one column to go back to.`
                : null;
        }
        case 'table': {
            const id = parsed?.id;
            const surfaces = scene.surfaces.filter(s => !s.blockOf && (s.rule.kind === 'contact' || s.rule.kind === 'body') && s.rule.table === id).length;
            const maps = (scene.unitMaps ?? []).filter(m => m.table === id).length;
            if (surfaces + maps === 0) return null;
            const what = [surfaces ? `${surfaces} surface${surfaces === 1 ? '' : 's'}` : '', maps ? `${maps} set${maps === 1 ? '' : 's'} of units` : ''].filter(Boolean).join(' and ');
            return `${what} ${surfaces + maps === 1 ? 'is' : 'are'} built from it.`;
        }
        default:
            return NOT_DELETED_HERE;
    }
}

/** What a row's status mark says: the reason itself where one is known (why a fit failed, what a contact lacks) */
export function statusTip(node: Pick<TreeNode, 'kind' | 'status' | 'statusText'>): string {
    const model = node.kind === 'model';
    switch (node.status) {
        case 'fitting': return model ? 'Being built' : 'Being fitted';
        case 'failed': return `${model ? 'It could not be built' : 'It could not be fitted'}. ${node.statusText ?? 'Open it to see why.'}`;
        case 'empty': return model ? 'Nothing to build it in yet: there is no data, and it has not been given a boundary' : 'Nothing to fit it through yet';
        case 'missing': return 'Something it is built from is no longer in the project';
        case 'stale': return model ? 'What it is built from has changed since it was built. Open it and build it again.'
            : 'Its fit was stopped before it was done: it is not as it is set now. Open it and fit it now.';
        case 'problem': return node.statusText ?? 'It cannot be used as it is';
        default: return '';
    }
}

export type TreeMenuAction =
    | 'goTo' | 'edit' | 'newFolder' | 'rename' | 'openAll' | 'closeAll' | 'zoomTo' | 'show' | 'hide' | 'showOnly' | 'lock' | 'unlock'
    | 'moveOut' | 'export' | 'kit' | 'delete' | 'properties'
    /** Make one of the things of newObjects.ts */
    | `new:${NewId}`;

/** Kinds of node that stand for objects with a place in the view (a folder or a group: what is in it) */
const PLACED = new Set(['surface', 'inputs', 'readings', 'wireframe', 'folder', 'model', 'modelContact', 'modelFault', 'volume', 'modelGroup', 'numericModel', 'veinSystem']);
const placed = (n: TreeNode) => PLACED.has(n.kind) || (n.kind === 'root' && (folderRootOf(n.key) !== null || n.key === 'root:numeric'));

export interface TreeMenuItem {
    action: TreeMenuAction;
    label: string;
    /** Items of one group sit together; a line parts the groups */
    group: 'new' | 'object' | 'open' | 'view' | 'file' | 'export' | 'delete' | 'about';
    /** Why it cannot be done (it is shown, greyed) */
    disabled?: string;
    /** A key that does the same, shown at the right */
    shortcut?: string;
}

export interface MenuContext {
    scene: ModelScene;
    db: Pick<DrillholeDb, 'tables'> | null;
    /** The model view the eyes act on (null: none is open) */
    view: { title: string; hidden: ReadonlySet<string> } | null;
    /** The surface being edited (null: none) */
    editing: string | null;
    /** The nodes picked have a place to frame (something in them is fitted, placed or read) */
    framed: boolean;
    /** Why a thing cannot be made now (null: it can; left out: everything can) */
    cannotMake?: (id: NewId) => string | null;
    /** The rows that are open (left out: not known, and closing is always offered) */
    open?: ReadonlySet<string>;
}

/**
 * The right-click menu for the nodes picked (the row clicked first). Each
 * item is there when it fits every node; those that fit but cannot be done
 * now say why.
 */
export function menuFor(nodes: readonly TreeNode[], ctx: MenuContext): TreeMenuItem[] {
    if (nodes.length === 0) return [];
    const out: TreeMenuItem[] = [];
    const one = nodes.length === 1 ? nodes[0] : null;
    const all = (test: (n: TreeNode) => boolean) => nodes.every(test);

    // A group of the tree: what can be made in it
    if (one?.kind === 'root') {
        for (const made of newIn(one.key.slice('root:'.length))) {
            const why = ctx.cannotMake?.(made.id) ?? null;
            out.push({ action: newActionOf(made.id), group: 'new', label: newMenuLabel(made), ...(why ? { disabled: why } : {}) });
        }
    }

    if (one?.link) out.push({ action: 'goTo', group: 'object', label: `Go to ${nameOfKey(ctx.scene, ctx.db, one.link.target)}`, ...(one.link.broken ? { disabled: 'It is no longer in the project.' } : {}) });
    if (one?.kind === 'surface' && !one.made) {
        out.push(ctx.editing === parseKey(one.key)?.id
            ? { action: 'edit', group: 'object', label: 'Stop editing' }
            : { action: 'edit', group: 'object', label: 'Edit', shortcut: 'Double-click' });
    }
    if (one && folderRootOf(one.key)) out.push({ action: 'newFolder', group: 'object', label: 'New folder' });
    if (one && renamable(one)) out.push({ action: 'rename', group: 'object', label: 'Rename', shortcut: 'F2' });

    // What is under them, opened or closed all the way down (where there is more than one level of it: one level is the row's own arrow)
    const under = openableUnder(nodes);
    if (nodes.some(n => n.children.some(c => c.children.length > 0))) {
        const it = one ? 'it' : 'them';
        out.push({ action: 'openAll', group: 'open', label: `Open everything under ${it}`, ...(one ? { shortcut: '*' } : {}) });
        if (under.some(k => ctx.open?.has(k) ?? true)) out.push({ action: 'closeAll', group: 'open', label: `Close everything under ${it}` });
    }

    // Frame them, and show and hide them, in the view the eyes act on
    if (nodes.some(placed)) {
        const why = !ctx.view ? 'Open a 3D view first.' : !ctx.framed ? 'Nothing in it has a place yet.' : null;
        out.push({ action: 'zoomTo', group: 'view', label: 'Zoom to', ...(why ? { disabled: why } : {}) });
    }
    const vis = [...new Set(nodes.flatMap(visKeysUnder))];
    if (vis.length > 0) {
        const where = ctx.view ? ` in ${ctx.view.title}` : '';
        const extra = ctx.view ? {} : { disabled: 'Open a 3D view to show and hide objects in it.' };
        const state = eyeOver(vis, ctx.view?.hidden ?? new Set());
        // (A contact or a fault of a model: its eye is for the part of it the model uses; its surface, under it, has its own)
        const what = all(n => isCut(n.kind)) ? (one ? ', as the model cuts it,' : ', as the model cuts them,') : '';
        if (state !== 'shown') out.push({ action: 'show', group: 'view', label: `Show${what}${where}`, ...extra });
        if (state !== 'hidden') out.push({ action: 'hide', group: 'view', label: `Hide${what}${where}`, ...extra });
        out.push({ action: 'showOnly', group: 'view', label: `Show only ${vis.length === 1 ? 'this' : 'these'}${what}${where}`, ...extra });
    }

    if (all(n => n.lockable === true)) {
        const locked = nodes.every(n => n.locked);
        out.push({ action: locked ? 'unlock' : 'lock', group: 'file', label: locked ? 'Unlock' : 'Lock' });
    }
    // Objects filed in a folder can be taken out of it
    if (all(n => n.kind !== 'folder' && n.kind !== 'link' && !!folderOf(ctx.scene, n.key) && !homed(ctx.scene, n.key))) out.push({ action: 'moveOut', group: 'file', label: 'Out of the folder' });

    // A surface's mesh, a model's contact as cut, a unit's solid; a model: every one of its solids
    if (all(n => n.kind === 'surface' || n.kind === 'modelContact' || n.kind === 'modelFault' || n.kind === 'volume' || n.kind === 'model')) {
        out.push({
            action: 'export', group: 'export',
            label: one?.kind === 'model' ? 'Export its solids' : one?.kind === 'volume' ? 'Export its solid' : one ? 'Export its mesh' : `Export ${nodes.length} meshes`,
        });
        if ((one?.kind === 'surface' && !one.made) || one?.kind === 'model') out.push({ action: 'kit', group: 'export', label: `${t('leapfrogExport')} (.zip)` });
    }

    if (all(n => DELETABLE.has(n.kind))) {
        const why = nodes.map(n => cannotDelete(n, ctx.scene)).find(r => r !== null) ?? null;
        const label = all(n => n.kind === 'folder') ? (one ? 'Remove the folder (what is in it stays)' : `Remove ${nodes.length} folders (what is in them stays)`)
            : one?.kind === 'table' ? 'Delete the table…'
                : one?.kind === 'modelContact' || one?.kind === 'modelFault' ? 'Take out of the model'
                    : nodes.length > 1 ? `Delete ${nodes.length} objects…` : 'Delete…';
        out.push({ action: 'delete', group: 'delete', label, shortcut: 'Del', ...(why ? { disabled: why } : {}) });
    }
    // What it is and how it is set: in the properties, which are brought into sight
    if (one && one.kind !== 'link') out.push({ action: 'properties', group: 'about', label: 'Properties' });
    return out;
}

/** A surface a model uses: it is kept in that model, not in the Surfaces group */
function homed(scene: ModelScene, key: string): boolean {
    const parsed = parseKey(key);
    return parsed?.kind === 'surface' && surfaceHome(scene, parsed.id) !== null;
}

/** The folder an object is filed in (null: none, or it is not filed in folders) */
function folderOf(scene: ModelScene, key: string): string | null {
    const parsed = parseKey(key);
    if (!parsed) return null;
    switch (parsed.kind) {
        case 'surface': return scene.surfaces.find(s => s.id === parsed.id)?.folder ?? null;
        case 'inputs': return scene.inputs?.find(s => s.id === parsed.id)?.folder ?? null;
        case 'readings': return scene.structure?.sets?.find(s => s.id === parsed.id)?.folder ?? null;
        case 'wireframe': return scene.wireframes.find(w => w.id === parsed.id)?.folder ?? null;
        default: return null;
    }
}

/** What dropping dragged nodes on a node does */
export type TreeDrop =
    /** Objects put in a folder (null: the top of the group), and folders moved into it */
    | { kind: 'file'; root: FolderRoot; path: string | null; objects: string[]; folders: { from: string; to: string }[]; label: string }
    /** A surface made to use sets of points or lines as well */
    | { kind: 'use'; surface: string; sets: string[]; label: string }
    /** Surfaces and meshes given to a model: as faults, or in its age order (`at`: before that place; left out: at the top, the youngest) */
    | { kind: 'toModel'; model: string; as: 'fault' | 'contact'; surfaces: string[]; meshes: string[]; at?: number; label: string }
    /** A contact moved to another place in its model's age order */
    | { kind: 'reorder'; model: string; contact: string; to: number; label: string };

/** What dropping on a part of a geological model does (null: nothing) */
function dropOnModel(scene: ModelScene, dragged: readonly string[], target: TreeNode): TreeDrop | null {
    const group = target.kind === 'modelGroup' ? parseModelGroup(target.key) : null;
    const part = target.kind === 'modelContact' || target.kind === 'modelFault' ? parseModelPart(target.key) : null;
    const modelId = group?.model ?? part?.model;
    const model = scene.models?.find(m => m.id === modelId);
    if (!model) return null;
    const as = group?.part === 'faults' || part?.kind === 'modelFault' ? 'fault' : group?.part === 'chronology' || part?.kind === 'modelContact' ? 'contact' : null;
    if (!as) return null;

    // A contact of this model dropped on another: it takes that one's place
    const moved = dragged.length === 1 ? parseModelPart(dragged[0]) : null;
    if (moved?.kind === 'modelContact') {
        if (moved.model !== model.id || part?.kind !== 'modelContact') return null;
        const from = model.contacts.findIndex(c => c.id === moved.part), to = model.contacts.findIndex(c => c.id === part.part);
        if (from < 0 || to < 0 || from === to) return null;
        return { kind: 'reorder', model: model.id, contact: moved.part, to, label: `${to < from ? 'Younger' : 'Older'} than ${target.name}` };
    }

    // Surfaces and meshes: given to the model, where it does not have them already
    const has = new Set(as === 'fault' ? (model.faults ?? []).map(f => f.surface ?? f.mesh) : model.contacts.map(c => c.surface ?? c.mesh));
    const surfaces: string[] = [], meshes: string[] = [];
    for (const key of dragged) {
        const parsed = parseKey(key);
        if (parsed?.kind === 'surface') {
            const s = scene.surfaces.find(x => x.id === parsed.id);
            // (A closed body has no two sides for a fault to part)
            if (!s || s.blockOf || (as === 'fault' && (s.rule.kind === 'body' || s.rule.kind === 'shell'))) return null;
            if (!has.has(s.id)) surfaces.push(s.id);
        } else if (parsed?.kind === 'wireframe') {
            if (!scene.wireframes.some(w => w.id === parsed.id)) return null;
            if (!has.has(parsed.id)) meshes.push(parsed.id);
        } else return null;
    }
    if (surfaces.length + meshes.length === 0) return null;
    const at = part?.kind === 'modelContact' ? model.contacts.findIndex(c => c.id === part.part) : -1;
    const where = as === 'fault' ? t('faultSystem') : t('chronology');
    return { kind: 'toModel', model: model.id, as, surfaces, meshes, ...(at >= 0 ? { at } : {}), label: `Into ${model.name}: ${where}${at >= 0 ? `, above ${target.name}` : ''}` };
}

/**
 * Why a drop of `dragged` on `target` is refused, where there is a reason
 * worth giving (null: it is taken, or the row is simply no place for it).
 * Only said where the drop could have been meant: a closed body on a model's
 * faults, what the model or the surface already has, a contact carried to
 * another model, a surface of a model carried to a folder.
 */
export function dropRefusal(scene: ModelScene, dragged: readonly string[], target: TreeNode): string | null {
    if (dragged.length === 0 || dragged.includes(target.key) || dropFor(scene, dragged, target)) return null;
    const surfaceOf = (key: string) => { const p = parseKey(key); return p?.kind === 'surface' ? scene.surfaces.find(s => s.id === p.id) ?? null : null; };

    if (target.kind === 'surface' && dragged.every(k => parseKey(k)?.kind === 'inputs')) return dragged.length === 1 ? 'It uses that set already' : 'It uses those sets already';

    if (target.kind === 'modelGroup' || target.kind === 'modelContact' || target.kind === 'modelFault') {
        const group = target.kind === 'modelGroup' ? parseModelGroup(target.key) : null;
        const part = target.kind !== 'modelGroup' ? parseModelPart(target.key) : null;
        const model = scene.models?.find(m => m.id === (group?.model ?? part?.model));
        const faults = group?.part === 'faults' || part?.kind === 'modelFault';
        const chronology = group?.part === 'chronology' || part?.kind === 'modelContact';
        if (!model || (!faults && !chronology)) return null;
        const moved = dragged.length === 1 ? parseModelPart(dragged[0]) : null;
        if (moved?.kind === 'modelContact') return moved.model !== model.id ? 'A contact stays in its own model' : null;
        if (!dragged.every(k => { const kind = parseKey(k)?.kind; return kind === 'surface' || kind === 'wireframe'; })) return null;
        const closed = dragged.map(surfaceOf).find(s => s && (s.rule.kind === 'body' || s.rule.kind === 'shell'));
        if (faults && closed) return `${closed.name} is closed: a fault has two sides`;
        return `${model.name} has ${dragged.length === 1 ? 'it' : 'them'} already`;
    }

    // A surface kept in a model, carried to a folder or a group of the tree
    const kept = dragged.map(k => { const s = surfaceOf(k); const home = s ? surfaceHome(scene, s.id) : null; return home ? scene.models?.find(m => m.id === home.model) ?? scene.numericModels?.find(m => m.id === home.model) ?? scene.veinSystems?.find(m => m.id === home.model) ?? null : null; }).find(m => m);
    if (kept && (target.kind === 'root' || parseFolderKey(target.key) || target.kind === 'surface')) return `It is kept in ${kept.name}`;
    return null;
}

/**
 * What dropping `dragged` (keys) on `target` does (null: nothing; the drop is
 * refused). Sets of points or lines dropped on a surface are used by it; any
 * object or folder dropped on a folder, a group, or an object of its own
 * group goes in that folder. Surfaces and meshes dropped on a model's faults
 * or its age order are given to the model, and a contact dropped on another
 * of its model takes its place. A surface kept in a model is not filed in
 * the folders of the Surfaces group, and nothing is filed beside it.
 */
export function dropFor(scene: ModelScene, dragged: readonly string[], target: TreeNode): TreeDrop | null {
    if (dragged.length === 0 || dragged.includes(target.key)) return null;

    // Sets onto a surface: it uses them too
    if (target.kind === 'surface' && dragged.every(k => parseKey(k)?.kind === 'inputs')) {
        const id = parseKey(target.key)!.id;
        const surface = scene.surfaces.find(s => s.id === id);
        if (!surface) return null;
        const used = new Set((surface.uses ?? []).map(u => u.set));
        const sets = dragged.map(k => parseKey(k)!.id).filter(s => !used.has(s) && scene.inputs?.some(x => x.id === s));
        if (sets.length === 0) return null;
        const name = sets.length === 1 ? scene.inputs!.find(x => x.id === sets[0])!.name : `${sets.length} sets`;
        return { kind: 'use', surface: id, sets, label: `${surface.name} uses ${name}` };
    }

    // Onto a part of a geological model
    if (target.kind === 'modelGroup' || target.kind === 'modelContact' || target.kind === 'modelFault') return dropOnModel(scene, dragged, target);
    // (A contact is moved only within its age order)
    if (dragged.some(k => parseKey(k)?.kind === 'modelContact')) return null;
    // A surface kept in a model has no folder to be filed in, or beside
    if (homed(scene, target.key) || dragged.some(k => homed(scene, k))) return null;

    // Into a folder: the folder dropped on, the group, or the folder of the object dropped on
    let root: FolderRoot | null, path: string | null;
    const folder = parseFolderKey(target.key);
    if (folder) ({ root, path } = folder);
    else if (target.kind === 'root') { root = folderRootOf(target.key); path = null; }
    else if (target.kind !== 'link') { root = rootOfKey(scene, target.key); path = folderOf(scene, target.key); }
    else return null;
    if (!root) return null;

    const objects: string[] = [];
    const folders: { from: string; to: string }[] = [];
    // Folders being moved: what is in them goes with them
    const carried = dragged.map(parseFolderKey).filter((f): f is { root: FolderRoot; path: string } => f !== null && f.root === root).map(f => f.path);
    for (const k of dragged) {
        const f = parseFolderKey(k);
        if (f) {
            if (f.root !== root) return null;
            // Not into itself or a folder inside it
            if (path !== null && isWithin(path, f.path)) return null;
            if (parentFolder(f.path) === path) continue;
            const to = path ? `${path}/${folderName(f.path)}` : folderName(f.path);
            // Inside a folder that is also being moved: it goes with that one
            if (carried.some(c => c !== f.path && isWithin(f.path, c))) continue;
            folders.push({ from: f.path, to });
            continue;
        }
        if (rootOfKey(scene, k) !== root) return null;
        const at = folderOf(scene, k);
        if (at !== path && !(at && carried.some(c => isWithin(at, c)))) objects.push(k);
    }
    if (objects.length === 0 && folders.length === 0) return null;
    const group = ROOTS.find(r => r.folders === root)?.title ?? root;
    return { kind: 'file', root, path, objects, folders, label: path ? `Into ${folderName(path)}` : `To the top of ${group}` };
}

/** A key after a folder of a group was renamed or moved from `from` to `to` (the same key when it was not in it) */
export function movedKey(key: string, root: FolderRoot, from: string, to: string): string {
    const f = parseFolderKey(key);
    if (!f || f.root !== root || !isWithin(f.path, from)) return key;
    return `folder:${root}/${to}${f.path.slice(from.length)}`;
}

/** A name for a new folder in a group, in `parent` (null: at the top), not taken there */
export function newFolderPath(scene: ModelScene, root: FolderRoot, parent: string | null): string {
    const taken = new Set(foldersOf(scene, root));
    const at = (name: string) => (parent ? `${parent}/${name}` : name);
    let name = 'New folder';
    for (let k = 2; taken.has(at(name)); k++) name = `New folder ${k}`;
    return at(name);
}

/** How a dependent depends on what it points at, in words */
const HOW: Record<LinkKind, string> = {
    uses: 'uses',
    owns: 'was made for',
    units: 'takes its units from',
    logging: 'is built from the logging of',
    values: 'is put round the values of',
    table: 'reads',
    follows: 'follows',
    writes: 'is written from',
    drawnOn: 'has lines drawn on',
    contact: 'has in its chronology',
    fault: 'is cut by the fault',
    boundary: 'stops at',
    endsOn: 'ends on',
    alongside: 'is conformable to',
    inside: 'is inside a unit of',
    domain: 'is kept inside a unit of',
};

/** What happens to a dependent when what it points at goes */
const THEN: Record<LinkKind, string> = {
    uses: 'it is fitted without it',
    owns: 'it goes too, unless another surface uses it',
    units: 'it goes back to the logged codes',
    logging: 'it is shown as missing what it is built from',
    values: 'it is shown as missing its column',
    table: 'it is shown as missing its table',
    follows: 'it no longer follows it',
    writes: 'the column stays as it is',
    drawnOn: 'the lines stay where they are',
    contact: 'the model is built without that contact',
    fault: 'the model is built without that fault',
    boundary: 'the model runs to the top of its box',
    endsOn: 'it ends on nothing, and carries on as far as its holes take it',
    alongside: 'it is fitted on its own, through its own places',
    inside: 'it is built as if inside nothing, to its own box',
    domain: 'it goes wherever its samples take it',
};

export interface DeleteSummary {
    /** What is deleted, by name */
    names: string[];
    /** The objects that depend on them directly, each "Name uses Other: what happens to it" */
    dependents: string[];
    undoable: boolean;
}

/**
 * What deleting these objects would do, in words for the dialog that asks.
 * Only what depends on them directly is listed: a surface fitted again
 * without a set is still there for what depends on it.
 */
export function deleteSummary(scene: ModelScene, db: Pick<DrillholeDb, 'tables'> | null, links: readonly SceneLink[], deleting: readonly string[]): DeleteSummary {
    const gone = new Set(deleting);
    const name = (key: string) => {
        const f = parseFolderKey(key);
        if (key.startsWith('modelFault:')) return `${nameOfKey(scene, db, key)} from its model's faults (the surface itself stays)`;
        if (key.startsWith('modelContact:')) return `${nameOfKey(scene, db, key)} from its model's chronology (the surface itself stays)`;
        return f ? `the folder ${folderName(f.path)}` : key.startsWith('column:') ? `the column ${key.slice('column:'.length)}` : nameOfKey(scene, db, key);
    };
    const seen = new Set<string>();
    const dependents: string[] = [];
    for (const l of links) {
        if (!gone.has(l.to) || gone.has(l.from) || seen.has(`${l.from}>${l.to}`)) continue;
        seen.add(`${l.from}>${l.to}`);
        dependents.push(`${name(l.from)} ${HOW[l.kind]} ${name(l.to)}: ${THEN[l.kind]}`);
    }
    // A model inside a unit of one that goes is built to its own box: what is inside its units, in turn, has other ground
    const moved = new Set(links.filter(l => l.kind === 'inside' && gone.has(l.to) && !gone.has(l.from)).map(l => l.from));
    for (const l of links) {
        if (!moved.has(l.to) || gone.has(l.from) || (l.kind !== 'inside' && l.kind !== 'domain') || seen.has(`${l.from}>${l.to}`)) continue;
        seen.add(`${l.from}>${l.to}`);
        dependents.push(`${name(l.from)} ${HOW[l.kind]} ${name(l.to)}: it changes with it`);
    }
    return { names: deleting.map(name), dependents, undoable: deleteImpact(links, deleting).undoable };
}
