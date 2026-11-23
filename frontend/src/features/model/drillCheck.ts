/**
 * A surface built from logging checked against holes left out of it
 * (Phase 262): an intrusion, an intrusion of thin sheets, a vein, the
 * veins of a vein system taken together, or a proportion's shell.
 *
 * The holes are put in a few lots; the surface is fitted again without each
 * lot in turn, and the logging of the holes left out is read against that
 * fit. Holes that lie together (a line of holes on one level, a fan from
 * one collar: holeGroups.ts) are left out together, since one of them left
 * out alone is read from its neighbours a few metres away.
 *
 * What it gives (loggedScore.ts): as a solid, how much of the unit in those
 * holes it took in and how much of what it took in is the unit; and, down
 * the holes in stretches of 1 to 40 m, whether it says how much of the unit
 * a stretch holds and where there is more of it. Asked for by hand, kept
 * for as long as the fits it is a check of stay as they are.
 */
import { create } from 'zustand';
import { useModelStore } from '../../store/modelStore';
import type { HoleLog } from './contacts';
import { groupLots, holeGroups, type GroupHole } from './holeGroups';
import { beginJob, endJob, progressJob } from './jobs';
import { holeLog, unitLog } from './logging';
import { addScores, addShares, loggedPieces, scoreLogged, scoreShare, type LoggedPieces, type LoggedScore, type ShareScore } from './loggedScore';
import { fieldWithout, useModelCache } from './modelCache';
import { keys } from './objectKeys';
import { sharePercent } from './proportion';
import { evaluateField, type FittedField } from './rbf';
import { listText } from './shellDomains';
import type { ModelScene, SurfaceObject, Vec3 } from './types';

/** How many lots the holes are put in: a fit without each */
export const CHECK_LOTS = 5;
/** The logging of the holes left out is read in pieces this long, m */
export const CHECK_STEP = 0.25;
/** Places asked of a fit at a time, with the page let draw between */
const CHUNK = 20_000;

/** What is checked: a surface, or the veins of a vein system as one */
export type CheckTarget = { kind: 'surface'; id: string } | { kind: 'system'; id: string };
export const checkKey = (target: CheckTarget): string => `${target.kind}:${target.id}`;

export interface DrillCheck {
    /** Its units, in words ("FGRA", "FGRA and QV") */
    unit: string;
    /** Holes with logging to check against; the fits made; of them, those that could not be made without their holes */
    holes: number;
    lots: number;
    unfitted: number;
    /** The holes that lie together: lines on a level, fans from a collar, groups that are both; and the holes in them */
    lines: number;
    fans: number;
    mixed: number;
    grouped: number;
    /** How many holes the largest of those groups has (0: none lie together) */
    largest: number;
    /** A proportion: what it says is a share at each place, and its solid is the ground at or above this share */
    share: number | null;
    /** The logging of the holes left out against the fit without them; and against the fit as it is, with them in */
    without: LoggedScore;
    withThem: LoggedScore;
    /** Down the holes left out, by length of hole (skill, where, the length it holds at) */
    scale: ShareScore;
}

