/**
 * Figures, text and tables that show HOW a dataset was split into assay
 * protocol groups (Data > Assay protocols): built from a compact summary
 * stored with the protocol column, so they survive save / reload and can be
 * redrawn in a plot pane and written to the report.
 *
 *  - protocolMatrix: groups x elements; colour = the group's usual detection
 *    limit relative to the lowest limit any group has for that element
 *    (x1 = lowest); grey = analysed, nothing below detection; blank = not
 *    analysed. Suites show as blocks of blank columns, DL differences as colour.
 *  - protocolComposition: samples per group, stacked by any text column
 *    (lab method, batch, sample type) — what each group is made of.
 *  - protocolSummaryText / protocolTable: the method in words and the group list.
 */
import type { Data, Layout } from 'plotly.js';
import type { DlCount, ProtocolResult } from './assayProtocols';

export interface ProtocolSummaryGroup {
    name: string;
    rows: number;
    elements: string[];
    /** Most frequent detection limits per column (up to 3) */
    dls: Record<string, DlCount[]>;
    mixedDl: string[];
    dlDiffers: string[];
    /** Batches / methods in the group (first 50) and how many there are */
    batches: string[];
    batchCount: number;
    suite: number;
    /** Sample medium (with a stratum column) */
    stratum?: string | null;
}

export interface ProtocolSummary {
    /** The protocol column */
    column: string;
    batchColumn: string | null;
    /** Groups were made within each value of this column (sample medium) */
    stratumColumn?: string | null;
    rowCount: number;
    /** Rows with no assay values */
    empty: number;
    /** Assay columns used */
    columns: string[];
    /** Columns left out as the same measurement in another unit */
    twinsLeftOut: string[];
    /** Columns whose clear-cut ½-DL values were read as detection limits */
    halfDlColumns: string[];
    /** null = automatic (1 % of the rows, or of each medium's rows) */
    minGroupSize: number | null;
    /** Columns whose DL or presence differs between groups (most different first, up to 12) */
    discriminating: string[];
    groups: ProtocolSummaryGroup[];
    created: string;
}

export function summariseProtocols(
    result: ProtocolResult,
    opts: {
        column: string; batchColumn: string | null; stratumColumn?: string | null; rowCount: number; columns: string[];
        twinsLeftOut: string[]; halfDlColumns: string[]; minGroupSize: number | null;
    },
): ProtocolSummary {
    return {
        ...opts,
        empty: result.empty,
        discriminating: result.discriminating.slice(0, 12),
        groups: result.groups.map(g => ({
            name: g.name,
            rows: g.rows.length,
            elements: g.elements,
            dls: Object.fromEntries(Object.entries(g.dls).map(([c, list]) => [c, list.slice(0, 3)])),
            mixedDl: g.mixedDl,
            dlDiffers: g.dlDiffers,
            batches: g.batches.slice(0, 50),
            batchCount: g.batches.length,
            suite: g.suite,
            stratum: g.stratum,
        })),
        created: new Date().toISOString(),
    };
}

/** Column label without the unit suffix (Cu_ppm -> Cu) */
export const shortName = (c: string) => c.replace(/[_\s(]*(ppm|ppb|pct|percent|%|wt%|ppt|g\/t)\)?$/i, '');

const fmt = (v: number) => (v >= 1000 ? v.toLocaleString() : String(+v.toPrecision(3)));

const DL_SCALE: Array<[number, string]> = [[0, '#b8e0b0'], [0.2, '#fff3b0'], [0.45, '#fdae61'], [0.7, '#e6550d'], [1, '#99000d']];
const NOT_SHOWN = '#cfd6dd';

export interface FigureSpec { data: Data[]; layout: Partial<Layout> }

/** Groups shown in figures: the largest `max` (in the summary's order) */
function shownGroups(s: ProtocolSummary, max: number): ProtocolSummaryGroup[] {
    if (s.groups.length <= max) return s.groups;
    const keep = new Set([...s.groups].sort((a, b) => b.rows - a.rows).slice(0, max).map(g => g.name));
    return s.groups.filter(g => keep.has(g.name));
}

