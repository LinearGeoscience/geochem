/**
 * The project's 3D scene: the surfaces built in the 3D viewer and the
 * wireframes loaded into it.
 *
 * Project-level (shared by every 3D view) and saved in the .chem file. Only
 * what the user put in is stored: the sets of points and drawn lines, which
 * of them each surface uses, and its settings. Meshes are worked out from those (features/model/modelCache) and
 * rebuilt on load. A wireframe is stored as the name of its file and how it
 * is drawn; the file is kept in the project folder (features/model/wireframeFiles).
 *
 * Points and lines live in input sets (`scene.inputs`, features/model/inputs).
 * A surface's `points` and `polylines` are those of the sets it uses, kept up
 * to date here after every change: they are read everywhere and written
 * nowhere but through the actions below.
 *
 * `scene` is replaced, never mutated: its identity is the change signal for
 * undo (store/historyStore), the unsaved-changes flag and the refits.
 */
import { create } from 'zustand';
import { freeSetName as freeName, inputIds, ownSet, ownSetName, resolveScene } from '../features/model/inputs';
import { freeLinePoints, measuredPlaces, placesAcross, sampleLines } from '../features/model/lines';
import { unit } from '../features/model/plane';
import { cleanReading, readingSamples } from '../features/model/readings';
import { pointDirectionSamples } from '../features/model/ribbons';
import { DEFAULT_SHARE } from '../features/model/shell';
import { readShareOf } from '../features/model/proportion';
import { sheetInputTrend } from '../features/model/sheet';
import { MAX_SECTION_SETS, readSectionSets, sectionSetName, setNormal } from '../features/model/sectionSets';
import { freeViewName, MAX_SAVED_VIEWS, readSavedViews, type SavedView } from '../features/model/savedViews';
import { freeSystemName, isVein, looseStops, MAX_SYSTEM_VEINS, MAX_VEIN_SYSTEMS, mayStopAt, readVeinSystems, reorder, stopRule, systemOf, systemsFromSets } from '../features/model/veinSystem';
import {
    cleanCutoffs, freeNumericName, MAX_CUTOFFS, MAX_NUMERIC_MODELS, numericHome, numericRule, readNumericModels, shellLabel, shellOpacities, shellRamp, shellRuleAt,
    type NumericRule,
} from '../features/model/numericModels';
import { readShellDomain } from '../features/model/shellDomains';
import { withBlockParts } from '../features/model/blockParts';
import { readStructure } from '../features/model/structure';
import { readControl } from '../features/model/contactControl';
import { cleanLine, cleanPlane, handSetName, MAX_SET_READINGS, MAX_SETS, readSets, SET_COLOURS, type NewReadingSet } from '../features/model/structureReadings';
import type { Suggestion } from '../features/model/suggest';
import type {
    BodyRule, ContactRule, InputSet, PointSetRole, LineNode, ModelScene, OverallStructure, Plane, ReadingSet, SceneLine, SectionSet, ShellRule, PointReading, SceneCoords, ScenePoint, ScenePolyline, StructureTool, SurfaceObject,
    SurfaceOutline, SurfaceParams, SurfaceRule, SurfaceUse, Vec3,
    Reassignment, UnitMap, WireframeObject,
} from '../features/model/types';
import { carryReassigned, carryRule, MAX_UNIT_MAPS, readUnitMaps, reassign, type Regrouped } from '../features/model/units';
import { MAX_CONTACTS, MAX_FAULTS, MAX_MODELS, readModels } from '../features/model/geoModel';
import type { Box3, Domain, FaultSide, GeoModel, ModelBoundary, ModelContact, ModelFault, NumericModel } from '../features/model/types';
import { addFolder, moveToFolder, normalizeFolder, readFolders, removeFolder, renameFolder } from '../features/model/folders';
import type { FolderRoot } from '../features/model/objectKeys';

export const EMPTY_SCENE: ModelScene = { coords: null, inputs: [], surfaces: [], wireframes: [], structure: { overall: null, sets: [], range: null } };

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
export type NewPoint = Pick<ScenePoint, 'p' | 'snap' | 'across' | 'reading' | 'direction'>;

/** What clicks in a view do to the surface being edited by hand (see ModelState.marking) */
export type HandTool = 1 | -1 | 'take' | 'link' | 'hole' | 'contact';
/** Places marked on a side, not another hand tool */
export const marksSide = (tool: HandTool | null): tool is 1 | -1 => tool === 1 || tool === -1;

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
    /** The nodes of lines go on a drillhole when placed or dragged onto one (session only). A line with a node off its slice is a line in space */
    snapNodes: boolean;
    setSnapNodes: (on: boolean) => void;
    /** A dip reading waiting for its place: the next point placed (or clicked) in a view takes it (session only) */
    pendingReading: PointReading | null;
    /** Arm a reading (clicks then place points) or, with null, put it down */
    setPendingReading: (reading: PointReading | null) => void;
    /**
     * Clicks in a view mark places the surface being edited must pass on one
     * side of: its first side (1) or its second (-1). Session only; null:
     * clicks place points as usual. Only for a surface made from logging.
     * 'take': clicks on a hole give the stretch of its units there to the
     * vein being edited, one of several those units make (veinSet.ts).
     * 'link': two clicks make a link from one to the other. 'hole': a click
     * on a hole keeps the surface clear of it. 'contact': its contacts are
     * shown and dragged along their holes (useHandControls).
     */
    marking: HandTool | null;
    /** Take up marking places on a side (clicks then mark, not place points), another hand tool, or, with null, put it down */
    setMarking: (side: HandTool | null) => void;
    /** How far on its side a place marked from now on is held, at least, m (session only; null: only just clear of the surface) */
    markBy: number | null;
    setMarkBy: (by: number | null) => void;
    /** How many times as far along its sheets as across a lens marked from now on runs (session only; null: as the tool has it, see `lensTimes`) */
    markAlong: number | null;
    setMarkAlong: (along: number | null) => void;
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
    /** A new set of sections or plans (named for its planes when no name is given); its id, or null when it cannot be kept */
    addSectionSet: (set: Omit<SectionSet, 'id' | 'name'> & { name?: string }) => string | null;
    updateSectionSet: (id: string, patch: Partial<Omit<SectionSet, 'id'>>) => void;
    removeSectionSet: (id: string) => void;
    /**
     * A numeric model with a grade shell for each cut-off (named for its column when no name is given); its id, or
     * null when it cannot be kept (no column, no cut-off, or as many models as there can be)
     */
    addNumericModel: (init: { name?: string; rule: NumericRule; cutoffs: readonly number[]; domain?: Domain | null }) => string | null;
    /**
     * Rename a numeric model, change how its shells are found (all of them at once), or set its cut-offs: a shell is
     * made for a new one, and the shell of one taken away is removed (a locked shell is kept, and its cut-off with it)
     */
    /** `trend`: a global trend of their own for every shell of it (null: none, they follow the project's) */
    updateNumericModel: (id: string, patch: { name?: string; rule?: NumericRule; cutoffs?: readonly number[]; domain?: Domain | null; trend?: OverallStructure | null }) => void;
    /** Remove a numeric model and its shells (a locked shell stays, as a shell of its own) */
    removeNumericModel: (id: string) => void;
    /**
     * A vein system of veins that are there (surfaces, by id, in order; one that is no vein, or is in a system
     * already, is left out); its id, or null when none is left or there are as many systems as there can be
     */
    addVeinSystem: (init: { name?: string; veins: readonly string[] }) => string | null;
    /** Rename a vein system, or put its veins in a new order (a vein that would then stop at one after it stops at nothing) */
    updateVeinSystem: (id: string, patch: { name?: string; veins?: readonly string[] }) => void;
    /** A new vein of a system, made as its first vein is and with no stretches of its own yet; its id (null: it cannot be made) */
    addSystemVein: (id: string) => string | null;
    /**
     * Where a vein of a system stops: at a vein before it in the system's order, on one side of that vein's
     * reference surface (null: it stops at nothing). False: it is in no system, or may not stop there.
     */
    setVeinStop: (surfaceId: string, at: { surface: string; side: 1 | -1 } | null) => boolean;
    /** Remove a vein system and its veins (a locked vein stays, a vein of its own) */
    removeVeinSystem: (id: string) => void;
    /** A vein system no more: its veins stay, each a vein of its own */
    dissolveVeinSystem: (id: string) => void;
    /** A named view kept with the scene (its name made free of the others'); its id, or null when it cannot be kept */
    addView: (view: Omit<SavedView, 'id'>) => string | null;
    /** Rename a view, or put another look in its place */
    updateView: (id: string, patch: Partial<Omit<SavedView, 'id'>>) => void;
    removeView: (id: string) => void;
    /** A new unit map (a name made when none is given); its id, or null when it cannot be kept */
    addUnitMap: (map: Omit<UnitMap, 'id' | 'name' | 'reassigned'> & { name?: string; reassigned?: Reassignment[] }) => string | null;
    /** Rename a map, or set its units' colours or order (a change of which codes make which unit goes through `regroupUnits`) */
    updateUnitMap: (id: string, patch: Partial<Pick<UnitMap, 'name' | 'units'>>) => void;
    /**
     * Group, split or rename units: the surfaces that read the map and the stretches given by hand follow (units.ts
     * `carryRule`). `given`: stretches given to units of the regrouped map in the same step (a unit made its occurrences:
     * which stretch is which), so one undo takes both back.
     */
    regroupUnits: (id: string, regrouped: Regrouped, given?: readonly { unit: string; stretches: { hole: string; from: number; to: number }[] }[]) => void;
    /** Give stretches of holes to a unit ('' = as if not logged), or put them back as logged (null) */
    reassignUnits: (id: string, stretches: { hole: string; from: number; to: number }[], unit: string | null) => void;
    /** Remove a map: surfaces that read it go back to the codes its units were made of */
    removeUnitMap: (id: string) => void;
    /** A new geological model (null: there are as many as there can be). Its base unit is the last of the units it reads, when it reads any */
    /** A new model. Its box, its top and the size of its cells can be given with it (the New geological model dialog): one step to undo */
    addModel: (init?: Partial<Pick<GeoModel, 'name' | 'unitMap' | 'base' | 'cell' | 'byBlock'>> & { boundary?: Partial<Pick<ModelBoundary, 'box' | 'top' | 'near'>> }) => string | null;
    /** Change a model. In `boundary`, null takes a part away (the box: back to the box of the data) */
    updateModel: (id: string, patch: Partial<Pick<GeoModel, 'name' | 'unitMap' | 'base' | 'units' | 'cell' | 'auto' | 'columnFor' | 'byBlock'>> & { column?: string | null; blockColumn?: string | null; boundary?: { box?: Box3 | null; outline?: SurfaceOutline | null; top?: string | null; inside?: { model: string; unit: string } | null; near?: { reach: number | null } | null } }) => void;
    removeModel: (id: string) => void;
    /** Put a surface (or a mesh) in a model's age order, as the youngest unless `at` says where (0: the youngest). Null: it is there already, or there is no room */
    addModelContact: (modelId: string, contact: Omit<ModelContact, 'id'>, at?: number) => string | null;
    updateModelContact: (modelId: string, contactId: string, patch: Partial<Omit<ModelContact, 'id'>>) => void;
    /** Move a contact in the age order (0: the youngest) */
    moveModelContact: (modelId: string, contactId: string, to: number) => void;
    removeModelContact: (modelId: string, contactId: string) => void;
    /** Make a surface (or a mesh) a fault of a model. Null: it is in the model already (as a fault or a contact), or there is no room */
    addModelFault: (modelId: string, fault: { surface?: string; mesh?: string }) => string | null;
    updateModelFault: (modelId: string, faultId: string, patch: Partial<Pick<ModelFault, 'ends' | 'off' | 'extent' | 'cutBy'>>) => void;
    /** Take a fault out of a model: what ended on it runs on, and contacts limited to a side of it are limited no more */
    removeModelFault: (modelId: string, faultId: string) => void;
    /** Put objects (by key: `surface:<id>`, `inputs:<id>`, `readings:<id>`, `wireframe:<id>`) in a folder of their group (null: at the top) */
    moveToFolder: (objectKeys: string[], path: string | null) => void;
    /** A new, empty folder ("a/b" for one in a folder) */
    addFolder: (root: FolderRoot, path: string) => void;
    /** A folder renamed or moved: `to` is its whole new path; what is in it goes with it */
    renameFolder: (root: FolderRoot, from: string, to: string) => void;
    /** A folder removed: what is in it goes up into the folder it was in */
    removeFolder: (root: FolderRoot, path: string) => void;
    /** A reading placed by hand: it joins the set of its kind set by hand (made when there is none). Returns its id, or null when it cannot be kept */
    addHandReading: (kind: ReadingSet['kind'], reading: { p: Vec3; dip: number; direction: number }) => string | null;
    /** Take one reading out of its set (a set left empty goes too) */
    removeReading: (setId: string, readingId: string) => void;
    addSurface: (init?: NewSurface) => string;
    updateSurface: (id: string, patch: Partial<Omit<SurfaceObject, 'id' | 'points' | 'polylines' | 'uses' | 'params'>> & { params?: Partial<SurfaceParams> }) => void;
    /** Remove a surface, and the sets made for it that no other surface uses. A locked surface is kept (and a locked set of its own stays) */
    removeSurface: (id: string) => void;
    /** A new, empty set of points or lines; returns its id */
    addInputSet: (kind: InputSet['kind'], init?: { name?: string; folder?: string | null; color?: string }) => string;
    /**
     * A set of named points with a role made in one step (drill pads, target points); returns its id.
     * `replace`: a set of the same name and role has its points replaced instead (its id, colour and showing kept).
     */
    addNamedPoints: (init: { name: string; role: PointSetRole; color: string }, points: { p: Vec3; name: string }[], opts?: { replace?: boolean }) => string;
    /** How a set with a role is drawn: dots or crosses */
    setPointSetMark: (id: string, mark: 'dot' | 'cross') => void;
    updateInputSet: (id: string, patch: Partial<Pick<InputSet, 'name' | 'color' | 'visible' | 'locked' | 'folder'>>) => void;
    /** Remove a set from the scene: every surface that uses it loses its points or lines. A locked set is kept */
    removeInputSet: (id: string) => void;
    /** Make a surface use a set, or stop using it. The set itself is not changed */
    setSurfaceUse: (surfaceId: string, setId: string, on: boolean) => void;
    /** How much a set a surface uses counts for in its fit: above 0 and below 1, or in full (1 or more, null) */
    setUseWeight: (surfaceId: string, setId: string, weight: number | null) => void;
    /**
     * A copy of a surface as it is now, to keep while the surface is changed
     * further: locked, with copies of its own of every set the surface uses.
     * Returns its id (null: no such surface).
     */
    copySurface: (id: string) => string | null;
    /**
     * A surface like another, fitted in one fault block of a model: it uses the
     * same sets of points and lines (they are not copied) and the same rule,
     * and is fitted to what of them is on the sides given. Null: no such surface.
     */
    addSurfaceWithin: (id: string, within: { model: string; sides: FaultSide[] }, name?: string) => string | null;
    /** Turn every line of a set over for one surface (the other surfaces that use the set keep them as they have them) */
    flipSetFor: (surfaceId: string, setId: string) => void;
    /**
     * The points and lines below are those of the sets the surface uses. What
     * is added goes into the set made for the surface (one is made when it has
     * none); a move or a removal changes the set the point or line is in, and
     * so every surface that uses it. A locked set is left as it is.
     */
    addPoints: (id: string, points: NewPoint[]) => void;
    /** Move a point; `snap` and `across` say how it sits now (left out: neither) */
    movePoint: (id: string, pointId: string, p: Vec3, snap?: ScenePoint['snap'], across?: Vec3 | null) => void;
    removePoints: (id: string, pointIds: string[]) => void;
    /** Give a point a dip reading, change it, or (null) take it away. The point stays where it is */
    setPointReading: (id: string, pointId: string, reading: PointReading | null) => void;
    /**
     * A line: drawn on a slice (`plane`), or in space (no plane; `across`: the normal of the slice it was drawn
     * over, which the surface crosses). `nodes`: what is known of each of its vertices.
     * Returns its id, or null when it has no length
     */
    addPolyline: (id: string, line: NewLine) => string | null;
    /** Several lines in one edit (one undo step): the id of each, null for one that could not be read */
    addPolylines: (id: string, lines: readonly NewLine[]) => (string | null)[];
    /**
     * Redraw a line (new vertices), turn it over (for this surface only), let it go from its slice
     * (`plane: null`: it is then a line in space, and the surface still crosses the slice it was on) or hold it to one. What was known of its nodes goes with
     * them: a node that moves keeps its dip tick but not its drillhole, unless `nodes` says what is known of each now.
     */
    updatePolyline: (id: string, lineId: string, patch: { points?: Vec3[]; flipped?: boolean; plane?: Plane | null; nodes?: (LineNode | null)[] }) => void;
    /** Give a node of a line a dip tick, change it, or (null) take it away. The node stays where it is */
    setNodeReading: (id: string, lineId: string, vertex: number, reading: PointReading | null) => void;
    /**
     * Give nodes of lines a direction the surface runs in (ribbons.ts), or
     * (null) take theirs away: one edit. Nodes in a locked set are left as they
     * are and counted.
     */
    setNodeDirections: (id: string, picks: readonly NodePick[], direction: Vec3 | null) => { changed: number; locked: number };
    /** Give points a line the surface runs along there, or (null) take theirs away: one edit */
    setPointDirections: (id: string, pointIds: readonly string[], direction: Vec3 | null) => { changed: number; locked: number };
    /** Make lines run as smooth curves through their nodes, or straight from node to node again */
    setLinesSmooth: (id: string, lineIds: readonly string[], on: boolean) => void;
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

