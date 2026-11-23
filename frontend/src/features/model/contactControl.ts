/**
 * Control by hand of a surface made from logging (pure, unit-tested): each
 * contact the logging gives it kept, left out or moved along its hole;
 * places the surface must pass on one side of; holes it must not cross.
 *
 * Every change is kept on the surface's rule (`control`), by hole and depth,
 * so it survives a re-import of the drillholes; a change that no longer
 * matches a contact (the logging changed) is reported, not dropped.
 * `findContacts` (contacts.ts) applies them.
 */
import { touchDistance, type FieldTouches, type FittedField } from './rbf';
import type { BodyRule, ContactControl, ContactEdit, ContactRule, SideMark, Vec3 } from './types';

/** The colours places on the first and the second side are marked in, in the lists and in the views */
export const SIDE_COLORS: Record<1 | -1, string> = { 1: '#00897b', [-1]: '#ef6c00' };
/** ... and a contact left out */
export const IGNORED_COLOR = '#c62828';

/** A contact the logging gives is the one an edit was made to when their depths are this near, m */
export const SAME_CONTACT_M = 0.05;

type LoggedRule = ContactRule | BodyRule;

const finite3 = (p: unknown): p is Vec3 => Array.isArray(p) && p.length === 3 && p.every(v => typeof v === 'number' && Number.isFinite(v));
const sideOf = (v: unknown): 1 | -1 | null => (v === 1 || v === -1 ? v : null);

/** The control as saved, checked (null: nothing usable in it) */
export function readControl(raw: unknown): ContactControl | null {
    const c = raw as Partial<ContactControl> | null | undefined;
    if (!c || typeof c !== 'object') return null;
    const edits: ContactEdit[] = [];
    for (const e of Array.isArray(c.edits) ? c.edits : []) {
        if (!e || typeof e.hole !== 'string' || !e.hole || !Number.isFinite(e.depth)) continue;
        const to = Number.isFinite(e.to) && (e.to as number) >= 0 ? e.to as number : undefined;
        if (!e.ignore && to === undefined) continue;
        if (edits.some(o => sameContact(o, e.hole, e.depth))) continue;
        edits.push({ hole: e.hole, depth: e.depth, ...(e.ignore ? { ignore: true } : { to }) });
    }
    const marks: SideMark[] = [];
    const ids = new Set<string>();
    for (const m of Array.isArray(c.marks) ? c.marks : []) {
        const side = sideOf(m?.side);
        if (!m || !finite3(m.p) || !side || typeof m.id !== 'string' || !m.id || ids.has(m.id)) continue;
        ids.add(m.id);
        marks.push({
            id: m.id, p: [m.p[0], m.p[1], m.p[2]], side, ...(typeof m.by === 'number' && Number.isFinite(m.by) && m.by > 0 ? { by: m.by } : {}),
            ...(typeof m.along === 'number' && Number.isFinite(m.along) && m.along >= 1 ? { along: Math.min(ALONG_MOST, m.along) } : {}),
            ...(typeof m.by === 'number' && m.by > 0 && finite3(m.to) ? { to: [m.to[0], m.to[1], m.to[2]] as Vec3 } : {}),
        });
    }
    const uncrossed: NonNullable<ContactControl['uncrossed']> = [];
    for (const u of Array.isArray(c.uncrossed) ? c.uncrossed : []) {
        const side = sideOf(u?.side);
        if (!u || typeof u.hole !== 'string' || !u.hole || !side || uncrossed.some(o => o.hole === u.hole)) continue;
        uncrossed.push({ hole: u.hole, side });
    }
    return tidy({ edits, marks, uncrossed });
}

/** Without its empty lists; null when nothing is left */
function tidy(c: ContactControl): ContactControl | null {
    const out: ContactControl = {};
    if (c.edits?.length) out.edits = c.edits;
    if (c.marks?.length) out.marks = c.marks;
    if (c.uncrossed?.length) out.uncrossed = c.uncrossed;
    return out.edits || out.marks || out.uncrossed ? out : null;
}

function withControl<R extends LoggedRule>(rule: R, control: ContactControl): R {
    const next = tidy(control);
    const { control: _was, ...rest } = rule;
    return (next ? { ...rest, control: next } : rest) as R;
}

