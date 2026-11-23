/**
 * The logging tables a 3D view draws (features/model/loggingDisplay): those
 * it is told to (its `shownTables`, through what it hides), each coloured as
 * the view says (`logColours`, by table id) and as wide as it says
 * (`logWidth`, m; null: as wide as the samples' cylinders are at first, or
 * from the size of the data).
 *
 * They are placed by the holes' own paths where those are in the view's
 * coordinates (checked against the samples), so a hole that was logged but
 * never sampled is drawn as well.
 */
import { useMemo } from 'react';
import { usePlotSetting } from '../../../hooks/usePlotSetting';
import { useAnalyticalStore, useAppStore } from '../../../store/appStore';
import { useAttributeStore, type AttributeConfig } from '../../../store/attributeStore';
import { useDrillholeStore, useHoleTraces } from '../../../store/drillholeStore';
import { useModelStore } from '../../../store/modelStore';
import { isNumericColumn } from '../../../types/columnarData';
import type { HoleTrace } from '../../model/desurvey';
import { tracesInCoordinates, type HoleTable } from '../../model/drillholes';
import { colourLog, colouringOf, piecesColours, placeLogged, type LoggedPieces, type LogLegend, type SampleClasses } from '../../model/loggingDisplay';
import { keys } from '../../model/objectKeys';
import type { UnitMap } from '../../model/types';
import { guessFromColumn, guessHoleColumn, guessToColumn } from './coordinateColumns';
import type { PointCloudGeometry } from './geometry';

/** The plot setting: what each table is coloured by in the view (`units:<map id>` or `column:<name>`, by table id) */
export const LOG_COLOURS_SETTING = 'logColours';
/** The plot setting: how wide the logging is drawn, m (null: automatic) */
export const LOG_WIDTH_SETTING = 'logWidth';

/** One table as a view draws it */
export interface LoggingLayer {
    id: string;
    name: string;
    pieces: LoggedPieces;
    /** rgba of each piece */
    rgba: Float32Array;
    /** rgba of each row of the table */
    rowRgba: Float32Array;
    legend: LogLegend;
    /** Width drawn, m */
    width: number;
    /** The width worked out for it, m */
    auto: number;
}

export interface LoggingLayers {
    layers: LoggingLayer[];
    /** Why tables the view is told to draw cannot be drawn (null: they are) */
    problem: string | null;
}

const NO_TRACES: ReadonlyMap<string, HoleTrace> = new Map();
const NO_MAPS: UnitMap[] = [];
const NO_COLOURS: Record<string, string> = {};
const NONE: LoggingLayers = { layers: [], problem: null };
export const NO_PATHS_HERE = 'The logging is placed by the paths of the holes, and they are not in the coordinates of this view. Use the coordinate columns the drillhole import made.';

/** The paths of the project's holes, where they are in a view's coordinates (holes with no samples included) */
export function useViewLoggingPaths(xAxis: string, yAxis: string, zAxis: string): ReadonlyMap<string, HoleTrace> {
    const store = useAnalyticalStore();
    const columns = useAppStore(s => s.columns);
    const traces = useHoleTraces();
    return useMemo(() => {
        if (traces.size === 0) return NO_TRACES;
        const numeric = (name: string | null) => {
            const col = name ? store.columns.get(name) : undefined;
            return col && isNumericColumn(col) ? col : null;
        };
        const holeCol = guessHoleColumn(columns);
        const hole = holeCol ? store.columns.get(holeCol) : undefined;
        const from = numeric(guessFromColumn(columns)), to = numeric(guessToColumn(columns));
        const x = numeric(xAxis), y = numeric(yAxis), z = numeric(zAxis);
        if (!hole || !from || !to || !x || !y || !z) return NO_TRACES;
        const fit = tracesInCoordinates(traces, { hole, from, to, x, y, z });
        return fit.size ? fit : NO_TRACES;
    }, [traces, store, columns, xAxis, yAxis, zAxis]);
}

