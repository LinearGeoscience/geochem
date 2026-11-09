// Diagram-Derived Geochemical Calculations
// Formulas extracted from classification diagrams for standalone use

import { CalculationDefinition, InputDefinition } from '../../types/calculations';
import { OXIDE_WEIGHTS } from './constants';

// Molecular weights for convenience
const MW = {
    Al2O3: OXIDE_WEIGHTS.Al2O3,  // 101.961
    K2O: OXIDE_WEIGHTS.K2O,      // 94.196
    Na2O: OXIDE_WEIGHTS.Na2O,    // 61.979
    CaO: OXIDE_WEIGHTS.CaO,      // 56.077
    MgO: OXIDE_WEIGHTS.MgO,      // 40.304
    FeO: OXIDE_WEIGHTS.FeO,      // 71.844
    Fe2O3: OXIDE_WEIGHTS.Fe2O3,  // 159.688
    TiO2: OXIDE_WEIGHTS.TiO2,    // 79.866
    SiO2: OXIDE_WEIGHTS.SiO2,    // 60.084
    MnO: OXIDE_WEIGHTS.MnO,      // 70.937
    P2O5: OXIDE_WEIGHTS.P2O5,    // 141.943
    Cr2O3: OXIDE_WEIGHTS.Cr2O3,  // 151.990
};

// Iron oxide interconversion constant
const FE2O3_TO_FEO = 0.8998122;

// ============================================
// Helper Functions
// ============================================

function createOxideInput(oxide: string, description: string): InputDefinition {
    return {
        name: oxide,
        description,
        required: true,
        unit: 'wt%',
        aliases: [oxide, `${oxide}_pct`, `${oxide}_wt`, `${oxide}_%`],
        patterns: [new RegExp(`^${oxide.replace('2', '2?')}[_\\s]?(?:pct|wt|%)?$`, 'i')],
    };
}

function createElementInput(element: string, description: string, unit: 'ppm' | 'ppb' = 'ppm'): InputDefinition {
    return {
        name: element,
        description,
        required: true,
        unit: unit,
        aliases: [element, `${element}_${unit}`],
        patterns: [new RegExp(`^${element}[_\\s]?(?:${unit})?$`, 'i')],
    };
}

// ============================================
// Alteration Indices
// ============================================

/**
 * Ishikawa Alteration Index (AI)
 * AI = 100 × (K2O + MgO) / (K2O + MgO + Na2O + CaO)
 * Measures sericite-chlorite alteration intensity
 */
const alterationIndexAI: CalculationDefinition = {
    id: 'alteration-index-ai',
    name: 'Ishikawa Alteration Index (AI)',
    category: 'weathering-index',
    description: 'Measures sericite-chlorite alteration intensity. AI = 100 × (K2O + MgO) / (K2O + MgO + Na2O + CaO). Values >65 indicate strong alteration.',
    formula: null,
    formulaDisplay: 'AI = 100 × (K₂O + MgO) / (K₂O + MgO + Na₂O + CaO)',
    inputs: [
        createOxideInput('K2O', 'Potassium oxide (wt%)'),
        createOxideInput('MgO', 'Magnesium oxide (wt%)'),
        createOxideInput('Na2O', 'Sodium oxide (wt%)'),
        createOxideInput('CaO', 'Calcium oxide (wt%)'),
    ],
    outputUnit: 'index',
    calculateFn: (inputs) => {
        const { K2O, MgO, Na2O, CaO } = inputs;
        if (K2O === null || MgO === null || Na2O === null || CaO === null) return null;
        const numerator = K2O + MgO;
        const denominator = K2O + MgO + Na2O + CaO;
        if (denominator === 0) return null;
        return 100 * numerator / denominator;
    },
    validationRules: [
        { type: 'range', min: 0, max: 100, errorMessage: 'AI should be between 0 and 100', severity: 'warning' }
    ],
    references: ['Ishikawa et al. (1976)', 'Large et al. (2001)'],
};

/**
 * Chlorite-Carbonate-Pyrite Index (CCPI)
 * CCPI = 100 × (MgO + FeO*) / (MgO + FeO* + Na2O + K2O)
 * FeO* = FeO + 0.8998 × Fe2O3 (total iron as FeO)
 */
