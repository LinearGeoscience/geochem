/**
 * Topography from a file (Phase 228; pure, unit-tested): a grid of heights
 * (ESRI ASCII, .asc; a GeoTIFF is read by features/model/topoTiff) or a file
 * of points (X Y Z), read to one thing, a grid of heights, and that made a
 * mesh.
 *
 * The mesh is then a mesh like any other of the project (it is written
 * beside the project as a Leapfrog .msh): shown, kept, and the top of a
 * geological model, above which the model has nothing.
 *
 * A grid's heights are at the middles of its cells. A big grid is made
 * coarser before it is meshed (each new cell the mean of the cells in it),
 * and the result says by how much.
 */

/** Heights on a grid, row by row from the south, west to east; NaN where there is none */
export interface HeightGrid {
    nx: number;
    ny: number;
    /** The middle of the south-west cell */
    x0: number;
    y0: number;
    /** The size of a cell, east and north */
    dx: number;
    dy: number;
    z: Float32Array;
    /** What was done on the way that the user should know (a sentence each) */
    notes: string[];
}

export interface TopoMesh {
    /** World xyz, 3 a corner */
    vertices: Float64Array;
    triangles: Uint32Array;
    /** Each cell of the mesh is this many cells of the grid along a side (1: as read) */
    every: number;
}

/** A file that cannot be read as heights: the message is a sentence for the user */
export class NotTopography extends Error {}

/** More cells than this are not read (a file of some gigabytes) */
export const MOST_CELLS = 60_000_000;
/** Loose points are put on a grid of no more cells than this along a side */
const MOST_SIDE = 3000;

export type TopoKind = 'grid' | 'points' | 'tiff';

/** What kind of topography file a name says it is (null: none that is read) */
export function topoKind(fileName: string): TopoKind | null {
    const ext = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
    if (ext === 'asc' || ext === 'grd') return 'grid';
    if (ext === 'xyz' || ext === 'csv' || ext === 'txt') return 'points';
    if (ext === 'tif' || ext === 'tiff') return 'tiff';
    return null;
}

/** The file endings read as topography */
export const TOPO_EXTENSIONS = ['.asc', '.grd', '.xyz', '.csv', '.txt', '.tif', '.tiff'] as const;

const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 13;

/**
 * An ESRI ASCII grid: a head of `name value` lines (ncols, nrows, xllcorner
 * or xllcenter, yllcorner or yllcenter, cellsize or dx and dy, and
 * NODATA_value if it has one), then the heights row by row from the north.
 */
export function readAsciiGrid(text: string): HeightGrid {
    const head: Record<string, number> = {};
    let at = 0;
    const n = text.length;
    // The head: lines that start with a letter
    for (;;) {
        while (at < n && isSpace(text.charCodeAt(at))) at++;
        const c = text.charCodeAt(at);
        if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122))) break;
        let end = text.indexOf('\n', at);
        if (end < 0) end = n;
        const [name, value] = text.slice(at, end).trim().split(/\s+/);
        head[name.toLowerCase()] = Number((value ?? '').replace(',', '.'));
        at = end;
    }
    const nx = head.ncols, ny = head.nrows;
    const dx = head.cellsize ?? head.dx, dy = head.cellsize ?? head.dy;
    if (!Number.isInteger(nx) || !Number.isInteger(ny) || nx < 2 || ny < 2) {
        throw new NotTopography('This is not an ESRI ASCII grid: it does not start with ncols and nrows. (A Surfer grid is saved from Surfer as "ESRI ASCII" or as XYZ points.)');
    }
    if (!(dx > 0) || !(dy > 0)) throw new NotTopography('The grid does not say the size of its cells (cellsize).');
    if (nx * ny > MOST_CELLS) throw new NotTopography(`The grid has ${(nx * ny).toLocaleString()} cells, more than can be read here: save it coarser (a cell of 5 to 25 m is plenty for the top of a model).`);
    const west = Number.isFinite(head.xllcenter) ? head.xllcenter : head.xllcorner + dx / 2;
    const south = Number.isFinite(head.yllcenter) ? head.yllcenter : head.yllcorner + dy / 2;
    if (!Number.isFinite(west) || !Number.isFinite(south)) throw new NotTopography('The grid does not say where it is (xllcorner and yllcorner).');
    const none = head.nodata_value;
    const z = new Float32Array(nx * ny).fill(NaN);
    let k = 0;
    const cells = nx * ny;
    while (at < n && k < cells) {
        while (at < n && isSpace(text.charCodeAt(at))) at++;
        if (at >= n) break;
        let end = at + 1;
        while (end < n && !isSpace(text.charCodeAt(end))) end++;
        const v = Number(text.slice(at, end));
        at = end;
        // (Rows come from the north: the first row read is the last of the grid)
        const row = ny - 1 - Math.floor(k / nx), col = k % nx;
        if (Number.isFinite(v) && v !== none) z[row * nx + col] = v;
        k++;
    }
    if (k < cells) throw new NotTopography(`The grid says it has ${cells.toLocaleString()} heights and the file holds ${k.toLocaleString()}: it is cut short.`);
    return { nx, ny, x0: west, y0: south, dx, dy, z, notes: [] };
}

