/**
 * Classification Axis Resolver
 *
 * Resolves diagram variables to data columns using geochem mappings,
 * handles element↔oxide conversions and molar unit transforms,
 * and computes compound axis values (e.g., Na2O+K2O, alteration indices).
 */

import { ClassificationDiagram, DiagramVariable } from '../types/classificationDiagram';
import { ColumnGeochemMapping } from '../types/associations';
import { findColumnForOxide, findColumnForElement, OXIDE_MAPPINGS } from './calculations/elementNameNormalizer';
import { ELEMENT_OXIDE_CONVERSIONS, OXIDE_WEIGHTS, UNIT_CONVERSIONS } from './calculations/constants';
import { parseFormula } from './calculations/formulaParser';
import { evaluateFormula, parseNumericValue } from './calculations/formulaEvaluator';
import { FormulaExpression } from '../types/calculations';

// ============================================================================
// TYPES
// ============================================================================

export interface ResolvedVariable {
    letter: string;
    element: string;
    unit: string;
    resolvedColumn: string | null;
    conversionType: 'none' | 'element-to-oxide' | 'oxide-to-element' | 'unit' | 'molar';
    conversionFactor: number;
    status: 'matched' | 'converted' | 'missing';
    conversionDescription?: string;
}

export interface AxisResolution {
    axisKey: string;
    formula: string | null;
    axisName: string;
    variables: ResolvedVariable[];
    isComputed: boolean;
    isFullyResolved: boolean;
    singleColumn: string | null;
    parsedFormula?: FormulaExpression;
}

export interface DiagramResolution {
    axes: Record<string, AxisResolution>;
    matchedCount: number;
    totalVariables: number;
}

// ============================================================================
// VARIABLE RESOLUTION
// ============================================================================

/**
 * Clean element name: strip trailing * markers (e.g., "FeO*" → "FeO")
 */
function cleanElementName(element: string): string {
    return element.replace(/\*$/, '');
}

/**
 * Check if a string is a known oxide formula
 */
function isKnownOxide(name: string): boolean {
    return name in OXIDE_MAPPINGS || name in OXIDE_WEIGHTS;
}

/**
 * Extract the base element from a molar variable name like "Na-mol" → "Na"
 */
function parseMolarElement(element: string): string | null {
    const match = element.match(/^([A-Z][a-z]?)-mol$/i);
    return match ? match[1] : null;
}

/**
 * Get the primary oxide for an element (e.g., "Na" → "Na2O", "Fe" → "FeO")
 */
function getPrimaryOxide(element: string): string | null {
    const conv = ELEMENT_OXIDE_CONVERSIONS.find(
        c => c.element.toLowerCase() === element.toLowerCase()
    );
    return conv?.oxide ?? null;
}

/**
 * Resolve a single diagram variable to a data column.
 */
