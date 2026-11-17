/**
 * Editing a surface in the 3D view: the open surface's points are shown as
 * dots and its drawn lines as lines with a square at every node. Each is at
 * its place in space: a slice that has moved away from one hides it, and what
 * is hidden cannot be picked up. While "place points" is on
 * (modelStore.picking)
 *
 *  - a click on a drillhole adds a point there, snapped to the edge or the
 *    middle of the sample under the cursor (a ring shows where before the
 *    click); samples without an interval snap to the sample; with a slice on,
 *    a click on empty space lands on the slice;
 *  - dragging a dot moves it: along and between holes, or freely across the
 *    screen when off them; the surface follows as it moves;
 *  - dragging a node of a line moves it within the slice the line was drawn
 *    on; a click on a line between nodes puts a node there;
 *  - right-click (or Delete while pointing at it) removes a dot, a node or a
 *    line;
 *  - Esc stops placing.
 *
 * With "draw lines" on as well (modelStore.drawing) and a slice showing,
 * clicks build a line on the slice node by node (double-click, Enter, Esc or
 * a right-click ends it; Backspace takes the last node back; a click on the
 * end of a line carries that line on), and a drag draws one freehand, kept as
 * a few nodes. Points are placed with drawing off.
 *
 * The camera keeps working throughout: only a press on a dot, a node or a
 * line, or, while drawing, the left button is taken from it. The pointer
 * work is done outside React (native listeners, a label element and the
 * viewport's own handles), so moving the mouse re-renders nothing.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { useModelStore } from '../../../store/modelStore';
import { lineLength, simplifyLine } from '../../model/lines';
import { sceneDataBox, useModelCache } from '../../model/modelCache';
import { unit } from '../../model/plane';
import type { Plane, ScenePoint, ScenePolyline, SurfaceObject, Vec3 } from '../../model/types';
import type { PointCloudGeometry } from './geometry';
import type { IntervalGeometry } from './intervals';
import { pickHandle } from './picking';
import { editLineSegments, lineNodes, localLine, nearestOnStretch, pickLine, readingMarks, stretches, withNode, withNodeAt, type LinePick } from './surfaceLines';
import type { ThreeViewport } from './ThreeViewport';
import { describePlacement, placementHole, placeOnPlane, resolvePlacement, type Placement, type PlacementView } from './viewPlacement';

export interface SurfaceEditingOptions {
    containerRef: RefObject<HTMLElement>;
    viewportRef: RefObject<ThreeViewport | null>;
    ready: boolean;
    /** The view shows the scene's coordinate columns and is free for clicks (orbit mode, nothing else waiting for one) */
    active: boolean;
    geometry: PointCloudGeometry | null;
    /** Every sample's From-To interval (whether or not cylinders are drawn) */
    intervals: IntervalGeometry | null;
    vex: number;
    /** Samples the user can see now */
    eligibility: () => (i: number) => boolean;
    /** Whether a place (local coordinates) is inside the slices and the clip box now */
    visibleAt: () => (x: number, y: number, z: number) => boolean;
    /** The active slice's mid-plane in local coordinates (null: no slice) */
    slicePlane: () => { normal: Vec3; point: Vec3 } | null;
    /** Dataset columns naming the hole and the depths down it */
    columns: { hole: string | null; from: string | null; to: string | null; id: string | null };
}

/** The bar of a dip reading's mark is this share of the data's longest side, either way from its point */
const MARK_SHARE = 0.04;
/** A line drawn freehand is kept to this many screen pixels of what the hand drew ... */
const DRAW_TOLERANCE_PX = 3;
/** ... as no more than this many nodes */
const MAX_FREEHAND_NODES = 24;
/** A drag shorter than this on screen is not a line */
const MIN_LINE_PX = 8;
/** Two clicks this close in time (ms) and place (px) are a double-click: it ends the line */
const DOUBLE_MS = 350;
const DOUBLE_PX = 5;

const editedSurface = (): SurfaceObject | null => {
    const s = useModelStore.getState();
    return s.editingId === null ? null : s.scene.surfaces.find(x => x.id === s.editingId) ?? null;
};

const localOf = (points: readonly ScenePoint[], origin: ArrayLike<number>): Float32Array => {
    const out = new Float32Array(points.length * 3);
    points.forEach((p, i) => { out[i * 3] = p.p[0] - origin[0]; out[i * 3 + 1] = p.p[1] - origin[1]; out[i * 3 + 2] = p.p[2] - origin[2]; });
    return out;
};

