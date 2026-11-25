/**
 * The rows an analysis runs on: every display row, or only those the
 * Attribute Manager shows. `rowIndices` maps each returned row back to its
 * dataset row (display rows are a sample when the dataset is sampled).
 */
export function analysisRows<T>(
    rows: T[],
    displayIndices: number[] | null,
    visible: ArrayLike<boolean> | null,
    visibleOnly: boolean,
): { rows: T[]; rowIndices: number[] | null } {
    if (!visibleOnly || !visible) return { rows, rowIndices: displayIndices };
    const out: T[] = [];
    const idx: number[] = [];
    for (let i = 0; i < rows.length; i++) {
        if (!visible[i]) continue;
        out.push(rows[i]);
        idx.push(displayIndices ? displayIndices[i] : i);
    }
    return { rows: out, rowIndices: idx };
}
