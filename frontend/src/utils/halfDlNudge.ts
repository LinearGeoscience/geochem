/**
 * After a dataset loads, look for below-detection values supplied as ½DL
 * (clear-cut cases only) and point the user to the Data Doctor. Nothing is
 * changed here: converting is the user's call.
 */
import { useAppStore } from '../store/appStore';
import { useUIStore } from '../store/uiStore';
import { notify } from '../store/notificationStore';
import { isNumericColumn } from '../types/columnarData';
import type { ColumnGeochemMapping } from '../types/associations';
import { findDuplicateUnitColumns } from './calculations/elementColumnResolver';
import { findHalfDlSpikesWithGroups, suggestBatchColumn, HalfDlSpike } from './halfDetection';

/** Assay columns whose ½-DL findings are all high confidence. */
export function clearHalfDlColumns(
    getCol: (name: string) => unknown,
    mappings: ColumnGeochemMapping[],
    groups?: ArrayLike<unknown>,
): { column: string; spikes: HalfDlSpike[] }[] {
    const out: { column: string; spikes: HalfDlSpike[] }[] = [];
    // A column repeating another in a different unit (Cu_pct beside Cu_ppm) is not counted twice
    const twins = new Set(findDuplicateUnitColumns(mappings, n => {
        const c = getCol(n);
        return c instanceof Float64Array ? c : undefined;
    }).map(d => d.column));
    for (const m of mappings) {
        if (twins.has(m.originalName)) continue;
        if (m.isExcluded || m.role || m.category === 'nonGeochemical' || !(m.userOverride ?? m.detectedElement)) continue;
        const col = getCol(m.originalName);
        if (!(col instanceof Float64Array) || !isNumericColumn(col)) continue;
        const spikes = findHalfDlSpikesWithGroups(col, groups);
        const sure = spikes.filter(s => s.confidence === 'high');
        if (sure.length) out.push({ column: m.originalName, spikes: sure });
    }
    return out;
}

export function halfDlMessage(found: { column: string; spikes: HalfDlSpike[] }[]): string {
    const tail = 'Convert them in the Data Doctor so the BDL setting applies.';
    if (found.length === 1) {
        const f = found[0];
        const pairs = [...new Map(f.spikes.map(s => [s.value, `${s.value} → <${s.dl}`])).values()].slice(0, 3).join(', ');
        return `Below-detection values look like ½ detection limit in 1 column (${f.column} ${pairs}). ${tail}`;
    }
    const names = found.slice(0, 4).map(f => f.column).join(', ');
    return `Below-detection values look like ½ detection limit in ${found.length} columns: ${names}${found.length > 4 ? ', …' : ''}. ${tail}`;
}

let installed = false;

export function installHalfDlNudge(): void {
    if (installed) return;
    installed = true;
    let reported = new Set<string>();
    useAppStore.subscribe((s, prev) => {
        // A new dataset replaces data and mappings together; edits change one
        if (s.columnarData === prev.columnarData || s.geochemMappings === prev.geochemMappings) return;
        if (!s.columnarData.rowCount) return;
        // Same column names = a reload of the same data (keep quiet if already said)
        const names = new Set(s.columnarData.columns.keys());
        if ([...reported].some(n => !names.has(n))) reported = new Set();
        setTimeout(() => {
            const st = useAppStore.getState();
            const get = (n: string) => st.columnarData.columns.get(n);
            const batch = suggestBatchColumn(st.columns, get);
            const found = clearHalfDlColumns(get, st.geochemMappings, batch ? get(batch) : undefined)
                .filter(f => !reported.has(f.column));
            if (!found.length) return;
            for (const f of found) reported.add(f.column);
            notify(halfDlMessage(found), 'warning', { label: 'Data Doctor', run: () => useUIStore.getState().setDataDoctorOpen(true) });
        }, 0);
    });
}