export function useSurfaceEditing(o: SurfaceEditingOptions): { picking: boolean; drawing: boolean } {
    const surface = useModelStore(s => (s.editingId === null ? null : s.scene.surfaces.find(x => x.id === s.editingId) ?? null));
    const pickingOn = useModelStore(s => s.picking);
    const drawingOn = useModelStore(s => s.drawing);
    const lineSigns = useModelCache(s => (surface ? s.byId[surface.id]?.lineSigns ?? null : null));
    const shown = o.active && !!surface && !!o.geometry;
    const picking = shown && pickingOn;
    const drawing = picking && drawingOn;

    // The handlers outlive a render: they read today's values here
    const live = useRef({ ...o, shown, picking, drawing });
    live.current = { ...o, shown, picking, drawing };
    /** The dot under the cursor or being dragged */
    const activeHandle = useRef(-1);
    /** The node of a line under the cursor or being dragged (its place among all the nodes) */
    const activeNode = useRef(-1);
    /** The line being drawn (local xyz triples): a freehand stroke, or from the last node to the cursor */
    const draft = useRef<number[] | null>(null);

    // The open surface's points as dots
    const points = surface?.points, origin = o.geometry?.origin, color = surface?.color;
    const dots = useMemo(() => (shown && points && origin ? localOf(points, origin) : null), [shown, points, origin]);
    useEffect(() => {
        const vp = o.viewportRef.current;
        if (!o.ready || !vp) return;
        if (activeHandle.current >= (dots?.length ?? 0) / 3) activeHandle.current = -1;
        vp.setHandles(dots ? { positions: dots, color: color ?? '#000', active: activeHandle.current, quiet: !picking } : null);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the viewport is read through its ref
    }, [o.ready, dots, color, picking]);
    useEffect(() => () => o.viewportRef.current?.setHandles(null), [o.viewportRef]);

    // Its lines, the one pointed out (from the panel or the view) and the one being drawn
    const drawLines = useRef(() => {
        const vp = live.current.viewportRef.current, g = live.current.geometry;
        const s = editedSurface();
        if (!vp) return;
        // The outline it is kept inside, as a closed loop
        const outline = s && s.params.extent === 'outline' ? s.params.outline : null;
        // The mark of each dip reading, sized to the data
        const box = sceneDataBox();
        const marks = live.current.shown && s && g
            ? readingMarks(s.points, g.origin, box ? MARK_SHARE * Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2], 1) : 5)
            : [];
        if (!live.current.shown || !s || !g || (s.polylines.length === 0 && !draft.current && !outline && marks.length === 0)) {
            vp.setEditLines(null);
            vp.setLineNodes(null);
            return;
        }
        const signs = useModelCache.getState().byId[s.id]?.lineSigns ?? null;
        const { all, active } = editLineSegments(s.polylines, g.origin, signs, useModelStore.getState().hotLine, draft.current);
        // The outline is seen whole whatever the slices; the rest is at its place in space
        const free = outline ? stretches(localLine([...outline.points, outline.points[0]], g.origin)) : null;
        const withMarks = new Float32Array(all.length + marks.length);
        withMarks.set(all);
        withMarks.set(marks, all.length);
        vp.setEditLines(withMarks, active, free);
        // A square at every node of every line
        const nodes = lineNodes(s.polylines, g.origin);
        if (activeNode.current >= nodes.line.length) activeNode.current = -1;
        vp.setLineNodes(nodes.line.length > 0 ? { positions: nodes.positions, color: s.color, active: activeNode.current, quiet: !live.current.picking } : null);
    });
    const polylines = surface?.polylines, outline = surface?.params.outline, extent = surface?.params.extent;
    useEffect(() => {
        if (o.ready) drawLines.current();
    }, [o.ready, shown, picking, polylines, points, origin, lineSigns, outline, extent, color]);
    useEffect(() => {
        const redraw = drawLines.current;
        const stop = useModelStore.subscribe((s, prev) => { if (s.hotLine !== prev.hotLine) redraw(); });
        const viewport = o.viewportRef;
        return () => {
            stop();
            viewport.current?.setEditLines(null);
            viewport.current?.setLineNodes(null);
        };
    }, [o.viewportRef]);

    useEffect(() => {
        const el = o.containerRef.current;
        if (!picking || !el) return;
        const vp = () => live.current.viewportRef.current;
        const canvas = () => el.querySelector('canvas');
        const cursorOf = (e: MouseEvent): [number, number] => {
            const r = (canvas() ?? el).getBoundingClientRect();
            return [e.clientX - r.left, e.clientY - r.top];
        };
        const model = () => useModelStore.getState();

        // A label that follows the cursor
        const label = document.createElement('div');
        label.dataset.testid = 'surface-pick-label';
        Object.assign(label.style, {
            position: 'absolute', display: 'none', pointerEvents: 'none', zIndex: '3', whiteSpace: 'nowrap',
            font: '500 12px Inter, system-ui, sans-serif', color: '#fff', background: 'rgba(33, 33, 33, 0.88)',
            padding: '2px 7px', borderRadius: '4px',
        });
        el.appendChild(label);
        const say = (text: string | null, x = 0, y = 0) => {
            if (text === null) { label.style.display = 'none'; return; }
            label.textContent = text;
            label.style.display = 'block';
            // Kept inside the view
            label.style.left = `${Math.min(x + 16, el.clientWidth - label.offsetWidth - 4)}px`;
            label.style.top = `${Math.min(y + 14, el.clientHeight - label.offsetHeight - 4)}px`;
        };
        const baseCursor = el.style.cursor;
        el.style.cursor = 'crosshair';

        const showHandles = (active: number) => {
            const s = editedSurface(), g = live.current.geometry, v = vp();
            if (activeHandle.current === active && active < 0) return;
            activeHandle.current = active;
            if (s && g && v) v.setHandles({ positions: localOf(s.points, g.origin), color: s.color, active });
        };
        const showNode = (active: number) => {
            if (activeNode.current === active) return;
            activeNode.current = active;
            drawLines.current();
        };
        /** Where local xyz triples are on screen; what the slices hide is nowhere (it is never under the cursor) */
        const onScreen = (local: Float32Array): Float32Array | null => {
            const v = vp();
            if (!v) return null;
            const seen = live.current.visibleAt();
            const xy = Float32Array.from(v.projectPoints(local));
            for (let i = 0; i * 3 + 2 < local.length; i++) {
                if (!seen(local[i * 3], local[i * 3 + 1], local[i * 3 + 2])) xy[i * 2] = xy[i * 2 + 1] = NaN;
            }
            return xy;
        };
        const handleAt = (x: number, y: number): number => {
            const s = editedSurface(), g = live.current.geometry;
            if (!s || !g || s.points.length === 0) return -1;
            const xy = onScreen(localOf(s.points, g.origin));
            return xy ? pickHandle(xy, [x, y]) : -1;
        };
        /** The node of a line under the cursor: its place among all the nodes, its line and its place along it */
        const nodeAt = (x: number, y: number): { index: number; line: ScenePolyline; vertex: number } | null => {
            const s = editedSurface(), g = live.current.geometry;
            if (!s || !g || s.polylines.length === 0) return null;
            const nodes = lineNodes(s.polylines, g.origin);
            const xy = onScreen(nodes.positions);
            const index = xy ? pickHandle(xy, [x, y]) : -1;
            return index < 0 ? null : { index, line: s.polylines[nodes.line[index]], vertex: nodes.vertex[index] };
        };
        const lineAt = (x: number, y: number): LinePick | null => {
            const s = editedSurface(), g = live.current.geometry;
            if (!s || !g || s.polylines.length === 0) return null;
            return pickLine(s.polylines.map(l => onScreen(localLine(l.points, g.origin)) ?? new Float32Array(0)), [x, y]);
        };

        /** The slice a line was drawn on, in the view's local coordinates and in the world's: its nodes stay on it */
        const planeOf = (line: ScenePolyline): { local: Plane; world: Plane } | null => {
            const g = live.current.geometry;
            const normal = unit(line.plane.normal);
            if (!g || !normal) return null;
            const p = line.plane.point, o3 = g.origin;
            return { local: { normal, point: [p[0] - o3[0], p[1] - o3[1], p[2] - o3[2]] }, world: { normal, point: [p[0], p[1], p[2]] } };
        };
        /** The slice lines are drawn on now, in local and in world coordinates (null: no slice, or drawing is off). */
        const drawPlane = (): { local: Plane; world: Plane } | null => {
            const g = live.current.geometry;
            const local = live.current.drawing ? live.current.slicePlane() : null;
            const normal = local && unit(local.normal);
            if (!g || !local || !normal) return null;
            const o3 = g.origin;
            return { local: { normal, point: local.point }, world: { normal, point: [local.point[0] + o3[0], local.point[1] + o3[1], local.point[2] + o3[2]] } };
        };
        /** What the view shows now, for finding where a click lands (viewPlacement) */
        const view = (): PlacementView => ({ ...live.current, viewport: vp() });
        const onPlane = (x: number, y: number, plane: Plane): Vec3 | null => placeOnPlane(view(), x, y, plane);
        /** Where a click at this pixel would put a point (`onSlice`: empty space lands on the active slice). */
        const resolve = (x: number, y: number, onSlice: boolean): Placement | null => resolvePlacement(view(), x, y, onSlice);
        /** The hole and depth of a placement on a drillhole (null off the holes). */
        const holeOf = (p: Placement) => placementHole(view(), p);
        const describe = (p: Placement): string => describePlacement(view(), p);
        const worldOf = (local: ArrayLike<number>): Vec3 => {
            const g = live.current.geometry!.origin;
            return [local[0] + g[0], local[1] + g[1], local[2] + g[2]];
        };
        const snapOf = (p: Placement | null): ScenePoint['snap'] => {
            const at = p ? holeOf(p) : null;
            return at && at.depth !== null ? { hole: at.hole, depth: at.depth } : undefined;
        };
        /** The normal of the slice showing now: a point placed with a slice on marks a surface that crosses it */
        const acrossNow = (): Vec3 | undefined => {
            const plane = live.current.slicePlane();
            return (plane && unit(plane.normal)) ?? undefined;
        };

        // --- one update per frame ---------------------------------------------------
        let frame = 0;
        let pending: (() => void) | null = null;
        const schedule = (work: () => void) => {
            pending = work;
            if (frame) return;
            frame = requestAnimationFrame(() => {
                frame = 0;
                const w = pending;
                pending = null;
                w?.();
            });
        };
        const flush = () => {
            if (frame) cancelAnimationFrame(frame);
            frame = 0;
            const w = pending;
            pending = null;
            w?.();
        };

        /** The line of the open surface the cursor is on (its id; null: none), and its node if it is on one */
        let hoverLine: string | null = null;
        let hoverNode: { line: string; vertex: number } | null = null;
        const pointOut = (lineId: string | null) => {
            if (hoverLine === lineId) return;
            hoverLine = lineId;
            model().setHotLine(lineId);
        };

        // --- a line built node by node ------------------------------------------------
        /**
         * The line being built: the slice it is on, the line itself once it has two nodes (until then only
         * its first node, `first`, local), the end new nodes join, and the last click (a second one on top
         * of it ends the line).
         */
        let building: {
            plane: { local: Plane; world: Plane }; lineId: string | null; atStart: boolean; first: Vec3;
            last: { x: number; y: number; t: number } | null;
        } | null = null;
        const builtLine = (): ScenePolyline | null => {
            const s = editedSurface();
            return building?.lineId && s ? s.polylines.find(l => l.id === building!.lineId) ?? null : null;
        };
        /** The node the next one joins (local; null: the line has gone, undone or removed) */
        const tail = (): Vec3 | null => {
            const g = live.current.geometry;
            if (!building || !g) return null;
            if (!building.lineId) return building.first;
            const line = builtLine();
            if (!line) return null;
            const p = line.points[building.atStart ? 0 : line.points.length - 1];
            return [p[0] - g.origin[0], p[1] - g.origin[1], p[2] - g.origin[2]];
        };
        const endBuilding = () => {
            if (!building) return;
            building = null;
            draft.current = null;
            vp()?.setSnapMarker(null);
            drawLines.current();
        };
        /** From the last node to the cursor */
        const rubberBand = (x: number, y: number) => {
            const from = tail();
            const to = building ? onPlane(x, y, building.plane.local) : null;
            draft.current = from && to ? [from[0], from[1], from[2], to[0], to[1], to[2]] : null;
            drawLines.current();
        };
        const addNode = (x: number, y: number) => {
            const s = editedSurface();
            if (!building || !s) return;
            const now = performance.now();
            if (building.last && now - building.last.t < DOUBLE_MS && Math.hypot(x - building.last.x, y - building.last.y) < DOUBLE_PX) {
                endBuilding();
                return;
            }
            const local = onPlane(x, y, building.plane.local);
            if (!local) return;
            const p = worldOf(local);
            const line = builtLine();
            if (line) {
                model().updatePolyline(s.id, line.id, { points: building.atStart ? [p, ...line.points] : [...line.points, p] });
            } else if (building.lineId) {
                // The line has gone (undone): a new one starts here
                building = { ...building, lineId: null, atStart: false, first: local };
            } else {
                // Two nodes make a line (a click on top of the first node does not)
                const id = model().addPolyline(s.id, { points: [worldOf(building.first), p], plane: building.plane.world });
                if (id) building.lineId = id;
            }
            building.last = { x, y, t: now };
            rubberBand(x, y);
        };
        /** Backspace: the last node placed is taken back */
        const takeBack = () => {
            const s = editedSurface(), line = builtLine();
            if (!building || !s) return;
            draft.current = null;
            if (!line) { endBuilding(); return; }
            if (line.points.length <= 2) {
                model().removePolylines(s.id, [line.id]);
                endBuilding();
                return;
            }
            model().updatePolyline(s.id, line.id, { points: building.atStart ? line.points.slice(1) : line.points.slice(0, -1) });
        };

        const hover = (x: number, y: number) => {
            const v = vp(), s = editedSurface();
            if (!v || !s) return;
            if (building && !live.current.drawing) endBuilding();
            hoverNode = null;
            if (building) {
                showHandles(-1);
                showNode(-1);
                pointOut(null);
                el.style.cursor = 'crosshair';
                v.setSnapMarker(building.lineId ? null : building.first, s.color);
                rubberBand(x, y);
                say('Click for the next node · double-click or Enter ends the line', x, y);
                return;
            }
            const h = handleAt(x, y);
            if (h >= 0) {
                showHandles(h);
                showNode(-1);
                pointOut(null);
                v.setSnapMarker(null);
                el.style.cursor = 'grab';
                say('Drag to move · right-click to remove', x, y);
                return;
            }
            showHandles(-1);
            const n = nodeAt(x, y);
            if (n) {
                hoverNode = { line: n.line.id, vertex: n.vertex };
                showNode(n.index);
                pointOut(n.line.id);
                v.setSnapMarker(null);
                el.style.cursor = 'grab';
                const end = n.vertex === 0 || n.vertex === n.line.points.length - 1;
                say(end && live.current.drawing
                    ? 'Drag to move this node · click to carry the line on · right-click removes it'
                    : 'Drag to move this node · right-click removes it', x, y);
                return;
            }
            showNode(-1);
            el.style.cursor = 'crosshair';
            const on = lineAt(x, y);
            if (on) {
                pointOut(s.polylines[on.line].id);
                v.setSnapMarker(null);
                say('Click to put a node here · right-click removes the line', x, y);
                return;
            }
            pointOut(null);
            if (live.current.drawing) {
                // Drawing: clicks make lines, not points
                v.setSnapMarker(null);
                say(drawPlane() ? 'Click to start a line, node by node · or drag to draw it freehand' : null, x, y);
                return;
            }
            const place = resolve(x, y, true);
            v.setSnapMarker(place ? place.local : null, s.color);
            say(place ? describe(place) : null, x, y);
        };
        const quiet = () => {
            pending = null;
            vp()?.setSnapMarker(null);
            say(null);
        };

        /** A click: a point on the hole, sample or slice under the cursor. */
        const placeAt = (x: number, y: number) => {
            const s = editedSurface(), v = vp();
            const place = resolve(x, y, true);
            if (!s || !v || !place) return;
            if (s.points.length < 2 && s.polylines.length === 0) {
                // Until three points fix a plane, the surface runs straight into the screen through them
                const f = v.viewDirection();
                const along = unit([f[0], f[1], f[2] / live.current.vex]);
                if (along) model().updateSurface(s.id, { along });
            }
            // A dip reading waiting for its place goes with this point
            const reading = model().pendingReading;
            model().addPoints(s.id, [{ p: worldOf(place.local), snap: snapOf(place), across: acrossNow(), ...(reading ? { reading } : {}) }]);
            if (reading) model().setPendingReading(null);
        };

        // --- gestures taken from the camera ---------------------------------------------
        let drag: { pointer: number; pointId: string; index: number; start: Vec3 } | null = null;
        /** A node of a line being dragged within the line's slice (`end`: it is the line's first or last) */
        let nodeDrag: { pointer: number; lineId: string; vertex: number; plane: Plane; x0: number; y0: number; moved: boolean; end: boolean } | null = null;
        /** A freehand line being drawn (if the button comes up where it went down, a click: the first node of a line) */
        let stroke: { pointer: number; x0: number; y0: number; moved: boolean; plane: { local: Plane; world: Plane }; local: number[] } | null = null;
        /** The left button is down while a line is being built: its release places the next node */
        let press: { pointer: number } | null = null;
        /** The right button went down here while a line is being built: released in place, it ends the line */
        let finishing: { x: number; y: number } | null = null;
        let down: { x: number; y: number } | null = null;
        let removing: { point?: string; line?: string; node?: { line: string; vertex: number } } | null = null;
        let blockMenu = false;

        const dragTo = (x: number, y: number) => {
            const v = vp(), s = editedSurface();
            if (!drag || !v || !s) return;
            const place = resolve(x, y, false);
            let local: ArrayLike<number> | null = place?.local ?? null;
            if (!local) {
                // Off the holes: across the screen, at the depth the dot started at
                const f = v.viewDirection(), vex = live.current.vex;
                local = onPlane(x, y, { normal: [f[0], f[1], f[2] * vex], point: drag.start });
            }
            if (!local) return;
            model().movePoint(s.id, drag.pointId, worldOf(local), snapOf(place), acrossNow() ?? s.points[drag.index]?.across);
            v.setSnapMarker(place ? place.local : null, s.color);
            say(place ? describe(place) : 'Off the holes', x, y);
        };
        const nodeDragTo = (x: number, y: number) => {
            const s = editedSurface();
            if (!nodeDrag || !s) return;
            const line = s.polylines.find(l => l.id === nodeDrag!.lineId);
            const local = onPlane(x, y, nodeDrag.plane);
            if (!line || !local || nodeDrag.vertex >= line.points.length) return;
            model().updatePolyline(s.id, line.id, { points: withNodeAt(line.points, nodeDrag.vertex, worldOf(local)) });
        };
        const removeNode = (node: { line: string; vertex: number }) => {
            const s = editedSurface();
            const line = s?.polylines.find(l => l.id === node.line);
            if (!s || !line) return;
            // A line needs two nodes: with one of two gone, so is the line
            if (line.points.length <= 2) model().removePolylines(s.id, [line.id]);
            else model().updatePolyline(s.id, line.id, { points: line.points.filter((_, i) => i !== node.vertex) });
        };

        const endStroke = (keep: boolean) => {
            const done = stroke;
            stroke = null;
            draft.current = null;
            if (!done) return;
            if (el.hasPointerCapture(done.pointer)) el.releasePointerCapture(done.pointer);
            const s = editedSurface(), v = vp();
            if (keep && s && v && done.local.length >= 6) {
                const world: Vec3[] = [];
                for (let i = 0; i + 2 < done.local.length; i += 3) world.push(worldOf([done.local[i], done.local[i + 1], done.local[i + 2]]));
                const mid = Math.floor(done.local.length / 6) * 3;
                const perMetre = v.pixelsPerMetre([done.local[mid], done.local[mid + 1], done.local[mid + 2]]);
                if (lineLength(world) * perMetre >= MIN_LINE_PX) {
                    // The hand's jitter out: what is left is the line's nodes, straight between them
                    const nodes = simplifyLine(world, DRAW_TOLERANCE_PX / Math.max(perMetre, 1e-9), MAX_FREEHAND_NODES);
                    model().addPolyline(s.id, { points: nodes, plane: done.plane.world });
                }
            }
            drawLines.current();
        };

        const onPointerDown = (e: PointerEvent) => {
            if (!(e.target instanceof HTMLCanvasElement) || !e.isPrimary) return;
            const [x, y] = cursorOf(e);
            const s = editedSurface(), g = live.current.geometry;
            /** Ours: the camera does not turn or pan */
            const take = () => {
                e.preventDefault();
                e.stopPropagation();
                el.focus({ preventScroll: true });
            };
            if (building) {
                // Every left click is the next node; the other buttons still move the camera
                if (e.button === 0) {
                    take();
                    el.setPointerCapture(e.pointerId);
                    press = { pointer: e.pointerId };
                } else if (e.button === 2) {
                    finishing = { x: e.clientX, y: e.clientY };
                }
                return;
            }
            const button = e.button === 0 || e.button === 2;
            const h = handleAt(x, y);
            if (h >= 0 && s && g && button) {
                take();
                if (e.button === 2) { removing = { point: s.points[h].id }; blockMenu = true; return; }
                const reading = model().pendingReading;
                if (reading) {
                    // A reading waiting for its place: it was taken at this point
                    model().setPointReading(s.id, s.points[h].id, reading);
                    model().setPendingReading(null);
                    return;
                }
                const p = s.points[h].p;
                drag = { pointer: e.pointerId, pointId: s.points[h].id, index: h, start: [p[0] - g.origin[0], p[1] - g.origin[1], p[2] - g.origin[2]] };
                el.setPointerCapture(e.pointerId);
                el.style.cursor = 'grabbing';
                showHandles(h);
                say(null);
                return;
            }
            const n = s && g && button ? nodeAt(x, y) : null;
            if (n && s) {
                take();
                if (e.button === 2) { removing = { node: { line: n.line.id, vertex: n.vertex } }; blockMenu = true; return; }
                const plane = planeOf(n.line);
                if (!plane) return;
                nodeDrag = {
                    pointer: e.pointerId, lineId: n.line.id, vertex: n.vertex, plane: plane.local, x0: e.clientX, y0: e.clientY, moved: false,
                    end: n.vertex === 0 || n.vertex === n.line.points.length - 1,
                };
                el.setPointerCapture(e.pointerId);
                el.style.cursor = 'grabbing';
                showNode(n.index);
                say(null);
                return;
            }
            const on = s && g && button ? lineAt(x, y) : null;
            if (on && s) {
                const line = s.polylines[on.line];
                take();
                if (e.button === 2) { removing = { line: line.id }; blockMenu = true; return; }
                // A press on a line between two nodes puts a node there, and it can be dragged at once
                const plane = planeOf(line);
                const hit = plane ? onPlane(x, y, plane.local) : null;
                if (!plane || !hit) return;
                const node = nearestOnStretch(line.points[on.segment], line.points[on.segment + 1], worldOf(hit));
                model().updatePolyline(s.id, line.id, { points: withNode(line.points, on.segment, node) });
                const after = editedSurface()?.polylines.find(l => l.id === line.id);
                // (On top of a node that was there: nothing was added)
                if (!after || after.points.length !== line.points.length + 1) return;
                nodeDrag = { pointer: e.pointerId, lineId: line.id, vertex: on.segment + 1, plane: plane.local, x0: e.clientX, y0: e.clientY, moved: false, end: false };
                el.setPointerCapture(e.pointerId);
                el.style.cursor = 'grabbing';
                say(null);
                return;
            }
            const plane = e.button === 0 && s && g ? drawPlane() : null;
            const first = plane ? onPlane(x, y, plane.local) : null;
            if (plane && first) {
                // Drawing: a drag is a freehand line; a click is the first node of a line built node by node
                take();
                el.setPointerCapture(e.pointerId);
                stroke = { pointer: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, plane, local: [first[0], first[1], first[2]] };
                quiet();
                return;
            }
            // (While drawing, clicks make lines: points are placed with drawing off)
            if (e.button === 0 && !live.current.drawing) down = { x: e.clientX, y: e.clientY };
            quiet();
        };
        const onPointerMove = (e: PointerEvent) => {
            const [x, y] = cursorOf(e);
            if (drag) {
                if (e.pointerId !== drag.pointer) return;
                e.stopPropagation();
                schedule(() => dragTo(x, y));
            } else if (nodeDrag) {
                if (e.pointerId !== nodeDrag.pointer) return;
                e.stopPropagation();
                if (!nodeDrag.moved && Math.hypot(e.clientX - nodeDrag.x0, e.clientY - nodeDrag.y0) > 4) nodeDrag.moved = true;
                if (nodeDrag.moved) schedule(() => nodeDragTo(x, y));
            } else if (stroke) {
                if (e.pointerId !== stroke.pointer) return;
                e.stopPropagation();
                if (!stroke.moved && Math.hypot(e.clientX - stroke.x0, e.clientY - stroke.y0) > 4) stroke.moved = true;
                if (!stroke.moved) return;
                const p = onPlane(x, y, stroke.plane.local);
                if (!p) return;
                stroke.local.push(p[0], p[1], p[2]);
                draft.current = stroke.local;
                schedule(drawLines.current);
            } else if (press) {
                if (e.pointerId !== press.pointer) return;
                e.stopPropagation();
                schedule(() => hover(x, y));
            } else if (e.buttons === 0 && e.target instanceof HTMLCanvasElement) {
                schedule(() => hover(x, y));
            } else if (e.buttons === 0) {
                quiet();
            }
        };
        const onPointerUp = (e: PointerEvent) => {
            const [x, y] = cursorOf(e);
            if (drag) {
                if (e.pointerId !== drag.pointer) return;
                e.stopPropagation();
                flush();
                if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
                drag = null;
                hover(x, y);
                return;
            }
            if (nodeDrag) {
                if (e.pointerId !== nodeDrag.pointer) return;
                e.stopPropagation();
                flush();
                if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
                const done = nodeDrag;
                nodeDrag = null;
                // A click on the end of a line, while drawing: the line is carried on from there
                const line = editedSurface()?.polylines.find(l => l.id === done.lineId);
                const plane = line && !done.moved && done.end && live.current.drawing && e.type === 'pointerup' ? planeOf(line) : null;
                if (plane) building = { plane, lineId: done.lineId, atStart: done.vertex === 0, first: [0, 0, 0], last: { x, y, t: performance.now() } };
                hover(x, y);
                return;
            }
            if (stroke) {
                if (e.pointerId !== stroke.pointer) return;
                e.stopPropagation();
                pending = null;
                const done = stroke;
                const click = !done.moved && e.type === 'pointerup' && !e.shiftKey && !e.ctrlKey && !e.metaKey;
                endStroke(done.moved && e.type === 'pointerup');
                if (click) {
                    building = {
                        plane: done.plane, lineId: null, atStart: false, first: [done.local[0], done.local[1], done.local[2]],
                        last: { x, y, t: performance.now() },
                    };
                }
                hover(x, y);
                return;
            }
            if (press) {
                if (e.pointerId !== press.pointer) return;
                e.stopPropagation();
                pending = null;
                if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
                press = null;
                if (e.type === 'pointerup') addNode(x, y);
                hover(x, y);
                return;
            }
            if (finishing !== null && e.button === 2) {
                const from = finishing;
                finishing = null;
                if (Math.hypot(e.clientX - from.x, e.clientY - from.y) > 4) return;
                blockMenu = true;
                endBuilding();
                hover(x, y);
                return;
            }
            if (removing !== null && e.button === 2) {
                e.stopPropagation();
                const s = editedSurface();
                if (s && removing.point) model().removePoints(s.id, [removing.point]);
                if (s && removing.line) model().removePolylines(s.id, [removing.line]);
                if (removing.node) removeNode(removing.node);
                removing = null;
                activeHandle.current = -1;
                activeNode.current = -1;
                hoverLine = null;
                hoverNode = null;
                quiet();
                return;
            }
            const start = down;
            down = null;
            if (!start || e.button !== 0 || !(e.target instanceof HTMLCanvasElement)) return;
            if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4 || e.shiftKey || e.ctrlKey || e.metaKey) return;
            placeAt(x, y);
            hover(x, y);
        };
        const onContextMenu = (e: MouseEvent) => {
            if (!blockMenu) return;
            blockMenu = false;
            e.preventDefault();
        };
        const busy = () => !!(drag || nodeDrag || stroke || press);
        const onLeave = () => {
            if (busy()) return;
            quiet();
            showHandles(-1);
            showNode(-1);
            pointOut(null);
            hoverNode = null;
            if (building && draft.current) {
                draft.current = null;
                drawLines.current();
            }
        };
        const onKey = (e: KeyboardEvent) => {
            if ((e.target as HTMLElement).closest?.('input, textarea')) return;
            if ((e.key !== 'Delete' && e.key !== 'Backspace') || busy() || building) return;
            const s = editedSurface();
            const point = s?.points[activeHandle.current];
            const node = hoverNode, line = hoverLine;
            if (!s || (!point && !node && !line)) return;
            e.preventDefault();
            e.stopPropagation();
            if (point) model().removePoints(s.id, [point.id]);
            else if (node) removeNode(node);
            else if (line) model().removePolylines(s.id, [line]);
            activeHandle.current = -1;
            activeNode.current = -1;
            hoverLine = null;
            hoverNode = null;
            quiet();
        };

        el.addEventListener('pointerdown', onPointerDown, { capture: true });
        el.addEventListener('pointermove', onPointerMove, { capture: true });
        el.addEventListener('pointerup', onPointerUp, { capture: true });
        el.addEventListener('pointercancel', onPointerUp, { capture: true });
        el.addEventListener('contextmenu', onContextMenu, { capture: true });
        el.addEventListener('pointerleave', onLeave);
        el.addEventListener('keydown', onKey);
        // Wherever the keyboard is (the panel's button, the view), except in a field, a menu or a dialog:
        // Esc gives up a freehand line being drawn, or ends the line being built (it is kept), or else ends
        // placing; Enter ends the line being built; Backspace takes its last node back
        const onDocumentKey = (e: KeyboardEvent) => {
            if ((e.target as HTMLElement).closest?.('input, textarea, [role="dialog"], [role="menu"], [role="listbox"]')) return;
            if (building && !busy() && (e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Escape')) {
                e.preventDefault();
                e.stopPropagation();
                if (e.key === 'Backspace') takeBack();
                else endBuilding();
                return;
            }
            if (e.key !== 'Escape') return;
            if (stroke) {
                pending = null;
                endStroke(false);
                return;
            }
            model().setPicking(false);
        };
        document.addEventListener('keydown', onDocumentKey, { capture: true });
        const redraw = drawLines.current;
        return () => {
            document.removeEventListener('keydown', onDocumentKey, { capture: true });
            el.removeEventListener('pointerdown', onPointerDown, { capture: true });
            el.removeEventListener('pointermove', onPointerMove, { capture: true });
            el.removeEventListener('pointerup', onPointerUp, { capture: true });
            el.removeEventListener('pointercancel', onPointerUp, { capture: true });
            el.removeEventListener('contextmenu', onContextMenu, { capture: true });
            el.removeEventListener('pointerleave', onLeave);
            el.removeEventListener('keydown', onKey);
            if (frame) cancelAnimationFrame(frame);
            for (const held of [stroke, press, nodeDrag, drag]) if (held && el.hasPointerCapture(held.pointer)) el.releasePointerCapture(held.pointer);
            stroke = null;
            building = null;
            draft.current = null;
            label.remove();
            el.style.cursor = baseCursor;
            activeHandle.current = -1;
            activeNode.current = -1;
            if (hoverLine !== null) useModelStore.getState().setHotLine(null);
            live.current.viewportRef.current?.setSnapMarker(null);
            redraw();
        };
    }, [picking, o.containerRef]);

    return { picking, drawing };
}
