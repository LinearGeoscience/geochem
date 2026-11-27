/**
 * Topography for the drillhole planner (pure, unit-tested): a surface mesh
 * (a wireframe or a fitted surface) indexed on an XY grid, or a flat RL.
 *
 * Answers: the heights at a point in plan, the first place a segment crosses
 * the surface, whether a point is inside the surface's extent, and whether
 * the mesh looks like a closed solid rather than a surface. World float64
 * coordinates throughout.
 */
type Vec3 = [number, number, number];

export interface Topography {
    kind: 'mesh' | 'flat';
    name: string;
    /** The RL of a flat topography */
    flatRl: number | null;
    /** Extent in plan (a flat RL has none: infinite) */
    bounds: { minX: number; maxX: number; minY: number; maxY: number };
    /** Every edge is shared by exactly two triangles: a closed solid, not a surface */
    closed: boolean;
    /** Elevations of the surface at a point in plan (several where it folds over; none outside it) */
    heightsAt(x: number, y: number): number[];
    /** The highest elevation at a point in plan, or null */
    topAt(x: number, y: number): number | null;
    inExtent(x: number, y: number): boolean;
    /** The first crossing of the segment a → b, as a fraction 0-1 along it (null: none) */
    firstHit(a: ArrayLike<number>, b: ArrayLike<number>): number | null;
}

export function flatTopography(rl: number, name = `Flat RL ${rl}`): Topography {
    return {
        kind: 'flat', name, flatRl: rl, closed: false,
        bounds: { minX: -Infinity, maxX: Infinity, minY: -Infinity, maxY: Infinity },
        heightsAt: () => [rl],
        topAt: () => rl,
        inExtent: () => true,
        firstHit: (a, b) => {
            const da = a[2] - rl, db = b[2] - rl;
            if (da === 0) return 0;
            if (da * db > 0 || da === db) return null;
            return da / (da - db);
        },
    };
}

/** Every edge used by exactly two triangles (and there is at least one triangle). */
export function isClosedMesh(triangles: ArrayLike<number>, vertexCount: number): boolean {
    if (triangles.length < 12) return false;
    const uses = new Map<number, number>();
    for (let q = 0; q + 2 < triangles.length; q += 3) {
        for (let k = 0; k < 3; k++) {
            const a = triangles[q + k], b = triangles[q + ((k + 1) % 3)];
            const key = Math.min(a, b) * vertexCount + Math.max(a, b);
            uses.set(key, (uses.get(key) ?? 0) + 1);
        }
    }
    for (const n of uses.values()) if (n !== 2) return false;
    return true;
}

/** Most cells along a side of the index grid */
const MAX_CELLS = 2048;

