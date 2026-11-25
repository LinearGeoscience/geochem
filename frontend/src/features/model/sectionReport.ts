/**
 * Sections and plans of a geological model, out of the app: one section, or
 * every section of a set, into the report; a section as a picture (.svg) or
 * as linework (.dxf). The drawing itself is sectionFigure.ts.
 */
import { useAppStore } from '../../store/appStore';
import { useModelStore } from '../../store/modelStore';
import { useReportStore } from '../../store/reportStore';
import { downloadText } from '../../utils/gisExport';
import { planeAxes } from '../plots/viewer3d/sectionGrid';
import { lensOutline, lensPlane, lensTimes } from './contactControl';
import type { HoleLog } from './contacts';
import { OUTSIDE } from './cutCells';
import { useGeoModelCache, type ModelResult } from './geoModelCache';
import { loggedSamples, type LoggedSamples } from './geoModelFlag';
import { labelsAtPoints } from './geoModelJobs';
import { useModelCache } from './modelCache';
import { unitLog } from './logging';
import { safeFileName } from './rebuildKit';
import { agreementText, barsOn, cutModel, sectionAgreement, sectionDxf, sectionSvg, type HoleRows, type LoggedPieces, type SectionAgreement, type SectionBar, type SectionMark, type SectionCut } from './sectionFigure';
import { sectionLabel, sectionPlane, sectionRange } from './sectionSets';
import type { GeoModel, Plane, SectionSet, UnitMap } from './types';

/** The samples as rows down the holes (null: the scene has no hole column) */
function holeRows(): HoleRows | null {
    const { coords } = useModelStore.getState().scene;
    const app = useAppStore.getState();
    if (!coords?.hole) return null;
    const x = app.getNumericColumn(coords.x), y = app.getNumericColumn(coords.y), z = app.getNumericColumn(coords.z);
    const raw = app.getRawColumn(coords.hole);
    if (!x || !y || !z || !raw) return null;
    const hole = raw instanceof Float64Array ? Array.from(raw, v => (Number.isFinite(v) ? String(v) : '')) : raw;
    return { hole, x, y, z, from: (coords.from && app.getNumericColumn(coords.from)) || null };
}

/** The logging is read in pieces this long down the holes, m: what a bar on a section is made of */
const PIECE = 1;

// The logging of a unit map in pieces, as last read: a set of sections asks for the same one over and over
let pieces: { data: unknown; coords: unknown; map: UnitMap; log: HoleLog; samples: LoggedSamples; along: Float64Array | null } | null = null;

/**
 * Which way each row's hole runs at it (unit vectors, xyz a row), from the
 * rows either side of it down its hole: for logging that has no path of its
 * own, so that an interval can be drawn from its top to its bottom about
 * the place its row is at.
 */
function holeDirections(log: HoleLog): Float64Array {
    const n = log.from.length, out = new Float64Array(n * 3);
    const byHole = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
        const name = log.hole[i];
        if (!name || !Number.isFinite(log.x[i]) || !Number.isFinite(log.y[i]) || !Number.isFinite(log.z[i])) continue;
        const list = byHole.get(name);
        if (list) list.push(i); else byHole.set(name, [i]);
    }
    for (const rows of byHole.values()) {
        rows.sort((a, b) => log.from[a] - log.from[b]);
        rows.forEach((i, k) => {
            const a = rows[Math.max(0, k - 1)], b = rows[Math.min(rows.length - 1, k + 1)];
            const d = [log.x[b] - log.x[a], log.y[b] - log.y[a], log.z[b] - log.z[a]], len = Math.hypot(d[0], d[1], d[2]);
            // (A hole of one row: taken to be upright)
            out.set(len > 0 ? [d[0] / len, d[1] / len, d[2] / len] : [0, 0, -1], i * 3);
        });
    }
    return out;
}

