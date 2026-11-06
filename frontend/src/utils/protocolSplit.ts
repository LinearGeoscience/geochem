/**
 * Protocol split helpers: find protocol columns and their stored summary,
 * open the panes that show a split (protocol summary, map, probability
 * plots) and write the split to the report (method note, group table,
 * captured figures).
 */
import { useAppStore } from '../store/appStore';
import { useReportStore } from '../store/reportStore';
import { configureTab } from './attributeClassify';
import { tilePlotsWhenReady } from '../features/workspace/workspaceApi';
import { protocolSummaryText, protocolTable, type ProtocolSummary } from './protocolFigures';

/** Protocol columns: classification columns carrying a protocol summary */
export function protocolColumns(columns: { name: string; derivation?: { params?: Record<string, unknown> } }[]): string[] {
    return columns.filter(c => !!c.derivation?.params && 'protocolSummary' in c.derivation.params).map(c => c.name);
}

export function protocolSummaryOf(columns: { name: string; derivation?: { params?: Record<string, unknown> } }[], name: string): ProtocolSummary | null {
    const c = columns.find(x => x.name === name);
    return (c?.derivation?.params?.protocolSummary as ProtocolSummary | undefined) ?? null;
}

/** Plots opened by Show the split for this column (still open) */
function splitPanes(column: string): string[] {
    const titles = [`Assay protocols: ${column}`, `Map by ${column}`, `Probability by ${column}`];
    return useAppStore.getState().plots.filter(p => titles.includes(p.title ?? '')).map(p => p.id);
}

/** Open the panes that show a protocol split: summary, map, probability plots. Returns their ids. */
export function showProtocolSplit(column: string, probabilityColumns: string[]): string[] {
    configureTab('color', { field: column });
    const app = useAppStore.getState();
    // Panes from an earlier Show the split for this column are reused
    const open = splitPanes(column);
    if (open.length) {
        app.setCurrentView('plots');
        return open;
    }
    const ids = [app.addPlot('protocols', { settings: { column }, title: `Assay protocols: ${column}` })];
    const east = app.columns.find(c => c.role === 'East')?.name;
    const north = app.columns.find(c => c.role === 'North')?.name;
    if (east && north) ids.push(app.addPlot('map', { settings: { xAxis: east, yAxis: north }, title: `Map by ${column}` }));
    if (probabilityColumns.length) {
        ids.push(app.addPlot('probability', {
            settings: { selectedColumns: probabilityColumns.slice(0, 6), splitByColour: true, valueScale: 'log' },
            title: `Probability by ${column}`,
        }));
    }
    app.setCurrentView('plots');
    tilePlotsWhenReady(ids);
    return ids;
}

/** Method text + group table + the split's figures, into the report. */
export async function addProtocolSplitToReport(summary: ProtocolSummary): Promise<number> {
    const report = useReportStore.getState();
    report.addNote(`Assay protocol groups (${summary.column})`, protocolSummaryText(summary));
    const t = protocolTable(summary);
    report.addTable({
        title: `Assay protocol groups (${summary.column})`,
        caption: 'DL = most common detection limit in the group; + = several limits; ? = nothing below detection; — = not analysed.',
        ...t,
    });
    const ids = showProtocolSplit(summary.column, summary.discriminating);
    // Capture pulls in Plotly: loaded only when a report is written
    const { addPlotToReport } = await import('./reportCapture');
    let added = 0;
    for (const id of ids) if (await addPlotToReport(id)) added++;
    return added;
}
