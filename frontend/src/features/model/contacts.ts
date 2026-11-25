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
 * samples either side of it, by depth. Logging that knows the paths of its
 * holes (`placeAt`: a table logged down the holes) puts the contact on the
 * path at its depth instead, which is right where the hole bends too.
 */
import { evaluateField } from './rbf';
import { fitSheet, type SheetFit, type SheetInput } from './sheet';
import { editFor } from './contactControl';
import { normalFromDip, planeOfMany, unit } from './plane';
import { carryPlane, type CarryPieces } from './setPlane';
import type { BodyRule, ContactControl, ContactEdit, ContactRule, Vec3 } from './types';

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
    /**
     * Stretches of the first side down a hole less than this far apart are
     * one stretch, m (a vein read as a zone: BodyRule.vein). What lies
     * between them is then on neither side. Absent or 0: none are. How far
     * apart is measured across the plane the first side lies in, so that a
     * hole at a low angle to it counts as one square to it does
     * (`ContactInputs.joinPlane`); down the hole when nothing gives a
     * plane.
     */
    join?: number;
    /**
     * The plane the first side lies in, given, as its unit normal. Absent:
     * worked out (`ContactInputs.joinPlaneFrom`).
     */
    across?: Vec3;
    /**
     * A zone (stretches joined, with other ground between them) is taken
     * as thick as the first side in it is, all together, about where the
     * middle of that is: its net thickness, not the zone's. Its contacts
     * are put there. What it holds of the first side outside them is of
     * the first side still: a hole is in the zone wherever it is in any
     * strand of it. Read with a join length only.
     */
    net?: boolean;
    /**
     * Also give the gaps between stretches of the first side down each
     * hole, as they are before any are joined and measured as a join
     * length is (`ContactInputs.gaps`): the plane is worked out for it
     * even with no join length.
     */
    gaps?: boolean;
    /**
     * The first side is a set of thin sheets built as a volume
     * (BodyRule.sheets): the plane it lies in is worked out, or taken as
     * given (`across`), with no join length, and is part of what is found
     * (`ContactInputs.joinPlane`). Its stretches are not joined.
     */
    sheets?: boolean;
    /** `across` was not given by hand: it is what the structural data the vein follows says at its stretches (modelCache.ts, `foundAs`) */
    acrossFrom?: 'data';
    /**
     * The stretches of the first side that count, each by its hole and a
     * depth inside it (one vein of several that the units make: a lode,
     * lodes.ts). Every other stretch of the first side is of the second:
     * other ground to this vein. They are told apart after stretches close
     * together are read as one zone. Absent: all of them count.
     */
    picks?: readonly { hole: string; depth: number }[];
    /** What was changed by hand: contacts left out or moved, places on one side, holes not to be crossed */
    control?: ContactControl;
    /**
     * A place marked on a side AND held clear by a distance is no part of
     * the fit: it is a lens put into the fitted body or cut out of it
     * (rbf.ts, `FieldTouches`). An intrusion; not a contact or a vein,
     * whose fit is bent to pass that far from the place.
     */
    lenses?: boolean;
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
    /** Where the hole of a row is at a depth, when its path is known (else the place is worked out between two rows) */
    placeAt?: (row: number, depth: number) => Vec3 | null;
}

/** Logged intervals whose side is known, for checking a surface against */
export interface SideChecks {
    /** The middle of each interval (of each piece of an interval much longer than the usual one: `PIECE_OF_USUAL`), xyz triples */
    positions: Float64Array;
    /** 1 = first side, -1 = second side */
    side: Int8Array;
    /**
     * Half the interval's length: it may reach this far across the surface and
     * still straddle it. Negative (an interval of a hole the surface must not
     * cross): it must be this far clear of the surface, on its own side.
     */
    slack: Float32Array;
    /** Distance down the hole to the nearest contact in the same hole (Infinity: the hole has none) */
    toContact: Float32Array;
    /** The hole each is in, as a number */
    hole: Int32Array;
    /** The depth of its middle down the hole, m (NaN: a place marked by hand, on no hole). Absent on checks made before depths were kept */
    depth?: Float32Array;
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
    /**
     * How far down the hole from its place the true middle of the stretch is, m: the place is the middle of the
     * logged interval nearest the stretch's middle, which a stretch of two intervals or more is not at.
     */
    off?: Float64Array;
}

/** A surface's rule as sides: a body's units on the first side, every other logged unit on the second. */
export function sidesRule(rule: ContactRule | BodyRule): SidesRule {
    return rule.kind === 'body'
        ? {
            sideA: rule.inside, sideB: null, ignore: rule.ignore, maxGap: rule.maxGap, minRun: rule.minRun,
            ...((rule.vein?.join ?? 0) > 0 ? { join: rule.vein!.join, ...(rule.vein!.plane ? { across: normalFromDip(rule.vein!.plane.dip, rule.vein!.plane.dipDirection) } : {}), ...(rule.vein!.thickness === 'net' ? { net: true } : {}) } : {}),
            ...(rule.vein?.picks ? { picks: rule.vein.picks } : {}),
            ...(!rule.vein && rule.sheets ? { sheets: true, ...((rule.sheets.join ?? 0) > 0 ? { join: rule.sheets.join } : {}), ...(rule.sheets.plane ? { across: normalFromDip(rule.sheets.plane.dip, rule.sheets.plane.dipDirection) } : {}) } : {}),
            control: rule.control,
            ...(rule.vein ? {} : { lenses: true }),
        }
        : { sideA: rule.sideA, sideB: rule.sideB, maxGap: rule.maxGap, minRun: rule.minRun, control: rule.control };
}

