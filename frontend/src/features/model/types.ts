/**
 * Shared types for 3D surface modelling (pure, no three.js or DOM).
 *
 * All positions are WORLD coordinates in float64 (UTM northings lose ~0.5 m
 * in float32); the fits centre and scale them internally.
 */

export type Vec3 = [number, number, number];

export interface Box3 {
    min: Vec3;
    max: Vec3;
}

/** A plane as a unit normal and a point on it. */
export interface Plane {
    normal: Vec3;
    point: Vec3;
}

/** A triangle mesh: xyz triples and vertex-index triples. */
export interface TriMesh {
    vertices: Float64Array;
    triangles: Uint32Array;
}

// ---------------------------------------------------------------------------
// The project's 3D scene (saved in the .chem file; plain JSON)
// ---------------------------------------------------------------------------

/**
 * How a surface lies at one of its points, as measured: its dip (0 = level,
 * 90 = vertical) and dip direction (the bearing it slopes down towards).
 */
export interface PointReading {
    dip: number;
    dipDirection: number;
    /** The surface is upside down here (the overturned limb of a fold) */
    overturned?: boolean;
    /**
     * How far, in metres, the reading holds the surface to its plane: the
     * radius of its disc (set by the length of the drag that placed it).
     * Absent: worked out from how near the next place is (readings.ts).
     */
    reach?: number;
}

/** A point a surface passes through. */
export interface ScenePoint {
    id: string;
    p: Vec3;
    /** Where it was picked on a drillhole (kept by hole and depth: row numbers do not survive a re-import) */
    snap?: { hole: string; depth: number };
    /**
     * The unit normal of the slice that was showing when it was placed. Points
     * picked on one section all lie in it, but the surface they mark crosses
     * the section: this is what tells the two apart (see sheet.ts).
     */
    across?: Vec3;
    /** A dip reading taken here: the surface lies this way at this point */
    reading?: PointReading;
    /**
     * A line the surface runs along here (unit; either way along it): the
     * surface contains it at this point, turned about it as the rest of the
     * surface needs. A reading, where there is one, says more and wins.
     */
    direction?: Vec3;
}

/** What is known of one node of a line, beyond where it is */
export interface LineNode {
    /** How the surface lies there, as measured (a dip tick) */
    reading?: PointReading;
    /** The drillhole and depth the node was put on */
    snap?: { hole: string; depth: number };
    /**
     * A direction the surface runs in away from the line here (unit; either
     * way along it): with the line's own direction it says how the surface
     * lies at this node. Along the line it is blended to the next node that
     * has one, and carried on past the last (ribbons.ts). Leapfrog's node
     * tangent (`ntan`).
     */
    direction?: Vec3;
}

/**
 * A line a surface passes along. Drawn on a slice, the surface crosses that
 * slice along it, so which way the surface faces is known all along the line.
 * A line in space (on no slice) says only where the surface is: how it lies
 * there comes from the rest of the surface and from the dip ticks at the
 * line's nodes.
 */
export interface ScenePolyline {
    id: string;
    /** Its vertices, in the order drawn */
    points: Vec3[];
    /** The slice it was drawn on (its mid-plane). Null: a line in space, held to no slice */
    plane: Plane | null;
    /**
     * For a line in space: the unit normal of the slice it was drawn over or
     * let go from. The surface crosses that slice, it does not lie in it (a
     * line on its own lies in the section it was drawn on, and so would the
     * surface). Absent: nothing is known (a line from a file).
     */
    across?: Vec3;
    /** What is known of its nodes, by their place in `points` (absent: nothing of any; null: nothing of that one) */
    nodes?: (LineNode | null)[];
    /** It runs as a smooth curve through its nodes (splines.ts), not straight from node to node */
    smooth?: true;
    /**
     * Which side of the line is the surface's positive side is worked out
     * from the rest of the surface; true turns this line over.
     */
    flipped: boolean;
}

/** A line as it is drawn: its vertices, the slice it was drawn on (if any) and what is known of its nodes. Which way up it is belongs to the surface that uses it. */
export type SceneLine = Omit<ScenePolyline, 'flipped'>;

interface InputSetBase {
    id: string;
    name: string;
    color: string;
    /** Drawn in the views (a hidden set still shapes the surfaces that use it) */
    visible: boolean;
    /** Its points or lines cannot be moved, added to or removed */
    locked: boolean;
    /** The folder it is listed under, "a/b" for a folder in a folder (null: none) */
    folder: string | null;
    /** The surface it was made for: what is placed or drawn while that surface is open goes into it (absent: no one surface's) */
    owner?: string;
}

