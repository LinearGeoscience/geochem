/**
 * What is picked out in the 3D view while a surface is being edited: its
 * points and the nodes of its lines, to be given a direction together; and
 * the point or node whose dip reading is being typed in place (Alt+click or
 * double-click). Only for this session: not saved, not undone, and let go of
 * when another surface is opened or a project is loaded.
 *
 * A node is known by its line and its place along it, and by how many nodes
 * the line had when it was picked: once a node is put in or taken out, the
 * places along that line say other nodes, so its picks are let go.
 */
import { create } from 'zustand';
import { useModelStore, type NodePick } from '../../store/modelStore';
import type { SurfaceObject } from './types';

export interface SelectedNode extends NodePick {
    /** How many nodes its line had when it was picked */
    of: number;
}

export interface EditSelection {
    /** The surface the picks are on (null: none) */
    surface: string | null;
    points: readonly string[];
    nodes: readonly SelectedNode[];
}

/** A point or a node whose dip reading is typed in place, beside where it was clicked */
export interface ReadingEntryTarget {
    surface: string;
    point?: string;
    node?: SelectedNode;
    /** Where it was clicked, in pixels from the view's top left */
    x: number;
    y: number;
}

/** replace: these alone; toggle: off if all of them are on, else on; add: on as well */
export type SelectMode = 'replace' | 'toggle' | 'add';

export const NO_SELECTION: EditSelection = { surface: null, points: [], nodes: [] };

interface EditSessionState {
    selection: EditSelection;
    select: (surface: string, picks: { points?: readonly string[]; nodes?: readonly SelectedNode[] }, mode?: SelectMode) => void;
    clearSelection: () => void;
    entry: ReadingEntryTarget | null;
    openEntry: (entry: ReadingEntryTarget | null) => void;
    /** Lines drawn from now on are smooth: a curve through their nodes */
    drawSmooth: boolean;
    setDrawSmooth: (on: boolean) => void;
}

const nodeKey = (n: NodePick) => `${n.line}\u0000${n.vertex}`;

export const useEditSession = create<EditSessionState>()((set, get) => ({
    selection: NO_SELECTION,
    select: (surface, picks, mode = 'replace') => {
        const now = get().selection;
        const base = mode === 'replace' || now.surface !== surface ? NO_SELECTION : now;
        const points = picks.points ?? [], nodes = picks.nodes ?? [];
        const hasPoint = new Set(base.points), hasNode = new Set(base.nodes.map(nodeKey));
        const all = points.every(p => hasPoint.has(p)) && nodes.every(n => hasNode.has(nodeKey(n)));
        let next: EditSelection;
        if (mode === 'toggle' && all && points.length + nodes.length > 0) {
            const dropPoints = new Set(points), dropNodes = new Set(nodes.map(nodeKey));
            next = { surface, points: base.points.filter(p => !dropPoints.has(p)), nodes: base.nodes.filter(n => !dropNodes.has(nodeKey(n))) };
        } else {
            next = {
                surface,
                points: [...base.points, ...points.filter((p, i) => !hasPoint.has(p) && points.indexOf(p) === i)],
                nodes: [...base.nodes, ...nodes.filter((n, i) => !hasNode.has(nodeKey(n)) && nodes.findIndex(m => nodeKey(m) === nodeKey(n)) === i)],
            };
        }
        if (next.points.length === 0 && next.nodes.length === 0) next = NO_SELECTION;
        set({ selection: next });
    },
    clearSelection: () => { if (get().selection !== NO_SELECTION) set({ selection: NO_SELECTION }); },
    entry: null,
    openEntry: entry => set({ entry }),
    drawSmooth: false,
    setDrawSmooth: on => set({ drawSmooth: on }),
}));

// Another surface opened, or another project: what was picked is let go
useModelStore.subscribe((s, prev) => {
    if (s.editingId !== prev.editingId || s.sceneLoads !== prev.sceneLoads) {
        useEditSession.getState().clearSelection();
        useEditSession.getState().openEntry(null);
    }
});

/** Every node of these lines, as picks */
export function nodesOfLines(lines: readonly { id: string; points: readonly unknown[] }[]): SelectedNode[] {
    return lines.flatMap(l => l.points.map((_, vertex) => ({ line: l.id, vertex, of: l.points.length })));
}

/**
 * The picks that are still there on this surface: points it still has, nodes
 * of lines that still have as many nodes as when they were picked. The same
 * object when nothing has gone.
 */
export function liveSelection(selection: EditSelection, surface: Pick<SurfaceObject, 'id' | 'points' | 'polylines'> | null): EditSelection {
    if (!surface || selection.surface !== surface.id) return NO_SELECTION;
    const ids = new Set(surface.points.map(p => p.id));
    const counts = new Map(surface.polylines.map(l => [l.id, l.points.length]));
    const points = selection.points.filter(id => ids.has(id));
    const nodes = selection.nodes.filter(n => counts.get(n.line) === n.of && n.vertex < n.of);
    if (points.length === selection.points.length && nodes.length === selection.nodes.length) return selection;
    return points.length + nodes.length > 0 ? { surface: surface.id, points, nodes } : NO_SELECTION;
}