/** One contact the logging gives, and what was done with it by hand */
export interface FoundContact {
    hole: string;
    /** The depth the logging puts it at, m: what it is known by */
    depth: number;
    /** The depth it is used at (other than `depth` when it was moved) */
    at: number;
    /** Where that is */
    p: Vec3;
    /**
     * kept: as the logging has it. moved: along its hole, by hand. ignored:
     * left out by hand. uncrossed: left out because its hole was marked as
     * one the surface must not cross.
     */
    state: 'kept' | 'moved' | 'ignored' | 'uncrossed';
    /** The side up the hole from it (1 the first, -1 the second) */
    above: 1 | -1;
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
    /** Intervals longer than this were checked piece by piece, none longer than it, m (absent: none was, and each check is one interval) */
    piece?: number;
    /**
     * One place in the middle of every stretch of one side down a hole (the
     * sample nearest its middle), xyz triples, and its side: what a closed
     * body is first fitted to, besides its contacts.
     */
    middles: RunMiddles;
    /** The shortest stretch of the first side down any hole, m (null: there is none) */
    thinnest: number | null;
    /** Stretches of the first side read as one (`SidesRule.join`): how many gaps between them were closed, and how much hole those are, m (absent: none) */
    joined?: { gaps: number; metres: number };
    /**
     * The zones that take in other ground: how many, how long they are
     * down the holes all together, and how much of that is the first side
     * (m). `net`: they were taken at their net thickness.
     */
    zones?: { count: number; length: number; unit: number; net: boolean };
    /** The gaps between stretches of the first side down each hole, before any were joined, m (asked for: `SidesRule.gaps`) */
    gaps?: number[];
    /** With a join length: the unit normal of the plane it was measured across (absent: there is no join length, or it was measured down the holes) */
    joinPlane?: Vec3;
    /**
     * Where that plane is from. `given`: the rule has it. `cloud`: the plane
     * the middles of all the stretches lie closest to (one sheet, or a set
     * that lies as its sheets do). `carry`: the plane the first side
     * carries in from one hole to the next (setPlane.ts), taken when the
     * cloud gives none or lies another way: a stack of sheets side by side
     * lies as the stack does, not as a sheet.
     */
    joinPlaneFrom?: 'given' | 'data' | 'cloud' | 'carry';
    /** The plane the middles of all the stretches lie closest to, when the join length was measured across another */
    cloudPlane?: Vec3;
    /** The first side carries from hole to hole in a plane that stands out (setPlane.ts), whichever plane was taken: it lies as sheets, where a thick body carries every way alike */
    carries?: boolean;
    /**
     * When the plane is from the structural data the vein follows
     * (`joinPlaneFrom` 'data') and the logging on its own gives one well
     * away from it: the logging's (modelCache.ts, `foundAs`).
     */
    loggingPlane?: Vec3;
    /** Every contact the logging gives, hole by hole and down each, with what was done to it by hand */
    list: FoundContact[];
    /** Changes by hand that match nothing now: edits of contacts the logging no longer gives, holes not to be crossed that are not in the data */
    stale: { edits: ContactEdit[]; holes: string[]; /** Stretches picked for a vein (`SidesRule.picks`) that the logging no longer gives */ picks?: { hole: string; depth: number }[] };
    /** Of `checks`, the last this many are held by hand (places marked on one side, intervals of holes not to be crossed) */
    held: number;
    /** The holes by the numbers `checks.hole` has them under (a place marked by hand has a number past the last) */
    holeNames: string[];
    /** Tells one set of inputs from another (for the fit cache) */
    mark: string;
    /** A contact of a pile of layers (pile.ts): the metres of its layers, those not read as logged, and the holes read from the bottom up. Set by who read the log as a pile */
    pile?: { metres: number; changed: number; holes: number; up: number };
}

/** A join length across a plane counts a gap as no less than this share of its length down the hole (a hole along the plane would join everything it met) */
const JOIN_FLOOR = 0.2;
/** The plane the first side carries in is taken over the plane of its cloud when the two are further apart than this, degrees (closer, they are one plane, and the cloud's is the better measured) */
export const PLANES_APART = 15;
/** The logging is cut into no more pieces than this to find the plane it carries in (a metre each, or longer in a large project) */
const MAX_CARRY_PIECES = 60_000;
/** At most this many intervals are checked (every k-th beyond it): the check is against a field of a few hundred centres */
const MAX_CHECKS = 40_000;
/**
 * An interval longer than this many times the usual one is checked piece by
 * piece, none longer than that. Checked at its middle alone, with half its
 * length to straddle the surface by, a surface could lie almost anywhere in a
 * 300 m interval and nothing would be on the wrong side of it.
 */
export const PIECE_OF_USUAL = 2;

interface Run {
    side: 1 | -1;
    /** Depths */
    start: number;
    end: number;
    /** Rows: the first and last interval of the run */
    first: number;
    last: number;
    rows: number[];
    /**
     * For a stretch of the first side made of several: the metres of it
     * that are the first side, and those times the depth of their middle
     * (absent: all of it is, about its own middle).
     */
    unit?: number;
    moment?: number;
}

