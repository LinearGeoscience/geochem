/**
 * Radial basis function fit of a 3D scalar field (pure, unit-tested).
 *
 * Every modelled surface is the place where a fitted field crosses a level:
 *
 *     f(p) = drift(p) + c0 + sum_j w_j * (-|p - x_j|)
 *
 * The kernel is the linear (biharmonic) one: it does not overshoot between
 * nearby points and stays well conditioned at drillhole spacing (the cubic
 * kernel does not). The drift is either
 *   - a FIXED plane (signed distance to a trend plane): for sheets, where the
 *     data are points ON the surface (value 0) and the trend supplies the
 *     which-side-is-which that zeros alone cannot; or
 *   - a FREE linear function, solved with the weights: for fields with real
 *     values (distance to a contact, a grade).
 *
 * Coordinates are centred and scaled by ONE factor before solving (raw UTM
 * coordinates make the system singular; per-axis scaling would add a hidden
 * anisotropy). Values stay in their own units.
 */
import { solveDense } from './linalg';
import { ReachGrid } from './near';
import type { Box3, Plane, Vec3 } from './types';

/**
 * Space stretched along one direction before a fit: a place `d` from the
 * plane through `point` square to `normal` is treated as `factor * d` from
 * it. With `second`, it is stretched along a second direction too, square
 * to the first: what is left unstretched is then one direction, the one
 * things carry furthest in.
 */
export interface Stretch {
    normal: Vec3;
    point: Vec3;
    factor: number;
    second?: { normal: Vec3; factor: number } | null;
}

/** World points (xyz triples) as a stretched fit sees them. */
export function stretchPoints(points: ArrayLike<number>, stretch: Stretch): Float64Array {
    const out = Float64Array.from(points);
    const { normal: n, point: c } = stretch;
    const m = stretch.second?.normal ?? null, g = stretch.second ? stretch.second.factor - 1 : 0;
    for (let i = 0; i + 2 < out.length; i += 3) {
        const dx = out[i] - c[0], dy = out[i + 1] - c[1], dz = out[i + 2] - c[2];
        const t = (stretch.factor - 1) * (dx * n[0] + dy * n[1] + dz * n[2]);
        out[i] += t * n[0];
        out[i + 1] += t * n[1];
        out[i + 2] += t * n[2];
        if (m) {
            const u = g * (dx * m[0] + dy * m[1] + dz * m[2]);
            out[i] += u * m[0];
            out[i + 1] += u * m[1];
            out[i + 2] += u * m[2];
        }
    }
    return out;
}

/** The stretch that undoes a stretch: stretched points back to where they are in the world. */
export function inverseStretch(stretch: Stretch): Stretch {
    return {
        normal: stretch.normal, point: stretch.point, factor: 1 / stretch.factor,
        ...(stretch.second ? { second: { normal: stretch.second.normal, factor: 1 / stretch.second.factor } } : {}),
    };
}

/** The box that holds a box once it is stretched. */
export function stretchedBox(box: { min: Vec3; max: Vec3 }, stretch: Stretch): { min: Vec3; max: Vec3 } {
    const corners: number[] = [];
    for (const x of [box.min[0], box.max[0]]) for (const y of [box.min[1], box.max[1]]) for (const z of [box.min[2], box.max[2]]) corners.push(x, y, z);
    const s = stretchPoints(corners, stretch);
    const out = { min: [Infinity, Infinity, Infinity] as Vec3, max: [-Infinity, -Infinity, -Infinity] as Vec3 };
    for (let i = 0; i < s.length; i++) {
        out.min[i % 3] = Math.min(out.min[i % 3], s[i]);
        out.max[i % 3] = Math.max(out.max[i % 3], s[i]);
    }
    return out;
}

/** How long a line of world length 1 along `direction` is to a stretched fit. */
export function stretchedLength(direction: ArrayLike<number>, stretch: Stretch): number {
    const p = stretchPoints([stretch.point[0] + direction[0], stretch.point[1] + direction[1], stretch.point[2] + direction[2]], stretch);
    return Math.hypot(p[0] - stretch.point[0], p[1] - stretch.point[1], p[2] - stretch.point[2]);
}

/** A height through the layers of the ground (frame.ts) at the places of a lattice: x fastest, then y, then z */
export interface HeightLattice {
    min: Vec3;
    cell: number;
    size: [number, number, number];
    heights: Float32Array;
}

/**
 * A fit that follows the ground as it lies from place to place. Every place
 * has one more coordinate than its three in the ground: `weight` times its
 * height through the layers. Two places on one layer are then as far apart
 * as they are in the ground; two places one above the other, a metre apart
 * across the layers, are sqrt(1 + weight^2) m apart. Where the ground lies
 * one way everywhere this is a `Stretch` across it by that factor.
 *
 * `second`: the ground has a long direction in its layers as well (a
 * plunge), which turns from place to place as they do. Every place then
 * has a second coordinate: `second.weight` times how far across the long
 * direction it is, within the layers. Two places on one layer and one line
 * down the plunge are as far apart as they are in the ground; a metre
 * apart across the plunge, sqrt(1 + second.weight^2) m. Where the ground
 * lies one way everywhere it is a `Stretch` with its `second`.
 */
export interface Layering extends HeightLattice {
    weight: number;
    second?: (HeightLattice & { weight: number }) | null;
}

/**
 * The extra coordinate of world points (xyz triples) in a layered fit: one
 * number a point, or with a `second` two (the height through the layers,
 * then across the plunge). Beyond a lattice it is as at the lattice's nearest face.
 */
export function layerCoordinate(layering: Layering, points: ArrayLike<number>): Float64Array {
    const count = Math.floor(points.length / 3);
    if (!layering.second) return latticeRead(layering, layering.weight, points, new Float64Array(count), 0, 1);
    const out = new Float64Array(count * 2);
    latticeRead(layering, layering.weight, points, out, 0, 2);
    return latticeRead(layering.second, layering.second.weight, points, out, 1, 2);
}

/** How many numbers a place has in `extra` (1, or 2 with a second coordinate): from how many there are for `count` places */
export function extraWidth(extra: ArrayLike<number> | null | undefined, count: number): number {
    return extra && count > 0 && extra.length >= count * 2 ? 2 : 1;
}

function latticeRead(lattice: HeightLattice, weight: number, points: ArrayLike<number>, out: Float64Array, first: number, step: number): Float64Array {
    const { min, cell, size, heights } = lattice;
    const [nx, ny, nz] = size;
    const count = Math.floor(points.length / 3);
    const inv = 1 / cell;
    for (let q = 0, i = 0; q < count; q++, i += 3) {
        const u = Math.min(nx - 1, Math.max(0, (points[i] - min[0]) * inv));
        const v = Math.min(ny - 1, Math.max(0, (points[i + 1] - min[1]) * inv));
        const w = Math.min(nz - 1, Math.max(0, (points[i + 2] - min[2]) * inv));
        const i0 = Math.min(nx - 2, Math.floor(u)), j0 = Math.min(ny - 2, Math.floor(v)), k0 = Math.min(nz - 2, Math.floor(w));
        const a = u - i0, b = v - j0, c = w - k0;
        const at = i0 + nx * (j0 + ny * k0), up = at + nx * ny;
        const low = (heights[at] * (1 - a) + heights[at + 1] * a) * (1 - b) + (heights[at + nx] * (1 - a) + heights[at + nx + 1] * a) * b;
        const high = (heights[up] * (1 - a) + heights[up + 1] * a) * (1 - b) + (heights[up + nx] * (1 - a) + heights[up + nx + 1] * a) * b;
        out[first + q * step] = weight * (low * (1 - c) + high * c);
    }
    return out;
}

