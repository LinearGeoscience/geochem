/**
 * Where a click in the 3D view lands: on a drillhole (snapped to the edge
 * or the middle of the sample under the cursor), on a sample without an
 * interval, or, with a slice on, on the slice. Shared by everything that
 * places things in the view by clicking (a surface's points, the model's
 * readings).
 */
import { useAppStore } from '../../../store/appStore';
import type { Plane, Vec3 } from '../../model/types';
import type { PointCloudGeometry } from './geometry';
import type { IntervalGeometry } from './intervals';
import { dataRay, pickOnHole, pickSample, rayPlane } from './picking';
import type { ThreeViewport } from './ThreeViewport';

/** What the view shows now */
export interface PlacementView {
    viewport: ThreeViewport | null;
    geometry: PointCloudGeometry | null;
    /** Every sample's From-To interval (whether or not cylinders are drawn) */
    intervals: IntervalGeometry | null;
    vex: number;
    /** Samples the user can see now */
    eligibility: () => (i: number) => boolean;
    /** The active slice's mid-plane in local coordinates (null: no slice) */
    slicePlane: () => { normal: Vec3; point: Vec3 } | null;
    /** Dataset columns naming the hole and the depths down it */
    columns: { hole: string | null; from: string | null; to: string | null; id: string | null };
}

/** Where a click would put something (local coordinates). */
export interface Placement {
    local: Vec3;
    kind: 'from' | 'to' | 'mid' | 'hole' | 'sample' | 'slice';
    row: number | null;
    along: number | null;
}

/** Where the line of sight through a pixel meets a plane (local coordinates). */
export function placeOnPlane(view: PlacementView, x: number, y: number, plane: Plane): Vec3 | null {
    const v = view.viewport;
    return v ? rayPlane(dataRay(v.screenRay(x, y), view.vex), plane) : null;
}

/** Where a click at this pixel would land (`onSlice`: empty space lands on the active slice). */
export function resolvePlacement(view: PlacementView, x: number, y: number, onSlice: boolean): Placement | null {
    const { geometry: g, intervals, viewport: v } = view;
    if (!g || !v) return null;
    const m = v.screenMatrix();
    const eligible = view.eligibility();
    if (intervals) {
        const hit = pickOnHole(intervals, m.mvp, m.width, m.height, [x, y], eligible);
        if (hit) return { local: hit.position, kind: hit.snap ?? 'hole', row: hit.row, along: hit.along };
    }
    if (!intervals || intervals.count < g.validCount) {
        const screen = v.screenPositions();
        const row = screen ? pickSample(screen, [x, y], i => !intervals?.has[i] && eligible(i)) : -1;
        if (row >= 0) return { local: [g.positions[row * 3], g.positions[row * 3 + 1], g.positions[row * 3 + 2]], kind: 'sample', row, along: null };
    }
    const plane = onSlice ? view.slicePlane() : null;
    const hit = plane ? placeOnPlane(view, x, y, plane) : null;
    return hit ? { local: hit, kind: 'slice', row: null, along: null } : null;
}

/** The hole and depth of a placement on a drillhole (null off the holes). */
export function placementHole(view: PlacementView, p: Placement): { hole: string; depth: number | null } | null {
    const { columns, intervals } = view;
    if (p.row === null || !columns.hole) return null;
    const app = useAppStore.getState();
    const id = app.getRawColumn(columns.hole)?.[p.row];
    if (id === null || id === undefined || id === '') return null;
    const from = columns.from ? app.getNumericColumn(columns.from)?.[p.row] : undefined;
    if (from === undefined || !Number.isFinite(from)) return { hole: String(id), depth: null };
    if (p.along === null || !intervals) return { hole: String(id), depth: from };
    const to = columns.to ? app.getNumericColumn(columns.to)?.[p.row] : undefined;
    const s = intervals.start, e = intervals.end, r = p.row * 3;
    const length = to !== undefined && Number.isFinite(to) ? to - from : Math.hypot(e[r] - s[r], e[r + 1] - s[r + 1], e[r + 2] - s[r + 2]);
    return { hole: String(id), depth: from + p.along * length };
}

const depthText = (v: number) => `${Number(v.toFixed(v % 1 === 0 ? 0 : 1))} m`;

/** A placement in words: "DH012 · 45 m · edge of a sample", "Sample S123", "On the slice". */
export function describePlacement(view: PlacementView, p: Placement): string {
    if (p.kind === 'slice') return 'On the slice';
    const at = placementHole(view, p);
    if (p.kind === 'sample') {
        const { columns } = view;
        const id = columns.id && p.row !== null ? useAppStore.getState().getRawColumn(columns.id)?.[p.row] : null;
        return id !== null && id !== undefined && id !== '' ? `Sample ${id}` : 'On a sample';
    }
    const where = p.kind === 'mid' ? ' · middle of a sample' : p.kind === 'hole' ? '' : ' · edge of a sample';
    return at ? `${at.hole}${at.depth !== null ? ` · ${depthText(at.depth)}` : ''}${where}` : `On a hole${where}`;
}
