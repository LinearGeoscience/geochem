/**
 * Promise API over the analysis web worker. Tasks are defined once in
 * utils/analysisTasks.ts (PCA, clustering, anomaly detection, population
 * separation, robust regression, vectoring).
 *
 * Usable from components AND store actions (not a hook). Falls back to
 * running on the main thread when Workers are unavailable (e.g. tests).
 */
import type { AnalysisKind } from './analysisTasks';

export type { AnalysisKind };

/**
 * Slim rows to the columns a task needs — row objects carry every column,
 * and structured-cloning 16k x 100+ rows to a worker would cost more than
 * the task itself.
 */
export function pickColumns(rows: Record<string, any>[], columns: (string | undefined | null)[]): Record<string, any>[] {
    const cols = [...new Set(columns.filter((c): c is string => !!c))];
    const out = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
        const src = rows[i];
        const row: Record<string, any> = {};
        for (const c of cols) row[c] = src[c];
        out[i] = row;
    }
    return out;
}

let workerInstance: Worker | null = null;
let workerFailed = false;
const callbacks = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
let nextId = 0;

function getWorker(): Worker | null {
    if (workerFailed) return null;
    if (workerInstance) return workerInstance;
    try {
        workerInstance = new Worker(
            new URL('../workers/analysis.worker.ts', import.meta.url),
            { type: 'module' }
        );
        workerInstance.onmessage = (e: MessageEvent) => {
            const { id, result, error } = e.data;
            const cb = callbacks.get(id);
            if (cb) {
                callbacks.delete(id);
                if (error) cb.reject(new Error(error));
                else cb.resolve(result);
            }
        };
        workerInstance.onerror = (e) => {
            console.warn('[analysisWorker] Worker error, falling back to main thread:', e.message);
            workerFailed = true;
            for (const cb of callbacks.values()) cb.reject(new Error('Analysis worker crashed'));
            callbacks.clear();
            workerInstance?.terminate();
            workerInstance = null;
        };
        return workerInstance;
    } catch {
        workerFailed = true;
        return null;
    }
}

async function runOnMainThread(kind: AnalysisKind, payload: any): Promise<any> {
    // Same task table the worker uses (lazy, keeps the main chunk light)
    const { runAnalysisTask } = await import('./analysisTasks');
    return runAnalysisTask(kind, payload);
}

/** Run an analysis off the main thread (or synchronously if workers are unavailable). */
export function analysisInWorker<T = any>(kind: AnalysisKind, payload: any): Promise<T> {
    const worker = getWorker();
    if (!worker) return runOnMainThread(kind, payload);

    return new Promise<T>((resolve, reject) => {
        const id = nextId++;
        callbacks.set(id, { resolve, reject });
        worker.postMessage({ id, kind, payload });
    });
}
