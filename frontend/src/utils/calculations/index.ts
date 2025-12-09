// Geochemical Calculations - Main Export

// Types
export * from '../../types/calculations';

// Constants
export * from './constants';

// Formula Parser & Evaluator
export * from './formulaParser';
export * from './formulaEvaluator';

// Validation
export * from './validation';

// Calculation Functions
export * from './unitConversion';
export * from './elementOxide';
export * from './petrochemical';
export * from './weathering';
export * from './reeNormalization';
export * from './explorationRatios';

// Import all definition generators
import { generateUnitConversionCalculations } from './unitConversion';
import { generateElementOxideDefinitions } from './elementOxide';
import { generatePetrochemicalDefinitions } from './petrochemical';
import { generateWeatheringDefinitions } from './weathering';
import { generateREEDefinitions } from './reeNormalization';
import { generateExplorationDefinitions } from './explorationRatios';
import { CalculationDefinition, CalculationCategory } from '../../types/calculations';

/**
 * Get all built-in calculation definitions
 */
export function getAllCalculationDefinitions(): CalculationDefinition[] {
    return [
        ...generateUnitConversionCalculations(),
        ...generateElementOxideDefinitions(),
        ...generatePetrochemicalDefinitions(),
        ...generateWeatheringDefinitions(),
        ...generateREEDefinitions(),
        ...generateExplorationDefinitions(),
    ];
}

/**
 * Get calculation definitions by category
 */
export function getCalculationsByCategory(category: CalculationCategory): CalculationDefinition[] {
    return getAllCalculationDefinitions().filter(calc => calc.category === category);
}

/**
 * Get a specific calculation definition by ID
 */
export function getCalculationById(id: string): CalculationDefinition | undefined {
    return getAllCalculationDefinitions().find(calc => calc.id === id);
}

/**
 * Get all available calculation categories with counts
 */
export function getCalculationCategories(): { category: CalculationCategory; count: number; label: string }[] {
    const categoryLabels: Record<CalculationCategory, string> = {
        'unit-conversion': 'Unit Conversions',
        'element-oxide': 'Element-Oxide Conversions',
        'oxide-element': 'Oxide-Element Conversions',
        'petrochemical-index': 'Petrochemical Indices',
        'weathering-index': 'Weathering Indices',
        'ree-normalization': 'REE Normalization',
        'exploration-ratio': 'Exploration Ratios',
        'custom': 'Custom Formulas',
    };

    const allCalcs = getAllCalculationDefinitions();
    const categories: CalculationCategory[] = [
        'unit-conversion',
        'element-oxide',
        'oxide-element',
        'petrochemical-index',
        'weathering-index',
        'ree-normalization',
        'exploration-ratio',
        'custom',
    ];

    return categories.map(category => ({
        category,
        count: allCalcs.filter(c => c.category === category).length,
        label: categoryLabels[category],
    }));
}

/**
 * Search calculations by name or description
 */
export function searchCalculations(query: string): CalculationDefinition[] {
    const lowerQuery = query.toLowerCase();
    return getAllCalculationDefinitions().filter(calc =>
        calc.name.toLowerCase().includes(lowerQuery) ||
        calc.description.toLowerCase().includes(lowerQuery) ||
        calc.id.toLowerCase().includes(lowerQuery)
    );
}
