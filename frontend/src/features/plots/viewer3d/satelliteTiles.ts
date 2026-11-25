/**
 * Satellite imagery under the 3D scene (pure maths, unit-tested).
 *
 * Web-Mercator tiles are laid out as small grids whose vertices are projected
 * into the dataset's coordinate system, so the image sits where the samples
 * are in any projection (UTM/MGA grids are rotated and scaled against
 * Mercator; a single stretched picture would be metres out at the edges).
 */

export const SATELLITE_TILE_URL =
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const SATELLITE_ATTRIBUTION = 'Imagery © Esri, Maxar, Earthstar Geographics';

export interface GroundTile {
    url: string;
    /** Grid cells per side */
    segments: number;
    /** Local (re-origined) x, y of the (segments + 1)² grid vertices, north row first */
    xy: Float32Array;
}

/** Fractional tile column/row of a longitude/latitude at zoom `z`. */
export function lonLatToTile(lon: number, lat: number, z: number): [number, number] {
    const n = 2 ** z;
    const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
    const rad = (clamped * Math.PI) / 180;
    return [((lon + 180) / 360) * n, ((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * n];
}

/** Longitude/latitude of a fractional tile column/row at zoom `z`. */
export function tileToLonLat(x: number, y: number, z: number): [number, number] {
    const n = 2 ** z;
    return [(x / n) * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI];
}

interface TileRange { z: number; x0: number; x1: number; y0: number; y1: number }

function tileRange(west: number, south: number, east: number, north: number, z: number): TileRange {
    const [xa, ya] = lonLatToTile(west, north, z);
    const [xb, yb] = lonLatToTile(east, south, z);
    const max = 2 ** z - 1;
    const clamp = (v: number) => Math.max(0, Math.min(max, Math.floor(v)));
    return { z, x0: clamp(xa), x1: clamp(xb), y0: clamp(ya), y1: clamp(yb) };
}

/** Most detailed zoom whose tiles over the lon/lat box stay within `maxTiles`. */
export function chooseTileRange(
    west: number, south: number, east: number, north: number, maxTiles: number, maxZoom: number,
): TileRange {
    for (let z = maxZoom; z > 0; z--) {
        const r = tileRange(west, south, east, north, z);
        if ((r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) <= maxTiles) return r;
    }
    return tileRange(west, south, east, north, 0);
}

export interface GroundPlanOptions {
    /** Margin around the data as a fraction of its larger side */
    pad?: number;
    maxTiles?: number;
    /** World Imagery has no pictures past 17-19 in remote areas (it serves a "no data" tile) */
    maxZoom?: number;
    segments?: number;
}

/**
 * Tiles covering the data's X/Y extent (world coordinates of the dataset's
 * projection) plus a margin. `origin` is the world coordinate of local (0, 0).
 */
export function planGroundTiles(
    extent: { minX: number; maxX: number; minY: number; maxY: number },
    origin: [number, number],
    toLonLat: (x: number, y: number) => [number, number],
    fromLonLat: (lon: number, lat: number) => [number, number],
    opts: GroundPlanOptions = {},
): GroundTile[] {
    const { pad = 0.15, maxTiles = 100, maxZoom = 17, segments = 4 } = opts;
    const side = Math.max(extent.maxX - extent.minX, extent.maxY - extent.minY);
    const margin = side > 0 ? side * pad : Math.max(Math.abs(extent.minX) * 1e-4, 1e-3);
    const x0 = extent.minX - margin, x1 = extent.maxX + margin;
    const y0 = extent.minY - margin, y1 = extent.maxY + margin;

    // Lon/lat box of the padded rectangle (its edges curve in lon/lat: sample them)
    let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
    for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const edge: [number, number][] = [
            [x0 + (x1 - x0) * t, y0], [x0 + (x1 - x0) * t, y1], [x0, y0 + (y1 - y0) * t], [x1, y0 + (y1 - y0) * t],
        ];
        for (const [x, y] of edge) {
            const [lon, lat] = toLonLat(x, y);
            if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
            if (lon < west) west = lon;
            if (lon > east) east = lon;
            if (lat < south) south = lat;
            if (lat > north) north = lat;
        }
    }
    if (!(east >= west) || !(north >= south)) return [];

    const r = chooseTileRange(west, south, east, north, maxTiles, maxZoom);
    const tiles: GroundTile[] = [];
    for (let ty = r.y0; ty <= r.y1; ty++) {
        for (let tx = r.x0; tx <= r.x1; tx++) {
            const xy = new Float32Array((segments + 1) * (segments + 1) * 2);
            let ok = true;
            for (let j = 0, k = 0; j <= segments && ok; j++) {
                for (let i = 0; i <= segments; i++, k += 2) {
                    const [lon, lat] = tileToLonLat(tx + i / segments, ty + j / segments, r.z);
                    const [x, y] = fromLonLat(lon, lat);
                    if (!Number.isFinite(x) || !Number.isFinite(y)) { ok = false; break; }
                    // Subtract in float64 before the float32 store (UTM northings)
                    xy[k] = x - origin[0];
                    xy[k + 1] = y - origin[1];
                }
            }
            if (!ok) continue;
            const url = SATELLITE_TILE_URL.replace('{z}', String(r.z)).replace('{y}', String(ty)).replace('{x}', String(tx));
            tiles.push({ url, segments, xy });
        }
    }
    return tiles;
}
