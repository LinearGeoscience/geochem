// Exploration Pathfinder Element Ratios

import { CalculationDefinition } from '../../types/calculations';
import { COLUMN_PATTERNS } from './constants';
import { safeDivide, parseNumericValue } from './formulaEvaluator';
import { VALIDATION_RULES } from './validation';

/**
 * Calculate Cu/Zn ratio
 * Used for lithogeochemical vectoring toward VMS and porphyry deposits
 */
export function calculateCuZnRatio(
    cuValue: number | null,
    znValue: number | null
): { value: number | null; interpretation?: string } {
    const ratio = safeDivide(cuValue, znValue);

    if (ratio === null) {
        return { value: null };
    }

    let interpretation: string | undefined;
    if (ratio > 1) {
        interpretation = 'Cu-dominant - closer to feeder zone';
    } else {
        interpretation = 'Zn-dominant - distal/peripheral';
    }

    return { value: ratio, interpretation };
}

/**
 * Calculate Pb/Zn ratio
 * Metal zonation indicator
 */
export function calculatePbZnRatio(
    pbValue: number | null,
    znValue: number | null
): number | null {
    return safeDivide(pbValue, znValue);
}

/**
 * Calculate Cu/(Cu+Zn) ratio
 * VMS deposit indicator and zonation
 */
export function calculateCuCuZnRatio(
    cuValue: number | null,
    znValue: number | null
): number | null {
    if (cuValue === null || znValue === null) {
        return null;
    }
    const denominator = cuValue + znValue;
    return safeDivide(cuValue, denominator);
}

/**
 * Calculate Au/Ag ratio
 * Deposit type classification
 */
export function calculateAuAgRatio(
    auValue: number | null,
    agValue: number | null
): { value: number | null; interpretation?: string } {
    const ratio = safeDivide(auValue, agValue);

    if (ratio === null) {
        return { value: null };
    }

    let interpretation: string | undefined;
    if (ratio > 0.1) {
        interpretation = 'Au-rich (orogenic gold type)';
    } else if (ratio > 0.01) {
        interpretation = 'Au-Ag (epithermal type)';
    } else {
        interpretation = 'Ag-rich (polymetallic type)';
    }

    return { value: ratio, interpretation };
}

/**
 * Calculate As/Sb ratio
 * Gold pathfinder indicator
 */
export function calculateAsSbRatio(
    asValue: number | null,
    sbValue: number | null
): number | null {
    return safeDivide(asValue, sbValue);
}

/**
 * Calculate Rb/Sr ratio
 * Magmatic fractionation indicator
 */
export function calculateRbSrRatio(
    rbValue: number | null,
    srValue: number | null
): { value: number | null; interpretation?: string } {
    const ratio = safeDivide(rbValue, srValue);

    if (ratio === null) {
        return { value: null };
    }

    let interpretation: string | undefined;
    if (ratio > 0.5) {
        interpretation = 'Highly evolved/fractionated';
    } else if (ratio > 0.1) {
        interpretation = 'Moderately evolved';
    } else {
        interpretation = 'Primitive/less evolved';
    }

    return { value: ratio, interpretation };
}

/**
 * Calculate K/Rb ratio
 * Magmatic evolution indicator - decreases with fractionation
 */
export function calculateKRbRatio(
    k2oValue: number | null,
    rbValue: number | null
): number | null {
    if (k2oValue === null || rbValue === null) {
        return null;
    }
    // Convert K2O wt% to K ppm: K = K2O × 8302 ppm
    const kPpm = k2oValue * 8302;
    return safeDivide(kPpm, rbValue);
}

/**
 * Calculate Sr/Y ratio
 * Adakite signature - high Sr/Y indicates slab melting
 */
