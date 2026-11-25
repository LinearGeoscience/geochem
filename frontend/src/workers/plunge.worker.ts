/**
 * Web Worker that scans for the plunge of grade continuity (features/model/
 * plungeScan) off the main thread: it takes seconds. It tells how far it has
 * got as it goes; the page stops it by ending the worker.
 */
import { scanPlunge, type PlungeSamples } from '../features/model/plungeScan';

self.onmessage = (e: MessageEvent) => {
    const { id, samples, spacing } = e.data as { id: number; samples: PlungeSamples; spacing: number | null };
    const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);
    try {
        const result = scanPlunge(samples, { spacing, onProgress: (done, total) => post({ id, progress: done / total }) });
        const transfer = result.ok ? result.nets.flatMap(n => [n.ratio.buffer]) : [];
        post({ id, result }, transfer as Transferable[]);
    } catch (error: unknown) {
        post({ id, error: error instanceof Error ? error.message : 'The plunge scan failed' });
    }
};