export const groupLabel = (g: { name: string; rows: number }) => `${g.name} (${g.rows.toLocaleString()})`;

/** Groups x elements matrix of detection limits (see file header). */
export function protocolMatrix(s: ProtocolSummary, opts: { maxGroups?: number } = {}): FigureSpec {
    const groups = shownGroups(s, opts.maxGroups ?? 25);
    const cols = s.columns.filter(c => groups.some(g => g.elements.includes(c)));
    const y = groups.map(groupLabel);
    const x = cols.map(shortName);
    // Lowest DL of each element across the groups shown
    const lowest = cols.map(c => {
        let m = Infinity;
        for (const g of groups) { const d = g.dls[c]?.[0]?.dl; if (d !== undefined && d > 0 && d < m) m = d; }
        return m;
    });
    const analysed: (number | null)[][] = [];
    const z: (number | null)[][] = [];
    const text: string[][] = [];
    const hover: string[][] = [];
    let zmax = 1;
    groups.forEach(g => {
        const aRow: (number | null)[] = [], zRow: (number | null)[] = [], tRow: string[] = [], hRow: string[] = [];
        cols.forEach((c, j) => {
            const inSuite = g.elements.includes(c);
            const list = g.dls[c];
            aRow.push(inSuite ? 1 : null);
            if (inSuite && list?.length) {
                const r = Math.log10(list[0].dl / lowest[j]);
                zmax = Math.max(zmax, r);
                zRow.push(r);
                const mixed = g.mixedDl.includes(c);
                tRow.push(`${fmt(list[0].dl)}${mixed ? '+' : ''}`);
                hRow.push(`${g.name}<br>${c}: DL ${list.map(d => `${fmt(d.dl)} ×${d.count.toLocaleString()}`).join(', ')}`
                    + `${mixed ? '<br>several limits in this group' : ''}<br>×${+(10 ** r).toPrecision(2)} the lowest limit`);
            } else {
                zRow.push(null);
                tRow.push('');
                hRow.push(inSuite ? `${g.name}<br>${c}: analysed, nothing below detection` : `${g.name}<br>${c}: not analysed`);
            }
        });
        analysed.push(aRow); z.push(zRow); text.push(tRow); hover.push(hRow);
    });
    const ticks = [1, 2, 5, 10, 100, 1000, 10000].filter(t => Math.log10(t) <= zmax + 1e-9);
    const showText = cols.length <= 32 && groups.length <= 30;
    const data: Data[] = [
        {
            type: 'heatmap', x, y, z: analysed, text: hover as unknown as string[], hoverinfo: 'text',
            colorscale: [[0, NOT_SHOWN], [1, NOT_SHOWN]], showscale: false, xgap: 1, ygap: 1, hoverongaps: false,
        } as Data,
        {
            type: 'heatmap', x, y, z, zmin: 0, zmax, colorscale: DL_SCALE, xgap: 1, ygap: 1, hoverongaps: false,
            text: (showText ? text : undefined) as unknown as string[],
            texttemplate: showText ? '%{text}' : undefined,
            textfont: { size: 9 },
            customdata: hover as unknown as string[],
            hovertemplate: '%{customdata}<extra></extra>',
            colorbar: {
                title: { text: 'DL vs lowest', side: 'right' },
                tickvals: ticks.map(t => Math.log10(t)), ticktext: ticks.map(t => `×${t}`),
                thickness: 12, len: 0.8,
            },
        } as Data,
    ];
    const hidden = s.groups.length - groups.length;
    // A line between sample media (groups are listed medium by medium)
    const shapes: Partial<Layout>['shapes'] = [];
    for (let k = 1; k < groups.length; k++) {
        if (groups[k].stratum && groups[k].stratum !== groups[k - 1].stratum) {
            shapes.push({ type: 'line', xref: 'paper', x0: 0, x1: 1, yref: 'y', y0: k - 0.5, y1: k - 0.5, line: { color: '#57606a', width: 1.5 } });
        }
    }
    const layout: Partial<Layout> = {
        title: { text: `Detection limits by protocol group${hidden ? ` (largest ${groups.length} of ${s.groups.length})` : ''}` },
        // Readable cells: ~16 px per element, plus the group labels and colour bar
        width: Math.max(560, 330 + 16 * cols.length),
        height: Math.max(280, 150 + 24 * groups.length),
        margin: { l: 230, r: 80, t: 50, b: cols.length > 20 ? 110 : 80 },
        xaxis: { side: 'bottom', tickangle: cols.length > 20 ? -60 : 0, tickfont: { size: 10 }, automargin: true },
        yaxis: { autorange: 'reversed', tickfont: { size: 10 }, automargin: true },
        shapes,
        annotations: [{
            // Below the (rotated) element labels
            xref: 'paper', yref: 'paper', x: 0, y: 0, yanchor: 'top', yshift: cols.length > 20 ? -62 : -32, xanchor: 'left', showarrow: false,
            text: 'grey = analysed, nothing below detection · blank = not analysed · + = several limits',
            font: { size: 9 },
        }],
    };
    return { data, layout };
}

