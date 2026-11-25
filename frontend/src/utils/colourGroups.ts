/**
 * Paint labelled rows into Attribute Manager colour groups (custom entries),
 * the same way "Classify by rules → Apply as colour groups" does: a group of
 * the same name is reused and its previous rows are replaced.
 */
import { useAttributeStore, createCustomEntry } from '../store/attributeStore';

export interface ColourGroup { name: string; color: string; indices: number[]; /** false: the group's rows are hidden (default shown) */ visible?: boolean }

/**
 * Group row indices by label (blank / null labels are left out), in the order
 * given by `order` (labels not in it follow, in first-seen order). Colours are
 * assigned by position in that order.
 */
export function labelsToGroups(labels: ArrayLike<string | null | undefined>, colors: string[], order: string[] = []): ColourGroup[] {
    const byName = new Map<string, number[]>();
    for (const name of order) byName.set(name, []);
    for (let i = 0; i < labels.length; i++) {
        const l = labels[i];
        if (l === null || l === undefined || l === '') continue;
        let list = byName.get(l);
        if (!list) { list = []; byName.set(l, list); }
        list.push(i);
    }
    return [...byName.entries()]
        .filter(([, indices]) => indices.length > 0)
        .map(([name, indices], k) => ({ name, color: colors[k % colors.length], indices }));
}

/** Paint each group into a custom colour group; returns how many groups and rows were painted. */
export function applyColourGroups(groups: ColourGroup[]): { groups: number; rows: number } {
    const attr = useAttributeStore.getState();
    let nGroups = 0, nRows = 0;
    for (const g of groups) {
        let entry = useAttributeStore.getState().customEntries.find(e => e.name === g.name);
        if (entry) {
            attr.updateCustomEntry(entry.id, { color: g.color, visible: g.visible ?? true });
            attr.removeIndicesFromEntry(entry.id, entry.assignedIndices);
        } else {
            attr.addCustomEntry(createCustomEntry(g.name, g.color, 'circle', 8));
            entry = useAttributeStore.getState().customEntries.find(e => e.name === g.name)!;
            if (g.visible === false) attr.updateCustomEntry(entry.id, { visible: false });
        }
        if (g.indices.length) {
            attr.setActiveEntryId(entry.id);
            attr.paintIndicesToActiveEntry(g.indices);
            nGroups++;
            nRows += g.indices.length;
        }
    }
    attr.setActiveEntryId(null);
    return { groups: nGroups, rows: nRows };
}

/**
 * A label for every dataset row from a model's per-row result: `rows[j]` is
 * the dataset row of the j-th value the model was given and `assigned[j]` its
 * group (or null). Rows the model was not given (hidden, sampled out) or could
 * not assign (missing values) stay blank.
 */
export function assignmentLabels(rowCount: number, rows: ArrayLike<number>, assigned: ArrayLike<number | null>, names: (k: number) => string): string[] {
    const out = new Array<string>(rowCount).fill('');
    for (let j = 0; j < rows.length && j < assigned.length; j++) {
        const k = assigned[j];
        const r = rows[j];
        if (k !== null && k !== undefined && r >= 0 && r < rowCount) out[r] = names(k);
    }
    return out;
}
