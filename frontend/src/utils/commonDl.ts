/**
 * Censor to a common detection limit: make groups analysed with different
 * limits comparable on one scale by treating everything below the coarsest
 * limit as below detection. Rows in the chosen groups:
 *  - measured value < level, or below detection at a limit <= level -> -level
 *  - measured value >= level -> unchanged
 *  - below detection at a limit > level (stray coarse re-assay)    -> NaN:
 *    "below 10" says nothing about "below 5"; counted as `dropped`
 * Rows of other groups -> NaN. The result keeps the -DL convention, so the
 * below-detection setting (½DL, ...) still applies to it.
 */
import { groupText } from './groupLabels';
import { cellLimit, halfDlGroupOf, hasValue, maxPositive, type GroupDl, type HalfDlRule } from './groupDl';

export interface CommonDlResult {
    values: Float64Array;
    /** Measured values that became <level */
    changed: number;
    /** Below-detection values re-stated at <level */
    restated: number;
    /** Values censored at a coarser limit than level (now missing) */
    dropped: number;
    /** Values in rows outside the chosen groups (now missing) */
    excluded: number;
    /** Rows of the chosen groups with a value in the result */
    kept: number;
}

const tol = (level: number) => level * (1 + 1e-9);

/**
 * Smallest level allowed for the chosen groups: their coarsest limit, shown
 * or assumed from a floor (null = no group gives one).
 */
export function defaultCommonLevel(stats: GroupDl[], include: Set<string>): number | null {
    let level: number | null = null;
    for (const s of stats) if (include.has(s.group) && s.assumedDl !== null) level = level === null ? s.assumedDl : Math.max(level, s.assumedDl);
    return level;
}

/** Groups whose (shown or assumed) limit is coarser than `level` (the level is not allowed for them) */
export function groupsAboveLevel(stats: GroupDl[], include: Set<string>, level: number): string[] {
    return stats.filter(s => include.has(s.group) && s.assumedDl !== null && s.assumedDl > tol(level)).map(s => s.group);
}

/** Chosen groups with values but no limit evidence at all (no censored value, no floor) */
export function groupsWithoutLimit(stats: GroupDl[], include: Set<string>): string[] {
    return stats.filter(s => include.has(s.group) && s.nValues > 0 && s.assumedDl === null).map(s => s.group);
}

export function censorToCommonDl(
    raw: ArrayLike<number>,
    groups: ArrayLike<unknown>,
    opts: { include: Set<string>; level: number; halfDl?: HalfDlRule[]; halfDlGroups?: ArrayLike<unknown> },
): CommonDlResult {
    const { include, level } = opts;
    if (!(level > 0)) throw new Error('The common detection limit must be a positive number');
    const halfDl = opts.halfDl ?? [];
    const maxPos = maxPositive(raw);
    const out = new Float64Array(raw.length);
    let changed = 0, restated = 0, dropped = 0, excluded = 0, kept = 0;
    for (let i = 0; i < raw.length; i++) {
        const v = raw[i];
        if (!hasValue(v, maxPos)) { out[i] = NaN; continue; }
        if (!include.has(groupText(groups[i]))) { out[i] = NaN; excluded++; continue; }
        const dl = cellLimit(v, halfDl, halfDlGroupOf(opts.halfDlGroups, i), maxPos);
        if (dl !== null) {
            if (dl <= tol(level)) { out[i] = -level; restated++; kept++; }
            else { out[i] = NaN; dropped++; }
        } else if (v < level) {
            out[i] = -level; changed++; kept++;
        } else {
            out[i] = v; kept++;
        }
    }
    return { values: out, changed, restated, dropped, excluded, kept };
}

/** Column name for the result: Au_ppm -> Au_ppm_cDL0.005 */
export function commonDlColumnName(source: string, level: number): string {
    return `${source}_cDL${+level.toPrecision(3)}`;
}
