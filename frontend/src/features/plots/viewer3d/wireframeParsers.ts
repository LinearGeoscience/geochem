/**
 * Wireframe / surface file parsers for the 3D viewer (pure TypeScript, no
 * three.js or DOM, so they run in a Web Worker and in unit tests).
 *
 * Supported formats:
 *   .msh  Leapfrog Geo mesh (binary; text header with an [index] of fields)
 *   .dxf  ASCII DXF: 3DFACE, POLYLINE polyface + polygon meshes, MESH,
 *         and LINE / LWPOLYLINE / 2D-3D POLYLINE as lines (split by layer)
 *   .obj  Wavefront OBJ (v / f / l, split by `o`)
 *   .stl  STL, binary or ASCII
 *   .ts   GOCAD TSurf (and PLine) — common Leapfrog / Vulcan / Micromine export
 *
 * Output stays in WORLD coordinates as float64; the viewer re-origins to the
 * data centre before casting to float32 (UTM northings lose ~0.5 m in float32).
 */

export type WireframeFormat = 'msh' | 'dxf' | 'obj' | 'stl' | 'ts';

export const WIREFRAME_EXTENSIONS = ['.msh', '.dxf', '.obj', '.stl', '.ts'] as const;

export interface WireframeBounds {
    min: [number, number, number];
    max: [number, number, number];
}

export interface WireframePart {
    /** Object / layer name inside the file ('' when the file has one unnamed object) */
    name: string;
    /** World xyz, 3 per vertex */
    vertices: Float64Array;
    /** Vertex indices, 3 per triangle */
    triangles: Uint32Array;
    /** Vertex indices, 2 per line segment (polylines, strings) */
    lines: Uint32Array;
    bounds: WireframeBounds;
}

export interface ParsedWireframe {
    format: WireframeFormat;
    parts: WireframePart[];
    warnings: string[];
}

// ---------------------------------------------------------------------------
// Shared builders
// ---------------------------------------------------------------------------

class PartBuilder {
    readonly verts: number[] = [];
    readonly tris: number[] = [];
    readonly lines: number[] = [];
    private readonly lookup = new Map<string, number>();

    constructor(readonly name: string) {}

    /** Add a vertex, re-using an identical one (shared vertices give smooth shading). */
    vertex(x: number, y: number, z: number): number {
        const key = `${x},${y},${z}`;
        const hit = this.lookup.get(key);
        if (hit !== undefined) return hit;
        const i = this.verts.length / 3;
        this.verts.push(x, y, z);
        this.lookup.set(key, i);
        return i;
    }

    triangle(a: number, b: number, c: number) {
        if (a === b || b === c || a === c) return; // degenerate
        this.tris.push(a, b, c);
    }

    /** Fan-triangulate a convex polygon given as vertex indices. */
    polygon(idx: number[]) {
        for (let k = 1; k + 1 < idx.length; k++) this.triangle(idx[0], idx[k], idx[k + 1]);
    }

    polyline(idx: number[], closed: boolean) {
        for (let k = 0; k + 1 < idx.length; k++) if (idx[k] !== idx[k + 1]) this.lines.push(idx[k], idx[k + 1]);
        if (closed && idx.length > 2 && idx[0] !== idx[idx.length - 1]) this.lines.push(idx[idx.length - 1], idx[0]);
    }

    isEmpty() {
        return this.tris.length === 0 && this.lines.length === 0;
    }

    build(): WireframePart {
        return makePart(this.name, Float64Array.from(this.verts), Uint32Array.from(this.tris), Uint32Array.from(this.lines));
    }
}

/** Drop vertices no triangle/line uses, then compute bounds. */
export function makePart(name: string, vertices: Float64Array, triangles: Uint32Array, lines: Uint32Array): WireframePart {
    const n = vertices.length / 3;
    const used = new Int32Array(n).fill(-1);
    let count = 0;
    const mark = (ix: Uint32Array) => {
        for (let k = 0; k < ix.length; k++) if (used[ix[k]] < 0) used[ix[k]] = count++;
    };
    mark(triangles);
    mark(lines);
    let verts = vertices, tris = triangles, segs = lines;
    if (count < n) {
        verts = new Float64Array(count * 3);
        for (let i = 0; i < n; i++) {
            const j = used[i];
            if (j < 0) continue;
            verts[j * 3] = vertices[i * 3];
            verts[j * 3 + 1] = vertices[i * 3 + 1];
            verts[j * 3 + 2] = vertices[i * 3 + 2];
        }
        tris = triangles.map(i => used[i]);
        segs = lines.map(i => used[i]);
    }
    return { name, vertices: verts, triangles: tris, lines: segs, bounds: boundsOf(verts) };
}

