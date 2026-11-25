/**
 * Join a second table onto the dataset by a key column (a left join: every
 * dataset row is kept; rows of the other table without a match are listed).
 *
 * Typical use: assays or another instrument's readings keyed by sample ID.
 * Keys are compared as trimmed text, optionally ignoring case, so "S001" in
 * one file matches "S001 " in the other; numeric-looking keys are NOT
 * reformatted ("0012" stays "0012").
 *
 * The other table can be filtered first (e.g. leave out QC rows, or keep IDs
 * that start with a prefix). Duplicate keys in the other table (lab repeats,
 * re-reads) are reported; the rule chooses what is used:
 *   first / last  that row
 *   mean          per column, the mean of the repeats when every non-blank
 *                 value is a number; otherwise (text, "<LOD") the first
 *                 non-blank value, counted in `notAveraged`
 *   skip          the dataset row is left blank (ambiguous)
 *   error         nothing is joined while a key repeats (`blocked`)
 */

export type JoinFilterOp = 'equals' | 'not-equals' | 'starts-with' | 'not-starts-with' | 'contains' | 'blank' | 'not-blank';

export interface JoinFilter {
    column: string;
    op: JoinFilterOp;
    value?: string;
}

export type DuplicateRule = 'first' | 'last' | 'mean' | 'skip' | 'error';

export interface JoinOptions {
    /** Columns of the other table to bring across */
    columns: string[];
    filters?: JoinFilter[];
    duplicates?: DuplicateRule;
    ignoreCase?: boolean;
}

export interface JoinResult {
    /** Per brought column: one value per dataset row (null = no match) */
    values: Record<string, unknown[]>;
    /** Dataset rows that found a match */
    matched: number;
    /** Dataset rows with a key but no match */
    unmatchedLeft: number;
    /** Dataset rows with a blank key */
    blankLeftKeys: number;
    /** Keys of the (filtered) other table that matched no dataset row */
    unmatchedRight: string[];
    /** Keys occurring more than once in the (filtered) other table */
    duplicateKeys: string[];
    /** Rows of the other table kept by the filters */
    rightRowsUsed: number;
    rightRowsFiltered: number;
    /** Dataset rows without a match (no key, no matching key, or left blank as ambiguous), ascending */
    unmatchedRows: number[];
    /** Rule 'error' with repeated keys: nothing joined */
    blocked: boolean;
    /** Rule 'mean': cells taken from the first repeat because a repeat was not a number */
    notAveraged: number;
}

/** A cell as a number: numbers, and text that is a plain number ("1,234" too). */
function asNumber(v: unknown): number | null {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v !== 'string') return null;
    const t = v.trim().replace(/,/g, '');
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
}

const isBlank = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

export function passesFilter(row: Record<string, unknown>, f: JoinFilter): boolean {
    const v = text(row[f.column]);
    const want = (f.value ?? '').trim();
    const lv = v.toLowerCase(), lw = want.toLowerCase();
    switch (f.op) {
        case 'equals': return lv === lw;
        case 'not-equals': return lv !== lw;
        case 'starts-with': return lv.startsWith(lw);
        case 'not-starts-with': return !lv.startsWith(lw);
        case 'contains': return lv.includes(lw);
        case 'blank': return v === '';
        case 'not-blank': return v !== '';
        default: return true;
    }
}

export function joinOnKey(
    leftKeys: ArrayLike<unknown>,
    rightRows: Record<string, unknown>[],
    rightKey: string,
    opts: JoinOptions,
): JoinResult {
    const norm = (v: unknown) => { const t = text(v); return opts.ignoreCase ? t.toLowerCase() : t; };
    const filters = opts.filters ?? [];
    const rule = opts.duplicates ?? 'first';

    const kept = rightRows.filter(r => filters.every(f => passesFilter(r, f)));
    const byKey = new Map<string, Record<string, unknown>[]>();
    for (const r of kept) {
        const k = norm(r[rightKey]);
        if (k === '') continue;
        const list = byKey.get(k);
        if (list) list.push(r); else byKey.set(k, [r]);
    }
    const duplicateKeys = [...byKey.entries()].filter(([, l]) => l.length > 1).map(([k]) => k);

    const n = leftKeys.length;
    const blocked = rule === 'error' && duplicateKeys.length > 0;
    const values: Record<string, unknown[]> = {};
    for (const c of opts.columns) values[c] = new Array(n).fill(null);
    const usedRight = new Set<string>();
    const unmatchedRows: number[] = [];
    let matched = 0, unmatchedLeft = 0, blankLeftKeys = 0, notAveraged = 0;
    // The values a key contributes, worked out once per key
    const merged = new Map<string, Record<string, unknown>>();
    const valuesFor = (k: string, list: Record<string, unknown>[]): Record<string, unknown> => {
        let m = merged.get(k);
        if (m) return m;
        m = {};
        if (list.length === 1 || rule !== 'mean') {
            const r = rule === 'last' ? list[list.length - 1] : list[0];
            for (const c of opts.columns) m[c] = isBlank(r[c]) ? null : r[c];
        } else {
            for (const c of opts.columns) {
                const cells = list.map(r => r[c]).filter(v => !isBlank(v));
                const nums = cells.map(asNumber);
                if (cells.length && nums.every(x => x !== null)) {
                    m[c] = (nums as number[]).reduce((a, b) => a + b, 0) / nums.length;
                } else {
                    m[c] = cells.length ? cells[0] : null;
                    if (cells.length > 1) notAveraged++;
                }
            }
        }
        merged.set(k, m);
        return m;
    };
    for (let i = 0; i < n; i++) {
        const k = norm(leftKeys[i]);
        if (k === '') { blankLeftKeys++; unmatchedRows.push(i); continue; }
        const list = byKey.get(k);
        if (!list) { unmatchedLeft++; unmatchedRows.push(i); continue; }
        usedRight.add(k);
        if (blocked || (list.length > 1 && rule === 'skip')) { unmatchedLeft++; unmatchedRows.push(i); continue; }
        matched++;
        const m = valuesFor(k, list);
        for (const c of opts.columns) values[c][i] = m[c];
    }
    const unmatchedRight = [...byKey.keys()].filter(k => !usedRight.has(k));
    return {
        values, matched, unmatchedLeft, blankLeftKeys, unmatchedRight, duplicateKeys,
        rightRowsUsed: kept.length, rightRowsFiltered: rightRows.length - kept.length,
        unmatchedRows, blocked, notAveraged,
    };
}

/**
 * Should a brought-across column be stored as numbers? True when at least
 * 80% of its non-blank values parse as numbers (the same rule the importer
 * uses). Columns with below-detection text stay text (convert them with the
 * below-LOD text tool).
 */
export function isMostlyNumeric(values: ArrayLike<unknown>): boolean {
    let num = 0, all = 0;
    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (v === null || v === undefined) continue;
        const s = String(v).trim();
        if (s === '') continue;
        all++;
        if (Number.isFinite(Number(s.replace(/,/g, '')))) num++;
    }
    return all > 0 && num / all >= 0.8;
}
