import { describe, it, expect } from 'vitest';
import { parseWireframe, wireframeFormatOf } from './wireframeParsers';

const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

/** Build a Leapfrog-style .msh: text header, [binary] marker, `pad` bytes, then Tri (int32) + Location (float64). */
function makeMsh(tris: number[], verts: number[], pad = 12): ArrayBuffer {
    const head = `%ARANZ-1.0\n\n[index]\nTri Integer 3 ${tris.length / 3};\nLocation Double 3 ${verts.length / 3};\n[binary]`;
    const h = new TextEncoder().encode(head);
    const buf = new ArrayBuffer(h.length + pad + tris.length * 4 + verts.length * 8);
    new Uint8Array(buf).set(h);
    const dv = new DataView(buf);
    let at = h.length + pad;
    for (const t of tris) { dv.setInt32(at, t, true); at += 4; }
    for (const v of verts) { dv.setFloat64(at, v, true); at += 8; }
    return buf;
}

// A unit square at UTM-like coordinates, two triangles
const SQ = [500000, 7300000, 400, 500010, 7300000, 400, 500010, 7300010, 410, 500000, 7300010, 410];

describe('wireframeFormatOf', () => {
    it('maps extensions case-insensitively', () => {
        expect(wireframeFormatOf('Pegmatite_Shell.MSH')).toBe('msh');
        expect(wireframeFormatOf('pit.dxf')).toBe('dxf');
        expect(wireframeFormatOf('notes.txt')).toBeNull();
    });
});

describe('Leapfrog .msh', () => {
    it('reads triangles and float64 vertices at the standard offset', () => {
        const r = parseWireframe('shell.msh', makeMsh([0, 1, 2, 0, 2, 3], SQ));
        const p = r.parts[0];
        expect(Array.from(p.triangles)).toEqual([0, 1, 2, 0, 2, 3]);
        expect(p.vertices[1]).toBe(7300000);
        expect(p.bounds.min).toEqual([500000, 7300000, 400]);
        expect(p.bounds.max).toEqual([500010, 7300010, 410]);
    });
    it('finds the data at a non-standard offset', () => {
        const r = parseWireframe('shell.msh', makeMsh([0, 1, 2, 0, 2, 3], SQ, 5));
        expect(r.parts[0].triangles.length).toBe(6);
    });
    it('rejects files without a header', () => {
        expect(() => parseWireframe('x.msh', enc('hello'))).toThrow(/Leapfrog/);
    });
});

describe('DXF', () => {
    const dxf = (body: string) => enc(['0', 'SECTION', '2', 'ENTITIES', body, '0', 'ENDSEC', '0', 'EOF'].join('\n'));
    const face = (layer: string, pts: number[][]) => ['0', '3DFACE', '8', layer,
        ...pts.flatMap((p, k) => [`${10 + k}`, `${p[0]}`, `${20 + k}`, `${p[1]}`, `${30 + k}`, `${p[2]}`])].join('\n');

    it('reads 3DFACEs, shares vertices and splits by layer', () => {
        const r = parseWireframe('m.dxf', dxf([
            face('PEG', [[0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 1, 0]]),
            face('PEG', [[0, 0, 0], [1, 1, 0], [0, 1, 0], [0, 1, 0]]),
            face('WASTE', [[5, 5, 5], [6, 5, 5], [6, 6, 5], [5, 6, 5]]), // quad -> 2 triangles
        ].join('\n')));
        expect(r.parts.map(p => p.name)).toEqual(['PEG', 'WASTE']);
        expect(r.parts[0].vertices.length / 3).toBe(4);
        expect(r.parts[0].triangles.length / 3).toBe(2);
        expect(r.parts[1].triangles.length / 3).toBe(2);
    });

    it('reads polyface meshes and 3D polylines', () => {
        const v = (x: number, y: number, z: number, flags: number) => `0\nVERTEX\n8\nA\n10\n${x}\n20\n${y}\n30\n${z}\n70\n${flags}`;
        const f = (a: number, b: number, c: number) => `0\nVERTEX\n8\nA\n10\n0\n20\n0\n30\n0\n70\n128\n71\n${a}\n72\n${b}\n73\n${-c}`;
        const r = parseWireframe('m.dxf', dxf([
            '0\nPOLYLINE\n8\nA\n66\n1\n70\n64',
            v(0, 0, 0, 192), v(1, 0, 0, 192), v(0, 1, 0, 192), f(1, 2, 3),
            '0\nSEQEND',
            '0\nPOLYLINE\n8\nSTRING\n66\n1\n70\n9',
            v(0, 0, 0, 32), v(10, 0, 0, 32), v(10, 10, 0, 32),
            '0\nSEQEND',
        ].join('\n')));
        const a = r.parts.find(p => p.name === 'A')!;
        expect(a.triangles.length).toBe(3);
        const s = r.parts.find(p => p.name === 'STRING')!;
        expect(s.lines.length / 2).toBe(3); // closed: 3 segments
    });

    it('reads LWPOLYLINE at its elevation', () => {
        const r = parseWireframe('pit.dxf', dxf('0\nLWPOLYLINE\n8\nPIT\n90\n3\n70\n0\n38\n250\n10\n0\n20\n0\n10\n5\n20\n0\n10\n5\n20\n5'));
        expect(r.parts[0].lines.length).toBe(4);
        expect(r.parts[0].bounds.min[2]).toBe(250);
    });

    it('warns about block inserts', () => {
        const r = parseWireframe('m.dxf', dxf(face('A', [[0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 1, 0]]) + '\n0\nINSERT\n8\nA\n2\nBLK'));
        expect(r.warnings.join(' ')).toMatch(/INSERT/);
    });
});

describe('OBJ / STL / GOCAD', () => {
    it('reads OBJ faces (with v/vt/vn refs) and objects', () => {
        const r = parseWireframe('a.obj', enc('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\no shell\nf 1/1/1 2/2/2 3/3/3 4/4/4\no line\nl 1 3\n'));
        expect(r.parts.map(p => p.name)).toEqual(['shell', 'line']);
        expect(r.parts[0].triangles.length).toBe(6);
        expect(r.parts[1].vertices.length).toBe(6);
    });

    it('reads binary STL', () => {
        const buf = new ArrayBuffer(84 + 50);
        const dv = new DataView(buf);
        dv.setUint32(80, 1, true);
        [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v, k) => dv.setFloat32(84 + 12 + k * 4, v, true));
        const r = parseWireframe('a.stl', buf);
        expect(r.parts[0].triangles.length).toBe(3);
    });

    it('reads ASCII STL', () => {
        const r = parseWireframe('a.stl', enc('solid s\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid s\n'));
        expect(r.parts[0].name).toBe('s');
        expect(r.parts[0].triangles.length).toBe(3);
    });

    it('reads GOCAD TSurf with ATOMs, names and depth-positive Z', () => {
        const ts = [
            'GOCAD TSurf 1', 'HEADER {', 'name:Peg_Domain', '}', 'ZPOSITIVE Depth',
            'TFACE', 'VRTX 1 0 0 100', 'VRTX 2 1 0 100', 'PVRTX 3 1 1 110 7', 'ATOM 4 1', 'TRGL 1 2 3', 'TRGL 4 3 2', 'END',
        ].join('\n');
        const r = parseWireframe('d.ts', enc(ts));
        expect(r.parts[0].name).toBe('Peg_Domain');
        expect(r.parts[0].triangles.length).toBe(6);
        expect(r.parts[0].bounds.max[2]).toBe(-100);
    });
});