export function boundsOf(v: ArrayLike<number>): WireframeBounds {
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i + 2 < v.length; i += 3) {
        for (let k = 0; k < 3; k++) {
            const x = v[i + k];
            if (x < min[k]) min[k] = x;
            if (x > max[k]) max[k] = x;
        }
    }
    return { min, max };
}

function finite(...xs: number[]) {
    return xs.every(Number.isFinite);
}

function decodeText(buf: ArrayBuffer): string {
    // latin1 never throws and keeps the ASCII structure of every format here
    return new TextDecoder('latin1').decode(new Uint8Array(buf));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function wireframeFormatOf(fileName: string): WireframeFormat | null {
    const ext = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
    return ext === 'msh' || ext === 'dxf' || ext === 'obj' || ext === 'stl' || ext === 'ts' ? ext : null;
}

export function parseWireframe(fileName: string, buf: ArrayBuffer): ParsedWireframe {
    const format = wireframeFormatOf(fileName);
    if (!format) throw new Error(`Unsupported wireframe type: ${fileName} (use ${WIREFRAME_EXTENSIONS.join(', ')})`);
    const warnings: string[] = [];
    let parts: WireframePart[];
    switch (format) {
        case 'msh': parts = parseLeapfrogMsh(buf); break;
        case 'dxf': parts = parseDxf(decodeText(buf), warnings); break;
        case 'obj': parts = parseObj(decodeText(buf)); break;
        case 'stl': parts = parseStl(buf); break;
        case 'ts': parts = parseGocad(decodeText(buf)); break;
    }
    parts = parts.filter(p => p.triangles.length > 0 || p.lines.length > 0);
    if (parts.length === 0) throw new Error(`${fileName}: no triangles or lines found`);
    return { format, parts, warnings };
}

// ---------------------------------------------------------------------------
// Leapfrog .msh
//
// A short text header ends in an index of the binary fields, e.g.
//     [index]
//     Tri Integer 3 7462;
//     Location Double 3 3733;
//     [binary]
// followed by the fields' little-endian data in index order (Tri = int32
// triangles, Location = float64 vertices). The data starts a few bytes after
// "[binary]" (0x14 from its start in Leapfrog Geo files; the same offset the
// GemGIS reader uses); other offsets are tried and validated as a fallback.
// ---------------------------------------------------------------------------

const MSH_TYPES: Record<string, { size: number; read: (dv: DataView, at: number) => number }> = {
    integer: { size: 4, read: (dv, at) => dv.getInt32(at, true) },
    int: { size: 4, read: (dv, at) => dv.getInt32(at, true) },
    double: { size: 8, read: (dv, at) => dv.getFloat64(at, true) },
    float: { size: 4, read: (dv, at) => dv.getFloat32(at, true) },
    short: { size: 2, read: (dv, at) => dv.getInt16(at, true) },
    byte: { size: 1, read: (dv, at) => dv.getUint8(at) },
    char: { size: 1, read: (dv, at) => dv.getUint8(at) },
};

interface MshField { name: string; type: string; count: number; size: number }

export function parseLeapfrogMsh(buf: ArrayBuffer): WireframePart[] {
    const bytes = new Uint8Array(buf);
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 1 << 16)));
    const indexAt = head.indexOf('[index]');
    const binaryAt = head.indexOf('[binary]');
    if (indexAt < 0 || binaryAt < 0 || binaryAt < indexAt) {
        throw new Error('Not a Leapfrog mesh (.msh): no [index]/[binary] header. Export the mesh from Leapfrog as .msh, or as .obj/.dxf.');
    }
    const fields: MshField[] = [];
    for (const raw of head.slice(indexAt + 7, binaryAt).split(/\r?\n/)) {
        const line = raw.trim().replace(/;$/, '').trim();
        if (!line) continue;
        const [name, type, ...dims] = line.split(/\s+/);
        const t = MSH_TYPES[type?.toLowerCase()];
        const sizes = dims.map(Number);
        if (!t || sizes.length === 0 || sizes.some(s => !Number.isInteger(s) || s < 0)) {
            throw new Error(`Leapfrog mesh: unrecognised field "${line}"`);
        }
        fields.push({ name, type: type.toLowerCase(), count: sizes.reduce((a, b) => a * b, 1), size: t.size });
    }
    const loc = fields.find(f => f.name.toLowerCase() === 'location');
    const tri = fields.find(f => f.name.toLowerCase() === 'tri');
    if (!loc) throw new Error('Leapfrog mesh: no Location (vertex) field in the header');
    if (!tri) throw new Error('Leapfrog mesh: no Tri (triangle) field in the header');
    const total = fields.reduce((a, f) => a + f.count * f.size, 0);
    const dv = new DataView(buf);

    const base = binaryAt + 8; // just after "[binary]"
    const candidates = [binaryAt + 0x14, bytes.length - total];
    for (let s = base; s <= base + 64; s++) candidates.push(s);
    const tried = new Set<number>();
    for (const start of candidates) {
        if (tried.has(start) || start < base || start + total > bytes.length) continue;
        tried.add(start);
        const read = readMshFields(dv, start, fields, loc, tri);
        if (read) return [makePart('', read.vertices, read.triangles, new Uint32Array(0))];
    }
    throw new Error('Leapfrog mesh: could not locate valid vertex/triangle data after the header');
}

