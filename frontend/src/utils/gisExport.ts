/**
 * GIS output (Calculation > WGS84 Long/Lat, File > Export to Google
 * Earth): longitude/latitude from projected coordinates, and visible points
 * as KML (styled by attribute colour and size) or GeoJSON.
 */
import { transformArrayToWGS84 } from './coordinateUtils';

export interface GisPoint {
    lon: number;
    lat: number;
    name: string;
    /** #rrggbb */
    color: string;
    /** Attribute marker size (px) */
    size: number;
    properties: Record<string, string | number | null>;
}

/** Longitude/latitude (WGS84) for projected X/Y in `epsg`; NaN where invalid. */
export function lonLatColumns(x: ArrayLike<number>, y: ArrayLike<number>, epsg: string): { lons: Float64Array; lats: Float64Array } {
    const { lats, lons } = transformArrayToWGS84(Array.from(x), Array.from(y), epsg);
    return { lons: Float64Array.from(lons), lats: Float64Array.from(lats) };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** #rrggbb -> KML aabbggrr */
export function kmlColor(hex: string, alpha = 1): string {
    const m = /^#?([0-9a-f]{6})/i.exec(hex.trim());
    const rgb = m ? m[1].toLowerCase() : '808080';
    const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255).toString(16).padStart(2, '0');
    return `${a}${rgb.slice(4, 6)}${rgb.slice(2, 4)}${rgb.slice(0, 2)}`;
}

/** KML document; one shared style per colour/size, ExtendedData per point. */
export function toKml(points: GisPoint[], docName: string): string {
    const styles = new Map<string, string>();
    const styleId = (p: GisPoint) => {
        const key = `${p.color}|${p.size}`;
        if (!styles.has(key)) styles.set(key, `s${styles.size}`);
        return styles.get(key)!;
    };
    const marks = points
        .filter(p => Number.isFinite(p.lon) && Number.isFinite(p.lat))
        .map(p => {
            const data = Object.entries(p.properties)
                .map(([k, v]) => `<Data name="${esc(k)}"><value>${v == null ? '' : esc(String(v))}</value></Data>`).join('');
            return `<Placemark><name>${esc(p.name)}</name><styleUrl>#${styleId(p)}</styleUrl><ExtendedData>${data}</ExtendedData><Point><coordinates>${p.lon.toFixed(7)},${p.lat.toFixed(7)},0</coordinates></Point></Placemark>`;
        });
    const styleXml = [...styles].map(([key, id]) => {
        const [color, size] = key.split('|');
        return `<Style id="${id}"><IconStyle><color>${kmlColor(color)}</color><scale>${(Number(size) / 10).toFixed(2)}</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/shaded_dot.png</href></Icon></IconStyle><LabelStyle><scale>0</scale></LabelStyle></Style>`;
    });
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>',
        `<name>${esc(docName)}</name>`,
        ...styleXml,
        ...marks,
        '</Document></kml>',
    ].join('\n');
}

/** GeoJSON FeatureCollection (WGS84) with colour/size as properties. */
export function toGeoJson(points: GisPoint[]): string {
    return JSON.stringify({
        type: 'FeatureCollection',
        features: points
            .filter(p => Number.isFinite(p.lon) && Number.isFinite(p.lat))
            .map(p => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [+p.lon.toFixed(7), +p.lat.toFixed(7)] },
                properties: { name: p.name, ...p.properties, marker_color: p.color, marker_size: p.size },
            })),
    });
}

export function downloadText(text: string, filename: string, type: string): void {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
