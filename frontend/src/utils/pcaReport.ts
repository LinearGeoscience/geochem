/**
 * PCA report in the layout ("PCA Report" window, Copy All): Summary,
 * Correlation, Eigenvectors, Eigenvalues/Percent/Cumulative %, Scaled
 * Coordinates. Pasted into cell A1 of a workbook it lines up with templates
 * built from output (e.g. a saved PCA template).
 */
import type { FullPCAResult } from '../types/compositional';

export type ReportCell = string | number | null;

const TRANSFORM_LABEL = { clr: 'CLR', none: 'None', log10: 'Log10' } as const;

export function pcaReportRows(result: FullPCAResult, labels: string[] = result.columns): ReportCell[][] {
    const p = labels.length;
    const k = result.eigenvalues.length;
    const pcs = Array.from({ length: k }, (_, i) => `PC${i + 1}`);
    const all = result.allEigenvalues ?? result.eigenvalues;
    const total = all.reduce((s, v) => s + Math.max(0, v), 0);
    const rows: ReportCell[][] = [];
    const blank = (n: number) => { for (let i = 0; i < n; i++) rows.push([]); };

    rows.push([`PCA Report: Transform ${TRANSFORM_LABEL[result.transform ?? 'clr']}, Scaling true (${result.nSamples} rows)`]);
    blank(1);
    rows.push(['Summary', 'Count']);
    rows.push(['Rows', result.nSamples]);
    rows.push(['Columns', p]);
    blank(2);

    rows.push(['Correlation', ...labels]);
    for (let i = 0; i < p; i++) rows.push([labels[i], ...result.correlationMatrix[i]]);
    blank(2);

    rows.push(['Eigenvectors', ...pcs]);
    for (let j = 0; j < p; j++) rows.push([labels[j], ...result.eigenvectors.map(ev => ev[j])]);
    blank(3);

    rows.push([null, 'Eigenvalues', 'Percent', 'Cumulative %']);
    let cum = 0;
    all.forEach((ev, i) => {
        const pct = total > 0 ? (Math.max(0, ev) / total) * 100 : 0;
        cum += pct;
        rows.push([`PC${i + 1}`, ev, pct, cum]);
    });
    blank(2);

    rows.push(['Scaled Coordinates', ...pcs]);
    for (let j = 0; j < p; j++) rows.push([labels[j], ...result.loadings[j]]);
    return rows;
}

/** Tab-separated text for the clipboard (Excel pastes it into cells) */
export function toTsv(rows: ReportCell[][]): string {
    return rows.map(r => r.map(v => (v === null || v === undefined ? '' : String(v))).join('\t')).join('\r\n');
}

/** standard labels for CLR inputs: "Ag_ppm_CLR" / "Ag" -> "Ag-CLR" when transform is None on CLR columns */
export function reportLabels(result: FullPCAResult): string[] {
    return result.columns.map((c, i) => {
        const d = result.displayColumns[i] ?? c;
        return /clr/i.test(c) ? `${d.replace(/[-_]?clr$/i, '')}-CLR` : c;
    });
}
