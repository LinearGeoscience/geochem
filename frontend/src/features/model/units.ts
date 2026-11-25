/**
 * Model units: logged codes grouped into the units a model is built of (pure,
 * unit-tested).
 *
 * A unit map reads one or more logging columns. A code is a row's values of
 * those columns together ("BAS + SER" with two columns), and each unit is one
 * or more codes: grouping puts several codes in one unit, splitting gives each
 * code of a unit a unit of its own. Codes in no unit count as not logged.
 *
 * Intervals can also be given to a unit by hand, whatever they were logged as
 * (`reassign`). That is kept by hole and depth, not by row, so it holds when
 * the logging is read in again: every interval of the hole whose middle is in
 * the range is of the unit.
 *
 * Short stretches can be cleaned, unit by unit (`ModelUnit.minRun`): a stretch
 * of a unit shorter than its length, with other units above and below it, is
 * read as the unit round it (the same unit above and below) or left out
 * (between two units). The logging itself is never changed, a stretch given
 * by hand is never cleaned, and `unitsOfRows(..., true)` reads it as logged.
 *
 * Units are listed in order down the holes, and their colours follow that
 * order, so a section reads like a column of the stratigraphy.
 */
import type { HoleLog } from './contacts';
import type { BodyRule, ContactRule, ModelUnit, Reassignment, UnitMap } from './types';

/** Between the values of the columns of a code made of several columns */
export const CODE_JOIN = ' + ';
export const MAX_UNIT_MAPS = 20;
/** A map holds at most this many units, and the dialog lists at most this many codes */
export const MAX_UNITS = 200;
/** At most this many stretches of hole given to units by hand, in one map */
export const MAX_REASSIGNED = 5000;

/** Colours of units in order down the holes: light near the top, darker and warmer below, then round again */
export const UNIT_COLORS = [
    '#f2d16b', '#e8a33d', '#c9674a', '#9c4f7d', '#5c6fb3', '#3c9c9a',
    '#7fb65a', '#b8b8b8', '#d98fb0', '#8a6b4e', '#4f7f3a', '#2f4f7f',
];

type Text = string | null | undefined;

/** A column of numbers is taken as logging when it holds no more than this many different whole numbers (codes) */
const MAX_CODES = 25;

/** Whole-number codes, a few of them: logging kept as numbers (weathering 1 to 5). Measurements fail this at once. */
export function looksLikeCodes(values: ArrayLike<number>): boolean {
    const seen = new Set<number>();
    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (!Number.isFinite(v)) continue;
        if (!Number.isInteger(v)) return false;
        if (!seen.has(v)) {
            seen.add(v);
            if (seen.size > MAX_CODES) return false;
        }
    }
    return seen.size > 1;
}

/** A row's code from its values of the map's columns ('' when every one is blank). */
export function codeOf(parts: readonly Text[]): string {
    const trimmed = parts.map(p => (p ?? '').trim());
    return trimmed.every(p => p === '') ? '' : trimmed.join(CODE_JOIN);
}

/** The code of every row, from the columns' values. */
export function codesOf(columns: readonly ArrayLike<Text>[]): string[] {
    const n = columns.length ? columns[0].length : 0;
    const out = new Array<string>(n);
    if (columns.length === 1) {
        for (let i = 0; i < n; i++) out[i] = (columns[0][i] ?? '').trim();
        return out;
    }
    for (let i = 0; i < n; i++) out[i] = codeOf(columns.map(c => c[i]));
    return out;
}

/** The rows of each hole, in order down it (rows with no hole or depth left out). */
function rowsByHole(hole: ArrayLike<Text>, from: ArrayLike<number>): Map<string, number[]> {
    const byHole = new Map<string, number[]>();
    for (let i = 0; i < from.length; i++) {
        const h = hole[i];
        if (!h || !Number.isFinite(from[i])) continue;
        const rows = byHole.get(h);
        if (rows) rows.push(i);
        else byHole.set(h, [i]);
    }
    for (const rows of byHole.values()) rows.sort((p, q) => from[p] - from[q]);
    return byHole;
}

/**
 * Where each interval ends: its To, or else where the next one down the hole
 * starts; the last of a hole without a To is as long as the one before it.
 * NaN for a row with no hole or depth.
 */
