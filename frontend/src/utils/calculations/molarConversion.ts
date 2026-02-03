// Molar Conversion Utilities for Geochemical Data
// Handles conversions between ppm, wt%, ppb and moles/kg

import { CalculationDefinition, InputDefinition } from '../../types/calculations';
import { ATOMIC_WEIGHTS, OXIDE_WEIGHTS } from './constants';

// ============================================
// Molar Conversion Functions
// ============================================

/**
 * Convert ppm to moles per kg
 * ppm = mg/kg, so to get mol/kg: (mg/kg) / (g/mol * 1000 mg/g) = mol/kg
 * Simplified: ppm / (MW * 1000) = mol/kg, or ppm / MW / 1000
 */
export function ppmToMolesPerKg(ppm: number | null, molecularWeight: number): number | null {
    if (ppm === null || molecularWeight <= 0) return null;
    return ppm / (molecularWeight * 1000);
}

/**
 * Convert moles per kg to ppm
 */
export function molesPerKgToPpm(molPerKg: number | null, molecularWeight: number): number | null {
    if (molPerKg === null || molecularWeight <= 0) return null;
    return molPerKg * molecularWeight * 1000;
}

/**
 * Convert wt% to moles per 100g (common for oxide calculations)
 * wt% = g/100g, so mol/100g = (g/100g) / (g/mol) = wt% / MW
 */
export function wtPercentToMolesPer100g(wtPercent: number | null, molecularWeight: number): number | null {
    if (wtPercent === null || molecularWeight <= 0) return null;
    return wtPercent / molecularWeight;
}

/**
 * Convert moles per 100g to wt%
 */
export function molesPer100gToWtPercent(molPer100g: number | null, molecularWeight: number): number | null {
    if (molPer100g === null || molecularWeight <= 0) return null;
    return molPer100g * molecularWeight;
}

/**
 * Convert ppb to moles per kg
 * ppb = μg/kg = 0.001 mg/kg = 0.001 ppm
 */
export function ppbToMolesPerKg(ppb: number | null, molecularWeight: number): number | null {
    if (ppb === null || molecularWeight <= 0) return null;
    return ppb / (molecularWeight * 1000000); // ppb / (MW * 1e6)
}

/**
 * Convert moles per kg to ppb
 */
export function molesPerKgToPpb(molPerKg: number | null, molecularWeight: number): number | null {
    if (molPerKg === null || molecularWeight <= 0) return null;
    return molPerKg * molecularWeight * 1000000;
}

// ============================================
// Get Molecular Weight Helpers
// ============================================

/**
 * Get molecular weight for an element or oxide
 */
export function getMolecularWeight(species: string): number | null {
    // Check if it's an oxide first
    if (OXIDE_WEIGHTS[species]) {
        return OXIDE_WEIGHTS[species];
    }
    // Check if it's an element
    if (ATOMIC_WEIGHTS[species]) {
        return ATOMIC_WEIGHTS[species];
    }
    // Try case-insensitive match
    const upperSpecies = species.toUpperCase();
    for (const [key, value] of Object.entries(OXIDE_WEIGHTS)) {
        if (key.toUpperCase() === upperSpecies) return value;
    }
    for (const [key, value] of Object.entries(ATOMIC_WEIGHTS)) {
        if (key.toUpperCase() === upperSpecies) return value;
    }
    return null;
}

// ============================================
// Calculation Definitions for Molar Conversions
// ============================================

