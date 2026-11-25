/**
 * XY plot overlays used in the tutorials:
 * - point density overlay: points counted in a grid of cells (default
 *   180 x 140), lightly smoothed and drawn as a rainbow raster under the
 *   points, so attribute colours stay visible;
 * - reference ratio lines (y = k x): mineral lines such as pyrite Fe:S = 1:2
 *   (molar) or calcite Ca:C = 1:1, and weight ratios such as V/Sc = 7 or
 *   Zr/Hf = 36, converted to the units of the plotted columns;
 * - value lines (Sr/Y = 40, Ba = 1000 ppm): horizontal on panels plotting
 *   that column on Y, vertical where it is on X.
 */
import type { ColumnGeochemMapping } from '../types/associations';
import { ATOMIC_WEIGHTS } from './calculations/constants';
import { resolveColumnToPpm } from './calculations/elementColumnResolver';

export interface DensityGrid {
    /** Cell centres in data units */
    x: number[];
    y: number[];
    /** z[row = y][col = x]; empty cells are null (transparent) */
    z: (number | null)[][];
}

/** One 3-point box blur pass along both directions */
function blur(g: number[][]): number[][] {
    const h = g.map(row => row.map((v, i) => (row[i - 1] ?? v) / 4 + v / 2 + (row[i + 1] ?? v) / 4));
    return h.map((row, j) => row.map((v, i) => (h[j - 1]?.[i] ?? v) / 4 + v / 2 + (h[j + 1]?.[i] ?? v) / 4));
}

/**
 * Point counts on an nx x ny grid over the data extent (in log10 space for
 * log axes), smoothed `passes` times. Cells with (almost) no density are null.
 */
export function densityOverlayGrid(
    xs: ArrayLike<number>, ys: ArrayLike<number>, rows: ArrayLike<number>,
    opts: { nx?: number; ny?: number; logX?: boolean; logY?: boolean; passes?: number } = {},
): DensityGrid | null {
    const nx = Math.max(4, Math.round(opts.nx ?? 180)), ny = Math.max(4, Math.round(opts.ny ?? 140));
    const tx = (v: number) => (opts.logX ? (v > 0 ? Math.log10(v) : NaN) : v);
    const ty = (v: number) => (opts.logY ? (v > 0 ? Math.log10(v) : NaN) : v);
    const px: number[] = [], py: number[] = [];
    for (let k = 0; k < rows.length; k++) {
        const i = rows[k];
        const a = tx(Number(xs[i])), b = ty(Number(ys[i]));
        if (Number.isFinite(a) && Number.isFinite(b)) { px.push(a); py.push(b); }
    }
    if (px.length < 3) return null;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let k = 0; k < px.length; k++) {
        if (px[k] < x0) x0 = px[k]; if (px[k] > x1) x1 = px[k];
        if (py[k] < y0) y0 = py[k]; if (py[k] > y1) y1 = py[k];
    }
    if (x1 === x0) { x0 -= 0.5; x1 += 0.5; }
    if (y1 === y0) { y0 -= 0.5; y1 += 0.5; }
    const dx = (x1 - x0) / nx, dy = (y1 - y0) / ny;
    let g = Array.from({ length: ny }, () => new Array<number>(nx).fill(0));
    for (let k = 0; k < px.length; k++) {
        const i = Math.min(nx - 1, Math.floor((px[k] - x0) / dx));
        const j = Math.min(ny - 1, Math.floor((py[k] - y0) / dy));
        g[j][i]++;
    }
    for (let p = 0; p < (opts.passes ?? 2); p++) g = blur(g);
    let max = 0;
    for (const row of g) for (const v of row) if (v > max) max = v;
    // colours everything but isolated samples: a lone point blurs to ~0.14, two neighbours > 0.2
    const floor = Math.max(0.2, max * 0.002);
    const back = (v: number, log?: boolean) => (log ? 10 ** v : v);
    return {
        x: Array.from({ length: nx }, (_, i) => back(x0 + (i + 0.5) * dx, opts.logX)),
        y: Array.from({ length: ny }, (_, j) => back(y0 + (j + 0.5) * dy, opts.logY)),
        z: g.map(row => row.map(v => (v > floor ? v : null))),
    };
}

