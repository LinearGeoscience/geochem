/**
 * Where a surface misses what it was built from (pure, unit-tested): each
 * of its points, contacts and line nodes it passes further from than a
 * tolerance, and each logged interval (or place held by hand) that is on the
 * wrong side of it. For a sheet, a contact surface or a closed body; a shell
 * is checked another way (its hold-out check).
 *
 * The surface is where its field is zero, and away from it the field is
 * about the distance to it in metres, positive on the first side: so the
 * field at a place the surface should pass through is how far it misses.
 */
import type { ContactInputs } from './contacts';
import { evaluateField, type FittedField } from './rbf';
import type { SurfaceObject, Vec3 } from './types';

/** A surface passes through a place when it is within this of it, m */
export const MISFIT_TOLERANCE = 0.05;
/** At most this many are listed (the worst first); all are counted */
export const MAX_LISTED = 200;

export interface Miss {
    /** point / contact / node: a place it should pass through. interval: logging on the wrong side. held: a place or a hole held to a side by hand */
    kind: 'point' | 'contact' | 'node' | 'interval' | 'held';
    /** What it is, in words: "Point 3", "Contact in DH12 at 45.5 m", "Line 2, node 4", "DH12 at 50 m, logged FR" */
    label: string;
    p: Vec3;
    /** How far the surface is from where it should be there, m (an interval: how far past the surface it lies, beyond straddling it) */
    by: number;
}

export interface MisfitReport {
    /** The places it should pass through, and how many of them it passes further from than the tolerance */
    inputs: number;
    missed: number;
    /** The furthest it passes from any of them, m */
    worst: number;
    /** Logged intervals (and places held by hand) checked, and how many are on the wrong side */
    checked: number;
    wrong: number;
    /** A vein at its net thickness: logged intervals of it outside its walls, where that leaves them (not counted as wrong, not listed) */
    strands?: number;
    /** Long intervals were checked piece by piece: what is counted is places down the logging, not whole intervals */
    inPieces?: boolean;
    /** The misses and the wrong sides, the worst first (at most `MAX_LISTED`) */
    list: Miss[];
    tolerance: number;
}

const metres = (v: number) => `${Number(v.toFixed(2))} m`;

/**
 * `sides`: the names of the surface's two sides, for saying which side an
 * interval was logged on. `found`: what the logging gives a surface made
 * from it (null: a surface built by hand).
 */
