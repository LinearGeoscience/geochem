/**
 * Rebuild the Attribute Manager from a .gas file. The backend turns
 * each row's colour/shape/size/filter index into a text column of group
 * names ("Shape attribute" etc.); here each tab gets that column as its field
 * with one category entry per group, in file order, keeping the file's
 * colours, glyphs, sizes and visibility.
 */
import { AttributeEntry, AttributeType, createCategoryEntry, useAttributeStore } from '../store/attributeStore';

export type InteropKind = 'colour' | 'shape' | 'size' | 'filter';

export interface InteropAttributeEntry {
    name: string;
    hex?: string;
    shape?: number;
    shapeCode?: number;
    filled?: boolean;
    size?: number;
    visible?: boolean;
}

export interface InteropAttributeList {
    column: string;
    title: string;
    entries: InteropAttributeEntry[];
}

const TAB: Record<InteropKind, AttributeType> = { colour: 'color', shape: 'shape', size: 'size', filter: 'filter' };

/** glyph index -> our shape names (cycles through its glyph list the same way) */
const INTEROP_SHAPES = [
    'circle', 'square', 'triangle-up', 'triangle-down', 'diamond', 'cross', 'x',
    'star', 'pentagon', 'hexagon', 'triangle-left', 'triangle-right', 'hourglass',
];

export function interopShape(code: number | undefined): string {
    const i = Math.abs(Math.trunc(code ?? 0));
    return INTEROP_SHAPES[i % INTEROP_SHAPES.length];
}

/** point sizes run ~1-10; ours are pixels */
export function interopSize(size: number | undefined): number {
    return Math.max(3, Math.round((size ?? 4) * 2));
}

function styleOf(kind: InteropKind, e: InteropAttributeEntry): Pick<AttributeEntry, 'color' | 'shape' | 'size'> {
    if (kind === 'colour') return { color: e.hex ?? '#000000' };
    if (kind === 'shape') return { shape: interopShape(e.shape) };
    if (kind === 'size') return { size: interopSize(e.size) };
    return {};
}

/**
 * Entries for one tab: the current default entry restyled from the file's
 * first (default) group, then one category entry per named group.
 * `values` is the attribute column, used for row counts.
 */
export function buildInteropEntries(
    kind: InteropKind,
    list: InteropAttributeList,
    defaultEntry: AttributeEntry,
    values: ArrayLike<unknown>,
): AttributeEntry[] {
    const counts = new Map<string, number>();
    let defaults = 0;
    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (v === null || v === undefined || v === '') defaults++;
        else counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
    }
    const [first, ...groups] = list.entries;
    const def: AttributeEntry = {
        ...defaultEntry,
        ...(first ? styleOf(kind, first) : {}),
        visible: first?.visible ?? true,
        rowCount: defaults,
        visibleRowCount: first?.visible === false ? 0 : defaults,
    };
    const seen = new Set<string>();
    const entries = groups
        .filter(g => g.name && !seen.has(g.name) && seen.add(g.name))
        .map((g, i) => {
            const s = styleOf(kind, g);
            const e = createCategoryEntry(g.name, i, s.color, s.shape, s.size);
            e.visible = g.visible ?? true;
            e.rowCount = counts.get(g.name) ?? 0;
            e.visibleRowCount = e.visible ? e.rowCount : 0;
            return e;
        });
    return [def, ...entries];
}

/** Apply every imported list to the Attribute Manager. Returns the tabs set. */
export function applyInteropAttributes(
    attributes: Partial<Record<InteropKind, InteropAttributeList>> | undefined,
    getColumn: (name: string) => ArrayLike<unknown> | undefined,
): AttributeType[] {
    if (!attributes) return [];
    const store = useAttributeStore.getState();
    const applied: AttributeType[] = [];
    for (const kind of Object.keys(TAB) as InteropKind[]) {
        const list = attributes[kind];
        if (!list?.column || !list.entries?.length) continue;
        const values = getColumn(list.column);
        if (!values) continue;
        const tab = TAB[kind];
        const current = useAttributeStore.getState()[tab];
        const defaultEntry = current.entries.find(e => e.isDefault) ?? current.entries[0];
        store.setField(tab, list.column);
        store.setMethod(tab, 'categorical');
        store.setEntries(tab, buildInteropEntries(kind, list, defaultEntry, values));
        applied.push(tab);
    }
    return applied;
}

// ---------------------------------------------------------------------------
// Checkpoints saved in a .gas file
// ---------------------------------------------------------------------------

export interface InteropCheckpointList {
    title: string;
    entries: (InteropAttributeEntry & { isDefault?: boolean })[];
    /** Per data row: index into entries (0 = default) */
    rows: number[];
}

export interface InteropCheckpoint {
    name: string;
    attributes: Partial<Record<InteropKind, InteropCheckpointList>>;
}

const STYLED: InteropKind[] = ['colour', 'shape', 'size'];

/**
 * A checkpoint as an Attribute Manager state (exportState() JSON,
 * based on `baseJson`). Each combination of colour / shape / size group
 * becomes one custom row holding its data rows; rows in the default groups
 * stay on the default entries. Filter groups are not carried over.
 */
export function interopCheckpointState(cp: InteropCheckpoint, baseJson: string): string {
    const base = JSON.parse(baseJson);
    const kinds = STYLED.filter(k => cp.attributes[k]?.rows?.length);
    const n = kinds.length ? cp.attributes[kinds[0]]!.rows.length : 0;
    const groups = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
        const parts = kinds.map(k => cp.attributes[k]!.rows[i] ?? 0);
        if (parts.every(p => p === 0)) continue;
        const key = parts.join(',');
        const list = groups.get(key);
        if (list) list.push(i); else groups.set(key, [i]);
    }
    const customEntries: AttributeEntry[] = [...groups.entries()].map(([key, rows], j) => {
        const parts = key.split(',').map(Number);
        const pick = (kind: InteropKind) => {
            const k = kinds.indexOf(kind);
            return k < 0 ? undefined : cp.attributes[kind]!.entries[parts[k]];
        };
        const named = kinds.map((kind, k) => (parts[k] ? cp.attributes[kind]!.entries[parts[k]]?.name : '')).filter(Boolean);
        const colour = pick('colour'), shape = pick('shape'), size = pick('size');
        const visible = kinds.every((kind, k) => cp.attributes[kind]!.entries[parts[k]]?.visible !== false);
        return {
            id: `interop-cp-${j}`,
            name: named.join(' / ') || `Group ${j + 1}`,
            isDefault: false, isCustom: true, visible, type: 'custom',
            color: colour?.hex, shape: shape ? interopShape(shape.shape) : undefined, size: size ? interopSize(size.size) : undefined,
            opacity: 1, assignedIndices: rows, rowCount: rows.length, visibleRowCount: visible ? rows.length : 0,
        };
    });
    for (const kind of kinds) {
        const tab = TAB[kind];
        const cfg = base[tab] ?? {};
        const defaultEntry = (cfg.entries ?? []).find((e: AttributeEntry) => e.isDefault);
        const first = cp.attributes[kind]!.entries[0];
        base[tab] = {
            ...cfg, field: null, additionalFields: [], method: 'categorical',
            entries: defaultEntry ? [{ ...defaultEntry, ...(first ? styleOf(kind, first) : {}), visible: first?.visible ?? true }] : [],
        };
    }
    base.customEntries = customEntries;
    return JSON.stringify(base);
}
