/**
 * Drill tracking: the drilled holes as the latest Acquire export has them
 * (pure: no React; unit-tested).
 *
 * Everything downstream of the import reads `LiveDrillData`, so a reader of
 * Acquire itself can replace this CSV importer by producing the same type.
 *
 * Collar and survey files are read with a column mapping: each field is a
 * column of the file, guessed from its header and changed by hand when the
 * guess is wrong. Coordinates are the project grid (where an export has
 * several coordinate sets, e.g. `East` and `East_20`, the guess takes the
 * suffixed one first; check it is the project's). Dips are
 * negative downwards, azimuths 0-360 clockwise from the grid north their
 * survey row's grid names.
 */

/** One drilled hole, as the collar file has it */
export interface LiveCollar {
    hole: string;
    e: number | null;
    n: number | null;
    rl: number | null;
    /** The planned hole it was drilled to (Acquire `PlanHoleID`) */
    planId: string | null;
    /** Acquire `HoleStatus` (Complete, Abandoned, InProgress, Re-Entry, …) */
    status: string | null;
    holeType: string | null;
    /** ISO dates (yyyy-mm-dd) */
    dateStart: string | null;
    dateFini: string | null;
    /** Acquire `Max_Depth`: the hole's depth as last entered (not necessarily today's) */
    maxDepth: number | null;
    /** A depth the site team keeps up to date while the hole is drilled, and the date it was read */
    liveDepth: number | null;
    liveDepthDate: string | null;
}

/** One survey station, as the survey file has it */
export interface LiveSurvey {
    hole: string;
    depth: number;
    dip: number;
    azi: number;
    /** The survey method code (e.g. Acquire's `SurvMeth`; read by the survey rules) */
    method: string | null;
    /** Acquire `Grid_ID` of the row (the grid its azimuth is to) */
    grid: string | null;
}

export interface LiveDrillData {
    collars: LiveCollar[];
    surveys: LiveSurvey[];
    /** Where it came from and when it was read (ISO date-time) */
    source: { collarFile: string; surveyFile: string; readAt: string };
    /** Rows that could not be read, and why */
    problems: string[];
}

export const COLLAR_FIELDS = ['hole', 'e', 'n', 'rl', 'planId', 'status', 'holeType', 'dateStart', 'dateFini', 'maxDepth', 'liveDepth', 'liveDepthDate'] as const;
export const SURVEY_FIELDS = ['hole', 'depth', 'dip', 'azi', 'method', 'grid'] as const;
export type CollarField = (typeof COLLAR_FIELDS)[number];
export type SurveyField = (typeof SURVEY_FIELDS)[number];
/** Each field's column (index into the header), or null for none */
export type CollarColumns = Record<CollarField, number | null>;
export type SurveyColumns = Record<SurveyField, number | null>;

export const COLLAR_FIELD_LABELS: Record<CollarField, string> = {
    hole: 'Hole ID', e: 'Easting', n: 'Northing', rl: 'RL', planId: 'Planned hole ID', status: 'Hole status', holeType: 'Hole type',
    dateStart: 'Date started', dateFini: 'Date finished', maxDepth: 'Max depth', liveDepth: 'Live depth', liveDepthDate: 'Live depth date',
};
export const SURVEY_FIELD_LABELS: Record<SurveyField, string> = {
    hole: 'Hole ID', depth: 'Depth', dip: 'Dip', azi: 'Azimuth', method: 'Survey method', grid: 'Grid',
};
/** Fields a file cannot be read without */
export const COLLAR_REQUIRED: readonly CollarField[] = ['hole', 'e', 'n', 'rl'];
export const SURVEY_REQUIRED: readonly SurveyField[] = ['hole', 'depth', 'dip', 'azi'];

/** Header names tried for each field, best first (compared without case, spaces or punctuation) */
const COLLAR_NAMES: Record<CollarField, string[]> = {
    hole: ['holeid', 'hole_id', 'hole', 'bhid'],
    e: ['east_20', 'easting_20', 'east', 'easting', 'collareast', 'x'],
    n: ['north_20', 'northing_20', 'north', 'northing', 'collarnorth', 'y'],
    rl: ['rl_20', 'rl', 'elevation', 'collarrl', 'z'],
    planId: ['planholeid', 'plan_hole_id', 'plannedholeid', 'planid', 'planned_id'],
    status: ['holestatus', 'hole_status', 'status'],
    holeType: ['hole_type', 'holetype'],
    dateStart: ['datestart', 'date_start', 'startdate', 'start_date'],
    dateFini: ['datefini', 'date_fini', 'datefinish', 'date_finish', 'enddate', 'end_date'],
    maxDepth: ['max_depth', 'maxdepth', 'eoh', 'total_depth', 'totaldepth'],
    liveDepth: ['depth_current', 'current_depth', 'currentdepth', 'live_depth', 'livedepth'],
    liveDepthDate: ['depth_date', 'current_depth_date', 'live_depth_date'],
};
const SURVEY_NAMES: Record<SurveyField, string[]> = {
    hole: ['holeid', 'hole_id', 'hole', 'bhid'],
    depth: ['depth', 'surveydepth', 'survey_depth', 'at', 'md'],
    dip: ['dip', 'inclination'],
    azi: ['azimuth', 'azi', 'azi_grid', 'azimuth_grid', 'bearing'],
    method: ['survmeth', 'surv_meth', 'survey_method', 'surveymethod', 'method'],
    grid: ['grid_id', 'gridid', 'grid'],
};

