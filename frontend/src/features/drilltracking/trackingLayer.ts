/**
 * Drill tracking in a 3D view (three.js), drawn with the planner's
 * helpers (wide lines, dots and rings; viewer-local coordinates, scaled with
 * the vertical exaggeration):
 *
 * - planned programs: each hole as last worked out, in its program's colour,
 *   collar dot, target ring and end dot, named at the collar. The program the
 *   planner has open is drawn by the planner instead.
 * - drilled holes being drilled: the path to the last survey (dark), below it
 *   to the current depth (grey), a dot at the bottom named with the hole and
 *   its depth, and the three projections from the last survey (holding the
 *   last survey, recent lift and drift, lift and drift given).
 *
 * All of it is cut by the clip box and the slices like the data: the lines
 * and dots by the clipping planes, a name shown while any of its hole is
 * inside. The view's `sliceSamples` setting (Drill tracking page) says
 * whether the slices also cut the samples, or only the drilling.
 *
 * Each is shown or hidden by the view's eyes (the program's, Planned holes,
 * Drilled holes).
 */
import { RefObject, useEffect } from 'react';
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { plotById, useAppStore } from '../../store/appStore';
import { useDrillTrackingStore } from '../../store/drillTrackingStore';
import type { Trace } from '../../utils/drillholePlan';
import { project, type ProjectionKind } from '../../utils/drillTrackProjection';
import { solvedTrace } from '../../utils/plannedPrograms';
import { keys } from '../model/objectKeys';
import { isInsideClip } from '../plots/viewer3d/geometry';
import { disposePlannerLayer, label, markers, wideLine } from '../plots/viewer3d/planner/plannerLayer';
import type { SliceLink } from '../plots/viewer3d/planner/planSlice';
import { clipStateOf } from '../plots/viewer3d/slices';
import type { ThreeViewport } from '../plots/viewer3d/ThreeViewport';
import { programHidden } from './trackingVisibility';
import { useTracking } from './useTracking';

const LAYER_ID = 'drill-tracking';
export const DRILLED_COLOR = '#212121';
export const OFF_TRACK_COLOR = '#d32f2f';
/** Drilled below the last survey (to the collar file's current depth), taken as straight */
export const UNSURVEYED_COLOR = '#9e9e9e';
const NO_TURN = { lift: 0, drift: 0 };
export const PROJECTION_COLORS: Record<ProjectionKind, string> = { hold: '#757575', recent: '#ef6c00', custom: '#1565c0', required: '#8e24aa' };

/** The view setting: do the slices cut the samples too (true, the default), or only the drilling */
export const SLICE_SAMPLES_SETTING = 'sliceSamples';

function linePoints(t: Trace, origin: ArrayLike<number>, from = 0): number[] {
    const pts: number[] = [];
    for (let i = 0; i < t.depth.length; i++) {
        if (t.depth[i] < from - 1e-6) continue;
        pts.push(t.xyz[i * 3] - origin[0], t.xyz[i * 3 + 1] - origin[1], t.xyz[i * 3 + 2] - origin[2]);
    }
    return pts;
}

/** A line cut by the clip box and the slices */
function addLine(group: THREE.Group, pts: number[], color: string, width: number) {
    if (pts.length >= 6) group.add(wideLine(pts, color, width));
}

/** Dots cut by the clip box and the slices */
function addDots(group: THREE.Group, at: number[], color: string, size: number, kind: 'dot' | 'ring' = 'dot') {
    const m = markers(at, color, size, kind);
    (m.material as THREE.Material).userData.clipWithSlices = true;
    group.add(m);
}

/** A name, shown while any of these places (local xyz triples) is inside the clip */
function addLabel(group: THREE.Group, text: string, at: number[], color: string, places: number[]) {
    const o = label(text, at, color);
    o.userData.places = places;
    group.add(o);
}

