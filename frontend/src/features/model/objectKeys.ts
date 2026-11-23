/**
 * Keys for the objects of a modelling project (pure). The project tree, the
 * links between objects and what each view shows all name an object by its
 * key, so one object is one key everywhere.
 *
 * Objects drawn in the 3D views have the keys their layers have there:
 * `surface:<id>`, `inputs:<id>` (a set of points or lines), `readings:<id>`,
 * `wireframe:<id>`, and `structure` (the overall direction). The others:
 * `table:<id>` (a table logged down the holes), `unitMap:<id>`,
 * `sectionSet:<id>`, `collars` (collars and surveys), `dataset` (the samples)
 * and `column:<name>` (a column of the dataset). A geological model is
 * `model:<id>`, a contact in its age order `modelContact:<model>/<contact>`
 * and a unit's solid `volume:<model>/<unit>`. A numeric model is
 * `numericModel:<id>` (its shells are surfaces). Nodes that are only in the
 * tree: `root:<name>`, `folder:<root>/<path>` and the parts a model is laid
 * out in, `modelGroup:<model>/<part>` (its boundary, its lithologies, its
 * fault system, its surface chronology, its output volumes).
 */

export type ObjectKind =
    | 'surface' | 'inputs' | 'readings' | 'wireframe' | 'structure'
    | 'table' | 'unitMap' | 'sectionSet' | 'collars' | 'dataset' | 'column'
    | 'model' | 'modelContact' | 'modelFault' | 'volume' | 'numericModel' | 'veinSystem'
    | 'root' | 'folder' | 'modelGroup';

/** The parts a geological model is laid out in, in the tree, in the order they are set up */
export const MODEL_GROUPS = ['boundary', 'lithologies', 'faults', 'chronology', 'volumes'] as const;
export type ModelGroupPart = (typeof MODEL_GROUPS)[number];

/** The tree's top-level groups that hold user folders, and the objects each holds */
export type FolderRoot = 'points' | 'lines' | 'surfaces' | 'readings' | 'meshes';
export const FOLDER_ROOTS: readonly FolderRoot[] = ['points', 'lines', 'surfaces', 'readings', 'meshes'];

const WITH_ID = new Set<ObjectKind>(['surface', 'inputs', 'readings', 'wireframe', 'table', 'unitMap', 'sectionSet', 'column', 'model', 'modelContact', 'modelFault', 'volume', 'numericModel', 'veinSystem', 'root', 'folder', 'modelGroup']);

export const keys = {
    surface: (id: string) => `surface:${id}`,
    inputs: (id: string) => `inputs:${id}`,
    readings: (id: string) => `readings:${id}`,
    wireframe: (id: string) => `wireframe:${id}`,
    structure: 'structure',
    table: (id: string) => `table:${id}`,
    unitMap: (id: string) => `unitMap:${id}`,
    sectionSet: (id: string) => `sectionSet:${id}`,
    collars: 'collars',
    dataset: 'dataset',
    column: (name: string) => `column:${name}`,
    model: (id: string) => `model:${id}`,
    modelContact: (model: string, contact: string) => `modelContact:${model}/${contact}`,
    modelFault: (model: string, fault: string) => `modelFault:${model}/${fault}`,
    volume: (model: string, unit: string) => `volume:${model}/${unit}`,
    numericModel: (id: string) => `numericModel:${id}`,
    veinSystem: (id: string) => `veinSystem:${id}`,
    root: (name: string) => `root:${name}`,
    modelGroup: (model: string, part: ModelGroupPart) => `modelGroup:${model}/${part}`,
    folder: (root: FolderRoot, path: string) => `folder:${root}/${path}`,
} as const;

/** What a key names: its kind and the id (or name, or root/path) after the colon ('' for the objects of which there is one) */
export function parseKey(key: string): { kind: ObjectKind; id: string } | null {
    if (key === 'structure' || key === 'collars' || key === 'dataset') return { kind: key, id: '' };
    const at = key.indexOf(':');
    if (at <= 0) return null;
    const kind = key.slice(0, at) as ObjectKind;
    const id = key.slice(at + 1);
    return WITH_ID.has(kind) && id ? { kind, id } : null;
}

/** The model and the contact (or fault, or unit) of a `modelContact:`, `modelFault:` or `volume:` key (null: none of them) */
export function parseModelPart(key: string): { kind: 'modelContact' | 'modelFault' | 'volume'; model: string; part: string } | null {
    const parsed = parseKey(key);
    if (!parsed || (parsed.kind !== 'modelContact' && parsed.kind !== 'modelFault' && parsed.kind !== 'volume')) return null;
    const slash = parsed.id.indexOf('/');
    return slash > 0 && slash < parsed.id.length - 1 ? { kind: parsed.kind, model: parsed.id.slice(0, slash), part: parsed.id.slice(slash + 1) } : null;
}

/** The model and the part of a `modelGroup:` key (null: not one) */
export function parseModelGroup(key: string): { model: string; part: ModelGroupPart } | null {
    const parsed = parseKey(key);
    if (!parsed || parsed.kind !== 'modelGroup') return null;
    const slash = parsed.id.lastIndexOf('/');
    const part = parsed.id.slice(slash + 1) as ModelGroupPart;
    return slash > 0 && MODEL_GROUPS.includes(part) ? { model: parsed.id.slice(0, slash), part } : null;
}

/** The root and path of a folder key (null: not a folder key) */
export function parseFolderKey(key: string): { root: FolderRoot; path: string } | null {
    const parsed = parseKey(key);
    if (!parsed || parsed.kind !== 'folder') return null;
    const slash = parsed.id.indexOf('/');
    const root = parsed.id.slice(0, slash) as FolderRoot;
    const path = parsed.id.slice(slash + 1);
    return slash > 0 && path && FOLDER_ROOTS.includes(root) ? { root, path } : null;
}
