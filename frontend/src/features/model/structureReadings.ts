/**
 * Orientation readings shared by the whole model (pure, unit-tested): what
 * was measured of the lie of the ground at a place. A plane (bedding, a
 * vein, a foliation) is a dip and the bearing it dips towards; a line (a
 * lineation, a fold axis) is a plunge and the bearing it plunges towards.
 *
 * Readings are kept in sets: one kind each, from one source, shown, hidden
 * and removed together. They belong to the scene, not to a surface.
 */
import Papa from 'papaparse';
import { jacobiEigendecomposition } from '../../utils/calculations/eigen';
import { cross, dipFromNormal, dot, normalFromDip, unit } from './plane';
import { pickSpread } from './readings';
import type { ReadingSet, StructureReading, Vec3 } from './types';

/** A set keeps at most this many readings (from more, ones spread evenly through them are chosen) */
export const MAX_SET_READINGS = 5000;
/** A scene keeps at most this many sets */
export const MAX_SETS = 24;
export const SET_COLOURS = ['#1565c0', '#c62828', '#2e7d32', '#6a1b9a', '#ef6c00', '#00838f', '#ad1457', '#4e342e'];

const RAD = Math.PI / 180;
const turn = (v: number) => ((v % 360) + 360) % 360;
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export interface Angles { dip: number; direction: number }

/** A plane as stored: dip within 0-90, the bearing it dips towards within 0-360. Past vertical it dips the other way. */
export function cleanPlane(dip: unknown, direction: unknown): Angles | null {
    if (!isNumber(dip) || !isNumber(direction) || Math.abs(dip) > 180) return null;
    let d = Math.abs(dip), a = direction;
    if (d > 90) { d = 180 - d; a += 180; }
    return { dip: d, direction: turn(a) };
}

/** A plane from its strike by the right-hand rule: it dips to the right of the way the strike is read. */
export function planeFromStrike(dip: unknown, strike: unknown): Angles | null {
    return isNumber(strike) ? cleanPlane(dip, strike + 90) : null;
}

/** A line as stored: plunge within 0-90 below level, the bearing it plunges towards within 0-360. One given as rising is turned round. */
export function cleanLine(plunge: unknown, trend: unknown): Angles | null {
    if (!isNumber(plunge) || !isNumber(trend) || Math.abs(plunge) > 90) return null;
    return plunge < 0 ? { dip: -plunge, direction: turn(trend + 180) } : { dip: plunge, direction: turn(trend) };
}

/** The unit vector along a line, pointing down its plunge. */
export function lineVector(plunge: number, trend: number): Vec3 {
    const p = plunge * RAD, t = trend * RAD;
    return [Math.sin(t) * Math.cos(p), Math.cos(t) * Math.cos(p), -Math.sin(p)];
}

/** What a reading fixes in space: a plane's upward normal, or a line's direction down its plunge. */
export function readingAxis(kind: ReadingSet['kind'], r: Angles): Vec3 {
    return kind === 'plane' ? normalFromDip(r.dip, r.direction) : lineVector(r.dip, r.direction);
}

const bearing = (v: number) => String(Math.round(turn(v)) % 360).padStart(3, '0');

/** "dipping 35° towards 090°" / "plunging 20° towards 135°" */
export function anglesText(kind: ReadingSet['kind'], r: Angles): string {
    if (kind === 'line') return r.dip < 0.5 ? `level, towards ${bearing(r.direction)}°` : r.dip > 89.5 ? 'plunging straight down' : `plunging ${Math.round(r.dip)}° towards ${bearing(r.direction)}°`;
    return r.dip < 0.5 ? 'level' : r.dip > 89.5 ? `vertical, striking ${bearing(r.direction + 90)}°` : `dipping ${Math.round(r.dip)}° towards ${bearing(r.direction)}°`;
}

/**
 * A plane from a stroke drawn along it on a slice: the plane that passes
 * straight through the slice along the stroke. That is the structure's
 * true lie when the slice cuts square across it (a cross-section across
 * the strike; on a level slice the stroke is the strike and the plane
 * stands vertical). Null for a stroke with no length.
 */
