/**
 * Attribute style engine (Phase 60): resolves colour / shape / size /
 * visibility / opacity / emphasis for every row in one pass, and caches the
 * result for the current dataset so every plot shares it.
 *
 * Rules (one place, used by plots, counts, "From Colour" columns, groups):
 * - Values are analytical (below-detection substituted).
 * - Ranges: min <= v < max; the top class includes its max. Categories by
 *   exact string; combined fields ("A + B") work on every tab.
 * - A painted (custom) group overrides only the properties it defines;
 *   hiding it hides its rows.
 * - With no field on a tab, its Default entry styles every row.
 */
import type { AttributeConfig, AttributeEntry, AttributeType, EmphasisConfig, ValueFilterConfig } from '../store/attributeStore';
import type { ColumnData, ColumnarStore } from '../types/columnarData';
import { isNumericColumn } from '../types/columnarData';
import { generateColorsFromPalette } from './colorPalettes';
import { calculateLinearRanks, calculatePercentileRanks } from './emphasisUtils';
import type { EmphasisResult } from './emphasisUtils';

export type ColumnGetter = (name: string) => ColumnData | undefined;

export interface StyleArrays {
    colors: string[];
    shapes: string[];
    sizes: number[];
    visible: boolean[];
    opacity: number[];
    zIndices: number[];
    emphasisResults: EmphasisResult[];
}

/** The attribute state that styling depends on */
export interface StyleInputs {
    color: AttributeConfig;
    shape: AttributeConfig;
    size: AttributeConfig;
    filter: AttributeConfig;
    customEntries: AttributeEntry[];
    emphasis: EmphasisConfig;
    globalOpacity: number;
    valueFilter: ValueFilterConfig;
}

export const STYLE_KEYS = ['color', 'shape', 'size', 'filter', 'customEntries', 'emphasis', 'globalOpacity', 'valueFilter'] as const;

export function styleInputsOf(s: StyleInputs): StyleInputs {
    return {
        color: s.color, shape: s.shape, size: s.size, filter: s.filter, customEntries: s.customEntries,
        emphasis: s.emphasis, globalOpacity: s.globalOpacity, valueFilter: s.valueFilter,
    };
}

export const DEFAULT_COLOR = '#808080';
export const DEFAULT_SHAPE = 'circle';
export const DEFAULT_SIZE = 6;

const TABS: AttributeType[] = ['color', 'shape', 'size', 'filter'];
const NEUTRAL: EmphasisResult = Object.freeze({ opacity: 1, sizeMultiplier: 1, zIndex: 0 }) as EmphasisResult;

/** Value of a row for a tab's field(s): number, string, or null */
function valueReader(cols: (ColumnData | undefined)[]): (i: number) => number | string | null {
    if (cols.length === 0) return () => null;
    if (cols.length === 1) {
        const c = cols[0];
        if (!c) return () => null;
        if (isNumericColumn(c)) return i => (Number.isNaN(c[i]) ? null : c[i]);
        return i => (c[i] === '' ? null : c[i]);
    }
    return i => {
        let out = '';
        for (const c of cols) {
            if (!c) continue;
            const v = c[i];
            if (v == null || v === '' || (typeof v === 'number' && Number.isNaN(v))) continue;
            const s = String(v);
            if (s === 'null' || s === 'undefined') continue;
            out = out ? `${out} + ${s}` : s;
        }
        return out || null;
    };
}

interface CompiledTab {
    hasField: boolean;
    value: (i: number) => number | string | null;
    /** Field class of a value (not considering painted groups); null = Default */
    match: (v: number | string | null) => AttributeEntry | null;
    def: AttributeEntry | null;
}

