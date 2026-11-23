/**
 * Column detection for the pathfinder map: element columns (geochem mappings
 * first, regex fallback), normalisation (Sc/K) columns, extended-mode
 * columns, background values and unit conversion. All getters are memoised
 * so they can be used as stable dependencies.
 */
import { useCallback, useMemo } from 'react';
import type { ColumnGeochemMapping } from '../../../types/associations';
import {
    PATHFINDER_ELEMENTS, NORMALIZATION_COLUMN_PATTERNS, type PathfinderElement,
} from '../../../utils/calculations/pathfinderConstants';
import { findAllPathfinderColumns } from '../../../utils/calculations/pathfinderClassification';
import { findColumnForElement } from '../../../utils/calculations/elementNameNormalizer';
import { resolveColumnToPpm } from '../../../utils/calculations/elementColumnResolver';
import { EXTENDED_ELEMENT_CATEGORIES, getBackgroundValue } from '../../../utils/calculations/elementBackgroundConstants';
import { findElementColumn as findExtendedElementColumn } from '../../../utils/calculations/elementAnomalyClassification';
import type { PathfinderSettings } from './usePathfinderSettings';

interface ColumnLike { name: string }

export function usePathfinderColumns(
    filteredColumns: ColumnLike[],
    geochemMappings: ColumnGeochemMapping[],
    settings: Pick<PathfinderSettings,
        'elementColumnMapping' | 'extendedColumnMapping' | 'mapMode' | 'referenceStandard' |
        'customBackgrounds' | 'scColumn' | 'kColumn'>,
) {
    const { elementColumnMapping, extendedColumnMapping, mapMode, referenceStandard, customBackgrounds, scColumn, kColumn } = settings;

    // Pathfinder element columns (prefer geochem mappings, fallback to regex)
    const autoDetectedColumns = useMemo(() => {
        const found = new Map<PathfinderElement, string>();
        if (geochemMappings.length > 0) {
            for (const element of PATHFINDER_ELEMENTS) {
                const col = findColumnForElement(geochemMappings, element, 'ppm')
                    ?? findColumnForElement(geochemMappings, element);
                if (col) found.set(element, col);
            }
        }
        if (found.size < PATHFINDER_ELEMENTS.length) {
            const regexFound = findAllPathfinderColumns(filteredColumns.map(c => c.name));
            for (const [element, col] of regexFound) {
                if (!found.has(element)) found.set(element, col);
            }
        }
        return found;
    }, [filteredColumns, geochemMappings]);

    // Normalisation columns
    const autoDetectedNormColumns = useMemo(() => {
        const result: { sc: string | null; k: string | null } = { sc: null, k: null };
        for (const col of filteredColumns) {
            if (NORMALIZATION_COLUMN_PATTERNS.Sc.some(p => p.test(col.name))) result.sc = col.name;
            if (NORMALIZATION_COLUMN_PATTERNS.K.some(p => p.test(col.name))) result.k = col.name;
        }
        return result;
    }, [filteredColumns]);

    const getElementColumn = useCallback((element: PathfinderElement): string | null =>
        elementColumnMapping[element] || autoDetectedColumns.get(element) || null,
    [elementColumnMapping, autoDetectedColumns]);

    // Thresholds and backgrounds are in ppm; a column may be pct or ppb
    // (e.g. only Zn_pct or Au_ppb present) — convert before classifying.
    const toPpmFactor = useCallback((column: string): number =>
        resolveColumnToPpm(geochemMappings, column)?.toPpm ?? 1,
    [geochemMappings]);

    const effectiveScColumn = scColumn || autoDetectedNormColumns.sc || '';
    const effectiveKColumn = kColumn || autoDetectedNormColumns.k || '';

    const availableElements = useMemo(
        () => PATHFINDER_ELEMENTS.filter(el => getElementColumn(el) !== null),
        [getElementColumn]
    );

    // Extended mode: columns for every element in the library
    const autoDetectedExtendedColumns = useMemo(() => {
        const found: Record<string, string> = {};
        const colNames = filteredColumns.map(c => c.name);
        for (const group of Object.values(EXTENDED_ELEMENT_CATEGORIES)) {
            for (const element of group.elements) {
                const col = findExtendedElementColumn(element, colNames, geochemMappings);
                if (col) found[element] = col;
            }
        }
        return found;
    }, [filteredColumns, geochemMappings]);

    const getExtendedElementColumn = useCallback((element: string): string | null =>
        extendedColumnMapping[element] || autoDetectedExtendedColumns[element] || null,
    [extendedColumnMapping, autoDetectedExtendedColumns]);

    const availableExtendedElements = useMemo(() => {
        const all: string[] = [];
        for (const group of Object.values(EXTENDED_ELEMENT_CATEGORIES)) {
            for (const element of group.elements) {
                if (getExtendedElementColumn(element)) all.push(element);
            }
        }
        return all;
    }, [getExtendedElementColumn]);

    // Background value for an extended element (from standard or custom)
    const getExtendedBackground = useCallback((element: string): number | null => {
        if (referenceStandard === 'custom') return customBackgrounds[element] ?? null;
        return getBackgroundValue(referenceStandard, element)?.value ?? null;
    }, [referenceStandard, customBackgrounds]);

    // Unified column getter for the active mode
    const getActiveElementColumn = useCallback((element: string): string | null =>
        mapMode === 'pathfinder'
            ? getElementColumn(element as PathfinderElement)
            : getExtendedElementColumn(element),
    [mapMode, getElementColumn, getExtendedElementColumn]);

    return {
        autoDetectedColumns, autoDetectedNormColumns,
        effectiveScColumn, effectiveKColumn,
        availableElements, availableExtendedElements,
        getElementColumn, getExtendedElementColumn, getActiveElementColumn,
        getExtendedBackground, toPpmFactor,
    };
}
