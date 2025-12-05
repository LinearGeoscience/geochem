// Safe Formula Evaluator - Executes AST without eval()

import { FormulaExpression } from '../../types/calculations';

/**
 * Evaluate a formula AST with given variable values
 * @param expr - The formula AST to evaluate
 * @param variables - Map of variable names to their values
 * @returns The computed result, or null if evaluation fails
 */
export function evaluateFormula(
    expr: FormulaExpression,
    variables: Record<string, number | null>
): number | null {
    try {
        return evaluate(expr, variables);
    } catch (err) {
        console.warn('Formula evaluation error:', err);
        return null;
    }
}

function evaluate(expr: FormulaExpression, variables: Record<string, number | null>): number | null {
    switch (expr.type) {
        case 'constant':
            return expr.value as number;

        case 'variable': {
            const varName = expr.value as string;
            const value = variables[varName];
            if (value === undefined) {
                console.warn(`Variable '${varName}' not found`);
                return null;
            }
            return value;
        }

        case 'operation': {
            if (!expr.operands || expr.operands.length !== 2) {
                throw new Error('Operation requires exactly 2 operands');
            }
            const left = evaluate(expr.operands[0], variables);
            const right = evaluate(expr.operands[1], variables);

            if (left === null || right === null) {
                return null;
            }

            return executeOperation(expr.operator!, left, right);
        }

        case 'function': {
            if (!expr.operands) {
                throw new Error('Function requires operands');
            }
            const args = expr.operands.map(op => evaluate(op, variables));

            // Check for null arguments
            if (args.some(arg => arg === null)) {
                return null;
            }

            return executeFunction(expr.functionName!, args as number[]);
        }

        default:
            throw new Error(`Unknown expression type: ${expr.type}`);
    }
}

function executeOperation(operator: string, left: number, right: number): number | null {
    switch (operator) {
        case '+':
            return left + right;
        case '-':
            return left - right;
        case '*':
            return left * right;
        case '/':
            if (right === 0) {
                console.warn('Division by zero');
                return null;
            }
            return left / right;
        case '^':
            return Math.pow(left, right);
        default:
            throw new Error(`Unknown operator: ${operator}`);
    }
}

function executeFunction(funcName: string, args: number[]): number | null {
    switch (funcName) {
        case 'log10':
            if (args.length !== 1) throw new Error('log10 requires 1 argument');
            if (args[0] <= 0) {
                console.warn('log10 of non-positive number');
                return null;
            }
            return Math.log10(args[0]);

        case 'ln':
            if (args.length !== 1) throw new Error('ln requires 1 argument');
            if (args[0] <= 0) {
                console.warn('ln of non-positive number');
                return null;
            }
            return Math.log(args[0]);

        case 'sqrt':
            if (args.length !== 1) throw new Error('sqrt requires 1 argument');
            if (args[0] < 0) {
                console.warn('sqrt of negative number');
                return null;
            }
            return Math.sqrt(args[0]);

        case 'abs':
            if (args.length !== 1) throw new Error('abs requires 1 argument');
            return Math.abs(args[0]);

        case 'min':
            if (args.length < 2) throw new Error('min requires at least 2 arguments');
            return Math.min(...args);

        case 'max':
            if (args.length < 2) throw new Error('max requires at least 2 arguments');
            return Math.max(...args);

        case 'pow':
            if (args.length !== 2) throw new Error('pow requires 2 arguments');
            return Math.pow(args[0], args[1]);

        case 'exp':
            if (args.length !== 1) throw new Error('exp requires 1 argument');
            return Math.exp(args[0]);

        default:
            throw new Error(`Unknown function: ${funcName}`);
    }
}

/**
 * Evaluate a formula for multiple rows of data
 * @param expr - The formula AST
 * @param data - Array of data rows
 * @param columnMappings - Map of variable names to column names
 * @returns Array of results (one per row)
 */
export function evaluateFormulaForData(
    expr: FormulaExpression,
    data: Record<string, any>[],
    columnMappings: Record<string, string>
): (number | null)[] {
    return data.map((row, index) => {
        try {
            // Build variables object from column mappings
            const variables: Record<string, number | null> = {};
            for (const [varName, colName] of Object.entries(columnMappings)) {
                const rawValue = row[colName];
                variables[varName] = parseNumericValue(rawValue);
            }
            return evaluateFormula(expr, variables);
        } catch (err) {
            console.warn(`Error evaluating row ${index}:`, err);
            return null;
        }
    });
}

/**
 * Parse a raw value to a number, handling various formats
 */
export function parseNumericValue(value: any): number | null {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    if (typeof value === 'number') {
        return isNaN(value) ? null : value;
    }

    if (typeof value === 'string') {
        // Handle below detection limit values
        const trimmed = value.trim();

        // Common "no data" values
        if (['', '-', 'ND', 'N/A', 'NA', 'NULL', 'BDL', 'n.d.', 'n.a.'].includes(trimmed.toUpperCase())) {
            return null;
        }

        // Below detection limit with < prefix
        if (trimmed.startsWith('<')) {
            const num = parseFloat(trimmed.substring(1));
            // Return half detection limit
            return isNaN(num) ? null : num / 2;
        }

        // Greater than with > prefix (cap at the value)
        if (trimmed.startsWith('>')) {
            const num = parseFloat(trimmed.substring(1));
            return isNaN(num) ? null : num;
        }

        // Standard number
        const num = parseFloat(trimmed);
        return isNaN(num) ? null : num;
    }

    return null;
}

/**
 * Convert weight percent to molar for oxide calculations
 */
export function wtPercentToMolar(wtPercent: number | null, molecularWeight: number): number | null {
    if (wtPercent === null || molecularWeight <= 0) {
        return null;
    }
    return wtPercent / molecularWeight;
}

/**
 * Convert molar to weight percent
 */
export function molarToWtPercent(molar: number | null, molecularWeight: number): number | null {
    if (molar === null || molecularWeight <= 0) {
        return null;
    }
    return molar * molecularWeight;
}

/**
 * Safe division that returns null instead of Infinity/NaN
 */
export function safeDivide(numerator: number | null, denominator: number | null): number | null {
    if (numerator === null || denominator === null || denominator === 0) {
        return null;
    }
    const result = numerator / denominator;
    return isFinite(result) ? result : null;
}

/**
 * Calculate ratio of two columns
 */
export function calculateRatio(
    data: Record<string, any>[],
    numeratorCol: string,
    denominatorCol: string
): (number | null)[] {
    return data.map(row => {
        const num = parseNumericValue(row[numeratorCol]);
        const den = parseNumericValue(row[denominatorCol]);
        return safeDivide(num, den);
    });
}

/**
 * Calculate sum of multiple columns
 */
export function calculateSum(
    data: Record<string, any>[],
    columns: string[]
): (number | null)[] {
    return data.map(row => {
        let sum = 0;
        let hasValue = false;
        for (const col of columns) {
            const val = parseNumericValue(row[col]);
            if (val !== null) {
                sum += val;
                hasValue = true;
            }
        }
        return hasValue ? sum : null;
    });
}

/**
 * Apply a transformation function to a column
 */
export function transformColumn(
    data: Record<string, any>[],
    column: string,
    transform: (value: number) => number | null
): (number | null)[] {
    return data.map(row => {
        const val = parseNumericValue(row[column]);
        if (val === null) return null;
        try {
            const result = transform(val);
            return result !== null && isFinite(result) ? result : null;
        } catch {
            return null;
        }
    });
}
