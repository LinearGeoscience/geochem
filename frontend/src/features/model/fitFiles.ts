/**
 * The fits of the scene's surfaces, kept with the project (Phase 224).
 *
 * A fit is worked out from the scene and the data, so the project file does
 * not hold it; but working every one out again each time a project is
 * opened takes as long as it took the first time. So when a project is
 * saved to a folder, each surface's finished fit is written beside it,
 * <project folder>/fits/<surface id>.fit (fitCodec.ts), with a list of them
 * (index.fit). When the project is opened the fits are read back before
 * anything is fitted, and a surface whose key (modelCache: everything its
 * fit depends on) is the key of its kept fit has that fit and is not fitted.
 * A locked surface has the fit it was locked at, whatever has changed.
 *
 * A kept fit is only ever a saving of time: whenever it is not certainly
 * the fit of the surface as it is (another key, another version of the
 * app or of the fitting, a file that cannot be read), the surface is
 * fitted as ever. Nothing is deleted from the folder: a file left by a
 * surface that is gone is small harm, and is written over when its name
 * is used again.
 */
import { projectFilesAvailable, readProjectAsset, writeProjectAsset } from '../../services/projectFiles';
import { useModelStore } from '../../store/modelStore';
import { decodeFit, encodeFit } from './fitCodec';
import { whenIdle } from './jobs';
import { fitToSave, holdFits, releaseFits, type SavedFit } from './modelCache';

const FOLDER = 'fits';
const INDEX = 'index.fit';

/**
 * Goes up with every change to the fitting that gives another surface from
 * the same inputs (the key says what a fit is made from, not how): fits
 * kept by another engine are not taken.
 *
 * 2 (Round 27): a dip, a direction at a point and what the structural data
 * says at a surface's places are held as slopes there, where the places do
 * not crowd (sheet.ts, `asSlopes`). Surfaces with none of these are as
 * they were; those with any have another key as well (surfaceJobs,
 * `fitKey`), so that a locked one says it is not as it was locked.
 *
 * 3 (Phase 250b): where a hole starts or stops inside a vein, the picks of
 * the holes round about are kept (vein.ts: only a place put by hand takes
 * them out). Veins with no such hole are as they were.
 *
 * 4 (Phase 252): a dip or a direction put on a vein by hand is carried to
 * the middles of the stretches within its reach (veinCarry.ts); and a dip
 * with a reach holds as far each way round as there is room, so at the edge
 * of the places it carries the surface on down its plane (readings.ts,
 * `rimOf`). Veins with no dip or direction put on them, and surfaces with no
 * dip that has a reach, are as they were.
 *
 * 5 (Phase 253): a vein no longer takes its own stretch for a hole that
 * passes through it without meeting it, where the logged intervals either
 * side of the stretch are far apart (vein.ts, `ON_HOLE`). It shows on veins
 * whose stretches are thinner than the logging left out round them: zones
 * taken at their net thickness. Other veins are as they were.
 *
 * 6 (Phase 254): a vein's walls are fitted again to the logging of its
 * holes (an interval of it left outside a wall, or of other ground left
 * inside one, puts a place on that wall; vein.ts, `REFIT_PASSES`), and a
 * stretch with both ends on one side of its reference surface has each wall
 * through its own end (`ONE_SIDE`). Veins the logging already agreed with,
 * and other surfaces, are as they were.
 *
 * 7 (Phase 274): a vein's mesh is drawn as the vein was fitted: each wall's
 * height is read where the wall is, not at the reference surface under it,
 * and the mesh is fine round every place a height is known at (vein.ts,
 * `WALL_ROUNDS`, `WALL_FINER`). The fits themselves are as they were; the
 * meshes kept with them are not, so they are made again. Other surfaces are
 * as they were.
 *
 * 8 (Phase 279): an intrusion of thin sheets is known less far across its
 * sheets than along them (its reach across them is its reach over how many
 * times further it is carried along them; surfaceJobs.ts, `FieldCap.across`):
 * it no longer swells into the ground beside its holes. And a vein not held
 * to the lie of the ground has its walls no further out than four times
 * their height where the field of its reference surface goes flat (vein.ts,
 * `LEAST_RISE`). Other surfaces are as they were.
 */
export const FIT_ENGINE = 8;
/** The app's version: a kept fit is taken only by the version that made it */
const APP: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';

interface IndexAbout { kind: 'index'; engine: number; app: string; fits: Record<string, string> }
interface FitAbout { kind: 'fit'; engine: number; app: string; id: string; key: string }

const fileOf = (id: string) => `${id}.fit`;
/** Surface ids are the file names: only those a folder takes as they are */
const safeId = (id: string) => /^[A-Za-z0-9_-]+$/.test(id);

let projectPath: string | null = null;
/** surface id -> the project (by path) and key its file in that project's folder is the fit of */
const keptAs = new Map<string, { path: string; key: string }>();
let queue: Promise<void> = Promise.resolve();
/** What the tests and probes count */
const counts = { written: 0, read: 0 };
export const fitFileCounts = (): { written: number; read: number } => ({ ...counts });

