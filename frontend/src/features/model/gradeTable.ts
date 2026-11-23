/**
 * Phase 273: grade by part of the ground (pure, unit-tested): the metres,
 * the mean grade and the share of the metal that the samples in each part
 * hold. A part is a lithology as logged or as modelled, the inside of a
 * grade shell, the inside of a closed mesh: anything that says, for each
 * sample, how much of it is in the part.
 *
 * The mean is by length (a 2 m sample counts twice a 1 m one). "Metal" is
 * metres times grade: the share of it a part holds says how much of what is
 * there is in that part, whatever the units of the column. A top cut, where
 * one is given, is applied to each sample first and said with the table.
 */

export interface GradeInput {
    /** Each sample's length, m (1 each where the data has no depths: the table then counts samples) */
    length: ArrayLike<number>;
    /** Its value; not a number where it was not assayed (it is left out of everything) */
    value: ArrayLike<number>;
}

export interface GradePart {
    name: string;
    /** For each sample, how much of it is in this part: 0 to 1 */
    share: ArrayLike<number>;
    /** Said beside its row (why it is empty, what it was read from) */
    note?: string;
}

export interface GradeRow {
    name: string;
    /** Samples with any of their length in the part */
    samples: number;
    metres: number;
    /** Mean grade by length (null: no metres) */
    grade: number | null;
    /** Its share of all the metres, and of all the metal (null: there is none) */
    ground: number | null;
    metal: number | null;
    note?: string;
}

export interface GradeTable {
    /** Every assayed sample given */
    all: GradeRow;
    rows: GradeRow[];
    topCut: number | null;
    /** How many samples were over the top cut */
    cut: number;
}

/**
 * The table. `rest`: a last row for what is in none of the parts (for parts
 * that do not overlap: lithologies, the blocks of a model), named so.
 */
export function gradeTable(input: GradeInput, parts: readonly GradePart[], topCut: number | null = null, rest: string | null = null): GradeTable {
    const n = input.value.length;
    const sums = parts.map(() => ({ samples: 0, metres: 0, metal: 0 }));
    const all = { samples: 0, metres: 0, metal: 0 }, left = { samples: 0, metres: 0, metal: 0 };
    let cut = 0;
    for (let i = 0; i < n; i++) {
        const raw = input.value[i], m = input.length[i];
        if (!Number.isFinite(raw) || !(m > 0)) continue;
        const over = topCut !== null && raw > topCut;
        if (over) cut++;
        const g = over ? topCut : raw;
        all.samples++; all.metres += m; all.metal += m * g;
        let taken = 0;
        for (let k = 0; k < parts.length; k++) {
            const s = Math.min(1, Math.max(0, parts[k].share[i] || 0));
            if (s <= 0) continue;
            sums[k].samples++; sums[k].metres += m * s; sums[k].metal += m * s * g;
            taken += s;
        }
        const over1 = Math.max(0, 1 - taken);
        if (rest !== null && over1 > 1e-9) { left.samples++; left.metres += m * over1; left.metal += m * over1 * g; }
    }
    const row = (name: string, s: { samples: number; metres: number; metal: number }, note?: string): GradeRow => ({
        name, samples: s.samples, metres: s.metres,
        grade: s.metres > 0 ? s.metal / s.metres : null,
        ground: all.metres > 0 ? s.metres / all.metres : null,
        // (A column that sums to nothing, or below it, has no shares to speak of)
        metal: all.metal > 0 ? s.metal / all.metal : null,
        ...(note ? { note } : {}),
    });
    return {
        all: row('All', all),
        rows: [...parts.map((p, k) => row(p.name, sums[k], p.note)), ...(rest !== null && left.samples > 0 ? [row(rest, left)] : [])],
        topCut, cut,
    };
}

/** Intervals down holes */
export interface Intervals { hole: ArrayLike<string | null | undefined>; from: ArrayLike<number>; to: ArrayLike<number> }

/**
 * Samples against logging down the same holes, where the two are not on the
 * same rows: for each of `units`, how much of each sample's length is logged
 * as it (0 to 1). A sample with no length is in the interval its depth is in.
 */
export function overlapShares(samples: Intervals, log: Intervals & { code: ArrayLike<string | null | undefined> }, units: readonly string[]): Float32Array[] {
    const out = units.map(() => new Float32Array(samples.from.length));
    const unitAt = new Map(units.map((u, k) => [u, k]));
    // The logging of each hole, down the hole
    const byHole = new Map<string, number[]>();
    for (let r = 0; r < log.from.length; r++) {
        const u = log.code[r];
        if (u === null || u === undefined || !unitAt.has(u) || !(log.to[r] > log.from[r])) continue;
        const h = String(log.hole[r] ?? '');
        let list = byHole.get(h);
        if (!list) { list = []; byHole.set(h, list); }
        list.push(r);
    }
    for (const list of byHole.values()) list.sort((a, b) => log.from[a] - log.from[b]);
    for (let i = 0; i < samples.from.length; i++) {
        const list = byHole.get(String(samples.hole[i] ?? ''));
        if (!list) continue;
        const a = samples.from[i], b = samples.to[i], length = b - a;
        if (!Number.isFinite(a)) continue;
        // The first interval that ends after the sample starts
        let low = 0, high = list.length;
        while (low < high) { const mid = (low + high) >> 1; if (log.to[list[mid]] <= a) low = mid + 1; else high = mid; }
        if (!(length > 0)) {
            const r = list[low];
            if (r !== undefined && log.from[r] <= a) out[unitAt.get(log.code[r] as string)!][i] = 1;
            continue;
        }
        for (let k = low; k < list.length && log.from[list[k]] < b; k++) {
            const r = list[k];
            const over = Math.min(b, log.to[r]) - Math.max(a, log.from[r]);
            if (over > 0) out[unitAt.get(log.code[r] as string)!][i] += over / length;
        }
    }
    // (Logging that overlaps itself cannot give a sample more than all of it)
    for (const share of out) for (let i = 0; i < share.length; i++) if (share[i] > 1) share[i] = 1;
    return out;
}

/** A share as a percentage in a table: "23%", "0.4%", "" for none */
export function shareText(v: number | null): string {
    if (v === null) return '';
    const p = v * 100;
    return `${p >= 10 || p === 0 ? Math.round(p) : p >= 1 ? Math.round(p * 10) / 10 : Math.round(p * 100) / 100}%`;
}

/** A grade in a table: three figures */
export function gradeText(v: number | null): string {
    if (v === null) return '';
    const a = Math.abs(v);
    return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : a >= 0.1 ? v.toFixed(3) : v.toPrecision(2);
}
