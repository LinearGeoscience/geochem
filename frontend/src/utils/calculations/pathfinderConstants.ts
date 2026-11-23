/**
 * Pathfinder Element Constants
 *
 * Based on Dr. Scott Halley's pathfinder chemistry methodology for
 * geochemical anomaly detection in mineral exploration.
 *
 * Crustal abundance thresholds are used to classify element concentrations
 * as multiples of background (crustal) values.
 */

/**
 * List of pathfinder elements with their symbols
 */
export const PATHFINDER_ELEMENTS = [
    'Mo', 'W', 'Sn', 'Bi', 'Te', 'As', 'Sb', 'Ag',
    'Pb', 'Zn', 'Cu', 'In', 'Cd', 'Li', 'Cs', 'Tl'
] as const;

export type PathfinderElement = typeof PATHFINDER_ELEMENTS[number];

/**
 * Average crustal abundance values (ppm) for each pathfinder element
 */
export const CRUSTAL_ABUNDANCE: Record<PathfinderElement, number> = {
    Mo: 0.5,
    W: 0.5,
    Sn: 1.5,
    Bi: 0.05,
    Te: 0.001,
    As: 5,
    Sb: 0.5,
    Ag: 0.01,
    Pb: 20,
    Zn: 50,
    Cu: 50,
    In: 0.1,
    Cd: 0.1,
    Li: 20,
    Cs: 2,
    Tl: 1
};

/**
 * Anomaly classification thresholds for each element
 * Values represent upper bounds for each class:
 * - background: ≤1x crustal abundance
 * - x2: 1x to 2x crustal abundance
 * - x3: 2x to 3x crustal abundance
 * - x5: 3x to 5x crustal abundance
 * - x10: >5x crustal abundance (≥10x is significant anomaly)
 */
export interface AnomalyThresholds {
    background: number;  // Upper bound for background class
    x2: number;          // Upper bound for 2x class
    x3: number;          // Upper bound for 3x class
    x5: number;          // Upper bound for 5x class
    // Values above x5 are classified as 10x (significant anomaly)
}

export const ANOMALY_THRESHOLDS: Record<PathfinderElement, AnomalyThresholds> = {
    Mo: { background: 1, x2: 2, x3: 3, x5: 5 },
    W: { background: 1, x2: 3, x3: 6, x5: 10 },
    Sn: { background: 1.5, x2: 2.5, x3: 5, x5: 8 },
    Bi: { background: 0.1, x2: 0.2, x3: 0.5, x5: 1 },
    Te: { background: 0.1, x2: 0.2, x3: 0.5, x5: 1 },
    As: { background: 10, x2: 20, x3: 50, x5: 100 },
    Sb: { background: 1, x2: 2, x3: 3, x5: 5 },
    Ag: { background: 0.05, x2: 0.1, x3: 0.2, x5: 0.5 },
    Pb: { background: 15, x2: 30, x3: 60, x5: 100 },
    Zn: { background: 100, x2: 200, x3: 300, x5: 500 },
    Cu: { background: 60, x2: 100, x3: 200, x5: 300 },
    In: { background: 0.05, x2: 0.1, x3: 0.2, x5: 0.3 },
    Cd: { background: 0.1, x2: 0.2, x3: 0.5, x5: 1 },
    Li: { background: 15, x2: 25, x3: 40, x5: 50 },
    Cs: { background: 1.5, x2: 4, x3: 6, x5: 10 },
    Tl: { background: 0.5, x2: 1, x3: 2, x5: 4 }
};

/**
 * Anomaly class names in order from lowest to highest
 */
export const ANOMALY_CLASSES = ['background', '2x', '3x', '5x', '10x'] as const;
export type AnomalyClass = typeof ANOMALY_CLASSES[number] | 'nodata';

/**
 * Colors for each anomaly class (matching Halley's color scheme)
 * Blue → Cyan → Green → Yellow → Red
 */
