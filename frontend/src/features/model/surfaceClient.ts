/**
 * Runs fit jobs in the surface Web Workers (main thread when there is none:
 * tests, or a worker that failed to start).
 *
 * The jobs wait here, not in the workers: a worker is sent one job at a
 * time, when it is free. So what waits can still be changed. Latest wins,
 * per surface: a newer request for a surface takes the place of one still
 * waiting its turn, and while a surface's job is being worked out a newer
 * request waits for it, replacing any already waiting. A replaced request
 * resolves to null and is never worked out: its answer would be out of date
 * before it was drawn.
 *
 * Of those waiting, the ones the user is working on go first (`urgent`: a
 * surface that had a fit and has been changed), then the rest in the order
 * they were asked for (a project just opened).
 */
import { helperCount } from './blockHelpers';
import { checkShell, type ShellCheck, type ShellCheckJob } from './holdout';
import { runFitJob, type FitJob, type FitOutput } from './surfaceJobs';

/** The cores there are (4 when it cannot be told) */
const cores = () => (typeof navigator !== 'undefined' && navigator.hardwareConcurrency > 0 ? navigator.hardwareConcurrency : 4);
/** Surface workers: two where there are cores enough, so that one big surface does not hold up the rest */
export const surfaceWorkerCount = (n: number) => (n >= 6 ? 2 : 1);

/** How a fit is asked for */
export interface FitAsk {
    /** It is of a surface the user is working on: before those that have never been fitted */
    urgent?: boolean;
    /** Told when it is sent to be worked out: until then it is waiting its turn */
    onStart?: () => void;
    /** Told how far it has got: this many (of that many, 0 when it cannot be told) of what */
    onProgress?: (done: number, of: number, step: string | null) => void;
}

interface Entry {
    surfaceId: string;
    job: FitJob;
    ask: FitAsk;
    /** The order asked in */
    seq: number;
    resolve: (r: FitOutput | null) => void;
    reject: (e: Error) => void;
}

interface SurfaceWorker {
    worker: Worker;
    /** The one job it is working out */
    doing: { id: number; entry: Entry } | null;
}

const workers: (SurfaceWorker | null)[] = [];
/** No worker can be had: everything is worked out on this thread */
let workerFailed = false;
/** A worker has answered at least once: workers do work here */
let proven = false;
/** Workers that have died one after another with no answer between (a third, and no more are started) */
let deaths = 0;
const MOST_DEATHS = 3;
let nextRequest = 0;
let nextSeq = 0;
/** Asked for and not yet sent to be worked out */
const queue: Entry[] = [];
/** The job of each surface that is being worked out */
const posted = new Map<string, Entry>();
/** For a surface whose job is being worked out: the newest request made since */
const after = new Map<string, Entry>();
/**
 * The worker each surface was last fitted in: it is fitted there again, as
 * its blocks and its last mesh are kept there (the last few hundred surfaces)
 */
const homes = new Map<string, number>();
const KEPT_HOMES = 500;

/** How many fits are waiting their turn (not yet being worked out) */
export const waitingFits = (): number => queue.length + after.size;

/**
 * One job is over: what was asked of its surface meanwhile takes its turn, and the next is sent. (`soon`: a moment
 * later, once whoever asked for the job has its answer, so that the next is not begun before this one is seen to end.)
 */
const soon = (entry: Entry): void => queueMicrotask(() => finish(entry));
function finish(entry: Entry): void {
    if (posted.get(entry.surfaceId) === entry) posted.delete(entry.surfaceId);
    const next = after.get(entry.surfaceId);
    if (next && !posted.has(entry.surfaceId)) {
        after.delete(entry.surfaceId);
        queue.push(next);
    }
    pump();
}

/** Worked out on this thread: the answer is handed over a moment later, as a worker's is */
function runHere(entry: Entry): void {
    posted.set(entry.surfaceId, entry);
    entry.ask.onStart?.();
    let out: FitOutput | null = null, failed: Error | null = null;
    try {
        out = runFitJob(entry.job);
    } catch (e) {
        failed = e instanceof Error ? e : new Error('The surface could not be worked out');
    }
    void Promise.resolve().then(() => {
        if (failed) entry.reject(failed); else entry.resolve(out);
        soon(entry);
    });
}

function startWorker(at: number): SurfaceWorker | null {
    try {
        const worker = new Worker(new URL('../../workers/surface.worker.ts', import.meta.url), { type: 'module' });
        const w: SurfaceWorker = { worker, doing: null };
        worker.onmessage = (e: MessageEvent) => {
            const { id, result, error, progress, step } = e.data;
            const doing = w.doing;
            if (!doing || doing.id !== id) return;
            // Part-way through: more is to come
            if (progress) {
                doing.entry.ask.onProgress?.(progress[0], progress[1], step ?? null);
                return;
            }
            w.doing = null;
            proven = true;
            deaths = 0;
            if (error) doing.entry.reject(new Error(error));
            else doing.entry.resolve(result);
            soon(doing.entry);
        };
        worker.onerror = () => {
            const doing = w.doing;
            w.doing = null;
            worker.terminate();
            workers[at] = null;
            // (The surfaces fitted there are fitted afresh elsewhere)
            for (const [id, home] of homes) if (home === at) homes.delete(id);
            // One that never answered cannot be had at all (it would not load); one that had been working died of its job,
            // and another is started for the next, unless they go on dying
            deaths++;
            if (workers.every(x => !x) && (!proven || deaths >= MOST_DEATHS)) workerFailed = true;
            if (doing) {
                // No worker can be had: its job is done here. Else the job is the one that stopped it, and says so
                if (workerFailed) { posted.delete(doing.entry.surfaceId); runHere(doing.entry); return; }
                doing.entry.reject(new Error('The surface worker stopped unexpectedly'));
                soon(doing.entry);
            } else pump();
        };
        workers[at] = w;
        return w;
    } catch {
        return null;
    }
}

