/**
 * Where meshes cut a flat plane (pure, unit-tested): the lines a surface or
 * wireframe makes on a cross-section, or on a level plan.
 */
import type { SurfaceResult } from './modelCache';
import { keys } from './objectKeys';
import type { WireframeFile } from './wireframeFiles';
import type { Plane, SurfaceObject, TriMesh, WireframeObject } from './types';

/**
 * The lines a mesh makes on a plane, each as xyz triples. A line that comes
 * back to where it started (the cut through a closed body) ends with its
 * first point again.
 */
export function sectionMesh(mesh: TriMesh, plane: Plane): Float64Array[] {
    const { vertices: v, triangles: t } = mesh;
    const n = v.length / 3;
    const [nx, ny, nz] = plane.normal, [px, py, pz] = plane.point;
    // Height of every vertex above the plane; one exactly on it counts as above, so no triangle is cut at a corner twice
    const d = new Float64Array(n);
    let above = 0;
    for (let i = 0; i < n; i++) {
        d[i] = (v[i * 3] - px) * nx + (v[i * 3 + 1] - py) * ny + (v[i * 3 + 2] - pz) * nz;
        if (d[i] >= 0) above++;
    }
    if (above === 0 || above === n) return [];

    // One point for every edge the plane passes through, shared by the triangles either side of the edge
    const points: number[] = [];
    const onEdge = new Map<number, number>();
    const cut = (a: number, b: number) => {
        const lo = Math.min(a, b), hi = Math.max(a, b);
        const key = lo * n + hi;
        const have = onEdge.get(key);
        if (have !== undefined) return have;
        const s = d[lo] / (d[lo] - d[hi]);
        const id = points.length / 3;
        for (let c = 0; c < 3; c++) points.push(v[lo * 3 + c] + (v[hi * 3 + c] - v[lo * 3 + c]) * s);
        onEdge.set(key, id);
        return id;
    };
    // Each triangle the plane passes through gives one piece, from one of its edges to another
    const ends: number[] = [];
    for (let q = 0; q < t.length; q += 3) {
        const a = t[q], b = t[q + 1], c = t[q + 2];
        const sa = d[a] >= 0, sb = d[b] >= 0, sc = d[c] >= 0;
        if (sa === sb && sb === sc) continue;
        // The corner on its own side of the plane: the piece joins the two edges that meet at it
        const [odd, p, r] = sa !== sb && sa !== sc ? [a, b, c] : sb !== sa && sb !== sc ? [b, c, a] : [c, a, b];
        ends.push(cut(odd, p), cut(odd, r));
    }

    // Join the pieces end to end
    const count = points.length / 3;
    const first = new Int32Array(count).fill(-1), second = new Int32Array(count).fill(-1);
    const extra = new Map<number, number[]>();
    const link = (at: number, piece: number) => {
        if (first[at] < 0) first[at] = piece;
        else if (second[at] < 0) second[at] = piece;
        else {
            const more = extra.get(at);
            if (more) more.push(piece);
            else extra.set(at, [piece]);
        }
    };
    const pieces = ends.length / 2;
    for (let s = 0; s < pieces; s++) {
        link(ends[s * 2], s);
        link(ends[s * 2 + 1], s);
    }
    const used = new Uint8Array(pieces);
    /** A piece at this point not yet walked along (-1: none) */
    const next = (at: number) => {
        if (first[at] >= 0 && !used[first[at]]) return first[at];
        if (second[at] >= 0 && !used[second[at]]) return second[at];
        for (const s of extra.get(at) ?? []) if (!used[s]) return s;
        return -1;
    };
    const lines: Float64Array[] = [];
    const walk = (start: number) => {
        const ids = [start];
        for (let at = start; ;) {
            const s = next(at);
            if (s < 0) break;
            used[s] = 1;
            at = ends[s * 2] === at ? ends[s * 2 + 1] : ends[s * 2];
            ids.push(at);
        }
        if (ids.length < 2) return;
        const line = new Float64Array(ids.length * 3);
        ids.forEach((id, k) => line.set(points.slice(id * 3, id * 3 + 3), k * 3));
        lines.push(line);
    };
    // Lines with an end first (a sheet, cut from edge to edge), then the closed ones
    for (let id = 0; id < count; id++) if (second[id] < 0) walk(id);
    for (let id = 0; id < count; id++) walk(id);
    return lines;
}

/** What one surface or wireframe draws on a plane */
export interface SceneTrace {
    /** 'surface:<id>' or 'wireframe:<id>' */
    id: string;
    name: string;
    color: string;
    lines: Float64Array[];
}

const planeKey = (p: Plane) => `${p.normal.join(',')}|${p.point.join(',')}`;
/** The last cut of each mesh: the same mesh on the same plane is not cut again */
const cuts = new WeakMap<TriMesh, { key: string; lines: Float64Array[] }>();

function cutOf(mesh: TriMesh, plane: Plane): Float64Array[] {
    const key = planeKey(plane);
    const have = cuts.get(mesh);
    if (have?.key === key) return have.lines;
    const lines = sectionMesh(mesh, plane);
    cuts.set(mesh, { key, lines });
    return lines;
}

/**
 * The lines the scene's surfaces and wireframes make on a plane, less those
 * the plot hides (`hidden`: keys, features/model/viewVisibility).
 * `surfaces`: null when the plot is in other coordinate columns than the
 * surfaces were built in (wireframes carry their own coordinates and are
 * still cut).
 */
export function sceneTraces(
    plane: Plane, surfaces: readonly SurfaceObject[] | null, fits: Record<string, SurfaceResult>,
    wireframes: readonly WireframeObject[], files: Record<string, WireframeFile>, hidden: ReadonlySet<string>,
): SceneTrace[] {
    const out: SceneTrace[] = [];
    for (const w of wireframes) {
        const id = keys.wireframe(w.id);
        const part = hidden.has(id) ? null : files[w.file]?.parts[w.part];
        if (!part || part.triangles.length === 0) continue;
        const lines = cutOf(part, plane);
        if (lines.length > 0) out.push({ id, name: w.name, color: w.color, lines });
    }
    for (const s of surfaces ?? []) {
        const id = keys.surface(s.id);
        const part = hidden.has(id) ? null : fits[s.id]?.part;
        if (!part || part.triangles.length === 0) continue;
        const lines = cutOf(part, plane);
        if (lines.length > 0) out.push({ id, name: s.name, color: s.color, lines });
    }
    return out;
}

/** The upright plane of a cross-section through an origin, along an azimuth (degrees clockwise from north). */
export function sectionPlane(originE: number, originN: number, azimuth: number): Plane {
    const a = (azimuth * Math.PI) / 180;
    // Across the section: to the right of the way it runs
    return { normal: [Math.cos(a), -Math.sin(a), 0], point: [originE, originN, 0] };
}

/** The level plane at an elevation. */
export const levelPlane = (elevation: number): Plane => ({ normal: [0, 0, 1], point: [0, 0, elevation] });