function readMshFields(dv: DataView, start: number, fields: MshField[], loc: MshField, tri: MshField) {
    let at = start;
    let vertices: Float64Array | null = null;
    let triangles: Uint32Array | null = null;
    // Cheap sample check first so wrong offsets are rejected quickly
    for (const f of fields) {
        const t = MSH_TYPES[f.type];
        if (f === loc) {
            if (f.count % 3 !== 0) return null;
            const sample = Math.min(f.count, 300);
            for (let k = 0; k < sample; k++) {
                const v = t.read(dv, at + k * f.size);
                if (!Number.isFinite(v) || Math.abs(v) > 1e9) return null;
            }
        } else if (f === tri) {
            if (f.count % 3 !== 0) return null;
            const nVerts = loc.count / 3;
            const sample = Math.min(f.count, 300);
            for (let k = 0; k < sample; k++) {
                const v = t.read(dv, at + k * f.size);
                if (!Number.isInteger(v) || v < 0 || v >= nVerts) return null;
            }
        }
        at += f.count * f.size;
    }
    at = start;
    for (const f of fields) {
        const t = MSH_TYPES[f.type];
        if (f === loc) {
            vertices = new Float64Array(f.count);
            for (let k = 0; k < f.count; k++) {
                const v = t.read(dv, at + k * f.size);
                if (!Number.isFinite(v)) return null;
                vertices[k] = v;
            }
        } else if (f === tri) {
            const nVerts = loc.count / 3;
            triangles = new Uint32Array(f.count);
            for (let k = 0; k < f.count; k++) {
                const v = t.read(dv, at + k * f.size);
                if (v < 0 || v >= nVerts) return null;
                triangles[k] = v;
            }
        }
        at += f.count * f.size;
    }
    return vertices && triangles ? { vertices, triangles } : null;
}

// ---------------------------------------------------------------------------
// DXF (ASCII)
// ---------------------------------------------------------------------------

type Pair = [number, string];
interface DxfEntity { type: string; pairs: Pair[] }

function dxfNum(e: DxfEntity, code: number, fallback = 0): number {
    for (const [c, v] of e.pairs) if (c === code) return parseFloat(v);
    return fallback;
}

function dxfStr(e: DxfEntity, code: number, fallback = ''): string {
    for (const [c, v] of e.pairs) if (c === code) return v.trim();
    return fallback;
}

/** Read ENTITIES-section entities as (type, group-code pairs). */
function dxfEntities(text: string): DxfEntity[] {
    const lines = text.split(/\r\n|\r|\n/);
    const entities: DxfEntity[] = [];
    let inEntities = false;
    let current: DxfEntity | null = null;
    for (let i = 0; i + 1 < lines.length; i += 2) {
        const code = parseInt(lines[i].trim(), 10);
        const value = lines[i + 1];
        if (!Number.isFinite(code)) {
            // Tolerate a stray blank line by re-syncing one line on
            i -= 1;
            continue;
        }
        if (code === 0) {
            const v = value.trim();
            if (current) entities.push(current);
            current = null;
            if (v === 'SECTION') {
                const name = lines[i + 3]?.trim();
                inEntities = name === 'ENTITIES';
                continue;
            }
            if (v === 'ENDSEC') { inEntities = false; continue; }
            if (v === 'EOF') break;
            if (inEntities) current = { type: v, pairs: [] };
            continue;
        }
        if (current) current.pairs.push([code, value]);
    }
    if (current) entities.push(current);
    return entities;
}

