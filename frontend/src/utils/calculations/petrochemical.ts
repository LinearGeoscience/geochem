// Petrochemical Index Calculations

import { CalculationDefinition, IndexResult } from '../../types/calculations';
import { OXIDE_WEIGHTS, COLUMN_PATTERNS } from './constants';
import { wtPercentToMolar } from './formulaEvaluator';
import { VALIDATION_RULES } from './validation';

// Molecular weights for common oxides
const MW = {
    Al2O3: OXIDE_WEIGHTS.Al2O3,
    CaO: OXIDE_WEIGHTS.CaO,
    Na2O: OXIDE_WEIGHTS.Na2O,
    K2O: OXIDE_WEIGHTS.K2O,
    MgO: OXIDE_WEIGHTS.MgO,
    FeO: OXIDE_WEIGHTS.FeO,
    Fe2O3: OXIDE_WEIGHTS.Fe2O3,
    P2O5: OXIDE_WEIGHTS.P2O5,
    SiO2: OXIDE_WEIGHTS.SiO2,
    TiO2: OXIDE_WEIGHTS.TiO2,
    MnO: OXIDE_WEIGHTS.MnO,
};

/**
 * Calculate Mg# (Magnesium Number)
 * Mg# = 100 × MgO_mol / (MgO_mol + FeO_mol)
 *
 * Common in igneous petrology to track fractional crystallization
 */
export function calculateMgNumber(
    mgoWt: number | null,
    feoWt: number | null
): IndexResult {
    if (mgoWt === null || feoWt === null) {
        return { value: null };
    }

    // Convert wt% to molar
    const mgoMol = wtPercentToMolar(mgoWt, MW.MgO);
    const feoMol = wtPercentToMolar(feoWt, MW.FeO);

    if (mgoMol === null || feoMol === null) {
        return { value: null };
    }

    const denominator = mgoMol + feoMol;
    if (denominator === 0) {
        return { value: null };
    }

    const mgNumber = 100 * (mgoMol / denominator);

    // Classification
    let classification: string | undefined;
    if (mgNumber >= 70) classification = 'Primitive (≥70)';
    else if (mgNumber >= 50) classification = 'Intermediate (50-70)';
    else classification = 'Evolved (<50)';

    return {
        value: mgNumber,
        classification,
        description: 'Indicator of magmatic evolution and fractional crystallization',
    };
}

/**
 * Calculate A/CNK (Alumina Saturation Index)
 * A/CNK = Al2O3_mol / (CaO*_mol + Na2O_mol + K2O_mol)
 *
 * Key index for granite classification
 */
export function calculateACNK(
    al2o3Wt: number | null,
    caoWt: number | null,
    na2oWt: number | null,
    k2oWt: number | null
): IndexResult {
    if (al2o3Wt === null) {
        return { value: null };
    }

    // Convert wt% to molar
    const al2o3Mol = wtPercentToMolar(al2o3Wt, MW.Al2O3);
    const caoMol = wtPercentToMolar(caoWt ?? 0, MW.CaO);
    const na2oMol = wtPercentToMolar(na2oWt ?? 0, MW.Na2O);
    const k2oMol = wtPercentToMolar(k2oWt ?? 0, MW.K2O);

    if (al2o3Mol === null) {
        return { value: null };
    }

    const denominator = (caoMol ?? 0) + (na2oMol ?? 0) + (k2oMol ?? 0);
    if (denominator === 0) {
        return { value: null };
    }

    const acnk = al2o3Mol / denominator;

    // Classification
    let classification: string | undefined;
    if (acnk > 1.0) classification = 'Peraluminous (>1.0)';
    else if (acnk >= 0.9) classification = 'Metaluminous (0.9-1.0)';
    else classification = 'Peralkaline (<0.9)';

    return {
        value: acnk,
        classification,
        description: 'Alumina saturation - key for granitoid classification',
    };
}

/**
 * Calculate A/NK
 * A/NK = Al2O3_mol / (Na2O_mol + K2O_mol)
 */
