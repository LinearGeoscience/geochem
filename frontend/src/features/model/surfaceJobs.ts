/**
 * From a surface in the scene to a fit job, and running one (pure,
 * unit-tested). The job is everything the fit needs as plain typed arrays, so
 * it can cross to the Web Worker (workers/surface.worker.ts) or run on the
 * main thread unchanged.
 */
import { bodyShape, closedVolume, fitBody, meshBody } from './body';
import { fitWithSides, refineSides, type ContactInputs, type SideChecks, type SideReport } from './contacts';
import { sampleLines, type LineSamples } from './lines';
import { outlineFrame, outlineSize } from './outline';
import { meshPieces } from './meshOps';
import { sheetGuides, type GuideSamples } from './guides';
import { pickSpread, readingSamples, type ReadingSamples } from './readings';
import { inverseStretch, stretchedBox, stretchPoints, type FitStats, type FittedField, type Stretch } from './rbf';
import { thinPoints } from './sampling';
import { meshSheet, type SheetFit } from './sheet';
import { fitShell, shellCounts, shellFitting, type ShellCounts, type ShellInputs, type ShellLayers } from './shell';
import type { TrendField } from './trendField';
import type { Box3, Plane, SurfaceObject, SurfaceOutline, Vec3 } from './types';

export type FitQuality = 'draft' | 'final';

export interface SheetJob {
    type: 'sheet';
    /** Points on the surface, xyz triples (world) */
    points: Float64Array;
    /** For each point, the normal of the slice it was placed on, xyz triples (null: none were placed on a slice) */
    pointAcross: Float64Array | null;
    /** The lines it passes along, as points with the surface's facing at each (null: none) */
    lines: LineSamples | null;
    along: Vec3 | null;
    refDirection: Vec3 | null;
    smoothing: number;
    /** The surface never leaves this box */
    box: Box3;
    /** Distance kept from the points (null = fill the box) */
    reach: number | null;
    /** An outline the surface is kept inside (null = none) */
    outline: SurfaceOutline | null;
    /** Mesh cell size */
    cell: number;
    /** Logged intervals the surface is checked against, and corrected to keep on their side (null: none) */
    checks: SideChecks | null;
    /** The dip readings among its points (null: none) */
    readings: ReadingSamples | null;
    /** What the model's direction says at a spread of its places (null: nothing, or it does not follow it) */
    guides: GuideSamples | null;
}

/** A closed body round logged units (see body.ts) */
export interface BodyJob {
    type: 'body';
    /** Places on its skin, xyz triples: the points placed by hand, then the contacts it is fitted through */
    points: Float64Array;
    /** Every contact, for the mesher to start from (a small piece must not be missed because its contacts were thinned out) */
    seeds: Float64Array;
    /** A place in the middle of each logged stretch, and its side: 1 inside, -1 outside */
    middles: { positions: Float64Array; side: Int8Array };
    /** Space is stretched across a thin body before it is fitted (null: it is not) */
    stretch: Stretch | null;
    /** It is thin against the gaps between holes even so */
    thin: boolean;
    smoothing: number;
    /** The body is closed off at this box */
    box: Box3;
    cell: number;
    checks: SideChecks | null;
}

/** A closed shell round the values of a column at or above a cut-off (see shell.ts) */
export interface ShellJob {
    type: 'shell';
    /** The places it is fitted to, xyz triples */
    points: Float64Array;
    /** How far each place's value is above the cut-off (negative: below) */
    values: Float64Array;
    /** For each place, the next one down the same hole (-1: none) */
    next: Int32Array;
    /** How many samples each place stands for */
    count: Int32Array;
    smoothing: number;
    /** Found by counting: how many samples each way are taken together, and the field's value out of reach (`ShellInput`; null: fitted to the values) */
    local: number | null;
    background: number | null;
    /** The field is fitted everywhere in this box */
    cover: Box3;
    /** How far the shell may go from each place, m (0 for a place below the cut-off) */
    reach: Float64Array;
    /** The shell is drawn inside this box (the places at or above the cut-off and the reach round them) */
    box: Box3;
    /** The mesh cell, m: measured, like the reach, in the space the fit is made in */
    cell: number;
    /** Fitted, and drawn, in space stretched across the structure it follows (null: as it is) */
    stretch: Stretch | null;
    /** Fitted along the ground as it lies from place to place, and drawn as it is in the ground (null: it is not) */
    layers: ShellLayers | null;
    /** A mark of everything the fitted field depends on: a draft and the full mesh after it share one fit */
    fitMark: string;
}