const alterationIndexCCPI: CalculationDefinition = {
    id: 'alteration-index-ccpi',
    name: 'Chlorite-Carbonate-Pyrite Index (CCPI)',
    category: 'weathering-index',
    description: 'Measures chlorite-carbonate-pyrite alteration. CCPI = 100 × (MgO + FeOT) / (MgO + FeOT + Na2O + K2O). FeOT = FeO + 0.8998×Fe2O3.',
    formula: null,
    formulaDisplay: 'CCPI = 100 × (MgO + FeO*) / (MgO + FeO* + Na₂O + K₂O)',
    inputs: [
        createOxideInput('MgO', 'Magnesium oxide (wt%)'),
        createOxideInput('FeO', 'Ferrous oxide (wt%)'),
        createOxideInput('Fe2O3', 'Ferric oxide (wt%)'),
        createOxideInput('Na2O', 'Sodium oxide (wt%)'),
        createOxideInput('K2O', 'Potassium oxide (wt%)'),
    ],
    outputUnit: 'index',
    calculateFn: (inputs) => {
        const { MgO, FeO, Fe2O3, Na2O, K2O } = inputs;
        if (MgO === null || Na2O === null || K2O === null) return null;
        const feo = FeO ?? 0;
        const fe2o3 = Fe2O3 ?? 0;
        const feoTotal = feo + fe2o3 * FE2O3_TO_FEO;
        const numerator = MgO + feoTotal;
        const denominator = MgO + feoTotal + Na2O + K2O;
        if (denominator === 0) return null;
        return 100 * numerator / denominator;
    },
    validationRules: [
        { type: 'range', min: 0, max: 100, errorMessage: 'CCPI should be between 0 and 100', severity: 'warning' }
    ],
    references: ['Large et al. (2001)'],
};

/**
 * Advanced Argillic Alteration Index (AAAI)
 * AAAI = 100 × SiO2 / (SiO2 + 10×K2O + 10×Na2O + 10×CaO)
 */
const alterationIndexAAAI: CalculationDefinition = {
    id: 'alteration-index-aaai',
    name: 'Advanced Argillic Alteration Index (AAAI)',
    category: 'weathering-index',
    description: 'Measures advanced argillic alteration (silicification). AAAI = 100 × SiO2 / (SiO2 + 10×K2O + 10×Na2O + 10×CaO).',
    formula: null,
    formulaDisplay: 'AAAI = 100 × SiO₂ / (SiO₂ + 10×K₂O + 10×Na₂O + 10×CaO)',
    inputs: [
        createOxideInput('SiO2', 'Silica (wt%)'),
        createOxideInput('K2O', 'Potassium oxide (wt%)'),
        createOxideInput('Na2O', 'Sodium oxide (wt%)'),
        createOxideInput('CaO', 'Calcium oxide (wt%)'),
    ],
    outputUnit: 'index',
    calculateFn: (inputs) => {
        const { SiO2, K2O, Na2O, CaO } = inputs;
        if (SiO2 === null || K2O === null || Na2O === null || CaO === null) return null;
        const denominator = SiO2 + 10 * K2O + 10 * Na2O + 10 * CaO;
        if (denominator === 0) return null;
        return 100 * SiO2 / denominator;
    },
    validationRules: [
        { type: 'range', min: 0, max: 100, errorMessage: 'AAAI should be between 0 and 100', severity: 'warning' }
    ],
    references: ['Williams & Davidson (2004)'],
};

// ============================================
// Molar Ratio Indices
// ============================================

/**
 * K/Al Molar Ratio
 */
const kAlMolarRatio: CalculationDefinition = {
    id: 'molar-ratio-k-al',
    name: 'K/Al Molar Ratio',
    category: 'exploration-ratio',
    description: 'Molar ratio of K2O to Al2O3. K/Al = (K2O/94.196) / (Al2O3/101.961). Used for feldspar alteration assessment.',
    formula: null,
    formulaDisplay: 'K/Al = (K₂O/MW_K₂O) / (Al₂O₃/MW_Al₂O₃)',
    inputs: [
        createOxideInput('K2O', 'Potassium oxide (wt%)'),
        createOxideInput('Al2O3', 'Alumina (wt%)'),
    ],
    outputUnit: 'ratio',
    calculateFn: (inputs) => {
        const { K2O, Al2O3 } = inputs;
        if (K2O === null || Al2O3 === null || Al2O3 === 0) return null;
        const kMolar = K2O / MW.K2O;
        const alMolar = Al2O3 / MW.Al2O3;
        return kMolar / alMolar;
    },
    validationRules: [],
    references: ['Davies & Whitehead (2006)'],
};

