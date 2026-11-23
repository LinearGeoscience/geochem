/**
 * Folders of the project tree (pure). A folder is a path, "Faults/North" for
 * the folder North in the folder Faults, and belongs to one group of the tree:
 * points, lines, surfaces, readings or meshes. An object is in a folder when
 * its `folder` is that path. Folders are also kept in `scene.folders`, so one
 * stays after it is emptied, until it is removed.
 *
 * Every change here gives a new scene (the same scene when nothing changed),
 * so in the store each is one undo step.
 */
import { keys, type FolderRoot } from './objectKeys';
import type { InputSet, ModelScene, ReadingSet, SceneFolders, SurfaceObject, WireframeObject } from './types';

/** A folder is at most this many deep, its names at most this long, and a group keeps at most this many */
export const MAX_FOLDER_DEPTH = 8;
export const MAX_FOLDER_NAME = 80;
export const MAX_FOLDERS = 200;

/** A folder path cleaned: names trimmed, empty ones dropped (" a / /b " is "a/b"). Null: no folder. */
export function normalizeFolder(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const parts = raw.split('/').map(p => p.trim().slice(0, MAX_FOLDER_NAME)).filter(p => p !== '').slice(0, MAX_FOLDER_DEPTH);
    return parts.length ? parts.join('/') : null;
}

/** The folder a folder is in (null: it is at the top of its group) */
export function parentFolder(path: string): string | null {
    const at = path.lastIndexOf('/');
    return at > 0 ? path.slice(0, at) : null;
}

/** A folder's own name: the last part of its path */
export const folderName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** Is `path` the folder `top`, or inside it? */
export const isWithin = (path: string, top: string): boolean => path === top || path.startsWith(`${top}/`);

/** The objects of a group, each with its key */
export function groupObjects(scene: ModelScene, root: FolderRoot): { key: string; folder: string | null }[] {
    const of = (o: { folder?: string | null }) => o.folder ?? null;
    switch (root) {
        case 'points': return (scene.inputs ?? []).filter(s => s.kind === 'points').map(s => ({ key: keys.inputs(s.id), folder: of(s) }));
        case 'lines': return (scene.inputs ?? []).filter(s => s.kind === 'lines').map(s => ({ key: keys.inputs(s.id), folder: of(s) }));
        case 'surfaces': return scene.surfaces.map(s => ({ key: keys.surface(s.id), folder: of(s) }));
        case 'readings': return (scene.structure?.sets ?? []).map(s => ({ key: keys.readings(s.id), folder: of(s) }));
        case 'meshes': return scene.wireframes.map(w => ({ key: keys.wireframe(w.id), folder: of(w) }));
    }
}

/** Every folder of a group: those kept, those objects are in, and the folders they are in, sorted */
export function foldersOf(scene: ModelScene, root: FolderRoot): string[] {
    const out = new Set<string>();
    const add = (path: string | null) => {
        for (let p = path; p; p = parentFolder(p)) out.add(p);
    };
    for (const f of scene.folders?.[root] ?? []) add(f);
    for (const o of groupObjects(scene, root)) add(o.folder);
    return [...out].sort((a, b) => a.localeCompare(b));
}

/** The group an object's key belongs to (null: an object that is not filed in folders) */
export function rootOfKey(scene: ModelScene, key: string): FolderRoot | null {
    for (const root of ['points', 'lines', 'surfaces', 'readings', 'meshes'] as FolderRoot[]) {
        if (groupObjects(scene, root).some(o => o.key === key)) return root;
    }
    return null;
}

/** An object with its folder set (absent rather than null where the field is optional, so scenes read back as they were) */
function filed<T extends { folder?: string | null }>(o: T, path: string | null, required: boolean): T {
    if ((o.folder ?? null) === path) return o;
    if (path !== null || required) return { ...o, folder: path };
    const { folder: _folder, ...rest } = o;
    return rest as T;
}

