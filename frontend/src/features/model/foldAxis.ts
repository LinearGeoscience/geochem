/**
 * The line a set of planes share (pure).
 *
 * The limbs of a fold all hold one line: its axis. So do planes measured
 * round a hinge. Measured as planes, that shows as their poles (the lines
 * square to them) all lying in one plane, and the axis is the line square
 * to that. It is found as the direction the poles have least of: the
 * direction that the sum of the squares of the poles' parts along it is
 * least for.
 *
 * Planes that all lie alike share every line in them, so they give no axis;
 * planes that lie every way share none.
 */
import { jacobiEigendecomposition } from '../../utils/calculations/eigen';
import { normalFromDip } from './plane';
import { anglesText, lineFromStroke, type Angles } from './structureReadings';
import type { Vec3 } from './types';

export interface SharedLine {
    /**
     * 'line': the planes share one line. 'alike': they all lie much alike,
     * and share no one line. 'none': they lie every way, and share none.
     */
    kind: 'line' | 'alike' | 'none';
    planes: number;
    /** The line, as a plunge and the bearing it plunges towards, and down its plunge as a unit vector */
    line: Angles;
    axis: Vec3;
    /** How far the planes are from holding the line, degrees: the usual angle between the line and a plane */
    off: number;
    /** How far the planes turn about the line, degrees: the usual angle of a plane from the middle one */
    turn: number;
}

/** The planes hold the line to within this, degrees */
export const SHARED_WITHIN = 12;
/** ... and turn about it by this at least, or they all lie alike */
export const TURN_AT_LEAST = 8;
/** Fewer planes than this say nothing */
export const MIN_PLANES = 4;

const DEG = 180 / Math.PI;

export function sharedLine(planes: readonly Angles[]): SharedLine | null {
    const n = planes.length;
    if (n < MIN_PLANES) return null;
    const t = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const p of planes) {
        const m = normalFromDip(p.dip, p.direction);
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) t[a][b] += m[a] * m[b] / n;
    }
    const { eigenvalues, eigenvectors } = jacobiEigendecomposition(t);
    // The least: the direction the poles have least of
    let least = 0, most = 0;
    for (let k = 1; k < 3; k++) { if (eigenvalues[k] < eigenvalues[least]) least = k; if (eigenvalues[k] > eigenvalues[most]) most = k; }
    const mid = 3 - least - most;
    const v = eigenvectors[least];
    const line = lineFromStroke([0, 0, 0], v);
    if (!line) return null;
    const axis: Vec3 = v[2] > 0 ? [-v[0], -v[1], -v[2]] : [v[0], v[1], v[2]];
    const off = Math.asin(Math.sqrt(Math.min(1, Math.max(0, eigenvalues[least])))) * DEG;
    const turn = Math.asin(Math.sqrt(Math.min(1, Math.max(0, eigenvalues[mid])))) * DEG;
    const kind = turn < TURN_AT_LEAST ? 'alike' : off <= SHARED_WITHIN && turn >= 2 * off ? 'line' : 'none';
    return { kind, planes: n, line, axis, off, turn };
}

/** What a set of planes share, in a sentence (null: too few to say) */
export function sharedLineText(shared: SharedLine | null): string | null {
    if (!shared) return null;
    const within = `${Math.max(1, Math.round(shared.off))}°`;
    if (shared.kind === 'alike') return 'These planes all lie much alike, so they share no one line.';
    if (shared.kind === 'none') return `These planes share no one line: the nearest to one is ${anglesText('line', shared.line)}, and they are ${within} off it.`;
    return `These planes all hold one line, ${anglesText('line', shared.line)}, to within ${within}. If they are the limbs of one fold, that is its axis.`;
}