export function planeFromStroke(from: ArrayLike<number>, to: ArrayLike<number>, sliceNormal: ArrayLike<number>): Angles | null {
    const along = unit([to[0] - from[0], to[1] - from[1], to[2] - from[2]]), through = unit(sliceNormal);
    const normal = along && through ? unit(cross(along, through)) : null;
    if (!normal) return null;
    const { dip, dipDirection } = dipFromNormal(normal);
    return { dip, direction: dipDirection };
}

/** A line from a stroke drawn along it: its plunge and the bearing it plunges towards. Null for a stroke with no length. */
export function lineFromStroke(from: ArrayLike<number>, to: ArrayLike<number>): Angles | null {
    const along = unit([to[0] - from[0], to[1] - from[1], to[2] - from[2]]);
    if (!along) return null;
    const down = along[2] > 0 ? [-along[0], -along[1], -along[2]] : along;
    const level = Math.hypot(down[0], down[1]);
    return { dip: Math.asin(Math.min(1, -down[2])) / RAD, direction: level < 1e-9 ? 0 : turn(Math.atan2(down[0], down[1]) / RAD) };
}

/** The name of the set that readings placed by hand go into */
export const handSetName = (kind: ReadingSet['kind']) => (kind === 'plane' ? 'Planes set by hand' : 'Lines set by hand');

// ---------------------------------------------------------------------------
// A set as a whole
// ---------------------------------------------------------------------------

export interface SetSummary {
    count: number;
    /** The orientation the readings lie closest to, taken together */
    dip: number;
    direction: number;
    /** Half of the readings are within this many degrees of it */
    within: number;
}

/**
 * The orientation a set's readings lie closest to, and how closely. A plane
 * and the same plane turned over are one reading here, as are a line and
 * the same line the other way. Null for an empty set.
 */
export function setSummary<R extends Angles>(set: { kind: ReadingSet['kind']; readings: readonly R[] }): SetSummary | null {
    const n = set.readings.length;
    if (n === 0) return null;
    const axes = set.readings.map(r => readingAxis(set.kind, r));
    const t = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const a of axes) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) t[i][j] += a[i] * a[j] / n;
    const mean = n === 1 ? axes[0] : unit(jacobiEigendecomposition(t).eigenvectors[0]) ?? axes[0];
    const angles = axes.map(a => Math.acos(Math.min(1, Math.abs(dot(a, mean)))) / RAD).sort((a, b) => a - b);
    const within = n % 2 === 1 ? angles[(n - 1) / 2] : (angles[n / 2 - 1] + angles[n / 2]) / 2;
    if (set.kind === 'plane') {
        const { dip, dipDirection } = dipFromNormal(mean);
        return { count: n, dip, direction: dipDirection, within };
    }
    const down = mean[2] > 0 ? [-mean[0], -mean[1], -mean[2]] : mean;
    const level = Math.hypot(down[0], down[1]);
    return { count: n, dip: Math.asin(Math.min(1, -down[2])) / RAD, direction: level < 1e-9 ? 0 : turn(Math.atan2(down[0], down[1]) / RAD), within };
}

/** A set in a sentence or two: "312 planes. Taken together they lie closest to dipping 58° towards 092°; half are within 12° of that." */
export function setText<R extends Angles>(set: { kind: ReadingSet['kind']; readings: readonly R[] }): string {
    const s = setSummary(set);
    const one = set.kind === 'plane' ? 'plane' : 'line';
    if (!s) return `No ${one}s.`;
    if (s.count === 1) return `1 ${one}, ${anglesText(set.kind, s)}.`;
    const within = s.within < 0.5 ? 'they all but agree' : `half are within ${Math.max(1, Math.round(s.within))}° of that`;
    return `${s.count.toLocaleString()} ${one}s. Taken together they lie closest to ${anglesText(set.kind, s)}; ${within}.`;
}

// ---------------------------------------------------------------------------
// Stored sets
// ---------------------------------------------------------------------------