export const ANOMALY_COLORS: Record<AnomalyClass, string> = {
    nodata: '#cccccc',    // Gray for no data
    background: '#3288bd', // Blue - background/1x crustal
    '2x': '#66c2a5',       // Cyan - 2x background
    '3x': '#abdda4',       // Green - 3x background
    '5x': '#fdae61',       // Yellow/Orange - 5x background
    '10x': '#d53e4f'       // Red - 10x+ background (significant anomaly)
};

/**
 * Display labels for each anomaly class
 */
export const ANOMALY_LABELS: Record<AnomalyClass, string> = {
    nodata: 'No Data',
    background: 'Background (≤1x)',
    '2x': '2x Background',
    '3x': '3x Background',
    '5x': '5x Background',
    '10x': '≥10x Background'
};

/**
 * Elements that can be normalized to Sc (scandium) for host-rock correction
 * These elements vary strongly with mafic rock composition
 */
export const SC_NORMALIZABLE_ELEMENTS: PathfinderElement[] = ['Zn', 'Cu', 'In'];

/**
 * Elements that can be normalized to K (potassium) for host-rock correction
 * These elements vary strongly with felsic/alkali rock composition
 */
export const K_NORMALIZABLE_ELEMENTS: PathfinderElement[] = ['Cs', 'Tl'];

/**
 * Elements noted as strongly host-rock dependent in Halley's methodology
 */
export const HOST_ROCK_DEPENDENT_ELEMENTS: PathfinderElement[] = [
    'Pb', 'Zn', 'Cu', 'In', 'Li', 'Cs', 'Tl'
];

/**
 * Z-order values for rendering (higher values render on top)
 */
export const ANOMALY_Z_ORDER: Record<AnomalyClass, number> = {
    nodata: 0,
    background: 1,
    '2x': 2,
    '3x': 3,
    '5x': 4,
    '10x': 5
};

/**
 * Column name patterns for auto-detecting pathfinder element columns
 */
export const ELEMENT_COLUMN_PATTERNS: Record<PathfinderElement, RegExp[]> = {
    Mo: [/^mo$/i, /^mo[_\s]?ppm$/i, /molybdenum/i],
    W: [/^w$/i, /^w[_\s]?ppm$/i, /tungsten/i],
    Sn: [/^sn$/i, /^sn[_\s]?ppm$/i, /tin/i],
    Bi: [/^bi$/i, /^bi[_\s]?ppm$/i, /bismuth/i],
    Te: [/^te$/i, /^te[_\s]?ppm$/i, /tellurium/i],
    As: [/^as$/i, /^as[_\s]?ppm$/i, /arsenic/i],
    Sb: [/^sb$/i, /^sb[_\s]?ppm$/i, /antimony/i],
    Ag: [/^ag$/i, /^ag[_\s]?ppm$/i, /silver/i],
    Pb: [/^pb$/i, /^pb[_\s]?ppm$/i, /lead/i],
    Zn: [/^zn$/i, /^zn[_\s]?ppm$/i, /zinc/i],
    Cu: [/^cu$/i, /^cu[_\s]?ppm$/i, /copper/i],
    In: [/^in$/i, /^in[_\s]?ppm$/i, /indium/i],
    Cd: [/^cd$/i, /^cd[_\s]?ppm$/i, /cadmium/i],
    Li: [/^li$/i, /^li[_\s]?ppm$/i, /lithium/i],
    Cs: [/^cs$/i, /^cs[_\s]?ppm$/i, /cesium/i, /caesium/i],
    Tl: [/^tl$/i, /^tl[_\s]?ppm$/i, /thallium/i]
};

/**
 * Normalization element column patterns
 */
export const NORMALIZATION_COLUMN_PATTERNS = {
    Sc: [/^sc$/i, /^sc[_\s]?ppm$/i, /scandium/i],
    K: [/^k$/i, /^k[_\s]?ppm$/i, /^k2o$/i, /potassium/i]
};
