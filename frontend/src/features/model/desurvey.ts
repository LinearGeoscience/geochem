/**
 * The path of a drillhole from its collar and survey stations, by minimum
 * curvature (pure, unit-tested).
 *
 * Between two stations the hole is taken to follow the one circular arc that
 * leaves the first station in its direction and reaches the second in its
 * own. Dip is negative downwards, azimuth clockwise from north; x east,
 * y north, z up. Past the last station the hole runs straight on.
 *
 * The backend desurveys the same way (backend/app/core/drillhole_manager.py
 * `trace_hole` / `positions_at`). Both are held to the made-up holes in
 * backend/tests/fixtures/desurvey_vectors.json, so the places the dataset
 * carries and the places worked out here agree.
 */
import { cross, dot } from './plane';
import type { Vec3 } from './types';

export interface SurveyStation {
    /** Distance down the hole, m */
    depth: number;
    /** Degrees from level, negative downwards */
    dip: number;
    /** Degrees clockwise from north */
    azimuth: number;
}

/** A hole's path: its stations in depth order, where each is, and the direction down the hole there. */
export interface HoleTrace {
    depths: Float64Array;
    /** xyz triples */
    positions: Float64Array;
    /** Unit xyz triples */
    directions: Float64Array;
}

/** Below this turn (radians) an arc is as good as straight, and the arc formulas divide by nearly nothing */
const STRAIGHT = 1e-7;

const RAD = Math.PI / 180;

/** The unit direction down a hole that dips and points this way. */
export function holeDirection(dip: number, azimuth: number): Vec3 {
    const d = dip * RAD;
    const a = azimuth * RAD;
    return [Math.cos(d) * Math.sin(a), Math.cos(d) * Math.cos(a), Math.sin(d)];
}

/** The angle between two unit vectors (exact for small angles too). */
function turnBetween(a: Vec3, b: Vec3): number {
    const c = cross(a, b);
    return Math.atan2(Math.hypot(c[0], c[1], c[2]), dot(a, b));
}

/** How much longer the two tangents of an arc are than its chord: tan(t / 2) / (t / 2). */
const arcFactor = (turn: number) => (turn > STRAIGHT ? Math.tan(turn / 2) / (turn / 2) : 1);

/**
 * Stations as a path can be built from them: in depth order, one to a depth,
 * a missing dip or azimuth taken from the station above (or, at the top, the
 * one below), and a station at the collar. Stations without a depth, and
 * holes with no dip or azimuth at all, give nothing. A hole whose first
 * station is below the collar starts out along that station's direction.
 */
export function cleanStations(stations: readonly Partial<SurveyStation>[]): SurveyStation[] {
    const usable = stations
        .filter(s => Number.isFinite(s.depth))
        .map(s => ({ depth: s.depth as number, dip: s.dip ?? NaN, azimuth: s.azimuth ?? NaN }))
        .sort((a, b) => a.depth - b.depth);
    for (const key of ['dip', 'azimuth'] as const) {
        for (let i = 1; i < usable.length; i++) {
            if (!Number.isFinite(usable[i][key])) usable[i][key] = usable[i - 1][key];
        }
        for (let i = usable.length - 2; i >= 0; i--) {
            if (!Number.isFinite(usable[i][key])) usable[i][key] = usable[i + 1][key];
        }
    }
    const out: SurveyStation[] = [];
    for (const s of usable) {
        if (!Number.isFinite(s.dip) || !Number.isFinite(s.azimuth)) continue;
        if (out.length && out[out.length - 1].depth === s.depth) continue;
        out.push(s);
    }
    if (out.length && out[0].depth > 0) out.unshift({ ...out[0], depth: 0 });
    return out;
}

/**
 * The path of a hole from its collar. `stations` are as `cleanStations`
 * leaves them (rising depths, the first at the collar). Null without any.
 */
