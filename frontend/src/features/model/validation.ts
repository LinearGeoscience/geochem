/**
 * What is the matter with the drillholes and their logging, before a model
 * is made from them (Phase 226; pure, unit-tested).
 *
 * A model can only be as right as what it is made from, and the usual
 * faults of drillhole tables are silent: an interval logged twice, a hole
 * with no collar whose logging is simply not there, a code written two
 * ways and so read as two. Each is found here and said in a sentence, with
 * how many there are and the first few as examples. Nothing is changed.
 *
 * problem: the model is wrong, or blind, where it is. warning: worth a
 * look. note: for knowing (gaps in the logging are usual).
 */
import type { ModelUnit } from './types';
import { groupUnits, type Regrouped } from './units';

/** Logged codes, row by row, to look at for one code written several ways */
export interface CodeSource {
    /** What they are called where it is said (a column, or the columns of a grouping) */
    name: string;
    values: ArrayLike<string | null | undefined>;
    /** The grouping that reads them (its id) and its units: only codes whose ways are not all in one unit are then said */
    unitMap?: string;
    units?: readonly Pick<ModelUnit, 'name' | 'codes'>[];
}

/** A table of intervals down the holes: the samples of the dataset, or a table logged down the holes */
export interface CheckedTable {
    /** What it is called where it is said */
    name: string;
    hole: ArrayLike<string | null | undefined>;
    from: ArrayLike<number>;
    /** Null: a table of depth points (readings): only its holes are looked at */
    to: ArrayLike<number> | null;
    /** The samples of the dataset: its rows carry their own places (a hole of it needs no collar), and duplicates are usual in it */
    samples?: boolean;
    /** Its codes that are, or can be, read as the units of a model */
    codes?: CodeSource[];
}

export interface HolesToCheck {
    /** Null: the project has no collar table (the samples carry their own places) */
    collar: { hole: ArrayLike<string>; x: ArrayLike<number>; y: ArrayLike<number>; z: ArrayLike<number> } | null;
    /** The hole of each survey row */
    survey: { hole: ArrayLike<string> } | null;
    tables: CheckedTable[];
}

export type FindingKind = 'reversed' | 'overlap' | 'duplicate' | 'gaps' | 'noDepth' | 'noCollar' | 'collarNoPlace' | 'collarNoHeight' | 'collarTwice' | 'noSurvey' | 'codeVariants';

export interface Finding {
    kind: FindingKind;
    severity: 'problem' | 'warning' | 'note';
    /** The table it is in (null: the collars or the surveys) */
    table: string | null;
    /** How many (intervals, rows, holes or codes: the sentence says which) */
    count: number;
    /** What, and what it does to a model: one or two full sentences */
    text: string;
    /** The first few, each in words */
    examples: string[];
    /** codeVariants of a grouping: the grouping, and the ways each code is written (most rows first) */
    unitMap?: string;
    ways?: string[][];
}

const EXAMPLES = 3;
/** Depths this close are the same depth (m) */
const SAME = 1e-6;

