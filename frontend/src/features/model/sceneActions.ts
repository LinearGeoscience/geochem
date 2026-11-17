/**
 * What the 3D views do to the project's scene: build a surface from samples,
 * export meshes. (Store glue; the maths is in the pure modules beside it.)
 */
import { useAppStore } from '../../store/appStore';
import { useModelStore, type NewSurface } from '../../store/modelStore';
import { downloadText } from '../../utils/gisExport';
import { acrossFence, belowNeighbours, holeCollars } from './collars';
import { linePlane, type ImportedShapes } from './importShapes';
import { lineLength } from './lines';
import { holePositions } from './logging';
import { MESH_FORMATS, meshFileName, meshesToText, type MeshFormat, type NamedMesh } from './meshWriters';
import { sceneDataBox, useModelCache } from './modelCache';
import { cleanReading, MAX_READINGS, pickSpread } from './readings';
import { thinPoints } from './sampling';
import { DEFAULT_LINE_STRENGTH, DEFAULT_STRENGTH } from './structure';
import { MAX_SETS, setSummary, type NewReadingSet } from './structureReadings';
import type { BodyRule, ContactRule, Plane, PointReading, SceneCoords, ShellRule, Vec3 } from './types';

/** A surface is fitted through at most this many points at once (more are grouped) */
export const MAX_SURFACE_POINTS = 300;

/**
 * How closely a surface built from samples follows them to start with: samples
 * scatter about a structure, so it runs through the middle of them rather than
 * through each one. (Points clicked on holes are honoured exactly.)
 */
export const FOLLOW_FOR_SAMPLES = 0.6;

export const sameCoords = (a: SceneCoords | null, x: string, y: string, z: string) => !!a && a.x === x && a.y === y && a.z === z;

export type FromRowsResult =
    | { ok: true; id: string; samples: number; points: number }
    /**
     * no-coordinates = the X/Y/Z columns are missing; too-few = fewer than two samples with a position;
     * other-coordinates = the project's surfaces are in other coordinate columns
     */
    | { ok: false; reason: 'no-coordinates' | 'too-few' | 'other-coordinates' };

/**
 * A new surface through dataset rows (e.g. the selection). `along`: a
 * direction the surface runs in when the samples all lie on one line (one
 * hole): the direction the view looks in.
 */
export function surfaceFromRows(rows: ArrayLike<number>, coords: SceneCoords, options: { along?: Vec3 | null; name?: string } = {}): FromRowsResult {
    const app = useAppStore.getState();
    const model = useModelStore.getState();
    const x = app.getNumericColumn(coords.x), y = app.getNumericColumn(coords.y), z = app.getNumericColumn(coords.z);
    if (!x || !y || !z) return { ok: false, reason: 'no-coordinates' };
    const { scene } = model;
    if (scene.surfaces.length > 0 && !sameCoords(scene.coords, coords.x, coords.y, coords.z)) return { ok: false, reason: 'other-coordinates' };

    const at: number[] = [];
    for (let k = 0; k < rows.length; k++) {
        const i = rows[k];
        if (Number.isFinite(x[i]) && Number.isFinite(y[i]) && Number.isFinite(z[i])) at.push(x[i], y[i], z[i]);
    }
    const samples = at.length / 3;
    const thinned = thinPoints(at, MAX_SURFACE_POINTS);
    if (thinned.length < 6) return { ok: false, reason: 'too-few' };

    const points: { p: Vec3 }[] = [];
    for (let i = 0; i < thinned.length; i += 3) points.push({ p: [thinned[i], thinned[i + 1], thinned[i + 2]] });
    if (!sameCoords(scene.coords, coords.x, coords.y, coords.z) || scene.coords?.hole !== coords.hole) model.setCoords(coords);
    const id = model.addSurface({ name: options.name, points, along: options.along ?? null, params: { follow: FOLLOW_FOR_SAMPLES } });
    return { ok: true, id, samples, points: points.length };
}

