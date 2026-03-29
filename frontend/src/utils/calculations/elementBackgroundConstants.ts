/**
 * Element Background Concentration Library
 *
 * Provides published background concentration values for common geochemical elements
 * across multiple reference standards. Used for anomaly classification on maps.
 *
 * References:
 * - Rudnick, R.L. & Gao, S. (2003/2014) Composition of the Continental Crust.
 *   Treatise on Geochemistry, 2nd Ed., Vol. 4, pp. 1-51.
 * - Kabata-Pendias, A. (2011) Trace Elements in Soils and Plants, 4th Ed. CRC Press.
 */

import { PATHFINDER_ELEMENTS, type AnomalyThresholds } from './pathfinderConstants';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ReferenceStandardId = 'ucc-rudnick-gao-2003' | 'world-soil-kabata-pendias-2011' | 'custom';

export type ElementCategory = 'major' | 'trace' | 'ree' | 'pathfinder';

export interface ElementBackgroundEntry {
    symbol: string;
    value: number;
    unit: 'ppm' | 'wt%';
    category: ElementCategory;
}

export interface BackgroundStandard {
    id: ReferenceStandardId;
    name: string;
    reference: string;
    description: string;
    values: Record<string, ElementBackgroundEntry>;
}

// ─── Element Categories for UI Grouping ──────────────────────────────────────

