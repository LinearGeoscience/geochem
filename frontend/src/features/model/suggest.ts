/**
 * Readings suggested from what is already in the model (pure, unit-tested).
 *
 * Two sources:
 *   - the faces of a mesh (a fitted surface, a wireframe from other
 *     software): the plane its faces lie in, at places spread over it;
 *   - the places a column is high: where the highs of several holes round
 *     about lie close to one plane, that plane; and where they are strung
 *     out along one direction within it while the drilling is not, that
 *     direction.
 *
 * These are measurements of shape only. Nothing here says what a plane or
 * a direction is, and nothing is added to the model: the caller offers them
 * to be kept or thrown away.
 */
import { jacobiEigendecomposition } from '../../utils/calculations/eigen';
import { cross, dipFromNormal, dot, unit } from './plane';
import { pickSpread } from './readings';
import { lineFromStroke, type NewReadingSet } from './structureReadings';
import type { Vec3 } from './types';

export interface SuggestedReading {
    p: Vec3;
    dip: number;
    direction: number;
    /** A plane from high places: how many times as wide as they are thick the highs are there (a thin sheet: many times) */
    flat?: number;
}

/**
 * Readings on offer: worked out from something in the model, drawn as
 * ghosts, and no part of the model until they are kept (this session only).
 */
export interface Suggestion {
    /** What they were worked out from, by its name */
    from: string;
    sets: NewReadingSet[];
    /** Something to weigh them by, in a sentence (how flat the highs they came from are) */
    note?: string | null;
}

/**
 * How flat the highs are where planes were found among them, in a
 * sentence: a thin sheet is many times as wide as it is thick, a thick
 * zone only a little. Null when it is not known.
 */
export function flatnessText(planes: readonly SuggestedReading[]): string | null {
    const flats = planes.map(p => p.flat ?? 0).filter(f => f > 0).sort((a, b) => a - b);
    if (flats.length === 0) return null;
    const usual = flats[flats.length >> 1];
    const times = usual >= 20 ? 'more than 20' : usual >= 10 ? `about ${Math.round(usual)}` : `about ${(Math.round(usual * 10) / 10).toFixed(usual < 3 ? 1 : 0)}`;
    return `Where these planes were found the highs are ${times} times as wide as they are thick${usual < 3 ? ': thick zones that are flattened that way, not thin sheets' : ''}.`;
}

/** No more readings than this from one source */
export const MAX_SUGGESTED = 150;
/** A patch of mesh whose faces agree less than this lies in no one plane (a hinge, an edge, the end of a body) */
const FLAT_PATCH = 0.8;
/** ... and one with less than this share of a full patch of faces is a sliver */
const LEAST_PATCH = 0.2;

/**
 * Planes off the faces of a mesh (world xyz triples; vertex indices, three
 * to a face): the mesh is cut into patches of about equal size, and each
 * patch whose faces lie close to one plane gives that plane, at the middle
 * of the patch. A thin closed body gives the plane it is flat in, at its
 * middle; where it turns round at its edges it gives nothing.
 */