/** A line to add to a surface */
type NewLine = { points: Vec3[]; plane?: Plane | null; across?: Vec3 | null; nodes?: (LineNode | null)[]; smooth?: boolean };

/** One node of one line */
export interface NodePick { line: string; vertex: number }

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
function placed(snap: ScenePoint['snap'] | null | undefined, across: unknown, reading?: unknown, direction?: unknown): Pick<ScenePoint, 'snap' | 'across' | 'reading' | 'direction'> {
    const normal = isVec3(across) ? unit(across) : null;
    const measured = cleanReading(reading);
    const along = storedDirection(direction);
    return {
        ...(snap ? { snap: { hole: snap.hole, depth: snap.depth } } : {}), ...(normal ? { across: normal } : {}), ...(measured ? { reading: measured } : {}),
        ...(along ? { direction: along } : {}),
    };
}

/** A direction as stored: unit length (one that already is comes back exactly as it was, so a Leapfrog tangent read and written again is unchanged). Null when it is not one. */
function storedDirection(v: unknown): Vec3 | null {
    return isVec3(v) ? asUnit(v) : null;
}

/** New points with ids no point of the scene has (`existing`: every point id there is). */
function withIds(existing: Iterable<string>, added: NewPoint[]): ScenePoint[] {
    let n = nextId('p', existing);
    return added.map(a => ({ id: `p${n++}`, p: [a.p[0], a.p[1], a.p[2]], ...placed(a.snap, a.across, a.reading, a.direction) }));
}

/** The scene with one of its sets changed (the same scene when `fn` gives the set back as it was). */
function mapSet(scene: ModelScene, setId: string, fn: (set: InputSet) => InputSet): ModelScene {
    const sets = scene.inputs ?? [];
    const next = sets.map(s => (s.id === setId ? fn(s) : s));
    return next.every((s, i) => s === sets[i]) ? scene : { ...scene, inputs: next };
}

/** The set made for a surface that what is placed or drawn for it goes into; made (and used by the surface) when there is none. */
function ensureOwn(scene: ModelScene, surfaceId: string, kind: InputSet['kind']): { scene: ModelScene; setId: string } | null {
    const surface = scene.surfaces.find(s => s.id === surfaceId);
    if (!surface) return null;
    const own = ownSet(scene, surface, kind);
    if (own) return { scene, setId: own.id };
    const sets = scene.inputs ?? [];
    const base = { id: `i${nextId('i', sets.map(s => s.id))}`, name: freeName(ownSetName(surface.name, kind), sets), color: surface.color, visible: true, locked: false, folder: null, owner: surface.id };
    const made: InputSet = kind === 'points' ? { ...base, kind: 'points', points: [] } : { ...base, kind: 'lines', lines: [] };
    return {
        scene: { ...scene, inputs: [...sets, made], surfaces: scene.surfaces.map(s => (s === surface ? { ...s, uses: [...(s.uses ?? []), { set: made.id }] } : s)) },
        setId: made.id,
    };
}

let following = false;

/**
 * Make a change that only records what a fit worked out from the scene (the
 * overall plane a surface is held to): it is not an edit, and leaves the
 * project as saved, or as unsaved, as it was.
 */
export function asFollowing(change: () => void): void {
    const was = following;
    following = true;
    try {
        change();
    } finally {
        following = was;
    }
}

/** True while a change made with `asFollowing` is being written. */
export const isFollowing = (): boolean => following;

/** The sets a surface uses that can be changed (not locked). */
function openSets(scene: ModelScene, surfaceId: string): InputSet[] {
    const used = new Set((scene.surfaces.find(s => s.id === surfaceId)?.uses ?? []).map(u => u.set));
    return (scene.inputs ?? []).filter(s => used.has(s.id) && !s.locked);
}

/**
 * Fix the surface's positive side the first time its points define a plane,
 * so adding points later can tilt the surface but never swap its sides.
 */
function withReference(s: SurfaceObject): SurfaceObject {
    if (s.refDirection) return s;
    const placed = s.points.flatMap(p => p.p);
    // (Its lines in space are places it passes through, as its points are)
    const free = freeLinePoints(s.polylines);
    const points = free.length > 0 ? [...placed, ...free] : placed;
    const plane = sheetInputTrend({
        points, pointAcross: placesAcross(s.points, s.polylines, points.length / 3),
        oriented: sampleLines(s.polylines) ?? undefined, readings: readingSamples(measuredPlaces(s.points, s.polylines), points),
        directed: pointDirectionSamples(s.points, points), along: s.along,
    });
    return plane ? { ...s, refDirection: plane.normal } : s;
}

/** What is known of a line's nodes, as stored: one entry per vertex. Undefined when nothing is known of any. */
function readNodes(raw: readonly unknown[], count: number): (LineNode | null)[] | undefined {
    let any = false;
    const out = Array.from({ length: count }, (_, i): LineNode | null => {
        const n = raw[i] as Partial<LineNode> | null | undefined;
        if (!n || typeof n !== 'object') return null;
        const reading = cleanReading(n.reading);
        const snap = n.snap && typeof n.snap.hole === 'string' && Number.isFinite(n.snap.depth) ? { hole: n.snap.hole, depth: n.snap.depth } : null;
        const direction = storedDirection(n.direction);
        if (!reading && !snap && !direction) return null;
        any = true;
        return { ...(reading ? { reading } : {}), ...(snap ? { snap } : {}), ...(direction ? { direction } : {}) };
    });
    return any ? out : undefined;
}

/**
 * A line as stored: its vertices (finite, none on top of the one before) and
 * what is known of each (`nodes`, by the place of its vertex in `points`).
 * Null when fewer than two vertices are left.
 */
function lineShape(points: unknown, nodes?: unknown): { vertices: Vec3[]; nodes?: (LineNode | null)[] } | null {
    const vertices: Vec3[] = [], known: unknown[] = [];
    const given = Array.isArray(nodes) ? nodes : null;
    (Array.isArray(points) ? points : []).forEach((p, i) => {
        if (!isVec3(p)) return;
        const last = vertices[vertices.length - 1];
        if (last && Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) <= 1e-9) return;
        vertices.push([p[0], p[1], p[2]]);
        known.push(given?.[i]);
    });
    if (vertices.length < 2) return null;
    const kept = given ? readNodes(known, vertices.length) : undefined;
    return kept ? { vertices, nodes: kept } : { vertices };
}

/**
 * What was known of a line's nodes, carried to its new vertices. A vertex
 * that is where a node was keeps all that node had (so a node put in or taken
 * out leaves the others theirs). With as many vertices as before, one that is
 * somewhere new is the node that had its place, moved: it keeps its dip tick
 * and direction but not the drillhole it was on.
 */
function carryNodes(line: SceneLine, vertices: readonly Vec3[]): (LineNode | null)[] | undefined {
    const had = line.nodes;
    if (!had) return undefined;
    const same = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= 1e-9;
    const taken = new Set<number>();
    let from = 0;
    const from_ = vertices.map(v => {
        for (let j = from; j < line.points.length; j++) {
            if (same(v, line.points[j])) { from = j + 1; taken.add(j); return j; }
        }
        return -1;
    });
    const moved = vertices.length === line.points.length;
    const out = from_.map((j, i): LineNode | null => {
        if (j >= 0) return had[j] ?? null;
        const was = moved && !taken.has(i) ? had[i] : null;
        return was?.reading || was?.direction ? { ...(was.reading ? { reading: was.reading } : {}), ...(was.direction ? { direction: was.direction } : {}) } : null;
    });
    return out.some(Boolean) ? out : undefined;
}

