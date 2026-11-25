/**
 * Ground that is the inside of closed solids (Phase 271): a vein, the veins
 * of a vein system, an intrusion, another shell, a closed wireframe from a
 * file. What a grade shell kept inside it needs: which samples are inside,
 * how far inside any place is (so that the shell is cut at the solids'
 * faces), and, when the solids are thin, how thin and where their walls are
 * (so that it is meshed fine enough to be there at all).
 *
 * The solids are read as meshes (meshField.ts: the distance to a mesh,
 * signed by which side of it a place is on). A mesh with an open edge has no
 * inside, and is refused by name.
 */
import { meshReader, type MeshField } from './meshField';

/** Solids as ground: their meshes (each closed), and a mark that tells this ground from another */
export interface SolidGround {
    meshes: MeshField[];
    mark: string;
}

/** Which of some meshes cannot be ground: those with no triangles, or with an open edge (their places in the list) */
export function notClosed(meshes: readonly MeshField[]): number[] {
    return meshes.flatMap((m, i) => (m.triangles.length === 0 || !meshReader(m).closed ? [i] : []));
}

/** Per mesh, the box it lies in */
const boxes = new WeakMap<MeshField, Float64Array>();
function boxOf(mesh: MeshField): Float64Array {
    let b = boxes.get(mesh);
    if (!b) {
        b = Float64Array.of(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity);
        const v = mesh.vertices;
        for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) {
            if (v[i + k] < b[k]) b[k] = v[i + k];
            if (v[i + k] > b[3 + k]) b[3 + k] = v[i + k];
        }
        boxes.set(mesh, b);
    }
    return b;
}

/**
 * How far inside the solids each place is (xyz triples): above nothing
 * inside one of them (the distance to its nearest face), below it outside
 * them all (the distance to the nearest solid, as a negative), nothing on a
 * face. Solids that overlap are one ground. `within`: distances beyond it are
 * not needed (what is drawn inside solids needs them only as far as its cells
 * reach): further than that from every face a place reads -within or +within,
 * and is found without looking through the whole of every solid.
 */
export function solidNearness(ground: Pick<SolidGround, 'meshes'>, xyz: ArrayLike<number>, within?: number): Float64Array {
    const n = Math.floor(xyz.length / 3), out = new Float64Array(n).fill(-Infinity);
    for (const mesh of ground.meshes) {
        const d = meshReader(mesh).read(xyz, undefined, within);
        for (let i = 0; i < n; i++) if (d[i] > out[i]) out[i] = d[i];
    }
    return out;
}

/**
 * Which places (xyz triples) are inside the solids: 1 or 0. A place outside
 * a solid's box is not looked at against it, so many samples against many
 * small solids is quick.
 */
export function insideSolids(ground: Pick<SolidGround, 'meshes'>, xyz: ArrayLike<number>): Uint8Array {
    // (Only the side is wanted: a place further than this from a solid's faces is not looked for among all its triangles)
    const NEAR = 1;
    const n = Math.floor(xyz.length / 3), out = new Uint8Array(n);
    for (const mesh of ground.meshes) {
        const b = boxOf(mesh), rows: number[] = [], pts: number[] = [];
        for (let i = 0; i < n; i++) {
            if (out[i]) continue;
            const x = xyz[i * 3], y = xyz[i * 3 + 1], z = xyz[i * 3 + 2];
            if (x < b[0] || x > b[3] || y < b[1] || y > b[4] || z < b[2] || z > b[5]) continue;
            rows.push(i); pts.push(x, y, z);
        }
        if (rows.length === 0) continue;
        const d = meshReader(mesh).read(pts, undefined, NEAR);
        for (let q = 0; q < rows.length; q++) if (d[q] > 0) out[rows[q]] = 1;
    }
    return out;
}

/**
 * What a closed mesh holds, m3, and the area of its faces, m2. What it holds
 * is read with its triangles turned to agree with one another (meshField.ts):
 * a file may write them either way round, and summed as written such a mesh
 * holds less than it does.
 */
export function solidSize(mesh: MeshField): { volume: number; area: number } {
    const { vertices: v, triangles: t } = mesh;
    let area = 0;
    // (About its first corner, so that coordinates in the millions cost no digits)
    const ox = v[0] ?? 0, oy = v[1] ?? 0, oz = v[2] ?? 0;
    for (let q = 0; q < t.length; q += 3) {
        const a = t[q] * 3, b = t[q + 1] * 3, c = t[q + 2] * 3;
        const ax = v[a] - ox, ay = v[a + 1] - oy, az = v[a + 2] - oz;
        const bx = v[b] - ox, by = v[b + 1] - oy, bz = v[b + 2] - oz;
        const cx = v[c] - ox, cy = v[c + 1] - oy, cz = v[c + 2] - oz;
        area += Math.hypot((by - ay) * (cz - az) - (bz - az) * (cy - ay), (bz - az) * (cx - ax) - (bx - ax) * (cz - az), (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
    }
    return { volume: meshReader(mesh).volume, area };
}

/** At most this many places on the walls of thin solids are handed to what is meshed inside them */
export const SOLID_SEEDS = 3000;

/**
 * How thick the thinnest of the solids usually is (twice what it holds over
 * the area of its faces: a sheet has two), and places on their walls (xyz
 * triples, corners of the meshes, evenly thinned). What is meshed inside
 * solids thinner than its cells needs finer cells and places to start from.
 * Null: there is no solid with a size.
 */
export function solidWalls(ground: Pick<SolidGround, 'meshes'>): { thickness: number; seeds: Float64Array } | null {
    let least = Infinity, corners = 0;
    for (const mesh of ground.meshes) {
        const { volume, area } = solidSize(mesh);
        if (volume > 0 && area > 0) least = Math.min(least, 2 * volume / area);
        corners += mesh.vertices.length / 3;
    }
    if (!(least > 0) || least === Infinity) return null;
    const every = Math.max(1, Math.ceil(corners / SOLID_SEEDS));
    const seeds: number[] = [];
    for (const mesh of ground.meshes) for (let i = 0; i < mesh.vertices.length; i += 3 * every) seeds.push(mesh.vertices[i], mesh.vertices[i + 1], mesh.vertices[i + 2]);
    return { thickness: least, seeds: Float64Array.from(seeds) };
}
