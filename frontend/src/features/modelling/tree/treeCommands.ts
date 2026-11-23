/**
 * The project tree's changes to the project: rename, delete, lock, file in
 * folders and drops (the rules of what may be done are features/model/
 * treeRules). Each is one undo step, except deleting a logging table, which
 * is kept outside the undo history.
 */
import { useModelStore } from '../../../store/modelStore';
import { moveContact } from '../../model/geoModelActions';
import { useModellingStore } from '../../../store/modellingStore';
import { useProjectStore } from '../../../store/projectStore';
import { parentFolder } from '../../model/folders';
import { guessContact } from '../../model/geoModel';
import { keys, parseFolderKey, parseKey } from '../../model/objectKeys';
import { movedKey, type TreeDrop } from '../../model/treeRules';

/** A name as typed, made fit for its kind (a folder's has no slash: that would make two folders). Null: nothing typed. */
export function cleanName(kind: string, raw: string): string | null {
    const name = (kind === 'folder' ? raw.replace(/\//g, '-') : raw).trim();
    return name === '' ? null : name.slice(0, 120);
}

/**
 * Rename an object or a folder. Returns the key it then has (a folder's key
 * is its path, so it changes; null: nothing was renamed).
 */
export function renameObject(key: string, raw: string): string | null {
    const model = useModelStore.getState();
    const folder = parseFolderKey(key);
    const parsed = parseKey(key);
    if (!parsed) return null;
    const name = cleanName(parsed.kind, raw);
    if (!name) return null;
    if (folder) {
        const parent = parentFolder(folder.path);
        const to = parent ? `${parent}/${name}` : name;
        if (to === folder.path) return null;
        model.renameFolder(folder.root, folder.path, to);
        return keys.folder(folder.root, to);
    }
    switch (parsed.kind) {
        case 'surface': model.updateSurface(parsed.id, { name }); break;
        case 'inputs': model.updateInputSet(parsed.id, { name }); break;
        case 'readings': model.updateReadingSet(parsed.id, { name }); break;
        case 'wireframe': model.updateWireframe(parsed.id, { name }); break;
        case 'unitMap': model.updateUnitMap(parsed.id, { name }); break;
        case 'sectionSet': model.updateSectionSet(parsed.id, { name }); break;
        case 'model': model.updateModel(parsed.id, { name }); break;
        case 'numericModel': model.updateNumericModel(parsed.id, { name }); break;
        case 'veinSystem': model.updateVeinSystem(parsed.id, { name }); break;
        default: return null;
    }
    return key;
}

/**
 * Rename, and keep the tree's open nodes and picks on a folder whose key
 * changed with its name. Returns the key it then has (null: not renamed).
 */
export function renameKeepingPicks(key: string, raw: string): string | null {
    const next = renameObject(key, raw);
    const f = parseFolderKey(key);
    if (next && next !== key && f) {
        const to = parseFolderKey(next)!.path;
        const move = (k: string) => movedKey(k, f.root, f.path, to);
        const tree = useModellingStore.getState();
        tree.setExpanded(tree.expanded.map(move));
        tree.setSelected(tree.selected.map(move));
    }
    return next;
}

// Deleting is asked for and done in one place for the whole app (features/model/deleteObjects)
export { deleteObjects, requestDelete } from '../../model/deleteObjects';

/** Lock or unlock sets of points or lines (they are not changed) and surfaces (they are not fitted again) */
export function setLocked(objectKeys: readonly string[], locked: boolean): void {
    const model = useModelStore.getState();
    for (const key of objectKeys) {
        const parsed = parseKey(key);
        if (parsed?.kind === 'inputs') model.updateInputSet(parsed.id, { locked });
        else if (parsed?.kind === 'surface') model.updateSurface(parsed.id, { locked: locked || undefined });
    }
}

/** Carry out a drop. Returns the key of the folder things went into (null: none, or the top of a group). */
export function applyDrop(drop: TreeDrop): string | null {
    const model = useModelStore.getState();
    if (drop.kind === 'use') {
        for (const set of drop.sets) model.setSurfaceUse(drop.surface, set, true);
        return null;
    }
    if (drop.kind === 'reorder') {
        moveContact(drop.model, drop.contact, drop.to);
        return null;
    }
    if (drop.kind === 'toModel') {
        if (drop.as === 'fault') {
            for (const surface of drop.surfaces) model.addModelFault(drop.model, { surface });
            for (const mesh of drop.meshes) model.addModelFault(drop.model, { mesh });
            return null;
        }
        // Each with a first guess of its type, its young side and its unit, as when it is added in the model's editor;
        // the last dragged goes in first, so that they stay in the order they were dragged in
        const at = drop.at ?? 0;
        for (const mesh of [...drop.meshes].reverse()) model.addModelContact(drop.model, { mesh, kind: 'deposit', young: 1, unit: '' }, at);
        for (const id of [...drop.surfaces].reverse()) {
            const scene = useModelStore.getState().scene;
            const g = scene.models?.find(m => m.id === drop.model), surface = scene.surfaces.find(x => x.id === id);
            const order = scene.unitMaps?.find(m => m.id === g?.unitMap)?.units.map(u => u.name) ?? [];
            if (g && surface) model.addModelContact(drop.model, { surface: id, ...guessContact(g, surface, order) }, at);
        }
        return null;
    }
    if (drop.objects.length) model.moveToFolder(drop.objects, drop.path);
    for (const f of drop.folders) model.renameFolder(drop.root, f.from, f.to);
    return drop.path ? keys.folder(drop.root, drop.path) : null;
}

/** The models the tree has shown, by project */
const shownModels = new Set<string>();

/**
 * Of these models (by id), the ones the tree has not shown before; they are
 * then taken as shown. A model just made, or one that came with a project
 * just opened, is shown open the first time; after that it is left open or
 * shut as it is put.
 */
export function modelsNotShownYet(ids: readonly string[]): string[] {
    const project = useProjectStore.getState().projectPath ?? '';
    const fresh = ids.filter(id => !shownModels.has(`${project}\n${id}`));
    for (const id of fresh) shownModels.add(`${project}\n${id}`);
    return fresh;
}

/** (For tests: as if no model had been shown yet) */
export const _forgetShownModels = (): void => shownModels.clear();