export function intervalEnds(hole: ArrayLike<Text>, from: ArrayLike<number>, to: ArrayLike<number> | null): Float64Array {
    const end = new Float64Array(from.length).fill(NaN);
    for (const rows of rowsByHole(hole, from).values()) {
        rows.forEach((i, k) => {
            const t = to ? to[i] : NaN;
            if (Number.isFinite(t) && t > from[i]) end[i] = t;
            else if (k + 1 < rows.length && from[rows[k + 1]] > from[i]) end[i] = from[rows[k + 1]];
        });
        rows.forEach((i, k) => {
            if (Number.isFinite(end[i])) return;
            const before = k > 0 ? end[rows[k - 1]] - from[rows[k - 1]] : 0;
            end[i] = from[i] + (before > 0 ? before : 0);
        });
    }
    return end;
}

/** A code, how many intervals have it, and how far down the holes it usually is (0 the top of a hole, 1 the bottom) */
export interface CodeStats {
    code: string;
    count: number;
    depth: number;
}

/**
 * The codes of a log in order down the holes: by where they usually are in
 * the holes they are in (each interval counted by its place in the order of
 * its hole's intervals, so long and short holes count alike).
 */
export function codeStats(log: { hole: ArrayLike<Text>; from: ArrayLike<number>; code: ArrayLike<Text> }): CodeStats[] {
    const sums = new Map<string, { count: number; depth: number }>();
    const add = (code: string, depth: number) => {
        const s = sums.get(code);
        if (s) { s.count++; s.depth += depth; } else sums.set(code, { count: 1, depth });
    };
    for (const rows of rowsByHole(log.hole, log.from).values()) {
        const logged = rows.filter(i => (log.code[i] ?? '').trim() !== '');
        logged.forEach((i, k) => add((log.code[i] ?? '').trim(), logged.length > 1 ? k / (logged.length - 1) : 0.5));
    }
    // Codes of rows not in a hole still count, with no place down the holes
    for (let i = 0; i < log.from.length; i++) {
        const code = (log.code[i] ?? '').trim();
        if (code && (!log.hole[i] || !Number.isFinite(log.from[i])) && !sums.has(code)) sums.set(code, { count: 0, depth: 0.5 });
    }
    return [...sums]
        .map(([code, s]) => ({ code, count: s.count, depth: s.count ? s.depth / s.count : 0.5 }))
        .sort((p, q) => p.depth - q.depth || q.count - p.count || p.code.localeCompare(q.code));
}

/** One unit for every code, in order down the holes, coloured in that order. */
export function unitsFromCodes(stats: readonly CodeStats[]): ModelUnit[] {
    return stats.slice(0, MAX_UNITS).map((s, k) => ({ name: s.code, color: UNIT_COLORS[k % UNIT_COLORS.length], codes: [s.code] }));
}

/**
 * The units in order down the holes, and coloured again in that order: a
 * unit is as far down as its codes are, counted by their intervals. Units
 * none of whose codes are logged go last, as they were.
 */
export function orderDownHoles(units: readonly ModelUnit[], stats: readonly CodeStats[]): ModelUnit[] {
    const byCode = new Map(stats.map(s => [s.code, s]));
    const placed = units.map((u, k) => {
        let count = 0, depth = 0;
        for (const c of u.codes) {
            const s = byCode.get(c);
            if (s && s.count) { count += s.count; depth += s.depth * s.count; }
        }
        return { u, k, depth: count ? depth / count : Infinity };
    });
    placed.sort((p, q) => p.depth - q.depth || p.k - q.k);
    return placed.map(({ u }, k) => ({ ...u, color: UNIT_COLORS[k % UNIT_COLORS.length] }));
}

/** Codes logged that are in no unit, in the order given */
export function codesInNoUnit(units: readonly ModelUnit[], codes: readonly string[]): string[] {
    const known = new Set(units.flatMap(u => u.codes));
    return codes.filter(c => c !== '' && !known.has(c));
}

/** Codes in no unit each made a unit of its own, after the others */
export function addCodes(units: readonly ModelUnit[], codes: readonly string[]): ModelUnit[] {
    const added = codesInNoUnit(units, codes);
    if (added.length === 0) return units.slice();
    const out = units.slice();
    const taken = new Set(out.map(u => u.name));
    for (const code of added) {
        if (out.length >= MAX_UNITS) break;
        const name = freeName(code, taken);
        taken.add(name);
        out.push({ name, color: freeColor(out), codes: [code] });
    }
    return out;
}

