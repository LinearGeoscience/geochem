/**
 * The places and links put on a surface by hand (its rule's `control.marks`), as things to see, list, pick and
 * change (pure, unit-tested). A link is a place held along the line to a second place (`to`); on an intrusion a
 * place held outside by a distance is a cut.
 *
 * Drawn: a place is a dot; a link its line with a dot at each end, so either end can be taken hold of. Picked on
 * the screen by the nearest dot within a few pixels, else the nearest link line.
 */
import type { SideMark, Vec3 } from './types';
import { ALONG_MOST } from './contactControl';

export type ControlKind = 'link' | 'place' | 'cut';

export const KIND_NAMES: Record<ControlKind, string> = { link: 'Link', place: 'Place', cut: 'Cut' };

export interface ControlRow {
    id: string;
    /** Its place in the order they were put down, from 1 */
    n: number;
    kind: ControlKind;
    side: 1 | -1;
    p: Vec3;
    to?: Vec3;
    /** A link's length, m (0: a place) */
    length: number;
    by?: number;
    along?: number;
    /** The level of its middle, m */
    z: number;
}

/** What kind of control a mark is: on an intrusion (`lenses`) a place held outside by a distance is a cut */
export const kindOf = (m: SideMark, lenses: boolean): ControlKind => (m.to ? 'link' : lenses && m.side < 0 && m.by ? 'cut' : 'place');

export function controlRows(marks: readonly SideMark[] | undefined, lenses: boolean): ControlRow[] {
    return (marks ?? []).map((m, i) => ({
        id: m.id, n: i + 1, kind: kindOf(m, lenses), side: m.side, p: m.p,
        ...(m.to ? { to: m.to } : {}),
        length: m.to ? Math.hypot(m.to[0] - m.p[0], m.to[1] - m.p[1], m.to[2] - m.p[2]) : 0,
        ...(m.by ? { by: m.by } : {}), ...(m.along ? { along: m.along } : {}),
        z: m.to ? (m.p[2] + m.to[2]) / 2 : m.p[2],
    }));
}

export type ControlSort = 'placed' | 'length' | 'level' | 'takes';
export type KindFilter = 'all' | ControlKind;

/**
 * The rows shown: of a kind (or all), sorted. `takes` (by id): how many logged pieces each puts on the other side;
 * sorted by it the most first. Placed: the last put down first. Level: the highest first. Length: the longest first.
 */
export function shownRows(rows: readonly ControlRow[], kind: KindFilter, sort: ControlSort, takes?: ReadonlyMap<string, number>): ControlRow[] {
    const out = rows.filter(r => kind === 'all' || r.kind === kind);
    const by: Record<ControlSort, (a: ControlRow, b: ControlRow) => number> = {
        placed: (a, b) => b.n - a.n,
        length: (a, b) => b.length - a.length || b.n - a.n,
        level: (a, b) => b.z - a.z || b.n - a.n,
        takes: (a, b) => (takes?.get(b.id) ?? 0) - (takes?.get(a.id) ?? 0) || b.n - a.n,
    };
    return out.sort(by[sort]);
}

/** How a control is drawn: a dot a place, and a link's line with a dot at each end; each dot and line knows its mark */
export interface ControlDrawing {
    /** Local xyz (less `origin`), 3 numbers a dot */
    dots: Float32Array;
    dotSide: Int8Array;
    /** The mark each dot is of, and which end of it (`p` or `to`) */
    dotOf: string[];
    dotEnd: ('p' | 'to')[];
    /** Local xyz, 6 numbers a link */
    links: Float32Array;
    linkSide: Int8Array;
    linkOf: string[];
}

