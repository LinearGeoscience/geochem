/**
 * Points, lines and dip readings from a file, as input to a surface (pure,
 * unit-tested).
 *
 * CSV: a row is a point (columns for east, north and elevation, found by
 * their names). With dip and dip direction columns each point is a dip
 * reading; with a line column (line, string, polyline) the rows of one value
 * are one line, in the order they come.
 *
 * DXF: POINT entities are points; LINE, LWPOLYLINE and POLYLINE are lines.
 *
 * Leapfrog polyline (.lfpl): its lines with the plane each was drawn on, the
 * tangents at their nodes (as the directions the surface runs in there) and
 * their curves (as smooth lines), and its points with their normals (as dip
 * readings). Surpac strings (.str) and GOCAD lines
 * (.pl, .ts): lines.
 */
import Papa from 'papaparse';
import { guessAxisColumn } from '../plots/viewer3d/coordinateColumns';
import { dxfEntities, parseDxf, parseGocad, type WireframePart } from '../plots/viewer3d/wireframeParsers';
import { linesFromSurpac, shapesFromLfpl } from './inputWriters';
import { simplifyLine } from './lines';
import { bestFitPlane, cross, unit } from './plane';
import { cleanReading } from './readings';
import type { LineNode, Plane, PointReading, Vec3 } from './types';

export interface ImportedShapes {
    points: { p: Vec3; reading?: PointReading }[];
    /** Each with two vertices or more */
    lines: Vec3[][];
    /**
     * What the file says of each line besides its vertices (by the line's
     * place in `lines`; absent or null: nothing): the plane it was drawn on,
     * and what is known at its nodes.
     */
    known?: ({ plane?: Plane; nodes?: (LineNode | null)[]; smooth?: boolean } | null)[];
    /** What was left out or assumed, in plain words */
    notes: string[];
}

/**
 * A line keeps at most this many vertices (the ones it needs least are left
 * out, and it says so). Far more than anyone draws: it is there for strings
 * traced by machine.
 */
export const MAX_IMPORT_VERTICES = 5000;

const lower = (s: string) => s.trim().toLowerCase().replace(/[\s_.-]+/g, '');
const DIP = ['dip', 'dipangle', 'dipdeg'];
const DIRECTION = ['dipdirection', 'dipdir', 'dipazimuth', 'dipazi', 'dipdirn', 'dd', 'azimuth', 'azi'];

/** The columns that look like a dip and a dip direction, by their names ('' = none does). */
export function guessDipColumns(names: readonly string[]): { dip: string; direction: string } {
    return { dip: names.find(n => DIP.includes(lower(n))) ?? '', direction: names.find(n => DIRECTION.includes(lower(n))) ?? '' };
}
const STRIKE = ['strike', 'strikerhr', 'strikeazimuth'];
const LINE = ['line', 'lineid', 'string', 'stringid', 'polyline', 'polylineid', 'feature', 'featureid', 'segment'];

/** A line as read: vertices on top of each other merged; `tally.cut` counts the lines that had to lose vertices. */
function clean(line: Vec3[], tally?: { cut: number }): Vec3[] | null {
    const v = simplifyLine(line, 0, MAX_IMPORT_VERTICES);
    if (tally && line.length > MAX_IMPORT_VERTICES && v.length < line.length) tally.cut++;
    return v.length >= 2 ? v : null;
}

const cutNote = (cut: number) => `${cut.toLocaleString()} ${cut === 1 ? 'line has' : 'lines have'} more than ${MAX_IMPORT_VERTICES.toLocaleString()} vertices: the ones that shape ${cut === 1 ? 'it' : 'them'} least were left out.`;

/** The lines of a part (pairs of vertex numbers): stretches that follow on from one another are one line. */
function partLines(part: WireframePart, tally: { cut: number }): Vec3[][] {
    const at = (i: number): Vec3 => [part.vertices[i * 3], part.vertices[i * 3 + 1], part.vertices[i * 3 + 2]];
    const lines: Vec3[][] = [];
    let current: number[] = [];
    const close = () => {
        const line = current.length >= 2 ? clean(current.map(at), tally) : null;
        if (line) lines.push(line);
        current = [];
    };
    for (let s = 0; s + 1 < part.lines.length; s += 2) {
        const a = part.lines[s], b = part.lines[s + 1];
        if (current.length > 0 && current[current.length - 1] === a) current.push(b);
        else { close(); current = [a, b]; }
    }
    close();
    return lines;
}

