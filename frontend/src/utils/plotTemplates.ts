/**
 * Plot and layout templates (Phase 22).
 *
 * A template stores a plot's type and settings with every column reference
 * replaced by what the column MEANS — element/oxide + unit from the geochem
 * mappings, or its role (East, North, HoleID...) — as well as its name. When
 * applied to another dataset each reference resolves to that dataset's
 * matching column, so "Cu vs Zn, log axes, coloured by lithology" carries
 * across projects whose columns are named differently (Cu_ppm vs cu_ppm_d).
 */
import { ColumnGeochemMapping } from '../types/associations';
import { findColumnForElement, findColumnForOxide } from './calculations/elementNameNormalizer';
import { reconcileLayout, remapLayoutIds, FIXED_PANEL_IDS, SerializedLayout } from './workspaceLayout';

export interface ColumnRef {
    name: string;
    element?: string;
    oxide?: string;
    unit?: string | null;
    role?: string | null;
}

/** A settings value that referred to a column. */
interface ColRefValue { $col: ColumnRef }

export interface PlotTemplate {
    kind: 'plot';
    version: 1;
    name: string;
    plotType: string;
    title: string;
    settings: Record<string, unknown>;
    created: string;
    /** Layout templates (v2): the plot's id in `layout`. */
    id?: string;
}

/**
 * v1: plots only (opened as tabs). v2 adds the dock arrangement, whose
 * panel ids are the plots' `id`s and are remapped to the new plots on apply.
 */
export interface LayoutTemplate {
    kind: 'layout';
    version: 1 | 2;
    name: string;
    plots: PlotTemplate[];
    created: string;
    layout?: SerializedLayout | null;
}

export type Template = PlotTemplate | LayoutTemplate;

interface ColumnLike { name: string; role: string | null }

function isColRef(v: unknown): v is ColRefValue {
    return !!v && typeof v === 'object' && '$col' in (v as object);
}

/** Describe a column by meaning (element / oxide / role) and name. */
export function columnRef(name: string, columns: ColumnLike[], mappings: ColumnGeochemMapping[]): ColumnRef {
    const m = mappings.find(x => x.originalName === name);
    const ref: ColumnRef = { name };
    if (m && !m.isExcluded) {
        const element = m.userOverride ?? m.detectedElement;
        if (m.isOxide && m.oxideFormula) ref.oxide = m.oxideFormula;
        else if (element) ref.element = element;
        ref.unit = m.userUnit ?? m.detectedUnit;
    }
    const role = columns.find(c => c.name === name)?.role;
    if (role) ref.role = role;
    return ref;
}

/** Replace column names in a settings object with ColumnRefs (recursively). */
export function abstractSettings(
    value: unknown,
    columns: ColumnLike[],
    mappings: ColumnGeochemMapping[],
): unknown {
    const names = new Set(columns.map(c => c.name));
    const walk = (v: unknown): unknown => {
        if (typeof v === 'string') return names.has(v) ? { $col: columnRef(v, columns, mappings) } : v;
        if (Array.isArray(v)) return v.map(walk);
        if (v && typeof v === 'object') {
            const out: Record<string, unknown> = {};
            for (const [k, val] of Object.entries(v)) out[k] = walk(val);
            return out;
        }
        return v;
    };
    return walk(value);
}

/** Resolve a reference against a dataset; null when nothing matches. */
export function resolveColumnRef(ref: ColumnRef, columns: ColumnLike[], mappings: ColumnGeochemMapping[]): string | null {
    const names = new Set(columns.map(c => c.name));
    if (ref.oxide) {
        const col = findColumnForOxide(mappings, ref.oxide);
        if (col && names.has(col)) return col;
    }
    if (ref.element) {
        // Same unit if available, else the best (ppm-preferred) column for the element
        const sameUnit = ref.unit ? findColumnForElement(mappings, ref.element, ref.unit) : null;
        const col = sameUnit ?? findColumnForElement(mappings, ref.element);
        if (col && names.has(col)) return col;
    }
    if (names.has(ref.name)) return ref.name;
    if (ref.role) {
        const byRole = columns.find(c => c.role === ref.role);
        if (byRole) return byRole.name;
    }
    const ci = columns.find(c => c.name.toLowerCase() === ref.name.toLowerCase());
    return ci?.name ?? null;
}

/**
 * Resolve a template's settings for the current dataset. Unresolvable column
 * references are dropped (the plot falls back to its defaults for them) and
 * listed in `unresolved`.
 */
