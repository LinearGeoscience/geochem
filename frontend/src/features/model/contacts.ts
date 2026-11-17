/**
 * A surface between logged units: where the logging changes from one side to
 * the other down each drillhole, and a check that every logged interval ends
 * up on its own side of the surface (pure, unit-tested).
 *
 * Down a hole the intervals are read in order. Intervals of the first side
 * that follow one another make a run, likewise the second side; intervals
 * that are blank or of some other unit belong to neither and only make a gap.
 * Where a run of one side is followed by a run of the other there is a
 * contact, half-way between the end of the one and the start of the next,
 * unless more than `maxGap` of hole lies between them: then the contact
 * could be anywhere in the gap and no point is made. The end of a hole is not
 * a contact.
 *
 * A sample's coordinates are the middle of its interval (that is where the
 * desurvey puts them), so the contact's place is found between the two
 * samples either side of it, by depth.
 */
import { evaluateField } from './rbf';
import { fitSheet, type SheetFit, type SheetInput } from './sheet';
import type { BodyRule, ContactRule, Vec3 } from './types';

/** Which logged units lie on which side, and how gaps and thin units are treated */
export interface SidesRule {
    /** The units on the first (positive) side */
    sideA: readonly string[];
    /** The units on the second side; null: every other logged unit */
    sideB: readonly string[] | null;
    /** With `sideB` null: units that are on neither side (as if not logged) */
    ignore?: readonly string[];
    maxGap: number | null;
    minRun: number | null;
}

export interface HoleLog {
    /** Per row: the hole it is in ('' = none) */
    hole: ArrayLike<string | null | undefined>;
    from: ArrayLike<number>;
    /** Null: an interval ends where the next one down the hole starts */
    to: ArrayLike<number> | null;
    x: ArrayLike<number>;
    y: ArrayLike<number>;
    z: ArrayLike<number>;
    /** Per row: the logged unit ('' = not logged) */
    code: ArrayLike<string | null | undefined>;
}

/** Logged intervals whose side is known, for checking a surface against */
export interface SideChecks {
    /** The middle of each interval, xyz triples */
    positions: Float64Array;
    /** 1 = first side, -1 = second side */
    side: Int8Array;
    /** Half the interval's length: it may reach this far across the surface and still straddle it */
    slack: Float32Array;
    /** Distance down the hole to the nearest contact in the same hole (Infinity: the hole has none) */
    toContact: Float32Array;
    /** The hole each is in, as a number */
    hole: Int32Array;
}

/** One place per stretch of one side down a hole */
export interface RunMiddles {
    positions: Float64Array;
    /** 1 the first side, -1 the second */
    side: Int8Array;
    /** Which hole (counting the holes that have any interval of either side) */
    hole: Int32Array;
    /** How long the stretch is down the hole, m */
    length: Float64Array;
    /** The direction down the hole there, unit xyz triples (zeros: the hole has one sample, so none is known) */
    along: Float64Array;
}

/** A surface's rule as sides: a body's units on the first side, every other logged unit on the second. */
export function sidesRule(rule: ContactRule | BodyRule): SidesRule {
    return rule.kind === 'body'
        ? { sideA: rule.inside, sideB: null, ignore: rule.ignore, maxGap: rule.maxGap, minRun: rule.minRun }
        : { sideA: rule.sideA, sideB: rule.sideB, maxGap: rule.maxGap, minRun: rule.minRun };
}

export interface ContactInputs {
    /** Where the surface passes, xyz triples */
    contacts: Float64Array;
    /** From the second side towards the first, summed over the contacts (null: no contacts) */
    facing: Vec3 | null;
    checks: SideChecks;
    /** Holes with at least one interval of either side / with a contact */
    holes: number;
    holesWithContact: number;
    /** Changes of side left out because too much unlogged hole lies between the two sides */
    gapsLeftOut: number;
    /** The longest gap a contact is put across (m): the rule's, or twice the usual interval length */
    maxGap: number;
    /** Intervals of either side, before any thinning of `checks` */
    intervals: number;
    /**
     * One place in the middle of every stretch of one side down a hole (the
     * sample nearest its middle), xyz triples, and its side: what a closed
     * body is first fitted to, besides its contacts.
     */
    middles: RunMiddles;
    /** The shortest stretch of the first side down any hole, m (null: there is none) */
    thinnest: number | null;
    /** Tells one set of inputs from another (for the fit cache) */
    mark: string;
}

