/**
 * Everything that can be made on the Modelling page, in one list: the group
 * of the project tree it is made in, what it is called on a button and in a
 * menu, and what it needs. The group's buttons in the properties, the tree's
 * right-click menu and the page's New menu are all drawn from it, so a thing
 * is made the same way wherever it is asked for
 * (features/modelling/newActions has what each one does).
 */
import { t, type TermKey } from './terms';

export type NewId =
    | 'table' | 'units'
    | 'readings'
    | 'points' | 'lines'
    | 'surface' | 'surfaceFromSelection' | 'contact' | 'body' | 'vein' | 'shell' | 'ground' | 'numericModel' | 'proportion'
    | 'model'
    | 'sectionsFromSlice' | 'sectionsWE' | 'sectionsSN' | 'sectionsLevel'
    | 'meshes' | 'topography';

/** The groups of the project tree (projectTree.ROOTS, by name) */
export type NewGroup = 'drillholes' | 'structure' | 'points' | 'lines' | 'surfaces' | 'models' | 'numeric' | 'sections' | 'meshes';

/**
 * What a new object is made from:
 * - `nothing`: it can always be made;
 * - `columns`: the East, North and Elevation columns;
 * - `logging`: those, and the holes and their depths;
 * - `selection`: samples picked in the data;
 * - `placing`: clicks in a 3D view (one is opened when none is);
 * - `slice`: the slice that is up in a 3D view.
 */
export type NewNeeds = 'nothing' | 'columns' | 'logging' | 'selection' | 'placing' | 'slice';

export interface NewObject {
    id: NewId;
    group: NewGroup;
    /** On a button under its group */
    label: string;
    /** In a menu, where its group is not written over it (none: as on the button) */
    menu?: string;
    tip: string;
    needs: NewNeeds;
    /** The first thing made in its group: its button stands out */
    primary?: boolean;
}

export const NEW_OBJECTS: readonly NewObject[] = [
    { id: 'table', group: 'drillholes', label: 'Add a logging table…', needs: 'nothing', tip: 'A table logged down the holes (lithology, alteration, structural measurements) from a CSV file, by hole and depth.' },
    { id: 'units', group: 'drillholes', label: `${t('lithologies')} from logging…`, needs: 'nothing', tip: 'Group logged codes into the units the model is built of.' },

    { id: 'model', group: 'models', label: 'New geological model…', needs: 'nothing', primary: true, tip: 'Its name, its lithologies, its boundary and its topography, chosen in one place. Its surfaces are made after.' },
    { id: 'numericModel', group: 'numeric', label: 'New numeric model', menu: 'Numeric model…', needs: 'columns', primary: true, tip: 'A column of numbers at several cut-offs at once: one grade shell for each, all found the same way.' },
    { id: 'proportion', group: 'numeric', label: 'Proportion of logged units', menu: 'Proportion of logged units…', needs: 'logging', tip: 'How much of the ground is a logged unit, as a number at any place: for dykes or veins too thin and too broken up to draw as solids. A shell for each share asked for.' },

    { id: 'readings', group: 'structure', label: 'From columns', menu: 'Measurements from columns…', needs: 'columns', tip: 'Dips and dip directions (or strikes), or plunges and trends, from columns of the open data or of a CSV file.' },

    { id: 'points', group: 'points', label: 'New set of points', needs: 'nothing', primary: true, tip: "An empty set of points: tick it in a surface's sets to shape the surface by it, and place or draw into it while that surface is open." },
    { id: 'lines', group: 'lines', label: 'New set of polylines', needs: 'nothing', primary: true, tip: "An empty set of lines: tick it in a surface's sets to shape the surface by it, and place or draw into it while that surface is open." },

    { id: 'surface', group: 'surfaces', label: 'New surface: click on holes', needs: 'placing', primary: true, tip: 'Start a surface and click on drillholes in the view to place the points it runs through.' },
    { id: 'surfaceFromSelection', group: 'surfaces', label: 'Surface through the selection', needs: 'selection', tip: 'Fit a surface through the samples selected in the view.' },
    { id: 'contact', group: 'surfaces', label: 'Contact surface', menu: 'Contact surface…', needs: 'logging', tip: 'Where one group of units gives way to another down each drillhole.' },
    { id: 'body', group: 'surfaces', label: 'Intrusion', menu: 'Intrusion…', needs: 'logging', tip: 'A closed surface round one or more logged units, with its volume.' },
    { id: 'vein', group: 'surfaces', label: 'Vein', menu: 'Vein…', needs: 'logging', tip: 'Something thin against the gaps between the holes, built from its two walls: it stays in one piece however thin it is.' },
    { id: 'shell', group: 'surfaces', label: 'Grade shell', menu: 'Grade shell…', needs: 'columns', tip: 'A closed surface round everything at or above a cut-off of a column of numbers.' },
    { id: 'ground', group: 'surfaces', label: 'Topography from the hole collars', needs: 'logging', tip: 'A surface through the top of every drillhole.' },

    { id: 'sectionsFromSlice', group: 'sections', label: 'From the slice', menu: 'Section set from the slice', needs: 'slice', tip: 'Planes parallel to the active slice, spaced at its step' },
    { id: 'sectionsWE', group: 'sections', label: 'W-E', menu: 'W-E sections', needs: 'columns', tip: 'Sections running west to east, stepping north' },
    { id: 'sectionsSN', group: 'sections', label: 'S-N', menu: 'S-N sections', needs: 'columns', tip: 'Sections running south to north, stepping east' },
    { id: 'sectionsLevel', group: 'sections', label: 'Level', menu: 'Level plans', needs: 'columns', tip: 'Level plans, stepping up' },

    { id: 'meshes', group: 'meshes', label: 'Load', menu: 'Load mesh files…', needs: 'nothing', tip: 'Leapfrog .msh, DXF (one object per layer), OBJ, STL or GOCAD .ts.' },
    { id: 'topography', group: 'meshes', label: 'Topography from a file', menu: 'Topography from a file…', needs: 'nothing', tip: 'A grid of heights (GeoTIFF or ESRI ASCII) or a file of points (east, north, height), made a mesh: the top of a geological model.' },
];

/** The term each group goes by (its title in the tree) */
export const GROUP_TERM: Record<NewGroup, TermKey> = {
    drillholes: 'drillholes', models: 'models', numeric: 'numericModels', structure: 'structuralData', points: 'points', lines: 'polylines',
    surfaces: 'surfaces', sections: 'sections', meshes: 'meshes',
};

export const NEW_GROUPS = Object.keys(GROUP_TERM) as NewGroup[];

const BY_ID = new Map(NEW_OBJECTS.map(o => [o.id, o]));

export const newObject = (id: NewId): NewObject => BY_ID.get(id)!;

/** What can be made in a group of the tree, in the order it is offered */
export const newIn = (group: string): readonly NewObject[] => NEW_OBJECTS.filter(o => o.group === group);

/** What a new object is called in a menu */
export const newMenuLabel = (o: NewObject): string => o.menu ?? o.label;

/** The action a control that makes one is marked with (`data-action`), and the tree's menu runs */
export const newActionOf = (id: NewId): `new:${NewId}` => `new:${id}`;

/** The id in a `new:` action (null: it is not one, or names nothing that can be made) */
export function newIdOf(action: string): NewId | null {
    if (!action.startsWith('new:')) return null;
    const id = action.slice(4) as NewId;
    return BY_ID.has(id) ? id : null;
}
