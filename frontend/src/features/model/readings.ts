/**
 * Dip readings: points of a surface where its lie was measured (pure,
 * unit-tested). A reading is a dip (0 = level, 90 = vertical) and a dip
 * direction (the compass bearing it slopes down towards, 0-360).
 */
import { normalFromDip, RIM_PLACES, rimDirections } from './plane';
import type { PointReading, ScenePoint, Vec3 } from './types';

/** A surface uses at most this many readings (each costs three to six rows in the fit); the first ones placed */
export const MAX_READINGS = 2000;
/**
 * A reading holds the surface to the measured plane for this share of the
 * way to the nearest other place the surface passes through.
 */
export const HOLD_SHARE = 0.25;
/** ... and this far (m) when there is no other place */
const HOLD_ALONE = 1;

/** How far from a place the nearest other of `through` is (xyz triples, the place itself among them or not). Infinity: there is none. */
export function nearestOther(p: ArrayLike<number>, through: ArrayLike<number>): number {
    let nearest = Infinity;
    for (let q = 0; q + 2 < through.length; q += 3) {
        const d = Math.hypot(through[q] - p[0], through[q + 1] - p[1], through[q + 2] - p[2]);
        if (d > 1e-6 && d < nearest) nearest = d;
    }
    return nearest;
}

/** A reading as stored: dip within 0-90, dip direction within 0-360. Null when either is not a number. */
export function cleanReading(reading: unknown): PointReading | null {
    const r = reading as Partial<PointReading> | null | undefined;
    if (!r || typeof r.dip !== 'number' || typeof r.dipDirection !== 'number' || !Number.isFinite(r.dip) || !Number.isFinite(r.dipDirection)) return null;
    let dip = Math.abs(r.dip), direction = r.dipDirection;
    // Past vertical it dips the other way
    if (dip > 180) return null;
    if (dip > 90) { dip = 180 - dip; direction += 180; }
    direction = ((direction % 360) + 360) % 360;
    // (The reach goes last: readings without one are written exactly as before)
    const reach = typeof r.reach === 'number' && Number.isFinite(r.reach) && r.reach > 0 ? r.reach : null;
    return { dip, dipDirection: direction, ...(r.overturned ? { overturned: true } : {}), ...(reach !== null ? { reach } : {}) };
}

/**
 * A reading given a reach holds the surface for that far, but never less
 * than this share of the way to the nearest other place (the places it adds
 * would crowd together) ...
 */
export const REACH_FLOOR = 0.1;
/** ... nor more than this share (it would pull against its neighbour's hold from the other side) */
export const REACH_CAP = 0.4;

/**
 * How far either side of a reading the surface is held to its plane: a share
 * of the way to the nearest other place (`nearest`, Infinity: there is none),
 * or the reading's own reach kept within REACH_FLOOR..REACH_CAP of that.
 */
export function holdOffset(nearest: number, reach?: number): number {
    const alone = !Number.isFinite(nearest);
    if (!(reach !== undefined && reach > 0)) return alone ? HOLD_ALONE : HOLD_SHARE * nearest;
    return alone ? reach : Math.min(REACH_CAP * nearest, Math.max(REACH_FLOOR * nearest, reach));
}

/** "35° towards 090°", and " · 20 m" when it has a reach */
export function formatReading(reading: PointReading): string {
    const whole = (v: number) => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));
    const reach = reading.reach ? ` · ${reading.reach >= 10 ? Math.round(reading.reach) : Number(reading.reach.toPrecision(2))} m` : '';
    return `${whole(reading.dip)}° towards ${String(Math.round(reading.dipDirection) % 360).padStart(3, '0')}°${reach}`;
}

/** The readings of a surface as its fit takes them (sheet.ts, ReadingPoints), in typed arrays */
export interface ReadingSamples {
    positions: Float64Array;
    normals: Float64Array;
    overturned: Uint8Array;
    offsets: Float64Array;
    /** 1: it is held by values put round it whatever else (sheet.ts): it has a reach of its own */
    byValues: Uint8Array;
    /**
     * For a reading with a reach of its own and room to use it: how far it
     * holds the surface to its plane each way round it (RIM_PLACES for each
     * reading, in the order of plane.ts `rimDirections`; all 0: it is held
     * the same distance all round, `offsets`). Null: none has.
     */
    rims: Float64Array | null;
}

/**
 * A place is in the way of a reading's hold in a direction when it is within
 * 67.5 degrees of it (this is the cosine): wide enough that a place between
 * two of the directions is in the way of both, so the hold is never put
 * out between two places that are each nearer than it.
 */
const RIM_CONE = Math.cos((67.5 * Math.PI) / 180);
/** The hold each way round is used when one way reaches this many times further than the same all round would */
const RIM_FROM = 1.5;

