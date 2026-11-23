/**
 * How a body sits against the logging of holes it was not built from (pure,
 * unit-tested).
 *
 * The logging of the holes kept out is cut into short pieces down each hole.
 * Each piece is logged as the body's unit or as something else, and the body
 * either holds the piece's middle or does not. From that:
 *  - metres: of the unit found inside the body and missed outside it, and of
 *    other ground put inside it by mistake;
 *  - stretches: every run of the unit down a hole, and every run of hole
 *    inside the body, with how far down the hole it is to the nearest of the
 *    other kind. A thin dyke modelled a metre from where it was logged scores
 *    nothing in metres; here it counts as met within a metre;
 *  - thickness: where a logged run and a modelled one meet, how long the
 *    modelled one is against the logged one;
 *  - share (`scoreShare`): over lengths of hole from 1 to 40 m, how much of
 *    the unit the model says there is against how much was logged: from
 *    what length its amounts can be relied on, and how well it says where
 *    there is more.
 * Unlogged hole is in neither count: it says nothing either way.
 */
import type { Vec3 } from './types';

export interface LoggedIntervals {
    /** Per interval: the hole it is in, as a number */
    hole: ArrayLike<number>;
    from: ArrayLike<number>;
    to: ArrayLike<number>;
    /** 1: logged as the body's unit; -1: logged as something else; 0: not logged */
    logged: ArrayLike<number>;
}

/** Logged intervals cut into pieces, in order down each hole */
export interface LoggedPieces {
    hole: Int32Array;
    from: Float64Array;
    to: Float64Array;
    /** The middle of each piece, xyz triples */
    positions: Float64Array;
    /** 1 the unit, -1 other ground */
    logged: Int8Array;
}

/** A run down a hole */
export interface Stretch {
    hole: number;
    from: number;
    to: number;
}

/**
 * The intervals as pieces no longer than `step` (m), hole by hole and down
 * each. `placeAt`: where a hole is at a depth (null: not known; the piece is
 * left out). Intervals that are not logged, or have no length, give nothing.
 */
export function loggedPieces(intervals: LoggedIntervals, placeAt: (hole: number, depth: number) => Vec3 | null, step: number): LoggedPieces {
    const n = Math.min(intervals.hole.length, intervals.from.length, intervals.to.length, intervals.logged.length);
    const order: number[] = [];
    for (let i = 0; i < n; i++) if (intervals.logged[i] !== 0 && intervals.to[i] > intervals.from[i]) order.push(i);
    order.sort((a, b) => intervals.hole[a] - intervals.hole[b] || intervals.from[a] - intervals.from[b]);
    const hole: number[] = [], from: number[] = [], to: number[] = [], positions: number[] = [], logged: number[] = [];
    const size = step > 0 ? step : Infinity;
    for (const i of order) {
        const length = intervals.to[i] - intervals.from[i];
        const parts = Math.max(1, Math.ceil(length / size - 1e-9));
        for (let k = 0; k < parts; k++) {
            const a = intervals.from[i] + length * k / parts, b = intervals.from[i] + length * (k + 1) / parts;
            const p = placeAt(intervals.hole[i], (a + b) / 2);
            if (!p) continue;
            hole.push(intervals.hole[i]); from.push(a); to.push(b); positions.push(p[0], p[1], p[2]);
            logged.push(intervals.logged[i] > 0 ? 1 : -1);
        }
    }
    return { hole: Int32Array.from(hole), from: Float64Array.from(from), to: Float64Array.from(to), positions: Float64Array.from(positions), logged: Int8Array.from(logged) };
}

/** Pieces that touch (the next starts no further than this below the last, m) are one run */
const TOUCH = 1e-6;

/** The runs of flagged pieces down each hole: pieces of one hole that follow on from each other. */
export function stretchesOf(pieces: LoggedPieces, flagged: (piece: number) => boolean): Stretch[] {
    const out: Stretch[] = [];
    let open: Stretch | null = null;
    for (let i = 0; i < pieces.hole.length; i++) {
        if (!flagged(i)) { open = null; continue; }
        if (open && open.hole === pieces.hole[i] && pieces.from[i] <= open.to + TOUCH) open.to = Math.max(open.to, pieces.to[i]);
        else out.push(open = { hole: pieces.hole[i], from: pieces.from[i], to: pieces.to[i] });
    }
    return out;
}

