/**
 * A proportion (Phase 261): how much of the ground is a logged unit, as a
 * number at any place, where the unit is too thin and too broken up to be
 * drawn as a solid (dykes of a few centimetres to a metre, a few to a hole).
 *
 * The logging is cut into pieces of a set length down each hole, and each
 * piece counts as the share of it that is the unit (30 cm of dyke in a metre
 * is 0.3). Those shares are numbers down the holes like any assay: a shell
 * is put round the ground where the share round about is at or above a
 * share (`ShellRule.of`), fitted loosely, a few pieces taken together. The
 * fitted field, plus the share it is drawn at, is then the share at any
 * place (`shareAt`), and added up over ground it is the volume of the unit
 * that ground implies (`shareWithin`).
 *
 * It says how much, not where: a place with a share of 0.2 has dykes making
 * up a fifth of it, and nothing says which fifth.
 */
import { findContacts, sidesRule, type HoleLog } from './contacts';
import { normalFromDip } from './plane';
import { evaluateField, type FittedField, type Stretch } from './rbf';
import { SHARE_LOCAL, type ShellSamples } from './shell';
import type { Box3, ShareOf, ShellRule, Vec3 } from './types';

export { SHARE_LOCAL };

/** The pieces of hole a share is worked out over are this long unless set, m */
export const SHARE_LENGTH = 1;
/** It is carried this many times further along the plane of the unit's sheets than across them, unless set */
export const SHARE_STRENGTH = 4;
/**
 * The shares a proportion's shells are drawn at when none are typed. Low: a few pieces taken together even a
 * sheet out over metres of hole, so ground a quarter dyke is already the thick of it
 */
export const SHARE_SHELLS = [0.05, 0.1, 0.25];

/** What a proportion is called: "FGRA share", "FGRA + QV share" */
export const shareName = (of: Pick<ShareOf, 'inside'>): string => `${of.inside.join(' + ')} share`;

/** A share as it is said: 0.25 > "25%", 0.025 > "2.5%". `round`: one that was worked out, not typed, to two figures (0.163 > "16%") */
export const sharePercent = (share: number, round = false): string => `${Number((100 * share).toPrecision(round || share < 0.1 ? 2 : 3))}%`;

/**
 * The logging as pieces of `of.length` down each hole, each with the share
 * of its logged length that is the units of `of.inside`. A piece less than
 * half logged is left out (codes in `of.ignore`, and blanks, are not
 * logging). The pieces of a hole start at its first logged depth.
 */
export function shareSamples(log: HoleLog, of: Pick<ShareOf, 'inside' | 'ignore' | 'length'>): ShellSamples {
    const inside = new Set(of.inside.map(c => c.trim()));
    const ignore = new Set((of.ignore ?? []).map(c => c.trim()));
    const length = of.length > 0 ? of.length : SHARE_LENGTH;
    const n = log.from.length;
    const byHole = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
        const hole = log.hole[i];
        if (!hole || !Number.isFinite(log.from[i]) || !Number.isFinite(log.x[i]) || !Number.isFinite(log.y[i]) || !Number.isFinite(log.z[i])) continue;
        const rows = byHole.get(hole);
        if (rows) rows.push(i);
        else byHole.set(hole, [i]);
    }
    const out = { hole: [] as string[], from: [] as number[], to: [] as number[], x: [] as number[], y: [] as number[], z: [] as number[], value: [] as number[] };
    for (const [hole, rows] of byHole) {
        rows.sort((p, q) => log.from[p] - log.from[q]);
        // Where each interval ends: its To, else where the next one starts
        const end = rows.map((i, k) => {
            const to = log.to ? log.to[i] : NaN;
            return Number.isFinite(to) && to > log.from[i] ? to : k + 1 < rows.length ? log.from[rows[k + 1]] : NaN;
        });
        const mid = (k: number) => (Number.isFinite(end[k]) ? (log.from[rows[k]] + end[k]) / 2 : log.from[rows[k]]);
        /** Where the hole is at a depth: on its path when that is known, else between the middles of two intervals */
        const placeAt = (depth: number): Vec3 => {
            const at = log.placeAt?.(rows[0], depth);
            if (at) return at;
            let k = 0;
            while (k + 2 < rows.length && mid(k + 1) < depth) k++;
            const i = rows[k], j = rows[Math.min(k + 1, rows.length - 1)];
            const a = mid(k), b = mid(Math.min(k + 1, rows.length - 1));
            // (Carried on straight past the first and the last middle)
            const t = b > a ? (depth - a) / (b - a) : 0;
            return [log.x[i] + t * (log.x[j] - log.x[i]), log.y[i] + t * (log.y[j] - log.y[i]), log.z[i] + t * (log.z[j] - log.z[i])];
        };
        const logged = rows.map(i => { const code = (log.code[i] ?? '').trim(); return code !== '' && !ignore.has(code); });
        const first = rows.findIndex((_, k) => logged[k] && Number.isFinite(end[k]));
        if (first < 0) continue;
        let last = first;
        for (let k = first; k < rows.length; k++) if (logged[k] && Number.isFinite(end[k])) last = k;
        const start = log.from[rows[first]], stop = end[last];
        let k0 = first;
        for (let a = start; a < stop - 1e-9; a += length) {
            const b = a + length;
            while (k0 < rows.length && !(end[k0] > a)) k0++;
            let all = 0, unit = 0;
            for (let k = k0; k < rows.length && log.from[rows[k]] < b; k++) {
                if (!logged[k] || !Number.isFinite(end[k])) continue;
                const over = Math.min(b, end[k]) - Math.max(a, log.from[rows[k]]);
                if (!(over > 0)) continue;
                all += over;
                if (inside.has((log.code[rows[k]] ?? '').trim())) unit += over;
            }
            if (all < length / 2) continue;
            const p = placeAt(Math.min(stop, a + length / 2));
            out.hole.push(hole); out.from.push(a); out.to.push(b);
            out.x.push(p[0]); out.y.push(p[1]); out.z.push(p[2]);
            out.value.push(unit / all);
        }
    }
    return out;
}

