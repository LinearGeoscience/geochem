/**
 * A height through the layers of the ground, from readings of how it lies
 * (pure, unit-tested).
 *
 * Readings say which way the ground lies at each place; they do not say
 * which places are on the same layer. This works that out: a number for
 * every place (its "height through the layers") that stays the same along
 * the ground as the readings say it lies and goes up by a metre for every
 * metre across it. On a folded layer the height is the same all the way
 * round the fold.
 *
 * It is found from the readings alone. Each reading (or readings close
 * together, taken as one) is a node: a place and the axis across the
 * ground there. Neighbouring nodes are first given the same way up (an
 * axis has none of its own), from one to the next outwards from the first.
 * Then each node is given a height such that, between every two
 * neighbours, the difference in height is the distance from one to the
 * other measured across the ground as the two say it lies (taking the
 * average of their axes). No set of heights fits every pair exactly when
 * the readings are scattered, so the heights that fit them all best are
 * taken. Between nodes the height is each nearby node's own estimate (its
 * height, and across the ground from there, taking the average of its axis
 * and the axis at the place), blended by how near each is.
 *
 * A fit that follows the ground (rbf.ts, `Layering`) takes this height as
 * one more coordinate: two places on one layer are then as near each other
 * as they are in the ground, and two places on different layers are further
 * apart by the layers between them, counted several times over.
 *
 * The same sum gives how far across the plunge a place is (Phase 246):
 * the nodes are then given the axis that lies in the layers square to
 * their long direction (trendField.ts, `acrossNodes`), and the number that
 * comes out stays the same down the plunge and goes up by a metre for
 * every metre across it. A fit takes it as a second coordinate
 * (`Layering.second`), and shoots that run down a plunge which turns from
 * place to place stay in one piece (frame246.test.ts).
 */
import { unit } from './plane';
import type { HeightLattice, Layering } from './rbf';
import type { Box3, Vec3 } from './types';

/** A node counts most within this share of the range (as the direction field's readings do) */
const NEAR = 0.15;
/** Rounds of fitting the heights to every pair of neighbours, and how far past each answer a round steps */
const ROUNDS = 120, OVER = 1.5;
/** Nodes round about that add up to less than this say nothing */
const SILENT = 1e-6;
/** A turn of the axes by no round angle (rows: the new axes), so that nodes in rows and columns do not sit between one side and the next */
const TURN = (() => {
    const a = 0.47, b = 0.33;
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    return [ca, -sa, 0, sa * cb, ca * cb, -sb, sa * sb, ca * sb, cb];
})();
/** The lattice has about this many places to the range, and no more than this many in all */
const LATTICE_TO_RANGE = 12, LATTICE_MOST = 600_000;

export interface FrameNode {
    p: ArrayLike<number>;
    /** The unit axis across the ground here, either way round */
    axis: ArrayLike<number>;
    /** How many readings it stands for */
    count?: number;
}

/** A height through the layers: plain numbers, so it can be handed to a worker */
export interface Potential {
    /** How far a node counts, m */
    range: number;
    /** The nodes: where each is (xyz triples), its axis the way up it was given (xyz triples), its height, and what it counts for */
    at: Float64Array;
    axes: Float64Array;
    heights: Float64Array;
    counts: Float64Array;
}

/** Nodes by the box each is in (the boxes no smaller than the range) */
interface Boxes {
    min: Vec3;
    side: number;
    size: [number, number, number];
    /** The nodes of box b are `order[start[b]]` to `order[start[b + 1] - 1]` */
    start: Int32Array;
    order: Int32Array;
}

function boxesOf(at: ArrayLike<number>, range: number): Boxes {
    const n = Math.floor(at.length / 3);
    const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n * 3; i++) {
        if (at[i] < min[i % 3]) min[i % 3] = at[i];
        if (at[i] > max[i % 3]) max[i % 3] = at[i];
    }
    let side = range;
    const size: [number, number, number] = [1, 1, 1];
    for (; ; side *= 2) {
        for (let k = 0; k < 3; k++) size[k] = Math.floor((max[k] - min[k]) / side) + 1;
        if (size[0] * size[1] * size[2] <= 1_000_000) break;
    }
    const boxes = size[0] * size[1] * size[2];
    const start = new Int32Array(boxes + 1), order = new Int32Array(n), box = new Int32Array(n);
    for (let i = 0; i < n; i++) {
        box[i] = Math.floor((at[i * 3] - min[0]) / side) + size[0] * (Math.floor((at[i * 3 + 1] - min[1]) / side) + size[1] * Math.floor((at[i * 3 + 2] - min[2]) / side));
        start[box[i] + 1]++;
    }
    for (let b = 0; b < boxes; b++) start[b + 1] += start[b];
    const next = start.slice(0, boxes);
    for (let i = 0; i < n; i++) order[next[box[i]]++] = i;
    return { min, side, size, start, order };
}

