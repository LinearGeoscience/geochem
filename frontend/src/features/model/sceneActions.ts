/**
 * What the 3D views do to the project's scene: build a surface from samples,
 * export meshes. (Store glue; the maths is in the pure modules beside it.)
 */
import type { Zone } from './lodes';
import { giveStretch, veinsOfSet } from './veinSet';
import { stopSide } from './veinSystem';
import { evaluateField } from './rbf';
import { veinMiddles } from './surfaceJobs';
import { useAppStore } from '../../store/appStore';
import { useModelStore, type NewSurface } from '../../store/modelStore';
import { BUILD_VERSION } from '../../store/updateStore';
import { downloadText } from '../../utils/gisExport';
import { zipStore } from '../../utils/zipStore';
import { acrossFence, belowNeighbours, holeCollars } from './collars';
import { tracesMatching } from './drillholes';
import { modelUnits } from './geoModel';
import { shellLabel } from './numericModels';
import { domainUnits, unitDomain } from './shellDomains';
import { holeTraces } from '../../store/drillholeStore';
import { linePlane, type ImportedShapes } from './importShapes';
import { copyToSection, sectionOfLine } from './lineTools';
import { lineLength, MAX_FREE_SAMPLES, MAX_LINE_SAMPLES, onPlane } from './lines';
import { holePositions } from './logging';
import { cleanMesh } from './meshClean';
import { MESH_FORMATS, meshFileName, meshesToFile, type MeshFormat, type NamedMesh } from './meshWriters';
import { localDate, surfaceKit, type SurfaceKit } from './rebuildKit';
import { contactInputsFor, sceneDataBox, useModelCache } from './modelCache';
import { cleanReading, MAX_READINGS, pickSpread } from './readings';
import { isOrientedLine } from './ribbons';
import { thinPoints } from './sampling';
import { DEFAULT_LINE_STRENGTH, DEFAULT_STRENGTH } from './structure';
import { MAX_SETS, setSummary, type NewReadingSet } from './structureReadings';
import type { BodyRule, ContactRule, Domain, LineNode, ModelScene, Plane, PointReading, SceneCoords, ShellRule, Vec3, SurfaceObject, VeinSystem } from './types';
import type { ViewNote } from './viewRegistry';
import { makeSectionSet } from './sectionSets';
import { defaultSliceWidth, PRESET_NORMALS, type PresetKind } from '../plots/viewer3d/slices';

/** A surface is fitted through at most this many points at once (more are grouped) */
export const MAX_SURFACE_POINTS = 20_000;

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

/**
 * A surface through the samples picked in the data, made and opened, with
 * what there is to say of it (null: nothing). `along`: the direction a view
 * looks in, for samples that all lie on one line (`surfaceFromRows`).
 */
export function surfaceFromSelection(coords: SceneCoords, along: Vec3 | null = null): ViewNote {
    const out = surfaceFromRows(useAppStore.getState().selectedIndices, coords, { along });
    if (!out.ok) {
        return {
            severity: 'warning',
            text: out.reason === 'too-few' ? 'A surface needs samples at two places or more.'
                : out.reason === 'no-coordinates' ? 'The X, Y and Z columns must be numbers.'
                    : 'The surfaces of this project were built in other coordinate columns.',
        };
    }
    useModelStore.getState().setEditing(out.id);
    return out.points < out.samples
        ? { severity: 'info', text: `${out.samples.toLocaleString()} samples were grouped into ${out.points} points (a surface is fitted through ${MAX_SURFACE_POINTS} at most).` }
        : null;
}

/**
 * A new set of sections through the middle of the data, with no view asked:
 * W-E or S-N sections or level plans, spaced as a view would space them
 * (about a twentieth of the data's extent). Null: the data has no place in
 * these columns, or there are as many sets as can be.
 */
