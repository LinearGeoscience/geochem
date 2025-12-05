// Geochemical Calculations - Constants and Reference Values

import { ConversionFactor, NormalizationStandard } from '../../types/calculations';

// Atomic weights (IUPAC 2021)
export const ATOMIC_WEIGHTS: Record<string, number> = {
    H: 1.008,
    C: 12.011,
    N: 14.007,
    O: 15.999,
    F: 18.998,
    Na: 22.990,
    Mg: 24.305,
    Al: 26.982,
    Si: 28.086,
    P: 30.974,
    S: 32.065,
    Cl: 35.453,
    K: 39.098,
    Ca: 40.078,
    Sc: 44.956,
    Ti: 47.867,
    V: 50.942,
    Cr: 51.996,
    Mn: 54.938,
    Fe: 55.845,
    Co: 58.933,
    Ni: 58.693,
    Cu: 63.546,
    Zn: 65.380,
    Ga: 69.723,
    Ge: 72.630,
    As: 74.922,
    Se: 78.971,
    Br: 79.904,
    Rb: 85.468,
    Sr: 87.620,
    Y: 88.906,
    Zr: 91.224,
    Nb: 92.906,
    Mo: 95.960,
    Ag: 107.868,
    Cd: 112.411,
    Sn: 118.710,
    Sb: 121.760,
    Te: 127.600,
    I: 126.904,
    Cs: 132.905,
    Ba: 137.327,
    La: 138.905,
    Ce: 140.116,
    Pr: 140.908,
    Nd: 144.242,
    Sm: 150.360,
    Eu: 151.964,
    Gd: 157.250,
    Tb: 158.925,
    Dy: 162.500,
    Ho: 164.930,
    Er: 167.259,
    Tm: 168.934,
    Yb: 173.045,
    Lu: 174.967,
    Hf: 178.490,
    Ta: 180.948,
    W: 183.840,
    Re: 186.207,
    Os: 190.230,
    Ir: 192.217,
    Pt: 195.084,
    Au: 196.967,
    Hg: 200.592,
    Tl: 204.383,
    Pb: 207.200,
    Bi: 208.980,
    Th: 232.038,
    U: 238.029,
};

// Molecular weights of common oxides
export const OXIDE_WEIGHTS: Record<string, number> = {
    SiO2: 60.084,
    TiO2: 79.866,
    Al2O3: 101.961,
    Fe2O3: 159.688,
    FeO: 71.844,
    Fe3O4: 231.533,
    MgO: 40.304,
    CaO: 56.077,
    Na2O: 61.979,
    K2O: 94.196,
    MnO: 70.937,
    P2O5: 141.943,
    Cr2O3: 151.990,
    NiO: 74.692,
    CoO: 74.932,
    CuO: 79.545,
    ZnO: 81.379,
    BaO: 153.326,
    ZrO2: 123.223,
    SO3: 80.064,
    H2O: 18.015,
    CO2: 44.009,
    PbO: 223.199,
    V2O5: 181.880,
};

