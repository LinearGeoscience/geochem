/**
 * A geological model on one section or plan of a section set, as a drawing
 * (pure, unit-tested): each unit as the filled outline its solid makes on
 * the plane, the faults, the holes within the set's width with what is
 * logged down them, a grid, a scale and a legend. Given as one SVG, and as linework for a DXF.
 *
 * The outlines are read from the model itself on the plane (planeUnits.ts):
 * its unit at places a metre or two apart where units meet, so a contact is
 * drawn where the surfaces put it, not where the model's cells do. The
 * units' areas add up to the area of the model's own cut. (A build that has
 * nothing to read the model from is drawn from its solids, as blocky as its
 * cells.)
 */
import { planeAxes, type PlaneAxes } from '../plots/viewer3d/sectionGrid';
import { SIDE_COLORS } from './contactControl';
import { OUTSIDE } from './cutCells';
import type { ModelResult } from './geoModelCache';
import { unitsAtPoints, type ModelOutput } from './geoModelJobs';
import { linesDxf, type OutLine } from './inputWriters';
import { faultMesh, modelHull, unitSolid } from './modelParts';
import { traceLabels, traceStep, type Traced } from './planeUnits';
import { sectionMesh } from './section';
import { sectionLabel, sectionPlane } from './sectionSets';
import type { Plane, SectionSet, TriMesh, Vec3 } from './types';

/** A line on the plane: in the plane's own two coordinates (u, v pairs), and where it is in the ground (xyz triples) */
export interface CutLine { uv: Float64Array; world: Float64Array }

export interface SectionUnit {
    unit: string;
    color: string;
    /** Its outlines: each comes back to where it starts. One inside another is a hole in it. */
    loops: CutLine[];
    /** The area it covers on the plane, m2 */
    area: number;
    /** Too thin for the model's cells: drawn from its own surface, over the units it is in (its area on a section is not taken out of theirs) */
    thin?: boolean;
}

export interface SectionCut {
    /** What the section is called: "7,300,150 N" */
    label: string;
    plane: Plane;
    axes: PlaneAxes;
    /** The extent of the model's cut in the plane's coordinates */
    window: { u0: number; u1: number; v0: number; v1: number };
    /** The area of the model's cut, m2: the units' areas add up to it */
    area: number;
    units: SectionUnit[];
    faults: { name: string; lines: CutLine[] }[];
    holes: { name: string; line: CutLine }[];
    /** How far apart the places are that the units were read at where they meet, m (absent: drawn from the model's solids) */
    step?: number;
    /** The logged intervals of the model's lithologies within the section's width, each drawn on its hole in its unit's colour (absent: no logging was given) */
    logged?: SectionBar[];
    /** The places held on one side of the model's surfaces by hand, within the section's width (absent: none given) */
    marks?: SectionMark[];
}

/** A place a surface is held on one side of by hand, on a section: drawn in the colour the view marks that side in */
export interface SectionMark {
    /** The surface it is on */
    surface: string;
    /** Where it is on the plane */
    uv: [number, number];
    side: 1 | -1;
    /** How far clear of the surface it is held, m (absent: just clear): drawn as a ring that wide */
    by?: number;
    /** A lens of an intrusion: its outline on this plane (contactControl `lensOutline`), drawn in place of the ring */
    ring?: { a: number; b: number; turn: number };
    /** A link: where its other end is on the plane; a line is drawn between the two */
    to?: [number, number];
    /** What it says, for the legend: "inside Dyke", "outside Dyke" */
    says: string;
}

/**
 * The logging down the holes in pieces, to draw on a section and to count
 * against the model: each piece of a logged interval with where it starts
 * and ends in the ground, the unit it is logged as, and the unit the model
 * has at its middle.
 */
export interface LoggedPieces {
    /** Where each piece starts and ends, xyz and xyz (six numbers a piece), in order down each hole */
    ends: Float64Array;
    /** Its length down the hole, m */
    length: ArrayLike<number>;
    hole: ArrayLike<string>;
    /** The unit it is logged as */
    unit: ArrayLike<string>;
    /** The unit the model has at its middle (null: outside the model) */
    modelled: ArrayLike<string | null>;
}

/** A stretch of logged interval on a section: pieces that follow one another down a hole, logged as one unit, the model the same all along */
export interface SectionBar {
    hole: string;
    unit: string;
    color: string;
    /** Its two ends on the plane (u, v, u, v), and where they are in the ground (xyz, xyz) */
    uv: Float64Array;
    world: Float64Array;
    metres: number;
    /**
     * What the model has where the stretch is in the ground (null: outside
     * the model). That is up to half the section's width off the plane, so
     * it is not always the unit drawn behind the bar.
     */
    modelled: string | null;
}

