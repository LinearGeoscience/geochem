/**
 * Drillhole sample intervals for the 3D viewer's cylinders (pure, no three.js,
 * unit-tested): where each sample's From-To length of hole sits in space.
 *
 * A sample's coordinates are the middle of its interval (that is where the
 * desurvey puts them), so a cylinder is centred on the sample's point and runs
 * half its length each way along the hole. The hole's direction at a sample
 * comes from its neighbours down the hole.
 *
 * Where the path of a hole is known (the project's drillhole tables), the two
 * ends are put on it at the From and To depths instead: right on a hole that
 * bends, and at its first and last sample.
 */
import { positionAt, type HoleTrace } from '../../model/desurvey';
import { xrayBand } from './pointShaders';

/** Hole paths by hole name, and the world place of the view's local (0, 0, 0) */
export interface HolePaths {
    traces: ReadonlyMap<string, HoleTrace>;
    origin: ArrayLike<number>;
}

export interface IntervalGeometry {
    /** Local xyz of the From end, 3 per row (vertical exaggeration NOT applied) */
    start: Float32Array;
    /** Local xyz of the To end, 3 per row */
    end: Float32Array;
    /** 1 = the row has an interval to draw */
    has: Uint8Array;
    /** Rows with an interval */
    count: number;
    /** Median interval length (m), 0 when there are none */
    medianLength: number;
}

const isMissing = (v: unknown) => v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v));

/**
 * `positions` / `valid` are the point cloud's (local coordinates, 3 per row).
 * `to` may be null: an interval then ends where the next sample down the hole
 * starts (the last one repeats the length before it).
 */
export function buildIntervals(
    positions: Float32Array,
    valid: Uint8Array,
    holeIds: ArrayLike<unknown>,
    from: ArrayLike<number>,
    to: ArrayLike<number> | null,
    paths: HolePaths | null = null,
): IntervalGeometry {
    const n = valid.length;
    const start = new Float32Array(n * 3);
    const end = new Float32Array(n * 3);
    const has = new Uint8Array(n);
    const lengths: number[] = [];

    const byHole = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
        if (!valid[i] || isMissing(holeIds[i]) || !Number.isFinite(from[i])) continue;
        const h = String(holeIds[i]);
        let list = byHole.get(h);
        if (!list) { list = []; byHole.set(h, list); }
        list.push(i);
    }

    const samePlace = (a: number, b: number) => {
        const dx = positions[a * 3] - positions[b * 3];
        const dy = positions[a * 3 + 1] - positions[b * 3 + 1];
        const dz = positions[a * 3 + 2] - positions[b * 3 + 2];
        return dx * dx + dy * dy + dz * dz < 1e-6; // within 1 mm
    };

    for (const [hole, rows] of byHole) {
        const trace = paths?.traces.get(hole.trim());
        rows.sort((a, b) => from[a] - from[b]);
        const m = rows.length;

        // Interval lengths
        const len = new Float64Array(m);
        if (to) {
            for (let k = 0; k < m; k++) len[k] = to[rows[k]] - from[rows[k]];
        } else {
            let nextFrom = NaN; // start of the next sample further down
            for (let k = m - 1; k >= 0; k--) {
                const f = from[rows[k]];
                if (k + 1 < m && from[rows[k + 1]] > f) nextFrom = from[rows[k + 1]];
                len[k] = nextFrom - f;
            }
            // The deepest samples have nothing below them: repeat the length before
            let last = NaN;
            for (let k = 0; k < m; k++) {
                if (len[k] > 0) last = len[k];
                else if (Number.isNaN(len[k])) len[k] = last;
            }
        }

        // Nearest sample up / down the hole that is somewhere else (skips
        // duplicates and re-assays at the same position), in two linear passes
        const up = new Int32Array(m).fill(-1);
        const down = new Int32Array(m).fill(-1);
        for (let k = 1; k < m; k++) up[k] = samePlace(rows[k - 1], rows[k]) ? up[k - 1] : k - 1;
        for (let k = m - 2; k >= 0; k--) down[k] = samePlace(rows[k + 1], rows[k]) ? down[k + 1] : k + 1;

        for (let k = 0; k < m; k++) {
            if (!(len[k] > 0)) continue;
            const i = rows[k];
            if (trace && paths) {
                const top = positionAt(trace, from[i]);
                const bottom = positionAt(trace, from[i] + len[k]);
                for (let c = 0; c < 3; c++) {
                    start[i * 3 + c] = top[c] - paths.origin[c];
                    end[i * 3 + c] = bottom[c] - paths.origin[c];
                }
                has[i] = 1;
                lengths.push(len[k]);
                continue;
            }
            const a = up[k] >= 0 ? rows[up[k]] : i;
            const b = down[k] >= 0 ? rows[down[k]] : i;
            // Down-hole direction; a lone sample (or a hole plotted at one place) points straight down
            let dx = positions[b * 3] - positions[a * 3];
            let dy = positions[b * 3 + 1] - positions[a * 3 + 1];
            let dz = positions[b * 3 + 2] - positions[a * 3 + 2];
            const d = Math.hypot(dx, dy, dz);
            if (d > 0) { dx /= d; dy /= d; dz /= d; } else { dx = 0; dy = 0; dz = -1; }
            const half = len[k] / 2;
            const px = positions[i * 3], py = positions[i * 3 + 1], pz = positions[i * 3 + 2];
            start[i * 3] = px - dx * half; start[i * 3 + 1] = py - dy * half; start[i * 3 + 2] = pz - dz * half;
            end[i * 3] = px + dx * half; end[i * 3 + 1] = py + dy * half; end[i * 3 + 2] = pz + dz * half;
            has[i] = 1;
            lengths.push(len[k]);
        }
    }

    const sorted = Float64Array.from(lengths).sort();
    return { start, end, has, count: lengths.length, medianLength: sorted.length ? sorted[sorted.length >> 1] : 0 };
}