/** Points, lines and readings from the text of a CSV file. Throws (with a plain message) when it has no coordinates. */
export function shapesFromCsv(text: string): ImportedShapes {
    const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy' });
    const rows = parsed.data.filter(r => r.some(c => String(c ?? '').trim() !== ''));
    if (rows.length === 0) throw new Error('The file is empty.');
    const num = (v: unknown) => { const t = String(v ?? '').trim(); return t === '' ? NaN : Number(t); };
    const notes: string[] = [];

    // A first row of numbers is data: east, north, elevation, then dip and dip direction
    const headed = !rows[0].slice(0, 3).every(c => Number.isFinite(num(c)));
    let x = 0, y = 1, z = 2, dip = -1, direction = -1, strike = -1, lineId = -1;
    if (headed) {
        const names = rows[0].map(c => String(c ?? '').trim());
        const columns = names.map(name => ({ name, type: 'numeric', role: null }));
        const at = (name: string) => (name ? names.indexOf(name) : -1);
        x = at(guessAxisColumn(columns, 'x'));
        y = at(guessAxisColumn(columns, 'y'));
        z = at(guessAxisColumn(columns, 'z'));
        const find = (words: string[]) => names.findIndex(n => words.includes(lower(n)));
        dip = find(DIP);
        direction = find(DIRECTION);
        strike = find(STRIKE);
        lineId = find(LINE);
        const missing = [x < 0 && 'east (X)', y < 0 && 'north (Y)', z < 0 && 'elevation (Z)'].filter(Boolean);
        if (missing.length > 0) throw new Error(`No column for ${missing.join(', ')} was found. Its columns are: ${names.join(', ')}.`);
        if (dip >= 0 && direction < 0 && strike >= 0) notes.push('Dip direction was taken as strike + 90° (the right-hand rule).');
        else if (dip >= 0 && direction < 0) notes.push('It has a dip column but none for dip direction: the dips were not used.');
    } else if (rows[0].length >= 5) {
        dip = 3;
        direction = 4;
    }
    if (rows[0].length < 3) throw new Error('It needs three columns at least: east, north and elevation.');

    const points: ImportedShapes['points'] = [];
    const lines = new Map<string, Vec3[]>();
    let skipped = 0;
    for (const row of rows.slice(headed ? 1 : 0)) {
        const p: Vec3 = [num(row[x]), num(row[y]), num(row[z])];
        if (!p.every(Number.isFinite)) { skipped++; continue; }
        const key = lineId >= 0 ? String(row[lineId] ?? '').trim() : '';
        if (key) {
            const own = lines.get(key);
            if (own) own.push(p);
            else lines.set(key, [p]);
            continue;
        }
        const bearing = direction >= 0 ? num(row[direction]) : strike >= 0 ? num(row[strike]) + 90 : NaN;
        const reading = dip >= 0 ? cleanReading({ dip: num(row[dip]), dipDirection: bearing }) : null;
        points.push(reading ? { p, reading } : { p });
    }
    if (skipped > 0) notes.push(`${skipped.toLocaleString()} row${skipped === 1 ? '' : 's'} without all three coordinates ${skipped === 1 ? 'was' : 'were'} left out.`);
    const out: Vec3[][] = [];
    const tally = { cut: 0 };
    for (const own of lines.values()) {
        const line = clean(own, tally);
        if (line) out.push(line);
        else points.push({ p: own[0] });
    }
    if (tally.cut > 0) notes.push(cutNote(tally.cut));
    if (points.length === 0 && out.length === 0) throw new Error('No row has all three coordinates.');
    return { points, lines: out, notes };
}

/** Points and lines from the text of an (ASCII) DXF file. Throws when it has neither. */
export function shapesFromDxf(text: string): ImportedShapes {
    const notes: string[] = [];
    const parts = parseDxf(text, notes);
    const lines: Vec3[][] = [];
    const tally = { cut: 0 };
    let faces = 0;
    for (const part of parts) {
        faces += part.triangles.length / 3;
        lines.push(...partLines(part, tally));
    }
    if (tally.cut > 0) notes.push(cutNote(tally.cut));
    const points: ImportedShapes['points'] = [];
    for (const e of dxfEntities(text)) {
        if (e.type !== 'POINT') continue;
        const value = (code: number) => { const pair = e.pairs.find(([c]) => c === code); return pair ? parseFloat(pair[1]) : NaN; };
        const p: Vec3 = [value(10), value(20), value(30)];
        if (!Number.isFinite(p[2])) p[2] = 0;
        if (p.every(Number.isFinite)) points.push({ p });
    }
    if (faces > 0) notes.push('Its faces were not used: a surface is built through points and lines. (Load it as a mesh to see it.)');
    if (points.length === 0 && lines.length === 0) throw new Error(faces > 0 ? 'It holds a mesh, not points or lines. Load it as a mesh instead.' : 'No points or lines were found in it.');
    return { points, lines, notes };
}

