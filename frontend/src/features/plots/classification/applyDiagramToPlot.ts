/** Turn a plot into a classification plot of `diagramId`, remembering the old plot for "Clear diagram". */
import { useAppStore } from '../../../store/appStore';

export function applyDiagramToPlot(plotId: string, diagramId: string): void {
    const state = useAppStore.getState();
    const plot = state.plots.find(p => p.id === plotId);
    if (!plot) return;
    const { previousPlot: _drop, ...settings } = plot.settings ?? {};
    void _drop;
    state.replacePlot(plotId, {
        type: 'classification',
        settings: { diagramId, previousPlot: { type: plot.type, settings } },
    });
}
