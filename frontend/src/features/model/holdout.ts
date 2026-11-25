/**
 * Checking a shell against holes it was not shown (pure, unit-tested).
 *
 * A shell always takes in the samples it was fitted to, so that it does is
 * no measure of it. The test of a shell is the ground between the holes,
 * and the only ground whose values are known is the holes themselves: so a
 * few holes are left out, the shell is fitted again without them, and their
 * samples are then counted against it. How many of their high samples it
 * takes in, and how much of what it takes in there is low, is what to
 * compare a cut-off, an averaging length or a structure by.
 *
 * The holes left out are ones with a value at or above the cut-off, a few
 * at a time and spread about, so that each still has its neighbours.
 */
import { findIntercepts, flaggedSamples, INTERCEPT_LEVEL, interceptChoice } from './intercepts';
import { evaluateField as fieldAt, type Stretch } from './rbf';
import { fitShell, prepareSamples, shellFitting, shellInputs, type ShellChoice, type ShellLayers, type ShellSamples } from './shell';
import type { Box3, ShellRule } from './types';

export interface ShellCheckJob {
    samples: ShellSamples;
    /** The shell's rule: its cut-off, how its samples are prepared and how it is found */
    rule: ShellRule;
    /** The space it is fitted in (null: as it is) */
    stretch: Stretch | null;
    /** It follows the ground as it lies from place to place (left out, null: it does not) */
    layers?: ShellLayers | null;
    /** From the values: 0 = through every one; larger = looser */
    smoothing: number;
    /** How many times the shell is fitted again (default 8) */
    rounds?: number;
}

export interface ShellCheck {
    /** Holes left out in all, and how many at a time */
    holes: number;
    atATime: number;
    /** Holes with a value at or above the cut-off: the ones to choose from */
    holesWithHigh: number;
    /** Times the shell was fitted again */
    rounds: number;
    /** In the holes left out: every place with a value; those at or above the cut-off; and how many of those the shell took in */
    places: number;
    high: number;
    found: number;
    /** In the holes left out: every place the shell took in, and how many of those are below the cut-off */
    inside: number;
    lowInside: number;
}

/** A shell is fitted again this many times */
const ROUNDS = 8;
/** This share of the holes with high values is left out each time */
const SHARE = 0.03;

function stream(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function boundsOf(points: ArrayLike<number>): Box3 | null {
    if (points.length < 3) return null;
    const box: Box3 = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (let i = 0; i < points.length; i++) {
        box.min[i % 3] = Math.min(box.min[i % 3], points[i]);
        box.max[i % 3] = Math.max(box.max[i % 3], points[i]);
    }
    return box;
}

/** The rows of `samples` picked out. */
function rowsOf(samples: ShellSamples, rows: readonly number[]): ShellSamples {
    const numbers = (from: ArrayLike<number> | null) => (from ? Float64Array.from(rows, i => from[i]) : null);
    return {
        hole: samples.hole ? rows.map(i => samples.hole![i]) : null,
        from: numbers(samples.from), to: numbers(samples.to),
        x: numbers(samples.x)!, y: numbers(samples.y)!, z: numbers(samples.z)!, value: numbers(samples.value)!,
    };
}

/**
 * Leave holes out, fit the shell without them, and count their samples
 * against it. Null when there is nothing to check with: the hole and depth
 * columns are not known, or fewer than three holes have a high value.
 * `onRound` is told as each fit is done.
 */
export function checkShell(job: ShellCheckJob, onRound?: (done: number, of: number) => void): ShellCheck | null {
    let { samples, rule } = job;
    if (!samples.hole) return null;
    // Built from intercepts: the samples as in one or not, and it is checked for the ones that are
    if (rule.method === 'intercepts') {
        const found = findIntercepts(samples, interceptChoice(rule));
        if (!found) return null;
        samples = flaggedSamples(samples, found);
        rule = { ...rule, cutoff: INTERCEPT_LEVEL, composite: null, topCut: null };
    }
    const choice: ShellChoice = { cutoff: rule.cutoff, composite: rule.composite, topCut: rule.topCut, reach: rule.reach, stretch: job.stretch, layers: job.layers ?? null };
    const prepared = prepareSamples(samples);
    if (prepared.holes === 0) return null;
    const asked = choice.composite != null && choice.composite > 0 ? choice.composite : null;
    const topCut = choice.topCut != null && Number.isFinite(choice.topCut) ? choice.topCut : null;
    // The holes with a place at or above the cut-off, as the shell counts them
    const all = prepared.places(asked, topCut);
    const withHigh = new Set<number>();
    for (let i = 0; i < all.v.length; i++) if (all.v[i] >= choice.cutoff) withHigh.add(all.hole[i]);
    if (withHigh.size < 3) return null;

    // In a settled order, shuffled the same way every time: the same shell gives the same check
    const names = [...withHigh].map(h => prepared.holeNames[h]).sort();
    const next = stream(names.length * 2654435761);
    for (let i = names.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [names[i], names[j]] = [names[j], names[i]];
    }
    const atATime = Math.max(1, Math.ceil(SHARE * names.length));
    const rounds = Math.max(1, Math.min(job.rounds ?? ROUNDS, Math.floor(names.length / atATime)));

    const rowsByHole = new Map<string, number[]>();
    const holeOf = samples.hole!;
    for (let i = 0; i < samples.value.length; i++) {
        const own = rowsByHole.get(holeOf[i]);
        if (own) own.push(i);
        else rowsByHole.set(holeOf[i], [i]);
    }
    const everywhere = boundsOf(all.pos);
    const out: ShellCheck = { holes: 0, atATime, holesWithHigh: names.length, rounds, places: 0, high: 0, found: 0, inside: 0, lowInside: 0 };
    for (let r = 0; r < rounds; r++) {
        const gone = new Set(names.slice(r * atATime, (r + 1) * atATime));
        const kept: number[] = [], left: number[] = [];
        for (const [hole, rows] of rowsByHole) for (const i of rows) (gone.has(hole) ? left : kept).push(i);
        out.holes += gone.size;
        // What the holes left out hold, counted as the shell counts (averaged and cut the same way)
        const theirs = prepareSamples(rowsOf(samples, left)).places(asked, topCut);
        let f: Float64Array | null = null;
        const inputs = shellInputs(rowsOf(samples, kept), choice);
        if (inputs.values.length > 0 && everywhere) {
            const pad = Math.max(everywhere.max[0] - everywhere.min[0], everywhere.max[1] - everywhere.min[1], everywhere.max[2] - everywhere.min[2]) * 0.01 + 1;
            const cover: Box3 = {
                min: [everywhere.min[0] - pad, everywhere.min[1] - pad, everywhere.min[2] - pad],
                max: [everywhere.max[0] + pad, everywhere.max[1] + pad, everywhere.max[2] + pad],
            };
            const fitting = shellFitting(rule, inputs.values);
            const fit = fitShell({
                positions: inputs.positions, next: inputs.next, reach: inputs.reach, cover, stretch: inputs.stretch, layers: inputs.layers, seeds: false,
                ...fitting, smoothing: fitting.local === null ? job.smoothing : 0,
            });
            if (fit.status === 'body' && fit.field) f = fieldAt(fit.field, theirs.pos);
        }
        out.places += theirs.v.length;
        for (let i = 0; i < theirs.v.length; i++) {
            const high = theirs.v[i] >= choice.cutoff, inside = f !== null && f[i] >= 0;
            if (high) out.high++;
            if (inside) {
                out.inside++;
                if (high) out.found++;
                else out.lowInside++;
            }
        }
        onRound?.(r + 1, rounds);
    }
    return out;
}
