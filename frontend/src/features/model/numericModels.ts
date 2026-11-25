/**
 * Numeric models (Phase 232): a column of numbers modelled at several
 * cut-offs at once. A numeric model is a container, as a geological model
 * is: it holds how its shells are found (the column, the method, how the
 * samples are prepared) and one grade shell for each cut-off. The shells are
 * surfaces like any other (fitted, kept, shown and exported as they are);
 * the model owns them and keeps them in step: a setting is changed once, for
 * all of them, and a cut-off added or taken away makes or removes its shell.
 *
 * Pure: the scene is changed by the store (modelStore `addNumericModel`,
 * `updateNumericModel`, `removeNumericModel`).
 */
import { meshReader } from './meshField';
import { SHARE_LOCAL, SHARE_STRENGTH, sharePercent } from './proportion';
import { domainUnits, isSolids, listText, readShellDomain } from './shellDomains';
import type { ModelScene, NumericModel, ShellRule, SolidsDomain, SurfaceObject } from './types';

/** How every shell of a numeric model is found: a grade shell's rule but for its cut-off */
export type NumericRule = Omit<ShellRule, 'cutoff'>;

export const MAX_NUMERIC_MODELS = 20;
export const MAX_CUTOFFS = 8;

/** Cut-offs as they are kept: numbers, each once, the lowest first, no more than a model can have */
export function cleanCutoffs(raw: readonly unknown[]): number[] {
    const out: number[] = [];
    for (const v of raw) if (typeof v === 'number' && Number.isFinite(v) && !out.includes(v)) out.push(v);
    return out.sort((a, b) => a - b).slice(0, MAX_CUTOFFS);
}

/** Cut-offs typed in a box, "0.5, 1 2" (commas, semicolons or spaces between them): null when a piece is not a number */
export function parseCutoffs(text: string): number[] | null {
    const pieces = text.split(/[\s,;]+/).filter(Boolean);
    const values = pieces.map(Number);
    return pieces.length > 0 && values.every(Number.isFinite) ? cleanCutoffs(values) : null;
}

export const formatCutoffs = (cutoffs: readonly number[]): string => cutoffs.join(', ');

/** A shell's name from its column and cut-off: "Au ≥ 0.5"; of a proportion (`share`), "FGRA share ≥ 10%" (as sceneActions `shellName`) */
export const shellLabel = (column: string, cutoff: number, share = false): string => `${column} ≥ ${share ? sharePercent(cutoff) : cutoff}`;

/** A cut-off as it is said: the number, or for a proportion the share as a percentage */
export const cutoffText = (rule: Pick<ShellRule, 'of'>, cutoff: number): string => (rule.of ? sharePercent(cutoff) : String(cutoff));

/** The rule of the shell of a model at a cut-off */
export const shellRuleAt = (rule: NumericRule, cutoff: number): ShellRule => ({ ...rule, kind: 'shell', cutoff });

/** A shell's rule without its cut-off: what a numeric model keeps */
export function numericRule(rule: ShellRule): NumericRule {
    const { cutoff: _cutoff, ...rest } = rule;
    return rest;
}

const RAMP = ['#ffe082', '#ffca28', '#ffa000', '#f57c00', '#e64a19', '#d32f2f', '#b71c1c', '#6a1b1b'];

/** Colours for the shells of a model, the lowest cut-off first: pale to dark, spread over the ramp */
export function shellRamp(n: number): string[] {
    if (n <= 1) return n === 1 ? [RAMP[3]] : [];
    return Array.from({ length: n }, (_, i) => RAMP[Math.round((i * (RAMP.length - 1)) / (n - 1))]);
}

/**
 * How solid each shell is drawn, the lowest cut-off first: the innermost
 * nearly solid, and every one outside it faint enough that the ones inside
 * show through however many there are
 */
export function shellOpacities(n: number): number[] {
    return Array.from({ length: n }, (_, i) => (n <= 1 ? 0.7 : i === n - 1 ? 0.9 : Number((0.18 + (0.17 * i) / Math.max(1, n - 2)).toFixed(2))));
}

type Scene = Pick<ModelScene, 'numericModels'>;

/** The numeric model each owned shell belongs to, by the shell's surface id */
export function shellOwners(scene: Scene): Map<string, NumericModel> {
    const out = new Map<string, NumericModel>();
    for (const m of scene.numericModels ?? []) for (const s of m.shells) if (!out.has(s.surface)) out.set(s.surface, m);
    return out;
}