export function resolveVariable(
    variable: DiagramVariable,
    geochemMappings: ColumnGeochemMapping[],
    columnNames: string[]
): ResolvedVariable {
    const result: ResolvedVariable = {
        letter: variable.letter,
        element: variable.element,
        unit: variable.unit,
        resolvedColumn: null,
        conversionType: 'none',
        conversionFactor: 1.0,
        status: 'missing',
    };

    const cleaned = cleanElementName(variable.element);

    // --- Case 1: Molar variable (e.g., "Na-mol", "Al-mol") ---
    const molarEl = parseMolarElement(cleaned);
    if (molarEl) {
        // Find the oxide column for this element and convert to molar
        const oxide = getPrimaryOxide(molarEl);
        if (oxide) {
            const col = findColumnForOxide(geochemMappings, oxide);
            if (col && columnNames.includes(col)) {
                const mw = OXIDE_WEIGHTS[oxide];
                if (mw) {
                    result.resolvedColumn = col;
                    result.conversionType = 'molar';
                    // wt% → mol/kg: divide by MW, multiply by 10 (since wt% = g/100g, mol/kg = mol/1000g)
                    result.conversionFactor = 10 / mw;
                    result.status = 'converted';
                    result.conversionDescription = `${oxide} wt% → mol/kg (÷${mw.toFixed(2)} ×10)`;
                    return result;
                }
            }
            // Fallback: try element column directly
            const elCol = findColumnForElement(geochemMappings, molarEl);
            if (elCol && columnNames.includes(elCol)) {
                // Element in ppm: convert ppm → mol/kg
                // ppm = mg/kg, mol/kg = (mg/kg) / (g/mol * 1000 mg/g) = ppm / (AW * 1000)
                const aw = getAtomicWeight(molarEl);
                if (aw) {
                    result.resolvedColumn = elCol;
                    result.conversionType = 'molar';
                    result.conversionFactor = 1 / (aw * 1000);
                    result.status = 'converted';
                    result.conversionDescription = `${molarEl} ppm → mol/kg`;
                    return result;
                }
            }
        }
        return result; // missing
    }

    // --- Case 2: Known oxide (e.g., "SiO2", "K2O") ---
    if (isKnownOxide(cleaned)) {
        // Direct oxide column match
        const col = findColumnForOxide(geochemMappings, cleaned);
        if (col && columnNames.includes(col)) {
            // Check if column unit differs from diagram variable unit
            const colUnit = getColumnUnit(geochemMappings, col);
            if (colUnit && variable.unit && colUnit !== variable.unit) {
                const unitFactor = getSimpleUnitFactor(colUnit, variable.unit);
                if (unitFactor !== 1.0) {
                    result.resolvedColumn = col;
                    result.conversionType = 'unit';
                    result.conversionFactor = unitFactor;
                    result.status = 'converted';
                    result.conversionDescription = `${cleaned} ${colUnit} → ${variable.unit} (×${unitFactor})`;
                    return result;
                }
            }
            result.resolvedColumn = col;
            result.conversionType = 'none';
            result.conversionFactor = 1.0;
            result.status = 'matched';
            return result;
        }

        // Fallback: try element column with conversion factor
        const baseElement = OXIDE_MAPPINGS[cleaned];
        if (baseElement) {
            const elCol = findColumnForElement(geochemMappings, baseElement);
            if (elCol && columnNames.includes(elCol)) {
                const conv = ELEMENT_OXIDE_CONVERSIONS.find(
                    c => c.element === baseElement && c.oxide === cleaned
                );
                if (conv) {
                    // Check if element is in ppm (need ppm → wt% first)
                    const mapping = geochemMappings.find(m => m.originalName === elCol);
                    const elUnit = mapping?.userUnit ?? mapping?.detectedUnit ?? 'ppm';

                    let factor = conv.elementToOxide;
                    if (elUnit === 'ppm' && variable.unit === 'pct') {
                        factor *= UNIT_CONVERSIONS.ppm_to_wt_percent;
                    }

                    result.resolvedColumn = elCol;
                    result.conversionType = 'element-to-oxide';
                    result.conversionFactor = factor;
                    result.status = 'converted';
                    result.conversionDescription = `${baseElement} → ${cleaned} (×${factor.toFixed(4)})`;
                    return result;
                }
            }
        }

        // Final fallback: case-insensitive column name match
        const lowerOxide = cleaned.toLowerCase();
        const fallback = columnNames.find(col =>
            col.toLowerCase() === lowerOxide ||
            col.toLowerCase().startsWith(lowerOxide + '_') ||
            col.toLowerCase().startsWith(lowerOxide + ' ')
        );
        if (fallback) {
            result.resolvedColumn = fallback;
            result.conversionType = 'none';
            result.conversionFactor = 1.0;
            result.status = 'matched';
            return result;
        }

        return result; // missing
    }

    // --- Case 3: Pure element or unknown name ---
    // Try element column directly
    const elCol = findColumnForElement(geochemMappings, cleaned);
    if (elCol && columnNames.includes(elCol)) {
        // Check if column unit differs from diagram variable unit
        const colUnit = getColumnUnit(geochemMappings, elCol);
        if (colUnit && variable.unit && colUnit !== variable.unit) {
            const unitFactor = getSimpleUnitFactor(colUnit, variable.unit);
            if (unitFactor !== 1.0) {
                result.resolvedColumn = elCol;
                result.conversionType = 'unit';
                result.conversionFactor = unitFactor;
                result.status = 'converted';
                result.conversionDescription = `${cleaned} ${colUnit} → ${variable.unit} (×${unitFactor})`;
                return result;
            }
        }
        result.resolvedColumn = elCol;
        result.conversionType = 'none';
        result.conversionFactor = 1.0;
        result.status = 'matched';
        return result;
    }

    // Try oxide column and convert oxide → element
    const oxide = getPrimaryOxide(cleaned);
    if (oxide) {
        const oxCol = findColumnForOxide(geochemMappings, oxide);
        if (oxCol && columnNames.includes(oxCol)) {
            const conv = ELEMENT_OXIDE_CONVERSIONS.find(
                c => c.element === cleaned && c.oxide === oxide
            );
            if (conv) {
                let factor = conv.oxideToElement;
                let description = `${oxide} → ${cleaned} (×${conv.oxideToElement.toFixed(4)})`;

                // Also check if column unit differs from variable unit
                const oxColUnit = getColumnUnit(geochemMappings, oxCol);
                if (oxColUnit && variable.unit && oxColUnit !== variable.unit) {
                    const unitFactor = getSimpleUnitFactor(oxColUnit, variable.unit);
                    if (unitFactor !== 1.0) {
                        factor *= unitFactor;
                        description = `${oxide} ${oxColUnit} → ${cleaned} ${variable.unit} (×${factor.toFixed(4)})`;
                    }
                }

                result.resolvedColumn = oxCol;
                result.conversionType = 'oxide-to-element';
                result.conversionFactor = factor;
                result.status = 'converted';
                result.conversionDescription = description;
                return result;
            }
        }
    }

    // Final fallback: case-insensitive column name match
    const lowerName = cleaned.toLowerCase();
    const fallback = columnNames.find(col =>
        col.toLowerCase() === lowerName ||
        col.toLowerCase().startsWith(lowerName + '_') ||
        col.toLowerCase().startsWith(lowerName + ' ')
    );
    if (fallback) {
        result.resolvedColumn = fallback;
        result.conversionType = 'none';
        result.conversionFactor = 1.0;
        result.status = 'matched';
        return result;
    }

    return result; // missing
}