/** `base`, or `base (2)`, `base (3)` ... whichever is not taken */
function freeName(base: string, taken: ReadonlySet<string>): string {
    let name = base;
    for (let k = 2; taken.has(name); k++) name = `${base} (${k})`;
    return name;
}

/** The first of the unit colours no unit has, else the next round */
function freeColor(units: readonly ModelUnit[]): string {
    const used = new Set(units.map(u => u.color.toLowerCase()));
    return UNIT_COLORS.find(c => !used.has(c)) ?? UNIT_COLORS[units.length % UNIT_COLORS.length];
}

/**
 * A change to a map's units, and where each unit that went has gone: what
 * the surfaces that read the map and the intervals given to units by hand
 * are carried over by (a unit not in `carry` is as it was).
 */
export interface Regrouped {
    units: ModelUnit[];
    carry: Record<string, string[]>;
}

/**
 * The named units made one, in the place (and with the colour) of the first
 * of them, named `into` or as the first was. Null when fewer than two of
 * them are units of the map, or `into` is another unit's name.
 */
export function groupUnits(units: readonly ModelUnit[], names: readonly string[], into?: string): Regrouped | null {
    const merged = units.filter(u => names.includes(u.name));
    if (merged.length < 2) return null;
    const name = into?.trim() || merged[0].name;
    if (units.some(u => u.name === name && !merged.includes(u))) return null;
    // (Cleaned as the first of them was)
    const one: ModelUnit = { name, color: merged[0].color, codes: merged.flatMap(u => u.codes), ...(merged[0].minRun ? { minRun: merged[0].minRun } : {}) };
    const out: ModelUnit[] = [];
    for (const u of units) {
        if (u === merged[0]) out.push(one);
        else if (!merged.includes(u)) out.push(u);
    }
    return { units: out, carry: Object.fromEntries(merged.map(u => [u.name, [name]])) };
}

/**
 * Every code of a unit made a unit of its own, where the unit was: the first
 * keeps its colour, the others take colours no unit has. Each is named after
 * its code (the unit's own name is free for one of them). Null when the unit
 * has one code or is not there.
 */
export function splitUnit(units: readonly ModelUnit[], name: string): Regrouped | null {
    const at = units.findIndex(u => u.name === name);
    if (at < 0 || units[at].codes.length < 2) return null;
    const taken = new Set(units.filter((_, k) => k !== at).map(u => u.name));
    const parts: ModelUnit[] = [];
    const out = units.filter((_, k) => k !== at);
    for (const [k, code] of units[at].codes.entries()) {
        const part = freeName(code, taken);
        taken.add(part);
        parts.push({ name: part, color: k === 0 ? units[at].color : freeColor([...out, ...parts]), codes: [code], ...(units[at].minRun ? { minRun: units[at].minRun } : {}) });
    }
    out.splice(at, 0, ...parts);
    return { units: out, carry: { [name]: parts.map(p => p.name) } };
}

/** A unit renamed. Null when it is not there, or the name is blank or another unit's. */
export function renameUnit(units: readonly ModelUnit[], from: string, to: string): Regrouped | null {
    const name = to.trim();
    if (!name || name === from || !units.some(u => u.name === from) || units.some(u => u.name === name)) return null;
    return { units: units.map(u => (u.name === from ? { ...u, name } : u)), carry: { [from]: [name] } };
}

/** Unit names after a regrouping: carried where they went, dropped where the unit is gone, once each */
function carried(list: readonly string[], carry: Readonly<Record<string, string[]>>, names: ReadonlySet<string>): string[] {
    return [...new Set(list.flatMap(u => carry[u] ?? (names.has(u) ? [u] : [])))];
}

/**
 * A surface's rule after the units of the map it reads were regrouped: a
 * unit that went is where it went (both parts of a split unit on its side;
 * a grouped unit on the side of the first of its units that was on one). A
 * unit is on one side only.
 */
export function carryRule<R extends ContactRule | BodyRule>(rule: R, regrouped: Regrouped): R {
    const names = new Set(regrouped.units.map(u => u.name));
    if (rule.kind === 'body') {
        const inside = carried(rule.inside, regrouped.carry, names);
        return { ...rule, inside, ignore: carried(rule.ignore, regrouped.carry, names).filter(u => !inside.includes(u)) };
    }
    const sideA = carried(rule.sideA, regrouped.carry, names);
    // (The layers of its pile follow too: a unit split is its parts in the unit's place, units grouped are one layer)
    const pile = rule.pile ? carried(rule.pile, regrouped.carry, names) : null;
    const { pile: _was, ...rest } = rule;
    return { ...rest, sideA, sideB: carried(rule.sideB, regrouped.carry, names).filter(u => !sideA.includes(u)), ...(pile && pile.length > 1 ? { pile } : {}) } as R;
}

