/**
 * Setting the model's structure by hand in the 3D view, while a structure
 * tool is taken up (modelStore.structureTool):
 *
 *  - `place`: a click on a drillhole (snapped to the sample under the
 *    cursor) or, with a slice on, on the slice puts a reading with the typed
 *    angles there;
 *  - `stroke`: with a slice on, a drag along the structure on the slice
 *    gives a reading at the middle of the stroke (a plane taken as passing
 *    straight through the slice, or a line), or the model's one direction;
 *  - a right-click on a reading set by hand removes it;
 *  - Esc puts the tool down.
 *
 * The camera keeps working: only the left button of a stroke is taken from
 * it. The pointer work is done outside React (native listeners, a label
 * and a line drawn over the view), so moving the mouse re-renders nothing.
 */
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useModelStore } from '../../../store/modelStore';
import { keys } from '../../model/objectKeys';
import { unit } from '../../model/plane';
import { addHandReading } from '../../model/sceneActions';
import { DEFAULT_LINE_STRENGTH, DEFAULT_STRENGTH } from '../../model/structure';
import { anglesText, lineFromStroke, planeFromStroke, type Angles } from '../../model/structureReadings';
import type { ReadingSet, SceneCoords, StructureReading, StructureTool, Vec3 } from '../../model/types';
import { pickHandle } from './picking';
import { describePlacement, placeOnPlane, resolvePlacement, type PlacementView } from './viewPlacement';

export interface StructureToolOptions extends Omit<PlacementView, 'viewport'> {
    containerRef: RefObject<HTMLElement>;
    viewportRef: RefObject<PlacementView['viewport']>;
    ready: boolean;
    /** The view can take readings: it shows the scene's coordinate columns (or the scene has none yet) and is free for clicks */
    active: boolean;
    /** Whether a place (local coordinates) is inside the slices and the clip box now */
    visibleAt: () => (x: number, y: number, z: number) => boolean;
    /** The objects the view hides (keys): readings of a hidden set are not picked up */
    hidden: ReadonlySet<string>;
    /** The view's coordinate columns: a first reading makes them the scene's */
    coords: () => SceneCoords | null;
}

/** A stroke shorter than this on screen is not one */
const MIN_STROKE_PX = 12;

const one = (kind: ReadingSet['kind']) => (kind === 'plane' ? 'plane' : 'line');
const sentence = (text: string) => text.replace(/^./, c => c.toUpperCase());

/** What a stroke gives, by what it is for: null when it has no length or runs straight through the slice */
export function strokeAngles(target: StructureTool & { mode: 'stroke' }, from: Vec3, to: Vec3, sliceNormal: Vec3): Angles | null {
    return target.target === 'line' ? lineFromStroke(from, to) : planeFromStroke(from, to, sliceNormal);
}

