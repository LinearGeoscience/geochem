/**
 * Veins, dykes and shear zones: a thin body built from its two walls (pure).
 *
 * A body fitted as a volume (body.ts) is the same in every direction; one
 * much thinner than the holes are apart comes out as beads round them. A
 * vein is built the other way about:
 *  - a mid-surface is fitted through the middle of every stretch of the vein
 *    down a hole (an ordinary sheet);
 *  - at each stretch, how far the two walls are from the mid-surface (in the
 *    mid-surface's own field, which is about metres) is a height above it
 *    and a depth below it. The two are carried from hole to hole by smooth
 *    fits of their own;
 *  - where a hole goes through the mid-surface in ground logged as something
 *    else, the heights are below zero: the vein has pinched out before it;
 *  - beyond the reach of the outermost holes the heights fall below zero
 *    too, so the vein ends rather than running to the edge of the data.
 * The vein is where both heights are above the place's own height off the
 * mid-surface. The walls cannot cross, and between holes the vein is as
 * thick as the holes say, with no beading.
 *
 * Its field (`FittedField.walls`, read by `evaluateField`) is positive
 * inside, like any body's. Its mesh is the mid-surface's mesh pushed out by
 * the two heights and closed round its edge, so a vein far thinner than a
 * mesh cell is still one closed piece. The mesh is to be the field: each
 * height is read where its wall is (a pick is on its wall, which down a
 * hole at a low angle is metres along the vein from the middle of its
 * stretch), and the mesh is fine round every place a height is known at
 * (`meshVein`). Before that a third of the dyke a real set of veins held at
 * its samples was outside their meshes.
 */
import { RIM_PLACES } from './plane';
import type { FoundContact } from './contacts';
import { clipMeshByScalar } from './meshOps';
import { fitBlended, type BlockCache } from './pou';
import { unit } from './plane';
import { evaluateField, fieldLengths, stretchedBox, stretchPoints, type FittedField, type Stretch } from './rbf';
import { coverOf, fitSheet, meshSheet, type DirectedPoints, type OrientedPoints, type ReadingPoints, type SheetFit } from './sheet';
import type { Box3, TriMesh, Vec3 } from './types';

export interface VeinInput {
    /** One per stretch of the vein down a hole: where the hole goes in, then where it comes out (six numbers each) */
    stretches: ArrayLike<number>;
    /** Places put on one of its walls by hand, xyz triples: each is on the wall of the side of the mid-surface it is on */
    walls?: ArrayLike<number> | null;
    /** Of `walls`, the first this many are from the logging: a stretch with one end only (the hole starts or stops in the vein) */
    oneEnded?: number;
    /** The logged intervals, in order down each hole: their middles, their side (1: the vein) and their hole */
    logged?: { positions: ArrayLike<number>; side: ArrayLike<number>; hole: ArrayLike<number> } | null;
    /**
     * The logged intervals its walls are checked against, and refitted to
     * (as a body's are, contacts.ts): where each is, the side it is on (1:
     * the vein), half its length, and its hole. An interval of the vein
     * left outside a wall, or of other ground left inside one, puts a
     * place on that wall, the worst of each hole first. Null or absent:
     * its walls are as its stretches alone make them.
     */
    checks?: { positions: ArrayLike<number>; side: ArrayLike<number>; slack: ArrayLike<number>; hole: ArrayLike<number> } | null;
    /** Its zones are taken at their net thickness: what they hold of the vein outside its walls is left there */
    net?: boolean;
    /** The least it is thick wherever it is there, m (0: it may taper to nothing) */
    least: number;
    /** It ends on another surface: it is only on this side of that one's field (null: it ends on nothing) */
    endsOn?: { field: FittedField; side: 1 | -1 } | null;
    /** How far from the nearest stretch it counts as known, m: it ends between half of this and all of it beyond the outermost */
    reach: number;
    box: Box3;
    /** For the mid-surface: 0 = through every middle; larger = looser */
    smoothing?: number;
    /**
     * How the mid-surface lies at places on it (the middles of stretches):
     * the unit normal of the plane at each, either way up, and how far
     * either side of it the surface is held to that plane (as a dip
     * measured there would hold it). Null or absent: it lies as its
     * middles alone make it.
     */
    lie?: { positions: ArrayLike<number>; normals: ArrayLike<number>; offsets: ArrayLike<number> } | null;
    /**
     * The long direction of the ground (a plunge), and how many times
     * further things carry down it than across it (over 1): how thick the
     * vein is, is carried that much further down the plunge, as it lies in
     * the vein's own plane, than across it. Absent: the same every way.
     */
    plunge?: { line: ArrayLike<number>; strength: number } | null;
    /**
     * What is said of its reference surface by hand, beyond the middles of
     * its stretches: more places it passes through (a place given a dip or
     * a direction, and places along lines in space); how it lies at some
     * of them (dips); a line it runs along at some (directions); and lines
     * drawn on slices. As a sheet takes them (sheet.ts). The vein counts
     * as known near these places too. Null or absent: nothing.
     */
    reference?: {
        points: ArrayLike<number>;
        readings?: ReadingPoints | null;
        directed?: DirectedPoints | null;
        lines?: OrientedPoints | null;
        /**
         * How many stretches lie as a dip or a direction put by hand says
         * (veinCarry.ts: those are among `readings` and `directed`, at
         * their middles), and the reach of what was given none, m. Only
         * said back in the summary.
         */
        carried?: number;
        usual?: number;
    } | null;
    blocks?: BlockCache | null;
}

