/**
 * Logging tables drawn in the views of the model (pure, unit-tested).
 *
 * Each interval of a table logged down the holes is drawn as a length of
 * cylinder on its hole's path, from its From to its To depth, in pieces of
 * at most about 5 m, so that it follows the hole where the hole bends and a
 * slice shows the part of it inside the slice. Rows whose hole has no path
 * are left out.
 *
 * An interval is coloured by one of:
 *  - the units of a unit map that reads the table (`units:<map id>`): the
 *    map's colours, the units the model is built of;
 *  - a column of the table (`column:<name>`). Where the samples are coloured
 *    by a column of the same name (the Attribute Manager), the table takes
 *    the samples' classes and colours, so a unit is one colour in the logging
 *    and in the samples. Otherwise codes are coloured in their order down the
 *    holes (as a unit map colours its units), and numbers along a ramp from
 *    the lowest to the highest.
 *
 * Intervals with nothing logged (blank, or no number) are not drawn.
 */
import { generateColorsFromPalette } from '../../utils/colorPalettes';
import { positionAt, type HoleTrace } from './desurvey';
import { tableText, type HoleTable } from './drillholes';
import type { UnitMap } from './types';
import { codesOf, codeStats, looksLikeCodes, MAX_UNITS, UNIT_COLORS, unitsOfRows } from './units';

/** What a table can be coloured by: `units:<map id>` or `column:<name>` */
export interface ColourChoice {
    value: string;
    label: string;
    kind: 'units' | 'codes' | 'numbers';
}

/** Intervals of a code in no unit of the map, or of a class the samples do not have */
export const OTHER_COLOR = '#9e9e9e';
const RAMP = 'Viridis';
const RAMP_STEPS = 64;

const isNumbers = (values: Float64Array | string[]): values is Float64Array => values instanceof Float64Array && !looksLikeCodes(values);

/** The unit maps that read the table, then its columns */
export function colourChoices(table: HoleTable, maps: readonly UnitMap[]): ColourChoice[] {
    return [
        ...maps.filter(m => m.table === table.id).map(m => ({ value: `units:${m.id}`, label: `${m.name} (units)`, kind: 'units' as const })),
        ...table.columns.map(c => ({ value: `column:${c.name}`, label: c.name, kind: isNumbers(c.values) ? 'numbers' as const : 'codes' as const })),
    ];
}

/** What a table is coloured by until a view says otherwise: the first unit map that reads it, else its first column of codes, else its first column */
export function defaultColouring(table: HoleTable, maps: readonly UnitMap[]): string | null {
    const choices = colourChoices(table, maps);
    return (choices.find(c => c.kind !== 'numbers') ?? choices[0])?.value ?? null;
}

/** The choice a view asked for when the table still has it, else the default */
export function colouringOf(table: HoleTable, maps: readonly UnitMap[], asked: unknown): string | null {
    return typeof asked === 'string' && colourChoices(table, maps).some(c => c.value === asked) ? asked : defaultColouring(table, maps);
}

/** How the samples are coloured (the Attribute Manager's colour classes), as a table can take it */
export interface SampleClasses {
    /** The column the samples are coloured by */
    field: string;
    /** A class holds the codes in `values`, or the numbers from `min` to `max` */
    classes: { label: string; color: string; values?: readonly string[]; min?: number; max?: number }[];
}

export interface LegendClass {
    label: string;
    color: string;
    /** Intervals of it in the table */
    count: number;
}

export type LogLegend =
    | { kind: 'classes'; title: string; items: LegendClass[] }
    | { kind: 'ramp'; title: string; min: number; max: number; colors: string[] };

export interface LogColours {
    /** rgba (0 to 1) of every row of the table; alpha 0: not drawn */
    rgba: Float32Array;
    legend: LogLegend;
}

/** An rgb colour from #rgb, #rrggbb(aa) or rgb(r, g, b); grey for anything else */
export function rgbOf(color: string): [number, number, number] {
    const c = color.trim();
    let m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c);
    if (m) return [0, 2, 4].map(k => parseInt(m![1].slice(k, k + 2), 16) / 255) as [number, number, number];
    m = /^#([0-9a-f]{3})$/i.exec(c);
    if (m) return [0, 1, 2].map(k => parseInt(m![1][k] + m![1][k], 16) / 255) as [number, number, number];
    const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(c);
    if (rgb) return [1, 2, 3].map(k => Math.min(255, Number(rgb[k])) / 255) as [number, number, number];
    return rgbOf(OTHER_COLOR);
}

