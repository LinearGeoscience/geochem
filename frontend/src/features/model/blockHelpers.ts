/**
 * Helpers that fit blocks of a field at the same time (workers/blocks.worker),
 * started by the surface worker when a fit first wants many blocks at once,
 * and kept. The blocks are shared out by how long each will take (the cube
 * of its points); this worker fits a share too while the helpers work.
 */
import { fitBlockTask, type BlockAnswer, type BlockTask } from './pou';

/** How many helpers to start: the cores there are, less the main thread, the surface workers and this one (none on two cores) */
export function helperCount(cores: number, surfaceWorkers: number): number {
    return Math.max(0, Math.min(6, Math.floor(cores / Math.max(1, surfaceWorkers)) - 1));
}

/**
 * Share tasks between `ways` lots, each about as long to fit: the longest
 * first, each to the lot with the least so far. Lot 0 is fitted here.
 */
export function shareTasks(tasks: readonly BlockTask[], ways: number): BlockTask[][] {
    const lots: BlockTask[][] = Array.from({ length: Math.max(1, ways) }, () => []);
    const load = new Float64Array(lots.length);
    const cost = (t: BlockTask) => (t.values.length + 4) ** 3;
    const order = tasks.map((_, i) => i).sort((a, b) => cost(tasks[b]) - cost(tasks[a]) || a - b);
    for (const i of order) {
        let at = 0;
        for (let k = 1; k < lots.length; k++) if (load[k] < load[at]) at = k;
        lots[at].push(tasks[i]);
        load[at] += cost(tasks[i]);
    }
    return lots;
}

interface Helper {
    worker: Worker;
    pending: Map<number, (answers: BlockAnswer[] | null) => void>;
}

let helpers: Helper[] | null = null;
let nextId = 0;

function startHelpers(count: number): Helper[] {
    if (helpers) return helpers;
    helpers = [];
    if (count <= 0 || typeof Worker === 'undefined') return helpers;
    for (let k = 0; k < count; k++) {
        try {
            const worker = new Worker(new URL('../../workers/blocks.worker.ts', import.meta.url), { type: 'module' });
            const helper: Helper = { worker, pending: new Map() };
            worker.onmessage = (e: MessageEvent) => {
                const { id, answers } = e.data as { id: number; answers: BlockAnswer[] };
                const done = helper.pending.get(id);
                helper.pending.delete(id);
                done?.(answers);
            };
            worker.onerror = () => {
                // A helper that stopped: what it had is fitted here instead, and it is not used again
                for (const done of helper.pending.values()) done(null);
                helper.pending.clear();
                worker.terminate();
                helpers = helpers?.filter(h => h !== helper) ?? null;
            };
            helpers.push(helper);
        } catch {
            break;
        }
    }
    return helpers;
}

/**
 * Fit these blocks: shared between the helpers (as many as `count`, started
 * the first time) and this worker. With no helpers, all of them here.
 */
export async function fitBlocksShared(tasks: BlockTask[], count: number): Promise<BlockAnswer[]> {
    const team = startHelpers(count);
    const lots = shareTasks(tasks, team.length + 1);
    const asked = lots.slice(1).map((lot, k) => {
        if (lot.length === 0) return Promise.resolve([] as BlockAnswer[]);
        const helper = team[k];
        return new Promise<BlockAnswer[]>(resolve => {
            const id = nextId++;
            helper.pending.set(id, answers => resolve(answers ?? lot.map(fitBlockTask)));
            helper.worker.postMessage({ id, tasks: lot });
        });
    });
    const here = lots[0].map(fitBlockTask);
    return [...here, ...(await Promise.all(asked)).flat()];
}
