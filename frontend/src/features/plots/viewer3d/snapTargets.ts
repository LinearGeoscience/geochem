/**
 * What a node of a line snaps to as it is placed or dragged (pure,
 * unit-tested). Everything near the cursor is a candidate; the one of the
 * kind first in SNAP_ORDER wins, the nearest of that kind.
 */
import type { Placement } from './viewPlacement';

export type SnapKind =
    /** A node of a line (this surface's or another's): lines meet exactly */
    | 'node'
    /** Where a line on another section (or in space) crosses the plane being drawn on */
    | 'crossing'
    /** A logged contact down a drillhole (from a surface built from the logging) */
    | 'contact'
    /** The edge of a sample interval on a drillhole */
    | 'edge'
    /** The middle of a sample interval */
    | 'middle'
    /** Anywhere on a drillhole, or a sample without an interval */
    | 'hole'
    /** On another surface shown in the view (drawing with no slice) */
    | 'surface'
    /** On the plane being drawn on (the slice) */
    | 'plane';

/** First wins. A node joins lines exactly; a crossing ties sections together; a contact is the logging's own place */
export const SNAP_ORDER: readonly SnapKind[] = ['node', 'crossing', 'contact', 'edge', 'middle', 'hole', 'surface', 'plane'];

/**
 * How near the cursor (px) a candidate of each kind must be. The drillhole
 * kinds come from the hole picking, which has its own reach; a surface or a
 * plane is wherever the cursor is.
 */
export const SNAP_PX: Readonly<Record<SnapKind, number>> = {
    node: 10, crossing: 12, contact: 10, edge: Infinity, middle: Infinity, hole: Infinity, surface: Infinity, plane: Infinity,
};

/** What each kind is called in the label by the cursor */
export const SNAP_NAMES: Readonly<Record<SnapKind, string>> = {
    node: 'On a node of a line',
    crossing: 'Where a line of another section crosses this one',
    contact: 'On a logged contact',
    edge: 'Edge of a sample',
    middle: 'Middle of a sample',
    hole: 'On a hole',
    surface: 'On a surface',
    plane: 'On the slice',
};

export interface SnapCandidate {
    kind: SnapKind;
    /** Where it is on screen (CSS px) */
    x: number;
    y: number;
}

/** The kind a placement found by the hole picking is */
export function placementKind(kind: Placement['kind']): SnapKind {
    return kind === 'from' || kind === 'to' ? 'edge' : kind === 'mid' ? 'middle' : kind === 'slice' ? 'plane' : 'hole';
}

/** The candidate a node snaps to: the first kind in SNAP_ORDER within its reach, the nearest of that kind (null: none). */
export function pickSnap<T extends SnapCandidate>(candidates: readonly T[], cursor: readonly [number, number]): T | null {
    let best: T | null = null, bestRank = Infinity, bestD = Infinity;
    for (const c of candidates) {
        const d = Math.hypot(c.x - cursor[0], c.y - cursor[1]);
        if (!(d <= SNAP_PX[c.kind])) continue;
        const rank = SNAP_ORDER.indexOf(c.kind);
        if (rank < bestRank || (rank === bestRank && d < bestD)) { best = c; bestRank = rank; bestD = d; }
    }
    return best;
}
