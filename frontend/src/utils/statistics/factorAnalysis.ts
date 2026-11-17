/**
 * Exploratory factor analysis: principal-axis factoring (PAF) on the
 * correlation matrix, varimax rotation with Kaiser normalisation, and
 * regression (Thurstone) factor scores.
 *
 * Pure and structured-clonable in/out, so it runs in the analysis worker.
 * CLR-transformed input makes the correlation matrix singular (rows sum to
 * zero), so communalities start from the largest absolute correlation rather
 * than squared multiple correlations, and inverses are eigen pseudo-inverses.
 */
import { jacobiEigendecomposition } from '../calculations/eigen';
import { clrTransformCompleteCase } from '../logratioTransforms';

export interface FactorAnalysisOptions {
    /** Number of factors; default = eigenvalues of R greater than 1 (at least 1). */
    nFactors?: number;
    /** CLR-transform the variables first (compositional data). */
    useClr?: boolean;
    maxIterations?: number;
    tolerance?: number;
}

export interface FactorAnalysisResult {
    columns: string[];
    nFactors: number;
    /** Eigenvalues of the correlation matrix (for a scree plot / Kaiser rule). */
    eigenvalues: number[];
    /** p × k, unrotated PAF loadings */
    loadings: number[][];
    /** p × k, varimax-rotated loadings (factors ordered by explained variance) */
    rotatedLoadings: number[][];
    communalities: number[];
    uniquenesses: number[];
    /** Proportion of total variance per rotated factor */
    varianceExplained: number[];
    cumulativeVariance: number[];
    /** n_kept × k regression factor scores */
    scores: number[][];
    /** Indices (into the input rows) of the complete-case rows that were scored */
    keptIndices: number[];
    iterations: number;
    converged: boolean;
    heywoodCase: boolean;
}

// ---------------------------------------------------------------------------
// small linear algebra helpers
// ---------------------------------------------------------------------------

function matMul(a: number[][], b: number[][]): number[][] {
    const n = a.length, m = b[0]?.length ?? 0, k = b.length;
    const out = Array.from({ length: n }, () => new Array(m).fill(0));
    for (let i = 0; i < n; i++) {
        for (let t = 0; t < k; t++) {
            const v = a[i][t];
            if (v === 0) continue;
            for (let j = 0; j < m; j++) out[i][j] += v * b[t][j];
        }
    }
    return out;
}

/** Moore–Penrose pseudo-inverse of a symmetric matrix via its eigendecomposition. */
function symmetricPseudoInverse(m: number[][]): number[][] {
    const { eigenvalues, eigenvectors } = jacobiEigendecomposition(m);
    const n = m.length;
    const maxEv = Math.max(...eigenvalues.map(Math.abs), 0);
    const tol = Math.max(1e-10, maxEv * 1e-12) * n;
    const out = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let k = 0; k < eigenvalues.length; k++) {
        const ev = eigenvalues[k];
        if (Math.abs(ev) <= tol) continue;
        const inv = 1 / ev;
        for (let i = 0; i < n; i++) {
            // eigenvectors[k] is the k-th eigenvector (row layout)
            const vi = eigenvectors[k][i] * inv;
            if (vi === 0) continue;
            for (let j = 0; j < n; j++) out[i][j] += vi * eigenvectors[k][j];
        }
    }
    return out;
}

/** Standardise columns (z-scores) and return them with the correlation matrix. */
function standardise(x: number[][]): { z: number[][]; r: number[][] } {
    const n = x.length, p = x[0].length;
    const mean = new Array(p).fill(0);
    for (const row of x) for (let j = 0; j < p; j++) mean[j] += row[j] / n;
    const sd = new Array(p).fill(0);
    for (const row of x) for (let j = 0; j < p; j++) sd[j] += (row[j] - mean[j]) ** 2;
    for (let j = 0; j < p; j++) sd[j] = Math.sqrt(sd[j] / (n - 1)) || 1;
    const z = x.map(row => row.map((v, j) => (v - mean[j]) / sd[j]));
    const r = Array.from({ length: p }, () => new Array(p).fill(0));
    for (const row of z) {
        for (let i = 0; i < p; i++) {
            const zi = row[i];
            for (let j = i; j < p; j++) r[i][j] += zi * row[j];
        }
    }
    for (let i = 0; i < p; i++) {
        for (let j = i; j < p; j++) {
            r[i][j] /= n - 1;
            r[j][i] = r[i][j];
        }
    }
    return { z, r };
}

// ---------------------------------------------------------------------------
// varimax (Kaiser's pairwise algorithm, Kaiser-normalised)
// ---------------------------------------------------------------------------

