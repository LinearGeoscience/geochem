/**
 * From a surface in the scene to a fit job, and running one (pure,
 * unit-tested). The job is everything the fit needs as plain typed arrays, so
 * it can cross to the Web Worker (workers/surface.worker.ts) or run on the
 * main thread unchanged.
 */
import { bodyShape, closedVolume, fitBody, meshBody } from './body';
import { fitConform, movedPlaces, usualGap, type ConformFit, type ConformSummary } from './conform';
import { heldAsLenses } from './contactControl';
import { fitWithSides, refineSides, SIDE_LIMITS, type ContactInputs, type SideChecks, type SideLimits, type SideReport, type SidesMemo } from './contacts';
import { freeLineSamples, nodeReadings, placesAcross, sampleLines, type LineSamples } from './lines';
import { outlineFrame, outlineSize } from './outline';
import { blockCache, type BlockCache, BlocksWanted, type BlockAnswer, type BlockTask } from './pou';
import { meshPieces, withoutSmallPieces } from './meshOps';
import { shareWithin } from './proportion';
import { sheetGuides, type GuideSamples } from './guides';
import { holdOffset, MAX_READINGS, pickSpread, readingSamples, type ReadingSamples } from './readings';
import { pointDirectionSamples, type DirectedSamples } from './ribbons';
import { normalFromDip, planeOfMany, RIM_PLACES } from './plane';
import { cleanDirection } from './attitudes';
import { carryToMiddles, usualReach, type Carried, type HandDip, type HandLine, type LieAt } from './veinCarry';
import { evaluateField, inverseStretch, stretchedBox, stretchPoints, touchReaches, withTouches, type FieldTouches, type FitFailure, type FitStats, type FittedField, type Stretch } from './rbf';
import { thinPoints } from './sampling';
import { meshSheet, type SheetFit, type SheetMemory } from './sheet';
import type { NodeMemory } from './surfaceNets';
import { thinDomain, unitNearness, type UnitOf } from './geoModelJobs';
import { solidNearness, solidWalls } from './solidGround';
import type { MeshField } from './meshField';
import { fitVein, meshVein, veinPicks, type VeinSummary } from './vein';
import { fitShell, shellCounts, shellFitting, type ShellCounts, type ShellInputs, type ShellLayers } from './shell';
import type { TrendField } from './trendField';
import { SHEETS_STRENGTH, type Box3, type Plane, type SurfaceObject, type SurfaceOutline, type Vec3 } from './types';

export type FitQuality = 'draft' | 'final';

export interface SheetJob {
    type: 'sheet';
    /** The surface it is for: its blocks are kept from one fit to the next (absent: none are kept) */
    blocksOf?: string;
    /** Points on the surface, xyz triples (world) */
    points: Float64Array;
    /** For each point, the normal of the slice it was placed on, xyz triples (null: none were placed on a slice) */
    pointAcross: Float64Array | null;
    /** The lines it passes along, as points with the surface's facing at each (null: none) */
    lines: LineSamples | null;
    /** For each point, and each place along the lines, looseness on top of `smoothing` (absent or null: none): see `inputLooseness` */
    loose?: Float64Array | null;
    looseLines?: Float64Array | null;
    along: Vec3 | null;
    refDirection: Vec3 | null;
    /** The normal of the overall plane it was last fitted about (null: none is held) */
    holdTo: Vec3 | null;
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
    /** Its points with a line it runs along there (null: none; absent in jobs made before there were any) */
    directed?: DirectedSamples | null;
    /** What the model's direction says at a spread of its places (null: nothing, or it does not follow it) */
    guides: GuideSamples | null;
}

/** A closed body round logged units (see body.ts) */
export interface BodyJob {
    type: 'body';
    /** Places marked inside or outside it by hand and held clear by a distance: lenses put into it or cut out of it once it is fitted (rbf.ts, `FieldTouches`) */
    lenses?: Pick<FieldTouches, 'places' | 'side' | 'by' | 'times' | 'ends'> | null;
    /** The surface it is for: its blocks are kept from one fit to the next (absent: none are kept) */
    blocksOf?: string;
    /** Places on its skin, xyz triples: the points placed by hand, then the contacts it is fitted through, then places along its lines in space */
    points: Float64Array;
    /** How its skin lies where that was set by hand (body.ts): dips at its points and at ticks on its lines, directions at its points, and its lines drawn on slices (absent: none) */
    readings?: ReadingSamples | null;
    directed?: DirectedSamples | null;
    lines?: LineSamples | null;
    /** Every contact, for the mesher to start from (a small piece must not be missed because its contacts were thinned out) */
    seeds: Float64Array;
    /** A place in the middle of each logged stretch, and its side: 1 inside, -1 outside */
    middles: { positions: Float64Array; side: Int8Array };
    /** Space is stretched across a thin body before it is fitted (null: it is not) */
    stretch: Stretch | null;
    /** It is thin against the gaps between holes even so */
    thin: boolean;
    /** It follows the ground as the model's readings say it lies from place to place (body.ts): in place of `stretch` */
    layers?: ShellLayers | null;
    smoothing: number;
    /** The body is closed off at this box */
    box: Box3;
    cell: number;
    checks: SideChecks | null;
    /** How far the rounds that put its logging on its own side may go (absent: as far as any surface's) */
    limits?: SideLimits | null;
    /**
     * Thin sheets: it is there only within `reach` of a place where it is
     * known (where a hole meets it, a place put on it by hand), in the
     * ground as it is; further out nothing is drawn of it. Absent: it runs
     * as far as its fit takes it.
     */
    known?: { positions: Float64Array; reach: number } | null;
    /** Thin sheets: pieces that enclose less than this are left out of its mesh, m3 (absent: none are) */
    least?: number;
    /** Thin sheets kept inside this unit of a built model: cut off at the unit's faces (absent: it is not) */
    domain?: UnitOf;
    /** Or kept inside these closed solids: cut off at their faces (solidGround.ts) */
    solids?: { meshes: MeshField[] };
}

/** A closed shell round the values of a column at or above a cut-off (see shell.ts) */
export interface ShellJob {
    type: 'shell';
    /** The surface it is for: its blocks are kept from one fit to the next (absent: none are kept) */
    blocksOf?: string;
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
    /** A proportion's shell: the share it is drawn at (its field plus this is the share of the unit at a place) */
    shareAt?: number;
    /** Fitted, and drawn, in space stretched across the structure it follows (null: as it is) */
    stretch: Stretch | null;
    /** Fitted along the ground as it lies from place to place, and drawn as it is in the ground (null: it is not) */
    layers: ShellLayers | null;
    /** A mark of everything the fitted field depends on: a draft and the full mesh after it share one fit */
    fitMark: string;
    /** It is kept inside this unit of a built model: cut off at the unit's faces (absent: it is not) */
    domain?: UnitOf;
    /** Or kept inside these closed solids: cut off at their faces (solidGround.ts) */
    solids?: { meshes: MeshField[] };
}

/** A vein, dyke or shear zone: a thin closed body built from its two walls (see vein.ts) */
export interface VeinJob {
    type: 'vein';
    blocksOf?: string;
    /** Every place on its walls, xyz triples: the ends of its stretches, then `walls` */
    points: Float64Array;
    /** One per stretch of it down a hole: where the hole goes in, then where it comes out (six numbers each) */
    stretches: Float64Array;
    /** Places on one of its walls: the ends of stretches with one end only, then the points placed by hand */
    walls: Float64Array;
    oneEnded: number;
    /** The logged intervals in order down the holes (null: none) */
    logged: { positions: Float64Array; side: Int8Array; hole: Int32Array } | null;
    least: number;
    /** What it ends on, as that is fitted now, and the side of it this is on (null or absent: nothing) */
    endsOn?: { field: FittedField; side: 1 | -1 } | null;
    /** How far from the nearest stretch it is carried, m */
    reach: number;
    smoothing: number;
    /** How its reference surface lies at the middles of stretches, for a vein held to the lie of the ground (guides.ts, `veinGuides`; absent: it is not) */
    lie?: { positions: Float64Array; normals: Float64Array; offsets: Float64Array };
    /** The plunge its thickness is carried further down than across (vein.ts; absent: the same every way) */
    plunge?: { line: Vec3; strength: number };
    /** What its reference surface was given by hand (vein.ts, `VeinInput.reference`; absent: nothing) */
    reference?: { points: Float64Array; readings: ReadingSamples | null; directed: DirectedSamples | null; lines: LineSamples | null; carried?: number; usual?: number };
    box: Box3;
    cell: number;
    checks: SideChecks | null;
    /** Its walls are refitted to the logging (a final fit; a draft is not) */
    refit?: boolean;
    /** Its zones are taken at their net thickness (absent: as thick as they are) */
    net?: boolean;
}

/** A surface that runs alongside another and never crosses it (see conform.ts) */
export interface ConformJob {
    type: 'conform';
    blocksOf?: string;
    /** Every place it passes through, xyz triples (none: it is a fixed distance from the other) */
    points: Float64Array;
    /** The field of the surface it runs alongside, and that one's overall plane (null: it has none) */
    ref: FittedField;
    refTrend: Plane | null;
    facing: Vec3 | null;
    by: number | null;
    /** Places to start its mesh from when it has none of its own: places on the other surface */
    refPlaces: Float64Array | null;
    /**
     * The overall plane of the surface at the head of its sequence: the
     * surface is carried from the other along that plane's normal (null: it
     * is carried in the other's field, as one a fixed distance from it is).
     */
    along: Plane | null;
    /** Places on the other surface, to see that it is met once only along that normal */
    refOn: Float64Array | null;
    smoothing: number;
    box: Box3;
    reach: number | null;
    outline: SurfaceOutline | null;
    cell: number;
    checks: SideChecks | null;
    /**
     * The same surface as it would be fitted on its own (absent: it has no
     * places of its own). Alongside the other it is carried from place to
     * place, not fitted to the logging: where that leaves much of the logging
     * on the wrong side of it and on its own it would not, it is fitted on
     * its own (`CONFORM_WRONG`).
     */
    alone?: SheetJob | null;
}

/**
 * A surface conformable to another is fitted on its own instead when,
 * carried alongside the other, over this share of the places checked down
 * the holes are on the wrong side of it, and on its own under half as many
 * are. (Real logging: the other folds over on itself between holes, and far
 * from it its shape is no guide.)
 */
export const CONFORM_WRONG = 0.02;

