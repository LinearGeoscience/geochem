import { useAppStore } from '../../store/appStore';
import { getDiagramV3 } from '../../store/classificationStore';

/** Create a plot from a library diagram (Piper opens its native plot). */
export function createPlotFromDiagram(diagramId: string): string {
    const s = useAppStore.getState();
    const v3 = getDiagramV3(diagramId);
    if (v3?.kind === 'builtin' && v3.builtin === 'piper') return s.addPlot('piper');
    return s.addPlot('classification', { settings: { diagramId }, title: v3?.name });
}
