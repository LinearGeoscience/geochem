// REE Normalization Calculations

import { CalculationDefinition, NormalizationStandard } from '../../types/calculations';
import {
    NORMALIZATION_STANDARDS,
    REE_ELEMENTS,
    LREE,
    MREE,
    HREE,
    CHONDRITE_MCDONOUGH_SUN_1995,
    COLUMN_PATTERNS,
} from './constants';
import { parseNumericValue, safeDivide } from './formulaEvaluator';
import { VALIDATION_RULES } from './validation';

/**
 * Normalize a single REE value to a standard
 */
export function normalizeREE(
    value: number | null,
    element: string,
    standard: NormalizationStandard
): number | null {
    if (value === null) return null;

    const normValue = standard.values[element];
    if (normValue === undefined || normValue === 0) {
        console.warn(`No normalization value for ${element} in ${standard.name}`);
        return null;
    }

    return value / normValue;
}

/**
 * Normalize all REE values for a sample
 */
export function normalizeAllREE(
    sample: Record<string, number | null>,
    standard: NormalizationStandard = CHONDRITE_MCDONOUGH_SUN_1995
): Record<string, number | null> {
    const normalized: Record<string, number | null> = {};

    for (const element of REE_ELEMENTS) {
        const value = sample[element];
        normalized[`${element}_N`] = normalizeREE(value, element, standard);
    }

    return normalized;
}

/**
 * Calculate (La/Yb)_N ratio - LREE/HREE fractionation
 */
export function calculateLaYbN(
    laValue: number | null,
    ybValue: number | null,
    standard: NormalizationStandard = CHONDRITE_MCDONOUGH_SUN_1995
): number | null {
    const laN = normalizeREE(laValue, 'La', standard);
    const ybN = normalizeREE(ybValue, 'Yb', standard);

    return safeDivide(laN, ybN);
}

/**
 * Calculate (La/Sm)_N ratio - LREE fractionation indicator
 */
export function calculateLaSmN(
    laValue: number | null,
    smValue: number | null,
    standard: NormalizationStandard = CHONDRITE_MCDONOUGH_SUN_1995
): number | null {
    const laN = normalizeREE(laValue, 'La', standard);
    const smN = normalizeREE(smValue, 'Sm', standard);

    return safeDivide(laN, smN);
}

/**
 * Calculate (Gd/Yb)_N ratio - HREE fractionation indicator
 */
export function calculateGdYbN(
    gdValue: number | null,
    ybValue: number | null,
    standard: NormalizationStandard = CHONDRITE_MCDONOUGH_SUN_1995
): number | null {
    const gdN = normalizeREE(gdValue, 'Gd', standard);
    const ybN = normalizeREE(ybValue, 'Yb', standard);

    return safeDivide(gdN, ybN);
}

/**
 * Calculate Eu/Eu* (Europium anomaly)
 * Eu/Eu* = Eu_N / sqrt(Sm_N × Gd_N)
 *
 * Values < 1 indicate negative Eu anomaly (plagioclase fractionation)
 * Values > 1 indicate positive Eu anomaly (plagioclase accumulation)
 */
export function calculateEuAnomaly(
    euValue: number | null,
    smValue: number | null,
    gdValue: number | null,
    standard: NormalizationStandard = CHONDRITE_MCDONOUGH_SUN_1995
): {
    value: number | null;
    interpretation?: string;
} {
    const euN = normalizeREE(euValue, 'Eu', standard);
    const smN = normalizeREE(smValue, 'Sm', standard);
    const gdN = normalizeREE(gdValue, 'Gd', standard);

    if (euN === null || smN === null || gdN === null) {
        return { value: null };
    }

    if (smN <= 0 || gdN <= 0) {
        return { value: null };
    }

    const euStar = Math.sqrt(smN * gdN);
    if (euStar === 0) {
        return { value: null };
    }

    const anomaly = euN / euStar;

    let interpretation: string | undefined;
    if (anomaly < 0.85) {
        interpretation = 'Negative Eu anomaly - plagioclase fractionation';
    } else if (anomaly > 1.15) {
        interpretation = 'Positive Eu anomaly - plagioclase accumulation';
    } else {
        interpretation = 'No significant Eu anomaly';
    }

    return { value: anomaly, interpretation };
}

/**
 * Calculate Ce/Ce* (Cerium anomaly)
 * Ce/Ce* = Ce_N / sqrt(La_N × Pr_N)
 *
 * Used to detect oxidation state changes (Ce³⁺ vs Ce⁴⁺)
 */
