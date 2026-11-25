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
import { resolveColumnToPpm } from './calculations/elementColumnResolver';
import { ATOMIC_WEIGHTS, ELEMENT_OXIDE_CONVERSIONS, OXIDE_WEIGHTS, UNIT_CONVERSIONS } from './calculations/constants';
import { parseFormula, extractVariables } from './calculations/formulaParser';
import { compileFormula, runColumn } from './calculations/formulaCompiler';
import { evaluateExpressionChain, planExpressionChain, NamedExpression } from './classification/expressionChain';
import { parseNumericValue } from './calculations/formulaEvaluator';
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
    /** NamedExpression chain the formula depends on. */
    expressions?: NamedExpression[];
    /** variateMode Uni_Nulls_As_Zeros: missing inputs count as 0. */
    nullsAsZero?: boolean;
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

/** Cations per oxide formula unit: Na2O → 2, Al2O3 → 2, SiO2 → 1. */
export function cationsPerOxide(oxide: string): number {
    const m = /^[A-Z][a-z]?(\d*)/.exec(oxide);
    return m && m[1] ? parseInt(m[1], 10) : 1;
}

/**
 * Get the primary oxide for an element (e.g., "Na" → "Na2O", "Fe" → "FeO")
 */
function getPrimaryOxide(element: string): string | null {
    const conv = ELEMENT_OXIDE_CONVERSIONS.find(
        c => c.element.toLowerCase() === element.toLowerCase()
    );
    // Carbon is reported as CO2 (PER carbonate diagrams use C-mol)
    return conv?.oxide ?? (element.toUpperCase() === 'C' ? 'CO2' : null);
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
                    // wt% oxide → mol/kg of the CATION: ×10 (g/100g → g/kg),
                    // ÷ oxide MW (mol oxide/kg), × cations per formula unit
                    // (Na2O carries 2 Na). Honour a non-pct oxide column.
                    const cations = cationsPerOxide(oxide);
                    const colUnit = getColumnUnit(geochemMappings, col);
                    const toPct = colUnit && colUnit !== 'pct' ? getSimpleUnitFactor(colUnit, 'pct') : 1;
                    result.resolvedColumn = col;
                    result.conversionType = 'molar';
                    result.conversionFactor = toPct * 10 * cations / mw;
                    result.status = 'converted';
                    result.conversionDescription = `${oxide} wt% → ${molarEl} mol/kg (×10×${cations}÷${mw.toFixed(2)})`;
                    return result;
                }
            }
        }
        // Fallback (and the only route for Nb, As, Pb…, which have no
        // primary oxide): the element column itself
        const elCol = findColumnForElement(geochemMappings, molarEl);
        if (elCol && columnNames.includes(elCol)) {
            // Element → ppm (column may be pct/ppb) → mol/kg
            // ppm = mg/kg, mol/kg = (mg/kg) / (g/mol * 1000 mg/g) = ppm / (AW * 1000)
            const aw = getAtomicWeight(molarEl);
            if (aw) {
                const toPpm = resolveColumnToPpm(geochemMappings, elCol)?.toPpm ?? 1;
                const unit = getColumnUnit(geochemMappings, elCol) ?? 'ppm';
                result.resolvedColumn = elCol;
                result.conversionType = 'molar';
                result.conversionFactor = toPpm / (aw * 1000);
                result.status = 'converted';
                result.conversionDescription = `${molarEl} ${unit} → mol/kg`;
                return result;
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
                    // Convert the element column to the diagram's unit first
                    // (column may be ppm, ppb or pct), then element → oxide
                    let factor = conv.elementToOxide;
                    if (variable.unit === 'pct' || variable.unit === 'ppm') {
                        const toPpm = resolveColumnToPpm(geochemMappings, elCol)?.toPpm ?? 1;
                        factor *= toPpm * (variable.unit === 'pct' ? UNIT_CONVERSIONS.ppm_to_wt_percent : 1);
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
    return ATOMIC_WEIGHTS[symbol] ?? null;
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
    columnNames: string[],
    /** User mapping: variable element/column name (or axis name) → data column. */
    overrides?: Record<string, string>,
): DiagramResolution {
    const axes: Record<string, AxisResolution> = {};
    const resolveVar = (v: DiagramVariable): ResolvedVariable => {
        const col = overrides?.[v.element];
        if (col && columnNames.includes(col)) {
            return {
                letter: v.letter, element: v.element, unit: v.unit, resolvedColumn: col,
                conversionType: 'none', conversionFactor: 1, status: 'matched',
                conversionDescription: `mapped by user to ${col}`,
            };
        }
        return resolveVariable(v, geochemMappings, columnNames);
    };
    let matchedCount = 0;
    let totalVariables = 0;

    const diagramVars = diagram.variables ?? [];
    const expressions = diagram.expressions ?? [];
    const nullsAsZero = /nulls_as_zeros/i.test(diagram.variateMode ?? '');

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
            const resolved = resolveVar(syntheticVar);
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

        // formulas: letters are case-insensitive, may reference
        // NamedExpression letters (which in turn reference variables).
        const usage = findFormulaInputs(formula, diagramVars, expressions);
        const resolvedVars = usage.variables.map(resolveVar);

        totalVariables += resolvedVars.length;
        matchedCount += resolvedVars.filter(v => v.status !== 'missing').length;

        const isFullyResolved = usage.ok && resolvedVars.length > 0 && resolvedVars.every(v => v.status !== 'missing');

        // Check if formula is a single variable (no operators)
        const isSingleVar = resolvedVars.length === 1 && isSingleVariableFormula(formula, resolvedVars[0].letter);

        // If single-var but needs unit conversion, route through computed path
        const needsConversion = isSingleVar && isFullyResolved && resolvedVars[0].conversionFactor !== 1.0;

        axes[key] = {
            axisKey: key,
            formula,
            axisName,
            variables: resolvedVars,
            isComputed: (!isSingleVar || needsConversion) && resolvedVars.length > 0,
            isFullyResolved,
            singleColumn: isSingleVar && isFullyResolved && !needsConversion ? resolvedVars[0].resolvedColumn : null,
            parsedFormula: usage.ast,
            expressions: usage.usesExpressions ? expressions : undefined,
            nullsAsZero,
        };
    }

    return { axes, matchedCount, totalVariables };
}


interface FormulaInputs {
    /** Parsed formula (interop dialect, upper-case letters). */
    ast?: FormulaExpression;
    /** Diagram variables the formula needs, directly or via expressions. */
    variables: DiagramVariable[];
    usesExpressions: boolean;
    /** False when the formula fails to parse or references an unknown letter. */
    ok: boolean;
}

/**
 * Work out which diagram variables a formula needs. Letters are
 * case-insensitive; a letter may name a NamedExpression, whose own
 * inputs are followed transitively.
 */
function findFormulaInputs(
    formula: string,
    variables: DiagramVariable[],
    expressions: NamedExpression[],
): FormulaInputs {
    let ast: FormulaExpression;
    try {
        ast = parseFormula(formula, { dialect: 'interop' });
    } catch {
        return { variables: [], usesExpressions: false, ok: false };
    }
    const byLetter = new Map(variables.map(v => [v.letter.toUpperCase(), v]));
    const exprLetters = new Set(expressions.map(e => e.letter.toUpperCase()));
    const refs = extractVariables(ast);

    let inputLetters = refs.filter(r => !exprLetters.has(r));
    const viaExpr = refs.filter(r => exprLetters.has(r));
    let ok = true;
    if (viaExpr.length) {
        try {
            const plan = planExpressionChain(expressions, [...byLetter.keys()], viaExpr);
            inputLetters = [...new Set([...inputLetters, ...plan.inputs])];
        } catch {
            ok = false;
        }
    }
    const used: DiagramVariable[] = [];
    for (const l of inputLetters) {
        const v = byLetter.get(l);
        if (v) used.push(v);
        else ok = false;
    }
    return { ast, variables: used, usesExpressions: viaExpr.length > 0, ok };
}

/**
 * Check if a formula is just a single variable reference.
 * e.g., formula "s" with letter "S" → true
 *       formula "k+n" → false
 */
function isSingleVariableFormula(formula: string, letter: string): boolean {
    return formula.trim().toUpperCase() === letter.toUpperCase();
}

// ============================================================================
// COMPUTED VALUES
// ============================================================================

/**
 * Compute axis values for a computed (compound formula) axis.
 * Evaluates column-wise; missing inputs or undefined maths give null.
 */
export function computeAxisValues(
    axisResolution: AxisResolution,
    displayData: Record<string, any>[]
): (number | null)[] {
    if (!axisResolution.isComputed || !axisResolution.isFullyResolved || !axisResolution.formula) {
        return [];
    }
    const n = displayData.length;

    let ast = axisResolution.parsedFormula;
    if (!ast) {
        try {
            ast = parseFormula(axisResolution.formula, { dialect: 'interop' });
        } catch {
            return displayData.map(() => null);
        }
    }

    // Input columns keyed by upper-case letter, NaN = missing
    const inputs: Record<string, Float64Array> = {};
    for (const rv of axisResolution.variables) {
        const col = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            const raw = rv.resolvedColumn ? parseNumericValue(displayData[i][rv.resolvedColumn]) : null;
            col[i] = raw === null ? NaN : raw * rv.conversionFactor;
        }
        inputs[rv.letter.toUpperCase()] = col;
    }

    let cols: Record<string, Float64Array> = inputs;
    try {
        if (axisResolution.expressions?.length) {
            cols = evaluateExpressionChain(axisResolution.expressions, inputs, n, {
                nullsAsZero: axisResolution.nullsAsZero,
                targets: extractVariables(ast).filter(l => !(l in inputs)),
            });
        } else if (axisResolution.nullsAsZero) {
            for (const c of Object.values(inputs)) {
                for (let i = 0; i < n; i++) if (c[i] !== c[i]) c[i] = 0;
            }
        }
        const out = runColumn(compileFormula(ast, name => cols[name]), n);
        return Array.from(out, v => (Number.isFinite(v) ? v : null));
    } catch {
        return displayData.map(() => null);
    }
}
