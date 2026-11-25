/**
 * Multivariate Gaussian mixture model (full covariance), fitted by EM, with
 * the number of groups chosen by BIC. Data-driven groups with soft edges:
 * every sample gets a probability of belonging to each group, so samples at
 * a contact or of mixed character show up as uncertain instead of being
 * forced into one group.
 *
 * Follows scikit-learn's GaussianMixture defaults so results can be compared:
 * k-means starts (k-means++ seeding), reg_covar 1e-6 added to every
 * covariance diagonal, tolerance 1e-3 on the mean log-likelihood, at most 100
 * iterations, the best of `nInit` starts kept. BIC = -2 log L + p ln n with
 * p = k d + k d (d + 1) / 2 + (k - 1). Lower BIC is better; differences
 * under ~10 are weak evidence.
 */
import { seededRandom, randomInt } from './random';

export interface GmmOptions {
    nInit?: number;
    maxIter?: number;
    tol?: number;
    regCovar?: number;
    seed?: number;
}

export interface GmmModel {
    k: number;
    weights: number[];
    means: number[][];
    covariances: number[][][];
    logLikelihood: number;
    bic: number;
    converged: boolean;
    /** Most likely group (0-based, groups ordered by the mean of the first variable) */
    labels: Int32Array;
    /** Probability of the most likely group */
    maxProbability: Float64Array;
}

const LOG2PI = Math.log(2 * Math.PI);

/** Cholesky factor L (lower) of a symmetric positive-definite matrix; null if not PD */
function cholesky(a: number[][]): number[][] | null {
    const d = a.length;
    const L = Array.from({ length: d }, () => new Array<number>(d).fill(0));
    for (let i = 0; i < d; i++) {
        for (let j = 0; j <= i; j++) {
            let s = a[i][j];
            for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
            if (i === j) {
                if (s <= 0) return null;
                L[i][i] = Math.sqrt(s);
            } else L[i][j] = s / L[j][j];
        }
    }
    return L;
}

/** log N(x | mean, cov) for every row, given the Cholesky factor of cov */
function logGaussian(X: number[][], mean: number[], L: number[][], out: Float64Array) {
    const d = mean.length;
    let logDet = 0;
    for (let i = 0; i < d; i++) logDet += 2 * Math.log(L[i][i]);
    const z = new Array<number>(d);
    for (let r = 0; r < X.length; r++) {
        // solve L z = x - mean
        let q = 0;
        for (let i = 0; i < d; i++) {
            let s = X[r][i] - mean[i];
            for (let k = 0; k < i; k++) s -= L[i][k] * z[k];
            z[i] = s / L[i][i];
            q += z[i] * z[i];
        }
        out[r] = -0.5 * (d * LOG2PI + logDet + q);
    }
}

function kmeansLabels(X: number[][], k: number, rand: () => number): Int32Array {
    const n = X.length, d = X[0].length;
    const dist2 = (a: number[], b: number[]) => { let s = 0; for (let i = 0; i < d; i++) s += (a[i] - b[i]) ** 2; return s; };
    // k-means++ seeding
    const centres: number[][] = [X[randomInt(rand, n)].slice()];
    const dmin = X.map(x => dist2(x, centres[0]));
    while (centres.length < k) {
        const total = dmin.reduce((s, v) => s + v, 0);
        let r = rand() * total, pick = n - 1;
        for (let i = 0; i < n; i++) { r -= dmin[i]; if (r <= 0) { pick = i; break; } }
        centres.push(X[pick].slice());
        for (let i = 0; i < n; i++) dmin[i] = Math.min(dmin[i], dist2(X[i], X[pick]));
    }
    const labels = new Int32Array(n);
    for (let it = 0; it < 300; it++) {
        let changed = 0;
        for (let i = 0; i < n; i++) {
            let best = 0, bd = Infinity;
            for (let c = 0; c < k; c++) { const dd = dist2(X[i], centres[c]); if (dd < bd) { bd = dd; best = c; } }
            if (labels[i] !== best || it === 0) { if (labels[i] !== best) changed++; labels[i] = best; }
        }
        const sums = Array.from({ length: k }, () => new Array<number>(d).fill(0));
        const counts = new Array<number>(k).fill(0);
        for (let i = 0; i < n; i++) { counts[labels[i]]++; for (let j = 0; j < d; j++) sums[labels[i]][j] += X[i][j]; }
        for (let c = 0; c < k; c++) if (counts[c]) centres[c] = sums[c].map(s => s / counts[c]);
        if (it > 0 && changed === 0) break;
    }
    return labels;
}

