/**
 * Correlation statistics — the single implementation used by the correlation
 * matrix (worker and main-thread fallback) and the logratio diagnostics.
 * Pure (no DOM/stores) so workers can import it.
 */

/** Pearson r (two-pass, mean-centred for numerical stability). 0 when undefined. */
export function pearsonCorrelation(x: ArrayLike<number>, y: ArrayLike<number>): number {
    const n = x.length;
    if (n !== y.length || n < 2) return 0;

    let meanX = 0;
    let meanY = 0;
    for (let i = 0; i < n; i++) { meanX += x[i]; meanY += y[i]; }
    meanX /= n;
    meanY /= n;

    let num = 0;
    let dx2 = 0;
    let dy2 = 0;
    for (let i = 0; i < n; i++) {
        const dx = x[i] - meanX;
        const dy = y[i] - meanY;
        num += dx * dy;
        dx2 += dx * dx;
        dy2 += dy * dy;
    }
    const denom = Math.sqrt(dx2 * dy2);
    return denom === 0 ? 0 : num / denom;
}

/** Ranks with ties given their average rank (1-based). */
export function averageRanks(values: ArrayLike<number>): number[] {
    const n = values.length;
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => values[a] - values[b]);
    const ranks = new Array<number>(n);
    let i = 0;
    while (i < n) {
        let j = i;
        while (j < n - 1 && values[order[j]] === values[order[j + 1]]) j++;
        const avg = (i + j + 2) / 2;
        for (let k = i; k <= j; k++) ranks[order[k]] = avg;
        i = j + 1;
    }
    return ranks;
}

/** Spearman rank correlation (Pearson on average ranks). */
export function spearmanCorrelation(x: ArrayLike<number>, y: ArrayLike<number>): number {
    if (x.length !== y.length || x.length < 2) return 0;
    return pearsonCorrelation(averageRanks(x), averageRanks(y));
}

// ---------------------------------------------------------------------------
// Significance
// ---------------------------------------------------------------------------

/** ln Γ(z), Lanczos approximation (g = 7). */
function lnGamma(z: number): number {
    if (z <= 0) return 0;
    const coeff = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
        -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
    z -= 1;
    let x = coeff[0];
    for (let i = 1; i < 9; i++) x += coeff[i] / (z + i);
    const t = z + 7.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Regularized incomplete beta I_x(a, b) via Lentz's continued fraction. */
function betaRegularized(a: number, b: number, x: number): number {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
    const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta) / a;
    const tiny = 1e-30;
    let c = 1;
    let d = 1 - (a + b) * x / (a + 1);
    if (Math.abs(d) < tiny) d = tiny;
    d = 1 / d;
    let f = d;
    for (let m = 1; m <= 200; m++) {
        let num = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m));
        d = 1 + num * d; if (Math.abs(d) < tiny) d = tiny;
        c = 1 + num / c; if (Math.abs(c) < tiny) c = tiny;
        d = 1 / d; f *= c * d;
        num = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1));
        d = 1 + num * d; if (Math.abs(d) < tiny) d = tiny;
        c = 1 + num / c; if (Math.abs(c) < tiny) c = tiny;
        d = 1 / d;
        const delta = c * d;
        f *= delta;
        if (Math.abs(delta - 1) < 1e-10) break;
    }
    return front * f;
}

/** Two-tailed p-value of Student's t with df degrees of freedom. */
function tDistPValue(t: number, df: number): number {
    if (df <= 0) return 1;
    if (df > 100) {
        // Normal approximation (Abramowitz & Stegun 26.2.17)
        const z = Math.abs(t);
        const phi = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
        const k = 1 / (1 + 0.2316419 * z);
        const poly = k * (0.31938153 + k * (-0.356563782 + k * (1.781477937 + k * (-1.821255978 + k * 1.330274429))));
        return Math.max(0, Math.min(1, 2 * phi * poly));
    }
    return betaRegularized(df / 2, 0.5, df / (df + t * t));
}

/** Two-tailed p-value for a correlation coefficient r from n pairs. */
export function correlationPValue(r: number, n: number): number {
    if (n <= 2) return 1;
    if (Math.abs(r) >= 1) return 0;
    return tDistPValue(r * Math.sqrt((n - 2) / (1 - r * r)), n - 2);
}

// ---------------------------------------------------------------------------
// Matrix
// ---------------------------------------------------------------------------

export interface CorrelationMatrixResult {
    matrix: number[][];      // r, rounded to 3 decimals
    pValues: number[][];
    sampleCounts: number[][];
}

/**
 * Pairwise-complete correlation matrix. `columnData` holds aligned arrays
 * (NaN = missing). Pairs with fewer than 3 complete rows get r = 0, p = 1.
 */
export function computeCorrelationMatrix(
    columnNames: string[],
    columnData: Record<string, ArrayLike<number>>,
    method: 'pearson' | 'spearman',
    onProgress?: (fraction: number) => void,
): CorrelationMatrixResult {
    const n = columnNames.length;
    const matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const pValues = Array.from({ length: n }, () => new Array<number>(n).fill(1));
    const sampleCounts = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const corrFn = method === 'spearman' ? spearmanCorrelation : pearsonCorrelation;

    for (let i = 0; i < n; i++) {
        const xi = columnData[columnNames[i]];
        let valid = 0;
        for (let k = 0; k < xi.length; k++) if (!Number.isNaN(xi[k]) && xi[k] !== null) valid++;
        matrix[i][i] = 1;
        pValues[i][i] = 0;
        sampleCounts[i][i] = valid;

        for (let j = i + 1; j < n; j++) {
            const yj = columnData[columnNames[j]];
            const xs: number[] = [];
            const ys: number[] = [];
            const len = Math.min(xi.length, yj.length);
            for (let k = 0; k < len; k++) {
                const a = xi[k];
                const b = yj[k];
                if (a !== null && b !== null && !Number.isNaN(a) && !Number.isNaN(b)) {
                    xs.push(a);
                    ys.push(b);
                }
            }
            const rawR = xs.length >= 3 ? corrFn(xs, ys) : 0;
            const p = xs.length >= 3 ? correlationPValue(rawR, xs.length) : 1;
            const r = Math.round(rawR * 1000) / 1000;
            matrix[i][j] = r; matrix[j][i] = r;
            pValues[i][j] = p; pValues[j][i] = p;
            sampleCounts[i][j] = xs.length; sampleCounts[j][i] = xs.length;
        }
        if (onProgress && n > 10 && i % 5 === 0) onProgress((i + 1) / n);
    }
    return { matrix, pValues, sampleCounts };
}
