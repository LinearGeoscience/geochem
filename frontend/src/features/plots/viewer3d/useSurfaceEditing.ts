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
 *  - a click on a dot or a node picks it out (Shift: adds it, or takes it
 *    back out), and Shift-click on a line between nodes picks out all its
 *    nodes: what is picked out is given a direction together, in the panel
 *    (editSession);
 *  - Ctrl+drag from a drillhole or the slice places a point with a dip
 *    reading: the plane through the drag and the line of sight (it strikes
 *    along the drag, seen edge on), the drag's length its reach; a disc
 *    shows it as it is dragged;
 *  - Alt+click or double-click a dot or a node (or empty ground: a point is
 *    put there) opens a box beside it to type its dip reading (ReadingEntry);
 *  - Esc lets go of what is picked out, and then stops placing.
 *
 * With "draw lines" on as well (modelStore.drawing) and a slice showing,
 * clicks build a line on the slice node by node (double-click, Enter, Esc or
 * a right-click ends it; Backspace takes the last node back; a click on the
 * end of a line carries that line on), and a drag draws one freehand, kept as
 * a few nodes. With "smooth" on (editSession.drawSmooth) a line is a curve
 * through its nodes, and a freehand one is kept as the few nodes such a curve
 * needs. A smooth line is drawn, pointed at and given new nodes along its
 * curve. Points are placed with drawing off.
 *
 * The camera keeps working throughout: only a press on a dot, a node or a
 * line, or, while drawing, the left button is taken from it. The pointer
 * work is done outside React (native listeners, a label element and the
 * viewport's own handles), so moving the mouse re-renders nothing.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { useModelStore } from '../../../store/modelStore';
import { lockedInputs } from '../../model/inputs';
import { keys } from '../../model/objectKeys';
import { lineLength, measuredPlaces, onPlane as liesOn, simplifyLine } from '../../model/lines';
import { planeFromDrag, trueDirection } from '../../model/attitudes';
import { liveSelection, nodesOfLines, useEditSession, type ReadingEntryTarget, type SelectMode } from '../../model/editSession';
import { contactInputsFor, sceneDataBox, setInputsFor, useModelCache } from '../../model/modelCache';
import { lastMark, withMark, withMarkRow } from '../../model/contactControl';
import { crossingsOn, ON_PLANE_M } from '../../model/lineTools';
import { unit } from '../../model/plane';
import { cleanReading, formatReading } from '../../model/readings';
import { isOrientedLine } from '../../model/ribbons';
import { fitSmoothNodes, shapeOf, stretchOfPlace } from '../../model/splines';
import type { LineNode, Plane, PointReading, SceneLine, ScenePoint, ScenePolyline, SurfaceObject, Vec3 } from '../../model/types';
import type { PointCloudGeometry } from './geometry';
import type { IntervalGeometry } from './intervals';
import { dataRay, pickHandle, rayHitsBox, rayMesh } from './picking';
import { pickSnap, placementKind, SNAP_NAMES, SNAP_PX, type SnapCandidate, type SnapKind } from './snapTargets';
import { directionBars, readingAxes, readingDisc, readingDiscs, ribbonBars } from './orientationMarks';
import { READING_ENTRY_WIDTH } from './readingEntryForm';
import { editLineSegments, lineNodes, localLine, nearestOnStretch, pickLine, stretches, withNode, withNodeAt, type LinePick } from './surfaceLines';
import type { ThreeViewport } from './ThreeViewport';
import { describePlacement, placementHole, placeOnPlane, resolvePlacement, type Placement, type PlacementView } from './viewPlacement';
import { zonesOf, type Zone } from '../../model/lodes';
import { giveStretchTo } from '../../model/sceneActions';
import { stretchAt, stretchDepths, stretchNear, stretchOwners, veinsOfSet } from '../../model/veinSet';

/** A click off the holes takes the stretch whose middle is within this of it, m */
const STRETCH_NEAR = 5;

/** A dip disc that can be turned: the place it is at (a point's id, or its line's), its middle and the handle on its rim (local), and how what it reads is kept */
interface Turnable { id: string; centre: Vec3; reading: PointReading; radius: number; grip: Vec3; keep: (r: PointReading) => void }

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
    /** The objects the view hides (keys): nodes do not snap to them, nor to their contacts */
    hidden: ReadonlySet<string>;
    /** Whether a place (local coordinates) is inside the slices and the clip box now */
    visibleAt: () => (x: number, y: number, z: number) => boolean;
    /** The active slice's mid-plane in local coordinates (null: no slice) */
    slicePlane: () => { normal: Vec3; point: Vec3 } | null;
    /** Dataset columns naming the hole and the depths down it */
    columns: { hole: string | null; from: string | null; to: string | null; id: string | null };
    /** Tells of every change to the slices (the marks where other sections' lines cross the slice follow it) */
    liveClip?: { subscribe: (listener: () => void) => () => void };
}

/** A place a node can snap to, as found near the cursor */
interface SnapTarget extends SnapCandidate {
    local: Vec3;
    /** The drillhole placement it is (hole kinds) */
    place: Placement | null;
    /** The drillhole and depth it is on, if known */
    snap?: ScenePoint['snap'];
    /** What it is, for the label by the cursor */
    label: string;
}

/** A node of a line, by its line and its place along it */
interface NodeRef { line: string; vertex: number }

// --- what nodes snap to, kept while the scene is the same ------------------------------
let linesMemo: { inputs: unknown; editing: string | null; surfaces: unknown; hidden: ReadonlySet<string>; lines: SceneLine[] } | null = null;
/** Every line shown in the view or used by the open surface, whichever surface it is for: its nodes and where it crosses the slice are what new nodes snap to */
export function sceneLines(hidden: ReadonlySet<string>): SceneLine[] {
    const st = useModelStore.getState();
    const { inputs, surfaces } = st.scene;
    if (linesMemo && linesMemo.inputs === inputs && linesMemo.editing === st.editingId && linesMemo.surfaces === surfaces && linesMemo.hidden === hidden) return linesMemo.lines;
    const used = new Set(surfaces.find(s => s.id === st.editingId)?.uses?.map(u => u.set) ?? []);
    const lines = (inputs ?? []).flatMap(set => (set.kind === 'lines' && (!hidden.has(keys.inputs(set.id)) || used.has(set.id)) ? set.lines : []));
    linesMemo = { inputs, editing: st.editingId, surfaces, hidden, lines };
    return lines;
}
let contactsMemo: { sources: Float64Array[]; all: Float64Array } | null = null;
/** The logged contacts of every surface shown in the view that is built from the logging (world xyz triples) */
function sceneContacts(hidden: ReadonlySet<string>): Float64Array {
    const sources: Float64Array[] = [];
    for (const s of useModelStore.getState().scene.surfaces) {
        if (hidden.has(keys.surface(s.id)) || (s.rule.kind !== 'contact' && s.rule.kind !== 'body')) continue;
        const found = contactInputsFor(s)?.contacts;
        if (found && found.length >= 3) sources.push(found);
    }
    if (contactsMemo && contactsMemo.sources.length === sources.length && contactsMemo.sources.every((c, i) => c === sources[i])) return contactsMemo.all;
    const all = new Float64Array(sources.reduce((n, c) => n + c.length, 0));
    let k = 0;
    for (const c of sources) { all.set(c, k); k += c.length; }
    contactsMemo = { sources, all };
    return all;
}
let crossingMemo: { lines: SceneLine[]; key: string; world: Vec3[] } | null = null;
/** Where the scene's lines cross a plane (world): the marks other sections leave on this one */
function crossingsOf(plane: Plane, hidden: ReadonlySet<string>): Vec3[] {
    const lines = sceneLines(hidden);
    const key = `${plane.normal.join(',')}|${plane.point.join(',')}`;
    if (crossingMemo && crossingMemo.lines === lines && crossingMemo.key === key) return crossingMemo.world;
    const world = crossingsOn(lines, plane).map(c => c.p);
    crossingMemo = { lines, key, world };
    return world;
}