/**
 * Get atomic weight for an element symbol
 */
function getAtomicWeight(symbol: string): number | null {
    // Import from constants would be circular, so inline the common ones
    const weights: Record<string, number> = {
        Na: 22.990, K: 39.098, Ca: 40.078, Mg: 24.305, Al: 26.982,
        Fe: 55.845, Si: 28.086, Ti: 47.867, Mn: 54.938, P: 30.974,
        Cr: 51.996, Ni: 58.693, Ba: 137.327, Sr: 87.620, Cu: 63.546,
        Zn: 65.380, S: 32.065, C: 12.011, H: 1.008,
    };
    return weights[symbol] ?? null;
}

/**
 * Get a simple unit conversion factor between two units (pct, ppm, ppb).
 * Returns 1.0 if units match or are unrecognized.
 */
function getSimpleUnitFactor(fromUnit: string, toUnit: string): number {
    if (fromUnit === toUnit) return 1.0;
    const key = `${fromUnit}_to_${toUnit}`;
    const map: Record<string, number> = {
        'pct_to_ppm': UNIT_CONVERSIONS.wt_percent_to_ppm,      // 10000
        'ppm_to_pct': UNIT_CONVERSIONS.ppm_to_wt_percent,      // 0.0001
        'ppb_to_ppm': UNIT_CONVERSIONS.ppb_to_ppm,             // 0.001
        'ppm_to_ppb': UNIT_CONVERSIONS.ppm_to_ppb,             // 1000
        'ppb_to_pct': UNIT_CONVERSIONS.ppb_to_wt_percent,      // 0.0000001
        'pct_to_ppb': UNIT_CONVERSIONS.wt_percent_to_ppb,      // 10000000
    };
    return map[key] ?? 1.0;
}

/**
 * Get the effective unit string for a column from its geochem mapping.
 */
function getColumnUnit(geochemMappings: ColumnGeochemMapping[], columnName: string): string | null {
    const mapping = geochemMappings.find(m => m.originalName === columnName);
    return mapping?.userUnit ?? mapping?.detectedUnit ?? null;
}

// ============================================================================
// DIAGRAM RESOLUTION
// ============================================================================

/**
 * Resolve all axes in a diagram to data columns and computed formulas.
 */
