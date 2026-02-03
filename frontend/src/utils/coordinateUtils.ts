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

/**
 * Calculate the center point and appropriate zoom level for a set of coordinates
 */
export function calculateMapBounds(lats: number[], lons: number[]): {
    center: { lat: number; lon: number };
    zoom: number;
} {
    // Filter out invalid values
    const validLats = lats.filter(l => !isNaN(l) && isFinite(l));
    const validLons = lons.filter(l => !isNaN(l) && isFinite(l));

    if (validLats.length === 0 || validLons.length === 0) {
        return {
            center: { lat: 0, lon: 0 },
            zoom: 2
        };
    }

    const minLat = Math.min(...validLats);
    const maxLat = Math.max(...validLats);
    const minLon = Math.min(...validLons);
    const maxLon = Math.max(...validLons);

    const centerLat = (minLat + maxLat) / 2;
    const centerLon = (minLon + maxLon) / 2;

    // Calculate zoom based on extent
    const latRange = maxLat - minLat;
    const lonRange = maxLon - minLon;
    const maxRange = Math.max(latRange, lonRange);

    // Approximate zoom levels based on degree range
    let zoom: number;
    if (maxRange > 10) zoom = 4;
    else if (maxRange > 5) zoom = 6;
    else if (maxRange > 1) zoom = 8;
    else if (maxRange > 0.5) zoom = 10;
    else if (maxRange > 0.1) zoom = 12;
    else if (maxRange > 0.05) zoom = 14;
    else if (maxRange > 0.01) zoom = 15;
    else zoom = 16;

    return {
        center: { lat: centerLat, lon: centerLon },
        zoom
    };
}
