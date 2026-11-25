/**
 * Deleting objects of the project, from anywhere: the project tree, an
 * object's properties, a dialog. Every delete button asks through
 * `requestDelete`, so each is checked by the same rules (treeRules
 * `cannotDeleteKey`: a locked object is kept) and confirmed by the same
 * dialog, which names what depends on the objects
 * (features/modelling/tree/DeleteObjectsDialog, mounted once for the app).
 */
import { useDrillholeStore } from '../../store/drillholeStore';
import { useModelStore } from '../../store/modelStore';
import { useModellingStore } from '../../store/modellingStore';
import { useDeleteRequest } from './modelDialogs';
import { surfacesOnlyOf } from './modelHome';
import { keys as keyOf, parseFolderKey, parseKey, parseModelPart, type FolderRoot } from './objectKeys';
import { cannotDeleteKey } from './treeRules';

export { useDeleteRequest };

/**
 * Delete objects and remove folders (what is in a folder removed stays, one
 * folder up). Folders inside one another are taken deepest first, so each
 * path is still right when it is reached. Nothing is asked: `requestDelete`
 * is what a button calls.
 */
export function deleteObjects(objectKeys: readonly string[]): void {
    const model = useModelStore.getState();
    const wireframes: string[] = [];
    const folders: { root: FolderRoot; path: string }[] = [];
    for (const key of objectKeys) {
        const folder = parseFolderKey(key);
        if (folder) { folders.push(folder); continue; }
        const parsed = parseKey(key);
        if (!parsed) continue;
        switch (parsed.kind) {
            case 'surface': model.removeSurface(parsed.id); break;
            case 'inputs': model.removeInputSet(parsed.id); break;
            case 'readings': model.removeReadingSet(parsed.id); break;
            case 'wireframe': wireframes.push(parsed.id); break;
            case 'unitMap': model.removeUnitMap(parsed.id); break;
            case 'sectionSet': model.removeSectionSet(parsed.id); break;
            case 'model': model.removeModel(parsed.id); break;
            case 'numericModel': model.removeNumericModel(parsed.id); break;
            case 'veinSystem': model.removeVeinSystem(parsed.id); break;
            case 'modelContact': { const part = parseModelPart(key); if (part) model.removeModelContact(part.model, part.part); break; }
            case 'modelFault': { const part = parseModelPart(key); if (part) model.removeModelFault(part.model, part.part); break; }
            case 'table': useDrillholeStore.getState().removeTable(parsed.id); break;
            default: break;
        }
    }
    if (wireframes.length) model.removeWireframes(wireframes);
    folders.sort((a, b) => b.path.split('/').length - a.path.split('/').length);
    for (const f of folders) model.removeFolder(f.root, f.path);
}

/** The tree no longer has the objects picked that are gone */
function unpick(gone: readonly string[]): void {
    const tree = useModellingStore.getState();
    if (tree.selected.some(k => gone.includes(k))) tree.setSelected(tree.selected.filter(k => !gone.includes(k)));
}

/**
 * Ask to delete objects (by key). Returns why it cannot be done (a locked
 * object, a table something is built from), or null: the dialog is then up
 * and the objects go when it is confirmed. Removing folders alone takes
 * nothing with it, and is done without asking. `then` is called once the
 * objects are deleted.
 */
export function requestDelete(objectKeys: readonly string[], then?: () => void): string | null {
    const scene = useModelStore.getState().scene;
    // A numeric model goes with its shells (they are its parts); a locked shell stays, a shell of its own
    const shells = objectKeys.flatMap(k => { const p = parseKey(k); return p?.kind === 'numericModel' ? scene.numericModels?.find(m => m.id === p.id)?.shells ?? [] : []; })
        .filter(s => !scene.surfaces.find(x => x.id === s.surface)?.locked).map(s => keyOf.surface(s.surface));
    // ... and a vein system with its veins
    const veins = objectKeys.flatMap(k => { const p = parseKey(k); return p?.kind === 'veinSystem' ? scene.veinSystems?.find(v => v.id === p.id)?.veins ?? [] : []; })
        .filter(v => !scene.surfaces.find(x => x.id === v)?.locked).map(v => keyOf.surface(v));
    const targets = [...new Set([...objectKeys, ...shells, ...veins])];
    if (targets.length === 0) return 'Nothing to delete.';
    const db = useDrillholeStore.getState().db;
    for (const key of targets) {
        const why = cannotDeleteKey(scene, db, key);
        if (why) return why;
    }
    if (targets.every(k => parseFolderKey(k) !== null)) {
        deleteObjects(targets);
        unpick(targets);
        then?.();
        return null;
    }
    // A model's own surfaces are kept in it in the tree: they go with it, unless that is not wanted (or one is locked)
    const models = targets.map(k => parseKey(k)).filter(p => p?.kind === 'model').map(p => p!.id);
    const also = surfacesOnlyOf(scene, models).filter(id => !scene.surfaces.find(s => s.id === id)?.locked).map(keyOf.surface).filter(k => !targets.includes(k));
    useDeleteRequest.setState({ keys: targets, then: then ?? null, also, withAlso: also.length > 0 });
    return null;
}

/** Whether the surfaces only the models being deleted use go with them */
export function setDeleteAlso(on: boolean): void {
    useDeleteRequest.setState({ withAlso: on });
}

/** The delete asked about is to go ahead */
export function confirmDelete(): void {
    const { keys: asked, then, also, withAlso } = useDeleteRequest.getState();
    const keys = asked && withAlso ? [...asked, ...also] : asked;
    useDeleteRequest.setState({ keys: null, then: null, also: [], withAlso: false });
    if (!keys) return;
    deleteObjects(keys);
    unpick(keys);
    then?.();
}

/** The delete asked about is not wanted */
export function cancelDelete(): void {
    useDeleteRequest.setState({ keys: null, then: null, also: [], withAlso: false });
}