export interface FittedField {
    /** Centres in scaled coordinates, (world - origin) / scale, 3 per centre */
    centres: Float64Array;
    /** One weight per centre */
    weights: Float64Array;
    /** Linear part in scaled coordinates */
    lin: Vec3;
    c0: number;
    /** World position of scaled (0, 0, 0) */
    origin: Vec3;
    /** World length of one scaled unit */
    scale: number;
    /**
     * Rows that are slopes (see `FitOptions.slopes`): each centre's
     * direction, four numbers a centre: along x, y and z, and how fast the
     * extra coordinate changes along it (0 where there is none). All four
     * nothing: the centre is a value, as every centre is when this is
     * absent.
     */
    slopes?: Float64Array | null;
    /** The kernel is rounded off at the origin over this distance, in scaled units (absent or 0: it is not) */
    round?: number;
    /**
     * The field was fitted in stretched space: world points are stretched
     * the same way before it is read, whatever it is made of (its blocks
     * and its cap are in stretched space too).
     */
    stretch?: Stretch | null;
    /**
     * A field fitted block by block (pou.ts): it is these, blended. The
     * centres and weights above are then empty.
     */
    parts?: FieldPart[] | null;
    /** The field counts only near these places (see `FieldCap`) */
    cap?: FieldCap | null;
    /** Places it is made to hold, or not to hold, by hand (see `FieldTouches`): read last, over everything else */
    touches?: FieldTouches | null;
    /**
     * The field follows the ground from place to place (see `Layering`):
     * every place it is read at is given its extra coordinate from this
     * first. Its blocks and its cap have the extra coordinate of their own
     * places (`extra`).
     */
    layering?: Layering | null;
    /** The centres' extra coordinate, scaled as they are: (extra - extraOrigin) / scale. One per centre (absent: they have none) */
    extra?: Float64Array | null;
    extraOrigin?: number;
    /** The centres' second extra coordinate (`Layering.second`), scaled the same way (absent: they have none) */
    extra2?: Float64Array | null;
    extraOrigin2?: number;
    /** A vein (vein.ts): the rest of the field is its mid-surface, and it is read as how far inside the two walls a place is */
    walls?: FieldWalls | null;
    /** A surface that runs alongside another (conform.ts): the field is the other's, less an offset. Nothing else of it is read */
    offset?: FieldOffset | null;
}

/**
 * A field that is another's less an offset carried from place to place.
 * `side`: the offset is kept on this side of nothing (1: never below it;
 * -1: never above; 0: it is not kept), so the two surfaces cannot cross.
 * `flip`: -1 when its positive side is the other's negative one.
 */
export interface FieldOffset {
    of: FittedField;
    by: FittedField;
    flip: 1 | -1;
    side: 1 | -1 | 0;
    /**
     * The surface is the other's moved along this normal: the field is how far
     * a place is above the other's surface along it, less the offset, and the
     * offset is read at the place put on the plane (so it is the same all the
     * way along the normal). Absent: the field is the other's own, less the
     * offset where the place is.
     */
    along?: { normal: Vec3; point: Vec3 } | null;
}

/** How near nothing the field is brought when a place is carried onto a surface along a direction */
const HEIGHT_TOLERANCE = 1e-4;
const HEIGHT_ROUNDS = 8;

/**
 * How far each place is above a field's surface, measured along a direction
 * (negative: below it): the distance back along the direction to where the
 * field is nothing. For a surface met once only along that direction.
 * `normal`: one direction for every place, or one for each (xyz triples).
 */
export function heightAlong(field: FittedField, normal: ArrayLike<number>, points: ArrayLike<number>): Float64Array {
    const n = Math.floor(points.length / 3);
    const each = normal.length === n * 3 && n > 1;
    // (One carried along that same normal already reads as a height along it)
    const own = field.offset?.along?.normal;
    if (own && !each && own[0] === normal[0] && own[1] === normal[1] && own[2] === normal[2]) return evaluateField(field, points);
    const first = evaluateField(field, points);
    // The field is about metres: the first step takes it at its word
    const t = Float64Array.from(first);
    const before = new Float64Array(n), was = Float64Array.from(first);
    const at = new Float64Array(n * 3);
    for (let round = 0; round < HEIGHT_ROUNDS; round++) {
        for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) at[i * 3 + k] = points[i * 3 + k] - t[i] * normal[each ? i * 3 + k : k];
        const now = evaluateField(field, at);
        let worst = 0;
        for (let i = 0; i < n; i++) {
            const v = now[i];
            if (Math.abs(v) > worst) worst = Math.abs(v);
            if (!(Math.abs(v) > HEIGHT_TOLERANCE / 10)) continue;
            // By how much the field falls for a metre back along the normal, from the last two places tried
            let fall = (was[i] - v) / (t[i] - before[i]);
            if (!(fall > 0.1 && fall < 10)) fall = 1;
            before[i] = t[i]; was[i] = v;
            t[i] += v / fall;
        }
        if (worst < HEIGHT_TOLERANCE) break;
    }
    return t;
}

/**
 * The two walls of a vein, as heights off its mid-surface (in the
 * mid-surface's own field): `up` on its positive side, `down` on the other.
 * Where the two come to more than nothing but less than `least`, both are
 * raised to make it up.
 */
export interface FieldWalls {
    up: FittedField;
    down: FittedField;
    least: number;
    /**
     * The heights are lengths, m (a vein held to the lie of the ground):
     * a place is read by how far it is from the mid-surface (`fieldLengths`,
     * with this step), not by the mid-surface's field there. So the walls
     * are as far apart between holes as the heights say, though the field
     * rises more slowly there than at the holes. Absent: the heights are in
     * the field's own units, as veins were before.
     */
    metric?: number;
    /** It ends on another surface: it is only on this side of that one's field (1: where it is positive) */
    ends?: { field: FittedField; side: 1 | -1 } | null;
}

/**
 * A field kept to the neighbourhood of some places, each with a reach of
 * its own. Within half the reach of one of them the field is as fitted; from
 * there it fades to `background`, which it is at the reach and everywhere
 * beyond. A fit with no drift carries the last value it was given outwards
 * for ever: this is what stops a shell round high values from running off
 * into ground with no samples.
 */
/**
 * Places a body is made to hold, or not to hold, by hand, each by a
 * distance: "it runs through here, this thick", "nothing here, this far
 * round". Each is a lens put into the body or cut out of it AFTER it is
 * fitted: the larger of the field and the lens (inside), or the smaller of
 * the field and what is outside the lens. A place held as a value in the
 * fit instead acts everywhere, because nothing in the fit dies away with
 * distance: on a body of thin sheets, whose field is near nothing between
 * its holes, a row of them joined whatever the model nearly had beside it
 * (6 m of dyke for a dyke of 0.4 m) and moved its walls 40 m and more away
 * (measured on made-up dykes, Phase 285). A lens changes nothing beyond
 * itself, and the fit is the fit it was.
 */
