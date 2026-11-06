/**
 * Row filters for the Data view (pure; unit-tested).
 *
 * Filters work on ORIGINAL row indices and the values as stored (raw: below
 * detection = -DL, the same numbers the grid shows). Every active filter must
 * pass (AND). Dates are recognised in the frontend from text columns (the
 * backend only types columns numeric/text) and parsed to UTC epoch ms.
 */
import { create } from 'zustand';
import { ColumnData, isNumericColumn } from '../../types/columnarData';

export type BlankMode = 'any' | 'exclude' | 'only';

export type ColumnFilter =
    | { kind: 'number'; min?: number; max?: number; blanks?: BlankMode; bdl?: 'any' | 'exclude' | 'only' }
    | { kind: 'category'; values: string[] }
    | { kind: 'text'; contains: string; caseSensitive?: boolean; exclude?: boolean }
    | { kind: 'date'; from?: number; to?: number; blanks?: BlankMode };

export type FilterKind = ColumnFilter['kind'];

const isBlank = (v: unknown) => v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v));

// ---------------------------------------------------------------------------
// Dates

const MONTHS: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function utc(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): number | null {
    if (y < 100) y += y < 50 ? 2000 : 1900;
    if (m < 1 || m > 12 || d < 1 || d > 31 || hh > 23 || mm > 59 || ss > 59) return null;
    const t = Date.UTC(y, m - 1, d, hh, mm, ss);
    // Reject rollovers like 31/02
    const dt = new Date(t);
    return dt.getUTCDate() === d && dt.getUTCMonth() === m - 1 ? t : null;
}

const TIME = String.raw`(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(am|pm)?(?:Z|[+-]\d{2}:?\d{2})?)?`;
const RE_YMD = new RegExp(String.raw`^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})${TIME}$`, 'i');
const RE_DMY = new RegExp(String.raw`^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})${TIME}$`, 'i');
const RE_D_MON_Y = new RegExp(String.raw`^(\d{1,2})[-/ .]([a-z]{3,9})[-/ .,]+(\d{2}|\d{4})${TIME}$`, 'i');
const RE_MON_D_Y = new RegExp(String.raw`^([a-z]{3,9})[ .]+(\d{1,2}),?\s+(\d{4})${TIME}$`, 'i');

function hms(h?: string, m?: string, s?: string, ap?: string): [number, number, number] {
    let hh = h ? +h : 0;
    if (ap) { const pm = ap.toLowerCase() === 'pm'; if (hh === 12) hh = pm ? 12 : 0; else if (pm) hh += 12; }
    return [hh, m ? +m : 0, s ? +s : 0];
}

/**
 * Parse one date string to UTC epoch ms, or null. `dayFirst` resolves
 * ambiguous a/b/yyyy (true = d/m/y, the Australian convention).
 */
export function parseDate(text: string, dayFirst = true): number | null {
    const s = text.trim();
    if (!s) return null;
    let m = RE_YMD.exec(s);
    if (m) return utc(+m[1], +m[2], +m[3], ...hms(m[4], m[5], m[6], m[7]));
    m = RE_DMY.exec(s);
    if (m) {
        const a = +m[1], b = +m[2];
        const [d, mo] = dayFirst ? [a, b] : [b, a];
        return utc(+m[3], mo, d, ...hms(m[4], m[5], m[6], m[7]));
    }
    m = RE_D_MON_Y.exec(s);
    if (m) {
        const mo = MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()];
        return mo ? utc(+m[3], mo, +m[1], ...hms(m[4], m[5], m[6], m[7])) : null;
    }
    m = RE_MON_D_Y.exec(s);
    if (m) {
        const mo = MONTHS[m[1].slice(0, 4).toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()];
        return mo ? utc(+m[3], mo, +m[2], ...hms(m[4], m[5], m[6], m[7])) : null;
    }
    return null;
}

/** Excel serial day number (1900 system) to UTC epoch ms. */
export function excelSerialToMs(serial: number): number | null {
    if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
    return Math.round((serial - 25569) * 86400000);
}

export interface DateDetection {
    isDate: boolean;
    /** Order for ambiguous a/b/yyyy */
    dayFirst: boolean;
    /** Numeric column holding Excel serial days */
    excelSerial?: boolean;
}

/**
 * Is this column dates? Text columns: most non-blank sampled values parse.
 * Numeric columns only when the user gave them the Date role (Excel serials).
 * Day/month order is inferred from any part > 12, else day-first.
 */
