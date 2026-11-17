/**
 * NamedExpression chains.
 *
 * A diagram can define intermediate variables:
 *   <NamedExpression letter="N" expression="A/60.0843"/>
 *   <NamedExpression letter="TT" expression="SU*(NS/TP)"/>
 * whose letters are then used by the axis formulas (and by each other).
 * The QAP-normative diagrams carry a full CIPW norm this way: 436 steps
 * with IF(...) branches.
 *
 * Letters are case-insensitive (interop dialect); everything here is keyed by
 * UPPER-CASE letter. Columns use NaN for missing values.
 */

import { FormulaExpression } from '../../types/calculations';
import { parseFormula, extractVariables } from '../calculations/formulaParser';
import { compileFormula, runColumn } from '../calculations/formulaCompiler';

export interface NamedExpression {
    letter: string;
    expression: string;
}

export class ExpressionChainError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ExpressionChainError';
    }
}

interface ParsedExpression {
    letter: string;
    ast: FormulaExpression;
    deps: string[];
}

export interface ChainPlan {
    /** Expression letters in evaluation order (dependencies first). */
    order: string[];
    /** Input variable letters the chain needs. */
    inputs: string[];
    parsed: Map<string, ParsedExpression>;
}

/**
 * Parse and topologically order the expressions needed for `targets`.
 *
 * @param expressions the diagram's NamedExpressions
 * @param inputLetters letters provided as data inputs (diagram Variables)
 * @param targets letters to compute; default = every expression
 * @throws ExpressionChainError on parse errors, cycles or undefined letters
 */
export function planExpressionChain(
    expressions: NamedExpression[],
    inputLetters: string[],
    targets?: string[],
): ChainPlan {
    const inputs = new Set(inputLetters.map(l => l.toUpperCase()));
    const parsed = new Map<string, ParsedExpression>();
    for (const e of expressions) {
        const letter = e.letter.toUpperCase();
        let ast: FormulaExpression;
        try {
            ast = parseFormula(e.expression, { dialect: 'interop' });
        } catch (err) {
            throw new ExpressionChainError(`Expression ${letter} = "${e.expression}": ${(err as Error).message}`);
        }
        parsed.set(letter, { letter, ast, deps: extractVariables(ast) });
    }

    const order: string[] = [];
    const usedInputs = new Set<string>();
    const state = new Map<string, 'visiting' | 'done'>();

    const visit = (letter: string, from: string | null) => {
        if (inputs.has(letter) && !parsed.has(letter)) {
            usedInputs.add(letter);
            return;
        }
        const node = parsed.get(letter);
        if (!node) {
            throw new ExpressionChainError(
                from ? `Expression ${from} references undefined letter ${letter}` : `Undefined letter ${letter}`,
            );
        }
        const s = state.get(letter);
        if (s === 'done') return;
        if (s === 'visiting') throw new ExpressionChainError(`Cycle in expressions at ${letter}`);
        state.set(letter, 'visiting');
        for (const dep of node.deps) visit(dep, letter);
        state.set(letter, 'done');
        order.push(letter);
    };

    const wanted = targets ? targets.map(t => t.toUpperCase()) : [...parsed.keys()];
    for (const t of wanted) visit(t, null);

    return { order, inputs: [...usedInputs], parsed };
}

export interface ChainOptions {
    /** variateMode="Uni_Nulls_As_Zeros": treat missing inputs as 0. */
    nullsAsZero?: boolean;
    /** Only compute these letters (and their dependencies). */
    targets?: string[];
}

/**
 * Evaluate a NamedExpression chain column-wise.
 *
 * @param inputs data columns keyed by variable letter (any case)
 * @returns every computed expression column keyed by UPPER-CASE letter,
 *          plus the (possibly zero-filled) input columns
 */
export function evaluateExpressionChain(
    expressions: NamedExpression[],
    inputs: Record<string, ArrayLike<number>>,
    rowCount: number,
    options: ChainOptions = {},
): Record<string, Float64Array> {
    const cols: Record<string, Float64Array> = {};
    for (const [k, v] of Object.entries(inputs)) {
        const c = Float64Array.from(v as ArrayLike<number>);
        if (options.nullsAsZero) {
            for (let i = 0; i < c.length; i++) if (c[i] !== c[i]) c[i] = 0;
        }
        cols[k.toUpperCase()] = c;
    }

    const plan = planExpressionChain(expressions, Object.keys(cols), options.targets);
    const lookup = (name: string) => cols[name];
    for (const letter of plan.order) {
        const node = plan.parsed.get(letter)!;
        cols[letter] = runColumn(compileFormula(node.ast, lookup), rowCount);
    }
    return cols;
}