export interface FieldTouches {
    /** The places, xyz triples (world) */
    places: Float64Array;
    /** 1: the place is inside; -1: it is outside */
    side: Int8Array;
    /** How far across each way the place is held, m */
    by: Float64Array;
    /** Each is a lens across this plane: as far across it as `by`, and `times` as far along it (absent: a ball) */
    across?: { normal: Vec3; times: number } | null;
    /** A touch's own `times` along that plane (absent, or not above 0 for one: `across.times`) */
    times?: Float64Array | null;
    /**
     * A touch that is a stretch, not a place: its other end, xyz triples (NaN
     * for a touch that is a place). It is held as far round the whole line
     * from its place to that end as a place is held round itself: what a
     * row of places along the line would be, drawn as one. Where the line
     * climbs across the plane of the lenses, its own plane is the one
     * through the line that is nearest that plane: a ribbon through both
     * its ends, which a hole through one end meets there only. (Flat in
     * the lenses' plane all the way, it took in the ground logged beside
     * the intercept it started from: seen on the first sections.)
     */
    ends?: Float64Array | null;
}

/**
 * How far a place is from touch `j`, counted as the touch counts it: across
 * its plane as it is, along it `times` shorter; from a stretch, to the
 * nearest place of the stretch counted so. Infinity: further than twice the
 * distance it is held by, where it says nothing.
 */
function touchRho(t: FieldTouches, j: number, x: number, y: number, z: number, nx: number, ny: number, nz: number, usual: number, flat: boolean): number {
    const by = t.by[j], times = flat && t.times && t.times[j] > 0 ? t.times[j] : usual;
    const ax = t.places[j * 3], ay = t.places[j * 3 + 1], az = t.places[j * 3 + 2];
    let dx = x - ax, dy = y - ay, dz = z - az;
    const e = t.ends;
    if (e && e[j * 3] === e[j * 3]) {
        const ux = e[j * 3] - ax, uy = e[j * 3 + 1] - ay, uz = e[j * 3 + 2] - az, u2 = ux * ux + uy * uy + uz * uz;
        if (flat && u2 > 0) {
            // Its plane: through the stretch, as near the plane of the lenses as that lets it be
            const lean = (ux * nx + uy * ny + uz * nz) / u2;
            const px = nx - lean * ux, py = ny - lean * uy, pz = nz - lean * uz, size = Math.hypot(px, py, pz);
            if (size > 1e-6) { nx = px / size; ny = py / size; nz = pz / size; }
        }
        // A stretch: from the nearest place of it, as the touch counts distance
        const k = 1 / (times * times), un = ux * nx + uy * ny + uz * nz, dn = dx * nx + dy * ny + dz * nz;
        const uu = (ux * ux + uy * uy + uz * uz) * k + (1 - k) * un * un;
        const du = (dx * ux + dy * uy + dz * uz) * k + (1 - k) * dn * un;
        const s = uu > 0 ? Math.max(0, Math.min(1, du / uu)) : 0;
        dx -= s * ux; dy -= s * uy; dz -= s * uz;
    }
    const d2 = dx * dx + dy * dy + dz * dz;
    // (It says nothing further out than twice the distance, counted as it is)
    const far = 2 * by * times;
    if (!(d2 < far * far)) return Infinity;
    const across = dx * nx + dy * ny + dz * nz;
    const rho = Math.sqrt(across * across + Math.max(0, d2 - across * across) / (times * times));
    return rho < 2 * by ? rho : Infinity;
}

/** The plane a field's touches lie along, as unit numbers (none: balls) */
function touchPlane(t: FieldTouches): { nx: number; ny: number; nz: number; usual: number; flat: boolean } {
    const size = t.across ? Math.hypot(t.across.normal[0], t.across.normal[1], t.across.normal[2]) : 0;
    const flat = t.across && size > 1e-12 && t.across.times > 0 ? t.across : null;
    return flat ? { nx: flat.normal[0] / size, ny: flat.normal[1] / size, nz: flat.normal[2] / size, usual: flat.times, flat: true } : { nx: 0, ny: 0, nz: 0, usual: 1, flat: false };
}

/** How far a place is from touch `j` as the touch counts it (see `FieldTouches`); Infinity: beyond twice its distance, where it says nothing */
export function touchDistance(t: FieldTouches, j: number, x: number, y: number, z: number): number {
    const p = touchPlane(t);
    return touchRho(t, j, x, y, z, p.nx, p.ny, p.nz, p.usual, p.flat);
}

/** Whether touch `j` says anything at a place: it says nothing further out than twice its distance, counted as it is */
export function touchReaches(t: FieldTouches, j: number, x: number, y: number, z: number): boolean {
    return touchDistance(t, j, x, y, z) < Infinity;
}

/** With more touches than this, which of them can reach a place is looked up in cells, not asked of each */
const TOUCH_CELLS_FROM = 24;

/** Which touches can reach each cell of a grid over all of them, in their order */
interface TouchCells { min: Vec3; size: number; dims: [number, number, number]; start: Int32Array; items: Int32Array }
const touchCells = new WeakMap<FieldTouches, TouchCells | null>();

function cellsOfTouches(t: FieldTouches): TouchCells | null {
    const had = touchCells.get(t);
    if (had !== undefined) return had;
    const m = t.side.length;
    let cells: TouchCells | null = null;
    if (m > TOUCH_CELLS_FROM) {
        const p = touchPlane(t);
        // The box each reaches: its place (and its other end), and twice its distance as far as it runs along its plane
        const lo = new Float64Array(m * 3), hi = new Float64Array(m * 3);
        const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
        for (let j = 0; j < m; j++) {
            const far = 2 * t.by[j] * (p.flat && t.times && t.times[j] > 0 ? t.times[j] : p.usual);
            const stretch = !!t.ends && t.ends[j * 3] === t.ends[j * 3];
            for (let k = 0; k < 3; k++) {
                const a = t.places[j * 3 + k], b = stretch ? t.ends![j * 3 + k] : a;
                lo[j * 3 + k] = Math.min(a, b) - far; hi[j * 3 + k] = Math.max(a, b) + far;
                min[k] = Math.min(min[k], lo[j * 3 + k]); max[k] = Math.max(max[k], hi[j * 3 + k]);
            }
        }
        const size = Math.max(4, Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 64);
        const dims: [number, number, number] = [0, 1, 2].map(k => Math.max(1, Math.ceil((max[k] - min[k]) / size))) as [number, number, number];
        const cell = (v: number, k: number) => Math.max(0, Math.min(dims[k] - 1, Math.floor((v - min[k]) / size)));
        const count = new Int32Array(dims[0] * dims[1] * dims[2] + 1);
        const each = (j: number, to: (c: number) => void) => {
            for (let x = cell(lo[j * 3], 0); x <= cell(hi[j * 3], 0); x++) for (let y = cell(lo[j * 3 + 1], 1); y <= cell(hi[j * 3 + 1], 1); y++) for (let z = cell(lo[j * 3 + 2], 2); z <= cell(hi[j * 3 + 2], 2); z++) to((x * dims[1] + y) * dims[2] + z);
        };
        for (let j = 0; j < m; j++) each(j, c => { count[c + 1]++; });
        for (let c = 0; c < count.length - 1; c++) count[c + 1] += count[c];
        const items = new Int32Array(count[count.length - 1]), next = count.slice(0, count.length - 1);
        // (In their order: a later touch is put over an earlier one)
        for (let j = 0; j < m; j++) each(j, c => { items[next[c]++] = j; });
        cells = { min, size, dims, start: count, items };
    }
    touchCells.set(t, cells);
    return cells;
}