export function readingsFromMesh(vertices: ArrayLike<number>, triangles: ArrayLike<number>, most = MAX_SUGGESTED): SuggestedReading[] {
    const faces = Math.floor(triangles.length / 3);
    const centre = new Float64Array(faces * 3), normal = new Float64Array(faces * 3), area = new Float64Array(faces);
    let total = 0;
    for (let f = 0; f < faces; f++) {
        const a = triangles[f * 3] * 3, b = triangles[f * 3 + 1] * 3, c = triangles[f * 3 + 2] * 3;
        const u: Vec3 = [vertices[b] - vertices[a], vertices[b + 1] - vertices[a + 1], vertices[b + 2] - vertices[a + 2]];
        const v: Vec3 = [vertices[c] - vertices[a], vertices[c + 1] - vertices[a + 1], vertices[c + 2] - vertices[a + 2]];
        const n = cross(u, v);
        const twice = Math.hypot(n[0], n[1], n[2]);
        if (!(twice > 0) || !Number.isFinite(twice)) continue;
        area[f] = twice / 2;
        total += area[f];
        for (let k = 0; k < 3; k++) {
            centre[f * 3 + k] = (vertices[a + k] + vertices[b + k] + vertices[c + k]) / 3;
            normal[f * 3 + k] = n[k] / twice;
        }
    }
    if (!(total > 0) || most < 1) return [];
    // Patches: the boxes of a grid, of a size that gives about as many as are wanted (a few are lost as slivers)
    const side = Math.sqrt(total / most) * 1.15;
    const patches = new Map<string, { area: number; sum: Vec3; t: number[] }>();
    for (let f = 0; f < faces; f++) {
        if (!(area[f] > 0)) continue;
        const key = `${Math.floor(centre[f * 3] / side)},${Math.floor(centre[f * 3 + 1] / side)},${Math.floor(centre[f * 3 + 2] / side)}`;
        let p = patches.get(key);
        if (!p) {
            p = { area: 0, sum: [0, 0, 0], t: [0, 0, 0, 0, 0, 0] };
            patches.set(key, p);
        }
        const w = area[f], nx = normal[f * 3], ny = normal[f * 3 + 1], nz = normal[f * 3 + 2];
        p.area += w;
        for (let k = 0; k < 3; k++) p.sum[k] += w * centre[f * 3 + k];
        // (Whichever way each face is wound: the two walls of a thin body say the same plane)
        p.t[0] += w * nx * nx; p.t[1] += w * nx * ny; p.t[2] += w * nx * nz;
        p.t[3] += w * ny * ny; p.t[4] += w * ny * nz; p.t[5] += w * nz * nz;
    }
    const out: SuggestedReading[] = [];
    for (const p of patches.values()) {
        if (p.area < LEAST_PATCH * side * side) continue;
        const { eigenvalues, eigenvectors } = jacobiEigendecomposition([[p.t[0], p.t[1], p.t[2]], [p.t[1], p.t[3], p.t[4]], [p.t[2], p.t[4], p.t[5]]]);
        const axis = unit(eigenvectors[0]);
        if (!axis || !(eigenvalues[0] > 0) || (eigenvalues[0] - Math.max(eigenvalues[1], 0)) / eigenvalues[0] < FLAT_PATCH) continue;
        const { dip, dipDirection } = dipFromNormal(axis);
        out.push({ p: [p.sum[0] / p.area, p.sum[1] / p.area, p.sum[2] / p.area], dip, direction: dipDirection });
    }
    if (out.length <= most) return out;
    return pickSpread(out.flatMap(r => r.p), most).map(i => out[i]);
}

/** A run of high places down one hole, taken as one place */
interface Run { p: Vec3; hole: number }

/** A neighbourhood needs the highs of at least this many holes, and this many runs in all */
const LEAST_HOLES = 4, LEAST_RUNS = 5;
/** Highs are looked for within this many spacings of a place: of the holes, or of the highs themselves where those are further apart */
const NEAR_SPACINGS = 2.2;
/**
 * They are flattened when they are this thin across, at most, against how
 * far they spread the narrower way along; and surely so: the fewer they
 * are, the thinner they must be (a handful of places scattered anyhow lie
 * near one plane often enough by chance). `SURE`: how many times the
 * uncertainty of the ratio, for that many places, it must be clear of 1.
 */
const FLAT = 0.6, SURE = 3;
/** Where the highs round a place are not surely flattened, they are looked at over twice the distance, and twice that */
const WIDER = [1, 2, 4];
/** ... and they are not all in a row: they spread this far the narrower way, against the wider, and this share of a hole spacing */
const NOT_A_ROW = 0.15, LEAST_WIDTH = 0.2;
/** They are strung out when they go this many times further one way in the plane than the other */
const LONG = 1.8;
/** ... looked at over this many times the distance the plane was found over (a longer stretch says the direction better) */
const LINE_REACH = 1.6;
/** ... while the holes round about do not (where they pass through the plane, they go no more than this many times further that way) */
const DRILLING_EVEN = 1.4;

/** The spread of points about their middle: the middle, the three axes (longest first) and how far they spread along each (root mean square) */
function spread(points: readonly Vec3[]): { mid: Vec3; axes: Vec3[]; far: number[]; cov: number[][] } | null {
    const n = points.length;
    if (n < 3) return null;
    const mid: Vec3 = [0, 0, 0];
    for (const p of points) for (let k = 0; k < 3; k++) mid[k] += p[k] / n;
    const c = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const p of points) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) c[a][b] += (p[a] - mid[a]) * (p[b] - mid[b]) / n;
    const { eigenvalues, eigenvectors } = jacobiEigendecomposition(c);
    const axes = eigenvectors.slice(0, 3).map(v => unit(v));
    if (axes.some(a => !a)) return null;
    return { mid, axes: axes as Vec3[], far: eigenvalues.slice(0, 3).map(v => Math.sqrt(Math.max(0, v))), cov: c };
}