/** Every node in the boxes round a place, to `visit` */
function eachNear(b: Boxes, x: number, y: number, z: number, visit: (i: number) => void): void {
    const i0 = Math.floor((x - b.min[0]) / b.side), j0 = Math.floor((y - b.min[1]) / b.side), k0 = Math.floor((z - b.min[2]) / b.side);
    const from = Math.max(0, i0 - 1), to = Math.min(b.size[0] - 1, i0 + 1);
    if (from > to) return;
    for (let k = Math.max(0, k0 - 1); k <= Math.min(b.size[2] - 1, k0 + 1); k++) {
        for (let j = Math.max(0, j0 - 1); j <= Math.min(b.size[1] - 1, j0 + 1); j++) {
            const row = b.size[0] * (j + b.size[1] * k);
            for (let q = b.start[row + from], end = b.start[row + to + 1]; q < end; q++) visit(b.order[q]);
        }
    }
}

/**
 * For each node, the nearest other node on each of eight sides within the
 * range (down a hole the next node is a few metres off, and the next hole
 * fifty: the nearest few would all be in its own hole). One with none
 * within the range is tied to the nearest there is, however far. Ties go
 * both ways.
 */
function tiesOf(at: Float64Array, n: number, range: number, boxes: Boxes): { to: number[]; far: number[] }[] {
    const ties: { to: number[]; far: number[] }[] = Array.from({ length: n }, () => ({ to: [], far: [] }));
    const best = new Float64Array(8), who = new Int32Array(8);
    const tie = (i: number, j: number, d: number) => {
        if (ties[i].to.includes(j)) return;
        ties[i].to.push(j); ties[i].far.push(d);
        ties[j].to.push(i); ties[j].far.push(d);
    };
    for (let i = 0; i < n; i++) {
        best.fill(range * range);
        who.fill(-1);
        const x = at[i * 3], y = at[i * 3 + 1], z = at[i * 3 + 2];
        eachNear(boxes, x, y, z, j => {
            if (j === i) return;
            const dx = at[j * 3] - x, dy = at[j * 3 + 1] - y, dz = at[j * 3 + 2] - z;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (!(d2 > 0)) return;
            const side = (TURN[0] * dx + TURN[1] * dy + TURN[2] * dz > 0 ? 1 : 0) | (TURN[3] * dx + TURN[4] * dy + TURN[5] * dz > 0 ? 2 : 0) | (TURN[6] * dx + TURN[7] * dy + TURN[8] * dz > 0 ? 4 : 0);
            if (d2 < best[side]) { best[side] = d2; who[side] = j; }
        });
        for (let s = 0; s < 8; s++) if (who[s] >= 0) tie(i, who[s], Math.sqrt(best[s]));
        if (ties[i].to.length === 0 && n > 1) {
            let near = -1, nearD = Infinity;
            for (let j = 0; j < n; j++) {
                if (j === i) continue;
                const d2 = (at[j * 3] - x) ** 2 + (at[j * 3 + 1] - y) ** 2 + (at[j * 3 + 2] - z) ** 2;
                if (d2 > 0 && d2 < nearD) { nearD = d2; near = j; }
            }
            if (near >= 0) tie(i, near, Math.sqrt(nearD));
        }
    }
    return ties;
}

/** A heap of [distance, node, from] by distance */
class Heap {
    private readonly items: [number, number, number][] = [];
    get size() { return this.items.length; }
    push(item: [number, number, number]) {
        const a = this.items;
        a.push(item);
        for (let i = a.length - 1; i > 0;) {
            const up = (i - 1) >> 1;
            if (a[up][0] <= a[i][0]) break;
            [a[up], a[i]] = [a[i], a[up]];
            i = up;
        }
    }
    pop(): [number, number, number] {
        const a = this.items;
        const top = a[0], last = a.pop()!;
        if (a.length > 0) {
            a[0] = last;
            for (let i = 0; ;) {
                const l = 2 * i + 1, r = l + 1;
                let least = i;
                if (l < a.length && a[l][0] < a[least][0]) least = l;
                if (r < a.length && a[r][0] < a[least][0]) least = r;
                if (least === i) break;
                [a[least], a[i]] = [a[i], a[least]];
                i = least;
            }
        }
        return top;
    }
}

