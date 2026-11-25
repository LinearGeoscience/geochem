/**
 * The geological model the page is on: the one picked in the tree (the
 * model itself, a part of it, one of its contacts, faults or volumes), else
 * the one it was on last, else the first in the project. The setup steps
 * over the tree and the age order's own window both follow it.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import { useModelStore } from '../../store/modelStore';
import { useModellingStore } from '../../store/modellingStore';
import { keys, parseKey, parseModelGroup, parseModelPart } from '../model/objectKeys';
import { pickFromView } from '../model/treePicks';
import type { GeoModel } from '../model/types';

/** The model a key of the tree belongs to, and the contact of it the key is (null: it is no contact) */
export function modelOfKey(key: string): { model: string; contact: string | null } | null {
    const part = parseModelPart(key);
    if (part) return { model: part.model, contact: part.kind === 'modelContact' ? part.part : null };
    const group = parseModelGroup(key);
    if (group) return { model: group.model, contact: null };
    const parsed = parseKey(key);
    return parsed?.kind === 'model' ? { model: parsed.id, contact: null } : null;
}

/** The model the page was on last (for the session) */
const useLastModel = create<{ id: string | null }>(() => ({ id: null }));

export interface PickedModel {
    /** The model the page is on (none: the project has no model) */
    model: GeoModel | undefined;
    /** The contact of it picked in the tree (null: none) */
    contact: string | null;
    models: GeoModel[];
    /** Go to another model: it is picked in the tree */
    choose: (id: string) => void;
}

const NONE: GeoModel[] = [];

const choose = (id: string): void => { useLastModel.setState({ id }); pickFromView(keys.model(id)); };

export function usePickedModel(): PickedModel {
    const models = useModelStore(s => s.scene.models) ?? NONE;
    const selected = useModellingStore(s => s.selected);
    const last = useLastModel(s => s.id);
    const picked = selected.length === 1 ? modelOfKey(selected[0]) : null;
    const on = picked?.model ?? null;
    useEffect(() => { if (on) useLastModel.setState({ id: on }); }, [on]);
    const model = models.find(m => m.id === (on ?? last)) ?? models[0];
    return {
        model,
        contact: picked && model && picked.model === model.id ? picked.contact : null,
        models,
        choose,
    };
}