export type GroundResult =
    /** left = holes left out because they start well below the holes round them (underground) */
    | { ok: true; id: string; holes: number; points: number; carried: number; left: string[] }
    /**
     * no-holes = the hole, depth or coordinate columns are missing; too-few = fewer than two holes;
     * other-coordinates = the project's surfaces are in other coordinate columns
     */
    | { ok: false; reason: 'no-holes' | 'too-few' | 'other-coordinates' };

/** The colour a ground surface starts with */
export const GROUND_COLOR = '#7a8f4e';

/**
 * A new surface through the tops of the drillholes (features/model/collars):
 * the ground, as far as the holes know it. It is an ordinary surface from
 * then on: its points can be moved, added to and removed.
 */
export function groundSurface(coords: SceneCoords): GroundResult {
    const model = useModelStore.getState();
    const { scene } = model;
    if (scene.surfaces.length > 0 && !sameCoords(scene.coords, coords.x, coords.y, coords.z)) return { ok: false, reason: 'other-coordinates' };
    const log = holePositions(coords);
    if (!log) return { ok: false, reason: 'no-holes' };
    const { kept: collars, left } = belowNeighbours(holeCollars(log));
    if (collars.holes.length < 2) return { ok: false, reason: 'too-few' };
    const thinned = thinPoints(collars.positions, MAX_SURFACE_POINTS);
    const points: { p: Vec3 }[] = [];
    for (let i = 0; i < thinned.length; i += 3) points.push({ p: [thinned[i], thinned[i + 1], thinned[i + 2]] });
    if (!sameCoords(scene.coords, coords.x, coords.y, coords.z) || scene.coords?.hole !== coords.hole) model.setCoords(coords);
    // Holes on one fence: the ground runs level across it
    const id = model.addSurface({ name: 'Ground', points, along: acrossFence(collars.positions), params: { extent: 'box' } });
    model.updateSurface(id, { color: GROUND_COLOR });
    return { ok: true, id, holes: collars.holes.length, points: points.length, carried: collars.carried, left };
}

/** A surface takes at most this many lines from a file (the longest ones) */
export const MAX_IMPORT_LINES = 40;

export interface AddedShapes {
    /** What the surface gained */
    points: number;
    readings: number;
    lines: number;
    /** What was grouped, left out or assumed, in plain words */
    notes: string[];
}

const count = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * Give a surface the points, readings and lines read from a file
 * (features/model/importShapes), as one step to undo. More than a surface is
 * fitted through are thinned: points close together are averaged, readings
 * and lines are chosen among. Null when the surface is not there.
 */