export function parseDxf(text: string, warnings: string[] = []): WireframePart[] {
    if (text.startsWith('AutoCAD Binary DXF')) {
        throw new Error('Binary DXF is not supported — save/export the DXF as ASCII.');
    }
    const entities = dxfEntities(text);
    const layers = new Map<string, PartBuilder>();
    const layer = (name: string) => {
        let b = layers.get(name);
        if (!b) { b = new PartBuilder(name); layers.set(name, b); }
        return b;
    };
    const skipped = new Map<string, number>();
    const skip = (type: string) => skipped.set(type, (skipped.get(type) ?? 0) + 1);

    for (let i = 0; i < entities.length; i++) {
        const e = entities[i];
        const b = () => layer(dxfStr(e, 8, '0'));
        switch (e.type) {
            case '3DFACE': {
                const p = [0, 1, 2, 3].map(k => [dxfNum(e, 10 + k, NaN), dxfNum(e, 20 + k, NaN), dxfNum(e, 30 + k, 0)]);
                if (!finite(p[3][0], p[3][1])) p[3] = p[2];
                if (!p.slice(0, 3).every(q => finite(...q))) break;
                const pb = b();
                const ix = p.map(q => pb.vertex(q[0], q[1], q[2]));
                if (ix[3] === ix[2]) pb.triangle(ix[0], ix[1], ix[2]);
                else pb.polygon(ix);
                break;
            }
            case 'LINE': {
                const x0 = dxfNum(e, 10, NaN), y0 = dxfNum(e, 20, NaN), z0 = dxfNum(e, 30);
                const x1 = dxfNum(e, 11, NaN), y1 = dxfNum(e, 21, NaN), z1 = dxfNum(e, 31);
                if (!finite(x0, y0, x1, y1)) break;
                const pb = b();
                pb.polyline([pb.vertex(x0, y0, z0), pb.vertex(x1, y1, z1)], false);
                break;
            }
            case 'LWPOLYLINE': {
                const z = dxfNum(e, 38);
                const closed = (dxfNum(e, 70) & 1) === 1;
                const pb = b();
                const idx: number[] = [];
                let x = NaN;
                for (const [c, v] of e.pairs) {
                    if (c === 10) x = parseFloat(v);
                    else if (c === 20 && Number.isFinite(x)) { idx.push(pb.vertex(x, parseFloat(v), z)); x = NaN; }
                }
                pb.polyline(idx, closed);
                break;
            }
            case 'POLYLINE': {
                // Collect the following VERTEX entities up to SEQEND
                const verts: DxfEntity[] = [];
                let j = i + 1;
                for (; j < entities.length && entities[j].type === 'VERTEX'; j++) verts.push(entities[j]);
                if (j < entities.length && entities[j].type === 'SEQEND') j++;
                i = j - 1;
                dxfPolyline(e, verts, b());
                break;
            }
            case 'MESH':
                dxfMesh(e, b());
                break;
            case 'VERTEX': case 'SEQEND':
                break;
            default:
                skip(e.type);
        }
    }
    const ignorable = new Set(['TEXT', 'MTEXT', 'POINT', 'ATTRIB', 'ATTDEF', 'DIMENSION', 'HATCH', 'VIEWPORT', 'LEADER', 'SOLID']);
    const notable = [...skipped].filter(([t]) => !ignorable.has(t));
    if (notable.length) {
        warnings.push(`Skipped unsupported DXF entities: ${notable.map(([t, n]) => `${t} ×${n}`).join(', ')}`
            + (skipped.has('INSERT') ? ' (block INSERTs — explode blocks before exporting)' : ''));
    }
    return [...layers.values()].filter(p => !p.isEmpty()).map(p => p.build());
}