/** How much of the logging on a section the model agrees with: all of it, and unit by unit (the most logged first) */
export interface SectionAgreement {
    /** Metres logged on the section, inside the model, and how many of them the model has as logged */
    metres: number;
    agreed: number;
    units: { unit: string; metres: number; agreed: number }[];
}

/**
 * The logged pieces within `width` of a plane (half either side, by their
 * middles), as bars on it. Pieces that follow one another down a hole, in
 * one unit and with the model the same, are one bar.
 */
export function barsOn(plane: Plane, axes: PlaneAxes, width: number, pieces: LoggedPieces, colorOf: (unit: string) => string): SectionBar[] {
    const out: SectionBar[] = [];
    const [nx, ny, nz] = plane.normal, [px, py, pz] = plane.point, half = width / 2, e = pieces.ends;
    let last: SectionBar | null = null;
    for (let i = 0; i * 6 < e.length; i++) {
        const k = i * 6;
        const off = ((e[k] + e[k + 3]) / 2 - px) * nx + ((e[k + 1] + e[k + 4]) / 2 - py) * ny + ((e[k + 2] + e[k + 5]) / 2 - pz) * nz;
        if (!(Math.abs(off) <= half)) { last = null; continue; }
        const hole = pieces.hole[i], unit = pieces.unit[i], modelled = pieces.modelled[i] ?? null;
        const joins = last && last.hole === hole && last.unit === unit && last.modelled === modelled
            && Math.abs(last.world[3] - e[k]) < 1e-6 && Math.abs(last.world[4] - e[k + 1]) < 1e-6 && Math.abs(last.world[5] - e[k + 2]) < 1e-6;
        if (last && joins) {
            last.world.set([e[k + 3], e[k + 4], e[k + 5]], 3);
            last.metres += pieces.length[i];
        } else {
            last = { hole, unit, color: colorOf(unit), uv: new Float64Array(4), world: Float64Array.from(e.subarray(k, k + 6)), metres: pieces.length[i], modelled };
            out.push(last);
        }
    }
    for (const bar of out) for (let end = 0; end < 2; end++) {
        const p = [bar.world[end * 3], bar.world[end * 3 + 1], bar.world[end * 3 + 2]];
        bar.uv[end * 2] = axes.uAt(p);
        bar.uv[end * 2 + 1] = axes.vAt(p);
    }
    return out;
}

/** What the bars of a section come to (null: none of them is inside the model) */
export function sectionAgreement(bars: readonly SectionBar[]): SectionAgreement | null {
    const units = new Map<string, { unit: string; metres: number; agreed: number }>();
    let metres = 0, agreed = 0;
    for (const bar of bars) {
        if (bar.modelled === null) continue;
        let u = units.get(bar.unit);
        if (!u) units.set(bar.unit, u = { unit: bar.unit, metres: 0, agreed: 0 });
        u.metres += bar.metres;
        metres += bar.metres;
        if (bar.modelled === bar.unit) { u.agreed += bar.metres; agreed += bar.metres; }
    }
    return metres > 0 ? { metres, agreed, units: [...units.values()].sort((a, b) => b.metres - a.metres) } : null;
}

const metresText = (v: number) => Math.round(v).toLocaleString('en-US');
const shareText = (part: number, of: number) => `${Math.round(100 * part / Math.max(of, 1e-9))}%`;

/** A section's agreement in words: the whole, then the units the model has least of as logged */
export function agreementText(a: SectionAgreement): string[] {
    const off = a.units.filter(u => u.metres - u.agreed >= 0.5).sort((x, y) => x.agreed / x.metres - y.agreed / y.metres);
    return [
        `The holes on it log ${metresText(a.metres)} m in the model's lithologies; the model has ${metresText(a.agreed)} m of that (${shareText(a.agreed, a.metres)}) as logged.`,
        ...(off.length ? [`Least as logged: ${off.slice(0, 4).map(u => `${u.unit} ${metresText(u.agreed)} of ${metresText(u.metres)} m`).join(', ')}.`] : []),
    ];
}

/** Samples down the holes, to draw the holes near a section from */
export interface HoleRows {
    hole: ArrayLike<string>;
    x: ArrayLike<number>; y: ArrayLike<number>; z: ArrayLike<number>;
    /** Depth down the hole (absent: the rows are taken to be in order down each hole) */
    from?: ArrayLike<number> | null;
}

