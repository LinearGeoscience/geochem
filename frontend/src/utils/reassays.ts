/**
 * Over-limit (ore-grade) re-assays.
 *
 * A sample above an assay's upper limit is re-assayed by an ore-grade method
 * (lab codes ending OG / OL, "over limit", "re-assay"). Exports then hold two
 * rows for the sample: the base suite with the capped value (">10000" stored
 * at the limit) and the re-assay row with the true grade but few elements.
 *
 * Two problems follow, both silent:
 *  - the base row keeps the capped value, so grades are under-stated;
 *  - samples that exist ONLY as a re-assay row are missing their base suite
 *    (the export dropped it), so every other element is absent for exactly
 *    the most mineralised samples.
 *
 * scanReassays finds both; mergeReassays writes the re-assay grade into the
 * base row where the base value is missing or capped.
 */

const REASSAY_CODE = /(?:OG|OL)\d*$|ore[\s_-]?grade|over[\s_-]?(?:limit|range)|re[\s_-]?assay/i;

/** Method codes that look like over-limit re-assays. */
export function detectReassayMethods(methods: ArrayLike<unknown>): string[] {
    const seen = new Set<string>();
    for (let i = 0; i < methods.length; i++) {
        const v = methods[i];
        if (v === null || v === undefined || v === '') continue;
        const s = String(v).trim();
        if (!seen.has(s) && REASSAY_CODE.test(s)) seen.add(s);
    }
    return [...seen].sort();
}

/** Columns whose name suggests an assay method / lab code. */
export function methodColumnCandidates(columns: { name: string; type: string }[]): string[] {
    return columns.filter(c => /method|lab.?code|scheme|procedure|technique|assay.?type/i.test(c.name) && c.type !== 'numeric' && c.type !== 'float').map(c => c.name);
}

export interface ReassayInput {
    ids: ArrayLike<unknown>;
    methods: ArrayLike<unknown>;
    reassayMethods: string[];
    /** Optional hole id per row, for the orphan summary */
    holes?: ArrayLike<unknown>;
    /** Element columns: raw values (negative = below detection) */
    elements: Record<string, ArrayLike<number>>;
}

export interface ReassayScan {
    reassayRows: number;
    /** Re-assay rows whose sample also has a base row */
    paired: number;
    /** Re-assay rows with no base row: the sample's other elements are missing */
    orphans: number;
    orphanRows: number[];
    orphansByHole: [string, number][];
    /** Per element: base cells the re-assay would fill (missing) or raise (capped) */
    mergeable: { column: string; missing: number; capped: number }[];
    /** Base row index per paired re-assay row */
    pairs: [reassayRow: number, baseRow: number][];
}

const key = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const finitePositive = (x: number) => Number.isFinite(x) && x > 0;

/** Highest base-row value of a column: the upper limit when values were capped. */
function capOf(values: ArrayLike<number>, isBase: (i: number) => boolean): number {
    let max = -Infinity;
    for (let i = 0; i < values.length; i++) if (isBase(i) && Number.isFinite(values[i]) && values[i] > max) max = values[i];
    return max;
}

/** Base cell to replace with the re-assay value r? Missing, or at the cap and below r. */
function replaceKind(base: number, r: number, cap: number): 'missing' | 'capped' | null {
    if (!finitePositive(r)) return null;
    if (!Number.isFinite(base)) return 'missing';
    if (base > 0 && r > base && base >= cap * 0.999) return 'capped';
    return null;
}

export function scanReassays(input: ReassayInput): ReassayScan {
    const { ids, methods, holes, elements } = input;
    const re = new Set(input.reassayMethods);
    const n = ids.length;
    const isRe = (i: number) => re.has(key(methods[i]));
    const baseOf = new Map<string, number>();
    for (let i = 0; i < n; i++) {
        const id = key(ids[i]);
        if (id && !isRe(i) && !baseOf.has(id)) baseOf.set(id, i);
    }
    let reassayRows = 0;
    const pairs: [number, number][] = [];
    const orphanRows: number[] = [];
    const byHole = new Map<string, number>();
    for (let i = 0; i < n; i++) {
        if (!isRe(i)) continue;
        reassayRows++;
        const b = baseOf.get(key(ids[i]));
        if (b !== undefined) pairs.push([i, b]);
        else {
            orphanRows.push(i);
            const h = holes ? key(holes[i]) || '(no hole)' : '(all)';
            byHole.set(h, (byHole.get(h) ?? 0) + 1);
        }
    }
    const mergeable: ReassayScan['mergeable'] = [];
    for (const [column, values] of Object.entries(elements)) {
        const cap = capOf(values, i => !isRe(i));
        let missing = 0, capped = 0;
        for (const [r, b] of pairs) {
            const k = replaceKind(values[b], values[r], cap);
            if (k === 'missing') missing++; else if (k === 'capped') capped++;
        }
        if (missing || capped) mergeable.push({ column, missing, capped });
    }
    return {
        reassayRows, paired: pairs.length, orphans: orphanRows.length, orphanRows,
        orphansByHole: [...byHole].sort((a, b) => b[1] - a[1]), mergeable, pairs,
    };
}

/** New values for each element column with re-assay grades merged into the base rows. */
export function mergeReassays(input: ReassayInput, scan: ReassayScan): { columns: Record<string, Float64Array>; cells: number } {
    const re = new Set(input.reassayMethods);
    const isRe = (i: number) => re.has(key(input.methods[i]));
    const out: Record<string, Float64Array> = {};
    let cells = 0;
    for (const { column } of scan.mergeable) {
        const values = input.elements[column];
        const cap = capOf(values, i => !isRe(i));
        const next = Float64Array.from(values as ArrayLike<number>);
        for (const [r, b] of scan.pairs) {
            if (replaceKind(values[b], values[r], cap)) { next[b] = values[r]; cells++; }
        }
        out[column] = next;
    }
    return { columns: out, cells };
}

/** Per-row status: base, merged re-assay, or a re-assay with no base row. */
export function reassayStatus(n: number, scan: ReassayScan): string[] {
    const out = new Array<string>(n).fill('Base analysis');
    for (const [r] of scan.pairs) out[r] = 'Re-assay (base row present)';
    for (const r of scan.orphanRows) out[r] = 'Re-assay only (base suite missing)';
    return out;
}
