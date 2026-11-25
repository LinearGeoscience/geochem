/**
 * How a view draws each mesh of the model (pure). An object has a look of
 * its own (a surface's and a mesh's opacity and triangle edges; a model's
 * solids, contacts and faults are drawn solid). A view may draw it another
 * way, kept by object key in the view's settings (`objectDisplay`), so that
 * one view can have a thing solid and another its outline.
 *
 * Drawn as: solid; solid with its triangle edges; its triangle edges only;
 * or its outline (its rim and its creases, lines of no width). On a slice:
 * the line where the slice's own plane cuts it, which has no width whatever
 * the slice's; its section on that plane, filled; cut by it as points and
 * holes are (what of it lies in the slice, as wide as the slice); or left
 * whole. Unless a view says otherwise a mesh has no thickness on a slice: a
 * solid (a model's unit, a shell, an intrusion, a vein) is filled there,
 * every other mesh is its line (`defaultOnSlice`, `isSolidKey`).
 */
import { parseKey, parseModelPart } from './objectKeys';
import type { SurfaceObject } from './types';

/** The view setting the display is kept under */
export const DISPLAY_SETTING = 'objectDisplay';

export type DrawnAs = 'solid' | 'edges' | 'wire' | 'outline';
export const DRAWN_AS: readonly DrawnAs[] = ['solid', 'edges', 'wire', 'outline'];
/** In words, for a button's name and its tip */
export const DRAWN_AS_NAME: Record<DrawnAs, string> = { solid: 'Solid', edges: 'Solid with edges', wire: 'Edges only', outline: 'Outline' };
export const DRAWN_AS_TIP: Record<DrawnAs, string> = {
    solid: 'Solid: its faces, filled',
    edges: 'Solid with edges: its faces and the edges of its triangles',
    wire: 'Edges only: the edges of its triangles, nothing filled',
    outline: 'Outline: its rim and its creases as lines of no width, nothing filled (a smooth shell has few: on a slice, see its line there)',
};

export type OnSlice = 'cut' | 'whole' | 'line' | 'filled';
export const ON_SLICE: readonly OnSlice[] = ['line', 'filled', 'cut', 'whole'];
export const ON_SLICE_NAME: Record<OnSlice, string> = { cut: 'Cut by the slice', line: 'Its line on the slice', filled: 'Filled on the slice', whole: 'Whole' };
export const ON_SLICE_TIP: Record<OnSlice, string> = {
    cut: 'Cut by the slice: only what of it lies in the slice is drawn, as wide as the slice',
    line: 'Its line on the slice: the line where the slice\'s own plane cuts it, of no width however wide the slice',
    filled: 'Filled on the slice: its section on the slice\'s own plane, filled (a mesh that is not closed there is drawn as its line)',
    whole: 'Whole: the slice does not cut it (the clip box still does)',
};

/**
 * The object is a solid, closed all round: a model's unit, or a surface fitted as one (a shell, an intrusion, a vein).
 * A sheet, a contact, a fault and a mesh from a file are not (a file's mesh may be closed or not: it is its line).
 */
export function isSolidKey(scene: { surfaces: readonly Pick<SurfaceObject, 'id' | 'rule'>[] } | null | undefined, key: string): boolean {
    if (parseModelPart(key)?.kind === 'volume') return true;
    const k = parseKey(key);
    if (k?.kind !== 'surface' || !scene) return false;
    const kind = scene.surfaces.find(s => s.id === k.id)?.rule.kind;
    return kind === 'body' || kind === 'shell';
}

/**
 * How a slice draws a mesh a view has nothing set for: with no thickness. A solid (`isSolidKey`: a model's unit, a
 * shell, an intrusion, a vein) is its section filled on the slice's own plane; every other mesh (a sheet, a contact
 * or fault as the model cuts it, a mesh from a file) is its line there. Something that is not a mesh is cut by the
 * slice, as points and holes are.
 */
export function defaultOnSlice(key: string, solid = parseModelPart(key)?.kind === 'volume'): OnSlice {
    if (!displayable(key)) return 'cut';
    return solid ? 'filled' : 'line';
}

/** What a view draws differently from the object's own look (a field left out: as the object has it) */
export interface ObjectDisplay {
    as?: DrawnAs;
    /** Of its faces, 0 to 1 */
    opacity?: number;
    slice?: OnSlice;
}

export type ViewDisplay = Readonly<Record<string, ObjectDisplay>>;

/** An object's own look */
export interface OwnLook {
    opacity: number;
    showEdges: boolean;
}

/** An object as a view draws it */
export interface Drawn {
    as: DrawnAs;
    /** The opacity its faces have when they are drawn (what a slider shows) */
    opacity: number;
    faces: boolean;
    edges: boolean;
    creases: boolean;
    whole: boolean;
    onSlice: OnSlice;
}

const NONE: ViewDisplay = Object.freeze({});
/** Under this a face is not drawn at all */
const UNSEEN = 0.001;