/** The numeric model that owns a surface (null: none does) */
export function numericHome(scene: Scene, surfaceId: string): NumericModel | null {
    for (const m of scene.numericModels ?? []) if (m.shells.some(s => s.surface === surfaceId)) return m;
    return null;
}

/** A name for a new numeric model: its column, with (2), (3) ... when that is taken */
export function freeNumericName(wanted: string, models: readonly Pick<NumericModel, 'id' | 'name'>[], but?: string): string {
    const base = wanted.trim() || 'Numeric model';
    let name = base;
    for (let k = 2; models.some(m => m.id !== but && m.name === name); k++) name = `${base} (${k})`;
    return name;
}

/**
 * Numeric models read from a file, as they can be used. A shell is kept when
 * its surface is in the scene, is a grade shell, and is no earlier model's;
 * its cut-off is the one its surface has (the surface is what is fitted). A
 * model is kept even with no shells left: its settings are still its own.
 * `readRule`: the store's reader of a surface's rule.
 */
export function readNumericModels(raw: unknown, surfaces: readonly SurfaceObject[], readRule: (rule: unknown) => SurfaceObject['rule']): NumericModel[] {
    if (!Array.isArray(raw)) return [];
    const out: NumericModel[] = [];
    const taken = new Set<string>();
    for (const r of raw as Partial<NumericModel>[]) {
        if (out.length >= MAX_NUMERIC_MODELS) break;
        if (!r || typeof r.id !== 'string' || !r.id || out.some(m => m.id === r.id)) continue;
        // (At a cut-off above zero: at zero, logarithms would be struck out of what the model keeps)
        const rule = readRule({ ...(r.rule ?? {}), kind: 'shell', cutoff: (r.rule as { of?: unknown } | undefined)?.of !== undefined ? 0.5 : 1 });
        if (rule.kind !== 'shell' || !rule.column) continue;
        const shells: NumericModel['shells'] = [];
        for (const s of Array.isArray(r.shells) ? r.shells : []) {
            const surface = surfaces.find(x => x.id === s?.surface);
            if (!surface || surface.rule.kind !== 'shell' || taken.has(surface.id) || shells.some(x => x.cutoff === (surface.rule as ShellRule).cutoff)) continue;
            taken.add(surface.id);
            shells.push({ cutoff: surface.rule.cutoff, surface: surface.id });
        }
        shells.sort((a, b) => a.cutoff - b.cutoff);
        const domain = readShellDomain(r.domain);
        out.push({ id: r.id, name: freeNumericName(typeof r.name === 'string' ? r.name : rule.column, out), rule: numericRule(rule), shells: shells.slice(0, MAX_CUTOFFS), ...(domain ? { domain } : {}) });
    }
    return out;
}

const metres = (v: number) => `${Number(v.toPrecision(2))} m`;

/** How a numeric model's shells are found, in a sentence */
export function foundText(rule: NumericRule): string {
    if (rule.of) {
        const of = rule.of, strength = of.strength ?? SHARE_STRENGTH;
        return `Found from the logging in ${of.column}: pieces of ${metres(of.length)} down each hole, each counted as the share of it that is ${listText(of.inside)}, about ${rule.local ?? SHARE_LOCAL} taken together each way${strength > 1 ? `; carried ${strength} times further along the plane of its sheets than across them` : ''}.`;
    }
    const how = rule.method === 'indicator' ? `by counting the samples at or above each cut-off (where ${Math.round(100 * (rule.share ?? 0.5))}% of those round about are)`
        : rule.method === 'intercepts' ? `round the intercepts down each hole${rule.minLength !== undefined ? ` (runs of at least ${metres(rule.minLength)})` : ''}`
            : `from the values${rule.log ? ', as logarithms' : ''}`;
    const prepared = [
        rule.composite !== null && rule.method !== 'intercepts' ? `averaged down each hole over ${metres(rule.composite)}` : '',
        rule.topCut !== null ? `top cut at ${rule.topCut}` : '',
    ].filter(Boolean);
    return `Found ${how}${prepared.length ? `; the samples ${prepared.join(' and ')}` : ''}.`;
}

