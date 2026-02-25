/**
 * Web Worker for density computation.
 * Moves KDE (kernel density estimation) off the main thread.
 */

// Re-implement the density functions here since workers can't import from the main bundle.

interface DensityGridOptions {
    gridSize?: number;
    smoothingSigma?: number;
    minDensityThreshold?: number;
    sqrtNorm?: boolean;
}

interface Kernel2D {
    weights: number[][];
    radiusR: number;
    radiusC: number;
}

function computeCovarianceMatrix(xValues: number[], yValues: number[]) {
    const n = xValues.length;
    let sumX = 0, sumY = 0;
    for (let i = 0; i < n; i++) { sumX += xValues[i]; sumY += yValues[i]; }
    const meanX = sumX / n, meanY = sumY / n;
    let varX = 0, varY = 0, covXY = 0;
    for (let i = 0; i < n; i++) {
        const dx = xValues[i] - meanX, dy = yValues[i] - meanY;
        varX += dx * dx; varY += dy * dy; covXY += dx * dy;
    }
    const d = n - 1;
    return { varX: varX / d, varY: varY / d, covXY: covXY / d };
}

function buildAnisotropicKernel(hxx: number, hxy: number, hyy: number, maxRadius: number): Kernel2D {
    let det = hxx * hyy - hxy * hxy;
    if (det < 1e-10 * (hxx * hyy + 1e-10)) {
        const reg = Math.max(hxx, hyy, 1) * 0.1;
        hxx += reg; hyy += reg;
        det = hxx * hyy - hxy * hxy;
    }
    const invHxx = hyy / det, invHxy = -hxy / det, invHyy = hxx / det;
    const radiusC = Math.min(Math.ceil(3 * Math.sqrt(Math.max(hxx, 1))), maxRadius);
    const radiusR = Math.min(Math.ceil(3 * Math.sqrt(Math.max(hyy, 1))), maxRadius);
    const weights: number[][] = [];
    let sum = 0;
    for (let r = -radiusR; r <= radiusR; r++) {
        const row: number[] = [];
        for (let c = -radiusC; c <= radiusC; c++) {
            const mahal2 = invHxx * c * c + 2 * invHxy * c * r + invHyy * r * r;
            const w = mahal2 <= 9 ? Math.exp(-0.5 * mahal2) : 0;
            row.push(w); sum += w;
        }
        weights.push(row);
    }
    if (sum > 0) {
        for (let r = 0; r < weights.length; r++)
            for (let c = 0; c < weights[0].length; c++)
                weights[r][c] /= sum;
    }
    return { weights, radiusR, radiusC };
}

function convolve2D(grid: number[][], rows: number, cols: number, kernel: Kernel2D): number[][] {
    const { weights, radiusR, radiusC } = kernel;
    const result: number[][] = [];
    for (let r = 0; r < rows; r++) {
        const outRow = new Array<number>(cols);
        for (let c = 0; c < cols; c++) {
            let val = 0;
            for (let kr = -radiusR; kr <= radiusR; kr++) {
                const rr = r + kr;
                if (rr < 0 || rr >= rows) continue;
                const kernelRow = weights[kr + radiusR];
                const gridRow = grid[rr];
                for (let kc = -radiusC; kc <= radiusC; kc++) {
                    const cc = c + kc;
                    if (cc < 0 || cc >= cols) continue;
                    val += gridRow[cc] * kernelRow[kc + radiusC];
                }
            }
            outRow[c] = val;
        }
        result.push(outRow);
    }
    return result;
}

function computeKernelFromData(xValues: number[], yValues: number[], xRange: number, yRange: number, gridSize: number, smoothing: number): Kernel2D {
    const n = xValues.length;
    const dx = xRange / (gridSize - 1), dy = yRange / (gridSize - 1);
    const cov = computeCovarianceMatrix(xValues, yValues);
    const scottFactor = Math.pow(n, -1 / 3);
    const bwFactor = scottFactor * (smoothing / 2.0);
    const hGridXX = bwFactor * cov.varX / (dx * dx);
    const hGridXY = bwFactor * cov.covXY / (dx * dy);
    const hGridYY = bwFactor * cov.varY / (dy * dy);
    return buildAnisotropicKernel(hGridXX, hGridXY, hGridYY, Math.floor(gridSize / 2));
}

