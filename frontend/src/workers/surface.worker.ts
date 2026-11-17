/**
 * Web Worker that fits and meshes surfaces off the main thread, so the 3D
 * view stays responsive while a large surface is worked out. The maths lives
 * in features/model — nothing is duplicated.
 *
 * It also checks a shell against holes left out of its fit
 * (features/model/holdout): several fits in a row, reported as they go.
 */
import { checkShell, type ShellCheckJob } from '../features/model/holdout';
import { runFitJob, type FitJob } from '../features/model/surfaceJobs';

const post = (message: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(message, transfer);

self.onmessage = (e: MessageEvent) => {
    const { id, job, check } = e.data as { id: number; job?: FitJob; check?: ShellCheckJob };
    try {
        if (check) {
            post({ id, result: checkShell(check, (done, of) => post({ id, progress: [done, of] })) });
            return;
        }
        const result = runFitJob(job!);
        // Hand the mesh and the fitted field over without copying
        const transfer: Transferable[] = result.ok
            ? [result.vertices.buffer, result.triangles.buffer, result.field.centres.buffer, result.field.weights.buffer]
            : [];
        post({ id, result }, transfer);
    } catch (error: unknown) {
        post({ id, error: error instanceof Error ? error.message : 'The surface could not be worked out' });
    }
};