/** The sets of a scene as stored: anything unreadable is left out, as is a set with no readings. */
export function readSets(raw: unknown): ReadingSet[] {
    if (!Array.isArray(raw)) return [];
    const out: ReadingSet[] = [];
    const setIds = new Set<string>(), readingIds = new Set<string>();
    for (const s of raw as Partial<ReadingSet>[]) {
        if (out.length >= MAX_SETS) break;
        if (!s || typeof s.id !== 'string' || !s.id || setIds.has(s.id) || !Array.isArray(s.readings)) continue;
        const kind = s.kind === 'line' ? 'line' : s.kind === 'plane' ? 'plane' : null;
        if (!kind) continue;
        const readings: StructureReading[] = [];
        for (const r of s.readings as Partial<StructureReading>[]) {
            if (readings.length >= MAX_SET_READINGS) break;
            if (!r || typeof r.id !== 'string' || !r.id || readingIds.has(r.id) || !Array.isArray(r.p) || r.p.length !== 3 || !r.p.every(isNumber)) continue;
            const angles = kind === 'plane' ? cleanPlane(r.dip, r.direction) : cleanLine(r.dip, r.direction);
            if (!angles) continue;
            readingIds.add(r.id);
            readings.push({ id: r.id, p: [r.p[0], r.p[1], r.p[2]], ...angles });
        }
        if (readings.length === 0) continue;
        setIds.add(s.id);
        out.push({
            id: s.id,
            name: typeof s.name === 'string' && s.name.trim() ? s.name.trim() : kind === 'plane' ? 'Planes' : 'Lines',
            kind,
            source: s.source === 'hand' || s.source === 'suggested' ? s.source : 'columns',
            color: typeof s.color === 'string' && s.color ? s.color : SET_COLOURS[out.length % SET_COLOURS.length],
            visible: s.visible !== false,
            follow: s.follow !== false,
            readings,
        });
    }
    return out;
}

// ---------------------------------------------------------------------------
// From the columns of a table
// ---------------------------------------------------------------------------

/** A table read by column: the open data, or a file */
export interface ReadingTable {
    numeric: (name: string) => ArrayLike<number> | null | undefined;
    /** A column as it is written (for naming sets by its values) */
    text: (name: string) => ArrayLike<unknown> | null | undefined;
}

export interface ReadingColumns {
    kind: ReadingSet['kind'];
    x: string;
    y: string;
    z: string;
    /** A plane's dip, or a line's plunge */
    dip: string;
    /** The bearing a plane dips towards (or its strike), or the bearing a line plunges towards */
    direction: string;
    /** `direction` is a strike: the plane dips to its right (the right-hand rule) */
    strike?: boolean;
    /** One set for each value of this column (none: every row in one set) */
    splitBy?: string | null;
    /** The set's name (with `splitBy`, what a row without a value goes under) */
    name: string;
    /** Only these rows (null: every row) */
    rows?: ArrayLike<number> | null;
}

export interface NewReadingSet {
    name: string;
    kind: ReadingSet['kind'];
    source: ReadingSet['source'];
    /** The model follows it from the start (left out: it does when it comes alone, not when it is one of several) */
    follow?: boolean;
    readings: { p: Vec3; dip: number; direction: number }[];
}

export type SetsFromTable =
    | { ok: true; sets: NewReadingSet[]; found: number; of: number; notes: string[] }
    /** no-columns = a column it needs is missing; none = no row has a place and both angles; too-many = more sets than a scene keeps */
    | { ok: false; reason: 'no-columns' | 'none' } | { ok: false; reason: 'too-many'; sets: number };

/**
 * Readings from the rows of a table: every row with a place and both
 * angles. Angles out of range are taken as not measured (-99 and the like
 * stand for "none" in many tables): a dip outside 0-90, a plunge outside
 * -90 to 90, a bearing outside 0-360.
 */
