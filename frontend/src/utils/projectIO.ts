/**
 * Read / write .chem project files.
 *
 * Reading runs in workers/projectIO.worker.ts when Workers are available
 * (falls back to the main thread, e.g. in tests). The parsed project carries
 * its dataset as `appState.columnar` (a ColumnarStore) instead of rows.
 */
import { ColumnarStore } from '../types/columnarData';
import { projectBytesToText, datasetFromProject, gzipString, encodeDataset } from './projectFormat';

export interface ParsedProject {
    project: any;
    store: ColumnarStore;
}

let nextId = 0;

function parseInWorker(buffer: ArrayBuffer): Promise<ParsedProject> {
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('../workers/projectIO.worker.ts', import.meta.url), { type: 'module' });
        const id = nextId++;
        worker.onmessage = (e: MessageEvent) => {
            if (e.data.id !== id) return;
            worker.terminate();
            if (e.data.error) reject(new Error(e.data.error));
            else resolve({ project: e.data.project, store: e.data.store });
        };
        worker.onerror = (e) => {
            worker.terminate();
            reject(new Error(e.message || 'Project parser worker failed'));
        };
        worker.postMessage({ id, buffer }, [buffer]);
    });
}

async function parseOnMainThread(buffer: ArrayBuffer): Promise<ParsedProject> {
    const project = JSON.parse(await projectBytesToText(buffer));
    const store = datasetFromProject(project);
    if (project.appState) {
        delete project.appState.data;
        delete project.appState.dataset;
    }
    return { project, store };
}

/**
 * Files below this size parse faster on the main thread than it takes to
 * start a worker (a gzipped v4 file of 16k x 113 is ~1 MB and parses in
 * ~100 ms); large legacy JSON files go to the worker so the UI stays live.
 */
const WORKER_THRESHOLD_BYTES = 8 * 1024 * 1024;

/** Parse a .chem file (gzip or plain JSON, any version). */
export async function readProjectFile(file: Blob): Promise<ParsedProject> {
    const buffer = await file.arrayBuffer();
    if (typeof Worker !== 'undefined' && buffer.byteLength > WORKER_THRESHOLD_BYTES) {
        try {
            return await parseInWorker(buffer.slice(0));
        } catch (err) {
            console.warn('[projectIO] Worker parse failed, retrying on main thread:', err);
        }
    }
    return parseOnMainThread(buffer);
}

/** Serialise a project object to the on-disk form (gzip-compressed JSON). */
export function serializeProject(project: unknown): Promise<Blob> {
    return gzipString(JSON.stringify(project));
}

/**
 * Serialise a project whose dataset is still the live columnar store: the
 * dataset encoding, JSON and gzip run in the worker (the store is copied by
 * structured clone, which is far cheaper than stringifying on this thread).
 */
export async function serializeProjectWithStore(project: any, store: ColumnarStore, columnOrder: string[]): Promise<Blob> {
    if (typeof Worker !== 'undefined') {
        try {
            return await new Promise<Blob>((resolve, reject) => {
                const worker = new Worker(new URL('../workers/projectIO.worker.ts', import.meta.url), { type: 'module' });
                const id = nextId++;
                worker.onmessage = (e: MessageEvent) => {
                    if (e.data.id !== id) return;
                    worker.terminate();
                    if (e.data.error) reject(new Error(e.data.error));
                    else resolve(e.data.blob);
                };
                worker.onerror = (e) => {
                    worker.terminate();
                    reject(new Error(e.message || 'Project save worker failed'));
                };
                worker.postMessage({ id, kind: 'save', project, store, columnOrder });
            });
        } catch (err) {
            console.warn('[projectIO] Worker save failed, serialising on the main thread:', err);
        }
    }
    project.appState.dataset = encodeDataset(store, columnOrder);
    return serializeProject(project);
}
