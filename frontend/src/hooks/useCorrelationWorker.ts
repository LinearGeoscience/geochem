/**
 * Hook to compute correlation matrix via Web Worker (off main thread).
 * Falls back to synchronous computation if workers aren't available.
 */
import { useRef, useCallback, useEffect } from 'react';

interface CorrelationResult {
    matrix: number[][];
    pValues: number[][];
    sampleCounts: number[][];
}

let workerInstance: Worker | null = null;
const workerCallbacks = new Map<number, {
    resolve: (result: CorrelationResult | null) => void;
    onProgress?: (progress: number) => void;
}>();
let nextId = 0;

function getWorker(): Worker | null {
    if (workerInstance) return workerInstance;
    try {
        workerInstance = new Worker(
            new URL('../workers/correlation.worker.ts', import.meta.url),
            { type: 'module' }
        );
        workerInstance.onmessage = (e: MessageEvent) => {
            const { id, result, error, progress } = e.data;
            const cb = workerCallbacks.get(id);
            if (!cb) return;

            if (progress !== undefined) {
                cb.onProgress?.(progress);
                return;
            }

            workerCallbacks.delete(id);
            if (error) {
                console.warn('[correlationWorker] Error:', error);
                cb.resolve(null);
            } else {
                cb.resolve(result);
            }
        };
        // A worker that fails to load or crashes never answers: settle what is
        // pending and start a fresh worker next time, instead of spinning forever
        const failed = workerInstance;
        const onFail = (e: Event) => {
            console.warn('[correlationWorker] failed:', (e as ErrorEvent).message ?? e.type);
            for (const cb of workerCallbacks.values()) cb.resolve(null);
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

export function useCorrelationWorker() {
    const pendingId = useRef<number | null>(null);

    const computeCorrelation = useCallback((
        columnNames: string[],
        columnData: Record<string, number[]>,
        method: 'pearson' | 'spearman',
        onProgress?: (progress: number) => void
    ): Promise<CorrelationResult | null> => {
        return new Promise((resolve) => {
            const worker = getWorker();
            if (!worker) {
                // No worker available — caller should fall back to sync computation
                resolve(null);
                return;
            }

            // Cancel previous pending request
            if (pendingId.current !== null) {
                const prevCb = workerCallbacks.get(pendingId.current);
                if (prevCb) prevCb.resolve(null);
                workerCallbacks.delete(pendingId.current);
            }

            const id = nextId++;
            pendingId.current = id;
            workerCallbacks.set(id, { resolve, onProgress });
            worker.postMessage({ columnNames, columnData, method, id });
        });
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (pendingId.current !== null) {
                const cb = workerCallbacks.get(pendingId.current);
                if (cb) cb.resolve(null);
                workerCallbacks.delete(pendingId.current);
            }
        };
    }, []);

    return { computeCorrelation };
}