/**
 * How far a reading with a reach holds the surface to its plane each way
 * round it: its reach where nothing is in the way, and where another place
 * is, REACH_CAP of the way to it (as all round). At the edge of the data a
 * dip then carries the surface on down its plane as far as its reach,
 * where held the same all round it would be held back by the places
 * behind it. Null: no way is much further than all round (`offset`).
 */
export function rimOf(p: ArrayLike<number>, normal: ArrayLike<number>, reach: number, offset: number, through: ArrayLike<number>): number[] | null {
    if (!(reach > 0) || !(offset > 0)) return null;
    const dirs = rimDirections(normal);
    const free = dirs.map(() => Infinity);
    for (let j = 0; j + 2 < through.length; j += 3) {
        const d: Vec3 = [through[j] - p[0], through[j + 1] - p[1], through[j + 2] - p[2]];
        const length = Math.hypot(d[0], d[1], d[2]);
        if (!(length > 1e-6)) continue;
        dirs.forEach((u, k) => { if (d[0] * u[0] + d[1] * u[1] + d[2] * u[2] >= RIM_CONE * length && length < free[k]) free[k] = length; });
    }
    const rim = free.map(f => Math.max(offset, Math.min(reach, REACH_CAP * f)));
    return Math.max(...rim) >= RIM_FROM * offset ? rim : null;
}

/**
 * The readings among a surface's points. `through` is every place the
 * surface passes through (xyz triples, these points among them): how far a
 * reading holds the surface to its plane depends on how near the next place
 * is. Null when no point carries a reading.
 */
export function readingSamples(points: readonly ScenePoint[], through: ArrayLike<number>): ReadingSamples | null {
    const with_ = points.filter(p => p.reading).slice(0, MAX_READINGS);
    if (with_.length === 0) return null;
    const n = with_.length;
    const out: ReadingSamples = { positions: new Float64Array(n * 3), normals: new Float64Array(n * 3), overturned: new Uint8Array(n), offsets: new Float64Array(n), byValues: new Uint8Array(n), rims: null };
    with_.forEach((point, i) => {
        const { p, reading } = point;
        out.positions.set(p, i * 3);
        out.normals.set(normalFromDip(reading!.dip, reading!.dipDirection), i * 3);
        out.overturned[i] = reading!.overturned ? 1 : 0;
        out.offsets[i] = holdOffset(nearestOther(p, through), reading!.reach);
        out.byValues[i] = reading!.reach ? 1 : 0;
        const rim = reading!.reach ? rimOf(p, out.normals.subarray(i * 3, i * 3 + 3), reading!.reach, out.offsets[i], through) : null;
        if (rim) (out.rims ??= new Float64Array(n * RIM_PLACES)).set(rim, i * RIM_PLACES);
    });
    return out;
}

/**
 * At most `max` of these places (xyz triples), spread through the space they
 * fill: it is cut into equal boxes, as small as the limit allows, and the
 * place nearest the middle of those in each box is kept. Returns their
 * indices, in order. Readings cannot be averaged the way points can, so a
 * great many are thinned by choosing among them.
 */
export function pickSpread(positions: ArrayLike<number>, max: number): number[] {
    const n = Math.floor(positions.length / 3);
    if (n <= max || max < 1) return Array.from({ length: n }, (_, i) => i);
    const min = [Infinity, Infinity, Infinity], top = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n * 3; i += 3) {
        for (let k = 0; k < 3; k++) {
            if (positions[i + k] < min[k]) min[k] = positions[i + k];
            if (positions[i + k] > top[k]) top[k] = positions[i + k];
        }
    }
    const extent = Math.max(top[0] - min[0], top[1] - min[1], top[2] - min[2]);
    if (!(extent > 0)) return [0];
    for (let size = extent / Math.ceil(Math.cbrt(max) * 2); ; size *= 1.2) {
        const nx = Math.floor((top[0] - min[0]) / size) + 1, ny = Math.floor((top[1] - min[1]) / size) + 1;
        const boxes = new Map<number, number[]>();
        for (let i = 0; i < n; i++) {
            const key = Math.floor((positions[i * 3] - min[0]) / size)
                + nx * (Math.floor((positions[i * 3 + 1] - min[1]) / size) + ny * Math.floor((positions[i * 3 + 2] - min[2]) / size));
            const own = boxes.get(key);
            if (own) own.push(i);
            else boxes.set(key, [i]);
        }
        if (boxes.size > max) continue;
        const picked: number[] = [];
        for (const own of boxes.values()) {
            const mid = [0, 0, 0];
            for (const i of own) for (let k = 0; k < 3; k++) mid[k] += positions[i * 3 + k] / own.length;
            let best = own[0], near = Infinity;
            for (const i of own) {
                const d = Math.hypot(positions[i * 3] - mid[0], positions[i * 3 + 1] - mid[1], positions[i * 3 + 2] - mid[2]);
                if (d < near) { near = d; best = i; }
            }
            picked.push(best);
        }
        return picked.sort((a, b) => a - b);
    }
}