/** A field's values (those it has without its touches, at `points`) with its touches put in: later ones over earlier ones. Written into `res`. */
export function withTouches(t: FieldTouches, points: ArrayLike<number>, res: Float64Array): Float64Array {
    const m = t.side.length;
    if (m === 0) return res;
    const { nx, ny, nz, usual, flat } = touchPlane(t);
    const cells = cellsOfTouches(t);
    for (let q = 0, i = 0; q < res.length; q++, i += 3) {
        const x = points[i], y = points[i + 1], z = points[i + 2];
        let f = res[q];
        if (cells) {
            const cx = Math.floor((x - cells.min[0]) / cells.size), cy = Math.floor((y - cells.min[1]) / cells.size), cz = Math.floor((z - cells.min[2]) / cells.size);
            if (cx < 0 || cy < 0 || cz < 0 || cx >= cells.dims[0] || cy >= cells.dims[1] || cz >= cells.dims[2]) continue;
            const c = (cx * cells.dims[1] + cy) * cells.dims[2] + cz;
            for (let k = cells.start[c]; k < cells.start[c + 1]; k++) {
                const j = cells.items[k], rho = touchRho(t, j, x, y, z, nx, ny, nz, usual, flat);
                if (rho === Infinity) continue;
                f = t.side[j] > 0 ? Math.max(f, t.by[j] - rho) : Math.min(f, rho - t.by[j]);
            }
        } else {
            for (let j = 0; j < m; j++) {
                const rho = touchRho(t, j, x, y, z, nx, ny, nz, usual, flat);
                if (rho === Infinity) continue;
                f = t.side[j] > 0 ? Math.max(f, t.by[j] - rho) : Math.min(f, rho - t.by[j]);
            }
        }
        res[q] = f;
    }
    return res;
}

export interface FieldCap {
    /** The places, xyz triples (world) */
    positions: Float64Array;
    /** How far each place counts, one per place */
    reach: Float64Array;
    background: number;
    /** The places' extra coordinate in a layered fit (see `Layering`; two numbers a place with a second): the reach is then measured with it */
    extra?: Float64Array | null;
    /**
     * Its places and reaches are in the ground as it is, though the field
     * is fitted in stretched space (`FittedField.stretch`): how far it
     * counts is then the same every way (a vein's thickness, carried
     * further down the plunge than across it, but known no further).
     */
    ground?: boolean;
    /**
     * How far it counts is less across a plane than along it: the distance
     * across (along `normal`) counts `times` over. An intrusion of thin
     * sheets is known a reach along its sheets from where it is logged, and
     * only an eighth of that across them: left the same every way, it swells
     * into the ground beside its holes that no hole has seen.
     */
    across?: { normal: Vec3; times: number } | null;
}

/** Places as a cap that counts less across a plane sees them */
function capSees(cap: FieldCap, points: ArrayLike<number>): ArrayLike<number> {
    return cap.across && cap.across.times !== 1 ? stretchPoints(points, { normal: cap.across.normal, point: [0, 0, 0], factor: cap.across.times }) : points;
}

const capGrids = new WeakMap<FieldCap, ReachGrid>();

/** For each point, how much the fitted field counts there: 1 near the cap's places, 0 at their reach and beyond. */
export function capWeights(cap: FieldCap, points: ArrayLike<number>, extra: ArrayLike<number> | null = null): Float64Array {
    let grid = capGrids.get(cap);
    if (!grid) {
        grid = new ReachGrid(capSees(cap, cap.positions), cap.reach, cap.extra ?? null);
        capGrids.set(cap, grid);
    }
    const count = Math.floor(points.length / 3);
    const w = new Float64Array(count);
    const wide = extraWidth(extra, count);
    const at = capSees(cap, points);
    for (let q = 0, i = 0; q < count; q++, i += 3) w[q] = grid.weight(at[i], at[i + 1], at[i + 2], extra ? extra[q * wide] : 0, extra && wide === 2 ? extra[q * 2 + 1] : 0);
    return w;
}

function evaluateCapped(field: FittedField, cap: FieldCap, points: ArrayLike<number>, extra: ArrayLike<number> | null, out?: Float64Array, capAt: ArrayLike<number> = points): Float64Array {
    const count = Math.floor(points.length / 3);
    const res = out ?? new Float64Array(count);
    const w = capWeights(cap, capAt, extra);
    const rows: number[] = [], local: number[] = [];
    for (let q = 0; q < count; q++) {
        if (w[q] > 0) {
            rows.push(q);
            local.push(points[q * 3], points[q * 3 + 1], points[q * 3 + 2]);
        } else res[q] = cap.background;
    }
    if (rows.length === 0) return res;
    const wide = extraWidth(extra, count);
    const f = evaluateBare(field, local, extra ? (wide === 2 ? rows.flatMap(q => [extra[q * 2], extra[q * 2 + 1]]) : rows.map(q => extra[q])) : null);
    for (let k = 0; k < rows.length; k++) {
        const q = rows[k];
        // Where no block of the fit reaches there is only the background
        res[q] = Number.isFinite(f[k]) ? w[q] * f[k] + (1 - w[q]) * cap.background : cap.background;
    }
    return res;
}

/** One block of a field fitted block by block: its own field, counted inside this box and fading to nothing at its faces */
export interface FieldPart {
    min: Vec3;
    max: Vec3;
    field: FittedField;
    /** How much it counts against the others where they overlap (1 if absent): a small block among big ones counts for more */
    weight?: number;
}

/**
 * Where two fits of a field can give different values: the boxes of the
 * blocks one has and the other has not (an empty list: nowhere; null:
 * anywhere). Fitted block by block, two fits that share blocks (pou.ts,
 * `BlockCache`) read every other place from the same blocks, added in the
 * same order, so there the two agree to the last digit.
 */
export function changedPlaces(before: FittedField, now: FittedField): Box3[] | null {
    if (before === now) return [];
    if (!before.parts || !now.parts) return null;
    if ((before.stretch ?? null) !== (now.stretch ?? null) || (before.cap ?? null) !== (now.cap ?? null) || (before.layering ?? null) !== (now.layering ?? null)) return null;
    const same = (a: FieldPart, b: FieldPart) => a.field === b.field && (a.weight ?? 1) === (b.weight ?? 1)
        && a.min.every((v, k) => v === b.min[k]) && a.max.every((v, k) => v === b.max[k]);
    const was = new Map<FittedField, number>();
    before.parts.forEach((p, i) => was.set(p.field, i));
    const changed: Box3[] = [], matched = new Set<number>();
    let order = -1;
    for (const p of now.parts) {
        const i = was.get(p.field);
        if (i !== undefined && same(before.parts[i], p)) {
            // (The blocks kept are added up in the order they were: otherwise the sums could differ in the last digit)
            if (i < order) return null;
            order = i;
            matched.add(i);
        } else changed.push({ min: p.min, max: p.max });
    }
    before.parts.forEach((p, i) => { if (!matched.has(i)) changed.push({ min: p.min, max: p.max }); });
    return changed;
}

