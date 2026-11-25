/**
 * The places and links put on a surface by hand, in the 3D view (Phase 307): drawn while the surface is open for
 * editing, or picked alone in the tree or the Scene list (smaller then); each a dot (a link its line with a dot at
 * each end) in its side's colour, a size on the screen whatever the zoom, cut by the slices as the data are.
 *
 *  - pointed at: drawn larger, and a label says what it is;
 *  - a click picks it (Ctrl: adds it or takes it back out; a surface not open for editing is opened);
 *  - Shift+drag: a box, and what is in it is added to the picks; Shift+click on a control adds it (or takes it out);
 *  - a click on empty ground, or Esc, lets go of the picks;
 *  - open for editing, a place or one end of a link is dragged to where it should be: onto a hole (snapped to the
 *    sample under the cursor, its edge or its middle), else onto the slice, else in the plane of the screen; a link's
 *    line dragged moves the whole link (and every other picked with it). Esc while dragging puts it back. The change
 *    is one step back, and the surface is fitted again when the drag ends, not while it goes on;
 *  - Delete removes what is picked (with the cursor over the view, or the view's own keys).
 *
 * The listeners are on the window, in the capture phase, so they come before the camera and the editing of the
 * surface's points: a press on a control is taken from both, any other is passed on untouched.
 */
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useModelStore } from '../../../store/modelStore';
import { useModellingStore } from '../../../store/modellingStore';
import { SIDE_COLORS, withContactEdit, withLink, withMarks, withoutMarks, withUncrossed } from '../../model/contactControl';
import { contactInputsFor } from '../../model/modelCache';
import { surfaceSides } from '../../model/surfaceColumns';
import { controlAt, controlDrawing, controlRows, controlsInBox, KIND_NAMES, movedMark, shiftedMarks, type ControlDrawing, type ControlHit } from '../../model/controlMarks';
import { pickedOn, useControlPicks } from '../../model/controlPicks';
import type { BodyRule, ContactRule, Plane, SideMark, SurfaceObject, Vec3 } from '../../model/types';
import type { PointCloudGeometry } from './geometry';
import type { ThreeViewport } from './ThreeViewport';
import { describePlacement, placementHole, placeOnPlane, resolvePlacement, type Placement, type PlacementView } from './viewPlacement';

interface Inputs {
    containerRef: RefObject<HTMLElement | null>;
    viewportRef: RefObject<ThreeViewport | null>;
    ready: boolean;
    geometry: PointCloudGeometry | null;
    /** The view shows the scene's coordinates and the camera tool is in hand */
    active: boolean;
    /** Whether a place (local coordinates) is inside the slices and the clip box now */
    visibleAt: () => (x: number, y: number, z: number) => boolean;
    /** Tells of every change to the slices */
    liveClip?: { subscribe: (listener: () => void) => () => void };
    /** For finding where a dragged control lands (as a click that places one does) */
    intervals: PlacementView['intervals'];
    vex: number;
    eligibility: PlacementView['eligibility'];
    slicePlane: PlacementView['slicePlane'];
    columns: PlacementView['columns'];
}

/** A press that moves further than this, px, is not a click */
const CLICK_PX = 4;
/** A contact is under the cursor this near, px */
const CONTACT_PX = 8;
/** A link made by hand with no distance given is held this far each way: 0.5 m thick */
const LINK_BY_HAND = 0.25;

const marksOf = (s: SurfaceObject | null | undefined): readonly SideMark[] =>
    s && (s.rule.kind === 'contact' || s.rule.kind === 'body') ? (s.rule as ContactRule | BodyRule).control?.marks ?? [] : [];

const metres = (v: number) => `${Number(v.toFixed(v < 10 ? 1 : 0))} m`;

/** What the viewport is given to draw: the drawing, with what is picked and pointed at */
const controlSet = (d: ControlDrawing, picked: ReadonlySet<string>, hot: string | null, editing: boolean) => ({
    dots: d.dots, dotSide: d.dotSide, links: d.links, linkSide: d.linkSide,
    dotPicked: Uint8Array.from({ length: d.dotOf.length }, (_, i) => (picked.has(d.dotOf[i]) ? 1 : 0)),
    linkPicked: Uint8Array.from({ length: d.linkOf.length }, (_, i) => (picked.has(d.linkOf[i]) ? 1 : 0)),
    hotDot: hot ? d.dotOf.findIndex(id => id === hot) : -1,
    hotLink: hot ? d.linkOf.indexOf(hot) : -1,
    quiet: !editing, colors: SIDE_COLORS,
});