/**
 * The logged intervals of a model's lithologies within `width` of a plane
 * (half either side), in pieces, with what the model has at the middle of
 * each (null: the model reads no lithologies, or nothing of them is logged
 * there). The logging as logged, nothing cleaned: what a model is checked
 * against.
 */
function piecesNear(model: GeoModel, result: ModelResult, plane: Plane, width: number): LoggedPieces | null {
    const scene = useModelStore.getState().scene;
    const map = scene.unitMaps?.find(m => m.id === model.unitMap);
    if (!map || !result.job || !result.out) return null;
    const data = useAppStore.getState().columnarData;
    if (!pieces || pieces.data !== data || pieces.coords !== scene.coords || pieces.map !== map) {
        const log = unitLog(scene.coords, map, true);
        if (!log) return null;
        pieces = { data, coords: scene.coords, map, log, samples: loggedSamples(log, PIECE, 400_000), along: log.placeAt ? null : holeDirections(log) };
    }
    const { log, samples, along } = pieces;
    const [nx, ny, nz] = plane.normal, [px, py, pz] = plane.point;
    const near: number[] = [];
    for (let i = 0; i * 3 < samples.xyz.length; i++) {
        const off = (samples.xyz[i * 3] - px) * nx + (samples.xyz[i * 3 + 1] - py) * ny + (samples.xyz[i * 3 + 2] - pz) * nz;
        if (Math.abs(off) <= width / 2) near.push(i);
    }
    if (near.length === 0) return null;
    const middles = new Float64Array(near.length * 3), ends = new Float64Array(near.length * 6);
    near.forEach((i, k) => {
        const m = [samples.xyz[i * 3], samples.xyz[i * 3 + 1], samples.xyz[i * 3 + 2]], row = samples.row[i];
        middles.set(m, k * 3);
        // (Logging with no path of its own: the interval about the place of its row, the way its hole runs there)
        const half = (samples.to[i] - samples.from[i]) / 2;
        const end = (sign: number): ArrayLike<number> => (along ? [m[0] + sign * half * along[row * 3], m[1] + sign * half * along[row * 3 + 1], m[2] + sign * half * along[row * 3 + 2]] : m);
        ends.set(log.placeAt?.(row, samples.from[i]) ?? end(-1), k * 6);
        ends.set(log.placeAt?.(row, samples.to[i]) ?? end(1), k * 6 + 3);
    });
    const at = labelsAtPoints(result.job, result.out.topSense, middles);
    return {
        ends,
        length: near.map(i => samples.length[i]),
        hole: near.map(i => String(log.hole[samples.row[i]] ?? '')),
        unit: near.map(i => String(log.code[samples.row[i]] ?? '')),
        modelled: Array.from(at.unit, u => (u === OUTSIDE ? null : result.units[u] ?? null)),
    };
}

/** The logging on a plane of a section set, as bars: each stretch in its lithology's colour, with what the model has there */
function loggedOn(model: GeoModel, result: ModelResult, set: SectionSet, index: number): SectionBar[] {
    const plane = sectionPlane(set, index);
    const near = piecesNear(model, result, plane, set.width);
    const scene = useModelStore.getState().scene;
    const colours = new Map((scene.unitMaps?.find(m => m.id === model.unitMap)?.units ?? []).map(u => [u.name, u.color] as const));
    return near ? barsOn(plane, planeAxes(set), set.width, near, unit => result.colors[result.units.indexOf(unit)] ?? colours.get(unit) ?? '#9e9e9e') : [];
}

/**
 * How much of the logging on one plane of a section set a built model has
 * as logged (null: nothing is logged within the set's width of it, or the
 * model is not built). Without drawing the section.
 */
export function sectionLogging(modelId: string, setId: string, index: number): SectionAgreement | null {
    const scene = useModelStore.getState().scene;
    const model = scene.models?.find(m => m.id === modelId), set = scene.sectionSets?.find(s => s.id === setId);
    const result = useGeoModelCache.getState().byId[modelId];
    return model && set && result?.out ? sectionAgreement(loggedOn(model, result, set, index)) : null;
}

