/**
 * Columnar data storage types for memory-efficient tabular data.
 *
 * Instead of `data: any[]` (array of row objects), data is stored as
 * typed columns: Float64Array for numeric data (NaN = null/missing),
 * string[] for text/categorical data ('' = null/missing).
 *
 * For a 200k-row × 100-column numeric dataset this reduces memory from
 * ~4-5 GB (JS object overhead) to ~160 MB (8 bytes × 200k × 100).
 */

/** A column of numeric values. NaN represents null/missing. */
export type NumericColumn = Float64Array;

/** A column of string values. Empty string represents null/missing. */
export type StringColumn = string[];

/** Union of all column storage types. */
export type ColumnData = NumericColumn | StringColumn;

/** Columnar storage container — one typed array per column. */
export interface ColumnarStore {
    rowCount: number;
    columns: Map<string, ColumnData>;
}

/** Type guard: true if the column is a Float64Array (numeric). */
export function isNumericColumn(col: ColumnData): col is Float64Array {
    return col instanceof Float64Array;
}

/** Type guard: true if the column is a string[] (text/categorical). */
export function isStringColumn(col: ColumnData): col is string[] {
    return Array.isArray(col);
}

/** Check if a value at index `i` is null/missing in the given column. */
export function isNull(col: ColumnData, i: number): boolean {
    if (col instanceof Float64Array) {
        return isNaN(col[i]);
    }
    return col[i] === '';
}

/** Create an empty ColumnarStore. */
export function emptyColumnarStore(): ColumnarStore {
    return { rowCount: 0, columns: new Map() };
}
