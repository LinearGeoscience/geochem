/**
 * The drillhole planner's layer in the 3D view (three.js): planned traces as
 * solid wide lines (Line2: plain lines ignore width on Windows), cut by the
 * slices like everything else; collar dots, target rings and end-of-hole
 * dots that always show (a target off the active slice is drawn faded); the
 * selected hole drawn wider; optional depth ticks. Drawn in the viewer's
 * local coordinates (world − data centre); the viewport scales the layer
 * with the vertical exaggeration.
 */
import { RefObject, useEffect } from 'react';
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { stationAt } from '../../../../utils/drillholePlan';
import { offSlice } from '../../../../utils/drillholePlanSlice';
import type { ThreeViewport } from '../ThreeViewport';
import { roleSetsOf, type Planner } from './usePlans';
import { keys as objectKeys } from '../../../model/objectKeys';
import { activeSlice, OFF_SLICE, slicePlane, SliceLink } from './planSlice';
import { usePlanStore } from './planStore';
import { useModelStore } from '../../../../store/modelStore';

export const PLAN_ERROR_COLOR = '#d32f2f';
const LAYER_ID = 'drillhole-planner';
const POINTS_LAYER_ID = 'point-sets';
/** A target off the active slice */
const FADED = 0.35;

const sprites = new Map<string, THREE.Texture>();
/** Round point sprites: a dot with a dark rim, or a ring */
function sprite(kind: 'dot' | 'ring' | 'cross'): THREE.Texture {
    let t = sprites.get(kind);
    if (t) return t;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.beginPath();
    if (kind === 'cross') {
        // A cross, dark-edged so it shows on any background
        for (const [w, colour] of [[14, 'rgba(0,0,0,0.65)'], [7, '#ffffff']] as const) {
            g.beginPath();
            g.moveTo(8, 32); g.lineTo(56, 32); g.moveTo(32, 8); g.lineTo(32, 56);
            g.lineWidth = w; g.lineCap = 'round'; g.strokeStyle = colour; g.stroke();
        }
    } else g.arc(32, 32, kind === 'ring' ? 24 : 28, 0, Math.PI * 2);
    if (kind === 'cross') {
        // (drawn above)
    } else if (kind === 'dot') {
        g.fillStyle = '#ffffff';
        g.fill();
        g.lineWidth = 6;
        g.strokeStyle = 'rgba(0,0,0,0.65)';
        g.stroke();
    } else {
        g.lineWidth = 12;
        g.strokeStyle = '#ffffff';
        g.stroke();
        g.beginPath();
        g.arc(32, 32, 5, 0, Math.PI * 2);
        g.fillStyle = '#ffffff';
        g.fill();
    }
    t = new THREE.CanvasTexture(c);
    sprites.set(kind, t);
    return t;
}

function markers(positions: number[], color: string, size: number, kind: 'dot' | 'ring' = 'dot'): THREE.Points {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const pts = new THREE.Points(geom, new THREE.PointsMaterial({
        color, size, sizeAttenuation: false, map: sprite(kind), transparent: true, alphaTest: 0.2, depthTest: false, depthWrite: false,
    }));
    pts.renderOrder = 12;
    pts.frustumCulled = false;
    return pts;
}

function label(text: string, at: ArrayLike<number>, color: string, small = false, selected = false): CSS2DObject {
    const el = document.createElement('div');
    el.textContent = text;
    el.dataset.planLabel = small ? 'tick' : 'hole';
    Object.assign(el.style, small
        ? { font: '10px Inter, system-ui, sans-serif', color, whiteSpace: 'nowrap', marginLeft: '18px', textShadow: '0 0 2px #fff, 0 0 2px #fff' }
        : selected
            ? { font: "700 12px Inter, system-ui, sans-serif", whiteSpace: "nowrap", color: "#fff", background: color, padding: "2px 8px", borderRadius: "10px", marginTop: "-18px", border: "2px solid #fff", boxShadow: `0 0 0 2px ${color}, 0 1px 4px rgba(0,0,0,0.4)` }
            : { font: "600 10px Inter, system-ui, sans-serif", whiteSpace: "nowrap", color: "#fff", background: color, padding: "0 5px", borderRadius: "8px", marginTop: "-14px", opacity: "0.85" });
    if (selected) el.dataset.planLabel = "selected";
    const o = new CSS2DObject(el);
    o.position.set(at[0], at[1], at[2]);
    return o;
}

