/**
 * A geological model's rebuild kit: the whole model as the files of one
 * folder. For people and other packages: a note, its age order, its faults
 * and its units as tables, the rebuild kit of every surface in it, and its
 * unit solids as meshes. For this app: `model.json`, the model with all it
 * is built from, which reads back as the same model.
 */
import { readScene } from '../../store/modelStore';
import { formatMetres, formatVolume } from './describe';
import { faultCuts } from './blockParts';
import { faultStops, KIND_NAME, sideNames, stopProblem } from './geoModel';
import { savedScene, type SavedScene } from './inputs';
import { meshesToDxf, meshesToGocad, meshesToMsh, meshesToObj, type NamedMesh } from './meshWriters';
import { keys } from './objectKeys';
import { safeFileName, type KitFile, type SurfaceKit } from './rebuildKit';
import { sceneLinks } from './sceneLinks';
import type { Box3, FaultSide, GeoModel, ModelScene } from './types';

export const KIT_FORMAT = 'geochem-model-kit';

/**
 * The part of a scene a model is built from: the model, the surfaces in its
 * age order and its faults with the sets they use and whatever those depend
 * on in turn, its units, and a model it is inside. Sections, the structure
 * and the folders are kept whole (they are small, and surfaces lean on them).
 */
export function modelScene(scene: ModelScene, modelId: string): ModelScene {
    const links = sceneLinks(scene, null);
    const kept = new Set<string>([keys.model(modelId)]);
    for (let grew = true; grew;) {
        grew = false;
        for (const l of links) if (kept.has(l.from) && !kept.has(l.to)) { kept.add(l.to); grew = true; }
    }
    // (With the parts it has of its contacts in fault blocks: they are its own, and read back they are the same ones)
    const surfaces = scene.surfaces.filter(s => kept.has(keys.surface(s.id)) || (!!s.blockOf && s.within?.model === modelId && kept.has(keys.surface(s.blockOf))));
    const used = new Set(surfaces.flatMap(s => (s.uses ?? []).map(u => u.set)));
    return {
        ...scene,
        surfaces,
        inputs: (scene.inputs ?? []).filter(i => used.has(i.id) || kept.has(keys.inputs(i.id))),
        wireframes: scene.wireframes.filter(w => kept.has(keys.wireframe(w.id))),
        unitMaps: (scene.unitMaps ?? []).filter(m => kept.has(keys.unitMap(m.id))),
        models: (scene.models ?? []).filter(m => kept.has(keys.model(m.id))),
    };
}

export interface ModelKitInput {
    scene: ModelScene;
    model: GeoModel;
    /** As built: its units the oldest first, with their volumes (null: not built) */
    units: { name: string; color: string; volume: number | null }[];
    box: Box3 | null;
    /** How far from its drilling it is carried, m, where its boundary keeps it near its drilling (absent or null: it fills its box) */
    near?: number | null;
    cell: number | null;
    /** The rebuild kit of each surface in it, by the surface's id */
    surfaceKits: ReadonlyMap<string, SurfaceKit>;
    /** Its unit solids (none: not built) */
    solids: NamedMesh[];
    version?: string;
    date?: string;
}

export interface ModelKit {
    folder: string;
    files: KitFile[];
}

const csv = (rows: (string | number)[][]) => rows.map(r => r.map(c => { const t = String(c); return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; }).join(',')).join('\r\n') + '\r\n';