export function addShapes(surfaceId: string, shapes: ImportedShapes): AddedShapes | null {
    const model = useModelStore.getState();
    const surface = model.scene.surfaces.find(s => s.id === surfaceId);
    if (!surface) return null;
    const notes = [...shapes.notes];

    const plain: number[] = [];
    const measured = shapes.points.filter(q => q.reading);
    for (const q of shapes.points) if (!q.reading) plain.push(...q.p);
    // A line lies in the section or plan it was drawn on; one that does not is only the places along it
    let lines: { points: Vec3[]; plane: Plane }[] = [];
    let loose = 0;
    for (const points of shapes.lines) {
        const plane = linePlane(points);
        if (plane) lines.push({ points, plane });
        else { loose++; plain.push(...points.flat()); }
    }
    if (loose > 0) {
        notes.push(`${count(loose, 'line does', 'lines do')} not lie in one plane (a section or a plan), so ${loose === 1 ? 'its' : 'their'} corners were added as points.`);
    }

    const lineRoom = Math.max(0, MAX_IMPORT_LINES - surface.polylines.length);
    if (lines.length > lineRoom) {
        notes.push(`Of ${count(lines.length, 'line', 'lines')}, the ${count(lineRoom, 'longest was', 'longest were')} used (a surface takes ${MAX_IMPORT_LINES}).`);
        lines = lines.map(l => ({ l, length: lineLength(l.points) })).sort((a, b) => b.length - a.length).slice(0, lineRoom).map(x => x.l);
    }
    const readingRoom = Math.max(0, MAX_READINGS - surface.points.filter(p => p.reading).length);
    let readings = measured;
    if (measured.length > readingRoom) {
        readings = pickSpread(measured.flatMap(q => q.p), readingRoom).map(i => measured[i]);
        notes.push(`Of ${count(measured.length, 'dip reading', 'dip readings')}, ${readings.length.toLocaleString()} spread through them were used (a surface takes ${MAX_READINGS}).`);
    }
    const pointRoom = Math.max(0, MAX_SURFACE_POINTS - surface.points.length - readings.length);
    const thinned = pointRoom > 0 ? thinPoints(plain, pointRoom) : new Float64Array(0);
    if (thinned.length < plain.length) {
        notes.push(`${count(plain.length / 3, 'point was', 'points were')} grouped into ${(thinned.length / 3).toLocaleString()} (a surface is fitted through ${MAX_SURFACE_POINTS} at most).`);
    }

    const points: { p: Vec3; reading?: PointReading }[] = [...readings];
    for (let i = 0; i < thinned.length; i += 3) points.push({ p: [thinned[i], thinned[i + 1], thinned[i + 2]] });
    const added: Vec3[] = [...points.map(q => q.p), ...lines.flatMap(l => l.points)];
    const box = sceneDataBox();
    if (box && added.length > 0) {
        const pad = Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
        const inside = added.some(p => p.every((v, k) => v >= box.min[k] - pad && v <= box.max[k] + pad));
        if (!inside) notes.push('They are far from the data. Check that the file is in the same coordinates as the project.');
    }
    model.addPoints(surfaceId, points);
    let kept = 0;
    for (const line of lines) if (model.addPolyline(surfaceId, line)) kept++;
    return { points: points.length - readings.length, readings: readings.length, lines: kept, notes };
}

/** What `addShapes` did, as a sentence: "12 points, 3 dip readings and 2 lines were added." */
export function describeAdded(added: AddedShapes): string {
    const parts = [
        added.points > 0 && count(added.points, 'point', 'points'),
        added.readings > 0 && count(added.readings, 'dip reading', 'dip readings'),
        added.lines > 0 && count(added.lines, 'line', 'lines'),
    ].filter(Boolean) as string[];
    if (parts.length === 0) return 'Nothing was added.';
    const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
    return `${list} ${parts.length === 1 && /^1 /.test(parts[0]) ? 'was' : 'were'} added.`;
}

export type ReadingsFromRows =
    | { ok: true; found: number; added: AddedShapes }
    /** no-columns = a coordinate, dip or dip direction column is missing; none = no row has all five values */
    | { ok: false; reason: 'no-surface' | 'no-columns' | 'none' };

/**
 * Dip readings from the dataset: every row (or every one of `rows`, e.g.
 * the selection) that has a position, a dip and a dip direction becomes a
 * point of the surface with that reading.
 */
export function readingsFromRows(surfaceId: string, rows: ArrayLike<number> | null, dipColumn: string, directionColumn: string): ReadingsFromRows {
    const app = useAppStore.getState();
    const { scene } = useModelStore.getState();
    if (!scene.surfaces.some(s => s.id === surfaceId)) return { ok: false, reason: 'no-surface' };
    const c = scene.coords;
    const x = c && app.getNumericColumn(c.x), y = c && app.getNumericColumn(c.y), z = c && app.getNumericColumn(c.z);
    const dip = app.getNumericColumn(dipColumn), direction = app.getNumericColumn(directionColumn);
    if (!x || !y || !z || !dip || !direction) return { ok: false, reason: 'no-columns' };
    const points: ImportedShapes['points'] = [];
    const n = rows ? rows.length : x.length;
    for (let k = 0; k < n; k++) {
        const i = rows ? rows[k] : k;
        if (!Number.isFinite(x[i]) || !Number.isFinite(y[i]) || !Number.isFinite(z[i])) continue;
        const reading = cleanReading({ dip: dip[i], dipDirection: direction[i] });
        if (reading) points.push({ p: [x[i], y[i], z[i]], reading });
    }
    if (points.length === 0) return { ok: false, reason: 'none' };
    return { ok: true, found: points.length, added: addShapes(surfaceId, { points, lines: [], notes: [] })! };
}

