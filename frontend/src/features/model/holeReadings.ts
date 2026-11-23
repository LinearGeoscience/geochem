/**
 * Orientation readings logged down the holes (pure, unit-tested): each row
 * of a table by hole and depth is placed on the path of its hole, and its
 * angles are either the plane or line itself (dip and dip direction, strike,
 * plunge and trend) or the two angles measured on oriented core.
 *
 * On oriented core a plane is measured against the core, not against north:
 *  - alpha: the angle between the core axis and the plane (0-90). At 90 the
 *    plane cuts square across the core.
 *  - beta: where round the core the plane's lowest point down the hole is
 *    (the down-hole end of the ellipse it makes on the core), clockwise from
 *    the reference line looking down the hole (0-360). The reference line is
 *    the bottom-of-hole line (the low side of the core), or the top-of-hole
 *    line opposite it.
 * With the direction of the hole at that depth, the two give the plane. A
 * hole that runs straight down has no low side: beta means nothing there.
 */
import { directionAt, type HoleTrace } from './desurvey';
import { tablePlaces, tableText, type HoleTable } from './drillholes';
import { cross, dipFromNormal, dot, unit } from './plane';
import { setsFromTable, type Angles, type ReadingColumns, type SetsFromTable } from './structureReadings';
import type { Vec3 } from './types';

const RAD = Math.PI / 180;

/** The line beta is measured from: along the low side of the core, or along its high side */
export type CoreReference = 'bottom' | 'top';

/**
 * The bottom-of-hole line as a direction: square to the hole, pointing to
 * the low side of the core. Null for a hole that runs straight down (or up).
 */
export function lowSide(down: ArrayLike<number>): Vec3 | null {
    const h = unit(down);
    if (!h) return null;
    const g: Vec3 = [0, 0, -1];
    const along = dot(g, h);
    const low: Vec3 = [g[0] - along * h[0], g[1] - along * h[1], g[2] - along * h[2]];
    return Math.hypot(low[0], low[1], low[2]) < 1e-4 ? null : unit(low);
}

/**
 * A plane from its alpha and beta on oriented core, in a hole running along
 * `down` there (pointing down the hole). Null when an angle is out of range
 * or the hole runs straight down.
 */
export function planeFromCore(alpha: number, beta: number, down: ArrayLike<number>, reference: CoreReference = 'bottom'): Angles | null {
    if (!Number.isFinite(alpha) || !Number.isFinite(beta) || alpha < 0 || alpha > 90 || beta < 0 || beta > 360) return null;
    const h = unit(down), low = lowSide(down);
    if (!h || !low) return null;
    // Round the core from the reference line, clockwise looking down the hole: where the plane's down-hole end is
    const b = (beta + (reference === 'top' ? 180 : 0)) * RAD;
    const side = cross(h, low);
    const e: Vec3 = [
        Math.cos(b) * low[0] + Math.sin(b) * side[0],
        Math.cos(b) * low[1] + Math.sin(b) * side[1],
        Math.cos(b) * low[2] + Math.sin(b) * side[2],
    ];
    // The plane holds the line down the core's side at alpha to its axis (cos a h + sin a e) and the line square to both
    const a = alpha * RAD;
    const pole: Vec3 = [
        Math.sin(a) * h[0] - Math.cos(a) * e[0],
        Math.sin(a) * h[1] - Math.cos(a) * e[1],
        Math.sin(a) * h[2] - Math.cos(a) * e[2],
    ];
    const { dip, dipDirection } = dipFromNormal(pole);
    return { dip, direction: dipDirection };
}

/** Which columns of a table logged down the holes hold the readings */
export interface HoleReadingColumns extends Omit<ReadingColumns, 'x' | 'y' | 'z' | 'rows'> {
    /** Planes measured on oriented core: `dip` and `direction` are not read */
    core?: { alpha: string; beta: string; reference: CoreReference };
}