export function useStructureTool(o: StructureToolOptions): boolean {
    const tool = useModelStore(s => s.structureTool);
    const on = o.active && !!tool && !!o.geometry && o.ready;
    // The handlers outlive a render: they read today's values here
    const live = useRef({ ...o, tool });
    live.current = { ...o, tool };

    useEffect(() => {
        const el = o.containerRef.current;
        if (!on || !el) return;
        const vp = () => live.current.viewportRef.current;
        const view = (): PlacementView => ({ ...live.current, viewport: vp() });
        const model = () => useModelStore.getState();
        const cursorOf = (e: MouseEvent): [number, number] => {
            const r = (el.querySelector('canvas') ?? el).getBoundingClientRect();
            return [e.clientX - r.left, e.clientY - r.top];
        };
        const worldOf = (local: ArrayLike<number>): Vec3 => {
            const g = live.current.geometry!.origin;
            return [local[0] + g[0], local[1] + g[1], local[2] + g[2]];
        };

        // A label that follows the cursor, and the stroke as it is drawn
        const label = document.createElement('div');
        label.dataset.testid = 'structure-tool-label';
        Object.assign(label.style, {
            position: 'absolute', display: 'none', pointerEvents: 'none', zIndex: '3', whiteSpace: 'nowrap',
            font: '500 12px Inter, system-ui, sans-serif', color: '#fff', background: 'rgba(33, 33, 33, 0.88)',
            padding: '2px 7px', borderRadius: '4px',
        });
        el.appendChild(label);
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        Object.assign(svg.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '2', display: 'none' });
        const drawn = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        drawn.setAttribute('stroke', '#ff6f00');
        drawn.setAttribute('stroke-width', '3');
        drawn.setAttribute('stroke-linecap', 'round');
        svg.appendChild(drawn);
        el.appendChild(svg);
        const say = (text: string | null, x = 0, y = 0) => {
            if (text === null) { label.style.display = 'none'; return; }
            label.textContent = text;
            label.style.display = 'block';
            label.style.left = `${Math.min(x + 16, el.clientWidth - label.offsetWidth - 4)}px`;
            label.style.top = `${Math.min(y + 14, el.clientHeight - label.offsetHeight - 4)}px`;
        };
        const baseCursor = el.style.cursor;
        el.style.cursor = 'crosshair';

        /** The slice now, with a unit normal (null: none) */
        const slice = () => {
            const plane = live.current.slicePlane();
            const normal = plane && unit(plane.normal);
            return plane && normal ? { normal, point: plane.point } : null;
        };
        /** Within reach of the data: a line of sight that only grazes the slice meets it far away, which is nowhere to draw */
        const nearData = (p: ArrayLike<number>): boolean => {
            const b = live.current.geometry?.bounds;
            if (!b) return false;
            const pad = 0.5 * Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2], 1);
            for (let k = 0; k < 3; k++) if (!(p[k] >= b.min[k] - pad && p[k] <= b.max[k] + pad)) return false;
            return true;
        };
        /** Where the cursor is on the slice (null: no slice, or it is not over it) */
        const onSlice = (x: number, y: number, plane = slice()): Vec3 | null => {
            const hit = plane ? placeOnPlane(view(), x, y, plane) : null;
            return hit && nearData(hit) ? hit : null;
        };
        /** The reading set by hand under the cursor (null: none) */
        const handAt = (x: number, y: number): { set: ReadingSet; reading: StructureReading } | null => {
            const g = live.current.geometry, v = vp();
            const sets = (model().scene.structure?.sets ?? []).filter(s => s.source === 'hand' && !live.current.hidden.has(keys.readings(s.id)));
            const all = sets.flatMap(set => set.readings.map(reading => ({ set, reading })));
            if (!g || !v || all.length === 0) return null;
            const local = new Float32Array(all.length * 3);
            all.forEach(({ reading }, i) => { for (let k = 0; k < 3; k++) local[i * 3 + k] = reading.p[k] - g.origin[k]; });
            const xy = Float32Array.from(v.projectPoints(local));
            const seen = live.current.visibleAt();
            for (let i = 0; i < all.length; i++) if (!seen(local[i * 3], local[i * 3 + 1], local[i * 3 + 2])) xy[i * 2] = xy[i * 2 + 1] = NaN;
            const hit = pickHandle(xy, [x, y]);
            return hit >= 0 ? all[hit] : null;
        };

        let down: { x: number; y: number } | null = null;
        let stroke: { pointer: number; x0: number; y0: number; cx: number; cy: number; first: Vec3; normal: Vec3; point: Vec3; moved: boolean } | null = null;
        let removing: { set: string; reading: string } | null = null;
        let blockMenu = false;

        const hover = (x: number, y: number) => {
            const t = live.current.tool;
            if (!t) return;
            const hand = handAt(x, y);
            if (hand) { say(`${sentence(anglesText(hand.set.kind, hand.reading))} · right-click to remove`, x, y); return; }
            if (t.mode === 'place') {
                const p = resolvePlacement(view(), x, y, true);
                say(p ? `${describePlacement(view(), p)} · click to put the ${one(t.kind)} here` : `Click on a drillhole${slice() ? ' or on the slice' : ''}`, x, y);
            } else {
                say(!slice() ? 'Turn on a slice to draw on' : onSlice(x, y) ? `Drag along the ${t.target === 'line' ? 'line' : 'structure'} on the slice` : 'Point at the slice to draw on it', x, y);
            }
        };
        const strokeEnd = (x: number, y: number): Vec3 | null => (stroke ? onSlice(x, y, { normal: stroke.normal, point: stroke.point }) : null);
        /** What the stroke gives as it stands (null: too short, or nothing) */
        const strokeNow = (x: number, y: number, e: PointerEvent): { angles: Angles; mid: Vec3 } | null => {
            const t = live.current.tool;
            const to = strokeEnd(x, y);
            if (!stroke || !to || !t || t.mode !== 'stroke' || Math.hypot(e.clientX - stroke.x0, e.clientY - stroke.y0) < MIN_STROKE_PX) return null;
            const from = worldOf(stroke.first), end = worldOf(to);
            const angles = strokeAngles(t, from, end, stroke.normal);
            return angles ? { angles, mid: [(from[0] + end[0]) / 2, (from[1] + end[1]) / 2, (from[2] + end[2]) / 2] } : null;
        };

        const onPointerDown = (e: PointerEvent) => {
            if (!(e.target instanceof HTMLCanvasElement) || !e.isPrimary) return;
            const [x, y] = cursorOf(e);
            const t = live.current.tool;
            if (e.button === 2) {
                const hand = handAt(x, y);
                if (hand) {
                    e.preventDefault();
                    e.stopPropagation();
                    removing = { set: hand.set.id, reading: hand.reading.id };
                    blockMenu = true;
                }
                return;
            }
            if (e.button !== 0 || !t) return;
            if (t.mode === 'place') { down = { x: e.clientX, y: e.clientY }; return; }
            // Off the slice the drag is the camera's
            const plane = slice();
            const first = onSlice(x, y, plane);
            if (!plane || !first) return;
            // Ours: the camera does not turn while a stroke is drawn
            e.preventDefault();
            e.stopPropagation();
            el.focus({ preventScroll: true });
            el.setPointerCapture(e.pointerId);
            stroke = { pointer: e.pointerId, x0: e.clientX, y0: e.clientY, cx: x, cy: y, first, normal: plane.normal, point: plane.point, moved: false };
        };
        const onPointerMove = (e: PointerEvent) => {
            const [x, y] = cursorOf(e);
            if (stroke) {
                if (e.pointerId !== stroke.pointer) return;
                e.stopPropagation();
                stroke.moved = true;
                svg.style.display = 'block';
                drawn.setAttribute('x1', String(stroke.cx));
                drawn.setAttribute('y1', String(stroke.cy));
                drawn.setAttribute('x2', String(x));
                drawn.setAttribute('y2', String(y));
                const now = strokeNow(x, y, e);
                const t = live.current.tool;
                say(now && t?.mode === 'stroke' ? sentence(anglesText(t.target === 'line' ? 'line' : 'plane', now.angles)) : 'Drag further', x, y);
            } else if (e.buttons === 0 && e.target instanceof HTMLCanvasElement) {
                hover(x, y);
            } else if (e.buttons === 0) {
                say(null);
            }
        };
        const onPointerUp = (e: PointerEvent) => {
            const [x, y] = cursorOf(e);
            const t = live.current.tool;
            const coords = live.current.coords();
            if (stroke) {
                if (e.pointerId !== stroke.pointer) return;
                e.stopPropagation();
                const now = e.type === 'pointerup' ? strokeNow(x, y, e) : null;
                if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
                stroke = null;
                svg.style.display = 'none';
                if (now && t?.mode === 'stroke') {
                    if (t.target === 'overall') {
                        const had = model().scene.structure?.overall ?? null;
                        const round = (v: number) => Number(v.toFixed(1));
                        model().setStructure({
                            dip: round(now.angles.dip), dipDirection: round(now.angles.direction), lineTrend: had?.lineTrend ?? null,
                            strength: had?.strength ?? DEFAULT_STRENGTH, lineStrength: had?.lineStrength ?? DEFAULT_LINE_STRENGTH,
                        });
                        // One stroke sets it: the tool is put down
                        model().setStructureTool(null);
                        return;
                    }
                    // To a tenth of a degree: a hand is no steadier
                    if (coords) addHandReading(coords, t.target, { p: now.mid, dip: Number(now.angles.dip.toFixed(1)), direction: Number(now.angles.direction.toFixed(1)) });
                }
                hover(x, y);
                return;
            }
            if (removing !== null && e.button === 2) {
                e.stopPropagation();
                model().removeReading(removing.set, removing.reading);
                removing = null;
                say(null);
                return;
            }
            const start = down;
            down = null;
            if (!start || e.button !== 0 || !(e.target instanceof HTMLCanvasElement) || !t || t.mode !== 'place' || !coords) return;
            if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4 || e.shiftKey || e.ctrlKey || e.metaKey) return;
            const p = resolvePlacement(view(), x, y, true);
            if (p) addHandReading(coords, t.kind, { p: worldOf(p.local), dip: t.dip, direction: t.direction });
            hover(x, y);
        };
        const onContextMenu = (e: MouseEvent) => {
            if (!blockMenu) return;
            blockMenu = false;
            e.preventDefault();
            e.stopPropagation();
        };
        const onLeave = () => { if (!stroke) say(null); };
        const onDocumentKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape' || e.defaultPrevented) return;
            const target = e.target as HTMLElement | null;
            // Esc in a dialog or a menu is theirs
            if (target?.closest?.('[role="dialog"], [role="menu"], [role="listbox"]')) return;
            if (stroke) {
                if (el.hasPointerCapture(stroke.pointer)) el.releasePointerCapture(stroke.pointer);
                stroke = null;
                svg.style.display = 'none';
                say(null);
                return;
            }
            model().setStructureTool(null);
        };

        el.addEventListener('pointerdown', onPointerDown, { capture: true });
        el.addEventListener('pointermove', onPointerMove, { capture: true });
        el.addEventListener('pointerup', onPointerUp, { capture: true });
        el.addEventListener('pointercancel', onPointerUp, { capture: true });
        el.addEventListener('contextmenu', onContextMenu, { capture: true });
        el.addEventListener('pointerleave', onLeave);
        document.addEventListener('keydown', onDocumentKey, { capture: true });
        return () => {
            el.removeEventListener('pointerdown', onPointerDown, { capture: true });
            el.removeEventListener('pointermove', onPointerMove, { capture: true });
            el.removeEventListener('pointerup', onPointerUp, { capture: true });
            el.removeEventListener('pointercancel', onPointerUp, { capture: true });
            el.removeEventListener('contextmenu', onContextMenu, { capture: true });
            el.removeEventListener('pointerleave', onLeave);
            document.removeEventListener('keydown', onDocumentKey, { capture: true });
            label.remove();
            svg.remove();
            el.style.cursor = baseCursor;
        };
        // The handlers read today's options through `live`
    }, [on, o.containerRef]);

    return on;
}
