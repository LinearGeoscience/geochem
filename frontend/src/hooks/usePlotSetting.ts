/**
 * Per-plot persisted settings with a single source of truth.
 *
 * Replaces the pattern used across the plot components:
 *
 *   const stored = getPlotSettings(plotId);
 *   const [xAxis, setXAxisLocal] = useState(stored.xAxis || '');
 *   const setXAxis = (v) => { setXAxisLocal(v); updatePlotSettings(plotId, { xAxis: v }); };
 *
 * which kept every setting twice (component state + store) and let them
 * drift. Now:
 *
 *   const [xAxis, setXAxis] = usePlotSetting(plotId, 'xAxis', '');
 *
 * The value is read from the plot's settings in the store (re-rendering only
 * when that key changes); the setter writes the store. Functional updates are
 * supported and read the latest stored value.
 */
import { useCallback } from 'react';
import { useAppStore } from '../store/appStore';

type Updater<T> = T | ((prev: T) => T);

export function usePlotSetting<T>(
    plotId: string,
    key: string,
    defaultValue: T,
): [T, (value: Updater<T>) => void] {
    const stored = useAppStore(s => s.plots.find(p => p.id === plotId)?.settings?.[key]) as T | undefined;
    const value = stored === undefined || stored === null ? defaultValue : stored;

    const setValue = useCallback((next: Updater<T>) => {
        const state = useAppStore.getState();
        const current = state.plots.find(p => p.id === plotId)?.settings?.[key] as T | undefined;
        const prev = current === undefined || current === null ? defaultValue : current;
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        if (Object.is(resolved, prev)) return;
        state.updatePlotSettings(plotId, { [key]: resolved });
        // defaultValue is intentionally not a dependency: callers pass literals
        // (a new [] / {} each render) and only the stored value matters here.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [plotId, key]);

    return [value, setValue];
}
