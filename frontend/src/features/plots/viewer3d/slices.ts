/**
 * Slices through the 3D viewer's data (pure, no three.js, unit-tested).
 *
 * A slice is a slab: everything within `width / 2` of a plane. Up to two can
 * be on at once (a crossing pair shows what lies inside both). The plane is
 * kept as a unit normal and a world-coordinate point on it, so any orientation
 * works: the W-E / S-N / level presets, a line drawn on screen, the section
 * through a hole, or square to the current view.
 */
import { sectionNormal, ClipState, Bounds3, MAX_SLABS, SLAB_OPEN } from './geometry';

export type Vec3 = [number, number, number];

export interface Slice {
    /** Applied to the view (off = kept but not cutting) */
    on: boolean;
    /** Unit normal of the mid-plane; stepping forward moves along it */
    normal: Vec3;
    /** A point on the mid-plane, WORLD coordinates (float64) */
    center: Vec3;
    /** Full thickness (m) */
    width: number;
    /** Step distance (m); null = one width */
    step: number | null;
    /** What is kept: a slab about the plane (default), or everything behind / in front of it */
    mode?: SliceMode;
    /** The side the front faces: 1 along the normal, -1 against it (default: see sliceFront) */
    front?: 1 | -1;
    /** Stays square to the view, at the same distance from the viewer, as the camera moves */
    locked?: boolean;
}

/** `front` / `back` name the side that is REMOVED. */
export type SliceMode = 'thick' | 'front' | 'back';

export type SliceKind = 'we' | 'sn' | 'level' | 'other';
export type PresetKind = Exclude<SliceKind, 'other'>;

/** Colour of slice 1 and slice 2 (their row in the slice bar and their outline in the view). */
export const SLICE_COLORS = ['#009688', '#f57c00'];

/** W-E section (steps north), S-N section (steps east), level plan (steps up). */
export const PRESET_NORMALS: Record<PresetKind, Vec3> = { we: [0, 1, 0], sn: [1, 0, 0], level: [0, 0, 1] };

/** Within half a degree of a preset counts as that preset. */
const SNAP_COS = Math.cos((0.5 * Math.PI) / 180);

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: ArrayLike<number>, b: ArrayLike<number>): Vec3 =>
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * Unit normal with a fixed sign (its largest component positive, so "forward"
 * is north / east / up), snapped onto a preset when within half a degree.
 * Null for a zero vector.
 */
export function canonicalNormal(n: ArrayLike<number>): Vec3 | null {
    const len = Math.hypot(n[0], n[1], n[2]);
    if (!(len > 1e-12)) return null;
    let v: Vec3 = [n[0] / len, n[1] / len, n[2] / len];
    const a = v.map(Math.abs);
    const k = a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2;
    if (v[k] < 0) v = [-v[0], -v[1], -v[2]];
    for (const preset of Object.values(PRESET_NORMALS)) {
        if (dot(v, preset) >= SNAP_COS) return [...preset];
    }
    return v;
}

export function sliceKind(normal: Vec3): SliceKind {
    for (const [kind, preset] of Object.entries(PRESET_NORMALS) as [PresetKind, Vec3][]) {
        if (Math.abs(dot(normal, preset)) >= SNAP_COS) return kind;
    }
    return 'other';
}

/**
 * Which side of a slice is its front (the side "Look at" views it from, and
 * the side "remove front" hides): 1 = the side its normal points to, -1 the
 * other. Unless set (a slice taken from the view faces the viewer), sections
 * are seen looking north / east and flat slices from above.
 */
export function sliceFront(slice: Pick<Slice, 'normal' | 'front'>): 1 | -1 {
    if (slice.front === 1 || slice.front === -1) return slice.front;
    return Math.abs(slice.normal[2]) > 0.7 ? (slice.normal[2] > 0 ? 1 : -1) : -1;
}

/** A slice pointed a new way: any facing, lock or side taken from an earlier view is dropped. */
export function withNormal(slice: Slice, normal: Vec3): Slice {
    const { front: _front, locked: _locked, ...rest } = slice;
    return { ...rest, on: true, normal };
}