/** standard rainbow (blue -> red) for the density overlay */
export const DENSITY_OVERLAY_COLORSCALE: [number, string][] = [
    [0, 'rgb(0,0,180)'], [0.2, 'rgb(0,120,255)'], [0.4, 'rgb(0,220,220)'],
    [0.6, 'rgb(120,230,40)'], [0.8, 'rgb(255,200,0)'], [1, 'rgb(220,0,0)'],
];

export interface RefLine {
    label: string;
    /** Numerator / denominator elements (blank = any panel, line y = ratio x in column units) */
    num?: string;
    den?: string;
    ratio: number;
    /** Ratio of moles (converted with atomic weights) instead of weights */
    molar: boolean;
    /** 'value': a constant line at `ratio` on the column `num` (blank = every panel's Y) */
    kind?: 'ratio' | 'value';
}

/** Value line on this panel: which axis it crosses and where, or null */
export function refLineLevel(line: RefLine, xCol: string, yCol: string): { axis: 'x' | 'y'; value: number } | null {
    if (line.kind !== 'value' || !Number.isFinite(line.ratio)) return null;
    const col = line.num?.trim().toLowerCase();
    if (!col || col === yCol.toLowerCase()) return { axis: 'y', value: line.ratio };
    if (col === xCol.toLowerCase()) return { axis: 'x', value: line.ratio };
    return null;
}

export const REF_LINE_PRESETS: RefLine[] = [
    { label: 'Pyrite (Fe:S = 1:2 molar)', num: 'S', den: 'Fe', ratio: 2, molar: true },
    { label: 'Calcite (Ca:C = 1:1 molar)', num: 'C', den: 'Ca', ratio: 1, molar: true },
    { label: 'Dolomite (Ca:Mg = 1:1 molar)', num: 'Mg', den: 'Ca', ratio: 1, molar: true },
    { label: 'Anhydrite (Ca:S = 1:1 molar)', num: 'S', den: 'Ca', ratio: 1, molar: true },
    { label: 'V/Sc = 7 (ilmenite-series basalt)', num: 'V', den: 'Sc', ratio: 7, molar: false },
    { label: 'Zr/Hf = 36 (crustal average)', num: 'Zr', den: 'Hf', ratio: 36, molar: false },
    { label: 'K/Rb = 250', num: 'K', den: 'Rb', ratio: 250, molar: false },
];

/**
 * Slope of the line in the plotted columns' units (y column per x column),
 * or null when the line does not belong on this panel.
 */
export function refLineSlope(line: RefLine, xCol: string, yCol: string, mappings: ColumnGeochemMapping[]): number | null {
    if (line.kind === 'value' || !(line.ratio > 0)) return null;
    if (!line.num || !line.den) return line.ratio;
    const x = resolveColumnToPpm(mappings, xCol), y = resolveColumnToPpm(mappings, yCol);
    if (!x || !y) return null;
    let mass: number;
    const massRatio = (num: string, den: string) => line.molar
        ? line.ratio * (ATOMIC_WEIGHTS[num] ?? NaN) / (ATOMIC_WEIGHTS[den] ?? NaN)
        : line.ratio;
    if (y.element === line.num && x.element === line.den) mass = massRatio(line.num, line.den);
    else if (y.element === line.den && x.element === line.num) mass = 1 / massRatio(line.num, line.den);
    else return null;
    // y_ppm = mass * x_ppm  ->  y_col = mass * x_col * toPpm(x) / toPpm(y)
    const k = mass * x.toPpm / y.toPpm;
    return Number.isFinite(k) && k > 0 ? k : null;
}

/**
 * Positions (into the arrays) of a stable subset of about `cap` points for a
 * small-multiple chart. Rows are picked by a hash of their row index, so the
 * same rows appear in every chart and in every redraw; the `tail` fraction
 * at each end of X and of Y is always kept so outliers never disappear.
 * Order is preserved (draw order / z-order).
 */
