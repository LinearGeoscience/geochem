/**
 * What a view can draw of the project, as a list in groups (pure): the Scene
 * tab's rows, read off the project tree so that names, colours and what an
 * eye shows are the tree's. A geological model is three groups (its solids
 * and its box; the surfaces it is made from; its contacts and faults as it
 * cuts them), a numeric model one, every other group of the tree one.
 */
import type { NodeStatus, TreeNode } from './projectTree';
import { keys, parseKey } from './objectKeys';
import type { ObjectType } from './objectTypes';
import { statusTip } from './treeRules';
import type { ModelScene } from './types';
import { displayable, type OwnLook } from './viewDisplay';

export interface SceneRow {
    /** The object's key in the tree (what a click on the row picks) */
    key: string;
    /** The key its eye shows and hides, and its display is kept under */
    visKey: string;
    name: string;
    detail?: string;
    color?: string;
    kind: TreeNode['kind'];
    sub?: string;
    type?: ObjectType;
    status?: NodeStatus | null;
    /** What its state is, in words (as the tree says it) */
    said?: string;
    /** Drawn as a mesh: it can be drawn solid, as its edges, as its outline, and left whole by a slice */
    mesh: boolean;
}

export interface SceneGroup {
    key: string;
    /** What it is called in full ("Pit model: solids") */
    title: string;
    /** A part of a model: the part ("Solids") and the model, said apart so that a narrow list shows which part it is */
    part?: string;
    of?: string;
    rows: SceneRow[];
}

const rowOf = (n: TreeNode, name = n.name): SceneRow => ({
    key: n.key, visKey: n.visKey!, name, kind: n.kind, mesh: displayable(n.visKey!),
    ...(n.detail ? { detail: n.detail } : {}), ...(n.color ? { color: n.color } : {}), ...(n.sub ? { sub: n.sub } : {}), ...(n.type ? { type: n.type } : {}),
    ...(n.status ? { status: n.status, said: statusTip(n) } : {}),
});

/** Every node under these with an eye of its own, the folders they are filed in said before their names */
function eyed(nodes: readonly TreeNode[], folder = ''): { node: TreeNode; name: string }[] {
    const out: { node: TreeNode; name: string }[] = [];
    for (const n of nodes) {
        if (n.kind === 'link' || n.kind === 'note') continue;
        if (n.kind === 'folder') { out.push(...eyed(n.children, `${folder}${n.name} / `)); continue; }
        if (n.visKey && n.kind !== 'root' && n.kind !== 'modelGroup') out.push({ node: n, name: `${folder}${n.name}` });
        out.push(...eyed(n.children, folder));
    }
    return out;
}

/** The Scene tab's groups, in the tree's order (a group with nothing to draw is left out; an object is listed once) */
export function sceneList(tree: readonly TreeNode[]): SceneGroup[] {
    const groups: SceneGroup[] = [];
    const seen = new Set<string>();
    const add = (key: string, title: string, found: { node: TreeNode; name: string }[], part?: [string, string]) => {
        const rows: SceneRow[] = [];
        for (const f of found) {
            if (seen.has(f.node.visKey!)) continue;
            seen.add(f.node.visKey!);
            rows.push(rowOf(f.node, f.name));
        }
        if (rows.length > 0) groups.push({ key, title, ...(part ? { part: part[0], of: part[1] } : {}), rows });
    };
    for (const root of tree) {
        if (root.key === keys.root('models')) {
            for (const m of root.children) {
                if (m.kind !== 'model') { add(`${m.key}/all`, m.name, eyed([m])); continue; }
                const all = eyed(m.children);
                const solids = all.filter(f => f.node.kind === 'volume');
                const cuts = all.filter(f => f.node.kind === 'modelContact' || f.node.kind === 'modelFault');
                const rest = all.filter(f => !solids.includes(f) && !cuts.includes(f));
                add(`${m.key}/solids`, `${m.name}: solids`, [...solids, ...(m.visKey ? [{ node: m, name: 'Its boundary (the box)' }] : [])], ['Solids', m.name]);
                add(`${m.key}/surfaces`, `${m.name}: the surfaces it is made from`, rest, ['Made from', m.name]);
                add(`${m.key}/cuts`, `${m.name}: contacts as it cuts them`, cuts, ['Contacts as cut', m.name]);
            }
        } else if (root.key === keys.root('numeric')) {
            for (const m of root.children) add(`${m.key}/all`, m.name, eyed([m]));
        } else add(root.key, root.name, eyed(root.children));
    }
    return groups;
}

/** A model's solid, and its contacts and faults as it cuts them: opaque, no triangle edges */
export const MODEL_PART_LOOK: OwnLook = { opacity: 1, showEdges: false };

/** The look an object has of its own (null: it is not drawn as a mesh) */
export function ownLookOf(scene: ModelScene, visKey: string): OwnLook | null {
    if (!displayable(visKey)) return null;
    const parsed = parseKey(visKey);
    if (parsed?.kind === 'surface') {
        const s = scene.surfaces.find(x => x.id === parsed.id);
        return s ? { opacity: s.opacity, showEdges: s.showEdges } : null;
    }
    if (parsed?.kind === 'wireframe') {
        const w = scene.wireframes.find(x => x.id === parsed.id);
        return w ? { opacity: w.opacity, showEdges: w.showEdges } : null;
    }
    return MODEL_PART_LOOK;
}
