// Safe Formula Parser - Converts string formulas to AST without eval()

import { FormulaExpression, FormulaOperator, FormulaFunction } from '../../types/calculations';

// Token types for lexical analysis
type TokenType = 'NUMBER' | 'VARIABLE' | 'OPERATOR' | 'FUNCTION' | 'LPAREN' | 'RPAREN' | 'COMMA' | 'EOF';

interface Token {
    type: TokenType;
    value: string | number;
    position: number;
}

// Helper: Remove whitespace outside of {variable} references
function preprocessFormula(input: string): string {
    let result = '';
    let insideBraces = false;

    for (let i = 0; i < input.length; i++) {
        const char = input[i];

        if (char === '{') {
            insideBraces = true;
            result += char;
        } else if (char === '}') {
            insideBraces = false;
            result += char;
        } else if (insideBraces) {
            // Keep everything inside braces (including spaces)
            result += char;
        } else if (!/\s/.test(char)) {
            // Outside braces, only keep non-whitespace
            result += char;
        }
    }

    return result;
}

// Lexer: Tokenize the formula string
class Lexer {
    private input: string;
    private position: number = 0;
    private currentChar: string | null;

    constructor(input: string) {
        // Remove whitespace OUTSIDE of {variable} references only
        // Preserve spaces inside curly braces for column names like "As ppm"
        this.input = preprocessFormula(input);
        this.currentChar = this.input.length > 0 ? this.input[0] : null;
    }

    private advance(): void {
        this.position++;
        this.currentChar = this.position < this.input.length ? this.input[this.position] : null;
    }

    private peek(offset: number = 1): string | null {
        const peekPos = this.position + offset;
        return peekPos < this.input.length ? this.input[peekPos] : null;
    }

    private readNumber(): Token {
        const startPos = this.position;
        let numStr = '';
        let hasDecimal = false;

        while (this.currentChar !== null && (/\d/.test(this.currentChar) || this.currentChar === '.')) {
            if (this.currentChar === '.') {
                if (hasDecimal) break;
                hasDecimal = true;
            }
            numStr += this.currentChar;
            this.advance();
        }

        return { type: 'NUMBER', value: parseFloat(numStr), position: startPos };
    }

    private readIdentifier(): Token {
        const startPos = this.position;
        let id = '';

        // Handle variable wrapped in braces {ColumnName}
        if (this.currentChar === '{') {
            this.advance(); // skip {
            while (this.currentChar !== null && (this.currentChar as string) !== '}') {
                id += this.currentChar;
                this.advance();
            }
            if ((this.currentChar as string | null) === '}') {
                this.advance(); // skip }
            }
            return { type: 'VARIABLE', value: id, position: startPos };
        }

        // Read alphanumeric identifier (function names or simple variables)
        while (this.currentChar !== null && /[a-zA-Z0-9_]/.test(this.currentChar)) {
            id += this.currentChar;
            this.advance();
        }

        // Check if it's a function
        const functions: FormulaFunction[] = ['log10', 'log', 'ln', 'sqrt', 'abs', 'min', 'max', 'pow', 'exp'];
        if (functions.includes(id.toLowerCase() as FormulaFunction)) {
            return { type: 'FUNCTION', value: id.toLowerCase(), position: startPos };
        }

        return { type: 'VARIABLE', value: id, position: startPos };
    }