/** M-step from responsibilities */
function mStep(X: number[][], resp: number[][], reg: number) {
    const n = X.length, d = X[0].length, k = resp[0].length;
    const nk = new Array<number>(k).fill(0);
    for (let i = 0; i < n; i++) for (let c = 0; c < k; c++) nk[c] += resp[i][c];
    const means = Array.from({ length: k }, () => new Array<number>(d).fill(0));
    for (let i = 0; i < n; i++) for (let c = 0; c < k; c++) for (let j = 0; j < d; j++) means[c][j] += resp[i][c] * X[i][j];
    for (let c = 0; c < k; c++) for (let j = 0; j < d; j++) means[c][j] /= nk[c] + 10 * Number.EPSILON;
    const covs = Array.from({ length: k }, () => Array.from({ length: d }, () => new Array<number>(d).fill(0)));
    for (let c = 0; c < k; c++) {
        for (let i = 0; i < n; i++) {
            const r = resp[i][c];
            if (!r) continue;
            for (let a = 0; a < d; a++) {
                const da = X[i][a] - means[c][a];
                for (let b = 0; b <= a; b++) covs[c][a][b] += r * da * (X[i][b] - means[c][b]);
            }
        }
        for (let a = 0; a < d; a++) {
            for (let b = 0; b <= a; b++) { covs[c][a][b] /= nk[c] + 10 * Number.EPSILON; covs[c][b][a] = covs[c][a][b]; }
            covs[c][a][a] += reg;
        }
    }
    const weights = nk.map(v => (v + 10 * Number.EPSILON) / n);
    return { weights, means, covs };
}

/** E-step: log-likelihood and responsibilities */
function eStep(X: number[][], weights: number[], means: number[][], covs: number[][][]) {
    const n = X.length, k = weights.length;
    const logp = Array.from({ length: k }, () => new Float64Array(n));
    for (let c = 0; c < k; c++) {
        const L = cholesky(covs[c]);
        if (!L) return null;
        logGaussian(X, means[c], L, logp[c]);
        const lw = Math.log(weights[c]);
        for (let i = 0; i < n; i++) logp[c][i] += lw;
    }
    let ll = 0;
    const resp = Array.from({ length: n }, () => new Array<number>(k));
    for (let i = 0; i < n; i++) {
        let m = -Infinity;
        for (let c = 0; c < k; c++) m = Math.max(m, logp[c][i]);
        let s = 0;
        for (let c = 0; c < k; c++) s += Math.exp(logp[c][i] - m);
        const lse = m + Math.log(s);
        ll += lse;
        for (let c = 0; c < k; c++) resp[i][c] = Math.exp(logp[c][i] - lse);
    }
    return { ll, resp };
}

/** Fit a k-group mixture to complete rows X (n x d) */
export function fitGmm(X: number[][], k: number, opts: GmmOptions = {}): GmmModel {
    const n = X.length;
    if (n === 0) throw new Error('No complete rows to fit');
    if (n < k) throw new Error(`${k} groups need at least ${k} samples`);
    const d = X[0].length;
    const reg = opts.regCovar ?? 1e-6;
    const tol = opts.tol ?? 1e-3;
    const maxIter = opts.maxIter ?? 100;
    const rand = seededRandom(opts.seed ?? 42);
    let best: { ll: number; weights: number[]; means: number[][]; covs: number[][][]; resp: number[][]; converged: boolean } | null = null;

    for (let init = 0; init < Math.max(1, opts.nInit ?? 10); init++) {
        const lab = kmeansLabels(X, k, rand);
        let resp: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: k }, (_, c) => (lab[i] === c ? 1 : 0)));
        let params = mStep(X, resp, reg);
        let prev = -Infinity, ll = -Infinity, converged = false;
        for (let it = 0; it < maxIter; it++) {
            const e = eStep(X, params.weights, params.means, params.covs);
            if (!e) break;
            ll = e.ll;
            resp = e.resp;
            params = mStep(X, resp, reg);
            if (Math.abs(ll / n - prev / n) < tol) { converged = true; break; }
            prev = ll;
        }
        // final E-step for the reported likelihood and labels (as scikit-learn does)
        const fin = eStep(X, params.weights, params.means, params.covs);
        if (!fin) continue;
        if (!best || fin.ll > best.ll) best = { ll: fin.ll, ...params, resp: fin.resp, converged };
    }
    if (!best) throw new Error('The mixture could not be fitted (a group collapsed)');

    // Order groups by the mean of the first variable, so labels are stable
    const order = Array.from({ length: k }, (_, c) => c).sort((a, b) => best!.means[a][0] - best!.means[b][0]);
    const labels = new Int32Array(n);
    const maxProbability = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        let bc = 0;
        for (let c = 1; c < k; c++) if (best.resp[i][order[c]] > best.resp[i][order[bc]]) bc = c;
        labels[i] = bc;
        maxProbability[i] = best.resp[i][order[bc]];
    }
    const p = k * d + (k * d * (d + 1)) / 2 + (k - 1);
    return {
        k,
        weights: order.map(c => best!.weights[c]),
        means: order.map(c => best!.means[c]),
        covariances: order.map(c => best!.covs[c]),
        logLikelihood: best.ll,
        bic: -2 * best.ll + p * Math.log(n),
        converged: best.converged,
        labels, maxProbability,
    };
}

