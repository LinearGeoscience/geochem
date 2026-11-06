/**
 * Rows of the Attribute Manager class under the pointer (uiStore.hoveredClass),
 * as a Set of dataset row indices, or null. Plots draw a ring over these rows
 * so pointing at a class shows where it is in every open plot.
 */
import { useMemo } from 'react';
import { useUIStore } from '../store/uiStore';
import { useStyleInputs } from './useStyleInputs';
import { entryRows } from '../utils/attributeUtils';

export const HOVER_RING_COLOR = '#ffab00';

export function useHoveredClassRows(): Set<number> | null {
    const hovered = useUIStore(s => s.hoveredClass);
    const inputs = useStyleInputs();
    return useMemo(() => {
        void inputs;
        if (!hovered) return null;
        const rows = entryRows(hovered.tab, hovered.id);
        return rows.length ? new Set(rows) : null;
    }, [hovered, inputs]);
}