/** How strongly a planned hole shows off the slices (the part on them is solid) */
export const OFF_SLICE_OPACITY = 0.5;

/** A hole's line: solid, cut by the slices; or (`ghost`) the whole line faded, cut by the clip box only */
function wideLine(points: number[], color: string, width: number, ghost = false): Line2 {
    const geom = new LineGeometry();
    geom.setPositions(points);
    const mat = ghost
        ? new LineMaterial({ color, linewidth: width, transparent: true, opacity: OFF_SLICE_OPACITY, depthWrite: false })
        : new LineMaterial({ color, linewidth: width });
    if (ghost) mat.userData.clipWithBox = true;
    else mat.userData.clipWithSlices = true;
    const line = new Line2(geom, mat);
    line.frustumCulled = false;
    return line;
}

export interface LayerOptions {
    planner: Planner;
    selectedId: string | null;
    /** The data centre: world = local + origin */
    origin: ArrayLike<number>;
    depthTicks: boolean;
    tickInterval: number;
    /** Name every hole (else only the selected one) */
    labelAll: boolean;
}

/** The planner's objects for the 3D view. Target markers carry their world place (userData.planTarget). */
export function buildPlannerLayer(o: LayerOptions): THREE.Group {
    const group = new THREE.Group();
    group.name = 'drillhole-planner';
    const [ox, oy, oz] = [o.origin[0], o.origin[1], o.origin[2]];
    const local = (p: ArrayLike<number>) => [p[0] - ox, p[1] - oy, p[2] - oz];
    for (const { hole, result } of o.planner.holes) {
        if (!hole.visible) continue;
        const selected = hole.id === o.selectedId;
        const color = result.ok ? hole.style.color : PLAN_ERROR_COLOR;
        const t = result.trace;
        // A wedge is drawn from its kick-off (the parent draws the hole above it)
        const from = result.wedge ? result.wedge.kop : 0;
        if (t && t.depth.length >= 2) {
            const pts: number[] = [];
            for (let i = 0; i < t.depth.length; i++) if (t.depth[i] >= from - 1e-6) pts.push(t.xyz[i * 3] - ox, t.xyz[i * 3 + 1] - oy, t.xyz[i * 3 + 2] - oz);
            if (pts.length >= 6) {
                // Solid on the slices, faded off them (one faded copy of the whole hole under the solid one)
                group.add(wideLine(pts, color, hole.style.width + (selected ? 2 : 0), true));
                group.add(wideLine(pts, color, hole.style.width + (selected ? 2 : 0)));
            }
            // End of hole
            group.add(markers(pts.slice(-3), color, 7));
            if (result.wedge) {
                // The kick-off on the parent
                const k = local(result.wedge.kopPoint);
                group.add(markers(k, color, selected ? 13 : 10));
                if (selected || o.labelAll) group.add(label(`${hole.input.name} @ ${Math.round(result.wedge.kop)} m`, k, color, false, selected));
            }
            if (o.depthTicks && o.tickInterval > 0) {
                const ticks: number[] = [];
                const end = t.depth[t.depth.length - 1];
                for (let d = Math.ceil((from + 1e-6) / o.tickInterval) * o.tickInterval; d < end - 1e-6; d += o.tickInterval) {
                    const s = stationAt(t, d);
                    if (!s) continue;
                    const p = local(s.p);
                    ticks.push(...p);
                    group.add(label(String(Math.round(d)), p, color, true));
                }
                if (ticks.length) group.add(markers(ticks, color, 5));
            }
        }
        if (result.collar && !result.wedge) {
            const c = local(result.collar);
            group.add(markers(c, color, selected ? 13 : 10));
            if (selected || o.labelAll) group.add(label(hole.input.name, c, color, false, selected));
        }
        if (result.target) {
            const p = local(result.target);
            const m = markers(p, color, selected ? 22 : 16, 'ring');
            m.userData.planTarget = result.target;
            group.add(m);
            if ((!result.collar || (result.wedge && !result.trace)) && (selected || o.labelAll)) group.add(label(hole.input.name, p, color, false, selected));
        }
    }
    return group;
}