const many = (n: number, one: string, more = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : more}`;
const metres = (v: number) => `${Number(v.toFixed(2)).toLocaleString()} m`;
const holeOf = (v: string | null | undefined) => (v == null ? '' : String(v).trim());

function push(out: Finding[], kind: FindingKind, severity: Finding['severity'], table: string | null, count: number, text: string, examples: string[], more: Partial<Finding> = {}): void {
    if (count > 0) out.push({ kind, severity, table, count, text, examples: examples.slice(0, EXAMPLES), ...more });
}

function checkIntervals(table: CheckedTable, out: Finding[]): void {
    const to = table.to;
    if (!to) return;
    const n = table.from.length, name = table.name;
    const byHole = new Map<string, number[]>();
    let noDepth = 0, reversed = 0;
    const noDepthAt: string[] = [], reversedAt: string[] = [];
    for (let i = 0; i < n; i++) {
        const hole = holeOf(table.hole[i]);
        if (!hole) continue;
        const a = table.from[i], b = to[i];
        if (!Number.isFinite(a) || !Number.isFinite(b)) {
            noDepth++;
            if (noDepthAt.length < EXAMPLES) noDepthAt.push(`${hole}, row ${(i + 1).toLocaleString()}`);
            continue;
        }
        if (b <= a + SAME) {
            reversed++;
            if (reversedAt.length < EXAMPLES) reversedAt.push(`${hole}: ${metres(a)} to ${metres(b)}`);
            continue;
        }
        const rows = byHole.get(hole);
        if (rows) rows.push(i);
        else byHole.set(hole, [i]);
    }
    let overlap = 0, duplicate = 0, gaps = 0, gapMetres = 0;
    const overlapAt: string[] = [], duplicateAt: string[] = [], gapAt: string[] = [];
    for (const [hole, rows] of byHole) {
        rows.sort((p, q) => table.from[p] - table.from[q] || to[p] - to[q]);
        // (How far down the hole has been logged so far, and by which row: an interval that starts above that overlaps it)
        let reach = -Infinity, reachRow = -1;
        for (const i of rows) {
            const a = table.from[i], b = to[i];
            if (reachRow >= 0 && Math.abs(a - table.from[reachRow]) <= SAME && Math.abs(b - to[reachRow]) <= SAME) {
                duplicate++;
                if (duplicateAt.length < EXAMPLES) duplicateAt.push(`${hole}: ${metres(a)} to ${metres(b)}`);
                continue;
            }
            if (a < reach - SAME) {
                overlap++;
                if (overlapAt.length < EXAMPLES) overlapAt.push(`${hole}: ${metres(a)} to ${metres(b)} overlaps ${metres(table.from[reachRow])} to ${metres(to[reachRow])}`);
            } else if (reachRow >= 0 && a > reach + SAME) {
                gaps++;
                gapMetres += a - reach;
                if (gapAt.length < EXAMPLES) gapAt.push(`${hole}: ${metres(reach)} to ${metres(a)}`);
            }
            if (b > reach) { reach = b; reachRow = i; }
        }
    }
    // (Samples that overlap matter to a model only when a grouping reads its units from them)
    const read = !table.samples || (table.codes ?? []).some(c => c.unitMap);
    push(out, 'overlap', read ? 'problem' : 'warning', name, overlap,
        read
            ? `${many(overlap, 'interval')} in ${name} ${overlap === 1 ? 'overlaps' : 'overlap'} another in the same hole: that ground is logged twice, and a model reads both.`
            : `${many(overlap, 'interval')} in ${name} ${overlap === 1 ? 'overlaps' : 'overlap'} another in the same hole: that ground is sampled twice.`, overlapAt);
    push(out, 'reversed', 'problem', name, reversed,
        `${many(reversed, 'interval')} in ${name} ${reversed === 1 ? 'ends' : 'end'} at or above where ${reversed === 1 ? 'it starts' : 'they start'}: ${reversed === 1 ? 'it has' : 'they have'} no length. Check ${reversed === 1 ? 'its' : 'their'} depths.`, reversedAt);
    push(out, 'duplicate', table.samples ? 'note' : 'warning', name, duplicate,
        table.samples
            ? `${many(duplicate, 'row')} in ${name} ${duplicate === 1 ? 'repeats' : 'repeat'} another row of the same hole and depths (duplicate samples are usual).`
            : `${many(duplicate, 'row')} in ${name} ${duplicate === 1 ? 'repeats' : 'repeat'} another row of the same hole and depths: logging entered twice.`, duplicateAt);
    push(out, 'noDepth', 'warning', name, noDepth,
        `${many(noDepth, 'row')} in ${name} ${noDepth === 1 ? 'has' : 'have'} a hole but no depth: ${noDepth === 1 ? 'it is' : 'they are'} not read.`, noDepthAt);
    push(out, 'gaps', 'note', name, gaps,
        `${many(gaps, 'stretch', 'stretches')} between the intervals of ${name} ${gaps === 1 ? 'is' : 'are'} not logged, ${metres(gapMetres)} in all. A model takes nothing from ground that is not logged.`, gapAt);
}

/** A code with capitals and the spaces inside it taken out of account: what two ways of writing one code share */
const folded = (code: string) => code.replace(/\s+/g, ' ').toLowerCase();

function checkCodes(table: CheckedTable, out: Finding[]): void {
    for (const source of table.codes ?? []) {
        const { values, units } = source;
        const ways = new Map<string, Map<string, number>>();
        for (let i = 0; i < values.length; i++) {
            // (Spaces before and after a code are not part of it: units.codesOf)
            const text = (values[i] ?? '').trim();
            if (!text) continue;
            const key = folded(text);
            let w = ways.get(key);
            if (!w) { w = new Map(); ways.set(key, w); }
            w.set(text, (w.get(text) ?? 0) + 1);
        }
        const unitOf = new Map<string, string>();
        for (const u of units ?? []) for (const c of u.codes) unitOf.set(c, u.name);
        // (In a grouping, ways that are all in one unit are read as one already)
        const split = [...ways.values()].filter(w => w.size > 1 && (!units || new Set([...w.keys()].map(c => unitOf.get(c) ?? null)).size > 1));
        if (split.length === 0) continue;
        const rows = (w: Map<string, number>) => [...w.values()].reduce((sum, v) => sum + v, 0);
        // (Those with the most rows first: they matter most)
        split.sort((p, q) => rows(q) - rows(p));
        const listed = split.map(w => [...w.entries()].sort((p, q) => q[1] - p[1]));
        const n = split.length;
        push(out, 'codeVariants', 'warning', table.name, n,
            units
                ? `${many(n, 'code')} in ${source.name} of ${table.name} ${n === 1 ? 'is' : 'are'} written more than one way (capitals or spaces), and the ways are not all in one unit: part of that rock is read as another unit, or left out.`
                : `${many(n, 'code')} in ${source.name} of ${table.name} ${n === 1 ? 'is' : 'are'} written more than one way (capitals or spaces). Each way is a code of its own: when codes are grouped into units, put every way in the same one.`,
            listed.map(w => w.map(([text, k]) => `"${text}" (${many(k, 'row')})`).join(', ')),
            { ways: listed.map(w => w.map(([text]) => text)), ...(source.unitMap ? { unitMap: source.unitMap } : {}) });
    }
}

/**
 * A grouping's units with every way of writing a code in one unit, where
 * that can be done without a choice: units that hold nothing but ways of
 * one code are made one (named as the first of them), and ways in no unit
 * join the one unit that has the others. A code whose ways are in units
 * with other codes is left: which is right is for the user to say. Null:
 * nothing to do.
 */
export function joinWays(units: readonly ModelUnit[], ways: readonly (readonly string[])[]): Regrouped | null {
    let now: ModelUnit[] = units.slice();
    const carry: Record<string, string[]> = {};
    let changed = false;
    for (const group of ways) {
        const mine = new Set(group);
        const holding = now.filter(u => u.codes.some(c => mine.has(c)));
        if (holding.length === 0) continue;
        if (holding.length > 1) {
            if (!holding.every(u => u.codes.every(c => mine.has(c)))) continue;
            const joined = groupUnits(now, holding.map(u => u.name));
            if (!joined) continue;
            now = joined.units;
            Object.assign(carry, joined.carry);
            changed = true;
        }
        const known = new Set(now.flatMap(u => u.codes));
        const loose = group.filter(c => !known.has(c));
        const home = now.find(u => u.codes.some(c => mine.has(c)));
        if (loose.length > 0 && home) {
            now = now.map(u => (u === home ? { ...u, codes: [...u.codes, ...loose] } : u));
            changed = true;
        }
    }
    return changed ? { units: now, carry } : null;
}

/** Everything found, the problems first, then the warnings, then the notes (each in the order of the tables) */
export function validateHoles(input: HolesToCheck): Finding[] {
    const out: Finding[] = [];
    const collar = input.collar;
    const collared = new Set<string>();
    if (collar) {
        const seen = new Map<string, number>();
        const noPlace: string[] = [], noHeight: string[] = [];
        for (let i = 0; i < collar.hole.length; i++) {
            const hole = holeOf(collar.hole[i]);
            if (!hole) continue;
            seen.set(hole, (seen.get(hole) ?? 0) + 1);
            collared.add(hole);
            if (!Number.isFinite(collar.x[i]) || !Number.isFinite(collar.y[i])) noPlace.push(hole);
            else if (!Number.isFinite(collar.z[i])) noHeight.push(hole);
        }
        const twice = [...seen].filter(([, k]) => k > 1).map(([hole]) => hole);
        push(out, 'collarNoPlace', 'problem', null, noPlace.length,
            `${many(noPlace.length, 'collar')} ${noPlace.length === 1 ? 'has' : 'have'} no easting or northing: ${noPlace.length === 1 ? 'that hole has' : 'those holes have'} no path, and what is logged down ${noPlace.length === 1 ? 'it' : 'them'} is left out.`, noPlace);
        push(out, 'collarNoHeight', 'problem', null, noHeight.length,
            `${many(noHeight.length, 'collar')} ${noHeight.length === 1 ? 'has' : 'have'} no height: ${noHeight.length === 1 ? 'that hole is' : 'those holes are'} put at a height of 0, which is seldom where ${noHeight.length === 1 ? 'it is' : 'they are'}.`, noHeight);
        push(out, 'collarTwice', 'warning', null, twice.length,
            `${many(twice.length, 'hole')} ${twice.length === 1 ? 'is' : 'are'} in the collars more than once: only the first of the rows is used.`, twice);
        if (input.survey) {
            const surveyed = new Set<string>();
            for (let i = 0; i < input.survey.hole.length; i++) surveyed.add(holeOf(input.survey.hole[i]));
            const none = [...collared].filter(hole => !surveyed.has(hole));
            push(out, 'noSurvey', 'problem', null, none.length,
                `${many(none.length, 'hole')} ${none.length === 1 ? 'has' : 'have'} a collar but no survey: ${none.length === 1 ? 'it has' : 'they have'} no path, and what is logged down ${none.length === 1 ? 'it' : 'them'} is left out.`, none);
        }
    }
    for (const table of input.tables) {
        if (collar && !table.samples) {
            const missing = new Map<string, number>();
            for (let i = 0; i < table.hole.length; i++) {
                const hole = holeOf(table.hole[i]);
                if (hole && !collared.has(hole)) missing.set(hole, (missing.get(hole) ?? 0) + 1);
            }
            push(out, 'noCollar', 'problem', table.name, missing.size,
                `${many(missing.size, 'hole')} in ${table.name} ${missing.size === 1 ? 'has' : 'have'} no collar: what is logged down ${missing.size === 1 ? 'it' : 'them'} has no place, and is left out. (A hole named differently in the two tables looks like this.)`,
                [...missing].map(([hole, rows]) => `${hole} (${many(rows, 'row')})`));
        }
        checkIntervals(table, out);
        checkCodes(table, out);
    }
    const rank = { problem: 0, warning: 1, note: 2 };
    return out.map((f, i) => ({ f, i })).sort((a, b) => rank[a.f.severity] - rank[b.f.severity] || a.i - b.i).map(x => x.f);
}

/** How many of each there are, for a line in the model's setup steps */
export function findingCounts(findings: readonly Finding[]): { problems: number; warnings: number } {
    return { problems: findings.filter(f => f.severity === 'problem').length, warnings: findings.filter(f => f.severity === 'warning').length };
}
