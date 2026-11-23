/**
 * Building a geological model (pure; run in the surface worker, or on the
 * main thread in tests): every surface's field is read on a grid over the
 * model's box, each node is given its unit by the model's rule
 * (geoModel.ts), and one mesher (cutCells.ts) gives the faces between the
 * units and round the boundary.
 *
 * The surfaces a face can lie on are numbered: the contacts first (oldest
 * first), then the model's faults, then the box's six faces, then the
 * outline and the top surface when the boundary has them.
 *
 * Faults cut the model into blocks (faults.ts). A node's label is its block
 * and its unit together (block * units + unit), so the one mesher also gives
 * the faces along the faults; a block's unit is by the contacts of that
 * block alone.
 *
 * A model inside one unit of another (a refined unit: alteration or
 * weathering inside a rock type) has that model's surfaces as more of its
 * boundary, after its own: a node has one of its units only where the other
 * model's own rule gives the unit it is inside, so its faces round that
 * unit are the other model's own, cut the same way.
 */
import { closedVolume } from './body';
import { boundaryGrid } from './boundary';
import { cutCells, OUTSIDE, type CutGrid, type CutMesh } from './cutCells';
import { blockCode, blockContacts, faultNet, type BlockSide, type FaultEnd, type FaultNet } from './faults';
import { unitAt, unitsAt, type RuleStep } from './geoModel';
import { meshReader, type MeshField } from './meshField';
import { nearReader, type NearGround } from './modelGround';
import { outlineDistance, outlineFrame } from './outline';
import { evaluateField, type FittedField } from './rbf';
import { clipMeshByScalar, clipMeshToBox } from './meshOps';
import { countThin } from './thinParts';
import type { Box3, SurfaceOutline, TriMesh } from './types';

/**
 * Where a fault that stops is there: within `reach` metres of its own places
 * (`at`, xyz triples), measured along the fault (across its overall plane,
 * `normal`: how far off the fault a place is does not count). Its value is
 * the reach less that distance: above nothing where the fault is.
 */
export interface ReachField { reach: number; at: Float64Array; normal: [number, number, number] }

/**
 * A contact beside a fault that stops. Well inside the fault's extent it is
 * its fit on its own side of the fault (`beside`); at the fault's end and
 * past it, its fit with the fault not there (`past`); and over the last part
 * of the extent (`TAPER` of it) the one is taken over into the other. Both
 * pass through the contact's places on this side, so the mix does too; and
 * past the end the contact is the same from either side: it runs unbroken
 * round the end of the fault, and its offset across the fault dies out
 * towards the end.
 */
export interface MixField { beside: ModelField; past: ModelField; there: ReachField }

/** What a contact of a model is read from: a fitted surface's field, a fixed mesh (its signed distance), or what is made of those for a fault that stops */
export type ModelField = FittedField | MeshField | ReachField | MixField;

/** The share of a stopping fault's extent, at its end, over which a contact beside it is taken over into the contact without it */
export const TAPER = 0.5;

/** How much of a contact beside a stopping fault is its fit on its own side (1: all), by how far inside the fault's extent a place is (`there`, a `ReachField`'s value) */
export function besideShare(there: number, reach: number): number {
    const t = there / (TAPER * reach);
    return !(t > 0) ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
}

function readReach(field: ReachField, points: Float64Array): Float64Array {
    const n = Math.floor(points.length / 3), { at, normal } = field, m = Math.floor(at.length / 3);
    const out = new Float64Array(n);
    // (Each place and each of the fault's places by how far across the plane it is, and how far off it)
    const off = new Float64Array(m);
    for (let q = 0; q < m; q++) off[q] = at[q * 3] * normal[0] + at[q * 3 + 1] * normal[1] + at[q * 3 + 2] * normal[2];
    for (let i = 0; i < n; i++) {
        const x = points[i * 3], y = points[i * 3 + 1], z = points[i * 3 + 2];
        const h = x * normal[0] + y * normal[1] + z * normal[2];
        let least = Infinity;
        for (let q = 0; q < m; q++) {
            const dx = at[q * 3] - x, dy = at[q * 3 + 1] - y, dz = at[q * 3 + 2] - z, dh = off[q] - h;
            const d = dx * dx + dy * dy + dz * dz - dh * dh;
            if (d < least) least = d;
        }
        out[i] = field.reach - Math.sqrt(Math.max(0, least));
    }
    return out;
}

function readMix(field: MixField, points: Float64Array): Float64Array {
    const n = Math.floor(points.length / 3);
    const there = readReach(field.there, points);
    const out = new Float64Array(n);
    // Each of the two is read only where it counts
    const share = new Float64Array(n), a: number[] = [], b: number[] = [];
    for (let i = 0; i < n; i++) {
        share[i] = besideShare(there[i], field.there.reach);
        if (share[i] > 0) a.push(i);
        if (share[i] < 1) b.push(i);
    }
    const some = (ids: number[]) => {
        const p = new Float64Array(ids.length * 3);
        ids.forEach((i, q) => { p[q * 3] = points[i * 3]; p[q * 3 + 1] = points[i * 3 + 1]; p[q * 3 + 2] = points[i * 3 + 2]; });
        return p;
    };
    if (a.length > 0) { const f = readModelField(field.beside, a.length === n ? points : some(a)); a.forEach((i, q) => { out[i] += share[i] * f[q]; }); }
    if (b.length > 0) { const f = readModelField(field.past, b.length === n ? points : some(b)); b.forEach((i, q) => { out[i] += (1 - share[i]) * f[q]; }); }
    return out;
}

/** A model field at places (xyz triples) */
export function readModelField(field: ModelField, points: Float64Array): Float64Array {
    if ('triangles' in field) return meshReader(field).read(points);
    if ('beside' in field) return readMix(field, points);
    if ('reach' in field) return readReach(field, points);
    return evaluateField(field, points);
}

export interface ModelJob {
    box: Box3;
    cell: number;
    outline: SurfaceOutline | null;
    /** It is kept near its drilling: the places down its holes and how far from them it goes, gaps narrower than that filled (absent or null: it fills its box) */
    near?: NearGround | null;
    /** The field of the surface that is the model's top (null: none) */
    top: ModelField | null;
    /** The contacts, oldest first, and each one's field */
    steps: RuleStep[];
    fields: ModelField[];
    /** The unit each contact puts on its young side, as a number (0 is the base unit) */
    unitOf: number[];
    /** How many units there are */
    units: number;
    /**
     * Its faults: each one's field, and the sides of the others it ends on
     * (absent: none). `there`: per fault, where it is there when it stops
     * (null: it runs through; absent: none stops).
     */
    faults?: { fields: ModelField[]; ends: FaultEnd[][]; there?: (ReachField | null)[] };
    /** Per contact, the sides of faults it is limited to; a side of 0: where that fault is not there (absent or null: every block) */
    within?: (BlockSide[] | null)[];
    /**
     * Per contact, its own closed mesh when it is an intrusion too thin for
     * the cells to hold (a vein): the cells are then cut without it, and its
     * mesh is its unit's solid, where the model's rule has that contact's
     * unit (inside the boundary, in its own fault block, and not where a
     * younger unit is): `thinUnits` (absent or null: it is cut into the
     * cells like any other).
     */
    thin?: (TriMesh | null)[];
    /**
     * It is inside one unit of another model: that model's build, which way
     * up its top was found to be, and the unit's number in it (absent: it
     * fills its own boundary).
     */
    inside?: { job: ModelJob; topSense: 1 | -1 | 0; unit: number };
}

