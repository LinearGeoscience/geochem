/**
 * The bodies and veins of a project that say which plane their sheets lie
 * in (Phase 283): an intrusion of thin sheets, a vein, a vein system (once,
 * under its own name). What a numeric model can be laid along.
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
