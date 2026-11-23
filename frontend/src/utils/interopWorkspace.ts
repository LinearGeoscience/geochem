/**
 * workspaces and templates -> GeoChem plots. A .gas file's
 * workspace.xml and a saved workspace template (.xml) both hold a creator list:
 * one entry per open plot (XY / YX plot, ternary, diagram with its XML
 * embedded, split probability plot, 3D attribute map). XStream writes
 * repeated objects as `reference="../../..."` paths, resolved here.
 */
import type { PlotType } from '../store/appStore';
import { useAppStore } from '../store/appStore';
import { useClassificationStore } from '../store/classificationStore';
import { useCustomDiagramStore } from '../store/customDiagramStore';
import { customDiagramFromXml } from './classification/importInteropXml';
import { tilePlotsWhenReady } from '../features/workspace/workspaceApi';

export interface WorkspacePlot {
    type: PlotType;
    title?: string;
    settings: Record<string, unknown>;
    /** Classification diagrams: the embedded diagram XML and its file name */
    diagramXml?: string;
    diagramFile?: string;
}

export interface WorkspaceParse {
    plots: WorkspacePlot[];
    /** Creator classes with no GeoChem equivalent */
    skipped: string[];
}

const kids = (el: Element, tag?: string) => Array.from(el.children).filter(c => !tag || c.tagName === tag);

/** Follow an XStream `reference` path (relative to the element itself). */
export function deref(el: Element): Element {
    const ref = el.getAttribute('reference');
    if (!ref) return el;
    let cur: Element | null = el;
    for (const step of ref.split('/')) {
        if (!cur) break;
        if (step === '..') cur = cur.parentElement;
        else if (step && step !== '.') {
            const m = step.match(/^(.+?)(?:\[(\d+)\])?$/);
            if (!m) return el;
            cur = kids(cur, m[1])[(m[2] ? Number(m[2]) : 1) - 1] ?? null;
        }
    }
    return cur ?? el;
}

const child = (el: Element, tag: string): Element | undefined => {
    const c = kids(el, tag)[0];
    return c ? deref(c) : undefined;
};

function columnsOf(creator: Element): string[] {
    const list = child(creator, 'm__colList');
    const names = list && child(list, 'm__colNames');
    return names ? kids(names, 'string').map(s => s.textContent ?? '').filter(Boolean) : [];
}

/** X / Y log flags from the chart's axis settings */
function axisLogs(creator: Element): { x: boolean; y: boolean } {
    const out = { x: false, y: false };
    const settings = child(creator, 'm__chartSettings');
    const ordinary = settings && kids(settings)[0] ? deref(kids(settings)[0]) : undefined;
    const axes = ordinary && child(ordinary, 'm__axisSettings');
    for (const a of axes ? kids(axes).map(deref) : []) {
        const name = a.querySelector(':scope > m__axisName')?.textContent ?? '';
        const log = a.querySelector(':scope > m__isLog')?.textContent === 'true';
        if (/^X/i.test(name)) out.x = log;
        else if (/^Y/i.test(name)) out.y = log;
    }
    return out;
}

function creatorToPlot(creator: Element): WorkspacePlot | null {
    const tag = creator.tagName;
    const cols = columnsOf(creator);
    if (/ScatterCreator_-(XY|YX)Creator$/.test(tag)) {
        if (cols.length < 2) return null;
        const yx = tag.endsWith('YXCreator');
        const log = axisLogs(creator);
        return {
            type: 'scatter',
            settings: {
                xAxis: cols[0], yAxes: cols.slice(1), yxMode: yx,
                // In a YX plot the first variable is drawn on the Y axis
                logScaleX: yx ? log.y : log.x, logScaleY: yx ? log.x : log.y,
            },
        };
    }
    if (/TernaryCreator$/.test(tag)) {
        if (cols.length < 3) return null;
        return { type: 'ternary', settings: { aAxis: cols[0], bAxis: cols[1], cAxis: cols[2] } };
    }
    if (/DiagramCreator$/.test(tag)) {
        const xml = child(creator, 'm__diagramXML')?.textContent ?? '';
        const file = child(creator, 'm__title')?.textContent?.trim() || 'Workspace diagram.xml';
        if (!xml.trim()) return null;
        return { type: 'classification', settings: {}, diagramXml: xml, diagramFile: file };
    }
    if (/PPCreator/.test(tag)) {
        if (!cols.length) return null;
        return { type: 'probability', settings: { selectedColumns: cols, splitByColour: /Split/.test(tag) } };
    }
    if (/XYZMapCreator$/.test(tag)) return { type: 'map3d', settings: {} };
    if (/(XY)?MapCreator$/.test(tag)) return { type: 'map', settings: {} };
    if (/HistogramCreator/.test(tag) && cols.length) return { type: 'histogram', settings: { selectedColumns: cols } };
    return null;
}

