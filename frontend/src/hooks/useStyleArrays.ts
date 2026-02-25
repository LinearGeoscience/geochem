/**
 * Memoized wrapper around getStyleArrays() to avoid recomputing
 * style arrays on every render when dependencies haven't changed.
 */
import { useMemo } from 'react';
import { useAttributeStore } from '../store/attributeStore';
import { getStyleArrays, StyleArrays } from '../utils/attributeUtils';

/**
 * Returns memoized style arrays that only recompute when
 * the data, indices, or relevant attribute configuration changes.
 */
export function useStyleArrays(
    data: Record<string, any>[],
    originalIndices?: number[]
): StyleArrays {
    // Subscribe to the specific attribute fields that getStyleArrays depends on
    const color = useAttributeStore(s => s.color);
    const shape = useAttributeStore(s => s.shape);
    const size = useAttributeStore(s => s.size);
    const filter = useAttributeStore(s => s.filter);
    const customEntries = useAttributeStore(s => s.customEntries);
    const emphasis = useAttributeStore(s => s.emphasis);
    const globalOpacity = useAttributeStore(s => s.globalOpacity);
    const valueFilter = useAttributeStore(s => s.valueFilter);

    return useMemo(() => {
        if (data.length === 0) {
            return { colors: [], shapes: [], sizes: [], visible: [], opacity: [], zIndices: [], emphasisResults: [] };
        }
        return getStyleArrays(data, originalIndices);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        data,
        originalIndices,
        // Attribute config dependencies
        color.field, color.entries, color.additionalFields,
        shape.field, shape.entries,
        size.field, size.entries,
        filter.field, filter.entries,
        customEntries,
        emphasis.enabled, emphasis.mode, emphasis.column, emphasis.threshold, emphasis.minOpacity, emphasis.boostSize, emphasis.sizeBoostFactor,
        globalOpacity,
        valueFilter.enabled, valueFilter.column, valueFilter.min, valueFilter.max,
    ]);
}