/**
 * Na/Al Molar Ratio
 */
const naAlMolarRatio: CalculationDefinition = {
    id: 'molar-ratio-na-al',
    name: 'Na/Al Molar Ratio',
    category: 'exploration-ratio',
    description: 'Molar ratio of Na2O to Al2O3. Na/Al = (Na2O/61.979) / (Al2O3/101.961). Used for feldspar alteration assessment.',
    formula: null,
    formulaDisplay: 'Na/Al = (Na₂O/MW_Na₂O) / (Al₂O₃/MW_Al₂O₃)',
    inputs: [
        createOxideInput('Na2O', 'Sodium oxide (wt%)'),
        createOxideInput('Al2O3', 'Alumina (wt%)'),
    ],
    outputUnit: 'ratio',
    calculateFn: (inputs) => {
        const { Na2O, Al2O3 } = inputs;
        if (Na2O === null || Al2O3 === null || Al2O3 === 0) return null;
        const naMolar = Na2O / MW.Na2O;
        const alMolar = Al2O3 / MW.Al2O3;
        return naMolar / alMolar;
    },
    validationRules: [],
    references: ['Davies & Whitehead (2006)'],
};

/**
 * (Na+K)/Al Molar Ratio
 */
const naKAlMolarRatio: CalculationDefinition = {
    id: 'molar-ratio-nak-al',
    name: '(Na+K)/Al Molar Ratio',
    category: 'exploration-ratio',
    description: 'Combined alkali to alumina molar ratio. (Na+K)/Al = ((Na2O/61.979) + (K2O/94.196)) / (Al2O3/101.961).',
    formula: null,
    formulaDisplay: '(Na+K)/Al = ((Na₂O/MW) + (K₂O/MW)) / (Al₂O₃/MW)',
    inputs: [
        createOxideInput('Na2O', 'Sodium oxide (wt%)'),
        createOxideInput('K2O', 'Potassium oxide (wt%)'),
        createOxideInput('Al2O3', 'Alumina (wt%)'),
    ],
    outputUnit: 'ratio',
    calculateFn: (inputs) => {
        const { Na2O, K2O, Al2O3 } = inputs;
        if (Na2O === null || K2O === null || Al2O3 === null || Al2O3 === 0) return null;
        const naMolar = Na2O / MW.Na2O;
        const kMolar = K2O / MW.K2O;
        const alMolar = Al2O3 / MW.Al2O3;
        return (naMolar + kMolar) / alMolar;
    },
    validationRules: [],
    references: ['GER Diagrams'],
};

/**
 * Si/Al Molar Ratio
 */
const siAlMolarRatio: CalculationDefinition = {
    id: 'molar-ratio-si-al',
    name: 'Si/Al Molar Ratio',
    category: 'exploration-ratio',
    description: 'Molar ratio of SiO2 to Al2O3. Used for sedimentary provenance and weathering studies.',
    formula: null,
    formulaDisplay: 'Si/Al = (SiO₂/MW_SiO₂) / (Al₂O₃/MW_Al₂O₃)',
    inputs: [
        createOxideInput('SiO2', 'Silica (wt%)'),
        createOxideInput('Al2O3', 'Alumina (wt%)'),
    ],
    outputUnit: 'ratio',
    calculateFn: (inputs) => {
        const { SiO2, Al2O3 } = inputs;
        if (SiO2 === null || Al2O3 === null || Al2O3 === 0) return null;
        const siMolar = SiO2 / MW.SiO2;
        const alMolar = Al2O3 / MW.Al2O3;
        return siMolar / alMolar;
    },
    validationRules: [],
    references: ['Olivine Control Diagram'],
};

/**
 * (Fe+Mg)/Al Molar Ratio
 */
