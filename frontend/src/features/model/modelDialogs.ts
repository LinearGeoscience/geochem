/**
 * The modelling dialogs that make or change a surface, take readings from
 * columns, group logged codes into units, add a logging table or start a
 * geological model, open from
 * anywhere: a 3D view's panel, the properties of the Modelling page, the
 * project tree. One of each is mounted for the whole app
 * (features/modelling/ModelDialogsMount).
 */
import { create } from 'zustand';
import type { SceneCoords } from './types';

export type ModelDialogKind = 'contact' | 'body' | 'vein' | 'shell' | 'numeric' | 'proportion' | 'readings' | 'units' | 'tables' | 'model';

export interface ModelDialog {
    kind: ModelDialogKind;
    /** The columns the dialog works in (those of the view it was opened from, or the scene's) */
    coords: SceneCoords | null;
    /** What it opens on: the surface being changed (contact, body, shell), the numeric model (numeric, proportion) or the units (units); null: a new one */
    target: string | null;
}

export const useModelDialogs = create<{ dialog: ModelDialog | null }>(() => ({ dialog: null }));

export function openModelDialog(kind: ModelDialogKind, coords: SceneCoords | null, target: string | null = null): void {
    useModelDialogs.setState({ dialog: { kind, coords, target } });
}

export function closeModelDialog(): void {
    useModelDialogs.setState({ dialog: null });
}

export interface DeleteRequest {
    /** The objects a delete is being asked about, by key (null: none) */
    keys: string[] | null;
    /** Called once they are deleted */
    then: (() => void) | null;
    /** The surfaces only the models being deleted use, by key: they can go with them */
    also: string[];
    /** They are to go with them */
    withAlso: boolean;
}

/**
 * The delete being asked about (deleteObjects.ts `requestDelete` sets it; the
 * dialog that asks is mounted with the others). Kept here, with nothing of
 * the model's code behind it, so that the app's frame can watch for it.
 */
export const useDeleteRequest = create<DeleteRequest>(() => ({ keys: null, then: null, also: [], withAlso: false }));
