/**
 * A grade shell read against samples it was not shown (Phase 270).
 *
 * A shell at a cut-off says "the ground in here is at or above it". Read
 * against assays of holes left out of its making, two questions:
 *
 *  - found: of the metal in the samples at or above the cut-off, the share
 *    the shell holds. (By metal, not by count: a shell that misses a low
 *    sample just over the cut-off has missed little.)
 *  - right: of the metres the shell holds, the share at or above it.
 *
 * and beside them what a domain is judged by: the grade inside it against
 * the grade outside, and the share of all the metal it holds in what share
 * of the metres.
 *
 * Assays are read as composites of one length down each hole (a shell is
 * fitted over composites: a 0.3 m sample of 40 g/t is not 2 m of it), with
 * a top cut where one is given. Both are part of any figure quoted.
 */

/** Assays down holes: a row a sample */
export interface Assays {
    hole: ArrayLike<string | number>;
    from: ArrayLike<number>;
    to: ArrayLike<number>;
    grade: ArrayLike<number>;
}

/** Composites of one length down each hole */
export interface Composites {
    /** The hole (as the assays name it), the depths the composite runs between, and its middle */
    hole: (string | number)[];
    from: number[];
    to: number[];
    /** The sampled metres in it, and their length-weighted grade (top cut applied to the samples first) */
    metres: number[];
    grade: number[];
}

/** A composite counts when this share of its length at least was sampled */
export const COMPOSITE_SAMPLED = 0.5;

/**
 * The assays as composites of `length` m, counted down each hole from its
 * first sample. A sample that straddles two composites is shared between
 * them by length. Ground not sampled is not counted as barren: a composite
 * is the grade of what was sampled in it, and is left out when under half
 * of it was. `topCut`: no sample counts as more than this (null: as assayed).
 */
export function compositeAssays(assays: Assays, length: number, topCut: number | null = null): Composites {
    const out: Composites = { hole: [], from: [], to: [], metres: [], grade: [] };
    if (!(length > 0)) return out;
    const byHole = new Map<string | number, number[]>();
    for (let i = 0; i < assays.hole.length; i++) {
        const from = assays.from[i], to = assays.to[i], grade = assays.grade[i];
        if (!(to > from) || !Number.isFinite(grade)) continue;
        let rows = byHole.get(assays.hole[i]);
        if (!rows) byHole.set(assays.hole[i], rows = []);
        rows.push(i);
    }
    for (const [hole, rows] of byHole) {
        let start = Infinity;
        for (const i of rows) start = Math.min(start, assays.from[i]);
        const metres = new Map<number, number>(), metal = new Map<number, number>();
        for (const i of rows) {
            const grade = topCut === null ? assays.grade[i] : Math.min(assays.grade[i], topCut);
            const first = Math.floor((assays.from[i] - start) / length + 1e-9), last = Math.floor((assays.to[i] - start) / length - 1e-9);
            for (let k = first; k <= last; k++) {
                const part = Math.min(assays.to[i], start + (k + 1) * length) - Math.max(assays.from[i], start + k * length);
                if (!(part > 0)) continue;
                metres.set(k, (metres.get(k) ?? 0) + part);
                metal.set(k, (metal.get(k) ?? 0) + part * grade);
            }
        }
        for (const k of [...metres.keys()].sort((a, b) => a - b)) {
            const m = metres.get(k)!;
            if (m < COMPOSITE_SAMPLED * length) continue;
            out.hole.push(hole);
            out.from.push(start + k * length);
            out.to.push(start + (k + 1) * length);
            out.metres.push(m);
            out.grade.push(metal.get(k)! / m);
        }
    }
    return out;
}

/** The sums a shell's score is made of: they add up over lots of holes */
export interface CutoffSums {
    cutoff: number;
    /** Sampled metres: all, at or above the cut-off, inside the shell, and both */
    metres: number;
    metresAbove: number;
    metresInside: number;
    metresAboveInside: number;
    /** Grade times metres: all, of the samples at or above the cut-off, inside the shell, and both */
    metal: number;
    metalAbove: number;
    metalInside: number;
    metalAboveInside: number;
}