/** A built model on one plane of a section set (null: either is gone, the model is not built, or the plane misses it) */
export function modelSection(modelId: string, setId: string, index: number): SectionCut | null {
    const set = useModelStore.getState().scene.sectionSets?.find(s => s.id === setId);
    return set ? modelSectionOn(modelId, set, index) : null;
}

/** The same on a plane of any set of sections, one of the scene's or not (a gate cuts its model where it chooses) */
export function modelSectionOn(modelId: string, set: SectionSet, index: number): SectionCut | null {
    const scene = useModelStore.getState().scene;
    const model = scene.models?.find(m => m.id === modelId);
    const result = useGeoModelCache.getState().byId[modelId];
    if (!model || !set || !result?.out) return null;
    const names = result.faults.map(id => {
        const fault = model.faults?.find(x => x.id === id);
        return scene.surfaces.find(s => s.id === fault?.surface)?.name ?? scene.wireframes.find(w => w.id === fault?.mesh)?.name ?? 'Fault';
    });
    const cut = cutModel(result, set, index, names, holeRows());
    if (cut) {
        cut.logged = loggedOn(model, result, set, index);
        cut.marks = marksOn(model, set, index);
    }
    return cut;
}

/** The places the surfaces of a model's contacts are held on one side of by hand, within the width of a section */
function marksOn(model: GeoModel, set: SectionSet, index: number): SectionMark[] {
    const scene = useModelStore.getState().scene;
    const plane = sectionPlane(set, index), axes = planeAxes(set);
    const [nx, ny, nz] = plane.normal, [px, py, pz] = plane.point;
    const out: SectionMark[] = [];
    for (const contact of model.contacts) {
        const surface = scene.surfaces.find(s => s.id === contact.surface);
        if (!surface || (surface.rule.kind !== 'contact' && surface.rule.kind !== 'body')) continue;
        // On an intrusion a place held by a distance is a lens: drawn as its outline on the section
        const lenses = surface.rule.kind === 'body' && !surface.rule.vein;
        const across = lenses ? lensPlane(useModelCache.getState().byId[surface.id]?.field) : null;
        for (const m of surface.rule.control?.marks ?? []) {
            // (A link: where any of it is within the width)
            const off = (p: ArrayLike<number>) => (p[0] - px) * nx + (p[1] - py) * ny + (p[2] - pz) * nz;
            const da = off(m.p), db = m.to ? off(m.to) : da;
            if (Math.min(da, db) > set.width / 2 || Math.max(da, db) < -set.width / 2) continue;
            const says = surface.rule.kind === 'body' ? `${m.side > 0 ? 'inside' : 'outside'} ${contact.unit}` : `${m.side > 0 ? 'the first' : 'the second'} side of ${surface.name}`;
            const ring = lenses && m.by ? lensOutline(m.by, across ? lensTimes(m, across.times) : 1, across?.normal ?? null, axes.u, axes.v) : null;
            out.push({ surface: surface.name, uv: [axes.uAt(m.p), axes.vAt(m.p)], side: m.side, ...(m.by ? { by: m.by } : {}), ...(ring ? { ring } : {}), ...(m.to ? { to: [axes.uAt(m.to), axes.vAt(m.to)] as [number, number] } : {}), says });
        }
    }
    return out;
}

/** The planes of a set that pass through a model's box, with what each is called */
export function sectionChoices(modelId: string, setId: string): { index: number; label: string }[] {
    const set = useModelStore.getState().scene.sectionSets?.find(s => s.id === setId);
    const box = useGeoModelCache.getState().byId[modelId]?.box;
    if (!set || !box) return [];
    const [first, last] = sectionRange(set, box);
    const out: { index: number; label: string }[] = [];
    for (let i = first; i <= last && out.length < 500; i++) out.push({ index: i, label: sectionLabel(set, i) });
    return out;
}