/** A named set of points: every surface that uses it passes through them */
export interface PointSet extends InputSetBase {
    kind: 'points';
    points: ScenePoint[];
}

/** A named set of lines: every surface that uses it passes along them */
export interface LineSet extends InputSetBase {
    kind: 'lines';
    lines: SceneLine[];
}

/**
 * What a surface is shaped by, as an object of its own (inputs.ts): it has a
 * name, can be used by several surfaces at once, and can be written out on
 * its own. Point and line ids are unique across the whole scene.
 */
export type InputSet = PointSet | LineSet;

/** One input set a surface uses */
export interface SurfaceUse {
    /** The set's id */
    set: string;
    /** Lines of the set that are turned over for this surface (another surface may use them the other way up) */
    flipped?: string[];
    /**
     * How much the set counts for in this surface's fit, above 0 and below 1
     * (absent: in full). The less it counts for, the further the surface may
     * pass from its points and lines where the rest of its inputs pull it away.
     */
    weight?: number;
}

/** What is done with one of the contacts the logging gives a surface, kept by hole and depth (rows do not survive a re-import) */
export interface ContactEdit {
    hole: string;
    /** The depth down the hole the logging puts the contact at, m */
    depth: number;
    /** Left out: the surface is not put through it, and the logging either side of it in that hole is not held to its side */
    ignore?: boolean;
    /** Moved along the hole to this depth, m */
    to?: number;
}

/** A place the surface must pass on one side of: it lies on the first side (1) or the second (-1) */
export interface SideMark {
    id: string;
    p: Vec3;
    side: 1 | -1;
    /**
     * How far on its side of the surface the place is, at least, m: "the
     * unit is here, and for this far round" (inside a body: half as thick
     * as it is there), or "nothing of it within this far".
     *
     * On an intrusion it is no part of the fit: a lens this far across each
     * way, and as much longer along its sheets as the body is carried
     * further along them, is put into the fitted body or cut out of it
     * (rbf.ts, `FieldTouches`), and nothing else of the body changes. On a
     * contact or a vein the fit is bent to pass that far from the place.
     *
     * Absent: only just clear of the surface, by the fit, which on a body of
     * thin sheets is a bead or a pinhole and moves its sheets elsewhere.
     */
    by?: number;
    /**
     * A lens of an intrusion: how many times as far along its sheets as
     * across them it runs (1: a ball). Absent: a place inside is carried as
     * the body is along its sheets (8 times for thin sheets), a place
     * outside twice as far along as across (contactControl `lensTimes`).
     */
    along?: number;
    /**
     * A link, on an intrusion: the place is held along the whole line from
     * `p` to here, as a row of places along it would be: its lens drawn out
     * along the line. Only with a distance.
     */
    to?: Vec3;
}

/** Control by hand of a surface made from logging: its contacts one by one, places it must pass on one side of, holes it must not cross */
export interface ContactControl {
    edits?: ContactEdit[];
    marks?: SideMark[];
    /** Holes the surface must not cross, with the side each lies on: their own contacts are left out */
    uncrossed?: { hole: string; side: 1 | -1 }[];
}

/** A surface put where the logging changes from one group of units to another down the drillholes */
export interface ContactRule {
    kind: 'contact';
    /** The logging column */
    column: string;
    /**
     * The table logged down the holes that the column is in (its id in the
     * project's drillhole tables): the contacts are then at the logged depths
     * on the holes' own paths. Not set: a column of the dataset, logging as it
     * was merged onto the samples.
     */
    table?: string;
    /** The scene's unit map it reads (its id): the sides are then units of it, not logged codes, and `column` / `table` are the map's */
    units?: string;
    /** The units on the first (positive) side, and on the second */
    sideA: string[];
    sideB: string[];
    /** The longest unlogged stretch of hole a contact is put across, m (null: twice the usual interval length) */
    maxGap: number | null;
    /** A unit thinner than this down the hole, inside the other side, is left out, m (null: none is) */
    minRun: number | null;
    /**
     * The pile of layers it is a contact of, the youngest first (units of
     * the map it reads): each hole is read as that pile before its sides are
     * told apart (pile.ts), so a stretch out of order is of the layer round
     * it or left out, and the contact is met at most once in a hole. Absent:
     * every change of side down a hole is a contact, as logged.
     */
    pile?: string[];
    /** What was changed by hand (absent: nothing) */
    control?: ContactControl;
}