/** Stretches given to units by hand, after a regrouping (a split unit's go to its first part; a gone unit's go) */
export function carryReassigned(list: readonly Reassignment[], regrouped: Regrouped): Reassignment[] {
    const names = new Set(regrouped.units.map(u => u.name));
    return list.flatMap(r => {
        if (r.unit === '') return [r];
        const to = regrouped.carry[r.unit]?.[0] ?? (names.has(r.unit) ? r.unit : null);
        return to === null ? [] : [to === r.unit ? r : { ...r, unit: to }];
    });
}

const order = (p: Reassignment, q: Reassignment) => (p.hole < q.hole ? -1 : p.hole > q.hole ? 1 : p.from - q.from);

/**
 * Stretches of holes given to `unit` ('' = as if not logged), or put back as
 * logged (`unit` null). What was given before over the same stretch is cut
 * away; stretches of one unit that touch are joined. The list stays at most
 * MAX_REASSIGNED long: when it would not, it is returned as it was.
 */
export function reassign(list: readonly Reassignment[], stretches: readonly { hole: string; from: number; to: number }[], unit: string | null): Reassignment[] {
    let out = list.slice();
    for (const s of stretches) {
        const from = Math.min(s.from, s.to), to = Math.max(s.from, s.to);
        if (!s.hole || !Number.isFinite(from) || !Number.isFinite(to) || !(to > from)) continue;
        const next: Reassignment[] = [];
        for (const r of out) {
            if (r.hole !== s.hole || r.to <= from || r.from >= to) { next.push(r); continue; }
            if (r.from < from) next.push({ ...r, to: from });
            if (r.to > to) next.push({ ...r, from: to });
        }
        if (unit !== null) next.push({ hole: s.hole, from, to, unit });
        out = next;
    }
    out.sort(order);
    const joined: Reassignment[] = [];
    for (const r of out) {
        const last = joined[joined.length - 1];
        if (last && last.hole === r.hole && last.unit === r.unit && r.from <= last.to + 1e-9) last.to = Math.max(last.to, r.to);
        else joined.push({ ...r });
    }
    return joined.length > MAX_REASSIGNED ? list.slice() : joined;
}

/**
 * The stretches of hole some rows cover (rows next to each other down a hole
 * make one stretch): what a selection of samples gives a unit.
 */
export function rowStretches(
    rows: readonly number[], log: { hole: ArrayLike<Text>; from: ArrayLike<number>; to: ArrayLike<number> | null },
): { hole: string; from: number; to: number }[] {
    const end = intervalEnds(log.hole, log.from, log.to);
    const picked = rows
        .filter(i => i >= 0 && i < log.from.length && log.hole[i] && Number.isFinite(log.from[i]) && end[i] > log.from[i])
        .map(i => ({ hole: log.hole[i]!, from: log.from[i], to: end[i] }))
        .sort((p, q) => (p.hole < q.hole ? -1 : p.hole > q.hole ? 1 : p.from - q.from));
    const out: { hole: string; from: number; to: number }[] = [];
    for (const s of picked) {
        const last = out[out.length - 1];
        if (last && last.hole === s.hole && s.from <= last.to + 1e-9) last.to = Math.max(last.to, s.to);
        else out.push({ ...s });
    }
    return out;
}

type CodeLog = { hole: ArrayLike<Text>; from: ArrayLike<number>; to: ArrayLike<number> | null; code: ArrayLike<Text> };

/** Every row's unit as logged: its code's unit, unless a stretch given by hand holds the middle of its interval (`held`) */
function asLogged(log: CodeLog, map: Pick<UnitMap, 'units' | 'reassigned'>): { units: string[]; held: Uint8Array | null; end: Float64Array | null } {
    const unitOf = new Map<string, string>();
    for (const u of map.units) for (const c of u.codes) if (!unitOf.has(c)) unitOf.set(c, u.name);
    const n = log.from.length;
    const out = new Array<string>(n);
    for (let i = 0; i < n; i++) out[i] = unitOf.get((log.code[i] ?? '').trim()) ?? '';
    if (map.reassigned.length === 0) return { units: out, held: null, end: null };
    const byHole = new Map<string, Reassignment[]>();
    for (const r of map.reassigned) {
        const list = byHole.get(r.hole);
        if (list) list.push(r);
        else byHole.set(r.hole, [r]);
    }
    const end = intervalEnds(log.hole, log.from, log.to);
    const held = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        const list = log.hole[i] ? byHole.get(log.hole[i]!) : undefined;
        if (!list || !Number.isFinite(end[i])) continue;
        const mid = (log.from[i] + end[i]) / 2;
        const r = list.find(x => x.from <= mid && mid <= x.to);
        if (r) { out[i] = r.unit; held[i] = 1; }
    }
    return { units: out, held, end };
}

