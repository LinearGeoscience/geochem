/** Where objects of the open project are now: their fitted meshes, read mesh files, points and lines (objectBounds.ts) */
import { useModelStore } from '../../store/modelStore';
import { useGeoModelCache } from './geoModelCache';
import { useModelCache } from './modelCache';
import { objectBounds, type WorldBounds } from './objectBounds';
import { useWireframeFiles } from './wireframeFiles';

/** Where objects of the project are now, by key (null: none of them has a place yet) */
export function boundsOfKeys(keys: readonly string[]): WorldBounds | null {
    const fits = useModelCache.getState().byId;
    const files = useWireframeFiles.getState().byFile;
    return objectBounds(useModelStore.getState().scene, keys, {
        surface: id => {
            const part = fits[id]?.part;
            return part && part.triangles.length > 0 ? part.bounds : null;
        },
        wireframe: w => files[w.file]?.parts[w.part]?.bounds ?? null,
        model: id => useGeoModelCache.getState().byId[id]?.box ?? null,
    });
}