export type FitJob = SheetJob | BodyJob | ShellJob;

/** What is known of a closed body once it is meshed */
export interface BodySummary {
    /** The volume it encloses, m3 (null: its mesh did not close) */
    volume: number | null;
    /** Separate pieces */
    pieces: number;
    /** It reaches the edge of the data and is closed off flat there */
    cut: boolean;
    /** The mesh cell it was drawn with, m: anything thinner than about two of these may be missed */
    cell: number;
    /** It is much thinner than the gaps between the holes: it may have come out in pieces round them */
    thin: boolean;
}

/** How a shell sits against its samples */
export type ShellSummary = ShellCounts;

export interface FitSummary extends FitStats {
    /** Time taken, ms */
    ms: number;
    /** The mesh was cut short (too many cells) */
    truncated: boolean;
    /** How the logged intervals sit against the surface (null: it is not built from logging) */
    sides: SideReport | null;
    /** At how many of its places it was held to the model's direction (absent: none) */
    guided?: number;
    /** Its volume and pieces (absent or null: it is not a closed body) */
    body?: BodySummary | null;
    /** For a shell: its samples counted against it */
    shell?: ShellSummary | null;
}

interface Fitted {
    ok: true;
    vertices: Float64Array;
    triangles: Uint32Array;
    field: FittedField;
    /** Per line of the surface: 1 or -1, the side of it that came out as the positive side */
    lineSigns: Int8Array;
    stats: FitSummary;
}
/** empty = not enough points yet; failed = the fit could not be solved */
type NotFitted = { ok: false; reason: 'empty' | 'failed' };

/** line = the points only define a line, so this is the plane through it. `trend`: its overall plane */
export type SheetOutput = (Fitted & { status: 'line' | 'sheet'; trend: Plane }) | NotFitted;
/** A closed body has no overall plane */
export type BodyOutput = (Fitted & { status: 'body'; trend: null }) | NotFitted;
export type FitOutput = SheetOutput | BodyOutput;

/** Grid cells along the longest side of a surface */
const CELLS = { draft: 40, final: 110 };
/** The data box is grown by this share of its size, so a surface runs a little past the data */
const BOX_PAD = 0.05;
/** A surface is drawn at least this share of its longest line's length either side of it */
const LINE_REACH = 0.15;
/** A surface is fitted through at most this many contacts (more are thinned: close ones are averaged) */
export const MAX_CONTACT_POINTS = 600;
/** A body is first fitted to at most this many logged stretches inside it, and as many outside */
const MAX_BODY_MIDDLES = 150;
/** A thin body is drawn with cells down to this share of its size, and no finer */
const BODY_FINEST = 1 / 240;
/** Mesh cells to a shell's usual reach */
const SHELL_CELLS = { draft: 5, final: 16 };
/**
 * A shell too large to draw in full is drawn again coarser: twice 1.5 times,
 * then twice as coarse each time, up to this many times. A shell cut short is
 * open (no volume, a broken solid when written out): one that follows the
 * ground's lie is drawn several times finer and needed more than three 1.5
 * steps (a shell along the bedding of real drilling stayed open at three).
 */
const MAX_COARSER = 6;
const coarser = (tries: number) => (tries < 2 ? 1.5 : 2);

function boundsOf(points: ArrayLike<number>): Box3 | null {
    const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i + 2 < points.length; i += 3) {
        for (let k = 0; k < 3; k++) {
            if (points[i + k] < min[k]) min[k] = points[i + k];
            if (points[i + k] > max[k]) max[k] = points[i + k];
        }
    }
    return max[0] >= min[0] ? { min, max } : null;
}

