/**
 * Pure helpers for the Data view grid (sorting, editability, cell edits).
 */
import { ColumnData, isNumericColumn } from '../../types/columnarData';
import { parseCensoredValue } from '../../utils/censoring';

export interface ColumnMetaLike {
    name: string;
    type: string;
    role: string | null;
    transformationType?: string | null;
    derivation?: unknown;
}

/** Roles of computed columns: their values come from a recipe, not the lab. */
const DERIVED_ROLES = new Set(['Calculated', 'PCA', 'CLR', 'Transformed', 'Recalculated', 'Anhydrous', 'Pathfinder']);

/** Raw (non-derived) columns may be edited in the grid. */
export function isEditableColumn(c: ColumnMetaLike): boolean {
    if (c.derivation) return false;
    if (c.transformationType && c.transformationType !== 'raw') return false;
    if (c.role && DERIVED_ROLES.has(c.role)) return false;
    return true;
}

/** Sort original row indices by a column; missing values always last. */
export function sortRowIndices(indices: number[], col: ColumnData | undefined, dir: 'asc' | 'desc'): number[] {
    if (!col) return indices;
    const sign = dir === 'asc' ? 1 : -1;
    const out = indices.slice();
    if (isNumericColumn(col)) {
        out.sort((a, b) => {
            const va = col[a], vb = col[b];
            const na = Number.isNaN(va), nb = Number.isNaN(vb);
            if (na || nb) return na === nb ? a - b : na ? 1 : -1;
            return (va - vb) * sign || a - b;
        });
    } else {
        out.sort((a, b) => {
            const va = col[a], vb = col[b];
            if (!va || !vb) return !va === !vb ? a - b : !va ? 1 : -1;
            return va.localeCompare(vb, undefined, { numeric: true }) * sign || a - b;
        });
    }
    return out;
}

/**
 * Column values with one cell replaced. Numeric input accepts "<0.01"
 * (stored as -0.01, below detection) and ">x"; blank clears the cell.
 * Returns null when numeric text doesn't parse.
 */
export function applyCellEdit(col: ColumnData, row: number, text: string): (number | string | null)[] | null {
    const values: (number | string | null)[] = Array.from(col as ArrayLike<number | string>);
    if (isNumericColumn(col)) {
        const trimmed = text.trim();
        if (trimmed === '') { values[row] = null; return values; }
        const v = parseCensoredValue(trimmed);
        if (v === null) return null;
        values[row] = v;
    } else {
        values[row] = text;
    }
    return values;
}
