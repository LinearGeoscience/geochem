/**
 * What is hiding rows, dataset-wide. Hidden classes on any Attribute Manager
 * tab, hidden painted groups and the value filter all remove rows from plots
 * AND from most analyses, so the app says so in the status bar.
 */
import type { AttributeEntry } from '../store/attributeStore';
import { useAttributeStore } from '../store/attributeStore';

type Tab = 'color' | 'shape' | 'size' | 'filter';
const TAB_LABEL: Record<Tab, string> = { color: 'Colour', shape: 'Shape', size: 'Size', filter: 'Filter' };

export interface HiddenSource {
    label: string;
    /** Rows in the hidden class when known */
    rows: number | null;
}

interface SourceState {
    color: { field: string | null; entries: AttributeEntry[] };
    shape: { field: string | null; entries: AttributeEntry[] };
    size: { field: string | null; entries: AttributeEntry[] };
    filter: { field: string | null; entries: AttributeEntry[] };
    customEntries: AttributeEntry[];
    valueFilter: { enabled: boolean; column: string | null; min: number | null; max: number | null };
}

export function hiddenSources(s: SourceState): HiddenSource[] {
    const out: HiddenSource[] = [];
    for (const tab of ['color', 'shape', 'size', 'filter'] as Tab[]) {
        const cfg = s[tab];
        for (const e of cfg.entries) {
            if (e.visible !== false) continue;
            const what = e.isDefault ? (cfg.field ? 'rows in no class' : 'all rows') : `"${e.name}"`;
            out.push({ label: `${TAB_LABEL[tab]}${cfg.field ? ` by ${cfg.field}` : ''}: ${what}`, rows: e.rowCount ?? null });
        }
    }
    for (const e of s.customEntries) {
        if (e.visible === false) out.push({ label: `Painted group "${e.name}"`, rows: e.assignedIndices?.length ?? null });
    }
    const vf = s.valueFilter;
    if (vf.enabled && vf.column && (vf.min !== null || vf.max !== null)) {
        out.push({ label: `Value filter on ${vf.column} (${vf.min ?? '−∞'} to ${vf.max ?? '∞'})`, rows: null });
    }
    return out;
}

/** Make every class, painted group and the value filter show all rows. */
export function showAllRows(): void {
    const a = useAttributeStore.getState();
    for (const tab of ['color', 'shape', 'size', 'filter'] as Tab[]) a.setAllVisible(tab, true);
    for (const e of a.customEntries) if (e.visible === false) a.updateCustomEntry(e.id, { visible: true });
    if (a.valueFilter.enabled) a.setValueFilterEnabled(false);
}

/** Count of true values. */
export function countVisible(visible: ArrayLike<boolean>): number {
    let n = 0;
    for (let i = 0; i < visible.length; i++) if (visible[i]) n++;
    return n;
}