export function calculateSrYRatio(
    srValue: number | null,
    yValue: number | null
): { value: number | null; interpretation?: string } {
    const ratio = safeDivide(srValue, yValue);

    if (ratio === null) {
        return { value: null };
    }

    let interpretation: string | undefined;
    if (ratio > 40) {
        interpretation = 'Adakitic signature (Sr/Y > 40)';
    } else if (ratio > 20) {
        interpretation = 'High Sr/Y - partial adakitic';
    } else {
        interpretation = 'Normal arc signature';
    }

    return { value: ratio, interpretation };
}

/**
 * Calculate Nb/Ta ratio
 * Usually ~17 for primitive mantle; deviations indicate crustal processes
 */
export function calculateNbTaRatio(
    nbValue: number | null,
    taValue: number | null
): { value: number | null; interpretation?: string } {
    const ratio = safeDivide(nbValue, taValue);

    if (ratio === null) {
        return { value: null };
    }

    let interpretation: string | undefined;
    if (ratio > 20) {
        interpretation = 'Super-chondritic - rutile involvement';
    } else if (ratio >= 14 && ratio <= 20) {
        interpretation = 'Near chondritic (~17)';
    } else {
        interpretation = 'Sub-chondritic - titanite/ilmenite';
    }

    return { value: ratio, interpretation };
}

/**
 * Calculate Zr/Hf ratio
 * Usually ~36 for primitive mantle
 */
export function calculateZrHfRatio(
    zrValue: number | null,
    hfValue: number | null
): number | null {
    return safeDivide(zrValue, hfValue);
}

/**
 * Calculate Th/U ratio
 * Crustal vs mantle signature
 */
export function calculateThURatio(
    thValue: number | null,
    uValue: number | null
): { value: number | null; interpretation?: string } {
    const ratio = safeDivide(thValue, uValue);

    if (ratio === null) {
        return { value: null };
    }

    let interpretation: string | undefined;
    if (ratio > 4) {
        interpretation = 'Crustal signature';
    } else if (ratio >= 2 && ratio <= 4) {
        interpretation = 'Average crustal';
    } else {
        interpretation = 'Mantle-like or U-enriched';
    }

    return { value: ratio, interpretation };
}

/**
 * Calculate Ba/La ratio
 * Fluid mobile/immobile ratio - high values indicate fluid metasomatism
 */
export function calculateBaLaRatio(
    baValue: number | null,
    laValue: number | null
): number | null {
    return safeDivide(baValue, laValue);
}

/**
 * Calculate Nb/Y ratio
 * Tectonic discrimination
 */
export function calculateNbYRatio(
    nbValue: number | null,
    yValue: number | null
): number | null {
    return safeDivide(nbValue, yValue);
}

/**
 * Generate calculation definitions for exploration ratios
 */
