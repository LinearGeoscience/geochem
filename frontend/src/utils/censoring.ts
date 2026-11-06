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
 * negative.
 */
import { ColumnGeochemMapping } from '../types/associations';
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
        if (m.isExcluded || m.category === 'nonGeochemical' || m.role) continue;
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
 * A negative value is a "<DL" only when it is plausible as a detection limit:
 * sentinel codes (isMissingCode) and negatives larger in magnitude than every
 * real value in the column become missing instead.
 */
export function substituteCensored(col: Float64Array, factor: number | null): Float64Array {
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
        const implausible = isMissingCode(v) || (maxPositive > 0 && -v > maxPositive);
        out[i] = factor === null || implausible ? NaN : -v * factor;
    }
    return out;
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
    let columns: Map<string, ColumnData> | null = null;
    for (const name of censorable) {
        const col = raw.columns.get(name);
        if (!col || !isNumericColumn(col)) continue;
        const sub = substituteCensored(col, factor);
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