export function calculateANK(
    al2o3Wt: number | null,
    na2oWt: number | null,
    k2oWt: number | null
): IndexResult {
    if (al2o3Wt === null) {
        return { value: null };
    }

    const al2o3Mol = wtPercentToMolar(al2o3Wt, MW.Al2O3);
    const na2oMol = wtPercentToMolar(na2oWt ?? 0, MW.Na2O);
    const k2oMol = wtPercentToMolar(k2oWt ?? 0, MW.K2O);

    if (al2o3Mol === null) {
        return { value: null };
    }

    const denominator = (na2oMol ?? 0) + (k2oMol ?? 0);
    if (denominator === 0) {
        return { value: null };
    }

    const ank = al2o3Mol / denominator;

    // Classification (used with A/CNK)
    let classification: string | undefined;
    if (ank < 1.0) classification = 'Peralkaline';
    else classification = 'Subalkaline';

    return {
        value: ank,
        classification,
        description: 'Used with A/CNK to distinguish peralkaline rocks',
    };
}

/**
 * Calculate Fe* (Iron Number / Fe-index)
 * Fe* = FeOT / (FeOT + MgO)
 *
 * Used in tholeiitic vs calc-alkaline discrimination
 */
export function calculateFeNumber(
    feoTWt: number | null,
    mgoWt: number | null
): IndexResult {
    if (feoTWt === null || mgoWt === null) {
        return { value: null };
    }

    const denominator = feoTWt + mgoWt;
    if (denominator === 0) {
        return { value: null };
    }

    const feNumber = feoTWt / denominator;

    // Classification based on Miyashiro (1974) boundary
    let classification: string | undefined;
    if (feNumber >= 0.65) classification = 'Tholeiitic (≥0.65)';
    else classification = 'Calc-alkaline (<0.65)';

    return {
        value: feNumber,
        classification,
        description: 'Discriminates tholeiitic from calc-alkaline magma series',
    };
}

/**
 * Calculate CIA (Chemical Index of Alteration)
 * CIA = [Al2O3 / (Al2O3 + CaO* + Na2O + K2O)] × 100 (molar)
 *
 * Reference: Nesbitt & Young (1982)
 */
export function calculateCIA(
    al2o3Wt: number | null,
    caoWt: number | null,
    na2oWt: number | null,
    k2oWt: number | null,
    p2o5Wt: number | null = null
): IndexResult {
    if (al2o3Wt === null) {
        return { value: null };
    }

    // Convert wt% to molar
    const al2o3Mol = wtPercentToMolar(al2o3Wt, MW.Al2O3);
    const caoMol = wtPercentToMolar(caoWt ?? 0, MW.CaO);
    const na2oMol = wtPercentToMolar(na2oWt ?? 0, MW.Na2O);
    const k2oMol = wtPercentToMolar(k2oWt ?? 0, MW.K2O);

    if (al2o3Mol === null) {
        return { value: null };
    }

    // Calculate CaO* (silicate CaO, correcting for apatite)
    // McLennan (1993) method: CaO* = CaO - (P2O5 × 10/3 × MWCaO/MWP2O5)
    let caoStarMol = caoMol ?? 0;
    if (p2o5Wt !== null) {
        const p2o5Mol = wtPercentToMolar(p2o5Wt, MW.P2O5);
        if (p2o5Mol !== null) {
            // Remove apatite contribution (3.33 × P2O5 molar)
            caoStarMol = Math.max(0, (caoMol ?? 0) - (p2o5Mol * 3.33));
        }
    }

    // If CaO* > Na2O, use Na2O as CaO* (conservative approach)
    if (caoStarMol > (na2oMol ?? 0)) {
        caoStarMol = na2oMol ?? 0;
    }

    const denominator = al2o3Mol + caoStarMol + (na2oMol ?? 0) + (k2oMol ?? 0);
    if (denominator === 0) {
        return { value: null };
    }

    const cia = 100 * (al2o3Mol / denominator);

    // Classification
    let classification: string | undefined;
    if (cia >= 85) classification = 'Extreme weathering (≥85)';
    else if (cia >= 65) classification = 'Moderate weathering (65-85)';
    else if (cia >= 50) classification = 'Low weathering (50-65)';
    else classification = 'Fresh rock (<50)';

    return {
        value: cia,
        classification,
        description: 'Chemical Index of Alteration - weathering intensity indicator',
    };
}

/**
 * Calculate CIW (Chemical Index of Weathering)
 * CIW = [Al2O3 / (Al2O3 + CaO* + Na2O)] × 100 (molar)
 *
 * Similar to CIA but excludes K2O
 */
