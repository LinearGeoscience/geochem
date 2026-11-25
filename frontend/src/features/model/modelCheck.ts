/**
 * A geological model checked against holes left out of it: some holes at a
 * time are taken away, the surfaces built from logging are fitted again
 * from the rest, and the model's rule is asked what unit it has down the
 * holes left out. How much of their logging is in the unit it was logged
 * as says how well the model carries from hole to hole. Asked for by hand.
 *
 * Only the logging of the holes is left out: points and lines placed by
 * hand, readings, and surfaces not built from logging stay as they are.
 */
import { create } from 'zustand';
import { useModelStore } from '../../store/modelStore';
import { OUTSIDE } from './cutCells';
import { useGeoModelCache, type ModelResult } from './geoModelCache';
import { agreement, loggedSamples, sharePercent, type Agreement } from './geoModelFlag';
import { unitsAtPoints, type ModelJob } from './geoModelJobs';
import { beginJob, endJob, progressJob } from './jobs';
import { unitLog } from './logging';
import { groupHole, logHoles } from './drillCheck';
import { holeGroups } from './holeGroups';
import { fieldWithout } from './modelCache';
import { keys } from './objectKeys';
import type { GeoModel } from './types';

export interface ModelCheck {
    /** Holes with logging of the model's units; left out a round; rounds made */
    holes: number;
    atATime: number;
    rounds: number;
    /** Surfaces of the model that are built from logging, and so fitted again each round */
    refitted: number;
    /** Holes left out in all; of them, those left out together with the holes they lie with (a line on a level, a fan from a collar) */
    left: number;
    together: number;
    /** How many holes the largest group left out together has (0: none were) */
    largest: number;
    /** The logging of the holes left out against the model built without them */
    without: Agreement;
    /** The same logging against the model as it is, with them in */
    withThem: Agreement;
}

export interface CheckOptions {
    /** The share of the holes left out each round (0 to 1; default 0.1) */
    share?: number;
    /** At most this many rounds (default 6) */
    rounds?: number;
    onRound?: (done: number, of: number) => void;
    /** Asked before each round: true ends the check there (it throws ModelCheckStopped) */
    stopped?: () => boolean;
}