const closed = (l: Float64Array) => l.length >= 9 && l[0] === l[l.length - 3] && l[1] === l[l.length - 2] && l[2] === l[l.length - 1];

function onPlane(axes: PlaneAxes, world: Float64Array): CutLine {
    const n = world.length / 3, uv = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
        const p = [world[i * 3], world[i * 3 + 1], world[i * 3 + 2]];
        uv[i * 2] = axes.uAt(p);
        uv[i * 2 + 1] = axes.vAt(p);
    }
    return { uv, world };
}

/** The area inside a closed line (u, v pairs), m2 */
function ringArea(uv: Float64Array): number {
    let a = 0;
    for (let i = 0; i + 3 < uv.length; i += 2) a += uv[i] * uv[i + 3] - uv[i + 2] * uv[i + 1];
    return Math.abs(a) / 2;
}

function inside(uv: Float64Array, u: number, v: number): boolean {
    let within = false;
    for (let i = 0; i + 3 < uv.length; i += 2) {
        const u0 = uv[i], v0 = uv[i + 1], u1 = uv[i + 2], v1 = uv[i + 3];
        if ((v0 > v) !== (v1 > v) && u < u0 + (v - v0) * (u1 - u0) / (v1 - v0)) within = !within;
    }
    return within;
}

/** The area a set of closed lines covers, one inside another being a hole in it */
export function loopsArea(loops: readonly CutLine[]): number {
    let area = 0;
    loops.forEach((l, k) => {
        let depth = 0;
        loops.forEach((other, j) => { if (j !== k && inside(other.uv, l.uv[0], l.uv[1])) depth++; });
        area += (depth % 2 ? -1 : 1) * ringArea(l.uv);
    });
    return area;
}

/** The outlines a closed solid makes on a plane */
function outlines(mesh: TriMesh, plane: Plane, axes: PlaneAxes): CutLine[] {
    return sectionMesh(mesh, plane).filter(closed).map(l => onPlane(axes, l));
}

/**
 * The holes within `width` of a plane (half either side), each as the part
 * of its path that is there: from where it comes into the slab to where it
 * leaves, worked out between its samples (so a hole crossing a thin slab
 * between two samples is still drawn). A hole that leaves the slab and
 * comes back is drawn as the pieces that are in it.
 */
export function holesNear(plane: Plane, width: number, rows: HoleRows, axes: PlaneAxes): { name: string; line: CutLine }[] {
    const byHole = new Map<string, number[]>();
    for (let i = 0; i < rows.hole.length; i++) {
        const name = rows.hole[i];
        if (!name || !Number.isFinite(rows.x[i]) || !Number.isFinite(rows.y[i]) || !Number.isFinite(rows.z[i])) continue;
        let list = byHole.get(name);
        if (!list) byHole.set(name, list = []);
        list.push(i);
    }
    const out: { name: string; line: CutLine }[] = [];
    const [nx, ny, nz] = plane.normal, [px, py, pz] = plane.point;
    for (const [name, list] of byHole) {
        if (rows.from) list.sort((a, b) => rows.from![a] - rows.from![b]);
        let run: number[] = [];
        const end = () => {
            if (run.length >= 6) out.push({ name, line: onPlane(axes, Float64Array.from(run)) });
            run = [];
        };
        const half = width / 2;
        const off = (i: number) => (rows.x[i] - px) * nx + (rows.y[i] - py) * ny + (rows.z[i] - pz) * nz;
        const add = (x: number, y: number, z: number) => {
            const n = run.length;
            if (n >= 3 && run[n - 3] === x && run[n - 2] === y && run[n - 1] === z) return;
            run.push(x, y, z);
        };
        for (let k = 0; k + 1 < list.length; k++) {
            const a = list[k], b = list[k + 1];
            const oa = off(a), ob = off(b);
            // The part of this stretch of hole that is in the slab, as shares of the way from a to b
            let t0 = 0, t1 = 1;
            if (oa === ob) { if (Math.abs(oa) > half) t0 = 2; }
            else {
                const u = (-half - oa) / (ob - oa), v = (half - oa) / (ob - oa);
                t0 = Math.max(0, Math.min(u, v));
                t1 = Math.min(1, Math.max(u, v));
            }
            if (t0 > t1) { end(); continue; }
            if (t0 > 0) end();
            const at = (t: number) => add(rows.x[a] + (rows.x[b] - rows.x[a]) * t, rows.y[a] + (rows.y[b] - rows.y[a]) * t, rows.z[a] + (rows.z[b] - rows.z[a]) * t);
            at(t0);
            at(t1);
            if (t1 < 1) end();
        }
        end();
    }
    return out;
}