export function thinPoints(xs: ArrayLike<any>, ys: ArrayLike<any>, rows: ArrayLike<number>, cap: number, tail = 0.01): number[] {
    const n = ys.length;
    const all = Array.from({ length: n }, (_, k) => k);
    if (n <= cap) return all;
    const buf = new Float64Array(n);
    const cut = (vals: ArrayLike<any>) => {
        let m0 = 0;
        for (let k = 0; k < n; k++) { const x = +vals[k]; if (x === x && x !== Infinity && x !== -Infinity) buf[m0++] = x; }
        const v = buf.subarray(0, m0).sort();
        if (!v.length) return [Infinity, -Infinity] as const;
        const m = Math.max(1, Math.floor(v.length * tail));
        return [v[m - 1], v[v.length - m]] as const;
    };
    const [xLo, xHi] = cut(xs);
    const [yLo, yHi] = cut(ys);
    const p = cap / n;
    return all.filter(k => {
        const x = Number(xs[k]), y = Number(ys[k]);
        if (x <= xLo || x >= xHi || y <= yLo || y >= yHi) return true;
        return ((Math.imul(rows[k] + 1, 2654435761) >>> 0) / 4294967296) < p;
    });
}

/**
 * Data extent [x0, x1, y0, y1] of the rows with both values drawn (finite,
 * and > 0 on a log axis), in data units; null when there is no spread in X.
 */
export function panelExtent(
    xs: ArrayLike<number>, ys: ArrayLike<number>, rows: ArrayLike<number>, logX = false, logY = false,
): [number, number, number, number] | null {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let k = 0; k < rows.length; k++) {
        const a = Number(xs[rows[k]]), b = Number(ys[rows[k]]);
        if (!Number.isFinite(a) || !Number.isFinite(b) || (logX && a <= 0) || (logY && b <= 0)) continue;
        if (a < x0) x0 = a; if (a > x1) x1 = a; if (b < y0) y0 = b; if (b > y1) y1 = b;
    }
    return x1 > x0 ? [x0, x1, y0, y1] : null;
}

// ---------------------------------------------------------------------------
// Reference line labels
// ---------------------------------------------------------------------------

/**
 * Label tier of each parallel value line (0 = usual place, 1 = other end,
 * 2 = middle) so the labels of lines closer than `minGap` (share of the axis
 * span, measured in log10 space on a log axis) are not drawn on top of each
 * other. Lines are walked in order of position; each takes the lowest tier
 * not used by a close neighbour already placed. Returned in input order.
 */
export function staggerRefLabels(values: number[], span: [number, number], log = false, minGap = 0.06, tiers = 3): number[] {
    const f = (v: number) => (log ? (v > 0 ? Math.log10(v) : NaN) : v);
    const width = Math.abs(f(span[1]) - f(span[0])) || 1;
    const out = values.map(() => 0);
    const order = values.map((_, i) => i).filter(i => Number.isFinite(f(values[i]))).sort((a, b) => f(values[a]) - f(values[b]));
    for (let k = 1; k < order.length; k++) {
        const used = new Set<number>();
        for (let j = k - 1; j >= 0 && Math.abs(f(values[order[k]]) - f(values[order[j]])) / width < minGap; j--) used.add(out[order[j]]);
        let t = 0;
        while (used.has(t) && t < tiers - 1) t++;
        out[order[k]] = used.has(t) ? (out[order[k - 1]] + 1) % tiers : t;
    }
    return out;
}

// ---------------------------------------------------------------------------
// Static point labels (sample ID callouts)
// ---------------------------------------------------------------------------

/** Which points of a scatter panel get a static label */
export type LabelMode = 'off' | 'selected' | 'topY' | 'topX' | 'bothExtremes';