/** A conformable fit already made for a job that is run again (runFitJobShared runs one several times) */
const conformFits = new WeakMap<ConformJob, ConformFit>();

/** The surface another runs alongside, as it is fitted now */
export interface AlongsideOf {
    field: FittedField;
    trend: Plane | null;
    /** The vertices of its mesh, and the cell it was drawn with */
    vertices: Float64Array | null;
    cell: number | null;
}

export type FitJob = SheetJob | BodyJob | ShellJob | VeinJob | ConformJob;

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
    /** A vein that meets the surface it ends on, and stops there (absent: it does not) */
    ended?: boolean;
    /** A shell kept inside a unit of a model: cut off at the unit's faces */
    domained?: boolean;
    /** It was fitted along the ground as the model's readings say it lies from place to place */
    layered?: boolean;
    /** ... and, within the ground, the plunge from place to place as well */
    plunging?: boolean;
    /**
     * Of the logging it holds in the holes it is built from, the metres that
     * are its own units and the metres that are other ground (absent: it has
     * no logging to be read against, or holds none of it). A body can have
     * every interval "on the right side" and still hold mostly other ground:
     * an interval may reach half its length across its skin.
     */
    own?: { unit: number; other: number };
    /**
     * Places held by hand by a distance (lenses put into it or cut out of
     * it): how many there are, and how many logged intervals of the holes
     * it is built from they put on the other side of its skin than the
     * logging has them. The hand is followed, and this says so. Absent:
     * none are held.
     */
    lenses?: { held: number; over: number };
    /** Its fit was the one kept from the last time it was fitted: only what is put into it after the fit, or how it is drawn, had changed */
    kept?: true;
    /** Thin sheets: nothing of it is drawn further than this from a place where it is known, m (absent: it runs as far as its fit takes it) */
    reach?: number;
    /** Pieces left out of its mesh and its volume because they enclose less than `least` (m3), and how much they enclose all together (absent: none) */
    small?: { pieces: number; volume: number; least: number };
    /** Thin sheets drawn in the space they are fitted in: how fine its cells are across its sheets, m (absent: its cells are `cell` every way) */
    cellAcross?: number;
    /**
     * A proportion's shell (ShellRule.of): the mean share of the unit in the ground inside it, and all the unit
     * within its reach over what is inside it (1: none is said to be outside it). Null: nothing is inside it
     */
    share?: { inside: number | null; allOverInside: number | null };
}

/** How a shell sits against its samples */
export type ShellSummary = ShellCounts;

export interface FitSummary extends FitStats {
    /** Time taken, ms */
    ms: number;
    /** Of that, the drawing of a vein or a body from its fit (ms) */
    meshMs?: number;
    /** The size of the cells it was meshed with, m (absent on a draft's stats from before it was kept) */
    cell?: number;
    /** The mesh was cut short (too many cells) */
    truncated: boolean;
    /** How the logged intervals sit against the surface (null: it is not built from logging) */
    sides: SideReport | null;
    /** At how many of its places it was held to the model's direction (absent: none) */
    guided?: number;
    /** Fitted about the overall plane it had before: how far from it, in degrees, the plane its inputs give now is (absent: worked out afresh) */
    turned?: number;
    /** Its mesh's grid nodes: how many had the field worked out, and how many were as the last mesh left them (absent: not kept) */
    nodes?: { evaluated: number; reused: number };
    /** Of the blocks fitted again, how many were fitted in other workers at the same time (absent: none) */
    shared?: number;
    /** Its volume and pieces (absent or null: it is not a closed body) */
    body?: BodySummary | null;
    /** For a shell: its samples counted against it */
    shell?: ShellSummary | null;
    /** For a vein: what it is built from and how thick it is at the holes */
    vein?: VeinSummary | null;
    /** For a surface that runs alongside another: how far from it it is, and what would cross it */
    conform?: ConformSummary | null;
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
/** empty = not enough points yet; failed = the fit could not be solved (`why`, when the solver said) */
type NotFitted = { ok: false; reason: 'empty' | 'failed'; why?: FitFailure };

/** line = the points only define a line, so this is the plane through it. `trend`: its overall plane */
export type SheetOutput = (Fitted & { status: 'line' | 'sheet'; trend: Plane }) | NotFitted;
/** A closed body has no overall plane */
export type BodyOutput = (Fitted & { status: 'body'; trend: null }) | NotFitted;
export type FitOutput = SheetOutput | BodyOutput;

/**
 * A cell size for a mesh: the nearest of 1, 1.25, 1.6, 2, 2.5, 3.2, 4, 5, 6.4,
 * 8 (times a power of ten). A surface's size changes a little with every
 * point moved; its cells only change when it has grown or shrunk by a step.
 */
export function gridCell(size: number): number {
    if (!(size > 0) || !Number.isFinite(size)) return size;
    const STEPS = [1, 1.25, 1.6, 2, 2.5, 3.2, 4, 5, 6.4, 8, 10];
    const decade = 10 ** Math.floor(Math.log10(size));
    const x = size / decade;
    let best = STEPS[0];
    for (const s of STEPS) if (Math.abs(Math.log(s / x)) < Math.abs(Math.log(best / x))) best = s;
    // (One multiplication, so the same size always comes out as exactly the same number)
    return Number((best * decade).toPrecision(3));
}

/** Grid cells along the longest side of a surface */
const CELLS = { draft: 40, final: 110 };
/** The data box is grown by this share of its size, so a surface runs a little past the data */
const BOX_PAD = 0.05;
/** A surface is drawn at least this share of its longest line's length either side of it */
const LINE_REACH = 0.15;
/** A surface is fitted through at most this many contacts (more are thinned: close ones are averaged) */
export const MAX_CONTACT_POINTS = 20_000;
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
    return Math.max(autoReach(through, groups), LINE_REACH * lines.extrude.reduce((m, v) => Math.max(m, v), -Infinity));
}

/** Two lists of numbers end to end (spreading tens of thousands of them into a call would run out of room) */
function joined(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
    const out = new Float64Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
}

/**
 * The places a surface is asked to pass through, xyz triples: the points
 * placed by hand first, then the contacts its logging gives (thinned to what
 * fits quickly), then points along its lines that are on no slice.
 */
export function surfacePoints(surface: SurfaceObject, found: ContactInputs | null = null): Float64Array {
    const placed = surface.points.flatMap(p => p.p);
    const logged = found && found.contacts.length > 0 ? thinPoints(found.contacts, MAX_CONTACT_POINTS) : null;
    const free = freeLineSamples(surface.polylines).positions;
    if (free.length === 0) return logged ? joined(placed, logged) : Float64Array.from(placed);
    const out = new Float64Array(placed.length + (logged?.length ?? 0) + free.length);
    out.set(placed);
    if (logged) out.set(logged, placed.length);
    out.set(free, out.length - free.length);
    return out;
}

/**
 * Where the lie of a surface was measured, as its fit takes it: at its points
 * with a reading, then at the ticked nodes of its lines. `through` is every
 * place the surface passes through (its points, then points along its lines
 * in space, then along its lines on slices).
 *
 * A reading holds the surface to its plane for a share of the way to the
 * nearest other place. For a tick on a line that is the nearest place OFF its
 * line: along the line the surface is held already, and the tick says how it
 * lies across it, towards whatever comes next.
 */
export function surfaceReadings(surface: SurfaceObject, through: ArrayLike<number>, lines: LineSamples | null): ReadingSamples | null {
    const ticks = nodeReadings(surface.polylines);
    const out = readingSamples(ticks.length > 0 ? [...surface.points, ...ticks] : surface.points, through);
    if (!out || ticks.length === 0) return out;
    // Whose each place is: no line's (-1), or a line's by its place in the list
    const count = Math.floor(through.length / 3);
    const free = freeLineSamples(surface.polylines).groups;
    const onSlices = lines ? lines.groups.length : 0;
    const owner = new Int32Array(count).fill(-1);
    owner.set(free, count - onSlices - free.length);
    if (lines) owner.set(lines.groups, count - onSlices);
    const first = Math.min(MAX_READINGS, surface.points.reduce((n, p) => n + (p.reading ? 1 : 0), 0));
    for (let k = first; k < out.offsets.length; k++) {
        const tick = ticks[k - first];
        // (A tick on a line: its line's own places are close either side of it, and it is held the same all round)
        out.byValues[k] = 1;
        out.rims?.fill(0, k * RIM_PLACES, (k + 1) * RIM_PLACES);
        let nearest = Infinity;
        for (let j = 0; j < count; j++) {
            if (owner[j] === tick.line) continue;
            const d = Math.hypot(through[j * 3] - tick.p[0], through[j * 3 + 1] - tick.p[1], through[j * 3 + 2] - tick.p[2]);
            if (d > 1e-6 && d < nearest) nearest = d;
        }
        // (A line on its own: as far as its next place along it, as worked out already)
        if (Number.isFinite(nearest)) out.offsets[k] = holdOffset(nearest, tick.reading!.reach);
    }
    return out;
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
    return sheetGuides(field, points, lines ? joined(points, lines.positions) : points, i => !!(surface.points[i]?.reading || surface.points[i]?.direction));
}

/** What is not held exactly (off the drillholes, or everything) is this loose: as a surface half-way between "through each" and "smooth" */
export const SNAP_LOOSE = smoothingFromFollow(0.5);

/** The looseness of a set that counts for `weight` (1: in full, none) */
export function weightLooseness(weight: number): number {
    return weight >= 1 ? 0 : smoothingFromFollow(1 - Math.max(0, weight));
}

/**
 * How loosely each of a surface's places is followed, on top of how closely
 * it follows them all (`params.follow`): for each of its points as the fit
 * takes them (`surfacePoints`: placed, then the contacts, then along its
 * lines in space) and for each place along its other lines. A set that
 * counts for less is looser (`weightLooseness`); with `snap` 'holes' what is
 * not on a drillhole is `SNAP_LOOSE`, with 'none' everything is. Null lists:
 * nothing is loose.
 */