/** Field class lookup: category Map + sorted ranges with binary search */
export function compileEntries(entries: AttributeEntry[]): (v: number | string | null) => AttributeEntry | null {
    const cats = new Map<string, AttributeEntry>();
    const ranges: AttributeEntry[] = [];
    for (const e of entries) {
        if (e.isDefault || e.isCustom) continue;
        if (e.type === 'range' && e.min !== undefined && e.max !== undefined) ranges.push(e);
        else if (e.type === 'category') {
            for (const v of e.categoryValues ?? (e.categoryValue !== undefined ? [e.categoryValue] : [])) {
                if (!cats.has(v)) cats.set(v, e);
            }
        }
    }
    ranges.sort((a, b) => a.min! - b.min! || a.max! - b.max!);
    const mins = ranges.map(r => r.min!);
    let topMax = -Infinity;
    let overlapping = false;
    for (let k = 0; k < ranges.length; k++) {
        if (k > 0 && ranges[k].min! < ranges[k - 1].max!) overlapping = true;
        if (ranges[k].max! > topMax) topMax = ranges[k].max!;
    }
    const inRange = (r: AttributeEntry, x: number) => x >= r.min! && (x < r.max! || (x === r.max! && x === topMax));

    const matchRange = (x: number): AttributeEntry | null => {
        if (!ranges.length) return null;
        if (overlapping) {
            for (const r of ranges) if (inRange(r, x)) return r;
            return null;
        }
        // last range with min <= x
        let lo = 0, hi = mins.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (mins[mid] <= x) lo = mid + 1; else hi = mid;
        }
        const k = lo - 1;
        if (k < 0) return null;
        if (inRange(ranges[k], x)) return ranges[k];
        // a value equal to the top max that sits in a zero-width top class
        if (k > 0 && inRange(ranges[k - 1], x)) return ranges[k - 1];
        return null;
    };

    return (v) => {
        if (v === null) return null;
        if (ranges.length) {
            const x = typeof v === 'number' ? v : parseFloat(v);
            if (!Number.isNaN(x)) {
                const r = matchRange(x);
                if (r) return r;
            }
        }
        if (cats.size) return cats.get(String(v)) ?? null;
        return null;
    };
}

function compileTab(config: AttributeConfig, getCol: ColumnGetter): CompiledTab {
    const fields = config.field ? [config.field, ...(config.additionalFields ?? [])] : [];
    return {
        hasField: fields.length > 0,
        value: valueReader(fields.map(f => getCol(f))),
        match: compileEntries(config.entries),
        def: config.entries.find(e => e.isDefault) ?? null,
    };
}

/** Progressive colouring: a continuous ramp over the range of the classified entries */
export function progressiveRamp(config: AttributeConfig): ((value: any) => string | null) | null {
    if (config.method !== 'progressive') return null;
    const ranges = config.entries.filter(e => e.type === 'range' && e.min !== undefined && e.max !== undefined);
    if (!ranges.length) return null;
    let lo = Infinity, hi = -Infinity;
    for (const e of ranges) { if (e.min! < lo) lo = e.min!; if (e.max! > hi) hi = e.max!; }
    const steps = generateColorsFromPalette(config.palette, 64);
    if (!steps.length) return null;
    return (value: any) => {
        const v = typeof value === 'number' ? value : parseFloat(value);
        if (!Number.isFinite(v)) return null;
        const t = hi > lo ? Math.min(1, Math.max(0, (v - lo) / (hi - lo))) : 0;
        return steps[Math.round(t * (steps.length - 1))];
    };
}

function customLookup(customEntries: AttributeEntry[]): Map<number, AttributeEntry> | null {
    if (!customEntries.length) return null;
    const map = new Map<number, AttributeEntry>();
    for (const e of customEntries) for (const idx of e.assignedIndices) map.set(idx, e);
    return map.size ? map : null;
}

/** Full style resolution result, including which entry styled each row per tab */
export interface StyleResult extends StyleArrays {
    /** Per tab: the entry naming the row ('From Colour' semantics: painted group, field class, or null = Default) */
    groupOf: Record<AttributeType, (AttributeEntry | null)[]>;
}

/**
 * Resolve styles for `rowCount` rows read through `getCol`; `originalIndices`
 * maps position -> dataset row (painted groups are stored by dataset row).
 */
