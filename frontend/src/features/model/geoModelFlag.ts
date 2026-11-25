/**
 * A built model against the logging it was made from (pure): places down the
 * logged intervals, and how much of the logging lies in the unit it was
 * logged as. Counted in metres of hole, not in rows, so that long and short
 * intervals weigh as they should.
 */
import type { HoleLog } from './contacts';

export interface LoggedSamples {
    /** xyz triples: the middle of each piece of a logged interval */
    xyz: Float64Array;
    /** The logging row each piece is of, and its length down the hole, m */
    row: Int32Array;
    length: Float64Array;
    /** Where each piece starts and ends down its hole, m */
    from: Float64Array;
    to: Float64Array;
}

/**
 * Pieces of the logged intervals, none longer than `step` metres (longer
 * when there would be more than `limit` of them). An interval whose hole
 * has no known path is one piece where its row is. Rows not logged, or with
 * no place, are left out.
 */
export function loggedSamples(log: HoleLog, step: number, limit = 60_000): LoggedSamples {
    const n = log.from.length;
    const len = (i: number) => (log.to ? Number(log.to[i]) - Number(log.from[i]) : NaN);
    const logged = (i: number) => !!log.code[i] && String(log.code[i]).trim() !== '';
    let size = Math.max(step, 1e-6);
    const pieces = (i: number) => (log.placeAt && len(i) > 0 ? Math.ceil(len(i) / size - 1e-9) : 1);
    for (let round = 0; round < 8; round++) {
        let total = 0;
        for (let i = 0; i < n; i++) if (logged(i)) total += pieces(i);
        if (total <= limit) break;
        size *= 1.05 * total / limit;
    }
    const xyz: number[] = [], row: number[] = [], length: number[] = [], from: number[] = [], to: number[] = [];
    for (let i = 0; i < n; i++) {
        if (!logged(i)) continue;
        const l = len(i), k = pieces(i);
        const whole = l > 0 ? l : 1;
        for (let q = 0; q < k; q++) {
            const at = log.placeAt && l > 0 ? log.placeAt(i, Number(log.from[i]) + (q + 0.5) * l / k) : null;
            const p = at ?? [Number(log.x[i]), Number(log.y[i]), Number(log.z[i])];
            if (!Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !Number.isFinite(p[2])) continue;
            xyz.push(p[0], p[1], p[2]);
            row.push(i);
            length.push(whole / k);
            const top = Number(log.from[i]);
            from.push(l > 0 ? top + q * l / k : top);
            to.push(l > 0 ? top + (q + 1) * l / k : top);
        }
    }
    return { xyz: Float64Array.from(xyz), row: Int32Array.from(row), length: Float64Array.from(length), from: Float64Array.from(from), to: Float64Array.from(to) };
}

export interface UnitAgreement {
    unit: string;
    /** Metres logged as it inside the model, and how much of that the model has as it */
    logged: number;
    agreed: number;
    /** What the model has the rest as, the most first */
    as: { unit: string; metres: number }[];
}

export interface Agreement {
    /** One row per unit of the model that is logged inside it, in the model's order */
    units: UnitAgreement[];
    /** Metres of logging compared, and of that in the unit it was logged as */
    metres: number;
    agreed: number;
    /** Metres of logging outside the model's boundary, and logged as something the model has no unit for: not compared */
    outside: number;
    other: number;
    /** The holes, the worst first: metres compared and agreed */
    holes: { hole: string; metres: number; agreed: number }[];
}

/**
 * How the model agrees with the logging. Per piece: the unit it was logged
 * as, the unit the model has there (null: outside the model), its length and
 * its hole. `units`: the model's units.
 */
export function agreement(units: readonly string[], logged: ArrayLike<string>, modelled: ArrayLike<string | null>, length: ArrayLike<number>, hole: ArrayLike<string>): Agreement {
    const known = new Set(units);
    const per = new Map<string, { logged: number; agreed: number; as: Map<string, number> }>();
    const holes = new Map<string, { metres: number; agreed: number }>();
    let metres = 0, agreed = 0, outside = 0, other = 0;
    for (let i = 0; i < length.length; i++) {
        const l = length[i], a = logged[i], b = modelled[i];
        if (!(l > 0)) continue;
        if (!known.has(a)) { other += l; continue; }
        if (b === null) { outside += l; continue; }
        const u = per.get(a) ?? { logged: 0, agreed: 0, as: new Map<string, number>() };
        per.set(a, u);
        const h = holes.get(hole[i]) ?? { metres: 0, agreed: 0 };
        holes.set(hole[i], h);
        u.logged += l; h.metres += l; metres += l;
        if (a === b) { u.agreed += l; h.agreed += l; agreed += l; } else u.as.set(b, (u.as.get(b) ?? 0) + l);
    }
    return {
        units: units.filter(u => per.has(u)).map(u => {
            const p = per.get(u)!;
            return { unit: u, logged: p.logged, agreed: p.agreed, as: [...p.as].map(([unit, m]) => ({ unit, metres: m })).sort((x, y) => y.metres - x.metres) };
        }),
        metres, agreed, outside, other,
        holes: [...holes].map(([name, h]) => ({ hole: name, ...h }))
            .sort((x, y) => (y.metres - y.agreed) - (x.metres - x.agreed) || x.hole.localeCompare(y.hole)),
    };
}