// Common elements for molar conversion (those typically measured in ppm)
const ELEMENTS_FOR_MOLAR: Array<{ symbol: string; name: string }> = [
    { symbol: 'Cu', name: 'Copper' },
    { symbol: 'Zn', name: 'Zinc' },
    { symbol: 'Pb', name: 'Lead' },
    { symbol: 'Ni', name: 'Nickel' },
    { symbol: 'Co', name: 'Cobalt' },
    { symbol: 'Cr', name: 'Chromium' },
    { symbol: 'As', name: 'Arsenic' },
    { symbol: 'Sb', name: 'Antimony' },
    { symbol: 'Au', name: 'Gold' },
    { symbol: 'Ag', name: 'Silver' },
    { symbol: 'Mn', name: 'Manganese' },
    { symbol: 'V', name: 'Vanadium' },
    { symbol: 'Ba', name: 'Barium' },
    { symbol: 'Sr', name: 'Strontium' },
    { symbol: 'Rb', name: 'Rubidium' },
    { symbol: 'Y', name: 'Yttrium' },
    { symbol: 'Zr', name: 'Zirconium' },
    { symbol: 'Nb', name: 'Niobium' },
    { symbol: 'Mo', name: 'Molybdenum' },
    { symbol: 'W', name: 'Tungsten' },
    { symbol: 'Sn', name: 'Tin' },
    { symbol: 'Bi', name: 'Bismuth' },
    { symbol: 'Th', name: 'Thorium' },
    { symbol: 'U', name: 'Uranium' },
    // REE
    { symbol: 'La', name: 'Lanthanum' },
    { symbol: 'Ce', name: 'Cerium' },
    { symbol: 'Pr', name: 'Praseodymium' },
    { symbol: 'Nd', name: 'Neodymium' },
    { symbol: 'Sm', name: 'Samarium' },
    { symbol: 'Eu', name: 'Europium' },
    { symbol: 'Gd', name: 'Gadolinium' },
    { symbol: 'Tb', name: 'Terbium' },
    { symbol: 'Dy', name: 'Dysprosium' },
    { symbol: 'Ho', name: 'Holmium' },
    { symbol: 'Er', name: 'Erbium' },
    { symbol: 'Tm', name: 'Thulium' },
    { symbol: 'Yb', name: 'Ytterbium' },
    { symbol: 'Lu', name: 'Lutetium' },
];

// Common oxides for molar conversion (those typically measured in wt%)
const OXIDES_FOR_MOLAR: Array<{ formula: string; name: string }> = [
    { formula: 'SiO2', name: 'Silica' },
    { formula: 'TiO2', name: 'Titanium Dioxide' },
    { formula: 'Al2O3', name: 'Alumina' },
    { formula: 'Fe2O3', name: 'Ferric Oxide' },
    { formula: 'FeO', name: 'Ferrous Oxide' },
    { formula: 'MgO', name: 'Magnesia' },
    { formula: 'CaO', name: 'Calcium Oxide' },
    { formula: 'Na2O', name: 'Sodium Oxide' },
    { formula: 'K2O', name: 'Potassium Oxide' },
    { formula: 'MnO', name: 'Manganese Oxide' },
    { formula: 'P2O5', name: 'Phosphorus Pentoxide' },
    { formula: 'Cr2O3', name: 'Chromium Oxide' },
    { formula: 'NiO', name: 'Nickel Oxide' },
    { formula: 'BaO', name: 'Barium Oxide' },
    { formula: 'ZrO2', name: 'Zirconium Oxide' },
    { formula: 'SO3', name: 'Sulfur Trioxide' },
    { formula: 'H2O', name: 'Water' },
    { formula: 'CO2', name: 'Carbon Dioxide' },
];

/**
 * Create an input definition for molar conversion
 */
function createMolarInput(species: string, unit: 'ppm' | 'wt%' | 'ppb'): InputDefinition {
    return {
        name: 'value',
        description: `${species} concentration in ${unit}`,
        required: true,
        unit: unit === 'wt%' ? 'wt%' : 'ppm',
        defaultValue: undefined,
        aliases: [species, `${species}_${unit.replace('%', 'pct')}`],
        patterns: [new RegExp(`^${species}[_\\s]?(?:${unit.replace('%', '')})?$`, 'i')],
    };
}

/**
 * Generate ppm to mol/kg calculations for elements
 */
function generatePpmToMolarCalculations(): CalculationDefinition[] {
    return ELEMENTS_FOR_MOLAR.map(({ symbol, name }) => {
        const mw = ATOMIC_WEIGHTS[symbol];
        const factor = 1 / (mw * 1000);

        return {
            id: `ppm-to-molkg-${symbol.toLowerCase()}`,
            name: `${symbol} ppm → mol/kg`,
            category: 'unit-conversion' as const,
            description: `Convert ${name} (${symbol}) from ppm to moles per kilogram. MW = ${mw.toFixed(3)} g/mol`,
            formula: {
                type: 'operation',
                operator: '*',
                operands: [
                    { type: 'variable', value: 'value' },
                    { type: 'constant', value: factor }
                ]
            },
            formulaDisplay: `mol/kg = ppm / (MW × 1000) = ppm × ${factor.toExponential(4)}`,
            inputs: [createMolarInput(symbol, 'ppm')],
            outputUnit: 'molar' as const,
            validationRules: [
                {
                    type: 'non-negative',
                    errorMessage: 'Concentration values must be non-negative',
                    severity: 'error' as const
                }
            ],
            references: [`Atomic weight: ${mw.toFixed(3)} g/mol (IUPAC 2021)`],
        };
    });
}

