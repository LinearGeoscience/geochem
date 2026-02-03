/**
 * Basemap utilities for map plots
 * Provides EPSG code list and mapbox configuration helpers
 */

import { transformArrayToWGS84, ensureProjectionRegistered, calculateMapBounds } from './coordinateUtils';

export type MapViewStyle = 'normal' | 'osm' | 'satellite' | 'hybrid';

// Generate all UTM zones programmatically
const generateUtmZones = (): { code: string; label: string; numericCode: number }[] => {
    const zones: { code: string; label: string; numericCode: number }[] = [];

    // UTM Northern Hemisphere: EPSG:32601-32660
    for (let zone = 1; zone <= 60; zone++) {
        const code = 32600 + zone;
        zones.push({
            code: `EPSG:${code}`,
            label: `${code} - WGS 84 / UTM zone ${zone}N`,
            numericCode: code
        });
    }

    // UTM Southern Hemisphere: EPSG:32701-32760
    for (let zone = 1; zone <= 60; zone++) {
        const code = 32700 + zone;
        zones.push({
            code: `EPSG:${code}`,
            label: `${code} - WGS 84 / UTM zone ${zone}S`,
            numericCode: code
        });
    }

    return zones;
};

// Common/Regional coordinate systems
const REGIONAL_EPSG_CODES: { code: string; label: string; numericCode: number }[] = [
    // Global
    { code: 'EPSG:3857', label: '3857 - WGS 84 / Pseudo-Mercator (Web Mercator)', numericCode: 3857 },
    { code: 'EPSG:4326', label: '4326 - WGS 84 (Geographic)', numericCode: 4326 },

    // Australia - GDA94 MGA
    { code: 'EPSG:28349', label: '28349 - GDA94 / MGA zone 49', numericCode: 28349 },
    { code: 'EPSG:28350', label: '28350 - GDA94 / MGA zone 50', numericCode: 28350 },
    { code: 'EPSG:28351', label: '28351 - GDA94 / MGA zone 51', numericCode: 28351 },
    { code: 'EPSG:28352', label: '28352 - GDA94 / MGA zone 52', numericCode: 28352 },
    { code: 'EPSG:28353', label: '28353 - GDA94 / MGA zone 53', numericCode: 28353 },
    { code: 'EPSG:28354', label: '28354 - GDA94 / MGA zone 54', numericCode: 28354 },
    { code: 'EPSG:28355', label: '28355 - GDA94 / MGA zone 55', numericCode: 28355 },
    { code: 'EPSG:28356', label: '28356 - GDA94 / MGA zone 56', numericCode: 28356 },

    // Australia - GDA2020 MGA
    { code: 'EPSG:7849', label: '7849 - GDA2020 / MGA zone 49', numericCode: 7849 },
    { code: 'EPSG:7850', label: '7850 - GDA2020 / MGA zone 50', numericCode: 7850 },
    { code: 'EPSG:7851', label: '7851 - GDA2020 / MGA zone 51', numericCode: 7851 },
    { code: 'EPSG:7852', label: '7852 - GDA2020 / MGA zone 52', numericCode: 7852 },
    { code: 'EPSG:7853', label: '7853 - GDA2020 / MGA zone 53', numericCode: 7853 },
    { code: 'EPSG:7854', label: '7854 - GDA2020 / MGA zone 54', numericCode: 7854 },
    { code: 'EPSG:7855', label: '7855 - GDA2020 / MGA zone 55', numericCode: 7855 },
    { code: 'EPSG:7856', label: '7856 - GDA2020 / MGA zone 56', numericCode: 7856 },

    // USA/Canada - NAD83 UTM
    { code: 'EPSG:26907', label: '26907 - NAD83 / UTM zone 7N', numericCode: 26907 },
    { code: 'EPSG:26908', label: '26908 - NAD83 / UTM zone 8N', numericCode: 26908 },
    { code: 'EPSG:26909', label: '26909 - NAD83 / UTM zone 9N', numericCode: 26909 },
    { code: 'EPSG:26910', label: '26910 - NAD83 / UTM zone 10N', numericCode: 26910 },
    { code: 'EPSG:26911', label: '26911 - NAD83 / UTM zone 11N', numericCode: 26911 },
    { code: 'EPSG:26912', label: '26912 - NAD83 / UTM zone 12N', numericCode: 26912 },
    { code: 'EPSG:26913', label: '26913 - NAD83 / UTM zone 13N', numericCode: 26913 },
    { code: 'EPSG:26914', label: '26914 - NAD83 / UTM zone 14N', numericCode: 26914 },
    { code: 'EPSG:26915', label: '26915 - NAD83 / UTM zone 15N', numericCode: 26915 },
    { code: 'EPSG:26916', label: '26916 - NAD83 / UTM zone 16N', numericCode: 26916 },
    { code: 'EPSG:26917', label: '26917 - NAD83 / UTM zone 17N', numericCode: 26917 },
    { code: 'EPSG:26918', label: '26918 - NAD83 / UTM zone 18N', numericCode: 26918 },
    { code: 'EPSG:26919', label: '26919 - NAD83 / UTM zone 19N', numericCode: 26919 },
    { code: 'EPSG:26920', label: '26920 - NAD83 / UTM zone 20N', numericCode: 26920 },
    { code: 'EPSG:26921', label: '26921 - NAD83 / UTM zone 21N', numericCode: 26921 },
    { code: 'EPSG:26922', label: '26922 - NAD83 / UTM zone 22N', numericCode: 26922 },

    // USA - NAD83(NSRS2007) UTM zones
    { code: 'EPSG:3707', label: '3707 - NAD83(NSRS2007) / UTM zone 3N', numericCode: 3707 },
    { code: 'EPSG:3708', label: '3708 - NAD83(NSRS2007) / UTM zone 4N', numericCode: 3708 },
    { code: 'EPSG:3709', label: '3709 - NAD83(NSRS2007) / UTM zone 5N', numericCode: 3709 },
    { code: 'EPSG:3710', label: '3710 - NAD83(NSRS2007) / UTM zone 6N', numericCode: 3710 },
    { code: 'EPSG:3711', label: '3711 - NAD83(NSRS2007) / UTM zone 7N', numericCode: 3711 },
    { code: 'EPSG:3712', label: '3712 - NAD83(NSRS2007) / UTM zone 8N', numericCode: 3712 },
    { code: 'EPSG:3713', label: '3713 - NAD83(NSRS2007) / UTM zone 9N', numericCode: 3713 },
    { code: 'EPSG:3714', label: '3714 - NAD83(NSRS2007) / UTM zone 10N', numericCode: 3714 },
    { code: 'EPSG:3715', label: '3715 - NAD83(NSRS2007) / UTM zone 11N', numericCode: 3715 },
    { code: 'EPSG:3716', label: '3716 - NAD83(NSRS2007) / UTM zone 12N', numericCode: 3716 },
    { code: 'EPSG:3717', label: '3717 - NAD83(NSRS2007) / UTM zone 13N', numericCode: 3717 },
    { code: 'EPSG:3718', label: '3718 - NAD83(NSRS2007) / UTM zone 14N', numericCode: 3718 },
    { code: 'EPSG:3719', label: '3719 - NAD83(NSRS2007) / UTM zone 15N', numericCode: 3719 },
    { code: 'EPSG:3720', label: '3720 - NAD83(NSRS2007) / UTM zone 16N', numericCode: 3720 },
    { code: 'EPSG:3721', label: '3721 - NAD83(NSRS2007) / UTM zone 17N', numericCode: 3721 },
    { code: 'EPSG:3722', label: '3722 - NAD83(NSRS2007) / UTM zone 18N', numericCode: 3722 },
    { code: 'EPSG:3723', label: '3723 - NAD83(NSRS2007) / UTM zone 19N', numericCode: 3723 },

    // USA - NAD83(2011) UTM zones
    { code: 'EPSG:6329', label: '6329 - NAD83(2011) / UTM zone 1N', numericCode: 6329 },
    { code: 'EPSG:6330', label: '6330 - NAD83(2011) / UTM zone 2N', numericCode: 6330 },
    { code: 'EPSG:6331', label: '6331 - NAD83(2011) / UTM zone 3N', numericCode: 6331 },
    { code: 'EPSG:6332', label: '6332 - NAD83(2011) / UTM zone 4N', numericCode: 6332 },
    { code: 'EPSG:6333', label: '6333 - NAD83(2011) / UTM zone 5N', numericCode: 6333 },
    { code: 'EPSG:6334', label: '6334 - NAD83(2011) / UTM zone 6N', numericCode: 6334 },
    { code: 'EPSG:6335', label: '6335 - NAD83(2011) / UTM zone 7N', numericCode: 6335 },
    { code: 'EPSG:6336', label: '6336 - NAD83(2011) / UTM zone 8N', numericCode: 6336 },
    { code: 'EPSG:6337', label: '6337 - NAD83(2011) / UTM zone 9N', numericCode: 6337 },
    { code: 'EPSG:6338', label: '6338 - NAD83(2011) / UTM zone 10N', numericCode: 6338 },
    { code: 'EPSG:6339', label: '6339 - NAD83(2011) / UTM zone 11N', numericCode: 6339 },
    { code: 'EPSG:6340', label: '6340 - NAD83(2011) / UTM zone 12N', numericCode: 6340 },
    { code: 'EPSG:6341', label: '6341 - NAD83(2011) / UTM zone 13N', numericCode: 6341 },
    { code: 'EPSG:6342', label: '6342 - NAD83(2011) / UTM zone 14N', numericCode: 6342 },
    { code: 'EPSG:6343', label: '6343 - NAD83(2011) / UTM zone 15N', numericCode: 6343 },
    { code: 'EPSG:6344', label: '6344 - NAD83(2011) / UTM zone 16N', numericCode: 6344 },
    { code: 'EPSG:6345', label: '6345 - NAD83(2011) / UTM zone 17N', numericCode: 6345 },
    { code: 'EPSG:6346', label: '6346 - NAD83(2011) / UTM zone 18N', numericCode: 6346 },
    { code: 'EPSG:6347', label: '6347 - NAD83(2011) / UTM zone 19N', numericCode: 6347 },

    // UK
    { code: 'EPSG:27700', label: '27700 - OSGB 1936 / British National Grid', numericCode: 27700 },

    // South Africa
    { code: 'EPSG:2046', label: '2046 - Hartebeesthoek94 / Lo15', numericCode: 2046 },
    { code: 'EPSG:2047', label: '2047 - Hartebeesthoek94 / Lo17', numericCode: 2047 },
    { code: 'EPSG:2048', label: '2048 - Hartebeesthoek94 / Lo19', numericCode: 2048 },
    { code: 'EPSG:2049', label: '2049 - Hartebeesthoek94 / Lo21', numericCode: 2049 },
    { code: 'EPSG:2050', label: '2050 - Hartebeesthoek94 / Lo23', numericCode: 2050 },
    { code: 'EPSG:2051', label: '2051 - Hartebeesthoek94 / Lo25', numericCode: 2051 },
    { code: 'EPSG:2052', label: '2052 - Hartebeesthoek94 / Lo27', numericCode: 2052 },
    { code: 'EPSG:2053', label: '2053 - Hartebeesthoek94 / Lo29', numericCode: 2053 },
    { code: 'EPSG:2054', label: '2054 - Hartebeesthoek94 / Lo31', numericCode: 2054 },
    { code: 'EPSG:2055', label: '2055 - Hartebeesthoek94 / Lo33', numericCode: 2055 },

    // Brazil - SIRGAS 2000
    { code: 'EPSG:31982', label: '31982 - SIRGAS 2000 / UTM zone 22S', numericCode: 31982 },
    { code: 'EPSG:31983', label: '31983 - SIRGAS 2000 / UTM zone 23S', numericCode: 31983 },
    { code: 'EPSG:31984', label: '31984 - SIRGAS 2000 / UTM zone 24S', numericCode: 31984 },
    { code: 'EPSG:31985', label: '31985 - SIRGAS 2000 / UTM zone 25S', numericCode: 31985 },

    // New Zealand
    { code: 'EPSG:2193', label: '2193 - NZGD2000 / New Zealand Transverse Mercator', numericCode: 2193 },

    // Philippines
    { code: 'EPSG:3121', label: '3121 - PRS92 / Philippines zone 1', numericCode: 3121 },
    { code: 'EPSG:3122', label: '3122 - PRS92 / Philippines zone 2', numericCode: 3122 },
    { code: 'EPSG:3123', label: '3123 - PRS92 / Philippines zone 3', numericCode: 3123 },
    { code: 'EPSG:3124', label: '3124 - PRS92 / Philippines zone 4', numericCode: 3124 },
    { code: 'EPSG:3125', label: '3125 - PRS92 / Philippines zone 5', numericCode: 3125 },
];

