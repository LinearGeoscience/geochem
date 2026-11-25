/**
 * What a legend shows, built once from the Attribute Manager for every legend
 * (export dialog, on-plot overlay, report): class names as the user sees them
 * (renames included), styles, and visible row counts from the style engine.
 */
import { useAppStore } from '../store/appStore';
import { AttributeEntry, TAB_NAMES, useAttributeStore } from '../store/attributeStore';
import { entryRowCounts } from './attributeUtils';

export type LegendTab = 'color' | 'shape' | 'size';

export interface LegendItem {
    id: string;
    label: string;
    color?: string;
    shape?: string;
    size?: number;
    /** Visible rows in this class (when counts were asked for) */
    count?: number;
}

export interface LegendSection {
    key: string;
    title: string;
    items: LegendItem[];
    /** Progressive colour: a continuous ramp from the first to the last class */
    ramp?: { colors: string[]; min: string; max: string };
}

export interface LegendOptions {
    tabs: LegendTab[];
    /** One section with colour, shape and size together when the tabs share a field */
    combined?: boolean;
    counts?: boolean;
    /** Leave out classes with no visible rows (always true for Default) */
    hideEmpty?: boolean;
}

const fieldsOf = (tab: LegendTab) => {
    const c = useAttributeStore.getState()[tab];
    return c.field ? [c.field, ...(c.additionalFields ?? [])] : [];
};

export function buildLegendModel(opts: LegendOptions): LegendSection[] {
    const attrs = useAttributeStore.getState();
    const app = useAppStore.getState();
    const n = app.columnarData.rowCount;
    const counts = new Map<LegendTab, Map<string, { total: number; visible: number }>>();
    const countsOf = (tab: LegendTab) => {
        if (!n) return null;
        if (!counts.has(tab)) counts.set(tab, entryRowCounts(tab, n, c => app.getColumn(c)));
        return counts.get(tab)!;
    };
    const alias = (name: string) => app.columns.find(c => c.name === name)?.alias || name;

    const keep = (tab: LegendTab, e: AttributeEntry) => {
        if (!e.visible) return null;
        const m = countsOf(tab);
        const c = m ? m.get(e.isDefault ? '' : e.id) ?? { total: 0, visible: 0 } : undefined;   // absent = no rows
        if (c && !c.visible && (opts.hideEmpty || e.isDefault)) return null;
        return c;
    };
    const item = (tab: LegendTab, e: AttributeEntry, c: { visible: number } | null | undefined, styleFrom?: Partial<Record<LegendTab, AttributeEntry>>): LegendItem => ({
        id: e.id,
        label: e.isDefault ? 'Other' : e.name,
        color: tab === 'color' ? e.color : styleFrom?.color?.color,
        shape: tab === 'shape' ? e.shape : styleFrom?.shape?.shape,
        size: tab === 'size' ? e.size : styleFrom?.size?.size,
        count: opts.counts && c ? c.visible : undefined,
    });

    const sections: LegendSection[] = [];
    const tabs = opts.tabs.filter(t => attrs[t].field || attrs[t].entries.some(e => !e.isDefault));

    // Combined: tabs classified on the same field(s) with the same classes
    const lead = tabs[0];
    const same = opts.combined && lead && tabs.every(t => fieldsOf(t).join('|') === fieldsOf(lead).join('|'));
    if (same && tabs.length > 1) {
        const byKey = (t: LegendTab) => new Map(attrs[t].entries.map(e => [e.isDefault ? '' : e.key ?? e.name, e]));
        const maps = Object.fromEntries(tabs.map(t => [t, byKey(t)])) as Record<LegendTab, Map<string, AttributeEntry>>;
        const items: LegendItem[] = [];
        for (const e of attrs[lead].entries) {
            const k = e.isDefault ? '' : e.key ?? e.name;
            const c = keep(lead, e);
            if (c === null) continue;
            const from = Object.fromEntries(tabs.map(t => [t, maps[t].get(k)])) as Partial<Record<LegendTab, AttributeEntry>>;
            items.push({ ...item(lead, e, c, from), color: from.color?.color, shape: from.shape?.shape, size: from.size?.size });
        }
        sections.push({ key: 'combined', title: fieldsOf(lead).map(alias).join(' + '), items });
    } else {
        for (const t of tabs) {
            const cfg = attrs[t];
            const items: LegendItem[] = [];
            for (const e of cfg.entries) {
                const c = keep(t, e);
                if (c !== null) items.push(item(t, e, c));
            }
            const title = cfg.field ? `${TAB_NAMES[t]}: ${fieldsOf(t).map(alias).join(' + ')}` : TAB_NAMES[t];
            const section: LegendSection = { key: t, title, items };
            if (t === 'color' && cfg.method === 'progressive') {
                const ranges = cfg.entries.filter(e => e.type === 'range' && !e.isDefault && e.color);
                if (ranges.length > 1) {
                    section.ramp = {
                        colors: ranges.map(e => e.color!),
                        min: String(ranges[0].min ?? ''),
                        max: String(ranges[ranges.length - 1].max ?? ''),
                    };
                }
            }
            sections.push(section);
        }
    }

    // Painted groups: every property they define
    const painted: LegendItem[] = [];
    for (const e of attrs.customEntries) {
        if (!e.visible) continue;
        const m = countsOf('color');
        const c = m ? m.get(e.id) ?? { total: 0, visible: 0 } : undefined;
        if (c && !c.visible && opts.hideEmpty) continue;
        painted.push({ id: e.id, label: e.name, color: e.color, shape: e.shape, size: e.size, count: opts.counts && c ? c.visible : undefined });
    }
    if (painted.length) sections.push({ key: 'custom', title: 'Groups', items: painted });

    return sections.filter(s => s.items.length || s.ramp);
}
