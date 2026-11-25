/**
 * Links between the holes of a body of thin sheets, proposed from its
 * logging (pure, unit-tested): pairs of logged stretches of the unit, in
 * different holes, that lie in one plane of the sheets a few metres apart
 * with no hole between them that logs other ground.
 *
 * A link is an offer, never a control: the geologist takes it (the body held
 * along the line between the two, contactControl `withLink`) or passes it
 * over. How long a link may be was decided on a trial with holes left out:
 * see `LINK_MOST`.
 */
import { lensesTake } from './contactControl';
import type { ContactInputs } from './contacts';
import { evaluateField, type FittedField } from './rbf';
import type { Vec3 } from './types';

/** A logged stretch of the unit down a hole: where it starts and ends */
export interface LinkStretch {
    /** Which hole (any numbering: two stretches of one hole are never linked) */
    hole: number;
    top: Vec3;
    bottom: Vec3;
}

export interface LinkOptions {
    /** The longest a link may be, m */
    most: number;
    /** The shortest worth offering, m */
    least?: number;
    /** How far out of the plane of the sheets it may lie, degrees */
    angle: number;
    /** ... and never asked to be closer than this across the sheets, m */
    acrossFloor?: number;
    /** A hole that logs other ground this near the link stops it, m */
    clear?: number;
}

export interface ProposedLink {
    /** The two stretches, as numbered in the list given */
    a: number;
    b: number;
    from: Vec3;
    to: Vec3;
    length: number;
    /** How far apart the two are across the sheets, m */
    across: number;
}

const sub = (a: ArrayLike<number>, b: ArrayLike<number>): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: ArrayLike<number>, b: ArrayLike<number>): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** How far a place is from a segment, and how far along it (0 to 1) the nearest place of it is */
export function fromSegment(p: ArrayLike<number>, a: ArrayLike<number>, b: ArrayLike<number>): { d: number; t: number } {
    const ab = sub(b, a), ap = sub(p, a), l2 = dot(ab, ab);
    const t = l2 > 0 ? Math.max(0, Math.min(1, dot(ap, ab) / l2)) : 0;
    return { d: Math.hypot(ap[0] - t * ab[0], ap[1] - t * ab[1], ap[2] - t * ab[2]), t };
}

