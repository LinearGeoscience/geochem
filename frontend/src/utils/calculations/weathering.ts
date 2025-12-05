// Weathering Index Calculations

import { CalculationDefinition, IndexResult } from '../../types/calculations';
import { OXIDE_WEIGHTS, COLUMN_PATTERNS } from './constants';
import { parseNumericValue, wtPercentToMolar } from './formulaEvaluator';
import { VALIDATION_RULES } from './validation';
import { calculateCIA, calculateCIW, calculatePIA } from './petrochemical';

// Molecular weights
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
};

/**
 * Calculate WIP (Weathering Index of Parker)
 * WIP = 100 × [(2Na2O/0.35) + (MgO/0.9) + (2K2O/0.25) + (CaO/0.7)]
 *
 * Based on bond strengths of alkali and alkaline earth metals
 * Reference: Parker (1970)
 */
export function calculateWIP(
    na2oWt: number | null,
    mgoWt: number | null,
    k2oWt: number | null,
    caoWt: number | null
): IndexResult {
    const na2o = na2oWt ?? 0;
    const mgo = mgoWt ?? 0;
    const k2o = k2oWt ?? 0;
    const cao = caoWt ?? 0;

    if (na2oWt === null && mgoWt === null && k2oWt === null && caoWt === null) {
        return { value: null };
    }

    // Convert wt% to molar
    const na2oMol = wtPercentToMolar(na2o, MW.Na2O) ?? 0;
    const mgoMol = wtPercentToMolar(mgo, MW.MgO) ?? 0;
    const k2oMol = wtPercentToMolar(k2o, MW.K2O) ?? 0;
    const caoMol = wtPercentToMolar(cao, MW.CaO) ?? 0;

    // Parker's coefficients (inverse of bond strength relative to Ca)
    const wip = 100 * (
        (2 * na2oMol / 0.35) +
        (mgoMol / 0.9) +
        (2 * k2oMol / 0.25) +
        (caoMol / 0.7)
    );

    let classification: string | undefined;
    if (wip >= 80) classification = 'Fresh rock (≥80)';
    else if (wip >= 60) classification = 'Low weathering (60-80)';
    else if (wip >= 40) classification = 'Moderate weathering (40-60)';
    else classification = 'Intense weathering (<40)';

    return {
        value: wip,
        classification,
        description: 'Weathering Index of Parker - based on cation mobility',
    };
}

/**
 * Calculate ICV (Index of Compositional Variability)
 * ICV = (Fe2O3 + K2O + Na2O + CaO + MgO + MnO + TiO2) / Al2O3
 *
 * Discriminates clay mineralogy and sediment maturity
 * Reference: Cox et al. (1995)
 */
export function calculateICV(
    al2o3Wt: number | null,
    fe2o3Wt: number | null,
    k2oWt: number | null,
    na2oWt: number | null,
    caoWt: number | null,
    mgoWt: number | null,
    mnoWt: number | null = null,
    tio2Wt: number | null = null
): IndexResult {
    if (al2o3Wt === null || al2o3Wt === 0) {
        return { value: null };
    }

    const numerator = (fe2o3Wt ?? 0) + (k2oWt ?? 0) + (na2oWt ?? 0) +
                      (caoWt ?? 0) + (mgoWt ?? 0) + (mnoWt ?? 0) + (tio2Wt ?? 0);

    const icv = numerator / al2o3Wt;

    let classification: string | undefined;
    if (icv > 1) classification = 'First-cycle sediment (>1)';
    else classification = 'Recycled/weathered (<1)';

    return {
        value: icv,
        classification,
        description: 'Index of Compositional Variability - sediment maturity indicator',
    };
}

/**
 * Calculate MWPI (Modified Weathering Potential Index)
 * MWPI = [(Na2O + K2O) / (Na2O + K2O + CaO + MgO)] × 100
 *
 * Modified version of WIP for siliciclastic sediments
 */