/** The scene has something placed in its coordinate columns: surfaces, or readings */
export const sceneInUse = (scene: { surfaces: readonly unknown[]; structure?: { sets?: readonly unknown[] } }) => scene.surfaces.length > 0 || (scene.structure?.sets?.length ?? 0) > 0;

export type AddReadingSets =
    | { ok: true; ids: string[]; readings: number }
    /** other-coordinates = the scene is in other coordinate columns; full = it has as many sets as it keeps */
    | { ok: false; reason: 'other-coordinates' | 'full' };

/**
 * Sets of orientation readings for the whole model, placed in these
 * coordinate columns (which become the scene's when it had none).
 */
export function addReadingSets(coords: SceneCoords, sets: NewReadingSet[]): AddReadingSets {
    const model = useModelStore.getState();
    const { scene } = model;
    if (sceneInUse(scene) && !sameCoords(scene.coords, coords.x, coords.y, coords.z)) return { ok: false, reason: 'other-coordinates' };
    if ((scene.structure?.sets?.length ?? 0) + sets.length > MAX_SETS) return { ok: false, reason: 'full' };
    if (!sameCoords(scene.coords, coords.x, coords.y, coords.z)) model.setCoords(coords);
    const ids = model.addReadingSets(sets);
    return { ok: true, ids, readings: sets.reduce((n, s) => n + s.readings.length, 0) };
}

/**
 * A reading placed by hand in a view of these coordinate columns (which
 * become the scene's when it had none). Null when the scene is in other
 * columns, or cannot keep another.
 */
export function addHandReading(coords: SceneCoords, kind: 'plane' | 'line', reading: { p: Vec3; dip: number; direction: number }): string | null {
    const model = useModelStore.getState();
    const { scene } = model;
    if (sceneInUse(scene) && !sameCoords(scene.coords, coords.x, coords.y, coords.z)) return null;
    if (!sameCoords(scene.coords, coords.x, coords.y, coords.z)) model.setCoords(coords);
    return model.addHandReading(kind, reading);
}

/**
 * Make the orientation a set's readings lie closest to the model's one
 * direction: a set of planes gives the plane (what is set of the long
 * direction is kept), a set of lines the long direction within the plane
 * already set. False when there is nothing to take it from, or lines are
 * asked for before there is a plane.
 */
export function structureFromSet(setId: string): boolean {
    const model = useModelStore.getState();
    const set = model.scene.structure?.sets?.find(s => s.id === setId);
    const summary = set ? setSummary(set) : null;
    const overall = model.scene.structure?.overall ?? null;
    if (!set || !summary) return false;
    const round = (v: number) => Number(v.toFixed(1));
    if (set.kind === 'plane') {
        model.setStructure({ dip: round(summary.dip), dipDirection: round(summary.direction), lineTrend: overall?.lineTrend ?? null, strength: overall?.strength ?? DEFAULT_STRENGTH, lineStrength: overall?.lineStrength ?? DEFAULT_LINE_STRENGTH });
        return true;
    }
    if (!overall) return false;
    model.setStructure({ ...overall, lineTrend: round(summary.direction) });
    return true;
}