/** Places kept in cells of a size, to ask what is near a place */
function cellsOf(positions: ArrayLike<number>, size: number) {
    const cells = new Map<string, number[]>();
    const key = (x: number, y: number, z: number) => `${Math.floor(x / size)},${Math.floor(y / size)},${Math.floor(z / size)}`;
    for (let i = 0; i * 3 < positions.length; i++) {
        const k = key(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
        const list = cells.get(k);
        if (list) list.push(i); else cells.set(k, [i]);
    }
    /** Every place in the cells a box touches */
    return (lo: Vec3, hi: Vec3, each: (i: number) => void) => {
        for (let x = Math.floor(lo[0] / size); x <= Math.floor(hi[0] / size); x++) for (let y = Math.floor(lo[1] / size); y <= Math.floor(hi[1] / size); y++) for (let z = Math.floor(lo[2] / size); z <= Math.floor(hi[2] / size); z++) {
            const list = cells.get(`${x},${y},${z}`);
            if (list) for (const i of list) each(i);
        }
    };
}

/**
 * The links the logging offers. `normal`: across the sheets. `others`: the
 * middles of the logged pieces of other ground, and the hole each is in
 * (numbered as the stretches' holes are).
 *
 * Each stretch is linked at most once in each quarter of the plane (each way
 * along strike, up dip, down dip), to its nearest partner there, and only
 * where it is that partner's nearest too.
 */
export function proposeLinks(
    stretches: readonly LinkStretch[], normal: Vec3, others: { positions: ArrayLike<number>; hole: ArrayLike<number> } | null, options: LinkOptions,
): ProposedLink[] {
    const n = unit(normal);
    const least = options.least ?? 1.5, clear = options.clear ?? 0.75, floor = options.acrossFloor ?? 0.75;
    const most = options.most, slope = Math.tan(options.angle * Math.PI / 180);
    if (!(most > least) || stretches.length < 2) return [];
    // The plane's two ways: along strike, and up the dip (a flat plane: east and north)
    const flat = Math.hypot(n[0], n[1]) < 1e-9;
    const strike: Vec3 = flat ? [1, 0, 0] : unit(cross([0, 0, 1], n));
    const dip = unit(cross(n, strike));
    const mids = new Float64Array(stretches.length * 3);
    stretches.forEach((s, i) => { for (let c = 0; c < 3; c++) mids[i * 3 + c] = (s.top[c] + s.bottom[c]) / 2; });
    const mid = (i: number): Vec3 => [mids[i * 3], mids[i * 3 + 1], mids[i * 3 + 2]];
    const nearStretches = cellsOf(mids, Math.max(most, 1));
    const nearOthers = others && others.hole.length ? cellsOf(others.positions, 4) : null;

    /** In which quarter of the plane b lies from a: 0 and 2 the two ways along strike, 1 up dip, 3 down */
    const quarter = (d: Vec3) => ((Math.round(Math.atan2(dot(d, dip), dot(d, strike)) / (Math.PI / 2)) % 4) + 4) % 4;
    // Each stretch's nearest partner in each quarter
    const best: (ProposedLink | null)[][] = stretches.map(() => [null, null, null, null]);
    for (let a = 0; a < stretches.length; a++) {
        const pa = mid(a);
        nearStretches([pa[0] - most, pa[1] - most, pa[2] - most], [pa[0] + most, pa[1] + most, pa[2] + most], b => {
            if (b === a || stretches[b].hole === stretches[a].hole) return;
            const pb = mid(b), d = sub(pb, pa), length = Math.hypot(d[0], d[1], d[2]);
            if (length < least || length > most) return;
            const across = Math.abs(dot(d, n)), along = Math.sqrt(Math.max(0, length * length - across * across));
            if (across > Math.max(floor, slope * along)) return;
            const q = quarter(d), had = best[a][q];
            if (had && had.length <= length) return;
            // No other hole logs other ground on the way
            let stopped = false;
            if (nearOthers && others) {
                const lo: Vec3 = [Math.min(pa[0], pb[0]) - clear, Math.min(pa[1], pb[1]) - clear, Math.min(pa[2], pb[2]) - clear];
                const hi: Vec3 = [Math.max(pa[0], pb[0]) + clear, Math.max(pa[1], pb[1]) + clear, Math.max(pa[2], pb[2]) + clear];
                nearOthers(lo, hi, i => {
                    if (stopped || others.hole[i] === stretches[a].hole || others.hole[i] === stretches[b].hole) return;
                    if (fromSegment([others.positions[i * 3], others.positions[i * 3 + 1], others.positions[i * 3 + 2]], pa, pb).d < clear) stopped = true;
                });
            }
            if (!stopped) best[a][q] = { a, b, from: pa, to: pb, length, across };
        });
    }
    // Kept where each is the other's nearest (b sees a in the opposite quarter)
    const out: ProposedLink[] = [];
    for (let a = 0; a < stretches.length; a++) for (let q = 0; q < 4; q++) {
        const link = best[a][q];
        if (!link || link.b < a) continue;
        const back = best[link.b][(q + 2) % 4];
        if (back && back.b === a) out.push(link);
    }
    return out.sort((x, y) => x.length - y.length);
}

/**
 * How long a link may be to be offered, m, and how far out of the plane of
 * the sheets, degrees. From a trial with holes left out one in five on a real
 * set of thin dykes drilled a few metres apart: of the links a hole left out
 * passed through, that hole logged the dyke within 0.75 m of 3 in 4 up to
 * 8 m long, 2 in 3 from 8 to 12 m, half from 12 to 20 m and a third beyond.
 * On made-up dykes, links up to 12 m between holes 10 m apart ran through
 * true dyke for 19 parts in 20 of their length. A wider angle offers few
 * more links and worse ones.
 */
export const LINK_MOST = 8;
export const LINK_ANGLE = 15;
/**
 * A link is held by half the thickness of the thinner of its two stretches,
 * between these, m: no thicker at either hole than the hole logs. (By the
 * mean of the two it was thicker than the thinner one, and the model took
 * the ground logged beside it: seen on the first sections.) A stretch
 * thinner across the sheets than the least is not linked: the thinnest
 * sheet drawn would be over twice as thick as it is logged.
 */
export const LINK_BY: [number, number] = [0.1, 2];
/** ... and reaches this far to each side of its line along the sheets, m, however thin it is */
export const LINK_WIDE = 2;
/** Another hole that logs other ground this near a link's ribbon stops it, m (a logged piece is known by its middle) */
export const LINK_CLEAR = 0.5;
/** A lens is never more times as far along its sheets as across than this (contactControl `ALONG_MOST`) */
const TIMES_MOST = 32;

/** A link offered on a body: its two holes by name, how far across it would be held, and how many times as far along its sheets where that is not the body's own */
export interface BodyLink extends ProposedLink {
    holes: [string, string];
    by: number;
    along?: number;
}

/**
 * The links a fitted body of thin sheets is offered: between stretches of its
 * own logging, where it does not join the two already, and where the ribbon
 * a link would be has no logged piece of other ground in it or just beside
 * it (in another hole; at its own two holes it is no thicker than they log).
 *
 * `plane`: the plane its lenses lie along (contactControl `lensPlane`).
 */
export function bodyLinks(
    found: Pick<ContactInputs, 'middles' | 'checks' | 'holeNames'>, field: FittedField | null, plane: { normal: Vec3; times: number } | null, most: number = LINK_MOST,
): { links: BodyLink[]; joined: number; stopped: number; thin: number } {
    if (!plane || !(most > 0)) return { links: [], joined: 0, stopped: 0, thin: 0 };
    const n = unit(plane.normal), m = found.middles;
    const stretches: LinkStretch[] = [], down: Vec3[] = [], long: number[] = [];
    for (let k = 0; k < m.side.length; k++) {
        if (m.side[k] <= 0) continue;
        // (Its place is the middle of a logged interval: its own middle is `off` down the hole from there)
        const a = [m.along[k * 3], m.along[k * 3 + 1], m.along[k * 3 + 2]], h = m.length[k] / 2, off = m.off?.[k] ?? 0;
        const p = [m.positions[k * 3] + a[0] * off, m.positions[k * 3 + 1] + a[1] * off, m.positions[k * 3 + 2] + a[2] * off];
        stretches.push({ hole: m.hole[k], top: [p[0] - a[0] * h, p[1] - a[1] * h, p[2] - a[2] * h], bottom: [p[0] + a[0] * h, p[1] + a[1] * h, p[2] + a[2] * h] });
        down.push([a[0], a[1], a[2]]); long.push(m.length[k]);
    }
    const c = found.checks, positions: number[] = [], hole: number[] = [];
    for (let i = 0; i < c.side.length; i++) if (c.side[i] < 0 && c.hole[i] < found.holeNames.length) { positions.push(c.positions[i * 3], c.positions[i * 3 + 1], c.positions[i * 3 + 2]); hole.push(c.hole[i]); }
    const near = hole.length ? cellsOf(positions, 4) : null;
    /** The plane of a link's ribbon: through its line, as near the plane of the sheets as that lets it be (rbf `FieldTouches.ends`) */
    const ribbon = (l: ProposedLink): Vec3 => {
        const d = sub(l.to, l.from), lean = dot(d, n) / (dot(d, d) || 1);
        const p: Vec3 = [n[0] - lean * d[0], n[1] - lean * d[1], n[2] - lean * d[2]];
        return Math.hypot(p[0], p[1], p[2]) > 1e-6 ? unit(p) : n;
    };
    /** Does another hole log other ground in the link's ribbon, or within `LINK_CLEAR` of it? */
    const crowded = (l: ProposedLink, across: Vec3, by: number, wide: number): boolean => {
        const reach = wide + LINK_CLEAR, ha = stretches[l.a].hole, hb = stretches[l.b].hole;
        const d = sub(l.to, l.from), l2 = dot(d, d);
        let hit = false;
        near!([Math.min(l.from[0], l.to[0]) - reach, Math.min(l.from[1], l.to[1]) - reach, Math.min(l.from[2], l.to[2]) - reach], [Math.max(l.from[0], l.to[0]) + reach, Math.max(l.from[1], l.to[1]) + reach, Math.max(l.from[2], l.to[2]) + reach], i => {
            if (hit || hole[i] === ha || hole[i] === hb) return;
            // Where along the line it is nearest in the plane of the sheets, how far from there in the plane, and how far across
            const q = sub([positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]], l.from);
            const t = l2 > 0 ? Math.max(0, Math.min(1, dot(q, d) / l2)) : 0;
            const r: Vec3 = [q[0] - t * d[0], q[1] - t * d[1], q[2] - t * d[2]], off = dot(r, across);
            const inPlane = Math.sqrt(Math.max(0, dot(r, r) - off * off));
            if (Math.abs(off) < by + LINK_CLEAR && inPlane < reach) hit = true;
        });
        return hit;
    };
    const out: BodyLink[] = [];
    let joined = 0, stopped = 0, thin = 0;
    const along = new Float64Array(19 * 3);
    for (const l of proposeLinks(stretches, n, { positions, hole }, { most, angle: LINK_ANGLE })) {
        // Joined already: the model has the line between them, nearly all the way
        if (field) {
            for (let k = 1; k < 20; k++) for (let q = 0; q < 3; q++) along[(k - 1) * 3 + q] = l.from[q] + (k / 20) * (l.to[q] - l.from[q]);
            let inside = 0;
            const f = evaluateField(field, along);
            for (let k = 0; k < 19; k++) if (f[k] > 0) inside++;
            if (inside >= 17) { joined++; continue; }
        }
        // How thick its two stretches are across its ribbon
        const across = ribbon(l), least = Math.min(long[l.a] * Math.abs(dot(down[l.a], across)), long[l.b] * Math.abs(dot(down[l.b], across)));
        if (least < LINK_BY[0]) { thin++; continue; }
        const by = Math.max(LINK_BY[0], Math.min(LINK_BY[1], least / 2));
        // As wide as a link is, however thin: its own length along the sheets where the body's would leave it narrower
        const times = Math.min(TIMES_MOST, LINK_WIDE / by), own = times > plane.times ? { along: times } : {};
        // Its ribbon would put logged ground of another unit inside the body, or comes too near some to say
        if ((near && crowded(l, across, by, by * Math.max(times, plane.times))) || lensesTake([{ id: 'link', p: l.from, to: l.to, side: 1, by, ...own }], c, plane)[0] > 0) { stopped++; continue; }
        out.push({ ...l, by, ...own, holes: [found.holeNames[stretches[l.a].hole] ?? '', found.holeNames[stretches[l.b].hole] ?? ''] });
    }
    return { links: out, joined, stopped, thin };
}