/**
 * Smoothing for a "follow" setting: 0 passes exactly through every point,
 * 1 is loose. In between it grows by a constant factor per step, which is
 * what feels even on a slider.
 *
 * The range is measured, on 60-300 points scattered 3-10 m about a curved
 * sheet 500 m across: below 0.01 nothing visibly changes; 0.1-1 takes the
 * scatter out and keeps the curve; past 10 the curve itself is flattened.
 */
export function smoothingFromFollow(follow: number): number {
    if (!(follow > 0)) return 0;
    return Math.pow(10, -3 + 4 * Math.min(1, follow));
}

/**
 * A starting reach for a surface that stops near its points: the widest gap
 * that has to be crossed to join all the points into one piece (the longest
 * link of the shortest tree connecting them). For picks on drillholes that is
 * about the hole spacing, however many picks sit close together down each
 * hole, so the surface fills in between the holes and stops a spacing past
 * the outer ones.
 *
 * `groups` (one per point; negative: none) marks points that are already
 * joined, such as those along one drawn line: the gaps between them do not
 * count.
 */
export function autoReach(points: ArrayLike<number>, groups?: ArrayLike<number>): number {
    const n = Math.floor(points.length / 3);
    if (n < 2) return 0;
    // Prim's algorithm: grow the tree from point 0, always by the nearest point not yet in it
    const dist = new Float64Array(n).fill(Infinity);
    const done = new Uint8Array(n);
    let current = 0, widest = 0;
    done[0] = 1;
    for (let added = 1; added < n; added++) {
        let next = -1, best = Infinity;
        for (let j = 0; j < n; j++) {
            if (done[j]) continue;
            const joined = groups !== undefined && groups[current] >= 0 && groups[current] === groups[j];
            const d = joined ? 0 : Math.hypot(points[current * 3] - points[j * 3], points[current * 3 + 1] - points[j * 3 + 1], points[current * 3 + 2] - points[j * 3 + 2]);
            if (d < dist[j]) dist[j] = d;
            if (dist[j] < best) { best = dist[j]; next = j; }
        }
        if (next < 0) break;
        done[next] = 1;
        if (best > widest) widest = best;
        current = next;
    }
    return widest;
}

/**
 * The reach worked out for a surface from its points and lines: the widest
 * gap between any of them (a line is one piece however many points are taken
 * along it), and never less than a share of the longest line, so that one
 * line alone still gives a surface with some width.
 */
export function surfaceReach(points: ArrayLike<number>, lines: LineSamples | null): number {
    if (!lines) return autoReach(points);
    const nPlain = Math.floor(points.length / 3);
    const through = new Float64Array(points.length + lines.positions.length);
    through.set(points as ArrayLike<number>);
    through.set(lines.positions, points.length);
    const groups = new Int32Array(nPlain + lines.groups.length).fill(-1);
    groups.set(lines.groups, nPlain);
    return Math.max(autoReach(through, groups), LINE_REACH * Math.max(...lines.extrude));
}

/**
 * The places a surface is asked to pass through, xyz triples: the points
 * placed by hand first, then the contacts its logging gives (thinned to what
 * fits quickly).
 */
export function surfacePoints(surface: SurfaceObject, found: ContactInputs | null = null): Float64Array {
    const placed = surface.points.flatMap(p => p.p);
    return found && found.contacts.length > 0 ? Float64Array.of(...placed, ...thinPoints(found.contacts, MAX_CONTACT_POINTS)) : Float64Array.from(placed);
}

/**
 * What the model's direction from place to place says at a sheet's own
 * places (guides.ts): null for a closed body or a shell (they follow it
 * another way), for a surface told not to follow it, and where the field
 * has no readings or says nothing near the surface.
 */
export function surfaceGuides(surface: SurfaceObject, found: ContactInputs | null, field: TrendField | null): GuideSamples | null {
    if (surface.rule.kind === 'body' || surface.rule.kind === 'shell' || surface.params.trend === false) return null;
    if (!field || field.planes + field.lines === 0) return null;
    const points = surfacePoints(surface, found);
    const lines = sampleLines(surface.polylines);
    return sheetGuides(field, points, lines ? Float64Array.of(...points, ...lines.positions) : points, i => !!surface.points[i]?.reading);
}

