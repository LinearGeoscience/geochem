/**
 * The drillhole planner plans on the 3D view's active slice (the slice bar
 * owns it). The slice changes on every frame while it is stepped or dragged,
 * so planner parts follow it through the live clip themselves rather than
 * through the viewer's React state.
 */
import { useSyncExternalStore } from 'react';
import type { LiveClip } from '../liveClip';
import type { ClipSettings, Slice, Vec3 } from '../slices';
import { offSlice, snapToSlice } from '../../../../utils/drillholePlanSlice';
import type { PlanResult } from '../../../../utils/drillholePlan';
import { usePlanStore } from './planStore';

/** What the planner needs from the viewer's slicing */
export interface SliceLink {
    clip: LiveClip;
    /** Move the active slice along its normal so that it passes through a world point (orientation kept) */
    moveThrough: (p: Vec3) => void;
    /** Turn slicing on (a first slice if there is none) */
    turnOn: () => void;
    /**
     * Make the active slice upright through a world point, running along an
     * azimuth (null: keep its orientation); slicing comes on if it was off.
     */
    alignTo: (p: Vec3, azimuth: number | null) => void;
}

/**
 * The active slice turned to a hole: the upright plane through its collar
 * and its target (else its end of hole), through the target. A hole with its
 * collar straight above its target keeps the slice's orientation.
 */
export function alignToHole(link: SliceLink, result: PlanResult) {
    // A wedge starts at its kick-off on the parent
    const c = result.wedge ? result.wedge.kopPoint : result.collar;
    const t = result.target ?? (result.trace ? [result.trace.xyz[result.trace.xyz.length - 3], result.trace.xyz[result.trace.xyz.length - 2], result.trace.xyz[result.trace.xyz.length - 1]] as Vec3 : null);
    const at = t ?? c;
    if (!at) return;
    const de = c && t ? t[0] - c[0] : 0, dn = c && t ? t[1] - c[1] : 0;
    const azimuth = Math.hypot(de, dn) > 1 ? (Math.atan2(de, dn) * 180) / Math.PI : null;
    link.alignTo([at[0], at[1], at[2]], azimuth);
}

/** A target or collar further than this from the slice (m) is off it */
export const OFF_SLICE = 0.01;

/** The active slice, when slicing is on and that slice is applied */
export function activeSlice(c: ClipSettings): Slice | null {
    if (!c.slicing) return null;
    const s = c.slices[c.active];
    return s && s.on ? s : null;
}

const NONE = () => null;
const noSubscribe = () => () => {};

/** The active slice, following every change (null: no slice to plan on) */
export function useActiveSlice(link: SliceLink | null): Slice | null {
    return useSyncExternalStore(link?.clip.subscribe ?? noSubscribe, link ? () => activeSlice(link.clip.get()) : NONE);
}

export const slicePlane = (s: Slice) => ({ normal: s.normal, point: s.center });

/** Signed distance of a hole's target (else its collar) from the slice */
export function holeOffSlice(result: PlanResult, slice: Slice | null): number | null {
    const p = result.target ?? result.collar;
    return p && slice ? offSlice(p, slicePlane(slice)) : null;
}

/** Move the selected hole's target straight onto the slice (the only thing that moves a target to the slice) */
export function snapTargetToSlice(holeId: string, result: PlanResult, slice: Slice) {
    const t = result.target;
    if (!t) return;
    const [e, n, rl] = snapToSlice(t, slicePlane(slice));
    usePlanStore.getState().updateHole(holeId, { target: { e, n, rl } });
}
