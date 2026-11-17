/**
 * Export every Plotly chart inside a plot pane as SVG or PNG files
 * (several charts, e.g. one per Y variable, are numbered).
 */
import Plotly from 'plotly.js';
import { useAppStore } from '../store/appStore';

export function exportPlotImages(plotId: string, format: 'svg' | 'png'): number {
    const charts = Array.from(document.querySelectorAll(`[data-plot-id="${CSS.escape(plotId)}"] .js-plotly-plot`)) as HTMLElement[];
    const title = useAppStore.getState().plots.find(p => p.id === plotId)?.title ?? 'plot';
    const base = title.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'plot';
    charts.forEach((gd, i) => {
        const { width, height } = gd.getBoundingClientRect();
        void Plotly.downloadImage(gd, {
            format,
            filename: charts.length > 1 ? `${base}_${i + 1}` : base,
            width: Math.max(400, Math.round(width)),
            height: Math.max(300, Math.round(height)),
            ...(format === 'png' ? { scale: 3 } : {}),
        } as Plotly.DownloadImgopts);
    });
    return charts.length;
}
