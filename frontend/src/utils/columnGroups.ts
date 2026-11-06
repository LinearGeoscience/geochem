/**
 * Column grouping and search for pickers: Recent / Major oxides / Trace
 * elements / REE / Ratios / Coordinates / Transformed / Other, with unit and
 * role chips, matching on name, alias, element symbol or oxide formula
 * ("Cu" finds COPPER_PPM).
 */
import type { ColumnGeochemMapping } from '../types/associations';

export const COLUMN_GROUPS = [
    'Recent', 'Major oxides', 'Trace elements', 'REE', 'Ratios', 'Coordinates', 'Transformed', 'Identifiers', 'Other',
] as const;
export type ColumnGroup = typeof COLUMN_GROUPS[number];

export interface PickerColumn {
    name: string;
    type: string;
    role: string | null;
    alias: string | null;
    priority?: number;
    transformationType?: string | null;
}

export interface ColumnOption {
    name: string;
    label: string;
    group: ColumnGroup;
    /** Display unit ('%', 'ppm', 'ppb', …) or null. */
    unit: string | null;
    /** Spatial / interval / identifier role or null. */
    role: string | null;
    element: string | null;
    oxide: string | null;
    numeric: boolean;
}

export type ColumnFilter = 'numeric' | 'categorical' | 'all';

const COORD_ROLES = new Set(['East', 'North', 'Elevation', 'From', 'To', 'Depth', 'Easting', 'Northing', 'RL']);
const ID_ROLES = new Set(['ID', 'HoleID', 'SampleID']);
const NUMERIC_TYPES = new Set(['numeric', 'float', 'integer']);

export const isNumericType = (t: string) => NUMERIC_TYPES.has(t);