/**
 * The job for a surface. `dataBox` is the extent of the dataset (world);
 * without one (no data loaded) the points' own extent stands in. `found`:
 * for a surface built from logging, what the logging gives (features/model/contacts).
 * `guides`: what the model's direction says at its places (surfaceGuides).
 * Null when the surface has nothing to pass through.
 */
export function buildFitJob(
    surface: SurfaceObject, dataBox: Box3 | null, quality: FitQuality, found: ContactInputs | null = null, guides: GuideSamples | null = null,
): SheetJob | null {
    // The points placed by hand come first: they are the ones `pointAcross` is for
    const points = surfacePoints(surface, found);
    const lines = sampleLines(surface.polylines);
    // Everything the surface passes through: its size and the gaps it has to bridge come from all of it
    const through = lines ? Float64Array.of(...points, ...lines.positions) : points;
    const own = boundsOf(through);
    if (!own) return null;
    const base = dataBox ?? own;
    const size = Math.max(base.max[0] - base.min[0], base.max[1] - base.min[1], base.max[2] - base.min[2], 1);
    const pad = size * BOX_PAD;
    // The box always holds the surface's own points, wherever the data is
    const box: Box3 = {
        min: [Math.min(base.min[0], own.min[0]) - pad, Math.min(base.min[1], own.min[1]) - pad, Math.min(base.min[2], own.min[2]) - pad],
        max: [Math.max(base.max[0], own.max[0]) + pad, Math.max(base.max[1], own.max[1]) + pad, Math.max(base.max[2], own.max[2]) + pad],
    };

    let reach: number | null = null;
    let span = Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
    if (surface.params.extent === 'near') {
        reach = surface.params.reach ?? surfaceReach(points, lines);
        // One point, or all at one place: fall back to a share of the box
        if (!(reach > 0)) reach = span / 10;
        span = Math.min(span, Math.max(own.max[0] - own.min[0], own.max[1] - own.min[1], own.max[2] - own.min[2]) + 2 * reach);
    }
    // An outline with fewer than three corners is no outline: the surface runs to the edge of the data
    const frame = surface.params.extent === 'outline' ? outlineFrame(surface.params.outline) : null;
    if (frame) span = Math.min(span, 1.5 * outlineSize(frame));
    const fine = surface.params.resolution ?? span / CELLS.final;
    const cell = quality === 'final' ? fine : Math.max(fine, span / CELLS.draft);

    return {
        type: 'sheet', points, lines,
        pointAcross: surface.points.some(p => p.across) ? Float64Array.from(surface.points.flatMap(p => p.across ?? [0, 0, 0])) : null,
        // From logging, the first side is the side of its first units, whatever was placed by hand
        along: surface.along, refDirection: found?.facing ?? surface.refDirection,
        smoothing: smoothingFromFollow(surface.params.follow),
        box, reach, cell,
        outline: frame ? surface.params.outline : null,
        // A draft is for showing something soon: the check comes with the full fit
        checks: found && quality === 'final' && found.checks.side.length > 0 ? found.checks : null,
        readings: readingSamples(surface.points, through),
        guides,
    };
}

/** The triples at these indices */
function chosen(points: ArrayLike<number>, indices: readonly number[]): number[] {
    const out: number[] = [];
    for (const i of indices) out.push(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]);
    return out;
}

/** The contacts a body is fitted through: all of them, or that many spread through them (never averaged: the two walls of a thin body are close together) */
export function bodyContacts(found: ContactInputs): Float64Array {
    return found.contacts.length / 3 <= MAX_CONTACT_POINTS ? found.contacts : Float64Array.from(chosen(found.contacts, pickSpread(found.contacts, MAX_CONTACT_POINTS)));
}

/**
 * The job for a surface of any kind: a shell round high values, a closed
 * body round logged units, or a sheet (`buildFitJob`). `found`: what the
 * dataset gives it (its samples for a shell, its contacts from logging).
 */