export function setsFromTable(table: ReadingTable, c: ReadingColumns): SetsFromTable {
    const x = table.numeric(c.x), y = table.numeric(c.y), z = table.numeric(c.z);
    const dip = table.numeric(c.dip), direction = table.numeric(c.direction);
    const split = c.splitBy ? table.text(c.splitBy) : null;
    if (!x || !y || !z || !dip || !direction || (c.splitBy && !split)) return { ok: false, reason: 'no-columns' };
    const n = c.rows ? c.rows.length : x.length;
    const byName = new Map<string, NewReadingSet>();
    let found = 0, outOfRange = 0, noPlace = 0;
    for (let k = 0; k < n; k++) {
        const i = c.rows ? c.rows[k] : k;
        const d = dip[i], a = direction[i];
        if (!isNumber(d) || !isNumber(a)) continue;
        if (a < 0 || a > 360 || (c.kind === 'plane' ? d < 0 || d > 90 : Math.abs(d) > 90)) { outOfRange++; continue; }
        if (!isNumber(x[i]) || !isNumber(y[i]) || !isNumber(z[i])) { noPlace++; continue; }
        const angles = c.kind === 'line' ? cleanLine(d, a) : c.strike ? planeFromStrike(d, a) : cleanPlane(d, a);
        if (!angles) continue;
        const value = split ? String(split[i] ?? '').trim() : '';
        const name = value || c.name;
        let set = byName.get(name);
        if (!set) {
            set = { name, kind: c.kind, source: 'columns', readings: [] };
            byName.set(name, set);
        }
        set.readings.push({ p: [x[i], y[i], z[i]], ...angles });
        found++;
    }
    if (found === 0) return { ok: false, reason: 'none' };
    if (byName.size > MAX_SETS) return { ok: false, reason: 'too-many', sets: byName.size };
    const notes: string[] = [];
    const rows = (k: number) => `${k.toLocaleString()} ${k === 1 ? 'row' : 'rows'}`;
    if (outOfRange > 0) notes.push(`${rows(outOfRange)} with an angle out of range ${outOfRange === 1 ? 'was' : 'were'} left out.`);
    if (noPlace > 0) notes.push(`${rows(noPlace)} with angles but no place ${noPlace === 1 ? 'was' : 'were'} left out.`);
    const sets = [...byName.values()].sort((p, q) => q.readings.length - p.readings.length);
    for (const set of sets) {
        if (set.readings.length <= MAX_SET_READINGS) continue;
        const all = set.readings.length;
        const keep = pickSpread(set.readings.flatMap(r => r.p), MAX_SET_READINGS);
        set.readings = keep.map(i => set.readings[i]);
        notes.push(`${set.name} has ${all.toLocaleString()} readings: ${set.readings.length.toLocaleString()} spread evenly through them were kept.`);
    }
    return { ok: true, sets, found, of: n, notes };
}

const lower = (s: string) => s.trim().toLowerCase().replace(/[\s_.-]+/g, '');
const DIP = ['dip', 'dipangle', 'dipdeg', 'truedip'];
const DIP_DIRECTION = ['dipdirection', 'dipdir', 'dipazimuth', 'dipazi', 'dipdirn', 'dd', 'ddr', 'azimuth', 'azi'];
const STRIKE = ['strike', 'strikerhr', 'strikeazimuth', 'strikeazi'];
const PLUNGE = ['plunge', 'plungeangle', 'plungedeg', 'plg'];
const TREND = ['trend', 'plungedirection', 'plungedir', 'plungeazimuth', 'plungeazi', 'trendazimuth', 'lineationtrend', 'azimuth', 'azi'];
const TYPE = ['structure', 'structuretype', 'structtype', 'structurecode', 'structcode', 'feature', 'featuretype', 'type', 'kind', 'class', 'set'];

export interface StructureColumnGuess { dip: string; direction: string; strike: string; plunge: string; trend: string; type: string }

/** The columns that look like each angle, by their names ('' = none does). `type`: one that names what was measured. */
export function guessStructureColumns(numeric: readonly string[], text: readonly string[] = []): StructureColumnGuess {
    const find = (names: readonly string[], words: string[]) => {
        for (const w of words) {
            const hit = names.find(n => lower(n) === w);
            if (hit) return hit;
        }
        return '';
    };
    return {
        dip: find(numeric, DIP), direction: find(numeric, DIP_DIRECTION), strike: find(numeric, STRIKE),
        plunge: find(numeric, PLUNGE), trend: find(numeric, TREND), type: find(text, TYPE),
    };
}

export interface CsvTable {
    /** Every column, and those that hold numbers */
    names: string[];
    numericNames: string[];
    rows: number;
    table: ReadingTable;
}

