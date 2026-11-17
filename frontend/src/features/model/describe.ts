/**
 * A surface's state in plain words, for the Surfaces panel (pure, unit-tested).
 */
import type { ContactInputs } from './contacts';
import { countAtOrAbove, DEFAULT_LOCAL, DEFAULT_SHARE, type ShellInputs } from './shell';
import type { SurfaceResult } from './modelCache';
import { dipFromNormal } from './plane';
import { MAX_READINGS } from './readings';
import { structureAxes, structureText } from './structure';
import { MAX_CONTACT_POINTS } from './surfaceJobs';
import type { OverallStructure, SurfaceObject } from './types';

/** A length for reading: 0.4 m, 12 m, 1.2 km. */
export function formatMetres(v: number): string {
    const a = Math.abs(v);
    if (a >= 10_000) return `${(v / 1000).toFixed(1)} km`;
    if (a >= 10) return `${Math.round(v)} m`;
    if (a >= 0.95) return `${v.toFixed(1)} m`;
    return `${Number(v.toPrecision(1))} m`;
}

/** A volume for reading: 850 m³, 12,300 m³, 1.23 million m³. */
export function formatVolume(v: number): string {
    if (v >= 1e9) return `${Number((v / 1e9).toPrecision(3))} billion m³`;
    if (v >= 1e6) return `${Number((v / 1e6).toPrecision(3))} million m³`;
    return `${Number(v.toPrecision(3)).toLocaleString()} m³`;
}

export interface SurfaceStatus {
    /** One line: what there is */
    headline: string;
    /** Further lines, each a full sentence */
    notes: string[];
    /** Something is wrong or missing (shown as a warning) */
    problem: boolean;
    /** A newer version is being worked out */
    busy: boolean;
}

/** A share for reading: 6%, under 1%. */
function shareOf(part: number, whole: number): string {
    const pct = whole > 0 ? 100 * part / whole : 0;
    return pct > 0 && pct < 1 ? 'under 1%' : `${Math.round(pct)}%`;
}

const tidy = (v: number) => String(Number(v.toPrecision(2)));

/** How far a shell reaches, where the holes are close and where they are far apart */
function reachText([near, far]: [number, number]): string {
    const a = formatMetres(near), b = formatMetres(far);
    return a === b ? `${a} here` : `${a} where they are close, ${b} where they are far apart`;
}

/** Misses smaller than this are "through the points" (m) */
const EXACT = 0.005;

/** How a surface that follows the model's structure was fitted. */
function followText(s: OverallStructure): string {
    const line = structureAxes(s).line !== null && s.lineStrength > 1;
    const plane = s.strength > 1 ? `it carries ${tidy(s.strength)} times further along it than across it` : '';
    const long = line ? `${tidy(s.lineStrength)} times further along its long direction than across that` : '';
    return `It is fitted along the structure set for the model (${structureText(s)}): ${[plane, long].filter(Boolean).join(', and ')}.`;
}

