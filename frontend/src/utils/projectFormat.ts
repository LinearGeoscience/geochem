/**
 * .chem project file format helpers (v4).
 *
 * v4 stores the dataset column-wise instead of as row objects (which repeated
 * every column name in every row): numeric columns as number arrays (null =
 * missing), low-cardinality text as a dictionary (levels + codes), other text
 * as string arrays. Files are gzip-compressed; readers sniff the gzip magic
 * bytes, so uncompressed JSON (v1-v3 and hand-edited files) still loads.
 *
 * Pure functions only — shared by the main thread and workers/projectIO.worker.ts.
 */
import { ColumnarStore, ColumnData, isNumericColumn, emptyColumnarStore } from '../types/columnarData';
import { rowsToColumnar, ColumnMeta } from './columnarHelpers';

export type EncodedColumn =
    | { name: string; kind: 'num'; values: (number | null)[] }
    | { name: string; kind: 'cat'; levels: string[]; codes: number[] }   // code -1 = missing
    | { name: string; kind: 'str'; values: string[] };

export interface EncodedDataset {
    rowCount: number;
    columns: EncodedColumn[];
}

/** Dictionary-encode text columns with at most this many distinct values (and ≤ half the rows). */
const MAX_LEVELS = 5000;

export function encodeDataset(store: ColumnarStore, columnOrder: string[]): EncodedDataset {
    const columns: EncodedColumn[] = [];
    for (const name of columnOrder) {
        const col = store.columns.get(name);
        if (!col) continue;
        columns.push(encodeColumn(name, col, store.rowCount));
    }
    return { rowCount: store.rowCount, columns };
}

function encodeColumn(name: string, col: ColumnData, rowCount: number): EncodedColumn {
    if (isNumericColumn(col)) {
        const values: (number | null)[] = new Array(col.length);
        for (let i = 0; i < col.length; i++) values[i] = Number.isNaN(col[i]) ? null : col[i];
        return { name, kind: 'num', values };
    }
    const levelIndex = new Map<string, number>();
    const levels: string[] = [];
    const codes: number[] = new Array(col.length);
    const limit = Math.min(MAX_LEVELS, Math.max(1, Math.floor(rowCount / 2)));
    for (let i = 0; i < col.length; i++) {
        const v = col[i];
        if (v === '') { codes[i] = -1; continue; }
        let code = levelIndex.get(v);
        if (code === undefined) {
            if (levels.length >= limit) return { name, kind: 'str', values: col.slice() };
            code = levels.length;
            levels.push(v);
            levelIndex.set(v, code);
        }
        codes[i] = code;
    }
    return { name, kind: 'cat', levels, codes };
}

export function decodeDataset(ds: EncodedDataset): ColumnarStore {
    if (!ds || !ds.rowCount) return emptyColumnarStore();
    const columns = new Map<string, ColumnData>();
    for (const c of ds.columns) {
        if (c.kind === 'num') {
            const arr = new Float64Array(ds.rowCount);
            for (let i = 0; i < ds.rowCount; i++) {
                const v = c.values[i];
                arr[i] = v === null || v === undefined ? NaN : v;
            }
            columns.set(c.name, arr);
        } else if (c.kind === 'cat') {
            const arr: string[] = new Array(ds.rowCount);
            for (let i = 0; i < ds.rowCount; i++) {
                const code = c.codes[i];
                arr[i] = code === undefined || code < 0 ? '' : c.levels[code];
            }
            columns.set(c.name, arr);
        } else {
            const arr: string[] = new Array(ds.rowCount);
            for (let i = 0; i < ds.rowCount; i++) arr[i] = c.values[i] ?? '';
            columns.set(c.name, arr);
        }
    }
    return { rowCount: ds.rowCount, columns };
}

/**
 * The dataset of a parsed project file as a columnar store: v4 `dataset`, or
 * legacy (v1-v3) row objects. Only columns listed in `appState.columns` are
 * loaded, which also drops orphan row keys from older files.
 */
export function datasetFromProject(project: any): ColumnarStore {
    const app = project?.appState ?? {};
    if (app.dataset) return decodeDataset(app.dataset as EncodedDataset);
    const columns: ColumnMeta[] = app.columns ?? [];
    return rowsToColumnar(app.data ?? [], columns);
}

// ---------------------------------------------------------------------------
// Compression
// ---------------------------------------------------------------------------

export function isGzip(bytes: Uint8Array): boolean {
    return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export async function gzipString(text: string): Promise<Blob> {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Response(stream).blob();
}

/** File bytes -> JSON text, decompressing gzip when present. */
export async function projectBytesToText(buffer: ArrayBuffer): Promise<string> {
    const bytes = new Uint8Array(buffer);
    if (!isGzip(bytes)) return new TextDecoder().decode(bytes);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
}
