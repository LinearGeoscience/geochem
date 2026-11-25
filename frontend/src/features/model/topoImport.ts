/**
 * Topography from a file, into the project (Phase 228; GeoTIFFs, 229): the
 * file is read to a grid of heights (features/model/topoFiles, topoTiff), the
 * grid made a mesh, and
 * the mesh added as a mesh file of the project, written as a Leapfrog .msh
 * (features/model/wireframeFiles). From there it is a mesh like any other:
 * kept with the project, shown, and the top of a geological model.
 */
import { useModelStore } from '../../store/modelStore';
import { meshesToMsh } from './meshWriters';
import { GROUND_COLOR } from './sceneActions';
import { coverNote, cropGrid, describeGrid, gridToMesh, meshEvery, NotTopography, readAsciiGrid, readXyz, topoKind, type HeightGrid } from './topoFiles';
import { readGeoTiff } from './topoTiff';
import { addWireframeFile } from './wireframeFiles';

export type TopoNote = { severity: 'info' | 'warning' | 'error'; text: string };

export interface TopoImported {
    /** The mesh it became (its id in the scene); null when it could not be read */
    id: string | null;
    /** What there is to say of it: what was read first, then anything to look at */
    notes: TopoNote[];
}

/** The grid of heights in a file (throws NotTopography, with a sentence, when it holds none) */
export async function readTopography(file: File): Promise<HeightGrid> {
    const kind = topoKind(file.name);
    if (kind === null) throw new NotTopography('Topography is read from a GeoTIFF (.tif), an ESRI ASCII grid (.asc) or a file of points (.xyz, .csv, .txt: east, north, height).');
    if (kind === 'tiff') return readGeoTiff(await file.arrayBuffer());
    const text = await file.text();
    // (A grid saved under another ending is still a grid: its first word says so)
    return /^\s*ncols\b/i.test(text.slice(0, 200)) ? readAsciiGrid(text) : kind === 'grid' ? readAsciiGrid(text) : readXyz(text);
}

/**
 * Read a file of heights and add it to the project as a mesh. `dataBox`:
 * where the drilling is, to say when the topography is somewhere else.
 * Never throws: what went wrong is in the notes.
 */
export async function addTopographyFile(file: File, dataBox: { min: readonly number[]; max: readonly number[] } | null): Promise<TopoImported> {
    try {
        const whole = await readTopography(file);
        // A grid too big to mesh as it is, and far wider than the drilling: only the ground round the drilling is
        // kept (as far again on every side as the drilling is wide), so that there it is not made coarser
        let grid = whole;
        if (dataBox && meshEvery(whole) > 1) {
            const reach = Math.max(dataBox.max[0] - dataBox.min[0], dataBox.max[1] - dataBox.min[1]);
            const cut = cropGrid(whole, dataBox.min[0] - reach, dataBox.max[0] + reach, dataBox.min[1] - reach, dataBox.max[1] + reach);
            if (cut && meshEvery(cut) < meshEvery(whole)) grid = cut;
        }
        const mesh = gridToMesh(grid);
        const base = file.name.replace(/\.[^.]+$/, '');
        const bytes = meshesToMsh([{ name: base, vertices: mesh.vertices, triangles: mesh.triangles }]);
        const added = await addWireframeFile(new File([bytes], `${base} (topography).msh`));
        const scene = useModelStore.getState();
        const made = scene.scene.wireframes.find(w => w.file === added.file && w.part === 0) ?? null;
        // (Named for what it is, and the green of the ground made from the collars)
        if (made) scene.updateWireframe(made.id, { name: `Topography · ${file.name}`, color: GROUND_COLOR });
        const notes: TopoNote[] = [{ severity: 'info', text: `${file.name}: ${describeGrid(grid, mesh.every)}` }];
        if (grid !== whole) notes.push({ severity: 'info', text: `That is the ground round the drilling, as far again on every side: the file is wider (${whole.nx.toLocaleString()} by ${whole.ny.toLocaleString()} cells), and all of it would have had to be meshed coarser.` });
        for (const text of grid.notes) notes.push({ severity: 'info', text });
        const cover = coverNote(whole, dataBox);
        if (cover) notes.push({ severity: 'warning', text: cover });
        return { id: made?.id ?? null, notes };
    } catch (e) {
        const text = e instanceof NotTopography ? e.message : `It could not be read (${e instanceof Error ? e.message : String(e)}).`;
        return { id: null, notes: [{ severity: 'error', text: `${file.name}: ${text}` }] };
    }
}

/** The notes as one, for where one thing is said (the worst of them sets how it is said) */
export function topoNote(notes: readonly TopoNote[]): TopoNote | null {
    if (notes.length === 0) return null;
    const severity = notes.some(n => n.severity === 'error') ? 'error' : notes.some(n => n.severity === 'warning') ? 'warning' : 'info';
    return { severity, text: notes.map(n => n.text).join(' ') };
}