/** The usual gap between neighbours of sorted values (their median step, steps of nothing left out) */
function usualStep(sorted: Float64Array): number {
    const steps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
        const d = sorted[i] - sorted[i - 1];
        if (d > 1e-9) steps.push(d);
    }
    if (steps.length === 0) return 0;
    steps.sort((a, b) => a - b);
    return steps[steps.length >> 1];
}

const NAMES_X = ['x', 'e', 'east', 'easting', 'eastings', 'xcoord', 'mga_e', 'utm_e'];
const NAMES_Y = ['y', 'n', 'north', 'northing', 'northings', 'ycoord', 'mga_n', 'utm_n'];
const NAMES_Z = ['z', 'rl', 'elev', 'elevation', 'height', 'h', 'alt', 'altitude', 'zcoord', 'ahd'];

/**
 * A file of points: a line a point, its numbers parted by spaces, commas,
 * tabs or semicolons; with or without a line of names first. The first
 * three columns are east, north and height unless the names say otherwise.
 * Points on a regular grid are read as that grid; loose points are put on a
 * grid of their usual spacing, a cell the mean of its points, and cells with
 * none are filled from their neighbours up to three cells away.
 */
export function readXyz(text: string): HeightGrid {
    const lines = text.split(/\r?\n/);
    let cols: [number, number, number] = [0, 1, 2];
    let first = 0;
    while (first < lines.length && lines[first].trim() === '') first++;
    const split = (line: string) => line.trim().split(/[\s,;]+/).filter(p => p !== '');
    const headed = first < lines.length && split(lines[first]).some(p => !Number.isFinite(Number(p)));
    if (headed) {
        const names = split(lines[first]).map(p => p.replace(/["']/g, '').toLowerCase());
        const find = (known: string[]) => names.findIndex(nm => known.includes(nm));
        const x = find(NAMES_X), y = find(NAMES_Y), z = find(NAMES_Z);
        if (x >= 0 && y >= 0 && z >= 0) cols = [x, y, z];
        first++;
    }
    const xs: number[] = [], ys: number[] = [], zs: number[] = [];
    let skipped = 0;
    for (let i = first; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '') continue;
        const parts = split(line);
        const x = Number(parts[cols[0]]), y = Number(parts[cols[1]]), z = Number(parts[cols[2]]);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) { xs.push(x); ys.push(y); zs.push(z); } else skipped++;
    }
    const n = xs.length;
    if (n < 3) throw new NotTopography('No points could be read: this needs lines of three numbers, east, north and height.');
    const notes: string[] = [];
    if (skipped > 0) notes.push(`${skipped.toLocaleString()} ${skipped === 1 ? 'line was' : 'lines were'} not three numbers and ${skipped === 1 ? 'was' : 'were'} left out.`);
    let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
    for (let i = 0; i < n; i++) {
        if (xs[i] < west) west = xs[i];
        if (xs[i] > east) east = xs[i];
        if (ys[i] < south) south = ys[i];
        if (ys[i] > north) north = ys[i];
    }
    if (!(east > west) || !(north > south)) throw new NotTopography('The points are all on one line: they do not make a surface.');
    // On a grid already? Then there are few different eastings and northings, evenly spaced
    const stepX = usualStep(Float64Array.from(new Set(xs)).sort()), stepY = usualStep(Float64Array.from(new Set(ys)).sort());
    const onGrid = stepX > 0 && stepY > 0 && ((east - west) / stepX + 1) * ((north - south) / stepY + 1) <= n * 2;
    let dx: number, dy: number;
    if (onGrid) {
        dx = stepX; dy = stepY;
    } else {
        // The usual spacing of loose points: the side of the square each would have to itself
        dx = dy = Math.sqrt(((east - west) * (north - south)) / n);
        const least = Math.max(east - west, north - south) / MOST_SIDE;
        if (dx < least) dx = dy = least;
    }
    const nx = Math.round((east - west) / dx) + 1, ny = Math.round((north - south) / dy) + 1;
    if (nx < 2 || ny < 2) throw new NotTopography('The points are all on one line: they do not make a surface.');
    if (nx * ny > MOST_CELLS) throw new NotTopography('The points are too many and too far apart to grid here: thin them, or save them as a grid.');
    const sum = new Float64Array(nx * ny), count = new Uint32Array(nx * ny);
    for (let i = 0; i < n; i++) {
        const c = Math.min(nx - 1, Math.round((xs[i] - west) / dx)), r = Math.min(ny - 1, Math.round((ys[i] - south) / dy));
        sum[r * nx + c] += zs[i];
        count[r * nx + c]++;
    }
    let z = new Float32Array(nx * ny);
    let empty = 0;
    for (let k = 0; k < z.length; k++) {
        if (count[k] > 0) z[k] = sum[k] / count[k];
        else { z[k] = NaN; empty++; }
    }
    if (!onGrid) {
        // Cells with no point: the mean of the neighbours that have a height, three times over (so up to three cells from a point)
        let filled = 0;
        for (let pass = 0; pass < 3 && empty > filled; pass++) {
            const next = z.slice();
            for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
                if (!Number.isNaN(z[r * nx + c])) continue;
                let total = 0, got = 0;
                for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
                    const rr = r + dr, cc = c + dc;
                    if (rr < 0 || rr >= ny || cc < 0 || cc >= nx) continue;
                    const v = z[rr * nx + cc];
                    if (!Number.isNaN(v)) { total += v; got++; }
                }
                if (got > 0) { next[r * nx + c] = total / got; filled++; }
            }
            z = next;
        }
        notes.push(`${n.toLocaleString()} loose points, put on a grid of ${trim(dx)} m cells (a cell is the mean of its points).`);
    }
    return { nx, ny, x0: west, y0: south, dx, dy, z, notes };
}

