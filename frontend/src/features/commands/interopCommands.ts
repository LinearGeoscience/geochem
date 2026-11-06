/**
 * menu command finder: GeoChem actions keyed by the menu path a
 * tutorial names ("Data/Data Doctor", "Analysis/Principal Component
 * Analysis", "Home/Save Checkpoint"), so any tutorial can be followed.
 */
import { useAppStore, type PlotType } from '../../store/appStore';
import { useUIStore } from '../../store/uiStore';
import { useCheckpointStore } from '../../store/checkpointStore';
import { useAttributeStore, TAB_NAMES, type AttributeType } from '../../store/attributeStore';
import { attributeColumnValues } from '../../utils/attributeUtils';
import { notify } from '../../store/notificationStore';
import { useLegendStore } from '../../store/legendStore';
import { openInteropTemplateFile } from '../../utils/interopWorkspace';
import { parseGat } from '../../utils/interopLegend';
import { WORKFLOWS } from '../../utils/workflows/library';
import { useWorkflowStore } from '../../store/workflowStore';
import { openWorkflowsPane } from '../workspace/workspaceApi';

export interface Command {
    id: string;
    /** menu path */
    interop: string;
    /** What it does in GeoChem */
    title: string;
    keywords?: string;
    /** Needs a loaded dataset */
    needsData?: boolean;
    run: () => void;
}

const view = (v: Parameters<ReturnType<typeof useAppStore.getState>['setCurrentView']>[0]) => () => useAppStore.getState().setCurrentView(v);
const plot = (type: PlotType) => () => {
    const s = useAppStore.getState();
    s.addPlot(type);
    s.setCurrentView('plots');
};
const plotWith = (type: PlotType, settings: Record<string, unknown>) => () => {
    const s = useAppStore.getState();
    s.addPlot(type, { settings });
    s.setCurrentView('plots');
};
/** Ask for a file, then hand it to `handle` */
const pickFile = (accept: string, handle: (f: File) => Promise<string>) => () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
        const f = input.files?.[0];
        if (f) handle(f).then(msg => notify(msg, 'success'), err => notify(err instanceof Error ? err.message : String(err), 'error'));
    };
    input.click();
};
const analysis = (tab: number) => () => {
    useUIStore.getState().setAnalysisTab(tab);
    useAppStore.getState().setCurrentView('analysis');
};

/** Data > From Colour / Shape / Size / Filter, straight to a new column */
function fromAttribute(tab: AttributeType) {
    return () => {
        const app = useAppStore.getState();
        const cfg = useAttributeStore.getState()[tab];
        if (!cfg.field && !useAttributeStore.getState().customEntries.length) {
            notify(`No ${TAB_NAMES[tab]} attributes set`, 'warning');
            return;
        }
        const base = tab === 'shape' ? 'Lithology' : `${TAB_NAMES[tab]}_Group`;
        const names = app.columns.map(c => c.name);
        let name = base, k = 2;
        while (names.includes(name)) name = `${base}_${k++}`;
        app.addColumn(name, attributeColumnValues(tab, app.columnarData.rowCount, n => app.getRawColumn(n)), 'categorical', 'Classification');
        notify(`Added "${name}" from ${TAB_NAMES[tab]}`, 'success');
    };
}

