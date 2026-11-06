/**
 * "Calculate Columns" sheet: input columns get reference letters
 * (A, B, … Z, AA, AB …); each output row is an expression in those letters
 * (interop dialect: case-insensitive, LOG10/LN/SQRT/IF…) and a new column name.
 * "Calculate All" evaluates every output row.
 *
 * Variate mode follows the reference software: Multivariate = a missing input makes the row
 * missing; Univariate = missing inputs count as 0.
 */
import { parseFormula, extractVariables } from './calculations/formulaParser';
import { compileFormula, runColumn } from './calculations/formulaCompiler';

export interface CalcInput { column: string; letter: string }
export interface CalcOutput { expression: string; name: string; notes?: string }
export type VariateMode = 'multivariate' | 'univariate';

export interface CalcSheet {
    name?: string;
    inputs: CalcInput[];
    outputs: CalcOutput[];
    mode: VariateMode;
}

/** 0 -> A, 25 -> Z, 26 -> AA … (spreadsheet style) */
export function letterFor(index: number): string {
    let s = '';
    let n = index;
    do {
        s = String.fromCharCode(65 + (n % 26)) + s;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return s;
}

/** Inputs for these columns with letters A, B, C … */
export function inputsFor(columns: string[]): CalcInput[] {
    return columns.map((column, i) => ({ column, letter: letterFor(i) }));
}

export interface OutputCheck {
    /** Problem with this output row, or null when it can be calculated */
    error: string | null;
    /** Letters it uses */
    letters: string[];
}

/** Validate every output row ("Expressions OK" in the reference software). */
export function checkSheet(sheet: CalcSheet, existingColumns: Iterable<string>): OutputCheck[] {
    const letters = new Map(sheet.inputs.map(i => [i.letter.toUpperCase(), i.column]));
    const existing = new Set(existingColumns);
    const seen = new Set<string>();
    return sheet.outputs.map(o => {
        const name = o.name.trim();
        if (!o.expression.trim()) return { error: 'Expression is empty', letters: [] };
        let vars: string[];
        try {
            vars = extractVariables(parseFormula(o.expression, { dialect: 'interop' }));
        } catch (e) {
            return { error: (e as Error).message, letters: [] };
        }
        const missing = vars.filter(v => !letters.has(v));
        if (missing.length) return { error: `No input column for ${missing.join(', ')}`, letters: vars };
        if (!name) return { error: 'Output column needs a name', letters: vars };
        if (seen.has(name)) return { error: `"${name}" is used twice`, letters: vars };
        seen.add(name);
        if (existing.has(name)) return { error: `Column "${name}" already exists`, letters: vars };
        return { error: null, letters: vars };
    });
}

/**
 * Evaluate the output rows that pass checkSheet. Values are read through
 * `getColumn` (analytical values: below-detection substituted).
 */
export function evaluateSheet(
    sheet: CalcSheet,
    getColumn: (name: string) => ArrayLike<number> | undefined,
    rowCount: number,
    existingColumns: Iterable<string> = [],
): Array<{ name: string; values: Float64Array }> {
    const checks = checkSheet(sheet, existingColumns);
    const byLetter = new Map<string, Float64Array>();
    for (const input of sheet.inputs) {
        const src = getColumn(input.column);
        if (!src) continue;
        const col = Float64Array.from(src);
        if (sheet.mode === 'univariate') {
            for (let i = 0; i < col.length; i++) if (col[i] !== col[i]) col[i] = 0;
        }
        byLetter.set(input.letter.toUpperCase(), col);
    }
    const out: Array<{ name: string; values: Float64Array }> = [];
    sheet.outputs.forEach((o, k) => {
        if (checks[k].error) return;
        const fn = compileFormula(parseFormula(o.expression, { dialect: 'interop' }), l => byLetter.get(l));
        out.push({ name: o.name.trim(), values: runColumn(fn, rowCount) });
    });
    return out;
}

// ---------------------------------------------------------------------------
// Presets (Transform menu / common steps)

const stripUnit = (c: string) => c.replace(/[_\s(]*(ppm|ppb|pct|%|wt%|g\/t)\)?$/i, '');

export type PresetKind = 'blank' | 'log10' | 'ln' | 'negate' | 'logAdditive';

export const PRESET_LABELS: Record<PresetKind, string> = {
    blank: 'Blank sheet',
    log10: 'Log10 of each column',
    ln: 'Natural log of each column',
    negate: 'Negative of each column (-A)',
    logAdditive: 'Log additive index (sum of log10)',
};

export function presetSheet(kind: PresetKind, columns: string[]): CalcSheet {
    const inputs = inputsFor(columns);
    const each = (expr: (l: string) => string, name: (c: string) => string): CalcOutput[] =>
        inputs.map(i => ({ expression: expr(i.letter), name: name(i.column) }));
    switch (kind) {
        case 'log10':
            return { inputs, mode: 'multivariate', outputs: each(l => `LOG10(${l})`, c => `Log10_${c}`) };
        case 'ln':
            return { inputs, mode: 'multivariate', outputs: each(l => `LN(${l})`, c => `Ln_${c}`) };
        case 'negate':
            return { inputs, mode: 'multivariate', outputs: each(l => `-${l}`, c => `neg${c}`) };
        case 'logAdditive':
            return {
                inputs, mode: 'multivariate',
                outputs: inputs.length ? [{
                    expression: inputs.map(i => `LOG10(${i.letter})`).join('+'),
                    name: `Log_${inputs.map(i => stripUnit(i.column)).join('')}`,
                    notes: 'Log additive index',
                }] : [],
            };
        default:
            return { inputs, mode: 'multivariate', outputs: [{ expression: '', name: '' }] };
    }
}

// ---------------------------------------------------------------------------
// Weighted sums (Garrett & Grunsky 2001)

export interface WeightedSumOptions {
    /** Log10-transform values first (assay data are usually log-normal) */
    log?: boolean;
}

/**
 * Weighted sum index: Σ wᵢ·zᵢ with zᵢ the robust z-score of element i
 * ((x - median) / (1.4826·MAD)) and weights scaled to unit length, so the
 * index is comparable between element sets (Garrett & Grunsky 2001).
 * Rows missing any input are missing. Negative weights = elements that
 * should be low for the target signature.
 */
export function weightedSum(
    columns: ArrayLike<number>[],
    weights: number[],
    rowCount: number,
    options: WeightedSumOptions = {},
): Float64Array {
    const norm = Math.hypot(...weights) || 1;
    const w = weights.map(x => x / norm);
    const z = columns.map(col => robustZ(col, rowCount, options.log ?? false));
    const out = new Float64Array(rowCount);
    for (let i = 0; i < rowCount; i++) {
        let s = 0;
        for (let k = 0; k < z.length; k++) s += w[k] * z[k][i];
        out[i] = s;
    }
    return out;
}

function robustZ(col: ArrayLike<number>, n: number, log: boolean): Float64Array {
    const vals = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const v = col[i];
        vals[i] = log ? (v > 0 ? Math.log10(v) : NaN) : v;
    }
    const finite = Array.from(vals).filter(Number.isFinite).sort((a, b) => a - b);
    const med = median(finite);
    const mad = median(finite.map(v => Math.abs(v - med)).sort((a, b) => a - b)) * 1.4826;
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = mad > 0 ? (vals[i] - med) / mad : NaN;
    return out;
}

function median(sorted: number[]): number {
    if (!sorted.length) return NaN;
    const m = sorted.length >> 1;
    return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}