/** A line with these nodes (none known: the line carries no list). */
function withNodes<L extends SceneLine>(line: L, nodes: (LineNode | null)[] | undefined): L {
    const { nodes: _had, ...rest } = line;
    return (nodes ? { ...rest, nodes } : rest) as L;
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
        // A proportion: the share of logged units, drawn at a share (how its pieces are prepared is not a grade shell's)
        if (shell.of !== undefined) {
            const of = readShareOf(shell.of);
            if (!of || !(shell.cutoff! > 0 && shell.cutoff! < 1)) return { kind: 'sheet' };
            return {
                kind: 'shell', column: shell.column, cutoff: shell.cutoff!, log: false, composite: null, topCut: null, band: false,
                reach: Number.isFinite(shell.reach) && shell.reach! > 0 && shell.reach! <= 10 ? shell.reach! : null,
                ...(Number.isFinite(shell.local) && shell.local! > 0 ? { local: shell.local! } : {}),
                of,
            };
        }
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
    const table = {
        ...(typeof r.table === 'string' && r.table ? { table: r.table } : {}),
        ...(typeof r.units === 'string' && r.units ? { units: r.units } : {}),
    };
    // What was changed by hand, only when something was
    const control = readControl(r.control);
    const byHand = control ? { control } : {};
    // A unit is on one side only
    if (r.kind === 'body') {
        const inside = units(r.inside);
        const end = r.vein && typeof r.vein === 'object' ? r.vein.endsOn : null;
        const endsOn = end && typeof end === 'object' && typeof end.surface === 'string' && end.surface
            ? { endsOn: { surface: end.surface, side: end.side === -1 ? -1 as const : 1 as const, ...(end.middle === true ? { middle: true as const } : {}) } } : {};
        const join = r.vein && typeof r.vein === 'object' && typeof r.vein.join === 'number' && Number.isFinite(r.vein.join) && r.vein.join > 0 ? { join: r.vein.join } : {};
        // The plane its sheets lie in, given (a dip and the direction it dips towards), and the stretches that are its own when it is one vein of several
        const lie = r.vein && typeof r.vein === 'object' ? r.vein.plane : null;
        const plane = lie && typeof lie === 'object' && Number.isFinite(lie.dip) && Number.isFinite(lie.dipDirection) && lie.dip >= 0 && lie.dip <= 90
            ? { plane: { dip: lie.dip as number, dipDirection: (((lie.dipDirection as number) % 360) + 360) % 360 } } : {};
        const own = r.vein && typeof r.vein === 'object' && Array.isArray(r.vein.picks)
            ? { picks: (r.vein.picks as unknown[]).filter((k): k is { hole: string; depth: number } => !!k && typeof k === 'object' && typeof (k as { hole?: unknown }).hole === 'string' && Number.isFinite((k as { depth?: unknown }).depth)).map(k => ({ hole: k.hole, depth: k.depth })) }
            : {};
        const vein = r.vein && typeof r.vein === 'object' ? { vein: { least: Number.isFinite(r.vein.least) && r.vein.least > 0 ? r.vein.least : 0, ...join, ...plane, ...('join' in join && r.vein.thickness === 'net' ? { thickness: 'net' as const } : {}), ...(r.vein.held === true ? { held: true as const } : {}), ...endsOn, ...own } } : {};
        // Thin sheets built as a volume (not on a vein): how far it is carried along them, and their plane when given
        const thin = !r.vein && r.sheets && typeof r.sheets === 'object' ? r.sheets : null;
        const sheetLie = thin?.plane;
        const sheets = thin ? {
            sheets: {
                ...(Number.isFinite(thin.strength) && thin.strength! >= 1 ? { strength: thin.strength! } : {}),
                ...(sheetLie && typeof sheetLie === 'object' && Number.isFinite(sheetLie.dip) && Number.isFinite(sheetLie.dipDirection) && sheetLie.dip >= 0 && sheetLie.dip <= 90
                    ? { plane: { dip: sheetLie.dip, dipDirection: ((sheetLie.dipDirection % 360) + 360) % 360 } } : {}),
                ...(Number.isFinite(thin.join) && thin.join! > 0 ? { join: thin.join! } : {}),
                ...(Number.isFinite(thin.least) && thin.least! > 0 ? { least: thin.least! } : {}),
            },
        } : {};
        return { kind: 'body', column: r.column, ...table, inside, ignore: units(r.ignore).filter(u => !inside.includes(u)), ...gaps, ...byHand, ...vein, ...sheets };
    }
    const sideA = units(r.sideA);
    // (A pile is of two layers or more)
    const pile = units(r.pile);
    return { kind: 'contact', column: r.column, ...table, sideA, sideB: units(r.sideB).filter(u => !sideA.includes(u)), ...gaps, ...(pile.length > 1 ? { pile } : {}), ...byHand };
}

/** An optional folder field as saved: kept only when there is one, so scenes without folders read back as they were */
const filedIn = (raw: unknown): { folder?: string } => {
    const folder = normalizeFolder(raw);
    return folder ? { folder } : {};
};

function readPlane(plane: unknown): Plane | null {
    const p = plane as Partial<Plane> | null | undefined;
    const normal = p && isVec3(p.normal) ? unit(p.normal) : null;
    return normal && isVec3(p!.point) ? { normal, point: [p!.point[0], p!.point[1], p!.point[2]] } : null;
}

const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);

/** Points as stored; one that cannot be read, or whose id is `taken`, is dropped. */
function readPoints(raw: unknown, taken: Set<string> = new Set()): ScenePoint[] {
    const points: ScenePoint[] = [];
    for (const p of (Array.isArray(raw) ? raw : []) as Partial<ScenePoint>[]) {
        if (!p || typeof p.id !== 'string' || !isVec3(p.p) || taken.has(p.id)) continue;
        taken.add(p.id);
        const snap = p.snap && typeof p.snap.hole === 'string' && Number.isFinite(p.snap.depth) ? { hole: p.snap.hole, depth: p.snap.depth } : null;
        points.push({ id: p.id, p: [p.p[0], p.p[1], p.p[2]], ...(typeof p.name === 'string' && p.name ? { name: p.name } : {}), ...placed(snap, p.across, p.reading, p.direction) });
    }
    return points;
}

/** Lines as stored; one that cannot be read, or whose id is `taken`, is dropped. */
function readLines(raw: unknown, taken: Set<string> = new Set()): ScenePolyline[] {
    const lines: ScenePolyline[] = [];
    for (const l of (Array.isArray(raw) ? raw : []) as Partial<ScenePolyline>[]) {
        // (A line with no slice is a line in space)
        const shape = lineShape(l?.points, l?.nodes);
        if (!l || typeof l.id !== 'string' || !shape || taken.has(l.id)) continue;
        taken.add(l.id);
        const plane = readPlane(l.plane);
        const across = !plane && isVec3(l.across) ? asUnit(l.across) : null;
        lines.push({
            id: l.id, points: shape.vertices, plane, ...(across ? { across } : {}), ...(shape.nodes ? { nodes: shape.nodes } : {}),
            ...(l.smooth === true ? { smooth: true as const } : {}), flipped: !!l.flipped,
        });
    }
    return lines;
}

/** The scene's input sets as stored. Point and line ids are told apart across all of them. */
function readInputs(raw: unknown): InputSet[] {
    const sets: InputSet[] = [];
    const points = new Set<string>(), lines = new Set<string>();
    for (const o of (Array.isArray(raw) ? raw : []) as (Partial<Omit<InputSet, 'kind'>> & { kind?: unknown; points?: unknown; lines?: unknown })[]) {
        if (!o || typeof o.id !== 'string' || !o.id || sets.some(x => x.id === o.id) || (o.kind !== 'points' && o.kind !== 'lines')) continue;
        const base = {
            id: o.id,
            name: typeof o.name === 'string' && o.name.trim() ? o.name.trim() : o.kind === 'points' ? `Points ${sets.length + 1}` : `Lines ${sets.length + 1}`,
            color: typeof o.color === 'string' && o.color ? o.color : PALETTE[sets.length % PALETTE.length],
            visible: o.visible !== false,
            locked: !!o.locked,
            folder: normalizeFolder(o.folder),
            ...(typeof o.owner === 'string' && o.owner ? { owner: o.owner } : {}),
        };
        const look = o as { role?: unknown; mark?: unknown };
        const role = look.role === 'pads' || look.role === 'targets' ? { role: look.role as PointSetRole } : {};
        const mark = look.mark === 'cross' || look.mark === 'dot' ? { mark: look.mark as 'dot' | 'cross' } : {};
        if (o.kind === 'points') sets.push({ ...base, kind: 'points', points: readPoints(o.points, points), ...role, ...mark });
        else sets.push({ ...base, kind: 'lines', lines: readLines(o.lines, lines).map(({ flipped: _flipped, ...line }): SceneLine => line) });
    }
    return sets;
}

/** What a set counts for in a surface, as given: above 0 and below 1, else in full (undefined) */
export const cleanWeight = (w: unknown): number | undefined =>
    (typeof w === 'number' && Number.isFinite(w) && w < 1 ? Math.max(0.05, Math.round(w * 100) / 100) : undefined);

/** A surface's uses as stored (undefined: it has none stored, and carries its points and lines itself). */
function readUses(raw: unknown): SurfaceUse[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const uses: SurfaceUse[] = [];
    for (const u of raw as Partial<SurfaceUse>[]) {
        if (!u || typeof u.set !== 'string' || !u.set) continue;
        const flipped = Array.isArray(u.flipped) ? u.flipped.filter((id): id is string => typeof id === 'string') : [];
        const weight = cleanWeight(u.weight);
        uses.push({ set: u.set, ...(flipped.length ? { flipped } : {}), ...(weight !== undefined ? { weight } : {}) });
    }
    return uses;
}

/** The fault block a surface is fitted in, as saved (nothing: none) */
function readWithin(raw: unknown): { within?: { model: string; sides: FaultSide[] } } {
    const w = raw as { model?: unknown; sides?: unknown } | null | undefined;
    if (!w || typeof w.model !== 'string' || !w.model || !Array.isArray(w.sides)) return {};
    const sides: FaultSide[] = [];
    for (const e of w.sides as Partial<FaultSide>[]) {
        if (e && typeof e.fault === 'string' && e.fault && !sides.some(x => x.fault === e.fault)) sides.push({ fault: e.fault, side: e.side === -1 ? -1 : 1 });
    }
    return sides.length > 0 ? { within: { model: w.model, sides } } : {};
}

/** The surface another runs alongside, as saved (nothing: none) */
/** The unit of a model a shell is kept inside, as saved, made safe to use */
export function readDomain(raw: unknown): { domain?: Domain } {
    const domain = readShellDomain(raw);
    return domain ? { domain } : {};
}

export function readConform(raw: unknown): { conform?: { surface: string; by?: number } } {
    const c = raw as { surface?: unknown; by?: unknown } | null | undefined;
    if (!c || typeof c.surface !== 'string' || !c.surface) return {};
    return { conform: { surface: c.surface, ...(typeof c.by === 'number' && Number.isFinite(c.by) && c.by !== 0 ? { by: c.by } : {}) } };
}

