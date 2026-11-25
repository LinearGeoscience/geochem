/**
 * Where a plane cuts a mesh (pure): the line of the cut, which has no width,
 * and, for a mesh that is closed there, its section filled.
 *
 * A place of the line is where the plane meets an edge of a triangle, worked
 * out along the edge from its lower corner to its higher, so that the two
 * triangles an edge joins give the very same place and the line's pieces
 * join end to end without a tolerance. A corner exactly on the plane counts
 * as on its upper side, so no triangle is met at a corner alone.
 *
 * The line is closed when every place ends an even number of pieces: it is
 * then rings only. Where it is not (a sheet, a solid with a gap in it), the
 * runs that have ends are walked first and set aside, and what is left is
 * rings.
 *
 * Where the mesh's triangles all face one way, each piece is given the way
 * round that has the solid on its left, seen from the side the plane's
 * normal points to (for a mesh that faces outwards; one that faces inwards
 * is all the other way round, and is turned). A ring that turns to the left
 * is then the outside of a part of the section and one that turns to the
 * right a hole in it. Where rings touch at a place (a shell's skin pinches
 * at edges of four triangles) the walk turns as far left as it can, so they
 * are rings of their own. (Phase 302: 29 of 947 rings of the real gold
 * shells were left empty when holes were told by counting the rings round a
 * place, which goes wrong where rings touch.) Where the triangles do not
 * all face one way, holes are told by counting, as before.
 */
import { ShapeUtils, Vector2 } from 'three';

type Vec3 = readonly [number, number, number];

export interface MeshCut {
    /** xyz of the places where the plane meets the mesh's edges */
    points: Float32Array;
    /** The line of the cut: pairs of places */
    segments: Uint32Array;
    /** The rings of the line, each a run of places walked once round (a run with ends is in none) */
    loops: number[][];
    /** The line is rings only: all of the mesh has an inside on the plane */
    closed: boolean;
    /**
     * The rings run with the solid on their left (the triangles face one way): one that turns to the left is a
     * part of the section, one that turns to the right a hole. Else they were walked either way.
     */
    oriented: boolean;
}

/** The plane `normal . p = d` against a mesh (null: it does not meet it) */
export function cutMesh(positions: ArrayLike<number>, triangles: ArrayLike<number>, normal: Vec3, d: number): MeshCut | null {
    const nVerts = Math.floor(positions.length / 3);
    const [nx, ny, nz] = normal;
    const height = new Float64Array(nVerts);
    let above = 0;
    for (let i = 0; i < nVerts; i++) {
        height[i] = nx * positions[i * 3] + ny * positions[i * 3 + 1] + nz * positions[i * 3 + 2] - d;
        if (height[i] >= 0) above++;
    }
    if (above === 0 || above === nVerts) return null;

    const at = new Map<number, number>();
    const pts: number[] = [];
    /** The place on the edge between two corners on either side of the plane */
    const place = (i: number, j: number): number => {
        const a = Math.min(i, j), b = Math.max(i, j);
        const key = a * nVerts + b;
        let p = at.get(key);
        if (p === undefined) {
            const t = height[a] / (height[a] - height[b]);
            p = pts.length / 3;
            pts.push(
                positions[a * 3] + t * (positions[b * 3] - positions[a * 3]),
                positions[a * 3 + 1] + t * (positions[b * 3 + 1] - positions[a * 3 + 1]),
                positions[a * 3 + 2] + t * (positions[b * 3 + 2] - positions[a * 3 + 2]),
            );
            at.set(key, p);
        }
        return p;
    };
    const segs: number[] = [];
    for (let t = 0; t + 2 < triangles.length; t += 3) {
        const i = triangles[t], j = triangles[t + 1], k = triangles[t + 2];
        const si = height[i] >= 0, sj = height[j] >= 0, sk = height[k] >= 0;
        if (si === sj && sj === sk) continue;
        // The corner alone on its side: the two edges from it are the ones the plane meets
        // (lone, p, q) keeps the triangle's own turn: with the lone corner above the plane, the piece from p's edge to
        // q's has the side the face looks away from (the solid, for a mesh that faces outwards) on its left
        const [lone, p, q] = si !== sj && si !== sk ? [i, j, k] : sj !== si && sj !== sk ? [j, k, i] : [k, i, j];
        const a = place(lone, p), b = place(lone, q);
        if (a === b) continue;
        if (height[lone] >= 0) segs.push(a, b); else segs.push(b, a);
    }
    if (segs.length === 0) return null;
    const rings = orientedRings(pts, segs, normal);
    if (rings) return { points: Float32Array.from(pts), segments: Uint32Array.from(segs), loops: rings, closed: true, oriented: true };

    const nPts = pts.length / 3;
    // The pieces at each place
    const count = new Uint32Array(nPts + 1);
    for (const p of segs) count[p + 1]++;
    /** The pieces still to be walked at each place */
    const left = new Uint32Array(nPts);
    for (let p = 0; p < nPts; p++) left[p] = count[p + 1];
    for (let p = 0; p < nPts; p++) count[p + 1] += count[p];
    const fill = count.slice(0, nPts);
    /** For each place, the ends of pieces that are at it */
    const pieces = new Uint32Array(segs.length);
    for (let s = 0; s < segs.length; s++) pieces[fill[segs[s]]++] = s;
    const used = new Uint8Array(segs.length / 2);
    const unwalked = (p: number): number => {
        for (let e = count[p]; e < count[p + 1]; e++) if (!used[pieces[e] >> 1]) return pieces[e];
        return -1;
    };
    /** Along pieces not yet walked from the end `s` of one, until there is no way on */
    const walk = (s: number): number[] => {
        const run: number[] = [];
        let here = segs[s];
        while (s >= 0) {
            used[s >> 1] = 1;
            run.push(here);
            left[here]--;
            here = segs[s ^ 1];
            left[here]--;
            s = unwalked(here);
        }
        return run;
    };
    // A run with an end starts at a place where an odd number of pieces meet: those are walked first, and are no ring
    let closed = true;
    for (let p = 0; p < nPts; p++) {
        if (left[p] % 2 === 1) { closed = false; walk(unwalked(p)); }
    }
    // What is left meets in even numbers everywhere: a walk comes back to where it began
    const loops: number[][] = [];
    for (let s0 = 0; s0 < segs.length; s0 += 2) {
        if (used[s0 >> 1]) continue;
        const loop = walk(s0);
        if (loop.length >= 3) loops.push(loop);
    }
    return { points: Float32Array.from(pts), segments: Uint32Array.from(segs), loops, closed, oriented: false };
}

