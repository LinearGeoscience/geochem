/**
 * Memoized wrapper around getStyleArrays() to avoid recomputing
 * style arrays on every render when dependencies haven't changed.
 */
import { useMemo } from 'react';
import { useAttributeStore } from '../store/attributeStore';
import { getStyleArrays, getStyleArraysColumnar, StyleArrays } from '../utils/attributeUtils';
import { useAppStore } from '../store/appStore';

/**
 * Returns memoized style arrays that only recompute when
 * the data, indices, or relevant attribute configuration changes.
 *
 * When columnar data is available (rowCount > 0), uses the faster
 * columnar path that avoids materializing row objects.
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

    // Columnar data for fast path — subscribe to stable scalar, not full object
    const columnarRowCount = useAppStore(s => s.columnarData.rowCount);
    const _sampleIndicesArray = useAppStore(s => s._sampleIndicesArray);
    const getDisplayColumn = useAppStore(s => s.getDisplayColumn);

    return useMemo(() => {
        if (data.length === 0) {
            return { colors: [], shapes: [], sizes: [], visible: [], opacity: [], zIndices: [], emphasisResults: [] };
        }

        // Fast path: use columnar storage when available
        if (columnarRowCount > 0) {
            return getStyleArraysColumnar(data.length, (name) => getDisplayColumn(name), originalIndices);
        }

        return getStyleArrays(data, originalIndices);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        data,
        originalIndices,
        columnarRowCount,
        _sampleIndicesArray,
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
