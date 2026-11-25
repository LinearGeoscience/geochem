/**
 * What a surface was built from, written out so it can be built again in
 * other software (pure, unit-tested; each format reads back through the
 * readers in this file, importShapes.ts or the viewer's wireframe parsers).
 *
 * - points as CSV, with the drillhole and depth of those placed on a hole;
 * - dip readings as CSV, with which way up each is (polarity);
 * - lines as 3D DXF polylines, GOCAD PLine, Surpac strings and CSV;
 * - points, lines and what is known at their nodes as a Leapfrog polyline
 *   file (.lfpl), which holds them together as Leapfrog draws them.
 *
 * Coordinates in text are written to a tenth of a millimetre; the Leapfrog
 * file is binary and exact.
 *
 * The .lfpl layout was read off a file saved by Leapfrog (a line drawn on
 * the slicer, with a tangent at a node, and a point with a normal):
 *
 *   81 82 83 84 "LF3DPolyline-1.0", 8 zero bytes, 0D 0A 1A 0A
 *   per line:   "path" "2dim" nx ny nz d (the plane it was drawn on: n.p = d)
 *               count (int32)
 *               "node" x y z ["ntan" tx ty tz]  then, before each next node,
 *               "curv" a b: the curve's two handles, each from its own node
 *               (both zero: a straight stretch)
 *   per point:  "pnt " x y z ["pnml" nx ny nz]
 *
 * (all numbers little-endian, 8-byte floats). A tangent is a direction the
 * surface runs in at the node, other than along the line (here: the node's
 * direction, ribbons.ts); a normal is square to the surface.
 *
 * A smooth line (splines.ts) is written with its curve's handles, and its
 * shape is written point by point to the formats that keep no curves.
 */
import { bestFitPlane, dipFromNormal, normalFromDip } from './plane';
import { cleanReading } from './readings';
import { bezierAt, catmullRomHandles, handlesDeviation, shapeOf } from './splines';
import type { LineNode, Plane, PointReading, Vec3 } from './types';

/** A point of a surface, as written out */
export interface OutPoint {
    p: Vec3;
    hole?: string;
    depth?: number;
    reading?: PointReading;
    /** Where it came from ('placed' by hand, 'logged' in a drillhole, ...) */
    source?: string;
}

/** A line of a surface, as written out */
export interface OutLine {
    name: string;
    points: Vec3[];
    plane: Plane | null;
    nodes?: (LineNode | null)[];
    /** It runs as a smooth curve through its nodes */
    smooth?: boolean;
}

/** A line's shape as straight pieces (the curve of a smooth one, its nodes otherwise), for formats that keep no curves */
const shapePieces = (line: OutLine): readonly Vec3[] => shapeOf(line);

