/**
 * What kind of thing a surface is, as a geologist names it.
 *
 * In the scene every one of them is a "surface" with a rule and a few flags;
 * what it *is* comes from how it is made and what a model uses it for. One
 * function says so, for the icon in the tree, the heading of its editor, the
 * name a new one is given and the menus that make them:
 *
 *   in a model (its home, modelHome.ts)   a fault; the topography; in the age
 *                                         order a deposit, an erosion or an
 *                                         intrusion (a vein stays a vein)
 *   otherwise, from how it is made        a grade shell; a vein; a closed
 *                                         body; an offset surface (one a set
 *                                         distance from another); a contact
 *                                         found in the logging; a surface
 *                                         through points and lines
 */
import { surfaceHome, type SurfaceUse } from './modelHome';
import type { TermKey } from './terms';
import type { ModelScene, SurfaceObject } from './types';

export type ObjectType = 'deposit' | 'erosion' | 'intrusion' | 'vein' | 'fault' | 'topography' | 'offset' | 'shell' | 'contact' | 'body' | 'surface';

export const OBJECT_TYPES: readonly ObjectType[] = ['deposit', 'erosion', 'intrusion', 'vein', 'fault', 'topography', 'offset', 'shell', 'contact', 'body', 'surface'];

type Made = Pick<SurfaceObject, 'rule' | 'conform'>;

/** What a surface is from how it is made alone, whatever uses it */
export function madeType(surface: Made): ObjectType {
    const rule = surface.rule;
    if (rule.kind === 'shell') return 'shell';
    if (rule.kind === 'body') return rule.vein ? 'vein' : 'body';
    // (One that only runs alongside another is still what it is made as: offset is the one a set distance from it)
    if (surface.conform && surface.conform.by !== undefined) return 'offset';
    return rule.kind === 'contact' ? 'contact' : 'surface';
}

/** What a surface is, given its home in a model (null: no model uses it) */
export function typeAt(surface: Made, home: Pick<SurfaceUse, 'role' | 'kind'> | null): ObjectType {
    const made = madeType(surface);
    if (!home || home.role === 'shell' || home.role === 'vein') return made;
    // (A model's part of a fault, on one side of the faults that offset it, has no kind of contact)
    if (home.role === 'fault' || (home.role === 'block' && !home.kind)) return 'fault';
    if (home.role === 'top') return 'topography';
    // In the age order: a vein is a vein whatever kind of contact it is given
    return made === 'vein' ? 'vein' : home.kind ?? 'deposit';
}

/** What a surface of the scene is: from the model that uses it first, else from how it is made */
export function objectType(surface: Pick<SurfaceObject, 'id' | 'rule' | 'conform'>, scene: Pick<ModelScene, 'surfaces' | 'models' | 'numericModels'> | null): ObjectType {
    return typeAt(surface, scene ? surfaceHome(scene, surface.id) : null);
}

/** Closed: it has an inside and an outside, not two sides of a sheet */
export const isClosed = (type: ObjectType): boolean => type === 'shell' || type === 'vein' || type === 'body' || type === 'intrusion';

const TYPE_TERM: Record<ObjectType, TermKey> = {
    deposit: 'typeDeposit', erosion: 'typeErosion', intrusion: 'typeIntrusion', vein: 'typeVein', fault: 'typeFault', topography: 'typeTopography',
    offset: 'typeOffset', shell: 'typeShell', contact: 'typeContact', body: 'typeBody', surface: 'typeSurface',
};

/** The term that names a kind of object (terms.ts) */
export const typeTerm = (type: ObjectType): TermKey => TYPE_TERM[type];