/** What a proportion's pieces are fitted as, for a shell drawn at a share: how far each is above it (as shell.ts `shellFitting`) */
export function shareValues(values: ArrayLike<number>, share: number): Float64Array {
    const out = new Float64Array(values.length);
    for (let i = 0; i < out.length; i++) out[i] = values[i] - share;
    return out;
}

/** How every shell of a proportion is found: a shell's rule but for the share it is drawn at */
export function shareRule(of: ShareOf, local: number | null = null): Omit<ShellRule, 'cutoff'> {
    return { kind: 'shell', column: shareName(of), log: false, composite: null, topCut: null, band: false, reach: null, ...(local !== null && local > 0 ? { local } : {}), of };
}

/** What a proportion is the share of, as stored. Null: unreadable */
export function readShareOf(raw: unknown): ShareOf | null {
    const o = raw as Partial<ShareOf> | null | undefined;
    if (!o || typeof o.column !== 'string' || !o.column) return null;
    const units = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).filter((u): u is string => typeof u === 'string' && u.trim() !== '').map(u => u.trim()))];
    const inside = units(o.inside);
    if (inside.length === 0) return null;
    const ignore = units(o.ignore).filter(u => !inside.includes(u));
    const plane = o.plane && Number.isFinite(o.plane.dip) && Number.isFinite(o.plane.dipDirection) ? { dip: o.plane.dip, dipDirection: o.plane.dipDirection } : null;
    return {
        ...(typeof o.table === 'string' && o.table ? { table: o.table } : {}),
        column: o.column, inside, ...(ignore.length > 0 ? { ignore } : {}),
        length: Number.isFinite(o.length) && o.length! > 0 ? o.length! : SHARE_LENGTH,
        ...(Number.isFinite(o.strength) && o.strength! >= 1 ? { strength: o.strength } : {}),
        ...(plane ? { plane } : {}),
    };
}

/** Shares as they are kept: between 0 and 1, each once, the lowest first */
export function cleanShares(raw: readonly number[]): number[] {
    return [...new Set(raw.filter(v => Number.isFinite(v) && v > 0 && v < 1).map(v => Number(v.toPrecision(4))))].sort((a, b) => a - b);
}

/** Shares typed in a box as percentages, "5, 10 25": null when a piece is not a number above 0 and under 100 */
export function parseShares(text: string): number[] | null {
    const pieces = text.split(/[\s,;%]+/).filter(Boolean);
    const values = pieces.map(Number);
    return pieces.length > 0 && values.every(v => Number.isFinite(v) && v > 0 && v < 100) ? cleanShares(values.map(v => v / 100)) : null;
}

