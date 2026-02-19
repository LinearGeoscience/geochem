/**
 * Coordinate transform math for the diagram editor.
 *
 * Three coordinate spaces:
 *   Canvas pixels <-> Image pixels <-> Data coordinates
 */

import {
    ImagePoint,
    DataPoint,
    Viewport,
    AffineTransform,
    CalibrationPoint,
    TernaryVertices,
    TernaryFractions,
    SnapResult,
    EditorPolygon,
} from '../../../types/diagramEditor';
import { TERNARY_HEIGHT } from '../../../types/classificationDiagram';

// ─── Canvas <-> Image ────────────────────────────────────────────────

export function canvasToImage(canvasX: number, canvasY: number, viewport: Viewport): ImagePoint {
    return {
        x: (canvasX - viewport.offsetX) / viewport.scale,
        y: (canvasY - viewport.offsetY) / viewport.scale,
    };
}

export function imageToCanvas(imageX: number, imageY: number, viewport: Viewport): { x: number; y: number } {
    return {
        x: imageX * viewport.scale + viewport.offsetX,
        y: imageY * viewport.scale + viewport.offsetY,
    };
}

// ─── XY Calibration: Image -> Data (affine) ─────────────────────────

/**
 * Compute affine transform from calibration points (XY mode).
 * 2 points: direct solve (assumes orthogonal axes).
 * 3+ points: least-squares.
 *
 * Returns null if insufficient points or degenerate configuration.
 */
export function computeAffineTransform(
    points: CalibrationPoint[],
    logX: boolean,
    logY: boolean
): { transform: AffineTransform; residual: number } | null {
    if (points.length < 2) return null;

    // Work in log-space if requested
    const pts = points.map(p => ({
        px: p.imagePos.x,
        py: p.imagePos.y,
        dx: logX ? Math.log10(Math.max(p.dataX, 1e-10)) : p.dataX,
        dy: logY ? Math.log10(Math.max(p.dataY, 1e-10)) : p.dataY,
    }));

    if (pts.length === 2) {
        // Direct solve assuming orthogonal axes (b=0, e=0)
        const [p1, p2] = pts;
        const dPx = p2.px - p1.px;
        const dPy = p2.py - p1.py;

        if (Math.abs(dPx) < 1e-10 && Math.abs(dPy) < 1e-10) return null;

        // Solve for x: dataX = a * px + c
        const a = Math.abs(dPx) > 1e-10 ? (p2.dx - p1.dx) / dPx : 0;
        const c = p1.dx - a * p1.px;

        // Solve for y: dataY = e * py + f
        const e = Math.abs(dPy) > 1e-10 ? (p2.dy - p1.dy) / dPy : 0;
        const f = p1.dy - e * p1.py;

        return {
            transform: { a, b: 0, c, d: 0, e, f },
            residual: 0,
        };
    }

    // 3+ points: least-squares for full affine
    // Solve [px py 1] * [a; b; c] = [dx] and [px py 1] * [d; e; f] = [dy]
    const n = pts.length;
    let sumPx = 0, sumPy = 0, sumPx2 = 0, sumPy2 = 0, sumPxPy = 0;
    let sumDx = 0, sumDy = 0, sumPxDx = 0, sumPyDx = 0, sumPxDy = 0, sumPyDy = 0;

    for (const p of pts) {
        sumPx += p.px;
        sumPy += p.py;
        sumPx2 += p.px * p.px;
        sumPy2 += p.py * p.py;
        sumPxPy += p.px * p.py;
        sumDx += p.dx;
        sumDy += p.dy;
        sumPxDx += p.px * p.dx;
        sumPyDx += p.py * p.dx;
        sumPxDy += p.px * p.dy;
        sumPyDy += p.py * p.dy;
    }

    // Normal equations: A^T A x = A^T b
    // A^T A = [[sumPx2, sumPxPy, sumPx], [sumPxPy, sumPy2, sumPy], [sumPx, sumPy, n]]
    const ATA = [
        [sumPx2, sumPxPy, sumPx],
        [sumPxPy, sumPy2, sumPy],
        [sumPx, sumPy, n],
    ];

    const ATbX = [sumPxDx, sumPyDx, sumDx];
    const ATbY = [sumPxDy, sumPyDy, sumDy];

    const solveX = solve3x3(ATA, ATbX);
    const solveY = solve3x3(ATA, ATbY);

    if (!solveX || !solveY) return null;

    const transform: AffineTransform = {
        a: solveX[0], b: solveX[1], c: solveX[2],
        d: solveY[0], e: solveY[1], f: solveY[2],
    };

    // Compute residual
    let residualSum = 0;
    for (const p of pts) {
        const predX = transform.a * p.px + transform.b * p.py + transform.c;
        const predY = transform.d * p.px + transform.e * p.py + transform.f;
        residualSum += (predX - p.dx) ** 2 + (predY - p.dy) ** 2;
    }
    const residual = Math.sqrt(residualSum / n);

    return { transform, residual };
}