export function inputLooseness(surface: SurfaceObject, count: number, lines: LineSamples | null): { loose: Float64Array | null; looseLines: Float64Array | null } {
    const snap = surface.params.snap ?? 'all';
    const w = surface.weights;
    if (snap === 'all' && !w) return { loose: null, looseLines: null };
    const offHoles = snap === 'all' ? 0 : SNAP_LOOSE, onHoles = snap === 'none' ? SNAP_LOOSE : 0;
    const loose = new Float64Array(count);
    const placed = Math.min(count, surface.points.length);
    for (let i = 0; i < placed; i++) loose[i] = (surface.points[i].snap ? onHoles : offHoles) + weightLooseness(w?.points[i] ?? 1);
    const free = freeLineSamples(surface.polylines).groups;
    const logged = count - placed - free.length;
    for (let i = placed; i < placed + logged; i++) loose[i] = onHoles;
    for (let j = 0; j < free.length && placed + logged + j < count; j++) loose[placed + logged + j] = offHoles + weightLooseness(w?.lines[free[j]] ?? 1);
    const looseLines = lines ? Float64Array.from(lines.groups, g => offHoles + weightLooseness(w?.lines[g] ?? 1)) : null;
    const any = (a: Float64Array | null) => !!a && a.some(v => v > 0);
    return { loose: any(loose) ? loose : null, looseLines: any(looseLines) ? looseLines : null };
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
    const through = lines ? joined(points, lines.positions) : points;
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
    // (A cell size the user set is used as it is; one worked out is rounded, so that it stays put while the surface is edited)
    const fine = surface.params.resolution ?? gridCell(span / CELLS.final);
    const cell = quality === 'final' ? fine : Math.max(fine, gridCell(span / CELLS.draft));

    return {
        type: 'sheet', blocksOf: surface.id, points, lines,
        ...inputLooseness(surface, points.length / 3, lines),
        pointAcross: placesAcross(surface.points, surface.polylines, points.length / 3),
        // From logging, the first side is the side of its first units, whatever was placed by hand
        along: surface.along, refDirection: found?.facing ?? surface.refDirection,
        holdTo: surface.trendHeld ?? null,
        smoothing: smoothingFromFollow(surface.params.follow),
        box, reach, cell,
        outline: frame ? surface.params.outline : null,
        // A draft is for showing something soon: the check comes with the full fit
        checks: found && quality === 'final' && found.checks.side.length > 0 ? found.checks : null,
        readings: surfaceReadings(surface, through, lines),
        directed: pointDirectionSamples(surface.points, through),
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
    guides: GuideSamples | null = null, ends: { field: FittedField; side: 1 | -1 } | null = null, alongside: AlongsideOf | null = null,
): FitJob | null {
    const shell = found && 'values' in found ? found : null, logged = found && !('values' in found) ? found : null;
    if (alongside && surface.conform && (surface.rule.kind === 'sheet' || surface.rule.kind === 'contact')) return buildConformJob(surface, dataBox, quality, logged, alongside, guides);
    return surface.rule.kind === 'shell' ? buildShellJob(surface, quality, shell)
        : surface.rule.kind === 'body' && surface.rule.vein ? buildVeinJob(surface, dataBox, quality, logged, ends, guides, stretch)
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
    // (A proportion is as smooth as the pieces taken together are long: cells a quarter of that hold all of its shape)
    const least = rule.of ? (local ?? 1) * (inputs.step ?? 0) / 4 : (inputs.step ?? 0) / 2;
    const fine = surface.params.resolution ?? Math.max(usual / SHELL_CELLS.final / thin, least, 1e-6);
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
        type: 'shell', blocksOf: surface.id, points: inputs.positions, values, next: inputs.next, count: inputs.count, reach: inputs.reach,
        smoothing, local, background, cover, box, cell, stretch: inputs.stretch, layers: inputs.layers,
        fitMark: keyMark(JSON.stringify([inputs.mark, rule.cutoff, rule.log, rule.band, smoothing, fine, local, background, ...(rule.of ? ['share'] : [])])),
        ...(rule.of ? { shareAt: rule.cutoff } : {}),
    };
}

/** The blocks last fitted for each surface (in the worker, where the fits are run), for the few surfaces fitted last */
const blockStores = new Map<string, BlockCache>();
const KEPT_STORES = 24;

function blocksFor(surfaceId: string | undefined): BlockCache | null {
    if (!surfaceId) return null;
    let store = blockStores.get(surfaceId);
    if (store) blockStores.delete(surfaceId);
    else store = blockCache();
    // (The most recently fitted last: the one fitted longest ago goes first)
    blockStores.set(surfaceId, store);
    if (blockStores.size > KEPT_STORES) blockStores.delete(blockStores.keys().next().value!);
    return store;
}

/** What the last mesh of each sheet left, by surface and cell size (a draft and a full mesh are on different grids) */
const meshMemories = new Map<string, SheetMemory>();
const KEPT_MESHES = 16;

function rememberMesh(key: string, memory: SheetMemory) {
    meshMemories.delete(key);
    meshMemories.set(key, memory);
    if (meshMemories.size > KEPT_MESHES) meshMemories.delete(meshMemories.keys().next().value!);
}

/** The last few shells fitted, by `fitMark`: the full mesh after a draft does not fit again */
const keptShells = new Map<string, SheetFit>();

/** A shell kept inside veins thinner than the model's cells is meshed with cells at most this many times finer than its own */
const THIN_FINER = 16;

function runShellJob(job: ShellJob, t0: number): BodyOutput {
    // (What is handed back is handed over, not copied: the fit kept here has numbers of its own)
    const had = keptShells.get(job.fitMark);
    let fit = had ? ownNumbers(had) : undefined;
    if (!fit) {
        fit = fitShell({
            positions: job.points, values: job.values, next: job.next, reach: job.reach, cover: job.cover, smoothing: job.smoothing, local: job.local, background: job.background,
            stretch: job.stretch, layers: job.layers, blocks: blocksFor(job.blocksOf),
        });
        if (fit.status === 'body') {
            keptShells.set(job.fitMark, ownNumbers(fit));
            if (keptShells.size > 3) keptShells.delete(keptShells.keys().next().value!);
        }
    }
    if (fit.status === 'empty') return { ok: false, reason: 'empty' };
    if (fit.status === 'failed' || !fit.field || !fit.stats) return { ok: false, reason: 'failed', why: fit.why };
    // A shell that follows a structure is thin across it and wide along it: it is drawn on a grid in the
    // space it was fitted in, where it is neither, and its corners are then put back where they are in the ground
    // (One that follows the ground from place to place has no one such space: it is drawn as it is in the ground)
    const st = job.layers ? null : job.stretch;
    const drawn: SheetFit = st ? { ...fit, field: { ...fit.field, stretch: null }, onSurface: stretchPoints(fit.onSurface, st) } : fit;
    const box = st ? stretchedBox(job.box, st) : job.box;
    let cell = job.cell;
    // Kept inside a unit of a model: where the unit is, in the ground (the mesh may be made in stretched space)
    const domain = job.domain, solids = job.solids, back = st ? inverseStretch(st) : null;
    // (How near a solid's faces: wanted only as far as a few cells reach, as the cells are in the ground)
    const wide = st ? Math.max(1, 1 / st.factor) * Math.max(1, 1 / (st.second?.factor ?? 1)) : 1;
    const within = domain ? (pts: Float64Array) => unitNearness(domain, back ? stretchPoints(pts, back) : pts)
        : solids ? (pts: Float64Array) => solidNearness(solids, back ? stretchPoints(pts, back) : pts, 4 * cell * wide) : undefined;
    // Inside veins thinner than the model's cells: cells fine enough to hold them, started from the veins' walls as
    // well (the shell's own skin may be nowhere near them: it can hold the whole of a vein)
    // (Inside solids: the same where they are thinner than two of its cells)
    const walls = !domain && solids ? solidWalls(solids) : null;
    const veins = domain ? thinDomain(domain) : walls && walls.thickness < 2 * cell ? walls : null;
    let seeds: Float64Array | undefined;
    if (veins) {
        cell = Math.min(cell, Math.max(veins.thickness / 2, cell / THIN_FINER));
        const walls = st ? stretchPoints(veins.seeds, st) : veins.seeds;
        seeds = new Float64Array(drawn.onSurface.length + walls.length);
        seeds.set(drawn.onSurface);
        seeds.set(walls, drawn.onSurface.length);
    }
    let mesh = meshBody(drawn, box, cell, seeds, within);
    for (let tries = 0; mesh.truncated && tries < MAX_COARSER; tries++) {
        cell *= coarser(tries);
        mesh = meshBody(drawn, box, cell, seeds, within);
    }
    const counts = shellCounts(drawn.field!, st ? stretchPoints(job.points, st) : job.points, job.values, job.count, box.min, cell);
    // A proportion: the shares added up over the ground it may be in (where the fit is made: the lattice is even there)
    const share = job.shareAt !== undefined
        ? shareWithin(drawn.field!, job.shareAt, box, SHARE_LATTICE, within ? pts => Array.from(within(pts), v => v >= 0) : undefined)
        : null;
    if (st) mesh = { ...mesh, vertices: stretchPoints(mesh.vertices, inverseStretch(st)) };
    return {
        ok: true, status: 'body',
        vertices: mesh.vertices, triangles: mesh.triangles,
        // A copy of what is handed over: the kept fit stays whole when these go to the main thread
        field: { ...fit.field, centres: fit.field.centres.slice(), weights: fit.field.weights.slice() },
        trend: null, lineSigns: fit.lineSigns,
        stats: {
            ...fit.stats, ms: performance.now() - t0, truncated: mesh.truncated, sides: null,
            body: { volume: closedVolume(mesh), pieces: meshPieces(mesh), cut: mesh.cut, cell, thin: false, ...(domain || solids ? { domained: true } : {}), ...(share ? { share } : {}) },
            shell: counts,
        },
    };
}

/** A proportion's shares are added up over about this many places through the ground it may be in */
const SHARE_LATTICE = 120_000;

/** The job for a closed body. Null when its logging gives it nothing to pass through. */
/** An intrusion of thin sheets is drawn this many times the usual gap between its stretches from the nearest place it is known */
const SHEETS_REACH = 2;
/** ... the usual gap being the one this share of the joins between neighbouring stretches are within */
const SHEETS_GAP_SHARE = 0.95;
/** At most this many of its stretches are looked at for it */
const MAX_REACH_PLACES = 2000;

/**
 * How far an intrusion of thin sheets is drawn from the nearest place it is
 * known, when no reach is set for it: twice the gap that nearly all
 * neighbouring stretches of it are within (the joins of the tree that links
 * the middles of its stretches, shortest first: one far-off hole does not
 * set it, as it would by the widest), and never less than five times as
 * thick as it usually is down a hole. One stretch: a tenth of `size`.
 */