export function buildJob(
    surface: SurfaceObject, dataBox: Box3 | null, quality: FitQuality, found: ContactInputs | ShellInputs | null = null, stretch: Stretch | null = null,
    guides: GuideSamples | null = null,
): FitJob | null {
    const shell = found && 'values' in found ? found : null, logged = found && !('values' in found) ? found : null;
    return surface.rule.kind === 'shell' ? buildShellJob(surface, quality, shell)
        : surface.rule.kind === 'body' ? buildBodyJob(surface, dataBox, quality, logged, stretch)
            : buildFitJob(surface, dataBox, quality, logged, guides);
}

/** The job for a shell. Null when its column gives it no values. */
export function buildShellJob(surface: SurfaceObject, quality: FitQuality, inputs: ShellInputs | null): ShellJob | null {
    const rule = surface.rule;
    if (rule.kind !== 'shell' || !inputs || inputs.values.length === 0) return null;
    const own = boundsOf(inputs.positions);
    if (!own) return null;
    const { values, local, background } = shellFitting(rule, inputs.values);
    // The cells suit the reach where most of the high places are; never finer than half a place down the hole
    const reaches: number[] = [], highAt: number[] = [];
    inputs.reach.forEach((r, i) => { if (r > 0) { reaches.push(r); highAt.push(inputs.positions[i * 3], inputs.positions[i * 3 + 1], inputs.positions[i * 3 + 2]); } });
    reaches.sort((a, b) => a - b);
    const usual = reaches.length > 0 ? reaches[reaches.length >> 1] : 0, furthest = reaches.length > 0 ? reaches[reaches.length - 1] : 0;
    // One that follows the ground from place to place is drawn as it is in the ground, where it is thin across the
    // ground's lie by as much as along counts over across: the cells are as much finer
    const thin = inputs.layers ? Math.max(1, inputs.layers.strength) : 1;
    const fine = surface.params.resolution ?? Math.max(usual / SHELL_CELLS.final / thin, (inputs.step ?? 0) / 2, 1e-6);
    const cell = quality === 'final' ? fine : Math.max(fine, usual / SHELL_CELLS.draft / thin);
    // Drawn round the places at or above the cut-off, as far as it may reach from them
    const high = boundsOf(highAt) ?? own;
    const pad = furthest + 2 * cell;
    const box: Box3 = { min: [high.min[0] - pad, high.min[1] - pad, high.min[2] - pad], max: [high.max[0] + pad, high.max[1] + pad, high.max[2] + pad] };
    const cover: Box3 = {
        min: [Math.min(own.min[0], box.min[0]) - cell, Math.min(own.min[1], box.min[1]) - cell, Math.min(own.min[2], box.min[2]) - cell],
        max: [Math.max(own.max[0], box.max[0]) + cell, Math.max(own.max[1], box.max[1]) + cell, Math.max(own.max[2], box.max[2]) + cell],
    };
    // Found by counting, it is as loose as its rule says; from the values, as its slider does
    const smoothing = local === null ? smoothingFromFollow(surface.params.follow) : 0;
    return {
        type: 'shell', points: inputs.positions, values, next: inputs.next, count: inputs.count, reach: inputs.reach,
        smoothing, local, background, cover, box, cell, stretch: inputs.stretch, layers: inputs.layers,
        fitMark: keyMark(JSON.stringify([inputs.mark, rule.cutoff, rule.log, rule.band, smoothing, fine, local, background])),
    };
}

/** The last few shells fitted, by `fitMark`: the full mesh after a draft does not fit again */
const keptShells = new Map<string, SheetFit>();

