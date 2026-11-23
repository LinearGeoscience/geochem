/**
 * Phase 273: grade by part of the ground, read off the scene (gradeTable.ts
 * has the sums): the samples of a column against the shells of a numeric
 * model, the lithologies of a geological model (as it models them, and as
 * they were logged), or a closed mesh from a file. For the properties of
 * each, and as a table of the report.
 */
import { useModelStore } from '../../store/modelStore';
import { useReportStore } from '../../store/reportStore';
import { modelUnitsAt } from './geoModelColumns';
import { useGeoModelCache } from './geoModelCache';
import { gradeTable, gradeText, overlapShares, shareText, type GradePart, type GradeTable } from './gradeTable';
import { shellSamples, unitLog } from './logging';
import { sceneMesh } from './meshFields';
import { shellSamplesFor, useModelCache } from './modelCache';
import type { ShellSamples } from './shell';
import { groundText } from './shellDomains';
import { insideSolids, notClosed } from './solidGround';

export type GradeAsked =
    | {
        ok: true;
        title: string;
        /** What the table is of, in a sentence (the report's caption, with the top cut) */
        caption: string;
        column: string;
        /** False: the data has no depths, so the "metres" are counts of samples */
        inMetres: boolean;
        table: GradeTable;
    }
    | { ok: false; reason: string };

/** The samples as the sums take them: lengths (1 each without depths), and their places */
function measured(samples: ShellSamples) {
    const n = samples.value.length;
    const inMetres = !!samples.from && !!samples.to;
    const length = new Float64Array(n), xyz = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
        length[i] = inMetres ? samples.to![i] - samples.from![i] : 1;
        xyz[i * 3] = samples.x[i]; xyz[i * 3 + 1] = samples.y[i]; xyz[i * 3 + 2] = samples.z[i];
    }
    return { length, xyz, inMetres };
}

const cutText = (table: GradeTable) => (table.topCut === null ? 'No top cut.'
    : `Top cut ${gradeText(table.topCut)}: ${table.cut === 0 ? 'no sample is over it' : `${table.cut.toLocaleString('en-US')} ${table.cut === 1 ? 'sample' : 'samples'} over it counted as ${gradeText(table.topCut)}`}.`);
const READING = 'Mean grade is by length; the share of the metal is of metres times grade.';

/**
 * A numeric model's column against its own shells: what is inside each (a
 * shell at a higher cut-off lies inside the lower ones, so the rows overlap),
 * and what is outside the lowest. Of the samples its domain gives it; with
 * its own top cut.
 */
export function gradeByShells(numericId: string): GradeAsked {
    const scene = useModelStore.getState().scene;
    const model = scene.numericModels?.find(m => m.id === numericId);
    const surfaces = model ? model.shells.map(s => scene.surfaces.find(x => x.id === s.surface)) : [];
    const first = surfaces.find(s => !!s);
    if (!model || !first) return { ok: false, reason: 'The model has no shells.' };
    if (model.rule.of) return { ok: false, reason: 'A proportion is of logging, not of assays: its shells say what share of the ground is its units.' };
    const samples = shellSamplesFor(first);
    if (samples === 'wait') return { ok: false, reason: 'The ground it is kept inside is still being made.' };
    if (!samples || samples.value.length === 0) return { ok: false, reason: `There are no samples of ${model.rule.column} to read.` };
    const { length, xyz, inMetres } = measured(samples);
    const fits = useModelCache.getState().byId;
    const none = new Uint8Array(samples.value.length);
    let lowest: Uint8Array | null = null;
    const parts: GradePart[] = model.shells.map((s, k) => {
        const name = `Inside the shell at ${s.cutoff}`;
        const fit = fits[s.surface];
        if (!surfaces[k] || !fit || fit.state !== 'ready' || !fit.part || fit.part.triangles.length === 0) return { name, share: none, note: !fit || fit.state === 'fitting' ? 'not fitted yet' : 'nothing is at or above it' };
        const mesh = { vertices: fit.part.vertices, triangles: fit.part.triangles };
        if (notClosed([mesh]).length > 0) return { name, share: none, note: 'its mesh is not closed' };
        const inside = insideSolids({ meshes: [mesh] }, xyz);
        if (!lowest) lowest = inside;
        return { name, share: inside };
    });
    const low: Uint8Array | null = lowest;
    if (low) parts.push({ name: 'Outside its lowest shell', share: Uint8Array.from(low as Uint8Array, v => 1 - v) });
    const table = gradeTable({ length, value: samples.value }, parts, model.rule.topCut ?? null);
    const where = model.domain ? `the samples in ${groundText(model.domain, scene)}` : 'every sample';
    return {
        ok: true, column: model.rule.column, inMetres, table,
        title: `${model.name}: grade inside its shells`,
        caption: `${model.rule.column} in ${where}, by the grade shell each lies inside. A shell at a higher cut-off lies inside the lower ones, so the rows overlap. ${READING} ${cutText(table)}`,
    };
}

