/**
 * Wireframes loaded into 3D viewer plots, per plot id.
 *
 * Kept in memory for the session (they survive closing/reopening the pane,
 * not a page reload): meshes can be tens of MB, too big for plot settings or
 * the project file. Parsing runs in a Web Worker (workers/wireframe.worker.ts).
 */
import { create } from 'zustand';
import type { ParsedWireframe, WireframeBounds, WireframeFormat, WireframePart } from './wireframeParsers';

export interface WireframeLayer {
    id: string;
    /** Display name: file name, plus the layer/object name for multi-part files */
    name: string;
    fileName: string;
    format: WireframeFormat;
    part: WireframePart;
    color: string;
    /** Surface opacity; 0 hides the surface (edges/lines still draw) */
    opacity: number;
    visible: boolean;
    /** Draw the triangle edges (a true "wireframe" look) */
    showEdges: boolean;
}

/** Stable empty list (a new [] per render would re-run effects). */
export const NO_WIREFRAMES: WireframeLayer[] = [];

/** Distinct, print-friendly colours for successive wireframes. */
const PALETTE = ['#e6550d', '#3182bd', '#31a354', '#756bb1', '#d6616b', '#8c6d31', '#17becf', '#bcbd22', '#636363', '#e7298a'];

interface WireframeState {
    byPlot: Record<string, WireframeLayer[]>;
    add: (plotId: string, layers: Omit<WireframeLayer, 'id' | 'color' | 'opacity' | 'visible' | 'showEdges'>[]) => void;
    update: (plotId: string, id: string, patch: Partial<Omit<WireframeLayer, 'id' | 'part'>>) => void;
    remove: (plotId: string, id: string) => void;
    clear: (plotId: string) => void;
}

let nextId = 1;

export const useWireframeStore = create<WireframeState>()((set) => ({
    byPlot: {},
    add: (plotId, layers) => set(s => {
        const existing = s.byPlot[plotId] ?? [];
        const added = layers.map((l, k): WireframeLayer => ({
            ...l,
            id: `wf${nextId++}`,
            color: PALETTE[(existing.length + k) % PALETTE.length],
            // Lines-only objects (strings, pit outlines) have no surface to see through
            opacity: l.part.triangles.length > 0 ? 0.6 : 1,
            visible: true,
            showEdges: false,
        }));
        return { byPlot: { ...s.byPlot, [plotId]: [...existing, ...added] } };
    }),
    update: (plotId, id, patch) => set(s => ({
        byPlot: { ...s.byPlot, [plotId]: (s.byPlot[plotId] ?? []).map(l => (l.id === id ? { ...l, ...patch } : l)) },
    })),
    remove: (plotId, id) => set(s => ({
        byPlot: { ...s.byPlot, [plotId]: (s.byPlot[plotId] ?? []).filter(l => l.id !== id) },
    })),
    clear: (plotId) => set(s => {
        const next = { ...s.byPlot };
        delete next[plotId];
        return { byPlot: next };
    }),
}));

// ---------------------------------------------------------------------------
// Loading (Web Worker, with a main-thread fallback)
// ---------------------------------------------------------------------------

let worker: Worker | null = null;
let workerFailed = false;
const pending = new Map<number, { resolve: (r: ParsedWireframe) => void; reject: (e: Error) => void }>();
let nextRequest = 0;

function getWorker(): Worker | null {
    if (worker || workerFailed) return worker;
    try {
        worker = new Worker(new URL('../../../workers/wireframe.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (e: MessageEvent) => {
            const { id, result, error } = e.data;
            const p = pending.get(id);
            if (!p) return;
            pending.delete(id);
            if (error) p.reject(new Error(error));
            else p.resolve(result);
        };
        worker.onerror = () => {
            for (const p of pending.values()) p.reject(new Error('The wireframe reader stopped unexpectedly'));
            pending.clear();
            worker?.terminate();
            worker = null;
            workerFailed = true;
        };
        return worker;
    } catch {
        workerFailed = true;
        return null;
    }
}

async function parseOnMainThread(file: File): Promise<ParsedWireframe> {
    const { parseWireframe } = await import('./wireframeParsers');
    return parseWireframe(file.name, await file.arrayBuffer());
}

export async function parseWireframeFile(file: File): Promise<ParsedWireframe> {
    const w = getWorker();
    if (!w) return parseOnMainThread(file);
    const buffer = await file.arrayBuffer();
    try {
        return await new Promise<ParsedWireframe>((resolve, reject) => {
            const id = nextRequest++;
            pending.set(id, { resolve, reject });
            w.postMessage({ id, name: file.name, buffer }, [buffer]);
        });
    } catch (e) {
        // The worker itself died (not a file error): read the file again here
        if (workerFailed) return parseOnMainThread(file);
        throw e;
    }
}

/** World bounds of several boxes (null when empty). */
export function unionBounds(boxes: WireframeBounds[]): WireframeBounds | null {
    if (boxes.length === 0) return null;
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const b of boxes) {
        for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], b.min[k]);
            max[k] = Math.max(max[k], b.max[k]);
        }
    }
    return { min, max };
}

/**
 * Plan-view distance (m) between a wireframe and the data, 0 when their
 * extents overlap (with a margin) — a large gap usually means a different
 * coordinate system (e.g. local mine grid vs MGA).
 */
export function planGap(a: WireframeBounds, b: { min: number[]; max: number[] }): number {
    const margin = 0.1 * Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], 1);
    const dx = Math.max(0, a.min[0] - (b.max[0] + margin), (b.min[0] - margin) - a.max[0]);
    const dy = Math.max(0, a.min[1] - (b.max[1] + margin), (b.min[1] - margin) - a.max[1]);
    return Math.hypot(dx, dy);
}