/** Signed distances from the plane, along the normal, that a slice keeps. */
export function sliceKeeps(slice: Slice): [number, number] {
    const mode = slice.mode ?? 'thick';
    if (mode === 'thick') {
        const half = Math.max(slice.width, 0.001) / 2;
        return [-half, half];
    }
    // Removing the front keeps the plane and everything behind it
    const keepSide = mode === 'front' ? -sliceFront(slice) : sliceFront(slice);
    return keepSide > 0 ? [0, SLAB_OPEN] : [-SLAB_OPEN, 0];
}

/** Strike (0-180, clockwise from north) and dip (0 = level, 90 = vertical) of the plane. */
export function sliceOrientation(normal: Vec3): { strike: number; dip: number } {
    const dip = (Math.acos(Math.min(1, Math.abs(normal[2]))) * 180) / Math.PI;
    const h = Math.hypot(normal[0], normal[1]);
    if (h < 1e-9) return { strike: 0, dip: 0 };
    // The strike is horizontal and at right angles to the normal
    let strike = (Math.atan2(-normal[1], normal[0]) * 180) / Math.PI;
    strike = ((strike % 180) + 180) % 180;
    return { strike: Math.round(strike) % 180, dip: Math.round(dip) };
}

/**
 * The number shown (and typed) for where a slice is: the real coordinate for a
 * preset (Northing, Easting, elevation), otherwise metres from the data centre.
 */
export function slicePosition(slice: Slice, dataCentre: Vec3): number {
    const kind = sliceKind(slice.normal);
    if (kind === 'we') return slice.center[1];
    if (kind === 'sn') return slice.center[0];
    if (kind === 'level') return slice.center[2];
    return dot([slice.center[0] - dataCentre[0], slice.center[1] - dataCentre[1], slice.center[2] - dataCentre[2]], slice.normal);
}

export function moveSlice(slice: Slice, distance: number): Slice {
    const n = slice.normal;
    return { ...slice, center: [slice.center[0] + n[0] * distance, slice.center[1] + n[1] * distance, slice.center[2] + n[2] * distance] };
}

export function withPosition(slice: Slice, value: number, dataCentre: Vec3): Slice {
    // The normal of a preset may point the other way in a saved slice
    const kind = sliceKind(slice.normal);
    const sign = kind === 'other' ? 1 : Math.sign(dot(slice.normal, PRESET_NORMALS[kind])) || 1;
    return moveSlice(slice, (value - slicePosition(slice, dataCentre)) * sign);
}

export const sliceStep = (slice: Slice) => (slice.step !== null && slice.step > 0 ? slice.step : slice.width);

/** Move `n` steps forward (negative: back). */
export function stepSlice(slice: Slice, n: number): Slice {
    const kind = sliceKind(slice.normal);
    const sign = kind === 'other' ? 1 : Math.sign(dot(slice.normal, PRESET_NORMALS[kind])) || 1;
    return moveSlice(slice, n * sliceStep(slice) * sign);
}

/** Positions (as slicePosition) at which the slice plane enters and leaves a world box. */
export function sliceRange(slice: Slice, box: { min: ArrayLike<number>; max: ArrayLike<number> }, dataCentre: Vec3): [number, number] {
    const here = slicePosition(slice, dataCentre);
    const kind = sliceKind(slice.normal);
    const sign = kind === 'other' ? 1 : Math.sign(dot(slice.normal, PRESET_NORMALS[kind])) || 1;
    let lo = Infinity, hi = -Infinity;
    for (let c = 0; c < 8; c++) {
        const p = [c & 1 ? box.max[0] : box.min[0], c & 2 ? box.max[1] : box.min[1], c & 4 ? box.max[2] : box.min[2]];
        const d = sign * dot([p[0] - slice.center[0], p[1] - slice.center[1], p[2] - slice.center[2]], slice.normal);
        if (d < lo) lo = d;
        if (d > hi) hi = d;
    }
    return [here + lo, here + hi];
}