/**
 * The height through the layers that these nodes give. `range`: how far a
 * node counts (as the direction field's). Null without nodes.
 */
export function buildPotential(nodes: readonly FrameNode[], range: number): Potential | null {
    const usable = nodes.filter(nd => unit(nd.axis) && Number.isFinite(nd.p[0]) && Number.isFinite(nd.p[1]) && Number.isFinite(nd.p[2]));
    const n = usable.length;
    if (n === 0 || !(range > 0)) return null;
    const at = new Float64Array(n * 3), axes = new Float64Array(n * 3), counts = new Float64Array(n), heights = new Float64Array(n);
    usable.forEach((nd, i) => {
        at.set([nd.p[0], nd.p[1], nd.p[2]], i * 3);
        axes.set(unit(nd.axis)!, i * 3);
        counts[i] = Math.max(1, nd.count ?? 1);
    });
    const ties = tiesOf(at, n, range, boxesOf(at, range));

    // Across from i to j, as the two say the ground lies
    const across = (i: number, j: number) => {
        let d = 0;
        for (let k = 0; k < 3; k++) d += 0.5 * (axes[i * 3 + k] + axes[j * 3 + k]) * (at[j * 3 + k] - at[i * 3 + k]);
        return d;
    };

    // The same way up from neighbour to neighbour, outwards from the node that stands for most; and a first height for each on the way
    const done = new Uint8Array(n);
    let visited = 0;
    while (visited < n) {
        let start = -1;
        for (let i = 0; i < n; i++) if (!done[i] && (start < 0 || counts[i] > counts[start])) start = i;
        // (A part with no tie to what is done already starts again at height 0, its first node the way up it is nearer to)
        if (axes[start * 3 + 2] < 0) for (let k = 0; k < 3; k++) axes[start * 3 + k] = -axes[start * 3 + k];
        const heap = new Heap();
        heap.push([0, start, -1]);
        while (heap.size > 0) {
            const [, j, from] = heap.pop();
            if (done[j]) continue;
            done[j] = 1;
            visited++;
            if (from >= 0) {
                if (axes[j * 3] * axes[from * 3] + axes[j * 3 + 1] * axes[from * 3 + 1] + axes[j * 3 + 2] * axes[from * 3 + 2] < 0) for (let k = 0; k < 3; k++) axes[j * 3 + k] = -axes[j * 3 + k];
                heights[j] = heights[from] + across(from, j);
            }
            ties[j].to.forEach((to, k) => { if (!done[to]) heap.push([ties[j].far[k], to, j]); });
        }
    }

    // The heights that fit every pair of neighbours best: each in turn is moved towards where its neighbours say it is
    for (let round = 0; round < ROUNDS; round++) {
        let moved = 0;
        for (let i = 0; i < n; i++) {
            let sum = 0, weight = 0;
            const t = ties[i];
            for (let k = 0; k < t.to.length; k++) {
                const w = 1 / (t.far[k] * t.far[k] + 1e-9);
                sum += w * (heights[t.to[k]] - across(i, t.to[k]));
                weight += w;
            }
            if (!(weight > 0)) continue;
            const step = OVER * (sum / weight - heights[i]);
            if (Math.abs(step) > moved) moved = Math.abs(step);
            heights[i] += step;
        }
        if (moved < 1e-5 * range) break;
    }
    return { range, at, axes, heights, counts };
}

const boxesFor = new WeakMap<Potential, Boxes>();
function indexOf(potential: Potential): Boxes {
    let boxes = boxesFor.get(potential);
    if (!boxes) {
        boxes = boxesOf(potential.at, potential.range);
        boxesFor.set(potential, boxes);
    }
    return boxes;
}

/**
 * What the nodes within the range say at a place: the height, and the unit
 * axis across the ground, to `into` (four numbers). Returns how much they
 * count for there (0: none is near; `into` is then untouched).
 */