/** A unit too thin for the cells, as its own mesh: the part of it the model has in one fault block */
export interface ThinUnit extends TriMesh {
    /** Its contact and its unit, by their numbers in the build */
    contact: number;
    unit: number;
    /** The fault block it is in (0 when the model has no faults) */
    block: number;
    /** What it holds there, m3 (null: it could not be measured) */
    volume: number | null;
    /** The model cuts it (its boundary, a fault, a younger unit), and it is open where it is cut */
    cut: boolean;
}

export type ModelOutput = Omit<CutMesh, 'labels'> & {
    grid: CutGrid;
    /** The number of the first fault among the surfaces (the contacts come before it), and of the first boundary surface */
    faultFrom: number;
    boundaryFrom: number;
    /** How many units: a face's labels are block * unitCount + unit */
    unitCount: number;
    /** The fault blocks: per block, the side of each fault it is on (0: that fault is not there). One block when there are no faults */
    blocks: number[][];
    /** The volume of each unit in each block, m3 */
    blockVolumes: number[][];
    /** The faults that end on each other in a loop (those ends were not used) */
    looped: number[];
    /** Which way up the top surface's field is (0: there is none) */
    topSense: 1 | -1 | 0;
    /**
     * The volume of each unit, m3 (with what its thin parts hold, which is
     * taken out of the ground they are in): what its solid holds, or, in a model
     * one of whose solids has not all of its unit (a unit thinner than the
     * cells), counted from the surfaces inside every cell that units meet in
     * (`countedVolumes`).
     */
    volumes: number[];
    /** The volume each unit's solid holds, m3: less than its volume where the unit is thinner than the cells */
    solids: number[];
    /** The units too thin for the cells (absent: none) */
    thin?: ThinUnit[];
    ms: number;
    /**
     * Of that: the surfaces read on the grid, the solids cut, their volumes, the units too thin for the cells (ms);
     * and of the thin units: the model's surfaces read at their corners, the rule there, what they hold, their cutting
     */
    parts?: { fields: number; cut: number; volumes: number; thin: number; thinRead: number; thinRule: number; thinCount: number; thinCut: number };
};

/** Coarse blocks are this many cells across */
const COARSE = 4;
const BATCH = 20_000;

/**
 * A field read at every node of a grid. It is read exactly on a coarse
 * lattice first. A block all of whose corners are far from zero (further
 * than the field could fall from a corner to the middle of the block at
 * twice its steepest slope there) is filled in between them. Any other is
 * halved each way and its parts looked at the same way, and only a block
 * two cells across that is still near zero is read node by node: so the
 * field itself is read in a band a few cells either side of its surface,
 * however fine the cells.
 */
export function fieldOnGrid(read: (points: Float64Array) => Float64Array, grid: CutGrid): Float32Array {
    const [nx, ny, nz] = grid.n;
    // (Single precision: a field is metres from its surface, good to a tenth of a millimetre a kilometre off, in half the memory)
    const out = new Float32Array(nx * ny * nz);
    /** 1: read from the field itself (2: about to be) */
    const exact = new Uint8Array(out.length);
    const axis = (n: number) => {
        const at: number[] = [];
        for (let i = 0; i < n - 1; i += COARSE) at.push(i);
        at.push(n - 1);
        return at;
    };
    const xs = axis(nx), ys = axis(ny), zs = axis(nz);
    const world = (ids: ArrayLike<number>) => {
        const p = new Float64Array(ids.length * 3);
        for (let q = 0; q < ids.length; q++) {
            const id = ids[q], i = id % nx, j = Math.floor(id / nx) % ny, k = Math.floor(id / (nx * ny));
            p[q * 3] = grid.origin[0] + i * grid.cell;
            p[q * 3 + 1] = grid.origin[1] + j * grid.cell;
            p[q * 3 + 2] = grid.origin[2] + k * grid.cell;
        }
        return p;
    };
    const readAt = (ids: number[]) => {
        for (let from = 0; from < ids.length; from += BATCH) {
            const part = ids.slice(from, from + BATCH);
            const f = read(world(part));
            for (let q = 0; q < part.length; q++) { out[part[q]] = f[q]; exact[part[q]] = 1; }
        }
    };
    const want: number[] = [];
    const ask = (id: number) => { if (!exact[id]) { exact[id] = 2; want.push(id); } };
    const corner = new Float64Array(8);
    const EDGES = [[0, 1, 0], [2, 3, 0], [4, 5, 0], [6, 7, 0], [0, 2, 1], [1, 3, 1], [4, 6, 1], [5, 7, 1], [0, 4, 2], [1, 5, 2], [2, 6, 2], [3, 7, 2]];
    const size = [0, 0, 0];

    // The blocks still to be looked at, six numbers each: from and to along x, y and z
    let blocks: number[] = [];
    for (let c = 0; c + 1 < zs.length; c++) for (let b = 0; b + 1 < ys.length; b++) for (let a = 0; a + 1 < xs.length; a++) {
        blocks.push(xs[a], xs[a + 1], ys[b], ys[b + 1], zs[c], zs[c + 1]);
    }
    // (A grid one node thick some way has no blocks that way: its nodes are all read)
    if (blocks.length === 0) { for (let id = 0; id < out.length; id++) ask(id); readAt(want); return out; }
    while (blocks.length > 0) {
        want.length = 0;
        for (let q = 0; q < blocks.length; q += 6) {
            for (const k of [blocks[q + 4], blocks[q + 5]]) for (const j of [blocks[q + 2], blocks[q + 3]]) for (const i of [blocks[q], blocks[q + 1]]) ask(i + nx * (j + ny * k));
        }
        readAt(want);
        want.length = 0;
        const next: number[] = [];
        for (let q = 0; q < blocks.length; q += 6) {
            const i0 = blocks[q], i1 = blocks[q + 1], j0 = blocks[q + 2], j1 = blocks[q + 3], k0 = blocks[q + 4], k1 = blocks[q + 5];
            size[0] = i1 - i0; size[1] = j1 - j0; size[2] = k1 - k0;
            const widest = Math.max(size[0], size[1], size[2]);
            // (One cell: its nodes are its corners, and they are read)
            if (widest <= 1) continue;
            let c = 0, least = Infinity, pos = 0;
            for (const k of [k0, k1]) for (const j of [j0, j1]) for (const i of [i0, i1]) {
                const f = out[i + nx * (j + ny * k)];
                corner[c++] = f;
                if (!(Math.abs(f) >= least)) least = Math.abs(f);
                if (f > 0) pos++;
            }
            // Its steepest fall along an edge of the block, per cell
            let slope = 0;
            for (const [p, r, d] of EDGES) if (size[d] > 0) slope = Math.max(slope, Math.abs(corner[p] - corner[r]) / size[d]);
            if ((pos === 0 || pos === 8) && Number.isFinite(least) && least > slope * Math.hypot(size[0], size[1], size[2])) {
                // Far from the surface all through: filled in between its corners (what was read from the field stays)
                for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
                    const id = i + nx * (j + ny * k);
                    if (exact[id]) continue;
                    const u = size[0] ? (i - i0) / size[0] : 0, v = size[1] ? (j - j0) / size[1] : 0, w = size[2] ? (k - k0) / size[2] : 0;
                    out[id] = ((corner[0] * (1 - u) + corner[1] * u) * (1 - v) + (corner[2] * (1 - u) + corner[3] * u) * v) * (1 - w)
                        + ((corner[4] * (1 - u) + corner[5] * u) * (1 - v) + (corner[6] * (1 - u) + corner[7] * u) * v) * w;
                }
                continue;
            }
            if (widest <= 2) {
                // Near the surface, and as small as a block is looked at: every node of it
                for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) ask(i + nx * (j + ny * k));
                continue;
            }
            // Halved each way it is more than a cell
            const im = size[0] > 1 ? (i0 + i1) >> 1 : i1, jm = size[1] > 1 ? (j0 + j1) >> 1 : j1, km = size[2] > 1 ? (k0 + k1) >> 1 : k1;
            for (const [ka, kb] of km < k1 ? [[k0, km], [km, k1]] : [[k0, k1]]) {
                for (const [ja, jb] of jm < j1 ? [[j0, jm], [jm, j1]] : [[j0, j1]]) {
                    for (const [ia, ib] of im < i1 ? [[i0, im], [im, i1]] : [[i0, i1]]) next.push(ia, ib, ja, jb, ka, kb);
                }
            }
        }
        readAt(want);
        blocks = next;
    }
    return out;
}