/**
 * The rings of pieces that run one way each (from, to): null unless as many pieces leave every place as come to it.
 * At a place more than one piece leaves, the walk takes the one that turns furthest to the left of the way it came
 * in (the solid is on the left), so rings that touch there are walked as rings of their own.
 */
function orientedRings(pts: readonly number[], segs: readonly number[], normal: Vec3): number[][] | null {
    const nPts = pts.length / 3, nSegs = segs.length / 2;
    const balance = new Int32Array(nPts);
    for (let s = 0; s < nSegs; s++) { balance[segs[s * 2]]++; balance[segs[s * 2 + 1]]--; }
    for (let p = 0; p < nPts; p++) if (balance[p] !== 0) return null;
    // The pieces that leave each place
    const start = new Uint32Array(nPts + 1);
    for (let s = 0; s < nSegs; s++) start[segs[s * 2] + 1]++;
    for (let p = 0; p < nPts; p++) start[p + 1] += start[p];
    const fill = start.slice(0, nPts);
    const leaving = new Uint32Array(nSegs);
    for (let s = 0; s < nSegs; s++) leaving[fill[segs[s * 2]]++] = s;
    // Places in the plane, to measure turns by (only where more than one piece leaves a place)
    const [u, v] = planeAxes(normal);
    const x = (p: number) => pts[p * 3] * u[0] + pts[p * 3 + 1] * u[1] + pts[p * 3 + 2] * u[2];
    const y = (p: number) => pts[p * 3] * v[0] + pts[p * 3 + 1] * v[1] + pts[p * 3 + 2] * v[2];
    const used = new Uint8Array(nSegs);
    /** The piece to go on by from the end of piece `s`: of those not walked, the one furthest to the left */
    const next = (s: number): number => {
        const here = segs[s * 2 + 1];
        let best = -1, ways = 0;
        for (let e = start[here]; e < start[here + 1]; e++) if (!used[leaving[e]]) { ways++; best = leaving[e]; }
        if (ways <= 1) return best;
        const from = segs[s * 2], ix = x(here) - x(from), iy = y(here) - y(from);
        let bestTurn = -Infinity;
        best = -1;
        for (let e = start[here]; e < start[here + 1]; e++) {
            const o = leaving[e];
            if (used[o]) continue;
            const to = segs[o * 2 + 1], ox = x(to) - x(here), oy = y(to) - y(here);
            // The turn from the way in to the way out, to the left positive; straight back is the furthest right
            let turn = Math.atan2(ix * oy - iy * ox, ix * ox + iy * oy);
            if (turn >= Math.PI - 1e-12) turn = -Math.PI;
            if (turn > bestTurn) { bestTurn = turn; best = o; }
        }
        return best;
    };
    const rings: number[][] = [];
    for (let s0 = 0; s0 < nSegs; s0++) {
        if (used[s0]) continue;
        const ring: number[] = [];
        for (let s = s0; s >= 0 && !used[s]; s = next(s)) {
            used[s] = 1;
            ring.push(segs[s * 2]);
        }
        if (ring.length >= 3) rings.push(ring);
    }
    return rings;
}

