/**
 * What the views do to the scene's model units (store glue; the maths is in
 * units.ts): make a map from logging columns, take in codes logged since,
 * put the units in order down the holes, and give samples selected in a view
 * to a unit.
 */
import { useAppStore } from '../../store/appStore';
import { holeTable } from '../../store/drillholeStore';
import { useModelStore } from '../../store/modelStore';
import { loggedRuns, thinnestUnit, type LoggedRuns } from './contactMatrix';
import { layerCheck, type UnitLie } from './layerCheck';
import { holePositions, unitCodes, unitLog } from './logging';
import type { GeoModel, SceneCoords, UnitMap } from './types';
import { occurrenceUnits, tagOccurrences } from './occurrences';
import { addCodes, carryReassigned, cleanedStretches, codeStats, intervalEnds, MAX_REASSIGNED, orderDownHoles, reassign, rowStretches, unitIntervalCounts, unitsFromCodes, unitsOfRows, type Cleaned, type CodeStats } from './units';

/** The coordinates the scene's surfaces are in, else these */
const sceneCoords = (coords: SceneCoords | null): SceneCoords | null => useModelStore.getState().scene.coords ?? coords;

/** The codes a map's columns hold, in order down the holes, with how many intervals each (null: a column is not there) */
export function mapCodeStats(coords: SceneCoords | null, map: Pick<UnitMap, 'table' | 'columns'>): CodeStats[] | null {
    const codes = unitCodes(sceneCoords(coords), map);
    return codes ? codeStats(codes) : null;
}

/** How many intervals each unit of a map has now (codes grouped, stretches given by hand, short stretches cleaned), in the map's order. Null: a column is not there. */
export function mapUnitCounts(coords: SceneCoords | null, map: UnitMap): { unit: string; count: number }[] | null {
    const codes = unitCodes(sceneCoords(coords), map);
    return codes ? unitIntervalCounts(unitsOfRows(codes, map), map) : null;
}

/** What the cleaning of a map's short stretches changes, unit by unit (units.ts `cleanedStretches`). Null: a column is not there. */
export function mapCleaned(coords: SceneCoords | null, map: UnitMap): Cleaned[] | null {
    const codes = unitCodes(sceneCoords(coords), map);
    return codes ? cleanedStretches(codes, map) : null;
}

/** The usual length of a logged interval of a map's logging, m (the median; null: nothing to tell from) */
export function mapUsualInterval(coords: SceneCoords | null, map: Pick<UnitMap, 'table' | 'columns'>): number | null {
    const codes = unitCodes(sceneCoords(coords), map);
    if (!codes) return null;
    const end = intervalEnds(codes.hole, codes.from, codes.to);
    const lengths: number[] = [];
    for (let i = 0; i < end.length; i++) if (codes.code[i] && end[i] > codes.from[i]) lengths.push(end[i] - codes.from[i]);
    if (lengths.length === 0) return null;
    lengths.sort((a, b) => a - b);
    return lengths[lengths.length >> 1];
}

/**
 * How the units of a map lie down the holes, taken as layers (layerCheck):
 * only the units of `layers` are looked at, the others passed over as
 * bodies of their own. Null: a column is not there.
 */
export function mapLayerCheck(coords: SceneCoords | null, map: UnitMap, layers: ReadonlySet<string>): UnitLie[] | null {
    const codes = unitCodes(sceneCoords(coords), map);
    if (!codes) return null;
    const units = unitsOfRows(codes, map);
    return layerCheck({ hole: codes.hole, from: codes.from, to: codes.to, unit: units.map(u => (layers.has(u) ? u : '')) });
}

/**
 * The runs of a map's units down every hole (contactMatrix.ts): what its
 * chronology is proposed from, as the model reads the logging (`raw`: as
 * logged, nothing cleaned: what a model is held against). With the holes'
 * places known, a hole that climbs is read from its top. Null: a column is
 * not there.
 */
export function mapRuns(coords: SceneCoords | null, map: UnitMap, raw = false): LoggedRuns | null {
    const names = map.units.map(u => u.name);
    const placed = unitLog(sceneCoords(coords), map, raw);
    if (placed) return loggedRuns(placed, names);
    const codes = unitCodes(sceneCoords(coords), map);
    return codes ? loggedRuns({ ...codes, code: unitsOfRows(codes, map, raw) }, names) : null;
}

// The last answer for each grouping, and what it was worked out from
const thinnestOf = new WeakMap<UnitMap, { data: unknown; table: unknown; coords: unknown; units: string; found: { unit: string; usual: number } | null }>();

/**
 * The thinnest of a model's units as logged (its stretches down the holes,
 * as the model reads the logging), and how thick it usually is: what the
 * model's resolution is worked out from when none is set. Null: the model
 * reads no logging, or too little to tell from.
 */
export function modelThinnest(model: Pick<GeoModel, 'unitMap'>, units: readonly string[]): { unit: string; usual: number } | null {
    const scene = useModelStore.getState().scene;
    const map = scene.unitMaps?.find(m => m.id === model.unitMap);
    if (!map) return null;
    const data = useAppStore.getState().columnarData, table = map.table ? holeTable(map.table) : null, coords = scene.coords;
    const key = units.join('\n');
    const had = thinnestOf.get(map);
    if (had && had.data === data && had.table === table && had.coords === coords && had.units === key) return had.found;
    const codes = unitCodes(coords, map);
    const found = codes ? thinnestUnit(loggedRuns({ ...codes, code: unitsOfRows(codes, map) }, map.units.map(u => u.name)), new Set(units)) : null;
    thinnestOf.set(map, { data, table, coords, units: key, found });
    return found;
}