// Combine and sort all EPSG codes numerically
export const ALL_EPSG_CODES = [
    ...generateUtmZones(),
    ...REGIONAL_EPSG_CODES
].sort((a, b) => a.numericCode - b.numericCode);

/**
 * Get the Plotly mapbox style string for a given map view style
 */
export function getMapboxStyleString(mapViewStyle: MapViewStyle): string {
    switch (mapViewStyle) {
        case 'satellite':
        case 'hybrid':
            return 'white-bg'; // We'll add custom tile layers
        case 'osm':
            return 'open-street-map';
        default:
            return 'open-street-map';
    }
}

/**
 * Get mapbox layers configuration for satellite/hybrid styles
 * @param mapViewStyle - The map style ('satellite', 'hybrid', 'osm', 'normal')
 * @param opacity - Opacity for the base imagery layer (0.0 to 1.0, default 1.0)
 */
export function getMapboxLayers(mapViewStyle: MapViewStyle, opacity: number = 1.0): any[] | undefined {
    if (mapViewStyle === 'satellite' || mapViewStyle === 'hybrid') {
        const layers: any[] = [{
            sourcetype: 'raster',
            source: [
                'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
            ],
            below: 'traces',
            opacity: opacity
        }];

        if (mapViewStyle === 'hybrid') {
            // Keep labels at full opacity for readability
            layers.push({
                sourcetype: 'raster',
                source: [
                    'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
                ],
                opacity: Math.min(1.0, opacity + 0.2) // Labels slightly more visible
            });
        }

        return layers;
    }
    return undefined;
}

