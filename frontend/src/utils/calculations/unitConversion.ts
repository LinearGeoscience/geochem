// Unit Conversion Utilities for Geochemical Data
// Handles conversions between ppm, ppb, wt%, ppt, g/t, oz/t, etc.

import { CalculationDefinition, InputDefinition } from '../../types/calculations';

// ============================================
// Unit Type Definitions
// ============================================

export type ConcentrationUnit =
    | 'ppm'      // parts per million (mg/kg, g/t)
    | 'ppb'      // parts per billion (μg/kg)
    | 'ppt'      // parts per trillion (ng/kg)
    | 'wt%'      // weight percent
    | 'g/t'      // grams per tonne (= ppm)
    | 'mg/kg'    // milligrams per kilogram (= ppm)
    | 'μg/g'     // micrograms per gram (= ppm)
    | 'ng/g'     // nanograms per gram (= ppb)
    | 'oz/t'     // troy ounces per short ton
    | 'oz/st'    // troy ounces per short ton (same as oz/t)
    | 'g/100g'   // grams per 100 grams (= wt%)
    | 'mg/L'     // milligrams per liter (for solutions, assumes density ~1)
    | 'μg/L';    // micrograms per liter (for solutions)

// Conversion factors to ppm (base unit)
// All units are converted to ppm first, then to target unit
export const UNIT_TO_PPM: Record<ConcentrationUnit, number> = {
    'ppm': 1,
    'ppb': 0.001,
    'ppt': 0.000001,
    'wt%': 10000,
    'g/t': 1,           // g/t = ppm
    'mg/kg': 1,         // mg/kg = ppm
    'μg/g': 1,          // μg/g = ppm
    'ng/g': 0.001,      // ng/g = ppb
    'oz/t': 34.2857143, // 1 oz/t = 34.2857143 ppm (troy oz per short ton)
    'oz/st': 34.2857143,
    'g/100g': 10000,    // g/100g = wt%
    'mg/L': 1,          // Assumes density of 1 g/mL
    'μg/L': 0.001,      // Assumes density of 1 g/mL
};

// Conversion factors from ppm to other units
export const PPM_TO_UNIT: Record<ConcentrationUnit, number> = {
    'ppm': 1,
    'ppb': 1000,
    'ppt': 1000000,
    'wt%': 0.0001,
    'g/t': 1,
    'mg/kg': 1,
    'μg/g': 1,
    'ng/g': 1000,
    'oz/t': 0.0291667,  // 1 ppm = 0.0291667 oz/t
    'oz/st': 0.0291667,
    'g/100g': 0.0001,
    'mg/L': 1,
    'μg/L': 1000,
};

// ============================================
// Unit Metadata
// ============================================

export interface UnitInfo {
    id: ConcentrationUnit;
    name: string;
    symbol: string;
    category: 'mass' | 'volume' | 'precious';
    description: string;
    equivalentUnits: ConcentrationUnit[];
}