/** A function of place at every node of a grid */
function onGrid(grid: CutGrid, fn: (x: number, y: number, z: number) => number): Float32Array {
    const [nx, ny, nz] = grid.n;
    const out = new Float32Array(nx * ny * nz);
    let at = 0;
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        out[at++] = fn(grid.origin[0] + i * grid.cell, grid.origin[1] + j * grid.cell, grid.origin[2] + k * grid.cell);
    }
    return out;
}

/** Which way up a field is over a grid: 1 when it is positive lower down, -1 when positive higher up */
function senseOnGrid(grid: CutGrid, f: ArrayLike<number>): 1 | -1 {
    const [nx, ny, nz] = grid.n;
    let zPos = 0, nPos = 0, zNeg = 0, nNeg = 0;
    for (let k = 0, at = 0; k < nz; k++) for (let q = 0; q < nx * ny; q++, at++) {
        if (f[at] > 0) { zPos += k; nPos++; } else { zNeg += k; nNeg++; }
    }
    return nPos === 0 || nNeg === 0 || zPos / nPos < zNeg / nNeg ? 1 : -1;
}

/**
 * The model's rule with its boundary, for places given by the values of all
 * its surfaces there (in the order of the job's surfaces): the unit's
 * number, or OUTSIDE.
 */
export function labelRule(steps: readonly RuleStep[], unitOf: readonly number[], surfaces: number): (values: ArrayLike<number>) => number {
    const n = steps.length;
    return values => {
        for (let b = n; b < surfaces; b++) if (!(values[b] > 0)) return OUTSIDE;
        const k = unitAt(steps, values);
        return k < 0 ? 0 : unitOf[k];
    };
}

/** The rule over some of the contacts only (their numbers, oldest first): the number of the contact whose unit is there, or -1 */
function unitIn(steps: readonly RuleStep[], which: readonly number[], values: ArrayLike<number>): number {
    let u = -1, top = true;
    for (const k of which) {
        const on = steps[k].young * values[k] > 0;
        if (steps[k].kind === 'deposit') { if (on) { if (top) u = k; } else top = false; }
        else if (steps[k].kind === 'erosion') { if (on) u = k; top = on; }
        else if (on) { u = k; top = false; }
    }
    return u;
}

/** A job's faults as a network, and the contacts of each of its blocks (null: it has no faults) */
function faultRule(job: Pick<ModelJob, 'steps' | 'faults' | 'within'>): { net: FaultNet; per: number[][] } | null {
    if (!job.faults || job.faults.fields.length === 0) return null;
    const net = faultNet(job.faults.ends, (job.faults.there ?? []).map(t => !!t));
    return { net, per: blockContacts(net, job.within ?? [], job.steps.length) };
}

/**
 * How many of a job's surfaces say where its faults are there: one a fault,
 * after the faults themselves, when any of them stops (one that runs through
 * is there everywhere), and none when none does.
 */
const thereCount = (job: Pick<ModelJob, 'faults'>): number => (job.faults?.there?.some(t => !!t) ? job.faults.fields.length : 0);

/**
 * A job's rule with its faults and its boundary, for places given by the
 * values of all its surfaces there: block * units + unit, or OUTSIDE.
 */
export function jobLabelRule(job: Pick<ModelJob, 'steps' | 'unitOf' | 'units' | 'faults' | 'within'>, surfaces: number): (values: ArrayLike<number>) => number {
    const rule = faultRule(job);
    if (!rule) return labelRule(job.steps, job.unitOf, surfaces);
    const nc = job.steps.length, nf = rule.net.n, nt = thereCount(job);
    const eff = new Int8Array(nf);
    return values => {
        for (let b = nc + nf + nt; b < surfaces; b++) if (!(values[b] > 0)) return OUTSIDE;
        const slot = rule.net.slotOf[blockCode(rule.net, values, nc, eff, nt ? nc + nf : -1)];
        const k = unitIn(job.steps, rule.per[slot], values);
        return slot * job.units + (k < 0 ? 0 : job.unitOf[k]);
    };
}

/**
 * As `jobLabelRule`, but which contact has the place rather than which unit:
 * block * (contacts + 1) + contact + 1 (the base unit: nought), or OUTSIDE.
 */