/** Samples per group and category of `by` (protocol labels and by-values per row). */
export function compositionCounts(protocol: ArrayLike<unknown>, by: ArrayLike<unknown> | null): Map<string, Map<string, number>> {
    const out = new Map<string, Map<string, number>>();
    for (let i = 0; i < protocol.length; i++) {
        const g = protocol[i] == null ? '' : String(protocol[i]);
        const c = by ? (by[i] == null || by[i] === '' ? '(blank)' : String(by[i])) : 'Samples';
        let m = out.get(g);
        if (!m) out.set(g, (m = new Map()));
        m.set(c, (m.get(c) ?? 0) + 1);
    }
    return out;
}

const QUAL = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac', '#2f4b7c', '#a05195'];

/** Horizontal stacked bars: samples per group, split by the categories of `byLabel` (top 12 + Other). */
export function protocolComposition(
    s: ProtocolSummary,
    counts: Map<string, Map<string, number>>,
    byLabel: string | null,
    opts: { maxGroups?: number; maxCategories?: number } = {},
): FigureSpec {
    const groups = shownGroups(s, opts.maxGroups ?? 25);
    const totals = new Map<string, number>();
    for (const g of groups) for (const [c, n] of counts.get(g.name) ?? []) totals.set(c, (totals.get(c) ?? 0) + n);
    const maxCat = opts.maxCategories ?? 12;
    const cats = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
    const top = cats.slice(0, maxCat);
    const other = cats.length > maxCat;
    const y = groups.map(groupLabel);
    const series = [...top, ...(other ? ['Other'] : [])];
    const data: Data[] = series.map((cat, k) => ({
        type: 'bar', orientation: 'h', name: cat, y,
        x: groups.map(g => {
            const m = counts.get(g.name);
            if (!m) return 0;
            if (cat !== 'Other') return m.get(cat) ?? 0;
            let n = 0;
            for (const [c, v] of m) if (!top.includes(c)) n += v;
            return n;
        }),
        marker: { color: cat === 'Other' ? '#c4c4c4' : QUAL[k % QUAL.length] },
        hovertemplate: `%{y}<br>${byLabel ? `${byLabel}: ` : ''}${cat}: %{x:,} samples<extra></extra>`,
    } as Data));
    const layout: Partial<Layout> = {
        title: { text: byLabel ? `What each group is made of: ${byLabel}` : 'Samples per protocol group' },
        barmode: 'stack',
        height: Math.max(260, 120 + 24 * groups.length),
        margin: { l: 230, r: 20, t: 50, b: 50 },
        xaxis: { title: { text: 'Samples' }, separatethousands: true },
        yaxis: { autorange: 'reversed', tickfont: { size: 10 }, automargin: true },
        showlegend: !!byLabel,
        legend: { orientation: 'v', x: 1.01, y: 1, font: { size: 10 } },
    };
    return { data, layout };
}

const pct = (n: number, d: number) => `${d ? Math.round((100 * n) / d) : 0} %`;