    getNextToken(): Token {
        while (this.currentChar !== null) {
            // Number
            if (/\d/.test(this.currentChar) || (this.currentChar === '.' && this.peek() && /\d/.test(this.peek()!))) {
                return this.readNumber();
            }

            // Identifier (variable or function)
            if (/[a-zA-Z_{]/.test(this.currentChar)) {
                return this.readIdentifier();
            }

            // Operators
            if (this.currentChar === '+') {
                const pos = this.position;
                this.advance();
                return { type: 'OPERATOR', value: '+', position: pos };
            }
            if (this.currentChar === '-') {
                const pos = this.position;
                this.advance();
                return { type: 'OPERATOR', value: '-', position: pos };
            }
            if (this.currentChar === '*') {
                const pos = this.position;
                this.advance();
                return { type: 'OPERATOR', value: '*', position: pos };
            }
            if (this.currentChar === '/') {
                const pos = this.position;
                this.advance();
                return { type: 'OPERATOR', value: '/', position: pos };
            }
            if (this.currentChar === '^') {
                const pos = this.position;
                this.advance();
                return { type: 'OPERATOR', value: '^', position: pos };
            }

            // Parentheses
            if (this.currentChar === '(') {
                const pos = this.position;
                this.advance();
                return { type: 'LPAREN', value: '(', position: pos };
            }
            if (this.currentChar === ')') {
                const pos = this.position;
                this.advance();
                return { type: 'RPAREN', value: ')', position: pos };
            }

            // Comma
            if (this.currentChar === ',') {
                const pos = this.position;
                this.advance();
                return { type: 'COMMA', value: ',', position: pos };
            }

            throw new Error(`Unexpected character '${this.currentChar}' at position ${this.position}`);
        }

        return { type: 'EOF', value: '', position: this.position };
    }

    tokenize(): Token[] {
        const tokens: Token[] = [];
        let token = this.getNextToken();
        while (token.type !== 'EOF') {
            tokens.push(token);
            token = this.getNextToken();
        }
        tokens.push(token); // Add EOF
        return tokens;
    }
}

// Parser: Build AST from tokens using recursive descent
class Parser {
    private tokens: Token[];
    private position: number = 0;
    private currentToken: Token;

    constructor(tokens: Token[]) {
        this.tokens = tokens;
        this.currentToken = tokens[0];
    }

    private advance(): void {
        this.position++;
        this.currentToken = this.position < this.tokens.length ? this.tokens[this.position] : { type: 'EOF', value: '', position: -1 };
    }

    private expect(type: TokenType): Token {
        if (this.currentToken.type !== type) {
            throw new Error(`Expected ${type} but got ${this.currentToken.type} at position ${this.currentToken.position}`);
        }
        const token = this.currentToken;
        this.advance();
        return token;
    }

    // Expression: Term (('+' | '-') Term)*
    private parseExpression(): FormulaExpression {
        let left = this.parseTerm();

        while (this.currentToken.type === 'OPERATOR' &&
               (this.currentToken.value === '+' || this.currentToken.value === '-')) {
            const operator = this.currentToken.value as FormulaOperator;
            this.advance();
            const right = this.parseTerm();
            left = {
                type: 'operation',
                operator,
                operands: [left, right],
            };
        }

        return left;
    }

    // Term: Power (('*' | '/') Power)*
    private parseTerm(): FormulaExpression {
        let left = this.parsePower();

        while (this.currentToken.type === 'OPERATOR' &&
               (this.currentToken.value === '*' || this.currentToken.value === '/')) {
            const operator = this.currentToken.value as FormulaOperator;
            this.advance();
            const right = this.parsePower();
            left = {
                type: 'operation',
                operator,
                operands: [left, right],
            };
        }

        return left;
    }

    // Power: Unary ('^' Unary)*
    private parsePower(): FormulaExpression {
        let left = this.parseUnary();

        while (this.currentToken.type === 'OPERATOR' && this.currentToken.value === '^') {
            this.advance();
            const right = this.parseUnary();
            left = {
                type: 'operation',
                operator: '^',
                operands: [left, right],
            };
        }

        return left;
    }

    // Unary: ('-')? Factor
    private parseUnary(): FormulaExpression {
        if (this.currentToken.type === 'OPERATOR' && this.currentToken.value === '-') {
            this.advance();
            const operand = this.parseFactor();
            return {
                type: 'operation',
                operator: '*',
                operands: [
                    { type: 'constant', value: -1 },
                    operand,
                ],
            };
        }
        return this.parseFactor();
    }