/** A closed surface round the volume one or more logged units fill */
/** A body of thin sheets is carried this many times further along the plane of its sheets than across them, unless it says otherwise */
export const SHEETS_STRENGTH = 8;

export interface BodyRule {
    kind: 'body';
    /** The logging column */
    column: string;
    /** The table logged down the holes that the column is in (see ContactRule); not set: a column of the dataset */
    table?: string;
    /** The scene's unit map it reads (see ContactRule) */
    units?: string;
    /** The units it is made of */
    inside: string[];
    /** Units that say nothing either way (not logged, core loss): the hole counts as unlogged there. Every other unit is outside it. */
    ignore: string[];
    /** The longest unlogged stretch of hole a contact is put across, m (null: twice the usual interval length) */
    maxGap: number | null;
    /** A band thinner than this down the hole, of the body inside the rest or the rest inside the body, is left out, m (null: none is) */
    minRun: number | null;
    /** What was changed by hand (absent: nothing): the first side is the inside */
    control?: ContactControl;
    /**
     * It is a set of thin sheets (dykes, sills), built as a volume and not
     * from two walls as a vein is: several may lie side by side, split and
     * join. Its logging is then held strictly (the middle of every logged
     * interval on its own side of its skin, half its length clear: without
     * that a body thinner than its sampling takes in the ground on both
     * sides of it), and it is carried further along the plane of its sheets
     * than across them, so that it holds together from hole to hole.
     * `strength`: how many times further (absent: `SHEETS_STRENGTH`).
     * `plane`: the plane its sheets lie in, given; absent: worked out, as a
     * vein's is (contacts.ts, `joinPlaneFrom`). Not read on a vein.
     */
    sheets?: {
        strength?: number; plane?: { dip: number; dipDirection: number };
        /** Other ground shorter than this across its sheets, between two stretches of it down a hole, is read as part of it, m (absent or 0: none is) */
        join?: number;
        /** Pieces of it that enclose less than this are left out of its mesh and its volume, m3 (absent or 0: none are) */
        least?: number;
    };
    /**
     * It is a vein, dyke or shear zone: thin against the gaps between the
     * holes, and built from its two walls (vein.ts) rather than as a volume.
     * `least`: the least it is thick wherever it is there, m (0: it may
     * taper to nothing).
     */
    vein?: {
        least: number;
        /**
         * Stretches of it down a hole less than this far apart are read as
         * one zone, m: a swarm of thin dykes is then one thing with two
         * walls, not a wall at every dyke. Measured across the plane its
         * stretches lie closest to, where they give one (contacts.ts), so
         * that holes at a low angle to it read as holes square to it do.
         * Absent or 0: every stretch is on its own. (`minRun` will not do:
         * it leaves out a thin dyke as readily as thin ground between two.)
         */
        join?: number;
        /**
         * net: where its stretches are zones with other ground in them,
         * it is as thick as the units in the zone are all together (their
         * net thickness), about the middle of them, in place of as thick
         * as the zone. Absent: as thick as its zones. Read with a join
         * length only.
         */
        thickness?: 'net';
        /**
         * The plane its sheets lie in, given: zones are joined across it,
         * its thickness is measured across it, and where structural data
         * says nothing its reference surface is held to it. Absent: worked
         * out from the logging (contacts.ts, `joinPlaneFrom`). Read with a
         * join length only.
         */
        plane?: { dip: number; dipDirection: number };
        /**
         * Which of the units' stretches down the holes are this vein, when
         * the units are several veins side by side (lodes.ts): one place
         * in each, by hole and depth. A stretch of the units with none in
         * it is other ground to this vein. Absent: every stretch is its.
         */
        picks?: { hole: string; depth: number }[];
        /**
         * Its reference surface (the sheet through the middle of it, which
         * its walls are measured from) is held to the lie of the ground at
         * every stretch: as the structural data it follows says there, and
         * along the plane its stretches lie closest to where that says
         * nothing (guides.ts, `veinGuides`). Absent: it passes through the
         * middle of each stretch and no more, as veins did before; among
         * holes that meet several veins of a set it then folds from one to
         * the next.
         */
        held?: true;
        /**
         * It ends on another surface (a splay on the vein it leaves): it is only on that side of it (1: its first side; -1: its second, outside a closed one).
         * `middle`: the other is a vein, and the side is of that vein's reference surface (the middle of it), so that this one
         * is on one side of it only and runs into it (a vein of a vein system that stops at another, veinSystem.ts).
         */
        endsOn?: { surface: string; side: 1 | -1; middle?: true };
    };
}

