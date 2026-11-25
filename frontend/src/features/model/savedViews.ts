/**
 * Named views of the scene (Phase 231): a way of looking at it that is kept
 * with the project and gone back to from any 3D view: where the camera is,
 * the vertical exaggeration it was drawn at, and the slices that were on.
 *
 * A view draws about an origin of its own, with heights stretched by its
 * exaggeration, and its orthographic zoom is in pixels. A kept view is none
 * of those: it is in world coordinates and true metres, and says how many
 * metres the height of the window showed, so it means the same in a window of
 * another size with other data loaded.
 */
import type { Vec3 } from './types';

/** A camera as a viewport has it: about its origin, z stretched, zoom in pixels a metre when orthographic */
export interface DrawnCamera {
    position: [number, number, number];
    target: [number, number, number];
    zoom: number;
    ortho: boolean;
}

/** A camera as it is kept: world coordinates, true metres */
export interface ViewCamera {
    position: Vec3;
    target: Vec3;
    ortho: boolean;
    /** Orthographic: the metres the height of the window showed */
    span?: number;
}

export interface SavedView {
    id: string;
    name: string;
    camera: ViewCamera;
    /** The vertical exaggeration it was drawn at */
    vex: number;
    /** The slices and clip box that were on, as a view keeps them (read by the view; absent: none) */
    clip?: Record<string, unknown>;
}

export const MAX_SAVED_VIEWS = 40;

/** A viewport's camera as it is kept. `height`: the window's height in pixels. */
export function cameraToWorld(c: DrawnCamera, origin: ArrayLike<number>, vex: number, height: number): ViewCamera {
    const v = vex > 0 ? vex : 1;
    const out = (p: ArrayLike<number>): Vec3 => [p[0] + origin[0], p[1] + origin[1], p[2] / v + origin[2]];
    return {
        position: out(c.position), target: out(c.target), ortho: c.ortho,
        ...(c.ortho && c.zoom > 0 && height > 0 ? { span: height / c.zoom } : {}),
    };
}

/** A kept camera for a viewport drawing about `origin` at exaggeration `vex` in a window `height` pixels high */
export function cameraFromWorld(c: ViewCamera, origin: ArrayLike<number>, vex: number, height: number): DrawnCamera {
    const v = vex > 0 ? vex : 1;
    const local = (p: ArrayLike<number>): [number, number, number] => [p[0] - origin[0], p[1] - origin[1], (p[2] - origin[2]) * v];
    return { position: local(c.position), target: local(c.target), ortho: c.ortho, zoom: c.ortho && c.span && c.span > 0 && height > 0 ? height / c.span : 1 };
}

const place = (p: unknown): Vec3 | null =>
    Array.isArray(p) && p.length === 3 && p.every(v => typeof v === 'number' && Number.isFinite(v)) ? [p[0], p[1], p[2]] : null;

/** A camera that can be gone back to, or null: two places apart, and a span when there is one */
export function readCamera(raw: unknown): ViewCamera | null {
    const c = (raw ?? {}) as Partial<ViewCamera>;
    const position = place(c.position), target = place(c.target);
    if (!position || !target) return null;
    if (!(Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]) > 0)) return null;
    const span = typeof c.span === 'number' && Number.isFinite(c.span) && c.span > 0 ? c.span : undefined;
    return { position, target, ortho: c.ortho === true, ...(span ? { span } : {}) };
}

/** Kept views as they can be used: the ones with a camera and an id of their own, named */
export function readSavedViews(raw: unknown): SavedView[] {
    if (!Array.isArray(raw)) return [];
    const out: SavedView[] = [];
    for (const r of raw as Partial<SavedView>[]) {
        if (out.length >= MAX_SAVED_VIEWS) break;
        const camera = readCamera(r?.camera);
        if (!r || typeof r.id !== 'string' || !r.id || !camera || out.some(v => v.id === r.id)) continue;
        const clip = r.clip && typeof r.clip === 'object' && !Array.isArray(r.clip) ? { clip: r.clip } : {};
        out.push({
            id: r.id,
            name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : `View ${out.length + 1}`,
            camera,
            vex: typeof r.vex === 'number' && Number.isFinite(r.vex) && r.vex > 0 ? r.vex : 1,
            ...clip,
        });
    }
    return out;
}

/** A name no other view has: the one asked for, or that with (2), (3) ... */
export function freeViewName(wanted: string, views: readonly SavedView[], but?: string): string {
    const base = wanted.trim() || 'View';
    let name = base;
    for (let k = 2; views.some(v => v.id !== but && v.name === name); k++) name = `${base} (${k})`;
    return name;
}