export interface VeinSummary {
    /** Stretches of the vein it is built from, and holes that go through it without meeting it */
    stretches: number;
    misses: number;
    /** Stretches with both ends on one side of its reference surface: the wall on the other side is not met there, and is carried from round about */
    along?: number;
    /** Places put on its walls from the logging: intervals of it that were outside a wall, and of other ground that were inside one */
    refit?: { inside: number; outside: number };
    /** Places where a hole goes through these units beyond the surface it ends on: left out of the counts above and the thicknesses */
    beyond?: number;
    /** Places on its walls put there by hand, and ones where a hole starts or stops inside it */
    byHand: number;
    /** Places and drawn lines its reference surface was given by hand (absent: none) */
    onReference?: number;
    /** Stretches that lie as a dip or a direction put by hand says (absent: none), and the reach of what was given none of its own, m */
    carried?: number;
    usualReach?: number;
    oneEnded: number;
    /** How thick it is, square to itself, where the holes meet it: the least, the usual and the most, m */
    thinnest: number;
    usual: number;
    thickest: number;
}

export interface VeinFit extends SheetFit {
    /** Its mid-surface (null: there is no vein) */
    mid: SheetFit | null;
    vein: VeinSummary | null;
    /**
     * Every place a wall's height is known at (xyz triples): the picks, where a hole passes through with none of it,
     * places put by hand, and those the logging put on a wall. Its mesh has small triangles there: that is where its
     * thickness changes within a metre or two.
     */
    wallPlaces?: Float64Array;
}

/** At most this many misses are fitted to (a spread of them, beyond it) */
const MAX_MISSES = 1500;
/** For a vein whose heights are lengths: the step its mid-surface's slope is found over, m */
const METRIC_STEP = 0.25;

/** Both ends of a stretch are on one side of the reference surface when each is this far to that side of it (in the heights' own units) */
const ONE_SIDE = 0.05;

/** The walls are refitted to the logging at most this many times over, and with at most this many places a time (the worst of each hole) */
const REFIT_PASSES = 2, MAX_REFIT = 600;

/** A stretch counts as on a hole between two of its logged intervals when its middle is this near the line between them, m */
const ON_HOLE = 0.5;

/** A pick's height is left out when a place put on the same wall by hand is within this share of the reach of it */
const OVERRIDE = 1 / 3;

/**
 * A vein's stretches down the holes, from the contacts its rule finds (hole
 * by hole, and down each): where a hole goes in and where it next comes out.
 * A contact left out by hand is not used; one moved is used where it was
 * moved to. `open`: the contacts with no partner (the hole starts or stops
 * inside the vein, or the other end was left out): each is still on a wall.
 */
export function veinPicks(list: readonly FoundContact[]): { stretches: number[]; open: number[] } {
    const stretches: number[] = [], open: number[] = [];
    let entered: FoundContact | null = null;
    for (const c of list) {
        if (c.state === 'ignored' || c.state === 'uncrossed') continue;
        if (entered && entered.hole !== c.hole) { open.push(...entered.p); entered = null; }
        if (c.above === -1) {
            if (entered) open.push(...entered.p);
            entered = c;
        } else if (entered) {
            stretches.push(...entered.p, ...c.p);
            entered = null;
        } else open.push(...c.p);
    }
    if (entered) open.push(...entered.p);
    return { stretches, open };
}

const NONE: VeinFit = { status: 'empty', trend: null, field: null, onSurface: new Float64Array(0), stats: null, lineSigns: new Int8Array(0), mid: null, vein: null };

