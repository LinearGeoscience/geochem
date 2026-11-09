/**
 * Data Doctor (Data > Data Doctor): find the values that stop assay
 * columns behaving as numbers and say what to replace them with.
 *
 * Issues per column:
 * - censoredText  "<0.01" / ">10000" left as text      -> -DL / limit (standard convention)
 * - textCodes     "IS", "NS", "LNR", "-" in a numeric column -> missing
 * - missingCodes  -9999, -999, -99 sentinels           -> missing
 * - negatives     below-detection values (-DL)          -> keep (default), missing, ½DL, value
 * - zeros         0 in an assay column                  -> missing / value
 * - units         element in % or ppb beside ppm columns -> new <El>_ppm column
 * - halfDL        below detection supplied as ½DL ("<10" -> 5) -> -DL (halfDetection.ts)
 *
 * Pure: scanning reads values, applyDoctorFixes returns new arrays.
 */
import { ColumnGeochemMapping } from '../types/associations';
import { isMissingCode, parseCensoredValue } from './censoring';
import { findDuplicateUnitColumns, resolveColumnToPpm } from './calculations/elementColumnResolver';
import { findHalfDlSpikesWithGroups, describeSpike, applyHalfDl, HalfDlSpike } from './halfDetection';

export type IssueKind = 'censoredText' | 'textCodes' | 'missingCodes' | 'negatives' | 'zeros' | 'units' | 'fractions' | 'halfDL' | 'batchScale';

export type FixAction = 'keep' | 'detection' | 'null' | 'halfAbs' | 'value' | 'convert' | 'times100' | 'negDL' | 'negDLSure' | 'scaleBatch';

/** One batch whose values sit orders of magnitude off the other batches */
export interface BatchScale {
    group: string;
    /** Positive values in the batch */
    n: number;
    median: number;
    /** Median of the batch medians */
    reference: number;
    /** median / reference */
    ratio: number;
    /** Power-of-ten factor that brings the batch to the others, when the ratio is close to one */
    factor: number | null;
}

/** A column holding the same measurement in another unit (Cu_pct beside Cu_ppm) */
export interface UnitTwin {
    name: string;
    /** twin value = this column's value x scale */
    scale: number;
}

export interface DoctorIssue {
    column: string;
    kind: IssueKind;
    count: number;
    /** Up to five distinct example values as found */
    examples: string[];
    /** Actions that make sense for this issue, first = default */
    actions: FixAction[];
    /** units: multiply by this to get ppm, and the new column's name */
    toPpm?: number;
    /** halfDL: the ½-DL values found (with their group when scanned per group) */
    spikes?: HalfDlSpike[];
    /** batchScale: the batches off by >= 100x */
    batches?: BatchScale[];
    /** halfDL / batchScale fixes are mirrored onto these same-measurement columns */
    twins?: UnitTwin[];
    unit?: string | null;
    target?: string;
}

export interface DoctorFix {
    column: string;
    kind: IssueKind;
    action: FixAction;
    /** For action 'value' */
    value?: number;
}

export interface DoctorColumn {
    name: string;
    values: ArrayLike<unknown>;
}

export const ISSUE_LABELS: Record<IssueKind, string> = {
    censoredText: '"<" / ">" text',
    textCodes: 'Text codes',
    missingCodes: 'Missing codes (-9999…)',
    negatives: 'Negative (below detection)',
    zeros: 'Zero',
    units: 'Non-ppm unit',
    fractions: 'Fractions in a % column',
    halfDL: '½ detection limit as a value',
    batchScale: 'Batch unit scale (≥ 100× off)',
};

export const ACTION_LABELS: Record<FixAction, string> = {
    keep: 'Leave',
    negDL: '→ <DL (stored as -DL)',
    negDLSure: '→ <DL, clear-cut values only',
    scaleBatch: '× 10ⁿ for those batches',
    detection: '<x → -x, >x → x',
    null: 'Missing (blank)',
    halfAbs: '½ × detection limit',
    value: 'Value…',
    convert: 'New ppm column',
    times100: '× 100 (fraction → %)',
};

