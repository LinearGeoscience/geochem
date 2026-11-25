/**
 * Picking the elements at one end of a ranked eigenvector plot and turning
 * them into dataset columns to plot.
 */
import type { FullPCAResult } from '../../../types/compositional';
import type { ColumnGeochemMapping } from '../../../types/associations';
import { getSortedLoadings } from '../../../utils/calculations/pcaAnalysis';
import { resolveElementColumn } from '../../../utils/calculations/elementColumnResolver';

export type PcEnd = 'positive' | 'negative';

/** Element labels with loading >= threshold (positive end) or <= -threshold (negative end), from the end inward. */
export function endElements(result: FullPCAResult, componentIndex: number, side: PcEnd, threshold: number): string[] {
    const sorted = getSortedLoadings(result, componentIndex);
    const end = side === 'positive'
        ? sorted.filter(l => l.loading >= threshold)
        : sorted.filter(l => l.loading <= -threshold).reverse();
    return end.map(l => l.element);
}

/** Which end most of `labels` sit on. */
export function sideOf(result: FullPCAResult, componentIndex: number, labels: string[]): PcEnd {
    const loading = new Map(getSortedLoadings(result, componentIndex).map(l => [l.element, l.loading]));
    const pos = labels.filter(l => (loading.get(l) ?? 0) >= 0).length;
    return pos >= labels.length - pos ? 'positive' : 'negative';
}

/**
 * Dataset columns for element labels of the result: the raw element column
 * (ppm preferred) or the PCA input column (e.g. the CLR). Labels without a raw
 * element column fall back to the input column.
 */
export function columnsForElements(
    result: FullPCAResult,
    labels: string[],
    mappings: ColumnGeochemMapping[],
    source: 'raw' | 'inputs',
): string[] {
    const display = result.displayColumns ?? result.columns;
    const out: string[] = [];
    for (const label of labels) {
        const input = result.columns[display.indexOf(label)] ?? label;
        const col = source === 'raw' ? resolveElementColumn(mappings, label)?.column ?? input : input;
        if (!out.includes(col)) out.push(col);
    }
    return out;
}