export function controlDrawing(marks: readonly SideMark[] | undefined, origin: ArrayLike<number>): ControlDrawing {
    const dots: number[] = [], dotSide: number[] = [], dotOf: string[] = [], dotEnd: ('p' | 'to')[] = [];
    const links: number[] = [], linkSide: number[] = [], linkOf: string[] = [];
    const local = (p: Vec3) => [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
    for (const m of marks ?? []) {
        dots.push(...local(m.p)); dotSide.push(m.side); dotOf.push(m.id); dotEnd.push('p');
        if (m.to) {
            dots.push(...local(m.to)); dotSide.push(m.side); dotOf.push(m.id); dotEnd.push('to');
            links.push(...local(m.p), ...local(m.to)); linkSide.push(m.side); linkOf.push(m.id);
        }
    }
    return {
        dots: Float32Array.from(dots), dotSide: Int8Array.from(dotSide), dotOf, dotEnd,
        links: Float32Array.from(links), linkSide: Int8Array.from(linkSide), linkOf,
    };
}

/** A dot is taken within this many pixels of the cursor ... */
export const DOT_PX = 9;
/** ... and a link's line within this many, where no dot is */
export const LINE_PX = 6;

/** What is under the cursor: a dot (its index) or a link's line (its index, and how far along it, 0 to 1) */
export type ControlHit = { dot: number; link?: undefined; t?: undefined } | { link: number; t: number; dot?: undefined };

/**
 * The control under the cursor. `dotsXY`: 2 numbers a dot on the screen, NaN where it is not seen; `linksXY`: 4 a
 * link (its two ends on the screen); `seenAt(link, t)`: whether that place along a link is seen (the slices cut a
 * link, so its line is picked only where it is drawn). Null: none.
 */
export function controlAt(
    dotsXY: ArrayLike<number>, linksXY: ArrayLike<number>, cursor: [number, number],
    seenAt: (link: number, t: number) => boolean = () => true,
): ControlHit | null {
    let best = -1, near = DOT_PX * DOT_PX;
    for (let i = 0; i * 2 + 1 < dotsXY.length; i++) {
        const dx = dotsXY[i * 2] - cursor[0], dy = dotsXY[i * 2 + 1] - cursor[1];
        const d = dx * dx + dy * dy;
        if (d <= near) { near = d; best = i; }
    }
    if (best >= 0) return { dot: best };
    let link = -1, at = 0, nearL = LINE_PX * LINE_PX;
    for (let i = 0; i * 4 + 3 < linksXY.length; i++) {
        const t = alongSegment(linksXY, i, cursor);
        if (t === null) continue;
        const x = linksXY[i * 4] + t * (linksXY[i * 4 + 2] - linksXY[i * 4]);
        const y = linksXY[i * 4 + 1] + t * (linksXY[i * 4 + 3] - linksXY[i * 4 + 1]);
        const d = (x - cursor[0]) ** 2 + (y - cursor[1]) ** 2;
        if (d <= nearL && seenAt(i, t)) { nearL = d; link = i; at = t; }
    }
    return link >= 0 ? { link, t: at } : null;
}

/** How far along a link's line on the screen the place nearest the cursor is (0 to 1); null when the ends are not on the screen */
function alongSegment(xy: ArrayLike<number>, i: number, c: [number, number]): number | null {
    const x0 = xy[i * 4], y0 = xy[i * 4 + 1], x1 = xy[i * 4 + 2], y1 = xy[i * 4 + 3];
    if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
    const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy;
    if (l2 < 1e-9) return 0;
    return Math.min(1, Math.max(0, ((c[0] - x0) * dx + (c[1] - y0) * dy) / l2));
}

/**
 * The marks with a dot inside a box on the screen (x0, y0, x1, y1 in any order), or a link that crosses it at
 * either end: what a box drawn round them picks.
 */
export function controlsInBox(drawing: Pick<ControlDrawing, 'dotOf'>, dotsXY: ArrayLike<number>, box: [number, number, number, number]): string[] {
    const [xa, ya, xb, yb] = box;
    const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb), y0 = Math.min(ya, yb), y1 = Math.max(ya, yb);
    const out = new Set<string>();
    drawing.dotOf.forEach((id, i) => {
        const x = dotsXY[i * 2], y = dotsXY[i * 2 + 1];
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) out.add(id);
    });
    return [...out];
}

/** The settings a control can be given after it is placed (null: take it off, back to the usual) */
export interface ControlChange {
    by?: number | null;
    along?: number | null;
    /** The side a place is on (a link stays inside: it is the body held along its line) */
    side?: 1 | -1;
}

/**
 * The marks with these ids given a distance, a length along the sheets or a side. A link keeps a distance (it is
 * nothing without one): a link asked to drop it keeps its own; and it keeps its side.
 */
export function changedMarks(marks: readonly SideMark[], ids: ReadonlySet<string>, change: ControlChange): SideMark[] {
    return marks.map(m => {
        if (!ids.has(m.id)) return m;
        const next: SideMark = { ...m };
        if (change.side !== undefined && !m.to) next.side = change.side;
        if (change.by !== undefined) {
            if (change.by !== null && Number.isFinite(change.by) && change.by > 0) next.by = change.by;
            else if (!m.to) { delete next.by; delete next.along; }
        }
        if (change.along !== undefined && next.by) {
            if (change.along !== null && Number.isFinite(change.along) && change.along >= 1) next.along = Math.min(ALONG_MOST, change.along);
            else delete next.along;
        }
        return next;
    });
}

/** The marks with one end of one of them (`p`, or a link's `to`) at another place */
export function movedMark(marks: readonly SideMark[], id: string, end: 'p' | 'to', p: Vec3): SideMark[] {
    return marks.map(m => (m.id !== id ? m : end === 'to' && m.to ? { ...m, to: [p[0], p[1], p[2]] } : { ...m, p: [p[0], p[1], p[2]] }));
}

/** The marks with a whole control moved by an offset (both ends of a link) */
export function shiftedMarks(marks: readonly SideMark[], ids: ReadonlySet<string>, d: Vec3): SideMark[] {
    const add = (p: Vec3): Vec3 => [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
    return marks.map(m => (!ids.has(m.id) ? m : { ...m, p: add(m.p), ...(m.to ? { to: add(m.to) } : {}) }));
}