// The last sections read from each build: a section is asked for again as a picture, as linework and for the report
const traces = new WeakMap<ModelOutput, Map<string, Traced>>();
const KEPT_TRACES = 40;

/** The units of a build on a plane, read from the model itself (null: it has nothing to be read from) */
function tracedOn(result: ModelResult, plane: Plane, axes: PlaneAxes, window: SectionCut['window']): { traced: Traced; line: (uv: Float64Array) => CutLine } | null {
    const { job, out } = result;
    if (!job || !out) return null;
    const pu = axes.uAt(plane.point), pv = axes.vAt(plane.point);
    const world = (uv: Float64Array) => {
        const xyz = new Float64Array(uv.length / 2 * 3);
        for (let i = 0; i * 2 < uv.length; i++) {
            const du = uv[i * 2] - pu, dv = uv[i * 2 + 1] - pv;
            for (let k = 0; k < 3; k++) xyz[i * 3 + k] = plane.point[k] + du * axes.u[k] + dv * axes.v[k];
        }
        return xyz;
    };
    // (A cell wider than the solids' cut: the solids are only as true as the cells)
    const pad = out.grid.cell;
    const wide = { u0: window.u0 - pad, u1: window.u1 + pad, v0: window.v0 - pad, v1: window.v1 + pad };
    const key = `${plane.normal.join(',')}|${plane.point.join(',')}|${axes.u.join(',')}|${axes.v.join(',')}`;
    let kept = traces.get(out);
    if (!kept) traces.set(out, kept = new Map());
    let traced = kept.get(key);
    if (!traced) {
        traced = traceLabels(uv => unitsAtPoints(job, out.topSense, world(uv)), wide, { outside: OUTSIDE, step: traceStep(wide, Math.min(1, out.grid.cell / 10)) });
        if (kept.size >= KEPT_TRACES) kept.delete(kept.keys().next().value!);
        kept.set(key, traced);
    }
    return { traced, line: uv => ({ uv, world: world(uv) }) };
}

/**
 * A built model on plane `index` of a section set. Null when the plane
 * misses the model. `faultNames`: what its faults are called, in the order
 * of the build. `rows`: the samples, to draw the holes near the plane.
 */
export function cutModel(result: ModelResult, set: SectionSet, index: number, faultNames: readonly string[] = [], rows: HoleRows | null = null): SectionCut | null {
    const out = result.out;
    if (!out) return null;
    const plane = sectionPlane(set, index), axes = planeAxes(set);
    const hull = outlines(modelHull(out), plane, axes);
    if (hull.length === 0) return null;
    const window = { u0: Infinity, u1: -Infinity, v0: Infinity, v1: -Infinity };
    for (const l of hull) for (let i = 0; i < l.uv.length; i += 2) {
        window.u0 = Math.min(window.u0, l.uv[i]); window.u1 = Math.max(window.u1, l.uv[i]);
        window.v0 = Math.min(window.v0, l.uv[i + 1]); window.v1 = Math.max(window.v1, l.uv[i + 1]);
    }
    const units: SectionUnit[] = [];
    const read = tracedOn(result, plane, axes, window);
    const fromModel = !!read && read.traced.hull.length > 0;
    let area = 0;
    if (read && fromModel) {
        // Read from the model itself: any unit as thick as the places read are apart is there
        const whole = read.traced.hull.map(read.line);
        Object.assign(window, { u0: Infinity, u1: -Infinity, v0: Infinity, v1: -Infinity });
        for (const l of whole) for (let i = 0; i < l.uv.length; i += 2) {
            window.u0 = Math.min(window.u0, l.uv[i]); window.u1 = Math.max(window.u1, l.uv[i]);
            window.v0 = Math.min(window.v0, l.uv[i + 1]); window.v1 = Math.max(window.v1, l.uv[i + 1]);
        }
        area = loopsArea(whole);
        result.units.forEach((unit, u) => {
            const loops = (read.traced.loops.get(u) ?? []).map(read.line);
            if (loops.length > 0) units.push({ unit, color: result.colors[u] ?? '#999999', loops, area: loopsArea(loops) });
        });
    } else {
        area = loopsArea(hull);
        result.units.forEach((unit, u) => {
            const loops = outlines(unitSolid(out, u), plane, axes);
            if (loops.length > 0) units.push({ unit, color: result.colors[u] ?? '#999999', loops, area: loopsArea(loops) });
        });
    }
    // A vein too thin for the cells is in the build as its own mesh, and in neither of the above
    for (const thin of out.thin ?? []) {
        const loops = outlines(thin, plane, axes);
        if (loops.length > 0) units.push({ unit: result.units[thin.unit], color: result.colors[thin.unit] ?? '#999999', loops, area: loopsArea(loops), thin: true });
    }
    // (A fault that younger faults offset is in the build once a piece: its pieces are one fault here)
    const faults = result.faults.flatMap((id, f) => (result.faults.indexOf(id) !== f ? [] : [{
        name: faultNames[f] ?? `Fault ${f + 1}`,
        lines: result.faults.flatMap((x, g) => (x === id ? sectionMesh(faultMesh(out, g), plane).map(l => onPlane(axes, l)) : [])),
    }])).filter(f => f.lines.length > 0);
    return {
        label: sectionLabel(set, index), plane, axes, window, area, units, faults,
        holes: rows ? holesNear(plane, set.width, rows, axes) : [],
        ...(read && fromModel ? { step: read.traced.step } : {}),
    };
}

