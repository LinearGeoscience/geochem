// Element-Oxide Conversion Functions

import { CalculationDefinition } from '../../types/calculations';
import {
    ELEMENT_OXIDE_CONVERSIONS,
    IRON_OXIDE_CONVERSIONS,
    UNIT_CONVERSIONS,
    getConversionFactor,
    getOxidesForElement,
    COLUMN_PATTERNS,
} from './constants';
import { parseNumericValue } from './formulaEvaluator';
import { VALIDATION_RULES } from './validation';

/**
 * Convert element concentration to oxide
 */
export function elementToOxide(
    elementValue: number | null,
    element: string,
    oxide: string
): number | null {
    if (elementValue === null) return null;

    const factor = getConversionFactor(element, oxide);
    if (!factor) {
        console.warn(`No conversion factor found for ${element} to ${oxide}`);
        return null;
    }

    return elementValue * factor.elementToOxide;
}

/**
 * Convert oxide concentration to element
 */
export function oxideToElement(
    oxideValue: number | null,
    oxide: string,
    element: string
): number | null {
    if (oxideValue === null) return null;

    const factor = getConversionFactor(element, oxide);
    if (!factor) {
        console.warn(`No conversion factor found for ${oxide} to ${element}`);
        return null;
    }

    return oxideValue * factor.oxideToElement;
}

/**
 * Convert FeO to Fe2O3
 */
export function feoToFe2o3(feoValue: number | null): number | null {
    if (feoValue === null) return null;
    return feoValue * IRON_OXIDE_CONVERSIONS.FeO_to_Fe2O3;
}

/**
 * Convert Fe2O3 to FeO
 */
export function fe2o3ToFeo(fe2o3Value: number | null): number | null {
    if (fe2o3Value === null) return null;
    return fe2o3Value * IRON_OXIDE_CONVERSIONS.Fe2O3_to_FeO;
}

/**
 * Calculate total iron as FeO (FeOT) from FeO and Fe2O3
 */
export function calculateFeOT(
    feoValue: number | null,
    fe2o3Value: number | null
): number | null {
    const feo = feoValue ?? 0;
    const fe2o3AsFeo = fe2o3ToFeo(fe2o3Value) ?? 0;

    if (feoValue === null && fe2o3Value === null) {
        return null;
    }

    return feo + fe2o3AsFeo;
}

/**
 * Calculate total iron as Fe2O3 (Fe2O3T) from FeO and Fe2O3
 */
export function calculateFe2O3T(
    feoValue: number | null,
    fe2o3Value: number | null
): number | null {
    const fe2o3 = fe2o3Value ?? 0;
    const feoAsFe2o3 = feoToFe2o3(feoValue) ?? 0;

    if (feoValue === null && fe2o3Value === null) {
        return null;
    }

    return fe2o3 + feoAsFe2o3;
}

/**
 * Convert ppm to weight percent
 */
export function ppmToWtPercent(ppmValue: number | null): number | null {
    if (ppmValue === null) return null;
    return ppmValue * UNIT_CONVERSIONS.ppm_to_wt_percent;
}

/**
 * Convert weight percent to ppm
 */
export function wtPercentToPpm(wtPercentValue: number | null): number | null {
    if (wtPercentValue === null) return null;
    return wtPercentValue * UNIT_CONVERSIONS.wt_percent_to_ppm;
}

/**
 * Convert ppb to ppm
 */
export function ppbToPpm(ppbValue: number | null): number | null {
    if (ppbValue === null) return null;
    return ppbValue * UNIT_CONVERSIONS.ppb_to_ppm;
}

/**
 * Convert ppm to ppb
 */
export function ppmToPpb(ppmValue: number | null): number | null {
    if (ppmValue === null) return null;
    return ppmValue * UNIT_CONVERSIONS.ppm_to_ppb;
}

/**
 * Apply conversion to entire data column
 */
export function applyElementOxideConversion(
    data: Record<string, any>[],
    sourceColumn: string,
    element: string,
    oxide: string,
    direction: 'element-to-oxide' | 'oxide-to-element'
): (number | null)[] {
    return data.map(row => {
        const value = parseNumericValue(row[sourceColumn]);
        if (direction === 'element-to-oxide') {
            return elementToOxide(value, element, oxide);
        } else {
            return oxideToElement(value, oxide, element);
        }
    });
}

/**
 * Generate calculation definitions for all element-oxide conversions
 */