const titleOf = (modelId: string, cut: SectionCut) => `${useModelStore.getState().scene.models?.find(m => m.id === modelId)?.name ?? 'Model'}: ${cut.label}`;

/** An SVG picture as a PNG (a data URL), `scale` times its size. Null where it cannot be drawn (no canvas). */
export function svgToPng(svg: string, scale = 2): Promise<string | null> {
    return new Promise(resolve => {
        // A picture that never loads must not leave the button waiting for ever
        setTimeout(() => resolve(null), 20_000);
        try {
            const image = new Image();
            image.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = image.width * scale;
                    canvas.height = image.height * scale;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) { resolve(null); return; }
                    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL('image/png'));
                } catch { resolve(null); }
            };
            image.onerror = () => resolve(null);
            image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        } catch { resolve(null); }
    });
}

/** What a section shows, in lines for the report */
export function sectionContext(cut: SectionCut, width: number): string[] {
    const total = cut.units.filter(u => !u.thin).reduce((s, u) => s + u.area, 0);
    const told = sectionAgreement(cut.logged ?? []);
    return [
        `Units on the section, by area: ${cut.units.filter(u => !u.thin && u.area > 0).sort((a, b) => b.area - a.area).map(u => `${u.unit} ${Math.round(100 * u.area / Math.max(total, 1e-9))}%`).join(', ')}.`,
        ...(cut.faults.length ? [`Faults: ${cut.faults.map(f => f.name).join(', ')}.`] : []),
        ...(cut.holes.length ? [`${cut.holes.length.toLocaleString()} ${cut.holes.length === 1 ? 'drillhole' : 'drillholes'} within ${width / 2} m either side of it.`] : []),
        ...(told ? [...agreementText(told), `Each logged stretch is drawn on its hole in its lithology's colour, with a wider bright edge where the model has another unit at the place it is in the ground (up to ${width / 2} m off the section, so not always the unit drawn behind it).`] : []),
        cut.step
            ? `Drawn true to scale. The contacts are where the model's surfaces put them, read every ${Math.round(cut.step * 10) / 10} m where units meet.`
            : 'Drawn true to scale from the model\'s own solids.',
    ];
}

/** One section into the report as a figure. False: there was nothing to draw, or it could not be drawn. */
export async function sectionToReport(modelId: string, setId: string, index: number, render: (svg: string) => Promise<string | null> = svgToPng): Promise<boolean> {
    const cut = modelSection(modelId, setId, index);
    const set = useModelStore.getState().scene.sectionSets?.find(s => s.id === setId);
    if (!cut || !set) return false;
    const png = await render(sectionSvg(cut, { title: titleOf(modelId, cut) }));
    if (!png) return false;
    useReportStore.getState().addFigure({ title: titleOf(modelId, cut), caption: '', images: [png], context: sectionContext(cut, set.width) });
    return true;
}

/** Every section of a set that cuts the model, into the report, in order. Returns how many went in. */
export async function setToReport(modelId: string, setId: string, onStep?: (done: number, of: number) => void, render: (svg: string) => Promise<string | null> = svgToPng): Promise<number> {
    const all = sectionChoices(modelId, setId);
    let made = 0;
    for (let k = 0; k < all.length; k++) {
        if (await sectionToReport(modelId, setId, all[k].index, render)) made++;
        onStep?.(k + 1, all.length);
    }
    return made;
}

/** A section saved as a picture (.svg) or as linework where it is in the ground (.dxf). False: nothing to save. */
export function downloadSection(modelId: string, setId: string, index: number, format: 'svg' | 'dxf'): boolean {
    const cut = modelSection(modelId, setId, index);
    if (!cut) return false;
    const name = safeFileName(titleOf(modelId, cut), 'section');
    if (format === 'svg') downloadText(sectionSvg(cut, { title: titleOf(modelId, cut) }), `${name}.svg`, 'image/svg+xml');
    else downloadText(sectionDxf(cut), `${name}.dxf`, 'application/dxf');
    return true;
}