export function detectDateColumn(col: ColumnData | undefined, role?: string | null): DateDetection {
    const no: DateDetection = { isDate: false, dayFirst: true };
    if (!col) return no;
    if (isNumericColumn(col)) {
        if (role !== 'Date') return no;
        let n = 0, ok = 0;
        for (let i = 0; i < col.length && n < 200; i++) {
            const v = col[i];
            if (Number.isNaN(v)) continue;
            n++;
            if (excelSerialToMs(v) !== null) ok++;
        }
        return n > 0 && ok / n >= 0.9 ? { isDate: true, dayFirst: true, excelSerial: true } : no;
    }
    const sample: string[] = [];
    const step = Math.max(1, Math.floor(col.length / 400));
    for (let i = 0; i < col.length && sample.length < 400; i += step) {
        const v = col[i];
        if (v && v.trim()) sample.push(v.trim());
    }
    if (!sample.length) return no;
    let dayFirst = true;
    for (const s of sample) {
        const m = RE_DMY.exec(s);
        if (!m) continue;
        if (+m[1] > 12) { dayFirst = true; break; }
        if (+m[2] > 12) { dayFirst = false; break; }
    }
    const ok = sample.filter(s => parseDate(s, dayFirst) !== null).length;
    return ok / sample.length >= 0.9 || (role === 'Date' && ok / sample.length >= 0.5)
        ? { isDate: true, dayFirst }
        : no;
}

/** A date column as epoch ms (NaN = blank / unparseable). */
export function parseDateColumn(col: ColumnData, det: DateDetection): Float64Array {
    const out = new Float64Array(col.length).fill(NaN);
    if (isNumericColumn(col)) {
        for (let i = 0; i < col.length; i++) out[i] = excelSerialToMs(col[i]) ?? NaN;
        return out;
    }
    for (let i = 0; i < col.length; i++) {
        const v = col[i];
        if (v) out[i] = parseDate(v, det.dayFirst) ?? NaN;
    }
    return out;
}

// ---------------------------------------------------------------------------
// Column kinds

/** Text columns with at most this many distinct values get a checklist. */
export const MAX_CATEGORIES = 1000;

/** Distinct values (with counts), most common first; null when too many. */
export function categoryCounts(col: ColumnData | undefined, limit = MAX_CATEGORIES): { value: string; count: number }[] | null {
    if (!col || isNumericColumn(col)) return null;
    const counts = new Map<string, number>();
    for (let i = 0; i < col.length; i++) {
        const v = col[i] ?? '';
        counts.set(v, (counts.get(v) ?? 0) + 1);
        if (counts.size > limit) return null;
    }
    return [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, undefined, { numeric: true }));
}

/** The filter editor that suits a column. */
export function filterKindFor(col: ColumnData | undefined, date: DateDetection): FilterKind {
    if (date.isDate) return 'date';
    if (col && isNumericColumn(col)) return 'number';
    return categoryCounts(col) ? 'category' : 'text';
}

// ---------------------------------------------------------------------------
// Applying filters

export interface FilterContext {
    /** Raw (stored) column */
    getColumn: (name: string) => ColumnData | undefined;
    /** Parsed date column (epoch ms) for date filters */
    getDates?: (name: string) => Float64Array | undefined;
}

function rowTest(name: string, f: ColumnFilter, ctx: FilterContext): ((i: number) => boolean) | null {
    if (f.kind === 'date') {
        const d = ctx.getDates?.(name);
        if (!d) return null;
        const blanks = f.blanks ?? 'exclude';
        const lo = f.from ?? -Infinity, hi = f.to ?? Infinity;
        return (i) => {
            const v = d[i];
            if (Number.isNaN(v)) return blanks !== 'exclude';
            if (blanks === 'only') return false;
            return v >= lo && v <= hi;
        };
    }
    const col = ctx.getColumn(name);
    if (!col) return null;
    if (f.kind === 'number') {
        if (!isNumericColumn(col)) return null;
        const blanks = f.blanks ?? 'any';
        const bdl = f.bdl ?? 'any';
        const lo = f.min ?? -Infinity, hi = f.max ?? Infinity;
        const ranged = f.min !== undefined || f.max !== undefined || bdl !== 'any';
        return (i) => {
            const v = col[i];
            if (Number.isNaN(v)) return blanks === 'only' || (blanks === 'any' && !ranged);
            if (blanks === 'only') return false;
            if (bdl === 'exclude' && v < 0) return false;
            if (bdl === 'only' && !(v < 0)) return false;
            return v >= lo && v <= hi;
        };
    }
    if (f.kind === 'category') {
        const allowed = new Set(f.values);
        if (isNumericColumn(col)) return (i) => allowed.has(Number.isNaN(col[i]) ? '' : String(col[i]));
        return (i) => allowed.has(col[i] ?? '');
    }
    // text
    if (!f.contains) return null;
    const needle = f.caseSensitive ? f.contains : f.contains.toLowerCase();
    const has = (v: unknown) => {
        if (isBlank(v)) return false;
        const s = String(v);
        return (f.caseSensitive ? s : s.toLowerCase()).includes(needle);
    };
    return f.exclude ? (i) => !has(col[i]) : (i) => has(col[i]);
}