export function resolveSettings(
    settings: unknown,
    columns: ColumnLike[],
    mappings: ColumnGeochemMapping[],
): { settings: Record<string, unknown>; unresolved: string[] } {
    const unresolved: string[] = [];
    const DROP = Symbol('drop');
    const walk = (v: unknown): unknown => {
        if (isColRef(v)) {
            const col = resolveColumnRef(v.$col, columns, mappings);
            if (col === null) { unresolved.push(v.$col.name); return DROP; }
            return col;
        }
        if (Array.isArray(v)) return v.map(walk).filter(x => x !== DROP);
        if (v && typeof v === 'object') {
            const out: Record<string, unknown> = {};
            for (const [k, val] of Object.entries(v)) {
                const r = walk(val);
                if (r !== DROP) out[k] = r;
            }
            return out;
        }
        return v;
    };
    const out = walk(settings);
    return { settings: (out && typeof out === 'object' ? out : {}) as Record<string, unknown>, unresolved };
}

// Saved camera / clip state is tied to the original data's coordinates
const DATASET_SPECIFIC_KEYS = new Set(['camera3d', 'axisRanges', 'clip3d', 'sliceWidths']);

export function makePlotTemplate(
    plot: { type: string; title: string; settings: Record<string, unknown> },
    name: string,
    columns: ColumnLike[],
    mappings: ColumnGeochemMapping[],
): PlotTemplate {
    const settings: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(plot.settings ?? {})) {
        if (!DATASET_SPECIFIC_KEYS.has(k)) settings[k] = v;
    }
    return {
        kind: 'plot', version: 1, name, plotType: plot.type, title: plot.title,
        settings: abstractSettings(settings, columns, mappings) as Record<string, unknown>,
        created: new Date().toISOString(),
    };
}

export function makeLayoutTemplate(
    plots: { id?: string; type: string; title: string; settings: Record<string, unknown> }[],
    name: string,
    columns: ColumnLike[],
    mappings: ColumnGeochemMapping[],
    layout: SerializedLayout | null = null,
): LayoutTemplate {
    const ids = plots.map(p => p.id).filter((id): id is string => !!id);
    // Keep only this template's plots (and fixed panes) in the arrangement
    const arranged = layout ? reconcileLayout(layout, [...ids, ...FIXED_PANEL_IDS]) : null;
    return {
        kind: 'layout', version: arranged ? 2 : 1, name,
        plots: plots.map(p => ({ ...makePlotTemplate(p, p.title, columns, mappings), ...(p.id ? { id: p.id } : {}) })),
        created: new Date().toISOString(),
        ...(arranged ? { layout: arranged } : {}),
    };
}

/**
 * The arrangement of an applied layout template: its panel ids remapped to
 * the newly created plots (`created[i]` is the id made from `t.plots[i]`).
 * Null for v1 templates (the plots simply open as tabs).
 */
export function instantiateTemplateLayout(t: LayoutTemplate, created: string[]): SerializedLayout | null {
    if (!t.layout) return null;
    const idMap: Record<string, string> = {};
    t.plots.forEach((p, i) => { if (p.id && created[i]) idMap[p.id] = created[i]; });
    return reconcileLayout(remapLayoutIds(t.layout, idMap), [...created, ...FIXED_PANEL_IDS]);
}

// ---------------------------------------------------------------------------
// Local template library (localStorage) + file import/export
// ---------------------------------------------------------------------------

const LIBRARY_KEY = 'geochem-templates';

export function listTemplates(): Template[] {
    try {
        const raw = localStorage.getItem(LIBRARY_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter(isTemplate) : [];
    } catch {
        return [];
    }
}

export function saveTemplate(t: Template): void {
    const all = listTemplates().filter(x => x.name !== t.name || x.kind !== t.kind);
    all.push(t);
    try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(all)); } catch { /* storage full/blocked */ }
}

export function deleteTemplate(kind: Template['kind'], name: string): void {
    const all = listTemplates().filter(x => !(x.name === name && x.kind === kind));
    try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(all)); } catch { /* ignore */ }
}

export function isTemplate(v: unknown): v is Template {
    if (!v || typeof v !== 'object') return false;
    const t = v as Template;
    return (t.kind === 'plot' && typeof t.plotType === 'string') || (t.kind === 'layout' && Array.isArray(t.plots));
}

export const TEMPLATE_FILE_EXTENSION = '.chemtpl';

export function templateToFileBlob(t: Template): Blob {
    return new Blob([JSON.stringify(t, null, 2)], { type: 'application/json' });
}

export async function readTemplateFile(file: Blob): Promise<Template> {
    const parsed = JSON.parse(await file.text());
    if (!isTemplate(parsed)) throw new Error('Not a GeoChem template file');
    return parsed;
}
