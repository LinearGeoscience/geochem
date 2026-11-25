/**
 * Closed bodies: the volume a logged unit fills, as a surface round it (pure,
 * unit-tested).
 *
 * A sheet is fitted about a plane; a body has none. Its field is positive
 * inside and negative outside, and its skin is where the field is zero. It
 * is given:
 *  - zero at every contact (where a hole passes into or out of the unit) and
 *    at any point placed by hand;
 *  - in the middle of every logged stretch, inside or outside, about how far
 *    that place is from the skin (the distance to the nearest contact),
 *    positive inside, negative outside;
 *  - where its skin was given a dip, a direction or a drawn line by hand,
 *    how it lies there (see `BodyInput.readings`, `directed`, `lines`);
 *  - "outside" at a ring of places well beyond the drilling, so the body
 *    closes rather than running off where nothing was drilled.
 * Giving distances (rather than just +1 and -1) is what keeps the body the
 * same thickness between holes as it is in them. The logging is then checked
 * against the result and the fit corrected, as for a surface between units
 * (contacts.ts).
 */
import type { RunMiddles } from './contacts';
import { bestFitPlane } from './plane';
import { fitBlended, type BlockCache } from './pou';
import { layeringOf } from './frame';
import { evaluateField, inverseStretch, layerCoordinate, stretchedBox, stretchPoints, type Layering, type Stretch } from './rbf';
import { nearestOther } from './readings';
import type { ShellLayers } from './shell';
import { coverOf, slopeChoice, tangents, type DirectedPoints, type OrientedPoints, type SheetFit } from './sheet';
import { meshSurface, type NodeMemory } from './surfaceNets';
import type { Box3, TriMesh, Vec3 } from './types';

export interface BodyInput {
    /** Places on its skin, xyz triples: the contacts, then any points placed by hand */
    points: ArrayLike<number>;
    /** A place in the middle of each logged stretch (xyz triples) and its side: 1 inside, -1 outside */
    middles: { positions: ArrayLike<number>; side: ArrayLike<number> };
    /** More places held to a value (the corrections: see contacts.ts) */
    valued?: { positions: ArrayLike<number>; values: ArrayLike<number> } | null;
    /** The extent of the data: the body is closed off beyond it */
    box: Box3;
    /** 0 = through every contact; larger = looser */
    smoothing?: number;
    /** Fit it in space stretched across its thickness (see `bodyStretch`) */
    stretch?: Stretch | null;
    /**
     * It follows the ground as the model's readings say it lies from place to
     * place (as a shell does: shell.ts, `ShellLayers`): each place's height
     * through the layers is one more coordinate of the fit, so a folded unit
     * joins from hole to hole round the fold. Takes the place of `stretch`.
     */
    layers?: ShellLayers | null;
    /**
     * How its skin lies at places on it (each is also one of `points`): the
     * unit normal of the plane at each, either way; and how far round it the
     * skin is held to that plane (0: not used). Which side of the plane is
     * the inside is taken from the logging near it, where that says
     * (`inwardOf`); `overturned` (1) turns that over. Held as slopes where
     * its places do not crowd (sheet.ts, `slopeChoice`) and it is not fitted
     * along the layers; else by places put round it on the plane.
     */
    readings?: { positions: ArrayLike<number>; normals: ArrayLike<number>; offsets: ArrayLike<number>; overturned?: ArrayLike<number> | null; byValues?: ArrayLike<number> | null } | null;
    /** Places on its skin (each also one of `points`) with a line the skin runs along there: it does not rise or fall along it */
    directed?: DirectedPoints | null;
    /**
     * Lines drawn on slices: its skin passes along each, crossing the slice
     * there. Places along them (NOT among `points`), at each the unit
     * direction square to the line within its slice, and how far either
     * side of the line its inside and its outside are put. Which side is
     * the inside is taken from the logging near the line (the same all
     * along a line); `flipped` (per line, by `groups`) turns a line over.
     */
    lines?: OrientedPoints | null;
    /** Its blocks as last fitted (pou.ts): with many places it is fitted block by block, and blocks with the same places are not fitted again */
    blocks?: BlockCache | null;
}

