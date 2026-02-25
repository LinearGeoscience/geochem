/**
 * Shared selection handler hook for all plot components.
 * Handles modifier keys (Ctrl/Cmd=add, Alt=subtract), paint mode integration,
 * and consistent selection logic across ScatterPlot, ClassificationPlot, PathfinderMap.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { useAttributeStore } from '../store/attributeStore';

type SelectionMode = 'replace' | 'add' | 'subtract';

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
 * Override for plots that use different customdata structures.
 */
function defaultIndexExtractor(point: any): number | null {
    const cd = point.customdata;
    if (cd != null && typeof cd === 'object' && typeof cd.idx === 'number') return cd.idx;
    if (typeof cd === 'number') return cd;
    return null;
}

export function useSelectionHandler(
    indexExtractor: (point: any) => number | null = defaultIndexExtractor
) {
    const setSelection = useAppStore((s) => s.setSelection);
    const selectedIndices = useAppStore((s) => s.selectedIndices);
    const paintMode = useAttributeStore((s) => s.paintMode);
    const activeEntryId = useAttributeStore((s) => s.activeEntryId);
    const paintIndicesToActiveEntry = useAttributeStore((s) => s.paintIndicesToActiveEntry);

    // Track modifier keys via document-level listeners
    const modifiersRef = useRef<{ ctrl: boolean; alt: boolean }>({ ctrl: false, alt: false });

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            modifiersRef.current.ctrl = e.ctrlKey || e.metaKey;
            modifiersRef.current.alt = e.altKey;
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            modifiersRef.current.ctrl = e.ctrlKey || e.metaKey;
            modifiersRef.current.alt = e.altKey;
        };

        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('keyup', handleKeyUp);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('keyup', handleKeyUp);
        };
    }, []);

    const handleSelected = useCallback((event: any) => {
        if (!event || !event.points || event.points.length === 0) return;

        const rawIndices: number[] = [];
        for (const pt of event.points) {
            const idx = indexExtractor(pt);
            if (idx != null) rawIndices.push(idx);
        }
        if (rawIndices.length === 0) return;

        // Determine selection mode from modifier keys
        const { ctrl, alt } = modifiersRef.current;
        const mode: SelectionMode = alt ? 'subtract' : ctrl ? 'add' : 'replace';

        const merged = mergeSelection(selectedIndices, rawIndices, mode);
        setSelection(merged);

        // Auto-paint if paint mode is active
        if (paintMode && activeEntryId) {
            // Paint the raw lasso indices (not the merged selection) to the active entry
            // For subtract mode, we don't paint
            if (mode !== 'subtract') {
                paintIndicesToActiveEntry(rawIndices);
            }
        }
    }, [selectedIndices, setSelection, paintMode, activeEntryId, paintIndicesToActiveEntry, indexExtractor]);

    const handleDeselect = useCallback(() => {
        setSelection([]);
    }, [setSelection]);

    return { handleSelected, handleDeselect, selectedIndices };
}
