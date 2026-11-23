/**
 * Theme-aware wrapper around react-plotly.js.
 *
 * Injects the design-system Plotly template (utils/plotTheme.ts) for the
 * active mode — both light AND dark since the UI refresh. Swap
 * `import Plot from 'react-plotly.js'` for
 * `import Plot from '.../components/ThemedPlot'` — same props, default export.
 *
 * NOT used by publication/export components (PublicationMapCell,
 * MineralisationMapCell, PCAFigureGenerator, StepReviewExport) — exported
 * figures keep plain Plotly styling regardless of the UI theme.
 *
 * Inside a plot pane (PlotIdContext) the plot's Graph properties
 * (settings.presentation: titles, ranges, fonts, legend) are laid over the
 * chart's own layout.
 */
import React, { useContext, useMemo } from 'react';
import Plot, { PlotParams } from 'react-plotly.js';
import { useUIStore } from '../store/uiStore';
import { getPlotlyTemplate } from '../utils/plotTheme';
import { useAppStore } from '../store/appStore';
import { applyPresentation, PlotIdContext, type Presentation } from '../utils/plotPresentation';
import { compactLayout } from '../utils/plotDensity';

const ThemedPlot: React.FC<PlotParams> = (props) => {
    const themeMode = useUIStore(s => s.themeMode);
    const plotId = useContext(PlotIdContext);
    const presentation = useAppStore(s => (plotId ? s.plots.find(p => p.id === plotId)?.settings?.presentation : undefined)) as Presentation | undefined;

    const layout = useMemo(() => {
        const template = getPlotlyTemplate(themeMode);
        // Plot-specific layout keys win over the template's defaults
        return applyPresentation({ template, ...compactLayout(props.layout ?? {}) }, presentation) as PlotParams['layout'];
    }, [props.layout, themeMode, presentation]);

    // A fixed layout.height also becomes the div's CSS height. Plots.resize
    // (dock panes, window resize) deletes layout.height and re-reads the
    // div; with responsive config and no CSS height the div measures 0 and
    // the chart overflows onto its neighbours.
    const fixedHeight = typeof props.layout?.height === 'number' ? props.layout.height : undefined;
    const style = useMemo(
        () => (fixedHeight !== undefined && props.style?.height === undefined ? { ...props.style, height: fixedHeight } : props.style),
        [props.style, fixedHeight],
    );

    return <Plot {...props} layout={layout} style={style} />;
};

export default ThemedPlot;