/** The scene with each object's folder changed by `to` (null for no change) and the kept folders given */
function refile(scene: ModelScene, root: FolderRoot, to: (key: string, folder: string | null) => string | null | undefined, kept: string[] | null): ModelScene {
    const change = <T extends { folder?: string | null }>(o: T, key: string, required: boolean): T => {
        const next = to(key, o.folder ?? null);
        return next === undefined ? o : filed(o, next, required);
    };
    let next = scene;
    if (root === 'points' || root === 'lines') {
        const kind = root === 'points' ? 'points' : 'lines';
        const had = scene.inputs ?? [];
        const inputs = had.map(s => (s.kind === kind ? change<InputSet>(s, keys.inputs(s.id), true) : s));
        if (inputs.some((s, i) => s !== had[i])) next = { ...next, inputs };
    } else if (root === 'surfaces') {
        const surfaces = scene.surfaces.map(s => change<SurfaceObject>(s, keys.surface(s.id), false));
        if (surfaces.some((s, i) => s !== scene.surfaces[i])) next = { ...next, surfaces };
    } else if (root === 'readings') {
        const had = scene.structure?.sets ?? [];
        const sets = had.map(s => change<ReadingSet>(s, keys.readings(s.id), false));
        if (sets.some((s, i) => s !== had[i])) next = { ...next, structure: { ...scene.structure, overall: scene.structure?.overall ?? null, sets } };
    } else {
        const wireframes = scene.wireframes.map(w => change<WireframeObject>(w, keys.wireframe(w.id), false));
        if (wireframes.some((w, i) => w !== scene.wireframes[i])) next = { ...next, wireframes };
    }
    if (kept) {
        const was = scene.folders?.[root] ?? [];
        const now = [...new Set(kept)].sort((a, b) => a.localeCompare(b)).slice(0, MAX_FOLDERS);
        if (now.length !== was.length || now.some((f, i) => f !== was[i])) {
            const folders: SceneFolders = { ...scene.folders, [root]: now };
            if (now.length === 0) delete folders[root];
            next = { ...next, folders };
        }
    }
    return next;
}

/**
 * Objects put in a folder (null: at the top of their group). Each stays in
 * its own group; a folder an object leaves is kept, so it does not vanish
 * when emptied.
 */
export function moveToFolder(scene: ModelScene, objectKeys: readonly string[], path: string | null): ModelScene {
    const target = path === null ? null : normalizeFolder(path);
    if (path !== null && target === null) return scene;
    const moving = new Set(objectKeys);
    let next = scene;
    for (const root of ['points', 'lines', 'surfaces', 'readings', 'meshes'] as FolderRoot[]) {
        const objects = groupObjects(next, root).filter(o => moving.has(o.key));
        if (objects.length === 0) continue;
        const left = objects.map(o => o.folder).filter((f): f is string => f !== null && f !== target);
        const kept = [...(next.folders?.[root] ?? []), ...left];
        next = refile(next, root, (key, folder) => (moving.has(key) && folder !== target ? target : undefined), kept);
    }
    return next;
}

/** A new, empty folder in a group (the scene as it was when the path is blank or the folder is there already) */
export function addFolder(scene: ModelScene, root: FolderRoot, path: string): ModelScene {
    const p = normalizeFolder(path);
    if (!p || foldersOf(scene, root).includes(p)) return scene;
    return refile(scene, root, () => undefined, [...(scene.folders?.[root] ?? []), p]);
}

/**
 * A folder renamed or moved (`to` is its whole new path): the objects and
 * folders in it go with it. Not into itself.
 */
export function renameFolder(scene: ModelScene, root: FolderRoot, from: string, to: string): ModelScene {
    const a = normalizeFolder(from), b = normalizeFolder(to);
    if (!a || !b || a === b || isWithin(b, a)) return scene;
    const map = (p: string | null): string | null | undefined => (p !== null && isWithin(p, a) ? `${b}${p.slice(a.length)}` : undefined);
    const kept = (scene.folders?.[root] ?? []).map(f => map(f) ?? f);
    // The folder itself is kept under its new name even when nothing is in it
    return refile(scene, root, (_key, folder) => map(folder), [...kept, b]);
}

/** A folder removed: what is in it, objects and folders, goes up into the folder it was in */
export function removeFolder(scene: ModelScene, root: FolderRoot, path: string): ModelScene {
    const p = normalizeFolder(path);
    if (!p) return scene;
    const up = parentFolder(p);
    const map = (f: string | null): string | null | undefined => {
        if (f === null || !isWithin(f, p)) return undefined;
        if (f === p) return up;
        const rest = f.slice(p.length + 1);
        return up ? `${up}/${rest}` : rest;
    };
    const kept = (scene.folders?.[root] ?? []).flatMap(f => {
        const m = map(f);
        return m === undefined ? [f] : m === null ? [] : [m];
    });
    return refile(scene, root, (_key, folder) => map(folder), kept);
}

/** Kept folders as saved, checked */
export function readFolders(raw: unknown): SceneFolders | null {
    if (!raw || typeof raw !== 'object') return null;
    const out: SceneFolders = {};
    for (const root of ['points', 'lines', 'surfaces', 'readings', 'meshes'] as FolderRoot[]) {
        const list = (raw as Record<string, unknown>)[root];
        if (!Array.isArray(list)) continue;
        const paths = [...new Set(list.map(normalizeFolder).filter((f): f is string => f !== null))].sort((a, b) => a.localeCompare(b)).slice(0, MAX_FOLDERS);
        if (paths.length) out[root] = paths;
    }
    return Object.keys(out).length ? out : null;
}
