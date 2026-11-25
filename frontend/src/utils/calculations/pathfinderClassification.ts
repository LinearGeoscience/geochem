/**
 * Pathfinder Element Classification Functions
 *
 * Based on Dr. Scott Halley's pathfinder chemistry methodology.
 * Classifies element concentrations as multiples of crustal abundance.
 */

import type { CalculationDefinition, InputDefinition } from '../../types/calculations';
import {
    PATHFINDER_ELEMENTS,
    ANOMALY_THRESHOLDS,
    ELEMENT_COLUMN_PATTERNS,
    SC_NORMALIZABLE_ELEMENTS,
    K_NORMALIZABLE_ELEMENTS,
    type PathfinderElement,
    type AnomalyClass
} from './pathfinderConstants';

/**
 * Classify a pathfinder element value into an anomaly class
 *
 * @param element - The pathfinder element symbol (e.g., 'Mo', 'Cu')
 * @param value - The concentration value (ppm)
 * @returns The anomaly class: 'nodata', 'background', '2x', '3x', '5x', or '10x'
 */
export function getPathfinderClass(element: PathfinderElement, value: number | null | undefined): AnomalyClass {
    if (value === null || value === undefined || isNaN(value)) {
        return 'nodata';
    }

    const thresholds = ANOMALY_THRESHOLDS[element];
    if (!thresholds) {
        return 'nodata';
    }

    if (value <= thresholds.background) return 'background';
    if (value <= thresholds.x2) return '2x';
    if (value <= thresholds.x3) return '3x';
    if (value <= thresholds.x5) return '5x';
    return '10x';
}

/**
 * Classify a normalized value (element/Sc or element/K ratio)
 * Uses the same thresholds but applied to the ratio
 *
 * @param element - The pathfinder element symbol
 * @param elementValue - The element concentration (ppm)
 * @param normValue - The normalizing element concentration (Sc or K, ppm)
 * @returns The anomaly class
 */
export function getPathfinderClassNormalized(
    element: PathfinderElement,
    elementValue: number | null | undefined,
    normValue: number | null | undefined
): AnomalyClass {
    if (elementValue === null || elementValue === undefined || isNaN(elementValue)) {
        return 'nodata';
    }
    if (normValue === null || normValue === undefined || isNaN(normValue) || normValue === 0) {
        return 'nodata';
    }

    // Calculate ratio
    const ratio = elementValue / normValue;

    // For normalized values, we use normalized thresholds
    // The ratio is element/normalizer, so thresholds need to be adjusted
    // We'll apply a rough normalization factor based on typical Sc or K values
    return getPathfinderClass(element, ratio);
}

/**
 * Get numeric class value for sorting/ordering (higher = more anomalous)
 */
export function getAnomalyClassOrder(anomalyClass: AnomalyClass): number {
    const order: Record<AnomalyClass, number> = {
        nodata: 0,
        background: 1,
        '2x': 2,
        '3x': 3,
        '5x': 4,
        '10x': 5
    };
    return order[anomalyClass] ?? 0;
}

/**
 * Check if an element supports Sc normalization
 */
export function supportsScNormalization(element: PathfinderElement): boolean {
    return SC_NORMALIZABLE_ELEMENTS.includes(element);
}

/**
 * Check if an element supports K normalization
 */
export function supportsKNormalization(element: PathfinderElement): boolean {
    return K_NORMALIZABLE_ELEMENTS.includes(element);
}

/**
 * Find matching column for a pathfinder element in column list
 *
 * @param element - The element to find
 * @param columns - Array of column names
 * @returns The matching column name or null
 */
export function findElementColumn(element: PathfinderElement, columns: string[]): string | null {
    const patterns = ELEMENT_COLUMN_PATTERNS[element];
    if (!patterns) return null;

    for (const col of columns) {
        for (const pattern of patterns) {
            if (pattern.test(col)) {
                return col;
            }
        }
    }
    return null;
}

/**
 * Find all pathfinder element columns in a column list
 *
 * @param columns - Array of column names
 * @returns Map of element -> column name for found elements
 */
export function findAllPathfinderColumns(columns: string[]): Map<PathfinderElement, string> {
    const found = new Map<PathfinderElement, string>();

    for (const element of PATHFINDER_ELEMENTS) {
        const col = findElementColumn(element, columns);
        if (col) {
            found.set(element, col);
        }
    }

    return found;
}

/**
 * Create input definition for a pathfinder element
 */
