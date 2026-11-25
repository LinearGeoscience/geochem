/**
 * Below-detection text written by instruments, turned into numbers.
 *
 * Some instruments export a result column with text where the reading was
 * below detection ("<LOD", "<LOD: -1.2", "<DL") and give the reading itself
 * (signed, possibly negative) and/or the detection limit in other columns.
 * The generic import leaves such a column as text. This converts it into:
 *
 *  - `censored`: the standard convention: the value where detected, -LOD
 *    where below detection (so Settings > below-detection substitution
 *    applies), missing where there is no result.
 *  - `signed`: the instrument's own reading for every row with a result,
 *    including below-detection readings (taken from "<LOD: x" text or from
 *    the signed companion column). Unbiased for statistics on low values;
 *    NOT censorable (negative values are real readings here).
 *
 * A blank result is a failed read (no sample, too wet, pouch failure) and is
 * missing in both outputs, even when a companion column holds a number for it:
 * counting failed reads as 0 drags every statistic down.
 */

export interface LodTextOptions {
    /** The instrument's signed reading (e.g. a "(incl <LOD)" column) */
    signed?: ArrayLike<unknown> | null;
    /** The detection limit per row (e.g. an "LOD" column) */
    limit?: ArrayLike<unknown> | null;
}

export interface LodTextCounts {
    rows: number;
    measured: number;
    belowLod: number;
    /** Signed readings below zero (below detection, as the instrument read them) */
    negative: number;
    /** No result: blank cells (failed reads) */
    missing: number;
    /** Text that is neither a number nor a below-detection marker */
    unparsed: number;
    /** Below detection, but no limit for the row: censored value left missing */
    limitUnknown: number;
}

export interface LodTextResult {
    censored: Float64Array;
    signed: Float64Array;
    /** 1 where the row is below detection */
    below: Uint8Array;
    counts: LodTextCounts;
    unparsedExamples: string[];
}

const NUM = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
/** "<LOD", "< LOD: -1.2", "<DL", "<LLD=0.3", "ND", "BDL" */
const LOD_MARKER = new RegExp(`^<\\s*(?:LOD|DL|LLD|MDL|LOQ)\\b\\s*[:=]?\\s*(${NUM})?\\s*$|^(?:ND|BDL|N\\.D\\.)$`, 'i');
/** Classic "<0.5" */
const LESS_THAN = new RegExp(`^<\\s*=?\\s*(${NUM})\\s*$`);

/** A cell as a finite number, or null (blank / text / NaN) */
export function cellNumber(v: unknown): number | null {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const s = String(v).trim().replace(/,/g, '');
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

const isBlank = (v: unknown) =>
    v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v)) || (typeof v === 'string' && v.trim() === '');

export function convertLodText(values: ArrayLike<unknown>, opts: LodTextOptions = {}): LodTextResult {
    const n = values.length;
    const censored = new Float64Array(n).fill(NaN);
    const signed = new Float64Array(n).fill(NaN);
    const below = new Uint8Array(n);
    const counts: LodTextCounts = { rows: n, measured: 0, belowLod: 0, negative: 0, missing: 0, unparsed: 0, limitUnknown: 0 };
    const unparsed = new Set<string>();

    for (let i = 0; i < n; i++) {
        const v = values[i];
        if (isBlank(v)) { counts.missing++; continue; }
        const num = cellNumber(v);
        if (num !== null) {
            counts.measured++;
            signed[i] = num;
            censored[i] = num;
            if (num < 0) counts.negative++;
            continue;
        }
        const s = String(v).trim();
        const marker = LOD_MARKER.exec(s);
        const lessThan = marker ? null : LESS_THAN.exec(s);
        if (!marker && !lessThan) {
            counts.unparsed++;
            if (unparsed.size < 5) unparsed.add(s);
            continue;
        }
        counts.belowLod++;
        below[i] = 1;
        // Signed reading: written in the text, else the companion column
        const inText = marker?.[1] !== undefined ? Number(marker[1]) : null;
        const companion = opts.signed ? cellNumber(opts.signed[i]) : null;
        const reading = inText ?? companion;
        if (reading !== null) {
            signed[i] = reading;
            if (reading < 0) counts.negative++;
        }
        // Detection limit: "<0.5" itself, else the limit column
        const lim = lessThan ? Math.abs(Number(lessThan[1])) : opts.limit ? cellNumber(opts.limit[i]) : null;
        if (lim !== null && lim > 0) censored[i] = -lim;
        else counts.limitUnknown++;
    }
    return { censored, signed, below, counts, unparsedExamples: [...unparsed] };
}

/** True when a text column looks like instrument below-detection text (a quick scan for the dialog) */
export function looksLikeLodText(values: ArrayLike<unknown>): boolean {
    let markers = 0, nums = 0;
    const lim = Math.min(values.length, 5000);
    for (let i = 0; i < lim; i++) {
        const v = values[i];
        if (isBlank(v)) continue;
        if (cellNumber(v) !== null) nums++;
        else if (LOD_MARKER.test(String(v).trim())) markers++;
    }
    return markers > 0 && markers + nums > 0;
}