function runShellJob(job: ShellJob, t0: number): BodyOutput {
    let fit = keptShells.get(job.fitMark);
    if (!fit) {
        fit = fitShell({
            positions: job.points, values: job.values, next: job.next, reach: job.reach, cover: job.cover, smoothing: job.smoothing, local: job.local, background: job.background,
            stretch: job.stretch, layers: job.layers,
        });
        if (fit.status === 'body') {
            keptShells.set(job.fitMark, fit);
            if (keptShells.size > 3) keptShells.delete(keptShells.keys().next().value!);
        }
    }
    if (fit.status === 'empty') return { ok: false, reason: 'empty' };
    if (fit.status === 'failed' || !fit.field || !fit.stats) return { ok: false, reason: 'failed' };
    // A shell that follows a structure is thin across it and wide along it: it is drawn on a grid in the
    // space it was fitted in, where it is neither, and its corners are then put back where they are in the ground
    // (One that follows the ground from place to place has no one such space: it is drawn as it is in the ground)
    const st = job.layers ? null : job.stretch;
    const drawn: SheetFit = st ? { ...fit, field: { ...fit.field, stretch: null }, onSurface: stretchPoints(fit.onSurface, st) } : fit;
    const box = st ? stretchedBox(job.box, st) : job.box;
    let cell = job.cell;
    let mesh = meshBody(drawn, box, cell);
    for (let tries = 0; mesh.truncated && tries < MAX_COARSER; tries++) {
        cell *= coarser(tries);
        mesh = meshBody(drawn, box, cell);
    }
    const counts = shellCounts(drawn.field!, st ? stretchPoints(job.points, st) : job.points, job.values, job.count, box.min, cell);
    if (st) mesh = { ...mesh, vertices: stretchPoints(mesh.vertices, inverseStretch(st)) };
    return {
        ok: true, status: 'body',
        vertices: mesh.vertices, triangles: mesh.triangles,
        // A copy of what is handed over: the kept fit stays whole when these go to the main thread
        field: { ...fit.field, centres: fit.field.centres.slice(), weights: fit.field.weights.slice() },
        trend: null, lineSigns: fit.lineSigns,
        stats: {
            ...fit.stats, ms: performance.now() - t0, truncated: mesh.truncated, sides: null,
            body: { volume: closedVolume(mesh), pieces: meshPieces(mesh), cut: mesh.cut, cell, thin: false },
            shell: counts,
        },
    };
}

/** The job for a closed body. Null when its logging gives it nothing to pass through. */
export function buildBodyJob(surface: SurfaceObject, dataBox: Box3 | null, quality: FitQuality, found: ContactInputs | null, stretch: Stretch | null = null): BodyJob | null {
    if (!found) return null;
    const placed = surface.points.flatMap(p => p.p);
    const contacts = bodyContacts(found);
    const points = new Float64Array(placed.length + contacts.length);
    points.set(placed);
    points.set(contacts, placed.length);
    const seeds = new Float64Array(placed.length + found.contacts.length);
    seeds.set(placed);
    seeds.set(found.contacts, placed.length);
    const own = boundsOf(seeds);
    if (!own) return null;
    const base = dataBox ?? own;
    const size = Math.max(base.max[0] - base.min[0], base.max[1] - base.min[1], base.max[2] - base.min[2], 1);
    const pad = size * BOX_PAD;
    const box: Box3 = {
        min: [Math.min(base.min[0], own.min[0]) - pad, Math.min(base.min[1], own.min[1]) - pad, Math.min(base.min[2], own.min[2]) - pad],
        max: [Math.max(base.max[0], own.max[0]) + pad, Math.max(base.max[1], own.max[1]) + pad, Math.max(base.max[2], own.max[2]) + pad],
    };

    // The stretches inside and outside it: a spread of each when there are a great many
    const { positions, side } = found.middles;
    const middles: number[] = [], sides: number[] = [];
    for (const which of [1, -1]) {
        const rows: number[] = [];
        for (let i = 0; i < side.length; i++) if (side[i] === which) rows.push(i);
        const own = chosen(positions, rows);
        const kept = chosen(own, pickSpread(own, MAX_BODY_MIDDLES));
        middles.push(...kept);
        for (let i = 0; i < kept.length / 3; i++) sides.push(which);
    }

    // Sized by what it was met in, with room for it to run a little further; a thin body gets smaller cells
    const boxSpan = Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
    const met = Math.max(own.max[0] - own.min[0], own.max[1] - own.min[1], own.max[2] - own.min[2]);
    const span = met > 0 ? Math.min(boxSpan, 1.5 * met) : boxSpan / 10;
    let fine = surface.params.resolution ?? span / CELLS.final;
    if (surface.params.resolution === null && found.thinnest !== null && found.thinnest > 0) {
        fine = Math.min(fine, Math.max(found.thinnest / 2, span * BODY_FINEST));
    }
    const cell = quality === 'final' ? fine : Math.max(fine, span / CELLS.draft);

    return {
        type: 'body', points, seeds,
        middles: { positions: Float64Array.from(middles), side: Int8Array.from(sides) },
        // Along the structure it follows; else, if it is thin, along the plane the holes meet it in
        ...(stretch ? { stretch, thin: bodyShape(found.middles).thin } : bodyShape(found.middles)),
        smoothing: smoothingFromFollow(surface.params.follow),
        box, cell,
        checks: quality === 'final' && found.checks.side.length > 0 ? found.checks : null,
    };
}

