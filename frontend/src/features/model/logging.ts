/**
 * The drillhole logging, as the surface modelling reads it: the holes'
 * intervals with a logged unit each, and what units a column holds.
 *
 * Logging comes from one of two places. A column of the dataset is logging
 * as it was merged onto the samples: one unit to a sample, placed at the
 * sample. A table logged down the holes (the project's drillhole tables) is
 * the logging itself: every interval as it was logged, placed by its own
 * depths on the hole's path, whether the hole was sampled there or not.
 */
import { useAppStore } from '../../store/appStore';
import { holeTable, holeTraces, useDrillholeStore } from '../../store/drillholeStore';
import { useModelStore } from '../../store/modelStore';
import { guessAxisColumn, guessFromColumn, guessHoleColumn, guessToColumn } from '../plots/viewer3d/coordinateColumns';
import type { HolePositions } from './collars';
import type { HoleLog } from './contacts';
import { positionAt, type HoleTrace } from './desurvey';
import { tablePlaces, tableText, tracesInCoordinates } from './drillholes';
import type { ShellSamples } from './shell';
import type { SceneCoords, UnitMap } from './types';
import { applyUnits, codesOf, looksLikeCodes } from './units';

/** A column's values as text ('' = none), whatever it is stored as. */
function textColumn(name: string | null): string[] | null {
    if (!name) return null;
    const column = useAppStore.getState().getRawColumn(name);
    if (!column) return null;
    if (!(column instanceof Float64Array)) return column;
    const out = new Array<string>(column.length);
    for (let i = 0; i < column.length; i++) out[i] = Number.isFinite(column[i]) ? String(column[i]) : '';
    return out;
}

/**
 * The columns the model is in, with no view asked: the scene's coordinate
 * columns once something has been made in it, and until then the ones a new
 * 3D view starts on (the East, North and Elevation roles, then the names);
 * the hole and interval columns as a view finds them. What a view gives
 * (`ViewActions.coords`) is the same thing for the columns that view shows:
 * this is for making and reading objects when no view is open.
 * Null: there are not three columns to place anything by.
 */
export function defaultCoords(): SceneCoords | null {
    const columns = useAppStore.getState().columns;
    const scene = useModelStore.getState().scene.coords;
    const has = (name: string | null | undefined) => !!name && columns.some(c => c.name === name);
    // (Scene columns that are no longer in the dataset place nothing: the guesses stand in)
    const [x, y, z] = scene && has(scene.x) && has(scene.y) && has(scene.z)
        ? [scene.x, scene.y, scene.z]
        : [guessAxisColumn(columns, 'x'), guessAxisColumn(columns, 'y'), guessAxisColumn(columns, 'z')];
    if (!x || !y || !z || new Set([x, y, z]).size < 3) return null;
    // (The hole and interval columns the scene was made with stand while they are in the dataset)
    const kept = (name: string | null | undefined, guess: () => string | null) => (scene && has(name) ? name! : guess());
    return { x, y, z, hole: kept(scene?.hole, () => guessHoleColumn(columns)), from: kept(scene?.from, () => guessFromColumn(columns)), to: kept(scene?.to, () => guessToColumn(columns)) };
}

/**
 * Why contacts cannot be found in these coordinates (null: they can).
 * `table`: the logging is a table logged down the holes, which is placed by
 * the holes' own paths.
 */
export function loggingProblem(coords: SceneCoords | null, table: string | null = null): string | null {
    if (!coords) return 'Surfaces need East, North and Elevation columns.';
    if (table) {
        if (!holeTable(table)) return 'The logging table is no longer in this project.';
        if (pathsFor(coords).size === 0) return 'A logging table is placed by the paths of the holes, and they are not in the coordinates of this view. Use the coordinate columns the drillhole import made.';
        return null;
    }
    if (!coords.hole) return 'This needs a hole ID column, to follow the logging down each hole.';
    if (!coords.from) return 'This needs a From column, to follow the logging down each hole.';
    return null;
}