/** A shell's state: what it is round, how much it encloses. */
function shellStatus(surface: SurfaceObject, result: SurfaceResult | undefined, inputs: ShellInputs | null, structure: OverallStructure | null): SurfaceStatus {
    const rule = surface.rule;
    if (rule.kind !== 'shell') return { headline: '', notes: [], problem: false, busy: false };
    if (!inputs) return { headline: `The column ${rule.column}, or a coordinate column, is not in this dataset.`, notes: [], problem: true, busy: false };
    const n = inputs.sorted.length;
    if (n === 0) return { headline: `No sample has a value of ${rule.column}.`, notes: [], problem: true, busy: false };
    // Built from intercepts, the samples count as in one or not
    const runs = rule.method === 'intercepts' ? inputs.intercepts ?? null : undefined;
    if (runs === null) return { headline: 'Intercepts run down the holes: this needs the hole and depth columns.', notes: [], problem: true, busy: false };
    const above = countAtOrAbove(inputs.sorted, runs ? 0.5 : rule.cutoff);
    // What is counted: the samples, or their averages over the length asked for
    const asked = !runs && rule.composite !== null && inputs.holes > 0 ? rule.composite : null;
    const one = asked !== null ? `averages over ${formatMetres(asked)}` : 'samples';
    /** The ones the shell is for, and the rest */
    const high = runs ? 'samples in an intercept' : `${one} at or above ${rule.cutoff}`;
    const whatRun = runs ? `a run down a hole that averages ${rule.cutoff} or more over at least ${formatMetres(rule.minLength ?? 1)}${(rule.maxWaste ?? 0) > 0 ? `, with no more than ${formatMetres(rule.maxWaste!)} of lower values in a row inside it` : ', with no lower values inside it'}` : '';
    if (runs && runs.count === 0) return { headline: `No ${whatRun.slice(2)}: there is nothing to put a shell round.`, notes: [], problem: true, busy: false };
    const samples = runs
        ? `${runs.count.toLocaleString()} ${runs.count === 1 ? 'intercept' : 'intercepts'} in ${runs.holesWith.toLocaleString()} of ${runs.holes.toLocaleString()} holes: ${formatMetres(runs.length)} in all, averaging ${tidy(runs.grade)}`
        : `${above.toLocaleString()} of ${n.toLocaleString()} ${one} are at or above ${rule.cutoff}`;
    if (above === 0) return { headline: `${asked !== null ? `No average over ${formatMetres(asked)}` : 'No sample'} reaches ${rule.cutoff}: there is nothing to put a shell round.`, notes: [], problem: true, busy: false };
    if (above === n) return { headline: `Every ${asked !== null ? `average over ${formatMetres(asked)}` : 'sample'} is ${runs ? 'in an intercept' : `at or above ${rule.cutoff}`}: there would be nothing outside the shell.`, notes: [], problem: true, busy: false };
    if (!result || (result.state === 'fitting' && !result.part)) return { headline: `${samples}. Working it out…`, notes: [], problem: false, busy: true };
    if (result.state === 'failed') return { headline: `${samples}. A shell could not be fitted round them.`, notes: ['Try letting it follow the samples less closely.'], problem: true, busy: false };
    // What it was fitted to, when that is not simply every sample
    const averaged: string[] = [];
    if (inputs.forced && inputs.composite !== null) averaged.push(`There are too many ${runs ? 'in intercepts' : `at or above ${rule.cutoff}`} to fit one by one: they were averaged over ${formatMetres(inputs.composite)} down each hole first.`);
    else if (inputs.composite !== null) averaged.push(`The samples were averaged over ${formatMetres(inputs.composite)} down each hole first.`);
    if (rule.topCut !== null && !runs) averaged.push(inputs.capped > 0 ? `${inputs.capped.toLocaleString()} ${inputs.capped === 1 ? 'sample' : 'samples'} above ${rule.topCut} ${inputs.capped === 1 ? 'was' : 'were'} taken as ${rule.topCut} (the top cut).` : `No sample is above the top cut of ${rule.topCut}.`);
    if (inputs.merged > 0) averaged.push(`Away from the high ones, ${inputs.merged.toLocaleString()} lower ${one} were averaged down the hole so that it fits quickly.`);
    // Averaged, no place may reach the cut-off though single samples do
    if (result.state === 'empty') return { headline: `${samples}, but once averaged none is: there is nothing to put a shell round.`, notes: averaged, problem: true, busy: false };
    const busy = result.state === 'fitting';
    const notes: string[] = [];
    const body = result.stats?.body, counts = result.stats?.shell;
    if (body && !busy) {
        if (body.volume !== null && body.volume > 0) notes.push(`It encloses ${formatVolume(body.volume)}${body.pieces > 1 ? `, in ${body.pieces.toLocaleString()} separate pieces` : ''}.`);
        if (body.cut) notes.push('It reaches the edge of the data and is closed off flat there.');
    }
    if (counts && !busy && counts.high > 0) {
        const inside = counts.inside === counts.high ? `Every one of the ${counts.high.toLocaleString()} ${high} is inside it`
            : `${counts.inside.toLocaleString()} of the ${counts.high.toLocaleString()} ${high} are inside it`;
        const low = counts.lowInside > 0 ? `; ${shareOf(counts.lowInside, counts.inside + counts.lowInside)} of the ${one} inside it are ${runs ? 'not in one' : `below ${rule.cutoff}`}` : '';
        notes.push(`${inside}${low}.`);
        if (counts.small > 0 && body) {
            notes.push(`${counts.small.toLocaleString()} of them stand alone among lower values: the shell round each is under ${formatMetres(body.cell)} across and is not drawn.`);
        }
    }
    const along = inputs.stretch && structure ? structure : null;
    const layers = inputs.layers;
    notes.push(`From a sample ${runs ? 'in an intercept' : `at or above ${rule.cutoff}`} it may reach ${tidy(inputs.reachFactor)} times the distance between the holes there${along ? ', measured along the structure' : layers ? ', measured along the ground as it lies' : ''}: ${reachText(inputs.reachRange)}.`);
    if (along) notes.push(followText(along));
    if (layers) notes.push(`It follows the ground as the readings the model follows say it lies, from place to place: it carries ${tidy(layers.strength)} times further along it than across it.`);
    notes.push(...averaged);
    if (runs) {
        notes.push(`An intercept is ${whatRun}. A shorter run counts when it is rich enough to average ${rule.cutoff} over that length.`);
        if (rule.topCut !== null) notes.push(`No sample counts as more than ${rule.topCut} (the top cut).`);
    } else if (rule.method === 'indicator') {
        const local = rule.local ?? DEFAULT_LOCAL;
        notes.push(`It is found by counting: each of the ${one} counts as at or above ${rule.cutoff} or not, whatever its value, and the shell is where ${Math.round(100 * (rule.share ?? DEFAULT_SHARE))}% of those round about are (about ${tidy(local)} each way down a hole taken together).`);
    } else {
        if (rule.log) notes.push('Worked out on the logarithms of the values.');
        if (!rule.band) notes.push('Very high and very low values count in full.');
    }
    if (result.stats?.truncated) notes.push('Too large to draw in full.');
    if (result.part && result.part.triangles.length === 0 && !busy) notes.push('Nothing to draw: the values at or above it are too small a part of the data to show.');
    return { headline: `${samples}.`, notes, problem: false, busy };
}

