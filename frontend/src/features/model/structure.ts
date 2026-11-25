/**
 * The structure of the ground as one direction of continuity, set by hand
 * (pure, unit-tested): a plane that things run along and, within it, a
 * direction they run furthest in.
 *
 * Surfaces that follow it are fitted in space stretched across it
 * (`Stretch`, rbf.ts): two places a set distance apart count as close when
 * that distance is along the structure and as far apart when it is across
 * it. A shell round high values then joins from hole to hole along the
 * structure and stays thin across it, where an even-handed fit gives a bead
 * round each hole.
 */
import { cross, normalFromDip, unit } from './plane';
import type { Stretch } from './rbf';
import type { OverallStructure, Vec3 } from './types';

export type { OverallStructure };

export const DEFAULT_STRENGTH = 4;
export const DEFAULT_LINE_STRENGTH = 2;
/** The most that along counts over across: beyond this a fit joins things that have nothing to do with each other */
export const MAX_STRENGTH = 8;
export const MAX_LINE_STRENGTH = 4;

const RAD = Math.PI / 180;
const turn = (v: number) => ((v % 360) + 360) % 360;
const within = (v: unknown, low: number, high: number, otherwise: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(high, Math.max(low, v)) : otherwise);

/** A structure as stored; null when it is unreadable or there is none. */
export function readStructure(raw: unknown): OverallStructure | null {
    const s = raw as Partial<OverallStructure> | null | undefined;
    if (!s || typeof s.dip !== 'number' || !Number.isFinite(s.dip) || typeof s.dipDirection !== 'number' || !Number.isFinite(s.dipDirection)) return null;
    return {
        dip: Math.min(90, Math.max(0, s.dip)),
        dipDirection: turn(s.dipDirection),
        lineTrend: typeof s.lineTrend === 'number' && Number.isFinite(s.lineTrend) ? turn(s.lineTrend) : null,
        strength: within(s.strength, 1, MAX_STRENGTH, DEFAULT_STRENGTH),
        lineStrength: within(s.lineStrength, 1, MAX_LINE_STRENGTH, DEFAULT_LINE_STRENGTH),
    };
}

export interface StructureAxes {
    /** Square to the plane, pointing up */
    normal: Vec3;
    /** The long direction in the plane, pointing down its plunge (null: none set, or the plane is level and the bearing is all there is) */
    line: Vec3 | null;
    /** In the plane, square to the long direction (null with no long direction) */
    across: Vec3 | null;
    /** How steeply the long direction plunges, degrees (null with no long direction) */
    plunge: number | null;
}

/**
 * The directions of a structure. The long direction is the line in the
 * plane that heads towards `lineTrend` on a map: on a vertical plane that
 * is only its strike, so there it runs level along the strike nearest that
 * bearing.
 */
export function structureAxes(s: OverallStructure): StructureAxes {
    const normal = normalFromDip(s.dip, s.dipDirection);
    if (s.lineTrend === null) return { normal, line: null, across: null, plunge: null };
    const t = s.lineTrend * RAD;
    const hx = Math.sin(t), hy = Math.cos(t);
    // A line heading that way on the map, at the height that keeps it in the plane
    let line: Vec3 | null = null;
    if (Math.abs(normal[2]) > 1e-6) {
        line = unit([hx, hy, -(normal[0] * hx + normal[1] * hy) / normal[2]]);
    } else {
        // Vertical plane: along its strike, the way nearest the bearing
        const strike: Vec3 = [-normal[1], normal[0], 0];
        line = unit(strike[0] * hx + strike[1] * hy >= 0 ? strike : [-strike[0], -strike[1], 0]);
    }
    if (!line) return { normal, line: null, across: null, plunge: null };
    // Pointing down, so that the plunge is the angle below level
    if (line[2] > 0) line = [-line[0], -line[1], -line[2]];
    const across = unit(cross(normal, line));
    const plunge = Math.asin(Math.min(1, Math.max(0, -line[2]))) / RAD;
    return { normal, line, across, plunge };
}

/**
 * Space as a fit that follows the structure sees it: distances across the
 * plane count `strength` times over and, with a long direction, distances
 * across it within the plane `lineStrength` times over. Null when neither
 * makes a difference.
 */
export function structureStretch(s: OverallStructure | null, point: Vec3): Stretch | null {
    if (!s) return null;
    const axes = structureAxes(s);
    const second = axes.across && s.lineStrength > 1 ? { normal: axes.across, factor: s.lineStrength } : null;
    if (!(s.strength > 1) && !second) return null;
    // Across the plane is never the easier way of the two
    const factor = Math.max(s.strength, second ? second.factor : 1);
    return { normal: axes.normal, point: [point[0], point[1], point[2]], factor, ...(second ? { second } : {}) };
}