export function resolveDiagram(
    diagram: ClassificationDiagram,
    geochemMappings: ColumnGeochemMapping[],
    columnNames: string[]
): DiagramResolution {
    const axes: Record<string, AxisResolution> = {};
    let matchedCount = 0;
    let totalVariables = 0;

    const diagramVars = diagram.variables ?? [];

    // Determine which axis keys to process
    const axisKeys = diagram.type === 'ternary'
        ? ['a', 'b', 'c'] as const
        : ['x', 'y'] as const;

    for (const key of axisKeys) {
        const axisConfig = diagram.axes[key];
        if (!axisConfig) {
            axes[key] = {
                axisKey: key,
                formula: null,
                axisName: key.toUpperCase(),
                variables: [],
                isComputed: false,
                isFullyResolved: false,
                singleColumn: null,
            };
            continue;
        }

        const formula = axisConfig.formula?.trim() || null;
        const axisName = axisConfig.name || key.toUpperCase();

        if (!formula || diagramVars.length === 0) {
            // No formula or no variables: try resolving the axis name itself as an element/oxide
            const syntheticVar: DiagramVariable = { letter: axisName, element: axisName, unit: 'pct' };
            const resolved = resolveVariable(syntheticVar, geochemMappings, columnNames);
            if (resolved.status !== 'missing' && resolved.resolvedColumn) {
                totalVariables += 1;
                matchedCount += 1;
                axes[key] = {
                    axisKey: key,
                    formula,
                    axisName,
                    variables: [resolved],
                    isComputed: false,
                    isFullyResolved: true,
                    singleColumn: resolved.resolvedColumn,
                };
                continue;
            }
            // Could not resolve axis name: manual column selection needed
            axes[key] = {
                axisKey: key,
                formula,
                axisName,
                variables: [],
                isComputed: false,
                isFullyResolved: false,
                singleColumn: null,
            };
            continue;
        }

        // Find which variable letters are used in this formula
        const usedVars = findUsedVariables(formula, diagramVars);
        const resolvedVars = usedVars.map(v => resolveVariable(v, geochemMappings, columnNames));

        totalVariables += resolvedVars.length;
        matchedCount += resolvedVars.filter(v => v.status !== 'missing').length;

        const isFullyResolved = resolvedVars.length > 0 && resolvedVars.every(v => v.status !== 'missing');

        // Check if formula is a single variable (no operators)
        const isSingleVar = resolvedVars.length === 1 && isSingleVariableFormula(formula, resolvedVars[0].letter);

        // If single-var but needs unit conversion, route through computed path
        const needsConversion = isSingleVar && isFullyResolved && resolvedVars[0].conversionFactor !== 1.0;

        let parsedFormula: FormulaExpression | undefined;
        if ((!isSingleVar || needsConversion) && isFullyResolved) {
            try {
                parsedFormula = parseFormula(formula);
            } catch {
                // Formula parsing failed - fall back to manual
            }
        }

        axes[key] = {
            axisKey: key,
            formula,
            axisName,
            variables: resolvedVars,
            isComputed: (!isSingleVar || needsConversion) && resolvedVars.length > 0,
            isFullyResolved,
            singleColumn: isSingleVar && isFullyResolved && !needsConversion ? resolvedVars[0].resolvedColumn : null,
            parsedFormula,
        };
    }

    return { axes, matchedCount, totalVariables };
}

/**
 * Find which diagram variables are referenced in a formula string.
 * Match longer letter keys first (e.g., "FE" before "F").
 */
function findUsedVariables(formula: string, variables: DiagramVariable[]): DiagramVariable[] {
    const formulaLower = formula.toLowerCase();
    // Sort by letter length descending so "FE" is matched before "F"
    const sorted = [...variables].sort((a, b) => b.letter.length - a.letter.length);

    const used: DiagramVariable[] = [];
    for (const v of sorted) {
        const letterLower = v.letter.toLowerCase();
        // Check if letter appears in formula as a standalone token
        // (not part of a longer identifier)
        const regex = new RegExp(`(?<![a-z])${escapeRegex(letterLower)}(?![a-z])`, 'i');
        if (regex.test(formulaLower)) {
            used.push(v);
        }
    }
    return used;
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Check if a formula is just a single variable reference.
 * e.g., formula "s" with letter "S" → true
 *       formula "k+n" → false
 */
function isSingleVariableFormula(formula: string, letter: string): boolean {
    return formula.trim().toLowerCase() === letter.toLowerCase();
}

// ============================================================================
// COMPUTED VALUES
// ============================================================================

/**
 * Compute axis values for a computed (compound formula) axis.
 */
export function computeAxisValues(
    axisResolution: AxisResolution,
    displayData: Record<string, any>[]
): (number | null)[] {
    if (!axisResolution.isComputed || !axisResolution.isFullyResolved || !axisResolution.formula) {
        return [];
    }

    // Parse the formula if not already parsed
    let ast = axisResolution.parsedFormula;
    if (!ast) {
        try {
            ast = parseFormula(axisResolution.formula);
        } catch {
            return displayData.map(() => null);
        }
    }

    return displayData.map(row => {
        const variables: Record<string, number | null> = {};

        for (const rv of axisResolution.variables) {
            if (!rv.resolvedColumn) {
                variables[rv.letter.toLowerCase()] = null;
                continue;
            }

            const rawVal = parseNumericValue(row[rv.resolvedColumn]);
            if (rawVal === null) {
                variables[rv.letter.toLowerCase()] = null;
            } else {
                variables[rv.letter.toLowerCase()] = rawVal * rv.conversionFactor;
            }
        }

        return evaluateFormula(ast!, variables);
    });
}