function computePointDensities(xValues: number[], yValues: number[], options?: DensityGridOptions) {
    const gridSize = options?.gridSize ?? 100;
    const smoothing = options?.smoothingSigma ?? 2.0;
    if (xValues.length < 10) return null;

    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (let i = 0; i < xValues.length; i++) {
        const xv = xValues[i], yv = yValues[i];
        if (xv < xMin) xMin = xv; if (xv > xMax) xMax = xv;
        if (yv < yMin) yMin = yv; if (yv > yMax) yMax = yv;
    }
    let xRange = xMax - xMin, yRange = yMax - yMin;
    if (xRange === 0) xRange = 1; if (yRange === 0) yRange = 1;
    const xPad = xRange * 0.02, yPad = yRange * 0.02;
    xMin -= xPad; xMax += xPad; yMin -= yPad; yMax += yPad;
    xRange = xMax - xMin; yRange = yMax - yMin;

    const grid: number[][] = [];
    for (let r = 0; r < gridSize; r++) grid.push(new Array<number>(gridSize).fill(0));

    const xScale = (gridSize - 1) / xRange, yScale = (gridSize - 1) / yRange;
    for (let i = 0; i < xValues.length; i++) {
        const col = Math.round((xValues[i] - xMin) * xScale);
        const row = Math.round((yValues[i] - yMin) * yScale);
        if (col >= 0 && col < gridSize && row >= 0 && row < gridSize) grid[row][col]++;
    }
    for (let r = 0; r < gridSize; r++)
        for (let c = 0; c < gridSize; c++)
            if (grid[r][c] > 0) grid[r][c] = Math.log1p(grid[r][c]);

    const kernel = computeKernelFromData(xValues, yValues, xRange, yRange, gridSize, smoothing);
    const smoothed = convolve2D(grid, gridSize, gridSize, kernel);

    let maxVal = 0;
    for (let r = 0; r < gridSize; r++)
        for (let c = 0; c < gridSize; c++)
            if (smoothed[r][c] > maxVal) maxVal = smoothed[r][c];
    if (maxVal === 0) return null;

    const densities: number[] = [];
    for (let i = 0; i < xValues.length; i++) {
        const col = Math.min(gridSize - 1, Math.max(0, Math.round((xValues[i] - xMin) * xScale)));
        const row = Math.min(gridSize - 1, Math.max(0, Math.round((yValues[i] - yMin) * yScale)));
        densities.push(smoothed[row][col] / maxVal);
    }
    if (options?.sqrtNorm) {
        for (let i = 0; i < densities.length; i++) densities[i] = Math.sqrt(densities[i]);
    }
    return { densities };
}

// Message handler
self.onmessage = (e: MessageEvent) => {
    const { type, xValues, yValues, aValues, bValues, cValues, options, id } = e.data;

    try {
        if (type === 'pointDensities') {
            const result = computePointDensities(xValues, yValues, options);
            self.postMessage({ id, result });
        } else if (type === 'ternaryDensities') {
            if (!aValues || aValues.length < 10) {
                self.postMessage({ id, result: null });
                return;
            }
            // Convert ternary to cartesian
            const xCart: number[] = [], yCart: number[] = [];
            for (let i = 0; i < aValues.length; i++) {
                const a = aValues[i], b = bValues[i], c = cValues[i];
                const sum = a + b + c;
                if (sum <= 0) { xCart.push(0); yCart.push(0); continue; }
                const an = a / sum, bn = b / sum;
                xCart.push(0.5 * (2 * (1 - bn - an) + an));
                yCart.push((Math.sqrt(3) / 2) * an);
            }
            const result = computePointDensities(xCart, yCart, options);
            self.postMessage({ id, result });
        }
    } catch (err: any) {
        self.postMessage({ id, error: err.message });
    }
};
