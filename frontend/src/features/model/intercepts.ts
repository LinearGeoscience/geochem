/**
 * Intercepts down the holes (pure, unit-tested): the runs a drilling
 * result is usually reported by, "12 m at 3.1 from 45 m".
 *
 * A run starts and ends on a sample at or above the cut-off. Runs are
 * joined across lower values between them when those are no longer than
 * the waste allowed and the whole still averages the cut-off or more. A run
 * is kept when it is at least the minimum length, or rich enough to
 * average the cut-off over that length with nothing either side of it.
 * Averages are weighted by sample length; an unsampled gap counts as
 * nothing at all over its length.
 *
 * A shell built from intercepts takes each sample as in one or not, and is
 * put round those that are: every sample of a kept run, the lower ones
 * inside it too, and none of the high ones that were not kept.
 */
import type { Stretch } from './rbf';
import { shellInputs, type ShellInputs, type ShellLayers, type ShellSamples } from './shell';
import type { ShellRule } from './types';

export interface InterceptChoice {
    cutoff: number;
    /** A run is at least this long down the hole, m (or rich enough to average the cut-off over it) */
    minLength: number;
    /** Lower values inside a run are no longer than this in a row, m */
    maxWaste: number;
    /** No sample counts as more than this (null: as assayed) */
    topCut?: number | null;
}

export interface Intercept {
    hole: string;
    from: number;
    to: number;
    /** Its average, weighted by length */
    grade: number;
    /** The rows of the samples in it */
    rows: number[];
}

export interface Intercepts {
    list: Intercept[];
    /** For each sample row: 1 when it is in an intercept */
    flags: Uint8Array;
    /** Holes with a sample, and with an intercept */
    holes: number;
    holesWith: number;
    /** Their length in all, m, and their average over it */
    length: number;
    grade: number;
}

/** Depths closer than this are the same depth, m */
const EPS = 1e-6;

interface Segment { from: number; to: number; grade: number; row: number }

/**
 * The intercepts down each hole. Null when the hole and depth columns are
 * not known: there is no down-the-hole to run along.
 */
export function findIntercepts(samples: ShellSamples, choice: InterceptChoice): Intercepts | null {
    const { hole, from, to, value } = samples;
    if (!hole || !from || !to) return null;
    const cutoff = choice.cutoff, minLength = Math.max(0, choice.minLength), maxWaste = Math.max(0, choice.maxWaste);
    const cap = choice.topCut != null && Number.isFinite(choice.topCut) ? choice.topCut : Infinity;
    const byHole = new Map<string, number[]>();
    for (let i = 0; i < value.length; i++) {
        if (!(to[i] > from[i]) || !Number.isFinite(from[i]) || hole[i] == null || hole[i] === '') continue;
        const own = byHole.get(hole[i]);
        if (own) own.push(i);
        else byHole.set(hole[i], [i]);
    }
    const out: Intercepts = { list: [], flags: new Uint8Array(value.length), holes: byHole.size, holesWith: 0, length: 0, grade: 0 };
    let metalInAll = 0;
    for (const [name, rows] of byHole) {
        rows.sort((a, b) => from[a] - from[b]);
        // Down the hole: its samples, and the gaps between them as nothing at all
        const segs: Segment[] = [];
        for (const i of rows) {
            const last = segs[segs.length - 1];
            if (last && from[i] - last.to > EPS) segs.push({ from: last.to, to: from[i], grade: 0, row: -1 });
            const v = value[i];
            segs.push({ from: from[i], to: to[i], grade: Number.isFinite(v) ? Math.min(v, cap) : 0, row: i });
        }
        // Length and metal down to each segment
        const len = new Float64Array(segs.length + 1), metal = new Float64Array(segs.length + 1);
        segs.forEach((s, k) => {
            len[k + 1] = len[k] + (s.to - s.from);
            metal[k + 1] = metal[k] + (s.to - s.from) * s.grade;
        });
        const lengthOf = (a: number, b: number) => len[b + 1] - len[a];
        const gradeOf = (a: number, b: number) => (metal[b + 1] - metal[a]) / lengthOf(a, b);

        // Runs of samples at or above the cut-off, one after another
        const runs: [number, number][] = [];
        for (let k = 0; k < segs.length; k++) {
            if (!(segs[k].row >= 0 && segs[k].grade >= cutoff)) continue;
            const last = runs[runs.length - 1];
            if (last && last[1] === k - 1) last[1] = k;
            else runs.push([k, k]);
        }
        // Joined across lower values, the richest join first, for as long as the whole averages the cut-off
        for (;;) {
            let best = -1, bestGrade = -Infinity;
            for (let r = 0; r + 1 < runs.length; r++) {
                if (lengthOf(runs[r][1] + 1, runs[r + 1][0] - 1) > maxWaste + EPS) continue;
                const g = gradeOf(runs[r][0], runs[r + 1][1]);
                if (g >= cutoff && g > bestGrade) {
                    best = r;
                    bestGrade = g;
                }
            }
            if (best < 0) break;
            runs.splice(best, 2, [runs[best][0], runs[best + 1][1]]);
        }
        let any = false;
        for (const [a, b] of runs) {
            const length = lengthOf(a, b), carried = metal[b + 1] - metal[a];
            if (length < minLength - EPS && carried < cutoff * minLength) continue;
            const inIt: number[] = [];
            for (let k = a; k <= b; k++) {
                if (segs[k].row < 0) continue;
                inIt.push(segs[k].row);
                out.flags[segs[k].row] = 1;
            }
            out.list.push({ hole: name, from: segs[a].from, to: segs[b].to, grade: carried / length, rows: inIt });
            out.length += length;
            metalInAll += carried;
            any = true;
        }
        if (any) out.holesWith++;
    }
    out.grade = out.length > 0 ? metalInAll / out.length : 0;
    return out;
}

