/**
 * Web Worker for IDW interpolation.
 * Moves heavy grid computation + smoothing + masking off the main thread.
 */

interface IDWPoint {
    x: number;
    y: number;
    value: number;
}

interface IDWOptions {
    gridSize?: number;
    power?: number;
    searchRadius?: number;
    padding?: number;
    smoothing?: number;
}

interface IDWGridResult {
    x: number[];
    y: number[];
    z: (number | null)[][];
}

// ─── Gaussian smoothing ──────────────────────────────────────────────────────

function buildGaussianKernel(sigma: number): { weights: number[][]; radius: number } {
    const radius = Math.min(Math.ceil(3 * sigma), 30);
    const weights: number[][] = [];
    let sum = 0;
    const twoSigma2 = 2 * sigma * sigma;

    for (let r = -radius; r <= radius; r++) {
        const row: number[] = [];
        for (let c = -radius; c <= radius; c++) {
            const d2 = r * r + c * c;
            const w = d2 <= (3 * sigma) * (3 * sigma) ? Math.exp(-d2 / twoSigma2) : 0;
            row.push(w);
            sum += w;
        }
        weights.push(row);
    }

    if (sum > 0) {
        for (let r = 0; r < weights.length; r++) {
            for (let c = 0; c < weights[0].length; c++) {
                weights[r][c] /= sum;
            }
        }
    }

    return { weights, radius };
}

function smoothGrid(
    z: (number | null)[][],
    rows: number,
    cols: number,
    sigma: number
): (number | null)[][] {
    if (sigma <= 0) return z;

    const { weights, radius } = buildGaussianKernel(sigma);
    const kSize = 2 * radius + 1;
    const result: (number | null)[][] = [];

    for (let r = 0; r < rows; r++) {
        const outRow: (number | null)[] = [];
        for (let c = 0; c < cols; c++) {
            let weightedSum = 0;
            let totalWeight = 0;

            for (let kr = 0; kr < kSize; kr++) {
                const gr = r + kr - radius;
                if (gr < 0 || gr >= rows) continue;
                for (let kc = 0; kc < kSize; kc++) {
                    const gc = c + kc - radius;
                    if (gc < 0 || gc >= cols) continue;
                    const val = z[gr][gc];
                    if (val === null) continue;
                    const w = weights[kr][kc];
                    if (w === 0) continue;
                    weightedSum += w * val;
                    totalWeight += w;
                }
            }

            outRow.push(totalWeight === 0 ? null : weightedSum / totalWeight);
        }
        result.push(outRow);
    }

    return result;
}

// ─── Auto search radius ─────────────────────────────────────────────────────

function estimateSearchRadius(points: IDWPoint[]): number {
    const n = points.length;
    if (n < 2) return Infinity;

    const sampleSize = Math.min(n, 300);
    const step = Math.max(1, Math.floor(n / sampleSize));
    const nnDists: number[] = [];

    for (let i = 0; i < n; i += step) {
        let minDist2 = Infinity;
        for (let j = 0; j < n; j++) {
            if (i === j) continue;
            const dx = points[i].x - points[j].x;
            const dy = points[i].y - points[j].y;
            const d2 = dx * dx + dy * dy;
            if (d2 < minDist2) minDist2 = d2;
        }
        if (minDist2 < Infinity) {
            nnDists.push(Math.sqrt(minDist2));
        }
    }

    if (nnDists.length === 0) return Infinity;

    nnDists.sort((a, b) => a - b);
    const median = nnDists[Math.floor(nnDists.length / 2)];
    return median * 10;
}

// ─── Soft density mask ───────────────────────────────────────────────────────

