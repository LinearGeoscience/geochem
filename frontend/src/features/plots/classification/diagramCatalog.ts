/**
 * Pure helpers behind the diagram gallery: catalogue entries, the category
 * tree and search.
 */
import type { Diagram } from '../../../types/diagram';
import type { DiagramResolution } from '../../../utils/classificationAxisResolver';
import { guessIonColumns, type PiperIon } from '../../../utils/calculations/waterChem';

export interface CatalogEntry {
    id: string;
    name: string;
    kind: Diagram['kind'];
    /** Folder path; custom diagrams live under "Custom". */
    category: string[];
    custom: boolean;
    diagram: Diagram;
    /** Lower-cased haystack: name, folders, references, axis names, variables. */
    haystack: string;
}

export interface CategoryNode {
    /** Folder path joined with " / " ('' for the root). */
    key: string;
    label: string;
    count: number;
    children: CategoryNode[];
}

export const CUSTOM_ROOT = 'Custom';

export function toCatalogEntry(d: Diagram, custom: boolean): CatalogEntry {
    const category = custom ? [CUSTOM_ROOT, ...d.category.filter(c => c && c !== CUSTOM_ROOT)] : d.category;
    const words = [
        d.name, ...category, ...d.references, ...d.comments,
        ...Object.values(d.axes).map(a => a?.name ?? ''),
        ...d.variables.map(v => v.element ?? v.columnName ?? ''),
    ];
    return { id: d.id, name: d.name, kind: d.kind, category, custom, diagram: d, haystack: words.join(' ').toLowerCase() };
}

export const categoryKey = (path: string[]) => path.join(' / ');

/** Folder tree with diagram counts (sub-folders sorted, Custom last). */
export function buildCategoryTree(entries: CatalogEntry[]): CategoryNode {
    const root: CategoryNode = { key: '', label: 'All diagrams', count: 0, children: [] };
    for (const e of entries) {
        root.count++;
        let node = root;
        for (let depth = 0; depth < e.category.length; depth++) {
            const key = categoryKey(e.category.slice(0, depth + 1));
            let child = node.children.find(c => c.key === key);
            if (!child) {
                child = { key, label: e.category[depth], count: 0, children: [] };
                node.children.push(child);
            }
            child.count++;
            node = child;
        }
    }
    const sort = (n: CategoryNode) => {
        n.children.sort((a, b) => (a.label === CUSTOM_ROOT ? 1 : b.label === CUSTOM_ROOT ? -1 : a.label.localeCompare(b.label)));
        n.children.forEach(sort);
    };
    sort(root);
    return root;
}

/**
 * Entries under folder `folderKey` ('' = all) matching every word of
 * `query`; name matches rank first.
 */
export function filterCatalog(entries: CatalogEntry[], folderKey: string, query: string): CatalogEntry[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const inFolder = (e: CatalogEntry) => {
        if (!folderKey) return true;
        const k = categoryKey(e.category);
        return k === folderKey || k.startsWith(folderKey + ' / ');
    };
    const hits = entries.filter(e => inFolder(e) && words.every(w => e.haystack.includes(w)));
    if (!words.length) return hits;
    const score = (e: CatalogEntry) => words.filter(w => e.name.toLowerCase().includes(w)).length;
    return hits.map((e, i) => ({ e, i, s: score(e) })).sort((p, q) => q.s - p.s || p.i - q.i).map(x => x.e);
}

/** Thumbnail URL for a built-in diagram (public/diagram-thumbs). */
export function thumbUrl(id: string): string {
    const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
    return `${base}diagram-thumbs/${id}.webp`;
}

/** How completely a diagram's inputs resolve against the loaded dataset. */
export type ResolutionStatus = 'full' | 'partial' | 'none';

export function resolutionStatus(r: DiagramResolution | null): ResolutionStatus {
    if (!r) return 'none';
    const axes = Object.values(r.axes);
    if (axes.length && axes.every(a => a.singleColumn || (a.isComputed && a.isFullyResolved))) return 'full';
    return r.matchedCount > 0 ? 'partial' : 'none';
}

/**
 * Numeric columns a diagram may use: columns marked excluded in Chemistry
 * (instrument artefacts, rejected elements) never count as available.
 */
export function plottableNumericNames(
    columns: { name: string; type: string }[],
    mappings: { originalName: string; isExcluded: boolean }[],
): string[] {
    const excluded = new Set(mappings.filter(m => m.isExcluded).map(m => m.originalName));
    return columns
        .filter(c => c?.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer') && !excluded.has(c.name))
        .map(c => c.name);
}

/** Ions a Piper diagram cannot do without (K and CO3 are optional). */
const PIPER_REQUIRED: PiperIon[] = ['Ca', 'Mg', 'Na', 'Cl', 'SO4', 'HCO3'];

/** How completely a built-in (native) diagram's inputs are found among the column names. */
export function builtinStatus(builtin: string | undefined, numericNames: string[]): ResolutionStatus | null {
    if (builtin !== 'piper') return null;
    const found = guessIonColumns(numericNames);
    const n = PIPER_REQUIRED.filter(ion => found[ion]).length;
    return n === PIPER_REQUIRED.length ? 'full' : n > 0 ? 'partial' : 'none';
}

/** Gallery filter: every diagram, only those fully plottable, or those with at least some inputs found. */
export type AvailabilityFilter = 'all' | 'full' | 'partial';

export function filterByAvailability(
    entries: CatalogEntry[],
    statusOf: (e: CatalogEntry) => ResolutionStatus,
    mode: AvailabilityFilter,
): CatalogEntry[] {
    if (mode === 'all') return entries;
    return entries.filter(e => {
        const st = statusOf(e);
        return st === 'full' || (mode === 'partial' && st === 'partial');
    });
}

/** True when some entry sits in folder `folderKey` ('' = the root, always true). */
export function folderHasEntries(entries: CatalogEntry[], folderKey: string): boolean {
    if (!folderKey) return true;
    return entries.some(e => {
        const k = categoryKey(e.category);
        return k === folderKey || k.startsWith(folderKey + ' / ');
    });
}
