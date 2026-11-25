/**
 * The samples' colours in a view of the model: the Attributes pane's (the
 * same in every plot), unless the view says to colour them by a column of
 * its own (features/model/sampleColour). The rest of the styling (size,
 * shape, filters, emphasis, how see-through) stays the Attributes pane's.
 */
import { useMemo } from 'react';
import { usePlotSetting } from '../../../hooks/usePlotSetting';
import { useAnalyticalStore, useAppStore } from '../../../store/appStore';
import { getColumnDisplayName } from '../../../utils/attributeUtils';
import { colourSamples, readSampleColouring, SAMPLE_COLOUR_SETTING, type SampleLegend } from '../../model/sampleColour';
import { CYLINDER_BASE_SIZE } from './cylinderShaders';
import type { ViewerStyleBuffers } from './useViewerData';

export interface ViewSampleColours {
    styles: ViewerStyleBuffers;
    /** What the colours stand for (null: the Attributes pane's) */
    legend: SampleLegend | null;
}

/** `own`: the view may colour its samples itself (a view of the model; a plot never does) */
export function useViewSampleColours(plotId: string, base: ViewerStyleBuffers, own: boolean): ViewSampleColours {
    const [saved] = usePlotSetting<unknown>(plotId, SAMPLE_COLOUR_SETTING, null);
    const store = useAnalyticalStore();
    const columns = useAppStore(s => s.columns);
    const colouring = own ? readSampleColouring(saved) : null;
    const key = colouring ? JSON.stringify(colouring) : '';
    const column = colouring ? store.columns.get(colouring.column) : undefined;
    const title = colouring ? getColumnDisplayName(columns, colouring.column) : '';

    // The colours, worked out again only when the column or the colouring changes
    const coloured = useMemo(() => (colouring && column ? colourSamples(column, colouring, title) : null),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the colouring by value
        [key, column, title]);

    return useMemo(() => {
        if (!coloured || coloured.rgb.length / 3 !== base.color.length / 4) return { styles: base, legend: null };
        const color = new Float32Array(base.color.length);
        const rgb = coloured.rgb;
        for (let i = 0, n = rgb.length / 3; i < n; i++) {
            color[i * 4] = rgb[i * 3];
            color[i * 4 + 1] = rgb[i * 3 + 1];
            color[i * 4 + 2] = rgb[i * 3 + 2];
            // How see-through it is stays the Attributes pane's
            color[i * 4 + 3] = base.color[i * 4 + 3];
        }
        return { styles: { ...base, color }, legend: coloured.legend };
    }, [base, coloured]);
}

/**
 * How far from a hole's middle the samples drawn as cylinders reach, m: half their width, times the largest Size of
 * the samples drawn where the width follows the Size attribute (a table beside the holes is drawn clear of it)
 */
export function samplesReach(styles: Pick<ViewerStyleBuffers, 'size' | 'visible'>, width: number, bySize: boolean): number {
    if (!bySize) return width / 2;
    let largest = 0;
    for (let i = 0; i < styles.size.length; i++) if (styles.visible[i] && styles.size[i] > largest) largest = styles.size[i];
    return (width / 2) * (largest > 0 ? largest / CYLINDER_BASE_SIZE : 1);
}