function jobContactRule(job: Pick<ModelJob, 'steps' | 'faults' | 'within'>, surfaces: number): (values: ArrayLike<number>) => number {
    const nc = job.steps.length;
    const rule = faultRule(job);
    if (!rule) {
        return values => {
            for (let b = nc; b < surfaces; b++) if (!(values[b] > 0)) return OUTSIDE;
            return unitAt(job.steps, values) + 1;
        };
    }
    const nf = rule.net.n, nt = thereCount(job);
    const eff = new Int8Array(nf);
    return values => {
        for (let b = nc + nf + nt; b < surfaces; b++) if (!(values[b] > 0)) return OUTSIDE;
        const slot = rule.net.slotOf[blockCode(rule.net, values, nc, eff, nt ? nc + nf : -1)];
        return slot * (nc + 1) + unitIn(job.steps, rule.per[slot], values) + 1;
    };
}

/**
 * The unit and the fault block of a model at places (xyz triples), by the
 * fields and the rule it was built from: the unit's number, or OUTSIDE
 * beyond its boundary (and where a place is not a number); the block's
 * number (0 when the model has no faults). `topSense`: as the build found it.
 */
export function labelsAtPoints(job: ModelJob, topSense: 1 | -1 | 0, xyz: Float64Array): { unit: Int16Array; block: Int16Array } {
    const n = Math.floor(xyz.length / 3);
    const unit = new Int16Array(n), block = new Int16Array(n);
    const frame = outlineFrame(job.outline);
    const nearAt = job.near ? nearReader(job.near) : null;
    const { min, max } = job.box;
    const rule = faultRule(job);
    const nc = job.steps.length, nf = rule?.net.n ?? 0, nt = thereCount(job);
    const values = new Float64Array(nc + nf + nt), eff = new Int8Array(nf);
    // (Inside a unit of another model: only where that model has that unit)
    const outer = job.inside ? labelsAtPoints(job.inside.job, job.inside.topSense, xyz).unit : null;
    for (let from = 0; from < n; from += BATCH) {
        const m = Math.min(BATCH, n - from);
        const part = xyz.subarray(from * 3, (from + m) * 3);
        const read = job.fields.map(f => readModelField(f, part));
        const cut = rule ? job.faults!.fields.map(f => readModelField(f, part)) : [];
        const there = nt ? job.faults!.there!.map(t => (t ? readModelField(t, part) : null)) : [];
        const k = rule ? null : unitsAt(job.steps, read, m);
        const top = job.top && topSense ? readModelField(job.top, part) : null;
        for (let i = 0; i < m; i++) {
            const x = part[i * 3], y = part[i * 3 + 1], z = part[i * 3 + 2];
            const inside = x >= min[0] && x <= max[0] && y >= min[1] && y <= max[1] && z >= min[2] && z <= max[2]
                && (!outer || outer[from + i] === job.inside!.unit)
                && (!top || top[i] * topSense > 0) && (!frame || outlineDistance(frame, x, y, z) < 0)
                && (!nearAt || nearAt(x, y, z) > 0);
            let at = k ? k[i] : -1;
            if (rule) {
                for (let c = 0; c < nc; c++) values[c] = read[c][i];
                for (let c = 0; c < nf; c++) values[nc + c] = cut[c][i];
                for (let c = 0; c < nt; c++) values[nc + nf + c] = there[c]?.[i] ?? 1;
                block[from + i] = rule.net.slotOf[blockCode(rule.net, values, nc, eff, nt ? nc + nf : -1)];
                at = unitIn(job.steps, rule.per[block[from + i]], values);
            }
            unit[from + i] = !inside ? OUTSIDE : at < 0 ? 0 : job.unitOf[at];
        }
    }
    return { unit, block };
}

/** The unit of a model at places (see `labelsAtPoints`) */
export const unitsAtPoints = (job: ModelJob, topSense: 1 | -1 | 0, xyz: Float64Array): Int16Array => labelsAtPoints(job, topSense, xyz).unit;

/** The volume each label's closed solid holds, m3: every face counted once for the label on each side of it */
function labelVolumes(mesh: CutMesh, labels: number): Float64Array {
    const { vertices: v, triangles: t } = mesh;
    const out = new Float64Array(labels);
    const ox = v[0] ?? 0, oy = v[1] ?? 0, oz = v[2] ?? 0;
    for (let f = 0; f < mesh.a.length; f++) {
        const a = t[f * 3] * 3, b = t[f * 3 + 1] * 3, c = t[f * 3 + 2] * 3;
        const ax = v[a] - ox, ay = v[a + 1] - oy, az = v[a + 2] - oz;
        const bx = v[b] - ox, by = v[b + 1] - oy, bz = v[b + 2] - oz;
        const cx = v[c] - ox, cy = v[c + 1] - oy, cz = v[c + 2] - oz;
        const six = ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
        // (The face looks out of `a` and into `b`)
        if (mesh.a[f] >= 0) out[mesh.a[f]] += six / 6;
        if (mesh.b[f] >= 0) out[mesh.b[f]] -= six / 6;
    }
    return out;
}

/** A cell that units meet in is counted up this many columns each way across it */
export const SUB_CELLS = 4;
/**
 * A model's solids are taken as its volumes unless one of them is out from
 * the count by more than this share of itself, and by more than this many
 * cells: it then has not all of its unit, and the model is counted instead
 */
export const SOLID_TRUE = 0.03;
export const SOLID_CELLS = 50;

/**
 * The volume of each label, m3, counted rather than measured from the
 * solids. A cell whose corners are all of one label is all that label. Any
 * other is counted up `SUB_CELLS` columns each way across it: every
 * surface's field is read up the column from its values at the cell's
 * corners (it is all but straight across one cell), which gives where each
 * surface crosses the column, and the model's rule says what is between one
 * crossing and the next. So two surfaces that pass through the same cell
 * have the ground between them counted, which the solids (one corner to a
 * cell) cannot show; and a flat contact is counted exactly. So are upright
 * faces square to the grid (the model's own box): the columns are set out
 * either side of each.
 */
