/**
 * Density grid computation for heatmap visualizations.
 * Computes 2D density via binning + Gaussian blur for XY and ternary plots.
 */

export interface DensityGridOptions {
    gridSize?: number;           // default: 100
    smoothingSigma?: number;     // default: 2.0, range 0.5-8.0
    minDensityThreshold?: number; // default: 0.01
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

/**
 * Build a 1D Gaussian kernel of given sigma (truncated at 3*sigma).
 */
function gaussianKernel1D(sigma: number): number[] {
    const radius = Math.ceil(sigma * 3);
    const size = radius * 2 + 1;
    const kernel = new Array<number>(size);
    const s2 = 2 * sigma * sigma;
    let sum = 0;
    for (let i = 0; i < size; i++) {
        const x = i - radius;
        kernel[i] = Math.exp(-(x * x) / s2);
        sum += kernel[i];
    }
    // Normalize
    for (let i = 0; i < size; i++) kernel[i] /= sum;
    return kernel;
}

/**
 * Separable Gaussian blur on a 2D grid (in-place).
 * Horizontal pass then vertical pass with a 1D kernel.
 */
function gaussianBlur2D(grid: number[][], rows: number, cols: number, kernel: number[]): void {
    const radius = (kernel.length - 1) / 2;
    // Temp buffer for one row/column
    const temp = new Float64Array(Math.max(rows, cols));

    // Horizontal pass
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            let val = 0;
            for (let k = -radius; k <= radius; k++) {
                const cc = c + k;
                if (cc >= 0 && cc < cols) {
                    val += grid[r][cc] * kernel[k + radius];
                }
            }
            temp[c] = val;
        }
        for (let c = 0; c < cols; c++) grid[r][c] = temp[c];
    }

    // Vertical pass
    for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
            let val = 0;
            for (let k = -radius; k <= radius; k++) {
                const rr = r + k;
                if (rr >= 0 && rr < rows) {
                    val += grid[rr][c] * kernel[k + radius];
                }
            }
            temp[r] = val;
        }
        for (let r = 0; r < rows; r++) grid[r][c] = temp[r];
    }
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
    const sigma = options?.smoothingSigma ?? 2.0;
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

    // Gaussian blur
    const kernel = gaussianKernel1D(sigma);
    gaussianBlur2D(grid, gridSize, gridSize, kernel);

    // Normalize to [0, 1]
    let maxVal = 0;
    for (let r = 0; r < gridSize; r++) {
        for (let c = 0; c < gridSize; c++) {
            if (grid[r][c] > maxVal) maxVal = grid[r][c];
        }
    }

    const z: (number | null)[][] = [];
    if (maxVal > 0) {
        for (let r = 0; r < gridSize; r++) {
            const row: (number | null)[] = [];
            for (let c = 0; c < gridSize; c++) {
                const norm = grid[r][c] / maxVal;
                row.push(norm >= threshold ? norm : null);
            }
            z.push(row);
        }
    } else {
        return null;
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
    const sigma = options?.smoothingSigma ?? 2.0;

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

    // Blur
    const kernel = gaussianKernel1D(sigma);
    gaussianBlur2D(grid, gridSize, gridSize, kernel);

    // Find max
    let maxVal = 0;
    for (let r = 0; r < gridSize; r++) {
        for (let c = 0; c < gridSize; c++) {
            if (grid[r][c] > maxVal) maxVal = grid[r][c];
        }
    }

    if (maxVal === 0) return null;

    // Look up each point's density
    const densities: number[] = [];
    for (let i = 0; i < xValues.length; i++) {
        const col = Math.min(gridSize - 1, Math.max(0, Math.round((xValues[i] - xMin) * xScale)));
        const row = Math.min(gridSize - 1, Math.max(0, Math.round((yValues[i] - yMin) * yScale)));
        densities.push(grid[row][col] / maxVal);
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
