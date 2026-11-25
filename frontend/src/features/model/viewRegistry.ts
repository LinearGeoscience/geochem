/**
 * The 3D views open now, each with what it shows (its status) and what it can
 * be asked to do (its actions), so the tree and the properties of the
 * Modelling page can place, draw and frame things in a view they are not part
 * of. Each 3D view registers itself (viewer3d/useModelViewHandle).
 *
 * The status is in a store, so what shows it re-renders when it changes; the
 * actions are kept apart, always the view's latest, and never re-render
 * anything.
 */
import { create } from 'zustand';
import type { ThreeViewport } from '../plots/viewer3d/ThreeViewport';
import type { SceneCoords } from './types';

/** A note a view gives back after an action ("…samples were grouped into 40 points") */
export type ViewNote = { severity: 'info' | 'warning'; text: string } | null;

export interface ViewStatus {
    plotId: string;
    /** It is drawn: its viewport can be asked where things are */
    ready: boolean;
    /** The section set it is looking along (null: none) */
    viewingSet: string | null;
    /** The view shows the coordinate columns the scene is in: its surfaces are drawn there */
    here: boolean;
    /** Why surfaces cannot be made in it (null: they can) */
    blocked: string | null;
    /** Why surfaces between logged units cannot be made from it (null: they can) */
    contactBlocked: string | null;
    /** A slice is up, to draw on */
    canSlice: boolean;
    /** The next drag draws the open surface's outline */
    outlining: boolean;
    /** Vertical exaggeration */
    vex: number;
    /** Samples picked in the data */
    selectedCount: number;
    /** The scene's columns, as the view names them (null: the scene has none yet) */
    sceneColumns: string | null;
    /** The samples have From-To intervals on holes, so they can be drawn as cylinders */
    canCylinder: boolean;
    /** The cylinders' width (m) when none is set: wide enough to see with all the holes in view */
    cylinderAuto: number;
    /** The view draws hole traces through the samples (it has a hole column) */
    hasTraces: boolean;
}

export interface ViewActions {
    viewport: () => ThreeViewport | null;
    /** The view's columns, as the coordinates of the scene */
    coords: () => SceneCoords;
    /** Start an empty surface, built by the next clicks in the view */
    newSurface: () => void;
    /** Draw lines for the open surface on a slice (one is brought up, square-on, if there is none) */
    drawOnSlice: () => void;
    /** The next drag draws the open surface's outline (again: never mind) */
    startOutline: () => void;
    /** Show the scene's columns in the view */
    useSceneColumns: () => void;
    surfaceFromSelection: () => ViewNote;
    groundFromCollars: () => ViewNote;
    /** Frame world-coordinate bounds */
    zoomToWorld: (bounds: { min: number[]; max: number[] }) => void;
    /** The data's box, world coordinates (null: nothing drawn) */
    dataBounds: () => { min: number[]; max: number[] } | null;
    /** Look along a section set, square-on */
    lookAlong: (setId: string) => void;
    /** Make a section set: from the active slice, or W-E / S-N / level through the middle of the data */
    newSectionSet: (from: 'slice' | 'we' | 'sn' | 'level') => void;
    /** Give the view the keyboard (Esc ends placing) */
    focus: () => void;
}

export const useViewRegistry = create<{ status: Record<string, ViewStatus> }>(() => ({ status: {} }));

const actionsOf = new Map<string, { current: ViewActions }>();

/** A view's actions, kept up to date by the view through `ref` */
export function registerView(id: string, ref: { current: ViewActions }): void {
    actionsOf.set(id, ref);
}

export function unregisterView(id: string, ref: { current: ViewActions }): void {
    // A view that remounted has registered again: the old one does not take it away
    if (actionsOf.get(id) === ref) actionsOf.delete(id);
    if (!actionsOf.has(id)) {
        useViewRegistry.setState(s => {
            if (!(id in s.status)) return s;
            const { [id]: _gone, ...status } = s.status;
            return { status };
        });
    }
}

const same = (a: ViewStatus | undefined, b: ViewStatus) => !!a && (Object.keys(b) as (keyof ViewStatus)[]).every(k => a[k] === b[k]);

export function setViewStatus(id: string, status: ViewStatus): void {
    if (same(useViewRegistry.getState().status[id], status)) return;
    useViewRegistry.setState(s => ({ status: { ...s.status, [id]: status } }));
}

/** A view's actions (null: it is not open) */
export const viewActions = (id: string | null): ViewActions | null => (id ? actionsOf.get(id)?.current ?? null : null);

/** A view's status (null: it is not open, or not drawn yet) */
export const useViewStatus = (id: string | null): ViewStatus | null => useViewRegistry(s => (id ? s.status[id] ?? null : null));
