/**
 * Mesh writers: OBJ, STL and DXF text for surfaces built in the 3D viewer
 * (pure, unit-tested; each one reads back through the viewer's own parsers).
 *
 * Coordinates are written as they are (world, e.g. UTM), to a tenth of a
 * millimetre. STL is written as text, not binary: binary STL holds 32-bit
 * numbers, which are only good to about half a metre at UTM northings.
 */

export interface NamedMesh {
    name: string;
    /** xyz triples */
    vertices: ArrayLike<number>;
    /** Vertex indices, 3 per triangle */
    triangles: ArrayLike<number>;
}

export type MeshFormat = 'obj' | 'stl' | 'dxf';

export const MESH_FORMATS: { format: MeshFormat; label: string; mime: string }[] = [
    { format: 'dxf', label: 'DXF (3D faces)', mime: 'application/dxf' },
    { format: 'obj', label: 'OBJ', mime: 'model/obj' },
    { format: 'stl', label: 'STL', mime: 'model/stl' },
];

const num = (v: number) => String(Math.round(v * 1e4) / 1e4);

/** A name that is safe as an object, solid or layer name in all three formats. */
function safeName(name: string, fallback: string): string {
    const clean = name.trim().replace(/[^A-Za-z0-9_$-]+/g, '_').replace(/^_+|_+$/g, '');
    return clean || fallback;
}

/** Wavefront OBJ: one object per mesh, vertices shared. */
export function meshesToObj(meshes: NamedMesh[]): string {
    const out: string[] = ['# GeoChem surfaces'];
    let offset = 1;
    meshes.forEach((m, k) => {
        out.push(`o ${safeName(m.name, `surface_${k + 1}`)}`);
        const v = m.vertices, t = m.triangles;
        for (let i = 0; i + 2 < v.length; i += 3) out.push(`v ${num(v[i])} ${num(v[i + 1])} ${num(v[i + 2])}`);
        for (let i = 0; i + 2 < t.length; i += 3) out.push(`f ${t[i] + offset} ${t[i + 1] + offset} ${t[i + 2] + offset}`);
        offset += v.length / 3;
    });
    return out.join('\n') + '\n';
}

/** STL as text: one solid per mesh. */
export function meshesToStl(meshes: NamedMesh[]): string {
    const out: string[] = [];
    meshes.forEach((m, k) => {
        const name = safeName(m.name, `surface_${k + 1}`);
        const v = m.vertices, t = m.triangles;
        out.push(`solid ${name}`);
        for (let i = 0; i + 2 < t.length; i += 3) {
            const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
            const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
            const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
            let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
            const len = Math.hypot(nx, ny, nz) || 1;
            nx /= len; ny /= len; nz /= len;
            out.push(` facet normal ${nx.toFixed(6)} ${ny.toFixed(6)} ${nz.toFixed(6)}`, '  outer loop');
            for (const p of [a, b, c]) out.push(`   vertex ${num(v[p])} ${num(v[p + 1])} ${num(v[p + 2])}`);
            out.push('  endloop', ' endfacet');
        }
        out.push(`endsolid ${name}`);
    });
    return out.join('\n') + '\n';
}

/** ASCII DXF: one 3DFACE per triangle, each mesh on its own layer. */
export function meshesToDxf(meshes: NamedMesh[]): string {
    const out: string[] = ['0', 'SECTION', '2', 'ENTITIES'];
    meshes.forEach((m, k) => {
        const layer = safeName(m.name, `surface_${k + 1}`);
        const v = m.vertices, t = m.triangles;
        for (let i = 0; i + 2 < t.length; i += 3) {
            out.push('0', '3DFACE', '8', layer);
            // A triangle is a face whose fourth corner repeats the third
            [t[i], t[i + 1], t[i + 2], t[i + 2]].forEach((p, corner) => {
                out.push(String(10 + corner), num(v[p * 3]), String(20 + corner), num(v[p * 3 + 1]), String(30 + corner), num(v[p * 3 + 2]));
            });
        }
    });
    out.push('0', 'ENDSEC', '0', 'EOF');
    return out.join('\n') + '\n';
}

export function meshesToText(format: MeshFormat, meshes: NamedMesh[]): string {
    return format === 'obj' ? meshesToObj(meshes) : format === 'stl' ? meshesToStl(meshes) : meshesToDxf(meshes);
}

/** A file name for an export: the surface's name, or the project's for several. */
export function meshFileName(format: MeshFormat, meshes: NamedMesh[], fallback = 'surfaces'): string {
    const base = meshes.length === 1 ? safeName(meshes[0].name, fallback) : safeName(fallback, 'surfaces');
    return `${base}.${format}`;
}
