/**
 * The project's 3D scene: the surfaces built in the 3D viewer and the
 * wireframes loaded into it.
 *
 * Project-level (shared by every 3D view) and saved in the .chem file. Only
 * what the user put in is stored: the points and the drawn lines a surface
 * passes through, and its settings. Meshes are worked out from those (features/model/modelCache) and
 * rebuilt on load. A wireframe is stored as the name of its file and how it
 * is drawn; the file is kept in the project folder (features/model/wireframeFiles).
 *
 * `scene` is replaced, never mutated: its identity is the change signal for
 * undo (store/historyStore), the unsaved-changes flag and the refits.
 */
import { create } from 'zustand';
import { sampleLines } from '../features/model/lines';
import { unit } from '../features/model/plane';
import { cleanReading, readingSamples } from '../features/model/readings';
import { DEFAULT_SHARE } from '../features/model/shell';
import { sheetInputTrend } from '../features/model/sheet';
import { readStructure } from '../features/model/structure';
import { cleanLine, cleanPlane, handSetName, MAX_SET_READINGS, MAX_SETS, readSets, SET_COLOURS, type NewReadingSet } from '../features/model/structureReadings';
import type { Suggestion } from '../features/model/suggest';
import type {
    BodyRule, ContactRule, ModelScene, OverallStructure, Plane, ReadingSet, ShellRule, PointReading, SceneCoords, ScenePoint, ScenePolyline, StructureTool, SurfaceObject, SurfaceOutline, SurfaceParams,
    SurfaceRule, Vec3,
    WireframeObject,
} from '../features/model/types';

export const EMPTY_SCENE: ModelScene = { coords: null, surfaces: [], wireframes: [], structure: { overall: null, sets: [], range: null } };

export const DEFAULT_SURFACE_PARAMS: SurfaceParams = { follow: 0, extent: 'near', reach: null, resolution: null, outline: null, trend: true };