/** The files of a model's rebuild kit, each under the kit's folder */
export function modelKit(input: ModelKitInput): ModelKit {
    const { scene, model } = input;
    const folder = safeFileName(model.name, 'model');
    const files: KitFile[] = [];
    const add = (name: string, data: string | Uint8Array) => files.push({ path: `${folder}/${name}`, data });
    const nameOf = (x: { surface?: string; mesh?: string }) => scene.surfaces.find(s => s.id === x.surface)?.name ?? scene.wireframes.find(w => w.id === x.mesh)?.name ?? '(missing)';
    const faults = model.faults ?? [];
    const faultName = (id: string) => { const f = faults.find(x => x.id === id); return f ? nameOf(f) : '(missing)'; };
    /** How far past the places it is known at a fault runs before it stops, m (null: it runs through the model) */
    const stopsAt = (f: NonNullable<typeof model.faults>[number]): number | null => (f.extent && faultStops(model, f) && !stopProblem(scene, model, f) ? f.extent.reach : null);
    /** The younger faults that offset a fault, by name ('': none) */
    const cuts = faultCuts(scene, model);
    const offsetBy = (f: NonNullable<typeof model.faults>[number]): string => (cuts.find(c => c.fault.id === f.id)?.cutters ?? []).map(nameOf).join('; ');
    // A side of a surface by the name the model's lists give it ("east side", "COVER side", "inside")
    const sideName = (x: { surface?: string; mesh?: string } | undefined, side: number) => sideNames(scene.surfaces.find(s => s.id === x?.surface), !!x?.mesh)[side > 0 ? 0 : 1];
    const sides = (list: readonly FaultSide[] | undefined) => (list ?? []).map(e => `${faultName(e.fault)}: ${sideName(faults.find(f => f.id === e.fault), e.side)}`).join('; ');

    // --- the tables ---
    add('surface chronology.csv', csv([
        ['Order (1 = youngest)', 'Surface', 'Kind', 'Unit on its younger side', 'Younger side', 'In use', 'Only in the fault block'],
        ...model.contacts.map((c, i) => [i + 1, nameOf(c), KIND_NAME[c.kind], c.unit, sideName(c, c.young), c.off ? 'no' : 'yes', sides(c.within)]),
        [model.contacts.length + 1, '', 'the oldest ground', model.base, '', 'yes', ''],
    ]));
    if (faults.length > 0) {
        add('faults.csv', csv([
            ['Fault', 'It ends on', 'In use', 'It stops (m past where it is known)', 'It is offset by'],
            ...faults.map(f => [nameOf(f), sides(f.ends), f.off ? 'no' : 'yes', stopsAt(f) ?? '', offsetBy(f)]),
        ]));
    }
    add('units.csv', csv([
        ['Unit (oldest first)', 'Colour', 'Volume (m3)', 'Logged codes'],
        ...input.units.map(u => [u.name, u.color, u.volume === null ? '' : Math.round(u.volume), (scene.unitMaps?.find(m => m.id === model.unitMap)?.units.find(x => x.name === u.name)?.codes ?? []).join(' | ')]),
    ]));

    // --- its surfaces, each with its own kit ---
    const inModel = [...model.contacts, ...faults, ...(model.boundary.top ? [{ surface: model.boundary.top }] : [])];
    const folders: string[] = [];
    const done = new Set<string>();
    for (const x of inModel) {
        const kit = x.surface ? input.surfaceKits.get(x.surface) : undefined;
        if (!kit || done.has(x.surface!)) continue;
        done.add(x.surface!);
        for (const f of kit.files) files.push({ path: `${folder}/surfaces/${f.path}`, data: f.data });
        folders.push(kit.folder);
    }

    // --- its solids ---
    if (input.solids.length > 0) {
        add('solids/units.obj', meshesToObj(input.solids));
        add('solids/units.ts', meshesToGocad(input.solids));
        add('solids/units.dxf', meshesToDxf(input.solids));
        for (const s of input.solids) add(`solids/${safeFileName(s.name, 'unit')}.msh`, meshesToMsh([s]));
    }

    // --- the model itself, to read back ---
    const part = modelScene(scene, model.id);
    add('model.json', JSON.stringify({ format: KIT_FORMAT, version: 1, model: model.id, name: model.name, written: input.date ?? null, app: input.version ?? null, scene: savedScene(part) }));

    // --- the note ---
    const at = (v: readonly number[]) => v.map(x => (Math.round(x * 100) / 100).toLocaleString('en-US', { useGrouping: false })).join(', ');
    const parent = model.boundary.inside ? scene.models?.find(m => m.id === model.boundary.inside!.model) : null;
    const meshes = [...model.contacts, ...faults].filter(x => x.mesh).map(nameOf);
    const note = [
        `Leapfrog export: ${model.name} (a geological model)`,
        `Written by GeoChem${input.version ? ` ${input.version}` : ''}${input.date ? ` on ${input.date}` : ''}.`,
        scene.coords ? `Coordinates are the project's: ${scene.coords.x} (east), ${scene.coords.y} (north), ${scene.coords.z} (elevation).` : '',
        '',
        'Its chronology, the youngest first (surface chronology.csv)',
        ...model.contacts.map((c, i) => `  ${String(i + 1).padStart(2)}. ${nameOf(c)}: ${KIND_NAME[c.kind].toLowerCase()}; ${c.unit} is on its younger side${sideName(c, c.young) === c.unit ? '' : ` (${sideName(c, c.young)})`}${c.off ? ' (not in use)' : ''}${c.within?.length ? ` (only in the block ${sides(c.within)})` : ''}`),
        `  ${String(model.contacts.length + 1).padStart(2)}. ${model.base}: the oldest ground, under everything else`,
        '',
        ...(faults.length > 0 ? ['Its faults (faults.csv)', ...faults.map(f => `  ${nameOf(f)}${f.ends?.length ? `: ends on ${sides(f.ends)}` : stopsAt(f) === null ? ': runs through the whole model' : ''}${stopsAt(f) === null ? '' : `${f.ends?.length ? ', and' : ':'} stops ${stopsAt(f)} m past the places it is known at`}${offsetBy(f) ? `; offset by ${offsetBy(f)}, and fitted on each side of it apart` : ''}${f.off ? ' (not in use)' : ''}`), ''] : []),
        'Its units, the oldest first (units.csv)',
        ...input.units.map(u => `  ${u.name.padEnd(28)} ${u.volume === null ? 'not built' : formatVolume(u.volume)}`),
        '',
        'Boundary',
        ...(parent ? [`  Inside the unit ${model.boundary.inside!.unit} of the model ${parent.name} (which is in model.json too).`] : []),
        ...(input.box ? [`  Its box: ${at(input.box.min)} to ${at(input.box.max)}`] : []),
        ...(input.near ? [`  Only ground within ${formatMetres(input.near)} of the holes it reads is in it; gaps between holes narrower than that are filled.`] : []),
        ...(model.boundary.top ? [`  Its topography is the surface ${nameOf({ surface: model.boundary.top, mesh: model.boundary.top })}.`] : []),
        ...(model.boundary.outline ? ['  An outline drawn in a view bounds it.'] : []),
        `  Built with cells of ${input.cell === null ? 'a size worked out from its box' : formatMetres(input.cell)}.`,
        '',
        'What is in this kit',
        '  surface chronology.csv, units.csv' + (faults.length > 0 ? ', faults.csv' : ''),
        ...(folders.length > 0 ? [`  surfaces/: the Leapfrog export of each of its ${folders.length} surfaces (what it was built from, its mesh and a note): ${folders.join(', ')}`] : []),
        ...(meshes.length > 0 ? [`  Not in the kit: ${meshes.join(', ')} (meshes from files, which stay in the project folder).`] : []),
        ...(input.solids.length > 0 ? ['  solids/: each unit as a closed mesh: units.obj, units.ts (GOCAD), units.dxf (3D faces), and one .msh (Leapfrog) per unit'] : ['  No solids: the model was not built when this was written.']),
        '  model.json: the model and all it is built from, for GeoChem to read back (Open a Leapfrog export).',
        '',
        'To build it again in Leapfrog',
        '  1. Build each surface from its folder under surfaces/ (each has its own steps), or import its mesh.msh as it is.',
        `  2. Make a geological model with the box above${faults.length > 0 ? '.' : ', and add the surfaces to its surface chronology in the'}`,
        ...(faults.length > 0 ? [
            `  3. Add the faults of faults.csv to its fault system${faults.some(f => f.ends?.length) ? ', each ending on the faults listed there' : ''}.`,
            ...(faults.some(f => stopsAt(f) !== null) ? ['     (A fault that stops here may have to run through the model there, or end on another fault.)'] : []),
            ...(cuts.length > 0 ? ['     (A fault that a younger fault offsets here is two faults there: one on each side of the younger fault, each ending on it.)'] : []),
            '  4. Add the other surfaces to the surface chronology of every fault block, in the',
        ] : []),
        '     order of surface chronology.csv: a deposit as a deposit, an erosion as an erosion, an intrusion as an intrusion,',
        '     with the unit named there on its younger side.',
        `  ${faults.length > 0 ? 5 : 3}. Import the meshes under solids/ to compare the two models unit by unit.`,
        '',
        'Reading it back in GeoChem gives the model as it was. Surfaces built from logging are fitted again from',
        'the logging of the project it is opened in: the same data gives the same model.',
        '',
    ].join('\r\n');
    files.unshift({ path: `${folder}/README.txt`, data: note });
    return { folder, files };
}

export interface KitRead {
    /** What the model is called, and when its kit was written */
    name: string;
    written: string | null;
    /** The model's id in `scene` */
    model: string;
    /** The model and all it is built from, as a scene */
    scene: ModelScene;
    saved: SavedScene;
}

/** A model's kit read back from its files (any of them may be missing but model.json). Null: this is not a model's kit. */
export function readModelKit(files: readonly KitFile[]): KitRead | null {
    const file = files.find(f => /(^|\/)model\.json$/i.test(f.path.replace(/\\/g, '/')));
    if (!file) return null;
    try {
        const text = typeof file.data === 'string' ? file.data : new TextDecoder().decode(file.data);
        const json = JSON.parse(text) as { format?: unknown; model?: unknown; name?: unknown; written?: unknown; scene?: unknown };
        if (json.format !== KIT_FORMAT || typeof json.model !== 'string') return null;
        const scene = readScene(json.scene);
        const model = scene.models?.find(m => m.id === json.model);
        if (!model) return null;
        return { name: model.name, written: typeof json.written === 'string' ? json.written : null, model: model.id, scene, saved: savedScene(scene) };
    } catch {
        return null;
    }
}
