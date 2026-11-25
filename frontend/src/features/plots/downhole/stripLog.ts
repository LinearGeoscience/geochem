/**
 * Strip log: the model and the Plotly figure of the downhole plot.
 *
 * A strip log is a set of tracks drawn against one position axis (depth down
 * a hole, or the order of samples along a sequence):
 *
 *  - tracks: 1-3 numeric fields on one scale (linear or a real log axis),
 *    drawn as lines, filled areas, bars (stems) or markers, with reference
 *    lines, grey bands where the first field is blank and a marker overlay
 *    on rows where a flag column has a given value;
 *  - ribbons: category columns drawn as coloured intervals (runs of equal
 *    value), inside the figure so image export and reports keep them.
 *
 * Vertical: holes side by side, each with its ribbons then one x axis per
 * track, sharing a reversed depth axis. Horizontal: tracks stacked as rows
 * sharing one sequence axis, ribbons on top with the hole names, dashed
 * dividers between holes.
 *
 * Everything here is pure (no store, no React) so it can be tested; the
 * component gathers the columns and passes them in.
 */
import { trailingNumber } from '../../../utils/statistics/sequence';
import { lithologyColours } from '../../../utils/lithologyColours';
import { guessDepthColumn, guessFromColumn } from '../viewer3d/coordinateColumns';
import { SELECTION_COLOR } from '../../../utils/selectionHelpers';

// ---------------------------------------------------------------------------
// Settings model
// ---------------------------------------------------------------------------

export type TrackScale = 'linear' | 'log';
export type TrackStyle = 'line' | 'area' | 'bar' | 'markers';
export type StripOrientation = 'vertical' | 'horizontal';

export interface TrackField { field: string; colour?: string }
export interface RefLine { value: number; label?: string; colour?: string; dash?: 'dash' | 'dot' }
export interface OverlayFlag { column: string; value: string | number; symbol?: string; colour?: string; size?: number }

export interface Track {
    id: string;
    /** 1-3 numeric fields, overlaid on the track's scale */
    fields: TrackField[];
    scale: TrackScale;
    style: TrackStyle;
    refLines?: RefLine[];
    /** Grey bands where the first field is blank */
    shadeBlanks?: boolean;
    /** Markers on the first field where `column` equals `value` */
    overlayFlag?: OverlayFlag;
}

export interface DownholeSettings {
    tracks: Track[];
    /** Category columns drawn as coloured intervals */
    ribbons: string[];
    orientation: StripOrientation;
    /** Position (depth / order) column; '' = automatic */
    depthColumn: string;
    holeDividers: boolean;
    /** Holes shown; empty = all */
    selectedHoles: string[];
}

export const MAX_FIELDS_PER_TRACK = 3;
export const TRACK_SCALES: TrackScale[] = ['linear', 'log'];
export const TRACK_STYLES: TrackStyle[] = ['line', 'area', 'bar', 'markers'];

/** Settings keys of the single-axis downhole plot, read by the normaliser and cleared on the first write */
export const LEGACY_KEYS = ['selectedFields', 'scalingMode', 'categoryField', 'traceColors'] as const;

/** Name of the single sequence drawn when the dataset has no hole column */
export const ALL_SAMPLES = 'All samples';

export const TRACK_COLOURS = [
    '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
    '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
];

const FLAG_COLOUR = '#ffd400';
const BLANK_FILL = 'rgba(128,128,128,0.2)';
const REF_COLOUR = '#c62828';
const DIVIDER_COLOUR = 'rgba(60,60,60,0.85)';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A track id not used by `tracks` ("track-1", "track-2", ...) */
export function newTrackId(tracks: readonly { id: string }[]): string {
    const used = new Set(tracks.map(t => t.id));
    let n = 1;
    while (used.has(`track-${n}`)) n++;
    return `track-${n}`;
}

function normaliseTrack(v: unknown, taken: Track[]): Track | null {
    if (!isObj(v)) return null;
    const fields: TrackField[] = [];
    for (const f of Array.isArray(v.fields) ? v.fields : []) {
        // A template whose column is missing here drops the `field` key: the entry goes
        const field = typeof f === 'string' ? f : isObj(f) ? str(f.field) : '';
        if (!field || fields.some(x => x.field === field)) continue;
        const colour = isObj(f) ? str(f.colour) : '';
        fields.push(colour ? { field, colour } : { field });
    }
    if (!fields.length) return null;
    const id = str(v.id) && !taken.some(t => t.id === v.id) ? (v.id as string) : newTrackId(taken);
    const track: Track = {
        id,
        fields,
        scale: TRACK_SCALES.includes(v.scale as TrackScale) ? (v.scale as TrackScale) : 'linear',
        style: TRACK_STYLES.includes(v.style as TrackStyle) ? (v.style as TrackStyle) : 'line',
    };
    if (Array.isArray(v.refLines)) {
        const refs: RefLine[] = [];
        for (const r of v.refLines) {
            if (!isObj(r)) continue;
            const value = typeof r.value === 'number' ? r.value : Number(r.value);
            if (r.value === '' || r.value === null || !Number.isFinite(value)) continue;
            const ref: RefLine = { value };
            if (str(r.label)) ref.label = str(r.label);
            if (str(r.colour)) ref.colour = str(r.colour);
            if (r.dash === 'dash' || r.dash === 'dot') ref.dash = r.dash;
            refs.push(ref);
        }
        if (refs.length) track.refLines = refs;
    }
    if (v.shadeBlanks === true) track.shadeBlanks = true;
    const f = v.overlayFlag;
    if (isObj(f) && str(f.column) && ((typeof f.value === 'number' && Number.isFinite(f.value)) || typeof f.value === 'string')) {
        const flag: OverlayFlag = { column: str(f.column), value: f.value as string | number };
        if (str(f.symbol)) flag.symbol = str(f.symbol);
        if (str(f.colour)) flag.colour = str(f.colour);
        if (typeof f.size === 'number' && f.size > 0) flag.size = f.size;
        track.overlayFlag = flag;
    }
    return track;
}

