/**
 * Hook to compute IDW interpolation via Web Worker (off main thread).
 * Falls back to synchronous computation if workers aren't available.
 */
import { useRef, useCallback, useEffect } from 'react';
import type { IDWPoint, IDWOptions, IDWGridResult } from '../utils/idwInterpolation';

let workerInstance: Worker | null = null;
const workerCallbacks = new Map<number, (result: IDWGridResult | null) => void>();
let nextId = 0;

function getWorker(): Worker | null {
    if (workerInstance) return workerInstance;
    try {
        workerInstance = new Worker(
            new URL('../workers/idw.worker.ts', import.meta.url),
            { type: 'module' }
        );
        workerInstance.onmessage = (e: MessageEvent) => {
            const { id, result, error } = e.data;
            const cb = workerCallbacks.get(id);
            if (cb) {
                workerCallbacks.delete(id);
                if (error) {
                    console.warn('[idwWorker] Error:', error);
                    cb(null);
                } else {
                    cb(result);
                }
            }
        };
        // A worker that fails to load or crashes never answers: settle what is
        // pending and start a fresh worker next time, instead of spinning forever
        const failed = workerInstance;
        const onFail = (e: Event) => {
            console.warn('[idwWorker] failed:', (e as ErrorEvent).message ?? e.type);
            for (const cb of workerCallbacks.values()) cb(null);
            workerCallbacks.clear();
            failed.terminate();
            if (workerInstance === failed) workerInstance = null;
        };
        workerInstance.onerror = onFail;
        workerInstance.onmessageerror = onFail;
        return workerInstance;
    } catch {
        return null;
    }
}

export function useIDWWorker() {
    const pendingId = useRef<number | null>(null);

    const computeIDW = useCallback((
        points: IDWPoint[],
        options?: IDWOptions
    ): Promise<IDWGridResult | null> => {
        return new Promise((resolve) => {
            const worker = getWorker();
            if (!worker) {
                // Fallback: synchronous
                import('../utils/idwInterpolation').then(mod => {
                    resolve(mod.computeIDWGrid(points, options));
                });
                return;
            }

            // Cancel previous pending request
            if (pendingId.current !== null) {
                const prevCb = workerCallbacks.get(pendingId.current);
                if (prevCb) prevCb(null);
                workerCallbacks.delete(pendingId.current);
            }

            const id = nextId++;
            pendingId.current = id;
            workerCallbacks.set(id, resolve);
            worker.postMessage({ id, points, options });
        });
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (pendingId.current !== null) {
                const cb = workerCallbacks.get(pendingId.current);
                if (cb) cb(null);
                workerCallbacks.delete(pendingId.current);
            }
        };
    }, []);

    return { computeIDW };
}