/** A closed surface round everything at or above a cut-off in a column of numbers (a grade shell) */
export interface ShellRule {
    kind: 'shell';
    /** The column of numbers */
    column: string;
    cutoff: number;
    /** Carry the values from sample to sample as their logarithms (for values spread over orders of magnitude) */
    log: boolean;
    /** Average the samples down each hole over this length first, m (null: only when there are too many to fit) */
    composite: number | null;
    /** No sample counts as more than this (null: as assayed) */
    topCut: number | null;
    /** In the fit, values far above or below the cut-off count no more than the usual high one does (`aboveCutoff`) */
    band: boolean;
    /** The shell goes no further than this many hole spacings from a sample at or above the cut-off (null: one and a half) */
    reach: number | null;
    /**
     * How the shell is found. Absent: from the values themselves, carried between the samples. 'indicator': from
     * how many of the samples round about are at or above the cut-off, whatever their values (`indicatorValues`).
     * 'intercepts': round the runs down each hole that average the cut-off over a minimum length (intercepts.ts)
     */
    method?: 'indicator' | 'intercepts';
    /** Indicator: it is drawn where this share of the samples round about are at or above the cut-off (absent: `DEFAULT_SHARE`) */
    share?: number;
    /** Indicator: about how many samples each way count as round about (absent or null: the usual number) */
    local?: number | null;
    /** Intercepts: a run is at least this long down the hole, m, or rich enough to average the cut-off over it */
    minLength?: number;
    /** Intercepts: lower values inside a run are no longer than this in a row, m */
    maxWaste?: number;
    /**
     * A proportion (proportion.ts): its values are not a column of numbers but the share of logged units in pieces
     * of hole, and `cutoff` is the share it is drawn at (0 to 1). `column` is then only what it is called.
     */
    of?: ShareOf;
}

/** The logging a proportion is the share of */
export interface ShareOf {
    /** A table logged down the holes (its id; absent or null: the rows of the dataset) */
    table?: string | null;
    /** The logging column */
    column: string;
    /** The units whose share it is */
    inside: string[];
    /** Codes that are not logging at all */
    ignore?: string[];
    /** The length of hole each value is the share over, m */
    length: number;
    /** It is carried this many times further along the plane of the units' sheets than across them (absent: `SHARE_STRENGTH`; 1: evenly) */
    strength?: number;
    /** The plane of their sheets, when it is typed (absent: worked out from the logging) */
    plane?: { dip: number; dipDirection: number };
}

/**
 * How a surface is built. sheet = by hand: the points placed and lines drawn.
 * contact = from a logging column; points and lines added by hand shape it
 * further. body = closed, round the units of a logging column; points added
 * by hand are more places on its skin. shell = closed, round the values of a
 * column at or above a cut-off.
 */
export type SurfaceRule = { kind: 'sheet' } | ContactRule | BodyRule | ShellRule;

/**
 * near = stops a set distance from its points; box = runs to the edges of the
 * data; outline = kept inside an outline drawn in a view (to the edges of the
 * data until one is drawn)
 */
export type SurfaceExtent = 'near' | 'box' | 'outline';

/** A closed outline drawn in a view: it cuts a column through the model along the direction it was drawn in. */
export interface SurfaceOutline {
    /** The direction the view was looking along when it was drawn (unit) */
    normal: Vec3;
    /** Its corners in order, on a plane square to `normal` (the last joins the first) */
    points: Vec3[];
}

export interface SurfaceParams {
    /** 0 = through every point exactly ... 1 = loosely */
    follow: number;
    extent: SurfaceExtent;
    /** Distance kept from the points when extent is 'near' (null = worked out from their spacing) */
    reach: number | null;
    /** Mesh cell size in metres (null = worked out from the surface's size) */
    resolution: number | null;
    /** The outline the surface is kept inside when extent is 'outline' (null = none drawn yet) */
    outline: SurfaceOutline | null;
    /**
     * It follows the model's structure (false: it does not). A shell or a body is fitted along the one
     * direction set for the model; a sheet or a contact lies as the readings the model follows say, where
     * it passes near them (guides.ts).
     */
    trend?: boolean;
    /**
     * The structural data it follows in place of the model's choice: the ids of reading sets (planes and
     * lines), whether or not the model follows them. Absent or null: the sets the model follows.
     */
    trendSets?: string[] | null;
    /**
     * Its own one direction, plunge and how much further things carry along than across, in place of the
     * model's global trend. Absent or null: the model's.
     */
    trendOwn?: OverallStructure | null;
    /**
     * It follows the layers of a geological model (the model's id): how the fitted contacts between that
     * model's layers lie from place to place, in place of structural data (modelLayers.ts). A sill, a
     * stratabound lode. A shell, a body or a vein only. Absent: it does not.
     */
    trendLayers?: string;
    /**
     * What a sheet or a contact passes through exactly (absent: 'all'). 'holes':
     * its contacts and the points placed on drillholes; what was placed or drawn
     * off the holes is followed loosely. 'none': everything is followed loosely.
     */
    snap?: SurfaceSnap;
}

