/**
 * A mesh made fit to hand to other software (pure, unit-tested).
 *
 * Modelling packages take a mesh as a surface only when no edge has more
 * than two triangles on it. The meshes built here mostly are like that, but
 * not always: where two parts of a surface come within a cell of each other
 * the mesher joins them along an edge or at a corner, and trimming can leave
 * corners doubled, slivers with no area, and the same triangle twice.
 *
 * cleanMesh joins corners that are at one place, drops triangles with no
 * area and triangles that are there twice, and then takes apart the places
 * where more than two triangles share an edge, or where two sheets touch at
 * a corner: each sheet gets corners of its own there (at the same place, so
 * the shape, and the volume, are as they were).
 */
import type { TriMesh } from './types';

/** What a mesh is like, counted over its edges */
export interface MeshCheck {
    vertices: number;
    triangles: number;
    /** Edges with one triangle: the rim of an open surface (none: it is closed) */
    openEdges: number;
    /** Edges with more than two triangles */
    crowdedEdges: number;
    /** Edges whose two triangles face opposite ways */
    turnedEdges: number;
    /** No edge has more than two triangles and neighbours face the same way */
    manifold: boolean;
    /** Manifold, with no rim */
    closed: boolean;
}

export interface CleanReport {
    /** Corners joined to another at the same place */
    joined: number;
    /** Triangles with no area, dropped */
    flat: number;
    /** Triangles that were there twice (or back to back), dropped */
    doubled: number;
    /** Corners added where sheets that only touched were taken apart */
    parted: number;
    /** Corners added where an edge could only be freed by opening a seam along it */
    torn: number;
}

const edgeKey = (a: number, b: number) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);

/** Count the edges of a mesh by how many triangles are on each. */
export function checkMesh(mesh: TriMesh): MeshCheck {
    const t = mesh.triangles;
    // Per edge: how many triangles, and how many of them run along it from its lower corner to its higher
    const count = new Map<number, number>(), forward = new Map<number, number>();
    for (let q = 0; q + 2 < t.length; q += 3) {
        for (let k = 0; k < 3; k++) {
            const a = t[q + k], b = t[q + (k + 1) % 3];
            const key = edgeKey(a, b);
            count.set(key, (count.get(key) ?? 0) + 1);
            if (a < b) forward.set(key, (forward.get(key) ?? 0) + 1);
        }
    }
    let openEdges = 0, crowdedEdges = 0, turnedEdges = 0;
    for (const [key, n] of count) {
        if (n === 1) openEdges++;
        else if (n > 2) crowdedEdges++;
        else if ((forward.get(key) ?? 0) !== 1) turnedEdges++;
    }
    const manifold = crowdedEdges === 0 && turnedEdges === 0;
    return { vertices: mesh.vertices.length / 3, triangles: t.length / 3, openEdges, crowdedEdges, turnedEdges, manifold, closed: manifold && openEdges === 0 && t.length > 0 };
}

/** The volume a closed mesh holds (positive when its triangles face outwards). Meaningless for an open one. */
export function meshVolume(mesh: TriMesh): number {
    const v = mesh.vertices, t = mesh.triangles;
    if (v.length < 3) return 0;
    // Measured from a corner of the mesh: coordinates in the millions would lose the small differences
    const ox = v[0], oy = v[1], oz = v[2];
    let six = 0;
    for (let q = 0; q + 2 < t.length; q += 3) {
        const a = t[q] * 3, b = t[q + 1] * 3, c = t[q + 2] * 3;
        const ax = v[a] - ox, ay = v[a + 1] - oy, az = v[a + 2] - oz;
        const bx = v[b] - ox, by = v[b + 1] - oy, bz = v[b + 2] - oz;
        const cx = v[c] - ox, cy = v[c + 1] - oy, cz = v[c + 2] - oz;
        six += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    }
    return six / 6;
}

/**
 * How thick a closed mesh is across the way it is thinnest, on average: what
 * it holds over the area it covers seen from that way (looked for among
 * `ways` directions spread over a half sphere). A sheet's thickness, however
 * it lies and whatever its outline; two thirds of a ball's width. Pieces
 * that lie alike are one; folded, it reads a little thick. 0 for a mesh that
 * holds nothing.
 */