/** A run takes in the next of its side down the hole */
function absorb(last: Run, run: Run): void {
    if (last.side === 1) {
        const unitOf = (r: Run) => r.unit ?? r.end - r.start, momentOf = (r: Run) => r.moment ?? (r.end - r.start) * (r.start + r.end) / 2;
        const unit = unitOf(last) + unitOf(run), moment = momentOf(last) + momentOf(run);
        last.unit = unit;
        last.moment = moment;
    }
    last.end = Math.max(last.end, run.end);
    last.last = run.last;
    last.rows.push(...run.rows);
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

    const control = rule.control;
    const uncrossed = new Map((control?.uncrossed ?? []).map(u => [u.hole, u.side]));
    const matched = new Set<ContactEdit>();
    const list: FoundContact[] = [];
    // Intervals held to a side by hand (holes not to be crossed): never thinned
    const heldRows: number[] = [], heldSide: number[] = [], heldHole: number[] = [];
    /** Where a hole is at a depth: on its path when that is known, else between the two samples either side of it */
    const placeDown = (rows: number[], depth: number): Vec3 => {
        const at = log.placeAt?.(rows[0], depth);
        if (at) return at;
        const mid = (i: number) => (log.from[i] + end[i]) / 2;
        let k = 0;
        while (k + 2 < rows.length && mid(rows[k + 1]) < depth) k++;
        const i = rows[k], j = rows[Math.min(k + 1, rows.length - 1)];
        const t = mid(j) > mid(i) ? Math.min(1, Math.max(0, (depth - mid(i)) / (mid(j) - mid(i)))) : 0;
        return [log.x[i] + t * (log.x[j] - log.x[i]), log.y[i] + t * (log.y[j] - log.y[i]), log.z[i] + t * (log.z[j] - log.z[i])];
    };

    /**
     * Where a hole is at any depth down it: on its path when that is known,
     * else on the line through the middles of its samples (all of them,
     * whatever they are logged as), carried on straight past the first and the
     * last. Null when it has no two samples at different depths to say where
     * it goes.
     */
    const lines = new Map<number[], { depth: number[]; row: number[] }>();
    const placeOn = (rows: number[], depth: number): Vec3 | null => {
        const at = log.placeAt?.(rows[0], depth);
        if (at) return at;
        let line = lines.get(rows);
        if (!line) {
            const mids = rows
                .filter(r => Number.isFinite(end[r]) && Number.isFinite(log.x[r]) && Number.isFinite(log.y[r]) && Number.isFinite(log.z[r]))
                .map(r => ({ r, d: (log.from[r] + end[r]) / 2 }))
                .sort((p, q) => p.d - q.d);
            line = { depth: [], row: [] };
            for (const m of mids) {
                if (line.depth.length > 0 && !(m.d - line.depth[line.depth.length - 1] > 1e-6)) continue;
                line.depth.push(m.d);
                line.row.push(m.r);
            }
            lines.set(rows, line);
        }
        const count = line.depth.length;
        if (count < 2) return null;
        let k = 0;
        while (k + 2 < count && line.depth[k + 1] < depth) k++;
        const i = line.row[k], j = line.row[k + 1];
        const t = (depth - line.depth[k]) / (line.depth[k + 1] - line.depth[k]);
        return [log.x[i] + t * (log.x[j] - log.x[i]), log.y[i] + t * (log.y[j] - log.y[i]), log.z[i] + t * (log.z[j] - log.z[i])];
    };
    /** No piece of an interval that is checked is longer than this */
    const piece = Math.max(PIECE_OF_USUAL * usual, 1);

    const contacts: number[] = [];
    const facing: Vec3 = [0, 0, 0];
    const checkRows: number[] = [], checkHole: number[] = [], checkToContact: number[] = [], checkSide: number[] = [];
    // (Per check: the depth of its middle, half its length, and where it is when that is not where its row is)
    const checkDepth: number[] = [], checkHalf: number[] = [], checkAt: (Vec3 | null)[] = [];
    let intervals = 0, inPieces = false;
    const middleRows: number[] = [], middleSide: number[] = [], middleHole: number[] = [], middleLength: number[] = [], middleAlong: number[] = [], middleOff: number[] = [];
    const between = (i: number, j: number): Vec3 => {
        const d: Vec3 = [log.x[j] - log.x[i], log.y[j] - log.y[i], log.z[j] - log.z[i]];
        const len = Math.hypot(d[0], d[1], d[2]);
        return len > 0 ? [d[0] / len, d[1] / len, d[2] / len] : [0, 0, 0];
    };
    let holes = 0, holesWithContact = 0, gapsLeftOut = 0;
    const join = rule.join !== undefined && rule.join > 0 ? rule.join : 0;
    // The plane the first side lies in is part of what is found: for zones, which are joined across it, and for thin sheets
    const planed = join > 0 || !!rule.sheets;
    let joinedGaps = 0, joinedMetres = 0;
    /** The runs of either side down a hole, as logged */
    const runsOf = (rows: number[]): Run[] => {
        const runs: Run[] = [];
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
        return runs;
    };
    // A join length is measured across the plane the first side lies in: as given; else the plane its stretches lie closest to,
    // unless the logging carries from hole to hole in another (a stack of sheets side by side)
    let joinPlane: Vec3 | null = null, joinPlaneFrom: ContactInputs['joinPlaneFrom'], cloudPlane: Vec3 | null = null, carries = false;
    if (planed || rule.gaps) {
        const mids: number[] = [];
        for (const rows of byHole.values()) for (const run of runsOf(rows)) if (run.side === 1) mids.push(...placeDown(rows, (run.start + run.end) / 2));
        cloudPlane = planeOfMany(mids);
        const given = rule.across ? unit(rule.across) : null;
        if (given) { joinPlane = given; joinPlaneFrom = rule.acrossFrom ?? 'given'; }
        else {
            // The logging of either side in pieces: where each is, and whether it is of the first side
            let logged = 0;
            for (let i = 0; i < n; i++) if (sideOf(i) !== 0 && end[i] > log.from[i]) logged += end[i] - log.from[i];
            const step = Math.max(1, logged / MAX_CARRY_PIECES);
            const pieces: CarryPieces & { positions: number[]; hole: number[]; unit: number[] } = { positions: [], hole: [], unit: [] };
            let h = 0;
            for (const rows of byHole.values()) {
                for (const i of rows) {
                    const side = sideOf(i), length = end[i] - log.from[i];
                    if (side === 0 || !(length > 0)) continue;
                    const k = Math.max(1, Math.round(length / step));
                    for (let j = 0; j < k; j++) {
                        pieces.positions.push(...placeDown(rows, log.from[i] + (j + 0.5) * length / k));
                        pieces.hole.push(h);
                        pieces.unit.push(side === 1 ? 1 : 0);
                    }
                }
                h++;
            }
            const carry = carryPlane(pieces);
            carries = !!carry;
            const apart = carry && cloudPlane ? Math.acos(Math.min(1, Math.abs(carry.normal[0] * cloudPlane[0] + carry.normal[1] * cloudPlane[1] + carry.normal[2] * cloudPlane[2]))) * 180 / Math.PI : Infinity;
            if (carry && apart > PLANES_APART) { joinPlane = carry.normal; joinPlaneFrom = 'carry'; }
            else if (cloudPlane) { joinPlane = cloudPlane; joinPlaneFrom = 'cloud'; }
        }
    }
    /** How far apart two stretches of a hole are, from the end of the upper to the start of the lower */
    const apart = (rows: number[], upEnd: number, downStart: number): number => {
        const gap = Math.max(0, downStart - upEnd);
        if (!joinPlane || gap === 0) return gap;
        const p = placeDown(rows, upEnd), q = placeDown(rows, downStart);
        const across = Math.abs((q[0] - p[0]) * joinPlane[0] + (q[1] - p[1]) * joinPlane[1] + (q[2] - p[2]) * joinPlane[2]);
        return Math.max(JOIN_FLOOR * gap, Math.min(gap, across));
    };
    const holeNames: string[] = [];
    let thinnest = Infinity;
    // The stretches of the first side that count, by hole (null: all do)
    let picked: Map<string, number[]> | null = null;
    // Picks that are in no stretch of the first side now, and the holes looked at for them
    const stalePicks: { hole: string; depth: number }[] = [];
    const pickedHoles = new Set<string>();
    if (rule.picks) {
        picked = new Map();
        for (const pick of rule.picks) { const list = picked.get(pick.hole); if (list) list.push(pick.depth); else picked.set(pick.hole, [pick.depth]); }
    }

    /** Where a zone is taken to start and stop when it is taken at its net thickness (null: where it does) */
    const netOf = (run: Run): [number, number] | null => {
        if (!rule.net || run.side !== 1 || run.unit === undefined || run.moment === undefined || !(run.unit > 0) || !(run.unit < run.end - run.start - 1e-6)) return null;
        const centre = run.moment / run.unit;
        return [Math.max(run.start, centre - run.unit / 2), Math.min(run.end, centre + run.unit / 2)];
    };
    const gaps: number[] = [];
    let zoneCount = 0, zoneLength = 0, zoneUnit = 0;

    for (const [holeName, rows] of byHole) {
        let runs = runsOf(rows);
        const forced = uncrossed.get(holeName);
        if (runs.length === 0 && !forced) continue;
        if (rule.gaps) for (let k = 1; k + 1 < runs.length; k++) if (runs[k].side === -1 && runs[k - 1].side === 1 && runs[k + 1].side === 1) gaps.push(apart(rows, runs[k - 1].end, runs[k + 1].start));
        if (join > 0 && runs.length > 2) {
            // Stretches of the first side close together are one zone: what is between them is on neither side
            const kept: Run[] = [];
            runs.forEach((run, k) => {
                const last = kept[kept.length - 1];
                if (run.side === -1 && k > 0 && k < runs.length - 1 && last && last.side === 1 && apart(rows, last.end, runs[k + 1].start) < join) {
                    joinedGaps++;
                    joinedMetres += Math.max(0, runs[k + 1].start - last.end);
                    return;
                }
                if (last && last.side === run.side) absorb(last, run);
                else kept.push({ ...run, rows: run.rows.slice() });
            });
            runs = kept;
        }
        if (picked) {
            // A stretch of the first side that is not one of those picked is other ground, with what is either side of it
            const mine = picked.get(holeName) ?? [];
            const own = new Set<Run>();
            for (const d of mine) {
                let hit = runs.find(run => d >= run.start - 1e-6 && d <= run.end + 1e-6) ?? null;
                if (!hit) {
                    // In a gap of the logging (a contact put half-way across one): the nearest stretch of the first side
                    let nearest = Infinity;
                    for (const run of runs) {
                        const away = Math.min(Math.abs(d - run.start), Math.abs(d - run.end));
                        if (run.side === 1 && away < nearest) { nearest = away; hit = run; }
                    }
                }
                if (hit && hit.side === 1) own.add(hit); else stalePicks.push({ hole: holeName, depth: d });
            }
            pickedHoles.add(holeName);
            const kept: Run[] = [];
            for (const run of runs) {
                const side = run.side === 1 && !own.has(run) ? -1 : run.side;
                const last = kept[kept.length - 1];
                if (last && last.side === side) absorb(last, run);
                else kept.push({ ...run, side, rows: run.rows.slice() });
            }
            runs = kept;
        }
        if (minRun > 0 && runs.length > 2) {
            // A thin unit inside the other side is left out, and the runs either side of it become one
            const kept: Run[] = [];
            runs.forEach((run, k) => {
                const inside = k > 0 && k < runs.length - 1;
                if (inside && run.end - run.start < minRun) return;
                const last = kept[kept.length - 1];
                if (last && last.side === run.side) absorb(last, run);
                else kept.push({ ...run, rows: run.rows.slice() });
            });
            runs = kept;
        }
        const holeIndex = holes++;
        holeNames.push(holeName);
        const depths: number[] = [];
        // Stretches the logging is not held to (either side of a contact left out), and intervals that are on the other side once a contact is moved
        const loose = new Set<Run>();
        const sideAs = new Map<number, 1 | -1>();
        for (let k = 0; k + 1 < runs.length; k++) {
            const up = runs[k], down = runs[k + 1];
            const gap = Math.max(0, down.start - up.end);
            if (gap > maxGap + 1e-9) { gapsLeftOut++; continue; }
            const i = up.last, j = down.first;
            const depth = (up.end + down.start) / 2;
            const mi = (log.from[i] + end[i]) / 2, mj = (log.from[j] + end[j]) / 2;
            const t = mj > mi ? Math.min(1, Math.max(0, (depth - mi) / (mj - mi))) : 0.5;
            const d: Vec3 = [log.x[j] - log.x[i], log.y[j] - log.y[i], log.z[j] - log.z[i]];
            const logged: Vec3 = log.placeAt?.(i, depth) ?? [log.x[i] + t * d[0], log.y[i] + t * d[1], log.z[i] + t * d[2]];
            const edit = editFor(control, holeName, depth);
            if (edit) matched.add(edit);
            if (forced) { list.push({ hole: holeName, depth, at: depth, p: logged, state: 'uncrossed', above: up.side }); continue; }
            if (edit?.ignore) {
                list.push({ hole: holeName, depth, at: depth, p: logged, state: 'ignored', above: up.side });
                loose.add(up);
                loose.add(down);
                continue;
            }
            // Moved: no further than the two stretches it lies between. Not moved, at the edge of a zone taken at its net
            // thickness: where that puts it
            const net = up.side === 1 ? netOf(up) : netOf(down);
            const wall = net ? (up.side === 1 ? net[1] : net[0]) : depth;
            const at = edit?.to !== undefined ? Math.min(down.end, Math.max(up.start, edit.to)) : wall;
            const moved = edit?.to !== undefined && Math.abs(at - depth) > 1e-9;
            const p = Math.abs(at - depth) > 1e-9 ? placeDown(rows, at) : logged;
            if (moved) {
                for (const r of at > depth ? down.rows : up.rows) {
                    const mid = (log.from[r] + end[r]) / 2;
                    if (at > depth ? mid < at : mid > at) sideAs.set(r, at > depth ? up.side : down.side);
                }
            }
            list.push({ hole: holeName, depth, at, p, state: moved ? 'moved' : 'kept', above: up.side });
            contacts.push(p[0], p[1], p[2]);
            depths.push(at);
            // From the second side towards the first
            const len = Math.hypot(d[0], d[1], d[2]);
            if (len > 0) for (let c = 0; c < 3; c++) facing[c] -= up.side * d[c] / len;
        }
        if (forced) {
            // The whole hole lies on one side: every interval of it is held there, and it is one stretch of that side
            for (const i of rows) { heldRows.push(i); heldSide.push(forced); heldHole.push(holeIndex); }
            const first = rows[0], last = rows[rows.length - 1];
            const middle = (log.from[first] + end[last]) / 2;
            let best = first, off = Infinity;
            for (const i of rows) {
                const d = Math.abs((log.from[i] + end[i]) / 2 - middle);
                if (d < off) { off = d; best = i; }
            }
            middleRows.push(best);
            middleOff.push(middle - (log.from[best] + end[best]) / 2);
            middleSide.push(forced);
            middleHole.push(holeIndex);
            middleLength.push(Math.max(0, end[last] - log.from[first]));
            middleAlong.push(...between(first, last));
            continue;
        }
        if (depths.length > 0) holesWithContact++;
        if (loose.size > 0) runs = runs.filter(run => !loose.has(run));
        for (const run of runs) {
            const net = netOf(run);
            if (run.side === 1) thinnest = Math.min(thinnest, net ? net[1] - net[0] : run.end - run.start);
            if (run.side === 1 && run.unit !== undefined && run.unit < run.end - run.start - 1e-6) { zoneCount++; zoneLength += run.end - run.start; zoneUnit += run.unit; }
            const middle = net ? (net[0] + net[1]) / 2 : (run.start + run.end) / 2;
            let best = run.rows[0], off = Infinity;
            for (const i of run.rows) {
                const d = Math.abs((log.from[i] + end[i]) / 2 - middle);
                if (d < off) { off = d; best = i; }
            }
            middleRows.push(best);
            middleOff.push(middle - (log.from[best] + end[best]) / 2);
            middleSide.push(run.side);
            middleHole.push(holeIndex);
            middleLength.push(net ? net[1] - net[0] : run.end - run.start);
            // Along the stretch itself where it has two samples, else along the whole hole
            middleAlong.push(...(run.first !== run.last ? between(run.first, run.last) : between(rows[0], rows[rows.length - 1])));
        }
        for (const run of runs) {
            for (const i of run.rows) {
                const length = end[i] - log.from[i];
                // A long interval, piece by piece (one whose side a moved contact has changed is left whole: its side goes by its middle)
                let parts = length > piece + 1e-9 && !sideAs.has(i) ? Math.ceil(length / piece - 1e-9) : 1;
                // (In a hole that cannot say where it goes, it is checked at its middle alone, and no more loosely than a piece would be)
                const unplaced = parts > 1 && !placeOn(rows, log.from[i]);
                if (unplaced) parts = 1;
                if (parts > 1) inPieces = true;
                intervals++;
                for (let q = 0; q < parts; q++) {
                    const mid = parts === 1 ? (log.from[i] + end[i]) / 2 : log.from[i] + (q + 0.5) * length / parts;
                    let nearest = Infinity;
                    for (const depth of depths) nearest = Math.min(nearest, Math.abs(depth - mid));
                    checkRows.push(i);
                    checkHole.push(holeIndex);
                    checkToContact.push(nearest);
                    checkSide.push(sideAs.get(i) ?? run.side);
                    checkDepth.push(mid);
                    checkHalf.push(unplaced ? piece / 2 : Math.max(0, length / parts / 2));
                    checkAt.push(parts === 1 ? null : placeOn(rows, mid));
                }
            }
        }
    }

    // The logged intervals, thinned when there are too many; then what is held by hand, all of it
    const stride = Math.max(1, Math.ceil(checkRows.length / MAX_CHECKS));
    const thinned = Math.ceil(checkRows.length / stride);
    const marks = (control?.marks ?? []).filter(mark => !(rule.lenses && mark.by !== undefined && mark.by > 0));
    // A mark that is to be clear of the surface by a distance is checked round itself as well, that far out each way:
    // the value of a fit is not a distance (across thin sheets it falls many times faster), so the middle alone does not say it
    const clearMarks = marks.filter(mark => mark.by !== undefined && mark.by > 0);
    const held = heldRows.length + marks.length + clearMarks.length * ROUND_A_MARK.length;
    const m = thinned + held;
    const checks: SideChecks = {
        positions: new Float64Array(m * 3), side: new Int8Array(m), slack: new Float32Array(m), toContact: new Float32Array(m), hole: new Int32Array(m),
        depth: new Float32Array(m).fill(NaN),
    };
    for (let k = 0; k < thinned; k++) {
        const at = k * stride, i = checkRows[at], p = checkAt[at];
        checks.positions[k * 3] = p ? p[0] : log.x[i];
        checks.positions[k * 3 + 1] = p ? p[1] : log.y[i];
        checks.positions[k * 3 + 2] = p ? p[2] : log.z[i];
        checks.side[k] = checkSide[at];
        checks.slack[k] = checkHalf[at];
        checks.toContact[k] = checkToContact[at];
        checks.hole[k] = checkHole[at];
        checks.depth![k] = checkDepth[at];
    }
    heldRows.forEach((i, n) => {
        const k = thinned + n;
        checks.positions.set([log.x[i], log.y[i], log.z[i]], k * 3);
        checks.side[k] = heldSide[n];
        // The whole interval is to be clear of the surface, not only its middle
        checks.slack[k] = -Math.max(0, (end[i] - log.from[i]) / 2);
        checks.toContact[k] = Infinity;
        checks.hole[k] = heldHole[n];
        checks.depth![k] = (log.from[i] + end[i]) / 2;
    });
    marks.forEach((mark, n) => {
        const k = thinned + heldRows.length + n;
        checks.positions.set(mark.p, k * 3);
        checks.side[k] = mark.side;
        // (One that is to be clear of the surface by a distance: held as an interval that must be clear of it is)
        if (mark.by !== undefined && mark.by > 0) checks.slack[k] = -mark.by;
        checks.toContact[k] = Infinity;
        // Each on its own: the worst of every "hole" is put right first
        checks.hole[k] = holes + n;
    });
    clearMarks.forEach((mark, n) => ROUND_A_MARK.forEach((d, j) => {
        const k = thinned + heldRows.length + marks.length + n * ROUND_A_MARK.length + j;
        checks.positions.set([mark.p[0] + d[0] * mark.by!, mark.p[1] + d[1] * mark.by!, mark.p[2] + d[2] * mark.by!], k * 3);
        checks.side[k] = mark.side;
        checks.toContact[k] = Infinity;
        checks.hole[k] = holes + marks.length + n * ROUND_A_MARK.length + j;
    }));
    // (A pick in a hole the logging no longer has is as stale as one in other ground)
    if (picked) for (const [hole, depths] of picked) if (!pickedHoles.has(hole)) for (const depth of depths) stalePicks.push({ hole, depth });
    const stale = {
        edits: (control?.edits ?? []).filter(e => !matched.has(e)),
        holes: [...uncrossed.keys()].filter(h => !byHole.has(h)),
        ...(stalePicks.length > 0 ? { picks: stalePicks } : {}),
    };

    const middles: RunMiddles = {
        positions: new Float64Array(middleRows.length * 3), side: Int8Array.from(middleSide),
        hole: Int32Array.from(middleHole), length: Float64Array.from(middleLength), along: Float64Array.from(middleAlong), off: Float64Array.from(middleOff),
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
    // (How far clear a mark is to be is part of what is fitted; a rule with none of those keeps the mark it had)
    if (marks.some(mark => mark.by !== undefined && mark.by > 0)) h = hashInto(h, new Uint8Array(Float64Array.from(marks, mark => mark.by ?? 0).buffer));
    const length = Math.hypot(facing[0], facing[1], facing[2]);
    return {
        contacts: points,
        facing: points.length > 0 && length > 1e-9 ? [facing[0] / length, facing[1] / length, facing[2] / length] : null,
        checks, holes, holesWithContact, gapsLeftOut, maxGap, intervals, ...(inPieces ? { piece } : {}),
        middles, thinnest: Number.isFinite(thinnest) ? thinnest : null,
        ...(joinedGaps > 0 ? { joined: { gaps: joinedGaps, metres: joinedMetres } } : {}),
        ...(zoneCount > 0 ? { zones: { count: zoneCount, length: zoneLength, unit: zoneUnit, net: !!rule.net } } : {}),
        ...(rule.gaps ? { gaps } : {}),
        // (With no join length the plane was worked out for the gaps alone, and is no part of what was found)
        ...(joinPlane && planed ? { joinPlane, joinPlaneFrom } : {}),
        ...(planed && carries ? { carries } : {}),
        ...(joinPlane && planed && cloudPlane && joinPlaneFrom !== 'cloud' ? { cloudPlane } : {}),
        list, stale, held, holeNames,
        // (The plane is part of what a vein is measured by: one that is not the cloud's is in the mark. The cloud's follows from the stretches)
        mark: `${(h >>> 0).toString(16)}:${points.length / 3}:${m}${joinPlane && planed && joinPlaneFrom !== 'cloud' ? `:${joinPlane.map(v => v.toFixed(5)).join(',')}` : ''}`,
    };
}

export interface SideReport {
    /** Logged intervals checked against the surface */
    checked: number;
    /** Of those, the ones still on the wrong side of it */
    wrong: number;
    /** Intervals the surface was made to respect on top of its contacts */
    added: number;
    /** A vein at its net thickness: logged intervals of it outside its walls, which is where that leaves them (not counted as wrong) */
    strands?: number;
    /** How many times it was fitted again, and why that stopped (absent: it was not) */
    rounds?: number;
    stopped?: 'right' | 'rounds' | 'room' | 'stuck' | 'unsolved';
}

/**
 * How far the rounds that put intervals on their own side may go: the
 * surface is refitted at most `rounds` times; at most `added` intervals are
 * added to what it is fitted to; at most `perRound` holes are put right in
 * one round, each at up to `perHole` places (no two nearer than
 * `APART_SHARE` of the hole's length).
 */
export interface SideLimits {
    rounds?: number;
    added?: number;
    perRound?: number;
    perHole?: number;
    /**
     * The middle of every interval must be on its own side. Without it an
     * interval may reach half its length across the surface and still count
     * as straddling it: right for a contact that is eased past its places,
     * but a thin body can then take in the half of every interval beside it.
     */
    strict?: boolean;
}
/** Round a mark held clear by a distance: the directions it is checked in as well, that far out (the six ways along the axes and the eight between them) */
const ROUND_A_MARK: readonly Vec3[] = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
    ...[-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z => [x / Math.sqrt(3), y / Math.sqrt(3), z / Math.sqrt(3)] as Vec3))),
];
export const SIDE_LIMITS: Required<Omit<SideLimits, 'strict'>> = { rounds: 12, added: 2000, perRound: 250, perHole: 3 };
const APART_SHARE = 1 / 6;
/** ... and no more rounds once this many in a row have left no fewer intervals on the wrong side than the best so far */
const STALE_ROUNDS = 4;
/**
 * A hole that never meets the contact has the surface beyond one of its ends.
 * A place this far down it from that end is taken to be this share of that
 * far from the surface (were the hole square to the surface it would be all
 * of it; the angle between them is allowed for as well).
 */