/** 1 in the middle of a block, falling smoothly to 0 at its faces (u: 0 to 1 across it) */
const fade = (u: number) => {
    const t = 4 * u * (1 - u);
    return t * t;
};

/** A blended field at world points: each block's field by its weight there. NaN where no block reaches. */
function evaluateParts(parts: readonly FieldPart[], points: ArrayLike<number>, extra: ArrayLike<number> | null, out?: Float64Array): Float64Array {
    const count = Math.floor(points.length / 3);
    const res = out ?? new Float64Array(count);
    const total = new Float64Array(count), weight = new Float64Array(count);
    const wide = extraWidth(extra, count);
    for (const { min, max, field, weight: share = 1 } of parts) {
        const rows: number[] = [], w: number[] = [], local: number[] = [];
        const more: number[] | null = extra ? [] : null;
        const sx = 1 / (max[0] - min[0]), sy = 1 / (max[1] - min[1]), sz = 1 / (max[2] - min[2]);
        for (let q = 0, i = 0; q < count; q++, i += 3) {
            const x = points[i], y = points[i + 1], z = points[i + 2];
            if (!(x > min[0] && x < max[0] && y > min[1] && y < max[1] && z > min[2] && z < max[2])) continue;
            rows.push(q);
            w.push(share * fade((x - min[0]) * sx) * fade((y - min[1]) * sy) * fade((z - min[2]) * sz));
            local.push(x, y, z);
            if (more) { more.push(extra![q * wide]); if (wide === 2) more.push(extra![q * 2 + 1]); }
        }
        if (rows.length === 0) continue;
        const f = readField(field, local, more);
        for (let k = 0; k < rows.length; k++) {
            total[rows[k]] += w[k] * f[k];
            weight[rows[k]] += w[k];
        }
    }
    for (let q = 0; q < count; q++) res[q] = weight[q] > 0 ? total[q] / weight[q] : NaN;
    return res;
}

export interface FitStats {
    /** Centres solved for (after merging) */
    used: number;
    /** Input points merged into another at the same place */
    merged: number;
    /** Largest difference between the field and a value it was given (0 unless smoothed) */
    worstMiss: number;
    /** A little smoothing had to be added to get a stable solve */
    smoothed: boolean;
    /** Fitted block by block (pou.ts): how many blocks, and how many of them were fitted this time (the rest were the same as last time) */
    blocks?: number;
    refitted?: number;
}

export interface FitOptions {
    /** 'linear' = solve a linear drift; a plane = fixed drift, the signed distance to it */
    drift: 'linear' | Plane;
    /** 0 = pass exactly through the values; larger = looser (in scaled kernel units) */
    smoothing?: number;
    /** One more coordinate for each point, in the points' own units (see `Layering`); or two for each, one after the other (`Layering.second`) */
    extra?: ArrayLike<number> | null;
    /** For each point, looseness on top of `smoothing` (same units): the field may miss that point's value by more than the others' */
    loose?: ArrayLike<number> | null;
    /**
     * Rows that are slopes (Round 27; the reasoning is in hermite.ts). A
     * direction for each point (xyz triples): nothing (0, 0, 0) and the
     * point's value is what the field is there, as ever; otherwise its
     * value is how fast the field changes there along the direction, per
     * metre for a unit direction. A dip is three such rows at one place, a
     * line the surface holds is one. A slope row's `loose` is a share of
     * what the row reads of itself. Needs `round`.
     */
    slopes?: ArrayLike<number> | null;
    /** With `extra` and `slopes`: for each point, how fast the extra coordinate changes there along its direction (absent: not at all) */
    slopeExtra?: ArrayLike<number> | null;
    /**
     * The kernel is rounded off at the origin over this distance, m:
     * -sqrt(r² + round²), which is the distance a slope is imposed over.
     * Absent or 0: the kernel is -r, and nothing here is changed.
     */
    round?: number;
}

/** Why a fit could not be solved: too few points to fix it, or points that do not fix one answer (in words: describe.ts `failureText`) */
export type FitFailure = 'too-few' | 'singular';

export type FitResult =
    | { ok: true; field: FittedField; stats: FitStats }
    | { ok: false; reason: FitFailure };

/** Points closer than this (scaled units) are one point */
const MERGE = 1e-8;
/** Smoothing tried, in turn, when an exact solve is unstable */
const RESCUE = [1e-9, 1e-6];

interface Prepared {
    centres: Float64Array;
    /** The centres' extra coordinate, scaled as they are (null: they have none) */
    extra: Float64Array | null;
    extraOrigin: number;
    /** Their second extra coordinate, when each point was given two */
    extra2: Float64Array | null;
    extraOrigin2: number;
    values: Float64Array;
    /** Each centre's own looseness (null: none has any) */
    loose: Float64Array | null;
    /** Each centre's direction, four numbers a centre (null: none is a slope) */
    slopes: Float64Array | null;
    origin: Vec3;
    scale: number;
    merged: number;
}

/** Whether row i of four-number directions is a slope */
const slopeAt = (s: ArrayLike<number> | null, i: number) => s !== null && (s[i * 4] !== 0 || s[i * 4 + 1] !== 0 || s[i * 4 + 2] !== 0 || s[i * 4 + 3] !== 0);

