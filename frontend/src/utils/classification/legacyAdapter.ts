/**
 * Schema v3 (types/diagram.ts) → the older ClassificationDiagram shape that
 * ClassificationPlot and the diagram editor still consume. Temporary: the
 * Phase 24 renderer reads v3 directly.
 *
 * Bézier segments are flattened here; ternary points go back to the source
 * Cartesian triangle that the old renderer expects.
 */
import type { Diagram, Pt, PathSegment } from '../../types/diagram';
import type { ClassificationDiagram, DiagramPolygon } from '../../types/classificationDiagram';
import { TERNARY_HEIGHT } from './interopXml';

const CUBIC_STEPS = 16;

/** [a, b, c] percent → Cartesian [x, y]. */
export function ternaryToCartesian(p: Pt): { x: number; y: number } {
    return { x: p[2] + p[0] / 2, y: (p[0] / 100) * TERNARY_HEIGHT };
}

function cubicPoint(p0: Pt, c1: Pt, c2: Pt, p3: Pt, t: number): Pt {
    const u = 1 - t;
    const k0 = u * u * u, k1 = 3 * u * u * t, k2 = 3 * u * t * t, k3 = t * t * t;
    return p0.map((_, i) => k0 * p0[i] + k1 * c1[i] + k2 * c2[i] + k3 * p3[i]);
}

/** Flatten a path to vertices (start included). */
export function flattenPath(start: Pt, path: PathSegment[], steps = CUBIC_STEPS): Pt[] {
    const out: Pt[] = [start];
    let prev = start;
    for (const s of path) {
        if (s.kind === 'line') {
            out.push(s.to);
        } else {
            for (let k = 1; k <= steps; k++) out.push(cubicPoint(prev, s.c1, s.c2, s.to, k / steps));
        }
        prev = s.to;
    }
    return out;
}

/** Cartesian [x, y] → [a, b, c] percent. */
function cartesianToAbc(x: number, y: number): Pt {
    const a = (y / TERNARY_HEIGHT) * 100;
    const c = x - a / 2;
    return [a, 100 - a - c, c];
}

/**
 * Legacy (v2) diagram → schema v3, for custom diagrams made in the diagram
 * editor and diagrams saved in older projects. Polygon vertices become
 * straight segments; ternary geometry moves to [a, b, c] percent.
 */
export function fromLegacyDiagram(cd: ClassificationDiagram): Diagram {
    const ternary = cd.type === 'ternary';
    const pt = (p: { x: number; y: number }): Pt => (ternary ? cartesianToAbc(p.x, p.y) : [p.x, p.y]);
    const fracPt = (a: number, b: number): Pt => [a * 100, b * 100, Math.max(0, 100 - a * 100 - b * 100)];
    const pos = (o: { x?: number; y?: number; a?: number; b?: number }): Pt | null =>
        ternary
            ? (o.a != null && o.b != null ? fracPt(o.a, o.b) : null)
            : (o.x != null && o.y != null ? [o.x, o.y] : null);

    const axes: Diagram['axes'] = {};
    for (const [k, ax] of Object.entries(cd.axes)) {
        if (!ax) continue;
        axes[k as keyof typeof axes] = { kind: ax.formula ? 'function' : 'free', name: ax.name, formula: ax.formula, log: !!ax.log };
    }

    return {
        id: cd.id,
        legacyIds: cd.legacyIds,
        name: cd.name,
        kind: ternary ? 'ternary' : 'xy',
        category: [cd.category, ...(cd.subCategory ? cd.subCategory.split(' / ') : [])],
        sourceFile: '',
        variateMode: cd.variateMode,
        axes,
        variables: (cd.variables ?? []).map(v => ({ letter: v.letter, element: v.element, unit: v.unit })),
        expressions: cd.expressions,
        fields: cd.polygons.filter(p => p.points.length > 1).map(p => {
            let labelPos: Pt | undefined;
            if (p.labelPos) {
                labelPos = 'a' in p.labelPos ? fracPt(p.labelPos.a, p.labelPos.b) : pt(p.labelPos);
            }
            return {
                name: p.name,
                color: p.color,
                closed: p.closed !== false,
                visible: p.visible !== false,
                start: pt(p.points[0]),
                path: p.points.slice(1).map(q => ({ kind: 'line' as const, to: pt(q) })),
                labelPos,
                labelAngleDeg: p.labelAngle,
            };
        }),
        lines: cd.lines?.map(l => ({
            name: l.name, color: l.color, visible: true,
            slope: Math.abs(l.slope) >= 1e9 ? 0 : l.slope,
            intercept: l.intercept,
            vertical: Math.abs(l.slope) >= 1e9 || undefined,
            labelAngleDeg: l.labelAngle,
        })),
        points: cd.pointFeatures?.flatMap(p => {
            const q = pos(p);
            return q ? [{ name: p.name, color: p.color, visible: true, pos: q, pixelRadius: p.pixelRadius }] : [];
        }),
        labels: cd.labels?.flatMap(l => {
            const q = pos(l);
            return q ? [{ text: l.name, color: l.color, visible: true, pos: q, angleDeg: l.angle }] : [];
        }),
        bounds: cd.bounds,
        comments: cd.comments ?? [],
        references: cd.references ?? [],
    };
}