const X = '\u0000x', Y = '\u0000y', Z = '\u0000z', DIP = '\u0000dip', DIRECTION = '\u0000direction';

/**
 * Readings from a table logged down the holes: every row with both angles,
 * placed at its depth on the path of its hole (the middle of its interval,
 * in a table of intervals). Rows of a hole with no path have no place and
 * are left out.
 */
export function setsFromHoleTable(table: HoleTable, traces: ReadonlyMap<string, HoleTrace>, c: HoleReadingColumns): SetsFromTable {
    const n = table.hole.length;
    const numbers = (name: string) => {
        const values = table.columns.find(col => col.name === name)?.values;
        return values instanceof Float64Array ? values : null;
    };
    const places = tablePlaces(table, traces);
    const notes: string[] = [];
    let dip: Float64Array | null = null, direction: Float64Array | null = null;
    if (c.core) {
        const alpha = numbers(c.core.alpha), beta = numbers(c.core.beta);
        if (!alpha || !beta) return { ok: false, reason: 'no-columns' };
        dip = new Float64Array(n).fill(NaN);
        direction = new Float64Array(n).fill(NaN);
        let outOfRange = 0, noPath = 0, upright = 0;
        for (let i = 0; i < n; i++) {
            const a = alpha[i], b = beta[i];
            if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
            if (a < 0 || a > 90 || b < 0 || b > 360) { outOfRange++; continue; }
            const trace = traces.get(table.hole[i]);
            if (!trace || !Number.isFinite(places.x[i])) { noPath++; continue; }
            const to = table.to ? table.to[i] : NaN;
            const depth = Number.isFinite(to) && to > table.from[i] ? (table.from[i] + to) / 2 : table.from[i];
            const plane = planeFromCore(a, b, directionAt(trace, depth), c.core.reference);
            if (!plane) { upright++; continue; }
            dip[i] = plane.dip;
            direction[i] = plane.direction;
        }
        const rows = (k: number) => `${k.toLocaleString()} ${k === 1 ? 'row' : 'rows'}`;
        const were = (k: number) => (k === 1 ? 'was' : 'were');
        if (outOfRange > 0) notes.push(`${rows(outOfRange)} with an alpha outside 0-90 or a beta outside 0-360 ${were(outOfRange)} left out.`);
        if (noPath > 0) notes.push(`${rows(noPath)} in holes with no collar or survey ${were(noPath)} left out.`);
        if (upright > 0) notes.push(`${rows(upright)} where the hole runs straight down ${were(upright)} left out: the core has no low side there to measure beta from.`);
    }
    const out = setsFromTable({
        numeric: name => (name === X ? places.x : name === Y ? places.y : name === Z ? places.z
            : name === DIP ? dip : name === DIRECTION ? direction : numbers(name)),
        text: name => tableText(table, name),
    }, {
        kind: c.core ? 'plane' : c.kind, x: X, y: Y, z: Z,
        dip: c.core ? DIP : c.dip, direction: c.core ? DIRECTION : c.direction, strike: !c.core && c.strike,
        splitBy: c.splitBy, name: c.name, only: c.only,
    });
    return out.ok ? { ...out, notes: [...notes, ...out.notes] } : out;
}

const lower = (s: string) => s.trim().toLowerCase().replace(/[\s_.-]+/g, '');
const ALPHA = ['alpha', 'alphaangle', 'alphadeg', 'coreangle', 'tca', 'alp'];
const BETA = ['beta', 'betaangle', 'betadeg', 'bet'];

/** The columns that look like alpha and beta, by their names ('' = none does). */
export function guessCoreColumns(numeric: readonly string[]): { alpha: string; beta: string } {
    const find = (words: string[]) => {
        for (const w of words) {
            const hit = numeric.find(name => lower(name) === w);
            if (hit) return hit;
        }
        return '';
    };
    return { alpha: find(ALPHA), beta: find(BETA) };
}