/** Free a layer's GPU objects and its labels. */
export function disposePlannerLayer(group: THREE.Group) {
    group.traverse(obj => {
        if (obj instanceof CSS2DObject) obj.element.remove();
        const m = obj as THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material };
        m.geometry?.dispose();
        m.material?.dispose();
    });
}

/** Keep the planner's layer in a 3D view in step with the plan store (and targets faded off the slice). */
export function usePlannerLayer(
    viewportRef: RefObject<ThreeViewport | null>, ready: boolean, origin: [number, number, number] | null,
    planner: Planner, link: SliceLink,
) {
    const selectedId = usePlanStore(s => s.selectedId);
    const depthTicks = usePlanStore(s => s.settings.depthTicks);
    const labelAll = usePlanStore(s => s.settings.labelAll);
    const tickInterval = usePlanStore(s => s.settings.tickInterval);
    useEffect(() => {
        const vp = viewportRef.current;
        if (!ready || !vp || !origin) return;
        if (planner.holes.length === 0) {
            vp.setLayer(LAYER_ID, null);
            return;
        }
        const group = buildPlannerLayer({ planner, selectedId, origin, depthTicks, tickInterval, labelAll });
        // Targets off the active slice are faded: followed straight from the slice, not through React
        const fade = () => {
            const slice = activeSlice(link.clip.get());
            group.traverse(obj => {
                const at = obj.userData.planTarget as number[] | undefined;
                if (!at) return;
                const off = slice ? Math.abs(offSlice(at, slicePlane(slice))) > Math.max(OFF_SLICE, slice.width / 2) : false;
                ((obj as THREE.Points).material as THREE.PointsMaterial).opacity = off ? FADED : 1;
            });
            vp.requestRender();
        };
        fade();
        const off = link.clip.subscribe(fade);
        vp.setLayer(LAYER_ID, group);
        return () => {
            off();
            vp.setLayer(LAYER_ID, null);
            disposePlannerLayer(group);
        };
    }, [viewportRef, ready, origin, planner.holes, selectedId, depthTicks, tickInterval, labelAll, link]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * The scene's sets of points with a role (drill pads, target points) in a 3D
 * view: dots or crosses (the set's `mark`) a size on the screen, cut by the
 * clip box and slices like the data, so planning on a slice shows those near
 * it. Shown or hidden as the view's eyes say (`hidden`: the keys the view hides).
 */
export function usePointSetLayer(viewportRef: RefObject<ThreeViewport | null>, ready: boolean, origin: [number, number, number] | null, hidden: ReadonlySet<string>) {
    const inputs = useModelStore(s => s.scene.inputs);
    useEffect(() => {
        const vp = viewportRef.current;
        if (!ready || !vp || !origin) return;
        const shown = roleSetsOf(inputs).filter(p => p.visible && !hidden.has(objectKeys.inputs(p.id)) && p.points.length > 0);
        if (shown.length === 0) { vp.setLayer(POINTS_LAYER_ID, null); return; }
        const group = new THREE.Group();
        for (const set of shown) {
            const pos: number[] = [];
            for (const q of set.points) pos.push(q.p[0] - origin[0], q.p[1] - origin[1], q.p[2] - origin[2]);
            const geom = new THREE.BufferGeometry();
            geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            const cross = set.mark === 'cross';
            const mat = new THREE.PointsMaterial({ color: set.color, size: cross ? 13 : 9, sizeAttenuation: false, map: sprite(cross ? 'cross' : 'dot'), transparent: true, alphaTest: 0.2 });
            mat.userData.clipWithSlices = true;
            const pts = new THREE.Points(geom, mat);
            pts.frustumCulled = false;
            pts.renderOrder = 5;
            group.add(pts);
        }
        vp.setLayer(POINTS_LAYER_ID, group);
        return () => { vp.setLayer(POINTS_LAYER_ID, null); disposePlannerLayer(group); };
    }, [viewportRef, ready, origin, inputs, hidden]);
}
