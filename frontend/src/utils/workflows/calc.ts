/**
 * Calc actions -> Calculate Columns sheets. Each input letter is a
 * reference; the expression is authored in canonical units (element ppm,
 * oxide wt%) and the letters are rewritten with each column's scale factor,
 * so `A/B` for V/Sc is right whether V arrives in ppm or pct.
 */
import type { CalcSheet } from '../calculateColumns';
import { parseFormula, extractVariables } from '../calculations/formulaParser';
import { refLabel, resolveRef, type ResolveContext } from './resolve';
import type { CalcAction } from './types';

/** Wrap letters whose factor is not 1: A -> (A*10000). Function names (LOG10, LN…) are left alone. */
export function rewriteExpression(expr: string, factors: Record<string, number>): string {
    return expr.replace(/\b([A-Za-z]+)\b/g, (tok) => {
        const f = factors[tok.toUpperCase()];
        if (f === undefined || f === 1 || tok.toUpperCase() !== tok) return tok;
        return `(${tok}*${f})`;
    });
}

export interface BuiltSheet {
    sheet: CalcSheet | null;
    missing: string[];
    warnings: string[];
    /** letter -> column, for the audit description */
    letters: string[];
}

export function buildCalcSheet(action: CalcAction, ctx: ResolveContext): BuiltSheet {
    const missing: string[] = [];
    const warnings: string[] = [];
    const inputs: CalcSheet['inputs'] = [];
    const factors: Record<string, number> = {};
    let used: string[];
    try {
        used = extractVariables(parseFormula(action.expr, { dialect: 'interop' }));
    } catch (e) {
        return { sheet: null, missing, warnings: [`${action.name}: ${(e as Error).message}`], letters: [] };
    }
    for (const [letter, ref] of Object.entries(action.inputs)) {
        const L = letter.toUpperCase();
        const r = resolveRef(ref, ctx);
        if (!r) { missing.push(refLabel(ref)); continue; }
        if (r.unitAssumed) warnings.push(`${r.column}: unit unknown, assumed`);
        if (r.substituted) warnings.push(`${action.name}: ${r.substituted} column used for ${refLabel(ref)} (converted)`);
        inputs.push({ letter: L, column: r.column });
        factors[L] = r.scale;
    }
    const undefinedLetters = used.filter(v => !(v in action.inputs) && !(v.toUpperCase() in factors));
    if (undefinedLetters.length) warnings.push(`${action.name}: no input for ${undefinedLetters.join(', ')}`);
    if (missing.length || undefinedLetters.length) return { sheet: null, missing, warnings, letters: [] };
    const sheet: CalcSheet = {
        name: action.name,
        inputs,
        outputs: [{ expression: rewriteExpression(action.expr, factors), name: action.name, notes: action.note }],
        mode: 'multivariate',
    };
    return { sheet, missing, warnings, letters: inputs.map(i => `${i.letter}=${i.column}`) };
}