/**
 * A saved scene in today's shape; anything unreadable is dropped rather than
 * failing the project. A surface saved with its own points and lines (a
 * project from before inputs were objects) is given sets of its own.
 */
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
        // Saved with the sets it uses: its points and lines come from them. Saved before there were sets: it carries them itself
        const uses = readUses(o.uses);
        const points = uses ? [] : readPoints(o.points);
        const polylines = uses ? [] : readLines(o.polylines);
        const params = (o.params ?? {}) as Partial<SurfaceParams>;
        surfaces.push({
            id: o.id,
            name: typeof o.name === 'string' && o.name ? o.name : `Surface ${surfaces.length + 1}`,
            rule: readRule(o.rule),
            ...(uses ? { uses } : {}),
            points,
            polylines,
            along: isVec3(o.along) ? o.along : null,
            refDirection: isVec3(o.refDirection) ? o.refDirection : null,
            // (Kept to the last digit: the next fit is then made about exactly the plane the last one was)
            ...(isVec3(o.trendHeld) && Math.abs(Math.hypot(o.trendHeld[0], o.trendHeld[1], o.trendHeld[2]) - 1) < 1e-6 ? { trendHeld: o.trendHeld } : {}),
            ...readWithin(o.within),
            ...(typeof o.blockOf === 'string' && o.blockOf ? { blockOf: o.blockOf } : {}),
            ...readConform(o.conform),
            ...readDomain(o.domain),
            params: {
                follow: Number.isFinite(params.follow) ? Math.min(1, Math.max(0, params.follow!)) : 0,
                extent: params.extent === 'box' || params.extent === 'outline' ? params.extent : 'near',
                reach: Number.isFinite(params.reach) && params.reach! > 0 ? params.reach! : null,
                resolution: Number.isFinite(params.resolution) && params.resolution! > 0 ? params.resolution! : null,
                outline: readOutline(params.outline),
                // Follows the model's structure unless that was turned off
                trend: params.trend !== false,
                // Structural data and a direction of its own (absent: the model's)
                ...(Array.isArray(params.trendSets) && params.trendSets.every(x => typeof x === 'string' && x) ? { trendSets: [...params.trendSets] } : {}),
                ...(readStructure(params.trendOwn) ? { trendOwn: readStructure(params.trendOwn)! } : {}),
                // The geological model whose layers it follows (a shell, a body or a vein)
                ...(typeof params.trendLayers === 'string' && params.trendLayers && (o.rule?.kind === 'body' || o.rule?.kind === 'shell') ? { trendLayers: params.trendLayers } : {}),
                ...(params.snap === 'holes' || params.snap === 'none' ? { snap: params.snap } : {}),
            },
            sides: Array.isArray(o.sides) && o.sides.length === 2 && o.sides.every(n => typeof n === 'string' && n) ? [o.sides[0], o.sides[1]] : null,
            columns: {
                side: typeof o.columns?.side === 'string' && o.columns.side ? o.columns.side : null,
                distance: typeof o.columns?.distance === 'string' && o.columns.distance ? o.columns.distance : null,
                ...(typeof o.columns?.thickness === 'string' && o.columns.thickness ? { thickness: o.columns.thickness } : {}),
                writtenFor: typeof o.columns?.writtenFor === 'string' ? o.columns.writtenFor : null,
            },
            ...(o.shade === 'thickness' ? { shade: 'thickness' as const } : {}),
            color: typeof o.color === 'string' ? o.color : PALETTE[surfaces.length % PALETTE.length],
            opacity: Number.isFinite(o.opacity) ? Math.min(1, Math.max(0, o.opacity!)) : 0.7,
            visible: o.visible !== false,
            showEdges: !!o.showEdges,
            ...(o.locked === true ? { locked: true, ...(typeof o.lockedKey === 'string' && o.lockedKey ? { lockedKey: o.lockedKey } : {}) } : {}),
            ...filedIn(o.folder),
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
            ...filedIn(w.folder),
        });
    }
    const range = s.structure?.range;
    // A set made for a surface that is not there is no one's
    const inputs = readInputs(s.inputs).map(set => (set.owner && !surfaces.some(x => x.id === set.owner) ? (({ owner: _owner, ...rest }) => rest)(set) as InputSet : set));
    // (Left out when the scene had none: it reads back as it was)
    const sectionSets = Array.isArray(s.sectionSets) ? { sectionSets: readSectionSets(s.sectionSets) } : {};
    const unitMaps = Array.isArray(s.unitMaps) ? { unitMaps: readUnitMaps(s.unitMaps) } : {};
    const models = Array.isArray(s.models) ? { models: readModels(s.models) } : {};
    const folders = readFolders(s.folders);
    const views = Array.isArray(s.views) && s.views.length > 0 ? { views: readSavedViews(s.views) } : {};
    const numericModels = Array.isArray(s.numericModels) ? { numericModels: readNumericModels(s.numericModels, surfaces, readRule) } : {};
    // (A scene from before there were vein systems: the veins its units were told apart into are one each)
    const systems = Array.isArray(s.veinSystems) ? readVeinSystems(s.veinSystems, surfaces) : systemsFromSets(surfaces, rule => rule.inside.join(' + '));
    const veinSystems = systems.length > 0 ? { veinSystems: systems } : {};
    return withBlockParts(resolveScene({
        coords, inputs, surfaces, wireframes,
        structure: { overall: readStructure(s.structure?.overall), sets: readSets(s.structure?.sets), range: typeof range === 'number' && Number.isFinite(range) && range > 0 ? range : null },
        ...sectionSets,
        ...unitMaps,
        ...models,
        ...(folders ? { folders } : {}),
        ...numericModels,
        ...veinSystems,
        ...views,
    }));
}

/** A new surface with nothing in it yet, named and coloured free of those there are */
function blankSurface(surfaces: readonly SurfaceObject[], init: NewSurface): SurfaceObject {
    const n = nextId('s', surfaces.map(s => s.id));
    const names = new Set(surfaces.map(s => s.name));
    let name = init.name?.trim() || `Surface ${n}`;
    for (let k = 2; names.has(name); k++) name = `${init.name?.trim() || `Surface ${n}`} (${k})`;
    return {
        id: `s${n}`, name,
        rule: readRule(init.rule),
        uses: [],
        points: [],
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
    };
}

/** What a numeric model is to be: its name, how its shells are found, and its shells (one with no surface is to be made) */
interface NumericWant {
    name: string; rule: NumericRule; shells: readonly { cutoff: number; surface?: string }[];
    /** The ground its shells are kept inside (null: none; left out: as it is now) */
    domain?: Domain | null;
}

/**
 * The scene with a numeric model as wanted (a new one when the scene has none of that id) and its shells in step
 * with it: every shell found the way the model says, at its own cut-off; a shell made for a cut-off that has none
 * (with the fitting settings of the others); the shell of a cut-off no longer wanted removed, unless it is locked:
 * then it and its cut-off stay. Shells still named and coloured as they were made follow the column, the cut-offs
 * and the ramp; one renamed or recoloured by hand is left as it is.
 */
function numericScene(scene: ModelScene, id: string, want: NumericWant): ModelScene {
    const had = scene.numericModels ?? [];
    const was = had.find(m => m.id === id) ?? null;
    const old = was?.shells ?? [];
    const wanted = new Map<number, string | undefined>();
    for (const s of want.shells) if (Number.isFinite(s.cutoff) && !wanted.has(s.cutoff)) wanted.set(s.cutoff, s.surface);
    for (const s of old) {
        const kept = [...wanted.values()].includes(s.surface);
        if (!kept && !wanted.has(s.cutoff) && scene.surfaces.find(x => x.id === s.surface)?.locked) wanted.set(s.cutoff, s.surface);
    }
    const order = [...wanted.keys()].sort((a, b) => a - b).slice(0, MAX_CUTOFFS);
    const keep = new Set(order.map(c => wanted.get(c)));
    // (A locked shell that is its model's no longer stays in the scene, a shell of its own)
    let surfaces = scene.surfaces.filter(s => s.locked || keep.has(s.id) || !old.some(o => o.surface === s.id));
    const before = { colours: shellRamp(old.length), looks: shellOpacities(old.length) };
    const asMade = old.every((s, i) => {
        const x = scene.surfaces.find(q => q.id === s.surface);
        return !!x && x.color === before.colours[i] && x.opacity === before.looks[i];
    });
    const colours = shellRamp(order.length), looks = shellOpacities(order.length);
    const sibling = old.map(s => scene.surfaces.find(x => x.id === s.surface)).find(Boolean) ?? null;
    // Where its shells are kept is the model's: every shell of it is kept there
    const domain = want.domain === undefined ? was?.domain ?? sibling?.domain ?? null : want.domain;
    const free = (name: string, but: string | null) => {
        let out = name;
        for (let k = 2; surfaces.some(s => s.id !== but && s.name === out); k++) out = `${name} (${k})`;
        return out;
    };
    const shells: { cutoff: number; surface: string }[] = [];
    order.forEach((cutoff, i) => {
        const rule = readRule(shellRuleAt(want.rule, cutoff));
        const now = surfaces.find(s => s.id === wanted.get(cutoff));
        if (now) {
            const followed = now.rule.kind === 'shell' && now.name === shellLabel(now.rule.column, now.rule.cutoff, !!now.rule.of);
            const next: SurfaceObject = {
                ...now, rule,
                name: followed ? free(shellLabel(want.rule.column, cutoff, !!want.rule.of), now.id) : now.name,
                ...(asMade ? { color: colours[i], opacity: looks[i] } : {}),
            };
            if (domain) next.domain = domain; else delete next.domain;
            if (JSON.stringify(next) !== JSON.stringify(now)) surfaces = surfaces.map(s => (s === now ? next : s));
            shells.push({ cutoff, surface: now.id });
            return;
        }
        const made: SurfaceObject = {
            ...blankSurface(surfaces, { name: shellLabel(want.rule.column, cutoff, !!want.rule.of), rule, ...(sibling ? { params: sibling.params } : {}) }),
            color: colours[i], opacity: looks[i],
            ...(domain ? { domain } : {}),
        };
        surfaces = [...surfaces, made];
        shells.push({ cutoff, surface: made.id });
    });
    // (Read as a rule at a cut-off above zero: at zero, logarithms would be struck out of what the model keeps)
    // (A proportion: at a share, which is under 1)
    const kept = readRule(shellRuleAt(want.rule, want.rule.of ? 0.5 : 1));
    const model: NumericModel = { id, name: freeNumericName(want.name, had, id), rule: kept.kind === 'shell' ? numericRule(kept) : want.rule, shells, ...(domain ? { domain } : {}) };
    return { ...scene, surfaces, numericModels: was ? had.map(m => (m === was ? model : m)) : [...had, model] };
}

/** What the session was doing with a surface that is no longer there is over */
function withoutEditing(state: Pick<ModelState, 'editingId'>, scene: ModelScene): Partial<ModelState> {
    return state.editingId && !scene.surfaces.some(s => s.id === state.editingId)
        ? { editingId: null, picking: false, drawing: false, hotLine: null, pendingReading: null, marking: null }
        : {};
}