export type SurfaceSnap = 'all' | 'holes' | 'none';

/** How much each of a surface's points and lines counts for (1: in full), in the order of `points` and `polylines` */
export interface InputWeights {
    points: number[];
    lines: number[];
}

export interface SurfaceColumns {
    /** Which side of the surface each sample is on */
    side: string | null;
    /** Distance from each sample to the surface, negative on the negative side */
    distance: string | null;
    /** A vein: how thick it is where each sample is, m (blank where it is not there) */
    thickness?: string | null;
    /** Mark of the surface's shape when the columns were written (they are redone when it differs) */
    writtenFor: string | null;
}

export interface SurfaceObject {
    id: string;
    name: string;
    rule: SurfaceRule;
    /**
     * The input sets it is shaped by, in order. This is what is stored; a
     * surface in the store always has it. One without it (a project from
     * before inputs were objects, a surface written out by hand) is given
     * sets of its own from its `points` and `polylines` when it enters the
     * store (inputs.ts, `resolveScene`).
     */
    uses?: SurfaceUse[];
    /** The points of the sets it uses, in order. Worked out from `uses`: change them through the store, never here */
    points: ScenePoint[];
    /** The lines of the sets it uses, each the way up this surface takes it. Worked out from `uses`, as `points` is */
    polylines: ScenePolyline[];
    /** What its points and lines count for, when a set it uses counts for less than in full. Worked out from `uses`, as `points` is */
    weights?: InputWeights;
    /** It stays as it is: it is not fitted again when its inputs or the data change, until it is unlocked (absent: not locked) */
    locked?: boolean;
    /**
     * The mark of the fit it is locked at (surfaceJobs `keyMark`), set by the
     * fits once it is locked. A project that is opened fits its surfaces
     * again: a locked one whose fit then has another mark is not as it was
     * locked, and says so.
     */
    lockedKey?: string;
    /** A direction the surface runs in while its points only define a line */
    along: Vec3 | null;
    /** Fixes which side is the positive one, so the sides never swap as points are added */
    refDirection: Vec3 | null;
    /**
     * The overall plane it was last fitted about, as that plane's unit normal
     * (absent or null: not fitted yet, or to be worked out afresh). The next
     * fit keeps it while the plane its inputs give is within a few degrees of
     * it, so that moving one point does not tilt the whole surface. Written
     * after a fit (features/model/modelCache), never by hand.
     */
    trendHeld?: Vec3 | null;
    /**
     * Fitted in one fault block of a geological model: to those of its places
     * that are on these sides of the model's faults (faultDomains.ts). Absent:
     * to all of them.
     */
    within?: { model: string; sides: FaultSide[] } | null;
    /**
     * It is a part of another surface (its id) in one fault block, made by the
     * model of `within` for a contact that is fitted in each block apart
     * (blockParts.ts). The model keeps it like the surface it is a part of:
     * it is not changed, named or deleted on its own. Absent: it is no part.
     */
    blockOf?: string;
    /**
     * It runs alongside another surface and never crosses it (conform.ts):
     * how far it is from that one is read at its own places and carried
     * between them. `by`: with no places of its own, the distance it is
     * from it, m (positive: on that surface's first side). Absent: it is
     * fitted on its own.
     */
    conform?: { surface: string; by?: number } | null;
    /**
     * A shell kept inside one or several units of a geological model, and a
     * fault block of it (a grade shell in its domain), or inside closed
     * solids of the scene: only the samples there are used, and the shell
     * stops at the faces of that ground. Absent: it goes wherever its
     * samples take it.
     */
    domain?: Domain | null;
    params: SurfaceParams;
    /** Names of the positive and negative side (null = named from the way the surface faces) */
    sides: [string, string] | null;
    /** Dataset columns this surface fills in, and the state of the surface they were last written for */
    columns: SurfaceColumns;
    color: string;
    /** Its mesh coloured by a number at each place of it, in place of its one colour (a vein: by how thick it is there) */
    shade?: 'thickness';
    opacity: number;
    visible: boolean;
    showEdges: boolean;
    /** The folder it is listed under in the project tree, "a/b" for a folder in a folder (absent or null: none) */
    folder?: string | null;
}