const squash = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

/** Each field's column from a header: the first of its names found (without case, spaces or punctuation), each column used once */
export function guessColumns<F extends string>(header: readonly string[], names: Record<F, string[]>): Record<F, number | null> {
    return guess(header, names);
}

function guess<F extends string>(header: readonly string[], names: Record<F, string[]>): Record<F, number | null> {
    const at = new Map<string, number>();
    header.forEach((h, i) => { const k = squash(h); if (!at.has(k)) at.set(k, i); });
    const used = new Set<number>();
    const out = {} as Record<F, number | null>;
    for (const field of Object.keys(names) as F[]) {
        const hit = names[field].map(n => at.get(squash(n))).find(i => i !== undefined && !used.has(i));
        out[field] = hit ?? null;
        if (hit !== undefined) used.add(hit);
    }
    return out;
}

/** The columns of a collar file, guessed from its header */
export const guessCollarColumns = (header: readonly string[]): CollarColumns => guess(header, COLLAR_NAMES);
/** The columns of a survey file, guessed from its header */
export const guessSurveyColumns = (header: readonly string[]): SurveyColumns => guess(header, SURVEY_NAMES);

/** The required fields with no column */
export const missingCollarFields = (cols: CollarColumns) => COLLAR_REQUIRED.filter(f => cols[f] === null);
export const missingSurveyFields = (cols: SurveyColumns) => SURVEY_REQUIRED.filter(f => cols[f] === null);

/** A number, or null for a blank or something that is not one */
export function numberOf(text: string | undefined): number | null {
    const t = (text ?? '').trim();
    if (t === '' || t === '-') return null;
    const v = Number(t);
    return Number.isFinite(v) ? v : null;
}

export const textOf = (text: string | undefined): string | null => {
    const t = (text ?? '').trim();
    return t === '' ? null : t;
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const iso = (y: number, m: number, d: number): string | null => {
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2200)) return null;
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCMonth() !== m - 1) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/**
 * A date as yyyy-mm-dd, from "9-Apr-2018", "2018-04-09" or "09/04/2018"
 * (day first, as written in Australia). A time after it is ignored. Null when
 * it is not a date.
 */
export function dateOf(text: string | undefined): string | null {
    const t = (text ?? '').trim().split(/[ T]/)[0];
    if (!t) return null;
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
    if (m) return iso(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ](\d{2}|\d{4})$/.exec(t);
    if (m) {
        const month = MONTHS.indexOf(m[2].toLowerCase()) + 1;
        const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
        return month ? iso(y, month, +m[1]) : null;
    }
    m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(t);
    if (m) return iso(+m[3], +m[2], +m[1]);
    return null;
}

/** An ISO date-time as "yyyy-mm-dd hh:mm" in local time (as it was given when it is not one) */
export function localTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const p = (v: number) => String(v).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const cell = (row: readonly string[], i: number | null) => (i === null ? undefined : row[i]);

/** The collars of a collar file's rows (the header first), with the rows that could not be read */
export function readLiveCollars(rows: readonly (readonly string[])[], cols: CollarColumns): { collars: LiveCollar[]; problems: string[] } {
    const missing = missingCollarFields(cols);
    if (missing.length) return { collars: [], problems: [`The collar file has no column for: ${missing.map(f => COLLAR_FIELD_LABELS[f]).join(', ')}.`] };
    const collars: LiveCollar[] = [], problems: string[] = [];
    const seen = new Set<string>();
    rows.slice(1).forEach((row, k) => {
        const hole = textOf(cell(row, cols.hole));
        if (!hole) { problems.push(`Collar row ${k + 2}: no hole ID.`); return; }
        if (seen.has(hole)) { problems.push(`Collar row ${k + 2}: ${hole} is in the file twice; the first is kept.`); return; }
        seen.add(hole);
        const c: LiveCollar = {
            hole,
            e: numberOf(cell(row, cols.e)), n: numberOf(cell(row, cols.n)), rl: numberOf(cell(row, cols.rl)),
            planId: textOf(cell(row, cols.planId)), status: textOf(cell(row, cols.status)), holeType: textOf(cell(row, cols.holeType)),
            dateStart: dateOf(cell(row, cols.dateStart)), dateFini: dateOf(cell(row, cols.dateFini)),
            maxDepth: numberOf(cell(row, cols.maxDepth)), liveDepth: numberOf(cell(row, cols.liveDepth)), liveDepthDate: dateOf(cell(row, cols.liveDepthDate)),
        };
        if (c.e === null || c.n === null || c.rl === null) problems.push(`${hole}: no collar coordinates; it is listed but has no trace.`);
        collars.push(c);
    });
    return { collars, problems };
}