/** A new map with every code its own unit, in order down the holes. Its id, or null when there is nothing to make it from. */
export function newUnitMap(coords: SceneCoords | null, source: { table?: string; columns: string[]; name?: string }): string | null {
    const stats = mapCodeStats(coords, source);
    if (!stats || stats.length === 0) return null;
    return useModelStore.getState().addUnitMap({ ...source, units: unitsFromCodes(stats) });
}

/** Codes logged that are in no unit of the map made units of their own. How many were added. */
export function addLoggedCodes(coords: SceneCoords | null, mapId: string): number {
    const map = useModelStore.getState().scene.unitMaps?.find(m => m.id === mapId);
    const stats = map ? mapCodeStats(coords, map) : null;
    if (!map || !stats) return 0;
    const units = addCodes(map.units, stats.map(s => s.code));
    if (units.length === map.units.length) return 0;
    useModelStore.getState().regroupUnits(mapId, { units, carry: {} });
    return units.length - map.units.length;
}

/** The map's units put in order down the holes, their colours following. */
export function orderUnitsDownHoles(coords: SceneCoords | null, mapId: string): void {
    const map = useModelStore.getState().scene.unitMaps?.find(m => m.id === mapId);
    const stats = map ? mapCodeStats(coords, map) : null;
    if (map && stats) useModelStore.getState().updateUnitMap(mapId, { units: orderDownHoles(map.units, stats) });
}

/**
 * Samples of the dataset (rows, as selected in a view) given to a unit of a
 * map ('' = as if not logged; null = back as logged): the stretches of hole
 * they cover. Every interval of the map's logging whose middle is in one of
 * them is of the unit, so it works for a map read from a logging table too.
 * How many stretches were given (0: the samples are in no hole).
 */
export function reassignRows(coords: SceneCoords | null, mapId: string, rows: readonly number[], unit: string | null): number {
    const at = holePositions(sceneCoords(coords));
    if (!at || rows.length === 0) return 0;
    const stretches = rowStretches(rows, at);
    if (stretches.length) useModelStore.getState().reassignUnits(mapId, stretches, unit);
    return stretches.length;
}

export type SplitOccurrences = { ok: true; units: Record<string, string[]>; given: number; moved: number } | { ok: false; reason: string };

/**
 * The units of a map that are in `pile` several times made a unit for each
 * occurrence, and every stretch of them given to the occurrence it is
 * (`tagOccurrences`: hole by hole, then against where the holes round it
 * have the contacts). The codes stay with the occurrence that holds the
 * most; the stretches of the others are given to them as stretches are
 * given to a unit by hand, so any of them can be given to another the same
 * way afterwards, and nothing gives them back. One step to undo.
 */
export function splitMapOccurrences(coords: SceneCoords | null, mapId: string, pile: readonly string[]): SplitOccurrences {
    const at = sceneCoords(coords);
    const map = useModelStore.getState().scene.unitMaps?.find(m => m.id === mapId);
    const log = map ? unitLog(at, map) : null, codes = map ? unitCodes(at, map) : null;
    if (!map || !log || !codes) return { ok: false, reason: 'The logging of these lithologies is not there to read.' };
    const tags = tagOccurrences(log, pile);
    const end = intervalEnds(log.hole, log.from, log.to);
    const metres = new Float64Array(pile.length);
    for (let i = 0; i < tags.slot.length; i++) if (tags.slot[i] >= 0 && end[i] > log.from[i]) metres[tags.slot[i]] += end[i] - log.from[i];
    const made = occurrenceUnits(map.units, pile, metres);
    if (!made) return { ok: false, reason: 'No unit is there several times, or a lithology already has the name one of them would be given.' };
    // What each row would be with the units made and nothing given: the rows that are another occurrence are given to it
    const next = { units: made.regrouped.units, reassigned: carryReassigned(map.reassigned, made.regrouped) };
    const now = unitsOfRows(codes, next, true);
    const rows = new Map<string, number[]>();
    for (let i = 0; i < tags.slot.length; i++) {
        const s = tags.slot[i];
        // (Only a row that is the unit as logged: one read as it by the cleaning of short stretches stays what it is logged as)
        if (s < 0 || now[i] === made.names[s] || !made.regrouped.carry[pile[s]]?.includes(now[i])) continue;
        let list = rows.get(made.names[s]);
        if (!list) rows.set(made.names[s], list = []);
        list.push(i);
    }
    const given = [...rows].map(([unit, list]) => ({ unit, stretches: rowStretches(list, log) }));
    // (The list of stretches given by hand has a limit: over it, nothing is given)
    let all = next.reassigned, count = 0;
    for (const g of given) { count += g.stretches.length; all = reassign(all, g.stretches, g.unit); }
    if (count > 0 && all.length === next.reassigned.length && count + next.reassigned.length > MAX_REASSIGNED) {
        return { ok: false, reason: `That gives ${count.toLocaleString()} stretches to a unit, and a set of lithologies holds ${MAX_REASSIGNED.toLocaleString()} given by hand.` };
    }
    useModelStore.getState().regroupUnits(mapId, made.regrouped, given);
    return { ok: true, units: made.regrouped.carry, given: count, moved: tags.moved };
}
