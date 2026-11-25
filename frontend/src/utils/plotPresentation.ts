/**
 * Plot presentation edits (Graph Properties: title, axis labels,
 * ranges, fonts, legend). Kept per plot in `settings.presentation` and laid
 * over each chart's own layout by ThemedPlot, so every plot type gets them.
 * Empty fields leave the chart's own values.
 */
import { createContext } from 'react';

export interface Presentation {
    title?: string;
    xTitle?: string;
    yTitle?: string;
    /** Axis ranges in data units (log axes converted here) */
    xRange?: [number | null, number | null];
    yRange?: [number | null, number | null];
    /** Base font size (titles scale from it) */
    fontSize?: number;
    legend?: 'auto' | 'hide' | 'right' | 'bottom';
    /** White background for figures (publication) */
    whiteBackground?: boolean;
}

/** The plot whose presentation applies to charts rendered inside it */
export const PlotIdContext = createContext<string | null>(null);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Layout = Record<string, any>;

const withText = (title: unknown, text: string) =>
    (title && typeof title === 'object' ? { ...(title as object), text } : { text });

const withSize = (font: unknown, size: number) => ({ ...(font && typeof font === 'object' ? font : {}), size });

function range(axis: Layout | undefined, r: [number | null, number | null] | undefined): Layout | undefined {
    if (!r || (r[0] == null && r[1] == null) || r[0] == null || r[1] == null) return axis;
    const log = axis?.type === 'log';
    if (log && (r[0] <= 0 || r[1] <= 0)) return axis;
    return { ...axis, range: log ? [Math.log10(r[0]), Math.log10(r[1])] : [r[0], r[1]], autorange: false };
}

function axisPresentation(axis: Layout | undefined, title: string | undefined, r: Presentation['xRange'], fontSize?: number): Layout | undefined {
    let out = axis;
    if (title?.trim()) out = { ...out, title: withText(out?.title, title) };
    out = range(out, r);
    if (fontSize) {
        out = { ...out, tickfont: withSize(out?.tickfont, fontSize), title: { ...(typeof out?.title === 'object' ? out.title : { text: out?.title }), font: withSize(out?.title?.font, Math.round(fontSize * 1.15)) } };
    }
    return out;
}

export function applyPresentation(layout: Layout, p: Presentation | undefined): Layout {
    if (!p) return layout;
    let out: Layout = { ...layout };
    if (p.title?.trim()) out.title = withText(out.title, p.title);
    if (p.fontSize) {
        out.font = withSize(out.font, p.fontSize);
        if (out.title) out.title = { ...(typeof out.title === 'object' ? out.title : { text: out.title }), font: withSize(out.title?.font, Math.round(p.fontSize * 1.4)) };
        if (out.legend || p.legend !== 'hide') out.legend = { ...out.legend, font: withSize(out.legend?.font, p.fontSize) };
    }
    const x = axisPresentation(out.xaxis, p.xTitle, p.xRange, p.fontSize);
    const y = axisPresentation(out.yaxis, p.yTitle, p.yRange, p.fontSize);
    if (x) out.xaxis = x;
    if (y) out.yaxis = y;
    if (p.legend === 'hide') out.showlegend = false;
    else if (p.legend === 'right') out = { ...out, showlegend: true, legend: { ...out.legend, orientation: 'v', x: 1.02, xanchor: 'left', y: 1, yanchor: 'top' } };
    else if (p.legend === 'bottom') out = { ...out, showlegend: true, legend: { ...out.legend, orientation: 'h', x: 0.5, xanchor: 'center', y: -0.2, yanchor: 'top' } };
    if (p.whiteBackground) out = { ...out, paper_bgcolor: '#ffffff', plot_bgcolor: '#ffffff', font: { ...out.font, color: '#111111' } };
    return out;
}

/** True when the presentation changes anything */
export const hasPresentation = (p: Presentation | undefined) => !!p && Object.values(p).some(v =>
    Array.isArray(v) ? v.some(x => x != null) : v !== undefined && v !== '' && v !== 'auto' && v !== false);