/** The drilling round a place can say how the highs lie only when it spreads this far its narrowest way, against its widest */
const DRILLED_ALL_WAYS = 0.15;

/**
 * The shape of the highs against the shape of the sampling round about
 * (both as spreads about their middles): how far the highs spread along
 * their three axes, longest first, each as a share of how far the samples
 * themselves spread that way, and the pole of the plane they are flattened
 * in. At the edge of the drilling, or of a block of close drilling, both
 * are cut off alike and the highs come out no flatter than they are; in
 * the middle of even drilling it is the shape of the highs as it stands.
 * Null where the drilling does not spread every way (holes along one
 * line): it cannot say.
 */
function against(highs: number[][], sampling: number[][]): { far: number[]; pole: Vec3 } | null {
    const all = jacobiEigendecomposition(sampling);
    const sd = all.eigenvalues.slice(0, 3).map(v => Math.sqrt(Math.max(0, v)));
    if (!(sd[2] > DRILLED_ALL_WAYS * sd[0])) return null;
    // W: the sampling made round (its spread 1 every way); the highs as they are then
    const w = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) w[a][b] += all.eigenvectors[k][a] * all.eigenvectors[k][b] / sd[k];
    const times = (m: number[][], q: number[][]) => m.map(row => [0, 1, 2].map(b => row[0] * q[0][b] + row[1] * q[1][b] + row[2] * q[2][b]));
    const seen = jacobiEigendecomposition(times(times(w, highs), w));
    const u = seen.eigenvectors[2];
    const pole = unit([w[0][0] * u[0] + w[0][1] * u[1] + w[0][2] * u[2], w[1][0] * u[0] + w[1][1] * u[1] + w[1][2] * u[2], w[2][0] * u[0] + w[2][1] * u[1] + w[2][2] * u[2]]);
    return pole ? { far: seen.eigenvalues.slice(0, 3).map(v => Math.sqrt(Math.max(0, v))), pole } : null;
}

/** The spacing of the highs is judged from about this many of their runs */
const SPACING_FROM = 400;

/**
 * How far apart the highs are: the usual distance from a run of them to
 * the nearest run in another hole (0: there is no such pair). Where only a
 * few of the samples are high this is much further than from hole to hole.
 */
function runSpacing(runs: readonly Run[]): number {
    const every = Math.max(1, Math.floor(runs.length / SPACING_FROM));
    const nearest: number[] = [];
    for (let i = 0; i < runs.length; i += every) {
        const a = runs[i];
        let best = Infinity;
        for (const b of runs) {
            if (b.hole === a.hole) continue;
            const d = (a.p[0] - b.p[0]) ** 2 + (a.p[1] - b.p[1]) ** 2 + (a.p[2] - b.p[2]) ** 2;
            if (d < best) best = d;
        }
        if (best < Infinity) nearest.push(Math.sqrt(best));
    }
    nearest.sort((x, y) => x - y);
    return nearest.length > 0 ? nearest[nearest.length >> 1] : 0;
}

export interface HighPlaces {
    /** Every place the column has a value at, xyz triples: one hole after another, in order down each */
    positions: ArrayLike<number>;
    /** Which hole each place is in */
    hole: ArrayLike<number>;
    /** Whether each place is high (at or above the cut-off) */
    high: ArrayLike<number | boolean>;
    /** The usual distance between holes, m */
    spacing: number;
}

/**
 * Planes and lines from where a column is high. Each run of high places
 * down a hole counts as one place (so the direction the holes were drilled
 * in is not mistaken for a direction in the ground). Round each of a spread
 * of them, the runs of the holes within a couple of spacings are taken
 * together (hole spacings or, where the highs are few and further apart
 * than the holes, the spacing of the highs): when they are surely
 * flattened, the plane they are flattened in is given, at their middle,
 * with how flat they are (`flat`). When they are not, they are looked at
 * over a longer distance: thick zones show their lie only over a distance
 * several times their thickness. And when, within that plane, they go much
 * further one way than the other, while the places where the holes round
 * about pass through the plane (high or not) do not, that direction is
 * given as a line.
 */