/**
 * The plot's settings in the strip-log shape. Settings saved by the older
 * single-axis plot (selectedFields / scalingMode / categoryField /
 * traceColors, also what the New Plot dialog writes) become one track
 * holding those fields on the old scale, and the category column a ribbon.
 * Run on read, so saved projects and templates keep working.
 */
export function normaliseDownholeSettings(
    settings: Record<string, unknown> | null | undefined,
    opts: { hasHoles?: boolean } = {},
): DownholeSettings {
    const s = settings ?? {};
    const tracks: Track[] = [];
    if (Array.isArray(s.tracks)) {
        for (const t of s.tracks) {
            const n = normaliseTrack(t, tracks);
            if (n) tracks.push(n);
        }
    } else if (Array.isArray(s.selectedFields)) {
        const colours = isObj(s.traceColors) ? s.traceColors : {};
        const n = normaliseTrack({
            id: 'track-1',
            fields: s.selectedFields.filter((f): f is string => typeof f === 'string' && f !== '')
                .map(field => ({ field, colour: str(colours[field]) })),
            scale: s.scalingMode === 'log' ? 'log' : 'linear',
            style: 'line',
        }, tracks);
        if (n) tracks.push(n);
    }
    const ribbons = Array.isArray(s.ribbons)
        ? s.ribbons.filter((r): r is string => typeof r === 'string' && r !== '')
        : (str(s.categoryField) ? [str(s.categoryField)] : []);
    const orientation: StripOrientation = s.orientation === 'vertical' || s.orientation === 'horizontal'
        ? s.orientation
        : (opts.hasHoles === false ? 'horizontal' : 'vertical');
    return {
        tracks,
        ribbons: [...new Set(ribbons)],
        orientation,
        depthColumn: str(s.depthColumn),
        holeDividers: typeof s.holeDividers === 'boolean' ? s.holeDividers : true,
        selectedHoles: Array.isArray(s.selectedHoles) ? s.selectedHoles.filter((h): h is string => typeof h === 'string') : [],
    };
}

/** The settings patch to store: the strip-log keys, with the legacy keys cleared */
export function storedDownholeSettings(s: DownholeSettings): Record<string, unknown> {
    const out: Record<string, unknown> = { ...s };
    for (const k of LEGACY_KEYS) out[k] = undefined;
    return out;
}

/** Each field's colour: its own, else the next palette colour in track order */
export function trackColours(tracks: readonly Track[]): string[][] {
    let k = 0;
    return tracks.map(t => t.fields.map(f => f.colour || TRACK_COLOURS[k++ % TRACK_COLOURS.length]));
}

// ---------------------------------------------------------------------------
// Positions and holes
// ---------------------------------------------------------------------------

export interface ColumnLike { name: string; type: string; role: string | null }
type Column = ArrayLike<unknown>;
const NUMERIC_TYPES = new Set(['numeric', 'float', 'integer']);

export interface PositionSource {
    /** The column read, null = row order */
    column: string | null;
    /** Axis title */
    label: string;
    /** Position of every row (NaN = none) */
    values: Float64Array;
    /** The column is the interval start (From): a To column can end the intervals */
    isFrom: boolean;
    /** The positions are the trailing numbers of a text column */
    fromText: boolean;
}

/** Number at row `r` of a column (numeric or text); blank = NaN */
export function numAt(col: Column | undefined, r: number): number {
    if (!col) return NaN;
    const v = col[r];
    if (typeof v === 'number') return v;
    if (v === '' || v === null || v === undefined) return NaN;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
}

function positionsOf(col: Column, rowCount: number, numeric: boolean): Float64Array {
    const out = new Float64Array(rowCount);
    for (let r = 0; r < rowCount; r++) out[r] = numeric ? numAt(col, r) : trailingNumber(col[r]);
    return out;
}

function tokens(name: string): string[] {
    return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean).map(t => t.toLowerCase());
}

const ID_ROLES = new Set(['ID', 'SampleID']);
const ORDER_WORDS = new Set(['seq', 'sequence', 'order', 'index']);

/**
 * Where each row sits along its hole. `depthColumn` '' picks one: the From
 * column, else a depth column, else a numeric sample-order column (ID role
 * or a name like "seq" / "order"), else the trailing number of a text sample
 * ID ("S-0142" -> 142), else the row order. A text column chosen by name
 * also gives its trailing numbers.
 */
export function resolvePosition(
    columns: ColumnLike[],
    depthColumn: string,
    getColumn: (name: string) => Column | undefined,
    rowCount: number,
): PositionSource {
    const fromName = guessFromColumn(columns);
    const pick = (name: string): PositionSource | null => {
        const info = columns.find(c => c.name === name);
        const col = getColumn(name);
        if (!info || !col) return null;
        const numeric = NUMERIC_TYPES.has(info.type);
        return {
            column: name,
            label: numeric ? name : `${name} (number)`,
            values: positionsOf(col, rowCount, numeric),
            isFrom: name === fromName || info.role === 'From',
            fromText: !numeric,
        };
    };
    if (depthColumn) {
        const p = pick(depthColumn);
        if (p) return p;
    }
    const depth = guessDepthColumn(columns);
    if (depth) { const p = pick(depth); if (p) return p; }
    const numericOrder = columns.find(c => NUMERIC_TYPES.has(c.type)
        && (ID_ROLES.has(c.role ?? '') || tokens(c.name).some(t => ORDER_WORDS.has(t))));
    if (numericOrder) { const p = pick(numericOrder.name); if (p) return p; }
    // A text ID whose values mostly end in a number
    for (const c of columns) {
        if (NUMERIC_TYPES.has(c.type) || !(ID_ROLES.has(c.role ?? '') || tokens(c.name).includes('id'))) continue;
        const col = getColumn(c.name);
        if (!col || rowCount === 0) continue;
        let ok = 0;
        for (let r = 0; r < rowCount; r++) if (Number.isFinite(trailingNumber(col[r]))) ok++;
        if (ok >= rowCount * 0.8) { const p = pick(c.name); if (p) return p; }
    }
    const values = new Float64Array(rowCount);
    for (let r = 0; r < rowCount; r++) values[r] = r;
    return { column: null, label: 'Row order', values, isFrom: false, fromText: false };
}