export function resolveStyles(
    rowCount: number,
    getCol: ColumnGetter,
    inp: StyleInputs,
    originalIndices?: ArrayLike<number>,
    withGroups = false,
): StyleResult {
    const tabs = {
        color: compileTab(inp.color, getCol),
        shape: compileTab(inp.shape, getCol),
        size: compileTab(inp.size, getCol),
        filter: compileTab(inp.filter, getCol),
    };
    const custom = customLookup(inp.customEntries);
    // Draw order: classes lower in the Colour list draw on top, painted groups above all
    const drawRank = new Map<AttributeEntry, number>();
    inp.color.entries.forEach((e, k) => drawRank.set(e, k + 1));
    inp.customEntries.forEach((e, k) => drawRank.set(e, inp.color.entries.length + inp.customEntries.length - k));
    const rankOf = new Float64Array(rowCount);
    const ramp = progressiveRamp(inp.color);
    const vf = inp.valueFilter;
    const vfName = vf.enabled ? (vf.column || inp.color.field) : null;
    const vfCol = vfName ? getCol(vfName) : undefined;
    const vfRead = vfCol ? valueReader([vfCol]) : null;

    const colors: string[] = new Array(rowCount);
    const shapes: string[] = new Array(rowCount);
    const sizes: number[] = new Array(rowCount);
    const visible: boolean[] = new Array(rowCount);
    const entryOpacity = new Float64Array(rowCount);
    const colorClass: (AttributeEntry | null)[] = new Array(rowCount);
    const groupOf = {} as Record<AttributeType, (AttributeEntry | null)[]>;
    if (withGroups) for (const t of TABS) groupOf[t] = new Array(rowCount);

    const { color: cT, shape: sT, size: zT, filter: fT } = tabs;
    for (let i = 0; i < rowCount; i++) {
        const row = originalIndices ? originalIndices[i] : i;
        const cm = custom ? custom.get(row) ?? null : null;
        let vis = true;
        let op = 1;

        // Colour
        let col = cT.def?.color ?? DEFAULT_COLOR;
        let cEntry: AttributeEntry | null = null;
        if (cT.hasField) {
            const v = cT.value(i);
            cEntry = cT.match(v);
            const e = cEntry ?? cT.def;
            if (e) {
                col = (ramp && e.type === 'range' && ramp(v)) || e.color || DEFAULT_COLOR;
                if (!cm) { op *= e.opacity ?? 1; if (!e.visible) vis = false; }
            }
        } else if (!cm && cT.def) {
            op *= cT.def.opacity ?? 1;
            if (!cT.def.visible) vis = false;
        }
        colorClass[i] = cEntry;
        rankOf[i] = drawRank.get(cm ?? cEntry ?? cT.def!) ?? 0;

        // Shape / size: field class (or Default), then the painted group's own value
        let shp = sT.def?.shape ?? DEFAULT_SHAPE;
        let sEntry: AttributeEntry | null = null;
        if (sT.hasField) {
            sEntry = sT.match(sT.value(i));
            const e = sEntry ?? sT.def;
            if (e) { shp = e.shape || DEFAULT_SHAPE; op *= e.opacity ?? 1; if (!e.visible) vis = false; }
        } else if (sT.def && !sT.def.visible) vis = false;

        let sz = zT.def?.size ?? DEFAULT_SIZE;
        let zEntry: AttributeEntry | null = null;
        if (zT.hasField) {
            zEntry = zT.match(zT.value(i));
            const e = zEntry ?? zT.def;
            if (e) { sz = e.size || DEFAULT_SIZE; op *= e.opacity ?? 1; if (!e.visible) vis = false; }
        } else if (zT.def && !zT.def.visible) vis = false;

        let fEntry: AttributeEntry | null = null;
        if (fT.hasField) {
            fEntry = fT.match(fT.value(i));
            const e = fEntry ?? fT.def;
            if (e) { op *= e.opacity ?? 1; if (!e.visible) vis = false; }
        } else if (fT.def && !fT.def.visible) vis = false;

        if (cm) {
            if (cm.color) col = cm.color;
            if (cm.shape) shp = cm.shape;
            if (cm.size) sz = cm.size;
            op *= cm.opacity ?? 1;
            if (!cm.visible) vis = false;
        }

        if (vis && vfRead) {
            const raw = vfRead(i);
            if (raw !== null) {
                const x = typeof raw === 'number' ? raw : parseFloat(raw);
                if (!Number.isNaN(x) && ((vf.min !== null && x < vf.min) || (vf.max !== null && x > vf.max))) vis = false;
            }
        }

        colors[i] = col;
        shapes[i] = shp;
        sizes[i] = sz;
        visible[i] = vis;
        entryOpacity[i] = op;
        if (withGroups) {
            groupOf.color[i] = cm ?? cEntry;
            groupOf.shape[i] = cm ?? sEntry;
            groupOf.size[i] = cm ?? zEntry;
            groupOf.filter[i] = cm ?? fEntry;
        }
    }

    const emphasisResults = computeEmphasis(rowCount, getCol, inp, colorClass, cT);
    const opacity: number[] = new Array(rowCount);
    const zIndices: number[] = new Array(rowCount);
    for (let i = 0; i < rowCount; i++) {
        const e = emphasisResults[i];
        opacity[i] = entryOpacity[i] * e.opacity * inp.globalOpacity;
        // emphasis (0..1000) first when on, then the class draw order
        zIndices[i] = (inp.emphasis.enabled ? e.zIndex * 10000 : 0) + rankOf[i];
        if (e.sizeMultiplier !== 1) sizes[i] *= e.sizeMultiplier;
    }
    return { colors, shapes, sizes, visible, opacity, zIndices, emphasisResults, groupOf };
}