export function countedVolumes(grid: CutGrid, fields: readonly ArrayLike<number>[], labels: ArrayLike<number>, labelOf: (values: ArrayLike<number>) => number, count: number): Float64Array {
    const [nx, ny, nz] = grid.n, nf = fields.length;
    const out = new Float64Array(count);
    const whole = grid.cell ** 3;
    // (Corner q is further along x when q & 1, along y when q & 2, up when q & 4)
    const corners = [0, 1, nx, nx + 1, nx * ny, nx * ny + 1, nx * ny + nx, nx * ny + nx + 1];
    const values = new Float64Array(nf), at = new Float64Array(nf * 8), foot = new Float64Array(nf), head = new Float64Array(nf);
    const mixed: number[] = [], cuts: number[] = [], us: number[] = [], vs: number[] = [];
    const byNumber = (p: number, q: number) => p - q;
    for (let k = 0; k + 1 < nz; k++) for (let j = 0; j + 1 < ny; j++) for (let i = 0; i + 1 < nx; i++) {
        const base = i + nx * (j + ny * k), l = labels[base];
        let same = true;
        for (let q = 1; q < 8; q++) if (labels[base + corners[q]] !== l) { same = false; break; }
        if (same) { if (l >= 0) out[l] += whole; continue; }
        // Only a field that changes sign in the cell can change what is there: the others are as at a corner
        mixed.length = 0;
        for (let f = 0; f < nf; f++) {
            const F = fields[f], first = F[base] > 0;
            let changes = false;
            for (let q = 0; q < 8; q++) { const x = F[base + corners[q]]; at[f * 8 + q] = x; if ((x > 0) !== first) changes = true; }
            values[f] = at[f * 8];
            if (changes) mixed.push(f);
        }
        // A field that changes along x alone, or along y alone, is an upright face square to the grid: where it crosses
        // the cell, the columns are set out either side of it
        us.length = 0; vs.length = 0;
        us.push(0); vs.push(0);
        for (const f of mixed) {
            const o = f * 8, p = at[o];
            if (p === at[o + 2] && p === at[o + 4] && p === at[o + 6] && at[o + 1] === at[o + 3] && at[o + 1] === at[o + 5] && at[o + 1] === at[o + 7]) us.push(p / (p - at[o + 1]));
            else if (p === at[o + 1] && p === at[o + 4] && p === at[o + 5] && at[o + 2] === at[o + 3] && at[o + 2] === at[o + 6] && at[o + 2] === at[o + 7]) vs.push(p / (p - at[o + 2]));
        }
        us.push(1); vs.push(1);
        if (us.length > 3) us.sort(byNumber);
        if (vs.length > 3) vs.sort(byNumber);
        for (let vi = 0; vi + 1 < vs.length; vi++) for (let ui = 0; ui + 1 < us.length; ui++) {
            const du = (us[ui + 1] - us[ui]) / SUB_CELLS, dv = (vs[vi + 1] - vs[vi]) / SUB_CELLS;
            if (!(du > 0) || !(dv > 0)) continue;
            const column = whole * du * dv;
            for (let b = 0; b < SUB_CELLS; b++) for (let a = 0; a < SUB_CELLS; a++) {
                const u = us[ui] + (a + 0.5) * du, v = vs[vi] + (b + 0.5) * dv;
                // Each such field at the foot and the head of the column, and where it crosses between them
                cuts.length = 0;
                for (const f of mixed) {
                    const o = f * 8;
                    const g0 = (at[o] * (1 - u) + at[o + 1] * u) * (1 - v) + (at[o + 2] * (1 - u) + at[o + 3] * u) * v;
                    const g1 = (at[o + 4] * (1 - u) + at[o + 5] * u) * (1 - v) + (at[o + 6] * (1 - u) + at[o + 7] * u) * v;
                    foot[f] = g0; head[f] = g1;
                    if ((g0 > 0) !== (g1 > 0)) cuts.push(g0 / (g0 - g1));
                }
                if (cuts.length > 1) cuts.sort(byNumber);
                let from = 0;
                for (let c = 0; c <= cuts.length; c++) {
                    const to = c < cuts.length ? Math.min(1, Math.max(0, cuts[c])) : 1;
                    if (to > from) {
                        const w = (from + to) / 2;
                        for (const f of mixed) values[f] = foot[f] + (head[f] - foot[f]) * w;
                        const here = labelOf(values);
                        if (here >= 0) out[here] += column * (to - from);
                        from = to;
                    }
                }
            }
        }
    }
    return out;
}

/** A contact too thin for the cells is nowhere on them: an intrusion that is not there changes nothing */
const isThin = (job: ModelJob, k: number) => !!job.thin?.[k] && job.steps[k].kind === 'intrusion';

/**
 * Every surface of a job at every node of a grid, in the order of the job's
 * surfaces. `sense`: which way up its top is, when that is known already
 * (the grid is not the one it was built on).
 */
function gridFields(job: ModelJob, grid: CutGrid, sense?: 1 | -1 | 0, tell?: ModelTell): { fields: Float32Array[]; faultFrom: number; boundaryFrom: number; topSense: 1 | -1 | 0 } {
    // (How far it has got: the surfaces read over the grid, of those there are to read)
    const toRead = job.fields.filter((_, k) => !isThin(job, k)).length + (job.faults?.fields.length ?? 0) + (job.faults?.there?.filter(t => !!t).length ?? 0) + (job.top ? 1 : 0);
    let read = 0;
    const one = (f: ModelField): Float32Array => {
        const on = fieldOnGrid(p => readModelField(f, p), grid);
        tell?.(++read, toRead, 'surfaces read');
        return on;
    };
    const fields: Float32Array[] = job.fields.map((f, k) => (isThin(job, k) ? onGrid(grid, () => -job.steps[k].young) : one(f)));
    const faultFrom = fields.length;
    for (const f of job.faults?.fields ?? []) fields.push(one(f));
    // (Where each fault is there, when any stops)
    if (thereCount(job)) for (const t of job.faults!.there!) fields.push(t ? one(t) : onGrid(grid, () => 1));
    const boundaryFrom = fields.length;
    const { min, max } = job.box;
    fields.push(
        onGrid(grid, x => x - min[0]), onGrid(grid, x => max[0] - x),
        onGrid(grid, (_x, y) => y - min[1]), onGrid(grid, (_x, y) => max[1] - y),
        onGrid(grid, (_x, _y, z) => z - min[2]), onGrid(grid, (_x, _y, z) => max[2] - z),
    );
    const frame = outlineFrame(job.outline);
    if (frame) fields.push(onGrid(grid, (x, y, z) => -outlineDistance(frame, x, y, z)));
    // (Near its drilling: one more face of its boundary, the reach from the nearest hole)
    const near = job.near ? nearReader(job.near) : null;
    if (near) fields.push(onGrid(grid, near));
    let topSense: 1 | -1 | 0 = 0;
    if (job.top) {
        const top = job.top;
        const f = one(top);
        topSense = sense || senseOnGrid(grid, f);
        if (topSense < 0) for (let i = 0; i < f.length; i++) f[i] = -f[i];
        fields.push(f);
    }
    // Inside a unit of another model: that model's surfaces too, after its own
    if (job.inside) fields.push(...gridFields(job.inside.job, grid, job.inside.topSense).fields);
    return { fields, faultFrom, boundaryFrom, topSense };
}

/** How many surfaces a job has in all: its own, and those of the model it is inside */
function surfaceCount(job: ModelJob): number {
    return job.steps.length + (job.faults?.fields.length ?? 0) + thereCount(job) + 6 + (job.outline ? 1 : 0) + (job.near ? 1 : 0) + (job.top ? 1 : 0) + (job.inside ? surfaceCount(job.inside.job) : 0);
}