function dxfPolyline(e: DxfEntity, verts: DxfEntity[], pb: PartBuilder) {
    const flags = dxfNum(e, 70);
    const elevation = dxfNum(e, 30);
    const xyz = (v: DxfEntity): [number, number, number] => [dxfNum(v, 10, NaN), dxfNum(v, 20, NaN), dxfNum(v, 30, elevation)];

    if (flags & 64) {
        // Polyface mesh: coordinate vertices (flag 64|128) then face records (flag 128, indices 71-74, 1-based)
        const coords: number[] = [];
        for (const v of verts) {
            const vf = dxfNum(v, 70);
            if (vf & 64) {
                const p = xyz(v);
                coords.push(finite(p[0], p[1], p[2]) ? pb.vertex(p[0], p[1], p[2]) : -1);
            }
        }
        for (const v of verts) {
            const vf = dxfNum(v, 70);
            if ((vf & 128) && !(vf & 64)) {
                const face: number[] = [];
                for (const code of [71, 72, 73, 74]) {
                    const k = Math.abs(Math.trunc(dxfNum(v, code, 0)));
                    if (k > 0 && k <= coords.length && coords[k - 1] >= 0) face.push(coords[k - 1]);
                }
                if (face.length >= 3) pb.polygon(face);
            }
        }
        return;
    }
    const idx: number[] = [];
    for (const v of verts) {
        const p = xyz(v);
        if (finite(p[0], p[1], p[2])) idx.push(pb.vertex(p[0], p[1], p[2]));
    }
    if (flags & 16) {
        // 3D polygon mesh: M x N grid of vertices
        const m = Math.trunc(dxfNum(e, 71)), n = Math.trunc(dxfNum(e, 72));
        if (m > 1 && n > 1 && idx.length >= m * n) {
            const closedM = (flags & 1) === 1, closedN = (flags & 32) === 32;
            const at = (r: number, c: number) => idx[(r % m) * n + (c % n)];
            for (let r = 0; r < (closedM ? m : m - 1); r++) {
                for (let c = 0; c < (closedN ? n : n - 1); c++) {
                    pb.polygon([at(r, c), at(r + 1, c), at(r + 1, c + 1), at(r, c + 1)]);
                }
            }
        }
        return;
    }
    pb.polyline(idx, (flags & 1) === 1);
}

function dxfMesh(e: DxfEntity, pb: PartBuilder) {
    // AutoCAD 2010+ MESH: 92 = vertex count, then 10/20/30 per vertex;
    // 93 = face list size, then 90 values: [n, i0..in-1] per face (0-based)
    const pairs = e.pairs;
    let k = pairs.findIndex(([c]) => c === 92);
    if (k < 0) return;
    const nv = parseInt(pairs[k][1], 10);
    const verts: number[] = [];
    let x = NaN, y = NaN;
    for (k++; k < pairs.length && verts.length < nv; k++) {
        const [c, v] = pairs[k];
        if (c === 10) x = parseFloat(v);
        else if (c === 20) y = parseFloat(v);
        else if (c === 30) { verts.push(pb.vertex(x, y, parseFloat(v))); }
    }
    for (; k < pairs.length && pairs[k][0] !== 93; k++);
    if (k >= pairs.length) return;
    const size = parseInt(pairs[k][1], 10);
    const list: number[] = [];
    for (k++; k < pairs.length && list.length < size; k++) if (pairs[k][0] === 90) list.push(parseInt(pairs[k][1], 10));
    for (let p = 0; p < list.length;) {
        const n = list[p++];
        const face = list.slice(p, p + n).map(i => verts[i]).filter(i => i !== undefined);
        p += n;
        if (face.length >= 3) pb.polygon(face);
    }
}

// ---------------------------------------------------------------------------
// Wavefront OBJ
// ---------------------------------------------------------------------------

export function parseObj(text: string): WireframePart[] {
    const verts: number[] = [];
    interface Group { name: string; tris: number[]; lines: number[] }
    const groups: Group[] = [];
    let cur: Group = { name: '', tris: [], lines: [] };
    groups.push(cur);
    const ref = (tok: string) => {
        const i = parseInt(tok, 10); // "7/2/3" -> 7
        const n = verts.length / 3;
        return i < 0 ? n + i : i - 1;
    };
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line[0] === '#') continue;
        const tok = line.split(/\s+/);
        switch (tok[0]) {
            case 'v': verts.push(parseFloat(tok[1]), parseFloat(tok[2]), parseFloat(tok[3] ?? '0')); break;
            case 'f': {
                const idx = tok.slice(1).map(ref);
                for (let k = 1; k + 1 < idx.length; k++) cur.tris.push(idx[0], idx[k], idx[k + 1]);
                break;
            }
            case 'l': {
                const idx = tok.slice(1).map(ref);
                for (let k = 0; k + 1 < idx.length; k++) cur.lines.push(idx[k], idx[k + 1]);
                break;
            }
            case 'o':
                cur = { name: tok.slice(1).join(' '), tris: [], lines: [] };
                groups.push(cur);
                break;
        }
    }
    const all = Float64Array.from(verts);
    const n = all.length / 3;
    const ok = (ix: number[]) => ix.every(i => i >= 0 && i < n);
    return groups
        .filter(g => (g.tris.length || g.lines.length) && ok(g.tris) && ok(g.lines))
        .map(g => makePart(g.name, all, Uint32Array.from(g.tris), Uint32Array.from(g.lines)));
}