function computeEmphasis(
    rowCount: number,
    getCol: ColumnGetter,
    inp: StyleInputs,
    colorClass: (AttributeEntry | null)[],
    cT: CompiledTab,
): EmphasisResult[] {
    const cfg = inp.emphasis;
    if (!cfg.enabled) return new Array(rowCount).fill(NEUTRAL);
    let ranks: (number | null)[];
    if (cfg.mode === 'category') {
        // Rank by the colour class the row is drawn in (same classes as the plot)
        const classes = inp.color.entries.filter(e => !e.isDefault && !e.isCustom && (e.type === 'range' || e.type === 'category'));
        const ordered = classes.some(e => e.type === 'range')
            ? [...classes].sort((a, b) => (a.min ?? 0) - (b.min ?? 0))
            : classes;
        const pos = new Map(ordered.map((e, k) => [e, ordered.length > 1 ? k / (ordered.length - 1) : 0.5]));
        ranks = new Array(rowCount);
        for (let i = 0; i < rowCount; i++) {
            const c = colorClass[i];
            if (c) ranks[i] = pos.get(c) ?? 0.5;
            else if (!cT.hasField || !classes.length) ranks[i] = 0.5;
            else ranks[i] = cT.value(i) === null ? null : 0;
        }
    } else {
        const name = cfg.column || inp.color.field;
        const read = name ? valueReader([getCol(name)]) : null;
        const values: (number | null)[] = new Array(rowCount);
        for (let i = 0; i < rowCount; i++) {
            const v = read ? read(i) : null;
            values[i] = v === null ? null : (typeof v === 'number' ? v : (Number.isNaN(Number(v)) ? null : Number(v)));
        }
        // Value-filter bounds only scale emphasis when they are on the same column
        const vf = inp.valueFilter;
        const bounds = vf.enabled && (vf.column || inp.color.field) === name ? { min: vf.min, max: vf.max } : undefined;
        ranks = cfg.mode === 'percentile' ? calculatePercentileRanks(values, bounds) : calculateLinearRanks(values, bounds);
    }
    const t = cfg.threshold / 100;
    const out: EmphasisResult[] = new Array(rowCount);
    for (let i = 0; i < rowCount; i++) {
        const r = ranks[i];
        if (r === null) { out[i] = { opacity: cfg.minOpacity, sizeMultiplier: 1, zIndex: 0 }; continue; }
        const above = r >= t;
        out[i] = {
            opacity: above ? 1 : cfg.minOpacity + (1 - cfg.minOpacity) * (t > 0 ? r / t : 1),
            sizeMultiplier: cfg.boostSize && above ? cfg.sizeBoostFactor : 1,
            zIndex: Math.round(r * 1000),
        };
    }
    return out;
}

// ---------------------------------------------------------------------------
// Shared cache for the current dataset
// ---------------------------------------------------------------------------

interface CacheEntry {
    store: ColumnarStore;
    inputs: StyleInputs;
    result: StyleResult;
    gathers: WeakMap<object, StyleArrays>;
}
let cache: CacheEntry | null = null;

const sameInputs = (a: StyleInputs, b: StyleInputs) => STYLE_KEYS.every(k => a[k] === b[k]);

/** Styles of every row of `store` (cached: one pass per change, shared by all plots) */
export function datasetStyles(store: ColumnarStore, inputs: StyleInputs): StyleResult {
    if (cache && cache.store === store && sameInputs(cache.inputs, inputs)) return cache.result;
    const result = resolveStyles(store.rowCount, n => store.columns.get(n), inputs, undefined, true);
    cache = { store, inputs, result, gathers: new WeakMap() };
    return result;
}

/** Styles of the given dataset rows (display sample), gathered from the dataset styles */
export function gatherStyles(store: ColumnarStore, inputs: StyleInputs, indices: ArrayLike<number>): StyleArrays {
    const full = datasetStyles(store, inputs);
    const key = indices as unknown as object;
    const hit = cache!.gathers.get(key);
    if (hit) return hit;
    const n = indices.length;
    const out: StyleArrays = {
        colors: new Array(n), shapes: new Array(n), sizes: new Array(n), visible: new Array(n),
        opacity: new Array(n), zIndices: new Array(n), emphasisResults: new Array(n),
    };
    for (let k = 0; k < n; k++) {
        const i = indices[k];
        out.colors[k] = full.colors[i];
        out.shapes[k] = full.shapes[i];
        out.sizes[k] = full.sizes[i];
        out.visible[k] = full.visible[i];
        out.opacity[k] = full.opacity[i];
        out.zIndices[k] = full.zIndices[i];
        out.emphasisResults[k] = full.emphasisResults[i];
    }
    cache!.gathers.set(key, out);
    return out;
}

/** Drop the cache (tests) */
export function clearStyleCache(): void {
    cache = null;
}