export interface HoleRows {
    name: string;
    /** Row indices, in position order */
    rows: number[];
}

const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/** Distinct hole names of a column, in natural order ("H2" before "H10") */
export function holeNames(hole: Column | null | undefined, rowCount: number): string[] {
    if (!hole) return [];
    const set = new Set<string>();
    for (let r = 0; r < rowCount; r++) {
        const v = hole[r];
        if (v === null || v === undefined || v === '') continue;
        set.add(String(v));
    }
    return [...set].sort(naturalCompare);
}

/**
 * The rows of each hole, sorted by position. Rows that are hidden, have no
 * position or no hole are left out. No hole column: one sequence of every row
 * (ALL_SAMPLES). `only` keeps those holes (empty / null = all).
 */
export function groupHoles(
    rowCount: number,
    hole: Column | null | undefined,
    position: ArrayLike<number>,
    visible?: ArrayLike<unknown> | null,
    only?: readonly string[] | null,
): HoleRows[] {
    const keep = only && only.length ? new Set(only) : null;
    const map = new Map<string, number[]>();
    for (let r = 0; r < rowCount; r++) {
        if (visible && !visible[r]) continue;
        if (!Number.isFinite(position[r])) continue;
        let name = ALL_SAMPLES;
        if (hole) {
            const v = hole[r];
            if (v === null || v === undefined || v === '') continue;
            name = String(v);
            if (keep && !keep.has(name)) continue;
        }
        let rows = map.get(name);
        if (!rows) map.set(name, (rows = []));
        rows.push(r);
    }
    const out: HoleRows[] = [];
    for (const [name, rows] of map) {
        rows.sort((a, b) => position[a] - position[b] || a - b);
        out.push({ name, rows });
    }
    return out.sort((a, b) => naturalCompare(a.name, b.name));
}

// ---------------------------------------------------------------------------
// Intervals: sample cells, ribbon runs, blank spans, line breaks
// ---------------------------------------------------------------------------

export interface Cells { start: Float64Array; end: Float64Array }

/**
 * The interval each sample covers along its hole: From to To when a To
 * column ends it, else from the midpoint with the previous sample to the
 * midpoint with the next (the first and last extend half their one step; a
 * lone sample half a unit either side).
 */
export function sampleCells(rows: readonly number[], position: ArrayLike<number>, to?: ArrayLike<number> | null): Cells {
    const n = rows.length;
    const start = new Float64Array(n), end = new Float64Array(n);
    for (let k = 0; k < n; k++) {
        const p = position[rows[k]];
        const t = to ? to[rows[k]] : NaN;
        if (Number.isFinite(t) && t > p) { start[k] = p; end[k] = t; continue; }
        const before = k > 0 ? p - position[rows[k - 1]] : NaN;
        const after = k < n - 1 ? position[rows[k + 1]] - p : NaN;
        const b = Number.isFinite(before) ? before : Number.isFinite(after) ? after : 1;
        const a = Number.isFinite(after) ? after : b;
        start[k] = p - b / 2;
        end[k] = p + a / 2;
    }
    return { start, end };
}

export interface RibbonRun {
    /** Category ('' = blank) */
    value: string;
    start: number;
    end: number;
    /** Positions in the hole's rows of the run's first and last sample */
    first: number;
    last: number;
}

const catAt = (col: Column, r: number): string => {
    const v = col[r];
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
    return String(v).trim();
};

/** Runs of equal category down a hole; a gap between intervals (no sample) ends a run */
export function ribbonRuns(rows: readonly number[], values: Column, cells: Cells): RibbonRun[] {
    const runs: RibbonRun[] = [];
    let cur: RibbonRun | null = null;
    for (let k = 0; k < rows.length; k++) {
        const v = catAt(values, rows[k]);
        const gap = cur !== null && cells.start[k] > cells.end[k - 1] + 1e-9 * Math.max(1, Math.abs(cells.end[k - 1]));
        if (cur && cur.value === v && !gap) {
            cur.end = Math.max(cur.end, cells.end[k]);
            cur.last = k;
            continue;
        }
        if (cur) runs.push(cur);
        cur = { value: v, start: cells.start[k], end: cells.end[k], first: k, last: k };
    }
    if (cur) runs.push(cur);
    return runs;
}

/** Spans of consecutive samples whose value is blank, from the cells of the first to the last */
export function blankSpans(rows: readonly number[], values: Column, cells: Cells): [number, number][] {
    const out: [number, number][] = [];
    let open = -1;
    for (let k = 0; k <= rows.length; k++) {
        const blank = k < rows.length && !Number.isFinite(numAt(values, rows[k]));
        if (blank && open < 0) open = k;
        if (!blank && open >= 0) { out.push([cells.start[open], cells.end[k - 1]]); open = -1; }
    }
    return out;
}

/**
 * Segment number of each sample: a new segment starts where the step from
 * the previous sample is more than `gapFactor` times the hole's median step
 * (an unsampled stretch). Lines are broken between segments.
 */
