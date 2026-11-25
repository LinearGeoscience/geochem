/**
 * Which geological model a surface belongs to.
 *
 * A model does not hold its surfaces: it points at them (a fault, a contact
 * of its age order, its top), and a surface can be pointed at by several
 * models, or by one model twice. Where a surface is shown, and what it is
 * called (a fault, an erosion, the topography), follows its *home*: the
 * first use of it by the first model that uses it. Its other uses are links
 * to it. Worked out from the scene each time: nothing of it is stored, and
 * no key of any object changes with it.
 */
import type { ContactKind, ModelScene } from './types';

/** What a model uses a surface as (`shell`: a numeric model's shell at one of its cut-offs; `vein`: a vein of a vein system: the model or system owns it) */
export type HomeRole = 'shell' | 'vein' | 'fault' | 'contact' | 'block' | 'top';

export interface SurfaceUse {
    /** The model that uses it (its id) */
    model: string;
    role: HomeRole;
    /** The fault or the contact it is in that model (its id there); null for a top */
    part: string | null;
    /** As a contact: how it treats older ground */
    kind?: ContactKind;
    /** As a fault or a contact: left out of the model for now */
    off?: boolean;
}

type Scene = Pick<ModelScene, 'surfaces' | 'models' | 'numericModels' | 'veinSystems'>;

/**
 * Every use of every surface by the scene's models, by surface id: models in
 * the order they are in the scene, and within a model its faults, then its
 * contacts (the youngest first, as they are kept), then its top. A surface
 * no model uses is not in the map; a mesh from a file is not a surface, and
 * is not in it either.
 */
export function surfaceUses(scene: Scene): Map<string, SurfaceUse[]> {
    const surfaces = new Set(scene.surfaces.map(s => s.id));
    const out = new Map<string, SurfaceUse[]>();
    const add = (surface: string | undefined, use: SurfaceUse) => {
        if (!surface || !surfaces.has(surface)) return;
        const list = out.get(surface);
        if (list) list.push(use); else out.set(surface, [use]);
    };
    // A numeric model's shells are its own: it is their home, whatever else uses them
    for (const model of scene.numericModels ?? []) for (const s of model.shells) add(s.surface, { model: model.id, role: 'shell', part: null });
    // ... and a vein system's veins are its own
    for (const system of scene.veinSystems ?? []) for (const id of system.veins) add(id, { model: system.id, role: 'vein', part: null });
    // A model's part of a contact's surface in one fault block: that model is its home, under the contact it is a part of
    for (const s of scene.surfaces) {
        if (!s.blockOf || !s.within) continue;
        const model = scene.models?.find(m => m.id === s.within!.model);
        const contact = model?.contacts.find(c => c.surface === s.blockOf);
        if (model && contact) add(s.id, { model: model.id, role: 'block', part: contact.id, kind: contact.kind });
        // (Or of a fault that younger faults offset, on one side of those: under that fault)
        const fault = contact ? undefined : model?.faults?.find(x => x.surface === s.blockOf);
        if (model && fault) add(s.id, { model: model.id, role: 'block', part: fault.id });
    }
    for (const model of scene.models ?? []) {
        for (const f of model.faults ?? []) add(f.surface, { model: model.id, role: 'fault', part: f.id, ...(f.off ? { off: true } : {}) });
        for (const c of model.contacts) add(c.surface, { model: model.id, role: 'contact', part: c.id, kind: c.kind, ...(c.off ? { off: true } : {}) });
        add(model.boundary.top, { model: model.id, role: 'top', part: null });
    }
    return out;
}

/** The home of each surface a model uses, by surface id: its first use (see `surfaceUses`) */
export function surfaceHomes(scene: Scene): Map<string, SurfaceUse> {
    const out = new Map<string, SurfaceUse>();
    for (const [surface, uses] of surfaceUses(scene)) out.set(surface, uses[0]);
    return out;
}

/** The home of one surface (null: no model uses it) */
export function surfaceHome(scene: Scene, surfaceId: string): SurfaceUse | null {
    return surfaceUses(scene).get(surfaceId)?.[0] ?? null;
}

/** The surfaces whose home is a model, in the order of their uses there: its faults, its contacts (the youngest first), its top */
export function homedIn(scene: Scene, modelId: string): { surface: string; use: SurfaceUse }[] {
    const out: { surface: string; use: SurfaceUse }[] = [];
    // (Its parts of contacts in fault blocks are not listed: they come and go with their contacts)
    for (const [surface, use] of surfaceHomes(scene)) if (use.model === modelId && use.role !== 'block') out.push({ surface, use });
    const ORDER: Record<HomeRole, number> = { shell: 0, vein: 0, fault: 0, contact: 1, block: 1, top: 2 };
    const model = scene.models?.find(m => m.id === modelId);
    const place = (u: SurfaceUse) => (u.role === 'fault' ? (model?.faults ?? []).findIndex(f => f.id === u.part)
        : u.role === 'contact' ? (model?.contacts ?? []).findIndex(c => c.id === u.part) : 0);
    return out.sort((a, b) => ORDER[a.use.role] - ORDER[b.use.role] || place(a.use) - place(b.use));
}

/** The surfaces only this model uses (by id): what goes with it when it is deleted with its surfaces */
export function usedOnlyBy(scene: Scene, modelId: string): string[] {
    const out: string[] = [];
    for (const [surface, uses] of surfaceUses(scene)) if (uses.every(u => u.model === modelId) && uses[0]?.role !== 'block') out.push(surface);
    return out;
}

/**
 * The surfaces only these models use (by id): what can go with them when
 * they are deleted. A surface another model uses as well stays.
 */
export function surfacesOnlyOf(scene: Scene, modelIds: readonly string[]): string[] {
    const going = new Set(modelIds);
    const out: string[] = [];
    // (A model's parts of contacts in fault blocks go with it unasked: they are not offered)
    for (const [surface, uses] of surfaceUses(scene)) if (uses[0]?.role !== 'block' && uses.every(u => going.has(u.model))) out.push(surface);
    return out;
}