export function presetSectionSet(kind: PresetKind, coords: SceneCoords): string | null {
    const app = useAppStore.getState();
    const cols = [app.getNumericColumn(coords.x), app.getNumericColumn(coords.y), app.getNumericColumn(coords.z)];
    if (cols.some(c => !c)) return null;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const n = cols[0]!.length;
    for (let i = 0; i < n; i++) {
        if (!cols.every(c => Number.isFinite(c![i]))) continue;
        for (let k = 0; k < 3; k++) {
            const v = cols[k]![i];
            if (v < min[k]) min[k] = v;
            if (v > max[k]) max[k] = v;
        }
    }
    if (!(max[0] >= min[0])) return null;
    const spacing = defaultSliceWidth(Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]));
    const made = makeSectionSet(PRESET_NORMALS[kind], [0, 1, 2].map(k => (min[k] + max[k]) / 2), spacing, spacing);
    return made ? useModelStore.getState().addSectionSet(made) : null;
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
    // Collars as surveyed where the project has the holes' own tables and they are in these coordinates
    const { kept: collars, left } = belowNeighbours(holeCollars(log, tracesMatching(holeTraces(), log)));
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

/**
 * A surface takes at most this many lines (from a file: the longest ones).
 * Each line has two places at least in the fit, and one fit of 200 lines
 * takes about a second (400 take ten): the limit goes when surfaces are
 * fitted block by block. With more than MANY_LINES, or a line of more than
 * MANY_NODES, the file is taken whole and it says what that means.
 */
export const MAX_IMPORT_LINES = 2000;

export interface AddedShapes {
    /** What the surface gained */
    points: number;
    readings: number;
    lines: number;
    /** Directions the surface runs in, at the lines' nodes (absent: none) */
    directions?: number;
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
    // A line lies in the section or plan it was drawn on (the one the file gives, when its nodes are on it); one that
    // does not is a line in space
    let lines: { points: Vec3[]; plane: Plane | null; nodes?: (LineNode | null)[]; smooth?: boolean }[] = [];
    let loose = 0;
    shapes.lines.forEach((points, i) => {
        const known = shapes.known?.[i] ?? null;
        const plane = known?.plane && onPlane(points, known.plane) ? known.plane : linePlane(points);
        const line = { points, plane, ...(known?.nodes && known.nodes.length === points.length ? { nodes: known.nodes } : {}), ...(known?.smooth ? { smooth: true } : {}) };
        lines.push(line);
        // (A line whose nodes say how the surface leaves it needs nothing more)
        if (!plane && !isOrientedLine(line)) loose++;
    });
    if (loose > 0) {
        notes.push(`${count(loose, 'line does', 'lines do')} not lie in one plane (a section or a plan): the surface passes along ${loose === 1 ? 'it' : 'them'}, and how it lies there comes from the rest (or from dip measurements placed on ${loose === 1 ? 'its' : 'their'} nodes).`);
    }

