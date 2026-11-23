/**
 * A geological model's box changed in the 3D view: with the model picked in
 * the Modelling tree (it alone), a handle stands at the middle of each face of
 * its box; dragged, the face moves along its own axis, the box as it would
 * be is drawn while it does, and letting go sets the box (one step to undo).
 * A box that follows the data becomes a box set by hand, as when a side is
 * typed in the model's properties.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useModellingStore } from '../../../store/modellingStore';
import { useModelStore } from '../../../store/modelStore';
import { boxFaces, boxLines, moveFace, roundedBox } from '../../model/boxEdit';
import { useGeoModelCache } from '../../model/geoModelCache';
import { keys } from '../../model/objectKeys';
import type { Box3, Vec3 } from '../../model/types';
import type { PointCloudGeometry } from './geometry';
import { dataRay } from './picking';
import type { ThreeViewport } from './ThreeViewport';

interface Inputs {
    containerRef: RefObject<HTMLElement | null>;
    viewportRef: RefObject<ThreeViewport | null>;
    ready: boolean;
    geometry: PointCloudGeometry | null;
    vex: number;
    /** The view shows the project's scene and the camera tool is the one in hand */
    active: boolean;
}

/** A handle is taken hold of within this many pixels of it */
const GRAB = 12;
const COLOR = '#ffc107';

export function useModelBoxHandles({ containerRef, viewportRef, ready, geometry, vex, active }: Inputs): { dragging: boolean } {
    const selected = useModellingStore(s => s.selected);
    const models = useModelStore(s => s.scene.models);
    const model = active && selected.length === 1 ? models?.find(m => keys.model(m.id) === selected[0]) : undefined;
    // The box it is built in now (its own, or the one it takes from its drilling); a model inside another has none of its own to move
    const built = useGeoModelCache(s => (model ? s.byId[model.id]?.job?.box ?? null : null));
    const box: Box3 | null = model ? model.boundary.box ?? built : null;
    const origin = geometry?.origin ?? null;
    const [moved, setMoved] = useState<{ face: number; box: Box3 } | null>(null);
    const [over, setOver] = useState(-1);
    const live = useRef({ box, origin, vex, model: model?.id ?? null });
    live.current = { box, origin, vex, model: model?.id ?? null };

    // The handles, and the box as it would be while one is dragged
    const shown = moved?.box ?? box;
    const key = shown ? [...shown.min, ...shown.max].join() : '';
    useEffect(() => {
        const v = viewportRef.current;
        if (!ready || !v) return;
        if (!shown || !origin) { v.setBoxEdit(null); return; }
        const local = (p: Vec3): Vec3 => [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
        const positions = Float32Array.from(boxFaces(shown).flatMap(local));
        const lines = moved ? Float32Array.from(boxLines(shown), (v, i) => v - origin[i % 3]) : null;
        v.setBoxEdit({ positions, color: COLOR, active: moved ? moved.face : over }, lines);
        return () => { v.setBoxEdit(null); };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the box by its numbers
    }, [ready, viewportRef, key, origin, moved?.face, over, !!moved]);

    useEffect(() => {
        const el = containerRef.current;
        if (!el || !ready || !model) return;
        const cursorOf = (e: PointerEvent): [number, number] => {
            const r = (el.querySelector('canvas') ?? el).getBoundingClientRect();
            return [e.clientX - r.left, e.clientY - r.top];
        };
        /** The face whose handle is under the cursor (-1: none) */
        const faceAt = (x: number, y: number): number => {
            const v = viewportRef.current, { box: b, origin: o } = live.current;
            if (!v || !b || !o) return -1;
            let best = -1, near = GRAB * GRAB;
            boxFaces(b).forEach((p, k) => {
                const [px, py] = v.projectPoint([p[0] - o[0], p[1] - o[1], p[2] - o[2]]);
                const d = (px - x) ** 2 + (py - y) ** 2;
                if (d <= near) { near = d; best = k; }
            });
            return best;
        };
        let drag: { pointer: number; face: number; from: Box3; now: Box3 } | null = null;
        const onPointerDown = (e: PointerEvent) => {
            if (!(e.target instanceof HTMLCanvasElement) || !e.isPrimary || e.button !== 0) return;
            const [x, y] = cursorOf(e);
            const face = faceAt(x, y);
            const from = live.current.box;
            if (face < 0 || !from) return;
            // Ours: the camera does not turn while a face is moved
            e.preventDefault();
            e.stopPropagation();
            el.setPointerCapture(e.pointerId);
            drag = { pointer: e.pointerId, face, from, now: from };
            setMoved({ face, box: from });
        };
        const onPointerMove = (e: PointerEvent) => {
            const [x, y] = cursorOf(e);
            if (!drag) { const f = faceAt(x, y); setOver(was => (was === f ? was : f)); return; }
            if (e.pointerId !== drag.pointer) return;
            e.preventDefault();
            e.stopPropagation();
            const v = viewportRef.current, { origin: o, vex: ve } = live.current;
            if (!v || !o) return;
            const next = moveFace(drag.from, drag.face, dataRay(v.screenRay(x, y), ve, o));
            if (!next) return;
            drag.now = next;
            setMoved({ face: drag.face, box: next });
        };
        const onPointerUp = (e: PointerEvent) => {
            if (!drag || e.pointerId !== drag.pointer) return;
            e.preventDefault();
            e.stopPropagation();
            if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
            const done = drag;
            drag = null;
            setMoved(null);
            const id = live.current.model;
            if (e.type !== 'pointerup' || !id) return;
            const next = roundedBox(done.now);
            if (next.min.some((v, k) => v !== done.from.min[k]) || next.max.some((v, k) => v !== done.from.max[k])) useModelStore.getState().updateModel(id, { boundary: { box: next } });
        };
        el.addEventListener('pointerdown', onPointerDown, { capture: true });
        el.addEventListener('pointermove', onPointerMove, { capture: true });
        el.addEventListener('pointerup', onPointerUp, { capture: true });
        el.addEventListener('pointercancel', onPointerUp, { capture: true });
        return () => {
            el.removeEventListener('pointerdown', onPointerDown, { capture: true });
            el.removeEventListener('pointermove', onPointerMove, { capture: true });
            el.removeEventListener('pointerup', onPointerUp, { capture: true });
            el.removeEventListener('pointercancel', onPointerUp, { capture: true });
            setMoved(null);
            setOver(-1);
        };
    }, [containerRef, viewportRef, ready, model?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- the model by its id

    return { dragging: !!moved };
}