/** Lines from the text of a GOCAD file (PLine objects; the faces of a surface in it are not used). Throws when it has none. */
export function shapesFromGocad(text: string): ImportedShapes {
    const notes: string[] = [];
    const tally = { cut: 0 };
    const lines: Vec3[][] = [];
    let faces = 0;
    for (const part of parseGocad(text)) {
        faces += part.triangles.length / 3;
        lines.push(...partLines(part, tally));
    }
    if (tally.cut > 0) notes.push(cutNote(tally.cut));
    if (faces > 0) notes.push('Its faces were not used: a surface is built through points and lines. (Load it as a mesh to see it.)');
    if (lines.length === 0) throw new Error(faces > 0 ? 'It holds a mesh, not lines. Load it as a mesh instead.' : 'No lines were found in it.');
    return { points: [], lines, notes };
}

/** Lines from the text of a Surpac string file. Throws when it has none. */
export function shapesFromSurpac(text: string): ImportedShapes {
    const tally = { cut: 0 };
    const lines = linesFromSurpac(text).map(l => clean(l, tally)).filter((l): l is Vec3[] => !!l);
    if (lines.length === 0) throw new Error('No strings of two points or more were found in it.');
    return { points: [], lines, notes: tally.cut > 0 ? [cutNote(tally.cut)] : [] };
}

/**
 * Lines and points from a Leapfrog polyline file, as Leapfrog has them: every
 * node kept, each line with the plane it was drawn on, a tangent at a node as
 * the direction the surface runs in there, curves as smooth lines, and a
 * normal at a point as a dip reading. Throws when it is not one, or is empty.
 */
export function shapesFromLeapfrog(data: ArrayBuffer | Uint8Array): ImportedShapes {
    const read = shapesFromLfpl(data);
    const notes: string[] = [];
    const curved = read.lines.filter(l => l.curved).length;
    if (curved > 0) notes.push(`${curved.toLocaleString()} ${curved === 1 ? 'line is' : 'lines are'} curved: here ${curved === 1 ? 'it runs' : 'they run'} as a smooth curve through ${curved === 1 ? 'its' : 'their'} nodes.`);
    const added = read.lines.reduce((n, l) => n + (l.added ?? 0), 0);
    if (added > 0) notes.push(`${added.toLocaleString()} ${added === 1 ? 'node was' : 'nodes were'} put in along curves that bend unlike a smooth curve through their nodes, to keep to them.`);
    if (read.lines.length === 0 && read.points.length === 0) throw new Error('No points or lines were found in it.');
    return {
        points: read.points,
        lines: read.lines.map(l => l.points),
        known: read.lines.map(l => ({ plane: l.plane, ...(l.nodes ? { nodes: l.nodes } : {}), ...(l.smooth ? { smooth: true } : {}) })),
        notes,
    };
}

/** The file types `shapesFromFile` reads, for a file chooser */
export const SHAPE_FILE_TYPES = '.csv,.txt,.dxf,.lfpl,.str,.pl,.ts';
/** ... of which these are not text */
export const isBinaryShapeFile = (fileName: string) => /\.lfpl$/i.test(fileName);

/** Points, lines and readings from a file, by its name: its text, or its bytes for a Leapfrog polyline file. */
export function shapesFromFile(fileName: string, data: string | ArrayBuffer | Uint8Array): ImportedShapes {
    if (isBinaryShapeFile(fileName)) {
        if (typeof data === 'string') throw new Error('A Leapfrog polyline file is read from its bytes, not as text.');
        return shapesFromLeapfrog(data);
    }
    const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
    if (/\.dxf$/i.test(fileName)) return shapesFromDxf(text);
    if (/\.(csv|txt)$/i.test(fileName)) return shapesFromCsv(text);
    if (/\.str$/i.test(fileName)) return shapesFromSurpac(text);
    if (/\.(pl|ts)$/i.test(fileName)) return shapesFromGocad(text);
    throw new Error('Points and lines are read from CSV, DXF, Leapfrog polyline (.lfpl), Surpac string (.str) and GOCAD (.pl) files.');
}

/** A line bends this much, as a share of its length, before it is taken to lie in a plane of its own */
const BENDS = 0.02;
/** ... and strays from that plane by less than this share of its bend */
const FLAT = 0.1;

/**
 * The plane a line was drawn in (the section or the plan it was digitised
 * on): a surface crosses that plane along the line. A line that bends lies
 * in one plane if it lies in any. A straight line does not say: a level one
 * is taken as a trace on a plan, any other as drawn on the upright section
 * that holds it. Null when it has no plane (it wanders in all three
 * directions, like a string draped over ground, or is a single upright
 * stretch): its vertices are then just points.
 */
export function linePlane(points: readonly Vec3[]): Plane | null {
    const fit = bestFitPlane(points.flat());
    if (!fit || !(fit.spread[0] > 0)) return null;
    if (fit.spread[1] >= BENDS * fit.spread[0]) {
        return fit.spread[2] <= FLAT * fit.spread[1] ? { normal: fit.normal, point: fit.point } : null;
    }
    const level = Math.abs(fit.along[2]) < 0.02;
    const normal = level ? [0, 0, 1] as Vec3 : unit(cross(fit.along, [0, 0, 1]));
    return normal ? { normal, point: fit.point } : null;
}