export interface StretchCount {
    /** How many runs there are */
    count: number;
    /** Of them, how many have one of the other kind within each of the tolerances, in order */
    met: number[];
}

export interface LoggedScore {
    /** The distances a run may be from one of the other kind and count as met, m */
    tolerances: number[];
    /** Metres of logged hole: the unit inside the body, the unit outside it, other ground inside it, other ground outside it */
    found: number;
    missed: number;
    wrong: number;
    right: number;
    /** Of the unit's metres, the share inside the body (null: none logged) */
    foundShare: number | null;
    /** Of the logged metres inside the body, the share that is the unit (null: nothing inside) */
    sureShare: number | null;
    /** Runs of the unit down the holes, and how many have the body within reach */
    logged: StretchCount;
    /** Runs of hole inside the body, and how many have the unit within reach */
    modelled: StretchCount;
    /** Where a logged run and a modelled one overlap: how many pairs, and the middle one's modelled length over its logged length (null: none) */
    pairs: number;
    thicknessRatio: number | null;
}

export const SCORE_TOLERANCES = [0, 1, 2, 5];

/** How far apart two runs of one hole are down it (0: they overlap or touch) */
const gap = (a: Stretch, b: Stretch) => Math.max(0, a.from - b.to, b.from - a.to);

function counted(runs: readonly Stretch[], others: readonly Stretch[], tolerances: readonly number[]): StretchCount {
    const byHole = new Map<number, Stretch[]>();
    for (const o of others) {
        const own = byHole.get(o.hole);
        if (own) own.push(o); else byHole.set(o.hole, [o]);
    }
    const met = tolerances.map(() => 0);
    for (const r of runs) {
        let nearest = Infinity;
        for (const o of byHole.get(r.hole) ?? []) nearest = Math.min(nearest, gap(r, o));
        tolerances.forEach((t, k) => { if (nearest <= t + 1e-9) met[k]++; });
    }
    return { count: runs.length, met };
}

/**
 * The score of a body against pieces of logging. `inside`: per piece, whether
 * the body holds its middle (anything above 0 counts).
 */
export function scoreLogged(pieces: LoggedPieces, inside: ArrayLike<number | boolean>, tolerances: readonly number[] = SCORE_TOLERANCES): LoggedScore {
    let found = 0, missed = 0, wrong = 0, right = 0;
    const n = pieces.hole.length;
    const isIn = (i: number) => Number(inside[i]) > 0;
    for (let i = 0; i < n; i++) {
        const length = pieces.to[i] - pieces.from[i];
        if (pieces.logged[i] > 0) { if (isIn(i)) found += length; else missed += length; } else if (isIn(i)) wrong += length; else right += length;
    }
    const unit = stretchesOf(pieces, i => pieces.logged[i] > 0);
    const body = stretchesOf(pieces, isIn);
    // Thickness: each logged run against the modelled runs it overlaps, taken together
    const ratios: number[] = [];
    const byHole = new Map<number, Stretch[]>();
    for (const b of body) {
        const own = byHole.get(b.hole);
        if (own) own.push(b); else byHole.set(b.hole, [b]);
    }
    for (const u of unit) {
        let modelled = 0;
        for (const b of byHole.get(u.hole) ?? []) if (b.from < u.to && b.to > u.from) modelled += b.to - b.from;
        if (modelled > 0) ratios.push(modelled / (u.to - u.from));
    }
    ratios.sort((a, b) => a - b);
    const mid = ratios.length >> 1;
    return {
        tolerances: tolerances.slice(), found, missed, wrong, right,
        foundShare: found + missed > 0 ? found / (found + missed) : null,
        sureShare: found + wrong > 0 ? found / (found + wrong) : null,
        logged: counted(unit, body, tolerances),
        modelled: counted(body, unit, tolerances),
        pairs: ratios.length,
        thicknessRatio: ratios.length === 0 ? null : ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2,
    };
}