/** At most this many intervals are checked (every k-th beyond it): the check is against a field of a few hundred centres */
const MAX_CHECKS = 20_000;

interface Run {
    side: 1 | -1;
    /** Depths */
    start: number;
    end: number;
    /** Rows: the first and last interval of the run */
    first: number;
    last: number;
    rows: number[];
}

function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function hashInto(h: number, bytes: Uint8Array): number {
    for (let i = 0; i < bytes.length; i++) {
        h ^= bytes[i];
        h = Math.imul(h, 0x01000193);
    }
    return h;
}

/** The contacts and the side of every logged interval, for a rule on a set of drillholes. */
export function findContacts(log: HoleLog, rule: SidesRule): ContactInputs {
    const a = new Set(rule.sideA.map(c => c.trim()));
    const b = rule.sideB ? new Set(rule.sideB.map(c => c.trim())) : null;
    const ignore = new Set((rule.ignore ?? []).map(c => c.trim()));
    const n = log.from.length;

    // Rows by hole, in the order of their depth
    const byHole = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
        const hole = log.hole[i];
        if (!hole || !Number.isFinite(log.from[i]) || !Number.isFinite(log.x[i]) || !Number.isFinite(log.y[i]) || !Number.isFinite(log.z[i])) continue;
        const rows = byHole.get(hole);
        if (rows) rows.push(i);
        else byHole.set(hole, [i]);
    }

    // Where each interval ends
    const end = new Float64Array(n).fill(NaN);
    const lengths: number[] = [];
    for (const rows of byHole.values()) {
        rows.sort((p, q) => log.from[p] - log.from[q]);
        for (let k = 0; k < rows.length; k++) {
            const i = rows[k];
            const to = log.to ? log.to[i] : NaN;
            if (Number.isFinite(to) && to > log.from[i]) end[i] = to;
            else if (k + 1 < rows.length && log.from[rows[k + 1]] > log.from[i]) end[i] = log.from[rows[k + 1]];
        }
        // The last one of a hole without a To: as long as the one before
        for (let k = 0; k < rows.length; k++) {
            const i = rows[k];
            if (Number.isFinite(end[i])) { lengths.push(end[i] - log.from[i]); continue; }
            const before = k > 0 ? end[rows[k - 1]] - log.from[rows[k - 1]] : 0;
            end[i] = log.from[i] + (before > 0 ? before : 0);
        }
    }
    const usual = median(lengths);
    const maxGap = rule.maxGap !== null && rule.maxGap !== undefined && rule.maxGap >= 0 ? rule.maxGap : 2 * usual;
    const minRun = rule.minRun !== null && rule.minRun !== undefined && rule.minRun > 0 ? rule.minRun : 0;
    const sideOf = (i: number): 0 | 1 | -1 => {
        const code = (log.code[i] ?? '').trim();
        return code === '' ? 0 : a.has(code) ? 1 : (b ? b.has(code) : !ignore.has(code)) ? -1 : 0;
    };

    const contacts: number[] = [];
    const facing: Vec3 = [0, 0, 0];
    const checkRows: number[] = [], checkHole: number[] = [], checkToContact: number[] = [];
    const middleRows: number[] = [], middleSide: number[] = [], middleHole: number[] = [], middleLength: number[] = [], middleAlong: number[] = [];
    const between = (i: number, j: number): Vec3 => {
        const d: Vec3 = [log.x[j] - log.x[i], log.y[j] - log.y[i], log.z[j] - log.z[i]];
        const len = Math.hypot(d[0], d[1], d[2]);
        return len > 0 ? [d[0] / len, d[1] / len, d[2] / len] : [0, 0, 0];
    };
    let holes = 0, holesWithContact = 0, gapsLeftOut = 0;
    let thinnest = Infinity;

    for (const rows of byHole.values()) {
        let runs: Run[] = [];
        for (const i of rows) {
            const side = sideOf(i);
            if (side === 0) continue;
            const last = runs[runs.length - 1];
            if (last && last.side === side) {
                last.end = Math.max(last.end, end[i]);
                last.last = i;
                last.rows.push(i);
            } else runs.push({ side, start: log.from[i], end: end[i], first: i, last: i, rows: [i] });
        }
        if (runs.length === 0) continue;
        if (minRun > 0 && runs.length > 2) {
            // A thin unit inside the other side is left out, and the runs either side of it become one
            const kept: Run[] = [];
            runs.forEach((run, k) => {
                const inside = k > 0 && k < runs.length - 1;
                if (inside && run.end - run.start < minRun) return;
                const last = kept[kept.length - 1];
                if (last && last.side === run.side) {
                    last.end = Math.max(last.end, run.end);
                    last.last = run.last;
                    last.rows.push(...run.rows);
                } else kept.push({ ...run, rows: run.rows.slice() });
            });
            runs = kept;
        }
        const holeIndex = holes++;
        const depths: number[] = [];
        for (let k = 0; k + 1 < runs.length; k++) {
            const up = runs[k], down = runs[k + 1];
            const gap = Math.max(0, down.start - up.end);
            if (gap > maxGap + 1e-9) { gapsLeftOut++; continue; }
            const i = up.last, j = down.first;
            const depth = (up.end + down.start) / 2;
            const mi = (log.from[i] + end[i]) / 2, mj = (log.from[j] + end[j]) / 2;
            const t = mj > mi ? Math.min(1, Math.max(0, (depth - mi) / (mj - mi))) : 0.5;
            const d: Vec3 = [log.x[j] - log.x[i], log.y[j] - log.y[i], log.z[j] - log.z[i]];
            contacts.push(log.x[i] + t * d[0], log.y[i] + t * d[1], log.z[i] + t * d[2]);
            depths.push(depth);
            // From the second side towards the first
            const len = Math.hypot(d[0], d[1], d[2]);
            if (len > 0) for (let c = 0; c < 3; c++) facing[c] -= up.side * d[c] / len;
        }
        if (depths.length > 0) holesWithContact++;
        for (const run of runs) {
            if (run.side === 1) thinnest = Math.min(thinnest, run.end - run.start);
            const middle = (run.start + run.end) / 2;
            let best = run.rows[0], off = Infinity;
            for (const i of run.rows) {
                const d = Math.abs((log.from[i] + end[i]) / 2 - middle);
                if (d < off) { off = d; best = i; }
            }
            middleRows.push(best);
            middleSide.push(run.side);
            middleHole.push(holeIndex);
            middleLength.push(run.end - run.start);
            // Along the stretch itself where it has two samples, else along the whole hole
            middleAlong.push(...(run.first !== run.last ? between(run.first, run.last) : between(rows[0], rows[rows.length - 1])));
        }
        for (const run of runs) {
            for (const i of run.rows) {
                const mid = (log.from[i] + end[i]) / 2;
                let nearest = Infinity;
                for (const depth of depths) nearest = Math.min(nearest, Math.abs(depth - mid));
                checkRows.push(i);
                checkHole.push(holeIndex);
                checkToContact.push(nearest);
            }
        }
    }

    const stride = Math.max(1, Math.ceil(checkRows.length / MAX_CHECKS));
    const m = Math.ceil(checkRows.length / stride);
    const checks: SideChecks = {
        positions: new Float64Array(m * 3), side: new Int8Array(m), slack: new Float32Array(m), toContact: new Float32Array(m), hole: new Int32Array(m),
    };
    for (let k = 0; k < m; k++) {
        const at = k * stride, i = checkRows[at];
        checks.positions[k * 3] = log.x[i];
        checks.positions[k * 3 + 1] = log.y[i];
        checks.positions[k * 3 + 2] = log.z[i];
        checks.side[k] = sideOf(i);
        checks.slack[k] = Math.max(0, (end[i] - log.from[i]) / 2);
        checks.toContact[k] = checkToContact[at];
        checks.hole[k] = checkHole[at];
    }

    const middles: RunMiddles = {
        positions: new Float64Array(middleRows.length * 3), side: Int8Array.from(middleSide),
        hole: Int32Array.from(middleHole), length: Float64Array.from(middleLength), along: Float64Array.from(middleAlong),
    };
    middleRows.forEach((i, k) => middles.positions.set([log.x[i], log.y[i], log.z[i]], k * 3));

    const points = Float64Array.from(contacts);
    let h = 0x811c9dc5;
    h = hashInto(h, new Uint8Array(points.buffer));
    h = hashInto(h, new Uint8Array(middles.positions.buffer));
    h = hashInto(h, new Uint8Array(middles.side.buffer));
    h = hashInto(h, new Uint8Array(middles.length.buffer));
    h = hashInto(h, new Uint8Array(checks.positions.buffer));
    h = hashInto(h, new Uint8Array(checks.side.buffer));
    const length = Math.hypot(facing[0], facing[1], facing[2]);
    return {
        contacts: points,
        facing: points.length > 0 && length > 1e-9 ? [facing[0] / length, facing[1] / length, facing[2] / length] : null,
        checks, holes, holesWithContact, gapsLeftOut, maxGap, intervals: checkRows.length,
        middles, thinnest: Number.isFinite(thinnest) ? thinnest : null,
        mark: `${(h >>> 0).toString(16)}:${points.length / 3}:${m}`,
    };
}

