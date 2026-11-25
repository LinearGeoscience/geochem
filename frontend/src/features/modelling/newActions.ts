/**
 * What making each thing of features/model/newObjects does, and why it
 * cannot be made now. One path for the group's buttons in the properties,
 * the tree's right-click menu and the page's New menu.
 *
 * Nothing waits for a 3D view: with none open a thing is made in the
 * model's own columns (`coordsFor`). A view that is open is asked to do it
 * where it knows more (which way it looks, where its slice is), and only
 * what is placed by clicking opens one.
 */
import { create } from 'zustand';
import { useAppStore } from '../../store/appStore';
import { useModelStore } from '../../store/modelStore';
import { useModellingStore } from '../../store/modellingStore';
import { loggingProblem } from '../model/logging';
import { sceneDataBox } from '../model/modelCache';
import { openModelDialog } from '../model/modelDialogs';
import { newObject, type NewGroup, type NewId } from '../model/newObjects';
import { keys } from '../model/objectKeys';
import { groundFromCollars, presetSectionSet, startSurface, surfaceFromSelection } from '../model/sceneActions';
import type { ViewNote } from '../model/viewRegistry';
import { addTopographyFile, topoNote } from '../model/topoImport';
import { loadWireframeFiles, pickTopographyFile, pickWireframeFiles } from '../plots/viewer3d/wireframeLoad';
import { MODEL_PANEL_IDS, newModelView, showModelPane } from './modellingApi';
import { coordsFor, type TargetView } from './targetView';

export const NO_COLUMNS = 'Surfaces need East, North and Elevation columns.';
export const NO_SELECTION = 'Select the samples the surface should run through first (lasso or box select in the view).';

export type MadeNote = { severity: 'info' | 'warning' | 'error'; text: string } | null;

/** What was said of the last thing made from a menu (the page shows it; the properties show their own) */
export const useMadeNote = create<{ note: MadeNote }>(() => ({ note: null }));

export const sayMade = (note: MadeNote): void => useMadeNote.setState({ note });

/** The view, when it is drawn and can be asked to do things */
const drawn = (target: TargetView) => (target.status?.ready ? target.status : null);

/** How many samples are picked in the data */
export const pickedSamples = (target: TargetView): number => drawn(target)?.selectedCount ?? useAppStore.getState().selectedIndices.length;

const SECTIONS = { sectionsFromSlice: 'slice', sectionsWE: 'we', sectionsSN: 'sn', sectionsLevel: 'level' } as const;
const isSections = (id: NewId): id is keyof typeof SECTIONS => id in SECTIONS;

/** Why it cannot be made now (null: it can) */
export function cannotMake(id: NewId, target: TargetView): string | null {
    const view = drawn(target);
    const coords = coordsFor(target);
    // (A view that shows other columns than the model is in says so itself)
    const blocked = view ? view.blocked : coords ? null : NO_COLUMNS;
    switch (newObject(id).needs) {
        case 'nothing': return null;
        // (Sections are cut through whatever a view shows)
        case 'columns': return view && isSections(id) ? null : blocked;
        case 'placing': return blocked;
        case 'logging': return blocked ?? (view ? view.contactBlocked : loggingProblem(coords));
        case 'selection': return blocked ?? (pickedSamples(target) < 2 ? NO_SELECTION : null);
        case 'slice': return !view ? 'Turn on a slice in a 3D view first.' : view.canSlice ? null : 'Turn on a slice in the view first.';
    }
}

/** What `cannotMake` reads besides the view: a component that shows it is drawn again when any of it changes */
export function useMakeInputs(): void {
    useAppStore(s => s.columns);
    useAppStore(s => s.selectedIndices.length);
    useModelStore(s => s.scene.coords);
}

/** Pick it in the tree, with its group open */
function reveal(group: NewGroup, key: string): void {
    const tree = useModellingStore.getState();
    tree.setExpanded([...new Set([...tree.expanded, keys.root(group)])]);
    tree.setSelected([key]);
}

/**
 * Make it. What comes back is what there is to say of it (null: nothing);
 * what cannot be made now is not (`cannotMake` says why).
 */
export function makeNew(id: NewId, target: TargetView): ViewNote {
    if (cannotMake(id, target)) return null;
    const act = drawn(target) ? target.actions() : null;
    const coords = coordsFor(target);
    const model = useModelStore.getState();
    switch (id) {
        case 'table': openModelDialog('tables', null); return null;
        case 'units': openModelDialog('units', coords, 'new'); return null;
        case 'readings': openModelDialog('readings', coords); return null;
        case 'contact': case 'body': case 'vein': case 'shell': openModelDialog(id, coords); return null;
        case 'points': case 'lines': reveal(id, keys.inputs(model.addInputSet(id))); return null;
        case 'surface':
            if (act) { act.newSurface(); return null; }
            // Its points are placed by clicking: a view is opened for that when none is
            if (coords && startSurface(coords) && !target.id) newModelView('3d');
            return null;
        case 'surfaceFromSelection': return act ? act.surfaceFromSelection() : coords ? surfaceFromSelection(coords) : null;
        case 'ground': return act ? act.groundFromCollars() : coords ? groundFromCollars(coords) : null;
        case 'model': openModelDialog('model', coords); return null;
        case 'numericModel': openModelDialog('numeric', coords); return null;
        case 'proportion': openModelDialog('proportion', coords); return null;
        case 'sectionsFromSlice': act?.newSectionSet('slice'); return null;
        case 'sectionsWE': case 'sectionsSN': case 'sectionsLevel': {
            const kind = SECTIONS[id];
            if (act) { act.newSectionSet(kind); return null; }
            const made = coords ? presetSectionSet(kind, coords) : null;
            if (!made) return { severity: 'warning', text: 'The set could not be made: the data has no place in these columns, or there are as many sets as can be.' };
            reveal('sections', keys.sectionSet(made));
            return null;
        }
        case 'meshes':
            void pickWireframeFiles()
                .then(files => loadWireframeFiles(files, act?.dataBounds() ?? sceneDataBox()))
                .then(notes => {
                    if (notes.length > 0) sayMade({ severity: notes.some(n => n.severity === 'error') ? 'error' : 'warning', text: notes.map(n => n.text).join(' ') });
                    if (useModelStore.getState().scene.wireframes.length > 0) reveal('meshes', keys.root('meshes'));
                });
            return null;
        case 'topography':
            void pickTopographyFile().then(async file => {
                if (!file) return;
                const made = await addTopographyFile(file, act?.dataBounds() ?? sceneDataBox());
                sayMade(topoNote(made.notes));
                if (made.id) reveal('meshes', keys.wireframe(made.id));
            });
            return null;
    }
}

/** What opens in the properties once it is made (the rest ask in a dialog first) */
const SHOWN_IN_PROPERTIES: ReadonlySet<NewId> = new Set(['points', 'lines', 'surface', 'surfaceFromSelection', 'ground', 'sectionsWE', 'sectionsSN', 'sectionsLevel', 'sectionsFromSlice']);

/** Make it from a menu: what there is to say goes to the page, and its properties are brought up */
export function makeFromMenu(id: NewId, target: TargetView): void {
    if (cannotMake(id, target)) return;
    sayMade(makeNew(id, target));
    if (SHOWN_IN_PROPERTIES.has(id)) showModelPane(MODEL_PANEL_IDS.properties);
}