export function generateExplorationDefinitions(): CalculationDefinition[] {
    const definitions: CalculationDefinition[] = [];

    // Cu/Zn
    definitions.push({
        id: 'cu_zn_ratio',
        name: 'Cu/Zn Ratio',
        category: 'exploration-ratio',
        description: 'Lithogeochemical vectoring toward VMS and porphyry deposits',
        formula: null,
        formulaDisplay: 'Cu/Zn = Cu (ppm) / Zn (ppm)',
        inputs: [
            { name: 'Cu', description: 'Cu concentration (ppm)', required: true, unit: 'ppm', aliases: ['Cu', 'Cu_ppm'], patterns: [/^cu/i] },
            { name: 'Zn', description: 'Zn concentration (ppm)', required: true, unit: 'ppm', aliases: ['Zn', 'Zn_ppm'], patterns: [/^zn/i] },
        ],
        outputUnit: 'ratio',
        validationRules: [VALIDATION_RULES.ratioPositive],
        calculateFn: (inputs) => calculateCuZnRatio(inputs.Cu, inputs.Zn).value,
        references: ['VMS vectoring tool'],
    });

    // Pb/Zn
    definitions.push({
        id: 'pb_zn_ratio',
        name: 'Pb/Zn Ratio',
        category: 'exploration-ratio',
        description: 'Metal zonation indicator',
        formula: null,
        formulaDisplay: 'Pb/Zn = Pb (ppm) / Zn (ppm)',
        inputs: [
            { name: 'Pb', description: 'Pb concentration (ppm)', required: true, unit: 'ppm', aliases: ['Pb', 'Pb_ppm'], patterns: [/^pb/i] },
            { name: 'Zn', description: 'Zn concentration (ppm)', required: true, unit: 'ppm', aliases: ['Zn', 'Zn_ppm'], patterns: [/^zn/i] },
        ],
        outputUnit: 'ratio',
        validationRules: [VALIDATION_RULES.ratioPositive],
        calculateFn: (inputs) => calculatePbZnRatio(inputs.Pb, inputs.Zn),
    });

    // Cu/(Cu+Zn)
    definitions.push({
        id: 'cu_cu_zn_ratio',
        name: 'Cu/(Cu+Zn)',
        category: 'exploration-ratio',
        description: 'VMS deposit indicator and metal zonation',
        formula: null,
        formulaDisplay: 'Cu/(Cu+Zn)',
        inputs: [
            { name: 'Cu', description: 'Cu concentration (ppm)', required: true, unit: 'ppm', aliases: ['Cu', 'Cu_ppm'], patterns: [/^cu/i] },
            { name: 'Zn', description: 'Zn concentration (ppm)', required: true, unit: 'ppm', aliases: ['Zn', 'Zn_ppm'], patterns: [/^zn/i] },
        ],
        outputUnit: 'ratio',
        validationRules: [
            { type: 'range', min: 0, max: 1, errorMessage: 'Ratio must be between 0 and 1', severity: 'error' },
        ],
        calculateFn: (inputs) => calculateCuCuZnRatio(inputs.Cu, inputs.Zn),
        references: ['Values > 0.5 indicate Cu-rich/proximal; < 0.5 indicate Zn-rich/distal'],
    });

    // Au/Ag
    definitions.push({
        id: 'au_ag_ratio',
        name: 'Au/Ag Ratio',
        category: 'exploration-ratio',
        description: 'Deposit type classification',
        formula: null,
        formulaDisplay: 'Au/Ag (ensure same units)',
        inputs: [
            { name: 'Au', description: 'Au concentration', required: true, unit: 'ppb', aliases: ['Au', 'Au_ppb', 'Au_ppm'], patterns: [/^au/i] },
            { name: 'Ag', description: 'Ag concentration', required: true, unit: 'ppm', aliases: ['Ag', 'Ag_ppm'], patterns: [/^ag/i] },
        ],
        outputUnit: 'ratio',
        validationRules: [VALIDATION_RULES.ratioPositive],
        calculateFn: (inputs) => calculateAuAgRatio(inputs.Au, inputs.Ag).value,
        references: ['High = orogenic gold; Low = polymetallic'],
    });

    // As/Sb
    definitions.push({
        id: 'as_sb_ratio',
        name: 'As/Sb Ratio',
        category: 'exploration-ratio',
        description: 'Gold pathfinder indicator',
        formula: null,
        formulaDisplay: 'As/Sb = As (ppm) / Sb (ppm)',
        inputs: [
            { name: 'As', description: 'As concentration (ppm)', required: true, unit: 'ppm', aliases: ['As', 'As_ppm'], patterns: [/^as/i] },
            { name: 'Sb', description: 'Sb concentration (ppm)', required: true, unit: 'ppm', aliases: ['Sb', 'Sb_ppm'], patterns: [/^sb/i] },
        ],
        outputUnit: 'ratio',
        validationRules: [VALIDATION_RULES.ratioPositive],
        calculateFn: (inputs) => calculateAsSbRatio(inputs.As, inputs.Sb),
    });

    // Rb/Sr
    definitions.push({
        id: 'rb_sr_ratio',
        name: 'Rb/Sr Ratio',
        category: 'exploration-ratio',
        description: 'Magmatic fractionation indicator',
        formula: null,
        formulaDisplay: 'Rb/Sr = Rb (ppm) / Sr (ppm)',
        inputs: [
            { name: 'Rb', description: 'Rb concentration (ppm)', required: true, unit: 'ppm', aliases: ['Rb', 'Rb_ppm'], patterns: [/^rb/i] },
            { name: 'Sr', description: 'Sr concentration (ppm)', required: true, unit: 'ppm', aliases: ['Sr', 'Sr_ppm'], patterns: [/^sr/i] },
        ],
        outputUnit: 'ratio',
        validationRules: [VALIDATION_RULES.ratioPositive],
        calculateFn: (inputs) => calculateRbSrRatio(inputs.Rb, inputs.Sr).value,
        references: ['High Rb/Sr indicates evolved/fractionated magma'],
    });

    // K/Rb
    definitions.push({
        id: 'k_rb_ratio',
        name: 'K/Rb Ratio',
        category: 'exploration-ratio',
        description: 'Magmatic evolution - decreases with fractionation',
        formula: null,
        formulaDisplay: 'K/Rb = K (ppm) / Rb (ppm)',
        inputs: [
            { name: 'K2O', description: 'K2O concentration (wt%)', required: true, unit: 'wt%', aliases: ['K2O', 'K2O_pct'], patterns: [/^k2o/i] },
            { name: 'Rb', description: 'Rb concentration (ppm)', required: true, unit: 'ppm', aliases: ['Rb', 'Rb_ppm'], patterns: [/^rb/i] },
        ],
        outputUnit: 'ratio',
        validationRules: [VALIDATION_RULES.ratioPositive],
        calculateFn: (inputs) => calculateKRbRatio(inputs.K2O, inputs.Rb),
        references: ['Primitive mantle ~250; decreases with fractionation'],
    });

    // Sr/Y
    definitions.push({
        id: 'sr_y_ratio',
        name: 'Sr/Y Ratio',
        category: 'exploration-ratio',
        description: 'Adakite signature indicator',
        formula: null,
        formulaDisplay: 'Sr/Y = Sr (ppm) / Y (ppm)',
        inputs: [
            { name: 'Sr', description: 'Sr concentration (ppm)', required: true, unit: 'ppm', aliases: ['Sr', 'Sr_ppm'], patterns: [/^sr/i] },
            { name: 'Y', description: 'Y concentration (ppm)', required: true, unit: 'ppm', aliases: ['Y', 'Y_ppm'], patterns: [/^y[_\s]?/i] },
        ],
        outputUnit: 'ratio',
        validationRules: [VALIDATION_RULES.ratioPositive],
        calculateFn: (inputs) => calculateSrYRatio(inputs.Sr, inputs.Y).value,
        references: ['Sr/Y > 40 = adakitic (porphyry Cu-Au prospective)'],
    });

    // Nb/Ta
    definitions.push({
        id: 'nb_ta_ratio',
        name: 'Nb/Ta Ratio',
        category: 'exploration-ratio',
        description: 'Primitive mantle ~17; deviations indicate mineral control',
        formula: null,
        formulaDisplay: 'Nb/Ta = Nb (ppm) / Ta (ppm)',
        inputs: [
            { name: 'Nb', description: 'Nb concentration (ppm)', required: true, unit: 'ppm', aliases: ['Nb', 'Nb_ppm'], patterns: [/^nb/i] },
            { name: 'Ta', description: 'Ta concentration (ppm)', required: true, unit: 'ppm', aliases: ['Ta', 'Ta_ppm'], patterns: [/^ta/i] },
        ],
        outputUnit: 'ratio',
        validationRules: [VALIDATION_RULES.ratioPositive],
        calculateFn: (inputs) => calculateNbTaRatio(inputs.Nb, inputs.Ta).value,
    });

    // Zr/Hf
    definitions.push({
        id: 'zr_hf_ratio',
        name: 'Zr/Hf Ratio',
        category: 'exploration-ratio',
        description: 'Primitive mantle ~36; used for magma source characterization',
        formula: null,
        formulaDisplay: 'Zr/Hf = Zr (ppm) / Hf (ppm)',
        inputs: [
            { name: 'Zr', description: 'Zr concentration (ppm)', required: true, unit: 'ppm', aliases: ['Zr', 'Zr_ppm'], patterns: [/^zr/i] },
            { name: 'Hf', description: 'Hf concentration (ppm)', required: true, unit: 'ppm', aliases: ['Hf', 'Hf_ppm'], patterns: [/^hf/i] },
        ],
        outputUnit: 'ratio',
        validationRules: [VALIDATION_RULES.ratioPositive],
        calculateFn: (inputs) => calculateZrHfRatio(inputs.Zr, inputs.Hf),
    });

    // Th/U
    definitions.push({
        id: 'th_u_ratio',
        name: 'Th/U Ratio',
        category: 'exploration-ratio',
        description: 'Crustal vs mantle signature',
        formula: null,
        formulaDisplay: 'Th/U = Th (ppm) / U (ppm)',
        inputs: [
            { name: 'Th', description: 'Th concentration (ppm)', required: true, unit: 'ppm', aliases: ['Th', 'Th_ppm'], patterns: [/^th/i] },
            { name: 'U', description: 'U concentration (ppm)', required: true, unit: 'ppm', aliases: ['U', 'U_ppm'], patterns: [/^u[_\s]?/i] },
        ],
        outputUnit: 'ratio',
        validationRules: [VALIDATION_RULES.ratioPositive],
        calculateFn: (inputs) => calculateThURatio(inputs.Th, inputs.U).value,
        references: ['Th/U ~2-4 = crustal; < 2 = mantle or U-enriched'],
    });

    // Ba/La
    definitions.push({
        id: 'ba_la_ratio',
        name: 'Ba/La Ratio',
        category: 'exploration-ratio',
        description: 'Fluid mobile/immobile ratio - high values indicate fluid metasomatism',
        formula: null,
        formulaDisplay: 'Ba/La = Ba (ppm) / La (ppm)',
        inputs: [
            { name: 'Ba', description: 'Ba concentration (ppm)', required: true, unit: 'ppm', aliases: ['Ba', 'Ba_ppm'], patterns: [/^ba/i] },
            { name: 'La', description: 'La concentration (ppm)', required: true, unit: 'ppm', aliases: ['La', 'La_ppm'], patterns: [/^la/i] },
        ],
        outputUnit: 'ratio',
        validationRules: [VALIDATION_RULES.ratioPositive],
        calculateFn: (inputs) => calculateBaLaRatio(inputs.Ba, inputs.La),
        references: ['High Ba/La indicates fluid addition/metasomatism'],
    });

    // Nb/Y (for tectonic discrimination)
    definitions.push({
        id: 'nb_y_ratio',
        name: 'Nb/Y Ratio',
        category: 'exploration-ratio',
        description: 'Tectonic discrimination',
        formula: null,
        formulaDisplay: 'Nb/Y = Nb (ppm) / Y (ppm)',
        inputs: [
            { name: 'Nb', description: 'Nb concentration (ppm)', required: true, unit: 'ppm', aliases: ['Nb', 'Nb_ppm'], patterns: [/^nb/i] },
            { name: 'Y', description: 'Y concentration (ppm)', required: true, unit: 'ppm', aliases: ['Y', 'Y_ppm'], patterns: [/^y[_\s]?/i] },
        ],
        outputUnit: 'ratio',
        validationRules: [VALIDATION_RULES.ratioPositive],
        calculateFn: (inputs) => calculateNbYRatio(inputs.Nb, inputs.Y),
        references: ['Used in Nb-Y discrimination diagrams'],
    });

    return definitions;
}
