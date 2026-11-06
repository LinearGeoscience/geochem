/**
 * Plot type catalogue for the New Plot dialog: description, search keywords
 * and the column settings offered for quick configuration.
 */
import type { PlotType } from '../../store/appStore';
import type { ColumnFilter } from '../../utils/columnGroups';

export interface QuickField {
    key: string;
    label: string;
    /** Multi-column setting (string[]). */
    multi?: boolean;
    filter?: ColumnFilter;
}

export interface PlotTypeMeta {
    type: PlotType;
    description: string;
    keywords: string;
    fields: QuickField[];
}

export const PLOT_TYPE_META: PlotTypeMeta[] = [
    { type: 'scatter', description: 'X–Y scatter, one panel per Y column, regression and density.', keywords: 'xy bivariate harker correlation regression', fields: [{ key: 'xAxis', label: 'X axis' }, { key: 'yAxes', label: 'Y axes', multi: true }] },
    { type: 'ternary', description: 'Three-component ternary, normalised to 100.', keywords: 'triangle afm three component', fields: [{ key: 'aAxis', label: 'A (top)' }, { key: 'bAxis', label: 'B (left)' }, { key: 'cAxis', label: 'C (right)' }] },
    { type: 'spider', description: 'Normalised multi-element / REE pattern.', keywords: 'ree chondrite primitive mantle normalised pattern multi-element', fields: [{ key: 'selectedElements', label: 'Elements', multi: true }] },
    { type: 'histogram', description: 'Distributions with bins, overlays and groups.', keywords: 'distribution frequency bins univariate', fields: [{ key: 'selectedColumns', label: 'Columns', multi: true }] },
    { type: 'probability', description: 'Normal probability plots on a % axis; split by colour group.', keywords: 'probability cumulative normal score population threshold split qq', fields: [{ key: 'selectedColumns', label: 'Columns', multi: true }] },
    { type: 'splom', description: 'Scatter matrix of several columns at once.', keywords: 'pairs matrix splom correlation', fields: [{ key: 'splomColumns', label: 'Columns', multi: true }] },
    { type: 'map', description: 'Attribute-coloured sample map with basemaps.', keywords: 'map spatial location easting northing basemap', fields: [{ key: 'xAxis', label: 'X (Easting)' }, { key: 'yAxis', label: 'Y (Northing)' }] },
    { type: 'contour', description: 'Gridded (IDW) element contours over the map.', keywords: 'grid contour interpolation idw heatmap', fields: [{ key: 'xAxis', label: 'X (Easting)' }, { key: 'yAxis', label: 'Y (Northing)' }] },
    { type: 'map3d', description: '3D samples and drillhole traces (WebGL).', keywords: '3d three dimensional drillhole viewer', fields: [] },
    { type: 'downhole', description: 'Down-hole strip logs per drillhole.', keywords: 'drillhole log depth strip', fields: [{ key: 'selectedFields', label: 'Traces', multi: true }] },
    { type: 'clr', description: 'Centred log-ratio biplot (compositional PCA).', keywords: 'clr log ratio compositional biplot pca', fields: [{ key: 'clrColumns', label: 'Parts', multi: true }] },
    { type: 'pathfinder', description: 'Pathfinder element anomaly maps.', keywords: 'anomaly pathfinder background exploration', fields: [] },
    { type: 'piper', description: 'Piper diagram for major-ion water chemistry.', keywords: 'water hydrochemistry ions facies piper', fields: [] },
    { type: 'pca', description: 'Results of the last PCA run (scree, loadings, ranked eigenvector plots).', keywords: 'pca principal component eigenvector loadings scree factor', fields: [] },
    { type: 'protocols', description: 'How the samples were split into assay protocol groups: detection limits by group and what each group is made of.', keywords: 'assay protocol method lab batch detection limit split groups suite', fields: [] },
    { type: 'classification', description: 'Classification diagram from the library.', keywords: 'classification diagram tas discrimination interop', fields: [] },
];

/** Does a plot type match the search text (label, description, keywords)? */
export function matchesPlotType(m: PlotTypeMeta, label: string, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const hay = `${label} ${m.description} ${m.keywords}`.toLowerCase();
    return q.split(/\s+/).every(w => hay.includes(w));
}