/** Full element names (first token of a column name) → symbol, for names the normaliser skips. */
const ELEMENT_NAMES: Record<string, string> = {
    silver: 'Ag', aluminium: 'Al', aluminum: 'Al', arsenic: 'As', gold: 'Au', barium: 'Ba', beryllium: 'Be', bismuth: 'Bi',
    calcium: 'Ca', cadmium: 'Cd', cerium: 'Ce', cobalt: 'Co', chromium: 'Cr', caesium: 'Cs', cesium: 'Cs', copper: 'Cu',
    iron: 'Fe', gallium: 'Ga', germanium: 'Ge', hafnium: 'Hf', mercury: 'Hg', indium: 'In', potassium: 'K', lanthanum: 'La',
    lithium: 'Li', magnesium: 'Mg', manganese: 'Mn', molybdenum: 'Mo', sodium: 'Na', niobium: 'Nb', nickel: 'Ni',
    phosphorus: 'P', lead: 'Pb', palladium: 'Pd', platinum: 'Pt', rubidium: 'Rb', rhenium: 'Re', sulphur: 'S', sulfur: 'S',
    antimony: 'Sb', scandium: 'Sc', selenium: 'Se', silicon: 'Si', tin: 'Sn', strontium: 'Sr', tantalum: 'Ta',
    tellurium: 'Te', thorium: 'Th', titanium: 'Ti', thallium: 'Tl', uranium: 'U', vanadium: 'V', tungsten: 'W',
    yttrium: 'Y', zinc: 'Zn', zirconium: 'Zr',
};
const REE_SYMBOLS = new Set(['La', 'Ce', 'Pr', 'Nd', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu', 'Y']);
const UNIT_WORDS: Record<string, string> = { ppm: 'ppm', ppb: 'ppb', pct: '%', percent: '%', wt: '%', gpt: 'g/t' };

/** Element and unit from a full-name column such as "COPPER_PPM". */
function fallbackElement(name: string): { element: string; unit: string | null } | null {
    const tokens = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const element = tokens.length ? ELEMENT_NAMES[tokens[0]] : undefined;
    if (!element) return null;
    const unitTok = tokens.slice(1).find(t => UNIT_WORDS[t]);
    return { element, unit: unitTok ? UNIT_WORDS[unitTok] : null };
}

const UNIT_LABEL: Record<string, string> = { pct: '%', percent: '%', wt: '%', ppm: 'ppm', ppb: 'ppb', ppt: 'ppt', 'g/t': 'g/t' };

function groupOf(c: PickerColumn, m: ColumnGeochemMapping | undefined, fallbackEl: string | null): ColumnGroup {
    if (c.role && COORD_ROLES.has(c.role)) return 'Coordinates';
    if (c.role && ID_ROLES.has(c.role)) return 'Identifiers';
    if (c.transformationType && c.transformationType !== 'raw') return 'Transformed';
    if (/[/]|ratio/i.test(c.name)) return 'Ratios';
    if (m && !m.isExcluded) {
        if (m.category === 'majorOxide') return 'Major oxides';
        if (m.category === 'ree') return 'REE';
        if (m.category === 'traceElement') return 'Trace elements';
    }
    if (fallbackEl) return REE_SYMBOLS.has(fallbackEl) ? 'REE' : 'Trace elements';
    return 'Other';
}

/**
 * Picker options in group order (Recent first), priority then name within a
 * group. `recent` lists column names most-recent first.
 */
export function buildColumnOptions(
    columns: PickerColumn[],
    mappings: ColumnGeochemMapping[],
    filter: ColumnFilter = 'numeric',
    recent: string[] = [],
): ColumnOption[] {
    const byName = new Map(mappings.map(m => [m.originalName, m]));
    const recentRank = new Map(recent.map((n, i) => [n, i]));
    const opts: (ColumnOption & { priority: number })[] = [];
    for (const c of columns) {
        if (!c?.name) continue;
        const numeric = isNumericType(c.type);
        if (filter === 'numeric' && !numeric) continue;
        if (filter === 'categorical' && numeric) continue;
        const m = byName.get(c.name);
        const mapped = m && !m.isExcluded && (m.userOverride ?? m.detectedElement) ? m : undefined;
        const fb = mapped ? null : fallbackElement(c.name);
        const unitRaw = mapped ? (mapped.userUnit ?? mapped.detectedUnit) : fb?.unit ?? null;
        opts.push({
            name: c.name,
            label: c.alias || c.name,
            group: recentRank.has(c.name) ? 'Recent' : groupOf(c, mapped, fb?.element ?? null),
            unit: unitRaw ? (UNIT_LABEL[unitRaw.toLowerCase()] ?? unitRaw) : null,
            role: c.role && (COORD_ROLES.has(c.role) || ID_ROLES.has(c.role)) ? c.role : null,
            element: mapped ? (mapped.userOverride ?? mapped.detectedElement) : fb?.element ?? null,
            oxide: m?.oxideFormula ?? null,
            numeric,
            priority: c.priority ?? 10,
        });
    }
    const gi = (g: ColumnGroup) => COLUMN_GROUPS.indexOf(g);
    opts.sort((a, b) => {
        if (a.group !== b.group) return gi(a.group) - gi(b.group);
        if (a.group === 'Recent') return recentRank.get(a.name)! - recentRank.get(b.name)!;
        return a.priority - b.priority || a.name.localeCompare(b.name, undefined, { numeric: true });
    });
    return opts.map(({ priority: _p, ...o }) => { void _p; return o; });
}

/**
 * Does `o` match the query? Every word must match the name or alias
 * (substring), or the element symbol / oxide formula exactly.
 */
export function matchesColumn(o: ColumnOption, query: string): boolean {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const hay = `${o.name} ${o.label}`.toLowerCase();
    const el = o.element?.toLowerCase(), ox = o.oxide?.toLowerCase();
    return words.every(w => hay.includes(w) || w === el || w === ox);
}

/** Options matching `query`; exact element/oxide hits first. */
export function filterColumnOptions(options: ColumnOption[], query: string): ColumnOption[] {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    const hits = options.filter(o => matchesColumn(o, q));
    const exact = (o: ColumnOption) => (o.element?.toLowerCase() === q || o.oxide?.toLowerCase() === q ? 0 : 1);
    return hits.map((o, i) => ({ o, i })).sort((a, b) => exact(a.o) - exact(b.o) || a.i - b.i).map(x => x.o);
}
