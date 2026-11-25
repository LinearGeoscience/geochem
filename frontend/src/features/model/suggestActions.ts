/**
 * Readings suggested from what is in the scene (store glue for suggest.ts):
 * worked out on asking, drawn as ghosts, and added to the model only when
 * kept. A kept set is not followed until it is ticked.
 */
import { useModelStore } from '../../store/modelStore';
import { findIntercepts, flaggedSamples, INTERCEPT_LEVEL, interceptChoice } from './intercepts';
import { shellSamples } from './logging';
import { shellInputsFor, useModelCache } from './modelCache';
import { prepareSamples } from './shell';
import type { NewReadingSet } from './structureReadings';
import { MAX_SETS } from './structureReadings';
import { flatnessText, readingsFromHighs, readingsFromMesh, type Suggestion } from './suggest';
import { useWireframeFiles } from './wireframeFiles';

export type SuggestSource = { kind: 'surface'; id: string } | { kind: 'wireframe'; id: string };

export interface SourceChoice {
    /** Tells one from another in a list */
    key: string;
    source: SuggestSource;
    /** "The faces of Hanging wall" / "Where Au ≥ 1 is high" */
    label: string;
}

/** What readings can be suggested from, as the scene is now: its fitted surfaces, its shells' columns, its wireframes. */
export function suggestSources(): SourceChoice[] {
    const { scene } = useModelStore.getState();
    if (!scene.coords) return [];
    const fits = useModelCache.getState().byId, files = useWireframeFiles.getState().byFile;
    const out: SourceChoice[] = [];
    for (const s of scene.surfaces) {
        // (A proportion's pieces are not samples to read planes from: its shell gives its faces, as any surface does)
        if (s.rule.kind === 'shell' && !s.rule.of) out.push({ key: `surface:${s.id}`, source: { kind: 'surface', id: s.id }, label: `Where ${s.name} is high` });
        else if ((fits[s.id]?.part?.triangles.length ?? 0) > 0) out.push({ key: `surface:${s.id}`, source: { kind: 'surface', id: s.id }, label: `The faces of ${s.name}` });
    }
    for (const w of scene.wireframes) {
        if ((files[w.file]?.parts[w.part]?.triangles.length ?? 0) > 0) out.push({ key: `wireframe:${w.id}`, source: { kind: 'wireframe', id: w.id }, label: `The faces of ${w.name}` });
    }
    return out;
}

export type Suggested =
    | { ok: true; planes: number; lines: number }
    /** gone: the source is no longer there; holes: a shell's column without hole and depth columns; nothing: it has no shape to read */
    | { ok: false; reason: 'gone' | 'holes' | 'nothing' };

/** From where a column is high, fewer readings than this of a kind are not offered: one or two could be chance */
const LEAST_OFFERED = 3;

/** The usual distance between holes where a shell's highs are, from how far it may reach there */
function holeSpacing(reach: ArrayLike<number>, factor: number): number {
    const some: number[] = [];
    for (let i = 0; i < reach.length; i++) if (reach[i] > 0) some.push(reach[i]);
    some.sort((a, b) => a - b);
    return some.length > 0 && factor > 0 ? some[some.length >> 1] / factor : 0;
}

/**
 * Work out readings from a source and offer them (the ones offered before
 * are dropped). Nothing in the model changes.
 */
export function suggestFrom(source: SuggestSource): Suggested {
    const model = useModelStore.getState();
    const { scene } = model;
    const sets: NewReadingSet[] = [];
    let from = '', note: string | null = null;
    if (source.kind === 'wireframe') {
        const w = scene.wireframes.find(x => x.id === source.id);
        const part = w ? useWireframeFiles.getState().byFile[w.file]?.parts[w.part] : null;
        if (!w || !part) return { ok: false, reason: 'gone' };
        from = w.name;
        sets.push({ name: `Planes off ${w.name}`, kind: 'plane', source: 'suggested', follow: false, readings: readingsFromMesh(part.vertices, part.triangles) });
    } else {
        const surface = scene.surfaces.find(s => s.id === source.id);
        if (!surface) return { ok: false, reason: 'gone' };
        from = surface.name;
        if (surface.rule.kind !== 'shell' || surface.rule.of) {
            const part = useModelCache.getState().byId[surface.id]?.part;
            if (!part) return { ok: false, reason: 'gone' };
            sets.push({ name: `Planes off ${surface.name}`, kind: 'plane', source: 'suggested', follow: false, readings: readingsFromMesh(part.vertices, part.triangles) });
        } else {
            let rule = surface.rule;
            let samples = shellSamples(scene.coords, rule.column);
            const inputs = shellInputsFor(surface);
            if (!samples || !inputs) return { ok: false, reason: 'gone' };
            if (!samples.hole) return { ok: false, reason: 'holes' };
            // Built from intercepts: a place is high when it is in one
            if (rule.method === 'intercepts') {
                const found = findIntercepts(samples, interceptChoice(rule));
                if (!found) return { ok: false, reason: 'holes' };
                samples = flaggedSamples(samples, found);
                rule = { ...rule, cutoff: INTERCEPT_LEVEL, composite: null, topCut: null };
            }
            const prepared = prepareSamples(samples);
            if (prepared.holes === 0) return { ok: false, reason: 'holes' };
            const places = prepared.places(rule.composite != null && rule.composite > 0 ? rule.composite : null, rule.topCut != null && Number.isFinite(rule.topCut) ? rule.topCut : null);
            const cutoff = rule.cutoff;
            const found = readingsFromHighs({ positions: places.pos, hole: places.hole, high: places.v.map(v => v >= cutoff), spacing: holeSpacing(inputs.reach, inputs.reachFactor) });
            if (found.planes.length >= LEAST_OFFERED) {
                sets.push({ name: `Planes where ${surface.name} is high`, kind: 'plane', source: 'suggested', follow: false, readings: found.planes.map(r => ({ p: r.p, dip: r.dip, direction: r.direction })) });
                note = flatnessText(found.planes);
            }
            if (found.lines.length >= LEAST_OFFERED) sets.push({ name: `Lines where ${surface.name} is high`, kind: 'line', source: 'suggested', follow: false, readings: found.lines });
        }
    }
    const some = sets.filter(s => s.readings.length > 0);
    if (some.length === 0) {
        model.setSuggestion(null);
        return { ok: false, reason: 'nothing' };
    }
    const suggestion: Suggestion = { from, sets: some, note };
    model.setSuggestion(suggestion);
    return { ok: true, planes: some.filter(s => s.kind === 'plane').reduce((n, s) => n + s.readings.length, 0), lines: some.filter(s => s.kind === 'line').reduce((n, s) => n + s.readings.length, 0) };
}

/**
 * Keep one of the sets on offer: it joins the model's readings, not
 * followed until it is ticked. Returns its id, or null when it cannot be
 * kept (it is no longer on offer, or the model has as many sets as it can hold).
 */
export function keepSuggested(index: number): string | null {
    const model = useModelStore.getState();
    const offered = model.suggestion?.sets[index];
    if (!offered || (model.scene.structure?.sets?.length ?? 0) >= MAX_SETS) return null;
    const [id] = model.addReadingSets([{ ...offered, follow: false }]);
    if (!id) return null;
    discardSuggested(index);
    return id;
}

/** Throw away one of the sets on offer, or (no index) all of them. */
export function discardSuggested(index?: number): void {
    const model = useModelStore.getState();
    if (!model.suggestion) return;
    const left = index === undefined ? [] : model.suggestion.sets.filter((_, i) => i !== index);
    model.setSuggestion(left.length > 0 ? { ...model.suggestion, sets: left } : null);
}