/**
 * The logging has to say this much more one way than the other for the
 * inside of a dip set on a body's skin to be taken from it (as a share of
 * all it says). Short of it only how the skin lies is held, not which side
 * of it is in.
 */
const SURE_SIDE = 0.5;

/**
 * Which way along `n` at `p` is into a body, as the logged stretches near
 * say: each stretch inside it pulls that way, each outside pushes the other,
 * the nearer the more (by the square of how far) and the more nearly along
 * `n` the more. Positive: along `n`; negative: against it. `sure`: the share
 * of all they say that this is (0 to 1).
 */
export function inwardOf(p: ArrayLike<number>, n: ArrayLike<number>, middles: { positions: ArrayLike<number>; side: ArrayLike<number> }): { way: number; sure: number } {
    const m = Math.min(Math.floor(middles.positions.length / 3), middles.side.length);
    let score = 0, weight = 0;
    for (let i = 0; i < m; i++) {
        const x = middles.positions[i * 3] - p[0], y = middles.positions[i * 3 + 1] - p[1], z = middles.positions[i * 3 + 2] - p[2];
        const r2 = x * x + y * y + z * z;
        if (!(r2 > 1e-12)) continue;
        const c = (x * n[0] + y * n[1] + z * n[2]) / (r2 * Math.sqrt(r2));
        score += middles.side[i] > 0 ? c : -c;
        weight += Math.abs(c);
    }
    return { way: score, sure: weight > 0 ? Math.abs(score) / weight : 0 };
}

/** The ring of outside places sits this share of the data's size beyond it */
const BEYOND = 0.5;

/** A body is stretched across its thickness by no more than this */
const MAX_STRETCH = 40;
/** Thinner than this share of the gap between holes, a body may not hold together between them */
const THIN = 0.75;
/** Stretched until it is this many hole spacings thick */
const THICK = 1.5;

