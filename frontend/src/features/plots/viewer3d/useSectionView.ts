/**
 * Section view: a 3D plot locked square-on to one plane of a section set, to
 * look at and draw on. Entering puts the active slice on the plane (so the
 * slice's drawing tools draw on it), turns the camera square-on and stops it
 * turning (panning and zooming stay); [ and ] step to the next plane, the
 * camera sliding with it; a grid with coordinates is drawn on the plane.
 * Which views are in section view, and on which plane, is shared (not saved),
 * so every 3D view can show where the others' sections are.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { usePlotSetting } from '../../../hooks/usePlotSetting';
import { useModelStore } from '../../../store/modelStore';
import { makeSectionSet, sectionIndexAt, sectionLabel, sectionPlane, sectionRange } from '../../model/sectionSets';
import type { SectionSet, Vec3 } from '../../model/types';
import type { LiveClip } from './liveClip';
import { defaultSliceWidth, planeBoxPolygon, PRESET_NORMALS, sliceStep, type ClipSettings, type PresetKind, type Slice } from './slices';
import { sectionGrid } from './sectionGrid';
import type { SliceFrame, ThreeViewport } from './ThreeViewport';

/** The plane a plot is looking at, by plot id (session only) */
export const useOpenSections = create<{ byPlot: Record<string, { set: string; index: number }>; show: (plotId: string, at: { set: string; index: number } | null) => void }>()(set => ({
    byPlot: {},
    show: (plotId, at) => set(state => {
        const was = state.byPlot[plotId];
        if (at ? was && was.set === at.set && was.index === at.index : !was) return state;
        const byPlot = { ...state.byPlot };
        if (at) byPlot[plotId] = at; else delete byPlot[plotId];
        return { byPlot };
    }),
}));

/** Colour of another view's section, drawn in this one */
export const OTHER_SECTION_COLOR = '#7e57c2';

const sameNormal = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) > 1 - 1e-9;

/** The slab a section view shows: one width about plane `index` */
export function sectionSlice(set: SectionSet, index: number): Slice {
    const { normal, point } = sectionPlane(set, index);
    return { on: true, normal, center: point, width: set.width, step: set.spacing, mode: 'thick' };
}

export interface SectionViewState {
    set: SectionSet;
    index: number;
    label: string;
    /** First and last planes through the data */
    range: [number, number];
}

interface Args {
    plotId: string;
    viewport: ThreeViewport | null;
    /** Local box of the data and its origin (world) */
    geometry: { bounds: { min: ArrayLike<number>; max: ArrayLike<number> }; origin: ArrayLike<number> } | null;
    liveClip: LiveClip;
    updateClip: (change: (prev: ClipSettings) => ClipSettings) => void;
    /** Square-on to slice `index` (and orthographic) */
    lookAtSlice: (index: number) => void;
    containerRef: React.RefObject<HTMLElement>;
    gridColor: string;
}

