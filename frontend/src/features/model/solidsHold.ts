/**
 * A built geological model's solids against its own rule (Phase 275, pure).
 *
 * What unit is at a place is said by the model's fitted surfaces and its
 * rule (`labelsAtPoints`). What is drawn, exported and measured as a solid
 * is cut on the model's cells, with veins too thin for the cells taken from
 * their own meshes. The two are not the same thing, and where a unit is thin
 * against the cells they can differ a good deal. This says by how much: of
 * the places the rule gives a unit, the share inside its drawn solid; and of
 * the places inside its drawn solid, the share the rule gives another unit.
 */
import { facesOf, OUTSIDE } from './cutCells';
import { labelsAtPoints, type ModelJob, type ModelOutput } from './geoModelJobs';
import { meshReader, type MeshField } from './meshField';
import type { TriMesh } from './types';

export interface UnitHold {
    /** The unit, by its number in the build */
    unit: number;
    /** The places the rule gives it, and those of them inside its drawn solid */
    ruled: number;
    held: number;
    /** The places inside its drawn solid, and those of them the rule gives another unit (or none) */
    drawn: number;
    over: number;
    /** As `ruled` and `held`, of the places clear of every drawn face (a place on a face is either's) */
    clearRuled: number;
    clearHeld: number;
    /**
     * Parts of it too thin for the cells that are open where the model cuts them (at a fault, its boundary, a younger
     * unit), so have no inside of their own. Each is read from the vein's whole mesh, at the places the rule gives
     * the unit: so they count in `held`, and add nothing to `over`.
     */
    cut: number;
    /** ... and those of them that could not be read that way either */
    open: number;
}

/** A place nearer a drawn face than this share of a cell is not clear of it */
export const CLEAR_SHARE = 1 / 20;

/** A unit's solid as cut on the cells, without what is too thin for them, joined across the faults */
function cutSolid(out: ModelOutput, u: number): TriMesh {
    const n = out.unitCount;
    const unit = (label: number) => (label < 0 ? -1 : label % n);
    return facesOf({ ...out, labels: new Int16Array(0) }, (a, b) => { const ua = unit(a), ub = unit(b); return ua === ub ? 0 : ua === u ? 1 : ub === u ? -1 : 0; });
}

/** How far inside a mesh each place is, as far as `within`, looked for only at places in or beside its box (elsewhere -within) */
function nearness(mesh: MeshField, xyz: Float64Array, within: number, out: Float64Array): void {
    const v = mesh.vertices;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) { if (v[i + k] < lo[k]) lo[k] = v[i + k]; if (v[i + k] > hi[k]) hi[k] = v[i + k]; }
    const rows: number[] = [], pts: number[] = [];
    for (let i = 0; i < out.length; i++) {
        const x = xyz[i * 3], y = xyz[i * 3 + 1], z = xyz[i * 3 + 2];
        if (x < lo[0] - within || x > hi[0] + within || y < lo[1] - within || y > hi[1] + within || z < lo[2] - within || z > hi[2] + within) continue;
        rows.push(i); pts.push(x, y, z);
    }
    if (rows.length === 0) return;
    const d = meshReader(mesh).read(pts, undefined, within);
    for (let q = 0; q < rows.length; q++) if (d[q] > out[rows[q]]) out[rows[q]] = d[q];
}

/**
 * Each unit of a built model at places (xyz triples): what its rule gives
 * it against what its drawn solid holds. Places outside the model are not
 * counted for any unit.
 */
export function solidsHold(job: ModelJob, out: ModelOutput, xyz: Float64Array): UnitHold[] {
    const n = Math.floor(xyz.length / 3), units = out.unitCount;
    const said = labelsAtPoints(job, out.topSense, xyz).unit;
    const within = out.grid.cell / 2, clear = out.grid.cell * CLEAR_SHARE;
    // How far inside each unit's drawn solid every place is, and how near any drawn face
    const inside: Float64Array[] = [], open: number[] = [], cut: number[] = [];
    const mesh = (m: TriMesh): MeshField => ({ vertices: Float64Array.from(m.vertices), triangles: Uint32Array.from(m.triangles) });
    const face = new Float64Array(n).fill(within);
    for (let u = 0; u < units; u++) {
        const d = new Float64Array(n).fill(-within);
        const whole = cutSolid(out, u);
        if (whole.triangles.length > 0) nearness(mesh(whole), xyz, within, d);
        let unread = 0, asCut = 0;
        const uncut = new Set<number>();
        for (const part of out.thin?.filter(t => t.unit === u && t.triangles.length > 0) ?? []) {
            const own = mesh(part);
            if (meshReader(own).closed) { nearness(own, xyz, within, d); continue; }
            asCut++;
            const from = job.thin?.[part.contact];
            if (!from || from.triangles.length === 0) unread++;
            else uncut.add(part.contact);
        }
        // (A vein's whole mesh, for its parts that the model cut open: only where the rule gives the unit the ground)
        for (const k of uncut) {
            const from = mesh(job.thin![k]!);
            if (!meshReader(from).closed) { unread++; continue; }
            const at = new Float64Array(n).fill(-within);
            nearness(from, xyz, within, at);
            for (let i = 0; i < n; i++) if (said[i] === u && at[i] > d[i]) d[i] = at[i];
        }
        for (let i = 0; i < n; i++) if (Math.abs(d[i]) < face[i]) face[i] = Math.abs(d[i]);
        inside.push(d); open.push(unread); cut.push(asCut);
    }
    const result: UnitHold[] = Array.from({ length: units }, (_, unit) => ({ unit, ruled: 0, held: 0, drawn: 0, over: 0, clearRuled: 0, clearHeld: 0, cut: cut[unit], open: open[unit] }));
    for (let i = 0; i < n; i++) {
        const u = said[i];
        if (u === OUTSIDE) continue;
        const r = result[u];
        r.ruled++;
        if (inside[u][i] > 0) r.held++;
        if (face[i] >= clear) { r.clearRuled++; if (inside[u][i] > 0) r.clearHeld++; }
        for (let w = 0; w < units; w++) if (inside[w][i] > 0) { result[w].drawn++; if (w !== u) result[w].over++; }
    }
    return result;
}

/** Places through a box `step` apart, off the planes a grid from its corner is on (xyz triples); fewer, evenly, past `most` */
export function placesThrough(box: { min: readonly number[]; max: readonly number[] }, step: number, most = 2_000_000): Float64Array {
    let s = step;
    const count = (w: number) => [0, 1, 2].reduce((c, k) => c * Math.max(1, Math.floor((box.max[k] - box.min[k]) / w)), 1);
    while (count(s) > most) s *= 1.1;
    const at: number[] = [];
    // (Not at a half or a quarter of a step: the cells' own planes and their middles are where a cut solid is least like the rule)
    const off = 0.37 * s;
    for (let x = box.min[0] + off; x < box.max[0]; x += s) for (let y = box.min[1] + off; y < box.max[1]; y += s) for (let z = box.min[2] + off; z < box.max[2]; z += s) at.push(x, y, z);
    return Float64Array.from(at);
}
