/**
 * The drillholes of a project as their own tables: where each hole is
 * collared and how it was surveyed (pure, unit-tested).
 *
 * The dataset carries one place per sample (its middle). With these tables
 * the path of each hole is known, so anything logged at a depth (a contact,
 * a structure reading, the end of an interval) can be put where it is.
 *
 * Dips are negative downwards, as the import leaves them. A collar with no
 * easting or northing, or a hole with no survey, has no path.
 *
 * Beside them, any number of tables logged down the holes (lithology,
 * alteration, structure readings), each kept row for row as it was logged:
 * a row's place comes from its hole and depth, not from the samples.
 */
import { cleanStations, positionAt, traceHole, type HoleTrace, type SurveyStation } from './desurvey';
import type { Vec3 } from './types';

export interface CollarTable {
    hole: string[];
    x: Float64Array;
    y: Float64Array;
    z: Float64Array;
}

export interface SurveyTable {
    hole: string[];
    depth: Float64Array;
    dip: Float64Array;
    azimuth: Float64Array;
}

/** A column of a table logged down the holes: numbers (NaN for none), or text ('' for none) */
export interface TableColumn {
    name: string;
    values: Float64Array | string[];
}

/** A table logged down the holes, row for row as it was logged */
export interface HoleTable {
    id: string;
    name: string;
    hole: string[];
    /** Where each row starts down its hole; in a table of depth points, its depth */
    from: Float64Array;
    /** Where each row ends. Null: a table of depth points (structure readings) */
    to: Float64Array | null;
    columns: TableColumn[];
}

export interface DrillholeDb {
    collar: CollarTable;
    survey: SurveyTable;
    /** Tables logged down the holes, in the order they were added */
    tables: HoleTable[];
}

type SavedNumbers = (number | null)[];

/** A logged table as the backend sends it and the project file keeps it */
export interface SavedHoleTable {
    id?: string;
    name?: string;
    hole: string[];
    from: SavedNumbers;
    to: SavedNumbers | null;
    columns: { name: string; type: 'number' | 'text'; values: (number | string | null)[] }[];
}

/** As the backend sends them and the project file keeps them: plain lists, null for a missing number. */
export interface SavedDrillholes {
    collar: { hole: string[]; x: SavedNumbers; y: SavedNumbers; z: SavedNumbers };
    survey: { hole: string[]; depth: SavedNumbers; dip: SavedNumbers; azimuth: SavedNumbers };
    tables?: SavedHoleTable[];
}

function numbers(values: unknown, n: number): Float64Array {
    const out = new Float64Array(n).fill(NaN);
    if (Array.isArray(values)) {
        for (let i = 0; i < n; i++) {
            const v = values[i];
            if (typeof v === 'number' && Number.isFinite(v)) out[i] = v;
        }
    }
    return out;
}

const names = (values: unknown): string[] | null =>
    Array.isArray(values) ? values.map(v => (v === null || v === undefined ? '' : String(v).trim())) : null;

/**
 * A logged table from what was saved or sent, whatever state it is in. Null
 * when it has no rows or no depths. `id` and `name` are used where what was
 * sent has none (the backend sends neither).
 */
export function readHoleTable(saved: unknown, id = '', name = ''): HoleTable | null {
    const s = saved as Partial<SavedHoleTable> | null | undefined;
    const hole = names(s?.hole);
    if (!hole || hole.length === 0 || !Array.isArray(s!.from)) return null;
    const n = hole.length;
    const columns: TableColumn[] = [];
    const seen = new Set<string>();
    for (const c of Array.isArray(s!.columns) ? s!.columns : []) {
        if (!c || typeof c.name !== 'string' || !c.name || seen.has(c.name) || !Array.isArray(c.values)) continue;
        seen.add(c.name);
        if (c.type === 'number') columns.push({ name: c.name, values: numbers(c.values, n) });
        else {
            const values = new Array<string>(n);
            for (let i = 0; i < n; i++) {
                const v = c.values[i];
                values[i] = v === null || v === undefined ? '' : String(v).trim();
            }
            columns.push({ name: c.name, values });
        }
    }
    return {
        id: typeof s!.id === 'string' && s!.id ? s!.id : id,
        name: typeof s!.name === 'string' && s!.name.trim() ? s!.name.trim() : name,
        hole,
        from: numbers(s!.from, n),
        to: Array.isArray(s!.to) ? numbers(s!.to, n) : null,
        columns,
    };
}

/**
 * Drillhole tables from what was saved or sent, whatever state it is in.
 * Null when there is nothing usable (no collars, or a table is missing).
 */