/** The dataset columns the scene's coordinates are in. */
export interface SceneCoords {
    x: string;
    y: string;
    z: string;
    hole: string | null;
    from: string | null;
    to: string | null;
}

/** One object from a wireframe file, shown in the scene (a DXF has one object per layer). */
export interface WireframeObject {
    id: string;
    name: string;
    /** The file it is in, by its name in the project's wireframes folder */
    file: string;
    /** Which of the file's objects, counting from 0 */
    part: number;
    color: string;
    /** Surface opacity; 0 hides the surface (edges and lines still draw) */
    opacity: number;
    visible: boolean;
    /** Draw the triangle edges */
    showEdges: boolean;
    /** The folder it is listed under in the project tree (absent or null: none) */
    folder?: string | null;
}

/** One direction of continuity for the whole model, set by hand (structure.ts) */
export interface OverallStructure {
    /** The plane things run along: its dip, and the direction it dips towards (degrees clockwise from north) */
    dip: number;
    dipDirection: number;
    /** Within the plane, the direction things run furthest in, as the bearing it plunges towards (null: no further one way in the plane than another) */
    lineTrend: number | null;
    /** How many times further things carry along the plane than across it (1: no further) */
    strength: number;
    /** How many times further they carry along the long direction than across it within the plane */
    lineStrength: number;
}

/** The lie of the ground measured at a place (structureReadings.ts) */
export interface StructureReading {
    id: string;
    p: Vec3;
    /** A plane's dip, or a line's plunge: degrees below level, 0-90 */
    dip: number;
    /** The bearing a plane dips towards, or a line plunges towards: 0-360 */
    direction: number;
}

/** Readings of one kind from one source, shown, hidden and removed together */
export interface ReadingSet {
    id: string;
    name: string;
    /** Planes (bedding, veins, a foliation) or lines (a lineation, fold axes) */
    kind: 'plane' | 'line';
    source: 'columns' | 'hand' | 'suggested';
    color: string;
    visible: boolean;
    /** The model follows these: they are part of the direction it takes from place to place (trendField.ts). Absent: it does */
    follow?: boolean;
    readings: StructureReading[];
    /** The folder it is listed under in the project tree (absent or null: none) */
    folder?: string | null;
}

/**
 * What the next clicks or drags in a 3D view give the model's structure
 * (this session only). `place`: each click puts a reading with these angles
 * where it lands. `stroke`: a drag along the structure on the slice gives a
 * reading there (`plane`, `line`) or the model's one direction (`overall`).
 */
export type StructureTool =
    | { mode: 'place'; kind: ReadingSet['kind']; dip: number; direction: number }
    | { mode: 'stroke'; target: ReadingSet['kind'] | 'overall' };

/** The structure of the ground, shared by every surface that follows it (structure.ts) */
export interface SceneStructure {
    /** One direction of continuity for the whole model, set by hand (null: none) */
    overall: OverallStructure | null;
    /** What was measured, place by place (absent in scenes made before there were any: none) */
    sets?: ReadingSet[];
    /** How far a reading carries, m (null or absent: worked out from how the readings are spaced) */
    range?: number | null;
}

export interface ModelScene {
    coords: SceneCoords | null;
    /** The sets of points and lines the surfaces are shaped by (absent in scenes made before they were objects) */
    inputs?: InputSet[];
    surfaces: SurfaceObject[];
    /** Wireframes loaded from files; the files themselves are kept in the project folder, not in the project file */
    wireframes: WireframeObject[];
    /** Absent in scenes made before there was one: no structure */
    structure?: SceneStructure;
    /** Sets of parallel sections and plans to draw on (absent in scenes made before there were any: none) */
    sectionSets?: SectionSet[];
    /** Logged codes grouped into the units the model is built of (absent in scenes made before there were any: none) */
    unitMaps?: UnitMap[];
    /** Geological models: surfaces in age order, giving the unit at every place (absent in scenes made before there were any: none) */
    models?: GeoModel[];
    /** Folders of the project tree that are kept even while empty, by the group they are in ("a/b" paths) */
    folders?: SceneFolders;
    /** Numeric models: a column of numbers modelled at several cut-offs, each owning its grade shells (absent in scenes made before there were any: none) */
    numericModels?: NumericModel[];
    /** Vein systems: several veins of the same units as one object (absent in scenes made before there were any, and in ones with none) */
    veinSystems?: VeinSystem[];
    /** Named views: ways of looking at the scene that are gone back to (absent in scenes made before there were any: none) */
    views?: import('./savedViews').SavedView[];
}