/** A round step (1, 2 or 5 times a power of ten) that gives about `count` steps over a span */
export function roundStep(span: number, count = 6): number {
    const raw = Math.max(span, 1e-9) / count, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (v: number) => (Math.round(v * 10) / 10).toString();
/** The edge of a logged stretch the model has as another unit: the first of these that is not close to a colour on the section */
const DIFFERS = ['#ff1744', '#00e5ff', '#ffea00', '#d500f9'];
const rgb = (hex: string): [number, number, number] | null => {
    const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
    return m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)] : null;
};

/**
 * The colour of the edge that marks a logged stretch the model has as
 * another unit, given the colours of the units on the section: a red,
 * unless a unit is drawn in a colour near it (a dyke in red would hide the
 * mark), then the first of the others that stands clear, or the clearest.
 */
export function differsColor(colors: readonly string[]): string {
    const others = colors.map(rgb).filter((c): c is [number, number, number] => c !== null);
    let best = DIFFERS[0], clear = -1;
    for (const d of DIFFERS) {
        const c = rgb(d)!;
        const near = others.reduce((least, o) => Math.min(least, Math.hypot(c[0] - o[0], c[1] - o[1], c[2] - o[2])), Infinity);
        if (near >= 120) return d;
        if (near > clear) { clear = near; best = d; }
    }
    return best;
}

export interface SvgOptions {
    /** Above the drawing: the model's name and what the section is called, unless given */
    title?: string;
    /** The width of the whole picture, px */
    width?: number;
    /** Heights drawn this many times taller than widths (1: true to scale) */
    exaggeration?: number;
}