/** Plots from a creator list (workspace.xml fragment, .gas workspace or workspace template file). */
export function parseInteropWorkspace(xml: string): WorkspaceParse {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror')[0]) throw new Error('Not a readable workspace or template');
    // Checkpoints carry their own creator lists; only the open workspace counts
    const list = Array.from(doc.getElementsByTagName('m__creatorList'))
        .find(el => !el.closest('m__checkpoints'));
    const plots: WorkspacePlot[] = [];
    const skipped: string[] = [];
    for (const raw of list ? kids(list) : []) {
        const creator = deref(raw);
        const plot = creatorToPlot(creator);
        if (plot) plots.push(plot);
        else skipped.push(creator.tagName.split('.').pop() ?? creator.tagName);
    }
    return { plots, skipped };
}

/** Template / workspace column names -> this dataset (exact, case-insensitive, then same element). */
export function resolveWorkspaceColumn(name: string): string | null {
    const { columns, geochemMappings } = useAppStore.getState();
    if (columns.some(c => c.name === name)) return name;
    const ci = columns.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (ci) return ci.name;
    const el = name.split(/[_\s(]/)[0];
    const ms = geochemMappings.filter(m => !m.isExcluded && (m.userOverride || m.detectedElement) === el);
    const pick = ms.find(m => !m.isOxide && (m.userUnit || m.detectedUnit) === 'ppm') ?? ms.find(m => !m.isOxide) ?? ms[0];
    return pick?.originalName ?? null;
}

function resolveSettings(settings: Record<string, unknown>, missing: Set<string>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...settings };
    const one = (v: unknown) => {
        if (typeof v !== 'string' || !v) return v;
        const r = resolveWorkspaceColumn(v);
        if (!r) missing.add(v);
        return r ?? v;
    };
    for (const key of ['xAxis', 'aAxis', 'bAxis', 'cAxis']) if (key in out) out[key] = one(out[key]);
    for (const key of ['yAxes', 'selectedColumns']) {
        if (Array.isArray(out[key])) out[key] = (out[key] as unknown[]).map(one);
    }
    return out;
}

/**
 * Open the plots in GeoChem. Embedded diagrams are imported as custom
 * diagrams (same file name -> same diagram, updated). Returns plot ids and
 * the column names that could not be found.
 */
export function openWorkspacePlots(plots: WorkspacePlot[], opts: { replace?: boolean } = {}) {
    const app = useAppStore.getState();
    if (opts.replace) for (const p of [...app.plots]) app.removePlot(p.id);
    const missing = new Set<string>();
    const ids: string[] = [];
    let diagramsAdded = false;
    for (const plot of plots) {
        const settings = resolveSettings(plot.settings, missing);
        let title = plot.title;
        if (plot.diagramXml) {
            try {
                const d = customDiagramFromXml(plot.diagramXml, plot.diagramFile ?? 'Workspace diagram.xml');
                const store = useCustomDiagramStore.getState();
                if (store.getDiagram(d.id)) store.updateDiagram(d); else store.addDiagram(d);
                diagramsAdded = true;
                settings.diagramId = d.id;
                title = d.name;
            } catch {
                continue;
            }
        }
        ids.push(useAppStore.getState().addPlot(plot.type, { settings, ...(title ? { title } : {}) }));
    }
    if (diagramsAdded) useClassificationStore.getState().refreshCustomDiagrams();
    if (ids.length) useAppStore.getState().setCurrentView('plots');
    // shows a template's plots side by side: tile them (with the plots already
    // open when nine or fewer in all); more than nine stay as tabs
    const all = useAppStore.getState().plots.map(p => p.id);
    if (ids.length >= 2 && ids.length <= 9) tilePlotsWhenReady(all.length <= 9 ? all : ids);
    return { ids, missing: [...missing] };
}

/** Templates menu > Open workspace template (.xml): add the template's plots and report what was left out. */
export async function openInteropTemplateFile(file: File): Promise<string> {
    const { plots, skipped } = parseInteropWorkspace(await file.text());
    if (!plots.length) throw new Error(`No plots GeoChem can open in ${file.name}`);
    const { ids, missing } = openWorkspacePlots(plots);
    const notes = [
        `Opened ${ids.length} plot${ids.length === 1 ? '' : 's'} from ${file.name}`,
        skipped.length ? `skipped: ${[...new Set(skipped)].join(', ')}` : '',
        missing.length ? `columns not found: ${missing.join(', ')}` : '',
    ].filter(Boolean);
    return notes.join('; ');
}