/** A side's units as a short name: "OX", "OX + SAP", "OX + 3 more". */
export function unitsLabel(units: readonly string[]): string {
    return units.length <= 2 ? units.join(' + ') : `${units[0]} + ${units.length - 1} more`;
}

/**
 * A new surface between logged units (features/model/contacts): it is put
 * where the logging changes from one side to the other down each hole. Its
 * sides are named after their units. Null when the project's surfaces are in
 * other coordinate columns than these.
 */
export function contactSurface(coords: SceneCoords, rule: ContactRule): string | null {
    const a = unitsLabel(rule.sideA), b = unitsLabel(rule.sideB);
    return loggedSurface(coords, { name: `${a} / ${b}`, rule, sides: [a, b] });
}

/**
 * A new closed body round logged units (features/model/body), named after
 * them. Its sides are "Inside" and "Outside" until they are renamed. Null
 * when the project's surfaces are in other coordinate columns than these.
 */
export function bodySurface(coords: SceneCoords, rule: BodyRule): string | null {
    return loggedSurface(coords, { name: unitsLabel(rule.inside), rule });
}

/** A shell's name from its column and cut-off: "Au ≥ 0.5". */
export function shellName(rule: Pick<ShellRule, 'column' | 'cutoff'>): string {
    return `${rule.column} ≥ ${rule.cutoff}`;
}

/**
 * A new shell round the values of a column at or above a cut-off
 * (features/model/shell). Its sides are "Inside" and "Outside" until they
 * are renamed. Null when the project's surfaces are in other coordinate
 * columns than these.
 */
export function shellSurface(coords: SceneCoords, rule: ShellRule): string | null {
    return loggedSurface(coords, { name: shellName(rule), rule });
}

function loggedSurface(coords: SceneCoords, init: NewSurface): string | null {
    const model = useModelStore.getState();
    const { scene } = model;
    if (scene.surfaces.length > 0 && !sameCoords(scene.coords, coords.x, coords.y, coords.z)) return null;
    const c = scene.coords;
    // The hole and depth columns are needed to follow the logging: take the view's
    if (!sameCoords(c, coords.x, coords.y, coords.z) || c?.hole !== coords.hole || c?.from !== coords.from || c?.to !== coords.to) model.setCoords(coords);
    return model.addSurface(init);
}

/**
 * A new, empty surface, opened with "place points" on: the next clicks in a
 * 3D view build it. Null when the project's surfaces are in other coordinate
 * columns than this view's.
 */
export function startSurface(coords: SceneCoords): string | null {
    const model = useModelStore.getState();
    const { scene } = model;
    if (scene.surfaces.length > 0 && !sameCoords(scene.coords, coords.x, coords.y, coords.z)) return null;
    if (!sameCoords(scene.coords, coords.x, coords.y, coords.z) || scene.coords?.hole !== coords.hole) model.setCoords(coords);
    const id = model.addSurface();
    model.setEditing(id, true);
    return id;
}

/** The finished meshes of these surfaces (those that have one), named as in the scene. */
export function surfaceMeshes(ids: readonly string[]): NamedMesh[] {
    const cache = useModelCache.getState().byId;
    const out: NamedMesh[] = [];
    for (const s of useModelStore.getState().scene.surfaces) {
        const part = ids.includes(s.id) ? cache[s.id]?.part : null;
        if (part && part.triangles.length > 0) out.push({ name: s.name, vertices: part.vertices, triangles: part.triangles });
    }
    return out;
}

/** Save surfaces as one mesh file. False when none of them has a mesh yet. */
export function exportSurfaces(ids: readonly string[], format: MeshFormat, projectName = 'surfaces'): boolean {
    const meshes = surfaceMeshes(ids);
    if (meshes.length === 0) return false;
    const mime = MESH_FORMATS.find(f => f.format === format)?.mime ?? 'text/plain';
    downloadText(meshesToText(format, meshes), meshFileName(format, meshes, projectName), mime);
    return true;
}