/** The stations of a survey file's rows (the header first), with the rows that could not be read */
export function readLiveSurveys(rows: readonly (readonly string[])[], cols: SurveyColumns): { surveys: LiveSurvey[]; problems: string[] } {
    const missing = missingSurveyFields(cols);
    if (missing.length) return { surveys: [], problems: [`The survey file has no column for: ${missing.map(f => SURVEY_FIELD_LABELS[f]).join(', ')}.`] };
    const surveys: LiveSurvey[] = [], problems: string[] = [];
    let bad = 0;
    rows.slice(1).forEach(row => {
        const hole = textOf(cell(row, cols.hole));
        const depth = numberOf(cell(row, cols.depth)), dip = numberOf(cell(row, cols.dip)), azi = numberOf(cell(row, cols.azi));
        if (!hole || depth === null || dip === null || azi === null || depth < 0 || dip > 90 || dip < -90) { bad++; return; }
        surveys.push({ hole, depth, dip, azi, method: textOf(cell(row, cols.method)), grid: textOf(cell(row, cols.grid)) });
    });
    if (bad) problems.push(`${bad.toLocaleString()} survey row${bad === 1 ? '' : 's'} without a hole, depth, dip or azimuth (or out of range) left out.`);
    return { surveys, problems };
}

// ---------------------------------------------------------------------------
// Reading from Acquire (SQL): the same rows, pulled through the Acquire import's profiles
// ---------------------------------------------------------------------------

/** How drill tracking pulls from Acquire, kept with the project so a refresh is one click */
export interface AcquireLiveSettings {
    /** The connection profile (ignored in server mode, where the admin's is used) */
    profile: string | null;
    /** Holes started in the last this many days (null: no date filter) */
    days: number | null;
    /** Holes by ID as well (or instead) */
    holeIds: string[];
    /** The columns last chosen, by name (null: guess again) */
    collarColumns: Record<CollarField, string | null> | null;
    surveyColumns: Record<SurveyField, string | null> | null;
}

export const ACQUIRE_LIVE_DEFAULTS: AcquireLiveSettings = { profile: null, days: 365, holeIds: [], collarColumns: null, surveyColumns: null };

/** The request body for POST /api/drilltracking/acquire (`today` as yyyy-mm-dd); null when it has no filter */
export function acquireLiveRequest(s: AcquireLiveSettings, today: string): Record<string, unknown> | null {
    const body: Record<string, unknown> = {};
    if (s.profile) body.profile = s.profile;
    if (s.days !== null && s.days > 0) {
        const d = new Date(`${today}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() - Math.round(s.days));
        body.drilled_from = d.toISOString().slice(0, 10);
    }
    const ids = s.holeIds.map(h => h.trim()).filter(Boolean);
    if (ids.length) body.hole_ids = ids;
    return body.drilled_from || body.hole_ids ? body : null;
}

/** Columns by index as names (to keep), and back (null for a name the header no longer has) */
export function columnsByName<F extends string>(header: readonly string[], cols: Record<F, number | null>): Record<F, string | null> {
    const out = {} as Record<F, string | null>;
    for (const f of Object.keys(cols) as F[]) out[f] = cols[f] === null ? null : header[cols[f]!] ?? null;
    return out;
}

export function columnsByIndex<F extends string>(header: readonly string[], named: Record<F, string | null>): Record<F, number | null> {
    const out = {} as Record<F, number | null>;
    for (const f of Object.keys(named) as F[]) {
        const i = named[f] === null ? -1 : header.indexOf(named[f]!);
        out[f] = i < 0 ? null : i;
    }
    return out;
}

/**
 * Columns for a pulled table: those kept by name where the header still has
 * them, else the guess; the profile's own columns for the roles it maps win.
 */
export function pulledColumns<F extends string>(
    header: readonly string[], guessed: Record<F, number | null>, kept: Record<F, string | null> | null, profile: Partial<Record<F, string>>,
): Record<F, number | null> {
    const out = { ...guessed };
    if (kept) {
        const byName = columnsByIndex(header, kept);
        for (const f of Object.keys(byName) as F[]) if (byName[f] !== null || kept[f] === null) out[f] = byName[f];
    }
    for (const f of Object.keys(profile) as F[]) {
        const i = header.indexOf(profile[f]!);
        if (i >= 0) out[f] = i;
    }
    return out;
}

/** Where the drilled holes came from, in words: two files, or one source (Acquire) */
export const sourceText = (s: { collarFile: string; surveyFile: string }) => (s.surveyFile ? `${s.collarFile} and ${s.surveyFile}` : s.collarFile);