export function calculateMWPI(
    na2oWt: number | null,
    k2oWt: number | null,
    caoWt: number | null,
    mgoWt: number | null
): IndexResult {
    const na2o = na2oWt ?? 0;
    const k2o = k2oWt ?? 0;
    const cao = caoWt ?? 0;
    const mgo = mgoWt ?? 0;

    if (na2oWt === null && k2oWt === null && caoWt === null && mgoWt === null) {
        return { value: null };
    }

    const numerator = na2o + k2o;
    const denominator = na2o + k2o + cao + mgo;

    if (denominator === 0) {
        return { value: null };
    }

    const mwpi = 100 * (numerator / denominator);

    return {
        value: mwpi,
        classification: undefined,
        description: 'Modified Weathering Potential Index',
    };
}

/**
 * Calculate R-value (Ruxton Ratio)
 * R = SiO2 / Al2O3
 *
 * Simple weathering indicator - Si is depleted relative to Al during weathering
 * Reference: Ruxton (1968)
 */
export function calculateRuxtonRatio(
    sio2Wt: number | null,
    al2o3Wt: number | null
): IndexResult {
    if (sio2Wt === null || al2o3Wt === null || al2o3Wt === 0) {
        return { value: null };
    }

    const r = sio2Wt / al2o3Wt;

    let classification: string | undefined;
    if (r > 10) classification = 'Fresh rock (>10)';
    else if (r > 5) classification = 'Moderate weathering (5-10)';
    else classification = 'Intense weathering (<5)';

    return {
        value: r,
        classification,
        description: 'Ruxton Ratio - simple Si/Al weathering indicator',
    };
}

/**
 * Calculate Vogt Ratio
 * V = (Al2O3 + K2O) / (MgO + CaO + Na2O)
 *
 * Measures relative enrichment of residual vs mobile components
 */
export function calculateVogtRatio(
    al2o3Wt: number | null,
    k2oWt: number | null,
    mgoWt: number | null,
    caoWt: number | null,
    na2oWt: number | null
): IndexResult {
    const numerator = (al2o3Wt ?? 0) + (k2oWt ?? 0);
    const denominator = (mgoWt ?? 0) + (caoWt ?? 0) + (na2oWt ?? 0);

    if (denominator === 0) {
        return { value: null };
    }

    if (al2o3Wt === null && k2oWt === null) {
        return { value: null };
    }

    const v = numerator / denominator;

    return {
        value: v,
        description: 'Vogt Ratio - residual/mobile element ratio',
    };
}

/**
 * Calculate STI (Silica-Titania Index)
 * STI = [SiO2 / (SiO2 + TiO2 + Fe2O3 + Al2O3)] × 100
 *
 * Measures silica residual content
 */
export function calculateSTI(
    sio2Wt: number | null,
    tio2Wt: number | null,
    fe2o3Wt: number | null,
    al2o3Wt: number | null
): IndexResult {
    if (sio2Wt === null) {
        return { value: null };
    }

    const denominator = sio2Wt + (tio2Wt ?? 0) + (fe2o3Wt ?? 0) + (al2o3Wt ?? 0);

    if (denominator === 0) {
        return { value: null };
    }

    const sti = 100 * (sio2Wt / denominator);

    return {
        value: sti,
        description: 'Silica-Titania Index - silica residual indicator',
    };
}

/**
 * Generate calculation definitions for weathering indices
 */
