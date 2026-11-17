/**
 * What a report figure shows (Phase 58): the plot's variables, the colour /
 * shape / size / filter attributes, rows shown and the below-detection
 * substitution, recorded when the figure is captured.
 */
import { useAppStore } from '../store/appStore';
import { useAttributeStore, TAB_NAMES } from '../store/attributeStore';
import { getStyleArraysColumnar, entryRowCounts } from './attributeUtils';
import { METHOD_LABELS } from './attributeClassify';

const MAX_CLASSES_LISTED = 15;

/** "Basalt (#1f77b4, 448 rows); Granite …" for the classes with rows shown */
function classList(tab: 'color' | 'shape' | 'size', counts: Map<string, { total: number; visible: number }> | null): string | null {
    const cfg = useAttributeStore.getState()[tab];
    const parts: string[] = [];
    for (const e of cfg.entries) {
        if (e.isDefault || !e.visible) continue;
        const c = counts?.get(e.id);
        if (counts && !c?.visible) continue;
        const style = tab === 'color' ? e.color : tab === 'shape' ? e.shape : e.size !== undefined ? `size ${e.size}` : undefined;
        const detail = [style, c ? `${c.visible.toLocaleString()} ${c.visible === 1 ? 'row' : 'rows'}` : null].filter(Boolean).join(', ');
        parts.push(detail ? `${e.name} (${detail})` : e.name);
    }
    if (!parts.length) return null;
    const shown = parts.slice(0, MAX_CLASSES_LISTED).join('; ');
    return parts.length > MAX_CLASSES_LISTED ? `${shown}; … (+${parts.length - MAX_CLASSES_LISTED})` : shown;
}
import { BDL_FACTOR_OPTIONS } from './censoring';

const listOf = (v: unknown): string | null => {
    if (typeof v === 'string' && v.trim()) return v;
    if (Array.isArray(v) && v.length && v.every(x => typeof x === 'string')) {
        return v.length > 12 ? `${v.slice(0, 12).join(', ')} … (+${v.length - 12})` : v.join(', ');
    }
    return null;
};

const AXIS_KEYS: [string, string][] = [
    ['xAxis', 'X'], ['yAxis', 'Y'], ['yAxes', 'Y'], ['zAxis', 'Z'], ['column', 'Column'],
    ['columns', 'Columns'], ['elements', 'Elements'], ['variables', 'Variables'],
];

/** Plain-language description of the plot's variables, attributes and rows shown */
export function describeFigureContext(plotId: string): string[] {
    const app = useAppStore.getState();
    const plot = app.plots.find(p => p.id === plotId);
    const lines: string[] = [];
    if (plot) {
        const s = (plot.settings ?? {}) as Record<string, unknown>;
        for (const [key, label] of AXIS_KEYS) {
            const v = listOf(s[key]);
            if (v) lines.push(`${label}: ${v}`);
        }
    }
    const attrs = useAttributeStore.getState();
    const n0 = app.columnarData.rowCount;
    for (const tab of ['color', 'shape', 'size'] as const) {
        const cfg = attrs[tab];
        if (!cfg.field) continue;
        const fields = [cfg.field, ...(cfg.additionalFields ?? [])].join(' × ');
        const k = cfg.entries.filter(e => !e.isDefault).length;
        const method = cfg.breaksEdited ? 'custom breaks' : METHOD_LABELS[cfg.method] ?? cfg.method;
        lines.push(`${TAB_NAMES[tab]}: ${fields} (${method}, ${k} ${k === 1 ? 'class' : 'classes'})`);
        const list = classList(tab, n0 ? entryRowCounts(tab, n0, c => app.getColumn(c)) : null);
        if (list) lines.push(`${TAB_NAMES[tab]} classes shown: ${list}`);
    }
    if (attrs.filter.field) lines.push(`Filter: ${attrs.filter.field}`);
    const n = app.columnarData.rowCount;
    if (n > 0) {
        const { visible } = getStyleArraysColumnar(n, name => app.getColumn(name));
        let shown = 0;
        for (let i = 0; i < n; i++) if (visible[i]) shown++;
        lines.push(shown === n ? `All ${n.toLocaleString()} rows shown` : `${shown.toLocaleString()} of ${n.toLocaleString()} rows shown`);
    }
    if (app.selectedIndices.length) lines.push(`${app.selectedIndices.length.toLocaleString()} rows selected`);
    const bdl = BDL_FACTOR_OPTIONS.find(o => o.value === app.bdlFactor);
    if (bdl) lines.push(`Below-detection values: ${bdl.label}`);
    return lines;
}