export function readDrillholes(saved: unknown): DrillholeDb | null {
    const s = saved as Partial<SavedDrillholes> | null | undefined;
    const collarHole = names(s?.collar?.hole);
    const surveyHole = names(s?.survey?.hole);
    if (!collarHole || !surveyHole || collarHole.length === 0) return null;
    const c = s!.collar!;
    const v = s!.survey!;
    return {
        collar: {
            hole: collarHole,
            x: numbers(c.x, collarHole.length),
            y: numbers(c.y, collarHole.length),
            z: numbers(c.z, collarHole.length),
        },
        survey: {
            hole: surveyHole,
            depth: numbers(v.depth, surveyHole.length),
            dip: numbers(v.dip, surveyHole.length),
            azimuth: numbers(v.azimuth, surveyHole.length),
        },
        tables: readTables(s!.tables),
    };
}

function readTables(saved: unknown): HoleTable[] {
    const out: HoleTable[] = [];
    const ids = new Set<string>();
    for (const one of Array.isArray(saved) ? saved : []) {
        const table = readHoleTable(one);
        // A table with no id cannot be told from another: it is given one
        if (!table) continue;
        let id = table.id || `table-${out.length + 1}`;
        while (ids.has(id)) id += '-';
        ids.add(id);
        out.push({ ...table, id, name: table.name || `Table ${out.length + 1}` });
    }
    return out;
}

function saveHoleTable(table: HoleTable): SavedHoleTable {
    return {
        id: table.id,
        name: table.name,
        hole: table.hole.slice(),
        from: listed(table.from),
        to: table.to ? listed(table.to) : null,
        columns: table.columns.map(c => (c.values instanceof Float64Array
            ? { name: c.name, type: 'number' as const, values: listed(c.values) }
            : { name: c.name, type: 'text' as const, values: c.values.map(v => (v === '' ? null : v)) })),
    };
}

function listed(values: Float64Array): SavedNumbers {
    return Array.from(values, v => (Number.isFinite(v) ? v : null));
}

/** The tables as plain lists for the project file. */
export function saveDrillholes(db: DrillholeDb): SavedDrillholes {
    return {
        collar: { hole: db.collar.hole.slice(), x: listed(db.collar.x), y: listed(db.collar.y), z: listed(db.collar.z) },
        survey: {
            hole: db.survey.hole.slice(), depth: listed(db.survey.depth), dip: listed(db.survey.dip),
            azimuth: listed(db.survey.azimuth),
        },
        ...(db.tables.length ? { tables: db.tables.map(saveHoleTable) } : {}),
    };
}

/**
 * The path of every hole that has a collar and a usable survey, by hole name.
 * The first collar of a name is the one used; a collar with no RL is at 0
 * (as the import puts it).
 */
export function buildTraces(db: DrillholeDb): Map<string, HoleTrace> {
    const stations = new Map<string, Partial<SurveyStation>[]>();
    const { survey, collar } = db;
    for (let i = 0; i < survey.hole.length; i++) {
        let list = stations.get(survey.hole[i]);
        if (!list) stations.set(survey.hole[i], list = []);
        list.push({ depth: survey.depth[i], dip: survey.dip[i], azimuth: survey.azimuth[i] });
    }
    const traces = new Map<string, HoleTrace>();
    for (let i = 0; i < collar.hole.length; i++) {
        const hole = collar.hole[i];
        if (!hole || traces.has(hole)) continue;
        if (!Number.isFinite(collar.x[i]) || !Number.isFinite(collar.y[i])) continue;
        const at: Vec3 = [collar.x[i], collar.y[i], Number.isFinite(collar.z[i]) ? collar.z[i] : 0];
        const trace = traceHole(at, cleanStations(stations.get(hole) ?? []));
        if (trace) traces.set(hole, trace);
    }
    return traces;
}

/** Where a hole is at a depth; null for a hole with no path. */
export function holePosition(traces: ReadonlyMap<string, HoleTrace>, hole: string, depth: number): Vec3 | null {
    const trace = traces.get(hole);
    return trace && Number.isFinite(depth) ? positionAt(trace, depth) : null;
}

/** Samples as a set of coordinate columns has them: their hole, their interval and their place */
export interface SamplePlaces {
    hole: ArrayLike<unknown>;
    from: ArrayLike<number>;
    to: ArrayLike<number> | null;
    x: ArrayLike<number>;
    y: ArrayLike<number>;
    z: ArrayLike<number>;
}

/** A path fits when it puts a hole's samples within this of where the coordinates have them, m */
export const MATCH_M = 0.25;

/**
 * The hole paths that fit a set of coordinates: those that put the middle of
 * the hole's first, middle and last sample where the coordinates have it.
 *
 * The paths are in the coordinates the holes were desurveyed in. A view or a
 * scene may be looking at other columns (a local grid, coordinates that were
 * edited or re-projected), and the paths say nothing about those: a hole whose
 * path does not fit is left out, and what reads the paths falls back on the
 * samples themselves. Needs a To column (a sample's place is its middle).
 */
