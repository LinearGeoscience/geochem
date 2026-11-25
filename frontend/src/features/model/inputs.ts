/**
 * Inputs as objects (pure, unit-tested): the points and lines surfaces are
 * shaped by live in named sets on the scene, and a surface lists the sets it
 * uses. One set can shape several surfaces, each taking its lines its own
 * way up, and a set can be shown, locked, filed and written out on its own.
 *
 * The fits read a surface's `points` and `polylines`, as they always have.
 * Those are worked out here from the sets the surface uses (`resolveScene`),
 * so nothing that reads a surface needs to know about sets. A surface that
 * comes without `uses` (a project from before, a surface written out by
 * hand) is given sets of its own from the points and lines it carries, with
 * the same points and lines in the same order: it fits exactly as it did.
 */
import type { InputSet, LineSet, ModelScene, PointSet, SceneLine, ScenePoint, ScenePolyline, SurfaceObject, SurfaceUse } from './types';

/** The names a surface's own sets are given */
export const ownSetName = (surface: string, kind: InputSet['kind']) => `${surface} ${kind === 'points' ? 'points' : 'lines'}`;

/** The next free number for ids with this prefix (p1, p2, ...). */
export function nextIdNumber(prefix: string, taken: Iterable<string>): number {
    let max = 0;
    for (const id of taken) {
        if (!id.startsWith(prefix)) continue;
        const n = Number(id.slice(prefix.length));
        if (Number.isInteger(n) && n > max) max = n;
    }
    return max + 1;
}

/** Every point id and every line id in the scene's sets. */
export function inputIds(sets: readonly InputSet[]): { points: Set<string>; lines: Set<string> } {
    const points = new Set<string>(), lines = new Set<string>();
    for (const set of sets) {
        if (set.kind === 'points') for (const p of set.points) points.add(p.id);
        else for (const l of set.lines) lines.add(l.id);
    }
    return { points, lines };
}

// A line as one surface takes it, kept per line so the same line the same way up is the same object every time
const taken = new WeakMap<SceneLine, { up?: ScenePolyline; over?: ScenePolyline }>();

function lineFor(line: SceneLine, flipped: boolean): ScenePolyline {
    let kept = taken.get(line);
    if (!kept) taken.set(line, kept = {});
    if (flipped) return kept.over ??= { ...line, flipped: true };
    return kept.up ??= { ...line, flipped: false };
}

const same = <T>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * A surface with its points and lines as its sets have them now. The same
 * object comes back when nothing it uses has changed, and each list is kept
 * when its contents are the same, so nothing downstream is worked out again.
 */
export function resolveSurface(surface: SurfaceObject, sets: ReadonlyMap<string, InputSet>): SurfaceObject {
    const points: ScenePoint[] = [], polylines: ScenePolyline[] = [];
    const weighted = (surface.uses ?? []).some(u => u.weight !== undefined);
    const pointWeights: number[] = [], lineWeights: number[] = [];
    for (const use of surface.uses ?? []) {
        const set = sets.get(use.set);
        if (!set) continue;
        const weight = use.weight ?? 1;
        // One by one: a set can be too long to spread
        if (set.kind === 'points') for (const p of set.points) { points.push(p); if (weighted) pointWeights.push(weight); }
        else {
            const flipped = use.flipped?.length ? new Set(use.flipped) : null;
            for (const line of set.lines) { polylines.push(lineFor(line, !!flipped?.has(line.id))); if (weighted) lineWeights.push(weight); }
        }
    }
    const samePoints = same(points, surface.points), sameLines = same(polylines, surface.polylines);
    const was = surface.weights;
    const sameWeights = weighted ? !!was && same(was.points, pointWeights) && same(was.lines, lineWeights) : !was;
    if (samePoints && sameLines && sameWeights) return surface;
    const { weights: _weights, ...rest } = surface;
    return {
        ...rest, points: samePoints ? surface.points : points, polylines: sameLines ? surface.polylines : polylines,
        ...(weighted ? { weights: sameWeights ? was! : { points: pointWeights, lines: lineWeights } } : {}),
    };
}

/**
 * Ids for what one surface carries, told apart from every id already `taken`
 * (ids are unique across the whole scene). An id no one has is kept; one that
 * is taken gets the next number above every id there is.
 */
function freeIds(prefix: string, own: readonly string[], taken: Set<string>): string[] {
    let n = 0;
    return own.map(id => {
        if (!taken.has(id)) { taken.add(id); return id; }
        if (n === 0) n = nextIdNumber(prefix, [...taken, ...own]);
        const fresh = `${prefix}${n++}`;
        taken.add(fresh);
        return fresh;
    });
}