/** Foot of `p` on the plane through `point` with unit `normal`. */
export function projectOntoPlane(p: ArrayLike<number>, normal: Vec3, point: ArrayLike<number>): Vec3 {
    const d = dot([p[0] - point[0], p[1] - point[1], p[2] - point[2]], normal);
    return [p[0] - normal[0] * d, p[1] - normal[1] * d, p[2] - normal[2] * d];
}

export interface Ray { origin: ArrayLike<number>; dir: ArrayLike<number> }

/**
 * The slice for a line drawn on screen: the plane through the line that runs
 * straight away from the viewer (it contains the view direction), so a line
 * drawn in plan view is a vertical section whichever camera is in use. The
 * line is taken at the depth of `focus`, the middle of what is on screen.
 *
 * `a` / `b` are the view rays through the line's ends and `forward` the view
 * direction, in the viewer's drawing space (z multiplied by the vertical
 * exaggeration `vex`); `focus` and the result are in data space (z as
 * stored). Null when the two ends are the same place.
 */
export function planeFromScreenLine(a: Ray, b: Ray, forward: ArrayLike<number>, focus: ArrayLike<number>, vex: number): { normal: Vec3; point: Vec3 } | null {
    const f = [focus[0], focus[1], focus[2] * vex];
    // Where a ray meets the plane through the focus, square to the view
    const atDepth = (r: Ray): Vec3 | null => {
        const along = dot(r.dir, forward);
        if (!(Math.abs(along) > 1e-12)) return null;
        const t = dot([f[0] - r.origin[0], f[1] - r.origin[1], f[2] - r.origin[2]], forward) / along;
        return [r.origin[0] + r.dir[0] * t, r.origin[1] + r.dir[1] * t, r.origin[2] + r.dir[2] * t];
    };
    const pa = atDepth(a), pb = atDepth(b);
    if (!pa || !pb) return null;
    const line: Vec3 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const drawn = cross(line, forward);
    const scale = Math.hypot(...line) * Math.hypot(forward[0], forward[1], forward[2]);
    if (!(scale > 0) || !(Math.hypot(...drawn) > scale * 1e-6)) return null;
    // A plane n'·p' = k in drawing space is (n'x, n'y, n'z * vex)·p = k in data space
    const normal = canonicalNormal([drawn[0], drawn[1], drawn[2] * vex]);
    if (!normal) return null;
    return { normal, point: [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / (2 * vex)] };
}

/** Normal (data space) of the plane square to a view direction given in drawing space. */
export function normalFromView(forward: ArrayLike<number>, vex: number): Vec3 | null {
    return canonicalNormal([forward[0], forward[1], forward[2] * vex]);
}

/** The side of a plane (data-space `normal`) a viewer looking along `forward` (drawing space) is on. */
export function sideFacingView(normal: Vec3, forward: ArrayLike<number>, vex: number): 1 | -1 {
    // The plane's normal in drawing space is (nx, ny, nz / vex)
    return normal[0] * forward[0] + normal[1] * forward[1] + (normal[2] / vex) * forward[2] > 0 ? -1 : 1;
}

/**
 * Metres to move a slice for a mouse drag of (dx, dy) pixels (y down).
 * `perMetre` is how far the slice's centre moves on screen for a metre along
 * its normal: seen at an angle, the slice follows the mouse. Seen square-on it
 * does not move on screen, so dragging up pushes it away from the viewer
 * (`awaySign`: the direction along the normal that leads away) at the view's
 * scale (`pixelsPerMetre`).
 */
export function dragDistance(dx: number, dy: number, perMetre: [number, number], pixelsPerMetre: number, awaySign: number): number {
    const len2 = perMetre[0] * perMetre[0] + perMetre[1] * perMetre[1];
    if (!(pixelsPerMetre > 0)) return 0;
    if (len2 > (0.3 * pixelsPerMetre) ** 2) return (dx * perMetre[0] + dy * perMetre[1]) / len2;
    return (-dy / pixelsPerMetre) * (awaySign < 0 ? -1 : 1);
}

/** Width after dragging (dx, dy) pixels: up or right is wider, doubling every 100 px. */
export function dragWidth(width: number, dx: number, dy: number): number {
    return Math.max(0.001, Number((width * Math.pow(2, (dx - dy) / 100)).toPrecision(3)));
}

