/**
 * Point-in-field classification of samples on a diagram ("Colour Rows
 * from Polygon"). Works in plot space, so curved boundaries, log axes and
 * ternary closure are honoured exactly as drawn.
 */
import type { AxisKey, Diagram, Rgb } from '../../../types/diagram';
import { Box, P2, bboxOf, fieldPolyline, makeFrame, pointInPolygon, polygonArea, ternaryToXY } from './diagramGeometry';

export interface ClassifierField {
    name: string;
    color: Rgb;
    polygon: P2[];
    box: Box;
    area: number;
}

/** Field label as one line ("Basaltic\nandesite" → "Basaltic andesite"). */
export const cleanName = (s: string) => s.split('\n').map(t => t.trim()).filter(Boolean).join(' ');

/** The diagram's closed, visible, named fields in plot space, smallest first. */
export function classifierFields(d: Diagram): ClassifierField[] {
    const frame = makeFrame(d);
    const out: ClassifierField[] = [];
    for (const f of d.fields) {
        const name = cleanName(f.name);
        // Unnamed fields are backgrounds (e.g. the alteration-box frame)
        if (!f.closed || !f.visible || !name) continue;
        const polygon = fieldPolyline(f, frame, 1e-4);
        if (polygon.length < 4) continue;
        out.push({ name, color: f.color, polygon, box: bboxOf(polygon), area: polygonArea(polygon) });
    }
    // Nested fields (e.g. an outer "background" field around the boxes):
    // the smallest containing field wins
    return out.sort((p, q) => p.area - q.area);
}

/** Plot-space position of sample `i`, or null when it cannot be placed. */
function samplePoint(d: Diagram, get: (axis: AxisKey, i: number) => number | null, i: number, logX: boolean, logY: boolean): P2 | null {
    if (d.kind === 'ternary') {
        const a = get('a', i), b = get('b', i), c = get('c', i);
        if (a == null || b == null || c == null || a < 0 || b < 0 || c < 0) return null;
        const s = a + b + c;
        if (!(s > 0) || !Number.isFinite(s)) return null;
        return ternaryToXY([(a / s) * 100, (b / s) * 100, (c / s) * 100]);
    }
    const x = get('x', i), y = get('y', i);
    if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    if ((logX && x <= 0) || (logY && y <= 0)) return null;
    return [logX ? Math.log10(x) : x, logY ? Math.log10(y) : y];
}

/**
 * Field name for each of `n` samples (null = outside every field or not
 * plottable). `get(axis, i)` returns the sample's axis value.
 */
export function classifySamples(
    d: Diagram,
    get: (axis: AxisKey, i: number) => number | null,
    n: number,
    fields: ClassifierField[] = classifierFields(d),
): (string | null)[] {
    const { logX, logY } = makeFrame(d);
    const out: (string | null)[] = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
        const p = samplePoint(d, get, i, logX, logY);
        if (!p) continue;
        const [x, y] = p;
        for (const f of fields) {
            if (x < f.box.x0 || x > f.box.x1 || y < f.box.y0 || y > f.box.y1) continue;
            if (pointInPolygon(x, y, f.polygon)) { out[i] = f.name; break; }
        }
    }
    return out;
}

/** Distinct field names in drawing order with their diagram colours. */
export function fieldPalette(d: Diagram): { name: string; color: string }[] {
    const seen = new Map<string, string>();
    for (const f of d.fields) {
        const name = cleanName(f.name);
        if (!f.closed || !f.visible || !name) continue;
        if (!seen.has(name)) seen.set(name, `rgb(${f.color.r},${f.color.g},${f.color.b})`);
    }
    return [...seen].map(([name, color]) => ({ name, color }));
}
