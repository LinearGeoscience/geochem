/**
 * .chem project files off the main thread.
 * - parse: decompresses (gzip), JSON.parses and builds the columnar store,
 *   then transfers the typed arrays back without copying. A 31 MB v2 file
 *   previously froze the UI during load.
 * - save: encodes the dataset column-wise, JSON.stringifies and gzips, so
 *   Save and autosave don't freeze the UI on large datasets.
 */
import { projectBytesToText, datasetFromProject, encodeDataset, gzipString } from '../utils/projectFormat';
import { isNumericColumn, ColumnarStore } from '../types/columnarData';

type Msg =
    | { id: number; kind?: 'parse'; buffer: ArrayBuffer }
    | { id: number; kind: 'save'; project: any; store: ColumnarStore; columnOrder: string[] };

self.onmessage = async (e: MessageEvent<Msg>) => {
    const msg = e.data;
    const { id } = msg;
    if (msg.kind === 'save') {
        try {
            msg.project.appState.dataset = encodeDataset(msg.store, msg.columnOrder);
            const blob = await gzipString(JSON.stringify(msg.project));
            (self as unknown as Worker).postMessage({ id, blob });
        } catch (err) {
            (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
        }
        return;
    }
    const { buffer } = msg;
    try {
        const text = await projectBytesToText(buffer);
        const project = JSON.parse(text);
        const store = datasetFromProject(project);
        // The bulk data travels as `store`; don't clone it twice
        if (project.appState) {
            delete project.appState.data;
            delete project.appState.dataset;
        }
        const transfer: ArrayBuffer[] = [];
        for (const col of store.columns.values()) {
            if (isNumericColumn(col)) transfer.push(col.buffer as ArrayBuffer);
        }
        (self as unknown as Worker).postMessage({ id, project, store }, transfer);
    } catch (err) {
        (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
    }
};