export interface PickLabelOptions {
    mode: LabelMode;
    /** Points per extreme for the top modes (default 8) */
    topN?: number;
    logX?: boolean;
    logY?: boolean;
    /** Selection test for 'selected' (by the same row index as `rows`) */
    isSelected?: (row: number) => boolean;
    /** Most labels drawn for a selection (highest Y first) */
    maxSelected?: number;
}

/**
 * Rows to label, from the visible `rows` only: points that are drawn (both
 * values finite, > 0 on a log axis). 'selected' = selected visible points,
 * 'topY' / 'topX' = the N highest by Y / X, 'bothExtremes' = both lists
 * without repeats. Ordered by priority (highest first), which is also the
 * order labels claim their places.
 */
export function pickLabelRows(xs: ArrayLike<number>, ys: ArrayLike<number>, rows: ArrayLike<number>, opts: PickLabelOptions): number[] {
    if (opts.mode === 'off') return [];
    const drawn: number[] = [];
    for (let k = 0; k < rows.length; k++) {
        const i = rows[k];
        const x = Number(xs[i]), y = Number(ys[i]);
        if (!Number.isFinite(x) || !Number.isFinite(y) || (opts.logX && x <= 0) || (opts.logY && y <= 0)) continue;
        drawn.push(i);
    }
    const desc = (list: number[], vals: ArrayLike<number>) => [...list].sort((a, b) => Number(vals[b]) - Number(vals[a]) || a - b);
    const n = Math.max(0, Math.floor(opts.topN ?? 8));
    switch (opts.mode) {
        case 'selected': {
            const sel = opts.isSelected ? drawn.filter(i => opts.isSelected!(i)) : [];
            return desc(sel, ys).slice(0, opts.maxSelected ?? 100);
        }
        case 'topY': return desc(drawn, ys).slice(0, n);
        case 'topX': return desc(drawn, xs).slice(0, n);
        case 'bothExtremes': {
            const y = desc(drawn, ys).slice(0, n);
            const seen = new Set(y);
            return [...y, ...desc(drawn, xs).slice(0, n).filter(i => !seen.has(i))];
        }
        default: return [];
    }
}

/** Label sides around a point: Plotly textposition and direction (shared with the node labels) */
export const LABEL_SPOTS: [string, number, number][] = [
    ['top right', 1, 1], ['bottom right', 1, -1], ['top left', -1, 1], ['bottom left', -1, -1],
    ['middle right', 1.4, 0], ['middle left', -1.4, 0], ['top center', 0, 1.3], ['bottom center', 0, -1.3],
];

export interface LabelPlacementOptions {
    /** [x0, x1, y0, y1] the panel spans, in the same units as the points (default: the points' own extent) */
    extent?: [number, number, number, number];
    /** Leader length as a share of the panel (default 0.045) */
    sep?: number;
    /** Width of one character and height of one line as shares of the panel width / height */
    charW?: number;
    lineH?: number;
}

export interface LabelPlacement {
    /** Text anchor, in the units of the points */
    x: number;
    y: number;
    position: string;
}

/**
 * Callout places for point labels (screen orientation, linear units: pass
 * log10 values for a log axis). Greedy, in priority order: each label tries
 * the spots around its point at one, two, then three leader lengths and takes
 * the first whose text box overlaps no label already placed, covers no other
 * labelled point and stays inside the panel; failing that, the least bad spot.
 */