function median(values: number[]): number {
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length === 0 ? 0 : sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** A field that is one value everywhere */
const level = (value: number): FittedField => ({ centres: new Float64Array(0), weights: new Float64Array(0), lin: [0, 0, 0], c0: value, origin: [0, 0, 0], scale: 1 });

/**
 * A height carried from place to place: through each value, settling to
 * their level away from them. `along`: carried in space stretched so
 * (further down a plunge than across it).
 */
function heights(points: number[], values: number[], box: Box3, along: Stretch | null = null): FittedField {
    if (values.length === 0) return level(0);
    if (values.length < 2) return level(values[0]);
    if (!along) {
        const fit = fitBlended(points, values, { drift: 'level', smoothing: 0, cover: coverOf(points, box) });
        return fit.ok ? fit.field : level(median(values));
    }
    const fit = fitBlended(stretchPoints(points, along), values, { drift: 'level', smoothing: 0, cover: stretchedBox(coverOf(points, box), along) });
    return fit.ok ? { ...fit.field, stretch: along } : level(median(values));
}

/** Space stretched across a plunge as it lies in a plane: null when the plunge is square to the plane, or counts no further than across it */
export function plungeIn(normal: ArrayLike<number>, point: ArrayLike<number>, plunge: { line: ArrayLike<number>; strength: number } | null | undefined): Stretch | null {
    if (!plunge || !(plunge.strength > 1)) return null;
    const l = plunge.line, off = l[0] * normal[0] + l[1] * normal[1] + l[2] * normal[2];
    const laid = unit([l[0] - off * normal[0], l[1] - off * normal[1], l[2] - off * normal[2]]);
    // (A plunge over 60 degrees off the plane says little of what runs in it)
    if (!laid || Math.abs(off) > Math.hypot(l[0], l[1], l[2]) * 0.87) return null;
    const across = unit([normal[1] * laid[2] - normal[2] * laid[1], normal[2] * laid[0] - normal[0] * laid[2], normal[0] * laid[1] - normal[1] * laid[0]]);
    return across ? { normal: across, point: [point[0], point[1], point[2]] as Vec3, factor: plunge.strength } : null;
}

/**
 * The two heights of a vein at places, given its field's `walls` and what
 * they read there: where it is there but thinner than its least thickness,
 * both are raised by the same amount to make it up.
 */
export function wallHeights(up: number, down: number, least: number): [number, number] {
    const t = up + down;
    if (!(t > 0) || t >= least) return [up, down];
    const more = (least - t) / 2;
    return [up + more, down + more];
}

/** Two lots of dips as one (either may be none) */
function joinReadings(a: ReadingPoints | null, b: ReadingPoints | null): ReadingPoints {
    const na = a ? a.offsets.length : 0, nb = b ? b.offsets.length : 0;
    const out = { positions: new Float64Array((na + nb) * 3), normals: new Float64Array((na + nb) * 3), overturned: new Uint8Array(na + nb), offsets: new Float64Array(na + nb), byValues: new Uint8Array(na + nb) };
    const rims = a?.rims || b?.rims ? new Float64Array((na + nb) * RIM_PLACES) : null;
    [a, b].forEach((r, which) => {
        const n = which === 0 ? na : nb, first = which === 0 ? 0 : na;
        for (let i = 0; i < n; i++) {
            for (let k = 0; k < 3; k++) {
                out.positions[(first + i) * 3 + k] = r!.positions[i * 3 + k];
                out.normals[(first + i) * 3 + k] = r!.normals[i * 3 + k];
            }
            out.overturned[first + i] = r!.overturned?.[i] ? 1 : 0;
            out.offsets[first + i] = r!.offsets[i];
            out.byValues[first + i] = r!.byValues?.[i] ? 1 : 0;
            if (rims && r!.rims) for (let k = 0; k < RIM_PLACES; k++) rims[(first + i) * RIM_PLACES + k] = r!.rims[i * RIM_PLACES + k];
        }
    });
    return rims ? { ...out, rims } : out;
}

export function fitVein(input: VeinInput): VeinFit {
    const n = Math.floor(input.stretches.length / 6);
    if (n < 1 || !(input.reach > 0)) return NONE;
    const s = input.stretches;
    const mids = new Float64Array(n * 3), ends = new Float64Array(n * 6);
    for (let i = 0; i < n; i++) {
        for (let k = 0; k < 6; k++) ends[i * 6 + k] = s[i * 6 + k];
        for (let k = 0; k < 3; k++) mids[i * 3 + k] = (s[i * 6 + k] + s[i * 6 + 3 + k]) / 2;
    }
    const lie = input.lie && input.lie.offsets.length > 0 ? { readings: input.lie } : {};
    // What its reference surface was given by hand: more places, dips, directions and drawn lines
    const ref = input.reference ?? null;
    const nRef = ref ? Math.floor(ref.points.length / 3) : 0;
    const refLines = ref?.lines ? Math.min(Math.floor(ref.lines.positions.length / 3), ref.lines.offsets.length) : 0;
    const said = nRef + refLines > 0;
    const shaped = said && ((ref!.readings?.offsets.length ?? 0) > 0 || (ref!.directed?.offsets.length ?? 0) > 0 || refLines > 0);
    const through = new Float64Array(mids.length + nRef * 3);
    through.set(mids);
    for (let i = 0; i < nRef * 3; i++) through[mids.length + i] = ref!.points[i];
    const mid = said
        ? fitSheet({
            points: through, cover: input.box, smoothing: input.smoothing ?? 0, blocks: input.blocks ?? null,
            ...(('readings' in lie) || (ref!.readings?.offsets.length ?? 0) > 0 ? { readings: joinReadings(input.lie && input.lie.offsets.length > 0 ? input.lie : null, ref!.readings ?? null) } : {}),
            ...(ref!.directed ? { directed: ref!.directed } : {}),
            ...(refLines > 0 ? { oriented: ref!.lines! } : {}),
        })
        : fitSheet({ points: mids, ...lie, cover: input.box, smoothing: input.smoothing ?? 0, blocks: input.blocks ?? null });
    const field = mid.field;
    if ((mid.status !== 'sheet' && mid.status !== 'line') || !field || !mid.stats) return { ...NONE, status: mid.status === 'failed' ? 'failed' : 'empty', why: mid.why };

    // The walls at each stretch, as heights off the mid-surface: in its field's units, or (held to the lie of the ground) as lengths
    const metric = 'readings' in lie || shaped ? METRIC_STEP : 0;
    const read = (places: ArrayLike<number>) => (metric ? fieldLengths(field, places, metric) : evaluateField(field, places));
    const at = read(ends);
    const upAt: number[] = [], upValue: number[] = [], downAt: number[] = [], downValue: number[] = [];
    const hand = input.walls ?? [];
    const nHand = Math.floor(hand.length / 3);
    const handAt = nHand > 0 ? read(hand) : new Float64Array(0);
    // (Only a place put by hand: where a hole starts or stops in the vein is one more thing known of that wall, beside the picks)
    const fromLogging = Math.min(nHand, input.oneEnded ?? 0);
    const overridden = (wall: 1 | -1, x: number, y: number, z: number) => {
        const near = (OVERRIDE * input.reach) ** 2;
        for (let j = fromLogging; j < nHand; j++) {
            if ((handAt[j] > 0 ? 1 : -1) !== wall) continue;
            if ((hand[j * 3] - x) ** 2 + (hand[j * 3 + 1] - y) ** 2 + (hand[j * 3 + 2] - z) ** 2 < near) return true;
        }
        return false;
    };
    const thick: number[] = [];
    // A stretch with both ends on one side of the reference surface (a hole that runs along the vein, where the surface
    // through the middles round about passes beside one end of it): the vein is between its two ends all the same, so
    // the wall nearer the surface is on the far side of it there, at a height below nought
    let alongHoles = 0;
    for (let i = 0; i < n; i++) {
        const a = at[i * 2], b = at[i * 2 + 1];
        const oneSided = (a > ONE_SIDE && b > ONE_SIDE) || (a < -ONE_SIDE && b < -ONE_SIDE);
        if (oneSided) alongHoles++;
        const up = oneSided ? Math.max(a, b) : Math.max(a, b, 0), down = oneSided ? -Math.min(a, b) : Math.max(-Math.min(a, b), 0);
        thick.push(up + down);
        const x = mids[i * 3], y = mids[i * 3 + 1], z = mids[i * 3 + 2];
        // Each height is known at its own wall, so the wall goes through the pick itself
        const high = a >= b ? i * 6 : i * 6 + 3, low = a >= b ? i * 6 + 3 : i * 6;
        if (!overridden(1, x, y, z)) { upAt.push(ends[high], ends[high + 1], ends[high + 2]); upValue.push(up); }
        if (!overridden(-1, x, y, z)) { downAt.push(ends[low], ends[low + 1], ends[low + 2]); downValue.push(down); }
    }
    for (let j = 0; j < nHand; j++) {
        const p = [hand[j * 3], hand[j * 3 + 1], hand[j * 3 + 2]];
        if (handAt[j] > 0) { upAt.push(...p); upValue.push(handAt[j]); } else { downAt.push(...p); downValue.push(-handAt[j]); }
    }
    const usual = median(thick);
    // Where it is not: half its usual thickness below nothing, so that it closes about half-way to there
    const gone = -(usual > 0 ? usual / 2 : Math.max(input.least / 2, 0.5));

    // Holes that go through the mid-surface in other ground
    const misses: number[] = [];
    const logged = input.logged;
    if (logged) {
        const m = Math.min(Math.floor(logged.positions.length / 3), logged.side.length, logged.hole.length);
        const f = evaluateField(field, logged.positions);
        for (let i = 0; i + 1 < m; i++) {
            if (logged.hole[i] !== logged.hole[i + 1] || logged.side[i] > 0 || logged.side[i + 1] > 0 || (f[i] > 0) === (f[i + 1] > 0)) continue;
            const w = f[i] / (f[i] - f[i + 1]);
            const q = [0, 1, 2].map(k => logged.positions[i * 3 + k] + w * (logged.positions[(i + 1) * 3 + k] - logged.positions[i * 3 + k]));
            // (Not one that is inside a stretch of the vein: the intervals between may have been thinned out. Nor one where
            // a stretch lies on the hole between the two intervals: that is the vein's own place there, wherever a straight
            // line between two intervals far apart puts the crossing. A zone taken at its net thickness is far thinner than
            // the logging left out round it.)
            const a = [logged.positions[i * 3], logged.positions[i * 3 + 1], logged.positions[i * 3 + 2]];
            const ab = [logged.positions[(i + 1) * 3] - a[0], logged.positions[(i + 1) * 3 + 1] - a[1], logged.positions[(i + 1) * 3 + 2] - a[2]];
            const along = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
            let inside = false;
            for (let j = 0; j < n && !inside; j++) {
                const mx = mids[j * 3], my = mids[j * 3 + 1], mz = mids[j * 3 + 2];
                inside = Math.hypot(q[0] - mx, q[1] - my, q[2] - mz) <= Math.hypot(ends[j * 6] - ends[j * 6 + 3], ends[j * 6 + 1] - ends[j * 6 + 4], ends[j * 6 + 2] - ends[j * 6 + 5]) / 2;
                if (inside || !(along > 0)) continue;
                const t = ((mx - a[0]) * ab[0] + (my - a[1]) * ab[1] + (mz - a[2]) * ab[2]) / along;
                inside = t >= 0 && t <= 1 && Math.hypot(a[0] + t * ab[0] - mx, a[1] + t * ab[1] - my, a[2] + t * ab[2] - mz) <= ON_HOLE;
            }
            if (inside) continue;
            for (let k = 0; k < 3; k++) misses.push(logged.positions[i * 3 + k] + w * (logged.positions[(i + 1) * 3 + k] - logged.positions[i * 3 + k]));
        }
    }
    // What is beyond the surface it ends on is not part of it: not counted, and not held against it
    const end = input.endsOn ?? null;
    const keptOf = (places: ArrayLike<number>): boolean[] => {
        const k = Math.floor(places.length / 3);
        if (!end || k === 0) return new Array<boolean>(k).fill(true);
        return Array.from(evaluateField(end.field, places), v => end.side * v > 0);
    };
    const kept = keptOf(mids);
    const missesKept = keptOf(misses).filter(Boolean).length;
    const every = Math.max(1, Math.ceil(misses.length / 3 / MAX_MISSES));
    for (let i = 0; i < misses.length / 3; i += every) {
        const p = [misses[i * 3], misses[i * 3 + 1], misses[i * 3 + 2]];
        upAt.push(...p); upValue.push(gone);
        downAt.push(...p); downValue.push(gone);
    }

    // Known near the stretches and the places put by hand; beyond their reach, not there
    // (... and the places and drawn lines its reference surface was given: it is carried along a line drawn for it)
    const known = new Float64Array(mids.length + (nHand + nRef + refLines) * 3);
    known.set(mids);
    for (let i = 0; i < nHand * 3; i++) known[mids.length + i] = hand[i];
    for (let i = 0; i < nRef * 3; i++) known[mids.length + nHand * 3 + i] = ref!.points[i];
    for (let i = 0; i < refLines * 3; i++) known[mids.length + (nHand + nRef) * 3 + i] = ref!.lines!.positions[i];
    // How thick it is carries further down the plunge than across it (as the plunge lies in the vein's own plane);
    // how far it is known is the same every way, in the ground as it is
    const along = mid.trend ? plungeIn(mid.trend.normal, mid.trend.point, input.plunge) : null;
    const cap = { positions: known, reach: new Float64Array(known.length / 3).fill(input.reach), background: gone, ...(along ? { ground: true } : {}) };
    const walled = () => {
        const up: FittedField = { ...heights(upAt, upValue, input.box, along), cap };
        const down: FittedField = { ...heights(downAt, downValue, input.box, along), cap };
        return { up, down, vein: { ...field, walls: { up, down, least: Math.max(0, input.least), ...(metric ? { metric } : {}), ...(input.endsOn ? { ends: input.endsOn } : {}) } } as FittedField };
    };
    let built = walled();
    // The logging against its walls. An interval of the vein left outside a wall (a hole that stops in the vein has only
    // met one), or of other ground left inside one (a hole that passes beside where it is carried to): that wall is put
    // through the middle of the interval. The worst of each hole and wall at a time, then the walls again.
    const refit = { inside: 0, outside: 0 };
    const checks = input.checks ?? null;
    if (checks && checks.side.length > 0) {
        const count = Math.min(Math.floor(checks.positions.length / 3), checks.side.length, checks.slack.length, checks.hole.length);
        const height = read(checks.positions);
        const here = keptOf(checks.positions);
        for (let pass = 0; pass < REFIT_PASSES; pass++) {
            const a = evaluateField(built.up, checks.positions), b = evaluateField(built.down, checks.positions);
            const worst = new Map<string, { i: number; by: number; wall: 1 | -1 }>();
            const take = (i: number, wall: 1 | -1, by: number) => {
                const key = `${checks.hole[i]}:${wall}:${checks.side[i] > 0 ? 1 : 0}`;
                const was = worst.get(key);
                if (!was || by > was.by) worst.set(key, { i, by, wall });
            };
            for (let i = 0; i < count; i++) {
                const side = checks.side[i], slack = checks.slack[i], h = height[i];
                // (Not a hole it must not cross, and nothing beyond the surface it ends on; at its net thickness the strands outside it stay there)
                if (!here[i] || !(slack >= 0) || (side > 0 && input.net) || !Number.isFinite(h)) continue;
                // How far inside each wall the place is
                const above = a[i] - h, below = h + b[i];
                if (side > 0) {
                    if (-above > slack) take(i, 1, -above);
                    if (-below > slack) take(i, -1, -below);
                } else if (Math.min(above, below) > slack) take(i, above <= below ? 1 : -1, Math.min(above, below));
            }
            if (worst.size === 0) break;
            const list = [...worst.values()].sort((p, q) => q.by - p.by).slice(0, MAX_REFIT);
            for (const { i, wall } of list) {
                const p = [checks.positions[i * 3], checks.positions[i * 3 + 1], checks.positions[i * 3 + 2]];
                if (wall > 0) { upAt.push(...p); upValue.push(height[i]); } else { downAt.push(...p); downValue.push(-height[i]); }
                if (checks.side[i] > 0) refit.outside++; else refit.inside++;
            }
            built = walled();
        }
    }
    const vein = built.vein;

    const onSurface = new Float64Array(ends.length + nHand * 3);
    onSurface.set(ends);
    for (let i = 0; i < nHand * 3; i++) onSurface[ends.length + i] = hand[i];
    // How well the walls are honoured: the picks that were used
    let worstMiss = 0;
    const back = evaluateField(vein, ends);
    for (let i = 0; i < n; i++) {
        if (!kept[i]) continue;
        const x = mids[i * 3], y = mids[i * 3 + 1], z = mids[i * 3 + 2];
        const a = at[i * 2], first: 1 | -1 = a > at[i * 2 + 1] ? 1 : -1;
        if (!overridden(first, x, y, z) && thick[i] >= input.least) worstMiss = Math.max(worstMiss, Math.abs(back[i * 2]));
        if (!overridden(-first as 1 | -1, x, y, z) && thick[i] >= input.least) worstMiss = Math.max(worstMiss, Math.abs(back[i * 2 + 1]));
    }
    const here = thick.filter((_, i) => kept[i]);
    const beyond = n - here.length;
    const sorted = (here.length > 0 ? here : thick).slice().sort((p, q) => p - q);
    return {
        status: 'body', trend: null, field: vein, onSurface, lineSigns: mid.lineSigns,
        stats: { ...mid.stats, worstMiss },
        mid, wallPlaces: Float64Array.from([...upAt, ...downAt]),
        vein: { stretches: n - beyond, misses: missesKept, ...(alongHoles > 0 ? { along: alongHoles } : {}), ...(refit.inside + refit.outside > 0 ? { refit } : {}), ...(beyond > 0 ? { beyond } : {}), byHand: nHand - Math.min(nHand, input.oneEnded ?? 0), ...(said ? { onReference: nRef + (ref!.lines?.flipped?.length ?? (refLines > 0 ? 1 : 0)) } : {}), ...(ref?.carried ? { carried: ref.carried, ...(ref.usual ? { usualReach: ref.usual } : {}) } : {}), oneEnded: Math.min(nHand, input.oneEnded ?? 0), thinnest: sorted[0], usual: here.length > 0 ? median(here) : usual, thickest: sorted[sorted.length - 1] },
    };
}

export interface VeinMesh extends TriMesh {
    cells: number;
    truncated: boolean;
    /** It reaches the edge of the box and was closed off there */
    cut: boolean;
    /** It meets the surface it ends on, and stops there */
    ended: boolean;
}

/** How thick a vein is at a place is read at its walls there, found in this many steps from the place itself */
const WALL_STEPS = 3;

/**
 * Heights in the reference surface's own units are made lengths by how fast its field rises. Where it hardly
 * rises (a surface through the middles of stretches that are not one sheet folds back on itself, and its field
 * goes flat there) it is taken to rise this fast at the least, so that a wall is never further out than four
 * times its height. (Without it a real intrusion built as one vein had corners thrown out of the country: a
 * volume of 10^15 m3.)
 */
export const LEAST_RISE = 0.25;

/**
 * How thick a vein is at places, m: how far apart its walls are there,
 * measured square to its reference surface (through the place, so a sample
 * beside the vein has the thickness of the vein beside it). NaN where it
 * is not there (beyond its reach, pinched out, or past the surface it ends
 * on).
 */
export function veinThickness(vein: FittedField, points: ArrayLike<number>): Float64Array {
    const n = Math.floor(points.length / 3);
    const out = new Float64Array(n).fill(NaN);
    const walls = vein.walls;
    if (!walls || n === 0) return out;
    const up = evaluateField(walls.up, points), down = evaluateField(walls.down, points);
    const end = walls.ends ? evaluateField(walls.ends.field, points) : null;
    const there: number[] = [];
    for (let i = 0; i < n; i++) if (up[i] + down[i] > 0 && (!end || walls.ends!.side * end[i] > 0)) there.push(i);
    const m = there.length;
    if (m === 0) return out;
    // The reference surface's field at each place, and how fast it rises there and which way
    const probe = new Float64Array(m * 21);
    there.forEach((i, k) => {
        for (let j = 0; j < 7; j++) {
            for (let c = 0; c < 3; c++) probe[k * 21 + j * 3 + c] = points[i * 3 + c];
            if (j > 0) probe[k * 21 + j * 3 + ((j - 1) >> 1)] += j & 1 ? METRIC_STEP : -METRIC_STEP;
        }
    });
    const f = evaluateField({ ...vein, walls: null }, probe);
    const rise = new Float64Array(m), normal = new Float64Array(m * 3), height = new Float64Array(m);
    for (let k = 0; k < m; k++) {
        const g = [f[k * 7 + 1] - f[k * 7 + 2], f[k * 7 + 3] - f[k * 7 + 4], f[k * 7 + 5] - f[k * 7 + 6]].map(v => v / (2 * METRIC_STEP));
        rise[k] = Math.hypot(g[0], g[1], g[2]);
        for (let c = 0; c < 3; c++) normal[k * 3 + c] = rise[k] > 0 ? g[c] / rise[k] : 0;
        // (Heights are lengths where the vein is held to the lie of the ground, and in the field's own units where not)
        height[k] = walls.metric ? (rise[k] > 0 ? f[k * 7] / rise[k] : NaN) : f[k * 7];
    }
    // Each wall's height is known at the wall itself: read there, a step at a time from the place
    const reach = (wall: FittedField, sign: 1 | -1, first: Float64Array): Float64Array => {
        let s = Float64Array.from(there, (i, k) => first[i] - sign * height[k]);
        const at = new Float64Array(m * 3);
        for (let step = 0; step < WALL_STEPS; step++) {
            for (let k = 0; k < m; k++) {
                const by = sign * s[k] / (walls.metric ? 1 : Math.max(rise[k], LEAST_RISE));
                for (let c = 0; c < 3; c++) at[k * 3 + c] = points[there[k] * 3 + c] + (Number.isFinite(by) ? by : 0) * normal[k * 3 + c];
            }
            const v = evaluateField(wall, at);
            s = Float64Array.from(v, (value, k) => value - sign * height[k]);
        }
        return s;
    };
    const above = reach(walls.up, 1, up), below = reach(walls.down, -1, down);
    there.forEach((i, k) => {
        const t = above[k] + below[k];
        if (!(t > 0) || !(rise[k] > 0)) return;
        out[i] = Math.max(t, walls.least) / (walls.metric ? 1 : Math.max(rise[k], LEAST_RISE));
    });
    return out;
}

/** A vein's mesh reads each wall's height where the wall is, settled in this many rounds (`meshVein`) */
export const WALL_ROUNDS = 12;
/** ... and is made finer round every place a wall's height is known at, this many times over (each halves its triangles' sides there) */
export const WALL_FINER = 3;

/**
 * A mesh made finer round given places (xyz triples, on it or near it):
 * every triangle with one of them in or beside it has a corner put at the
 * middle of each of its sides, and the triangles next to it are cut to
 * match, so the mesh stays whole. Done `levels` times over, each on the
 * mesh the last left: the sides there end up 2 to the `levels` shorter.
 */
export function fineRound(mesh: TriMesh, places: ArrayLike<number> | null, levels: number): TriMesh {
    if (!(levels > 0) || !places || places.length < 3 || mesh.triangles.length === 0) return mesh;
    const v = Array.from(mesh.vertices);
    let t = Array.from(mesh.triangles);
    let changed = false;
    for (let level = 0; level < levels; level++) {
        const nv = v.length / 3;
        // Each triangle's middle, and how far its furthest corner is from it
        let longest = 0;
        const middle = new Float64Array(t.length), reach = new Float64Array(t.length / 3);
        for (let i = 0; i < t.length; i += 3) {
            for (let c = 0; c < 3; c++) middle[i + c] = (v[t[i] * 3 + c] + v[t[i + 1] * 3 + c] + v[t[i + 2] * 3 + c]) / 3;
            for (let k = 0; k < 3; k++) reach[i / 3] = Math.max(reach[i / 3], Math.hypot(v[t[i + k] * 3] - middle[i], v[t[i + k] * 3 + 1] - middle[i + 1], v[t[i + k] * 3 + 2] - middle[i + 2]));
            longest = Math.max(longest, reach[i / 3]);
        }
        // (The places in boxes as wide as the largest triangle; boxes far apart may share a number, which costs a look and no more)
        const size = Math.max(longest, 1e-9), boxes = new Map<number, number[]>();
        const box = (x: number, y: number, z: number) => ((x & 1023) << 20) | ((y & 1023) << 10) | (z & 1023);
        for (let q = 0; q + 2 < places.length; q += 3) {
            const b = box(Math.floor(places[q] / size), Math.floor(places[q + 1] / size), Math.floor(places[q + 2] / size));
            const list = boxes.get(b);
            if (list) list.push(q); else boxes.set(b, [q]);
        }
        // The sides of the triangles to cut, each once however many triangles share it
        const corner = new Map<number, number>();
        const cut = new Uint8Array(t.length / 3);
        let any = false;
        for (let i = 0; i < t.length; i += 3) {
            const r = reach[i / 3], bx = Math.floor(middle[i] / size), by = Math.floor(middle[i + 1] / size), bz = Math.floor(middle[i + 2] / size);
            let near = false;
            for (let dx = -1; dx <= 1 && !near; dx++) for (let dy = -1; dy <= 1 && !near; dy++) for (let dz = -1; dz <= 1 && !near; dz++) {
                const list = boxes.get(box(bx + dx, by + dy, bz + dz));
                if (!list) continue;
                for (const q of list) if (Math.hypot(places[q] - middle[i], places[q + 1] - middle[i + 1], places[q + 2] - middle[i + 2]) <= r) { near = true; break; }
            }
            if (near) { cut[i / 3] = 1; any = true; }
        }
        if (!any) break;
        changed = true;
        const key = (a: number, b: number) => (a < b ? a * nv + b : b * nv + a);
        for (let i = 0; i < t.length; i += 3) {
            if (!cut[i / 3]) continue;
            for (let k = 0; k < 3; k++) {
                const a = t[i + k], b = t[i + (k + 1) % 3], e = key(a, b);
                if (corner.has(e)) continue;
                corner.set(e, v.length / 3);
                v.push((v[a * 3] + v[b * 3]) / 2, (v[a * 3 + 1] + v[b * 3 + 1]) / 2, (v[a * 3 + 2] + v[b * 3 + 2]) / 2);
            }
        }
        const next: number[] = [];
        for (let i = 0; i < t.length; i += 3) {
            const m = [0, 1, 2].map(k => corner.get(key(t[i + k], t[i + (k + 1) % 3])) ?? -1);
            const cuts = (m[0] >= 0 ? 1 : 0) + (m[1] >= 0 ? 1 : 0) + (m[2] >= 0 ? 1 : 0);
            if (cuts === 0) { next.push(t[i], t[i + 1], t[i + 2]); continue; }
            if (cuts === 3) { next.push(t[i], m[0], m[2], m[0], t[i + 1], m[1], m[2], m[1], t[i + 2], m[0], m[1], m[2]); continue; }
            // Turned so that the first side is cut (one cut), or the first two are (two)
            const first = cuts === 1 ? m.findIndex(x => x >= 0) : m.findIndex((x, k) => x >= 0 && m[(k + 1) % 3] >= 0);
            const x = t[i + first], y = t[i + (first + 1) % 3], z = t[i + (first + 2) % 3];
            const xy = m[first], yz = m[(first + 1) % 3];
            if (cuts === 1) next.push(x, xy, z, xy, y, z);
            else next.push(xy, y, yz, x, xy, yz, x, yz, z);
        }
        t = next;
    }
    return changed ? { vertices: Float64Array.from(v), triangles: Uint32Array.from(t) } : mesh;
}

/**
 * A fitted vein as a closed mesh facing outwards: the mid-surface's mesh,
 * where the vein is there, pushed out to each wall, and closed round its
 * edge (where it tapers to nothing the two sides meet in one line).
 * `settle`: each wall's height is read where the wall itself is, not at the
 * place on the mid-surface under it: gone out by the height read there and
 * read again, this many times. The heights are known at the walls (a pick is
 * on its wall, and may be metres along the vein from the middle of its
 * stretch, down a hole that crosses at a low angle), and that is where the
 * vein's field reads them; read at the mid-surface the vein drawn is not
 * the vein fitted. `finer`: the mid-surface's mesh is first made finer,
 * this many times over, round every place a wall's height is known at
 * (`fineRound`): the vein's thickness changes within a metre or two of a
 * hole, and the mesh's corners are a cell apart.
 */
export function meshVein(fit: VeinFit, box: Box3, cell: number, reach: number, how: { settle?: number; finer?: number } = {}): VeinMesh {
    const settle = how.settle ?? WALL_ROUNDS, finer = how.finer ?? WALL_FINER;
    const none: VeinMesh = { vertices: new Float64Array(0), triangles: new Uint32Array(0), cells: 0, truncated: false, cut: false, ended: false };
    const walls = fit.field?.walls;
    const midField = fit.mid?.field;
    if (!fit.mid || !midField || !walls || !(cell > 0)) return none;
    const metric = walls.metric ?? 0;
    let base: TriMesh = meshSheet(fit.mid, { box, reach }, cell);
    const { cells, truncated } = base as ReturnType<typeof meshSheet>;
    if (base.triangles.length === 0) return none;
    // Only on its own side of what it ends on
    const ends = walls.ends ?? null;
    if (ends) {
        base = clipMeshByScalar(base, Float64Array.from(evaluateField(ends.field, base.vertices), o => -ends.side * o));
        if (base.triangles.length === 0) return none;
    }
    // Which way the walls are from places on the mid-surface, and how fast its field rises that way
    const h = cell / 4;
    const lieAt = (v: ArrayLike<number>) => {
        const n = v.length / 3;
        const probe = new Float64Array(n * 18);
        for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) for (const [o, sign] of [[0, 1], [3, -1]]) {
            const at = i * 18 + k * 6 + o;
            probe[at] = v[i * 3]; probe[at + 1] = v[i * 3 + 1]; probe[at + 2] = v[i * 3 + 2];
            probe[at + k] += sign * h;
        }
        const f = evaluateField(midField, probe);
        const normal = new Float64Array(n * 3), slope = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            const gx = (f[i * 6] - f[i * 6 + 1]) / (2 * h), gy = (f[i * 6 + 2] - f[i * 6 + 3]) / (2 * h), gz = (f[i * 6 + 4] - f[i * 6 + 5]) / (2 * h);
            const g = Math.hypot(gx, gy, gz) || 1;
            normal[i * 3] = gx / g; normal[i * 3 + 1] = gy / g; normal[i * 3 + 2] = gz / g;
            // (Heights that are lengths are pushed out as they are)
            slope[i] = metric ? 1 : Math.max(g, LEAST_RISE);
        }
        return { normal, slope };
    };
    // The walls' heights at places on the mid-surface (each read where its wall is, when asked: see `settle`)
    const thickness = (v: ArrayLike<number>, lie: { normal: Float64Array; slope: Float64Array } | null = null) => {
        let u = evaluateField(walls.up, v), d = evaluateField(walls.down, v);
        if (!lie || !(settle > 0)) return { u, d };
        const n = v.length / 3;
        const top = new Float64Array(n * 3), bottom = new Float64Array(n * 3);
        for (let round = 0; round < settle; round++) {
            for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
                top[i * 3 + k] = v[i * 3 + k] + lie.normal[i * 3 + k] * u[i] / lie.slope[i];
                bottom[i * 3 + k] = v[i * 3 + k] - lie.normal[i * 3 + k] * d[i] / lie.slope[i];
            }
            const nu = evaluateField(walls.up, top), nd = evaluateField(walls.down, bottom);
            // (Half-way to what is read there each time: it settles where a wall's height changes quickly across the vein too)
            const next = (was: Float64Array, now: Float64Array) => Float64Array.from(was, (w, i) => (Number.isFinite(now[i]) ? (w + now[i]) / 2 : w));
            u = next(u, nu); d = next(d, nd);
        }
        return { u, d };
    };
    const heights = (v: ArrayLike<number>) => thickness(v, settle > 0 ? lieAt(v) : null);
    // The places its walls' heights are known at, brought to the mid-surface (to first order: they are within the vein of it)
    const feet = (): Float64Array | null => {
        const at = fit.wallPlaces;
        if (!at || at.length < 3) return null;
        const far = fieldLengths(midField, at, h), { normal } = lieAt(at);
        return Float64Array.from(at, (x, i) => (Number.isFinite(far[Math.floor(i / 3)]) ? x - far[Math.floor(i / 3)] * normal[i] : x));
    };
    // Only where the vein is there
    if (finer > 0) base = fineRound(base, feet(), finer);
    const first = heights(base.vertices);
    const mesh = clipMeshByScalar(base, Float64Array.from(first.u, (u, i) => -(u + first.d[i])));
    const v = mesh.vertices, t = mesh.triangles;
    const nv = v.length / 3;
    if (t.length === 0) return none;

    const { normal, slope } = lieAt(v);
    const { u, d } = thickness(v, { normal, slope });

    // The edge: the sides of the mesh that one triangle alone has
    const twins = new Map<number, number>();
    for (let i = 0; i < t.length; i += 3) for (let e = 0; e < 3; e++) {
        const a = t[i + e], b = t[i + (e + 1) % 3];
        twins.set(a * nv + b, 1);
    }
    const rim: [number, number][] = [];
    const onRim = new Uint8Array(nv);
    for (const key of twins.keys()) {
        const a = Math.floor(key / nv), b = key % nv;
        if (twins.has(b * nv + a)) continue;
        rim.push([a, b]);
        onRim[a] = onRim[b] = 1;
    }
    const usual = fit.vein?.usual ?? 0;
    const top = new Float64Array(nv * 3), bottom = new Float64Array(nv * 3);
    const closed = new Uint8Array(nv);
    let cut = false, ended = false;
    const other = ends ? evaluateField(ends.field, v) : null;
    const offsets = new Float64Array(nv * 2);
    for (let i = 0; i < nv; i++) {
        let [a, b] = wallHeights(u[i], d[i], walls.least);
        // On its edge, where it has tapered to (next to) nothing, the two sides meet
        if (a + b <= 0 || (onRim[i] && walls.least <= 0 && a + b < 0.05 * usual + 1e-9)) { a = (a - b) / 2; b = -a; closed[i] = 1; }
        offsets[i * 2] = a; offsets[i * 2 + 1] = b;
        // (An open edge is where it stops at the box, or at what it ends on)
        if (onRim[i] && !closed[i]) { if (other && Math.abs(other[i]) < cell / 4) ended = true; else cut = true; }
    }
    // Pushed out along the slope, then put right by what the field reads there
    for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) {
        top[i * 3 + k] = v[i * 3 + k] + normal[i * 3 + k] * offsets[i * 2] / slope[i];
        bottom[i * 3 + k] = v[i * 3 + k] - normal[i * 3 + k] * offsets[i * 2 + 1] / slope[i];
    }
    const ft = metric ? fieldLengths(midField, top, metric) : evaluateField(midField, top);
    const fb = metric ? fieldLengths(midField, bottom, metric) : evaluateField(midField, bottom);
    // (As lengths: never moved by more than the height itself, so that a place where the mid-surface's field hardly rises throws no wall out)
    const within = (move: number, most: number) => (!metric ? move : Number.isFinite(move) ? Math.max(-Math.abs(most), Math.min(Math.abs(most), move)) : 0);
    for (let i = 0; i < nv; i++) {
        const mt = within(offsets[i * 2] - ft[i], offsets[i * 2]), mb = within(offsets[i * 2 + 1] + fb[i], offsets[i * 2 + 1]);
        for (let k = 0; k < 3; k++) {
            top[i * 3 + k] += normal[i * 3 + k] * mt / slope[i];
            bottom[i * 3 + k] -= normal[i * 3 + k] * mb / slope[i];
        }
    }

    // The top as the mid-surface is, the bottom turned over (a closed place has one vertex for both), a wall round the open edge
    const vertices = new Float64Array(nv * 6);
    vertices.set(top);
    vertices.set(bottom, nv * 3);
    const low = (i: number) => (closed[i] ? i : nv + i);
    const tris: number[] = [];
    for (let i = 0; i < t.length; i += 3) {
        const a = t[i], b = t[i + 1], c = t[i + 2];
        // (Where all three are closed there is nothing between the two sides)
        if (closed[a] && closed[b] && closed[c]) continue;
        tris.push(a, b, c, low(a), low(c), low(b));
    }
    for (const [a, b] of rim) {
        if (!closed[a]) tris.push(a, low(a), low(b));
        if (!closed[b]) tris.push(a, low(b), b);
    }
    // Facing outwards: turned over if it is not
    let six = 0;
    for (let i = 0; i < tris.length; i += 3) {
        const a = tris[i] * 3, b = tris[i + 1] * 3, c = tris[i + 2] * 3;
        const ax = vertices[a] - vertices[0], ay = vertices[a + 1] - vertices[1], az = vertices[a + 2] - vertices[2];
        const bx = vertices[b] - vertices[0], by = vertices[b + 1] - vertices[1], bz = vertices[b + 2] - vertices[2];
        const cx = vertices[c] - vertices[0], cy = vertices[c + 1] - vertices[1], cz = vertices[c + 2] - vertices[2];
        six += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    }
    if (six < 0) for (let i = 0; i < tris.length; i += 3) { const b = tris[i + 1]; tris[i + 1] = tris[i + 2]; tris[i + 2] = b; }
    return { vertices, triangles: Uint32Array.from(tris), cells, truncated, cut, ended };
}