    const lineRoom = Math.max(0, MAX_IMPORT_LINES - surface.polylines.length);
    if (lines.length > lineRoom) {
        notes.push(`Of ${count(lines.length, 'line', 'lines')}, the ${count(lineRoom, 'longest was', 'longest were')} used (a surface takes ${MAX_IMPORT_LINES.toLocaleString()}).`);
        lines = lines.map(l => ({ l, length: lineLength(l.points) })).sort((a, b) => b.length - a.length).slice(0, lineRoom).map(x => x.l);
    }
    // Taken whole; the fit takes every node while there is room for them
    const nodes = (onSlices: boolean) => [...surface.polylines, ...lines].reduce((n, l) => n + (isOrientedLine(l) === onSlices ? l.points.length : 0), 0);
    const over = lines.length === 0 ? null
        : nodes(true) > MAX_LINE_SAMPLES ? { nodes: nodes(true), most: MAX_LINE_SAMPLES, where: 'on sections and plans' }
            : nodes(false) > MAX_FREE_SAMPLES ? { nodes: nodes(false), most: MAX_FREE_SAMPLES, where: 'in space' } : null;
    if (over) {
        notes.push(`The surface's lines ${over.where} now have ${over.nodes.toLocaleString()} nodes, more than it is fitted at (${over.most.toLocaleString()}). They are kept whole, but each is fitted at the nodes that shape it most: detail finer than that is not followed.`);
    }
    const ticks = lines.reduce((n, l) => n + (l.nodes?.filter(node => node?.reading).length ?? 0), 0);
    const directions = lines.reduce((n, l) => n + (l.nodes?.filter(node => node?.direction).length ?? 0), 0);
    const readingRoom = Math.max(0, MAX_READINGS - surface.points.filter(p => p.reading).length);
    let readings = measured;
    if (measured.length > readingRoom) {
        readings = pickSpread(measured.flatMap(q => q.p), readingRoom).map(i => measured[i]);
        notes.push(`Of ${count(measured.length, 'dip measurement', 'dip measurements')}, ${readings.length.toLocaleString()} spread through them were used (a surface takes ${MAX_READINGS.toLocaleString()}).`);
    }
    const pointRoom = Math.max(0, MAX_SURFACE_POINTS - surface.points.length - readings.length);
    const thinned = pointRoom > 0 ? thinPoints(plain, pointRoom) : new Float64Array(0);
    if (thinned.length < plain.length) {
        notes.push(`${count(plain.length / 3, 'point was', 'points were')} grouped into ${(thinned.length / 3).toLocaleString()} (a surface is fitted through ${MAX_SURFACE_POINTS.toLocaleString()} at most).`);
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
    const kept = model.addPolylines(surfaceId, lines).filter(Boolean).length;
    // (Readings on the nodes of lines count with the readings)
    return { points: points.length - readings.length, readings: readings.length + ticks, lines: kept, ...(directions > 0 ? { directions } : {}), notes };
}

/** What `addShapes` did, as a sentence: "12 points, 3 dip readings and 2 lines were added." */
export function describeAdded(added: AddedShapes): string {
    const parts = [
        added.points > 0 && count(added.points, 'point', 'points'),
        added.readings > 0 && count(added.readings, 'dip measurement', 'dip measurements'),
        added.lines > 0 && count(added.lines, 'line', 'lines'),
        (added.directions ?? 0) > 0 && count(added.directions!, 'node direction', 'node directions'),
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
export function contactSurface(coords: SceneCoords, rule: ContactRule, name?: string): string | null {
    const a = unitsLabel(rule.sideA), b = unitsLabel(rule.sideB);
    return loggedSurface(coords, { name: name ?? `${a} / ${b}`, rule, sides: [a, b] });
}

/**
 * The ground from the hole collars, made and opened: a new surface through the
 * top of every hole (`groundSurface`), with what there is to say of it (null:
 * nothing). In a view's columns, or with no view the model's (`defaultCoords`).
 */
export function groundFromCollars(coords: SceneCoords): ViewNote {
    const out = groundSurface(coords);
    if (!out.ok) {
        return {
            severity: 'warning',
            text: out.reason === 'too-few' ? 'The ground needs two holes or more.'
                : out.reason === 'no-holes' ? 'This needs the hole ID, From and coordinate columns.'
                    : 'The surfaces of this project were built in other coordinate columns.',
        };
    }
    useModelStore.getState().setEditing(out.id);
    const notes = [
        out.points < out.holes ? `${out.holes.toLocaleString()} collars were grouped into ${out.points} points (a surface is fitted through ${MAX_SURFACE_POINTS} at most).` : '',
        // A hole whose top was not sampled: its collar is where its line would reach depth 0
        out.left.length > 0 ? `${out.left.length === 1 ? 'One hole starts' : `${out.left.length} holes start`} well below the holes round ${out.left.length === 1 ? 'it' : 'them'} (drilled from underground?) and ${out.left.length === 1 ? 'was' : 'were'} left out: ${out.left.slice(0, 5).join(', ')}${out.left.length > 5 ? ', …' : ''}. Add a point by hand if one of them is on the ground.` : '',
        out.carried > 20 ? `Some holes have no sample near their top: their collars were carried up the hole by as much as ${Math.round(out.carried)} m, and are less sure.` : '',
    ].filter(Boolean);
    return notes.length > 0 ? { severity: 'info', text: notes.join(' ') } : null;
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
export function shellName(rule: Pick<ShellRule, 'column' | 'cutoff' | 'of'>): string {
    return shellLabel(rule.column, rule.cutoff, !!rule.of);
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

/**
 * A new numeric model: a grade shell for each cut-off of a column, all found
 * the same way (features/model/numericModels). Its id, or null when the
 * project's surfaces are in other coordinate columns than these, or the
 * model cannot be kept.
 */
export function numericModelFrom(coords: SceneCoords, rule: Omit<ShellRule, 'cutoff'>, cutoffs: readonly number[], domain: Domain | null = null): string | null {
    const model = useModelStore.getState();
    const { scene } = model;
    if (scene.surfaces.length > 0 && !sameCoords(scene.coords, coords.x, coords.y, coords.z)) return null;
    const c = scene.coords;
    if (!sameCoords(c, coords.x, coords.y, coords.z) || c?.hole !== coords.hole || c?.from !== coords.from || c?.to !== coords.to) model.setCoords(coords);
    return model.addNumericModel({ rule, cutoffs, domain });
}

/**
 * A numeric model for each lithology of a geological model, like this one:
 * the same column, cut-offs and settings, each kept inside its own
 * lithology ("Au in Sediment"). A lithology that has one already (of the
 * same column, kept inside it alone) is passed over. The ids of those made.
 */
export function numericModelsByUnit(numericId: string, geoModelId: string): string[] {
    const model = useModelStore.getState();
    const from = model.scene.numericModels?.find(m => m.id === numericId);
    const geo = model.scene.models?.find(m => m.id === geoModelId);
    if (!from || !geo) return [];
    const made: string[] = [];
    for (const unit of modelUnits(model.scene, geo)) {
        const have = useModelStore.getState().scene.numericModels ?? [];
        if (have.some(m => { const d = unitDomain(m.domain); return m.rule.column === from.rule.column && !!d && d.model === geo.id && !d.sides?.length && domainUnits(d).length === 1 && d.unit === unit; })) continue;
        const id = model.addNumericModel({ name: `${from.rule.column} in ${unit}`, rule: from.rule, cutoffs: from.shells.map(s => s.cutoff), domain: { model: geo.id, unit } });
        if (id) made.push(id);
    }
    return made;
}

export function loggedSurface(coords: SceneCoords, init: NewSurface): string | null {
    const model = useModelStore.getState();
    const { scene } = model;
    if (scene.surfaces.length > 0 && !sameCoords(scene.coords, coords.x, coords.y, coords.z)) return null;
    const c = scene.coords;
    // The hole and depth columns are needed to follow the logging: take the view's
    if (!sameCoords(c, coords.x, coords.y, coords.z) || c?.hole !== coords.hole || c?.from !== coords.from || c?.to !== coords.to) model.setCoords(coords);
    return model.addSurface(init);
}

/**
 * A stretch of its units given to one vein of the set a surface is in
 * (`to`: that vein's id; null: to none of them). The vein that had it and
 * the one it goes to are changed, as one step back. False: nothing changed.
 */
export function giveStretchTo(surface: SurfaceObject, zone: Zone, to: string | null): boolean {
    const model = useModelStore.getState();
    const changed = giveStretch(veinsOfSet(model.scene.surfaces, surface), zone, to);
    for (const c of changed) model.updateSurface(c.id, { rule: c.rule });
    return changed.length > 0;
}

/**
 * A vein of a vein system made to stop at another vein of it (`at`: that
 * vein's id, one before it in the system's order; null: at nothing). It is
 * put on the side of that vein's reference surface most of its own
 * stretches are on (the first side where that vein is not fitted yet).
 * False: it may not stop there.
 */
export function stopVeinAt(surfaceId: string, at: string | null): boolean {
    const model = useModelStore.getState();
    if (!at) return model.setVeinStop(surfaceId, null);
    const surface = model.scene.surfaces.find(s => s.id === surfaceId);
    const other = useModelCache.getState().byId[at]?.field ?? null;
    const found = surface ? contactInputsFor(surface) : null;
    const middles = found ? veinMiddles(found) : new Float64Array(0);
    const side = other && middles.length > 0 ? stopSide(evaluateField(other.walls ? { ...other, walls: null } : other, middles)) : 1;
    return model.setVeinStop(surfaceId, { surface: at, side });
}

/**
 * The veins a set of units was told apart into, made as one vein system:
 * a vein of each (`rules`, each with its own stretches), the first of them
 * the surface being edited when there is one. One step back undoes it all.
 * The ids of the system and of its first vein (null: nothing could be made).
 */
export function makeVeinSystem(coords: SceneCoords, name: string, rules: readonly BodyRule[], first: string | null = null): { system: string | null; first: string } | null {
    const ids: string[] = [];
    rules.forEach((rule, k) => {
        const own = `${name} ${k + 1}`;
        if (k === 0 && first) { useModelStore.getState().updateSurface(first, { rule, name: own }); ids.push(first); return; }
        const id = loggedSurface(coords, { name: own, rule });
        if (id) ids.push(id);
    });
    if (ids.length === 0) return null;
    // The surface edited is a contact of a model: the veins made beside it are that model's too, of the same unit, next after it in age
    if (first && ids.length > 1) {
        for (const model of useModelStore.getState().scene.models ?? []) {
            const at = model.contacts.findIndex(c => c.surface === first);
            if (at < 0) continue;
            const { kind, young, unit, within, across, off } = model.contacts[at];
            ids.slice(1).forEach((id, k) => {
                useModelStore.getState().addModelContact(model.id, { surface: id, kind, young, unit, ...(within ? { within } : {}), ...(across ? { across } : {}), ...(off ? { off } : {}) }, at + 1 + k);
            });
        }
    }
    return { system: ids.length > 1 ? useModelStore.getState().addVeinSystem({ name, veins: ids }) : null, first: ids[0] };
}

/**
 * A vein system put in a geological model: each of its veins a contact that
 * cuts through what is older (an intrusion), all of them of one unit, the
 * youngest of the model, in the system's order (the first of them the
 * youngest: where two of them overlap, the ground is the first one's). The
 * unit is the one its veins are of already in that model, or the one unit
 * they are built from, or the system's name. Veins of it that are contacts
 * there already are left as they are. One step back undoes it all. Null: no
 * such system or model. `from`: where in the age order its first vein goes
 * when none of them is there yet (0, the youngest, unless given).
 */
export function addSystemToModel(modelId: string, systemId: string, from = 0): { made: number; unit: string } | null {
    const store = useModelStore.getState();
    const system = store.scene.veinSystems?.find(v => v.id === systemId), model = store.scene.models?.find(m => m.id === modelId);
    if (!system || !model) return null;
    const first = store.scene.surfaces.find(s => s.id === system.veins[0]);
    const inside = first?.rule.kind === 'body' ? first.rule.inside : [];
    const unit = model.contacts.find(c => !!c.surface && system.veins.includes(c.surface))?.unit ?? (inside.length === 1 ? inside[0] : system.name);
    let made = 0, at = from;
    for (const id of system.veins) {
        const had = useModelStore.getState().scene.models?.find(m => m.id === modelId)?.contacts.findIndex(c => c.surface === id) ?? -1;
        if (had >= 0) { at = had + 1; continue; }
        if (useModelStore.getState().addModelContact(modelId, { surface: id, kind: 'intrusion', young: 1, unit }, at) !== null) { made++; at++; }
    }
    return { made, unit };
}

/** Whether a model has a vein system: 'all' of its veins as contacts, 'some' of them, or 'none' */
export function systemInModel(scene: Pick<ModelScene, 'models'>, modelId: string, system: Pick<VeinSystem, 'veins'>): { state: 'all' | 'some' | 'none'; unit: string | null } {
    const contacts = scene.models?.find(m => m.id === modelId)?.contacts ?? [];
    const own = contacts.filter(c => !!c.surface && system.veins.includes(c.surface));
    return { state: own.length === 0 ? 'none' : own.length >= system.veins.length ? 'all' : 'some', unit: own[0]?.unit ?? null };
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

/**
 * The finished meshes of these surfaces (those that have one), named as in
 * the scene, and made fit for other software: no edge with more than two
 * triangles on it (meshClean.ts).
 */
export function surfaceMeshes(ids: readonly string[]): NamedMesh[] {
    const cache = useModelCache.getState().byId;
    const out: NamedMesh[] = [];
    for (const s of useModelStore.getState().scene.surfaces) {
        const part = ids.includes(s.id) ? cache[s.id]?.part : null;
        if (!part || part.triangles.length === 0) continue;
        const { mesh } = cleanMesh({ vertices: Float64Array.from(part.vertices), triangles: Uint32Array.from(part.triangles) });
        out.push({ name: s.name, vertices: mesh.vertices, triangles: mesh.triangles });
    }
    return out;
}

/** Save surfaces as one mesh file. False when none of them has a mesh yet. */
export function exportSurfaces(ids: readonly string[], format: MeshFormat, projectName = 'surfaces'): boolean {
    const meshes = surfaceMeshes(ids);
    if (meshes.length === 0) return false;
    const mime = MESH_FORMATS.find(f => f.format === format)?.mime ?? 'text/plain';
    downloadText(meshesToFile(format, meshes), meshFileName(format, meshes, projectName), mime);
    return true;
}

/** A surface's rebuild kit as it is now (null: no such surface) */
export function surfaceKitOf(id: string): SurfaceKit | null {
    const { scene } = useModelStore.getState();
    const surface = scene.surfaces.find(s => s.id === id);
    if (!surface) return null;
    const part = useModelCache.getState().byId[id]?.part;
    return surfaceKit({
        surface, coords: scene.coords,
        logged: contactInputsFor(surface)?.contacts ?? null,
        mesh: part && part.triangles.length > 0 ? { vertices: Float64Array.from(part.vertices), triangles: Uint32Array.from(part.triangles) } : null,
        box: sceneDataBox(),
        version: BUILD_VERSION, date: localDate(),
    });
}

/**
 * Save a surface's rebuild kit: what it was built from, its mesh and a note
 * of how it was set, as one zip (rebuildKit.ts). False when there is no such
 * surface, or it has nothing to write yet.
 */
export function exportKit(id: string): boolean {
    const kit = surfaceKitOf(id);
    // (The note alone is not a kit)
    if (!kit || kit.files.length <= 1) return false;
    downloadText(zipStore(kit.files), `${kit.folder} Leapfrog export.zip`, 'application/zip');
    return true;
}

/**
 * Lines of a surface, each on a plane of a section set, copied onto the plane
 * `step` on from its own (the next section, to be moved into place there): one
 * edit, into the set the surface's new lines go in. `setId`: the section set
 * whose planes they are stepped along (left out: the first set each is on).
 * How many were copied (lines on no plane of the set are not).
 */
export function copyLinesToSection(surfaceId: string, lineIds: readonly string[], step: number, setId?: string): number {
    const { scene } = useModelStore.getState();
    const surface = scene.surfaces.find(s => s.id === surfaceId);
    if (!surface || !step) return 0;
    const sets = setId === undefined ? scene.sectionSets : scene.sectionSets?.filter(s => s.id === setId);
    const wanted = new Set(lineIds);
    const copies = surface.polylines.filter(l => wanted.has(l.id)).flatMap(line => {
        const on = sectionOfLine(line, sets);
        const copy = on && copyToSection(line, on.set, on.index, step);
        return copy ? [copy] : [];
    });
    if (copies.length === 0) return 0;
    return useModelStore.getState().addPolylines(surfaceId, copies).filter(Boolean).length;
}