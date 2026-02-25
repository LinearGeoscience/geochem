/**
 * Hook to compute density via Web Worker (off main thread).
 * Falls back to synchronous computation if workers aren't available.
 */
import { useRef, useCallback, useEffect } from 'react';
import type { DensityGridOptions, PointDensityResult } from '../utils/densityGrid';

let workerInstance: Worker | null = null;
let workerCallbacks = new Map<number, (result: PointDensityResult | null) => void>();
let nextId = 0;

function getWorker(): Worker | null {
    if (workerInstance) return workerInstance;
    try {
        workerInstance = new Worker(
            new URL('../workers/density.worker.ts', import.meta.url),
            { type: 'module' }
        );
        workerInstance.onmessage = (e: MessageEvent) => {
            const { id, result, error } = e.data;
            const cb = workerCallbacks.get(id);
            if (cb) {
                workerCallbacks.delete(id);
                if (error) {
                    console.warn('[densityWorker] Error:', error);
                    cb(null);
                } else {
                    cb(result);
                }
            }
        };
        return workerInstance;
    } catch {
        return null;
    }
}

export function useDensityWorker() {
    // Separate pending IDs for scatter vs ternary to avoid cross-cancellation
    const pendingPointId = useRef<number | null>(null);
    const pendingTernaryId = useRef<number | null>(null);

    const computePointDensities = useCallback((
        xValues: number[],
        yValues: number[],
        options?: DensityGridOptions
    ): Promise<PointDensityResult | null> => {
        return new Promise((resolve) => {
            const worker = getWorker();
            if (!worker) {
                // Fallback: synchronous (import lazily to avoid circular deps)
                import('../utils/densityGrid').then(mod => {
                    resolve(mod.computePointDensities(xValues, yValues, options));
                });
                return;
            }

            // Cancel previous pending request and resolve it with null
            if (pendingPointId.current !== null) {
                const prevCb = workerCallbacks.get(pendingPointId.current);
                if (prevCb) prevCb(null);
                workerCallbacks.delete(pendingPointId.current);
            }

            const id = nextId++;
            pendingPointId.current = id;
            workerCallbacks.set(id, resolve);
            worker.postMessage({ type: 'pointDensities', xValues, yValues, options, id });
        });
    }, []);

    const computeTernaryDensities = useCallback((
        aValues: number[],
        bValues: number[],
        cValues: number[],
        options?: DensityGridOptions
    ): Promise<PointDensityResult | null> => {
        return new Promise((resolve) => {
            const worker = getWorker();
            if (!worker) {
                import('../utils/densityGrid').then(mod => {
                    resolve(mod.computeTernaryDensities(aValues, bValues, cValues, options));
                });
                return;
            }

            // Cancel previous pending request and resolve it with null
            if (pendingTernaryId.current !== null) {
                const prevCb = workerCallbacks.get(pendingTernaryId.current);
                if (prevCb) prevCb(null);
                workerCallbacks.delete(pendingTernaryId.current);
            }

            const id = nextId++;
            pendingTernaryId.current = id;
            workerCallbacks.set(id, resolve);
            worker.postMessage({ type: 'ternaryDensities', aValues, bValues, cValues, options, id });
        });
    }, []);

    // Cleanup on unmount — resolve any pending callbacks with null
    useEffect(() => {
        return () => {
            if (pendingPointId.current !== null) {
                const cb = workerCallbacks.get(pendingPointId.current);
                if (cb) cb(null);
                workerCallbacks.delete(pendingPointId.current);
            }
            if (pendingTernaryId.current !== null) {
                const cb = workerCallbacks.get(pendingTernaryId.current);
                if (cb) cb(null);
                workerCallbacks.delete(pendingTernaryId.current);
            }
        };
    }, []);

    return { computePointDensities, computeTernaryDensities };
}
