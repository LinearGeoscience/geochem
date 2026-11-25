/**
 * How a view draws the meshes of the model (features/model/viewDisplay): what
 * it draws differently from each object's own look, and changing that.
 */
import { useCallback, useMemo } from 'react';
import { plotById, useAppStore } from '../store/appStore';
import { DISPLAY_SETTING, displayChange, displayOf, type ObjectDisplay, type ViewDisplay } from '../features/model/viewDisplay';

export type DisplayChange = { [K in keyof ObjectDisplay]: ObjectDisplay[K] | undefined } | null;

export interface ViewDisplayState {
    /** The view (null: none) */
    plotId: string | null;
    display: ViewDisplay;
    /** Draw these objects another way in the view (a field undefined: the object's own again; null: all of it) */
    set: (objectKeys: readonly string[], change: DisplayChange) => void;
}

/** Outside a component: a menu's click, an editor that has changed the object's own look */
export function setViewDisplay(plotId: string | null, objectKeys: readonly string[], change: DisplayChange): void {
    if (!plotId) return;
    const app = useAppStore.getState();
    const settings = plotById(app, plotId)?.settings;
    // Nothing kept for them and nothing to keep: the view's settings are left as they are
    const has = displayOf(settings?.[DISPLAY_SETTING]);
    if ((change === null || Object.values(change).every(v => v === undefined)) && !objectKeys.some(k => has[k])) return;
    app.updatePlotSettings(plotId, displayChange(settings, objectKeys, change));
}

export function useViewDisplay(plotId: string | null): ViewDisplayState {
    const saved = useAppStore(s => (plotId ? plotById(s, plotId)?.settings?.[DISPLAY_SETTING] : undefined));
    const display = useMemo(() => displayOf(saved), [saved]);
    const set = useCallback((objectKeys: readonly string[], change: DisplayChange) => setViewDisplay(plotId, objectKeys, change), [plotId]);
    return useMemo(() => ({ plotId, display, set }), [plotId, display, set]);
}