/**
 * `found`: for a surface built from logging, what the logging gives it
 * (null: the columns it needs are not in the dataset). `shell`: for a
 * shell, the samples it is fitted to. `structure`: the structure set for
 * the model, which shells and bodies follow unless told not to.
 */
export function surfaceStatus(
    surface: SurfaceObject, result: SurfaceResult | undefined, found: ContactInputs | null = null, shell: ShellInputs | null = null, structure: OverallStructure | null = null,
): SurfaceStatus {
    if (surface.rule.kind === 'shell') return shellStatus(surface, result, shell, structure);
    const fromLogging = surface.rule.kind !== 'sheet';
    // A closed body: its contacts and hand-placed points are places on its skin; lines and readings play no part
    const body = surface.rule.kind === 'body';
    const contacts = fromLogging && found ? found.contacts.length / 3 : 0;
    const n = surface.points.length, lines = body ? 0 : surface.polylines.length;
    // What it passes through, kind by kind
    const kinds = ([[contacts, 'contact', 'contacts'], [n, 'point', 'points'], [lines, 'line', 'lines']] as [number, string, string][]).filter(k => k[0] > 0);
    const counted = kinds.map(([k, one, many]) => `${k.toLocaleString()} ${k === 1 ? one : many}`);
    const count = counted.length <= 1 ? counted.join('') : `${counted.slice(0, -1).join(', ')} and ${counted[counted.length - 1]}`;
    const logging: string[] = [];
    if (fromLogging && found && found.gapsLeftOut > 0) {
        const k = found.gapsLeftOut;
        logging.push(`${k.toLocaleString()} change${k === 1 ? '' : 's'} of side left out: more than ${formatMetres(found.maxGap)} of unlogged hole lies between the two sides.`);
    }
    const measured = body ? 0 : surface.points.filter(p => p.reading).length;
    if (kinds.length === 0) {
        const headline = !fromLogging ? 'No points yet.'
            : !found ? 'Its logging column, or the hole and depth columns, are not in this dataset.'
                : body ? 'No hole passes into or out of these units, so there is nothing to put a surface round.'
                    : 'No contacts: no hole passes from one side to the other.';
        return { headline, notes: logging, problem: true, busy: false };
    }
    if (!result || (result.state === 'fitting' && !result.part)) return { headline: `${count}. Working it out…`, notes: [], problem: false, busy: true };
    if (result.state === 'empty' && body) {
        const headline = !found ? 'Its logging column, or the hole and depth columns, are not in this dataset.'
            : `${count}. It takes a hole that passes into or out of these units to put a surface round them.`;
        return { headline, notes: logging, problem: true, busy: false };
    }
    if (result.state === 'empty') {
        const alone = lines === 0 && contacts + n === 1;
        if (alone && n === 1) logging.push('Give the point a dip reading and it is a whole plane.');
        return {
            headline: alone ? `One ${contacts === 1 ? 'contact' : 'point'}: a surface needs at least two.` : `${count}, all at one place: a surface needs at least two places.`,
            notes: logging, problem: true, busy: false,
        };
    }
    if (result.state === 'failed') return { headline: `${count}. A surface could not be fitted through them.`, notes: ['Try letting it follow the points less closely.'], problem: true, busy: false };

    const busy = result.state === 'fitting';
    const notes: string[] = [];
    const stats = result.stats;
    let headline = count;
    if (stats) {
        const merged = stats.merged > 0 ? ` (${stats.merged} shared a place with another)` : '';
        const all = (k: number, one: string, many: string) => (k === 1 ? `its ${one}` : k === 2 ? `both ${many}` : `all ${k.toLocaleString()} ${many}`);
        const what = kinds.length === 1 ? all(kinds[0][0], kinds[0][1], kinds[0][2]) : `its ${count}`;
        headline = stats.worstMiss < EXACT
            ? `Passes through ${what}${merged}.`
            : `Passes within ${formatMetres(stats.worstMiss)} of ${what}${merged}.`;
        // More contacts than a surface is fitted through: neighbours are averaged into one place
        if (contacts > MAX_CONTACT_POINTS) {
            headline = `Follows ${what}.`;
            notes.push(body
                ? `So many contacts: ${MAX_CONTACT_POINTS.toLocaleString()} spread through them are used, to keep the fit quick.`
                : `So many contacts are grouped into ${MAX_CONTACT_POINTS.toLocaleString()} places, close neighbours together, to keep the fit quick.`);
        }
        if (stats.body && !busy) {
            const { volume, pieces, cut, cell, thin } = stats.body;
            if (volume !== null && volume > 0) notes.push(`It encloses ${formatVolume(volume)}${pieces > 1 ? `, in ${pieces.toLocaleString()} separate pieces` : ''}.`);
            if (cut) notes.push('It reaches the edge of the data and is closed off flat there.');
            const stretch = result.field?.stretch;
            if (stretch && structure && surface.params.trend !== false) {
                notes.push(followText(structure));
            } else if (stretch && stretch.factor >= 2) {
                // A slight stretch (a body somewhat flatter than it is wide) is not worth a line
                const { dip, dipDirection } = dipFromNormal(stretch.normal);
                notes.push(`It is thin against the gaps between holes, so it is carried from hole to hole along the plane the holes meet it in (${dip < 0.5 ? 'level' : dip > 89.5 ? 'vertical' : `dipping ${Math.round(dip)}° towards ${bearing(dipDirection)}`}).`);
            }
            if (thin) notes.push('It is much thinner than the gaps between the holes, so it may come out as pieces round the holes rather than joined from one to the next.');
            if (found && found.thinnest !== null && found.thinnest < 2 * cell) {
                notes.push(`It is as thin as ${formatMetres(found.thinnest)} down a hole. Where it is thinner than about ${formatMetres(2 * cell)} it may be drawn with gaps.`);
            }
        }
        if (stats.smoothed) notes.push('Some points were too close together to honour exactly: it was eased very slightly.');
        if (stats.truncated) notes.push(body ? 'Too large to draw in full.' : 'Too large to draw in full: shorten its reach.');
        if (stats.sides) {
            const { checked, wrong } = stats.sides;
            notes.push(wrong === 0
                ? `${checked === 1 ? 'The one logged interval is' : `All ${checked.toLocaleString()} logged intervals are`} on the right side of it.`
                : `${wrong.toLocaleString()} of ${checked.toLocaleString()} logged intervals are on the wrong side of it. ${body ? 'Leaving out thin units can put that right.' : 'Leaving out thin units, or a point or line placed by hand there, can put that right.'}`);
        }
    }
    notes.push(...logging);
    if (result.trend) {
        const { dip, dipDirection } = dipFromNormal(result.trend.normal);
        notes.unshift(dip < 0.5 ? 'Level overall.' : dip > 89.5
            ? `Vertical overall, running ${bearing((dipDirection + 90) % 180)}.`
            : `Overall it dips ${Math.round(dip)}° towards ${bearing(dipDirection)}.`);
    }
    if (measured > 0 && !busy) {
        const used = Math.min(measured, MAX_READINGS);
        notes.push(n === 1 && contacts === 0 && lines === 0
            ? 'It is the plane of its dip reading.'
            : `It lies as measured at ${used === 1 ? 'its dip reading' : `its ${used.toLocaleString()} dip readings`}.${measured > used ? ` (${(measured - used).toLocaleString()} more are not used.)` : ''}`);
    }
    const guided = body || busy ? 0 : result.stats?.guided ?? 0;
    if (guided > 0) {
        notes.push(`It lies as the model's readings say at ${guided === 1 ? 'one' : guided.toLocaleString()} of its places.`);
    }
    if (result.status === 'line' && lines === 0) {
        notes.push(`The ${contacts > 0 ? (n > 0 ? 'contacts and points' : 'contacts') : 'points'} lie on one line, so this is the flat surface through that line. Add a point off the line, or a dip reading, to tilt or bend it.`);
    }
    if (result.part && result.part.triangles.length === 0 && !busy) notes.push('Nothing to draw inside the data: its points may be far from it.');
    return { headline, notes, problem: false, busy };
}

/** A bearing as three digits: 045°. */
function bearing(degrees: number): string {
    return `${String(Math.round(degrees) % 360).padStart(3, '0')}°`;
}