export function calculateCeAnomaly(
    ceValue: number | null,
    laValue: number | null,
    prValue: number | null,
    standard: NormalizationStandard = CHONDRITE_MCDONOUGH_SUN_1995
): {
    value: number | null;
    interpretation?: string;
} {
    const ceN = normalizeREE(ceValue, 'Ce', standard);
    const laN = normalizeREE(laValue, 'La', standard);
    const prN = normalizeREE(prValue, 'Pr', standard);

    if (ceN === null || laN === null || prN === null) {
        return { value: null };
    }

    if (laN <= 0 || prN <= 0) {
        return { value: null };
    }

    const ceStar = Math.sqrt(laN * prN);
    if (ceStar === 0) {
        return { value: null };
    }

    const anomaly = ceN / ceStar;

    let interpretation: string | undefined;
    if (anomaly < 0.9) {
        interpretation = 'Negative Ce anomaly - oxidizing conditions';
    } else if (anomaly > 1.1) {
        interpretation = 'Positive Ce anomaly';
    } else {
        interpretation = 'No significant Ce anomaly';
    }

    return { value: anomaly, interpretation };
}

/**
 * Calculate Total REE (ΣREE)
 */
export function calculateTotalREE(
    sample: Record<string, number | null>,
    includeY: boolean = false
): number | null {
    let sum = 0;
    let hasValue = false;

    for (const element of REE_ELEMENTS) {
        const value = sample[element];
        if (value !== null) {
            sum += value;
            hasValue = true;
        }
    }

    if (includeY && sample.Y !== null) {
        sum += sample.Y!;
        hasValue = true;
    }

    return hasValue ? sum : null;
}

/**
 * Calculate LREE sum
 */
export function calculateLREE(sample: Record<string, number | null>): number | null {
    let sum = 0;
    let hasValue = false;

    for (const element of LREE) {
        const value = sample[element];
        if (value !== null) {
            sum += value;
            hasValue = true;
        }
    }

    return hasValue ? sum : null;
}

/**
 * Calculate HREE sum
 */
export function calculateHREE(sample: Record<string, number | null>): number | null {
    let sum = 0;
    let hasValue = false;

    for (const element of HREE) {
        const value = sample[element];
        if (value !== null) {
            sum += value;
            hasValue = true;
        }
    }

    return hasValue ? sum : null;
}

/**
 * Calculate LREE/HREE ratio
 */
export function calculateLREEHREERatio(sample: Record<string, number | null>): number | null {
    const lree = calculateLREE(sample);
    const hree = calculateHREE(sample);

    return safeDivide(lree, hree);
}

/**
 * Generate calculation definitions for REE normalization
 */