const trim = (v: number) => Number(v.toPrecision(4)).toLocaleString();

export interface GridFacts {
    /** Cells with a height, and all cells */
    cells: number;
    of: number;
    lowest: number;
    highest: number;
    /** Its edges (of its cells, not their middles) */
    west: number; east: number; south: number; north: number;
}

export function gridFacts(grid: HeightGrid): GridFacts {
    let cells = 0, lowest = Infinity, highest = -Infinity;
    for (let k = 0; k < grid.z.length; k++) {
        const v = grid.z[k];
        if (Number.isNaN(v)) continue;
        cells++;
        if (v < lowest) lowest = v;
        if (v > highest) highest = v;
    }
    return {
        cells, of: grid.z.length, lowest, highest,
        west: grid.x0 - grid.dx / 2, east: grid.x0 + (grid.nx - 0.5) * grid.dx, south: grid.y0 - grid.dy / 2, north: grid.y0 + (grid.ny - 0.5) * grid.dy,
    };
}

/** What was read, in a sentence */
export function describeGrid(grid: HeightGrid, every = 1): string {
    const f = gridFacts(grid);
    const size = Math.abs(grid.dx - grid.dy) < 1e-9 * grid.dx ? `${trim(grid.dx)} m` : `${trim(grid.dx)} by ${trim(grid.dy)} m`;
    const holes = f.cells < f.of ? `, ${Math.round((100 * (f.of - f.cells)) / f.of)}% of them with no height` : '';
    const coarser = every > 1 ? ` Meshed at every ${every === 2 ? '2nd' : every === 3 ? '3rd' : `${every}th`} cell (${trim(grid.dx * every)} m): finer than that is no use to a model.` : '';
    return `${grid.nx.toLocaleString()} by ${grid.ny.toLocaleString()} cells of ${size}${holes}, from ${trim(f.lowest)} to ${trim(f.highest)} m high.${coarser}`;
}

/** A mesh of a grid has no more triangles than this: a bigger grid is meshed coarser */
export const MOST_TRIANGLES = 400_000;

/** How many cells of the grid go to a side of a cell of its mesh (1: it is meshed as it is) */
export const meshEvery = (grid: Pick<HeightGrid, 'nx' | 'ny'>, most = MOST_TRIANGLES): number => Math.max(1, Math.ceil(Math.sqrt((2 * (grid.nx - 1) * (grid.ny - 1)) / most)));

/**
 * The part of the grid between these eastings and northings (whole cells,
 * the ones whose middles are within them); null when under two cells each
 * way are, or all of it is.
 */
export function cropGrid(grid: HeightGrid, west: number, east: number, south: number, north: number): HeightGrid | null {
    const c0 = Math.max(0, Math.ceil((west - grid.x0) / grid.dx)), c1 = Math.min(grid.nx - 1, Math.floor((east - grid.x0) / grid.dx));
    const r0 = Math.max(0, Math.ceil((south - grid.y0) / grid.dy)), r1 = Math.min(grid.ny - 1, Math.floor((north - grid.y0) / grid.dy));
    const nx = c1 - c0 + 1, ny = r1 - r0 + 1;
    if (nx < 2 || ny < 2 || (nx === grid.nx && ny === grid.ny)) return null;
    const z = new Float32Array(nx * ny);
    for (let r = 0; r < ny; r++) z.set(grid.z.subarray((r0 + r) * grid.nx + c0, (r0 + r) * grid.nx + c0 + nx), r * nx);
    return { nx, ny, x0: grid.x0 + c0 * grid.dx, y0: grid.y0 + r0 * grid.dy, dx: grid.dx, dy: grid.dy, z, notes: grid.notes };
}

