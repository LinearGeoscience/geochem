/**
 * Directions a surface runs in (pure, unit-tested): Leapfrog's ribbons.
 *
 * A node of a line may carry a direction that lies in the surface there
 * (`LineNode.direction`). With the line's own direction it says how the
 * surface lies at that node: the surface holds both. Along the line the
 * directions are blended from one directed node to the next, by how far along
 * the line each place is, and past the first and the last they are carried on
 * unchanged. At every place the blend is made square to the line there, so
 * it always says how the surface leaves the line, never along it.
 *
 * So a line has a ribbon (the surface's facing all along it) when it was
 * drawn on a slice (the surface crosses the slice: the slice's normal lies in
 * the surface) or when any of its nodes has a direction. Once a node has one,
 * the slice no longer counts for that line: the directions given say it all.
 *
 * A point may carry a direction too (`ScenePoint.direction`): the surface
 * contains that line at the point, turned about it as the rest of the
 * surface needs. It is given to the fit as two more places on the surface, a
 * short way either side of the point along the direction.
 */
import { cleanDirection } from './attitudes';
import { dot, unit } from './plane';
import { holdOffset, nearestOther } from './readings';
import { placeOfNode, shapeOf } from './splines';
import type { LineNode, Plane, ScenePoint, Vec3 } from './types';

/** A direction within this many degrees of the line it is on says nothing about how the surface leaves it */
export const RIBBON_MIN_DEGREES = 10;
const SIN_MIN = Math.sin(RIBBON_MIN_DEGREES * Math.PI / 180);
const COS_MIN = Math.cos(RIBBON_MIN_DEGREES * Math.PI / 180);

/** A directed node of a line, at its share (0-1) of the way along the line */
export interface RibbonKey {
    share: number;
    /** Unit; each the same way round as the one before */
    dir: Vec3;
    /** Its place in the line's nodes */
    vertex: number;
}

/** What ribbons.ts needs of a line */
export interface RibbonLine {
    points: readonly Vec3[];
    plane?: Plane | null;
    nodes?: readonly (LineNode | null)[];
    smooth?: boolean;
}

const sub = (a: ArrayLike<number>, b: ArrayLike<number>): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const distance = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const keyCache = new WeakMap<readonly (LineNode | null)[], { points: readonly Vec3[]; smooth: boolean; out: { keys: RibbonKey[]; ignored: number[] } }>();
const NONE = { keys: [] as RibbonKey[], ignored: [] as number[] };

/**
 * The directed nodes of a line, in order along it, and the nodes whose
 * direction runs along the line (within RIBBON_MIN_DEGREES) and so is not used.
 */
export function ribbonKeys(line: RibbonLine): { keys: RibbonKey[]; ignored: number[] } {
    const nodes = line.nodes;
    if (!nodes || !nodes.some(n => n?.direction)) return NONE;
    const cached = keyCache.get(nodes);
    if (cached && cached.points === line.points && cached.smooth === !!line.smooth) return cached.out;
    const path = shapeOf(line);
    const walked = new Float64Array(path.length);
    for (let k = 1; k < path.length; k++) walked[k] = walked[k - 1] + distance(path[k], path[k - 1]);
    const total = walked[path.length - 1] ?? 0;
    const keys: RibbonKey[] = [], ignored: number[] = [];
    if (total > 0) {
        nodes.forEach((node, i) => {
            const dir = node?.direction ? cleanDirection(node.direction) : null;
            if (!dir || i >= line.points.length) return;
            const k = placeOfNode(line, i);
            // The line's direction at the node: the mean of the two pieces it joins
            const before = k > 0 ? unit(sub(path[k], path[k - 1])) : null;
            const after = k + 1 < path.length ? unit(sub(path[k + 1], path[k])) : null;
            const run = before && after ? unit([before[0] + after[0], before[1] + after[1], before[2] + after[2]]) ?? after : before ?? after;
            if (!run || Math.abs(dot(dir, run)) > COS_MIN) { ignored.push(i); return; }
            const prev = keys[keys.length - 1];
            const turned: Vec3 = prev && dot(prev.dir, dir) < 0 ? [-dir[0], -dir[1], -dir[2]] : dir;
            keys.push({ share: walked[k] / total, dir: turned, vertex: i });
        });
    } else {
        nodes.forEach((node, i) => { if (node?.direction && i < line.points.length) ignored.push(i); });
    }
    const out = { keys, ignored };
    keyCache.set(nodes, { points: line.points, smooth: !!line.smooth, out });
    return out;
}