export function generateREEDefinitions(): CalculationDefinition[] {
    const definitions: CalculationDefinition[] = [];

    // Individual REE normalization for each element and each standard
    for (const standard of NORMALIZATION_STANDARDS) {
        for (const element of REE_ELEMENTS) {
            definitions.push({
                id: `${element.toLowerCase()}_norm_${standard.id.replace(/-/g, '_')}`,
                name: `${element}_N (${standard.name.split('(')[0].trim()})`,
                category: 'ree-normalization',
                description: `${element} normalized to ${standard.name}`,
                formula: null,
                formulaDisplay: `${element}_N = ${element} / ${standard.values[element]?.toFixed(4) ?? 'N/A'}`,
                inputs: [{
                    name: element,
                    description: `${element} concentration (ppm)`,
                    required: true,
                    unit: 'ppm',
                    aliases: COLUMN_PATTERNS[element]?.aliases || [element],
                    patterns: COLUMN_PATTERNS[element]?.patterns || [new RegExp(`^${element}$`, 'i')],
                }],
                outputUnit: 'ratio',
                validationRules: [VALIDATION_RULES.nonNegativeValue],
                calculateFn: (inputs) => normalizeREE(inputs[element], element, standard),
                references: [standard.reference],
            });
        }
    }

    // Eu anomaly
    definitions.push({
        id: 'eu_anomaly',
        name: 'Eu/Eu* (Europium Anomaly)',
        category: 'ree-normalization',
        description: 'Eu/Eu* = Eu_N / sqrt(Sm_N × Gd_N)',
        formula: null,
        formulaDisplay: 'Eu/Eu* = Eu_N / √(Sm_N × Gd_N)',
        inputs: [
            { name: 'Eu', description: 'Eu concentration (ppm)', required: true, unit: 'ppm', aliases: ['Eu', 'Eu_ppm'], patterns: [/^eu/i] },
            { name: 'Sm', description: 'Sm concentration (ppm)', required: true, unit: 'ppm', aliases: ['Sm', 'Sm_ppm'], patterns: [/^sm/i] },
            { name: 'Gd', description: 'Gd concentration (ppm)', required: true, unit: 'ppm', aliases: ['Gd', 'Gd_ppm'], patterns: [/^gd/i] },
        ],
        outputUnit: 'ratio',
        validationRules: [VALIDATION_RULES.positiveValue],
        calculateFn: (inputs) => calculateEuAnomaly(inputs.Eu, inputs.Sm, inputs.Gd).value,
        references: ['Indicator of plagioclase fractionation/accumulation'],
    });

    // Ce anomaly
    definitions.push({
        id: 'ce_anomaly',
        name: 'Ce/Ce* (Cerium Anomaly)',
        category: 'ree-normalization',
        description: 'Ce/Ce* = Ce_N / sqrt(La_N × Pr_N)',
        formula: null,
        formulaDisplay: 'Ce/Ce* = Ce_N / √(La_N × Pr_N)',
        inputs: [
            { name: 'Ce', description: 'Ce concentration (ppm)', required: true, unit: 'ppm', aliases: ['Ce', 'Ce_ppm'], patterns: [/^ce/i] },
            { name: 'La', description: 'La concentration (ppm)', required: true, unit: 'ppm', aliases: ['La', 'La_ppm'], patterns: [/^la/i] },
            { name: 'Pr', description: 'Pr concentration (ppm)', required: true, unit: 'ppm', aliases: ['Pr', 'Pr_ppm'], patterns: [/^pr/i] },
        ],
        outputUnit: 'ratio',
        validationRules: [VALIDATION_RULES.positiveValue],
        calculateFn: (inputs) => calculateCeAnomaly(inputs.Ce, inputs.La, inputs.Pr).value,
        references: ['Indicator of oxidation state changes'],
    });

    // (La/Yb)_N
    definitions.push({
        id: 'la_yb_n',
        name: '(La/Yb)_N',
        category: 'ree-normalization',
        description: 'LREE/HREE fractionation indicator',
        formula: null,
        formulaDisplay: '(La/Yb)_N = (La/La_chon) / (Yb/Yb_chon)',
        inputs: [
            { name: 'La', description: 'La concentration (ppm)', required: true, unit: 'ppm', aliases: ['La'], patterns: [/^la/i] },
            { name: 'Yb', description: 'Yb concentration (ppm)', required: true, unit: 'ppm', aliases: ['Yb'], patterns: [/^yb/i] },
        ],
        outputUnit: 'ratio',
        validationRules: [VALIDATION_RULES.positiveValue],
        calculateFn: (inputs) => calculateLaYbN(inputs.La, inputs.Yb),
        references: ['High values indicate LREE enrichment, melting in garnet stability field'],
    });

    // (La/Sm)_N
    definitions.push({
        id: 'la_sm_n',
        name: '(La/Sm)_N',
        category: 'ree-normalization',
        description: 'LREE fractionation indicator',
        formula: null,
        formulaDisplay: '(La/Sm)_N = (La/La_chon) / (Sm/Sm_chon)',
        inputs: [
            { name: 'La', description: 'La concentration (ppm)', required: true, unit: 'ppm', aliases: ['La'], patterns: [/^la/i] },
            { name: 'Sm', description: 'Sm concentration (ppm)', required: true, unit: 'ppm', aliases: ['Sm'], patterns: [/^sm/i] },
        ],
        outputUnit: 'ratio',
        validationRules: [VALIDATION_RULES.positiveValue],
        calculateFn: (inputs) => calculateLaSmN(inputs.La, inputs.Sm),
    });

    // (Gd/Yb)_N
    definitions.push({
        id: 'gd_yb_n',
        name: '(Gd/Yb)_N',
        category: 'ree-normalization',
        description: 'HREE fractionation indicator',
        formula: null,
        formulaDisplay: '(Gd/Yb)_N = (Gd/Gd_chon) / (Yb/Yb_chon)',
        inputs: [
            { name: 'Gd', description: 'Gd concentration (ppm)', required: true, unit: 'ppm', aliases: ['Gd'], patterns: [/^gd/i] },
            { name: 'Yb', description: 'Yb concentration (ppm)', required: true, unit: 'ppm', aliases: ['Yb'], patterns: [/^yb/i] },
        ],
        outputUnit: 'ratio',
        validationRules: [VALIDATION_RULES.positiveValue],
        calculateFn: (inputs) => calculateGdYbN(inputs.Gd, inputs.Yb),
        references: ['High values indicate HREE depletion, garnet in residue'],
    });

    // Total REE
    definitions.push({
        id: 'total_ree',
        name: 'ΣREE (Total REE)',
        category: 'ree-normalization',
        description: 'Sum of all REE concentrations',
        formula: null,
        formulaDisplay: 'ΣREE = La + Ce + Pr + Nd + Sm + Eu + Gd + Tb + Dy + Ho + Er + Tm + Yb + Lu',
        inputs: REE_ELEMENTS.map(element => ({
            name: element,
            description: `${element} concentration (ppm)`,
            required: false,
            unit: 'ppm' as const,
            aliases: [element],
            patterns: [new RegExp(`^${element}$`, 'i')],
        })),
        outputUnit: 'ppm',
        validationRules: [VALIDATION_RULES.nonNegativeValue],
        calculateFn: (inputs) => calculateTotalREE(inputs as Record<string, number | null>),
    });

    return definitions;
}