export const UNIT_INFO: Record<ConcentrationUnit, UnitInfo> = {
    'wt%': {
        id: 'wt%',
        name: 'Weight Percent',
        symbol: 'wt%',
        category: 'mass',
        description: 'Parts per hundred by weight (g/100g)',
        equivalentUnits: ['g/100g'],
    },
    'ppm': {
        id: 'ppm',
        name: 'Parts Per Million',
        symbol: 'ppm',
        category: 'mass',
        description: 'Parts per million (mg/kg, g/t, μg/g)',
        equivalentUnits: ['g/t', 'mg/kg', 'μg/g'],
    },
    'ppb': {
        id: 'ppb',
        name: 'Parts Per Billion',
        symbol: 'ppb',
        category: 'mass',
        description: 'Parts per billion (μg/kg, ng/g)',
        equivalentUnits: ['ng/g'],
    },
    'ppt': {
        id: 'ppt',
        name: 'Parts Per Trillion',
        symbol: 'ppt',
        category: 'mass',
        description: 'Parts per trillion (ng/kg)',
        equivalentUnits: [],
    },
    'g/t': {
        id: 'g/t',
        name: 'Grams per Tonne',
        symbol: 'g/t',
        category: 'mass',
        description: 'Grams per metric tonne (= ppm)',
        equivalentUnits: ['ppm', 'mg/kg', 'μg/g'],
    },
    'mg/kg': {
        id: 'mg/kg',
        name: 'Milligrams per Kilogram',
        symbol: 'mg/kg',
        category: 'mass',
        description: 'Milligrams per kilogram (= ppm)',
        equivalentUnits: ['ppm', 'g/t', 'μg/g'],
    },
    'μg/g': {
        id: 'μg/g',
        name: 'Micrograms per Gram',
        symbol: 'μg/g',
        category: 'mass',
        description: 'Micrograms per gram (= ppm)',
        equivalentUnits: ['ppm', 'g/t', 'mg/kg'],
    },
    'ng/g': {
        id: 'ng/g',
        name: 'Nanograms per Gram',
        symbol: 'ng/g',
        category: 'mass',
        description: 'Nanograms per gram (= ppb)',
        equivalentUnits: ['ppb'],
    },
    'oz/t': {
        id: 'oz/t',
        name: 'Troy Ounces per Ton',
        symbol: 'oz/t',
        category: 'precious',
        description: 'Troy ounces per short ton (2000 lb) - used for precious metals',
        equivalentUnits: ['oz/st'],
    },
    'oz/st': {
        id: 'oz/st',
        name: 'Troy Ounces per Short Ton',
        symbol: 'oz/st',
        category: 'precious',
        description: 'Troy ounces per short ton (2000 lb) - same as oz/t',
        equivalentUnits: ['oz/t'],
    },
    'g/100g': {
        id: 'g/100g',
        name: 'Grams per 100 Grams',
        symbol: 'g/100g',
        category: 'mass',
        description: 'Grams per 100 grams (= wt%)',
        equivalentUnits: ['wt%'],
    },
    'mg/L': {
        id: 'mg/L',
        name: 'Milligrams per Liter',
        symbol: 'mg/L',
        category: 'volume',
        description: 'Milligrams per liter (≈ ppm for dilute aqueous solutions)',
        equivalentUnits: [],
    },
    'μg/L': {
        id: 'μg/L',
        name: 'Micrograms per Liter',
        symbol: 'μg/L',
        category: 'volume',
        description: 'Micrograms per liter (≈ ppb for dilute aqueous solutions)',
        equivalentUnits: [],
    },
};

// ============================================
// Conversion Functions
// ============================================

/**
 * Convert a value from one concentration unit to another
 */
export function convertUnits(
    value: number | null,
    fromUnit: ConcentrationUnit,
    toUnit: ConcentrationUnit
): number | null {
    if (value === null || isNaN(value)) return null;

    // Same unit - no conversion needed
    if (fromUnit === toUnit) return value;

    // Convert to ppm first, then to target unit
    const valueInPpm = value * UNIT_TO_PPM[fromUnit];
    const result = valueInPpm * PPM_TO_UNIT[toUnit];

    return result;
}

/**
 * Get the conversion factor between two concentration units
 */
export function getUnitConversionFactor(
    fromUnit: ConcentrationUnit,
    toUnit: ConcentrationUnit
): number {
    if (fromUnit === toUnit) return 1;
    return UNIT_TO_PPM[fromUnit] * PPM_TO_UNIT[toUnit];
}

/**
 * Format a value with appropriate precision for the unit
 */
export function formatValue(value: number | null, unit: ConcentrationUnit): string {
    if (value === null || isNaN(value)) return 'N/A';

    // Determine precision based on unit and magnitude
    let decimals: number;

    if (unit === 'wt%' || unit === 'g/100g') {
        decimals = value < 1 ? 4 : value < 10 ? 3 : 2;
    } else if (unit === 'ppm' || unit === 'g/t' || unit === 'mg/kg' || unit === 'μg/g') {
        decimals = value < 1 ? 3 : value < 100 ? 2 : value < 1000 ? 1 : 0;
    } else if (unit === 'ppb' || unit === 'ng/g' || unit === 'μg/L') {
        decimals = value < 10 ? 2 : value < 100 ? 1 : 0;
    } else if (unit === 'oz/t' || unit === 'oz/st') {
        decimals = 4; // Precious metals typically need high precision
    } else {
        decimals = 3;
    }

    return value.toFixed(decimals);
}

// ============================================
// Calculation Definitions for Unit Conversions
// ============================================

// Standard input definition for a single concentration value
const createConcentrationInput = (_unit: ConcentrationUnit, description: string): InputDefinition => ({
    name: 'value',
    description,
    required: true,
    unit: 'ppm', // Type system uses ppm as catch-all for concentration
    defaultValue: undefined,
    aliases: [],
    patterns: [],
});

/**
 * Create a unit conversion calculation definition
 */