/** The project's file path (null: not saved to a folder). Called by store/projectStore whenever it changes. */
export function setFitsProject(path: string | null): void {
    if (path === projectPath) return;
    projectPath = path;
    // (Another folder: what is known of the files is of the old one)
    keptAs.clear();
}

async function bytesOf(blob: Blob): Promise<Uint8Array> {
    return new Uint8Array(await blob.arrayBuffer());
}

/** Write the fits that are finished and not yet in the project's folder as they are now */
async function writeFits(): Promise<void> {
    const path = projectPath;
    if (path === null) return;
    const surfaces = useModelStore.getState().scene.surfaces;
    const todo = surfaces.filter(s => {
        if (!safeId(s.id)) return false;
        const fit = fitToSave(s.id), had = keptAs.get(s.id);
        return !!fit && !(had && had.path === path && had.key === fit.key);
    });
    if (todo.length === 0 || !(await projectFilesAvailable())) return;
    let wrote = false;
    for (const surface of todo) {
        // (As it is now: it may have been fitted again while the others were written)
        const fit = fitToSave(surface.id);
        if (!fit) continue;
        try {
            const about: FitAbout = { kind: 'fit', engine: FIT_ENGINE, app: APP, id: surface.id, key: fit.key };
            await writeProjectAsset(path, FOLDER, fileOf(surface.id), new Blob([encodeFit(fit, about)]));
            keptAs.set(surface.id, { path, key: fit.key });
            counts.written++;
            wrote = true;
        } catch {
            // Not written (the folder is gone, or something in the fit a file cannot hold): it is fitted when the project is opened
            keptAs.delete(surface.id);
        }
    }
    if (!wrote) return;
    // The list of what is there, written last: a fit not in it is not looked for
    const fits: Record<string, string> = {};
    for (const [id, had] of keptAs) if (had.path === path) fits[id] = had.key;
    const about: IndexAbout = { kind: 'index', engine: FIT_ENGINE, app: APP, fits };
    try {
        await writeProjectAsset(path, FOLDER, INDEX, new Blob([encodeFit(null, about)]));
    } catch { /* without the list nothing is read back: the surfaces are fitted */ }
}

const later = (run: () => Promise<void>): Promise<void> => {
    queue = queue.then(run).catch(() => { /* a fit not written is fitted on opening */ });
    return queue;
};

/**
 * The project was saved: the fits that are finished are written beside it.
 * Those still being worked out are written when they are done, if the
 * surfaces are still as they were saved. Called by store/projectStore.
 */
export function fitsProjectSaved(): void {
    if (projectPath === null) return;
    const saved = useModelStore.getState().scene.surfaces;
    void later(writeFits).then(async () => {
        if (!(await whenIdle())) return;
        if (useModelStore.getState().scene.surfaces === saved) await later(writeFits);
    });
}

/** The fits kept in a project's folder for these surfaces, as far as they can be read */
async function readFits(path: string, ids: readonly string[]): Promise<Map<string, SavedFit>> {
    const out = new Map<string, SavedFit>();
    if (ids.length === 0 || !(await projectFilesAvailable())) return out;
    let listed: Record<string, string>;
    try {
        const index = decodeFit(await bytesOf(await readProjectAsset(path, FOLDER, INDEX)))?.about as IndexAbout | undefined;
        if (!index || index.kind !== 'index' || index.engine !== FIT_ENGINE || index.app !== APP || !index.fits) return out;
        listed = index.fits;
    } catch {
        // (No list: a project saved before fits were kept, or one with none)
        return out;
    }
    await Promise.all(ids.filter(id => safeId(id) && typeof listed[id] === 'string').map(async id => {
        try {
            const read = decodeFit(await bytesOf(await readProjectAsset(path, FOLDER, fileOf(id))));
            const about = read?.about as FitAbout | undefined;
            const fit = read?.value as SavedFit | undefined;
            if (!about || !fit || about.kind !== 'fit' || about.engine !== FIT_ENGINE || about.app !== APP || about.id !== id) return;
            if (typeof fit.key !== 'string' || fit.key !== about.key || !fit.part || !fit.field) return;
            out.set(id, fit);
            keptAs.set(id, { path, key: fit.key });
            counts.read++;
        } catch { /* not there, or not readable: it is fitted */ }
    }));
    return out;
}

/**
 * A project is about to be opened (its scene set): nothing is fitted until
 * `openedWithFits`. Called by store/projectStore before it loads a project
 * from a folder; whoever calls this calls that, whatever happens.
 */
export function openingWithFits(): void {
    holdFits();
}

/**
 * The project is open (or could not be opened). `path`: its file, when it
 * was opened from a folder. Its kept fits are read and given to the cache,
 * and fitting goes on from there. Never throws.
 */
export async function openedWithFits(path: string | null): Promise<void> {
    let fits: Map<string, SavedFit> | null = null;
    try {
        keptAs.clear();
        if (path !== null) fits = await readFits(path, useModelStore.getState().scene.surfaces.map(s => s.id));
    } catch {
        fits = null;
    } finally {
        releaseFits(fits);
    }
}

/** Wait until the fits have been written to the project's folder (tests) */
export async function _fitFilesSettled(): Promise<void> {
    for (let i = 0; i < 6; i++) {
        await queue;
        await new Promise(r => setTimeout(r, 0));
    }
    await queue;
}