export function buildCommands(): Command[] {
    const ui = () => useUIStore.getState();
    const list: Command[] = [
        { id: 'open', interop: 'File/Open', title: 'Data Import (.gas, .csv, .xlsx; Excel sheet choice)', keywords: 'import load gas excel', run: view('import') },
        { id: 'save', interop: 'File/Save', title: 'Save project (.chem)', keywords: 'project', run: () => { void import('../../store/projectStore').then(m => m.useProjectStore.getState().saveProjectToFile()); } },
        { id: 'google', interop: 'File/Export/Google Earth', title: 'GIS dialog: visible points to KML / GeoJSON', keywords: 'kml geojson export gis', needsData: true, run: () => ui().setGisOpen(true) },
        { id: 'xlsx', interop: 'File/Export/Excel', title: 'Data view: Export CSV (PCA report: Export .xlsx)', keywords: 'csv export', needsData: true, run: view('data') },
        { id: 'doctor', interop: 'Data/Data Doctor', title: 'Data Doctor: below detection, text codes, zeros, units', keywords: 'clean replace negatives', needsData: true, run: () => ui().setDataDoctorOpen(true) },
        { id: 'protocols', interop: 'Data/Assay protocols', title: 'Assay protocols: group samples by element suite and detection limits', keywords: 'assay type method lab batch detection limit split xrf icp', needsData: true, run: () => ui().setAssayProtocolsOpen(true) },
        { id: 'calc', interop: 'Data/Calculate Columns', title: 'Calculate Columns sheet (letters, Calculate All, save)', keywords: 'formula expression', needsData: true, run: () => ui().setCalculateColumns({}) },
        { id: 'log10', interop: 'Data/Transform/Log10', title: 'Calculate Columns: Log10 preset', keywords: 'logarithm transform', needsData: true, run: () => ui().setCalculateColumns({ preset: 'log10' }) },
        { id: 'ln', interop: 'Data/Transform/Ln', title: 'Calculate Columns: natural log preset', needsData: true, run: () => ui().setCalculateColumns({ preset: 'ln' }) },
        { id: 'logidx', interop: 'Data/Calculate Columns/Log additive index', title: 'Calculate Columns: LOG10(A)+LOG10(B)+…', keywords: 'pathfinder index', needsData: true, run: () => ui().setCalculateColumns({ preset: 'logAdditive' }) },
        { id: 'neg', interop: 'Data/Calculate Columns/-A', title: 'Calculate Columns: negate (negPC1…)', keywords: 'negative pc', needsData: true, run: () => ui().setCalculateColumns({ preset: 'negate' }) },
        { id: 'wsum', interop: 'Data/Weighted Sums', title: 'Weighted sums (Garrett & Grunsky)', needsData: true, run: () => ui().setCalculateColumns({ preset: 'weighted' }) },
        { id: 'rules', interop: 'Attributes/Classify by rules', title: 'Classify by rules: ordered column windows → colour groups (first match wins)', keywords: 'priority mineral swir alteration threshold lasso', needsData: true, run: () => ui().setRulesOpen(true) },
        { id: 'compareCls', interop: 'Analysis/Compare classifications', title: 'Compare colour groups with a text column (agreement, kappa, cross-tab)', keywords: 'confusion matrix accuracy logging', needsData: true, run: () => ui().setCompareOpen(true) },
        { id: 'fromColour', interop: 'Data/From Colour', title: 'Colour rows → new text column', needsData: true, run: fromAttribute('color') },
        { id: 'fromShape', interop: 'Data/From Shape', title: 'Shape rows → new text column (Lithology)', needsData: true, run: fromAttribute('shape') },
        { id: 'fromSize', interop: 'Data/From Size', title: 'Size rows → new text column', needsData: true, run: fromAttribute('size') },
        { id: 'fromFilter', interop: 'Data/From Filter', title: 'Filter rows → new text column', needsData: true, run: fromAttribute('filter') },
        { id: 'proj', interop: 'Data/Define Projection', title: 'Columns: dataset projection (EPSG)', keywords: 'epsg mga coordinate system', needsData: true, run: view('columns') },
        { id: 'colprops', interop: 'Data/Column Properties', title: 'Columns manager and Chemistry mappings', keywords: 'units element', needsData: true, run: view('columns') },
        { id: 'lonlat', interop: 'Calculation/WGS84 Long Lat', title: 'GIS dialog: add Longitude / Latitude columns', keywords: 'wgs84 latitude longitude', needsData: true, run: () => ui().setGisOpen(true) },
        { id: 'clr', interop: 'Analysis/Centred Log Ratio', title: 'Analysis › Transformations (CLR, ALR, ILR…)', keywords: 'clr transform compositional', needsData: true, run: analysis(8) },
        { id: 'pca', interop: 'Analysis/Principal Component Analysis', title: 'Analysis › PCA (transform None / CLR / Log10, report)', keywords: 'pca eigen scree loadings', needsData: true, run: analysis(9) },
        { id: 'stats', interop: 'Analysis/Summary Statistics', title: 'Analysis › Summary statistics (by colour group; medians → user nodes)', keywords: 'median group split user nodes', needsData: true, run: analysis(0) },
        { id: 'corr', interop: 'Analysis/Correlation Matrix', title: 'Analysis › Correlation matrix', needsData: true, run: analysis(2) },
        { id: 'xyplot', interop: 'Graphs/XY Plot', title: 'New scatter plot (zoom to data/origin, statistics)', keywords: 'scatter', needsData: true, run: plot('scatter') },
        { id: 'yxplot', interop: 'Graphs/YX Plot', title: 'New scatter plot in YX mode (first variable on Y)', keywords: 'yx scatter', needsData: true, run: plotWith('scatter', { yxMode: true }) },
        { id: 'density', interop: 'Graphs/XY Plot/Point Density Contours', title: 'New scatter plot with the point density overlay (cells across × down in settings)', keywords: 'density contour heat', needsData: true, run: plotWith('scatter', { densityOverlay: true }) },
        { id: 'reflines', interop: 'Graphs/XY Plot/Lines', title: 'Scatter plot › Reference lines button (pyrite, calcite, V/Sc, Zr/Hf, custom)', keywords: 'ratio line pyrite calcite', needsData: true, run: plot('scatter') },
        { id: 'template', interop: 'File/Open Template', title: 'Open a template (.xml): its plots and diagrams', keywords: 'template workspace xml', needsData: true, run: pickFile('.xml', openInteropTemplateFile) },
        { id: 'loadgat', interop: 'Attributes/Load Attributes', title: 'Load a legend (.gat); Auto-Attribute uses its colours by name', keywords: 'gat legend colours', run: pickFile('.gat,.xml', async f => {
            const lg = parseGat(await f.text(), f.name.replace(/\.gat$/i, ''));
            useLegendStore.getState().setLegend(lg);
            return `Legend "${lg.name}" loaded (${lg.color.length} colours); Auto-Attribute on a text column now uses it`;
        }) },
        { id: 'props', interop: 'Graphs/Graph Properties', title: 'Graph properties of the active plot (title, labels, ranges, font, legend; SVG/PNG)', keywords: 'presentation edit title axis font export svg png', needsData: true, run: () => {
            const id = useAppStore.getState().activePlotId;
            if (id) void import('../../store/workspaceStore').then(m => m.useWorkspaceStore.getState().setPropertiesPlotId(id));
            else notify('Open a plot first', 'warning');
        } },
        { id: 'prob', interop: 'Graphs/Probability Plot', title: 'New probability plot (split by colour group)', keywords: 'cumulative', needsData: true, run: plot('probability') },
        { id: 'ternary', interop: 'Graphs/Ternary Plot', title: 'New ternary plot', needsData: true, run: plot('ternary') },
        { id: 'spider', interop: 'Graphs/Spider Plot', title: 'New spider plot (open normalisation, group means)', keywords: 'normalisation primitive mantle chondrite', needsData: true, run: plot('spider') },
        { id: 'class', interop: 'Graphs/Classification Diagrams', title: 'New classification diagram (templates)', keywords: 'diagram template ger pearce tas', needsData: true, run: plot('classification') },
        { id: 'box', interop: 'Graphs/Box Plot', title: 'Analysis › Box plots', needsData: true, run: analysis(1) },
        { id: 'splom', interop: 'Graphs/Scatterplot Matrix', title: 'New scatter matrix', needsData: true, run: plot('splom') },
        { id: 'map', interop: 'Map/Attribute Map', title: 'New attribute map (reverse ordering)', needsData: true, run: plot('map') },
        { id: 'map3d', interop: 'Map/Attribute Map 3D', title: 'New 3D map (X-Y / Y-Z / X-Z views)', keywords: '3d', needsData: true, run: plot('map3d') },
        { id: 'downhole', interop: 'Graphs/Downhole Plot', title: 'New downhole plot', needsData: true, run: plot('downhole') },
        { id: 'nodes', interop: 'Graphs/Show Mineral and Rock Nodes', title: 'Diamond button on Classification / Ternary / XY plots', keywords: 'mineral nodes albite chlorite', needsData: true, run: plot('classification') },
        { id: 'checkpoint', interop: 'Home/Save Checkpoint', title: 'Save an attribute checkpoint', needsData: true, run: () => notify(`Saved checkpoint "${useCheckpointStore.getState().saveCheckpoint().name}"`, 'success') },
        { id: 'qaqc', interop: 'Analysis/QAQC', title: 'QA/QC: standards, blanks, duplicates', needsData: true, run: view('qaqc') },
        { id: 'editor', interop: 'Diagram Editor', title: 'Diagram editor (import diagram XML templates)', run: view('diagram-editor') },
        { id: 'newplot', interop: 'Graphs/New Graph', title: 'New plot dialog', needsData: true, run: () => ui().setNewPlotDialogOpen(true) },
        { id: 'workflows', interop: 'Workflows/Open pane', title: 'Workflows pane: deposit-style recipes, one step at a time (Alt+F)', keywords: 'halley recipe steps deposit', needsData: true, run: () => openWorkflowsPane() },
    ];
    for (const w of WORKFLOWS) {
        list.push({
            id: `workflow:${w.id}`, interop: `Workflows/${w.name}`, title: w.summary, keywords: `${w.group} workflow recipe`, needsData: true,
            run: () => { useWorkflowStore.getState().select(w.id); openWorkflowsPane(); },
        });
    }
    for (const cp of useCheckpointStore.getState().checkpoints) {
        list.push({
            id: `restore:${cp.id}`, interop: 'Home/Restore Checkpoint', title: `Restore "${cp.name}"`, keywords: cp.name, needsData: true,
            run: () => { if (useCheckpointStore.getState().restoreCheckpoint(cp.id)) notify(`Restored "${cp.name}"`, 'success'); },
        });
    }
    return list;
}

/** Ranked matches: every word must appear in path/title/keywords; menu path, then keyword, then title hits. */
export function searchCommands(query: string, commands: Command[]): Command[] {
    const words = query.toLowerCase().split(/[\s/>›]+/).filter(Boolean);
    if (!words.length) return commands;
    const scored: { c: Command; score: number }[] = [];
    for (const c of commands) {
        const path = c.interop.toLowerCase();
        const text = `${path} ${c.title.toLowerCase()} ${(c.keywords ?? '').toLowerCase()}`;
        if (!words.every(w => text.includes(w))) continue;
        let score = 0;
        for (const w of words) {
            if (c.id === w) score += 4;   // the command's own short name (pca, protocols, ...)
            else if (path.split('/').some(seg => seg.startsWith(w))) score += 3;
            else if (path.includes(w) || (c.keywords ?? '').toLowerCase().includes(w)) score += 2;
            else score += 1;
        }
        scored.push({ c, score });
    }
    return scored.sort((a, b) => b.score - a.score).map(s => s.c);
}
