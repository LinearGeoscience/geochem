/**
 * Classification diagram schema v3 — a faithful model of the diagram
 * XML (see utils/classification/interopXml.ts), built into
 * data/classificationDiagrams.json by `npm run build:diagrams`.
 *
 * Geometry is stored in DIAGRAM SPACE:
 *  - XY diagrams: points are `[x, y]` in data units (also for log axes —
 *    the log transform happens at render time).
 *  - Ternary diagrams: points are `[a, b, c]` percentages summing to 100,
 *    a = top apex, b = bottom-left, c = bottom-right (Plotly's convention).
 *    stores ternary boundaries in a Cartesian triangle of side 100;
 *    they are converted at build time (an affine map, so Bézier control
 *    points stay valid).
 */

export type DiagramKind = 'xy' | 'ternary' | 'builtin';

/** `[x, y]` for XY diagrams, `[a, b, c]` (percent) for ternary diagrams. */
export type Pt = number[];

export interface Rgb { r: number; g: number; b: number }

export type PathSegment =
    | { kind: 'line'; to: Pt }
    | { kind: 'cubic'; c1: Pt; c2: Pt; to: Pt };

/** A classification field (closed) or a drawn polyline/curve (open). */
export interface DiagramField {
    name: string;
    color: Rgb;
    /** Closed fields classify samples; open ones are boundaries/arrows. */
    closed: boolean;
    visible: boolean;
    /** Draw an arrowhead at the end of an open path. */
    endArrow?: boolean;
    /** Path start point; each segment continues from the previous end. */
    start: Pt;
    path: PathSegment[];
    labelPos?: Pt;
    /** Label rotation in degrees (stores radians). */
    labelAngleDeg?: number;
}

/** y = slope·x + intercept, or a vertical line x = intercept. */
export interface DiagramLine {
    name: string;
    color: Rgb;
    visible: boolean;
    slope: number;
    intercept: number;
    vertical?: boolean;
    labelAngleDeg?: number;
}

/** A labelled marker, e.g. a mineral node (albite, chlorite…). */
export interface DiagramPoint {
    name: string;
    color: Rgb;
    visible: boolean;
    pos: Pt;
    pixelRadius: number;
}

export interface DiagramLabel {
    text: string;
    color: Rgb;
    visible: boolean;
    pos: Pt;
    angleDeg: number;
}

export type AxisKey = 'x' | 'y' | 'a' | 'b' | 'c';

/**
 * - `element`: a single element/oxide column (GeochemAxis*)
 * - `function`: a formula over diagram variables (GeochemFunctionAxis*)
 * - `free`: a column matched by axis name (FreeAxis*, e.g. aiSIRIS "Wav_Alunite")
 * - `freeFunction`: a formula over free (column-name) variables
 */
export type DiagramAxisKind = 'element' | 'function' | 'free' | 'freeFunction';

export interface DiagramAxisV3 {
    kind: DiagramAxisKind;
    /** Display name / title (e.g. "AI", "Na2O+K2O"). */
    name: string;
    /** For `element` axes. */
    element?: string;
    unit?: string;
    /** For function axes (interop dialect, case-insensitive letters). */
    formula?: string;
    log: boolean;
}

/**
 * A formula variable. `element` is an element/oxide name ("SiO2", "FeO*",
 * "Na-mol") for Geochem diagrams; `columnName` a literal column name for
 * Free diagrams. Units: pct | ppm | ppb | mol/kg (Free variables: none).
 */
export interface DiagramVariableV3 {
    letter: string;
    element?: string;
    columnName?: string;
    unit?: string;
}

export interface DiagramBounds { x: number; y: number; w: number; h: number }

export interface Diagram {
    /** Unique, derived from category path + file name. */
    id: string;
    /** Ids this diagram had in the v2 library (for saved projects). */
    legacyIds?: string[];
    name: string;
    kind: DiagramKind;
    /** e.g. 'piper' for kind === 'builtin'. */
    builtin?: string;
    /** Folder path, e.g. ['Rock Classification', 'Major Elements']. */
    category: string[];
    sourceFile: string;
    /** variateMode; 'Uni_Nulls_As_Zeros' treats missing inputs as 0. */
    variateMode?: string;
    axes: Partial<Record<AxisKey, DiagramAxisV3>>;
    variables: DiagramVariableV3[];
    /** NamedExpression chain (intermediate letters). */
    expressions?: { letter: string; expression: string }[];
    fields: DiagramField[];
    lines?: DiagramLine[];
    points?: DiagramPoint[];
    labels?: DiagramLabel[];
    /** XY plot extent (data units). */
    bounds?: DiagramBounds;
    comments: string[];
    references: string[];
    descriptions?: string[];
}

export interface DiagramLibrary {
    schema: 3;
    generated: string;
    source: string;
    totalDiagrams: number;
    diagrams: Diagram[];
}