/** The units that are cleaned, with the length a stretch of each must have to be read as logged (null: none is) */
function cleanLimits(units: readonly ModelUnit[]): Map<string, number> | null {
    const limits = new Map<string, number>();
    for (const u of units) if (u.minRun !== undefined && u.minRun > 0) limits.set(u.name, u.minRun);
    return limits.size ? limits : null;
}

/** True when a map cleans the short stretches of any of its units */
export const cleans = (map: Pick<UnitMap, 'units'>): boolean => cleanLimits(map.units) !== null;

/**
 * The rows' units with the short stretches cleaned. Down each hole the
 * stretches of one unit are taken in turn, the shortest first: one shorter
 * than its unit's length, with a stretch above and below it, is read as the
 * unit round it when that is one unit (and the three become one stretch), and
 * left out ('') when it lies between two, or next to one that was left out.
 * So thin beds of two units by turns are all left out, and a stray interval
 * inside a thick unit is taken into it. The first and last stretch of a hole are never cleaned (the end of a
 * hole a little way into a unit is where that unit starts), nor is a stretch
 * with an interval given by hand. Unlogged ground is passed over.
 */
function cleanShort(log: CodeLog, units: readonly string[], limits: ReadonlyMap<string, number>, held: Uint8Array | null, end: Float64Array): string[] {
    const out = units.slice();
    interface Run { unit: string; rows: number[]; length: number; held: boolean }
    for (const rows of rowsByHole(log.hole, log.from).values()) {
        const runs: Run[] = [];
        for (const i of rows) {
            const unit = units[i];
            if (!unit) continue;
            const length = Number.isFinite(end[i]) ? Math.max(0, end[i] - log.from[i]) : 0;
            const last = runs[runs.length - 1];
            if (last && last.unit === unit) {
                last.rows.push(i);
                last.length += length;
                if (held?.[i]) last.held = true;
            } else runs.push({ unit, rows: [i], length, held: !!held?.[i] });
        }
        for (;;) {
            let at = -1;
            for (let k = 1; k + 1 < runs.length; k++) {
                const run = runs[k], limit = limits.get(run.unit);
                if (limit === undefined || run.held || !(run.length < limit - 1e-9)) continue;
                if (at < 0 || run.length < runs[at].length - 1e-9) at = k;
            }
            if (at < 0) break;
            const run = runs[at], up = runs[at - 1], down = runs[at + 1];
            if (up.unit !== '' && up.unit === down.unit) {
                for (const i of run.rows) out[i] = up.unit;
                up.rows.push(...run.rows, ...down.rows);
                up.length += run.length + down.length;
                up.held = up.held || down.held;
                runs.splice(at, 2);
            } else {
                // (It stays in the list as ground left out: what lies next to it is not inside one unit)
                for (const i of run.rows) out[i] = '';
                run.unit = '';
            }
        }
    }
    return out;
}

/**
 * The unit of every row of a log whose codes are the map's codes ('' = in
 * no unit, or given to none by hand): its code's unit, unless a stretch
 * given by hand holds the middle of its interval; then the short stretches
 * of the units that are cleaned are read as the unit round them or left out
 * (`cleanShort`). `raw`: as logged, with nothing cleaned.
 */
export function unitsOfRows(log: CodeLog, map: Pick<UnitMap, 'units' | 'reassigned'>, raw = false): string[] {
    const { units, held, end } = asLogged(log, map);
    const limits = raw ? null : cleanLimits(map.units);
    return limits ? cleanShort(log, units, limits, held, end ?? intervalEnds(log.hole, log.from, log.to)) : units;
}

/** What cleaning does to a unit's short stretches */
export interface Cleaned {
    unit: string;
    /** Stretches of it not read as logged, and their metres */
    stretches: number;
    metres: number;
    /** Of those metres: read as the unit round them (the rest are left out) */
    absorbed: number;
}