const num = (v: number) => String(Math.round(v * 1e4) / 1e4);
const cell = (v: string | number | undefined) => {
    if (v === undefined) return '';
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const safe = (name: string, fallback: string) => name.trim().replace(/[^A-Za-z0-9_$-]+/g, '_').replace(/^_+|_+$/g, '') || fallback;
const degrees = (v: number) => String(Math.round(v * 100) / 100);

/** Which way up a reading is, as structural data tables have it: 1 the right way up, -1 overturned */
const polarity = (r: PointReading) => (r.overturned ? -1 : 1);

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** The points a surface passes through: X, Y, Z, and the drillhole and depth of those placed on one. */
export function pointsCsv(points: readonly OutPoint[]): string {
    const out = ['X,Y,Z,Hole,Depth,Source'];
    for (const q of points) out.push([num(q.p[0]), num(q.p[1]), num(q.p[2]), cell(q.hole), q.depth === undefined ? '' : num(q.depth), cell(q.source)].join(','));
    return out.join('\n') + '\n';
}

/** Where the lie of the surface was measured: place, dip, dip azimuth, polarity (1, or -1 for an overturned reading) and how far it holds (Reach, m; blank: worked out). */
export function readingsCsv(points: readonly OutPoint[]): string {
    const out = ['X,Y,Z,Dip,Dip Azimuth,Polarity,Hole,Depth,Source,Reach'];
    for (const q of points) {
        if (!q.reading) continue;
        out.push([
            num(q.p[0]), num(q.p[1]), num(q.p[2]), degrees(q.reading.dip), degrees(q.reading.dipDirection), polarity(q.reading), cell(q.hole), q.depth === undefined ? '' : num(q.depth), cell(q.source),
            q.reading.reach ? num(q.reading.reach) : '',
        ].join(','));
    }
    return out.join('\n') + '\n';
}

/**
 * Lines, a row a node: the line's name, the node's number, its place, and
 * what is known there (a dip tick; a direction the surface runs in, as a
 * plunge and the bearing it plunges towards). A smooth line has rows along
 * its curve between its nodes too, with no node number.
 */
export function linesCsv(lines: readonly OutLine[]): string {
    const out = ['Line,Node,X,Y,Z,Hole,Depth,Dip,Dip Azimuth,Polarity,Plunge,Plunge Azimuth,Smooth'];
    lines.forEach((line, k) => {
        const name = cell(line.name || `Line ${k + 1}`);
        const pieces = shapePieces(line);
        const per = pieces === line.points ? 1 : (pieces.length - 1) / Math.max(1, line.points.length - 1);
        pieces.forEach((p, j) => {
            const i = j / per;
            const isNode = Number.isInteger(i);
            const node = isNode ? line.nodes?.[i] ?? null : null;
            const along = node?.direction ? plungeOfDirection(node.direction) : null;
            out.push([
                name, isNode ? i + 1 : '', num(p[0]), num(p[1]), num(p[2]), cell(node?.snap?.hole), node?.snap ? num(node.snap.depth) : '',
                node?.reading ? degrees(node.reading.dip) : '', node?.reading ? degrees(node.reading.dipDirection) : '', node?.reading ? polarity(node.reading) : '',
                along ? degrees(along.plunge) : '', along ? degrees(along.trend) : '', line.smooth ? 1 : '',
            ].join(','));
        });
    });
    return out.join('\n') + '\n';
}

/** A direction as a plunge (down from level) and the bearing it plunges towards */
function plungeOfDirection(v: ArrayLike<number>): { plunge: number; trend: number } | null {
    const n = Math.hypot(v[0], v[1], v[2]);
    if (!(n > 1e-12)) return null;
    let d = [v[0] / n, v[1] / n, v[2] / n];
    if (d[2] > 0 || (d[2] === 0 && (d[0] < 0 || (d[0] === 0 && d[1] < 0)))) d = [-d[0], -d[1], -d[2]];
    const plunge = Math.asin(Math.min(1, -d[2])) * 180 / Math.PI;
    const trend = Math.hypot(d[0], d[1]) < 1e-9 ? 0 : ((Math.atan2(d[0], d[1]) * 180 / Math.PI) % 360 + 360) % 360;
    return { plunge, trend };
}

/** A point with a direction the surface runs along there, as written out */
export interface OutDirection {
    p: Vec3;
    direction: Vec3;
    hole?: string;
    depth?: number;
    source?: string;
}

/** Directions the surface runs in (lineations), a row each: place, plunge and the bearing it plunges towards. */
export function directionsCsv(rows: readonly OutDirection[]): string {
    const out = ['X,Y,Z,Plunge,Plunge Azimuth,Hole,Depth,Source'];
    for (const q of rows) {
        const along = plungeOfDirection(q.direction);
        if (!along) continue;
        out.push([num(q.p[0]), num(q.p[1]), num(q.p[2]), degrees(along.plunge), degrees(along.trend), cell(q.hole), q.depth === undefined ? '' : num(q.depth), cell(q.source)].join(','));
    }
    return out.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// DXF, GOCAD, Surpac
// ---------------------------------------------------------------------------

/** ASCII DXF: each line a 3D polyline on a layer of its own name; `closed` joins each one's last node to its first. */
export function linesDxf(lines: readonly OutLine[], closed = false): string {
    const out: string[] = ['0', 'SECTION', '2', 'ENTITIES'];
    lines.forEach((line, k) => {
        const layer = safe(line.name, `line_${k + 1}`);
        // 70: 8 = a 3D polyline (+1: closed); each vertex 70: 32
        out.push('0', 'POLYLINE', '8', layer, '66', '1', '70', closed ? '9' : '8', '10', '0', '20', '0', '30', '0');
        for (const p of shapePieces(line)) out.push('0', 'VERTEX', '8', layer, '10', num(p[0]), '20', num(p[1]), '30', num(p[2]), '70', '32');
        out.push('0', 'SEQEND', '8', layer);
    });
    out.push('0', 'ENDSEC', '0', 'EOF');
    return out.join('\n') + '\n';
}

/** GOCAD PLine: an object a line. */
export function linesGocad(lines: readonly OutLine[]): string {
    const out: string[] = [];
    lines.forEach((line, k) => {
        out.push('GOCAD PLine 1', 'HEADER {', `name:${safe(line.name, `line_${k + 1}`)}`, '}', 'ILINE');
        const pieces = shapePieces(line);
        pieces.forEach((p, i) => out.push(`VRTX ${i + 1} ${num(p[0])} ${num(p[1])} ${num(p[2])}`));
        for (let i = 1; i < pieces.length; i++) out.push(`SEG ${i} ${i + 1}`);
        out.push('END');
    });
    return out.join('\n') + '\n';
}

/** Surpac string file: a string number a line, each node as string, northing, easting, elevation. */
export function linesSurpac(lines: readonly OutLine[], title = 'lines'): string {
    const out: string[] = [`${safe(title, 'lines')}, , ,`, '0, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000'];
    lines.forEach((line, k) => {
        for (const p of shapePieces(line)) out.push(`${k + 1}, ${num(p[1])}, ${num(p[0])}, ${num(p[2])}, `);
        out.push('0, 0.000, 0.000, 0.000,');
    });
    out.push('0, 0.000, 0.000, 0.000, END');
    return out.join('\n') + '\n';
}

/** The lines of a Surpac string file (north, east, elevation are put back in order). */
export function linesFromSurpac(text: string): Vec3[][] {
    const lines: Vec3[][] = [];
    let current: Vec3[] = [], string = '';
    const close = () => { if (current.length >= 2) lines.push(current); current = []; };
    for (const raw of text.split(/\r?\n/).slice(2)) {
        const f = raw.split(',').map(s => s.trim());
        if (f.length < 4 || f[0] === '') continue;
        if (f[0] === '0') { close(); string = ''; continue; }
        const p: Vec3 = [Number(f[2]), Number(f[1]), Number(f[3])];
        if (!p.every(Number.isFinite)) continue;
        if (f[0] !== string) { close(); string = f[0]; }
        current.push(p);
    }
    close();
    return lines;
}

// ---------------------------------------------------------------------------
// Leapfrog polyline file (.lfpl)
// ---------------------------------------------------------------------------

const LFPL_HEAD = [0x81, 0x82, 0x83, 0x84, ...Array.from('LF3DPolyline-1.0', c => c.charCodeAt(0)), 0, 0, 0, 0, 0, 0, 0, 0, 0x0d, 0x0a, 0x1a, 0x0a];

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unitOf = (v: Vec3): Vec3 | null => {
    const n = Math.hypot(v[0], v[1], v[2]);
    return n > 1e-12 ? [v[0] / n, v[1] / n, v[2] / n] : null;
};

/** The way a line runs at one of its nodes (from the node before to the node after). */
function runAt(points: readonly Vec3[], i: number): Vec3 | null {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    return unitOf([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
}

/** The normal of a measured plane, upwards, or downwards for an overturned reading. */
function readingNormal(r: PointReading): Vec3 {
    const n = normalFromDip(r.dip, r.dipDirection);
    const up: Vec3 = n[2] < 0 ? [-n[0], -n[1], -n[2]] : [n[0], n[1], n[2]];
    return r.overturned ? [-up[0], -up[1], -up[2]] : up;
}

/**
 * Lines and points as a Leapfrog polyline file. A node's direction goes as
 * its tangent, exactly; a dip reading at a node with no direction goes as the
 * tangent too (the direction the measured plane runs in, square to the line
 * as near as it can be); a reading at a point as the point's normal (its
 * reach is not kept: the format has no place for it). A smooth line is written
 * with its curve's handles. A line in space is given the plane that fits it
 * best (the format has a drawing plane for every line).
 */
export function shapesToLfpl(lines: readonly OutLine[], points: readonly OutPoint[] = []): Uint8Array {
    let size = LFPL_HEAD.length;
    const usable = lines.filter(l => l.points.length >= 2);
    for (const line of usable) {
        size += 8 + 32 + 4 + line.points.length * 28 + (line.points.length - 1) * 52;
        size += 28 * (line.nodes?.slice(0, line.points.length).filter(n => n?.reading || n?.direction).length ?? 0);
    }
    for (const q of points) size += 28 + (q.reading ? 28 : 0);
    const bytes = new Uint8Array(size);
    const view = new DataView(bytes.buffer);
    bytes.set(LFPL_HEAD);
    let at = LFPL_HEAD.length;
    const tag = (t: string) => { for (let i = 0; i < 4; i++) bytes[at++] = t.charCodeAt(i); };
    const f64 = (...values: number[]) => { for (const v of values) { view.setFloat64(at, v, true); at += 8; } };

    for (const line of usable) {
        const plane = line.plane ?? fittedPlane(line.points);
        const n = unitOf(plane.normal) ?? [0, 0, 1];
        tag('path');
        tag('2dim');
        f64(n[0], n[1], n[2], n[0] * plane.point[0] + n[1] * plane.point[1] + n[2] * plane.point[2]);
        view.setInt32(at, line.points.length, true);
        at += 4;
        const handles = line.smooth && line.points.length >= 3 ? catmullRomHandles(line.points) : null;
        line.points.forEach((p, i) => {
            if (i > 0) {
                tag('curv');
                const h = handles?.[i - 1];
                if (h) f64(h[0][0], h[0][1], h[0][2], h[1][0], h[1][1], h[1][2]);
                else f64(0, 0, 0, 0, 0, 0);
            }
            tag('node');
            f64(p[0], p[1], p[2]);
            const direction = line.nodes?.[i]?.direction;
            const reading = direction ? undefined : line.nodes?.[i]?.reading;
            const run = reading ? runAt(line.points, i) : null;
            if (direction) {
                tag('ntan');
                f64(direction[0], direction[1], direction[2]);
            } else if (reading && run) {
                const normal = readingNormal(reading);
                // In the measured plane and square to the line; where the line runs square to the plane, down its dip
                const tangent = unitOf(cross(normal, run)) ?? unitOf(cross(normal, cross([0, 0, 1], normal))) ?? [1, 0, 0];
                tag('ntan');
                f64(tangent[0], tangent[1], tangent[2]);
            } else if (reading) {
                // (Kept in step with the size worked out above)
                tag('ntan');
                f64(1, 0, 0);
            }
        });
    }
    for (const q of points) {
        tag('pnt ');
        f64(q.p[0], q.p[1], q.p[2]);
        if (q.reading) {
            const normal = readingNormal(q.reading);
            tag('pnml');
            f64(normal[0], normal[1], normal[2]);
        }
    }
    return bytes;
}

function fittedPlane(points: readonly Vec3[]): Plane {
    const fit = bestFitPlane(points.flatMap(p => p));
    return fit ? { normal: fit.normal, point: fit.point } : { normal: [0, 0, 1], point: points[0] };
}

/** What a Leapfrog polyline file holds */
export interface LfplShapes {
    /**
     * `curved`: it had curved stretches, and comes back smooth (`smooth`).
     * `added`: nodes put in along curves that are not the smooth curve
     * through its nodes, so that it keeps to Leapfrog's curve.
     */
    lines: { points: Vec3[]; plane: Plane; nodes?: (LineNode | null)[]; curved: boolean; smooth?: true; added?: number }[];
    points: { p: Vec3; reading?: PointReading }[];
}

/** A curve from a file is taken as the smooth curve through its nodes while it is no further from it than this share of a stretch */
export const CURVE_TOLERANCE = 0.02;

/** A plane's reading, the right way up or (its normal pointing down) overturned. */
function readingOf(normal: Vec3): PointReading | null {
    const { dip, dipDirection } = dipFromNormal(normal);
    const reading = cleanReading({ dip, dipDirection });
    return reading ? { ...reading, ...(normal[2] < -1e-9 ? { overturned: true } : {}) } : null;
}

/**
 * Lines and points from a Leapfrog polyline file. A node's tangent comes
 * back as its direction, exactly; a point's normal as a dip reading. A line
 * with curved stretches comes back smooth; where Leapfrog's curve is not the
 * smooth curve through its nodes, nodes are put in along it until it is near
 * enough. Throws when it is not such a file.
 */
export function shapesFromLfpl(buf: ArrayBuffer | Uint8Array): LfplShapes {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const name = String.fromCharCode(...bytes.subarray(4, 16));
    if (bytes.length < LFPL_HEAD.length || name !== 'LF3DPolyline') throw new Error('Not a Leapfrog polyline file (.lfpl).');
    let at = LFPL_HEAD.length;
    const tagAt = () => (at + 4 <= bytes.length ? String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]) : '');
    const vec = (): Vec3 => {
        if (at + 24 > bytes.length) throw new Error('The Leapfrog polyline file ends part way through.');
        const v: Vec3 = [view.getFloat64(at, true), view.getFloat64(at + 8, true), view.getFloat64(at + 16, true)];
        at += 24;
        return v;
    };
    const out: LfplShapes = { lines: [], points: [] };
    let line: { points: Vec3[]; plane: Plane; tangents: (Vec3 | null)[]; handles: [Vec3, Vec3][]; curved: boolean } | null = null;
    const close = () => {
        if (line && line.points.length >= 2) {
            const { points, tangents, handles, curved } = line;
            let shape = points, nodes: (LineNode | null)[] = tangents.map(t => (t ? { direction: t } : null));
            let added = 0;
            // A line curved all along is taken as smooth; one with straight stretches as well keeps them straight
            const zero = (h: [Vec3, Vec3]) => Math.hypot(...h[0]) + Math.hypot(...h[1]) <= 1e-9;
            const smooth = curved && points.length >= 3 && handles.length >= points.length - 1 && !handles.some(zero);
            if (curved) {
                // Stretches far from how the line is drawn here (the smooth curve through its nodes, or straight) get
                // nodes along Leapfrog's curve, until none is
                for (let tries = 0; tries < 6; tries++) {
                    const own = handlesFor(shape, handles);
                    const off = smooth ? handlesDeviation(shape, own) : own.map((h, k) => chordDeviation(shape[k], h, shape[k + 1]));
                    if (!off.some(v => v > CURVE_TOLERANCE)) break;
                    const nextShape: Vec3[] = [], nextNodes: (LineNode | null)[] = [];
                    for (let k = 0; k < shape.length; k++) {
                        nextShape.push(shape[k]);
                        nextNodes.push(nodes[k] ?? null);
                        if (k + 1 < shape.length && off[k] > CURVE_TOLERANCE) {
                            nextShape.push(bezierAt(shape[k], own[k][0], own[k][1], shape[k + 1], 0.5));
                            nextNodes.push(null);
                            added++;
                        }
                    }
                    // Halves of a Bezier are Beziers: the handles of each half, for the next round
                    handles.splice(0, handles.length, ...splitHandles(shape, own, off));
                    shape = nextShape;
                    nodes = nextNodes;
                }
            }
            out.lines.push({
                points: shape, plane: line.plane, curved, ...(nodes.some(Boolean) ? { nodes } : {}),
                ...(smooth ? { smooth: true as const } : {}), ...(added > 0 ? { added } : {}),
            });
        }
        line = null;
    };
    while (at + 4 <= bytes.length) {
        const tag = tagAt();
        at += 4;
        if (tag === 'path') { close(); continue; }
        if (tag === '2dim') {
            const n = vec();
            const d = view.getFloat64(at, true);
            at += 8 + 4;
            line = { points: [], plane: { normal: n, point: [n[0] * d, n[1] * d, n[2] * d] }, tangents: [], handles: [], curved: false };
            continue;
        }
        if (tag === 'node' && line) { line.points.push(vec()); line.tangents.push(null); continue; }
        if (tag === 'ntan' && line && line.tangents.length > 0) {
            const t = vec();
            // (Kept exactly as written when it is a unit direction)
            line.tangents[line.tangents.length - 1] = Math.abs(Math.hypot(t[0], t[1], t[2]) - 1) < 1e-12 ? t : unitOf(t);
            continue;
        }
        if (tag === 'curv' && line) {
            const a = vec(), b = vec();
            if (Math.hypot(...a) + Math.hypot(...b) > 1e-9) line.curved = true;
            line.handles.push([a, b]);
            continue;
        }
        if (tag === 'pnt ') { close(); out.points.push({ p: vec() }); continue; }
        if (tag === 'pnml' && out.points.length > 0) {
            const reading = readingOf(unitOf(vec()) ?? [0, 0, 1]);
            if (reading) out.points[out.points.length - 1].reading = reading;
            continue;
        }
        throw new Error(`The Leapfrog polyline file has a part this reader does not know ("${tag.replace(/[^\x20-\x7e]/g, '?')}").`);
    }
    close();
    return out;
}

/** The handles of each stretch of `shape`, as read (zero handles for a stretch with none) */
function handlesFor(shape: readonly Vec3[], handles: readonly [Vec3, Vec3][]): [Vec3, Vec3][] {
    return shape.slice(1).map((_, s) => handles[s] ?? [[0, 0, 0], [0, 0, 0]]);
}

/** Each stretch's handles, with those cut in two (`off` above the tolerance) as the handles of their two halves (de Casteljau) */
function splitHandles(shape: readonly Vec3[], handles: readonly [Vec3, Vec3][], off: readonly number[]): [Vec3, Vec3][] {
    const out: [Vec3, Vec3][] = [];
    for (let s = 0; s + 1 < shape.length; s++) {
        const [ha, hb] = handles[s];
        if (!(off[s] > CURVE_TOLERANCE)) { out.push([ha, hb]); continue; }
        const a = shape[s], b = shape[s + 1];
        const p1: Vec3 = [a[0] + ha[0], a[1] + ha[1], a[2] + ha[2]], p2: Vec3 = [b[0] + hb[0], b[1] + hb[1], b[2] + hb[2]];
        const mid = (u: Vec3, v: Vec3): Vec3 => [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2, (u[2] + v[2]) / 2];
        const q0 = mid(a, p1), q1 = mid(p1, p2), q2 = mid(p2, b), r0 = mid(q0, q1), r1 = mid(q1, q2), m = mid(r0, r1);
        const less = (u: Vec3, v: Vec3): Vec3 => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
        out.push([less(q0, a), less(r0, m)], [less(r1, m), less(q2, b)]);
    }
    return out;
}

/** How far, at most, a Bezier stretch from a to b runs from the straight line between them, as a share of its length */
function chordDeviation(a: Vec3, h: [Vec3, Vec3], b: Vec3): number {
    const span = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (!(span > 0)) return 0;
    let worst = 0;
    for (let k = 1; k < 16; k++) {
        const p = bezierAt(a, h[0], h[1], b, k / 16);
        const t = Math.min(1, Math.max(0, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1]) + (p[2] - a[2]) * (b[2] - a[2])) / (span * span)));
        worst = Math.max(worst, Math.hypot(p[0] - a[0] - (b[0] - a[0]) * t, p[1] - a[1] - (b[1] - a[1]) * t, p[2] - a[2] - (b[2] - a[2]) * t));
    }
    return worst / span;
}
