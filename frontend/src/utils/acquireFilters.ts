/**
 * Data Import > Acquire (SQL): pure filter logic (no React, no requests).
 *
 * - parseHoleList: a pasted hole list (any mix of new lines, commas, semicolons,
 *   tabs or spaces; quotes stripped; duplicates dropped, order kept)
 * - optionLists: the filter lists from /api/acquire/options, each narrowed by the
 *   other filters already chosen, with hole counts
 * - buildPreviewRequest: the filters as the /api/acquire/preview body
 * - pullRecordAudit: the processing-log entry for an import
 */

export interface AcquireFilterState {
    projects: string[];
    prospects: string[];
    holeTypes: string[];
    programs: string[];
    drilledFrom: string; // '' or YYYY-MM-DD
    drilledTo: string;
    modifiedFrom: string;
    modifiedTo: string;
    holeListText: string;
}

export const EMPTY_FILTERS: AcquireFilterState = {
    projects: [], prospects: [], holeTypes: [], programs: [], drilledFrom: '', drilledTo: '',
    modifiedFrom: '', modifiedTo: '', holeListText: '',
};

/** One project / prospect / hole type / program combination (GET /api/acquire/options). */
export interface AcquireCombo {
    project: string | null;
    prospect: string | null;
    hole_type: string | null;
    program: string | null;
    holes: number;
    first_drilled: string | null;
    last_drilled: string | null;
    first_modified?: string | null;
    last_modified?: string | null;
}

export interface AcquirePreviewRequest {
    /** The connection profile (laptops; the server uses its admin profile) */
    profile?: string;
    projects: string[];
    prospects: string[];
    hole_types: string[];
    programs: string[];
    drilled_from: string | null;
    drilled_to: string | null;
    modified_from: string | null;
    modified_to: string | null;
    hole_ids: string[];
}

export interface AcquirePullRecord {
    source: string;
    pulled_at: string;
    user: string;
    profile?: string;
    server: string;
    database: string;
    filters: Record<string, unknown>;
    query_version: string;
    mapping_version: number | null;
    holes: number;
    rows: { collar: number; survey: number; assay: number };
    sha256: string;
    sha256_per_table?: Record<string, string>;
}

export type FilterKey = 'project' | 'prospect' | 'hole_type' | 'program';
export const FILTER_KEYS: FilterKey[] = ['project', 'prospect', 'hole_type', 'program'];