/**
 * The vertical section that contains a hole: through the middle of its
 * samples, along the direction they spread furthest in plan. A hole with no
 * spread in plan (vertical) keeps `fallback`'s direction (made vertical).
 * `positions` are xyz triples; `rows` the hole's samples.
 */
export function planeThroughHole(positions: ArrayLike<number>, rows: ArrayLike<number>, fallback: Vec3): { normal: Vec3; point: Vec3 } | null {
    const m = rows.length;
    if (m === 0) return null;
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < m; k++) {
        cx += positions[rows[k] * 3]; cy += positions[rows[k] * 3 + 1]; cz += positions[rows[k] * 3 + 2];
    }
    cx /= m; cy /= m; cz /= m;
    let sxx = 0, syy = 0, sxy = 0;
    for (let k = 0; k < m; k++) {
        const dx = positions[rows[k] * 3] - cx, dy = positions[rows[k] * 3 + 1] - cy;
        sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
    // Direction of the largest spread in plan (principal axis of the xy scatter)
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const along = [Math.cos(theta), Math.sin(theta)];
    const spread = Math.sqrt((sxx * along[0] * along[0] + 2 * sxy * along[0] * along[1] + syy * along[1] * along[1]) / m);
    let normal: Vec3 | null;
    if (spread > 0.25) {
        normal = canonicalNormal([-along[1], along[0], 0]);
    } else {
        normal = canonicalNormal([fallback[0], fallback[1], 0]) ?? [0, 1, 0];
    }
    return normal ? { normal, point: [cx, cy, cz] } : null;
}

/**
 * Outline of a plane inside a box, as a closed loop of xyz corners (flat
 * array, in order around the loop). Empty when the plane misses the box.
 */
export function planeBoxPolygon(normal: Vec3, point: ArrayLike<number>, box: { min: ArrayLike<number>; max: ArrayLike<number> }): number[] {
    const corner = (c: number): Vec3 => [c & 1 ? box.max[0] : box.min[0], c & 2 ? box.max[1] : box.min[1], c & 4 ? box.max[2] : box.min[2]];
    const side = (p: Vec3) => dot([p[0] - point[0], p[1] - point[1], p[2] - point[2]], normal);
    const hits: Vec3[] = [];
    // The 12 edges join corners that differ in one bit
    for (let c = 0; c < 8; c++) {
        for (const bit of [1, 2, 4]) {
            if (c & bit) continue;
            const a = corner(c), b = corner(c | bit);
            const da = side(a), db = side(b);
            if (da === db || da * db > 0) continue;
            const t = da / (da - db);
            const p: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
            if (!hits.some(h => Math.hypot(h[0] - p[0], h[1] - p[1], h[2] - p[2]) < 1e-9)) hits.push(p);
        }
    }
    if (hits.length < 3) return [];
    // Order the corners by angle around their centre, within the plane
    const mid: Vec3 = [0, 0, 0];
    for (const h of hits) for (let k = 0; k < 3; k++) mid[k] += h[k] / hits.length;
    const helper: Vec3 = Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const u = cross(helper, normal), v = cross(normal, u);
    const angle = (h: Vec3) => {
        const r = [h[0] - mid[0], h[1] - mid[1], h[2] - mid[2]];
        return Math.atan2(dot(r, v), dot(r, u));
    };
    return hits.sort((p, q) => angle(p) - angle(q)).flat();
}

