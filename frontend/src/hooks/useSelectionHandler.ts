/**
 * Shared selection handler hook for all plot components.
 * Handles modifier keys (Ctrl/Cmd=add, Alt=subtract), paint mode integration,
 * and consistent selection logic across ScatterPlot, ClassificationPlot, PathfinderMap.
 */
import { useCallback, useEffect } from 'react';
import { getModifiers } from '../utils/modifierKeys';
import { useAppStore } from '../store/appStore';
import { useAttributeStore } from '../store/attributeStore';
import { paintableIndices } from '../utils/attributeUtils';

export type SelectionMode = 'replace' | 'add' | 'subtract';

/**
 * Merge new indices into the current selection based on mode.
 */
export function mergeSelection(
    current: number[],
    newIndices: number[],
    mode: SelectionMode
): number[] {
    switch (mode) {
        case 'replace':
            return newIndices;
        case 'add': {
            const set = new Set(current);
            for (const idx of newIndices) set.add(idx);
            return Array.from(set);
        }
        case 'subtract': {
            const removeSet = new Set(newIndices);
            return current.filter(i => !removeSet.has(i));
        }
    }
}

/**
 * Default index extractor: reads `customdata.idx` or falls back to `customdata` itself.
 * Override for plots that use different customdata structures. An extractor
 * may return several indices for one point (e.g. a histogram bin).
 */
function defaultIndexExtractor(point: any): number | number[] | null {
    const cd = point.customdata;
    if (cd != null && typeof cd === 'object' && typeof cd.idx === 'number') return cd.idx;
    if (typeof cd === 'number') return cd;
    return null;
}

/** Selection mode from a native mouse event's modifiers (Ctrl/Cmd/Shift add, Alt subtracts). */
export function modeFromEvent(e: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean } | null | undefined): SelectionMode | null {
    if (!e) return null;
    if (e.altKey) return 'subtract';
    if (e.ctrlKey || e.metaKey || e.shiftKey) return 'add';
    return 'replace';
}

export function useSelectionHandler(
    indexExtractor: (point: any) => number | number[] | null = defaultIndexExtractor
) {
    const setSelection = useAppStore((s) => s.setSelection);
    const selectedIndices = useAppStore((s) => s.selectedIndices);
    const paintMode = useAttributeStore((s) => s.paintMode);
    const activeEntryId = useAttributeStore((s) => s.activeEntryId);
    const paintIndicesToActiveEntry = useAttributeStore((s) => s.paintIndicesToActiveEntry);

    // Install the shared modifier-key listeners as soon as a plot mounts
    useEffect(() => { getModifiers(); }, []);

    /**
     * Apply original row indices to the global selection. `modeOverride`
     * comes from a native event (clicks); otherwise the tracked modifier keys
     * decide (lasso/box, where Plotly doesn't pass the mouse event).
     */
    const selectIndices = useCallback((rawIndices: number[], modeOverride?: SelectionMode | null) => {
        if (rawIndices.length === 0) return;
        const { ctrl, alt } = getModifiers();
        const mode: SelectionMode = modeOverride ?? (alt ? 'subtract' : ctrl ? 'add' : 'replace');

        const merged = mergeSelection(selectedIndices, rawIndices, mode);
        setSelection(merged);

        // Auto-paint if paint mode is active
        if (paintMode && activeEntryId) {
            // Paint the raw lasso indices (not the merged selection) to the active entry
            // For subtract mode, we don't paint
            if (mode !== 'subtract') {
                const app = useAppStore.getState();
                paintIndicesToActiveEntry(paintableIndices(rawIndices, app.columnarData.rowCount, c => app.getRawColumn(c)));
            }
        }
    }, [selectedIndices, setSelection, paintMode, activeEntryId, paintIndicesToActiveEntry]);

    const extract = useCallback((points: any[]): number[] => {
        const out: number[] = [];
        for (const pt of points) {
            const idx = indexExtractor(pt);
            if (idx == null) continue;
            if (Array.isArray(idx)) { for (const i of idx) out.push(i); }
            else out.push(idx);
        }
        return out;
    }, [indexExtractor]);

    const handleSelected = useCallback((event: any) => {
        if (!event || !event.points || event.points.length === 0) return;
        selectIndices(extract(event.points));
    }, [selectIndices, extract]);

    /** plotly_click handler: modifiers come from the click's native event. */
    const handleClick = useCallback((event: any) => {
        if (!event || !event.points || event.points.length === 0) return;
        selectIndices(extract(event.points), modeFromEvent(event.event));
    }, [selectIndices, extract]);

    const handleDeselect = useCallback(() => {
        setSelection([]);
    }, [setSelection]);

    return { handleSelected, handleClick, handleDeselect, selectIndices, selectedIndices };
}