const ACTIONS: Record<IssueKind, FixAction[]> = {
    censoredText: ['detection', 'halfAbs', 'null', 'value'],
    textCodes: ['null', 'value', 'keep'],
    missingCodes: ['null', 'keep', 'value'],
    negatives: ['keep', 'halfAbs', 'null', 'value'],
    zeros: ['keep', 'null', 'value'],
    units: ['convert', 'keep'],
    fractions: ['keep', 'times100'],
    halfDL: ['negDL', 'keep'],
    batchScale: ['keep', 'scaleBatch'],
};

/** Batches >= 100x off: positive-value median per group against the median of medians. */
export function findBatchScales(values: ArrayLike<number>, groups: ArrayLike<unknown>, minN = 30): BatchScale[] {
    const byGroup = new Map<string, number[]>();
    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (!(v > 0) || !Number.isFinite(v)) continue;
        const g = groups[i] == null ? '' : String(groups[i]);
        let list = byGroup.get(g);
        if (!list) byGroup.set(g, (list = []));
        list.push(v);
    }
    const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
    const stats = [...byGroup.entries()].filter(([, v]) => v.length >= minN).map(([group, v]) => ({ group, n: v.length, median: med(v) }));
    if (stats.length < 3) return [];
    const reference = med(stats.map(s => s.median));
    const out: BatchScale[] = [];
    for (const st of stats) {
        const ratio = st.median / reference;
        const l = Math.log10(ratio);
        if (Math.abs(l) < 2) continue;
        const k = Math.round(l);
        out.push({ ...st, reference, ratio, factor: Math.abs(l - k) <= Math.log10(2) ? 10 ** -k : null });
    }
    return out.sort((a, b) => Math.abs(Math.log10(b.ratio)) - Math.abs(Math.log10(a.ratio)));
}

const sig = (v: number) => +v.toPrecision(2);

/** "Batch6: median 0.002 vs 0.6 (×1/300)" */
export function describeBatchScale(b: BatchScale): string {
    const r = b.ratio >= 1 ? `×${sig(b.ratio)}` : `×1/${sig(1 / b.ratio)}`;
    return `${b.group || 'blank'}: median ${sig(b.median)} vs ${sig(b.reference)} (${r})`;
}