/** Those the user is working on first, then the order asked in */
const before = (a: Entry, b: Entry) => (a.ask.urgent ? 0 : 1) - (b.ask.urgent ? 0 : 1) || a.seq - b.seq;

/**
 * The job in the queue that worker `at`, now free, is to have: the first
 * whose surface was last fitted there, or nowhere, or in a worker that is
 * gone. With none of those, the first of those whose own worker is busy:
 * better fitted afresh now than left to wait. (One whose own worker is free
 * is left for that worker.)
 */
function pickFor(at: number): number {
    let own = -1, other = -1;
    queue.forEach((entry, k) => {
        const home = homes.get(entry.surfaceId);
        if (home === undefined || home === at || !workers[home]) {
            if (own < 0 || before(entry, queue[own]) < 0) own = k;
        } else if (workers[home]!.doing && (other < 0 || before(entry, queue[other]) < 0)) other = k;
    });
    return own >= 0 ? own : other;
}

/** Send what is waiting to whatever is free to work it out */
function pump(): void {
    if (queue.length === 0) return;
    if (typeof Worker === 'undefined') workerFailed = true;
    if (workerFailed) {
        while (queue.length > 0) {
            let first = 0;
            for (let k = 1; k < queue.length; k++) if (before(queue[k], queue[first]) < 0) first = k;
            runHere(queue.splice(first, 1)[0]);
        }
        return;
    }
    const most = surfaceWorkerCount(cores());
    // (A worker that is there and free, before one that has yet to be started)
    const order = Array.from({ length: most }, (_, k) => k).sort((a, b) => (workers[a] ? 0 : 1) - (workers[b] ? 0 : 1) || a - b);
    for (const at of order) {
        if (queue.length === 0) return;
        if (workers[at]?.doing) continue;
        const pick = pickFor(at);
        if (pick < 0) continue;
        const w = workers[at] ?? startWorker(at);
        if (!w) {
            if (workers.every(x => !x)) { workerFailed = true; pump(); return; }
            continue;
        }
        const entry = queue.splice(pick, 1)[0];
        const id = nextRequest++;
        w.doing = { id, entry };
        posted.set(entry.surfaceId, entry);
        homes.delete(entry.surfaceId);
        homes.set(entry.surfaceId, at);
        if (homes.size > KEPT_HOMES) homes.delete(homes.keys().next().value!);
        entry.ask.onStart?.();
        w.worker.postMessage({ id, job: entry.job, helpers: helperCount(cores(), surfaceWorkerCount(cores())) });
    }
}

/** A fit that was stopped while it was being worked out (`stopFit`) */
export class FitStopped extends Error {}

/**
 * Stop the fit of a surface. One waiting its turn is taken out of the queue (its request resolves to null, as one
 * replaced does); one being worked out in a worker is ended with its worker (its request is rejected with
 * FitStopped), and another worker is started when the next job wants one: what that worker kept of other surfaces
 * is fitted afresh. Returns which it was; null when there was nothing to stop, or it is being worked out on this
 * thread, where it is over before anything can stop it.
 */
export function stopFit(surfaceId: string): 'waiting' | 'running' | null {
    let found: 'waiting' | 'running' | null = null;
    const next = after.get(surfaceId);
    if (next) { after.delete(surfaceId); next.resolve(null); found = 'waiting'; }
    const at = queue.findIndex(e => e.surfaceId === surfaceId);
    if (at >= 0) { queue.splice(at, 1)[0].resolve(null); found = 'waiting'; }
    const k = workers.findIndex(w => w?.doing?.entry.surfaceId === surfaceId);
    if (k < 0) return found;
    const w = workers[k]!, entry = w.doing!.entry;
    w.doing = null;
    w.worker.terminate();
    workers[k] = null;
    for (const [id, home] of homes) if (home === k) homes.delete(id);
    entry.reject(new FitStopped('The fit was stopped'));
    soon(entry);
    return 'running';
}

/** A check that was stopped (`stopCheck`) */
export class CheckStopped extends Error {}

/** Stop the check under way, if it is in a worker. False: there is none, or it is being made on this thread. */
export function stopCheck(): boolean {
    if (!checking) return false;
    checking.worker.terminate();
    checking.reject(new CheckStopped('The check was stopped'));
    checking = null;
    return true;
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

/** Fit a surface. Null when a newer request for the same surface took its place. */
export function requestFit(surfaceId: string, job: FitJob, ask: FitAsk = {}): Promise<FitOutput | null> {
    return new Promise<FitOutput | null>((resolve, reject) => {
        const entry: Entry = { surfaceId, job, ask, seq: nextSeq++, resolve, reject };
        // Its job is being worked out: this waits for that, in place of any request already waiting
        if (posted.has(surfaceId)) {
            after.get(surfaceId)?.resolve(null);
            after.set(surfaceId, entry);
            return;
        }
        // One still waiting its turn: this takes its place, and that one is never worked out
        const at = queue.findIndex(e => e.surfaceId === surfaceId);
        if (at >= 0) queue.splice(at, 1)[0].resolve(null);
        queue.push(entry);
        pump();
    });
}