// Element-to-Oxide conversion factors
// Calculated as: Oxide_MW / (n * Element_MW) where n = number of element atoms in oxide
export const ELEMENT_OXIDE_CONVERSIONS: ConversionFactor[] = [
    { element: 'Si', oxide: 'SiO2', elementToOxide: 2.1393, oxideToElement: 0.4674, elementMW: ATOMIC_WEIGHTS.Si, oxideMW: OXIDE_WEIGHTS.SiO2 },
    { element: 'Ti', oxide: 'TiO2', elementToOxide: 1.6683, oxideToElement: 0.5995, elementMW: ATOMIC_WEIGHTS.Ti, oxideMW: OXIDE_WEIGHTS.TiO2 },
    { element: 'Al', oxide: 'Al2O3', elementToOxide: 1.8895, oxideToElement: 0.5293, elementMW: ATOMIC_WEIGHTS.Al, oxideMW: OXIDE_WEIGHTS.Al2O3 },
    { element: 'Fe', oxide: 'Fe2O3', elementToOxide: 1.4297, oxideToElement: 0.6994, elementMW: ATOMIC_WEIGHTS.Fe, oxideMW: OXIDE_WEIGHTS.Fe2O3 },
    { element: 'Fe', oxide: 'FeO', elementToOxide: 1.2865, oxideToElement: 0.7773, elementMW: ATOMIC_WEIGHTS.Fe, oxideMW: OXIDE_WEIGHTS.FeO },
    { element: 'Fe', oxide: 'Fe3O4', elementToOxide: 1.3820, oxideToElement: 0.7236, elementMW: ATOMIC_WEIGHTS.Fe, oxideMW: OXIDE_WEIGHTS.Fe3O4 },
    { element: 'Mg', oxide: 'MgO', elementToOxide: 1.6583, oxideToElement: 0.6030, elementMW: ATOMIC_WEIGHTS.Mg, oxideMW: OXIDE_WEIGHTS.MgO },
    { element: 'Ca', oxide: 'CaO', elementToOxide: 1.3992, oxideToElement: 0.7147, elementMW: ATOMIC_WEIGHTS.Ca, oxideMW: OXIDE_WEIGHTS.CaO },
    { element: 'Na', oxide: 'Na2O', elementToOxide: 1.3480, oxideToElement: 0.7419, elementMW: ATOMIC_WEIGHTS.Na, oxideMW: OXIDE_WEIGHTS.Na2O },
    { element: 'K', oxide: 'K2O', elementToOxide: 1.2046, oxideToElement: 0.8302, elementMW: ATOMIC_WEIGHTS.K, oxideMW: OXIDE_WEIGHTS.K2O },
    { element: 'Mn', oxide: 'MnO', elementToOxide: 1.2912, oxideToElement: 0.7745, elementMW: ATOMIC_WEIGHTS.Mn, oxideMW: OXIDE_WEIGHTS.MnO },
    { element: 'P', oxide: 'P2O5', elementToOxide: 2.2914, oxideToElement: 0.4364, elementMW: ATOMIC_WEIGHTS.P, oxideMW: OXIDE_WEIGHTS.P2O5 },
    { element: 'Cr', oxide: 'Cr2O3', elementToOxide: 1.4616, oxideToElement: 0.6842, elementMW: ATOMIC_WEIGHTS.Cr, oxideMW: OXIDE_WEIGHTS.Cr2O3 },
    { element: 'Ni', oxide: 'NiO', elementToOxide: 1.2725, oxideToElement: 0.7858, elementMW: ATOMIC_WEIGHTS.Ni, oxideMW: OXIDE_WEIGHTS.NiO },
    { element: 'Co', oxide: 'CoO', elementToOxide: 1.2715, oxideToElement: 0.7865, elementMW: ATOMIC_WEIGHTS.Co, oxideMW: OXIDE_WEIGHTS.CoO },
    { element: 'Cu', oxide: 'CuO', elementToOxide: 1.2518, oxideToElement: 0.7989, elementMW: ATOMIC_WEIGHTS.Cu, oxideMW: OXIDE_WEIGHTS.CuO },
    { element: 'Zn', oxide: 'ZnO', elementToOxide: 1.2448, oxideToElement: 0.8034, elementMW: ATOMIC_WEIGHTS.Zn, oxideMW: OXIDE_WEIGHTS.ZnO },
    { element: 'Ba', oxide: 'BaO', elementToOxide: 1.1165, oxideToElement: 0.8957, elementMW: ATOMIC_WEIGHTS.Ba, oxideMW: OXIDE_WEIGHTS.BaO },
    { element: 'Zr', oxide: 'ZrO2', elementToOxide: 1.3508, oxideToElement: 0.7403, elementMW: ATOMIC_WEIGHTS.Zr, oxideMW: OXIDE_WEIGHTS.ZrO2 },
    { element: 'S', oxide: 'SO3', elementToOxide: 2.4972, oxideToElement: 0.4005, elementMW: ATOMIC_WEIGHTS.S, oxideMW: OXIDE_WEIGHTS.SO3 },
    { element: 'Pb', oxide: 'PbO', elementToOxide: 1.0772, oxideToElement: 0.9283, elementMW: ATOMIC_WEIGHTS.Pb, oxideMW: OXIDE_WEIGHTS.PbO },
    { element: 'V', oxide: 'V2O5', elementToOxide: 1.7852, oxideToElement: 0.5602, elementMW: ATOMIC_WEIGHTS.V, oxideMW: OXIDE_WEIGHTS.V2O5 },
];

