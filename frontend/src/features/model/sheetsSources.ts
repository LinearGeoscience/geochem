/**
 * The bodies and veins of a project that say which plane their sheets lie
 * in (Phase 283): an intrusion of thin sheets, a vein, a vein system (once,
 * under its own name). What a numeric model can be laid along, and (Phase
 * 305) which of them a new one is laid along unless another is chosen.
 */
import { contactInputsFor } from './modelCache';
import { lieOf, type Lie } from './numericPlane';
import type { ModelScene } from './types';

export interface SheetsSource {
    /** The surface the plane is read from (a vein system: its first vein with one) */
    id: string;
    name: string;
    lie: Lie;
    /** Where its plane is from: given, the structural data it follows, how its logging carries between holes, or the plane its stretches lie closest to */
    from: 'given' | 'data' | 'carry' | 'cloud';
}

/** Where a source's plane is from, in words */
export function sourceText(from: SheetsSource['from']): string {
    return from === 'given' ? 'the plane it was given'
        : from === 'data' ? 'from the structural data it follows'
            : from === 'carry' ? 'from how its logging carries from hole to hole'
                : 'the plane its stretches lie closest to';
}

/** The bodies and veins with a plane of their sheets (`not`: surfaces passed over, a model's own shells) */
export function sheetsSources(scene: ModelScene, not: ReadonlySet<string> = new Set()): SheetsSource[] {
    const system = new Map<string, { id: string; name: string }>();
    for (const s of scene.veinSystems ?? []) for (const v of s.veins) system.set(v, s);
    const seen = new Set<string>(), out: SheetsSource[] = [];
    for (const s of scene.surfaces) {
        if (s.rule.kind !== 'body' || not.has(s.id)) continue;
        const of = system.get(s.id);
        if (of && seen.has(of.id)) continue;
        const found = contactInputsFor(s);
        if (!found?.joinPlane) continue;
        if (of) seen.add(of.id);
        out.push({ id: s.id, name: of ? of.name : s.name, lie: lieOf(found.joinPlane), from: found.joinPlaneFrom ?? 'cloud' });
    }
    return out;
}

/** The values of a column at or above the share of them this high count as its highs when sources are compared */
export const HIGH_SHARE = 0.1;
/** Sources are compared on at most this many of the samples, spread through them in order */
export const COMPARED_SAMPLES = 20_000;

/**
 * The source a new numeric model of these samples is laid along unless
 * another is chosen (Phase 305: on the real project, shells along the sheets
 * of the dykes the gold sits in lie in and along those dykes, and on holes
 * left out find as much as shells with no plane). Where there are several,
 * the one whose solid the highest values sit in most: of the samples inside
 * it, the share in the top tenth of the column, against that share of all
 * of them. `inside`: for a source, whether each place is inside its solid
 * (null: it is not fitted yet). The first source when none can be read, or
 * no highs are inside any. Null with no source.
 */
export function defaultSheets(
    sources: readonly SheetsSource[],
    samples: { x: ArrayLike<number>; y: ArrayLike<number>; z: ArrayLike<number>; value: ArrayLike<number> } | null,
    inside: (id: string, positions: Float64Array) => ArrayLike<number> | null,
): SheetsSource | null {
    if (sources.length === 0) return null;
    if (sources.length === 1 || !samples) return sources[0];
    const n = samples.value.length, step = Math.max(1, Math.ceil(n / COMPARED_SAMPLES));
    const pos: number[] = [], val: number[] = [];
    for (let i = 0; i < n; i += step) {
        const x = samples.x[i], y = samples.y[i], z = samples.z[i], v = samples.value[i];
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(v)) continue;
        pos.push(x, y, z); val.push(v);
    }
    if (val.length === 0) return sources[0];
    const sorted = val.slice().sort((a, b) => a - b);
    const high = sorted[Math.min(sorted.length - 1, Math.floor((1 - HIGH_SHARE) * sorted.length))];
    const highs = val.filter(v => v >= high).length;
    const positions = Float64Array.from(pos);
    let best: SheetsSource | null = null, most = 0;
    for (const s of sources) {
        const flags = inside(s.id, positions);
        if (!flags) continue;
        let within = 0, highWithin = 0;
        for (let k = 0; k < val.length; k++) if (flags[k] > 0) { within++; if (val[k] >= high) highWithin++; }
        const rich = within > 0 && highWithin > 0 ? (highWithin / within) / (highs / val.length) : 0;
        if (rich > most) { most = rich; best = s; }
    }
    return best ?? sources[0];
}
