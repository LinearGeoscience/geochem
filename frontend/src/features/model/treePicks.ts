/**
 * Picks shared between the project tree and the views of the model: what is
 * picked in the tree is drawn lit in every view (sceneLayers `picked`), and
 * an object clicked in a view is picked in the tree.
 */
import { useAppStore } from '../../store/appStore';
import { useDrillholeStore } from '../../store/drillholeStore';
import { useModelStore } from '../../store/modelStore';
import { useModellingStore } from '../../store/modellingStore';
import { keys, parseModelPart } from './objectKeys';
import { buildProjectTree, nameOfKey } from './projectTree';
import { ancestorsOf } from './treeRules';

/**
 * Layers of a view that stand for an object of the tree, and so can be
 * clicked to pick it: surfaces, meshes, measurements, and a geological
 * model's solids, contacts and faults as it cuts them.
 */
export const PICKABLE_LAYER = /^(surface|wireframe|readings|volume|modelContact|modelFault):|^structure$/;

/** Of those, the closed solids of a model (where two share a face, the one in front of it is the one clicked) */
export const SOLID_LAYER = (id: string): boolean => id.startsWith('volume:');

/** What an object under the pointer is called, with what it is part of (null: the project has none such) */
export function nameUnderPointer(key: string): string | null {
    const scene = useModelStore.getState().scene, db = useDrillholeStore.getState().db;
    if (key === 'structure') return 'The global trend';
    const part = parseModelPart(key);
    if (!part) return /^(surface|wireframe|readings):/.test(key) ? nameOfKey(scene, db, key) : null;
    const model = scene.models?.find(g => g.id === part.model);
    if (!model) return null;
    const what = part.kind === 'volume' ? 'a lithology' : part.kind === 'modelFault' ? 'a fault' : 'a contact';
    return `${nameOfKey(scene, db, key)} · ${what} of ${model.name}`;
}

/**
 * An object clicked in a view of the model, picked in the tree: its folders
 * opened and its row brought into sight. `add` (Ctrl): added to the picks, or
 * taken out when it was in them. False: the tree has no such object.
 */
export function pickFromView(key: string, add = false): boolean {
    const tree = useModellingStore.getState();
    const nodes = buildProjectTree(useModelStore.getState().scene, useDrillholeStore.getState().db);
    const up = ancestorsOf(nodes, key);
    if (!up) return false;
    const open = new Set(tree.expanded);
    if (up.some(k => !open.has(k))) tree.setExpanded([...open, ...up.filter(k => !open.has(k))]);
    if (!add) tree.setSelected([key]);
    else tree.setSelected(tree.selected.includes(key) ? tree.selected.filter(k => k !== key) : [...tree.selected, key]);
    tree.revealKey(key);
    return true;
}

/** The Modelling page, with an object picked in its tree (its folders opened, its properties shown) */
export function openInModelling(key: string | null = null): void {
    useAppStore.getState().setCurrentView('modelling');
    if (key) pickFromView(key);
}

/**
 * An interval of a logging table clicked in a view: its table picked in the
 * tree, and the interval (by row) shown in the properties and marked in the
 * views. False: the tree has no such table.
 */
export function pickLogged(table: string, row: number): boolean {
    const ok = pickFromView(keys.table(table));
    useModellingStore.getState().setLoggedPick(ok ? { table, row } : null);
    return ok;
}