export function useDrillTrackingLayer(
    viewportRef: RefObject<ThreeViewport | null>, ready: boolean, origin: [number, number, number] | null, hidden: ReadonlySet<string>,
    plotId: string, link: SliceLink,
) {
    const programs = useDrillTrackingStore(s => s.programs);
    const editingId = useDrillTrackingStore(s => s.editingId);
    const tracking = useTracking();
    const sliceSamples = useAppStore(s => plotById(s, plotId)?.settings?.[SLICE_SAMPLES_SETTING] !== false);

    useEffect(() => {
        const vp = viewportRef.current;
        if (ready && vp) vp.setSliceSamples(sliceSamples);
    }, [viewportRef, ready, sliceSamples]);

    useEffect(() => {
        const vp = viewportRef.current;
        if (!ready || !vp || !origin) return;
        const group = new THREE.Group();
        group.name = LAYER_ID;
        const local = (p: ArrayLike<number>) => [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
        for (const program of programs) {
            if (program.id === editingId || programHidden(hidden, program.id)) continue;
            for (const h of program.holes) {
                const s = h.solved;
                if (!h.visible || !s || s.depth.length < 2) continue;
                const t = solvedTrace(s);
                // A wedge from its kick-off (its parent draws the hole above it)
                const pts = linePoints(t, origin, s.kop ?? 0);
                addLine(group, pts, program.color, h.style.width);
                addDots(group, local(s.xyz.slice(s.xyz.length - 3)), program.color, 7);
                if (s.kop === null || s.kop === undefined) {
                    const c = local(s.xyz.slice(0, 3));
                    addDots(group, c, program.color, 10);
                    addLabel(group, h.input.name, c, program.color, pts);
                }
                if (s.target) addDots(group, local(s.target), program.color, 16, 'ring');
            }
        }
        if (!hidden.has(keys.liveDrilling)) {
            for (const r of tracking.reports) {
                if (!r.drilled || !r.last) continue;
                const drilledPts = linePoints(r.drilled, origin);
                addLine(group, drilledPts, DRILLED_COLOR, 4);
                for (const p of r.projections) addLine(group, linePoints(p.path, origin), PROJECTION_COLORS[p.kind], 2);
                // Drilled below its last survey (the collar file's current depth): straight on, in grey, to the bottom of the hole
                const below = r.depth.current !== null && r.depth.current > r.last.depth + 0.01 ? project(r.drilled, r.last.depth, NO_TURN, r.depth.current) : null;
                const belowPts = below ? linePoints(below, origin) : [];
                addLine(group, belowPts, UNSURVEYED_COLOR, 4);
                const bottom = below ?? r.drilled;
                const i = bottom.depth.length - 1;
                const at = local([bottom.xyz[i * 3], bottom.xyz[i * 3 + 1], bottom.xyz[i * 3 + 2]]);
                // A hole on track to miss its target by more than the limit: named in red, with the miss
                const off = r.forecast?.flagged;
                const depthText = below ? `${Math.round(r.depth.current!)} m (surveyed to ${Math.round(r.last.depth)})` : `${Math.round(r.last.depth)} m`;
                addDots(group, at, off ? OFF_TRACK_COLOR : DRILLED_COLOR, 11);
                addLabel(group, `${r.hole} ${depthText}${off ? ` ⚠ ${r.forecast!.distance.toFixed(1)} m off target` : ''}`, at,
                    off ? OFF_TRACK_COLOR : DRILLED_COLOR, [...drilledPts, ...belowPts]);
            }
        }
        if (group.children.length === 0) { vp.setLayer(LAYER_ID, null); return; }
        // Names follow the clip as it moves (straight from the slice bar, not through React)
        const labels = group.children.filter((o): o is CSS2DObject => o instanceof CSS2DObject && Array.isArray(o.userData.places));
        const follow = () => {
            const clip = clipStateOf(link.clip.get(), origin);
            for (const o of labels) {
                const p = o.userData.places as number[];
                let inside = false;
                for (let k = 0; k + 2 < p.length && !inside; k += 3) inside = isInsideClip(p[k], p[k + 1], p[k + 2], clip);
                o.visible = inside;
                o.element.style.display = inside ? '' : 'none';
            }
            vp.requestRender();
        };
        follow();
        const off = link.clip.subscribe(follow);
        vp.setLayer(LAYER_ID, group);
        return () => { off(); vp.setLayer(LAYER_ID, null); disposePlannerLayer(group); };
    }, [viewportRef, ready, origin, programs, editingId, tracking, hidden, link]);
}
