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
