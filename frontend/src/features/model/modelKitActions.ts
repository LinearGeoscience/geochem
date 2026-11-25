/**
 * A geological model's rebuild kit, out of the app and back in: saved as
 * one zip (modelKit.ts), and a kit opened again, which is kept as a named
 * version of the scene to go back to.
 */
import { useModelStore } from '../../store/modelStore';
import { useSceneVersions } from '../../store/sceneVersionsStore';
import { BUILD_VERSION } from '../../store/updateStore';
import { downloadText } from '../../utils/gisExport';
import { unzip, zipStore } from '../../utils/zipStore';
import { useGeoModelCache } from './geoModelCache';
import { modelUnits, unitColor } from './geoModel';
import { cleanMesh } from './meshClean';
import type { NamedMesh } from './meshWriters';
import { modelKit, readModelKit, type ModelKit } from './modelKit';
import { unitSolid } from './modelParts';
import { localDate, type SurfaceKit } from './rebuildKit';
import { surfaceKitOf } from './sceneActions';

/** A model's kit as it is now (null: no such model) */
export function buildModelKit(modelId: string): ModelKit | null {
    const scene = useModelStore.getState().scene;
    const model = scene.models?.find(m => m.id === modelId);
    if (!model) return null;
    const result = useGeoModelCache.getState().byId[modelId];
    const out = result?.out ?? null;
    const names = out ? result!.units : modelUnits(scene, model);
    const kits = new Map<string, SurfaceKit>();
    for (const x of [...model.contacts, ...(model.faults ?? []), ...(model.boundary.top ? [{ surface: model.boundary.top }] : [])]) {
        const kit = x.surface && !kits.has(x.surface) ? surfaceKitOf(x.surface) : null;
        if (kit) kits.set(x.surface!, kit);
    }
    const solids: NamedMesh[] = [];
    if (out) {
        result!.units.forEach((unit, u) => {
            const solid = unitSolid(out, u);
            if (solid.triangles.length === 0) return;
            const { mesh } = cleanMesh({ vertices: Float64Array.from(solid.vertices), triangles: Uint32Array.from(solid.triangles) });
            solids.push({ name: unit, vertices: mesh.vertices, triangles: mesh.triangles });
        });
    }
    return modelKit({
        scene, model,
        units: names.map((name, u) => ({ name, color: out ? result!.colors[u] : unitColor(scene, model, name), volume: out ? out.volumes[u] : null })),
        box: result?.box ?? null, near: result?.job?.near?.reach ?? null, cell: out ? out.grid.cell : model.cell,
        surfaceKits: kits, solids,
        version: BUILD_VERSION, date: localDate(),
    });
}

/** Save a model's rebuild kit as one zip. False: no such model. */
export function exportModelKit(modelId: string): boolean {
    const kit = buildModelKit(modelId);
    if (!kit) return false;
    downloadText(zipStore(kit.files), `${kit.folder} Leapfrog export.zip`, 'application/zip');
    return true;
}

export type OpenedKit = { ok: true; name: string; version: string } | { ok: false; reason: string };

/**
 * Open a model's rebuild kit (its zip): the model as it was written is kept
 * as a named version of the scene. Nothing in the scene changes until that
 * version is gone back to.
 */
export async function openModelKit(bytes: Uint8Array): Promise<OpenedKit> {
    let files;
    try {
        files = await unzip(bytes);
    } catch {
        return { ok: false, reason: 'This is not a zip file.' };
    }
    const read = readModelKit(files);
    if (!read) return { ok: false, reason: 'This zip is not a model\'s Leapfrog export: it has no model.json that can be read. (A surface\'s kit is opened file by file, from the surface.)' };
    const id = useSceneVersions.getState().add(`${read.name}, from its kit`, read.saved, `The Leapfrog export of ${read.name}${read.written ? `, written ${read.written}` : ''}`);
    if (!id) return { ok: false, reason: 'There are as many versions as can be kept: delete one first.' };
    return { ok: true, name: read.name, version: useSceneVersions.getState().versions.find(v => v.id === id)!.name };
}