export function calculateCIW(
    al2o3Wt: number | null,
    caoWt: number | null,
    na2oWt: number | null
): IndexResult {
    if (al2o3Wt === null) {
        return { value: null };
    }

    const al2o3Mol = wtPercentToMolar(al2o3Wt, MW.Al2O3);
    const caoMol = wtPercentToMolar(caoWt ?? 0, MW.CaO);
    const na2oMol = wtPercentToMolar(na2oWt ?? 0, MW.Na2O);

    if (al2o3Mol === null) {
        return { value: null };
    }

    // Use min(CaO, Na2O) for CaO*
    const caoStarMol = Math.min(caoMol ?? 0, na2oMol ?? 0);

    const denominator = al2o3Mol + caoStarMol + (na2oMol ?? 0);
    if (denominator === 0) {
        return { value: null };
    }

    const ciw = 100 * (al2o3Mol / denominator);

    return {
        value: ciw,
        classification: getCIAClassification(ciw),
        description: 'Chemical Index of Weathering - excludes K for K-metasomatized rocks',
    };
}

/**
 * Calculate PIA (Plagioclase Index of Alteration)
 * PIA = [(Al2O3 - K2O) / ((Al2O3 - K2O) + CaO* + Na2O)] × 100 (molar)
 */
export function calculatePIA(
    al2o3Wt: number | null,
    caoWt: number | null,
    na2oWt: number | null,
    k2oWt: number | null
): IndexResult {
    if (al2o3Wt === null || k2oWt === null) {
        return { value: null };
    }

    const al2o3Mol = wtPercentToMolar(al2o3Wt, MW.Al2O3);
    const caoMol = wtPercentToMolar(caoWt ?? 0, MW.CaO);
    const na2oMol = wtPercentToMolar(na2oWt ?? 0, MW.Na2O);
    const k2oMol = wtPercentToMolar(k2oWt, MW.K2O);

    if (al2o3Mol === null || k2oMol === null) {
        return { value: null };
    }

    const al2o3MinusK2o = al2o3Mol - k2oMol;
    if (al2o3MinusK2o < 0) {
        return { value: null };
    }

    // Use min(CaO, Na2O) for CaO*
    const caoStarMol = Math.min(caoMol ?? 0, na2oMol ?? 0);

    const denominator = al2o3MinusK2o + caoStarMol + (na2oMol ?? 0);
    if (denominator === 0) {
        return { value: null };
    }

    const pia = 100 * (al2o3MinusK2o / denominator);

    return {
        value: pia,
        classification: getCIAClassification(pia),
        description: 'Plagioclase Index of Alteration - focuses on plagioclase weathering',
    };
}

/**
 * Calculate Total Alkalis for TAS diagram
 * Total Alkalis = Na2O + K2O (wt%)
 */
export function calculateTotalAlkalis(
    na2oWt: number | null,
    k2oWt: number | null
): number | null {
    if (na2oWt === null && k2oWt === null) {
        return null;
    }
    return (na2oWt ?? 0) + (k2oWt ?? 0);
}

/**
 * Calculate ASI (Aluminum Saturation Index)
 * ASI = Al / (Ca - 1.67P + Na + K) (molar)
 */
export function calculateASI(
    al2o3Wt: number | null,
    caoWt: number | null,
    na2oWt: number | null,
    k2oWt: number | null,
    p2o5Wt: number | null = null
): IndexResult {
    if (al2o3Wt === null) {
        return { value: null };
    }

    // Convert to molar cations (not oxides)
    // Al in Al2O3: 2 atoms per mole
    const alMol = (wtPercentToMolar(al2o3Wt, MW.Al2O3) ?? 0) * 2;
    // Ca in CaO: 1 atom per mole
    const caMol = wtPercentToMolar(caoWt ?? 0, MW.CaO) ?? 0;
    // Na in Na2O: 2 atoms per mole
    const naMol = (wtPercentToMolar(na2oWt ?? 0, MW.Na2O) ?? 0) * 2;
    // K in K2O: 2 atoms per mole
    const kMol = (wtPercentToMolar(k2oWt ?? 0, MW.K2O) ?? 0) * 2;
    // P in P2O5: 2 atoms per mole
    const pMol = (wtPercentToMolar(p2o5Wt ?? 0, MW.P2O5) ?? 0) * 2;

    const correctedCa = caMol - (1.67 * pMol);
    const denominator = correctedCa + naMol + kMol;

    if (denominator <= 0) {
        return { value: null };
    }

    const asi = alMol / denominator;

    let classification: string | undefined;
    if (asi > 1.1) classification = 'Strongly Peraluminous (>1.1)';
    else if (asi > 1.0) classification = 'Peraluminous (1.0-1.1)';
    else classification = 'Metaluminous (≤1.0)';

    return {
        value: asi,
        classification,
        description: 'Aluminum Saturation Index - granitoid classification',
    };
}

