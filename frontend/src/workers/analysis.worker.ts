/**
 * Web Worker for heavy statistical analysis (PCA, clustering, anomaly
 * detection, population separation, robust regression, vectoring).
 *
 * Vite module worker: dispatches to the REAL implementations through the
 * shared task table (utils/analysisTasks.ts), which gets bundled into the
 * worker chunk — no math is duplicated here.
 */
import { runAnalysisTask, AnalysisKind } from '../utils/analysisTasks';

self.onmessage = (e: MessageEvent<{ id: number; kind: AnalysisKind; payload: unknown }>) => {
    const { id, kind, payload } = e.data;
    try {
        const result = runAnalysisTask(kind, payload);
        (self as unknown as Worker).postMessage({ id, result });
    } catch (err) {
        (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
    }
};