    // Factor: NUMBER | VARIABLE | FUNCTION '(' Args ')' | '(' Expression ')'
    private parseFactor(): FormulaExpression {
        const token = this.currentToken;

        if (token.type === 'NUMBER') {
            this.advance();
            return { type: 'constant', value: token.value as number };
        }

        if (token.type === 'VARIABLE') {
            this.advance();
            return { type: 'variable', value: token.value as string };
        }

        if (token.type === 'FUNCTION') {
            const funcName = token.value as FormulaFunction;
            this.advance();
            this.expect('LPAREN');
            const args = this.parseArguments();
            this.expect('RPAREN');
            return {
                type: 'function',
                functionName: funcName,
                operands: args,
            };
        }

        if (token.type === 'LPAREN') {
            this.advance();
            const expr = this.parseExpression();
            this.expect('RPAREN');
            return expr;
        }

        throw new Error(`Unexpected token ${token.type} at position ${token.position}`);
    }

    // Arguments: Expression (',' Expression)*
    private parseArguments(): FormulaExpression[] {
        const args: FormulaExpression[] = [];

        if (this.currentToken.type !== 'RPAREN') {
            args.push(this.parseExpression());

            while (this.currentToken.type === 'COMMA') {
                this.advance();
                args.push(this.parseExpression());
            }
        }

        return args;
    }

    parse(): FormulaExpression {
        const ast = this.parseExpression();
        if (this.currentToken.type !== 'EOF') {
            throw new Error(`Unexpected token ${this.currentToken.type} at position ${this.currentToken.position}`);
        }
        return ast;
    }
}

/**
 * Parse a formula string into an AST
 * @param formula - The formula string to parse
 * @returns The parsed AST
 *
 * Supported syntax:
 * - Numbers: 123, 45.67
 * - Variables: {ColumnName} or simpleVar
 * - Operators: +, -, *, /, ^
 * - Functions: log10(), log(), ln(), sqrt(), abs(), min(), max(), pow(), exp()
 * - Parentheses for grouping
 *
 * Examples:
 * - "{Cu_ppm} / {Zn_ppm}"
 * - "100 * {MgO} / ({MgO} + {FeO})"
 * - "log10({Au_ppb} + 1)"
 * - "sqrt(pow({X}, 2) + pow({Y}, 2))"
 */
export function parseFormula(formula: string): FormulaExpression {
    const lexer = new Lexer(formula);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    return parser.parse();
}

/**
 * Convert an AST back to a string (for display/debugging)
 */
export function formulaToString(expr: FormulaExpression): string {
    switch (expr.type) {
        case 'constant':
            return String(expr.value);
        case 'variable':
            return `{${expr.value}}`;
        case 'operation':
            if (!expr.operands || expr.operands.length !== 2) {
                throw new Error('Operation must have exactly 2 operands');
            }
            const left = formulaToString(expr.operands[0]);
            const right = formulaToString(expr.operands[1]);
            return `(${left} ${expr.operator} ${right})`;
        case 'function':
            if (!expr.operands) {
                throw new Error('Function must have operands');
            }
            const args = expr.operands.map(formulaToString).join(', ');
            return `${expr.functionName}(${args})`;
        default:
            throw new Error(`Unknown expression type: ${expr.type}`);
    }
}

/**
 * Extract all variable names from a formula AST
 */
export function extractVariables(expr: FormulaExpression): string[] {
    const variables = new Set<string>();

    function walk(node: FormulaExpression): void {
        if (node.type === 'variable' && node.value !== undefined) {
            variables.add(node.value as string);
        }
        if (node.operands) {
            node.operands.forEach(walk);
        }
    }

    walk(expr);
    return Array.from(variables);
}

/**
 * Validate a formula string and return any errors
 */
export function validateFormula(formula: string): { valid: boolean; error?: string; variables?: string[] } {
    try {
        const ast = parseFormula(formula);
        const variables = extractVariables(ast);
        return { valid: true, variables };
    } catch (err) {
        return { valid: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
}