function median(values: number[]): number {
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length === 0 ? NaN : sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface BodyShape {
    /** Fit it in space stretched across its thickness (null: as it is) */
    stretch: Stretch | null;
    /** Even so it is thin against the gaps between holes: it may come out in pieces round them */
    thin: boolean;
}

/**
 * A fit like this one is the same in every direction, which suits a body
 * about as thick as the holes are far apart, or thicker. A body much thinner
 * than that (a vein, a seam) comes out as beads round the holes with gaps
 * between. So where the holes meet the body roughly in one plane, and it is
 * thin against their spacing, space is stretched across that plane until it
 * is not thin: the body then holds together from hole to hole.
 *
 * No stretch when too few holes meet it, they do not meet it in a plane,
 * they run along it rather than across it, or it is thick.
 */
export function bodyShape(middles: RunMiddles): BodyShape {
    const rows: number[] = [];
    for (let i = 0; i < middles.side.length; i++) if (middles.side[i] > 0) rows.push(i);
    // A great many: every so-many-th will do
    const step = Math.max(1, Math.ceil(rows.length / 600));
    const used = rows.filter((_, k) => k % step === 0);
    const centres = used.flatMap(i => [middles.positions[i * 3], middles.positions[i * 3 + 1], middles.positions[i * 3 + 2]]);
    /** The usual distance from where one hole meets it to where the nearest other hole does */
    const spacingOf = (at: number[][]) => {
        const gaps: number[] = [];
        used.forEach((i, a) => {
            let best = Infinity;
            used.forEach((j, b) => {
                if (middles.hole[i] === middles.hole[j]) return;
                const d = Math.hypot(at[a][0] - at[b][0], at[a][1] - at[b][1], at[a][2] - at[b][2]);
                if (d < best) best = d;
            });
            if (Number.isFinite(best)) gaps.push(best);
        });
        return median(gaps);
    };
    const whole = used.map((_, k) => [centres[k * 3], centres[k * 3 + 1], centres[k * 3 + 2]]);
    // As it is: its length down the holes against their spacing (NaN with one hole: nothing to say)
    const asItIs: BodyShape = { stretch: null, thin: median(used.map(i => middles.length[i])) < THIN * spacingOf(whole) };
    if (used.length < 4) return asItIs;

    const plane = bestFitPlane(centres);
    if (!plane) return asItIs;
    const [long, wide, off] = plane.spread;
    // In a plane, and not just along one line (a single fence of holes says nothing of the plane)
    if (!(wide > 0.15 * long) || !(off < 0.35 * wide)) return asItIs;
    const n = plane.normal;

    // How thick it is, square to the plane, where holes cross it
    const thick: number[] = [];
    for (const i of used) {
        const d = [middles.along[i * 3], middles.along[i * 3 + 1], middles.along[i * 3 + 2]];
        const known = d[0] !== 0 || d[1] !== 0 || d[2] !== 0;
        const across = known ? Math.abs(d[0] * n[0] + d[1] * n[1] + d[2] * n[2]) : 1;
        if (across > 0.2) thick.push(middles.length[i] * across);
    }
    if (thick.length < used.length / 2) return asItIs;
    const thickness = median(thick);

    // How far apart the holes are where they meet it, within the plane
    const spacing = spacingOf(whole.map((p) => {
        const h = (p[0] - plane.point[0]) * n[0] + (p[1] - plane.point[1]) * n[1] + (p[2] - plane.point[2]) * n[2];
        return [p[0] - h * n[0], p[1] - h * n[1], p[2] - h * n[2]];
    }));
    if (!(thickness > 0) || !(spacing > 0)) return asItIs;
    const factor = Math.min(MAX_STRETCH, THICK * spacing / thickness);
    if (factor < 1.2) return { stretch: null, thin: false };
    return { stretch: { normal: n, point: plane.point, factor }, thin: thickness * factor < THIN * spacing };
}

/** The stretch of `bodyShape` alone. */
export function bodyStretch(middles: RunMiddles): Stretch | null {
    return bodyShape(middles).stretch;
}

const EMPTY: SheetFit = { status: 'empty', trend: null, field: null, onSurface: new Float64Array(0), stats: null, lineSigns: new Int8Array(0) };

/**
 * Fit a body's field. `status` is 'body' when there is one, 'empty' when
 * the logging does not bound it (no contact, or nothing inside, or nothing
 * outside).
 */
export function fitBody(input: BodyInput): SheetFit {
    // Its skin: the places given, then the places along its drawn lines
    const nGiven = Math.floor(input.points.length / 3);
    const ln = input.lines ?? null;
    const nLine = ln ? Math.min(Math.floor(ln.positions.length / 3), Math.floor(ln.normals.length / 3), ln.offsets.length) : 0;
    const nSkin = nGiven + nLine;
    const m = Math.min(Math.floor(input.middles.positions.length / 3), input.middles.side.length);
    const onSurface = new Float64Array(nSkin * 3);
    for (let i = 0; i < nGiven * 3; i++) onSurface[i] = input.points[i];
    for (let i = 0; i < nLine * 3; i++) onSurface[nGiven * 3 + i] = ln!.positions[i];
    // Everything below is in the space the fit is made in
    const layers = input.layers && input.layers.strength > 1 ? input.layers : null;
    const stretch = layers ? null : input.stretch ?? null;
    const seen = (points: ArrayLike<number>): ArrayLike<number> => (stretch ? stretchPoints(points, stretch) : points);
    const skin = seen(onSurface), middle = seen(input.middles.positions);
    let inside = 0, outside = 0;
    for (let i = 0; i < m; i++) {
        if (input.middles.side[i] > 0) inside++;
        else outside++;
    }
    if (nSkin === 0 || inside === 0 || outside === 0) return { ...EMPTY, onSurface };

    /** Distance to the nearest place on the skin */
    const toSkin = (x: number, y: number, z: number) => {
        let best = Infinity;
        for (let q = 0; q < nSkin * 3; q += 3) {
            const d = (skin[q] - x) ** 2 + (skin[q + 1] - y) ** 2 + (skin[q + 2] - z) ** 2;
            if (d < best) best = d;
        }
        return Math.sqrt(best);
    };

    const points: number[] = Array.from(skin);
    const values: number[] = new Array(nSkin).fill(0);
    let furthest = 0;
    for (let i = 0; i < m; i++) {
        const x = middle[i * 3], y = middle[i * 3 + 1], z = middle[i * 3 + 2];
        const far = toSkin(x, y, z);
        if (!(far > 1e-9)) continue;
        points.push(x, y, z);
        values.push(input.middles.side[i] > 0 ? far : -far);
        if (far > furthest) furthest = far;
    }
    if (!(furthest > 0)) return { ...EMPTY, onSurface };
    // Outside, well beyond the data: the corners and the middles of the faces of a larger box
    const { min, max } = input.box;
    const mid: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], furthest);
    const half: Vec3 = [(max[0] - min[0]) / 2 + BEYOND * size, (max[1] - min[1]) / 2 + BEYOND * size, (max[2] - min[2]) / 2 + BEYOND * size];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        const zeros = (a === 0 ? 1 : 0) + (b === 0 ? 1 : 0) + (c === 0 ? 1 : 0);
        if (zeros !== 0 && zeros !== 2) continue;
        const p = seen([mid[0] + a * half[0], mid[1] + b * half[1], mid[2] + c * half[2]]);
        points.push(p[0], p[1], p[2]);
        values.push(-toSkin(p[0], p[1], p[2]));
    }
    // The corrections are no further from the skin than anything else is
    const extra = input.valued ? Math.min(Math.floor(input.valued.positions.length / 3), input.valued.values.length) : 0;
    const held = extra > 0 ? seen(input.valued!.positions) : [];
    for (let i = 0; i < extra; i++) {
        points.push(held[i * 3], held[i * 3 + 1], held[i * 3 + 2]);
        values.push(Math.max(-furthest, Math.min(furthest, input.valued!.values[i])));
    }

    // How its skin lies where that was set by hand: dips and directions at places on it, and its drawn lines
    const rd = input.readings ?? null, dp = input.directed ?? null;
    const nRead = rd ? Math.min(Math.floor(rd.positions.length / 3), Math.floor(rd.normals.length / 3), rd.offsets.length) : 0;
    const nDir = dp ? Math.min(Math.floor(dp.positions.length / 3), Math.floor(dp.directions.length / 3), dp.offsets.length) : 0;
    const sloped: { row: number; along: Vec3 }[] = [];
    let round = 0;
    /** Per drawn line: 1 when the side its ticks point to is the inside, -1 when it is the outside */
    let lineSigns = new Int8Array(0);
    if (nRead + nDir + nLine > 0) {
        const at = (from: ArrayLike<number>, i: number): Vec3 => [from[i * 3], from[i * 3 + 1], from[i * 3 + 2]];
        const one = (p: ArrayLike<number>): Vec3 => { const q = seen([p[0], p[1], p[2]]); return [q[0], q[1], q[2]]; };
        const origin = one([0, 0, 0]);
        /** A direction in the ground, as it runs in the space the fit is made in (unit) */
        const way = (t: ArrayLike<number>): Vec3 => {
            const q = one(t), v: Vec3 = [q[0] - origin[0], q[1] - origin[1], q[2] - origin[2]], len = Math.hypot(v[0], v[1], v[2]) || 1;
            return [v[0] / len, v[1] / len, v[2] / len];
        };
        const off = (p: Vec3, t: ArrayLike<number>, far: number): Vec3 => [p[0] + far * t[0], p[1] + far * t[1], p[2] + far * t[2]];
        /** A place off the skin by `far` along `t` in the ground (the value it is given: how far that is where the fit is made), or on it (`value` 0) */
        const put = (p: Vec3, t: ArrayLike<number>, far: number, sided: number) => {
            const q = one(off(p, t, far)), from = one(p);
            points.push(q[0], q[1], q[2]);
            values.push(sided * Math.hypot(q[0] - from[0], q[1] - from[1], q[2] - from[2]));
        };
        const slope = (p: Vec3, along: Vec3, value: number) => {
            const q = one(p);
            sloped.push({ row: values.length, along });
            points.push(q[0], q[1], q[2]);
            values.push(value);
        };
        // Held as slopes at its place, where its places do not crowd and the fit has no coordinate through the layers
        // (a slope row says nothing of that one); else by places put round it
        const asked: { reading: boolean; i: number; next: number }[] = [];
        for (let i = 0; i < nRead; i++) if (rd!.offsets[i] > 0 && !rd!.byValues?.[i]) asked.push({ reading: true, i, next: nearestOther(one(at(rd!.positions, i)), skin) });
        for (let i = 0; i < nDir; i++) if (dp!.offsets[i] > 0) asked.push({ reading: false, i, next: nearestOther(one(at(dp!.positions, i)), skin) });
        const choice = layers ? { round: 0, held: asked.map(() => false) } : slopeChoice(asked.map(a => a.next), skin);
        round = choice.round;
        const asSlope = (reading: boolean, i: number) => asked.some((a, k) => a.reading === reading && a.i === i && choice.held[k]);

        for (let i = 0; i < nRead; i++) {
            const d = rd!.offsets[i];
            if (!(d > 0)) continue;
            const p = at(rd!.positions, i), normal = at(rd!.normals, i);
            // Which side of the plane is in, where the logging near says
            const side = inwardOf(p, normal, input.middles);
            const inward = side.sure >= SURE_SIDE ? (side.way < 0 ? -1 : 1) * (rd!.overturned?.[i] ? -1 : 1) : 0;
            const [t1, t2] = tangents(normal);
            if (asSlope(true, i)) {
                // The field does not change along two directions in the plane; and rises a metre a metre into the body
                const w1 = way(t1), w2 = way(t2);
                slope(p, w1, 0);
                slope(p, w2, 0);
                if (inward !== 0) {
                    const across: Vec3 = [w1[1] * w2[2] - w1[2] * w2[1], w1[2] * w2[0] - w1[0] * w2[2], w1[0] * w2[1] - w1[1] * w2[0]];
                    const len = Math.hypot(across[0], across[1], across[2]) || 1, facing = way(normal);
                    const turn = (across[0] * facing[0] + across[1] * facing[1] + across[2] * facing[2] < 0 ? -1 : 1) * inward / len;
                    slope(p, [across[0] * turn, across[1] * turn, across[2] * turn], 1);
                }
                continue;
            }
            // Four places round it on the plane are on the skin; and one either side of the plane is in, the other out
            for (const t of [t1, t2]) for (const far of [d, -d]) put(p, t, far, 0);
            if (inward !== 0) for (const far of [d, -d]) put(p, normal, far * inward, far > 0 ? 1 : -1);
        }
        for (let i = 0; i < nDir; i++) {
            const d = dp!.offsets[i];
            if (!(d > 0)) continue;
            const p = at(dp!.positions, i), along = at(dp!.directions, i);
            if (asSlope(false, i)) slope(p, way(along), 0);
            else for (const far of [d, -d]) put(p, along, far, 0);
        }
        // A drawn line: the same side of it is in all along it, as the logging near most of it says
        if (nLine > 0) {
            const groups = ln!.groups ?? null;
            let count = ln!.flipped?.length ?? 0;
            if (groups) for (let i = 0; i < nLine; i++) count = Math.max(count, groups[i] + 1);
            const score = new Float64Array(Math.max(1, count));
            lineSigns = new Int8Array(Math.max(1, count)).fill(1);
            for (let i = 0; i < nLine; i++) {
                if (!(ln!.offsets[i] > 0)) continue;
                const side = inwardOf(at(ln!.positions, i), at(ln!.normals, i), input.middles);
                score[groups ? groups[i] : 0] += Math.sign(side.way) * side.sure;
            }
            for (let i = 0; i < nLine; i++) {
                const d = ln!.offsets[i];
                if (!(d > 0)) continue;
                const g = groups ? groups[i] : 0;
                const inward = (score[g] < 0 ? -1 : 1) * (ln!.flipped?.[g] ? -1 : 1);
                lineSigns[g] = inward as 1 | -1;
                for (const far of [d, -d]) put(at(ln!.positions, i), at(ln!.normals, i), far * inward, far > 0 ? 1 : -1);
            }
        }
    }
    let slopes: Float64Array | null = null;
    if (round > 0 && sloped.length > 0) {
        slopes = new Float64Array(points.length);
        for (const s of sloped) slopes.set(s.along, s.row * 3);
    }

    // Along the ground from place to place: every place has its height through the layers as one more coordinate
    let layering: Layering | null = null;
    if (layers) {
        const all: Box3 = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
        for (let i = 0; i < points.length; i++) {
            if (points[i] < all.min[i % 3]) all.min[i % 3] = points[i];
            if (points[i] > all.max[i % 3]) all.max[i % 3] = points[i];
        }
        layering = layeringOf(layers, all);
    }
    // No drift: the field settles to a constant away from the data (the kernel needs no more than that)
    const fit = fitBlended(points, values, {
        drift: 'level', smoothing: input.smoothing, cover: coverOf(points, null), reuse: input.blocks ?? null,
        ...(layering ? { extra: layerCoordinate(layering, points), block: layers!.block } : {}),
        // (With no slope among them the fit is the one it was before there were any)
        ...(slopes ? { slopes, round } : {}),
    });
    if (!fit.ok) return { status: 'failed', trend: null, field: null, onSurface, stats: null, lineSigns, why: fit.reason };
    if (stretch) fit.field.stretch = stretch;
    if (layering) fit.field.layering = layering;
    // What it reports is how well the skin is honoured: the contacts and hand-placed points
    let worstMiss = 0;
    if (fit.stats.worstMiss > 0) {
        const at = evaluateField(fit.field, onSurface);
        for (let i = 0; i < nSkin; i++) worstMiss = Math.max(worstMiss, Math.abs(at[i]));
    }
    return { status: 'body', trend: null, field: fit.field, onSurface, stats: { ...fit.stats, worstMiss }, lineSigns };
}

