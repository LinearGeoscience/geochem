/**
 * Mesh files read into the project (features/model/wireframeFiles), with
 * what there is to say of each: what its reader warned of, that it lies
 * away from the data, or that it could not be read. Used by the Wireframes
 * panel and by "Load mesh files" wherever it is asked for.
 */
import { TOPO_EXTENSIONS } from '../../model/topoFiles';
import { addWireframeFile } from '../../model/wireframeFiles';
import { WIREFRAME_EXTENSIONS } from './wireframeParsers';
import { planGap, unionBounds } from './wireframeStore';

export type WireframeNote = { severity: 'error' | 'warning'; text: string };

/**
 * Read the files. `dataBounds`: where the data is (world coordinates), to
 * say when a file is somewhere else. `as`: the name of a missing file of the
 * scene that the first one stands in for.
 */
export async function loadWireframeFiles(picked: readonly File[], dataBounds: { min: number[]; max: number[] } | null, as?: string): Promise<WireframeNote[]> {
    const notes: WireframeNote[] = [];
    for (const file of as === undefined ? picked : picked.slice(0, 1)) {
        try {
            const parsed = await addWireframeFile(file, as);
            for (const w of parsed.warnings) notes.push({ severity: 'warning', text: `${file.name}: ${w}` });
            const b = unionBounds(parsed.parts.map(p => p.bounds));
            if (b && dataBounds) {
                const gap = planGap(b, dataBounds);
                if (gap > 0) {
                    const dist = gap >= 1000 ? `${(gap / 1000).toFixed(1)} km` : `${Math.round(gap)} m`;
                    notes.push({
                        severity: 'warning',
                        text: `${file.name} is ${dist} from the data in plan — check it uses the same coordinate system (e.g. MGA zone / local mine grid).`,
                    });
                }
            }
        } catch (e) {
            notes.push({ severity: 'error', text: `${file.name}: ${e instanceof Error ? e.message : String(e)}` });
        }
    }
    return notes;
}

/** Ask for files with the browser's own file box (none picked: an empty list) */
function pickFiles(accept: readonly string[], multiple: boolean, testId: string): Promise<File[]> {
    return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = multiple;
        input.accept = accept.join(',');
        input.setAttribute('data-testid', testId);
        input.style.display = 'none';
        const done = (files: File[]) => { input.remove(); resolve(files); };
        input.addEventListener('change', () => done(Array.from(input.files ?? [])));
        input.addEventListener('cancel', () => done([]));
        document.body.appendChild(input);
        input.click();
    });
}

/** Ask for mesh files (none picked: an empty list) */
export const pickWireframeFiles = (): Promise<File[]> => pickFiles(WIREFRAME_EXTENSIONS, true, 'new-meshes-input');

/** Ask for one file of heights: a grid or points (none picked: null) */
export const pickTopographyFile = (): Promise<File | null> => pickFiles(TOPO_EXTENSIONS, false, 'new-topography-input').then(files => files[0] ?? null);
