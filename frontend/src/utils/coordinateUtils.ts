import proj4 from 'proj4';

/**
 * Coordinate transformation utilities for converting between UTM/local projections and WGS84
 * Used for basemap overlay on attribute maps
 */

export interface CoordinateConfig {
    epsg: string;           // e.g., "EPSG:32650" for UTM Zone 50N
    definition?: string;    // Optional custom proj4 definition
}

// Cache for registered projections
const registeredProjections = new Set<string>();

/**
 * Register a projection definition with proj4
 */
export function registerProjection(epsg: string, definition: string): void {
    const normalizedEpsg = normalizeEpsgCode(epsg);
    proj4.defs(normalizedEpsg, definition);
    registeredProjections.add(normalizedEpsg);
}

/**
 * Normalize EPSG code format (e.g., "32650" -> "EPSG:32650")
 */
function normalizeEpsgCode(epsg: string): string {
    const cleaned = epsg.trim().toUpperCase();
    if (cleaned.startsWith('EPSG:')) {
        return cleaned;
    }
    // Handle plain numbers
    if (/^\d+$/.test(cleaned)) {
        return `EPSG:${cleaned}`;
    }
    return cleaned;
}

/**
 * Check if a projection is registered
 */
export function isProjectionRegistered(epsg: string): boolean {
    const normalizedEpsg = normalizeEpsgCode(epsg);
    return registeredProjections.has(normalizedEpsg) || proj4.defs(normalizedEpsg) !== undefined;
}

/**
 * Transform a single point from source CRS to WGS84 (EPSG:4326)
 * @returns [latitude, longitude]
 */
export function transformToWGS84(
    x: number,
    y: number,
    sourceEpsg: string
): [number, number] {
    const normalizedEpsg = normalizeEpsgCode(sourceEpsg);

    // Check if projection is defined
    if (!proj4.defs(normalizedEpsg)) {
        throw new Error(`Projection ${normalizedEpsg} is not registered. Please enter a valid EPSG code.`);
    }

    try {
        const [lon, lat] = proj4(normalizedEpsg, 'EPSG:4326', [x, y]);
        return [lat, lon];
    } catch (err) {
        throw new Error(`Failed to transform coordinates: ${err}`);
    }
}

/**
 * Transform arrays of coordinates from source CRS to WGS84
 * More efficient for bulk transformations
 */
export function transformArrayToWGS84(
    xCoords: number[],
    yCoords: number[],
    sourceEpsg: string
): { lats: number[]; lons: number[] } {
    const normalizedEpsg = normalizeEpsgCode(sourceEpsg);

    // Check if projection is defined
    if (!proj4.defs(normalizedEpsg)) {
        throw new Error(`Projection ${normalizedEpsg} is not registered. Please enter a valid EPSG code.`);
    }

    const lats: number[] = [];
    const lons: number[] = [];

    const transformer = proj4(normalizedEpsg, 'EPSG:4326');

    for (let i = 0; i < xCoords.length; i++) {
        const x = xCoords[i];
        const y = yCoords[i];

        // Skip invalid coordinates
        if (x === null || x === undefined || isNaN(x) ||
            y === null || y === undefined || isNaN(y)) {
            lats.push(NaN);
            lons.push(NaN);
            continue;
        }

        try {
            const [lon, lat] = transformer.forward([x, y]);
            lats.push(lat);
            lons.push(lon);
        } catch {
            lats.push(NaN);
            lons.push(NaN);
        }
    }

    return { lats, lons };
}

/**
 * Fetch projection definition from epsg.io
 * This allows users to use any EPSG code without pre-registering
 */