export function flatThickness(mesh: TriMesh, volume: number, ways = 200): number {
    const v = mesh.vertices, t = mesh.triangles;
    if (!(volume > 0) || t.length < 3) return 0;
    // Each triangle as its area along its normal
    const n = Math.floor(t.length / 3), ax = new Float64Array(n), ay = new Float64Array(n), az = new Float64Array(n);
    for (let q = 0; q < n; q++) {
        const a = t[q * 3] * 3, b = t[q * 3 + 1] * 3, c = t[q * 3 + 2] * 3;
        const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
        const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
        ax[q] = (uy * wz - uz * wy) / 2; ay[q] = (uz * wx - ux * wz) / 2; az[q] = (ux * wy - uy * wx) / 2;
    }
    // (Seen from a way, a closed mesh shows each part of what it covers twice: its near face and its far one)
    let most = 0;
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let k = 0; k < ways; k++) {
        const z = (k + 0.5) / ways, r = Math.sqrt(1 - z * z), x = r * Math.cos(k * golden), y = r * Math.sin(k * golden);
        let seen = 0;
        for (let q = 0; q < n; q++) seen += Math.abs(ax[q] * x + ay[q] * y + az[q] * z);
        if (seen > most) most = seen;
    }
    return most > 0 ? 2 * volume / most : 0;
}

/** The area of a mesh. */
export function meshArea(mesh: TriMesh): number {
    const v = mesh.vertices, t = mesh.triangles;
    let twice = 0;
    for (let q = 0; q + 2 < t.length; q += 3) {
        const a = t[q] * 3, b = t[q + 1] * 3, c = t[q + 2] * 3;
        const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
        const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
        twice += Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
    }
    return twice / 2;
}

/**
 * The triangles on each edge that has more than two, paired off into sheets.
 *
 * Looking along the edge, its triangles stand round it like the pages of an
 * open book. A triangle's back is towards one of its two neighbours round the
 * edge; two triangles back to back with nothing between them are one sheet
 * passing through the edge. Returns, per crowded edge, the pairs (triangle
 * numbers); a triangle with no partner is left out (its sheet ends there).
 */
function sheetsAtCrowdedEdges(vertices: ArrayLike<number>, t: ArrayLike<number>, byEdge: Map<number, number[]>): Map<number, [number, number][]> {
    const out = new Map<number, [number, number][]>();
    for (const [key, tris] of byEdge) {
        if (tris.length <= 2) continue;
        const a = Math.floor(key / 4294967296), b = key - a * 4294967296;
        const ux = vertices[b * 3] - vertices[a * 3], uy = vertices[b * 3 + 1] - vertices[a * 3 + 1], uz = vertices[b * 3 + 2] - vertices[a * 3 + 2];
        const len = Math.hypot(ux, uy, uz) || 1;
        const u = [ux / len, uy / len, uz / len];
        // Each triangle: the angle of its third corner round the edge, and whether it runs along the edge from a to b
        let e1: number[] | null = null, e2: number[] | null = null;
        const round = tris.map(tri => {
            let third = -1, along = false;
            for (let k = 0; k < 3; k++) {
                const p = t[tri * 3 + k];
                if (p !== a && p !== b) third = p;
                if (p === a && t[tri * 3 + (k + 1) % 3] === b) along = true;
            }
            const w = [vertices[third * 3] - vertices[a * 3], vertices[third * 3 + 1] - vertices[a * 3 + 1], vertices[third * 3 + 2] - vertices[a * 3 + 2]];
            const d = w[0] * u[0] + w[1] * u[1] + w[2] * u[2];
            const p = [w[0] - d * u[0], w[1] - d * u[1], w[2] - d * u[2]];
            if (!e1) {
                const n = Math.hypot(p[0], p[1], p[2]) || 1;
                e1 = [p[0] / n, p[1] / n, p[2] / n];
                e2 = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]];
            }
            const angle = Math.atan2(p[0] * e2![0] + p[1] * e2![1] + p[2] * e2![2], p[0] * e1[0] + p[1] * e1[1] + p[2] * e1[2]);
            return { tri, along, angle };
        }).sort((x, y) => x.angle - y.angle);
        // One that runs from a to b faces the way the angle grows: its back is to the one before it
        const pairs: [number, number][] = [];
        const taken = new Set<number>();
        const n = round.length;
        for (let i = 0; i < n; i++) {
            const here = round[i], before = round[(i + n - 1) % n];
            if (!here.along || before.along || taken.has(here.tri) || taken.has(before.tri)) continue;
            taken.add(here.tri);
            taken.add(before.tri);
            pairs.push([before.tri, here.tri]);
        }
        out.set(key, pairs);
    }
    return out;
}

