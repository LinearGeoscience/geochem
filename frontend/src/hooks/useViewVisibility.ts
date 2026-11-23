/**
 * What a view shows of the model, and showing or hiding objects in it
 * (features/model/viewVisibility). A 3D view provides its own through
 * ViewVisibilityContext, so the eyes and boxes of the panels inside it act
 * on that view only.
 */
import { createContext, useCallback, useContext, useMemo } from 'react';
import { plotById, useAppStore } from '../store/appStore';
import { useDrillholeStore } from '../store/drillholeStore';
import { useModelStore } from '../store/modelStore';
import { keys, parseKey } from '../features/model/objectKeys';
import {
    CUTS_SETTING, cutKeysOf, hasOwnList, HIDDEN_SETTING, hiddenCuts, hiddenTables, legacyHidden, showingOnly, showOnlyChange, shownChange, shownTablesOf, TABLES_SETTING, TRACES_SETTING,
} from '../features/model/viewVisibility';

export interface ViewVisibility {
    /** The view (null: none; the objects' shared flags are shown and changed) */
    plotId: string | null;
    /** The objects hidden (the same set while what is hidden stays the same) */
    hidden: ReadonlySet<string>;
    isShown: (key: string) => boolean;
    setShown: (keys: readonly string[], shown: boolean) => void;
    /** Hide everything but these */
    showOnly: (keys: readonly string[]) => void;
}

/** The objects' shared flags: what is seen outside any view, and where a view with no list of its own starts */
function setSharedFlags(objectKeys: readonly string[], shown: boolean): void {
    const model = useModelStore.getState();
    for (const k of objectKeys) {
        const key = parseKey(k);
        if (!key) continue;
        if (key.kind === 'surface') model.updateSurface(key.id, { visible: shown });
        else if (key.kind === 'inputs') model.updateInputSet(key.id, { visible: shown });
        else if (key.kind === 'readings') model.updateReadingSet(key.id, { visible: shown });
        else if (key.kind === 'wireframe') model.updateWireframe(key.id, { visible: shown });
    }
}

export function useViewVisibility(plotId: string | null): ViewVisibility {
    const saved = useAppStore(s => (plotId ? plotById(s, plotId)?.settings?.[HIDDEN_SETTING] : undefined));
    // The hole traces are the view's own switch
    const tracesOff = useAppStore(s => (plotId ? plotById(s, plotId)?.settings?.[TRACES_SETTING] === false : false));
    // The logging tables are drawn where a view is told to draw them
    const shownTables = useAppStore(s => shownTablesOf(plotId ? plotById(s, plotId)?.settings?.[TABLES_SETTING] : undefined).join('\n'));
    const tableIds = useDrillholeStore(s => (s.db?.tables ?? []).filter(t => t.to).map(t => t.id).join('\n'));
    // A geological model's contacts as it cuts them are drawn where a view is told to draw them
    const shownCuts = useAppStore(s => shownTablesOf(plotId ? plotById(s, plotId)?.settings?.[CUTS_SETTING] : undefined).join('\n'));
    const cutKeys = useModelStore(s => cutKeysOf(s.scene).join('\n'));
    // A view with no list of its own follows the flags, so it needs the scene; one with a list does not
    const seed = useModelStore(s => (hasOwnList(saved) ? '' : legacyHidden(s.scene).join('\n')));
    const listed = hasOwnList(saved) ? saved.join('\n') : null;
    const hidden = useMemo<ReadonlySet<string>>(() => {
        const split = (s: string) => s.split('\n').filter(k => k !== '');
        return new Set([...split(listed ?? seed), ...(tracesOff ? [keys.collars] : []), ...hiddenTables(split(shownTables), split(tableIds)), ...hiddenCuts(split(shownCuts), split(cutKeys))]);
    }, [listed, seed, tracesOff, shownTables, tableIds, shownCuts, cutKeys]);
    const setShown = useCallback((objectKeys: readonly string[], shown: boolean) => {
        if (!plotId) { setSharedFlags(objectKeys, shown); return; }
        const app = useAppStore.getState(), scene = useModelStore.getState().scene;
        app.updatePlotSettings(plotId, shownChange(plotById(app, plotId)?.settings, scene, objectKeys, shown));
    }, [plotId]);
    const showOnly = useCallback((objectKeys: readonly string[]) => {
        const scene = useModelStore.getState().scene;
        if (!plotId) {
            const keep = new Set(objectKeys);
            setSharedFlags(objectKeys, true);
            setSharedFlags(showingOnly(scene, objectKeys).filter(k => !keep.has(k)), false);
            return;
        }
        useAppStore.getState().updatePlotSettings(plotId, showOnlyChange(scene, objectKeys));
    }, [plotId]);
    return useMemo(() => ({ plotId, hidden, isShown: (k: string) => !hidden.has(k), setShown, showOnly }), [plotId, hidden, setShown, showOnly]);
}

/** The view a panel sits in (Viewer3D provides it) */
export const ViewVisibilityContext = createContext<ViewVisibility | null>(null);

/** What the view this sits in shows; outside any view, the shared flags */
export function useShownObjects(): ViewVisibility {
    const inView = useContext(ViewVisibilityContext);
    const shared = useViewVisibility(null);
    return inView ?? shared;
}