/**
 * A column against the lithologies of a geological model: `modelled`, the
 * unit of the built model each sample's middle is in; else as logged, each
 * sample shared among the units by the length of it logged as each (the
 * logging may be on other rows than the assays).
 */
export function gradeByModel(modelId: string, column: string, topCut: number | null, modelled: boolean): GradeAsked {
    const scene = useModelStore.getState().scene;
    const model = scene.models?.find(m => m.id === modelId);
    if (!model) return { ok: false, reason: 'There is no such model.' };
    const samples = shellSamples(scene.coords, column);
    if (!samples || samples.value.length === 0) return { ok: false, reason: `There are no samples of ${column} to read.` };
    const { length, xyz, inMetres } = measured(samples);
    if (modelled) {
        const result = useGeoModelCache.getState().byId[modelId];
        if (!result?.out || !result.job) return { ok: false, reason: 'The model is not built yet.' };
        const at = modelUnitsAt(result, xyz);
        const parts: GradePart[] = result.units.map(u => ({ name: u, share: Uint8Array.from(at, a => (a === u ? 1 : 0)) }));
        const table = gradeTable({ length, value: samples.value }, parts, topCut, 'Outside the model');
        return {
            ok: true, column, inMetres, table,
            title: `${column} by lithology of ${model.name}, as modelled`,
            caption: `${column} in every sample, by the unit of ${model.name} its middle lies in. ${READING} ${cutText(table)}`,
        };
    }
    const map = scene.unitMaps?.find(m => m.id === model.unitMap);
    if (!map) return { ok: false, reason: 'The model reads no lithologies: there is no logging to set the grade against.' };
    const log = unitLog(scene.coords, map, true);
    if (!log || !log.to) return { ok: false, reason: 'The logging of its units could not be read.' };
    if (!samples.hole || !samples.from) return { ok: false, reason: 'It needs the hole and depth columns to set samples against logging.' };
    const units = map.units.map(u => u.name);
    const shares = overlapShares({ hole: samples.hole, from: samples.from, to: samples.to ?? samples.from }, { hole: log.hole, from: log.from, to: log.to, code: log.code }, units);
    const table = gradeTable({ length, value: samples.value }, units.map((u, k) => ({ name: u, share: shares[k] })), topCut, 'Not logged');
    return {
        ok: true, column, inMetres, table,
        title: `${column} by lithology of ${map.name}, as logged`,
        caption: `${column} in every sample, by the lithology it was logged as: a sample that crosses a contact is shared between the two by length. ${READING} ${cutText(table)}`,
    };
}

/** A column against a closed mesh from a file: what is inside it, and what is not */
export function gradeByMesh(meshId: string, column: string, topCut: number | null): GradeAsked {
    const scene = useModelStore.getState().scene;
    const wire = scene.wireframes.find(w => w.id === meshId);
    const mesh = sceneMesh(meshId);
    if (!wire || !mesh) return { ok: false, reason: 'The mesh has no triangles to read.' };
    if (mesh === 'wait') return { ok: false, reason: 'Its file is still being read.' };
    if (notClosed([mesh.field]).length > 0) return { ok: false, reason: 'The mesh is not closed (an edge of it is open), so it has no inside.' };
    const samples = shellSamples(scene.coords, column);
    if (!samples || samples.value.length === 0) return { ok: false, reason: `There are no samples of ${column} to read.` };
    const { length, xyz, inMetres } = measured(samples);
    const inside = insideSolids({ meshes: [mesh.field] }, xyz);
    const table = gradeTable({ length, value: samples.value }, [{ name: `Inside ${wire.name}`, share: inside }], topCut, `Outside ${wire.name}`);
    return {
        ok: true, column, inMetres, table,
        title: `${column} inside ${wire.name}`,
        caption: `${column} in every sample, by whether its middle lies inside the mesh ${wire.name}. ${READING} ${cutText(table)}`,
    };
}

/** The rows of a grade table as text: the parts, then all */
export function gradeRows(asked: GradeAsked & { ok: true }): { columns: string[]; rows: string[][] } {
    const metres = (v: number) => (asked.inMetres ? (v >= 100 ? Math.round(v).toLocaleString('en-US') : String(Math.round(v * 10) / 10)) : Math.round(v).toLocaleString('en-US'));
    const row = (r: GradeTable['all']) => [r.note ? `${r.name} (${r.note})` : r.name, metres(r.metres), gradeText(r.grade), shareText(r.metal), shareText(r.ground)];
    return {
        columns: ['', asked.inMetres ? 'Metres' : 'Samples', `Mean ${asked.column}`, 'Share of the metal', asked.inMetres ? 'Share of the metres' : 'Share of the samples'],
        rows: [...asked.table.rows.map(row), row(asked.table.all)],
    };
}

/** A grade table put in the report */
export function gradeToReport(asked: GradeAsked & { ok: true }): void {
    const { columns, rows } = gradeRows(asked);
    useReportStore.getState().addTable({ title: asked.title, caption: asked.caption, columns, rows });
}