/** A stretch of a hole the model has as another unit than it was logged as */
export interface Mismatch {
    hole: string;
    /** Down the hole, m */
    from: number;
    to: number;
    logged: string;
    modelled: string;
    /** Metres of logging in it (less than `to - from` when part of it is not logged) */
    metres: number;
    /** The middle of its first piece and of its last: where it is, xyz */
    a: [number, number, number];
    b: [number, number, number];
}

/**
 * The stretches of hole that are in another unit than they were logged as,
 * the longest first. Pieces that follow one another down a hole, logged as
 * the same unit and modelled as the same other one, are one stretch. Pieces
 * that are not compared (outside the model, or logged as a unit it does not
 * have) are in none. `units`: the model's units.
 */
export function mismatches(units: readonly string[], samples: LoggedSamples, logged: ArrayLike<string>, modelled: ArrayLike<string | null>, hole: ArrayLike<string>): Mismatch[] {
    const known = new Set(units);
    const order: number[] = [];
    for (let i = 0; i < samples.length.length; i++) {
        if (samples.length[i] > 0 && known.has(logged[i]) && modelled[i] !== null && modelled[i] !== logged[i]) order.push(i);
    }
    order.sort((x, y) => (hole[x] < hole[y] ? -1 : hole[x] > hole[y] ? 1 : samples.from[x] - samples.from[y]));
    const place = (i: number): [number, number, number] => [samples.xyz[i * 3], samples.xyz[i * 3 + 1], samples.xyz[i * 3 + 2]];
    const out: Mismatch[] = [];
    for (const i of order) {
        const last = out[out.length - 1];
        if (last && last.hole === hole[i] && last.logged === logged[i] && last.modelled === modelled[i] && samples.from[i] <= last.to + 1e-6) {
            last.to = Math.max(last.to, samples.to[i]);
            last.metres += samples.length[i];
            last.b = place(i);
        } else {
            out.push({ hole: hole[i], from: samples.from[i], to: samples.to[i], logged: logged[i], modelled: modelled[i]!, metres: samples.length[i], a: place(i), b: place(i) });
        }
    }
    return out.sort((x, y) => y.metres - x.metres || x.hole.localeCompare(y.hole) || x.from - y.from);
}

/**
 * The agreement in each part of the model (its fault blocks), in the order
 * the parts are given. `part`: per piece, the part it is in (null: none). A
 * part with nothing compared in it is left out.
 */
export function agreementByPart(
    parts: readonly string[], part: ArrayLike<string | null>,
    units: readonly string[], logged: ArrayLike<string>, modelled: ArrayLike<string | null>, length: ArrayLike<number>, hole: ArrayLike<string>,
): { name: string; agreement: Agreement }[] {
    return parts.map(name => {
        const keep: number[] = [];
        for (let i = 0; i < length.length; i++) if (part[i] === name) keep.push(i);
        return { name, agreement: agreement(units, keep.map(i => logged[i]), keep.map(i => modelled[i]), keep.map(i => length[i]), keep.map(i => hole[i])) };
    }).filter(x => x.agreement.metres > 0);
}

const round = (v: number) => (v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1));

/** A share as a whole per cent, never 100 when something disagrees nor 0 when something agrees */
export function sharePercent(part: number, whole: number): number {
    if (!(whole > 0)) return 0;
    const p = Math.round(100 * part / whole);
    return p === 100 && part < whole - 1e-9 ? 99 : p === 0 && part > 1e-9 ? 1 : p;
}

/** The agreement in a line */
export function agreementText(a: Agreement): string {
    if (!(a.metres > 0)) return 'None of the logging is of the model\'s units inside it: there is nothing to compare.';
    return `${sharePercent(a.agreed, a.metres)}% of the ${round(a.metres)} m of logging in the model is in the unit it was logged as.`;
}

/** Metres, written for the table */
export const metresText = (v: number): string => `${round(v)} m`;