const BEYOND_SHARE = 0.5;

/**
 * For the checks of holes that never meet the contact and are on one side of
 * it all the way: how far from the surface each is at least, m (NaN for every
 * other check). The surface has to be beyond the end of such a hole, so the
 * further down it from that end, the further from the surface: by the length
 * of hole between, less for a hole at a low angle to the surface (`normal`:
 * across the surface, overall). The end it is beyond is the one the fit as it
 * stands (`f`) has nearer the wrong side.
 */
export function beyondEnds(checks: SideChecks, f: ArrayLike<number>, normal: Vec3 | null): Float32Array {
    const m = checks.side.length;
    const out = new Float32Array(m).fill(NaN);
    const depth = checks.depth;
    const len = normal ? Math.hypot(normal[0], normal[1], normal[2]) : 0;
    if (!depth || !normal || !(len > 0)) return out;
    const holes = new Map<number, { top: number; bottom: number; side: number; ok: boolean }>();
    for (let i = 0; i < m; i++) {
        const h = holes.get(checks.hole[i]);
        const plain = !Number.isFinite(checks.toContact[i]) && checks.slack[i] >= 0;
        if (!h) { holes.set(checks.hole[i], { top: i, bottom: i, side: checks.side[i], ok: plain }); continue; }
        if (!plain || checks.side[i] !== h.side) h.ok = false;
        if (depth[i] < depth[h.top]) h.top = i;
        if (depth[i] > depth[h.bottom]) h.bottom = i;
    }
    const share = new Map<number, { end: number; by: number }>();
    for (const [hole, h] of holes) {
        if (!h.ok || h.top === h.bottom) continue;
        const d: Vec3 = [0, 1, 2].map(k => checks.positions[h.bottom * 3 + k] - checks.positions[h.top * 3 + k]) as Vec3;
        const chord = Math.hypot(d[0], d[1], d[2]);
        if (!(chord > 0)) continue;
        const across = Math.abs(d[0] * normal[0] + d[1] * normal[1] + d[2] * normal[2]) / (chord * len);
        // The end with less of the field on its own side: the surface is, or has to go, beyond that one
        const end = h.side * f[h.top] <= h.side * f[h.bottom] ? h.top : h.bottom;
        share.set(hole, { end: depth[end], by: BEYOND_SHARE * across });
    }
    for (let i = 0; i < m; i++) {
        const sh = share.get(checks.hole[i]);
        if (sh) out[i] = sh.by * Math.abs(depth[i] - sh.end);
    }
    return out;
}

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
export function fitWithSides(input: SheetInput, checks: SideChecks | null, memo: SidesMemo | null = null): { fit: SheetFit; report: SideReport | null } {
    return refineSides(extra => fitSheet(extra ? { ...input, valued: extra } : input), checks, memo);
}