export function traceHole(collar: Vec3, stations: readonly SurveyStation[]): HoleTrace | null {
    const n = stations.length;
    if (n === 0) return null;
    const depths = new Float64Array(n);
    const positions = new Float64Array(n * 3);
    const directions = new Float64Array(n * 3);
    let before: Vec3 = [0, 0, 0];
    for (let i = 0; i < n; i++) {
        const s = stations[i];
        const here = holeDirection(s.dip, s.azimuth);
        depths[i] = s.depth;
        directions.set(here, i * 3);
        if (i === 0) {
            positions.set(collar, 0);
        } else {
            const step = (s.depth - depths[i - 1]) / 2 * arcFactor(turnBetween(before, here));
            for (let k = 0; k < 3; k++) positions[i * 3 + k] = positions[(i - 1) * 3 + k] + step * (before[k] + here[k]);
        }
        before = here;
    }
    return { depths, positions, directions };
}

/** The last station at or above a depth, kept inside the stations that start a stretch of hole. */
function stationAbove(trace: HoleTrace, depth: number): number {
    const { depths } = trace;
    let lo = 0;
    let hi = depths.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (depths[mid] <= depth) lo = mid; else hi = mid - 1;
    }
    return Math.min(lo, Math.max(depths.length - 2, 0));
}

const triple = (a: Float64Array, i: number): Vec3 => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]];

/** Where the hole is, and the direction down it, at a depth. */
export function placeAt(trace: HoleTrace, depth: number): { position: Vec3; direction: Vec3 } {
    const { depths, positions, directions } = trace;
    const n = depths.length;
    const straight = (i: number) => {
        const p = triple(positions, i);
        const t = triple(directions, i);
        const along = depth - depths[i];
        return { position: [p[0] + along * t[0], p[1] + along * t[1], p[2] + along * t[2]] as Vec3, direction: t };
    };
    if (n < 2 || depth < depths[0]) return straight(0);
    if (depth > depths[n - 1]) return straight(n - 1);
    const i = stationAbove(trace, depth);
    const a = triple(directions, i);
    const b = triple(directions, i + 1);
    const along = depth - depths[i];
    const share = along / (depths[i + 1] - depths[i]);
    const turn = turnBetween(a, b);
    // The direction part of the way round the arc
    const bent = turn > STRAIGHT;
    const wa = bent ? Math.sin((1 - share) * turn) / Math.sin(turn) : 1 - share;
    const wb = bent ? Math.sin(share * turn) / Math.sin(turn) : share;
    const direction: Vec3 = [wa * a[0] + wb * b[0], wa * a[1] + wb * b[1], wa * a[2] + wb * b[2]];
    const step = along / 2 * arcFactor(share * turn);
    const p = triple(positions, i);
    return {
        position: [p[0] + step * (a[0] + direction[0]), p[1] + step * (a[1] + direction[1]), p[2] + step * (a[2] + direction[2])],
        direction,
    };
}

/** Where the hole is at a depth. */
export const positionAt = (trace: HoleTrace, depth: number): Vec3 => placeAt(trace, depth).position;

/** The unit direction down the hole at a depth. */
export const directionAt = (trace: HoleTrace, depth: number): Vec3 => placeAt(trace, depth).direction;

/**
 * The hole as a line to draw, from the collar to `end` metres down: its
 * stations, with more places between them wherever it turns by more than
 * `maxTurn` degrees from one to the next, so the line follows the arc.
 */
export function tracePolyline(trace: HoleTrace, end: number, maxTurn = 2): { depths: number[]; points: Vec3[] } {
    const { depths } = trace;
    const stops: number[] = [];
    const start = Math.min(depths[0], end);
    stops.push(start);
    for (let i = 0; i + 1 < depths.length && depths[i] < end; i++) {
        const from = Math.max(depths[i], start);
        const to = Math.min(depths[i + 1], end);
        if (to <= from) continue;
        const whole = turnBetween(triple(trace.directions, i), triple(trace.directions, i + 1)) / RAD;
        const turn = whole * (to - from) / (depths[i + 1] - depths[i]);
        // (less a hair: 20 degrees worked out from the directions is not exactly 20)
        const pieces = Math.min(Math.max(Math.ceil(turn / maxTurn - 1e-9), 1), 64);
        for (let k = 1; k <= pieces; k++) stops.push(from + (to - from) * k / pieces);
    }
    if (end > stops[stops.length - 1]) stops.push(end);
    return { depths: stops, points: stops.map(d => positionAt(trace, d)) };
}