/** The grid with cells `every` times the size, each the mean of the cells in it that have a height */
export function coarsen(grid: HeightGrid, every: number): HeightGrid {
    if (every <= 1) return grid;
    const nx = Math.ceil(grid.nx / every), ny = Math.ceil(grid.ny / every);
    const z = new Float32Array(nx * ny);
    for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
        let total = 0, got = 0;
        for (let rr = r * every; rr < Math.min(grid.ny, (r + 1) * every); rr++) for (let cc = c * every; cc < Math.min(grid.nx, (c + 1) * every); cc++) {
            const v = grid.z[rr * grid.nx + cc];
            if (!Number.isNaN(v)) { total += v; got++; }
        }
        z[r * nx + c] = got > 0 ? total / got : NaN;
    }
    // (The middle of a new cell is the middle of the block it stands for)
    return { nx, ny, x0: grid.x0 + ((every - 1) / 2) * grid.dx, y0: grid.y0 + ((every - 1) / 2) * grid.dy, dx: grid.dx * every, dy: grid.dy * every, z, notes: grid.notes };
}

/**
 * The grid as a mesh: a corner at the middle of each cell that has a height,
 * two triangles between each four neighbours that all have one (wound so
 * that they face up). With more than `most` triangles the grid is made
 * coarser first.
 */
export function gridToMesh(grid: HeightGrid, most = MOST_TRIANGLES): TopoMesh {
    const every = meshEvery(grid, most);
    const g = coarsen(grid, every);
    const index = new Int32Array(g.nx * g.ny).fill(-1);
    const vertices: number[] = [];
    for (let r = 0; r < g.ny; r++) for (let c = 0; c < g.nx; c++) {
        const v = g.z[r * g.nx + c];
        if (Number.isNaN(v)) continue;
        index[r * g.nx + c] = vertices.length / 3;
        vertices.push(g.x0 + c * g.dx, g.y0 + r * g.dy, v);
    }
    const triangles: number[] = [];
    for (let r = 0; r + 1 < g.ny; r++) for (let c = 0; c + 1 < g.nx; c++) {
        const a = index[r * g.nx + c], b = index[r * g.nx + c + 1], d = index[(r + 1) * g.nx + c], e = index[(r + 1) * g.nx + c + 1];
        if (a < 0 || b < 0 || d < 0 || e < 0) continue;
        triangles.push(a, b, e, a, e, d);
    }
    if (triangles.length === 0) throw new NotTopography('No four neighbouring cells have heights: there is nothing to make a surface of.');
    // (Corners no triangle uses are left in: there are few, and a mesh may have them)
    return { vertices: Float64Array.from(vertices), triangles: Uint32Array.from(triangles), every };
}

/** The height of the grid at a place (between the middles of its cells, in straight lines); NaN off it or where it has none */
export function heightAt(grid: HeightGrid, x: number, y: number): number {
    const fc = (x - grid.x0) / grid.dx, fr = (y - grid.y0) / grid.dy;
    if (fc < 0 || fr < 0 || fc > grid.nx - 1 || fr > grid.ny - 1) return NaN;
    const c = Math.min(grid.nx - 2, Math.floor(fc)), r = Math.min(grid.ny - 2, Math.floor(fr));
    const u = fc - c, v = fr - r;
    const at = (rr: number, cc: number) => grid.z[rr * grid.nx + cc];
    return (1 - v) * ((1 - u) * at(r, c) + u * at(r, c + 1)) + v * ((1 - u) * at(r + 1, c) + u * at(r + 1, c + 1));
}

/**
 * How much of a box in plan the grid covers, as a sentence when it is not
 * all of it (null: it covers it). The usual cause of none is a grid in
 * another coordinate system.
 */
export function coverNote(grid: HeightGrid, box: { min: readonly number[]; max: readonly number[] } | null, what = 'the drilling'): string | null {
    if (!box) return null;
    const f = gridFacts(grid);
    const w = Math.max(0, Math.min(f.east, box.max[0]) - Math.max(f.west, box.min[0])), h = Math.max(0, Math.min(f.north, box.max[1]) - Math.max(f.south, box.min[1]));
    const area = (box.max[0] - box.min[0]) * (box.max[1] - box.min[1]);
    if (!(area > 0)) return null;
    const share = (w * h) / area;
    if (share >= 0.999) return null;
    if (share <= 0) return `It is nowhere over ${what}: check it is in the same coordinate system (MGA zone, or the mine's own grid).`;
    return `It covers ${Math.max(1, Math.round(share * 100))}% of ${what} in plan: beyond its edge a model's top carries straight on from the ground at the edge.`;
}
