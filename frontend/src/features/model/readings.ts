/**
 * Dip readings: points of a surface where its lie was measured (pure,
 * unit-tested). A reading is a dip (0 = level, 90 = vertical) and a dip
 * direction (the compass bearing it slopes down towards, 0-360).
 */
import { normalFromDip } from './plane';
import type { PointReading, ScenePoint } from './types';

/** A surface uses at most this many readings (each costs six places in the fit); the first ones placed */
export const MAX_READINGS = 100;
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
    return { dip, dipDirection: direction, ...(r.overturned ? { overturned: true } : {}) };
}

/** "35° towards 090°" */
export function formatReading(reading: PointReading): string {
    const whole = (v: number) => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));
    return `${whole(reading.dip)}° towards ${String(Math.round(reading.dipDirection) % 360).padStart(3, '0')}°`;
}

/** The readings of a surface as its fit takes them (sheet.ts, ReadingPoints), in typed arrays */
export interface ReadingSamples {
    positions: Float64Array;
    normals: Float64Array;
    overturned: Uint8Array;
    offsets: Float64Array;
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
    const out: ReadingSamples = { positions: new Float64Array(n * 3), normals: new Float64Array(n * 3), overturned: new Uint8Array(n), offsets: new Float64Array(n) };
    with_.forEach((point, i) => {
        const { p, reading } = point;
        out.positions.set(p, i * 3);
        out.normals.set(normalFromDip(reading!.dip, reading!.dipDirection), i * 3);
        out.overturned[i] = reading!.overturned ? 1 : 0;
        const nearest = nearestOther(p, through);
        out.offsets[i] = Number.isFinite(nearest) ? HOLD_SHARE * nearest : HOLD_ALONE;
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