/** Centre, scale and merge coincident points (averaging their values). */
function prepare(
    points: ArrayLike<number>, values: ArrayLike<number>, extra: ArrayLike<number> | null = null, loose: ArrayLike<number> | null = null,
    slopes: ArrayLike<number> | null = null, slopeExtra: ArrayLike<number> | null = null,
): Prepared {
    const n = Math.min(Math.floor(points.length / 3), values.length);
    const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
    let eMin = Infinity, eMax = -Infinity, fMin = Infinity, fMax = -Infinity;
    // (Two numbers a point: a second extra coordinate, `Layering.second`)
    const wide = extraWidth(extra, n);
    for (let i = 0; i < n; i++) {
        for (let k = 0; k < 3; k++) {
            const v = points[i * 3 + k];
            if (v < min[k]) min[k] = v;
            if (v > max[k]) max[k] = v;
        }
        if (extra) {
            if (extra[i * wide] < eMin) eMin = extra[i * wide];
            if (extra[i * wide] > eMax) eMax = extra[i * wide];
            if (wide === 2) {
                if (extra[i * 2 + 1] < fMin) fMin = extra[i * 2 + 1];
                if (extra[i * 2 + 1] > fMax) fMax = extra[i * 2 + 1];
            }
        }
    }
    const origin: Vec3 = n > 0 ? [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] : [0, 0, 0];
    const extraOrigin = extra && eMax >= eMin ? (eMin + eMax) / 2 : 0;
    const extraOrigin2 = fMax >= fMin ? (fMin + fMax) / 2 : 0;
    // (The scale is from where the points are in the ground alone: the looseness of a fit is in units of it)
    const extent = n > 0 ? Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) : 0;
    const scale = extent > 0 ? extent / 2 : 1;

    const centres: number[] = [];
    const extras: number[] = [];
    const seconds: number[] = [];
    const sums: number[] = [];
    const counts: number[] = [];
    const looseness: number[] = [];
    const dirs: number[] = [];
    let anySlope = false;
    const seen = new Map<string, number>();
    for (let i = 0; i < n; i++) {
        const v = values[i];
        const x = (points[i * 3] - origin[0]) / scale;
        const y = (points[i * 3 + 1] - origin[1]) / scale;
        const z = (points[i * 3 + 2] - origin[2]) / scale;
        const e = extra ? (extra[i * wide] - extraOrigin) / scale : 0;
        const f = extra && wide === 2 ? (extra[i * 2 + 1] - extraOrigin2) / scale : 0;
        if (!Number.isFinite(v) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(e) || !Number.isFinite(f)) continue;
        // (A slope row: its direction, and how fast the extra coordinate changes along it)
        const dx = slopes ? slopes[i * 3] : 0, dy = slopes ? slopes[i * 3 + 1] : 0, dz = slopes ? slopes[i * 3 + 2] : 0;
        const sloped = dx !== 0 || dy !== 0 || dz !== 0;
        const dw = sloped && extra && slopeExtra ? slopeExtra[i] : 0;
        if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz) || !Number.isFinite(dw)) continue;
        const key = `${Math.round(x / MERGE)},${Math.round(y / MERGE)},${Math.round(z / MERGE)}${extra ? `,${Math.round(e / MERGE)}` : ''}${wide === 2 ? `,${Math.round(f / MERGE)}` : ''}${sloped ? `|${Math.round(dx / MERGE)},${Math.round(dy / MERGE)},${Math.round(dz / MERGE)}` : ''}`;
        const hit = seen.get(key);
        const l = loose && loose[i] > 0 ? loose[i] : 0;
        if (hit !== undefined) {
            sums[hit] += v;
            counts[hit]++;
            // (Points at one place: as loose as the tightest of them)
            looseness[hit] = Math.min(looseness[hit], l);
            continue;
        }
        seen.set(key, sums.length);
        centres.push(x, y, z);
        dirs.push(dx, dy, dz, dw);
        if (sloped) anySlope = true;
        extras.push(e);
        seconds.push(f);
        sums.push(v);
        counts.push(1);
        looseness.push(l);
    }
    const m = sums.length;
    const merged = counts.reduce((s, c) => s + c - 1, 0);
    return {
        centres: Float64Array.from(centres),
        extra: extra ? Float64Array.from(extras) : null, extraOrigin,
        extra2: extra && wide === 2 ? Float64Array.from(seconds) : null, extraOrigin2,
        values: Float64Array.from(sums, (s, i) => s / counts[i]),
        loose: looseness.some(l => l > 0) ? Float64Array.from(looseness) : null,
        slopes: anySlope ? Float64Array.from(dirs) : null,
        origin, scale, merged: m > 0 ? merged : 0,
    };
}

/**
 * What row i reads of the basis of row j, with the kernel rounded off (`c2`:
 * the square of the distance it is rounded over, in scaled units): the
 * kernel between two values, its slope along a direction between a value
 * and a slope, its curvature along both between two slopes (hermite.ts,
 * with the extra coordinate as a fourth).
 */
function rowEntry(p: Prepared, c2: number, i: number, j: number): number {
    const c = p.centres, e = p.extra, f = p.extra2, s = p.slopes;
    const ux = c[i * 3] - c[j * 3], uy = c[i * 3 + 1] - c[j * 3 + 1], uz = c[i * 3 + 2] - c[j * 3 + 2], ue = e ? e[i] - e[j] : 0;
    // (A slope row says nothing of the second extra coordinate: it is taken not to change along the row's direction)
    const uf = f ? f[i] - f[j] : 0;
    const r = Math.sqrt(ux * ux + uy * uy + uz * uz + ue * ue + uf * uf + c2);
    const si = slopeAt(s, i), sj = slopeAt(s, j);
    if (!si && !sj) return -r;
    const di = si ? s![i * 4] * ux + s![i * 4 + 1] * uy + s![i * 4 + 2] * uz + s![i * 4 + 3] * ue : 0;
    const dj = sj ? s![j * 4] * ux + s![j * 4 + 1] * uy + s![j * 4 + 2] * uz + s![j * 4 + 3] * ue : 0;
    if (!si) return dj / r;
    if (!sj) return -di / r;
    const dd = s![i * 4] * s![j * 4] + s![i * 4 + 1] * s![j * 4 + 1] + s![i * 4 + 2] * s![j * 4 + 2] + s![i * 4 + 3] * s![j * 4 + 3];
    return dd / r - (di * dj) / (r * r * r);
}

/** `solve`, for rows that may be slopes and a kernel that may be rounded off */
function solveRows(p: Prepared, rhs: Float64Array, freeDrift: boolean, rho: number, c2: number): { weights: Float64Array; tail: Float64Array; worstMiss: number } | null {
    const c = p.centres, s = p.slopes;
    const m = rhs.length;
    const tailSize = freeDrift ? 4 : 1;
    const n = m + tailSize;
    const a = new Float64Array(n * n);
    // (A slope row's looseness is a share of what it reads of itself)
    const slack = new Float64Array(m);
    for (let i = 0; i < m; i++) {
        const l = p.loose ? p.loose[i] : 0;
        slack[i] = rho + (slopeAt(s, i) ? l * Math.abs(rowEntry(p, c2, i, i)) : l);
    }
    for (let i = 0; i < m; i++) {
        const row = i * n, sloped = slopeAt(s, i);
        a[row + i] = rowEntry(p, c2, i, i) + slack[i];
        for (let j = i + 1; j < m; j++) {
            const k = rowEntry(p, c2, i, j);
            a[row + j] = k;
            a[j * n + i] = k;
        }
        // The drift as the row reads it: a value reads 1 and its place, a slope reads its direction
        a[row + m] = sloped ? 0 : 1;
        a[m * n + i] = sloped ? 0 : 1;
        if (freeDrift) {
            for (let k = 0; k < 3; k++) {
                const v = sloped ? s![i * 4 + k] : c[i * 3 + k];
                a[row + m + 1 + k] = v;
                a[(m + 1 + k) * n + i] = v;
            }
        }
    }
    const b = new Float64Array(n);
    b.set(rhs);
    const x = solveDense(a, n, b);
    if (!x) return null;

    let worstMiss = 0, worstResidual = 0, size = 0;
    for (let i = 0; i < m; i++) {
        const sloped = slopeAt(s, i);
        let g = sloped ? 0 : x[m];
        if (freeDrift) for (let k = 0; k < 3; k++) g += x[m + 1 + k] * (sloped ? s![i * 4 + k] : c[i * 3 + k]);
        for (let j = 0; j < m; j++) g += x[j] * rowEntry(p, c2, i, j);
        const miss = Math.abs(g - rhs[i]);
        const residual = Math.abs(g + slack[i] * x[i] - rhs[i]);
        // (The worst miss is of a value: a slope's is not a distance)
        if (!sloped && miss > worstMiss) worstMiss = miss;
        if (residual > worstResidual) worstResidual = residual;
        if (Math.abs(rhs[i]) > size) size = Math.abs(rhs[i]);
    }
    if (!(worstResidual <= 1e-7 * Math.max(size, p.scale * 1e-3))) return null;
    return { weights: x.slice(0, m), tail: x.slice(m), worstMiss };
}

