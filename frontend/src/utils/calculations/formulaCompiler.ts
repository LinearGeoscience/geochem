/**
 * Formula compiler: turns a parsed formula AST into a fast closure that
 * evaluates one row of column-wise data.
 *
 * Used where a formula runs over every row of a dataset (classification
 * diagram axes, NamedExpression chains such as the 436-step CIPW norm
 * embedded in the QAP-normative diagrams). Missing values are NaN throughout,
 * mirroring `evaluateFormula`'s null semantics: any NaN input gives NaN,
 * except that IF only evaluates the branch it takes.
 *
 * Non-finite results (division by zero, log of a non-positive number,
 * sqrt of a negative number) become NaN.
 *
 * AND / OR stop at the first argument that decides the answer (0 for AND, a
 * non-zero for OR); a missing argument makes the answer missing only when
 * nothing decides it. ISNA and COALESCE never return missing for a missing
 * input. Text columns (looked up with `textLookup`) can only be compared
 * with quoted text or another text column, with = (==) or <> (!=): exact
 * match after trimming; a blank cell gives a missing result.
 */

import { FormulaExpression } from '../../types/calculations';
import { parseFormula, FormulaParseOptions } from './formulaParser';
import { inverseNormalCDF } from '../probability';

export type RowFn = (i: number) => number;

/** Resolve a variable name to its column (NaN = missing). */
export type ColumnLookup = (name: string) => ArrayLike<number> | undefined;

/** Resolve a variable name to a text column (null / '' = missing). */
export type TextLookup = (name: string) => ArrayLike<unknown> | undefined;

const cellText = (v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s === '' ? null : s;
};

/** A text operand: quoted text, or a variable that names a text column */
function textOperand(expr: FormulaExpression, lookup: ColumnLookup, textLookup?: TextLookup): ((i: number) => string | null) | null {
    if (expr.type === 'string') { const s = String(expr.value).trim(); return () => s; }
    if (expr.type === 'variable') {
        const name = expr.value as string;
        if (lookup(name)) return null;
        const col = textLookup?.(name);
        if (col) return (i) => cellText(col[i]);
    }
    return null;
}

export class UnknownVariableError extends Error {
    constructor(public readonly variable: string) {
        super(`Unknown variable '${variable}'`);
        this.name = 'UnknownVariableError';
    }
}

const finite = (v: number) => (Number.isFinite(v) ? v : NaN);

/**
 * Compile an AST against column arrays. Throws UnknownVariableError when the
 * lookup has no column for a referenced variable.
 */
