/**
 * Spider diagram helpers:
 * - parse normalisation files (<transformation_mx_c> with
 *   <element name unit><m>value</m><c>offset</c></element>; normalised =
 *   (x - c) / m, element order as in the file)
 * - summary profile per colour group (mean profiles / parametric
 *   summary): centre line and a spread band for each element.
 */
import type { NormalizationValues } from './elementOrdering';
import { unitToPpmFactor } from './calculations/elementColumnResolver';

export interface FileNormalization extends NormalizationValues {
    /** Element order of the file (spider x axis) */
    order: string[];
    /** Offsets (c); 0 for plain normalisations */
    offsets?: Record<string, number>;
}

/** Parse every <transformation_mx_c> in a normalisation XML. */
export function parseInteropNormalization(xml: string, fallbackName = 'Imported'): FileNormalization[] {
    // Files may hold one bare element or several without a root: wrap them
    const doc = new DOMParser().parseFromString(`<root>${xml.replace(/<\?xml[^>]*\?>/, '')}</root>`, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Not a valid XML file');
    const blocks = Array.from(doc.getElementsByTagName('transformation_mx_c'));
    if (!blocks.length) throw new Error('No <transformation_mx_c> normalisation found');
    return blocks.map((b, k) => {
        const name = b.getAttribute('name')?.trim() || (blocks.length > 1 ? `${fallbackName} ${k + 1}` : fallbackName);
        const reference = b.getElementsByTagName('Reference')[0]?.textContent?.trim() ?? '';
        const values: Record<string, number> = {};
        const offsets: Record<string, number> = {};
        const order: string[] = [];
        for (const el of Array.from(b.getElementsByTagName('element'))) {
            const symbol = el.getAttribute('name')?.trim();
            const m = parseFloat(el.getElementsByTagName('m')[0]?.textContent ?? '');
            const c = parseFloat(el.getElementsByTagName('c')[0]?.textContent ?? '0');
            if (!symbol || !Number.isFinite(m) || m === 0) continue;
            // Store in ppm: our columns are converted to ppm before dividing
            const toPpm = unitToPpmFactor(el.getAttribute('unit')) ?? 1;
            values[symbol] = m * toPpm;
            if (Number.isFinite(c) && c !== 0) offsets[symbol] = c * toPpm;
            if (!order.includes(symbol)) order.push(symbol);
        }
        if (!order.length) throw new Error(`"${name}" has no elements`);
        return {
            id: `file:${name}`,
            name,
            reference: reference || 'Imported normalisation',
            values,
            order,
            ...(Object.keys(offsets).length ? { offsets } : {}),
        };
    });
}

export type ProfileStat = 'mean' | 'median' | 'geomean';

export interface GroupProfile {
    group: string;
    n: number;
    centre: (number | null)[];
    /** Band: mean ± 1 SD (geometric for geomean), or 25th-75th percentile for median */
    lo: (number | null)[];
    hi: (number | null)[];
}

function quantile(sorted: number[], q: number): number {
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Summary profile per group. `value(row, k)` gives the (normalised) value of
 * element k for a row, or null.
 */
export function groupProfiles(
    groups: Map<string, number[]>,
    nElements: number,
    value: (row: number, k: number) => number | null,
    stat: ProfileStat = 'mean',
): GroupProfile[] {
    const out: GroupProfile[] = [];
    for (const [group, rows] of groups) {
        const centre: (number | null)[] = [], lo: (number | null)[] = [], hi: (number | null)[] = [];
        for (let k = 0; k < nElements; k++) {
            const v: number[] = [];
            for (const r of rows) {
                const x = value(r, k);
                if (x !== null && Number.isFinite(x) && (stat !== 'geomean' || x > 0)) v.push(x);
            }
            if (!v.length) { centre.push(null); lo.push(null); hi.push(null); continue; }
            if (stat === 'median') {
                v.sort((a, b) => a - b);
                centre.push(quantile(v, 0.5)); lo.push(quantile(v, 0.25)); hi.push(quantile(v, 0.75));
            } else if (stat === 'geomean') {
                const logs = v.map(Math.log10);
                const m = logs.reduce((a, b) => a + b, 0) / logs.length;
                const sd = logs.length > 1 ? Math.sqrt(logs.reduce((a, b) => a + (b - m) ** 2, 0) / (logs.length - 1)) : 0;
                centre.push(10 ** m); lo.push(10 ** (m - sd)); hi.push(10 ** (m + sd));
            } else {
                const m = v.reduce((a, b) => a + b, 0) / v.length;
                const sd = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1)) : 0;
                centre.push(m); lo.push(m - sd); hi.push(m + sd);
            }
        }
        out.push({ group, n: rows.length, centre, lo, hi });
    }
    return out;
}