export interface SideReport {
    /** Logged intervals checked against the surface */
    checked: number;
    /** Of those, the ones still on the wrong side of it */
    wrong: number;
    /** Intervals the surface was made to respect on top of its contacts */
    added: number;
}

/** The surface is refitted at most this many times to put intervals on their own side */
const MAX_ROUNDS = 6;
/** At most this many intervals are added to what the surface is fitted to */
const MAX_ADDED = 400;
/** ... and at most this many in one round */
const PER_ROUND = 80;

/**
 * Fit a sheet through its points, then put right what the logging says is on
 * the wrong side of it.
 *
 * A surface through the contacts alone can still cut through a hole that
 * never met the contact, or join the limbs of a fold the wrong way. So after
 * each fit every logged interval is looked at: is it on its own side? Of the
 * ones that are not, the worst in each hole is given to the next fit as a
 * place the surface must stay clear of, on the right side. A few rounds
 * settle it. An interval may reach half its length across the surface: it
 * then straddles it, which is no contradiction.
 */
export function fitWithSides(input: SheetInput, checks: SideChecks | null): { fit: SheetFit; report: SideReport | null } {
    return refineSides(extra => fitSheet(extra ? { ...input, valued: extra } : input), checks);
}

/**
 * The rounds of `fitWithSides`, for any kind of fit: `fitOnce` fits the
 * surface, with the given places held off it as well (null: none yet).
 */