export const sameContact = (edit: { hole: string; depth: number }, hole: string, depth: number): boolean =>
    edit.hole === hole && Math.abs(edit.depth - depth) <= SAME_CONTACT_M;

/** What was done to the contact the logging puts in a hole at a depth (null: nothing) */
export function editFor(control: ContactControl | undefined, hole: string, depth: number): ContactEdit | null {
    return control?.edits?.find(e => sameContact(e, hole, depth)) ?? null;
}

/**
 * The rule with a contact left out (`ignore`), moved (`to`, a depth down its
 * hole) or, with neither, as the logging has it again.
 */
export function withContactEdit<R extends LoggedRule>(rule: R, hole: string, depth: number, change: { ignore?: boolean; to?: number | null }): R {
    const others = (rule.control?.edits ?? []).filter(e => !sameContact(e, hole, depth));
    const to = Number.isFinite(change.to) && (change.to as number) >= 0 && Math.abs((change.to as number) - depth) > 1e-9 ? change.to as number : undefined;
    const edit: ContactEdit | null = change.ignore ? { hole, depth, ignore: true } : to !== undefined ? { hole, depth, to } : null;
    return withControl(rule, { ...rule.control, edits: edit ? [...others, edit] : others });
}

/** A lens runs at most this many times as far along its sheets as across them */
export const ALONG_MOST = 32;

/**
 * A lens cut OUT of an intrusion runs this many times as far along its
 * sheets as across them when its place says nothing else. A lens put in is
 * carried as far as the body is (8 times for thin sheets): a row along a
 * section needs that reach along strike. A cut that long takes logged ground
 * of the body with it. Tried at 1, 2, 4 and 8 times, twelve cuts by 4 m on a
 * real intrusion of thin sheets: 0, 0, 3 and 12 of them took logged pieces
 * of the unit; on a made-up network, at 8 times an eighth of what was taken
 * out was true dyke. So a cut is a trim; a longer one is typed, with what it
 * takes of the logging said beside it.
 */
export const CUT_ALONG = 2;

/** How many times as far along the sheets as across a lens of this place runs, in a body carried `usual` times as far along them */
export const lensTimes = (mark: Pick<SideMark, 'side' | 'along'>, usual: number): number =>
    mark.along ?? (mark.side < 0 ? CUT_ALONG : usual);

/**
 * The rule with a place the surface must pass on one side of (`by`: at least this far from it, m; `along`: a lens that
 * many times as far along the sheets as across, where it is one); the new mark's id comes back too
 */
export function withMark<R extends LoggedRule>(rule: R, p: Vec3, side: 1 | -1, by?: number, along?: number): { rule: R; id: string } {
    const marks = rule.control?.marks ?? [];
    let n = marks.length + 1;
    while (marks.some(m => m.id === `m${n}`)) n++;
    const id = `m${n}`;
    const held = by !== undefined && Number.isFinite(by) && by > 0;
    const mark: SideMark = { id, p: [p[0], p[1], p[2]], side, ...(held ? { by } : {}), ...(held && along !== undefined && Number.isFinite(along) && along >= 1 ? { along: Math.min(ALONG_MOST, along) } : {}) };
    return { rule: withControl(rule, { ...rule.control, marks: [...marks, mark] }), id };
}

/**
 * How far apart the places of a row are, at most, m: what each is held clear
 * by, so that the lenses they are in an intrusion run into one another
 * whichever way the row lies (along its sheets they are several times
 * longer); 2 m for places held only just clear.
 */
export const rowSpacing = (by?: number): number => (by !== undefined && by > 0 ? Math.min(8, Math.max(0.25, by)) : 2);
/** ... and a row is never more places than this */
export const ROW_MOST = 80;

/**
 * The rule with a link: a place held on one side along the whole line from
 * one place to another, by a distance (an intrusion: a lens drawn out along
 * the line, which is what a row of places along it comes to). Its id comes back too.
 */