export function generateWeatheringDefinitions(): CalculationDefinition[] {
    const definitions: CalculationDefinition[] = [];

    // CIA
    definitions.push({
        id: 'cia',
        name: 'CIA (Chemical Index of Alteration)',
        category: 'weathering-index',
        description: 'CIA = [Al2O3 / (Al2O3 + CaO* + Na2O + K2O)] × 100',
        formula: null,
        formulaDisplay: 'CIA = [Al₂O₃ / (Al₂O₃ + CaO* + Na₂O + K₂O)] × 100 [molar]',
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
                name: 'CaO',
                description: 'CaO concentration (wt%)',
                required: false,
                unit: 'wt%',
                aliases: COLUMN_PATTERNS.CaO?.aliases || ['CaO'],
                patterns: [/^cao/i],
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
            {
                name: 'P2O5',
                description: 'P₂O₅ concentration (wt%) - for apatite correction',
                required: false,
                unit: 'wt%',
                aliases: COLUMN_PATTERNS.P2O5?.aliases || ['P2O5'],
                patterns: [/^p2o5/i],
            },
        ],
        outputUnit: 'index',
        validationRules: [VALIDATION_RULES.ciaRange],
        calculateFn: (inputs) => calculateCIA(inputs.Al2O3, inputs.CaO, inputs.Na2O, inputs.K2O, inputs.P2O5).value,
        references: ['Nesbitt & Young (1982)'],
    });

    // CIW
    definitions.push({
        id: 'ciw',
        name: 'CIW (Chemical Index of Weathering)',
        category: 'weathering-index',
        description: 'CIW = [Al2O3 / (Al2O3 + CaO* + Na2O)] × 100 - excludes K2O',
        formula: null,
        formulaDisplay: 'CIW = [Al₂O₃ / (Al₂O₃ + CaO* + Na₂O)] × 100 [molar]',
        inputs: [
            {
                name: 'Al2O3',
                description: 'Al₂O₃ concentration (wt%)',
                required: true,
                unit: 'wt%',
                aliases: ['Al2O3'],
                patterns: [/^al2o3/i],
            },
            {
                name: 'CaO',
                description: 'CaO concentration (wt%)',
                required: false,
                unit: 'wt%',
                aliases: ['CaO'],
                patterns: [/^cao/i],
            },
            {
                name: 'Na2O',
                description: 'Na₂O concentration (wt%)',
                required: false,
                unit: 'wt%',
                aliases: ['Na2O'],
                patterns: [/^na2o/i],
            },
        ],
        outputUnit: 'index',
        validationRules: [VALIDATION_RULES.ciaRange],
        calculateFn: (inputs) => calculateCIW(inputs.Al2O3, inputs.CaO, inputs.Na2O).value,
        references: ['Harnois (1988)'],
    });

    // PIA
    definitions.push({
        id: 'pia',
        name: 'PIA (Plagioclase Index of Alteration)',
        category: 'weathering-index',
        description: 'PIA = [(Al2O3 - K2O) / ((Al2O3 - K2O) + CaO* + Na2O)] × 100',
        formula: null,
        formulaDisplay: 'PIA = [(Al₂O₃ - K₂O) / ((Al₂O₃ - K₂O) + CaO* + Na₂O)] × 100 [molar]',
        inputs: [
            {
                name: 'Al2O3',
                description: 'Al₂O₃ concentration (wt%)',
                required: true,
                unit: 'wt%',
                aliases: ['Al2O3'],
                patterns: [/^al2o3/i],
            },
            {
                name: 'CaO',
                description: 'CaO concentration (wt%)',
                required: false,
                unit: 'wt%',
                aliases: ['CaO'],
                patterns: [/^cao/i],
            },
            {
                name: 'Na2O',
                description: 'Na₂O concentration (wt%)',
                required: false,
                unit: 'wt%',
                aliases: ['Na2O'],
                patterns: [/^na2o/i],
            },
            {
                name: 'K2O',
                description: 'K₂O concentration (wt%)',
                required: true,
                unit: 'wt%',
                aliases: ['K2O'],
                patterns: [/^k2o/i],
            },
        ],
        outputUnit: 'index',
        validationRules: [VALIDATION_RULES.ciaRange],
        calculateFn: (inputs) => calculatePIA(inputs.Al2O3, inputs.CaO, inputs.Na2O, inputs.K2O).value,
        references: ['Fedo et al. (1995)'],
    });

    // WIP
    definitions.push({
        id: 'wip',
        name: 'WIP (Weathering Index of Parker)',
        category: 'weathering-index',
        description: 'Based on bond strengths of mobile cations',
        formula: null,
        formulaDisplay: 'WIP = 100 × [(2Na₂O/0.35) + (MgO/0.9) + (2K₂O/0.25) + (CaO/0.7)]',
        inputs: [
            {
                name: 'Na2O',
                description: 'Na₂O concentration (wt%)',
                required: false,
                unit: 'wt%',
                aliases: ['Na2O'],
                patterns: [/^na2o/i],
            },
            {
                name: 'MgO',
                description: 'MgO concentration (wt%)',
                required: false,
                unit: 'wt%',
                aliases: ['MgO'],
                patterns: [/^mgo/i],
            },
            {
                name: 'K2O',
                description: 'K₂O concentration (wt%)',
                required: false,
                unit: 'wt%',
                aliases: ['K2O'],
                patterns: [/^k2o/i],
            },
            {
                name: 'CaO',
                description: 'CaO concentration (wt%)',
                required: false,
                unit: 'wt%',
                aliases: ['CaO'],
                patterns: [/^cao/i],
            },
        ],
        outputUnit: 'index',
        validationRules: [VALIDATION_RULES.nonNegativeValue],
        calculateFn: (inputs) => calculateWIP(inputs.Na2O, inputs.MgO, inputs.K2O, inputs.CaO).value,
        references: ['Parker (1970)'],
    });

    // ICV
    definitions.push({
        id: 'icv',
        name: 'ICV (Index of Compositional Variability)',
        category: 'weathering-index',
        description: 'Discriminates clay mineralogy and sediment maturity',
        formula: null,
        formulaDisplay: 'ICV = (Fe₂O₃ + K₂O + Na₂O + CaO + MgO + MnO + TiO₂) / Al₂O₃',
        inputs: [
            {
                name: 'Al2O3',
                description: 'Al₂O₃ concentration (wt%)',
                required: true,
                unit: 'wt%',
                aliases: ['Al2O3'],
                patterns: [/^al2o3/i],
            },
            {
                name: 'Fe2O3',
                description: 'Fe₂O₃ concentration (wt%)',
                required: false,
                unit: 'wt%',
                aliases: ['Fe2O3'],
                patterns: [/^fe2o3/i],
            },
            {
                name: 'K2O',
                description: 'K₂O concentration (wt%)',
                required: false,
                unit: 'wt%',
                aliases: ['K2O'],
                patterns: [/^k2o/i],
            },
            {
                name: 'Na2O',
                description: 'Na₂O concentration (wt%)',
                required: false,
                unit: 'wt%',
                aliases: ['Na2O'],
                patterns: [/^na2o/i],
            },
            {
                name: 'CaO',
                description: 'CaO concentration (wt%)',
                required: false,
                unit: 'wt%',
                aliases: ['CaO'],
                patterns: [/^cao/i],
            },
            {
                name: 'MgO',
                description: 'MgO concentration (wt%)',
                required: false,
                unit: 'wt%',
                aliases: ['MgO'],
                patterns: [/^mgo/i],
            },
        ],
        outputUnit: 'ratio',
        validationRules: [VALIDATION_RULES.nonNegativeValue],
        calculateFn: (inputs) => calculateICV(
            inputs.Al2O3, inputs.Fe2O3, inputs.K2O, inputs.Na2O, inputs.CaO, inputs.MgO
        ).value,
        references: ['Cox et al. (1995)'],
    });

    // Ruxton Ratio
    definitions.push({
        id: 'ruxton_ratio',
        name: 'Ruxton Ratio (SiO₂/Al₂O₃)',
        category: 'weathering-index',
        description: 'Simple Si/Al weathering indicator',
        formula: null,
        formulaDisplay: 'R = SiO₂ / Al₂O₃',
        inputs: [
            {
                name: 'SiO2',
                description: 'SiO₂ concentration (wt%)',
                required: true,
                unit: 'wt%',
                aliases: ['SiO2'],
                patterns: [/^sio2/i],
            },
            {
                name: 'Al2O3',
                description: 'Al₂O₃ concentration (wt%)',
                required: true,
                unit: 'wt%',
                aliases: ['Al2O3'],
                patterns: [/^al2o3/i],
            },
        ],
        outputUnit: 'ratio',
        validationRules: [VALIDATION_RULES.positiveValue],
        calculateFn: (inputs) => calculateRuxtonRatio(inputs.SiO2, inputs.Al2O3).value,
        references: ['Ruxton (1968)'],
    });

    return definitions;
}