export interface CutFill {
    /** Triangles over the inside of the cut: corners are places of the cut */
    triangles: Uint32Array;
    /** The area of the inside, in the mesh's units squared */
    area: number;
}

/** Two directions in the plane, at right angles to each other and to its normal */
export function planeAxes(normal: Vec3): [Vec3, Vec3] {
    const [nx, ny, nz] = normal;
    const len = Math.hypot(nx, ny, nz) || 1;
    const n: Vec3 = [nx / len, ny / len, nz / len];
    // Away from the axis the normal is nearest to
    const ref: Vec3 = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let u: Vec3 = [ref[1] * n[2] - ref[2] * n[1], ref[2] * n[0] - ref[0] * n[2], ref[0] * n[1] - ref[1] * n[0]];
    const ul = Math.hypot(u[0], u[1], u[2]) || 1;
    u = [u[0] / ul, u[1] / ul, u[2] / ul];
    const v: Vec3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
    return [u, v];
}

interface Ring { loop: number[]; xy: Float64Array; area: number; box: [number, number, number, number]; depth: number }

function inside(x: number, y: number, r: Ring): boolean {
    if (x < r.box[0] || x > r.box[2] || y < r.box[1] || y > r.box[3]) return false;
    const xy = r.xy, n = xy.length / 2;
    let odd = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const yi = xy[i * 2 + 1], yj = xy[j * 2 + 1];
        if ((yi > y) !== (yj > y) && x < xy[i * 2] + ((y - yi) / (yj - yi)) * (xy[j * 2] - xy[i * 2])) odd = !odd;
    }
    return odd;
}

/**
 * The inside of a cut's rings, as triangles (null: it has no ring, or they
 * enclose nothing).
 */
export function fillCut(cut: MeshCut, normal: Vec3): CutFill | null {
    if (cut.loops.length === 0) return null;
    const [u, v] = planeAxes(normal);
    const p = cut.points;
    const rings: Ring[] = [];
    for (const loop of cut.loops) {
        const xy = new Float64Array(loop.length * 2);
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let i = 0; i < loop.length; i++) {
            const k = loop[i] * 3;
            const x = p[k] * u[0] + p[k + 1] * u[1] + p[k + 2] * u[2], y = p[k] * v[0] + p[k + 1] * v[1] + p[k + 2] * v[2];
            xy[i * 2] = x; xy[i * 2 + 1] = y;
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        let area = 0;
        for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) area += xy[j * 2] * xy[i * 2 + 1] - xy[i * 2] * xy[j * 2 + 1];
        area /= 2;
        if (Math.abs(area) > 0) rings.push({ loop, xy, area, box: [x0, y0, x1, y1], depth: 0 });
    }
    if (rings.length === 0) return null;
    if (cut.oriented) return fillOriented(rings);
    // How many rings lie round each ring (a place just inside its first piece stands for it)
    const probe = (r: Ring): [number, number] => {
        const ax = r.xy[0], ay = r.xy[1], bx = r.xy[2], by = r.xy[3];
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        // To the left of the piece when the ring runs anticlockwise is inside it
        const lx = -(by - ay), ly = bx - ax, s = (r.area > 0 ? 1 : -1) * 1e-4;
        return [mx + lx * s, my + ly * s];
    };
    const probes = rings.map(probe);
    for (let i = 0; i < rings.length; i++) {
        let depth = 0;
        for (let j = 0; j < rings.length; j++) if (j !== i && inside(probes[i][0], probes[i][1], rings[j])) depth++;
        rings[i].depth = depth;
    }
    const tris: number[] = [];
    let area = 0;
    for (let i = 0; i < rings.length; i++) {
        const outer = rings[i];
        if (outer.depth % 2 === 1) { area -= Math.abs(outer.area); continue; }
        area += Math.abs(outer.area);
        const holes: Ring[] = [];
        for (let j = 0; j < rings.length; j++) {
            if (j !== i && rings[j].depth === outer.depth + 1 && inside(probes[j][0], probes[j][1], outer)) holes.push(rings[j]);
        }
        const flat = (r: Ring) => Array.from({ length: r.loop.length }, (_, k) => new Vector2(r.xy[k * 2], r.xy[k * 2 + 1]));
        const index = [...outer.loop, ...holes.flatMap(h => h.loop)];
        for (const face of ShapeUtils.triangulateShape(flat(outer), holes.map(flat))) tris.push(index[face[0]], index[face[1]], index[face[2]]);
    }
    if (tris.length === 0) return null;
    return { triangles: Uint32Array.from(tris), area };
}