/** The text of a CSV file with a header row as a table. Throws (with a plain message) when it has no rows. */
export function tableFromCsv(text: string): CsvTable {
    const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy' });
    const rows = parsed.data.filter(r => r.some(c => String(c ?? '').trim() !== ''));
    if (rows.length < 2) throw new Error('The file needs a row of column names and at least one row under it.');
    const names = rows[0].map((c, k) => String(c ?? '').trim() || `Column ${k + 1}`);
    const body = rows.slice(1);
    const num = (v: unknown) => { const t = String(v ?? '').trim(); return t === '' ? NaN : Number(t); };
    const numeric = new Map<string, Float64Array>(), written = new Map<string, string[]>();
    names.forEach((name, k) => {
        if (written.has(name)) return;
        const column = body.map(r => String(r[k] ?? '').trim());
        written.set(name, column);
        const values = Float64Array.from(column, num);
        let filled = 0, numbers = 0;
        column.forEach((c, i) => { if (c !== '') { filled++; if (Number.isFinite(values[i])) numbers++; } });
        // A column of numbers may have the odd word in it ("NA", "-")
        if (filled > 0 && numbers >= 0.8 * filled) numeric.set(name, values);
    });
    return {
        names: [...written.keys()], numericNames: [...numeric.keys()], rows: body.length,
        table: { numeric: name => numeric.get(name), text: name => written.get(name) },
    };
}

// ---------------------------------------------------------------------------
// Marks to draw
// ---------------------------------------------------------------------------

export interface SetMark {
    /** xyz triples (world) */
    vertices: Float64Array;
    triangles: Uint32Array;
    /** Pairs of vertices joined by a line */
    lines: Uint32Array;
}

const RIM = 12;

/**
 * A set drawn in space. A plane is a disc `size` across lying as measured,
 * with a tick from its edge down the dip. A line is an arrow `size` long
 * pointing down the plunge.
 */
export function setMark<R extends { p: Vec3; dip: number; direction: number }>(set: { kind: ReadingSet['kind']; readings: readonly R[] }, size: number): SetMark {
    const r = size / 2, n = set.readings.length;
    const plane = set.kind === 'plane';
    const vertices = new Float64Array(n * 3 * (plane ? RIM + 2 : 6));
    const triangles = new Uint32Array(plane ? n * RIM * 3 : 0);
    const lines = new Uint32Array(n * 2 * (plane ? RIM + 1 : 5));
    let v = 0, t = 0, l = 0;
    const put = (p: Vec3, a: number, u: ArrayLike<number>, b = 0, w: ArrayLike<number> = u) => {
        vertices[v * 3] = p[0] + a * u[0] + b * w[0];
        vertices[v * 3 + 1] = p[1] + a * u[1] + b * w[1];
        vertices[v * 3 + 2] = p[2] + a * u[2] + b * w[2];
        return v++;
    };
    for (const reading of set.readings) {
        const a = reading.direction * RAD;
        if (plane) {
            const strike = [Math.cos(a), -Math.sin(a), 0], down = lineVector(reading.dip, reading.direction);
            const centre = put(reading.p, 0, down);
            for (let k = 0; k < RIM; k++) {
                const at = 2 * Math.PI * k / RIM;
                // The first place on the rim is straight down the dip
                put(reading.p, r * Math.cos(at), down, r * Math.sin(at), strike);
            }
            for (let k = 0; k < RIM; k++) {
                const p = centre + 1 + k, q = centre + 1 + (k + 1) % RIM;
                triangles[t++] = centre; triangles[t++] = p; triangles[t++] = q;
                lines[l++] = p; lines[l++] = q;
            }
            lines[l++] = centre + 1;
            lines[l++] = put(reading.p, 1.6 * r, down);
        } else {
            const along = lineVector(reading.dip, reading.direction);
            // Two ways square to it, for the barbs: one level
            const side = unit([along[1], -along[0], 0]) ?? [1, 0, 0];
            const other = [along[1] * side[2] - along[2] * side[1], along[2] * side[0] - along[0] * side[2], along[0] * side[1] - along[1] * side[0]];
            const tail = put(reading.p, -r, along), tip = put(reading.p, r, along);
            lines[l++] = tail; lines[l++] = tip;
            for (const [w, sign] of [[side, 1], [side, -1], [other, 1], [other, -1]] as const) {
                lines[l++] = tip;
                lines[l++] = put(reading.p, 0.55 * r, along, sign * 0.2 * r, w);
            }
        }
    }
    return { vertices, triangles, lines };
}
