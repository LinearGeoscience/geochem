/**
 * Web Worker for correlation matrix computation.
 * Moves Pearson/Spearman correlation + p-value computation off the main thread.
 */

const pearsonCorrelation = (x: number[], y: number[]): number => {
    const n = x.length;
    if (n === 0) return 0;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
    const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);
    const sumY2 = y.reduce((acc, yi) => acc + yi * yi, 0);
    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    if (denominator === 0) return 0;
    return numerator / denominator;
};

const spearmanCorrelation = (x: number[], y: number[]): number => {
    const n = x.length;
    if (n === 0) return 0;
    const rank = (arr: number[]): number[] => {
        const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
        const ranks = new Array(n);
        let i = 0;
        while (i < n) {
            let j = i;
            while (j < n - 1 && sorted[j].v === sorted[j + 1].v) j++;
            const avgRank = (i + j + 2) / 2;
            for (let k = i; k <= j; k++) ranks[sorted[k].i] = avgRank;
            i = j + 1;
        }
        return ranks;
    };
    return pearsonCorrelation(rank(x), rank(y));
};

const lnGamma = (z: number): number => {
    if (z <= 0) return 0;
    const coeff = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
    z -= 1;
    let x = coeff[0];
    for (let i = 1; i < 9; i++) x += coeff[i] / (z + i);
    const t = z + 7.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
};

const betaRegularized = (a: number, b: number, x: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
    const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta) / a;
    let f = 1, c = 1, d = 1 - (a + b) * x / (a + 1);
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d; f = d;
    for (let m = 1; m <= 200; m++) {
        let num = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m));
        d = 1 + num * d; if (Math.abs(d) < 1e-30) d = 1e-30;
        c = 1 + num / c; if (Math.abs(c) < 1e-30) c = 1e-30;
        d = 1 / d; f *= c * d;
        num = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1));
        d = 1 + num * d; if (Math.abs(d) < 1e-30) d = 1e-30;
        c = 1 + num / c; if (Math.abs(c) < 1e-30) c = 1e-30;
        d = 1 / d; const delta = c * d; f *= delta;
        if (Math.abs(delta - 1) < 1e-10) break;
    }
    return front * f;
};

const tDistPValue = (t: number, df: number): number => {
    if (df <= 0) return 1;
    if (df > 100) {
        const z = Math.abs(t);
        const phi = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
        const k = 1 / (1 + 0.2316419 * z);
        const poly = k * (0.31938153 + k * (-0.356563782 + k * (1.781477937 + k * (-1.821255978 + k * 1.330274429))));
        const val = 2 * phi * poly;
        return Math.max(0, Math.min(1, val));
    }
    const x = df / (df + t * t);
    return betaRegularized(df / 2, 0.5, x);
};

const correlationPValue = (r: number, n: number): number => {
    if (n <= 2) return 1;
    if (Math.abs(r) >= 1) return 0;
    const t = r * Math.sqrt((n - 2) / (1 - r * r));
    return tDistPValue(t, n - 2);
};

// Message handler
self.onmessage = (e: MessageEvent) => {
    const { columnNames, columnData, method, id } = e.data;
    // columnData: Record<string, number[]> — pre-extracted numeric arrays

    try {
        const n = columnNames.length;
        const matrix: number[][] = [];
        const pValues: number[][] = [];
        const sampleCounts: number[][] = [];

        for (let i = 0; i < n; i++) {
            matrix.push(new Array(n).fill(0));
            pValues.push(new Array(n).fill(1));
            sampleCounts.push(new Array(n).fill(0));
        }

        const corrFn = method === 'spearman' ? spearmanCorrelation : pearsonCorrelation;

        for (let i = 0; i < n; i++) {
            matrix[i][i] = 1;
            pValues[i][i] = 0;
            const xi = columnData[columnNames[i]];
            let validCount = 0;
            for (let k = 0; k < xi.length; k++) { if (!isNaN(xi[k])) validCount++; }
            sampleCounts[i][i] = validCount;

            for (let j = i + 1; j < n; j++) {
                const yj = columnData[columnNames[j]];
                // Pairwise complete: only use rows where both values exist
                const xPaired: number[] = [], yPaired: number[] = [];
                const minLen = Math.min(xi.length, yj.length);
                for (let k = 0; k < minLen; k++) {
                    if (xi[k] !== null && yj[k] !== null && !isNaN(xi[k]) && !isNaN(yj[k])) {
                        xPaired.push(xi[k]);
                        yPaired.push(yj[k]);
                    }
                }
                const rawR = xPaired.length >= 3 ? corrFn(xPaired, yPaired) : 0;
                const r = Math.round(rawR * 1000) / 1000;
                const p = xPaired.length >= 3 ? correlationPValue(rawR, xPaired.length) : 1;
                matrix[i][j] = r; matrix[j][i] = r;
                pValues[i][j] = p; pValues[j][i] = p;
                sampleCounts[i][j] = xPaired.length; sampleCounts[j][i] = xPaired.length;
            }

            // Report progress
            if (n > 10 && i % 5 === 0) {
                self.postMessage({ id, progress: (i + 1) / n });
            }
        }

        self.postMessage({ id, result: { matrix, pValues, sampleCounts } });
    } catch (err: any) {
        self.postMessage({ id, error: err.message });
    }
};
