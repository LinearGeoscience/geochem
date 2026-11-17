/**
 * Capture a plot pane as a report figure (Phase 58): PNG images for the
 * report (one per chart in the pane), SVG/PNG copies in the project's
 * figures/ folder, and a description of what was shown.
 */
import Plotly from 'plotly.js';
import { useAppStore, PLOT_TYPE_LABEL } from '../store/appStore';
import { useProjectStore } from '../store/projectStore';
import { useReportStore, ReportFigure } from '../store/reportStore';
import { getWorkspaceApi } from '../features/workspace/workspaceApi';
import { projectFilesAvailable, writeProjectAsset } from '../services/projectFiles';
import { notify } from '../store/notificationStore';
import { describeFigureContext } from './figureContext';

/** Panes that don't draw with Plotly (3D view) register their own capture */
const customCaptures = new Map<string, () => string | null>();

export function registerFigureCapture(plotId: string, capture: () => string | null): () => void {
    customCaptures.set(plotId, capture);
    return () => { if (customCaptures.get(plotId) === capture) customCaptures.delete(plotId); };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function paneOf(plotId: string): HTMLElement | null {
    return document.querySelector(`[data-plot-id="${CSS.escape(plotId)}"]`);
}

function chartsOf(plotId: string): HTMLElement[] {
    return Array.from(document.querySelectorAll(`[data-plot-id="${CSS.escape(plotId)}"] .js-plotly-plot`)) as HTMLElement[];
}

/** Bring the pane to the front (hidden WebGL panes are not mounted) and wait for it to draw */
async function ensureRendered(plotId: string, timeoutMs = 5000): Promise<void> {
    const panel = getWorkspaceApi()?.getPanel(plotId);
    if (panel && !panel.api.isVisible) panel.api.setActive();
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        if (customCaptures.has(plotId) || chartsOf(plotId).some(gd => (gd as any)._fullLayout)) {
            await sleep(300); // let the last redraw finish
            return;
        }
        await sleep(100);
    }
}

const safeName = (s: string) => s.replace(/[^\w .()+-]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'figure';

async function dataUrlBlob(url: string): Promise<Blob> {
    return (await fetch(url)).blob();
}

/** Images of the pane: PNG data URLs for the report plus SVGs for the figures folder */
async function captureImages(plotId: string): Promise<{ png: string[]; svg: string[] }> {
    const custom = customCaptures.get(plotId);
    if (custom) {
        const png = custom();
        return { png: png ? [png] : [], svg: [] };
    }
    const png: string[] = [];
    const svg: string[] = [];
    const charts = chartsOf(plotId);
    for (const gd of charts) {
        const { width, height } = gd.getBoundingClientRect();
        // A chart that sets its own size (e.g. the protocol matrix) is captured at that size
        const fixed = (gd as unknown as { layout?: { width?: unknown; height?: unknown } }).layout ?? {};
        const w = typeof fixed.width === 'number' ? fixed.width : width;
        const h = typeof fixed.height === 'number' ? fixed.height : height;
        const size = { width: Math.max(500, Math.round(w)), height: Math.max(350, Math.round(h)) };
        png.push(await Plotly.toImage(gd, { format: 'png', scale: 2, ...size }));
        try { svg.push(await Plotly.toImage(gd, { format: 'svg', ...size })); } catch { /* PNG is enough */ }
    }
    if (!charts.length) {
        // Panes without Plotly charts: snapshot the DOM
        const el = paneOf(plotId)?.firstElementChild as HTMLElement | null;
        if (el) {
            const { toPng } = await import('html-to-image');
            png.push(await toPng(el, { pixelRatio: 2, backgroundColor: '#ffffff' }));
        }
    }
    return { png, svg };
}

/** Add the plot as a figure to the report; returns it, or null when nothing could be captured */
export async function addPlotToReport(plotId: string): Promise<ReportFigure | null> {
    const plot = useAppStore.getState().plots.find(p => p.id === plotId);
    if (!plot) return null;
    await ensureRendered(plotId);
    let images: { png: string[]; svg: string[] };
    try {
        images = await captureImages(plotId);
    } catch (err) {
        notify(`Could not capture "${plot.title}": ${err instanceof Error ? err.message : err}`, 'error');
        return null;
    }
    if (!images.png.length) {
        notify(`Nothing to capture in "${plot.title}" yet`, 'warning');
        return null;
    }
    const report = useReportStore.getState();
    const number = report.items.filter(it => it.kind === 'figure').length + 1;
    const figure = report.addFigure({
        title: plot.title,
        caption: '',
        images: images.png,
        plotId,
        plotType: PLOT_TYPE_LABEL[plot.type] ?? plot.type,
        context: describeFigureContext(plotId),
    });

    // Copies in <project>/figures when the project is saved to a folder
    const projectPath = useProjectStore.getState().projectPath;
    if (projectPath && await projectFilesAvailable()) {
        const base = `Fig ${String(number).padStart(2, '0')} - ${safeName(plot.title)}`;
        const multi = images.png.length > 1;
        const files: string[] = [];
        try {
            for (const [ext, urls] of [['png', images.png], ['svg', images.svg]] as const) {
                for (let k = 0; k < urls.length; k++) {
                    const name = `${base}${multi ? `_${k + 1}` : ''}.${ext}`;
                    files.push((await writeProjectAsset(projectPath, 'figures', name, await dataUrlBlob(urls[k]))).path);
                }
            }
            useReportStore.getState().updateItem(figure.id, { files });
        } catch (err) {
            console.warn('[report] could not write figure files:', err);
        }
    }
    notify(`Added "${plot.title}" to the report as Figure ${number}`, 'success');
    return figure;
}