export function gapSegments(rows: readonly number[], position: ArrayLike<number>, gapFactor = 5): Int32Array {
    const n = rows.length;
    const seg = new Int32Array(n);
    const steps: number[] = [];
    for (let k = 1; k < n; k++) {
        const d = position[rows[k]] - position[rows[k - 1]];
        if (d > 0) steps.push(d);
    }
    if (!steps.length) return seg;
    steps.sort((a, b) => a - b);
    const median = steps[steps.length >> 1];
    const limit = median * gapFactor;
    let s = 0;
    for (let k = 1; k < n; k++) {
        if (position[rows[k]] - position[rows[k - 1]] > limit) s++;
        seg[k] = s;
    }
    return seg;
}

/** Does row `r` of a column equal the flag value (numbers compared as numbers, text ignoring case)? */
export function flagMatches(col: Column | undefined, r: number, value: string | number): boolean {
    if (!col) return false;
    const v = col[r];
    if (v === null || v === undefined || v === '') return false;
    const a = typeof v === 'number' ? v : Number(v);
    const b = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(a) && Number.isFinite(b) && String(value).trim() !== '') return a === b;
    return String(v).trim().toLowerCase() === String(value).trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Ribbon colours
// ---------------------------------------------------------------------------

/** An Attribute Manager colour class (category values, or a numeric range) */
export interface ColourClass { label: string; color: string; values?: readonly string[]; min?: number; max?: number }

/** Colour and legend label of each category value: the classes first, else lithology colours */
export function ribbonColourMap(values: readonly string[], classes?: readonly ColourClass[] | null): Map<string, { colour: string; label: string }> {
    const out = new Map<string, { colour: string; label: string }>();
    const rest: string[] = [];
    for (const v of values) {
        let hit: ColourClass | undefined;
        if (classes) {
            hit = classes.find(c => c.values?.some(x => String(x).trim() === v));
            if (!hit) {
                const n = Number(v);
                if (v !== '' && Number.isFinite(n)) {
                    hit = classes.find(c => c.values === undefined && (c.min === undefined || n >= c.min) && (c.max === undefined || n <= c.max));
                }
            }
        }
        if (hit) out.set(v, { colour: hit.color, label: hit.label });
        else rest.push(v);
    }
    if (rest.length) {
        const lith = lithologyColours(rest);
        for (const v of rest) out.set(v, { colour: lith.get(v) ?? '#9e9e9e', label: v });
    }
    return out;
}

// ---------------------------------------------------------------------------
// Horizontal sequence layout
// ---------------------------------------------------------------------------

export interface SequenceLayout {
    /** Holes in drawing order */
    holes: HoleRows[];
    /** Added to a hole's positions to place it on the shared axis */
    offset: number[];
    /** Extent of each hole on the shared axis */
    start: number[];
    end: number[];
    /** Holes were laid end to end (their positions overlap, e.g. depths) */
    stacked: boolean;
    /** Hole divider positions, between consecutive holes */
    dividers: number[];
}

/**
 * Where each hole goes on the horizontal axis. Holes whose positions do not
 * overlap (sample numbers running on from hole to hole) keep them, in
 * position order; otherwise (depths from 0 in every hole) they are laid end
 * to end with a small gap, in name order. Dividers sit halfway between the
 * end of one hole and the start of the next.
 */
export function sequenceLayout(holes: readonly HoleRows[], cells: readonly Cells[]): SequenceLayout {
    const ext = holes.map((h, i) => ({
        h, c: cells[i],
        s: h.rows.length ? cells[i].start[0] : 0,
        e: h.rows.length ? cells[i].end.reduce((m, v) => Math.max(m, v), -Infinity) : 0,
    }));
    const byStart = [...ext].sort((a, b) => a.s - b.s);
    const overlaps = byStart.some((x, i) => i > 0 && x.s < byStart[i - 1].e - 1e-9);
    if (!overlaps) {
        const start = byStart.map(x => x.s), end = byStart.map(x => x.e);
        return {
            holes: byStart.map(x => x.h), offset: byStart.map(() => 0), start, end, stacked: false,
            dividers: byStart.slice(1).map((x, i) => (end[i] + x.s) / 2),
        };
    }
    const total = ext.reduce((s, x) => s + (x.e - x.s), 0);
    const gap = Math.max(total * 0.015, 1e-6);
    let cursor = 0;
    const offset: number[] = [], start: number[] = [], end: number[] = [];
    for (const x of ext) {
        offset.push(cursor - x.s);
        start.push(cursor);
        end.push(cursor + (x.e - x.s));
        cursor += x.e - x.s + gap;
    }
    return {
        holes: ext.map(x => x.h), offset, start, end, stacked: true,
        dividers: start.slice(1).map((s, i) => (end[i] + s) / 2),
    };
}

/** About `count` round tick values between lo and hi */
export function niceTicks(lo: number, hi: number, count = 4): number[] {
    if (!(hi > lo)) return Number.isFinite(lo) ? [lo] : [];
    const raw = (hi - lo) / Math.max(1, count);
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? 10 * mag;
    const out: number[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
    return out;
}

// ---------------------------------------------------------------------------
// Figure
// ---------------------------------------------------------------------------

export interface StripFigureInput {
    holes: HoleRows[];
    /** Position of every row */
    position: ArrayLike<number>;
    /** Interval end of every row (only when the position is the interval start) */
    to?: ArrayLike<number> | null;
    positionLabel: string;
    getColumn: (name: string) => Column | undefined;
    tracks: Track[];
    ribbons: string[];
    /** Attribute Manager classes for a ribbon column (when it is the colour field) */
    ribbonClasses?: Record<string, readonly ColourClass[] | null | undefined>;
    orientation: StripOrientation;
    holeDividers: boolean;
    displayName?: (name: string) => string;
    /** Selected rows (ringed) */
    selected?: ReadonlySet<number> | null;
    /** Line breaks where a step is this many times the median step */
    gapFactor?: number;
    /** Expected width of the figure in pixels (vertical: sizes the gaps and ribbons) */
    widthPx?: number;
}

export interface StripFigure {
    data: Record<string, any>[];
    layout: Record<string, any>;
}

/** Traces above this many points use WebGL (not for filled areas) */
const WEBGL_POINTS = 5000;

const axisKey = (id: string) => (id === 'x' || id === 'y' ? `${id}axis` : `${id[0]}axis${id.slice(1)}`);
const axisId = (letter: 'x' | 'y', n: number) => (n === 1 ? letter : `${letter}${n}`);
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6))));

