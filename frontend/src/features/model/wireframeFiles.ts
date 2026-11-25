/**
 * The files behind the scene's wireframes.
 *
 * The scene (store/modelStore) lists each wireframe by the name of its file;
 * the meshes are far too big for the project file. Here the files are read
 * (in a worker), their meshes kept for the session, and copies kept in the
 * project folder, <project>/wireframes/, so the wireframes come back when the
 * project is opened again:
 *
 * - a file the user loads is copied there at once when the project has a
 *   folder, otherwise at the first Save;
 * - Save As to another folder takes the files along;
 * - when a project is opened, its files are read from the folder the first
 *   time a 3D view needs them. One that is not there is `missing`, and the
 *   user can point to it again.
 *
 * Nothing is ever deleted from the folder: removing a wireframe from the
 * scene can be undone, and a file left behind does no harm.
 */
import { create } from 'zustand';
import { copyProjectAsset, projectFilesAvailable, readProjectAsset, writeProjectAsset } from '../../services/projectFiles';
import { useModelStore } from '../../store/modelStore';
import { WIREFRAME_EXTENSIONS, type ParsedWireframe, type WireframeFormat, type WireframePart } from '../plots/viewer3d/wireframeParsers';
import { parseWireframeBlob } from '../plots/viewer3d/wireframeStore';

const FOLDER = 'wireframes';

export interface WireframeFile {
    /** loading = being read; ready = its objects are in `parts`; missing = not in the project folder; error = could not be read */
    state: 'loading' | 'ready' | 'missing' | 'error';
    parts: WireframePart[];
    format: WireframeFormat | null;
    /** Why it could not be read */
    error: string | null;
}

interface WireframeFilesState {
    byFile: Record<string, WireframeFile>;
    /** Files in the scene with no copy in the project folder yet */
    notKept: string[];
    /** Counts the files the user has loaded (a view frames the first ones) */
    loads: number;
}

export const useWireframeFiles = create<WireframeFilesState>()(() => ({ byFile: {}, notKept: [], loads: 0 }));

/** The file itself, to write into the project folder */
const blobs = new Map<string, Blob>();
/** file -> the project (by path) whose folder holds this copy of it */
const keptIn = new Map<string, string>();
/** file -> the project it could not be written to (not tried again until something changes) */
const failed = new Map<string, string>();
/** Goes up when another scene is loaded: what is still being read for the old one is dropped */
let generation = 0;
let projectPath: string | null = null;
/** The project path when the files were last brought up to date */
let syncedPath: string | null = null;
/** Another scene was loaded since then: a new path is then another project, not Save As */
let fresh = true;
let queue: Promise<void> = Promise.resolve();
let timer: ReturnType<typeof setTimeout> | null = null;

const sceneFiles = (): string[] => Array.from(new Set(useModelStore.getState().scene.wireframes.map(w => w.file)));

function put(file: string, entry: WireframeFile) {
    useWireframeFiles.setState(s => ({ byFile: { ...s.byFile, [file]: entry } }));
}

function publishKept() {
    const notKept = sceneFiles().filter(f => blobs.has(f) && (projectPath === null || keptIn.get(f) !== projectPath));
    const now = useWireframeFiles.getState().notKept;
    if (notKept.length !== now.length || notKept.some((f, i) => f !== now[i])) useWireframeFiles.setState({ notKept });
}

/**
 * The name a file is kept under in the project folder: its own name, without
 * the characters a folder may refuse. A file already in the scene under the
 * same name in other capitals keeps that name (one file on disk).
 */
export function wireframeKey(fileName: string): string {
    const clean = fileName.replace(/[^A-Za-z0-9_ .()+-]+/g, '_').replace(/^[ .]+|[ .]+$/g, '') || 'wireframe';
    return sceneFiles().find(f => f.toLowerCase() === clean.toLowerCase()) ?? clean;
}

const extension = (name: string) => name.slice(name.lastIndexOf('.')).toLowerCase();

/** Bring the copies in the project folder up to date (one run at a time). */
async function sync(): Promise<void> {
    const path = projectPath, from = syncedPath;
    const saveAs = !fresh && from !== null && path !== null && from !== path;
    syncedPath = path;
    fresh = false;
    const gen = generation;
    const files = sceneFiles();
    if (path !== null && files.some(f => keptIn.get(f) !== path && failed.get(f) !== path) && await projectFilesAvailable()) {
        for (const file of files) {
            if (gen !== generation) return;
            if (keptIn.get(file) === path || failed.get(file) === path) continue;
            const blob = blobs.get(file);
            try {
                if (blob) await writeProjectAsset(path, FOLDER, file, blob);
                // Never read in this session (no 3D view was open): copied from folder to folder
                else if (saveAs) await copyProjectAsset(from, path, FOLDER, file);
                else continue;
                if (gen === generation) keptIn.set(file, path);
            } catch {
                if (gen === generation) failed.set(file, path);
            }
        }
    }
    if (gen === generation) publishKept();
}