export function withLink<R extends LoggedRule>(rule: R, from: Vec3, to: Vec3, side: 1 | -1, by: number, along?: number): { rule: R; id: string } {
    const made = withMark(rule, from, side, by, along);
    const marks = made.rule.control?.marks ?? [];
    if (!(by > 0) || !finite3(to)) return made;
    return { rule: withControl(made.rule, { ...made.rule.control, marks: marks.map(m => (m.id === made.id ? { ...m, to: [to[0], to[1], to[2]] as Vec3 } : m)) }), id: made.id };
}

/** The places held by a distance as a fitted intrusion takes them: its lenses, in the marks' order (null: none is held by a distance) */
export function heldAsLenses(marks: readonly SideMark[]): Pick<FieldTouches, 'places' | 'side' | 'by' | 'times' | 'ends'> | null {
    const held = marks.filter(m => m.by !== undefined && m.by > 0);
    if (held.length === 0) return null;
    return {
        places: Float64Array.from(held.flatMap(m => m.p)), side: Int8Array.from(held, m => m.side), by: Float64Array.from(held, m => m.by!),
        ...(held.some(m => m.along || m.side < 0) ? { times: Float64Array.from(held, m => lensTimes(m, 0)) } : {}),
        ...(held.some(m => m.to) ? { ends: Float64Array.from(held.flatMap(m => m.to ?? [NaN, NaN, NaN])) } : {}),
    };
}

/** The place marked last on a side (null: none yet) */
export function lastMark(rule: LoggedRule, side: 1 | -1): SideMark | null {
    const marks = rule.control?.marks ?? [];
    for (let i = marks.length - 1; i >= 0; i--) if (marks[i].side === side) return marks[i];
    return null;
}

/**
 * The rule with a row of places on one side, from a place (which is not
 * marked again) straight to another: "it runs through here", or "nothing
 * along here". The ids of the new marks come back too.
 */
export function withMarkRow<R extends LoggedRule>(rule: R, from: Vec3, to: Vec3, side: 1 | -1, by?: number, along?: number): { rule: R; ids: string[] } {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const n = Math.max(1, Math.min(ROW_MOST, Math.ceil(length / rowSpacing(by) - 1e-9)));
    let next = rule;
    const ids: string[] = [];
    for (let i = 1; i <= n; i++) {
        const t = i / n;
        const made = withMark(next, [from[0] + t * (to[0] - from[0]), from[1] + t * (to[1] - from[1]), from[2] + t * (to[2] - from[2])], side, by, along);
        next = made.rule;
        ids.push(made.id);
    }
    return { rule: next, ids };
}

/** The rule without some of its marks (null: without any) */
export function withoutMarks<R extends LoggedRule>(rule: R, ids: readonly string[] | null): R {
    return withControl(rule, { ...rule.control, marks: ids ? (rule.control?.marks ?? []).filter(m => !ids.includes(m.id)) : [] });
}

/** The rule with a hole the surface must not cross, lying on a side of it (null: it may cross it again) */
export function withUncrossed<R extends LoggedRule>(rule: R, hole: string, side: 1 | -1 | null): R {
    const others = (rule.control?.uncrossed ?? []).filter(u => u.hole !== hole);
    return withControl(rule, { ...rule.control, uncrossed: side ? [...others, { hole, side }] : others });
}

/**
 * The plane the lenses of a fitted body lie along, and how many times as far
 * they run along it as across it unless a place says otherwise (null: they
 * are balls: it is carried evenly, or follows the ground from place to place).
 */
export function lensPlane(field: Pick<FittedField, 'stretch' | 'layering' | 'touches'> | null | undefined): { normal: Vec3; times: number } | null {
    if (!field) return null;
    if (field.touches) return field.touches.across ?? null;
    const s = field.stretch;
    return s && !field.layering && s.factor > 1 ? { normal: s.normal, times: s.factor } : null;
}

/**
 * The outline of a lens where a plane through its place cuts it: an ellipse,
 * `a` out each way along the direction at `turn` (radians from `u` towards
 * `v`) and `b` each way across that. `u`, `v`: unit vectors along the plane's
 * two axes. Seen along its sheets a lens is as thin as it is held; seen face
 * on it is as wide as it runs along them.
 */
