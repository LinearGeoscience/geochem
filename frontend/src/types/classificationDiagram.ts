/**
 * Classification Diagram Types
 * Based on XML schema from IUGS and other geochemical classification systems
 */

export interface DiagramPolygon {
    name: string;
    color: { r: number; g: number; b: number };
    // Boundary points in the appropriate coordinate system
    points: { x: number; y: number }[];
    // Label position (for ternary: a,b fractions; for XY: x,y coords)
    labelPos?: { x: number; y: number };
    labelAngle?: number;
    visible?: boolean;
}

export interface DiagramAxis {
    name: string;
    formula?: string;  // For calculated axes like "SiO2" or "Na2O+K2O"
    log?: boolean;
}

export type DiagramType = 'ternary' | 'xy';

export interface ClassificationDiagram {
    id: string;
    name: string;
    type: DiagramType;
    category: string;  // e.g., "IUGS Diagrams", "Major Elements"
    subCategory?: string;

    // Axes
    axes: {
        a?: DiagramAxis;  // Top vertex for ternary
        b?: DiagramAxis;  // Bottom-left for ternary
        c?: DiagramAxis;  // Bottom-right for ternary
        x?: DiagramAxis;  // X-axis for XY
        y?: DiagramAxis;  // Y-axis for XY
    };

    // Classification fields
    polygons: DiagramPolygon[];

    // Metadata
    comments?: string[];
    references?: string[];
}

// For the diagram browser/selector
export interface DiagramCategory {
    name: string;
    diagrams: ClassificationDiagram[];
    subCategories?: DiagramCategory[];
}

// Style options for rendering
export type DiagramStyle = 'color' | 'bw' | 'minimal';

export interface DiagramRenderOptions {
    style: DiagramStyle;
    showLabels: boolean;
    showGrid: boolean;
    showData: boolean;
    fillOpacity: number;
}

// For coordinate conversion
export const TERNARY_HEIGHT = 86.60254037844387; // 100 * sqrt(3) / 2

/**
 * Convert XML Cartesian coordinates to ternary (a, b, c) percentages
 */
export function xmlCartesianToTernary(x: number, y: number): { a: number; b: number; c: number } {
    const aPct = (y / TERNARY_HEIGHT) * 100;
    const remainder = 100 - aPct;

    if (remainder <= 0.001) {
        return { a: aPct, b: 0, c: 0 };
    }

    const yRatio = y / TERNARY_HEIGHT;
    const xMin = 50 * yRatio;
    const xMax = 100 - 50 * yRatio;
    const xRange = xMax - xMin;

    if (xRange <= 0.001) {
        return { a: aPct, b: 0, c: 0 };
    }

    const xNormalized = (x - xMin) / xRange;
    const cPct = remainder * xNormalized;
    const bPct = remainder - cPct;

    return { a: aPct, b: bPct, c: cPct };
}

/**
 * Convert ternary coordinates to 2D Cartesian for rendering
 */
export function ternaryToCartesian2D(a: number, b: number, c: number): { x: number; y: number } {
    const total = a + b + c;
    if (total === 0) return { x: 0.5, y: 0.289 };

    const aFrac = a / total;
    const cFrac = c / total;

    const x = 0.5 * (2 * cFrac + aFrac);
    const y = (Math.sqrt(3) / 2) * aFrac;

    return { x, y };
}

/**
 * Calculate polygon centroid in ternary coordinates
 */
export function calculatePolygonCentroid(
    points: { a: number; b: number; c: number }[]
): { a: number; b: number; c: number } {
    if (!points.length) return { a: 33.3, b: 33.3, c: 33.3 };

    const cartPoints = points.map(p => ternaryToCartesian2D(p.a, p.b, p.c));

    // Close polygon
    if (cartPoints[0].x !== cartPoints[cartPoints.length - 1].x ||
        cartPoints[0].y !== cartPoints[cartPoints.length - 1].y) {
        cartPoints.push(cartPoints[0]);
    }

    let signedArea = 0;
    let cx = 0;
    let cy = 0;

    for (let i = 0; i < cartPoints.length - 1; i++) {
        const cross = cartPoints[i].x * cartPoints[i + 1].y -
                      cartPoints[i + 1].x * cartPoints[i].y;
        signedArea += cross;
        cx += (cartPoints[i].x + cartPoints[i + 1].x) * cross;
        cy += (cartPoints[i].y + cartPoints[i + 1].y) * cross;
    }

    signedArea *= 0.5;

    if (Math.abs(signedArea) < 0.0001) {
        const aSum = points.reduce((s, p) => s + p.a, 0);
        const bSum = points.reduce((s, p) => s + p.b, 0);
        const cSum = points.reduce((s, p) => s + p.c, 0);
        const n = points.length;
        return { a: aSum / n, b: bSum / n, c: cSum / n };
    }

    cx /= (6 * signedArea);
    cy /= (6 * signedArea);

    // Convert back to ternary
    const aFrac = cy / (Math.sqrt(3) / 2);
    const cFrac = (cx - 0.5 * aFrac);
    const bFrac = 1 - aFrac - cFrac;

    return { a: aFrac * 100, b: bFrac * 100, c: cFrac * 100 };
}

/**
 * Calculate polygon area (for font size decisions)
 */
export function calculatePolygonArea(points: { a: number; b: number; c: number }[]): number {
    if (points.length < 3) return 0;

    const cartPoints = points.map(p => ternaryToCartesian2D(p.a, p.b, p.c));
    const n = cartPoints.length;
    let area = 0;

    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += cartPoints[i].x * cartPoints[j].y;
        area -= cartPoints[j].x * cartPoints[i].y;
    }

    return Math.abs(area) / 2 * 10000;
}

/**
 * Determine if label should be external (for corner/edge polygons)
 */
export function shouldUseExternalLabel(
    centroid: { a: number; b: number; c: number },
    area: number,
    nameLength: number
): boolean {
    const { a, b, c } = centroid;

    // Very small polygons
    if (area < 15) return true;

    // Bottom corners
    if (a < 8) {
        if (b > 90 || c > 90) return true;
        if ((b > 80 || c > 80) && nameLength > 10) return true;
    }

    // Small edge polygons with long names
    if (area < 40 && nameLength > 12) {
        if (a < 12 || b > 75 || c > 75) return true;
    }

    return false;
}
