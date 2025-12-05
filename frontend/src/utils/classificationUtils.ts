import { ClassificationPolygon } from '../features/plots/classifications';

/**
 * Ray-casting algorithm to check if a point is inside a polygon.
 * @param point [x, y]
 * @param vs Array of [x, y] coordinates of the polygon vertices
 */
export const isPointInPolygon = (point: [number, number], vs: [number, number][]): boolean => {
    const x = point[0], y = point[1];
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        const xi = vs[i][0], yi = vs[i][1];
        const xj = vs[j][0], yj = vs[j][1];

        const intersect = ((yi > y) !== (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
};

/**
 * Classifies a dataset based on a list of polygons.
 * @param data Array of data objects
 * @param xCol Name of the X column
 * @param yCol Name of the Y column
 * @param polygons List of classification polygons
 * @returns Array of strings (class names) corresponding to the data
 */
export const classifyData = (
    data: any[],
    xCol: string,
    yCol: string,
    polygons: ClassificationPolygon[]
): string[] => {
    return data.map(row => {
        const x = parseFloat(row[xCol]);
        const y = parseFloat(row[yCol]);

        if (isNaN(x) || isNaN(y)) return 'Unclassified';

        for (const poly of polygons) {
            // Construct vertices array for the algorithm
            const vertices: [number, number][] = poly.x.map((vx, i) => [vx, poly.y[i]]);
            if (isPointInPolygon([x, y], vertices)) {
                return poly.name;
            }
        }
        return 'Unclassified';
    });
};