/** Strong, distinct colours for successive surfaces (unlike the wireframe palette, to tell the two apart). */
const PALETTE = ['#d81b60', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00acc1', '#6d4c41', '#c0ca33'];

/** Distinct, print-friendly colours for successive wireframes. */
const WIREFRAME_PALETTE = ['#e6550d', '#3182bd', '#31a354', '#756bb1', '#d6616b', '#8c6d31', '#17becf', '#bcbd22', '#636363', '#e7298a'];

/** One of a wireframe file's objects, as far as the scene needs to know it */
export interface WireframeFilePart {
    /** Its name inside the file ('' when the file has one unnamed object) */
    name: string;
    /** It has triangles (lines only otherwise: strings, pit outlines) */
    solid: boolean;
}

/** A point to add: where, and how it was placed (see ScenePoint) */
export type NewPoint = Pick<ScenePoint, 'p' | 'snap' | 'across' | 'reading'>;

export interface NewSurface {
    name?: string;
    /** How it is built (left out: by hand) */
    rule?: SurfaceRule;
    /** The names of its first and second side (left out: from the way it faces) */
    sides?: [string, string] | null;
    points?: NewPoint[];
    along?: Vec3 | null;
    params?: Partial<SurfaceParams>;
}

interface ModelState {
    scene: ModelScene;
    /** Counts the times the whole scene was replaced (another project, a new one): what was kept for the old scene no longer applies */
    sceneLoads: number;
    /** The surface being edited in a 3D view (this session only: not saved, not undone) */
    editingId: string | null;
    /** Clicks in a 3D view place points on the surface being edited (session only) */
    picking: boolean;
    /** As picking, and a drag across the slice draws a line for the surface to pass along (session only) */
    drawing: boolean;
    /** A line of the surface being edited that is pointed out in the views (session only) */
    hotLine: string | null;
    /** A dip reading waiting for its place: the next point placed (or clicked) in a view takes it (session only) */
    pendingReading: PointReading | null;
    /** Arm a reading (clicks then place points) or, with null, put it down */
    setPendingReading: (reading: PointReading | null) => void;
    /** What clicks and drags in a 3D view give the model's structure (session only; null: nothing) */
    structureTool: StructureTool | null;
    /** Take up a structure tool (placing a surface's points stops) or, with null, put it down */
    setStructureTool: (tool: StructureTool | null) => void;
    /** Readings on offer, drawn as ghosts until they are kept or thrown away (session only; null: none) */
    suggestion: Suggestion | null;
    setSuggestion: (suggestion: Suggestion | null) => void;
    /** Open a surface for editing (null: close it); `picking`: clicks in the view place its points */
    setEditing: (id: string | null, picking?: boolean) => void;
    /** Clicks place points (off: drawing goes off too) */
    setPicking: (picking: boolean) => void;
    /** Drags draw lines (on: picking comes on too) */
    setDrawing: (drawing: boolean) => void;
    setHotLine: (lineId: string | null) => void;
    /** Replace the whole scene (project open, new project) */
    setScene: (scene: ModelScene | null | undefined) => void;
    /** The dataset columns the scene's coordinates are in (set when the first surface is made) */
    setCoords: (coords: SceneCoords) => void;
    /** Set the one direction of continuity the model's surfaces follow (null: none). Every surface that follows it is fitted again. */
    setStructure: (overall: OverallStructure | null) => void;
    /** Add sets of readings to the scene (as many as it has room for); returns their ids */
    addReadingSets: (sets: NewReadingSet[]) => string[];
    updateReadingSet: (id: string, patch: Partial<Pick<ReadingSet, 'name' | 'visible' | 'color' | 'follow'>>) => void;
    /** How far a reading carries, m (null: worked out from how the readings are spaced) */
    setStructureRange: (range: number | null) => void;
    removeReadingSet: (id: string) => void;
    /** A reading placed by hand: it joins the set of its kind set by hand (made when there is none). Returns its id, or null when it cannot be kept */
    addHandReading: (kind: ReadingSet['kind'], reading: { p: Vec3; dip: number; direction: number }) => string | null;
    /** Take one reading out of its set (a set left empty goes too) */
    removeReading: (setId: string, readingId: string) => void;
    addSurface: (init?: NewSurface) => string;
    updateSurface: (id: string, patch: Partial<Omit<SurfaceObject, 'id' | 'points' | 'params'>> & { params?: Partial<SurfaceParams> }) => void;
    removeSurface: (id: string) => void;
    addPoints: (id: string, points: NewPoint[]) => void;
    /** Move a point; `snap` and `across` say how it sits now (left out: neither) */
    movePoint: (id: string, pointId: string, p: Vec3, snap?: ScenePoint['snap'], across?: Vec3 | null) => void;
    removePoints: (id: string, pointIds: string[]) => void;
    /** Give a point a dip reading, change it, or (null) take it away. The point stays where it is */
    setPointReading: (id: string, pointId: string, reading: PointReading | null) => void;
    /** A line drawn on a slice (`plane`); returns its id, or null when it has no length */
    addPolyline: (id: string, line: { points: Vec3[]; plane: Plane }) => string | null;
    /** Redraw a line (new vertices) or turn it over */
    updatePolyline: (id: string, lineId: string, patch: { points?: Vec3[]; flipped?: boolean }) => void;
    removePolylines: (id: string, lineIds: string[]) => void;
    /**
     * Show the objects of a wireframe file. For a file already shown (loaded
     * again): its objects stay as they are, new ones are added and any the
     * file no longer has are dropped.
     */
    setWireframeFile: (file: string, parts: WireframeFilePart[]) => void;
    updateWireframe: (id: string, patch: Partial<Pick<WireframeObject, 'name' | 'color' | 'opacity' | 'visible' | 'showEdges'>>) => void;
    removeWireframes: (ids: string[]) => void;
}

/** The next free id with this prefix among `taken` (s1, s2, ...). */
function nextId(prefix: string, taken: Iterable<string>): number {
    let max = 0;
    for (const id of taken) {
        if (!id.startsWith(prefix)) continue;
        const n = Number(id.slice(prefix.length));
        if (Number.isInteger(n) && n > max) max = n;
    }
    return max + 1;
}

/** The parts of a point that say how it was placed and what was measured there, as stored. */
function placed(snap: ScenePoint['snap'] | null | undefined, across: unknown, reading?: unknown): Pick<ScenePoint, 'snap' | 'across' | 'reading'> {
    const normal = isVec3(across) ? unit(across) : null;
    const measured = cleanReading(reading);
    return { ...(snap ? { snap: { hole: snap.hole, depth: snap.depth } } : {}), ...(normal ? { across: normal } : {}), ...(measured ? { reading: measured } : {}) };
}

function withIds(existing: ScenePoint[], added: NewPoint[]): ScenePoint[] {
    let n = nextId('p', existing.map(p => p.id));
    return added.map(a => ({ id: `p${n++}`, p: [a.p[0], a.p[1], a.p[2]], ...placed(a.snap, a.across, a.reading) }));
}

/**
 * Fix the surface's positive side the first time its points define a plane,
 * so adding points later can tilt the surface but never swap its sides.
 */
function withReference(s: SurfaceObject): SurfaceObject {
    if (s.refDirection) return s;
    const points = s.points.flatMap(p => p.p);
    const plane = sheetInputTrend({
        points, pointAcross: s.points.flatMap(p => p.across ?? [0, 0, 0]),
        oriented: sampleLines(s.polylines) ?? undefined, readings: readingSamples(s.points, points), along: s.along,
    });
    return plane ? { ...s, refDirection: plane.normal } : s;
}

/** A line's vertices as stored: finite, none on top of the one before. Null when fewer than two are left. */
function lineVertices(points: unknown): Vec3[] | null {
    const out: Vec3[] = [];
    for (const p of Array.isArray(points) ? points : []) {
        if (!isVec3(p)) continue;
        const last = out[out.length - 1];
        if (!last || Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) > 1e-9) out.push([p[0], p[1], p[2]]);
    }
    return out.length >= 2 ? out : null;
}