const feMgAlMolarRatio: CalculationDefinition = {
    id: 'molar-ratio-femg-al',
    name: '(Fe+Mg)/Al Molar Ratio',
    category: 'exploration-ratio',
    description: 'Mafic to felsic component ratio. (Fe+Mg)/Al = ((FeOT/71.844) + (MgO/40.304)) / (Al2O3/101.961).',
    formula: null,
    formulaDisplay: '(Fe+Mg)/Al = ((FeOT/MW) + (MgO/MW)) / (Al₂O₃/MW)',
    inputs: [
        createOxideInput('FeO', 'Ferrous oxide (wt%) - or FeOT'),
        createOxideInput('Fe2O3', 'Ferric oxide (wt%) - optional'),
        createOxideInput('MgO', 'Magnesium oxide (wt%)'),
        createOxideInput('Al2O3', 'Alumina (wt%)'),
    ],
    outputUnit: 'ratio',
    calculateFn: (inputs) => {
        const { FeO, Fe2O3, MgO, Al2O3 } = inputs;
        if (MgO === null || Al2O3 === null || Al2O3 === 0) return null;
        const feo = FeO ?? 0;
        const fe2o3 = Fe2O3 ?? 0;
        const feoTotal = feo + fe2o3 * FE2O3_TO_FEO;
        const feMolar = feoTotal / MW.FeO;
        const mgMolar = MgO / MW.MgO;
        const alMolar = Al2O3 / MW.Al2O3;
        return (feMolar + mgMolar) / alMolar;
    },
    validationRules: [],
    references: ['Olivine Control Diagram', 'Chlorite-Muscovite GER Diagram'],
};

/**
 * (2Ca+Na+K)/Al Molar Ratio
 */
const caAlkAlMolarRatio: CalculationDefinition = {
    id: 'molar-ratio-2ca-nak-al',
    name: '(2Ca+Na+K)/Al Molar Ratio',
    category: 'exploration-ratio',
    description: 'Volcanic rock alteration index. Measures feldspar-like alkali content relative to Al.',
    formula: null,
    formulaDisplay: '(2Ca+Na+K)/Al = (2×(CaO/MW) + (Na₂O/MW) + (K₂O/MW)) / (Al₂O₃/MW)',
    inputs: [
        createOxideInput('CaO', 'Calcium oxide (wt%)'),
        createOxideInput('Na2O', 'Sodium oxide (wt%)'),
        createOxideInput('K2O', 'Potassium oxide (wt%)'),
        createOxideInput('Al2O3', 'Alumina (wt%)'),
    ],
    outputUnit: 'ratio',
    calculateFn: (inputs) => {
        const { CaO, Na2O, K2O, Al2O3 } = inputs;
        if (CaO === null || Na2O === null || K2O === null || Al2O3 === null || Al2O3 === 0) return null;
        const caMolar = CaO / MW.CaO;
        const naMolar = Na2O / MW.Na2O;
        const kMolar = K2O / MW.K2O;
        const alMolar = Al2O3 / MW.Al2O3;
        return (2 * caMolar + naMolar + kMolar) / alMolar;
    },
    validationRules: [],
    references: ['Volcanic Rock Alteration Diagrams'],
};

// ============================================
// Mineral Chemistry Indices
// ============================================

/**
 * Mg# (Magnesium Number) - Molar
 * Mg# = 100 × MgO_mol / (MgO_mol + FeOT_mol)
 */
const mgNumberMolar: CalculationDefinition = {
    id: 'mg-number-molar',
    name: 'Mg# (Magnesium Number)',
    category: 'petrochemical-index',
    description: 'Molar Mg/(Mg+Fe) ratio × 100. Indicates degree of magmatic differentiation. Mg# = 100 × (MgO/40.3) / ((MgO/40.3) + (FeOT/71.85)).',
    formula: null,
    formulaDisplay: 'Mg# = 100 × (MgO/MW) / ((MgO/MW) + (FeOT/MW))',
    inputs: [
        createOxideInput('MgO', 'Magnesium oxide (wt%)'),
        createOxideInput('FeO', 'Ferrous oxide (wt%)'),
        createOxideInput('Fe2O3', 'Ferric oxide (wt%) - optional'),
    ],
    outputUnit: 'index',
    calculateFn: (inputs) => {
        const { MgO, FeO, Fe2O3 } = inputs;
        if (MgO === null) return null;
        const feo = FeO ?? 0;
        const fe2o3 = Fe2O3 ?? 0;
        const feoTotal = feo + fe2o3 * FE2O3_TO_FEO;
        const mgMolar = MgO / MW.MgO;
        const feMolar = feoTotal / MW.FeO;
        const denominator = mgMolar + feMolar;
        if (denominator === 0) return null;
        return 100 * mgMolar / denominator;
    },
    validationRules: [
        { type: 'range', min: 0, max: 100, errorMessage: 'Mg# should be between 0 and 100', severity: 'warning' }
    ],
    references: ['Common petrological index'],
};