// ---------------------------------------------------------------------------
// STL
// ---------------------------------------------------------------------------

export function parseStl(buf: ArrayBuffer): WireframePart[] {
    const dv = new DataView(buf);
    if (buf.byteLength >= 84) {
        const n = dv.getUint32(80, true);
        if (84 + n * 50 === buf.byteLength) {
            const pb = new PartBuilder('');
            for (let t = 0; t < n; t++) {
                const at = 84 + t * 50 + 12;
                const ix = [0, 1, 2].map(k => pb.vertex(
                    dv.getFloat32(at + k * 12, true), dv.getFloat32(at + k * 12 + 4, true), dv.getFloat32(at + k * 12 + 8, true),
                ));
                pb.triangle(ix[0], ix[1], ix[2]);
            }
            return [pb.build()];
        }
    }
    const text = decodeText(buf);
    if (!/^\s*solid/i.test(text)) throw new Error('Not a valid STL file');
    const parts: WireframePart[] = [];
    let pb = new PartBuilder('');
    let face: number[] = [];
    for (const raw of text.split(/\r?\n/)) {
        const tok = raw.trim().split(/\s+/);
        if (tok[0] === 'solid') { if (!pb.isEmpty()) parts.push(pb.build()); pb = new PartBuilder(tok.slice(1).join(' ')); }
        else if (tok[0] === 'vertex') face.push(pb.vertex(parseFloat(tok[1]), parseFloat(tok[2]), parseFloat(tok[3])));
        else if (tok[0] === 'endloop') { if (face.length >= 3) pb.polygon(face); face = []; }
    }
    if (!pb.isEmpty()) parts.push(pb.build());
    return parts;
}

// ---------------------------------------------------------------------------
// GOCAD TSurf / PLine (.ts)
// ---------------------------------------------------------------------------

export function parseGocad(text: string): WireframePart[] {
    const parts: WireframePart[] = [];
    let verts: number[] = [];
    let tris: number[] = [];
    let segs: number[] = [];
    let ids = new Map<number, number>();
    let name = '';
    let zSign = 1;
    const flush = () => {
        if (tris.length || segs.length) parts.push(makePart(name, Float64Array.from(verts), Uint32Array.from(tris), Uint32Array.from(segs)));
        verts = []; tris = []; segs = []; ids = new Map(); name = ''; zSign = 1;
    };
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line[0] === '#') continue;
        const tok = line.split(/\s+/);
        const kw = tok[0].toUpperCase();
        if (kw === 'GOCAD') { flush(); continue; }
        if (kw.startsWith('NAME:') || (kw === 'HEADER' && line.includes('name:'))) {
            const m = line.match(/name:\s*(.+?)\s*}?$/i);
            if (m) name = m[1];
            continue;
        }
        if (kw === 'ZPOSITIVE') { zSign = tok[1]?.toUpperCase() === 'DEPTH' ? -1 : 1; continue; }
        if (kw === 'VRTX' || kw === 'PVRTX') {
            const id = parseInt(tok[1], 10);
            ids.set(id, verts.length / 3);
            verts.push(parseFloat(tok[2]), parseFloat(tok[3]), parseFloat(tok[4]) * zSign);
            continue;
        }
        if (kw === 'ATOM' || kw === 'PATOM') {
            const src = ids.get(parseInt(tok[2], 10));
            if (src !== undefined) ids.set(parseInt(tok[1], 10), src);
            continue;
        }
        if (kw === 'TRGL') {
            const ix = tok.slice(1, 4).map(t => ids.get(parseInt(t, 10)));
            if (ix.every(i => i !== undefined)) tris.push(ix[0]!, ix[1]!, ix[2]!);
            continue;
        }
        if (kw === 'SEG') {
            const a = ids.get(parseInt(tok[1], 10)), b = ids.get(parseInt(tok[2], 10));
            if (a !== undefined && b !== undefined) segs.push(a, b);
            continue;
        }
        if (kw === 'END') { flush(); continue; }
    }
    flush();
    return parts;
}