/** Solve 3x3 linear system using Cramer's rule */
function solve3x3(A: number[][], b: number[]): number[] | null {
    const det = A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1])
              - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0])
              + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);

    if (Math.abs(det) < 1e-15) return null;

    const x0 = (b[0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1])
              - A[0][1] * (b[1] * A[2][2] - A[1][2] * b[2])
              + A[0][2] * (b[1] * A[2][1] - A[1][1] * b[2])) / det;

    const x1 = (A[0][0] * (b[1] * A[2][2] - A[1][2] * b[2])
              - b[0] * (A[1][0] * A[2][2] - A[1][2] * A[2][0])
              + A[0][2] * (A[1][0] * b[2] - b[1] * A[2][0])) / det;

    const x2 = (A[0][0] * (A[1][1] * b[2] - b[1] * A[2][1])
              - A[0][1] * (A[1][0] * b[2] - b[1] * A[2][0])
              + b[0] * (A[1][0] * A[2][1] - A[1][1] * A[2][0])) / det;

    return [x0, x1, x2];
}

/**
 * Apply affine transform: image point -> data point
 */
export function imageToData(
    imagePoint: ImagePoint,
    transform: AffineTransform,
    logX: boolean,
    logY: boolean
): DataPoint {
    let dx = transform.a * imagePoint.x + transform.b * imagePoint.y + transform.c;
    let dy = transform.d * imagePoint.x + transform.e * imagePoint.y + transform.f;

    if (logX) dx = Math.pow(10, dx);
    if (logY) dy = Math.pow(10, dy);

    return { x: dx, y: dy };
}

/**
 * Inverse affine transform: data point -> image point
 */
export function dataToImage(
    dataPoint: DataPoint,
    transform: AffineTransform,
    logX: boolean,
    logY: boolean
): ImagePoint {
    let dx = logX ? Math.log10(Math.max(dataPoint.x, 1e-10)) : dataPoint.x;
    let dy = logY ? Math.log10(Math.max(dataPoint.y, 1e-10)) : dataPoint.y;

    // Solve: dx = a*px + b*py + c, dy = d*px + e*py + f
    const det = transform.a * transform.e - transform.b * transform.d;
    if (Math.abs(det) < 1e-15) return { x: 0, y: 0 };

    const px = (transform.e * (dx - transform.c) - transform.b * (dy - transform.f)) / det;
    const py = (transform.a * (dy - transform.f) - transform.d * (dx - transform.c)) / det;

    return { x: px, y: py };
}

// ─── Ternary Calibration: Image -> Ternary ──────────────────────────

/**
 * Convert image point to ternary fractions using barycentric coordinates.
 * Given triangle vertices A(top), B(bottom-left), C(bottom-right) in image space.
 */
export function imageToTernary(
    imagePoint: ImagePoint,
    vertices: TernaryVertices
): TernaryFractions | null {
    if (!vertices.a || !vertices.b || !vertices.c) return null;

    const A = vertices.a;
    const B = vertices.b;
    const C = vertices.c;

    const v0x = C.x - A.x;
    const v0y = C.y - A.y;
    const v1x = B.x - A.x;
    const v1y = B.y - A.y;
    const v2x = imagePoint.x - A.x;
    const v2y = imagePoint.y - A.y;

    const dot00 = v0x * v0x + v0y * v0y;
    const dot01 = v0x * v1x + v0y * v1y;
    const dot02 = v0x * v2x + v0y * v2y;
    const dot11 = v1x * v1x + v1y * v1y;
    const dot12 = v1x * v2x + v1y * v2y;

    const inv = 1 / (dot00 * dot11 - dot01 * dot01);
    if (!isFinite(inv)) return null;

    const u = (dot11 * dot02 - dot01 * dot12) * inv; // fraction c
    const v = (dot00 * dot12 - dot01 * dot02) * inv; // fraction b
    const w = 1 - u - v;                              // fraction a

    return {
        a: w * 100,
        b: v * 100,
        c: u * 100,
    };
}

/**
 * Convert ternary fractions to image point
 */
export function ternaryToImage(
    fractions: TernaryFractions,
    vertices: TernaryVertices
): ImagePoint | null {
    if (!vertices.a || !vertices.b || !vertices.c) return null;

    const total = fractions.a + fractions.b + fractions.c;
    if (total === 0) return null;

    const a = fractions.a / total;
    const b = fractions.b / total;
    const c = fractions.c / total;

    return {
        x: a * vertices.a.x + b * vertices.b.x + c * vertices.c.x,
        y: a * vertices.a.y + b * vertices.b.y + c * vertices.c.y,
    };
}

/**
 * Convert ternary fractions to XML Cartesian format (for export compatibility).
 * Inverse of xmlCartesianToTernary from classificationDiagram.ts.
 */
