/**
 * Mesh writers: Leapfrog .msh, GOCAD TSurf, OBJ, STL and DXF for surfaces
 * built in the 3D viewer (pure, unit-tested; each one reads back through the
 * viewer's own parsers).
 *
 * Coordinates are written as they are (world, e.g. UTM), to a tenth of a
 * millimetre in the text formats. STL is written as text, not binary: binary
 * STL holds 32-bit numbers, which are only good to about half a metre at UTM
 * northings. The Leapfrog mesh is binary with 64-bit numbers, and exact.
 *
 * The .msh layout was read off a file saved by Leapfrog:
 *
 *   %ARANZ-1.0 / blank / [index] / Location Double 3 <corners>; /
 *   Tri Integer 3 <triangles>; / blank / [binary]
 *
 * then, with no line end, the 4-byte whole number 15732735 and the 8-byte
 * number 1.23456789 (by which a reader tells the byte order), the corners as
 * 8-byte numbers and the triangles as 4-byte whole numbers, little-endian.
 */

export interface NamedMesh {
    name: string;
    /** xyz triples */
    vertices: ArrayLike<number>;
    /** Vertex indices, 3 per triangle */
    triangles: ArrayLike<number>;
}

export type MeshFormat = 'msh' | 'ts' | 'obj' | 'stl' | 'dxf';

export const MESH_FORMATS: { format: MeshFormat; label: string; mime: string }[] = [
    { format: 'msh', label: 'Leapfrog mesh', mime: 'application/octet-stream' },
    { format: 'ts', label: 'GOCAD TSurf', mime: 'text/plain' },
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

/** GOCAD TSurf: one surface per mesh. */
export function meshesToGocad(meshes: NamedMesh[]): string {
    const out: string[] = [];
    meshes.forEach((m, k) => {
        const v = m.vertices, t = m.triangles;
        out.push('GOCAD TSurf 1', 'HEADER {', `name:${safeName(m.name, `surface_${k + 1}`)}`, '}', 'TFACE');
        for (let i = 0; i + 2 < v.length; i += 3) out.push(`VRTX ${i / 3 + 1} ${num(v[i])} ${num(v[i + 1])} ${num(v[i + 2])}`);
        for (let i = 0; i + 2 < t.length; i += 3) out.push(`TRGL ${t[i] + 1} ${t[i + 1] + 1} ${t[i + 2] + 1}`);
        out.push('END');
    });
    return out.join('\n') + '\n';
}

/** The two numbers a Leapfrog mesh starts its binary part with */
const MSH_MARK = 15732735, MSH_CHECK = 1.23456789;

/** A Leapfrog mesh (.msh). The format holds one mesh: several are written as one, corner lists end to end. */
export function meshesToMsh(meshes: NamedMesh[]): Uint8Array {
    const corners = meshes.reduce((n, m) => n + Math.floor(m.vertices.length / 3), 0);
    const triangles = meshes.reduce((n, m) => n + Math.floor(m.triangles.length / 3), 0);
    const head = `%ARANZ-1.0\n\n[index]\nLocation Double 3 ${corners};\nTri Integer 3 ${triangles};\n\n[binary]`;
    const bytes = new Uint8Array(head.length + 12 + corners * 24 + triangles * 12);
    for (let i = 0; i < head.length; i++) bytes[i] = head.charCodeAt(i);
    const view = new DataView(bytes.buffer);
    let at = head.length;
    view.setInt32(at, MSH_MARK, true);
    view.setFloat64(at + 4, MSH_CHECK, true);
    at += 12;
    for (const m of meshes) for (let i = 0; i < Math.floor(m.vertices.length / 3) * 3; i++, at += 8) view.setFloat64(at, m.vertices[i], true);
    let first = 0;
    for (const m of meshes) {
        for (let i = 0; i < Math.floor(m.triangles.length / 3) * 3; i++, at += 4) view.setInt32(at, m.triangles[i] + first, true);
        first += Math.floor(m.vertices.length / 3);
    }
    return bytes;
}

/** The file for these meshes: text, or bytes for the Leapfrog mesh. */
export function meshesToFile(format: MeshFormat, meshes: NamedMesh[]): string | Uint8Array {
    return format === 'msh' ? meshesToMsh(meshes)
        : format === 'ts' ? meshesToGocad(meshes)
            : format === 'obj' ? meshesToObj(meshes) : format === 'stl' ? meshesToStl(meshes) : meshesToDxf(meshes);
}

/** A file name for an export: the surface's name, or the project's for several. */
export function meshFileName(format: MeshFormat, meshes: NamedMesh[], fallback = 'surfaces'): string {
    const base = meshes.length === 1 ? safeName(meshes[0].name, fallback) : safeName(fallback, 'surfaces');
    return `${base}.${format}`;
}
