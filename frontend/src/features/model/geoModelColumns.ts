/**
 * A built model put back on the data: a dataset column that says which unit
 * of the model each sample is in (and, for a model cut by faults, one that
 * says which fault block), and the model compared with the logging it was
 * made from.
 *
 * Making the column is the user's action (one undo step, with the model's
 * record of it). After that it is the model's: whenever the model is built
 * again the column is redone, with no undo step of its own.
 */
import { useAppStore } from '../../store/appStore';
import { withoutHistory } from '../../store/historyStore';
import { useModelStore } from '../../store/modelStore';
import { OUTSIDE } from './cutCells';
import { useGeoModelCache, type ModelResult } from './geoModelCache';
import { bestAgreement, loggedRuns } from './contactMatrix';
import { agreement, agreementByPart, loggedSamples, mismatches, type Agreement, type Mismatch } from './geoModelFlag';
import { blockNames } from './geoModel';
import { labelsAtPoints, unitsAtPoints } from './geoModelJobs';
import { unitLog } from './logging';
import { cleans } from './units';
import { keyMark } from './surfaceJobs';
import type { GeoModel } from './types';

/** The unit of a built model at places (xyz triples): its name, or null outside the model */
export function modelUnitsAt(result: ModelResult, xyz: Float64Array): (string | null)[] {
    if (!result.job || !result.out) return Array.from({ length: xyz.length / 3 }, () => null);
    const at = unitsAtPoints(result.job, result.out.topSense, xyz);
    return Array.from(at, u => (u === OUTSIDE ? null : result.units[u] ?? null));
}

export type ColumnResult =
    | { ok: true; column: string }
    /** not-built = the model has no build to read; no-coordinates = the scene's X/Y/Z columns are missing */
    | { ok: false; reason: 'no-model' | 'not-built' | 'no-coordinates' };

function write(model: GeoModel, result: ModelResult): ColumnResult {
    const app = useAppStore.getState();
    const { coords } = useModelStore.getState().scene;
    const x = coords && app.getNumericColumn(coords.x), y = coords && app.getNumericColumn(coords.y), z = coords && app.getNumericColumn(coords.z);
    if (!x || !y || !z) return { ok: false, reason: 'no-coordinates' };
    if (!result.out || !result.job) return { ok: false, reason: 'not-built' };
    const xyz = new Float64Array(x.length * 3);
    for (let i = 0; i < x.length; i++) { xyz[i * 3] = x[i]; xyz[i * 3 + 1] = y[i]; xyz[i * 3 + 2] = z[i]; }
    const at = labelsAtPoints(result.job, result.out.topSense, xyz);
    const values = Array.from(at.unit, u => (u === OUTSIDE ? '' : result.units[u] ?? ''));
    const put = (own: string | undefined, fresh: string, cells: string[], what: string, output: string): string => {
        const exists = !!own && useAppStore.getState().columns.some(c => c.name === own);
        return useAppStore.getState().addColumn(
            exists ? own! : fresh, cells, 'categorical', 'Classification', null, undefined,
            { kind: 'other', description: `${what} of the geological model "${model.name}"`, params: { modelId: model.id, output }, created: new Date().toISOString() },
            // Its own column is replaced; a first write never takes over someone else's column
            exists ? 'replace' : 'unique',
        ) ?? own ?? fresh;
    };
    const column = put(model.column, `${model.name} unit`, values, 'Unit', 'unit');
    // Cut by faults: the block of each sample too. In one piece again: the column it had stays as it was, no longer the model's
    let blockColumn: string | null = null;
    if (result.out.blocks.length > 1) {
        const names = blockNames(useModelStore.getState().scene, model, result.faults, result.out.blocks);
        blockColumn = put(model.blockColumn, `${model.name} fault block`, Array.from(at.block, (b, i) => (at.unit[i] === OUTSIDE ? '' : names[b] ?? '')), 'Fault block', 'block');
    }
    const columnFor = keyMark(result.key);
    if (column !== model.column || columnFor !== model.columnFor || (blockColumn ?? undefined) !== model.blockColumn) {
        useModelStore.getState().updateModel(model.id, { column, columnFor, blockColumn });
    }
    return { ok: true, column };
}

/** Make (or remake) the column of a model's units. One undo step. */
export function writeModelColumn(modelId: string): ColumnResult {
    const model = useModelStore.getState().scene.models?.find(m => m.id === modelId);
    const result = useGeoModelCache.getState().byId[modelId];
    if (!model) return { ok: false, reason: 'no-model' };
    if (!result) return { ok: false, reason: 'not-built' };
    return write(model, result);
}

