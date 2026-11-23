/**
 * What is the matter with the open project's drillholes and logging
 * (features/model/validation), read from the stores: the collars and
 * surveys, every table logged down the holes, the samples of the dataset,
 * and the codes each grouping of lithologies reads.
 *
 * Worked out once for each state of what it reads, and shared by the model
 * setup steps and the drillholes' properties.
 */
import { useMemo } from 'react';
import { useAppStore } from '../../store/appStore';
import { useDrillholeStore } from '../../store/drillholeStore';
import { useModelStore } from '../../store/modelStore';
import { defaultCoords, holePositions, unitCodes } from './logging';
import type { DrillholeDb } from './drillholes';
import type { UnitMap } from './types';
import { validateHoles, type CheckedTable, type CodeSource, type Finding, type HolesToCheck } from './validation';

/** What the samples of the dataset are called in a finding */
export const SAMPLES = 'the samples';

/** A text column with more different values than this is taken as free text (comments), not codes */
const MOST_CODES = 200;

function fewValues(values: readonly string[]): boolean {
    const seen = new Set<string>();
    for (const v of values) {
        if (!v) continue;
        seen.add(v);
        if (seen.size > MOST_CODES) return false;
    }
    return seen.size > 1;
}

/** Everything `validateHoles` looks at, as the stores have it now */
export function holesToCheck(): HolesToCheck {
    const db = useDrillholeStore.getState().db;
    const maps = useModelStore.getState().scene.unitMaps ?? [];
    const coords = defaultCoords();
    // The codes each grouping reads, by the table they are in ('' = the dataset)
    const read = new Map<string, CodeSource[]>();
    for (const map of maps) {
        const codes = unitCodes(coords, map);
        if (!codes) continue;
        const key = map.table ?? '';
        const list = read.get(key) ?? [];
        const columns = map.columns.join(' + ');
        list.push({ name: map.name === columns ? columns : `${columns} (${map.name})`, values: codes.code, unitMap: map.id, units: map.units });
        read.set(key, list);
    }
    const tables: CheckedTable[] = [];
    for (const t of db?.tables ?? []) {
        // (A logging table no grouping reads yet: its columns of codes are looked at as they are)
        const codes = read.get(t.id) ?? (t.to
            ? t.columns.filter((c): c is { name: string; values: string[] } => Array.isArray(c.values) && fewValues(c.values)).map(c => ({ name: c.name, values: c.values }))
            : []);
        tables.push({ name: t.name, hole: t.hole, from: t.from, to: t.to, codes });
    }
    const samples = holePositions(coords);
    if (samples?.to) tables.push({ name: SAMPLES, hole: samples.hole, from: samples.from, to: samples.to, samples: true, codes: read.get('') ?? [] });
    return {
        collar: db ? db.collar : null,
        survey: db ? { hole: db.survey.hole } : null,
        tables,
    };
}

let last: { db: DrillholeDb | null; data: unknown; columns: unknown; maps: readonly UnitMap[] | undefined; coords: unknown; found: Finding[] } | null = null;

/** The findings of the open project, problems first (the same list while nothing it reads has changed) */
export function holeFindings(): Finding[] {
    const db = useDrillholeStore.getState().db;
    const app = useAppStore.getState();
    const scene = useModelStore.getState().scene;
    if (last && last.db === db && last.data === app.columnarData && last.columns === app.columns && last.maps === scene.unitMaps && last.coords === scene.coords) return last.found;
    const found = validateHoles(holesToCheck());
    last = { db, data: app.columnarData, columns: app.columns, maps: scene.unitMaps, coords: scene.coords, found };
    return found;
}

/** The same, for components */
export function useHoleFindings(): Finding[] {
    const db = useDrillholeStore(s => s.db);
    const data = useAppStore(s => s.columnarData);
    const columns = useAppStore(s => s.columns);
    const maps = useModelStore(s => s.scene.unitMaps);
    const coords = useModelStore(s => s.scene.coords);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- what holeFindings reads from the stores
    return useMemo(() => holeFindings(), [db, data, columns, maps, coords]);
}
