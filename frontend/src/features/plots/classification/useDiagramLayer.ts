/**
 * Memoised diagram layer for a plot: resolves the schema-v3 diagram for a
 * (legacy-shaped) store diagram and builds its Plotly pieces.
 */
import { useMemo } from 'react';
import type { ClassificationDiagram } from '../../../types/classificationDiagram';
import type { Diagram } from '../../../types/diagram';
import { getDiagramV3 } from '../../../store/classificationStore';
import { fromLegacyDiagram } from '../../../utils/classification/legacyAdapter';
import { buildDiagramLayer, DiagramLayer, DiagramLayerOptions } from './buildDiagramLayer';

/** The v3 form of a store diagram: the built-in original, or converted (custom diagrams). */
export function toV3(d: ClassificationDiagram): Diagram {
    return d.v3 ?? getDiagramV3(d.id) ?? fromLegacyDiagram(d);
}

export function useDiagramV3(d: ClassificationDiagram | null): Diagram | null {
    return useMemo(() => (d ? toV3(d) : null), [d]);
}

export function useDiagramLayer(d: Diagram | null, options: DiagramLayerOptions): DiagramLayer | null {
    const { style, fillOpacity, showLabels, showGrid, showTitle, showReference, fontScale, axisTitles, dataExtent } = options;
    return useMemo(
        () => (d ? buildDiagramLayer(d, { style, fillOpacity, showLabels, showGrid, showTitle, showReference, fontScale, axisTitles, dataExtent }) : null),
        // axisTitles/dataExtent are compared by value
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [d, style, fillOpacity, showLabels, showGrid, showTitle, showReference, fontScale, JSON.stringify(axisTitles), JSON.stringify(dataExtent)],
    );
}