/** A small seeded shuffle: the same surface always gives the same check */
function shuffled<T>(list: readonly T[]): T[] {
    let seed = 0x9e3779b9 ^ list.length;
    const next = () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

/** The holes of a log, each with where it is at a depth and where it starts and stops being logged */
export interface LogHole {
    name: string;
    rows: number[];
    /** Where each of its rows ends: its To, else where the next one starts (NaN: not known) */
    end: number[];
    start: number;
    stop: number;
    placeAt: (depth: number) => Vec3;
}

/** The holes of a log, by name in order. Rows with no hole, depth or place are left out. */
export function logHoles(log: HoleLog): LogHole[] {
    const byHole = new Map<string, number[]>();
    for (let i = 0; i < log.from.length; i++) {
        const hole = log.hole[i];
        if (!hole || !Number.isFinite(log.from[i]) || !Number.isFinite(log.x[i]) || !Number.isFinite(log.y[i]) || !Number.isFinite(log.z[i])) continue;
        const rows = byHole.get(hole);
        if (rows) rows.push(i);
        else byHole.set(hole, [i]);
    }
    const out: LogHole[] = [];
    for (const name of [...byHole.keys()].sort()) {
        const rows = byHole.get(name)!.sort((p, q) => log.from[p] - log.from[q]);
        const end = rows.map((i, k) => {
            const to = log.to ? log.to[i] : NaN;
            return Number.isFinite(to) && to > log.from[i] ? to : k + 1 < rows.length ? log.from[rows[k + 1]] : NaN;
        });
        const mid = (k: number) => (Number.isFinite(end[k]) ? (log.from[rows[k]] + end[k]) / 2 : log.from[rows[k]]);
        const placeAt = (depth: number): Vec3 => {
            const at = log.placeAt?.(rows[0], depth);
            if (at) return at;
            // (Between the middles of two intervals, carried on straight past the first and the last)
            let k = 0;
            while (k + 2 < rows.length && mid(k + 1) < depth) k++;
            const i = rows[k], j = rows[Math.min(k + 1, rows.length - 1)];
            const a = mid(k), b = mid(Math.min(k + 1, rows.length - 1));
            const t = b > a ? (depth - a) / (b - a) : 0;
            return [log.x[i] + t * (log.x[j] - log.x[i]), log.y[i] + t * (log.y[j] - log.y[i]), log.z[i] + t * (log.z[j] - log.z[i])];
        };
        let stop = log.from[rows[0]];
        end.forEach((e, k) => { stop = Math.max(stop, Number.isFinite(e) ? e : log.from[rows[k]]); });
        out.push({ name, rows, end, start: log.from[rows[0]], stop, placeAt });
    }
    return out;
}

/** A hole as the grouping reads it: its collar, its middle and the way it runs there */
export function groupHole(hole: LogHole): GroupHole {
    const half = (hole.start + hole.stop) / 2, span = Math.max(1e-6, (hole.stop - hole.start) / 4);
    const a = hole.placeAt(half - span), b = hole.placeAt(half + span);
    const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(d[0], d[1], d[2]);
    return { collar: hole.placeAt(0), middle: hole.placeAt(half), direction: len > 0 ? [d[0] / len, d[1] / len, d[2] / len] : [0, 0, -1] };
}

export interface CheckLots {
    /** Per hole (as given): its lot */
    of: Int32Array;
    lots: number;
    lines: number;
    fans: number;
    mixed: number;
    grouped: number;
    /** The holes in the largest group (0: no holes lie together) */
    largest: number;
}

/**
 * Holes put in lots, those that lie together in one lot: at most `lots`,
 * fewer when there are fewer groups. The same holes always give the same lots.
 */
export function checkLots(holes: readonly LogHole[], lots = CHECK_LOTS): CheckLots {
    // (Shuffled first: groups of one size go to the lots in the order they come, and holes come in the order of their names)
    const order = shuffled(holes.map((_, i) => i));
    const found = holeGroups(order.map(i => groupHole(holes[i])));
    const count = (kind: string) => found.kinds.filter(k => k === kind).length;
    const n = Math.max(1, Math.min(lots, found.groups.length));
    const split = groupLots(found.groups, n);
    const of = new Int32Array(holes.length);
    order.forEach((hole, k) => { of[hole] = split.of[k]; });
    return { of, lots: n, lines: count('line'), fans: count('fan'), mixed: count('mixed'), grouped: found.groups.reduce((t, g) => t + (g.length > 1 ? g.length : 0), 0), largest: found.groups.reduce((t, g) => (g.length > 1 ? Math.max(t, g.length) : t), 0) };
}

/** What a target is made of, and the logging it is checked against. A reason when it cannot be checked. */
interface Resolved {
    name: string;
    surfaces: SurfaceObject[];
    log: HoleLog;
    inside: Set<string>;
    ignore: Set<string>;
    unit: string;
    share: number | null;
}

function resolve(scene: ModelScene, target: CheckTarget): Resolved | string {
    const system = target.kind === 'system' ? scene.veinSystems?.find(v => v.id === target.id) ?? null : null;
    const surfaces = target.kind === 'system'
        ? (system?.veins ?? []).map(id => scene.surfaces.find(s => s.id === id)).filter((s): s is SurfaceObject => !!s)
        : scene.surfaces.filter(s => s.id === target.id);
    const first = surfaces[0];
    if (!first) return 'It is no longer in the project.';
    const rule = first.rule;
    const trimmed = (list: readonly string[] | undefined) => new Set((list ?? []).map(c => c.trim()));
    if (rule.kind === 'shell' && rule.of) {
        const log = holeLog(scene.coords, rule.of.column, rule.of.table ?? null);
        if (!log) return 'The logging it is made from could not be read.';
        return { name: first.name, surfaces, log, inside: trimmed(rule.of.inside), ignore: trimmed(rule.of.ignore), unit: listText(rule.of.inside), share: rule.cutoff };
    }
    if (rule.kind !== 'body') return 'It is not built from logged units: leaving holes out would change nothing.';
    const map = rule.units ? scene.unitMaps?.find(m => m.id === rule.units) ?? null : undefined;
    const log = map === null ? null : map ? unitLog(scene.coords, map) : holeLog(scene.coords, rule.column, rule.table ?? null);
    if (!log) return 'The logging it is made from could not be read.';
    return { name: system?.name ?? first.name, surfaces, log, inside: trimmed(rule.inside), ignore: trimmed(rule.ignore), unit: listText(rule.inside), share: null };
}

/** The key of the fits a check is of: it stands while they stay as they are */
export function checkFitKey(target: CheckTarget): string | null {
    const scene = useModelStore.getState().scene, fits = useModelCache.getState().byId;
    const ids = target.kind === 'system' ? scene.veinSystems?.find(v => v.id === target.id)?.veins ?? [] : [target.id];
    if (ids.length === 0 || ids.some(id => fits[id]?.state !== 'ready' || !fits[id]?.key)) return null;
    return ids.map(id => fits[id]!.key).join('\n');
}

const pause = () => new Promise<void>(r => setTimeout(r, 0));

/** A fit asked about many places, a part at a time */
async function valuesAt(field: FittedField, positions: Float64Array): Promise<Float64Array> {
    const n = positions.length / 3;
    if (n <= CHUNK) return evaluateField(field, positions);
    const out = new Float64Array(n);
    for (let a = 0; a < n; a += CHUNK) {
        const b = Math.min(n, a + CHUNK);
        out.set(evaluateField(field, positions.subarray(a * 3, b * 3)), a);
        await pause();
    }
    return out;
}

/**
 * What the fits say at places: per place 1 inside any of them, else 0; for a
 * proportion (`share`), the share it says there. A fit that could not be
 * made says nothing is there.
 */
async function saidAt(fields: readonly (FittedField | null)[], positions: Float64Array, share: number | null): Promise<{ inside: Uint8Array; said: Float64Array }> {
    const n = positions.length / 3;
    const inside = new Uint8Array(n), said = new Float64Array(n);
    for (const field of fields) {
        if (!field) continue;
        if (share !== null) {
            const v = await valuesAt(field, positions);
            for (let i = 0; i < n; i++) { said[i] = Math.min(1, Math.max(0, v[i] + share)); if (said[i] >= share) inside[i] = 1; }
        } else {
            const v = await valuesAt(field, positions);
            for (let i = 0; i < n; i++) if (v[i] > 0) { inside[i] = 1; said[i] = 1; }
        }
    }
    return { inside, said };
}

export type DrillCheckResult = { ok: true; check: DrillCheck } | { ok: false; reason: string };

/** The check was stopped between two of its fits */
export class DrillCheckStopped extends Error {}

export interface DrillCheckOptions {
    lots?: number;
    step?: number;
    onFit?: (done: number, of: number) => void;
    /** Asked before each fit: true ends the check there (it throws DrillCheckStopped) */
    stopped?: () => boolean;
}

/** Check a surface, or a vein system, as it is now against holes left out of it */
export async function checkAgainstDrilling(target: CheckTarget, options: DrillCheckOptions = {}): Promise<DrillCheckResult> {
    const scene = useModelStore.getState().scene;
    const what = resolve(scene, target);
    if (typeof what === 'string') return { ok: false, reason: what };
    const fits = useModelCache.getState().byId;
    const asIs = what.surfaces.map(s => (fits[s.id]?.state === 'ready' ? fits[s.id]!.field ?? null : null));
    if (asIs.every(f => !f)) return { ok: false, reason: 'It is not fitted yet.' };

    // The logging as intervals: its units, other ground, or nothing said
    const { log } = what;
    const all = logHoles(log);
    const hole: number[] = [], from: number[] = [], to: number[] = [], logged: number[] = [];
    const used: LogHole[] = [];
    for (const h of all) {
        let any = false;
        const index = used.length;
        h.rows.forEach((row, k) => {
            const code = String(log.code[row] ?? '').trim();
            if (code === '' || what.ignore.has(code) || !Number.isFinite(h.end[k])) return;
            hole.push(index); from.push(log.from[row]); to.push(h.end[k]); logged.push(what.inside.has(code) ? 1 : -1);
            any = true;
        });
        if (any) used.push(h);
    }
    if (used.length < 4) return { ok: false, reason: 'There is nothing to check it with: fewer than four holes have logging.' };
    const lots = checkLots(used, options.lots ?? CHECK_LOTS);
    if (lots.lots < 2) return { ok: false, reason: 'All its holes lie together, as one line or one fan: none can be left out without leaving them all out.' };
    const piecesOf = (keep: (h: number) => boolean): LoggedPieces => {
        const rows = hole.map((h, i) => (keep(h) ? i : -1)).filter(i => i >= 0);
        return loggedPieces(
            { hole: rows.map(i => hole[i]), from: rows.map(i => from[i]), to: rows.map(i => to[i]), logged: rows.map(i => logged[i]) },
            (h, depth) => used[h].placeAt(depth), options.step ?? CHECK_STEP,
        );
    };

    const fitsToMake = lots.lots * what.surfaces.length;
    let done = 0, unfitted = 0;
    const without: LoggedScore[] = [], withThem: LoggedScore[] = [], scale: ShareScore[] = [];
    for (let lot = 0; lot < lots.lots; lot++) {
        const out = new Set(used.filter((_, h) => lots.of[h] === lot).map(h => h.name));
        const fields: (FittedField | null)[] = [];
        let failed = false;
        for (let k = 0; k < what.surfaces.length; k++) {
            if (options.stopped?.()) throw new DrillCheckStopped('The check was stopped');
            const f = await fieldWithout(what.surfaces[k].id, out);
            // (Not built from logging after all: it is as it is. Nothing to fit it from without them: it says nothing there)
            fields.push(f === 'as-is' ? asIs[k] : f);
            if (f === null) failed = true;
            options.onFit?.(++done, fitsToMake);
            await pause();
        }
        if (failed) unfitted++;
        const pieces = piecesOf(h => lots.of[h] === lot);
        if (pieces.logged.length === 0) continue;
        const refit = await saidAt(fields, pieces.positions, what.share), whole = await saidAt(asIs, pieces.positions, what.share);
        without.push(scoreLogged(pieces, refit.inside));
        withThem.push(scoreLogged(pieces, whole.inside));
        scale.push(scoreShare(pieces, what.share !== null ? refit.said : refit.inside, { asShare: what.share !== null }));
    }
    const a = addScores(without), b = addScores(withThem), c = addShares(scale);
    if (!a || !b || !c) return { ok: false, reason: 'The holes left out have no logging to read it against.' };
    return {
        ok: true,
        check: {
            unit: what.unit, holes: used.length, lots: lots.lots, unfitted, lines: lots.lines, fans: lots.fans, mixed: lots.mixed, grouped: lots.grouped, largest: lots.largest,
            share: what.share, without: a, withThem: b, scale: c,
        },
    };
}

export interface DrillCheckState {
    /** The fits this is a check of (`checkFitKey`): changed since, it is no longer checked */
    key: string;
    state: 'running' | 'done' | 'failed';
    done: number;
    of: number;
    check: DrillCheck | null;
    /** Done with nothing to say, or failed: why */
    reason: string | null;
}

export const useDrillChecks = create<{ byKey: Record<string, DrillCheckState> }>()(() => ({ byKey: {} }));

const put = (key: string, state: DrillCheckState) => useDrillChecks.setState(s => ({ byKey: { ...s.byKey, [key]: state } }));
const drop = (key: string) => useDrillChecks.setState(s => ({ byKey: Object.fromEntries(Object.entries(s.byKey).filter(([k]) => k !== key)) }));

/** The check of a target as it is now, when there is one and its fits have not changed since (else null) */
export function drillCheckOf(target: CheckTarget, state = useDrillChecks.getState().byKey): DrillCheckState | null {
    const mine = state[checkKey(target)];
    return mine && mine.key === checkFitKey(target) ? mine : null;
}

/** Check a target as it is now. Its answer is in `useDrillChecks` under `checkKey(target)`. */
export async function runDrillCheck(target: CheckTarget): Promise<void> {
    const at = checkKey(target), key = checkFitKey(target);
    if (!key) return;
    const mine = () => { const s = useDrillChecks.getState().byKey[at]; return !!s && s.key === key && s.state === 'running'; };
    if (mine()) return;
    const scene = useModelStore.getState().scene;
    const name = target.kind === 'system' ? scene.veinSystems?.find(v => v.id === target.id)?.name : scene.surfaces.find(s => s.id === target.id)?.name;
    put(at, { key, state: 'running', done: 0, of: 0, check: null, reason: null });
    let stop = false;
    const listed = beginJob({
        kind: 'check', object: target.kind === 'system' ? keys.veinSystem(target.id) : keys.surface(target.id), name: name ?? '', what: 'check against holes left out',
        stop: () => { stop = true; },
    });
    try {
        const result = await checkAgainstDrilling(target, {
            stopped: () => stop,
            onFit: (done, of) => {
                progressJob(listed, done, of, 'fits');
                if (mine()) put(at, { key, state: 'running', done, of, check: null, reason: null });
            },
        });
        if (mine()) put(at, { key, state: 'done', done: 0, of: 0, check: result.ok ? result.check : null, reason: result.ok ? null : result.reason });
        endJob(listed, 'done');
    } catch (e) {
        const stopped = e instanceof DrillCheckStopped;
        endJob(listed, stopped ? 'stopped' : 'failed', 'The check stopped before it was done.');
        if (!mine()) return;
        if (stopped) drop(at);
        else put(at, { key, state: 'failed', done: 0, of: 0, check: null, reason: 'The check could not be made.' });
    }
}

const percent = (part: number, whole: number) => {
    const p = whole > 0 ? 100 * part / whole : 0;
    return `${p > 0 && p < 1 ? 'under 1' : p > 99 && p < 100 ? 'over 99' : Math.round(p)}%`;
};
const metres = (m: number) => `${Math.round(m).toLocaleString('en-US')} m`;

/** How well it says where there is more, in a word */
export function whereWord(where: number): string {
    return where < 0.2 ? 'hardly at all' : where < 0.4 ? 'weakly' : where < 0.6 ? 'fairly well' : where < 0.8 ? 'well' : 'closely';
}

/** The length of hole "where" is said for: 5 m, else the nearest length that has a figure */
export function whereAt(scale: ShareScore, window = 5): { window: number; where: number } | null {
    const with_ = scale.scales.filter(s => s.where !== null);
    if (with_.length === 0) return null;
    const best = with_.reduce((p, q) => (Math.abs(Math.log(q.window / window)) < Math.abs(Math.log(p.window / window)) ? q : p));
    return { window: best.window, where: best.where! };
}

/** What a check found, in words */
export function drillCheckText(check: DrillCheck): string[] {
    const { without: w, withThem: t, unit } = check;
    const groups = [
        check.lines > 0 ? `${check.lines.toLocaleString()} ${check.lines === 1 ? 'line' : 'lines'} of holes on one level` : '',
        check.fans > 0 ? `${check.fans.toLocaleString()} ${check.fans === 1 ? 'fan' : 'fans'} from one collar` : '',
        check.mixed > 0 ? `${check.mixed.toLocaleString()} of both` : '',
    ].filter(Boolean);
    // (A group larger than a lot's share of the holes is a lot by itself, or most of one: how it is drawn moves the score)
    const big = check.largest > check.holes / check.lots
        ? ` The largest is more than 1 in ${check.lots} of the holes: the time it is left out, the fit is tested on that one group, a long way from anything it was shown.` : '';
    const lines = [
        `Fitted again ${check.lots} times, each time without about 1 in ${check.lots} of its ${check.holes.toLocaleString()} holes.`
        + (groups.length > 0 ? ` Holes that lie together are left out together (${groups.join(', ')}; ${check.grouped.toLocaleString()} holes in all, ${check.largest.toLocaleString()} in the largest group): one of them left out alone would be read from its neighbours.${big}` : '')
        + (check.unfitted > 0 ? ` ${check.unfitted === 1 ? 'One time' : `${check.unfitted} times`} there was too little left to fit it from: it then says nothing there.` : ''),
    ];
    const solid = check.share !== null ? `Its shell (the ground it says is ${sharePercent(check.share)} ${unit} or more)` : 'It';
    const unitMetres = w.found + w.missed, tookIn = w.found + w.wrong, every = unitMetres + w.wrong + w.right;
    if (unitMetres <= 0) lines.push(`The holes left out have no ${unit} logged in them to find.`);
    else {
        lines.push(`${solid} took in ${metres(w.found)} of the ${metres(unitMetres)} of ${unit} logged in the holes left out (${percent(w.found, unitMetres)}).`);
        lines.push(tookIn <= 0
            ? 'It took in nothing in those holes: it does not carry from one hole to the next.'
            : `Of the ${metres(tookIn)} of those holes it took in, ${percent(w.found, tookIn)} is ${unit}; of those holes as a whole, ${percent(unitMetres, every)} is.`);
        const withIn = t.found + t.wrong;
        lines.push(`With every hole in, it takes in ${percent(t.found, t.found + t.missed)} of the ${unit} in them${withIn > 0 ? `, and ${percent(t.found, withIn)} of what it takes in is ${unit}` : ''}.`);
    }
    const overall = check.scale.loggedShare !== null ? sharePercent(check.scale.loggedShare, true) : null;
    const longest = check.scale.scales.length > 0 ? check.scale.scales[check.scale.scales.length - 1].window : 40;
    if (check.scale.scales.some(s => s.skill !== null)) {
        lines.push(check.scale.holds !== null
            ? `How much ${unit} a stretch of hole holds: it says for stretches of ${check.scale.holds} m and longer. Over shorter ones, quoting the overall ${overall ?? 'share'} everywhere would be as near.`
            : `How much ${unit} a stretch of hole holds: at no length up to ${longest} m does it say better than quoting the overall ${overall ?? 'share'} everywhere would.`);
    }
    const where = whereAt(check.scale);
    if (where) lines.push(`Where there is more ${unit} and where less, over ${where.window} m of hole: it follows the logging ${whereWord(where.where)} (${where.where.toFixed(2)}, where 1 is exactly as logged and 0 is not at all).`);
    return lines;
}