/** A round starting width: about a twentieth of the data's extent (1-2-5 steps). */
export function defaultSliceWidth(extent: number): number {
    if (!(extent > 0)) return 10;
    const raw = extent / 20;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    return Number(((norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag).toPrecision(1));
}

export function presetSlice(kind: PresetKind, center: Vec3, width: number): Slice {
    return { on: true, normal: [...PRESET_NORMALS[kind]], center: [...center], width, step: null };
}

// ---------------------------------------------------------------------------
// Saved settings
// ---------------------------------------------------------------------------

export interface ClipSettings {
    boxEnabled: boolean;
    /** World coordinates */
    box: { x: [number, number]; y: [number, number]; z: [number, number] } | null;
    /** Slicing switched on (the slices are kept while it is off) */
    slicing: boolean;
    slices: Slice[];
    /** Which slice the keys and Ctrl + wheel move */
    active: number;
}

export const DEFAULT_CLIP: ClipSettings = { boxEnabled: false, box: null, slicing: false, slices: [], active: 0 };

/** The clip tests for the viewport and selection: local coordinates (`origin` = the data centre). */
export function clipStateOf(c: ClipSettings, origin: ArrayLike<number>): ClipState {
    const box = c.box;
    return {
        boxEnabled: c.boxEnabled && !!box,
        boxMin: box ? [box.x[0] - origin[0], box.y[0] - origin[1], box.z[0] - origin[2]] : [0, 0, 0],
        boxMax: box ? [box.x[1] - origin[0], box.y[1] - origin[1], box.z[1] - origin[2]] : [0, 0, 0],
        slabs: !c.slicing ? [] : c.slices.filter(s => s.on).slice(0, MAX_SLABS).map(s => {
            const [lo, hi] = sliceKeeps(s);
            return {
                normal: s.normal,
                center: [s.center[0] - origin[0], s.center[1] - origin[1], s.center[2] - origin[2]],
                lo, hi,
            };
        }),
    };
}

/**
 * Outline of each cutting slice's mid-plane inside the data box (local
 * `bounds`, made a little larger to clear the samples), in the slice's colour.
 */
export function sliceFramesOf(c: ClipSettings, bounds: Bounds3, origin: ArrayLike<number>): { corners: number[]; color: string }[] {
    if (!c.slicing) return [];
    const { min, max } = bounds;
    const pad = 0.03 * Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1);
    const box = { min: min.map(v => v - pad), max: max.map(v => v + pad) };
    return c.slices.flatMap((s, i) => (s.on ? [{
        corners: planeBoxPolygon(s.normal, [s.center[0] - origin[0], s.center[1] - origin[1], s.center[2] - origin[2]], box),
        color: SLICE_COLORS[i] ?? SLICE_COLORS[0],
    }] : []));
}

/** Settings saved before slices existed: one "section slab" by strike / dip / offset from the data centre. */
interface LegacyClip {
    slabEnabled?: boolean;
    azimuth?: number;
    dip?: number;
    offset?: number;
    thickness?: number;
}

const isSlice = (s: unknown): s is Slice => {
    const v = s as Slice | null;
    return !!v && Array.isArray(v.normal) && v.normal.length === 3 && v.normal.every(Number.isFinite)
        && Array.isArray(v.center) && v.center.length === 3 && v.center.every(Number.isFinite) && v.width > 0;
};

/** Saved clip settings in today's shape (an old section slab becomes slice 1). */
export function readClipSettings(saved: unknown, dataCentre: Vec3): ClipSettings {
    const s = (saved ?? {}) as Partial<ClipSettings> & LegacyClip;
    const base = { boxEnabled: !!s.boxEnabled && !!s.box, box: s.box ?? null };
    if (Array.isArray(s.slices)) {
        const slices = s.slices.filter(isSlice).slice(0, 2).map(v => ({
            ...v,
            mode: v.mode === 'front' || v.mode === 'back' ? v.mode : undefined,
            front: v.front === 1 || v.front === -1 ? v.front : undefined,
            locked: v.locked === true ? true : undefined,
        }));
        return {
            ...base, slices,
            slicing: !!s.slicing && slices.length > 0,
            active: Math.min(Math.max(0, s.active ?? 0), Math.max(0, slices.length - 1)),
        };
    }
    if (!s.slabEnabled) return { ...DEFAULT_CLIP, ...base };
    const raw = sectionNormal(s.azimuth ?? 0, s.dip ?? 90);
    const offset = s.offset ?? 0;
    const slice: Slice = {
        on: true,
        normal: canonicalNormal(raw) ?? [1, 0, 0],
        center: [dataCentre[0] + raw[0] * offset, dataCentre[1] + raw[1] * offset, dataCentre[2] + raw[2] * offset],
        width: Math.max(s.thickness ?? 50, 0.001),
        step: null,
    };
    return { ...base, slicing: true, slices: [slice], active: 0 };
}
