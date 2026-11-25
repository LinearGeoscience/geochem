/**
 * Before a model's units are made into layers: do they lie in the holes
 * the way layers do? A layer laid on another is met once down a hole. A
 * unit that is met, left for another unit and met again cannot be one
 * layer there (it is a body cutting the others, a unit that should be
 * grouped with its neighbour, or ground repeated by a fold or a fault).
 * Pure: counted from the logging, hole by hole.
 */
type Text = string | null | undefined;

export interface UnitLie {
    unit: string;
    /** The holes it is logged in */
    holes: number;
    /** Those in which it comes back after another unit */
    back: number;
    /** The separate stretches of it, over all holes */
    stretches: number;
    /** Metres logged as it (intervals with no To count as 0) */
    metres: number;
    /** What it comes back after: each unit, and how many times it was the one just above a later stretch */
    after: Record<string, number>;
}

/** A unit comes back "often" when it does in this share of its holes, and in this many holes at least */
export const BACK_SHARE = 0.25;
export const BACK_HOLES = 3;

/**
 * How each unit lies down the holes. `unit`: each interval's unit ('' = not
 * logged, or in no unit: passed over, so two stretches with only unlogged
 * ground between them are one).
 */
export function layerCheck(log: { hole: ArrayLike<Text>; from: ArrayLike<number>; to: ArrayLike<number> | null; unit: ArrayLike<Text> }): UnitLie[] {
    const byHole = new Map<string, number[]>();
    for (let i = 0; i < log.from.length; i++) {
        const hole = log.hole[i];
        if (!hole || !Number.isFinite(log.from[i]) || !(log.unit[i] ?? '').trim()) continue;
        let rows = byHole.get(hole);
        if (!rows) byHole.set(hole, rows = []);
        rows.push(i);
    }
    const out = new Map<string, UnitLie>();
    const of = (unit: string) => {
        let u = out.get(unit);
        if (!u) out.set(unit, u = { unit, holes: 0, back: 0, stretches: 0, metres: 0, after: {} });
        return u;
    };
    for (const rows of byHole.values()) {
        rows.sort((a, b) => log.from[a] - log.from[b]);
        const stretches = new Map<string, number>();
        let last = '';
        for (const i of rows) {
            const unit = (log.unit[i] ?? '').trim();
            const length = log.to ? log.to[i] - log.from[i] : 0;
            if (Number.isFinite(length) && length > 0) of(unit).metres += length;
            if (unit !== last) {
                const before = stretches.get(unit) ?? 0;
                if (before > 0) { const u = of(unit); u.after[last] = (u.after[last] ?? 0) + 1; }
                stretches.set(unit, before + 1);
            }
            last = unit;
        }
        for (const [unit, n] of stretches) {
            const u = of(unit);
            u.holes++;
            u.stretches += n;
            if (n > 1) u.back++;
        }
    }
    return [...out.values()];
}

/** Whether a unit comes back too often to be one layer */
export const comesBack = (u: UnitLie | undefined): boolean => !!u && u.back >= BACK_HOLES && u.back >= BACK_SHARE * u.holes;

/** The unit it most often comes back after (null: it never comes back) */
export function mostAfter(u: UnitLie): string | null {
    let best: string | null = null;
    for (const [unit, n] of Object.entries(u.after)) if (best === null || n > u.after[best]) best = unit;
    return best;
}

/** "comes back in 41 of its 60 holes, mostly after DYKE" */
export function backText(u: UnitLie): string {
    const after = mostAfter(u);
    return `comes back in ${u.back.toLocaleString()} of its ${u.holes.toLocaleString()} hole${u.holes === 1 ? '' : 's'}${after ? `, ${Object.keys(u.after).length > 1 ? 'mostly ' : ''}after ${after}` : ''}`;
}
