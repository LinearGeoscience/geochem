/**
 * The meshes of the scene's wireframes as fields a geological model can
 * read (meshField.ts): one object per mesh, so that its reader is built once.
 */
import { useModelStore } from '../../store/modelStore';
import type { MeshField } from './meshField';
import { loadSceneWireframes, useWireframeFiles } from './wireframeFiles';

const meshFields = new WeakMap<object, MeshField>();

/**
 * The mesh of a wireframe of the scene as a field, with a mark that tells it
 * from another. 'wait': its file is still being read. null: it has no
 * triangles to use (or its file is missing).
 */
export function sceneMesh(id: string): { field: MeshField; mark: string } | 'wait' | null {
    const wire = useModelStore.getState().scene.wireframes.find(w => w.id === id);
    if (!wire) return null;
    const file = useWireframeFiles.getState().byFile[wire.file];
    if (!file) { loadSceneWireframes(); return useWireframeFiles.getState().byFile[wire.file] ? 'wait' : null; }
    if (file.state === 'loading') return 'wait';
    const part = file.parts[wire.part];
    if (file.state !== 'ready' || !part || part.triangles.length === 0) return null;
    let field = meshFields.get(part);
    if (!field) {
        field = { vertices: part.vertices, triangles: part.triangles };
        meshFields.set(part, field);
    }
    return { field, mark: `mesh:${wire.file}#${wire.part}:${part.vertices.length}:${part.triangles.length}` };
}