export function useSectionView({ plotId, viewport, geometry, liveClip, updateClip, lookAtSlice, containerRef, gridColor }: Args) {
    const sets = useModelStore(s => s.scene.sectionSets);
    const [saved, setSaved] = usePlotSetting<{ set: string; index: number } | null>(plotId, 'sectionView', null);
    const set = useMemo(() => (saved ? (sets ?? []).find(s => s.id === saved.set) ?? null : null), [saved, sets]);
    const [index, setIndex] = useState<number | null>(saved?.index ?? null);

    /** Put the active slice on plane `i` of `s` (slicing comes on) */
    const putSlice = useCallback((s: SectionSet, i: number) => {
        updateClip(prev => {
            const slice = sectionSlice(s, i);
            if (prev.slices.length === 0) return { ...prev, slicing: true, active: 0, slices: [slice] };
            return { ...prev, slicing: true, slices: prev.slices.map((x, k) => (k === prev.active ? { ...x, ...slice, front: x.front && sameNormal(x.normal, slice.normal) ? x.front : undefined, locked: false } : x)) };
        });
    }, [updateClip]);

    const rangeOf = useCallback((s: SectionSet): [number, number] => {
        if (!geometry) return [0, 0];
        const o = geometry.origin;
        return sectionRange(s, { min: [0, 1, 2].map(k => geometry.bounds.min[k] + o[k]), max: [0, 1, 2].map(k => geometry.bounds.max[k] + o[k]) });
    }, [geometry]);

    /** Look at plane `at` of a set (left out: the plane nearest the active slice, or the middle of the data) */
    const enter = useCallback((setId: string, at?: number) => {
        const s = (useModelStore.getState().scene.sectionSets ?? []).find(x => x.id === setId);
        if (!s || !geometry) return;
        let i = at;
        if (i === undefined) {
            const now = liveClip.get();
            const active = now.slicing ? now.slices[now.active] : undefined;
            const o = geometry.origin;
            const middle = [0, 1, 2].map(k => (geometry.bounds.min[k] + geometry.bounds.max[k]) / 2 + o[k]);
            i = sectionIndexAt(s, active && sameNormal(active.normal, s.normal) ? active.center : middle);
            const [lo, hi] = rangeOf(s);
            if (lo <= hi) i = Math.min(hi, Math.max(lo, i));
        }
        putSlice(s, i);
        setIndex(i);
        setSaved({ set: s.id, index: i });
        lookAtSlice(liveClip.get().active);
    }, [geometry, liveClip, putSlice, rangeOf, setSaved, lookAtSlice]);

    const exit = useCallback(() => setSaved(null), [setSaved]);

    /** `n` planes on: the slice lands exactly on the plane, and the camera slides with it */
    const step = useCallback((n: number) => {
        if (!set || index === null || !geometry) return;
        const [lo, hi] = rangeOf(set);
        const next = lo <= hi ? Math.min(hi + 1, Math.max(lo - 1, index + n)) : index + n;
        if (next === index) return;
        putSlice(set, next);
        const d = (next - index) * set.spacing;
        viewport?.shiftView([set.normal[0] * d, set.normal[1] * d, set.normal[2] * d]);
        setIndex(next);
        setSaved({ set: set.id, index: next });
    }, [set, index, geometry, rangeOf, putSlice, viewport, setSaved]);

    // A set that was removed: back to 3D
    useEffect(() => { if (saved && sets && !set) setSaved(null); }, [saved, sets, set, setSaved]);

    // The set changed (spacing, width, plane): the slice follows it
    const lastSet = useRef<SectionSet | null>(null);
    useEffect(() => {
        if (set && lastSet.current && lastSet.current.id === set.id && lastSet.current !== set && index !== null) putSlice(set, index);
        lastSet.current = set;
    }, [set, index, putSlice]);

    // The slice turned off or turned away from the set's planes: back to 3D. Moved along: the nearest plane is the one shown
    useEffect(() => {
        if (!set) return;
        const check = () => {
            const now = liveClip.get();
            const active = now.slices[now.active];
            if (!now.slicing || !active || !sameNormal(active.normal, set.normal)) { setSaved(null); return; }
            const i = sectionIndexAt(set, active.center);
            setIndex(was => (was === i ? was : i));
        };
        check();
        return liveClip.subscribe(check);
    }, [set, liveClip, setSaved]);
    useEffect(() => { if (set && index !== null && saved && saved.index !== index) setSaved({ set: set.id, index }); }, [set, index, saved, setSaved]);

    // As many grid lines as there is room for labels: one every 90 pixels or so, worked out again as the view zooms
    const [ticks, setTicks] = useState(6);
    useEffect(() => {
        if (!viewport || !set || !geometry) return;
        const b = geometry.bounds;
        const extent = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
        const read = () => {
            const n = Math.max(2, Math.min(10, Math.floor((extent * viewport.pixelsPerMetre(viewport.viewFocus())) / 90)));
            if (Number.isFinite(n)) setTicks(t => (t === n ? t : n));
        };
        read();
        return viewport.addCameraListener(read);
    }, [viewport, set, geometry]);

    // Turning stops; the grid is drawn on the plane, in place of the box's own labels
    useEffect(() => {
        if (!viewport) return;
        viewport.setRotatable(!set);
        viewport.setAxesVisible(!set);
        if (!set || index === null || !geometry) { viewport.setPlaneGrid(null); return; }
        const grid = sectionGrid(set, index, geometry.bounds, geometry.origin, ticks);
        viewport.setPlaneGrid(grid ? { ...grid, color: gridColor } : null);
    }, [viewport, set, index, geometry, gridColor, ticks]);
    useEffect(() => () => { viewport?.setRotatable(true); viewport?.setAxesVisible(true); viewport?.setPlaneGrid(null); }, [viewport]);

    // Where this view's section is, for the others
    const show = useOpenSections(s => s.show);
    useEffect(() => { show(plotId, set && index !== null ? { set: set.id, index } : null); }, [plotId, set, index, show]);
    useEffect(() => () => show(plotId, null), [plotId, show]);

    // [ and ] (and , .) step to the next plane: taken before the slice's own keys, which step by adding
    const stepRef = useRef(step);
    stepRef.current = step;
    const inView = !!set;
    useEffect(() => {
        const el = containerRef.current;
        if (!el || !inView) return;
        const onKey = (e: KeyboardEvent) => {
            if ((e.target as HTMLElement).closest?.('input, textarea') || e.altKey || e.ctrlKey || e.metaKey) return;
            const n = e.key === ']' || e.key === '.' ? 1 : e.key === '[' || e.key === ',' ? -1 : 0;
            if (!n) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            stepRef.current(n);
        };
        el.addEventListener('keydown', onKey, true);
        return () => el.removeEventListener('keydown', onKey, true);
    }, [containerRef, inView]);

    // Other views' sections, as frames on their planes
    const open = useOpenSections(s => s.byPlot);
    const otherFrames = useMemo<SliceFrame[]>(() => {
        if (!geometry) return [];
        const out: SliceFrame[] = [];
        const o = geometry.origin;
        // A little outside the data, as the slices' own frames are drawn
        const { min, max } = geometry.bounds;
        const pad = 0.03 * Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1);
        const box = { min: [0, 1, 2].map(k => min[k] - pad), max: [0, 1, 2].map(k => max[k] + pad) };
        for (const [id, at] of Object.entries(open)) {
            if (id === plotId) continue;
            const s = (sets ?? []).find(x => x.id === at.set);
            if (!s) continue;
            const { normal, point } = sectionPlane(s, at.index);
            const corners = planeBoxPolygon(normal, [point[0] - o[0], point[1] - o[1], point[2] - o[2]] as Vec3, box);
            if (corners.length >= 9) out.push({ corners, color: OTHER_SECTION_COLOR });
        }
        return out;
    }, [open, plotId, sets, geometry]);

    /** A new set (from the active slice: its plane, spacing its step) and a look at it; false when there is nothing to make it from */
    const create = useCallback((from: 'slice' | PresetKind): boolean => {
        if (!geometry) return false;
        const o = geometry.origin, b = geometry.bounds;
        let made: ReturnType<typeof makeSectionSet>;
        if (from === 'slice') {
            const now = liveClip.get();
            const active = now.slicing ? now.slices[now.active] : undefined;
            if (!active) return false;
            made = makeSectionSet(active.normal, active.center, sliceStep(active), active.width);
        } else {
            const spacing = defaultSliceWidth(Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]));
            made = makeSectionSet(PRESET_NORMALS[from], [0, 1, 2].map(k => (b.min[k] + b.max[k]) / 2 + o[k]), spacing, spacing);
        }
        const id = made ? useModelStore.getState().addSectionSet(made) : null;
        if (!id) return false;
        enter(id);
        return true;
    }, [geometry, liveClip, enter]);

    const view: SectionViewState | null = set && index !== null ? { set, index, label: sectionLabel(set, index), range: rangeOf(set) } : null;
    return { view, enter, exit, step, create, otherFrames };
}
