/**
 * Detection limits per group (protocol, batch, medium x protocol) for one
 * assay column, read from the stored values: -DL cells, and clear-cut ½-DL
 * values (halfDetection.ts) in columns not yet converted.
 *
 * A group's "main" limits are those carrying at least max(3, 5 %) of its
 * below-detection rows; rarer ones are stray re-assays. `maxDl` is the
 * coarsest main limit, `strayAbove` counts rows censored at a coarser one.
 *
 * A group may show no limit at all: below-detection results stored as a
 * value (½DL, or the limit itself) that could not be confirmed. If its
 * lowest value is heavily repeated (>= 5 rows and 5 % — a "floor"; up to
 * max(2 rows, 1 %) of stray values may sit below it), that value is the
 * limit or half of it; `assumedDl` takes the reading chosen in
 * `floorAs` (default 'half': limit = 2 x floor, the safe side for a common
 * level). Without a floor the limit is unknown and the caller must say so.
 */
import { cellDl, type DlCount } from './assayProtocols';
import { isMissingCode } from './censoring';
import { groupText } from './groupLabels';
import { findHalfDlSpikesWithGroups, type HalfDlSpike } from './halfDetection';

export interface GroupDl {
    group: string;
    /** Rows in the group */
    n: number;
    /** Rows with a value (measured or below detection) */
    nValues: number;
    /** Rows below detection */
    nBdl: number;
    /** Limits seen, most frequent first */
    dls: DlCount[];
    /** Coarsest main limit (null = no value below detection) */
    maxDl: number | null;
    /** Several main limits */
    mixed: boolean;
    /** Rows censored at a stray limit coarser than maxDl */
    strayAbove: number;
    /** Some limits come from ½-DL values */
    halfDl: boolean;
    /** Lowest value, heavily repeated, in a group that shows no limit */
    floor: { value: number; count: number } | null;
    /** Limit to use: maxDl, else read from the floor (see floorAs), else null (unknown) */
    assumedDl: number | null;
}

/** How to read a floor (repeated lowest value) in a group that shows no limit */
export type FloorReading = 'half' | 'limit';

export type HalfDlRule = Pick<HalfDlSpike, 'value' | 'dl' | 'group'>;

/** Clear-cut ½-DL values of a column, found within the given groups. */
export function clearHalfDl(raw: ArrayLike<number>, groups?: ArrayLike<unknown>): HalfDlRule[] {
    return findHalfDlSpikesWithGroups(raw, groups).filter(s => s.confidence === 'high')
        .map(s => ({ value: s.value, dl: s.dl, group: s.group }));
}

/** Largest positive value: a negative beyond it is not a plausible limit (censoring.ts rule) */
export function maxPositive(raw: ArrayLike<number>): number {
    let m = -Infinity;
    for (let i = 0; i < raw.length; i++) if (raw[i] > m) m = raw[i];
    return m;
}

/**
 * Detection limit of a cell or null (measured value / missing).
 * `group` is the batch-group label the ½-DL rules were found in.
 */
export function cellLimit(v: number, halfDl: HalfDlRule[], group: string | null, maxPos: number): number | null {
    if (!Number.isFinite(v)) return null;
    if (v < 0 && (isMissingCode(v) || (maxPos > 0 && -v > maxPos))) return null;
    return cellDl(v, halfDl.length ? { halfDl } : {}, group);
}

/** A cell that holds a usable value (measured, or below detection) */
export function hasValue(v: number, maxPos: number): boolean {
    if (!Number.isFinite(v)) return false;
    return !(v < 0 && (isMissingCode(v) || (maxPos > 0 && -v > maxPos)));
}

/** Group label as the ½-DL search writes it (halfDetection.ts): String(v), blank '' */
export const halfDlGroupOf = (groups: ArrayLike<unknown> | undefined, i: number): string | null =>
    (groups ? (groups[i] == null ? '' : String(groups[i])) : null);

const sameDl = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(a, b);

/** Lowest heavily repeated value, with at most a few stray values below it */
function findFloor(measured: Map<number, number>, nValues: number): { value: number; count: number } | null {
    const need = Math.max(5, 0.05 * nValues);
    const strays = Math.max(2, 0.01 * nValues);
    let below = 0;
    for (const v of [...measured.keys()].sort((x, y) => x - y)) {
        const c = measured.get(v)!;
        if (c >= need) return { value: v, count: c };
        below += c;
        if (below > strays) return null;
    }
    return null;
}

export function groupDetectionLimits(
    raw: ArrayLike<number>,
    groups: ArrayLike<unknown>,
    opts: { halfDl?: HalfDlRule[]; halfDlGroups?: ArrayLike<unknown>; floorAs?: FloorReading } = {},
): GroupDl[] {
    const floorAs = opts.floorAs ?? 'half';
    const halfDl = opts.halfDl ?? [];
    const maxPos = maxPositive(raw);
    const acc = new Map<string, { n: number; nValues: number; counts: Map<number, number>; half: boolean; measured: Map<number, number> }>();
    for (let i = 0; i < raw.length; i++) {
        const g = groupText(groups[i]);
        let a = acc.get(g);
        if (!a) acc.set(g, (a = { n: 0, nValues: 0, counts: new Map(), half: false, measured: new Map() }));
        a.n++;
        const v = raw[i];
        if (!hasValue(v, maxPos)) continue;
        a.nValues++;
        const dl = cellLimit(v, halfDl, halfDlGroupOf(opts.halfDlGroups, i), maxPos);
        if (dl === null) {
            // Measured value: counted, to find a floor
            if (v > 0) { const k = Number(v.toPrecision(12)); a.measured.set(k, (a.measured.get(k) ?? 0) + 1); }
            continue;
        }
        if (v > 0) a.half = true;
        a.counts.set(dl, (a.counts.get(dl) ?? 0) + 1);
    }
    return [...acc.entries()].map(([group, a]) => {
        const dls = [...a.counts.entries()].map(([dl, count]) => ({ dl, count })).sort((x, y) => y.count - x.count || x.dl - y.dl);
        const nBdl = dls.reduce((s, d) => s + d.count, 0);
        const main = dls.filter(d => d.count >= Math.max(3, 0.05 * nBdl));
        // Very few below-detection rows: they are all the evidence there is
        const usable = main.length ? main : dls;
        const maxDl = usable.length ? Math.max(...usable.map(d => d.dl)) : null;
        const strayAbove = maxDl === null ? 0 : dls.filter(d => d.dl > maxDl && !sameDl(d.dl, maxDl)).reduce((s, d) => s + d.count, 0);
        const floor = maxDl === null ? findFloor(a.measured, a.nValues) : null;
        const assumedDl = maxDl ?? (floor ? (floorAs === 'half' ? 2 * floor.value : floor.value) : null);
        return { group, n: a.n, nValues: a.nValues, nBdl, dls, maxDl, mixed: main.length > 1, strayAbove, halfDl: a.half, floor, assumedDl };
    }).sort((x, y) => y.n - x.n || x.group.localeCompare(y.group));
}