export interface CutoffScore extends CutoffSums {
    /** Of the metal at or above the cut-off, the share inside (null: there is none) */
    found: number | null;
    /** Of the metres inside, the share at or above the cut-off (null: nothing is inside) */
    right: number | null;
    /** The length-weighted grade inside and outside */
    gradeInside: number | null;
    gradeOutside: number | null;
    /** The share of all the metal it holds, and the share of the metres it holds it in */
    metalShare: number | null;
    metresShare: number | null;
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

function scored(s: CutoffSums): CutoffScore {
    return {
        ...s,
        found: ratio(s.metalAboveInside, s.metalAbove),
        right: ratio(s.metresAboveInside, s.metresInside),
        gradeInside: ratio(s.metalInside, s.metresInside),
        gradeOutside: ratio(s.metal - s.metalInside, s.metres - s.metresInside),
        metalShare: ratio(s.metalInside, s.metal),
        metresShare: ratio(s.metresInside, s.metres),
    };
}

/**
 * A shell at `cutoff` against samples (composites, usually): each by its
 * metres, its grade and whether the shell holds its middle.
 */
export function scoreCutoff(metres: ArrayLike<number>, grade: ArrayLike<number>, inside: ArrayLike<number | boolean>, cutoff: number): CutoffScore {
    const s: CutoffSums = { cutoff, metres: 0, metresAbove: 0, metresInside: 0, metresAboveInside: 0, metal: 0, metalAbove: 0, metalInside: 0, metalAboveInside: 0 };
    for (let i = 0; i < metres.length; i++) {
        const m = metres[i], g = grade[i];
        if (!(m > 0) || !Number.isFinite(g)) continue;
        const above = g >= cutoff, within = Number(inside[i]) > 0;
        s.metres += m;
        s.metal += m * g;
        if (above) { s.metresAbove += m; s.metalAbove += m * g; }
        if (within) { s.metresInside += m; s.metalInside += m * g; }
        if (above && within) { s.metresAboveInside += m; s.metalAboveInside += m * g; }
    }
    return scored(s);
}

/** The scores of the same cut-off over several lots of holes, as one (null: none) */
export function addCutoffScores(scores: readonly CutoffSums[]): CutoffScore | null {
    if (scores.length === 0) return null;
    const s: CutoffSums = { cutoff: scores[0].cutoff, metres: 0, metresAbove: 0, metresInside: 0, metresAboveInside: 0, metal: 0, metalAbove: 0, metalInside: 0, metalAboveInside: 0 };
    for (const x of scores) {
        s.metres += x.metres; s.metresAbove += x.metresAbove; s.metresInside += x.metresInside; s.metresAboveInside += x.metresAboveInside;
        s.metal += x.metal; s.metalAbove += x.metalAbove; s.metalInside += x.metalInside; s.metalAboveInside += x.metalAboveInside;
    }
    return scored(s);
}

/** The grade that this share of the sampled metres is at or under (0.995: the usual top cut), by length */
export function gradeAtShare(assays: Pick<Assays, 'from' | 'to' | 'grade'>, share: number): number | null {
    const rows: [number, number][] = [];
    let total = 0;
    for (let i = 0; i < assays.grade.length; i++) {
        const m = assays.to[i] - assays.from[i], g = assays.grade[i];
        if (!(m > 0) || !Number.isFinite(g)) continue;
        rows.push([g, m]);
        total += m;
    }
    if (rows.length === 0) return null;
    rows.sort((a, b) => a[0] - b[0]);
    let run = 0;
    for (const [g, m] of rows) { run += m; if (run >= share * total - 1e-9) return g; }
    return rows[rows.length - 1][0];
}