/** A direction at unit length; one that already is comes back unchanged, so saving and reading again alters nothing. */
function asUnit(v: Vec3): Vec3 | null {
    return Math.abs(Math.hypot(v[0], v[1], v[2]) - 1) < 1e-12 ? [v[0], v[1], v[2]] : unit(v);
}

/** An outline as stored: a unit direction and at least three corners. Null otherwise. */
export function readOutline(outline: unknown): SurfaceOutline | null {
    const o = outline as Partial<SurfaceOutline> | null | undefined;
    const normal = o && isVec3(o.normal) ? asUnit(o.normal) : null;
    const points = o && Array.isArray(o.points) ? o.points.filter(isVec3).map((p): Vec3 => [p[0], p[1], p[2]]) : [];
    return normal && points.length >= 3 ? { normal, points } : null;
}

/** A surface's rule as stored; anything unreadable is a hand-built sheet. */
export function readRule(rule: unknown): SurfaceRule {
    const shell = rule as Partial<ShellRule> | null | undefined;
    if (shell && shell.kind === 'shell') {
        if (typeof shell.column !== 'string' || !shell.column || !Number.isFinite(shell.cutoff)) return { kind: 'sheet' };
        return {
            kind: 'shell', column: shell.column, cutoff: shell.cutoff!,
            // Logs need a cut-off above zero
            log: !!shell.log && shell.cutoff! > 0,
            composite: Number.isFinite(shell.composite) && shell.composite! > 0 ? shell.composite! : null,
            topCut: Number.isFinite(shell.topCut) ? shell.topCut! : null,
            // On unless it was turned off
            band: shell.band !== false,
            // In hole spacings. For a short while it was saved in metres: a number that large is not a spacing count
            reach: Number.isFinite(shell.reach) && shell.reach! > 0 && shell.reach! <= 10 ? shell.reach! : null,
            // Only a shell found by counting carries how
            ...(shell.method === 'indicator' ? {
                method: 'indicator' as const,
                share: Number.isFinite(shell.share) && shell.share! > 0 && shell.share! < 1 ? shell.share! : DEFAULT_SHARE,
                local: Number.isFinite(shell.local) && shell.local! > 0 ? shell.local! : null,
            } : shell.method === 'intercepts' ? {
                method: 'intercepts' as const,
                minLength: Number.isFinite(shell.minLength) && shell.minLength! > 0 ? shell.minLength! : 1,
                maxWaste: Number.isFinite(shell.maxWaste) && shell.maxWaste! >= 0 ? shell.maxWaste! : 0,
            } : {}),
        };
    }
    const r = rule as (Partial<ContactRule> & Partial<BodyRule>) | null | undefined;
    if (!r || (r.kind !== 'contact' && r.kind !== 'body') || typeof r.column !== 'string' || !r.column) return { kind: 'sheet' };
    const units = (v: unknown) => Array.from(new Set(Array.isArray(v) ? v.filter((u): u is string => typeof u === 'string' && u.trim() !== '').map(u => u.trim()) : []));
    const gaps = {
        maxGap: Number.isFinite(r.maxGap) && r.maxGap! >= 0 ? r.maxGap! : null,
        minRun: Number.isFinite(r.minRun) && r.minRun! > 0 ? r.minRun! : null,
    };
    // A unit is on one side only
    if (r.kind === 'body') {
        const inside = units(r.inside);
        return { kind: 'body', column: r.column, inside, ignore: units(r.ignore).filter(u => !inside.includes(u)), ...gaps };
    }
    const sideA = units(r.sideA);
    return { kind: 'contact', column: r.column, sideA, sideB: units(r.sideB).filter(u => !sideA.includes(u)), ...gaps };
}