export interface BodyMesh extends TriMesh {
    cells: number;
    truncated: boolean;
    /** It reaches the edge of the box and was closed off flat there */
    cut: boolean;
    /** The field's values at the nodes it was drawn on, for the next mesh of the same body on the same grid (only when asked for: `remember`) */
    memory?: NodeMemory | null;
}

/**
 * The skin of a fitted body as a closed mesh, facing outwards. Where the
 * body reaches the edge of `box` it is closed off flat against it, so there
 * is always a volume to measure. `seeds`: places on the skin to start from
 * (default: the ones it was fitted through).
 */
export function meshBody(
    fit: SheetFit, box: Box3, cell: number, seeds?: ArrayLike<number>, within?: (points: Float64Array) => Float64Array, space: Stretch | null = null,
    remember: { last: { memory: NodeMemory; still: (x: number, y: number, z: number) => boolean; far?: (x: number, y: number, z: number) => boolean } | null } | null = null,
): BodyMesh {
    const field = fit.field;
    if (!field || !(cell > 0)) return { vertices: new Float64Array(0), triangles: new Uint32Array(0), cells: 0, truncated: false, cut: false };
    /** How far inside the box a place is (negative outside it) */
    const inBox = (x: number, y: number, z: number) =>
        Math.min(x - box.min[0], box.max[0] - x, y - box.min[1], box.max[1] - y, z - box.min[2], box.max[2] - z);
    // `space`: it is thin across a plane and wide along it (thin sheets), so it is drawn on a grid in the space it
    // was fitted in, where it is neither, and its corners are then put back where they are in the ground. A cell
    // is `cell` along its sheets and that over the stretch across them: sheets thinner than a cell are not lost
    const back = space ? inverseStretch(space) : null;
    const grid = space ? stretchedBox(box, space) : box;
    const net = meshSurface({
        // Inside the body AND inside the box: the smaller of the two
        evaluate: (pts) => {
            const at = back ? stretchPoints(pts, back) : pts;
            const f = evaluateField(field, at);
            for (let i = 0; i < f.length; i++) f[i] = Math.min(f[i], inBox(at[i * 3], at[i * 3 + 1], at[i * 3 + 2]));
            // Kept inside something else (a shell in its domain): cut off at its faces, as at the box
            if (within) {
                const d = within(at instanceof Float64Array ? at : Float64Array.from(at));
                for (let i = 0; i < f.length; i++) if (d[i] < f[i]) f[i] = d[i];
            }
            return f;
        },
        box: {
            min: [grid.min[0] - 2 * cell, grid.min[1] - 2 * cell, grid.min[2] - 2 * cell],
            max: [grid.max[0] + 2 * cell, grid.max[1] + 2 * cell, grid.max[2] + 2 * cell],
        },
        cell, seeds: space ? stretchPoints(seeds ?? fit.onSurface, space) : seeds ?? fit.onSurface,
        // `remember`: the values at its nodes are kept, and those of the last mesh used again where `still` says (of a place in the
        // ground) that the field is as it was
        ...(remember ? {
            own: true,
            last: remember.last && {
                memory: remember.last.memory,
                // (`far`: asked first, of the node where it is on the grid; true, and it is as it was without more ado)
                still: ((still, far) => (back
                    ? (x: number, y: number, z: number) => { if (far?.(x, y, z)) return true; const p = stretchPoints([x, y, z], back); return still(p[0], p[1], p[2]); }
                    : (x: number, y: number, z: number) => far?.(x, y, z) || still(x, y, z)))(remember.last.still, remember.last.far),
            },
        } : {}),
    });
    let cut = false;
    const v = back ? stretchPoints(net.vertices, back) : net.vertices;
    for (let i = 0; i < v.length && !cut; i += 3) cut = inBox(v[i], v[i + 1], v[i + 2]) < 0.75 * cell;
    // The mesher's triangles face where the field is positive (inwards): turn them to face out
    const t = net.triangles;
    for (let i = 0; i < t.length; i += 3) {
        const b = t[i + 1];
        t[i + 1] = t[i + 2];
        t[i + 2] = b;
    }
    return { vertices: v, triangles: t, cells: net.cells, truncated: net.truncated, cut, ...(remember ? { memory: net.memory } : {}) };
}