/**
 * The paths of the project's holes, where they are in these coordinates
 * (they are checked against the samples: `tracesInCoordinates`). Empty when
 * they are not, or the project has none.
 */
export function pathsFor(coords: SceneCoords | null): ReadonlyMap<string, HoleTrace> {
    const traces = holeTraces();
    return traces.size ? tracesInCoordinates(traces, holePositions(coords)) : traces;
}

/** The tables logged down the holes that hold intervals (logging), in the order they were added. */
export function loggingTables(): { id: string; name: string; rows: number }[] {
    return (useDrillholeStore.getState().db?.tables ?? []).filter(t => t.to).map(t => ({ id: t.id, name: t.name, rows: t.hole.length }));
}

/** The samples' holes, depths and places. Null when a column it needs is not there. */
export function holePositions(coords: SceneCoords | null): HolePositions | null {
    if (!coords || !coords.hole || !coords.from) return null;
    const app = useAppStore.getState();
    const x = app.getNumericColumn(coords.x), y = app.getNumericColumn(coords.y), z = app.getNumericColumn(coords.z);
    const from = app.getNumericColumn(coords.from);
    const hole = textColumn(coords.hole);
    if (!x || !y || !z || !from || !hole) return null;
    return { hole, from, to: (coords.to && app.getNumericColumn(coords.to)) || null, x, y, z };
}

/**
 * The holes' intervals and a logging column's unit in each. Null when a
 * column it needs is not there. With `table`, the intervals are those of a
 * table logged down the holes, placed on the holes' paths.
 */
export function holeLog(coords: SceneCoords | null, column: string, table: string | null = null): HoleLog | null {
    if (table) {
        const logged = holeTable(table);
        const code = logged && tableText(logged, column);
        if (!coords || !logged || !logged.to || !code) return null;
        const traces = pathsFor(coords);
        if (traces.size === 0) return null;
        const placeAt = (row: number, depth: number) => {
            const trace = traces.get(logged.hole[row]);
            return trace ? positionAt(trace, depth) : null;
        };
        return { hole: logged.hole, from: logged.from, to: logged.to, ...tablePlaces(logged, traces), code, placeAt };
    }
    if (!coords || !coords.hole || !coords.from) return null;
    const app = useAppStore.getState();
    const x = app.getNumericColumn(coords.x), y = app.getNumericColumn(coords.y), z = app.getNumericColumn(coords.z);
    const from = app.getNumericColumn(coords.from);
    const hole = textColumn(coords.hole), code = textColumn(column);
    if (!x || !y || !z || !from || !hole || !code) return null;
    return { hole, from, to: (coords.to && app.getNumericColumn(coords.to)) || null, x, y, z, code };
}

/** The values of logging columns as text, row by row (of the dataset, or of a table logged down the holes). Null when one is not there. */
function loggingText(columns: readonly string[], table: string | null): ArrayLike<string | null | undefined>[] | null {
    const logged = table ? holeTable(table) : null;
    if (table && !logged) return null;
    const out: ArrayLike<string | null | undefined>[] = [];
    for (const c of columns) {
        const values = logged ? tableText(logged, c) : textColumn(c);
        if (!values) return null;
        out.push(values);
    }
    return out;
}

/** The holes, depths and codes of a unit map's logging, without places: what its units are made from. Null when a column it needs is not there. */
export function unitCodes(coords: SceneCoords | null, map: Pick<UnitMap, 'table' | 'columns'>): { hole: ArrayLike<string | null | undefined>; from: ArrayLike<number>; to: ArrayLike<number> | null; code: string[] } | null {
    const text = loggingText(map.columns, map.table ?? null);
    if (!text) return null;
    if (map.table) {
        const logged = holeTable(map.table)!;
        return logged.to ? { hole: logged.hole, from: logged.from, to: logged.to, code: codesOf(text) } : null;
    }
    if (!coords?.hole || !coords.from) return null;
    const app = useAppStore.getState();
    const hole = textColumn(coords.hole), from = app.getNumericColumn(coords.from);
    if (!hole || !from) return null;
    return { hole, from, to: (coords.to && app.getNumericColumn(coords.to)) || null, code: codesOf(text) };
}