/** Standardise columns (mean 0, population SD 1) */
export function standardise(X: number[][]): number[][] {
    const n = X.length, d = n ? X[0].length : 0;
    const mean = new Array<number>(d).fill(0), sd = new Array<number>(d).fill(0);
    for (const r of X) for (let j = 0; j < d; j++) mean[j] += r[j] / n;
    for (const r of X) for (let j = 0; j < d; j++) sd[j] += (r[j] - mean[j]) ** 2 / n;
    for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]) || 1;
    return X.map(r => r.map((v, j) => (v - mean[j]) / sd[j]));
}

export interface GmmSelectionConfig extends GmmOptions {
    /** Variables as columns; rows with any non-finite value are left out */
    columns: ArrayLike<number>[];
    kMin?: number;
    kMax?: number;
    standardise?: boolean;
    /** Bootstrap resamples to test how stable the chosen k is (0 = none) */
    bootstrap?: number;
}

export interface GmmSelectionResult {
    /** Row index (in the input) of each fitted row */
    rows: number[];
    bic: Array<{ k: number; bic: number }>;
    kBest: number;
    model: GmmModel;
    /** How often each k had the lowest BIC across bootstrap resamples */
    bootstrapK: Record<number, number>;
}

/** Fit k = kMin..kMax, choose the lowest BIC */
export function selectGmm(cfg: GmmSelectionConfig): GmmSelectionResult {
    const n = cfg.columns[0]?.length ?? 0;
    const rows: number[] = [];
    for (let i = 0; i < n; i++) if (cfg.columns.every(c => Number.isFinite(c[i]))) rows.push(i);
    let X = rows.map(i => cfg.columns.map(c => c[i]));
    if (cfg.standardise ?? true) X = standardise(X);
    const kMin = Math.max(1, cfg.kMin ?? 1), kMax = Math.max(kMin, cfg.kMax ?? 6);
    const models: GmmModel[] = [];
    for (let k = kMin; k <= kMax && k <= X.length; k++) models.push(fitGmm(X, k, { ...cfg, nInit: cfg.nInit ?? 10 }));
    const bestModel = models.reduce((a, b) => (b.bic < a.bic ? b : a));
    const bootstrapK: Record<number, number> = {};
    const B = cfg.bootstrap ?? 0;
    if (B > 0) {
        const rand = seededRandom((cfg.seed ?? 42) + 1);
        for (let b = 0; b < B; b++) {
            const Xb = X.map(() => X[randomInt(rand, X.length)]);
            let bk = kMin, bb = Infinity;
            for (let k = kMin; k <= Math.min(kMax, 5); k++) {
                try {
                    const m = fitGmm(Xb, k, { ...cfg, nInit: 3, seed: (cfg.seed ?? 42) + 100 + b });
                    if (m.bic < bb) { bb = m.bic; bk = k; }
                } catch { /* a collapsed fit does not vote */ }
            }
            bootstrapK[bk] = (bootstrapK[bk] ?? 0) + 1;
        }
    }
    return { rows, bic: models.map(m => ({ k: m.k, bic: m.bic })), kBest: bestModel.k, model: bestModel, bootstrapK };
}