/** Each edge's triangles (their numbers). */
function trianglesByEdge(t: ArrayLike<number>): Map<number, number[]> {
    const byEdge = new Map<number, number[]>();
    for (let q = 0; q + 2 < t.length; q += 3) {
        for (let k = 0; k < 3; k++) {
            const key = edgeKey(t[q + k], t[q + (k + 1) % 3]);
            const list = byEdge.get(key);
            if (list) list.push(q / 3);
            else byEdge.set(key, [q / 3]);
        }
    }
    return byEdge;
}

/**
 * The mesh with no edge shared by more than two triangles (see the top of
 * the file). `tolerance`: corners nearer than this (m) are one corner; the
 * default is the precision meshes are written to.
 */
export function cleanMesh(mesh: TriMesh, tolerance = 1e-4): { mesh: TriMesh; report: CleanReport } {
    const report: CleanReport = { joined: 0, flat: 0, doubled: 0, parted: 0, torn: 0 };
    const v = mesh.vertices;
    const nIn = v.length / 3;

    // 1. Corners at one place are one corner
    const cell = tolerance > 0 ? tolerance : 1e-9;
    const first = new Map<string, number>();
    const to = new Int32Array(nIn);
    const kept: number[] = [];
    for (let i = 0; i < nIn; i++) {
        const key = `${Math.round(v[i * 3] / cell)},${Math.round(v[i * 3 + 1] / cell)},${Math.round(v[i * 3 + 2] / cell)}`;
        const at = first.get(key);
        if (at !== undefined) { to[i] = at; continue; }
        to[i] = kept.length / 3;
        first.set(key, to[i]);
        kept.push(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);
    }

    // 2. Triangles with no area go; 3. so does a triangle that is there twice, and both of two that are back to back
    const tris: number[] = [];
    const seen = new Map<string, { at: number; even: boolean }>();
    const dead = new Set<number>();
    const src = mesh.triangles;
    for (let q = 0; q + 2 < src.length; q += 3) {
        const a = to[src[q]], b = to[src[q + 1]], c = to[src[q + 2]];
        const ux = kept[b * 3] - kept[a * 3], uy = kept[b * 3 + 1] - kept[a * 3 + 1], uz = kept[b * 3 + 2] - kept[a * 3 + 2];
        const wx = kept[c * 3] - kept[a * 3], wy = kept[c * 3 + 1] - kept[a * 3 + 1], wz = kept[c * 3 + 2] - kept[a * 3 + 2];
        const twice = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
        const longest = Math.max(Math.hypot(ux, uy, uz), Math.hypot(wx, wy, wz), Math.hypot(wx - ux, wy - uy, wz - uz));
        if (a === b || b === c || a === c || !(twice > 1e-9 * longest * longest)) { report.flat++; continue; }
        const low = Math.min(a, b, c), high = Math.max(a, b, c), mid = a + b + c - low - high;
        // (Turning a triangle's corners round keeps its facing; swapping two turns it over)
        const even = (a === low && b === mid) || (b === low && c === mid) || (c === low && a === mid);
        const key = `${low},${mid},${high}`;
        const was = seen.get(key);
        if (was) {
            report.doubled++;
            if (was.even !== even && !dead.has(was.at)) { dead.add(was.at); report.doubled++; }
            continue;
        }
        seen.set(key, { at: tris.length / 3, even });
        tris.push(a, b, c);
    }
    let t = dead.size > 0 ? tris.filter((_, i) => !dead.has(Math.floor(i / 3))) : tris;

    // 4. Sheets that share an edge or a corner get corners of their own. Two triangles are of one sheet at a corner
    // when they meet there along an edge that is theirs alone, or along a crowded edge as a back-to-back pair.
    const nTri = t.length / 3;
    const parent = new Int32Array(nTri * 3);
    for (let i = 0; i < parent.length; i++) parent[i] = i;
    const find = (i: number) => {
        while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
        return i;
    };
    const cornerOf = (tri: number, vertex: number) => (t[tri * 3] === vertex ? tri * 3 : t[tri * 3 + 1] === vertex ? tri * 3 + 1 : tri * 3 + 2);
    const join = (x: number, y: number, a: number, b: number) => {
        parent[find(cornerOf(x, a))] = find(cornerOf(y, a));
        parent[find(cornerOf(x, b))] = find(cornerOf(y, b));
    };
    const byEdge = trianglesByEdge(t);
    const sheets = sheetsAtCrowdedEdges(kept, t, byEdge);
    for (const [key, list] of byEdge) {
        const a = Math.floor(key / 4294967296), b = key - a * 4294967296;
        if (list.length === 2) join(list[0], list[1], a, b);
        else if (list.length > 2) for (const [x, y] of sheets.get(key) ?? []) join(x, y, a, b);
    }
    const copyOf = new Map<number, number>();
    const firstAt = new Int32Array(kept.length / 3).fill(-1);
    const out = t.slice();
    for (let corner = 0; corner < out.length; corner++) {
        const root = find(corner), vertex = t[corner];
        let index = copyOf.get(root);
        if (index === undefined) {
            if (firstAt[vertex] < 0) { firstAt[vertex] = root; index = vertex; }
            else {
                index = kept.length / 3;
                kept.push(kept[vertex * 3], kept[vertex * 3 + 1], kept[vertex * 3 + 2]);
                report.parted++;
            }
            copyOf.set(root, index);
        }
        out[corner] = index;
    }
    t = out;

    // 5. An edge still crowded is one a single sheet passes through twice: all but its first two triangles get an end
    // of their own there, which opens a seam beside them
    for (let pass = 0; pass < 8; pass++) {
        const edges = trianglesByEdge(t);
        let crowded = false;
        const again = sheetsAtCrowdedEdges(kept, t, edges);
        for (const [key, list] of edges) {
            if (list.length <= 2) continue;
            crowded = true;
            const a = Math.floor(key / 4294967296);
            const pairs = again.get(key) ?? [];
            const stay = new Set<number>(pairs.length > 0 ? pairs[0] : list.slice(0, 1));
            const groups: number[][] = [...pairs.slice(1), ...list.filter(x => !stay.has(x) && !pairs.some(p => p.includes(x))).map(x => [x])];
            for (const group of groups) {
                const copy = kept.length / 3;
                kept.push(kept[a * 3], kept[a * 3 + 1], kept[a * 3 + 2]);
                report.torn++;
                for (const tri of group) for (let k = 0; k < 3; k++) if (t[tri * 3 + k] === a) t[tri * 3 + k] = copy;
            }
        }
        if (!crowded) break;
    }

    // 6. Corners no triangle uses are left out
    const used = new Int32Array(kept.length / 3).fill(-1);
    for (let i = 0; i < t.length; i++) used[t[i]] = 0;
    const vertices: number[] = [];
    for (let p = 0; p < used.length; p++) {
        if (used[p] < 0) continue;
        used[p] = vertices.length / 3;
        vertices.push(kept[p * 3], kept[p * 3 + 1], kept[p * 3 + 2]);
    }
    const triangles = Uint32Array.from(t, p => used[p]);
    report.joined = nIn - first.size;
    return { mesh: { vertices: Float64Array.from(vertices), triangles }, report };
}

/** In a few words, what cleaning did ('' when the mesh was clean already). */
export function describeClean(report: CleanReport): string {
    const n = (count: number, one: string, many: string) => `${count.toLocaleString()} ${count === 1 ? one : many}`;
    const said: string[] = [];
    if (report.joined > 0) said.push(`${n(report.joined, 'doubled corner', 'doubled corners')} joined`);
    if (report.flat + report.doubled > 0) said.push(`${n(report.flat + report.doubled, 'triangle', 'triangles')} with no area or there twice left out`);
    if (report.parted + report.torn > 0) said.push(`${n(report.parted + report.torn, 'place', 'places')} where the surface touched itself taken apart`);
    return said.join(', ');
}