export function surfaceMisfit(
    surface: SurfaceObject, field: FittedField, found: ContactInputs | null, sides: readonly [string, string] = ['first', 'second'], tolerance = MISFIT_TOLERANCE,
): MisfitReport {
    const places: number[] = [];
    const what: { kind: Miss['kind']; label: string }[] = [];
    // A vein: a place with a dip or a direction, and every line, is on its reference surface (the middle of it), not on a wall
    const vein = surface.rule.kind === 'body' && !!surface.rule.vein;
    const onReference: boolean[] = [];
    const put = (p: ArrayLike<number>, kind: Miss['kind'], label: string, reference = false) => { places.push(p[0], p[1], p[2]); what.push({ kind, label }); onReference.push(reference); };

    surface.points.forEach((point, i) => put(point.p, 'point', `Point ${i + 1}${point.snap ? ` (${point.snap.hole} at ${metres(point.snap.depth)})` : ''}`, vein && !!(point.reading || point.direction)));
    surface.polylines.forEach((line, l) => line.points.forEach((v, k) => put(v, 'node', `Line ${l + 1}, node ${k + 1}`, vein)));
    for (const c of found?.list ?? []) {
        if (c.state === 'kept' || c.state === 'moved') put(c.p, 'contact', `Contact in ${c.hole} at ${metres(c.at)}${c.state === 'moved' ? ' (moved)' : ''}`);
    }
    const inputs = what.length;
    const sideName = (side: number) => sides[side > 0 ? 0 : 1].replace(/ side$/, '');

    const checks = found?.checks ?? null;
    const checked = checks ? checks.side.length : 0;
    const all = new Float64Array(places.length + checked * 3);
    all.set(places);
    if (checks) all.set(checks.positions, places.length);
    const f = all.length > 0 ? evaluateField(field, all) : new Float64Array(0);
    if (field.walls && onReference.some(Boolean)) {
        const middle = evaluateField({ ...field, walls: null }, places);
        onReference.forEach((reference, i) => { if (reference) f[i] = middle[i]; });
    }

    // A vein that ends on another surface: what is beyond that surface is not held against it
    const end = field.walls?.ends ?? null;
    const past = end && all.length > 0 ? evaluateField(end.field, all) : null;
    const beyond = (i: number) => !!past && !(end!.side * past[i] > 0);
    let left = 0, unchecked = 0;

    const list: Miss[] = [];
    let missed = 0, worst = 0, wrong = 0, strands = 0;
    const net = surface.rule.kind === 'body' && surface.rule.vein?.thickness === 'net' && (surface.rule.vein.join ?? 0) > 0;
    for (let i = 0; i < inputs; i++) {
        if (beyond(i)) { left++; continue; }
        const by = Math.abs(f[i]);
        if (by > worst) worst = by;
        if (!(by > tolerance)) continue;
        missed++;
        list.push({ ...what[i], p: [places[i * 3], places[i * 3 + 1], places[i * 3 + 2]], by });
    }
    for (let k = 0; k < checked; k++) {
        if (beyond(inputs + k)) { unchecked++; continue; }
        const by = -checks!.side[k] * f[inputs + k] - checks!.slack[k];
        if (!(by > 0)) continue;
        const held = k >= checked - found!.held;
        if (net && !held && checks!.side[k] > 0) { strands++; continue; }
        wrong++;
        const hole = found!.holeNames[checks!.hole[k]];
        const depth = checks!.depth?.[k] ?? NaN;
        const side = sideName(checks!.side[k]);
        const label = !hole ? `Place marked on the ${side} side`
            : `${hole}${Number.isFinite(depth) ? ` at ${metres(depth)}` : ''}, ${held ? `held ${side}` : `logged ${side}`}`;
        list.push({ kind: held ? 'held' : 'interval', label, p: [checks!.positions[k * 3], checks!.positions[k * 3 + 1], checks!.positions[k * 3 + 2]], by });
    }
    list.sort((a, b) => b.by - a.by);
    return { inputs: inputs - left, missed, worst, checked: checked - unchecked, wrong, list: list.slice(0, MAX_LISTED), tolerance, ...(found?.piece ? { inPieces: true } : {}), ...(strands > 0 ? { strands } : {}) };
}

/** The read-out in a sentence or two */
export function misfitText(r: MisfitReport): string[] {
    const out: string[] = [];
    if (r.inputs > 0) {
        out.push(r.missed === 0
            ? `It passes within ${metres(r.tolerance)} of ${r.inputs === 1 ? 'its one place' : `all ${r.inputs.toLocaleString()} of its places`}.`
            : `It misses ${r.missed.toLocaleString()} of its ${r.inputs.toLocaleString()} places by more than ${metres(r.tolerance)}, the worst by ${metres(r.worst)}.`);
    }
    if (r.checked > 0) {
        out.push(r.wrong === 0
            ? `Nothing logged is on the wrong side of it (${r.checked.toLocaleString()} checked).`
            : `${r.wrong.toLocaleString()} of ${r.checked.toLocaleString()} ${r.inPieces ? 'places checked down the logging' : 'logged intervals'} and held places ${r.wrong === 1 ? 'is' : 'are'} on the wrong side of it.`);
        if (r.strands) out.push(`${r.strands.toLocaleString()} more ${r.strands === 1 ? 'is' : 'are'} of the vein and outside its walls: at its net thickness that is where they are left.`);
    }
    return out;
}