/** Stop keeping a model's column: the column stays in the data as it is */
export function releaseModelColumn(modelId: string): void {
    useModelStore.getState().updateModel(modelId, { column: null });
}

/** Redo the column of every model built again since it was written */
export function refreshModelColumns(): void {
    const taken = new Set(useAppStore.getState().columns.map(c => c.name));
    const built = useGeoModelCache.getState().byId;
    for (const model of useModelStore.getState().scene.models ?? []) {
        if (!model.column) continue;
        // A column the user has deleted is no longer the model's to fill in
        if (!taken.has(model.column)) { withoutHistory(() => useModelStore.getState().updateModel(model.id, { column: null })); continue; }
        const result = built[model.id];
        if (!result || result.state !== 'ready' || keyMark(result.key) === model.columnFor) continue;
        withoutHistory(() => { write(model, result); });
    }
}

let running = false;
useGeoModelCache.subscribe(() => {
    if (running) return;
    running = true;
    try { refreshModelColumns(); } finally { running = false; }
});

export interface AgreementOk {
    ok: true;
    agreement: Agreement;
    cleaned?: { agreement: Agreement; metres: number };
    /** The stretches of hole in another unit than they were logged as, the longest first */
    mismatches: Mismatch[];
    /** Fault block by fault block, for a model cut by faults */
    blocks?: { name: string; agreement: Agreement }[];
    /**
     * What its layers, each met once down a hole in the model's order, can
     * match of the logging at best (contactMatrix.ts `bestAgreement`):
     * what the figure is to be read against. Absent for a model cut by
     * faults, which can meet a layer twice in a hole.
     */
    ceiling?: { metres: number; of: number };
}
export type AgreementResult = AgreementOk | { ok: false; reason: string };

/**
 * A built model against the logging of the units it reads (geoModelFlag.ts):
 * the logging as logged, whatever was cleaned. `cleaned`, when the units
 * clean short stretches: the same against the logging as the model reads it,
 * and the metres the cleaning reads otherwise.
 */
export function modelAgreement(modelId: string): AgreementResult {
    const scene = useModelStore.getState().scene;
    const model = scene.models?.find(m => m.id === modelId);
    const result = useGeoModelCache.getState().byId[modelId];
    const map = scene.unitMaps?.find(m => m.id === model?.unitMap);
    if (!model || !result?.out || !result.job) return { ok: false, reason: 'The model is not built yet.' };
    if (!map) return { ok: false, reason: 'The model reads no lithologies: there is no logging to compare it with.' };
    const log = unitLog(scene.coords, map, true);
    if (!log) return { ok: false, reason: 'The logging of its units could not be read.' };
    const samples = loggedSamples(log, Math.max(0.5, result.out.grid.cell / 2));
    const at = labelsAtPoints(result.job, result.out.topSense, samples.xyz);
    const modelled = Array.from(at.unit, u => (u === OUTSIDE ? null : result.units[u] ?? null));
    const hole = Array.from(samples.row, r => String(log.hole[r] ?? ''));
    const logged = Array.from(samples.row, r => String(log.code[r] ?? ''));
    const read = cleans(map) ? unitLog(scene.coords, map) : null;
    const asRead = read ? Array.from(samples.row, r => String(read.code[r] ?? '')) : null;
    let metres = 0;
    if (asRead) for (let i = 0; i < asRead.length; i++) if (asRead[i] !== logged[i]) metres += samples.length[i];
    const faulted = result.out.blocks.length > 1;
    const names = faulted ? blockNames(scene, model, result.faults, result.out.blocks) : [];
    // The layers of the model, the youngest first, and what cuts across them
    const layers = [...model.contacts.filter(c => !c.off && c.kind !== 'intrusion').map(c => c.unit), model.base].filter((u, k, all) => !!u && all.indexOf(u) === k);
    const cutting = model.contacts.filter(c => !c.off && c.kind === 'intrusion').map(c => c.unit).filter(u => !layers.includes(u));
    const bound = !faulted && layers.length > 1 ? bestAgreement(loggedRuns(log, map.units.map(u => u.name)), layers, cutting) : null;
    return {
        ok: true,
        agreement: agreement(result.units, logged, modelled, samples.length, hole),
        ...(asRead ? { cleaned: { agreement: agreement(result.units, asRead, modelled, samples.length, hole), metres } } : {}),
        mismatches: mismatches(result.units, samples, logged, modelled, hole),
        ...(faulted ? { blocks: agreementByPart(names, Array.from(at.block, (b, k) => (at.unit[k] === OUTSIDE ? null : names[b] ?? null)), result.units, logged, modelled, samples.length, hole) } : {}),
        ...(bound && bound.of > 0 ? { ceiling: { metres: bound.metres, of: bound.of } } : {}),
    };
}