export function placeLabels(px: number[], py: number[], texts: string[], opts: LabelPlacementOptions = {}): LabelPlacement[] {
    const n = px.length;
    if (!n) return [];
    let [x0, x1, y0, y1] = opts.extent ?? [Math.min(...px), Math.max(...px), Math.min(...py), Math.max(...py)];
    if (!(x1 > x0)) { x0 -= 0.5; x1 += 0.5; }
    if (!(y1 > y0)) { y0 -= 0.5; y1 += 0.5; }
    const sx = x1 - x0, sy = y1 - y0;
    const u = px.map(v => (v - x0) / sx), w = py.map(v => (v - y0) / sy);
    const sep = opts.sep ?? 0.045, cw = opts.charW ?? 0.014, lh = opts.lineH ?? 0.035;
    type Box = [number, number, number, number];
    const boxOf = (ax: number, ay: number, pos: string, width: number): Box => {
        const [v, h] = pos.split(' ');
        const bx = h === 'right' ? ax : h === 'left' ? ax - width : ax - width / 2;
        const by = v === 'top' ? ay : v === 'bottom' ? ay - lh : ay - lh / 2;
        return [bx, bx + width, by, by + lh];
    };
    const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[2], b[2]));
    const placed: Box[] = [];
    return px.map((_, k) => {
        const width = Math.max(1, texts[k]?.length ?? 1) * cw;
        let best: { ax: number; ay: number; pos: string; box: Box } | null = null, bestCost = Infinity;
        for (let ring = 1; ring <= 3 && bestCost > 0; ring++) {
            for (const [pos, dx, dy] of LABEL_SPOTS) {
                const ax = u[k] + dx * sep * ring, ay = w[k] + dy * sep * ring;
                const box = boxOf(ax, ay, pos, width);
                let cost = placed.reduce((s, b) => s + overlap(box, b), 0) / (width * lh);
                for (let j = 0; j < n; j++) if (u[j] >= box[0] && u[j] <= box[1] && w[j] >= box[2] && w[j] <= box[3]) cost += 1;
                cost += Math.max(0, -0.02 - box[0]) + Math.max(0, box[1] - 1.02) + Math.max(0, -0.02 - box[2]) + Math.max(0, box[3] - 1.02);
                if (cost < bestCost - 1e-12) { bestCost = cost; best = { ax, ay, pos, box }; }
                if (cost === 0) break;
            }
        }
        placed.push(best!.box);
        return { x: x0 + best!.ax * sx, y: y0 + best!.ay * sy, position: best!.pos };
    });
}

/**
 * Static label traces for points (screen orientation; x / y in data units):
 * thin leaders from each point to its label, then the labels themselves, so
 * they are part of the figure (PNG / SVG export, report).
 */
export function pointLabelTraces(
    px: number[], py: number[], texts: string[],
    opts: LabelPlacementOptions & { logX?: boolean; logY?: boolean; fontSize?: number; color?: string } = {},
): any[] {
    const keep = px.map((_, k) => k).filter(k => texts[k] !== ''
        && Number.isFinite(px[k]) && Number.isFinite(py[k]) && (!opts.logX || px[k] > 0) && (!opts.logY || py[k] > 0));
    if (!keep.length) return [];
    const tx = (v: number) => (opts.logX ? Math.log10(v) : v), ty = (v: number) => (opts.logY ? Math.log10(v) : v);
    const bx = (v: number) => (opts.logX ? 10 ** v : v), by = (v: number) => (opts.logY ? 10 ** v : v);
    const ext = opts.extent && [tx(opts.extent[0]), tx(opts.extent[1]), ty(opts.extent[2]), ty(opts.extent[3])] as [number, number, number, number];
    const spots = placeLabels(keep.map(k => tx(px[k])), keep.map(k => ty(py[k])), keep.map(k => texts[k]), { ...opts, extent: ext && ext.every(Number.isFinite) ? ext : undefined });
    const color = opts.color ?? '#333333';
    const lx: (number | null)[] = [], ly: (number | null)[] = [];
    keep.forEach((k, j) => { lx.push(px[k], bx(spots[j].x), null); ly.push(py[k], by(spots[j].y), null); });
    return [
        { type: 'scatter', mode: 'lines', x: lx, y: ly, line: { color, width: 0.7 }, hoverinfo: 'skip', showlegend: false, name: 'Label leaders' },
        {
            type: 'scatter', mode: 'text', x: spots.map(s => bx(s.x)), y: spots.map(s => by(s.y)),
            text: keep.map(k => texts[k]), textposition: spots.map(s => s.position),
            textfont: { size: opts.fontSize ?? 10, color }, cliponaxis: false, hoverinfo: 'skip', showlegend: false, name: 'Point labels',
        },
    ];
}