export function varimax(loadings: number[][], maxIterations = 500, tolerance = 1e-10): number[][] {
    const p = loadings.length;
    const k = loadings[0]?.length ?? 0;
    if (k < 2) return loadings.map(r => [...r]);
    const h = loadings.map(r => Math.sqrt(r.reduce((s, v) => s + v * v, 0)) || 1);
    const L = loadings.map((r, i) => r.map(v => v / h[i])); // Kaiser normalisation

    for (let iter = 0; iter < maxIterations; iter++) {
        let maxAngle = 0;
        for (let a = 0; a < k - 1; a++) {
            for (let b = a + 1; b < k; b++) {
                let A = 0, B = 0, C = 0, D = 0;
                for (let i = 0; i < p; i++) {
                    const x = L[i][a], y = L[i][b];
                    const u = x * x - y * y;
                    const v = 2 * x * y;
                    A += u; B += v; C += u * u - v * v; D += 2 * u * v;
                }
                const num = D - (2 * A * B) / p;
                const den = C - (A * A - B * B) / p;
                const phi = Math.atan2(num, den) / 4;
                if (Math.abs(phi) > maxAngle) maxAngle = Math.abs(phi);
                if (Math.abs(phi) < 1e-14) continue;
                const c = Math.cos(phi), s = Math.sin(phi);
                for (let i = 0; i < p; i++) {
                    const x = L[i][a], y = L[i][b];
                    L[i][a] = x * c + y * s;
                    L[i][b] = -x * s + y * c;
                }
            }
        }
        if (maxAngle < tolerance) break;
    }
    return L.map((r, i) => r.map(v => v * h[i]));
}

// ---------------------------------------------------------------------------
// main entry
// ---------------------------------------------------------------------------

export function factorAnalysis(
    data: Record<string, any>[],
    columns: string[],
    options: FactorAnalysisOptions = {},
): FactorAnalysisResult {
    const { useClr = false, maxIterations = 500, tolerance = 1e-6 } = options;
    const p = columns.length;
    if (p < 2) throw new Error('Factor analysis needs at least 2 variables');

    // Complete-case matrix (optionally CLR-transformed)
    let x: number[][];
    let keptIndices: number[];
    if (useClr) {
        const clr = clrTransformCompleteCase(data, columns);
        x = clr.transformed;
        keptIndices = clr.keptIndices;
    } else {
        x = [];
        keptIndices = [];
        for (let i = 0; i < data.length; i++) {
            const row = new Array(p);
            let ok = true;
            for (let j = 0; j < p; j++) {
                const v = Number(data[i][columns[j]]);
                if (data[i][columns[j]] === null || data[i][columns[j]] === undefined || !Number.isFinite(v)) { ok = false; break; }
                row[j] = v;
            }
            if (ok) { x.push(row); keptIndices.push(i); }
        }
    }
    if (x.length < p + 2) {
        throw new Error(`Only ${x.length} complete rows for ${p} variables — not enough for factor analysis`);
    }

    const { z, r } = standardise(x);
    const { eigenvalues } = jacobiEigendecomposition(r);
    const kaiser = eigenvalues.filter(v => v > 1).length;
    const k = Math.max(1, Math.min(options.nFactors ?? kaiser ?? 1, p - 1));

    // Principal-axis factoring: iterate communalities on the reduced matrix
    let h2 = r.map((row, i) => Math.max(...row.map((v, j) => (i === j ? 0 : Math.abs(v)))));
    let loadings: number[][] = [];
    let converged = false;
    let iterations = 0;
    let heywoodCase = false;
    for (iterations = 1; iterations <= maxIterations; iterations++) {
        const reduced = r.map((row, i) => row.map((v, j) => (i === j ? h2[i] : v)));
        const eig = jacobiEigendecomposition(reduced);
        loadings = Array.from({ length: p }, (_, i) =>
            Array.from({ length: k }, (_, f) => eig.eigenvectors[f][i] * Math.sqrt(Math.max(eig.eigenvalues[f], 0))));
        const next = loadings.map(row => row.reduce((s, v) => s + v * v, 0));
        let delta = 0;
        for (let i = 0; i < p; i++) {
            if (next[i] >= 0.995) { next[i] = 0.995; heywoodCase = true; }
            delta = Math.max(delta, Math.abs(next[i] - h2[i]));
        }
        h2 = next;
        if (delta < tolerance) { converged = true; break; }
    }
    iterations = Math.min(iterations, maxIterations);

    // Consistent signs for the unrotated solution (largest-magnitude loading positive)
    const orient = (L: number[][]) => {
        for (let f = 0; f < k; f++) {
            let best = 0;
            for (let i = 0; i < p; i++) if (Math.abs(L[i][f]) > Math.abs(best)) best = L[i][f];
            if (best < 0) for (let i = 0; i < p; i++) L[i][f] = -L[i][f];
        }
        return L;
    };
    loadings = orient(loadings);

    // Varimax, then order factors by explained variance
    let rotated = orient(varimax(loadings));
    const ss = Array.from({ length: k }, (_, f) => rotated.reduce((s, row) => s + row[f] ** 2, 0));
    const order = ss.map((v, f) => [v, f] as const).sort((a, b) => b[0] - a[0]).map(([, f]) => f);
    rotated = rotated.map(row => order.map(f => row[f]));
    const varianceExplained = order.map(f => ss[f] / p);
    const cumulativeVariance = varianceExplained.map((_, f) => varianceExplained.slice(0, f + 1).reduce((s, v) => s + v, 0));

    const communalities = rotated.map(row => row.reduce((s, v) => s + v * v, 0));
    const uniquenesses = communalities.map(h => 1 - h);

    // Regression (Thurstone) scores: F = Z · R⁺ · Λ
    const weights = matMul(symmetricPseudoInverse(r), rotated);
    const scores = matMul(z, weights);

    return {
        columns,
        nFactors: k,
        eigenvalues,
        loadings,
        rotatedLoadings: rotated,
        communalities,
        uniquenesses,
        varianceExplained,
        cumulativeVariance,
        scores,
        keptIndices,
        iterations,
        converged,
        heywoodCase,
    };
}
