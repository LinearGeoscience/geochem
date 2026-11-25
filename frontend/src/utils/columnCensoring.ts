/**
 * Say what a column's negative values mean (CensoringMode), creating its
 * Chemistry mapping when the column has none yet (columns added by a tool
 * start without one).
 */
import { useAppStore } from '../store/appStore';
import { createGeochemMappings } from './calculations/elementNameNormalizer';
import type { CensoringMode } from '../types/associations';

export function setColumnCensoring(name: string, mode: CensoringMode): void {
    const s = useAppStore.getState();
    const censoring = mode === 'auto' ? undefined : mode;
    if (s.geochemMappings.some(m => m.originalName === name)) {
        s.updateGeochemMapping(name, { censoring });
        return;
    }
    const col = s.columns.find(c => c.name === name);
    if (!col) return;
    const [m] = createGeochemMappings([name], [col]);
    useAppStore.setState({ geochemMappings: [...s.geochemMappings, { ...m, censoring }] });
}