/**
 * A job's whole rule, for places given by the values of all its surfaces
 * there: its own rule (`jobLabelRule`) where the model it is inside has the
 * unit it is inside, and OUTSIDE everywhere else.
 */
export function modelLabelRule(job: ModelJob): (values: ArrayLike<number>) => number {
    const all = surfaceCount(job);
    if (!job.inside) return jobLabelRule(job, all);
    const { unit } = job.inside, units = job.inside.job.units;
    const beyond = surfaceCount(job.inside.job), own = all - beyond;
    const mine = jobLabelRule(job, own), outer = modelLabelRule(job.inside.job);
    const theirs = new Float64Array(beyond);
    return values => {
        for (let k = 0; k < beyond; k++) theirs[k] = values[own + k];
        const l = outer(theirs);
        return l !== OUTSIDE && l % units === unit ? mine(values) : OUTSIDE;
    };
}

/**
 * As `modelLabelRule`, but which of the job's own contacts has the place:
 * block * (contacts + 1) + contact + 1, or OUTSIDE.
 */
function modelContactRule(job: ModelJob): (values: ArrayLike<number>) => number {
    const all = surfaceCount(job);
    if (!job.inside) return jobContactRule(job, all);
    const { unit } = job.inside, units = job.inside.job.units;
    const beyond = surfaceCount(job.inside.job), own = all - beyond;
    const mine = jobContactRule(job, own), outer = modelLabelRule(job.inside.job);
    const theirs = new Float64Array(beyond);
    return values => {
        for (let k = 0; k < beyond; k++) theirs[k] = values[own + k];
        const l = outer(theirs);
        return l !== OUTSIDE && l % units === unit ? mine(values) : OUTSIDE;
    };
}

const thinBoxes = new WeakMap<TriMesh, Box3>();

/**
 * A contact too thin for the cells, at places: its own field near its mesh.
 * Further off than two cells from all of the mesh it is not there, and its
 * value is how far off that is, on its old side (its field is not read
 * where there is none of it: a model can hold many such veins, each in a
 * small part of it).
 */
function readThin(job: ModelJob, k: number, xyz: Float64Array): Float64Array {
    const mesh = job.thin![k]!;
    let box = thinBoxes.get(mesh);
    if (!box) {
        box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
        const v = mesh.vertices;
        for (let i = 0; i < v.length; i += 3) for (let c = 0; c < 3; c++) {
            if (v[i + c] < box.min[c]) box.min[c] = v[i + c];
            if (v[i + c] > box.max[c]) box.max[c] = v[i + c];
        }
        thinBoxes.set(mesh, box);
    }
    const n = Math.floor(xyz.length / 3), out = new Float64Array(n);
    const away = -job.steps[k].young, margin = 2 * job.cell;
    const near: number[] = [];
    for (let i = 0; i < n; i++) {
        let d2 = 0;
        for (let c = 0; c < 3; c++) {
            const p = xyz[i * 3 + c];
            const d = p < box.min[c] ? box.min[c] - p : p > box.max[c] ? p - box.max[c] : 0;
            d2 += d * d;
        }
        if (d2 <= margin * margin) near.push(i);
        else out[i] = away * Math.sqrt(d2);
    }
    if (near.length === n) return readModelField(job.fields[k], xyz);
    if (near.length > 0) {
        const part = new Float64Array(near.length * 3);
        near.forEach((i, q) => { part[q * 3] = xyz[i * 3]; part[q * 3 + 1] = xyz[i * 3 + 1]; part[q * 3 + 2] = xyz[i * 3 + 2]; });
        const f = readModelField(job.fields[k], part);
        near.forEach((i, q) => { out[i] = f[q]; });
    }
    return out;
}

/**
 * Every surface of a job at places (xyz triples), in the order of the job's
 * surfaces (as `gridFields` has them on a grid, but for the contacts too
 * thin for the cells: on the grid they are not there, and here they are read
 * as they are, so that a place inside a vein is in the vein's unit).
 */
function pointFields(job: ModelJob, xyz: Float64Array, sense: 1 | -1 | 0, but = -1): Float64Array[] {
    const n = Math.floor(xyz.length / 3);
    const at = (fn: (x: number, y: number, z: number) => number) => Float64Array.from({ length: n }, (_, i) => fn(xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2]));
    // (`but`: a contact whose values are not wanted, and so not read)
    const fields: Float64Array[] = job.fields.map((f, k) => (k === but ? new Float64Array(n) : isThin(job, k) ? readThin(job, k, xyz) : readModelField(f, xyz)));
    for (const f of job.faults?.fields ?? []) fields.push(readModelField(f, xyz));
    if (thereCount(job)) for (const t of job.faults!.there!) fields.push(t ? readModelField(t, xyz) : new Float64Array(n).fill(1));
    const { min, max } = job.box;
    fields.push(at(x => x - min[0]), at(x => max[0] - x), at((_x, y) => y - min[1]), at((_x, y) => max[1] - y), at((_x, _y, z) => z - min[2]), at((_x, _y, z) => max[2] - z));
    const frame = outlineFrame(job.outline);
    if (frame) fields.push(at((x, y, z) => -outlineDistance(frame, x, y, z)));
    const near = job.near ? nearReader(job.near) : null;
    if (near) fields.push(at(near));
    if (job.top) {
        const f = readModelField(job.top, xyz);
        if (sense < 0) for (let i = 0; i < n; i++) f[i] = -f[i];
        fields.push(f);
    }
    if (job.inside) fields.push(...pointFields(job.inside.job, xyz, job.inside.topSense));
    return fields;
}

/** Among all of a job's surfaces, the contacts too thin for the cells (its own, and those of the model it is inside), and what each is on the cells: not there */
function thinPlaces(job: ModelJob, from = 0): { at: number; value: number }[] {
    const own = job.steps.flatMap((s, k) => (isThin(job, k) ? [{ at: from + k, value: -s.young }] : []));
    return job.inside ? [...own, ...thinPlaces(job.inside.job, from + surfaceCount(job) - surfaceCount(job.inside.job))] : own;
}

/**
 * How far inside some ground of a model a place is, by the values of the
 * model's surfaces there (`inside`: whether a place with such values is in
 * that ground; `order`: the surfaces that can be crossed, which is put in
 * order of nearness here). Above nothing inside, below it outside: how near
 * the nearest surface is whose side decides it (the one that, were the place
 * on its other side, would put it out, or in); where it takes two together
 * (beyond an edge of the ground), the further of the nearest such two.
 */