const CENSORED = /^\s*[<>]\s*=?\s*[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?\s*$/;

type CellKind = 'blank' | 'ok' | 'censoredText' | 'textCode' | 'missingCode' | 'negative' | 'zero';

/** Number in a text cell, or null ("1,234" and "12%" count as numbers) */
function textNumber(s: string): number | null {
    return parseCensoredValue(s);
}

function numberKind(v: number): CellKind {
    if (Number.isNaN(v)) return 'blank';
    if (v < 0 && isMissingCode(v)) return 'missingCode';
    if (v < 0) return 'negative';
    if (v === 0) return 'zero';
    return 'ok';
}

export function classifyCell(v: unknown): CellKind {
    if (v === null || v === undefined) return 'blank';
    if (typeof v === 'number') return numberKind(v);
    const s = String(v).trim();
    if (s === '') return 'blank';
    if (CENSORED.test(s)) return 'censoredText';
    const n = textNumber(s);
    return n === null ? 'textCode' : numberKind(n);
}

/**
 * A text column is numeric with a few codes when at least 30 % of its filled
 * cells are numbers (or "<x") and it has no more than 12 distinct non-numbers.
 * Anything else is a genuine text column (lithology, hole ID) and is skipped.
 */
const MIN_NUMERIC_SHARE = 0.3;
const MAX_CODES = 12;

function unitTarget(column: string, element: string, existing: Set<string>): string {
    let name = `${element}_ppm`;
    if (existing.has(name)) name = `${column}_ppm`;
    let k = 2;
    while (existing.has(name)) name = `${column}_ppm${k++}`;
    return name;
}

/**
 * Scan columns. `mappings` decides which columns are assays: zeros, negatives
 * and units are only reported there (coordinates and scores may be negative).
 */
export function scanColumns(
    columns: DoctorColumn[],
    mappings: ColumnGeochemMapping[],
    allColumnNames: Iterable<string> = columns.map(c => c.name),
    opts: {
        /** Assay method / batch per row: ½-DL values are looked for within each group */
        groups?: ArrayLike<unknown>;
    } = {},
): DoctorIssue[] {
    const issues: DoctorIssue[] = [];
    const existing = new Set(allColumnNames);
    const byName = new Map(mappings.map(m => [m.originalName, m]));

    // Same measurement in two units (Cu_pct beside Cu_ppm): the fixes are made on
    // the preferred column and mirrored; the twin needs no ppm copy.
    const numericCols = new Map(columns.filter(c => c.values instanceof Float64Array).map(c => [c.name, c.values as Float64Array]));
    const twinOf = new Map<string, string>();
    const twinsOf = new Map<string, UnitTwin[]>();
    for (const d of findDuplicateUnitColumns(mappings, n => numericCols.get(n))) {
        const keepF = resolveColumnToPpm(mappings, d.duplicateOf)?.toPpm;
        const twinF = resolveColumnToPpm(mappings, d.column)?.toPpm;
        if (!keepF || !twinF) continue;
        twinOf.set(d.column, d.duplicateOf);
        twinsOf.set(d.duplicateOf, [...(twinsOf.get(d.duplicateOf) ?? []), { name: d.column, scale: keepF / twinF }]);
    }

    // Majority unit of trace elements: only flag % / ppb when ppm dominates
    let ppmCols = 0, otherCols = 0;
    for (const m of mappings) {
        if (m.isExcluded || m.isOxide || m.category === 'majorOxide' || m.category === 'nonGeochemical') continue;
        const r = resolveColumnToPpm(mappings, m.originalName);
        if (!r || r.unitAssumed) continue;
        if (r.toPpm === 1) ppmCols++; else otherCols++;
    }

    for (const { name, values } of columns) {
        const m = byName.get(name);
        const isAssay = !!m && !m.isExcluded && !m.role && m.category !== 'nonGeochemical'
            && !!(m.userOverride ?? m.detectedElement);

        const counts: Record<CellKind, number> = { blank: 0, ok: 0, censoredText: 0, textCode: 0, missingCode: 0, negative: 0, zero: 0 };
        const examples: Partial<Record<CellKind, Set<string>>> = {};
        for (let i = 0; i < values.length; i++) {
            const v = values[i];
            const k = classifyCell(v);
            counts[k]++;
            if (k !== 'ok' && k !== 'blank') {
                const set = (examples[k] ??= new Set());
                if (set.size < 5) set.add(String(v).trim());
            }
        }
        const filled = values.length - counts.blank;
        if (filled === 0) continue;
        const numeric = filled - counts.textCode;
        const distinctCodes = examples.textCode ? countDistinctCodes(values) : 0;
        const numericLike = numeric / filled >= MIN_NUMERIC_SHARE && distinctCodes <= MAX_CODES;
        if (!numericLike) continue;

        const push = (kind: IssueKind, cell: CellKind, extra: Partial<DoctorIssue> = {}) => {
            if (!counts[cell]) return;
            issues.push({ column: name, kind, count: counts[cell], examples: [...(examples[cell] ?? [])], actions: ACTIONS[kind], ...extra });
        };
        // A "%" column of mineral or other non-assay values that never exceeds 1 is
        // most likely a 0-1 proportion (Corescan exports): 4 % is stored as 0.04
        const pctName = /(_|\s|\()?(pct|percent|%)\)?$/i.test(name) || m?.detectedUnit === 'pct';
        const elementOrOxide = !!m && !m.isExcluded && (m.isOxide || !!(m.userOverride ?? m.detectedElement));
        if (pctName && !elementOrOxide) {
            let max = -Infinity, positive = 0, n = 0;
            for (let i = 0; i < values.length; i++) {
                const v = values[i];
                const x = typeof v === 'number' ? v : classifyCell(v) === 'ok' ? textNumber(String(v)) : null;
                if (x === null || !Number.isFinite(x)) continue;
                n++;
                if (x > 0) positive++;
                if (x > max) max = x;
            }
            if (positive >= 10 && max <= 1) {
                issues.push({ column: name, kind: 'fractions', count: n, examples: [`max ${+max.toPrecision(3)}`], actions: ACTIONS.fractions });
            }
        }

        push('censoredText', 'censoredText');
        push('textCodes', 'textCode');
        push('missingCodes', 'missingCode');
        if (isAssay) {
            push('negatives', 'negative');
            push('zeros', 'zero');
            const twin = twinOf.get(name);
            const twins = twinsOf.get(name);
            const also = twins ? { twins } : {};
            const alsoText = twins ? ` (also ${twins.map(t => t.name).join(', ')})` : '';
            const spikes = twin ? [] : halfDlSpikesOf(values, opts.groups);
            if (spikes.length) {
                // Clear-cut findings are converted by default; uncertain ones (a
                // partly filled gap, or a value that is another finding's limit)
                // only on request
                const high = spikes.filter(sp => sp.confidence === 'high').length;
                const actions: FixAction[] = high === spikes.length ? ['negDL', 'keep'] : high ? ['negDLSure', 'negDL', 'keep'] : ['keep', 'negDL'];
                issues.push({
                    column: name, kind: 'halfDL', count: spikes.reduce((a, sp) => a + sp.count, 0),
                    examples: spikes.slice(0, 5).map((sp, k) => `${describeSpike(sp)}${sp.confidence === 'medium' ? ' ?' : ''}${k === 0 ? alsoText : ''}`),
                    actions, spikes, ...also,
                });
            }
            if (opts.groups && !twin && values instanceof Float64Array) {
                const batches = findBatchScales(values, opts.groups);
                if (batches.length) {
                    const scalable = batches.every(b => b.factor !== null);
                    issues.push({
                        column: name, kind: 'batchScale', count: batches.reduce((a, b) => a + b.n, 0),
                        examples: batches.slice(0, 4).map((b, k) => `${describeBatchScale(b)}${k === 0 ? alsoText : ''}`),
                        actions: scalable ? ['keep', 'scaleBatch'] : ['keep'], batches, ...also,
                    });
                }
            }
            const r = resolveColumnToPpm(mappings, name);
            const trace = m!.category !== 'majorOxide';
            if (r && !twin && !r.unitAssumed && r.toPpm !== 1 && trace && ppmCols > otherCols) {
                const target = unitTarget(name, r.element, existing);
                existing.add(target);
                issues.push({
                    column: name, kind: 'units', count: numeric, examples: [], actions: ACTIONS.units,
                    toPpm: r.toPpm, unit: r.unit, target,
                });
            }
        }
    }
    return issues;
}

function countDistinctCodes(values: ArrayLike<unknown>): number {
    const set = new Set<string>();
    for (let i = 0; i < values.length; i++) {
        if (classifyCell(values[i]) === 'textCode') {
            set.add(String(values[i]).trim().toUpperCase());
            if (set.size > MAX_CODES) break;
        }
    }
    return set.size;
}

function fixNumber(n: number, action: FixAction, value: number | undefined): number | null {
    switch (action) {
        case 'null': return null;
        case 'halfAbs': return Math.abs(n) / 2;
        case 'value': return value ?? null;
        default: return n;
    }
}

export interface ColumnFixResult {
    /** Replacement values (numbers / null), or text when codes were kept */
    values: (number | null | string)[];
    /** True when every remaining value is numeric: store the column as numbers */
    numeric: boolean;
    changed: number;
}

/** Apply the fixes for one column (unit conversion handled by convertToPpm). */
export function applyColumnFixes(values: ArrayLike<unknown>, fixes: DoctorFix[]): ColumnFixResult {
    const actionFor = new Map<IssueKind, DoctorFix>();
    for (const f of fixes) actionFor.set(f.kind, f);
    const pick = (kind: IssueKind) => actionFor.get(kind) ?? { action: 'keep' as FixAction, value: undefined };

    const out: (number | null | string)[] = new Array(values.length);
    let numeric = true;
    let changed = 0;
    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        const k = classifyCell(v);
        let r: number | null | string;
        if (k === 'blank') r = null;
        else if (k === 'textCode') {
            const f = pick('textCodes');
            r = f.action === 'keep' ? String(v).trim() : f.action === 'value' ? (f.value ?? null) : null;
        } else {
            const n = typeof v === 'number' ? v : textNumber(String(v))!;
            if (k === 'censoredText') {
                const f = pick('censoredText');
                // 'keep' on censored text still converts: leaving text would block the column
                r = f.action === 'detection' || f.action === 'keep' ? n : fixNumber(n, f.action, f.value);
                if (f.action === 'halfAbs' && n >= 0) r = n; // ">x": over-limit stays at the limit
            } else if (k === 'missingCode') {
                const f = pick('missingCodes');
                r = fixNumber(n, f.action, f.value);
            } else if (k === 'negative') {
                const f = pick('negatives');
                r = fixNumber(n, f.action, f.value);
            } else if (k === 'zero') {
                const f = pick('zeros');
                r = fixNumber(n, f.action, f.value);
            } else r = n;
        }
        if (typeof r === 'number' && pick('fractions').action === 'times100') r = +(r * 100).toPrecision(12);
        if (typeof r === 'string') numeric = false;
        if (!sameValue(v, r)) changed++;
        out[i] = r;
    }
    return { values: out, numeric, changed };
}