export function lensOutline(by: number, times: number, normal: Vec3 | null, u: Vec3, v: Vec3): { a: number; b: number; turn: number } {
    const size = normal ? Math.hypot(normal[0], normal[1], normal[2]) : 0;
    if (!normal || !(size > 1e-12) || !(times > 1)) return { a: by, b: by, turn: 0 };
    const wu = (u[0] * normal[0] + u[1] * normal[1] + u[2] * normal[2]) / size, wv = (v[0] * normal[0] + v[1] * normal[1] + v[2] * normal[2]) / size;
    const s2 = Math.min(1, wu * wu + wv * wv);
    if (s2 < 1e-12) return { a: by * times, b: by * times, turn: 0 };
    return { a: by / Math.sqrt(1 / (times * times) + (1 - 1 / (times * times)) * s2), b: by * times, turn: Math.atan2(wv, wu) };
}

/**
 * What each place held by a distance has against the logging, where it is a
 * lens of an intrusion: how many logged pieces of the holes the body is built
 * from lie inside its lens on the other side (a piece of the unit inside a
 * lens cut out; a piece of other ground inside a lens put in). Those are the
 * pieces the lens puts on the wrong side of the body's skin: the hand is
 * followed. One number a mark, in the marks' order (0: it has no distance).
 *
 * `checks`: the logging as the body is checked by it (the middle of each
 * piece and its side). `plane`: the plane its lenses lie along and how many
 * times as far they run along it (null: balls), as its fit has it.
 */
export function lensesTake(
    marks: readonly SideMark[], checks: { positions: ArrayLike<number>; side: ArrayLike<number> } | null, plane: { normal: Vec3; times: number } | null,
): number[] {
    const out = marks.map(() => 0);
    const lenses = checks ? heldAsLenses(marks) : null;
    if (!checks || !lenses) return out;
    const size = plane ? Math.hypot(plane.normal[0], plane.normal[1], plane.normal[2]) : 0;
    const flat = plane && size > 1e-12 && plane.times > 0 ? plane : null;
    const touches: FieldTouches = { ...lenses, across: flat };
    const n = checks.side.length;
    let h = -1;
    marks.forEach((m, j) => {
        if (!(m.by !== undefined && m.by > 0)) return;
        h++;
        // (Told quickly first: a box round all it holds)
        const far = m.by * (flat ? lensTimes(m, flat.times) : 1), q = m.to ?? m.p;
        const lo = [0, 1, 2].map(k => Math.min(m.p[k], q[k]) - far), hi = [0, 1, 2].map(k => Math.max(m.p[k], q[k]) + far);
        for (let i = 0; i < n; i++) {
            if (checks.side[i] * m.side >= 0) continue;
            const x = checks.positions[i * 3], y = checks.positions[i * 3 + 1], z = checks.positions[i * 3 + 2];
            if (x < lo[0] || x > hi[0] || y < lo[1] || y > hi[1] || z < lo[2] || z > hi[2]) continue;
            if (touchDistance(touches, h, x, y, z) < m.by) out[j]++;
        }
    });
    return out;
}

/** How much is controlled by hand */
export function controlCounts(control: ContactControl | undefined): { ignored: number; moved: number; marks: number; uncrossed: number } {
    const edits = control?.edits ?? [];
    return { ignored: edits.filter(e => e.ignore).length, moved: edits.filter(e => !e.ignore).length, marks: control?.marks?.length ?? 0, uncrossed: control?.uncrossed?.length ?? 0 };
}

/** Crosses at places, as line segments (three per place, `size` across): what a view draws marks and left-out contacts as */
export function crossLines(places: ArrayLike<number>, size: number): { vertices: Float64Array; lines: Uint32Array } {
    const n = Math.floor(places.length / 3), h = size / 2;
    const vertices = new Float64Array(n * 18), lines = new Uint32Array(n * 6);
    for (let k = 0; k < n; k++) {
        const x = places[k * 3], y = places[k * 3 + 1], z = places[k * 3 + 2];
        vertices.set([x - h, y, z, x + h, y, z, x, y - h, z, x, y + h, z, x, y, z - h, x, y, z + h], k * 18);
        for (let v = 0; v < 6; v++) lines[k * 6 + v] = k * 6 + v;
    }
    return { vertices, lines };
}