export function tracesMatching(
    traces: ReadonlyMap<string, HoleTrace>,
    samples: SamplePlaces,
    tolerance = MATCH_M,
): Map<string, HoleTrace> {
    return checkTraces(traces, samples, tolerance).fit;
}

/**
 * The hole paths that can be used with a set of coordinates, for holes that
 * may have no sample in them at all (a hole that was logged and never
 * assayed). Where the paths fit the samples of at least half the holes that
 * have both, the coordinates are the ones the holes were desurveyed in, and
 * every path is used but those that do not fit their own samples. Otherwise
 * none is.
 */
export function tracesInCoordinates(
    traces: ReadonlyMap<string, HoleTrace>,
    samples: SamplePlaces | null,
    tolerance = MATCH_M,
): ReadonlyMap<string, HoleTrace> {
    if (!samples) return new Map();
    const { fit, missed } = checkTraces(traces, samples, tolerance);
    if (fit.size === 0 || fit.size < missed.size) return new Map();
    if (missed.size === 0) return traces;
    const out = new Map<string, HoleTrace>();
    for (const [id, trace] of traces) if (!missed.has(id)) out.set(id, trace);
    return out;
}

function checkTraces(
    traces: ReadonlyMap<string, HoleTrace>,
    samples: SamplePlaces,
    tolerance: number,
): { fit: Map<string, HoleTrace>; missed: Set<string> } {
    const out = new Map<string, HoleTrace>();
    const missed = new Set<string>();
    const { hole, from, to, x, y, z } = samples;
    if (traces.size === 0 || !to) return { fit: out, missed };
    const rows = new Map<string, number[]>();
    for (let i = 0; i < from.length; i++) {
        const h = hole[i];
        if (h === null || h === undefined || h === '') continue;
        const id = String(h).trim();
        if (!traces.has(id)) continue;
        if (!Number.isFinite(from[i]) || !Number.isFinite(to[i]) || !Number.isFinite(x[i]) || !Number.isFinite(y[i]) || !Number.isFinite(z[i])) continue;
        const list = rows.get(id);
        if (list) list.push(i);
        else rows.set(id, [i]);
    }
    for (const [id, list] of rows) {
        const trace = traces.get(id)!;
        const fits = [list[0], list[list.length >> 1], list[list.length - 1]].every(i => {
            const p = positionAt(trace, (from[i] + to[i]) / 2);
            return Math.hypot(p[0] - x[i], p[1] - y[i], p[2] - z[i]) <= tolerance;
        });
        if (fits) out.set(id, trace);
        else missed.add(id);
    }
    return { fit: out, missed };
}

/**
 * Where each row of a logged table is: the middle of its interval (its depth,
 * for a depth point or a row with no end), on its hole's path. NaN for a row
 * whose hole has no path.
 */
export function tablePlaces(table: HoleTable, traces: ReadonlyMap<string, HoleTrace>): { x: Float64Array; y: Float64Array; z: Float64Array } {
    const n = table.hole.length;
    const x = new Float64Array(n).fill(NaN), y = new Float64Array(n).fill(NaN), z = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i++) {
        const trace = traces.get(table.hole[i]);
        const from = table.from[i];
        if (!trace || !Number.isFinite(from)) continue;
        const to = table.to ? table.to[i] : NaN;
        const p = positionAt(trace, Number.isFinite(to) && to > from ? (from + to) / 2 : from);
        x[i] = p[0];
        y[i] = p[1];
        z[i] = p[2];
    }
    return { x, y, z };
}

/** A table's column as text ('' for none): numbers as they would be typed. */
export function tableText(table: HoleTable, column: string): string[] | null {
    const values = table.columns.find(c => c.name === column)?.values;
    if (!values) return null;
    if (!(values instanceof Float64Array)) return values;
    const out = new Array<string>(values.length);
    for (let i = 0; i < values.length; i++) out[i] = Number.isFinite(values[i]) ? String(values[i]) : '';
    return out;
}

/** How many holes have a collar, and how many of those have a path. */
export function drillholeCounts(db: DrillholeDb, traces: ReadonlyMap<string, HoleTrace>): { collars: number; traced: number } {
    return { collars: new Set(db.collar.hole.filter(Boolean)).size, traced: traces.size };
}

/** How many holes a logged table has rows in, and how many of those have a path to place them on. */
export function tableCoverage(table: HoleTable, traces: ReadonlyMap<string, HoleTrace>): { holes: number; placed: number } {
    const holes = new Set(table.hole.filter(Boolean));
    let placed = 0;
    for (const hole of holes) if (traces.has(hole)) placed++;
    return { holes: holes.size, placed };
}
