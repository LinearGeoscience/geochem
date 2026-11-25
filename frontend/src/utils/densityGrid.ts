/**
 * Density grid computation for heatmap visualizations.
 * Computes 2D density via binning + anisotropic Gaussian KDE for XY and ternary plots.
 * Uses Scott's rule bandwidth with data covariance for direction-aware smoothing.
 */

export interface DensityGridOptions {
    gridSize?: number;           // default: 100
    smoothingSigma?: number;     // default: 2.0, range 0.5-8.0 (bandwidth multiplier: slider/2 × Scott's rule)
    minDensityThreshold?: number; // default: 0.01
    sqrtNorm?: boolean;          // default: false, apply sqrt to spread color gradient
}

export interface DensityGridResult {
    z: (number | null)[][];  // gridSize x gridSize, null for below-threshold
    x: number[];             // x-axis tick values
    y: number[];             // y-axis tick values
}

export interface PointDensityResult {
    densities: number[];     // normalized 0-1 density per input point
}

/** Jet colorscale with transparent low-end (for heatmap traces behind points) */
export const DENSITY_JET_COLORSCALE: [number, string][] = [
    [0, 'rgba(0,0,131,0)'],
    [0.05, 'rgba(0,0,131,0.6)'],
    [0.125, 'rgb(0,60,170)'],
    [0.375, 'rgb(5,255,255)'],
    [0.625, 'rgb(255,255,0)'],
    [0.875, 'rgb(250,0,0)'],
    [1, 'rgb(128,0,0)']
];

/** Jet colorscale without transparency (for point coloring on ternary) */
export const DENSITY_JET_POINT_COLORSCALE: [number, string][] = [
    [0, 'rgb(0,0,131)'],
    [0.125, 'rgb(0,60,170)'],
    [0.375, 'rgb(5,255,255)'],
    [0.625, 'rgb(255,255,0)'],
    [0.875, 'rgb(250,0,0)'],
    [1, 'rgb(128,0,0)']
];

interface Kernel2D {
    weights: number[][];
    radiusR: number;  // row (y) direction
    radiusC: number;  // column (x) direction
}

/**
 * Compute the sample covariance matrix of input data.
 */
function computeCovarianceMatrix(xValues: number[], yValues: number[]): { varX: number; varY: number; covXY: number } {
    const n = xValues.length;
    let sumX = 0, sumY = 0;
    for (let i = 0; i < n; i++) {
        sumX += xValues[i];
        sumY += yValues[i];
    }
    const meanX = sumX / n;
    const meanY = sumY / n;

    let varX = 0, varY = 0, covXY = 0;
    for (let i = 0; i < n; i++) {
        const dx = xValues[i] - meanX;
        const dy = yValues[i] - meanY;
        varX += dx * dx;
        varY += dy * dy;
        covXY += dx * dy;
    }
    const denom = n - 1;
    return { varX: varX / denom, varY: varY / denom, covXY: covXY / denom };
}

/**
 * Build a 2D anisotropic Gaussian kernel from bandwidth matrix H (in grid cell units).
 * H = [[hxx, hxy], [hxy, hyy]].
 * Kernel is truncated at Mahalanobis distance 3.
 */
function buildAnisotropicKernel(hxx: number, hxy: number, hyy: number, maxRadius: number): Kernel2D {
    // Regularize if near-singular (collinear data or zero variance in one axis)
    let det = hxx * hyy - hxy * hxy;
    if (det < 1e-10 * (hxx * hyy + 1e-10)) {
        const reg = Math.max(hxx, hyy, 1) * 0.1;
        hxx += reg;
        hyy += reg;
        det = hxx * hyy - hxy * hxy;
    }

    // Precision matrix (H^-1) for Mahalanobis distance
    const invHxx = hyy / det;
    const invHxy = -hxy / det;
    const invHyy = hxx / det;

    // Kernel radius: 3σ along each axis, capped
    const radiusC = Math.min(Math.ceil(3 * Math.sqrt(Math.max(hxx, 1))), maxRadius);
    const radiusR = Math.min(Math.ceil(3 * Math.sqrt(Math.max(hyy, 1))), maxRadius);

    const weights: number[][] = [];
    let sum = 0;

    for (let r = -radiusR; r <= radiusR; r++) {
        const row: number[] = [];
        for (let c = -radiusC; c <= radiusC; c++) {
            const mahal2 = invHxx * c * c + 2 * invHxy * c * r + invHyy * r * r;
            if (mahal2 <= 9) {  // truncate at Mahalanobis distance 3
                const w = Math.exp(-0.5 * mahal2);
                row.push(w);
                sum += w;
            } else {
                row.push(0);
            }
        }
        weights.push(row);
    }

    // Normalize to sum to 1
    if (sum > 0) {
        for (let r = 0; r < weights.length; r++) {
            for (let c = 0; c < weights[0].length; c++) {
                weights[r][c] /= sum;
            }
        }
    }

    return { weights, radiusR, radiusC };
}