/** Scores of several rounds (each with other holes kept out) as one: metres and runs added up, the thickness ratio weighted by its pairs */
export function addScores(scores: readonly LoggedScore[]): LoggedScore | null {
    if (scores.length === 0) return null;
    const tolerances = scores[0].tolerances;
    const sum = (pick: (s: LoggedScore) => number) => scores.reduce((t, s) => t + pick(s), 0);
    const counts = (pick: (s: LoggedScore) => StretchCount): StretchCount => ({ count: sum(s => pick(s).count), met: tolerances.map((_, k) => sum(s => pick(s).met[k])) });
    const found = sum(s => s.found), missed = sum(s => s.missed), wrong = sum(s => s.wrong), pairs = sum(s => s.pairs);
    return {
        tolerances, found, missed, wrong, right: sum(s => s.right),
        foundShare: found + missed > 0 ? found / (found + missed) : null,
        sureShare: found + wrong > 0 ? found / (found + wrong) : null,
        logged: counts(s => s.logged), modelled: counts(s => s.modelled), pairs,
        thicknessRatio: pairs > 0 ? sum(s => (s.thicknessRatio ?? 0) * s.pairs) / pairs : null,
    };
}

export interface GradeScore {
    /** Metres of sampled hole, and how many of them are inside the body */
    metres: number;
    metresInside: number;
    /** Grade times metres, all of it and what is inside */
    metal: number;
    metalInside: number;
    /** The length-weighted grade inside and outside (null: no metres there) */
    gradeInside: number | null;
    gradeOutside: number | null;
}

/** How much of what was assayed a body holds: samples by their length, grade and whether the body holds their middle. */
export function scoreGrade(length: ArrayLike<number>, grade: ArrayLike<number>, inside: ArrayLike<number | boolean>): GradeScore {
    let metres = 0, metresInside = 0, metal = 0, metalInside = 0;
    for (let i = 0; i < length.length; i++) {
        if (!(length[i] > 0) || !Number.isFinite(grade[i])) continue;
        metres += length[i];
        metal += length[i] * grade[i];
        if (Number(inside[i]) > 0) { metresInside += length[i]; metalInside += length[i] * grade[i]; }
    }
    return {
        metres, metresInside, metal, metalInside,
        gradeInside: metresInside > 0 ? metalInside / metresInside : null,
        gradeOutside: metres - metresInside > 0 ? (metal - metalInside) / (metres - metresInside) : null,
    };
}

// --- At what scale a model holds -----------------------------------------

/** The lengths of hole the unit's share is compared over, m */
export const SHARE_WINDOWS = [1, 2, 5, 10, 20, 40];
/** A model holds at a length when its skill there, and at every longer one, is at least this */
export const HELD_SKILL = 0.25;
/** A window counts when at least this share of its length is logged, and a length when it has at least this many windows */
const WINDOW_LOGGED = 0.5;
const MIN_WINDOWS = 20;

/** The windows of one length, added up: what a skill is worked out from (so rounds with other holes kept out add up) */
export interface ShareSums {
    /** The length of the windows, m */
    window: number;
    /** How many windows there are, and their logged metres */
    windows: number;
    metres: number;
    /** By logged metres: the logged share, the modelled share, their squares and their product, added up */
    logged: number;
    modelled: number;
    logged2: number;
    modelled2: number;
    both: number;
}

export interface ShareScale extends ShareSums {
    /**
     * 1 less the squared error of the modelled share over that of saying the
     * overall share everywhere: 1 = the logging itself, 0 = no better than
     * saying the overall share, below 0 = worse. Null: too few windows, or the
     * share is the same in every one.
     */
    skill: number | null;
    /**
     * How well the model says WHERE there is more of the unit, whatever it
     * says of how much: the correlation of the modelled share with the logged
     * one, window by window (1 = more exactly where more is logged, 0 = no
     * relation). A model that encloses too much everywhere can have a skill
     * below 0 and still know where. Null: too few windows, or no spread.
     */
    where: number | null;
}

export interface ShareScore {
    /** Of the logged metres, the share that is the unit; and the share the model says */
    loggedShare: number | null;
    modelledShare: number | null;
    /** Each length of window, the shortest first */
    scales: ShareScale[];
    /** The shortest length it holds at (null: none) */
    holds: number | null;
}

const skillOf = (s: ShareSums): number | null => {
    if (s.windows < MIN_WINDOWS || !(s.metres > 0)) return null;
    const mean = s.logged / s.metres;
    const spread = s.logged2 - 2 * mean * s.logged + mean * mean * s.metres;
    if (!(spread > 1e-12 * s.metres)) return null;
    return 1 - (s.modelled2 - 2 * s.both + s.logged2) / spread;
};