export function ternaryToXmlCartesian(a: number, b: number, c: number): { x: number; y: number } {
    const total = a + b + c;
    const normA = (a / total) * 100;
    const normC = (c / total) * 100;

    const y = normA * TERNARY_HEIGHT / 100;
    const yRatio = y / TERNARY_HEIGHT;
    const xMin = 50 * yRatio;
    const xMax = 100 - 50 * yRatio;
    const xRange = xMax - xMin;
    const remainder = 100 - normA;

    let x: number;
    if (remainder <= 0.001) {
        x = 50; // Apex
    } else {
        const cFrac = normC / remainder;
        x = xMin + cFrac * xRange;
    }

    return { x, y };
}

// ─── Image to Data (unified) ────────────────────────────────────────

/**
 * Convert image point to data point using whatever calibration is active
 */
export function imageToDataUnified(
    imagePoint: ImagePoint,
    diagramType: 'xy' | 'ternary',
    affineTransform: AffineTransform | null,
    ternaryVertices: TernaryVertices,
    logX: boolean,
    logY: boolean
): DataPoint | null {
    if (diagramType === 'xy') {
        if (!affineTransform) return null;
        return imageToData(imagePoint, affineTransform, logX, logY);
    } else {
        const fracs = imageToTernary(imagePoint, ternaryVertices);
        if (!fracs) return null;
        // Convert to XML Cartesian for internal storage
        return ternaryToXmlCartesian(fracs.a, fracs.b, fracs.c);
    }
}

// ─── Snap Logic ─────────────────────────────────────────────────────

const SNAP_THRESHOLD_IMAGE_PX = 8;

/**
 * Find the nearest existing vertex within snap threshold.
 */
export function findSnapTarget(
    imagePoint: ImagePoint,
    polygons: EditorPolygon[],
    activePolygonPoints: ImagePoint[],
    viewport: Viewport,
    excludePolygonId?: string
): SnapResult {
    let bestDist = Infinity;
    let bestPoint = imagePoint;
    let bestPolyId: string | undefined;
    let bestIdx: number | undefined;

    // Snap threshold in image space
    const threshold = SNAP_THRESHOLD_IMAGE_PX / viewport.scale * viewport.scale; // stays constant in image px

    // Check all completed polygon vertices
    for (const poly of polygons) {
        if (poly.id === excludePolygonId) continue;
        for (let i = 0; i < poly.imagePoints.length; i++) {
            const vp = poly.imagePoints[i];
            const dist = Math.hypot(vp.x - imagePoint.x, vp.y - imagePoint.y);
            if (dist < threshold && dist < bestDist) {
                bestDist = dist;
                bestPoint = vp;
                bestPolyId = poly.id;
                bestIdx = i;
            }
        }
    }

    // Check active polygon vertices (snap to first vertex to close)
    if (activePolygonPoints.length >= 3) {
        const first = activePolygonPoints[0];
        const dist = Math.hypot(first.x - imagePoint.x, first.y - imagePoint.y);
        if (dist < threshold && dist < bestDist) {
            bestDist = dist;
            bestPoint = first;
            bestPolyId = undefined;
            bestIdx = 0;
        }
    }

    return {
        snapped: bestDist < threshold,
        point: bestPoint,
        sourcePolygonId: bestPolyId,
        sourceVertexIndex: bestIdx,
    };
}

/**
 * Subdivide image-space line segments for accurate rendering on log axes.
 * On a log-scaled axis, straight lines in image space (visual space) are curves
 * in linear data space. We interpolate additional image points along each segment,
 * convert each to data, so the many short data-space segments approximate the
 * visual straight line.
 */
export function subdivideAndConvert(
    imagePoints: ImagePoint[],
    transform: AffineTransform,
    logX: boolean,
    logY: boolean,
    maxSegmentPx: number = 10,
): DataPoint[] {
    if (imagePoints.length === 0) return [];

    // If no log axes, just convert directly (no subdivision needed)
    if (!logX && !logY) {
        return imagePoints.map(ip => imageToData(ip, transform, false, false));
    }

    const result: DataPoint[] = [];
    result.push(imageToData(imagePoints[0], transform, logX, logY));

    for (let i = 1; i < imagePoints.length; i++) {
        const prev = imagePoints[i - 1];
        const curr = imagePoints[i];
        const dist = Math.hypot(curr.x - prev.x, curr.y - prev.y);
        const numSegments = Math.max(1, Math.ceil(dist / maxSegmentPx));

        for (let j = 1; j <= numSegments; j++) {
            const t = j / numSegments;
            const interpImage: ImagePoint = {
                x: prev.x + (curr.x - prev.x) * t,
                y: prev.y + (curr.y - prev.y) * t,
            };
            result.push(imageToData(interpImage, transform, logX, logY));
        }
    }

    return result;
}

/**
 * Distance between two image points
 */
export function imageDistance(a: ImagePoint, b: ImagePoint): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}
