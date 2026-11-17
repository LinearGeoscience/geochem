/**
 * A shell checked against holes left out of its fit (holdout.ts): asked
 * for by hand, run off the main thread, and kept for as long as the shell
 * stays as it was when it was checked.
 */
import { create } from 'zustand';
import { useModelStore } from '../../store/modelStore';
import type { ShellCheck } from './holdout';
import { shellSamples } from './logging';
import { layersFor, stretchFor, useModelCache } from './modelCache';
import { CheckReplaced, requestCheck } from './surfaceClient';
import { smoothingFromFollow } from './surfaceJobs';

export interface ShellCheckState {
    /** The fit this is a check of (modelCache's key): a shell changed since is no longer checked */
    key: string;
    state: 'running' | 'done' | 'failed';
    /** Fits done, of how many */
    done: number;
    of: number;
    /** Null when done: there was nothing to check with (too few holes with high values) */
    check: ShellCheck | null;
}

export const useShellChecks = create<{ byId: Record<string, ShellCheckState> }>()(() => ({ byId: {} }));

const put = (id: string, state: ShellCheckState) => useShellChecks.setState(s => ({ byId: { ...s.byId, [id]: state } }));

/** Check a shell as it is now. Its answer is in `useShellChecks` under its id, with the fit's key. */
export async function runShellCheck(surfaceId: string): Promise<void> {
    const { scene } = useModelStore.getState();
    const surface = scene.surfaces.find(s => s.id === surfaceId);
    const key = useModelCache.getState().byId[surfaceId]?.key;
    if (!surface || surface.rule.kind !== 'shell' || !key) return;
    const rule = surface.rule;
    const samples = shellSamples(scene.coords, rule.column);
    if (!samples) return;
    const mine = (s: ShellCheckState | undefined) => !!s && s.key === key && s.state === 'running';
    if (mine(useShellChecks.getState().byId[surfaceId])) return;
    put(surfaceId, { key, state: 'running', done: 0, of: 0, check: null });
    try {
        const check = await requestCheck(
            { samples, rule, stretch: stretchFor(surface), layers: layersFor(surface), smoothing: smoothingFromFollow(surface.params.follow) },
            (done, of) => { if (mine(useShellChecks.getState().byId[surfaceId])) put(surfaceId, { key, state: 'running', done, of, check: null }); },
        );
        // Another check of it was started meanwhile: that one's answer is the one wanted
        if (mine(useShellChecks.getState().byId[surfaceId])) put(surfaceId, { key, state: 'done', done: check?.rounds ?? 0, of: check?.rounds ?? 0, check });
    } catch (e) {
        if (!mine(useShellChecks.getState().byId[surfaceId])) return;
        // Stopped for a check of another shell: it is simply not checked
        if (e instanceof CheckReplaced) useShellChecks.setState(s => ({ byId: Object.fromEntries(Object.entries(s.byId).filter(([id]) => id !== surfaceId)) }));
        else put(surfaceId, { key, state: 'failed', done: 0, of: 0, check: null });
    }
}

const share = (part: number, whole: number) => {
    const p = whole > 0 ? 100 * part / whole : 0;
    return `${p > 0 && p < 1 ? 'under 1' : p > 99 && p < 100 ? 'over 99' : Math.round(p)}%`;
};

/**
 * What a check found, in words. `one`: what the shell counts ("samples",
 * "averages over 3 m"). `runs`: the shell is built from intercepts, and is
 * checked for the samples in one.
 */
export function shellCheckText(check: ShellCheck | null, cutoff: number, one = 'samples', runs = false): string[] {
    if (!check) return [`There is nothing to check it with: fewer than three holes have ${runs ? 'an intercept' : 'a value at or above the cut-off'}, or the hole and depth columns are not known.`];
    const is = runs ? 'in an intercept' : `at or above ${cutoff}`;
    const holes = `${check.holes.toLocaleString()} ${check.holes === 1 ? 'hole' : 'holes'}`;
    const how = `Fitted again without ${holes}${check.atATime > 1 ? `, ${check.atATime.toLocaleString()} at a time` : check.holes > 1 ? ', one at a time' : ''}`;
    if (check.high === 0) return [`${how}: they had no ${one} ${is} to find.`];
    const found = `${how}: it took in ${check.found.toLocaleString()} of the ${check.high.toLocaleString()} ${one} ${is} in them (${share(check.found, check.high)}).`;
    if (check.inside === 0) return [found, 'It took in nothing in those holes: it does not carry from one hole to the next.'];
    // Against what those holes hold as a whole: a shell worth having takes in a far larger share of high ones than there are
    const rate = (part: number, whole: number) => (part === whole ? 'all' : part === 0 ? 'none' : part / whole >= 0.1 ? share(part, whole) : `1 in ${Math.round(whole / part).toLocaleString()}`);
    const took = rate(check.found, check.inside);
    return [found, `Of what it took in there, ${took} is ${is} (${check.found.toLocaleString()} of ${check.inside.toLocaleString()}); of those holes as a whole, ${rate(check.high, check.places)} is.`];
}
