/**
 * Where objects of the project are, as a box in world coordinates (pure), so
 * a view can frame them: a surface's fitted mesh (or its points and lines
 * before it is fitted), a set's points or lines, a reading set's readings, a
 * mesh from a file. A folder or a group of the tree stands for everything in
 * it.
 */
import { groupObjects, isWithin } from './folders';
import { surfaceHomes } from './modelHome';
import { parseFolderKey, parseKey, parseModelGroup, parseModelPart } from './objectKeys';
import { ROOTS } from './projectTree';
import type { ModelScene, Vec3, WireframeObject } from './types';

export interface WorldBounds {
    min: [number, number, number];
    max: [number, number, number];
}

export interface BoundsSources {
    /** A surface's fitted mesh (null: not fitted yet) */
    surface: (id: string) => { min: ArrayLike<number>; max: ArrayLike<number> } | null;
    /** A mesh's place, once its file is read (null: not read) */
    wireframe: (w: WireframeObject) => { min: ArrayLike<number>; max: ArrayLike<number> } | null;
    /** The box a geological model is built in (null: not built) */
    model?: (id: string) => { min: ArrayLike<number>; max: ArrayLike<number> } | null;
}

class Box {
    min: [number, number, number] = [Infinity, Infinity, Infinity];
    max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    add(p: ArrayLike<number>) {
        for (let k = 0; k < 3; k++) {
            if (!Number.isFinite(p[k])) return;
        }
        for (let k = 0; k < 3; k++) {
            this.min[k] = Math.min(this.min[k], p[k]);
            this.max[k] = Math.max(this.max[k], p[k]);
        }
    }
    addBox(b: { min: ArrayLike<number>; max: ArrayLike<number> }) {
        this.add(b.min);
        this.add(b.max);
    }
    get(): WorldBounds | null {
        return this.min[0] <= this.max[0] ? { min: [...this.min], max: [...this.max] } : null;
    }
}

/** The object keys a key stands for: itself, or what is in the folder or group */
export function objectsUnder(scene: ModelScene, key: string): string[] {
    const folder = parseFolderKey(key);
    if (folder) return groupObjects(scene, folder.root).filter(o => o.folder !== null && isWithin(o.folder, folder.path)).map(o => o.key);
    const parsed = parseKey(key);
    if (parsed?.kind === 'root') {
        const root = ROOTS.find(r => r.name === parsed.id)?.folders;
        // (A surface a model uses is in that model, not in the Surfaces group)
        const homes = root === 'surfaces' ? surfaceHomes(scene) : null;
        if (parsed.id === 'numeric') return (scene.numericModels ?? []).flatMap(m => m.shells.map(s => `surface:${s.surface}`));
        // (... but for the veins of a vein system, which is listed there with them)
        const veins = new Set(root === 'surfaces' ? (scene.veinSystems ?? []).flatMap(v => v.veins) : []);
        return root ? groupObjects(scene, root).map(o => o.key).filter(k => !homes?.has(k.slice('surface:'.length)) || veins.has(k.slice('surface:'.length))) : [];
    }
    // (A numeric model is where its shells are)
    if (parsed?.kind === 'numericModel') return (scene.numericModels?.find(m => m.id === parsed.id)?.shells ?? []).map(s => `surface:${s.surface}`);
    if (parsed?.kind === 'veinSystem') return (scene.veinSystems?.find(v => v.id === parsed.id)?.veins ?? []).map(v => `surface:${v}`);
    return [key];
}

/** The box round the objects (null: none of them has a place yet) */
export function objectBounds(scene: ModelScene, keys: readonly string[], sources: BoundsSources): WorldBounds | null {
    const box = new Box();
    const points = (list: readonly { p: Vec3 }[]) => { for (const x of list) box.add(x.p); };
    for (const key of new Set(keys.flatMap(k => objectsUnder(scene, k)))) {
        const parsed = parseKey(key);
        if (!parsed) continue;
        switch (parsed.kind) {
            case 'surface': {
                const s = scene.surfaces.find(x => x.id === parsed.id);
                if (!s) break;
                const fitted = sources.surface(s.id);
                if (fitted) box.addBox(fitted);
                else {
                    points(s.points);
                    for (const l of s.polylines) for (const p of l.points) box.add(p);
                }
                break;
            }
            case 'inputs': {
                const set = scene.inputs?.find(x => x.id === parsed.id);
                if (set?.kind === 'points') points(set.points);
                else if (set) for (const l of set.lines) for (const p of l.points) box.add(p);
                break;
            }
            case 'readings': {
                const set = scene.structure?.sets?.find(x => x.id === parsed.id);
                if (set) points(set.readings);
                break;
            }
            case 'wireframe': {
                const w = scene.wireframes.find(x => x.id === parsed.id);
                const b = w ? sources.wireframe(w) : null;
                if (b) box.addBox(b);
                break;
            }
            case 'model': case 'modelContact': case 'modelFault': case 'volume': case 'modelGroup': {
                // A model, or a part of one: the box it is built in
                const b = sources.model?.(parsed.kind === 'model' ? parsed.id : (parseModelPart(key) ?? parseModelGroup(key))?.model ?? '');
                if (b) box.addBox(b);
                break;
            }
            default:
                break;
        }
    }
    return box.get();
}