/**
 * Ca/(Ca+Mg) Molar Ratio
 */
const caCaMgMolarRatio: CalculationDefinition = {
    id: 'molar-ratio-ca-camg',
    name: 'Ca/(Ca+Mg) Molar Ratio',
    category: 'petrochemical-index',
    description: 'Molar Ca/(Ca+Mg) ratio for pyroxene and amphibole classification.',
    formula: null,
    formulaDisplay: 'Ca/(Ca+Mg) = (CaO/MW) / ((CaO/MW) + (MgO/MW))',
    inputs: [
        createOxideInput('CaO', 'Calcium oxide (wt%)'),
        createOxideInput('MgO', 'Magnesium oxide (wt%)'),
    ],
    outputUnit: 'ratio',
    calculateFn: (inputs) => {
        const { CaO, MgO } = inputs;
        if (CaO === null || MgO === null) return null;
        const caMolar = CaO / MW.CaO;
        const mgMolar = MgO / MW.MgO;
        const denominator = caMolar + mgMolar;
        if (denominator === 0) return null;
        return caMolar / denominator;
    },
    validationRules: [
        { type: 'range', min: 0, max: 1, errorMessage: 'Ratio should be between 0 and 1', severity: 'warning' }
    ],
    references: ['Mineral chemistry diagrams'],
};

// ============================================
// REE Normalization Ratios
// ============================================

// Chondrite values (McDonough & Sun 1995)
const CHONDRITE = {
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
};

/**
 * (La/Sm)n - Chondrite Normalized
 */
const laSmNormalized: CalculationDefinition = {
    id: 'ree-ratio-la-sm-n',
    name: '(La/Sm)ₙ Chondrite Normalized',
    category: 'ree-normalization',
    description: 'Light REE fractionation index. (La/Sm)n = (La/0.237) / (Sm/0.148). Higher values indicate LREE enrichment.',
    formula: null,
    formulaDisplay: '(La/Sm)ₙ = (La/La_chond) / (Sm/Sm_chond)',
    inputs: [
        createElementInput('La', 'Lanthanum (ppm)'),
        createElementInput('Sm', 'Samarium (ppm)'),
    ],
    outputUnit: 'ratio',
    calculateFn: (inputs) => {
        const { La, Sm } = inputs;
        if (La === null || Sm === null || Sm === 0) return null;
        const laN = La / CHONDRITE.La;
        const smN = Sm / CHONDRITE.Sm;
        return laN / smN;
    },
    validationRules: [],
    references: ['McDonough & Sun (1995)', 'Porphyry Cu Prospectivity diagrams'],
};

/**
 * (Dy/Yb)n - Chondrite Normalized
 */
const dyYbNormalized: CalculationDefinition = {
    id: 'ree-ratio-dy-yb-n',
    name: '(Dy/Yb)ₙ Chondrite Normalized',
    category: 'ree-normalization',
    description: 'Heavy REE fractionation index. (Dy/Yb)n = (Dy/0.246) / (Yb/0.161). Indicates HREE fractionation.',
    formula: null,
    formulaDisplay: '(Dy/Yb)ₙ = (Dy/Dy_chond) / (Yb/Yb_chond)',
    inputs: [
        createElementInput('Dy', 'Dysprosium (ppm)'),
        createElementInput('Yb', 'Ytterbium (ppm)'),
    ],
    outputUnit: 'ratio',
    calculateFn: (inputs) => {
        const { Dy, Yb } = inputs;
        if (Dy === null || Yb === null || Yb === 0) return null;
        const dyN = Dy / CHONDRITE.Dy;
        const ybN = Yb / CHONDRITE.Yb;
        return dyN / ybN;
    },
    validationRules: [],
    references: ['McDonough & Sun (1995)', 'Porphyry Cu Prospectivity diagrams'],
};

/**
 * Eu/Eu* (Europium Anomaly)
 * Eu/Eu* = Eu_n / sqrt(Sm_n × Gd_n)
 */