// Helper for CIA-type classifications
function getCIAClassification(value: number): string {
    if (value >= 85) return 'Extreme weathering (≥85)';
    if (value >= 65) return 'Moderate weathering (65-85)';
    if (value >= 50) return 'Low weathering (50-65)';
    return 'Fresh rock (<50)';
}

/**
 * Generate calculation definitions for petrochemical indices
 */
export function generatePetrochemicalDefinitions(): CalculationDefinition[] {
    const definitions: CalculationDefinition[] = [];

    // Mg#
    definitions.push({
        id: 'mg_number',
        name: 'Mg# (Magnesium Number)',
        category: 'petrochemical-index',
        description: 'Mg# = 100 × MgO_mol / (MgO_mol + FeO_mol)',
        formula: null,
        formulaDisplay: 'Mg# = 100 × MgO_mol / (MgO_mol + FeO_mol)',
        inputs: [
            {
                name: 'MgO',
                description: 'MgO concentration (wt%)',
                required: true,
                unit: 'wt%',
                aliases: COLUMN_PATTERNS.MgO?.aliases || ['MgO'],
                patterns: COLUMN_PATTERNS.MgO?.patterns || [/^mgo/i],
            },
            {
                name: 'FeO',
                description: 'FeO or FeOT concentration (wt%)',
                required: true,
                unit: 'wt%',
                aliases: COLUMN_PATTERNS.FeO?.aliases || ['FeO', 'FeOT'],
                patterns: COLUMN_PATTERNS.FeO?.patterns || [/^feo/i],
            },
        ],
        outputUnit: 'index',
        validationRules: [VALIDATION_RULES.mgNumberRange],
        calculateFn: (inputs) => calculateMgNumber(inputs.MgO, inputs.FeO).value,
        references: ['Used in igneous petrology to track fractional crystallization'],
    });

    // A/CNK
    definitions.push({
        id: 'acnk',
        name: 'A/CNK (Alumina Saturation)',
        category: 'petrochemical-index',
        description: 'A/CNK = Al2O3_mol / (CaO_mol + Na2O_mol + K2O_mol)',
        formula: null,
        formulaDisplay: 'A/CNK = Al₂O₃ / (CaO + Na₂O + K₂O) [molar]',
        inputs: [
            {
                name: 'Al2O3',
                description: 'Al₂O₃ concentration (wt%)',
                required: true,
                unit: 'wt%',
                aliases: COLUMN_PATTERNS.Al2O3?.aliases || ['Al2O3'],
                patterns: COLUMN_PATTERNS.Al2O3?.patterns || [/^al2o3/i],
            },
            {
                name: 'CaO',
                description: 'CaO concentration (wt%)',
                required: false,
                unit: 'wt%',
                aliases: COLUMN_PATTERNS.CaO?.aliases || ['CaO'],
                patterns: COLUMN_PATTERNS.CaO?.patterns || [/^cao/i],
            },
            {
                name: 'Na2O',
                description: 'Na₂O concentration (wt%)',
                required: false,
                unit: 'wt%',
                aliases: COLUMN_PATTERNS.Na2O?.aliases || ['Na2O'],
                patterns: COLUMN_PATTERNS.Na2O?.patterns || [/^na2o/i],
            },
            {
                name: 'K2O',
                description: 'K₂O concentration (wt%)',
                required: false,
                unit: 'wt%',
                aliases: COLUMN_PATTERNS.K2O?.aliases || ['K2O'],
                patterns: COLUMN_PATTERNS.K2O?.patterns || [/^k2o/i],
            },
        ],
        outputUnit: 'ratio',
        validationRules: [VALIDATION_RULES.positiveValue],
        calculateFn: (inputs) => calculateACNK(inputs.Al2O3, inputs.CaO, inputs.Na2O, inputs.K2O).value,
        references: ['Shand (1943)', 'Key index for granite classification'],
    });

    // A/NK
    definitions.push({
        id: 'ank',
        name: 'A/NK',
        category: 'petrochemical-index',
        description: 'A/NK = Al2O3_mol / (Na2O_mol + K2O_mol)',
        formula: null,
        formulaDisplay: 'A/NK = Al₂O₃ / (Na₂O + K₂O) [molar]',
        inputs: [
            {
                name: 'Al2O3',
                description: 'Al₂O₃ concentration (wt%)',
                required: true,
                unit: 'wt%',
                aliases: COLUMN_PATTERNS.Al2O3?.aliases || ['Al2O3'],
                patterns: [/^al2o3/i],
            },
            {
                name: 'Na2O',
                description: 'Na₂O concentration (wt%)',
                required: false,
                unit: 'wt%',
                aliases: COLUMN_PATTERNS.Na2O?.aliases || ['Na2O'],
                patterns: [/^na2o/i],
            },
            {
                name: 'K2O',
                description: 'K₂O concentration (wt%)',
                required: false,
                unit: 'wt%',
                aliases: COLUMN_PATTERNS.K2O?.aliases || ['K2O'],
                patterns: [/^k2o/i],
            },
        ],
        outputUnit: 'ratio',
        validationRules: [VALIDATION_RULES.positiveValue],
        calculateFn: (inputs) => calculateANK(inputs.Al2O3, inputs.Na2O, inputs.K2O).value,
        references: ['Used with A/CNK to distinguish peralkaline rocks'],
    });

    // Fe*
    definitions.push({
        id: 'fe_number',
        name: 'Fe* (Iron Number)',
        category: 'petrochemical-index',
        description: 'Fe* = FeOT / (FeOT + MgO)',
        formula: null,
        formulaDisplay: 'Fe* = FeOT / (FeOT + MgO)',
        inputs: [
            {
                name: 'FeOT',
                description: 'Total iron as FeO (wt%)',
                required: true,
                unit: 'wt%',
                aliases: ['FeOT', 'FeO_Total', 'FeOt'],
                patterns: [/^feot/i, /^feo_?t/i],
            },
            {
                name: 'MgO',
                description: 'MgO concentration (wt%)',
                required: true,
                unit: 'wt%',
                aliases: COLUMN_PATTERNS.MgO?.aliases || ['MgO'],
                patterns: [/^mgo/i],
            },
        ],
        outputUnit: 'ratio',
        validationRules: [
            { type: 'range', min: 0, max: 1, errorMessage: 'Fe* must be between 0 and 1', severity: 'error' },
        ],
        calculateFn: (inputs) => calculateFeNumber(inputs.FeOT, inputs.MgO).value,
        references: ['Miyashiro (1974)', 'Discriminates tholeiitic from calc-alkaline series'],
    });

    // Total Alkalis
    definitions.push({
        id: 'total_alkalis',
        name: 'Total Alkalis (Na₂O + K₂O)',
        category: 'petrochemical-index',
        description: 'Sum of Na₂O and K₂O for TAS classification',
        formula: null,
        formulaDisplay: 'Total Alkalis = Na₂O + K₂O (wt%)',
        inputs: [
            {
                name: 'Na2O',
                description: 'Na₂O concentration (wt%)',
                required: false,
                unit: 'wt%',
                aliases: COLUMN_PATTERNS.Na2O?.aliases || ['Na2O'],
                patterns: [/^na2o/i],
            },
            {
                name: 'K2O',
                description: 'K₂O concentration (wt%)',
                required: false,
                unit: 'wt%',
                aliases: COLUMN_PATTERNS.K2O?.aliases || ['K2O'],
                patterns: [/^k2o/i],
            },
        ],
        outputUnit: 'wt%',
        validationRules: [VALIDATION_RULES.nonNegativeValue],
        calculateFn: (inputs) => calculateTotalAlkalis(inputs.Na2O, inputs.K2O),
        references: ['Le Bas et al. (1986)', 'Y-axis for TAS diagram'],
    });

    return definitions;
}
