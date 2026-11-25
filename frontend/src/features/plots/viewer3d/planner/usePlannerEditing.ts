/**
 * Moving a planned hole with the mouse in the 3D view, on the active slice:
 *
 * - Drag the selected hole's target (or its collar, for holes with a typed
 *   collar): it slides on the slice plane, at its true place whatever the
 *   vertical exaggeration. The camera moves only when empty space is grabbed.
 * - Place target / Place collar (planStore.tool): the next click on the slice
 *   puts it there. Esc cancels.
 *
 * Only while no other tool has the mouse (surface points, the structure tool,
 * the lasso, placing a slice): the viewer says so with `active`. A collar
 * that takes its RL from the topography keeps that RL; only its place on plan
 * moves.
 */
import { RefObject, useEffect, useRef } from 'react';
import type { ThreeViewport } from '../ThreeViewport';
import { dataRay, rayPlane } from '../picking';
import { optionOf } from '../../../../utils/drillholePlan';
import type { Planner } from './usePlans';
import { activeSlice, SliceLink } from './planSlice';
import { usePlanStore } from './planStore';

/** How close the pointer must be to a marker to grab it (px) */
const GRAB_PX = 12;

type Handle = 'target' | 'collar';

export function usePlannerEditing(o: {
    containerRef: RefObject<HTMLElement>;
    viewportRef: RefObject<ThreeViewport | null>;
    ready: boolean;
    origin: [number, number, number] | null;
    vex: number;
    link: SliceLink;
    planner: Planner;
    /** No other tool has the mouse */
    active: boolean;
}) {
    const live = useRef(o);
    live.current = o;
    const tool = usePlanStore(s => s.tool);

    // Another tool took the mouse: a waiting placement is dropped
    useEffect(() => {
        if (!o.active && tool) usePlanStore.getState().setTool(null);
    }, [o.active, tool]);

    useEffect(() => {
        const el = o.containerRef.current;
        if (!o.ready || !el) return;
        let drag: { pointer: number; handle: Handle; holeId: string; plane: { normal: number[]; point: number[] } } | null = null;
        let swallowUp = false;
        let frame = 0;
        let pending: (() => void) | null = null;
        const queue = (f: () => void) => {
            pending = f;
            if (!frame) frame = requestAnimationFrame(() => { frame = 0; const run = pending; pending = null; run?.(); });
        };

        const where = (e: PointerEvent) => {
            const r = el.getBoundingClientRect();
            return [e.clientX - r.left, e.clientY - r.top] as const;
        };
        /** The world point under the pointer on a plane */
        const onPlane = (e: PointerEvent, plane: { normal: ArrayLike<number>; point: ArrayLike<number> }) => {
            const { viewportRef, origin, vex } = live.current;
            const vp = viewportRef.current;
            if (!vp || !origin) return null;
            const [x, y] = where(e);
            return rayPlane(dataRay(vp.screenRay(x, y), vex, origin), plane);
        };
        /** The selected hole's markers that can be dragged, with where they are on screen */
        const handles = () => {
            const { planner, viewportRef, origin } = live.current;
            const vp = viewportRef.current;
            const sel = planner.selected;
            if (!vp || !origin || !sel) return [];
            const option = optionOf(sel.hole.input);
            const out: { handle: Handle; x: number; y: number }[] = [];
            const add = (handle: Handle, p: ArrayLike<number> | null) => {
                if (!p) return;
                const [x, y] = vp.projectPoint([p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]]);
                if (Number.isFinite(x) && Number.isFinite(y)) out.push({ handle, x, y });
            };
            if (option !== 'collar') add('target', sel.result.target);
            if (option === 'collar' || option === 'collar-target') add('collar', sel.result.collar ?? (sel.hole.input.collar.e !== null && sel.hole.input.collar.n !== null && sel.hole.input.collar.rl !== null ? [sel.hole.input.collar.e, sel.hole.input.collar.n, sel.hole.input.collar.rl] : null));
            return out;
        };
        const grabbed = (e: PointerEvent): Handle | null => {
            const [x, y] = where(e);
            let best: Handle | null = null, bestD = GRAB_PX;
            for (const h of handles()) {
                const d = Math.hypot(h.x - x, h.y - y);
                if (d <= bestD) { bestD = d; best = h.handle; }
            }
            return best;
        };
        const put = (holeId: string, handle: Handle, p: number[]) => {
            const s = usePlanStore.getState();
            const hole = s.holes.find(h => h.id === holeId);
            if (!hole) return;
            if (handle === 'target') s.updateHole(holeId, { target: { e: p[0], n: p[1], rl: p[2] } });
            // A collar placed on the slice sits on the hole's topography (the slice point only gives its place in plan)
            else if (hole.topo) s.updateHole(holeId, { collar: { e: p[0], n: p[1], rl: hole.input.collar.rl }, rlFromTopo: true, collarHole: null });
            else s.updateHole(holeId, { collar: { e: p[0], n: p[1], rl: p[2] }, collarHole: null });
        };

        const onPointerDown = (e: PointerEvent) => {
            if (e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey || !live.current.active) return;
            const slice = activeSlice(live.current.link.clip.get());
            const sel = live.current.planner.selected;
            if (!slice || !sel) return;
            const plane = { normal: [...slice.normal], point: [...slice.center] };
            const s = usePlanStore.getState();
            if (s.tool) {
                // Place target / collar: this click
                const p = onPlane(e, plane);
                if (p) put(sel.hole.id, s.tool, p);
                s.setTool(null);
                swallowUp = true;
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            const handle = grabbed(e);
            if (!handle) return;
            drag = { pointer: e.pointerId, handle, holeId: sel.hole.id, plane };
            el.setPointerCapture(e.pointerId);
            el.style.cursor = 'grabbing';
            e.preventDefault();
            e.stopPropagation();
        };
        const onPointerMove = (e: PointerEvent) => {
            if (drag && e.pointerId === drag.pointer) {
                e.stopPropagation();
                const p = onPlane(e, drag.plane);
                const d = drag;
                if (p) queue(() => put(d.holeId, d.handle, p));
                return;
            }
            if (e.buttons !== 0) return;
            // Show what can be grabbed
            const s = usePlanStore.getState();
            const cursor = !live.current.active ? '' : s.tool ? 'crosshair' : activeSlice(live.current.link.clip.get()) && grabbed(e) ? 'grab' : '';
            if (el.style.cursor !== cursor) el.style.cursor = cursor;
        };
        const onPointerUp = (e: PointerEvent) => {
            if (swallowUp) { swallowUp = false; e.stopPropagation(); return; }
            if (!drag || e.pointerId !== drag.pointer) return;
            e.stopPropagation();
            if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
            drag = null;
            el.style.cursor = '';
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && usePlanStore.getState().tool) usePlanStore.getState().setTool(null);
        };
        el.addEventListener('pointerdown', onPointerDown, { capture: true });
        el.addEventListener('pointermove', onPointerMove, { capture: true });
        el.addEventListener('pointerup', onPointerUp, { capture: true });
        el.addEventListener('pointercancel', onPointerUp, { capture: true });
        document.addEventListener('keydown', onKey);
        return () => {
            el.removeEventListener('pointerdown', onPointerDown, { capture: true });
            el.removeEventListener('pointermove', onPointerMove, { capture: true });
            el.removeEventListener('pointerup', onPointerUp, { capture: true });
            el.removeEventListener('pointercancel', onPointerUp, { capture: true });
            document.removeEventListener('keydown', onKey);
            if (frame) cancelAnimationFrame(frame);
            el.style.cursor = '';
        };
    }, [o.ready, o.containerRef]); // eslint-disable-line react-hooks/exhaustive-deps
}