/**
 * What the rounds of one fit have come to so far: each fit made, and the
 * field of each at the checks. A fit that is stopped part way and run again
 * (surfaceJobs.runFitJobShared: its blocks are fitted by other workers
 * meanwhile) is given the same one each time, and takes up where it stopped:
 * gone through from the start every time, twelve rounds are seventy-eight.
 */
export interface SidesMemo {
    fits: SheetFit[];
    at: Float64Array[];
}

/**
 * The rounds of `fitWithSides`, for any kind of fit: `fitOnce` fits the
 * surface, with the given places held off it as well (null: none yet).
 */
export function refineSides(
    fitOnce: (extra: { positions: number[]; values: number[] } | null) => SheetFit, checks: SideChecks | null, memo: SidesMemo | null = null,
    limits: SideLimits | null = null,
): { fit: SheetFit; report: SideReport | null } {
    const MAX_ROUNDS = limits?.rounds ?? SIDE_LIMITS.rounds, MAX_ADDED = limits?.added ?? SIDE_LIMITS.added;
    const PER_ROUND = limits?.perRound ?? SIDE_LIMITS.perRound, PER_HOLE = limits?.perHole ?? SIDE_LIMITS.perHole;
    const strict = limits?.strict === true;
    /** The fit of a round: the one it came to before, when this is run again (what is held is the same each time) */
    const once = (k: number, extra: { positions: number[]; values: number[] } | null): SheetFit => {
        const had = memo?.fits[k];
        if (had) return had;
        const made = fitOnce(extra);
        if (memo) memo.fits[k] = made;
        return made;
    };
    let fit = once(0, null);
    const m = checks ? checks.side.length : 0;
    if (!checks || m === 0) return { fit, report: null };
    const positions: number[] = [], values: number[] = [];
    const used = new Uint8Array(m);
    // A step in the logging from one hole to the next cannot always be followed: putting one interval right can put
    // another wrong. So the fit with the fewest on the wrong side is the one kept, not the last
    let best: { fit: SheetFit; wrong: number; added: number } | null = null;
    let stale = 0, rounds = 0;
    let stopped: SideReport['stopped'] = 'right';
    const values0 = new Float64Array(m);
    // (How far from the surface the places in holes that never meet the contact are at least: worked out on the first fit)
    let beyond: Float32Array | null = null;
    /** How far on its own side a place is put when the surface is held off it */
    const held = (i: number): number => {
        // At least clear of it; in a hole that meets the contact, about half the way to where it does; in one that never does, as far as it is from the end the surface is beyond
        // (One that must be clear of it by a distance is put a little further than that, so that it then counts as clear)
        const clear = checks.slack[i] < 0 ? -1.1 * checks.slack[i] + 0.05 : Math.max(checks.slack[i], 0.1);
        const along = checks.toContact[i];
        if (Number.isFinite(along)) return Math.max(clear, along / 2);
        return beyond && Number.isFinite(beyond[i]) ? Math.max(clear, beyond[i]) : clear;
    };
    // (How much of each hole is checked, down it)
    const spans = new Map<number, number>();
    if (checks.depth) {
        const ends = new Map<number, [number, number]>();
        for (let i = 0; i < m; i++) {
            const e = ends.get(checks.hole[i]), d = checks.depth[i];
            if (!e) ends.set(checks.hole[i], [d, d]);
            else { if (d < e[0]) e[0] = d; if (d > e[1]) e[1] = d; }
        }
        for (const [hole, e] of ends) spans.set(hole, e[1] - e[0]);
    }
    for (let round = 0; ; round++) {
        if (!fit.field) return { fit, report: null };
        const f = memo?.at[round] ?? evaluateField(fit.field, checks.positions, memo ? new Float64Array(m) : values0);
        if (memo) memo.at[round] = f;
        if (!beyond) beyond = beyondEnds(checks, f, fit.trend?.normal ?? null);
        let wrong = 0;
        // Per hole, what is on the wrong side and not yet held
        const worst = new Map<number, { i: number; by: number }[]>();
        // In a hole that never meets the contact: the place furthest short of how far from the surface it has to be
        const short = new Map<number, { i: number; by: number }>();
        for (let i = 0; i < m; i++) {
            const by = -checks.side[i] * f[i] - (strict && checks.slack[i] > 0 ? 0 : checks.slack[i]);
            if (!used[i] && Number.isFinite(beyond[i])) {
                const lacks = beyond[i] - checks.side[i] * f[i];
                const sh = short.get(checks.hole[i]);
                if (lacks > 0 && (!sh || lacks > sh.by)) short.set(checks.hole[i], { i, by: lacks });
            }
            if (!(by > 0)) continue;
            wrong++;
            if (used[i]) continue;
            const w = worst.get(checks.hole[i]);
            if (w) w.push({ i, by });
            else worst.set(checks.hole[i], [{ i, by }]);
        }
        if (!best || wrong < best.wrong) { best = { fit, wrong, added: values.length }; stale = 0; } else stale++;
        const room = MAX_ADDED - values.length;
        if (wrong === 0) { stopped = 'right'; break; }
        if (round >= MAX_ROUNDS) { stopped = 'rounds'; break; }
        if (room <= 0) { stopped = 'room'; break; }
        if (stale >= STALE_ROUNDS || worst.size === 0) { stopped = 'stuck'; break; }
        for (const list of worst.values()) list.sort((p, q) => q.by - p.by);
        // The holes furthest out first, each at its worst place
        const picked = [...worst.values()].sort((p, q) => q[0].by - p[0].by).slice(0, Math.min(PER_ROUND, room));
        const hold = (i: number) => {
            if (used[i] || values.length >= MAX_ADDED) return;
            used[i] = 1;
            positions.push(checks.positions[i * 3], checks.positions[i * 3 + 1], checks.positions[i * 3 + 2]);
            values.push(checks.side[i] * held(i));
        };
        for (const list of picked) hold(list[0].i);
        // Then the same holes at other places well apart down them: one place a round takes many rounds where a
        // hole is out along much of its length
        const depth = checks.depth;
        for (const list of picked) {
            const hole = checks.hole[list[0].i];
            if (depth && list.length > 1) {
                const apart = APART_SHARE * (spans.get(hole) ?? 0);
                const taken = [list[0].i];
                for (let k = 1; k < list.length && taken.length < PER_HOLE; k++) {
                    const i = list[k].i;
                    if (!(apart > 0) || taken.some(t => Math.abs(depth[t] - depth[i]) < apart)) continue;
                    taken.push(i);
                    hold(i);
                }
            }
            // A hole that never meets the contact: held where it is furthest short as well, or the surface, put just clear of
            // the one place, comes back across the hole further down it
            const far = short.get(hole);
            if (far) hold(far.i);
        }
        const next = once(round + 1, { positions, values });
        // Could not be solved with these as well: keep what there was
        if (!next.field) { stopped = 'unsolved'; break; }
        fit = next;
        rounds = round + 1;
    }
    return { fit: best!.fit, report: { checked: m, wrong: best!.wrong, added: best!.added, rounds, stopped } };
}