const bearing = (v: number) => String(Math.round(turn(v)) % 360).padStart(3, '0');

/** The structure in words: "dipping 60° towards 090°, plunging 25° towards 135°". */
export function structureText(s: OverallStructure): string {
    const plane = s.dip < 0.5 ? 'level' : s.dip > 89.5 ? `vertical, striking ${bearing(s.dipDirection + 90)}°` : `dipping ${Math.round(s.dip)}° towards ${bearing(s.dipDirection)}°`;
    const axes = structureAxes(s);
    if (!axes.line || axes.plunge === null) return plane;
    const towards = (Math.atan2(axes.line[0], axes.line[1]) / RAD + 360) % 360;
    return `${plane}, ${axes.plunge < 0.5 ? `running level towards ${bearing(Math.hypot(axes.line[0], axes.line[1]) > 1e-9 ? towards : s.lineTrend ?? 0)}°` : `plunging ${Math.round(axes.plunge)}° towards ${bearing(towards)}°`}`;
}

/** A mark of the structure to draw in a view */
export interface StructureMark {
    /** xyz triples (world) */
    vertices: Float64Array;
    triangles: Uint32Array;
    /** Pairs of vertices joined by a line */
    lines: Uint32Array;
}

const AROUND = 28, UP = 12;

/**
 * The structure drawn as the shape a fit that follows it gives equal
 * weight to: a ball `size` across along the structure, squeezed across it
 * by as much as along counts over across. Through its middle, a line down
 * the dip and, when there is a long direction, a longer one along that.
 */
export function structureMark(s: OverallStructure, centre: Vec3, size: number): StructureMark {
    const axes = structureAxes(s);
    const n = axes.normal;
    const a = s.dipDirection * RAD, d = s.dip * RAD;
    const down: Vec3 = [Math.sin(a) * Math.cos(d), Math.cos(a) * Math.cos(d), -Math.sin(d)];
    const u = axes.line ?? down;
    const v = axes.across ?? unit(cross(n, u)) ?? [1, 0, 0];
    const long = axes.line && s.lineStrength > 1 ? s.lineStrength : 1;
    const half = size / 2;
    const radii = [half, half / long, half / Math.max(s.strength, long, 1)];
    const at = (x: number, y: number, z: number): Vec3 => [
        centre[0] + x * u[0] + y * v[0] + z * n[0], centre[1] + x * u[1] + y * v[1] + z * n[1], centre[2] + x * u[2] + y * v[2] + z * n[2],
    ];
    const vertices: number[] = [], triangles: number[] = [], lines: number[] = [];
    // Rings from one pole (across the structure) to the other
    for (let i = 0; i <= UP; i++) {
        const lat = Math.PI * (i / UP - 0.5);
        for (let j = 0; j < AROUND; j++) {
            const lon = 2 * Math.PI * j / AROUND;
            vertices.push(...at(radii[0] * Math.cos(lat) * Math.cos(lon), radii[1] * Math.cos(lat) * Math.sin(lon), radii[2] * Math.sin(lat)));
        }
    }
    for (let i = 0; i < UP; i++) for (let j = 0; j < AROUND; j++) {
        const p = i * AROUND + j, q = i * AROUND + (j + 1) % AROUND;
        triangles.push(p, q, p + AROUND, q, q + AROUND, p + AROUND);
    }
    const line = (from: Vec3, to: Vec3) => {
        const k = vertices.length / 3;
        vertices.push(...from, ...to);
        lines.push(k, k + 1);
    };
    // Down the dip, from the middle to a little past the edge
    const reachOf = (dir: Vec3) => {
        const x = dir[0] * u[0] + dir[1] * u[1] + dir[2] * u[2], y = dir[0] * v[0] + dir[1] * v[1] + dir[2] * v[2];
        return 1 / Math.hypot(x / radii[0], y / radii[1]);
    };
    const dipTo = 1.25 * reachOf(down);
    line(centre, [centre[0] + dipTo * down[0], centre[1] + dipTo * down[1], centre[2] + dipTo * down[2]]);
    // Along the long direction, right through and out both ends
    if (axes.line) line(at(-1.5 * radii[0], 0, 0), at(1.5 * radii[0], 0, 0));
    return { vertices: Float64Array.from(vertices), triangles: Uint32Array.from(triangles), lines: Uint32Array.from(lines) };
}
