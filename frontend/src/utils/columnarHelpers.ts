/**
 * Helpers for converting between row-based (any[]) and columnar (ColumnarStore) representations.
 *
 * These are used during the migration period when both `data: any[]` and
 * `columnarData: ColumnarStore` coexist, and also for export / backend sync.
 */

import {
    ColumnarStore,
    ColumnData,
    isNumericColumn,
    emptyColumnarStore,
} from '../types/columnarData';

/** Minimal column metadata needed for conversion. */
export interface ColumnMeta {
    name: string;
    type: string; // 'numeric' | 'float' | 'integer' | 'text' | 'categorical' | etc.
}

/** Filter out columns where every row is null/undefined/empty/NaN. */
export function filterEmptyColumns<T extends ColumnMeta>(rows: any[], columnInfo: T[]): T[] {
    if (rows.length === 0) return columnInfo;
    return columnInfo.filter(col => {
        for (const row of rows) {
            const v = row[col.name];
            if (v === null || v === undefined || v === '' || v === 'NA' || v === 'N/A' || v === '-') continue;
            if (typeof v === 'number' && isNaN(v)) continue;
            return true; // found at least one non-empty value
        }
        return false;
    });
}

/** Set of column types treated as numeric in columnar storage. */
const NUMERIC_TYPES = new Set(['numeric', 'float', 'integer']);

/**
 * Convert an array of row objects into a ColumnarStore with typed arrays.
 *
 * Numeric columns → Float64Array (NaN for null/missing/unparseable).
 * Text/categorical columns → string[] ('' for null/missing).
 */
export function rowsToColumnar(rows: any[], columnInfo: ColumnMeta[]): ColumnarStore {
    const rowCount = rows.length;
    if (rowCount === 0) return emptyColumnarStore();

    const columns = new Map<string, ColumnData>();

    for (const col of columnInfo) {
        const name = col.name;

        if (NUMERIC_TYPES.has(col.type)) {
            // Numeric column → Float64Array
            const arr = new Float64Array(rowCount);
            for (let i = 0; i < rowCount; i++) {
                const v = rows[i][name];
                if (v === null || v === undefined || v === '' || v === 'NA' || v === 'N/A' || v === '-') {
                    arr[i] = NaN;
                } else if (typeof v === 'number') {
                    arr[i] = v;
                } else {
                    const parsed = Number(v);
                    arr[i] = isNaN(parsed) ? NaN : parsed;
                }
            }
            columns.set(name, arr);
        } else {
            // Text / categorical → string[]
            const arr: string[] = new Array(rowCount);
            for (let i = 0; i < rowCount; i++) {
                const v = rows[i][name];
                arr[i] = (v === null || v === undefined) ? '' : String(v);
            }
            columns.set(name, arr);
        }
    }

    return { rowCount, columns };
}

/**
 * Convert a ColumnarStore back to an array of row objects.
 * Used for backward compatibility (DataView grid, CSV export, backend sync).
 */
export function columnarToRows(store: ColumnarStore): any[] {
    const { rowCount, columns } = store;
    if (rowCount === 0) return [];

    const rows: any[] = new Array(rowCount);
    for (let i = 0; i < rowCount; i++) {
        rows[i] = {};
    }

    for (const [name, col] of columns) {
        if (isNumericColumn(col)) {
            for (let i = 0; i < rowCount; i++) {
                const v = col[i];
                rows[i][name] = isNaN(v) ? null : v;
            }
        } else {
            for (let i = 0; i < rowCount; i++) {
                rows[i][name] = col[i] === '' ? null : col[i];
            }
        }
    }

    return rows;
}

/**
 * Extract a subset of a column based on a sorted array of row indices (sampling).
 * If `sampleIndices` is null, returns the full column (by reference for Float64Array,
 * or a slice for string[]).
 *
 * For Float64Array: returns a new Float64Array with only the sampled rows.
 * For string[]: returns a new string[] with only the sampled rows.
 */
export function extractDisplayColumn(
    store: ColumnarStore,
    name: string,
    sampleIndicesArray: number[] | null
): ColumnData | undefined {
    const col = store.columns.get(name);
    if (!col) return undefined;

    // No sampling — return full column by reference
    if (!sampleIndicesArray) return col;

    const len = sampleIndicesArray.length;

    if (isNumericColumn(col)) {
        const result = new Float64Array(len);
        for (let i = 0; i < len; i++) {
            result[i] = col[sampleIndicesArray[i]];
        }
        return result;
    } else {
        const result: string[] = new Array(len);
        for (let i = 0; i < len; i++) {
            result[i] = col[sampleIndicesArray[i]];
        }
        return result;
    }
}

/**
 * Get a single row as an object from columnar storage.
 * Used for lazy row access (e.g., DataGrid virtualization, tooltip hover).
 */
export function getRowFromColumnar(store: ColumnarStore, index: number): Record<string, any> {
    const row: Record<string, any> = {};
    for (const [name, col] of store.columns) {
        if (isNumericColumn(col)) {
            const v = col[index];
            row[name] = isNaN(v) ? null : v;
        } else {
            row[name] = col[index] === '' ? null : col[index];
        }
    }
    return row;
}

/**
 * Compute a sorted array of sample indices from a Set<number>.
 * Pre-computing this avoids repeated Set→Array conversion + sorting.
 */
export function computeSampleIndicesArray(sampleIndices: Set<number> | null): number[] | null {
    if (!sampleIndices) return null;
    const arr = Array.from(sampleIndices);
    arr.sort((a, b) => a - b);
    return arr;
}

/**
 * Extract a numeric matrix from columnar data for columns specified by name.
 * Rows with any NaN/missing values are skipped; returns the valid matrix and original indices.
 */
export function extractNumericMatrix(
    columns: string[],
    getCol: (name: string) => Float64Array | undefined,
    rowCount: number
): { matrix: number[][]; validIndices: number[] } {
    const cols = columns.map(c => getCol(c));
    const matrix: number[][] = [];
    const validIndices: number[] = [];

    for (let i = 0; i < rowCount; i++) {
        const row: number[] = [];
        let valid = true;
        for (let j = 0; j < columns.length; j++) {
            const col = cols[j];
            if (!col) { valid = false; break; }
            const val = col[i];
            if (isNaN(val)) { valid = false; break; }
            row.push(val);
        }
        if (valid) {
            matrix.push(row);
            validIndices.push(i);
        }
    }

    return { matrix, validIndices };
}

/**
 * Extract a raw numeric matrix (replacing NaN with 0) from columnar data.
 * Unlike extractNumericMatrix, this does NOT skip rows — all rows are included.
 * Used by transform functions that handle zeros/NaN with their own replacement strategy.
 */
export function extractRawNumericMatrix(
    columns: string[],
    getCol: (name: string) => Float64Array | undefined,
    rowCount: number
): number[][] {
    const cols = columns.map(c => getCol(c));
    const matrix: number[][] = [];

    for (let i = 0; i < rowCount; i++) {
        const row: number[] = [];
        for (let j = 0; j < columns.length; j++) {
            const col = cols[j];
            if (!col) { row.push(0); continue; }
            const val = col[i];
            row.push(isNaN(val) ? 0 : val);
        }
        matrix.push(row);
    }

    return matrix;
}
