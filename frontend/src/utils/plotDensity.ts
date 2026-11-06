/** Screen density for plots drawn through ThemedPlot */
const MARGIN_FLOOR = { l: 44, r: 12, t: 28, b: 40 } as const;

/**
 * Screen density: plots set margins sized for large fonts; with the compact
 * font scale they take three quarters (never below a floor), and every 2D axis
 * gets automargin so long tick labels still fit.
 */
export function compactLayout(layout: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = { ...layout };
    const m = layout.margin;
    if (m && typeof m === 'object') {
        const side = (k: keyof typeof MARGIN_FLOOR) =>
            typeof m[k] === 'number' ? Math.max(Math.min(m[k], MARGIN_FLOOR[k]), Math.round(m[k] * 0.75)) : m[k];
        out.margin = { ...m, l: side('l'), r: side('r'), t: side('t'), b: side('b') };
    }
    for (const key of Object.keys(layout)) {
        if (/^[xy]axis\d*$/.test(key) && layout[key] && typeof layout[key] === 'object' && layout[key].automargin === undefined) {
            out[key] = { ...layout[key], automargin: true };
        }
    }
    return out;
}

/**
 * Axis settings for 1:1 (scaleanchor) map axes. Automargin makes the plot area
 * resize as tick labels (northings) change width during pan/zoom, and the
 * aspect lock then rewrites the other range - the view jumps. Fixed margins,
 * plain tick numbers and 'domain' constraint keep panning smooth. Give the
 * layout a left margin wide enough for 7-digit northings (~100 before compacting).
 */
export const STABLE_MAP_AXIS = {
    automargin: false,
    constrain: 'domain',
    exponentformat: 'none',
    separatethousands: false,
} as const;