function nearnessOf(inside: (values: ArrayLike<number>) => boolean, values: Float64Array, order: number[]): number {
    const here = inside(values);
    // The nearest first: the first whose other side changes it is the one
    order.sort((a, b) => Math.abs(values[a]) - Math.abs(values[b]));
    let near = Infinity;
    for (const k of order) {
        const was = values[k];
        values[k] = was > 0 ? -1 : 1;
        const changed = inside(values) !== here;
        values[k] = was;
        if (changed) { near = Math.abs(was); break; }
    }
    // No one surface decides it: the nearest two that do so together (the further of them is how far)
    for (let b = 1; near === Infinity && b < order.length; b++) {
        const kb = order[b], wb = values[kb];
        values[kb] = wb > 0 ? -1 : 1;
        for (let a = 0; a < b; a++) {
            const ka = order[a], wa = values[ka];
            values[ka] = wa > 0 ? -1 : 1;
            const changed = inside(values) !== here;
            values[ka] = wa;
            if (changed) { near = Math.abs(wb); break; }
        }
        values[kb] = wb;
    }
    if (near === Infinity) near = order.length ? Math.max(1, Math.abs(values[order[order.length - 1]])) : 1;
    return here ? near : -near;
}

/**
 * Ground of a built model: the build, which way up its top is, and the
 * unit's number. `units`: several units together (their numbers, `unit`
 * among them). `blocks`: only in these fault blocks (their numbers; absent:
 * in every block).
 */
export interface UnitOf { job: ModelJob; topSense: 1 | -1 | 0; unit: number; units?: number[]; blocks?: number[] }

/** Whether a place with this label (block * units + unit, or OUTSIDE) is in that ground */
export function inDomain(of: Pick<UnitOf, 'job' | 'unit' | 'units' | 'blocks'>): (label: number) => boolean {
    const n = of.job.units;
    const unit = new Uint8Array(Math.max(1, n));
    for (const u of of.units ?? [of.unit]) if (u >= 0 && u < n) unit[u] = 1;
    const blocks = of.blocks ? new Set(of.blocks) : null;
    return l => l !== OUTSIDE && unit[l % n] === 1 && (!blocks || blocks.has(Math.floor(l / n)));
}

/**
 * How far inside one unit of a model each place is (xyz triples): above
 * nothing in the unit, below it outside, nothing on the unit's faces. A
 * place is in or out by the model's own rule. Its value is how near the
 * nearest of the model's surfaces is whose side decides that (the one that,
 * were the place on its other side, would put it out, or in); where it
 * takes two together (beyond an edge of the unit), the further of the
 * nearest such two. So a surface drawn where this is nothing lies on the
 * unit's faces.
 */
export function unitNearness(of: UnitOf, xyz: Float64Array): Float64Array {
    const { job } = of;
    const n = Math.floor(xyz.length / 3), out = new Float64Array(n);
    const rule = modelLabelRule(job);
    const inside = inDomain(of);
    const inUnit = (values: ArrayLike<number>) => inside(rule(values));
    const count = surfaceCount(job);
    const values = new Float64Array(count), order = Array.from({ length: count }, (_, k) => k);
    for (let from = 0; from < n; from += BATCH) {
        const m = Math.min(BATCH, n - from);
        const fields = pointFields(job, xyz.subarray(from * 3, (from + m) * 3), of.topSense);
        for (let i = 0; i < m; i++) {
            for (let k = 0; k < count; k++) values[k] = fields[k][i];
            out[from + i] = nearnessOf(inUnit, values, order);
        }
    }
    return out;
}

/** At most this many places on the faces of a domain of thin veins are handed to what is meshed inside it */
const THIN_SEEDS = 3000;

/**
 * Ground that is all veins too thin for the model's cells (every contact
 * that puts one of the domain's units there is one): how thick the thinnest
 * of them usually is (twice what its mesh holds, measured through it, over
 * the area of its faces: a vein fitted in one fault block is open at the fault),
 * and places on their walls (xyz triples). Null: the domain is not such
 * ground. What is meshed inside it needs cells finer than the veins, and
 * places to start from: the faces of such a domain are the veins' walls.
 */
export function thinDomain(of: Pick<UnitOf, 'job' | 'unit' | 'units'>): { thickness: number; seeds: Float64Array } | null {
    const { job } = of;
    const units = new Set(of.units ?? [of.unit]);
    // (The base unit is the ground everything else is in: never a vein)
    if (units.has(0)) return null;
    let least = Infinity, corners = 0;
    const meshes: TriMesh[] = [];
    for (let k = 0; k < job.steps.length; k++) {
        if (!units.has(job.unitOf[k])) continue;
        if (!isThin(job, k)) return null;
        const mesh = job.thin![k]!;
        const { vertices: v, triangles: t } = mesh;
        let area = 0;
        for (let q = 0; q < t.length; q += 3) {
            const a = t[q] * 3, b = t[q + 1] * 3, c = t[q + 2] * 3;
            const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
            const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
            area += Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2;
        }
        const n = v.length / 3;
        const volume = countThin(mesh, new Float64Array(n).fill(1), new Int32Array(n), Infinity).whole;
        if (volume > 0 && area > 0) least = Math.min(least, 2 * volume / area);
        meshes.push(mesh);
        corners += v.length / 3;
    }
    if (meshes.length === 0 || !(least > 0) || least === Infinity) return null;
    const every = Math.max(1, Math.ceil(corners / THIN_SEEDS));
    const seeds: number[] = [];
    for (const m of meshes) for (let i = 0; i < m.vertices.length; i += 3 * every) seeds.push(m.vertices[i], m.vertices[i + 1], m.vertices[i + 2]);
    return { thickness: least, seeds: Float64Array.from(seeds) };
}

/**
 * The contacts too thin for the cells, as the model has them. Each is its
 * own mesh (a vein), and the model has its unit there only where its rule
 * gives that contact the ground: inside the boundary, in the contact's own
 * fault blocks, and not where a younger unit (or a later vein) is. The mesh
 * is cut to that, a part to each fault block it is in. What each part holds
 * is measured through the vein's thickness (`countThin`) and taken out of
 * the ground the cells gave it to, block by block, so that the units of the
 * model still add up to the ground it covers. `volumes`: per label
 * (block * units + unit), changed here.
 */
