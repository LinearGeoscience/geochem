/**
 * Linear regression utilities for calculating trend lines
 */

export type RegressionSpace = 'linear' | 'log-x' | 'log-y' | 'log-log';

export interface RegressionResult {
    slope: number;
    intercept: number;
    rSquared: number;
    xValues: number[];
    yValues: number[];
    space: RegressionSpace;
}

export interface RegressionOptions {
    logX?: boolean;
    logY?: boolean;
}

/**
 * Calculate linear regression (least squares method)
 *
 * When `logX` / `logY` are set, the fit is performed in log10 space on that
 * axis. `slope`, `intercept`, and `rSquared` are returned in *display* space
 * (i.e. the space matching the rendered axes). `xValues` / `yValues` are the
 * line endpoints in *data* space, so callers can hand them to a Plotly trace
 * whose axes are configured as log/linear and get a straight line.
 */
export function calculateLinearRegression(
    xData: number[],
    yData: number[],
    options: RegressionOptions = {}
): RegressionResult | null {
    const logX = !!options.logX;
    const logY = !!options.logY;

    if (xData.length !== yData.length || xData.length < 2) {
        return null;
    }

    const validPairs: { x: number; y: number }[] = [];
    for (let i = 0; i < xData.length; i++) {
        const x = xData[i];
        const y = yData[i];
        if (x == null || y == null || isNaN(x) || isNaN(y) || !isFinite(x) || !isFinite(y)) continue;
        if (logX && x <= 0) continue;
        if (logY && y <= 0) continue;
        validPairs.push({
            x: logX ? Math.log10(x) : x,
            y: logY ? Math.log10(y) : y,
        });
    }

    if (validPairs.length < 2) {
        return null;
    }

    const n = validPairs.length;
    const xs = validPairs.map(p => p.x);
    const ys = validPairs.map(p => p.y);

    const xMean = xs.reduce((sum, x) => sum + x, 0) / n;
    const yMean = ys.reduce((sum, y) => sum + y, 0) / n;

    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < n; i++) {
        const xDiff = xs[i] - xMean;
        const yDiff = ys[i] - yMean;
        numerator += xDiff * yDiff;
        denominator += xDiff * xDiff;
    }

    if (denominator === 0) {
        return null; // Vertical line, can't calculate slope
    }

    const slope = numerator / denominator;
    const intercept = yMean - slope * xMean;

    let ssRes = 0;
    let ssTot = 0;
    for (let i = 0; i < n; i++) {
        const predicted = slope * xs[i] + intercept;
        ssRes += (ys[i] - predicted) ** 2;
        ssTot += (ys[i] - yMean) ** 2;
    }
    const rSquared = ssTot === 0 ? 0 : 1 - (ssRes / ssTot);

    // Endpoints: min/max in transformed (display) space, then back-transform
    // x and y independently so Plotly's axes render a straight line.
    const xMinD = Math.min(...xs);
    const xMaxD = Math.max(...xs);
    const yMinD = slope * xMinD + intercept;
    const yMaxD = slope * xMaxD + intercept;

    const xValues = [
        logX ? Math.pow(10, xMinD) : xMinD,
        logX ? Math.pow(10, xMaxD) : xMaxD,
    ];
    const yValues = [
        logY ? Math.pow(10, yMinD) : yMinD,
        logY ? Math.pow(10, yMaxD) : yMaxD,
    ];

    const space: RegressionSpace = logX && logY ? 'log-log' : logX ? 'log-x' : logY ? 'log-y' : 'linear';

    return { slope, intercept, rSquared, xValues, yValues, space };
}

/**
 * Format a regression's equation for a Plotly hover template.
 *
 * For log-fitted regressions, both the display-space equation and the
 * equivalent back-transformed form are returned (separated by `<br>`), so the
 * user can read either the linear fit on log axes or the underlying
 * power-law / exponential relation.
 */
export function formatRegressionEquation(r: RegressionResult): string {
    const m = r.slope;
    const b = r.intercept;
    const mStr = m.toFixed(4);
    const bStr = b.toFixed(4);

    switch (r.space) {
        case 'log-log': {
            const a = Math.pow(10, b);
            return `log₁₀(y) = ${mStr}·log₁₀(x) + ${bStr}<br>y = ${a.toPrecision(4)}·x^${mStr}`;
        }
        case 'log-y': {
            const a = Math.pow(10, b);
            return `log₁₀(y) = ${mStr}·x + ${bStr}<br>y = ${a.toPrecision(4)}·10^(${mStr}·x)`;
        }
        case 'log-x':
            return `y = ${mStr}·log₁₀(x) + ${bStr}`;
        case 'linear':
        default:
            return `y = ${mStr}x + ${bStr}`;
    }
}