/** One attempt at a given smoothing. Null when the solve is singular or inaccurate. */
function solve(p: Prepared, rhs: Float64Array, freeDrift: boolean, rho: number, c2 = 0): { weights: Float64Array; tail: Float64Array; worstMiss: number } | null {
    if (p.slopes || c2 > 0) return solveRows(p, rhs, freeDrift, rho, c2);
    const c = p.centres, e = p.extra, f = p.extra2;
    const m = rhs.length;
    const tailSize = freeDrift ? 4 : 1;
    const n = m + tailSize;
    const a = new Float64Array(n * n);
    for (let i = 0; i < m; i++) {
        const xi = c[i * 3], yi = c[i * 3 + 1], zi = c[i * 3 + 2];
        const row = i * n;
        a[row + i] = rho + (p.loose ? p.loose[i] : 0);
        for (let j = i + 1; j < m; j++) {
            const dx = xi - c[j * 3], dy = yi - c[j * 3 + 1], dz = zi - c[j * 3 + 2];
            const de = e ? e[i] - e[j] : 0, df = f ? f[i] - f[j] : 0;
            const k = -Math.sqrt(dx * dx + dy * dy + dz * dz + de * de + df * df);
            a[row + j] = k;
            a[j * n + i] = k;
        }
        a[row + m] = 1;
        a[m * n + i] = 1;
        if (freeDrift) {
            for (let k = 0; k < 3; k++) {
                a[row + m + 1 + k] = c[i * 3 + k];
                a[(m + 1 + k) * n + i] = c[i * 3 + k];
            }
        }
    }
    const b = new Float64Array(n);
    b.set(rhs);
    const x = solveDense(a, n, b);
    if (!x) return null;

    // Check the answer against the equations (the factorisation overwrote the matrix)
    let worstMiss = 0, worstResidual = 0, size = 0;
    for (let i = 0; i < m; i++) {
        const xi = c[i * 3], yi = c[i * 3 + 1], zi = c[i * 3 + 2];
        let g = x[m];
        if (freeDrift) g += x[m + 1] * xi + x[m + 2] * yi + x[m + 3] * zi;
        for (let j = 0; j < m; j++) {
            const dx = xi - c[j * 3], dy = yi - c[j * 3 + 1], dz = zi - c[j * 3 + 2];
            const de = e ? e[i] - e[j] : 0, df = f ? f[i] - f[j] : 0;
            g -= x[j] * Math.sqrt(dx * dx + dy * dy + dz * dz + de * de + df * df);
        }
        const miss = Math.abs(g - rhs[i]);
        const residual = Math.abs(g + (rho + (p.loose ? p.loose[i] : 0)) * x[i] - rhs[i]);
        if (miss > worstMiss) worstMiss = miss;
        if (residual > worstResidual) worstResidual = residual;
        if (Math.abs(rhs[i]) > size) size = Math.abs(rhs[i]);
    }
    if (!(worstResidual <= 1e-7 * Math.max(size, p.scale * 1e-3))) return null;
    return { weights: x.slice(0, m), tail: x.slice(m), worstMiss };
}

/**
 * Fit a field to values at points (xyz triples, world coordinates).
 * A fixed-drift fit needs 1 point; a free linear drift needs 4 that are not
 * all in one plane.
 */
export function fitField(points: ArrayLike<number>, values: ArrayLike<number>, options: FitOptions): FitResult {
    const p = prepare(points, values, options.extra ?? null, options.loose ?? null, options.slopes ?? null, options.slopeExtra ?? null);
    const m = p.values.length;
    const freeDrift = options.drift === 'linear';
    if (m < (freeDrift ? 4 : 1)) return { ok: false, reason: 'too-few' };
    // (The rounding in scaled units; a slope cannot be asked of a kernel with a sharp point)
    const round = options.round !== undefined && options.round > 0 ? options.round / p.scale : 0;
    if (p.slopes && !(round > 0)) return { ok: false, reason: 'singular' };

    // A fixed plane drift is taken off the values; in scaled coordinates it is lin . s + shift
    let lin: Vec3 = [0, 0, 0];
    let shift = 0;
    const rhs = p.values.slice();
    // (In scaled coordinates a slope per metre is `scale` times as much per unit)
    if (p.slopes) for (let i = 0; i < m; i++) if (slopeAt(p.slopes, i)) rhs[i] *= p.scale;
    if (options.drift !== 'linear') {
        const { normal, point } = options.drift;
        lin = [normal[0] * p.scale, normal[1] * p.scale, normal[2] * p.scale];
        shift = normal[0] * (p.origin[0] - point[0]) + normal[1] * (p.origin[1] - point[1]) + normal[2] * (p.origin[2] - point[2]);
        for (let i = 0; i < m; i++) {
            if (slopeAt(p.slopes, i)) rhs[i] -= lin[0] * p.slopes![i * 4] + lin[1] * p.slopes![i * 4 + 1] + lin[2] * p.slopes![i * 4 + 2];
            else rhs[i] -= lin[0] * p.centres[i * 3] + lin[1] * p.centres[i * 3 + 1] + lin[2] * p.centres[i * 3 + 2] + shift;
        }
    }

    const asked = Math.max(0, options.smoothing ?? 0);
    const attempts = [asked, ...RESCUE.filter(r => r > asked)];
    for (const rho of attempts) {
        const s = solve(p, rhs, freeDrift, rho, round * round);
        if (!s) continue;
        if (freeDrift) lin = [s.tail[1], s.tail[2], s.tail[3]];
        return {
            ok: true,
            field: {
                centres: p.centres, weights: s.weights, lin, c0: s.tail[0] + shift, origin: p.origin, scale: p.scale, ...(p.extra ? { extra: p.extra, extraOrigin: p.extraOrigin } : {}), ...(p.extra2 ? { extra2: p.extra2, extraOrigin2: p.extraOrigin2 } : {}),
                ...(p.slopes ? { slopes: p.slopes } : {}), ...(round > 0 ? { round } : {}),
            },
            stats: { used: m, merged: p.merged, worstMiss: s.worstMiss, smoothed: rho !== asked },
        };
    }
    return { ok: false, reason: 'singular' };
}

/** The field at world points (xyz triples). `out` may be supplied to avoid an allocation. */
/** Places put on a plane, straight along its normal */
export function ontoPlane(points: ArrayLike<number>, plane: { normal: ArrayLike<number>; point: ArrayLike<number> }): Float64Array {
    const n = Math.floor(points.length / 3);
    const out = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
        let d = 0;
        for (let k = 0; k < 3; k++) d += (points[i * 3 + k] - plane.point[k]) * plane.normal[k];
        for (let k = 0; k < 3; k++) out[i * 3 + k] = points[i * 3 + k] - d * plane.normal[k];
    }
    return out;
}

export function evaluateField(field: FittedField, points: ArrayLike<number>, out?: Float64Array): Float64Array {
    const res = evaluateUntouched(field, points, out);
    return field.touches ? withTouches(field.touches, points, res) : res;
}