/** Quick search: any of `columns` contains the text (case-insensitive). */
function searchTest(text: string, columns: string[], ctx: FilterContext): ((i: number) => boolean) | null {
    const needle = text.trim().toLowerCase();
    if (!needle) return null;
    const cols = columns.map(c => ctx.getColumn(c)).filter((c): c is ColumnData => !!c);
    return (i) => cols.some(col => {
        const v = col[i];
        return !isBlank(v) && String(v).toLowerCase().includes(needle);
    });
}

/** Rows (in the given order) that pass every filter and the quick search. */
export function applyFilters(
    rows: number[],
    filters: Record<string, ColumnFilter>,
    ctx: FilterContext,
    search?: { text: string; columns: string[] },
): number[] {
    const tests = Object.entries(filters)
        .map(([name, f]) => rowTest(name, f, ctx))
        .filter((t): t is (i: number) => boolean => !!t);
    const s = search ? searchTest(search.text, search.columns, ctx) : null;
    if (s) tests.push(s);
    if (!tests.length) return rows;
    return rows.filter(i => tests.every(t => t(i)));
}

/** A filter that does nothing (so the chip can be dropped). */
export function isFilterEmpty(f: ColumnFilter): boolean {
    switch (f.kind) {
        case 'number': return f.min === undefined && f.max === undefined && (f.blanks ?? 'any') === 'any' && (f.bdl ?? 'any') === 'any';
        case 'category': return false;
        case 'text': return !f.contains;
        case 'date': return f.from === undefined && f.to === undefined && (f.blanks ?? 'exclude') === 'exclude';
    }
}

const fmtNum = (v: number) => String(Number(v.toPrecision(6)));
export const fmtDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Short chip label, e.g. "Cu_ppm ≥ 100", "Date 2024-01-01 → 2024-06-30". */
export function describeFilter(name: string, f: ColumnFilter): string {
    switch (f.kind) {
        case 'number': {
            const parts: string[] = [];
            if (f.min !== undefined && f.max !== undefined) parts.push(`${fmtNum(f.min)} – ${fmtNum(f.max)}`);
            else if (f.min !== undefined) parts.push(`≥ ${fmtNum(f.min)}`);
            else if (f.max !== undefined) parts.push(`≤ ${fmtNum(f.max)}`);
            if (f.bdl === 'exclude') parts.push('no <DL');
            if (f.bdl === 'only') parts.push('<DL only');
            if (f.blanks === 'exclude') parts.push('no blanks');
            if (f.blanks === 'only') parts.push('blanks only');
            return `${name} ${parts.join(', ')}`;
        }
        case 'category':
            return f.values.length <= 2
                ? `${name} = ${f.values.map(v => v || '(blank)').join(' | ') || '(none)'}`
                : `${name}: ${f.values.length} values`;
        case 'text':
            return `${name} ${f.exclude ? 'excludes' : 'contains'} "${f.contains}"`;
        case 'date': {
            const a = f.from !== undefined ? fmtDate(f.from) : '…';
            const b = f.to !== undefined ? fmtDate(f.to) : '…';
            return `${name} ${a} → ${b}${f.blanks === 'only' ? ' (blanks only)' : ''}`;
        }
    }
}

// ---------------------------------------------------------------------------
// Session state (survives switching panes; not saved in projects)

interface DataFilterState {
    filters: Record<string, ColumnFilter>;
    search: string;
    setFilter: (column: string, filter: ColumnFilter | null) => void;
    setSearch: (text: string) => void;
    clearAll: () => void;
}

export const useDataFilterStore = create<DataFilterState>()((set) => ({
    filters: {},
    search: '',
    setFilter: (column, filter) => set(s => {
        const filters = { ...s.filters };
        if (!filter || isFilterEmpty(filter)) delete filters[column];
        else filters[column] = filter;
        return { filters };
    }),
    setSearch: (search) => set({ search }),
    clearAll: () => set({ filters: {}, search: '' }),
}));