/** What a table of numeric models' volumes holds: a row a model, a column a cut-off */
export interface VolumeTable {
    cutoffs: number[];
    rows: {
        id: string; name: string; column: string; where: string; volumes: (number | null)[];
        /**
         * A proportion: its units; how much of them the ground inside each shell holds (its volume times the mean
         * share inside it; null as `volumes`); and how much there is in all, with the ground outside its lowest shell
         * as far as the logging reaches (null: that shell is not fitted)
         */
        share?: { units: string; inside: (number | null)[]; all: number | null };
    }[];
}

/** What a proportion's shell says of the shares in and round it (surfaceJobs `BodySummary.share`) */
export type ShareSaid = { inside: number | null; allOverInside: number | null };

/**
 * The volumes of numeric models side by side: every cut-off any of them has,
 * the lowest first, and for each model where it is kept and what its shell
 * at each cut-off holds (null: it has no shell there, or it is not fitted).
 * `volumeOf`: a shell's volume by its surface's id. `modelName`: a
 * geological model's name by its id.
 */
export function volumeTable(models: readonly NumericModel[], volumeOf: (surface: string) => number | null, modelName: (id: string) => string | null, shareOf: (surface: string) => ShareSaid | null = () => null, solidsName: (domain: SolidsDomain) => string = () => 'Solids'): VolumeTable {
    const cutoffs = [...new Set(models.flatMap(m => m.shells.map(s => s.cutoff)))].sort((a, b) => a - b);
    const of = (id: string) => modelName(id);
    /** How much of its units the ground inside a proportion's shell holds */
    const held = (surface: string): number | null => {
        const v = volumeOf(surface), s = shareOf(surface);
        return v !== null && s && s.inside !== null ? v * s.inside : v === 0 ? 0 : null;
    };
    const share = (m: NumericModel): VolumeTable['rows'][number]['share'] => {
        if (!m.rule.of) return undefined;
        const lowest = m.shells[0];
        const inLowest = lowest ? held(lowest.surface) : null, said = lowest ? shareOf(lowest.surface) : null;
        return {
            units: listText(m.rule.of.inside),
            inside: cutoffs.map(c => { const s = m.shells.find(x => x.cutoff === c); return s ? held(s.surface) : null; }),
            all: inLowest !== null && said && said.allOverInside !== null ? inLowest * said.allOverInside : null,
        };
    };
    return {
        cutoffs,
        rows: models.map(m => ({
            id: m.id, name: m.name, column: m.rule.column,
            where: !m.domain ? 'Everywhere' : isSolids(m.domain) ? solidsName(m.domain)
                : `${listText(domainUnits(m.domain))}${m.domain.sides?.length ? ', one fault block' : ''}${of(m.domain.model) ? ` of ${of(m.domain.model)}` : ''}`,
            volumes: cutoffs.map(c => { const s = m.shells.find(x => x.cutoff === c); return s ? volumeOf(s.surface) : null; }),
            ...(m.rule.of ? { share: share(m) } : {}),
        })),
    };
}

/** A mesh: xyz triples, and three vertex indices a triangle */
export interface ShellMesh { vertices: ArrayLike<number>; triangles: ArrayLike<number> }

/** No more of a shell's places than this are asked about */
const NEST_SAMPLES = 400;

/**
 * How much of a shell lies outside another that should hold it (the shell at
 * the next lower cut-off): the share of the places on its skin that are
 * outside the other by more than `slack` metres (two skins that run together,
 * where both stop at the edge of the data, are within it). 0: it is inside.
 * Null: it cannot be said (one of them has no mesh, or the other is open).
 */
export function shareOutside(inner: ShellMesh, outer: ShellMesh, slack: number): number | null {
    const all = Math.floor(inner.vertices.length / 3);
    if (all < 1 || outer.triangles.length === 0) return null;
    const reader = meshReader({ vertices: Float64Array.from(outer.vertices), triangles: Uint32Array.from(outer.triangles) });
    if (!reader.closed) return null;
    const step = Math.max(1, Math.floor(all / NEST_SAMPLES));
    const places: number[] = [];
    for (let i = 0; i < all; i += step) places.push(inner.vertices[i * 3], inner.vertices[i * 3 + 1], inner.vertices[i * 3 + 2]);
    const far = reader.read(places);
    let out = 0;
    for (let k = 0; k < far.length; k++) if (far[k] < -slack) out++;
    return out / far.length;
}
