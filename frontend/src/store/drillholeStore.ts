/**
 * The project's drillhole tables (collars, surveys, and tables logged down
 * the holes), kept beside the dataset and saved in the .chem file.
 *
 * Filled by a drillhole import (the backend hands the tables back once the
 * dataset is in) and by opening a project; emptied when a different dataset
 * replaces this one. `db` is replaced, never mutated: its identity is the
 * change signal, and the hole paths are worked out once per `db`.
 *
 * Null in projects made before the tables were kept, and for data that did
 * not come from a drillhole import: everything that reads hole paths has to
 * work without them.
 */
import { create } from 'zustand';
import type { HoleTrace } from '../features/model/desurvey';
import { buildTraces, readDrillholes, type DrillholeDb, type HoleTable } from '../features/model/drillholes';
import { drillholeApi } from '../services/api';

interface DrillholeState {
    db: DrillholeDb | null;
    setDrillholes: (db: DrillholeDb | null) => void;
    /**
     * Adds a table logged down the holes (it is given an id of its own, which
     * is returned). Null when the project has no collars and surveys to place
     * it by.
     */
    addTable: (table: Omit<HoleTable, 'id'>) => string | null;
    removeTable: (id: string) => void;
}

export const useDrillholeStore = create<DrillholeState>((set, get) => ({
    db: null,
    setDrillholes: (db) => set({ db }),
    addTable: (table) => {
        const { db } = get();
        if (!db) return null;
        let k = db.tables.length + 1;
        while (db.tables.some(t => t.id === `table-${k}`)) k++;
        const id = `table-${k}`;
        set({ db: { ...db, tables: [...db.tables, { ...table, id }] } });
        return id;
    },
    removeTable: (id) => {
        const { db } = get();
        if (db && db.tables.some(t => t.id === id)) set({ db: { ...db, tables: db.tables.filter(t => t.id !== id) } });
    },
}));

const NO_TRACES: ReadonlyMap<string, HoleTrace> = new Map();
let traced: { collar: DrillholeDb['collar']; survey: DrillholeDb['survey']; traces: ReadonlyMap<string, HoleTrace> } | null = null;

/** The path of every hole of these tables (worked out once for each set of collars and surveys). */
export function tracesOf(db: DrillholeDb | null): ReadonlyMap<string, HoleTrace> {
    if (!db) return NO_TRACES;
    if (traced?.collar !== db.collar || traced.survey !== db.survey) traced = { collar: db.collar, survey: db.survey, traces: buildTraces(db) };
    return traced.traces;
}

/** A table logged down the holes, by its id. */
export const holeTable = (id: string | null | undefined): HoleTable | null =>
    (id && useDrillholeStore.getState().db?.tables.find(t => t.id === id)) || null;

/** The path of every hole of the project; empty when it has no drillhole tables. */
export const holeTraces = (): ReadonlyMap<string, HoleTrace> => tracesOf(useDrillholeStore.getState().db);

/** The same, for components: changes when the tables do. */
export const useHoleTraces = (): ReadonlyMap<string, HoleTrace> => tracesOf(useDrillholeStore(s => s.db));

/**
 * Takes the tables of the drillhole import that has just finished from the
 * backend. Returns whether they came: the dataset is usable without them, so
 * a failure here is not the import's.
 */
export async function loadImportedDrillholes(): Promise<boolean> {
    try {
        const db = readDrillholes(await drillholeApi.tables());
        useDrillholeStore.getState().setDrillholes(db);
        return db !== null;
    } catch (err) {
        console.warn('[drillholes] the collar and survey tables did not come back from the import', err);
        useDrillholeStore.getState().setDrillholes(null);
        return false;
    }
}
