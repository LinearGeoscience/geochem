/**
 * Reading wireframe files (in a Web Worker, workers/wireframe.worker.ts, with
 * a main-thread fallback), and where a wireframe lies against the data.
 *
 * Which wireframes are shown is part of the project's scene
 * (store/modelStore); their files and meshes are looked after by
 * features/model/wireframeFiles.
 */
import type { ParsedWireframe, WireframeBounds } from './wireframeParsers';

let worker: Worker | null = null;
let workerFailed = false;
const pending = new Map<number, { resolve: (r: ParsedWireframe) => void; reject: (e: Error) => void }>();
let nextRequest = 0;

function getWorker(): Worker | null {
    if (worker || workerFailed) return worker;
    try {
        worker = new Worker(new URL('../../../workers/wireframe.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (e: MessageEvent) => {
            const { id, result, error } = e.data;
            const p = pending.get(id);
            if (!p) return;
            pending.delete(id);
            if (error) p.reject(new Error(error));
            else p.resolve(result);
        };
        worker.onerror = () => {
            for (const p of pending.values()) p.reject(new Error('The wireframe reader stopped unexpectedly'));
            pending.clear();
            worker?.terminate();
            worker = null;
            workerFailed = true;
        };
        return worker;
    } catch {
        workerFailed = true;
        return null;
    }
}

async function parseOnMainThread(name: string, blob: Blob): Promise<ParsedWireframe> {
    const { parseWireframe } = await import('./wireframeParsers');
    return parseWireframe(name, await blob.arrayBuffer());
}

/** Read a wireframe file's contents; `name` tells its kind (.msh, .dxf, ...). */
export async function parseWireframeBlob(name: string, blob: Blob): Promise<ParsedWireframe> {
    const w = getWorker();
    if (!w) return parseOnMainThread(name, blob);
    const buffer = await blob.arrayBuffer();
    try {
        return await new Promise<ParsedWireframe>((resolve, reject) => {
            const id = nextRequest++;
            pending.set(id, { resolve, reject });
            w.postMessage({ id, name, buffer }, [buffer]);
        });
    } catch (e) {
        // The worker itself died (not a file error): read the file again here
        if (workerFailed) return parseOnMainThread(name, blob);
        throw e;
    }
}

/** World bounds of several boxes (null when empty). */
export function unionBounds(boxes: WireframeBounds[]): WireframeBounds | null {
    if (boxes.length === 0) return null;
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const b of boxes) {
        for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], b.min[k]);
            max[k] = Math.max(max[k], b.max[k]);
        }
    }
    return { min, max };
}

/**
 * Plan-view distance (m) between a wireframe and the data, 0 when their
 * extents overlap (with a margin) — a large gap usually means a different
 * coordinate system (e.g. local mine grid vs MGA).
 */
export function planGap(a: WireframeBounds, b: { min: number[]; max: number[] }): number {
    const margin = 0.1 * Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], 1);
    const dx = Math.max(0, a.min[0] - (b.max[0] + margin), (b.min[0] - margin) - a.max[0]);
    const dy = Math.max(0, a.min[1] - (b.max[1] + margin), (b.min[1] - margin) - a.max[1]);
    return Math.hypot(dx, dy);
}
