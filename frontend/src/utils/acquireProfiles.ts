/**
 * Data Import > Acquire (SQL): pure connection-profile logic (no React, no requests).
 *
 * A profile is a server, a database, driver options and a field map: which
 * tables or views, and which columns, hold collars, surveys, assays and the
 * filter fields. Names only, never SQL. The checks here mirror the backend's
 * (app/acquire/validation.py, app/acquire/profiles.py) so the screen can say
 * what's wrong before anything is sent; the backend checks again.
 */

export type AssayLayout = 'wide' | 'long' | 'long_joined';
export type PreferredRule = 'none' | 'lowest' | 'highest' | 'first';
export type BdlWrite = 'half' | 'negative' | 'as_is';
export type DipConvention = 'negative_down' | 'positive_down';
export type TableKey = 'collar' | 'survey' | 'assay' | 'samples';

export interface TableSpec {
    schema?: string;
    object: string;
    columns: Record<string, string>;
}

export interface AssaySpec extends TableSpec {
    layout: AssayLayout;
    samples?: TableSpec | null;
    preferred?: { rule: PreferredRule; column: string | null } | null;
    bdl?: { column: string; values: string[]; write_as: BdlWrite } | null;
    qaqc?: { column: string; exclude: string[] } | null;
    column_rules?: {
        drop_columns?: string[]; drop_suffixes?: string[]; strip_suffixes?: string[];
        rename?: Record<string, string>;
    };
}

export interface FieldMap {
    schema?: string;
    date_format?: string;
    dip?: DipConvention;
    collar: TableSpec;
    survey: TableSpec & { priority?: { column: string; keep: 'lowest' | 'highest' } | null };
    assay: AssaySpec;
    filters: Partial<Record<FilterField, string | null>>;
}

export interface AcquireProfile {
    name: string;
    server: string;
    database: string;
    driver?: string;
    encrypt?: boolean;
    trust_server_certificate?: boolean;
    notes?: unknown;
    version?: number;
    field_map: FieldMap;
}

export type FilterField = 'project' | 'prospect' | 'hole_type' | 'program' | 'drilled' | 'modified';
export const FILTER_FIELDS: FilterField[] = ['project', 'prospect', 'hole_type', 'program', 'drilled', 'modified'];
export const FILTER_LABELS: Record<FilterField, string> = {
    project: 'Project', prospect: 'Prospect', hole_type: 'Hole type', program: 'Program',
    drilled: 'Drilled date', modified: 'Modified date',
};

/** Required and optional roles per table (assay roles depend on the layout). */
export function roles(table: TableKey, layout: AssayLayout = 'wide'): { required: string[]; optional: string[] } {
    switch (table) {
        case 'collar': return { required: ['hole_id', 'easting', 'northing', 'rl'], optional: [] };
        case 'survey': return { required: ['hole_id', 'depth', 'dip', 'azimuth'], optional: [] };
        case 'samples': return { required: ['sample_id', 'hole_id', 'from', 'to'], optional: [] };
        case 'assay':
            if (layout === 'long') return { required: ['hole_id', 'from', 'to', 'element', 'value'], optional: ['sample_id', 'unit'] };
            if (layout === 'long_joined') return { required: ['sample_id', 'element', 'value'], optional: ['unit'] };
            return { required: ['hole_id', 'from', 'to'], optional: [] };
    }
}

export const ROLE_LABELS: Record<string, string> = {
    hole_id: 'Hole ID', easting: 'East', northing: 'North', rl: 'RL / elevation', depth: 'Depth', dip: 'Dip',
    azimuth: 'Azimuth', from: 'From', to: 'To', sample_id: 'Sample ID', element: 'Element / analyte',
    value: 'Value', unit: 'Unit',
};

// ------------------------------------------------------------------ input checks

