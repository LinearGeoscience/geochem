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
}

/** A line drawn on a slice: the surface crosses the slice along it. */
export interface ScenePolyline {
    id: string;
    /** Its vertices, in the order drawn */
    points: Vec3[];
    /** The slice it was drawn on (its mid-plane) */
    plane: Plane;
    /**
     * Which side of the line is the surface's positive side is worked out
     * from the rest of the surface; true turns this line over.
     */
    flipped: boolean;
}

/** A surface put where the logging changes from one group of units to another down the drillholes */
export interface ContactRule {
    kind: 'contact';
    /** The logging column */
    column: string;
    /** The units on the first (positive) side, and on the second */
    sideA: string[];
    sideB: string[];
    /** The longest unlogged stretch of hole a contact is put across, m (null: twice the usual interval length) */
    maxGap: number | null;
    /** A unit thinner than this down the hole, inside the other side, is left out, m (null: none is) */
    minRun: number | null;
}

/** A closed surface round the volume one or more logged units fill */
export interface BodyRule {
    kind: 'body';
    /** The logging column */
    column: string;
    /** The units it is made of */
    inside: string[];
    /** Units that say nothing either way (not logged, core loss): the hole counts as unlogged there. Every other unit is outside it. */
    ignore: string[];
    /** The longest unlogged stretch of hole a contact is put across, m (null: twice the usual interval length) */
    maxGap: number | null;
    /** A band thinner than this down the hole, of the body inside the rest or the rest inside the body, is left out, m (null: none is) */
    minRun: number | null;
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
}

export interface SurfaceColumns {
    /** Which side of the surface each sample is on */
    side: string | null;
    /** Distance from each sample to the surface, negative on the negative side */
    distance: string | null;
    /** Mark of the surface's shape when the columns were written (they are redone when it differs) */
    writtenFor: string | null;
}

export interface SurfaceObject {
    id: string;
    name: string;
    rule: SurfaceRule;
    points: ScenePoint[];
    /** Lines drawn on slices that the surface passes along */
    polylines: ScenePolyline[];
    /** A direction the surface runs in while its points only define a line */
    along: Vec3 | null;
    /** Fixes which side is the positive one, so the sides never swap as points are added */
    refDirection: Vec3 | null;
    params: SurfaceParams;
    /** Names of the positive and negative side (null = named from the way the surface faces) */
    sides: [string, string] | null;
    /** Dataset columns this surface fills in, and the state of the surface they were last written for */
    columns: SurfaceColumns;
    color: string;
    opacity: number;
    visible: boolean;
    showEdges: boolean;
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
    surfaces: SurfaceObject[];
    /** Wireframes loaded from files; the files themselves are kept in the project folder, not in the project file */
    wireframes: WireframeObject[];
    /** Absent in scenes made before there was one: no structure */
    structure?: SceneStructure;
}
