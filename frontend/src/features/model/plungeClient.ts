/**
 * The plunge scan (plungeScan.ts) run from the 3D view: the samples are
 * gathered here, scanned in a worker of their own (workers/plunge.worker.ts,
 * so the analysis worker is not held up), and the result is kept for the
 * session. A new scan, or "Stop", ends the one running.
 */
import { create } from 'zustand';
import { useAppStore } from '../../store/appStore';
import type { PlungeResult, PlungeSamples } from './plungeScan';

/** What a scan was run on */
export interface PlungeAbout {
    column: string;
    /** Only these many selected samples (null: all of them) */
    selected: number | null;
    /** The numeric model whose samples were scanned (its id), when it was run from one's properties */
    model?: string;
}

interface PlungeState {
    running: boolean;
    /** 0..1 */
    progress: number;
    result: PlungeResult | null;
    about: PlungeAbout | null;
    error: string | null;
    run: (samples: PlungeSamples, about: PlungeAbout, spacing: number | null) => void;
    stop: () => void;
}

let worker: Worker | null = null;
let current = 0;

function end() {
    worker?.terminate();
    worker = null;
}

export const usePlungeScan = create<PlungeState>((set) => ({
    running: false,
    progress: 0,
    result: null,
    about: null,
    error: null,
    run: (samples, about, spacing) => {
        end();
        const id = ++current;
        set({ running: true, progress: 0, error: null });
        const done = (result: PlungeResult) => { if (id === current) set({ running: false, progress: 1, result, about }); };
        const failed = (message: string) => { if (id === current) set({ running: false, error: message }); };
        try {
            worker = new Worker(new URL('../../workers/plunge.worker.ts', import.meta.url), { type: 'module' });
        } catch {
            worker = null;
        }
        if (!worker) {
            // No workers (tests): on this thread, after the page has drawn "Scanning"
            setTimeout(() => {
                import('./plungeScan').then(m => done(m.scanPlunge(samples, { spacing }))).catch(e => failed(e instanceof Error ? e.message : String(e)));
            }, 0);
            return;
        }
        worker.onmessage = (e: MessageEvent) => {
            const m = e.data as { id: number; progress?: number; result?: PlungeResult; error?: string };
            if (m.id !== id) return;
            if (m.progress !== undefined) { if (id === current) set({ progress: m.progress }); return; }
            end();
            if (m.error) failed(m.error);
            else if (m.result) done(m.result);
        };
        worker.onerror = (e) => { end(); failed(e.message || 'The plunge scan stopped unexpectedly'); };
        worker.postMessage({ id, samples, spacing });
    },
    stop: () => {
        end();
        current++;
        set({ running: false, progress: 0 });
    },
}));

/** Columns of the view the scan needs */
export interface PlungeCoords {
    x: string;
    y: string;
    z: string | null;
    hole: string | null;
    from: string | null;
}

/**
 * The samples to scan: each row's place, its grade in `column` (analytical
 * values: below detection as substituted) and its hole; only `rows` when
 * given (the selection). Null when the view has no Z or no hole column.
 */
export function plungeSamples(coords: PlungeCoords, column: string, rows: readonly number[] | null): PlungeSamples | null {
    if (!coords.z || !coords.hole) return null;
    const app = useAppStore.getState();
    const x = app.getNumericColumn(coords.x), y = app.getNumericColumn(coords.y), z = app.getNumericColumn(coords.z);
    const value = app.getNumericColumn(column), holes = app.getRawColumn(coords.hole);
    const depth = coords.from ? app.getNumericColumn(coords.from) ?? null : null;
    if (!x || !y || !z || !value || !holes) return null;
    const ids = new Map<string, number>();
    const holeOf = (i: number) => {
        const raw = holes[i];
        const name = typeof raw === 'number' ? (Number.isFinite(raw) ? String(raw) : '') : String(raw ?? '').trim();
        if (!name) return -1;
        let k = ids.get(name);
        if (k === undefined) { k = ids.size; ids.set(name, k); }
        return k;
    };
    const take = rows ?? Array.from({ length: value.length }, (_, i) => i);
    const out = {
        x: new Float64Array(take.length), y: new Float64Array(take.length), z: new Float64Array(take.length),
        value: new Float64Array(take.length), hole: new Int32Array(take.length), depth: depth ? new Float64Array(take.length) : null,
    };
    take.forEach((r, k) => {
        out.x[k] = x[r]; out.y[k] = y[r]; out.z[k] = z[r]; out.value[k] = value[r]; out.hole[k] = holeOf(r);
        if (out.depth && depth) out.depth[k] = depth[r];
    });
    return out;
}