const euAnomaly: CalculationDefinition = {
    id: 'ree-eu-anomaly',
    name: 'Eu/Eu* (Europium Anomaly)',
    category: 'ree-normalization',
    description: 'Europium anomaly relative to neighboring REE. Eu/Eu* = Eu_n / √(Sm_n × Gd_n). <1 = negative anomaly (plagioclase fractionation), >1 = positive anomaly.',
    formula: null,
    formulaDisplay: 'Eu/Eu* = (Eu/Eu_chond) / √((Sm/Sm_chond) × (Gd/Gd_chond))',
    inputs: [
        createElementInput('Eu', 'Europium (ppm)'),
        createElementInput('Sm', 'Samarium (ppm)'),
        createElementInput('Gd', 'Gadolinium (ppm)'),
    ],
    outputUnit: 'ratio',
    calculateFn: (inputs) => {
        const { Eu, Sm, Gd } = inputs;
        if (Eu === null || Sm === null || Gd === null) return null;
        const euN = Eu / CHONDRITE.Eu;
        const smN = Sm / CHONDRITE.Sm;
        const gdN = Gd / CHONDRITE.Gd;
        const euStar = Math.sqrt(smN * gdN);
        if (euStar === 0) return null;
        return euN / euStar;
    },
    validationRules: [],
    references: ['McDonough & Sun (1995)', 'Porphyry Cu Prospectivity diagrams'],
};

// ============================================
// Exploration Ratios
// ============================================

/**
 * Sr/Y Ratio
 */
const srYRatio: CalculationDefinition = {
    id: 'exploration-ratio-sr-y',
    name: 'Sr/Y Ratio',
    category: 'exploration-ratio',
    description: 'Adakite discrimination and porphyry Cu prospectivity. Sr/Y > 20-40 may indicate adakitic signature favorable for porphyry Cu.',
    formula: {
        type: 'operation',
        operator: '/',
        operands: [
            { type: 'variable', value: 'Sr' },
            { type: 'variable', value: 'Y' }
        ]
    },
    formulaDisplay: 'Sr/Y = Sr / Y',
    inputs: [
        createElementInput('Sr', 'Strontium (ppm)'),
        createElementInput('Y', 'Yttrium (ppm)'),
    ],
    outputUnit: 'ratio',
    validationRules: [],
    references: ['Porphyry Cu Prospectivity diagrams', 'Defant & Drummond (1990)'],
};

/**
 * La/Yb Ratio
 */
const laYbRatio: CalculationDefinition = {
    id: 'exploration-ratio-la-yb',
    name: 'La/Yb Ratio',
    category: 'exploration-ratio',
    description: 'Overall REE fractionation and crustal thickness indicator. Higher values indicate LREE enrichment relative to HREE.',
    formula: {
        type: 'operation',
        operator: '/',
        operands: [
            { type: 'variable', value: 'La' },
            { type: 'variable', value: 'Yb' }
        ]
    },
    formulaDisplay: 'La/Yb = La / Yb',
    inputs: [
        createElementInput('La', 'Lanthanum (ppm)'),
        createElementInput('Yb', 'Ytterbium (ppm)'),
    ],
    outputUnit: 'ratio',
    validationRules: [],
    references: ['Porphyry Cu Prospectivity diagrams'],
};

/**
 * Metal Sum M (gossan evaluation)
 * M = (Ni + Cu + Zn + Pb + Cr) / 10000
 */
const metalSumM: CalculationDefinition = {
    id: 'exploration-metal-sum-m',
    name: 'Metal Sum M (Gossan)',
    category: 'exploration-ratio',
    description: 'Total base metal content for gossan evaluation. M (%) = (Ni + Cu + Zn + Pb + Cr ppm) / 10000.',
    formula: null,
    formulaDisplay: 'M (%) = (Ni + Cu + Zn + Pb + Cr) / 10,000',
    inputs: [
        createElementInput('Ni', 'Nickel (ppm)'),
        createElementInput('Cu', 'Copper (ppm)'),
        createElementInput('Zn', 'Zinc (ppm)'),
        createElementInput('Pb', 'Lead (ppm)'),
        createElementInput('Cr', 'Chromium (ppm)'),
    ],
    outputUnit: 'wt%',
    calculateFn: (inputs) => {
        const { Ni, Cu, Zn, Pb, Cr } = inputs;
        const ni = Ni ?? 0;
        const cu = Cu ?? 0;
        const zn = Zn ?? 0;
        const pb = Pb ?? 0;
        const cr = Cr ?? 0;
        return (ni + cu + zn + pb + cr) / 10000;
    },
    validationRules: [],
    references: ['Yilgarn gossan diagrams', 'CRC LEME'],
};

