/**
 * Additive multi-element indices built from an element association (e.g. the
 * elements at one end of a ranked scaled eigenvector plot).
 *
 *  - CLR additive: Σ ± CLR(el), with CLR taken over the full composition the
 *    PCA used, so each term matches the PCA's own CLR values. This is the
 *    form used in exploration PCA reviews, e.g. BiAuCuMo = CLR-Bi + CLR-Au +
 *    CLR-Cu + CLR-Mo.
 *  - Log additive: Σ ± log10(ppm) — no composition needed.
 *
 * Optional extra term: log10 of barite-corrected sulphide sulphur,
 * S* = S − 0.234·Ba (ppm; 0.234 = S/Ba mass ratio in BaSO4 at 32.06/137.33),
 * i.e. all Ba assumed to sit in barite.
 *
 * Inputs are analytical values (below detection already substituted).
 * Rows with a missing or non-positive input are missing (NaN).
 */

/** S/Ba mass ratio in barite, BaSO4 */
export const S_PER_BA = 32.06 / 137.33;

export interface IndexTerm {
    /** Values of the term's column */
    values: ArrayLike<number>;
    /** +1 (high = signature) or −1 (low = signature) */
    sign: 1 | -1;
    /** Multiply raw values by this to get ppm (log additive form) */
    scale?: number;
}

/**
 * Σ sign·CLR over `terms`, where CLR uses the geometric mean of every column
 * in `composition` (natural log, as PCA CLR). `termIndex[k]` is the position
 * of term k in the composition.
 */
export function clrAdditiveIndex(
    composition: ArrayLike<number>[],
    termIndex: number[],
    signs: (1 | -1)[],
    rowCount: number,
): Float64Array {
    const out = new Float64Array(rowCount).fill(NaN);
    const D = composition.length;
    if (!D || !termIndex.length) return out;
    const signSum = signs.reduce<number>((a, b) => a + b, 0);
    const logs = new Float64Array(D);
    rows: for (let i = 0; i < rowCount; i++) {
        let meanLog = 0;
        for (let j = 0; j < D; j++) {
            const v = composition[j][i];
            if (!(v > 0)) continue rows;
            logs[j] = Math.log(v);
            meanLog += logs[j];
        }
        meanLog /= D;
        let sum = 0;
        for (let k = 0; k < termIndex.length; k++) sum += signs[k] * logs[termIndex[k]];
        out[i] = sum - signSum * meanLog;
    }
    return out;
}

/** Σ sign·log10(value·scale). */
export function logAdditiveIndex(terms: IndexTerm[], rowCount: number): Float64Array {
    const out = new Float64Array(rowCount).fill(NaN);
    if (!terms.length) return out;
    rows: for (let i = 0; i < rowCount; i++) {
        let sum = 0;
        for (const t of terms) {
            const v = t.values[i] * (t.scale ?? 1);
            if (!(v > 0)) continue rows;
            sum += t.sign * Math.log10(v);
        }
        out[i] = sum;
    }
    return out;
}

/**
 * Barite-corrected (sulphide) sulphur in ppm: S − 0.234·Ba. Values at or below
 * zero (all S could be in barite) are set to `floor` so log(S*) stays defined;
 * the default floor is half the smallest positive S*.
 */
export function sulphideS(
    s: ArrayLike<number>, ba: ArrayLike<number>, rowCount: number,
    sScale = 1, baScale = 1, floor?: number, sPerBa = S_PER_BA,
): { values: Float64Array; floor: number; floored: number } {
    const out = new Float64Array(rowCount).fill(NaN);
    let minPos = Infinity;
    for (let i = 0; i < rowCount; i++) {
        const sv = s[i] * sScale, bv = ba[i] * baScale;
        if (!Number.isFinite(sv) || !Number.isFinite(bv)) continue;
        const v = sv - sPerBa * bv;
        out[i] = v;
        if (v > 0 && v < minPos) minPos = v;
    }
    const f = floor ?? (Number.isFinite(minPos) ? minPos / 2 : 1);
    let floored = 0;
    for (let i = 0; i < rowCount; i++) {
        if (out[i] <= f) { out[i] = f; floored++; }
    }
    return { values: out, floor: f, floored };
}

/** Add log10(extra) to an index (NaN where either is missing). */
export function addLogTerm(index: Float64Array, extra: ArrayLike<number>): Float64Array {
    const out = new Float64Array(index.length);
    for (let i = 0; i < index.length; i++) {
        const v = extra[i];
        out[i] = v > 0 ? index[i] + Math.log10(v) : NaN;
    }
    return out;
}

/** Index name from element symbols in order, e.g. PbAgAsZn(S*) or −Si: BiAuCuMo_lessSi. */
export function indexName(symbols: { symbol: string; sign: 1 | -1 }[], withSulphide = false): string {
    const plus = symbols.filter(s => s.sign > 0).map(s => s.symbol).join('');
    const minus = symbols.filter(s => s.sign < 0).map(s => s.symbol).join('');
    return `${plus || 'Index'}${withSulphide ? '(S*)' : ''}${minus ? `_less${minus}` : ''}`;
}
