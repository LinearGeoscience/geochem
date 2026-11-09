/**
 * Grouping helpers for treating mixed surveys: combined labels from several
 * text columns (medium x protocol) and the suggestion of a sample-medium
 * column (soil / stream / rock chip) to make protocol groups within.
 */

/** Text of one grouping value; blank -> '(blank)' */
export const groupText = (v: unknown) => (v == null || String(v).trim() === '' ? '(blank)' : String(v).trim());

/** Per-row labels joining several columns ("SOIL · P1 · 26 el"); one column passes through. */
export function combineLabels(cols: ArrayLike<unknown>[], sep = ' · '): string[] {
    if (!cols.length) return [];
    const n = cols[0].length;
    const out = new Array<string>(n);
    for (let i = 0; i < n; i++) {
        let s = groupText(cols[0][i]);
        for (let k = 1; k < cols.length; k++) s += sep + groupText(cols[k][i]);
        out[i] = s;
    }
    return out;
}

export interface StratumColumnOption { name: string; groups: number; score: number }

/** Name score: sample type / medium 3, material / matrix 2, other '...type' 1 */
function stratumNameScore(name: string): number {
    const n = name.toLowerCase().replace(/[^a-z]/g, '');
    if (/sampletype|sampmedium|samplemedium|^medium$|^media$|samplemedia|samptype|^sampletyp/.test(n)) return 3;
    if (/material|matrix|samplemethod|samplingmethod|medium|media/.test(n)) return 2;
    if (/type$|^type|class$/.test(n)) return 1;
    return 0;
}

/**
 * Text columns that could be the sample medium: 2..maxGroups values, each
 * value on several rows; by name score, then fewer values.
 */
export function rankStratumColumns(
    columns: { name: string }[],
    getCol: (name: string) => ArrayLike<unknown> | undefined,
    maxGroups = 30,
): StratumColumnOption[] {
    const out: StratumColumnOption[] = [];
    for (const c of columns) {
        const col = getCol(c.name);
        if (!col || col instanceof Float64Array) continue;
        const seen = new Set<string>();
        for (let i = 0; i < col.length && seen.size <= maxGroups; i++) seen.add(groupText(col[i]));
        if (seen.size >= 2 && seen.size <= maxGroups && seen.size < col.length / 5) {
            out.push({ name: c.name, groups: seen.size, score: stratumNameScore(c.name) });
        }
    }
    return out.sort((a, b) => b.score - a.score || a.groups - b.groups);
}

/** The most likely sample-medium column, or null. */
export function suggestStratumColumn(
    columns: { name: string }[],
    getCol: (name: string) => ArrayLike<unknown> | undefined,
): string | null {
    const best = rankStratumColumns(columns, getCol)[0];
    return best && best.score >= 2 ? best.name : null;
}