/** A small seeded shuffle: the same model always gives the same check */
function shuffled(names: string[]): string[] {
    let seed = 0x9e3779b9 ^ names.length;
    const next = () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const out = [...names].sort();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

/** A build's job with some of its contact fields replaced (null: that contact is not in it) */
function jobWith(job: ModelJob, fields: (ModelJob['fields'][number] | null)[], faults: ModelJob['fields'] | null): ModelJob {
    const keep = fields.map((f, k) => (f ? k : -1)).filter(k => k >= 0);
    const pick = <T,>(list: readonly T[]): T[] => keep.map(k => list[k]);
    return {
        ...job,
        steps: pick(job.steps), fields: keep.map(k => fields[k]!), unitOf: pick(job.unitOf),
        ...(job.thin ? { thin: pick(job.thin) } : {}),
        ...(job.within ? { within: pick(job.within) } : {}),
        ...(job.faults && faults ? { faults: { ...job.faults, fields: faults } } : {}),
    };
}

export type CheckResult = { ok: true; check: ModelCheck } | { ok: false; reason: string };

/** Check a built model against holes left out of it */
/** The check was stopped between two of its rounds (`CheckOptions.stopped`) */
export class ModelCheckStopped extends Error {}

export async function checkModel(model: GeoModel, result: ModelResult, options: CheckOptions = {}): Promise<CheckResult> {
    const scene = useModelStore.getState().scene;
    const map = scene.unitMaps?.find(m => m.id === model.unitMap);
    if (!result.out || !result.job) return { ok: false, reason: 'The model is not built yet.' };
    if (!map) return { ok: false, reason: 'The model reads no lithologies: there is no logging to check it with.' };
    // (As logged: the surfaces are fitted from the logging as cleaned, and asked about the logging itself)
    const log = unitLog(scene.coords, map, true);
    if (!log) return { ok: false, reason: 'The logging of its units could not be read.' };
    const job = result.job, topSense = result.out.topSense;
    const samples = loggedSamples(log, Math.max(0.5, result.out.grid.cell / 2), 30_000);
    const holeOf = Array.from(samples.row, r => String(log.hole[r] ?? ''));
    const loggedAs = Array.from(samples.row, r => String(log.code[r] ?? ''));
    const known = new Set(result.units);
    const names = shuffled([...new Set(holeOf.filter((h, i) => h !== '' && known.has(loggedAs[i])))]);
    if (names.length < 4) return { ok: false, reason: 'There is nothing to check it with: fewer than four holes have logging of its units.' };

    // The surfaces behind the build's contacts and faults, in its order
    const contactSurface = result.contacts.map(id => model.contacts.find(c => c.id === id)?.surface ?? null);
    const faultSurface = result.faults.map(id => model.faults?.find(f => f.id === id)?.surface ?? null);
    const fromLogging = (id: string | null) => {
        const kind = scene.surfaces.find(s => s.id === id)?.rule.kind;
        return kind === 'contact' || kind === 'body';
    };
    const refitted = new Set([...contactSurface, ...faultSurface].filter(fromLogging)).size;
    if (refitted === 0) return { ok: false, reason: 'None of its surfaces is built from logging: leaving holes out would change nothing.' };

    const share = Math.min(0.9, Math.max(0.01, options.share ?? 0.1));
    const atATime = Math.max(1, Math.round(names.length * share));
    // Holes that lie together are left out together: one of them left out alone is read from its neighbours a few
    // metres away. The groups in the order their first hole comes; a round takes groups until it has its holes
    const places = new Map(logHoles(log).map(h => [h.name, h]));
    const placed = names.filter(n => places.has(n));
    const grouping = holeGroups(placed.map(n => groupHole(places.get(n)!)));
    const lists: string[][] = [];
    const listed = new Set<number>();
    placed.forEach((_, i) => { const g = grouping.of[i]; if (!listed.has(g)) { listed.add(g); lists.push(grouping.groups[g].map(k => placed[k])); } });
    for (const n of names) if (!places.has(n)) lists.push([n]);
    const sets: Set<string>[] = [];
    const most = Math.max(1, Math.min(options.rounds ?? 6, Math.floor(names.length / atATime)));
    let together = 0, largest = 0;
    for (let k = 0; k < lists.length && sets.length < most;) {
        const out = new Set<string>();
        let grouped = 0, big = 0;
        while (k < lists.length && out.size < atATime) { if (lists[k].length > 1) { grouped += lists[k].length; big = Math.max(big, lists[k].length); } for (const n of lists[k++]) out.add(n); }
        // (A round that would leave no hole in is no test)
        if (out.size < names.length) { sets.push(out); together += grouped; largest = Math.max(largest, big); }
    }
    if (sets.length === 0) return { ok: false, reason: 'All its holes lie together, as one line or one fan: none can be left out without leaving them all out.' };
    const rounds = sets.length;
    const logged: string[] = [], modelled: (string | null)[] = [], whole: (string | null)[] = [], length: number[] = [], hole: string[] = [];
    const nameAt = (j: ModelJob, xyz: Float64Array) => Array.from(unitsAtPoints(j, topSense, xyz), u => (u === OUTSIDE ? null : result.units[u] ?? null));

    for (let round = 0; round < rounds; round++) {
        if (options.stopped?.()) throw new ModelCheckStopped('The check was stopped');
        const out = sets[round];
        const fields: (ModelJob['fields'][number] | null)[] = [];
        for (let k = 0; k < job.fields.length; k++) {
            const f = contactSurface[k] ? await fieldWithout(contactSurface[k]!, out) : 'as-is';
            fields.push(f === 'as-is' ? job.fields[k] : f);
        }
        let faults: ModelJob['fields'] | null = null;
        if (job.faults) {
            faults = [];
            for (let k = 0; k < job.faults.fields.length; k++) {
                const f = faultSurface[k] ? await fieldWithout(faultSurface[k]!, out) : 'as-is';
                // (A fault that could not be fitted without them stays as it is: the blocks need it)
                faults.push(f === 'as-is' || f === null ? job.faults.fields[k] : f);
            }
        }
        const pieces: number[] = [];
        for (let i = 0; i < holeOf.length; i++) if (out.has(holeOf[i])) pieces.push(i);
        const xyz = new Float64Array(pieces.length * 3);
        pieces.forEach((i, q) => { xyz[q * 3] = samples.xyz[i * 3]; xyz[q * 3 + 1] = samples.xyz[i * 3 + 1]; xyz[q * 3 + 2] = samples.xyz[i * 3 + 2]; });
        const without = nameAt(jobWith(job, fields, faults), xyz), asIs = nameAt(job, xyz);
        pieces.forEach((i, q) => {
            logged.push(loggedAs[i]); modelled.push(without[q]); whole.push(asIs[q]); length.push(samples.length[i]); hole.push(holeOf[i]);
        });
        options.onRound?.(round + 1, rounds);
        // (Let the page draw between rounds)
        await new Promise(r => setTimeout(r, 0));
    }
    return {
        ok: true,
        check: {
            holes: names.length, atATime, rounds, refitted, left: sets.reduce((t, s) => t + s.size, 0), together, largest,
            without: agreement(result.units, logged, modelled, length, hole),
            withThem: agreement(result.units, logged, whole, length, hole),
        },
    };
}

export interface ModelCheckState {
    /** The build this is a check of: a model built again since is no longer checked */
    key: string;
    state: 'running' | 'done';
    done: number;
    of: number;
    result: CheckResult | null;
}

export const useModelChecks = create<{ byId: Record<string, ModelCheckState> }>()(() => ({ byId: {} }));
const put = (id: string, state: ModelCheckState) => useModelChecks.setState(s => ({ byId: { ...s.byId, [id]: state } }));

/** The build (by its key) of each model that has been compared with the logging in its properties: the setup steps say so */
export interface ComparedShare { key: string; agreed: number; metres: number }
/** `share`: for that build, the metres of logging compared and of those the metres in the unit they were logged as */
export const useModelCompared = create<{ byId: Record<string, string>; share: Record<string, ComparedShare> }>()(() => ({ byId: {}, share: {} }));
export function noteCompared(modelId: string, key: string, share?: { agreed: number; metres: number }): void {
    const now = useModelCompared.getState();
    const had = now.share[modelId];
    const same = !share ? true : !!had && had.key === key && had.agreed === share.agreed && had.metres === share.metres;
    if (now.byId[modelId] === key && same) return;
    useModelCompared.setState(s => ({ byId: { ...s.byId, [modelId]: key }, share: share ? { ...s.share, [modelId]: { key, ...share } } : s.share }));
}

/** Check a model as it is built now. Its answer is in `useModelChecks` under its id, with the build's key. */
export async function runModelCheck(modelId: string): Promise<void> {
    const model = useModelStore.getState().scene.models?.find(m => m.id === modelId);
    const result = useGeoModelCache.getState().byId[modelId];
    if (!model || !result?.out) return;
    const key = result.key;
    const mine = () => { const s = useModelChecks.getState().byId[modelId]; return !!s && s.key === key && s.state === 'running'; };
    if (mine()) return;
    put(modelId, { key, state: 'running', done: 0, of: 0, result: null });
    // (Stopped: seen before its next round of fits)
    let stopped = false;
    const listed = beginJob({ kind: 'check', object: keys.model(modelId), name: model.name, what: 'check against holes left out', stop: () => { stopped = true; } });
    let answer: CheckResult;
    try {
        answer = await checkModel(model, result, {
            stopped: () => stopped,
            onRound: (done, of) => {
                progressJob(listed, done, of, 'fits');
                if (mine()) put(modelId, { key, state: 'running', done, of, result: null });
            },
        });
    } catch (e) {
        if (e instanceof ModelCheckStopped) {
            // Stopped by hand: the model is simply not checked
            if (mine()) useModelChecks.setState(s => ({ byId: Object.fromEntries(Object.entries(s.byId).filter(([id]) => id !== modelId)) }));
            endJob(listed, 'stopped');
            return;
        }
        answer = { ok: false, reason: 'The check could not be made.' };
    }
    if (mine()) put(modelId, { key, state: 'done', done: 0, of: 0, result: answer });
    endJob(listed, answer.ok ? 'done' : 'failed', answer.ok ? null : answer.reason);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** What a check found, in lines */
export function modelCheckText(check: ModelCheck): string[] {
    const { without: a, withThem: b } = check;
    const left = check.left;
    // (Holes that lie together go out together, so a round is not always the same number of holes)
    const how = check.together > 0
        ? `about ${check.atATime} at a time, holes that lie together (a line on one level, a fan from one collar) left out together${check.largest > 1 ? `, ${check.largest.toLocaleString()} in the largest group` : ''}`
        : `${check.atATime} at a time`;
    if (!(a.metres > 0)) return [`Built again without ${plural(left, 'hole')}, ${how}: none of their logging is of the model's units inside it, so there is nothing to compare.`];
    const lines = [
        `Built again without ${plural(left, 'hole')} of its ${check.holes.toLocaleString()}, ${how}: ${sharePercent(a.agreed, a.metres)}% of the ${Math.round(a.metres).toLocaleString('en-US')} m logged in them is in the unit it was logged as. With those holes in, ${sharePercent(b.agreed, b.metres)}% is.`,
    ];
    const least = [...a.units].filter(u => u.logged > 0).sort((x, y) => x.agreed / x.logged - y.agreed / y.logged)[0];
    if (least && a.units.length > 1 && least.agreed < least.logged - 1e-9) {
        lines.push(`It carries ${least.unit} least well from hole to hole: ${sharePercent(least.agreed, least.logged)}% of its ${Math.round(least.logged).toLocaleString('en-US')} m${least.as.length ? `, the rest mostly ${least.as[0].unit}` : ''}.`);
    }
    lines.push(`A hard test: with a hole left out the gap there is twice as wide. ${plural(check.refitted, 'surface')} built from logging ${check.refitted === 1 ? 'was' : 'were'} fitted again each time; points and lines placed by hand stayed. Compare ways of building the model by it; it is not a score.`);
    return lines;
}