/** A solid of the scene: a fitted surface that is closed (a vein, an intrusion, a shell), every vein of a vein system, or a closed wireframe from a file */
export interface SolidRef {
    kind: 'surface' | 'system' | 'mesh';
    id: string;
}

/**
 * Ground that is the inside of solids of the scene (solidGround.ts,
 * Phase 271): what a grade shell is kept inside when no geological model
 * holds that ground as a unit. Solids that overlap or lie apart are one
 * ground.
 */
export interface SolidsDomain {
    solids: SolidRef[];
}

/** What a shell is kept inside: ground of a geological model, or the inside of solids */
export type Domain = ShellDomain | SolidsDomain;

/**
 * The ground of a geological model a grade shell is kept inside
 * (shellDomains.ts): lithologies of the model, and one of its fault blocks.
 */
export interface ShellDomain {
    /** The geological model (its id) */
    model: string;
    /** The lithology (the first of them, when there are several) */
    unit: string;
    /** When there are several: all of them, `unit` first */
    units?: string[];
    /** The fault block: the sides of the model's faults it is on (absent: every block) */
    sides?: FaultSide[];
}

/**
 * A vein system (veinSystem.ts): several veins made of the same units, each
 * by its own stretches down the holes. The veins are surfaces of the scene
 * that it owns, each fitted on its own.
 */
export interface VeinSystem {
    id: string;
    name: string;
    /** Its veins (surfaces, by id), in order: a vein may stop at one before it in the order, never at one after */
    veins: string[];
}

/**
 * A numeric model (numericModels.ts): how its grade shells are found, and one
 * shell a cut-off. The shells are surfaces of the scene that it owns and
 * keeps in step with itself.
 */
export interface NumericModel {
    id: string;
    name: string;
    /** How every shell of it is found: a grade shell's rule but for its cut-off */
    rule: Omit<ShellRule, 'cutoff'>;
    /** Its shells, the lowest cut-off first: the cut-off, and the surface (its id) round what is at or above it */
    shells: { cutoff: number; surface: string }[];
    /** The ground every shell of it is kept inside (absent: they go wherever their samples take them) */
    domain?: Domain;
}

/** How a contact of a geological model treats older ground (geoModel.ts) */
export type ContactKind = 'deposit' | 'erosion' | 'intrusion';

/** A surface as a member of a model's age order */
export interface ModelContact {
    id: string;
    /** The surface it is (its id) */
    surface?: string;
    /** Or a mesh from a file (its id): a fixed surface, not fitted here */
    mesh?: string;
    kind: ContactKind;
    /** The side of the surface the younger ground is on: 1 = its first side (a closed body: inside) */
    young: 1 | -1;
    /** The unit on its young side */
    unit: string;
    /** Left out of the model for now */
    off?: boolean;
    /** The fault block it belongs to: the sides of the model's faults it is on (absent: every block) */
    within?: FaultSide[];
    /**
     * It runs through the model's faults as one surface (ground laid down
     * after them): in a model that fits its contacts in each fault block
     * apart, this one is not. Absent: it is offset by the faults as the rest are.
     */
    across?: boolean;
}

/** A side of one of a model's faults (the fault by its id in the model): 1 = its surface's first side */
export interface FaultSide {
    fault: string;
    side: 1 | -1;
}

/** A surface as a fault of a geological model (faults.ts): it cuts the model into fault blocks */
export interface ModelFault {
    id: string;
    /** The surface it is (its id), or a mesh from a file */
    surface?: string;
    mesh?: string;
    /** The faults it ends on: it is there only on that side of each (absent: it runs through the whole model) */
    ends?: FaultSide[];
    /**
     * It stops: it is there only within this many metres of its own places
     * (its points, its lines, where holes meet it; a mesh's corners),
     * measured along it. Past that the ground on its two sides is one piece,
     * and a contact runs unbroken round its end (absent: it runs through
     * the whole model). Used only in a model that fits its contacts by fault
     * block itself (`GeoModel.byBlock`): see geoModel.ts `stopProblem`.
     */
    extent?: { reach: number };
    /**
     * The younger faults of the model that offset it (by id): it is fitted
     * on each side of those apart, from what of its own places is there (a
     * fitted surface only: a mesh is where it is). A fault that offsets one
     * of those offsets it too. See faultCuts.ts.
     */
    cutBy?: string[];
    /** Left out of the model for now */
    off?: boolean;
}