function thinUnits(job: ModelJob, topSense: 1 | -1 | 0, volumes: Float64Array[], spent?: { read: number; rule: number; count: number; cut: number }): ThinUnit[] {
    const thin: ThinUnit[] = [];
    if (!job.steps.some((_, k) => isThin(job, k))) return thin;
    const count = surfaceCount(job), nc = job.steps.length, units = job.units;
    const boxAt = nc + (job.faults?.fields.length ?? 0) + thereCount(job);
    const contactOf = modelContactRule(job), cells = modelLabelRule(job);
    const absent = thinPlaces(job);
    const values = new Float64Array(count), onCells = new Float64Array(count);
    job.steps.forEach((step, k) => {
        if (!isThin(job, k)) return;
        const mesh = job.thin![k]!;
        const xyz = mesh.vertices instanceof Float64Array ? mesh.vertices : Float64Array.from(mesh.vertices);
        const n = Math.floor(xyz.length / 3);
        const s0 = performance.now();
        // Every surface of the model at the corners of the vein's mesh; the vein itself as it is just inside its walls
        const all = Array.from({ length: count }, () => new Float64Array(n));
        for (let from = 0; from < n; from += BATCH) {
            const m = Math.min(BATCH, n - from);
            pointFields(job, xyz.subarray(from * 3, (from + m) * 3), topSense, k).forEach((f, s) => all[s].set(f, from));
        }
        all[k].fill(step.young);
        const at = (i: number) => { for (let s = 0; s < count; s++) values[s] = all[s][i]; };
        const order = Array.from({ length: count }, (_, s) => s).filter(s => s !== k);
        // (Its mesh is cut at the box's faces as a mesh is, exactly; so the shape it is cut to by the rest is worked out as if well inside the box)
        const free = order.filter(s => s < boxAt || s >= boxAt + 6);
        const unboxed = () => { for (let b = 0; b < 6; b++) values[boxAt + b] = 1; };
        const mine = (v: ArrayLike<number>) => { const c = contactOf(v); return c !== OUTSIDE && c % (nc + 1) === k + 1; };
        const g = new Float64Array(n), shape = new Float64Array(n), host = new Int32Array(n);
        const s1 = performance.now();
        const slots = new Set<number>();
        for (let i = 0; i < n; i++) {
            at(i);
            onCells.set(values);
            for (const a of absent) onCells[a.at] = a.value;
            host[i] = cells(onCells);
            const c = contactOf(values);
            if (c !== OUTSIDE && c % (nc + 1) === k + 1) slots.add(Math.floor(c / (nc + 1)));
            g[i] = nearnessOf(mine, values, order);
            unboxed();
            shape[i] = nearnessOf(mine, values, free);
        }
        const s2 = performance.now();
        // What it holds, by the ground it is in: given to its unit there, and taken from the unit the cells have there
        const counted = countThin({ vertices: xyz, triangles: mesh.triangles }, g, host, job.cell / 4);
        const closed = closedVolume(mesh);
        const scale = closed !== null && counted.whole > 0 ? Math.min(1.25, Math.max(0.8, closed / counted.whole)) : 1;
        const unit = job.unitOf[k];
        const held = new Map<number, number>();
        for (const [l, raw] of counted.kept) {
            const v = raw * scale, slot = Math.floor(l / units), to = slot * units + unit;
            held.set(slot, (held.get(slot) ?? 0) + v);
            if (to === l) continue;
            for (const each of volumes) {
                const take = Math.min(v, Math.max(each[l], 0));
                each[l] -= take;
                each[to] += take;
            }
        }
        const s3 = performance.now();
        // Its mesh in each fault block it is in, cut where the model does not have it
        for (const slot of [...slots].sort((a, b) => a - b)) {
            let own = shape;
            if (slots.size > 1) {
                const code = slot * (nc + 1) + k + 1;
                const here = (v: ArrayLike<number>) => contactOf(v) === code;
                own = new Float64Array(n);
                for (let i = 0; i < n; i++) { at(i); unboxed(); own[i] = nearnessOf(here, values, free); }
            }
            const shaped = own.some(v => !(v > 0)) ? clipMeshByScalar(mesh, own.map(v => -v)) : mesh;
            const part = clipMeshToBox(shaped, job.box);
            if (part.triangles.length === 0) continue;
            thin.push({ contact: k, unit, block: slot, vertices: part.vertices, triangles: part.triangles, volume: held.get(slot) ?? 0, cut: part !== mesh });
        }
        if (spent) { spent.read += s1 - s0; spent.rule += s2 - s1; spent.count += s3 - s2; spent.cut += performance.now() - s3; }
    });
    return thin;
}

/** Told how far a build has got: this many of that many, of what */
export type ModelTell = (done: number, of: number, step: string) => void;

export function runModelJob(job: ModelJob, tell?: ModelTell): ModelOutput {
    const t0 = performance.now();
    const grid = boundaryGrid(job.box, job.cell);
    const { fields, faultFrom, boundaryFrom, topSense } = gridFields(job, grid, undefined, tell);
    const t1 = performance.now();
    const labelOf = modelLabelRule(job);
    tell?.(0, 0, 'cutting the solids');
    const mesh = cutCells({ ...grid, fields, labelOf });
    const t2 = performance.now();
    tell?.(0, 0, 'measuring the volumes');
    const rule = faultRule(job);
    const blocks = rule ? rule.net.signs.map(s => Array.from(s)) : [[]];
    // What each unit's solid holds, and what the unit holds counted from the surfaces. Where the two agree all through
    // the model, the solids are the measure (exact for flat faces, wherever they fall). Where a solid is well out, it
    // has not all of its unit (it is thinner than the cells there) and the units beside it have what it lacks: the
    // whole model is then measured by the count, so that its units still add up to the ground it covers
    const shown = labelVolumes(mesh, blocks.length * job.units);
    const counted = countedVolumes(grid, fields, mesh.labels, labelOf, blocks.length * job.units);
    const out = (l: number) => Math.abs(shown[l] - counted[l]);
    const short = counted.some((c, l) => out(l) > SOLID_TRUE * Math.max(c, shown[l]) && out(l) > SOLID_CELLS * grid.cell ** 3);
    // (With the veins too thin for the cells: what each holds is its unit's, and no longer the ground's it is in)
    const each = Float64Array.from(short ? counted : shown), held = Float64Array.from(shown);
    if (job.steps.some((_, k) => isThin(job, k))) tell?.(0, 0, 'cutting the veins');
    const t3 = performance.now();
    const spent = { read: 0, rule: 0, count: 0, cut: 0 };
    const thin = thinUnits(job, topSense, [each, held], spent);
    const t4 = performance.now();
    const blockVolumes = blocks.map((_, slot) => Array.from(each.subarray(slot * job.units, (slot + 1) * job.units)));
    const volumes = Array.from({ length: job.units }, (_, u) => blockVolumes.reduce((sum, b) => sum + b[u], 0));
    const solids = Array.from({ length: job.units }, (_, u) => blocks.reduce((sum, _b, slot) => sum + held[slot * job.units + u], 0));
    return {
        ...(thin.length > 0 ? { thin } : {}),
        vertices: mesh.vertices, triangles: mesh.triangles, a: mesh.a, b: mesh.b, on: mesh.on,
        grid, faultFrom, boundaryFrom, unitCount: job.units, blocks, blockVolumes, looped: rule?.net.looped ?? [],
        topSense, volumes, solids, ms: performance.now() - t0, parts: { fields: t1 - t0, cut: t2 - t1, volumes: t3 - t2, thin: t4 - t3, thinRead: spent.read, thinRule: spent.rule, thinCount: spent.count, thinCut: spent.cut },
    };
}
