/**
 * Colour samples by a PC score column (PCn for the positive end, negPCn for
 * the negative end): quantile classes, so the top class is the samples where
 * that end's elements are strongest. Adds the score columns first if needed.
 */
import { useAppStore } from '../../../store/appStore';
import { useAttributeStore, createRangeEntry } from '../../../store/attributeStore';
import { isNumericColumn } from '../../../types/columnarData';
import { generateColorsFromPalette } from '../../../utils/colorPalettes';
import { quantileBreaks } from '../../../utils/classification';
import { addPcScoresToData } from './addPcScores';
import type { PcEnd } from './pcaElementPicks';

export const scoreColumn = (componentIndex: number, side: PcEnd) =>
    `${side === 'negative' ? 'neg' : ''}PC${componentIndex + 1}`;

export function colourByPcScore(componentIndex: number, side: PcEnd, numClasses = 5): { ok: boolean; message: string } {
    const name = scoreColumn(componentIndex, side);
    let added = '';
    if (!useAppStore.getState().columns.some(c => c.name === name)) {
        const r = addPcScoresToData();
        if (!r.ok) return r;
        added = 'PC scores added to the data. ';
    }
    const r = colourByQuantiles(name, numClasses);
    return { ok: r.ok, message: r.ok ? `${added}${r.message}` : r.message };
}

/** Colour samples by quantile classes of a numeric column (Jet; red = highest). */
export function colourByQuantiles(name: string, numClasses = 5): { ok: boolean; message: string } {
    const col = useAppStore.getState().getColumn(name);
    if (!col || !isNumericColumn(col)) return { ok: false, message: `Column ${name} not found.` };
    const values: number[] = [];
    for (let i = 0; i < col.length; i++) if (Number.isFinite(col[i])) values.push(col[i]);
    if (!values.length) return { ok: false, message: `${name} has no values.` };

    const breaks = quantileBreaks(values, numClasses);
    const palette = 'Jet';
    const colors = generateColorsFromPalette(palette, breaks.length - 1);
    const attr = useAttributeStore.getState();
    const entries = attr.color.entries.filter(e => e.isDefault);
    for (let i = 0; i < breaks.length - 1; i++) {
        const last = i === breaks.length - 2;
        const entry = createRangeEntry(breaks[i], breaks[i + 1], i, colors[i]);
        entry.rowCount = values.filter(v => v >= breaks[i] && (last ? v <= breaks[i + 1] : v < breaks[i + 1])).length;
        entry.visibleRowCount = entry.rowCount;
        entries.push(entry);
    }
    attr.setField('color', name);
    attr.setMethod('color', 'quantile');
    attr.setPalette('color', palette);
    attr.setNumClasses('color', breaks.length - 1);
    attr.setEntries('color', entries);
    return { ok: true, message: `Samples coloured by ${name} (${breaks.length - 1} quantile classes; red = strongest)` };
}
