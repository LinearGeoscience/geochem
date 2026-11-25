/**
 * The samples coloured by a view of the model, not by the Attributes pane
 * (pure, unit-tested). A view's setting `sampleColour` names a column of the
 * dataset; unset, the samples take the Attributes pane's colours as in every
 * plot.
 *
 *  - Numbers are coloured along a ramp between a low and a high value
 *    (outside them, the ends' colours), on a log scale or not. Until the view
 *    says, the range is the 2nd to the 98th percentile of the values, on a
 *    log scale where the values are all above zero and spread over more than
 *    a power of ten (an assay). Given class boundaries, they are coloured in
 *    steps instead, a colour of the ramp each.
 *  - Codes (text, or a few whole numbers) are coloured by their values, the
 *    commonest first; a value past the last colour is "Other".
 *
 * Rows with no value are drawn grey.
 */
import { generateColorsFromPalette } from '../../utils/colorPalettes';
import { buildColumnOptions, type PickerColumn } from '../../utils/columnGroups';
import type { ColumnGeochemMapping } from '../../types/associations';
import { OTHER_COLOR, rgbOf } from './loggingDisplay';
import { looksLikeCodes, UNIT_COLORS } from './units';

/** The view setting: what the view colours its samples by (null: as in the Attributes pane) */
export const SAMPLE_COLOUR_SETTING = 'sampleColour';

/** The ramps offered, the first the one used until another is chosen */
export const SAMPLE_RAMPS = ['Turbo', 'Jet', 'Viridis', 'Plasma', 'Inferno', 'Hot'] as const;
export const DEFAULT_RAMP = SAMPLE_RAMPS[0];
/** Codes coloured each its own colour, at most; the rest are Other */
export const MAX_CODE_COLOURS = 40;
/** Steps of a ramp */
const STEPS = 256;
/** The range until the view says: these percentiles of the values */
const LOW_PCT = 0.02, HIGH_PCT = 0.98;

