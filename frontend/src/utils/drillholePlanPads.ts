/**
 * Drillhole planner: snapping a hole's collar to the nearest drill pad (pure,
 * unit-tested).
 *
 * The hole as first set up (its dip and azimuth at the target, lift and
 * drift) is a guide: "about this direction". It is projected up from the
 * target to the topography; the pads within a radius of where it reaches the
 * surface are tried, each as the collar of a hole to the same target with
 * the same lift and drift (the collar dip and azimuth solved). The pad whose
 * hole leaves the collar closest in direction to the guide wins (distance
 * breaks a tie); one needing more than the allowed change from the guide is
 * not taken. The pad's own RL is the collar RL (pads and topography differ).
 */
import { Rates, Vec3, aziDelta, backToSurface, direction, dipOutOfRange, forwardTrace, fmt, solveToCollar } from './drillholePlan';
import type { Topography } from './drillholePlanTopo';

export interface Pad {
    id: string;
    p: Vec3;
}

export interface SnapOptions {
    topo: Topography;
    /** Pads further than this (m, in plan) from where the guide reaches the surface are not tried */
    radius: number;
    /** Largest allowed change from the guide's collar dip / azimuth (degrees) */
    maxDipChange: number;
    maxAziChange: number;
    maxBackLength: number;
}

export const PAD_DEFAULTS = { radius: 300, maxDipChange: 15, maxAziChange: 30 };
/** Pads tried at most (the nearest) */
const MAX_TRIED = 12;

export type SnapResult =
    | { ok: true; pad: Pad; distance: number; collarDip: number; collarAzi: number; dipChange: number; aziChange: number; length: number }
    | { ok: false; reason: string };

/** Angle (degrees) between two hole directions */
function angleBetween(a: { dip: number; azi: number }, b: { dip: number; azi: number }) {
    const u = direction(a.dip, a.azi), v = direction(b.dip, b.azi);
    return (Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]))) * 180) / Math.PI;
}

export function snapToPad(target: Vec3, guide: { dip: number; azi: number } & Rates, pads: readonly Pad[], opts: SnapOptions): SnapResult {
    if (pads.length === 0) return { ok: false, reason: 'There are no pads.' };
    const up = backToSurface(target, guide.dip, guide.azi, guide, opts.topo, opts.maxBackLength);
    if (!up.ok) return { ok: false, reason: `The guide hole does not reach the surface: ${up.text}` };
    const g = { dip: up.collarDip, azi: up.collarAzi };
    const near = pads
        .map(pad => ({ pad, distance: Math.hypot(pad.p[0] - up.collar[0], pad.p[1] - up.collar[1]) }))
        .filter(c => c.distance <= opts.radius)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, MAX_TRIED);
    if (near.length === 0) return { ok: false, reason: `No pad within ${opts.radius} m of where the guide hole reaches the surface.` };
    let best: (SnapResult & { ok: true }) | null = null, bestAngle = Infinity;
    for (const { pad, distance } of near) {
        if (pad.p[2] <= target[2]) continue; // the target must be below the pad
        const s = solveToCollar({ collar: pad.p, target, given: 'lift-drift', a: guide.lift, b: guide.drift });
        if (!s.converged) continue;
        if (dipOutOfRange(forwardTrace(pad.p, s.collarDip, s.collarAzi, guide, s.length))) continue;
        const dipChange = Math.abs(s.collarDip - g.dip);
        // Near vertical the azimuth means little: only the dip is held to the guide there
        const aziChange = g.dip < -85 ? 0 : Math.abs(aziDelta(g.azi, s.collarAzi));
        if (dipChange > opts.maxDipChange || aziChange > opts.maxAziChange) continue;
        const angle = angleBetween(g, { dip: s.collarDip, azi: s.collarAzi });
        if (angle < bestAngle - 1e-9 || (Math.abs(angle - bestAngle) <= 1e-9 && best && distance < best.distance)) {
            bestAngle = angle;
            best = { ok: true, pad, distance, collarDip: s.collarDip, collarAzi: s.collarAzi, dipChange, aziChange, length: s.length };
        }
    }
    return best ?? {
        ok: false,
        reason: `None of the ${near.length} pad${near.length === 1 ? '' : 's'} within ${opts.radius} m gives a hole within ±${fmt(opts.maxDipChange, 0)}° dip and ±${fmt(opts.maxAziChange, 0)}° azimuth of the guide.`,
    };
}