export function refineSides(
    fitOnce: (extra: { positions: number[]; values: number[] } | null) => SheetFit, checks: SideChecks | null,
): { fit: SheetFit; report: SideReport | null } {
    let fit = fitOnce(null);
    const m = checks ? checks.side.length : 0;
    if (!checks || m === 0) return { fit, report: null };
    const positions: number[] = [], values: number[] = [];
    const used = new Uint8Array(m);
    let wrong = 0, added = 0;
    const values0 = new Float64Array(m);
    for (let round = 0; ; round++) {
        if (!fit.field) return { fit, report: null };
        const f = evaluateField(fit.field, checks.positions, values0);
        wrong = 0;
        const worst = new Map<number, { i: number; by: number }>();
        for (let i = 0; i < m; i++) {
            const by = -checks.side[i] * f[i] - checks.slack[i];
            if (!(by > 0)) continue;
            wrong++;
            if (used[i]) continue;
            const w = worst.get(checks.hole[i]);
            if (!w || by > w.by) worst.set(checks.hole[i], { i, by });
        }
        const room = MAX_ADDED - values.length;
        if (wrong === 0 || round >= MAX_ROUNDS || room <= 0 || worst.size === 0) break;
        const picked = [...worst.values()].sort((p, q) => q.by - p.by).slice(0, Math.min(PER_ROUND, room));
        for (const { i } of picked) {
            used[i] = 1;
            positions.push(checks.positions[i * 3], checks.positions[i * 3 + 1], checks.positions[i * 3 + 2]);
            // How far from the surface it should be: at least clear of it; in a hole that meets the contact, about half the way to where it does
            const clear = Math.max(checks.slack[i], 0.1);
            const along = checks.toContact[i];
            values.push(checks.side[i] * (Number.isFinite(along) ? Math.max(clear, along / 2) : clear));
        }
        const next = fitOnce({ positions, values });
        // Could not be solved with these as well: keep what there was
        if (!next.field) break;
        fit = next;
        added = values.length;
    }
    return { fit, report: { checked: m, wrong, added } };
}