export function generateElementOxideDefinitions(): CalculationDefinition[] {
    const definitions: CalculationDefinition[] = [];

    for (const conv of ELEMENT_OXIDE_CONVERSIONS) {
        // Element to Oxide
        definitions.push({
            id: `${conv.element.toLowerCase()}_to_${conv.oxide.toLowerCase()}`,
            name: `${conv.element} → ${conv.oxide}`,
            category: 'element-oxide',
            description: `Convert ${conv.element} concentration to ${conv.oxide}`,
            formula: null,
            formulaDisplay: `${conv.oxide} = ${conv.element} × ${conv.elementToOxide.toFixed(4)}`,
            inputs: [{
                name: conv.element,
                description: `${conv.element} concentration`,
                required: true,
                unit: 'wt%',
                aliases: COLUMN_PATTERNS[conv.element]?.aliases || [conv.element],
                patterns: COLUMN_PATTERNS[conv.element]?.patterns || [new RegExp(`^${conv.element}$`, 'i')],
            }],
            outputUnit: 'wt%',
            validationRules: [VALIDATION_RULES.nonNegativeValue],
            calculateFn: (inputs) => elementToOxide(inputs[conv.element], conv.element, conv.oxide),
        });

        // Oxide to Element
        definitions.push({
            id: `${conv.oxide.toLowerCase()}_to_${conv.element.toLowerCase()}`,
            name: `${conv.oxide} → ${conv.element}`,
            category: 'oxide-element',
            description: `Convert ${conv.oxide} concentration to ${conv.element}`,
            formula: null,
            formulaDisplay: `${conv.element} = ${conv.oxide} × ${conv.oxideToElement.toFixed(4)}`,
            inputs: [{
                name: conv.oxide,
                description: `${conv.oxide} concentration`,
                required: true,
                unit: 'wt%',
                aliases: COLUMN_PATTERNS[conv.oxide]?.aliases || [conv.oxide],
                patterns: COLUMN_PATTERNS[conv.oxide]?.patterns || [new RegExp(`^${conv.oxide}$`, 'i')],
            }],
            outputUnit: 'wt%',
            validationRules: [VALIDATION_RULES.nonNegativeValue],
            calculateFn: (inputs) => oxideToElement(inputs[conv.oxide], conv.oxide, conv.element),
        });
    }

    // Add iron interconversion definitions
    definitions.push({
        id: 'feo_to_fe2o3',
        name: 'FeO → Fe₂O₃',
        category: 'element-oxide',
        description: 'Convert FeO to Fe₂O₃ equivalent',
        formula: null,
        formulaDisplay: `Fe₂O₃ = FeO × ${IRON_OXIDE_CONVERSIONS.FeO_to_Fe2O3.toFixed(4)}`,
        inputs: [{
            name: 'FeO',
            description: 'FeO concentration (wt%)',
            required: true,
            unit: 'wt%',
            aliases: ['FeO', 'FeO_pct', 'FeO_wt'],
            patterns: [/^feo[^a-z]/i, /^feo$/i],
        }],
        outputUnit: 'wt%',
        validationRules: [VALIDATION_RULES.nonNegativeValue],
        calculateFn: (inputs) => feoToFe2o3(inputs.FeO),
    });

    definitions.push({
        id: 'fe2o3_to_feo',
        name: 'Fe₂O₃ → FeO',
        category: 'element-oxide',
        description: 'Convert Fe₂O₃ to FeO equivalent',
        formula: null,
        formulaDisplay: `FeO = Fe₂O₃ × ${IRON_OXIDE_CONVERSIONS.Fe2O3_to_FeO.toFixed(4)}`,
        inputs: [{
            name: 'Fe2O3',
            description: 'Fe₂O₃ concentration (wt%)',
            required: true,
            unit: 'wt%',
            aliases: ['Fe2O3', 'Fe2O3_pct', 'Fe2O3_wt', 'Fe2O3T'],
            patterns: [/^fe2o3/i],
        }],
        outputUnit: 'wt%',
        validationRules: [VALIDATION_RULES.nonNegativeValue],
        calculateFn: (inputs) => fe2o3ToFeo(inputs.Fe2O3),
    });

    definitions.push({
        id: 'calculate_feot',
        name: 'FeOT (Total Iron as FeO)',
        category: 'element-oxide',
        description: 'Calculate total iron as FeO from FeO and Fe₂O₃',
        formula: null,
        formulaDisplay: 'FeOT = FeO + (Fe₂O₃ × 0.8998)',
        inputs: [
            {
                name: 'FeO',
                description: 'FeO concentration (wt%)',
                required: false,
                unit: 'wt%',
                aliases: ['FeO', 'FeO_pct'],
                patterns: [/^feo$/i],
            },
            {
                name: 'Fe2O3',
                description: 'Fe₂O₃ concentration (wt%)',
                required: false,
                unit: 'wt%',
                aliases: ['Fe2O3', 'Fe2O3_pct'],
                patterns: [/^fe2o3$/i],
            },
        ],
        outputUnit: 'wt%',
        validationRules: [VALIDATION_RULES.nonNegativeValue],
        calculateFn: (inputs) => calculateFeOT(inputs.FeO, inputs.Fe2O3),
    });

    definitions.push({
        id: 'calculate_fe2o3t',
        name: 'Fe₂O₃T (Total Iron as Fe₂O₃)',
        category: 'element-oxide',
        description: 'Calculate total iron as Fe₂O₃ from FeO and Fe₂O₃',
        formula: null,
        formulaDisplay: 'Fe₂O₃T = Fe₂O₃ + (FeO × 1.1113)',
        inputs: [
            {
                name: 'FeO',
                description: 'FeO concentration (wt%)',
                required: false,
                unit: 'wt%',
                aliases: ['FeO', 'FeO_pct'],
                patterns: [/^feo$/i],
            },
            {
                name: 'Fe2O3',
                description: 'Fe₂O₃ concentration (wt%)',
                required: false,
                unit: 'wt%',
                aliases: ['Fe2O3', 'Fe2O3_pct'],
                patterns: [/^fe2o3$/i],
            },
        ],
        outputUnit: 'wt%',
        validationRules: [VALIDATION_RULES.nonNegativeValue],
        calculateFn: (inputs) => calculateFe2O3T(inputs.FeO, inputs.Fe2O3),
    });

    // Unit conversion definitions
    definitions.push({
        id: 'ppm_to_wtpercent',
        name: 'ppm → wt%',
        category: 'element-oxide',
        description: 'Convert concentration from ppm to weight percent',
        formula: null,
        formulaDisplay: 'wt% = ppm × 0.0001',
        inputs: [{
            name: 'value',
            description: 'Concentration in ppm',
            required: true,
            unit: 'ppm',
            aliases: [],
            patterns: [],
        }],
        outputUnit: 'wt%',
        validationRules: [VALIDATION_RULES.nonNegativeValue],
        calculateFn: (inputs) => ppmToWtPercent(inputs.value),
    });

    definitions.push({
        id: 'wtpercent_to_ppm',
        name: 'wt% → ppm',
        category: 'element-oxide',
        description: 'Convert concentration from weight percent to ppm',
        formula: null,
        formulaDisplay: 'ppm = wt% × 10000',
        inputs: [{
            name: 'value',
            description: 'Concentration in wt%',
            required: true,
            unit: 'wt%',
            aliases: [],
            patterns: [],
        }],
        outputUnit: 'ppm',
        validationRules: [VALIDATION_RULES.nonNegativeValue],
        calculateFn: (inputs) => wtPercentToPpm(inputs.value),
    });

    definitions.push({
        id: 'ppb_to_ppm',
        name: 'ppb → ppm',
        category: 'element-oxide',
        description: 'Convert concentration from ppb to ppm',
        formula: null,
        formulaDisplay: 'ppm = ppb × 0.001',
        inputs: [{
            name: 'value',
            description: 'Concentration in ppb',
            required: true,
            unit: 'ppb',
            aliases: [],
            patterns: [],
        }],
        outputUnit: 'ppm',
        validationRules: [VALIDATION_RULES.nonNegativeValue],
        calculateFn: (inputs) => ppbToPpm(inputs.value),
    });

    return definitions;
}

/**
 * Get all available element-oxide conversions for an element
 */
export function getAvailableConversions(element: string): { oxide: string; factor: number }[] {
    return getOxidesForElement(element).map(conv => ({
        oxide: conv.oxide,
        factor: conv.elementToOxide,
    }));
}

/**
 * Auto-detect column type (element vs oxide) from column name
 */
export function detectColumnType(columnName: string): 'element' | 'oxide' | 'unknown' {
    const upperName = columnName.toUpperCase();

    // Check for oxide patterns
    const oxidePatterns = [
        /O2$/i, /O3$/i, /2O$/i, /2O3$/i, /2O5$/i, /3O4$/i,
    ];
    for (const pattern of oxidePatterns) {
        if (pattern.test(upperName)) {
            return 'oxide';
        }
    }

    // Check if it's a pure element symbol
    const elementSymbols = Object.keys(COLUMN_PATTERNS).filter(k =>
        !k.includes('O') || k === 'Co' || k === 'Ho' || k === 'Mo'
    );
    for (const elem of elementSymbols) {
        if (upperName.startsWith(elem.toUpperCase())) {
            return 'element';
        }
    }

    return 'unknown';
}
