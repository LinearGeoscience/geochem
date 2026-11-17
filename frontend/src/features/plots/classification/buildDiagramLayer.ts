/**
 * Pure builder: classification diagram (schema v3) → Plotly pieces.
 *
 * Returns background traces (fills, ternary grid/frame) to draw BELOW the
 * data, foreground traces (outlines, lines, nodes) to draw ABOVE it,
 * annotations (labels, arrows, vertex titles) and the axis layout. The same
 * output drives ClassificationPlot, the QA sheet and exported figures.
 *
 * Publication rules: one ink colour for field boundaries, light field fills
 * at `fillOpacity`, labels at the label positions and angles, axis
 * titles with chemical subscripts and units, ranges from the diagram bounds.
 */
import type { AxisKey, Diagram, DiagramAxisV3, Rgb } from '../../../types/diagram';
import {
    DiagramFrame, P2, Box, TRI_H, TRIANGLE, makeFrame, fieldPolyline, bboxOf, emptyBox,
    labelAnchor, clipLineToConvex, rectPolygon, ternaryToXY, polygonArea,
} from './diagramGeometry';

export type DiagramStyle = 'color' | 'bw' | 'minimal';

export interface DiagramLayerOptions {
    style: DiagramStyle;
    /** Field fill opacity in colour mode (0–1). */
    fillOpacity: number;
    showLabels: boolean;
    showGrid: boolean;
    showTitle?: boolean;
    /** Reference caption under the plot. */
    showReference?: boolean;
    /**
     * Plot-space extent of the samples. Diagrams without bounds grow to
     * include it (the PER/GER control diagrams are only lines).
     */
    dataExtent?: Box;
    /** Multiplies every font size (1 = screen). */
    fontScale?: number;
    /** Override axis titles (e.g. the column chosen by the user). */
    axisTitles?: Partial<Record<AxisKey, string>>;
}

export const DEFAULT_LAYER_OPTIONS: DiagramLayerOptions = {
    style: 'color', fillOpacity: 0.2, showLabels: true, showGrid: false, showTitle: true, showReference: false,
};

export interface ClassifiedField {
    name: string;
    /** Closed outline in plot space. */
    polygon: P2[];
    visible: boolean;
}

export interface DiagramLayer {
    frame: DiagramFrame;
    background: any[];
    foreground: any[];
    annotations: any[];
    /** Layout keys: xaxis, yaxis, title, margin, colours, font. */
    layout: any;
    /** Closed fields for point-in-polygon classification. */
    fields: ClassifiedField[];
    /** Plot-space view box. */
    view: Box;
}

export const INK = '#1a1a1a';
const GRID = '#e3e3e3';
export const FONT_FAMILY = 'Arial, Helvetica, sans-serif';

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Multi-line label text for Plotly (escaped, newlines → <br>). */
export function labelHtml(s: string): string {
    return escapeHtml(s.trim()).replace(/\s*\n\s*/g, '<br>');
}

/**
 * Chemical subscripts for formula tokens of two or more element symbols
 * ("Fe2O3", "CaAl2SiO6", "Na2O+K2O") but not for class names like "G10",
 * "Fo90" or "R1". "(pct)" reads "(wt%)" and "(La/Sm)n" gets a subscript N.
 */
export function chemHtml(s: string): string {
    return labelHtml(s.replace(/\(pct\)/gi, '(wt%)'))
        .replace(FORMULA_RE, (m: string) => (/\d/.test(m) ? m.replace(/([A-Za-z])(\d+)/g, '$1<sub>$2</sub>') : m))
        .replace(/\)n\b/g, ')<sub>N</sub>')
        .replace(/\^(-?[\d.]+)/g, '<sup>$1</sup>');
}

const ELEMENTS = ('He Li Be Ne Na Mg Al Si Cl Ar Ca Sc Ti Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Zr Nb Mo Tc Ru Rh '
    + 'Pd Ag Cd In Sn Sb Te Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta Re Os Ir Pt Au Hg Tl Pb Bi Po At '
    + 'Rn Fr Ra Ac Th Pa H B C N O F P S K V Y I W U').split(' ');