/** Colours rows by a class index each (-1: other, -2: not drawn); counts the intervals of each */
function paint(n: number, classOf: (i: number) => number, colors: readonly string[]): { rgba: Float32Array; counts: number[]; other: number } {
    const rgb = colors.map(rgbOf);
    const grey = rgbOf(OTHER_COLOR);
    const rgba = new Float32Array(n * 4);
    const counts = new Array<number>(colors.length).fill(0);
    let other = 0;
    for (let i = 0; i < n; i++) {
        const k = classOf(i);
        if (k === -2) continue;
        const c = k >= 0 ? rgb[k] : grey;
        if (k >= 0) counts[k]++;
        else other++;
        rgba[i * 4] = c[0];
        rgba[i * 4 + 1] = c[1];
        rgba[i * 4 + 2] = c[2];
        rgba[i * 4 + 3] = 1;
    }
    return { rgba, counts, other };
}

const withOther = (items: LegendClass[], other: number, label: string): LegendClass[] =>
    (other > 0 ? [...items, { label, color: OTHER_COLOR, count: other }] : items);

/** The colour of every interval of a table, and the legend. Null when what it is coloured by is not there. */
export function colourLog(table: HoleTable, choice: string, maps: readonly UnitMap[], samples: SampleClasses | null = null): LogColours | null {
    const n = table.hole.length;
    if (choice.startsWith('units:')) {
        const map = maps.find(m => `units:${m.id}` === choice && m.table === table.id);
        const columns = map?.columns.map(c => tableText(table, c));
        if (!map || !columns || columns.length === 0 || columns.some(c => !c)) return null;
        const code = codesOf(columns as string[][]);
        const unit = unitsOfRows({ hole: table.hole, from: table.from, to: table.to, code }, map);
        const index = new Map(map.units.map((u, k) => [u.name, k]));
        const { rgba, counts, other } = paint(n, i => (unit[i] ? index.get(unit[i]) ?? -1 : code[i] ? -1 : -2), map.units.map(u => u.color));
        const items = map.units.map((u, k) => ({ label: u.name, color: u.color, count: counts[k] }));
        return { rgba, legend: { kind: 'classes', title: map.name, items: withOther(items, other, 'In no unit') } };
    }
    if (!choice.startsWith('column:')) return null;
    const name = choice.slice('column:'.length);
    const column = table.columns.find(c => c.name === name);
    const text = column && tableText(table, name);
    if (!column || !text) return null;

    // Coloured as the samples are, by a column of the same name
    if (samples && samples.classes.length && samples.field.trim().toLowerCase() === name.trim().toLowerCase()) {
        const byValue = new Map<string, number>();
        samples.classes.forEach((c, k) => { for (const v of c.values ?? []) if (!byValue.has(v)) byValue.set(v, k); });
        const ranges = samples.classes.map((c, k) => ({ k, min: c.min, max: c.max })).filter(r => Number.isFinite(r.min) && Number.isFinite(r.max));
        const numbers = column.values instanceof Float64Array ? column.values : null;
        const { rgba, counts, other } = paint(n, i => {
            if (text[i] === '') return -2;
            const k = byValue.get(text[i]);
            if (k !== undefined) return k;
            const v = numbers ? numbers[i] : Number(text[i]);
            const r = Number.isFinite(v) ? ranges.find(q => v >= q.min! && v <= q.max!) : undefined;
            return r ? r.k : -1;
        }, samples.classes.map(c => c.color));
        const items = samples.classes.map((c, k) => ({ label: c.label, color: c.color, count: counts[k] })).filter(c => c.count > 0);
        return { rgba, legend: { kind: 'classes', title: `${name} (as the samples)`, items: withOther(items, other, 'Other') } };
    }

    // Numbers along a ramp
    if (isNumbers(column.values)) {
        const values = column.values;
        let min = Infinity, max = -Infinity;
        for (const v of values) if (Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; }
        const colors = generateColorsFromPalette(RAMP, RAMP_STEPS);
        const span = max - min;
        const { rgba } = paint(n, i => {
            const v = values[i];
            if (!Number.isFinite(v)) return -2;
            return span > 0 ? Math.round(((v - min) / span) * (RAMP_STEPS - 1)) : RAMP_STEPS >> 1;
        }, colors);
        const stops = [0, 0.25, 0.5, 0.75, 1].map(t => colors[Math.round(t * (RAMP_STEPS - 1))]);
        return { rgba, legend: { kind: 'ramp', title: name, min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 0, colors: stops } };
    }

    // Codes, coloured in their order down the holes
    const order = codeStats({ hole: table.hole, from: table.from, code: text }).slice(0, MAX_UNITS);
    const index = new Map(order.map((s, k) => [s.code, k]));
    const colors = order.map((_, k) => UNIT_COLORS[k % UNIT_COLORS.length]);
    const { rgba, counts, other } = paint(n, i => (text[i] === '' ? -2 : index.get(text[i]) ?? -1), colors);
    const items = order.map((s, k) => ({ label: s.code, color: colors[k], count: counts[k] }));
    return { rgba, legend: { kind: 'classes', title: name, items: withOther(items, other, 'Other') } };
}

