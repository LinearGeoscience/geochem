/**
 * Attribute Manager classification (Phase 61). Classes are built from the
 * FULL analytical column (below-detection values substituted, like the plots)
 * and rebuilt live: changing the field, method, class count, palette or
 * reverse reclassifies at once, and so does a data / BDL change for tabs
 * whose classes came from the classifier (`auto`). A rebuild keeps what the
 * user changed: each new class takes the edited properties (colour, shape,
 * size, opacity, visibility, name) of the previous class with the same key
 * (category value, or the i-th range), and hand-edited breaks stay unless
 * the method or class count changes.
 */
import {
    AttributeConfig, AttributeEntry, AttributeType, ClassificationMethod, EDITABLE_PROPS, MARKER_SHAPES,
    createCategoryEntry, createRangeEntry, useAttributeStore, DEFAULT_VALUE_FILTER,
} from '../store/attributeStore';
import { useAppStore } from '../store/appStore';
import { useLegendStore } from '../store/legendStore';
import { analyticalStore } from './censoring';
import { generateColorsFromPalette } from './colorPalettes';
import { applyLegendStyles } from './interopLegend';
import {
    jenksBreaks, equalIntervals, quantileBreaks, logEqualIntervals, stdDevBreaks, percentileBreaks, dedupeBreaks,
    PERCENTILE_PRESET,
} from './classification';
import type { ColumnData } from '../types/columnarData';
import { isNumericColumn } from '../types/columnarData';

type Getter = (name: string) => ColumnData | undefined;

/** Numeric columns with at most this many distinct values can also be classified by value */
export const MAX_NUMERIC_CATEGORIES = 50;
export const DEFAULT_SIZE_RANGE: [number, number] = [4, 14];

export const METHOD_LABELS: Record<ClassificationMethod, string> = {
    equal: 'Equal intervals',
    logEqual: 'Equal intervals (log)',
    quantile: 'Quantiles',
    jenks: 'Jenks natural breaks',
    stdDev: 'Standard deviation',
    percentile: `Percentiles (${PERCENTILE_PRESET.join('/')})`,
    categorical: 'By value',
    progressive: 'Progressive (continuous)',
    manual: 'Custom breaks',
};

/** Methods with a class count */
export const COUNTED_METHODS: ClassificationMethod[] = ['equal', 'logEqual', 'quantile', 'jenks', 'stdDev', 'progressive'];

/** Analytical columns of the current dataset (what the plots colour by) */
export function datasetGetter(): { getCol: Getter; rowCount: number } {
    const app = useAppStore.getState();
    const an = analyticalStore(app.columnarData, app.geochemMappings, app.bdlFactor);
    return { getCol: (n) => an.columns.get(n), rowCount: an.rowCount };
}

/** Distinct finite values of a numeric column, or null when there are more than `limit` */
export function numericDistinct(col: ColumnData | undefined, limit = MAX_NUMERIC_CATEGORIES): number[] | null {
    if (!col || !isNumericColumn(col)) return null;
    const seen = new Set<number>();
    for (let i = 0; i < col.length; i++) {
        const v = col[i];
        if (!Number.isFinite(v)) continue;
        seen.add(v);
        if (seen.size > limit) return null;
    }
    return [...seen].sort((a, b) => a - b);
}

/** Methods offered for a field */
export function methodsFor(tab: AttributeType, numeric: boolean, fewValues: boolean): ClassificationMethod[] {
    if (!numeric) return ['categorical'];
    const m: ClassificationMethod[] = ['equal', 'logEqual', 'quantile', 'jenks', 'stdDev', 'percentile'];
    if (tab === 'color') m.push('progressive');
    if (fewValues) m.push('categorical');
    return m;
}

export function computeBreaks(method: ClassificationMethod, values: number[], numClasses: number): number[] {
    switch (method) {
        case 'jenks': return dedupeBreaks(jenksBreaks(values, numClasses));
        case 'quantile': return dedupeBreaks(quantileBreaks(values, numClasses));
        case 'logEqual': return dedupeBreaks(logEqualIntervals(values, numClasses));
        case 'stdDev': return dedupeBreaks(stdDevBreaks(values, numClasses));
        case 'percentile': return dedupeBreaks(percentileBreaks(values));
        default: return dedupeBreaks(equalIntervals(values, numClasses));
    }
}

/** Palette colour / shape / size of class i of n for a tab */
function classStyle(tab: AttributeType, cfg: AttributeConfig, i: number, n: number) {
    const k = cfg.reversed ? n - 1 - i : i;
    const [lo, hi] = cfg.sizeRange ?? DEFAULT_SIZE_RANGE;
    return {
        color: tab === 'color' ? generateColorsFromPalette(cfg.palette, n)[k] : undefined,
        shape: tab === 'shape' ? MARKER_SHAPES[k % MARKER_SHAPES.length].value : undefined,
        size: tab === 'size' ? Math.round((n > 1 ? lo + ((hi - lo) * k) / (n - 1) : (lo + hi) / 2) * 10) / 10 : undefined,
    };
}

