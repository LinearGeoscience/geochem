/**
 * How thick the ground between two surfaces is (pure).
 *
 * Measured from places on one surface to the other: the shortest way across
 * (the true thickness there), and straight up and down (what a vertical
 * hole would log). Straight up and down is the distance along the vertical
 * to where the other surface's field is nothing; a place with no part of
 * the other surface above or below it has none.
 */
import { evaluateField, heightAlong, type FittedField } from './rbf';

export interface Thickness {
    /** Places measured from, and how many of them the other surface could be reached from */
    places: number;
    met: number;
    /** The shortest way across: the least, the usual and the most, m (null: none met) */
    square: { least: number; usual: number; most: number } | null;
    /** Straight up and down */
    vertical: { least: number; usual: number; most: number } | null;
}

/** A line has met the other surface when the field is this near nothing there, m */
const MET = 0.05;

function spread(values: number[]): { least: number; usual: number; most: number } | null {
    if (values.length === 0) return null;
    const s = values.slice().sort((a, b) => a - b), n = s.length;
    return { least: s[0], usual: n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2, most: s[n - 1] };
}

/** The way a field rises at places (xyz triples), read over `step` either way: not unit length */
function slopes(field: FittedField, places: ArrayLike<number>, step: number): Float64Array {
    const n = Math.floor(places.length / 3);
    const probe = new Float64Array(n * 18);
    for (let i = 0; i < n; i++) for (let j = 0; j < 6; j++) {
        for (let k = 0; k < 3; k++) probe[i * 18 + j * 3 + k] = places[i * 3 + k];
        probe[i * 18 + j * 3 + (j >> 1)] += j % 2 ? -step : step;
    }
    const f = evaluateField(field, probe);
    const out = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) out[i * 3 + k] = (f[i * 6 + k * 2] - f[i * 6 + k * 2 + 1]) / (2 * step);
    return out;
}

/** How many times a place is moved toward the nearest part of a surface */
const ROUNDS = 6;

/**
 * The shortest distance from each place (xyz triples) to a field's surface,
 * m: the place is dropped onto the surface down the field's slope, and slid
 * along it until the line back to the place is square to it. NaN where the
 * surface was not reached. `step`: the distance its slope is read over.
 */
export function nearestDistance(field: FittedField, places: ArrayLike<number>, step = 1): Float64Array {
    const n = Math.floor(places.length / 3);
    const q = Float64Array.from({ length: n * 3 }, (_, i) => places[i]);
    for (let round = 0; round < ROUNDS; round++) {
        const f = evaluateField(field, q), g = slopes(field, q, step);
        for (let i = 0; i < n; i++) {
            const gx = g[i * 3], gy = g[i * 3 + 1], gz = g[i * 3 + 2], len2 = gx * gx + gy * gy + gz * gz;
            if (!(len2 > 1e-12) || !Number.isFinite(f[i])) continue;
            // Onto the surface, as it lies here ...
            const sx = q[i * 3] - f[i] * gx / len2, sy = q[i * 3 + 1] - f[i] * gy / len2, sz = q[i * 3 + 2] - f[i] * gz / len2;
            // ... and along it to the foot of the place (the last round only drops it on)
            const along = round === ROUNDS - 1 ? 0 : ((places[i * 3] - sx) * gx + (places[i * 3 + 1] - sy) * gy + (places[i * 3 + 2] - sz) * gz) / len2;
            if (round === ROUNDS - 1) { q[i * 3] = sx; q[i * 3 + 1] = sy; q[i * 3 + 2] = sz; continue; }
            q[i * 3] = places[i * 3] - along * gx;
            q[i * 3 + 1] = places[i * 3 + 1] - along * gy;
            q[i * 3 + 2] = places[i * 3 + 2] - along * gz;
        }
    }
    const left = evaluateField(field, q);
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        out[i] = Math.abs(left[i]) < MET ? Math.hypot(places[i * 3] - q[i * 3], places[i * 3 + 1] - q[i * 3 + 1], places[i * 3 + 2] - q[i * 3 + 2]) : NaN;
    }
    return out;
}

/**
 * The thickness between a surface and another, at `places` on the first
 * (xyz triples), to the `other`'s field. `step`: the distance the other's
 * slope is read over, m.
 */
export function thicknessBetween(other: FittedField, places: ArrayLike<number>, step = 1): Thickness {
    const n = Math.floor(places.length / 3);
    if (n === 0) return { places: 0, met: 0, square: null, vertical: null };
    const near = nearestDistance(other, places, step);
    // Straight up and down: back along the vertical to where the other's field is nothing
    const up = heightAlong(other, [0, 0, 1], places);
    const at = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) { at[i * 3] = places[i * 3]; at[i * 3 + 1] = places[i * 3 + 1]; at[i * 3 + 2] = places[i * 3 + 2] - up[i]; }
    const left = evaluateField(other, at);
    const sq: number[] = [], vt: number[] = [];
    for (let i = 0; i < n; i++) {
        if (Number.isFinite(near[i])) sq.push(near[i]);
        if (Number.isFinite(up[i]) && Math.abs(left[i]) < MET) vt.push(Math.abs(up[i]));
    }
    return { places: n, met: sq.length, square: spread(sq), vertical: spread(vt) };
}