/**
 * What the cleaning of a map changes, unit by unit in the map's order (a
 * unit nothing of which is cleaned is left out): the stretches logged as it
 * that are read as another unit or left out.
 */
export function cleanedStretches(log: CodeLog, map: Pick<UnitMap, 'units' | 'reassigned'>): Cleaned[] {
    const { units, held, end: known } = asLogged(log, map);
    const limits = cleanLimits(map.units);
    if (!limits) return [];
    const end = known ?? intervalEnds(log.hole, log.from, log.to);
    const read = cleanShort(log, units, limits, held, end);
    const per = new Map<string, Cleaned>();
    for (const rows of rowsByHole(log.hole, log.from).values()) {
        let before = '';
        for (const i of rows) {
            if (!units[i]) continue;
            if (read[i] === units[i]) { before = ''; continue; }
            const c = per.get(units[i]) ?? { unit: units[i], stretches: 0, metres: 0, absorbed: 0 };
            per.set(units[i], c);
            const length = Number.isFinite(end[i]) ? Math.max(0, end[i] - log.from[i]) : 0;
            if (before !== units[i]) c.stretches++;
            c.metres += length;
            if (read[i] !== '') c.absorbed += length;
            before = units[i];
        }
    }
    return map.units.filter(u => per.has(u.name)).map(u => per.get(u.name)!);
}

/** A log of codes as a log of the map's units (`raw`: as logged, with nothing cleaned) */
export function applyUnits(log: HoleLog, map: Pick<UnitMap, 'units' | 'reassigned'>, raw = false): HoleLog {
    return { ...log, code: unitsOfRows(log, map, raw) };
}

/** How many intervals each unit of the map has, in the map's order (units with none included) */
export function unitIntervalCounts(units: readonly string[], map: Pick<UnitMap, 'units'>): { unit: string; count: number }[] {
    const counts = new Map(map.units.map(u => [u.name, 0]));
    for (const u of units) if (counts.has(u)) counts.set(u, counts.get(u)! + 1);
    return [...counts].map(([unit, count]) => ({ unit, count }));
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** Unit maps as saved, checked (a bad one is left out, a bad unit or stretch dropped). */
export function readUnitMaps(saved: unknown): UnitMap[] {
    const out: UnitMap[] = [];
    for (const raw of Array.isArray(saved) ? saved : []) {
        const m = raw as Partial<UnitMap> | null;
        if (!m || !isText(m.id) || out.some(x => x.id === m.id) || !Array.isArray(m.columns)) continue;
        const columns = [...new Set(m.columns.filter(isText))];
        if (columns.length === 0) continue;
        const units: ModelUnit[] = [];
        const codes = new Set<string>();
        for (const u of (Array.isArray(m.units) ? m.units : []) as Partial<ModelUnit>[]) {
            if (!u || !isText(u.name) || units.some(x => x.name === u.name!.trim()) || units.length >= MAX_UNITS) continue;
            // A code is in one unit only
            const mine = [...new Set((Array.isArray(u.codes) ? u.codes : []).filter(isText).map(c => c.trim()))].filter(c => !codes.has(c));
            mine.forEach(c => codes.add(c));
            const minRun = typeof u.minRun === 'number' && Number.isFinite(u.minRun) && u.minRun > 0 ? u.minRun : null;
            units.push({ name: u.name.trim(), color: isText(u.color) ? u.color : UNIT_COLORS[units.length % UNIT_COLORS.length], codes: mine, ...(minRun ? { minRun } : {}) });
        }
        const reassigned: Reassignment[] = [];
        for (const r of (Array.isArray(m.reassigned) ? m.reassigned : []) as Partial<Reassignment>[]) {
            if (!r || !isText(r.hole) || !Number.isFinite(r.from) || !Number.isFinite(r.to) || !(r.to! > r.from!) || typeof r.unit !== 'string') continue;
            if (r.unit !== '' && !units.some(u => u.name === r.unit)) continue;
            reassigned.push({ hole: r.hole, from: r.from!, to: r.to!, unit: r.unit });
        }
        out.push({
            id: m.id, name: isText(m.name) ? m.name.trim() : `Units ${out.length + 1}`,
            ...(isText(m.table) ? { table: m.table } : {}), columns, units, reassigned: reassigned.sort(order).slice(0, MAX_REASSIGNED),
        });
        if (out.length >= MAX_UNIT_MAPS) break;
    }
    return out;
}