/** The ground a model covers */
export interface ModelBoundary {
    /** Its box (null: the box of the data, with a margin) */
    box: Box3 | null;
    /** An outline it is kept inside, as a column along the direction it was drawn in */
    outline?: SurfaceOutline;
    /** A surface that is its top (the ground): above it there is nothing */
    top?: string;
    /**
     * It is kept near its drilling: ground further than `reach` m from
     * every hole it reads (the logged holes of its lithologies) is not in
     * it, but for gaps between holes narrower than the reach, which are
     * filled. `reach` null: worked out from how far apart its holes are
     * (modelGround.ts, `drillingReach`). Absent: it fills its box.
     */
    near?: { reach: number | null };
    /**
     * It is inside one unit of another model (a refined unit: alteration,
     * weathering or mineralisation inside a rock type): it has ground only
     * where that model has that unit.
     */
    inside?: { model: string; unit: string };
}

/** The colour a model shows a unit in, when not that of its unit map */
export interface ModelUnitLook {
    name: string;
    color: string;
}

export interface GeoModel {
    id: string;
    name: string;
    /** The model units its unit names and colours are taken from (its id) */
    unitMap?: string;
    /** The oldest unit: the ground everything else is in */
    base: string;
    /** Colours given to units here */
    units: ModelUnitLook[];
    /** Its contacts in age order, the youngest first */
    contacts: ModelContact[];
    /** Its faults (absent: none) */
    faults?: ModelFault[];
    /**
     * While it is cut by faults, each of its contacts is fitted in each fault
     * block apart, by parts of its surface that the model makes and keeps
     * (blockParts.ts). Absent: a contact is one surface through every block
     * unless it was split by hand (a model from before this was done by the program).
     */
    byBlock?: boolean;
    boundary: ModelBoundary;
    /** The size of the cells it is built with, m (null: worked out from its size) */
    cell: number | null;
    /** false: it is rebuilt only when asked (absent: whenever something it depends on changes) */
    auto?: boolean;
    /** The dataset column it fills in with each sample's unit (geoModelColumns.ts), and the build that column was written for */
    column?: string;
    columnFor?: string;
    /** The column it fills in with each sample's fault block, beside the one of its unit (absent: it is not cut by faults) */
    blockColumn?: string;
}

/** Folders kept in the project tree, by the group they are in (folders.ts) */
export type SceneFolders = Partial<Record<'points' | 'lines' | 'surfaces' | 'readings' | 'meshes', string[]>>;

/**
 * The units a model is built of, made from logged codes (units.ts): each unit
 * is one or more codes, and intervals can be given to a unit by hand whatever
 * they were logged as. A surface built from logging can read its units from
 * here instead of from the codes themselves.
 */
export interface UnitMap {
    id: string;
    name: string;
    /** The table logged down the holes the columns are in (its id); not set: columns of the dataset */
    table?: string;
    /** The logging columns. With several, a code is their values together ("BAS + SER": a unit from several columns) */
    columns: string[];
    /** The units, in order down the holes (the colours follow it) */
    units: ModelUnit[];
    /** Intervals given to a unit by hand, by hole and depth (so they hold through a re-import) */
    reassigned: Reassignment[];
}

export interface ModelUnit {
    name: string;
    color: string;
    /** The logged codes it is made of */
    codes: string[];
    /**
     * A stretch of it down a hole shorter than this (m), with other units
     * above and below it, is not read as logged (units.ts `unitsOfRows`):
     * inside one unit it is read as that unit, between two it is left out.
     * Not set: every stretch is read as logged.
     */
    minRun?: number;
}

/** Every interval of a hole whose middle is between these depths is of `unit` ('' = as if not logged) */
export interface Reassignment {
    hole: string;
    from: number;
    to: number;
    unit: string;
}

/**
 * A set of parallel, evenly spaced planes to look at and draw on: sections
 * (vertical), level plans, or tilted. Plane `i` passes through
 * `origin + i * spacing * normal`, so stepping along a set always lands on
 * the same planes.
 */
export interface SectionSet {
    id: string;
    name: string;
    /** Unit normal: its largest part positive (sections step north or east, plans step up) */
    normal: Vec3;
    /** A point on plane 0, world coordinates */
    origin: Vec3;
    /** Distance between planes (m) */
    spacing: number;
    /** Thickness of the slab seen about each plane (m) */
    width: number;
}
