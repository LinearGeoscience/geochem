/**
 * The model view the tree and the properties act on: the one last used on
 * the Modelling page (features/model/viewRegistry has what it shows and what
 * it can do), and framing objects of the project in it.
 */
import { useAppStore } from '../../store/appStore';
import { useModelStore } from '../../store/modelStore';
import { activeModelView, useModellingStore } from '../../store/modellingStore';
import { boundsOfKeys } from '../model/sceneBounds';
import { defaultCoords } from '../model/logging';
import type { SceneCoords } from '../model/types';
import { useViewRegistry, useViewStatus, viewActions, type ViewActions, type ViewStatus } from '../model/viewRegistry';

export { boundsOfKeys };

export interface TargetView {
    /** The view's id (null: no model view is open) */
    id: string | null;
    title: string | null;
    /** What it shows (null: not open, or not drawn yet) */
    status: ViewStatus | null;
    /** What it can be asked to do, now (null: not drawn yet) */
    actions: () => ViewActions | null;
}

export function useTargetView(): TargetView {
    const views = useAppStore(s => s.modelViews);
    const activeId = useModellingStore(s => s.activeViewId);
    const view = activeModelView(views, activeId);
    const id = view?.id ?? null;
    const status = useViewStatus(id);
    return { id, title: view?.title ?? null, status, actions: () => viewActions(id) };
}

/** The same, asked for once (outside a component: a menu's click, a key) */
export function targetViewNow(): TargetView {
    const view = activeModelView(useAppStore.getState().modelViews, useModellingStore.getState().activeViewId);
    const id = view?.id ?? null;
    return { id, title: view?.title ?? null, status: id ? useViewRegistry.getState().status[id] ?? null : null, actions: () => viewActions(id) };
}

/**
 * The columns things are made and read in: those of the view the pane acts
 * on, and with no view open the model's own (`defaultCoords`), so nothing
 * waits for a view to be opened. Null: the data has no three columns to
 * place anything by.
 */
export const coordsFor = (target: TargetView): SceneCoords | null =>
    // (Last, the scene's columns as they were saved, though the data no longer has them: what is made then waits for its data, as it always did)
    target.actions()?.coords() ?? defaultCoords() ?? useModelStore.getState().scene.coords;

/** Frame the objects in a view; false when it cannot (no such view, or nothing there has a place) */
export function zoomToKeys(viewId: string | null, keys: readonly string[]): boolean {
    const act = viewActions(viewId);
    const b = act ? boundsOfKeys(keys) : null;
    if (!act || !b) return false;
    // A flat set (points on one level) is still framed: give it some depth
    const pad = b.max.map((v, k) => (v - b.min[k] > 0 ? 0 : 5));
    act.zoomToWorld({ min: b.min.map((v, k) => v - pad[k]), max: b.max.map((v, k) => v + pad[k]) });
    return true;
}