function evaluateUntouched(field: FittedField, points: ArrayLike<number>, out?: Float64Array): Float64Array {
    if (field.offset) {
        const { of, by, flip, side, along } = field.offset;
        let res: Float64Array, where: ArrayLike<number> = points;
        if (along) {
            const high = heightAlong(of, along.normal, points);
            if (out) { out.set(high); res = out; } else res = high;
            where = ontoPlane(points, along);
        } else res = evaluateField(of, points, out);
        const t = evaluateField(by, where);
        for (let i = 0; i < res.length; i++) {
            const off = side > 0 ? Math.max(t[i], 0) : side < 0 ? Math.min(t[i], 0) : t[i];
            res[i] = flip * (res[i] - off);
        }
        return res;
    }
    const res = readField(field, points, field.layering ? layerCoordinate(field.layering, points) : null, out);
    const walls = field.walls;
    if (!walls) return res;
    // A vein: positive between its walls, by how far it is to the nearer
    const up = evaluateField(walls.up, points), down = evaluateField(walls.down, points);
    if (walls.metric) {
        // Heights that are lengths: how far each place is from the mid-surface (only where the vein is there at all)
        const there: number[] = [];
        for (let i = 0; i < res.length; i++) if (up[i] + down[i] > 0) there.push(i);
        const places = new Float64Array(there.length * 3);
        there.forEach((i, k) => { places[k * 3] = points[i * 3]; places[k * 3 + 1] = points[i * 3 + 1]; places[k * 3 + 2] = points[i * 3 + 2]; });
        const far = fieldLengths({ ...field, walls: null }, places, walls.metric);
        there.forEach((i, k) => { res[i] = far[k]; });
    }
    for (let i = 0; i < res.length; i++) {
        let a = up[i], b = down[i];
        const t = a + b;
        if (t > 0 && t < walls.least) { a += (walls.least - t) / 2; b += (walls.least - t) / 2; }
        res[i] = Math.min(a - res[i], res[i] + b);
    }
    if (walls.ends) {
        const other = evaluateField(walls.ends.field, points), side = walls.ends.side;
        for (let i = 0; i < res.length; i++) res[i] = Math.min(res[i], side * other[i]);
    }
    return res;
}

/**
 * How far places are from a field's zero surface, to first order: the
 * field there over how fast it rises there (found from `step` either way
 * along each axis). Signed as the field is; where the field does not rise
 * at all, as far as can be.
 */
export function fieldLengths(field: FittedField, points: ArrayLike<number>, step: number): Float64Array {
    const n = Math.floor(points.length / 3);
    const probe = new Float64Array(n * 21);
    for (let i = 0; i < n; i++) for (let j = 0; j < 7; j++) {
        const at = i * 21 + j * 3;
        probe[at] = points[i * 3]; probe[at + 1] = points[i * 3 + 1]; probe[at + 2] = points[i * 3 + 2];
        if (j > 0) probe[at + ((j - 1) >> 1)] += j & 1 ? step : -step;
    }
    const f = evaluateField(field, probe);
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const g = Math.hypot(f[i * 7 + 1] - f[i * 7 + 2], f[i * 7 + 3] - f[i * 7 + 4], f[i * 7 + 5] - f[i * 7 + 6]) / (2 * step);
        out[i] = g > 0 ? f[i * 7] / g : f[i * 7] === 0 ? 0 : Math.sign(f[i * 7]) * Infinity;
    }
    return out;
}

/**
 * The field at world points whose extra coordinate is known already (one
 * for each point; null: the field has none). For a layered fit in the
 * making, and its blocks: `evaluateField` is the one to use on a finished field.
 */
export function readField(field: FittedField, points: ArrayLike<number>, extra: ArrayLike<number> | null, out?: Float64Array): Float64Array {
    const seen = field.stretch ? stretchPoints(points, field.stretch) : points;
    return field.cap ? evaluateCapped(field, field.cap, seen, extra, out, field.cap.ground ? points : seen) : evaluateBare(field, seen, extra, out);
}

/** The field as fitted, before any cap, at points in the space it was fitted in. */
function evaluateBare(field: FittedField, points: ArrayLike<number>, extra: ArrayLike<number> | null, out?: Float64Array): Float64Array {
    if (field.parts) return evaluateParts(field.parts, points, extra, out);
    const count = Math.floor(points.length / 3);
    const res = out ?? new Float64Array(count);
    const { centres: c, weights: w, lin, c0, origin: o } = field;
    const inv = 1 / field.scale;
    const m = w.length;
    const ce = extra && field.extra ? field.extra : null, eo = field.extraOrigin ?? 0;
    // (With a second extra coordinate the places asked about have two numbers each)
    const cf = ce && field.extra2 ? field.extra2 : null, fo = field.extraOrigin2 ?? 0;
    if (field.slopes || field.round) {
        // Rows that may be slopes, a kernel that may be rounded off: a value row adds its weight times the kernel, a slope row its weight times the kernel's slope along its direction
        const s4 = field.slopes ?? null, c2 = (field.round ?? 0) ** 2;
        for (let q = 0, i = 0; q < count; q++, i += 3) {
            const x = (points[i] - o[0]) * inv, y = (points[i + 1] - o[1]) * inv, z = (points[i + 2] - o[2]) * inv;
            const e = ce ? (extra![cf ? q * 2 : q] - eo) * inv : 0, f = cf ? (extra![q * 2 + 1] - fo) * inv : 0;
            let s = c0 + lin[0] * x + lin[1] * y + lin[2] * z;
            for (let j = 0, k = 0; j < m; j++, k += 3) {
                const dx = x - c[k], dy = y - c[k + 1], dz = z - c[k + 2], de = ce ? e - ce[j] : 0, df = cf ? f - cf[j] : 0;
                const r = Math.sqrt(dx * dx + dy * dy + dz * dz + de * de + df * df + c2);
                if (slopeAt(s4, j)) s += w[j] * (s4![j * 4] * dx + s4![j * 4 + 1] * dy + s4![j * 4 + 2] * dz + s4![j * 4 + 3] * de) / r;
                else s -= w[j] * r;
            }
            res[q] = s;
        }
        return res;
    }
    for (let q = 0, i = 0; q < count; q++, i += 3) {
        const x = (points[i] - o[0]) * inv, y = (points[i + 1] - o[1]) * inv, z = (points[i + 2] - o[2]) * inv;
        let s = c0 + lin[0] * x + lin[1] * y + lin[2] * z;
        if (cf) {
            const e = (extra![q * 2] - eo) * inv, f = (extra![q * 2 + 1] - fo) * inv;
            for (let j = 0, k = 0; j < m; j++, k += 3) {
                const dx = x - c[k], dy = y - c[k + 1], dz = z - c[k + 2], de = e - ce![j], df = f - cf[j];
                s -= w[j] * Math.sqrt(dx * dx + dy * dy + dz * dz + de * de + df * df);
            }
        } else if (ce) {
            const e = (extra![q] - eo) * inv;
            for (let j = 0, k = 0; j < m; j++, k += 3) {
                const dx = x - c[k], dy = y - c[k + 1], dz = z - c[k + 2], de = e - ce[j];
                s -= w[j] * Math.sqrt(dx * dx + dy * dy + dz * dz + de * de);
            }
        } else {
            for (let j = 0, k = 0; j < m; j++, k += 3) {
                const dx = x - c[k], dy = y - c[k + 1], dz = z - c[k + 2];
                s -= w[j] * Math.sqrt(dx * dx + dy * dy + dz * dz);
            }
        }
        res[q] = s;
    }
    return res;
}