/**
 * Transform coordinate arrays and return the result with bounds
 */
export async function transformCoordinates(
    xCoords: number[],
    yCoords: number[],
    epsgCode: string
): Promise<{
    lats: number[];
    lons: number[];
    center: { lat: number; lon: number };
    zoom: number;
}> {
    await ensureProjectionRegistered(epsgCode);
    const { lats, lons } = transformArrayToWGS84(xCoords, yCoords, epsgCode);
    const { center, zoom } = calculateMapBounds(lats, lons);
    return { lats, lons, center, zoom };
}

/**
 * Create mapbox layout configuration
 * @param mapViewStyle - The map style
 * @param center - Center point {lat, lon}
 * @param zoom - Zoom level
 * @param opacity - Opacity for basemap tiles (0.0 to 1.0, default 1.0)
 */
export function createMapboxLayout(
    mapViewStyle: MapViewStyle,
    center: { lat: number; lon: number },
    zoom: number,
    opacity: number = 1.0
): any {
    const layout: any = {
        mapbox: {
            style: getMapboxStyleString(mapViewStyle),
            center: center,
            zoom: zoom
        }
    };

    const layers = getMapboxLayers(mapViewStyle, opacity);
    if (layers) {
        layout.mapbox.layers = layers;
    }

    return layout;
}
