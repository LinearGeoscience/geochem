/**
 * Rows currently shown (not hidden by any Attribute Manager tab, painted
 * group or the value filter) out of the dataset total.
 */
import { useMemo } from 'react';
import { useAppStore } from '../store/appStore';
import { useStyleInputs } from './useStyleInputs';
import { getStyleArraysColumnar } from '../utils/attributeUtils';
import { countVisible } from '../utils/hiddenRows';

export function useVisibleRowCount(): { shown: number; total: number } {
    const columnarData = useAppStore(s => s.columnarData);
    const styleInputs = useStyleInputs();
    const total = columnarData.rowCount;
    const shown = useMemo(() => {
        if (!total) return 0;
        const app = useAppStore.getState();
        return countVisible(getStyleArraysColumnar(total, c => app.getColumn(c)).visible);
    }, [columnarData, styleInputs, total]); // eslint-disable-line react-hooks/exhaustive-deps
    return { shown, total };
}