/**
 * Direct 2D convolution of a grid with an anisotropic kernel. Returns new grid.
 */
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

/**
 * Compute the anisotropic bandwidth kernel from data, applying Scott's rule.
 * smoothing slider value of 2.0 gives exactly Scott's rule bandwidth.
 */
function computeKernelFromData(
    xValues: number[], yValues: number[],
    xRange: number, yRange: number,
    gridSize: number, smoothing: number
): Kernel2D {
    const n = xValues.length;
    const dx = xRange / (gridSize - 1);
    const dy = yRange / (gridSize - 1);

    // Scott's rule: H = n^(-1/3) * Σ  (for d=2 dimensions)
    const cov = computeCovarianceMatrix(xValues, yValues);
    const scottFactor = Math.pow(n, -1 / 3);
    const userMultiplier = smoothing / 2.0;  // slider=2.0 → 1.0× Scott's rule
    const bwFactor = scottFactor * userMultiplier;

    // Bandwidth matrix in data coordinates
    const hDataXX = bwFactor * cov.varX;
    const hDataXY = bwFactor * cov.covXY;
    const hDataYY = bwFactor * cov.varY;

    // Convert to grid cell coordinates
    const hGridXX = hDataXX / (dx * dx);
    const hGridXY = hDataXY / (dx * dy);
    const hGridYY = hDataYY / (dy * dy);

    const maxRadius = Math.floor(gridSize / 2);
    return buildAnisotropicKernel(hGridXX, hGridXY, hGridYY, maxRadius);
}

/**
 * Compute a 2D density grid for an XY scatter plot.
 * Returns z (density), x (column coords), y (row coords) suitable for a Plotly heatmap trace.
 */
export function computeDensityGrid(
    xValues: number[],
    yValues: number[],
    options?: DensityGridOptions
): DensityGridResult | null {
    const gridSize = options?.gridSize ?? 100;
    const smoothing = options?.smoothingSigma ?? 2.0;
    const threshold = options?.minDensityThreshold ?? 0.01;

    if (xValues.length < 10 || yValues.length < 10) return null;

    // Find data range
    let xMin = Infinity, xMax = -Infinity;
    let yMin = Infinity, yMax = -Infinity;
    for (let i = 0; i < xValues.length; i++) {
        const xv = xValues[i], yv = yValues[i];
        if (xv < xMin) xMin = xv;
        if (xv > xMax) xMax = xv;
        if (yv < yMin) yMin = yv;
        if (yv > yMax) yMax = yv;
    }

    // Pad range by 2%
    let xRange = xMax - xMin;
    let yRange = yMax - yMin;
    if (xRange === 0) xRange = 1;
    if (yRange === 0) yRange = 1;
    const xPad = xRange * 0.02;
    const yPad = yRange * 0.02;
    xMin -= xPad; xMax += xPad;
    yMin -= yPad; yMax += yPad;
    xRange = xMax - xMin;
    yRange = yMax - yMin;

    // Create grid
    const grid: number[][] = [];
    for (let r = 0; r < gridSize; r++) {
        grid.push(new Array<number>(gridSize).fill(0));
    }

    // Bin points
    const xScale = (gridSize - 1) / xRange;
    const yScale = (gridSize - 1) / yRange;
    for (let i = 0; i < xValues.length; i++) {
        const col = Math.round((xValues[i] - xMin) * xScale);
        const row = Math.round((yValues[i] - yMin) * yScale);
        if (col >= 0 && col < gridSize && row >= 0 && row < gridSize) {
            grid[row][col]++;
        }
    }

    // Log-compress bin counts to reduce stacked-point dominance
    for (let r = 0; r < gridSize; r++) {
        for (let c = 0; c < gridSize; c++) {
            if (grid[r][c] > 0) {
                grid[r][c] = Math.log1p(grid[r][c]);
            }
        }
    }

    // Anisotropic KDE convolution
    const kernel = computeKernelFromData(xValues, yValues, xRange, yRange, gridSize, smoothing);
    const smoothed = convolve2D(grid, gridSize, gridSize, kernel);

    // Normalize to [0, 1] using max value
    let maxVal = 0;
    for (let r = 0; r < gridSize; r++) {
        for (let c = 0; c < gridSize; c++) {
            if (smoothed[r][c] > maxVal) maxVal = smoothed[r][c];
        }
    }
    if (maxVal === 0) return null;

    const z: (number | null)[][] = [];
    for (let r = 0; r < gridSize; r++) {
        const row: (number | null)[] = [];
        for (let c = 0; c < gridSize; c++) {
            const norm = smoothed[r][c] / maxVal;
            row.push(norm >= threshold ? norm : null);
        }
        z.push(row);
    }

    // Build axis tick arrays
    const xTicks: number[] = [];
    const yTicks: number[] = [];
    for (let i = 0; i < gridSize; i++) {
        xTicks.push(xMin + (i / (gridSize - 1)) * xRange);
        yTicks.push(yMin + (i / (gridSize - 1)) * yRange);
    }

    return { z, x: xTicks, y: yTicks };
}