export async function fetchProjectionDefinition(epsg: string): Promise<string> {
    const normalizedEpsg = normalizeEpsgCode(epsg);
    const code = normalizedEpsg.replace('EPSG:', '');

    try {
        const response = await fetch(`https://epsg.io/${code}.proj4`);
        if (!response.ok) {
            throw new Error(`EPSG code ${normalizedEpsg} not found`);
        }
        const definition = await response.text();

        if (!definition || definition.trim() === '') {
            throw new Error(`Empty projection definition for ${normalizedEpsg}`);
        }

        return definition.trim();
    } catch (err: any) {
        if (err.message?.includes('not found') || err.message?.includes('Empty')) {
            throw err;
        }
        throw new Error(`Failed to fetch projection ${normalizedEpsg}: ${err.message}`);
    }
}

/**
 * Register a projection by fetching from epsg.io if needed
 * Returns true if successful, throws error otherwise
 */
export async function ensureProjectionRegistered(epsg: string): Promise<boolean> {
    const normalizedEpsg = normalizeEpsgCode(epsg);

    // Already registered?
    if (isProjectionRegistered(normalizedEpsg)) {
        return true;
    }

    // Fetch from epsg.io
    const definition = await fetchProjectionDefinition(normalizedEpsg);
    registerProjection(normalizedEpsg, definition);

    console.log(`[CoordinateUtils] Registered projection ${normalizedEpsg}`);
    return true;
}

/** Median of a typed array (sorted in place) */
function medianOf(a: Float64Array): number {
    a.sort();
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * Extent of the main body of the points. Points far from the rest (a few rows
 * in degrees among metres, 0/0 or -9999 placeholders) are left out, so they
 * don't pull the view away from the data. A point is kept when both its X and
 * Y lie within `k` robust standard deviations (1.4826 x MAD) of the median.
 */
export function robustExtent(xs: ArrayLike<unknown>, ys: ArrayLike<unknown>, k = 10): {
    x: [number, number]; y: [number, number]; kept: number; outside: number;
} | null {
    const n = Math.min(xs.length, ys.length);
    const px = new Float64Array(n), py = new Float64Array(n);
    let m = 0;
    for (let i = 0; i < n; i++) {
        const x = xs[i], y = ys[i];
        if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)) {
            px[m] = x; py[m] = y; m++;
        }
    }
    if (!m) return null;
    const xv = px.subarray(0, m), yv = py.subarray(0, m);
    const limit = (v: Float64Array) => {
        const med = medianOf(Float64Array.from(v));
        const dev = new Float64Array(v.length);
        for (let i = 0; i < v.length; i++) dev[i] = Math.abs(v[i] - med);
        const mad = medianOf(dev);
        // More than half the points share one value: fall back to keeping everything
        return { med, tol: mad > 0 ? k * 1.4826 * mad : Infinity };
    };
    const lx = limit(xv), ly = limit(yv);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, kept = 0;
    for (let i = 0; i < m; i++) {
        const x = xv[i], y = yv[i];
        if (Math.abs(x - lx.med) > lx.tol || Math.abs(y - ly.med) > ly.tol) continue;
        kept++;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return { x: [x0, x1], y: [y0, y1], kept, outside: m - kept };
}

/**
 * Centre and zoom level that frame the main body of the points (see
 * robustExtent: stray far-off points don't move the map away from the data)
 */
export function calculateMapBounds(lats: ArrayLike<number>, lons: ArrayLike<number>): {
    center: { lat: number; lon: number };
    zoom: number;
} {
    const ext = robustExtent(lons, lats);
    if (!ext) return { center: { lat: 0, lon: 0 }, zoom: 2 };
    const lat = (ext.y[0] + ext.y[1]) / 2;
    const lon = (ext.x[0] + ext.x[1]) / 2;
    // Web Mercator: a degree of latitude is 1/cos(lat) times taller than a degree of longitude
    const span = Math.max(ext.x[1] - ext.x[0], (ext.y[1] - ext.y[0]) / Math.max(0.05, Math.cos(lat * Math.PI / 180)));
    // 512 px tiles: the span takes ~350 px (fits a small grid panel with margin)
    const zoom = span > 0 ? Math.log2((350 * 360) / (512 * span)) : 16;
    return { center: { lat, lon }, zoom: Math.max(1, Math.min(16, zoom)) };
}