/**
 * Rings that run with the solid on their left: those that turn to the left are parts, those that turn to the right
 * holes, each in the smallest part round it. (A mesh whose triangles all face inwards gives all of them the other
 * way round: the turns of all its rings add up to less than nothing, and then they are read the other way.)
 */
function fillOriented(rings: Ring[]): CutFill | null {
    const sum = rings.reduce((a, r) => a + r.area, 0);
    const sign = sum < 0 ? -1 : 1;
    // Rings of a mesh that faces one way alternate, part and hole, from the outside in. One that turns the same way as
    // the ring round it is wound the wrong way (a hollow walled like an outside, a lump walled like a hollow, as some
    // files have them): it is read the other way round, as counting the rings round it would read it
    const bySize = [...rings].sort((a, b) => Math.abs(a.area) - Math.abs(b.area));
    const isPart = new Map<Ring, boolean>();
    for (const r of bySize) {
        const [px, py] = inHole(r);
        const round = bySize.find(o => o !== r && Math.abs(o.area) > Math.abs(r.area) && inside(px, py, o));
        const turnsAsPart = r.area * sign > 0;
        const roundTurnsAsPart = round ? round.area * sign > 0 : false;
        isPart.set(r, turnsAsPart !== roundTurnsAsPart ? turnsAsPart : !turnsAsPart);
    }
    const parts = bySize.filter(r => isPart.get(r));
    const holes = rings.filter(r => !isPart.get(r));
    return fillParts(parts, holes);
}

/** A place inside a ring's own line, whichever way it runs: just to that side of its longest piece */
function inHole(r: Ring): [number, number] {
    const n = r.loop.length;
    let best = 0, length = -1;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, l = Math.hypot(r.xy[j * 2] - r.xy[i * 2], r.xy[j * 2 + 1] - r.xy[i * 2 + 1]);
        if (l > length) { length = l; best = i; }
    }
    const j = (best + 1) % n, ax = r.xy[best * 2], ay = r.xy[best * 2 + 1], bx = r.xy[j * 2], by = r.xy[j * 2 + 1];
    // Left of a piece is inside a ring that turns to the left, right of it inside one that turns to the right
    const s = (r.area > 0 ? 1 : -1) * 1e-4;
    return [(ax + bx) / 2 - (by - ay) * s, (ay + by) / 2 + (bx - ax) * s];
}

/** Parts (smallest first) with the holes in them, as triangles: each hole in the smallest part round it */
function fillParts(parts: readonly Ring[], holes: readonly Ring[]): CutFill | null {
    const holesOf = new Map<Ring, Ring[]>();
    for (const h of holes) {
        const [px, py] = inHole(h);
        const round = parts.find(p => Math.abs(p.area) > Math.abs(h.area) && inside(px, py, p));
        if (round) holesOf.set(round, [...(holesOf.get(round) ?? []), h]);
    }
    const flat = (r: Ring) => Array.from({ length: r.loop.length }, (_, k) => new Vector2(r.xy[k * 2], r.xy[k * 2 + 1]));
    const tris: number[] = [];
    let area = 0;
    for (const part of parts) {
        const hs = holesOf.get(part) ?? [];
        area += Math.abs(part.area) - hs.reduce((a, h) => a + Math.abs(h.area), 0);
        const index = [...part.loop, ...hs.flatMap(h => h.loop)];
        for (const face of ShapeUtils.triangulateShape(flat(part), hs.map(flat))) tris.push(index[face[0]], index[face[1]], index[face[2]]);
    }
    if (tris.length === 0) return null;
    return { triangles: Uint32Array.from(tris), area };
}