export function sheetsAutoReach(middles: ContactInputs['middles'], size: number): number {
    const rows: number[] = [];
    for (let i = 0; i < middles.side.length; i++) if (middles.side[i] > 0) rows.push(i);
    if (rows.length < 2) return size / 10;
    const at = chosen(middles.positions, rows);
    const used = rows.length <= MAX_REACH_PLACES ? at : chosen(at, pickSpread(at, MAX_REACH_PLACES));
    const n = used.length / 3;
    // Prim's algorithm, as `autoReach`, keeping every join
    const dist = new Float64Array(n).fill(Infinity), done = new Uint8Array(n), joins: number[] = [];
    let current = 0;
    done[0] = 1;
    for (let added = 1; added < n; added++) {
        let next = -1, best = Infinity;
        for (let j = 0; j < n; j++) {
            if (done[j]) continue;
            const d = Math.hypot(used[current * 3] - used[j * 3], used[current * 3 + 1] - used[j * 3 + 1], used[current * 3 + 2] - used[j * 3 + 2]);
            if (d < dist[j]) dist[j] = d;
            if (dist[j] < best) { best = dist[j]; next = j; }
        }
        if (next < 0) break;
        done[next] = 1;
        joins.push(best);
        current = next;
    }
    joins.sort((a, b) => a - b);
    const gap = joins.length > 0 ? joins[Math.min(joins.length - 1, Math.floor(SHEETS_GAP_SHARE * joins.length))] : 0;
    const lengths = rows.map(i => middles.length[i]).sort((a, b) => a - b);
    const usual = lengths[lengths.length >> 1] ?? 0;
    return Math.max(SHEETS_REACH * gap, 5 * usual, gap > 0 ? 0 : size / 10);
}

/**
 * The space an intrusion of thin sheets is fitted in (BodyRule.sheets):
 * stretched across the plane of its sheets, about the middle of `box`. Null
 * for any other surface, when a global trend of its own is set for it (it
 * is then fitted along that), or when nothing gives its sheets a plane.
 */
export function sheetsFrame(surface: Pick<SurfaceObject, 'rule' | 'params'>, found: Pick<ContactInputs, 'joinPlane'> | null, box: Box3): Stretch | null {
    const rule = surface.rule;
    if (rule.kind !== 'body' || rule.vein || !rule.sheets || surface.params.trendOwn || !found?.joinPlane) return null;
    const factor = rule.sheets.strength ?? SHEETS_STRENGTH;
    if (!(factor > 1)) return null;
    return { normal: [found.joinPlane[0], found.joinPlane[1], found.joinPlane[2]], point: [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2], factor };
}

