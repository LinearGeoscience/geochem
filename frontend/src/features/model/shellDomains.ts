/**
 * Where a grade shell is kept (Phase 233): inside one or several lithologies
 * of a geological model and, apart from that or as well, one of its fault
 * blocks. Only the samples there are used, and the shell stops at the faces
 * of that ground. Pure: the fits read it through modelCache `domainFor`.
 */
import type { Domain, FaultSide, ModelScene, ShellDomain, SolidRef, SolidsDomain, SurfaceRule } from './types';

/**
 * What can be kept inside a unit of a model: a grade shell (only the samples
 * there are used, and it stops at the faces of that ground), and an
 * intrusion built as thin sheets (all its logging is used, and it stops at
 * those faces: a network body in the ground it is in).
 */
export const takesDomain = (rule: SurfaceRule): boolean => rule.kind === 'shell' || (rule.kind === 'body' && !rule.vein && !!rule.sheets);

/** The lithologies a domain takes in (one or several) */
export const domainUnits = (domain: Pick<ShellDomain, 'unit' | 'units'>): string[] => (domain.units && domain.units.length > 0 ? domain.units : [domain.unit]);

/** A domain of these lithologies of a model, and of a fault block when sides are given (null: no lithology) */
export function makeDomain(model: string, units: readonly string[], sides?: readonly FaultSide[]): ShellDomain | null {
    const all = [...new Set(units.filter(u => typeof u === 'string' && u !== ''))];
    if (!model || all.length === 0) return null;
    const block = (sides ?? []).filter(s => s && typeof s.fault === 'string' && s.fault !== '' && (s.side === 1 || s.side === -1))
        .filter((s, i, list) => list.findIndex(x => x.fault === s.fault) === i).map(s => ({ fault: s.fault, side: s.side }));
    return { model, unit: all[0], ...(all.length > 1 ? { units: all } : {}), ...(block.length > 0 ? { sides: block } : {}) };
}

/** At most this many solids make one ground */
export const MAX_SOLIDS = 100;

/** Whether a domain is the inside of solids (not ground of a geological model) */
export const isSolids = (domain: Domain | null | undefined): domain is SolidsDomain => !!domain && Array.isArray((domain as SolidsDomain).solids);

/** A domain as ground of a geological model (null: it is none, or it is the inside of solids) */
export const unitDomain = (domain: Domain | null | undefined): ShellDomain | null => (domain && !isSolids(domain) ? domain : null);

/** A domain that is the inside of these solids (null: none of them can be read) */
export function makeSolids(solids: readonly SolidRef[]): SolidsDomain | null {
    const all: SolidRef[] = [];
    for (const s of solids) {
        if (!s || typeof s.id !== 'string' || !s.id || (s.kind !== 'surface' && s.kind !== 'system' && s.kind !== 'mesh')) continue;
        if (all.length < MAX_SOLIDS && !all.some(x => x.kind === s.kind && x.id === s.id)) all.push({ kind: s.kind, id: s.id });
    }
    return all.length > 0 ? { solids: all } : null;
}

/**
 * The surfaces a domain of solids reads (by id, each once): its surfaces as
 * they are named, and every vein of its vein systems. Those that are no
 * longer in the scene are left out.
 */
export function solidSurfaces(domain: SolidsDomain, scene: Pick<ModelScene, 'surfaces' | 'veinSystems'>): string[] {
    const ids: string[] = [];
    for (const s of domain.solids) {
        const own = s.kind === 'surface' ? [s.id] : s.kind === 'system' ? scene.veinSystems?.find(v => v.id === s.id)?.veins ?? [] : [];
        for (const id of own) if (!ids.includes(id) && scene.surfaces.some(x => x.id === id)) ids.push(id);
    }
    return ids;
}

/** The wireframes a domain of solids reads (by id) */
export const solidMeshes = (domain: SolidsDomain): string[] => domain.solids.filter(s => s.kind === 'mesh').map(s => s.id);

/** A domain of solids in words: "Lode 1 and the veins of Main system" (a solid that is gone is left out; '' when all are) */
export function solidsText(domain: SolidsDomain, scene: Pick<ModelScene, 'surfaces' | 'veinSystems' | 'wireframes'>): string {
    return listText(domain.solids.flatMap(s => {
        const name = s.kind === 'surface' ? scene.surfaces.find(x => x.id === s.id)?.name : s.kind === 'system' ? scene.veinSystems?.find(x => x.id === s.id)?.name : scene.wireframes.find(x => x.id === s.id)?.name;
        return name ? [s.kind === 'system' ? `the veins of ${name}` : name] : [];
    }));
}

/** A solid of the scene that something can be kept inside, as a list offers it */
export interface SolidChoice { ref: SolidRef; name: string; what: 'vein system' | 'vein' | 'intrusion' | 'shell' | 'mesh from a file' }

/**
 * The solids of a scene a shell could be kept inside: its vein systems, its
 * veins (those of no system: a system's are had through it), intrusions and
 * shells, and its wireframes. `but`: surfaces that are not offered (the
 * shell itself, the other shells of its numeric model).
 */