/**
 * (Cu+Ni)/M Ratio (gossan evaluation)
 */
const cuNiOverM: CalculationDefinition = {
    id: 'exploration-cuni-m',
    name: '(Cu+Ni)/M Ratio (Gossan)',
    category: 'exploration-ratio',
    description: 'Cu-Ni enrichment indicator for gossan evaluation. (Cu+Ni)/M = 100 × (Cu + Ni) / (Ni + Cu + Zn + Pb + Cr).',
    formula: null,
    formulaDisplay: '(Cu+Ni)/M (%) = 100 × (Cu + Ni) / (Ni + Cu + Zn + Pb + Cr)',
    inputs: [
        createElementInput('Cu', 'Copper (ppm)'),
        createElementInput('Ni', 'Nickel (ppm)'),
        createElementInput('Zn', 'Zinc (ppm)'),
        createElementInput('Pb', 'Lead (ppm)'),
        createElementInput('Cr', 'Chromium (ppm)'),
    ],
    outputUnit: 'index',
    calculateFn: (inputs) => {
        const { Cu, Ni, Zn, Pb, Cr } = inputs;
        const cu = Cu ?? 0;
        const ni = Ni ?? 0;
        const zn = Zn ?? 0;
        const pb = Pb ?? 0;
        const cr = Cr ?? 0;
        const denominator = ni + cu + zn + pb + cr;
        if (denominator === 0) return null;
        return 100 * (cu + ni) / denominator;
    },
    validationRules: [
        { type: 'range', min: 0, max: 100, errorMessage: 'Ratio should be between 0 and 100', severity: 'warning' }
    ],
    references: ['Yilgarn gossan diagrams'],
};

// ============================================
// ACF Diagram Components
// ============================================

/**
 * A Component for ACF Diagram
 * A = Al2O3 - K2O - Na2O (molar)
 */
const acfAComponent: CalculationDefinition = {
    id: 'acf-a-component',
    name: 'ACF A Component (Al2O3 - K2O - Na2O)',
    category: 'petrochemical-index',
    description: 'A component for ACF metamorphic facies diagram. A = (Al2O3/101.96) - (K2O/94.2) - (Na2O/61.98) in molar proportions.',
    formula: null,
    formulaDisplay: 'A = (Al₂O₃/MW) - (K₂O/MW) - (Na₂O/MW)',
    inputs: [
        createOxideInput('Al2O3', 'Alumina (wt%)'),
        createOxideInput('K2O', 'Potassium oxide (wt%)'),
        createOxideInput('Na2O', 'Sodium oxide (wt%)'),
    ],
    outputUnit: 'molar',
    calculateFn: (inputs) => {
        const { Al2O3, K2O, Na2O } = inputs;
        if (Al2O3 === null || K2O === null || Na2O === null) return null;
        return (Al2O3 / 101.96) - (K2O / 94.2) - (Na2O / 61.98);
    },
    validationRules: [],
    references: ['ACF Metamorphic Facies Diagrams'],
};

/**
 * C Component for ACF Diagram
 * C = CaO (molar)
 */
const acfCComponent: CalculationDefinition = {
    id: 'acf-c-component',
    name: 'ACF C Component (CaO)',
    category: 'petrochemical-index',
    description: 'C component for ACF metamorphic facies diagram. C = CaO/56.08 in molar proportions.',
    formula: null,
    formulaDisplay: 'C = CaO / MW_CaO',
    inputs: [
        createOxideInput('CaO', 'Calcium oxide (wt%)'),
    ],
    outputUnit: 'molar',
    calculateFn: (inputs) => {
        const { CaO } = inputs;
        if (CaO === null) return null;
        return CaO / 56.08;
    },
    validationRules: [],
    references: ['ACF Metamorphic Facies Diagrams'],
};

/**
 * F Component for ACF Diagram
 * F = FeO + MgO - TiO2 (molar)
 */