/**
 * Generate wt% to mol/100g calculations for oxides
 */
function generateWtPercentToMolarCalculations(): CalculationDefinition[] {
    return OXIDES_FOR_MOLAR.map(({ formula, name }) => {
        const mw = OXIDE_WEIGHTS[formula];

        return {
            id: `wtpct-to-mol100g-${formula.toLowerCase()}`,
            name: `${formula} wt% → mol/100g`,
            category: 'unit-conversion' as const,
            description: `Convert ${name} (${formula}) from wt% to moles per 100g. MW = ${mw.toFixed(3)} g/mol`,
            formula: {
                type: 'operation',
                operator: '/',
                operands: [
                    { type: 'variable', value: 'value' },
                    { type: 'constant', value: mw }
                ]
            },
            formulaDisplay: `mol/100g = wt% / MW = wt% / ${mw.toFixed(3)}`,
            inputs: [createMolarInput(formula, 'wt%')],
            outputUnit: 'molar' as const,
            validationRules: [
                {
                    type: 'non-negative',
                    errorMessage: 'Concentration values must be non-negative',
                    severity: 'error' as const
                },
                {
                    type: 'range',
                    min: 0,
                    max: 100,
                    errorMessage: 'Weight percent should be between 0 and 100',
                    severity: 'warning' as const
                }
            ],
            references: [`Molecular weight: ${mw.toFixed(3)} g/mol`],
        };
    });
}

/**
 * Generate ppb to mol/kg calculations for precious metals and trace elements
 */
function generatePpbToMolarCalculations(): CalculationDefinition[] {
    const ppbElements = [
        { symbol: 'Au', name: 'Gold' },
        { symbol: 'Pt', name: 'Platinum' },
        { symbol: 'Pd', name: 'Palladium' },
        { symbol: 'Ir', name: 'Iridium' },
        { symbol: 'Rh', name: 'Rhodium' },
        { symbol: 'Ru', name: 'Ruthenium' },
        { symbol: 'Os', name: 'Osmium' },
    ];

    return ppbElements.map(({ symbol, name }) => {
        const mw = ATOMIC_WEIGHTS[symbol];
        if (!mw) return null;
        const factor = 1 / (mw * 1000000);

        return {
            id: `ppb-to-molkg-${symbol.toLowerCase()}`,
            name: `${symbol} ppb → mol/kg`,
            category: 'unit-conversion' as const,
            description: `Convert ${name} (${symbol}) from ppb to moles per kilogram. MW = ${mw.toFixed(3)} g/mol`,
            formula: {
                type: 'operation',
                operator: '*',
                operands: [
                    { type: 'variable', value: 'value' },
                    { type: 'constant', value: factor }
                ]
            },
            formulaDisplay: `mol/kg = ppb / (MW × 1,000,000) = ppb × ${factor.toExponential(4)}`,
            inputs: [createMolarInput(symbol, 'ppb')],
            outputUnit: 'molar' as const,
            validationRules: [
                {
                    type: 'non-negative',
                    errorMessage: 'Concentration values must be non-negative',
                    severity: 'error' as const
                }
            ],
            references: [`Atomic weight: ${mw.toFixed(3)} g/mol (IUPAC 2021)`],
        };
    }).filter((calc): calc is NonNullable<typeof calc> => calc !== null) as CalculationDefinition[];
}

/**
 * Generate all molar conversion calculation definitions
 */
export function generateMolarConversionCalculations(): CalculationDefinition[] {
    return [
        ...generatePpmToMolarCalculations(),
        ...generateWtPercentToMolarCalculations(),
        ...generatePpbToMolarCalculations(),
    ];
}

// ============================================
// Quick Reference
// ============================================

export const MOLAR_CONVERSION_REFERENCE = `
Molar Conversion Quick Reference:
═══════════════════════════════════════════════════════════════

ppm to mol/kg:
  mol/kg = ppm / (MW × 1000)
  (ppm = mg/kg, so mg/kg ÷ g/mol ÷ 1000 = mol/kg)

wt% to mol/100g:
  mol/100g = wt% / MW
  (wt% = g/100g, so g/100g ÷ g/mol = mol/100g)

ppb to mol/kg:
  mol/kg = ppb / (MW × 1,000,000)
  (ppb = μg/kg = 0.001 mg/kg)

Common Molecular Weights:
  Elements: Cu=63.55, Zn=65.38, Pb=207.2, Au=196.97, Ag=107.87
  Oxides: SiO2=60.08, Al2O3=101.96, FeO=71.84, MgO=40.30, CaO=56.08
`;