function sample(potential: Potential, boxes: Boxes, x: number, y: number, z: number, into: Float64Array): number {
    const { range, at, axes, heights, counts } = potential;
    let s0 = 0, s1 = 0, vx = 0, vy = 0, vz = 0, ax = 0, ay = 0, az = 0, weight = 0;
    const inv = 1 / (range * range);
    eachNear(boxes, x, y, z, i => {
        const dx = x - at[i * 3], dy = y - at[i * 3 + 1], dz = z - at[i * 3 + 2];
        const r2 = (dx * dx + dy * dy + dz * dz) * inv;
        if (r2 >= 1) return;
        const w = counts[i] * (1 - r2) * (1 - r2) * (NEAR * NEAR) / (r2 + NEAR * NEAR);
        const nx = axes[i * 3], ny = axes[i * 3 + 1], nz = axes[i * 3 + 2];
        s0 += w * heights[i];
        s1 += w * (nx * dx + ny * dy + nz * dz);
        vx += w * dx; vy += w * dy; vz += w * dz;
        ax += w * nx; ay += w * ny; az += w * nz;
        weight += w;
    });
    if (!(weight > 0)) return 0;
    // Across from each node to here: by the average of its axis and the axis here
    const length = Math.hypot(ax, ay, az);
    if (length > 1e-9 * weight) {
        ax /= length; ay /= length; az /= length;
        into[0] = (s0 + 0.5 * s1 + 0.5 * (ax * vx + ay * vy + az * vz)) / weight;
    } else {
        ax = 0; ay = 0; az = 0;
        into[0] = (s0 + s1) / weight;
    }
    into[1] = ax; into[2] = ay; into[3] = az;
    return weight;
}

/** The node nearest a place */
function nearestNode(potential: Potential, x: number, y: number, z: number): number {
    const { at } = potential;
    let best = 0, bestD = Infinity;
    for (let i = 0; i * 3 < at.length; i++) {
        const d = (at[i * 3] - x) ** 2 + (at[i * 3 + 1] - y) ** 2 + (at[i * 3 + 2] - z) ** 2;
        if (d < bestD) { bestD = d; best = i; }
    }
    return best;
}

/**
 * The height through the layers at places (xyz triples). Beyond the range
 * of every node it carries on flat from the nearest. (For a few places: a
 * fit reads it from a lattice, `heightLattice`.)
 */
export function potentialAt(potential: Potential, points: ArrayLike<number>, out?: Float64Array): Float64Array {
    const boxes = indexOf(potential);
    const count = Math.floor(points.length / 3);
    const res = out ?? new Float64Array(count);
    const got = new Float64Array(4);
    const { at, axes, heights } = potential;
    for (let q = 0; q < count; q++) {
        const x = points[q * 3], y = points[q * 3 + 1], z = points[q * 3 + 2];
        if (sample(potential, boxes, x, y, z, got) >= SILENT) { res[q] = got[0]; continue; }
        const i = nearestNode(potential, x, y, z);
        res[q] = heights[i] + axes[i * 3] * (x - at[i * 3]) + axes[i * 3 + 1] * (y - at[i * 3 + 1]) + axes[i * 3 + 2] * (z - at[i * 3 + 2]);
    }
    return res;
}

/**
 * The height through the layers at the places of a lattice that covers a
 * box: what a fit reads it from (the same numbers for the samples it is
 * fitted to and for every place it is read at afterwards). Beyond the range
 * of every node the height carries on flat from the lattice places next to
 * it that have one, outwards.
 */
