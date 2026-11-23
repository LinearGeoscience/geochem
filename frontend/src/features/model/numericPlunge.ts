/**
 * Phase 272: the plunge of a numeric model's highs, set as that model's own
 * in one step (pure, unit-tested).
 *
 * The plunge finder (plungeScan.ts) gives a line: so many degrees below
 * level, towards a bearing. A surface follows a line only within a plane
 * (`OverallStructure`: a plane, and the bearing of the long direction in
 * it), so the line found is put into a plane: the model's own global trend
 * where its shells have one, else the scene's, else the plane the scan's
 * bright band follows, else none (the line alone). Where the line found
 * does not lie in that plane, the line in the plane nearest it is what is
 * set, and how far out it was is said.
 */
import { normalFromDip } from './plane';
import { DEFAULT_LINE_STRENGTH, DEFAULT_STRENGTH } from './structure';
import type { OverallStructure, Vec3 } from './types';

const RAD = Math.PI / 180;
const turn = (v: number) => ((v % 360) + 360) % 360;

/** A line: degrees below level, and the bearing it plunges towards */
export interface FoundLine { plunge: number; trend: number }
/** A plane: its dip, and the bearing it dips towards */
export interface FoundPlane { dip: number; direction: number }

/** Where the plane a plunge is set within came from: the shells' own global trend, the scene's, the scan's band, or none (the line alone) */
export type PlungePlane = 'own' | 'model' | 'band' | 'line';

export interface PlungeSet {
    /** What every shell of the model is given as its own global trend */
    structure: OverallStructure;
    planeFrom: PlungePlane;
    /** How far the line found lies out of that plane, degrees */
    off: number;
}

const lineVector = (l: FoundLine): Vec3 => [Math.sin(l.trend * RAD) * Math.cos(l.plunge * RAD), Math.cos(l.trend * RAD) * Math.cos(l.plunge * RAD), -Math.sin(l.plunge * RAD)];

/**
 * The line in a plane nearest a line: its bearing and plunge, and how far
 * out of the plane the line was. Null when the line is square to the plane
 * (no line in it is nearer than another).
 */
export function lineInPlane(plane: FoundPlane, line: FoundLine): (FoundLine & { off: number }) | null {
    const n = normalFromDip(plane.dip, plane.direction), v = lineVector(line);
    const d = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
    let w: Vec3 = [v[0] - d * n[0], v[1] - d * n[1], v[2] - d * n[2]];
    const length = Math.hypot(w[0], w[1], w[2]);
    if (length < 1e-3) return null;
    w = [w[0] / length, w[1] / length, w[2] / length];
    if (w[2] > 0) w = [-w[0], -w[1], -w[2]];
    const level = Math.hypot(w[0], w[1]);
    return {
        // (Straight down the plane: towards the way it dips)
        trend: level < 1e-9 ? turn(plane.direction) : turn(Math.atan2(w[0], w[1]) / RAD),
        plunge: Math.asin(Math.min(1, Math.max(0, -w[2]))) / RAD,
        off: Math.asin(Math.min(1, Math.abs(d))) / RAD,
    };
}

/**
 * A line found, as a global trend: within the plane of `own` (the shells'
 * own global trend) where there is one, else of `scene` (the scene's), else
 * of `band` (the plane the scan's bright band follows); the pull along the
 * plane is theirs and is not changed. With no plane at all, the line alone:
 * carried further down it, and no further any other way.
 */
export function plungeStructure(line: FoundLine, own: OverallStructure | null, scene: OverallStructure | null, band: FoundPlane | null): PlungeSet {
    const base = own ?? scene;
    const plane = base ? { dip: base.dip, direction: base.dipDirection } : band;
    const within = plane ? lineInPlane(plane, line) : null;
    if (plane && within) {
        return {
            structure: {
                dip: plane.dip, dipDirection: plane.direction, lineTrend: Math.round(within.trend * 10) / 10,
                strength: base ? base.strength : DEFAULT_STRENGTH,
                lineStrength: base && base.lineTrend !== null && base.lineStrength > 1 ? base.lineStrength : DEFAULT_LINE_STRENGTH,
            },
            planeFrom: own ? 'own' : scene ? 'model' : 'band',
            off: within.off,
        };
    }
    // (The plane that dips down the line holds it; with no pull along the plane only the line counts)
    return { structure: { dip: line.plunge, dipDirection: turn(line.trend), lineTrend: turn(line.trend), strength: 1, lineStrength: DEFAULT_LINE_STRENGTH }, planeFrom: 'line', off: 0 };
}

/** A global trend with its long direction taken away: the plane as it was, or nothing where the plane pulled no way */
export function withoutPlunge(own: OverallStructure): OverallStructure | null {
    return own.strength > 1 ? { ...own, lineTrend: null } : null;
}

/** Where the plane came from, in words */
export function planeFromText(from: PlungePlane): string {
    return from === 'own' ? 'within the plane of the global trend its shells had'
        : from === 'model' ? 'within the plane of the project’s global trend'
        : from === 'band' ? 'within the plane the highs lie in, as the scan found it'
        : 'with no plane: carried further down the line only';
}