function finiteValues(col: ColumnData): number[] {
    const out: number[] = [];
    if (isNumericColumn(col)) {
        for (let i = 0; i < col.length; i++) if (Number.isFinite(col[i])) out.push(col[i]);
    } else {
        for (let i = 0; i < col.length; i++) {
            const x = parseFloat(col[i] as string);
            if (Number.isFinite(x)) out.push(x);
        }
    }
    return out;
}

/** Combined value of row i over several columns ("A + B"), as the style engine builds it */
function combinedValues(cols: (ColumnData | undefined)[], rowCount: number): Map<string, number> {
    const freq = new Map<string, number>();
    for (let i = 0; i < rowCount; i++) {
        let out = '';
        for (const c of cols) {
            if (!c) continue;
            const v = c[i];
            if (v == null || v === '' || (typeof v === 'number' && Number.isNaN(v))) continue;
            const s = String(v);
            if (s === 'null' || s === 'undefined') continue;
            out = out ? `${out} + ${s}` : s;
        }
        if (out) freq.set(out, (freq.get(out) ?? 0) + 1);
    }
    return freq;
}

/**
 * Fresh classes for `cfg` over the data (no merging). `keepRanges` reuses
 * existing (hand-edited) range breaks instead of computing new ones.
 */
export function buildClasses(
    tab: AttributeType,
    cfg: AttributeConfig,
    data: { getCol: Getter; rowCount: number },
    keepRanges?: AttributeEntry[],
): AttributeEntry[] | null {
    if (!cfg.field) return null;
    const fields = [cfg.field, ...(cfg.additionalFields ?? [])];
    const cols = fields.map(f => data.getCol(f));
    const primary = cols[0];
    if (!primary) return null;
    const def = cfg.entries.filter(e => e.isDefault);

    const numeric = fields.length === 1 && isNumericColumn(primary);
    if (numeric && cfg.method !== 'categorical') {
        let bounds: [number, number][];
        if (keepRanges && keepRanges.length) {
            bounds = keepRanges.map(e => [e.min!, e.max!] as [number, number]).sort((a, b) => a[0] - b[0]);
        } else {
            const values = finiteValues(primary);
            if (!values.length) return null;
            const b = computeBreaks(cfg.method === 'progressive' ? 'equal' : cfg.method, values, cfg.numClasses);
            bounds = b.slice(0, -1).map((v, i) => [v, b[i + 1]]);
        }
        const n = bounds.length;
        return [...def, ...bounds.map(([lo, hi], i) => {
            const st = classStyle(tab, cfg, i, n);
            return { ...createRangeEntry(lo, hi, i, st.color, st.shape, st.size), key: `r${i}` };
        })];
    }

    const freq = combinedValues(cols, data.rowCount);
    const values = [...freq.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const n = values.length;
    const entries = values.map((v, i) => {
        const st = classStyle(tab, cfg, i, n);
        const e = { ...createCategoryEntry(v, i, st.color, st.shape, st.size), key: v };
        e.rowCount = freq.get(v) ?? 0;
        e.visibleRowCount = e.rowCount;
        return e;
    });
    // A loaded legend (.gat) styles the groups it names
    return [...def, ...applyLegendStyles(tab, entries, useLegendStore.getState().legend)];
}

/**
 * New classes carrying over the user's edits from the previous classes with
 * the same key; ids of matched classes are kept (selection survives), and so
 * is their order. Merged categories absorb the values they cover.
 */
export function mergeClasses(prev: AttributeEntry[], next: AttributeEntry[], opts: { keepStyles?: boolean } = {}): AttributeEntry[] {
    const byKey = new Map<string, AttributeEntry>();
    const order = new Map<string, number>();
    prev.forEach((e, k) => {
        if (e.isDefault || e.isCustom) return;
        order.set(e.id, k);
        const keys = e.categoryValues ?? (e.key !== undefined ? [e.key] : []);
        for (const key of keys) if (!byKey.has(key)) byKey.set(key, e);
    });
    const out: AttributeEntry[] = [];
    const used = new Set<string>();
    for (const e of next) {
        if (e.isDefault) { out.push(prev.find(p => p.isDefault) ?? e); continue; }
        const p = e.key !== undefined ? byKey.get(e.key) : undefined;
        if (!p) { out.push(e); continue; }
        if (used.has(p.id)) continue; // another value of a merged class
        used.add(p.id);
        const carried: AttributeEntry = { ...e, id: p.id, edited: p.edited };
        if (p.categoryValues) {
            carried.categoryValues = p.categoryValues;
            carried.categoryValue = p.categoryValue;
        }
        for (const prop of p.edited ?? []) (carried as any)[prop] = p[prop];
        // Data changed, settings did not: a category keeps its look even if never edited
        // (a new class must not shift every other class's palette colour)
        if (opts.keepStyles && e.type === 'category') {
            carried.color = p.color; carried.shape = p.shape; carried.size = p.size;
        }
        if (p.categoryValues && !(p.edited ?? []).includes('name')) carried.name = p.name;
        out.push(carried);
    }
    // Matched classes keep the order the user gave them; new ones follow in natural order
    const head = out.filter(e => e.isDefault);
    const matched = out.filter(e => !e.isDefault && order.has(e.id)).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    const fresh = out.filter(e => !e.isDefault && !order.has(e.id));
    if (opts.keepStyles) {
        // New categories take colours the kept ones are not using
        const used = new Set(matched.map(e => e.color?.toLowerCase()));
        const spare = [...new Set(next.map(e => e.color?.toLowerCase()).filter((c): c is string => !!c && !used.has(c)))];
        for (const e of fresh) {
            if (e.type !== 'category' || !e.color || !used.has(e.color.toLowerCase())) { used.add(e.color?.toLowerCase()); continue; }
            const c = spare.find(x => !used.has(x));
            if (c) { e.color = c; used.add(c); }
        }
    }
    return [...head, ...matched, ...fresh];
}

/** The config with classes rebuilt for the data; `prev` (same field) supplies edits to keep */
export function classifyConfig(
    tab: AttributeType,
    cfg: AttributeConfig,
    data = datasetGetter(),
    prev?: AttributeConfig | null,
    opts: { keepStyles?: boolean } = {},
): AttributeConfig {
    if (!cfg.field) return { ...cfg, auto: false, breaksEdited: false, entries: cfg.entries.filter(e => e.isDefault) };
    const keepBreaks = !!(prev && cfg.breaksEdited && prev.method === cfg.method && prev.numClasses === cfg.numClasses);
    const ranges = keepBreaks ? prev!.entries.filter(e => e.type === 'range' && !e.isDefault) : undefined;
    const built = buildClasses(tab, cfg, data, ranges);
    if (!built) return cfg;
    let entries = prev ? mergeClasses(prev.entries, built, opts) : built;
    if (keepBreaks) {
        // the kept breaks keep their own labels
        const old = new Map(ranges!.map(e => [`${e.min}|${e.max}`, e]));
        entries = entries.map(e => {
            const o = e.type === 'range' ? old.get(`${e.min}|${e.max}`) : undefined;
            return o && !(e.edited ?? []).includes('name') ? { ...e, name: o.name } : e;
        });
    }
    return { ...cfg, entries, auto: true, breaksEdited: keepBreaks };
}

export type ConfigPatch = Partial<Pick<AttributeConfig,
    'field' | 'additionalFields' | 'method' | 'numClasses' | 'palette' | 'reversed' | 'sizeRange'>>;

/**
 * Change a tab's classification settings and rebuild its classes at once
 * (one store update = one undo step). Edits carry over unless the field changes.
 */
export function configureTab(tab: AttributeType, patch: ConfigPatch, data = datasetGetter()): void {
    const cfg = useAttributeStore.getState()[tab];
    const next: AttributeConfig = { ...cfg, ...patch };
    const fieldChanged = (patch.field !== undefined && patch.field !== cfg.field)
        || (patch.additionalFields !== undefined && patch.additionalFields.join('\u0001') !== (cfg.additionalFields ?? []).join('\u0001'));
    if (patch.field !== undefined && patch.field !== cfg.field) {
        next.additionalFields = patch.additionalFields ?? [];
        if (patch.method === undefined) next.method = defaultMethod(tab, next, data, cfg.method);
    }
    if (fieldChanged || next.method !== cfg.method || next.numClasses !== cfg.numClasses) next.breaksEdited = false;
    if (next.method !== 'categorical' && (next.additionalFields ?? []).length) next.method = 'categorical';
    useAttributeStore.setState({ [tab]: classifyConfig(tab, next, data, fieldChanged ? null : cfg) } as any);
}

function defaultMethod(tab: AttributeType, cfg: AttributeConfig, data: { getCol: Getter }, previous: ClassificationMethod): ClassificationMethod {
    const col = cfg.field ? data.getCol(cfg.field) : undefined;
    if (!col || !isNumericColumn(col) || (cfg.additionalFields ?? []).length) return 'categorical';
    if (previous !== 'categorical' && previous !== 'manual' && (previous !== 'progressive' || tab === 'color')) return previous;
    return 'equal';
}

/**
 * Classes from fixed edges (e.g. levelled percentiles 0 / 50 / 75 / 90 / 95 /
 * 98 / 100) on a numeric field, one store update. Stored as hand-edited
 * breaks, so automatic reclassification keeps them.
 */
export function setRangeClasses(tab: AttributeType, field: string, edges: number[], data = datasetGetter()): void {
    const sorted = [...new Set(edges)].sort((x, y) => x - y);
    if (sorted.length < 2) return;
    const cfg = useAttributeStore.getState()[tab];
    const next: AttributeConfig = { ...cfg, field, additionalFields: [], method: cfg.method === 'categorical' || cfg.method === 'progressive' ? 'equal' : cfg.method, numClasses: sorted.length - 1 };
    const ranges = sorted.slice(0, -1).map((lo, i) => ({ min: lo, max: sorted[i + 1] }) as AttributeEntry);
    const entries = buildClasses(tab, next, data, ranges);
    if (!entries) return;
    useAttributeStore.setState({ [tab]: { ...next, entries, auto: true, breaksEdited: true } } as any);
}

/** Auto-Attribute: fresh classes, palette styles and computed breaks (edits dropped) */
export function resetStyles(tab: AttributeType, data = datasetGetter()): void {
    const cfg = useAttributeStore.getState()[tab];
    useAttributeStore.setState({ [tab]: classifyConfig(tab, { ...cfg, breaksEdited: false }, data, null) } as any);
}

/** Apply a tab's field, method and class count to other tabs (their own styles) */
export function copyClassificationTo(from: AttributeType, tabs: AttributeType[], data = datasetGetter()): void {
    const state = useAttributeStore.getState();
    const src = state[from];
    if (!src.field) return;
    const update: Partial<Record<AttributeType, AttributeConfig>> = {};
    for (const t of tabs) {
        if (t === from) continue;
        const cfg: AttributeConfig = {
            ...state[t],
            field: src.field,
            additionalFields: [...(src.additionalFields ?? [])],
            method: src.method === 'progressive' ? 'equal' : src.method,
            numClasses: src.numClasses,
            breaksEdited: false,
        };
        const built = classifyConfig(t, cfg, data, null);
        // hand-edited breaks travel too
        if (src.breaksEdited) {
            const ranges = src.entries.filter(e => e.type === 'range' && !e.isDefault);
            const entries = buildClasses(t, cfg, data, ranges);
            if (entries) { update[t] = { ...built, entries, breaksEdited: true }; continue; }
        }
        update[t] = built;
    }
    useAttributeStore.setState(update as any);
}

/** Same classes (keys, bounds, styles)? Used to skip no-op rebuilds */
function sameEntries(a: AttributeEntry[], b: AttributeEntry[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        const x = a[i], y = b[i];
        if (x.key !== y.key || x.min !== y.min || x.max !== y.max || x.categoryValue !== y.categoryValue) return false;
        for (const p of EDITABLE_PROPS) if (x[p] !== y[p]) return false;
    }
    return true;
}

/** Rebuild every `auto` tab for the current data (after an edit, BDL or mapping change) */
export function reclassifyAuto(data = datasetGetter()): void {
    const state = useAttributeStore.getState();
    const update: Partial<Record<AttributeType, AttributeConfig>> = {};
    for (const t of ['color', 'shape', 'size', 'filter'] as AttributeType[]) {
        const cfg = state[t];
        if (!cfg.auto || !cfg.field || !data.getCol(cfg.field)) continue;
        const next = classifyConfig(t, cfg, data, cfg, { keepStyles: true });
        if (!sameEntries(cfg.entries, next.entries)) update[t] = next;
    }
    if (Object.keys(update).length) useAttributeStore.setState(update as any);
}

let installed = false;
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Keep classes in step with the data: rebuild `auto` tabs when the dataset,
 * BDL factor or element mappings change, and drop a value filter whose
 * column is gone. Installed once from main.tsx.
 */
export function installAutoReclassify(): void {
    if (installed) return;
    installed = true;
    useAppStore.subscribe((s, prev) => {
        if (s.columnarData === prev.columnarData && s.bdlFactor === prev.bdlFactor && s.geochemMappings === prev.geochemMappings) return;
        if (s.columnarData !== prev.columnarData) {
            const vf = useAttributeStore.getState().valueFilter;
            const col = vf.column ?? useAttributeStore.getState().color.field;
            if (vf.enabled && col && !s.columnarData.columns.has(col)) useAttributeStore.setState({ valueFilter: DEFAULT_VALUE_FILTER });
        }
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; reclassifyAuto(); }, 150);
    });
}
