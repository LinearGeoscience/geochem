/**
 * Element QC table: which elements of a dataset can be trusted?
 *
 * For each element column (raw stored values: negative = below detection,
 * the standard convention) with an optional 1-sigma error column:
 *   - % detected, median and 95th percentile of detected values
 *   - median relative 1-sigma error (error / value, detected values only),
 *     a precision measure straight from the instrument's counting statistics
 * and a suggested tier:
 *   - reject:   on the artefact list, or detected in too few samples
 *   - care:     often censored, imprecise, or on the "care" list
 *   - reliable: otherwise
 * All thresholds and lists are the user's to change: the tier is a starting
 * point, not a verdict. The artefact list starts empty (which elements an
 * instrument reports falsely depends on the instrument, its calibration and
 * the matrix); the care list starts with the light elements, whose X-rays are
 * absorbed by a bag, film or air path in any handheld XRF reading.
 *
 * The same pass gives a detection and precision summary: % above zero, % zero,
 * % below detection (negative), the smallest positive value and the median
 * signal-to-noise (value / 1-sigma error).
 */
import { medianOf, quantileLinear } from './statistics/random';

export type QcTier = 'reliable' | 'care' | 'reject';

export interface ElementQcRules {
    /** Below this % detected: reject */
    rejectBelowPct: number;
    /** Below this % detected: care */
    careBelowPct: number;
    /** Median relative 1-sigma error above this %: care */
    careAboveErrorPct: number;
    /** Elements always rejected (spectral artefacts) */
    artefacts: string[];
    /** Elements always at least "care" (light elements, possible contaminants) */
    careList: string[];
}

/** Starting rules for handheld XRF: no artefact list, the light elements on the care list */
export const PXRF_QC_DEFAULTS: ElementQcRules = {
    rejectBelowPct: 15,
    careBelowPct: 80,
    careAboveErrorPct: 25,
    artefacts: [],
    careList: ['Mg', 'Al', 'Si', 'P', 'S'],
};

export interface ElementQcRow {
    element: string;
    column: string;
    n: number;
    nDetected: number;
    /** % of values above zero (detected) */
    pctDetected: number;
    /** % of values exactly zero (some instruments write 0 below detection) */
    pctZero: number;
    /** % of values below zero (stored below detection) */
    pctBelow: number;
    /** Smallest value above zero (NaN when none) */
    minPositive: number;
    medianDetected: number;
    p95Detected: number;
    maxDetected: number;
    /** Median of 100 x error / value over detected values; NaN without an error column */
    medianRelErrPct: number;
    /** Median of value / error over detected values (signal-to-noise); NaN without an error column */
    medianSnr: number;
    tier: QcTier;
    reasons: string[];
}

/**
 * Each element's error column, from the Chemistry mappings: a column whose
 * mapping names the element it is the error of (pairedElement: an
 * instrument's "<El> Error (1sigma)", "<El>_err"). Only columns in
 * `available` (numeric, loaded) count; the first such column wins.
 */
export function pairedErrorColumns(
    mappings: ReadonlyArray<{ originalName: string; pairedElement?: string }>,
    available: ReadonlySet<string>,
): Map<string, string> {
    const out = new Map<string, string>();
    for (const m of mappings) {
        if (m.pairedElement && available.has(m.originalName) && !out.has(m.pairedElement)) out.set(m.pairedElement, m.originalName);
    }
    return out;
}

/** Detection and precision summary as CSV text (one row per element column; blank where not known). */
export function detectionSummaryCsv(rows: ElementQcRow[], errorColumns: ReadonlyMap<string, string> = new Map()): string {
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const f = (x: number, d: number) => (Number.isFinite(x) ? x.toFixed(d) : '');
    const g = (x: number) => (Number.isFinite(x) ? String(+x.toPrecision(6)) : '');
    const head = ['Column', 'Element', 'Values', '% above 0', '% zero', '% below detection', 'Smallest positive',
        'Median relative 1-sigma error %', 'Median signal-to-noise', 'Error column'];
    const lines = [head.map(q).join(',')];
    for (const r of rows) {
        lines.push([q(r.column), q(r.element), String(r.n), f(r.pctDetected, 1), f(r.pctZero, 1), f(r.pctBelow, 1),
            g(r.minPositive), f(r.medianRelErrPct, 1), f(r.medianSnr, 1), q(errorColumns.get(r.element) ?? '')].join(','));
    }
    return lines.join('\r\n') + '\r\n';
}

export interface ElementQcInput {
    element: string;
    column: string;
    raw: ArrayLike<number>;
    error?: ArrayLike<number> | null;
}

export function elementQc(inputs: ElementQcInput[], rules: ElementQcRules = PXRF_QC_DEFAULTS): ElementQcRow[] {
    return inputs.map(({ element, column, raw, error }) => {
        const det: number[] = [];
        const rel: number[] = [];
        const snr: number[] = [];
        let n = 0, zero = 0, below = 0;
        for (let i = 0; i < raw.length; i++) {
            const v = raw[i];
            if (!Number.isFinite(v)) continue;
            n++;
            if (v === 0) zero++;
            else if (v < 0) below++;
            if (v > 0) {
                det.push(v);
                const e = error ? error[i] : NaN;
                if (Number.isFinite(e)) rel.push((100 * e) / v);
                if (Number.isFinite(e) && e > 0) snr.push(v / e);
            }
        }
        const pct = n ? (100 * det.length) / n : 0;
        const relErr = rel.length ? medianOf(rel) : NaN;
        const reasons: string[] = [];
        let tier: QcTier = 'reliable';
        if (rules.artefacts.includes(element)) { tier = 'reject'; reasons.push('on the artefact list'); }
        else if (pct < rules.rejectBelowPct) { tier = 'reject'; reasons.push(`detected in only ${pct.toFixed(0)}%`); }
        else {
            if (pct < rules.careBelowPct) reasons.push(`${pct.toFixed(0)}% detected`);
            if (relErr > rules.careAboveErrorPct) reasons.push(`median 1σ error ${relErr.toFixed(0)}%`);
            if (rules.careList.includes(element)) reasons.push('on the care list');
            if (reasons.length) tier = 'care';
            else reasons.push(`${pct.toFixed(0)}% detected${Number.isFinite(relErr) ? `, median error ${relErr.toFixed(0)}%` : ''}`);
        }
        return {
            element, column, n, nDetected: det.length, pctDetected: pct,
            pctZero: n ? (100 * zero) / n : 0, pctBelow: n ? (100 * below) / n : 0,
            minPositive: det.length ? Math.min(...det) : NaN,
            medianSnr: snr.length ? medianOf(snr) : NaN,
            medianDetected: det.length ? medianOf(det) : NaN,
            p95Detected: det.length ? quantileLinear(det, 0.95) : NaN,
            maxDetected: det.length ? Math.max(...det) : NaN,
            medianRelErrPct: relErr, tier, reasons,
        };
    });
}