export const useModelStore = create<ModelState>()((put, get) => {
    /**
     * Every change of the scene made here has the parts of its models' contacts, one a fault block, brought up to
     * date with it (blockParts.ts): made when a fault comes into use, kept like the surface each is a part of, and
     * taken away when the faults go. In the same step as the change, so that one undo takes both back.
     */
    const set = (change: Partial<ModelState> | ((state: ModelState) => ModelState | Partial<ModelState>)): void => put(state => {
        const next = typeof change === 'function' ? change(state) : change;
        if (next === state || !next.scene || next.scene === state.scene) return next;
        const scene = withBlockParts(next.scene);
        return scene === next.scene ? next : { ...next, scene, ...withoutEditing({ editingId: 'editingId' in next ? next.editingId ?? null : state.editingId }, scene) };
    });
    /**
     * The state after the scene's sets or uses were changed to `next`: every
     * surface is brought up to date with its sets. `reference`: a surface
     * whose points or lines changed has its positive side fixed, if it was
     * not yet.
     */
    const withInputs = (state: ModelState, next: ModelScene, reference = false): ModelState | Partial<ModelState> => {
        let scene = resolveScene(next);
        if (reference) {
            const before = new Map(state.scene.surfaces.map(s => [s.id, s]));
            const surfaces = scene.surfaces.map(s => {
                const was = before.get(s.id);
                return was && was.points === s.points && was.polylines === s.polylines ? s : withReference(s);
            });
            if (surfaces.some((s, i) => s !== scene.surfaces[i])) scene = { ...scene, surfaces };
        }
        // Nothing changed: keep the scene (a new one would count as an edit)
        return scene === state.scene ? state : { scene };
    };
    /**
     * `set`, for the actions on surfaces, sets, points and lines. A scene put
     * in the store as it stood (not through `setScene`) may hold a surface
     * that carries its own points and lines: it is given its sets first, so
     * the action finds them.
     */
    const edit = (fn: (state: ModelState) => ModelState | Partial<ModelState>) => set(state => {
        if (state.scene.surfaces.every(s => s.uses)) return fn(state);
        const lifted = { ...state, scene: resolveScene(state.scene) };
        const next = fn(lifted);
        return next === lifted ? state : next;
    });
    /** Change the open sets a surface uses, one by one (`fn` gives a set back as it was to leave it alone) */
    const mapOpenSets = (surfaceId: string, fn: (set: InputSet) => InputSet, reference = false) => edit(state => {
        let scene = state.scene;
        for (const open of openSets(scene, surfaceId)) scene = mapSet(scene, open.id, fn);
        return withInputs(state, scene, reference);
    });
    return {
        scene: EMPTY_SCENE,
        sceneLoads: 0,
        editingId: null,
        picking: false,
        drawing: false,
        hotLine: null,
        snapNodes: false,
        pendingReading: null,
        marking: null,
        structureTool: null,
        suggestion: null,

        markBy: null,
        setMarkBy: (by) => set(state => {
            const next = by !== null && Number.isFinite(by) && by > 0 ? by : null;
            return state.markBy === next ? state : { markBy: next };
        }),
        markAlong: null,
        setMarkAlong: (along) => set(state => {
            const next = along !== null && Number.isFinite(along) && along >= 1 ? along : null;
            return state.markAlong === next ? state : { markAlong: next };
        }),

        setMarking: (side) => set(state => {
            const s = state.scene.surfaces.find(o => o.id === state.editingId);
            // (A link is a lens along a line: an intrusion's, not a contact's)
            const next = side && s && (s.rule.kind === 'contact' || s.rule.kind === 'body')
                && (side !== 'take' || (s.rule.kind === 'body' && !!s.rule.vein?.picks))
                && (side !== 'link' || (s.rule.kind === 'body' && !s.rule.vein)) ? side : null;
            if (!next) return state.marking ? { marking: null } : state;
            return { marking: next, picking: true, drawing: false, pendingReading: null, structureTool: null };
        }),

        setSnapNodes: (on) => set(state => (state.snapNodes === on ? state : { snapNodes: on })),

        setSuggestion: (suggestion) => set(state => (state.suggestion === suggestion ? state : { suggestion })),

        setStructureTool: (tool) => set(state => {
            if (!tool) return state.structureTool ? { structureTool: null } : state;
            return { structureTool: tool, picking: false, drawing: false, pendingReading: null, marking: null };
        }),

        setPendingReading: (reading) => set(state => {
            const next = state.editingId === null ? null : cleanReading(reading);
            if (!next) return state.pendingReading ? { pendingReading: null } : state;
            // It is placed with a click: lines are not being drawn meanwhile
            return { pendingReading: next, picking: true, drawing: false, structureTool: null, marking: null };
        }),

        setEditing: (id, picking = false) => set(state => {
            // (A model's part of a surface in one fault block is not edited: the surface it is a part of is)
            if (id !== null && state.scene.surfaces.find(s => s.id === id)?.blockOf) return state;
            const on = id !== null && picking;
            if (state.editingId === id && state.picking === on) return state;
            return {
                editingId: id, picking: on, drawing: state.editingId === id && on && state.drawing, hotLine: state.editingId === id ? state.hotLine : null,
                pendingReading: state.editingId === id && on ? state.pendingReading : null,
                marking: state.editingId === id && on ? state.marking : null,
                structureTool: on ? null : state.structureTool,
            };
        }),

        setPicking: (picking) => set(state => {
            const on = picking && state.editingId !== null;
            return state.picking === on && (on || !state.drawing) ? state
                : { picking: on, drawing: on && state.drawing, pendingReading: on ? state.pendingReading : null, marking: on ? state.marking : null, structureTool: on ? null : state.structureTool };
        }),

        setDrawing: (drawing) => set(state => {
            const on = drawing && state.editingId !== null;
            if (state.drawing === on && (!on || state.picking)) return state;
            return on ? { drawing: true, picking: true, pendingReading: null, marking: null, structureTool: null } : { drawing: false };
        }),

        setHotLine: (lineId) => set(state => (state.hotLine === lineId ? state : { hotLine: lineId })),

        setScene: (scene) => set(state => ({
            // A surface that carries its own points and lines is given sets for them
            scene: resolveScene(scene ?? EMPTY_SCENE), sceneLoads: state.sceneLoads + 1, editingId: null, picking: false, drawing: false, hotLine: null, pendingReading: null, marking: null, structureTool: null,
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

        addSectionSet: (raw) => {
            let id: string | null = null;
            set(state => {
                const had = state.scene.sectionSets ?? [];
                const [made] = readSectionSets([{ ...raw, id: 'new', name: raw.name ?? '' }]);
                if (!made || had.length >= MAX_SECTION_SETS) return state;
                let name = raw.name?.trim() || sectionSetName(made.normal);
                for (let k = 2, base = name; had.some(s => s.name === name); k++) name = `${base} (${k})`;
                id = `x${nextId('x', had.map(s => s.id))}`;
                return { scene: { ...state.scene, sectionSets: [...had, { ...made, id, name }] } };
            });
            return id;
        },

        updateSectionSet: (id, patch) => set(state => {
            const had = state.scene.sectionSets ?? [];
            const was = had.find(s => s.id === id);
            if (!was) return state;
            const [next] = readSectionSets([{ ...was, ...patch, id, name: patch.name?.trim() || was.name, normal: patch.normal ? setNormal(patch.normal) ?? was.normal : was.normal }]);
            if (!next || JSON.stringify(next) === JSON.stringify(was)) return state;
            return { scene: { ...state.scene, sectionSets: had.map(s => (s === was ? next : s)) } };
        }),

        removeSectionSet: (id) => set(state => {
            const had = state.scene.sectionSets ?? [];
            if (!had.some(s => s.id === id)) return state;
            return { scene: { ...state.scene, sectionSets: had.filter(s => s.id !== id) } };
        }),

        addNumericModel: (init) => {
            let id: string | null = null;
            edit(state => {
                const had = state.scene.numericModels ?? [];
                const cutoffs = cleanCutoffs(init.cutoffs);
                if (had.length >= MAX_NUMERIC_MODELS || cutoffs.length === 0 || !init.rule.column) return state;
                id = `nm${nextId('nm', had.map(m => m.id))}`;
                return withInputs(state, numericScene(state.scene, id, { name: init.name?.trim() || init.rule.column, rule: init.rule, shells: cutoffs.map(cutoff => ({ cutoff })), domain: readDomain(init.domain).domain ?? null }));
            });
            return id;
        },

        updateNumericModel: (id, patch) => edit(state => {
            const was = state.scene.numericModels?.find(m => m.id === id);
            if (!was) return state;
            const cutoffs = patch.cutoffs ? cleanCutoffs(patch.cutoffs) : null;
            let scene = numericScene(state.scene, id, {
                // (A name still its column's follows the column)
                name: patch.name?.trim() || (patch.rule && was.name === was.rule.column ? patch.rule.column : was.name),
                rule: patch.rule ?? was.rule,
                shells: cutoffs ? cutoffs.map(cutoff => ({ cutoff, surface: was.shells.find(s => s.cutoff === cutoff)?.surface })) : was.shells,
                ...('domain' in patch ? { domain: readDomain(patch.domain).domain ?? null } : {}),
            });
            if ('trend' in patch) {
                // (Every shell of it; a locked one is given it too, and is fitted with it when it is unlocked)
                const trend = readStructure(patch.trend), mine = new Set(scene.numericModels?.find(m => m.id === id)?.shells.map(s => s.surface));
                const text = JSON.stringify(trend);
                scene = {
                    ...scene,
                    surfaces: scene.surfaces.map(s => {
                        if (!mine.has(s.id) || JSON.stringify(s.params.trendOwn ?? null) === text) return s;
                        const params = { ...s.params };
                        if (trend) params.trendOwn = trend; else delete params.trendOwn;
                        return { ...s, params };
                    }),
                };
            }
            const same = JSON.stringify(scene.numericModels) === JSON.stringify(state.scene.numericModels)
                && scene.surfaces.length === state.scene.surfaces.length && scene.surfaces.every((s, i) => s === state.scene.surfaces[i]);
            return same ? state : { ...withInputs(state, scene), ...withoutEditing(state, scene) };
        }),

        addVeinSystem: (init) => {
            let id: string | null = null;
            edit(state => {
                const had = state.scene.veinSystems ?? [];
                const taken = new Set(had.flatMap(v => v.veins));
                const veins = [...new Set(init.veins)].filter(v => !taken.has(v) && state.scene.surfaces.some(s => s.id === v && isVein(s))).slice(0, MAX_SYSTEM_VEINS);
                if (had.length >= MAX_VEIN_SYSTEMS || veins.length === 0) return state;
                id = `vs${nextId('vs', had.map(v => v.id))}`;
                return { scene: { ...state.scene, veinSystems: [...had, { id, name: freeSystemName(init.name ?? '', had), veins }] } };
            });
            return id;
        },

        updateVeinSystem: (id, patch) => edit(state => {
            const had = state.scene.veinSystems ?? [];
            const was = had.find(v => v.id === id);
            if (!was) return state;
            const named = patch.name !== undefined && patch.name.trim() ? { ...was, name: freeSystemName(patch.name, had, id) } : was;
            const { system, rules } = patch.veins ? reorder(named, state.scene.surfaces, patch.veins) : { system: named, rules: [] };
            if (system.name === was.name && system.veins.every((v, i) => v === was.veins[i]) && rules.length === 0) return state;
            const surfaces = rules.length > 0 ? state.scene.surfaces.map(s => { const r = rules.find(x => x.id === s.id); return r ? { ...s, rule: r.rule } : s; }) : state.scene.surfaces;
            return { scene: { ...state.scene, surfaces, veinSystems: had.map(v => (v === was ? system : v)) } };
        }),

        addSystemVein: (id) => {
            let made: string | null = null;
            edit(state => {
                const had = state.scene.veinSystems ?? [];
                const was = had.find(v => v.id === id);
                const like = was && state.scene.surfaces.find(s => s.id === was.veins[0]);
                if (!was || !like || like.rule.kind !== 'body' || !like.rule.vein || was.veins.length >= MAX_SYSTEM_VEINS) return state;
                // As the first vein is made, with no stretches of its own, nothing done to its contacts and no stop
                const { control: _control, ...plain } = like.rule;
                const { endsOn: _endsOn, picks: _picks, ...vein } = like.rule.vein;
                const names = new Set(state.scene.surfaces.map(s => s.name));
                let k = was.veins.length + 1;
                while (names.has(`${was.name} ${k}`)) k++;
                const surface = { ...blankSurface(state.scene.surfaces, { name: `${was.name} ${k}`, rule: readRule({ ...plain, vein: { ...vein, picks: [] } }), params: like.params }) };
                made = surface.id;
                return withInputs(state, { ...state.scene, surfaces: [...state.scene.surfaces, surface], veinSystems: had.map(v => (v === was ? { ...v, veins: [...v.veins, surface.id] } : v)) });
            });
            return made;
        },

        setVeinStop: (surfaceId, at) => {
            let done = false;
            edit(state => {
                const system = systemOf(state.scene, surfaceId);
                const was = state.scene.surfaces.find(s => s.id === surfaceId);
                if (!system || !was || was.rule.kind !== 'body' || !was.rule.vein || was.locked) return state;
                if (at && !mayStopAt(system, surfaceId).includes(at.surface)) return state;
                const rule = stopRule(was.rule, at);
                done = true;
                if (JSON.stringify(rule) === JSON.stringify(was.rule)) return state;
                return { scene: { ...state.scene, surfaces: state.scene.surfaces.map(s => (s === was ? { ...s, rule } : s)) } };
            });
            return done;
        },

        removeVeinSystem: (id) => {
            const was = get().scene.veinSystems?.find(v => v.id === id);
            if (!was) return;
            // The system first (its veins are then no one's), then each vein as any surface is removed: a locked one stays
            set(state => {
                const left = (state.scene.veinSystems ?? []).filter(v => v.id !== id);
                return { scene: { ...state.scene, veinSystems: left.length > 0 ? left : undefined } };
            });
            for (const v of was.veins) get().removeSurface(v);
        },

        dissolveVeinSystem: (id) => edit(state => {
            const had = state.scene.veinSystems ?? [];
            if (!had.some(v => v.id === id)) return state;
            const left = had.filter(v => v.id !== id);
            return { scene: { ...state.scene, veinSystems: left.length > 0 ? left : undefined } };
        }),

        removeNumericModel: (id) => {
            const was = get().scene.numericModels?.find(m => m.id === id);
            if (!was) return;
            // The model first (its shells are then no one's), then each shell as any surface is removed: a locked one stays
            set(state => ({ scene: { ...state.scene, numericModels: (state.scene.numericModels ?? []).filter(m => m.id !== id) } }));
            for (const s of was.shells) get().removeSurface(s.surface);
        },

        addView: (raw) => {
            let id: string | null = null;
            set(state => {
                const had = state.scene.views ?? [];
                const [made] = readSavedViews([{ ...raw, id: 'new' }]);
                if (!made || had.length >= MAX_SAVED_VIEWS) return state;
                id = `vw${nextId('vw', had.map(v => v.id))}`;
                return { scene: { ...state.scene, views: [...had, { ...made, id, name: freeViewName(raw.name ?? '', had) }] } };
            });
            return id;
        },

        updateView: (id, patch) => set(state => {
            const had = state.scene.views ?? [];
            const was = had.find(v => v.id === id);
            if (!was) return state;
            const [read] = readSavedViews([{ ...was, ...patch, id }]);
            if (!read) return state;
            const next = { ...read, name: patch.name !== undefined && patch.name.trim() ? freeViewName(patch.name, had, id) : was.name };
            if (JSON.stringify(next) === JSON.stringify(was)) return state;
            return { scene: { ...state.scene, views: had.map(v => (v === was ? next : v)) } };
        }),

        removeView: (id) => set(state => {
            const had = state.scene.views ?? [];
            if (!had.some(v => v.id === id)) return state;
            return { scene: { ...state.scene, views: had.filter(v => v.id !== id) } };
        }),

        addUnitMap: (raw) => {
            let id: string | null = null;
            set(state => {
                const had = state.scene.unitMaps ?? [];
                const [made] = readUnitMaps([{ ...raw, id: 'new', reassigned: raw.reassigned ?? [] }]);
                if (!made || had.length >= MAX_UNIT_MAPS) return state;
                let name = raw.name?.trim() || made.columns.join(' + ');
                for (let k = 2, base = name; had.some(m => m.name === name); k++) name = `${base} (${k})`;
                id = `u${nextId('u', had.map(m => m.id))}`;
                return { scene: { ...state.scene, unitMaps: [...had, { ...made, id, name }] } };
            });
            return id;
        },

        updateUnitMap: (id, patch) => set(state => {
            const had = state.scene.unitMaps ?? [];
            const was = had.find(m => m.id === id);
            if (!was) return state;
            // Only the same units, renamed as a whole map, recoloured or reordered: which codes make which unit goes through regroupUnits
            const units = patch.units && patch.units.length === was.units.length && patch.units.every(u => was.units.some(w => w.name === u.name && w.codes.join('\n') === u.codes.join('\n')))
                ? patch.units : was.units;
            const [next] = readUnitMaps([{ ...was, name: patch.name?.trim() || was.name, units }]);
            if (!next || JSON.stringify(next) === JSON.stringify(was)) return state;
            return { scene: { ...state.scene, unitMaps: had.map(m => (m === was ? next : m)) } };
        }),

        regroupUnits: (id, regrouped, given) => set(state => {
            const had = state.scene.unitMaps ?? [];
            const was = had.find(m => m.id === id);
            if (!was) return state;
            let reassigned = carryReassigned(was.reassigned, regrouped);
            for (const g of given ?? []) if (regrouped.units.some(u => u.name === g.unit)) reassigned = reassign(reassigned, g.stretches, g.unit);
            const [next] = readUnitMaps([{ ...was, units: regrouped.units, reassigned }]);
            if (!next) return state;
            const surfaces = state.scene.surfaces.map(s => ((s.rule.kind === 'contact' || s.rule.kind === 'body') && s.rule.units === id
                ? { ...s, rule: carryRule(s.rule, regrouped) } : s));
            // The models that read it: a contact, the base and a colour are of a unit by its name, and follow it. (One unit made
            // several: the oldest of them, which is what the base of them all is the base of)
            const order = next.units.map(u => u.name);
            const carried = (u: string): string => {
                const to = (regrouped.carry[u] ?? []).filter(x => order.includes(x));
                return to.length === 0 ? u : to.reduce((a, b) => (order.indexOf(b) > order.indexOf(a) ? b : a));
            };
            const models = state.scene.models?.map(m => {
                if (m.unitMap !== id) return m;
                const moved = { ...m, base: carried(m.base), contacts: m.contacts.map(c => (carried(c.unit) === c.unit ? c : { ...c, unit: carried(c.unit) })), units: m.units.map(u => (carried(u.name) === u.name ? u : { ...u, name: carried(u.name) })) };
                return JSON.stringify(moved) === JSON.stringify(m) ? m : moved;
            });
            return { scene: { ...state.scene, surfaces, unitMaps: had.map(m => (m === was ? next : m)), ...(models ? { models } : {}) } };
        }),

        reassignUnits: (id, stretches, unitName) => set(state => {
            const had = state.scene.unitMaps ?? [];
            const was = had.find(m => m.id === id);
            if (!was || (unitName && !was.units.some(u => u.name === unitName))) return state;
            const reassigned = reassign(was.reassigned, stretches, unitName);
            if (JSON.stringify(reassigned) === JSON.stringify(was.reassigned)) return state;
            return { scene: { ...state.scene, unitMaps: had.map(m => (m === was ? { ...was, reassigned } : m)) } };
        }),

        removeUnitMap: (id) => set(state => {
            const had = state.scene.unitMaps ?? [];
            const was = had.find(m => m.id === id);
            if (!was) return state;
            // A surface that read it reads the codes again: each unit is the codes it was made of
            const codes = (units: string[]) => [...new Set(units.flatMap(u => was.units.find(x => x.name === u)?.codes ?? []))];
            const surfaces = state.scene.surfaces.map(s => {
                if ((s.rule.kind !== 'contact' && s.rule.kind !== 'body') || s.rule.units !== id) return s;
                const { units: _units, table: _table, ...rest } = s.rule;
                const source = { ...rest, column: was.columns[0], ...(was.table ? { table: was.table } : {}) };
                return { ...s, rule: readRule(source.kind === 'body'
                    ? { ...source, inside: codes(source.inside), ignore: codes(source.ignore) }
                    : { ...source, sideA: codes(source.sideA), sideB: codes(source.sideB) }) };
            });
            return { scene: { ...state.scene, surfaces, unitMaps: had.filter(m => m !== was) } };
        }),

        addModel: (init = {}) => {
            let id: string | null = null;
            set(state => {
                const had = state.scene.models ?? [];
                if (had.length >= MAX_MODELS) return state;
                const map = state.scene.unitMaps?.find(m => m.id === init.unitMap);
                let name = init.name?.trim() || 'Geological model';
                for (let k = 2, base = name; had.some(m => m.name === name); k++) name = `${base} ${k}`;
                id = `m${nextId('m', had.map(m => m.id))}`;
                // (A new model fits its contacts in each fault block apart, once it has a fault)
                const [made] = readModels([{ id, name, byBlock: init.byBlock !== false, ...(map ? { unitMap: map.id } : {}), base: init.base ?? map?.units.at(-1)?.name ?? '', units: [], contacts: [], boundary: { box: init.boundary?.box ?? null, ...(init.boundary?.top ? { top: init.boundary.top } : {}), ...(init.boundary?.near ? { near: init.boundary.near } : {}) }, cell: init.cell ?? null }]);
                return { scene: { ...state.scene, models: [...had, made] } };
            });
            return id;
        },

        updateModel: (id, patch) => set(state => {
            const had = state.scene.models ?? [];
            const was = had.find(m => m.id === id);
            if (!was) return state;
            const { boundary: edge, ...rest } = patch;
            const boundary: Record<string, unknown> = { ...was.boundary };
            for (const [k, v] of Object.entries(edge ?? {})) {
                if (v === null && k !== 'box') delete boundary[k];
                else if (v !== undefined) boundary[k] = v;
            }
            const draft: Record<string, unknown> = { ...was, ...rest, name: rest.name?.trim() || was.name, boundary };
            if ('unitMap' in rest && !rest.unitMap) delete draft.unitMap;
            if ('auto' in rest && rest.auto !== false) delete draft.auto;
            if ('byBlock' in rest && !rest.byBlock) delete draft.byBlock;
            if ('column' in rest && !rest.column) { delete draft.column; delete draft.columnFor; delete draft.blockColumn; }
            if ('blockColumn' in rest && !rest.blockColumn) delete draft.blockColumn;
            const [next] = readModels([draft]);
            if (!next || JSON.stringify(next) === JSON.stringify(was)) return state;
            return { scene: { ...state.scene, models: had.map(m => (m === was ? next : m)) } };
        }),

        removeModel: (id) => set(state => {
            const had = state.scene.models ?? [];
            if (!had.some(m => m.id === id)) return state;
            // (A surface that followed its layers follows what the model follows again)
            const surfaces = state.scene.surfaces.some(s => s.params.trendLayers === id)
                ? state.scene.surfaces.map(s => { if (s.params.trendLayers !== id) return s; const { trendLayers: _layers, ...rest } = s.params; return { ...s, params: rest }; })
                : state.scene.surfaces;
            return { scene: { ...state.scene, surfaces, models: had.filter(m => m.id !== id) } };
        }),

        addModelContact: (modelId, contact, at = 0) => {
            let id: string | null = null;
            set(state => {
                const had = state.scene.models ?? [];
                const was = had.find(m => m.id === modelId);
                if (!was || was.contacts.length >= MAX_CONTACTS) return state;
                // (A model's part of a surface in one fault block is no surface to build with)
                if (state.scene.surfaces.find(s => s.id === contact.surface)?.blockOf) return state;
                // One surface is one contact of a model
                if (was.contacts.some(c => (contact.mesh ? c.mesh === contact.mesh : c.surface === contact.surface))) return state;
                const made = `c${nextId('c', was.contacts.map(c => c.id))}`;
                const contacts = [...was.contacts];
                contacts.splice(Math.min(Math.max(0, Math.round(at)), contacts.length), 0, { ...contact, id: made });
                const [next] = readModels([{ ...was, contacts }]);
                if (!next || next.contacts.length === was.contacts.length) return state;
                id = made;
                return { scene: { ...state.scene, models: had.map(m => (m === was ? next : m)) } };
            });
            return id;
        },

        updateModelContact: (modelId, contactId, patch) => set(state => {
            const had = state.scene.models ?? [];
            const was = had.find(m => m.id === modelId);
            if (!was || !was.contacts.some(c => c.id === contactId)) return state;
            const [next] = readModels([{ ...was, contacts: was.contacts.map(c => (c.id === contactId ? { ...c, ...patch, id: c.id } : c)) }]);
            if (!next || JSON.stringify(next) === JSON.stringify(was)) return state;
            return { scene: { ...state.scene, models: had.map(m => (m === was ? next : m)) } };
        }),

        moveModelContact: (modelId, contactId, to) => set(state => {
            const had = state.scene.models ?? [];
            const was = had.find(m => m.id === modelId);
            const from = was ? was.contacts.findIndex(c => c.id === contactId) : -1;
            const at = was ? Math.min(Math.max(0, Math.round(to)), was.contacts.length - 1) : -1;
            if (!was || from < 0 || at === from) return state;
            const contacts = [...was.contacts];
            contacts.splice(at, 0, ...contacts.splice(from, 1));
            return { scene: { ...state.scene, models: had.map(m => (m === was ? { ...was, contacts } : m)) } };
        }),

        removeModelContact: (modelId, contactId) => set(state => {
            const had = state.scene.models ?? [];
            const was = had.find(m => m.id === modelId);
            if (!was || !was.contacts.some(c => c.id === contactId)) return state;
            return { scene: { ...state.scene, models: had.map(m => (m === was ? { ...was, contacts: was.contacts.filter(c => c.id !== contactId) } : m)) } };
        }),

        addModelFault: (modelId, fault) => {
            let id: string | null = null;
            set(state => {
                const had = state.scene.models ?? [];
                const was = had.find(m => m.id === modelId);
                const faults = was?.faults ?? [];
                if (!was || faults.length >= MAX_FAULTS || state.scene.surfaces.find(s => s.id === fault.surface)?.blockOf) return state;
                const same = (x: { surface?: string; mesh?: string }) => (fault.mesh ? x.mesh === fault.mesh : !!fault.surface && x.surface === fault.surface);
                if (faults.some(same) || was.contacts.some(same)) return state;
                const made = `f${nextId('f', faults.map(x => x.id))}`;
                const [next] = readModels([{ ...was, faults: [...faults, { ...(fault.mesh ? { mesh: fault.mesh } : { surface: fault.surface }), id: made }] }]);
                if (!next || (next.faults?.length ?? 0) === faults.length) return state;
                id = made;
                return { scene: { ...state.scene, models: had.map(m => (m === was ? next : m)) } };
            });
            return id;
        },

        updateModelFault: (modelId, faultId, patch) => set(state => {
            const had = state.scene.models ?? [];
            const was = had.find(m => m.id === modelId);
            if (!was || !was.faults?.some(x => x.id === faultId)) return state;
            const [next] = readModels([{ ...was, faults: was.faults.map(x => (x.id === faultId ? { ...x, ...patch, id: x.id } : x)) }]);
            if (!next || JSON.stringify(next) === JSON.stringify(was)) return state;
            return { scene: { ...state.scene, models: had.map(m => (m === was ? next : m)) } };
        }),

        removeModelFault: (modelId, faultId) => set(state => {
            const had = state.scene.models ?? [];
            const was = had.find(m => m.id === modelId);
            if (!was || !was.faults?.some(x => x.id === faultId)) return state;
            // (Read again: sides that named it go with it)
            const [next] = readModels([{ ...was, faults: was.faults.filter(x => x.id !== faultId) }]);
            return next ? { scene: { ...state.scene, models: had.map(m => (m === was ? next : m)) } } : state;
        }),

        // (Folders change no surface's inputs: the scene is not resolved again)
        moveToFolder: (objectKeys, path) => set(state => {
            const scene = moveToFolder(state.scene, objectKeys, path);
            return scene === state.scene ? state : { scene };
        }),
        addFolder: (root, path) => set(state => {
            const scene = addFolder(state.scene, root, path);
            return scene === state.scene ? state : { scene };
        }),
        renameFolder: (root, from, to) => set(state => {
            const scene = renameFolder(state.scene, root, from, to);
            return scene === state.scene ? state : { scene };
        }),
        removeFolder: (root, path) => set(state => {
            const scene = removeFolder(state.scene, root, path);
            return scene === state.scene ? state : { scene };
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
            // A surface that follows it by its own choice follows the others it chose; with none left, what the model follows
            const surfaces = state.scene.surfaces.map(s => {
                if (!s.params.trendSets?.includes(id)) return s;
                const left = s.params.trendSets.filter(x => x !== id);
                const { trendSets: _sets, ...rest } = s.params;
                return { ...s, params: left.length > 0 ? { ...rest, trendSets: left } : rest };
            });
            return { scene: { ...state.scene, surfaces, structure: { ...state.scene.structure, overall: state.scene.structure?.overall ?? null, sets: had.filter(s => s.id !== id) } } };
        }),

        addSurface: (init = {}) => {
            let id = '';
            edit(state => {
                const { surfaces } = state.scene;
                const surface = blankSurface(surfaces, init);
                id = surface.id;
                let scene: ModelScene = { ...state.scene, surfaces: [...surfaces, surface] };
                if (init.points?.length) {
                    const own = ensureOwn(scene, id, 'points')!;
                    const added = withIds(inputIds(own.scene.inputs ?? []).points, init.points);
                    scene = mapSet(own.scene, own.setId, s => (s.kind === 'points' ? { ...s, points: added } : s));
                }
                return withInputs(state, scene, true);
            });
            return id;
        },

        updateSurface: (id, patch) => edit(state => {
            // A shell of a numeric model: how it is found and where it is kept are its model's, and are changed for every shell of it; its cut-off is its own
            const owner = patch.rule?.kind === 'shell' || 'domain' in patch ? numericHome(state.scene, id) : null;
            if (owner) {
                const read = patch.rule?.kind === 'shell' ? readRule(patch.rule) : null;
                const asked = read?.kind === 'shell' ? read : null;
                const taken = !asked || owner.shells.some(s => s.surface !== id && s.cutoff === asked.cutoff);
                const scene = numericScene(state.scene, owner.id, {
                    name: asked && owner.name === owner.rule.column ? asked.column : owner.name, rule: asked ? numericRule(asked) : owner.rule,
                    shells: owner.shells.map(s => (asked && s.surface === id && !taken ? { ...s, cutoff: asked.cutoff } : s)),
                    ...('domain' in patch ? { domain: readDomain(patch.domain).domain ?? null } : {}),
                });
                const { rule: _rule, domain: _domain, ...rest } = patch;
                state = { ...state, scene };
                patch = rest;
            }
            const was = state.scene.surfaces.find(s => s.id === id);
            if (!was) return state;
            const next: SurfaceObject = {
                ...was, ...patch,
                ...(patch.rule ? { rule: readRule(patch.rule) } : {}),
                // (Unlocked, it is no longer held to the fit it was locked at)
                ...('locked' in patch && !patch.locked ? { lockedKey: undefined } : {}),
                // (Alongside itself is alongside nothing)
                ...('domain' in patch ? { domain: readDomain(patch.domain).domain ?? null } : {}),
                ...('conform' in patch ? { conform: patch.conform && patch.conform.surface !== id ? readConform(patch.conform).conform ?? null : null } : {}),
                params: patch.params ? { ...was.params, ...patch.params } : was.params,
            };
            // (Taken away, they are gone, as in a project read from a file: not kept as nothing)
            if (next.conform == null) delete next.conform;
            if (next.domain == null) delete next.domain;
            let scene: ModelScene = { ...state.scene, surfaces: state.scene.surfaces.map(s => (s === was ? next : s)) };
            // The sets made for it keep its name, while they still have the name they were given
            if (next.name !== was.name) {
                for (const own of (scene.inputs ?? []).filter(s => s.owner === id && s.name === ownSetName(was.name, s.kind))) {
                    scene = mapSet(scene, own.id, s => ({ ...s, name: freeName(ownSetName(next.name, s.kind), scene.inputs ?? []) }));
                }
            }
            return { scene };
        }),

        removeSurface: (id) => edit(state => {
            const was = state.scene.surfaces.find(s => s.id === id);
            // A locked surface is kept, whoever asks: it is unlocked first (that is what the lock is for)
            if (!was || was.locked) return state;
            // (Its parts in fault blocks go with it: they are no surfaces of their own, and use its sets)
            const surfaces = state.scene.surfaces.filter(s => s.id !== id && s.blockOf !== id);
            // The sets made for it go with it, unless another surface uses them or they are locked: those stay, as no one surface's
            const used = new Set(surfaces.flatMap(s => (s.uses ?? []).map(u => u.set)));
            const inputs = (state.scene.inputs ?? []).filter(s => s.owner !== id || used.has(s.id) || s.locked)
                .map(s => (s.owner === id ? (({ owner: _owner, ...rest }) => rest)(s) as InputSet : s));
            // A shell of a numeric model: its cut-off goes with it
            const numeric = state.scene.numericModels?.some(m => m.shells.some(x => x.surface === id))
                ? { numericModels: state.scene.numericModels.map(m => (m.shells.some(x => x.surface === id) ? { ...m, shells: m.shells.filter(x => x.surface !== id) } : m)) }
                : {};
            // A vein of a vein system: the system is without it (and goes with its last vein); a vein that stopped at it stops at nothing
            const system = systemOf(state.scene, id);
            const systems = system ? (state.scene.veinSystems ?? []).map(v => (v === system ? { ...v, veins: v.veins.filter(x => x !== id) } : v)).filter(v => v.veins.length > 0) : null;
            const freed = system ? looseStops(system.veins.filter(x => x !== id), surfaces) : [];
            const left = freed.length > 0 ? surfaces.map(x => { const f = freed.find(r => r.id === x.id); return f ? { ...x, rule: f.rule } : x; }) : surfaces;
            const veins = systems ? (systems.length > 0 ? { veinSystems: systems } : { veinSystems: undefined }) : {};
            return {
                ...withInputs(state, { ...state.scene, inputs, surfaces: left, ...numeric, ...veins }),
                editingId: state.editingId === id ? null : state.editingId,
                picking: state.editingId === id ? false : state.picking,
                drawing: state.editingId === id ? false : state.drawing,
                hotLine: state.editingId === id ? null : state.hotLine,
                pendingReading: state.editingId === id ? null : state.pendingReading,
                marking: state.editingId === id ? null : state.marking,
            };
        }),

        addInputSet: (kind, init = {}) => {
            let id = '';
            edit(state => {
                const sets = state.scene.inputs ?? [];
                const n = nextId('i', sets.map(s => s.id));
                id = `i${n}`;
                const base = {
                    id, name: freeName(init.name?.trim() || (kind === 'points' ? 'Points' : 'Lines'), sets),
                    color: init.color || PALETTE[(n - 1) % PALETTE.length], visible: true, locked: false,
                    folder: normalizeFolder(init.folder),
                };
                const made: InputSet = kind === 'points' ? { ...base, kind: 'points', points: [] } : { ...base, kind: 'lines', lines: [] };
                return { scene: { ...state.scene, inputs: [...sets, made] } };
            });
            return id;
        },

        // A set of named points with a role in one step (drill pads, target points: drillhole planner)
        addNamedPoints: (init, points, opts = {}) => {
            let id = '';
            edit(state => {
                const sets = state.scene.inputs ?? [];
                const name = init.name.trim() || 'Points';
                const old = opts.replace ? sets.find(s => s.kind === 'points' && s.role === init.role && s.name === name) : undefined;
                const others = old ? sets.filter(s => s !== old) : sets;
                id = old?.id ?? `i${nextId('i', sets.map(s => s.id))}`;
                let k = nextId('p', inputIds(others).points);
                const made: InputSet = {
                    ...(old ?? { visible: true, locked: false, folder: null, color: init.color }), id, name: old ? old.name : freeName(name, sets),
                    kind: 'points', role: init.role,
                    points: points.map(q => ({ id: `p${k++}`, p: [q.p[0], q.p[1], q.p[2]] as Vec3, ...(q.name ? { name: q.name } : {}) })),
                };
                return { scene: { ...state.scene, inputs: old ? sets.map(s => (s === old ? made : s)) : [...sets, made] } };
            });
            return id;
        },

        setPointSetMark: (id, mark) => edit(state => {
            const scene = mapSet(state.scene, id, s => (s.kind === 'points' && (s.mark ?? 'dot') !== mark ? { ...s, mark } : s));
            return scene === state.scene ? state : { scene };
        }),

        updateInputSet: (id, patch) => edit(state => {
            const scene = mapSet(state.scene, id, s => {
                const name = typeof patch.name === 'string' && patch.name.trim() ? patch.name.trim() : s.name;
                const folder = patch.folder === undefined ? s.folder : normalizeFolder(patch.folder);
                const next = { ...s, name, color: patch.color || s.color, visible: patch.visible ?? s.visible, locked: patch.locked ?? s.locked, folder };
                return next.name === s.name && next.color === s.color && next.visible === s.visible && next.locked === s.locked && next.folder === s.folder ? s : next;
            });
            // How a set is shown or filed changes no surface
            return scene === state.scene ? state : { scene };
        }),

        removeInputSet: (id) => edit(state => {
            const sets = state.scene.inputs ?? [];
            const was = sets.find(s => s.id === id);
            // (A locked set is kept: it is unlocked first)
            if (!was || was.locked) return state;
            return withInputs(state, { ...state.scene, inputs: sets.filter(s => s.id !== id) });
        }),

        setSurfaceUse: (surfaceId, setId, on) => edit(state => {
            const surface = state.scene.surfaces.find(s => s.id === surfaceId);
            if (!surface || !(state.scene.inputs ?? []).some(s => s.id === setId)) return state;
            const uses = surface.uses ?? [];
            if (uses.some(u => u.set === setId) === on) return state;
            const next = on ? [...uses, { set: setId }] : uses.filter(u => u.set !== setId);
            return withInputs(state, { ...state.scene, surfaces: state.scene.surfaces.map(s => (s === surface ? { ...s, uses: next } : s)) }, true);
        }),

        setUseWeight: (surfaceId, setId, weight) => edit(state => {
            const surface = state.scene.surfaces.find(s => s.id === surfaceId);
            const use = surface?.uses?.find(u => u.set === setId);
            if (!surface || !use) return state;
            const next = cleanWeight(weight);
            if (use.weight === next) return state;
            const uses = surface.uses!.map(u => {
                if (u !== use) return u;
                const { weight: _was, ...rest } = u;
                return next !== undefined ? { ...rest, weight: next } : rest;
            });
            return withInputs(state, { ...state.scene, surfaces: state.scene.surfaces.map(s => (s === surface ? { ...s, uses } : s)) }, true);
        }),

        copySurface: (id) => {
            let made: string | null = null;
            edit(state => {
                const from = state.scene.surfaces.find(s => s.id === id);
                if (!from) return state;
                const { surfaces } = state.scene;
                const newId = `s${nextId('s', surfaces.map(s => s.id))}`;
                const names = new Set(surfaces.map(s => s.name));
                let k = 1;
                while (names.has(`${from.name} v${k}`)) k++;
                // Every set it uses, as a set of the copy's own: what is changed afterwards changes the surface, not the copy
                const sets = [...(state.scene.inputs ?? [])];
                const ids = inputIds(sets);
                const uses: SurfaceUse[] = [];
                for (const use of from.uses ?? []) {
                    const set = sets.find(s => s.id === use.set);
                    if (!set) continue;
                    const base = { id: `i${nextId('i', sets.map(s => s.id))}`, name: freeName(ownSetName(`${from.name} v${k}`, set.kind), sets), color: set.color, visible: false, locked: true, folder: set.folder, owner: newId };
                    const weight = use.weight !== undefined ? { weight: use.weight } : {};
                    if (set.kind === 'points') {
                        const fresh = withIds(ids.points, set.points.map(({ id: _id, ...p }) => p));
                        for (const p of fresh) ids.points.add(p.id);
                        sets.push({ ...base, kind: 'points', points: fresh });
                        uses.push({ set: base.id, ...weight });
                    } else {
                        let n = nextId('l', ids.lines);
                        const fresh = set.lines.map((l): SceneLine => ({ ...l, id: `l${n++}` }));
                        for (const l of fresh) ids.lines.add(l.id);
                        const over = new Set(use.flipped ?? []);
                        const flipped = fresh.filter((_, i) => over.has(set.lines[i].id)).map(l => l.id);
                        sets.push({ ...base, kind: 'lines', lines: fresh });
                        uses.push({ set: base.id, ...(flipped.length ? { flipped } : {}), ...weight });
                    }
                }
                // (The fit it is locked at is its own to be given, once it is fitted)
                const { weights: _weights, lockedKey: _lockedKey, ...kept } = from;
                const copy: SurfaceObject = {
                    ...kept, id: newId, name: `${from.name} v${k}`, uses, points: [], polylines: [], locked: true,
                    // The columns it writes are the surface's own, not the copy's
                    columns: { side: null, distance: null, writtenFor: null },
                };
                made = newId;
                return withInputs(state, { ...state.scene, inputs: sets, surfaces: [...surfaces, copy] }, true);
            });
            return made;
        },

        addSurfaceWithin: (id, within, name) => {
            let made: string | null = null;
            edit(state => {
                const from = state.scene.surfaces.find(s => s.id === id);
                const limit = readWithin(within).within;
                if (!from || !limit) return state;
                const { surfaces } = state.scene;
                const newId = `s${nextId('s', surfaces.map(s => s.id))}`;
                const names = new Set(surfaces.map(s => s.name));
                const wanted = name?.trim() || `${from.name} (one block)`;
                let called = wanted;
                for (let k = 2; names.has(called); k++) called = `${wanted} ${k}`;
                // (Its overall plane is its own to find: the block's, not the whole surface's)
                const { weights: _weights, trendHeld: _held, locked: _locked, lockedKey: _lockedKey, ...kept } = from;
                const copy: SurfaceObject = {
                    ...kept, id: newId, name: called, uses: (from.uses ?? []).map(u => ({ ...u })), points: [], polylines: [], within: limit,
                    columns: { side: null, distance: null, writtenFor: null },
                };
                made = newId;
                return withInputs(state, { ...state.scene, surfaces: [...surfaces, copy] }, true);
            });
            return made;
        },

        flipSetFor: (surfaceId, setId) => edit(state => {
            const surface = state.scene.surfaces.find(s => s.id === surfaceId);
            const lines = (state.scene.inputs ?? []).find(s => s.id === setId);
            if (!surface || !lines || lines.kind !== 'lines' || lines.lines.length === 0 || !surface.uses?.some(u => u.set === setId)) return state;
            const uses = surface.uses.map(u => {
                if (u.set !== setId) return u;
                const over = new Set(u.flipped ?? []);
                const flipped = lines.lines.map(l => l.id).filter(lineId => !over.has(lineId));
                return { set: setId, ...(flipped.length ? { flipped } : {}), ...(u.weight !== undefined ? { weight: u.weight } : {}) };
            });
            return withInputs(state, { ...state.scene, surfaces: state.scene.surfaces.map(s => (s === surface ? { ...s, uses } : s)) }, true);
        }),

        addPoints: (id, points) => {
            if (points.length === 0) return;
            edit(state => {
                const own = ensureOwn(state.scene, id, 'points');
                if (!own) return state;
                const added = withIds(inputIds(own.scene.inputs ?? []).points, points);
                return withInputs(state, mapSet(own.scene, own.setId, s => (s.kind === 'points' ? { ...s, points: [...s.points, ...added] } : s)), true);
            });
        },

        movePoint: (id, pointId, p, snap, across) => mapOpenSets(id, s => (s.kind === 'points' && s.points.some(q => q.id === pointId)
            // What was measured at a point moves with it
            ? { ...s, points: s.points.map(q => (q.id === pointId ? { id: q.id, p: [p[0], p[1], p[2]], ...placed(snap, across, q.reading, q.direction) } : q)) }
            : s)),

        setPointReading: (id, pointId, reading) => mapOpenSets(id, s => {
            const at = s.kind === 'points' ? s.points.findIndex(q => q.id === pointId) : -1;
            if (s.kind !== 'points' || at < 0) return s;
            const { reading: had, ...rest } = s.points[at];
            const next = cleanReading(reading);
            if (!had && !next) return s;
            const points = s.points.slice();
            points[at] = next ? { ...rest, reading: next } : rest;
            return { ...s, points };
        }, true),

        removePoints: (id, pointIds) => {
            const gone = new Set(pointIds);
            mapOpenSets(id, s => (s.kind === 'points' && s.points.some(q => gone.has(q.id)) ? { ...s, points: s.points.filter(q => !gone.has(q.id)) } : s));
        },

        addPolyline: (id, line) => get().addPolylines(id, [line])[0] ?? null,

        addPolylines: (id, lines) => {
            const made = lines.map((line): Omit<SceneLine, 'id'> | null => {
                const shape = lineShape(line.points, line.nodes);
                // (No slice: a line in space. A slice that cannot be read: no line)
                const slice = line.plane ? readPlane(line.plane) : null;
                if (!shape || (line.plane && !slice)) return null;
                const across = !slice && isVec3(line.across) ? unit(line.across) : null;
                return { points: shape.vertices, plane: slice, ...(across ? { across } : {}), ...(shape.nodes ? { nodes: shape.nodes } : {}), ...(line.smooth ? { smooth: true as const } : {}) };
            });
            const ids: (string | null)[] = made.map(() => null);
            if (made.every(m => m === null)) return ids;
            edit(state => {
                const own = ensureOwn(state.scene, id, 'lines');
                if (!own) return state;
                let next = nextId('l', inputIds(own.scene.inputs ?? []).lines);
                const added: SceneLine[] = [];
                made.forEach((m, k) => {
                    if (!m) return;
                    ids[k] = `l${next++}`;
                    added.push({ id: ids[k]!, ...m });
                });
                return withInputs(state, mapSet(own.scene, own.setId, s => (s.kind === 'lines' ? { ...s, lines: [...s.lines, ...added] } : s)), true);
            });
            return ids;
        },

        updatePolyline: (id, lineId, patch) => {
            const shape = patch.points ? lineShape(patch.points, patch.nodes) : null;
            if (patch.points && !shape) return;
            // (A slice that cannot be read is no change)
            const slice = patch.plane ? readPlane(patch.plane) : null;
            const samePlane = (a: Plane | null, b: Plane | null) => a === b || (!!a && !!b && a.normal.every((v, k) => v === b.normal[k]) && a.point.every((v, k) => v === b.point[k]));
            edit(state => {
                const surface = state.scene.surfaces.find(s => s.id === id);
                if (!surface || !surface.polylines.some(l => l.id === lineId)) return state;
                let scene = state.scene;
                // Its shape belongs to the line (and to every surface that uses it); which way up it is, to this surface
                const redrawn = (l: SceneLine): SceneLine => {
                    let next = l;
                    if (shape) next = withNodes({ ...next, points: shape.vertices }, patch.nodes ? shape.nodes : carryNodes(l, shape.vertices));
                    else if (patch.nodes) next = withNodes(next, readNodes(patch.nodes, l.points.length));
                    if (patch.plane === null && next.plane) next = { ...next, plane: null, across: next.plane.normal };
                    else if (slice && !samePlane(next.plane, slice)) {
                        const { across: _was, ...rest } = next;
                        next = { ...rest, plane: slice };
                    }
                    return next;
                };
                if (shape || patch.nodes || patch.plane === null || slice) {
                    for (const open of openSets(scene, id)) {
                        scene = mapSet(scene, open.id, s => {
                            if (s.kind !== 'lines') return s;
                            const lines = s.lines.map(l => (l.id === lineId ? redrawn(l) : l));
                            return lines.every((l, i) => l === s.lines[i]) ? s : { ...s, lines };
                        });
                    }
                }
                if (patch.flipped !== undefined) {
                    const holder = (scene.inputs ?? []).find(s => s.kind === 'lines' && s.lines.some(l => l.id === lineId));
                    const uses = (surface.uses ?? []).map(u => {
                        if (u.set !== holder?.id || !!u.flipped?.includes(lineId) === patch.flipped) return u;
                        const flipped = patch.flipped ? [...(u.flipped ?? []), lineId] : (u.flipped ?? []).filter(x => x !== lineId);
                        return flipped.length ? { set: u.set, flipped } : { set: u.set };
                    });
                    if (uses.some((u, i) => u !== surface.uses![i])) scene = { ...scene, surfaces: scene.surfaces.map(s => (s.id === id ? { ...s, uses } : s)) };
                }
                return withInputs(state, scene, true);
            });
        },

        setNodeReading: (id, lineId, vertex, reading) => mapOpenSets(id, s => {
            const line = s.kind === 'lines' ? s.lines.find(l => l.id === lineId) : undefined;
            if (s.kind !== 'lines' || !line || !Number.isInteger(vertex) || vertex < 0 || vertex >= line.points.length) return s;
            const had = line.nodes?.[vertex] ?? null;
            const next = cleanReading(reading);
            if (!had?.reading && !next) return s;
            const nodes = Array.from({ length: line.points.length }, (_, i) => line.nodes?.[i] ?? null);
            const { reading: _was, ...rest } = had ?? {};
            const node: LineNode = next ? { ...rest, reading: next } : rest;
            nodes[vertex] = node.reading || node.snap || node.direction ? node : null;
            return { ...s, lines: s.lines.map(l => (l === line ? withNodes(l, nodes.some(Boolean) ? nodes : undefined) : l)) };
        }, true),

        setNodeDirections: (id, picks, direction) => {
            const along = direction ? storedDirection(direction) : null;
            const counts = { changed: 0, locked: 0 };
            if (direction && !along) return counts;
            const wanted = new Map<string, Set<number>>();
            for (const p of picks) {
                if (!Number.isInteger(p.vertex) || p.vertex < 0) continue;
                const own = wanted.get(p.line) ?? new Set<number>();
                own.add(p.vertex);
                wanted.set(p.line, own);
            }
            if (wanted.size === 0) return counts;
            const surface = get().scene.surfaces.find(s => s.id === id);
            const open = new Set(openSets(get().scene, id).map(s => s.id));
            for (const set_ of get().scene.inputs ?? []) {
                if (set_.kind !== 'lines' || open.has(set_.id) || !surface?.uses?.some(u => u.set === set_.id)) continue;
                for (const l of set_.lines) counts.locked += wanted.get(l.id)?.size ?? 0;
            }
            mapOpenSets(id, s => {
                if (s.kind !== 'lines' || !s.lines.some(l => wanted.has(l.id))) return s;
                const lines = s.lines.map(line => {
                    const own = wanted.get(line.id);
                    if (!own) return line;
                    const nodes = Array.from({ length: line.points.length }, (_, i) => line.nodes?.[i] ?? null);
                    let changed = 0;
                    for (const vertex of own) {
                        if (vertex >= nodes.length) continue;
                        const had = nodes[vertex];
                        if (!had?.direction && !along) continue;
                        if (had?.direction && along && had.direction.every((v, k) => v === along[k])) continue;
                        const { direction: _was, ...rest } = had ?? {};
                        const node: LineNode = along ? { ...rest, direction: along } : rest;
                        nodes[vertex] = node.reading || node.snap || node.direction ? node : null;
                        changed++;
                    }
                    if (changed === 0) return line;
                    counts.changed += changed;
                    return withNodes(line, nodes.some(Boolean) ? nodes : undefined);
                });
                return lines.every((l, i) => l === s.lines[i]) ? s : { ...s, lines };
            }, true);
            return counts;
        },

        setPointDirections: (id, pointIds, direction) => {
            const along = direction ? storedDirection(direction) : null;
            const counts = { changed: 0, locked: 0 };
            if (direction && !along) return counts;
            const wanted = new Set(pointIds);
            if (wanted.size === 0) return counts;
            const surface = get().scene.surfaces.find(s => s.id === id);
            const open = new Set(openSets(get().scene, id).map(s => s.id));
            for (const set_ of get().scene.inputs ?? []) {
                if (set_.kind !== 'points' || open.has(set_.id) || !surface?.uses?.some(u => u.set === set_.id)) continue;
                for (const q of set_.points) if (wanted.has(q.id)) counts.locked++;
            }
            mapOpenSets(id, s => {
                if (s.kind !== 'points' || !s.points.some(q => wanted.has(q.id))) return s;
                const points = s.points.map(q => {
                    if (!wanted.has(q.id)) return q;
                    if (!q.direction && !along) return q;
                    if (q.direction && along && q.direction.every((v, k) => v === along[k])) return q;
                    counts.changed++;
                    const { direction: _was, ...rest } = q;
                    return along ? { ...rest, direction: along } : rest;
                });
                return points.every((q, i) => q === s.points[i]) ? s : { ...s, points };
            }, true);
            return counts;
        },

        setLinesSmooth: (id, lineIds, on) => {
            const wanted = new Set(lineIds);
            mapOpenSets(id, s => {
                if (s.kind !== 'lines') return s;
                const lines = s.lines.map(l => {
                    if (!wanted.has(l.id) || !!l.smooth === on) return l;
                    if (on) return { ...l, smooth: true as const };
                    const { smooth: _was, ...rest } = l;
                    return rest;
                });
                return lines.every((l, i) => l === s.lines[i]) ? s : { ...s, lines };
            }, true);
        },

        removePolylines: (id, lineIds) => {
            const gone = new Set(lineIds);
            mapOpenSets(id, s => (s.kind === 'lines' && s.lines.some(l => gone.has(l.id)) ? { ...s, lines: s.lines.filter(l => !gone.has(l.id)) } : s));
            edit(state => (state.hotLine !== null && gone.has(state.hotLine) ? { hotLine: null } : state));
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
