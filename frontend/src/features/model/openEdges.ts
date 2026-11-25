/**
 * Where a mesh is open (Phase 276). A mesh with an open edge has no inside,
 * so nothing can be kept inside it or counted in it; told only "it is not
 * closed", a geologist with a solid of 200,000 triangles and one slit in it
 * has nowhere to look. This says how many edges are open, in how many gaps,
 * and where the largest gap is.
 *
 * An edge is open when an odd number of triangles meet along it (one: the
 * rim of a hole or of a sheet; three: a flap). Corners at the same place are
 * taken as one, as the reader of a mesh takes them (features/model/meshField),
 * and a triangle of no area still closes the edges it lies along.
 */
import type { MeshField } from './meshField';

export interface OpenGap {
    edges: number;
    /** The length of its open edges, m */
    length: number;
    /** Its middle (x, y, z) and how far it is across, m */
    at: [number, number, number];
    across: number;
}

export interface OpenEdges {
    /** Open edges, of all the edges of the mesh */
    edges: number;
    all: number;
    /** The gaps they make (open edges that share a corner are one gap), the largest across first */
    gaps: OpenGap[];
}

/** The open edges of a mesh and the gaps they make (`edges` 0: none is open) */
export function openEdges(mesh: MeshField): OpenEdges {
    const nv0 = Math.floor(mesh.vertices.length / 3);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < nv0; i++) for (let k = 0; k < 3; k++) {
        const v = mesh.vertices[i * 3 + k];
        if (v < lo[k]) lo[k] = v;
        if (v > hi[k]) hi[k] = v;
    }
    if (nv0 === 0) return { edges: 0, all: 0, gaps: [] };
    const step = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1e-9) * 1e-7;
    const ids = new Map<string, number>();
    const remap = new Int32Array(nv0), first: number[] = [];
    for (let i = 0; i < nv0; i++) {
        const key = `${Math.round((mesh.vertices[i * 3] - lo[0]) / step)},${Math.round((mesh.vertices[i * 3 + 1] - lo[1]) / step)},${Math.round((mesh.vertices[i * 3 + 2] - lo[2]) / step)}`;
        let id = ids.get(key);
        if (id === undefined) { id = first.length; ids.set(key, id); first.push(i); }
        remap[i] = id;
    }
    const nv = first.length;
    const count = new Map<number, number>();
    for (let t = 0; t + 2 < mesh.triangles.length; t += 3) {
        const c = [remap[mesh.triangles[t]], remap[mesh.triangles[t + 1]], remap[mesh.triangles[t + 2]]];
        if (c[0] === undefined || c[1] === undefined || c[2] === undefined || c[0] === c[1] || c[1] === c[2] || c[0] === c[2]) continue;
        for (let e = 0; e < 3; e++) {
            const a = c[e], b = c[(e + 1) % 3], key = a < b ? a * nv + b : b * nv + a;
            count.set(key, (count.get(key) ?? 0) + 1);
        }
    }
    // Open edges that share a corner are one gap
    const group = new Map<number, number>();
    const find = (v: number): number => {
        let r = v;
        while (group.get(r) !== r) r = group.get(r)!;
        for (let w = v; w !== r;) { const next = group.get(w)!; group.set(w, r); w = next; }
        return r;
    };
    const open: [number, number][] = [];
    for (const [key, n] of count) {
        if (n % 2 === 0) continue;
        const a = Math.floor(key / nv), b = key - a * nv;
        open.push([a, b]);
        if (!group.has(a)) group.set(a, a);
        if (!group.has(b)) group.set(b, b);
        group.set(find(a), find(b));
    }
    const at = (v: number, k: number) => mesh.vertices[first[v] * 3 + k];
    const made = new Map<number, { edges: number; length: number; lo: number[]; hi: number[] }>();
    for (const [a, b] of open) {
        const root = find(a);
        let g = made.get(root);
        if (!g) { g = { edges: 0, length: 0, lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] }; made.set(root, g); }
        g.edges++;
        g.length += Math.hypot(at(a, 0) - at(b, 0), at(a, 1) - at(b, 1), at(a, 2) - at(b, 2));
        for (const v of [a, b]) for (let k = 0; k < 3; k++) { const x = at(v, k); if (x < g.lo[k]) g.lo[k] = x; if (x > g.hi[k]) g.hi[k] = x; }
    }
    const gaps = [...made.values()].map((g): OpenGap => ({
        edges: g.edges, length: g.length,
        at: [(g.lo[0] + g.hi[0]) / 2, (g.lo[1] + g.hi[1]) / 2, (g.lo[2] + g.hi[2]) / 2],
        across: Math.hypot(g.hi[0] - g.lo[0], g.hi[1] - g.lo[1], g.hi[2] - g.lo[2]),
    })).sort((p, q) => q.across - p.across || q.edges - p.edges || p.at[0] - q.at[0] || p.at[1] - q.at[1] || p.at[2] - q.at[2]);
    return { edges: open.length, all: count.size, gaps };
}

const whole = (v: number) => Math.round(v).toLocaleString('en-US');
const length = (v: number) => (v < 10 ? `${v.toLocaleString('en-US', { maximumFractionDigits: 2 })} m` : `${whole(v)} m`);

/** Where a mesh is open, in a sentence ('' where no edge of it is) */
export function openEdgesText(found: OpenEdges): string {
    if (found.edges === 0 || found.gaps.length === 0) return '';
    const g = found.gaps[0];
    const many = found.gaps.length;
    return `${found.edges.toLocaleString('en-US')} of its ${found.all.toLocaleString('en-US')} edges ${found.edges === 1 ? 'is' : 'are'} open, in ${many === 1 ? 'one gap' : `${many.toLocaleString('en-US')} gaps`}: `
        + `${many === 1 ? 'it is' : 'the largest is'} ${length(g.across)} across, round ${whole(g.at[0])} east, ${whole(g.at[1])} north, ${whole(g.at[2])} up.`;
}