/** The space a proportion is fitted in: stretched across the plane of its units' sheets */
export interface ShareFrame {
    stretch: Stretch | null;
    /** The plane of the sheets (its pole), and where that is from (null: nothing gives one) */
    plane: Vec3 | null;
    planeFrom: 'given' | 'data' | 'cloud' | 'carry' | null;
    strength: number;
}

/**
 * The plane of the sheets of a proportion's units, as an intrusion of thin
 * sheets has it (typed, else from how its stretches carry from hole to hole,
 * else the plane its stretches lie closest to), and the space stretched
 * across it about the middle of `box`.
 */
export function shareFrame(of: ShareOf, log: HoleLog, box: Box3 | null): ShareFrame {
    const strength = of.strength !== undefined && of.strength >= 1 ? of.strength : SHARE_STRENGTH;
    let plane: Vec3 | null = null, planeFrom: ShareFrame['planeFrom'] = null;
    if (of.plane) { plane = normalFromDip(of.plane.dip, of.plane.dipDirection); planeFrom = 'given'; }
    else if (strength > 1) {
        const found = findContacts(log, sidesRule({ kind: 'body', column: of.column, inside: of.inside, ignore: of.ignore ?? [], maxGap: null, minRun: null, sheets: {} }));
        if (found.joinPlane) { plane = [found.joinPlane[0], found.joinPlane[1], found.joinPlane[2]]; planeFrom = found.joinPlaneFrom ?? 'cloud'; }
    }
    if (!plane || !(strength > 1)) return { stretch: null, plane, planeFrom, strength: 1 };
    let point: Vec3;
    if (box) point = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
    else {
        point = [0, 0, 0];
        let n = 0;
        for (let i = 0; i < log.x.length; i++) if (Number.isFinite(log.x[i]) && Number.isFinite(log.y[i]) && Number.isFinite(log.z[i])) { point[0] += log.x[i]; point[1] += log.y[i]; point[2] += log.z[i]; n++; }
        if (n > 0) point = [point[0] / n, point[1] / n, point[2] / n];
    }
    return { stretch: { normal: plane, point, factor: strength }, plane, planeFrom, strength };
}

/** The share of the unit at places, from the field of a shell drawn at a share: between 0 and 1 */
export function shareAt(field: FittedField, positions: ArrayLike<number>, share: number): Float64Array {
    const f = evaluateField(field, positions);
    const out = new Float64Array(f.length);
    for (let i = 0; i < out.length; i++) { const v = f[i] + share; out[i] = v > 1 ? 1 : v > 0 ? v : 0; }
    return out;
}

/** What a field of shares adds up to over a box of ground */
export interface ShareSum {
    /** The mean share inside the shell (where the share is at or above the one it is drawn at); null: nothing of the box is inside it */
    inside: number | null;
    /** All the share in the box, over the share inside the shell (1: none of the unit is said to be outside it) */
    allOverInside: number | null;
}

/**
 * The shares of a field added up over a lattice of at most about `most`
 * places through `box`. `keep`: which places count (ground a shell is kept
 * inside; absent: all of them).
 */
export function shareWithin(field: FittedField, share: number, box: Box3, most = 120_000, keep?: (positions: Float64Array) => ArrayLike<number | boolean>): ShareSum {
    const size = [0, 1, 2].map(k => Math.max(0, box.max[k] - box.min[k]));
    const volume = size[0] * size[1] * size[2];
    if (!(volume > 0)) return { inside: null, allOverInside: null };
    const step = Math.cbrt(volume / most);
    const n = size.map(s => Math.max(1, Math.round(s / step)));
    const positions = new Float64Array(n[0] * n[1] * n[2] * 3);
    let q = 0;
    for (let i = 0; i < n[0]; i++) for (let j = 0; j < n[1]; j++) for (let k = 0; k < n[2]; k++) {
        positions[q++] = box.min[0] + (i + 0.5) * size[0] / n[0];
        positions[q++] = box.min[1] + (j + 0.5) * size[1] / n[1];
        positions[q++] = box.min[2] + (k + 0.5) * size[2] / n[2];
    }
    const s = shareAt(field, positions, share);
    const counted = keep ? keep(positions) : null;
    let all = 0, inSum = 0, inCount = 0;
    for (let i = 0; i < s.length; i++) {
        if (counted && !counted[i]) continue;
        all += s[i];
        if (s[i] >= share) { inSum += s[i]; inCount++; }
    }
    return { inside: inCount > 0 ? inSum / inCount : null, allOverInside: inSum > 0 ? all / inSum : null };
}