export function meshTopography(name: string, vertices: Float64Array, triangles: Uint32Array): Topography | null {
    const nt = Math.floor(triangles.length / 3);
    if (nt === 0) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let q = 0; q < nt * 3; q++) {
        const i = triangles[q] * 3;
        const x = vertices[i], y = vertices[i + 1];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
    const w = Math.max(maxX - minX, 1e-6), h = Math.max(maxY - minY, 1e-6);
    // About one triangle per cell
    const nx = Math.max(1, Math.min(MAX_CELLS, Math.round(Math.sqrt((nt * w) / h))));
    const ny = Math.max(1, Math.min(MAX_CELLS, Math.round(Math.sqrt((nt * h) / w))));
    const cw = w / nx, ch = h / ny;
    const cx = (x: number) => Math.min(nx - 1, Math.max(0, Math.floor((x - minX) / cw)));
    const cy = (y: number) => Math.min(ny - 1, Math.max(0, Math.floor((y - minY) / ch)));
    const triBox = (t: number) => {
        const a = triangles[t * 3] * 3, b = triangles[t * 3 + 1] * 3, c = triangles[t * 3 + 2] * 3;
        return [
            cx(Math.min(vertices[a], vertices[b], vertices[c])), cx(Math.max(vertices[a], vertices[b], vertices[c])),
            cy(Math.min(vertices[a + 1], vertices[b + 1], vertices[c + 1])), cy(Math.max(vertices[a + 1], vertices[b + 1], vertices[c + 1])),
        ];
    };
    // Cell -> triangles, packed (count, then fill)
    const start = new Uint32Array(nx * ny + 1);
    for (let t = 0; t < nt; t++) {
        const [x0, x1, y0, y1] = triBox(t);
        for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) start[j * nx + i + 1]++;
    }
    for (let k = 0; k < nx * ny; k++) start[k + 1] += start[k];
    const items = new Uint32Array(start[nx * ny]);
    const fill = start.slice(0, nx * ny);
    for (let t = 0; t < nt; t++) {
        const [x0, x1, y0, y1] = triBox(t);
        for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) items[fill[j * nx + i]++] = t;
    }
    // Triangles already tried in this query
    const seen = new Uint32Array(nt);
    let stamp = 0;
    const nextStamp = () => {
        stamp++;
        if (stamp === 0xffffffff) { seen.fill(0); stamp = 1; }
        return stamp;
    };
    const inside = (x: number, y: number) => x >= minX && x <= maxX && y >= minY && y <= maxY;

    const heightsAt = (x: number, y: number): number[] => {
        if (!inside(x, y)) return [];
        const out: number[] = [];
        const cell = cy(y) * nx + cx(x);
        for (let k = start[cell]; k < start[cell + 1]; k++) {
            const t = items[k];
            const a = triangles[t * 3] * 3, b = triangles[t * 3 + 1] * 3, c = triangles[t * 3 + 2] * 3;
            // Barycentric in plan, relative to the point (keeps precision at large coordinates)
            const ax = vertices[a] - x, ay = vertices[a + 1] - y, bx = vertices[b] - x, by = vertices[b + 1] - y, qx = vertices[c] - x, qy = vertices[c + 1] - y;
            const area = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax);
            if (Math.abs(area) < 1e-12) continue; // on edge in plan (vertical face)
            const wa = (bx * qy - by * qx) / area, wb = (qx * ay - qy * ax) / area, wc = 1 - wa - wb;
            const e = -1e-9;
            if (wa < e || wb < e || wc < e) continue;
            const z = wa * vertices[a + 2] + wb * vertices[b + 2] + wc * vertices[c + 2];
            // A point on an edge is in both triangles beside it: one height
            if (!out.some(h => Math.abs(h - z) < 1e-6)) out.push(z);
        }
        return out;
    };

    const firstHit = (p: ArrayLike<number>, q: ArrayLike<number>): number | null => {
        const lx = Math.max(Math.min(p[0], q[0]), minX), hx = Math.min(Math.max(p[0], q[0]), maxX);
        const ly = Math.max(Math.min(p[1], q[1]), minY), hy = Math.min(Math.max(p[1], q[1]), maxY);
        if (lx > hx || ly > hy) return null;
        const s = nextStamp();
        const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
        let best: number | null = null;
        for (let j = cy(ly); j <= cy(hy); j++) {
            for (let i = cx(lx); i <= cx(hx); i++) {
                const cell = j * nx + i;
                for (let k = start[cell]; k < start[cell + 1]; k++) {
                    const t = items[k];
                    if (seen[t] === s) continue;
                    seen[t] = s;
                    const a = triangles[t * 3] * 3, b = triangles[t * 3 + 1] * 3, c = triangles[t * 3 + 2] * 3;
                    // Möller–Trumbore, relative to the segment start
                    const v0x = vertices[a] - p[0], v0y = vertices[a + 1] - p[1], v0z = vertices[a + 2] - p[2];
                    const e1x = vertices[b] - vertices[a], e1y = vertices[b + 1] - vertices[a + 1], e1z = vertices[b + 2] - vertices[a + 2];
                    const e2x = vertices[c] - vertices[a], e2y = vertices[c + 1] - vertices[a + 1], e2z = vertices[c + 2] - vertices[a + 2];
                    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
                    const det = e1x * px + e1y * py + e1z * pz;
                    if (Math.abs(det) < 1e-14) continue;
                    const inv = 1 / det;
                    // From the triangle's corner to the segment start
                    const tx = -v0x, ty = -v0y, tz = -v0z;
                    const u = (tx * px + ty * py + tz * pz) * inv;
                    if (u < -1e-9 || u > 1 + 1e-9) continue;
                    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
                    const v = (dx * qx + dy * qy + dz * qz) * inv;
                    if (v < -1e-9 || u + v > 1 + 1e-9) continue;
                    const f = (e2x * qx + e2y * qy + e2z * qz) * inv;
                    if (f < -1e-9 || f > 1 + 1e-9) continue;
                    const ff = Math.min(1, Math.max(0, f));
                    if (best === null || ff < best) best = ff;
                }
            }
        }
        return best;
    };

    return {
        kind: 'mesh', name, flatRl: null,
        bounds: { minX, maxX, minY, maxY },
        closed: isClosedMesh(triangles, vertices.length / 3),
        heightsAt,
        topAt: (x, y) => {
            const hs = heightsAt(x, y);
            return hs.length ? Math.max(...hs) : null;
        },
        inExtent: inside,
        firstHit,
    };
}

export type { Vec3 as TopoVec3 };