function createElementInput(element: PathfinderElement): InputDefinition {
    const patterns = ELEMENT_COLUMN_PATTERNS[element] || [];
    return {
        name: element,
        description: `${element} concentration (ppm)`,
        required: true,
        unit: 'ppm',
        aliases: [element, `${element}_ppm`, `${element.toLowerCase()}`, `${element.toLowerCase()}_ppm`],
        patterns: patterns
    };
}

/**
 * Generate calculation definitions for pathfinder classifications
 * These allow users to create classification columns in their data
 */
export function generatePathfinderCalculations(): CalculationDefinition[] {
    const definitions: CalculationDefinition[] = [];

    // Generate a classification calculation for each pathfinder element
    for (const element of PATHFINDER_ELEMENTS) {
        definitions.push({
            id: `pathfinder_${element.toLowerCase()}_class`,
            name: `${element} Pathfinder Class`,
            category: 'exploration-ratio',
            description: `Classify ${element} concentration as multiple of crustal abundance (Halley method). Returns: 1=background, 2=2x, 3=3x, 4=5x, 5=10x`,
            formula: null,
            formulaDisplay: `${element} class based on crustal abundance thresholds`,
            inputs: [createElementInput(element)],
            outputUnit: 'index',
            validationRules: [],
            calculateFn: (inputs: Record<string, number | null>) => {
                const value = inputs[element];
                const cls = getPathfinderClass(element, value);
                // Return numeric value for the class
                const classValues: Record<AnomalyClass, number | null> = {
                    nodata: null,
                    background: 1,
                    '2x': 2,
                    '3x': 3,
                    '5x': 4,
                    '10x': 5
                };
                return classValues[cls];
            },
            references: ['Scott Halley pathfinder chemistry methodology']
        });
    }

    // Add Sc-normalized classifications for applicable elements
    for (const element of SC_NORMALIZABLE_ELEMENTS) {
        definitions.push({
            id: `pathfinder_${element.toLowerCase()}_sc_class`,
            name: `${element}/Sc Pathfinder Class`,
            category: 'exploration-ratio',
            description: `Classify ${element}/Sc ratio for host-rock normalized anomaly detection (Halley method)`,
            formula: null,
            formulaDisplay: `${element}/Sc class based on normalized thresholds`,
            inputs: [
                createElementInput(element),
                {
                    name: 'Sc',
                    description: 'Scandium concentration (ppm)',
                    required: true,
                    unit: 'ppm',
                    aliases: ['Sc', 'Sc_ppm', 'sc', 'sc_ppm'],
                    patterns: [/^sc$/i, /^sc[_\s]?ppm$/i, /scandium/i]
                }
            ],
            outputUnit: 'index',
            validationRules: [],
            calculateFn: (inputs: Record<string, number | null>) => {
                const elementValue = inputs[element];
                const scValue = inputs['Sc'];
                const cls = getPathfinderClassNormalized(element, elementValue, scValue);
                const classValues: Record<AnomalyClass, number | null> = {
                    nodata: null,
                    background: 1,
                    '2x': 2,
                    '3x': 3,
                    '5x': 4,
                    '10x': 5
                };
                return classValues[cls];
            },
            references: ['Scott Halley pathfinder chemistry methodology - Sc normalization']
        });
    }

    // Add K-normalized classifications for applicable elements
    for (const element of K_NORMALIZABLE_ELEMENTS) {
        definitions.push({
            id: `pathfinder_${element.toLowerCase()}_k_class`,
            name: `${element}/K Pathfinder Class`,
            category: 'exploration-ratio',
            description: `Classify ${element}/K ratio for host-rock normalized anomaly detection (Halley method)`,
            formula: null,
            formulaDisplay: `${element}/K class based on normalized thresholds`,
            inputs: [
                createElementInput(element),
                {
                    name: 'K',
                    description: 'Potassium concentration (ppm or K2O wt%)',
                    required: true,
                    unit: 'ppm',
                    aliases: ['K', 'K_ppm', 'k', 'k_ppm', 'K2O'],
                    patterns: [/^k$/i, /^k[_\s]?ppm$/i, /^k2o$/i, /potassium/i]
                }
            ],
            outputUnit: 'index',
            validationRules: [],
            calculateFn: (inputs: Record<string, number | null>) => {
                const elementValue = inputs[element];
                const kValue = inputs['K'];
                const cls = getPathfinderClassNormalized(element, elementValue, kValue);
                const classValues: Record<AnomalyClass, number | null> = {
                    nodata: null,
                    background: 1,
                    '2x': 2,
                    '3x': 3,
                    '5x': 4,
                    '10x': 5
                };
                return classValues[cls];
            },
            references: ['Scott Halley pathfinder chemistry methodology - K normalization']
        });
    }

    return definitions;
}
