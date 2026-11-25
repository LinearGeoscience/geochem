/**
 * A numeric model along the sheets of a body or a vein (Phase 283). Highs
 * that sit in thin sheets (in dykes, in veins) carry further along the
 * plane of the sheets than across it; a shell that knows no plane draws
 * them as bubbles round each run of high samples. The plane is not found
 * from the grade: it is taken from a body or a vein that is fitted to the
 * sheets (the plane its logging carries in from hole to hole, or the one it
 * was given), and set as the model's own global trend, so that every shell
 * of it carries further along it. A plunge the model already has is kept.
 *
 * Nothing is kept of where the plane came from: whether the model still
 * lies as a body's sheets do is read from the two as they are now.
 */
import { dipFromNormal } from './plane';
import type { OverallStructure } from './types';

/** How many times further along the plane than across it, unless typed (what the trial of Phase 283 kept) */
export const PLANE_STRENGTH = 4;
/** Two planes closer than this, degrees, are the same lie */
export const SAME_LIE = 3;

const RAD = Math.PI / 180;

/** How a plane lies: its dip, and the bearing it dips towards, degrees */
export interface Lie { dip: number; dipDirection: number }

const round = (v: number) => Math.round(v * 10) / 10;

/** The lie of a plane from its normal, to a tenth of a degree */
export function lieOf(normal: ArrayLike<number>): Lie {
    const { dip, dipDirection } = dipFromNormal(normal);
    // (Brought into 0 to 360 before it is rounded: after, the remainder is a digit out, 272.29999999999995)
    const towards = round(((dipDirection % 360) + 360) % 360);
    return { dip: round(dip), dipDirection: towards >= 360 ? 0 : towards };
}

const pole = (l: Lie): [number, number, number] => [Math.sin(l.dip * RAD) * Math.sin(l.dipDirection * RAD), Math.sin(l.dip * RAD) * Math.cos(l.dipDirection * RAD), Math.cos(l.dip * RAD)];

/** The angle between two planes, degrees */
export function liesApart(a: Lie, b: Lie): number {
    const p = pole(a), q = pole(b);
    return Math.acos(Math.min(1, Math.abs(p[0] * q[0] + p[1] * q[1] + p[2] * q[2]))) / RAD;
}

/**
 * The global trend a numeric model takes to lie along a plane: the plane,
 * `strength` times further along it than across; the line it already runs
 * furthest along (its plunge), if it has one, is kept as it was.
 */
export function planeTrend(lie: Lie, own: OverallStructure | null, strength = PLANE_STRENGTH): OverallStructure {
    return {
        dip: lie.dip, dipDirection: lie.dipDirection,
        lineTrend: own?.lineTrend ?? null,
        strength: strength > 1 ? strength : PLANE_STRENGTH,
        lineStrength: own && own.lineTrend !== null ? own.lineStrength : 1,
    };
}

/** How a plane lies, in words */
export function lieText(l: Lie): string {
    const bearing = String(Math.round(l.dipDirection) % 360).padStart(3, '0');
    return l.dip < 0.5 ? 'level' : l.dip > 89.5 ? `vertical, facing ${bearing}°` : `dipping ${Math.round(l.dip)}° towards ${bearing}°`;
}