/** A table's intervals placed on the holes' paths, in the view's local coordinates (world less its origin) */
export interface LoggedPieces {
    /** xyz of the top of each piece, 3 per piece */
    start: Float32Array;
    /** xyz of its bottom */
    end: Float32Array;
    /** xyz of its middle (what the view's clip box and slices test) */
    mid: Float32Array;
    /** The table row each piece is of */
    row: Uint32Array;
    /** Pieces */
    count: number;
    /** Median length of the intervals drawn, m (0: none) */
    medianLength: number;
}

/** An interval whose middle is off the straight line between its ends by more than this share of its length (and 5 cm) is drawn in pieces that follow the hole */
const BENT = 0.005;
/**
 * A piece is at most about this long (m), at most MAX_PIECES to an interval: a slice keeps or leaves out a piece by
 * its middle, so a long interval in one piece was missing from a slice it crosses (Phase 304)
 */
const PIECE_M = 5;
const MAX_PIECES = 50;

/** Places the intervals of a table on the holes' paths (a table of depths has none to draw). */
export function placeLogged(table: HoleTable, traces: ReadonlyMap<string, HoleTrace>, origin: ArrayLike<number>): LoggedPieces {
    const start: number[] = [], end: number[] = [], mid: number[] = [], rows: number[] = [], lengths: number[] = [];
    const to = table.to;
    const push = (out: number[], p: ArrayLike<number>) => { out.push(p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]); };
    for (let i = 0; to && i < table.hole.length; i++) {
        const trace = traces.get(table.hole[i]);
        const from = table.from[i], bottom = to[i];
        if (!trace || !Number.isFinite(from) || !Number.isFinite(bottom) || !(bottom > from)) continue;
        const len = bottom - from;
        lengths.push(len);
        const a = positionAt(trace, from), b = positionAt(trace, bottom), c = positionAt(trace, from + len / 2);
        const off = Math.hypot(c[0] - (a[0] + b[0]) / 2, c[1] - (a[1] + b[1]) / 2, c[2] - (a[2] + b[2]) / 2);
        const pieces = Math.min(MAX_PIECES, Math.max(off > Math.max(0.05, len * BENT) ? 2 : 1, Math.ceil(len / PIECE_M - 1e-9)));
        let top = a;
        for (let k = 1; k <= pieces; k++) {
            const next = k === pieces ? b : positionAt(trace, from + (len * k) / pieces);
            push(start, top);
            push(end, next);
            push(mid, pieces === 1 ? c : positionAt(trace, from + (len * (k - 0.5)) / pieces));
            rows.push(i);
            top = next;
        }
    }
    const sorted = Float64Array.from(lengths).sort();
    return {
        start: Float32Array.from(start), end: Float32Array.from(end), mid: Float32Array.from(mid), row: Uint32Array.from(rows),
        count: rows.length, medianLength: sorted.length ? sorted[sorted.length >> 1] : 0,
    };
}

/**
 * How wide a view draws a table, m (null: automatic). Each table has its own
 * (`widths`, by table id; null there: automatic); a table not in it is as
 * wide as all logging was before tables had their own (`all`).
 */
export function tableWidthOf(widths: unknown, all: unknown, id: string): number | null {
    const own = widths && typeof widths === 'object' ? (widths as Record<string, unknown>)[id] : undefined;
    const pick = own === undefined ? all : own;
    return typeof pick === 'number' && Number.isFinite(pick) && pick > 0 ? pick : null;
}

/** The rows' colours, one per piece */
export function piecesColours(rgba: Float32Array, row: Uint32Array): Float32Array {
    const out = new Float32Array(row.length * 4);
    for (let k = 0; k < row.length; k++) out.set(rgba.subarray(row[k] * 4, row[k] * 4 + 4), k * 4);
    return out;
}