/**
 * The holes' intervals and the unit of a unit map in each (its codes grouped,
 * and the stretches given to units by hand): what a surface that reads the
 * map is built from, with the short stretches of its cleaned units read as
 * the unit round them or left out (`raw`: as logged, nothing cleaned: what a
 * model is checked against). Null when a column it needs is not there.
 */
export function unitLog(coords: SceneCoords | null, map: UnitMap, raw = false): HoleLog | null {
    const log = map.columns.length ? holeLog(coords, map.columns[0], map.table ?? null) : null;
    const text = log && loggingText(map.columns, map.table ?? null);
    return log && text ? applyUnits({ ...log, code: codesOf(text) }, map, raw) : null;
}

/**
 * A column of numbers at the samples' places, down the holes where the hole
 * and depth columns are known: what a shell is built from. The values are
 * the analytical ones (below-detection results substituted, never the
 * stored negative). Null when the column or a coordinate column is not there.
 */
export function shellSamples(coords: SceneCoords | null, column: string): ShellSamples | null {
    if (!coords) return null;
    const app = useAppStore.getState();
    const x = app.getNumericColumn(coords.x), y = app.getNumericColumn(coords.y), z = app.getNumericColumn(coords.z);
    const value = app.getNumericColumn(column);
    if (!x || !y || !z || !value) return null;
    const hole = textColumn(coords.hole), from = (coords.from && app.getNumericColumn(coords.from)) || null;
    return { hole: from ? hole : null, from: hole ? from : null, to: (coords.to && app.getNumericColumn(coords.to)) || null, x, y, z, value };
}

const NUMBERS = new Set(['numeric', 'float', 'integer']);

/** Columns a shell can be put round: numbers that are not the coordinates or depths. */
export function shellColumns(coords: SceneCoords | null): string[] {
    const skip = new Set([coords?.hole, coords?.from, coords?.to, coords?.x, coords?.y, coords?.z]);
    return useAppStore.getState().columns.filter(c => NUMBERS.has(c.type) && !skip.has(c.name) && c.role !== 'ID' && c.role !== 'HoleID').map(c => c.name);
}

/**
 * Columns that can hold logging: text and categories, and numbers that are a
 * few whole-number codes. With `table`, those of a table logged down the holes.
 */
export function loggingColumns(coords: SceneCoords | null, table: string | null = null): string[] {
    if (table) {
        return (holeTable(table)?.columns ?? []).filter(c => !(c.values instanceof Float64Array) || looksLikeCodes(c.values)).map(c => c.name);
    }
    const app = useAppStore.getState();
    const skip = new Set([coords?.hole, coords?.from, coords?.to, coords?.x, coords?.y, coords?.z]);
    return app.columns
        .filter(c => {
            if (skip.has(c.name) || c.role === 'ID' || c.role === 'HoleID') return false;
            const column = app.getRawColumn(c.name);
            return !!column && (!(column instanceof Float64Array) || looksLikeCodes(column));
        })
        .map(c => c.name);
}

/** The units in a logging column (of the dataset, or of a table logged down the holes) with the number of intervals of each, most first. */
export function unitCounts(column: string, table: string | null = null): { unit: string; count: number }[] {
    const logged = table ? holeTable(table) : null;
    const values = table ? logged && tableText(logged, column) : textColumn(column);
    if (!values) return [];
    const counts = new Map<string, number>();
    for (const v of values) {
        const unit = (v ?? '').trim();
        if (unit) counts.set(unit, (counts.get(unit) ?? 0) + 1);
    }
    return [...counts].map(([unit, count]) => ({ unit, count })).sort((p, q) => q.count - p.count || p.unit.localeCompare(q.unit));
}