const whereOf = (s: ShareSums): number | null => {
    if (s.windows < MIN_WINDOWS || !(s.metres > 0)) return null;
    const l = s.logged / s.metres, m = s.modelled / s.metres;
    const ll = s.logged2 / s.metres - l * l, mm = s.modelled2 / s.metres - m * m;
    if (!(ll > 1e-12) || !(mm > 1e-12)) return null;
    return (s.both / s.metres - l * m) / Math.sqrt(ll * mm);
};

function shareScore(sums: readonly ShareSums[]): ShareScore {
    const scales = sums.map((s): ShareScale => ({ ...s, skill: skillOf(s), where: whereOf(s) }));
    // The shortest length from which every longer one that could be scored is held as well
    let holds: number | null = null;
    for (let k = scales.length - 1; k >= 0; k--) {
        const skill = scales[k].skill;
        if (skill === null) continue;
        if (skill < HELD_SKILL) break;
        holds = scales[k].window;
    }
    const finest = scales[0];
    return {
        loggedShare: finest && finest.metres > 0 ? finest.logged / finest.metres : null,
        modelledShare: finest && finest.metres > 0 ? finest.modelled / finest.metres : null,
        scales, holds,
    };
}

/**
 * How much of the unit a model says there is, against the logging, over
 * lengths of hole. A dyke modelled a metre from where it was logged is wrong
 * metre by metre and right over ten metres; this says from what length a
 * model can be relied on.
 *
 * Each hole is cut into windows of each length from its first logged piece.
 * In a window: the share of its logged metres that is the unit, and the
 * share the model says. `modelled`, per piece: for a solid, whether it holds
 * the piece's middle (above 0 counts as all of it); with `asShare`, the
 * share of the piece that is the unit (kept between 0 and 1).
 */
export function scoreShare(pieces: LoggedPieces, modelled: ArrayLike<number | boolean>, options: { windows?: readonly number[]; asShare?: boolean } = {}): ShareScore {
    const windows = options.windows ?? SHARE_WINDOWS;
    const n = pieces.hole.length;
    const said = (i: number): number => {
        const v = Number(modelled[i]);
        if (!options.asShare) return v > 0 ? 1 : 0;
        return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
    };
    const sums = windows.map((window): ShareSums => {
        const s: ShareSums = { window, windows: 0, metres: 0, logged: 0, modelled: 0, logged2: 0, modelled2: 0, both: 0 };
        let hole = -1, start = 0, at = -1, metres = 0, unit = 0, model = 0;
        const close = () => {
            if (metres >= WINDOW_LOGGED * window) {
                const l = unit / metres, m = model / metres;
                s.windows++; s.metres += metres; s.logged += metres * l; s.modelled += metres * m; s.logged2 += metres * l * l; s.modelled2 += metres * m * m; s.both += metres * l * m;
            }
            metres = 0; unit = 0; model = 0;
        };
        for (let i = 0; i < n; i++) {
            if (pieces.hole[i] !== hole) { close(); hole = pieces.hole[i]; start = pieces.from[i]; at = 0; }
            const k = Math.floor(((pieces.from[i] + pieces.to[i]) / 2 - start) / window);
            if (k !== at) { close(); at = k; }
            const length = pieces.to[i] - pieces.from[i];
            metres += length;
            if (pieces.logged[i] > 0) unit += length;
            model += length * said(i);
        }
        close();
        return s;
    });
    return shareScore(sums);
}

/** Share scores of several rounds (each with other holes kept out) as one */
export function addShares(scores: readonly ShareScore[]): ShareScore | null {
    if (scores.length === 0) return null;
    const sums = scores[0].scales.map((first, k): ShareSums => {
        const s: ShareSums = { window: first.window, windows: 0, metres: 0, logged: 0, modelled: 0, logged2: 0, modelled2: 0, both: 0 };
        for (const score of scores) {
            const o = score.scales[k];
            if (!o || o.window !== first.window) continue;
            s.windows += o.windows; s.metres += o.metres; s.logged += o.logged; s.modelled += o.modelled; s.logged2 += o.logged2; s.modelled2 += o.modelled2; s.both += o.both;
        }
        return s;
    });
    return shareScore(sums);
}