interface Series { pos: (number | null)[]; val: (number | null)[]; idx: (number | null)[]; text: (string | null)[] }

/** Builds one Plotly figure of the strip log */
export function buildStripFigure(input: StripFigureInput): StripFigure {
    const dn = input.displayName ?? ((n: string) => n);
    const vertical = input.orientation === 'vertical';
    const holes = input.holes.filter(h => h.rows.length > 0);
    const cells = holes.map(h => sampleCells(h.rows, input.position, input.to));
    const colours = trackColours(input.tracks);
    const single = holes.length === 1 && holes[0].name === ALL_SAMPLES;
    const gapFactor = input.gapFactor ?? 5;
    const segs = holes.map(h => gapSegments(h.rows, input.position, gapFactor));
    const selected = input.selected && input.selected.size ? input.selected : null;

    // Ribbon colours over every hole, so a class has one colour everywhere
    const ribbonColours = new Map<string, Map<string, { colour: string; label: string }>>();
    for (const col of input.ribbons) {
        const values = input.getColumn(col);
        if (!values) continue;
        const set = new Set<string>();
        for (const h of holes) for (const r of h.rows) { const v = catAt(values, r); if (v) set.add(v); }
        ribbonColours.set(col, ribbonColourMap([...set].sort(naturalCompare), input.ribbonClasses?.[col]));
    }
    const ribbons = input.ribbons.filter(c => ribbonColours.has(c));

    // Smallest positive value of each log track: the base of its bars
    const logBase = input.tracks.map(t => {
        if (t.scale !== 'log') return 0;
        let m = Infinity;
        for (const f of t.fields) {
            const col = input.getColumn(f.field);
            for (const h of holes) for (const r of h.rows) { const v = numAt(col, r); if (v > 0 && v < m) m = v; }
        }
        return Number.isFinite(m) ? m : 1;
    });

    const data: Record<string, any>[] = [];
    const shapes: Record<string, any>[] = [];
    const annotations: Record<string, any>[] = [];
    const layout: Record<string, any> = {};
    const legendShown = new Set<string>();
    const showOnce = (key: string) => { if (legendShown.has(key)) return false; legendShown.add(key); return true; };

    /** Points of one field down one hole: blanks skipped (the line joins over them), broken between segments */
    const series = (hi: number, col: Column | undefined, log: boolean, offset: number, field: string): Series => {
        const h = holes[hi], seg = segs[hi];
        const out: Series = { pos: [], val: [], idx: [], text: [] };
        let lastSeg = -1;
        for (let k = 0; k < h.rows.length; k++) {
            const r = h.rows[k];
            const v = numAt(col, r);
            if (!Number.isFinite(v) || (log && v <= 0)) continue;
            if (lastSeg >= 0 && seg[k] !== lastSeg) { out.pos.push(null); out.val.push(null); out.idx.push(null); out.text.push(null); }
            lastSeg = seg[k];
            const p = input.position[r];
            out.pos.push(p + offset);
            out.val.push(v);
            out.idx.push(r);
            out.text.push(`${single ? '' : `${h.name} · `}${input.positionLabel} ${fmt(p)}<br>${dn(field)}: ${fmt(v)}`);
        }
        return out;
    };
    const join = (a: Series, b: Series): Series => (a.pos.length === 0 ? b : b.pos.length === 0 ? a : {
        pos: [...a.pos, null, ...b.pos], val: [...a.val, null, ...b.val], idx: [...a.idx, null, ...b.idx], text: [...a.text, null, ...b.text],
    });

    /** Traces of one track (all its fields) from one series per field */
    const trackTraces = (ti: number, perField: Series[], xa: string, ya: string) => {
        const t = input.tracks[ti];
        const xy = (s: { pos: (number | null)[]; val: (number | null)[] }) =>
            (vertical ? { x: s.val, y: s.pos } : { x: s.pos, y: s.val });
        t.fields.forEach((f, fi) => {
            const s = perField[fi];
            if (!s || s.pos.length === 0) return;
            const colour = colours[ti][fi];
            const n = s.pos.length;
            const legendgroup = `${t.id}:${f.field}`;
            const base = {
                xaxis: xa, yaxis: ya, name: dn(f.field), legendgroup, legendrank: 100 * ti + fi,
                showlegend: showOnce(legendgroup),
                connectgaps: false,
            };
            if (t.style === 'bar') {
                const b = logBase[ti];
                const stems: { pos: (number | null)[]; val: (number | null)[] } = { pos: [], val: [] };
                for (let k = 0; k < n; k++) {
                    if (s.pos[k] === null) continue;
                    stems.pos.push(s.pos[k], s.pos[k], null);
                    stems.val.push(b, s.val[k], null);
                }
                data.push({ ...base, type: stems.pos.length > WEBGL_POINTS ? 'scattergl' : 'scatter', mode: 'lines', ...xy(stems), line: { color: colour, width: 3 }, hoverinfo: 'skip' });
                data.push({ ...base, showlegend: false, type: n > WEBGL_POINTS ? 'scattergl' : 'scatter', mode: 'markers', ...xy(s), customdata: s.idx, text: s.text, hovertemplate: '%{text}<extra></extra>', marker: { color: colour, size: 3 } });
                return;
            }
            const area = t.style === 'area';
            if (area) {
                // Filled to the base (0, or the smallest value on a log scale) as one polygon per
                // unbroken stretch: a fill to zero would bridge the breaks between holes and gaps
                const b = logBase[ti];
                const poly: { pos: (number | null)[]; val: (number | null)[] } = { pos: [], val: [] };
                for (let k = 0; k < n;) {
                    let j = k;
                    while (j < n && s.pos[j] !== null) j++;
                    if (j > k) {
                        for (let q = k; q < j; q++) { poly.pos.push(s.pos[q]); poly.val.push(s.val[q]); }
                        poly.pos.push(s.pos[j - 1], s.pos[k], null);
                        poly.val.push(b, b, null);
                    }
                    k = j + 1;
                }
                data.push({
                    ...base, showlegend: false, type: 'scatter', mode: 'lines', ...xy(poly), fill: 'toself',
                    fillcolor: withAlpha(colour, 0.3), line: { width: 0, color: colour }, hoverinfo: 'skip',
                });
            }
            data.push({
                ...base,
                type: n > WEBGL_POINTS ? 'scattergl' : 'scatter',
                mode: t.style === 'markers' ? 'markers' : area ? 'lines' : 'lines+markers',
                ...xy(s),
                customdata: s.idx, text: s.text, hovertemplate: '%{text}<extra></extra>',
                line: { color: colour, width: 1.5 },
                marker: { color: colour, size: t.style === 'markers' ? 5 : 4 },
            });
        });
        // Flag overlay on the first field
        const flag = t.overlayFlag;
        const first = perField[0];
        if (flag && first) {
            const col = input.getColumn(flag.column);
            const pts = { pos: [] as number[], val: [] as number[], idx: [] as number[], text: [] as string[] };
            for (let k = 0; k < first.pos.length; k++) {
                const r = first.idx[k];
                if (r === null || !flagMatches(col, r, flag.value)) continue;
                pts.pos.push(first.pos[k] as number); pts.val.push(first.val[k] as number); pts.idx.push(r);
                pts.text.push(`${first.text[k]}<br>${dn(flag.column)} = ${flag.value}`);
            }
            if (pts.pos.length) {
                const key = `${t.id}:flag`;
                data.push({
                    type: 'scatter', mode: 'markers', xaxis: xa, yaxis: ya, ...xy(pts), customdata: pts.idx, text: pts.text,
                    hovertemplate: '%{text}<extra></extra>', name: `${dn(flag.column)} = ${flag.value}`,
                    legendgroup: key, showlegend: showOnce(key), legendrank: 100 * ti + 50,
                    marker: { symbol: flag.symbol || 'star', size: flag.size || 13, color: flag.colour || FLAG_COLOUR, line: { color: '#333', width: 1 } },
                });
            }
        }
        // Selected rows, ringed
        if (selected) {
            const ring = { pos: [] as number[], val: [] as number[] };
            for (const s of perField) {
                for (let k = 0; k < s.pos.length; k++) {
                    const r = s.idx[k];
                    if (r !== null && selected.has(r)) { ring.pos.push(s.pos[k] as number); ring.val.push(s.val[k] as number); }
                }
            }
            if (ring.pos.length) data.push({
                type: 'scatter', mode: 'markers', xaxis: xa, yaxis: ya, ...xy(ring), hoverinfo: 'skip', showlegend: false,
                marker: { color: 'rgba(0,0,0,0)', size: 9, line: { color: SELECTION_COLOR, width: 2 } },
            });
        }
    };

    /** Ribbon polygons of one hole, one trace per class */
    const ribbonTraces = (hi: number, col: string, offset: number, place: (s: number, e: number) => { x: number[]; y: number[] }, xa: string, ya: string) => {
        const values = input.getColumn(col)!;
        const colourOf = ribbonColours.get(col)!;
        const byLabel = new Map<string, { colour: string; x: (number | null)[]; y: (number | null)[] }>();
        for (const run of ribbonRuns(holes[hi].rows, values, cells[hi])) {
            if (!run.value) continue;
            const c = colourOf.get(run.value);
            if (!c) continue;
            let g = byLabel.get(c.label);
            if (!g) byLabel.set(c.label, (g = { colour: c.colour, x: [], y: [] }));
            const p = place(run.start + offset, run.end + offset);
            g.x.push(...p.x, null);
            g.y.push(...p.y, null);
        }
        for (const [label, g] of byLabel) {
            const key = `ribbon:${col}:${label}`;
            data.push({
                type: 'scatter', mode: 'lines', fill: 'toself', fillcolor: g.colour, line: { width: 0, color: g.colour },
                x: g.x, y: g.y, xaxis: xa, yaxis: ya, hoveron: 'fills', name: label,
                hoverlabel: { namelength: -1 }, legendgroup: key, showlegend: showOnce(key), legendrank: 10000 + 100 * ribbons.indexOf(col),
                ...(ribbons.length > 1 ? { legendgrouptitle: { text: dn(col) } } : {}),
            });
        }
    };

    const refShapes = (t: Track, valueAxis: string, otherDomain: string) => {
        for (const ref of t.refLines ?? []) {
            if (t.scale === 'log' && ref.value <= 0) continue;
            const colour = ref.colour || REF_COLOUR;
            const line = { color: colour, width: 1, dash: ref.dash === 'dot' ? 'dot' : 'dash' };
            const label = ref.label ? { text: ref.label, font: { size: 10, color: colour }, textposition: 'end' } : undefined;
            shapes.push(vertical
                ? { type: 'line', xref: valueAxis, x0: ref.value, x1: ref.value, yref: otherDomain, y0: 0, y1: 1, line, layer: 'above', ...(label ? { label: { ...label, textangle: 0, yanchor: 'top' } } : {}) }
                : { type: 'line', yref: valueAxis, y0: ref.value, y1: ref.value, xref: otherDomain, x0: 0, x1: 1, line, layer: 'above', ...(label ? { label: { ...label, yanchor: 'bottom' } } : {}) });
        }
    };

    const blankShapes = (ti: number, hi: number, offset: number, posAxis: string, valueDomain: string) => {
        const t = input.tracks[ti];
        if (!t.shadeBlanks || !t.fields.length) return;
        const col = input.getColumn(t.fields[0].field);
        if (!col) return;
        for (const [s, e] of blankSpans(holes[hi].rows, col, cells[hi])) {
            shapes.push(vertical
                ? { type: 'rect', yref: posAxis, y0: s + offset, y1: e + offset, xref: valueDomain, x0: 0, x1: 1, fillcolor: BLANK_FILL, line: { width: 0 }, layer: 'below' }
                : { type: 'rect', xref: posAxis, x0: s + offset, x1: e + offset, yref: valueDomain, y0: 0, y1: 1, fillcolor: BLANK_FILL, line: { width: 0 }, layer: 'below' });
        }
    };

    const trackTitle = (ti: number) => {
        const t = input.tracks[ti];
        const text = t.fields.map(f => dn(f.field)).join(', ');
        return { text, font: { size: 11, color: t.fields.length === 1 ? colours[ti][0] : undefined } };
    };
    /** Track label above a vertical track: one coloured line per field */
    const trackLabel = (ti: number) => input.tracks[ti].fields
        .map((f, fi) => `<span style="color:${colours[ti][fi]}">${escapeHtml(dn(f.field))}</span>`).join('<br>');

    if (vertical) {
        // Holes share the depth axis when their positions overlap (depths); holes
        // numbered on from each other (sample numbers) each keep their own range
        const shareDepth = holes.length > 1 && sequenceLayout(holes, cells).stacked;
        // Widths in pixels of the expected plot width, then fractions of it
        const nR = ribbons.length, nT = input.tracks.length;
        const RIBBON_PX = 26, INNER_PX = 8, HOLE_PX = shareDepth ? 26 : 66;
        const plotPx = Math.max(200, (input.widthPx ?? 1000) - 90);
        const fixedPx = holes.length * (nR * RIBBON_PX + Math.max(0, nR + nT - 1) * INNER_PX) + Math.max(0, holes.length - 1) * HOLE_PX;
        const trackPx = nT ? Math.max(60, (plotPx - fixedPx) / (holes.length * nT)) : 0;
        const total = fixedPx + holes.length * nT * trackPx || 1;
        const maxLines = Math.max(1, ...input.tracks.map(t => t.fields.length));
        const LABEL_SHIFT = 24; // above the tick labels
        const holeShift = LABEL_SHIFT + 14 * maxLines + 6;
        let xn = 0;
        let cursor = 0;
        holes.forEach((h, hi) => {
            const ya = axisId('y', hi + 1);
            const holeStart = cursor;
            let firstX = '';
            const columnDomain = (w: number): [number, number] => {
                const d: [number, number] = [cursor / total, Math.min(1, (cursor + w) / total)];
                cursor += w + INNER_PX;
                return d;
            };
            const label = (domain: [number, number], text: string, size: number) => annotations.push({
                text, xref: 'paper', yref: 'paper', x: (domain[0] + domain[1]) / 2, y: 1, yanchor: 'bottom', yshift: LABEL_SHIFT,
                showarrow: false, font: { size },
            });
            for (const col of ribbons) {
                const xa = axisId('x', ++xn);
                if (!firstX) firstX = xa;
                const domain = columnDomain(RIBBON_PX);
                layout[axisKey(xa)] = {
                    domain, anchor: ya, range: [0, 1], fixedrange: true, showticklabels: false,
                    showgrid: false, zeroline: false, side: 'top', ticks: '',
                };
                label(domain, escapeHtml(dn(col)), 9);
                ribbonTraces(hi, col, 0, (s, e) => ({ x: [0, 1, 1, 0, 0], y: [s, s, e, e, s] }), xa, ya);
            }
            input.tracks.forEach((t, ti) => {
                const xa = axisId('x', ++xn);
                if (!firstX) firstX = xa;
                const domain = columnDomain(trackPx);
                layout[axisKey(xa)] = {
                    domain, anchor: ya, type: t.scale === 'log' ? 'log' : 'linear', side: 'top',
                    tickfont: { size: 10 }, nticks: 4, showgrid: true, zeroline: false,
                    showline: true, mirror: true, linecolor: 'rgba(128,128,128,0.6)',
                };
                label(domain, trackLabel(ti), 11);
                const col = t.fields.map(f => input.getColumn(f.field));
                const perField = t.fields.map((f, fi) => series(hi, col[fi], t.scale === 'log', 0, f.field));
                trackTraces(ti, perField, xa, ya);
                refShapes(t, xa, `${ya} domain`);
                blankShapes(ti, hi, 0, ya, `${xa} domain`);
            });
            cursor -= INNER_PX;
            const holeEnd = cursor;
            layout[axisKey(ya)] = {
                domain: [0, 1], anchor: firstX || 'x', autorange: 'reversed', zeroline: false, showgrid: true,
                tickfont: { size: 10 }, exponentformat: 'none', separatethousands: false,
                ...(hi === 0 ? { title: { text: input.positionLabel } } : {}),
                ...(hi > 0 && shareDepth ? { matches: 'y', showticklabels: false } : {}),
            };
            if (!single) {
                annotations.push({
                    text: `<b>${escapeHtml(h.name)}</b>`, xref: 'paper', yref: 'paper', x: (holeStart + holeEnd) / 2 / total, y: 1,
                    yanchor: 'bottom', yshift: holeShift, showarrow: false, font: { size: 13 },
                });
            }
            if (input.holeDividers && hi < holes.length - 1) {
                const x = (holeEnd + HOLE_PX / 2) / total;
                shapes.push({ type: 'line', xref: 'paper', yref: 'paper', x0: x, x1: x, y0: 0, y1: 1, line: { color: DIVIDER_COLOUR, width: 1, dash: 'dash' } });
            }
            cursor += HOLE_PX;
        });
        // compactLayout takes three quarters of the margins: ask for enough
        Object.assign(layout, { margin: { l: 70, r: 20, t: Math.ceil((holeShift + (single ? 0 : 22)) / 0.75), b: 0 } });
    } else {
        const seq = sequenceLayout(holes, cells);
        // Draw holes in the layout's order (cells and segments follow their hole)
        const order = seq.holes.map(h => holes.indexOf(h));
        // Rows from the bottom: tracks (last track at the bottom), ribbons on top
        const ROW = 1, RIBBON_ROW = Math.max(0.28, 0.16 * ribbons.length), GAP = 0.14;
        const nT = input.tracks.length;
        const total = nT * ROW + (ribbons.length ? RIBBON_ROW : 0) + Math.max(0, nT + (ribbons.length ? 1 : 0) - 1) * GAP || 1;
        let cursor = 0;
        const rowDomain = (h: number): [number, number] => {
            const d: [number, number] = [cursor / total, Math.min(1, (cursor + h) / total)];
            cursor += h + GAP;
            return d;
        };
        // Shared x: ticks of each hole's own positions when holes were laid end to end
        const xTicks = seq.stacked ? (() => {
            const vals: number[] = [], text: string[] = [];
            seq.offset.forEach((_, j) => {
                const lo = seq.start[j] - seq.offset[j], hi = seq.end[j] - seq.offset[j];
                for (const v of niceTicks(lo, hi, 3)) { vals.push(v + seq.offset[j]); text.push(fmt(v)); }
            });
            return { tickmode: 'array', tickvals: vals, ticktext: text };
        })() : {};
        let n = 0;
        const xAxisFor = (domain: [number, number], bottom: boolean) => {
            n++;
            const xa = axisId('x', n), ya = axisId('y', n);
            layout[axisKey(xa)] = {
                anchor: ya, showgrid: true, zeroline: false, exponentformat: 'none', separatethousands: false, ...xTicks,
                ...(bottom ? { title: { text: input.positionLabel } } : { matches: 'x', showticklabels: false }),
            };
            layout[axisKey(ya)] = { domain, anchor: xa };
            return { xa, ya };
        };
        for (let ti = nT - 1; ti >= 0; ti--) {
            const t = input.tracks[ti];
            const { xa, ya } = xAxisFor(rowDomain(ROW), ti === nT - 1);
            Object.assign(layout[axisKey(ya)], {
                type: t.scale === 'log' ? 'log' : 'linear', title: trackTitle(ti), tickfont: { size: 10 }, zeroline: false,
                showline: true, mirror: true, linecolor: 'rgba(128,128,128,0.6)',
            });
            const cols = t.fields.map(f => input.getColumn(f.field));
            const perField = t.fields.map((f, fi) => order
                .map((hi, j) => series(hi, cols[fi], t.scale === 'log', seq.offset[j], f.field))
                .reduce(join, { pos: [], val: [], idx: [], text: [] } as Series));
            trackTraces(ti, perField, xa, ya);
            refShapes(t, ya, 'x domain');
            order.forEach((hi, j) => blankShapes(ti, hi, seq.offset[j], 'x', `${ya} domain`));
        }
        if (ribbons.length) {
            const R = ribbons.length;
            const { xa, ya } = xAxisFor(rowDomain(RIBBON_ROW), nT === 0);
            Object.assign(layout[axisKey(ya)], {
                range: [0, R], fixedrange: true, showgrid: false, zeroline: false, ticks: '',
                tickmode: 'array', tickvals: ribbons.map((_, r) => R - r - 0.5), ticktext: ribbons.map(dn),
            });
            ribbons.forEach((col, r) => {
                const y0 = R - r - 1 + 0.06, y1 = R - r - 0.06;
                order.forEach((hi, j) => ribbonTraces(hi, col, seq.offset[j], (s, e) => ({ x: [s, e, e, s, s], y: [y0, y0, y1, y1, y0] }), xa, ya));
            });
            if (!single) seq.holes.forEach((h, j) => annotations.push({
                text: `<b>${escapeHtml(h.name)}</b>`, xref: xa, yref: ya, x: (seq.start[j] + seq.end[j]) / 2, y: R / 2,
                showarrow: false, font: { size: 11, color: '#111' }, bgcolor: 'rgba(255,255,255,0.85)', bordercolor: '#333', borderwidth: 1, borderpad: 2,
            }));
        } else if (!single && n > 0) {
            const top = axisId('x', n);
            seq.holes.forEach((h, j) => annotations.push({
                text: `<b>${escapeHtml(h.name)}</b>`, xref: top, yref: 'paper', x: (seq.start[j] + seq.end[j]) / 2, y: 1,
                yanchor: 'bottom', showarrow: false, font: { size: 11 },
            }));
        }
        if (input.holeDividers) {
            for (const x of seq.dividers) {
                shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: x, x1: x, y0: 0, y1: 1, line: { color: DIVIDER_COLOUR, width: 1.2, dash: 'dash' }, layer: 'above' });
            }
        }
        Object.assign(layout, { margin: { l: 80, r: 20, t: 30, b: 0 } });
    }

    // Legend along the bottom of the figure, below the axis; the margin makes room for its rows
    const legendRows = Math.ceil(legendShown.size / 6);
    layout.margin.b = Math.ceil(((vertical ? 12 : 48) + 22 * legendRows) / 0.75);
    Object.assign(layout, {
        shapes, annotations, showlegend: legendShown.size > 0, hovermode: 'closest',
        legend: { orientation: 'h', x: 0, xanchor: 'left', y: 0, yref: 'container', yanchor: 'bottom', font: { size: 11 } },
    });
    return { data, layout };
}

function withAlpha(hex: string, a: number): string {
    const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
