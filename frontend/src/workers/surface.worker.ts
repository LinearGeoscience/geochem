/**
 * Web Worker that fits and meshes surfaces off the main thread, so the 3D
 * view stays responsive while a large surface is worked out. The maths lives
 * in features/model — nothing is duplicated.
 *
 * A fit that wants many blocks at once shares them with helper workers
 * (features/model/blockHelpers): `helpers` in the message says how many it
 * may start.
 *
 * It also checks a shell against holes left out of its fit
 * (features/model/holdout): several fits in a row, reported as they go; and
 * builds a geological model from fitted surfaces (`model` in the message).
 */
import { fitBlocksShared } from '../features/model/blockHelpers';
import { runModelJob, type ModelJob } from '../features/model/geoModelJobs';
import { checkShell, type ShellCheckJob } from '../features/model/holdout';
import { runFitJob, runFitJobShared, type FitJob, type FitOutput } from '../features/model/surfaceJobs';

const post = (message: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(message, transfer);

self.onmessage = async (e: MessageEvent) => {
    const { id, job, check, helpers, model } = e.data as { id: number; job?: FitJob; check?: ShellCheckJob; helpers?: number; model?: ModelJob };
    try {
        // A geological model built from fitted surfaces (features/model/geoModelJobs)
        if (model) {
            const built = runModelJob(model, (done, of, step) => post({ id, progress: [done, of], step }));
            post({ id, result: built }, [built.vertices.buffer, built.triangles.buffer, built.a.buffer, built.b.buffer, built.on.buffer]);
            return;
        }
        if (check) {
            post({ id, result: checkShell(check, (done, of) => post({ id, progress: [done, of] })) });
            return;
        }
        const result: FitOutput = helpers && helpers > 0
            // (Told as its blocks come back from the helpers: how many so far, and which pass over the logging it is on)
            ? await runFitJobShared(job!, tasks => fitBlocksShared(tasks, helpers), undefined, (blocks, fits) => post({ id, progress: [blocks, 0], step: fits > 0 ? `blocks fitted, pass ${fits + 1}` : 'blocks fitted' }))
            : runFitJob(job!);
        // Hand the mesh and the fitted field over without copying
        const transfer: Transferable[] = result.ok
            ? [result.vertices.buffer, result.triangles.buffer, result.field.centres.buffer, result.field.weights.buffer]
            : [];
        post({ id, result }, transfer);
    } catch (error: unknown) {
        post({ id, error: error instanceof Error ? error.message : 'The surface could not be worked out' });
    }
};