/** The method in words, for the report. */
export function protocolSummaryText(s: ProtocolSummary): string {
    const assigned = s.rowCount - s.empty;
    const big = [...s.groups].sort((a, b) => b.rows - a.rows).slice(0, 5);
    const bigRows = big.reduce((a, g) => a + g.rows, 0);
    const suites = new Set(s.groups.map(g => g.suite)).size;
    const mixed = s.groups.filter(g => g.mixedDl.length).length;
    const strata = [...new Set(s.groups.map(g => g.stratum).filter((x): x is string => !!x))];
    const parts = [
        `${s.rowCount.toLocaleString()} samples were split into ${s.groups.length} assay protocol groups (column ${s.column}), `
        + `so that samples analysed for other elements or with other detection limits are not mixed in probability plots, statistics or PCA.`,
        s.stratumColumn
            ? `The groups were made within each ${s.stratumColumn} value (${strata.length}: ${strata.join(', ')}), so no group mixes sample media; group names start with the medium.`
            : '',
        `Step 1, element suite: each sample is placed by the elements it has values for (${s.columns.length} assay columns). `
        + `Suites of fewer than ${s.minGroupSize !== null ? `${s.minGroupSize.toLocaleString()} samples` : `1 % of the ${s.stratumColumn ? "medium's " : ''}samples (at least 20)`} `
        + `join a suite sharing at least 80 % of their elements. This gives ${suites} suite${suites === 1 ? '' : 's'}.`,
        s.batchColumn
            ? `Step 2, detection limits: limits show only where a result is below detection. Within each suite, each ${s.batchColumn} value gets its usual limit per element; `
            + `values whose limits agree on at least 90 % of the elements both show well (5 or more results below detection) are kept together, the rest form their own groups.`
            : 'Step 2, detection limits: no lab method / batch column was used, so groups differ by element suite only; limits are reported per group.',
        s.halfDlColumns.length
            ? `Below-detection results stored as half the limit were recognised in ${s.halfDlColumns.length} column${s.halfDlColumns.length === 1 ? '' : 's'} and read as limits (clear-cut cases only).`
            : '',
        s.twinsLeftOut.length ? `${s.twinsLeftOut.join(', ')} repeat other columns in another unit and were left out, so each element counts once.` : '',
        `The five largest groups hold ${bigRows.toLocaleString()} samples (${pct(bigRows, assigned)} of those with assays): ${big.map(g => `${g.name} ${g.rows.toLocaleString()}`).join('; ')}.`,
        s.empty ? `${s.empty.toLocaleString()} samples have no assay values and are not in any group.` : '',
        mixed ? `${mixed} group${mixed === 1 ? '' : 's'} still hold more than one limit for an element (re-assays, or batches mixing methods); see the table.` : '',
    ];
    return parts.filter(Boolean).join('\n\n');
}

export interface TableSpec { columns: string[]; rows: string[][] }

/** One row per group (largest `max`, the rest pooled), with the limits that tell groups apart. */
export function protocolTable(s: ProtocolSummary, opts: { max?: number; dlColumns?: number } = {}): TableSpec {
    const dlCols = s.discriminating.slice(0, opts.dlColumns ?? 5);
    const groups = shownGroups(s, opts.max ?? 30);
    const columns = ['Group', 'Samples', 'Elements', ...dlCols.map(c => `${shortName(c)} DL`), s.batchColumn ?? 'Notes'];
    const rows = groups.map(g => [
        g.name,
        g.rows.toLocaleString(),
        String(g.elements.length),
        ...dlCols.map(c => {
            if (!g.elements.includes(c)) return '—';
            const d = g.dls[c]?.[0]?.dl;
            return d === undefined ? '?' : `${fmt(d)}${g.mixedDl.includes(c) ? '+' : ''}`;
        }),
        s.batchColumn
            ? `${g.batches.slice(0, 4).join(', ')}${g.batchCount > 4 ? ` +${g.batchCount - 4}` : ''}`
            : g.mixedDl.length ? `several limits: ${g.mixedDl.slice(0, 3).map(shortName).join(', ')}` : '',
    ]);
    const rest = s.groups.filter(g => !groups.includes(g));
    if (rest.length) {
        rows.push([`${rest.length} smaller groups`, rest.reduce((a, g) => a + g.rows, 0).toLocaleString(), '', ...dlCols.map(() => ''), '']);
    }
    return { columns, rows };
}