export function readingsFromHighs(places: HighPlaces, most = MAX_SUGGESTED): { planes: SuggestedReading[]; lines: SuggestedReading[] } {
    const { positions, hole, high, spacing } = places;
    const n = Math.min(Math.floor(positions.length / 3), hole.length, high.length);
    const none = { planes: [], lines: [] };
    if (n === 0 || !(spacing > 0)) return none;
    // The holes (each a stretch of the places), and the runs of high places down them
    const holes: { from: number; to: number }[] = [];
    const runs: Run[] = [];
    for (let from = 0; from < n;) {
        let to = from;
        while (to < n && hole[to] === hole[from]) to++;
        for (let i = from; i < to;) {
            if (!high[i]) { i++; continue; }
            let end = i;
            const p: Vec3 = [0, 0, 0];
            while (end < to && high[end]) end++;
            for (let q = i; q < end; q++) for (let k = 0; k < 3; k++) p[k] += positions[q * 3 + k] / (end - i);
            runs.push({ p, hole: holes.length });
            i = end;
        }
        holes.push({ from, to });
        from = to;
    }
    if (runs.length < LEAST_RUNS) return none;

    // The holes may be much closer together than the highs are (close drilling, a cut-off few samples reach)
    const scale = Math.max(spacing, runSpacing(runs));
    const base = NEAR_SPACINGS * scale;
    // Looked for round a spread of the highs that have others about them (one far off on its own says nothing)
    const cells = new Map<string, number>();
    const cellOf = (p: Vec3, dx = 0, dy = 0, dz = 0) => `${Math.floor(p[0] / base) + dx},${Math.floor(p[1] / base) + dy},${Math.floor(p[2] / base) + dz}`;
    for (const r of runs) cells.set(cellOf(r.p), (cells.get(cellOf(r.p)) ?? 0) + 1);
    const company = runs.filter(r => {
        let about = 0;
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) about += cells.get(cellOf(r.p, dx, dy, dz)) ?? 0;
        return about >= LEAST_RUNS;
    });
    const planes: SuggestedReading[] = [], lines: SuggestedReading[] = [];
    const seen = new Set<string>();
    // A third of them spread evenly over the ground, the rest where the highs are thickest (every so-manyth of them)
    const picks = new Set(pickSpread(company.flatMap(r => r.p), Math.ceil(most / 3)));
    for (let k = 0, every = Math.max(1, company.length / most); picks.size < Math.min(most, company.length) && Math.floor(k * every) < company.length; k++) picks.add(Math.floor(k * every));
    for (const s of picks) {
        const at = company[s].p;
        const widest = WIDER[WIDER.length - 1] * base;
        const about: { run: Run; d: number }[] = [];
        for (const r of runs) {
            const d = Math.hypot(r.p[0] - at[0], r.p[1] - at[1], r.p[2] - at[2]);
            if (d <= widest) about.push({ run: r, d });
        }
        // Every sampled place round about, high or not, by how far off it is: what the drilling there could have shown
        // (sums for a spread: how many, where, and the products, for each of the distances looked over)
        const sums = WIDER.map(() => new Float64Array(10));
        for (let i = 0; i < n; i++) {
            const x = positions[i * 3] - at[0], y = positions[i * 3 + 1] - at[1], z = positions[i * 3 + 2] - at[2];
            if (Math.abs(x) > widest || Math.abs(y) > widest || Math.abs(z) > widest) continue;
            const d = Math.hypot(x, y, z);
            if (d > widest) continue;
            const t = sums[WIDER.findIndex(times => d <= times * base)];
            t[0]++; t[1] += x; t[2] += y; t[3] += z;
            t[4] += x * x; t[5] += x * y; t[6] += x * z; t[7] += y * y; t[8] += y * z; t[9] += z * z;
        }
        // The shortest distance over which the highs are surely flattened, and not all in a row
        // (holes along one line cannot say which way a plane dips)
        let shape: NonNullable<ReturnType<typeof spread>> | null = null, told: NonNullable<ReturnType<typeof against>> | null = null, reach = base;
        const t = new Float64Array(10);
        for (let w = 0; w < WIDER.length; w++) {
            const times = WIDER[w];
            for (let k = 0; k < 10; k++) t[k] += sums[w][k];
            const near = about.filter(a => a.d <= times * base).map(a => a.run);
            if (near.length < LEAST_RUNS || new Set(near.map(r => r.hole)).size < LEAST_HOLES || t[0] < 2) continue;
            const found = spread(near.map(r => r.p));
            if (!found) continue;
            if (!(found.far[1] >= NOT_A_ROW * found.far[0]) || !(found.far[1] >= LEAST_WIDTH * scale)) continue;
            const mx = t[1] / t[0], my = t[2] / t[0], mz = t[3] / t[0];
            const set = against(found.cov, [
                [t[4] / t[0] - mx * mx, t[5] / t[0] - mx * my, t[6] / t[0] - mx * mz],
                [t[5] / t[0] - mx * my, t[7] / t[0] - my * my, t[8] / t[0] - my * mz],
                [t[6] / t[0] - mx * mz, t[8] / t[0] - my * mz, t[9] / t[0] - mz * mz],
            ]);
            if (!set || !(set.far[2] <= set.far[1] * Math.min(FLAT, Math.exp(-SURE / Math.sqrt(near.length))))) continue;
            shape = found;
            told = set;
            reach = times * base;
            break;
        }
        if (!shape || !told) continue;
        const [long, wide, thin] = told.far;
        // (Two neighbourhoods with the same runs in them say the same thing once)
        const key = shape.mid.map(v => Math.round(v / (0.25 * reach / NEAR_SPACINGS))).join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        const normal = told.pole;
        const { dip, dipDirection } = dipFromNormal(normal);
        planes.push({ p: shape.mid, dip, direction: dipDirection, flat: thin > 0 ? Math.min(99, wide / thin) : 99 });

        // Strung out along one direction within the plane? Looked at over a longer stretch of it: the highs
        // that far round about that are in the plane
        if (!(long >= LONG * wide)) continue;
        const far = LINE_REACH * reach, off = Math.max(3 * shape.far[2], 0.1 * scale);
        const inPlane = (p: ArrayLike<number>) => Math.abs(normal[0] * (p[0] - shape.mid[0]) + normal[1] * (p[1] - shape.mid[1]) + normal[2] * (p[2] - shape.mid[2])) <= off;
        const within = (p: ArrayLike<number>) => Math.hypot(p[0] - shape.mid[0], p[1] - shape.mid[1], p[2] - shape.mid[2]) <= far;
        const stretch = spread(runs.filter(r => within(r.p) && inPlane(r.p)).map(r => r.p));
        if (!stretch || !(stretch.far[0] >= LONG * stretch.far[1])) continue;
        // (Laid into the plane)
        const lean = dot(stretch.axes[0], normal);
        const along = unit([stretch.axes[0][0] - lean * normal[0], stretch.axes[0][1] - lean * normal[1], stretch.axes[0][2] - lean * normal[2]]);
        const across = along ? unit(cross(normal, along)) : null;
        if (!along || !across) continue;
        // Where every hole round about passes through the plane, high there or not: as far across as along? Else it
        // is the drilling that is strung out (holes along a line, the edge of the drilled ground) and not the highs
        const through: Vec3[] = [];
        for (const h of holes) {
            let before = 0;
            for (let i = h.from; i < h.to; i++) {
                const d = normal[0] * (positions[i * 3] - shape.mid[0]) + normal[1] * (positions[i * 3 + 1] - shape.mid[1]) + normal[2] * (positions[i * 3 + 2] - shape.mid[2]);
                if (i > h.from && (d === 0 || d * before < 0)) {
                    const t = before / (before - d);
                    const p: Vec3 = [0, 1, 2].map(k => positions[(i - 1) * 3 + k] + t * (positions[i * 3 + k] - positions[(i - 1) * 3 + k])) as Vec3;
                    if (within(p)) through.push(p);
                    break;
                }
                before = d;
            }
        }
        if (through.length < LEAST_HOLES) continue;
        const mid: Vec3 = [0, 0, 0];
        for (const p of through) for (let k = 0; k < 3; k++) mid[k] += p[k] / through.length;
        let a2 = 0, c2 = 0;
        for (const p of through) {
            const d: Vec3 = [p[0] - mid[0], p[1] - mid[1], p[2] - mid[2]];
            a2 += dot(d, along) ** 2;
            c2 += dot(d, across) ** 2;
        }
        if (!(Math.sqrt(a2) <= DRILLING_EVEN * Math.sqrt(c2))) continue;
        const angles = lineFromStroke([0, 0, 0], along);
        if (angles) lines.push({ p: shape.mid, dip: angles.dip, direction: angles.direction });
    }
    return { planes, lines };
}