function applySoftMask(
    z: (number | null)[][],
    gridXCoords: number[],
    gridYCoords: number[],
    px: Float64Array,
    py: Float64Array,
    searchRadius: number,
    gridSize: number
): (number | null)[][] {
    const innerRadius = searchRadius * 1.5;
    const outerRadius = searchRadius * 3.0;
    const innerRadius2 = innerRadius * innerRadius;
    const outerRadius2 = outerRadius * outerRadius;
    const taperRange = outerRadius - innerRadius;

    for (let row = 0; row < gridSize; row++) {
        const gy = gridYCoords[row];
        for (let col = 0; col < gridSize; col++) {
            const val = z[row][col];
            if (val === null) continue;
            const gx = gridXCoords[col];

            let minDist2 = Infinity;
            for (let i = 0; i < px.length; i++) {
                const dx = gx - px[i];
                const dy = gy - py[i];
                const d2 = dx * dx + dy * dy;
                if (d2 < minDist2) {
                    minDist2 = d2;
                    if (d2 <= innerRadius2) break;
                }
            }

            if (minDist2 > outerRadius2) {
                z[row][col] = null;
            } else if (minDist2 > innerRadius2) {
                const dist = Math.sqrt(minDist2);
                const fade = 1 - (dist - innerRadius) / taperRange;
                z[row][col] = val * fade + 1.0 * (1 - fade);
            }
        }
    }

    return z;
}

// ─── Main IDW computation ────────────────────────────────────────────────────

function computeIDWGrid(points: IDWPoint[], options: IDWOptions = {}): IDWGridResult {
    const {
        gridSize = 150,
        power = 1.5,
        padding = 0.05,
        smoothing = 4.0,
    } = options;

    if (points.length === 0) {
        return { x: [], y: [], z: [] };
    }

    const searchRadius = options.searchRadius ?? estimateSearchRadius(points);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }

    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const padX = rangeX * padding;
    const padY = rangeY * padding;
    minX -= padX; maxX += padX;
    minY -= padY; maxY += padY;

    const stepX = (maxX - minX) / (gridSize - 1);
    const stepY = (maxY - minY) / (gridSize - 1);
    const gridXCoords: number[] = [];
    const gridYCoords: number[] = [];
    for (let i = 0; i < gridSize; i++) {
        gridXCoords.push(minX + i * stepX);
        gridYCoords.push(minY + i * stepY);
    }

    const searchRadius2 = searchRadius * searchRadius;
    const n = points.length;
    const px = new Float64Array(n);
    const py = new Float64Array(n);
    const pv = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        px[i] = points[i].x;
        py[i] = points[i].y;
        pv[i] = points[i].value;
    }

    let z: (number | null)[][] = [];
    for (let row = 0; row < gridSize; row++) {
        const gy = gridYCoords[row];
        const zRow: (number | null)[] = [];
        for (let col = 0; col < gridSize; col++) {
            const gx = gridXCoords[col];
            let weightedSum = 0;
            let totalWeight = 0;
            let exactHit = false;

            for (let i = 0; i < n; i++) {
                const dx = gx - px[i];
                const dy = gy - py[i];
                const dist2 = dx * dx + dy * dy;

                if (dist2 < 1e-10) {
                    weightedSum = pv[i];
                    totalWeight = 1;
                    exactHit = true;
                    break;
                }
                if (dist2 > searchRadius2) continue;

                const w = power === 2 ? 1 / dist2 : 1 / Math.pow(Math.sqrt(dist2), power);
                weightedSum += w * pv[i];
                totalWeight += w;
            }

            zRow.push(totalWeight === 0 && !exactHit ? null : weightedSum / totalWeight);
        }
        z.push(zRow);
    }

    if (smoothing > 0) {
        z = smoothGrid(z, gridSize, gridSize, smoothing);
    }

    z = applySoftMask(z, gridXCoords, gridYCoords, px, py, searchRadius, gridSize);

    return { x: gridXCoords, y: gridYCoords, z };
}

// Worker message handler
self.onmessage = (e: MessageEvent) => {
    const { id, points, options } = e.data;
    try {
        const result = computeIDWGrid(points, options);
        self.postMessage({ id, result });
    } catch (error: unknown) {
        self.postMessage({ id, error: error instanceof Error ? error.message : 'IDW computation failed' });
    }
};