function runBodyJob(job: BodyJob, t0: number): BodyOutput {
    const { fit, report } = refineSides(
        extra => fitBody({ points: job.points, middles: job.middles, valued: extra, box: job.box, smoothing: job.smoothing, stretch: job.stretch }),
        job.checks,
    );
    if (fit.status === 'empty') return { ok: false, reason: 'empty' };
    if (fit.status === 'failed' || !fit.field || !fit.stats) return { ok: false, reason: 'failed' };
    const mesh = meshBody(fit, job.box, job.cell, job.seeds);
    return {
        ok: true, status: 'body',
        vertices: mesh.vertices, triangles: mesh.triangles,
        field: fit.field, trend: null, lineSigns: fit.lineSigns,
        stats: {
            ...fit.stats, ms: performance.now() - t0, truncated: mesh.truncated, sides: report,
            body: { volume: closedVolume(mesh), pieces: meshPieces(mesh), cut: mesh.cut, cell: job.cell, thin: job.thin },
        },
    };
}

/**
 * What a surface's mesh depends on, as a string: two surfaces (or the same
 * one at two times) with equal keys have the same mesh.
 */
export function fitKey(
    surface: SurfaceObject, dataBox: Box3 | null, found: { mark: string } | null = null, stretch: Stretch | null = null, guides: { mark: string } | null = null,
): string {
    return JSON.stringify([
        surface.rule, surface.points.map(p => (p.across || p.reading ? [p.p, p.across ?? 0, p.reading ?? 0] : p.p)), surface.polylines.map(l => [l.points, l.plane.normal, l.plane.point, l.flipped]),
        surface.along, surface.refDirection, surface.params,
        dataBox ? [dataBox.min, dataBox.max] : null,
        found ? found.mark : null,
        stretch ? [stretch.normal, stretch.point, stretch.factor, stretch.second ?? 0] : null,
        // (Only when there are some: a surface with none keeps the key it had before there were guides)
        ...(guides ? [guides.mark] : []),
    ]);
}

/** A short mark for a fit key (8 hex digits), small enough to save with the project. */
export function keyMark(key: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
}

export function runFitJob(job: SheetJob): SheetOutput;
export function runFitJob(job: FitJob): FitOutput;
export function runFitJob(job: FitJob): FitOutput {
    const t0 = performance.now();
    if (job.type === 'body') return runBodyJob(job, t0);
    if (job.type === 'shell') return runShellJob(job, t0);
    const { fit, report } = fitWithSides(
        {
            points: job.points, pointAcross: job.pointAcross, oriented: job.lines ?? undefined, readings: job.readings, guides: job.guides,
            along: job.along, refDirection: job.refDirection, smoothing: job.smoothing,
        },
        job.checks,
    );
    if (fit.status === 'empty') return { ok: false, reason: 'empty' };
    if (fit.status === 'failed' || !fit.field || !fit.trend || !fit.stats) return { ok: false, reason: 'failed' };
    const mesh = meshSheet(fit, { box: job.box, reach: job.reach, outline: outlineFrame(job.outline) }, job.cell);
    return {
        ok: true, status: fit.status === 'line' ? 'line' : 'sheet',
        vertices: mesh.vertices, triangles: mesh.triangles,
        field: fit.field, trend: fit.trend, lineSigns: fit.lineSigns,
        stats: { ...fit.stats, ms: performance.now() - t0, truncated: mesh.truncated, sides: report, ...(job.guides ? { guided: job.guides.offsets.length } : {}) },
    };
}