export function heightLattice(potential: Potential, box: Box3, most = LATTICE_MOST): HeightLattice {
    const extent = [0, 1, 2].map(k => Math.max(0, box.max[k] - box.min[k]));
    const volume = Math.max(extent[0], 1e-9) * Math.max(extent[1], 1e-9) * Math.max(extent[2], 1e-9);
    const cell = Math.max(potential.range / LATTICE_TO_RANGE, Math.cbrt(volume / most), 1e-9);
    const size = extent.map(e => Math.max(2, Math.ceil(e / cell) + 1)) as [number, number, number];
    const [nx, ny, nz] = size;
    const total = nx * ny * nz;
    const heights = new Float32Array(total);
    const gx = new Float32Array(total), gy = new Float32Array(total), gz = new Float32Array(total);
    const known = new Uint8Array(total);
    const boxes = indexOf(potential);
    const got = new Float64Array(4);
    let found = 0;
    for (let k = 0, c = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++, c++) {
        if (sample(potential, boxes, box.min[0] + i * cell, box.min[1] + j * cell, box.min[2] + k * cell, got) < SILENT) continue;
        heights[c] = got[0]; gx[c] = got[1]; gy[c] = got[2]; gz[c] = got[3];
        known[c] = 1;
        found++;
    }
    const min: Vec3 = [box.min[0], box.min[1], box.min[2]];
    if (found === 0) {
        // No node is anywhere near the box: flat from the one nearest its middle
        const { at, axes } = potential;
        const m = nearestNode(potential, (box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2);
        for (let k = 0, c = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++, c++) {
            heights[c] = potential.heights[m] + axes[m * 3] * (min[0] + i * cell - at[m * 3]) + axes[m * 3 + 1] * (min[1] + j * cell - at[m * 3 + 1]) + axes[m * 3 + 2] * (min[2] + k * cell - at[m * 3 + 2]);
        }
        return { min, cell, size, heights };
    }
    if (found < total) {
        // Outwards, a layer of lattice places at a time: each from the places next to it that have a height already
        const steps: [number, number, number, number][] = [[1, 0, 0, 1], [-1, 0, 0, -1], [0, 1, 0, nx], [0, -1, 0, -nx], [0, 0, 1, nx * ny], [0, 0, -1, -nx * ny]];
        const queued = new Uint8Array(total);
        const inside = (i: number, j: number, k: number) => i >= 0 && i < nx && j >= 0 && j < ny && k >= 0 && k < nz;
        let layer: number[] = [];
        const reach = (c: number) => {
            const i = c % nx, j = Math.floor(c / nx) % ny, k = Math.floor(c / (nx * ny));
            for (const [di, dj, dk, dc] of steps) {
                if (!inside(i + di, j + dj, k + dk) || known[c + dc] || queued[c + dc]) continue;
                queued[c + dc] = 1;
                layer.push(c + dc);
            }
        };
        for (let c = 0; c < total; c++) if (known[c]) reach(c);
        while (layer.length > 0) {
            const now = layer;
            layer = [];
            const h = new Float32Array(now.length), ux = new Float32Array(now.length), uy = new Float32Array(now.length), uz = new Float32Array(now.length);
            now.forEach((c, q) => {
                const i = c % nx, j = Math.floor(c / nx) % ny, k = Math.floor(c / (nx * ny));
                let sum = 0, ax = 0, ay = 0, az = 0, from = 0;
                for (const [di, dj, dk, dc] of steps) {
                    if (!inside(i + di, j + dj, k + dk) || !known[c + dc]) continue;
                    // (This place is one step back the other way from that one)
                    sum += heights[c + dc] - cell * (gx[c + dc] * di + gy[c + dc] * dj + gz[c + dc] * dk);
                    ax += gx[c + dc]; ay += gy[c + dc]; az += gz[c + dc];
                    from++;
                }
                const length = Math.hypot(ax, ay, az) || 1;
                h[q] = sum / from; ux[q] = ax / length; uy[q] = ay / length; uz[q] = az / length;
            });
            now.forEach((c, q) => { heights[c] = h[q]; gx[c] = ux[q]; gy[c] = uy[q]; gz[c] = uz[q]; known[c] = 1; });
            for (const c of now) reach(c);
        }
    }
    return { min, cell, size, heights };
}

/** What a fit along the ground is made with: the heights through the layers and how much further things carry along them than across; and the same across the plunge */
export interface FrameChoice {
    potential: Potential;
    strength: number;
    second?: { potential: Potential; strength: number } | null;
}

/** The lattices a fit reads its extra coordinates from, over a box (rbf.ts, `Layering`): a metre across counts as `strength` metres along */
export function layeringOf(frame: FrameChoice, box: Box3): Layering {
    const weight = (strength: number) => Math.sqrt(strength * strength - 1);
    const second = frame.second && frame.second.strength > 1 ? { ...heightLattice(frame.second.potential, box), weight: weight(frame.second.strength) } : null;
    return { ...heightLattice(frame.potential, box), weight: weight(frame.strength), ...(second ? { second } : {}) };
}

/** How far the heights are from fitting each pair of neighbouring nodes: the usual miss, m (for checking) */
export function potentialMisfit(potential: Potential): number {
    const { at, axes, heights, range } = potential;
    const n = heights.length;
    const ties = tiesOf(at, n, range, indexOf(potential));
    const miss: number[] = [];
    for (let i = 0; i < n; i++) for (const j of ties[i].to) {
        let d = 0;
        for (let k = 0; k < 3; k++) d += 0.5 * (axes[i * 3 + k] + axes[j * 3 + k]) * (at[j * 3 + k] - at[i * 3 + k]);
        miss.push(Math.abs(heights[j] - heights[i] - d));
    }
    miss.sort((p, q) => p - q);
    return miss.length > 0 ? miss[miss.length >> 1] : 0;
}
