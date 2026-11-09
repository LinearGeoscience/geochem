/**
 * Plotly layout templates (UI Refresh R1) — chart CHROME matching the
 * slate+teal design system, in BOTH modes.
 *
 * Scope: paper/plot surfaces, fonts, axes, grids, legends — recessive chart
 * furniture only. Trace colors / colorscales are data encoding and are
 * deliberately NOT set here (no layout.colorway); see theme/colors.ts for the
 * reserved chartCategorical note. Anything a plot sets explicitly in its own
 * layout still wins over the template.
 */
import type { ThemeMode } from '../store/uiStore';
import { slate } from '../theme/colors';
import { FONT_FAMILY } from '../theme/typography';

const LIGHT_AXIS = {
    gridcolor: slate[200],
    zerolinecolor: slate[300],
    linecolor: slate[300],
};

const LIGHT_TEMPLATE = {
    layout: {
        paper_bgcolor: '#FFFFFF',
        plot_bgcolor: '#FFFFFF',
        font: { family: FONT_FAMILY, color: slate[700] },
        xaxis: LIGHT_AXIS,
        yaxis: LIGHT_AXIS,
        ternary: {
            bgcolor: '#FFFFFF',
            aaxis: LIGHT_AXIS,
            baxis: LIGHT_AXIS,
            caxis: LIGHT_AXIS,
        },
        scene: {
            xaxis: { ...LIGHT_AXIS, backgroundcolor: '#FFFFFF' },
            yaxis: { ...LIGHT_AXIS, backgroundcolor: '#FFFFFF' },
            zaxis: { ...LIGHT_AXIS, backgroundcolor: '#FFFFFF' },
        },
        legend: { bgcolor: 'rgba(0,0,0,0)' },
        hoverlabel: { bordercolor: slate[300], font: { family: FONT_FAMILY } },
    },
};

const DARK_AXIS = {
    gridcolor: 'rgba(148, 163, 184, 0.16)',
    zerolinecolor: 'rgba(148, 163, 184, 0.35)',
    linecolor: 'rgba(148, 163, 184, 0.35)',
};

const DARK_TEMPLATE = {
    layout: {
        paper_bgcolor: slate[800],
        plot_bgcolor: slate[900],
        font: { family: FONT_FAMILY, color: slate[300] },
        xaxis: DARK_AXIS,
        yaxis: DARK_AXIS,
        ternary: {
            bgcolor: slate[900],
            aaxis: DARK_AXIS,
            baxis: DARK_AXIS,
            caxis: DARK_AXIS,
        },
        scene: {
            xaxis: { ...DARK_AXIS, backgroundcolor: slate[900] },
            yaxis: { ...DARK_AXIS, backgroundcolor: slate[900] },
            zaxis: { ...DARK_AXIS, backgroundcolor: slate[900] },
        },
        legend: { bgcolor: 'rgba(0,0,0,0)' },
        hoverlabel: { bordercolor: 'rgba(148,163,184,0.35)', font: { family: FONT_FAMILY } },
    },
};

export function getPlotlyTemplate(mode: ThemeMode): object {
    return mode === 'dark' ? DARK_TEMPLATE : LIGHT_TEMPLATE;
}