function createUnitConversionCalc(
    fromUnit: ConcentrationUnit,
    toUnit: ConcentrationUnit
): CalculationDefinition {
    const fromInfo = UNIT_INFO[fromUnit];
    const toInfo = UNIT_INFO[toUnit];
    const factor = getUnitConversionFactor(fromUnit, toUnit);

    return {
        id: `convert-${fromUnit}-to-${toUnit}`.replace(/[/%]/g, ''),
        name: `${fromInfo.symbol} → ${toInfo.symbol}`,
        category: 'unit-conversion' as any, // Will add this category
        description: `Convert concentration from ${fromInfo.name} (${fromInfo.symbol}) to ${toInfo.name} (${toInfo.symbol}). Factor: ${factor.toPrecision(6)}`,
        formula: {
            type: 'operation',
            operator: '*',
            operands: [
                { type: 'variable', value: 'value' },
                { type: 'constant', value: factor }
            ]
        },
        formulaDisplay: `value × ${factor.toPrecision(6)}`,
        inputs: [createConcentrationInput(fromUnit, `Input value in ${fromInfo.symbol}`)],
        outputUnit: 'ppm', // Using ppm as generic concentration type
        validationRules: [
            {
                type: 'non-negative',
                errorMessage: 'Concentration values must be non-negative',
                severity: 'error'
            }
        ],
        references: ['Standard unit conversion factors for geochemical analysis'],
    };
}

// ============================================
// Pre-defined Common Conversions
// ============================================

// Most commonly needed conversions in geochemistry
export const COMMON_CONVERSIONS: Array<{ from: ConcentrationUnit; to: ConcentrationUnit }> = [
    // ppm conversions
    { from: 'ppm', to: 'wt%' },
    { from: 'ppm', to: 'ppb' },
    { from: 'ppm', to: 'oz/t' },

    // wt% conversions
    { from: 'wt%', to: 'ppm' },
    { from: 'wt%', to: 'ppb' },

    // ppb conversions
    { from: 'ppb', to: 'ppm' },
    { from: 'ppb', to: 'wt%' },
    { from: 'ppb', to: 'ppt' },

    // ppt conversions
    { from: 'ppt', to: 'ppb' },
    { from: 'ppt', to: 'ppm' },

    // oz/t conversions (precious metals)
    { from: 'oz/t', to: 'ppm' },
    { from: 'oz/t', to: 'g/t' },
    { from: 'g/t', to: 'oz/t' },

    // g/t conversions
    { from: 'g/t', to: 'wt%' },
    { from: 'g/t', to: 'ppb' },
];

/**
 * Generate all common unit conversion calculation definitions
 */
export function generateUnitConversionCalculations(): CalculationDefinition[] {
    return COMMON_CONVERSIONS.map(({ from, to }) => createUnitConversionCalc(from, to));
}

// ============================================
// Quick Reference Table
// ============================================

export const CONVERSION_QUICK_REFERENCE = `
Unit Conversion Quick Reference:
═══════════════════════════════════════════════════════════════

Mass Concentration Units:
  1 wt%     = 10,000 ppm = 10,000,000 ppb
  1 ppm    = 0.0001 wt% = 1,000 ppb = 1 g/t = 1 mg/kg = 1 μg/g
  1 ppb    = 0.001 ppm = 0.0000001 wt% = 1 ng/g
  1 ppt    = 0.001 ppb = 0.000001 ppm

Precious Metal Units:
  1 oz/t   = 34.2857 ppm = 34.2857 g/t
  1 ppm    = 0.0291667 oz/t
  1 g/t    = 1 ppm

Equivalent Units:
  ppm = g/t = mg/kg = μg/g (parts per million)
  ppb = ng/g (parts per billion)
  wt% = g/100g (weight percent)
  oz/t = oz/st (troy ounces per short ton)
`;

/**
 * Get all available units grouped by category
 */
export function getUnitsByCategory(): Record<string, UnitInfo[]> {
    const categories: Record<string, UnitInfo[]> = {
        'Mass Concentration': [],
        'Precious Metals': [],
        'Volume Concentration': [],
    };

    Object.values(UNIT_INFO).forEach(info => {
        if (info.category === 'mass') {
            categories['Mass Concentration'].push(info);
        } else if (info.category === 'precious') {
            categories['Precious Metals'].push(info);
        } else if (info.category === 'volume') {
            categories['Volume Concentration'].push(info);
        }
    });

    return categories;
}

/**
 * Suggest the most appropriate output unit based on the input value and unit
 */
export function suggestOutputUnit(value: number, inputUnit: ConcentrationUnit): ConcentrationUnit {
    const valueInPpm = value * UNIT_TO_PPM[inputUnit];

    // Suggest unit based on magnitude for readability
    if (valueInPpm >= 10000) {
        return 'wt%';
    } else if (valueInPpm >= 1) {
        return 'ppm';
    } else if (valueInPpm >= 0.001) {
        return 'ppb';
    } else {
        return 'ppt';
    }
}
