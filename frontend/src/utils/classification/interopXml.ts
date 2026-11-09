/**
 * classification-diagram XML → Diagram (schema v3).
 *
 * Handles every construct in the diagram library (CDs/, 258 files):
 *  roots     GeochemXYDiagram | XYDiagram | FreeXYDiagram |
 *            GeochemTernaryDiagram | TernaryDiagram | FreeTernaryDiagram |
 *            RunAction (a built-in, e.g. the Piper diagram)
 *  axes      Geochem[Function]Axis{X,Y,A,B,C}, Free[Function]Axis{X,Y,A,B,C}
 *  data      Variable, FreeVariable, NamedExpression (Expression duplicates it)
 *  geometry  Poly (Boundary3 of ordered Linear / Cubic Bézier segments),
 *            Line (y = mx + c; |m| ≥ 1e9 is vertical), PointFeature /
 *            TPointFeature, Label / TLabel, Bounds
 *  metadata  Comment, Reference, Description, variateMode
 * The `_ v6.1 required to open diagram _` <Polygon> is a version
 * marker and is skipped.
 *
 * Ternary geometry: stores Poly vertices in a Cartesian equilateral
 * triangle (side 100, height 86.6) but LabelPos / TPointFeature / TLabel as
 * barycentric fractions {a, b}. Both become `[a, b, c]` percentages.
 */

import type {
    Diagram, DiagramAxisV3, DiagramField, DiagramKind, DiagramLabel, DiagramLine,
    DiagramPoint, DiagramVariableV3, PathSegment, Pt, Rgb, AxisKey,
} from '../../types/diagram';

export const TERNARY_SIDE = 100;
export const TERNARY_HEIGHT = 50 * Math.sqrt(3);

/** Cartesian triangle (x 0-100, y 0-86.6) → [a, b, c] percent. */
export function cartesianToTernary(x: number, y: number): Pt {
    const a = (y / TERNARY_HEIGHT) * 100;
    const c = x - a / 2;
    const b = 100 - a - c;
    return [a, b, c];
}

/** Barycentric fractions {a, b} (c = 1 - a - b) → [a, b, c] percent. */
export function fractionsToTernary(a: number, b: number): Pt {
    return [a * 100, b * 100, (1 - a - b) * 100];
}

const XY_ROOTS = new Set(['GeochemXYDiagram', 'XYDiagram', 'FreeXYDiagram']);
const TERNARY_ROOTS = new Set(['GeochemTernaryDiagram', 'TernaryDiagram', 'FreeTernaryDiagram']);
const VERSION_MARKER = /^_.*required to open diagram/i;
const VERTICAL_SLOPE = 1e9;

/** Known built-in diagrams that are referenced by class name only. */
const BUILTINS: Record<string, string> = {
    '.chart.xy.piper.DisplayPiper': 'piper',
};

export class InteropXmlError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InteropXmlError';
    }
}

export interface ParseMeta {
    sourceFile: string;
    category: string[];
}

export type XmlParser = (xml: string) => Document;

const defaultXmlParser: XmlParser = (xml) => new DOMParser().parseFromString(xml, 'application/xml');

/** Decode diagram XML bytes (declared windows-1252; honours a UTF-8 declaration). */
export function decodeInteropXml(bytes: ArrayBuffer | Uint8Array): string {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const head = new TextDecoder('ascii').decode(u8.subarray(0, 120));
    const enc = /encoding="([^"]+)"/i.exec(head)?.[1]?.toLowerCase() ?? 'windows-1252';
    return new TextDecoder(enc === 'utf-8' || enc === 'utf8' ? 'utf-8' : 'windows-1252').decode(u8);
}

