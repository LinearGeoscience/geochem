/**
 * What is being worked out, and what just was.
 *
 * Every fit of a surface, build of a geological model and check against
 * holes says here when it is asked for, when it starts, how far it has got
 * and how it ended. Nothing is run from here: this is the one place that
 * knows whether anything is still to come, for the list in the Modelling
 * toolbar (features/modelling/JobsMenu) and for whatever has to wait until
 * the scene has settled (`whenIdle`: tests, probes, a report that needs the
 * model as it will be).
 */
import { create } from 'zustand';

export type JobKind = 'surface' | 'model' | 'check';

/** waiting = asked for and not begun; stopped = ended by the user before it was done */
export type JobState = 'waiting' | 'running' | 'done' | 'failed' | 'stopped';

export interface Job {
    id: number;
    kind: JobKind;
    /** The object it is of, as a key of the project tree (objectKeys.ts) */
    object: string;
    /** The object's name when this was asked for */
    name: string;
    /** What is being done to it, to read after its name ("fit", "draft", "build", "check against holes left out") */
    what: string;
    state: JobState;
    /** When it was asked for, begun and ended, ms since 1970 */
    asked: number;
    started: number | null;
    ended: number | null;
    /** How far it has got: this many of that many, and of what ("blocks", "rounds") */
    progress: [number, number] | null;
    step: string | null;
    /** Failed: why, in words */
    error: string | null;
    /** It can be stopped before it is done (`stopJob`) */
    canStop: boolean;
}

/** This many ended jobs are kept to look back at */
export const KEPT_JOBS = 30;

interface JobsState {
    /** Those waiting or running, in the order they were asked for; then those ended, the latest first */
    jobs: Job[];
}

export const useJobs = create<JobsState>()(() => ({ jobs: [] }));

const live = (j: Job) => j.state === 'waiting' || j.state === 'running';
export const activeJobs = (jobs: readonly Job[]): Job[] => jobs.filter(live);
export const endedJobs = (jobs: readonly Job[]): Job[] => jobs.filter(j => !live(j));

let nextId = 1;
/** How to stop each of those that can be stopped */
const stoppers = new Map<number, () => void>();
const change = (id: number, with_: (job: Job) => Job | null) => useJobs.setState(s => {
    const at = s.jobs.findIndex(j => j.id === id);
    if (at < 0) return s;
    const next = with_(s.jobs[at]);
    if (next === s.jobs[at]) return s;
    const rest = s.jobs.filter((_, k) => k !== at);
    if (!next) return { jobs: rest };
    if (live(next)) return { jobs: s.jobs.map((j, k) => (k === at ? next : j)) };
    // Ended: it heads those ended, of which the oldest go
    const active = rest.filter(live), ended = rest.filter(j => !live(j));
    return { jobs: [...active, next, ...ended].slice(0, active.length + KEPT_JOBS) };
});

/**
 * Something has been asked for. `waiting`: it has not begun (it is in a queue, or waits for a pause: `step` says
 * which); else it is under way. `stop`: what stops it, for one that can be stopped (whoever stops it then ends it
 * as 'stopped'). Returns its id.
 */
export function beginJob(init: { kind: JobKind; object: string; name: string; what: string; waiting?: boolean; step?: string; stop?: () => void }): number {
    const id = nextId++;
    const now = Date.now();
    const job: Job = {
        id, kind: init.kind, object: init.object, name: init.name, what: init.what,
        state: init.waiting ? 'waiting' : 'running', asked: now, started: init.waiting ? null : now, ended: null, progress: null, step: init.step ?? null, error: null,
        canStop: !!init.stop,
    };
    if (init.stop) stoppers.set(id, init.stop);
    useJobs.setState(s => {
        const active = s.jobs.filter(live);
        return { jobs: [...active, job, ...s.jobs.filter(j => !live(j))] };
    });
    return id;
}

/** One that was waiting has begun */
export function startJob(id: number): void {
    change(id, job => (job.state === 'waiting' ? { ...job, state: 'running', started: Date.now(), step: null } : job));
}

