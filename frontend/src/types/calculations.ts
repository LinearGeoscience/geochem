// Geochemical Calculations - Type Definitions

export type CalculationCategory =
    | 'unit-conversion'
    | 'element-oxide'
    | 'oxide-element'
    | 'petrochemical-index'
    | 'weathering-index'
    | 'ree-normalization'
    | 'exploration-ratio'
    | 'custom';

export type UnitType = 'wt%' | 'ppm' | 'ppb' | 'molar' | 'ratio' | 'index' | 'none';

export type MissingValueStrategy = 'skip' | 'zero' | 'half-dl' | 'default';

export type ValidationSeverity = 'error' | 'warning' | 'info';

// Formula expression types for safe evaluation (no eval())
export type FormulaOperator = '+' | '-' | '*' | '/' | '^';
export type FormulaFunction = 'log10' | 'ln' | 'sqrt' | 'abs' | 'min' | 'max' | 'pow' | 'exp';

export interface FormulaExpression {
    type: 'constant' | 'variable' | 'operation' | 'function';
    value?: number | string;
    operator?: FormulaOperator;
    functionName?: FormulaFunction;
    operands?: FormulaExpression[];
}

export interface ValidationRule {
    type: 'range' | 'positive' | 'non-negative' | 'sum-check' | 'custom';
    min?: number;
    max?: number;
    sumColumns?: string[];
    sumMin?: number;
    sumMax?: number;
    customFn?: (value: number, row: Record<string, any>) => boolean;
    errorMessage: string;
    severity: ValidationSeverity;
}

export interface ValidationResult {
    isValid: boolean;
    errors: Array<{
        rowIndex: number;
        message: string;
        severity: ValidationSeverity;
    }>;
    warnings: Array<{
        rowIndex: number;
        message: string;
    }>;
}

export interface InputDefinition {
    name: string;
    description: string;
    required: boolean;
    unit: UnitType;
    defaultValue?: number;
    aliases: string[]; // Common column name aliases for auto-detection
    patterns: RegExp[]; // Regex patterns for column matching
}

export interface CalculationDefinition {
    id: string;
    name: string;
    category: CalculationCategory;
    description: string;
    formula: FormulaExpression | null; // null for complex calculations with custom logic
    formulaDisplay: string; // Human-readable formula string
    inputs: InputDefinition[];
    outputUnit: UnitType;
    validationRules: ValidationRule[];
    calculateFn?: (inputs: Record<string, number | null>, row: Record<string, any>) => number | null;
    references?: string[];
}

export interface ColumnMapping {
    inputName: string;
    columnName: string;
    conversionFactor?: number; // For unit conversions
}

export interface CalculationConfig {
    calculationId: string;
    outputColumnName: string;
    columnMappings: ColumnMapping[];
    missingValueStrategy: MissingValueStrategy;
    defaultValue?: number;
}

export interface QueuedCalculation {
    id: string;
    config: CalculationConfig;
    status: 'pending' | 'running' | 'completed' | 'error' | 'warning';
    errorMessage?: string;
    warningMessage?: string;
    resultPreview?: number[];
}

export interface CalculationResult {
    success: boolean;
    columnName: string;
    values: (number | null)[];
    validation: ValidationResult;
    calculationId: string;
    timestamp: string;
}

export interface SavedCalculation {
    id: string;
    name: string;
    config: CalculationConfig;
    createdAt: string;
    description?: string;
}

// Element/Oxide conversion types
export interface ConversionFactor {
    element: string;
    oxide: string;
    elementToOxide: number;
    oxideToElement: number;
    elementMW: number;
    oxideMW: number;
}

// REE normalization types
export interface NormalizationStandard {
    id: string;
    name: string;
    reference: string;
    values: Record<string, number>;
}

// Petrochemical index result with classification
export interface IndexResult {
    value: number | null;
    classification?: string;
    description?: string;
}