/**
 * Compute per-point densities for XY data.
 * Each point gets a normalized 0-1 value from the density grid.
 */
export function computePointDensities(
    xValues: number[],
    yValues: number[],
    options?: DensityGridOptions
): PointDensityResult | null {
    const gridSize = options?.gridSize ?? 100;
    const smoothing = options?.smoothingSigma ?? 2.0;

    if (xValues.length < 10) return null;

    // Find range
    let xMin = Infinity, xMax = -Infinity;
    let yMin = Infinity, yMax = -Infinity;
    for (let i = 0; i < xValues.length; i++) {
        const xv = xValues[i], yv = yValues[i];
        if (xv < xMin) xMin = xv;
        if (xv > xMax) xMax = xv;
        if (yv < yMin) yMin = yv;
        if (yv > yMax) yMax = yv;
    }

    let xRange = xMax - xMin;
    let yRange = yMax - yMin;
    if (xRange === 0) xRange = 1;
    if (yRange === 0) yRange = 1;
    const xPad = xRange * 0.02;
    const yPad = yRange * 0.02;
    xMin -= xPad; xMax += xPad;
    yMin -= yPad; yMax += yPad;
    xRange = xMax - xMin;
    yRange = yMax - yMin;

    // Build grid
    const grid: number[][] = [];
    for (let r = 0; r < gridSize; r++) {
        grid.push(new Array<number>(gridSize).fill(0));
    }

    const xScale = (gridSize - 1) / xRange;
    const yScale = (gridSize - 1) / yRange;
    for (let i = 0; i < xValues.length; i++) {
        const col = Math.round((xValues[i] - xMin) * xScale);
        const row = Math.round((yValues[i] - yMin) * yScale);
        if (col >= 0 && col < gridSize && row >= 0 && row < gridSize) {
            grid[row][col]++;
        }
    }

    // Log-compress bin counts to reduce stacked-point dominance
    for (let r = 0; r < gridSize; r++) {
        for (let c = 0; c < gridSize; c++) {
            if (grid[r][c] > 0) {
                grid[r][c] = Math.log1p(grid[r][c]);
            }
        }
    }

    // Anisotropic KDE convolution
    const kernel = computeKernelFromData(xValues, yValues, xRange, yRange, gridSize, smoothing);
    const smoothed = convolve2D(grid, gridSize, gridSize, kernel);

    // Normalize to [0, 1] using max value
    let maxVal = 0;
    for (let r = 0; r < gridSize; r++) {
        for (let c = 0; c < gridSize; c++) {
            if (smoothed[r][c] > maxVal) maxVal = smoothed[r][c];
        }
    }
    if (maxVal === 0) return null;

    // Look up each point's density
    const densities: number[] = [];
    for (let i = 0; i < xValues.length; i++) {
        const col = Math.min(gridSize - 1, Math.max(0, Math.round((xValues[i] - xMin) * xScale)));
        const row = Math.min(gridSize - 1, Math.max(0, Math.round((yValues[i] - yMin) * yScale)));
        densities.push(smoothed[row][col] / maxVal);
    }

    // Apply sqrt normalization to spread color gradient across medium-density regions
    if (options?.sqrtNorm) {
        for (let i = 0; i < densities.length; i++) {
            densities[i] = Math.sqrt(densities[i]);
        }
    }

    return { densities };
}

/**
 * Compute per-point densities for ternary data.
 * Converts a/b/c to cartesian X/Y, runs density grid, returns per-point density.
 */
export function computeTernaryDensities(
    aValues: number[],
    bValues: number[],
    cValues: number[],
    options?: DensityGridOptions
): PointDensityResult | null {
    if (aValues.length < 10) return null;

    // Convert ternary to cartesian for density computation
    // Standard ternary layout: B at left, C at right, A at top
    const xCart: number[] = [];
    const yCart: number[] = [];
    for (let i = 0; i < aValues.length; i++) {
        const a = aValues[i];
        const b = bValues[i];
        const c = cValues[i];
        const sum = a + b + c;
        if (sum <= 0) {
            xCart.push(0);
            yCart.push(0);
            continue;
        }
        // Normalize
        const an = a / sum;
        const bn = b / sum;
        // Cartesian coordinates of ternary point
        xCart.push(0.5 * (2 * (1 - bn - an) + an));  // simplified: c_n + a_n/2
        yCart.push((Math.sqrt(3) / 2) * an);
    }

    return computePointDensities(xCart, yCart, options);
}