// Iron oxide interconversion factors
export const IRON_OXIDE_CONVERSIONS = {
    FeO_to_Fe2O3: 1.1113,
    Fe2O3_to_FeO: 0.8998,
    Fe2O3T_to_FeOT: 0.8998,
    FeOT_to_Fe2O3T: 1.1113,
};

// Unit conversion factors
export const UNIT_CONVERSIONS = {
    ppm_to_wt_percent: 0.0001,
    wt_percent_to_ppm: 10000,
    ppb_to_ppm: 0.001,
    ppm_to_ppb: 1000,
    ppb_to_wt_percent: 0.0000001,
    wt_percent_to_ppb: 10000000,
    percent_to_decimal: 0.01,
    decimal_to_percent: 100,
};

// Chondrite normalization values - McDonough & Sun (1995) CI Chondrite
export const CHONDRITE_MCDONOUGH_SUN_1995: NormalizationStandard = {
    id: 'mcdonough-sun-1995',
    name: 'CI Chondrite (McDonough & Sun 1995)',
    reference: 'McDonough, W.F. & Sun, S.-S. (1995) Chem. Geol. 120, 223-253',
    values: {
        La: 0.237,
        Ce: 0.613,
        Pr: 0.0928,
        Nd: 0.457,
        Sm: 0.148,
        Eu: 0.0563,
        Gd: 0.199,
        Tb: 0.0361,
        Dy: 0.246,
        Ho: 0.0546,
        Er: 0.160,
        Tm: 0.0247,
        Yb: 0.161,
        Lu: 0.0246,
        Y: 1.57,
    },
};

// Chondrite normalization values - Anders & Grevesse (1989) × 1.36
export const CHONDRITE_ANDERS_GREVESSE_1989: NormalizationStandard = {
    id: 'anders-grevesse-1989',
    name: 'CI Chondrite (Anders & Grevesse 1989)',
    reference: 'Anders, E. & Grevesse, N. (1989) Geochim. Cosmochim. Acta 53, 197-214',
    values: {
        La: 0.3100,
        Ce: 0.8080,
        Pr: 0.1220,
        Nd: 0.6000,
        Sm: 0.2000,
        Eu: 0.0760,
        Gd: 0.2670,
        Tb: 0.0493,
        Dy: 0.3300,
        Ho: 0.0755,
        Er: 0.2160,
        Tm: 0.0329,
        Yb: 0.2200,
        Lu: 0.0339,
    },
};

// Primitive Mantle values - McDonough & Sun (1995)
export const PRIMITIVE_MANTLE_MCDONOUGH_SUN: NormalizationStandard = {
    id: 'primitive-mantle-mcdonough-sun',
    name: 'Primitive Mantle (McDonough & Sun 1995)',
    reference: 'McDonough, W.F. & Sun, S.-S. (1995) Chem. Geol. 120, 223-253',
    values: {
        La: 0.648,
        Ce: 1.675,
        Pr: 0.254,
        Nd: 1.250,
        Sm: 0.406,
        Eu: 0.154,
        Gd: 0.544,
        Tb: 0.099,
        Dy: 0.674,
        Ho: 0.149,
        Er: 0.438,
        Tm: 0.068,
        Yb: 0.441,
        Lu: 0.0675,
        Y: 4.30,
    },
};

// PAAS (Post-Archean Australian Shale) - Taylor & McLennan (1985)
export const PAAS_TAYLOR_MCLENNAN: NormalizationStandard = {
    id: 'paas-taylor-mclennan',
    name: 'PAAS (Taylor & McLennan 1985)',
    reference: 'Taylor, S.R. & McLennan, S.M. (1985) The Continental Crust: Its Composition and Evolution',
    values: {
        La: 38.2,
        Ce: 79.6,
        Pr: 8.83,
        Nd: 33.9,
        Sm: 5.55,
        Eu: 1.08,
        Gd: 4.66,
        Tb: 0.774,
        Dy: 4.68,
        Ho: 0.991,
        Er: 2.85,
        Tm: 0.405,
        Yb: 2.82,
        Lu: 0.433,
    },
};

// All available normalization standards
export const NORMALIZATION_STANDARDS: NormalizationStandard[] = [
    CHONDRITE_MCDONOUGH_SUN_1995,
    CHONDRITE_ANDERS_GREVESSE_1989,
    PRIMITIVE_MANTLE_MCDONOUGH_SUN,
    PAAS_TAYLOR_MCLENNAN,
];