/** Two or more element symbols with counts, not glued to other letters (an "x" multiplier may follow). */
const FORMULA_RE = new RegExp(`(?<![A-Za-z0-9])(?:(?:${ELEMENTS.join('|')})\\d*){2,}(?![a-wyz0-9])`, 'g');

/** Readable text angle: stores some labels upside down (≈180°). */
function textAngle(deg: number | undefined): number {
    if (!deg) return 0;
    let a = ((deg % 360) + 360) % 360;      // 0..360, counter-clockwise
    if (a > 90 && a <= 270) a -= 180;       // flip to read left-to-right
    if (a > 270) a -= 360;
    return -a;                              // Plotly rotates clockwise
}

/** Wrap a long formula axis title at operators. */
function wrapAxisTitle(s: string, max = 46): string {
    if (s.length <= max) return s;
    const parts = s.split(/(?<=[+\-*/,])/);
    const lines: string[] = [];
    let cur = '';
    for (const p of parts) {
        if (cur && (cur + p).length > max) { lines.push(cur); cur = p; } else cur += p;
    }
    if (cur) lines.push(cur);
    return lines.join('\n');
}

/** Break a long title into lines of about `max` characters. */
export function wrapTitle(s: string, max = 52): string {
    const words = s.replace(/\s+/g, ' ').trim().split(' ');
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
        if (cur && (cur + ' ' + w).length > max) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
    }
    if (cur) lines.push(cur);
    return lines.join('\n');
}

const UNIT_LABEL: Record<string, string> = { pct: 'wt%', ppm: 'ppm', ppb: 'ppb', 'mol/kg': 'mol/kg' };

/** Axis title with subscripts and, where it is meaningful, the unit. */
export function axisTitle(ax: DiagramAxisV3 | undefined, d: Diagram, withUnit = true): string {
    if (!ax) return '';
    let unit: string | undefined;
    if (!withUnit) {
        unit = undefined;
    } else if (ax.kind === 'element') {
        unit = ax.unit;
    } else if (ax.formula && /^[\sA-Za-z+()]+$/.test(ax.formula) && ax.formula.includes('+')) {
        // A plain sum of variables keeps their (common) unit
        const letters = new Set(ax.formula.toUpperCase().match(/[A-Z]+/g) ?? []);
        const units = new Set(d.variables.filter(v => letters.has(v.letter.toUpperCase())).map(v => v.unit));
        if (units.size === 1) unit = [...units][0];
    }
    const u = unit ? UNIT_LABEL[unit] : undefined;
    const name = wrapAxisTitle(ax.name);
    // the name may already carry a unit, e.g. "MgO (pct)"
    return u && !/\(.*\)\s*$/.test(ax.name) ? `${chemHtml(name)} (${u})` : chemHtml(name);
}

const rgba = (c: Rgb, a: number) => `rgba(${c.r},${c.g},${c.b},${a})`;

/** Field colour darkened enough to read as a line on white. */
function strokeOf(c: Rgb): string {
    const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    const k = lum > 150 ? 0.55 : lum > 100 ? 0.75 : 1;
    return `rgb(${Math.round(c.r * k)},${Math.round(c.g * k)},${Math.round(c.b * k)})`;
}

// ---------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------