function schedule() {
    if (timer !== null) return;
    // After the store changes of this turn: opening a project sets the scene, then the path
    timer = setTimeout(() => {
        timer = null;
        queue = queue.then(sync).catch(() => { /* a failed copy is shown as not kept */ });
    }, 0);
}

/** The project's file path (null: not saved to a folder). Called by store/projectStore whenever it changes. */
export function setWireframeProject(path: string | null): void {
    if (path === projectPath) return;
    projectPath = path;
    schedule();
}

/** The project was saved: a copy that could not be written before is tried again. Called by store/projectStore. */
export function wireframeProjectSaved(): void {
    if (failed.size === 0) return;
    failed.clear();
    schedule();
}

useModelStore.subscribe((state, prev) => {
    if (state.sceneLoads !== prev.sceneLoads) {
        generation++;
        blobs.clear();
        keptIn.clear();
        failed.clear();
        fresh = true;
        useWireframeFiles.setState({ byFile: {}, notKept: [] });
    }
    if (state.scene.wireframes !== prev.scene.wireframes) schedule();
});

async function readFromProject(file: string, path: string): Promise<void> {
    const gen = generation;
    const none = { parts: [], format: null };
    let blob: Blob;
    try {
        blob = await readProjectAsset(path, FOLDER, file);
    } catch (e) {
        if (gen !== generation) return;
        const gone = (e as { status?: number }).status === 404;
        put(file, { ...none, state: gone ? 'missing' : 'error', error: gone ? null : (e instanceof Error ? e.message : String(e)) });
        return;
    }
    try {
        const parsed = await parseWireframeBlob(file, blob);
        if (gen !== generation) return;
        blobs.set(file, blob);
        keptIn.set(file, path);
        put(file, { state: 'ready', parts: parsed.parts, format: parsed.format, error: null });
        // Read just as the project was saved elsewhere: that folder still needs its copy
        if (projectPath !== path) schedule();
    } catch (e) {
        if (gen === generation) put(file, { ...none, state: 'error', error: e instanceof Error ? e.message : String(e) });
    }
}

/** Read the scene's wireframe files that have not been read yet. Called by a 3D view when it shows the scene. */
export function loadSceneWireframes(): void {
    const { byFile } = useWireframeFiles.getState();
    for (const file of sceneFiles()) {
        if (byFile[file]) continue;
        if (projectPath === null) {
            put(file, { state: 'missing', parts: [], format: null, error: null });
            continue;
        }
        put(file, { state: 'loading', parts: [], format: null, error: null });
        void readFromProject(file, projectPath);
    }
}

/**
 * Load a file the user picked into the scene. `as`: the scene's name for a
 * file that went missing, which this one stands in for (it must be of the
 * same kind). Throws when the file cannot be read.
 */
export async function addWireframeFile(file: File, as?: string): Promise<ParsedWireframe & { file: string }> {
    if (as !== undefined && extension(as) !== extension(file.name)) {
        throw new Error(`${as} is a ${extension(as)} file: choose a ${extension(as)} file for it`);
    }
    if (!(WIREFRAME_EXTENSIONS as readonly string[]).includes(extension(file.name))) {
        throw new Error(`Unsupported mesh type (use ${WIREFRAME_EXTENSIONS.join(', ')})`);
    }
    const gen = generation;
    const parsed = await parseWireframeBlob(file.name, file);
    if (gen !== generation) throw new Error('Another project was opened while the file was being read');
    const key = as ?? wireframeKey(file.name);
    blobs.set(key, file);
    keptIn.delete(key);
    failed.delete(key);
    useWireframeFiles.setState(s => ({
        byFile: { ...s.byFile, [key]: { state: 'ready', parts: parsed.parts, format: parsed.format, error: null } },
        loads: s.loads + 1,
    }));
    useModelStore.getState().setWireframeFile(key, parsed.parts.map(p => ({ name: p.name, solid: p.triangles.length > 0 })));
    publishKept();
    schedule();
    return { ...parsed, file: key };
}

/** Wait until the copies in the project folder are up to date (tests). */
export async function _wireframeFilesSettled(): Promise<void> {
    for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 0));
        await queue;
        if (timer === null) return;
    }
}
