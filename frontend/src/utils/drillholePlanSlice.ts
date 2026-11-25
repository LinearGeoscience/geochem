/**
 * Drillhole planner on the 3D view's slice (pure, unit-tested): holes are
 * planned on the active slice. A target is never moved by the slice: these
 * say how far it is from the slice, put it onto the slice when asked, and
 * describe an upright slice as a cross-section for the 2D view.
 *
 * Plane: unit normal and a point on it, WORLD coordinates (float64).
 */
type Vec3 = [number, number, number];

export interface PlanePoint {
    normal: ArrayLike<number>;
    point: ArrayLike<number>;
}

/** Signed distance from the plane (along its normal) */
export function offSlice(p: ArrayLike<number>, plane: PlanePoint): number {
    const n = plane.normal, q = plane.point;
    return (p[0] - q[0]) * n[0] + (p[1] - q[1]) * n[1] + (p[2] - q[2]) * n[2];
}

/** The point moved straight onto the plane */
export function snapToSlice(p: ArrayLike<number>, plane: PlanePoint): Vec3 {
    const d = offSlice(p, plane), n = plane.normal;
    return [p[0] - d * n[0], p[1] - d * n[1], p[2] - d * n[2]];
}

/** The plane moved along its normal so that it passes through a point (its orientation kept) */
export function sliceThrough(plane: PlanePoint, p: ArrayLike<number>): Vec3 {
    const d = offSlice(p, plane), n = plane.normal, q = plane.point;
    return [q[0] + d * n[0], q[1] + d * n[1], q[2] + d * n[2]];
}

/** A level direction lying in the plane (null for a level plane) */
export function levelInPlane(normal: ArrayLike<number>): Vec3 | null {
    const h = Math.hypot(normal[0], normal[1]);
    return h < 1e-9 ? null : [-normal[1] / h, normal[0] / h, 0];
}

/**
 * Where a new hole starts on a slice: the target where the slice crosses
 * `targetRl` at its centre, and a collar at `collarRl` up-dip of it, so the
 * hole runs along an upright slice at `dip`. `azimuth`: from collar to target.
 */
export function startOnSlice(plane: PlanePoint, targetRl: number, collarRl: number, dip = -60): { target: Vec3; collar: Vec3; azimuth: number } {
    const target = snapToSlice([plane.point[0], plane.point[1], targetRl], plane);
    const u = levelInPlane(plane.normal) ?? [0, 1, 0];
    const rise = Math.max(collarRl - target[2], 1);
    const run = rise / Math.tan((Math.abs(dip) * Math.PI) / 180);
    const collar: Vec3 = [target[0] - u[0] * run, target[1] - u[1] * run, target[2] + rise];
    const azimuth = ((((Math.atan2(u[0], u[1]) * 180) / Math.PI) % 360) + 360) % 360;
    return { target, collar, azimuth };
}

/**
 * An upright slice as a cross-section (origin, azimuth it runs along, half
 * width), in the convention of utils/sectionProjection; null for a level or
 * leaning slice.
 */
export function uprightSection(plane: PlanePoint, width: number): { originE: number; originN: number; azimuth: number; halfWidth: number } | null {
    const n = plane.normal;
    const h = Math.hypot(n[0], n[1]);
    if (h < 1e-9 || Math.abs(n[2]) > 1e-6 * Math.max(h, 1)) return null;
    // sectionPlane's normal is (cos a, −sin a, 0) for a section running along azimuth a
    let azimuth = (Math.atan2(-n[1] / h, n[0] / h) * 180) / Math.PI;
    azimuth = ((azimuth % 360) + 360) % 360;
    return { originE: plane.point[0], originN: plane.point[1], azimuth, halfWidth: width / 2 };
}