/** A dip reading's disc (with no reach of its own) is this share of the data's longest side, either way from its place ... */
const MARK_SHARE = 0.04;
/** ... and a ribbon's bar and a point's direction this many times as long (they are seen edge on, along the line) */
const BAR_TIMES = 2.5;
/** A line drawn freehand is kept to this many screen pixels of what the hand drew ... */
const DRAW_TOLERANCE_PX = 3;
/** ... as no more than this many nodes */
const MAX_FREEHAND_NODES = 24;
/** The handle on a picked disc's rim is taken within this many screen pixels of it */
const TURN_PX = 9;
/** ... and is there only when it is this many pixels clear of the disc's middle */
const TURN_CLEAR_PX = 16;
/** A drag shorter than this on screen is not a line, nor a disc */
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
    /** A disc being dragged out (stretches, local), and how far it reaches (m) */
    const discDraft = useRef<number[] | null>(null);
    const discReach = useRef(0);

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

    // Where the lines of other sections (and lines in space) cross the slice showing: marks to draw to
    const drawCrossings = useRef(() => {
        const vp = live.current.viewportRef.current, g = live.current.geometry;
        if (!vp) return;
        const local = live.current.shown && g ? live.current.slicePlane() : null;
        const normal = local && unit(local.normal);
        if (!g || !local || !normal) { vp.setTargetMarks(null); return; }
        const o3 = g.origin;
        const world = crossingsOf({ normal, point: [local.point[0] + o3[0], local.point[1] + o3[1], local.point[2] + o3[2]] }, live.current.hidden);
        const out = new Float32Array(world.length * 3);
        world.forEach((p, i) => { out[i * 3] = p[0] - o3[0]; out[i * 3 + 1] = p[1] - o3[1]; out[i * 3 + 2] = p[2] - o3[2]; });
        vp.setTargetMarks(out.length > 0 ? out : null);
    });
    useEffect(() => {
        const redraw = drawCrossings.current;
        const stop = o.liveClip?.subscribe(redraw);
        const viewport = o.viewportRef;
        return () => {
            stop?.();
            viewport.current?.setTargetMarks(null);
        };
    }, [o.liveClip, o.viewportRef]);

    /** Draws the handle on the rim of the one dip disc picked out (set while the surface is being edited) */
    const drawTurn = useRef<() => void>(() => undefined);
    // Its lines, the one pointed out (from the panel or the view) and the one being drawn
    const drawLines = useRef(() => {
        const vp = live.current.viewportRef.current, g = live.current.geometry;
        const s = editedSurface();
        if (!vp) return;
        drawCrossings.current();
        drawTurn.current();
        // The outline it is kept inside, as a closed loop
        const outline = s && s.params.extent === 'outline' ? s.params.outline : null;
        // How it lies where that was given (dip readings as discs, directions as bars), sized to the data
        const box = sceneDataBox();
        const size = box ? MARK_SHARE * Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2], 1) : 5;
        const marks = live.current.shown && s && g
            ? [
                ...readingDiscs(measuredPlaces(s.points, s.polylines), g.origin, size), ...ribbonBars(s.polylines, g.origin, BAR_TIMES * size),
                ...directionBars(s.points, g.origin, BAR_TIMES * size), ...(discDraft.current ?? []),
            ]
            : [];
        // A ring round each point and node picked out
        const picked = live.current.shown && s && g ? liveSelection(useEditSession.getState().selection, s) : null;
        if (picked && s && g && picked.points.length + picked.nodes.length > 0) {
            const at = new Map(s.points.map(p => [p.id, p.p]));
            const lines = new Map(s.polylines.map(l => [l.id, l.points]));
            const rings: number[] = [];
            for (const id of picked.points) { const p = at.get(id); if (p) rings.push(p[0] - g.origin[0], p[1] - g.origin[1], p[2] - g.origin[2]); }
            for (const n of picked.nodes) { const p = lines.get(n.line)?.[n.vertex]; if (p) rings.push(p[0] - g.origin[0], p[1] - g.origin[1], p[2] - g.origin[2]); }
            vp.setSelectedMarks(Float32Array.from(rings));
        } else {
            vp.setSelectedMarks(null);
        }
        if (!live.current.shown || !s || !g || (s.polylines.length === 0 && !draft.current && !outline && marks.length === 0)) {
            vp.setEditLines(null);
            vp.setLineNodes(null);
            return;
        }
        const signs = useModelCache.getState().byId[s.id]?.lineSigns ?? null;
        const { all, active } = editLineSegments(s.polylines, g.origin, signs, useModelStore.getState().hotLine, draft.current);
        // The outline is seen whole whatever the slices; the rest is at its place in space
        const free = outline ? stretches(localLine([...outline.points, outline.points[0]], g.origin)) : null;
        // (The furthest a mark reaches from its place: its size, or a reading's own reach)
        const reach = Math.max(BAR_TIMES * size, discReach.current, ...measuredPlaces(s.points, s.polylines).map(p => p.reading?.reach ?? 0));
        vp.setEditLines(all, active, free, Float32Array.from(marks), reach);
        // A square at every node of every line
        const nodes = lineNodes(s.polylines, g.origin);
        if (activeNode.current >= nodes.line.length) activeNode.current = -1;
        vp.setLineNodes(nodes.line.length > 0 ? { positions: nodes.positions, color: s.color, active: activeNode.current, quiet: !live.current.picking } : null);
    });
    const polylines = surface?.polylines, outline = surface?.params.outline, extent = surface?.params.extent;
    // (Other surfaces' lines: where they cross the slice)
    const inputs = useModelStore(s => s.scene.inputs);
    useEffect(() => {
        if (o.ready) drawLines.current();
    }, [o.ready, shown, picking, polylines, points, origin, lineSigns, outline, extent, color, inputs]);
    useEffect(() => {
        const redraw = drawLines.current;
        const stop = useModelStore.subscribe((s, prev) => { if (s.hotLine !== prev.hotLine) redraw(); });
        const stopPicks = useEditSession.subscribe((s, prev) => { if (s.selection !== prev.selection) redraw(); });
        const viewport = o.viewportRef;
        return () => {
            stop();
            stopPicks();
            viewport.current?.setEditLines(null);
            viewport.current?.setLineNodes(null);
            viewport.current?.setSelectedMarks(null);
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
            // (Not over the box a reading is being typed in)
            if (text === null || useEditSession.getState().entry) { label.style.display = 'none'; return; }
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
            // (Along a smooth line's curve: `segment` is a piece of the curve; stretchOfPlace gives its stretch between nodes)
            return pickLine(s.polylines.map(l => onScreen(localLine(shapeOf(l), g.origin)) ?? new Float32Array(0)), [x, y]);
        };

        /** The slice a line was drawn on, in the view's local coordinates and in the world's: its nodes stay on it. Null for a line in space */
        const planeOf = (line: ScenePolyline): { local: Plane; world: Plane } | null => {
            const g = live.current.geometry;
            const normal = line.plane ? unit(line.plane.normal) : null;
            if (!g || !normal || !line.plane) return null;
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
        /** The stretch of a vein's units at a place: down the hole pointed at, else the nearest to it (a vein that is one of a set) */
        const stretchUnder = (s: SurfaceObject, place: Placement): Zone | null => {
            const all = setInputsFor(s);
            if (!all) return null;
            const zones = zonesOf(all);
            const at = holeOf(place);
            return (at && at.depth !== null ? stretchAt(zones, at.hole, at.depth) : null) ?? stretchNear(zones, worldOf(place.local), STRETCH_NEAR);
        };
        const stretchOwner = (s: SurfaceObject, zone: Zone): string | null => stretchOwners([zone], veinsOfSet(model().scene.surfaces, s))[0];
        const snapOf = (p: Placement | null): ScenePoint['snap'] => {
            const at = p ? holeOf(p) : null;
            return at && at.depth !== null ? { hole: at.hole, depth: at.depth } : undefined;
        };
        /** Where the line of sight meets the nearest of the other surfaces shown (not the open one), if that place is in view */
        const surfaceHit = (x: number, y: number): { local: Vec3; name: string } | null => {
            const v = vp(), g = live.current.geometry;
            if (!v || !g) return null;
            const st = model(), fits = useModelCache.getState().byId;
            const ray = dataRay(v.screenRay(x, y), live.current.vex, g.origin);
            let best: { local: Vec3; name: string } | null = null, nearest = Infinity;
            for (const s of st.scene.surfaces) {
                const part = !live.current.hidden.has(keys.surface(s.id)) && s.id !== st.editingId ? fits[s.id]?.part : null;
                if (!part || part.triangles.length === 0 || !rayHitsBox(ray.origin, ray.dir, part.bounds)) continue;
                const hit = rayMesh(ray, part);
                if (!hit) continue;
                const d = Math.hypot(hit.point[0] - ray.origin[0], hit.point[1] - ray.origin[1], hit.point[2] - ray.origin[2]);
                if (d < nearest) {
                    nearest = d;
                    best = { local: [hit.point[0] - g.origin[0], hit.point[1] - g.origin[1], hit.point[2] - g.origin[2]], name: s.name };
                }
            }
            return best && live.current.visibleAt()(best.local[0], best.local[1], best.local[2]) ? best : null;
        };
        // The scene's nodes and contacts in the view's coordinates, kept while they are the same
        let nodesLocal: { lines: SceneLine[]; origin: unknown; local: Float32Array; refs: { line: SceneLine; vertex: number }[] } | null = null;
        let contactsLocal: { all: Float64Array; origin: unknown; local: Float32Array } | null = null;
        /**
         * Places near the cursor a node can snap to (snapTargets.ts): nodes of the scene's lines (those on `on`,
         * the plane being drawn on, when there is one) and where lines cross `on`; logged contacts and places on
         * the drillholes (`holes`); the other surfaces (`surface`). `skip`: nodes that are not targets (the one
         * being moved, the last of the line being built).
         */
        const snapTargets = (x: number, y: number, o: { on: Plane | null; holes: boolean; surface: boolean; skip: readonly NodeRef[] }): SnapTarget[] => {
            const g = live.current.geometry;
            if (!g) return [];
            const o3 = g.origin;
            const out: SnapTarget[] = [];
            const near = (xy: Float32Array | null, i: number, kind: SnapKind) =>
                !!xy && Math.hypot(xy[i * 2] - x, xy[i * 2 + 1] - y) <= SNAP_PX[kind];
            const on = o.on && unit(o.on.normal);
            const onPoint = o.on ? worldOf(o.on.point) : null;
            const offOn = (p: Vec3) => (on && onPoint ? Math.abs((p[0] - onPoint[0]) * on[0] + (p[1] - onPoint[1]) * on[1] + (p[2] - onPoint[2]) * on[2]) : 0);
            // Nodes of lines
            const lines = sceneLines(live.current.hidden);
            if (!nodesLocal || nodesLocal.lines !== lines || nodesLocal.origin !== o3) {
                const refs = lines.flatMap(line => line.points.map((_, vertex) => ({ line, vertex })));
                const local = new Float32Array(refs.length * 3);
                refs.forEach(({ line, vertex }, i) => { const p = line.points[vertex]; local[i * 3] = p[0] - o3[0]; local[i * 3 + 1] = p[1] - o3[1]; local[i * 3 + 2] = p[2] - o3[2]; });
                nodesLocal = { lines, origin: o3, local, refs };
            }
            const nodeXy = nodesLocal.refs.length > 0 ? onScreen(nodesLocal.local) : null;
            nodesLocal.refs.forEach(({ line, vertex }, i) => {
                if (!near(nodeXy, i, 'node') || o.skip.some(k => k.line === line.id && k.vertex === vertex)) return;
                const p = line.points[vertex];
                if (offOn(p) > ON_PLANE_M) return;
                const snap = line.nodes?.[vertex]?.snap;
                out.push({ kind: 'node', x: nodeXy![i * 2], y: nodeXy![i * 2 + 1], local: [p[0] - o3[0], p[1] - o3[1], p[2] - o3[2]], place: null, ...(snap ? { snap } : {}), label: SNAP_NAMES.node });
            });
            // Where lines cross the plane drawn on
            if (on && onPoint) {
                const world = crossingsOf({ normal: on, point: onPoint }, live.current.hidden);
                const local = Float32Array.from(world.flatMap(p => [p[0] - o3[0], p[1] - o3[1], p[2] - o3[2]]));
                const xy = world.length > 0 ? onScreen(local) : null;
                world.forEach((p, i) => {
                    if (near(xy, i, 'crossing')) out.push({ kind: 'crossing', x: xy![i * 2], y: xy![i * 2 + 1], local: [p[0] - o3[0], p[1] - o3[1], p[2] - o3[2]], place: null, label: SNAP_NAMES.crossing });
                });
            }
            if (o.holes) {
                // Logged contacts
                const all = sceneContacts(live.current.hidden);
                if (!contactsLocal || contactsLocal.all !== all || contactsLocal.origin !== o3) {
                    const local = new Float32Array(all.length);
                    for (let i = 0; i < all.length; i += 3) { local[i] = all[i] - o3[0]; local[i + 1] = all[i + 1] - o3[1]; local[i + 2] = all[i + 2] - o3[2]; }
                    contactsLocal = { all, origin: o3, local };
                }
                const xy = all.length > 0 ? onScreen(contactsLocal.local) : null;
                for (let i = 0; i * 3 < all.length; i++) {
                    if (near(xy, i, 'contact')) out.push({ kind: 'contact', x: xy![i * 2], y: xy![i * 2 + 1], local: [all[i * 3] - o3[0], all[i * 3 + 1] - o3[1], all[i * 3 + 2] - o3[2]], place: null, label: SNAP_NAMES.contact });
                }
                // The drillhole under the cursor (an edge or the middle of a sample, or anywhere along it)
                const place = resolve(x, y, false);
                if (place) out.push({ kind: placementKind(place.kind), x, y, local: [place.local[0], place.local[1], place.local[2]], place, snap: snapOf(place), label: describe(place) });
            }
            if (o.surface) {
                const hit = surfaceHit(x, y);
                if (hit) out.push({ kind: 'surface', x, y, local: hit.local, place: null, label: `On ${hit.name}` });
            }
            return out;
        };
        /**
         * Where a node lands at this pixel: on what it snaps to near the cursor (snapTargets.ts: another node, where
         * a line of another section crosses, a logged contact, a drillhole when nodes go on them or `always`, another
         * surface with `surface`), else on `plane`. `free`: the line is in space (its nodes need not be on `plane`,
         * which is only where they land when nothing else is near). `place`: the drillhole it landed on.
         */
        const nodePlace = (x: number, y: number, plane: Plane | null, opts: { always?: boolean; skip?: readonly NodeRef[]; free?: boolean; surface?: boolean } = {}): SnapTarget | null => {
            const targets = snapTargets(x, y, { on: opts.free ? null : plane, holes: !!opts.always || model().snapNodes, surface: !!opts.surface, skip: opts.skip ?? [] });
            const local = plane ? onPlane(x, y, plane) : null;
            if (local) targets.push({ kind: 'plane', x, y, local, place: null, label: SNAP_NAMES.plane });
            return pickSnap(targets, [x, y]);
        };
        /** The plane across the screen through a place (local): where something dragged off the holes and off any slice moves */
        const screenPlane = (through: Vec3): Plane | null => {
            const v = vp();
            if (!v) return null;
            const f = v.viewDirection();
            return { normal: [f[0], f[1], f[2] * live.current.vex], point: through };
        };
        /** What is known of each node of a line, one entry a node */
        const nodesOf = (line: ScenePolyline): (LineNode | null)[] => Array.from({ length: line.points.length }, (_, i) => line.nodes?.[i] ?? null);
        /** The normal of the slice showing now: a point placed with a slice on marks a surface that crosses it */
        const acrossNow = (): Vec3 | undefined => {
            const plane = live.current.slicePlane();
            return (plane && unit(plane.normal)) ?? undefined;
        };
        /** Pick out points and nodes: these alone, or with Shift added (or taken back out, if all of them already are) */
        const pickOut = (shift: boolean, picks: Parameters<ReturnType<typeof useEditSession.getState>['select']>[1]) => {
            const s = editedSurface();
            if (!s) return;
            const mode: SelectMode = shift ? 'toggle' : 'replace';
            useEditSession.getState().select(s.id, picks, mode);
        };
        /** The box to type a dip reading in, beside where the click was, kept inside the view */
        const openEntryAt = (x: number, y: number, target: Pick<ReadingEntryTarget, 'point' | 'node'>) => {
            const s = editedSurface();
            if (!s) return;
            useEditSession.getState().openEntry({
                surface: s.id, ...target,
                x: Math.max(4, Math.min(x + 14, el.clientWidth - READING_ENTRY_WIDTH - 4)),
                y: Math.max(4, Math.min(y + 14, el.clientHeight - 120)),
            });
        };
        /**
         * The last click on a dot or a node (or the dot it put down): a second one on it, soon after, is a double-click.
         * (Timed by when the clicks were made, not when they are got to: the first one's work can hold up the second)
         */
        let lastClick: { key: string; x: number; y: number; t: number } | null = null;
        const isDouble = (key: string, x: number, y: number, now: number): boolean => {
            const twice = !!lastClick && lastClick.key === key && now - lastClick.t < DOUBLE_MS && Math.hypot(x - lastClick.x, y - lastClick.y) < DOUBLE_PX;
            lastClick = twice ? null : { key, x, y, t: now };
            return twice;
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
            /** Null: the line is drawn on the other surfaces shown (no slice is on), as a line in space */
            plane: { local: Plane; world: Plane } | null; lineId: string | null; atStart: boolean; first: Vec3;
            /** The drillhole the first node was put on, if it was */
            firstSnap?: ScenePoint['snap'];
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
        /** Where the next node of the line being built would go (on what it snaps to, else on its slice or a surface) */
        const buildPlace = (x: number, y: number): SnapTarget | null => {
            if (!building) return null;
            const line = builtLine();
            // (Not onto the node it joins)
            const skip = line ? [{ line: line.id, vertex: building.atStart ? 0 : line.points.length - 1 }] : [];
            return building.plane ? nodePlace(x, y, building.plane.local, { skip }) : nodePlace(x, y, null, { surface: true, free: true, skip });
        };
        /** From the last node to the cursor (`at`: where the next node would go, when that is known) */
        const rubberBand = (x: number, y: number, at: SnapTarget | null = buildPlace(x, y)) => {
            const from = tail();
            const to = at?.local ?? null;
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
            const at = buildPlace(x, y);
            if (!at) return;
            const local = at.local, p = worldOf(local);
            const node: LineNode | null = at.snap ? { snap: at.snap } : null;
            const line = builtLine();
            if (line) {
                const had = nodesOf(line);
                model().updatePolyline(s.id, line.id, {
                    points: building.atStart ? [p, ...line.points] : [...line.points, p],
                    ...(node || line.nodes ? { nodes: building.atStart ? [node, ...had] : [...had, node] } : {}),
                    // A node off the line's slice (on a drillhole): the line is held to the slice no longer
                    ...(line.plane && !liesOn([p], line.plane) ? { plane: null } : {}),
                });
            } else if (building.lineId) {
                // The line has gone (undone): a new one starts here
                building = { ...building, lineId: null, atStart: false, first: local, firstSnap: at.snap };
            } else {
                // Two nodes make a line (a click on top of the first node does not)
                const first = worldOf(building.first);
                const id = model().addPolyline(s.id, {
                    points: [first, p], plane: building.plane && liesOn([first, p], building.plane.world) ? building.plane.world : null,
                    ...(building.plane ? { across: building.plane.world.normal } : {}),
                    ...(useEditSession.getState().drawSmooth ? { smooth: true } : {}),
                    ...(building.firstSnap || node ? { nodes: [building.firstSnap ? { snap: building.firstSnap } : null, node] } : {}),
                });
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
                // (What the next node would snap to: another node, where a line crosses, a contact, a drillhole, a surface)
                const at = buildPlace(x, y);
                const snapped = at && at.kind !== 'plane' ? at : null;
                v.setSnapMarker(snapped ? snapped.local : building.lineId ? null : building.first, s.color);
                rubberBand(x, y, at);
                say(snapped ? `${snapped.label} · click to put the next node here`
                    : building.plane ? 'Click for the next node · double-click or Enter ends the line'
                        : 'Point at a surface for the next node · double-click or Enter ends the line', x, y);
                return;
            }
            // (The handle keeps to the disc's edge as the view turns)
            drawTurn.current();
            if (turnAt(x, y)) {
                showHandles(-1);
                showNode(-1);
                pointOut(null);
                v.setSnapMarker(null);
                el.style.cursor = 'grab';
                say('Drag to turn the disc: its dip and dip direction follow', x, y);
                return;
            }
            const h = handleAt(x, y);
            if (h >= 0) {
                showHandles(h);
                showNode(-1);
                pointOut(null);
                v.setSnapMarker(null);
                el.style.cursor = 'grab';
                say('Click to pick it out (Shift: as well) · drag to move · right-click to remove', x, y);
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
                if (model().pendingReading) { say('Click to put the dip measurement on this node', x, y); return; }
                say(end && live.current.drawing
                    ? 'Drag to move this node · click to carry the line on · right-click removes it'
                    : 'Click to pick it out (Shift: as well) · drag to move · right-click removes it', x, y);
                return;
            }
            showNode(-1);
            el.style.cursor = 'crosshair';
            const on = lineAt(x, y);
            if (on) {
                const line = s.polylines[on.line];
                pointOut(line.id);
                v.setSnapMarker(null);
                say(`Click to put a node here · Shift-click picks out all its nodes · right-click removes the line${isOrientedLine(line) ? ' · R turns it over' : ''}`, x, y);
                return;
            }
            pointOut(null);
            if (live.current.drawing) {
                // Drawing: clicks make lines, not points
                const plane = drawPlane();
                if (plane) {
                    // (What the first node would snap to)
                    const at = nodePlace(x, y, plane.local);
                    const snapped = at && at.kind !== 'plane' ? at : null;
                    v.setSnapMarker(snapped ? snapped.local : null, s.color);
                    say(snapped ? `${snapped.label} · click to start a line here` : 'Click to start a line, node by node · or drag to draw it freehand', x, y);
                    return;
                }
                // No slice: lines are drawn on the other surfaces shown
                const hit = surfaceHit(x, y);
                v.setSnapMarker(hit ? hit.local : null, s.color);
                say(hit ? `On ${hit.name} · click to start a line on it, or drag to draw it freehand` : 'Turn on Slice to draw on it, or point at another surface to draw on that', x, y);
                return;
            }
            const place = resolve(x, y, true);
            v.setSnapMarker(place ? place.local : null, s.color);
            const marking = model().marking;
            if (marking === 'take') {
                // Taking stretches: what a click here would give this vein
                const zone = place ? stretchUnder(s, place) : null;
                const has = zone ? stretchOwner(s, zone) : null;
                say(!place ? null : !zone ? 'No stretch of its units here: point at one down a hole'
                    : has === s.id ? `${zone.hole}, ${stretchDepths(zone)} · this vein's already`
                        : `${zone.hole}, ${stretchDepths(zone)} · click: this stretch becomes this vein's${has ? ` (it is ${model().scene.surfaces.find(o => o.id === has)?.name ?? 'another vein'}'s now)` : ''}`, x, y);
                return;
            }
            const sideName = marking ? s.sides?.[marking === 1 ? 0 : 1] ?? (marking === 1 ? 'first' : 'second') : null;
            say(place ? (sideName ? `${describe(place)} · click: this place is on the ${sideName} side of the surface` : describe(place)) : null, x, y);
        };
        const quiet = () => {
            pending = null;
            vp()?.setSnapMarker(null);
            say(null);
        };

        /** A click: a point on the hole, sample or slice under the cursor. Its id (null: none was put down) */
        const placeAt = (x: number, y: number, row = false): string | null => {
            const place = resolve(x, y, true);
            return place ? placeHere(place, undefined, row) : null;
        };
        /** A point put down at a place, with a dip reading if one is given or waiting for its place */
        const placeHere = (place: Placement, given?: PointReading, row = false): string | null => {
            const s = editedSurface(), v = vp();
            if (!s || !v) return null;
            // Marking: the click says the surface passes on one side of this place, it is no point of the surface
            const side = model().marking;
            if (side === 'take') {
                // Taking stretches: the click gives the stretch of its units here to this vein, it is no point of the surface
                const zone = stretchUnder(s, place);
                if (zone) giveStretchTo(s, zone, s.id);
                return null;
            }
            if (side && (s.rule.kind === 'contact' || s.rule.kind === 'body')) {
                // Held as far clear as the panel says; with Shift, a row of places from the last one marked on this side to here
                const p = worldOf(place.local), by = model().markBy ?? undefined, along = model().markAlong ?? undefined;
                const from = row ? lastMark(s.rule, side) : null;
                model().updateSurface(s.id, { rule: from ? withMarkRow(s.rule, from.p, p, side, by ?? from.by, along ?? from.along).rule : withMark(s.rule, p, side, by, along).rule });
                return null;
            }
            if (s.points.length < 2 && s.polylines.length === 0) {
                // Until three points fix a plane, the surface runs straight into the screen through them
                const f = v.viewDirection();
                const along = unit([f[0], f[1], f[2] / live.current.vex]);
                if (along) model().updateSurface(s.id, { along });
            }
            // A dip reading waiting for its place goes with this point
            const pending = model().pendingReading;
            const reading = given ?? pending;
            const had = new Set(s.points.map(p => p.id));
            model().addPoints(s.id, [{ p: worldOf(place.local), snap: snapOf(place), across: acrossNow(), ...(reading ? { reading } : {}) }]);
            if (pending && !given) model().setPendingReading(null);
            return editedSurface()?.points.find(p => !had.has(p.id))?.id ?? null;
        };

        // --- gestures taken from the camera ---------------------------------------------
        /** A dot pressed: it moves once the cursor has (else the press was a click, and picks it out) */
        let drag: { pointer: number; pointId: string; index: number; start: Vec3; x0: number; y0: number; moved: boolean } | null = null;
        /**
         * A node of a line being dragged (`end`: it is the line's first or last). `held`: the slice the line was on
         * when the drag began, local and world (null: a line in space); `start`: where the node was (local).
         */
        let nodeDrag: {
            pointer: number; lineId: string; vertex: number; held: { local: Plane; world: Plane } | null; start: Vec3; x0: number; y0: number; moved: boolean; end: boolean;
            /** The node was put in by this press (a click on the line between nodes) */
            added?: boolean;
        } | null = null;
        /**
         * A disc being dragged out with Ctrl from where it is put (`centre`, local): the plane through the drag and the
         * line of sight (null until there is one)
         */
        let disc: { pointer: number; x0: number; y0: number; moved: boolean; place: Placement; centre: Vec3; result: ReturnType<typeof planeFromDrag> } | null = null;
        /** The picked disc being turned by the handle on its rim: what it would read now (null: the drag gives no plane) */
        let turning: (Turnable & { pointer: number; result: PointReading | null; grip: Vec3 }) | null = null;
        /** A freehand line being drawn (if the button comes up where it went down, a click: the first node of a line) */
        let stroke: {
            pointer: number; x0: number; y0: number; moved: boolean;
            /** Null: drawn on the other surfaces shown (no slice is on) */
            plane: { local: Plane; world: Plane } | null; local: number[];
        } | null = null;
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
        const discTo = (x: number, y: number) => {
            const v = vp();
            if (!disc || !v) return;
            const c = disc.centre;
            const across = screenPlane(c);
            const end = across ? onPlane(x, y, across) : null;
            if (!end) return;
            // In true metres: the view's z is drawn exaggerated, the places are not
            const drag: Vec3 = [end[0] - c[0], end[1] - c[1], end[2] - c[2]];
            const view = trueDirection(v.viewDirection(), live.current.vex);
            disc.result = view ? planeFromDrag(drag, view) : null;
            const line = [c[0], c[1], c[2], end[0], end[1], end[2]];
            discDraft.current = disc.result ? readingDisc(c, disc.result.reading, disc.result.reach, line) : line;
            discReach.current = disc.result?.reach ?? Math.hypot(drag[0], drag[1], drag[2]);
            drawLines.current();
            say(disc.result ? `${formatReading(disc.result.reading)} · let go to place it` : 'Along the line of sight: drag across the view', x, y);
        };
        /**
         * The one place picked out whose dip reading can be turned: a point, or a ticked node of a line, that has a
         * reading. Its handle is on the rim of its disc, where the disc meets the plane of the screen through its
         * middle: seen edge on, at the end of the line the disc is seen as.
         */
        const turnable = (): Turnable | null => {
            const s = editedSurface(), g = live.current.geometry, v = vp();
            if (!s || !g || !v || !live.current.shown || live.current.drawing || building) return null;
            const picked = liveSelection(useEditSession.getState().selection, s);
            if (picked.points.length + picked.nodes.length !== 1) return null;
            let world: ArrayLike<number> | undefined, reading: PointReading | undefined, id = '';
            let keep: (r: PointReading) => void = () => undefined;
            if (picked.points.length === 1) {
                const p = s.points.find(q => q.id === picked.points[0]);
                world = p?.p; reading = p?.reading; id = p?.id ?? '';
                keep = r => model().setPointReading(s.id, id, r);
            } else {
                const n = picked.nodes[0];
                const line = s.polylines.find(l => l.id === n.line);
                world = line?.points[n.vertex]; reading = line?.nodes?.[n.vertex]?.reading; id = n.line;
                keep = r => model().setNodeReading(s.id, n.line, n.vertex, r);
            }
            if (!world || !reading) return null;
            const centre: Vec3 = [world[0] - g.origin[0], world[1] - g.origin[1], world[2] - g.origin[2]];
            const box = sceneDataBox();
            const size = box ? MARK_SHARE * Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2], 1) : 5;
            const radius = reading.reach && reading.reach > 0 ? reading.reach : size;
            const { strike, down } = readingAxes(reading);
            const n = [strike[1] * down[2] - strike[2] * down[1], strike[2] * down[0] - strike[0] * down[2], strike[0] * down[1] - strike[1] * down[0]];
            const look = trueDirection(v.viewDirection(), live.current.vex);
            // (Seen face on there is no such line: the end of its strike bar)
            const d = (look && unit([n[1] * look[2] - n[2] * look[1], n[2] * look[0] - n[0] * look[2], n[0] * look[1] - n[1] * look[0]])) ?? strike;
            const grip: Vec3 = [centre[0] + radius * d[0], centre[1] + radius * d[1], centre[2] + radius * d[2]];
            // (A disc too small on screen for its edge to be told from its middle has no handle: the place itself is what is taken there)
            const [cx, cy] = v.projectPoint(centre), [gx, gy] = v.projectPoint(grip);
            if (!(Math.hypot(gx - cx, gy - cy) >= TURN_CLEAR_PX)) return null;
            return { id, centre, reading, radius, keep, grip };
        };
        /** The disc whose handle is under the cursor (null: none) */
        const turnAt = (x: number, y: number): Turnable | null => {
            const t = turnable(), v = vp();
            if (!t || !v || !live.current.visibleAt()(t.centre[0], t.centre[1], t.centre[2])) return null;
            const [hx, hy] = v.projectPoint(t.grip);
            return Math.hypot(hx - x, hy - y) <= TURN_PX ? t : null;
        };
        drawTurn.current = () => {
            const v = vp();
            if (!v) return;
            const t = turning ?? turnable();
            v.setTurnHandle(t && live.current.visibleAt()(t.centre[0], t.centre[1], t.centre[2]) ? t.grip : null);
        };
        /** The handle dragged to here: the disc turns about its middle, as it was dragged out when made; its reach stays */
        const turnTo = (x: number, y: number) => {
            const v = vp();
            if (!turning || !v) return;
            const c = turning.centre;
            const across = screenPlane(c);
            const end = across ? onPlane(x, y, across) : null;
            if (!end) return;
            const pull: Vec3 = [end[0] - c[0], end[1] - c[1], end[2] - c[2]];
            const look = trueDirection(v.viewDirection(), live.current.vex);
            const plane = look ? planeFromDrag(pull, look) : null;
            turning.result = plane ? cleanReading({ ...turning.reading, dip: plane.reading.dip, dipDirection: plane.reading.dipDirection }) : null;
            const d = unit(pull);
            if (d) turning.grip = [c[0] + turning.radius * d[0], c[1] + turning.radius * d[1], c[2] + turning.radius * d[2]];
            const line = [c[0], c[1], c[2], turning.grip[0], turning.grip[1], turning.grip[2]];
            discDraft.current = turning.result ? readingDisc(c, turning.result, turning.radius, line) : line;
            drawLines.current();
            say(turning.result ? `${formatReading(turning.result)} · let go to keep it` : 'Along the line of sight: drag across the view', x, y);
        };
        const nodeDragTo = (x: number, y: number) => {
            const s = editedSurface();
            if (!nodeDrag || !s) return;
            const line = s.polylines.find(l => l.id === nodeDrag!.lineId);
            const v = vp();
            if (!line || !v || nodeDrag.vertex >= line.points.length) return;
            const { held, vertex } = nodeDrag;
            // On its slice it stays there, unless it snaps to something off it (a drillhole when nodes go on them, a
            // contact). A node of a line in space moves as a point does: onto a drillhole or another surface, or across
            // the screen at the depth it started at. Either snaps to the other nodes and where lines cross its slice
            const skip = [{ line: nodeDrag.lineId, vertex }];
            const across = held ? null : screenPlane(nodeDrag.start);
            const at = held ? nodePlace(x, y, held.local, { skip }) : across ? nodePlace(x, y, across, { always: true, free: true, surface: true, skip }) : null;
            if (!at) return;
            const points = withNodeAt(line.points, vertex, worldOf(at.local));
            const had = nodesOf(line);
            // (What else it knows, its dip reading and its direction, goes with it)
            const node: LineNode | null = at.snap ? { ...(had[vertex] ?? {}), snap: at.snap } : had[vertex];
            // A line is held to its slice until a node of it is taken off (onto a drillhole). (Only this node is asked:
            // the nodes of a line from a file lie near its slice, not on it.)
            const plane = held && liesOn([points[vertex]], held.world) ? held.world : null;
            model().updatePolyline(s.id, line.id, {
                points,
                ...(at.snap ? { nodes: had.map((n, i) => (i === vertex ? node : n)) } : {}),
                ...(held ? { plane } : {}),
            });
            v.setSnapMarker(at.kind !== 'plane' ? at.local : null, s.color);
            if (at.kind !== 'plane') say(at.label, x, y);
            else say(null);
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
                    // The hand's jitter out: what is left is the line's nodes, straight between them, or as few as a smooth
                    // curve through them needs to follow the stroke
                    const tolerance = DRAW_TOLERANCE_PX / Math.max(perMetre, 1e-9);
                    const smooth = useEditSession.getState().drawSmooth;
                    const nodes = smooth ? fitSmoothNodes(world, tolerance, MAX_FREEHAND_NODES) : simplifyLine(world, tolerance, MAX_FREEHAND_NODES);
                    model().addPolyline(s.id, { points: nodes, plane: done.plane?.world ?? null, ...(smooth ? { smooth: true } : {}) });
                }
            }
            drawLines.current();
        };

        const onPointerDown = (e: PointerEvent) => {
            if (!(e.target instanceof HTMLCanvasElement) || !e.isPrimary) return;
            // A press in the view puts away a box for typing a reading
            if (useEditSession.getState().entry) useEditSession.getState().openEntry(null);
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
            // The handle on the picked disc's rim: dragged, it turns the disc
            const turn = e.button === 0 && s ? turnAt(x, y) : null;
            if (turn && s) {
                take();
                if (lockedInputs(model().scene, s)?.has(turn.id)) { say('In a locked set: unlock it under Points and lines to change it', x, y); return; }
                el.setPointerCapture(e.pointerId);
                el.style.cursor = 'grabbing';
                turning = { ...turn, pointer: e.pointerId, result: null };
                return;
            }
            const h = handleAt(x, y);
            // What is in a locked set stays as it is
            const locked = s ? lockedInputs(model().scene, s) : null;
            const held = (id: string) => {
                if (!locked?.has(id)) return false;
                take();
                say('In a locked set: unlock it under Points and lines to change it', x, y);
                return true;
            };
            if (h >= 0 && s && g && button) {
                if (held(s.points[h].id)) return;
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
                drag = { pointer: e.pointerId, pointId: s.points[h].id, index: h, start: [p[0] - g.origin[0], p[1] - g.origin[1], p[2] - g.origin[2]], x0: e.clientX, y0: e.clientY, moved: false };
                el.setPointerCapture(e.pointerId);
                el.style.cursor = 'grabbing';
                showHandles(h);
                say(null);
                return;
            }
            const n = s && g && button ? nodeAt(x, y) : null;
            if (n && s) {
                if (held(n.line.id)) return;
                take();
                if (e.button === 2) { removing = { node: { line: n.line.id, vertex: n.vertex } }; blockMenu = true; return; }
                const waiting = model().pendingReading;
                if (waiting) {
                    // A reading waiting for its place: it was taken at this node (a dip tick)
                    model().setNodeReading(s.id, n.line.id, n.vertex, waiting);
                    model().setPendingReading(null);
                    return;
                }
                const q = n.line.points[n.vertex];
                nodeDrag = {
                    pointer: e.pointerId, lineId: n.line.id, vertex: n.vertex, held: planeOf(n.line), start: [q[0] - g!.origin[0], q[1] - g!.origin[1], q[2] - g!.origin[2]],
                    x0: e.clientX, y0: e.clientY, moved: false,
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
                if (held(line.id)) return;
                take();
                if (e.button === 2) { removing = { line: line.id }; blockMenu = true; return; }
                // Shift: all its nodes are picked out (or taken back out)
                if (e.shiftKey) { pickOut(true, { nodes: nodesOfLines([line]) }); return; }
                // A press on a line between two nodes puts a node there, and it can be dragged at once
                const plane = planeOf(line);
                // (A line in space: where the line of sight passes the stretch, on the plane across the screen through its start.
                // A smooth line: on its curve, between the two nodes either side)
                const path = shapeOf(line);
                const a = path[on.segment];
                const across = plane ? null : screenPlane([a[0] - g!.origin[0], a[1] - g!.origin[1], a[2] - g!.origin[2]]);
                const hit = plane ? onPlane(x, y, plane.local) : across ? onPlane(x, y, across) : null;
                if (!hit) return;
                const node = nearestOnStretch(a, path[on.segment + 1], worldOf(hit));
                const stretch = stretchOfPlace(line, on.segment);
                model().updatePolyline(s.id, line.id, { points: withNode(line.points, stretch, node) });
                const after = editedSurface()?.polylines.find(l => l.id === line.id);
                // (On top of a node that was there: nothing was added)
                if (!after || after.points.length !== line.points.length + 1) return;
                nodeDrag = {
                    pointer: e.pointerId, lineId: line.id, vertex: stretch + 1, held: plane, start: [node[0] - g!.origin[0], node[1] - g!.origin[1], node[2] - g!.origin[2]],
                    x0: e.clientX, y0: e.clientY, moved: false, end: false, added: true,
                };
                el.setPointerCapture(e.pointerId);
                el.style.cursor = 'grabbing';
                say(null);
                return;
            }
            // Ctrl+drag (not while drawing): a point with a dip reading, dragged out as a disc
            if (e.button === 0 && (e.ctrlKey || e.metaKey) && !live.current.drawing && s && g) {
                const place = resolve(x, y, true);
                if (place) {
                    take();
                    el.setPointerCapture(e.pointerId);
                    disc = { pointer: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, place, centre: [place.local[0], place.local[1], place.local[2]], result: null };
                    quiet();
                    return;
                }
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
            // Drawing with no slice: on the other surfaces shown, as a line in space
            const onSurface = e.button === 0 && s && g && live.current.drawing && !plane ? surfaceHit(x, y) : null;
            if (onSurface) {
                take();
                el.setPointerCapture(e.pointerId);
                stroke = { pointer: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, plane: null, local: [...onSurface.local] };
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
                if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 4) drag.moved = true;
                if (drag.moved) schedule(() => dragTo(x, y));
            } else if (turning) {
                if (e.pointerId !== turning.pointer) return;
                e.stopPropagation();
                schedule(() => turnTo(x, y));
            } else if (disc) {
                if (e.pointerId !== disc.pointer) return;
                e.stopPropagation();
                if (!disc.moved && Math.hypot(e.clientX - disc.x0, e.clientY - disc.y0) > MIN_LINE_PX) disc.moved = true;
                if (disc.moved) schedule(() => discTo(x, y));
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
                // (On a surface: off it, the stroke waits until it is back on)
                const p = stroke.plane ? onPlane(x, y, stroke.plane.local) : surfaceHit(x, y)?.local ?? null;
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
                const done = drag;
                drag = null;
                // Not moved: a click, which picks the point out; Alt+click or a double-click opens its dip reading to type
                if (!done.moved && e.type === 'pointerup') {
                    const twice = isDouble(`p:${done.pointId}`, x, y, e.timeStamp) && !live.current.drawing;
                    if (e.altKey || twice) openEntryAt(x, y, { point: done.pointId });
                    else pickOut(e.shiftKey, { points: [done.pointId] });
                }
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
                // (A line in space is carried on over the slice showing now: its new nodes land there, or on drillholes;
                // with no slice, on the other surfaces shown)
                const carry = !!line && !done.moved && done.end && live.current.drawing && e.type === 'pointerup';
                const plane = carry && line ? planeOf(line) ?? drawPlane() : null;
                if (carry && (plane || !live.current.slicePlane())) building = { plane, lineId: done.lineId, atStart: done.vertex === 0, first: [0, 0, 0], last: { x, y, t: performance.now() } };
                // Else a click on a node picks it out
                else if (line && !done.moved && !done.added && e.type === 'pointerup') {
                    const node = { line: line.id, vertex: done.vertex, of: line.points.length };
                    const twice = isDouble(`n:${line.id}:${done.vertex}`, x, y, e.timeStamp) && !live.current.drawing;
                    if (e.altKey || twice) openEntryAt(x, y, { node });
                    else pickOut(e.shiftKey, { nodes: [node] });
                }
                vp()?.setSnapMarker(null);
                hover(x, y);
                return;
            }
            if (turning) {
                if (e.pointerId !== turning.pointer) return;
                e.stopPropagation();
                flush();
                if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
                const done = turning;
                turning = null;
                discDraft.current = null;
                el.style.cursor = 'crosshair';
                // (One change to the scene: one step to undo)
                if (e.type === 'pointerup' && done.result) done.keep(done.result);
                drawLines.current();
                hover(x, y);
                return;
            }
            if (disc) {
                if (e.pointerId !== disc.pointer) return;
                e.stopPropagation();
                flush();
                if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
                const done = disc;
                disc = null;
                discDraft.current = null;
                discReach.current = 0;
                drawLines.current();
                if (e.type !== 'pointerup') return;
                // A drag that gave no plane (along the line of sight) puts down a plain point, and says why
                placeHere(done.place, done.moved && done.result ? done.result.reading : undefined);
                if (done.moved && !done.result) { say('Dragged along the line of sight: placed as a point with no dip measurement', x, y); return; }
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
                    // (The first node goes on what it snaps to: another node, where a line crosses, a drillhole, ...)
                    const at = done.plane ? nodePlace(x, y, done.plane.local) : nodePlace(x, y, null, { surface: true, free: true });
                    building = {
                        plane: done.plane, lineId: null, atStart: false, first: at ? at.local : [done.local[0], done.local[1], done.local[2]], firstSnap: at?.snap,
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
            if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4 || e.ctrlKey || e.metaKey) return;
            // (Shift+click means something only while places are marked on a side: a row from the last place to this one)
            const marks = model().marking === 1 || model().marking === -1;
            if (e.shiftKey && !marks) return;
            const id = placeAt(x, y, e.shiftKey);
            // Alt+click: its dip reading to type at once; a click on it again soon after (a double-click) does the same
            if (id && e.altKey) openEntryAt(x, y, { point: id });
            else if (id) lastClick = { key: `p:${id}`, x, y, t: e.timeStamp };
            hover(x, y);
        };
        const onContextMenu = (e: MouseEvent) => {
            if (!blockMenu) return;
            blockMenu = false;
            e.preventDefault();
        };
        const busy = () => !!(drag || nodeDrag || stroke || press || disc || turning);
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
            // R turns the line under the cursor over (the surface's two sides swap along it)
            if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !e.altKey && hoverLine && !busy() && !building) {
                const s = editedSurface();
                const line = s?.polylines.find(l => l.id === hoverLine);
                if (!s || !line || !isOrientedLine(line)) return;
                e.preventDefault();
                e.stopPropagation();
                model().updatePolyline(s.id, line.id, { flipped: !line.flipped });
                return;
            }
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
            if (turning) {
                pending = null;
                if (el.hasPointerCapture(turning.pointer)) el.releasePointerCapture(turning.pointer);
                turning = null;
                discDraft.current = null;
                drawLines.current();
                say(null);
                return;
            }
            if (disc) {
                pending = null;
                if (el.hasPointerCapture(disc.pointer)) el.releasePointerCapture(disc.pointer);
                disc = null;
                discDraft.current = null;
                discReach.current = 0;
                drawLines.current();
                say(null);
                return;
            }
            // What is picked out is let go first
            const picked = useEditSession.getState().selection;
            if (picked.points.length + picked.nodes.length > 0) {
                useEditSession.getState().clearSelection();
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
            for (const held of [stroke, press, nodeDrag, drag, disc, turning]) if (held && el.hasPointerCapture(held.pointer)) el.releasePointerCapture(held.pointer);
            stroke = null;
            disc = null;
            turning = null;
            drawTurn.current = () => undefined;
            vp()?.setTurnHandle(null);
            discDraft.current = null;
            discReach.current = 0;
            useEditSession.getState().openEntry(null);
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