/**
 * The ribbon at a place `share` (0-1) of the way along a line whose
 * direction there is `t` (unit): the keys blended, made square to `t`, unit
 * length. Null when there are no keys, or the blend runs (nearly) along the line.
 */
export function ribbonAt(keys: readonly RibbonKey[], share: number, t: ArrayLike<number>): Vec3 | null {
    if (keys.length === 0) return null;
    let r: Vec3;
    if (share <= keys[0].share) r = keys[0].dir;
    else if (share >= keys[keys.length - 1].share) r = keys[keys.length - 1].dir;
    else {
        let j = 1;
        while (j < keys.length - 1 && keys[j].share < share) j++;
        const a = keys[j - 1], b = keys[j];
        const f = b.share > a.share ? (share - a.share) / (b.share - a.share) : 0;
        r = [a.dir[0] + (b.dir[0] - a.dir[0]) * f, a.dir[1] + (b.dir[1] - a.dir[1]) * f, a.dir[2] + (b.dir[2] - a.dir[2]) * f];
    }
    const len = Math.hypot(r[0], r[1], r[2]);
    if (!(len > 0)) return null;
    const along = dot(r, t);
    const square: Vec3 = [r[0] - along * t[0], r[1] - along * t[1], r[2] - along * t[2]];
    if (Math.hypot(square[0], square[1], square[2]) < SIN_MIN * len) return null;
    return unit(square);
}

/** The line has a ribbon: it was drawn on a slice, or one of its nodes has a direction that can be used */
export function isOrientedLine(line: RibbonLine): boolean {
    return !!line.plane || ribbonKeys(line).keys.length > 0;
}

/** Points with a direction, as the fit takes them (sheet.ts, SheetInput.directed) */
export interface DirectedSamples {
    positions: Float64Array;
    /** Unit, xyz triples */
    directions: Float64Array;
    /** How far either side of each point along its direction the surface is held */
    offsets: Float64Array;
}

/**
 * The points with a direction (and no reading: a reading says more) as the
 * fit takes them. `through` is every place the surface passes through (xyz
 * triples): each is held along its direction for a share of the way to the
 * nearest other one. Null when no point has a usable direction.
 */
export function pointDirectionSamples(points: readonly ScenePoint[], through: ArrayLike<number>): DirectedSamples | null {
    const used: { p: Vec3; d: Vec3 }[] = [];
    for (const point of points) {
        if (point.reading || !point.direction) continue;
        const d = cleanDirection(point.direction);
        if (d) used.push({ p: point.p, d });
    }
    if (used.length === 0) return null;
    const n = used.length;
    const out: DirectedSamples = { positions: new Float64Array(n * 3), directions: new Float64Array(n * 3), offsets: new Float64Array(n) };
    used.forEach(({ p, d }, i) => {
        out.positions.set(p, i * 3);
        out.directions.set(d, i * 3);
        out.offsets[i] = holdOffset(nearestOther(p, through));
    });
    return out;
}

/** What the panel says of a surface's directions */
export interface DirectionsSummary {
    /** Nodes whose direction is used, and points */
    nodes: number;
    points: number;
    /** Nodes whose direction runs along their line (not used), by line id */
    ignored: { line: string; vertex: number }[];
    /** Points whose reading wins over their direction */
    overruled: string[];
}

export function directionsSummary(points: readonly ScenePoint[], lines: readonly (RibbonLine & { id: string })[]): DirectionsSummary {
    const out: DirectionsSummary = { nodes: 0, points: 0, ignored: [], overruled: [] };
    for (const p of points) {
        if (!p.direction) continue;
        if (p.reading) out.overruled.push(p.id);
        else out.points++;
    }
    for (const line of lines) {
        const { keys, ignored } = ribbonKeys(line);
        out.nodes += keys.length;
        for (const vertex of ignored) out.ignored.push({ line: line.id, vertex });
    }
    return out;
}