// REE elements in order
export const REE_ELEMENTS = ['La', 'Ce', 'Pr', 'Nd', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu'];

// Light REE
export const LREE = ['La', 'Ce', 'Pr', 'Nd'];

// Middle REE
export const MREE = ['Sm', 'Eu', 'Gd', 'Tb', 'Dy'];

// Heavy REE
export const HREE = ['Ho', 'Er', 'Tm', 'Yb', 'Lu'];

// Major oxides for sum checking
export const MAJOR_OXIDES = ['SiO2', 'TiO2', 'Al2O3', 'Fe2O3', 'FeO', 'MgO', 'CaO', 'Na2O', 'K2O', 'MnO', 'P2O5'];

// Common column name patterns for auto-detection
export const COLUMN_PATTERNS: Record<string, { aliases: string[], patterns: RegExp[] }> = {
    SiO2: {
        aliases: ['SiO2', 'SiO2_pct', 'SiO2_wt', 'SiO2_%', 'Silica'],
        patterns: [/^sio2/i, /silica/i],
    },
    TiO2: {
        aliases: ['TiO2', 'TiO2_pct', 'TiO2_wt', 'TiO2_%'],
        patterns: [/^tio2/i],
    },
    Al2O3: {
        aliases: ['Al2O3', 'Al2O3_pct', 'Al2O3_wt', 'Al2O3_%', 'Alumina'],
        patterns: [/^al2o3/i, /alumina/i],
    },
    Fe2O3: {
        aliases: ['Fe2O3', 'Fe2O3_pct', 'Fe2O3_wt', 'Fe2O3_%', 'Fe2O3T', 'Fe2O3t', 'Fe2O3_Total'],
        patterns: [/^fe2o3/i, /ferric/i],
    },
    FeO: {
        aliases: ['FeO', 'FeO_pct', 'FeO_wt', 'FeO_%', 'FeOT', 'FeOt', 'FeO_Total'],
        patterns: [/^feo[^a-z]/i, /^feot/i, /ferrous/i],
    },
    MgO: {
        aliases: ['MgO', 'MgO_pct', 'MgO_wt', 'MgO_%', 'Magnesia'],
        patterns: [/^mgo/i, /magnesia/i],
    },
    CaO: {
        aliases: ['CaO', 'CaO_pct', 'CaO_wt', 'CaO_%', 'Lime'],
        patterns: [/^cao/i, /lime/i],
    },
    Na2O: {
        aliases: ['Na2O', 'Na2O_pct', 'Na2O_wt', 'Na2O_%', 'Soda'],
        patterns: [/^na2o/i, /soda/i],
    },
    K2O: {
        aliases: ['K2O', 'K2O_pct', 'K2O_wt', 'K2O_%', 'Potash'],
        patterns: [/^k2o/i, /potash/i],
    },
    MnO: {
        aliases: ['MnO', 'MnO_pct', 'MnO_wt', 'MnO_%'],
        patterns: [/^mno/i],
    },
    P2O5: {
        aliases: ['P2O5', 'P2O5_pct', 'P2O5_wt', 'P2O5_%', 'Phosphate'],
        patterns: [/^p2o5/i, /phosphate/i],
    },
    // Trace elements (ppm)
    Cu: {
        aliases: ['Cu', 'Cu_ppm', 'Copper'],
        patterns: [/^cu[_\s]?(?:ppm)?$/i, /copper/i],
    },
    Zn: {
        aliases: ['Zn', 'Zn_ppm', 'Zinc'],
        patterns: [/^zn[_\s]?(?:ppm)?$/i, /zinc/i],
    },
    Pb: {
        aliases: ['Pb', 'Pb_ppm', 'Lead'],
        patterns: [/^pb[_\s]?(?:ppm)?$/i, /lead/i],
    },
    Au: {
        aliases: ['Au', 'Au_ppb', 'Au_ppm', 'Gold'],
        patterns: [/^au[_\s]?(?:pp[mb])?$/i, /gold/i],
    },
    Ag: {
        aliases: ['Ag', 'Ag_ppm', 'Silver'],
        patterns: [/^ag[_\s]?(?:ppm)?$/i, /silver/i],
    },
    As: {
        aliases: ['As', 'As_ppm', 'Arsenic'],
        patterns: [/^as[_\s]?(?:ppm)?$/i, /arsenic/i],
    },
    Sb: {
        aliases: ['Sb', 'Sb_ppm', 'Antimony'],
        patterns: [/^sb[_\s]?(?:ppm)?$/i, /antimony/i],
    },
    Rb: {
        aliases: ['Rb', 'Rb_ppm', 'Rubidium'],
        patterns: [/^rb[_\s]?(?:ppm)?$/i, /rubidium/i],
    },
    Sr: {
        aliases: ['Sr', 'Sr_ppm', 'Strontium'],
        patterns: [/^sr[_\s]?(?:ppm)?$/i, /strontium/i],
    },
    Y: {
        aliases: ['Y', 'Y_ppm', 'Yttrium'],
        patterns: [/^y[_\s]?(?:ppm)?$/i, /yttrium/i],
    },
    Zr: {
        aliases: ['Zr', 'Zr_ppm', 'Zirconium'],
        patterns: [/^zr[_\s]?(?:ppm)?$/i, /zirconium/i],
    },
    Nb: {
        aliases: ['Nb', 'Nb_ppm', 'Niobium'],
        patterns: [/^nb[_\s]?(?:ppm)?$/i, /niobium/i],
    },
    Ba: {
        aliases: ['Ba', 'Ba_ppm', 'Barium'],
        patterns: [/^ba[_\s]?(?:ppm)?$/i, /barium/i],
    },
    // REE
    La: { aliases: ['La', 'La_ppm'], patterns: [/^la[_\s]?(?:ppm)?$/i] },
    Ce: { aliases: ['Ce', 'Ce_ppm'], patterns: [/^ce[_\s]?(?:ppm)?$/i] },
    Pr: { aliases: ['Pr', 'Pr_ppm'], patterns: [/^pr[_\s]?(?:ppm)?$/i] },
    Nd: { aliases: ['Nd', 'Nd_ppm'], patterns: [/^nd[_\s]?(?:ppm)?$/i] },
    Sm: { aliases: ['Sm', 'Sm_ppm'], patterns: [/^sm[_\s]?(?:ppm)?$/i] },
    Eu: { aliases: ['Eu', 'Eu_ppm'], patterns: [/^eu[_\s]?(?:ppm)?$/i] },
    Gd: { aliases: ['Gd', 'Gd_ppm'], patterns: [/^gd[_\s]?(?:ppm)?$/i] },
    Tb: { aliases: ['Tb', 'Tb_ppm'], patterns: [/^tb[_\s]?(?:ppm)?$/i] },
    Dy: { aliases: ['Dy', 'Dy_ppm'], patterns: [/^dy[_\s]?(?:ppm)?$/i] },
    Ho: { aliases: ['Ho', 'Ho_ppm'], patterns: [/^ho[_\s]?(?:ppm)?$/i] },
    Er: { aliases: ['Er', 'Er_ppm'], patterns: [/^er[_\s]?(?:ppm)?$/i] },
    Tm: { aliases: ['Tm', 'Tm_ppm'], patterns: [/^tm[_\s]?(?:ppm)?$/i] },
    Yb: { aliases: ['Yb', 'Yb_ppm'], patterns: [/^yb[_\s]?(?:ppm)?$/i] },
    Lu: { aliases: ['Lu', 'Lu_ppm'], patterns: [/^lu[_\s]?(?:ppm)?$/i] },
};

// Helper function to find conversion factor
export function getConversionFactor(element: string, oxide: string): ConversionFactor | undefined {
    return ELEMENT_OXIDE_CONVERSIONS.find(
        c => c.element.toLowerCase() === element.toLowerCase() && c.oxide.toLowerCase() === oxide.toLowerCase()
    );
}

// Helper function to get all oxides for an element
export function getOxidesForElement(element: string): ConversionFactor[] {
    return ELEMENT_OXIDE_CONVERSIONS.filter(
        c => c.element.toLowerCase() === element.toLowerCase()
    );
}

// Helper function to get normalization standard by ID
export function getNormalizationStandard(id: string): NormalizationStandard | undefined {
    return NORMALIZATION_STANDARDS.find(s => s.id === id);
}