/**
 * The volume a mesh encloses, or null when it is not closed (an edge with
 * only one triangle on it).
 */
export function closedVolume(mesh: TriMesh): number | null {
    const { vertices: v, triangles: t } = mesh;
    if (t.length === 0) return null;
    const n = v.length / 3;
    // Each edge of a closed mesh is walked once in each direction
    const edges = new Map<number, number>();
    let six = 0;
    for (let i = 0; i < t.length; i += 3) {
        const a = t[i], b = t[i + 1], c = t[i + 2];
        for (const [p, q] of [[a, b], [b, c], [c, a]]) {
            const key = p < q ? p * n + q : q * n + p;
            edges.set(key, (edges.get(key) ?? 0) + (p < q ? 1 : -1));
        }
        // Measured from the first vertex of the mesh, so large coordinates do not cost accuracy
        const ax = v[a * 3] - v[0], ay = v[a * 3 + 1] - v[1], az = v[a * 3 + 2] - v[2];
        const bx = v[b * 3] - v[0], by = v[b * 3 + 1] - v[1], bz = v[b * 3 + 2] - v[2];
        const cx = v[c * 3] - v[0], cy = v[c * 3 + 1] - v[1], cz = v[c * 3 + 2] - v[2];
        six += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    }
    for (const count of edges.values()) if (count !== 0) return null;
    return Math.abs(six) / 6;
}