const BAD_CHARS = /[;{}="'`\s]/;
const SERVER_RE = /^([A-Za-z0-9](?:[A-Za-z0-9\-_.]{0,252}[A-Za-z0-9])?)(\\[A-Za-z0-9_$#-]{1,64})?(,(\d{1,5}))?$/;

/** A problem with a typed SQL Server name, or null. */
export function serverProblem(server: string): string | null {
    if (!server) return 'Enter the SQL Server name.';
    const bad = [...new Set(server.split('').filter(c => BAD_CHARS.test(c)))];
    if (bad.length) return `The SQL Server name can't contain ${bad.map(c => (/\s/.test(c) ? 'spaces' : c)).join(' ')}.`;
    const m = SERVER_RE.exec(server);
    if (!m) return 'Use a host name or IP address, optionally followed by \\INSTANCE and ,port.';
    if (m[4] && !(Number(m[4]) > 0 && Number(m[4]) < 65536)) return 'The port must be between 1 and 65535.';
    return null;
}

/** A problem with a typed database name, or null (whether it exists is checked on the server). */
export function databaseProblem(database: string): string | null {
    if (!database) return 'Enter the database name.';
    const bad = [...new Set(database.split('').filter(c => BAD_CHARS.test(c)))];
    if (bad.length) return `The database name can't contain ${bad.map(c => (/\s/.test(c) ? 'spaces' : c)).join(' ')}.`;
    if (database.length > 128) return 'The database name is longer than 128 characters.';
    return null;
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,59}$/;
const RESERVED = new Set(['con', 'prn', 'aux', 'nul', ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap(i => [`com${i}`, `lpt${i}`])]);

/** A problem with a profile name, or null. `existing` are the other saved names. */
export function profileNameProblem(name: string, existing: string[] = []): string | null {
    const n = name.trim();
    if (!NAME_RE.test(n) || n.endsWith('.') || RESERVED.has(n.toLowerCase())) {
        return 'Use letters, digits, spaces, - _ and . (up to 60 characters, starting with a letter or digit).';
    }
    if (existing.some(e => e.toLowerCase() === n.toLowerCase())) return `A profile called "${n}" already exists.`;
    return null;
}

// ------------------------------------------------------------------ completeness

function tableProblems(spec: TableSpec | null | undefined, key: string, required: string[]): string[] {
    if (!spec) return [`${key}: not set`];
    const out: string[] = [];
    if (!spec.object) out.push(`${key}: choose a table or view`);
    for (const r of required) if (!spec.columns?.[r]) out.push(`${key}: choose the ${ROLE_LABELS[r] ?? r} column`);
    return out;
}

/** What's missing in a field map before it can be saved (empty = complete). */
export function fieldMapProblems(fm: FieldMap | null | undefined): string[] {
    if (!fm) return ['field map: not set'];
    const out = [
        ...tableProblems(fm.collar, 'collar', roles('collar').required),
        ...tableProblems(fm.survey, 'survey', roles('survey').required),
    ];
    const pri = fm.survey?.priority;
    if (pri && !pri.column) out.push('survey: choose the priority column (or turn the rule off)');
    const a = fm.assay;
    if (!a || !['wide', 'long', 'long_joined'].includes(a.layout)) {
        out.push('assay: choose the layout');
        return out;
    }
    out.push(...tableProblems(a, 'assay', roles('assay', a.layout).required));
    if (a.layout === 'long_joined') out.push(...tableProblems(a.samples, 'samples', roles('samples').required));
    const pref = a.preferred ?? { rule: 'none', column: null };
    if ((pref.rule === 'lowest' || pref.rule === 'highest') && !pref.column) out.push('assay: choose the priority column for the preferred-result rule');
    if (a.bdl && (!a.bdl.column || !a.bdl.values?.length)) out.push('assay: the below-detection rule needs a column and flag values');
    if (a.qaqc && (!a.qaqc.column || !a.qaqc.exclude?.length)) out.push('assay: the QAQC rule needs a column and the values to leave out');
    return out;
}

// ------------------------------------------------------------------ editing helpers

/** A copy of the profile with one column role set ('' clears it). */
export function withRole(p: AcquireProfile, table: TableKey, role: string, column: string): AcquireProfile {
    const next: AcquireProfile = JSON.parse(JSON.stringify(p));
    const fm = next.field_map;
    const spec = table === 'samples'
        ? (fm.assay.samples ??= { object: '', columns: {} })
        : fm[table];
    spec.columns = { ...spec.columns, [role]: column };
    if (!column) delete spec.columns[role];
    return next;
}

/** A copy with a table's object changed; columns that the new object lacks are cleared. */
export function withObject(p: AcquireProfile, table: TableKey, schema: string, object: string, columns: string[]): AcquireProfile {
    const next: AcquireProfile = JSON.parse(JSON.stringify(p));
    const fm = next.field_map;
    const spec = table === 'samples' ? (fm.assay.samples ??= { object: '', columns: {} }) : fm[table];
    spec.schema = schema;
    spec.object = object;
    const have = new Set(columns.map(c => c.toLowerCase()));
    spec.columns = Object.fromEntries(Object.entries(spec.columns ?? {}).filter(([, c]) => c && have.has(c.toLowerCase())));
    if (table === 'collar') {
        fm.filters = Object.fromEntries(Object.entries(fm.filters ?? {})
            .map(([k, c]) => [k, c && have.has(c.toLowerCase()) ? c : null]));
    }
    return next;
}

/** A comma / new-line separated list as entered in the editor. */
export function splitList(text: string): string[] {
    return text.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
}

/** "Old=New, A=B" -> {Old: New, A: B} (lines without = are ignored). */
export function parseRenames(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const part of splitList(text)) {
        const i = part.indexOf('=');
        if (i > 0 && part.slice(i + 1).trim()) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return out;
}

export function formatRenames(r: Record<string, string> | undefined): string {
    return Object.entries(r ?? {}).map(([a, b]) => `${a}=${b}`).join(', ');
}

/** Same connection and field map? (the test result applies only while nothing changed) */
export function connectionKey(p: AcquireProfile | null): string {
    if (!p) return '';
    return JSON.stringify([p.server, p.database, p.driver ?? '', p.encrypt ?? true, p.trust_server_certificate ?? true, p.field_map]);
}

export interface TestResult {
    ok: boolean;
    user?: string;
    version?: string;
    edition?: string;
    can_write?: boolean | null;
    write_permissions?: string[];
    message: string;
    map_problems: string[];
    incomplete: string[];
}

/** The filters and Preview / Import are usable once the saved profile passed its test with a complete, matching map. */
export function readyToImport(opts: { saved: boolean; dirty: boolean; test: TestResult | null; testKey: string; key: string }): boolean {
    const { saved, dirty, test, testKey, key } = opts;
    return saved && !dirty && !!test && test.ok && testKey === key && test.map_problems.length === 0 && test.incomplete.length === 0;
}

/** Remembered profile choice (per browser; never a secret). */
const LAST_KEY = 'acquire.lastProfile';
export function rememberProfile(name: string | null): void {
    try {
        if (name) localStorage.setItem(LAST_KEY, name); else localStorage.removeItem(LAST_KEY);
    } catch { /* storage unavailable */ }
}
export function lastProfile(): string | null {
    try { return localStorage.getItem(LAST_KEY); } catch { return null; }
}
