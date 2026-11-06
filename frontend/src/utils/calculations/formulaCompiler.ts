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
 */

import { FormulaExpression } from '../../types/calculations';
import { parseFormula, FormulaParseOptions } from './formulaParser';

export type RowFn = (i: number) => number;

/** Resolve a variable name to its column (NaN = missing). */
export type ColumnLookup = (name: string) => ArrayLike<number> | undefined;

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
export function compileFormula(expr: FormulaExpression, lookup: ColumnLookup): RowFn {
    switch (expr.type) {
        case 'constant': {
            const c = expr.value as number;
            return () => c;
        }
        case 'variable': {
            const name = expr.value as string;
            const col = lookup(name);
            if (!col) throw new UnknownVariableError(name);
            return (i) => col[i];
        }
        case 'operation': {
            const [l, r] = (expr.operands ?? []).map(o => compileFormula(o, lookup));
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
            const args = (expr.operands ?? []).map(o => compileFormula(o, lookup));
            const one = () => {
                if (args.length !== 1) throw new Error(`${expr.functionName} requires 1 argument`);
                return args[0];
            };
            switch (expr.functionName) {
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