/** A shell from intercepts is put where a sample is in one (1) rather than not (0): at this level between them */
export const INTERCEPT_LEVEL = 0.5;

/** The samples with 1 for a value when they are in an intercept and 0 when they are not (outside one, a sample with no value stays without) */
export function flaggedSamples(samples: ShellSamples, found: Intercepts): ShellSamples {
    const value = new Float64Array(samples.value.length);
    for (let i = 0; i < value.length; i++) value[i] = found.flags[i] === 1 ? 1 : Number.isFinite(samples.value[i]) ? 0 : NaN;
    return { ...samples, value };
}

/** What a rule asks of the intercepts (a rule from before the lengths were kept takes a metre and none) */
export function interceptChoice(rule: ShellRule): InterceptChoice {
    return { cutoff: rule.cutoff, minLength: rule.minLength ?? 1, maxWaste: rule.maxWaste ?? 0, topCut: rule.topCut };
}

/** How a shell's rule is read as a cut-off on what it is fitted to: its own, or in an intercept or not */
export function ruleLevel(rule: ShellRule): number {
    return rule.method === 'intercepts' ? INTERCEPT_LEVEL : rule.cutoff;
}

/**
 * What a shell is fitted to, by its rule: its samples, or, built from
 * intercepts, its samples as in one or not (`intercepts` then says what was
 * found; null when the hole and depth columns are not known).
 */
export function ruleInputs(samples: ShellSamples, rule: ShellRule, stretch: Stretch | null, layers: ShellLayers | null = null): ShellInputs {
    if (rule.method !== 'intercepts') return shellInputs(samples, { cutoff: rule.cutoff, composite: rule.composite, topCut: rule.topCut, reach: rule.reach, stretch, layers });
    const found = findIntercepts(samples, interceptChoice(rule));
    const flagged = found ? flaggedSamples(samples, found) : { ...samples, value: new Float64Array(samples.value.length) };
    const inputs = shellInputs(flagged, { cutoff: INTERCEPT_LEVEL, reach: rule.reach, stretch, layers });
    return { ...inputs, intercepts: found ? { count: found.list.length, holes: found.holes, holesWith: found.holesWith, length: found.length, grade: found.grade } : null };
}