function readPlane(plane: unknown): Plane | null {
    const p = plane as Partial<Plane> | null | undefined;
    const normal = p && isVec3(p.normal) ? unit(p.normal) : null;
    return normal && isVec3(p!.point) ? { normal, point: [p!.point[0], p!.point[1], p!.point[2]] } : null;
}

const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);

/** A saved scene in today's shape; anything unreadable is dropped rather than failing the project. */
export function readScene(saved: unknown): ModelScene {
    const s = (saved ?? {}) as Partial<ModelScene>;
    const c = s.coords as Partial<SceneCoords> | null | undefined;
    const coords: SceneCoords | null = c && typeof c.x === 'string' && typeof c.y === 'string' && typeof c.z === 'string'
        ? { x: c.x, y: c.y, z: c.z, hole: c.hole ?? null, from: c.from ?? null, to: c.to ?? null }
        : null;
    const surfaces: SurfaceObject[] = [];
    for (const raw of Array.isArray(s.surfaces) ? s.surfaces : []) {
        const o = raw as Partial<SurfaceObject> | null;
        if (!o || typeof o.id !== 'string' || surfaces.some(x => x.id === o.id)) continue;
        const points: ScenePoint[] = [];
        for (const p of Array.isArray(o.points) ? o.points : []) {
            if (!p || typeof p.id !== 'string' || !isVec3(p.p) || points.some(x => x.id === p.id)) continue;
            const snap = p.snap && typeof p.snap.hole === 'string' && Number.isFinite(p.snap.depth) ? { hole: p.snap.hole, depth: p.snap.depth } : null;
            points.push({ id: p.id, p: [p.p[0], p.p[1], p.p[2]], ...placed(snap, p.across, p.reading) });
        }
        const polylines: ScenePolyline[] = [];
        for (const l of Array.isArray(o.polylines) ? o.polylines : []) {
            const vertices = lineVertices(l?.points), plane = readPlane(l?.plane);
            if (!l || typeof l.id !== 'string' || !vertices || !plane || polylines.some(x => x.id === l.id)) continue;
            polylines.push({ id: l.id, points: vertices, plane, flipped: !!l.flipped });
        }
        const params = (o.params ?? {}) as Partial<SurfaceParams>;
        surfaces.push({
            id: o.id,
            name: typeof o.name === 'string' && o.name ? o.name : `Surface ${surfaces.length + 1}`,
            rule: readRule(o.rule),
            points,
            polylines,
            along: isVec3(o.along) ? o.along : null,
            refDirection: isVec3(o.refDirection) ? o.refDirection : null,
            params: {
                follow: Number.isFinite(params.follow) ? Math.min(1, Math.max(0, params.follow!)) : 0,
                extent: params.extent === 'box' || params.extent === 'outline' ? params.extent : 'near',
                reach: Number.isFinite(params.reach) && params.reach! > 0 ? params.reach! : null,
                resolution: Number.isFinite(params.resolution) && params.resolution! > 0 ? params.resolution! : null,
                outline: readOutline(params.outline),
                // Follows the model's structure unless that was turned off
                trend: params.trend !== false,
            },
            sides: Array.isArray(o.sides) && o.sides.length === 2 && o.sides.every(n => typeof n === 'string' && n) ? [o.sides[0], o.sides[1]] : null,
            columns: {
                side: typeof o.columns?.side === 'string' && o.columns.side ? o.columns.side : null,
                distance: typeof o.columns?.distance === 'string' && o.columns.distance ? o.columns.distance : null,
                writtenFor: typeof o.columns?.writtenFor === 'string' ? o.columns.writtenFor : null,
            },
            color: typeof o.color === 'string' ? o.color : PALETTE[surfaces.length % PALETTE.length],
            opacity: Number.isFinite(o.opacity) ? Math.min(1, Math.max(0, o.opacity!)) : 0.7,
            visible: o.visible !== false,
            showEdges: !!o.showEdges,
        });
    }
    const wireframes: WireframeObject[] = [];
    for (const raw of Array.isArray(s.wireframes) ? s.wireframes : []) {
        const w = raw as Partial<WireframeObject> | null;
        if (!w || typeof w.id !== 'string' || typeof w.file !== 'string' || !w.file || wireframes.some(x => x.id === w.id)) continue;
        wireframes.push({
            id: w.id,
            name: typeof w.name === 'string' && w.name ? w.name : w.file,
            file: w.file,
            part: Number.isInteger(w.part) && w.part! >= 0 ? w.part! : 0,
            color: typeof w.color === 'string' ? w.color : WIREFRAME_PALETTE[wireframes.length % WIREFRAME_PALETTE.length],
            opacity: Number.isFinite(w.opacity) ? Math.min(1, Math.max(0, w.opacity!)) : 0.6,
            visible: w.visible !== false,
            showEdges: !!w.showEdges,
        });
    }
    const range = s.structure?.range;
    return {
        coords, surfaces, wireframes,
        structure: { overall: readStructure(s.structure?.overall), sets: readSets(s.structure?.sets), range: typeof range === 'number' && Number.isFinite(range) && range > 0 ? range : null },
    };
}