export const EXTENDED_ELEMENT_CATEGORIES = {
    major: {
        label: 'Major Oxides',
        elements: ['SiO2', 'TiO2', 'Al2O3', 'Fe2O3T', 'MnO', 'MgO', 'CaO', 'Na2O', 'K2O', 'P2O5']
    },
    pathfinder: {
        label: 'Pathfinder Elements',
        elements: [...PATHFINDER_ELEMENTS]
    },
    ree: {
        label: 'Rare Earth Elements',
        elements: ['La', 'Ce', 'Pr', 'Nd', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu']
    },
    otherTrace: {
        label: 'Other Trace Elements',
        elements: ['Be', 'B', 'Sc', 'V', 'Cr', 'Co', 'Ni', 'Ga', 'Ge', 'Se', 'Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Ba', 'Hf', 'Ta', 'Au', 'Th', 'U']
    }
} as const;

// ─── Helper to build entry records ───────────────────────────────────────────

function entry(symbol: string, value: number, unit: 'ppm' | 'wt%', category: ElementCategory): ElementBackgroundEntry {
    return { symbol, value, unit, category };
}

// ─── Upper Continental Crust (Rudnick & Gao 2003/2014) ──────────────────────

const uccValues: Record<string, ElementBackgroundEntry> = {
    // Major oxides (wt%)
    SiO2:   entry('SiO2',   66.62, 'wt%', 'major'),
    TiO2:   entry('TiO2',    0.64, 'wt%', 'major'),
    Al2O3:  entry('Al2O3',  15.40, 'wt%', 'major'),
    Fe2O3T: entry('Fe2O3T',  5.04, 'wt%', 'major'),
    MnO:    entry('MnO',     0.10, 'wt%', 'major'),
    MgO:    entry('MgO',     2.48, 'wt%', 'major'),
    CaO:    entry('CaO',     3.59, 'wt%', 'major'),
    Na2O:   entry('Na2O',    3.27, 'wt%', 'major'),
    K2O:    entry('K2O',     2.80, 'wt%', 'major'),
    P2O5:   entry('P2O5',    0.15, 'wt%', 'major'),

    // Pathfinder elements (ppm)
    Mo: entry('Mo',  1.1,    'ppm', 'pathfinder'),
    W:  entry('W',   1.9,    'ppm', 'pathfinder'),
    Sn: entry('Sn',  2.1,    'ppm', 'pathfinder'),
    Bi: entry('Bi',  0.16,   'ppm', 'pathfinder'),
    Te: entry('Te',  0.027,  'ppm', 'pathfinder'),
    As: entry('As',  4.8,    'ppm', 'pathfinder'),
    Sb: entry('Sb',  0.4,    'ppm', 'pathfinder'),
    Ag: entry('Ag',  0.053,  'ppm', 'pathfinder'),
    Pb: entry('Pb', 17,      'ppm', 'pathfinder'),
    Zn: entry('Zn', 67,      'ppm', 'pathfinder'),
    Cu: entry('Cu', 28,      'ppm', 'pathfinder'),
    In: entry('In',  0.056,  'ppm', 'pathfinder'),
    Cd: entry('Cd',  0.09,   'ppm', 'pathfinder'),
    Li: entry('Li', 24,      'ppm', 'pathfinder'),
    Cs: entry('Cs',  4.9,    'ppm', 'pathfinder'),
    Tl: entry('Tl',  0.9,    'ppm', 'pathfinder'),

    // Rare Earth Elements (ppm)
    La: entry('La', 31,    'ppm', 'ree'),
    Ce: entry('Ce', 63,    'ppm', 'ree'),
    Pr: entry('Pr',  7.1,  'ppm', 'ree'),
    Nd: entry('Nd', 27,    'ppm', 'ree'),
    Sm: entry('Sm',  4.7,  'ppm', 'ree'),
    Eu: entry('Eu',  1.0,  'ppm', 'ree'),
    Gd: entry('Gd',  4.0,  'ppm', 'ree'),
    Tb: entry('Tb',  0.7,  'ppm', 'ree'),
    Dy: entry('Dy',  3.9,  'ppm', 'ree'),
    Ho: entry('Ho',  0.83, 'ppm', 'ree'),
    Er: entry('Er',  2.3,  'ppm', 'ree'),
    Tm: entry('Tm',  0.3,  'ppm', 'ree'),
    Yb: entry('Yb',  2.0,  'ppm', 'ree'),
    Lu: entry('Lu',  0.31, 'ppm', 'ree'),

    // Other trace elements (ppm)
    Be: entry('Be',   2.1,    'ppm', 'trace'),
    B:  entry('B',   17,      'ppm', 'trace'),
    Sc: entry('Sc',  14,      'ppm', 'trace'),
    V:  entry('V',   97,      'ppm', 'trace'),
    Cr: entry('Cr',  92,      'ppm', 'trace'),
    Co: entry('Co',  17.3,    'ppm', 'trace'),
    Ni: entry('Ni',  47,      'ppm', 'trace'),
    Ga: entry('Ga',  17.5,    'ppm', 'trace'),
    Ge: entry('Ge',   1.4,    'ppm', 'trace'),
    Se: entry('Se',   0.09,   'ppm', 'trace'),
    Rb: entry('Rb',  84,      'ppm', 'trace'),
    Sr: entry('Sr', 320,      'ppm', 'trace'),
    Y:  entry('Y',   21,      'ppm', 'trace'),
    Zr: entry('Zr', 193,      'ppm', 'trace'),
    Nb: entry('Nb',  12,      'ppm', 'trace'),
    Ba: entry('Ba', 628,      'ppm', 'trace'),
    Hf: entry('Hf',   5.3,    'ppm', 'trace'),
    Ta: entry('Ta',   0.9,    'ppm', 'trace'),
    Au: entry('Au',   0.0015, 'ppm', 'trace'),
    Th: entry('Th',  10.5,    'ppm', 'trace'),
    U:  entry('U',    2.7,    'ppm', 'trace'),
};

export const UCC_RUDNICK_GAO_2003: BackgroundStandard = {
    id: 'ucc-rudnick-gao-2003',
    name: 'Upper Continental Crust (UCC)',
    reference: 'Rudnick & Gao (2003/2014)',
    description: 'Average composition of the upper continental crust. The most widely used reference for geochemical anomaly detection.',
    values: uccValues
};

// ─── World Soil Average (Kabata-Pendias 2011) ────────────────────────────────

const soilValues: Record<string, ElementBackgroundEntry> = {
    // Major oxides -- world soil averages are less standardised for majors;
    // values here from Kabata-Pendias (2011) Table 3.1 where available
    SiO2:   entry('SiO2',   67.0,  'wt%', 'major'),
    TiO2:   entry('TiO2',    0.60, 'wt%', 'major'),
    Al2O3:  entry('Al2O3',  13.0,  'wt%', 'major'),
    Fe2O3T: entry('Fe2O3T',  5.0,  'wt%', 'major'),
    MnO:    entry('MnO',     0.10, 'wt%', 'major'),
    MgO:    entry('MgO',     1.60, 'wt%', 'major'),
    CaO:    entry('CaO',     2.40, 'wt%', 'major'),
    Na2O:   entry('Na2O',    1.60, 'wt%', 'major'),
    K2O:    entry('K2O',     2.00, 'wt%', 'major'),
    P2O5:   entry('P2O5',    0.18, 'wt%', 'major'),

    // Pathfinder elements (ppm) - soil medians/means from Kabata-Pendias (2011)
    Mo: entry('Mo',  1.8,    'ppm', 'pathfinder'),
    W:  entry('W',   1.5,    'ppm', 'pathfinder'),
    Sn: entry('Sn',  2.5,    'ppm', 'pathfinder'),
    Bi: entry('Bi',  0.3,    'ppm', 'pathfinder'),
    Te: entry('Te',  0.06,   'ppm', 'pathfinder'),
    As: entry('As',  6.83,   'ppm', 'pathfinder'),
    Sb: entry('Sb',  0.67,   'ppm', 'pathfinder'),
    Ag: entry('Ag',  0.05,   'ppm', 'pathfinder'),
    Pb: entry('Pb', 27,      'ppm', 'pathfinder'),
    Zn: entry('Zn', 70,      'ppm', 'pathfinder'),
    Cu: entry('Cu', 38.9,    'ppm', 'pathfinder'),
    In: entry('In',  0.06,   'ppm', 'pathfinder'),
    Cd: entry('Cd',  0.41,   'ppm', 'pathfinder'),
    Li: entry('Li', 25,      'ppm', 'pathfinder'),
    Cs: entry('Cs',  5.1,    'ppm', 'pathfinder'),
    Tl: entry('Tl',  0.75,   'ppm', 'pathfinder'),

    // Rare Earth Elements (ppm) - soil averages
    La: entry('La', 35,    'ppm', 'ree'),
    Ce: entry('Ce', 65,    'ppm', 'ree'),
    Pr: entry('Pr',  7.6,  'ppm', 'ree'),
    Nd: entry('Nd', 28,    'ppm', 'ree'),
    Sm: entry('Sm',  5.3,  'ppm', 'ree'),
    Eu: entry('Eu',  1.1,  'ppm', 'ree'),
    Gd: entry('Gd',  4.7,  'ppm', 'ree'),
    Tb: entry('Tb',  0.7,  'ppm', 'ree'),
    Dy: entry('Dy',  4.2,  'ppm', 'ree'),
    Ho: entry('Ho',  0.9,  'ppm', 'ree'),
    Er: entry('Er',  2.5,  'ppm', 'ree'),
    Tm: entry('Tm',  0.4,  'ppm', 'ree'),
    Yb: entry('Yb',  2.3,  'ppm', 'ree'),
    Lu: entry('Lu',  0.35, 'ppm', 'ree'),

    // Other trace elements (ppm)
    Be: entry('Be',   1.5,    'ppm', 'trace'),
    B:  entry('B',   33,      'ppm', 'trace'),
    Sc: entry('Sc',  11.4,    'ppm', 'trace'),
    V:  entry('V',  115,      'ppm', 'trace'),
    Cr: entry('Cr',  59.5,    'ppm', 'trace'),
    Co: entry('Co',  11.3,    'ppm', 'trace'),
    Ni: entry('Ni',  29,      'ppm', 'trace'),
    Ga: entry('Ga',  17,      'ppm', 'trace'),
    Ge: entry('Ge',   1.2,    'ppm', 'trace'),
    Se: entry('Se',   0.44,   'ppm', 'trace'),
    Rb: entry('Rb',  78,      'ppm', 'trace'),
    Sr: entry('Sr', 175,      'ppm', 'trace'),
    Y:  entry('Y',   22,      'ppm', 'trace'),
    Zr: entry('Zr', 230,      'ppm', 'trace'),
    Nb: entry('Nb',  12,      'ppm', 'trace'),
    Ba: entry('Ba', 500,      'ppm', 'trace'),
    Hf: entry('Hf',   5.8,    'ppm', 'trace'),
    Ta: entry('Ta',   1.1,    'ppm', 'trace'),
    Au: entry('Au',   0.003,  'ppm', 'trace'),
    Th: entry('Th',   9.4,    'ppm', 'trace'),
    U:  entry('U',    2.7,    'ppm', 'trace'),
};

export const WORLD_SOIL_KABATA_PENDIAS_2011: BackgroundStandard = {
    id: 'world-soil-kabata-pendias-2011',
    name: 'World Soil Average',
    reference: 'Kabata-Pendias (2011)',
    description: 'Average element concentrations in world soils. Useful for soil and till geochemistry where weathering enrichment is expected.',
    values: soilValues
};

// ─── Standards Registry ──────────────────────────────────────────────────────

export const BACKGROUND_STANDARDS: BackgroundStandard[] = [
    UCC_RUDNICK_GAO_2003,
    WORLD_SOIL_KABATA_PENDIAS_2011
];

// ─── Lookup Helpers ──────────────────────────────────────────────────────────

/**
 * Get the background value for an element from a reference standard.
 * Tries exact match first, then case-insensitive match.
 */
export function getBackgroundValue(
    standardId: ReferenceStandardId,
    elementOrOxide: string
): ElementBackgroundEntry | null {
    if (standardId === 'custom') return null;

    const standard = BACKGROUND_STANDARDS.find(s => s.id === standardId);
    if (!standard) return null;

    // Exact match
    if (standard.values[elementOrOxide]) {
        return standard.values[elementOrOxide];
    }

    // Case-insensitive match
    const key = Object.keys(standard.values).find(
        k => k.toLowerCase() === elementOrOxide.toLowerCase()
    );
    return key ? standard.values[key] : null;
}

/**
 * Generate anomaly thresholds from a background value using strict multiples.
 */
export function generateAnomalyThresholds(backgroundValue: number): AnomalyThresholds {
    return {
        background: backgroundValue,
        x2: backgroundValue * 2,
        x3: backgroundValue * 3,
        x5: backgroundValue * 5
    };
}

/**
 * Get all element symbols available in a reference standard.
 */
export function getAllAvailableElements(standardId: ReferenceStandardId): string[] {
    if (standardId === 'custom') return [];
    const standard = BACKGROUND_STANDARDS.find(s => s.id === standardId);
    return standard ? Object.keys(standard.values) : [];
}

/**
 * Get element category for UI grouping.
 */
export function getElementCategory(elementOrOxide: string): ElementCategory | null {
    for (const [cat, group] of Object.entries(EXTENDED_ELEMENT_CATEGORIES)) {
        if ((group.elements as readonly string[]).includes(elementOrOxide)) {
            return cat as ElementCategory;
        }
    }
    return null;
}