/** How far one under way has got */
export function progressJob(id: number, done: number, of: number, step: string | null = null): void {
    change(id, job => (!live(job) || (job.progress && job.progress[0] === done && job.progress[1] === of && job.step === step) ? job : { ...job, progress: [done, of], step }));
}

/**
 * One has ended. 'replaced': something newer was asked for in its place
 * before it was done, and it is forgotten rather than listed (an edit made
 * while a surface is being fitted is not a fit that failed).
 */
export function endJob(id: number, how: 'done' | 'failed' | 'stopped' | 'replaced', error: string | null = null): void {
    stoppers.delete(id);
    change(id, job => (!live(job) ? job : how === 'replaced' ? null : { ...job, state: how, ended: Date.now(), canStop: false, error: how === 'failed' ? error ?? 'It could not be worked out.' : null }));
}

/**
 * Stop one that is waiting or under way, if it can be stopped. What it was working out stays as it was before, and
 * waits to be asked for again. False: it cannot be stopped, or has ended.
 */
export function stopJob(id: number): boolean {
    const stop = stoppers.get(id);
    if (!stop) return false;
    stop();
    return true;
}

/** Stop every one that can be stopped. Returns how many were. */
export function stopAllJobs(): number {
    let stopped = 0;
    for (const id of [...stoppers.keys()]) if (stopJob(id)) stopped++;
    return stopped;
}

/** Forget those that have ended */
export function clearEndedJobs(): void {
    useJobs.setState(s => (s.jobs.every(live) ? s : { jobs: s.jobs.filter(live) }));
}

/** Things that are not jobs but mean one is to come (a fit waiting for a pause in the editing) */
const holds = new Set<symbol>();
/** Something is to come that is not yet a job. Call what is returned when it has come, or will not. */
export function holdBusy(): () => void {
    const mine = Symbol('hold');
    holds.add(mine);
    return () => { holds.delete(mine); };
}

/** Nothing is waiting or under way, and nothing is known to be coming */
export function isIdle(): boolean {
    return holds.size === 0 && !useJobs.getState().jobs.some(live);
}

/**
 * Wait until everything asked for has been worked out. What ends starts
 * what follows from it a moment later (a surface fitted, the model built
 * from it; a model built, the shells inside its units), so it is idle only
 * when it has stayed so. True when it has settled, false when `ms` passed
 * first.
 */
export async function whenIdle(ms = 120_000): Promise<boolean> {
    const end = Date.now() + ms;
    for (let quiet = 0; ;) {
        await new Promise(r => setTimeout(r, quiet === 0 ? 4 : 0));
        quiet = isIdle() ? quiet + 1 : 0;
        if (quiet >= 3) return true;
        if (Date.now() > end) return false;
    }
}

/** How long one took (or has taken so far), in words: "0.4 s", "12 s", "2 min 5 s" */
export function jobTime(job: Pick<Job, 'started' | 'ended'>, now = Date.now()): string {
    if (job.started === null) return '';
    const s = Math.max(0, ((job.ended ?? now) - job.started) / 1000);
    if (s < 10) return `${s.toFixed(1)} s`;
    if (s < 60) return `${Math.round(s)} s`;
    return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

/** What a job is doing or how it ended, in a few words */
export function jobLine(job: Job, now = Date.now()): string {
    const took = jobTime(job, now);
    if (job.state === 'waiting') return job.step ? `Waiting ${job.step}` : 'Waiting its turn';
    if (job.state === 'running') {
        // (How far, where it says: so many of so many, or so many so far, or only what it is at)
        const [done, of] = job.progress ?? [0, 0];
        const count = of > 0 ? `${done.toLocaleString()} of ${of.toLocaleString()} ` : done > 0 ? `${done.toLocaleString()} ` : '';
        const far = count || job.step ? `${count}${job.step ?? ''}`.trim() + ', ' : '';
        return `Working: ${far}${took} so far`;
    }
    if (job.state === 'done') return `Done in ${took}`;
    if (job.state === 'stopped') return took ? `Stopped after ${took}` : 'Stopped before it began';
    return `Failed after ${took}: ${job.error ?? 'it could not be worked out.'}`;
}