export function solidChoices(scene: Pick<ModelScene, 'surfaces' | 'veinSystems' | 'wireframes'>, but: readonly string[] = []): SolidChoice[] {
    const inSystem = new Set((scene.veinSystems ?? []).flatMap(v => v.veins));
    return [
        ...(scene.veinSystems ?? []).filter(v => v.veins.length > 0).map(v => ({ ref: { kind: 'system' as const, id: v.id }, name: v.name, what: 'vein system' as const })),
        ...scene.surfaces.filter(s => !but.includes(s.id) && !inSystem.has(s.id) && (s.rule.kind === 'body' || s.rule.kind === 'shell'))
            .map(s => ({ ref: { kind: 'surface' as const, id: s.id }, name: s.name, what: s.rule.kind === 'shell' ? 'shell' as const : s.rule.kind === 'body' && s.rule.vein ? 'vein' as const : 'intrusion' as const })),
        ...scene.wireframes.map(w => ({ ref: { kind: 'mesh' as const, id: w.id }, name: w.name, what: 'mesh from a file' as const })),
    ];
}

/** Why a solid is not ground just now, in a sentence (null: it is, or it is still being worked out) */
export function solidStateNote(name: string, state: 'closed' | 'open' | 'empty' | 'waiting' | 'loop'): string | null {
    if (state === 'open') return `${name} is not closed (an edge of it is open), so it has no inside: it is left out.`;
    if (state === 'empty') return `${name} has nothing drawn: it is left out.`;
    if (state === 'loop') return `${name} is itself kept inside this: it is left out.`;
    return null;
}

/** What a domain names, in words: its lithologies (", in one fault block" when it names one), or its solids */
export function groundText(domain: Domain, scene: Pick<ModelScene, 'surfaces' | 'veinSystems' | 'wireframes'>): string {
    if (isSolids(domain)) return solidsText(domain, scene) || 'solids that are no longer in the project';
    return `${listText(domainUnits(domain))}${domain.sides?.length ? ', in one fault block' : ''}`;
}

/** A domain read from a file, as it can be used (null: none, or it cannot be read) */
export function readShellDomain(raw: unknown): Domain | null {
    const d = raw as { model?: unknown; unit?: unknown; units?: unknown; sides?: unknown; solids?: unknown } | null | undefined;
    if (d && Array.isArray(d.solids)) return makeSolids(d.solids as SolidRef[]);
    if (!d || typeof d.model !== 'string' || !d.model) return null;
    const units = [typeof d.unit === 'string' ? d.unit : '', ...(Array.isArray(d.units) ? d.units.filter((u): u is string => typeof u === 'string') : [])];
    return makeDomain(d.model, units, Array.isArray(d.sides) ? d.sides as FaultSide[] : undefined);
}

export const sameDomain = (a: Domain | null | undefined, b: Domain | null | undefined): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The fault blocks of a built model that are on these sides of its faults
 * (by number: their place in `blocks`). `faults`: the build's faults by id,
 * in the order of each block's sides. Null: every block (no sides are asked
 * for, or none of them is of a fault the model is cut by now).
 */
export function blocksOn(sides: readonly FaultSide[] | undefined, faults: readonly string[], blocks: readonly (readonly number[])[]): number[] | null {
    const asked = (sides ?? []).filter(s => faults.includes(s.fault));
    if (asked.length === 0) return null;
    // (A fault that younger faults offset is in the list once a piece: a block is on a side of it when it is on that side of one of them)
    return blocks.flatMap((signs, i) => (asked.every(s => faults.some((id, f) => id === s.fault && signs[f] === s.side)) ? [i] : []));
}

/** The sides of its faults a block of a built model is on (those faults that are there in it) */
export function sidesOfBlock(faults: readonly string[], signs: readonly number[]): FaultSide[] {
    return faults.flatMap((fault, f) => (signs[f] === 1 || signs[f] === -1 ? [{ fault, side: signs[f] as 1 | -1 }] : []));
}

/** The block of a built model a domain's sides name (-1: none of them, or it names every block) */
export function blockOf(sides: readonly FaultSide[] | undefined, faults: readonly string[], blocks: readonly (readonly number[])[]): number {
    if (!sides || sides.length === 0) return -1;
    const ids = [...new Set(faults)];
    return blocks.findIndex(signs => JSON.stringify(sidesOfBlock(faults, signs)) === JSON.stringify(ids.flatMap(f => sides.filter(s => s.fault === f))));
}

/** Names in a sentence: "A", "A and B", "A, B and C" */
export function listText(names: readonly string[]): string {
    return names.length <= 1 ? names[0] ?? '' : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** A domain in words: "Sediment and Basalt of Mine" (and the fault block, when it is named: ", east of Main fault") */
export function domainText(domain: ShellDomain, modelName: string, block?: string | null): string {
    return `${listText(domainUnits(domain))} of ${modelName}${block ? `, ${block}` : domain.sides?.length ? ', in one fault block' : ''}`;
}