export const useModelStore = create<ModelState>()((set) => {
    const mapSurface = (id: string, fn: (s: SurfaceObject) => SurfaceObject) => set(state => {
        const surfaces = state.scene.surfaces.map(s => (s.id === id ? fn(s) : s));
        // Nothing changed: keep the scene (a new one would count as an edit)
        if (surfaces.every((s, i) => s === state.scene.surfaces[i])) return state;
        return { scene: { ...state.scene, surfaces } };
    });
    return {
        scene: EMPTY_SCENE,
        sceneLoads: 0,
        editingId: null,
        picking: false,
        drawing: false,
        hotLine: null,
        pendingReading: null,
        structureTool: null,
        suggestion: null,

        setSuggestion: (suggestion) => set(state => (state.suggestion === suggestion ? state : { suggestion })),

        setStructureTool: (tool) => set(state => {
            if (!tool) return state.structureTool ? { structureTool: null } : state;
            return { structureTool: tool, picking: false, drawing: false, pendingReading: null };
        }),

        setPendingReading: (reading) => set(state => {
            const next = state.editingId === null ? null : cleanReading(reading);
            if (!next) return state.pendingReading ? { pendingReading: null } : state;
            // It is placed with a click: lines are not being drawn meanwhile
            return { pendingReading: next, picking: true, drawing: false, structureTool: null };
        }),

        setEditing: (id, picking = false) => set(state => {
            const on = id !== null && picking;
            if (state.editingId === id && state.picking === on) return state;
            return {
                editingId: id, picking: on, drawing: state.editingId === id && on && state.drawing, hotLine: state.editingId === id ? state.hotLine : null,
                pendingReading: state.editingId === id && on ? state.pendingReading : null,
                structureTool: on ? null : state.structureTool,
            };
        }),

        setPicking: (picking) => set(state => {
            const on = picking && state.editingId !== null;
            return state.picking === on && (on || !state.drawing) ? state
                : { picking: on, drawing: on && state.drawing, pendingReading: on ? state.pendingReading : null, structureTool: on ? null : state.structureTool };
        }),

        setDrawing: (drawing) => set(state => {
            const on = drawing && state.editingId !== null;
            if (state.drawing === on && (!on || state.picking)) return state;
            return on ? { drawing: true, picking: true, pendingReading: null, structureTool: null } : { drawing: false };
        }),

        setHotLine: (lineId) => set(state => (state.hotLine === lineId ? state : { hotLine: lineId })),

        setScene: (scene) => set(state => ({
            scene: scene ?? EMPTY_SCENE, sceneLoads: state.sceneLoads + 1, editingId: null, picking: false, drawing: false, hotLine: null, pendingReading: null, structureTool: null,
            suggestion: null,
        })),

        setCoords: (coords) => set(state => ({ scene: { ...state.scene, coords: { ...coords } } })),

        setStructure: (overall) => set(state => {
            const next = readStructure(overall);
            if (JSON.stringify(next) === JSON.stringify(state.scene.structure?.overall ?? null)) return state;
            return { scene: { ...state.scene, structure: { ...state.scene.structure, overall: next } } };
        }),

        addReadingSets: (sets) => {
            const ids: string[] = [];
            set(state => {
                const had = state.scene.structure?.sets ?? [];
                let setNo = nextId('g', had.map(s => s.id)), readingNo = nextId('r', had.flatMap(s => s.readings.map(r => r.id)));
                const names = new Set(had.map(s => s.name));
                const added: ReadingSet[] = [];
                for (const s of sets) {
                    if (had.length + added.length >= MAX_SETS || s.readings.length === 0) continue;
                    let name = s.name.trim() || (s.kind === 'plane' ? 'Planes' : 'Lines');
                    for (let k = 2, base = name; names.has(name); k++) name = `${base} (${k})`;
                    names.add(name);
                    const id = `g${setNo++}`;
                    ids.push(id);
                    added.push({
                        id, name, kind: s.kind, source: s.source, color: SET_COLOURS[(had.length + added.length) % SET_COLOURS.length], visible: true,
                        // One set is what was measured of one thing; several are for choosing among
                        follow: s.follow ?? sets.length === 1,
                        readings: s.readings.map(r => ({ id: `r${readingNo++}`, p: [r.p[0], r.p[1], r.p[2]], dip: r.dip, direction: r.direction })),
                    });
                }
                if (added.length === 0) return state;
                return { scene: { ...state.scene, structure: { ...state.scene.structure, overall: state.scene.structure?.overall ?? null, sets: [...had, ...added] } } };
            });
            return ids;
        },

        updateReadingSet: (id, patch) => set(state => {
            const had = state.scene.structure?.sets ?? [];
            const sets = had.map(s => {
                if (s.id !== id) return s;
                const name = typeof patch.name === 'string' && patch.name.trim() ? patch.name.trim() : s.name;
                const next = { ...s, name, visible: patch.visible ?? s.visible, color: patch.color || s.color, follow: patch.follow ?? s.follow !== false };
                return next.name === s.name && next.visible === s.visible && next.color === s.color && next.follow === (s.follow !== false) ? s : next;
            });
            if (sets.every((s, i) => s === had[i])) return state;
            return { scene: { ...state.scene, structure: { ...state.scene.structure, overall: state.scene.structure?.overall ?? null, sets } } };
        }),

        setStructureRange: (range) => set(state => {
            const next = typeof range === 'number' && Number.isFinite(range) && range > 0 ? range : null;
            if ((state.scene.structure?.range ?? null) === next) return state;
            return { scene: { ...state.scene, structure: { ...state.scene.structure, overall: state.scene.structure?.overall ?? null, range: next } } };
        }),

        addHandReading: (kind, reading) => {
            const angles = kind === 'plane' ? cleanPlane(reading.dip, reading.direction) : cleanLine(reading.dip, reading.direction);
            if (!angles || !reading.p.every(Number.isFinite)) return null;
            let id: string | null = null;
            set(state => {
                const had = state.scene.structure?.sets ?? [];
                const own = had.find(s => s.source === 'hand' && s.kind === kind);
                if (own ? own.readings.length >= MAX_SET_READINGS : had.length >= MAX_SETS) return state;
                id = `r${nextId('r', had.flatMap(s => s.readings.map(r => r.id)))}`;
                const placed = { id, p: [reading.p[0], reading.p[1], reading.p[2]] as Vec3, ...angles };
                let name = handSetName(kind);
                for (let k = 2, base = name; !own && had.some(s => s.name === name); k++) name = `${base} (${k})`;
                const sets = own ? had.map(s => (s === own ? { ...s, readings: [...s.readings, placed] } : s))
                    : [...had, { id: `g${nextId('g', had.map(s => s.id))}`, name, kind, source: 'hand' as const, color: SET_COLOURS[had.length % SET_COLOURS.length], visible: true, follow: true, readings: [placed] }];
                return { scene: { ...state.scene, structure: { ...state.scene.structure, overall: state.scene.structure?.overall ?? null, sets } } };
            });
            return id;
        },

        removeReading: (setId, readingId) => set(state => {
            const had = state.scene.structure?.sets ?? [];
            const own = had.find(s => s.id === setId);
            if (!own || !own.readings.some(r => r.id === readingId)) return state;
            const readings = own.readings.filter(r => r.id !== readingId);
            const sets = readings.length === 0 ? had.filter(s => s !== own) : had.map(s => (s === own ? { ...s, readings } : s));
            return { scene: { ...state.scene, structure: { ...state.scene.structure, overall: state.scene.structure?.overall ?? null, sets } } };
        }),

        removeReadingSet: (id) => set(state => {
            const had = state.scene.structure?.sets ?? [];
            if (!had.some(s => s.id === id)) return state;
            return { scene: { ...state.scene, structure: { ...state.scene.structure, overall: state.scene.structure?.overall ?? null, sets: had.filter(s => s.id !== id) } } };
        }),

        addSurface: (init = {}) => {
            let id = '';
            set(state => {
                const { surfaces } = state.scene;
                const n = nextId('s', surfaces.map(s => s.id));
                id = `s${n}`;
                const names = new Set(surfaces.map(s => s.name));
                let name = init.name?.trim() || `Surface ${n}`;
                for (let k = 2; names.has(name); k++) name = `${init.name?.trim() || `Surface ${n}`} (${k})`;
                const surface = withReference({
                    id, name,
                    rule: readRule(init.rule),
                    points: withIds([], init.points ?? []),
                    polylines: [],
                    along: init.along ?? null,
                    refDirection: null,
                    params: { ...DEFAULT_SURFACE_PARAMS, ...init.params },
                    sides: init.sides ?? null,
                    columns: { side: null, distance: null, writtenFor: null },
                    color: PALETTE[(n - 1) % PALETTE.length],
                    opacity: 0.7,
                    visible: true,
                    showEdges: false,
                });
                return { scene: { ...state.scene, surfaces: [...surfaces, surface] } };
            });
            return id;
        },

        updateSurface: (id, patch) => mapSurface(id, s => ({
            ...s, ...patch,
            ...(patch.rule ? { rule: readRule(patch.rule) } : {}),
            params: patch.params ? { ...s.params, ...patch.params } : s.params,
        })),

        removeSurface: (id) => set(state => (state.scene.surfaces.some(s => s.id === id)
            ? {
                scene: { ...state.scene, surfaces: state.scene.surfaces.filter(s => s.id !== id) },
                editingId: state.editingId === id ? null : state.editingId,
                picking: state.editingId === id ? false : state.picking,
                drawing: state.editingId === id ? false : state.drawing,
                hotLine: state.editingId === id ? null : state.hotLine,
                pendingReading: state.editingId === id ? null : state.pendingReading,
            }
            : state)),

        addPoints: (id, points) => {
            if (points.length === 0) return;
            mapSurface(id, s => withReference({ ...s, points: [...s.points, ...withIds(s.points, points)] }));
        },

        movePoint: (id, pointId, p, snap, across) => mapSurface(id, s => ({
            ...s,
            // What was measured at a point moves with it
            points: s.points.map(q => (q.id === pointId ? { id: q.id, p: [p[0], p[1], p[2]], ...placed(snap, across, q.reading) } : q)),
        })),

        setPointReading: (id, pointId, reading) => mapSurface(id, s => {
            const at = s.points.findIndex(q => q.id === pointId);
            if (at < 0) return s;
            const { reading: had, ...rest } = s.points[at];
            const next = cleanReading(reading);
            if (!had && !next) return s;
            const points = s.points.slice();
            points[at] = next ? { ...rest, reading: next } : rest;
            return withReference({ ...s, points });
        }),

        removePoints: (id, pointIds) => {
            const gone = new Set(pointIds);
            mapSurface(id, s => (s.points.some(q => gone.has(q.id)) ? { ...s, points: s.points.filter(q => !gone.has(q.id)) } : s));
        },

        addPolyline: (id, line) => {
            const vertices = lineVertices(line.points), plane = readPlane(line.plane);
            if (!vertices || !plane) return null;
            let lineId: string | null = null;
            mapSurface(id, s => {
                lineId = `l${nextId('l', s.polylines.map(l => l.id))}`;
                return withReference({ ...s, polylines: [...s.polylines, { id: lineId, points: vertices, plane, flipped: false }] });
            });
            return lineId;
        },

        updatePolyline: (id, lineId, patch) => {
            const vertices = patch.points ? lineVertices(patch.points) : null;
            if (patch.points && !vertices) return;
            mapSurface(id, s => (s.polylines.some(l => l.id === lineId)
                ? withReference({
                    ...s,
                    polylines: s.polylines.map(l => (l.id === lineId
                        ? { ...l, ...(vertices ? { points: vertices } : {}), ...(patch.flipped === undefined ? {} : { flipped: patch.flipped }) }
                        : l)),
                })
                : s));
        },

        removePolylines: (id, lineIds) => {
            const gone = new Set(lineIds);
            mapSurface(id, s => (s.polylines.some(l => gone.has(l.id)) ? { ...s, polylines: s.polylines.filter(l => !gone.has(l.id)) } : s));
            set(state => (state.hotLine !== null && gone.has(state.hotLine) ? { hotLine: null } : state));
        },

        setWireframeFile: (file, parts) => set(state => {
            const existing = state.scene.wireframes;
            const kept = existing.filter(w => w.file !== file || w.part < parts.length);
            let n = nextId('w', existing.map(w => w.id));
            const added: WireframeObject[] = [];
            parts.forEach((part, k) => {
                if (kept.some(w => w.file === file && w.part === k)) return;
                added.push({
                    id: `w${n++}`,
                    // The object's own name first: it is what tells a file's objects apart in a narrow list
                    name: parts.length > 1 && part.name ? `${part.name} · ${file}` : file,
                    file, part: k,
                    color: WIREFRAME_PALETTE[(kept.length + added.length) % WIREFRAME_PALETTE.length],
                    // Lines only (strings, pit outlines): no surface to see through
                    opacity: part.solid ? 0.6 : 1,
                    visible: true,
                    showEdges: false,
                });
            });
            if (added.length === 0 && kept.length === existing.length) return state;
            return { scene: { ...state.scene, wireframes: [...kept, ...added] } };
        }),

        updateWireframe: (id, patch) => set(state => (state.scene.wireframes.some(w => w.id === id)
            ? { scene: { ...state.scene, wireframes: state.scene.wireframes.map(w => (w.id === id ? { ...w, ...patch } : w)) } }
            : state)),

        removeWireframes: (ids) => set(state => {
            const gone = new Set(ids);
            return state.scene.wireframes.some(w => gone.has(w.id))
                ? { scene: { ...state.scene, wireframes: state.scene.wireframes.filter(w => !gone.has(w.id)) } }
                : state;
        }),
    };
});
