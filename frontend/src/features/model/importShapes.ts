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
 */
import Papa from 'papaparse';
import { guessAxisColumn } from '../plots/viewer3d/coordinateColumns';
import { dxfEntities, parseDxf } from '../plots/viewer3d/wireframeParsers';
import { simplifyLine } from './lines';
import { bestFitPlane, cross, unit } from './plane';
import { cleanReading } from './readings';
import type { Plane, PointReading, Vec3 } from './types';

export interface ImportedShapes {
    points: { p: Vec3; reading?: PointReading }[];
    /** Each with two vertices or more */
    lines: Vec3[][];
    /** What was left out or assumed, in plain words */
    notes: string[];
}

/** A line keeps at most this many vertices (the ones it needs least are left out) */
export const MAX_IMPORT_VERTICES = 120;

const lower = (s: string) => s.trim().toLowerCase().replace(/[\s_.-]+/g, '');
const DIP = ['dip', 'dipangle', 'dipdeg'];
const DIRECTION = ['dipdirection', 'dipdir', 'dipazimuth', 'dipazi', 'dipdirn', 'dd', 'azimuth', 'azi'];

/** The columns that look like a dip and a dip direction, by their names ('' = none does). */
export function guessDipColumns(names: readonly string[]): { dip: string; direction: string } {
    return { dip: names.find(n => DIP.includes(lower(n))) ?? '', direction: names.find(n => DIRECTION.includes(lower(n))) ?? '' };
}
const STRIKE = ['strike', 'strikerhr', 'strikeazimuth'];
const LINE = ['line', 'lineid', 'string', 'stringid', 'polyline', 'polylineid', 'feature', 'featureid', 'segment'];

function clean(line: Vec3[]): Vec3[] | null {
    const v = simplifyLine(line, 0, MAX_IMPORT_VERTICES);
    return v.length >= 2 ? v : null;
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
    for (const own of lines.values()) {
        const line = clean(own);
        if (line) out.push(line);
        else points.push({ p: own[0] });
    }
    if (points.length === 0 && out.length === 0) throw new Error('No row has all three coordinates.');
    return { points, lines: out, notes };
}

/** Points and lines from the text of an (ASCII) DXF file. Throws when it has neither. */
export function shapesFromDxf(text: string): ImportedShapes {
    const notes: string[] = [];
    const parts = parseDxf(text, notes);
    const lines: Vec3[][] = [];
    let faces = 0;
    for (const part of parts) {
        faces += part.triangles.length / 3;
        const at = (i: number): Vec3 => [part.vertices[i * 3], part.vertices[i * 3 + 1], part.vertices[i * 3 + 2]];
        // Stretches that follow on from one another are one line
        let current: number[] = [];
        const close = () => {
            const line = current.length >= 2 ? clean(current.map(at)) : null;
            if (line) lines.push(line);
            current = [];
        };
        for (let s = 0; s + 1 < part.lines.length; s += 2) {
            const a = part.lines[s], b = part.lines[s + 1];
            if (current.length > 0 && current[current.length - 1] === a) current.push(b);
            else { close(); current = [a, b]; }
        }
        close();
    }
    const points: ImportedShapes['points'] = [];
    for (const e of dxfEntities(text)) {
        if (e.type !== 'POINT') continue;
        const value = (code: number) => { const pair = e.pairs.find(([c]) => c === code); return pair ? parseFloat(pair[1]) : NaN; };
        const p: Vec3 = [value(10), value(20), value(30)];
        if (!Number.isFinite(p[2])) p[2] = 0;
        if (p.every(Number.isFinite)) points.push({ p });
    }
    if (faces > 0) notes.push('Its faces were not used: a surface is built through points and lines. (Load it as a wireframe to see it.)');
    if (points.length === 0 && lines.length === 0) throw new Error(faces > 0 ? 'It holds a mesh, not points or lines. Load it as a wireframe instead.' : 'No points or lines were found in it.');
    return { points, lines, notes };
}

/** Points, lines and readings from a file, by its name. */
export function shapesFromFile(fileName: string, text: string): ImportedShapes {
    if (/\.dxf$/i.test(fileName)) return shapesFromDxf(text);
    if (/\.(csv|txt)$/i.test(fileName)) return shapesFromCsv(text);
    throw new Error('Points and lines are read from CSV and DXF files.');
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
