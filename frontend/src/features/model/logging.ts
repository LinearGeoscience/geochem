/**
 * The dataset's drillhole logging, as the surface modelling reads it: the
 * holes' intervals with a logged unit each, and what units a column holds.
 */
import { useAppStore } from '../../store/appStore';
import type { HolePositions } from './collars';
import type { HoleLog } from './contacts';
import type { ShellSamples } from './shell';
import type { SceneCoords } from './types';

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

/** Why contacts cannot be found in these coordinates (null: they can). */
export function loggingProblem(coords: SceneCoords | null): string | null {
    if (!coords) return 'Surfaces need East, North and Elevation columns.';
    if (!coords.hole) return 'This needs a hole ID column, to follow the logging down each hole.';
    if (!coords.from) return 'This needs a From column, to follow the logging down each hole.';
    return null;
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

/** The holes' intervals and a logging column's unit in each. Null when a column it needs is not there. */
export function holeLog(coords: SceneCoords | null, column: string): HoleLog | null {
    if (!coords || !coords.hole || !coords.from) return null;
    const app = useAppStore.getState();
    const x = app.getNumericColumn(coords.x), y = app.getNumericColumn(coords.y), z = app.getNumericColumn(coords.z);
    const from = app.getNumericColumn(coords.from);
    const hole = textColumn(coords.hole), code = textColumn(column);
    if (!x || !y || !z || !from || !hole || !code) return null;
    return { hole, from, to: (coords.to && app.getNumericColumn(coords.to)) || null, x, y, z, code };
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

/** A column of numbers is offered as logging when it holds no more than this many different whole numbers (codes) */
const MAX_CODES = 25;

/** Whole-number codes, a few of them: logging kept as numbers (weathering 1 to 5). Measurements fail this at once. */
function looksLikeCodes(values: Float64Array): boolean {
    const seen = new Set<number>();
    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (!Number.isFinite(v)) continue;
        if (!Number.isInteger(v)) return false;
        if (!seen.has(v)) {
            seen.add(v);
            if (seen.size > MAX_CODES) return false;
        }
    }
    return seen.size > 1;
}

/** Columns that can hold logging: text and categories, and numbers that are a few whole-number codes. */
export function loggingColumns(coords: SceneCoords | null): string[] {
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

/** The units in a logging column with the number of intervals of each, most first. */
export function unitCounts(column: string): { unit: string; count: number }[] {
    const values = textColumn(column);
    if (!values) return [];
    const counts = new Map<string, number>();
    for (const v of values) {
        const unit = (v ?? '').trim();
        if (unit) counts.set(unit, (counts.get(unit) ?? 0) + 1);
    }
    return [...counts].map(([unit, count]) => ({ unit, count })).sort((p, q) => q.count - p.count || p.unit.localeCompare(q.unit));
}
