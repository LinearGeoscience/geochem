/**
 * Mineral and rock nodes ("Show mineral and rock nodes").
 *
 * Each node is turned into a synthetic sample row - oxide wt% (`SiO2_pct`,
 * total Fe as `Fe2O3_pct`) and element ppm (`Cu_ppm`) - and placed with the
 * same resolver/expression chain as the data, so a node lands where a sample
 * of that composition would on any diagram (molar ratios, ternaries, logs).
 *
 * Mineral compositions are computed from ideal formulas. Rock averages are
 * Le Maitre (1976) as tabulated by Cox, Bell & Pankhurst (1979). User nodes
 * (group medians, node CSV files) carry their values directly.
 */
import { ATOMIC_WEIGHTS, OXIDE_WEIGHTS } from './calculations/constants';
import { createGeochemMappings } from './calculations/elementNameNormalizer';
import { resolveDiagram, computeAxisValues } from './classificationAxisResolver';
import type { ClassificationDiagram } from '../types/classificationDiagram';
import type { ColumnGeochemMapping } from '../types/associations';
import { unitToPpmFactor } from './calculations/elementColumnResolver';
import { useUserNodeStore } from '../store/userNodeStore';

export type NodeKind = 'mineral' | 'rock' | 'user';

export interface NodeDef {
    id: string;
    name: string;
    /** Short label drawn on plots */
    label: string;
    kind: NodeKind;
    group: string;
    /** Ideal formula (minerals) */
    formula?: string;
    /** Oxide wt% (rocks; FeO and Fe2O3 combined as total Fe2O3) */
    oxides?: Record<string, number>;
    /** User nodes: the synthetic row itself (`<element>_ppm`, `<oxide>_pct`) */
    values?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Formula maths
// ---------------------------------------------------------------------------

/** Atoms per formula unit: handles nested brackets and decimal counts. */
export function parseChemicalFormula(formula: string): Record<string, number> {
    let pos = 0;
    const count = (): number => {
        const m = /^\d*\.?\d+/.exec(formula.slice(pos));
        if (!m) return 1;
        pos += m[0].length;
        return parseFloat(m[0]);
    };
    const group = (): Record<string, number> => {
        const out: Record<string, number> = {};
        const add = (el: string, n: number) => { out[el] = (out[el] ?? 0) + n; };
        while (pos < formula.length) {
            const ch = formula[pos];
            if (ch === '(' || ch === '[') {
                pos++;
                const inner = group();
                const n = count();
                for (const [el, k] of Object.entries(inner)) add(el, k * n);
            } else if (ch === ')' || ch === ']') {
                pos++;
                return out;
            } else {
                const m = /^[A-Z][a-z]?/.exec(formula.slice(pos));
                if (!m) throw new Error(`Bad formula "${formula}" at ${pos}`);
                if (!(m[0] in ATOMIC_WEIGHTS)) throw new Error(`Unknown element ${m[0]} in "${formula}"`);
                pos += m[0].length;
                add(m[0], count());
            }
        }
        return out;
    };
    return group();
}

/** Element wt% of an ideal formula. */
export function formulaElementPct(formula: string): Record<string, number> {
    const atoms = parseChemicalFormula(formula);
    const mass = Object.entries(atoms).reduce((s, [el, n]) => s + n * ATOMIC_WEIGHTS[el], 0);
    const out: Record<string, number> = {};
    for (const [el, n] of Object.entries(atoms)) out[el] = (100 * n * ATOMIC_WEIGHTS[el]) / mass;
    return out;
}

/** Element -> reporting oxide and cations per oxide formula (total Fe as Fe2O3) */
const OXIDE_OF: Record<string, [string, number]> = {
    Si: ['SiO2', 1], Ti: ['TiO2', 1], Al: ['Al2O3', 2], Fe: ['Fe2O3', 2], Mn: ['MnO', 1], Mg: ['MgO', 1],
    Ca: ['CaO', 1], Na: ['Na2O', 2], K: ['K2O', 2], P: ['P2O5', 2], Cr: ['Cr2O3', 2], Ba: ['BaO', 1],
};

const FEO_TO_FE2O3 = OXIDE_WEIGHTS.Fe2O3 / (2 * OXIDE_WEIGHTS.FeO);

/** Synthetic sample row of a node: `<oxide>_pct` and `<element>_ppm` columns. */
export function nodeRow(node: NodeDef): Record<string, number> {
    const row: Record<string, number> = {};
    if (node.values) return { ...node.values };
    if (node.formula) {
        for (const [el, pct] of Object.entries(formulaElementPct(node.formula))) {
            if (el === 'O' || el === 'H' || el === 'C') continue;
            row[`${el}_ppm`] = pct * 1e4;
            const ox = OXIDE_OF[el];
            if (ox) row[`${ox[0]}_pct`] = (pct * OXIDE_WEIGHTS[ox[0]]) / (ox[1] * ATOMIC_WEIGHTS[el]);
        }
    } else if (node.oxides) {
        const ox = { ...node.oxides };
        if (ox.FeO !== undefined) {
            ox.Fe2O3 = (ox.Fe2O3 ?? 0) + ox.FeO * FEO_TO_FE2O3;
            delete ox.FeO;
        }
        for (const [oxide, pct] of Object.entries(ox)) {
            row[`${oxide}_pct`] = pct;
            const el = Object.keys(OXIDE_OF).find(e => OXIDE_OF[e][0] === oxide);
            if (el) row[`${el}_ppm`] = (pct * OXIDE_OF[el][1] * ATOMIC_WEIGHTS[el] / OXIDE_WEIGHTS[oxide]) * 1e4;
        }
    }
    return row;
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

const m = (id: string, name: string, label: string, group: string, formula: string): NodeDef => ({ id, name, label, kind: 'mineral', group, formula });
const r = (id: string, name: string, oxides: Record<string, number>): NodeDef => ({ id, name, label: name, kind: 'rock', group: 'Average igneous rocks', oxides });

export const NODE_LIBRARY: NodeDef[] = [
    m('py', 'Pyrite', 'Py', 'Sulphides', 'FeS2'),
    m('cpy', 'Chalcopyrite', 'Cpy', 'Sulphides', 'CuFeS2'),
    m('bn', 'Bornite', 'Bn', 'Sulphides', 'Cu5FeS4'),
    m('cc', 'Chalcocite', 'Cc', 'Sulphides', 'Cu2S'),
    m('cv', 'Covellite', 'Cv', 'Sulphides', 'CuS'),
    m('po', 'Pyrrhotite', 'Po', 'Sulphides', 'Fe7S8'),
    m('sp', 'Sphalerite', 'Sp', 'Sulphides', 'ZnS'),
    m('gn', 'Galena', 'Gn', 'Sulphides', 'PbS'),
    m('apy', 'Arsenopyrite', 'Apy', 'Sulphides', 'FeAsS'),
    m('mo', 'Molybdenite', 'Mo', 'Sulphides', 'MoS2'),
    m('stb', 'Stibnite', 'Stb', 'Sulphides', 'Sb2S3'),
    m('ab', 'Albite', 'Ab', 'Feldspars', 'NaAlSi3O8'),
    m('kf', 'K-feldspar', 'KF', 'Feldspars', 'KAlSi3O8'),
    m('an', 'Anorthite', 'An', 'Feldspars', 'CaAl2Si2O8'),
    m('mu', 'Muscovite (sericite)', 'Mu', 'Micas & clays', 'KAl3Si3O10(OH)2'),
    m('pg', 'Paragonite', 'Pg', 'Micas & clays', 'NaAl3Si3O10(OH)2'),
    m('bt', 'Biotite', 'Bt', 'Micas & clays', 'K(Mg1.5Fe1.5)AlSi3O10(OH)2'),
    m('chl', 'Chlorite (clinochlore)', 'Chl', 'Micas & clays', 'Mg5Al2Si3O10(OH)8'),
    m('kln', 'Kaolinite', 'Kln', 'Micas & clays', 'Al2Si2O5(OH)4'),
    m('ill', 'Illite', 'Ill', 'Micas & clays', 'K0.65Al2(Al0.65Si3.35)O10(OH)2'),
    m('dck', 'Dickite', 'Dck', 'Micas & clays', 'Al2Si2O5(OH)4'),
    m('prl', 'Pyrophyllite', 'Prl', 'Micas & clays', 'Al2Si4O10(OH)2'),
    m('mnt', 'Montmorillonite', 'Mnt', 'Micas & clays', 'Na0.33(Al1.67Mg0.33)Si4O10(OH)2'),
    m('fchl', 'Fe-chlorite (chamosite)', 'FeChl', 'Micas & clays', 'Fe5Al2Si3O10(OH)8'),
    m('alu', 'K-alunite', 'Alu', 'Sulphates', 'KAl3(SO4)2(OH)6'),
    m('nalu', 'Na-alunite (natroalunite)', 'NaAlu', 'Sulphates', 'NaAl3(SO4)2(OH)6'),
    m('anh', 'Anhydrite', 'Anh', 'Sulphates', 'CaSO4'),
    m('gyp', 'Gypsum', 'Gyp', 'Sulphates', 'CaSO4(H2O)2'),
    m('ep', 'Epidote', 'Ep', 'Other silicates', 'Ca2Al2FeSi3O12(OH)'),
    m('hbl', 'Hornblende (magnesio-)', 'Hbl', 'Other silicates', 'Ca2(Mg4Al)(Si7Al)O22(OH)2'),
    m('act', 'Actinolite', 'Act', 'Other silicates', 'Ca2(Mg3.5Fe1.5)Si8O22(OH)2'),
    m('qz', 'Quartz', 'Qz', 'Other silicates', 'SiO2'),
    m('cal', 'Calcite', 'Cal', 'Carbonates', 'CaCO3'),
    m('dol', 'Dolomite', 'Dol', 'Carbonates', 'CaMg(CO3)2'),
    m('ank', 'Ankerite', 'Ank', 'Carbonates', 'Ca(Fe0.5Mg0.5)(CO3)2'),
    m('sid', 'Siderite', 'Sid', 'Carbonates', 'FeCO3'),
    m('mt', 'Magnetite', 'Mt', 'Oxides', 'Fe3O4'),
    m('hm', 'Hematite', 'Hm', 'Oxides', 'Fe2O3'),
    m('ilm', 'Ilmenite', 'Ilm', 'Oxides', 'FeTiO3'),
    m('ap', 'Apatite', 'Ap', 'Oxides', 'Ca5(PO4)3F'),
    // Le Maitre (1976) averages, in Cox et al. (1979)
    r('granite', 'Granite', { SiO2: 71.30, TiO2: 0.31, Al2O3: 14.32, Fe2O3: 1.21, FeO: 1.64, MnO: 0.05, MgO: 0.71, CaO: 1.84, Na2O: 3.68, K2O: 4.07, P2O5: 0.12 }),
    r('granodiorite', 'Granodiorite', { SiO2: 66.09, TiO2: 0.54, Al2O3: 15.73, Fe2O3: 1.38, FeO: 2.73, MnO: 0.08, MgO: 1.74, CaO: 3.83, Na2O: 3.75, K2O: 2.73, P2O5: 0.18 }),
    r('diorite', 'Diorite', { SiO2: 57.48, TiO2: 0.95, Al2O3: 16.67, Fe2O3: 2.50, FeO: 4.92, MnO: 0.12, MgO: 3.71, CaO: 6.58, Na2O: 3.54, K2O: 1.76, P2O5: 0.29 }),
    r('gabbro', 'Gabbro', { SiO2: 50.14, TiO2: 1.12, Al2O3: 15.48, Fe2O3: 3.01, FeO: 7.62, MnO: 0.12, MgO: 7.59, CaO: 9.58, Na2O: 2.39, K2O: 0.93, P2O5: 0.24 }),
    r('rhyolite', 'Rhyolite', { SiO2: 72.82, TiO2: 0.28, Al2O3: 13.27, Fe2O3: 1.48, FeO: 1.11, MnO: 0.06, MgO: 0.39, CaO: 1.14, Na2O: 3.55, K2O: 4.30, P2O5: 0.07 }),
    r('dacite', 'Dacite', { SiO2: 65.01, TiO2: 0.58, Al2O3: 15.91, Fe2O3: 2.43, FeO: 2.30, MnO: 0.09, MgO: 1.78, CaO: 4.32, Na2O: 3.79, K2O: 2.17, P2O5: 0.15 }),
    r('andesite', 'Andesite', { SiO2: 57.94, TiO2: 0.87, Al2O3: 17.02, Fe2O3: 3.27, FeO: 4.04, MnO: 0.14, MgO: 3.33, CaO: 6.79, Na2O: 3.48, K2O: 1.62, P2O5: 0.21 }),
    r('basalt', 'Basalt', { SiO2: 49.20, TiO2: 1.84, Al2O3: 15.74, Fe2O3: 3.79, FeO: 7.13, MnO: 0.20, MgO: 6.73, CaO: 9.47, Na2O: 2.91, K2O: 1.10, P2O5: 0.35 }),
];

export const NODE_SOURCES = {
    mineral: 'Ideal end-member formulas (total Fe as Fe2O3)',
    rock: 'Le Maitre (1976) average compositions, as tabulated in Cox, Bell & Pankhurst (1979)',
    user: 'Your nodes: colour-group medians and imported node files',
};

const BY_ID = new Map(NODE_LIBRARY.map(n => [n.id, n]));
export const nodesById = (ids: string[]) => {
    const user = useUserNodeStore.getState().nodes;
    return ids.map(id => BY_ID.get(id) ?? user.find(n => n.id === id)).filter((n): n is NodeDef => !!n);
};

// ---------------------------------------------------------------------------
// User nodes
// ---------------------------------------------------------------------------

/**
 * A node row from values in data columns: element columns -> `<el>_ppm`,
 * oxide columns -> `<oxide>_pct`, converted from each column's unit.
 * Columns that are not an element or oxide (or of unknown unit) are left out.
 */
export function nodeValuesFromColumns(values: Record<string, number>, mappings: ColumnGeochemMapping[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [col, v] of Object.entries(values)) {
        if (!Number.isFinite(v)) continue;
        const mp = mappings.find(x => x.originalName === col);
        if (!mp || mp.isExcluded) continue;
        const toPpm = unitToPpmFactor(mp.userUnit || mp.detectedUnit) ?? (mp.isOxide ? 1e4 : 1);
        if (mp.isOxide && mp.oxideFormula) out[`${mp.oxideFormula}_pct`] = (v * toPpm) / 1e4;
        else {
            const el = mp.userOverride || mp.detectedElement;
            if (el) out[`${el}_ppm`] = v * toPpm;
        }
    }
    return out;
}

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');

/** User node from a name and data-column values (e.g. a colour group's medians) */
export function makeUserNode(name: string, group: string, values: Record<string, number>, mappings: ColumnGeochemMapping[]): NodeDef {
    return {
        id: `user:${slug(group)}:${slug(name)}`, name, label: name, kind: 'user', group,
        values: nodeValuesFromColumns(values, mappings),
    };
}

/**
 * Node CSV: a header row with Name (or the first column as names) and
 * element / oxide columns with units (SiO2_pct, Cu_ppm, Au_ppb), one node
 * per row.
 */
export function parseNodeCsv(text: string, group: string): NodeDef[] {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) throw new Error('A node CSV needs a header row and at least one node');
    const split = (l: string) => l.split(/[,\t;]/).map(c => c.trim().replace(/^"|"$/g, ''));
    const header = split(lines[0]);
    const nameIdx = Math.max(0, header.findIndex(h => /^(name|node|sample|rock|mineral)$/i.test(h)));
    const cols = header.filter((_, i) => i !== nameIdx);
    const mappings = createGeochemMappings(cols);
    const nodes = lines.slice(1).map(l => {
        const cells = split(l);
        const vals: Record<string, number> = {};
        header.forEach((h, i) => { if (i !== nameIdx && cells[i] !== '' && cells[i] != null) vals[h] = Number(cells[i]); });
        return makeUserNode(cells[nameIdx] || 'Node', group, vals, mappings);
    }).filter(n => Object.keys(n.values ?? {}).length);
    if (!nodes.length) throw new Error('No element or oxide columns recognised in the node CSV');
    return nodes;
}

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

function nodeTable(nodes: NodeDef[]) {
    const sparse = nodes.map(nodeRow);
    const names = [...new Set(sparse.flatMap(r => Object.keys(r)))];
    // A node without a component has none of it (albite: K = 0)
    const rows = sparse.map(r => Object.fromEntries(names.map(n => [n, r[n] ?? 0])));
    return { rows, names, mappings: createGeochemMappings(names) };
}

/**
 * Node values on each axis of a classification diagram (null when the node
 * lacks an input, e.g. Na on a pyrite node).
 */
export function nodeAxisValues(diagram: ClassificationDiagram, nodes: NodeDef[]): Record<string, (number | null)[]> {
    if (!nodes.length) return {};
    const { rows, names, mappings } = nodeTable(nodes);
    const res = resolveDiagram(diagram, mappings, names);
    const out: Record<string, (number | null)[]> = {};
    for (const [key, axis] of Object.entries(res.axes)) {
        if (axis.isComputed && axis.isFullyResolved) out[key] = computeAxisValues(axis, rows);
        else if (axis.singleColumn) out[key] = rows.map(r => r[axis.singleColumn!] ?? null);
        else out[key] = rows.map(() => null);
    }
    return out;
}

/**
 * Node values for plain data columns (scatter / ternary axes), in each
 * column's own element/oxide and unit (from its geochem mapping); null for
 * columns that are not an element or oxide.
 */
export function nodeColumnValues(columns: string[], mappings: ColumnGeochemMapping[], nodes: NodeDef[]): Record<string, (number | null)[]> {
    const out: Record<string, (number | null)[]> = {};
    if (!nodes.length) return out;
    for (const col of columns) {
        const mp = mappings.find(m => m.originalName === col);
        const element = mp ? (mp.isOxide ? mp.oxideFormula : (mp.userOverride || mp.detectedElement)) : null;
        if (!element) { out[col] = nodes.map(() => null); continue; }
        // One-variable diagram; 'A*1' keeps it computed so unit conversion applies
        const pseudo = {
            id: 'nodes', name: 'nodes', type: 'xy', category: '', polygons: [],
            axes: { x: { name: col, formula: 'A*1' } },
            variables: [{ letter: 'A', element, unit: mp?.userUnit || mp?.detectedUnit || 'ppm' }],
        } as unknown as ClassificationDiagram;
        out[col] = nodeAxisValues(pseudo, nodes).x ?? nodes.map(() => null);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Plotly traces
// ---------------------------------------------------------------------------

const NODE_MARKER = { size: 15, symbol: 'circle', color: 'rgba(150,150,150,0.55)', line: { color: 'rgba(110,110,110,0.8)', width: 1 } };

/** Plot option kept in the node list: draw the node markers without names */
export const NODE_NO_LABELS = 'opt:nolabels';
export const nodeLabelsOn = (ids: string[]) => !ids.includes(NODE_NO_LABELS);

const LABEL_SPOTS: [string, number, number][] = [
    ['top right', 1, 1], ['bottom right', 1, -1], ['top left', -1, 1], ['bottom left', -1, -1],
    ['middle right', 1.4, 0], ['middle left', -1.4, 0], ['top center', 0, 1.3], ['bottom center', 0, -1.3],
];

/**
 * Label side per node so the names of nearby nodes are not drawn on top of
 * each other: greedy, in node-extent units; each label takes the first side
 * whose spot is clear of the labels and markers already placed.
 */
export function nodeLabelPositions(px: number[], py: number[], sep = 0.06): string[] {
    const ok = (v: number) => Number.isFinite(v);
    const xs = px.filter(ok), ys = py.filter(ok);
    if (!xs.length || !ys.length) return px.map(() => 'top right');
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    const sx = Math.max(...xs) - x0 || 1, sy = Math.max(...ys) - y0 || 1;
    const u = px.map(v => (v - x0) / sx), w = py.map(v => (v - y0) / sy);
    const taken: [number, number][] = [];
    return u.map((ux, k) => {
        const clear = (ax: number, ay: number) =>
            taken.every(([tx, ty]) => Math.hypot(tx - ax, ty - ay) > sep * 1.6)
            && u.every((vx, j) => j === k || Math.hypot(vx - ax, w[j] - ay) > sep * 0.8);
        const spot = LABEL_SPOTS.find(([, dx, dy]) => clear(ux + dx * sep, w[k] + dy * sep)) ?? LABEL_SPOTS[0];
        taken.push([ux + spot[1] * sep, w[k] + spot[2] * sep]);
        return spot[0];
    });
}

/** Labelled node trace for x/y coordinates (null or non-finite points skipped). */
export function nodeXYTrace(nodes: NodeDef[], x: (number | null)[], y: (number | null)[], opts: { logX?: boolean; logY?: boolean; labels?: boolean } = {}): any | null {
    const keep = nodes.map((_, k) => k).filter(k => {
        const u = x[k], v = y[k];
        return u != null && v != null && Number.isFinite(u) && Number.isFinite(v) && (!opts.logX || u > 0) && (!opts.logY || v > 0);
    });
    if (!keep.length) return null;
    const tx = (v: number, log?: boolean) => (log ? Math.log10(v) : v);
    return {
        type: 'scatter', mode: opts.labels === false ? 'markers' : 'markers+text', name: 'Nodes', showlegend: false, cliponaxis: false,
        x: keep.map(k => x[k]), y: keep.map(k => y[k]),
        text: keep.map(k => nodes[k].label),
        textposition: nodeLabelPositions(keep.map(k => tx(x[k]!, opts.logX)), keep.map(k => tx(y[k]!, opts.logY))),
        textfont: { size: 11, color: '#111111' },
        marker: NODE_MARKER,
        hovertext: keep.map(k => nodes[k].name), hovertemplate: '%{hovertext}<br>%{x:.3g}, %{y:.3g}<extra>node</extra>',
    };
}

// ---------------------------------------------------------------------------
// Tie-lines (the reference software: lines between two nodes, e.g. muscovite - albite)
// ---------------------------------------------------------------------------

/** Tie-lines live in the plot's node list as "tie:<idA>|<idB>" */
export const tieId = (a: string, b: string) => `tie:${a}|${b}`;
export function tiePairs(ids: string[]): [string, string][] {
    return ids.filter(i => i.startsWith('tie:')).map(i => i.slice(4).split('|') as [string, string]).filter(p => p.length === 2);
}

const TIE_LINE = { color: '#111111', width: 1.2, dash: 'dash' };

/** Dashed lines between node pairs (positions as for nodeXYTrace) */
export function nodeXYTieTrace(nodes: NodeDef[], x: (number | null)[], y: (number | null)[], ties: [string, string][]): any | null {
    const xs: (number | null)[] = [], ys: (number | null)[] = [];
    for (const [a, b] of ties) {
        const i = nodes.findIndex(n => n.id === a), j = nodes.findIndex(n => n.id === b);
        if (i < 0 || j < 0 || x[i] == null || y[i] == null || x[j] == null || y[j] == null) continue;
        xs.push(x[i], x[j], null);
        ys.push(y[i], y[j], null);
    }
    if (!xs.length) return null;
    return { type: 'scatter', mode: 'lines', x: xs, y: ys, line: TIE_LINE, hoverinfo: 'skip', showlegend: false, name: 'Tie-lines' };
}

/** Labelled node trace on a Plotly ternary (a/b/c closed to 100). */
export function nodeTernaryTrace(nodes: NodeDef[], a: (number | null)[], b: (number | null)[], c: (number | null)[], opts: { labels?: boolean } = {}): any | null {
    const pts: { k: number; a: number; b: number; c: number }[] = [];
    nodes.forEach((_, k) => {
        const va = a[k], vb = b[k], vc = c[k];
        if (va == null || vb == null || vc == null) return;
        const s = va + vb + vc;
        if (!(s > 0) || va < 0 || vb < 0 || vc < 0) return;
        pts.push({ k, a: (100 * va) / s, b: (100 * vb) / s, c: (100 * vc) / s });
    });
    if (!pts.length) return null;
    return {
        type: 'scatterternary', mode: opts.labels === false ? 'markers' : 'markers+text', name: 'Nodes', showlegend: false, cliponaxis: false,
        a: pts.map(p => p.a), b: pts.map(p => p.b), c: pts.map(p => p.c),
        text: pts.map(p => nodes[p.k].label),
        // A at the top, B bottom left, C bottom right: place labels in screen space
        textposition: nodeLabelPositions(pts.map(p => p.c + p.a / 2), pts.map(p => p.a * 0.866)),
        textfont: { size: 11, color: '#111111' },
        marker: NODE_MARKER,
        hovertext: pts.map(p => nodes[p.k].name), hovertemplate: '%{hovertext}<extra>node</extra>',
    };
}

/** Dashed lines between node pairs on a ternary */
export function nodeTernaryTieTrace(nodes: NodeDef[], a: (number | null)[], b: (number | null)[], c: (number | null)[], ties: [string, string][]): any | null {
    const A: (number | null)[] = [], B: (number | null)[] = [], C: (number | null)[] = [];
    const pos = (k: number) => {
        const va = a[k], vb = b[k], vc = c[k];
        if (va == null || vb == null || vc == null) return null;
        const s = va + vb + vc;
        return s > 0 ? [(100 * va) / s, (100 * vb) / s, (100 * vc) / s] : null;
    };
    for (const [p, q] of ties) {
        const i = nodes.findIndex(n => n.id === p), j = nodes.findIndex(n => n.id === q);
        const u = i >= 0 ? pos(i) : null, v = j >= 0 ? pos(j) : null;
        if (!u || !v) continue;
        A.push(u[0], v[0], null); B.push(u[1], v[1], null); C.push(u[2], v[2], null);
    }
    if (!A.length) return null;
    return { type: 'scatterternary', mode: 'lines', a: A, b: B, c: C, line: TIE_LINE, hoverinfo: 'skip', showlegend: false, name: 'Tie-lines' };
}