function sameValue(a: unknown, b: number | null | string): boolean {
    if (b === null) return a === null || a === undefined || a === '' || (typeof a === 'number' && Number.isNaN(a));
    if (typeof a === 'number' && typeof b === 'number') return a === b;
    return a === b;
}

/** Values in ppm for a units fix: below-detection markers scale with the value. */
export function convertToPpm(values: ArrayLike<unknown>, toPpm: number): (number | null)[] {
    const out: (number | null)[] = new Array(values.length);
    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        const n = typeof v === 'number' ? v : v === null || v === undefined ? null : textNumber(String(v));
        out[i] = n === null || Number.isNaN(n) || isMissingCode(n) ? null : +(n * toPpm).toPrecision(12);
    }
    return out;
}

/** ½-DL spikes of a numeric column (whole column, or per group). */
function halfDlSpikesOf(values: ArrayLike<unknown>, groups?: ArrayLike<unknown>): HalfDlSpike[] {
    if (!(values instanceof Float64Array)) return [];
    return findHalfDlSpikesWithGroups(values, groups);
}

/**
 * Apply a halfDL issue: ½-DL values become -DL (only in the group each
 * value was found in). Run before the column's other fixes.
 */
export function applyHalfDlIssue(
    values: ArrayLike<unknown>,
    issue: DoctorIssue,
    groups?: ArrayLike<unknown>,
    opts: { sureOnly?: boolean; scale?: number } = {},
): { values: Float64Array; changed: number } | null {
    if (!(values instanceof Float64Array) || !issue.spikes?.length) return null;
    const scale = opts.scale ?? 1;
    const spikes = issue.spikes
        .filter(sp => !opts.sureOnly || sp.confidence === 'high')
        .map(sp => (scale === 1 ? sp : { ...sp, value: +(sp.value * scale).toPrecision(12), dl: +(sp.dl * scale).toPrecision(12) }));
    return applyHalfDl(values, spikes, groups);
}

/** Apply a batchScale issue: rows of the flagged batches x their power-of-ten factor. */
export function applyBatchScaleIssue(values: ArrayLike<unknown>, issue: DoctorIssue, groups: ArrayLike<unknown>): { values: Float64Array; changed: number } | null {
    if (!(values instanceof Float64Array) || !issue.batches?.length) return null;
    const factor = new Map(issue.batches.filter(b => b.factor !== null).map(b => [b.group, b.factor!]));
    const out = Float64Array.from(values);
    let changed = 0;
    for (let i = 0; i < out.length; i++) {
        const f = factor.get(groups[i] == null ? '' : String(groups[i]));
        if (f === undefined || !Number.isFinite(out[i]) || out[i] === 0) continue;
        out[i] = +(out[i] * f).toPrecision(12);
        changed++;
    }
    return { values: out, changed };
}