/** A name no set has yet: the name itself, or with (2), (3)... after it. */
export function freeSetName(name: string, sets: readonly InputSet[]): string {
    const names = new Set(sets.map(s => s.name));
    let out = name;
    for (let k = 2; names.has(out); k++) out = `${name} (${k})`;
    return out;
}

/** Sets of its own for a surface that carries its points and lines itself, and the surface using them. */
function liftSurface(surface: SurfaceObject, sets: InputSet[], ids: { points: Set<string>; lines: Set<string> }): SurfaceObject {
    const uses: SurfaceUse[] = [];
    const setId = () => `i${nextIdNumber('i', sets.map(s => s.id))}`;
    const common = { color: surface.color, visible: true, locked: false, folder: null, owner: surface.id };
    if (surface.points.length > 0) {
        const fresh = freeIds('p', surface.points.map(p => p.id), ids.points);
        const points = surface.points.map((p, i) => (fresh[i] === p.id ? p : { ...p, id: fresh[i] }));
        const set: PointSet = { id: setId(), name: freeSetName(ownSetName(surface.name, 'points'), sets), kind: 'points', ...common, points };
        sets.push(set);
        uses.push({ set: set.id });
    }
    if (surface.polylines.length > 0) {
        const fresh = freeIds('l', surface.polylines.map(l => l.id), ids.lines);
        const lines = surface.polylines.map(({ flipped: _flipped, ...line }, i): SceneLine => ({ ...line, id: fresh[i] }));
        const flipped = fresh.filter((_, i) => surface.polylines[i].flipped);
        const set: LineSet = { id: setId(), name: freeSetName(ownSetName(surface.name, 'lines'), sets), kind: 'lines', ...common, lines };
        sets.push(set);
        uses.push({ set: set.id, ...(flipped.length ? { flipped } : {}) });
    }
    return { ...surface, uses };
}

/** A surface's uses with nothing in them that is not there: sets that are gone, a set twice, lines a set no longer has. */
function cleanUses(uses: readonly SurfaceUse[], sets: ReadonlyMap<string, InputSet>): SurfaceUse[] | null {
    const seen = new Set<string>();
    let changed = false;
    const out: SurfaceUse[] = [];
    for (const use of uses) {
        const set = sets.get(use.set);
        if (!set || seen.has(use.set)) { changed = true; continue; }
        seen.add(use.set);
        if (use.flipped?.length) {
            const has = set.kind === 'lines' ? new Set(set.lines.map(l => l.id)) : new Set<string>();
            const flipped = use.flipped.filter(id => has.has(id));
            if (flipped.length !== use.flipped.length) {
                changed = true;
                out.push({ set: use.set, ...(flipped.length ? { flipped } : {}), ...(use.weight !== undefined ? { weight: use.weight } : {}) });
                continue;
            }
        } else if (use.flipped) {
            changed = true;
            out.push({ set: use.set, ...(use.weight !== undefined ? { weight: use.weight } : {}) });
            continue;
        }
        out.push(use);
    }
    return changed ? out : null;
}

/**
 * The scene as the store keeps it: every surface lists the sets it uses, and
 * carries their points and lines as they are now. The same scene comes back
 * when it is already so.
 */
export function resolveScene(scene: ModelScene): ModelScene {
    let sets = scene.inputs ?? [];
    let surfaces = scene.surfaces;
    if (surfaces.some(s => !s.uses)) {
        const lifted = sets.slice();
        const ids = inputIds(lifted);
        surfaces = surfaces.map(s => (s.uses ? s : liftSurface(s, lifted, ids)));
        sets = lifted;
    }
    const byId = new Map(sets.map(s => [s.id, s]));
    const resolved = surfaces.map(s => {
        const uses = cleanUses(s.uses!, byId);
        return resolveSurface(uses ? { ...s, uses } : s, byId);
    });
    const sameSurfaces = same(resolved, scene.surfaces);
    if (sameSurfaces && sets === scene.inputs) return scene;
    return { ...scene, inputs: sets, surfaces: sameSurfaces ? scene.surfaces : resolved };
}

/** A scene as the project file holds it: the surfaces without the points and lines of their sets */
export type SavedScene = Omit<ModelScene, 'surfaces'> & { surfaces: Omit<SurfaceObject, 'points' | 'polylines'>[] };

/**
 * The scene as it is written to the project file: a surface is saved with the
 * sets it uses, not with their points and lines a second time.
 */
