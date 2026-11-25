/**
 * How the lie of a surface is drawn where it was given (pure, unit-tested):
 * a dip reading as a disc in its plane, a node's direction as a bar along
 * the ribbon of its line, a point's direction as a bar through the point.
 * Each is a set of stretches (pairs of ends, local xyz: world minus the
 * view's origin), drawn with the lines of the surface being edited.
 */
import { ribbonAt, ribbonKeys, type RibbonLine } from '../../model/ribbons';
import { cleanDirection } from '../../model/attitudes';
import { unit } from '../../model/plane';
import { placeOfNode, shapeOf } from '../../model/splines';
import type { PointReading, ScenePoint, Vec3 } from '../../model/types';

/** A disc is drawn as this many stretches round */
export const DISC_SEGMENTS = 24;
/** A blended ribbon (between directed nodes) is drawn this much shorter than a given one */
const BLENDED = 0.6;

/** Along the strike and down the dip of a reading, unit */
export function readingAxes(r: PointReading): { strike: Vec3; down: Vec3 } {
    const a = r.dipDirection * Math.PI / 180, d = r.dip * Math.PI / 180;
    return {
        strike: [Math.cos(a), -Math.sin(a), 0],
        down: [Math.sin(a) * Math.cos(d), Math.cos(a) * Math.cos(d), -Math.sin(d)],
    };
}

/**
 * A reading at a place as a disc: a circle in its plane, its radius the
 * reading's reach (else `size`), a bar along its strike across it and a tick
 * from its middle down the dip.
 */
export function readingDisc(at: ArrayLike<number>, reading: PointReading, size: number, out: number[] = []): number[] {
    const r = reading.reach && reading.reach > 0 ? reading.reach : size;
    const { strike, down } = readingAxes(reading);
    const ring = (k: number): Vec3 => {
        const t = 2 * Math.PI * k / DISC_SEGMENTS, c = Math.cos(t), s = Math.sin(t);
        return [at[0] + r * (c * strike[0] + s * down[0]), at[1] + r * (c * strike[1] + s * down[1]), at[2] + r * (c * strike[2] + s * down[2])];
    };
    let prev = ring(0);
    for (let k = 1; k <= DISC_SEGMENTS; k++) {
        const next = ring(k);
        out.push(prev[0], prev[1], prev[2], next[0], next[1], next[2]);
        prev = next;
    }
    out.push(
        at[0] - r * strike[0], at[1] - r * strike[1], at[2] - r * strike[2], at[0] + r * strike[0], at[1] + r * strike[1], at[2] + r * strike[2],
        at[0], at[1], at[2], at[0] + r * down[0], at[1] + r * down[1], at[2] + r * down[2],
    );
    return out;
}

/** Every dip reading among these places (points, and the nodes of lines that carry one) as a disc. */
export function readingDiscs(places: readonly ScenePoint[], origin: ArrayLike<number>, size: number): number[] {
    const out: number[] = [];
    for (const { p, reading } of places) {
        if (reading) readingDisc([p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]], reading, size, out);
    }
    return out;
}

/** A bar through a place along a direction, `size` either way */
function bar(out: number[], at: ArrayLike<number>, d: ArrayLike<number>, size: number) {
    out.push(at[0] - size * d[0], at[1] - size * d[1], at[2] - size * d[2], at[0] + size * d[0], at[1] + size * d[1], at[2] + size * d[2]);
}

/**
 * The ribbon of every line with directions on its nodes: a bar across the
 * line at each node and half way between nodes, along the direction the
 * surface leaves the line there. Bars at the directed nodes are full size,
 * the blended ones shorter. Lines with no directions have none (their ticks
 * say how they lie).
 */
export function ribbonBars(lines: readonly RibbonLine[], origin: ArrayLike<number>, size: number): number[] {
    const out: number[] = [];
    for (const line of lines) {
        const { keys } = ribbonKeys(line);
        if (keys.length === 0) continue;
        const path = shapeOf(line);
        const walked = new Float64Array(path.length);
        for (let k = 1; k < path.length; k++) walked[k] = walked[k - 1] + Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1], path[k][2] - path[k - 1][2]);
        const total = walked[path.length - 1];
        if (!(total > 0)) continue;
        const given = new Set(keys.map(k => k.vertex));
        const runAt = (k: number): Vec3 | null => {
            const before = k > 0 ? unit([path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1], path[k][2] - path[k - 1][2]]) : null;
            const after = k + 1 < path.length ? unit([path[k + 1][0] - path[k][0], path[k + 1][1] - path[k][1], path[k + 1][2] - path[k][2]]) : null;
            return before && after ? unit([before[0] + after[0], before[1] + after[1], before[2] + after[2]]) ?? after : before ?? after;
        };
        const draw = (at: ArrayLike<number>, share: number, t: Vec3 | null, scale: number) => {
            const r = t && ribbonAt(keys, share, t);
            if (r) bar(out, [at[0] - origin[0], at[1] - origin[1], at[2] - origin[2]], r, size * scale);
        };
        for (let i = 0; i < line.points.length; i++) {
            const k = placeOfNode(line, i);
            draw(path[k], walked[k] / total, runAt(k), given.has(i) ? 1 : BLENDED);
            if (i + 1 >= line.points.length) continue;
            // Half way to the next node: on the path, or between two of its points
            const k2 = placeOfNode(line, i + 1);
            if (k2 - k >= 2) {
                const m = Math.floor((k + k2) / 2);
                draw(path[m], walked[m] / total, runAt(m), BLENDED);
            } else {
                const a = path[k], b = path[k2];
                draw([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], (walked[k] + walked[k2]) / (2 * total), unit([b[0] - a[0], b[1] - a[1], b[2] - a[2]]), BLENDED);
            }
        }
    }
    return out;
}

/** Every point with a direction (and no reading: a reading is drawn as a disc) as a bar through it. */
export function directionBars(points: readonly ScenePoint[], origin: ArrayLike<number>, size: number): number[] {
    const out: number[] = [];
    for (const { p, reading, direction } of points) {
        const d = !reading && direction ? cleanDirection(direction) : null;
        if (d) bar(out, [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]], d, size);
    }
    return out;
}