/** A section as one SVG picture: true to scale unless told otherwise, with its grid, scale bar and legend */
export function sectionSvg(cut: SectionCut, options: SvgOptions = {}): string {
    const W = options.width ?? 1200, ve = options.exaggeration && options.exaggeration > 0 ? options.exaggeration : 1;
    const bars = cut.logged ?? [], told = sectionAgreement(bars);
    const differs = bars.some(b => b.modelled !== null && b.modelled !== b.unit);
    const edge = differsColor([...cut.units.map(u => u.color), ...bars.map(b => b.color)]);
    const left = 86, top = 44, legendWidth = 190, bottom = 58 + (told ? 18 : 0);
    const { u0, u1, v0, v1 } = cut.window;
    const scale = (W - left - legendWidth - 16) / Math.max(u1 - u0, 1e-9);
    const plotW = (u1 - u0) * scale, plotH = (v1 - v0) * scale * ve;
    const legendRows = cut.units.filter((x, i, a) => a.findIndex(y => y.unit === x.unit) === i);
    const handRows = (cut.marks ?? []).filter((m, i, a) => a.findIndex(o => o.side === m.side && o.says === m.says) === i).length;
    const H = Math.max(top + plotH + bottom, top + 38 + 20 * (legendRows.length + cut.faults.length + 2 + (bars.length ? (differs ? 2 : 1) : 0) + Math.min(6, handRows)) + (handRows ? 8 : 0));
    const X = (u: number) => left + (u - u0) * scale, Y = (v: number) => top + plotH - (v - v0) * scale * ve;
    const path = (uv: Float64Array, close: boolean) => {
        let d = '';
        for (let i = 0; i < uv.length; i += 2) d += `${i ? 'L' : 'M'}${r1(X(uv[i]))} ${r1(Y(uv[i + 1]))}`;
        return close ? `${d}Z` : d;
    };
    const s: string[] = [];
    s.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Math.round(H)}" viewBox="0 0 ${W} ${Math.round(H)}" font-family="Arial, Helvetica, sans-serif" font-size="12">`);
    s.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
    s.push(`<text x="${left}" y="24" font-size="16" font-weight="bold">${esc(options.title ?? cut.label)}</text>`);
    s.push(`<clipPath id="frame"><rect x="${left}" y="${top}" width="${r1(plotW)}" height="${r1(plotH)}"/></clipPath>`);
    s.push(`<g clip-path="url(#frame)">`);
    for (const unit of cut.units) {
        s.push(`<path data-unit="${esc(unit.unit)}" d="${unit.loops.map(l => path(l.uv, true)).join('')}" fill="${esc(unit.color)}" fill-rule="evenodd" stroke="#333333" stroke-width="0.6" stroke-linejoin="round"/>`);
    }
    // A hole seen end-on (a vertical hole on a plan) is a dot
    const endOn = (uv: Float64Array) => {
        let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
        for (let i = 0; i < uv.length; i += 2) { a = Math.min(a, X(uv[i])); b = Math.max(b, X(uv[i])); c = Math.min(c, Y(uv[i + 1])); d = Math.max(d, Y(uv[i + 1])); }
        return b - a < 3 && d - c < 3;
    };
    for (const hole of cut.holes) {
        s.push(endOn(hole.line.uv)
            ? `<circle data-hole="${esc(hole.name)}" cx="${r1(X(hole.line.uv[0]))}" cy="${r1(Y(hole.line.uv[1]))}" r="2.2" fill="#000000"/>`
            : `<path data-hole="${esc(hole.name)}" d="${path(hole.line.uv, false)}" fill="none" stroke="#000000" stroke-width="1"/>`);
    }
    // The logging on the holes: each stretch in its unit's colour, edged in black; a wider, bright edge where
    // the model has another unit there. The edges first, so that no bar's edge lies over its neighbour.
    const agrees = (b: SectionBar) => b.modelled === null || b.modelled === b.unit;
    const dot = (b: SectionBar) => Math.hypot(X(b.uv[2]) - X(b.uv[0]), Y(b.uv[3]) - Y(b.uv[1])) < 2;
    const along = (b: SectionBar) => `M${r1(X(b.uv[0]))} ${r1(Y(b.uv[1]))}L${r1(X(b.uv[2]))} ${r1(Y(b.uv[3]))}`;
    for (const b of bars) {
        s.push(dot(b)
            ? `<circle cx="${r1(X(b.uv[0]))}" cy="${r1(Y(b.uv[1]))}" r="${agrees(b) ? 4 : 5.2}" fill="${agrees(b) ? '#000000' : edge}"/>`
            : `<path d="${along(b)}" fill="none" stroke="${agrees(b) ? '#000000' : edge}" stroke-width="${agrees(b) ? 5.4 : 8}"/>`);
    }
    for (const b of bars) {
        const data = `data-logged="${esc(b.unit)}" data-in-hole="${esc(b.hole)}" data-agrees="${agrees(b) ? 'yes' : 'no'}"`;
        s.push(dot(b)
            ? `<circle ${data} cx="${r1(X(b.uv[0]))}" cy="${r1(Y(b.uv[1]))}" r="2.8" fill="${esc(b.color)}"/>`
            : `<path ${data} d="${along(b)}" fill="none" stroke="${esc(b.color)}" stroke-width="3.6"/>`);
    }
    for (const fault of cut.faults) for (const l of fault.lines) s.push(`<path data-fault="${esc(fault.name)}" d="${path(l.uv, false)}" fill="none" stroke="#c62828" stroke-width="2"/>`);
    s.push(`</g>`);
    // What is held by hand: a dot in the colour of its side, and a ring as far out as it is held clear (a lens: its outline here)
    const marks = cut.marks ?? [];
    for (const m of marks) {
        const x = r1(X(m.uv[0])), y = r1(Y(m.uv[1])), color = SIDE_COLORS[m.side];
        if (m.to) s.push(`<line data-link="${m.side > 0 ? 'first' : 'second'}" x1="${x}" y1="${y}" x2="${r1(X(m.to[0]))}" y2="${r1(Y(m.to[1]))}" stroke="${color}" stroke-width="2"/>`);
        if (m.ring && Math.max(m.ring.a, m.ring.b) * scale > 4.5) {
            // A lens: its outline where the section cuts it
            const c = Math.cos(m.ring.turn), t = Math.sin(m.ring.turn);
            let d = '';
            for (let k = 0; k < 36; k++) {
                const q = (k / 36) * 2 * Math.PI, a = m.ring.a * Math.cos(q), b = m.ring.b * Math.sin(q);
                d += `${k ? 'L' : 'M'}${r1(X(m.uv[0] + a * c - b * t))} ${r1(Y(m.uv[1] + a * t + b * c))}`;
            }
            s.push(`<path data-ring="lens" d="${d}Z" fill="none" stroke="${color}" stroke-width="1.2" stroke-dasharray="4 3"/>`);
        } else if (!m.ring && m.by && m.by * scale > 4.5) s.push(`<ellipse cx="${x}" cy="${y}" rx="${r1(m.by * scale)}" ry="${r1(m.by * scale * ve)}" fill="none" stroke="${color}" stroke-width="1.2" stroke-dasharray="4 3"/>`);
        s.push(`<circle data-mark="${m.side > 0 ? 'first' : 'second'}" cx="${x}" cy="${y}" r="3.6" fill="${color}" stroke="#ffffff" stroke-width="1.2"><title>${esc(`${m.surface}: ${m.says}${m.by ? ` by ${m.by} m` : ''}`)}</title></circle>`);
    }
    // The grid: round values each way, a faint line across and a label outside the frame
    // True to scale, the grid is square
    const stepU = roundStep(u1 - u0), stepV = ve === 1 ? stepU : roundStep((v1 - v0) * ve, Math.max(2, Math.round(6 * plotH / Math.max(plotW, 1))));
    for (let u = Math.ceil(u0 / stepU) * stepU; u <= u1 + 1e-9; u += stepU) {
        s.push(`<line x1="${r1(X(u))}" y1="${top}" x2="${r1(X(u))}" y2="${r1(top + plotH)}" stroke="#000000" stroke-opacity="0.18" stroke-width="0.5"/>`);
        s.push(`<text x="${r1(X(u))}" y="${r1(top + plotH + 16)}" text-anchor="middle">${esc(cut.axes.uLabel(u))}</text>`);
    }
    for (let v = Math.ceil(v0 / stepV) * stepV; v <= v1 + 1e-9; v += stepV) {
        s.push(`<line x1="${left}" y1="${r1(Y(v))}" x2="${r1(left + plotW)}" y2="${r1(Y(v))}" stroke="#000000" stroke-opacity="0.18" stroke-width="0.5"/>`);
        s.push(`<text x="${left - 6}" y="${r1(Y(v) + 4)}" text-anchor="end">${esc(cut.axes.vLabel(v))}</text>`);
    }
    s.push(`<rect x="${left}" y="${top}" width="${r1(plotW)}" height="${r1(plotH)}" fill="none" stroke="#000000" stroke-width="1"/>`);
    // Named at its first sample inside the frame, just above it (a hole that is nowhere inside it is not named); where
    // names would run into one another, only those with room are written
    const taken: { x0: number; x1: number; y: number }[] = [];
    for (const hole of [...cut.holes].sort((a, b) => a.line.uv[0] - b.line.uv[0])) {
        const uv = hole.line.uv;
        let at = 0;
        while (at < uv.length && (uv[at] < u0 || uv[at] > u1 || uv[at + 1] < v0 || uv[at + 1] > v1)) at += 2;
        if (at >= uv.length) continue;
        const x = X(uv[at]), y = Math.max(top + 10, Y(uv[at + 1]) - 4), half = hole.name.length * 2.6 + 2;
        if (taken.some(t => Math.abs(t.y - y) < 10 && x - half < t.x1 && x + half > t.x0)) continue;
        taken.push({ x0: x - half, x1: x + half, y });
        s.push(`<text data-hole-name="${esc(hole.name)}" x="${r1(x)}" y="${r1(y)}" font-size="9" text-anchor="middle" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="round" paint-order="stroke">${esc(hole.name)}</text>`);
    }
    // The scale bar: a round length about a fifth of the way across
    const bar = roundStep(u1 - u0, 5), barY = top + plotH + 36;
    s.push(`<g data-scale="${bar}"><rect x="${left}" y="${r1(barY)}" width="${r1(bar * scale)}" height="5" fill="#000000"/>`);
    s.push(`<text x="${r1(left + bar * scale + 6)}" y="${r1(barY + 6)}">${esc(`${bar.toLocaleString('en-US')} m`)}${ve !== 1 ? esc(` across; heights drawn ${ve} times taller`) : ''}</text></g>`);
    // The legend
    const lx = left + plotW + 18;
    let ly = top + 12;
    s.push(`<text x="${r1(lx)}" y="${ly}" font-weight="bold">Units</text>`);
    // The youngest first, as they lie
    for (const unit of [...legendRows].reverse()) {
        ly += 20;
        s.push(`<rect x="${r1(lx)}" y="${ly - 11}" width="16" height="12" fill="${esc(unit.color)}" stroke="#333333" stroke-width="0.6"/>`);
        s.push(`<text x="${r1(lx + 22)}" y="${ly}">${esc(unit.unit)}</text>`);
    }
    if (cut.faults.length + cut.holes.length > 0) ly += 8;
    for (const fault of cut.faults) {
        ly += 20;
        s.push(`<line x1="${r1(lx)}" y1="${ly - 5}" x2="${r1(lx + 16)}" y2="${ly - 5}" stroke="#c62828" stroke-width="2"/>`);
        s.push(`<text x="${r1(lx + 22)}" y="${ly}">${esc(fault.name)}</text>`);
    }
    if (cut.holes.length > 0) {
        ly += 20;
        s.push(cut.holes.every(h => endOn(h.line.uv))
            ? `<circle cx="${r1(lx + 8)}" cy="${ly - 5}" r="2.2" fill="#000000"/>`
            : `<line x1="${r1(lx)}" y1="${ly - 5}" x2="${r1(lx + 16)}" y2="${ly - 5}" stroke="#000000" stroke-width="1"/>`);
        s.push(`<text x="${r1(lx + 22)}" y="${ly}">Drillholes</text>`);
    }
    if (bars.length > 0) {
        const sample = (edge: string, wide: number) => `<line x1="${r1(lx)}" y1="${ly - 5}" x2="${r1(lx + 16)}" y2="${ly - 5}" stroke="${edge}" stroke-width="${wide}"/><line x1="${r1(lx + 1)}" y1="${ly - 5}" x2="${r1(lx + 15)}" y2="${ly - 5}" stroke="#bdbdbd" stroke-width="3.6"/>`;
        ly += 20;
        s.push(sample('#000000', 5.4));
        s.push(`<text x="${r1(lx + 22)}" y="${ly}">Logged, in its colour</text>`);
        if (differs) {
            ly += 20;
            s.push(sample(edge, 8));
            s.push(`<text x="${r1(lx + 22)}" y="${ly}">Logged, modelled another</text>`);
        }
    }
    const said = marks.filter((m, i, a) => a.findIndex(o => o.side === m.side && o.says === m.says) === i).slice(0, 6);
    if (said.length > 0) ly += 8;
    for (const m of said) {
        ly += 20;
        s.push(`<circle cx="${r1(lx + 8)}" cy="${ly - 5}" r="3.6" fill="${SIDE_COLORS[m.side]}" stroke="#ffffff" stroke-width="1.2"/>`);
        s.push(`<text x="${r1(lx + 22)}" y="${ly}">By hand: ${esc(m.says)}</text>`);
    }
    if (told) s.push(`<text data-agreement="${Math.round(100 * told.agreed / told.metres)}" x="${left}" y="${r1(barY + 24)}">${esc(agreementText(told)[0])}</text>`);
    s.push(`</svg>`);
    return s.join('\n');
}

const points = (world: Float64Array): Vec3[] => Array.from({ length: world.length / 3 }, (_, i) => [world[i * 3], world[i * 3 + 1], world[i * 3 + 2]] as Vec3);

/** A section's linework where it is in the ground, for a DXF: the units' outlines, the faults and the holes, a layer each */
export function sectionLines(cut: SectionCut): OutLine[] {
    const out: OutLine[] = [];
    for (const unit of cut.units) for (const l of unit.loops) out.push({ name: unit.unit, points: points(l.world), plane: null });
    for (const fault of cut.faults) for (const l of fault.lines) out.push({ name: fault.name, points: points(l.world), plane: null });
    for (const hole of cut.holes) out.push({ name: 'Drillholes', points: points(hole.line.world), plane: null });
    for (const bar of cut.logged ?? []) out.push({ name: `Logged ${bar.unit}`, points: points(bar.world), plane: null });
    return out;
}

export const sectionDxf = (cut: SectionCut): string => linesDxf(sectionLines(cut));
