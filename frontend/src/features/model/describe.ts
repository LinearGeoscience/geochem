/**
 * A surface's state in plain words, for its properties (pure, unit-tested).
 */
import { controlCounts } from './contactControl';
import type { ContactInputs } from './contacts';
import { countAtOrAbove, DEFAULT_LOCAL, DEFAULT_SHARE, SHARE_LOCAL, type ShellInputs } from './shell';
import { sharePercent } from './proportion';
import type { SurfaceResult } from './modelCache';
import { dipFromNormal } from './plane';
import type { FitFailure } from './rbf';
import { MAX_READINGS } from './readings';
import { structureAxes, structureText } from './structure';
import { MAX_CONTACT_POINTS } from './surfaceJobs';
import { groundText, isSolids, listText } from './shellDomains';
import type { ContactControl, OverallStructure, SurfaceObject } from './types';
import type { VeinSummary } from './vein';
import type { ConformSummary } from './conform';
import { useModelStore } from '../../store/modelStore';

/** A body says how much of the logging it holds in its own holes is its units when that is under this share */
export const OWN_ENOUGH = 0.9;

/** A length for reading: 0.4 m, 12 m, 1.2 km. */
export function formatMetres(v: number): string {
    const a = Math.abs(v);
    if (a >= 10_000) return `${(v / 1000).toFixed(1)} km`;
    if (a >= 10) return `${Math.round(v)} m`;
    if (a >= 0.95) return `${v.toFixed(1)} m`;
    // (Less than a millimetre is nothing: never "1e-29 m")
    if (a < 0.0005) return '0 m';
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

/** Said of a locked surface that is no longer the fit it was locked at */
export const LOCK_MOVED = 'Locked, but it is not as it was when it was locked: something it is built from has changed since, and it was fitted again when the project was opened.';

/** What to say of a locked surface whose fit is not the one it was locked at (null: it is as it was locked, or not locked) */
export function lockNote(surface: Pick<SurfaceObject, 'locked'>, result: Pick<SurfaceResult, 'lockMoved' | 'state'> | undefined): string | null {
    return surface.locked && result?.lockMoved && result.state === 'ready' ? LOCK_MOVED : null;
}

/** Said of a surface whose fit was stopped before it was done (null: it was not): what is shown of it. It waits to be asked ("Fit now"). */
export function stoppedNote(result: Pick<SurfaceResult, 'stopped' | 'state' | 'key'> | undefined): string | null {
    if (!result?.stopped) return null;
    if (result.state !== 'ready') return 'Its fit was stopped before it was done, so there is no surface to show. It is fitted when asked, or when it is next changed.';
    return result.key.endsWith('|draft')
        ? 'Its fit was stopped before it was done: what is shown is a quick draft of it. It is fitted when asked, or when it is next changed.'
        : 'Its fit was stopped before it was done: what is shown is the surface as it was before it was last changed. It is fitted when asked, or when it is next changed.';
}

/**
 * Why a fit failed, in words. `why`: what the solver said; `thrown`: what
 * stopped the work when it did not get that far (an error out of the worker).
 * Always a sentence that says something: "it failed" alone tells nothing.
 */
export function failureText(why: FitFailure | undefined, thrown?: unknown): string {
    if (why === 'too-few') return 'There are too few points in different places to fix it.';
    if (why === 'singular') return 'Its points do not fix one answer, even when it is let off them a little: many may sit almost on top of one another, or all lie along one line.';
    const message = thrown instanceof Error ? thrown.message : typeof thrown === 'string' ? thrown : '';
    if (/memory|allocation|array length|array buffer/i.test(message)) return `There was not enough memory to work it out (${message}): give it a coarser resolution (larger cells), or less ground to cover.`;
    if (/stopped unexpectedly/i.test(message)) return 'The work stopped part-way, which is most often for want of memory: give it a coarser resolution (larger cells), or less ground to cover.';
    return message ? `The work stopped with an error: ${message}` : 'It could not be solved, and nothing said why.';
}

/** A surface that follows structural data of its own choosing: said once, with its other notes */
const OWN_SETS = 'It follows structural data of its own choosing, not the sets the rest of the model follows (Trend).';
const OWN_LAYERS = 'It follows the layers of its geological model: how the contacts between that model\'s layers lie from place to place, in place of structural data (Trend). It is fitted again when one of them changes.';
/** What a surface that follows the ground from place to place takes the lie of the ground from, in words */
const groundAs = (surface: SurfaceObject) => (surface.params.trendLayers ? 'the layers of its geological model lie' : 'the measurements the model follows say it lies');
/** The note on what a surface follows by its own choice (null: what the model follows) */
const ownNote = (surface: SurfaceObject): string | null => (surface.params.trend === false ? null : surface.params.trendLayers ? OWN_LAYERS : surface.params.trendSets ? OWN_SETS : null);

/** How a surface that follows the model's structure (or one of its own) was fitted. */
function followText(s: OverallStructure, own = false): string {
    const line = structureAxes(s).line !== null && s.lineStrength > 1;
    const plane = s.strength > 1 ? `it carries ${tidy(s.strength)} times further along it than across it` : '';
    const long = line ? `${tidy(s.lineStrength)} times further along its long direction than across that` : '';
    return `It is fitted along the structure set for ${own ? 'this surface alone' : 'the model'} (${structureText(s)}): ${[plane, long].filter(Boolean).join(', and ')}.`;
}

/** What a proportion says and does not, whatever it is of (said of every one, and in its dialog) */
export const SHARE_CAVEAT = 'It says how much of the ground is the unit, not where in that ground its sheets are. It is surer of where there is more and where less than of the amount at any one place: between holes far apart against the thickness of the sheets, the amount is rough.';

/** The state of a proportion's shell (ShellRule.of): the ground where its units are a share or more, and how much of them that implies. */
function shareStatus(surface: SurfaceObject, result: SurfaceResult | undefined, inputs: ShellInputs | null, structure: OverallStructure | null): SurfaceStatus {
    const rule = surface.rule;
    if (rule.kind !== 'shell' || !rule.of) return { headline: '', notes: [], problem: false, busy: false };
    const of = rule.of, units = listText(of.inside), at = sharePercent(rule.cutoff);
    if (!inputs) return { headline: `The logging column ${of.column}, or a coordinate column, is not in this ${of.table ? 'project' : 'dataset'}.`, notes: [], problem: true, busy: false };
    const n = inputs.sorted.length;
    const one = `pieces of hole ${formatMetres(of.length)} long`;
    if (n === 0) return { headline: `Nothing is logged in ${of.column} down a hole.`, notes: [], problem: true, busy: false };
    const above = countAtOrAbove(inputs.sorted, rule.cutoff);
    const samples = `${above.toLocaleString()} of ${n.toLocaleString()} ${one} are ${at} ${units} or more`;
    if (above === 0) return { headline: `No piece of hole ${formatMetres(of.length)} long is ${at} ${units} or more: there is nothing to put a shell round.`, notes: [], problem: true, busy: false };
    if (above === n) return { headline: `Every piece of hole is ${at} ${units} or more: there would be nothing outside the shell.`, notes: [], problem: true, busy: false };
    if (!result || (result.state === 'fitting' && !result.part)) return { headline: `${samples}. Working it out…`, notes: [], problem: false, busy: true };
    if (result.state === 'failed') return { headline: `${samples}. A shell could not be fitted round them.`, notes: result.error ? [result.error] : [], problem: true, busy: false };
    if (result.state === 'empty') return { headline: `${samples}, but taken together with their neighbours none is: there is nothing to put a shell round.`, notes: [], problem: true, busy: false };
    const busy = result.state === 'fitting';
    const notes: string[] = [];
    const body = result.stats?.body;
    if (body && !busy) {
        const volume = body.volume ?? 0, share = body.share ?? null;
        if (volume > 0) {
            notes.push(`It encloses ${formatVolume(volume)} of ground${body.pieces > 1 ? `, in ${body.pieces.toLocaleString()} separate pieces` : ''}: where ${at} or more of the ground round about is ${units}.`);
            if (share && share.inside !== null) {
                const inside = volume * share.inside;
                notes.push(`On average ${sharePercent(share.inside, true)} of the ground inside it is ${units}: about ${formatVolume(inside)} of ${units}.`);
                if (share.allOverInside !== null && share.allOverInside > 1.02) notes.push(`With the ground outside it that is under ${at} ${units}, as far as the logging reaches, there is about ${formatVolume(inside * share.allOverInside)} of ${units} in all.`);
            }
        } else if (result.part && result.part.triangles.length === 0) notes.push(`Nothing to draw: taken together with their neighbours, no ground is ${at} ${units} or more.`);
        if (body.cut) notes.push('It reaches the edge of the data and is closed off flat there.');
        if (body.domained && surface.domain) notes.push(`Kept inside ${groundText(surface.domain, useModelStore.getState().scene)}: only the pieces of hole there are used, and the shell stops at the faces of that ground.`);
    }
    notes.push(SHARE_CAVEAT);
    notes.push(`Each of the ${one} counts as the share of it that is ${units}, and about ${tidy(rule.local ?? SHARE_LOCAL)} each way down a hole are taken together.`);
    const frame = inputs.share;
    if (frame && frame.plane && frame.planeFrom && frame.strength > 1) {
        notes.push(`It is carried ${tidy(frame.strength)} times further along the plane of its sheets than across them. ${sheetsPlaneNote(frame.planeFrom, frame.plane)}`);
    } else if (inputs.stretch && structure) notes.push(followText(structure, !!surface.params.trendOwn));
    else if (inputs.layers) notes.push(`It follows the ground as ${groundAs(surface)}, from place to place: it carries ${tidy(inputs.layers.strength)} times further along it than across it.`);
    else notes.push('It is carried evenly in every direction: nothing says which way its sheets lie.');
    notes.push(`From a piece that is ${at} or more it may reach ${tidy(inputs.reachFactor)} times the distance between the holes there: ${reachText(inputs.reachRange)}. Further out nothing is said: the share there is taken as none.`);
    if (inputs.merged > 0) notes.push(`Away from those, ${inputs.merged.toLocaleString()} pieces were averaged down the hole so that it fits quickly.`);
    if (result.stats?.truncated) notes.push('Too large to draw in full.');
    return { headline: `${samples}.`, notes, problem: false, busy };
}

/** A shell's state: what it is round, how much it encloses. */
function shellStatus(surface: SurfaceObject, result: SurfaceResult | undefined, inputs: ShellInputs | null, structure: OverallStructure | null): SurfaceStatus {
    const rule = surface.rule;
    if (rule.kind !== 'shell') return { headline: '', notes: [], problem: false, busy: false };
    if (rule.of) return shareStatus(surface, result, inputs, structure);
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
    if (result.state === 'failed') return { headline: `${samples}. A shell could not be fitted round them.`, notes: [...(result.error ? [result.error] : []), 'Try letting it follow the samples less closely.'], problem: true, busy: false };
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
        if (body.domained && surface.domain) notes.push(isSolids(surface.domain) || surface.domain.units || surface.domain.sides?.length
                ? `Kept inside ${groundText(surface.domain, useModelStore.getState().scene)}: only the samples there are used, and the shell stops at the faces of that ground.`
                : `Kept inside ${surface.domain.unit}: only the samples in it are used, and the shell stops at its faces.`);
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
    if (along) notes.push(followText(along, !!surface.params.trendOwn));
    { const own = ownNote(surface); if (own) notes.push(own); }
    if (layers) notes.push(`It follows the ground as ${groundAs(surface)}, from place to place: it carries ${tidy(layers.strength)} times further along it than across it.`);
    if (layers?.second) notes.push(`Within the ground it follows the plunge from place to place as well: it carries ${tidy(layers.second.strength)} times further down the plunge than across it, and the distance between holes is counted the same way.`);
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

/** What was changed by hand on a surface made from logging, in words (nothing: no lines) */
export function controlNotes(control: ContactControl | undefined, found: ContactInputs): string[] {
    const c = controlCounts(control);
    const stale = found.stale.edits.length + found.stale.holes.length;
    const parts: string[] = [];
    const ignored = c.ignored - found.stale.edits.filter(e => e.ignore).length, moved = c.moved - found.stale.edits.filter(e => !e.ignore).length;
    const crossed = c.uncrossed - found.stale.holes.length;
    if (ignored > 0) parts.push(`${ignored.toLocaleString()} contact${ignored === 1 ? '' : 's'} left out`);
    if (moved > 0) parts.push(`${moved.toLocaleString()} moved`);
    const clear = (control?.marks ?? []).filter(m => m.by !== undefined && m.by > 0).length;
    if (c.marks > 0) parts.push(`${c.marks.toLocaleString()} place${c.marks === 1 ? '' : 's'} marked on one side of it${clear > 0 ? ` (${clear === c.marks ? (clear === 1 ? 'held' : 'all held') : `${clear.toLocaleString()} held`} clear of it by a distance)` : ''}`);
    if (crossed > 0) parts.push(`${crossed.toLocaleString()} hole${crossed === 1 ? '' : 's'} it must not cross`);
    const notes = parts.length > 0 ? [`By hand: ${parts.join(', ')}.`] : [];
    if (stale > 0) {
        notes.push(`${stale.toLocaleString()} change${stale === 1 ? '' : 's'} made by hand match${stale === 1 ? 'es' : ''} nothing in the logging now (it has changed since): ${stale === 1 ? 'it is' : 'they are'} kept, and listed with the contacts.`);
    }
    return notes;
}

/** How a surface that runs alongside another sits against it. `other`: that one's name */
export function conformNotes(c: ConformSummary, other: string): string[] {
    if (c.fixed) return [`It has no places of its own: it is ${formatMetres(c.usual)} from ${other} everywhere, measured square to it, as far as that goes.`];
    if (c.alone) {
        const why = c.along ? '' : ` ${other} is overturned somewhere, and far from it its shape is a poor guide.`;
        return [`It is set to be conformable to ${other}, but carried alongside it ${c.alone.wrong.toLocaleString()} of the ${c.alone.checked.toLocaleString()} places checked down the holes were on the wrong side of it.${why} So it is fitted on its own, through its own contacts: it honours the logging, and the two may cross.`];
    }
    const far = c.most - c.least < 0.005
        ? `it is ${formatMetres(c.usual)} from it`
        : `it is ${formatMetres(c.least)} to ${formatMetres(c.most)} from it, usually ${formatMetres(c.usual)}`;
    const notes = [`It is conformable to ${other}, on one side of it: at its ${c.places === 1 ? 'one place' : `${c.places.toLocaleString()} places`} ${far}${c.along ? ', measured square to the overall lie of the sequence' : ''}. The two cannot cross.`];
    if (c.along) notes.push(`Between its places it has the shape of ${other}: a fold or a step drawn on one layer of the sequence is in every layer.`);
    else notes.push(`${other} is overturned somewhere, so this one is carried in the space round it rather than straight across from it: it takes its shape less well far from it.`);
    if (c.crossed > 0) {
        notes.push(`${c.crossed === 1 ? 'One of its places is' : `${c.crossed.toLocaleString()} of its places are`} on the other side of ${other}: the two would cross there, so there they meet instead. Check the logging at ${c.crossed === 1 ? 'that place' : 'those places'}, or which surface it should be conformable to.`);
    } else if (c.least < 0.05 && c.most > 0.05) {
        notes.push(`Where it meets ${other}, the ground between them has pinched out.`);
    }
    return notes;
}

const lieOf = (normal: ArrayLike<number>) => { const { dip, dipDirection } = dipFromNormal(normal); return `${Math.round(dip)}\u00b0 towards ${String(Math.round(dipDirection) % 360).padStart(3, '0')}\u00b0`; };

/**
 * Which plane a vein's sheets are taken to lie in, when it is not simply
 * the plane all its stretches lie closest to: as given, or as the logging
 * carries from one hole to the next (setPlane.ts).
 */
export function planeNote(from: 'given' | 'data' | 'carry', normal: ArrayLike<number>, cloud: ArrayLike<number> | null, logging: ArrayLike<number> | null = null): string {
    if (from === 'given') return `Its sheets are taken to dip ${lieOf(normal)}, as given.`;
    if (from === 'data') {
        const said = `Its sheets are taken to dip ${lieOf(normal)}: how the structural data it follows lies at its stretches.`;
        if (!logging) return said;
        const apart = Math.acos(Math.min(1, Math.abs(normal[0] * logging[0] + normal[1] * logging[1] + normal[2] * logging[2]))) * 180 / Math.PI;
        return `${said} The logging on its own gives ${lieOf(logging)}, ${Math.round(apart)}\u00b0 from that: one of the two is not how the sheets lie.`;
    }
    if (!cloud) return `Its sheets are taken to dip ${lieOf(normal)}: the plane its units carry in from one hole to the next.`;
    const a = dipFromNormal(normal).dip, b = dipFromNormal(cloud).dip;
    const zone = b <= a - 10 ? 'a zone that lies flatter than they do' : b >= a + 10 ? 'a zone that lies steeper than they do' : 'a zone that lies another way';
    return `Its sheets are taken to dip ${lieOf(normal)}: the plane its units carry in from one hole to the next. All its stretches together lie closest to ${lieOf(cloud)}: they are side by side in ${zone}.`;
}

/** The plane the sheets of an intrusion of thin sheets are taken to lie in, and what gave it (as `planeNote`; the cloud's as well) */
export function sheetsPlaneNote(from: 'given' | 'data' | 'carry' | 'cloud', normal: ArrayLike<number>, cloud: ArrayLike<number> | null = null, logging: ArrayLike<number> | null = null): string {
    return from === 'cloud' ? `Its sheets are taken to dip ${lieOf(normal)}: the plane its stretches down the holes lie closest to.` : planeNote(from, normal, cloud, logging);
}

/**
 * What a vein is built from, and how thick the holes find it. `zones`: how
 * its stretches down the holes were read (the join length and whether it
 * was measured across the vein's plane, the gaps closed and the ground in
 * them, and the holes that meet it). `held`: at how many of its stretches
 * its reference surface is held to the lie of the ground.
 */
/**
 * How much of a vein's zones is its units, and whether it is built as thick
 * as the zones or as the units in them (its net thickness).
 */
export function zoneShareNote(share: { count: number; length: number; unit: number; net: boolean }): string {
    const zones = share.count === 1 ? 'one zone that takes in other ground is' : `${share.count.toLocaleString()} zones that take in other ground are`;
    const percent = share.length > 0 ? Math.round(100 * share.unit / share.length) : 0;
    const made = `Its ${zones} ${formatMetres(share.length)} down the holes all together, and ${formatMetres(share.unit)} of that (${percent}%) is its units.`;
    return share.net
        ? `${made} It is built to its net thickness: in each zone it is as thick as the units in it are all together, about the middle of them. Where in a zone each strand is, is not kept.`
        : `${made} It is built as thick as the zones: the other ground between the strands is inside it.`;
}

export function veinNotes(
    vein: VeinSummary, least: number, cut = false,
    zones: { join: number; gaps: number; metres: number; holes: number; across: boolean; plane?: { from: 'given' | 'data' | 'cloud' | 'carry'; normal: ArrayLike<number>; cloud?: ArrayLike<number> | null; logging?: ArrayLike<number> | null }; share?: { count: number; length: number; unit: number; net: boolean } | null } | null = null, held = 0,
): string[] {
    const notes: string[] = [];
    const k = vein.stretches;
    const thick = formatMetres(vein.thickest) === formatMetres(vein.thinnest)
        ? `${formatMetres(vein.usual)} thick`
        : `from ${formatMetres(vein.thinnest)} to ${formatMetres(vein.thickest)} thick, usually ${formatMetres(vein.usual)}`;
    notes.push(`Built from its two walls. ${k === 1 ? 'One hole goes' : `Holes go`} right through it${k === 1 ? '' : ` at ${k.toLocaleString()} places`}: square to itself it is ${thick} there.`);
    if (zones && zones.join > 0) {
        notes.push(zones.gaps > 0
            ? `It is read as a zone: stretches of it less than ${formatMetres(zones.join)} apart ${zones.across ? 'are one (measured across it, not down the hole)' : 'down a hole are one'}, and ${zones.gaps.toLocaleString()} ${zones.gaps === 1 ? 'gap' : 'gaps'} between them (${formatMetres(zones.metres)} of other ground) ${zones.gaps === 1 ? 'is' : 'are'} inside it.`
            : `Stretches of it less than ${formatMetres(zones.join)} apart ${zones.across ? '(measured across it)' : 'down a hole'} would be read as one zone: none are that close.`);
        if (zones.share && zones.share.count > 0) notes.push(zoneShareNote(zones.share));
        if (zones.plane && zones.plane.from !== 'cloud') notes.push(planeNote(zones.plane.from, zones.plane.normal, zones.plane.cloud ?? null, zones.plane.logging ?? null));
    } else if (zones && zones.holes > 0 && k / zones.holes > 1.5) {
        notes.push(`Holes go through it ${(k / zones.holes).toFixed(1)} times each, on average, and one vein is put through all of those. If it is a swarm of thin dykes or veins, change its units and say how close together they are one zone.`);
    }
    if (held > 0) notes.push(`Between holes it is kept along the lie of the ground: it is held to it at ${held === 1 ? 'its one stretch' : held >= k ? `each of its ${k.toLocaleString()} stretches` : `${held.toLocaleString()} of its stretches`}.`);
    if (vein.beyond) {
        notes.push(`${vein.beyond === 1 ? 'One more place where a hole goes through these units is' : `${vein.beyond.toLocaleString()} more places where holes go through these units are`} beyond the surface it ends on, and no part of it.`);
    }
    if (vein.misses > 0) {
        notes.push(`${vein.misses === 1 ? 'One hole goes' : `${vein.misses.toLocaleString()} holes go`} through where it would be without meeting it: it pinches out before ${vein.misses === 1 ? 'it' : 'them'}.`);
    }
    if (vein.oneEnded > 0) {
        notes.push(`${vein.oneEnded === 1 ? 'One hole starts or stops' : `${vein.oneEnded.toLocaleString()} holes start or stop`} inside it: the one wall met there is used, the other is carried from the holes round it${vein.refit?.outside ? ', and put out as far as the hole logs it' : ''}.`);
    }
    if (vein.along) {
        notes.push(`${vein.along === 1 ? 'One hole runs' : `${vein.along.toLocaleString()} holes run`} along it, to one side of its middle: its walls go through both ends of ${vein.along === 1 ? 'that stretch' : 'those stretches'} all the same.`);
    }
    if (vein.refit) {
        const { inside, outside } = vein.refit, both = inside + outside;
        const parts = [
            ...(outside > 0 ? [`${outside.toLocaleString()} where ${outside === 1 ? 'an interval' : 'intervals'} of it had been left outside a wall`] : []),
            ...(inside > 0 ? [`${inside.toLocaleString()} where other ground had been left inside one`] : []),
        ];
        notes.push(`Its walls were fitted again to the logging of the holes: ${both === 1 ? 'a place was' : 'places were'} put on them at ${parts.join(', and ')}.`);
    }
    if (vein.onReference) notes.push(`Its reference surface (the middle of it) was given ${vein.onReference === 1 ? 'one place or line' : `${vein.onReference.toLocaleString()} places and lines`} by hand: it passes through ${vein.onReference === 1 ? 'it' : 'them'}, and the vein is carried along ${vein.onReference === 1 ? 'it' : 'them'}.`);
    if (vein.carried) {
        const one = vein.carried === 1;
        notes.push(`${one ? 'One stretch is' : `${vein.carried.toLocaleString()} stretches are`} within reach of a dip or a direction put on it by hand, and ${one ? 'lies' : 'lie'} as that says, ${one ? 'where its hole has it' : 'each where its hole has it'}${vein.usualReach ? ` (one given no reach is carried ${formatMetres(vein.usualReach)}, as far as its stretches usually are apart)` : ''}.`);
    }
    if (vein.byHand > 0) notes.push(`${vein.byHand === 1 ? 'One place' : `${vein.byHand.toLocaleString()} places`} put on its walls by hand ${vein.byHand === 1 ? 'is' : 'are'} used over the holes near ${vein.byHand === 1 ? 'it' : 'them'}.`);
    if (least > 0) notes.push(`Where it is there, it is never thinner than ${formatMetres(least)}.`);
    if (!cut) notes.push('It ends a little beyond the outermost holes that meet it.');
    return notes;
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
    // (Stopped with nothing to show: not a surface there is nothing to fit through)
    if (result?.stopped && result.state === 'empty') return { headline: 'Not fitted: its fit was stopped before it was done.', notes: [], problem: true, busy: false };
    if (surface.rule.kind === 'shell') return shellStatus(surface, result, shell, structure);
    const fromLogging = surface.rule.kind !== 'sheet';
    // A closed body: its contacts and hand-placed points are places on its skin, and its lines run along it (a vein: along its reference surface)
    const body = surface.rule.kind === 'body';
    const vein = surface.rule.kind === 'body' && !!surface.rule.vein;
    const contacts = fromLogging && found ? found.contacts.length / 3 : 0;
    const n = surface.points.length, lines = surface.polylines.length;
    // What it passes through, kind by kind
    const kinds = ([[contacts, 'contact', 'contacts'], [n, 'point', 'points'], [lines, 'line', 'lines']] as [number, string, string][]).filter(k => k[0] > 0);
    const counted = kinds.map(([k, one, many]) => `${k.toLocaleString()} ${k === 1 ? one : many}`);
    const count = counted.length <= 1 ? counted.join('') : `${counted.slice(0, -1).join(', ')} and ${counted[counted.length - 1]}`;
    const logging: string[] = [];
    if (fromLogging && found && found.gapsLeftOut > 0) {
        const k = found.gapsLeftOut;
        logging.push(`${k.toLocaleString()} change${k === 1 ? '' : 's'} of side left out: more than ${formatMetres(found.maxGap)} of unlogged hole lies between the two sides.`);
    }
    if (fromLogging && found?.pile) {
        const p = found.pile;
        logging.push(p.changed > 0
            ? `Each hole is read as a pile of layers: ${formatMetres(p.changed)} of the ${formatMetres(p.metres)} of them is out of order, and is read as the layer round it or left out.`
            : 'Each hole is read as a pile of layers: all of them are in order.');
        if (p.up > 0) logging.push(`${p.up.toLocaleString()} of ${p.holes.toLocaleString()} holes ${p.up === 1 ? 'is' : 'are'} read from the bottom up: going down ${p.up === 1 ? 'it' : 'them'} the layers get younger.`);
    }
    if (surface.rule.kind !== 'sheet' && found) logging.push(...controlNotes(surface.rule.control, found));
    const measured = surface.points.filter(p => p.reading).length;
    const noLogging = surface.rule.kind !== 'sheet' && surface.rule.table
        ? 'Its logging table or column is not in this project, or the paths of the holes are not in these coordinates.'
        : 'Its logging column, or the hole and depth columns, are not in this dataset.';
    // One that runs alongside another: that one's name
    const other = surface.conform && !body
        ? useModelStore.getState().scene.surfaces.find(s => s.id === surface.conform!.surface)?.name ?? null
        : null;
    const fixed = result?.stats?.conform?.fixed ? result.stats.conform : null;
    if (kinds.length === 0 && fixed && other && result && result.state !== 'failed' && result.state !== 'empty') {
        return { headline: `A fixed distance from ${other}.`, notes: conformNotes(fixed, other), problem: false, busy: result.state === 'fitting' };
    }
    if (kinds.length === 0) {
        const headline = !fromLogging ? (surface.conform && other ? `No points yet: give it some, or a distance from ${other}.` : 'No points yet.')
            : !found ? noLogging
                : vein ? 'No hole goes right through these units (in one wall and out of the other), so there is nothing to build a vein from.'
                    : body ? 'No hole passes into or out of these units, so there is nothing to put a surface round.'
                    : 'No contacts: no hole passes from one side to the other.';
        return { headline, notes: logging, problem: true, busy: false };
    }
    if (!result || (result.state === 'fitting' && !result.part)) return { headline: `${count}. Working it out…`, notes: [], problem: false, busy: true };
    if (result.state === 'empty' && body) {
        const headline = !found ? noLogging
            : vein ? `${count}. It takes a hole that goes right through these units, in one wall and out of the other, to build a vein from.`
                : `${count}. It takes a hole that passes into or out of these units to put a surface round them.`;
        return { headline, notes: logging, problem: true, busy: false };
    }
    if (result.state === 'empty') {
        const alone = lines === 0 && contacts + n === 1;
        if (alone && n === 1) logging.push('Give the point a dip measurement and it is a whole plane.');
        return {
            headline: alone ? `One ${contacts === 1 ? 'contact' : 'point'}: a surface needs at least two.` : `${count}, all at one place: a surface needs at least two places.`,
            notes: logging, problem: true, busy: false,
        };
    }
    if (result.state === 'failed') return { headline: `${count}. A surface could not be fitted through them.`, notes: [...(result.error ? [result.error] : []), 'Try letting it follow the points less closely.'], problem: true, busy: false };

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
        // A vein that ends on a surface: only the contacts this side of it are its
        if (stats.vein?.beyond) {
            headline = stats.worstMiss < EXACT ? 'Passes through its contacts on the side it is kept to.' : `Passes within ${formatMetres(stats.worstMiss)} of its contacts on the side it is kept to.`;
        }
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
            if (stats.body.ended) notes.push('It stops where it meets the surface it ends on.');
            // How much of what it holds in its own holes is its units: every interval can be "on the right side" of a body that is mostly other ground
            const own = stats.body.own;
            const asSheets = surface.rule.kind === 'body' && !surface.rule.vein && !!surface.rule.sheets;
            if (own && own.unit + own.other > 0 && own.unit < OWN_ENOUGH * (own.unit + own.other)) {
                const share = own.unit / (own.unit + own.other);
                notes.push(`Of the ${formatMetres(own.unit + own.other)} of logging inside it in the holes it is built from, ${share < 0.005 ? 'under 1' : Math.round(100 * share)}% is its units and the rest is other ground${share < 0.5 ? ': it is much fatter than what was logged. A logged interval beside its skin may lie up to half inside it' : ''}${share < 0.5 && thin && !asSheets ? '. Built as thin sheets (a choice where its units are chosen), every interval is held on its own side' : ''}.`);
            }
            // Places held by hand by a distance: lenses, and what they have against the logging
            const held = stats.body.lenses;
            if (held && held.held > 0) {
                notes.push(`${held.held.toLocaleString()} place${held.held === 1 ? ' is' : 's are'} held by hand by a distance: ${held.held === 1 ? 'a lens' : 'lenses'} put into it or cut out of it after it is fitted. Nothing else of it is changed by them.`);
                if (held.over > 0) notes.push(`${held.over.toLocaleString()} logged interval${held.over === 1 ? ' is' : 's are'} on the other side of its skin than logged, inside a place held by hand: the hand is followed. Hold it by a shorter distance, or take the place away, to keep the logging.`);
            }
            const stretch = result.field?.stretch;
            // Thin sheets built as a volume: its logging held strictly, and (unless it follows a trend of its own) carried along the plane of its sheets
            const sheets = surface.rule.kind === 'body' && !surface.rule.vein ? surface.rule.sheets : undefined;
            if (sheets) notes.push('It is built as thin sheets: every logged interval is held on its own side of its skin.');
            if (stats.body.reach) notes.push(`Nothing of it is drawn further than ${formatMetres(stats.body.reach)} from where a hole meets it: further out it is not known.`);
            // Other ground between its sheets read as part of it: what that takes in
            if (sheets && (sheets.join ?? 0) > 0 && found) {
                const gaps = found.joined?.gaps ?? 0;
                notes.push(gaps > 0
                    ? `Other ground less than ${formatMetres(sheets.join!)} across between two stretches of it down a hole is read as part of it: ${gaps.toLocaleString()} ${gaps === 1 ? 'gap is' : 'gaps are'} closed, ${formatMetres(found.joined!.metres)} of hole. It holds together further from hole to hole, and holds more that is not its units.`
                    : `Other ground less than ${formatMetres(sheets.join!)} across between two stretches of it down a hole would be read as part of it: no gap is that short.`);
                if (found.zones && found.zones.count > 0) notes.push(zoneShareNote(found.zones));
            }
            if (stats.body.domained && surface.domain) {
                notes.push(`Kept inside ${groundText(surface.domain, useModelStore.getState().scene)}: all its logging is used, and it stops at the faces of that ground.`);
            }
            if (stats.body.small) {
                const small = stats.body.small;
                notes.push(`${small.pieces === 1 ? 'One piece' : `${small.pieces.toLocaleString()} pieces`} of under ${formatVolume(small.least)} (${formatVolume(small.volume)} all together) ${small.pieces === 1 ? 'is' : 'are'} left out: not drawn, and not in its volume.`);
            }
            if (sheets && stretch && !stats.body.layered && !surface.params.trendOwn && found?.joinPlane && found.joinPlaneFrom) {
                notes.push(`It is carried ${tidy(stretch.factor)} times further along the plane of its sheets than across them. ${sheetsPlaneNote(found.joinPlaneFrom, found.joinPlane, found.cloudPlane ?? null, found.loggingPlane ?? null)}`);
            } else if (stretch && structure && surface.params.trend !== false) {
                notes.push(followText(structure, !!surface.params.trendOwn));
            } else if (stretch && stretch.factor >= 2) {
                // A slight stretch (a body somewhat flatter than it is wide) is not worth a line
                const { dip, dipDirection } = dipFromNormal(stretch.normal);
                notes.push(`It is thin against the gaps between holes, so it is carried from hole to hole along the plane the holes meet it in (${dip < 0.5 ? 'level' : dip > 89.5 ? 'vertical' : `dipping ${Math.round(dip)}° towards ${bearing(dipDirection)}`}).`);
            }
            if (stats.vein) {
                const veinRule = surface.rule.kind === 'body' ? surface.rule.vein : undefined;
                // How thick it is, carried further down a plunge than across it (Phase 247)
                const down = result.field?.walls?.up.stretch;
                if (down && down.factor > 1) notes.push(`How thick it is carries ${tidy(down.factor)} times further down the plunge of the global trend${surface.params.trendOwn ? ' set for this surface' : ''} than across it. How far it is known from the holes is the same every way.`);
                notes.push(...veinNotes(stats.vein, veinRule?.least ?? 0, cut, found ? { join: veinRule?.join ?? 0, gaps: found.joined?.gaps ?? 0, metres: found.joined?.metres ?? 0, holes: found.holesWithContact, across: !!found.joinPlane, ...(found.joinPlane && found.joinPlaneFrom ? { plane: { from: found.joinPlaneFrom, normal: found.joinPlane, cloud: found.cloudPlane ?? null, logging: found.loggingPlane ?? null } } : {}), share: found.zones ?? null } : null, veinRule?.held ? stats.guided ?? 0 : 0));
            }
            if (surface.rule.kind === 'body' && surface.rule.vein?.picks) notes.push('It is one of several veins that these units make: only the stretches picked for it are its own, and the others are other ground to it.');
            if (thin) notes.push('It is much thinner than the gaps between the holes, so it may come out as pieces round the holes rather than joined from one to the next.');
            // (Thin sheets are drawn with cells finer across the sheets than along them)
            const across = stats.body.cellAcross ?? cell;
            if (!stats.vein && found && found.thinnest !== null && found.thinnest < 2 * across) {
                notes.push(`It is as thin as ${formatMetres(found.thinnest)} down a hole. Where it is thinner than about ${formatMetres(2 * across)}${stats.body.cellAcross ? ' across its sheets' : ''} it may be drawn with gaps.`);
            }
        }
        if (stats.conform && other) notes.push(...conformNotes(stats.conform, other));
        if (stats.body?.layered && surface.rule.kind === 'body') notes.push(`It joins from hole to hole along the ground as ${groundAs(surface)}${stats.body.plunging ? ', and further down the plunge than across it' : ''}.`);
        { const own = ownNote(surface); if (own) notes.push(own); }
        if (stats.smoothed) notes.push('Some points were too close together to honour exactly: it was eased very slightly.');
        if (stats.truncated) notes.push(body ? 'Too large to draw in full.' : 'Too large to draw in full: shorten its reach.');
        if (stats.sides) {
            const { checked, wrong, strands } = stats.sides;
            // Places marked on a side and the intervals of holes not to be crossed are checked with the logging
            // (Long intervals are checked every few metres along them: what is counted then is those places)
            const logged = found?.piece ? 'places checked down the logging' : 'logged intervals';
            const what = found && found.held > 0 ? `${logged} and places held by hand` : logged;
            if (strands) notes.push(`${strands === 1 ? 'One logged interval of it is' : `${strands.toLocaleString()} logged intervals of it are`} outside its walls: at its net thickness a zone is as thick as the units in it, and what lies apart from their middle is left out.`);
            notes.push(wrong === 0
                ? `${checked === 1 ? 'The one logged interval is' : `${strands ? 'The other' : 'All'} ${(checked - (strands ?? 0)).toLocaleString()} ${what} are`} on the right side of it.`
                : `${wrong.toLocaleString()} of ${checked.toLocaleString()} ${what} are on the wrong side of it. ${vein ? 'A place put on one of its walls by hand there can put that right.' : body ? 'Leaving out thin units can put that right.' : 'Leaving out thin units, or a point or line placed by hand there, can put that right.'}`);

        }
    }
    notes.push(...logging);
    if (result.trend) {
        const { dip, dipDirection } = dipFromNormal(result.trend.normal);
        notes.unshift(dip < 0.5 ? 'Level overall.' : dip > 89.5
            ? `Vertical overall, running ${bearing((dipDirection + 90) % 180)}.`
            : `Overall it dips ${Math.round(dip)}° towards ${bearing(dipDirection)}.`);
        // Held from fit to fit, so that one point moved does not tilt all of it: said once the points would give another
        const turned = result.stats?.turned;
        if (turned !== undefined && turned >= 1 && !busy) notes.splice(1, 0, `That is how it lay before: its points now give a lie ${Math.round(turned)}° from it.`);
    }
    if (measured > 0 && !busy) {
        const used = Math.min(measured, MAX_READINGS);
        notes.push(n === 1 && contacts === 0 && lines === 0
            ? 'It is the plane of its dip measurement.'
            : `${vein ? 'Its reference surface' : body ? 'Its skin' : 'It'} lies as measured at ${used === 1 ? 'its dip measurement' : `its ${used.toLocaleString()} dip measurements`}.${measured > used ? ` (${(measured - used).toLocaleString()} more are not used.)` : ''}${body && !vein ? ' Which side of each is the inside is taken from the logging near it, where that says.' : ''}`);
    }
    const guided = body || busy ? 0 : result.stats?.guided ?? 0;
    if (guided > 0) {
        notes.push(`It lies as the model's measurements say at ${guided === 1 ? 'one' : guided.toLocaleString()} of its places.`);
    }
    if (result.status === 'line' && lines === 0) {
        notes.push(`The ${contacts > 0 ? (n > 0 ? 'contacts and points' : 'contacts') : 'points'} lie on one line, so this is the flat surface through that line. Add a point off the line, or a dip measurement, to tilt or bend it.`);
    }
    if (result.part && result.part.triangles.length === 0 && !busy) notes.push('Nothing to draw inside the data: its points may be far from it.');
    return { headline, notes, problem: false, busy };
}

/** A bearing as three digits: 045°. */
function bearing(degrees: number): string {
    return `${String(Math.round(degrees) % 360).padStart(3, '0')}°`;
}