/** The kinds of object a view can draw its own way: those drawn as a mesh */
export function displayable(key: string): boolean {
    const kind = parseKey(key)?.kind;
    return kind === 'surface' || kind === 'wireframe' || parseModelPart(key) !== null;
}

function readEntry(v: unknown): ObjectDisplay | null {
    if (!v || typeof v !== 'object') return null;
    const raw = v as Record<string, unknown>, out: ObjectDisplay = {};
    if (typeof raw.as === 'string' && (DRAWN_AS as readonly string[]).includes(raw.as)) out.as = raw.as as DrawnAs;
    if (typeof raw.opacity === 'number' && Number.isFinite(raw.opacity)) out.opacity = Math.min(1, Math.max(0, raw.opacity));
    if (typeof raw.slice === 'string' && (ON_SLICE as readonly string[]).includes(raw.slice)) out.slice = raw.slice as OnSlice;
    return out.as === undefined && out.opacity === undefined && out.slice === undefined ? null : out;
}

/** A view's display as saved, read (anything else: nothing drawn differently) */
export function displayOf(saved: unknown): ViewDisplay {
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return NONE;
    const out: Record<string, ObjectDisplay> = {};
    for (const [key, v] of Object.entries(saved as Record<string, unknown>)) {
        const entry = readEntry(v);
        if (entry) out[key] = entry;
    }
    return Object.keys(out).length ? out : NONE;
}

/** What an object's own look is called */
export const ownAs = (own: OwnLook): DrawnAs => (own.showEdges ? (own.opacity > UNSEEN ? 'edges' : 'wire') : 'solid');

/** An object as a view draws it: its own look, and what the view has for it over that (`usual`: on a slice, unless the view says) */
export function drawnOf(own: OwnLook, view?: ObjectDisplay | null, usual: OnSlice = 'cut'): Drawn {
    const onSlice = view?.slice ?? usual, whole = onSlice === 'whole';
    if (!view || (view.as === undefined && view.opacity === undefined)) {
        return { as: ownAs(own), opacity: own.opacity, faces: own.opacity > UNSEEN, edges: own.showEdges, creases: false, whole, onSlice };
    }
    const as = view.as ?? (own.showEdges ? 'edges' : 'solid');
    const filled = as === 'solid' || as === 'edges';
    let opacity = view.opacity ?? own.opacity;
    // Asked for solid where it has no faces of its own to show: they are drawn (not left at nothing)
    if (filled && view.as !== undefined && view.opacity === undefined && opacity <= UNSEEN) opacity = 1;
    return { as, opacity, faces: filled && opacity > UNSEEN, edges: as === 'edges' || as === 'wire', creases: as === 'outline', whole, onSlice };
}

type Settings = Record<string, unknown> | undefined | null;

/**
 * The change to a view's settings that draws these objects another way.
 * A field of `change` given as undefined is taken away (the object's own
 * again); `change` null takes everything away for them.
 */
export function displayChange(settings: Settings, objectKeys: readonly string[], change: { [K in keyof ObjectDisplay]: ObjectDisplay[K] | undefined } | null): Record<string, unknown> {
    const next: Record<string, ObjectDisplay> = { ...displayOf(settings?.[DISPLAY_SETTING]) };
    for (const key of objectKeys) {
        if (!displayable(key)) continue;
        if (change === null) { delete next[key]; continue; }
        const merged: Record<string, unknown> = { ...next[key] };
        for (const [field, value] of Object.entries(change)) {
            if (value === undefined) delete merged[field];
            else merged[field] = value;
        }
        const entry = readEntry(merged);
        if (entry) next[key] = entry; else delete next[key];
    }
    return { [DISPLAY_SETTING]: next };
}

/** A display with the objects that are gone taken out (`there`: is this key an object still) */
export function prunedDisplay(display: ViewDisplay, there: (key: string) => boolean): ViewDisplay {
    const keep = Object.entries(display).filter(([key]) => there(key));
    return keep.length === Object.keys(display).length ? display : Object.fromEntries(keep);
}

/** A mesh layer's look with a view's display over it (the layer itself when the view has nothing for it and a slice cuts it) */
export function layerLook<L extends { id: string; opacity: number; showEdges: boolean }>(layer: L, display: ViewDisplay | undefined | null, solid?: boolean): L & { creases?: boolean; whole?: boolean; onSlice?: 'line' | 'filled' } {
    const view = display?.[layer.id], usual = defaultOnSlice(layer.id, solid);
    if (!view) return usual === 'line' || usual === 'filled' ? { ...layer, onSlice: usual } : layer;
    const d = drawnOf({ opacity: layer.opacity, showEdges: layer.showEdges }, view, usual);
    return { ...layer, opacity: d.faces ? d.opacity : 0, showEdges: d.edges, creases: d.creases, whole: d.whole, ...(d.onSlice === 'line' || d.onSlice === 'filled' ? { onSlice: d.onSlice } : {}) };
}
