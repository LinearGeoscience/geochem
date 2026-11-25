/**
 * A built geological model as things to draw and to export (pure): its
 * boundary as lines, each contact's cut surface and each unit's solid as
 * meshes, all taken from the model's one set of faces. Kept per build, so a
 * view asking again gets the same meshes.
 */
import { facesOf, OUTSIDE, surfaceOf } from './cutCells';
import type { ModelOutput } from './geoModelJobs';
import type { Box3, TriMesh } from './types';

/** The twelve edges of a box, as line segments (vertices and pairs of them) */
export function boxLines(box: Box3): { vertices: Float64Array; lines: Uint32Array } {
    const { min, max } = box;
    const v: number[] = [];
    for (const z of [min[2], max[2]]) for (const y of [min[1], max[1]]) for (const x of [min[0], max[0]]) v.push(x, y, z);
    return {
        vertices: new Float64Array(v),
        lines: new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7]),
    };
}

interface Parts {
    hull?: TriMesh;
    contacts: Map<number, TriMesh>;
    solids: Map<number, TriMesh>;
    blocks: Map<number, TriMesh>;
}
const kept = new WeakMap<ModelOutput, Parts>();
const partsOf = (out: ModelOutput): Parts => {
    let p = kept.get(out);
    if (!p) { p = { contacts: new Map(), solids: new Map(), blocks: new Map() }; kept.set(out, p); }
    return p;
};
const asCut = (out: ModelOutput) => ({ ...out, labels: new Int16Array(0) });

/** Meshes as one */
function together(meshes: readonly TriMesh[]): TriMesh {
    if (meshes.length === 1) return meshes[0];
    const vertices = new Float64Array(meshes.reduce((n, m) => n + m.vertices.length, 0));
    const triangles = new Uint32Array(meshes.reduce((n, m) => n + m.triangles.length, 0));
    let v = 0, t = 0;
    for (const m of meshes) {
        vertices.set(m.vertices, v);
        for (let i = 0; i < m.triangles.length; i++) triangles[t + i] = m.triangles[i] + v / 3;
        v += m.vertices.length; t += m.triangles.length;
    }
    return { vertices, triangles };
}

/** The outside of the model: every face against the boundary, facing out */
export function modelHull(out: ModelOutput): TriMesh {
    const p = partsOf(out);
    p.hull ??= facesOf(asCut(out), (a, b) => (b === OUTSIDE ? 1 : a === OUTSIDE ? -1 : 0));
    return p.hull;
}

/** A contact's surface as the model cuts it: where the age order lets it be, inside the boundary (`k`: its number in the build) */
export function contactMesh(out: ModelOutput, k: number): TriMesh {
    const p = partsOf(out);
    let m = p.contacts.get(k);
    if (!m) {
        // (One too thin for the cells is its own mesh)
        const own = out.thin?.filter(x => x.contact === k) ?? [];
        m = own.length > 0 ? together(own) : surfaceOf(asCut(out), k);
        p.contacts.set(k, m);
    }
    return m;
}

/** A contact's surface as the model cuts it, of a contact that is in the build once a fault block (`ks`: its numbers there) */
export function contactMeshes(out: ModelOutput, ks: readonly number[]): TriMesh {
    return ks.length === 1 ? contactMesh(out, ks[0]) : together(ks.map(k => contactMesh(out, k)));
}

/** A fault's surface as the model cuts it: where the fault is, inside the boundary (`f`: its number in the build) */
export const faultMesh = (out: ModelOutput, f: number): TriMesh => contactMesh(out, out.faultFrom + f);

/** A unit's closed solid, joined across the faults (`u`: its number in the build) */
export function unitSolid(out: ModelOutput, u: number): TriMesh {
    const p = partsOf(out);
    let m = p.solids.get(u);
    if (!m) {
        const n = out.unitCount;
        const unit = (label: number) => (label < 0 ? -1 : label % n);
        m = facesOf(asCut(out), (a, b) => { const ua = unit(a), ub = unit(b); return ua === ub ? 0 : ua === u ? 1 : ub === u ? -1 : 0; });
        // With whatever of it is too thin for the cells
        const own = out.thin?.filter(x => x.unit === u) ?? [];
        if (own.length > 0) m = together(m.triangles.length > 0 ? [m, ...own] : own);
        p.solids.set(u, m);
    }
    return m;
}

/** A unit's closed solid in one fault block (`block`, `u`: their numbers in the build) */
export function blockSolid(out: ModelOutput, block: number, u: number): TriMesh {
    const p = partsOf(out);
    const label = block * out.unitCount + u;
    let m = p.blocks.get(label);
    if (!m) {
        m = facesOf(asCut(out), (a, b) => (a === label ? 1 : b === label ? -1 : 0));
        // With whatever of it there is too thin for the cells
        const own = out.thin?.filter(x => x.unit === u && x.block === block) ?? [];
        if (own.length > 0) m = together(m.triangles.length > 0 ? [m, ...own] : own);
        p.blocks.set(label, m);
    }
    return m;
}