export interface SampleColouring {
    column: string;
    /** A ramp of SAMPLE_RAMPS (absent: the first) */
    ramp?: string;
    /** The value at the bottom of the ramp (absent or null: from the data) */
    min?: number | null;
    /** ... at its top */
    max?: number | null;
    /** On a log scale (absent: as the data suggests) */
    log?: boolean;
    /** Class boundaries, low to high: coloured in steps, not along the ramp */
    breaks?: number[];
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A saved setting as a colouring (null: none, or not one) */
export function readSampleColouring(saved: unknown): SampleColouring | null {
    if (!saved || typeof saved !== 'object') return null;
    const s = saved as Record<string, unknown>;
    if (typeof s.column !== 'string' || !s.column) return null;
    const out: SampleColouring = { column: s.column };
    if (typeof s.ramp === 'string' && (SAMPLE_RAMPS as readonly string[]).includes(s.ramp)) out.ramp = s.ramp;
    if (finite(s.min)) out.min = s.min;
    if (finite(s.max)) out.max = s.max;
    if (typeof s.log === 'boolean') out.log = s.log;
    if (Array.isArray(s.breaks)) {
        const b = [...new Set(s.breaks.filter(finite))].sort((x, y) => x - y);
        if (b.length) out.breaks = b;
    }
    return out;
}

/** Class boundaries typed as text ("0.1, 0.5, 1 5"): the numbers, low to high (empty: none) */
export function parseBreaks(text: string): number[] {
    const b = text.split(/[\s,;]+/).filter(Boolean).map(Number).filter(Number.isFinite);
    return [...new Set(b)].sort((x, y) => x - y);
}

export type ColumnValues = Float64Array | readonly string[];

/** Is the column coloured as codes (text, or a few whole numbers) rather than along a ramp? */
export const isCodes = (values: ColumnValues): boolean => !(values instanceof Float64Array) || looksLikeCodes(values);

/** The range a column's numbers are coloured over until the view says otherwise, and whether on a log scale */
export function autoRange(values: Float64Array, log?: boolean): { min: number; max: number; log: boolean } {
    const all: number[] = [];
    for (const v of values) if (Number.isFinite(v)) all.push(v);
    if (all.length === 0) return { min: 0, max: 1, log: false };
    all.sort((a, b) => a - b);
    const at = (list: number[], p: number) => list[Math.min(list.length - 1, Math.max(0, Math.round(p * (list.length - 1))))];
    const positive = all[0] > 0;
    const spread = positive && at(all, HIGH_PCT) / at(all, LOW_PCT) > 10;
    const useLog = log ?? spread;
    const list = useLog ? all.filter(v => v > 0) : all;
    if (list.length === 0) return { min: 0, max: 1, log: false };
    let min = at(list, LOW_PCT), max = at(list, HIGH_PCT);
    if (!(max > min)) { min = list[0]; max = list[list.length - 1]; }
    return { min, max, log: useLog };
}

export interface SampleLegendClass { label: string; color: string; count: number }

export type SampleLegend =
    | { kind: 'ramp'; title: string; min: number; max: number; log: boolean; colors: string[]; blank: number }
    | { kind: 'classes'; title: string; items: SampleLegendClass[] };

export interface SampleColours {
    /** rgb (0 to 1) of every row, 3 each */
    rgb: Float32Array;
    legend: SampleLegend;
}

const fmt = (v: number) => (Math.abs(v) >= 1000 || Number.isInteger(v) ? String(Math.round(v)) : String(Number(v.toPrecision(3))));

/** The colour of each row of a column as a view colours its samples, and the legend */
export function colourSamples(values: ColumnValues, colouring: SampleColouring, title = colouring.column): SampleColours {
    const n = values.length;
    const rgb = new Float32Array(n * 3);
    const grey = rgbOf(OTHER_COLOR);
    const put = (i: number, c: readonly number[]) => { rgb[i * 3] = c[0]; rgb[i * 3 + 1] = c[1]; rgb[i * 3 + 2] = c[2]; };
    let blank = 0;

    if (isCodes(values)) {
        const text = (i: number) => {
            const v = values[i];
            return typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : (v ?? '').trim();
        };
        const counts = new Map<string, number>();
        for (let i = 0; i < n; i++) { const t = text(i); if (t) counts.set(t, (counts.get(t) ?? 0) + 1); }
        const order = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { numeric: true })).slice(0, MAX_CODE_COLOURS);
        const index = new Map(order.map(([code], k) => [code, k]));
        const colors = order.map((_, k) => UNIT_COLORS[k % UNIT_COLORS.length]);
        const rgbs = colors.map(rgbOf);
        let other = 0;
        for (let i = 0; i < n; i++) {
            const t = text(i);
            const k = t ? index.get(t) : undefined;
            if (k !== undefined) put(i, rgbs[k]);
            else { put(i, grey); if (t) other++; else blank++; }
        }
        const items = order.map(([code, count], k) => ({ label: code, color: colors[k], count }));
        if (other) items.push({ label: 'Other', color: OTHER_COLOR, count: other });
        if (blank) items.push({ label: 'No value', color: OTHER_COLOR, count: blank });
        return { rgb, legend: { kind: 'classes', title, items } };
    }

    const numbers = values as Float64Array;
    const ramp = colouring.ramp && (SAMPLE_RAMPS as readonly string[]).includes(colouring.ramp) ? colouring.ramp : DEFAULT_RAMP;

    // In steps between class boundaries
    if (colouring.breaks?.length) {
        const b = colouring.breaks;
        const colors = generateColorsFromPalette(ramp, b.length + 1);
        const rgbs = colors.map(rgbOf);
        const counts = new Array<number>(b.length + 1).fill(0);
        for (let i = 0; i < n; i++) {
            const v = numbers[i];
            if (!Number.isFinite(v)) { put(i, grey); blank++; continue; }
            let k = 0;
            while (k < b.length && v >= b[k]) k++;
            counts[k]++;
            put(i, rgbs[k]);
        }
        const label = (k: number) => (k === 0 ? `under ${fmt(b[0])}` : k === b.length ? `${fmt(b[k - 1])} and over` : `${fmt(b[k - 1])} to ${fmt(b[k])}`);
        // High values first, as a legend of grades is read
        const items = colors.map((color, k) => ({ label: label(k), color, count: counts[k] })).reverse();
        if (blank) items.push({ label: 'No value', color: OTHER_COLOR, count: blank });
        return { rgb, legend: { kind: 'classes', title, items } };
    }

    // Along the ramp
    const auto = autoRange(numbers, colouring.log);
    const log = auto.log;
    let min = finite(colouring.min) ? colouring.min : auto.min;
    let max = finite(colouring.max) ? colouring.max : auto.max;
    if (log && !(min > 0)) min = auto.min > 0 ? auto.min : 1e-6;
    if (log && !(max > 0)) max = auto.max > 0 ? auto.max : 1;
    if (min > max) [min, max] = [max, min];
    const f = log ? Math.log10 : (v: number) => v;
    const lo = f(min), span = f(max) - lo;
    const colors = generateColorsFromPalette(ramp, STEPS);
    const rgbs = colors.map(rgbOf);
    for (let i = 0; i < n; i++) {
        const v = numbers[i];
        if (!Number.isFinite(v)) { put(i, grey); blank++; continue; }
        const x = log && v <= 0 ? 0 : span > 0 ? (f(v) - lo) / span : 0.5;
        put(i, rgbs[Math.round(Math.min(1, Math.max(0, x)) * (STEPS - 1))]);
    }
    const stops = [0, 0.25, 0.5, 0.75, 1].map(t => colors[Math.round(t * (STEPS - 1))]);
    return { rgb, legend: { kind: 'ramp', title, min, max, log, colors: stops, blank } };
}

/** The value a share (0 to 1) of the way along a ramp's legend stands for */
export function rampValueAt(legend: { min: number; max: number; log: boolean }, t: number): number {
    return legend.log ? 10 ** (Math.log10(legend.min) + t * (Math.log10(legend.max) - Math.log10(legend.min))) : legend.min + t * (legend.max - legend.min);
}

export const formatLegendValue = fmt;

export interface SampleColumnChoice {
    /** The column's name */
    value: string;
    label: string;
    group: 'Elements' | 'Other numbers' | 'Text';
}

const ELEMENT_GROUPS = new Set(['Major oxides', 'Trace elements', 'REE']);

/** The columns a view can colour its samples by: elements first (as the column pickers order them), other numbers, then text */
export function sampleColumnChoices(columns: readonly PickerColumn[], mappings: readonly ColumnGeochemMapping[]): SampleColumnChoice[] {
    const numbers = buildColumnOptions([...columns], [...mappings], 'numeric');
    const text = buildColumnOptions([...columns], [...mappings], 'categorical');
    const out: SampleColumnChoice[] = [];
    for (const o of numbers) if (ELEMENT_GROUPS.has(o.group)) out.push({ value: o.name, label: o.label, group: 'Elements' });
    for (const o of numbers) if (!ELEMENT_GROUPS.has(o.group)) out.push({ value: o.name, label: o.label, group: 'Other numbers' });
    for (const o of text) out.push({ value: o.name, label: o.label, group: 'Text' });
    return out;
}
