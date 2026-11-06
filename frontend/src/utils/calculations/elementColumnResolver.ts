/**
 * Unit-aware element → column resolution.
 *
 * Datasets often carry the same element in several units (Pb_pct + Pb_ppm,
 * Au_ppm + Au_ppb). Anything that compares values against ppm-based
 * references (normalisation constants, pathfinder thresholds, molar
 * conversions) must pick a column deliberately and convert its values.
 *
 * Policy: prefer a column already in ppm, then any other known unit
 * (converted), and only then a column of unknown unit (assumed ppm).
 */
import { ColumnGeochemMapping } from '../../types/associations';

/** Multiplicative factor converting a value in `unit` to ppm, or null if unknown. */
export function unitToPpmFactor(unit: string | null | undefined): number | null {
    if (!unit) return null;
    switch (unit.toLowerCase()) {
        case 'ppm':
        case 'g/t':
        case 'mg/kg':
        case 'μg/g':
        case 'ug/g':
            return 1;
        case 'ppb':
        case 'ng/g':
        case 'mg/t':
            return 1e-3;
        case 'pct':
        case '%':
        case 'wt%':
        case 'percent':
            return 1e4;
        default:
            return null;
    }
}

export interface ResolvedElementColumn {
    column: string;
    /** Effective unit of the source column (null if unknown) */
    unit: string | null;
    /** Multiply raw column values by this to obtain ppm */
    toPpm: number;
    /** True when the unit was unknown and ppm was assumed */
    unitAssumed: boolean;
}

const effectiveElement = (m: ColumnGeochemMapping) => m.userOverride ?? m.detectedElement;
const effectiveUnit = (m: ColumnGeochemMapping) => m.userUnit ?? m.detectedUnit;

/** Rank: ppm first, then other known units, then unknown. */
function unitRank(m: ColumnGeochemMapping): number {
    const f = unitToPpmFactor(effectiveUnit(m));
    if (f === 1) return 0;
    if (f !== null) return 1;
    return 2;
}

/**
 * Find the best column for `element` (element form, not oxide) and the
 * factor converting it to ppm.
 */
export function resolveElementColumn(
    mappings: ColumnGeochemMapping[],
    element: string,
): ResolvedElementColumn | null {
    const candidates = mappings.filter(m =>
        !m.isExcluded && !m.isOxide && effectiveElement(m) === element);
    if (candidates.length === 0) return null;
    const best = candidates.reduce((a, b) => (unitRank(b) < unitRank(a) ? b : a));
    return toResolved(best);
}

/** Conversion info for a specific column (null if it is not a mapped element column). */
export function resolveColumnToPpm(
    mappings: ColumnGeochemMapping[],
    columnName: string,
): (ResolvedElementColumn & { element: string }) | null {
    const m = mappings.find(x => x.originalName === columnName);
    if (!m || m.isExcluded || m.isOxide) return null;
    const element = effectiveElement(m);
    if (!element) return null;
    return { ...toResolved(m), element };
}

function toResolved(m: ColumnGeochemMapping): ResolvedElementColumn {
    const unit = effectiveUnit(m);
    const f = unitToPpmFactor(unit);
    return { column: m.originalName, unit, toPpm: f ?? 1, unitAssumed: f === null };
}

export interface DuplicateUnitColumn {
    /** The redundant column (non-ppm unit) */
    column: string;
    /** The column it duplicates (preferred unit) */
    duplicateOf: string;
    element: string;
}

/**
 * Find columns that carry the same measurement as another column in a
 * different unit (Pb_pct vs Pb_ppm, Au_ppb vs Au_ppm). Two columns are
 * duplicates when, on rows where both have values, the converted values
 * agree within 5% for at least 95% of rows (allowing for rounding in the
 * coarser unit). The column in the preferred unit (ppm first) is kept.
 */
export function findDuplicateUnitColumns(
    mappings: ColumnGeochemMapping[],
    getColumn: (name: string) => ArrayLike<number> | undefined,
    minOverlap = 10,
): DuplicateUnitColumn[] {
    const byElement = new Map<string, ColumnGeochemMapping[]>();
    for (const m of mappings) {
        const el = effectiveElement(m);
        if (!el || m.isExcluded || m.isOxide) continue;
        if (unitToPpmFactor(effectiveUnit(m)) === null) continue;
        const list = byElement.get(el) ?? [];
        list.push(m);
        byElement.set(el, list);
    }

    const result: DuplicateUnitColumn[] = [];
    for (const [element, cols] of byElement) {
        if (cols.length < 2) continue;
        const ranked = [...cols].sort((a, b) => unitRank(a) - unitRank(b));
        const keep = ranked[0];
        const keepVals = getColumn(keep.originalName);
        const keepF = unitToPpmFactor(effectiveUnit(keep))!;
        if (!keepVals) continue;
        for (const other of ranked.slice(1)) {
            const vals = getColumn(other.originalName);
            const f = unitToPpmFactor(effectiveUnit(other))!;
            if (!vals || f === keepF) continue;
            let overlap = 0;
            let agree = 0;
            for (let i = 0; i < vals.length; i++) {
                const a = keepVals[i] * keepF;
                const b = vals[i] * f;
                if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
                overlap++;
                const scale = Math.max(Math.abs(a), Math.abs(b));
                if (scale === 0 || Math.abs(a - b) <= 0.05 * scale) agree++;
            }
            if (overlap >= minOverlap && agree >= 0.95 * overlap) {
                result.push({ column: other.originalName, duplicateOf: keep.originalName, element });
            }
        }
    }
    return result;
}
