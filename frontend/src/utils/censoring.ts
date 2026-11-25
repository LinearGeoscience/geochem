/**
 * Below-detection (censored) assay values.
 *
 * Storage follows the standard convention: "<0.01" is stored as -0.01, i.e. a
 * negative value in an element/oxide column means "below the detection limit
 * |value|". Values are substituted at the point of use, never at import, so
 * the original information is kept:
 *
 *   analytical value = |value| × bdlFactor   (bdlFactor = null -> missing)
 *
 * Only columns mapped to an element or oxide are treated this way; other
 * numeric columns (PCA scores, coordinates, ratios) may legitimately be
 * negative. Each element column's mapping can say what its negatives mean
 * (CensoringMode): below detection with missing codes guessed (auto), always a
 * limit (limits), or real signed readings never substituted (signed).
 */
import { ColumnGeochemMapping, CensoringMode } from '../types/associations';
import { ColumnarStore, ColumnData, isNumericColumn } from '../types/columnarData';

/** Default substitution: half the detection limit. */
export const DEFAULT_BDL_FACTOR = 0.5;

export const BDL_FACTOR_OPTIONS: { value: number | null; label: string }[] = [
    { value: 0.5, label: '½ × detection limit' },
    { value: Math.SQRT1_2, label: 'detection limit / √2' },
    { value: 1, label: '1 × detection limit' },
    { value: 0.1, label: '0.1 × detection limit' },
    { value: null, label: 'Treat as missing' },
];

/** Names of columns whose negative values are below-detection markers. */
export function censorableColumns(mappings: ColumnGeochemMapping[]): Set<string> {
    const set = new Set<string>();
    for (const m of mappings) {
        // Derived columns (CLR/PCA/recalculated... carry a role) may be negative legitimately
        // Said to hold detection limits (e.g. a below-detection text column
        // converted to -DL): censorable whatever its role
        if (m.censoring === 'limits') { set.add(m.originalName); continue; }
        if (m.isExcluded || m.category === 'nonGeochemical' || m.role) continue;
        // Signed readings: a negative value is a value
        if (m.censoring === 'signed') continue;
        if (m.userOverride ?? m.detectedElement) set.add(m.originalName);
    }
    return set;
}

/** Number of below-detection (negative) values in a column. */
export function countCensored(col: ColumnData | undefined): number {
    if (!col || !isNumericColumn(col)) return 0;
    let n = 0;
    for (let i = 0; i < col.length; i++) if (col[i] < 0 && !isMissingCode(col[i])) n++;
    return n;
}

/**
 * Missing-value sentinels that databases write into numeric assay fields
 * (-99, -999, -9999, -666, and the same ×1000 after a ppm→ppb conversion).
 * They are NOT detection limits: substituting them would invent huge grades
 * (-9999 ppm Au -> 4999.5 ppm).
 */
export function isMissingCode(v: number): boolean {
    const a = Math.abs(v);
    if (!Number.isInteger(a) || a < 99) return false;
    return /^(9{2,}|6{3,})0*$/.test(String(a));
}

/**
 * Substitute below-detection values. Returns the SAME array when there is
 * nothing to substitute, so unchanged columns keep their identity.
 *
 * mode 'auto': a negative value is a "<DL" only when it is plausible as a
 * detection limit: sentinel codes (isMissingCode) and negatives larger in
 * magnitude than every real value in the column become missing instead.
 * mode 'limits': every negative value is a detection limit.
 */
export function substituteCensored(col: Float64Array, factor: number | null, mode: Exclude<CensoringMode, 'signed'> = 'auto'): Float64Array {
    let first = -1;
    let maxPositive = -Infinity;
    for (let i = 0; i < col.length; i++) {
        const v = col[i];
        if (v < 0) { if (first < 0) first = i; }
        else if (v > maxPositive) maxPositive = v;
    }
    if (first < 0) return col;
    const out = Float64Array.from(col);
    for (let i = first; i < out.length; i++) {
        const v = out[i];
        if (!(v < 0)) continue;
        const implausible = mode === 'auto' && (isMissingCode(v) || (maxPositive > 0 && -v > maxPositive));
        out[i] = factor === null || implausible ? NaN : -v * factor;
    }
    return out;
}

/**
 * Substituted values cached per raw column array: every dataset version
 * shares its unchanged columns, so it shares their substituted copies too.
 * (Undo history keeps old versions alive; a per-version copy of every
 * element column cost ~100+ MB per edit on a 50k-row dataset.)
 */
const columnSubCache = new WeakMap<Float64Array, Map<string, Float64Array>>();

function substitutedColumn(col: Float64Array, factor: number | null, mode: Exclude<CensoringMode, 'signed'>): Float64Array {
    const key = `${factor}|${mode}`;
    let byKey = columnSubCache.get(col);
    const hit = byKey?.get(key);
    if (hit) return hit;
    const sub = substituteCensored(col, factor, mode);
    if (!byKey) { byKey = new Map(); columnSubCache.set(col, byKey); }
    byKey.set(key, sub);
    return sub;
}

/**
 * Store view with censored columns substituted. Cached per (store, mappings,
 * factor); the store itself is never modified.
 */
const analyticalCache = new WeakMap<ColumnarStore, {
    mappings: ColumnGeochemMapping[];
    factor: number | null;
    store: ColumnarStore;
}>();

export function analyticalStore(
    raw: ColumnarStore,
    mappings: ColumnGeochemMapping[],
    factor: number | null,
): ColumnarStore {
    const cached = analyticalCache.get(raw);
    if (cached && cached.mappings === mappings && cached.factor === factor) return cached.store;

    const censorable = censorableColumns(mappings);
    const limitsOnly = new Set(mappings.filter(m => m.censoring === 'limits').map(m => m.originalName));
    let columns: Map<string, ColumnData> | null = null;
    for (const name of censorable) {
        const col = raw.columns.get(name);
        if (!col || !isNumericColumn(col)) continue;
        const sub = substitutedColumn(col, factor, limitsOnly.has(name) ? 'limits' : 'auto');
        if (sub !== col) {
            if (!columns) columns = new Map(raw.columns);
            columns.set(name, sub);
        }
    }
    const store = columns ? { rowCount: raw.rowCount, columns } : raw;
    analyticalCache.set(raw, { mappings, factor, store });
    return store;
}

/**
 * Parse a raw cell value that may be censored text.
 * "<0.01" -> -0.01, ">10000" -> 10000, otherwise the number (or null).
 */
export function parseCensoredValue(value: string): number | null {
    const m = /^\s*([<>])\s*=?\s*([0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)\s*$/.exec(value);
    if (m) {
        const v = parseFloat(m[2]);
        return m[1] === '<' ? -v : v;
    }
    const cleaned = value.replace(/[,%$]/g, '').trim();
    if (cleaned === '') return null;
    const parsed = Number(cleaned);
    return Number.isNaN(parsed) ? null : parsed;
}