export function toLegacyDiagram(d: Diagram): ClassificationDiagram | null {
    if (d.kind === 'builtin') return null;
    const ternary = d.kind === 'ternary';
    const pt = (p: Pt) => (ternary ? ternaryToCartesian(p) : { x: p[0], y: p[1] });
    const frac = (p: Pt) => ({ a: p[0] / 100, b: p[1] / 100 });

    const axes: ClassificationDiagram['axes'] = {};
    // Element axes with a unit (<GeochemAxisY element="Ti" unit="ppm">) become a
    // one-letter formula on their own variable, so the resolver converts the data unit
    const variables = d.variables.map(v => ({
        letter: v.letter,
        element: v.element ?? v.columnName ?? '',
        unit: v.unit ?? 'free',
    }));
    const spare = 'ZYXWVUTSRQPONMLKJIHGFEDCBA'.split('').filter(l => !variables.some(v => v.letter.toUpperCase() === l));
    for (const [k, ax] of Object.entries(d.axes)) {
        if (!ax) continue;
        if (ax.kind === 'element' && ax.element && ax.unit && !ax.formula && spare.length) {
            const letter = spare.shift()!;
            variables.push({ letter, element: ax.element, unit: ax.unit });
            axes[k as keyof typeof axes] = { name: ax.name, formula: letter, log: ax.log };
            continue;
        }
        axes[k as keyof typeof axes] = { name: ax.name, formula: ax.formula, log: ax.log };
    }

    const polygons: DiagramPolygon[] = d.fields.map(f => {
        const poly: DiagramPolygon = {
            name: f.name,
            color: f.color,
            points: flattenPath(f.start, f.path).map(pt),
            visible: f.visible,
            labelAngle: f.labelAngleDeg,
        };
        if (f.labelPos) poly.labelPos = ternary ? frac(f.labelPos) : { x: f.labelPos[0], y: f.labelPos[1] };
        if (!f.closed) poly.closed = false;
        return poly;
    });

    return {
        id: d.id,
        legacyIds: d.legacyIds,
        name: d.name,
        type: d.kind,
        category: d.category[0] ?? 'Uncategorized',
        subCategory: d.category.length > 1 ? d.category.slice(1).join(' / ') : undefined,
        axes,
        variables,
        expressions: d.expressions,
        variateMode: d.variateMode,
        polygons,
        lines: d.lines?.map(l => ({
            name: l.name,
            color: l.color,
            slope: l.vertical ? 1e12 : l.slope,
            intercept: l.intercept,
            labelAngle: l.labelAngleDeg,
        })),
        pointFeatures: d.points?.map(p => ({
            name: p.name,
            color: p.color,
            pixelRadius: p.pixelRadius,
            ...(ternary ? frac(p.pos) : { x: p.pos[0], y: p.pos[1] }),
        })),
        labels: d.labels?.map(l => ({
            name: l.text,
            color: l.color,
            angle: l.angleDeg,
            ...(ternary ? frac(l.pos) : { x: l.pos[0], y: l.pos[1] }),
        })),
        bounds: d.bounds,
        comments: d.comments,
        references: d.references,
    };
}