export function compileFormula(expr: FormulaExpression, lookup: ColumnLookup, textLookup?: TextLookup): RowFn {
    const sub = (e: FormulaExpression) => compileFormula(e, lookup, textLookup);
    switch (expr.type) {
        case 'constant': {
            const c = expr.value as number;
            return () => c;
        }
        case 'string':
            throw new Error(`Text "${expr.value}" can only be compared with a text column, e.g. {Column} == "${expr.value}"`);
        case 'variable': {
            const name = expr.value as string;
            const col = lookup(name);
            if (!col) {
                if (textLookup?.(name)) throw new Error(`${name} is a text column: compare it with text in quotes, e.g. ${name} == "value"`);
                throw new UnknownVariableError(name);
            }
            return (i) => col[i];
        }
        case 'operation': {
            const ops = expr.operands ?? [];
            // Text comparison: a text column (or quoted text) with = / <>
            if (ops.length === 2) {
                const lt = textOperand(ops[0], lookup, textLookup);
                const rt = textOperand(ops[1], lookup, textLookup);
                if (lt || rt) {
                    if (!(lt && rt)) throw new Error('Text can only be compared with a text column or quoted text');
                    if (expr.operator !== '=' && expr.operator !== '<>') throw new Error('Text can only be compared with == (=) or != (<>)');
                    const same = expr.operator === '=';
                    return (i) => {
                        const a = lt(i), b = rt(i);
                        if (a === null || b === null) return NaN;
                        return (a === b) === same ? 1 : 0;
                    };
                }
            }
            const [l, r] = ops.map(sub);
            if (!l || !r) throw new Error('Operation requires exactly 2 operands');
            switch (expr.operator) {
                case '+': return (i) => l(i) + r(i);
                case '-': return (i) => l(i) - r(i);
                case '*': return (i) => l(i) * r(i);
                case '/': return (i) => {
                    const d = r(i);
                    return d === 0 ? NaN : l(i) / d;
                };
                // Math.pow(NaN, 0) is 1 — keep missing values missing
                case '^': return (i) => { const a = l(i), b = r(i); return a !== a || b !== b ? NaN : finite(Math.pow(a, b)); };
                // Comparisons propagate NaN instead of answering false
                case '<': return (i) => { const a = l(i), b = r(i); return a !== a || b !== b ? NaN : a < b ? 1 : 0; };
                case '>': return (i) => { const a = l(i), b = r(i); return a !== a || b !== b ? NaN : a > b ? 1 : 0; };
                case '<=': return (i) => { const a = l(i), b = r(i); return a !== a || b !== b ? NaN : a <= b ? 1 : 0; };
                case '>=': return (i) => { const a = l(i), b = r(i); return a !== a || b !== b ? NaN : a >= b ? 1 : 0; };
                case '=': return (i) => { const a = l(i), b = r(i); return a !== a || b !== b ? NaN : a === b ? 1 : 0; };
                case '<>': return (i) => { const a = l(i), b = r(i); return a !== a || b !== b ? NaN : a !== b ? 1 : 0; };
                default: throw new Error(`Unknown operator: ${expr.operator}`);
            }
        }
        case 'function': {
            // ISNA of a text column: 1 for a blank cell
            if (expr.functionName === 'isna' && expr.operands?.length === 1) {
                const t = textOperand(expr.operands[0], lookup, textLookup);
                if (t && expr.operands[0].type === 'variable') return (i) => (t(i) === null ? 1 : 0);
            }
            const args = (expr.operands ?? []).map(sub);
            const one = () => {
                if (args.length !== 1) throw new Error(`${expr.functionName} requires 1 argument`);
                return args[0];
            };
            switch (expr.functionName) {
                case 'and':
                case 'or': {
                    if (!args.length) throw new Error(`${expr.functionName} requires at least 1 argument`);
                    const isAnd = expr.functionName === 'and';
                    return (i) => {
                        let missing = false;
                        for (const a of args) {
                            const v = a(i);
                            if (v !== v) { missing = true; continue; }
                            if (isAnd ? v === 0 : v !== 0) return isAnd ? 0 : 1;
                        }
                        return missing ? NaN : isAnd ? 1 : 0;
                    };
                }
                case 'not': { const a = one(); return (i) => { const v = a(i); return v !== v ? NaN : v === 0 ? 1 : 0; }; }
                case 'isna': { const a = one(); return (i) => { const v = a(i); return v !== v ? 1 : 0; }; }
                case 'coalesce': {
                    if (args.length < 2) throw new Error('coalesce requires at least 2 arguments');
                    return (i) => {
                        for (const a of args) { const v = a(i); if (v === v) return v; }
                        return NaN;
                    };
                }
                case 'normsinv': { const a = one(); return (i) => { const p = a(i); return p > 0 && p < 1 ? inverseNormalCDF(p) : NaN; }; }
                case 'if': {
                    if (args.length !== 3) throw new Error('if requires 3 arguments');
                    const [c, t, f] = args;
                    return (i) => {
                        const v = c(i);
                        if (v !== v) return NaN;
                        return v !== 0 ? t(i) : f(i);
                    };
                }
                case 'log':
                case 'log10': { const a = one(); return (i) => { const v = a(i); return v > 0 ? Math.log10(v) : NaN; }; }
                case 'ln': { const a = one(); return (i) => { const v = a(i); return v > 0 ? Math.log(v) : NaN; }; }
                case 'sqrt': { const a = one(); return (i) => { const v = a(i); return v >= 0 ? Math.sqrt(v) : NaN; }; }
                case 'abs': { const a = one(); return (i) => Math.abs(a(i)); }
                case 'exp': { const a = one(); return (i) => finite(Math.exp(a(i))); }
                case 'pow': {
                    if (args.length !== 2) throw new Error('pow requires 2 arguments');
                    const [a, b] = args;
                    return (i) => { const x = a(i), y = b(i); return x !== x || y !== y ? NaN : finite(Math.pow(x, y)); };
                }
                case 'min':
                case 'max': {
                    if (args.length < 2) throw new Error(`${expr.functionName} requires at least 2 arguments`);
                    const isMin = expr.functionName === 'min';
                    return (i) => {
                        let acc = isMin ? Infinity : -Infinity;
                        for (const a of args) {
                            const v = a(i);
                            if (v !== v) return NaN;
                            acc = isMin ? Math.min(acc, v) : Math.max(acc, v);
                        }
                        return acc;
                    };
                }
                default: throw new Error(`Unknown function: ${expr.functionName}`);
            }
        }
        default:
            throw new Error(`Unknown expression type: ${expr.type}`);
    }
}

/** Evaluate a compiled row function over `rowCount` rows into a new column. */
export function runColumn(fn: RowFn, rowCount: number): Float64Array {
    const out = new Float64Array(rowCount);
    for (let i = 0; i < rowCount; i++) out[i] = fn(i);
    return out;
}

/** Parse + compile + run in one step. */
export function evaluateFormulaToColumn(
    formula: string,
    lookup: ColumnLookup,
    rowCount: number,
    options: FormulaParseOptions = {},
): Float64Array {
    return runColumn(compileFormula(parseFormula(formula, options), lookup), rowCount);
}