/** A key pressed in a field is the field's */
const typing = (t: EventTarget | null): boolean => {
    const el = t as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

export function useHandControls({ containerRef, viewportRef, ready, geometry, active, visibleAt, liveClip, intervals, vex, eligibility, slicePlane, columns }: Inputs): void {
    const editingId = useModelStore(s => s.editingId);
    const selected = useModellingStore(s => s.selected);
    const surfaces = useModelStore(s => s.scene.surfaces);
    // The surface open for editing (one made from logging, whether it has controls yet or not), else the one picked
    // alone in the tree or the Scene list that has some
    const surface = useMemo(() => {
        if (editingId) {
            const s = surfaces.find(x => x.id === editingId);
            return s && (s.rule.kind === 'contact' || s.rule.kind === 'body') ? s : null;
        }
        const id = selected.length === 1 && selected[0].startsWith('surface:') ? selected[0].slice('surface:'.length) : null;
        const s = id ? surfaces.find(x => x.id === id) ?? null : null;
        return s && marksOf(s).length > 0 ? s : null;
    }, [editingId, selected, surfaces]);
    // The hand tool in hand, on the surface being edited
    const tool = useModelStore(s => (s.editingId && s.editingId === surface?.id ? s.marking : null));
    // Its logged contacts, while they are moved by hand
    const found = tool === 'contact' && surface ? contactInputsFor(surface) : null;
    const contacts = found?.list ?? null;
    const marks = marksOf(surface);
    const editing = !!surface && surface.id === editingId;
    const origin = geometry?.origin ?? null;
    const drawing = useMemo(() => (surface && origin ? controlDrawing(marks, origin) : null), [surface, marks, origin]);
    const lenses = !!surface && surface.rule.kind === 'body' && !(surface.rule as BodyRule).vein;
    const pickSurface = useControlPicks(s => s.surface);
    const pickIds = useControlPicks(s => s.ids);
    const hot = useControlPicks(s => s.hot);
    const picked = useMemo(() => (surface ? pickedOn(surface.id, marks, { surface: pickSurface, ids: pickIds }) : new Set<string>()), [surface, marks, pickSurface, pickIds]);

    const contactsLocal = useMemo(() => {
        if (!contacts || !origin) return null;
        const at = new Float32Array(contacts.length * 3), state = new Uint8Array(contacts.length);
        contacts.forEach((c, i) => {
            at[i * 3] = c.p[0] - origin[0]; at[i * 3 + 1] = c.p[1] - origin[1]; at[i * 3 + 2] = c.p[2] - origin[2];
            state[i] = c.state === 'kept' ? 0 : c.state === 'moved' ? 1 : 2;
        });
        return { at, state };
    }, [contacts, origin]);

    const now = { surface, drawing, editing, active, lenses, visibleAt, marks, picked, hot, origin, intervals, vex, eligibility, slicePlane, columns, geometry, tool, contacts, contactsLocal };
    const live = useRef(now);
    live.current = now;

    // The contacts, while the tool that moves them is in hand
    useEffect(() => {
        const v = viewportRef.current;
        if (!ready || !v) return;
        v.setContactHandles(contactsLocal ? { positions: contactsLocal.at, state: contactsLocal.state, hot: -1 } : null);
    }, [ready, viewportRef, contactsLocal]);
    useEffect(() => () => viewportRef.current?.setContactHandles(null), [viewportRef]);

    // Drawn
    useEffect(() => {
        const v = viewportRef.current;
        if (!ready || !v) return;
        if (!drawing || !surface) { v.setControls(null); return; }
        v.setControls(controlSet(drawing, picked, hot, editing));
    }, [ready, viewportRef, drawing, surface, picked, hot, editing]);
    useEffect(() => () => viewportRef.current?.setControls(null), [viewportRef]);
    // (The slices move: the viewport cuts them itself; nothing to do but keep the hot one honest)
    useEffect(() => liveClip?.subscribe(() => useControlPicks.getState().setHot(null)), [liveClip]);

    useEffect(() => {
        const el = containerRef.current;
        if (!el || !ready || !surface || !active) return;
        const canvas = () => el.querySelector('canvas');
        const cursorOf = (e: MouseEvent): [number, number] => {
            const r = (canvas() ?? el).getBoundingClientRect();
            return [e.clientX - r.left, e.clientY - r.top];
        };
        const onCanvas = (e: Event) => e.target instanceof HTMLCanvasElement && el.contains(e.target);

        const label = document.createElement('div');
        label.dataset.testid = 'control-label';
        Object.assign(label.style, {
            position: 'absolute', display: 'none', pointerEvents: 'none', zIndex: '4', whiteSpace: 'nowrap',
            font: '500 12px Inter, system-ui, sans-serif', color: '#fff', background: 'rgba(33, 33, 33, 0.88)', padding: '2px 7px', borderRadius: '4px',
        });
        el.appendChild(label);
        const say = (text: string | null, x = 0, y = 0) => {
            if (text === null) { label.style.display = 'none'; return; }
            label.textContent = text;
            label.style.display = 'block';
            label.style.left = `${Math.min(x + 16, el.clientWidth - label.offsetWidth - 4)}px`;
            label.style.top = `${Math.min(y + 14, el.clientHeight - label.offsetHeight - 4)}px`;
        };
        const boxEl = document.createElement('div');
        Object.assign(boxEl.style, { position: 'absolute', display: 'none', pointerEvents: 'none', zIndex: '4', border: '1.5px dashed #ffc107', background: 'rgba(255, 193, 7, 0.08)' });
        el.appendChild(boxEl);

        /** The dots and links on the screen, NaN where the slices hide them */
        const screen = (d: ControlDrawing): { dots: Float32Array; links: Float32Array } | null => {
            const v = viewportRef.current;
            if (!v) return null;
            const seen = live.current.visibleAt();
            const dots = Float32Array.from(v.projectPoints(d.dots));
            for (let i = 0; i < d.dotOf.length; i++) if (!seen(d.dots[i * 3], d.dots[i * 3 + 1], d.dots[i * 3 + 2])) dots[i * 2] = dots[i * 2 + 1] = NaN;
            const links = Float32Array.from(v.projectPoints(d.links));
            return { dots, links };
        };
        const hitAt = (x: number, y: number): { hit: ControlHit; id: string } | null => {
            const d = live.current.drawing;
            const s = d ? screen(d) : null;
            if (!d || !s) return null;
            const seen = live.current.visibleAt();
            const hit = controlAt(s.dots, s.links, [x, y], (i, t) => {
                const a = d.links.subarray(i * 6, i * 6 + 6);
                return seen(a[0] + t * (a[3] - a[0]), a[1] + t * (a[4] - a[1]), a[2] + t * (a[5] - a[2]));
            });
            if (!hit) return null;
            return { hit, id: hit.dot !== undefined ? d.dotOf[hit.dot] : d.linkOf[hit.link] };
        };
        const describe = (id: string): string => {
            const row = controlRows(live.current.marks, live.current.lenses).find(r => r.id === id);
            if (!row) return '';
            const side = live.current.surface?.sides?.[row.side === 1 ? 0 : 1] ?? (row.side === 1 ? 'first side' : 'second side');
            return [
                `${KIND_NAMES[row.kind]} ${row.n}`, row.kind === 'link' ? `${metres(row.length)} long` : side,
                row.by ? `held by ${metres(row.by)}` : 'only just clear',
                live.current.editing ? 'click: pick · Ctrl: add' : 'click: pick and edit',
            ].join(' · ');
        };
        const picksNow = () => useControlPicks.getState();

        /** What a drag does: one end of a control moved to where the cursor lands, or whole controls moved with it */
        type Drag =
            | { kind: 'end'; id: string; end: 'p' | 'to'; start: Vec3 }
            | { kind: 'whole'; ids: ReadonlySet<string>; start: Vec3; plane: Plane };
        let press: {
            pointer: number; x0: number; y0: number; id: string | null; box: boolean; add: boolean; moved: boolean; drag?: Drag;
            /** A contact pressed (its place in the surface's list), to be dragged along its hole */
            contact?: number;
        } | null = null;
        /** The marks as the drag has them now (null: not dragged yet, or put back) */
        let dragged: SideMark[] | null = null;
        let overView = false;
        const view = (): PlacementView => ({ ...live.current, viewport: viewportRef.current });
        /** The plane through a place (local) that faces the camera, in the data's coordinates */
        const facing = (local: Vec3): Plane | null => {
            const v = viewportRef.current;
            if (!v) return null;
            const f = v.viewDirection();
            return { normal: [f[0], f[1], f[2] * live.current.vex], point: local };
        };
        const worldOf = (local: ArrayLike<number>): Vec3 => {
            const o = live.current.origin ?? [0, 0, 0];
            return [local[0] + o[0], local[1] + o[1], local[2] + o[2]];
        };
        const redraw = (marks: readonly SideMark[]) => {
            const v = viewportRef.current, o = live.current.origin;
            if (v && o) v.setControls(controlSet(controlDrawing(marks, o), live.current.picked, live.current.hot, live.current.editing));
        };
        const putBack = () => {
            dragged = null;
            const d = live.current.drawing, v = viewportRef.current;
            if (d && v) v.setControls(controlSet(d, live.current.picked, live.current.hot, live.current.editing));
        };
        /** Where the dragged control is now, and what the label says of it */
        const dragTo = (drag: Drag, x: number, y: number): { marks: SideMark[]; text: string } | null => {
            const marks = live.current.marks;
            if (drag.kind === 'whole') {
                const at = placeOnPlane(view(), x, y, drag.plane);
                if (!at) return null;
                const d: Vec3 = [at[0] - drag.start[0], at[1] - drag.start[1], at[2] - drag.start[2]];
                const them = drag.ids.size > 1 ? 'them' : 'it';
                return { marks: shiftedMarks(marks, drag.ids, d), text: `Moved ${metres(Math.hypot(d[0], d[1], d[2]))}${drag.ids.size > 1 ? `, ${drag.ids.size} together` : ''} · let go to put ${them} here · Esc puts ${them} back` };
            }
            // One end: onto a hole or a sample, else the slice, else the plane of the screen through where it was
            const place = resolvePlacement(view(), x, y, true);
            const plane = place ? null : facing(drag.start);
            const local = place ? place.local : plane ? placeOnPlane(view(), x, y, plane) : null;
            if (!local) return null;
            const where = place ? describePlacement(view(), place) : 'In the plane of the screen';
            return { marks: movedMark(marks, drag.id, drag.end, worldOf(local)), text: `${where} · let go to put it here · Esc puts it back` };
        };

        // --- the bar's tools: a link by two clicks, a hole kept clear of, a contact moved along its hole ---
        /** Where a link being made starts (null: its first click is to come) */
        let linkFrom: { world: Vec3; text: string } | null = null;
        /** The contact pointed at (its place in the surface's list; -1: none), and one dragged along its hole */
        let hotContact = -1;
        let contactDrag: { index: number; depth: number; local: Vec3 } | null = null;
        /** Where the cursor last was over the view (for a label after a key) */
        let lastAt: [number, number] = [0, 0];
        const toolNow = () => (live.current.editing ? live.current.tool : null);
        const rule = () => live.current.surface!.rule as ContactRule | BodyRule;
        const update = (next: ContactRule | BodyRule) => useModelStore.getState().updateSurface(live.current.surface!.id, { rule: next });
        const names = (): [string, string] => {
            const s = live.current.surface;
            const [a, b] = s ? surfaceSides(s, null) : ['first', 'second'];
            return [a.replace(/ side$/, ''), b.replace(/ side$/, '')];
        };
        const linkBy = () => useModelStore.getState().markBy ?? LINK_BY_HAND;
        const snapAt = (local: Vec3 | null) => viewportRef.current?.setSnapMarker(local, '#00897b');
        const drawContacts = () => {
            const c = live.current.contactsLocal, v = viewportRef.current;
            if (!v) return;
            if (!c) { v.setContactHandles(null); return; }
            let at = c.at;
            if (contactDrag) {
                at = Float32Array.from(c.at);
                at.set(contactDrag.local, contactDrag.index * 3);
            }
            v.setContactHandles({ positions: at, state: c.state, hot: contactDrag?.index ?? hotContact });
        };
        /** The contact under the cursor (-1: none), of those the slices show */
        const contactAt = (x: number, y: number): number => {
            const c = live.current.contactsLocal, v = viewportRef.current;
            if (!c || !v) return -1;
            const xy = v.projectPoints(c.at), seen = live.current.visibleAt();
            let best = -1, nearest = CONTACT_PX;
            for (let i = 0; i < c.state.length; i++) {
                const d = Math.hypot(xy[i * 2] - x, xy[i * 2 + 1] - y);
                if (d < nearest && seen(c.at[i * 3], c.at[i * 3 + 1], c.at[i * 3 + 2])) { nearest = d; best = i; }
            }
            return best;
        };
        const depthText = (v: number) => `${Number(v.toFixed(2))} m`;
        const describeContact = (i: number): string => {
            const c = live.current.contacts?.[i];
            if (!c) return '';
            if (c.state === 'uncrossed') return `${c.hole} · ${depthText(c.depth)} · left out: the surface keeps clear of its hole`;
            const where = c.state === 'moved' ? `${depthText(c.at)} (logged at ${depthText(c.depth)})` : depthText(c.depth);
            return `${c.hole} · ${where}${c.state === 'ignored' ? ' · left out' : ''} · drag along its hole · Delete: ${c.state === 'ignored' ? 'use it again' : 'leave it out'}`;
        };
        /** What the tool in hand would do at the cursor: drawn and said */
        const toolHover = (x: number, y: number) => {
            const tool = toolNow();
            if (tool !== 'link') linkFrom = null;
            if (tool === 'contact') {
                const i = contactAt(x, y);
                if (i !== hotContact) { hotContact = i; drawContacts(); }
                el.style.cursor = i >= 0 && live.current.contacts?.[i]?.state !== 'uncrossed' ? 'grab' : '';
                say(i >= 0 ? describeContact(i) : null, x, y);
                return;
            }
            const place: Placement | null = resolvePlacement(view(), x, y, true);
            snapAt(place ? place.local : null);
            el.style.cursor = 'crosshair';
            if (tool === 'link') {
                if (!linkFrom) {
                    say(place ? `${describePlacement(view(), place)} · click: a link from here` : 'Point at a hole (or the slice) where the link starts', x, y);
                    return;
                }
                if (!place) { redraw(live.current.marks); say(`From ${linkFrom.text} · point at where it ends · Esc: start again`, x, y); return; }
                const to = worldOf(place.local), f = linkFrom.world;
                redraw([...live.current.marks, { id: '(new)', p: f, to, side: 1, by: linkBy() }]);
                say(`From ${linkFrom.text} to ${describePlacement(view(), place)} · ${metres(Math.hypot(to[0] - f[0], to[1] - f[1], to[2] - f[2]))} · click to link · Esc: start again`, x, y);
                return;
            }
            // A hole kept clear of
            const at = place ? placementHole(view(), place) : null;
            if (!at) { say(place ? 'Point at a hole' : null, x, y); return; }
            const [a, b] = names();
            const u = rule().control?.uncrossed?.find(o => o.hole === at.hole);
            say(u ? `${at.hole} · kept clear of, wholly on the ${u.side === 1 ? a : b} side · click: let it go`
                : `${at.hole} · click: the surface keeps clear of this hole, wholly on the ${a} side · Shift+click: the ${b} side`, x, y);
        };
        /** A click with the tool in hand */
        const toolClick = (x: number, y: number, shift: boolean) => {
            const tool = toolNow(), s = live.current.surface;
            if (!s) return;
            const place = resolvePlacement(view(), x, y, true);
            if (!place) return;
            if (tool === 'link') {
                if (!linkFrom) {
                    linkFrom = { world: worldOf(place.local), text: describePlacement(view(), place) };
                    say(`From ${linkFrom.text} · point at where it ends`, x, y);
                    return;
                }
                const from = linkFrom.world, to = worldOf(place.local);
                if (Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) < 0.05) return;
                linkFrom = null;
                const made = withLink(rule(), from, to, 1, linkBy(), useModelStore.getState().markAlong ?? undefined);
                update(made.rule);
                picksNow().pick(s.id, [made.id], 'replace');
                say(null);
                return;
            }
            if (tool === 'hole') {
                const at = placementHole(view(), place);
                if (!at) return;
                const u = rule().control?.uncrossed?.find(o => o.hole === at.hole);
                const side = u ? null : shift ? -1 : 1;
                update(withUncrossed(rule(), at.hole, side));
                // (Said as it now is: the surface is drawn again after this)
                const [a, b] = names();
                say(side ? `${at.hole} · kept clear of, wholly on the ${side === 1 ? a : b} side · click: let it go` : `${at.hole} · let go: the surface may cross it again`, x, y);
            }
        };
        const onDown = (e: PointerEvent) => {
            if (!onCanvas(e) || !e.isPrimary || e.button !== 0) return;
            const [x, y] = cursorOf(e);
            const under = hitAt(x, y);
            const marking = useModelStore.getState().marking !== null || useModelStore.getState().picking;
            if (!under && toolNow() === 'contact') {
                // A contact pressed: dragged along its hole
                const i = contactAt(x, y);
                if (i >= 0 && live.current.contacts?.[i]?.state !== 'uncrossed') {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    press = { pointer: e.pointerId, x0: x, y0: y, id: null, box: false, add: false, moved: false, contact: i };
                    el.setPointerCapture(e.pointerId);
                    return;
                }
            }
            if (e.shiftKey && !marking) {
                // A box round controls (from anywhere, on one too): the camera does not turn while it is drawn; a
                // Shift+click on a control adds it
                e.preventDefault();
                e.stopImmediatePropagation();
                press = { pointer: e.pointerId, x0: x, y0: y, id: under?.id ?? null, box: true, add: true, moved: false };
            } else if (under) {
                e.preventDefault();
                e.stopImmediatePropagation();
                const add = e.ctrlKey || e.metaKey;
                press = { pointer: e.pointerId, x0: x, y0: y, id: under.id, box: false, add, moved: false };
                // Open for editing, a plain press can become a drag: with a hand tool in hand too (what is there is
                // moved without putting the tool down), not while points are placed or stretches taken
                const d = live.current.drawing, m = useModelStore.getState();
                const drags = m.marking === null ? !m.picking : m.marking !== 'take';
                if (live.current.editing && !add && drags && d) {
                    if (under.hit.dot !== undefined) {
                        const i = under.hit.dot;
                        press.drag = { kind: 'end', id: under.id, end: d.dotEnd[i], start: [d.dots[i * 3], d.dots[i * 3 + 1], d.dots[i * 3 + 2]] };
                    } else {
                        const a = d.links.subarray(under.hit.link * 6, under.hit.link * 6 + 6), t = under.hit.t;
                        const start: Vec3 = [a[0] + t * (a[3] - a[0]), a[1] + t * (a[4] - a[1]), a[2] + t * (a[5] - a[2])];
                        const plane = facing(start);
                        const ids = live.current.picked.has(under.id) ? new Set(live.current.picked) : new Set([under.id]);
                        if (plane) press.drag = { kind: 'whole', ids, start, plane };
                    }
                }
            } else {
                press = { pointer: e.pointerId, x0: x, y0: y, id: null, box: false, add: false, moved: false };
                return;
            }
            el.setPointerCapture(e.pointerId);
        };
        const onMove = (e: PointerEvent) => {
            if (!el.contains(e.target as Node)) return;
            const [x, y] = cursorOf(e);
            lastAt = [x, y];
            if (press && e.pointerId === press.pointer) {
                if (Math.hypot(x - press.x0, y - press.y0) > CLICK_PX) press.moved = true;
                if (press.contact !== undefined) {
                    e.stopImmediatePropagation();
                    if (!press.moved) return;
                    // Along its own hole only: where the cursor is on that hole
                    const c = live.current.contacts?.[press.contact];
                    const place = resolvePlacement(view(), x, y, false);
                    const at = place ? placementHole(view(), place) : null;
                    el.style.cursor = 'grabbing';
                    if (c && place && at && at.hole === c.hole && at.depth !== null) {
                        contactDrag = { index: press.contact, depth: at.depth, local: place.local };
                        drawContacts();
                        say(`${c.hole} · ${depthText(c.at)} > ${depthText(at.depth)}${Math.abs(at.depth - c.depth) < 1e-6 ? ' (as logged)' : ''} · let go to move it here · Esc puts it back`, x, y);
                    } else if (c) {
                        say(`Keep to its hole, ${c.hole}${contactDrag ? ` · ${depthText(contactDrag.depth)} so far` : ''}`, x, y);
                    }
                    return;
                }
                if (press.box) {
                    e.stopImmediatePropagation();
                    Object.assign(boxEl.style, {
                        display: 'block', left: `${Math.min(x, press.x0)}px`, top: `${Math.min(y, press.y0)}px`,
                        width: `${Math.abs(x - press.x0)}px`, height: `${Math.abs(y - press.y0)}px`,
                    });
                }
                if (press.id) e.stopImmediatePropagation();
                if (press.drag && press.moved) {
                    const to = dragTo(press.drag, x, y);
                    if (to) {
                        dragged = to.marks;
                        redraw(to.marks);
                        el.style.cursor = 'grabbing';
                        say(to.text, x, y);
                    }
                }
                return;
            }
            if (e.buttons !== 0 || !onCanvas(e)) return;
            const under = hitAt(x, y);
            picksNow().setHot(under?.id ?? null);
            const tool = toolNow();
            if ((!under && tool === 'contact') || tool === 'link' || tool === 'hole') {
                // The tool's own: what a click here would do (the editing of points is left out of it); over a
                // control as well, which a drag still moves
                e.stopImmediatePropagation();
                toolHover(x, y);
                if (under) el.style.cursor = 'grab';
                return;
            }
            if (under && tool) snapAt(null);
            el.style.cursor = under ? (live.current.editing ? 'grab' : 'pointer') : '';
            say(under ? describe(under.id) : null, x, y);
        };
        const onUp = (e: PointerEvent) => {
            if (!press || e.pointerId !== press.pointer) return;
            const done = press;
            press = null;
            if (e.type !== 'pointerup' && done.drag) putBack();
            if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
            boxEl.style.display = 'none';
            const s = live.current.surface;
            if (e.type !== 'pointerup' && done.contact !== undefined) { contactDrag = null; drawContacts(); }
            if (!s || e.type !== 'pointerup') return;
            const [x, y] = cursorOf(e);
            if (done.contact !== undefined) {
                // A contact let go of: moved to where the drag left it on its hole (one step back)
                e.stopImmediatePropagation();
                const moved = contactDrag, c = live.current.contacts?.[done.contact];
                contactDrag = null;
                say(null);
                el.style.cursor = '';
                if (done.moved && moved && c) update(withContactEdit(rule(), c.hole, c.depth, { to: moved.depth }));
                else drawContacts();
                return;
            }
            if (done.box) {
                e.stopImmediatePropagation();
                const d = live.current.drawing, sc = d ? screen(d) : null;
                if (!d || !sc) return;
                if (!live.current.editing) useModelStore.getState().setEditing(s.id);
                // Not dragged: a Shift+click, which adds (or takes back out) the control under it
                if (!done.moved) {
                    if (done.id) picksNow().pick(s.id, [done.id], 'toggle');
                    return;
                }
                picksNow().pick(s.id, controlsInBox(d, sc.dots, [done.x0, done.y0, x, y]), 'add');
                return;
            }
            if (done.id) {
                e.stopImmediatePropagation();
                if (done.drag && done.moved) {
                    // Put where the drag left it: one step back; the surface is fitted again now
                    const next = dragged;
                    dragged = null;
                    say(null);
                    el.style.cursor = '';
                    if (next) useModelStore.getState().updateSurface(s.id, { rule: withMarks(s.rule as ContactRule | BodyRule, next) });
                    else putBack();
                    return;
                }
                if (done.moved) return;
                // A click with a link or a hole tool in hand is the tool's, on a control too (a link from the end of
                // the last one; the hole a place is on)
                const inHand = toolNow();
                if ((inHand === 'link' || inHand === 'hole') && !done.add) { toolClick(x, y, e.shiftKey); return; }
                if (!live.current.editing) useModelStore.getState().setEditing(s.id);
                picksNow().pick(s.id, [done.id], done.add ? 'toggle' : 'replace');
                return;
            }
            // A click with a link or a hole tool in hand is the tool's
            const tool = toolNow();
            if (!done.moved && (tool === 'link' || tool === 'hole')) { toolClick(x, y, e.shiftKey); return; }
            // A click on empty ground lets go of the picks (not while places are being put down: that click put one)
            const m = useModelStore.getState();
            if (!done.moved && m.marking === null && !m.picking && picksNow().ids.length > 0) picksNow().clear();
        };
        const onKey = (e: KeyboardEvent) => {
            if (typing(e.target)) return;
            // Only the view's keys: pressed in it, or with nothing in focus and the cursor over it
            const t = e.target as Node | null;
            if (!(t && el.contains(t)) && !(overView && (t === null || t === document.body || t === document.documentElement))) return;
            if (e.key === 'Escape' && press?.drag && dragged) {
                // A drag let go of: the control back where it was
                e.stopImmediatePropagation();
                press = null;
                putBack();
                say(null);
                el.style.cursor = '';
                return;
            }
            if (e.key === 'Escape' && press?.contact !== undefined) {
                // A contact's drag let go of: back where it was
                e.stopImmediatePropagation();
                press = null;
                contactDrag = null;
                drawContacts();
                say(null);
                return;
            }
            if (e.key === 'Escape' && linkFrom) {
                // A link begun: started again
                e.stopImmediatePropagation();
                linkFrom = null;
                redraw(live.current.marks);
                say(null);
                return;
            }
            // (Picks of controls no longer there, after a step back, are not worth an Esc)
            if (e.key === 'Escape' && live.current.picked.size > 0) {
                picksNow().clear();
                // With a tool in hand Esc puts it down as well ("Esc when done"): the key goes on to do that
                if (toolNow() === null) e.stopImmediatePropagation();
                return;
            }
            if ((e.key === 'Delete' || e.key === 'Backspace') && toolNow() === 'contact' && hotContact >= 0 && !press) {
                // The contact pointed at: left out, or used again
                const c = live.current.contacts?.[hotContact];
                if (!c || c.state === 'uncrossed') return;
                e.preventDefault();
                e.stopImmediatePropagation();
                update(withContactEdit(rule(), c.hole, c.depth, c.state === 'ignored' ? {} : { ignore: true }));
                say(c.state === 'ignored' ? `${c.hole} · ${depthText(c.depth)} · used again` : `${c.hole} · ${depthText(c.depth)} · left out · Delete: use it again`, ...lastAt);
                return;
            }
            if ((e.key === 'Delete' || e.key === 'Backspace') && live.current.editing && !press) {
                const s = live.current.surface, ids = [...live.current.picked];
                if (!s || ids.length === 0) return;
                e.preventDefault();
                e.stopImmediatePropagation();
                useModelStore.getState().updateSurface(s.id, { rule: withoutMarks(s.rule as ContactRule | BodyRule, ids) });
                picksNow().clear();
            }
        };
        const onEnter = () => { overView = true; };
        const onLeave = () => { overView = false; picksNow().setHot(null); if (!press) say(null); el.style.cursor = ''; };
        window.addEventListener('pointerdown', onDown, { capture: true });
        window.addEventListener('pointermove', onMove, { capture: true });
        window.addEventListener('pointerup', onUp, { capture: true });
        window.addEventListener('pointercancel', onUp, { capture: true });
        window.addEventListener('keydown', onKey, { capture: true });
        el.addEventListener('pointerleave', onLeave);
        el.addEventListener('pointerenter', onEnter);
        return () => {
            window.removeEventListener('pointerdown', onDown, { capture: true });
            window.removeEventListener('pointermove', onMove, { capture: true });
            window.removeEventListener('pointerup', onUp, { capture: true });
            window.removeEventListener('pointercancel', onUp, { capture: true });
            window.removeEventListener('keydown', onKey, { capture: true });
            el.removeEventListener('pointerleave', onLeave);
            el.removeEventListener('pointerenter', onEnter);
            if (dragged) putBack();
            label.remove();
            boxEl.remove();
            el.style.cursor = '';
            picksNow().setHot(null);
        };
    }, [containerRef, viewportRef, ready, surface?.id, active]); // eslint-disable-line react-hooks/exhaustive-deps -- the rest is read through `live`
}