/** The Attribute Manager's colour classes, as a logging table can take them (null: the samples are not coloured by a column) */
export function sampleClasses(color: AttributeConfig): SampleClasses | null {
    if (!color.field) return null;
    const classes = color.entries
        .filter(e => e.color && (e.type === 'category' || e.type === 'range'))
        .map(e => (e.type === 'category'
            ? { label: e.name, color: e.color!, values: e.categoryValues ?? (e.categoryValue !== undefined ? [e.categoryValue] : []) }
            : { label: e.name, color: e.color!, min: e.min, max: e.max }));
    return classes.length ? { field: color.field, classes } : null;
}

/** A table's pieces, worked out once for each table, set of paths and origin */
const placed = new WeakMap<HoleTable, { paths: ReadonlyMap<string, HoleTrace>; origin: ArrayLike<number>; pieces: LoggedPieces }>();
function piecesOf(table: HoleTable, paths: ReadonlyMap<string, HoleTrace>, origin: ArrayLike<number>): LoggedPieces {
    const hit = placed.get(table);
    if (hit && hit.paths === paths && hit.origin === origin) return hit.pieces;
    const pieces = placeLogged(table, paths, origin);
    placed.set(table, { paths, origin, pieces });
    return pieces;
}

/**
 * `samplesWidth`: the automatic width of the view's samples drawn as
 * cylinders (null: they have no intervals). The logging is as wide unless
 * the view says otherwise, whatever the length of its intervals.
 */
export function useLoggingLayers(
    plotId: string, geometry: PointCloudGeometry | null, hidden: ReadonlySet<string>, xAxis: string, yAxis: string, zAxis: string,
    samplesWidth: number | null,
): LoggingLayers {
    const db = useDrillholeStore(s => s.db);
    const maps = useModelStore(s => s.scene.unitMaps) ?? NO_MAPS;
    const paths = useViewLoggingPaths(xAxis, yAxis, zAxis);
    const [asked] = usePlotSetting<Record<string, string>>(plotId, LOG_COLOURS_SETTING, NO_COLOURS);
    const [savedWidth] = usePlotSetting<number | null>(plotId, LOG_WIDTH_SETTING, null);
    const colorConfig = useAttributeStore(s => s.color);
    // Changes to the colours of the samples matter only when they change the classes
    const samplesKey = useMemo(() => JSON.stringify(sampleClasses(colorConfig)), [colorConfig]);
    const shownKey = (db?.tables ?? []).filter(t => t.to && !hidden.has(keys.table(t.id))).map(t => t.id).join('\n');

    const coloured = useMemo(() => {
        const shown = (db?.tables ?? []).filter(t => t.to && shownKey.split('\n').includes(t.id));
        if (!geometry || shown.length === 0) return NONE;
        if (paths.size === 0) return { ...NONE, problem: NO_PATHS_HERE };
        const samples = JSON.parse(samplesKey) as SampleClasses | null;
        const b = geometry.bounds;
        const sceneRadius = 0.5 * Math.hypot(...b.max.map((v, k) => v - b.min[k]));
        const auto = samplesWidth ?? Number(Math.max(sceneRadius / 150, 0.01).toPrecision(2));
        const layers: LoggingLayer[] = [];
        for (const t of shown) {
            const pieces = piecesOf(t, paths, geometry.origin);
            const choice = colouringOf(t, maps, asked[t.id]);
            const colours = choice ? colourLog(t, choice, maps, samples) : null;
            if (!colours || pieces.count === 0) continue;
            layers.push({ id: t.id, name: t.name, pieces, rgba: piecesColours(colours.rgba, pieces.row), rowRgba: colours.rgba, legend: colours.legend, width: auto, auto });
        }
        return { layers, problem: null };
    }, [db, shownKey, geometry, paths, maps, asked, samplesKey, samplesWidth]);

    // The width changes without colouring the tables again
    return useMemo(
        () => (savedWidth === null || coloured.layers.length === 0 ? coloured : { ...coloured, layers: coloured.layers.map(l => ({ ...l, width: savedWidth })) }),
        [coloured, savedWidth],
    );
}
