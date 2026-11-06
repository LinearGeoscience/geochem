/**
 * Additive index from elements picked on a ranked scaled eigenvector plot.
 * CLR form sums the CLR of each picked element over the PCA's own input
 * composition; log form sums log10(ppm) of the raw element columns. Optional
 * log10(S*) term with S* = S − 0.234·Ba (barite-corrected sulphide S).
 */
import type { FullPCAResult } from '../../../types/compositional';
import { detectElementFromColumnName } from '../../../utils/calculations/elementNameNormalizer';
import {
    clrAdditiveIndex, logAdditiveIndex, sulphideS, addLogTerm, indexName,
} from '../../../utils/calculations/additiveIndex';
import { resolveRef, type ResolveContext } from '../../../utils/workflows/resolve';

export type IndexForm = 'clr' | 'log';

export interface IndexPick {
    /** PCA display label (e.g. "Cu") */
    label: string;
    sign: 1 | -1;
}

export interface IndexSpec {
    form: IndexForm;
    picks: IndexPick[];
    /** Add log10(S*); a picked S is then replaced by S* */
    sulphide: boolean;
}

export interface IndexDeps {
    rowCount: number;
    /** Analytical (below-detection substituted) numeric column */
    getNumeric: (name: string) => Float64Array | undefined;
    ctx: ResolveContext;
    /** Is this dataset column a CLR column (transformationType 'clr')? */
    isClrColumn?: (name: string) => boolean;
}

/** PCA inputs were already CLR columns (run with Transform = None). */
export function inputsAreClr(result: FullPCAResult, isClrColumn?: (name: string) => boolean): boolean {
    if (result.transform === 'clr') return false;
    return result.columns.length > 0 && result.columns.every(c => isClrColumn?.(c) || /[-_ ]clr$/i.test(c));
}

export interface IndexResult {
    values: Float64Array;
    /** Columns read */
    inputColumns: string[];
    /** Formula in words, for the column derivation / audit */
    formula: string;
    valid: number;
    sStar?: { values: Float64Array; floor: number; floored: number; sColumn: string; baColumn: string };
}

export const symbolOf = (label: string) => detectElementFromColumnName(label) || label;
const isS = (label: string) => symbolOf(label) === 'S';

export function defaultIndexName(spec: IndexSpec): string {
    const picks = spec.sulphide ? spec.picks.filter(p => !isS(p.label)) : spec.picks;
    return indexName(picks.map(p => ({ symbol: symbolOf(p.label), sign: p.sign })), spec.sulphide);
}

/** Can S* be made (S and Ba resolvable)? */
export function sulphideAvailable(ctx: ResolveContext): boolean {
    return !!resolveRef({ el: 'S' }, ctx) && !!resolveRef({ el: 'Ba' }, ctx);
}

export function computePcaIndex(result: FullPCAResult, spec: IndexSpec, deps: IndexDeps): IndexResult | { error: string } {
    const { rowCount, getNumeric, ctx } = deps;
    const picks = spec.sulphide ? spec.picks.filter(p => !isS(p.label)) : spec.picks;
    if (!picks.length && !spec.sulphide) return { error: 'Pick at least one element.' };
    const display = result.displayColumns ?? result.columns;
    const sign = (s: 1 | -1) => (s > 0 ? '+' : '−');
    let values: Float64Array;
    let inputColumns: string[];
    let formula: string;

    if (spec.form === 'clr') {
        const composition = result.columns.map(c => getNumeric(c));
        const missing = result.columns.filter((_, j) => !composition[j]);
        if (missing.length) return { error: `PCA input column(s) no longer in the data: ${missing.join(', ')}` };
        const termIndex = picks.map(p => display.indexOf(p.label));
        if (termIndex.some(j => j < 0)) return { error: 'A picked element is not in this PCA.' };
        if (inputsAreClr(result, deps.isClrColumn)) {
            // PCA ran on CLR columns: the inputs ARE the CLR values — sum them
            values = new Float64Array(rowCount).fill(NaN);
            for (let i = 0; i < rowCount; i++) {
                let sum = 0;
                for (let k = 0; k < picks.length; k++) sum += picks[k].sign * composition[termIndex[k]]![i];
                values[i] = sum;
            }
            inputColumns = termIndex.map(j => result.columns[j]);
        } else {
            values = clrAdditiveIndex(composition as Float64Array[], termIndex, picks.map(p => p.sign), rowCount);
            inputColumns = [...result.columns];
        }
        formula = picks.map((p, k) => `${k || p.sign < 0 ? sign(p.sign) : ''} CLR-${symbolOf(p.label)}`).join(' ').trim()
            + ` (CLR over the ${result.columns.length} PCA inputs)`;
    } else {
        const terms = [];
        inputColumns = [];
        for (const p of picks) {
            const r = resolveRef({ el: symbolOf(p.label) }, ctx);
            const column = r?.column ?? result.columns[display.indexOf(p.label)];
            const col = column ? getNumeric(column) : undefined;
            if (!col) return { error: `No column found for ${p.label}.` };
            terms.push({ values: col, sign: p.sign, scale: r?.scale ?? 1 });
            inputColumns.push(column);
        }
        values = logAdditiveIndex(terms, rowCount);
        formula = picks.map((p, k) => `${k || p.sign < 0 ? sign(p.sign) : ''} log10(${symbolOf(p.label)} ppm)`).join(' ').trim();
    }

    let sStar: IndexResult['sStar'];
    if (spec.sulphide) {
        const sRef = resolveRef({ el: 'S' }, ctx), baRef = resolveRef({ el: 'Ba' }, ctx);
        const sCol = sRef && getNumeric(sRef.column), baCol = baRef && getNumeric(baRef.column);
        if (!sRef || !baRef || !sCol || !baCol) return { error: 'S* needs both S and Ba columns.' };
        const r = sulphideS(sCol, baCol, rowCount, sRef.scale, baRef.scale);
        sStar = { ...r, sColumn: sRef.column, baColumn: baRef.column };
        values = picks.length ? addLogTerm(values, r.values) : r.values.map(v => Math.log10(v));
        inputColumns.push(sRef.column, baRef.column);
        formula += `${picks.length ? ' + ' : ''}log10(S*), S* = S − 0.234·Ba ppm`;
    }

    let valid = 0;
    for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) valid++;
    return { values, inputColumns: [...new Set(inputColumns)], formula, valid, sStar };
}