function niceStep(span: number): number {
    const raw = span / 8;
    const p = 10 ** Math.floor(Math.log10(raw));
    const m = raw / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

/** Round a linear range outward to nice ticks. */
function niceRange(lo: number, hi: number): [number, number] {
    if (!(hi > lo)) return [lo - 1, hi + 1];
    const step = niceStep(hi - lo);
    let a = Math.floor(lo / step + 1e-9) * step;
    let b = Math.ceil(hi / step - 1e-9) * step;
    // geometry exactly on the frame (e.g. two vertical lines at 5 and 10)
    // would vanish into it: give one more step, except at natural limits
    const natural = (v: number) => v === 0 || v === 1 || v === 100;
    if (Math.abs(a - lo) < step * 1e-6 && !natural(lo)) a -= step;
    if (Math.abs(b - hi) < step * 1e-6 && !natural(hi)) b += step;
    // keep a near-zero origin at zero
    if (lo >= 0 && a < 0) a = 0;
    return [a, b];
}

function xyView(d: Diagram, frame: DiagramFrame, geometry: Box): Box {
    if (d.bounds) {
        const b = d.bounds;
        const p0 = frame.toPlot([b.x, b.y]);
        const p1 = frame.toPlot([b.x + b.w, b.y + b.h]);
        if (p0 && p1 && p1[0] > p0[0] && p1[1] > p0[1]) return { x0: p0[0], y0: p0[1], x1: p1[0], y1: p1[1] };
    }
    const g = Number.isFinite(geometry.x0) ? geometry : { x0: 0, x1: 1, y0: 0, y1: 1 };
    const axisRange = (lo: number, hi: number, log: boolean): [number, number] => {
        if (log) {
            const pad = Math.max((hi - lo) * 0.03, 0.05);
            return [lo - pad, hi + pad];
        }
        return niceRange(lo, hi);
    };
    const [x0, x1] = axisRange(g.x0, g.x1, frame.logX);
    const [y0, y1] = axisRange(g.y0, g.y1, frame.logY);
    return { x0, x1, y0, y1 };
}

const inView = (p: P2, v: Box, slack = 0.005) => {
    const sx = (v.x1 - v.x0) * slack, sy = (v.y1 - v.y0) * slack;
    return p[0] >= v.x0 - sx && p[0] <= v.x1 + sx && p[1] >= v.y0 - sy && p[1] <= v.y1 + sy;
};

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildDiagramLayer(d: Diagram, opts: DiagramLayerOptions = DEFAULT_LAYER_OPTIONS): DiagramLayer {
    const frame = makeFrame(d);
    const ternary = frame.kind === 'ternary';
    const fs = opts.fontScale ?? 1;
    const color = opts.style === 'color';
    const minimal = opts.style === 'minimal';
    const T = (p: P2) => frame.toTrace(p[0], p[1]);

    // --- geometry in plot space -------------------------------------------
    const roughTol = ternary ? 0.05 : 0; // refined below once the view is known
    const geomBox = emptyBox();
    const extentOnly = (pts: P2[]) => bboxOf(pts, geomBox);
    if (!ternary) {
        for (const f of d.fields) if (f.visible) extentOnly(fieldPolyline(f, frame, roughTol || 1e-3));
        for (const p of d.points ?? []) { const q = frame.toPlot(p.pos); if (q && p.visible) extentOnly([q]); }
        for (const l of d.labels ?? []) { const q = frame.toPlot(l.pos); if (q && l.visible) extentOnly([q]); }
    }
    const view: Box = ternary
        ? { x0: -6, x1: 106, y0: -8, y1: TRI_H + 6 }
        : xyView(d, frame, opts.dataExtent && !d.bounds ? bboxOf([[opts.dataExtent.x0, opts.dataExtent.y0], [opts.dataExtent.x1, opts.dataExtent.y1]], geomBox) : geomBox);
    const spanX = view.x1 - view.x0, spanY = view.y1 - view.y0;
    const tol = Math.max(spanX, spanY) * 6e-4;

    const background: any[] = [];
    const foreground: any[] = [];
    const annotations: any[] = [];
    const fields: ClassifiedField[] = [];

    // --- ternary frame + grid ----------------------------------------------
    if (ternary) {
        if (opts.showGrid) {
            const gx: (number | null)[] = [], gy: (number | null)[] = [];
            const seg = (p: P2, q: P2) => { gx.push(p[0], q[0], null); gy.push(p[1], q[1], null); };
            for (let k = 10; k < 100; k += 10) {
                seg(ternaryToXY([k, 100 - k, 0]), ternaryToXY([k, 0, 100 - k]));   // constant A
                seg(ternaryToXY([0, k, 100 - k]), ternaryToXY([100 - k, k, 0]));   // constant B
                seg(ternaryToXY([0, 100 - k, k]), ternaryToXY([100 - k, 0, k]));   // constant C
            }
            background.push({
                type: 'scatter', mode: 'lines', x: gx, y: gy, hoverinfo: 'skip', showlegend: false,
                line: { color: GRID, width: 0.8 },
            });
        }
    }

    // --- fields ------------------------------------------------------------
    const closedX: (number | null)[] = [], closedY: (number | null)[] = [];
    const openByColour = new Map<string, { x: (number | null)[]; y: (number | null)[] }>();
    const labelFont = (size: number, c = INK) => ({ family: FONT_FAMILY, size: size * fs, color: c });

    for (const f of d.fields) {
        const poly = fieldPolyline(f, frame, tol);
        if (poly.length < 2) continue;
        if (f.closed && poly.length >= 4) fields.push({ name: f.name, polygon: poly, visible: f.visible });
        if (!f.visible) continue;
        const tp = poly.map(T);

        if (f.closed) {
            background.push({
                type: 'scatter', mode: 'lines', x: tp.map(p => p[0]), y: tp.map(p => p[1]),
                fill: 'toself',
                fillcolor: color ? rgba(f.color, opts.fillOpacity) : 'rgba(0,0,0,0)',
                line: { width: 0 },
                hoveron: 'fills', hoverinfo: 'text', text: f.name.replace(/\n/g, ' '),
                hoverlabel: { bgcolor: '#fff', font: { color: INK } },
                name: f.name.replace(/\n/g, ' '), showlegend: false,
            });
            for (const p of tp) { closedX.push(p[0]); closedY.push(p[1]); }
            closedX.push(null); closedY.push(null);
        } else {
            const key = color && !minimal ? strokeOf(f.color) : INK;
            const g = openByColour.get(key) ?? { x: [], y: [] };
            for (const p of tp) { g.x.push(p[0]); g.y.push(p[1]); }
            g.x.push(null); g.y.push(null);
            openByColour.set(key, g);
            if (f.endArrow && poly.length >= 2) {
                const end = poly[poly.length - 1];
                // a point a short way back along the path gives the direction
                let k = poly.length - 2;
                while (k > 0 && Math.hypot((poly[k][0] - end[0]) / spanX, (poly[k][1] - end[1]) / spanY) < 0.02) k--;
                annotations.push({
                    x: end[0], y: end[1], ax: poly[k][0], ay: poly[k][1], axref: 'x', ayref: 'y', xref: 'x', yref: 'y',
                    text: '', showarrow: true, arrowhead: 2, arrowsize: 1.2, arrowwidth: 1, arrowcolor: key, standoff: 0,
                });
            }
        }

        // label
        if (opts.showLabels && f.name.trim()) {
            let at: P2 | null = f.labelPos ? frame.toPlot(f.labelPos) : null;
            if (!at && f.closed && poly.length >= 4) at = labelAnchor(poly, spanX, spanY);
            if (at && inView(at, view)) {
                const b = bboxOf(poly);
                const rel = Math.min((b.x1 - b.x0) / spanX, (b.y1 - b.y0) / spanY);
                const small = f.closed && (rel < 0.06 || polygonArea(poly) / (spanX * spanY) < 0.004);
                annotations.push({
                    x: at[0], y: at[1], xref: 'x', yref: 'y', showarrow: false,
                    text: chemHtml(f.name), textangle: textAngle(f.labelAngleDeg),
                    font: labelFont(small ? 8.5 : 10), align: 'center',
                });
            }
        }
    }
    if (closedX.length) {
        foreground.push({
            type: 'scatter', mode: 'lines', x: closedX, y: closedY, hoverinfo: 'skip', showlegend: false,
            line: { color: INK, width: 1 }, connectgaps: false,
        });
    }
    for (const [c, g] of openByColour) {
        foreground.push({
            type: 'scatter', mode: 'lines', x: g.x, y: g.y, hoverinfo: 'skip', showlegend: false,
            line: { color: c, width: 1 }, connectgaps: false,
        });
    }

    // --- straight lines ----------------------------------------------------
    const clipPoly = ternary ? TRIANGLE : rectPolygon(view);
    for (const l of d.lines ?? []) {
        if (!l.visible) continue;
        const seg = l.vertical
            ? clipLineToConvex([l.intercept, 0], [0, 1], clipPoly)
            : clipLineToConvex([0, l.intercept], [1, l.slope], clipPoly);
        if (!seg) continue;
        const c = color && !minimal ? strokeOf(l.color) : INK;
        const [p, q] = [T(seg[0]), T(seg[1])];
        foreground.push({
            type: 'scatter', mode: 'lines', x: [p[0], q[0]], y: [p[1], q[1]],
            line: { color: c, width: 1 }, name: l.name, hoverinfo: l.name ? 'name' : 'skip', showlegend: false,
        });
        if (opts.showLabels && l.name.trim()) {
            // name near the far end of the visible segment
            const t = 0.94;
            const at: P2 = [seg[0][0] + (seg[1][0] - seg[0][0]) * t, seg[0][1] + (seg[1][1] - seg[0][1]) * t];
            annotations.push({
                x: at[0], y: at[1], xref: 'x', yref: 'y', showarrow: false, text: labelHtml(l.name),
                textangle: textAngle(l.labelAngleDeg), font: labelFont(9, c),
                // inside the frame: just left of the far end, above the line
                xanchor: 'right', yanchor: 'bottom', xshift: -2, yshift: 2,
            });
        }
    }

    // --- point features (mineral nodes etc.) -------------------------------
    for (const p of d.points ?? []) {
        if (!p.visible) continue;
        const q = frame.toPlot(p.pos);
        if (!q || !inView(q, view)) continue;
        const c = color ? strokeOf(p.color) : INK;
        const [x, y] = T(q);
        const marker = p.pixelRadius >= 1;
        foreground.push({
            type: 'scatter', mode: marker ? 'markers' : 'none', x: [x], y: [y],
            marker: { size: Math.min(Math.max(p.pixelRadius, 5), 9), color: c, line: { color: '#fff', width: 0.8 } },
            cliponaxis: false,
            name: p.name, hoverinfo: p.name ? 'name' : 'skip', showlegend: false,
        });
        if (opts.showLabels && p.name.trim()) {
            // keep the label inside the frame near the right/top edges
            const right = ternary ? q[0] > 75 : (q[0] - view.x0) / spanX > 0.85;
            const top = ternary ? false : (q[1] - view.y0) / spanY > 0.93;
            annotations.push({
                x: q[0], y: q[1], xref: 'x', yref: 'y', showarrow: false, text: chemHtml(p.name),
                font: labelFont(9, c),
                xanchor: marker ? (right ? 'right' : 'left') : 'center',
                yanchor: marker ? (top ? 'top' : 'bottom') : 'middle',
                xshift: marker ? (right ? -4 : 4) : 0, yshift: marker ? (top ? -2 : 2) : 0,
            });
        }
    }

    // --- free labels -------------------------------------------------------
    if (opts.showLabels) {
        for (const l of d.labels ?? []) {
            if (!l.visible || !l.text.trim()) continue;
            const q = frame.toPlot(l.pos);
            if (!q || !inView(q, view)) continue;
            annotations.push({
                x: q[0], y: q[1], xref: 'x', yref: 'y', showarrow: false, text: chemHtml(l.text),
                textangle: textAngle(l.angleDeg),
                font: labelFont(9.5, color ? strokeOf(l.color) : INK), align: 'center',
            });
        }
    }

    // --- axes / frame ------------------------------------------------------
    const titleLines = opts.showTitle !== false ? wrapTitle(d.name).split('\n').length : 0;
    const titleText = (k: AxisKey) => opts.axisTitles?.[k] ?? axisTitle(d.axes[k], d, !ternary);
    const layout: any = {
        paper_bgcolor: '#ffffff',
        plot_bgcolor: '#ffffff',
        font: { family: FONT_FAMILY, color: INK, size: 12 * fs },
        showlegend: false,
        hovermode: 'closest',
    };
    if (opts.showTitle !== false) {
        layout.title = { text: chemHtml(wrapTitle(d.name)), x: 0.5, xanchor: 'center', font: { family: FONT_FAMILY, size: 15 * fs, color: INK } };
    }

    if (ternary) {
        foreground.push({
            type: 'scatter', mode: 'lines',
            x: [0, 100, 50, 0], y: [0, 0, TRI_H, 0],
            line: { color: INK, width: 1.5 }, hoverinfo: 'skip', showlegend: false,
        });
        const vertexFont = { family: FONT_FAMILY, size: 13 * fs, color: INK };
        annotations.push(
            { x: 50, y: TRI_H, xref: 'x', yref: 'y', yanchor: 'bottom', yshift: 7, showarrow: false, text: titleText('a'), font: vertexFont },
            { x: -3, y: 0, xref: 'x', yref: 'y', xanchor: 'left', yanchor: 'top', yshift: -4, showarrow: false, text: titleText('b'), font: vertexFont },
            { x: 103, y: 0, xref: 'x', yref: 'y', xanchor: 'right', yanchor: 'top', yshift: -4, showarrow: false, text: titleText('c'), font: vertexFont },
        );
        const hidden = { visible: false, showgrid: false, zeroline: false, fixedrange: false };
        layout.xaxis = { ...hidden, range: [view.x0, view.x1] };
        layout.yaxis = { ...hidden, range: [view.y0, view.y1], scaleanchor: 'x', scaleratio: 1 };
        layout.margin = { l: 20, r: 20, t: titleLines ? 40 + 19 * titleLines : 24, b: 30 };
    } else {
        const axis = (k: 'x' | 'y', log: boolean, lo: number, hi: number) => ({
            title: { text: titleText(k), font: { family: FONT_FAMILY, size: (titleText(k).includes('<br>') ? 12 : 14) * fs, color: INK }, standoff: 8 },
            type: log ? 'log' : 'linear',
            range: [lo, hi],
            showline: true, mirror: true, linecolor: INK, linewidth: 1,
            ticks: 'outside', ticklen: 5, tickwidth: 1, tickcolor: INK,
            tickfont: { family: FONT_FAMILY, size: 12 * fs, color: INK },
            showgrid: opts.showGrid, gridcolor: GRID, zeroline: false,
            ...(log ? {
                exponentformat: 'power',
                // decades only, with unlabelled minor ticks, once the range spans more than ~1 decade
                ...(hi - lo > 2.3
                    ? { dtick: 1, minor: { ticks: 'outside', ticklen: 3, dtick: 'D1', tickcolor: INK, showgrid: false } }
                    : { dtick: 'D2' }),
            } : {}),
        });
        layout.xaxis = axis('x', frame.logX, view.x0, view.x1);
        layout.yaxis = axis('y', frame.logY, view.y0, view.y1);
        layout.margin = { l: 72, r: 24, t: titleLines ? 34 + 19 * titleLines : 18, b: 62 };
    }

    if (opts.showReference && d.references.length) {
        const ref = d.references.join('; ');
        annotations.push({
            xref: 'paper', yref: 'paper', x: 1, y: 0, xanchor: 'right', yanchor: 'top', yshift: ternary ? -6 : -44,
            showarrow: false, align: 'right',
            text: `<i>${escapeHtml(ref.length > 140 ? ref.slice(0, 137) + '…' : ref)}</i>`,
            font: { family: FONT_FAMILY, size: 9 * fs, color: '#555' },
        });
        layout.margin.b += 16;
    }

    return { frame, background, foreground, annotations, layout, fields, view };
}

// ---------------------------------------------------------------------------
// Data projection
// ---------------------------------------------------------------------------

/**
 * Project sample values to plot traces. XY: x/y values (log axes drop ≤ 0);
 * ternary: a/b/c values, closed to 100 and mapped to the triangle. Returns
 * trace coordinates plus the input positions kept.
 */
export function projectSamples(
    frame: DiagramFrame,
    get: (axis: AxisKey, i: number) => number | null,
    order: Iterable<number>,
): { x: number[]; y: number[]; idx: number[]; abc?: [number, number, number][] } {
    const x: number[] = [], y: number[] = [], idx: number[] = [];
    if (frame.kind === 'ternary') {
        const abc: [number, number, number][] = [];
        for (const i of order) {
            const a = get('a', i), b = get('b', i), c = get('c', i);
            if (a == null || b == null || c == null || !Number.isFinite(a + b + c) || a < 0 || b < 0 || c < 0) continue;
            const s = a + b + c;
            if (!(s > 0)) continue;
            const n: [number, number, number] = [(a / s) * 100, (b / s) * 100, (c / s) * 100];
            const [u, v] = ternaryToXY(n);
            x.push(u); y.push(v); idx.push(i); abc.push(n);
        }
        return { x, y, idx, abc };
    }
    for (const i of order) {
        const u = get('x', i), v = get('y', i);
        if (u == null || v == null || !Number.isFinite(u) || !Number.isFinite(v)) continue;
        if ((frame.logX && u <= 0) || (frame.logY && v <= 0)) continue;
        x.push(u); y.push(v); idx.push(i);
    }
    return { x, y, idx };
}