export function buildBodyJob(surface: SurfaceObject, dataBox: Box3 | null, quality: FitQuality, found: ContactInputs | null, stretch: Stretch | null = null): BodyJob | null {
    if (!found) return null;
    const placed = surface.points.flatMap(p => p.p);
    const contacts = bodyContacts(found);
    // Its lines: those in space give more places on its skin; those drawn on slices say which way it faces as well
    const free = freeLineSamples(surface.polylines).positions;
    const lines = sampleLines(surface.polylines);
    const points = new Float64Array(placed.length + contacts.length + free.length);
    points.set(placed);
    points.set(contacts, placed.length);
    points.set(free, placed.length + contacts.length);
    const drawn = lines ? lines.positions : new Float64Array(0);
    const seeds = new Float64Array(placed.length + found.contacts.length + free.length + drawn.length);
    seeds.set(placed);
    seeds.set(found.contacts, placed.length);
    seeds.set(free, placed.length + found.contacts.length);
    seeds.set(drawn, placed.length + found.contacts.length + free.length);
    // How its skin lies where that was set by hand: a dip or a direction on a point, a tick on a line
    const through = lines ? joined(points, lines.positions) : points;
    const readings = surfaceReadings(surface, through, lines);
    const directed = pointDirectionSamples(surface.points, through);
    const own = boundsOf(seeds);
    if (!own) return null;
    const base = dataBox ?? own;
    const size = Math.max(base.max[0] - base.min[0], base.max[1] - base.min[1], base.max[2] - base.min[2], 1);
    const pad = size * BOX_PAD;
    const box: Box3 = {
        min: [Math.min(base.min[0], own.min[0]) - pad, Math.min(base.min[1], own.min[1]) - pad, Math.min(base.min[2], own.min[2]) - pad],
        max: [Math.max(base.max[0], own.max[0]) + pad, Math.max(base.max[1], own.max[1]) + pad, Math.max(base.max[2], own.max[2]) + pad],
    };

    // Thin sheets built as a volume: its logging held strictly, and carried along the plane of its sheets
    const sheets = surface.rule.kind === 'body' && !surface.rule.vein ? surface.rule.sheets ?? null : null;
    // The stretches inside and outside it: a spread of each when there are a great many
    const { positions, side } = found.middles;
    // (Thin sheets: every one of them, when more would be left out of the spread than the rounds that put its logging right could add)
    let leftOut = 0;
    for (const which of [1, -1]) {
        let count = 0;
        for (let i = 0; i < side.length; i++) if (side[i] === which) count++;
        leftOut += Math.max(0, count - MAX_BODY_MIDDLES);
    }
    const every = !!sheets && leftOut > SIDE_LIMITS.added;
    const middles: number[] = [], sides: number[] = [];
    for (const which of [1, -1]) {
        const rows: number[] = [];
        for (let i = 0; i < side.length; i++) if (side[i] === which) rows.push(i);
        const own = chosen(positions, rows);
        const kept = every ? own : chosen(own, pickSpread(own, MAX_BODY_MIDDLES));
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

    // Thin sheets: along the plane of its sheets, unless a global trend of its own is set for it
    const along = sheetsFrame(surface, found, box);
    // ... and known only near where holes meet it: its contacts, its logging piece by piece, and what was put on it by hand
    let known: BodyJob['known'] = null;
    if (sheets) {
        const inside: number[] = [];
        const c = found.checks;
        for (let i = 0; i < c.side.length; i++) if (c.side[i] > 0) inside.push(c.positions[i * 3], c.positions[i * 3 + 1], c.positions[i * 3 + 2]);
        for (let i = 0; i < side.length; i++) if (side[i] > 0) inside.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
        const at = new Float64Array(seeds.length + inside.length);
        at.set(seeds);
        at.set(inside, seeds.length);
        known = { positions: at, reach: surface.params.reach ?? sheetsAutoReach(found.middles, size) };
    }
    // Places held by hand by a distance: lenses, no part of the fit
    const lenses = surface.rule.kind === 'body' && !surface.rule.vein ? heldAsLenses(surface.rule.control?.marks ?? []) : null;
    return {
        type: 'body', blocksOf: surface.id, points, seeds,
        ...(lenses ? { lenses } : {}),
        middles: { positions: Float64Array.from(middles), side: Int8Array.from(sides) },
        // Along the structure it follows; else, if it is thin, along the plane the holes meet it in
        ...(along ? { stretch: along, thin: bodyShape(found.middles).thin } : stretch ? { stretch, thin: bodyShape(found.middles).thin } : bodyShape(found.middles)),
        ...(sheets ? { limits: { strict: true } } : {}),
        ...(known && known.reach > 0 ? { known } : {}),
        ...(sheets && (sheets.least ?? 0) > 0 ? { least: sheets.least } : {}),
        smoothing: smoothingFromFollow(surface.params.follow),
        box, cell,
        checks: quality === 'final' && found.checks.side.length > 0 ? found.checks : null,
        // (Only when there are some: a body with none has the job it had)
        ...(readings ? { readings } : {}), ...(directed ? { directed } : {}), ...(lines ? { lines } : {}),
    };
}

/** A piece of logging is read at places this far apart along it at most, m, and at no more than this many */
const OWN_STEP = 0.5;
const OWN_MOST = 8;

/**
 * Of the logged metres a body holds in the holes it is built from: its
 * units, and other ground. The logging is known here as the pieces it is
 * checked by (contacts.ts, `SideChecks`: the middle of each, half its
 * length, its depth); each is read at places along it, found from the
 * middles of its neighbours down the same hole. Null when nothing of the
 * logging can be read (no depths), or it holds none of it.
 *
 * `memo`: what the field has at those places WITHOUT its touches is kept in
 * it, and used the next time: a body whose lenses alone have changed is not
 * read again at all its logging.
 */
export function heldInOwnHoles(field: FittedField, checks: SideChecks | null, memo: { base?: Float64Array } | null = null): { unit: number; other: number } | null {
    const depth = checks?.depth;
    if (!checks || !depth) return null;
    const n = checks.side.length;
    const places: number[] = [], weight: number[] = [], side: number[] = [];
    const at = (i: number, k: number) => checks.positions[i * 3 + k];
    /** Another piece of the same hole next to this one in the list, at another depth */
    const beside = (i: number, j: number) => j >= 0 && j < n && checks.hole[j] === checks.hole[i] && Number.isFinite(depth[j]) && depth[j] !== depth[i] && checks.slack[j] > 0;
    for (let i = 0; i < n; i++) {
        const half = checks.slack[i];
        if (!(half > 0) || !Number.isFinite(depth[i])) continue;
        const parts = Math.min(OWN_MOST, Math.max(1, Math.ceil(2 * half / OWN_STEP)));
        for (let q = 0; q < parts; q++) {
            // How far down the hole from the piece's middle this place is
            const off = -half + (q + 0.5) * 2 * half / parts;
            // Along the hole towards the neighbour on that side; with none there, as the other neighbour says the hole runs
            const j = beside(i, off >= 0 ? i + 1 : i - 1) ? (off >= 0 ? i + 1 : i - 1) : beside(i, off >= 0 ? i - 1 : i + 1) ? (off >= 0 ? i - 1 : i + 1) : -1;
            const t = j < 0 ? 0 : off / (depth[j] - depth[i]);
            for (let k = 0; k < 3; k++) places.push(at(i, k) + (j < 0 ? 0 : t * (at(j, k) - at(i, k))));
            weight.push(2 * half / parts);
            side.push(checks.side[i]);
        }
    }
    if (weight.length === 0) return null;
    let f: Float64Array;
    if (memo) {
        const base = memo.base && memo.base.length === weight.length ? memo.base : evaluateField({ ...field, touches: null }, places);
        memo.base = base;
        f = field.touches ? withTouches(field.touches, places, base.slice()) : base;
    } else f = evaluateField(field, places);
    let unit = 0, other = 0;
    for (let i = 0; i < weight.length; i++) {
        if (!(f[i] > 0)) continue;
        if (side[i] > 0) unit += weight[i];
        else other += weight[i];
    }
    return unit + other > 0 ? { unit, other } : null;
}

/**
 * A mark of everything a body's fit is made from: two jobs with the same mark
 * have the same fit, to the last digit. Not in it: what is put into the body
 * or cut out of it after the fit (its lenses), and how it is drawn (its
 * cells, its seeds, its reach, the pieces left out, what it is kept inside).
 * Null: it follows the ground from place to place, and what that is made
 * from is not marked here.
 */
export function bodyFitMark(job: BodyJob): string | null {
    if (job.layers) return null;
    const bytes = bytesMark(job.points, job.middles.positions, job.middles.side, job.checks?.positions, job.checks?.side, job.checks?.slack, job.checks?.toContact, job.checks?.hole, job.checks?.depth);
    const rest = JSON.stringify([
        job.box, job.smoothing, job.stretch, job.limits ?? 0,
        job.readings ? Object.values(job.readings).map(v => (ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : v)) : 0,
        job.directed ? Object.values(job.directed).map(v => (ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : v)) : 0,
        job.lines ? Object.values(job.lines).map(v => (ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : v)) : 0,
    ]);
    return `${bytes}:${keyMark(rest)}:${rest.length}`;
}

/** A mark of the bytes of some arrays, in order (an absent one counts as such) */
function bytesMark(...views: (ArrayBufferView | undefined | null)[]): string {
    let a = 0x811c9dc5, b = 0x1b873593, n = 0;
    for (const v of views) {
        if (!v) { a = Math.imul(a ^ 0xff, 0x01000193); continue; }
        const u = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
        for (let i = 0; i < u.length; i++) {
            a = Math.imul(a ^ u[i], 0x01000193);
            b = Math.imul(b ^ u[i], 0x85ebca6b) + i | 0;
        }
        n += u.length;
        a = Math.imul(a ^ (u.length & 0xff), 0x01000193);
    }
    return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}:${n}`;
}

/**
 * The lenses of two meshes of one body that are not in both: a node none of
 * them reaches has the value it had. Null: the lenses the two share are not
 * in the same order (a later one lies over an earlier), or one is there
 * twice, and nothing is taken as it was.
 */
function lensesChanged(was: FieldTouches | null, now: FieldTouches | null): { of: FieldTouches; at: number }[] | null {
    const keys = (t: FieldTouches | null) => Array.from({ length: t ? t.side.length : 0 }, (_, j) => `${t!.places[j * 3]},${t!.places[j * 3 + 1]},${t!.places[j * 3 + 2]},${t!.side[j]},${t!.by[j]},${t!.times?.[j] || 0},${t!.ends && t!.ends[j * 3] === t!.ends[j * 3] ? `${t!.ends[j * 3]},${t!.ends[j * 3 + 1]},${t!.ends[j * 3 + 2]}` : ''}`);
    const a = keys(was), b = keys(now);
    if (new Set(a).size !== a.length || new Set(b).size !== b.length) return null;
    const inA = new Set(a), inB = new Set(b);
    const sharedA = a.filter(k => inB.has(k)), sharedB = b.filter(k => inA.has(k));
    if (sharedA.some((k, i) => k !== sharedB[i])) return null;
    // (... and lenses lie along one plane in both: the body is carried the same way)
    const flat = (t: FieldTouches | null) => JSON.stringify(t?.across ?? 0);
    if (was && now && flat(was) !== flat(now)) return null;
    const out: { of: FieldTouches; at: number }[] = [];
    a.forEach((k, j) => { if (!inB.has(k)) out.push({ of: was!, at: j }); });
    b.forEach((k, j) => { if (!inA.has(k)) out.push({ of: now!, at: j }); });
    return out;
}

/**
 * Whether a node of a body's grid (in the space it is drawn in) is out of
 * reach of every one of these lenses, told quickly: a ball round each that
 * holds all it reaches, and one box round the balls.
 */
function farFrom(changed: { of: FieldTouches; at: number }[], space: Stretch | null): (x: number, y: number, z: number) => boolean {
    if (changed.length === 0) return () => true;
    const places: number[] = [], reaches: number[] = [];
    for (const c of changed) {
        // (It reaches twice its distance across its plane and `times` as far along it; on the grid, across the body's sheets counts `factor` times)
        const by = c.of.by[c.at], times = Math.max(c.of.across?.times ?? 1, c.of.times?.[c.at] || 0), fine = Math.max(1, space?.factor ?? 1) * Math.max(1, space?.second?.factor ?? 1);
        const a = [c.of.places[c.at * 3], c.of.places[c.at * 3 + 1], c.of.places[c.at * 3 + 2]];
        const e = c.of.ends, stretch = !!e && e[c.at * 3] === e[c.at * 3];
        // (A stretch: balls along it, no further apart than it is held)
        const d = stretch ? [e![c.at * 3] - a[0], e![c.at * 3 + 1] - a[1], e![c.at * 3 + 2] - a[2]] : [0, 0, 0];
        const long = Math.hypot(d[0], d[1], d[2]);
        // (A stretch that climbs across the plane of the lenses lies in a plane of its own, through its line: so much of how far it runs along that plane is across the body's sheets)
        const n = c.of.across?.normal, size = n ? Math.hypot(n[0], n[1], n[2]) : 0;
        const climbs = stretch && long > 0 ? (size > 0 ? Math.min(1, Math.abs(d[0] * n![0] + d[1] * n![1] + d[2] * n![2]) / (long * size)) : 1) : 0;
        const r = 2 * by * (times + fine * (1 + times * climbs));
        const steps = stretch ? Math.max(1, Math.ceil(long / Math.max(by, 1e-6))) : 0;
        for (let s = 0; s <= steps; s++) { const t = steps ? s / steps : 0; places.push(a[0] + t * d[0], a[1] + t * d[1], a[2] + t * d[2]); reaches.push(r); }
    }
    const at = Float64Array.from(places), reach = Float64Array.from(reaches);
    const on = space ? stretchPoints(at, space) : at;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let j = 0; j < reach.length; j++) for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], on[j * 3 + k] - reach[j]);
        hi[k] = Math.max(hi[k], on[j * 3 + k] + reach[j]);
    }
    return (x, y, z) => {
        if (x < lo[0] || y < lo[1] || z < lo[2] || x > hi[0] || y > hi[1] || z > hi[2]) return true;
        for (let j = 0; j < reach.length; j++) {
            const dx = x - on[j * 3], dy = y - on[j * 3 + 1], dz = z - on[j * 3 + 2];
            if (dx * dx + dy * dy + dz * dz < reach[j] * reach[j]) return false;
        }
        return true;
    };
}

/** With more lenses new or gone than this, a kept mesh's values are not gone through one by one: the body is drawn afresh (its fit is still kept) */
const KEPT_LENSES_MOST = 64;

/** A fit with its field's centres and weights as arrays of its own */
const ownNumbers = (fit: SheetFit): SheetFit => (fit.field ? { ...fit, field: { ...fit.field, centres: fit.field.centres.slice(), weights: fit.field.weights.slice() } } : fit);

/** The last fit of each body, in the worker it is fitted in, for the few bodies fitted last: a change to its lenses alone does not fit it again */
const keptBodies = new Map<string, {
    mark: string; fit: SheetFit; report: SideReport | null;
    /** Its last mesh: what it was drawn on (`mark`), the field's values at its nodes, and the lenses it had */
    mesh?: { mark: string; memory: NodeMemory; touches: FieldTouches | null };
    /** What the fitted body, without its lenses, has at the places its logging is read at: `at` (how far it is known) says what they hold for */
    read?: { at: string; own: { base?: Float64Array }; checks?: Float64Array };
}>();
const KEPT_BODIES = 8;

function runBodyJob(job: BodyJob, t0: number, memo: SidesMemo | null = null): BodyOutput {
    const mark = job.blocksOf ? bodyFitMark(job) : null;
    // (A draft and the full fit are kept apart: one does not put the other out)
    const keptAs = `${job.blocksOf}|${job.checks ? 'full' : 'draft'}`;
    const had = mark ? keptBodies.get(keptAs) : undefined;
    const kept = had && had.mark === mark ? had : null;
    // (What is handed back is handed over, not copied (surface.worker): the fit kept here has its own numbers)
    const { fit, report } = kept ? { fit: ownNumbers(kept.fit), report: kept.report } : refineSides(
        extra => fitBody({
            points: job.points, middles: job.middles, valued: extra, box: job.box, smoothing: job.smoothing, stretch: job.stretch, layers: job.layers ?? null, blocks: blocksFor(job.blocksOf),
            readings: job.readings ?? null, directed: job.directed ?? null, lines: job.lines ?? null,
        }),
        job.checks, memo, job.limits ?? null,
    );
    if (fit.status === 'empty') return { ok: false, reason: 'empty' };
    if (fit.status === 'failed' || !fit.field || !fit.stats) return { ok: false, reason: 'failed', why: fit.why };
    if (mark && !kept) {
        keptBodies.delete(keptAs);
        keptBodies.set(keptAs, { mark, fit: ownNumbers(fit), report });
        if (keptBodies.size > KEPT_BODIES) keptBodies.delete(keptBodies.keys().next().value!);
    }
    const fitted = performance.now();
    // Thin sheets: beyond the reach of the places it is known at, it is not there. The reach is along its sheets; across them it is
    // known only as much less far as it is carried less far (else it swells into the ground beside its holes that no hole has seen)
    const across = job.known && job.stretch && !job.layers && job.stretch.factor > 1 ? { normal: job.stretch.normal, times: job.stretch.factor } : null;
    const capped: FittedField = job.known
        ? { ...fit.field, cap: { positions: job.known.positions, reach: new Float64Array(job.known.positions.length / 3).fill(job.known.reach), background: -job.known.reach, ground: true, ...(across ? { across } : {}) } }
        : fit.field;
    // Places held by hand by a distance: lenses, as much longer along its sheets as it is carried further along them
    const lenses = job.lenses && job.lenses.side.length > 0 ? job.lenses : null;
    const flat = job.stretch && !job.layers && job.stretch.factor > 1 ? { normal: job.stretch.normal, times: job.stretch.factor } : null;
    const field: FittedField = lenses ? { ...capped, touches: { ...lenses, across: flat } } : capped;
    // (... each drawn from a place on its own skin: it may be nowhere near the rest of the body)
    let seeds = job.seeds;
    if (lenses) {
        const n = flat ? flat.normal : [0, 0, 1], size = Math.hypot(n[0], n[1], n[2]) || 1;
        const skin: number[] = [];
        for (let j = 0; j < lenses.side.length; j++) {
            // (A stretch: from its two ends and its middle)
            const e = lenses.ends, stretch = !!e && e[j * 3] === e[j * 3];
            for (const t of stretch ? [0, 0.5, 1] : [0]) for (const way of [1, -1]) for (let k = 0; k < 3; k++) {
                skin.push(lenses.places[j * 3 + k] + (stretch ? t * (e![j * 3 + k] - lenses.places[j * 3 + k]) : 0) + way * lenses.by[j] * n[k] / size);
            }
        }
        seeds = joined(seeds, skin);
    }
    // (... and it is drawn in the space it was fitted in, where its sheets are not thinner than the cells. One that follows the ground from
    // place to place has no one such space: it is drawn as it is in the ground)
    const space = job.known && job.stretch && !job.layers ? job.stretch : null;
    // (Kept inside a unit of a model: cut off at its faces, where the unit is in the ground)
    const domain = job.domain, solids = job.solids;
    // A body whose fit is kept is drawn from the values its last mesh left at its nodes, where no lens that is new or gone reaches
    // (not one kept inside something else: that may have changed)
    const drawnOn = mark && !domain && !solids ? JSON.stringify([job.cell, job.box, job.known ? [job.known.reach, bytesMark(job.known.positions)] : 0]) : null;
    const lastMesh = drawnOn && kept?.mesh && kept.mesh.mark === drawnOn ? kept.mesh : null;
    const changed = lastMesh ? lensesChanged(lastMesh.touches, field.touches ?? null) : null;
    const whole = meshBody(
        { ...fit, field }, job.box, job.cell, seeds,
        domain ? pts => unitNearness(domain, pts) : solids ? pts => solidNearness(solids, pts, 4 * job.cell * (space ? Math.max(1, 1 / space.factor) * Math.max(1, 1 / (space.second?.factor ?? 1)) : 1)) : undefined,
        space,
        drawnOn ? { last: lastMesh && changed && changed.length <= KEPT_LENSES_MOST ? { memory: lastMesh.memory, still: (x, y, z) => !changed.some(c => touchReaches(c.of, c.at, x, y, z)), far: farFrom(changed, space) } : null } : null,
    );
    const keeper = mark ? keptBodies.get(keptAs) : undefined;
    if (keeper && keeper.mark === mark) keeper.mesh = drawnOn && whole.memory ? { mark: drawnOn, memory: whole.memory, touches: field.touches ?? null } : undefined;
    // (... less its pieces under a set size)
    const cut = withoutSmallPieces(whole, job.least ?? 0);
    const mesh = cut.mesh !== whole ? { ...whole, vertices: cut.mesh.vertices, triangles: cut.mesh.triangles } : whole;
    // (What it has at its logging without its lenses is read once for a fit, and for how far that fit is known)
    const readAt = job.known ? `${job.known.reach}:${bytesMark(job.known.positions)}` : '';
    if (keeper && keeper.mark === mark && keeper.read?.at !== readAt) keeper.read = { at: readAt, own: {} };
    const read = keeper && keeper.mark === mark ? keeper.read! : null;
    const own = heldInOwnHoles(field, job.checks, read?.own ?? null);
    // What the places held by hand have against the logging: intervals on their own side of the fitted body, and not of the body with its lenses
    let over = 0;
    if (lenses && job.checks) {
        const c = job.checks, was = read?.checks ?? evaluateField(capped, c.positions), is = withTouches(field.touches!, c.positions, was.slice());
        if (read) read.checks = was;
        for (let i = 0; i < c.side.length; i++) if (c.side[i] * was[i] > 0 && !(c.side[i] * is[i] > 0)) over++;
    }
    return {
        ok: true, status: 'body',
        vertices: mesh.vertices, triangles: mesh.triangles,
        field, trend: null, lineSigns: fit.lineSigns,
        stats: {
            ...fit.stats, ms: performance.now() - t0, meshMs: performance.now() - fitted, truncated: mesh.truncated, sides: report,
            body: { volume: closedVolume(mesh), pieces: meshPieces(mesh), cut: mesh.cut, cell: job.cell, thin: job.thin, ...(kept ? { kept: true as const } : {}), ...(job.layers ? { layered: true } : {}), ...(job.layers?.second ? { plunging: true } : {}), ...(own ? { own } : {}), ...(lenses ? { lenses: { held: lenses.side.length, over } } : {}), ...(job.known ? { reach: job.known.reach } : {}), ...(cut.left > 0 ? { small: { pieces: cut.left, volume: cut.volume, least: job.least! } } : {}), ...(space && space.factor > 1 ? { cellAcross: job.cell / space.factor } : {}), ...(domain || solids ? { domained: true } : {}) },
        },
    };
}

/** At most this many places on the other surface are looked at to see that it is met once only along a direction */
const MAX_GRAPH_PLACES = 1500;
/** At most this many places on the other surface start the mesh of one a fixed distance from it */
const MAX_OFFSET_SEEDS = 4000;

/** The job for a surface that runs alongside another. Null when it has no places of its own and no distance set. */
export function buildConformJob(surface: SurfaceObject, dataBox: Box3 | null, quality: FitQuality, found: ContactInputs | null, alongside: AlongsideOf, guides: GuideSamples | null = null): ConformJob | null {
    const sheet = buildFitJob(surface, dataBox, quality, found, null);
    const by = surface.conform?.by ?? null;
    const common = { type: 'conform' as const, blocksOf: surface.id, ref: alongside.field, refTrend: alongside.trend, smoothing: smoothingFromFollow(surface.params.follow) };
    const on = alongside.vertices;
    if (sheet) {
        // Everything it passes through says how far it is from the other: its points, its contacts and its lines
        const points = sheet.lines ? joined(sheet.points, sheet.lines.positions) : sheet.points;
        return {
            ...common, points, facing: found?.facing ?? surface.refDirection, by: null, refPlaces: null,
            along: alongside.trend, refOn: on && on.length > 0 ? Float64Array.from(chosen(on, pickSpread(on, MAX_GRAPH_PLACES))) : null,
            box: sheet.box, reach: sheet.reach, outline: sheet.outline, cell: sheet.cell, checks: sheet.checks,
            // (Only logging can say it does better on its own)
            alone: sheet.checks ? (guides ? buildFitJob(surface, dataBox, quality, found, guides) : sheet) : null,
        };
    }
    // No places of its own: a fixed distance from the other, as far as the other goes
    if (by === null || !on || on.length === 0) return null;
    const own = boundsOf(on);
    if (!own) return null;
    const base = dataBox ?? own;
    const pad = Math.max(base.max[0] - base.min[0], base.max[1] - base.min[1], base.max[2] - base.min[2], 1) * BOX_PAD + Math.abs(by);
    const box: Box3 = {
        min: [Math.min(base.min[0], own.min[0]) - pad, Math.min(base.min[1], own.min[1]) - pad, Math.min(base.min[2], own.min[2]) - pad],
        max: [Math.max(base.max[0], own.max[0]) + pad, Math.max(base.max[1], own.max[1]) + pad, Math.max(base.max[2], own.max[2]) + pad],
    };
    const span = Math.max(own.max[0] - own.min[0], own.max[1] - own.min[1], own.max[2] - own.min[2], 1);
    const fine = surface.params.resolution ?? alongside.cell ?? gridCell(span / CELLS.final);
    const cell = quality === 'final' ? fine : Math.max(fine, gridCell(span / CELLS.draft));
    const refPlaces = Float64Array.from(chosen(on, pickSpread(on, MAX_OFFSET_SEEDS)));
    const refOn = Float64Array.from(chosen(refPlaces, pickSpread(refPlaces, MAX_GRAPH_PLACES)));
    return { ...common, points: new Float64Array(0), facing: null, by, refPlaces, along: alongside.trend, refOn, box, reach: 2 * (alongside.cell ?? cell), outline: null, cell, checks: null };
}

function runConformJob(job: ConformJob, t0: number, memo: SidesMemo | null = null): SheetOutput {
    // One with no places of its own: places on the other, moved the set distance off it, are its places
    const set = job.points.length === 0 && job.by !== null ? job.by : null;
    const onSurface = set === null ? job.points : movedPlaces(job.ref, job.refPlaces ?? new Float64Array(0), set, job.cell / 2, true);
    // (Moved off the outside of a bend the places spread out: it is drawn as far from each as they now are apart)
    const reach = set === null ? job.reach : Math.max(job.reach ?? 0, 2.5 * usualGap(onSurface));
    const fit = conformFits.get(job) ?? fitConform({ points: onSurface, ref: job.ref, facing: job.facing, by: null, box: job.box, smoothing: job.smoothing, along: job.along, refOn: job.refOn, step: job.cell / 2 });
    conformFits.set(job, fit);
    if (fit.status === 'empty') return { ok: false, reason: 'empty' };
    if (fit.status === 'failed' || !fit.field || !fit.stats) return { ok: false, reason: 'failed', why: fit.why };
    if (set !== null && fit.conform) fit.conform = { ...fit.conform, fixed: true, places: 0, least: Math.abs(set), usual: Math.abs(set), most: Math.abs(set) };
    // The logging against it: counted, not put right (it is where the other surface and its own places put it)
    let report: SideReport | null = null;
    if (job.checks) {
        const f = evaluateField(fit.field, job.checks.positions);
        let wrong = 0;
        for (let i = 0; i < f.length; i++) if (-job.checks.side[i] * f[i] - job.checks.slack[i] > 0) wrong++;
        report = { checked: f.length, wrong, added: 0 };
    }
    // Much of the logging on the wrong side of it, and on its own far less: it is fitted on its own, and says so
    if (job.alone && report && fit.conform && report.wrong > CONFORM_WRONG * report.checked) {
        const alone = runFitJob(job.alone, memo);
        if (alone.ok && alone.stats.sides && 2 * alone.stats.sides.wrong < report.wrong) {
            return { ...alone, stats: { ...alone.stats, ms: performance.now() - t0, conform: { ...fit.conform, alone: { checked: report.checked, wrong: report.wrong } } } };
        }
    }
    const trend: Plane = job.refTrend ?? { normal: [0, 0, 1], point: [onSurface[0] ?? 0, onSurface[1] ?? 0, onSurface[2] ?? 0] };
    const mesh = meshSheet(
        { status: 'sheet', trend, field: fit.field, onSurface, stats: fit.stats, lineSigns: new Int8Array(0) },
        { box: job.box, reach, outline: outlineFrame(job.outline) }, job.cell,
    );
    return {
        ok: true, status: 'sheet',
        vertices: mesh.vertices, triangles: mesh.triangles,
        field: fit.field, trend, lineSigns: new Int8Array(0),
        stats: { ...fit.stats, ms: performance.now() - t0, truncated: mesh.truncated, sides: report, cell: job.cell, conform: fit.conform },
    };
}

/** A vein is carried this many times the widest gap between neighbouring holes from the nearest of them */
const VEIN_REACH = 1.5;

/** The middles of a vein's stretches down the holes (xyz triples), from the contacts its rule finds */
export function veinMiddles(found: ContactInputs): Float64Array {
    const s = veinPicks(found.list).stretches;
    const mids = new Float64Array(s.length / 2);
    for (let i = 0; i < s.length / 6; i++) for (let k = 0; k < 3; k++) mids[i * 3 + k] = (s[i * 6 + k] + s[i * 6 + 3 + k]) / 2;
    return mids;
}

/** A stretch is taken to be at least this share of its length down the hole thick, however flat the hole runs to the vein */
const ALONG_FLOOR = 0.2;

/**
 * The way across a vein that reads zones or is held to the lie of the
 * ground (the normal of the plane its stretches lie closest to), which the
 * thickness of a stretch is measured along; null for a vein that does
 * neither (its stretches are measured down the hole, as before), and where
 * the stretches give no plane.
 */
export function veinAcross(surface: SurfaceObject, found: ContactInputs): Vec3 | null {
    const vein = surface.rule.kind === 'body' ? surface.rule.vein : null;
    if (!vein || !(vein.join || vein.held)) return null;
    return found.joinPlane ?? planeOfMany(veinMiddles(found), 4);
}

/**
 * How far a vein is carried from the nearest of its stretches when no reach
 * is set for it: by the gaps between the holes that meet it, and never less
 * than five times as far as it is usually thick (one hole: a tenth of
 * `size`, the size of the data). Usually, not at its thickest: where
 * stretches close together are read as one zone, one zone tens of metres
 * across would carry a vein a metre thick for hundreds of metres past its
 * holes. `across`: the way across it, where stretches are to be measured
 * that way and not down the hole (`veinAcross`).
 */
export function veinAutoReach(stretches: ArrayLike<number>, size: number, across: Vec3 | null = null): number {
    const n = Math.floor(stretches.length / 6);
    const mids = new Float64Array(n * 3);
    const thick = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        for (let k = 0; k < 3; k++) mids[i * 3 + k] = (stretches[i * 6 + k] + stretches[i * 6 + 3 + k]) / 2;
        const d = [stretches[i * 6] - stretches[i * 6 + 3], stretches[i * 6 + 1] - stretches[i * 6 + 4], stretches[i * 6 + 2] - stretches[i * 6 + 5]];
        const length = Math.hypot(d[0], d[1], d[2]);
        // (Across the vein, where that is known: a hole that runs along it for 100 m has not found it 100 m thick)
        thick[i] = across ? Math.max(ALONG_FLOOR * length, Math.abs(d[0] * across[0] + d[1] * across[1] + d[2] * across[2])) : length;
    }
    // (The middle one; of two, the thicker)
    const usual = n > 0 ? thick.sort()[n >> 1] : 0;
    const gap = autoReach(mids);
    return Math.max(VEIN_REACH * gap, 5 * usual, gap > 0 ? 0 : size / 10);
}

/**
 * The job for a vein. Null when no hole goes into or out of it. `guides`:
 * how its reference surface lies at the middles of its stretches, for a
 * vein held to the lie of the ground (guides.ts, `veinGuides`).
 */
export function buildVeinJob(
    surface: SurfaceObject, dataBox: Box3 | null, quality: FitQuality, found: ContactInputs | null, ends: { field: FittedField; side: 1 | -1 } | null = null,
    guides: GuideSamples | null = null, stretch: Stretch | null = null,
): VeinJob | null {
    if (!found || surface.rule.kind !== 'body') return null;
    const picks = veinPicks(found.list);
    // A point with a dip or a direction says how the vein lies: it is on its reference surface. A plain point is on a wall
    const lying = (p: SurfaceObject['points'][number]) => !!(p.reading || p.direction);
    const placed = surface.points.filter(p => !lying(p)).flatMap(p => p.p);
    const stretches = Float64Array.from(picks.stretches);
    const walls = Float64Array.from([...picks.open, ...placed]);
    // Its lines are its reference surface's too: the vein runs along them
    const lines = sampleLines(surface.polylines);
    const onReference = Float64Array.from([...surface.points.filter(lying).flatMap(p => p.p), ...freeLineSamples(surface.polylines).positions]);
    const said = onReference.length > 0 || !!lines;
    const own = boundsOf(joined(joined(stretches, walls), lines ? joined(onReference, lines.positions) : onReference));
    if (!own || stretches.length === 0) return null;
    const base = dataBox ?? own;
    const size = Math.max(base.max[0] - base.min[0], base.max[1] - base.min[1], base.max[2] - base.min[2], 1);
    const pad = size * BOX_PAD;
    const box: Box3 = {
        min: [Math.min(base.min[0], own.min[0]) - pad, Math.min(base.min[1], own.min[1]) - pad, Math.min(base.min[2], own.min[2]) - pad],
        max: [Math.max(base.max[0], own.max[0]) + pad, Math.max(base.max[1], own.max[1]) + pad, Math.max(base.max[2], own.max[2]) + pad],
    };
    // How far it is carried: by the gaps between the holes that meet it (one hole: a tenth of the data)
    const reach = surface.params.reach ?? veinAutoReach(stretches, size, veinAcross(surface, found));
    const met = Math.max(own.max[0] - own.min[0], own.max[1] - own.min[1], own.max[2] - own.min[2]) + 2 * reach;
    const boxSpan = Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
    const span = Math.min(boxSpan, met);
    const fine = surface.params.resolution ?? span / CELLS.final;
    const cell = quality === 'final' ? fine : Math.max(fine, span / CELLS.draft);
    const { checks } = found;
    const logged = checks.side.length > 0 ? { positions: checks.positions, side: checks.side, hole: checks.hole } : null;
    // How it is taken to lie at the middles of its stretches (held to the lie of the ground), less those a dip put by hand reaches
    const lie = surface.rule.vein?.held && guides && guides.offsets.length > 0 ? { positions: guides.positions, normals: guides.normals, offsets: guides.offsets } : null;
    const given = said ? veinReference(surface, picks.stretches, onReference, lines, lie) : null;
    return {
        type: 'vein', blocksOf: surface.id, points: joined(stretches, walls), stretches, walls, oneEnded: picks.open.length / 3, logged,
        least: surface.rule.vein?.least ?? 0, endsOn: ends, reach, smoothing: smoothingFromFollow(surface.params.follow), box, cell,
        ...(given ? (given.lie ? { lie: given.lie } : {}) : lie ? { lie } : {}),
        // The long direction of the trend it follows (its own, else the model's): the line square to both of the trend's axes
        ...(stretch?.second ? { plunge: { line: crossOf(stretch.normal, stretch.second.normal), strength: stretch.second.factor } } : {}),
        ...(given ? { reference: given.reference } : {}),
        checks: checks.side.length > 0 ? checks : null,
        ...(quality === 'final' ? { refit: true } : {}),
        ...(surface.rule.vein?.thickness === 'net' && (surface.rule.vein.join ?? 0) > 0 ? { net: true } : {}),
    };
}

/**
 * What a vein's reference surface was given by hand, as its fit takes it:
 * `onReference` its points with a dip or a direction, then places along
 * its lines in space. Its dips and directions are carried to the middles
 * of the stretches within their reach (veinCarry.ts): those lie as was
 * said, where the holes have them, and `lie` comes back without them.
 */
function veinReference(surface: SurfaceObject, stretches: ArrayLike<number>, onReference: Float64Array, lines: LineSamples | null, lie: LieAt | null): { reference: NonNullable<VeinJob['reference']>; lie: LieAt | null } {
    const n = Math.floor(stretches.length / 6);
    const mids = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) mids[i * 3 + k] = (stretches[i * 6 + k] + stretches[i * 6 + 3 + k]) / 2;
    // Every place the reference surface passes through: how far a dip holds it depends on how near the next is
    const places = joined(mids, onReference);
    const through = lines ? joined(places, lines.positions) : places;
    const usual = usualReach(mids);
    const dips: HandDip[] = [], ways: HandLine[] = [];
    for (const { p, reading, direction } of [...surface.points, ...nodeReadings(surface.polylines)]) {
        if (reading) dips.push({ p, normal: normalFromDip(reading.dip, reading.dipDirection), overturned: !!reading.overturned, reach: reading.reach && reading.reach > 0 ? reading.reach : usual });
        else if (direction && cleanDirection(direction)) ways.push({ p, direction: cleanDirection(direction)!, reach: usual });
    }
    const carried = carryToMiddles(mids, dips, ways, lie);
    const own = surfaceReadings(surface, through, lines), ownWays = pointDirectionSamples(surface.points, through);
    return {
        reference: {
            points: onReference, readings: withCarried(own, carried.readings), lines,
            directed: carried.directed ? {
                positions: joined(ownWays?.positions ?? [], carried.directed.positions), directions: joined(ownWays?.directions ?? [], carried.directed.directions),
                offsets: joined(ownWays?.offsets ?? [], carried.directed.offsets),
            } : ownWays,
            ...(carried.count > 0 ? { carried: carried.count, usual } : {}),
        },
        lie: carried.lie,
    };
}

/** A surface's own dips with those carried to the middles of a vein's stretches after them (held as any dip measured at a place) */
function withCarried(own: ReadingSamples | null, carried: Carried['readings']): ReadingSamples | null {
    if (!carried) return own;
    const a = own ? own.offsets.length : 0, b = carried.offsets.length;
    const rims = own?.rims ? new Float64Array((a + b) * RIM_PLACES) : null;
    if (rims) rims.set(own!.rims!);
    const byValues = new Uint8Array(a + b);
    if (own) byValues.set(own.byValues);
    const overturned = new Uint8Array(a + b);
    if (own) overturned.set(own.overturned);
    overturned.set(carried.overturned, a);
    return {
        positions: joined(own?.positions ?? [], carried.positions), normals: joined(own?.normals ?? [], carried.normals), overturned,
        offsets: joined(own?.offsets ?? [], carried.offsets), byValues, rims,
    };
}

const crossOf = (a: ArrayLike<number>, b: ArrayLike<number>): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function runVeinJob(job: VeinJob, t0: number): BodyOutput {
    const fit = fitVein({
        stretches: job.stretches, walls: job.walls, oneEnded: job.oneEnded, logged: job.logged, least: job.least, endsOn: job.endsOn ?? null, reach: job.reach,
        checks: job.refit ? job.checks : null, net: job.net,
        box: job.box, smoothing: job.smoothing, lie: job.lie ?? null, plunge: job.plunge ?? null, reference: job.reference ?? null, blocks: blocksFor(job.blocksOf),
    });
    if (fit.status === 'empty') return { ok: false, reason: 'empty' };
    if (fit.status !== 'body' || !fit.field || !fit.stats) return { ok: false, reason: 'failed', why: fit.why };
    const meshed = performance.now();
    const mesh = meshVein(fit, job.box, job.cell, job.reach);
    const meshMs = performance.now() - meshed;
    // The logging against it, as it is once its walls were refitted to it (vein.ts)
    let report: SideReport | null = null;
    if (job.checks) {
        const f = evaluateField(fit.field, job.checks.positions);
        // (What is logged beyond the surface it ends on is no business of its)
        const end = job.endsOn ? evaluateField(job.endsOn.field, job.checks.positions) : null;
        let wrong = 0, checked = 0, strands = 0;
        for (let i = 0; i < f.length; i++) {
            if (end && !(job.endsOn!.side * end[i] > 0)) continue;
            checked++;
            if (!(-job.checks.side[i] * f[i] - job.checks.slack[i] > 0)) continue;
            // (At its net thickness what a zone holds of it outside its walls is left there: that is the choice made, not a misfit)
            if (job.net && job.checks.side[i] > 0) strands++; else wrong++;
        }
        report = { checked, wrong, added: (fit.vein?.refit?.inside ?? 0) + (fit.vein?.refit?.outside ?? 0), ...(strands > 0 ? { strands } : {}) };
    }
    return {
        ok: true, status: 'body',
        vertices: mesh.vertices, triangles: mesh.triangles,
        field: fit.field, trend: null, lineSigns: fit.lineSigns,
        stats: {
            ...fit.stats, ms: performance.now() - t0, meshMs, truncated: mesh.truncated, sides: report,
            body: { volume: closedVolume(mesh), pieces: meshPieces(mesh), cut: mesh.cut, cell: job.cell, thin: false, ...(mesh.ended ? { ended: true } : {}) },
            vein: fit.vein,
            ...(job.lie ? { guided: job.lie.offsets.length } : {}),
        },
    };
}

/**
 * Whether a surface may be held to a dip or a direction by slopes
 * (sheet.ts, `asSlopes`): it follows the structural data at places of its
 * own, or it is a sheet with a point that has a dip or a direction. (A tick
 * on a line never is.)
 */
function slopesMayHold(surface: SurfaceObject, guided: boolean): boolean {
    return guided || ((surface.rule.kind === 'sheet' || surface.rule.kind === 'contact') && surface.points.some(p => p.reading || p.direction));
}

/**
 * What a surface's mesh depends on, as a string: two surfaces (or the same
 * one at two times) with equal keys have the same mesh.
 */
export function fitKey(
    surface: SurfaceObject, dataBox: Box3 | null, found: { mark: string } | null = null, stretch: Stretch | null = null, guides: { mark: string } | null = null,
): string {
    return JSON.stringify([
        surface.rule,
        // (A point with no direction keeps the key it had before points could carry one)
        surface.points.map(p => (p.across || p.reading || p.direction ? [p.p, p.across ?? 0, p.reading ?? 0, ...(p.direction ? [{ direction: p.direction }] : [])] : p.p)),
        // (A line on a slice with no dip ticks keeps the key it had before lines could be in space or carry ticks, directions or curves)
        surface.polylines.map(l => [
            l.points, l.plane?.normal ?? 0, l.plane?.point ?? 0, l.flipped,
            ...(l.nodes?.some(n => n?.reading) ? [l.nodes.map(n => n?.reading ?? 0)] : []),
            ...(!l.plane && l.across ? [{ across: l.across }] : []),
            ...(l.nodes?.some(n => n?.direction) ? [{ directions: l.nodes.map(n => n?.direction ?? 0) }] : []),
            ...(l.smooth ? [{ smooth: true }] : []),
        ]),
        surface.along, surface.refDirection, surface.params,
        dataBox ? [dataBox.min, dataBox.max] : null,
        found ? found.mark : null,
        stretch ? [stretch.normal, stretch.point, stretch.factor, stretch.second ?? 0] : null,
        // (Only when there are some: a surface with none keeps the key it had before there were guides)
        ...(guides ? [guides.mark] : []),
        // (... and one whose overall plane is held, the key it has with that plane)
        ...(surface.trendHeld ? [{ held: surface.trendHeld }] : []),
        // (... and one with a set that counts for less than in full)
        ...(surface.weights ? [{ weights: surface.weights }] : []),
        // (... and one that may be held to a dip or a direction by slopes: it is not fitted as it was before there were any (fit engine 2))
        ...(slopesMayHold(surface, guides !== null) ? [{ slopes: 1 }] : []),
        // (... and a vein whose thickness is carried further down a plunge than across it: it was not, before Phase 247)
        ...(surface.rule.kind === 'body' && surface.rule.vein && stretch?.second ? [{ plunge: 1 }] : []),
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

/** Fits blocks somewhere else (other workers) and hands back what each came to, in any order */
export type BlockFitter = (tasks: BlockTask[]) => Promise<BlockAnswer[]>;

/** Blocks wanted at once before they are handed out: fewer are fitted here, sooner than they could be sent */
export const SHARE_LEAST = 8;
/**
 * Runs of a job before the blocks it still wants are fitted here (each run may want blocks the last could not know
 * of: every round that puts logged intervals on their own side wants some, and there are up to twelve of those)
 */
const SHARE_RUNS = 16;

/**
 * runFitJob, with the blocks of its fits fitted by `fitter` (other workers,
 * at the same time) when enough of them are wanted at once. The job is run;
 * where a fit wants blocks it has not got, it stops; they are fitted and put
 * in the surface's store, and the job is run again. The answer is the one
 * runFitJob gives, to the last digit: the blocks are fitted the same way
 * wherever they are fitted. Run again, the rounds that put intervals on their
 * own side take up where they stopped (`SidesMemo`); the blocks of the rounds
 * already done count as used all the same, and are kept for the next job.
 * `tell`: told, each time blocks come back, how many have been fitted for
 * it so far and how many fits the rounds have made.
 */
export async function runFitJobShared(job: FitJob, fitter: BlockFitter, least = SHARE_LEAST, tell?: (blocks: number, fits: number) => void): Promise<FitOutput> {
    const store = blocksFor(job.blocksOf);
    if (!store) return runFitJob(job);
    const wanted = { least, asked: new Set<string>(), used: new Set<string>() };
    const memo: SidesMemo = { fits: [], at: [] };
    const t0 = performance.now();
    let shared = 0;
    try {
        for (let run = 0; ; run++) {
            store.wanted = run < SHARE_RUNS ? wanted : { ...wanted, least: Infinity };
            try {
                const out = runFitJob(job, memo);
                // What none of its fits used goes
                for (const key of [...store.fits.keys()]) if (!wanted.used.has(key)) store.fits.delete(key);
                if (out.ok && shared > 0) {
                    out.stats.shared = shared;
                    out.stats.refitted = (out.stats.refitted ?? 0) + shared;
                    // (The time it took is all of it, not the last run's)
                    out.stats.ms = performance.now() - t0;
                }
                return out;
            } catch (e) {
                if (!(e instanceof BlocksWanted)) throw e;
                store.wanted = null;
                // (What the run used so far stays used: the rounds done are not gone through again)
                for (const answer of await fitter(e.tasks)) {
                    if (!answer) continue;
                    store.fits.set(answer.key, { field: answer.field, smoothed: answer.smoothed });
                    shared++;
                }
                tell?.(shared, memo.fits.length);
            }
        }
    } finally {
        store.wanted = null;
    }
}

export function runFitJob(job: SheetJob, memo?: SidesMemo | null): SheetOutput;
export function runFitJob(job: FitJob, memo?: SidesMemo | null): FitOutput;
export function runFitJob(job: FitJob, memo: SidesMemo | null = null): FitOutput {
    const t0 = performance.now();
    if (job.type === 'body') return runBodyJob(job, t0, memo);
    if (job.type === 'vein') return runVeinJob(job, t0);
    if (job.type === 'conform') return runConformJob(job, t0, memo);
    if (job.type === 'shell') return runShellJob(job, t0);
    const { fit, report } = fitWithSides(
        {
            points: job.points, pointAcross: job.pointAcross, oriented: job.lines ?? undefined, readings: job.readings, directed: job.directed ?? null, guides: job.guides,
            along: job.along, refDirection: job.refDirection, holdTo: job.holdTo, smoothing: job.smoothing,
            loose: job.loose ?? null, looseLines: job.looseLines ?? null,
            cover: job.box, blocks: blocksFor(job.blocksOf),
        },
        job.checks, memo,
    );
    if (fit.status === 'empty') return { ok: false, reason: 'empty' };
    if (fit.status === 'failed' || !fit.field || !fit.trend || !fit.stats) return { ok: false, reason: 'failed', why: fit.why };
    // Drawn again only where the field has changed since this surface's last mesh on this grid
    const kept = job.blocksOf ? `${job.blocksOf}|${job.cell}` : null;
    const mesh = meshSheet(
        fit, { box: job.box, reach: job.reach, outline: outlineFrame(job.outline) }, job.cell,
        kept ? meshMemories.get(kept) ?? null : null, kept ? m => rememberMesh(kept, m) : undefined,
    );
    return {
        ok: true, status: fit.status === 'line' ? 'line' : 'sheet',
        vertices: mesh.vertices, triangles: mesh.triangles,
        field: fit.field, trend: fit.trend, lineSigns: fit.lineSigns,
        stats: {
            ...fit.stats, ms: performance.now() - t0, truncated: mesh.truncated, sides: report, cell: job.cell,
            ...(job.guides ? { guided: job.guides.offsets.length } : {}), ...(fit.turned === undefined ? {} : { turned: fit.turned }),
            ...(kept ? { nodes: { evaluated: mesh.evaluations ?? 0, reused: mesh.reused ?? 0 } } : {}),
        },
    };
}