const acfFComponent: CalculationDefinition = {
    id: 'acf-f-component',
    name: 'ACF F Component (FeO + MgO - TiO2)',
    category: 'petrochemical-index',
    description: 'F component for ACF metamorphic facies diagram. F = (FeOT/71.85) + (MgO/40.32) - (TiO2/79.9) in molar proportions.',
    formula: null,
    formulaDisplay: 'F = (FeOT/MW) + (MgO/MW) - (TiO₂/MW)',
    inputs: [
        createOxideInput('FeO', 'Ferrous oxide (wt%)'),
        createOxideInput('Fe2O3', 'Ferric oxide (wt%) - optional'),
        createOxideInput('MgO', 'Magnesium oxide (wt%)'),
        createOxideInput('TiO2', 'Titanium dioxide (wt%)'),
    ],
    outputUnit: 'molar',
    calculateFn: (inputs) => {
        const { FeO, Fe2O3, MgO, TiO2 } = inputs;
        if (MgO === null || TiO2 === null) return null;
        const feo = FeO ?? 0;
        const fe2o3 = Fe2O3 ?? 0;
        const feoTotal = feo + fe2o3 * FE2O3_TO_FEO;
        return (feoTotal / 71.85) + (MgO / 40.32) - (TiO2 / 79.9);
    },
    validationRules: [],
    references: ['ACF Metamorphic Facies Diagrams'],
};

// ============================================
// AFM Diagram Components
// ============================================

/**
 * FeO Total for AFM Diagram
 * FeO* = FeO + 0.8998 × Fe2O3
 */
const feoTotal: CalculationDefinition = {
    id: 'feo-total',
    name: 'FeO Total (FeO*)',
    category: 'element-oxide',
    description: 'Total iron as FeO. FeO* = FeO + (0.8998 × Fe2O3). Used for AFM and other mafic classification diagrams.',
    formula: null,
    formulaDisplay: 'FeO* = FeO + (0.8998 × Fe₂O₃)',
    inputs: [
        createOxideInput('FeO', 'Ferrous oxide (wt%)'),
        createOxideInput('Fe2O3', 'Ferric oxide (wt%)'),
    ],
    outputUnit: 'wt%',
    calculateFn: (inputs) => {
        const { FeO, Fe2O3 } = inputs;
        const feo = FeO ?? 0;
        const fe2o3 = Fe2O3 ?? 0;
        return feo + fe2o3 * FE2O3_TO_FEO;
    },
    validationRules: [],
    references: ['AFM Diagram', 'Standard iron conversion'],
};

/**
 * Na2O + K2O (Total Alkalis)
 */
const totalAlkalis: CalculationDefinition = {
    id: 'total-alkalis',
    name: 'Total Alkalis (Na2O + K2O)',
    category: 'element-oxide',
    description: 'Sum of Na2O and K2O for TAS diagram and alkali classification.',
    formula: {
        type: 'operation',
        operator: '+',
        operands: [
            { type: 'variable', value: 'Na2O' },
            { type: 'variable', value: 'K2O' }
        ]
    },
    formulaDisplay: 'Total Alkalis = Na₂O + K₂O',
    inputs: [
        createOxideInput('Na2O', 'Sodium oxide (wt%)'),
        createOxideInput('K2O', 'Potassium oxide (wt%)'),
    ],
    outputUnit: 'wt%',
    validationRules: [],
    references: ['TAS Diagram', 'Le Bas et al. (1986)'],
};

// ============================================
// Generate All Definitions
// ============================================

/**
 * Generate all diagram-derived calculation definitions
 */
export function generateDiagramFormulaDefinitions(): CalculationDefinition[] {
    return [
        // Alteration Indices
        alterationIndexAI,
        alterationIndexCCPI,
        alterationIndexAAAI,

        // Molar Ratios
        kAlMolarRatio,
        naAlMolarRatio,
        naKAlMolarRatio,
        siAlMolarRatio,
        feMgAlMolarRatio,
        caAlkAlMolarRatio,

        // Mineral Chemistry
        mgNumberMolar,
        caCaMgMolarRatio,

        // REE Ratios
        laSmNormalized,
        dyYbNormalized,
        euAnomaly,

        // Exploration Ratios
        srYRatio,
        laYbRatio,
        metalSumM,
        cuNiOverM,

        // ACF Components
        acfAComponent,
        acfCComponent,
        acfFComponent,

        // AFM Components
        feoTotal,
        totalAlkalis,
    ];
}
