/**
 * Runs fit jobs in the surface Web Worker (main thread when there is none:
 * tests, or a worker that failed to start).
 *
 * Latest wins, per surface: while a surface's job is running, a newer request
 * for it waits, and replaces any request already waiting. A replaced request
 * resolves to null: its answer would be out of date before it was drawn.
 */
import { checkShell, type ShellCheck, type ShellCheckJob } from './holdout';
import { runFitJob, type FitJob, type FitOutput } from './surfaceJobs';

let worker: Worker | null = null;
let workerFailed = false;
let nextRequest = 0;
const pending = new Map<number, { resolve: (r: FitOutput) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
    if (worker || workerFailed) return worker;
    if (typeof Worker === 'undefined') {
        workerFailed = true;
        return null;
    }
    try {
        worker = new Worker(new URL('../../workers/surface.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (e: MessageEvent) => {
            const { id, result, error } = e.data;
            const p = pending.get(id);
            if (!p) return;
            pending.delete(id);
            if (error) p.reject(new Error(error));
            else p.resolve(result);
        };
        worker.onerror = () => {
            const waiting = [...pending.values()];
            pending.clear();
            worker?.terminate();
            worker = null;
            workerFailed = true;
            for (const p of waiting) p.reject(new Error('The surface worker stopped unexpectedly'));
        };
        return worker;
    } catch {
        workerFailed = true;
        return null;
    }
}

async function run(job: FitJob): Promise<FitOutput> {
    const w = getWorker();
    if (!w) return runFitJob(job);
    try {
        return await new Promise<FitOutput>((resolve, reject) => {
            const id = nextRequest++;
            pending.set(id, { resolve, reject });
            w.postMessage({ id, job });
        });
    } catch (e) {
        // The worker itself died (not a bad job): do it here
        if (workerFailed) return runFitJob(job);
        throw e;
    }
}

/** A check that another took the place of: its answer is not wanted */
export class CheckReplaced extends Error {}

/** The one check under way: it has a worker of its own, so that surfaces go on being fitted meanwhile */
let checking: { worker: Worker; reject: (e: Error) => void } | null = null;

/**
 * Check a shell against holes left out of its fit (holdout.ts): several
 * fits, off the main thread when there can be a worker. `onRound` is told
 * as each is done. One check at a time: a new one stops the one under way,
 * which is rejected with CheckReplaced.
 */
export function requestCheck(job: ShellCheckJob, onRound?: (done: number, of: number) => void): Promise<ShellCheck | null> {
    if (checking) {
        checking.worker.terminate();
        checking.reject(new CheckReplaced());
        checking = null;
    }
    let w: Worker | null = null;
    if (typeof Worker !== 'undefined' && !workerFailed) {
        try {
            w = new Worker(new URL('../../workers/surface.worker.ts', import.meta.url), { type: 'module' });
        } catch {
            w = null;
        }
    }
    if (!w) return new Promise(resolve => resolve(checkShell(job, onRound)));
    const mine = w;
    return new Promise<ShellCheck | null>((resolve, reject) => {
        const done = () => {
            mine.terminate();
            if (checking?.worker === mine) checking = null;
        };
        checking = { worker: mine, reject };
        mine.onmessage = (e: MessageEvent) => {
            const { result, error, progress } = e.data;
            // Part-way through: more is to come
            if (progress) {
                onRound?.(progress[0], progress[1]);
                return;
            }
            done();
            if (error) reject(new Error(error));
            else resolve(result);
        };
        mine.onerror = () => {
            done();
            reject(new Error('The check stopped unexpectedly'));
        };
        mine.postMessage({ id: 0, check: job });
    });
}

interface Slot {
    running: boolean;
    waiting: { job: FitJob; resolve: (r: FitOutput | null) => void; reject: (e: Error) => void } | null;
}
const slots = new Map<string, Slot>();

/** Fit a surface. Null when a newer request for the same surface took its place. */
export function requestFit(surfaceId: string, job: FitJob): Promise<FitOutput | null> {
    let slot = slots.get(surfaceId);
    if (!slot) {
        slot = { running: false, waiting: null };
        slots.set(surfaceId, slot);
    }
    const s = slot;
    return new Promise<FitOutput | null>((resolve, reject) => {
        if (s.running) {
            s.waiting?.resolve(null);
            s.waiting = { job, resolve, reject };
            return;
        }
        const start = (j: FitJob, res: (r: FitOutput | null) => void, rej: (e: Error) => void) => {
            s.running = true;
            run(j).then(res, rej).finally(() => {
                s.running = false;
                const next = s.waiting;
                s.waiting = null;
                if (next) start(next.job, next.resolve, next.reject);
                else slots.delete(surfaceId);
            });
        };
        start(job, resolve, reject);
    });
}