export function savedScene(scene: ModelScene): SavedScene {
    return {
        ...scene,
        inputs: scene.inputs ?? [],
        surfaces: scene.surfaces.map(({ points: _points, polylines: _polylines, weights: _weights, ...kept }) => ({ ...kept, uses: kept.uses ?? [] })),
    };
}

/** The set each point and each line of the scene is in, by the point's or line's id. */
export function setOfInput(sets: readonly InputSet[]): Map<string, InputSet> {
    const out = new Map<string, InputSet>();
    for (const set of sets) {
        if (set.kind === 'points') for (const p of set.points) out.set(p.id, set);
        else for (const l of set.lines) out.set(l.id, set);
    }
    return out;
}

/** The surfaces that use a set. */
export const surfacesUsing = (scene: ModelScene, setId: string): SurfaceObject[] =>
    scene.surfaces.filter(s => s.uses?.some(u => u.set === setId));

/** The ids of the points and lines of a surface that are in locked sets: they cannot be moved or removed. */
export function lockedInputs(scene: ModelScene, surface: SurfaceObject): Set<string> {
    const used = new Set((surface.uses ?? []).map(u => u.set));
    const out = new Set<string>();
    for (const set of scene.inputs ?? []) {
        if (!set.locked || !used.has(set.id)) continue;
        if (set.kind === 'points') for (const p of set.points) out.add(p.id);
        else for (const l of set.lines) out.add(l.id);
    }
    return out;
}

/** What a set is, in a few words: "12 points", "1 line". */
export function setText(set: InputSet): string {
    const n = setSize(set);
    return set.kind === 'points' ? `${n.toLocaleString()} ${n === 1 ? 'point' : 'points'}` : `${n.toLocaleString()} ${n === 1 ? 'line' : 'lines'}`;
}

/**
 * A set as it is drawn when no surface that uses it is open: its lines as
 * they run, and a small cross (`size` across, three strokes) at each point.
 * World coordinates; `lines` holds two vertex numbers per stroke.
 */
export function setMarks(set: InputSet, size: number): { vertices: Float64Array; lines: Uint32Array } {
    if (set.kind === 'points') {
        const n = set.points.length, h = size / 2;
        const vertices = new Float64Array(n * 18), lines = new Uint32Array(n * 6);
        set.points.forEach(({ p }, i) => {
            for (let axis = 0; axis < 3; axis++) {
                const at = i * 18 + axis * 6;
                vertices.set(p, at);
                vertices.set(p, at + 3);
                vertices[at + axis] -= h;
                vertices[at + 3 + axis] += h;
            }
        });
        for (let k = 0; k < lines.length; k++) lines[k] = k;
        return { vertices, lines };
    }
    const count = set.lines.reduce((sum, l) => sum + l.points.length, 0);
    const vertices = new Float64Array(count * 3);
    const strokes: number[] = [];
    let at = 0;
    for (const line of set.lines) {
        line.points.forEach((p, i) => {
            vertices.set(p, at * 3);
            if (i > 0) strokes.push(at - 1, at);
            at++;
        });
    }
    return { vertices, lines: Uint32Array.from(strokes) };
}

/** The folders the sets are filed under, in the order they first appear; the sets in none come first (folder null). */
export function setFolders(sets: readonly InputSet[]): { folder: string | null; sets: InputSet[] }[] {
    const out: { folder: string | null; sets: InputSet[] }[] = [];
    const loose = sets.filter(s => s.folder === null);
    if (loose.length > 0) out.push({ folder: null, sets: loose });
    for (const set of sets) {
        if (set.folder === null) continue;
        const group = out.find(g => g.folder === set.folder);
        if (group) group.sets.push(set);
        else out.push({ folder: set.folder, sets: [set] });
    }
    return out;
}

/** How many points or lines a set holds. */
export const setSize = (set: InputSet): number => (set.kind === 'points' ? set.points.length : set.lines.length);

/**
 * The set what is placed or drawn for a surface goes into: the one made for
 * it, of that kind, that it uses and is not locked. Null when there is none
 * (one is then made).
 */
export function ownSet<K extends InputSet['kind']>(scene: ModelScene, surface: SurfaceObject, kind: K): Extract<InputSet, { kind: K }> | null {
    const used = new Set((surface.uses ?? []).map(u => u.set));
    const set = (scene.inputs ?? []).find(s => s.kind === kind && s.owner === surface.id && !s.locked && used.has(s.id));
    return (set as Extract<InputSet, { kind: K }> | undefined) ?? null;
}