const STATE_KEY: Record<FilterKey, keyof AcquireFilterState> = {
    project: 'projects', prospect: 'prospects', hole_type: 'holeTypes', program: 'programs',
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Hole IDs from pasted text: split on new lines, commas, semicolons, tabs or spaces. */
export function parseHoleList(text: string): { ids: string[]; duplicates: number } {
    const ids: string[] = [];
    const seen = new Set<string>();
    let duplicates = 0;
    for (const raw of text.split(/[\s,;]+/)) {
        const id = raw.replace(/^["']+|["']+$/g, '').trim();
        if (!id) continue;
        if (seen.has(id)) { duplicates++; continue; }
        seen.add(id);
        ids.push(id);
    }
    return { ids, duplicates };
}

export function selected(state: AcquireFilterState, key: FilterKey): string[] {
    return state[STATE_KEY[key]] as string[];
}

export function withSelected(state: AcquireFilterState, key: FilterKey, values: string[]): AcquireFilterState {
    return { ...state, [STATE_KEY[key]]: values };
}

/** True when the combination passes every chosen list filter except `skip`. */
function comboMatches(c: AcquireCombo, state: AcquireFilterState, skip?: FilterKey): boolean {
    return FILTER_KEYS.every(k => {
        if (k === skip) return true;
        const chosen = selected(state, k);
        return chosen.length === 0 || (c[k] !== null && chosen.includes(c[k] as string));
    });
}

export interface OptionItem { value: string; holes: number }

/** Each filter's choices with hole counts, narrowed by the OTHER filters chosen.
 *  Blank values can't be filtered on, so they aren't offered. Values already
 *  chosen stay in the list even when another filter rules them out. */
export function optionLists(combos: AcquireCombo[], state: AcquireFilterState): Record<FilterKey, OptionItem[]> {
    const out = {} as Record<FilterKey, OptionItem[]>;
    for (const key of FILTER_KEYS) {
        const counts = new Map<string, number>();
        for (const c of combos) {
            const v = c[key];
            if (v === null || v === '' || !comboMatches(c, state, key)) continue;
            counts.set(v, (counts.get(v) ?? 0) + c.holes);
        }
        for (const v of selected(state, key)) if (!counts.has(v)) counts.set(v, 0);
        out[key] = [...counts.entries()]
            .map(([value, holes]) => ({ value, holes }))
            .sort((a, b) => a.value.localeCompare(b.value, undefined, { numeric: true }));
    }
    return out;
}

/** Holes matching the list filters (project, prospect, hole type, program), before dates and a hole list. */
export function holesMatchingLists(combos: AcquireCombo[], state: AcquireFilterState): number {
    return combos.reduce((n, c) => n + (comboMatches(c, state) ? c.holes : 0), 0);
}

export function hasAnyFilter(state: AcquireFilterState): boolean {
    return FILTER_KEYS.some(k => selected(state, k).length > 0)
        || !!state.drilledFrom || !!state.drilledTo || !!state.modifiedFrom || !!state.modifiedTo
        || parseHoleList(state.holeListText).ids.length > 0;
}

/** A problem with the filters to show instead of previewing, or null. */
export function filterProblem(state: AcquireFilterState): string | null {
    const dates = [['Drilled from', state.drilledFrom], ['Drilled to', state.drilledTo],
        ['Modified from', state.modifiedFrom], ['Modified to', state.modifiedTo]] as const;
    for (const [label, d] of dates) {
        if (d && !DATE_RE.test(d)) return `${label} must be a date like 2026-01-31`;
    }
    if (state.drilledFrom && state.drilledTo && state.drilledFrom > state.drilledTo) {
        return "The 'Drilled from' date is after the 'Drilled to' date";
    }
    if (state.modifiedFrom && state.modifiedTo && state.modifiedFrom > state.modifiedTo) {
        return "The 'Modified from' date is after the 'Modified to' date";
    }
    if (!hasAnyFilter(state)) return 'Choose at least one filter, or paste a hole list';
    return null;
}

export function buildPreviewRequest(state: AcquireFilterState, profile?: string): AcquirePreviewRequest {
    return {
        ...(profile ? { profile } : {}),
        projects: [...state.projects],
        prospects: [...state.prospects],
        hole_types: [...state.holeTypes],
        programs: [...state.programs],
        drilled_from: state.drilledFrom || null,
        drilled_to: state.drilledTo || null,
        modified_from: state.modifiedFrom || null,
        modified_to: state.modifiedTo || null,
        hole_ids: parseHoleList(state.holeListText).ids,
    };
}

/** A short, readable summary of the filters (notification and processing log). */
export function describeFilters(req: AcquirePreviewRequest): string {
    const parts: string[] = [];
    const list = (label: string, v: string[]) => { if (v.length) parts.push(`${label} ${v.join(', ')}`); };
    list('project', req.projects);
    list('prospect', req.prospects);
    list('hole type', req.hole_types);
    list('program', req.programs);
    if (req.drilled_from || req.drilled_to) {
        parts.push(`drilled ${req.drilled_from ?? '…'} to ${req.drilled_to ?? '…'}`);
    }
    if (req.modified_from || req.modified_to) {
        parts.push(`modified ${req.modified_from ?? '…'} to ${req.modified_to ?? '…'}`);
    }
    if (req.hole_ids.length) parts.push(`${req.hole_ids.length} listed hole${req.hole_ids.length === 1 ? '' : 's'}`);
    return parts.join('; ') || 'no filters';
}

/** The processing-log entry for an Acquire import (auditStore.recordAudit). */
export function pullRecordAudit(record: AcquirePullRecord, req: AcquirePreviewRequest, loadedRows: number) {
    const r = record.rows;
    return {
        category: 'import' as const,
        operation: 'Acquire import',
        description: `Imported ${record.holes} hole${record.holes === 1 ? '' : 's'} from Acquire (${describeFilters(req)})`,
        details: (record.profile ? `Profile ${record.profile}: ` : '') +
            `${r.collar} collar, ${r.survey} survey and ${r.assay} assay rows read from ` +
            `${record.server}/${record.database} by ${record.user} at ${record.pulled_at} ` +
            `(queries ${record.query_version}, field map v${record.mapping_version ?? '?'}). SHA-256 ${record.sha256}`,
        parameters: { ...record, request: req } as Record<string, unknown>,
        rowsAffected: loadedRows,
    };
}

/** Pasted IDs the preview didn't find, when the hole list was the only filter. */
export function holesNotFound(req: AcquirePreviewRequest, found: number): number {
    const onlyList = req.hole_ids.length > 0 && !req.projects.length && !req.prospects.length
        && !req.hole_types.length && !req.programs.length && !req.drilled_from && !req.drilled_to
        && !req.modified_from && !req.modified_to;
    return onlyList ? Math.max(0, req.hole_ids.length - found) : 0;
}