/** Lower-case slug: non-alphanumerics → '_', runs collapsed, trimmed. */
export function slugify(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function diagramIdFor(category: string[], sourceFile: string): string {
    const stem = sourceFile.replace(/\.xml$/i, '');
    return [...category, stem].map(slugify).filter(Boolean).join('__');
}

/** embeds HTML line breaks in names. */
function cleanText(s: string | null | undefined): string {
    return (s ?? '')
        .replace(/<br\s*\/?>/gi, '\n')
        .split('\n').map(l => l.replace(/\s+/g, ' ').trim()).join('\n')
        .trim();
}

const num = (el: Element, attr: string, fallback = NaN): number => {
    const v = el.getAttribute(attr);
    if (v === null || v.trim() === '') return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
};

const bool = (el: Element, attr: string, fallback: boolean): boolean => {
    const v = el.getAttribute(attr);
    return v === null ? fallback : v.trim().toLowerCase() === 'true';
};

const children = (el: Element, tag?: string): Element[] =>
    Array.from(el.children).filter(c => !tag || c.tagName === tag);

const child = (el: Element, tag: string): Element | undefined => children(el, tag)[0];

function colourOf(el: Element): Rgb {
    const c = child(el, 'Colour');
    if (!c) return { r: 0, g: 0, b: 0 };
    return { r: num(c, 'r', 0), g: num(c, 'g', 0), b: num(c, 'b', 0) };
}

/** LabelAngle is in radians. */
function angleOf(el: Element): number | undefined {
    const a = child(el, 'LabelAngle');
    if (!a) return undefined;
    const rad = num(a, 'angle', 0);
    if (!rad) return undefined;
    return Math.round((rad * 180 / Math.PI) * 1e4) / 1e4;
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;
const roundPt = (p: Pt): Pt => p.map(round);

export function parseInteropDiagram(xml: string, meta: ParseMeta, parseXml: XmlParser = defaultXmlParser): Diagram {
    const doc = parseXml(xml);
    const err = doc.getElementsByTagName('parsererror')[0];
    if (err) throw new InteropXmlError(`${meta.sourceFile}: invalid XML (${cleanText(err.textContent).slice(0, 120)})`);
    const root = doc.documentElement;
    const tag = root.tagName;
    const stem = meta.sourceFile.replace(/\.xml$/i, '');

    const base = {
        id: diagramIdFor(meta.category, meta.sourceFile),
        category: meta.category,
        sourceFile: meta.sourceFile,
    };

    if (tag === 'RunAction') {
        const cls = root.getAttribute('class') ?? '';
        const builtin = Object.entries(BUILTINS).find(([suffix]) => cls.endsWith(suffix))?.[1];
        if (!builtin) throw new InteropXmlError(`${meta.sourceFile}: unsupported action ${cls}`);
        return {
            ...base, name: stem, kind: 'builtin', builtin,
            axes: {}, variables: [], fields: [], comments: [], references: [],
        };
    }

    let kind: DiagramKind;
    if (XY_ROOTS.has(tag)) kind = 'xy';
    else if (TERNARY_ROOTS.has(tag)) kind = 'ternary';
    else throw new InteropXmlError(`${meta.sourceFile}: unknown diagram root <${tag}>`);
    const ternary = kind === 'ternary';

    // A positioned element: x/y (Cartesian) or a/b (barycentric fractions)
    const posOf = (el: Element): Pt | undefined => {
        if (el.hasAttribute('a') && el.hasAttribute('b')) {
            const a = num(el, 'a'), b = num(el, 'b');
            if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
            return roundPt(fractionsToTernary(a, b));
        }
        const x = num(el, 'x'), y = num(el, 'y');
        if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
        return roundPt(ternary ? cartesianToTernary(x, y) : [x, y]);
    };

    const bezier = (el: Element): Pt => {
        const x = num(el, 'x'), y = num(el, 'y');
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new InteropXmlError(`${meta.sourceFile}: BezierPoint without numeric x/y`);
        }
        return roundPt(ternary ? cartesianToTernary(x, y) : [x, y]);
    };

    // ---- axes ------------------------------------------------------------
    const axes: Partial<Record<AxisKey, DiagramAxisV3>> = {};
    for (const el of children(root)) {
        const m = /^(Geochem|Free)(Function)?Axis([XYABC])$/.exec(el.tagName);
        if (!m) continue;
        const key = m[3].toLowerCase() as AxisKey;
        const isFree = m[1] === 'Free';
        const isFn = !!m[2];
        const log = bool(el, 'log', false);
        if (isFn) {
            axes[key] = {
                kind: isFree ? 'freeFunction' : 'function',
                name: cleanText(el.getAttribute('name')),
                formula: (el.getAttribute('function') ?? '').trim(),
                log,
            };
        } else if (isFree) {
            axes[key] = { kind: 'free', name: cleanText(el.getAttribute('name')), log };
        } else {
            const element = (el.getAttribute('element') ?? '').trim();
            axes[key] = {
                kind: 'element', name: element, element,
                unit: el.getAttribute('unit') ?? undefined, log,
            };
        }
    }
    const want: AxisKey[] = ternary ? ['a', 'b', 'c'] : ['x', 'y'];
    for (const k of want) {
        if (!axes[k]) throw new InteropXmlError(`${meta.sourceFile}: missing ${k.toUpperCase()} axis`);
    }

    // ---- variables & expressions ------------------------------------------
    const variables: DiagramVariableV3[] = [];
    for (const el of children(root, 'Variable')) {
        variables.push({
            letter: (el.getAttribute('letter') ?? '').trim().toUpperCase(),
            element: (el.getAttribute('element') ?? '').trim(),
            unit: el.getAttribute('unit') ?? undefined,
        });
    }
    for (const el of children(root, 'FreeVariable')) {
        variables.push({
            letter: (el.getAttribute('letter') ?? '').trim().toUpperCase(),
            columnName: (el.getAttribute('columnName') ?? '').trim(),
        });
    }
    // <Expression> mirrors <NamedExpression>; prefer the named form.
    const exprEls = children(root, 'NamedExpression').length
        ? children(root, 'NamedExpression') : children(root, 'Expression');
    const expressions = exprEls.map(el => ({
        letter: (el.getAttribute('letter') ?? '').trim().toUpperCase(),
        expression: (el.getAttribute('expression') ?? '').trim(),
    }));

    // ---- fields (Poly) ------------------------------------------------------
    const fields: DiagramField[] = [];
    for (const el of children(root, 'Poly')) {
        const boundary = child(el, 'Boundary3');
        if (!boundary) continue;
        const closed = bool(el, 'closed', true);
        const segs: { kind: 'Linear' | 'Cubic'; pts: Pt[] }[] = [];
        for (const s of children(boundary)) {
            if (s.tagName !== 'Linear' && s.tagName !== 'Cubic') continue;
            const pts = children(s, 'BezierPoint').map(bezier);
            if (s.tagName === 'Linear' && pts.length !== 1) {
                throw new InteropXmlError(`${meta.sourceFile}: Linear segment with ${pts.length} points`);
            }
            if (s.tagName === 'Cubic' && pts.length !== 3) {
                throw new InteropXmlError(`${meta.sourceFile}: Cubic segment with ${pts.length} points`);
            }
            segs.push({ kind: s.tagName, pts });
        }
        if (segs.length === 0) continue;

        // A path that opens with a Linear point starts there. A closed path
        // made of curves starts where its last segment ends (it loops).
        let start: Pt;
        let rest = segs;
        if (segs[0].kind === 'Linear') {
            start = segs[0].pts[0];
            rest = segs.slice(1);
        } else if (closed) {
            const last = segs[segs.length - 1];
            start = last.pts[last.pts.length - 1];
        } else {
            throw new InteropXmlError(`${meta.sourceFile}: open path starting with a curve`);
        }
        const path: PathSegment[] = rest.map(s => s.kind === 'Linear'
            ? { kind: 'line', to: s.pts[0] }
            : { kind: 'cubic', c1: s.pts[0], c2: s.pts[1], to: s.pts[2] });
        // A single-point Poly draws nothing in the reference software (stray digitising click)
        if (path.length === 0) continue;

        const labelEl = child(el, 'LabelPos');
        const field: DiagramField = {
            name: cleanText(el.getAttribute('name')),
            color: colourOf(el),
            closed,
            visible: bool(el, 'visible', true),
            start,
            path,
        };
        if (bool(el, 'endArrow', false)) field.endArrow = true;
        const labelPos = labelEl ? posOf(labelEl) : undefined;
        if (labelPos) field.labelPos = labelPos;
        const angle = angleOf(el);
        if (angle !== undefined) field.labelAngleDeg = angle;
        fields.push(field);
    }

    // ---- lines --------------------------------------------------------------
    const lines: DiagramLine[] = children(root, 'Line').map(el => {
        const m = num(el, 'm', 0), c = num(el, 'c', 0);
        const line: DiagramLine = {
            name: cleanText(el.getAttribute('name')),
            color: colourOf(el),
            visible: bool(el, 'visible', true),
            slope: Math.abs(m) >= VERTICAL_SLOPE ? 0 : m,
            intercept: c,
        };
        if (Math.abs(m) >= VERTICAL_SLOPE) line.vertical = true;
        const angle = angleOf(el);
        if (angle !== undefined) line.labelAngleDeg = angle;
        return line;
    });

    // ---- point features & labels ----------------------------------------------
    const points: DiagramPoint[] = [];
    for (const el of [...children(root, 'PointFeature'), ...children(root, 'TPointFeature')]) {
        const pos = posOf(el);
        if (!pos) continue;
        points.push({
            name: cleanText(el.getAttribute('name')),
            color: colourOf(el),
            visible: bool(el, 'visible', true),
            pos,
            pixelRadius: num(el, 'pixelRadius', 5),
        });
    }
    const labels: DiagramLabel[] = [];
    for (const el of [...children(root, 'Label'), ...children(root, 'TLabel')]) {
        const pos = posOf(el);
        if (!pos) continue;
        labels.push({
            text: cleanText(el.getAttribute('name')),
            color: colourOf(el),
            visible: bool(el, 'visible', true),
            pos,
            angleDeg: angleOf(el) ?? 0,
        });
    }

    // ---- bounds & metadata -----------------------------------------------------
    const boundsEl = child(root, 'Bounds');
    const bounds = boundsEl
        ? { x: num(boundsEl, 'x'), y: num(boundsEl, 'y'), w: num(boundsEl, 'w'), h: num(boundsEl, 'h') }
        : undefined;

    const texts = (t: string) => children(root, t).map(e => cleanText(e.textContent)).filter(Boolean);
    const descriptions = children(root, 'Description')
        .map(e => cleanText(e.getAttribute('name') ?? e.textContent)).filter(Boolean);

    // Ignore the version-marker polygon; any other <Polygon> would be unexpected
    for (const el of children(root, 'Polygon')) {
        if (!VERSION_MARKER.test(el.getAttribute('name') ?? '')) {
            throw new InteropXmlError(`${meta.sourceFile}: unsupported <Polygon> "${el.getAttribute('name')}"`);
        }
    }

    const diagram: Diagram = {
        ...base,
        name: cleanText(root.getAttribute('name')) || stem,
        kind,
        axes,
        variables,
        fields,
        comments: texts('Comment'),
        references: texts('Reference'),
    };
    const variateMode = root.getAttribute('variateMode');
    if (variateMode) diagram.variateMode = variateMode;
    if (expressions.length) diagram.expressions = expressions;
    if (lines.length) diagram.lines = lines;
    if (points.length) diagram.points = points;
    if (labels.length) diagram.labels = labels;
    if (bounds && Object.values(bounds).every(Number.isFinite)) diagram.bounds = bounds;
    if (descriptions.length) diagram.descriptions = descriptions;
    return diagram;
}