export interface CylinderTemplate {
    /** (cos, sin, t): unit circle in xy, t = 0 at the From end and 1 at the To end */
    position: Float32Array;
    normal: Float32Array;
    index: Uint16Array;
}

/** One closed cylinder (sides + two end caps), outward-facing triangles. */
export function cylinderTemplate(segments: number): CylinderTemplate {
    const s = Math.max(3, Math.floor(segments));
    const position: number[] = [];
    const normal: number[] = [];
    const index: number[] = [];
    const ring = (t: number, nz: number | null) => {
        const first = position.length / 3;
        for (let j = 0; j < s; j++) {
            const a = (j / s) * 2 * Math.PI;
            const c = Math.cos(a), sn = Math.sin(a);
            position.push(c, sn, t);
            if (nz === null) normal.push(c, sn, 0); else normal.push(0, 0, nz);
        }
        return first;
    };
    const b = ring(0, null), t = ring(1, null);
    for (let j = 0; j < s; j++) {
        const k = (j + 1) % s;
        index.push(b + j, b + k, t + k, b + j, t + k, t + j);
    }
    const capB = ring(0, -1), capT = ring(1, 1);
    for (let j = 1; j + 1 < s; j++) {
        index.push(capB, capB + j + 1, capB + j);
        index.push(capT, capT + j, capT + j + 1);
    }
    return { position: Float32Array.from(position), normal: Float32Array.from(normal), index: Uint16Array.from(index) };
}

/** Rows without an interval: the ones still drawn as points when cylinders are on. */
export function rowsWithoutInterval(has: Uint8Array): Uint32Array {
    let count = 0;
    for (let i = 0; i < has.length; i++) if (!has[i]) count++;
    const out = new Uint32Array(count);
    for (let i = 0, k = 0; i < has.length; i++) if (!has[i]) out[k++] = i;
    return out;
}

/**
 * Front-most cylinder under the cursor, or -1. `mvp` is the column-major
 * model-view-projection matrix with the vertical exaggeration included (as for
 * projectToScreen); `pxScale` is projection[1][1] x half the view height, so a
 * metre at clip depth w covers pxScale / w pixels in a perspective view and
 * pxScale pixels in an orthographic one. Cylinders are at least `minRadiusPx`
 * on screen (as drawn) and `slopPx` is added for an easier target. With
 * `ranks` (emphasis rank and fade, two per row: highs are drawn in front) the
 * cylinder of the highest rank band wins, the nearer one within a band.
 */
export function pickInterval(
    intervals: IntervalGeometry,
    mvp: ArrayLike<number>,
    width: number,
    height: number,
    cursor: [number, number],
    radiusOf: (i: number) => number,
    pxScale: number,
    perspective: boolean,
    eligible: (i: number) => boolean,
    minRadiusPx = 0.75,
    slopPx = 3,
    ranks: ArrayLike<number> | null = null,
): number {
    const { start, end, has } = intervals;
    const m = mvp;
    let best = -1;
    let bestDepth = Infinity;
    let bestBand = -1;
    const clip = (p: Float32Array, i: number, out: number[]) => {
        const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
        out[3] = m[3] * x + m[7] * y + m[11] * z + m[15];
        out[0] = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / out[3] * 0.5 + 0.5) * width;
        out[1] = (1 - ((m[1] * x + m[5] * y + m[9] * z + m[13]) / out[3] * 0.5 + 0.5)) * height;
        out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / out[3];
    };
    const a = [0, 0, 0, 0], b = [0, 0, 0, 0];
    for (let i = 0; i < has.length; i++) {
        if (!has[i]) continue;
        clip(start, i, a);
        clip(end, i, b);
        if (a[3] <= 0 || b[3] <= 0) continue; // behind the camera
        // Closest point of the on-screen axis to the cursor
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const l2 = dx * dx + dy * dy;
        const t = l2 > 0 ? Math.min(1, Math.max(0, ((cursor[0] - a[0]) * dx + (cursor[1] - a[1]) * dy) / l2)) : 0;
        const w = a[3] + (b[3] - a[3]) * t;
        const ndcZ = a[2] + (b[2] - a[2]) * t;
        if (ndcZ < -1 || ndcZ > 1) continue; // nearer than the near plane / beyond the far one
        const reach = Math.max(radiusOf(i) * (perspective ? pxScale / w : pxScale), minRadiusPx) + slopPx;
        const ex = a[0] + dx * t - cursor[0], ey = a[1] + dy * t - cursor[1];
        if (ex * ex + ey * ey > reach * reach) continue;
        const depth = perspective ? w : ndcZ;
        // Highs in front: the higher band is the one on screen, the nearer within a band
        const band = ranks ? xrayBand(ranks[i * 2]) : 0;
        if (band < bestBand || (band === bestBand && depth >= bestDepth)) continue;
        if (eligible(i)) { bestDepth = depth; bestBand = band; best = i; }
    }
    return best;
}
