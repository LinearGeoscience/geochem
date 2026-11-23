/**
 * Coverage of a candidate composition: logratio tools use only rows with a
 * value for EVERY selected part, so each extra patchy element costs rows.
 */
export interface CompositionCoverage {
    rowCount: number;
    /** Fraction of rows with a finite value, per column */
    coverage: Map<string, number>;
    /** Rows with a value for every selected column */
    complete: number;
    /** Per selected column: rows won back by deselecting it */
    gainIfRemoved: Map<string, number>;
}

export function compositionCoverage(
    getCol: (name: string) => ArrayLike<number> | undefined,
    rowCount: number,
    columns: string[],
    selected: string[],
): CompositionCoverage {
    const coverage = new Map<string, number>();
    for (const c of columns) {
        const v = getCol(c);
        let n = 0;
        if (v) for (let i = 0; i < rowCount; i++) if (Number.isFinite(v[i])) n++;
        coverage.set(c, rowCount ? n / rowCount : 0);
    }

    const sel = selected.map(c => getCol(c));
    // missing[i] = how many selected columns row i lacks; lone[i] = the one it lacks if exactly one
    const missing = new Uint16Array(rowCount);
    const lone = new Int32Array(rowCount).fill(-1);
    sel.forEach((v, j) => {
        for (let i = 0; i < rowCount; i++) {
            if (!v || !Number.isFinite(v[i])) {
                missing[i]++;
                lone[i] = j;
            }
        }
    });
    let complete = 0;
    const gain = new Array(selected.length).fill(0);
    for (let i = 0; i < rowCount; i++) {
        if (missing[i] === 0) complete++;
        else if (missing[i] === 1) gain[lone[i]]++;
    }
    const gainIfRemoved = new Map(selected.map((c, j) => [c, gain[j]]));
    return { rowCount, coverage, complete: selected.length ? complete : 0, gainIfRemoved };
}

/**
 * Coverage below which an element is "patchy": 80% of the median element
 * coverage. (Relative to the median, not the best: ore elements assayed on
 * every row would otherwise make the whole multi-element suite look patchy.)
 */
export function lowCoverageThreshold(coverages: number[]): number {
    if (coverages.length === 0) return 0;
    const s = [...coverages].sort((a, b) => a - b);
    const mid = s.length >> 1;
    const median = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    return 0.8 * median;
}
