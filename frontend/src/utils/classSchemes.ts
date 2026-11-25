/**
 * Saved classes (class schemes): take a tab's classes as a scheme, and put a
 * scheme back on a field.
 *
 * - Numeric breaks go back exactly as saved and are held as hand-edited
 *   breaks, so a different dataset (or new data) does not move them.
 * - Category classes are rebuilt from the field's values and take the saved
 *   look by value; values the scheme does not name get spare palette colours.
 */
import {
    AttributeConfig, AttributeEntry, AttributeType, EditableProp, TAB_NAMES, generateEntryId, useAttributeStore,
} from '../store/attributeStore';
import type { ClassScheme } from '../store/classSchemeStore';
import { buildClasses, classStyle, datasetGetter, mergeClasses, numericDistinct } from './attributeClassify';
import type { ColumnData } from '../types/columnarData';
import { isNumericColumn } from '../types/columnarData';

type Data = ReturnType<typeof datasetGetter>;

/** The property a tab styles (the Filter tab only shows / hides) */
const STYLE_PROP: Record<AttributeType, 'color' | 'shape' | 'size' | null> = {
    color: 'color', shape: 'shape', size: 'size', filter: null,
};

const isClass = (e: AttributeEntry) => !e.isDefault && !e.isCustom && (e.type === 'range' || e.type === 'category');
const bare = (e: AttributeEntry): AttributeEntry => ({ ...e, assignedIndices: [], rowCount: 0, visibleRowCount: 0 });

/** Number of classes (not the Default row) in a scheme */
export function schemeClassCount(scheme: ClassScheme): number {
    return scheme.entries.filter(e => !e.isDefault).length;
}

/** The tab's classes as a scheme, or null when it has none to save */
export function schemeFromConfig(tab: AttributeType, cfg: AttributeConfig, name: string): ClassScheme | null {
    if (!cfg.field) return null;
    const classes = cfg.entries.filter(isClass);
    if (!classes.length) return null;
    const kind: ClassScheme['kind'] = classes.some(e => e.type === 'range') ? 'range' : 'category';
    const kept = classes.filter(e => e.type === kind);
    const rank = new Map([...kept].sort((a, b) => (a.min ?? 0) - (b.min ?? 0)).map((e, i) => [e.id, i]));
    const prop = STYLE_PROP[tab];
    const entries = cfg.entries.filter(e => e.isDefault || kept.includes(e)).map((e) => {
        const out = bare(e);
        if (e.isDefault || kind !== 'range') return out;
        const i = rank.get(e.id)!;
        out.key = `r${i}`;
        // A look the palette would not give (hand-picked, or left from another class count)
        // is marked as an edit, so later rebuilds keep it instead of repainting from the palette
        if (prop && e[prop] !== classStyle(tab, cfg, i, kept.length)[prop] && !(e.edited ?? []).includes(prop)) {
            out.edited = [...(e.edited ?? []), prop as EditableProp];
        }
        return out;
    });
    return {
        id: `cs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: name.trim() || cfg.field,
        created: new Date().toISOString(),
        tab, kind,
        field: cfg.field,
        additionalFields: kind === 'category' ? [...(cfg.additionalFields ?? [])] : [],
        method: cfg.method,
        numClasses: cfg.numClasses,
        palette: cfg.palette,
        reversed: cfg.reversed,
        sizeRange: cfg.sizeRange,
        entries,
    };
}

/** Can the scheme's classes go on this column? Breaks need numbers; values need a manageable number of them */
export function canApplyTo(scheme: ClassScheme, col: ColumnData | undefined): boolean {
    if (!col) return false;
    if (scheme.kind === 'range') return isNumericColumn(col);
    return !isNumericColumn(col) || numericDistinct(col) !== null;
}

/** Field a scheme goes on: the one it was saved on when the dataset has it, else the tab's current field */
export function schemeTarget(scheme: ClassScheme, currentField: string | null, getCol: Data['getCol']): string | null {
    if (canApplyTo(scheme, getCol(scheme.field))) return scheme.field;
    if (currentField && canApplyTo(scheme, getCol(currentField))) return currentField;
    return null;
}

export interface ApplyResult {
    ok: boolean;
    message: string;
}

/**
 * Put a scheme on its tab (one store update = one undo step). `field`
 * overrides the target chosen by `schemeTarget`.
 */
export function applyScheme(scheme: ClassScheme, field?: string, data: Data = datasetGetter()): ApplyResult {
    const tab = scheme.tab;
    const cur = useAttributeStore.getState()[tab];
    const target = field ?? schemeTarget(scheme, cur.field, data.getCol);
    if (!target || !canApplyTo(scheme, data.getCol(target))) {
        const need = scheme.kind === 'range' ? 'a numeric field' : 'a field';
        return {
            ok: false,
            message: field
                ? `"${scheme.name}" cannot go on ${field}: it needs ${need}`
                : `This dataset has no "${scheme.field}" column. Choose ${need} on the ${TAB_NAMES[tab]} tab, then apply "${scheme.name}" again`,
        };
    }
    // own copies: the saved scheme must not share objects with the live classes
    const saved: AttributeEntry[] = JSON.parse(JSON.stringify(scheme.entries));
    const def = saved.find(e => e.isDefault) ?? cur.entries.find(e => e.isDefault);
    const base: AttributeConfig = {
        ...cur,
        field: target,
        additionalFields: [],
        method: scheme.method,
        numClasses: scheme.numClasses,
        palette: scheme.palette,
        reversed: scheme.reversed,
        sizeRange: scheme.sizeRange ?? cur.sizeRange,
        entries: def ? [def] : [],
    };

    let next: AttributeConfig;
    let message: string;
    if (scheme.kind === 'range') {
        const classes = saved.filter(e => !e.isDefault && e.type === 'range').map(e => ({ ...bare(e), id: generateEntryId() }));
        next = {
            ...base,
            method: scheme.method === 'categorical' ? 'equal' : scheme.method,
            numClasses: classes.length,
            entries: [...base.entries, ...classes],
            auto: true,
            breaksEdited: true,
        };
        message = `"${scheme.name}": ${classes.length} classes on ${target}`;
    } else {
        const extra = target === scheme.field && scheme.additionalFields.every(f => data.getCol(f)) ? scheme.additionalFields : [];
        const cfg: AttributeConfig = { ...base, method: 'categorical', additionalFields: [...extra], breaksEdited: false };
        const built = buildClasses(tab, cfg, data);
        if (!built) return { ok: false, message: `Could not classify ${target}` };
        const entries = mergeClasses(saved, built, { keepStyles: true });
        const savedIds = new Set(saved.map(e => e.id));
        const classes = entries.filter(e => !e.isDefault);
        const found = classes.filter(e => savedIds.has(e.id)).length;
        next = { ...cfg, entries, auto: true };
        message = `"${scheme.name}" on ${target}: ${found} of ${schemeClassCount(scheme)} saved classes found`
            + (classes.length > found ? `, ${classes.length - found} other values given new styles` : '');
    }
    useAttributeStore.setState({ [tab]: next, selectedEntryIds: [] } as any);
    return { ok: true, message };
}
